#!/usr/bin/env python3
"""
generate_icons.py — macOS Apple Silicon Startup Manager Theme Generator for GRUB 2
Generates:
1. 3-card layout icons (Ubuntu, UEFI Settings, Options + Shut Down/Restart)
2. 4-card layout icons with USB drive (USB Boot, Ubuntu, UEFI Settings, Options + Shut Down/Restart)
3. 5-frame smooth slide transition animations (sliding cards right and introducing USB on left)
"""

import os
import sys
import datetime
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
S = 2  # 2x supersampling downscaled with Lanczos for 4K Retina sharpness
SW, SH = W * S, H * S

# Font configuration
font_display = '/home/vitaliy/.local/share/fonts/SF_Pro_Display/SF-Pro-Display-Medium.otf'
font_text = '/home/vitaliy/.local/share/fonts/SF_Pro_Text/SF-Pro-Text-Medium.otf'
font_regular = '/home/vitaliy/.local/share/fonts/SF_Pro_Text/SF-Pro-Text-Regular.otf'
font_semibold = '/home/vitaliy/.local/share/fonts/SF_Pro_Text/SF-Pro-Text-Semibold.otf'
font_bold = '/home/vitaliy/.local/share/fonts/SF_Pro_Display/SF-Pro-Display-Bold.otf'

f_label = ImageFont.truetype(font_display, int(round(15 * S)))
f_continue = ImageFont.truetype(font_text, int(round(12.5 * S)))
f_power = ImageFont.truetype(font_regular, int(round(12.5 * S)))
f_time = ImageFont.truetype(font_text, int(round(13.5 * S)))
f_abc = ImageFont.truetype(font_semibold, int(round(12.5 * S)))

# 1. Base clean assets
disk_clean = Image.open('/tmp/disk_clean.png').convert('RGBA').resize((210 * S, 165 * S), Image.Resampling.LANCZOS)
gear_clean = Image.open('/tmp/gear_clean.png').convert('RGBA').resize((210 * S, 165 * S), Image.Resampling.LANCZOS)
p_clean = Image.open('/tmp/p_clean.png').convert('RGBA').resize((90 * S, 60 * S), Image.Resampling.LANCZOS)
r_clean = Image.open('/tmp/r_clean.png').convert('RGBA').resize((90 * S, 60 * S), Image.Resampling.LANCZOS)

# 2. Generate UEFI Chip icon (210*S, 165*S)
def create_uefi_chip_icon():
    uefi_im = Image.new('RGBA', (210 * S, 165 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(uefi_im)

    chip_w, chip_h = 130 * S, 130 * S
    cx, cy = (210 * S) // 2, (165 * S) // 2
    x0, y0 = cx - chip_w // 2, cy - chip_h // 2
    x1, y1 = cx + chip_w // 2, cy + chip_h // 2

    pin_len = 10 * S
    pin_w = 4 * S
    pin_gap = 10 * S

    for px in range(x0 + 16 * S, x1 - 16 * S, pin_gap):
        d.rounded_rectangle([px, y0 - pin_len, px + pin_w, y0], radius=1 * S, fill=(185, 185, 190, 255))
        d.rounded_rectangle([px, y1, px + pin_w, y1 + pin_len], radius=1 * S, fill=(185, 185, 190, 255))

    for py in range(y0 + 16 * S, y1 - 16 * S, pin_gap):
        d.rounded_rectangle([x0 - pin_len, py, x0, py + pin_w], radius=1 * S, fill=(185, 185, 190, 255))
        d.rounded_rectangle([x1, py, x1 + pin_len, py + pin_w], radius=1 * S, fill=(185, 185, 190, 255))

    d.rounded_rectangle([x0, y0, x1, y1], radius=16 * S, fill=(24, 24, 27, 255), outline=(90, 90, 96, 255), width=2 * S)
    d.rounded_rectangle([x0 + 4 * S, y0 + 4 * S, x1 - 4 * S, y1 - 4 * S], radius=12 * S, fill=(30, 30, 34, 255), outline=(60, 60, 65, 255), width=1 * S)

    d.ellipse([x0 + 12 * S, y0 + 12 * S, x0 + 18 * S, y0 + 18 * S], fill=(120, 120, 128, 255))

    f_u = ImageFont.truetype(font_bold, 26 * S)
    f_s = ImageFont.truetype(font_text, 11 * S)

    d.line([cx - 36 * S, cy - 24 * S, cx + 36 * S, cy - 24 * S], fill=(140, 140, 148, 180), width=1 * S)
    d.line([cx - 36 * S, cy + 24 * S, cx + 36 * S, cy + 24 * S], fill=(140, 140, 148, 180), width=1 * S)

    d.text((cx, cy - 8 * S), 'UEFI', font=f_u, fill=(245, 245, 250, 255), anchor='mm')
    d.text((cx, cy + 14 * S), 'FIRMWARE', font=f_s, fill=(160, 160, 168, 255), anchor='mm')
    return uefi_im

uefi_clean = create_uefi_chip_icon()

# 3. Generate macOS External USB Drive icon (210*S, 165*S)
def create_usb_drive_icon():
    raw_disk = Image.open('/tmp/disk_clean.png').convert('RGBA')
    w, h = raw_disk.size
    usb_im = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    for y in range(h):
        for x in range(w):
            r, g, b, a = raw_disk.getpixel((x, y))
            lum = (r + g + b) // 3
            if lum > 15:
                factor = lum / 255.0
                or_r = int(min(255, round(255 * factor)))
                or_g = int(min(255, round(145 * factor + 15 * factor**2)))
                or_b = int(min(255, round(25 * factor)))
                usb_im.putpixel((x, y), (or_r, or_g, or_b, 255))
            else:
                usb_im.putpixel((x, y), (0, 0, 0, 0))

    d = ImageDraw.Draw(usb_im)
    cx, cy = w // 2, h // 2 - 8

    stem_top = cy - 20
    stem_bot = cy + 18
    d.line([cx, stem_top, cx, stem_bot], fill=(255, 255, 255, 230), width=3)
    d.ellipse([cx - 4, stem_bot - 1, cx + 4, stem_bot + 7], fill=(255, 255, 255, 230))
    d.polygon([(cx, stem_top - 7), (cx - 6, stem_top), (cx + 6, stem_top)], fill=(255, 255, 255, 230))

    d.arc([cx - 16, cy - 8, cx, cy + 8], start=90, end=180, fill=(255, 255, 255, 230), width=3)
    d.line([cx - 16, cy - 8, cx - 16, cy - 14], fill=(255, 255, 255, 230), width=3)
    d.rounded_rectangle([cx - 19, cy - 20, cx - 13, cy - 14], radius=1, fill=(255, 255, 255, 230))

    d.arc([cx, cy - 8, cx + 16, cy + 8], start=0, end=90, fill=(255, 255, 255, 230), width=3)
    d.line([cx + 16, cy - 8, cx + 16, cy - 14], fill=(255, 255, 255, 230), width=3)
    d.ellipse([cx + 13, cy - 20, cx + 19, cy - 14], fill=(255, 255, 255, 230))

    return usb_im.resize((210 * S, 165 * S), Image.Resampling.LANCZOS)

usb_clean = create_usb_drive_icon()

# 4. Status Bar Widgets
def make_battery_icon():
    bw = int(round(26 * S))
    bh = int(round(13 * S))
    bat = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(bat)
    d.rounded_rectangle([0, 0, bw - 4 * S, bh - 1], radius=3 * S, outline=(230, 230, 235, 220), width=max(1, int(round(1.5 * S))))
    d.rounded_rectangle([bw - 3 * S, bh // 2 - 2 * S, bw - 1, bh // 2 + 2 * S], radius=1 * S, fill=(230, 230, 235, 220))
    fill_w = int(round((bw - 8 * S) * 0.85))
    d.rounded_rectangle([2 * S, 2 * S, 2 * S + fill_w, bh - 1 - 2 * S], radius=2 * S, fill=(230, 230, 235, 240))
    return bat

bat_im = make_battery_icon()

def make_continue_btn():
    bw = int(round(100 * S))
    bh = int(round(26 * S))
    btn = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(btn)
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=bh // 2, fill=(245, 245, 247, 255))
    text = 'Continue'
    bbox = bd.textbbox((0, 0), text, font=f_continue)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    bd.text(((bw - tw) // 2, (bh - th) // 2 - int(round(2 * S))), text, font=f_continue, fill=(20, 20, 20, 255))
    return btn

btn_continue = make_continue_btn()

card_w = int(round(175 * S))
card_h = int(round(168 * S))
center_y = 470 * S

def draw_selection_card(im, cx, cy):
    card_im = Image.new('RGBA', (card_w, card_h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card_im)
    radius = int(round(24 * S))
    cd.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=(28, 28, 30, 230), outline=(85, 85, 90, 255), width=int(round(2 * S)))
    im.paste(card_im, (cx - card_w // 2, cy - card_h // 2), card_im)

def draw_top_bar(im, d):
    top_y_center = int(round(24 * S))
    margin_right = int(round(24 * S))
    gap_items = int(round(16 * S))

    now_str = datetime.datetime.now().strftime('%H:%M')
    time_box = d.textbbox((0, 0), now_str, font=f_time)
    time_tw = time_box[2] - time_box[0]
    time_th = time_box[3] - time_box[1]
    time_x = SW - margin_right - time_tw
    time_y = top_y_center - time_th // 2 - int(round(2 * S))
    d.text((time_x, time_y), now_str, font=f_time, fill=(230, 230, 235))

    bat_x = time_x - gap_items - bat_im.width
    bat_y = top_y_center - bat_im.height // 2
    im.paste(bat_im, (bat_x, bat_y), bat_im)

    abc_text = 'ABC'
    abc_box = d.textbbox((0, 0), abc_text, font=f_abc)
    abc_tw = abc_box[2] - abc_box[0]
    abc_th = abc_box[3] - abc_box[1]
    key_w = int(round(16 * S))
    key_h = int(round(12 * S))
    gap_abc_key = int(round(5 * S))
    abc_total_w = abc_tw + gap_abc_key + key_w

    abc_x = bat_x - gap_items - abc_total_w
    abc_y = top_y_center - abc_th // 2 - int(round(2 * S))
    d.text((abc_x, abc_y), abc_text, font=f_abc, fill=(230, 230, 235))

    kx = abc_x + abc_tw + gap_abc_key
    ky = top_y_center - key_h // 2
    d.rounded_rectangle([kx, ky, kx + key_w, ky + key_h], radius=int(round(3 * S)), outline=(180, 180, 185), width=max(1, int(round(1.5 * S))))
    d.line([kx + int(round(3.5 * S)), ky + int(round(7.5 * S)), kx + key_w - int(round(3.5 * S)), ky + int(round(7.5 * S))], fill=(180, 180, 185), width=max(1, int(round(1.5 * S))))

def draw_bottom_power(im, d, selected):
    bot_y = SH - int(round((110 * 0.75 + 10) * S))
    sd_x = (960 - 75) * S
    im.paste(p_clean, (sd_x - p_clean.width // 2, bot_y), p_clean)
    sd_box = d.textbbox((0, 0), 'Shut Down', font=f_power)
    d.text((sd_x - (sd_box[2] - sd_box[0]) // 2, bot_y + p_clean.height + int(round(6 * S))), 'Shut Down', font=f_power, fill=(255, 255, 255) if selected == 'shutdown' else (215, 215, 220))

    rst_x = (960 + 75) * S
    im.paste(r_clean, (rst_x - r_clean.width // 2, bot_y), r_clean)
    rst_box = d.textbbox((0, 0), 'Restart', font=f_power)
    d.text((rst_x - (rst_box[2] - rst_box[0]) // 2, bot_y + r_clean.height + int(round(6 * S))), 'Restart', font=f_power, fill=(255, 255, 255) if selected == 'restart' else (215, 215, 220))

    if selected == 'shutdown':
        box_pad = int(round(8 * S))
        d.rounded_rectangle([sd_x - (sd_box[2] - sd_box[0]) // 2 - box_pad, bot_y - box_pad, sd_x + (sd_box[2] - sd_box[0]) // 2 + box_pad, bot_y + p_clean.height + (sd_box[3] - sd_box[1]) + box_pad * 2], radius=int(round(8 * S)), outline=(120, 120, 130), width=int(round(2 * S)))
    elif selected == 'restart':
        box_pad = int(round(8 * S))
        d.rounded_rectangle([rst_x - (rst_box[2] - rst_box[0]) // 2 - box_pad, bot_y - box_pad, rst_x + (rst_box[2] - rst_box[0]) // 2 + box_pad, bot_y + r_clean.height + (rst_box[3] - rst_box[1]) + box_pad * 2], radius=int(round(8 * S)), outline=(120, 120, 130), width=int(round(2 * S)))

def render_3item_screen(selected, os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, selected)

    items = [
        ('os', os_name, disk_clean, 740 * S),
        ('uefi', 'UEFI Settings', uefi_clean, 960 * S),
        ('options', 'Options', gear_clean, 1180 * S),
    ]

    item_y = center_y - int(round(25 * 0.75 * S))

    for key, label, icon, cx in items:
        is_sel = (selected == key)
        if is_sel:
            draw_selection_card(im, cx, center_y)
            btn_y = center_y + card_h // 2 + int(round(12 * S))
            im.paste(btn_continue, (cx - btn_continue.width // 2, btn_y), btn_continue)

        im.paste(icon, (cx - icon.width // 2, item_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, item_y + icon.height // 2 + int(round(10 * S))), label, font=f_label, fill=(255, 255, 255) if is_sel else (210, 210, 215))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def render_4item_screen(selected, os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, selected)

    items = [
        ('usb', 'EFI Boot', usb_clean, 630 * S),
        ('os', os_name, disk_clean, 850 * S),
        ('uefi', 'UEFI Settings', uefi_clean, 1070 * S),
        ('options', 'Options', gear_clean, 1290 * S),
    ]

    item_y = center_y - int(round(25 * 0.75 * S))

    for key, label, icon, cx in items:
        is_sel = (selected == key)
        if is_sel:
            draw_selection_card(im, cx, center_y)
            btn_y = center_y + card_h // 2 + int(round(12 * S))
            im.paste(btn_continue, (cx - btn_continue.width // 2, btn_y), btn_continue)

        im.paste(icon, (cx - icon.width // 2, item_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, item_y + icon.height // 2 + int(round(10 * S))), label, font=f_label, fill=(255, 255, 255) if is_sel else (210, 210, 215))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def render_transition_frame(progress, os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, None)

    item_y = center_y - int(round(25 * 0.75 * S))
    shift = int(round(110 * progress))

    items = [
        (os_name, disk_clean, (740 + shift) * S),
        ('UEFI Settings', uefi_clean, (960 + shift) * S),
        ('Options', gear_clean, (1180 + shift) * S),
    ]
    for label, icon, cx in items:
        im.paste(icon, (cx - icon.width // 2, item_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, item_y + icon.height // 2 + int(round(10 * S))), label, font=f_label, fill=(210, 210, 215))

    if progress > 0.05:
        usb_cx = int(round((520 + 110 * progress) * S))
        alpha = int(round(255 * (progress ** 0.8)))
        usb_trans = usb_clean.copy()
        r_ch, g_ch, b_ch, a_ch = usb_trans.split()
        a_ch = a_ch.point(lambda p: int(p * alpha / 255))
        usb_trans.putalpha(a_ch)
        im.paste(usb_trans, (usb_cx - usb_trans.width // 2, item_y - usb_trans.height // 2), usb_trans)

        lbl = 'EFI Boot'
        bbox = d.textbbox((0, 0), lbl, font=f_label)
        d.text((usb_cx - (bbox[2] - bbox[0]) // 2, item_y + usb_clean.height // 2 + int(round(10 * S))), lbl, font=f_label, fill=(210, 210, 215, alpha))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def main():
    print("Generating macOS Apple Silicon GRUB theme assets...")

    # Output directories
    base_dirs = [
        '/boot/grub/themes/apple-mac',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac'
    ]
    usb_dirs = [
        '/boot/grub/themes/apple-mac-usb',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac-usb'
    ]

    for b in base_dirs:
        os.makedirs(f'{b}/icons', exist_ok=True)
        os.makedirs(f'{b}/anim', exist_ok=True)
    for u in usb_dirs:
        os.makedirs(f'{u}/icons', exist_ok=True)

    # 1. 3-card layout screens (Standard without USB)
    print("1. Rendering 3-card layout screens...")
    s3_ubuntu = render_3item_screen('os', 'Ubuntu')
    s3_uefi = render_3item_screen('uefi')
    s3_options = render_3item_screen('options')
    s3_shutdown = render_3item_screen('shutdown')
    s3_restart = render_3item_screen('restart')
    s3_neutral = render_3item_screen(None)

    for b in base_dirs:
        icons_dir = f'{b}/icons'
        s3_ubuntu.save(f'{icons_dir}/ubuntu.png')
        s3_ubuntu.save(f'{icons_dir}/gnu-linux.png')
        s3_ubuntu.save(f'{icons_dir}/linux.png')

        s3_uefi.save(f'{icons_dir}/uefi-firmware.png')
        s3_uefi.save(f'{icons_dir}/uefi.png')
        s3_uefi.save(f'{icons_dir}/efi.png')

        s3_options.save(f'{icons_dir}/options.png')
        s3_options.save(f'{icons_dir}/recovery.png')
        s3_options.save(f'{icons_dir}/safe-mode.png')

        s3_shutdown.save(f'{icons_dir}/shutdown.png')
        s3_shutdown.save(f'{icons_dir}/poweroff.png')
        s3_shutdown.save(f'{icons_dir}/halt.png')

        s3_restart.save(f'{icons_dir}/restart.png')
        s3_restart.save(f'{icons_dir}/reboot.png')

        s3_neutral.save(f'{icons_dir}/rescan.png')

    # 2. 5 Animation Frames
    print("2. Rendering slide animation frames...")
    frames = [
        render_transition_frame(0.2),
        render_transition_frame(0.4),
        render_transition_frame(0.6),
        render_transition_frame(0.8),
        render_transition_frame(1.0)
    ]
    for b in base_dirs:
        for idx, f in enumerate(frames):
            f.save(f'{b}/anim/frame{idx + 1}.png')

    # 3. 4-card layout screens (With USB drive)
    print("3. Rendering 4-card layout screens (USB connected)...")
    s4_usb = render_4item_screen('usb')
    s4_ubuntu = render_4item_screen('os', 'Ubuntu')
    s4_uefi = render_4item_screen('uefi')
    s4_options = render_4item_screen('options')
    s4_shutdown = render_4item_screen('shutdown')
    s4_restart = render_4item_screen('restart')
    s4_neutral = render_4item_screen(None)

    for u in usb_dirs:
        icons_dir = f'{u}/icons'
        s4_usb.save(f'{icons_dir}/usb.png')
        s4_usb.save(f'{icons_dir}/external.png')
        s4_usb.save(f'{icons_dir}/drive.png')

        s4_ubuntu.save(f'{icons_dir}/ubuntu.png')
        s4_ubuntu.save(f'{icons_dir}/gnu-linux.png')
        s4_ubuntu.save(f'{icons_dir}/linux.png')

        s4_uefi.save(f'{icons_dir}/uefi-firmware.png')
        s4_uefi.save(f'{icons_dir}/uefi.png')
        s4_uefi.save(f'{icons_dir}/efi.png')

        s4_options.save(f'{icons_dir}/options.png')
        s4_options.save(f'{icons_dir}/recovery.png')
        s4_options.save(f'{icons_dir}/safe-mode.png')

        s4_shutdown.save(f'{icons_dir}/shutdown.png')
        s4_shutdown.save(f'{icons_dir}/poweroff.png')
        s4_shutdown.save(f'{icons_dir}/halt.png')

        s4_restart.save(f'{icons_dir}/restart.png')
        s4_restart.save(f'{icons_dir}/reboot.png')

        s4_neutral.save(f'{icons_dir}/rescan.png')

    print("All theme assets generated successfully!")

if __name__ == '__main__':
    main()
