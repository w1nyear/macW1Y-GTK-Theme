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

# 1. Base clean assets from permanent directory
assets_dir = '/home/vitaliy/MACTHEMEFILES/grub/assets'
disk_raw = Image.open(f'{assets_dir}/disk.png').convert('RGBA')
gear_raw = Image.open(f'{assets_dir}/gear.png').convert('RGBA')
p_raw = Image.open(f'{assets_dir}/power.png').convert('RGBA')
r_raw = Image.open(f'{assets_dir}/restart.png').convert('RGBA')

# Target scaling: icons aligned "під лінійку"
# Disk height ~80px in 1x space (160px in 2x space)
scale_d = (80 * S) / disk_raw.height
disk_clean = disk_raw.resize((int(round(disk_raw.width * scale_d)), int(round(disk_raw.height * scale_d))), Image.Resampling.LANCZOS)

scale_g = (76 * S) / gear_raw.height
gear_clean = gear_raw.resize((int(round(gear_raw.width * scale_g)), int(round(gear_raw.height * scale_g))), Image.Resampling.LANCZOS)

scale_p = (27 * S) / p_raw.height
p_clean = p_raw.resize((int(round(p_raw.width * scale_p)), int(round(p_raw.height * scale_p))), Image.Resampling.LANCZOS)
r_clean = r_raw.resize((int(round(r_raw.width * scale_p)), int(round(r_raw.height * scale_p))), Image.Resampling.LANCZOS)

# 2. Generate UEFI Chip icon aligned "під лінійку" with disk and gear
def create_uefi_chip_icon():
    total_w = 80 * S
    total_h = 80 * S
    uefi_im = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(uefi_im)

    chip_w, chip_h = 66 * S, 66 * S
    cx, cy = total_w // 2, total_h // 2
    x0, y0 = cx - chip_w // 2, cy - chip_h // 2
    x1, y1 = cx + chip_w // 2, cy + chip_h // 2

    pin_len = 6 * S
    pin_w = 2.5 * S
    pin_gap = 5.5 * S

    # Horizontal pins (top and bottom)
    px = x0 + 8 * S
    while px <= x1 - 8 * S:
        d.rounded_rectangle([px, y0 - pin_len, px + pin_w, y0], radius=1 * S, fill=(185, 185, 190, 255))
        d.rounded_rectangle([px, y1, px + pin_w, y1 + pin_len], radius=1 * S, fill=(185, 185, 190, 255))
        px += pin_gap

    # Vertical pins (left and right)
    py = y0 + 8 * S
    while py <= y1 - 8 * S:
        d.rounded_rectangle([x0 - pin_len, py, x0, py + pin_w], radius=1 * S, fill=(185, 185, 190, 255))
        d.rounded_rectangle([x1, py, x1 + pin_len, py + pin_w], radius=1 * S, fill=(185, 185, 190, 255))
        py += pin_gap

    # Outer chip body
    d.rounded_rectangle([x0, y0, x1, y1], radius=8 * S, fill=(24, 24, 27, 255), outline=(90, 90, 96, 255), width=int(round(1.5 * S)))
    # Inner bevel
    d.rounded_rectangle([x0 + 2.5 * S, y0 + 2.5 * S, x1 - 2.5 * S, y1 - 2.5 * S], radius=6 * S, fill=(30, 30, 34, 255), outline=(60, 60, 65, 255), width=1 * S)

    # Pin 1 indicator dot
    d.ellipse([x0 + 6 * S, y0 + 6 * S, x0 + 10 * S, y0 + 10 * S], fill=(120, 120, 128, 255))

    f_u = ImageFont.truetype(font_bold, int(round(13 * S)))
    f_s = ImageFont.truetype(font_text, int(round(6 * S)))

    # Thin accent lines
    d.line([cx - 18 * S, cy - 12 * S, cx + 18 * S, cy - 12 * S], fill=(140, 140, 148, 180), width=1 * S)
    d.line([cx - 18 * S, cy + 12 * S, cx + 18 * S, cy + 12 * S], fill=(140, 140, 148, 180), width=1 * S)

    d.text((cx, cy - 4 * S), 'UEFI', font=f_u, fill=(245, 245, 250, 255), anchor='mm')
    d.text((cx, cy + 7 * S), 'FIRMWARE', font=f_s, fill=(160, 160, 168, 255), anchor='mm')
    return uefi_im

uefi_clean = create_uefi_chip_icon()

# 3. Generate macOS External USB Drive icon
def create_usb_drive_icon():
    w, h = disk_clean.size
    usb_im = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    for y in range(h):
        for x in range(w):
            r, g, b, a = disk_clean.getpixel((x, y))
            if a > 15:
                lum = (r + g + b) // 3
                factor = lum / 255.0
                or_r = int(min(255, round(255 * factor)))
                or_g = int(min(255, round(145 * factor + 15 * factor**2)))
                or_b = int(min(255, round(25 * factor)))
                usb_im.putpixel((x, y), (or_r, or_g, or_b, a))

    d = ImageDraw.Draw(usb_im)
    cx, cy = w // 2, h // 2 - int(round(4 * S))

    # Draw USB trident symbol
    stem_top = cy - int(round(18 * S))
    stem_bot = cy + int(round(16 * S))
    line_w = max(2, int(round(2.5 * S)))
    d.line([cx, stem_top, cx, stem_bot], fill=(255, 255, 255, 230), width=line_w)
    d.ellipse([cx - int(round(3.5*S)), stem_bot - 1, cx + int(round(3.5*S)), stem_bot + int(round(6*S))], fill=(255, 255, 255, 230))
    d.polygon([(cx, stem_top - int(round(7*S))), (cx - int(round(5*S)), stem_top), (cx + int(round(5*S)), stem_top)], fill=(255, 255, 255, 230))

    # Left branch (rectangle)
    d.arc([cx - int(round(14*S)), cy - int(round(8*S)), cx, cy + int(round(8*S))], start=90, end=180, fill=(255, 255, 255, 230), width=line_w)
    d.line([cx - int(round(14*S)), cy - int(round(8*S)), cx - int(round(14*S)), cy - int(round(14*S))], fill=(255, 255, 255, 230), width=line_w)
    d.rounded_rectangle([cx - int(round(17*S)), cy - int(round(20*S)), cx - int(round(11*S)), cy - int(round(14*S))], radius=1*S, fill=(255, 255, 255, 230))

    # Right branch (circle)
    d.arc([cx, cy - int(round(8*S)), cx + int(round(14*S)), cy + int(round(8*S))], start=0, end=90, fill=(255, 255, 255, 230), width=line_w)
    d.line([cx + int(round(14*S)), cy - int(round(8*S)), cx + int(round(14*S)), cy - int(round(14*S))], fill=(255, 255, 255, 230), width=line_w)
    d.ellipse([cx + int(round(11*S)), cy - int(round(20*S)), cx + int(round(17*S)), cy - int(round(14*S))], fill=(255, 255, 255, 230))
    return usb_im

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

# Card geometry: compact authentic Apple Silicon layout with close icon-label spacing
card_w = int(round(176 * S))
card_h = int(round(176 * S))
center_y = int(round(498 * S))
icon_y = int(round(482 * S))
label_y = int(round(534 * S))

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
    # Raised power buttons: 125*S from bottom
    bot_y = SH - int(round(125 * S))
    sd_x = (960 - 75) * S
    im.paste(p_clean, (sd_x - p_clean.width // 2, bot_y), p_clean)
    sd_box = d.textbbox((0, 0), 'Shut Down', font=f_power)
    d.text((sd_x - (sd_box[2] - sd_box[0]) // 2, bot_y + p_clean.height + int(round(8 * S))), 'Shut Down', font=f_power, fill=(255, 255, 255) if selected == 'shutdown' else (215, 215, 220))

    rst_x = (960 + 75) * S
    im.paste(r_clean, (rst_x - r_clean.width // 2, bot_y), r_clean)
    rst_box = d.textbbox((0, 0), 'Restart', font=f_power)
    d.text((rst_x - (rst_box[2] - rst_box[0]) // 2, bot_y + r_clean.height + int(round(8 * S))), 'Restart', font=f_power, fill=(255, 255, 255) if selected == 'restart' else (215, 215, 220))

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

    for key, label, icon, cx in items:
        is_sel = (selected == key)
        if is_sel:
            draw_selection_card(im, cx, center_y)
            btn_y = center_y + card_h // 2 + int(round(14 * S))
            im.paste(btn_continue, (cx - btn_continue.width // 2, btn_y), btn_continue)

        im.paste(icon, (cx - icon.width // 2, icon_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, label_y), label, font=f_label, fill=(255, 255, 255) if is_sel else (210, 210, 215))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def get_external_boot_labels():
    labels = []
    try:
        import subprocess, json
        res = subprocess.run(['lsblk', '-J', '-o', 'NAME,TYPE,LABEL,MOUNTPOINT,FSTYPE'], capture_output=True, text=True)
        data = json.loads(res.stdout)
        for dev in data.get('blockdevices', []):
            name = dev.get('name', '')
            if name.startswith('nvme') or name.startswith('loop'):
                continue
            for part in dev.get('children', []):
                lbl = part.get('label')
                mount = part.get('mountpoint')
                is_boot = False
                if mount and (os.path.isdir(f'{mount}/EFI') or os.path.isdir(f'{mount}/efi')):
                    is_boot = True
                elif lbl and any(x in lbl.upper() for x in ['VTOYEFI', 'MACOS', 'BOOT', 'EFI']):
                    is_boot = True
                if is_boot and lbl and lbl not in labels:
                    labels.append(lbl)
    except Exception as e:
        print(f"Error detecting labels: {e}")
    
    if len(labels) >= 2:
        return labels[0], labels[1]
    elif len(labels) == 1:
        return labels[0], 'MACOS'
    return 'VTOYEFI', 'MACOS'

def render_4item_screen(selected, ext_name='VTOYEFI', os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, selected)

    items = [
        ('usb', ext_name, usb_clean, 630 * S),
        ('os', os_name, disk_clean, 850 * S),
        ('uefi', 'UEFI Settings', uefi_clean, 1070 * S),
        ('options', 'Options', gear_clean, 1290 * S),
    ]

    for key, label, icon, cx in items:
        is_sel = (selected == key)
        if is_sel:
            draw_selection_card(im, cx, center_y)
            btn_y = center_y + card_h // 2 + int(round(14 * S))
            im.paste(btn_continue, (cx - btn_continue.width // 2, btn_y), btn_continue)

        im.paste(icon, (cx - icon.width // 2, icon_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, label_y), label, font=f_label, fill=(255, 255, 255) if is_sel else (210, 210, 215))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def render_5item_screen(selected, ext1_name='VTOYEFI', ext2_name='MACOS', os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, selected)

    items = [
        ('usb1', ext1_name, usb_clean, 520 * S),
        ('usb2', ext2_name, usb_clean, 740 * S),
        ('os', os_name, disk_clean, 960 * S),
        ('uefi', 'UEFI Settings', uefi_clean, 1180 * S),
        ('options', 'Options', gear_clean, 1400 * S),
    ]

    for key, label, icon, cx in items:
        is_sel = (selected == key)
        if is_sel:
            draw_selection_card(im, cx, center_y)
            btn_y = center_y + card_h // 2 + int(round(14 * S))
            im.paste(btn_continue, (cx - btn_continue.width // 2, btn_y), btn_continue)

        im.paste(icon, (cx - icon.width // 2, icon_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, label_y), label, font=f_label, fill=(255, 255, 255) if is_sel else (210, 210, 215))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def render_transition_frame(progress, ext_name='VTOYEFI', os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    draw_top_bar(im, d)
    draw_bottom_power(im, d, None)

    shift = int(round(110 * progress))

    items = [
        (os_name, disk_clean, (740 + shift) * S),
        ('UEFI Settings', uefi_clean, (960 + shift) * S),
        ('Options', gear_clean, (1180 + shift) * S),
    ]

    for label, icon, cx in items:
        im.paste(icon, (cx - icon.width // 2, icon_y - icon.height // 2), icon)
        bbox = d.textbbox((0, 0), label, font=f_label)
        d.text((cx - (bbox[2] - bbox[0]) // 2, label_y), label, font=f_label, fill=(210, 210, 215))

    if progress > 0.05:
        alpha = int(round(min(255, progress * 255 * 1.2)))
        usb_cx = int(round((630 - 60 * (1.0 - progress)) * S))

        usb_trans = usb_clean.copy()
        r_ch, g_ch, b_ch, a_ch = usb_trans.split()
        a_ch = a_ch.point(lambda p: int(round(p * alpha / 255)))
        usb_trans.putalpha(a_ch)
        im.paste(usb_trans, (usb_cx - usb_trans.width // 2, icon_y - usb_trans.height // 2), usb_trans)

        lbl = ext_name
        bbox = d.textbbox((0, 0), lbl, font=f_label)
        d.text((usb_cx - (bbox[2] - bbox[0]) // 2, label_y), lbl, font=f_label, fill=(210, 210, 215, alpha))

    return im.resize((W, H), Image.Resampling.LANCZOS)

def main():
    print("Generating macOS Apple Silicon GRUB theme assets (lower placement & unclipped gear)...")

    base_dirs = [
        '/boot/grub/themes/apple-mac',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac'
    ]
    usb_dirs = [
        '/boot/grub/themes/apple-mac-usb',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac-usb'
    ]
    usb2_dirs = [
        '/boot/grub/themes/apple-mac-usb2',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac-usb2'
    ]

    for b in base_dirs:
        os.makedirs(f'{b}/icons', exist_ok=True)
        os.makedirs(f'{b}/anim', exist_ok=True)
    for u in usb_dirs:
        os.makedirs(f'{u}/icons', exist_ok=True)
    for u2 in usb2_dirs:
        os.makedirs(f'{u2}/icons', exist_ok=True)

    # 1. 3-card layout screens (Standard without USB)
    print("1. Rendering 3-card layout screens...")
    s3_ubuntu = render_3item_screen('os', 'Ubuntu')
    s3_uefi = render_3item_screen('uefi')
    s3_options = render_3item_screen('options')
    s3_shutdown = render_3item_screen('shutdown')
    s3_restart = render_3item_screen('restart')

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

        # Dummy transparent for rescan
        trans = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        trans.save(f'{icons_dir}/rescan.png')

        # Create transparent 1x1 select_*.png so GRUB never draws default boxes
        trans_1px = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
        trans_1px.save(f'{b}/select_c.png')
        trans_1px.save(f'{b}/select_w.png')
        trans_1px.save(f'{b}/select_e.png')

    ext1_name, ext2_name = get_external_boot_labels()
    print(f"Detected external labels: ext1='{ext1_name}', ext2='{ext2_name}'")

    # 2. 5 Animation Frames
    print("2. Rendering slide animation frames...")
    frames = [
        render_transition_frame(0.2, ext_name=ext1_name),
        render_transition_frame(0.4, ext_name=ext1_name),
        render_transition_frame(0.6, ext_name=ext1_name),
        render_transition_frame(0.8, ext_name=ext1_name),
        render_transition_frame(1.0, ext_name=ext1_name)
    ]
    for b in base_dirs:
        for idx, f in enumerate(frames):
            f.save(f'{b}/anim/frame{idx + 1}.png')

    # 3. 4-card layout screens (With USB drive)
    print(f"3. Rendering 4-card layout screens (USB connected: {ext1_name})...")
    s4_usb = render_4item_screen('usb', ext_name=ext1_name)
    s4_ubuntu = render_4item_screen('os', ext_name=ext1_name, os_name='Ubuntu')
    s4_uefi = render_4item_screen('uefi', ext_name=ext1_name)
    s4_options = render_4item_screen('options', ext_name=ext1_name)
    s4_shutdown = render_4item_screen('shutdown', ext_name=ext1_name)
    s4_restart = render_4item_screen('restart', ext_name=ext1_name)

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

        trans = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        trans.save(f'{icons_dir}/rescan.png')

        trans_1px = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
        trans_1px.save(f'{u}/select_c.png')
        trans_1px.save(f'{u}/select_w.png')
        trans_1px.save(f'{u}/select_e.png')

    # 4. 5-card layout screens (Dual boot choices on external drive)
    print(f"4. Rendering 5-card layout screens (Dual boot: {ext1_name}, {ext2_name})...")
    s5_usb1 = render_5item_screen('usb1', ext1_name=ext1_name, ext2_name=ext2_name)
    s5_usb2 = render_5item_screen('usb2', ext1_name=ext1_name, ext2_name=ext2_name)
    s5_ubuntu = render_5item_screen('os', ext1_name=ext1_name, ext2_name=ext2_name, os_name='Ubuntu')
    s5_uefi = render_5item_screen('uefi', ext1_name=ext1_name, ext2_name=ext2_name)
    s5_options = render_5item_screen('options', ext1_name=ext1_name, ext2_name=ext2_name)
    s5_shutdown = render_5item_screen('shutdown', ext1_name=ext1_name, ext2_name=ext2_name)
    s5_restart = render_5item_screen('restart', ext1_name=ext1_name, ext2_name=ext2_name)

    import shutil
    import glob

    for u2 in usb2_dirs:
        # Copy theme.txt, background.png, and all *.pf2 fonts from apple-mac
        src_dir = '/boot/grub/themes/apple-mac'
        if os.path.exists(f'{src_dir}/theme.txt'):
            shutil.copy2(f'{src_dir}/theme.txt', f'{u2}/theme.txt')
        if os.path.exists(f'{src_dir}/background.png'):
            shutil.copy2(f'{src_dir}/background.png', f'{u2}/background.png')
        for pf2 in glob.glob(f'{src_dir}/*.pf2'):
            shutil.copy2(pf2, u2)

        icons_dir = f'{u2}/icons'
        s5_usb1.save(f'{icons_dir}/usb1.png')
        s5_usb2.save(f'{icons_dir}/usb2.png')

        # Remove ambiguous usb.png in 5-item theme so usb2 never falls back to usb.png
        if os.path.exists(f'{icons_dir}/usb.png'):
            try:
                os.remove(f'{icons_dir}/usb.png')
            except OSError:
                pass

        s5_usb1.save(f'{icons_dir}/external.png')
        s5_usb1.save(f'{icons_dir}/drive.png')

        s5_ubuntu.save(f'{icons_dir}/ubuntu.png')
        s5_ubuntu.save(f'{icons_dir}/gnu-linux.png')
        s5_ubuntu.save(f'{icons_dir}/linux.png')

        s5_uefi.save(f'{icons_dir}/uefi-firmware.png')
        s5_uefi.save(f'{icons_dir}/uefi.png')
        s5_uefi.save(f'{icons_dir}/efi.png')

        s5_options.save(f'{icons_dir}/options.png')
        s5_options.save(f'{icons_dir}/recovery.png')
        s5_options.save(f'{icons_dir}/safe-mode.png')

        s5_shutdown.save(f'{icons_dir}/shutdown.png')
        s5_shutdown.save(f'{icons_dir}/poweroff.png')
        s5_shutdown.save(f'{icons_dir}/halt.png')

        s5_restart.save(f'{icons_dir}/restart.png')
        s5_restart.save(f'{icons_dir}/reboot.png')

        trans = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        trans.save(f'{icons_dir}/rescan.png')

        trans_1px = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
        trans_1px.save(f'{u2}/select_c.png')
        trans_1px.save(f'{u2}/select_w.png')
        trans_1px.save(f'{u2}/select_e.png')

    print("All theme assets generated successfully!")

if __name__ == '__main__':
    main()
