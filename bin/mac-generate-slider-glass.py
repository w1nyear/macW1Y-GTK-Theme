#!/usr/bin/env python3
import os
import sys

PALETTES = {
    "orange": {
        "primary": "#ff6a00",
        "light": "#ff8526",
        "soft": "#ffa759",
    },
    "blue": {
        "primary": "#0c8eff",
        "light": "#38a8ff",
        "soft": "#70c4ff",
    },
    "teal": {
        "primary": "#2190a4",
        "light": "#33aabf",
        "soft": "#63c5d6",
    },
    "green": {
        "primary": "#2ec27e",
        "light": "#57e389",
        "soft": "#8ff0a4",
    },
    "yellow": {
        "primary": "#e5a50a",
        "light": "#f5c211",
        "soft": "#f8e45c",
    },
    "red": {
        "primary": "#e01b24",
        "light": "#ed333b",
        "soft": "#f66151",
    },
    "pink": {
        "primary": "#d56199",
        "light": "#dc8add",
        "soft": "#e5a3e6",
    },
    "purple": {
        "primary": "#9141ac",
        "light": "#ab62c0",
        "soft": "#c084d3",
    },
    "slate": {
        "primary": "#6f8396",
        "light": "#8a9cb0",
        "soft": "#b0becb",
    },
}

def generate_slider_glass_h(palette):
    p = palette["primary"]
    l = palette["light"]
    s = palette["soft"]
    return f"""<svg width="84" height="56" viewBox="0 0 84 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Liquid glass body: crystal clear refractive depth, no top spotlight -->
    <linearGradient id="glassBody" x1="42" y1="2" x2="42" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="70%" stop-color="#0a0e17" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#050810" stop-opacity="0.38"/>
    </linearGradient>

    <!-- Outer rim stroke: delicate uniform glass edge -->
    <linearGradient id="edgeStroke" x1="42" y1="2" x2="42" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.35"/>
    </linearGradient>

    <!-- Inner rim highlight: delicate perimeter reflection -->
    <linearGradient id="innerRim" x1="42" y1="2" x2="42" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="75%" stop-color="#000000" stop-opacity="0.0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
    </linearGradient>

    <!-- Left side optical refraction: stretches accent track vertically at the boundary -->
    <linearGradient id="leftVerticalStretch" x1="5" y1="18" x2="5" y2="38" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{s}" stop-opacity="0.0"/>
      <stop offset="15%" stop-color="{l}" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="{p}" stop-opacity="0.98"/>
      <stop offset="85%" stop-color="{l}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="{s}" stop-opacity="0.0"/>
    </linearGradient>

    <linearGradient id="leftRefractBlue" x1="3" y1="28" x2="15" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{l}" stop-opacity="0.95"/>
      <stop offset="40%" stop-color="{p}" stop-opacity="0.85"/>
      <stop offset="75%" stop-color="{p}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="{p}" stop-opacity="0.0"/>
    </linearGradient>

    <!-- Middle Accent Track Line -->
    <linearGradient id="trackBlueLine" x1="14" y1="28" x2="42" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{p}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="{p}" stop-opacity="0.98"/>
    </linearGradient>

    <!-- Middle White Track Line -->
    <linearGradient id="trackWhiteLine" x1="42" y1="28" x2="70" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.92"/>
    </linearGradient>

    <!-- Right side optical refraction: stretches white track vertically at the boundary -->
    <linearGradient id="rightVerticalStretch" x1="79" y1="18" x2="79" y2="38" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.0"/>
      <stop offset="15%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="85%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
    </linearGradient>

    <linearGradient id="rightRefractWhite" x1="81" y1="28" x2="69" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="40%" stop-color="#f4f8ff" stop-opacity="0.90"/>
      <stop offset="75%" stop-color="#e8f0fe" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e8f0fe" stop-opacity="0.0"/>
    </linearGradient>

    <!-- 0.2px subtle blur filter for natural optical refraction diffusion -->
    <filter id="opticalBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.5"/>
    </filter>
  </defs>

  <!-- 1. Soft depth shadow -->
  <rect x="2" y="3" width="80" height="50" rx="25" fill="#000000" fill-opacity="0.25"/>

  <!-- 2. Glass body (clean, NO spotlight on top!) -->
  <rect x="2" y="2" width="80" height="52" rx="26" fill="url(#glassBody)"/>

  <!-- 3. Optical Refraction Track with 0.2px blur (whiskers removed!) -->
  <g filter="url(#opticalBlur)">
    <!-- Left Side Refraction: stretches accent track vertically at the boundary (y=18 to y=38) -->
    <path d="M 3 28 C 3 21, 4 18, 6 18 C 9 18, 11 24, 14 24 L 14 32 C 11 32, 9 38, 6 38 C 4 38, 3 35, 3 28 Z" fill="url(#leftVerticalStretch)"/>
    <path d="M 3 28 C 3 22, 4 19, 6 19 C 9 19, 11 24.5, 14 24.5 L 14 31.5 C 11 31.5, 9 37, 6 37 C 4 37, 3 34, 3 28 Z" fill="url(#leftRefractBlue)"/>

    <!-- Middle Track: ACCENT on the left half (x=14..42), WHITE on the right half (x=42..70) -->
    <rect x="14" y="21" width="28" height="14" rx="3" fill="{l}" fill-opacity="0.22"/>
    <rect x="42" y="21" width="28" height="14" rx="3" fill="#ffffff" fill-opacity="0.20"/>
    <rect x="14" y="24" width="28" height="8" fill="url(#trackBlueLine)"/>
    <rect x="42" y="24" width="28" height="8" fill="url(#trackWhiteLine)"/>
    <line x1="42" y1="21" x2="42" y2="35" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.55"/>

    <!-- Right Side Refraction: stretches white track vertically at the boundary (y=18 to y=38) -->
    <path d="M 81 28 C 81 21, 80 18, 78 18 C 75 18, 73 24, 70 24 L 70 32 C 73 32, 75 38, 78 38 C 80 38, 81 35, 81 28 Z" fill="url(#rightVerticalStretch)"/>
    <path d="M 81 28 C 81 22, 80 19, 78 19 C 75 19, 73 24.5, 70 24.5 L 70 31.5 C 73 31.5, 75 37, 78 37 C 80 37, 81 34, 81 28 Z" fill="url(#rightRefractWhite)"/>
  </g>

  <!-- 4. Inner rim reflection -->
  <rect x="3" y="3" width="78" height="50" rx="25" stroke="url(#innerRim)" stroke-width="1.2" fill="none"/>

  <!-- 5. Outer rim stroke -->
  <rect x="2" y="2" width="80" height="52" rx="26" stroke="url(#edgeStroke)" stroke-width="1.2" fill="none"/>
</svg>
"""

def generate_slider_glass_v(palette):
    p = palette["primary"]
    l = palette["light"]
    s = palette["soft"]
    return f"""<svg width="56" height="84" viewBox="0 0 56 84" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Liquid glass body: crystal clear refractive depth, no top spotlight -->
    <linearGradient id="glassBodyV" x1="28" y1="2" x2="28" y2="82" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="70%" stop-color="#0a0e17" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#050810" stop-opacity="0.38"/>
    </linearGradient>

    <!-- Outer rim stroke -->
    <linearGradient id="edgeStrokeV" x1="28" y1="2" x2="28" y2="82" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.35"/>
    </linearGradient>

    <!-- Inner rim highlight -->
    <linearGradient id="innerRimV" x1="28" y1="2" x2="28" y2="82" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="75%" stop-color="#000000" stop-opacity="0.0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
    </linearGradient>

    <!-- Top side optical refraction: stretches accent track horizontally at the boundary -->
    <linearGradient id="topHorizontalStretch" x1="18" y1="5" x2="38" y2="5" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{s}" stop-opacity="0.0"/>
      <stop offset="15%" stop-color="{l}" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="{p}" stop-opacity="0.98"/>
      <stop offset="85%" stop-color="{l}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="{s}" stop-opacity="0.0"/>
    </linearGradient>

    <linearGradient id="topRefractBlue" x1="28" y1="3" x2="28" y2="15" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{l}" stop-opacity="0.95"/>
      <stop offset="40%" stop-color="{p}" stop-opacity="0.85"/>
      <stop offset="75%" stop-color="{p}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="{p}" stop-opacity="0.0"/>
    </linearGradient>

    <!-- Middle Accent Track Line -->
    <linearGradient id="trackBlueLineV" x1="28" y1="14" x2="28" y2="42" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{p}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="{p}" stop-opacity="0.98"/>
    </linearGradient>

    <!-- Middle White Track Line -->
    <linearGradient id="trackWhiteLineV" x1="28" y1="42" x2="28" y2="70" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.92"/>
    </linearGradient>

    <!-- Bottom side optical refraction: stretches white track horizontally at the boundary -->
    <linearGradient id="bottomHorizontalStretch" x1="18" y1="79" x2="38" y2="79" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.0"/>
      <stop offset="15%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="85%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
    </linearGradient>

    <linearGradient id="bottomRefractWhite" x1="28" y1="81" x2="28" y2="69" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="40%" stop-color="#f4f8ff" stop-opacity="0.90"/>
      <stop offset="75%" stop-color="#e8f0fe" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e8f0fe" stop-opacity="0.0"/>
    </linearGradient>

    <!-- 0.2px subtle blur filter for natural optical refraction diffusion -->
    <filter id="opticalBlurV" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.5"/>
    </filter>
  </defs>

  <!-- 1. Soft depth shadow -->
  <rect x="3" y="2" width="50" height="80" rx="25" fill="#000000" fill-opacity="0.25"/>

  <!-- 2. Glass body (clean, NO spotlight!) -->
  <rect x="2" y="2" width="52" height="80" rx="26" fill="url(#glassBodyV)"/>

  <!-- 3. Optical Refraction Track with 0.2px blur (whiskers removed!) -->
  <g filter="url(#opticalBlurV)">
    <!-- Top Refraction: stretches accent track horizontally at the boundary (x=18 to x=38) -->
    <path d="M 28 3 C 21 3, 18 4, 18 6 C 18 9, 24 11, 24 14 L 32 14 C 32 11, 38 9, 38 6 C 38 4, 35 3, 28 3 Z" fill="url(#topHorizontalStretch)"/>
    <path d="M 28 3 C 22 3, 19 4, 19 6 C 19 9, 24.5 11, 24.5 14 L 31.5 14 C 31.5 11, 37 9, 37 6 C 37 4, 34 3, 28 3 Z" fill="url(#topRefractBlue)"/>

    <!-- Middle Track: ACCENT on the top half (y=14..42), WHITE on the bottom half (y=42..70) -->
    <rect x="21" y="14" width="14" height="28" rx="3" fill="{l}" fill-opacity="0.22"/>
    <rect x="21" y="42" width="14" height="28" rx="3" fill="#ffffff" fill-opacity="0.20"/>
    <rect x="24" y="14" width="8" height="28" fill="url(#trackBlueLineV)"/>
    <rect x="24" y="42" width="8" height="28" fill="url(#trackWhiteLineV)"/>
    <line x1="21" y1="42" x2="35" y2="42" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.55"/>

    <!-- Bottom Refraction: stretches white track horizontally at the boundary (x=18 to x=38) -->
    <path d="M 28 81 C 21 81, 18 80, 18 78 C 18 75, 24 73, 24 70 L 32 70 C 32 73, 38 75, 38 78 C 38 80, 35 81, 28 81 Z" fill="url(#bottomHorizontalStretch)"/>
    <path d="M 28 81 C 22 81, 19 80, 19 78 C 19 75, 24.5 73, 24.5 70 L 31.5 70 C 31.5 73, 37 75, 37 78 C 37 80, 34 81, 28 81 Z" fill="url(#bottomRefractWhite)"/>
  </g>

  <!-- 4. Inner rim reflection -->
  <rect x="3" y="3" width="50" height="78" rx="25" stroke="url(#innerRimV)" stroke-width="1.2" fill="none"/>

  <!-- 5. Outer rim stroke -->
  <rect x="2" y="2" width="52" height="80" rx="26" stroke="url(#edgeStrokeV)" stroke-width="1.2" fill="none"/>
</svg>
"""

def update_all_locations(accent="orange"):
    palette = PALETTES.get(accent.lower(), PALETTES["orange"])
    svg_h = generate_slider_glass_h(palette)
    svg_v = generate_slider_glass_v(palette)

    dirs = [
        "/home/vitaliy/.config/gtk-4.0/assets/scalable",
        "/home/vitaliy/MACTHEMEFILES/config/gtk-4.0/assets/scalable",
        "/home/vitaliy/MACTHEMEFILES/macW1Y-Dark/gtk-4.0/assets/scalable",
        "/home/vitaliy/MACTHEMEFILES/macW1Y-Dark-solid/gtk-4.0/assets/scalable",
        "/home/vitaliy/MACTHEMEFILES/macW1Y-Light/gtk-4.0/assets/scalable",
        "/home/vitaliy/MACTHEMEFILES/macW1Y-Light-solid/gtk-4.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Dark/gtk-4.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Dark-solid/gtk-4.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Light/gtk-4.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Light-solid/gtk-4.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Dark/gtk-3.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Dark-solid/gtk-3.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Light/gtk-3.0/assets/scalable",
        "/home/vitaliy/.themes/macW1Y-Light-solid/gtk-3.0/assets/scalable",
    ]

    for d in dirs:
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        h_path = os.path.join(d, "slider-glass.svg")
        v_path = os.path.join(d, "slider-glass-vertical.svg")
        with open(h_path, "w", encoding="utf-8") as f:
            f.write(svg_h)
        with open(v_path, "w", encoding="utf-8") as f:
            f.write(svg_v)
        os.chmod(h_path, 0o755)
        os.chmod(v_path, 0o755)
        print(f"[✔] Updated: {h_path} & {v_path}")

if __name__ == "__main__":
    accent_arg = sys.argv[1] if len(sys.argv) > 1 else "orange"
    update_all_locations(accent_arg)
