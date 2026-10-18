import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import NM from 'gi://NM';
import UPowerGlib from 'gi://UPowerGlib';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { buildNotificationCard, MacNotificationGroup } from './notifications_v3.js';
import { MacControlCenter } from './control_center_v30.js';
import { MacInputSwitcher } from './mac_input_switcher_v11.js';
import { MacFeatheredBackdropBlur } from './mac_feathered_backdrop_blur.js';
import { t, tf } from './mac_i18n.js';
import {
    populateUniversalWifiContent,
    populateUniversalBluetoothContent,
} from './mac_menus_shared_v5.js';

function resolveCCIcon() {
    const home = GLib.get_home_dir();
    const candidates = [
        `${home}/.themes/macW1Y-Dark/icons/control-center.png`,
        `${home}/.themes/macW1Y-Dark-solid/icons/control-center.png`,
        `${home}/.themes/MacTahoe-Dark/icons/control-center.png`,
        `${home}/.local/share/icons/hicolor/scalable/apps/control-center.png`,
        `/usr/share/themes/macW1Y-Dark/icons/control-center.png`,
        `${home}/macW1Y/icons/control-center.png`,
        `${home}/MACTHEMEFILES/icons/control-center.png`,
    ];
    for (const p of candidates) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
    }
    return `${home}/.themes/macW1Y-Dark/icons/control-center.png`;
}

const CC_PNG_PATH = resolveCCIcon();
const _UID = Math.floor(Math.random() * 100000000);

const ACCENT_COLOR_MAP = {
    'blue': '#007aff',
    'teal': '#30b0c7',
    'green': '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff9500',
    'red': '#ff3b30',
    'pink': '#ff2d55',
    'purple': '#af52de',
    'slate': '#8e8e93',
    'brown': '#a27447',
};

function getSystemAccentColor() {
    try {
        const Gio = imports.gi.Gio;
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#007aff';
    } catch (_e) {
        return '#007aff';
    }
}

function createMacToggleSwitch(initialState, onToggle) {
    let state = Boolean(initialState);
    const accent = getSystemAccentColor();

    const switchBtn = new St.Button({
        style_class: 'mac-cc-switch-btn',
        style: 'width: 38px !important; height: 22px !important; padding: 0 !important; margin: 0 !important; background: transparent !important; background-color: transparent !important; border: none !important; box-shadow: none !important;',
        reactive: true,
        can_focus: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const track = new St.Widget({
        style_class: 'mac-cc-switch-track',
        style: `width: 38px !important; height: 22px !important; border-radius: 11px !important; background-color: ${state ? accent : 'rgba(255, 255, 255, 0.28)'} !important;`,
        clip_to_allocation: true,
        width: 38,
        height: 22,
    });
    switchBtn.set_child(track);

    const thumb = new St.Widget({
        style_class: 'mac-cc-switch-thumb',
        style: 'width: 18px !important; height: 18px !important; border-radius: 9px !important; background-color: #ffffff !important;',
        x: 2,
        y: 2,
        width: 18,
        height: 18,
        translation_x: state ? 16 : 0,
    });
    track.add_child(thumb);

    const updateVisuals = (newState, animate = true) => {
        state = newState;
        const curAccent = getSystemAccentColor();
        track.style = `width: 38px !important; height: 22px !important; border-radius: 11px !important; background-color: ${state ? curAccent : 'rgba(255, 255, 255, 0.28)'} !important;`;
        const targetTransX = state ? 16 : 0;
        if (animate) {
            thumb.ease({
                translation_x: targetTransX,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            thumb.translation_x = targetTransX;
        }
    };

    switchBtn.connect('clicked', () => {
        const newState = !state;
        updateVisuals(newState, true);
        if (onToggle) onToggle(newState);
    });

    return {
        actor: switchBtn,
        getState: () => state,
        setState: (val, animate = false) => updateVisuals(val, animate),
    };
}

function getBluetoothDeviceIcon(iconName, deviceName) {
    const name = (deviceName || '').toLowerCase();
    const icon = (iconName || '').toLowerCase();
    if (icon.includes('head') || icon.includes('audio') || name.includes('head') || name.includes('b40') || name.includes('airpod') || name.includes('bud') || name.includes('sound') || name.includes('wh-') || name.includes('wf-')) {
        return 'audio-headphones-symbolic';
    }
    if (icon.includes('mouse') || name.includes('mouse') || name.includes('rztk') || name.includes('mx master')) {
        return 'input-mouse-symbolic';
    }
    if (icon.includes('keyboard') || name.includes('keyboard') || name.includes('keychron')) {
        return 'input-keyboard-symbolic';
    }
    if (icon.includes('gaming') || icon.includes('gamepad') || name.includes('playstation') || name.includes('dualshock') || name.includes('dualsense') || name.includes('xbox') || name.includes('controller')) {
        return 'input-gaming-symbolic';
    }
    return 'bluetooth-active-symbolic';
}

function createCircleBadge(iconName, isActive = false, iconSize = 14) {
    const accent = getSystemAccentColor();
    const badge = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        style_class: isActive ? 'mac-menu-circle-badge-accent' : 'mac-menu-circle-badge',
        style: isActive ? `background-color: ${accent} !important;` : '',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    if (isActive) {
        icon.style = 'color: #ffffff;';
    }
    badge.add_child(icon);
    return badge;
}

function setupMacMenuItem(item) {
    if (!item) return;
    item.can_focus = false;
    item.style = 'padding: 4px 10px 4px 4px !important;';
    item.connectObject('notify::hover', () => {
        if (!item.hover) {
            item.remove_style_pseudo_class('selected');
            item.remove_style_pseudo_class('focus');
            item.remove_style_pseudo_class('active');
            if (item.has_key_focus?.()) {
                global.stage.set_key_focus(null);
            }
        }
    }, item);
}

function createMacSectionHeader(title) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });
    item.style = 'margin: 2px 4px !important; padding: 4px 6px 2px 4px !important; min-height: 18px !important; background: transparent !important;';
    if (item._ornamentLabel) {
        try { item.remove_child(item._ornamentLabel); } catch (_) {}
        item._ornamentLabel.destroy();
        item._ornamentLabel = null;
    }
    const label = new St.Label({
        text: title,
        style_class: 'mac-menu-section-label',
        style: 'font-size: 11px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.45) !important; padding: 0 !important; margin: 0 !important;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    item.add_child(label);
    return item;
}

function createMacStatusText(text) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });
    item.style = 'margin: 2px 4px !important; padding: 4px 6px 4px 4px !important; min-height: 20px !important; background: transparent !important;';
    if (item._ornamentLabel) {
        try { item.remove_child(item._ornamentLabel); } catch (_) {}
        item._ornamentLabel.destroy();
        item._ornamentLabel = null;
    }
    const label = new St.Label({
        text: text,
        style_class: 'mac-menu-status-text',
        style: 'font-size: 11px !important; font-weight: 400 !important; color: rgba(255, 255, 255, 0.45) !important; padding: 0 !important; margin: 0 !important;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    item.add_child(label);
    return item;
}

function setupMacMenuHoverCleanup(menu) {
    if (menu?.actor && !menu._macHoverCleanupHooked) {
        menu._macHoverCleanupHooked = true;
        menu.actor.connectObject('leave-event', () => {
            for (const item of menu._getMenuItems()) {
                if (item && item.reactive) {
                    item.remove_style_pseudo_class('selected');
                    item.remove_style_pseudo_class('focus');
                    item.remove_style_pseudo_class('hover');
                    item.remove_style_pseudo_class('active');
                    if (item.has_key_focus?.()) {
                        global.stage.set_key_focus(null);
                    }
                }
            }
        }, menu.actor);
    }
}

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
        this.menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important;';

        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        populateUniversalWifiContent(this.menu, {
            nmClient: this._nmClient,
            wifiDevice: this._wifiDevice,
            isEnabled,
            onToggle: (newState) => {
                if (this._nmClient) {
                    this._nmClient.wireless_enabled = newState;
                }
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._populateMenu();
                    this._sync();
                    return GLib.SOURCE_REMOVE;
                });
            },
            isControlCenter: false,
            onClose: () => this.menu.close(),
            onOpenSettings: (panel) => this._openSettings(panel),
        });

        setupMacMenuHoverCleanup(this.menu);
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
        this.menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important;';

        const powered = Boolean(this._btClient?.default_adapter_powered);
        populateUniversalBluetoothContent(this.menu, {
            btClient: this._btClient,
            isPowered: powered,
            onToggle: (newState) => {
                if (this._btClient) {
                    this._btClient.default_adapter_powered = newState;
                }
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._populateMenu();
                    this._sync();
                    return GLib.SOURCE_REMOVE;
                });
            },
            isControlCenter: false,
            onClose: () => this.menu.close(),
            onOpenSettings: (_panel) => {
                try {
                    GLib.spawn_command_line_async('gnome-control-center bluetooth');
                } catch (_) {}
            },
        });

        setupMacMenuHoverCleanup(this.menu);
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
        this.menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important;';

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
        slider.connect('drag-end', () => {
            try {
                global.display.get_sound_player().play_from_theme('audio-volume-change', 'Volume', null);
            } catch (_e) {}
        });

        sliderBox.add_child(slider);
        sliderBox.add_child(percentLabel);
        this.menu.addMenuItem(sliderCard);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Output Device Selection
        const secHeader = createMacSectionHeader(t('output_device', 'Вихідний пристрій'));
        this.menu.addMenuItem(secHeader);

        const sinks = this._control.get_sinks() || [];
        for (const s of sinks) {
            const isDefault = sink && s.get_id() === sink.get_id();
            const sinkItem = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                can_focus: false,
                style_class: isDefault ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
            });
            setupMacMenuItem(sinkItem);

            const devIconName = s.get_name()?.toLowerCase()?.includes('headphone') ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic';
            const icon = new St.Icon({
                icon_name: devIconName,
                icon_size: 15,
                style_class: 'popup-menu-icon',
            });
            sinkItem.add_child(icon);

            const desc = new St.Label({
                text: s.get_description() || t('audio_output', 'Аудіовихід'),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            desc.clutter_text.line_wrap = false;
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

        const settingsItem = new PopupMenu.PopupMenuItem(t('sound_settings', 'Параметри звуку...'), { style_class: 'mac-menu-footer-button' });
        setupMacMenuItem(settingsItem);
        settingsItem.connect('activate', () => {
            this.menu.close();
            GLib.spawn_command_line_async('gnome-control-center sound');
        });
        this.menu.addMenuItem(settingsItem);

        setupMacMenuHoverCleanup(this.menu);
    }
});

/* ==========================================================================
   4. Battery Indicator Widget (Display-only, non-reactive, single instance)
   ========================================================================== */
const BatteryWidget = GObject.registerClass({
    GTypeName: `MacBatteryWidget_${_UID}`,
}, class BatteryWidget extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Battery');

        this.reactive = true;
        this.can_focus = true;
        this.track_hover = true;
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

        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open)
                this._populateMenu();
        }, this);

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
        try { this._populateMenu(); } catch (_) {}
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

        const isCharging = (
            this._upowerDevice.state === UPowerGlib.DeviceState.CHARGING ||
            this._upowerDevice.state === UPowerGlib.DeviceState.FULLY_CHARGED ||
            this._upowerDevice.state === UPowerGlib.DeviceState.PENDING_CHARGE
        );
        if (this._lastChargingState !== undefined && this._lastChargingState !== isCharging) {
            try {
                const snd = isCharging ? 'power-plug' : 'power-unplug';
                global.display.get_sound_player().play_from_theme(snd, 'Power state change', null);
            } catch (_e) {}
        }
        this._lastChargingState = isCharging;

        this.visible = this._upowerDevice.is_present;
    }

    _populateMenu() {
        this.menu.removeAll();
        this.menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important;';

        const pct = this._upowerDevice ? Math.round(this._upowerDevice.percentage) : 100;
        const isCharging = this._upowerDevice && (
            this._upowerDevice.state === UPowerGlib.DeviceState.CHARGING ||
            this._upowerDevice.state === UPowerGlib.DeviceState.FULLY_CHARGED ||
            this._upowerDevice.state === UPowerGlib.DeviceState.PENDING_CHARGE
        );

        // 1. Header Row & Subtitle (matching Photo 3)
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'mac-menu-header-row',
        });

        const headerBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        headerItem.add_child(headerBox);

        const topRow = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        headerBox.add_child(topRow);

        const titleLbl = new St.Label({
            text: t('battery', 'Акумулятор'),
            style_class: 'mac-menu-header-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(titleLbl);

        const pctLbl = new St.Label({
            text: `${pct} %`,
            style_class: 'mac-menu-header-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(pctLbl);

        const powerSourceText = isCharging
            ? t('power_source_adapter', 'Джерело живлення: адаптер живлення')
            : t('power_source_battery', 'Джерело живлення: акумулятор');
        const subLbl = new St.Label({
            text: powerSourceText,
            style_class: 'mac-menu-header-subtitle',
        });
        headerBox.add_child(subLbl);
        this.menu.addMenuItem(headerItem);

        // Thin separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Section: Режим енергоспоживання
        const pwrModeHeader = createMacSectionHeader(t('energy_mode', 'Режим енергоспоживання'));
        this.menu.addMenuItem(pwrModeHeader);

        // Check power profile
        let isPowerSaver = false;
        try {
            const [, stdout] = GLib.spawn_command_line_sync('powerprofilesctl get');
            const prof = new TextDecoder('utf-8').decode(stdout).trim();
            isPowerSaver = (prof === 'power-saver');
        } catch (_) {}

        const saverItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: isPowerSaver ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
        });
        setupMacMenuItem(saverItem);

        const badgeBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: isPowerSaver ? 'mac-menu-squircle-badge-dark mac-menu-squircle-badge-active' : 'mac-menu-squircle-badge-dark',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const batIcon = new St.Icon({
            icon_name: 'battery-level-100-symbolic',
            icon_size: 13,
            style: isPowerSaver ? 'color: #000000;' : 'color: #ffffff;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        badgeBox.add_child(batIcon);
        saverItem.add_child(badgeBox);

        const saverLbl = new St.Label({
            text: t('low_power_mode', 'Енергозбереження'),
            style_class: 'mac-menu-item-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        saverItem.add_child(saverLbl);

        if (isPowerSaver) {
            const checkIcon = new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 13,
                style: 'color: #ffffff;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            saverItem.add_child(checkIcon);
        }

        saverItem.connect('activate', () => {
            this.menu.close();
            const targetProfile = isPowerSaver ? 'balanced' : 'power-saver';
            Util.spawnCommandLine(`powerprofilesctl set ${targetProfile}`);
        });
        this.menu.addMenuItem(saverItem);

        // Thin separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 3. Status text: Немає програм із високим споживанням енергії
        const statusItem = createMacStatusText(t('no_apps_using_energy', 'Немає програм із високим споживанням енергії'));
        this.menu.addMenuItem(statusItem);

        // Thin separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Footer action: Параметри акумулятора...
        const settingsItem = new PopupMenu.PopupMenuItem(t('battery_settings', 'Параметри акумулятора...'), {
            style_class: 'mac-menu-footer-button',
            can_focus: false,
        });
        setupMacMenuItem(settingsItem);
        settingsItem.connect('activate', () => {
            this.menu.close();
            GLib.spawn_command_line_async('gnome-control-center power');
        });
        this.menu.addMenuItem(settingsItem);

        setupMacMenuHoverCleanup(this.menu);
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

        const header = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'mac-menu-header-row',
        });
        if (header._ornamentLabel) {
            try { header.remove_child(header._ornamentLabel); } catch (_) {}
            header._ornamentLabel.destroy();
            header._ornamentLabel = null;
        }
        const titleLbl = new St.Label({
            text: t('privacy', 'Конфіденційність'),
            style_class: 'mac-menu-header-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(titleLbl);
        this.menu.addMenuItem(header);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const outputs = this._control.get_source_outputs() || [];
        const cam = Main.panel.statusArea.quickSettings?._camera?._cameraMonitor;
        const isCamActive = Boolean(cam?.cameras_in_use);

        if (outputs.length > 0) {
            const micSec = createMacSectionHeader(t('mic_in_use', 'Мікрофон використовується'));
            this.menu.addMenuItem(micSec);

            for (const out of outputs) {
                const appName = out.get_name() || out.get_application_id() || t('application', 'Програма');
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
            const camSec = createMacSectionHeader(t('cam_in_use', 'Камера використовується'));
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
                text: t('app_using_webcam', 'Програма використовує вебкамеру'),
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

class MenuHoverTracker {
    constructor(menu) {
        this._menu = menu;
        this._pill = null;
        this._itemSignals = [];
        this._hideTimeoutId = 0;
        this._activeItem = null;

        if (menu && menu.box) {
            this._setup();
        }
    }

    _setup() {
        this._menu.connectObject('open-state-changed', (_m, open) => {
            if (open) {
                this._ensurePill();
                this._updateItems();
            } else {
                this._hidePill(true);
            }
        }, this);

        if (this._menu.box) {
            this._menu.box.add_style_class_name('mac-menu-hover-glide-active');
            this._menu.box.connectObject(
                'child-added', () => this._updateItems(),
                'child-removed', () => this._updateItems(),
                this
            );
        }

        if (this._menu.isOpen) {
            this._ensurePill();
            this._updateItems();
        }
    }

    _ensurePill() {
        if (this._pill && this._pill.get_parent()) return;
        const box = this._menu.box;
        const parent = box ? box.get_parent() : null;
        if (!parent) return;

        const accent = typeof getSystemAccentColor === 'function' ? getSystemAccentColor() : '#007aff';
        this._pill = new St.Widget({
            style_class: 'mac-menu-hover-pill',
            style: `background-color: transparent !important; opacity: 0 !important; border-radius: 9999px !important;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            opacity: 0,
            reactive: false,
        });
        try {
            parent.insert_child_below(this._pill, box);
        } catch (_e) {
            try { parent.add_child(this._pill); } catch (_e2) {}
        }
    }

    _updateItems() {
        this._cleanupItemSignals();
        const box = this._menu.box;
        if (!box) return;

        const children = box.get_children();
        for (const child of children) {
            if (!child || !child.reactive) continue;
            if (child.has_style_class_name && (
                child.has_style_class_name('popup-separator-menu-item') ||
                child.has_style_class_name('popup-inactive-menu-item') ||
                child.has_style_class_name('popup-sub-menu') ||
                child.has_style_class_name('mac-menu-section-label') ||
                child.has_style_class_name('mac-menu-hover-pill')
            )) continue;

            if (child.menu && !child.menu._hasHoverTracker && child.menu.box) {
                child.menu._hasHoverTracker = true;
                new MenuHoverTracker(child.menu);
            }

            const hoverId = child.connect('notify::hover', () => this._onItemState(child));
            const activeId = child.connect('notify::active', () => this._onItemState(child));
            this._itemSignals.push({ actor: child, id: hoverId });
            this._itemSignals.push({ actor: child, id: activeId });
        }
    }

    _onItemState(child) {
        if (child.hover || child.active) {
            if (this._hideTimeoutId) {
                GLib.source_remove(this._hideTimeoutId);
                this._hideTimeoutId = 0;
            }
            this._glideTo(child);
        } else {
            if (!this._hideTimeoutId) {
                this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    this._hideTimeoutId = 0;
                    const box = this._menu.box;
                    const anyActive = box && box.get_children().some(c => c.hover || c.active);
                    if (!anyActive) {
                        this._hidePill(false);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _glideTo(child) {
        if (!child.visible || !child.get_stage()) return;
        this._ensurePill();
        if (!this._pill) return;
        const parent = this._menu.box?.get_parent();
        if (!parent || !parent.get_stage()) return;

        try {
            const [px, py] = parent.get_transformed_position();
            const [cx, cy] = child.get_transformed_position();
            if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

            const relX = cx - px;
            const relY = cy - py;
            const w = child.width;
            const h = child.height;

            this._activeItem = child;
            this._pill.remove_all_transitions();

            if (this._pill.opacity === 0) {
                this._pill.x = relX;
                this._pill.y = relY;
                this._pill.width = w;
                this._pill.height = h;
                this._pill.ease({
                    opacity: 255,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this._pill.ease({
                    x: relX,
                    y: relY,
                    width: w,
                    height: h,
                    opacity: 255,
                    duration: 140,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        } catch (_e) {}
    }

    _hidePill(immediate = false) {
        this._activeItem = null;
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (!this._pill) return;
        this._pill.remove_all_transitions();
        if (immediate) {
            this._pill.opacity = 0;
        } else {
            this._pill.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        if (this._menu.box) {
            for (const c of this._menu.box.get_children()) {
                if (c && c.remove_style_pseudo_class) {
                    c.remove_style_pseudo_class('selected');
                    c.remove_style_pseudo_class('active');
                    c.remove_style_pseudo_class('focus');
                }
            }
        }
    }

    _cleanupItemSignals() {
        for (const s of this._itemSignals) {
            try { s.actor.disconnect(s.id); } catch (_) {}
        }
        this._itemSignals = [];
    }

    destroy() {
        try { this._cleanupItemSignals(); } catch (_) {}
        if (this._hideTimeoutId) {
            try { GLib.source_remove(this._hideTimeoutId); } catch (_) {}
            this._hideTimeoutId = 0;
        }
        if (this._pill) {
            try { this._pill.destroy(); } catch (_) {}
            this._pill = null;
        }
        try {
            if (this._menu && this._menu.box) {
                this._menu.box.remove_style_class_name('mac-menu-hover-glide-active');
                this._menu.box.disconnectObject(this);
            }
        } catch (_) {}
        try { this._menu?.disconnectObject(this); } catch (_) {}
    }
}

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
        this._isNotifCenterClosing = false;
        this._notifOutsideClickId = null;
        this._notifEscapeKeyId = null;
        this._macInputSwitcher = null;
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

    _setupLaunchpadHandler() {
        try {
            const toggleLaunchpad = () => {
                const now = Date.now();
                if (globalThis._lastLaunchpadToggle && (now - globalThis._lastLaunchpadToggle < 300)) {
                    return;
                }
                globalThis._lastLaunchpadToggle = now;
                if (typeof globalThis.toggleMacApplications === 'function') {
                    globalThis.toggleMacApplications();
                } else {
                    const extHome = GLib.get_home_dir();
                    import(`file://${extHome}/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu.js`)
                        .then(mod => mod.toggleApplicationsDialog())
                        .catch(() => {
                            if (Main.overview.visible) Main.overview.hide();
                            else Main.overview.showApps();
                        });
                }
            };

            if (!Shell.App.prototype._origActivate) {
                Shell.App.prototype._origActivate = Shell.App.prototype.activate;
                Shell.App.prototype.activate = function(...args) {
                    if (this.get_id() === 'launchpad.desktop') {
                        toggleLaunchpad();
                        return;
                    }
                    return Shell.App.prototype._origActivate.apply(this, args);
                };
            }

            const hookDockIconProto = (proto) => {
                if (!proto || proto._origDockActivate) return;
                proto._origDockActivate = proto._activate;
                proto._activate = function(params) {
                    if (this.app?.get_id() === 'launchpad.desktop') {
                        toggleLaunchpad();
                        return;
                    }
                    return proto._origDockActivate.call(this, params);
                };
            };

            const findAndHookDock = () => {
                try {
                    const dock = Main.layoutManager.uiGroup.get_children().find(c => c.constructor.name === 'DashToDock');
                    const box = (dock?.dash?._boxContainer || dock?.dash?._box)?.get_children?.()?.[0];
                    const item = box?.get_children?.()?.find(c => (c.app?.get_id?.() || c.child?.app?.get_id?.()) === 'launchpad.desktop' || c.child?.app || c.app);
                    const icon = item?.child || item;
                    if (icon) {
                        let cur = Object.getPrototypeOf(icon);
                        while (cur && cur !== Object.prototype) {
                            if (typeof cur._activate === 'function') {
                                hookDockIconProto(cur);
                            }
                            cur = Object.getPrototypeOf(cur);
                        }
                    }
                } catch (_err) {}
            };

            findAndHookDock();

            try {
                const extHome = GLib.get_home_dir();
                import(`file://${extHome}/.local/share/gnome-shell/extensions/dash-to-dock@micxgx.gmail.com/appIcons.js`)
                    .then(mod => {
                        if (mod?.DockAbstractAppIcon?.prototype) {
                            hookDockIconProto(mod.DockAbstractAppIcon.prototype);
                        }
                        if (mod?.DockAppIcon?.prototype) {
                            hookDockIconProto(mod.DockAppIcon.prototype);
                        }
                    }).catch(() => {});
            } catch (_err) {}

            try {
                import('resource:///org/gnome/shell/ui/appFavorites.js').then(({ getAppFavorites }) => {
                    const favs = getAppFavorites();
                    if (favs && !favs._origRemoveFavorite) {
                        favs._origRemoveFavorite = favs.removeFavorite;
                        favs.removeFavorite = function(appId) {
                            if (appId === 'launchpad.desktop') return;
                            return this._origRemoveFavorite.call(this, appId);
                        };

                        favs._origMoveFavoriteToPos = favs.moveFavoriteToPos;
                        favs.moveFavoriteToPos = function(appId, pos) {
                            globalThis._isMovingFavorite = true;
                            try {
                                return this._origMoveFavoriteToPos.call(this, appId, pos);
                            } finally {
                                globalThis._isMovingFavorite = false;
                            }
                        };
                    }
                }).catch(() => {});
            } catch (_err) {}

            GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
                findAndHookDock();
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            console.error('[MenuBar] Launchpad activate hook error:', e);
        }
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
            const nTint = (typeof data.notif_tint === 'number') ? data.notif_tint : 0.15;
            const nRad = (typeof data.notif_radius === 'number') ? data.notif_radius : 24;
            this._updateNotifRealtime(nTint, nRad);

            // 4. Popup menus tint and radius
            const pTint = (typeof data.popup_tint === 'number') ? data.popup_tint : 0.10;
            const pRad = (typeof data.popup_radius === 'number') ? data.popup_radius : 24;
            this._updatePopupRealtime(pTint, pRad);

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

    _updatePopupRealtime(tint, radius = 24) {
        try {
            const style = `background-color: transparent !important; background: transparent !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: none !important; border-radius: ${radius}px !important;`;
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
            const style = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;';
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
                bg.opacity = 0;
                bg.visible = false;
            }
        } catch (e) {
            console.error('[MenuBarController] Error updating dock realtime:', e);
        }
    }

    _updateNotifRealtime(tint = 0.0, radius = 24) {
        try {
            const style = `background-color: transparent !important; background: transparent !important; border-radius: ${radius}px !important; border: 1px solid rgba(255, 255, 255, 0.20) !important; box-shadow: none !important;`;
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
            if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
                const { tintVal, tintStrength } = this._getNotifThemeParams();
                this._notifGlass.setTintStrength(tintStrength);
                this._notifGlass.setTintColor(tintVal, tintVal, tintVal);
                this._notifGlass.setBrightness(1.0);
                this._notifGlass.setIsDock(true);
                this._notifGlass.setCornerRadius(radius);
            }
        } catch (e) {
            console.error('[MenuBarController] Error updating notif realtime:', e);
        }
    }

    _getCcBlurSurface() {
        return null;
    }

    _getCcBlurActor() {
        if (!this._ccBackdropBlur) {
            this._ccBackdropBlur = new MacFeatheredBackdropBlur('mac-control-center-feathered-blur');
            const bp = Main.panel?.statusArea?.quickSettings?.menu?._boxPointer;
            const parent = bp?.get_parent() || Main.layoutManager.uiGroup;
            if (bp) {
                parent.insert_child_below(this._ccBackdropBlur.actor, bp);
            } else {
                parent.add_child(this._ccBackdropBlur.actor);
            }
        }
        return this._ccBackdropBlur.actor;
    }

    _syncCcBackdropBlur() {
        if (!this._ccBackdropBlur) {
            this._getCcBlurActor();
        }
        if (!this._ccBackdropBlur) return;
        const bp = Main.panel?.statusArea?.quickSettings?.menu?._boxPointer;
        if (!bp || bp.is_finalized?.()) return;

        const bpW = bp.width || (bp.get_transformed_size ? bp.get_transformed_size()[0] : 358);
        const bpH = bp.height || (bp.get_transformed_size ? bp.get_transformed_size()[1] : 418);
        const bpX = Number.isFinite(bp.x) ? bp.x : (bp.get_transformed_position ? bp.get_transformed_position()[0] - (bp.translation_x || 0) : 1550);
        const bpY = Number.isFinite(bp.y) ? bp.y : (bp.get_transformed_position ? bp.get_transformed_position()[1] - (bp.translation_y || 0) : 34);
        if (bpW <= 0 || bpH <= 0 || !Number.isFinite(bpX) || !Number.isFinite(bpY)) return;

        this._ccBackdropBlur.updateGeometry(bpX, bpY, bpW, bpH);

        const parent = bp.get_parent() || Main.layoutManager.uiGroup;
        if (this._ccBackdropBlur.actor.get_parent() !== parent) {
            if (this._ccBackdropBlur.actor.get_parent()) {
                this._ccBackdropBlur.actor.get_parent().remove_child(this._ccBackdropBlur.actor);
            }
            parent.insert_child_below(this._ccBackdropBlur.actor, bp);
        }
    }

    _getNotifBlurActor() {
        if (!this._notifBackdropBlur) {
            this._notifBackdropBlur = new MacFeatheredBackdropBlur('mac-notif-center-feathered-blur');
            if (this._notifCenterActor) {
                Main.layoutManager.uiGroup.insert_child_below(this._notifBackdropBlur.actor, this._notifCenterActor);
            } else {
                Main.layoutManager.uiGroup.add_child(this._notifBackdropBlur.actor);
            }
        }
        return this._notifBackdropBlur.actor;
    }

    _syncNotifBackdropBlur() {
        if (!this._notifBackdropBlur) {
            this._getNotifBlurActor();
        }
        if (!this._notifBackdropBlur || !this._notifCenterActor || this._notifCenterActor.is_finalized?.()) return;

        const cW = this._notifCenterActor.width || (this._notifCenterActor.get_transformed_size ? this._notifCenterActor.get_transformed_size()[0] : 460);
        const cH = this._notifCenterActor.height || (this._notifCenterActor.get_transformed_size ? this._notifCenterActor.get_transformed_size()[1] : 200);
        const cX = Number.isFinite(this._notifCenterActor.x) ? this._notifCenterActor.x : (this._notifCenterActor.get_transformed_position ? this._notifCenterActor.get_transformed_position()[0] - (this._notifCenterActor.translation_x || 0) : 1448);
        const cY = Number.isFinite(this._notifCenterActor.y) ? this._notifCenterActor.y : (this._notifCenterActor.get_transformed_position ? this._notifCenterActor.get_transformed_position()[1] - (this._notifCenterActor.translation_y || 0) : 40);
        if (cW <= 0 || cH <= 0 || !Number.isFinite(cX) || !Number.isFinite(cY)) return;

        this._notifBackdropBlur.updateGeometry(cX, cY, cW, cH);

        if (this._notifBackdropBlur.actor.get_parent() !== Main.layoutManager.uiGroup) {
            if (this._notifBackdropBlur.actor.get_parent()) {
                this._notifBackdropBlur.actor.get_parent().remove_child(this._notifBackdropBlur.actor);
            }
            Main.layoutManager.uiGroup.insert_child_below(this._notifBackdropBlur.actor, this._notifCenterActor);
        }
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

    async _ensureLiquidGlassLoaded() {
        try {
            const lgUuid = 'liquid-glass@thinkingcoding1231.gmail.com';
            if (Main.extensionManager) {
                let ext = Main.extensionManager.lookup(lgUuid);
                if (!ext) {
                    const dir = Gio.File.new_for_path(GLib.build_filenamev([global.userdatadir, 'extensions', lgUuid]));
                    if (dir.query_exists(null)) {
                        ext = Main.extensionManager.createExtensionObject(lgUuid, dir, 1);
                        await Main.extensionManager.loadExtension(ext);
                        console.log('[MenuBarController] Successfully dynamically loaded liquid-glass extension!');
                    }
                }
                ext = Main.extensionManager.lookup(lgUuid);
                if (ext && ext.state !== 1) {
                    await Main.extensionManager._callExtensionEnable(lgUuid);
                    console.log('[MenuBarController] Successfully enabled liquid-glass extension!');
                }
            }

            // Enforce subtle light darkening & soft blur for panel context menus (Wi-Fi, Bluetooth, Sound, Battery)
            try {
                const schemaDir = Gio.File.new_for_path(GLib.build_filenamev([global.userdatadir, 'extensions', lgUuid, 'schemas']));
                if (schemaDir.query_exists(null)) {
                    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDir.get_path(), Gio.SettingsSchemaSource.get_default(), false);
                    const schema = schemaSource.lookup(lgUuid, true);
                    if (schema) {
                        const lgSettings = new Gio.Settings({ settings_schema: schema });
                        lgSettings.set_string('panel-menu-tint-color', '#000000');
                        lgSettings.set_double('panel-menu-tint-strength', 0.08);
                        lgSettings.set_double('panel-menu-brightness', 1.0);
                        lgSettings.set_int('panel-menu-blur-radius', 20);
                        lgSettings.set_string('menu-tint-color', '#000000');
                        lgSettings.set_double('menu-tint-strength', 0.08);
                        lgSettings.set_double('menu-brightness', 1.0);
                        lgSettings.set_int('menu-blur-radius', 20);
                    }
                }
            } catch (err) {
                console.error('[MenuBarController] Error configuring liquid-glass panel-menu settings:', err);
            }
        } catch (e) {
            console.error('[MenuBarController] Error dynamically loading/enabling liquid-glass:', e);
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

        // Setup Launchpad instant activate handler
        this._setupLaunchpadHandler();

        // Setup macOS input source switcher
        try {
            this._macInputSwitcher = new MacInputSwitcher();
            this._macInputSwitcher.enable().catch(e => {
                console.error('[MenuBar] MacInputSwitcher enable promise error:', e);
            });
        } catch (e) {
            console.error('[MenuBar] MacInputSwitcher enable error:', e);
        }

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

        // 7b. Setup macOS style Keyboard / Input Source Menu
        this._setupKeyboardMenu();

        // 8. Watch for child additions to keep proper order and styling
        if (Main.panel?._rightBox) {
            this._childAddedId = Main.panel._rightBox.connect('child-added', () => {
                if (this.enabled)
                    this._scheduleReorder();
            });
        }
    }

    _setupKeyboardMenu() {
        try {
            let kb = Main.panel.statusArea?.keyboard;
            if (!kb || !kb.menu) {
                const bins = Main.panel._rightBox ? Main.panel._rightBox.get_children() : [];
                const kbBin = bins.find(b => b.get_first_child?.()?.constructor?.name === 'InputSourceIndicator');
                kb = kbBin?.get_first_child();
            }
            if (!kb || !kb.menu) return;

            // Safe guard against Mutter session logout crash when GNOME indicators change
            if (!kb._macSafePatched) {
                kb._macSafePatched = true;
                kb._buildPropSection = function() {};
                kb._setSourceAsActive = function(source) {
                    try {
                        const ism = this._inputSourceManager;
                        const currentSource = ism?.currentSource || source || this._getCurrentSource?.();
                        if (this._indicatorLabels) {
                            const activeIdx = this._calculateSourceIndicatorIndex ? this._calculateSourceIndicatorIndex(currentSource) : currentSource?.index;
                            for (const key of Object.keys(this._indicatorLabels)) {
                                const lbl = this._indicatorLabels[key];
                                if (!lbl || lbl._destroyed) continue;
                                if (String(key) === String(activeIdx)) {
                                    lbl.show();
                                } else {
                                    lbl.hide();
                                }
                            }
                        }
                    } catch (_) {}
                };
                kb._setSourceAsInactive = function() {};
                kb._currentSourceChanged = function(manager, oldSource) {
                    try {
                        const newSource = this._getCurrentSource ? this._getCurrentSource() : this._inputSourceManager?.currentSource;
                        if (newSource) {
                            this._setSourceAsActive(newSource);
                        }
                    } catch (_) {}
                };
                kb._keymapChanged = function() {
                    try {
                        const newSource = this._getCurrentSource ? this._getCurrentSource() : this._inputSourceManager?.currentSource;
                        if (newSource) {
                            this._setSourceAsActive(newSource);
                        }
                    } catch (_) {}
                };
            }

            kb.menu.disconnectObject(this);
            kb.menu.connectObject('open-state-changed', (_m, open) => {
                if (open) {
                    this._populateKeyboardMenu(kb);
                }
            }, this);
            try { this._populateKeyboardMenu(kb); } catch (_) {}
        } catch (e) {
            console.error('[MenuBarController] Error setting up keyboard menu:', e);
        }
    }

    _populateKeyboardMenu(kb) {
        if (!kb?.menu) return;
        if (kb._menuItems) {
            kb._menuItems = [];
        }
        kb.menu.removeAll();

        const ism = kb._inputSourceManager;
        const currentSource = ism?.currentSource;
        const sources = ism?.inputSources ? Object.values(ism.inputSources) : [];

        // 1. Input Sources List (matching Photo 4)
        for (const s of sources) {
            const isActive = currentSource && (currentSource.id === s.id || currentSource.index === s.index);
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                can_focus: false,
                style_class: isActive ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
            });
            setupMacMenuItem(item);

            // Checkmark slot (width: 18px)
            const checkSlot = new St.Label({
                text: isActive ? '✓' : '',
                style_class: 'mac-menu-check-slot',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(checkSlot);

            // Squircle badge: white background, black bold letters
            const id = (s.id || '').toLowerCase();
            const short = (s.shortName || '').toLowerCase();
            let badgeText = 'A';
            let displayTitle = s.displayName || s.id;

            if (id.includes('us') || id.includes('en') || short.includes('en')) {
                badgeText = 'A';
                displayTitle = 'ABC';
            } else if (id.includes('ua') || id.includes('uk') || short.includes('uk')) {
                badgeText = 'УК';
                displayTitle = 'Українська';
            } else if (id.includes('ru') || short.includes('ru')) {
                badgeText = 'РУ';
                displayTitle = 'Русская';
            } else if (id.includes('by') || short.includes('by')) {
                badgeText = 'БЕ';
                displayTitle = 'Беларуская';
            } else if (id.includes('pl') || short.includes('pl')) {
                badgeText = 'PL';
                displayTitle = 'Polski';
            } else if (id.includes('de') || short.includes('de')) {
                badgeText = 'DE';
                displayTitle = 'Deutsch';
            } else if (id.includes('fr') || short.includes('fr')) {
                badgeText = 'FR';
                displayTitle = 'Français';
            } else if (id.includes('es') || short.includes('es')) {
                badgeText = 'ES';
                displayTitle = 'Español';
            } else if (id.includes('it') || short.includes('it')) {
                badgeText = 'IT';
                displayTitle = 'Italiano';
            } else {
                badgeText = (s.shortName || id.slice(0, 2)).toUpperCase();
            }

            const badge = new St.Label({
                text: badgeText,
                style_class: 'mac-menu-squircle-badge',
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(badge);

            const nameLbl = new St.Label({
                text: displayTitle,
                style_class: 'mac-menu-item-title',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            item.add_child(nameLbl);

            item.connect('activate', () => {
                kb.menu.close();
                try { s.activate(); } catch (_) {}
            });

            kb.menu.addMenuItem(item);
        }

        // Thin separator
        kb.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Action: Показати панель «Емодзі та символи»
        const emojiItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'mac-menu-item-row',
        });
        setupMacMenuItem(emojiItem);

        const emojiCheck = new St.Label({
            text: '',
            style_class: 'mac-menu-check-slot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        emojiItem.add_child(emojiCheck);

        const emojiBadge = new St.Label({
            text: '⌘',
            style_class: 'mac-menu-squircle-badge-dark',
            y_align: Clutter.ActorAlign.CENTER,
        });
        emojiItem.add_child(emojiBadge);

        const emojiLbl = new St.Label({
            text: t('show_emoji_and_symbols', 'Показати панель «Емодзі та символи»'),
            style_class: 'mac-menu-item-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        emojiItem.add_child(emojiLbl);

        emojiItem.connect('activate', () => {
            kb.menu.close();
            GLib.spawn_command_line_async('gnome-characters');
        });
        kb.menu.addMenuItem(emojiItem);

        // 3. Action: Показати панель «Клавіатура»
        const layoutItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'mac-menu-item-row',
        });
        setupMacMenuItem(layoutItem);

        const layoutCheck = new St.Label({
            text: '',
            style_class: 'mac-menu-check-slot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        layoutItem.add_child(layoutCheck);

        const layoutBadge = new St.Label({
            text: '⌨',
            style_class: 'mac-menu-squircle-badge-dark',
            y_align: Clutter.ActorAlign.CENTER,
        });
        layoutItem.add_child(layoutBadge);

        const layoutLbl = new St.Label({
            text: t('show_keyboard_viewer', 'Показати панель «Клавіатура»'),
            style_class: 'mac-menu-item-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        layoutItem.add_child(layoutLbl);

        layoutItem.connect('activate', () => {
            kb.menu.close();
            try {
                if (typeof kb._showLayout === 'function') {
                    kb._showLayout();
                } else {
                    GLib.spawn_command_line_async('gkbd-keyboard-display');
                }
            } catch (_) {}
        });
        kb.menu.addMenuItem(layoutItem);

        // Thin separator
        kb.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Toggle row: Показувати назву джерела введення
        const showNameItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'mac-menu-item-row',
        });
        setupMacMenuItem(showNameItem);

        const showNameCheck = new St.Label({
            text: '',
            style_class: 'mac-menu-check-slot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        showNameItem.add_child(showNameCheck);

        const showNameLbl = new St.Label({
            text: t('show_input_source_name', 'Показувати назву джерела введення'),
            style_class: 'mac-menu-item-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        showNameItem.add_child(showNameLbl);

        showNameItem.connect('activate', () => {
            kb.menu.close();
        });
        kb.menu.addMenuItem(showNameItem);

        // Thin separator
        kb.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 5. Settings Footer: Відкрити параметри клавіатури...
        const settingsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'mac-menu-item-row',
        });
        setupMacMenuItem(settingsItem);

        const settingsCheck = new St.Label({
            text: '',
            style_class: 'mac-menu-check-slot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsItem.add_child(settingsCheck);

        const settingsLbl = new St.Label({
            text: t('keyboard_settings', 'Відкрити параметри клавіатури...'),
            style_class: 'mac-menu-item-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsItem.add_child(settingsLbl);

        settingsItem.connect('activate', () => {
            kb.menu.close();
            GLib.spawn_command_line_async('gnome-control-center keyboard');
        });
        kb.menu.addMenuItem(settingsItem);

        setupMacMenuHoverCleanup(kb.menu);
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

                        self._syncCcBackdropBlur();
                        if (self._ccBackdropBlur) {
                            self._ccBackdropBlur.show();
                            self._ccBackdropBlur.actor.opacity = 255;
                            self._ccBackdropBlur.actor.translation_x = 0;
                        }

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
                        if (self._ccBackdropBlur) {
                            self._ccBackdropBlur.animateSlideIn(220, 240);
                        }
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
                    if (self._ccBackdropBlur) {
                        self._ccBackdropBlur.hide();
                    }
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

            if (bp && !bp._ccAllocConnId) {
                bp._ccAllocConnId = bp.connect('notify::allocation', () => {
                    if (quickSettings.menu?.isOpen) {
                        self._syncCcBackdropBlur();
                    }
                });
            }

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
                self._syncCcBackdropBlur();
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
            clip_to_allocation: true,
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
            clip_to_allocation: true,
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
            text: t('notification_center', 'Центр повідомлень'),
            style_class: 'mac-notif-center-title',
            style: 'font-family: "SF Pro Display", "SF Pro Text", -apple-system, sans-serif !important; font-size: 20px !important; font-weight: 700 !important; color: #ffffff !important; text-shadow: 0 0 14px rgba(255, 255, 255, 0.55), 0 0 24px rgba(0, 0, 0, 0.8), 0 2px 12px rgba(0, 0, 0, 0.9) !important; background: transparent !important; margin: 0 !important; padding: 0 !important;',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        headerBox.add_child(label);

        const clearBtn = new St.Button({
            style_class: 'mac-notif-clear-btn',
            label: t('clear_all', 'Очистити всі'),
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            visible: false,
        });
        try {
            let BlurModule = null;
            try {
                BlurModule = globalThis.imports?.gi?.Blur;
            } catch (_) {}
            if (BlurModule?.BlurEffect) {
                clearBtn.add_effect(new BlurModule.BlurEffect({
                    mode: BlurModule.BlurMode?.BACKGROUND ?? 1,
                    radius: 3,
                    corner_radius: 9999,
                }));
            } else {
                clearBtn.add_effect(new Shell.BlurEffect({
                    mode: Shell.BlurMode.BACKGROUND,
                    radius: 3,
                }));
            }
        } catch (e) {
            console.warn(`[MenuBarController] Error adding blur to clearBtn: ${e}`);
        }
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
            style: 'spacing: 10px; padding: 0 16px 16px 8px; background: transparent !important;',
            x_expand: true,
            y_expand: false,
        });
        cardsBox.connect('notify::height', () => {
            if (this._notifCenterOpen && !this._isCardAnimating) {
                this._updateNotificationCenterGeometry();
            }
        });

        // Scrollable list of cards with smooth overlay scrollbars
        const scrollView = new St.ScrollView({
            style_class: 'mac-notif-center-scroll',
            style: 'background: transparent !important; border: none !important; padding: 0 !important;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: false,
            enable_mouse_scrolling: true,
        });
        scrollView.set_overlay_scrollbars(true);
        scrollView.set_child(cardsBox);
        scrollWrapper.add_child(scrollView);
        contentBox.add_child(scrollWrapper);

        const updateFades = () => {};

        globalThis._macOnCardTargetHeightChange = (card, targetH, currentH, isExpanding) => {
            if (this._notifCenterOpen) {
                this._handleCardTargetHeightChange(card, targetH, currentH, isExpanding);
            }
        };

        globalThis._macOnCardAnimationComplete = (card) => {
            this._isCardAnimating = false;
            if (this._notifCenterOpen) {
                this._updateNotificationCenterGeometry();
                this._syncNotifGlassRegions();
            }
        };

        globalThis._macEnsureCardVisible = (card) => {
            if (this._notifCenterOpen) {
                this._ensureCardVisible(card);
            }
        };

        // Empty state label with soft diffuse text blur
        const emptyLabel = new St.Label({
            text: t('no_new_notifications', 'Немає нових повідомлень'),
            style_class: 'mac-notif-empty-label',
            style: 'font-family: "SF Pro Text", -apple-system, sans-serif !important; font-size: 14px !important; color: rgba(255, 255, 255, 0.6) !important; text-shadow: 0 0 10px rgba(255, 255, 255, 0.45), 0 0 18px rgba(0, 0, 0, 0.85), 0 2px 10px rgba(0, 0, 0, 0.7) !important; text-align: center; padding: 36px 10px !important; margin: 0 !important;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        contentBox.add_child(emptyLabel);

        Main.layoutManager.uiGroup.add_child(container);

        container.connect('notify::translation-x', () => {
            if (this._notifCenterOpen || this._isNotifCenterClosing) {
                this._syncNotifGlassRegions();
                if (this._notifBackdropBlur?.actor) {
                    this._notifBackdropBlur.actor.translation_x = container.translation_x;
                }
            }
        });
        container.connect('notify::opacity', () => {
            if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
                this._notifGlass.opacity = container.opacity;
            }
            if (this._notifBackdropBlur?.actor) {
                this._notifBackdropBlur.actor.opacity = container.opacity;
            }
        });
        container.connect('notify::allocation', () => {
            if (this._notifCenterOpen) {
                this._syncNotifBackdropBlur();
            }
        });
        container.connect('notify::height', () => {
            if (this._notifCenterOpen) {
                this._syncNotifBackdropBlur();
            }
        });
        if (scrollView?.vadjustment) {
            scrollView.vadjustment.connect('notify::value', () => {
                if (this._notifCenterOpen || this._isNotifCenterClosing) this._syncNotifGlassRegions();
            });
        }

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
        this._notifTopFade = null;
        this._notifBottomFade = null;
        this._updateNotifFades = updateFades;
        this._notifCenterOpen = false;
        this._isCardAnimating = false;

        this._initNotifGlass();

        return container;
    }

    _getNotifThemeParams() {
        let isDark = true;
        try {
            const iface = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
            const scheme = iface.get_string('color-scheme');
            if (scheme === 'prefer-dark') isDark = true;
            else if (scheme === 'prefer-light') isDark = false;
            else {
                const gtk = iface.get_string('gtk-theme') || '';
                isDark = gtk.toLowerCase().includes('dark');
            }
        } catch (_) {
            isDark = true;
        }

        const tintVal = isDark ? 0.0 : 1.0;
        const baseStrength = 0.03; // Exactly 3% as requested by user
        const tintStrength = 0.03; // Exactly 3% as requested by user
        return { isDark, tintVal, baseStrength, tintStrength };
    }

    async _initNotifGlass() {
        if (this._notifGlass && !this._notifGlass.is_finalized?.()) return;
        try {
            const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
            const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
            const mod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
            const BackdropGlass = mod.BackdropGlass;

            this._notifGlass = new BackdropGlass({
                extensionPath: path,
                settings: ext?.stateObj?._settings || null,
                logger: console,
                owner: 'notification-center',
            });
            const { tintVal, tintStrength } = this._getNotifThemeParams();
            this._notifGlass.setIsDock(true);
            this._notifGlass.setMultiRegionMode(true);
            this._notifGlass.setCornerRadius(24.0);
            this._notifGlass.setBlurRadius(3.0);
            this._notifGlass.setTintStrength(tintStrength);
            this._notifGlass.setTintColor(tintVal, tintVal, tintVal);
            this._notifGlass.setBrightness(1.0);
            this._notifGlass.setSaturation(1.0);
            this._notifGlass.setContrast(1.0);
            this._notifGlass.setPadding(0);
            try {
                this._notifGlass._renderer.uniforms.set('shadow_intensity', 0.0);
                this._notifGlass._renderer.uniforms.set('shadow_radius', 0.0);
                this._notifGlass._renderer.uniforms.set('shadow_max_radius', 0.0);
            } catch (_) {}
            this._notifGlass.hide();

            if (this._notifCenterActor) {
                Main.layoutManager.uiGroup.insert_child_below(this._notifGlass, this._notifCenterActor);
            }
        } catch (e) {
            console.error(`[MenuBarController] Error initializing notif glass: ${e}`);
        }
    }

    _syncNotifGlassRegions() {
        if (!this._notifGlass || this._notifGlass.is_finalized?.() || (!this._notifCenterOpen && !this._isNotifCenterClosing)) {
            if (this._notifGlass && !this._notifGlass.is_finalized?.() && this._notifGlass.visible)
                this._notifGlass.hide();
            return;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        this._notifGlass.set_position(monitor.x, monitor.y);
        this._notifGlass.set_size(monitor.width, monitor.height);
        this._notifGlass.setResolution(monitor.width, monitor.height);

        if (!this._notifCardsBox || !this._notifScrollView) {
            this._notifGlass.hide();
            return;
        }

        const [scrollX, scrollY] = this._notifScrollView.get_transformed_position();
        const [scrollW, scrollH] = this._notifScrollView.get_transformed_size();

        const cards = this._notifCardsBox.get_children();
        const regions = [];
        const { tintVal, baseStrength, tintStrength } = this._getNotifThemeParams();

        const addRegionForCard = (cardActor, extraBottom = 0) => {
            if (!cardActor.visible || cardActor.opacity === 0) return;
            const [cardX, cardY] = cardActor.get_transformed_position();
            const [cardW, cardH] = cardActor.get_transformed_size();
            if (cardW <= 0 || cardH <= 0 || !Number.isFinite(cardX) || !Number.isFinite(cardY)) return;

            const visibleTop = Math.max(cardY, scrollY);
            const visibleBottom = Math.min(cardY + cardH + extraBottom, scrollY + scrollH);
            const visibleH = visibleBottom - visibleTop;

            if (visibleH < 6) return;

            regions.push({
                x: Math.round(cardX - monitor.x),
                y: Math.round(visibleTop - monitor.y),
                w: Math.round(cardW),
                h: Math.round(visibleH),
                tintR: tintVal,
                tintG: tintVal,
                tintB: tintVal,
                baseStrength: baseStrength,
            });
        };

        for (const child of cards) {
            if (child._macGroup) {
                const grp = child._macGroup;
                if (!grp.isExpanded) {
                    const top = grp.items[0];
                    if (top && top.banner.visible) {
                        const extraBottom = (grp.items.length >= 3) ? 14 : (grp.items.length >= 2 ? 8 : 0);
                        addRegionForCard(top.banner, extraBottom);
                    }
                } else {
                    for (const it of grp.items) {
                        if (it.banner.visible) addRegionForCard(it.banner);
                    }
                }
            } else if (typeof child.getGlassSubcards === 'function') {
                for (const sub of child.getGlassSubcards()) {
                    addRegionForCard(sub);
                }
            } else {
                addRegionForCard(child);
            }
        }

        if (regions.length > 0) {
            this._notifGlass.setTintColor(tintVal, tintVal, tintVal);
            this._notifGlass.setTintStrength(tintStrength);
            this._notifGlass.setBrightness(1.0);
            this._notifGlass.setIsDock(true);
            this._notifGlass.setGlassRegions(regions);
            if (!this._notifGlass._backdropLocked) {
                this._notifGlass.syncSources();
            }
            if (!this._notifGlass.visible)
                this._notifGlass.show();
        } else {
            this._notifGlass.hide();
        }
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
            if (this._notifCenterOpen || this._isNotifCenterClosing) {
                this._updateNotificationCenterGeometry();
                this._syncNotifGlassRegions();
            }
        });
        card.connect('notify::translation-x', () => {
            if (this._notifCenterOpen || this._isNotifCenterClosing) this._syncNotifGlassRegions();
        });
        card.connect('notify::translation-y', () => {
            if (this._notifCenterOpen || this._isNotifCenterClosing) this._syncNotifGlassRegions();
        });
        card.connect('notify::opacity', () => {
            if (this._notifCenterOpen || this._isNotifCenterClosing) this._syncNotifGlassRegions();
        });
    }

    _populateNotificationCards(activeBanners = []) {
        if (!this._notifCardsBox) return [];

        for (const child of this._notifCardsBox.get_children()) {
            if (child._macGroup) {
                child._macGroup.destroy();
            } else {
                child.remove_all_transitions();
                try { child.destroy(); } catch (_) {}
            }
        }
        this._notifCardsBox.remove_all_children();

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

        // Sort items by time (newest first)
        allItems.sort((a, b) => {
            const timeA = a.notification.datetime?.to_unix ? a.notification.datetime.to_unix() : 0;
            const timeB = b.notification.datetime?.to_unix ? b.notification.datetime.to_unix() : 0;
            return timeB - timeA;
        });

        // Group items by groupKey = (source?.id || source?.title || 'app')
        const groupsMap = new Map();
        for (const item of allItems) {
            const groupKey = item.source?.id || item.source?.title || 'app';
            if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, []);
            }
            groupsMap.get(groupKey).push(item);
        }

        const reservedCards = [];

        for (const [groupKey, groupItems] of groupsMap) {
            if (groupItems.length === 1) {
                const item = groupItems[0];
                const { source, notification, activeBanner } = item;
                const builder = buildNotificationCard;
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
                                this._syncNotifGlassRegions();
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
                cardData.banner.x_align = Clutter.ActorAlign.CENTER;

                if (activeBanner) {
                    cardData.banner.opacity = 0;
                    reservedCards.push({ card: cardData.banner, activeBanner });
                }

                this._notifCardsBox.add_child(cardData.banner);
            } else {
                // Group of 2 or more notifications: use MacNotificationGroup stack!
                const GroupClass = MacNotificationGroup;
                const group = new GroupClass(groupKey, {
                    sigma: 30,
                    isBanner: false,
                    onGeometryChanged: () => {
                        this._syncNotifGlassRegions();
                        this._updateNotificationCenterGeometry();
                    },
                    onExpand: () => {
                        this._syncNotifGlassRegions();
                        this._updateNotificationCenterGeometry();
                    },
                    onCollapse: () => {
                        this._syncNotifGlassRegions();
                        this._updateNotificationCenterGeometry();
                    },
                    onEmpty: () => {
                        if (group.actor.get_parent() === this._notifCardsBox) {
                            this._notifCardsBox.remove_child(group.actor);
                        }
                        this._updateEmptyState(this._notifCardsBox.get_children().length);
                        this._updateNotificationCenterGeometry();
                        this._syncNotifGlassRegions();
                    },
                });

                for (const item of groupItems) {
                    group.addNotification(item.source, item.notification, false);
                }

                this._setupCardGeometryTracking(group.actor);
                group.actor.x_align = Clutter.ActorAlign.CENTER;
                this._notifCardsBox.add_child(group.actor);
            }
        }

        this._updateEmptyState(this._notifCardsBox.get_children().length);
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

        const groupKey = source?.id || source?.title || 'app';
        const children = this._notifCardsBox.get_children();

        // 1. Check if group already exists
        const existingGroupActor = children.find(c => c._macGroup && c._macGroup.groupKey === groupKey);
        if (existingGroupActor) {
            existingGroupActor._macGroup.addNotification(source, notification, true);
            this._updateNotificationCenterGeometry();
            this._syncNotifGlassRegions();
            return;
        }

        // 2. Check if a single card exists for this source
        const singleCard = children.find(c => c._notification && ((c._notification.source?.id && c._notification.source.id === source?.id) || (c._notification.source?.title && c._notification.source.title === source?.title)));
        if (singleCard) {
            const oldNotif = singleCard._notification;
            const oldSource = singleCard._notification.source || source;
            const cardIdx = children.indexOf(singleCard);
            this._notifCardsBox.remove_child(singleCard);
            singleCard.destroy();

            const GroupClass = MacNotificationGroup;
            const group = new GroupClass(groupKey, {
                sigma: 30,
                isBanner: false,
                onGeometryChanged: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onExpand: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onCollapse: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onEmpty: () => {
                    if (group.actor.get_parent() === this._notifCardsBox) {
                        this._notifCardsBox.remove_child(group.actor);
                    }
                    this._updateEmptyState(this._notifCardsBox.get_children().length);
                    this._updateNotificationCenterGeometry();
                    this._syncNotifGlassRegions();
                },
            });

            group.addNotification(oldSource, oldNotif, false);
            group.addNotification(source, notification, true);

            this._setupCardGeometryTracking(group.actor);
            group.actor.x_align = Clutter.ActorAlign.CENTER;
            this._notifCardsBox.insert_child_at_index(group.actor, cardIdx >= 0 ? cardIdx : 0);

            this._updateEmptyState(this._notifCardsBox.get_children().length);
            this._updateNotificationCenterGeometry();
            this._syncNotifGlassRegions();
            return;
        }

        // 3. Otherwise add as single card
        const builder = buildNotificationCard;
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
                        this._syncNotifGlassRegions();
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
        cardData.banner.x_align = Clutter.ActorAlign.CENTER;

        this._notifCardsBox.insert_child_at_index(cardData.banner, 0);
        this._updateEmptyState(this._notifCardsBox.get_children().length);
        this._updateNotificationCenterGeometry();

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
            onComplete: () => {
                this._syncNotifGlassRegions();
            },
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

        const groupKey = source?.id || source?.title || 'app';
        const children = this._notifCardsBox.get_children();

        const existingGroupActor = children.find(c => c._macGroup && c._macGroup.groupKey === groupKey);
        if (existingGroupActor) {
            existingGroupActor._macGroup.addNotification(source, notification, true);
            this._updateNotificationCenterGeometry();
            this._syncNotifGlassRegions();
            return;
        }

        const singleCard = children.find(c => c._notification && ((c._notification.source?.id && c._notification.source.id === source?.id) || (c._notification.source?.title && c._notification.source.title === source?.title)));
        if (singleCard) {
            const oldNotif = singleCard._notification;
            const oldSource = singleCard._notification.source || source;
            const cardIdx = children.indexOf(singleCard);
            this._notifCardsBox.remove_child(singleCard);
            singleCard.destroy();

            const GroupClass = MacNotificationGroup;
            const group = new GroupClass(groupKey, {
                sigma: 30,
                isBanner: false,
                onGeometryChanged: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onExpand: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onCollapse: () => {
                    this._syncNotifGlassRegions();
                    this._updateNotificationCenterGeometry();
                },
                onEmpty: () => {
                    if (group.actor.get_parent() === this._notifCardsBox) {
                        this._notifCardsBox.remove_child(group.actor);
                    }
                    this._updateEmptyState(this._notifCardsBox.get_children().length);
                    this._updateNotificationCenterGeometry();
                    this._syncNotifGlassRegions();
                },
            });

            group.addNotification(oldSource, oldNotif, false);
            group.addNotification(source, notification, true);

            this._setupCardGeometryTracking(group.actor);
            group.actor.x_align = Clutter.ActorAlign.CENTER;
            this._notifCardsBox.insert_child_at_index(group.actor, cardIdx >= 0 ? cardIdx : 0);

            this._updateEmptyState(this._notifCardsBox.get_children().length);
            this._updateNotificationCenterGeometry();
            this._syncNotifGlassRegions();
            return;
        }

        const builder = buildNotificationCard;
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
                        this._syncNotifGlassRegions();
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
        cardData.banner.x_align = Clutter.ActorAlign.CENTER;

        cardData.banner.opacity = 255;
        this._notifCardsBox.insert_child_at_index(cardData.banner, 0);
        this._updateEmptyState(this._notifCardsBox.get_children().length);
        this._updateNotificationCenterGeometry();
        this._syncNotifGlassRegions();
    }

    _rebuildGradientBlur(w, h) {
        if (!this._notifCenterBg) return;
        this._notifCenterBg.destroy_all_children();
        this._blurSlices = [];
        this._blurCenterSlice = null;
    }

    _ensureCardVisible(card) {
        if (!card || !this._notifScrollView?.vadjustment) return;
        try {
            const vAdj = this._notifScrollView.vadjustment;
            const [_, cardY] = card.get_transformed_position();
            const [__, scrollY] = this._notifScrollView.get_transformed_position();
            const cardTop = cardY - scrollY + vAdj.value;
            const cardBottom = cardTop + card.height;
            const visibleHeight = this._notifScrollView.height;
            const visibleBottom = vAdj.value + visibleHeight;

            if (card.height >= visibleHeight || cardTop < vAdj.value) {
                vAdj.value = Math.max(0, cardTop - 8);
            } else if (cardBottom > visibleBottom) {
                const maxVal = Math.max(0, vAdj.upper - vAdj.page_size);
                vAdj.value = Math.min(maxVal, cardBottom - visibleHeight + 8);
            }
        } catch (_) {}
    }

    _handleCardTargetHeightChange(card, targetH, currentH, isExpanding) {
        if (!this._notifCenterOpen || !this._notifCardsBox || !this._notifScrollView) return;

        this._isCardAnimating = true;

        const targetW = 460;
        const monitor = Main.layoutManager.primaryMonitor;
        const topY = this._notifCenterActor.y || 40;
        const maxCenterH = monitor ? Math.max(260, (monitor.y + monitor.height) - topY - 28) : 750;

        const [hdrMin, hdrNat] = this._notifHeaderBox ? this._notifHeaderBox.get_preferred_height(targetW) : [0, 44];
        const headerH = Math.max(36, Math.round(hdrNat || 44));
        const maxScrollH = Math.max(120, maxCenterH - headerH - 16);

        // Sum natural heights of all cards, using targetH for the animating card
        const children = this._notifCardsBox.get_children();
        let finalCardsH = 0;
        const spacing = 10;
        for (let i = 0; i < children.length; i++) {
            const ch = children[i];
            let chH = 0;
            if (ch === card) {
                chH = targetH;
            } else {
                chH = ch.height > 0 ? ch.height : Math.round(ch.get_preferred_height(targetW)[1]);
            }
            finalCardsH += chH;
            if (i > 0) finalCardsH += spacing;
        }
        finalCardsH += 16; // bottom padding

        // The scrollbar requirement is strictly determined by the FINAL RESULT, not intermediate animation frames
        const willNeedScroll = finalCardsH > maxScrollH;

        if (willNeedScroll) {
            this._notifScrollView.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            const actualScrollH = maxScrollH;
            this._notifScrollView.height = actualScrollH;
            if (this._notifScrollWrapper) {
                this._notifScrollWrapper.height = actualScrollH;
            }
            const actualTotalH = Math.min(maxCenterH, headerH + actualScrollH + 16);
            this._notifCenterActor.height = actualTotalH;
            this._notifContentBox.height = actualTotalH;
            if (this._notifCenterBg) {
                this._notifCenterBg.height = actualTotalH;
            }
        } else {
            // Content fits in final state: forbid scrollbar immediately so it does not flicker during animation
            this._notifScrollView.vscrollbar_policy = St.PolicyType.NEVER;
            const actualScrollH = Math.max(50, finalCardsH);
            const actualTotalH = Math.min(maxCenterH, headerH + actualScrollH + 16);
            this._notifScrollView.height = actualScrollH;
            if (this._notifScrollWrapper) {
                this._notifScrollWrapper.height = actualScrollH;
            }
            this._notifCenterActor.height = actualTotalH;
            this._notifContentBox.height = actualTotalH;
            if (this._notifCenterBg) {
                this._notifCenterBg.height = actualTotalH;
            }
        }
    }

    _updateNotificationCenterGeometry() {
        if (!this._notifCenterActor || !this._notifContentBox) return;

        const targetW = 460;
        const monitor = Main.layoutManager.primaryMonitor;
        const topY = this._notifCenterActor.y || 40;
        const maxCenterH = monitor ? Math.max(260, (monitor.y + monitor.height) - topY - 28) : 750;

        const [hdrMin, hdrNat] = this._notifHeaderBox ? this._notifHeaderBox.get_preferred_height(targetW) : [0, 44];
        const headerH = Math.max(36, Math.round(hdrNat || 44));

        const hasCards = Boolean(this._notifCardsBox && this._notifCardsBox.get_n_children() > 0);

        let actualTotalH = 90;

        if (!hasCards) {
            const [emptyMin, emptyNat] = this._notifEmptyLabel ? this._notifEmptyLabel.get_preferred_height(targetW) : [0, 90];
            const emptyH = Math.max(70, Math.round(emptyNat || 90));
            actualTotalH = headerH + emptyH + 16;

            if (this._notifScrollWrapper) {
                this._notifScrollWrapper.height = 0;
                this._notifScrollWrapper.hide();
            }
            if (this._notifScrollView) {
                this._notifScrollView.height = 0;
            }
        } else {
            if (this._notifScrollWrapper) {
                this._notifScrollWrapper.show();
            }
            const maxScrollH = Math.max(120, maxCenterH - headerH - 16);
            const [cardsMinH, cardsNatH] = this._notifCardsBox ? this._notifCardsBox.get_preferred_height(targetW) : [0, 0];
            const cardsH = Math.round(cardsNatH);
            const actualScrollH = Math.min(maxScrollH, Math.max(50, cardsH));

            if (this._notifScrollView) {
                if (cardsH > maxScrollH) {
                    this._notifScrollView.vscrollbar_policy = St.PolicyType.AUTOMATIC;
                } else {
                    this._notifScrollView.vscrollbar_policy = St.PolicyType.NEVER;
                }
                this._notifScrollView.height = actualScrollH;
            }
            if (this._notifScrollWrapper) {
                this._notifScrollWrapper.height = actualScrollH;
            }
            actualTotalH = headerH + actualScrollH + 16;
        }

        actualTotalH = Math.min(maxCenterH, Math.max(90, Math.round(actualTotalH)));

        if (this._lastCenterW === targetW && this._lastCenterH === actualTotalH && this._notifCenterActor.height === actualTotalH) {
            if (this._notifCenterOpen) {
                this._syncNotifGlassRegions();
            }
            return;
        }
        this._lastCenterW = targetW;
        this._lastCenterH = actualTotalH;

        this._notifCenterActor.width = targetW;
        this._notifCenterActor.height = actualTotalH;
        this._notifContentBox.width = targetW;
        this._notifContentBox.height = actualTotalH;

        if (this._notifCenterBg) {
            this._notifCenterBg.width = targetW;
            this._notifCenterBg.height = actualTotalH;
            if (!this._blurCenterSlice) {
                this._rebuildGradientBlur(targetW, actualTotalH);
            } else {
                if (this._blurRebuildTimeout) {
                    GLib.source_remove(this._blurRebuildTimeout);
                    this._blurRebuildTimeout = 0;
                }
                this._blurRebuildTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    this._blurRebuildTimeout = 0;
                    if (this._notifCenterOpen && this._notifCenterBg) {
                        this._rebuildGradientBlur(this._notifCenterBg.width, this._notifCenterBg.height);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        if (this._notifCenterOpen) {
            this._syncNotifBackdropBlur();
            this._syncNotifGlassRegions();
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
        if (this._notifCardsBox) {
            for (const child of this._notifCardsBox.get_children()) {
                if (child._macGroup) {
                    child._macGroup.destroy();
                } else {
                    child.remove_all_transitions();
                    try { child.destroy(); } catch (_) {}
                }
            }
            this._notifCardsBox.remove_all_children();
        }
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

        this._isNotifCenterClosing = false;
        this._notifCenterOpen = true;

        if (!this._notifStageLoopId) {
            this._notifStageLoopId = global.stage.connect('before-update', () => {
                if (this._notifCenterOpen || this._isNotifCenterClosing) {
                    this._syncNotifGlassRegions();
                }
            });
        }

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
        this._getNotifBlurActor();
        this._syncNotifBackdropBlur();
        if (this._notifBackdropBlur) {
            this._notifBackdropBlur.animateSlideIn(480, 320);
        }
        container.translation_x = 480;
        container.opacity = 0;
        container.visible = true;
        container.show();
        this._initNotifGlass().then(() => {
            if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
                this._notifGlass._backdropLocked = false;
                if (typeof this._notifGlass.forceRefresh === 'function') {
                    this._notifGlass.forceRefresh(1);
                }
                this._notifGlass._backdropLocked = true;
            }
            if (this._notifCenterOpen) this._syncNotifGlassRegions();
        });

        container.remove_all_transitions();
        container.ease({
            translation_x: 0,
            opacity: 255,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._syncNotifGlassRegions();
                if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
                    this._notifGlass._backdropLocked = true;
                }
            },
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
        this._isNotifCenterClosing = true;
        if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
            this._notifGlass._backdropLocked = false;
        }
        this._lastCenterW = null;
        this._lastCenterH = null;
        this._lastBlurW = null;
        this._lastBlurH = null;
        if (this._blurRebuildTimeout) {
            GLib.source_remove(this._blurRebuildTimeout);
            this._blurRebuildTimeout = 0;
        }
        this._disconnectNotifCenterListeners();
        if (this._notifBackdropBlur) {
            this._notifBackdropBlur.animateSlideOut(480, 260);
        }

        const container = this._notifCenterActor;
        container.remove_all_transitions();
        container.ease({
            translation_x: 480,
            opacity: 0,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                this._isNotifCenterClosing = false;
                if (this._notifStageLoopId) {
                    try { global.stage.disconnect(this._notifStageLoopId); } catch (_) {}
                    this._notifStageLoopId = 0;
                }
                if (!this._notifCenterOpen) {
                    container.hide();
                    container.translation_x = 0;
                    if (this._notifGlass && !this._notifGlass.is_finalized?.()) {
                        this._notifGlass.hide();
                    }
                    if (this._notifBackdropBlur) {
                        this._notifBackdropBlur.hide();
                    }
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

                // If user clicked on the clock button in panel, close Notification Center cleanly
                const dateMenu = Main.panel?.statusArea?.dateMenu;
                if (dateMenu) {
                    const [dx, dy] = dateMenu.get_transformed_position();
                    const [dw, dh] = dateMenu.get_transformed_size();
                    if (clickX >= dx && clickX <= dx + dw && clickY >= dy && clickY <= dy + dh) {
                        this._closeNotificationCenter();
                        return Clutter.EVENT_STOP;
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

                return Clutter.EVENT_STOP;
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

        // Disconnect custom keyboard menu
        try {
            Main.panel.statusArea?.keyboard?.menu?.disconnectObject(this);
        } catch (_e) {}

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
        if (this._notifStageLoopId) {
            try { global.stage.disconnect(this._notifStageLoopId); } catch (_) {}
            this._notifStageLoopId = 0;
        }
        if (this._notifGlass) {
            try { this._notifGlass.destroy(); } catch (_) {}
            this._notifGlass = null;
        }
        if (this._notifCenterActor) {
            try { this._notifCenterActor.destroy(); } catch (_) {}
            this._notifCenterActor = null;
        }
        if (this._ccBackdropBlur) {
            try { this._ccBackdropBlur.destroy(); } catch (_) {}
            this._ccBackdropBlur = null;
        }
        if (this._notifBackdropBlur) {
            try { this._notifBackdropBlur.destroy(); } catch (_) {}
            this._notifBackdropBlur = null;
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

        if (this._macInputSwitcher) {
            try { this._macInputSwitcher.disable(); } catch (_e) {}
            this._macInputSwitcher = null;
        }

        if (typeof this.connections?.disconnect_all === 'function') {
            this.connections.disconnect_all();
        } else if (Array.isArray(this.connections)) {
            for (const c of this.connections) {
                if (typeof c?.disconnect_all === 'function') c.disconnect_all();
            }
        }
        this._cleanupMenuHoverGlide();
    }

    _setupMenuHoverGlide() {
        this._cleanupMenuHoverGlide();
    }

    _cleanupMenuHoverGlide() {
        if (this._origPopupMenuInit) {
            try {
                PopupMenu.PopupMenu.prototype._init = this._origPopupMenuInit;
            } catch (_) {}
            this._origPopupMenuInit = null;
        }
        if (this._trackedMenus) {
            for (const t of this._trackedMenus) {
                try { t.destroy(); } catch (_) {}
            }
            this._trackedMenus.clear();
        }
    }
};
