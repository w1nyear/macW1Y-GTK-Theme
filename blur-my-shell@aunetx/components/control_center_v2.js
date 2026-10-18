import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';

const AIRDROP_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/airdrop-symbolic.svg';
const STAGE_MANAGER_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/stage-manager-symbolic.svg';
const MIRRORING_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/screen-mirroring-symbolic.svg';
const DARK_MODE_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/dark-mode-symbolic.svg';
const AIRPLAY_ICON_PATH = '/home/vitaliy/.themes/MacTahoe-Dark/icons/audio-airplay-symbolic.svg';

function createIcon(pathOrName, size = 16) {
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
                        const [names] = reply.deep_unpack();
                        const mprisName = names.find(n => n.startsWith('org.mpris.MediaPlayer2.'));
                        if (mprisName) {
                            this._connectMprisPlayer(mprisName);
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
        });

        // 1. Stack: Main View and Submenu View
        this.viewStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
        });
        this.container.add_child(this.viewStack);

        this.mainView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        this.viewStack.add_child(this.mainView);

        this.submenuView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this.viewStack.add_child(this.submenuView);

        // --- TOP ROW (Connectivity Card + Media & Circles) ---
        const topRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        this.mainView.add_child(topRow);

        // LEFT COLUMN: Connectivity Card (Wi-Fi, Bluetooth, AirDrop)
        const connCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card',
            x_expand: true,
            style: 'width: 154px; min-width: 154px; spacing: 10px; padding: 10px;',
        });
        topRow.add_child(connCard);

        // Wi-Fi Row
        this.wifiRow = this._createConnRow(
            'network-wireless-signal-excellent-symbolic',
            'Wi-Fi',
            'Вимкнено',
            () => this._toggleWifi(),
            () => this.openSubmenu('wifi')
        );
        connCard.add_child(this.wifiRow.actor);

        // Bluetooth Row
        this.btRow = this._createConnRow(
            'bluetooth-active-symbolic',
            'Bluetooth',
            'Вимкнено',
            () => this._toggleBluetooth(),
            () => this.openSubmenu('bluetooth')
        );
        connCard.add_child(this.btRow.actor);

        // AirDrop Row
        this.airdropRow = this._createConnRow(
            AIRDROP_ICON_PATH,
            'AirDrop',
            'Everyone',
            () => this._toggleAirDrop(),
            () => this.openSubmenu('airdrop')
        );
        connCard.add_child(this.airdropRow.actor);

        // RIGHT COLUMN: Media Player Card + Stage Manager & Mirroring Circles
        const rightCol = new St.BoxLayout({
            vertical: true,
            style: 'width: 154px; min-width: 154px; spacing: 10px;',
        });
        topRow.add_child(rightCol);

        // Media Player Card
        this.mediaCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-media-card',
            x_expand: true,
            style: 'spacing: 8px;',
        });
        rightCol.add_child(this.mediaCard);

        const mediaHeader = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });
        this.mediaCard.add_child(mediaHeader);

        this.mediaArt = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 20,
            style_class: 'mac-cc-media-art',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        mediaHeader.add_child(this.mediaArt);

        const mediaTextCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.mediaTitle = new St.Label({
            text: 'Не відтворюється',
            style_class: 'mac-cc-title',
            style: 'font-size: 11.5px;',
        });
        this.mediaArtist = new St.Label({
            text: '',
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 10px;',
        });
        mediaTextCol.add_child(this.mediaTitle);
        mediaTextCol.add_child(this.mediaArtist);
        mediaHeader.add_child(mediaTextCol);

        // Transport Controls
        const transportRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 12px;',
        });
        this.mediaCard.add_child(transportRow);

        const prevBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-backward-symbolic', 14),
            reactive: true,
        });
        prevBtn.connect('clicked', () => this._mprisCmd('Previous'));
        transportRow.add_child(prevBtn);

        this.playBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-playback-start-symbolic', 16),
            reactive: true,
        });
        this.playBtn.connect('clicked', () => this._mprisCmd('PlayPause'));
        transportRow.add_child(this.playBtn);

        const nextBtn = new St.Button({
            style_class: 'mac-cc-transport-btn',
            child: createIcon('media-skip-forward-symbolic', 14),
            reactive: true,
        });
        nextBtn.connect('clicked', () => this._mprisCmd('Next'));
        transportRow.add_child(nextBtn);

        // Below Media Player: 2 Circular Buttons (Stage Manager & Screen Mirroring)
        const circlesRow = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 10px;',
            x_align: Clutter.ActorAlign.CENTER,
        });
        rightCol.add_child(circlesRow);

        this.stageManagerBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large',
            child: createIcon(STAGE_MANAGER_ICON_PATH, 20),
            reactive: true,
        });
        this.stageManagerBtn.connect('clicked', () => this._toggleStageManager());
        circlesRow.add_child(this.stageManagerBtn);

        this.mirroringBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large',
            child: createIcon(MIRRORING_ICON_PATH, 20),
            reactive: true,
        });
        this.mirroringBtn.connect('clicked', () => {
            this.menu.close();
            Util.spawnCommandLine('gnome-control-center display');
        });
        circlesRow.add_child(this.mirroringBtn);

        // --- MIDDLE ROW: Dark Style, Screenshot, Do Not Disturb ---
        const midRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        this.mainView.add_child(midRow);

        this.darkModeBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large',
            child: createIcon(DARK_MODE_ICON_PATH, 20),
            reactive: true,
        });
        this.darkModeBtn.connect('clicked', () => this._toggleDarkMode());
        midRow.add_child(this.darkModeBtn);

        const screenshotBtn = new St.Button({
            style_class: 'mac-cc-circle-btn-large',
            child: createIcon('camera-photo-symbolic', 20),
            reactive: true,
        });
        screenshotBtn.connect('clicked', () => {
            this.menu.close();
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (Main.screenshotUI) Main.screenshotUI.open();
                return GLib.SOURCE_REMOVE;
            });
        });
        midRow.add_child(screenshotBtn);

        // Do Not Disturb Pill
        this.dndCard = new St.Button({
            style_class: 'mac-cc-dnd-card',
            x_expand: true,
            reactive: true,
        });
        const dndBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });
        this.dndCard.set_child(dndBox);

        this.dndMoonIcon = new St.Icon({
            icon_name: 'notifications-disabled-symbolic',
            icon_size: 16,
            style_class: 'mac-cc-circle-btn',
            style: 'width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important;',
        });
        dndBox.add_child(this.dndMoonIcon);

        const dndTextCol = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const dndTitle = new St.Label({
            text: 'Do Not Disturb',
            style_class: 'mac-cc-title',
            style: 'font-size: 11.5px;',
        });
        this.dndSubtitle = new St.Label({
            text: 'Off',
            style_class: 'mac-cc-subtitle',
            style: 'font-size: 10px;',
        });
        dndTextCol.add_child(dndTitle);
        dndTextCol.add_child(this.dndSubtitle);
        dndBox.add_child(dndTextCol);

        this.dndCard.connect('clicked', () => this._toggleDnd());
        midRow.add_child(this.dndCard);

        // --- BOTTOM CARDS: Display Slider & Sound Slider ---
        // Display Brightness Card
        const displayCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card',
            x_expand: true,
            style: 'spacing: 6px;',
        });
        this.mainView.add_child(displayCard);

        const dispLabel = new St.Label({
            text: 'Display',
            style_class: 'mac-cc-title',
        });
        displayCard.add_child(dispLabel);

        const dispSliderRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        displayCard.add_child(dispSliderRow);

        dispSliderRow.add_child(createIcon('display-brightness-symbolic', 14));
        this.brightnessSlider = new Slider(0.5);
        const bActor = this.brightnessSlider.actor || this.brightnessSlider;
        bActor.add_style_class_name('mac-cc-slider-track');
        bActor.x_expand = true;
        this.brightnessSlider.connect('notify::value', () => this._setBrightness(this.brightnessSlider.value));
        dispSliderRow.add_child(bActor);
        dispSliderRow.add_child(createIcon('display-brightness-symbolic', 18));

        // Sound Volume Card
        const soundCard = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-cc-card mac-cc-slider-card',
            x_expand: true,
            style: 'spacing: 6px;',
        });
        this.mainView.add_child(soundCard);

        const soundLabel = new St.Label({
            text: 'Sound',
            style_class: 'mac-cc-title',
        });
        soundCard.add_child(soundLabel);

        const soundSliderRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'spacing: 10px;',
        });
        soundCard.add_child(soundSliderRow);

        soundSliderRow.add_child(createIcon('audio-volume-low-symbolic', 14));
        this.volumeSlider = new Slider(0.5);
        const vActor = this.volumeSlider.actor || this.volumeSlider;
        vActor.add_style_class_name('mac-cc-slider-track');
        vActor.x_expand = true;
        this.volumeSlider.connect('notify::value', () => this._setVolume(this.volumeSlider.value));
        soundSliderRow.add_child(vActor);
        soundSliderRow.add_child(createIcon('audio-volume-high-symbolic', 18));

        const airplayBtn = new St.Button({
            style_class: 'mac-cc-circle-btn',
            style: 'width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important;',
            child: createIcon(AIRPLAY_ICON_PATH, 16),
            reactive: true,
        });
        airplayBtn.connect('clicked', () => this.openSubmenu('sound'));
        soundSliderRow.add_child(airplayBtn);

        // Right-click on Sound card also opens Sound submenu
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

    _createConnRow(iconPathOrName, title, subtitle, onCircleClick, onRowRightClick) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-row',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
        });

        const circleBtn = new St.Button({
            style_class: 'mac-cc-circle-btn',
            child: createIcon(iconPathOrName, 18),
            reactive: true,
        });
        circleBtn.connect('clicked', () => onCircleClick());
        row.add_child(circleBtn);

        const textCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLbl = new St.Label({
            text: title,
            style_class: 'mac-cc-title',
        });
        const subLbl = new St.Label({
            text: subtitle,
            style_class: 'mac-cc-subtitle',
        });
        textCol.add_child(titleLbl);
        textCol.add_child(subLbl);
        row.add_child(textCol);

        // Click on text or row opens submenu; right click anywhere on row opens submenu
        row.connect('button-press-event', (_actor, event) => {
            const btn = event.get_button();
            if (btn === 3) {
                onRowRightClick();
                return Clutter.EVENT_STOP;
            } else if (btn === 1 && event.get_source() !== circleBtn) {
                onRowRightClick();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        return { actor: row, circleBtn, titleLbl, subLbl };
    }

    syncAll() {
        this._syncWifi();
        this._syncBluetooth();
        this._syncAirDrop();
        this._syncStageManager();
        this._syncDarkMode();
        this._syncDnd();
        this._syncSound();
        this._syncBrightness();
    }

    _syncWifi() {
        const isEnabled = Boolean(this._nmClient?.wireless_enabled);
        if (isEnabled) {
            this.wifiRow.circleBtn.add_style_class_name('active');
            const activeAp = this._wifiDevice?.get_active_access_point();
            const ssid = activeAp?.get_ssid() ? NM.utils_ssid_to_utf8(activeAp.get_ssid().get_data()) : null;
            this.wifiRow.subLbl.text = ssid || 'Підключено';
        } else {
            this.wifiRow.circleBtn.remove_style_class_name('active');
            this.wifiRow.subLbl.text = 'Вимкнено';
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
                        this.btRow.circleBtn.add_style_class_name('active');
                        this.btRow.subLbl.text = 'Увімкнено';
                    } else {
                        this.btRow.circleBtn.remove_style_class_name('active');
                        this.btRow.subLbl.text = 'Вимкнено';
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    _toggleBluetooth() {
        const isPowered = this.btRow.circleBtn.has_style_class_name('active');
        const cmd = isPowered ? 'bluetoothctl power off' : 'bluetoothctl power on';
        Util.spawnCommandLine(cmd);
        if (isPowered) {
            this.btRow.circleBtn.remove_style_class_name('active');
            this.btRow.subLbl.text = 'Вимкнено';
        } else {
            this.btRow.circleBtn.add_style_class_name('active');
            this.btRow.subLbl.text = 'Увімкнено';
        }
    }

    _syncAirDrop() {
        try {
            const proc = Gio.Subprocess.new(
                ['/usr/local/bin/mac-airdrop', 'status'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout) {
                        const status = JSON.parse(stdout.trim());
                        const mode = status.mode || 'off';
                        if (mode === 'everyone') {
                            this.airdropRow.circleBtn.add_style_class_name('active');
                            this.airdropRow.subLbl.text = 'Everyone';
                        } else if (mode === 'contacts') {
                            this.airdropRow.circleBtn.add_style_class_name('active');
                            this.airdropRow.subLbl.text = 'Contacts Only';
                        } else {
                            this.airdropRow.circleBtn.remove_style_class_name('active');
                            this.airdropRow.subLbl.text = 'Off';
                        }
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    _toggleAirDrop() {
        Util.spawnCommandLine('/usr/local/bin/mac-airdrop toggle');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._syncAirDrop();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncStageManager() {
        const ext = Main.extensionManager?.lookup('stage-manager@gnome-stage-manager');
        const isEnabled = ext && ext.state === 1; // 1 = ExtensionState.ENABLED
        if (isEnabled) {
            this.stageManagerBtn.add_style_class_name('active');
        } else {
            this.stageManagerBtn.remove_style_class_name('active');
        }
    }

    _toggleStageManager() {
        const ext = Main.extensionManager?.lookup('stage-manager@gnome-stage-manager');
        const isEnabled = ext && ext.state === 1;
        if (isEnabled) {
            Main.extensionManager.disableExtension('stage-manager@gnome-stage-manager');
            this.stageManagerBtn.remove_style_class_name('active');
        } else {
            Main.extensionManager.enableExtension('stage-manager@gnome-stage-manager');
            this.stageManagerBtn.add_style_class_name('active');
        }
    }

    _syncDarkMode() {
        const scheme = this._interfaceSettings.get_string('color-scheme');
        if (scheme === 'prefer-dark') {
            this.darkModeBtn.add_style_class_name('active');
        } else {
            this.darkModeBtn.remove_style_class_name('active');
        }
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
            this.dndCard.add_style_class_name('active');
            this.dndMoonIcon.add_style_class_name('active');
            this.dndSubtitle.text = 'On';
        } else {
            this.dndCard.remove_style_class_name('active');
            this.dndMoonIcon.remove_style_class_name('active');
            this.dndSubtitle.text = 'Off';
        }
    }

    _toggleDnd() {
        const showBanners = this._notificationSettings.get_boolean('show-banners');
        this._notificationSettings.set_boolean('show-banners', !showBanners);
        this._syncDnd();
    }

    _syncSound() {
        if (!this._mixerControl) return;
        const sink = this._mixerControl.get_default_sink();
        if (sink) {
            this._mixerSink = sink;
            const max = this._mixerControl.get_vol_max_norm();
            const vol = sink.get_volume();
            this.volumeSlider.value = Math.min(1.0, Math.max(0.0, vol / max));
        }
    }

    _setVolume(val) {
        if (!this._mixerControl || !this._mixerSink) return;
        const max = this._mixerControl.get_vol_max_norm();
        this._mixerSink.set_volume(val * max);
        this._mixerSink.push_volume();
    }

    _syncBrightness() {
        if (!this._brightnessProxy) return;
        this._brightnessProxy.get_cached_property('Brightness')?.unpack?.((val) => {
            if (typeof val === 'number') {
                this.brightnessSlider.value = val / 100.0;
            }
        });
    }

    _setBrightness(val) {
        if (!this._brightnessProxy) return;
        const target = Math.round(val * 100);
        try {
            this._brightnessProxy.set_property('Brightness', new GLib.Variant('i', target));
        } catch (_) {}
    }

    _syncMedia(proxy) {
        if (!this.mediaTitle || !this.playBtn) return;
        if (!proxy) {
            this.mediaTitle.text = 'Не відтворюється';
            this.mediaArtist.text = '';
            this.playBtn.child = createIcon('media-playback-start-symbolic', 16);
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
            this.playBtn.child = createIcon('media-playback-pause-symbolic', 16);
        } else {
            this.playBtn.child = createIcon('media-playback-start-symbolic', 16);
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
        });
        backBtn.connect('clicked', () => this.closeSubmenu());
        header.add_child(backBtn);

        let titleText = 'Налаштування';
        if (type === 'wifi') titleText = 'Wi-Fi';
        else if (type === 'bluetooth') titleText = 'Bluetooth';
        else if (type === 'sound') titleText = 'Вихід звуку';
        else if (type === 'airdrop') titleText = 'AirDrop';

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
        else if (type === 'airdrop') this._buildAirDropSubmenu(card);

        this.mainView.visible = false;
        this.submenuView.visible = true;
    }

    closeSubmenu() {
        this.submenuView.visible = false;
        this.mainView.visible = true;
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
        });
        toggleRow.add_child(new St.Label({ text: 'Увімкнути Wi-Fi', style_class: 'mac-cc-title', x_expand: true }));
        const sw = new PopupMenu.Switch(isEnabled);
        toggleRow.add_child(sw);
        toggleRow.reactive = true;
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
                const nameLbl = new St.Label({
                    text: item.ssid,
                    style_class: 'mac-cc-title',
                    style: 'margin-left: 8px;',
                    x_expand: true,
                });
                netRow.add_child(nameLbl);

                if (item.ssid === activeSsid) {
                    netRow.add_child(createIcon('emblem-ok-symbolic', 14));
                } else if (item.isSecure) {
                    netRow.add_child(createIcon('channel-secure-symbolic', 12));
                }

                netRow.connect('button-press-event', () => {
                    Util.spawnCommandLine(`nmcli dev wifi connect "${item.ssid}"`);
                    this.closeSubmenu();
                    return Clutter.EVENT_STOP;
                });
                card.add_child(netRow);
            }
        }

        const settingsBtn = new St.Button({
            label: 'Параметри мережі...',
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
        const toggleRow = new St.BoxLayout({
            vertical: false,
            style_class: 'mac-cc-submenu-item',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        const isPowered = this.btRow.circleBtn.has_style_class_name('active');
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
                        for (const line of stdout.trim().split('\n')) {
                            const parts = line.split(' ');
                            if (parts.length >= 3) {
                                const mac = parts[1];
                                const name = parts.slice(2).join(' ');
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

        // Fetch sinks with wpctl status
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
            const isCur = this.airdropRow.subLbl.text.toLowerCase().includes(m.id) ||
                         (m.id === 'everyone' && this.airdropRow.subLbl.text === 'Everyone') ||
                         (m.id === 'contacts' && this.airdropRow.subLbl.text === 'Contacts Only') ||
                         (m.id === 'off' && this.airdropRow.subLbl.text === 'Off');

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

    destroy() {
        if (this._pollTimerId) {
            GLib.source_remove(this._pollTimerId);
            this._pollTimerId = 0;
        }
        if (this.container) {
            this.container.destroy();
            this.container = null;
        }
    }
}
