import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';

const AIRDROP_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/airdrop-v2-symbolic.svg';
const STAGE_MANAGER_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/stage-manager-symbolic.svg';
const MIRRORING_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/screen-mirroring-symbolic.svg';
const DARK_MODE_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/dark-mode-symbolic.svg';
const SCREENSHOT_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/screenshot-viewfinder-symbolic.svg';
const AIRPLAY_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/audio-airplay-symbolic.svg';
const MOON_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/moon-symbolic.svg';

function createIcon(pathOrName, size = 18) {
    if (pathOrName.startsWith('/')) {
        const file = Gio.File.new_for_path(pathOrName);
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

export class MacControlCenter {
    constructor(quickSettingsMenu) {
        this.menu = quickSettingsMenu;
        this._nmClient = null;
        this._wifiDevice = null;
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
                } else {
                    this.syncAll();
                }
            }, this);
        }
    }

    _findWifiDevice() {
        if (!this._nmClient) return;
        const devices = this._nmClient.get_devices() || [];
        this._wifiDevice = devices.find(d => d.get_device_type() === NM.DeviceType.WIFI) || null;
    }

    _initBrightness() {
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
                        const mpris = names.find(n => n.startsWith('org.mpris.MediaPlayer2.'));
                        if (mpris) {
                            this._connectMprisPlayer(mpris);
                        } else {
                            this._syncMedia(null);
                        }
                    } catch (_) {
                        this._syncMedia(null);
                    }
                }
            );
        } catch (_) {
            this._syncMedia(null);
        }
    }

    _connectMprisPlayer(busName) {
        try {
            Gio.DBusProxy.new(
                Gio.DBus.session,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                null,
                (proxy, err) => {
                    if (!err) {
                        this._mprisPlayer = proxy;
                        this._syncMedia(proxy);
                    }
                }
            );
        } catch (_) {}
    }

    _buildUI() {
        this.container = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-control-center-root',
            x_expand: true,
            y_expand: false,
            style: 'width: 336px; min-width: 336px; max-width: 336px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px; spacing: 12px;',
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
            style: 'width: 316px; min-width: 316px; max-width: 316px; spacing: 12px;',
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
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        this.viewStack.add_child(this.submenuView);

        // =====================================================================
        // ROW 1 & 2: Left (Wi-Fi & Bluetooth Pills: 198px) + Right (Now Playing Card: 198px x 152px)
        // =====================================================================
        const topRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'width: 316px; min-width: 316px; max-width: 316px; spacing: 12px;',
        });
        this.mainView.add_child(topRow);

        // LEFT COLUMN (Wi-Fi and Bluetooth Pills - 152px wide, 70px high each, 12px gap => 152px high)
        const leftCol12 = new St.BoxLayout({
            vertical: true,
            style: 'width: 152px; min-width: 152px; max-width: 152px; spacing: 12px;',
        });
        topRow.add_child(leftCol12);

        // 1. Wi-Fi Pill (70px high, 152px wide)
        this.wifiPill = this._createConnPill(
            'network-wireless-signal-excellent-symbolic',
            'Wi-Fi',
            'Вимкнено',
            () => this._toggleWifi(),
            () => this.openSubmenu('wifi')
        );
        this.wifiPill.actor.add_style_class_name('quick-toggle');
        leftCol12.add_child(this.wifiPill.actor);

        // 2. Bluetooth Pill (70px high, 152px wide)
        this.btPill = this._createConnPill(
            'bluetooth-active-symbolic',
            'Bluetooth',
            'Вимкнено',
            () => this._toggleBluetooth(),
            () => this.openSubmenu('bluetooth')
        );
        this.btPill.actor.add_style_class_name('quick-toggle');
        leftCol12.add_child(this.btPill.actor);

        // RIGHT COLUMN (Now Playing Media Card - Exact 152px wide x 152px high!)
        const rightCol12 = new St.BoxLayout({
            vertical: true,
            style: 'width: 152px; min-width: 152px; max-width: 152px; height: 152px; min-height: 152px; max-height: 152px;',
        });
        topRow.add_child(rightCol12);

        this.mediaCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-media-card quick-toggle',
            x_expand: true,
            style: 'width: 128px; min-width: 128px; max-width: 128px; height: 132px; min-height: 132px; max-height: 132px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px 12px !important; border-radius: 35px !important;',
        });
        rightCol12.add_child(this.mediaCard);

        // Top: Music Art Icon with offset
        const mediaTopRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this.mediaCard.add_child(mediaTopRow);

        this.mediaArt = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 16,
            style_class: 'mac-cc-media-art',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; border-radius: 8px !important; background-color: rgba(255, 255, 255, 0.16) !important; border: 1px solid rgba(255, 255, 255, 0.18) !important;',
        });
        mediaTopRow.add_child(this.mediaArt);

        // Middle: Text container (below art, above buttons)
        const mediaTextCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 3px; margin-left: 2px; margin-right: 2px;',
        });
        this.mediaTitle = new St.Label({
            text: 'Не відтворюється',
            style_class: 'mac-cc-title',
            style: 'font-size: 11px; font-weight: 600;',
        });
        try {
            this.mediaTitle.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}
        this.mediaArtist = new St.Label({
            text: '',
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 10px;',
        });
        mediaTextCol.add_child(this.mediaTitle);
        mediaTextCol.add_child(this.mediaArtist);
        this.mediaCard.add_child(mediaTextCol);

        // Spacer to push transport controls cleanly to the bottom
        const mediaSpacer = new St.Widget({
            y_expand: true,
        });
        this.mediaCard.add_child(mediaSpacer);

        // Bottom: Transport Controls
        const transportRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            style: 'spacing: 12px; margin-bottom: 2px;',
        });
        this.mediaCard.add_child(transportRow);

        const prevBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-backward-symbolic', 13),
            reactive: true,
            can_focus: true,
        });
        prevBtn.connect('clicked', () => this._mprisCmd('Previous'));
        transportRow.add_child(prevBtn);

        this.playBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-playback-start-symbolic', 16),
            reactive: true,
            can_focus: true,
        });
        this.playBtn.connect('clicked', () => this._mprisCmd('PlayPause'));
        transportRow.add_child(this.playBtn);

        const nextBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-forward-symbolic', 13),
            reactive: true,
            can_focus: true,
        });
        nextBtn.connect('clicked', () => this._mprisCmd('Next'));
        transportRow.add_child(nextBtn);

        // =====================================================================
        // ROW 3: Left (Do Not Disturb Pill: 198px) + Right (Dark Mode & Power: 198px)
        // =====================================================================
        const row3 = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'width: 316px; min-width: 316px; max-width: 316px; spacing: 12px;',
        });
        this.mainView.add_child(row3);

        // Do Not Disturb Pill (Left column: 152px wide, 70px high)
        const row3Left = new St.BoxLayout({
            vertical: true,
            style: 'width: 152px; min-width: 152px; max-width: 152px; height: 70px; min-height: 70px; max-height: 70px;',
        });
        row3.add_child(row3Left);

        this.dndPill = this._createDndPill();
        this.dndPill.actor.add_style_class_name('quick-toggle');
        row3Left.add_child(this.dndPill.actor);

        // Dark Mode and Power: two 70px circular round buttons in 152px container!
        const row3Right = new St.BoxLayout({
            vertical: false,
            style: 'width: 152px; min-width: 152px; max-width: 152px; height: 70px; min-height: 70px; max-height: 70px; spacing: 12px; padding: 0 !important;',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        row3.add_child(row3Right);

        this.darkModeIcon = createIcon(DARK_MODE_ICON_PATH, 20);
        this.darkModeBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large quick-toggle',
            child: this.darkModeIcon,
            reactive: true,
            can_focus: true,
            style: 'width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 35px !important; padding: 0 !important;',
        });
        this.darkModeBtn.connect('clicked', () => this._toggleDarkMode());
        row3Right.add_child(this.darkModeBtn);

        this.powerIcon = createIcon('system-shutdown-symbolic', 20);
        this.powerBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large quick-toggle',
            child: this.powerIcon,
            reactive: true,
            can_focus: true,
            style: 'width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 35px !important; padding: 0 !important;',
        });
        this._setStandaloneBtnActive(this.powerBtn, this.powerIcon, false);
        this.powerBtn.connect('clicked', () => this.openSubmenu('power'));
        row3Right.add_child(this.powerBtn);

        // =====================================================================
        // ROW 4: Display Brightness Slider Card (Full Width: 316px, 70px high, radius 18px)
        // =====================================================================
        const displayCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card quick-toggle',
            x_expand: true,
            style: 'spacing: 4px; width: 288px; min-width: 288px; max-width: 288px; height: 50px; min-height: 50px; max-height: 50px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px 14px !important; border-radius: 18px !important;',
        });
        this.mainView.add_child(displayCard);

        const dispLabel = new St.Label({
            text: 'Display',
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px; font-weight: 600; letter-spacing: 0.15px; padding-left: 8px; margin-top: 1px; margin-bottom: 2px;',
        });
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
        // ROW 5: Sound Volume Slider Card + AirPlay Button (Full Width: 316px, 70px high, radius 18px)
        // =====================================================================
        const soundCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card quick-toggle',
            x_expand: true,
            style: 'spacing: 4px; width: 288px; min-width: 288px; max-width: 288px; height: 50px; min-height: 50px; max-height: 50px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 10px 14px !important; border-radius: 18px !important;',
        });
        this.mainView.add_child(soundCard);

        const soundLabel = new St.Label({
            text: 'Sound',
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px; font-weight: 600; letter-spacing: 0.15px; padding-left: 8px; margin-top: 1px; margin-bottom: 2px;',
        });
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
        soundSliderRow.add_child(vActor);
        soundSliderRow.add_child(createIcon('audio-volume-high-symbolic', 16));

        const airplayBtn = new St.Button({
            style_class: 'mac-cc-airplay-btn',
            style: 'background-color: rgba(255, 255, 255, 0.18) !important; border: 1px solid rgba(255, 255, 255, 0.24) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 9999px !important; padding: 0 !important; color: #ffffff !important;',
            child: createIcon(AIRPLAY_ICON_PATH, 13),
            reactive: true,
            can_focus: true,
        });
        airplayBtn.connect('clicked', () => this.openSubmenu('sound'));
        soundSliderRow.add_child(airplayBtn);

        // Right click on Sound card also opens Sound output switcher
        soundCard.reactive = true;
        soundCard.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                this.openSubmenu('sound');
                return Clutter.EVENT_STOP;
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
            if (isActive) {
                circleBtn.add_style_class_name('active');
                circleBtn.style = 'background-color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.95) !important; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 1px #ffffff !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = `color: ${accentColor} !important;`;
                }
            } else {
                circleBtn.remove_style_class_name('active');
                circleBtn.style = 'background-color: rgba(255, 255, 255, 0.18) !important; border: 1px solid rgba(255, 255, 255, 0.25) !important; width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;';
                if (icon) {
                    icon.style = 'color: rgba(255, 255, 255, 0.85) !important;';
                }
            }
        } catch (_) {}
    }

    _setStandaloneBtnActive(btn, icon, isActive, accentColor = '#007aff') {
        if (!btn || this._isDestroyed) return;
        try {
            if (isActive) {
                btn.add_style_class_name('active');
                btn.style = `background-color: ${accentColor} !important; border: 1px solid rgba(255, 255, 255, 0.45) !important; box-shadow: 0 0 12px rgba(0, 122, 255, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.5) !important; width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 35px !important; padding: 0 !important; color: #ffffff !important;`;
                if (icon) icon.style = 'color: #ffffff !important;';
            } else {
                btn.remove_style_class_name('active');
                btn.style = 'background-color: transparent !important; background: none !important; border: 1px solid rgba(255, 255, 255, 0.25) !important; box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.20) !important; width: 70px !important; height: 70px !important; min-width: 70px !important; min-height: 70px !important; border-radius: 35px !important; padding: 0 !important; color: #ffffff !important;';
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
            style: 'width: 152px !important; min-width: 152px !important; max-width: 152px !important; height: 70px !important; min-height: 70px !important; max-height: 70px !important; border-radius: 35px !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important;',
        });

        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'padding: 0 6px 0 14px !important; margin: 0 !important; spacing: 8px !important;',
        });
        pill.set_child(box);

        const icon = createIcon(iconPathOrName, 18);
        const circleBtn = new St.Button({
            style_class: 'mac-cc-pill-icon-btn',
            child: icon,
            reactive: true,
            can_focus: true,
            style: 'width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;',
        });
        this._setCircleBtnActive(circleBtn, icon, false);
        circleBtn.connect('clicked', () => onCircleClick());
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

        // Clicking text/pill or right-clicking anywhere opens submenu
        pill.connect('clicked', () => onPillClick());
        pill.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
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
            style: 'width: 152px !important; min-width: 152px !important; max-width: 152px !important; height: 70px !important; min-height: 70px !important; max-height: 70px !important; border-radius: 35px !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0 !important;',
        });

        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'padding: 0 6px 0 14px !important; margin: 0 !important; spacing: 8px !important;',
        });
        pill.set_child(box);

        const moonIcon = createIcon(MOON_ICON_PATH, 18);
        const circleBtn = new St.Button({
            style_class: 'mac-cc-pill-icon-btn',
            child: moonIcon,
            reactive: true,
            can_focus: true,
            style: 'width: 34px !important; height: 34px !important; min-width: 34px !important; min-height: 34px !important; border-radius: 9999px !important; margin: 0 !important; padding: 0 !important;',
        });
        this._setCircleBtnActive(circleBtn, moonIcon, false, '#5856d6');
        circleBtn.connect('clicked', () => this._toggleDnd());
        box.add_child(circleBtn);

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 1px;',
        });
        const titleLbl = new St.Label({
            text: 'Не турбувати',
            style_class: 'mac-cc-title',
            style: 'font-size: 12.5px !important; font-weight: 600 !important; letter-spacing: 0.1px !important;',
        });
        try {
            titleLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } catch (_) {}

        const subLbl = new St.Label({
            text: 'Вимкнено',
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

        return { actor: pill, circleBtn, icon: moonIcon, titleLbl, subLbl };
    }

    syncAll() {
        if (!this.container || this._isDestroyed) return;
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
            this.wifiPill.subLbl.text = ssid || 'Підключено';
        } else {
            this._setCircleBtnActive(this.wifiPill.circleBtn, this.wifiPill.icon, false);
            this.wifiPill.subLbl.text = 'Вимкнено';
        }
    }

    _toggleWifi() {
        if (!this._nmClient) return;
        this._nmClient.wireless_enabled = !this._nmClient.wireless_enabled;
        this._syncWifi();
    }

    _syncBluetooth() {
        try {
            const proc = Gio.Subprocess.new(
                ['bluetoothctl', 'show'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    const isPowered = stdout && stdout.includes('Powered: yes');
                    if (isPowered) {
                        this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, true, '#007aff');
                        this.btPill.subLbl.text = 'Увімкнено';
                    } else {
                        this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, false);
                        this.btPill.subLbl.text = 'Вимкнено';
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    _toggleBluetooth() {
        const isPowered = this.btPill.circleBtn.style?.includes('#ffffff');
        const cmd = isPowered ? 'bluetoothctl power off' : 'bluetoothctl power on';
        Util.spawnCommandLine(cmd);
        if (isPowered) {
            this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, false);
            this.btPill.subLbl.text = 'Вимкнено';
        } else {
            this._setCircleBtnActive(this.btPill.circleBtn, this.btPill.icon, true, '#007aff');
            this.btPill.subLbl.text = 'Увімкнено';
        }
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
            this._setCircleBtnActive(this.dndPill.circleBtn, this.dndPill.icon, true, '#5856d6');
            this.dndPill.subLbl.text = 'Увімкнено';
        } else {
            this._setCircleBtnActive(this.dndPill.circleBtn, this.dndPill.icon, false, '#5856d6');
            this.dndPill.subLbl.text = 'Вимкнено';
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

    _syncMedia(proxy) {
        if (!this.mediaTitle || !this.playBtn) return;
        if (!proxy) {
            this.mediaTitle.text = 'Не відтворюється';
            this.mediaArtist.text = '';
            this.playBtn.child = createIcon('media-playback-start-symbolic', 18);
            return;
        }

        const metadata = proxy.Metadata;
        if (metadata) {
            const title = metadata['xesam:title']?.unpack?.() || 'Невідомий трек';
            const artists = metadata['xesam:artist']?.unpack?.() || [];
            const artist = Array.isArray(artists) ? artists.join(', ') : (artists || '');
            this.mediaTitle.text = title;
            this.mediaArtist.text = artist;
        }

        const status = proxy.PlaybackStatus;
        if (status === 'Playing') {
            this.playBtn.child = createIcon('media-playback-pause-symbolic', 18);
        } else {
            this.playBtn.child = createIcon('media-playback-start-symbolic', 18);
        }
    }

    _mprisCmd(methodName) {
        if (this._mprisPlayer) {
            try { this._mprisPlayer[methodName](); } catch (_) {}
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._syncMedia(this._mprisPlayer);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // ==========================================================================
    // SUBMENUS (Wi-Fi, Bluetooth, Sound, AirDrop)
    // ==========================================================================
    openSubmenu(type) {
        this._currentSubmenu = type;
        this.submenuView.destroy_all_children();

        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-submenu-card',
            x_expand: true,
            style: 'width: 292px !important; min-width: 292px !important; max-width: 292px !important; background-color: rgba(30, 30, 30, 0.94) !important; border: 1px solid rgba(255, 255, 255, 0.22) !important; border-radius: 20px !important; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 2px 8px rgba(0, 0, 0, 0.4) !important; padding: 12px !important;',
        });
        this.submenuView.add_child(card);

        // Header: Back Button + Title
        const header = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-cc-submenu-header',
        });
        card.add_child(header);

        const backBtn = new St.Button({
            style_class: 'mac-cc-back-btn',
            label: '◀ Назад',
            reactive: true,
            can_focus: true,
        });
        backBtn.connect('clicked', () => this.closeSubmenu());
        header.add_child(backBtn);

        let titleText = 'Налаштування';
        if (type === 'wifi') titleText = 'Wi-Fi';
        else if (type === 'bluetooth') titleText = 'Bluetooth';
        else if (type === 'sound') titleText = 'Вихід звуку';
        else if (type === 'power') titleText = 'Живлення';

        const headerTitle = new St.Label({
            text: titleText,
            style_class: 'mac-cc-title',
            style: 'font-size: 15px; margin-left: 12px;',
            x_expand: true,
        });
        header.add_child(headerTitle);

        // Content
        if (type === 'wifi') this._buildWifiSubmenu(card);
        else if (type === 'bluetooth') this._buildBluetoothSubmenu(card);
        else if (type === 'sound') this._buildSoundSubmenu(card);
        else if (type === 'power') this._buildPowerSubmenu(card);

        // Transparent click catcher overlay to dismiss submenus (NO dark sheet background)
        this.dimOverlay.visible = true;
        this.dimOverlay.style = 'background-color: transparent !important; background: transparent !important;';

        // Submenu appears floating OVER mainView
        this.submenuView.visible = true;
        this.submenuView.reactive = true;
        this.mainView.reactive = false;

        // Calculate source origin of the clicked item
        let startX = 0;
        let startY = 0;
        let startW = 152;
        let startH = 70;
        if (type === 'bluetooth') {
            startY = 82; // Row 2 Left
        } else if (type === 'power') {
            startX = 246; // Row 3 Right (power button)
            startY = 164;
            startW = 70;
            startH = 70;
        } else if (type === 'sound') {
            startY = 328; // Row 5
            startW = 316;
            startH = 70;
        }

        this._lastSubmenuOrigin = { startX, startY, startW, startH };

        // 1. Main View fades out completely as requested ("а центр керування непрозорістю зникає")
        this.mainView.remove_all_transitions();
        this.mainView.ease({
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._currentSubmenu) {
                    this.mainView.visible = false;
                }
            },
        });

        // 2. Submenu card morphs from clicked button position to top & expands to full width & downwards
        card.set_pivot_point(0, 0);
        card.remove_all_transitions();
        card.translation_x = startX;
        card.translation_y = startY;
        card.scale_x = startW / 316.0;
        card.scale_y = 0.35;
        card.opacity = 200;

        card.ease({
            translation_x: 0,
            translation_y: 0,
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    closeSubmenu() {
        if (!this.submenuView.visible) return;
        this.submenuView.reactive = false;
        this.mainView.visible = true;
        this.mainView.reactive = true;
        this.dimOverlay.visible = false;

        const { startX, startY, startW } = this._lastSubmenuOrigin || { startX: 0, startY: 0, startW: 152 };
        const card = this.submenuView.get_first_child();

        // 1. Main View fades back in
        this.mainView.remove_all_transitions();
        this.mainView.ease({
            opacity: 255,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        // 2. Submenu card shrinks back to original button position & fades out
        if (card) {
            card.remove_all_transitions();
            card.ease({
                translation_x: startX,
                translation_y: startY,
                scale_x: startW / 316.0,
                scale_y: 0.35,
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    this.submenuView.visible = false;
                    this.submenuView.destroy_all_children();
                },
            });
        } else {
            this.submenuView.visible = false;
            this.submenuView.destroy_all_children();
        }

        this._currentSubmenu = null;
        this.syncAll();
    }

    _buildWifiSubmenu(card) {
        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        const activeAp = this._wifiDevice?.get_active_access_point();
        const activeSsid = activeAp?.get_ssid() ? NM.utils_ssid_to_utf8(activeAp.get_ssid().get_data()) : null;

        // Switch toggle row
        const toggleRow = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-submenu-item',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        toggleRow.add_child(new St.Label({ text: 'Увімкнути Wi-Fi', style_class: 'mac-cc-title', x_expand: true }));
        const sw = new PopupMenu.Switch(isEnabled);
        toggleRow.add_child(sw);
        toggleRow.connect('button-press-event', () => {
            this._toggleWifi();
            this.openSubmenu('wifi');
            return Clutter.EVENT_STOP;
        });
        card.add_child(toggleRow);

        if (isEnabled && this._wifiDevice) {
            const secLbl = new St.Label({
                text: 'ДОСТУПНІ МЕРЕЖІ',
                style_class: 'mac-cc-subtitle',
                style: 'font-weight: 700; margin-top: 10px; margin-bottom: 4px; padding-left: 8px;',
            });
            card.add_child(secLbl);

            const aps = this._wifiDevice.get_access_points() || [];
            const apMap = new Map();
            for (const ap of aps) {
                const s = ap.get_ssid();
                if (!s) continue;
                const ssid = NM.utils_ssid_to_utf8(s.get_data());
                if (!ssid || ssid.trim() === '') continue;
                if (!apMap.has(ssid) || apMap.get(ssid).strength < ap.get_strength()) {
                    apMap.set(ssid, { ssid, ap, strength: ap.get_strength(), isSecure: ap.get_flags() !== 0 });
                }
            }

            const sorted = Array.from(apMap.values()).sort((a, b) => {
                if (a.ssid === activeSsid) return -1;
                if (b.ssid === activeSsid) return 1;
                return b.strength - a.strength;
            });

            for (const item of sorted.slice(0, 6)) {
                const netRow = new St.BoxLayout({
                    vertical: false,
                    style_class: 'mac-cc-submenu-item' + (item.ssid === activeSsid ? ' active' : ''),
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                });
                netRow.add_child(createIcon('network-wireless-signal-excellent-symbolic', 14));
                netRow.add_child(new St.Label({
                    text: item.ssid,
                    style_class: 'mac-cc-title',
                    style: 'margin-left: 8px;',
                    x_expand: true,
                }));
                if (item.isSecure) {
                    netRow.add_child(createIcon('channel-secure-symbolic', 12));
                }
                if (item.ssid === activeSsid) {
                    netRow.add_child(createIcon('emblem-ok-symbolic', 14));
                }
                netRow.connect('button-press-event', () => {
                    this.menu.close();
                    Util.spawnCommandLine(`nmcli device wifi connect "${item.ssid}"`);
                    return Clutter.EVENT_STOP;
                });
                card.add_child(netRow);
            }
        }

        const settingsBtn = new St.Button({
            label: 'Параметри Wi-Fi...',
            style_class: 'mac-cc-back-btn',
            style: 'margin-top: 10px;',
            reactive: true,
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center wifi');
        });
        card.add_child(settingsBtn);
    }

    _buildBluetoothSubmenu(card) {
        const isPowered = this.btPill.circleBtn.style?.includes('#ffffff');

        const toggleRow = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-submenu-item',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        toggleRow.add_child(new St.Label({ text: 'Увімкнути Bluetooth', style_class: 'mac-cc-title', x_expand: true }));
        const sw = new PopupMenu.Switch(isPowered);
        toggleRow.add_child(sw);
        toggleRow.connect('button-press-event', () => {
            this._toggleBluetooth();
            this.openSubmenu('bluetooth');
            return Clutter.EVENT_STOP;
        });
        card.add_child(toggleRow);

        const secLbl = new St.Label({
            text: 'ПРИСТРОЇ',
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-top: 10px; margin-bottom: 4px; padding-left: 8px;',
        });
        card.add_child(secLbl);

        try {
            const proc = Gio.Subprocess.new(
                ['bluetoothctl', 'devices'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout) {
                        const lines = stdout.trim().split('\n');
                        for (const line of lines.slice(0, 5)) {
                            const match = line.match(/^Device\s+([0-9A-Fa-f:]+)\s+(.+)$/);
                            if (match) {
                                const mac = match[1];
                                const name = match[2];
                                const devRow = new St.BoxLayout({
                                    vertical: false,
                                    style_class: 'mac-cc-submenu-item',
                                    y_align: Clutter.ActorAlign.CENTER,
                                    reactive: true,
                                });
                                devRow.add_child(createIcon('bluetooth-active-symbolic', 14));
                                devRow.add_child(new St.Label({
                                    text: name,
                                    style_class: 'mac-cc-title',
                                    style: 'margin-left: 8px;',
                                    x_expand: true,
                                }));
                                devRow.connect('button-press-event', () => {
                                    Util.spawnCommandLine(`bluetoothctl connect ${mac}`);
                                    this.closeSubmenu();
                                    return Clutter.EVENT_STOP;
                                });
                                card.insert_child_at_index(devRow, card.get_children().length - 1);
                            }
                        }
                    }
                } catch (_) {}
            });
        } catch (_) {}

        const settingsBtn = new St.Button({
            label: 'Параметри Bluetooth...',
            style_class: 'mac-cc-back-btn',
            style: 'margin-top: 10px;',
            reactive: true,
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center bluetooth');
        });
        card.add_child(settingsBtn);
    }

    _buildSoundSubmenu(card) {
        const secLbl = new St.Label({
            text: 'ПРИСТРОЇ ВИВОДУ',
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
                                    if (!name) name = 'Вбудовані динаміки';

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
            label: 'Параметри звуку...',
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
            text: 'ВИДИМІСТЬ AIRDROP',
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-bottom: 6px; padding-left: 8px;',
        });
        card.add_child(secLbl);

        const modes = [
            { id: 'off', label: 'Вимкнено' },
            { id: 'contacts', label: 'Тільки контакти' },
            { id: 'everyone', label: 'Усі (Everyone)' }
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
            text: 'ДІЇ',
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
            text: 'Надіслати файл...',
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
            text: 'Відкрити отримані файли',
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
        const secLbl = new St.Label({
            text: 'КЕРУВАННЯ ЖИВЛЕННЯМ',
            style_class: 'mac-cc-subtitle',
            style: 'font-weight: 700; margin-bottom: 6px; padding-left: 8px;',
        });
        card.add_child(secLbl);

        const actions = [
            {
                label: 'Сон (Sleep)',
                icon: 'weather-clear-night-symbolic',
                cmd: 'systemctl suspend',
            },
            {
                label: 'Гібернація',
                icon: 'drive-harddisk-symbolic',
                cmd: 'systemctl hibernate',
            },
            {
                label: 'Перезапуск...',
                icon: 'system-reboot-symbolic',
                cmd: 'gnome-session-quit --reboot',
            },
            {
                label: 'Вимкнути комп’ютер...',
                icon: 'system-shutdown-symbolic',
                cmd: 'gnome-session-quit --power-off',
            },
            {
                label: 'Вийти з системи...',
                icon: 'system-log-out-symbolic',
                cmd: 'gnome-session-quit --logout',
            },
        ];

        for (const act of actions) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: 'mac-cc-submenu-item',
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
            });
            row.add_child(createIcon(act.icon, 16));
            row.add_child(new St.Label({
                text: act.label,
                style_class: 'mac-cc-title',
                style: 'margin-left: 10px;',
                x_expand: true,
            }));
            row.connect('button-press-event', () => {
                this.menu.close();
                Util.spawnCommandLine(act.cmd);
                return Clutter.EVENT_STOP;
            });
            card.add_child(row);
        }
    }

    destroy() {
        this._isDestroyed = true;
        if (this._pollTimerId) {
            GLib.source_remove(this._pollTimerId);
            this._pollTimerId = 0;
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
