# Wi-Fi Hotspot Quick Settings

[![GNOME Extensions](https://img.shields.io/badge/GNOME%20Extensions-10566-4A86CF?logo=gnome)](https://extensions.gnome.org/extension/10566/wi-fi-hotspot-quick-settings/)
![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-50-4A86CF?logo=gnome)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A GNOME Shell extension that adds a **"Turn On Wi-Fi Hotspot"** action directly to the Wi-Fi Quick Settings menu, just above **"All Networks"**.

GNOME already provides a convenient way to turn off a hotspot once it is active, but turning one on requires opening the Settings application. This extension fills that small usability gap by making hotspot activation available directly from Quick Settings.

<img width="415" height="358" alt="image" src="https://github.com/user-attachments/assets/06885196-7c44-4c22-8189-b545e2ed5509" />

## Compatibility

Tested on GNOME Shell 50. The extension patches GNOME Shell internals, so compatibility with other versions is not guaranteed. If you've tested it on another version, feel free to open an issue or pull request. Hotspot activation requires `nmcli`.

## Installation

### From GNOME Extensions

Install directly from:

https://extensions.gnome.org/extension/10566/wi-fi-hotspot-quick-settings/

### Manual installation

Clone or copy this repository into:

```bash
git clone https://github.com/aryan10/wifi-hotspot-quick-settings.git \
  ~/.local/share/gnome-shell/extensions/wifi-hotspot-quick-settings@aryan10.github.io
```

Then enable the extension:

```bash
gnome-extensions enable wifi-hotspot-quick-settings@aryan10.github.io
```

or enable it using the **Extensions** application.

## License

This project is licensed under the **GNU General Public License v3.0**. See the [LICENSE](LICENSE) file for details.
