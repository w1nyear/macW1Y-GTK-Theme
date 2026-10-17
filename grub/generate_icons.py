#!/usr/bin/env python3
import os
import sys
import datetime
import subprocess
from collections import deque
from PIL import Image, ImageDraw, ImageFont

crops_dir = '/home/vitaliy/.gemini/antigravity/brain/312b44e9-b044-46b8-aca4-b03b8564e079/grub_crops'
font_dir = '/home/vitaliy/.fonts/ubuntu-mimic-macos/fonts/SF_Pro'
if not os.path.isdir(font_dir):
    font_dir = '/usr/share/fonts/opentype'

# Extract pure transparent RGBA from crops with black background
def extract_transparent_crop(im_path, max_bg_lum=15):
    im = Image.open(im_path).convert('RGBA')
    w, h = im.size
    bg_mask = [[False]*w for _ in range(h)]
    queue = deque([(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)])
    for x, y in queue:
        bg_mask[y][x] = True
        
    while queue:
        cx, cy = queue.popleft()
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and not bg_mask[ny][nx]:
                r, g, b, a = im.getpixel((nx, ny))
                lum = max(r, g, b)
                if lum <= max_bg_lum:
                    bg_mask[ny][nx] = True
                    queue.append((nx, ny))
                    
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            if bg_mask[y][x]:
                out.putpixel((x, y), (0, 0, 0, 0))
            else:
                r, g, b, a = im.getpixel((x, y))
                is_edge = any(0 <= x+dx < w and 0 <= y+dy < h and bg_mask[y+dy][x+dx] for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)])
                lum = max(r, g, b)
                if is_edge and lum < 60:
                    alpha = int(round(lum / 60.0 * 255))
                    factor = 255.0 / max(alpha, 1)
                    out.putpixel((x, y), (min(255, int(r*factor)), min(255, int(g*factor)), min(255, int(b*factor)), alpha))
                else:
                    out.putpixel((x, y), (r, g, b, 255))
    return out

# Prepare cleaned icons without background if crops exist
d_clean = None
o_clean = None
p_clean = None
r_clean = None
if os.path.isdir(crops_dir) and os.path.exists(f'{crops_dir}/disk.png'):
    try:
        d_clean = extract_transparent_crop(f'{crops_dir}/disk.png')
        o_clean = extract_transparent_crop(f'{crops_dir}/options.png')
        p_clean = extract_transparent_crop(f'{crops_dir}/shutdown_icon.png')
        r_clean = extract_transparent_crop(f'{crops_dir}/restart_icon.png')
    except Exception as e:
        print(f"Warning: could not extract crops: {e}")

W, H = 1920, 1080
S = 2 # 2x supersampling (3840x2160 internal canvas downsampled with Lanczos for 4K Retina quality)
SW, SH = W * S, H * S

# Load genuine SF Pro fonts at 2x scale
f_label = ImageFont.truetype(f'{font_dir}/SF-Pro-Display-Medium.otf', int(round(15 * S)))
f_continue = ImageFont.truetype(f'{font_dir}/SF-Pro-Text-Medium.otf', int(round(12.5 * S)))
f_power = ImageFont.truetype(f'{font_dir}/SF-Pro-Text-Regular.otf', int(round(12.5 * S)))
f_time = ImageFont.truetype(f'{font_dir}/SF-Pro-Text-Medium.otf', int(round(13.5 * S)))
f_abc = ImageFont.truetype(f'{font_dir}/SF-Pro-Text-Semibold.otf', int(round(12.5 * S)))

# Target scaling for icons
scale = 1.85 * 0.75 * S
if d_clean:
    disk_scaled = d_clean.resize((int(round(d_clean.width * scale)), int(round(d_clean.height * scale))), Image.Resampling.LANCZOS)
    opt_scaled = o_clean.resize((int(round(o_clean.width * scale)), int(round(o_clean.height * scale))), Image.Resampling.LANCZOS)
    p_scaled = p_clean.resize((int(round(p_clean.width * scale)), int(round(p_clean.height * scale))), Image.Resampling.LANCZOS)
    r_scaled = r_clean.resize((int(round(r_clean.width * scale)), int(round(r_clean.height * scale))), Image.Resampling.LANCZOS)
else:
    disk_scaled, opt_scaled, p_scaled, r_scaled = None, None, None, None

# Render horizontal battery icon from Ubuntu Yaru theme
def get_battery_icon():
    cap = 100
    try:
        bat_dirs = [d for d in os.listdir('/sys/class/power_supply') if d.startswith('BAT')]
        if bat_dirs:
            with open(f'/sys/class/power_supply/{bat_dirs[0]}/capacity') as f:
                cap = int(f.read().strip())
    except Exception:
        pass
    
    try:
        level = min(100, max(0, int(round(cap / 10.0) * 10)))
        svg_path = f'/usr/share/icons/Yaru/scalable/status/battery-level-{level}-symbolic.svg'
        if not os.path.exists(svg_path):
            svg_path = f'/usr/share/icons/Adwaita/symbolic/status/battery-level-{level}-symbolic.svg'
            
        tmp_png = '/tmp/bat_grub_square.png'
        bw, bh = int(round(22 * S)), int(round(22 * S))
        res = subprocess.run(['rsvg-convert', '-w', str(bw), '-h', str(bh), svg_path, '-o', tmp_png], capture_output=True)
        if res.returncode == 0 and os.path.exists(tmp_png):
            raw = Image.open(tmp_png).convert('RGBA')
            alpha = raw.split()[3]
            white_bat = Image.new('RGBA', raw.size, (230, 230, 235, 255))
            white_bat.putalpha(alpha)
            # Rotate 90 deg clockwise to orient horizontally with terminal on the right
            rot = white_bat.transpose(Image.Transpose.ROTATE_270)
            bbox = rot.getbbox()
            return rot.crop(bbox)
    except Exception:
        pass
    return None

bat_im = get_battery_icon()

# Vector Continue button pill
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

# Card geometry
card_w = int(round(126 * 1.85 * 0.75 * S))
card_h = int(round(121 * 1.85 * 0.75 * S))
cx1 = (W // 2 - int(round(140 * 0.75))) * S
cx2 = (W // 2 + int(round(140 * 0.75))) * S
center_y = 470 * S

def draw_selection_card(im, cx, cy):
    card_im = Image.new('RGBA', (card_w, card_h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card_im)
    radius = int(round(24 * S))
    cd.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=(28, 28, 30, 230), outline=(85, 85, 90, 255), width=int(round(2 * S)))
    im.paste(card_im, (cx - card_w // 2, cy - card_h // 2), card_im)

def create_screen(selected, os_name='Ubuntu'):
    im = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)

    # 1. Top Right Status Bar (ABC, Battery, Time)
    top_y_center = int(round(24 * S))
    margin_right = int(round(24 * S))
    gap_items = int(round(16 * S))

    # Rightmost: Time in SF Pro
    now_str = datetime.datetime.now().strftime('%H:%M')
    time_box = d.textbbox((0, 0), now_str, font=f_time)
    time_tw = time_box[2] - time_box[0]
    time_th = time_box[3] - time_box[1]
    time_x = SW - margin_right - time_tw
    time_y = top_y_center - time_th // 2 - int(round(2 * S))
    d.text((time_x, time_y), now_str, font=f_time, fill=(230, 230, 235))

    # Middle: Battery icon to the left of Time
    bat_x = time_x - gap_items - bat_im.width
    bat_y = top_y_center - bat_im.height // 2
    im.paste(bat_im, (bat_x, bat_y), bat_im)

    # Left: ABC keyboard badge to the left of Battery
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

    # 2. Left OS Disk
    disk_y = center_y - int(round(25 * 0.75 * S))
    if selected == 'os':
        draw_selection_card(im, cx1, center_y)
        btn_y = center_y + card_h // 2 + int(round(12 * S))
        im.paste(btn_continue, (cx1 - btn_continue.width // 2, btn_y), btn_continue)

    im.paste(disk_scaled, (cx1 - disk_scaled.width // 2, disk_y - disk_scaled.height // 2), disk_scaled)
    bbox1 = d.textbbox((0, 0), os_name, font=f_label)
    d.text((cx1 - (bbox1[2] - bbox1[0]) // 2, disk_y + disk_scaled.height // 2 + int(round(10 * S))), os_name, font=f_label, fill=(255, 255, 255) if selected == 'os' else (210, 210, 215))

    # 3. Right Options Gear
    opt_y = center_y - int(round(25 * 0.75 * S))
    if selected == 'options':
        draw_selection_card(im, cx2, center_y)
        btn_y = center_y + card_h // 2 + int(round(12 * S))
        im.paste(btn_continue, (cx2 - btn_continue.width // 2, btn_y), btn_continue)

    im.paste(opt_scaled, (cx2 - opt_scaled.width // 2, opt_y - opt_scaled.height // 2), opt_scaled)
    bbox2 = d.textbbox((0, 0), 'Options', font=f_label)
    d.text((cx2 - (bbox2[2] - bbox2[0]) // 2, opt_y + opt_scaled.height // 2 + int(round(12 * S))), 'Options', font=f_label, fill=(255, 255, 255) if selected == 'options' else (210, 210, 215))

    # 4. Bottom Power Buttons (Shut Down & Restart)
    bot_y = SH - int(round((110 * 0.75 + 10) * S))
    sd_x = (W // 2 - int(round(65 * 0.75 + 15))) * S
    im.paste(p_scaled, (sd_x - p_scaled.width // 2, bot_y), p_scaled)
    sd_box = d.textbbox((0, 0), 'Shut Down', font=f_power)
    d.text((sd_x - (sd_box[2] - sd_box[0]) // 2, bot_y + p_scaled.height + int(round(6 * S))), 'Shut Down', font=f_power, fill=(255, 255, 255) if selected == 'shutdown' else (215, 215, 220))

    rst_x = (W // 2 + int(round(65 * 0.75 + 15))) * S
    im.paste(r_scaled, (rst_x - r_scaled.width // 2, bot_y), r_scaled)
    rst_box = d.textbbox((0, 0), 'Restart', font=f_power)
    d.text((rst_x - (rst_box[2] - rst_box[0]) // 2, bot_y + r_scaled.height + int(round(6 * S))), 'Restart', font=f_power, fill=(255, 255, 255) if selected == 'restart' else (215, 215, 220))

    if selected == 'shutdown':
        box_pad = int(round(8 * S))
        d.rounded_rectangle([sd_x - (sd_box[2] - sd_box[0]) // 2 - box_pad, bot_y - box_pad, sd_x + (sd_box[2] - sd_box[0]) // 2 + box_pad, bot_y + p_scaled.height + (sd_box[3] - sd_box[1]) + box_pad * 2], radius=int(round(8 * S)), outline=(120, 120, 130), width=int(round(2 * S)))
    elif selected == 'restart':
        box_pad = int(round(8 * S))
        d.rounded_rectangle([rst_x - (rst_box[2] - rst_box[0]) // 2 - box_pad, bot_y - box_pad, rst_x + (rst_box[2] - rst_box[0]) // 2 + box_pad, bot_y + r_scaled.height + (rst_box[3] - rst_box[1]) + box_pad * 2], radius=int(round(8 * S)), outline=(120, 120, 130), width=int(round(2 * S)))

    # Downsample from 2x (3840x2160) to 1920x1080 with Lanczos for razor-sharp Retina/4K text
    return im.resize((W, H), Image.Resampling.LANCZOS)

def main():
    target_dirs = [
        '/boot/grub/themes/apple-mac/icons',
        '/home/vitaliy/MACTHEMEFILES/grub/apple-mac/icons'
    ]

    for d in target_dirs:
        os.makedirs(d, exist_ok=True)
        print(f'Generating icons into {d}...')
        # OS screens
        screen_ubuntu = create_screen('os', 'Ubuntu')
        screen_ubuntu.save(f'{d}/ubuntu.png')
        screen_ubuntu.save(f'{d}/gnu-linux.png')
        screen_ubuntu.save(f'{d}/linux.png')

        create_screen('os', 'Windows').save(f'{d}/windows.png')
        create_screen('os', 'Arch Linux').save(f'{d}/arch.png')
        create_screen('os', 'Arch Linux').save(f'{d}/archlinux.png')
        create_screen('os', 'Debian').save(f'{d}/debian.png')
        create_screen('os', 'Fedora').save(f'{d}/fedora.png')
        create_screen('os', 'Linux Mint').save(f'{d}/linuxmint.png')
        create_screen('os', 'macOS').save(f'{d}/macos.png')
        create_screen('os', 'macOS').save(f'{d}/macosx.png')
        create_screen('os', 'macOS').save(f'{d}/osx.png')
        create_screen('os', 'macOS').save(f'{d}/darwin.png')
        create_screen('os', 'Pop!_OS').save(f'{d}/pop-os.png')
        create_screen('os', 'Manjaro').save(f'{d}/manjaro.png')

        # Special screens
        screen_options = create_screen('options')
        screen_options.save(f'{d}/recovery.png')
        screen_options.save(f'{d}/options.png')
        screen_options.save(f'{d}/safe-mode.png')
        screen_options.save(f'{d}/uefi-firmware.png')
        screen_options.save(f'{d}/efi.png')
        screen_options.save(f'{d}/terminal.png')

        screen_restart = create_screen('restart')
        screen_restart.save(f'{d}/restart.png')
        screen_restart.save(f'{d}/reboot.png')

        screen_shutdown = create_screen('shutdown')
        screen_shutdown.save(f'{d}/shutdown.png')
        screen_shutdown.save(f'{d}/poweroff.png')
        screen_shutdown.save(f'{d}/halt.png')

    # Also update background.png to clean pitch black
    bg = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    bg.save('/boot/grub/themes/apple-mac/background.png')
    bg.save('/home/vitaliy/MACTHEMEFILES/grub/apple-mac/background.png')

    print('All GRUB icons and background generated successfully with 4K SSAA!')

if __name__ == '__main__':
    if d_clean is None:
        print("Note: grub crops not found, keeping existing high-res icons.")
        sys.exit(0)
    main()
