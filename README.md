# macW1Y - macW1Y Experience on GNOME

[![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04%20%7C%2024.10%20%7C%2026.04-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![Debian](https://img.shields.io/badge/Debian-13%20(Trixie)%20%7C%20Sid-A81D33?style=for-the-badge&logo=debian&logoColor=white)](https://debian.org/)
[![Fedora](https://img.shields.io/badge/Fedora-40%20%7C%2041%20%7C%2042-51A2DA?style=for-the-badge&logo=fedora&logoColor=white)](https://fedoraproject.org/)
[![Arch Linux](https://img.shields.io/badge/Arch%20Linux-Rolling-1793D1?style=for-the-badge&logo=archlinux&logoColor=white)](https://archlinux.org/)
[![CachyOS](https://img.shields.io/badge/CachyOS-Optimized-008080?style=for-the-badge)](https://cachyos.org/)
[![GNOME](https://img.shields.io/badge/GNOME-46--51-4a86cf?style=for-the-badge&logo=gnome&logoColor=white)](https://www.gnome.org/)
[![w1nyear](https://img.shields.io/badge/w1nyear-blue?style=for-the-badge)](https://github.com/w1nyear)

---

<p align="center">
  <video src="screen.mov" width="100%" autoplay loop muted playsinline controls></video>
</p>

---

**macW1Y** is a complete, pixel-perfect transformation suite and performance modpack designed to bring the authentic macW1Y experience to Linux distributions running **GNOME Shell on Wayland** (Ubuntu, Debian, Fedora, Arch Linux, and CachyOS). The project integrates custom GTK3/GTK4 themes, GNOME Shell styling, Liquid Glass shaders, macW1Y Default typography, animated macW1Y GRUB and Plymouth boot animations, a dedicated low-latency multitouch gesture daemon, interactive desktop widgets, hybrid graphics optimizations, and an overhauled Control Center and Settings experience.

### Visual Experience & Styling

The system delivers the refined aesthetics and behavior of modern macW1Y:
- **Top Menubar & Control Center**: Native slide-in Control Center with audio and brightness controls, quick toggles, battery health, and dynamic top-bar OSD icons.
- **Liquid Glass Dock**: Floating dock with Liquid Glass reflection, magnification, and smooth application minimization animations.
- **Mission Control & Window Management**: Intuitive workspace navigation, drag-to-top window zooming with automatic menubar slide-in and window height accommodation.
- **Spotlight Search & Clipboard**: Super+Space modal search with instant file preview, calculator, and an integrated clipboard history popup.
- **Finder-Styled Nautilus**: Clean file manager sidebar with authentic iconography, custom pathbars, and folder badging.
- **Settings (GNOME Control Center)**: Refreshed modern interface with compact leftbar navigation, user banner, collapsible system alerts, and radio-accordion power modes.
- **Dark & Light Themes**: Precise rounded geometry, authentic drop shadows, typography, and accent colors.

---

## Project Structure

```
macW1Y/
├── install.sh                    # Primary automated installer and setup script
├── uninstall.sh                  # Uninstaller restoring standard system defaults
├── README.md                     # Project documentation
├── LICENSE                       # GNU General Public License v3.0
├── done.txt                      # Detailed changelog and development stage history
├── screen.webm                   # Desktop demonstration media
├── 99-cpu-power.rules            # Udev rules for CPU power optimization
├── 99-zram.conf                  # Compressed zRAM memory swap configuration
├── cpu-power-manager             # CPU performance management script
├── cpu-power-manager.service     # Systemd service for CPU power manager
├── apply_plymouth.sh             # Script to install and apply Plymouth boot theme
├── toggle-launchpad.sh           # Script to trigger Launchpad / Application Grid
├── AI_INSTRUCTIONS.md            # AI agent deployment instructions
├── gnome-control-center-overlay/ # macW1Y styling injections for GNOME Control Center
├── gnome-shell-overlay/         # GNOME Shell custom overlay module
├── extension-manager/           # Custom GNOME extension manager helper library
├── services/                    # Systemd user service overrides
├── dracut.conf.d/               # Dracut kernel module configuration
├── etc/                         # System configuration overlays
├── zramswap                     # zram swap helper script
├── macW1Y-Dark/                  # Dark theme suite for GTK3, GTK4, and GNOME Shell
├── macW1Y-Dark-solid/            # Opaque variant of the dark theme
├── macW1Y-Light/                 # Light theme suite for GTK3, GTK4, and GNOME Shell
├── macW1Y-Light-solid/           # Opaque variant of the light theme
├── gnome-shell-theme/            # Custom GNOME Shell stylesheet and assets
├── icons/                        # Complete macW1Y-styled icon themes
├── fonts/                        # macW1Y Default fonts collection (29 font weights)
├── wallpapers/                   # Official macW1Y desktop wallpapers
├── bin/                          # Core system scripts, guards, and diagnostics utilities
├── lib/                          # Compiled helper libraries (e.g. libmac_settings.so)
├── src/                          # C and GLib source code for system integrations
├── applications/                 # Custom .desktop launchers and menu entries
├── autostart/                    # Autostart desktop service configurations
├── extensions/                   # Pre-configured and hardened GNOME Shell extensions
│   ├── blur-my-shell@aunetx      # Mutter blur effects for menubar and panels
│   ├── liquid-glass@...          # Dynamic Liquid Glass GLSL refraction shader
│   ├── eval-helper@mactheme      # High-performance DBus bridge, GC, and modal helper
│   ├── kiwi@kemma                # macW1Y Control Center & Notification Center suite
│   ├── cupertino-dock-lite@...   # Cupertino-style floating glass dock
│   └── macw1y-touchpad-gestures@mactheme # Low-latency multitouch gestures extension
├── control-center/               # macW1Y styling injections for GNOME Control Center
├── grub/                         # macW1Y bootloader theme for GRUB
├── plymouth/                     # Plymouth boot splash animation with System logo
├── macw1y-boot/                  # Alternative boot splash theme
├── macw1y-gdm/                   # macW1Y-style GDM login screen styling
├── systemd/                      # Systemd services (power management, touchpad daemon)
├── dconf/                        # Baseline dconf system setting dumps
├── dependencies/                 # Package dependency manifests and installer scripts
├── config/                       # Application configurations, GTK settings, and locks
├── gtk-3.0/                      # User-specific GTK3 styling
├── gtk-4.0/                      # User-specific GTK4 styling
├── sounds/                       # Authentic macW1Y system audio and alerts
├── touchpad/                     # Hardware uinput multitouch gesture daemon
├── wack-system/                  # Lockscreen clock, widgets, and animation system
└── assets/                       # Vector graphics and UI resources
```

---

## Supported Systems & Compatibility Matrix

macW1Y includes a unified, cross-distribution installer that automatically detects your distribution family, package manager, library paths, initramfs generator, and active bootloader.

| Component | Supported Targets | Technical Details |
|---|---|---|
| **Distributions** | **Ubuntu** 24.04 LTS, 24.10, 26.04+<br>**Debian** 13 (Trixie), Testing, Sid<br>**Fedora** 40, 41, 42+ Workstation<br>**Arch Linux** (Rolling)<br>**CachyOS** (Rolling) | Any modern systemd-based Linux distribution running GNOME 46+ is supported out of the box. |
| **Desktop Environment** | **GNOME Shell 46, 47, 48, 49, 50, 51+** | All 21 managed extensions are unified under the modern GNOME ESM architecture. Legacy GNOME (< 46) is rejected safely before any changes are made. |
| **Display Server** | **Wayland** (Default & Recommended)<br>**X11** (Supported with fallback shaders) | Wayland provides 1:1 hardware touchpad gestures, tear-free compositor animations, and native shader rendering. |
| **Bootloaders** | **GRUB 2** (horizontal animated boot theme)<br>**systemd-boot** (auto-detected & safely preserved) | The installer auto-detects active bootloaders (`systemd-boot` entries or `bootctl`) and gracefully bypasses GRUB hooks without error. |
| **Initramfs Tooling** | `initramfs-tools` (Debian/Ubuntu)<br>`dracut` (Fedora/RHEL/Arch)<br>`mkinitcpio` (Arch Linux/CachyOS) | Automatic engine selection for Plymouth boot splash deployment and rebuilds. |
| **Package Managers** | `apt` (Ubuntu / Debian)<br>`dnf` (Fedora)<br>`pacman` (Arch Linux / CachyOS) | Features resilient per-package fallback handling: missing optional packages produce warnings rather than crashing installation. |
| **Architecture** | **x86_64 / amd64** | Native local build of all 7 C helper libraries (`-Werror=implicit-function-declaration -Wl,-z,defs`) with multiarch and 64-bit library detection. |

---

## System Specifications & Hardware Profiles

macW1Y is engineered to run smoothly across a wide spectrum of hardware — from older dual-core laptops with integrated Intel HD Graphics to modern high-end workstations with hybrid GPUs.

### 1. Low-Spec & Eco Profile (for older laptops and iGPUs)
> Run `./install.sh --low-spec` (or `./install.sh --eco` / `-e`) to activate this profile.

Optimized specifically for laptops with legacy integrated graphics (Intel HD 3000/4000/5000/620/630, AMD Radeon Vega 3/6/8, and entry-level dGPUs):
- **RAM:** 2 GB minimum (with dynamic zRAM swap compression).
- **Processor:** x86_64 Dual-Core CPU (Intel Core 2 Duo, Core i3/i5 2nd–7th Gen, AMD Athlon/A-Series or newer).
- **Graphics:** Intel HD / UHD Graphics, AMD Radeon HD 7000+ / Vega iGPU (OpenGL 3.3+ / Vulkan).
- **Key Optimizations Applied:**
  - **Memory Budget Cap:** Strict 64 MB budget limit on animation and blur caches with automatic idle eviction.
  - **Downscaled Shader Sampling:** 2x downscaled background blur sampling for Liquid Glass shaders to guarantee steady 60 FPS.
  - **Idle Debouncing:** 15s throttle debouncing to eliminate synchronous stop-the-world garbage collection pauses.
  - **Resource Prewarming:** Disables aggressive background GPU prewarming while preserving fluid UI transitions.

### 2. Standard Minimum Requirements
- **RAM:** 4 GB DDR3 / DDR4
- **Processor:** Quad-Core 64-bit x86_64 CPU (Intel Core 8th Gen+ or AMD Ryzen 1000+)
- **Graphics:** Intel Iris Plus / UHD 630+, AMD Radeon RX 550+, or NVIDIA GeForce GTX 750 Ti+ (OpenGL 4.0+ / Vulkan 1.2+)
- **Storage:** 10 GB free disk space (SSD recommended)
- **Display Resolution:** 1366×768 minimum (Full HD 1920×1080 recommended)
- **Secure Boot:** Disabled (required for custom Plymouth hooks and kernel power profiles)

### 3. Recommended Specifications
- **RAM:** 8 GB – 16 GB+ DDR4 / DDR5
- **Processor:** Modern multi-core CPU (Intel Core 12th–14th Gen Hybrid P/E-cores, AMD Ryzen 5000–9000 Series)
- **Graphics:** Dedicated GPU or modern iGPU:
  - NVIDIA GeForce RTX 3050 / 4050 / 4060 / 4070+ (with proprietary NVIDIA drivers)
  - AMD Radeon RX 6600 / 7600+ or Radeon 680M / 780M / 890M iGPU
  - Intel Arc A-Series or Iris Xe Graphics
- **Storage:** 20 GB free space on high-speed NVMe PCIe Gen3/Gen4 SSD
- **Display:** Full HD (1080p), 2K (1440p), or 4K/Retina HiDPI with fractional scaling
- **Touchpad:** Precision I2C / SMBus / USB Multitouch Trackpad for 1:1 hardware gestures
- **BIOS/UEFI:** Modern UEFI firmware with Resizable BAR / Above 4G Decoding enabled

---

## Installation

To clone and install macW1Y, open your terminal and run:

```bash
git clone https://github.com/w1nyear/macW1Y-GTK-Theme.git macW1Y
cd macW1Y
chmod +x install.sh
./install.sh
```

### Installation Modes

**1. Interactive GUI Setup Wizard (Default):**
```bash
./install.sh
```
*Launches the graphical macOS Sequoia/Tahoe-styled setup wizard, verifies distribution compatibility, compiles native libraries, and allows selecting custom styling options.*

**2. Low-Spec / Eco Mode (for older laptops & Intel HD Graphics):**
```bash
./install.sh --low-spec
# or
./install.sh --eco
```

**3. Full Automated Unattended Installation:**
```bash
./install.sh --all
```

**4. Command-Line Interface Only (No GUI):**
```bash
./install.sh --cli
```

> **Note:** After installation completes, please restart your computer (`sudo reboot`) or log out of your session to ensure all kernel modules, GDM themes, Plymouth boot animations, and graphic compositor shaders initialize properly.

---

## Uninstallation

To cleanly restore your distribution's standard upstream defaults (Ubuntu Yaru, Fedora Adwaita, or standard Arch/Debian desktop) and completely remove the theme pack:

```bash
cd macW1Y
chmod +x uninstall.sh
./uninstall.sh
```

The uninstaller automatically:
- Restores original upstream desktop themes, icons, fonts, and cursors.
- Safely removes app wrappers and restores original package binaries (`gnome-shell`, `nautilus`, `gnome-control-center`, `ptyxis`).
- Unregisters systemd daemons, udev rules, and background services.
- Reverts GRUB configuration and Plymouth boot theme to standard distribution defaults.
- Recompiles GSettings schemas and cleans up dconf locks without leaving orphaned artifacts.

---

## Multitouch Gestures

macW1Y includes a custom, low-latency touchpad daemon (`mac-touchpad-daemon`) running alongside GNOME Shell:
- **3-Finger Circle Move:** Position three fingers in a cluster or circle and drag to move the active or topmost window smoothly across screens. Maximized windows automatically unmaximize upon movement.
- **3-Finger Horizontal Row:** Swipe up or down with three fingers in a row to smoothly open or close Mission Control (Overview).
- **3-Finger Vertical Column:** Swipe left or right with three fingers in a column to switch between running windows (Alt+Tab).
- **3-Finger Pinch In / Out:** Pinch inward to Copy (`Ctrl+C`), spread outward to Paste (`Ctrl+V`).
- **4-Finger Single Tap:** Instantly toggle Mission Control overview.
- **4-Finger Double Tap:** Open Launchpad / Application Grid.
- **4-Finger Horizontal Swipe:** Fluidly switch between virtual workspaces.

---

## Integrated Projects

This project integrates **Widgets** by [r3nhick](https://github.com/r3nhick/desktop-widgets).

[[Widgets by r3nhick]](https://github.com/r3nhick/desktop-widgets)

The integrated Widgets extension is distributed under the **GNU General Public License v3.0** (see the extension's [LICENSE](extensions/desktop-widgets@r3nhick/LICENSE) for details). Permission for use within macW1Y was obtained from the developers; all copyrights are reserved.

---

## Acknowledgements

- **Lilithium** — for visual improvements
- **Teemo** — for providing macW1Y screenshots

---

## License & Legal Information

**Author and Developer:** Vitaliy ([w1nyear](https://github.com/w1nyear))

**License:** GNU General Public License v3.0 (GPLv3). Refer to the [LICENSE](LICENSE) file for full licensing terms.

**Legal Notice & Disclaimers:**
- This project is developed independently for educational, research, and personalization purposes for Linux users.
- macW1Y, Default, System, and related design elements are created by the macW1Y Project.
- All open-source components and third-party tools included or referenced are licensed under their respective original licenses (GPL, MIT, LGPL, Apache 2.0).
- macW1Y Default typography and vector iconography are crafted for open desktop personalization.
- GNOME Shell extension code interfaces with official GNOME JavaScript APIs under the GNU GPLv3+ license.

---

**Official Repository:** https://github.com/w1nyear/macW1Y-GTK-Theme

**Version:** 0.7
