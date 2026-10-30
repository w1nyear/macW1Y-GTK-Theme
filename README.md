# macW1Y - macOS Experience on GNOME

[![Ubuntu](https://img.shields.io/badge/Ubuntu-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![GNOME](https://img.shields.io/badge/GNOME-4a86cf?style=for-the-badge&logo=gnome&logoColor=white)](https://www.gnome.org/)
[![w1nyear](https://img.shields.io/badge/w1nyear-blue?style=for-the-badge)](https://github.com/w1nyear)

---

<p align="center">
  <img src="screen.webm" alt="macW1Y Desktop Preview" width="100%" />
</p>

---

**macW1Y** is a complete, pixel-perfect transformation suite and performance modpack designed to bring the authentic macOS experience to Ubuntu (GNOME Shell on Wayland). The project integrates custom GTK3/GTK4 themes, GNOME Shell styling, Liquid Glass shaders, Apple SF Pro typography, animated Apple Silicon GRUB and Plymouth boot animations, a dedicated low-latency multitouch gesture daemon, interactive desktop widgets, hybrid graphics optimizations, and an overhauled Control Center and Settings experience.

### Visual Experience & Styling

The system delivers the refined aesthetics and behavior of modern macOS (Sequoia / Tahoe):
- **Top Menubar & Control Center**: Native slide-in Control Center with audio and brightness controls, quick toggles, battery health, and dynamic top-bar OSD icons.
- **Cupertino Glass Dock**: Floating dock with Liquid Glass reflection, magnification, and smooth application minimization animations.
- **Mission Control & Window Management**: Intuitive workspace navigation, drag-to-top window zooming with automatic menubar slide-in and window height accommodation.
- **Spotlight Search & Clipboard**: Super+Space modal search with instant file preview, calculator, and an integrated clipboard history popup.
- **Finder-Styled Nautilus**: Clean file manager sidebar with authentic iconography, custom pathbars, and folder badging.
- **Settings (GNOME Control Center)**: Refreshed macOS 26-inspired interface with compact leftbar navigation, Apple ID user banner, collapsible system alerts, and radio-accordion power modes.
- **Dark & Light Themes**: Precise rounded geometry, authentic drop shadows, typography, and accent colors.

---

## Project Structure

```
macW1Y/
├── install.sh                    # Primary automated installer and setup script
├── uninstall.sh                  # Uninstaller restoring standard Ubuntu Yaru defaults
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
├── macW1Y-Dark/                  # Dark theme suite for GTK3, GTK4, and GNOME Shell
├── macW1Y-Dark-solid/            # Opaque variant of the dark theme
├── macW1Y-Light/                 # Light theme suite for GTK3, GTK4, and GNOME Shell
├── macW1Y-Light-solid/           # Opaque variant of the light theme
├── gnome-shell-theme/            # Custom GNOME Shell stylesheet and assets
├── icons/                        # Complete macOS-styled icon themes
├── fonts/                        # Apple SF Pro fonts collection (29 font weights)
├── wallpapers/                   # Official macOS desktop wallpapers
├── bin/                          # Core system scripts, guards, and diagnostics utilities
├── lib/                          # Compiled helper libraries (e.g. libmac_settings.so)
├── src/                          # C and GLib source code for system integrations
├── applications/                 # Custom .desktop launchers and menu entries
├── autostart/                    # Autostart desktop service configurations
├── extensions/                   # Pre-configured and hardened GNOME Shell extensions
│   ├── blur-my-shell@aunetx      # Mutter blur effects for menubar and panels
│   ├── liquid-glass@...          # Dynamic Liquid Glass GLSL refraction shader
│   ├── eval-helper@mactheme      # High-performance DBus bridge, GC, and modal helper
│   ├── kiwi@kemma                # macOS Control Center & Notification Center suite
│   ├── cupertino-dock-lite@...   # Cupertino-style floating glass dock
│   └── macos-touchpad-gestures@mactheme # Low-latency multitouch gestures extension
├── control-center/               # macOS styling injections for GNOME Control Center
├── grub/                         # Apple Silicon bootloader theme for GRUB
├── plymouth/                     # Plymouth boot splash animation with Apple logo
├── macos-plymouth/               # Alternative boot splash theme
├── macos-gdm/                    # macOS-style GDM login screen styling
├── systemd/                      # Systemd services (power management, touchpad daemon)
├── dconf/                        # Baseline dconf system setting dumps
├── dependencies/                 # Package dependency manifests and installer scripts
├── config/                       # Application configurations, GTK settings, and locks
├── gtk-3.0/                      # User-specific GTK3 styling
├── gtk-4.0/                      # User-specific GTK4 styling
├── themes/                       # Additional theme variations and accents
├── sounds/                       # Authentic macOS system audio and alerts
├── touchpad/                     # Hardware uinput multitouch gesture daemon
├── wack-system/                  # Lockscreen clock, widgets, and animation system
└── assets/                       # Vector graphics and UI resources
```

---

## System Requirements

### Minimum Requirements
- **RAM:** 2 GB
- **Graphics:** Intel UHD Graphics / AMD Radeon Vega / NVIDIA GT 1030
- **Operating System:** Ubuntu 24.04 LTS (GNOME 46+ on Wayland)
- **Storage:** 10 GB free disk space
- **Processor:** x86_64 Dual-Core CPU
- **Secure Boot:** Disabled (required for custom kernel modules and boot hooks)

### Recommended Specifications
- **RAM:** 4 GB or higher
- **Graphics:** Hybrid Graphics (Intel/AMD iGPU + NVIDIA GeForce RTX 3050/4050/4060) or AMD Radeon RX 6000/7000 Series
- **Operating System:** Ubuntu 24.04 LTS / Ubuntu 26.04 LTS (GNOME 46+ on Wayland)
- **Storage:** 20 GB free space on high-speed NVMe SSD
- **Processor:** Intel Core 12th/13th/14th Gen (Hybrid P/E-cores) or AMD Ryzen 5000/7000/9000 Series
- **Secure Boot:** Disabled
- **BIOS/UEFI:** Modern UEFI firmware with Resizable BAR enabled

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

**Interactive Setup / Update:**
```bash
chmod +x install.sh
./install.sh
```

**Full Automated Installation:**
```bash
chmod +x install.sh
./install.sh --all
```

> **Note:** After installation completes, please restart your computer (`sudo reboot`) or log out of your session to ensure all kernel modules, udev power rules, zRAM configurations, and graphic compositor shaders initialize properly.

---

## Uninstallation

To restore standard Ubuntu defaults and remove the theme pack:

```bash
cd macW1Y
chmod +x uninstall.sh
./uninstall.sh
```

The uninstaller automatically restores the standard Yaru theme, removes installed GNOME extensions, unregisters background services and udev rules, reverts GRUB and Plymouth themes, and resets user environment overrides safely.

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

## Acknowledgements

- **Lilithium** — for visual improvements
- **Teemo** — for providing macOS screenshots

---

## License & Legal Information

**Author and Developer:** Vitaliy ([w1nyear](https://github.com/w1nyear))

**License:** GNU General Public License v3.0 (GPLv3). Refer to the [LICENSE](LICENSE) file for full licensing terms.

**Legal Notice & Disclaimers:**
- This project is developed independently for educational, research, and personalization purposes for Linux users.
- Apple, macOS, Cupertino, San Francisco, Sequoia, Tahoe, Golden Gates, and related marks are trademarks of Apple Inc.
- All open-source components and third-party tools included or referenced are licensed under their respective original licenses (GPL, MIT, LGPL, Apache 2.0).
- Apple SF Pro fonts and brand iconography are referenced solely for personal non-commercial customization.
- GNOME Shell extension code interfaces with official GNOME JavaScript APIs under the GNU GPLv3+ license.

---

**Official Repository:** https://github.com/w1nyear/macW1Y-GTK-Theme

**Version:** 0.5
