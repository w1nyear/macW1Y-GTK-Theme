# macW1Y — macW1Y Experience on GNOME

[![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04%20%7C%2024.10%20%7C%2026.04-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![Debian](https://img.shields.io/badge/Debian-13%20(Trixie)%20%7C%20Sid-A81D33?style=for-the-badge&logo=debian&logoColor=white)](https://debian.org/)
[![Fedora](https://img.shields.io/badge/Fedora-40%20%7C%2041%20%7C%2042-51A2DA?style=for-the-badge&logo=fedora&logoColor=white)](https://fedoraproject.org/)
[![Arch Linux](https://img.shields.io/badge/Arch%20Linux-Rolling-1793D1?style=for-the-badge&logo=archlinux&logoColor=white)](https://archlinux.org/)
[![CachyOS](https://img.shields.io/badge/CachyOS-Optimized-008080?style=for-the-badge)](https://cachyos.org/)
[![GNOME](https://img.shields.io/badge/GNOME-46--51-4a86cf?style=for-the-badge&logo=gnome&logoColor=white)](https://www.gnome.org/)
[![w1nyear](https://img.shields.io/badge/w1nyear-blue?style=for-the-badge)](https://github.com/w1nyear)

---

**macW1Y** is a complete, pixel-perfect transformation suite and performance modpack for Linux distributions running **GNOME Shell on Wayland or X11** (Ubuntu, Debian, Fedora, Arch Linux, and CachyOS). It delivers authentic styling, GTK3/GTK4 themes, Liquid Glass shaders, Default typography, animated GRUB/Plymouth boot screens, hardware multitouch gestures, desktop widgets, hybrid GPU optimization, and an overhauled Control Center and Settings experience.

---

## Supported Systems & Compatibility Matrix

| Component | Supported Targets | Technical Details |
|---|---|---|
| **Distributions** | **Ubuntu** 24.04+, **Debian** 13+ (Trixie/Sid), **Fedora** 40+, **Arch Linux**, **CachyOS** | Automated distribution detection (`detect_distro_and_paths`) supporting all modern systemd-based Linux systems. |
| **Desktop Environment** | **GNOME Shell 46, 47, 48, 49, 50, 51+** | All 21 managed extensions support GNOME 46–51 ESM architecture. Legacy GNOME (< 46) is safely rejected. |
| **Display Server** | **Wayland** (Default/Recommended), **X11** | Full 1:1 hardware gestures and Liquid Glass shaders on Wayland; hardware fallback rendering on X11. |
| **Bootloaders** | **GRUB 2**, **systemd-boot** | Horizontal animated boot theme for GRUB 2 (`update-grub`, `grub2-mkconfig`, `grub-mkconfig`); safe automatic bypass for systemd-boot. |
| **Initramfs Tooling** | `initramfs-tools`, `dracut`, `mkinitcpio` | Automatic selection via `macw1y_rebuild_initramfs` for Plymouth boot splash deployment. |
| **Package Managers** | `apt`, `dnf`, `pacman` | Resilient per-package fallback in `dependencies/install-deps.sh`. |
| **Architecture** | **x86_64 / amd64** | Local compilation of 7 native C shared libraries with multiarch, `/usr/lib64`, and `/usr/lib` path support. |

---

## System Specifications & Hardware Profiles

### 1. Low-Spec & Eco Profile (`--low-spec` / `--eco` / `-e`)
Targeted at older laptops and integrated GPUs (Intel HD 3000–630, AMD Radeon Vega 3–8):
- **RAM:** 2 GB minimum (with dynamic zRAM swap compression).
- **CPU:** x86_64 Dual-Core (Intel Core 2 Duo, Core i3/i5 2nd–7th Gen, AMD Athlon/A-Series or newer).
- **GPU:** Intel HD Graphics, AMD Radeon HD 7000+ / Vega iGPU (OpenGL 3.3+ / Vulkan).
- **Optimizations:** 64 MB strict memory cache cap with idle eviction, 2x downscaled Liquid Glass blur sampling (steady 60 FPS), 15s idle GC throttle debouncing.

### 2. Standard Minimum Requirements
- **RAM:** 4 GB DDR3 / DDR4
- **CPU:** Quad-Core 64-bit x86_64 CPU (Intel Core 8th Gen+ or AMD Ryzen 1000+)
- **GPU:** Intel UHD 630+, AMD Radeon RX 550+, NVIDIA GeForce GTX 750 Ti+ (OpenGL 4.0+ / Vulkan 1.2+)
- **Storage:** 10 GB free space (SSD recommended)
- **Display:** 1366×768 minimum (1920×1080 recommended)

### 3. Recommended Specifications
- **RAM:** 8–16+ GB DDR4 / DDR5
- **CPU:** Modern multi-core CPU (Intel Core 12th–14th Gen, AMD Ryzen 5000–9000 Series)
- **GPU:** NVIDIA GeForce RTX 3050+, AMD Radeon RX 6600+ / 780M, Intel Arc A-Series / Iris Xe
- **Storage:** 20 GB free space on NVMe SSD
- **Display:** Full HD (1080p), 2K (1440p), or 4K Retina HiDPI with fractional scaling

---

## Installation

```bash
git clone https://github.com/w1nyear/macW1Y-GTK-Theme.git macW1Y
cd macW1Y
chmod +x install.sh
./install.sh
```

### Installation Modes

- **Interactive GUI Wizard (Default):** `./install.sh`
- **Visual Simulation Mode (No Install):** `./install.sh -let_me_try_bradar`
- **Low-Spec / Eco Mode:** `./install.sh --low-spec` (or `./install.sh --eco`)
- **Full Automated Unattended:** `./install.sh --all`
- **CLI Mode (No GUI):** `./install.sh --cli`
- **Help & Launch Options:** `./install.sh -?` (or `./install.sh --help`)

---

## Uninstallation

```bash
cd macW1Y
chmod +x uninstall.sh
./uninstall.sh
```

Restores original upstream defaults (Ubuntu Yaru, Fedora Adwaita, standard Arch/Debian desktop), removes app wrappers, restores package binaries, disables background daemons, and reverts GRUB/Plymouth.

---

## Multitouch Gestures

- **3-Finger Circle Drag:** Move active/topmost window across screens; unmaximizes upon drag.
- **3-Finger Horizontal Swipe Up/Down:** Toggle Mission Control (Overview).
- **3-Finger Vertical Swipe Left/Right:** Window switching (Alt+Tab).
- **3-Finger Pinch In / Out:** Copy (`Ctrl+C`) / Paste (`Ctrl+V`).
- **4-Finger Single Tap:** Toggle Overview.
- **4-Finger Double Tap:** Open Launchpad / App Grid.
- **4-Finger Horizontal Swipe:** Switch virtual workspaces.

---

## Integrated Projects & License

- **Widgets:** Integrated desktop widgets by [r3nhick](https://github.com/r3nhick/desktop-widgets) (GPLv3).
- **Author:** Vitaliy ([w1nyear](https://github.com/w1nyear))
- **License:** GNU General Public License v3.0 (GPLv3).
- **Version:** 0.7
