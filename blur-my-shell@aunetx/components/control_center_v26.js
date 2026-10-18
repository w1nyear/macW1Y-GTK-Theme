import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';
import Pango from 'gi://Pango';
import UPowerGlib from 'gi://UPowerGlib';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { MprisPlayer } from 'resource:///org/gnome/shell/ui/mpris.js';
import { t, tf } from './mac_i18n.js';
import {
    populateUniversalWifiContent,
    populateUniversalBluetoothContent,
    getSystemAccentColor,
} from './mac_menus_shared_v3.js';

function resolveThemeIcon(filename) {
    const home = GLib.get_home_dir();
    const candidates = [
        `${home}/.themes/macW1Y-Dark/icons/${filename}`,
        `${home}/.themes/macW1Y-Dark-solid/icons/${filename}`,
        `${home}/.themes/MacTahoe-Dark/icons/${filename}`,
        `${home}/.local/share/icons/hicolor/scalable/apps/${filename}`,
        `/usr/share/themes/macW1Y-Dark/icons/${filename}`,
        `${home}/macW1Y/icons/${filename}`,
        `${home}/MACTHEMEFILES/icons/${filename}`,
        `${home}/macW1Y/macW1Y-Dark/icons/${filename}`,
        `${home}/MACTHEMEFILES/macW1Y-Dark/icons/${filename}`,
    ];
    for (const p of candidates) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
    }
    return filename;
}

const AIRDROP_ICON_PATH = resolveThemeIcon('airdrop-v2-symbolic.svg');
const STAGE_MANAGER_ICON_PATH = resolveThemeIcon('stage-manager-symbolic.svg');
const MIRRORING_ICON_PATH = resolveThemeIcon('screen-mirroring-symbolic.svg');
const DARK_MODE_ICON_PATH = resolveThemeIcon('dark-mode-symbolic.svg');
const SCREENSHOT_ICON_PATH = resolveThemeIcon('screenshot-viewfinder-symbolic.svg');
const AIRPLAY_ICON_PATH = resolveThemeIcon('audio-airplay-symbolic.svg');
const MOON_ICON_PATH = resolveThemeIcon('moon-symbolic.svg');

function createIcon(pathOrName, size = 18) {
    if (pathOrName.startsWith('/')) {
        let actualPath = pathOrName;
        if (!GLib.file_test(actualPath, GLib.FileTest.EXISTS)) {
            const basename = GLib.path_get_basename(pathOrName);
            const resolved = resolveThemeIcon(basename);
            if (GLib.file_test(resolved, GLib.FileTest.EXISTS)) {
                actualPath = resolved;
            } else {
                const iconName = basename.replace(/\.(svg|png)$/, '');
                return new St.Icon({
                    icon_name: iconName,
                    icon_size: size,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            }
        }
        const file = Gio.File.new_for_path(actualPath);
        return new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            icon_size: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }
    return new St.Icon({
        icon_name: pathOrName,
        icon_size: size,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
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


// Global floating tooltip for app icon in Sound Drawer (dock-style badge)
let _macActiveFloatingTooltip = null;

export function _macShowFloatingTooltip(sourceActor, text) {
    _macHideFloatingTooltip();
    if (!text || !sourceActor || typeof sourceActor.get_transformed_position !== 'function') return;

    try {
        const [actX, actY] = sourceActor.get_transformed_position();
        const actW = sourceActor.width || 24;
        const actH = sourceActor.height || 24;

        const tooltip = new St.Label({
            text,
            style: 'background-color: rgba(20, 20, 20, 0.92) !important; border: 1px solid rgba(255, 255, 255, 0.22) !important; border-radius: 8px !important; color: #ffffff !important; font-family: "SF Pro Text", -apple-system, sans-serif !important; font-size: 11.5px !important; font-weight: 600 !important; padding: 4px 10px !important; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45) !important;',
            opacity: 0,
        });

        Main.uiGroup.add_child(tooltip);
        _macActiveFloatingTooltip = tooltip;

        const [, prefW] = tooltip.get_preferred_width(-1);
        const [, prefH] = tooltip.get_preferred_height(prefW);

        const targetX = Math.round(actX + (actW / 2) - (prefW / 2));
        const targetY = Math.round(actY - prefH - 8);
        tooltip.set_position(targetX, targetY);

        tooltip.ease({
            opacity: 255,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    } catch (_) {}
}

export function _macHideFloatingTooltip() {
    if (_macActiveFloatingTooltip) {
        const t = _macActiveFloatingTooltip;
        _macActiveFloatingTooltip = null;
        try {
            t.remove_all_transitions();
            t.destroy();
        } catch (_) {}
    }
}

globalThis._macShowFloatingTooltip = _macShowFloatingTooltip;
globalThis._macHideFloatingTooltip = _macHideFloatingTooltip;

export class MacControlCenter {
    constructor(quickSettingsMenu) {
        this.menu = quickSettingsMenu;
        this._nmClient = null;
        this._wifiDevice = null;
        this._btClient = null;
        this._mixerControl = null;
        this._mixerSink = null;
        this._brightnessProxy = null;
        this._mprisPlayer = null;
        this._pollTimerId = 0;
        this._currentSubmenu = null;

        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._notificationSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });

        try {
            this._nmClient = NM.Client.new(null);
            this._findWifiDevice();
        } catch (e) {
            console.error(`[MacCC] NM error: ${e}`);
        }

        try {
            this._btClient = new GnomeBluetooth.Client();
            this._btClient.connectObject(
                'notify::default-adapter-powered', () => this._syncBluetooth(),
                'notify::default-adapter-state', () => this._syncBluetooth(),
                this
            );
        } catch (e) {
            console.error(`[MacCC] GnomeBluetooth error: ${e}`);
        }

        try {
            this._mixerControl = getMixerControl();
            if (this._mixerControl) {
                this._mixerControl.connectObject(
                    'default-sink-changed', () => this._syncSound(),
                    'state-changed', () => this._syncSound(),
                    this
                );
            }
        } catch (e) {
            console.error(`[MacCC] Mixer error: ${e}`);
        }

        this._buildUI();
        this._initBrightness();
        this._initMpris();

        // Connect to native sliders for 100% bidirectional sync with hardware and keys
        try {
            const bSlider = Main.panel.statusArea.quickSettings?._brightness?.quickSettingsItems?.[0]?.slider;
            if (bSlider) {
                this._bSigId = bSlider.connect('notify::value', () => this._syncBrightness());
            }
            const vSlider = Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0]?.slider;
            if (vSlider) {
                this._vSigId = vSlider.connect('notify::value', () => this._syncSound());
            }
        } catch (_) {}

        if (this.menu) {
            this.menu.connectObject('open-state-changed', (_m, open) => {
                if (!open) {
                    this.closeSubmenu();
                    this.closeSoundDrawer(false);
                    _macHideFloatingTooltip();
                    this._lastTrackKey = '';
                    if (this.mediaArt) {
                        this.mediaArt.remove_all_transitions();
                        this.mediaArt.opacity = 255;
                        this.mediaArt.scale_x = 1.0;
                        this.mediaArt.scale_y = 1.0;
                    }
                } else {
                    if (this.mediaArt) {
                        this.mediaArt.remove_all_transitions();
                        this.mediaArt.opacity = 255;
                        this.mediaArt.scale_x = 1.0;
                        this.mediaArt.scale_y = 1.0;
                    }
                    this.syncAll();
                    this._scanMprisPlayers();
                }
            }, this);
        }
    }

    showFloatingTooltip(sourceActor, text) {
        _macShowFloatingTooltip(sourceActor, text);
    }

    hideFloatingTooltip() {
        _macHideFloatingTooltip();
    }

    _findWifiDevice() {
        if (!this._nmClient) return;
        const devices = this._nmClient.get_devices() || [];
        this._wifiDevice = devices.find(d => d.get_device_type() === NM.DeviceType.WIFI) || null;
    }

    _initBrightness() {
        if (!Main.osdWindowManager._origShowOsdWindowMac) {
            Main.osdWindowManager._origShowOsdWindowMac = Main.osdWindowManager._showOsdWindow;
            Main.osdWindowManager._showOsdWindow = function(monitorIndex, icon, label, level, maxLevel) {
                const iconName = (icon?.to_string ? icon.to_string() : (icon?.name || '')).toLowerCase();
                const lbl = (label || '').toLowerCase();
                if ((iconName.includes('brightness') || lbl.includes('brightness')) &&
                    (Main.panel.statusArea.quickSettings?.menu?.isOpen || globalThis._macDraggingBrightness)) {
                    return; // Suppress brightness OSD when changing in Control Center with mouse
                }
                return Main.osdWindowManager._origShowOsdWindowMac.call(this, monitorIndex, icon, label, level, maxLevel);
            };
        }
        try {
            Gio.DBusProxy.new(
                Gio.DBus.session,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power',
                'org.gnome.SettingsDaemon.Power.Screen',
                null,
                (proxy, error) => {
                    if (!error) {
                        this._brightnessProxy = proxy;
                        this._syncBrightness();
                    }
                }
            );
        } catch (e) {
            console.error(`[MacCC] Brightness proxy error: ${e}`);
        }
    }

    _initMpris() {
        this._mprisPlayers = new Map();
        this._activeMprisPlayer = null;

        try {
            this._mprisSubId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, params) => {
                    const [name, oldOwner, newOwner] = params.recursiveUnpack();
                    if (name && name.startsWith('org.mpris.MediaPlayer2.')) {
                        if (newOwner && !oldOwner) {
                            this._addMprisPlayer(name);
                        } else if (!newOwner && oldOwner) {
                            const p = this._mprisPlayers.get(name);
                            if (p) {
                                try { p._close(); } catch (_) {}
                                this._mprisPlayers.delete(name);
                            }
                            this._evaluateBestPlayer();
                        }
                    }
                }
            );
        } catch (_) {}

        this._scanMprisPlayers();
    }

    _scanMprisPlayers() {
        try {
            Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [names] = reply.recursiveUnpack();
                        const mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
                        for (const name of mprisNames) {
                            this._addMprisPlayer(name);
                        }
                        this._evaluateBestPlayer();
                    } catch (_) {
                        this._syncMedia(null);
                    }
                }
            );
        } catch (_) {
            this._syncMedia(null);
        }
    }

    _addMprisPlayer(busName) {
        if (this._mprisPlayers.has(busName)) {
            this._evaluateBestPlayer();
            return;
        }

        try {
            const player = new MprisPlayer(busName);
            player.connect('changed', () => this._evaluateBestPlayer());
            this._mprisPlayers.set(busName, player);
            this._evaluateBestPlayer();
        } catch (_) {}
    }

    _evaluateBestPlayer() {
        if (this._mprisPlayers.size === 0) {
            this._activeMprisPlayer = null;
            this._syncMedia(null);
            return;
        }

        let bestPlayer = null;

        // 1. Actively playing
        for (const [name, player] of this._mprisPlayers.entries()) {
            if (player.status === 'Playing') {
                bestPlayer = player;
                break;
            }
        }

        // 2. Spotify if available
        if (!bestPlayer) {
            for (const [name, player] of this._mprisPlayers.entries()) {
                if (name.includes('spotify') && player.trackTitle) {
                    bestPlayer = player;
                    break;
                }
            }
        }

        // 3. Any player with trackTitle
        if (!bestPlayer) {
            for (const [name, player] of this._mprisPlayers.entries()) {
                if (player.trackTitle) {
                    bestPlayer = player;
                    break;
                }
            }
        }

        // 4. Fallback to first
        if (!bestPlayer) {
            bestPlayer = this._mprisPlayers.values().next().value || null;
        }

        this._activeMprisPlayer = bestPlayer;
        this._syncMedia(bestPlayer);
    }

    _buildUI() {
        this.container = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-control-center-root',
            x_expand: true,
            y_expand: false,
            style: 'width: 338px; min-width: 338px; max-width: 338px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px; spacing: 12px;',
        });

        // 1. Stack: Main View, Dimming Overlay, and Submenu View
        this.viewStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
        });
        this.container.add_child(this.viewStack);

        this.mainView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'width: 338px; min-width: 338px; max-width: 338px; spacing: 12px;',
        });
        this.viewStack.add_child(this.mainView);

        // Invisible click-catcher overlay to dismiss submenus (no dark backdrop sheet)
        this.dimOverlay = new St.Widget({
            x_expand: true,
            y_expand: true,
            style: 'background-color: transparent !important; background: transparent !important;',
            reactive: true,
            visible: false,
        });
        this.dimOverlay.connect('button-press-event', () => {
            this.closeSubmenu();
            return Clutter.EVENT_STOP;
        });
        this.viewStack.add_child(this.dimOverlay);

        this.submenuView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            visible: false,
        });
        this.submenuView.connect('button-press-event', (_actor, event) => {
            if (event.get_source() === this.submenuView || event.get_source() === this.dimOverlay) {
                this.closeSubmenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.submenuView.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.closeSubmenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.viewStack.add_child(this.submenuView);

        // =====================================================================
        // ROW 1 & 2: Left (Wi-Fi & Bluetooth Pills: 198px) + Right (Now Playing Card: 198px x 152px)
        // =====================================================================
        const topRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'width: 338px; min-width: 338px; max-width: 338px; spacing: 12px;',
        });
        this.mainView.add_child(topRow);

        // LEFT COLUMN (Wi-Fi and Bluetooth Pills - 167px wide, 70px high each, 12px gap => 152px high)
        const leftCol12 = new St.BoxLayout({
            vertical: true,
            style: 'width: 167px; min-width: 167px; max-width: 167px; spacing: 12px;',
        });
        topRow.add_child(leftCol12);

        // 1. Wi-Fi Pill (70px high, 167px wide)
        this.wifiPill = this._createConnPill(
            'network-wireless-signal-excellent-symbolic',
            t('wifi', 'Wi-Fi'),
            t('off', 'Вимкнено'),
            () => this._toggleWifi(),
            () => this.openSubmenu('wifi', this.wifiPill?.actor)
        );
        this.wifiPill.actor.add_style_class_name('quick-toggle');
        leftCol12.add_child(this.wifiPill.actor);

        // 2. Bluetooth Pill (70px high, 167px wide)
        this.btPill = this._createConnPill(
            'bluetooth-active-symbolic',
            t('bluetooth', 'Bluetooth'),
            t('off', 'Вимкнено'),
            () => this._toggleBluetooth(),
            () => this.openSubmenu('bluetooth', this.btPill?.actor)
        );
        this.btPill.actor.add_style_class_name('quick-toggle');
        leftCol12.add_child(this.btPill.actor);

        // RIGHT COLUMN (Now Playing Media Card - Exact 159px wide x 152px high!)
        const rightCol12 = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'width: 159px; min-width: 159px; max-width: 159px; height: 152px; min-height: 152px; max-height: 152px;',
        });
        topRow.add_child(rightCol12);

        this.mediaCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-media-card quick-toggle',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'width: 159px; min-width: 159px; max-width: 159px; height: 152px; min-height: 152px; max-height: 152px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important; border-radius: 35px !important;',
        });
        rightCol12.add_child(this.mediaCard);

        // Top: Music Art Icon - corner aligned to top-left (18px from top & left)
        this.mediaArt = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 24,
            style_class: 'mac-cc-media-art',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            style: 'width: 42px !important; height: 42px !important; min-width: 42px !important; min-height: 42px !important; border-radius: 10px !important; background-color: rgba(255, 255, 255, 0.16) !important; border: 1px solid rgba(255, 255, 255, 0.18) !important; margin-top: 18px; margin-left: 18px;',
        });
        this.mediaCard.add_child(this.mediaArt);

        // Middle: Text container - left aligned, 8px gap from icon, 18px left margin
        const mediaTextCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            style: 'margin-top: 8px; margin-left: 18px; margin-right: 14px; width: 127px; min-width: 127px; max-width: 127px; padding: 0 !important;',
        });
        this.mediaTitleBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style: 'width: 127px; min-width: 127px; max-width: 127px; padding: 0 !important; margin: 0 !important;',
        });
        this.mediaTitleBox.clip_to_allocation = true;
        this.mediaTitle = new St.Label({
            text: t('not_playing', 'Не відтворюється'),
            style_class: 'mac-cc-title',
            style: 'width: 127px; min-width: 127px; font-size: 12.5px !important; font-weight: 700 !important; text-align: left !important;',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        try {
            this.mediaTitle.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this.mediaTitle.clutter_text.line_wrap = false;
        } catch (_) {}
        this.mediaTitleBox.add_child(this.mediaTitle);
        mediaTextCol.add_child(this.mediaTitleBox);

        this.mediaArtist = new St.Label({
            text: '',
            style_class: 'mac-cc-subtitle',
            style: 'width: 127px; min-width: 127px; font-size: 11px !important; color: rgba(255, 255, 255, 0.6) !important; text-align: left !important; margin-top: 2px;',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
            visible: false,
        });
        mediaTextCol.add_child(this.mediaArtist);
        this.mediaCard.add_child(mediaTextCol);

        // Spacer to push transport controls cleanly to the bottom
        const mediaSpacer = new St.Widget({
            y_expand: true,
        });
        this.mediaCard.add_child(mediaSpacer);

        // Bottom: Transport Controls - centered horizontally, spacing 5px (closer), margin-bottom 16px (lower)
        const transportRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            style: 'spacing: 5px; margin-bottom: 16px; padding: 0 !important; margin-left: 0 !important; margin-right: 0 !important;',
        });
        this.mediaCard.add_child(transportRow);

        const prevBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-backward-symbolic', 22),
            reactive: true,
            can_focus: true,
            style: 'width: 36px !important; height: 36px !important; min-width: 36px !important; min-height: 36px !important; padding: 0 !important;',
        });
        prevBtn.connect('clicked', () => this._mprisCmd('Previous'));
        transportRow.add_child(prevBtn);

        this.playBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-playback-start-symbolic', 25),
            reactive: true,
            can_focus: true,
            style: 'width: 38px !important; height: 38px !important; min-width: 38px !important; min-height: 38px !important; padding: 0 !important;',
        });
        this.playBtn.connect('clicked', () => this._mprisCmd('PlayPause'));
        transportRow.add_child(this.playBtn);

        const nextBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-forward-symbolic', 22),
            reactive: true,
            can_focus: true,
            style: 'width: 36px !important; height: 36px !important; min-width: 36px !important; min-height: 36px !important; padding: 0 !important;',
        });
        nextBtn.connect('clicked', () => this._mprisCmd('Next'));
        transportRow.add_child(nextBtn);

        // =====================================================================
        // ROW 3: Left (Do Not Disturb Pill: 198px) + Right (Dark Mode & Power: 198px)
        // =====================================================================
        const row3 = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'width: 338px; min-width: 338px; max-width: 338px; spacing: 12px;',
        });
        this.mainView.add_child(row3);

        // Do Not Disturb Pill (Left column: 167px wide, 70px high)
        const row3Left = new St.BoxLayout({
            vertical: true,
            style: 'width: 167px; min-width: 167px; max-width: 167px; height: 70px; min-height: 70px; max-height: 70px;',
        });
        row3.add_child(row3Left);

        this.dndPill = this._createDndPill();
        this.dndPill.actor.add_style_class_name('quick-toggle');
        row3Left.add_child(this.dndPill.actor);

        // Dark Mode and Power: two 70px circular round buttons in 159px container with 19px gap!
        const row3Right = new St.BoxLayout({
            vertical: false,
            style: 'width: 159px; min-width: 159px; max-width: 159px; height: 70px; min-height: 70px; max-height: 70px; spacing: 19px; padding: 0 !important;',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.FILL,
        });
        row3.add_child(row3Right);

        this.darkModeIcon = createIcon(DARK_MODE_ICON_PATH, 20);
        this.darkModeBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large quick-toggle',
            child: this.darkModeIcon,
            reactive: true,
            can_focus: true,
            style: 'width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 9999px !important; padding: 0 !important;',
        });
        this.darkModeBtn.connect('clicked', () => this._toggleDarkMode());
        this.darkModeBtn.connect('button-press-event', () => {
            this._toggleDarkMode();
            return Clutter.EVENT_STOP;
        });
        row3Right.add_child(this.darkModeBtn);

        this.powerIcon = createIcon('system-shutdown-symbolic', 20);
        this.powerBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large quick-toggle',
            child: this.powerIcon,
            reactive: true,
            can_focus: true,
            style: 'width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 9999px !important; padding: 0 !important;',
        });
        this._setStandaloneBtnActive(this.powerBtn, this.powerIcon, false);
        this.powerBtn.connect('clicked', () => this.openSubmenu('power', this.powerBtn));
        this.powerBtn.connect('button-press-event', () => {
            this.openSubmenu('power', this.powerBtn);
            return Clutter.EVENT_STOP;
        });
        row3Right.add_child(this.powerBtn);

        // =====================================================================
        // ROW 4: Display Brightness Slider Card (Full Width: 346px, 70px high, radius 35px)
        // =====================================================================
        const displayCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card quick-toggle',
            x_expand: true,
            style: 'spacing: 4px; width: 310px; min-width: 310px; max-width: 310px; height: 50px; min-height: 50px; max-height: 50px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px 14px !important; border-radius: 25px !important;',
        });
        this.mainView.add_child(displayCard);

        const dispLabel = new St.Label({
            text: t('display', 'Дисплей'),
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px; font-weight: 600; letter-spacing: 0.15px; padding-left: 8px; margin-top: 1px; margin-bottom: 2px;',
        });
        this.dispLabel = dispLabel;
        displayCard.add_child(dispLabel);

        const dispSliderRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            style: 'spacing: 8px; padding-left: 2px; padding-right: 2px; margin-bottom: 3px;',
        });
        displayCard.add_child(dispSliderRow);

        dispSliderRow.add_child(createIcon('display-brightness-symbolic', 14));
        this.brightnessSlider = new Slider(0.5);
        const bActor = this.brightnessSlider.actor || this.brightnessSlider;
        bActor.add_style_class_name('mac-cc-slider-track');
        bActor.style = 'height: 10px !important; min-height: 10px !important; -barlevel-height: 9px !important; -barlevel-background-color: rgba(255, 255, 255, 0.22) !important; -barlevel-active-background-color: #ffffff !important; -slider-handle-radius: 0px !important; border-radius: 9999px !important;';
        bActor.x_expand = true;
        this.brightnessSlider.connect('notify::value', () => this._setBrightness(this.brightnessSlider.value));
        dispSliderRow.add_child(bActor);
        dispSliderRow.add_child(createIcon('display-brightness-symbolic', 16));

        // =====================================================================
        // ROW 5: Sound Volume Slider Card + AirPlay Button (Full Width: 346px, 70px high, radius 35px)
        // =====================================================================
        const soundCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card quick-toggle',
            x_expand: true,
            style: 'spacing: 4px; width: 310px; min-width: 310px; max-width: 310px; height: 50px; min-height: 50px; max-height: 50px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px 14px !important; border-radius: 25px !important;',
        });
        this.mainView.add_child(soundCard);

        const soundLabel = new St.Label({
            text: t('sound', 'Звук'),
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px; font-weight: 600; letter-spacing: 0.15px; padding-left: 8px; margin-top: 1px; margin-bottom: 2px;',
        });
        this.soundLabel = soundLabel;
        soundCard.add_child(soundLabel);

        const soundSliderRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            style: 'spacing: 8px; padding-left: 2px; padding-right: 2px; margin-bottom: 3px;',
        });
        soundCard.add_child(soundSliderRow);

        soundSliderRow.add_child(createIcon('audio-volume-low-symbolic', 14));
        this.volumeSlider = new Slider(0.5);
        const vActor = this.volumeSlider.actor || this.volumeSlider;
        vActor.add_style_class_name('mac-cc-slider-track');
        vActor.style = 'height: 10px !important; min-height: 10px !important; -barlevel-height: 9px !important; -barlevel-background-color: rgba(255, 255, 255, 0.22) !important; -barlevel-active-background-color: #ffffff !important; -slider-handle-radius: 0px !important; border-radius: 9999px !important;';
        vActor.x_expand = true;
        this.volumeSlider.connect('notify::value', () => this._setVolume(this.volumeSlider.value));
        this.volumeSlider.connect('drag-end', () => {
            try {
                global.display.get_sound_player().play_from_theme('audio-volume-change', 'Volume', null);
            } catch (_e) {}
        });
        soundSliderRow.add_child(vActor);
        soundSliderRow.add_child(createIcon('audio-volume-high-symbolic', 16));

        this.airplayBtn = new St.Button({
            style_class: 'mac-cc-airplay-btn',
            style: 'background-color: rgba(255, 255, 255, 0.18) !important; border: 1px solid rgba(255, 255, 255, 0.24) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;',
            child: createIcon(AIRPLAY_ICON_PATH, 13),
            reactive: true,
            can_focus: true,
        });
        this.airplayBtn.connect('clicked', () => this.toggleSoundDrawer());
        this.airplayBtn.connect('button-press-event', () => {
            this.toggleSoundDrawer();
            return Clutter.EVENT_STOP;
        });
        soundSliderRow.add_child(this.airplayBtn);

        // Right click on Sound card also toggles Sound drawer
        soundCard.reactive = true;
        soundCard.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                this.toggleSoundDrawer();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Expandable Sound Drawer (unfolds downwards below Sound card)
        this.soundDrawer = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-sound-drawer',
            x_expand: true,
            visible: false,
            reactive: true,
            style: 'width: 312px; min-width: 312px; max-width: 312px; background-color: rgba(30, 30, 30, 0.94) !important; border: 1px solid rgba(255, 255, 255, 0.22) !important; border-radius: 25px !important; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 2px 6px rgba(0, 0, 0, 0.4) !important; padding: 12px !important; margin-top: 4px !important;',
        });
        this.soundDrawer.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                this.closeSoundDrawer();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.mainView.add_child(this.soundDrawer);

        // Dismiss sound drawer when clicking outside soundCard or soundDrawer
        this.mainView.connect('button-press-event', (_actor, event) => {
            if (this._soundDrawerOpen || this.soundDrawer?.visible) {
                const src = event.get_source();
                if (!this._isDescendant(src, soundCard) && !this._isDescendant(src, this.soundDrawer)) {
                    this.closeSoundDrawer(true);
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Periodic Sync Timer
        this._pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.syncAll();
            return GLib.SOURCE_CONTINUE;
        });

        this.syncAll();
    }

    _setCircleBtnActive(circleBtn, icon, isActive, accentColor = '#007aff') {
        if (!circleBtn || this._isDestroyed) return;
        try {
            circleBtn._lastIsActive = isActive;
            const bgActor = circleBtn._bgActor;

            if (isActive) {
                circleBtn.add_style_class_name('active');
                if (bgActor) {
                    bgActor.remove_all_transitions();
                    bgActor.visible = true;
                    bgActor.show();
                    bgActor.opacity = 255;
                    bgActor.scale_x = 1.0;
                    bgActor.scale_y = 1.0;
                    bgActor.style = 'width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; background-color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.95) !important; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 1px #ffffff !important;';
                }
                circleBtn.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = `color: ${accentColor} !important;`;
                }
            } else {
                circleBtn.remove_style_class_name('active');
                if (bgActor) {
                    bgActor.remove_all_transitions();
                    bgActor.visible = false;
                    bgActor.hide();
                    bgActor.opacity = 0;
                    bgActor.scale_x = 0.75;
                    bgActor.scale_y = 0.75;
                    bgActor.style = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important;';
                }
                circleBtn.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = 'color: rgba(255, 255, 255, 0.95) !important;';
                }
            }
        } catch (_) {}
    }

    _setDndBtnActive(circleBtn, icon, isActive, accentColor = '#5856d6') {
        if (!circleBtn || this._isDestroyed) return;
        try {
            circleBtn._lastIsActive = isActive;
            const bgActor = circleBtn._bgActor;

            if (isActive) {
                circleBtn.add_style_class_name('active');
                if (bgActor) {
                    bgActor.remove_all_transitions();
                    bgActor.visible = true;
                    bgActor.show();
                    bgActor.opacity = 255;
                    bgActor.scale_x = 1.0;
                    bgActor.scale_y = 1.0;
                    bgActor.style = 'width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; background-color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.95) !important; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 1px #ffffff !important;';
                }
                circleBtn.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = `color: ${accentColor} !important;`;
                }
            } else {
                circleBtn.remove_style_class_name('active');
                if (bgActor) {
                    bgActor.remove_all_transitions();
                    bgActor.visible = false;
                    bgActor.hide();
                    bgActor.opacity = 0;
                    bgActor.scale_x = 0.75;
                    bgActor.scale_y = 0.75;
                    bgActor.style = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important;';
                }
                circleBtn.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = 'color: rgba(255, 255, 255, 0.95) !important;';
                }
            }
        } catch (_) {}
    }

    _isDescendant(actor, ancestor) {
        let cur = actor;
        while (cur) {
            if (cur === ancestor) return true;
            cur = cur.get_parent ? cur.get_parent() : null;
        }
        return false;
    }

    _setStandaloneBtnActive(btn, icon, isActive, accentColor = getSystemAccentColor()) {
        if (!btn || this._isDestroyed) return;
        try {
            if (isActive) {
                btn.add_style_class_name('active');
                btn.style = `background-color: ${accentColor} !important; border: 1px solid rgba(255, 255, 255, 0.45) !important; box-shadow: 0 0 12px rgba(0, 122, 255, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.5) !important; width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;`;
                if (icon) icon.style = 'color: #ffffff !important;';
            } else {
                btn.remove_style_class_name('active');
                btn.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;';
                if (icon) icon.style = 'color: #ffffff !important;';
            }
        } catch (_) {}
    }

    // Creates an Apple-style Stadium Pill button (Wi-Fi, Bluetooth)
    _createConnPill(iconPathOrName, title, subtitle, onCircleClick, onPillClick) {
        const pill = new St.Button({
            style_class: 'mac-cc-pill quick-toggle',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            style: 'width: 167px !important; min-width: 167px !important; max-width: 167px !important; height: 70px !important; min-height: 70px !important; max-height: 70px !important; border-radius: 9999px !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important;',
        });

        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'padding: 0 6px 0 14px !important; margin: 0 !important; spacing: 8px !important;',
        });
        pill.set_child(box);

        const icon = createIcon(iconPathOrName, 18);
        icon.x_align = Clutter.ActorAlign.CENTER;
        icon.y_align = Clutter.ActorAlign.CENTER;

        const bgActor = new St.Widget({
            style_class: 'mac-cc-circle-bg',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important;',
            visible: false,
        });
        bgActor.set_pivot_point(0.5, 0.5);
        bgActor.opacity = 0;
        bgActor.scale_x = 0.75;
        bgActor.scale_y = 0.75;

        const iconContainer = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            width: 34,
            height: 34,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        iconContainer.add_child(bgActor);
        iconContainer.add_child(icon);

        const circleBtn = new St.Button({
            style_class: 'mac-cc-pill-icon-btn',
            child: iconContainer,
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;',
        });
        circleBtn._bgActor = bgActor;
        this._setCircleBtnActive(circleBtn, icon, false);
        box.add_child(circleBtn);

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 1px;',
        });
        const titleLbl = new St.Label({
            text: title,
            style_class: 'mac-cc-title',
            style: 'font-size: 13px !important; font-weight: 600 !important; letter-spacing: 0.15px !important;',
        });
        try {
            titleLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}

        const subLbl = new St.Label({
            text: subtitle,
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 11.5px !important; font-weight: 400 !important; letter-spacing: 0.1px !important;',
        });
        try {
            subLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}

        textCol.add_child(titleLbl);
        textCol.add_child(subLbl);
        box.add_child(textCol);

        // Left-click on circle icon button toggles on/off!
        circleBtn.connect('clicked', () => {
            onCircleClick();
        });
        circleBtn.connect('button-press-event', () => {
            onCircleClick();
            return Clutter.EVENT_STOP;
        });

        // Left-click or right-click anywhere else on the pill opens submenu!
        pill.connect('clicked', () => {
            onPillClick();
        });
        pill.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1 || event.get_button() === 3) {
                onPillClick();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        return { actor: pill, circleBtn, icon, titleLbl, subLbl };
    }

    // Creates the Apple Do Not Disturb Pill with Crescent Moon Icon
    _createDndPill() {
        const pill = new St.Button({
            style_class: 'mac-cc-pill quick-toggle',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            style: 'width: 167px !important; min-width: 167px !important; max-width: 167px !important; height: 70px !important; min-height: 70px !important; max-height: 70px !important; border-radius: 9999px !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important;',
        });

        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'padding: 0 6px 0 14px !important; margin: 0 !important; spacing: 8px !important;',
        });
        pill.set_child(box);

        const moonIcon = createIcon(MOON_ICON_PATH, 18);
        moonIcon.x_align = Clutter.ActorAlign.CENTER;
        moonIcon.y_align = Clutter.ActorAlign.CENTER;

        const dndBgActor = new St.Widget({
            style_class: 'mac-cc-dnd-circle-bg',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important;',
            visible: false,
        });
        dndBgActor.set_pivot_point(0.5, 0.5);
        dndBgActor.opacity = 0;
        dndBgActor.scale_x = 0.75;
        dndBgActor.scale_y = 0.75;

        const dndContainer = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            width: 34,
            height: 34,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        dndContainer.add_child(dndBgActor);
        dndContainer.add_child(moonIcon);

        const circleBtn = new St.Button({
            style_class: 'mac-cc-pill-icon-btn mac-cc-dnd-icon-btn',
            child: dndContainer,
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;',
        });
        circleBtn._bgActor = dndBgActor;
        this._setDndBtnActive(circleBtn, moonIcon, false, '#5856d6');
        box.add_child(circleBtn);

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 1px;',
        });
        const titleLbl = new St.Label({
            text: t('do_not_disturb', 'Не турбувати'),
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px !important; font-weight: 600 !important; letter-spacing: 0.1px !important;',
        });
        try {
            titleLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}

        const subLbl = new St.Label({
            text: t('off', 'Вимкнено'),
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 11.5px !important; font-weight: 400 !important; letter-spacing: 0.1px !important;',
        });
        try {
            subLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}

        textCol.add_child(titleLbl);
        textCol.add_child(subLbl);
        box.add_child(textCol);

        pill.connect('clicked', () => this._toggleDnd());
        pill.connect('button-press-event', () => {
            this._toggleDnd();
            return Clutter.EVENT_STOP;
        });
        circleBtn.connect('clicked', () => this._toggleDnd());
        circleBtn.connect('button-press-event', () => {
            this._toggleDnd();
            return Clutter.EVENT_STOP;
        });

        return { actor: pill, circleBtn, icon: moonIcon, titleLbl, subLbl };
    }

    syncAll() {
        if (!this.container || this._isDestroyed) return;
        if (this.wifiPill?.titleLbl) this.wifiPill.titleLbl.text = t('wifi', 'Wi-Fi');
        if (this.btPill?.titleLbl) this.btPill.titleLbl.text = t('bluetooth', 'Bluetooth');
        if (this.dndPill?.titleLbl) this.dndPill.titleLbl.text = t('do_not_disturb', 'Не турбувати');
        if (this.dispLabel) this.dispLabel.text = t('display', 'Дисплей');
        if (this.soundLabel) this.soundLabel.text = t('sound', 'Звук');
        try { this._syncWifi(); } catch (_) {}
        try { this._syncBluetooth(); } catch (_) {}
        try { this._syncDarkMode(); } catch (_) {}
        try { this._syncDnd(); } catch (_) {}
        try { this._syncSound(); } catch (_) {}
        try { this._syncBrightness(); } catch (_) {}
    }

    _syncWifi() {
        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        if (isEnabled) {
            this._setCircleBtnActive(this.wifiPill.circleBtn, this.wifiPill.icon, true, '#007aff');
            const activeAp = this._wifiDevice?.get_active_access_point();
            const ssid = activeAp?.get_ssid() ? NM.utils_ssid_to_utf8(activeAp.get_ssid().get_data()) : null;
            this.wifiPill.subLbl.text = ssid || t('connected', 'Підключено');
        } else {
            this._setCircleBtnActive(this.wifiPill.circleBtn, this.wifiPill.icon, false);
            this.wifiPill.subLbl.text = t('off', 'Вимкнено');
        }
    }

    _toggleWifi() {
        if (!this._nmClient) return;
        this._nmClient.wireless_enabled = !this._nmClient.wireless_enabled;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._syncWifi();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncBluetooth() {
        let isPowered = false;
        if (this._btClient) {
            isPowered = Boolean(this._btClient.default_adapter_powered);
        } else {
            isPowered = Boolean(this.btPill?.circleBtn?._lastIsActive);
        }
        if (isPowered) {
            this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, true, '#007aff');
            this.btPill.subLbl.text = t('on', 'Увімкнено');
        } else {
            this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, false);
            this.btPill.subLbl.text = t('off', 'Вимкнено');
        }
    }

    _toggleBluetooth() {
        if (this._btClient) {
            const powered = Boolean(this._btClient.default_adapter_powered);
            this._btClient.default_adapter_powered = !powered;
        } else {
            const isPowered = Boolean(this.btPill.circleBtn._lastIsActive ?? this.btPill.circleBtn.has_style_class_name('active'));
            Util.spawnCommandLine(`bluetoothctl power ${isPowered ? 'off' : 'on'}`);
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._syncBluetooth();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncDarkMode() {
        const scheme = this._interfaceSettings.get_string('color-scheme');
        const isDark = (scheme === 'prefer-dark');
        this._setStandaloneBtnActive(this.darkModeBtn, this.darkModeIcon, isDark, '#007aff');
    }

    _toggleDarkMode() {
        const cur = this._interfaceSettings.get_string('color-scheme');
        const next = (cur === 'prefer-dark') ? 'default' : 'prefer-dark';
        this._interfaceSettings.set_string('color-scheme', next);
        this._syncDarkMode();
    }

    _syncDnd() {
        const showBanners = this._notificationSettings.get_boolean('show-banners');
        const isDnd = !showBanners;
        if (isDnd) {
            this._setDndBtnActive(this.dndPill.circleBtn, this.dndPill.icon, true, '#5856d6');
            this.dndPill.subLbl.text = t('on', 'Увімкнено');
        } else {
            this._setDndBtnActive(this.dndPill.circleBtn, this.dndPill.icon, false, '#5856d6');
            this.dndPill.subLbl.text = t('off', 'Вимкнено');
        }
    }

    _toggleDnd() {
        const showBanners = this._notificationSettings.get_boolean('show-banners');
        this._notificationSettings.set_boolean('show-banners', !showBanners);
        this._syncDnd();
    }

    _syncSound() {
        try {
            const vItem = Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0];
            if (vItem?.slider && this.volumeSlider) {
                this._syncingSound = true;
                this.volumeSlider.value = vItem.slider.value;
                this._syncingSound = false;
                return;
            }
        } catch (_) {}

        if (!this._mixerControl) return;
        this._mixerSink = this._mixerControl.get_default_sink();
        if (this._mixerSink && this.volumeSlider) {
            const vol = this._mixerSink.get_volume();
            const max = this._mixerControl.get_vol_max_norm();
            this._syncingSound = true;
            this.volumeSlider.value = Math.min(1.0, Math.max(0.0, vol / max));
            this._syncingSound = false;
        }
    }

    _setVolume(val) {
        if (this._syncingSound) return;
        try {
            const vItem = Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0];
            if (vItem?.slider) {
                vItem.slider.value = Math.min(1.0, Math.max(0.0, val));
            }
        } catch (_) {}

        if (this._mixerSink && this._mixerControl) {
            const max = this._mixerControl.get_vol_max_norm();
            this._mixerSink.set_volume(val * max);
            this._mixerSink.push_volume();
        }
    }

    _syncBrightness() {
        try {
            const bItem = Main.panel.statusArea.quickSettings?._brightness?.quickSettingsItems?.[0];
            if (bItem?.slider && this.brightnessSlider) {
                this._syncingBrightness = true;
                this.brightnessSlider.value = bItem.slider.value;
                this._syncingBrightness = false;
                return;
            }
        } catch (_) {}

        if (!this._brightnessProxy) return;
        this._brightnessProxy.get_cached_property('Brightness')?.unpack?.((val) => {
            if (typeof val === 'number' && this.brightnessSlider) {
                this._syncingBrightness = true;
                this.brightnessSlider.value = val / 100.0;
                this._syncingBrightness = false;
            }
        });
    }

    _setBrightness(val) {
        if (this._syncingBrightness) return;
        globalThis._macDraggingBrightness = true;
        if (this._osdSuppressTimer) GLib.source_remove(this._osdSuppressTimer);
        this._osdSuppressTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            globalThis._macDraggingBrightness = false;
            this._osdSuppressTimer = 0;
            return GLib.SOURCE_REMOVE;
        });

        try {
            const bItem = Main.panel.statusArea.quickSettings?._brightness?.quickSettingsItems?.[0];
            if (bItem?.slider) {
                bItem.slider.value = Math.min(1.0, Math.max(0.0, val));
            }
        } catch (_) {}

        if (this._brightnessProxy) {
            const target = Math.round(val * 100);
            try {
                this._brightnessProxy.set_property('Brightness', new GLib.Variant('i', target));
            } catch (_) {}
        }
    }

    _setMediaTitle(text) {
        if (!this.mediaTitle) return;
        this._stopMarquee();
        this.mediaTitle.translation_x = 0;
        this.mediaTitle.text = text || t('not_playing', 'Не відтворюється');

        if (this._marqueeTimeoutId) {
            GLib.source_remove(this._marqueeTimeoutId);
            this._marqueeTimeoutId = 0;
        }

        this._marqueeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (this._isDestroyed || !this.mediaTitle) return GLib.SOURCE_REMOVE;
            const [, prefW] = this.mediaTitle.get_preferred_width(-1);
            if (prefW > 131) {
                this._startMarquee(prefW);
            } else {
                this.mediaTitle.style = 'width: 131px; min-width: 131px; font-size: 12.5px !important; font-weight: 700 !important; text-align: left !important;';
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _startMarquee(textW) {
        const overflow = textW - 131 + 10;
        const scrollDuration = Math.max(2200, Math.round(overflow * 35));
        this.mediaTitle.style = 'font-size: 12.5px !important; font-weight: 700 !important; text-align: left !important;';

        const loop = () => {
            if (this._isDestroyed || !this.mediaTitle) return;
            this.mediaTitle.remove_all_transitions();
            this.mediaTitle.translation_x = 0;

            this._marqueeLoopTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                if (this._isDestroyed || !this.mediaTitle) return GLib.SOURCE_REMOVE;
                this.mediaTitle.ease({
                    translation_x: -overflow,
                    duration: scrollDuration,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        this._marqueeLoopTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                            if (this._isDestroyed || !this.mediaTitle) return GLib.SOURCE_REMOVE;
                            this.mediaTitle.ease({
                                translation_x: 0,
                                duration: 800,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    loop();
                                },
                            });
                            return GLib.SOURCE_REMOVE;
                        });
                    },
                });
                return GLib.SOURCE_REMOVE;
            });
        };
        loop();
    }

    _stopMarquee() {
        if (this._marqueeLoopTimerId) {
            GLib.source_remove(this._marqueeLoopTimerId);
            this._marqueeLoopTimerId = 0;
        }
        if (this._marqueeTimeoutId) {
            GLib.source_remove(this._marqueeTimeoutId);
            this._marqueeTimeoutId = 0;
        }
        if (this.mediaTitle) {
            this.mediaTitle.remove_all_transitions();
            this.mediaTitle.translation_x = 0;
            this.mediaTitle.style = 'width: 131px; min-width: 131px; font-size: 12.5px !important; font-weight: 700 !important; text-align: left !important;';
        }
    }

    _animateMediaArt() {
        if (!this.mediaArt) return;
        this.mediaArt.remove_all_transitions();
        this.mediaArt.set_pivot_point(0.5, 0.5);
        this.mediaArt.opacity = 210;
        this.mediaArt.scale_x = 0.92;
        this.mediaArt.scale_y = 0.92;
        this.mediaArt.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _syncMedia(player) {
        if (!this.mediaTitle || !this.playBtn) return;
        if (!player || !player.trackTitle) {
            const wasPlaying = Boolean(this._lastTrackKey);
            this._lastTrackKey = '';
            this._setMediaTitle(t('not_playing', 'Не відтворюється'));
            if (this.mediaArtist) {
                this.mediaArtist.text = '';
                this.mediaArtist.visible = false;
            }
            if (this.mediaArt) {
                this.mediaArt.gicon = null;
                this.mediaArt.icon_name = 'audio-x-generic-symbolic';
                if (wasPlaying) this._animateMediaArt();
            }
            this.playBtn.child = createIcon('media-playback-start-symbolic', 25);
            return;
        }

        const trackKey = `${player.trackTitle || ''}__${player.trackArtists ? player.trackArtists.join(',') : ''}__${player.trackCoverUrl || ''}`;
        const trackChanged = (this._lastTrackKey !== trackKey);
        this._lastTrackKey = trackKey;

        this._setMediaTitle(player.trackTitle);
        if (this.mediaArtist) {
            const artists = player.trackArtists || [];
            const artistStr = Array.isArray(artists) ? artists.join(', ') : ('' + artists);
            this.mediaArtist.text = artistStr;
            this.mediaArtist.visible = Boolean(artistStr && artistStr.trim().length > 0);
        }

        if (this.mediaArt) {
            const coverUrl = player.trackCoverUrl;
            if (coverUrl && coverUrl.startsWith('file://')) {
                const filePath = coverUrl.replace('file://', '');
                try {
                    this.mediaArt.gicon = Gio.FileIcon.new(Gio.File.new_for_path(filePath));
                } catch (_) {
                    this.mediaArt.gicon = null;
                    this.mediaArt.icon_name = 'audio-x-generic-symbolic';
                }
            } else {
                this.mediaArt.gicon = null;
                this.mediaArt.icon_name = 'audio-x-generic-symbolic';
            }

            if (trackChanged) {
                this._animateMediaArt();
            }
        }

        if (player.status === 'Playing') {
            this.playBtn.child = createIcon('media-playback-pause-symbolic', 25);
        } else {
            this.playBtn.child = createIcon('media-playback-start-symbolic', 25);
        }
    }

    _mprisCmd(methodName) {
        if (this._activeMprisPlayer) {
            try {
                if (methodName === 'PlayPause') this._activeMprisPlayer.playPause();
                else if (methodName === 'Next') this._activeMprisPlayer.next();
                else if (methodName === 'Previous') this._activeMprisPlayer.previous();
            } catch (_) {}
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._evaluateBestPlayer();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // ==========================================================================
    // SUBMENUS (Wi-Fi, Bluetooth, Power)
    // ==========================================================================
    _createToggleSwitch(initialState, onToggle) {
        let state = Boolean(initialState);

        const switchBtn = new St.Button({
            style_class: 'mac-cc-switch-btn',
            style: 'width: 38px !important; height: 22px !important; padding: 0 !important; margin: 0 !important; background: transparent !important; background-color: transparent !important; border: none !important; box-shadow: none !important;',
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const accent = getSystemAccentColor();
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

    openSubmenu(type, sourceActor = null) {
        this.closeSoundDrawer(false);
        this._currentSubmenu = type;
        this.submenuView.destroy_all_children();

        // 1. Hide mainView completely so all cards, controls and sliders vanish immediately with NO bleeding
        this.mainView.visible = false;
        this.mainView.hide();
        this.mainView.reactive = false;
        this.viewStack.style = '';

        this.dimOverlay.visible = true;
        this.dimOverlay.style = 'background-color: transparent !important; background: transparent !important;';

        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-submenu-card',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            reactive: true,
            style: 'width: 338px !important; min-width: 338px !important; max-width: 338px !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 4px 6px !important;',
        });
        card.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                this.closeSubmenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.submenuView.add_child(card);

        if (type === 'wifi') {
            const isEnabled = Boolean(this._nmClient?.wireless_enabled);
            populateUniversalWifiContent(card, {
                nmClient: this._nmClient,
                wifiDevice: this._wifiDevice,
                isEnabled,
                onToggle: (_newVal) => {
                    this._toggleWifi();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                        if (this._currentSubmenu === 'wifi' && this.submenuView.visible) {
                            this.openSubmenu('wifi', sourceActor);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                },
                isControlCenter: true,
                onBack: () => this.closeSubmenu(),
                onClose: () => {
                    this.closeSubmenu();
                    this.menu.close();
                },
                onOpenSettings: (_panel) => {
                    this.closeSubmenu();
                    this.menu.close();
                    Util.spawnCommandLine('gnome-control-center wifi');
                },
            });
        } else if (type === 'bluetooth') {
            const isPowered = Boolean(this.btPill.circleBtn._lastIsActive ?? this.btPill.circleBtn.has_style_class_name('active')) || this.btPill.subLbl.text === t('on', 'Увімкнено');
            populateUniversalBluetoothContent(card, {
                btClient: this._btClient,
                isPowered,
                onToggle: (_newVal) => {
                    this._toggleBluetooth();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                        if (this._currentSubmenu === 'bluetooth' && this.submenuView.visible) {
                            this.openSubmenu('bluetooth', sourceActor);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                },
                isControlCenter: true,
                onBack: () => this.closeSubmenu(),
                onClose: () => {
                    this.closeSubmenu();
                    this.menu.close();
                },
                onOpenSettings: (_panel) => {
                    this.closeSubmenu();
                    this.menu.close();
                    Util.spawnCommandLine('gnome-control-center bluetooth');
                },
            });
        } else if (type === 'power') {
            // Header: Back Button (Left), Centered Title (Center), Space (Right)
            const headerItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'mac-menu-header-row',
            });
            if (headerItem._ornamentLabel) {
                try { headerItem.remove_child(headerItem._ornamentLabel); } catch (_) {}
                try { headerItem._ornamentLabel.destroy(); } catch (_) {}
                headerItem._ornamentLabel = null;
            }
            headerItem.style = 'padding: 2px 2px 6px 2px !important; margin: 0 !important; min-height: 28px !important; background: transparent !important;';
            headerItem.x_expand = true;
            headerItem.x_align = Clutter.ActorAlign.FILL;

            const headerBox = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            headerItem.add_child(headerBox);

            const leftSlot = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.START,
                style: 'width: 82px; min-width: 82px; max-width: 82px;',
            });
            const backBtn = new St.Button({
                style_class: 'mac-cc-back-btn',
                label: t('back', '◀ Назад'),
                reactive: true,
                can_focus: true,
                track_hover: true,
                style: 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;',
            });
            const updateBackHover = () => {
                backBtn.style = backBtn.hover
                    ? 'font-size: 12px !important; font-weight: 600 !important; color: #ffffff !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.22) !important;'
                    : 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;';
            };
            backBtn.connect('notify::hover', updateBackHover);
            backBtn.connect('clicked', () => this.closeSubmenu());
            backBtn.connect('button-press-event', () => {
                this.closeSubmenu();
                return Clutter.EVENT_STOP;
            });
            leftSlot.add_child(backBtn);
            headerBox.add_child(leftSlot);

            const headerTitle = new St.Label({
                text: t('battery', 'Акумулятор'),
                style_class: 'mac-menu-header-title',
                style: 'font-size: 14px !important; font-weight: 700 !important; color: #ffffff !important; text-align: center !important;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(headerTitle);

            const rightSlot = new St.BoxLayout({
                style: 'width: 82px; min-width: 82px; max-width: 82px;',
            });
            headerBox.add_child(rightSlot);

            card.add_child(headerItem);

            const contentBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            card.add_child(contentBox);
            this._buildPowerSubmenu(contentBox);
        }

        this.submenuView.visible = true;
        this.submenuView.show();
        this.submenuView.reactive = true;
        this.submenuView.opacity = 255;
    }

    closeSubmenu() {
        if (!this.submenuView.visible) return;
        this.submenuView.visible = false;
        this.submenuView.hide();
        this.submenuView.reactive = false;
        this.submenuView.destroy_all_children();
        this.dimOverlay.visible = false;
        this._currentSubmenu = null;

        // Restore mainView cleanly with full opacity and no ghost sliders
        this.mainView.visible = true;
        this.mainView.show();
        this.mainView.opacity = 255;
        this.mainView.reactive = true;
        this.viewStack.style = '';
    }

    // ==========================================================================
    // SOUND DRAWER (In-place downward expansion below Sound Card)
    // ==========================================================================
    closeSoundDrawer(animate = true) {
        if (!this.soundDrawer) return;
        this._soundDrawerOpen = false;
        if (this.airplayBtn) {
            this.airplayBtn.remove_style_class_name('active');
            this.airplayBtn.style = 'background-color: rgba(255, 255, 255, 0.18) !important; border: 1px solid rgba(255, 255, 255, 0.24) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;';
        }
        this.soundDrawer.remove_all_transitions();
        if (animate && this.soundDrawer.visible) {
            this.soundDrawer.ease({
                opacity: 0,
                translation_y: -8,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this.soundDrawer.visible = false;
                },
            });
        } else {
            this.soundDrawer.opacity = 0;
            this.soundDrawer.visible = false;
        }
        this.hideFloatingTooltip?.();
    }

    openSoundDrawer() {
        if (!this.soundDrawer) return;
        this._soundDrawerOpen = true;
        if (this.airplayBtn) {
            this.airplayBtn.add_style_class_name('active');
            this.airplayBtn.style = 'background-color: #007aff !important; border-color: #007aff !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;';
        }
        this._refreshSoundDrawer();
        this.soundDrawer.visible = true;
        this.soundDrawer.opacity = 0;
        this.soundDrawer.translation_y = -8;
        this.soundDrawer.remove_all_transitions();
        this.soundDrawer.ease({
            opacity: 255,
            translation_y: 0,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    toggleSoundDrawer() {
        if (!this.soundDrawer) return;
        const now = Date.now();
        if (this._lastSoundToggle && (now - this._lastSoundToggle < 200)) {
            return;
        }
        this._lastSoundToggle = now;

        if (this._soundDrawerOpen || this.soundDrawer.visible) {
            this.closeSoundDrawer(true);
        } else {
            this.openSoundDrawer();
        }
    }

    async _refreshSoundDrawer() {
        if (!this.soundDrawer) return;
        this.soundDrawer.destroy_all_children();

        // 1. Audio Outputs Header
        const outHeader = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 6px; padding-left: 4px; padding-right: 4px;',
        });
        outHeader.add_child(new St.Label({
            text: t('sound_output', 'Виведення звуку').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, 0.55);',
            x_expand: true,
        }));
        const closeSoundBtn = new St.Button({
            style_class: 'mac-cc-icon-btn',
            child: createIcon('window-close-symbolic', 12),
            reactive: true,
            can_focus: true,
            style: 'padding: 2px 6px; border-radius: 9999px; margin-right: 2px;',
        });
        closeSoundBtn.connect('button-press-event', () => {
            this.closeSoundDrawer();
            return Clutter.EVENT_STOP;
        });
        closeSoundBtn.connect('clicked', () => this.closeSoundDrawer());
        outHeader.add_child(closeSoundBtn);
        this.soundDrawer.add_child(outHeader);

        // Fetch available sinks (connected/working only)
        let availableSinks = [];
        try {
            if (this._mixerControl) {
                const sinks = this._mixerControl.get_sinks ? this._mixerControl.get_sinks() : [];
                const defaultSink = this._mixerControl.get_default_sink ? this._mixerControl.get_default_sink() : null;
                for (const s of sinks) {
                    const ports = s.get_ports ? s.get_ports() : [];
                    const isAvail = ports.length === 0 || ports.some(p => p.available !== false && p.available !== 0);
                    if (isAvail) {
                        let name = s.get_description() || s.get_name();
                        name = name.replace('Raptor Lake-P/U/H cAVS', '').replace('Built-in Audio', '').trim();
                        if (!name || name.toLowerCase() === 'speaker') name = t('internal_speakers', 'Вбудовані динаміки');
                        else if (name.toLowerCase() === 'headphones') name = t('headphones', 'Навушники');
                        availableSinks.push({
                            gvcSink: s,
                            id: s.get_id(),
                            name: name,
                            isDefault: defaultSink && (defaultSink.get_id() === s.get_id()),
                        });
                    }
                }
            }
        } catch (_) {}

        if (availableSinks.length === 0) {
            availableSinks.push({
                gvcSink: null,
                id: 0,
                name: t('internal_speakers', 'Вбудовані динаміки'),
                isDefault: true,
            });
        }
        this._availableSinks = availableSinks;

        // Render Sinks
        for (let i = 0; i < availableSinks.length; i++) {
            const sink = availableSinks[i];
            const sinkRow = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                style_class: 'mac-cc-submenu-row' + (sink.isDefault ? ' active' : ''),
                style: sink.isDefault
                    ? 'padding: 6px 10px; border-radius: 8px !important; margin: 1px 0px; background-color: rgba(0, 122, 255, 0.22) !important;'
                    : 'padding: 6px 10px; border-radius: 8px !important; margin: 1px 0px; background-color: transparent;',
                reactive: true,
                track_hover: true,
                can_focus: true,
            });
            const updateSinkHover = () => {
                if (sinkRow.hover) {
                    sinkRow.style = 'padding: 6px 10px; border-radius: 8px !important; margin: 1px 0px; background-color: rgba(255, 255, 255, 0.14) !important;';
                } else {
                    sinkRow.style = sink.isDefault
                        ? 'padding: 6px 10px; border-radius: 8px !important; margin: 1px 0px; background-color: rgba(0, 122, 255, 0.22) !important;'
                        : 'padding: 6px 10px; border-radius: 8px !important; margin: 1px 0px; background-color: transparent;';
                }
            };
            sinkRow.connect('notify::hover', updateSinkHover);

            const badgeBox = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                style: sink.isDefault
                    ? 'background-color: #007aff !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;'
                    : 'background-color: rgba(255, 255, 255, 0.14) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const sinkIconName = sink.name.includes('Навуш') ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic';
            const sinkIcon = new St.Icon({
                icon_name: sinkIconName,
                icon_size: 13,
                style: 'color: #ffffff;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            badgeBox.add_child(sinkIcon);
            sinkRow.add_child(badgeBox);

            sinkRow.add_child(new St.Label({
                text: sink.name,
                style: sink.isDefault ? 'font-size: 13px; font-weight: 600; color: #ffffff;' : 'font-size: 13px; font-weight: 500; color: #ffffff;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (sink.isDefault) {
                sinkRow.add_child(new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: 14,
                    style: 'color: #ffffff;',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            sinkRow.connect('button-press-event', () => {
                if (sink.gvcSink && this._mixerControl) {
                    this._mixerControl.set_default_sink(sink.gvcSink);
                }
                this._refreshSoundDrawer();
                return Clutter.EVENT_STOP;
            });
            this.soundDrawer.add_child(sinkRow);
        }

        // 2. Separator
        const sep = new St.Widget({
            style: 'height: 1px; background-color: rgba(255, 255, 255, 0.12); margin-top: 8px; margin-bottom: 8px;',
        });
        this.soundDrawer.add_child(sep);

        // 3. Applications Header
        const appHeader = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 6px; padding-left: 4px; padding-right: 4px;',
        });
        appHeader.add_child(new St.Label({
            text: t('apps_and_volume', 'Програми та гучність').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, 0.55);',
            x_expand: true,
        }));
        this.soundDrawer.add_child(appHeader);

        // Fetch application streams from pw-dump
        let appStreams = [];
        try {
            const proc = Gio.Subprocess.new(
                ['pw-dump'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            const [stdout] = await new Promise((resolve) => {
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out] = p.communicate_utf8_finish(res);
                        resolve([out]);
                    } catch (_) { resolve(['[]']); }
                });
            });
            if (stdout) {
                const dump = JSON.parse(stdout);
                for (const item of dump) {
                    if (item.type !== 'PipeWire:Interface:Node') continue;
                    const props = item.info?.props || {};
                    if (props['media.class'] === 'Stream/Output/Audio') {
                        const appName = props['application.name'] || props['node.name'] || t('application', 'Програма');
                        let iconName = props['application.icon-name'];
                        if (!iconName) {
                            if (appName.toLowerCase().includes('steam') || appName.toLowerCase().includes('cs2')) iconName = 'applications-games';
                            else if (appName.toLowerCase().includes('chrom') || appName.toLowerCase().includes('browser')) iconName = 'web-browser';
                            else if (appName.toLowerCase().includes('spot')) iconName = 'audio-x-generic';
                            else iconName = 'application-x-executable';
                        }
                        let vol = 1.0;
                        const pProps = item.info?.params?.Props;
                        if (pProps && pProps.length > 0 && typeof pProps[0].volume === 'number') {
                            vol = pProps[0].volume;
                        }
                        appStreams.push({
                            id: item.id,
                            appName: appName,
                            iconName: iconName,
                            volume: Math.min(1.0, Math.max(0.0, vol)),
                            targetNode: props['target.node'] || null,
                        });
                    }
                }
            }
        } catch (_) {}

        if (appStreams.length === 0) {
            const emptyLabel = new St.Label({
                text: t('no_active_audio_apps', 'Немає активних аудіопрограм'),
                style_class: 'mac-cc-subtitle',
                style: 'font-size: 12px; color: rgba(255, 255, 255, 0.5); padding: 4px 8px;',
            });
            this.soundDrawer.add_child(emptyLabel);
        } else {
            for (const app of appStreams) {
                const appContainer = new St.BoxLayout({
                    vertical: true,
                    style: 'margin-bottom: 6px;',
                });
                this.soundDrawer.add_child(appContainer);

                const appRow = new St.BoxLayout({
                    vertical: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 8px; padding: 4px 6px;',
                });
                appContainer.add_child(appRow);

                // App Icon Container (hover reveals dock-style floating badge)
                const iconBox = new St.BoxLayout({
                    vertical: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                    track_hover: true,
                });
                const appIcon = new St.Icon({
                    icon_name: app.iconName,
                    icon_size: 22,
                    style: 'padding: 3px; background-color: rgba(255, 255, 255, 0.12); border-radius: 8px;',
                });
                iconBox.add_child(appIcon);
                iconBox.connect('notify::hover', () => {
                    if (iconBox.hover) {
                        _macShowFloatingTooltip(appIcon, app.appName);
                    } else {
                        _macHideFloatingTooltip();
                    }
                });
                appRow.add_child(iconBox);

                // App Volume Slider
                const appSlider = new Slider(app.volume);
                const asActor = appSlider.actor || appSlider;
                asActor.add_style_class_name('mac-cc-slider-track');
                asActor.style = 'height: 8px !important; min-height: 8px !important; -barlevel-height: 7px !important; -barlevel-background-color: rgba(255, 255, 255, 0.22) !important; -barlevel-active-background-color: #ffffff !important; -slider-handle-radius: 0px !important; border-radius: 9999px !important;';
                asActor.x_expand = true;
                appSlider.connect('notify::value', () => {
                    Util.spawnCommandLine(`wpctl set-volume ${app.id} ${appSlider.value.toFixed(2)}`);
                });
                appRow.add_child(asActor);

                // Speaker Selection Button (0 = default, 1, 2, ... = specific speaker)
                let currentRouteNumber = 0;
                if (this._appRoutes && this._appRoutes[app.id]) {
                    currentRouteNumber = this._appRoutes[app.id];
                }

                const routeBtn = new St.Button({
                    style_class: 'mac-cc-route-btn' + (currentRouteNumber > 0 ? ' active' : ''),
                    label: '' + currentRouteNumber,
                    reactive: true,
                    can_focus: true,
                });
                appRow.add_child(routeBtn);

                // Context picker for selecting speaker
                const pickerBox = new St.BoxLayout({
                    vertical: true,
                    style: 'background-color: rgba(20, 20, 20, 0.95); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 14px; padding: 6px; margin: 4px 0 6px 30px; spacing: 4px;',
                    visible: false,
                });
                appContainer.add_child(pickerBox);

                // Option 0: Default
                const opt0 = new St.Button({
                    style_class: 'mac-cc-submenu-item' + (currentRouteNumber === 0 ? ' active' : ''),
                    style: currentRouteNumber === 0 ? 'border-radius: 9999px !important; background-color: #007aff !important; color: #ffffff !important; padding: 4px 8px;' : 'border-radius: 9999px !important; padding: 4px 8px;',
                    label: t('default_output', '0: За замовчуванням (без змін)'),
                    reactive: true,
                });
                opt0.connect('clicked', () => {
                    Util.spawnCommandLine(`pw-metadata -d ${app.id} target.node`);
                    if (!this._appRoutes) this._appRoutes = {};
                    this._appRoutes[app.id] = 0;
                    routeBtn.label = '0';
                    routeBtn.remove_style_class_name('active');
                    pickerBox.visible = false;
                });
                pickerBox.add_child(opt0);

                // Options 1, 2, ... for available sinks
                for (let k = 0; k < availableSinks.length; k++) {
                    const sinkNum = k + 1;
                    const sinkObj = availableSinks[k];
                    const isSelected = currentRouteNumber === sinkNum;
                    const optBtn = new St.Button({
                        style_class: 'mac-cc-submenu-item' + (isSelected ? ' active' : ''),
                        style: isSelected ? 'border-radius: 9999px !important; background-color: #007aff !important; color: #ffffff !important; padding: 4px 8px;' : 'border-radius: 9999px !important; padding: 4px 8px;',
                        label: `${sinkNum}: ${sinkObj.name}`,
                        reactive: true,
                    });
                    optBtn.connect('clicked', () => {
                        const targetId = sinkObj.id;
                        Util.spawnCommandLine(`pw-metadata ${app.id} target.node ${targetId}`);
                        if (!this._appRoutes) this._appRoutes = {};
                        this._appRoutes[app.id] = sinkNum;
                        routeBtn.label = '' + sinkNum;
                        routeBtn.add_style_class_name('active');
                        pickerBox.visible = false;
                    });
                    pickerBox.add_child(optBtn);
                }

                routeBtn.connect('clicked', () => {
                    pickerBox.visible = !pickerBox.visible;
                });
            }
        }

        // Bottom link to sound settings
        const bottomSettings = new St.Button({
            label: t('sound_settings', 'Параметри звуку...'),
            style_class: 'mac-cc-footer-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;',
        });
        const updateSoundBtnHover = () => {
            bottomSettings.style = bottomSettings.hover
                ? 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.16); color: #ffffff; font-size: 12px; font-weight: 500; text-align: center;'
                : 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;';
        };
        bottomSettings.connect('notify::hover', updateSoundBtnHover);
        bottomSettings.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center sound');
        });
        this.soundDrawer.add_child(bottomSettings);
    }

    _buildWifiSubmenu(card) {
        card.destroy_all_children();
        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        populateUniversalWifiContent(card, {
            nmClient: this._nmClient,
            wifiDevice: this._wifiDevice,
            isEnabled,
            onToggle: () => this._toggleWifi(),
            isControlCenter: true,
            onBack: () => this.closeSubmenu(),
            onClose: () => {
                this.closeSubmenu();
                this.menu.close();
            },
            onOpenSettings: () => {
                this.closeSubmenu();
                this.menu.close();
                Util.spawnCommandLine('gnome-control-center wifi');
            },
        });
    }

    _buildBluetoothSubmenu(card) {
        card.destroy_all_children();
        const isPowered = Boolean(this.btPill.circleBtn._lastIsActive ?? this.btPill.circleBtn.has_style_class_name('active')) || this.btPill.subLbl.text === t('on', 'Увімкнено');
        populateUniversalBluetoothContent(card, {
            btClient: this._btClient,
            isPowered,
            onToggle: () => this._toggleBluetooth(),
            isControlCenter: true,
            onBack: () => this.closeSubmenu(),
            onClose: () => {
                this.closeSubmenu();
                this.menu.close();
            },
            onOpenSettings: () => {
                this.closeSubmenu();
                this.menu.close();
                Util.spawnCommandLine('gnome-control-center bluetooth');
            },
        });
    }

    _buildSoundSubmenu(card) {
        const secLbl = new St.Label({
            text: t('output_device', 'Вихідний пристрій').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-bottom: 6px; padding-left: 8px;',
        });
        card.add_child(secLbl);

        try {
            const proc = Gio.Subprocess.new(
                ['wpctl', 'status'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout) {
                        const lines = stdout.split('\n');
                        let inSinks = false;
                        for (const line of lines) {
                            if (line.includes('Sinks:')) {
                                inSinks = true;
                                continue;
                            }
                            if (inSinks && line.includes('Sources:')) {
                                break;
                            }
                            if (inSinks && line.includes('.')) {
                                const isActive = line.includes('*');
                                const match = line.match(/(\d+)\.\s+(.*?)\s+\[vol:/);
                                if (match) {
                                    const id = match[1];
                                    let name = match[2].trim();
                                    name = name.replace('Raptor Lake-P/U/H cAVS', '').trim();
                                    if (!name) name = t('internal_speakers', 'Вбудовані динаміки');

                                    const row = new St.BoxLayout({
                                        vertical: false,
                                        style_class: 'mac-cc-submenu-item' + (isActive ? ' active' : ''),
                                        y_align: Clutter.ActorAlign.CENTER,
                                        reactive: true,
                                    });
                                    row.add_child(createIcon('audio-volume-high-symbolic', 14));
                                    row.add_child(new St.Label({
                                        text: name,
                                        style_class: 'mac-cc-title',
                                        style: 'margin-left: 8px;',
                                        x_expand: true,
                                    }));
                                    if (isActive) {
                                        row.add_child(createIcon('emblem-ok-symbolic', 14));
                                    }
                                    row.connect('button-press-event', () => {
                                        Util.spawnCommandLine(`wpctl set-default ${id}`);
                                        this.closeSubmenu();
                                        return Clutter.EVENT_STOP;
                                    });
                                    card.insert_child_at_index(row, card.get_children().length - 1);
                                }
                            }
                        }
                    }
                } catch (_) {}
            });
        } catch (_) {}

        const settingsBtn = new St.Button({
            label: t('sound_settings', 'Параметри звуку...'),
            style_class: 'mac-cc-back-btn',
            style: 'margin-top: 10px;',
            reactive: true,
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center sound');
        });
        card.add_child(settingsBtn);
    }

    _buildAirDropSubmenu(card) {
        const secLbl = new St.Label({
            text: t('airdrop_visibility', 'Видимість AirDrop').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-bottom: 6px; padding-left: 8px;',
        });
        card.add_child(secLbl);

        const modes = [
            { id: 'off', label: t('off', 'Вимкнено') },
            { id: 'contacts', label: t('contacts_only', 'Тільки контакти') },
            { id: 'everyone', label: t('everyone', 'Усі (Everyone)') }
        ];

        for (const m of modes) {
            const isCur = this.airdropPill.subLbl.text.toLowerCase().includes(m.id) ||
                         (m.id === 'everyone' && this.airdropPill.subLbl.text === 'Everyone') ||
                         (m.id === 'contacts' && this.airdropPill.subLbl.text === 'Contacts Only') ||
                         (m.id === 'off' && this.airdropPill.subLbl.text === 'Off');

            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'mac-cc-submenu-item' + (isCur ? ' active' : ''),
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
            });
            row.add_child(createIcon(AIRDROP_ICON_PATH, 16));
            row.add_child(new St.Label({
                text: m.label,
                style_class: 'mac-cc-title',
                style: 'margin-left: 8px;',
                x_expand: true,
            }));
            if (isCur) {
                row.add_child(createIcon('emblem-ok-symbolic', 14));
            }

            row.connect('button-press-event', () => {
                Util.spawnCommandLine(`/usr/local/bin/mac-airdrop set-mode ${m.id}`);
                this.closeSubmenu();
                return Clutter.EVENT_STOP;
            });
            card.add_child(row);
        }

        const actionsLbl = new St.Label({
            text: t('actions', 'Дії').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-top: 10px; margin-bottom: 6px; padding-left: 8px;',
        });
        card.add_child(actionsLbl);

        const sendRow = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-submenu-item',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        sendRow.add_child(createIcon('document-send-symbolic', 16));
        sendRow.add_child(new St.Label({
            text: t('send_file', 'Надіслати файл...'),
            style_class: 'mac-cc-title',
            style: 'margin-left: 8px;',
            x_expand: true,
        }));
        sendRow.connect('button-press-event', () => {
            this.menu.close();
            Util.spawnCommandLine('/usr/local/bin/mac-airdrop send');
            return Clutter.EVENT_STOP;
        });
        card.add_child(sendRow);

        const openRow = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-submenu-item',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        openRow.add_child(createIcon('folder-download-symbolic', 16));
        openRow.add_child(new St.Label({
            text: t('open_received_files', 'Відкрити отримані файли'),
            style_class: 'mac-cc-title',
            style: 'margin-left: 8px;',
            x_expand: true,
        }));
        openRow.connect('button-press-event', () => {
            this.menu.close();
            Util.spawnCommandLine('/usr/local/bin/mac-airdrop open');
            return Clutter.EVENT_STOP;
        });
        card.add_child(openRow);
    }

    _buildPowerSubmenu(card) {
        card.destroy_all_children();

        // 1. Battery status header (matching Photo 3)
        let pct = 100;
        let isCharging = false;
        let hasBattery = false;
        try {
            const upClient = UPowerGlib.Client.new_full(null);
            const dev = upClient.get_display_device();
            if (dev && dev.is_present) {
                hasBattery = true;
                pct = Math.round(dev.percentage);
                isCharging = (
                    dev.state === UPowerGlib.DeviceState.CHARGING ||
                    dev.state === UPowerGlib.DeviceState.FULLY_CHARGED ||
                    dev.state === UPowerGlib.DeviceState.PENDING_CHARGE
                );
            }
        } catch (_) {}

        if (hasBattery) {
            const batBox = new St.BoxLayout({
                vertical: true,
                style: 'padding: 8px 12px; margin-top: 4px; margin-bottom: 8px; background-color: rgba(255, 255, 255, 0.08); border-radius: 12px;',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });

            const topRow = new St.BoxLayout({
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            batBox.add_child(topRow);

            const titleLbl = new St.Label({
                text: t('battery', 'Акумулятор'),
                style: 'font-size: 13.5px; font-weight: 700; color: #ffffff;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            topRow.add_child(titleLbl);

            const pctLbl = new St.Label({
                text: `${pct} %`,
                style: 'font-size: 13.5px; font-weight: 700; color: #ffffff;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            topRow.add_child(pctLbl);

            const subLbl = new St.Label({
                text: isCharging ? t('power_source_adapter', 'Джерело живлення: адаптер живлення') : t('power_source_battery', 'Джерело живлення: акумулятор'),
                style: 'font-size: 11px; color: rgba(255, 255, 255, 0.55); margin-top: 2px;',
            });
            batBox.add_child(subLbl);
            card.add_child(batBox);

            // Режим енергоспоживання
            const pwrModeHeader = new St.Label({
                text: t('energy_mode', 'Режим енергоспоживання').toUpperCase(),
                style_class: 'mac-cc-subtitle',
                style: 'font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.45); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 4px; margin-bottom: 2px; padding: 2px 10px;',
            });
            card.add_child(pwrModeHeader);

            let isPowerSaver = false;
            try {
                const [, stdout] = GLib.spawn_command_line_sync('powerprofilesctl get');
                const prof = new TextDecoder('utf-8').decode(stdout).trim();
                isPowerSaver = (prof === 'power-saver');
            } catch (_) {}

            const saverRow = new St.BoxLayout({
                vertical: false,
                style_class: 'mac-cc-submenu-row' + (isPowerSaver ? ' active' : ''),
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                reactive: true,
                track_hover: true,
                style: 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: transparent;',
            });

            const updateSaverHover = () => {
                saverRow.style = saverRow.hover
                    ? 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.12);'
                    : 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: transparent;';
            };
            saverRow.connect('notify::hover', updateSaverHover);

            const badgeBox = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                style: isPowerSaver
                    ? 'background-color: #ffcc00 !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;'
                    : 'background-color: rgba(255, 255, 255, 0.14) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;',
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
            saverRow.add_child(badgeBox);

            const saverLbl = new St.Label({
                text: t('low_power_mode', 'Енергозбереження'),
                style: 'font-size: 13px; font-weight: 500; color: #ffffff;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            saverRow.add_child(saverLbl);

            if (isPowerSaver) {
                const okIcon = new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: 14,
                    style: 'color: #ffffff;',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                saverRow.add_child(okIcon);
            }

            saverRow.connect('button-press-event', () => {
                const targetProfile = isPowerSaver ? 'balanced' : 'power-saver';
                Util.spawnCommandLine(`powerprofilesctl set ${targetProfile}`);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    if (this._currentSubmenu === 'power' && this.submenuView.visible) {
                        this._buildPowerSubmenu(card);
                    }
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
            });
            card.add_child(saverRow);
        }

        // 2. Power actions section
        const secLbl = new St.Label({
            text: t('power_management', 'Керування живленням').toUpperCase(),
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.45); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 8px; margin-bottom: 2px; padding: 2px 10px;',
        });
        card.add_child(secLbl);

        const actions = [
            {
                label: t('sleep', 'Сон (Sleep)'),
                icon: 'weather-clear-night-symbolic',
                cmd: 'systemctl suspend',
            },
            {
                label: t('hibernate', 'Гібернація'),
                icon: 'drive-harddisk-symbolic',
                cmd: 'systemctl hibernate',
            },
            {
                label: t('restart', 'Перезапуск...'),
                icon: 'system-reboot-symbolic',
                cmd: 'gnome-session-quit --reboot',
            },
            {
                label: t('shutdown', 'Вимкнути комп’ютер...'),
                icon: 'system-shutdown-symbolic',
                cmd: 'gnome-session-quit --power-off',
            },
            {
                label: t('logout', 'Вийти з системи...'),
                icon: 'system-log-out-symbolic',
                cmd: 'gnome-session-quit --logout',
            },
        ];

        for (const act of actions) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'mac-cc-submenu-row',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                reactive: true,
                track_hover: true,
                style: 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: transparent;',
            });

            const updateRowHover = () => {
                row.style = row.hover
                    ? 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.12);'
                    : 'padding: 6px 10px; margin: 1px 0px; border-radius: 8px; background-color: transparent;';
            };
            row.connect('notify::hover', updateRowHover);

            const badgeBox = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                style: 'background-color: rgba(255, 255, 255, 0.14) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const actIcon = new St.Icon({
                icon_name: act.icon,
                icon_size: 14,
                style: 'color: #ffffff;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            badgeBox.add_child(actIcon);
            row.add_child(badgeBox);

            const actLbl = new St.Label({
                text: act.label,
                style: 'font-size: 13px; font-weight: 500; color: #ffffff;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(actLbl);

            row.connect('button-press-event', () => {
                this.menu.close();
                Util.spawnCommandLine(act.cmd);
                return Clutter.EVENT_STOP;
            });
            card.add_child(row);
        }

        // 3. Settings Footer
        const settingsBtn = new St.Button({
            label: t('battery_settings', 'Параметри акумулятора...'),
            style_class: 'mac-cc-footer-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;',
        });
        const updateBtnHover = () => {
            settingsBtn.style = settingsBtn.hover
                ? 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.16); color: #ffffff; font-size: 12px; font-weight: 500; text-align: center;'
                : 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;';
        };
        settingsBtn.connect('notify::hover', updateBtnHover);
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center power');
        });
        card.add_child(settingsBtn);
    }

    destroy() {
        this._isDestroyed = true;
        _macHideFloatingTooltip();
        this._stopMarquee();
        if (this._mprisSubId) {
            try { Gio.DBus.session.signal_unsubscribe(this._mprisSubId); } catch (_) {}
            this._mprisSubId = 0;
        }
        if (this._mprisPlayers) {
            for (const p of this._mprisPlayers.values()) {
                try { p._close(); } catch (_) {}
            }
            this._mprisPlayers.clear();
        }
        if (this._osdSuppressTimer) {
            GLib.source_remove(this._osdSuppressTimer);
            this._osdSuppressTimer = 0;
        }
        if (Main.osdWindowManager._origShowOsdWindowMac) {
            Main.osdWindowManager._showOsdWindow = Main.osdWindowManager._origShowOsdWindowMac;
            delete Main.osdWindowManager._origShowOsdWindowMac;
        }
        if (this._pollTimerId) {
            GLib.source_remove(this._pollTimerId);
            this._pollTimerId = 0;
        }
        if (this._btClient) {
            try { this._btClient.disconnectObject(this); } catch (_) {}
            this._btClient = null;
        }
        try {
            if (this._mixerControl) {
                this._mixerControl.disconnectObject(this);
            }
        } catch (_) {}
        try {
            const bSlider = Main.panel.statusArea.quickSettings?._brightness?.quickSettingsItems?.[0]?.slider;
            if (bSlider && this._bSigId) {
                bSlider.disconnect(this._bSigId);
                this._bSigId = 0;
            }
            const vSlider = Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0]?.slider;
            if (vSlider && this._vSigId) {
                vSlider.disconnect(this._vSigId);
                this._vSigId = 0;
            }
            if (this.menu) {
                this.menu.disconnectObject(this);
            }
        } catch (_) {}
        if (this.container) {
            this.container.destroy();
            this.container = null;
        }
    }
}
