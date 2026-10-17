import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import NM from 'gi://NM';
import UPowerGlib from 'gi://UPowerGlib';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { buildNotificationCard } from './notifications.js';
import { MacControlCenter } from './control_center_v19.js';

const CC_PNG_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/control-center.png';
const _UID = Math.floor(Math.random() * 100000000);

/* ==========================================================================
   1. Wi-Fi Status Button & Control Center style Quick Menu
   ========================================================================== */
const WifiButton = GObject.registerClass({
    GTypeName: `MacWifiButton_${_UID}`,
}, class WifiButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Wi-Fi');

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            icon_name: 'network-wireless-signal-excellent-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this._nmClient = null;
        this._wifiDevice = null;
        this._currentAp = null;

        try {
            this._nmClient = NM.Client.new(null);
            this._findWifiDevice();
            this._nmClient.connectObject(
                'notify::wireless-enabled', () => this._sync(),
                'notify::connectivity', () => this._sync(),
                'device-added', () => { this._findWifiDevice(); this._sync(); },
                'device-removed', () => { this._findWifiDevice(); this._sync(); },
                this
            );
        } catch (e) {
            console.error(`[MenuBar] NM.Client error: ${e}`);
        }

        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open) {
                this._populateMenu();
                if (this._wifiDevice) {
                    try { this._wifiDevice.request_scan_async(null, null); } catch (_e) {}
                }
            }
        }, this);

        this._pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (this._icon) this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._pollTimerId) {
                GLib.source_remove(this._pollTimerId);
                this._pollTimerId = 0;
            }
            if (this._currentAp) {
                try { this._currentAp.disconnectObject(this); } catch (_e) {}
                this._currentAp = null;
            }
        });

        this._sync();
        try { this._populateMenu(); } catch (_) {}
    }

    _connectAp() {
        if (this._currentAp) {
            try { this._currentAp.disconnectObject(this); } catch (_e) {}
            this._currentAp = null;
        }
        if (this._wifiDevice) {
            this._currentAp = this._wifiDevice.get_active_access_point();
            if (this._currentAp) {
                this._currentAp.connectObject(
                    'notify::strength', () => this._sync(),
                    this
                );
            }
        }
    }

    _findWifiDevice() {
        if (!this._nmClient) return;
        const devices = this._nmClient.get_devices() || [];
        this._wifiDevice = devices.find(d => d.get_device_type() === NM.DeviceType.WIFI) || null;
        if (this._wifiDevice) {
            this._wifiDevice.connectObject(
                'notify::active-access-point', () => {
                    this._connectAp();
                    this._sync();
                },
                'state-changed', () => this._sync(),
                this
            );
            this._connectAp();
        }
    }

    _sync() {
        if (!this._nmClient || !this._nmClient.wireless_enabled) {
            this._icon.icon_name = 'network-wireless-disabled-symbolic';
            return;
        }
        if (!this._wifiDevice) {
            this._icon.icon_name = 'network-wireless-offline-symbolic';
            return;
        }

        const ap = this._wifiDevice.get_active_access_point();
        if (ap) {
            if (ap !== this._currentAp)
                this._connectAp();
            const strength = ap.get_strength();
            if (strength > 75)
                this._icon.icon_name = 'network-wireless-signal-excellent-symbolic';
            else if (strength > 50)
                this._icon.icon_name = 'network-wireless-signal-good-symbolic';
            else if (strength > 25)
                this._icon.icon_name = 'network-wireless-signal-ok-symbolic';
            else
                this._icon.icon_name = 'network-wireless-signal-weak-symbolic';
        } else if (this._wifiDevice.get_state() === NM.DeviceState.ACTIVATING) {
            this._icon.icon_name = 'network-wireless-acquiring-symbolic';
        } else {
            this._icon.icon_name = 'network-wireless-offline-symbolic';
        }
    }

    _populateMenu() {
        this.menu.removeAll();

        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        const activeAp = this._wifiDevice?.get_active_access_point();
        const activeSsid = activeAp?.get_ssid() ? NM.utils_ssid_to_utf8(activeAp.get_ssid().get_data()) : null;

        // 1. Control Center style Header Card
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
            style_class: 'mac-menu-header-card',
        });

        const headerBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        headerItem.add_child(headerBox);

        const iconClass = isEnabled ? 'mac-menu-toggle-icon' : 'mac-menu-toggle-icon mac-menu-toggle-icon-off';
        const toggleIcon = new St.Icon({
            icon_name: 'network-wireless-signal-excellent-symbolic',
            icon_size: 16,
            style_class: iconClass,
        });
        headerBox.add_child(toggleIcon);

        let subText = 'Вимкнено';
        if (isEnabled) {
            subText = activeSsid ? activeSsid : 'Не підключено';
        }

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLbl = new St.Label({
            text: 'Wi–Fi',
            style_class: 'mac-menu-card-title',
        });
        const subLbl = new St.Label({
            text: subText,
            style_class: 'mac-menu-card-subtitle',
        });
        textCol.add_child(titleLbl);
        textCol.add_child(subLbl);
        headerBox.add_child(textCol);

        const sw = new PopupMenu.Switch(isEnabled);
        sw.y_align = Clutter.ActorAlign.CENTER;
        headerBox.add_child(sw);

        headerItem.connect('activate', () => {
            const newState = !sw.state;
            sw.state = newState;
            if (this._nmClient) {
                this._nmClient.wireless_enabled = newState;
            }
            this._populateMenu();
            this._sync();
        });
        this.menu.addMenuItem(headerItem);

        // 2. Available Networks
        if (isEnabled && this._wifiDevice) {
            const secHeader = new PopupMenu.PopupMenuItem('Доступні мережі', { reactive: false });
            secHeader.label.add_style_class_name('mac-menu-section-label');
            this.menu.addMenuItem(secHeader);

            const aps = this._wifiDevice.get_access_points() || [];
            const apMap = new Map();
            for (const ap of aps) {
                const ssidBytes = ap.get_ssid();
                if (!ssidBytes) continue;
                const ssid = NM.utils_ssid_to_utf8(ssidBytes.get_data());
                if (!ssid || ssid.trim() === '') continue;
                if (!apMap.has(ssid) || apMap.get(ssid).strength < ap.get_strength()) {
                    apMap.set(ssid, {
                        ssid,
                        ap,
                        strength: ap.get_strength(),
                        isSecure: ap.get_flags() !== 0 || ap.get_wpa_flags() !== 0 || ap.get_rsn_flags() !== 0,
                    });
                }
            }

            const sortedAps = Array.from(apMap.values()).sort((a, b) => {
                if (a.ssid === activeSsid) return -1;
                if (b.ssid === activeSsid) return 1;
                return b.strength - a.strength;
            });

            if (sortedAps.length === 0) {
                const noAps = new PopupMenu.PopupMenuItem('Мереж не знайдено', { reactive: false });
                this.menu.addMenuItem(noAps);
            } else {
                for (const info of sortedAps.slice(0, 8)) {
                    const isConnected = info.ssid === activeSsid;
                    const apItem = new PopupMenu.PopupBaseMenuItem({
                        reactive: true,
                        style_class: isConnected ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
                    });

                    let strengthIcon = 'network-wireless-signal-excellent-symbolic';
                    if (info.strength <= 25) strengthIcon = 'network-wireless-signal-weak-symbolic';
                    else if (info.strength <= 50) strengthIcon = 'network-wireless-signal-ok-symbolic';
                    else if (info.strength <= 75) strengthIcon = 'network-wireless-signal-good-symbolic';

                    const sigIcon = new St.Icon({
                        icon_name: strengthIcon,
                        icon_size: 15,
                        style_class: 'popup-menu-icon',
                    });
                    apItem.add_child(sigIcon);

                    const label = new St.Label({
                        text: info.ssid,
                        x_expand: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    apItem.add_child(label);

                    if (info.isSecure) {
                        const lockIcon = new St.Icon({
                            icon_name: 'channel-secure-symbolic',
                            icon_size: 12,
                            style_class: 'popup-menu-icon-suffix',
                        });
                        apItem.add_child(lockIcon);
                    }

                    if (isConnected) {
                        const checkIcon = new St.Icon({
                            icon_name: 'emblem-ok-symbolic',
                            icon_size: 14,
                            style_class: 'popup-menu-icon-suffix',
                        });
                        apItem.add_child(checkIcon);
                    }

                    apItem.connect('activate', () => {
                        this.menu.close();
                        if (isConnected) {
                            const activeConn = this._wifiDevice.get_active_connection();
                            if (activeConn && this._nmClient)
                                this._nmClient.deactivate_connection(activeConn, null);
                        } else {
                            const connections = this._nmClient?.get_connections() || [];
                            const conn = connections.find(c => {
                                const s = c.get_setting_wireless();
                                if (!s) return false;
                                const s_ssid = s.get_ssid();
                                return s_ssid && NM.utils_ssid_to_utf8(s_ssid.get_data()) === info.ssid;
                            });
                            if (conn) {
                                this._nmClient.activate_connection_async(conn, this._wifiDevice, null, null, null);
                            } else {
                                this._openSettings('wifi');
                            }
                        }
                    });

                    this.menu.addMenuItem(apItem);
                }
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 3. Settings Footer
        const settingsItem = new PopupMenu.PopupMenuItem('Параметри Wi–Fi...', { style_class: 'mac-menu-footer-button' });
        settingsItem.connect('activate', () => {
            this.menu.close();
            this._openSettings('wifi');
        });
        this.menu.addMenuItem(settingsItem);
    }

    _openSettings(panel) {
        try {
            GLib.spawn_command_line_async(`gnome-control-center ${panel}`);
        } catch (_e) {}
    }
});

/* ==========================================================================
   2. Bluetooth Status Button & Control Center style Quick Menu
   ========================================================================== */
const BluetoothButton = GObject.registerClass({
    GTypeName: `MacBluetoothButton_${_UID}`,
}, class BluetoothButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Bluetooth');

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            icon_name: 'bluetooth-active-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        try {
            this._btClient = new GnomeBluetooth.Client();
            this._btClient.connectObject(
                'notify::default-adapter-powered', () => this._sync(),
                'notify::default-adapter-state', () => this._sync(),
                this
            );
        } catch (e) {
            console.error(`[MenuBar] GnomeBluetooth error: ${e}`);
        }

        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open)
                this._populateMenu();
        }, this);

        this._pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (this._icon) this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._pollTimerId) {
                GLib.source_remove(this._pollTimerId);
                this._pollTimerId = 0;
            }
        });

        this._sync();
        try { this._populateMenu(); } catch (_) {}
    }

    _sync() {
        const powered = Boolean(this._btClient?.default_adapter_powered);
        this._icon.icon_name = powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
    }

    _populateMenu() {
        this.menu.removeAll();

        const powered = Boolean(this._btClient?.default_adapter_powered);

        // 1. Header Card with Toggle
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
            style_class: 'mac-menu-header-card',
        });

        const headerBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        headerItem.add_child(headerBox);

        const iconClass = powered ? 'mac-menu-toggle-icon' : 'mac-menu-toggle-icon mac-menu-toggle-icon-off';
        const toggleIcon = new St.Icon({
            icon_name: 'bluetooth-active-symbolic',
            icon_size: 16,
            style_class: iconClass,
        });
        headerBox.add_child(toggleIcon);

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLbl = new St.Label({
            text: 'Bluetooth',
            style_class: 'mac-menu-card-title',
        });
        const subLbl = new St.Label({
            text: powered ? 'Увімкнено' : 'Вимкнено',
            style_class: 'mac-menu-card-subtitle',
        });
        textCol.add_child(titleLbl);
        textCol.add_child(subLbl);
        headerBox.add_child(textCol);

        const sw = new PopupMenu.Switch(powered);
        sw.y_align = Clutter.ActorAlign.CENTER;
        headerBox.add_child(sw);

        headerItem.connect('activate', () => {
            const newState = !sw.state;
            sw.state = newState;
            if (this._btClient) {
                this._btClient.default_adapter_powered = newState;
            }
            this._populateMenu();
            this._sync();
        });
        this.menu.addMenuItem(headerItem);

        // 2. Devices List
        if (powered) {
            const secHeader = new PopupMenu.PopupMenuItem('Пристрої', { reactive: false });
            secHeader.label.add_style_class_name('mac-menu-section-label');
            this.menu.addMenuItem(secHeader);

            const devices = this._btClient?.get_devices?.() || [];
            if (devices.length === 0) {
                const emptyItem = new PopupMenu.PopupMenuItem('Пристроїв не знайдено', { reactive: false });
                this.menu.addMenuItem(emptyItem);
            } else {
                for (const dev of devices) {
                    const devItem = new PopupMenu.PopupBaseMenuItem({
                        reactive: true,
                        style_class: dev.connected ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
                    });

                    const iconName = dev.icon || 'bluetooth-active-symbolic';
                    const devIcon = new St.Icon({
                        icon_name: iconName,
                        icon_size: 15,
                        style_class: 'popup-menu-icon',
                    });
                    devItem.add_child(devIcon);

                    const label = new St.Label({
                        text: dev.name || dev.alias || 'Пристрій',
                        x_expand: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    devItem.add_child(label);

                    const statusLabel = new St.Label({
                        text: dev.connected ? 'Підключено' : 'Відключено',
                        style_class: dev.connected ? 'popup-status-connected' : 'popup-status-disconnected',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    devItem.add_child(statusLabel);

                    devItem.connect('activate', () => {
                        this.menu.close();
                        try {
                            const path = dev.get_object_path?.();
                            if (this._btClient && path) {
                                this._btClient.connect_service(path, !dev.connected, null, null);
                            } else if (dev.connect_service) {
                                if (dev.connected)
                                    dev.disconnect_service?.(null);
                                else
                                    dev.connect_service?.(null);
                            }
                        } catch (e) {
                            console.error(`[MenuBar] Bluetooth connect error: ${e}`);
                        }
                    });

                    this.menu.addMenuItem(devItem);
                }
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Параметри Bluetooth...', { style_class: 'mac-menu-footer-button' });
        settingsItem.connect('activate', () => {
            this.menu.close();
            GLib.spawn_command_line_async('gnome-control-center bluetooth');
        });
        this.menu.addMenuItem(settingsItem);
    }
});

/* ==========================================================================
   3. Volume / Sound Button & Control Center style Quick Menu
   ========================================================================== */
const VolumeButton = GObject.registerClass({
    GTypeName: `MacVolumeButton_${_UID}`,
}, class VolumeButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Sound');

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            icon_name: 'audio-volume-high-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this._control = getMixerControl();
        this._currentSink = null;
        this._connectSink = () => {
            if (this._currentSink) {
                try { this._currentSink.disconnectObject(this); } catch (_e) {}
                this._currentSink = null;
            }
            this._currentSink = this._control.get_default_sink();
            if (this._currentSink) {
                this._currentSink.connectObject(
                    'notify::volume', () => this._sync(),
                    'notify::is-muted', () => this._sync(),
                    this
                );
            }
        };

        this._control.connectObject(
            'state-changed', () => this._sync(),
            'default-sink-changed', () => {
                this._connectSink();
                this._sync();
            },
            'stream-changed', () => this._sync(),
            this
        );
        this._connectSink();

        this.connect('scroll-event', (_actor, event) => {
            const sink = this._control.get_default_sink();
            if (!sink) return Clutter.EVENT_PROPAGATE;

            const max = this._control.get_vol_max_norm();
            const step = max * 0.05;
            let current = sink.get_volume();

            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) {
                current = Math.min(max, current + step);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                current = Math.max(0, current - step);
            } else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [, dy] = event.get_scroll_delta();
                current = Math.max(0, Math.min(max, current - dy * step));
            }

            sink.set_volume(current);
            sink.push_volume();
            this._sync();
            return Clutter.EVENT_STOP;
        });

        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open)
                this._populateMenu();
        }, this);

        this._pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (this._icon) this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._pollTimerId) {
                GLib.source_remove(this._pollTimerId);
                this._pollTimerId = 0;
            }
            if (this._currentSink) {
                try { this._currentSink.disconnectObject(this); } catch (_e) {}
                this._currentSink = null;
            }
        });

        this._sync();
        try { this._populateMenu(); } catch (_) {}
    }

    _sync() {
        const sink = this._control.get_default_sink();
        if (sink !== this._currentSink) {
            this._connectSink();
        }
        if (!sink) {
            this._icon.icon_name = 'audio-volume-muted-symbolic';
            return;
        }

        const max = this._control.get_vol_max_norm();
        const vol = sink.get_volume() / (max || 1);
        const isMuted = sink.get_is_muted();

        if (isMuted || vol <= 0.01) {
            this._icon.icon_name = 'audio-volume-muted-symbolic';
        } else if (vol < 0.34) {
            this._icon.icon_name = 'audio-volume-low-symbolic';
        } else if (vol < 0.67) {
            this._icon.icon_name = 'audio-volume-medium-symbolic';
        } else {
            this._icon.icon_name = 'audio-volume-high-symbolic';
        }
    }

    _populateMenu() {
        this.menu.removeAll();

        const sink = this._control.get_default_sink();
        const max = this._control.get_vol_max_norm() || 1;
        const currentVol = sink ? sink.get_volume() / max : 0.5;

        // 1. Control Center style Slider Card
        const sliderCard = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'mac-menu-header-card mac-menu-slider-card',
        });

        const sliderBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'spacing: 12px;',
        });
        sliderCard.add_child(sliderBox);

        const volIcon = new St.Icon({
            icon_name: sink?.get_is_muted() ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic',
            icon_size: 16,
            reactive: true,
            can_focus: true,
            style_class: 'mac-menu-toggle-icon',
        });
        volIcon.connect('button-press-event', () => {
            if (sink) {
                sink.change_is_muted(!sink.get_is_muted());
                this._populateMenu();
                this._sync();
            }
            return Clutter.EVENT_STOP;
        });
        sliderBox.add_child(volIcon);

        const slider = new Slider(sink?.get_is_muted() ? 0 : currentVol);
        slider.x_expand = true;

        const percentLabel = new St.Label({
            text: `${Math.round(currentVol * 100)}%`,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-slider-percent-label',
        });

        slider.connect('notify::value', () => {
            const val = slider.value;
            percentLabel.text = `${Math.round(val * 100)}%`;
            if (sink) {
                if (sink.get_is_muted() && val > 0)
                    sink.change_is_muted(false);
                sink.set_volume(Math.round(val * max));
                sink.push_volume();
                this._sync();
            }
        });

        sliderBox.add_child(slider);
        sliderBox.add_child(percentLabel);
        this.menu.addMenuItem(sliderCard);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Output Device Selection
        const secHeader = new PopupMenu.PopupMenuItem('Вихідний пристрій', { reactive: false });
        secHeader.label.add_style_class_name('mac-menu-section-label');
        this.menu.addMenuItem(secHeader);

        const sinks = this._control.get_sinks() || [];
        for (const s of sinks) {
            const isDefault = sink && s.get_id() === sink.get_id();
            const sinkItem = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                style_class: isDefault ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
            });

            const devIconName = s.get_name()?.toLowerCase()?.includes('headphone') ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic';
            const icon = new St.Icon({
                icon_name: devIconName,
                icon_size: 15,
                style_class: 'popup-menu-icon',
            });
            sinkItem.add_child(icon);

            const desc = new St.Label({
                text: s.get_description() || 'Аудіовихід',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            sinkItem.add_child(desc);

            if (isDefault) {
                const check = new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: 14,
                    style_class: 'popup-menu-icon-suffix',
                });
                sinkItem.add_child(check);
            }

            sinkItem.connect('activate', () => {
                this._control.set_default_sink(s);
                this.menu.close();
            });

            this.menu.addMenuItem(sinkItem);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Параметри звуку...', { style_class: 'mac-menu-footer-button' });
        settingsItem.connect('activate', () => {
            this.menu.close();
            GLib.spawn_command_line_async('gnome-control-center sound');
        });
        this.menu.addMenuItem(settingsItem);
    }
});

/* ==========================================================================
   4. Battery Indicator Widget (Display-only, non-reactive, single instance)
   ========================================================================== */
const BatteryWidget = GObject.registerClass({
    GTypeName: `MacBatteryWidget_${_UID}`,
}, class BatteryWidget extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Battery', true);

        this.reactive = false;
        this.can_focus = false;
        this.track_hover = false;
        this.add_style_class_name('mac-battery-indicator');

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._box);

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            icon_name: 'battery-full-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-battery-percentage',
            visible: false,
        });
        this._box.add_child(this._label);

        try {
            this._upowerClient = UPowerGlib.Client.new_full(null);
            this._upowerClient.connectObject(
                'device-added', () => this._sync(),
                'device-removed', () => this._sync(),
                this
            );
            this._upowerDevice = this._upowerClient.get_display_device();
            if (this._upowerDevice) {
                this._upowerDevice.connectObject(
                    'notify::percentage', () => this._sync(),
                    'notify::state', () => this._sync(),
                    'notify::icon-name', () => this._sync(),
                    'notify::is-present', () => this._sync(),
                    this
                );
            }
        } catch (e) {
            console.error(`[MenuBar] UPower error: ${e}`);
        }

        try {
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._interfaceSettings.connectObject('changed::show-battery-percentage', () => this._sync(), this);
        } catch (_e) {}

        this._pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            if (this._icon) this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._pollTimerId) {
                GLib.source_remove(this._pollTimerId);
                this._pollTimerId = 0;
            }
        });

        this._sync();
    }

    _sync() {
        if (!this._upowerDevice) return;
        const iconName = this._upowerDevice.icon_name || 'battery-full-symbolic';
        this._icon.icon_name = iconName;

        let showPercentage = false;
        try {
            if (this._interfaceSettings)
                showPercentage = this._interfaceSettings.get_boolean('show-battery-percentage');
        } catch (_e) {}

        if (showPercentage) {
            this._label.text = `${Math.round(this._upowerDevice.percentage)}%`;
            this._label.visible = true;
        } else {
            this._label.visible = false;
        }

        this.visible = this._upowerDevice.is_present;
    }
});

/* ==========================================================================
   5. Privacy Indicator (Microphone & Camera active pills)
   ========================================================================== */
const PrivacyIndicator = GObject.registerClass({
    GTypeName: `MacPrivacyIndicator_${_UID}`,
}, class PrivacyIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Privacy');

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._box);

        // Microphone Pill (Orange)
        this._micPill = new St.BoxLayout({
            style_class: 'mac-privacy-pill mac-privacy-pill-mic',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._micIcon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            icon_size: 12,
        });
        this._micPill.add_child(this._micIcon);
        this._box.add_child(this._micPill);

        // Camera Pill (Green)
        this._camPill = new St.BoxLayout({
            style_class: 'mac-privacy-pill mac-privacy-pill-cam',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._camIcon = new St.Icon({
            icon_name: 'camera-web-symbolic',
            icon_size: 12,
        });
        this._camPill.add_child(this._camIcon);
        this._box.add_child(this._camPill);

        this._control = getMixerControl();
        this._control.connectObject(
            'stream-added', () => this._sync(),
            'stream-removed', () => this._sync(),
            'stream-changed', () => this._sync(),
            'state-changed', () => this._sync(),
            this
        );

        const cam = Main.panel.statusArea.quickSettings?._camera?._cameraMonitor;
        if (cam) {
            cam.connectObject('notify::cameras-in-use', () => this._sync(), this);
        }

        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open)
                this._populateMenu();
        }, this);

        this._sync();
    }

    _sync() {
        const outputs = this._control?.get_source_outputs() || [];
        const isMicRecording = outputs.length > 0;
        this._micPill.visible = isMicRecording;

        const cam = Main.panel.statusArea.quickSettings?._camera?._cameraMonitor;
        const isCamActive = Boolean(cam?.cameras_in_use);
        this._camPill.visible = isCamActive;

        const hasAny = isMicRecording || isCamActive;
        this.visible = hasAny;
        if (this.container) {
            this.container.visible = hasAny;
            if (!hasAny) {
                this.container.style = 'margin: 0 !important; padding: 0 !important; width: 0 !important; min-width: 0 !important; -natural-hpadding: 0 !important; -minimum-hpadding: 0 !important;';
            } else {
                this.container.style = 'margin: 2px 2px !important; padding: 0 4px !important; height: 26px !important;';
                if (Main.panel?._rightBox) {
                    try {
                        Main.panel._rightBox.set_child_at_index(this.container, 0);
                    } catch (_) {}
                }
            }
        }
    }

    isRecordingOrCamActive() {
        const outputs = this._control?.get_source_outputs() || [];
        const cam = Main.panel.statusArea.quickSettings?._camera?._cameraMonitor;
        return (outputs.length > 0) || Boolean(cam?.cameras_in_use);
    }

    _populateMenu() {
        this.menu.removeAll();

        const header = new PopupMenu.PopupMenuItem('Конфіденційність', { reactive: false });
        header.label.add_style_class_name('mac-menu-header');
        this.menu.addMenuItem(header);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const outputs = this._control.get_source_outputs() || [];
        const cam = Main.panel.statusArea.quickSettings?._camera?._cameraMonitor;
        const isCamActive = Boolean(cam?.cameras_in_use);

        if (outputs.length > 0) {
            const micSec = new PopupMenu.PopupMenuItem('Мікрофон використовується', { reactive: false });
            micSec.label.add_style_class_name('mac-menu-section-label');
            this.menu.addMenuItem(micSec);

            for (const out of outputs) {
                const appName = out.get_name() || out.get_application_id() || 'Програма';
                const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
                item.add_style_class_name('mac-menu-item-row');
                const icon = new St.Icon({
                    icon_name: 'audio-input-microphone-symbolic',
                    icon_size: 14,
                    style_class: 'popup-menu-icon',
                });
                item.add_child(icon);
                const lbl = new St.Label({
                    text: `${appName}`,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                item.add_child(lbl);
                this.menu.addMenuItem(item);
            }
        }

        if (isCamActive) {
            const camSec = new PopupMenu.PopupMenuItem('Камера використовується', { reactive: false });
            camSec.label.add_style_class_name('mac-menu-section-label');
            this.menu.addMenuItem(camSec);

            const camItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
            camItem.add_style_class_name('mac-menu-item-row');
            const cIcon = new St.Icon({
                icon_name: 'camera-web-symbolic',
                icon_size: 14,
                style_class: 'popup-menu-icon',
            });
            camItem.add_child(cIcon);
            const cLbl = new St.Label({
                text: 'Програма використовує вебкамеру',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            camItem.add_child(cLbl);
            this.menu.addMenuItem(camItem);
        }
    }
});

/* ==========================================================================
   5b. Compiz Magic Lamp Deform Effect for Control Center
   ========================================================================== */
const CC_LAMP_DURATION_OPEN = 320;
const CC_LAMP_DURATION_CLOSE = 260;

export const ControlCenterMagicLampEffect = GObject.registerClass({
    GTypeName: `ControlCenterMagicLampEffect_${_UID}`,
}, class ControlCenterMagicLampEffect extends Clutter.DeformEffect {
    _init(params = {}) {
        super._init();
        this.button = params.button ?? null;
        this.isOpening = params.isOpening ?? true;
        this.isSlave = params.isSlave ?? false;
        this.slaveEffect = params.slaveEffect ?? null;
        this.duration = params.duration ?? (this.isOpening ? CC_LAMP_DURATION_OPEN : CC_LAMP_DURATION_CLOSE);
        this.surface = params.surface ?? null;
        this.onComplete = params.onComplete ?? null;

        this.timeline = null;
        this.newFrameId = null;
        this.completedId = null;
        this.initialized = false;

        this.winW = 0;
        this.winH = 0;
        this.iconX = 0;
        this.iconY = 0;
        this.iconW = 0;
        this.iconH = 0;

        this.pY = 0;
        this.pX = 0;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);
        if (!this.actor || this.initialized)
            return;

        this.initialized = true;
        this.set_n_tiles(14, 14);

        this._setupGeometry();

        if (this.isSlave) {
            // Driven synchronously by the master effect
            return;
        }

        this.timeline = new Clutter.Timeline({
            actor: this.actor,
            duration: this.duration,
        });

        this.newFrameId = this.timeline.connect('new-frame', () => this._onTick());
        this.completedId = this.timeline.connect('completed', () => this._onCompleted());

        this._onTick();
        this.timeline.start();
    }

    _setupGeometry() {
        if (!this.actor) return;

        [this.winW, this.winH] = this.actor.get_size();
        if (this.winW <= 0 || this.winH <= 0) {
            try {
                const [, , natW, natH] = this.actor.get_preferred_size();
                if (this.winW <= 0) this.winW = natW;
                if (this.winH <= 0) this.winH = natH;
            } catch (_e) {}
        }
        this.winW = Math.max(100, this.winW || 400);
        this.winH = Math.max(100, this.winH || 500);

        if (this.button) {
            try {
                const [btnStageX] = this.button.get_transformed_position();
                const [btnW] = this.button.get_transformed_size();
                const [actorStageX] = this.actor.get_transformed_position();

                this.iconW = Math.max(16, btnW || 34);
                this.iconX = btnStageX - actorStageX;
                if (isNaN(this.iconX) || this.iconX < 0 || this.iconX > this.winW) {
                    this.iconX = this.winW - this.iconW - 8;
                }
                this.iconY = 0;
                this.iconH = 0;
            } catch (_e) {
                this.iconW = 34;
                this.iconX = this.winW - 42;
                this.iconY = 0;
                this.iconH = 0;
            }
        } else {
            this.iconW = 34;
            this.iconX = this.winW - 42;
            this.iconY = 0;
            this.iconH = 0;
        }
    }

    _easeMac(t) {
        // Curve: peak velocity at t = 1/3 (t_peak = 0.333)
        // and smooth deceleration to zero at t = 1:
        // v(t) = 12 * t * (1 - t)^2
        // integral: 6*t^2 - 8*t^3 + 3*t^4
        const clampedT = Math.max(0, Math.min(1, t));
        const t2 = clampedT * clampedT;
        const t3 = t2 * clampedT;
        const t4 = t3 * clampedT;
        return 6 * t2 - 8 * t3 + 3 * t4;
    }

    _updateProgress(t) {
        if (!this.actor)
            return;
        try {
            if (!this.actor.get_parent?.())
                return;
        } catch (_e) {
            return;
        }

        const easedT = this._easeMac(t);
        this.pY = this.isOpening ? easedT : (1.0 - easedT);

        // Horizontal width animation:
        // Active during the second third of time (t in [1/3, 2/3]) with ease
        let pxNorm = 0;
        if (t <= 1 / 3) {
            pxNorm = 0;
        } else if (t >= 2 / 3) {
            pxNorm = 1.0;
        } else {
            const u = (t - 1 / 3) * 3; // 0 to 1 across the second third of time
            pxNorm = (1.0 - Math.cos(u * Math.PI)) / 2.0;
        }

        this.pX = this.isOpening ? pxNorm : (1.0 - pxNorm);

        const alpha = Math.min(1, Math.max(0, this.pY));
        const easedAlpha = this.isOpening
            ? Math.sin((alpha * Math.PI) / 2)
            : Math.pow(alpha, 1.2);
        const currentOpacity = Math.round(easedAlpha * 255);

        this.actor.opacity = currentOpacity;

        if (this.surface) {
            try {
                this.surface.update_surface_opacity(currentOpacity);
            } catch (_e) {}
        }

        try {
            this.actor.get_parent()?.queue_redraw();
            this.invalidate();
        } catch (_e) {}
    }

    _onTick() {
        if (!this.actor || !this.timeline)
            return;

        const t = this.timeline.get_progress();
        this._updateProgress(t);

        if (this.slaveEffect) {
            try {
                this.slaveEffect.syncProgress(t);
            } catch (_e) {}
        }
    }

    syncProgress(t) {
        if (!this.actor)
            return;
        this._updateProgress(t);
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized || this.winH <= 0 || this.winW <= 0)
            return;

        const propX = w / this.winW;
        const propY = h / this.winH;

        // 1. Downward vertical unfolding
        const curH = Math.max(1, this.winH * this.pY);
        const y = curH * v.ty;

        // 2. Horizontal position
        // ratio: 1.0 at top neck (v.ty = 0), 0.0 at bottom edge (v.ty = 1)
        const ratio = 1.0 - v.ty;

        // Undeformed coordinate vs pinched coordinate
        const xNorm = v.tx * this.winW;
        const xIcon = this.iconX + v.tx * this.iconW;

        // Neck pinch: smoothly disappears as pX reaches 1.0 (at pY = 0.5)
        const pinch = ratio * (1.0 - this.pX);
        const xBase = xNorm + pinch * (xIcon - xNorm);

        // Fluid genie wave (only active during neck expansion, vanishes when pX = 1)
        const wave = Math.sin((0.5 - ratio) * 2 * Math.PI) *
                     (xNorm - xIcon) * 0.12 * (1.0 - this.pX);

        v.x = (xBase + wave) * propX;
        v.y = y * propY;
    }

    vfunc_modify_paint_volume(_pv) {
        return false;
    }

    _onCompleted() {
        if (this.slaveEffect) {
            try { this.slaveEffect.destroy(); } catch (_e) {}
            this.slaveEffect = null;
        }
        const onComplete = this.onComplete;
        this.destroy();
        if (onComplete)
            onComplete();
    }

    destroy() {
        if (this.slaveEffect) {
            try { this.slaveEffect.destroy(); } catch (_e) {}
            this.slaveEffect = null;
        }

        if (this.timeline) {
            if (this.newFrameId) {
                this.timeline.disconnect(this.newFrameId);
                this.newFrameId = null;
            }
            if (this.completedId) {
                this.timeline.disconnect(this.completedId);
                this.completedId = null;
            }
            this.timeline.stop();
            this.timeline = null;
        }

        const actor = this.get_actor();
        if (actor) {
            try {
                actor.remove_effect(this);
            } catch (_e) {}
        }
    }
});

/* ==========================================================================
   5c. Compiz Magic Lamp Deform Effect for Individual Control Center Items
   ========================================================================== */
export const ItemMagicLampEffect = GObject.registerClass({
    GTypeName: `ItemMagicLampEffect_${_UID}`,
}, class ItemMagicLampEffect extends Clutter.DeformEffect {
    _init(params = {}) {
        super._init();
        this.targetX = isNaN(params.targetX) ? 0 : params.targetX;
        this.targetY = isNaN(params.targetY) ? 0 : params.targetY;
        this.isOpening = params.isOpening ?? true;
        this.itemW = params.itemW ?? 100;
        this.itemH = params.itemH ?? 40;
        this.pY = 0;
        this.pX = 0;
        this.initialized = false;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);
        if (!this.actor || this.initialized)
            return;
        this.initialized = true;
        this.set_n_tiles(8, 8);
    }

    updateProgress(pY, pX) {
        this.pY = pY;
        this.pX = pX;
        if (!this.actor)
            return;

        const alpha = Math.min(1, Math.max(0, this.pY));
        const easedAlpha = this.isOpening
            ? Math.sin((alpha * Math.PI) / 2)
            : Math.pow(alpha, 1.2);
        this.actor.opacity = Math.round(easedAlpha * 255);
        this.invalidate();
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized || w <= 0 || h <= 0)
            return;

        const restX = v.tx * w;
        const restY = v.ty * h;

        // 1. Vertical travel with neck lag (Compiz funnel)
        // Top neck stays closer to the button nozzle while bottom leads
        const lagFactor = 0.30 * (1.0 - v.ty);
        const effPY = Math.pow(Math.max(0, Math.min(1, this.pY)), 1.0 + lagFactor);
        const curY = this.targetY + (restY - this.targetY) * effPY;

        // 2. Horizontal position and magic lamp pinch
        // At nozzle: width is compressed to a small stream around targetX
        const neckX = this.targetX + (v.tx - 0.5) * Math.min(16, w * 0.15);

        // Funnel ratio: 1.0 at top neck, 0.0 at bottom edge
        const ratio = 1.0 - v.ty;
        const pinch = ratio * (1.0 - this.pX);
        const xBase = restX + pinch * (neckX - restX);

        // Compiz fluid genie wave (vanishes when pX reaches 1)
        const wave = Math.sin((0.5 - ratio) * 2 * Math.PI) *
                     (restX - this.targetX) * 0.12 * (1.0 - this.pX);

        v.x = isNaN(xBase + wave) ? restX : (xBase + wave);
        v.y = isNaN(curY) ? restY : curY;
    }

    vfunc_modify_paint_volume(_pv) {
        return false;
    }

    destroy() {
        const actor = this.get_actor();
        if (actor) {
            try {
                actor.remove_effect(this);
            } catch (_e) {}
        }
    }
});

export class ElementsAnimationController {
    constructor(params = {}) {
        this.button = params.button;
        this.menu = params.menu;
        this.boxPointer = params.boxPointer;
        this.surface = params.surface ?? null;
        this.surfaceActor = params.surfaceActor ?? null;
        this.isOpening = params.isOpening ?? true;
        this.duration = params.duration ?? (this.isOpening ? CC_LAMP_DURATION_OPEN : CC_LAMP_DURATION_CLOSE);
        this.onComplete = params.onComplete ?? null;

        this.timeline = null;
        this.effects = [];
        this._newFrameId = null;
        this._completedId = null;

        this._setup();
    }

    _setup() {
        if (!this.button || !this.boxPointer) return;

        // Collect all interactive items inside quickSettings menu
        const items = [];
        const grid = this.menu?._grid;
        if (grid) {
            for (const c of grid.get_children()) {
                if (!c || !c.visible) continue;
                if (grid.layout_manager?._placeholderActor && c === grid.layout_manager._placeholderActor)
                    continue;
                const [w, h] = c.get_size();
                if (w <= 0 && h <= 0) {
                    try {
                        const [, , natW, natH] = c.get_preferred_size();
                        if ((natW || 0) <= 0 && (natH || 0) <= 0) continue;
                    } catch (_e) {
                        continue;
                    }
                }
                items.push(c);
            }
        }
        if (this.menu?.box) {
            for (const c of this.menu.box.get_children()) {
                if (!c || !c.visible || c === grid) continue;
                items.push(c);
            }
        }

        if (items.length === 0) return;

        // Button center in stage coordinates
        let btnCenterX = 0;
        let btnCenterY = 0;
        try {
            const [btnStageX, btnStageY] = this.button.get_transformed_position();
            const [btnW, btnH] = this.button.get_transformed_size();
            btnCenterX = btnStageX + (btnW || 34) / 2;
            btnCenterY = btnStageY + (btnH || 28) / 2;
        } catch (_e) {
            const monitor = Main.layoutManager.primaryMonitor;
            btnCenterX = monitor ? (monitor.x + monitor.width - 30) : 1890;
            btnCenterY = 16;
        }

        let [bpStageX, bpStageY] = [0, 0];
        try {
            [bpStageX, bpStageY] = this.boxPointer.get_transformed_position();
        } catch (_e) {}

        for (const item of items) {
            let [itemStageX, itemStageY] = [0, 0];
            try {
                [itemStageX, itemStageY] = item.get_transformed_position();
            } catch (_e) {}

            let [itemW, itemH] = item.get_transformed_size();
            if (itemW <= 0 || itemH <= 0) {
                try {
                    const [, , natW, natH] = item.get_preferred_size();
                    if (itemW <= 0) itemW = natW;
                    if (itemH <= 0) itemH = natH;
                } catch (_e) {}
            }
            itemW = Math.max(20, itemW || 100);
            itemH = Math.max(20, itemH || 40);

            if (isNaN(itemStageX) || itemStageX <= 0) {
                itemStageX = (bpStageX || 0) + item.x;
                itemStageY = (bpStageY || 0) + item.y;
            }

            const targetX = btnCenterX - itemStageX;
            const targetY = btnCenterY - itemStageY;

            try {
                const effect = new ItemMagicLampEffect({
                    targetX,
                    targetY,
                    isOpening: this.isOpening,
                    itemW,
                    itemH,
                });

                item.add_effect_with_name('cc-item-lamp-effect', effect);
                this.effects.push({ item, effect });
            } catch (e) {
                console.error(`[MenuBar] Error attaching item lamp effect: ${e}`);
            }
        }

        this.timeline = new Clutter.Timeline({
            actor: this.boxPointer,
            duration: this.duration,
        });

        this._newFrameId = this.timeline.connect('new-frame', () => this._onTick());
        this._completedId = this.timeline.connect('completed', () => this._onCompleted());

        this._onTick();
        this.timeline.start();
    }

    _onTick() {
        if (!this.timeline) return;

        const t = this.timeline.get_progress();
        const clampedT = Math.max(0, Math.min(1, t));

        // Ease curve with peak speed at t = 1/3
        const t2 = clampedT * clampedT;
        const t3 = t2 * clampedT;
        const t4 = t3 * clampedT;
        const easedT = 6 * t2 - 8 * t3 + 3 * t4;

        const pY = this.isOpening ? easedT : (1.0 - easedT);

        // Width progress (2nd third)
        let pxNorm = 0;
        if (t <= 1 / 3) {
            pxNorm = 0;
        } else if (t >= 2 / 3) {
            pxNorm = 1.0;
        } else {
            const u = (t - 1 / 3) * 3;
            pxNorm = (1.0 - Math.cos(u * Math.PI)) / 2.0;
        }
        const pX = this.isOpening ? pxNorm : (1.0 - pxNorm);

        // Background glass fade (smooth sine alpha)
        const bgAlpha = this.isOpening
            ? Math.sin((easedT * Math.PI) / 2)
            : Math.pow(1.0 - easedT, 1.2);
        const bgOpacity = Math.round(bgAlpha * 255);

        if (this.surface) {
            try { this.surface.update_surface_opacity(bgOpacity); } catch (_e) {}
        }
        if (this.surfaceActor) {
            this.surfaceActor.opacity = bgOpacity;
        }

        // Update all item effects
        for (const { effect } of this.effects) {
            effect.updateProgress(pY, pX);
        }
    }

    _onCompleted() {
        const onComplete = this.onComplete;
        this.destroy();
        if (onComplete)
            onComplete();
    }

    destroy() {
        if (this.timeline) {
            if (this._newFrameId) {
                this.timeline.disconnect(this._newFrameId);
                this._newFrameId = null;
            }
            if (this._completedId) {
                this.timeline.disconnect(this._completedId);
                this._completedId = null;
            }
            this.timeline.stop();
            this.timeline = null;
        }

        for (const { item, effect } of this.effects) {
            try {
                item.remove_effect_by_name('cc-item-lamp-effect');
                effect.destroy();
            } catch (_e) {}
            try {
                item.opacity = 255;
            } catch (_e) {}
        }
        this.effects = [];
    }
}

/* MenuHoverTracker removed: reparenting menu.box breaks BoxPointer layout and causes empty context menus. */

function sanitizeQuickSettings(qs) {
    if (!qs) return;
    try {
        const grid = qs.menu?._grid;
        if (grid) {
            grid.visible = false;
            grid.hide();
            grid.style = 'margin: 0 !important; padding: 0 !important; width: 0px !important; min-width: 0px !important; height: 0px !important; min-height: 0px !important;';
            for (const child of grid.get_children()) {
                if (!child) continue;
                try {
                    if (Object.prototype.toString.call(child).includes('DISPOSED')) {
                        grid.remove_child(child);
                        continue;
                    }
                    if (child.has_style_class_name && child.has_style_class_name('quick-settings-system-item')) {
                        if (child._powerToggle) {
                            try {
                                if (Object.prototype.toString.call(child._powerToggle).includes('DISPOSED')) {
                                    child._powerToggle = {
                                        set: () => {},
                                        destroy: () => {},
                                        visible: false,
                                        reactive: false,
                                        add_style_class_name: () => {},
                                        remove_style_class_name: () => {},
                                        bind_property: () => ({ unbind: () => {} }),
                                        connect: () => 0,
                                        connectObject: () => {},
                                        disconnect: () => {},
                                        disconnectObject: () => {}
                                    };
                                }
                            } catch (_) {
                                child._powerToggle = {
                                    set: () => {},
                                    destroy: () => {},
                                    visible: false,
                                    reactive: false,
                                    add_style_class_name: () => {},
                                    remove_style_class_name: () => {},
                                    bind_property: () => ({ unbind: () => {} }),
                                    connect: () => 0,
                                    connectObject: () => {},
                                    disconnect: () => {},
                                    disconnectObject: () => {}
                                };
                            }
                        }
                    }
                } catch (_) {}
            }
        }
        if (qs._system) {
            try {
                if (qs._system._systemItem?._powerToggle && Object.prototype.toString.call(qs._system._systemItem._powerToggle).includes('DISPOSED')) {
                    qs._system._systemItem._powerToggle = {
                        set: () => {},
                        destroy: () => {},
                        visible: false,
                        reactive: false,
                        add_style_class_name: () => {},
                        remove_style_class_name: () => {},
                        bind_property: () => ({ unbind: () => {} }),
                        connect: () => 0,
                        connectObject: () => {},
                        disconnect: () => {},
                        disconnectObject: () => {}
                    };
                }
            } catch (_) {}
        }
    } catch (_) {}
}

function sanitizeDateMenu(dm) {
    if (!dm) return;
    try {
        if (dm._eventsItem) {
            try {
                if (Object.prototype.toString.call(dm._eventsItem).includes('DISPOSED')) {
                    dm._eventsItem = { setDate: () => {}, setEventSource: () => {}, destroy: () => {}, visible: false };
                }
            } catch (_) {
                dm._eventsItem = { setDate: () => {}, setEventSource: () => {}, destroy: () => {}, visible: false };
            }
        }
        if (dm._clocksItem) {
            try {
                if (Object.prototype.toString.call(dm._clocksItem).includes('DISPOSED')) {
                    dm._clocksItem = { setDate: () => {}, destroy: () => {}, visible: false };
                }
            } catch (_) {
                dm._clocksItem = { setDate: () => {}, destroy: () => {}, visible: false };
            }
        }
        if (dm._weatherItem) {
            try {
                if (Object.prototype.toString.call(dm._weatherItem).includes('DISPOSED')) {
                    dm._weatherItem = { setDate: () => {}, destroy: () => {}, visible: false };
                }
            } catch (_) {
                dm._weatherItem = { setDate: () => {}, destroy: () => {}, visible: false };
            }
        }
        if (dm._calendar) {
            try {
                if (Object.prototype.toString.call(dm._calendar).includes('DISPOSED')) {
                    dm._calendar = { setDate: () => {}, updateTimeZone: () => {}, destroy: () => {}, visible: false, connect: () => 0 };
                }
            } catch (_) {
                dm._calendar = { setDate: () => {}, updateTimeZone: () => {}, destroy: () => {}, visible: false, connect: () => 0 };
            }
        }
        if (dm._date) {
            try {
                if (Object.prototype.toString.call(dm._date).includes('DISPOSED')) {
                    dm._date = { setDate: () => {}, destroy: () => {}, visible: false };
                }
            } catch (_) {
                dm._date = { setDate: () => {}, destroy: () => {}, visible: false };
            }
        }
    } catch (_) {}
}

/* ==========================================================================
   6. Main MenuBar Controller
   ========================================================================== */
export const MenuBarController = class MenuBarController {
    constructor(connections, settings, effects_manager, popupBlur = null) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.popupBlur = popupBlur;
        this.enabled = false;
        this._origDateMenuParent = null;
        this._origIndicatorsParent = null;
        this._origQsReposition = null;
        this._origQsOpen = null;
        this._origQsClose = null;
        this._activeLampOpenEffect = null;
        this._activeLampCloseEffect = null;
        this._activeSurfaceLampEffect = null;
        this._activeElementsController = null;
        this._waiting_startup = false;

        this._wifiButton = null;
        this._bluetoothButton = null;
        this._volumeButton = null;
        this._batteryWidget = null;
        this._privacyIndicator = null;
        this._ccIcon = null;
        this._childAddedId = null;
        this._stylingMonitor = null;
        this._notifCenterActor = null;
        this._notifCenterLabel = null;
        this._notifCenterOpen = false;
        this._notifOutsideClickId = null;
        this._notifEscapeKeyId = null;
    }

    _getControlCenterAnimationMode() {
        try {
            const confFile = Gio.File.new_for_path(GLib.build_filenamev([
                GLib.get_user_config_dir(), 'mac-styling', 'control-center-animation.json'
            ]));
            if (confFile.query_exists(null)) {
                const [ok, bytes] = confFile.load_contents(null);
                if (ok) {
                    const decoder = new TextDecoder('utf-8');
                    const text = decoder.decode(bytes);
                    const data = JSON.parse(text);
                    if (data.mode === 'elements' || data.mode === 'window')
                        return data.mode;
                }
            }
        } catch (_e) {}

        return 'window';
    }

    _setupStylingMonitor() {
        try {
            const confDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling']);
            GLib.mkdir_with_parents(confDir, 0o755);
            const confPath = GLib.build_filenamev([confDir, 'styling.json']);
            const confFile = Gio.File.new_for_path(confPath);

            this._applyStylingRealtime();

            this._stylingMonitor = confFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._stylingMonitor.connect('changed', (_m, _f, _of, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CREATED) {
                    this._applyStylingRealtime();
                }
            });

            if (Main.overview) {
                Main.overview.connectObject('hidden', () => {
                    this._applyStylingRealtime();
                }, this);
            }
        } catch (e) {
            console.error('[MenuBarController] Error setting up styling monitor:', e);
        }
    }

    _applyStylingRealtime() {
        try {
            const confPath = GLib.build_filenamev([
                GLib.get_user_config_dir(), 'mac-styling', 'styling.json'
            ]);
            const confFile = Gio.File.new_for_path(confPath);
            if (!confFile.query_exists(null))
                return;

            const [ok, bytes] = confFile.load_contents(null);
            if (!ok) return;

            let text = new TextDecoder('utf-8').decode(bytes);
            text = text.replace(/:\s*(\d+),(\d+)/g, ': $1.$2');
            const data = JSON.parse(text);

            // 1. Panel tint (vertical gradient darkening from top to bottom, blurs wallpaper under it cleanly)
            if (typeof data.panel_tint === 'number' && Main.panel) {
                if (data.panel_tint <= 0.001) {
                    Main.panel.set_style('background-color: transparent !important; background: transparent !important; background-gradient-start: transparent !important; background-gradient-end: transparent !important;');
                } else {
                    Main.panel.set_style(`background-color: transparent !important; background-gradient-direction: vertical !important; background-gradient-start: rgba(0, 0, 0, ${data.panel_tint.toFixed(2)}) !important; background-gradient-end: rgba(0, 0, 0, 0.0) !important;`);
                }
            }

            // 2. Dock tint and radius
            const dTint = (typeof data.dock_tint === 'number') ? data.dock_tint : 0.10;
            const dRad = (typeof data.dock_radius === 'number') ? data.dock_radius : 28;
            this._updateDockRealtime(dTint, dRad);

            // 3. Notification tint and radius
            const nTint = (typeof data.notif_tint === 'number') ? data.notif_tint : 0.10;
            const nRad = (typeof data.notif_radius === 'number') ? data.notif_radius : 18;
            this._updateNotifRealtime(nTint, nRad);

            // 4. Popup menus tint
            const pTint = (typeof data.popup_tint === 'number') ? data.popup_tint : 0.10;
            this._updatePopupRealtime(pTint);

            // 5. AppIndicators delay fix
            this._patchAppIndicatorClickDelay();

            // 6. Overview MenuBar dynamic transition
            this._setupOverviewMenuBarAnimation();
        } catch (e) {
            console.error('[MenuBarController] Error applying realtime styling:', e);
        }
    }

    _setupOverviewMenuBarAnimation() {
        // Disabled in menubar.js to prevent duplicate frame-by-frame style recalculations
        // and avoid GPU blur shader stalls during overview swiping.
        // Handled cleanly and efficiently by panel.js via opacity crossfade.
    }

    _updatePopupRealtime(tint) {
        try {
            const style = `background-color: transparent !important; background: transparent !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35) !important; border-radius: 24px !important;`;
            const found = [];
            const walk = (actor) => {
                if (!actor) return;
                if (actor.has_style_class_name && actor.has_style_class_name('popup-menu-content') && !actor.has_style_class_name('quick-settings')) {
                    found.push(actor);
                }
                if (actor.get_children) {
                    const ch = actor.get_children();
                    for (let i = 0; i < ch.length; i++) walk(ch[i]);
                }
            };
            walk(Main.uiGroup);
            for (const menu of found) {
                menu.set_style(style);
            }
        } catch (e) {
            console.error('[MenuBarController] Error updating popup realtime:', e);
        }
    }

    _patchAppIndicatorClickDelay() {
        try {
            const patchTarget = (obj) => {
                if (!obj) return;
                let cur = obj;
                while (cur) {
                    if (typeof cur._waitForDoubleClick === 'function') {
                        cur._waitForDoubleClick = async function() {
                            this.menu?.toggle();
                        };
                    }
                    try {
                        if (cur.vfunc_button_press_event && !cur._instantClickPatched) {
                            cur._instantClickPatched = true;
                            const origBtn = cur.vfunc_button_press_event;
                            cur.vfunc_button_press_event = function(event) {
                                if (this._waitDoubleClickPromise)
                                    this._waitDoubleClickPromise.cancel();

                                if (event.get_button() === 2) {
                                    if (Main.panel.menuManager.activeMenu)
                                        Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
                                    this._indicator?.secondaryActivate(event.get_time(), ...event.get_coords());
                                    return 1;
                                }
                                if (event.get_button() === 3) {
                                    this.menu?.toggle();
                                    return 0;
                                }
                                if (event.get_button() === 1 && this.menu?.numMenuItems) {
                                    this.menu?.toggle();
                                    return 0;
                                }
                                return origBtn.call(this, event);
                            };
                        }
                    } catch (_) {}
                    cur = Object.getPrototypeOf(cur);
                }
            };

            if (Main.panel?.statusArea) {
                for (const item of Object.values(Main.panel.statusArea)) {
                    patchTarget(item);
                }
            }
            if (Main.panel?._rightBox) {
                for (const child of Main.panel._rightBox.get_children()) {
                    patchTarget(child);
                    if (child._delegate) patchTarget(child._delegate);
                }
            }
        } catch (e) {
            console.error('[MenuBarController] Error patching AppIndicator delay:', e);
        }
    }

    _updateDockRealtime(tint, radius) {
        try {
            const style = `background-color: rgba(36, 36, 36, ${tint.toFixed(2)}) !important; border-radius: ${radius}px !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35) !important;`;
            const found = [];
            const walk = (actor) => {
                if (!actor) return;
                if (actor.has_style_class_name && actor.has_style_class_name('dash-background')) {
                    found.push(actor);
                }
                if (actor.get_children) {
                    const ch = actor.get_children();
                    for (let i = 0; i < ch.length; i++) walk(ch[i]);
                }
            };
            walk(Main.uiGroup);
            for (const bg of found) {
                bg.set_style(style);
            }
        } catch (e) {
            console.error('[MenuBarController] Error updating dock realtime:', e);
        }
    }

    _updateNotifRealtime(tint, radius = 24) {
        try {
            const style = `background-color: rgba(36, 36, 36, ${tint.toFixed(2)}) !important; border-radius: ${radius}px !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35) !important;`;
            const found = [];
            const walk = (actor) => {
                if (!actor) return;
                if (actor.has_style_class_name && (
                    actor.has_style_class_name('mac-notification-banner') ||
                    actor.has_style_class_name('notification-banner')
                )) {
                    found.push(actor);
                }
                if (actor.get_children) {
                    const ch = actor.get_children();
                    for (let i = 0; i < ch.length; i++) walk(ch[i]);
                }
            };
            walk(Main.uiGroup);
            for (const banner of found) {
                banner.set_style(style);
            }
        } catch (e) {
            console.error('[MenuBarController] Error updating notif realtime:', e);
        }
    }

    _getCcBlurSurface() {
        return null;
    }

    _getCcBlurActor() {
        return null;
    }

    _removeStrayCcBlur(bp) {
        try {
            const qs = Main.panel?.statusArea?.quickSettings;
            if (!bp)
                bp = qs?.menu?._boxPointer;
            const menuActor = qs?.menu?.actor;

            const checkAndKill = (parent) => {
                if (!parent?.get_children) return;
                const children = parent.get_children();
                for (const child of children) {
                    if (child && (
                        child.name === 'bms-popup-blurred-widget' ||
                        (child.has_style_class_name && child.has_style_class_name('bms-popup-blurred-widget'))
                    )) {
                        let isCc = false;
                        if (bp && (child === bp || (bp.contains && bp.contains(child))))
                            isCc = true;
                        if (menuActor && (child === menuActor || (menuActor.contains && menuActor.contains(child))))
                            isCc = true;
                        if (!isCc && bp) {
                            try {
                                const bpExt = bp.get_transformed_extents ? bp.get_transformed_extents() : null;
                                const chExt = child.get_transformed_extents ? child.get_transformed_extents() : null;
                                if (bpExt && chExt) {
                                    if (Math.abs(chExt.x1 - bpExt.x1) < 30 && Math.abs(chExt.y1 - bpExt.y1) < 50)
                                        isCc = true;
                                }
                            } catch (_) {}
                        }
                        if (isCc) {
                            try {
                                parent.remove_child(child);
                                child.destroy();
                            } catch (_e) {}
                        }
                    }
                }
            };

            if (Main.uiGroup)
                checkAndKill(Main.uiGroup);
            if (bp?.get_parent())
                checkAndKill(bp.get_parent());
            if (menuActor?.get_parent())
                checkAndKill(menuActor.get_parent());
        } catch (_e) {}
    }

    _cleanupActiveEffects() {
        if (this._activeElementsController) {
            try { this._activeElementsController.destroy(); } catch (_e) {}
            this._activeElementsController = null;
        }
        if (this._activeLampOpenEffect) {
            try { this._activeLampOpenEffect.destroy(); } catch (_e) {}
            this._activeLampOpenEffect = null;
        }
        if (this._activeLampCloseEffect) {
            try { this._activeLampCloseEffect.destroy(); } catch (_e) {}
            this._activeLampCloseEffect = null;
        }
        if (this._activeSurfaceLampEffect) {
            try { this._activeSurfaceLampEffect.destroy(); } catch (_e) {}
            this._activeSurfaceLampEffect = null;
        }
        const bp = Main.panel?.statusArea?.quickSettings?.menu?._boxPointer;
        if (bp) {
            try { bp.remove_effect_by_name('cc-magic-lamp-effect'); } catch (_e) {}
        }
        const surfaceActor = this._getCcBlurActor();
        if (surfaceActor) {
            try { surfaceActor.remove_effect_by_name('cc-magic-lamp-surface-effect'); } catch (_e) {}
        }
    }

    _ensureLiquidGlassLoaded() {
        try {
            const lgUuid = 'liquid-glass@thinkingcoding1231.gmail.com';
            if (Main.extensionManager && !Main.extensionManager.lookup(lgUuid)) {
                const dir = Gio.File.new_for_path(GLib.build_filenamev([global.userdatadir, 'extensions', lgUuid]));
                if (dir.query_exists(null)) {
                    const ext = Main.extensionManager.createExtensionObject(lgUuid, dir, 1);
                    Main.extensionManager.loadExtension(ext);
                    console.log('[MenuBarController] Successfully dynamically loaded liquid-glass extension!');
                }
            }
        } catch (e) {
            console.error('[MenuBarController] Error dynamically loading liquid-glass:', e);
        }
    }

    enable() {
        if (this.enabled)
            return;

        const dateMenu = Main.panel?.statusArea?.dateMenu;
        const quickSettings = Main.panel?.statusArea?.quickSettings;

        if (!dateMenu?.container || !quickSettings?.container) {
            if (!this._waiting_startup) {
                this._waiting_startup = true;
                this.connections.connect(Main.layoutManager, 'startup-complete', () => {
                    this._waiting_startup = false;
                    this.enable();
                });
            }
            return;
        }

        this.enabled = true;
        globalThis._macNotificationCenter = this;

        // Setup real-time styling monitor
        this._setupStylingMonitor();

        // Ensure liquid-glass extension is discovered and loaded in Main.extensionManager
        this._ensureLiquidGlassLoaded();

        // 1. Setup Control Center single icon on QuickSettings & corner alignment
        this._setupControlCenterButton(quickSettings);

        // 2. Hide any user switcher account button completely
        this._hideUserSwitcher();

        // 3. Safely clean up any existing registrations and containers
        ['macPrivacy', 'macWifi', 'macBluetooth', 'macVolume', 'macBattery'].forEach(role => {
            const ind = Main.panel.statusArea[role];
            if (ind) {
                try { ind.destroy(); } catch (_e) {}
                delete Main.panel.statusArea[role];
            }
        });

        // 4. Create fresh status buttons
        this._batteryWidget = new BatteryWidget();
        this._volumeButton = new VolumeButton();
        this._bluetoothButton = new BluetoothButton();
        this._wifiButton = new WifiButton();
        this._privacyIndicator = new PrivacyIndicator();

        Main.panel.addToStatusArea('macPrivacy', this._privacyIndicator, 0, 'right');
        Main.panel.addToStatusArea('macWifi', this._wifiButton, 1, 'right');
        Main.panel.addToStatusArea('macBluetooth', this._bluetoothButton, 2, 'right');
        Main.panel.addToStatusArea('macVolume', this._volumeButton, 3, 'right');
        Main.panel.addToStatusArea('macBattery', this._batteryWidget, 4, 'right');

        // 5. Position dateMenu at the far right
        this._applyDateMenu(dateMenu);

        // 6. Order all items in _rightBox
        this._reorderRightBox();

        // 7. Setup sliding hover glide indicator for all context menus
        this._setupMenuHoverGlide();

        // 8. Watch for child additions to keep proper order and styling
        if (Main.panel?._rightBox) {
            this._childAddedId = Main.panel._rightBox.connect('child-added', () => {
                if (this.enabled)
                    this._scheduleReorder();
            });
        }
    }

    _hideUserSwitcher() {
        try {
            if (Main.panel.statusArea?.userSwitcher?.container) {
                Main.panel.statusArea.userSwitcher.container.visible = false;
                Main.panel.statusArea.userSwitcher.container.hide();
            }
        } catch (_e) {}
    }

    _setupControlCenterButton(quickSettings) {
        if (!quickSettings) return;

        // Keep multi-indicator container attached in scene graph, but hidden with zero dimensions
        if (quickSettings._indicators) {
            try {
                if (quickSettings._indicators.get_parent() !== quickSettings) {
                    if (quickSettings._indicators.get_parent()) {
                        quickSettings._indicators.get_parent().remove_child(quickSettings._indicators);
                    }
                    quickSettings.add_child(quickSettings._indicators);
                }
            } catch (_) {}
            quickSettings._indicators.visible = false;
            quickSettings._indicators.style = 'margin: 0 !important; padding: 0 !important; width: 0px !important; min-width: 0px !important; height: 0px !important; min-height: 0px !important;';
        }

        // Clean up only our own old CC icon
        if (this._ccIcon) {
            try {
                if (this._ccIcon.get_parent() === quickSettings)
                    quickSettings.remove_child(this._ccIcon);
                this._ccIcon.destroy();
            } catch (_e) {}
            this._ccIcon = null;
        }

        // Add macOS Control Center icon from /home/vitaliy/.themes/MacTahoe-Dark/icons/control-center.png
        try {
            if (GLib.file_test(CC_PNG_PATH, GLib.FileTest.EXISTS)) {
                const ccFile = Gio.File.new_for_path(CC_PNG_PATH);
                const ccFileIcon = new Gio.FileIcon({ file: ccFile });
                this._ccIcon = new St.Icon({
                    gicon: ccFileIcon,
                    style_class: 'system-status-icon mac-control-center-icon',
                    icon_size: 18,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            } else {
                this._ccIcon = new St.Icon({
                    icon_name: 'preferences-system-symbolic',
                    style_class: 'system-status-icon mac-control-center-icon',
                    icon_size: 18,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            }
            this._ccIcon.visible = true;
            this._ccIcon.show();
            // CRITICAL: Insert at index 0 so PanelMenu.ButtonBox (which only allocates first child) allocates this icon!
            quickSettings.insert_child_at_index(this._ccIcon, 0);
        } catch (e) {
            console.error(`[MenuBar] Error creating CC icon: ${e}`);
        }

        // GNOME 46 QuickSettings inherits from PanelMenu.ButtonBox which ONLY allocates child 0.
        // Overriding vfunc_allocate ensures all visible children (including _ccIcon) receive proper allocations.
        quickSettings.vfunc_allocate = function(box) {
            this.set_allocation(box);
            const availWidth = box.x2 - box.x1;
            const availHeight = box.y2 - box.y1;
            const childBox = new Clutter.ActorBox();
            childBox.x1 = 0;
            childBox.x2 = availWidth;
            childBox.y1 = 0;
            childBox.y2 = availHeight;
            for (const child of this.get_children()) {
                if (child && child.visible)
                    child.allocate(childBox);
            }
        };

        // Ensure container is attached to Main.panel._rightBox and always visible
        if (quickSettings.container) {
            try {
                if (!Main.panel._rightBox.contains(quickSettings.container)) {
                    const curParent = quickSettings.container.get_parent ? quickSettings.container.get_parent() : null;
                    if (curParent) curParent.remove_child(quickSettings.container);
                    Main.panel._rightBox.add_child(quickSettings.container);
                }
            } catch (_e) {}
            quickSettings.container.name = 'quickSettings';
            quickSettings.container.add_style_class_name('mac-control-center-button');
            quickSettings.container.visible = true;
            quickSettings.container.show();
            quickSettings.container.style = 'margin: 2px 4px !important; padding: 0 !important; width: 34px !important; height: 28px !important; min-width: 34px !important; min-height: 28px !important;';
        }

        // Make button width roughly equal to height (34px x 28px) and zero horizontal padding
        quickSettings.name = 'quickSettings';
        quickSettings.add_style_class_name('mac-control-center-button');
        quickSettings.visible = true;
        quickSettings.show();
        quickSettings.reactive = true;
        quickSettings.can_focus = true;
        quickSettings.track_hover = true;
        quickSettings._minHPadding = 0;
        quickSettings._natHPadding = 0;
        quickSettings.style = 'margin: 0 !important; padding: 0 !important; width: 34px !important; height: 28px !important; min-width: 34px !important; min-height: 28px !important;';

        if (!quickSettings._macStyleConnected) {
            quickSettings._macStyleConnected = true;
            quickSettings.connect('style-changed', () => {
                quickSettings._minHPadding = 0;
                quickSettings._natHPadding = 0;
            });
        }

        // Add direct click & touch handlers so left clicking the button always toggles the menu
        if (!quickSettings._directClickConnected) {
            quickSettings._directClickConnected = true;
            quickSettings.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === 1) {
                    try {
                        sanitizeQuickSettings(quickSettings);
                        quickSettings.menu?.toggle();
                    } catch (e) {
                        console.error('[MenuBar] Error toggling quickSettings:', e);
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            quickSettings.connect('touch-event', (_actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                    try {
                        sanitizeQuickSettings(quickSettings);
                        quickSettings.menu?.toggle();
                    } catch (e) {
                        console.error('[MenuBar] Error toggling quickSettings:', e);
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        // Setup macOS Tahoe Control Center inside quickSettings.menu
        if (quickSettings.menu?.box) {
            // Clean up any pre-existing or duplicate mac-control-center-root
            const toRemove = [];
            for (const child of quickSettings.menu.box.get_children()) {
                if (child.has_style_class_name && child.has_style_class_name('mac-control-center-root')) {
                    toRemove.push(child);
                }
            }
            for (const c of toRemove) {
                quickSettings.menu.box.remove_child(c);
                try { c.destroy(); } catch (_) {}
            }
            if (this._macControlCenter) {
                try { this._macControlCenter.destroy(); } catch (_) {}
                this._macControlCenter = null;
            }

            try {
                this._macControlCenter = new MacControlCenter(quickSettings.menu);
                if (quickSettings.menu._grid) {
                    quickSettings.menu._grid.visible = false;
                    quickSettings.menu._grid.hide();
                    quickSettings.menu._grid.style = 'margin: 0 !important; padding: 0 !important; width: 0px !important; min-width: 0px !important; height: 0px !important; min-height: 0px !important; opacity: 0 !important;';
                }
                quickSettings.menu.box.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important;';
                quickSettings.menu.box.add_child(this._macControlCenter.container);
                this._macControlCenter.container.visible = true;
                this._macControlCenter.container.show();
            } catch (e) {
                console.error(`[MenuBar] Error initializing MacControlCenter: ${e}`);
            }
        }

        // Right-align Control Center menu flush to top-right corner and install smooth slide-in animation
        if (quickSettings.menu?._boxPointer) {
            const bp = quickSettings.menu._boxPointer;
            bp._arrowAlignment = 1.0;
            if (typeof bp.setSourceAlignment === 'function')
                bp.setSourceAlignment(1.0);

            // Hook reposition to always position flush in top-right corner
            bp._reposition = function(allocationBox) {
                try {
                    Object.getPrototypeOf(bp)._reposition.call(this, allocationBox);
                } catch (_e) {}
                const monitor = Main.layoutManager.primaryMonitor;
                if (monitor && allocationBox) {
                    try {
                        const [, natWidth] = this.get_preferred_width(-1);
                        const w = Math.max(natWidth || 0, this.width || 0, 346);
                        const targetX = monitor.x + monitor.width - w - 12;
                        const curOrigin = allocationBox.get_origin();
                        allocationBox.set_origin(Math.floor(targetX), Math.floor(curOrigin[1]));
                    } catch (_e) {}
                }
            };

            const self = this;

            this.connections.connect(quickSettings.menu, 'open-state-changed', (_m, open) => {
                if (open) {
                    if (quickSettings.menu._grid) {
                        quickSettings.menu._grid.visible = false;
                        quickSettings.menu._grid.hide();
                    }
                    if (bp) {
                        sanitizeQuickSettings(quickSettings);
                        const monitor = Main.layoutManager.primaryMonitor;
                        if (monitor) {
                            const [, natWidth] = bp.get_preferred_width(-1);
                            const w = Math.max(natWidth || 0, bp.width || 0, 346);
                            bp.x = monitor.x + monitor.width - w - 12;
                            bp.y = monitor.y + 36;
                        }

                        // Remove solid backgrounds on bp, bin, and menu box
                        bp.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important;';
                        if (bp.bin)
                            bp.bin.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important;';
                        if (quickSettings.menu?.box)
                            quickSettings.menu.box.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important;';

                        // Instant slide-in from right side animation
                        bp.remove_all_transitions();
                        bp.translation_x = 220;
                        bp.opacity = 0;
                        bp.ease({
                            translation_x: 0,
                            opacity: 255,
                            duration: 240,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                    }

                    // Run heavy syncs in idle to eliminate opening lag!
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (self._macControlCenter) {
                            self._macControlCenter.syncAll();
                            if (self._macControlCenter._currentSubmenu) {
                                self._macControlCenter.closeSubmenu();
                            }
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    if (bp) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 210, () => {
                            if (!quickSettings.menu.isOpen && bp) {
                                bp.hide();
                                bp.translation_x = 0;
                                bp.opacity = 0;
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
                self._removeStrayCcBlur(bp);
            });

            // Smooth Slide-in from Right Side Animation
            bp.open = function(animate, onComplete) {
                sanitizeQuickSettings(quickSettings);
                const isAnimated = (animate !== false && animate !== 0);
                self._cleanupActiveEffects();
                self._removeStrayCcBlur(bp);

                const monitor = Main.layoutManager.primaryMonitor;
                if (monitor) {
                    const [, natWidth] = bp.get_preferred_width(-1);
                    const w = Math.max(natWidth || 0, bp.width || 0, 346);
                    bp.x = monitor.x + monitor.width - w - 12;
                    bp.y = monitor.y + 36;
                }

                bp._muteKeys = false;
                bp._muteInput = false;
                bp.show();
                if (quickSettings.menu?.actor) quickSettings.menu.actor.show();
                if (quickSettings.menu?.box) quickSettings.menu.box.show();
                if (bp.bin) bp.bin.show();

                const surface = self._getCcBlurSurface();
                const surfaceActor = surface?.actor || self._getCcBlurActor();
                if (surface) {
                    try { surface.show_actors(); } catch (_e) {}
                    surface.update_surface_opacity(255);
                } else if (surfaceActor) {
                    surfaceActor.show();
                    surfaceActor.opacity = 255;
                }
                if (surfaceActor && surfaceActor !== bp) {
                    surfaceActor.translation_x = 220;
                    surfaceActor.remove_all_transitions();
                    surfaceActor.ease({
                        translation_x: 0,
                        duration: 240,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                }

                if (!isAnimated) {
                    bp.translation_x = 0;
                    bp.opacity = 255;
                    onComplete?.();
                    return;
                }

                bp.translation_x = 220;
                bp.opacity = 0;
                bp.remove_all_transitions();
                bp.ease({
                    translation_x: 0,
                    opacity: 255,
                    duration: 240,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        bp.translation_x = 0;
                        bp.opacity = 255;
                        onComplete?.();
                    },
                });
            };

            // Smooth Slide-out to Right Side Animation
            bp.close = function(animate, onComplete) {
                if (!bp.visible) {
                    onComplete?.();
                    return;
                }

                const isAnimated = (animate !== false && animate !== 0);
                self._cleanupActiveEffects();

                bp._muteInput = true;
                bp._muteKeys = true;

                const surface = self._getCcBlurSurface();
                const surfaceActor = surface?.actor || self._getCcBlurActor();

                let completed = false;
                const finish = () => {
                    if (completed) return;
                    completed = true;
                    bp.hide();
                    bp.translation_x = 0;
                    bp.opacity = 0;
                    if (surface) {
                        try { surface.update_surface_opacity(0); surface.hide_actors(); } catch (_) {}
                    }
                    if (surfaceActor && surfaceActor !== bp) {
                        surfaceActor.opacity = 0;
                        surfaceActor.translation_x = 220;
                        surfaceActor.hide();
                    }
                    onComplete?.();
                };

                if (!isAnimated) {
                    finish();
                    return;
                }

                if (surfaceActor && surfaceActor !== bp) {
                    surfaceActor.remove_all_transitions();
                    surfaceActor.ease({
                        translation_x: 220,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                        onComplete: () => {
                            if (surface) surface.update_surface_opacity(0);
                            surfaceActor.hide();
                        },
                    });
                }

                bp.remove_all_transitions();
                bp.ease({
                    translation_x: 220,
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: finish,
                });

                // Fallback guarantee: ensures bp is hidden even if foreign extensions cancel transitions
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 210, () => {
                    finish();
                    return GLib.SOURCE_REMOVE;
                });
            };
        }
    }

    _applyDateMenu(dateMenu) {
        if (!dateMenu) return;
        const container = dateMenu.container;
        const currentParent = container.get_parent ? container.get_parent() : null;

        if (!Main.panel._rightBox.contains(container)) {
            this._origDateMenuParent = currentParent;
            if (currentParent)
                currentParent.remove_child(container);
            Main.panel._rightBox.add_child(container);
        } else {
            try { Main.panel._rightBox.set_child_above_sibling(container, null); } catch (_e) {}
        }

        // Clean up direct handlers from before
        if (dateMenu._directClickId) {
            try { dateMenu.disconnect(dateMenu._directClickId); } catch (_) {}
            dateMenu._directClickId = null;
        }
        if (dateMenu._directTouchId) {
            try { dateMenu.disconnect(dateMenu._directTouchId); } catch (_) {}
            dateMenu._directTouchId = null;
        }

        dateMenu.reactive = true;
        dateMenu.can_focus = true;
        dateMenu.track_hover = true;

        // Container margin click support
        if (container && container !== dateMenu) {
            container.reactive = true;
            if (container._clickConnId) {
                try { container.disconnect(container._clickConnId); } catch (_) {}
            }
            container._clickConnId = container.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === 1) {
                    this._toggleNotificationCenter();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        // Mutual exclusion: opening one closes the other.
        // Hover switching between Control Center (QuickSettings) and Notification Center is strictly DISABLED.
        // Switching is only permitted upon click.
        const qs = Main.panel?.statusArea?.quickSettings;
        if (qs) {
            if (this._qsHoverSwitchId) {
                try { qs.disconnect(this._qsHoverSwitchId); } catch (_) {}
                this._qsHoverSwitchId = null;
            }

            if (qs.menu && !qs.menu._macNotifCloseConn) {
                qs.menu._macNotifCloseConn = qs.menu.connect('open-state-changed', (_m, open) => {
                    if (open && this._notifCenterOpen) {
                        this._closeNotificationCenter();
                    }
                });
            }
        }

        if (this._dmHoverSwitchId) {
            try { dateMenu.disconnect(this._dmHoverSwitchId); } catch (_) {}
            this._dmHoverSwitchId = null;
        }

        if (container && container !== dateMenu) {
            if (this._dmContainerHoverSwitchId) {
                try { container.disconnect(this._dmContainerHoverSwitchId); } catch (_) {}
                this._dmContainerHoverSwitchId = null;
            }
        }

        // macOS MenuBar Interaction Model:
        // When Control Center (QuickSettings) or Notification Center (DateMenu) is open:
        // 1. Hover-switching is strictly disabled. Moving the mouse across other buttons
        //    (Wi-Fi, Bluetooth, Sound, Battery, Keyboard, AppIndicators) does NOT open them.
        // 2. Opening any other menu requires explicitly pressing that button ("потрібно натиснути на іншу кнопку").
        // 3. When the user clicks on another button in the menu bar, it immediately switches in ONE single click.
        if (Main.panel?.menuManager) {
            const pmm = Main.panel.menuManager;
            if (!pmm._macOrigChangeMenu) {
                pmm._macOrigChangeMenu = pmm._changeMenu;
                pmm._changeMenu = function(newMenu) {
                    const active = this.activeMenu;
                    const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                    const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                    const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);

                    // If Control Center or Notification Center is active, or if hovering onto them: NO hover switching!
                    if (active === qsMenu || active === dmMenu || notifOpen || newMenu === qsMenu || newMenu === dmMenu) {
                        return;
                    }

                    return this._macOrigChangeMenu(newMenu);
                };
            }

            if (!pmm._macOrigOnCapturedEvent) {
                pmm._macOrigOnCapturedEvent = pmm._onCapturedEvent;
                pmm._onCapturedEvent = function(actor, event) {
                    const menu = actor?._delegate;
                    const targetActor = global.stage.get_event_actor(event);
                    const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                    const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                    const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);

                    // Block hover switching from Control Center or Notification Center
                    if (event.type() === Clutter.EventType.ENTER) {
                        if (menu === qsMenu || menu === dmMenu || notifOpen) {
                            return Clutter.EVENT_PROPAGATE;
                        }
                    }

                    // On Click outside the active popup menu
                    if ((event.type() === Clutter.EventType.BUTTON_PRESS ||
                         event.type() === Clutter.EventType.TOUCH_BEGIN) &&
                        targetActor && actor && !actor.contains(targetActor)) {

                        const clickedMenu = this._findMenuForSource(targetActor);
                        if (clickedMenu && clickedMenu !== menu) {
                            // User intentionally clicked on another menu in the panel!
                            // Immediately close the active menu and open the clicked menu in one click.
                            menu.close(BoxPointer.PopupAnimation.FADE);
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                if (clickedMenu.isOpen) {
                                    clickedMenu.close(BoxPointer.PopupAnimation.FADE);
                                } else {
                                    clickedMenu.open(BoxPointer.PopupAnimation.FADE);
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                            return Clutter.EVENT_STOP;
                        }
                    }

                    return this._macOrigOnCapturedEvent(actor, event);
                };

                // Re-wire all existing menus in pmm to use the updated captured-event handler and ensure NotifCenter closes when any menu opens
                const rewireMenus = () => {
                    for (const m of (pmm._menus || [])) {
                        if (m && m.actor) {
                            try {
                                m.actor.disconnectObject(pmm);
                                m.actor.connectObject('captured-event',
                                    pmm._onCapturedEvent.bind(pmm), pmm);
                            } catch (_) {}
                        }
                        if (m && !m._macCloseNotifConnected) {
                            m._macCloseNotifConnected = true;
                            m.connectObject('open-state-changed', (_menu, open) => {
                                if (open && globalThis._macNotificationCenter?._notifCenterOpen && _menu !== dateMenu?.menu) {
                                    globalThis._macNotificationCenter._closeNotificationCenter();
                                }
                            }, pmm);
                        }
                    }
                };
                rewireMenus();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    rewireMenus();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        const menu = dateMenu.menu;
        if (menu) {
            try {
                if (menu.isOpen) menu.close();
            } catch (_) {}

            if (!menu._origOpen) menu._origOpen = menu.open;
            if (!menu._origToggle) menu._origToggle = menu.toggle;
            if (!menu._origClose) menu._origClose = menu.close;

            menu.open = () => {
                this._openNotificationCenter();
            };
            menu.toggle = () => {
                this._toggleNotificationCenter();
            };
            menu.close = () => {
                this._closeNotificationCenter();
            };

            Object.defineProperty(menu, 'isOpen', {
                get: () => this._notifCenterOpen,
                set: (val) => {
                    this._notifCenterOpen = !!val;
                },
                configurable: true,
            });

            if (menu.box && menu.box._macHeader) {
                try { menu.box._macHeader.destroy(); } catch (_) {}
                delete menu.box._macHeader;
            }
            if (menu.box && menu.box._macBottom) {
                try { menu.box._macBottom.destroy(); } catch (_) {}
                delete menu.box._macBottom;
            }
            if (menu._boxPointer) {
                try {
                    menu._boxPointer.hide();
                    menu._boxPointer.opacity = 0;
                    menu._boxPointer.remove_all_transitions();
                } catch (_) {}
            }
        }

        if (Main.messageTray) {
            Main.messageTray.bannerAlignment = Clutter.ActorAlign.END;
        }
    }

    _createNotificationCenterActor() {
        if (this._notifCenterActor && !this._notifCenterActor.is_finalized?.()) {
            return this._notifCenterActor;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        const availableHeight = monitor ? monitor.height - 70 : 800;

        const container = new St.Widget({
            name: 'macNotificationCenterRoot',
            style_class: 'mac-notif-center-root',
            layout_manager: new Clutter.BinLayout(),
            style: 'background-color: transparent !important; background: transparent !important; box-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important; width: 460px !important;',
            reactive: true,
            can_focus: false,
            visible: false,
        });

        // 1. Background gradient blur (10px fade on all 4 edges, dynamic height)
        const bgContainer = new St.Widget({
            name: 'macNotificationCenterGradientBlurBg',
            style_class: 'mac-notif-center-bg',
            reactive: false,
        });
        container.add_child(bgContainer);

        // 2. Foreground content box
        const contentBox = new St.BoxLayout({
            name: 'macNotificationCenterContentBox',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false,
            reactive: true,
        });
        container.add_child(contentBox);

        // Top Header Row
        const headerBox = new St.BoxLayout({
            name: 'macNotificationCenterHeaderBox',
            orientation: Clutter.Orientation.HORIZONTAL,
            style: 'padding: 4px 8px 10px 8px; margin: 0; background: transparent !important;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const label = new St.Label({
            text: 'Центр повідомлень',
            style_class: 'mac-notif-center-title',
            style: 'font-family: "SF Pro Display", "SF Pro Text", -apple-system, sans-serif !important; font-size: 20px !important; font-weight: 700 !important; color: #ffffff !important; text-shadow: 0 0 14px rgba(255, 255, 255, 0.55), 0 0 24px rgba(0, 0, 0, 0.8), 0 2px 12px rgba(0, 0, 0, 0.9) !important; background: transparent !important; margin: 0 !important; padding: 0 !important;',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        headerBox.add_child(label);

        const clearBtn = new St.Button({
            style_class: 'mac-notif-clear-btn',
            label: 'Очистити всі',
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            visible: false,
        });
        clearBtn.connect('clicked', () => {
            this._clearAllNotifications();
        });
        headerBox.add_child(clearBtn);
        contentBox.add_child(headerBox);

        // Scrollable list wrapper with edge darkening gradients
        const scrollWrapper = new St.Widget({
            name: 'macNotificationCenterScrollWrapper',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            clip_to_allocation: true,
        });

        const cardsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'spacing: 10px; padding: 0 6px 16px 6px; background: transparent !important;',
            x_expand: true,
            y_expand: false,
        });
        cardsBox.connect('notify::height', () => {
            if (this._notifCenterOpen) {
                this._updateNotificationCenterGeometry();
            }
        });

        // Scrollable list of cards (without visible scrollbars)
        const scrollView = new St.ScrollView({
            style_class: 'mac-notif-center-scroll',
            style: `background: transparent !important; border: none !important; padding: 0 !important; max-height: ${availableHeight - 65}px !important;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: false,
        });
        scrollView.set_child(cardsBox);
        scrollWrapper.add_child(scrollView);

        // Top vignette darkening overlay (smooth fade when overflow at top)
        const topFade = new St.Widget({
            name: 'macNotificationCenterTopFade',
            style: 'background-gradient-direction: vertical; background-gradient-start: rgba(16, 16, 16, 0.95); background-gradient-end: transparent; border-radius: 14px 14px 0 0;',
            height: 38,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
            reactive: false,
            opacity: 0,
        });

        // Bottom vignette darkening overlay (smooth fade when overflow at bottom)
        const bottomFade = new St.Widget({
            name: 'macNotificationCenterBottomFade',
            style: 'background-gradient-direction: vertical; background-gradient-start: transparent; background-gradient-end: rgba(16, 16, 16, 0.95); border-radius: 0 0 14px 14px;',
            height: 56,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
            opacity: 0,
        });

        scrollWrapper.add_child(topFade);
        scrollWrapper.add_child(bottomFade);
        contentBox.add_child(scrollWrapper);

        const updateFades = () => {
            const vAdj = scrollView.vadjustment;
            if (!vAdj) return;
            const maxScroll = Math.max(0, vAdj.upper - vAdj.page_size);
            const hasScroll = maxScroll > 4;

            const targetTop = (hasScroll && vAdj.value > 4) ? 255 : 0;
            if (topFade.opacity !== targetTop) {
                topFade.remove_all_transitions();
                topFade.ease({
                    opacity: targetTop,
                    duration: 160,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }

            const targetBottom = (hasScroll && vAdj.value < maxScroll - 4) ? 255 : 0;
            if (bottomFade.opacity !== targetBottom) {
                bottomFade.remove_all_transitions();
                bottomFade.ease({
                    opacity: targetBottom,
                    duration: 160,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        };

        scrollView.vadjustment.connect('notify::value', updateFades);
        scrollView.vadjustment.connect('changed', updateFades);

        // Empty state label with soft diffuse text blur
        const emptyLabel = new St.Label({
            text: 'Немає нових повідомлень',
            style_class: 'mac-notif-empty-label',
            style: 'font-family: "SF Pro Text", -apple-system, sans-serif !important; font-size: 14px !important; color: rgba(255, 255, 255, 0.6) !important; text-shadow: 0 0 10px rgba(255, 255, 255, 0.45), 0 0 18px rgba(0, 0, 0, 0.85), 0 2px 10px rgba(0, 0, 0, 0.7) !important; text-align: center; padding: 36px 10px !important; margin: 0 !important;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        contentBox.add_child(emptyLabel);

        Main.layoutManager.uiGroup.add_child(container);

        this._notifCenterActor = container;
        this._notifCenterBg = bgContainer;
        this._notifContentBox = contentBox;
        this._notifHeaderBox = headerBox;
        this._notifCenterLabel = label;
        this._notifClearBtn = clearBtn;
        this._notifScrollWrapper = scrollWrapper;
        this._notifScrollView = scrollView;
        this._notifCardsBox = cardsBox;
        this._notifEmptyLabel = emptyLabel;
        this._notifTopFade = topFade;
        this._notifBottomFade = bottomFade;
        this._updateNotifFades = updateFades;
        this._notifCenterOpen = false;
        return container;
    }

    get isOpen() {
        return !!this._notifCenterOpen;
    }

    _toggleNotificationCenter() {
        if (this._notifCenterOpen) {
            this._closeNotificationCenter();
        } else {
            this._openNotificationCenter();
        }
    }

    _setupCardGeometryTracking(card) {
        if (!card || card._geoTrackConnected) return;
        card._geoTrackConnected = true;
        card.connect('notify::height', () => {
            if (this._notifCenterOpen) {
                this._updateNotificationCenterGeometry();
            }
        });
    }

    _populateNotificationCards(activeBanners = []) {
        if (!this._notifCardsBox) return [];

        this._notifCardsBox.destroy_all_children();

        const sources = Main.messageTray ? Main.messageTray.getSources() : [];
        const allItems = [];

        // Track notifications from active banners
        const activeNotifs = new Set(activeBanners.map(b => b.notification));

        // 1. Place all active floating banners at the very front of the list (newest)
        for (const b of activeBanners) {
            allItems.push({ source: b.source, notification: b.notification, activeBanner: b });
        }

        // 2. Add existing notifications from tray sources (avoiding duplicates)
        for (const source of sources) {
            for (const notification of (source.notifications || [])) {
                if (!activeNotifs.has(notification)) {
                    allItems.push({ source, notification });
                }
            }
        }

        // Sort regular items by time (newest first)
        const regularItems = allItems.slice(activeBanners.length);
        regularItems.sort((a, b) => {
            const timeA = a.notification.datetime?.to_unix ? a.notification.datetime.to_unix() : 0;
            const timeB = b.notification.datetime?.to_unix ? b.notification.datetime.to_unix() : 0;
            return timeB - timeA;
        });

        const sortedItems = [...allItems.slice(0, activeBanners.length), ...regularItems];
        const reservedCards = [];

        for (const item of sortedItems) {
            const { source, notification, activeBanner } = item;
            const builder = globalThis._macBuildNotificationCard || buildNotificationCard;
            const cardData = builder(source, notification, {
                sigma: 30,
                isBanner: false,
                onClose: (data) => {
                    const card = data.banner;
                    card.remove_all_transitions();
                    card.ease({
                        translation_x: 480,
                        opacity: 0,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                        onComplete: () => {
                            if (card.get_parent() === this._notifCardsBox)
                                this._notifCardsBox.remove_child(card);
                            card.destroy();
                            try { notification.destroy(2); } catch (_) {}
                            this._updateEmptyState(this._notifCardsBox.get_children().length);
                            this._updateNotificationCenterGeometry();
                        },
                    });
                },
                onClick: () => {
                    try { notification.activate(); } catch (e) { logError(e); }
                    this._closeNotificationCenter();
                },
            });

            cardData.banner._notification = notification;
            cardData.banner._titleLabel = cardData.titleLabel;
            cardData.banner._bodyLabel = cardData.bodyLabel;

            this._setupCardGeometryTracking(cardData.banner);

            if (activeBanner) {
                // Reserve space: card is fully laid out in the list to reserve its slot, initially transparent
                cardData.banner.opacity = 0;
                reservedCards.push({ card: cardData.banner, activeBanner });
            }

            this._notifCardsBox.add_child(cardData.banner);
        }

        this._updateEmptyState(sortedItems.length);
        this._updateNotificationCenterGeometry();
        if (this._updateNotifFades) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._updateNotifFades) this._updateNotifFades();
                return GLib.SOURCE_REMOVE;
            });
        }

        return reservedCards;
    }

    addNotificationAnimated(source, notification) {
        if (!this._notifCardsBox || !this._notifCenterOpen)
            return;

        const existingCards = this._notifCardsBox.get_children();
        for (const child of existingCards) {
            if (child._notification === notification) {
                if (child._titleLabel) child._titleLabel.text = notification.title || '';
                if (child._bodyLabel) child._bodyLabel.text = notification.bannerBodyText || notification.body || '';
                return;
            }
        }

        const builder = globalThis._macBuildNotificationCard || buildNotificationCard;
        const cardData = builder(source, notification, {
            sigma: 30,
            isBanner: false,
            onClose: (data) => {
                const card = data.banner;
                card.remove_all_transitions();
                card.ease({
                    translation_x: 480,
                    opacity: 0,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: () => {
                        if (card.get_parent() === this._notifCardsBox)
                            this._notifCardsBox.remove_child(card);
                        card.destroy();
                        try { notification.destroy(2); } catch (_) {}
                        this._updateEmptyState(this._notifCardsBox.get_children().length);
                        this._updateNotificationCenterGeometry();
                    },
                });
            },
            onClick: () => {
                try { notification.activate(); } catch (e) { logError(e); }
                this._closeNotificationCenter();
            },
        });

        cardData.banner._notification = notification;
        cardData.banner._titleLabel = cardData.titleLabel;
        cardData.banner._bodyLabel = cardData.bodyLabel;

        this._setupCardGeometryTracking(cardData.banner);

        // Insert at the top of the list into newest items (reserves space immediately)
        this._notifCardsBox.insert_child_at_index(cardData.banner, 0);
        this._updateEmptyState(this._notifCardsBox.get_children().length);
        this._updateNotificationCenterGeometry();

        // Smooth sliding down entrance animation into the reserved slot
        cardData.banner.opacity = 0;
        cardData.banner.translation_y = -55;
        cardData.banner.scale_x = 0.98;
        cardData.banner.scale_y = 0.98;
        cardData.banner.remove_all_transitions();
        cardData.banner.ease({
            opacity: 255,
            translation_y: 0,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        if (this._notifScrollView?.vadjustment) {
            this._notifScrollView.vadjustment.value = 0;
        }

        if (this._updateNotifFades) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._updateNotifFades) this._updateNotifFades();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    addNotificationQuiet(source, notification) {
        if (!this._notifCardsBox || !this._notifCenterOpen)
            return;

        const existingCards = this._notifCardsBox.get_children();
        for (const child of existingCards) {
            if (child._notification === notification) {
                if (child._titleLabel) child._titleLabel.text = notification.title || '';
                if (child._bodyLabel) child._bodyLabel.text = notification.bannerBodyText || notification.body || '';
                return;
            }
        }

        const builder = globalThis._macBuildNotificationCard || buildNotificationCard;
        const cardData = builder(source, notification, {
            sigma: 30,
            isBanner: false,
            onClose: (data) => {
                const card = data.banner;
                card.remove_all_transitions();
                card.ease({
                    translation_x: 480,
                    opacity: 0,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: () => {
                        if (card.get_parent() === this._notifCardsBox)
                            this._notifCardsBox.remove_child(card);
                        card.destroy();
                        try { notification.destroy(2); } catch (_) {}
                        this._updateEmptyState(this._notifCardsBox.get_children().length);
                        this._updateNotificationCenterGeometry();
                    },
                });
            },
            onClick: () => {
                try { notification.activate(); } catch (e) { logError(e); }
                this._closeNotificationCenter();
            },
        });

        cardData.banner._notification = notification;
        cardData.banner._titleLabel = cardData.titleLabel;
        cardData.banner._bodyLabel = cardData.bodyLabel;

        this._setupCardGeometryTracking(cardData.banner);

        // Insert at the top quietly without slide-in animation or sound
        cardData.banner.opacity = 255;
        cardData.banner.translation_y = 0;
        this._notifCardsBox.insert_child_at_index(cardData.banner, 0);
        this._updateEmptyState(this._notifCardsBox.get_children().length);
        this._updateNotificationCenterGeometry();

        if (this._updateNotifFades) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._updateNotifFades) this._updateNotifFades();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _rebuildGradientBlur(w, h) {
        if (!this._notifCenterBg) return;
        if (this._lastBlurW === w && this._lastBlurH === h && this._notifCenterBg.get_n_children() > 0) return;
        this._lastBlurW = w;
        this._lastBlurH = h;
        this._notifCenterBg.destroy_all_children();

        const steps = 5;
        const stepSize = 2; // 5 steps * 2px = 10px fade on all edges!

        // Outer concentric rings (0 to 10px from edges)
        for (let k = 0; k < steps; k++) {
            const offset = k * stepSize;
            const rad = k + 1; // radii: 1, 2, 3, 4, 5

            const ringW = w - 2 * offset;
            const ringH = h - 2 * offset;
            if (ringW <= 0 || ringH <= 0) continue;

            // Top slice
            const top = new St.Widget({
                x: offset,
                y: offset,
                width: ringW,
                height: stepSize,
                reactive: false,
            });
            top.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: rad }));
            this._notifCenterBg.add_child(top);

            // Bottom slice
            if (ringH > stepSize) {
                const bottom = new St.Widget({
                    x: offset,
                    y: h - offset - stepSize,
                    width: ringW,
                    height: stepSize,
                    reactive: false,
                });
                bottom.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: rad }));
                this._notifCenterBg.add_child(bottom);
            }

            // Left slice
            if (ringH > 2 * stepSize) {
                const left = new St.Widget({
                    x: offset,
                    y: offset + stepSize,
                    width: stepSize,
                    height: ringH - 2 * stepSize,
                    reactive: false,
                });
                left.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: rad }));
                this._notifCenterBg.add_child(left);
            }

            // Right slice
            if (ringH > 2 * stepSize && ringW > stepSize) {
                const right = new St.Widget({
                    x: w - offset - stepSize,
                    y: offset + stepSize,
                    width: stepSize,
                    height: ringH - 2 * stepSize,
                    reactive: false,
                });
                right.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: rad }));
                this._notifCenterBg.add_child(right);
            }
        }

        // Inner center (beyond 10px from all edges): full 5px blur!
        const centerW = w - 20;
        const centerH = h - 20;
        if (centerW > 0 && centerH > 0) {
            const center = new St.Widget({
                x: 10,
                y: 10,
                width: centerW,
                height: centerH,
                reactive: false,
            });
            center.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 5 }));
            this._notifCenterBg.add_child(center);
        }
    }

    _updateNotificationCenterGeometry() {
        if (!this._notifCenterActor || !this._notifContentBox) return;

        const targetW = 460;
        const monitor = Main.layoutManager.primaryMonitor;
        const availableHeight = monitor ? monitor.height - 70 : 800;

        const [minH, natH] = this._notifContentBox.get_preferred_height(targetW);
        const actualH = Math.min(availableHeight, Math.max(90, Math.round(natH)));

        if (this._lastCenterW === targetW && this._lastCenterH === actualH && this._notifCenterActor.height === actualH) {
            return;
        }
        this._lastCenterW = targetW;
        this._lastCenterH = actualH;

        this._notifCenterActor.width = targetW;
        this._notifCenterActor.height = actualH;
        if (this._notifCenterBg) {
            this._notifCenterBg.width = targetW;
            this._notifCenterBg.height = actualH;
            this._rebuildGradientBlur(targetW, actualH);
        }
    }

    _updateEmptyState(count) {
        if (count > 0) {
            this._notifEmptyLabel.hide();
            this._notifScrollWrapper.show();
            this._notifClearBtn.show();
        } else {
            this._notifEmptyLabel.show();
            this._notifScrollWrapper.hide();
            this._notifClearBtn.hide();
        }
        this._updateNotificationCenterGeometry();
    }

    _clearAllNotifications() {
        const sources = Main.messageTray ? Main.messageTray.getSources() : [];
        for (const source of sources) {
            const notifs = (source.notifications || []).slice();
            for (const notif of notifs) {
                try { notif.destroy(2); } catch (_) {}
            }
        }
        if (this._notifCardsBox)
            this._notifCardsBox.destroy_all_children();
        if (this._notifEmptyLabel)
            this._updateEmptyState(0);
        this._updateNotificationCenterGeometry();
    }

    _openNotificationCenter() {
        // Take any active floating banners so we can dock them smoothly into the center
        const notifCtrl = globalThis._macNotificationsController ||
            Main.extensionManager?.lookup?.('blur-my-shell@aunetx')?.stateObj?._notifications_controller;
        const activeBanners = (notifCtrl && typeof notifCtrl.takeActiveBanners === 'function')
            ? notifCtrl.takeActiveBanners()
            : [];

        // Mutual exclusion: close QuickSettings and any other active panel popup menus
        const qs = Main.panel?.statusArea?.quickSettings;
        if (qs?.menu?.isOpen) {
            qs.menu.close(BoxPointer.PopupAnimation.FADE);
        }
        if (Main.panel?.menuManager?.activeMenu && Main.panel.menuManager.activeMenu !== Main.panel?.statusArea?.dateMenu?.menu) {
            Main.panel.menuManager.activeMenu.close(BoxPointer.PopupAnimation.FADE);
        }

        const container = this._createNotificationCenterActor();
        if (!container) return;

        this._notifCenterOpen = true;

        const reservedCards = this._populateNotificationCards(activeBanners);

        const dateMenu = Main.panel?.statusArea?.dateMenu;
        const [dmX, dmY] = dateMenu ? dateMenu.get_transformed_position() : [0, 0];
        const [dmW, dmH] = dateMenu ? dateMenu.get_transformed_size() : [0, 32];
        const monitor = Main.layoutManager.primaryMonitor;

        const targetW = 460;
        container.width = targetW;
        container.x = monitor.x + monitor.width - targetW - 12;
        container.y = (dmY || 0) + (dmH || 32) + 8;
        this._updateNotificationCenterGeometry();
        container.translation_x = 480;
        container.opacity = 0;
        container.visible = true;
        container.show();

        container.remove_all_transitions();
        container.ease({
            translation_x: 0,
            opacity: 255,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        // Animate floating banner(s) sliding down into the reserved slot(s)
        if (reservedCards && reservedCards.length > 0) {
            const headerH = this._notifHeaderBox
                ? (this._notifHeaderBox.get_preferred_height(targetW)[1] || 42)
                : 42;
            const slotTargetX = container.x + Math.round((targetW - 395) / 2);

            let accumulatedSlotY = container.y + headerH + 4;
            for (let k = 0; k < reservedCards.length; k++) {
                const { card, activeBanner } = reservedCards[k];
                const bannerActor = activeBanner.banner;
                const slotTargetY = accumulatedSlotY;
                const cardH = card.get_preferred_height(395)[1] || 70;
                accumulatedSlotY += cardH + 10;

                const [bannerCurX, bannerCurY] = bannerActor.get_transformed_position();
                const startY = Number.isFinite(bannerCurY) ? bannerCurY : (container.y - 10);
                const startX = Number.isFinite(bannerCurX) ? bannerCurX : slotTargetX;

                const deltaY = slotTargetY - startY;
                const deltaX = slotTargetX - startX;

                bannerActor.remove_all_transitions();
                bannerActor.ease({
                    translation_y: deltaY,
                    translation_x: deltaX,
                    duration: 320,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        card.opacity = 255;
                        if (bannerActor.get_parent()) {
                            bannerActor.get_parent().remove_child(bannerActor);
                        }
                        bannerActor.destroy();
                        if (notifCtrl && typeof notifCtrl._updateVisibility === 'function') {
                            notifCtrl._updateVisibility();
                        }
                    },
                });
            }
        }

        this._notifOpenedAt = Date.now();
        this._connectNotifCenterListeners();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._updateNotifFades) this._updateNotifFades();
            return GLib.SOURCE_REMOVE;
        });
    }

    _closeNotificationCenter() {
        if (!this._notifCenterActor || !this._notifCenterOpen) return;

        this._notifCenterOpen = false;
        this._lastCenterW = null;
        this._lastCenterH = null;
        this._lastBlurW = null;
        this._lastBlurH = null;
        this._disconnectNotifCenterListeners();

        const container = this._notifCenterActor;
        container.remove_all_transitions();
        container.ease({
            translation_x: 480,
            opacity: 0,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                if (!this._notifCenterOpen) {
                    container.hide();
                    container.translation_x = 0;
                }
            },
        });
    }

    _connectNotifCenterListeners() {
        this._disconnectNotifCenterListeners();

        const container = this._notifCenterActor;
        if (!container) return;

        // 1. Push modal grab so all pointer events anywhere on the screen are redirected (identical to Control Center)
        try {
            this._notifGrab = Main.pushModal(container, {
                actionMode: Shell.ActionMode.POPUP,
            });
        } catch (e) {
            console.error(`[MenuBar] pushModal error: ${e}`);
        }

        const handleOutsideOrKeyEvent = (_actor, event) => {
            if (!this._notifCenterOpen || !this._notifCenterActor) {
                return Clutter.EVENT_PROPAGATE;
            }

            const evType = event.type();

            if (evType === Clutter.EventType.KEY_PRESS) {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this._closeNotificationCenter();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (evType === Clutter.EventType.BUTTON_PRESS || evType === Clutter.EventType.TOUCH_BEGIN) {
                // Ignore the click that opened the Notification Center (within 250ms)
                if (this._notifOpenedAt && (Date.now() - this._notifOpenedAt < 250)) {
                    return Clutter.EVENT_PROPAGATE;
                }

                const targetActor = global.stage.get_event_actor(event);

                // If click is inside Notification Center, let it interact with the cards/buttons normally
                if (targetActor && (targetActor === container || container.contains(targetActor))) {
                    return Clutter.EVENT_PROPAGATE;
                }

                const [clickX, clickY] = event.get_coords();
                const [cx, cy] = container.get_transformed_position();
                const [cw, ch] = container.get_transformed_size();
                if (clickX >= cx && clickX <= cx + cw && clickY >= cy && clickY <= cy + ch) {
                    return Clutter.EVENT_PROPAGATE;
                }

                // If user clicked on the clock button in panel, let dateMenu toggle it
                const dateMenu = Main.panel?.statusArea?.dateMenu;
                if (dateMenu) {
                    const [dx, dy] = dateMenu.get_transformed_position();
                    const [dw, dh] = dateMenu.get_transformed_size();
                    if (clickX >= dx && clickX <= dx + dw && clickY >= dy && clickY <= dy + dh) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                }

                // User clicked outside on empty space, desktop, open app, or another panel menu:
                const pmm = Main.panel?.menuManager;
                const clickedMenu = targetActor ? pmm?._findMenuForSource(targetActor) : null;

                this._closeNotificationCenter();

                if (clickedMenu && clickedMenu !== dateMenu?.menu) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (clickedMenu.isOpen) {
                            clickedMenu.close(BoxPointer.PopupAnimation.FADE);
                        } else {
                            clickedMenu.open(BoxPointer.PopupAnimation.FADE);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_PROPAGATE;
        };

        this._notifContainerCapturedId = container.connect('captured-event', handleOutsideOrKeyEvent);
        this._notifStageCapturedId = global.stage.connect('captured-event', handleOutsideOrKeyEvent);
    }

    _disconnectNotifCenterListeners() {
        if (this._notifGrab) {
            try {
                Main.popModal(this._notifGrab);
            } catch (_) {}
            this._notifGrab = null;
        }
        if (this._notifContainerCapturedId && this._notifCenterActor) {
            try {
                this._notifCenterActor.disconnect(this._notifContainerCapturedId);
            } catch (_) {}
            this._notifContainerCapturedId = 0;
        }
        if (this._notifStageCapturedId) {
            try {
                global.stage.disconnect(this._notifStageCapturedId);
            } catch (_) {}
            this._notifStageCapturedId = 0;
        }
        if (this._notifOutsideClickId) {
            try {
                global.stage.disconnect(this._notifOutsideClickId);
            } catch (_) {}
            this._notifOutsideClickId = 0;
        }
        if (this._notifEscapeKeyId) {
            try {
                global.stage.disconnect(this._notifEscapeKeyId);
            } catch (_) {}
            this._notifEscapeKeyId = 0;
        }
    }

    _setupDateMenuLayout(dateMenu) {
        if (!dateMenu?.menu?.box) return;
        try {
            const menuBox = dateMenu.menu.box;
            if (menuBox && menuBox._macHeader) {
                try { menuBox._macHeader.destroy(); } catch (_) {}
                delete menuBox._macHeader;
            }
            if (menuBox && menuBox._macBottom) {
                try { menuBox._macBottom.destroy(); } catch (_) {}
                delete menuBox._macBottom;
            }
        } catch (_) {}
    }

    _alignMenuRight(dateMenu) {
        // Handled dynamically in open-state-changed and bp._reposition
    }

    _scheduleReorder() {
        if (this._reorderTimeoutId) {
            GLib.source_remove(this._reorderTimeoutId);
            this._reorderTimeoutId = null;
        }
        if (this._initTimeoutId) {
            GLib.source_remove(this._initTimeoutId);
            this._initTimeoutId = null;
        }
        this._reorderTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            this._reorderTimeoutId = null;
            if (this.enabled) {
                this._reorderRightBox();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _reorderRightBox() {
        if (!Main.panel?._rightBox || !this.enabled) return;
        const rightBox = Main.panel._rightBox;
        const dateMenu = Main.panel.statusArea?.dateMenu;
        const quickSettings = Main.panel.statusArea?.quickSettings;

        const isAlive = (actor) => {
            if (!actor) return false;
            try {
                if (Object.prototype.toString.call(actor).includes('DISPOSED')) return false;
                const _ = actor.visible;
                return true;
            } catch (_e) {
                return false;
            }
        };

        const ensureInRightBox = (actor) => {
            if (!isAlive(actor)) return false;
            try {
                if (!rightBox.contains(actor)) {
                    const parent = actor.get_parent ? actor.get_parent() : null;
                    if (parent) parent.remove_child(actor);
                    rightBox.add_child(actor);
                }
                actor.visible = true;
                actor.show();
                return true;
            } catch (_e) {
                return false;
            }
        };

        const isMyContainer = (child) => {
            if (!child) return false;
            if (child === quickSettings || child === quickSettings?.container || child?.name === 'quickSettings') return true;
            if (child === dateMenu || child === dateMenu?.container || child?.name === 'dateMenu') return true;
            if (child === this._privacyIndicator?.container || child === this._privacyIndicator) return true;
            if (child === this._wifiButton?.container || child === this._wifiButton) return true;
            if (child === this._bluetoothButton?.container || child === this._bluetoothButton) return true;
            if (child === this._volumeButton?.container || child === this._volumeButton) return true;
            if (child === this._batteryWidget?.container || child === this._batteryWidget) return true;
            return false;
        };

        // Find all real, visible tray / appindicator children
        const externalIndicators = [];
        try {
            for (const child of rightBox.get_children()) {
                if (!isAlive(child)) continue;

                if (!isMyContainer(child)) {
                    try {
                        const role = Object.entries(Main.panel.statusArea || {}).find(([_, v]) => {
                            try { return v?.container === child || v === child; } catch (_e) { return false; }
                        })?.[0] || '';
                        const delName = child._delegate?.constructor?.name || '';
                        if (role.toLowerCase().includes('user') || delName.toLowerCase().includes('user') || (child.name && child.name.toLowerCase().includes('user'))) {
                            child.visible = false;
                            child.hide();
                            continue;
                        }

                        // Check if child is an inactive system indicator (which would create huge empty gaps)
                        const isHiddenSystem = ['tiling-assistant', 'unattended_upgrade', 'livepatch', 'software_update', 'screenRecording', 'screenSharing', 'dwellClick', 'a11y'].some(s => role.includes(s));
                        const isSubVisible = (c) => {
                            if (!c.visible) return false;
                            if (c.get_first_child) {
                                const f = c.get_first_child();
                                if (f && !f.visible) return false;
                            }
                            return true;
                        };

                        if (isHiddenSystem || !isSubVisible(child)) {
                            child.visible = false;
                            child.style = 'margin: 0 !important; padding: 0 !important; width: 0 !important; min-width: 0 !important; -natural-hpadding: 0 !important; -minimum-hpadding: 0 !important;';
                            continue;
                        }

                        if (child !== Main.panel.statusArea?.keyboard?.container) {
                            externalIndicators.push(child);
                        }
                    } catch (_e) {}
                }
            }
        } catch (_e) {}

        // Exact requested order:
        // [ Privacy (if active) ] -> [ AppIndicators (Tray) ] -> [ Wi-Fi ] -> [ Bluetooth ] -> [ Sound ] -> [ Battery ] -> [ Keyboard (uk) ] -> [ Control Center ] -> [ Date & Time ]
        const desiredOrder = [];

        if (this._privacyIndicator?.container && isAlive(this._privacyIndicator.container)) {
            try {
                if (!rightBox.contains(this._privacyIndicator.container)) {
                    rightBox.add_child(this._privacyIndicator.container);
                }
                desiredOrder.push(this._privacyIndicator.container);
            } catch (_) {}
        }

        for (const ext of externalIndicators) {
            try {
                if (ensureInRightBox(ext) && ext !== Main.panel.statusArea?.keyboard?.container) {
                    desiredOrder.push(ext);
                }
            } catch (_e) {}
        }

        if (ensureInRightBox(this._wifiButton?.container))
            desiredOrder.push(this._wifiButton.container);

        if (ensureInRightBox(this._bluetoothButton?.container))
            desiredOrder.push(this._bluetoothButton.container);

        if (ensureInRightBox(this._volumeButton?.container))
            desiredOrder.push(this._volumeButton.container);

        if (ensureInRightBox(this._batteryWidget?.container))
            desiredOrder.push(this._batteryWidget.container);

        if (ensureInRightBox(Main.panel.statusArea?.keyboard?.container)) {
            desiredOrder.push(Main.panel.statusArea.keyboard.container);
        }

        if (ensureInRightBox(quickSettings?.container))
            desiredOrder.push(quickSettings.container);

        if (ensureInRightBox(dateMenu?.container))
            desiredOrder.push(dateMenu.container);

        for (let i = 0; i < desiredOrder.length; i++) {
            try {
                rightBox.set_child_at_index(desiredOrder[i], i);
            } catch (_e) {}
        }

        this._patchAppIndicatorClickDelay();
        this._fixIndicatorShapes();
    }

    _fixIndicatorShapes() {
        const rightBox = Main.panel?._rightBox;
        if (!rightBox) return;

        const quickSettings = Main.panel.statusArea?.quickSettings;
        const dateMenu = Main.panel.statusArea?.dateMenu;

        try {
            for (const child of rightBox.get_children()) {
                try {
                    // Control Center and DateMenu must NEVER be hidden here
                    if (child === quickSettings || child === quickSettings?.container || child?.name === 'quickSettings' || (child.contains && child.contains(quickSettings))) {
                        child.visible = true;
                        child.show();
                        continue;
                    }
                    if (child === dateMenu || child === dateMenu?.container || child?.name === 'dateMenu') {
                        child.visible = true;
                        child.show();
                        continue;
                    }

                    // Check if child is an inactive/empty system indicator
                    const role = Object.entries(Main.panel.statusArea || {}).find(([_, v]) => {
                        try { return v?.container === child || v === child; } catch (_e) { return false; }
                    })?.[0] || '';

                    const isHiddenSystem = ['tiling-assistant', 'unattended_upgrade', 'livepatch', 'software_update', 'screenRecording', 'screenSharing', 'dwellClick', 'a11y'].some(s => role.includes(s));

                    const isSubVisible = (c) => {
                        if (!c.visible) return false;
                        if (c.get_first_child) {
                            const f = c.get_first_child();
                            if (f && !f.visible) return false;
                        }
                        return true;
                    };

                    if (isHiddenSystem || !isSubVisible(child)) {
                        child.visible = false;
                        child.hide();
                        child.style = 'margin: 0 !important; padding: 0 !important; width: 0 !important; min-width: 0 !important; max-width: 0 !important; -natural-hpadding: 0 !important; -minimum-hpadding: 0 !important;';
                        continue;
                    }

                    // Visible items in right box: containers have 0 margin, matching left box
                    child.visible = true;
                    if (child !== quickSettings?.container) {
                        child.style = 'margin: 0 !important; padding: 0 !important; height: 28px !important; min-height: 28px !important;';
                    }
                    child.set_y_align(Clutter.ActorAlign.CENTER);

                    // Clean up internal boxes and center background app icons
                    if (child.get_children) {
                        for (const sub of child.get_children()) {
                            try {
                                sub.set_x_align(Clutter.ActorAlign.CENTER);
                                sub.set_y_align(Clutter.ActorAlign.CENTER);

                                if (sub instanceof St.BoxLayout) {
                                    sub.spacing = 0;
                                    for (const item of sub.get_children()) {
                                        try {
                                            item.set_x_align(Clutter.ActorAlign.CENTER);
                                            item.set_y_align(Clutter.ActorAlign.CENTER);
                                            // Hide empty label that pushes the icon off-center
                                            if (item instanceof St.Label && (!item.text || item.text.trim() === '')) {
                                                item.visible = false;
                                                item.width = 0;
                                            }
                                        } catch (_e) {}
                                    }
                                }
                            } catch (_e) {}
                        }
                    }
                } catch (_e) {}
            }
        } catch (_e) {}

        // Special styling for dateMenu: container has 0 margin, height 28px matching left box
        try {
            if (dateMenu?.container) {
                dateMenu.container.visible = true;
                dateMenu.container.show();
                dateMenu.container.style = 'margin: 0 !important; padding: 0 !important; height: 28px !important;';
            }
        } catch (_e) {}

        // Special styling for Control Center: matching 28px height
        try {
            if (quickSettings) {
                quickSettings.visible = true;
                quickSettings.show();
                quickSettings._minHPadding = 0;
                quickSettings._natHPadding = 0;
                quickSettings.style = 'margin: 0 !important; padding: 0 !important; height: 28px !important; min-height: 28px !important;';
                if (quickSettings.container) {
                    quickSettings.container.visible = true;
                    quickSettings.container.show();
                    quickSettings.container.style = 'margin: 0 !important; padding: 0 !important; height: 28px !important; min-height: 28px !important;';
                }
                if (this._ccIcon) {
                    this._ccIcon.visible = true;
                    this._ccIcon.show();
                }
            }
        } catch (_e) {}
    }

    disable() {
        if (!this.enabled)
            return;
        this.enabled = false;
        if (globalThis._macNotificationCenter === this) {
            globalThis._macNotificationCenter = null;
        }

        if (this._reorderTimeoutId) {
            GLib.source_remove(this._reorderTimeoutId);
            this._reorderTimeoutId = null;
        }

        // Destroy our custom buttons and properly remove their containers from the panel
        const customWidgets = [
            this._privacyIndicator,
            this._wifiButton,
            this._bluetoothButton,
            this._volumeButton,
            this._batteryWidget,
        ];

        for (const w of customWidgets) {
            if (w) {
                try {
                    const c = w.container || w;
                    const p = c.get_parent ? c.get_parent() : null;
                    if (p) p.remove_child(c);
                } catch (_e) {}
                try {
                    w.destroy();
                } catch (_e) {}
            }
        }
        this._privacyIndicator = null;
        this._wifiButton = null;
        this._bluetoothButton = null;
        this._volumeButton = null;
        this._batteryWidget = null;

        // Restore Control Center
        const quickSettings = Main.panel?.statusArea?.quickSettings;
        if (quickSettings) {
            if (this._macControlCenter) {
                try { this._macControlCenter.destroy(); } catch (_) {}
                this._macControlCenter = null;
            }
            if (quickSettings.menu?._grid) {
                quickSettings.menu._grid.visible = true;
                quickSettings.menu._grid.show();
                quickSettings.menu._grid.style = null;
            }
            if (this._ccIcon) {
                try {
                    quickSettings.remove_child(this._ccIcon);
                    this._ccIcon.destroy();
                } catch (_e) {}
                this._ccIcon = null;
            }
            if (quickSettings._indicators) {
                quickSettings._indicators.visible = true;
                if (quickSettings._indicators.get_parent() !== quickSettings) {
                    quickSettings.insert_child_at_index(quickSettings._indicators, 0);
                }
            }
            quickSettings.remove_style_class_name('mac-control-center-button');
            quickSettings.style = null;

            if (quickSettings.menu?._boxPointer) {
                const bp = quickSettings.menu._boxPointer;
                delete bp.open;
                delete bp.close;
                delete bp._reposition;
            }
            this._cleanupActiveEffects();
        }

        // Restore DateMenu
        const dateMenu = Main.panel?.statusArea?.dateMenu;
        if (dateMenu?.container) {
            if (dateMenu._directClickId) {
                try { dateMenu.disconnect(dateMenu._directClickId); } catch (_) {}
                dateMenu._directClickId = null;
            }
            if (dateMenu._directTouchId) {
                try { dateMenu.disconnect(dateMenu._directTouchId); } catch (_) {}
                dateMenu._directTouchId = null;
            }
            const container = dateMenu.container;
            const currentParent = container.get_parent();
            if (currentParent)
                currentParent.remove_child(container);

            const targetParent = this._origDateMenuParent || Main.panel._centerBox;
            if (targetParent)
                targetParent.add_child(container);

            if (container._clickConnId) {
                try { container.disconnect(container._clickConnId); } catch (_) {}
                container._clickConnId = null;
            }

            if (dateMenu.menu) {
                if (dateMenu.menu._origOpen) {
                    dateMenu.menu.open = dateMenu.menu._origOpen;
                    delete dateMenu.menu._origOpen;
                }
                if (dateMenu.menu._origToggle) {
                    dateMenu.menu.toggle = dateMenu.menu._origToggle;
                    delete dateMenu.menu._origToggle;
                }
                if (dateMenu.menu._origClose) {
                    dateMenu.menu.close = dateMenu.menu._origClose;
                    delete dateMenu.menu._origClose;
                }
                dateMenu.menu._arrowAlignment = 0.5;
                if (typeof dateMenu.menu.setSourceAlignment === 'function')
                    dateMenu.menu.setSourceAlignment(0.5);
            }
        }

        this._disconnectNotifCenterListeners?.();
        if (this._notifCenterActor) {
            try { this._notifCenterActor.destroy(); } catch (_) {}
            this._notifCenterActor = null;
        }

        if (this._qsHoverSwitchId && Main.panel?.statusArea?.quickSettings) {
            try { Main.panel.statusArea.quickSettings.disconnect(this._qsHoverSwitchId); } catch (_) {}
            this._qsHoverSwitchId = null;
        }
        if (Main.panel?.statusArea?.quickSettings?.menu?._macNotifCloseConn) {
            try { Main.panel.statusArea.quickSettings.menu.disconnect(Main.panel.statusArea.quickSettings.menu._macNotifCloseConn); } catch (_) {}
            delete Main.panel.statusArea.quickSettings.menu._macNotifCloseConn;
        }
        if (this._dmHoverSwitchId && Main.panel?.statusArea?.dateMenu) {
            try { Main.panel.statusArea.dateMenu.disconnect(this._dmHoverSwitchId); } catch (_) {}
            this._dmHoverSwitchId = null;
        }
        if (this._dmContainerHoverSwitchId && Main.panel?.statusArea?.dateMenu?.container) {
            try { Main.panel.statusArea.dateMenu.container.disconnect(this._dmContainerHoverSwitchId); } catch (_) {}
            this._dmContainerHoverSwitchId = null;
        }

        if (Main.panel?.menuManager?._macOrigChangeMenu) {
            Main.panel.menuManager._changeMenu = Main.panel.menuManager._macOrigChangeMenu;
            delete Main.panel.menuManager._macOrigChangeMenu;
        }

        if (this._stylingMonitor) {
            try { this._stylingMonitor.cancel(); } catch (_e) {}
            this._stylingMonitor = null;
        }

        this._cleanupMenuHoverGlide();

        this.connections.disconnect_all();
    }

    _setupMenuHoverGlide() {
        // Disabled: Menu hover styling is handled natively via CSS to prevent breaking BoxPointer layouts
    }

    _cleanupMenuHoverGlide() {
        if (this._origPopupMenuInit) {
            try {
                const anyMenu = Main.panel?.statusArea?.quickSettings?.menu;
                let proto = anyMenu ? Object.getPrototypeOf(anyMenu) : null;
                while (proto && proto.constructor.name !== "PopupMenu") {
                    proto = Object.getPrototypeOf(proto);
                }
                if (proto && proto._init) {
                    proto._init = this._origPopupMenuInit;
                }
            } catch (_) {}
            this._origPopupMenuInit = null;
        }
        this._trackedMenus = null;
    }
};
