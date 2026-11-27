// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import { getLocale, t } from './mac_i18n.js';

const SCREENSHOT_DEFAULTS = {
    blur: 16,
    tint: 14,
    shadow: 28,
};

const TOOLBAR_RADIUS = 18;
const OPTIONS_RADIUS = 14;
const OPEN_ANIM_MS = 240;
const CLOSE_ANIM_MS = 200;

const ACCENT_HEX = {
    blue: '#007aff',
    teal: '#30b0c7',
    green: '#34c759',
    yellow: '#ffcc00',
    orange: '#ff6a00',
    red: '#ff3b30',
    pink: '#ff2d55',
    purple: '#af52de',
    slate: '#8e8e93',
    brown: '#a27447',
};

const SS_STRINGS = {
    uk: {
        tip_photo_screen: 'Знімок усього екрана',
        tip_photo_window: 'Знімок вибраного вікна',
        tip_photo_area: 'Знімок вибраної області',
        tip_video_screen: 'Запис усього екрана',
        tip_video_window: 'Запис вибраного вікна',
        tip_video_area: 'Запис вибраної області',
        options: 'Параметри',
        capture: 'Зняти',
        record: 'Записати',
        save_to: 'Місце збереження',
        other_location: 'Інше місце…',
        timer: 'Таймер',
        timer_none: 'Немає',
        timer_5s: '5 секунд',
        timer_10s: '10 секунд',
        timer_3s: '3 секунди',
        opts_section: 'Параметри',
        floating_thumb: 'Показувати плаваючу мініатюру',
        remember_sel: "Запам'ятати останній вибір",
        show_cursor: 'Показувати вказівник миші',
        microphone: 'Мікрофон',
        mic_none: 'Немає',
        capture_section: 'Зйомка',
        show_clicks: 'Відображати клацання миші',
        system_sound: 'Увімкнути системний звук',
        rec_prefix: 'Запис екрана',
        shot_prefix: 'Знімок екрана',
        sec_short: 'с',
        cancel: 'Скасувати',
    },
    ru: {
        tip_photo_screen: 'Снимок всего экрана',
        tip_photo_window: 'Снимок выбранного окна',
        tip_photo_area: 'Снимок выбранной области',
        tip_video_screen: 'Запись всего экрана',
        tip_video_window: 'Запись выбранного окна',
        tip_video_area: 'Запись выбранной области',
        options: 'Параметры',
        capture: 'Снять',
        record: 'Записать',
        save_to: 'Место сохранения',
        other_location: 'Другое расположение…',
        timer: 'Таймер',
        timer_none: 'Нет',
        timer_5s: '5 секунд',
        timer_10s: '10 секунд',
        timer_3s: '3 секунды',
        opts_section: 'Параметры',
        floating_thumb: 'Отображать плавающую миниатюру',
        remember_sel: 'Запомнить последний выбор',
        show_cursor: 'Показывать курсор мыши',
        microphone: 'Микрофон',
        mic_none: 'Нет',
        capture_section: 'Снять',
        show_clicks: 'Отображать нажатия мыши',
        system_sound: 'Включить системный звук',
        rec_prefix: 'Запись экрана',
        shot_prefix: 'Снимок экрана',
        sec_short: 'с',
        cancel: 'Отмена',
    },
    en: {
        tip_photo_screen: 'Capture Entire Screen',
        tip_photo_window: 'Capture Selected Window',
        tip_photo_area: 'Capture Selected Portion',
        tip_video_screen: 'Record Entire Screen',
        tip_video_window: 'Record Selected Window',
        tip_video_area: 'Record Selected Portion',
        options: 'Options',
        capture: 'Capture',
        record: 'Record',
        save_to: 'Save to',
        other_location: 'Other Location…',
        timer: 'Timer',
        timer_none: 'None',
        timer_5s: '5 seconds',
        timer_10s: '10 seconds',
        timer_3s: '3 seconds',
        opts_section: 'Options',
        floating_thumb: 'Show Floating Thumbnail',
        remember_sel: 'Remember Last Selection',
        show_cursor: 'Show Mouse Pointer',
        microphone: 'Microphone',
        mic_none: 'None',
        capture_section: 'Capture',
        show_clicks: 'Show Mouse Clicks',
        system_sound: 'Include System Sound',
        rec_prefix: 'Screen Recording',
        shot_prefix: 'Screenshot',
        sec_short: 's',
        cancel: 'Cancel',
    },
};

function ssT(key) {
    let lang = 'en';
    try {
        lang = (getLocale() || 'en').split('_')[0].toLowerCase();
    } catch (_) {}
    const table = SS_STRINGS[lang] || SS_STRINGS.en;
    return table[key] ?? SS_STRINGS.en[key] ?? key;
}

function readJsonFile(path) {
    try {
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
        const [ok, data] = GLib.file_get_contents(path);
        if (!ok) return null;
        const text = (data instanceof Uint8Array) ? new TextDecoder().decode(data) : data.toString();
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

function writeJsonFile(path, obj) {
    try {
        const dir = GLib.path_get_dirname(path);
        GLib.mkdir_with_parents(dir, 0o755);
        GLib.file_set_contents(path, JSON.stringify(obj, null, 2) + '\n');
    } catch (_) {}
}

function getAccentHex() {
    try {
        const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        return ACCENT_HEX[s.get_string('accent-color')] || '#007aff';
    } catch (_) {
        return '#007aff';
    }
}

function isDarkTheme() {
    try {
        const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const cs = s.get_string('color-scheme');
        if (cs === 'prefer-dark') return true;
        if (cs === 'prefer-light') return false;
        return !s.get_string('gtk-theme').toLowerCase().includes('light');
    } catch (_) {
        return true;
    }
}

function resolveUserDir(dirEnum, fallbackLeaf) {
    try {
        const p = GLib.get_user_special_dir(dirEnum);
        if (p) return p;
    } catch (_) {}
    return GLib.build_filenamev([GLib.get_home_dir(), fallbackLeaf]);
}

function loadBackdropGlassClass() {
    const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
    const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
    return import(`file://${path}/dist/rendering/backdropGlass.js`).then(m => ({
        BackdropGlass: m.BackdropGlass,
        extPath: path,
        settings: ext?.stateObj?._settings || null,
    }));
}

class MacScreenshotController {
    constructor(extensionDir) {
        this._extensionDir = extensionDir;
        this._ui = Main.screenshotUI;
        this._destroyed = false;

        this._cfgMainPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'screenshot.json']);
        this._cfgUiPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'screenshot-ui.json']);
        this._stylingPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);

        this._state = this._loadPrefs();
        this._activeIsVideo = false;
        this._activeTarget = 'area'; // 'screen' | 'window' | 'area'

        this._toolbarGlass = null;
        this._optionsGlass = null;
        this._stageSignalId = 0;
        this._countdownId = 0;
        this._thumbTimeoutId = 0;
        this._monitorsSignalId = 0;
        this._capturedSignalId = 0;
        this._clickWatchId = 0;
        this._audioSubprocess = null;
        this._audioFilePath = null;
        this._hoveredModeBtn = null;
        this._lastGlassKey = '';
        this._lastOptGlassKey = '';
        this._isClosingAnim = false;
        this._optionsOpen = false;
        this._relocatingFile = false;

        this._orig = {};
        this._modeButtons = {};
        this._optionHoverItems = [];

        this._install();
    }

    _loadPrefs() {
        const mainCfg = readJsonFile(this._cfgMainPath) || {};
        const uiCfg = readJsonFile(this._cfgUiPath) || {};
        return {
            timer_delay: Number(mainCfg.timer_delay ?? 0),
            show_cursor: mainCfg.show_cursor !== undefined ? Boolean(mainCfg.show_cursor) : true,
            screencast_cursor: mainCfg.screencast_cursor !== undefined ? Boolean(mainCfg.screencast_cursor) : true,
            record_audio: Boolean(mainCfg.record_audio),
            save_location_mode: uiCfg.save_location_mode || 'default',
            save_custom_dir: uiCfg.save_custom_dir || '',
            floating_thumbnail: uiCfg.floating_thumbnail !== undefined ? Boolean(uiCfg.floating_thumbnail) : true,
            remember_selection: uiCfg.remember_selection !== undefined ? Boolean(uiCfg.remember_selection) : true,
            mic_device: uiCfg.mic_device || '',
            show_mouse_clicks: Boolean(uiCfg.show_mouse_clicks),
            record_system_audio: Boolean(uiCfg.record_system_audio),
            last_is_video: Boolean(uiCfg.last_is_video),
            last_target: uiCfg.last_target || 'area',
        };
    }

    _savePrefs() {
        const mainCfg = readJsonFile(this._cfgMainPath) || {};
        mainCfg.timer_delay = this._state.timer_delay;
        mainCfg.show_cursor = this._state.show_cursor;
        mainCfg.screencast_cursor = this._state.show_cursor;
        mainCfg.record_audio = Boolean(this._state.mic_device || this._state.record_system_audio);
        writeJsonFile(this._cfgMainPath, mainCfg);

        writeJsonFile(this._cfgUiPath, {
            save_location_mode: this._state.save_location_mode,
            save_custom_dir: this._state.save_custom_dir,
            floating_thumbnail: this._state.floating_thumbnail,
            remember_selection: this._state.remember_selection,
            mic_device: this._state.mic_device,
            show_mouse_clicks: this._state.show_mouse_clicks,
            record_system_audio: this._state.record_system_audio,
            last_is_video: this._state.last_is_video,
            last_target: this._state.last_target,
        });
    }

    _readGlassStyling() {
        const s = readJsonFile(this._stylingPath) || {};
        const blur = (typeof s.screenshot_blur === 'number') ? s.screenshot_blur : SCREENSHOT_DEFAULTS.blur;
        const tint = (typeof s.screenshot_tint === 'number') ? s.screenshot_tint : SCREENSHOT_DEFAULTS.tint;
        const shadow = (typeof s.screenshot_shadow === 'number') ? s.screenshot_shadow : SCREENSHOT_DEFAULTS.shadow;
        return {
            blur,
            tint,
            shadow,
            refraction: (typeof s.liquid_refraction === 'number') ? s.liquid_refraction / 100.0 : 0.85,
            chroma: (typeof s.liquid_chroma === 'number') ? (s.liquid_chroma / 100.0 * 0.04) : 0.008,
            rim: (typeof s.liquid_rim === 'number') ? (s.liquid_rim / 100.0 * 0.40) : 0.24,
            specular: (typeof s.liquid_specular === 'number') ? (s.liquid_specular / 100.0 * 0.40) : 0.08,
            menuBlur: (typeof s.menu_blur === 'number') ? s.menu_blur : 9,
            menuTint: (typeof s.menu_tint === 'number') ? s.menu_tint : 20,
            menuShadow: (typeof s.menu_shadow_strength === 'number') ? s.menu_shadow_strength : 30,
        };
    }

    _svgIcon(filename, size = 20) {
        const file = this._extensionDir.get_child('icons').get_child(filename);
        return new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            icon_size: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _install() {
        const ui = this._ui;
        if (!ui) return;

        // 1. Suppress GNOME default controls
        ui._typeButtonContainer?.hide();
        ui._bottomRowContainer?.hide();
        if (ui._closeButton) {
            ui._closeButton.hide();
            ui._closeButton.opacity = 0;
            ui._closeButton.reactive = false;
        }
        this._origPanelStyle = ui._panel.style;
        this._origPanelXAlign = ui._panel.x_align;
        ui._panel.x_align = Clutter.ActorAlign.CENTER;
        ui._panel.style = 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; padding: 0px !important; margin-bottom: 92px !important; spacing: 0px !important;';

        // Hide native GNOME Tooltip widgets attached directly to old buttons
        for (const child of ui.get_children()) {
            if (child?.has_style_class_name?.('screenshot-ui-tooltip')) {
                child.hide();
                child._macSuppressed = true;
            }
        }

        // 2. Build 1:1 macOS Screenshot Toolbar Pill
        this._buildToolbar();
        this._buildTooltip();
        this._buildOptionsPopup();
        this._buildCountdownPill();
        this._decorateAreaSelector();
        this._removeFullscreenDimming();

        // 3. Watch monitor changes to re-apply transparent shades
        this._monitorsSignalId = Main.layoutManager.connect('monitors-changed', () => {
            this._removeFullscreenDimming();
        });

        // 4. Override ScreenshotUI lifecycle methods cleanly
        this._hookScreenshotUI();

        // 5. Initialize Liquid Glass overlays
        this._initGlasses().catch(() => {});

        // Expose live sync handle for mac-styling-settings
        globalThis._macSyncScreenshotStyling = () => {
            this._applyGlassUniforms();
            this._syncGlass();
        };
    }

    _buildToolbar() {
        const ui = this._ui;
        this._bar = new St.BoxLayout({
            name: 'mac-screenshot-bar',
            style_class: 'mac-screenshot-bar',
            vertical: false,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._bar.set_pivot_point(0.5, 0.5);
        this._updateBarFallbackStyle();

        // 1. Close button (inside left edge, Photos 1-3)
        this._closeBtn = new St.Button({
            style_class: 'mac-screenshot-close-btn',
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._svgIcon('mac-shot-close.svg', 13),
        });
        this._styleCloseBtn(false);
        this._closeBtn.connect('notify::hover', () => this._styleCloseBtn(this._closeBtn.hover));
        this._closeBtn.connect('clicked', () => ui.close());
        this._bar.add_child(this._closeBtn);

        // 2. 3 Photo mode buttons
        const photoModes = [
            ['photo-screen', 'mac-shot-screen.svg', 'tip_photo_screen', false, 'screen'],
            ['photo-window', 'mac-shot-window.svg', 'tip_photo_window', false, 'window'],
            ['photo-area', 'mac-shot-area.svg', 'tip_photo_area', false, 'area'],
        ];
        for (const [key, svg, tipKey, isVideo, target] of photoModes) {
            this._bar.add_child(this._createModeBtn(key, svg, tipKey, isVideo, target));
        }

        this._bar.add_child(this._createDivider());

        // 3. 3 Video mode buttons
        const videoModes = [
            ['video-screen', 'mac-rec-screen.svg', 'tip_video_screen', true, 'screen'],
            ['video-window', 'mac-rec-window.svg', 'tip_video_window', true, 'window'],
            ['video-area', 'mac-rec-area.svg', 'tip_video_area', true, 'area'],
        ];
        for (const [key, svg, tipKey, isVideo, target] of videoModes) {
            this._bar.add_child(this._createModeBtn(key, svg, tipKey, isVideo, target));
        }

        this._bar.add_child(this._createDivider());

        // 4. Options dropdown button ("Параметри ⌄")
        this._optionsBtn = new St.Button({
            style_class: 'mac-screenshot-options-btn',
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const optRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 5px;',
        });
        this._optionsBtnLabel = new St.Label({
            text: ssT('options'),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px; font-weight: 500; color: #ffffff;',
        });
        this._optionsChevron = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 12,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(255, 255, 255, 0.82);',
        });
        optRow.add_child(this._optionsBtnLabel);
        optRow.add_child(this._optionsChevron);
        this._optionsBtn.set_child(optRow);
        this._styleOptionsBtn(false);
        this._optionsBtn.connect('notify::hover', () => this._styleOptionsBtn(this._optionsBtn.hover));
        this._optionsBtn.connect('clicked', () => this._toggleOptionsPopup());
        this._bar.add_child(this._optionsBtn);

        // 5. Primary Capture / Record blue action pill
        this._actionBtn = new St.Button({
            style_class: 'mac-screenshot-action-btn',
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._actionLabel = new St.Label({
            text: ssT('capture'),
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 13px; font-weight: 600; color: #ffffff;',
        });
        this._actionBtn.set_child(this._actionLabel);
        this._styleActionBtn(false);
        this._actionBtn.connect('notify::hover', () => this._styleActionBtn(this._actionBtn.hover));
        this._actionBtn.connect('clicked', () => this._onActionClicked());
        this._bar.add_child(this._actionBtn);

        ui._panel.add_child(this._bar);
    }

    _createDivider() {
        return new St.Widget({
            style: 'width: 1px; height: 22px; background-color: rgba(255, 255, 255, 0.22); margin: 0px 6px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _createModeBtn(key, svgFile, tipKey, isVideo, target) {
        const btn = new St.Button({
            style_class: 'mac-screenshot-mode-btn',
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._svgIcon(svgFile, 22),
        });
        btn._macKey = key;
        btn._macTipKey = tipKey;
        btn._macIsVideo = isVideo;
        btn._macTarget = target;
        btn.connect('notify::hover', () => {
            this._refreshModeButtonsVisual();
            if (btn.hover) {
                this._showTooltip(btn, ssT(tipKey));
            } else if (this._hoveredModeBtn === btn) {
                this._hideTooltip();
            }
        });
        btn.connect('clicked', () => {
            this._closeOptionsPopup(true);
            this._setModeAndTarget(isVideo, target);
        });
        this._modeButtons[key] = btn;
        return btn;
    }

    _styleCloseBtn(hover) {
        const bg = hover ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.56)';
        this._closeBtn.style = `width: 22px; height: 22px; min-width: 22px; min-height: 22px; border-radius: 9999px; background-color: ${bg}; margin-left: 2px; margin-right: 8px; padding: 0px; border: none;`;
    }

    _styleOptionsBtn(hover) {
        const bg = this._optionsOpen
            ? 'rgba(255, 255, 255, 0.20)'
            : (hover ? 'rgba(255, 255, 255, 0.12)' : 'transparent');
        this._optionsBtn.style = `height: 32px; padding: 0px 10px; border-radius: 8px; background-color: ${bg}; margin-right: 6px; border: none;`;
    }

    _styleActionBtn(hover) {
        const base = this._countdownId ? '#ff453a' : (hover ? '#1e90ff' : '#0a84ff');
        this._actionBtn.style = `height: 34px; min-width: 74px; padding: 0px 16px; border-radius: 10px; background-color: ${base}; border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);`;
    }

    _updateBarFallbackStyle() {
        if (!this._bar) return;
        if (this._toolbarGlass) {
            this._bar.style = 'background-color: transparent !important; background: none !important; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.22); padding: 6px 8px 6px 10px; spacing: 2px;';
        } else {
            const { tint } = this._readGlassStyling();
            const alpha = Math.max(0.55, Math.min(0.90, 0.60 + (tint / 100.0) * 0.30)).toFixed(2);
            this._bar.style = `background-color: rgba(34, 34, 36, ${alpha}) !important; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.20); box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45); padding: 6px 8px 6px 10px; spacing: 2px;`;
        }
    }

    _refreshModeButtonsVisual() {
        const activeKey = `${this._activeIsVideo ? 'video' : 'photo'}-${this._activeTarget}`;
        for (const [key, btn] of Object.entries(this._modeButtons)) {
            const selected = (key === activeKey);
            const hover = btn.hover;
            const bg = selected
                ? 'rgba(255, 255, 255, 0.20)'
                : (hover ? 'rgba(255, 255, 255, 0.10)' : 'transparent');
            const border = selected
                ? '1px solid rgba(255, 255, 255, 0.14)'
                : '1px solid transparent';
            btn.style = `width: 38px; height: 34px; min-width: 38px; min-height: 34px; border-radius: 9px; background-color: ${bg}; border: ${border}; margin: 0px 2px; padding: 0px;`;
        }
        if (this._actionLabel) {
            this._actionLabel.text = this._countdownId
                ? ssT('cancel')
                : (this._activeIsVideo ? ssT('record') : ssT('capture'));
        }
    }

    _setModeAndTarget(isVideo, target) {
        const ui = this._ui;
        this._activeIsVideo = Boolean(isVideo);
        this._activeTarget = target;
        if (this._state.remember_selection) {
            this._state.last_is_video = this._activeIsVideo;
            this._state.last_target = this._activeTarget;
            this._savePrefs();
        }

        // Sync underlying ScreenshotUI targets without letting it hide window selection in video mode
        if (this._activeIsVideo) {
            ui._castButton.checked = true;
        } else {
            ui._shotButton.checked = true;
        }

        // Apply geometry selector visibility cleanly
        ui._selectionButton.checked = (target === 'area');
        ui._screenButton.checked = (target === 'screen');
        ui._windowButton.checked = (target === 'window');

        // Keep desktop un-darkened across all modes
        if (this._activeIsVideo) {
            ui._stageScreenshotContainer.hide();
            ui._stageScreenshotContainer.opacity = 0;
        } else {
            ui._stageScreenshotContainer.show();
            ui._stageScreenshotContainer.opacity = 255;
        }

        this._removeFullscreenDimming();
        this._refreshModeButtonsVisual();
        if (this._optionsOpen) {
            this._rebuildOptionsContent();
        }
    }

    _buildTooltip() {
        this._tooltip = new St.Label({
            name: 'mac-screenshot-tooltip',
            style_class: 'mac-screenshot-tooltip',
            visible: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            style: 'background-color: rgba(36, 36, 38, 0.88); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 7px; color: #ffffff; font-size: 12px; font-weight: 500; padding: 4px 10px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);',
        });
        this._ui._primaryMonitorBin.add_child(this._tooltip);
    }

    _showTooltip(btn, text) {
        if (this._optionsOpen || !btn || !this._tooltip) return;
        this._hoveredModeBtn = btn;
        this._tooltip.text = text;
        this._tooltip.show();
        const bin = this._ui._primaryMonitorBin;
        if (bin) {
            try { bin.set_child_above_sibling(this._tooltip, null); } catch (_) {}
        }
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const [bx, by] = btn.get_transformed_position();
        const [bw] = btn.get_transformed_size();
        const [, natW] = this._tooltip.get_preferred_width(-1);
        const [, natH] = this._tooltip.get_preferred_height(natW);
        const lx = Math.max(8, Math.min(mon.width - natW - 8, Math.round((bx - mon.x) + (bw - natW) / 2)));
        const ly = Math.max(8, Math.round((by - mon.y) - natH - 12));
        this._tooltip.set_position(lx, ly);
        this._tooltip.remove_all_transitions();
        this._tooltip.ease({
            opacity: 255,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        this._hoveredModeBtn = null;
        if (!this._tooltip) return;
        this._tooltip.remove_all_transitions();
        this._tooltip.ease({
            opacity: 0,
            duration: 90,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._hoveredModeBtn) this._tooltip.hide();
            },
        });
    }

    _buildCountdownPill() {
        this._countdownBox = new St.BoxLayout({
            visible: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            style: 'background-color: rgba(28, 28, 30, 0.86); border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 16px; padding: 10px 22px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);',
        });
        this._countdownLabel = new St.Label({
            text: '',
            style: 'font-size: 28px; font-weight: 700; color: #ffffff;',
        });
        this._countdownBox.add_child(this._countdownLabel);
        this._ui._primaryMonitorBin.add_child(this._countdownBox);
    }

    _buildOptionsPopup() {
        this._optionsPopup = new St.Widget({
            name: 'mac-screenshot-options-popup',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            visible: false,
            opacity: 0,
            reactive: true,
        });
        this._optionsPopup.set_pivot_point(0.5, 1.0);

        this._optHoverPill = new St.Widget({
            name: 'mac-screenshot-hover-pill',
            reactive: false,
            opacity: 0,
            x_expand: false,
            y_expand: false,
        });
        this._optionsPopup.add_child(this._optHoverPill);

        this._optionsListBox = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style: 'width: 286px; padding: 6px; spacing: 1px;',
        });
        this._optionsPopup.add_child(this._optionsListBox);
        this._ui._primaryMonitorBin.add_child(this._optionsPopup);
    }

    _getAvailableMics() {
        const list = [];
        try {
            const mc = Volume.getMixerControl();
            const sources = mc?.get_sources ? mc.get_sources() : [];
            for (const src of sources) {
                const name = src?.get_name?.() || '';
                if (!name || name.includes('.monitor')) continue;
                const desc = src.get_description?.() || src.get_port?.()?.human_port || name;
                list.push({ name, desc });
            }
        } catch (_) {}
        return list;
    }

    _rebuildOptionsContent() {
        this._optionsListBox.destroy_all_children();
        this._optionHoverItems = [];
        const addHdr = (txt) => {
            this._optionsListBox.add_child(new St.Label({
                text: txt,
                style: 'font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.50); padding: 5px 10px 3px 28px;',
            }));
        };
        const addSep = () => {
            this._optionsListBox.add_child(new St.Widget({
                style: 'height: 1px; background-color: rgba(255, 255, 255, 0.14); margin: 5px 10px;',
                x_expand: true,
            }));
        };
        const addItem = (label, checked, onClick) => {
            const row = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                style: 'padding: 5px 10px 5px 8px; border-radius: 7px; background-color: transparent;',
            });
            const box = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 6px;',
            });
            const checkLbl = new St.Label({
                text: checked ? '✓' : '',
                y_align: Clutter.ActorAlign.CENTER,
                style: 'width: 14px; font-size: 12px; font-weight: 700; color: #ffffff; text-align: center;',
            });
            const txtLbl = new St.Label({
                text: label,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.START,
                style: 'font-size: 13px; font-weight: 400; color: #ffffff;',
            });
            if (txtLbl.clutter_text) {
                txtLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            }
            box.add_child(checkLbl);
            box.add_child(txtLbl);
            row.set_child(box);
            row.connect('notify::hover', () => {
                if (row.hover) {
                    this._glideOptionPillTo(row);
                } else {
                    const anyHover = this._optionHoverItems.find(it => it.hover);
                    if (anyHover) {
                        this._glideOptionPillTo(anyHover);
                    } else {
                        this._hideOptionPill();
                    }
                }
            });
            row.connect('clicked', () => {
                onClick();
            });
            this._optionHoverItems.push(row);
            this._optionsListBox.add_child(row);
        };

        // 1. Save To
        addHdr(ssT('save_to'));
        const primaryFolderLabel = this._activeIsVideo ? t('videos_folder', 'Відео') : t('bookmark_pictures', 'Фото');
        const oppositeFolderLabel = this._activeIsVideo ? t('bookmark_pictures', 'Фото') : t('videos_folder', 'Відео');
        const oppositeKey = this._activeIsVideo ? 'pictures' : 'videos';
        const mode = this._state.save_location_mode;

        addItem(primaryFolderLabel, mode === 'default', () => {
            this._state.save_location_mode = 'default';
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(t('bookmark_desktop', 'Робочий стіл'), mode === 'desktop', () => {
            this._state.save_location_mode = 'desktop';
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(t('bookmark_documents', 'Документи'), mode === 'documents', () => {
            this._state.save_location_mode = 'documents';
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(t('bookmark_downloads', 'Завантаження'), mode === 'downloads', () => {
            this._state.save_location_mode = 'downloads';
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(oppositeFolderLabel, mode === oppositeKey, () => {
            this._state.save_location_mode = oppositeKey;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        const customSuffix = (mode === 'custom' && this._state.save_custom_dir)
            ? `${ssT('other_location')} (${GLib.path_get_basename(this._state.save_custom_dir)})`
            : ssT('other_location');
        addItem(customSuffix, mode === 'custom', () => {
            this._pickCustomFolder();
        });

        addSep();

        // 2. Timer
        addHdr(ssT('timer'));
        const curTimer = this._state.timer_delay;
        addItem(ssT('timer_none'), curTimer === 0, () => {
            this._state.timer_delay = 0;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        if (curTimer === 1) {
            addItem(ssT('timer_3s'), true, () => {
                this._state.timer_delay = 1;
                this._savePrefs();
                this._rebuildOptionsContent();
            });
        }
        addItem(ssT('timer_5s'), curTimer === 2, () => {
            this._state.timer_delay = 2;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(ssT('timer_10s'), curTimer === 3, () => {
            this._state.timer_delay = 3;
            this._savePrefs();
            this._rebuildOptionsContent();
        });

        addSep();

        // 3. Options
        addHdr(ssT('opts_section'));
        addItem(ssT('floating_thumb'), this._state.floating_thumbnail, () => {
            this._state.floating_thumbnail = !this._state.floating_thumbnail;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(ssT('remember_sel'), this._state.remember_selection, () => {
            this._state.remember_selection = !this._state.remember_selection;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(ssT('show_cursor'), this._state.show_cursor, () => {
            this._state.show_cursor = !this._state.show_cursor;
            if (this._ui._showPointerButton) {
                this._ui._showPointerButton.checked = this._state.show_cursor;
            }
            this._savePrefs();
            this._rebuildOptionsContent();
        });

        addSep();

        // 4. Microphone (real PipeWire/Pulse sources)
        addHdr(ssT('microphone'));
        const mics = this._getAvailableMics();
        if (this._state.mic_device && !mics.some(m => m.name === this._state.mic_device)) {
            this._state.mic_device = '';
        }
        addItem(ssT('mic_none'), !this._state.mic_device, () => {
            this._state.mic_device = '';
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        for (const mic of mics) {
            addItem(mic.desc, this._state.mic_device === mic.name, () => {
                this._state.mic_device = mic.name;
                this._savePrefs();
                this._rebuildOptionsContent();
            });
        }

        addSep();

        // 5. Capture / Recording extra toggles
        addHdr(ssT('capture_section'));
        addItem(ssT('show_clicks'), this._state.show_mouse_clicks, () => {
            this._state.show_mouse_clicks = !this._state.show_mouse_clicks;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
        addItem(ssT('system_sound'), this._state.record_system_audio, () => {
            this._state.record_system_audio = !this._state.record_system_audio;
            this._savePrefs();
            this._rebuildOptionsContent();
        });
    }

    _glideOptionPillTo(row) {
        if (!this._optHoverPill || !row) return;
        const accent = getAccentHex();
        this._optHoverPill.style = `background-color: ${accent}; border-radius: 7px;`;
        const box = row.get_allocation_box();
        const x = Math.round(box.x1);
        const y = Math.round(box.y1);
        const w = Math.max(20, Math.round(box.x2 - box.x1));
        const h = Math.max(20, Math.round(box.y2 - box.y1));

        this._optHoverPill.remove_all_transitions();
        if (this._optHoverPill.opacity < 5 || this._optHoverPill.width < 10) {
            this._optHoverPill.set_position(x, y);
            this._optHoverPill.set_size(w, h);
            this._optHoverPill.ease({
                opacity: 255,
                duration: 110,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._optHoverPill.ease({
                x,
                y,
                width: w,
                height: h,
                opacity: 255,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _hideOptionPill() {
        if (!this._optHoverPill) return;
        this._optHoverPill.remove_all_transitions();
        this._optHoverPill.ease({
            opacity: 0,
            duration: 90,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _toggleOptionsPopup() {
        if (this._optionsOpen) {
            this._closeOptionsPopup();
        } else {
            this._openOptionsPopup();
        }
    }

    _openOptionsPopup() {
        this._hideTooltip();
        this._rebuildOptionsContent();
        this._optionsOpen = true;
        this._styleOptionsBtn(false);
        this._optHoverPill.opacity = 0;

        if (this._optionsGlass) {
            this._optionsPopup.style = 'background-color: transparent !important; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.22);';
        } else {
            this._optionsPopup.style = 'background-color: rgba(34, 34, 38, 0.92) !important; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.20); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.50);';
        }

        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        this._optionsPopup.show();
        const [, natW] = this._optionsPopup.get_preferred_width(-1);
        const [, natH] = this._optionsPopup.get_preferred_height(natW);
        const [bx, by] = this._bar.get_transformed_position();
        const [bw] = this._bar.get_transformed_size();
        const [ox, , ow] = this._optionsBtn.get_transformed_position().concat(this._optionsBtn.get_transformed_size());

        const anchorCenter = (ox - mon.x) + (ow / 2);
        let px = Math.round(anchorCenter - natW * 0.55);
        const maxX = Math.max(8, Math.round((bx - mon.x) + bw - natW));
        px = Math.max(8, Math.min(mon.width - natW - 8, Math.min(maxX + 40, px)));
        const py = Math.max(8, Math.round((by - mon.y) - natH - 10));

        this._optionsPopup.set_position(px, py);
        this._optionsPopup.opacity = 0;
        this._optionsPopup.scale_x = 0.96;
        this._optionsPopup.scale_y = 0.96;
        this._optionsPopup.translation_y = 6;
        this._optionsPopup.remove_all_transitions();
        this._optionsPopup.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            translation_y: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._syncGlass();
    }

    _closeOptionsPopup(instantly = false) {
        if (!this._optionsOpen) return;
        this._optionsOpen = false;
        this._styleOptionsBtn(false);
        this._hideOptionPill();
        if (instantly) {
            this._optionsPopup.hide();
            this._optionsPopup.opacity = 0;
            if (this._optionsGlass) {
                this._optionsGlass.hide();
                this._optionsGlass.opacity = 0;
            }
            return;
        }
        this._optionsPopup.remove_all_transitions();
        this._optionsPopup.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            translation_y: 4,
            duration: 130,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._optionsOpen) {
                    this._optionsPopup.hide();
                    if (this._optionsGlass) {
                        this._optionsGlass.hide();
                        this._optionsGlass.opacity = 0;
                    }
                }
            },
        });
    }

    _pickCustomFolder() {
        const ui = this._ui;
        this._closeOptionsPopup(true);
        ui.close(true);
        try {
            const proc = Gio.Subprocess.new(
                ['python3', '/usr/local/bin/mac-screenshot-process', '--pick-folder'],
                Gio.SubprocessFlags.STDOUT_PIPE
            );
            proc.communicate_utf8_async(null, null, (_p, res) => {
                try {
                    const [ok, stdout] = proc.communicate_utf8_finish(res);
                    const picked = (ok && stdout) ? stdout.trim() : '';
                    if (picked && GLib.file_test(picked, GLib.FileTest.IS_DIR)) {
                        this._state.save_location_mode = 'custom';
                        this._state.save_custom_dir = picked;
                        this._savePrefs();
                    }
                } catch (_) {}
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                    ui.open().catch(() => {});
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (_) {}
    }

    _resolveSaveDirectory(isVideo) {
        const m = this._state.save_location_mode;
        let dir = null;
        if (m === 'desktop') {
            dir = resolveUserDir(GLib.UserDirectory.DIRECTORY_DESKTOP, 'Desktop');
        } else if (m === 'documents') {
            dir = resolveUserDir(GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'Documents');
        } else if (m === 'downloads') {
            dir = resolveUserDir(GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'Downloads');
        } else if (m === 'pictures') {
            dir = resolveUserDir(GLib.UserDirectory.DIRECTORY_PICTURES, 'Pictures');
        } else if (m === 'videos') {
            dir = resolveUserDir(GLib.UserDirectory.DIRECTORY_VIDEOS, 'Videos');
        } else if (m === 'custom' && this._state.save_custom_dir) {
            dir = this._state.save_custom_dir;
        } else if (isVideo) {
            dir = GLib.build_filenamev([resolveUserDir(GLib.UserDirectory.DIRECTORY_VIDEOS, 'Videos'), 'Screencasts']);
        } else {
            return null; // Let GNOME use default Pictures/Screenshots directory
        }
        if (dir) {
            GLib.mkdir_with_parents(dir, 0o755);
        }
        return dir;
    }

    _decorateAreaSelector() {
        const ind = this._ui?._areaSelector?._areaIndicator;
        const rect = ind?._selectionRect;
        if (!rect || rect._macDashedOverlay) return;
        rect.style = 'background-color: transparent !important; border: none !important;';
        const overlay = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        overlay.add_constraint(new Clutter.BindConstraint({
            source: rect,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));
        overlay.connect('repaint', (area) => {
            const cr = area.get_context();
            try {
                const [w, h] = area.get_surface_size();
                if (w < 4 || h < 4) return;
                cr.setLineWidth(1.25);
                cr.setDash([5.0, 4.0], 0);
                cr.setSourceRGBA(0, 0, 0, 0.55);
                cr.rectangle(1.5, 1.5, w - 3, h - 3);
                cr.stroke();

                cr.setSourceRGBA(1, 1, 1, 0.94);
                cr.rectangle(0.75, 0.75, w - 1.5, h - 1.5);
                cr.stroke();

                // Crisp small midpoint dots matching macOS Photo 4
                cr.setDash([], 0);
                const pts = [
                    [w / 2, 2.5], [w / 2, h - 2.5],
                    [2.5, h / 2], [w - 2.5, h / 2],
                ];
                for (const [px, py] of pts) {
                    cr.arc(px, py, 2.6, 0, 2 * Math.PI);
                    cr.setSourceRGBA(1, 1, 1, 0.95);
                    cr.fillPreserve();
                    cr.setLineWidth(1.0);
                    cr.setSourceRGBA(0, 0, 0, 0.45);
                    cr.stroke();
                }
            } finally {
                try { cr.$dispose(); } catch (_) {}
            }
        });
        rect.add_child(overlay);
        rect._macDashedOverlay = overlay;

        // Compact Photo-4 style corner handles
        const sel = this._ui._areaSelector;
        const handleStyle = 'width: 7px !important; height: 7px !important; min-width: 7px !important; min-height: 7px !important; border-radius: 9999px; background-color: #ffffff; border: 1px solid rgba(0, 0, 0, 0.45); box-shadow: none;';
        for (const h of [sel._topLeftHandle, sel._topRightHandle, sel._bottomLeftHandle, sel._bottomRightHandle]) {
            if (h) h.style = handleStyle;
        }
    }

    _removeFullscreenDimming() {
        const ui = this._ui;
        if (!ui) return;
        const clearShades = (ind) => {
            if (!ind) return;
            for (const r of [ind._topRect, ind._bottomRect, ind._leftRect, ind._rightRect]) {
                if (r) {
                    r.style = 'background-color: transparent !important; background: none !important;';
                }
            }
        };
        clearShades(ui._areaSelector?._areaIndicator);
        clearShades(ui._screencastAreaIndicator);
        if (ui._areaSelector) {
            ui._areaSelector.style = 'background-color: transparent !important;';
        }
        const multiMon = (ui._screenSelectors?.length || 0) > 1;
        for (const s of (ui._screenSelectors || [])) {
            s.style = multiMon
                ? 'background-color: transparent !important; border: 2px solid rgba(10, 132, 255, 0.65);'
                : 'background-color: transparent !important; border: none !important;';
        }
        for (const w of (ui._windowSelectors || [])) {
            w.style = 'background-color: transparent !important;';
        }
    }

    async _initGlasses() {
        const ui = this._ui;
        const bin = ui?._primaryMonitorBin;
        if (!bin || this._destroyed) return;
        const { BackdropGlass, extPath, settings } = await loadBackdropGlassClass();
        if (this._destroyed) return;

        const excl = [ui._panel, this._bar, this._optionsPopup, this._tooltip, this._countdownBox, ui._areaSelector];
        if (!this._toolbarGlass) {
            this._toolbarGlass = new BackdropGlass({
                extensionPath: extPath,
                settings,
                logger: console,
                owner: 'screenshot-ui',
                excludeActors: excl,
            });
            this._toolbarGlass.hide();
            this._toolbarGlass.opacity = 0;
            bin.insert_child_below(this._toolbarGlass, ui._panel);
        }
        if (!this._optionsGlass) {
            this._optionsGlass = new BackdropGlass({
                extensionPath: extPath,
                settings,
                logger: console,
                owner: 'menu:screenshot-options',
                excludeActors: [...excl, this._toolbarGlass],
            });
            this._optionsGlass.hide();
            this._optionsGlass.opacity = 0;
            bin.insert_child_below(this._optionsGlass, this._optionsPopup);
        }

        this._updateBarFallbackStyle();
        this._applyGlassUniforms();
    }

    _applyGlassUniforms() {
        const cfg = this._readGlassStyling();
        const dark = isDarkTheme();
        const tColor = dark ? [0.08, 0.08, 0.09] : [0.95, 0.95, 0.97];

        const applyEffect = (g, blur, tint, shadow, radius) => {
            if (!g) return;
            const mon = Main.layoutManager.primaryMonitor;
            if (mon) {
                g.set_position(0, 0);
                g.set_size(mon.width, mon.height);
                g.setResolution(mon.width, mon.height);
            }
            g.setIsDock(false);
            g.setCornerSmoothingEnabled(0.0);
            g.setCornerRadius(radius);
            g.setTintColor(tColor[0], tColor[1], tColor[2]);
            g.setTintStrength(Math.max(0.0, Math.min(1.0, tint / 100.0)));
            g.setBlurRadius(Math.max(0.0, blur));
            g.setPadding(0);
            const eff = g._effect || g.effect;
            if (eff) {
                try {
                    eff.setSurfaceLightEnabled?.(true);
                    eff._setFloat?.('displacement_scale', cfg.refraction * 130.0);
                    eff._setFloat?.('ior', 1.0 + cfg.refraction * 0.8);
                    eff._setFloat?.('rim_intensity', cfg.rim);
                    eff._setFloat?.('specular_intensity', cfg.specular);
                    eff._setFloat?.('chroma_strength', cfg.chroma);
                    eff._setFloat?.('shadow_intensity', Math.max(0.0, Math.min(1.0, shadow / 100.0)));
                    eff._setFloat?.('shadow_radius', Math.max(0.0, shadow * 0.5));
                    eff._setFloat?.('ao_intensity', 0.06);
                    eff.queue_repaint?.();
                } catch (_) {}
            }
        };

        applyEffect(this._toolbarGlass, cfg.blur, cfg.tint, cfg.shadow, TOOLBAR_RADIUS);
        applyEffect(this._optionsGlass, cfg.menuBlur, cfg.menuTint, cfg.menuShadow, OPTIONS_RADIUS);
        this._lastGlassKey = '';
        this._lastOptGlassKey = '';
    }

    _syncGlass() {
        const ui = this._ui;
        const mon = Main.layoutManager.primaryMonitor;
        if (!ui || !mon || (!ui.visible && !this._isClosingAnim)) return;

        if (this._toolbarGlass && this._bar?.visible) {
            const panelOp = (typeof ui._panel?.opacity === 'number') ? ui._panel.opacity / 255 : 1;
            const uiOp = (typeof ui.opacity === 'number') ? ui.opacity / 255 : 1;
            const barOp = (typeof this._bar.opacity === 'number') ? this._bar.opacity : 255;
            const targetOp = Math.max(0, Math.min(255, Math.round(barOp * panelOp * uiOp)));
            this._toolbarGlass.opacity = targetOp;
            if (targetOp > 0) {
                if (!this._toolbarGlass.visible) this._toolbarGlass.show();
                const [bx, by] = this._bar.get_transformed_position();
                const [bw, bh] = this._bar.get_transformed_size();
                if (bw > 2 && bh > 2) {
                    const lx = Math.round(bx - mon.x);
                    const ly = Math.round(by - mon.y);
                    const rw = Math.round(bw);
                    const rh = Math.round(bh);
                    const key = `${lx},${ly},${rw},${rh},${targetOp}`;
                    if (key !== this._lastGlassKey) {
                        this._lastGlassKey = key;
                        this._toolbarGlass.setGlassGeometry(lx, ly, rw, rh);
                        const pad = 64;
                        this._toolbarGlass.set_clip(lx - pad, ly - pad, rw + pad * 2, rh + pad * 2);
                        this._toolbarGlass.wakeFrameSync?.();
                    }
                }
            } else if (this._toolbarGlass.visible) {
                this._toolbarGlass.hide();
            }
        }

        if (this._optionsGlass && this._optionsPopup?.visible && this._optionsOpen) {
            const [ox, oy] = this._optionsPopup.get_transformed_position();
            const [ow, oh] = this._optionsPopup.get_transformed_size();
            const op = Math.round(this._optionsPopup.opacity ?? 255);
            this._optionsGlass.opacity = op;
            if (op > 0 && ow > 2 && oh > 2) {
                if (!this._optionsGlass.visible) this._optionsGlass.show();
                const lx = Math.round(ox - mon.x);
                const ly = Math.round(oy - mon.y);
                const rw = Math.round(ow);
                const rh = Math.round(oh);
                const key = `${lx},${ly},${rw},${rh},${op}`;
                if (key !== this._lastOptGlassKey) {
                    this._lastOptGlassKey = key;
                    this._optionsGlass.setGlassGeometry(lx, ly, rw, rh);
                    const pad = 64;
                    this._optionsGlass.set_clip(lx - pad, ly - pad, rw + pad * 2, rh + pad * 2);
                    this._optionsGlass.wakeFrameSync?.();
                }
            }
        } else if (this._optionsGlass?.visible) {
            this._optionsGlass.hide();
            this._optionsGlass.opacity = 0;
        }
    }

    _connectStageSync() {
        if (!this._stageSignalId) {
            this._stageSignalId = global.stage.connect('before-update', () => this._syncGlass());
        }
    }

    _disconnectStageSync() {
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }
    }

    _hookScreenshotUI() {
        const ui = this._ui;
        const self = this;

        this._orig.open = ui.open;
        this._orig.close = ui.close;
        this._orig.finishClosing = ui._finishClosing;
        this._orig.onCapture = ui._onCaptureButtonClicked;
        this._orig.onCastToggle = ui._onCastButtonToggled;
        this._orig.syncWinSens = ui._syncWindowButtonSensitivity;
        this._orig.startScreencast = ui._startScreencast;
        this._orig.stopScreencast = ui.stopScreencast;

        // Close options or countdown on outside click / Escape
        this._capturedSignalId = ui.connect('captured-event', (_actor, event) => {
            const et = event.type();
            if (et === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                if (self._countdownId) {
                    self._cancelCountdown();
                    return Clutter.EVENT_STOP;
                }
                if (self._optionsOpen) {
                    self._closeOptionsPopup();
                    return Clutter.EVENT_STOP;
                }
            }
            if (self._optionsOpen && et === Clutter.EventType.BUTTON_PRESS) {
                const [px, py] = event.get_coords();
                const inside = (actor) => {
                    if (!actor?.visible) return false;
                    const [ax, ay] = actor.get_transformed_position();
                    const [aw, ah] = actor.get_transformed_size();
                    return px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;
                };
                if (!inside(self._optionsPopup) && !inside(self._optionsBtn)) {
                    self._closeOptionsPopup();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        ui._syncWindowButtonSensitivity = function() {
            const windows = this._windowSelectors.flatMap(selector => selector.windows());
            this._windowButton.reactive = Main.sessionMode.hasWindows && windows.length > 0;
        };

        ui._onCastButtonToggled = function() {
            if (this._castButton.checked) {
                this._castButton.toggle_mode = false;
                this._captureButton.add_style_pseudo_class('cast');
                this._stageScreenshotContainer.hide();
                this._stageScreenshotContainer.opacity = 0;
            } else {
                this._castButton.toggle_mode = true;
                this._captureButton.remove_style_pseudo_class('cast');
                this._syncWindowButtonSensitivity();
            }
        };

        ui.open = async function(mode = 0) {
            self._cancelCountdown();
            self._closeOptionsPopup(true);
            self._hideTooltip();
            self._isClosingAnim = false;

            // Synchronize pointer button from saved config
            self._state = self._loadPrefs();
            if (this._showPointerButton) {
                this._showPointerButton.checked = self._state.show_cursor;
            }

            // Prepare bar pre-animation state (Spotlight: scale 1.04 -> 1.0 + fade in)
            self._bar.remove_all_transitions();
            self._bar.scale_x = 1.04;
            self._bar.scale_y = 1.04;
            self._bar.translation_y = -6;
            self._bar.opacity = 0;
            self._bar.show();

            const targetIsVideo = (mode === 1) ? true : (self._state.remember_selection ? self._state.last_is_video : false);
            const targetArea = self._state.remember_selection ? self._state.last_target : 'area';

            await self._orig.open.call(this, targetIsVideo ? 1 : 0);

            self._setModeAndTarget(targetIsVideo, targetArea);
            self._applyGlassUniforms();
            self._connectStageSync();

            if (self._toolbarGlass) {
                self._toolbarGlass.show();
                self._toolbarGlass.forceRefresh?.(1);
            }

            self._bar.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                translation_y: 0,
                duration: OPEN_ANIM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    self._bar.scale_x = 1.0;
                    self._bar.scale_y = 1.0;
                    self._bar.translation_y = 0;
                    self._syncGlass();
                },
            });
            self._syncGlass();
        };

        ui.close = function(instantly = false) {
            self._cancelCountdown();
            self._closeOptionsPopup(true);
            self._hideTooltip();

            if (instantly) {
                self._isClosingAnim = false;
                self._disconnectStageSync();
                if (self._toolbarGlass) {
                    self._toolbarGlass.hide();
                    self._toolbarGlass.opacity = 0;
                }
                return self._orig.close.call(this, true);
            }

            // Spotlight close animation: zoom-in slightly (1.0 -> 1.04) + fade out
            self._isClosingAnim = true;
            self._bar.remove_all_transitions();
            self._bar.ease({
                opacity: 0,
                scale_x: 1.04,
                scale_y: 1.04,
                translation_y: -6,
                duration: CLOSE_ANIM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            return self._orig.close.call(this, false);
        };

        ui._finishClosing = function() {
            self._isClosingAnim = false;
            self._disconnectStageSync();
            if (self._toolbarGlass) {
                self._toolbarGlass.hide();
                self._toolbarGlass.opacity = 0;
            }
            if (self._optionsGlass) {
                self._optionsGlass.hide();
                self._optionsGlass.opacity = 0;
            }
            return self._orig.finishClosing.call(this);
        };

        ui._onCaptureButtonClicked = async function() {
            await self._onActionClicked();
        };

        ui.stopScreencast = async function() {
            if (self._stoppingScreencast) return;
            self._stoppingScreencast = true;
            try {
                await self._stopAudioCaptureAndClicks();
                return await self._orig.stopScreencast.call(this);
            } finally {
                self._stoppingScreencast = false;
            }
        };
    }

    async _onActionClicked() {
        if (this._countdownId) {
            this._cancelCountdown();
            return;
        }
        this._closeOptionsPopup(true);
        this._hideTooltip();

        const secMap = { 0: 0, 1: 3, 2: 5, 3: 10 };
        const delaySec = secMap[this._state.timer_delay] ?? 0;
        if (delaySec > 0) {
            this._runCountdown(delaySec);
            return;
        }
        await this._executeCapture();
    }

    _runCountdown(seconds) {
        let remaining = seconds;
        this._countdownLabel.text = `${remaining} ${ssT('sec_short')}`;
        const mon = Main.layoutManager.primaryMonitor;
        if (mon) {
            const [bx, by] = this._bar.get_transformed_position();
            const [bw] = this._bar.get_transformed_size();
            this._countdownBox.show();
            const [, natW] = this._countdownBox.get_preferred_width(-1);
            const [, natH] = this._countdownBox.get_preferred_height(natW);
            this._countdownBox.set_position(
                Math.round((bx - mon.x) + (bw - natW) / 2),
                Math.max(12, Math.round((by - mon.y) - natH - 14))
            );
            this._countdownBox.opacity = 255;
        }
        this._refreshModeButtonsVisual();
        this._styleActionBtn(false);

        this._countdownId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            remaining--;
            if (remaining <= 0) {
                this._countdownId = 0;
                this._countdownBox.hide();
                this._refreshModeButtonsVisual();
                this._styleActionBtn(false);
                this._executeCapture().catch(logError);
                return GLib.SOURCE_REMOVE;
            }
            this._countdownLabel.text = `${remaining} ${ssT('sec_short')}`;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _cancelCountdown() {
        if (this._countdownId) {
            GLib.source_remove(this._countdownId);
            this._countdownId = 0;
        }
        if (this._countdownBox) {
            this._countdownBox.hide();
            this._countdownBox.opacity = 0;
        }
        this._refreshModeButtonsVisual();
        if (this._actionBtn) this._styleActionBtn(false);
    }

    async _executeCapture() {
        const ui = this._ui;
        this._bar.hide();
        if (this._toolbarGlass) this._toolbarGlass.hide();

        if (!this._activeIsVideo) {
            try {
                await ui._saveScreenshot();
            } catch (e) {
                logError(e);
            }
            ui.close(true);
            return;
        }

        await this._executeScreencast();
    }

    _getScreencastGeometry() {
        const ui = this._ui;
        if (this._activeTarget === 'area') {
            return ui._areaSelector.getGeometry();
        }
        if (this._activeTarget === 'window') {
            const win = ui._windowSelectors.flatMap(s => s.windows()).find(w => w.checked);
            if (win?.boundingBox) {
                const b = win.boundingBox;
                const x = Math.max(0, Math.round(b.x));
                const y = Math.max(0, Math.round(b.y));
                const w = Math.max(16, Math.round(b.width));
                const h = Math.max(16, Math.round(b.height));
                return [x, y, w, h, true];
            }
        }
        const index = ui._screenSelectors.findIndex(s => s.checked);
        const monitor = Main.layoutManager.monitors[index >= 0 ? index : Main.layoutManager.primaryIndex];
        return [monitor.x, monitor.y, monitor.width, monitor.height, false];
    }

    async _executeScreencast() {
        const ui = this._ui;
        const [x, y, w, h, isWindow] = this._getScreencastGeometry();
        const isBounded = (this._activeTarget === 'area') || isWindow;

        if (this._activeTarget === 'area' || isWindow) {
            ui._screencastAreaIndicator.setSelectionRect(x, y, w, h);
        } else {
            ui._screencastAreaIndicator.setSelectionRect(x, y, w, h);
        }

        ui.close(true);

        const targetDir = this._resolveSaveDirectory(true);
        const template = GLib.build_filenamev([targetDir, `${ssT('rec_prefix')} %d %t`]);
        const drawCursor = Boolean(this._state.show_cursor);

        // Start optional audio + click ripples
        this._startAudioCaptureIfNeeded();
        this._startClickWatcherIfNeeded();

        ui._screencastPath = null;
        ui._macScreencastFailed = false;
        ui._setScreencastInProgress(true);
        try {
            ui._screencastStarting = true;
            const method = isBounded
                ? ui._screencastProxy.ScreencastAreaAsync.bind(ui._screencastProxy, x, y, w, h)
                : ui._screencastProxy.ScreencastAsync.bind(ui._screencastProxy);
            const [, path] = await method(template, { 'draw-cursor': new GLib.Variant('b', drawCursor) });
            ui._screencastPath = path;
        } catch (err) {
            ui._macScreencastFailed = true;
            await this._stopAudioCaptureAndClicks();
            ui._screencastFailed(0, err);
        } finally {
            delete ui._screencastStarting;
        }
    }

    _startAudioCaptureIfNeeded() {
        if (!this._state.mic_device && !this._state.record_system_audio) {
            this._audioFilePath = null;
            return;
        }
        try {
            const outPath = `/tmp/macw1y_audio_${Date.now()}.wav`;
            const argv = ['python3', '/usr/local/bin/mac-screenshot-process', '--record-audio', '--out', outPath];
            if (this._state.mic_device) {
                argv.push('--mic', this._state.mic_device);
            }
            if (this._state.record_system_audio) {
                argv.push('--system-audio');
            }
            this._audioFilePath = outPath;
            this._audioSubprocess = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (_) {
            this._audioSubprocess = null;
            this._audioFilePath = null;
        }
    }

    async _stopAudioCaptureAndClicks() {
        this._stopClickWatcher();
        if (this._audioSubprocess) {
            const proc = this._audioSubprocess;
            this._audioSubprocess = null;
            try {
                proc.send_signal(2); // SIGINT so WAV/audio file flushes header
                await new Promise(resolve => {
                    const tid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    });
                    proc.wait_async(null, () => {
                        try { GLib.source_remove(tid); } catch (_) {}
                        resolve();
                    });
                });
            } catch (_) {}
        }
    }

    _startClickWatcherIfNeeded() {
        this._stopClickWatcher();
        if (!this._state.show_mouse_clicks) return;
        this._clickWatchId = global.stage.connect('captured-event', (_s, ev) => {
            if (!this._ui?.screencast_in_progress) return Clutter.EVENT_PROPAGATE;
            if (ev.type() === Clutter.EventType.BUTTON_PRESS) {
                const [cx, cy] = ev.get_coords();
                this._spawnClickRing(cx, cy);
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _stopClickWatcher() {
        if (this._clickWatchId) {
            try { global.stage.disconnect(this._clickWatchId); } catch (_) {}
            this._clickWatchId = 0;
        }
    }

    _spawnClickRing(cx, cy) {
        try {
            const ring = new St.Widget({
                reactive: false,
                width: 24,
                height: 24,
                style: 'border-radius: 9999px; border: 2px solid rgba(255, 255, 255, 0.92); background-color: rgba(10, 132, 255, 0.25);',
            });
            ring.set_pivot_point(0.5, 0.5);
            ring.set_position(Math.round(cx - 12), Math.round(cy - 12));
            Main.layoutManager.uiGroup.add_child(ring);
            ring.ease({
                scale_x: 1.9,
                scale_y: 1.9,
                opacity: 0,
                duration: 280,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try { ring.destroy(); } catch (_) {}
                },
            });
        } catch (_) {}
    }

    handleCapturedScreenshot(file) {
        const srcPath = file?.get_path?.();
        if (!srcPath) return null;

        let finalPath = srcPath;
        const targetDir = this._resolveSaveDirectory(false);
        if (targetDir) {
            try {
                const srcFile = Gio.File.new_for_path(srcPath);
                const destPath = this._uniqueFilePath(targetDir, GLib.path_get_basename(srcPath));
                const destFile = Gio.File.new_for_path(destPath);
                srcFile.move(destFile, Gio.FileCopyFlags.NONE, null, null);
                finalPath = destPath;
            } catch (_) {}
        }

        if (this._state.floating_thumbnail) {
            this._showFloatingThumbnail(finalPath);
        }
        return finalPath;
    }

    takeAudioSidecarPath() {
        const p = this._audioFilePath;
        this._audioFilePath = null;
        return p;
    }

    _uniqueFilePath(dir, name) {
        let candidate = GLib.build_filenamev([dir, name]);
        if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) return candidate;
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        for (let i = 1; i < 1000; i++) {
            candidate = GLib.build_filenamev([dir, `${stem}-${i}${ext}`]);
            if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) return candidate;
        }
        return candidate;
    }

    _showFloatingThumbnail(filePath) {
        try {
            if (this._thumbTimeoutId) {
                GLib.source_remove(this._thumbTimeoutId);
                this._thumbTimeoutId = 0;
            }
            if (this._floatingThumb) {
                try { this._floatingThumb.destroy(); } catch (_) {}
                this._floatingThumb = null;
            }
            const mon = Main.layoutManager.primaryMonitor;
            if (!mon || !GLib.file_test(filePath, GLib.FileTest.EXISTS)) return;

            const thumbBtn = new St.Button({
                reactive: true,
                style: 'background-color: rgba(34, 34, 38, 0.88); border: 1px solid rgba(255, 255, 255, 0.24); border-radius: 12px; padding: 5px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);',
            });
            const preview = new St.Bin({
                style: `background-image: url("file://${filePath}"); background-size: cover; background-position: center; width: 156px; height: 96px; border-radius: 8px;`,
            });
            thumbBtn.set_child(preview);
            thumbBtn.set_position(mon.x + mon.width - 186, mon.y + mon.height - 200);
            thumbBtn.opacity = 0;
            Main.layoutManager.uiGroup.add_child(thumbBtn);
            this._floatingThumb = thumbBtn;

            const dismiss = () => {
                if (this._thumbTimeoutId) {
                    GLib.source_remove(this._thumbTimeoutId);
                    this._thumbTimeoutId = 0;
                }
                if (this._floatingThumb === thumbBtn) {
                    this._floatingThumb = null;
                    thumbBtn.ease({
                        opacity: 0,
                        translation_x: 30,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => { try { thumbBtn.destroy(); } catch (_) {} },
                    });
                }
            };

            thumbBtn.connect('clicked', () => {
                try {
                    Gio.app_info_launch_default_for_uri(
                        Gio.File.new_for_path(filePath).get_uri(),
                        global.create_app_launch_context(0, -1)
                    );
                } catch (_) {}
                dismiss();
            });

            thumbBtn.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._thumbTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                this._thumbTimeoutId = 0;
                dismiss();
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {}
    }

    destroy() {
        this._destroyed = true;
        this._cancelCountdown();
        this._disconnectStageSync();
        this._stopAudioCaptureAndClicks().catch(() => {});

        const ui = this._ui;
        if (ui) {
            if (this._monitorsSignalId) {
                try { Main.layoutManager.disconnect(this._monitorsSignalId); } catch (_) {}
                this._monitorsSignalId = 0;
            }
            if (this._capturedSignalId) {
                try { ui.disconnect(this._capturedSignalId); } catch (_) {}
                this._capturedSignalId = 0;
            }
            if (this._orig.open) ui.open = this._orig.open;
            if (this._orig.close) ui.close = this._orig.close;
            if (this._orig.finishClosing) ui._finishClosing = this._orig.finishClosing;
            if (this._orig.onCapture) ui._onCaptureButtonClicked = this._orig.onCapture;
            if (this._orig.onCastToggle) ui._onCastButtonToggled = this._orig.onCastToggle;
            if (this._orig.syncWinSens) ui._syncWindowButtonSensitivity = this._orig.syncWinSens;
            if (this._orig.startScreencast) ui._startScreencast = this._orig.startScreencast;
            if (this._orig.stopScreencast) ui.stopScreencast = this._orig.stopScreencast;

            ui._typeButtonContainer?.show();
            ui._bottomRowContainer?.show();
            if (ui._closeButton) {
                ui._closeButton.show();
                ui._closeButton.opacity = 255;
                ui._closeButton.reactive = true;
            }
            ui._panel.style = this._origPanelStyle || null;
            if (this._origPanelXAlign !== undefined) {
                ui._panel.x_align = this._origPanelXAlign;
            }

            const dashed = ui._areaSelector?._areaIndicator?._selectionRect?._macDashedOverlay;
            if (dashed) {
                try { dashed.destroy(); } catch (_) {}
                delete ui._areaSelector._areaIndicator._selectionRect._macDashedOverlay;
            }
        }

        for (const actor of [this._bar, this._tooltip, this._optionsPopup, this._countdownBox, this._toolbarGlass, this._optionsGlass, this._floatingThumb]) {
            if (actor) {
                try { actor.destroy(); } catch (_) {}
            }
        }
        if (globalThis._macSyncScreenshotStyling) {
            delete globalThis._macSyncScreenshotStyling;
        }
    }
}

let _controller = null;

export function installMacScreenshotUI(extensionDir) {
    if (_controller) return _controller;
    _controller = new MacScreenshotController(extensionDir);
    return _controller;
}

export function getMacScreenshotController() {
    return _controller;
}

export function destroyMacScreenshotUI() {
    if (_controller) {
        _controller.destroy();
        _controller = null;
    }
}
