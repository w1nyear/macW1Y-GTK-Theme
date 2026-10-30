import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { getAppFavorites } from 'resource:///org/gnome/shell/ui/appFavorites.js';
import { _ } from './i18n.js';
import { t, tf } from './mac_i18n.js';
import { applyGradientBlurFade } from './gradientBlurFade.js';

const RECENT_ITEMS_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const CLIPBOARD_CACHE_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'mac-clipboard', 'history.json']);
const ICONS_DIR = '/home/vitaliy/macW1Y/icons';

const SEARCH_DEBOUNCE_MS = 180;
const DIALOG_WIDTH = 714;
const PILL_HEIGHT = 54;        // згорнута пілюля (не змінюємо — як було)
const EXP_PILL_HEIGHT = 54;    // шапка розгорнутого меню — 54px, ідентична згорнутій пілюлі
const COLLAPSED_PILL_WIDTH = 480;
const BUTTONS_BOX_WIDTH = 192;
const BUTTON_SIZE = 50;
const CORNER_RADIUS = 26;
const EDGE_STYLE = '1px solid rgba(255, 255, 255, 0.30)';

const APPS_CATEGORIES = [
    {
        id: 'utility',
        get label() { return t('category_utilities', 'Утиліти'); },
        match: ['utility', 'system', 'settings', 'terminalemulator', 'terminal', 'filemanager', 'archiving', 'monitor', 'security', 'clock', 'calculator', 'preferences', 'help', 'desktopsettings']
    },
    {
        id: 'communication',
        get label() { return t('category_communication', 'Спілкування'); },
        match: ['network', 'chat', 'instantmessaging', 'email', 'feed', 'webbrowser', 'ircclient', 'telephony', 'contactmanagement', 'social', 'news']
    },
    {
        id: 'productivity',
        get label() { return t('category_productivity', 'Продуктивність'); },
        match: ['office', 'development', 'texteditor', 'ide', 'editor', 'graphics', 'audiovideo', 'audio', 'video', 'photography', 'publishing', 'viewer', 'documentation', 'audiovideoediting', 'database']
    },
    {
        id: 'other',
        get label() { return t('category_other', 'Інше'); },
        match: []
    }
];

const APPS_COLUMNS = 7;
const APPS_COLUMN_WIDTH = 94;
const APPS_ICON_SIZE = 52;

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = Math.max(0, now - timestamp);
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    if (diff < 60000) {
        return t('copied_just_now', 'Copied just now');
    }
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return tf('copied_time', { time: `${hh}:${mm}` }, `Copied ${hh}:${mm}`);
    }
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return tf('yesterday_time', { time: `${hh}:${mm}` }, `Yesterday, ${hh}:${mm}`);
    }
    try {
        const dt = GLib.DateTime.new_from_unix_local(Math.floor(timestamp / 1000));
        if (dt) return dt.format('%d %b %H:%M');
    } catch (_) {}
    return `${date.getDate()} ${hh}:${mm}`;
}

const PILL_COLLAPSED_STYLE =
    'height: 54px; min-height: 54px; padding: 0 16px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
    'border-radius: 27px; ' +
    'box-shadow: none !important;';

const PILL_EXPANDED_STYLE =
    'height: 54px; min-height: 54px; padding: 0 16px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
    'border-radius: 26px; ' +
    'box-shadow: none !important;';

const _gobjectToString = GObject.Object.prototype.toString;

function applyActorSmoothing(actor) {
    if (!actor) return actor;
    try {
        if (typeof actor.set_content_scaling_filters === 'function') {
            actor.set_content_scaling_filters(
                Clutter.ScalingFilter.TRILINEAR,
                Clutter.ScalingFilter.LINEAR
            );
        }
    } catch (_) {}

    try {
        if (typeof actor.connect === 'function') {
            actor.connect('notify::content', () => {
                try {
                    actor.set_content_scaling_filters(
                        Clutter.ScalingFilter.TRILINEAR,
                        Clutter.ScalingFilter.LINEAR
                    );
                } catch (_) {}
            });
            actor.connect('child-added', (_, child) => {
                applyActorSmoothing(child);
            });
        }
    } catch (_) {}

    try {
        if (typeof actor.get_children === 'function') {
            actor.get_children().forEach(applyActorSmoothing);
        }
    } catch (_) {}

    return actor;
}

function createSmoothAppIcon(app, targetSize = 32) {
    let icon = null;
    try {
        let shellApp = app;
        if (shellApp && typeof shellApp.create_icon_texture !== 'function' && typeof shellApp.get_id === 'function') {
            const id = shellApp.get_id();
            if (id) {
                shellApp = Shell.AppSystem.get_default().lookup_app(id);
            }
        }
        if (typeof shellApp?.create_icon_texture === 'function') {
            icon = shellApp.create_icon_texture(targetSize);
        }
    } catch (_) {}

    if (!icon) {
        let gicon = null;
        try {
            gicon = app?.get_icon?.() || null;
        } catch (_) {}
        if (gicon) {
            icon = new St.Icon({
                gicon,
                icon_size: targetSize,
            });
        } else {
            icon = new St.Icon({
                icon_name: 'application-x-executable',
                icon_size: targetSize,
            });
        }
    }

    icon.set_size(targetSize, targetSize);
    icon.x_align = Clutter.ActorAlign.CENTER;
    icon.y_align = Clutter.ActorAlign.CENTER;

    applyActorSmoothing(icon);
    return icon;
}

function _isActorValid(actor) {
    if (!actor) return false;
    try {
        const desc = _gobjectToString.call(actor);
        if (desc.includes('(DISPOSED)') || desc.includes('(FINALIZED)')) return false;
        if (actor._cleanedUp) return false;
        return typeof actor.visible === 'boolean';
    } catch (_) {
        return false;
    }
}

function _isGlassAlive(glass) {
    if (!glass) return false;
    try {
        const desc = _gobjectToString.call(glass);
        if (desc.includes('(DISPOSED)') || desc.includes('(FINALIZED)')) return false;
        if (glass._cleanedUp || glass.is_finalized?.()) return false;
        return typeof glass.visible === 'boolean';
    } catch (_) {
        return false;
    }
}

// Меню відкриваються строго на своєму фіксованому місці з нативним масштабуванням (1.12 -> 1.0) без зсувів і підстрибувань
function _saveMorphFrom() {
    try {
        globalThis._macMorphFrom = null;
    } catch (_) {}
}

function _consumeMorphFrom() {
    try {
        globalThis._macMorphFrom = null;
        return null;
    } catch (_) {
        return null;
    }
}

const BTN_NORMAL_STYLE =
    'width: 50px; min-width: 50px; height: 50px; min-height: 50px; ' +
    'border-radius: 26px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: 1px solid rgba(255, 255, 255, 0.30) !important; ' +
    'box-shadow: none !important;';

const BTN_HOVER_STYLE =
    'width: 50px; min-width: 50px; height: 50px; min-height: 50px; ' +
    'border-radius: 26px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: 1px solid rgba(255, 255, 255, 0.30) !important; ' +
    'box-shadow: none !important;';

const SETTINGS_PANELS = [
    { key: 'panel_wifi', fallback: 'Wi-Fi', match: ['wifi', 'вайфай', 'вай-фай', 'мережа', 'wi-fi', 'wlan', 'internet'], panel: 'wifi' },
    { key: 'panel_network', fallback: 'Мережа', match: ['network', 'мережа', 'сеть', 'ethernet', 'інтернет', 'lan', 'sieć', 'red'], panel: 'network' },
    { key: 'panel_bluetooth', fallback: 'Bluetooth', match: ['bluetooth', 'блютуз', 'bt'], panel: 'bluetooth' },
    { key: 'panel_appearance', fallback: 'Зовнішній вигляд', match: ['appearance', 'зовнішній вигляд', 'внешний вид', 'тема', 'шпалери', 'обои', 'background', 'dark', 'wygląd', 'aspecto'], panel: 'appearance' },
    { key: 'panel_notifications', fallback: 'Сповіщення', match: ['notifications', 'сповіщення', 'уведомления', 'alerts', 'powiadomienia', 'notificaciones'], panel: 'notifications' },
    { key: 'panel_search', fallback: 'Пошук', match: ['search', 'пошук', 'поиск', 'spotlight', 'szukaj', 'buscar'], panel: 'search' },
    { key: 'panel_applications', fallback: 'Програми', match: ['applications', 'програми', 'приложения', 'apps', 'aplikacje', 'aplicaciones'], panel: 'applications' },
    { key: 'panel_privacy', fallback: 'Конфіденційність', match: ['privacy', 'конфіденційність', 'конфиденциальность', 'безпека', 'безопасность', 'security', 'prywatność', 'privacidad'], panel: 'privacy' },
    { key: 'panel_sound', fallback: 'Звук', match: ['sound', 'audio', 'звук', 'гучність', 'громкость', 'мікрофон', 'volume', 'dźwięk', 'sonido'], panel: 'sound' },
    { key: 'panel_power', fallback: 'Живлення', match: ['power', 'живлення', 'питание', 'акумулятор', 'батарея', 'енергозбереження', 'энергосбережение', 'battery', 'zasilanie', 'batería'], panel: 'power' },
    { key: 'panel_displays', fallback: 'Дисплеї', match: ['displays', 'display', 'дисплей', 'екран', 'экран', 'монітор', 'монитор', 'роздільність', 'screen', 'ekrany', 'pantallas'], panel: 'display' },
    { key: 'panel_mouse', fallback: 'Миша та трекпад', match: ['mouse', 'touchpad', 'миша', 'мышь', 'трекпад', 'тачпад', 'cursor', 'mysz', 'ratón'], panel: 'mouse' },
    { key: 'panel_keyboard', fallback: 'Клавіатура', match: ['keyboard', 'клавіатура', 'клавиатура', 'мова', 'язык', 'розкладка', 'input', 'klawiatura', 'teclado'], panel: 'keyboard' },
    { key: 'panel_printers', fallback: 'Принтери', match: ['printers', 'принтери', 'принтеры', 'друк', 'печать', 'print', 'drukarki', 'impresoras'], panel: 'printers' },
    { key: 'panel_accessibility', fallback: 'Спеціальні можливості', match: ['accessibility', 'спеціальні можливості', 'специальные возможности', 'доступність', 'a11y', 'dostępność', 'accesibilidad'], panel: 'universal-access' },
    { key: 'panel_datetime', fallback: 'Дата й час', match: ['datetime', 'date', 'time', 'дата', 'час', 'время', 'годинник', 'clock', 'data', 'fecha'], panel: 'datetime' },
    { key: 'panel_about', fallback: 'Про систему', match: ['about', 'про систему', 'о системе', 'характеристики', 'система', 'info', 'informacje', 'sistema'], panel: 'about' },
];

function getDocSvgForExt(ext) {
    const e = (ext || '').toLowerCase();
    switch (e) {
        case 'png':
            return `${ICONS_DIR}/mac-doc-png.svg`;
        case 'jpg':
        case 'jpeg':
            return `${ICONS_DIR}/mac-doc-jpeg.svg`;
        case 'svg':
            return `${ICONS_DIR}/mac-doc-svg.svg`;
        case 'webp':
            return `${ICONS_DIR}/mac-doc-webp.svg`;
        case 'pdf':
            return `${ICONS_DIR}/mac-doc-pdf.svg`;
        case 'docx':
        case 'doc':
            return `${ICONS_DIR}/mac-doc-docx.svg`;
        case 'xlsx':
        case 'xls':
            return `${ICONS_DIR}/mac-doc-xlsx.svg`;
        case 'pages':
            return `${ICONS_DIR}/mac-doc-pages.svg`;
        case 'zip':
            return `${ICONS_DIR}/mac-doc-zip.svg`;
        case 'tar':
        case 'gz':
        case '7z':
            return `${ICONS_DIR}/mac-doc-tar.svg`;
        case 'mp4':
        case 'mkv':
        case 'avi':
            return `${ICONS_DIR}/mac-doc-mp4.svg`;
        case 'mov':
            return `${ICONS_DIR}/mac-doc-mov.svg`;
        case 'txt':
        case 'md':
        case 'py':
        case 'js':
        case 'ts':
        case 'sh':
            return `${ICONS_DIR}/mac-doc-txt.svg`;
        default:
            return `${ICONS_DIR}/mac-doc-generic.svg`;
    }
}

function getFileCategory(ext) {
    const e = (ext || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp'].includes(e)) return 'preview';
    if (['docx', 'doc', 'pages', 'odt', 'rtf', 'xlsx', 'xls', 'numbers', 'pptx', 'key'].includes(e)) return 'pages';
    if (e === 'pdf') return 'pdf';
    if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'mp3', 'wav', 'flac'].includes(e)) return 'video';
    if (['txt', 'md', 'js', 'ts', 'py', 'sh', 'json', 'css', 'html', 'xml', 'conf'].includes(e)) return 'text';
    return 'other';
}

function createVectorIcon(name, size = 24) {
    const customPath = `${ICONS_DIR}/${name}.svg`;
    if (GLib.file_test(customPath, GLib.FileTest.EXISTS)) {
        const file = Gio.File.new_for_path(customPath);
        return new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            icon_size: size,
        });
    }
    return new St.Icon({
        icon_name: name,
        icon_size: size,
    });
}

function openFileDirectly(uri) {
    if (!uri) return;
    try {
        const gfile = Gio.File.new_for_uri(uri);
        const path = gfile.get_path();
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) {
            Util.spawn(['gio', 'open', path]);
            return;
        }
    } catch (_) {}
    try {
        Gio.AppInfo.launch_default_for_uri(uri, null);
    } catch (_) {
        try {
            Util.spawn(['xdg-open', uri]);
        } catch (e) {
            console.error(`[Spotlight] Failed to open ${uri}: ${e}`);
        }
    }
}

export const MacSpotlightDialog = GObject.registerClass({
    GTypeName: `MacSpotlightDialog_${Math.floor(Math.random() * 1000000)}`,
}, class MacSpotlightDialog extends Clutter.Actor {
    _init() {
        super._init({
            name: 'mac-spotlight-wrapper',
            reactive: true,
            visible: false,
        });

        this._isOpen = false;
        this._isAnimating = false;
        this._isCollapsing = false;
        this._mode = 'search'; // 'search' | 'files' | 'apps' | 'clipboard'
        this._buttonsCollapsed = false;
        this._activeFilter = null; // null | 'preview' | 'pages' | 'pdf' | 'video' | 'text'
        this._selectedAppsCategory = null;
        this._appsCategoryButtons = [];

        this._appSystem = Shell.AppSystem.get_default();
        this._resultButtons = [];
        this._selectedIndex = -1;
        this._debounceId = 0;
        this._lastQuery = '';
        this._modalGrab = null;
        this._superOnlyPressed = false;
        this._inputSwitched = false;

        // 1. Transparent Backdrop Click-Catcher (No screen dimming)
        this._backdrop = new Clutter.Actor({
            name: 'mac-spotlight-backdrop',
            reactive: true,
            visible: false,
        });
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._backdrop);

        if (Main.overview) {
            Main.overview.connectObject('showing', () => {
                this.close(true);
            }, this);
        }

        // 2. Main Floating Spotlight Container (Pure Glass overlay)
        this._box = new St.BoxLayout({
            name: 'mac-spotlight-box',
            style_class: 'mac-spotlight-box',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            clip_to_allocation: false,
        });
        this._box.set_style(
            'background-color: transparent !important; ' +
            'background: none !important; ' +
            `border-radius: ${CORNER_RADIUS}px !important; ` +
            'border: none !important; ' +
            'box-shadow: none !important;'
        );
        this._box.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.add_child(this._box);
        this._syncLoopId = 0;
        this._isClosing = false;
        this._glassSyncQueued = false;
        this._appsDefaultLoaded = false;
        try {
            this._appSystem.connect('installed-changed', () => {
                this._appsDefaultLoaded = false;
            });
        } catch (_) {}

        const reqSync = () => this._requestGlassSync();
        this._box.connect('notify::height', reqSync);
        this._box.connect('notify::width', reqSync);
        this._box.connect('notify::x', reqSync);
        this._box.connect('notify::y', reqSync);
        this._box.connect('notify::scale-x', reqSync);
        this._box.connect('notify::scale-y', reqSync);
        this._box.connect('notify::translation-x', reqSync);
        this._box.connect('notify::translation-y', reqSync);
        this._box.connect('notify::opacity', reqSync);

        this.connect('destroy', () => {
            this._onDestroy();
        });

        this._glass = null;
        this._initializingGlass = false;
        this._stageSignalId = 0;
        this._cachedRecentFiles = null;
        this._cachedRecentFilesTime = 0;

        try {
            this._systemModalSignalId = Main.layoutManager.connect('system-modal-opened', () => {
                if (this._isOpen) this.close(true);
            });
            if (Main.screenshotUI) {
                this._screenshotSignalId = Main.screenshotUI.connect('open-state-changed', (_ui, open) => {
                    if (open && this._isOpen) this.close(true);
                });
            }
        } catch (_) {}

        // 3. Top Row Container: Contains Search Pill + 3 Circular Action Buttons
        this._topRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'height: 54px; min-height: 54px;',
            clip_to_allocation: false,
        });
        this._box.add_child(this._topRow);

        // 3A. Search Pill (Width: 480px collapsed, 714px expanded)
        this._searchPill = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            width: COLLAPSED_PILL_WIDTH,
            style: PILL_COLLAPSED_STYLE,
        });
        this._searchPill.connect('notify::width', reqSync);
        this._topRow.add_child(this._searchPill);

        this._searchIcon = new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 20,
            style: 'color: rgba(255, 255, 255, 0.65); margin-left: 4px; margin-right: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        this._searchIcon.connect('button-press-event', () => {
            if (this._mode !== 'search') {
                this._setMode('search');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._searchIcon.connect('notify::hover', () => {
            if (this._mode !== 'search') {
                this._searchIcon.opacity = this._searchIcon.hover ? 255 : 200;
            } else {
                this._searchIcon.opacity = 255;
            }
        });
        this._searchPill.add_child(this._searchIcon);

        this._entry = new St.Entry({
            style_class: 'mac-spotlight-entry',
            style: 'font-size: 19px !important; font-weight: 500 !important; color: #ffffff !important; ' +
                   'hint-text-color: #ffffff !important; ' +
                   'text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; ' +
                   'background-color: transparent !important; background: none !important; ' +
                   'border: none !important; box-shadow: none !important; outline: none !important;',
            hint_text: t('spotlight_search', 'Пошук Spotlight'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (this._entry.clutter_text?.set_single_line_mode) {
            this._entry.clutter_text.set_single_line_mode(true);
        }
        if (this._entry.clutter_text) {
            try {
                if (typeof Clutter.Color === 'function')
                    this._entry.clutter_text.set_color(new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 }));
            } catch (_) {}
        }
        this._searchPill.add_child(this._entry);

        // Options Button `...` (more options button on right of search pill, visible in 'files' mode)
        this._optionsBtn = new St.Button({
            style: 'width: 32px; height: 32px; border-radius: 16px; background-color: transparent; margin-right: 2px;',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            reactive: true,
            can_focus: true,
        });
        const optionsLbl = new St.Label({
            text: '•••',
            style: 'font-size: 11px; font-weight: bold; color: #ffffff; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._optionsBtn.set_child(optionsLbl);
        this._optionsBtn.connect('clicked', () => {
            if (this._mode === 'files') {
                this._loadFilesView();
            } else if (this._mode === 'apps') {
                this._appsDefaultLoaded = false;
                this._selectedAppsCategory = null;
                this._buildAppsCategoryButtons();
                this._loadAppsView();
            } else if (this._mode === 'clipboard') {
                if (globalThis.macClipboardStore) {
                    globalThis.macClipboardStore.clear();
                    this._loadClipboardView();
                }
            }
        });
        this._searchPill.add_child(this._optionsBtn);

        // Вирівнювання вмісту пілюлі строго по середині висоти
        try {
            this._searchIcon.translation_y = 0;
            this._entry.translation_y = 0;
            this._optionsBtn.translation_y = 0;
        } catch (_) {}

        // 3B. Buttons Container: Holds the 3 Circular Buttons on the right
        this._buttonsBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;',
            clip_to_allocation: false,
        });
        this._topRow.add_child(this._buttonsBox);

        // Button 1: Центр програм (App Store 'A' icon) - expands to Apps view inside Spotlight
        this._btnApps = this._createCircleButton('mac-spotlight-apps', t('applications', 'Центр програм'), () => {
            this._setMode(this._mode === 'apps' ? 'search' : 'apps');
        });
        this._buttonsBox.add_child(this._btnApps);

        // Gap 10px
        const gap1 = new St.Widget({ width: 10, height: 1 });
        this._buttonsBox.add_child(gap1);

        // Button 2: Файли (Folder icon) - expands to Files view inside Spotlight
        this._btnFiles = this._createCircleButton('mac-spotlight-files', t('files', 'Файли'), () => {
            this._setMode(this._mode === 'files' ? 'search' : 'files');
        });
        this._buttonsBox.add_child(this._btnFiles);

        // Gap 10px
        const gap2 = new St.Widget({ width: 10, height: 1 });
        this._buttonsBox.add_child(gap2);

        // Button 3: Буфер обміну (Clipboard icon) - expands to Clipboard view inside Spotlight
        this._btnClipboard = this._createCircleButton('mac-spotlight-clipboard', t('clipboard', 'Буфер обміну'), () => {
            this._setMode(this._mode === 'clipboard' ? 'search' : 'clipboard');
        });
        this._buttonsBox.add_child(this._btnClipboard);

        // 4. Results Wrapper: hosts views for Search, Files, Apps, Clipboard
        this._resultsWrapper = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
            opacity: 0,
        });
        this._box.add_child(this._resultsWrapper);

        // 4A. Search Results View
        this._searchView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: true,
        });
        this._resultsWrapper.add_child(this._searchView);

        this._divider = new St.Widget({
            style_class: 'mac-spotlight-divider',
            style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.12); margin: 2px 20px 8px 20px;',
        });
        this._searchView.add_child(this._divider);

        this._scrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._searchView.add_child(this._scrollWrapper);

        this._scrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 460px;',
        });
        this._scrollWrapper.add_child(this._scrollView);
        applyGradientBlurFade(this._scrollWrapper, 44.0, 72.0, this._scrollView);

        this._resultsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0 18px 20px 10px;',
        });
        this._scrollView.add_child(this._resultsBox);

        this._bottomFade = new St.Widget({
            style: 'background: none !important; background-color: transparent !important;',
            height: 0,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
        });
        this._scrollWrapper.add_child(this._bottomFade);

        // 4B. Files View (Image 2 Redesign)
        this._filesView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._resultsWrapper.add_child(this._filesView);

        // Category filter capsules row
        this._filterPillsRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'padding: 4px 18px 12px 18px;',
        });
        this._filesView.add_child(this._filterPillsRow);
        this._initFilterPills();

        this._filesScrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            style: 'max-height: 414px;',
        });
        this._filesView.add_child(this._filesScrollWrapper);

        this._filesScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 414px;',
        });
        this._filesScrollWrapper.add_child(this._filesScrollView);
        applyGradientBlurFade(this._filesScrollWrapper, 44.0, 72.0, this._filesScrollView);

        this._filesContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0 18px 20px 18px;',
        });
        this._filesScrollView.add_child(this._filesContentBox);

        // 4C. Apps View (Dock Applications Menu Authenticity - Photo 1)
        this._appsView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._resultsWrapper.add_child(this._appsView);

        // Header Divider under top search bar
        this._appsDivider = new St.Widget({
            x_expand: true,
            style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.10); margin: 0 18px 10px 18px;',
        });
        this._appsView.add_child(this._appsDivider);

        // Category Filter Bar (4 rounded pills matching reference photo 1)
        this._appsCategoryRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'height: 32px; margin-bottom: 12px; margin-left: 18px; margin-right: 18px;',
        });
        this._appsView.add_child(this._appsCategoryRow);
        this._buildAppsCategoryButtons();

        this._appsScrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            style: 'height: 418px; min-height: 418px; max-height: 418px;',
        });
        this._appsView.add_child(this._appsScrollWrapper);

        this._appsScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'height: 418px; min-height: 418px; max-height: 418px;',
        });
        this._appsScrollWrapper.add_child(this._appsScrollView);
        applyGradientBlurFade(this._appsScrollWrapper, 48.0, 76.0, this._appsScrollView);

        this._appsContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0 14px 20px 14px;',
        });
        this._appsScrollView.add_child(this._appsContentBox);

        // 4D. Clipboard View
        this._clipboardView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._resultsWrapper.add_child(this._clipboardView);

        this._clipboardScrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            style: 'max-height: 460px;',
        });
        this._clipboardView.add_child(this._clipboardScrollWrapper);

        this._clipboardScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 460px;',
        });
        this._clipboardScrollWrapper.add_child(this._clipboardScrollView);
        applyGradientBlurFade(this._clipboardScrollWrapper, 44.0, 72.0, this._clipboardScrollView);

        this._clipboardContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 10px 18px 20px 18px;',
        });
        this._clipboardScrollView.add_child(this._clipboardContentBox);

        // 5. Connect Input & Keyboard Signals
        const ct = this._entry.clutter_text;
        ct.connect('text-changed', () => {
            const text = this._entry.get_text() || '';
            const hasText = text.trim().length > 0;
            if (this._mode === 'search') {
                if (hasText && !this._buttonsCollapsed) {
                    this._collapseButtonsAndExpandPill();
                } else if (!hasText && this._buttonsCollapsed) {
                    this._uncollapseButtonsAndContractPill();
                }
            }
            this._scheduleSearch();
        });
        ct.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
            const isSuper = (state & (Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK)) !== 0;

            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                this._superOnlyPressed = true;
                this._inputSwitched = false;
                return Clutter.EVENT_STOP;
            }

            this._superOnlyPressed = false;

            if (isSuper && symbol === Clutter.KEY_space) {
                this._inputSwitched = true;
                globalThis._lastInputSwitchTime = GLib.get_monotonic_time();
                const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
                try {
                    if (globalThis._macInputSwitcherInstance) {
                        globalThis._macInputSwitcherInstance._handleSwitch(null, null, event, {
                            is_reversed: () => isShift,
                            get_name: () => 'switch-input-source',
                            get_mask: () => state
                        });
                    } else {
                        Main.panel.statusArea.keyboard?._inputSourceManager?._modifiersSwitcher();
                    }
                } catch (_) {}
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Escape) {
                if (this._mode !== 'search') {
                    this._setMode('search');
                    return Clutter.EVENT_STOP;
                }
                this.close();
                return Clutter.EVENT_STOP;
            }

            if (isCtrl && symbol === Clutter.KEY_space) {
                this.close();
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_BackSpace && this._mode !== 'search' && this._entry.text.length === 0) {
                this._setMode('search');
                return Clutter.EVENT_STOP;
            }

            if (this._mode === 'search') {
                if (symbol === Clutter.KEY_Down) {
                    this._moveSelection(1);
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Up) {
                    this._moveSelection(-1);
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    this._activateCurrent();
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        });

        ct.connect('key-release-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                const now = GLib.get_monotonic_time();
                const switchedRecently = this._inputSwitched || ((now - (globalThis._lastInputSwitchTime || 0)) < 2000000);
                const wasSuperOnly = this._superOnlyPressed && !switchedRecently;

                this._superOnlyPressed = false;
                this._inputSwitched = false;

                if (switchedRecently) {
                    return Clutter.EVENT_STOP;
                }

                if (wasSuperOnly) {
                    this.close(true);
                    Main.overview.show();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_space) {
                const now = GLib.get_monotonic_time();
                if (this._inputSwitched || ((now - (globalThis._lastInputSwitchTime || 0)) < 2000000)) {
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        });

        this._initializingGlass = false;
        this._initGlassPromise = this._initGlass().catch(() => {});
    }

    _createCircleButton(iconName, tooltipText, onClick) {
        const btn = new St.Button({
            style: BTN_NORMAL_STYLE,
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = createVectorIcon(iconName, 22);
        icon.style = 'color: rgba(255, 255, 255, 0.88);';
        btn.set_child(icon);

        btn.connect('notify::hover', () => {
            btn.set_style(btn.hover ? BTN_HOVER_STYLE : BTN_NORMAL_STYLE);
            try { this._syncGlass(); } catch (_) {}
        });

        btn.connect('clicked', () => {
            onClick?.();
        });

        return btn;
    }

    _buildAppsCategoryButtons() {
        if (!this._appsCategoryRow) return;
        this._appsCategoryRow.destroy_all_children();
        this._appsCategoryButtons = [];

        APPS_CATEGORIES.forEach(cat => {
            const isSelected = (this._selectedAppsCategory === cat.id);
            const btn = new St.Button({
                style_class: 'mac-category-pill',
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const pillBg = isSelected ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.12)';
            const pillBorder = 'border: none !important;';
            const pillShadow = isSelected ? 'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);' : 'box-shadow: none;';
            btn.set_style(
                `background-color: ${pillBg}; ` +
                'color: #ffffff !important; ' +
                `${pillBorder} ` +
                `${pillShadow} ` +
                'border-radius: 10px; ' +
                'height: 32px; ' +
                'margin: 0 4px; ' +
                'font-size: 13px; ' +
                'font-weight: 600;'
            );

            const label = new St.Label({
                text: cat.label,
                style: 'color: #ffffff !important; font-weight: 600 !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(label);

            btn.connect('clicked', () => {
                if (this._selectedAppsCategory === cat.id) {
                    this._selectedAppsCategory = null;
                } else {
                    this._selectedAppsCategory = cat.id;
                }
                this._buildAppsCategoryButtons();
                this._loadAppsView(this._entry.text.trim());
            });

            btn.connect('notify::hover', () => {
                const hover = btn.hover;
                const active = (this._selectedAppsCategory === cat.id);
                if (active) {
                    btn.set_style(
                        'background-color: rgba(255, 255, 255, 0.32); ' +
                        'border: none !important; ' +
                        'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); ' +
                        'color: #ffffff !important; border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 600;'
                    );
                } else {
                    const bg = hover ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.12)';
                    btn.set_style(
                        `background-color: ${bg}; ` +
                        'border: none !important; ' +
                        'box-shadow: none; ' +
                        'color: #ffffff !important; border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 600;'
                    );
                }
            });

            this._appsCategoryRow.add_child(btn);
            this._appsCategoryButtons.push(btn);
        });
    }

    _getAppCategory(app) {
        const info = app.get_app_info?.() || app;
        let catStr = '';
        try {
            catStr = (info.get_categories?.() || '').toLowerCase();
        } catch (_) {}

        const priorityOrder = ['communication', 'productivity', 'utility'];
        for (const catId of priorityOrder) {
            const cat = APPS_CATEGORIES.find(c => c.id === catId);
            if (!cat) continue;
            for (const m of cat.match) {
                if (catStr.includes(m)) {
                    return cat.id;
                }
            }
        }
        return 'other';
    }

    _getAllApps() {
        const installed = this._appSystem.get_installed() || [];
        const seen = new Set();
        const apps = [];

        for (const info of installed) {
            const id = info.get_id?.();
            if (!id || seen.has(id) || id === 'launchpad.desktop' || id === 'wine.desktop' || id === 'winetricks.desktop' || id.startsWith('winecfg') || id.startsWith('wine-wineboot')) continue;
            if (info.get_nodisplay?.()) continue;
            if (info.should_show && !info.should_show()) continue;
            seen.add(id);

            const app = this._appSystem.lookup_app(id);
            if (app && app.get_name?.()) {
                apps.push(app);
            }
        }

        return apps;
    }

    _getRecentApps(allApps) {
        let usage = null;
        try { usage = Shell.AppUsage.get_default(); } catch (_) {}
        const mostUsed = usage?.get_most_used?.() || [];
        const recent = [];
        const seen = new Set();

        for (const app of mostUsed) {
            const id = app?.get_id?.();
            if (id && id !== 'launchpad.desktop' && allApps.some(a => a.get_id() === id)) {
                if (!seen.has(id)) {
                    seen.add(id);
                    recent.push(app);
                    if (recent.length >= APPS_COLUMNS) break;
                }
            }
        }

        if (recent.length < APPS_COLUMNS) {
            try {
                const favs = getAppFavorites().getFavorites();
                for (const app of favs) {
                    const id = app?.get_id?.();
                    if (id && id !== 'launchpad.desktop' && !seen.has(id) && allApps.some(a => a.get_id() === id)) {
                        seen.add(id);
                        recent.push(app);
                        if (recent.length >= APPS_COLUMNS) break;
                    }
                }
            } catch (_) {}
        }

        if (recent.length < APPS_COLUMNS) {
            for (const app of allApps) {
                const id = app.get_id();
                if (!seen.has(id)) {
                    seen.add(id);
                    recent.push(app);
                    if (recent.length >= APPS_COLUMNS) break;
                }
            }
        }

        return recent.slice(0, APPS_COLUMNS);
    }

    _filterApps(query) {
        const allApps = this._getAllApps();
        const q = (query || '').toLowerCase().trim();
        const category = this._selectedAppsCategory;

        if (q) {
            return allApps.filter(app => {
                const name = (app.get_name() || '').toLowerCase();
                const desc = (app.get_description?.() || '').toLowerCase();
                const exec = (app.get_executable?.() || '').toLowerCase();
                const id = (app.get_id() || '').toLowerCase();
                let keywords = '';
                try {
                    const info = app.get_app_info?.();
                    keywords = (info?.get_keywords?.() || []).join(' ').toLowerCase();
                } catch (_) {}

                const matchesQuery = name.includes(q) ||
                                     desc.includes(q) ||
                                     exec.includes(q) ||
                                     id.includes(q) ||
                                     keywords.includes(q);

                if (!matchesQuery) return false;
                if (category && this._getAppCategory(app) !== category) return false;
                return true;
            }).sort((a, b) => a.get_name().localeCompare(b.get_name()));
        }

        if (category) {
            return allApps.filter(app => this._getAppCategory(app) === category)
                          .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        }

        const recentApps = this._getRecentApps(allApps);
        const recentIds = new Set(recentApps.map(a => a.get_id()));

        const remaining = allApps
            .filter(a => !recentIds.has(a.get_id()))
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        return [...recentApps, ...remaining];
    }

    _initFilterPills() {
        const filters = [
            { id: 'preview', label: 'Перегляд' },
            { id: 'pages', label: 'Pages' },
            { id: 'pdf', label: 'PDF' },
            { id: 'video', label: 'QuickTime Player' },
            { id: 'text', label: 'TextEdit' },
        ];

        this._filterButtons = [];
        for (const f of filters) {
            const btn = new St.Button({
                style: 'background-color: rgba(255, 255, 255, 0.12); ' +
                       'border-radius: 14px; ' +
                       'padding: 5px 14px; ' +
                       'margin-right: 8px;',
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const lbl = new St.Label({
                text: f.label,
                style: 'font-size: 13px; font-weight: 600; color: #ffffff !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);',
            });
            btn.set_child(lbl);

            btn.connect('clicked', () => {
                if (this._activeFilter === f.id) {
                    this._activeFilter = null;
                } else {
                    this._activeFilter = f.id;
                }
                this._updateFilterPillsStyle();
                this._loadFilesView();
            });

            btn.connect('notify::hover', () => {
                if (btn.hover && this._activeFilter !== f.id) {
                    btn.set_style(
                        'background-color: rgba(255, 255, 255, 0.22); ' +
                        'border-radius: 14px; ' +
                        'padding: 5px 14px; ' +
                        'margin-right: 8px;'
                    );
                } else if (!btn.hover && this._activeFilter !== f.id) {
                    btn.set_style(
                        'background-color: rgba(255, 255, 255, 0.12); ' +
                        'border-radius: 14px; ' +
                        'padding: 5px 14px; ' +
                        'margin-right: 8px;'
                    );
                }
            });

            btn._filterId = f.id;
            btn._label = lbl;
            this._filterButtons.push(btn);
            this._filterPillsRow.add_child(btn);
        }
    }

    _updateFilterPillsStyle() {
        for (const btn of this._filterButtons) {
            if (this._activeFilter === btn._filterId) {
                btn.set_style(
                    'background-color: rgba(255, 255, 255, 0.35); ' +
                    'border-radius: 14px; ' +
                    'padding: 5px 14px; ' +
                    'margin-right: 8px;'
                );
                btn._label.set_style('font-size: 13px; font-weight: 700; color: #ffffff !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);');
            } else {
                btn.set_style(
                    'background-color: rgba(255, 255, 255, 0.12); ' +
                    'border-radius: 14px; ' +
                    'padding: 5px 14px; ' +
                    'margin-right: 8px;'
                );
                btn._label.set_style('font-size: 13px; font-weight: 600; color: #ffffff !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);');
            }
        }
    }

    _getThemeParams() {
        let isDark = true;
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
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
        const tintR = isDark ? 0.16 : 1.0;
        const tintG = isDark ? 0.16 : 1.0;
        const tintB = isDark ? 0.18 : 1.0;
        const tintVal = isDark ? 0.16 : 1.0;
        const tintStrength = isDark ? 0.12 : 0.08;
        return { isDark, tintR, tintG, tintB, tintVal, tintStrength };
    }

    _applyGlassUniforms() {
        if (!_isGlassAlive(this._glass)) return;
        const effect = this._glass._effect;
        if (!effect) return;

        const { isDark, tintR, tintG, tintB, tintStrength } = this._getThemeParams();
        this._glass.setIsDock(false);
        this._glass.setCornerSmoothingEnabled(0.0);
        this._glass.setCornerRadius(CORNER_RADIUS);
        this._glass.setTintColor(tintR, tintG, tintB);
        this._glass.setTintStrength(tintStrength);
        this._glass.setBrightness(1.0);
        this._glass.setContrast(1.0);
        this._glass.setSaturation(1.0);
        this._glass.setBlurRadius(8.0);
        this._glass.setPadding(0);

        try {
            effect.setSurfaceLightEnabled(true);
            effect._setFloat('displacement_scale', 85.0);
            effect._setFloat('ior', 1.50);
            effect._setFloat('max_z', 14.0);
            effect._setFloat('edge_smoothing', 1.33);
            effect._setFloat('profile_shape_n', 5.40);

            effect._setFloat('rim_intensity', 0.18);
            effect._setFloat('rim_width', 4.5);
            effect._setFloat('rim_power', 5.0);
            effect._setFloat('rim_directional_power', 2.7);
            effect._setFloat('rim_light_color_intensity', 1.6);

            effect._setFloat('specular_intensity', 0.15);
            effect._setFloat('sheen_intensity', 0.10);
            effect._setFloat('chroma_strength', 0.008);

            effect._setFloat('shadow_intensity', isDark ? 0.35 : 0.22);
            effect._setFloat('shadow_radius', 18.0);
            effect._setFloat('shadow_max_radius', 60.0);
            effect._setFloat('ao_intensity', 0.08);
            effect._setFloat('ao_radius', 2.5);

            effect.queue_repaint();
        } catch (_) {}
    }

    async _initGlass() {
        if (this._glass || this._initializingGlass) return;
        this._initializingGlass = true;
        try {
            const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
            const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
            const mod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
            const BackdropGlass = mod.BackdropGlass;

            this._glass = new BackdropGlass({
                extensionPath: path,
                settings: ext?.stateObj?._settings || null,
                logger: console,
                owner: 'spotlight',
                excludeActors: [this, this._box, this._backdrop],
            });
            this._glass.addExclusion(this);
            this._glass.addExclusion(this._box);
            this._glass.addExclusion(this._backdrop);
            this._applyGlassUniforms();
            this._glass.hide();
            this._glass.opacity = 0;

            if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
            }

            if (!this._isOpen) {
                return;
            }

            Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
            Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
            this._glass.show();
            this._glass.opacity = (typeof this._box.opacity === 'number' && this._box.opacity > 0) ? this._box.opacity : 255;
            this._glass._backdropLocked = false;
            if (typeof this._glass.forceRefresh === 'function') {
                this._glass.forceRefresh(1);
            }
            this._applyGlassUniforms();
            this._syncGlass();
        } catch (e) {
            console.error(`[Spotlight] Error initializing BackdropGlass: ${e}`);
        } finally {
            this._initializingGlass = false;
        }
    }

    _collapseButtonsAndExpandPill() {
        if (this._isCollapsing) {
            this._isCollapsing = false;
            try { this._box.remove_all_transitions(); } catch (_) {}
            try { this._resultsWrapper.remove_all_transitions(); } catch (_) {}
            try { this._searchPill.remove_all_transitions(); } catch (_) {}
            try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
            this._cancelSyncLoop();
        }
        if (this._buttonsCollapsed) return;
        this._buttonsCollapsed = true;

        // Плавне згасання круглих кнопок дій (150мс)
        try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
        this._buttonsBox.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._buttonsCollapsed) {
                    this._buttonsBox.visible = false;
                }
            },
        });

        this._box.set_style(
            'background-color: transparent !important; ' +
            'background: none !important; ' +
            `border-radius: ${CORNER_RADIUS}px !important; ` +
            'border: none !important; ' +
            'box-shadow: none !important;'
        );

        this._searchPill.set_style(PILL_EXPANDED_STYLE);
        try { this._searchPill.remove_all_transitions(); } catch (_) {}
        this._searchPill.ease({
            width: DIALOG_WIDTH,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        // Шапка розгорнутого меню — 54px, єдиний відступ поля вводу та іконки від верху
        this._topRow.set_style('height: 54px; min-height: 54px;');

        this._requestGlassSync();
    }

    _uncollapseButtonsAndContractPill(onComplete) {
        if (!this._buttonsCollapsed || this._isCollapsing) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }
        this._isCollapsing = true;

        // Плавне згасання та зміщення результатів вниз (150мс)
        try { this._resultsWrapper.remove_all_transitions(); } catch (_) {}
        this._resultsWrapper.ease({
            opacity: 0,
            translation_y: 8,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this._resultsWrapper.visible = false;
            },
        });

        // Плавне зменшення ширини пілюлі до 480px за 300мс
        try { this._searchPill.remove_all_transitions(); } catch (_) {}
        this._searchPill.ease({
            width: COLLAPSED_PILL_WIDTH,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        // Плавне зменшення висоти вікна Spotlight до висоти пілюлі 54px за 300мс
        try { this._box.remove_all_transitions(); } catch (_) {}
        this._box.ease({
            height: PILL_HEIGHT,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._cancelSyncLoop();
                this._isCollapsing = false;
                this._buttonsCollapsed = false;

                this._resultsWrapper.visible = false;
                this._resultsWrapper.opacity = 0;
                this._resultsWrapper.translation_y = 0;
                this._resultsBox.destroy_all_children();
                this._resultButtons = [];
                this._selectedIndex = -1;
                this._lastQuery = '';

                this._box.set_style(
                    'background-color: transparent !important; ' +
                    'background: none !important; ' +
                    `border-radius: ${CORNER_RADIUS}px !important; ` +
                    'border: none !important; ' +
                    'box-shadow: none !important;'
                );

                this._searchPill.set_style(PILL_COLLAPSED_STYLE);
                this._searchPill.width = COLLAPSED_PILL_WIDTH;
                this._topRow.set_style('height: 54px; min-height: 54px;');

                this._buttonsBox.set_style('margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;');
                this._buttonsBox.visible = true;
                this._buttonsBox.scale_x = 1.0;
                this._buttonsBox.scale_y = 1.0;
                this._buttonsBox.translation_x = 0;
                this._buttonsBox.translation_y = 0;
                this._buttonsBox.opacity = 0;

                for (const btn of [this._btnApps, this._btnFiles, this._btnClipboard]) {
                    if (btn) {
                        try { btn.remove_all_transitions(); } catch (_) {}
                        btn.scale_x = 1.0;
                        btn.scale_y = 1.0;
                        btn.translation_x = 0;
                        btn.translation_y = 0;
                        btn.opacity = 255;
                    }
                }

                try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
                this._buttonsBox.ease({
                    opacity: 255,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                this._syncGlass();
                if (typeof onComplete === 'function') {
                    try { onComplete(); } catch (_) {}
                }
            },
        });
    }

    _cancelSyncLoop() {
        if (this._syncLoopId) {
            try { GLib.source_remove(this._syncLoopId); } catch (_) {}
            this._syncLoopId = 0;
        }
    }

    _startSyncLoop(_durationMs = 300) {
        this._requestGlassSync();
    }

    _requestGlassSync() {
        if (this._glassSyncQueued) return;
        this._glassSyncQueued = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._glassSyncQueued = false;
            if (this._isOpen || this._isClosing) {
                this._syncGlass();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncGlass() {
        try {
            if ((!this._isOpen && !this._isClosing) || !_isGlassAlive(this._glass)) {
                return;
            }

            const box = this._box;
            if (!box || !_isActorValid(box) || !box.visible) {
                return;
            }

            const mon = Main.layoutManager.primaryMonitor;
            const scaleX = box.scale_x ?? 1.0;
            const scaleY = box.scale_y ?? 1.0;
            const rawW = box.width > 0 ? box.width : DIALOG_WIDTH;
            const rawH = box.height > 0 ? box.height : PILL_HEIGHT;

            const targetOpacity = (typeof box.opacity === 'number') ? Math.max(0, Math.min(255, Math.round(box.opacity))) : 255;
            if (this._glass.opacity !== targetOpacity) {
                this._glass.opacity = targetOpacity;
            }
            if (targetOpacity > 0 && !this._glass.visible) {
                this._glass.show();
            }

            this._glass.set_position(mon.x, mon.y);
            this._glass.set_size(mon.width, mon.height);
            this._glass.setResolution(mon.width, mon.height);

            const hasText = (this._entry && this._entry.get_text) ? this._entry.get_text().trim().length > 0 : false;
            const hasResults = this._resultsWrapper && this._resultsWrapper.visible && (box.height > PILL_HEIGHT + 10);
            const isExpanded = this._buttonsCollapsed || hasText || hasResults || this._mode !== 'search' || this._isCollapsing;

            if (!isExpanded && this._searchPill && this._btnApps && this._btnFiles && this._btnClipboard) {
                const pillPos = this._searchPill.get_transformed_position();
                const b1Pos = this._btnApps.get_transformed_position();
                const b2Pos = this._btnFiles.get_transformed_position();
                const b3Pos = this._btnClipboard.get_transformed_position();

                const pillX = Math.round(pillPos[0] - mon.x);
                const pillY = Math.round(pillPos[1] - mon.y);
                const pillW = Math.round((this._searchPill.width || COLLAPSED_PILL_WIDTH) * scaleX);
                const pillH = Math.round((this._searchPill.height || PILL_HEIGHT) * scaleY);

                const b1X = Math.round(b1Pos[0] - mon.x);
                const b1Y = Math.round(b1Pos[1] - mon.y);
                const b1W = Math.round((this._btnApps.width || BUTTON_SIZE) * scaleX);
                const b1H = Math.round((this._btnApps.height || BUTTON_SIZE) * scaleY);

                const b2X = Math.round(b2Pos[0] - mon.x);
                const b2Y = Math.round(b2Pos[1] - mon.y);
                const b2W = Math.round((this._btnFiles.width || BUTTON_SIZE) * scaleX);
                const b2H = Math.round((this._btnFiles.height || BUTTON_SIZE) * scaleY);

                const b3X = Math.round(b3Pos[0] - mon.x);
                const b3Y = Math.round(b3Pos[1] - mon.y);
                const b3W = Math.round((this._btnClipboard.width || BUTTON_SIZE) * scaleX);
                const b3H = Math.round((this._btnClipboard.height || BUTTON_SIZE) * scaleY);

                const { isDark, tintR, tintG, tintB, tintStrength } = this._getThemeParams();
                const regions = [
                    { x: pillX, y: pillY, w: pillW, h: pillH, tintR, tintG, tintB, baseStrength: tintStrength },
                    { x: b1X, y: b1Y, w: b1W, h: b1H, tintR, tintG, tintB, baseStrength: this._btnApps.hover ? tintStrength * 2.5 : tintStrength },
                    { x: b2X, y: b2Y, w: b2W, h: b2H, tintR, tintG, tintB, baseStrength: this._btnFiles.hover ? tintStrength * 2.5 : tintStrength },
                    { x: b3X, y: b3Y, w: b3W, h: b3H, tintR, tintG, tintB, baseStrength: this._btnClipboard.hover ? tintStrength * 2.5 : tintStrength },
                ];

                const minX = Math.min(pillX, b1X, b2X, b3X);
                const minY = Math.min(pillY, b1Y, b2Y, b3Y);
                const maxX = Math.max(pillX + pillW, b1X + b1W, b2X + b2W, b3X + b3W);
                const maxY = Math.max(pillY + pillH, b1Y + b1H, b2Y + b2H, b3Y + b3H);

                const CLIP_PAD = 60;
                this._glass.setMultiRegionMode(true);
                this._glass.setGlassRegions(regions);
                this._glass.set_clip(minX - CLIP_PAD, minY - CLIP_PAD, (maxX - minX) + CLIP_PAD * 2, (maxY - minY) + CLIP_PAD * 2);
            } else {
                const [boxScreenX, boxScreenY] = box.get_transformed_position();
                const localBgX = Math.round(boxScreenX - mon.x);
                const localBgY = Math.round(boxScreenY - mon.y);
                const activeW = (this._searchPill && this._searchPill.width > 0 && this._searchPill.width < rawW)
                    ? this._searchPill.width
                    : rawW;
                const bgW = Math.round(activeW * scaleX);
                const bgH = Math.round(rawH * scaleY);

                this._glass.setMultiRegionMode(false);
                const { isDark, tintR, tintG, tintB, tintStrength } = this._getThemeParams();
                this._glass.setTintColor(tintR, tintG, tintB);
                this._glass.setTintStrength(tintStrength);
                this._glass.setCornerRadius(CORNER_RADIUS);
                this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
                const CLIP_PAD = 60;
                this._glass.set_clip(localBgX - CLIP_PAD, localBgY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
            }
        } catch (_) {}
    }

    _setMode(newMode) {
        if (this._mode === newMode) return;
        this._mode = newMode;
        this._entry.text = '';

        if (newMode === 'search') {
            this._searchIcon.set_gicon(null);
            this._searchIcon.icon_name = 'system-search-symbolic';
            this._searchIcon.icon_size = 20;
            this._entry.hint_text = t('spotlight_search', 'Пошук Spotlight');
            this._optionsBtn.visible = false;
            this._selectedAppsCategory = null;

            this._uncollapseButtonsAndContractPill(() => {
                this._filesView.visible = false;
                this._appsView.visible = false;
                this._clipboardView.visible = false;
                this._searchView.visible = true;
            });
        } else {
            this._collapseButtonsAndExpandPill();

            // Set Mode Headers & Content
            this._searchView.visible = false;
            this._filesView.visible = (newMode === 'files');
            this._appsView.visible = (newMode === 'apps');
            this._clipboardView.visible = (newMode === 'clipboard');

            if (newMode === 'files') {
                const f = Gio.File.new_for_path(`${ICONS_DIR}/mac-spotlight-files.svg`);
                this._searchIcon.set_gicon(new Gio.FileIcon({ file: f }));
                this._searchIcon.icon_size = 20;
                this._entry.hint_text = t('files', 'Файли');
                this._optionsBtn.visible = true;
                this._loadFilesView();
                this._expandToHeight(530);
            } else if (newMode === 'apps') {
                const home = GLib.get_home_dir();
                const appstoreCandidates = [
                    `${home}/.local/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
                    `${home}/.local/share/icons/MacTahoe/apps/scalable/Appstore.svg`,
                    `${home}/.local/share/icons/macW1Y-dark/apps/scalable/Appstore.svg`,
                    `/usr/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
                ];
                let appStoreGIcon = null;
                for (const p of appstoreCandidates) {
                    if (p && GLib.file_test(p, GLib.FileTest.EXISTS)) {
                        appStoreGIcon = Gio.FileIcon.new(Gio.File.new_for_path(p));
                        break;
                    }
                }
                if (appStoreGIcon) {
                    this._searchIcon.set_gicon(appStoreGIcon);
                    this._searchIcon.icon_size = 26;
                } else {
                    const f = Gio.File.new_for_path(`${ICONS_DIR}/mac-spotlight-apps.svg`);
                    this._searchIcon.set_gicon(new Gio.FileIcon({ file: f }));
                    this._searchIcon.icon_size = 20;
                }
                this._entry.hint_text = t('applications', 'Програми');
                this._optionsBtn.visible = true;
                this._selectedAppsCategory = null;
                this._buildAppsCategoryButtons();
                this._loadAppsView();
                this._expandToHeight(530);
            } else if (newMode === 'clipboard') {
                const f = Gio.File.new_for_path(`${ICONS_DIR}/mac-spotlight-clipboard.svg`);
                this._searchIcon.set_gicon(new Gio.FileIcon({ file: f }));
                this._searchIcon.icon_size = 20;
                this._entry.hint_text = t('search_clipboard', 'Пошук у буфері');
                this._optionsBtn.visible = true;
                this._loadClipboardView();
                this._expandToHeight(530);
            }
        }
    }

    _expandToHeight(targetHeight) {
        if (!this._resultsWrapper.visible) {
            this._resultsWrapper.visible = true;
            this._resultsWrapper.opacity = 0;
        }
        // Однотипна анімація появи/зміни вмісту: м'який зсув знизу вгору за 300мс
        try { this._resultsWrapper.remove_all_transitions(); } catch (_) {}
        this._resultsWrapper.translation_y = 10;

        try { this._box.remove_all_transitions(); } catch (_) {}
        this._box.ease({
            height: targetHeight,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._syncGlass();
            },
        });

        this._resultsWrapper.ease({
            opacity: 255,
            translation_y: 0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        this._requestGlassSync();
    }

    open() {
        if (this._isOpen) return;
        if (Main.overview?.visible) return;
        if (typeof globalThis._macCloseAllCenters === 'function') {
            globalThis._macCloseAllCenters('spotlight');
        } else {
            try { globalThis._tahoeQSClose?.(); } catch (_) {}
            try { globalThis._tahoeNCClose?.(true); } catch (_) {}
            try { globalThis._macClipboardGlobalInstance?.close?.(true); } catch (_) {}
        }
        this._isOpen = true;
        this._isClosing = false;
        this._cancelSyncLoop();
        this._box.remove_all_transitions();
        this.remove_all_transitions();
        if (_isGlassAlive(this._glass)) {
            try { this._glass.remove_all_transitions(); } catch (_) {}
        }
        this._mode = 'search';
        this._buttonsCollapsed = false;
        this._isCollapsing = false;
        this._activeFilter = null;

        const mon = Main.layoutManager.primaryMonitor;
        this.set_position(0, 0);
        this.set_size(mon.width, mon.height);

        this._backdrop.set_position(mon.x, mon.y);
        this._backdrop.set_size(mon.width, mon.height);
        this._backdrop.visible = true;

        const x = mon.x + Math.round((mon.width - DIALOG_WIDTH) / 2);
        const y = mon.y + Math.round(mon.height * 0.19);

        this._box.set_position(x, y);
        this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
        this._box.set_pivot_point(0.5, 0.5);
        this._box.translation_x = 0;
        this._box.translation_y = -8;
        this._box.scale_x = 1.08;
        this._box.scale_y = 1.08;
        this._box.opacity = 0;

        // Reset search pill and buttons
        this._buttonsCollapsed = false;
        this._isCollapsing = false;

        try { this._searchPill.remove_all_transitions(); } catch (_) {}
        this._searchPill.set_size(COLLAPSED_PILL_WIDTH, PILL_HEIGHT);
        this._searchPill.width = COLLAPSED_PILL_WIDTH;
        this._searchPill.scale_x = 1.0;
        this._searchPill.scale_y = 1.0;
        this._searchPill.translation_x = 0;
        this._searchPill.translation_y = 0;
        this._searchPill.opacity = 255;
        this._searchPill.set_style(PILL_COLLAPSED_STYLE);
        this._topRow.set_style('height: 54px; min-height: 54px;');

        try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
        this._buttonsBox.set_style('margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;');
        this._buttonsBox.visible = true;
        this._buttonsBox.opacity = 255;
        this._buttonsBox.scale_x = 1.0;
        this._buttonsBox.scale_y = 1.0;
        this._buttonsBox.translation_x = 0;
        this._buttonsBox.translation_y = 0;

        for (const btn of [this._btnApps, this._btnFiles, this._btnClipboard]) {
            if (btn) {
                try { btn.remove_all_transitions(); } catch (_) {}
                btn.scale_x = 1.0;
                btn.scale_y = 1.0;
                btn.translation_x = 0;
                btn.translation_y = 0;
                btn.opacity = 255;
            }
        }

        this._searchIcon.set_gicon(null);
        this._searchIcon.icon_name = 'system-search-symbolic';
        this._searchIcon.translation_y = 0;
        this._entry.translation_y = 0;
        this._optionsBtn.translation_y = 0;
        this._optionsBtn.visible = false;

        this._resultsWrapper.visible = false;
        this._resultsWrapper.opacity = 0;
        this._searchView.visible = true;
        this._filesView.visible = false;
        this._appsView.visible = false;
        this._clipboardView.visible = false;

        this._entry.text = '';
        this._entry.hint_text = t('spotlight_search', 'Пошук Spotlight');
        this._lastQuery = '';
        this._resultsBox.destroy_all_children();
        this._resultButtons = [];
        this._selectedIndex = -1;

        if (!this.get_parent()) {
            Main.layoutManager.uiGroup.add_child(this);
        }
        this.visible = true;

        if (_isGlassAlive(this._glass)) {
            try {
                this._glass.remove_all_transitions();
                this._glass.scale_x = 1.0;
                this._glass.scale_y = 1.0;
                this._glass.translation_x = 0;
                this._glass.translation_y = 0;
                if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                    Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
                }
                Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
                Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
                this._glass.show();
                this._glass.opacity = 0;
                this._glass._backdropLocked = false;
                if (typeof this._glass.forceRefresh === 'function') {
                    this._glass.forceRefresh(1);
                }
                this._applyGlassUniforms();
                this._syncGlass();
            } catch (err) {
                this._glass = null;
                this._initGlassPromise = this._initGlass();
                Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
            }
        } else {
            this._glass = null;
            this._initGlassPromise = this._initGlass();
            Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
            if (this._initGlassPromise) {
                this._initGlassPromise.then(() => {
                    if (!this._isOpen || !_isGlassAlive(this._glass)) return;
                    if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                        Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
                    }
                    Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
                    Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
                    this._glass.show();
                    this._applyGlassUniforms();
                    this._syncGlass();
                }).catch(() => {});
            }
        }

        try {
            this._modalGrab = Main.pushModal(this, { actionMode: Shell.ActionMode.ALL });
        } catch (_) {
            try {
                if (global.stage.grab) {
                    this._modalGrab = global.stage.grab(this);
                }
            } catch (_) {}
        }

        this._entry.grab_key_focus();

        this._box.ease({
            opacity: 255,
            translation_x: 0,
            translation_y: 0,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._box.translation_x = 0;
                this._box.translation_y = 0;
                this._box.scale_x = 1.0;
                this._box.scale_y = 1.0;
                this._syncGlass();
            },
        });
    }

    close(immediate = false) {
        if (!this._isOpen && !this._isClosing) return;
        this._isOpen = false;
        // Запам'ятати геометрію для морф-переходу в інше меню (діє 900мс)
        _saveMorphFrom('spotlight', this);

        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }

        if (this._modalGrab) {
            try { Main.popModal(this._modalGrab); } catch (_) {
                try { this._modalGrab.dismiss?.(); } catch (_) {}
            }
            this._modalGrab = null;
        } else {
            try { Main.popModal(this); } catch (_) {}
        }

        const hideGlass = () => {
            try {
                if (_isGlassAlive(this._glass)) {
                    this._glass.remove_all_transitions();
                    this._glass.scale_x = 1.0;
                    this._glass.scale_y = 1.0;
                    this._glass.translation_x = 0;
                    this._glass.translation_y = 0;
                    this._glass.opacity = 0;
                    this._glass.visible = false;
                    this._glass.hide();
                    this._glass._backdropLocked = false;
                }
            } catch (_) {}
        };

        if (immediate) {
            this._cancelSyncLoop();
            this._isClosing = false;
            this._isCollapsing = false;
            this._buttonsCollapsed = false;
            hideGlass();
            this._box.remove_all_transitions();
            this._resultsWrapper.remove_all_transitions();
            this._box.opacity = 0;
            this._box.translation_x = 0;
            this._box.translation_y = 0;
            this._box.scale_x = 1.0;
            this._box.scale_y = 1.0;
            try { this._searchPill.remove_all_transitions(); } catch (_) {}
            this._searchPill.scale_x = 1.0;
            this._searchPill.scale_y = 1.0;
            this._searchPill.translation_x = 0;
            this._searchPill.translation_y = 0;
            this._searchPill.opacity = 255;
            try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
            this._buttonsBox.scale_x = 1.0;
            this._buttonsBox.scale_y = 1.0;
            this._buttonsBox.translation_x = 0;
            this._buttonsBox.translation_y = 0;
            this._buttonsBox.opacity = 255;
            this._buttonsBox.visible = true;
            for (const btn of [this._btnApps, this._btnFiles, this._btnClipboard]) {
                if (btn) {
                    try { btn.remove_all_transitions(); } catch (_) {}
                    btn.scale_x = 1.0;
                    btn.scale_y = 1.0;
                    btn.translation_x = 0;
                    btn.translation_y = 0;
                    btn.opacity = 255;
                }
            }
            this.visible = false;
            this._backdrop.visible = false;
            this._entry.text = '';
            this._resultsWrapper.visible = false;
            this._resultsBox.destroy_all_children();
            this._resultButtons = [];
            this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
            return;
        }

        this._isClosing = true;
        this._isCollapsing = false;
        this._backdrop.visible = false;

        // Плавне згасання прозорості елементів пілюлі, кнопок та результатів для зникнення
        try { this._searchPill.remove_all_transitions(); } catch (_) {}
        this._searchPill.ease({
            opacity: 0,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        if (this._buttonsBox.visible) {
            try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
            this._buttonsBox.ease({
                opacity: 0,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }

        if (this._resultsWrapper.visible) {
            try { this._resultsWrapper.remove_all_transitions(); } catch (_) {}
            this._resultsWrapper.ease({
                opacity: 0,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }

        if (_isGlassAlive(this._glass)) {
            try {
                this._glass.remove_all_transitions();
                this._glass.ease({
                    opacity: 0,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } catch (_) {}
        }

        this._box.ease({
            opacity: 0,
            scale_x: 1.08,
            scale_y: 1.08,
            translation_y: -6,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._isOpen) return;
                this._cancelSyncLoop();
                this._isClosing = false;
                this._isCollapsing = false;
                this._buttonsCollapsed = false;
                this.visible = false;
                this._entry.text = '';
                this._resultsWrapper.visible = false;
                this._resultsWrapper.opacity = 0;
                this._resultsBox.destroy_all_children();
                this._resultButtons = [];
                this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
                this._box.translation_x = 0;
                this._box.translation_y = 0;
                this._box.scale_x = 1.0;
                this._box.scale_y = 1.0;
                try { this._searchPill.remove_all_transitions(); } catch (_) {}
                this._searchPill.opacity = 255;
                this._searchPill.scale_x = 1.0;
                this._searchPill.scale_y = 1.0;
                this._searchPill.translation_x = 0;
                this._searchPill.translation_y = 0;
                try { this._buttonsBox.remove_all_transitions(); } catch (_) {}
                this._buttonsBox.opacity = 255;
                this._buttonsBox.visible = true;
                this._buttonsBox.scale_x = 1.0;
                this._buttonsBox.scale_y = 1.0;
                this._buttonsBox.translation_x = 0;
                this._buttonsBox.translation_y = 0;
                for (const btn of [this._btnApps, this._btnFiles, this._btnClipboard]) {
                    if (btn) {
                        try { btn.remove_all_transitions(); } catch (_) {}
                        btn.scale_x = 1.0;
                        btn.scale_y = 1.0;
                        btn.translation_x = 0;
                        btn.translation_y = 0;
                        btn.opacity = 255;
                    }
                }
                hideGlass();
            },
        });
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    _scheduleSearch() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._performSearch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _performSearch() {
        const raw = this._entry.get_text();
        const query = raw.trim();
        this._lastQuery = query;

        if (this._mode === 'files') {
            this._loadFilesView(query);
            return;
        }
        if (this._mode === 'apps') {
            this._loadAppsView(query);
            return;
        }
        if (this._mode === 'clipboard') {
            this._loadClipboardView(query);
            return;
        }

        // 'search' mode handling:
        if (query.length === 0) {
            this._uncollapseButtonsAndContractPill();
            return;
        }

        if (!this._buttonsCollapsed) {
            this._collapseButtonsAndExpandPill();
        }

        // Gather search items
        const results = [];
        if (query.startsWith('~') || query.startsWith('/')) {
            results.push(...this._searchDirectory(query));
        }
        results.push(...this._searchApps(query));
        results.push(...this._searchSettings(query));
        results.push(...this._searchRecent(query));

        const fallbacks = [
            {
                type: 'fallback-nautilus',
                title: t('search_in_nautilus', 'Шукати в Nautilus'),
                subtitle: tf('find_in_file_manager', { query }, `Знайти «${query}» у файловому менеджері`),
                iconName: 'org.gnome.Nautilus',
                query,
            },
            {
                type: 'fallback-web',
                title: t('search_the_web', 'Шукати в інтернеті'),
                subtitle: tf('find_via_google', { query }, `Google: «${query}»`),
                iconName: 'web-browser',
                query,
            },
            {
                type: 'fallback-gemini',
                title: t('ask_gemini', 'Запит у Gemini'),
                subtitle: tf('ask_ai_about', { query }, `Запитати штучний інтелект про «${query}»`),
                iconName: 'star-new-symbolic',
                query,
            },
        ];

        let finalItems = [];
        if (results.length > 0) {
            finalItems = results.slice(0, 6).concat(fallbacks);
        } else {
            finalItems = fallbacks;
        }

        this._renderResults(finalItems);
    }

    _searchApps(query) {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        const apps = this._getAllApps();
        const hits = [];

        for (const app of apps) {
            const name = app.get_name() || '';
            const desc = app.get_description() || '';
            const id = app.get_id() || '';
            const appInfo = app.get_app_info ? app.get_app_info() : null;
            const exec = appInfo?.get_executable?.() || '';
            const keywords = (appInfo?.get_keywords?.() || []).join(' ');
            const text = `${name} ${desc} ${id} ${exec} ${keywords}`.toLowerCase();

            let score = 99;
            const nameLower = name.toLowerCase();
            const idLower = id.toLowerCase();
            const execLower = exec.toLowerCase();

            if (nameLower === q || idLower === q) {
                score = 1;
            } else if (nameLower.startsWith(q) || idLower.startsWith(q) || execLower.startsWith(q)) {
                score = 2;
            } else if (text.includes(q)) {
                score = 3;
            }

            if (score < 99) {
                hits.push({
                    type: 'app',
                    title: name,
                    subtitle: desc || id,
                    app,
                    score,
                    category: t('category_app', 'Програма'),
                });
            }
        }
        return hits.sort((a, b) => a.score - b.score);
    }

    _searchSettings(query) {
        const q = query.toLowerCase();
        const hits = [];

        for (const p of SETTINGS_PANELS) {
            const title = t(p.key, p.fallback);
            let score = 99;
            if (title.toLowerCase().startsWith(q)) score = 1;
            else if (p.match.some(m => m.includes(q) || q.includes(m))) score = 2;

            if (score < 99) {
                hits.push({
                    type: 'setting',
                    title,
                    subtitle: t('settings', 'Параметри системи'),
                    panel: p.panel,
                    iconName: 'preferences-system-symbolic',
                    score,
                    category: t('category_setting', 'Параметри'),
                });
            }
        }
        return hits.sort((a, b) => a.score - b.score);
    }

    _searchRecent(query) {
        const q = query.toLowerCase();
        const allFiles = this._getAllRecentFiles();
        const hits = [];

        for (const item of allFiles) {
            if (item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)) {
                hits.push({
                    type: 'file',
                    title: item.name,
                    subtitle: item.path,
                    uri: item.uri,
                    category: t('category_file', 'Файл'),
                });
                if (hits.length >= 5) break;
            }
        }
        return hits;
    }

    _searchDirectory(query) {
        const hits = [];
        try {
            let expandedPath = query;
            if (expandedPath.startsWith('~')) {
                expandedPath = GLib.get_home_dir() + expandedPath.slice(1);
            }
            const lastSlash = expandedPath.lastIndexOf('/');
            const dirPath = lastSlash === 0 ? '/' : (lastSlash > 0 ? expandedPath.slice(0, lastSlash) : expandedPath);
            const prefix = lastSlash >= 0 ? expandedPath.slice(lastSlash + 1).toLowerCase() : '';

            if (GLib.file_test(dirPath, GLib.FileTest.IS_DIR)) {
                const dir = Gio.File.new_for_path(dirPath);
                const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null && hits.length < 10) {
                    const name = info.get_name();
                    if (!prefix || name.toLowerCase().startsWith(prefix)) {
                        const isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
                        const fullPath = GLib.build_filenamev([dirPath, name]);
                        hits.push({
                            type: 'dir-item',
                            title: name,
                            subtitle: fullPath,
                            path: fullPath,
                            isDir,
                            iconName: isDir ? 'folder' : 'text-x-generic',
                            category: isDir ? t('folder', 'Папка') : t('file', 'Файл'),
                        });
                    }
                }
            }
        } catch (_) {}
        return hits;
    }

    _renderResults(items) {
        this._resultsBox.destroy_all_children();
        this._resultButtons = [];
        this._selectedIndex = -1;

        if (!items || items.length === 0) {
            this._resultsWrapper.ease({
                opacity: 0,
                translation_y: 6,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    this._resultsWrapper.visible = false;
                },
            });
            this._box.ease({
                height: EXP_PILL_HEIGHT,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this._syncGlass();
                },
            });
            return;
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const btn = new St.Button({
                style_class: 'mac-spotlight-item',
                style: 'padding: 8px 12px; margin: 2px 4px; border-radius: 10px;',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: true,
            });

            const row = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(row);

            // Icon slot
            const iconSlot = new St.Widget({
                style_class: 'mac-spotlight-icon-slot',
                width: 36,
                height: 36,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            let iconActor;
            if (item.type === 'app' && item.app) {
                iconActor = createSmoothAppIcon(item.app, 32);
            } else if (item.iconName) {
                iconActor = new St.Icon({
                    icon_name: item.iconName,
                    icon_size: 48,
                    style: item.type === 'fallback-gemini' ? 'color: #388bfd;' : 'color: rgba(255, 255, 255, 0.90);',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                iconActor.set_size(24, 24);
                applyActorSmoothing(iconActor);
            } else {
                iconActor = new St.Icon({
                    icon_name: 'text-x-generic',
                    icon_size: 24,
                    style: 'color: rgba(255, 255, 255, 0.90);',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            }
            iconSlot.add_child(iconActor);
            row.add_child(iconSlot);

            // Text column
            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(textBox);

            const titleLbl = new St.Label({
                text: item.title,
                style_class: 'mac-spotlight-item-title',
                style: 'font-size: 14px; font-weight: 600; color: #ffffff !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);',
                x_align: Clutter.ActorAlign.START,
            });
            textBox.add_child(titleLbl);

            if (item.subtitle) {
                const subLbl = new St.Label({
                    text: item.subtitle,
                    style_class: 'mac-spotlight-item-subtitle',
                    style: 'font-size: 11px; color: rgba(255, 255, 255, 0.85) !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);',
                    x_align: Clutter.ActorAlign.START,
                });
                textBox.add_child(subLbl);
            }

            // Category badge
            if (item.category) {
                const badge = new St.Label({
                    text: item.category,
                    style_class: 'mac-spotlight-item-badge',
                    style: 'font-size: 11px; font-weight: 500; color: #ffffff !important; padding: 2px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.15); margin-left: 8px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                row.add_child(badge);
            }

            btn.itemData = item;
            if (item.type === 'app' && item.app) {
                btn._delegate = {
                    app: item.app,
                    getDragActor: () => {
                        return createSmoothAppIcon(item.app, 48);
                    },
                    getDragActorSource: () => btn,
                };
                const draggable = DND.makeDraggable(btn, {
                    restoreOnSuccess: true,
                    dragActorOpacity: 200,
                });
                draggable.connect('drag-begin', () => {
                    this.close();
                });
            }
            btn.connect('clicked', () => {
                this._activate(item);
            });
            btn.connect('notify::hover', () => {
                if (btn.hover) {
                    this._setSelectedIndex(i);
                }
            });

            this._resultButtons.push(btn);
            this._resultsBox.add_child(btn);
        }

        const visibleCount = Math.min(items.length, 7);
        const targetHeight = EXP_PILL_HEIGHT + 14 + visibleCount * 52;
        this._expandToHeight(targetHeight);

        this._setSelectedIndex(0);
    }

    _setSelectedIndex(index) {
        if (this._selectedIndex >= 0 && this._resultButtons[this._selectedIndex]) {
            this._resultButtons[this._selectedIndex].remove_style_class_name('selected');
            this._resultButtons[this._selectedIndex].set_style(
                'padding: 8px 12px; margin: 2px 4px; border-radius: 10px; background-color: transparent;'
            );
        }

        this._selectedIndex = index;
        if (this._selectedIndex >= 0 && this._resultButtons[this._selectedIndex]) {
            const btn = this._resultButtons[this._selectedIndex];
            btn.add_style_class_name('selected');
            btn.set_style(
                'padding: 8px 12px; margin: 2px 4px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.16);'
            );
            try { Util.ensureActorVisibleInScrollView?.(this._scrollView, btn); } catch (_) {}
        }
    }

    _moveSelection(delta) {
        if (this._resultButtons.length === 0) return;
        let next = this._selectedIndex + delta;
        if (next < 0) next = this._resultButtons.length - 1;
        if (next >= this._resultButtons.length) next = 0;
        this._setSelectedIndex(next);
    }

    _activateCurrent() {
        if (this._selectedIndex >= 0 && this._resultButtons[this._selectedIndex]) {
            this._activate(this._resultButtons[this._selectedIndex].itemData);
        }
    }

    _activate(item) {
        if (!item) return;
        this.close();

        switch (item.type) {
            case 'app':
                if (item.app) {
                    try {
                        let shellApp = item.app;
                        if (shellApp && typeof shellApp.activate !== 'function' && typeof shellApp.get_id === 'function') {
                            const id = shellApp.get_id();
                            if (id) {
                                shellApp = Shell.AppSystem.get_default().lookup_app(id);
                            }
                        }
                        if (typeof shellApp?.activate === 'function') {
                            shellApp.activate();
                        } else if (typeof shellApp?.open_new_window === 'function') {
                            shellApp.open_new_window(-1);
                        } else if (typeof item.app.launch === 'function') {
                            item.app.launch([], null);
                        } else {
                            const appInfo = item.app.get_app_info?.() || item.app;
                            if (typeof appInfo?.launch === 'function') {
                                appInfo.launch([], null);
                            }
                        }
                    } catch (e) {
                        try {
                            const appInfo = item.app.get_app_info?.() || item.app;
                            if (typeof appInfo?.launch === 'function') {
                                appInfo.launch([], null);
                            }
                        } catch (_) {}
                    }
                }
                break;
            case 'setting':
                if (item.panel) Util.spawn(['gnome-control-center', item.panel]);
                break;
            case 'file':
                if (item.uri) openFileDirectly(item.uri);
                break;
            case 'dir-item':
                if (item.path) {
                    if (item.isDir) {
                        Util.spawn(['nautilus', item.path]);
                    } else {
                        openFileDirectly(`file://${encodeURI(item.path)}`);
                    }
                }
                break;
            case 'fallback-nautilus':
                Util.spawn(['nautilus', '--search', item.query]);
                break;
            case 'fallback-web':
                Util.spawn(['xdg-open', `https://www.google.com/search?q=${encodeURIComponent(item.query)}`]);
                break;
            case 'fallback-gemini':
                Util.spawn(['xdg-open', `https://gemini.google.com/app?q=${encodeURIComponent(item.query)}`]);
                break;
        }
    }

    // -------------------------------------------------------------------------
    // FILES VIEW (Image 2 Authentic Implementation)
    // -------------------------------------------------------------------------
    _getAllRecentFiles() {
        const now = Date.now();
        if (this._cachedRecentFiles && this._cachedRecentFilesTime && (now - this._cachedRecentFilesTime < 15000)) {
            return this._cachedRecentFiles;
        }

        const files = [];
        const seen = new Set();

        // 1. Read recently-used.xbel (bounded to most recent 50 valid items)
        try {
            if (GLib.file_test(RECENT_ITEMS_FILE, GLib.FileTest.EXISTS)) {
                const [ok, bytes] = GLib.file_get_contents(RECENT_ITEMS_FILE);
                if (ok) {
                    const xml = new TextDecoder('utf-8').decode(bytes);
                    const matches = [...xml.matchAll(/<bookmark href="([^"]+)"[\s\S]*?(?:<title>([^<]*)<\/title>)?[\s\S]*?<\/bookmark>/g)];
                    let count = 0;
                    for (let i = matches.length - 1; i >= 0 && count < 50; i--) {
                        const m = matches[i];
                        const uri = m[1];
                        if (!uri || !uri.startsWith('file://')) continue;
                        const path = decodeURIComponent(uri.replace('file://', ''));
                        if (seen.has(path)) continue;
                        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) continue;
                        seen.add(path);
                        count++;

                        let title = m[2];
                        if (!title) {
                            title = path.split('/').pop() || 'Файл';
                        }
                        const ext = path.split('.').pop().toLowerCase();
                        files.push({
                            name: title,
                            path,
                            uri,
                            ext,
                            category: getFileCategory(ext),
                            iconSvg: getDocSvgForExt(ext),
                        });
                    }
                }
            }
        } catch (_) {}

        // 2. Complement with standard directories (bounded to 15 items per dir)
        const dirs = [
            GLib.build_filenamev([GLib.get_home_dir(), 'Завантаження']),
            GLib.build_filenamev([GLib.get_home_dir(), 'Зображення', 'Знімки екрана']),
            GLib.build_filenamev([GLib.get_home_dir(), 'Документи']),
            GLib.build_filenamev([GLib.get_home_dir(), 'Десктоп']),
        ];
        for (const d of dirs) {
            try {
                if (!GLib.file_test(d, GLib.FileTest.IS_DIR)) continue;
                const dir = Gio.File.new_for_path(d);
                const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                let dirCount = 0;
                while ((info = enumerator.next_file(null)) !== null && dirCount < 15) {
                    if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                    const name = info.get_name();
                    if (name.startsWith('.')) continue;
                    const path = GLib.build_filenamev([d, name]);
                    if (seen.has(path)) continue;
                    seen.add(path);
                    dirCount++;
                    const ext = name.split('.').pop().toLowerCase();
                    files.push({
                        name,
                        path,
                        uri: `file://${encodeURI(path)}`,
                        ext,
                        category: getFileCategory(ext),
                        iconSvg: getDocSvgForExt(ext),
                    });
                }
            } catch (_) {}
        }

        this._cachedRecentFiles = files;
        this._cachedRecentFilesTime = now;
        return files;
    }

    _loadFilesView(query = '') {
        this._filesContentBox.destroy_all_children();

        let allFiles = this._getAllRecentFiles();

        // Apply active category pill filter
        if (this._activeFilter) {
            allFiles = allFiles.filter(f => f.category === this._activeFilter);
        }

        // Apply search query filter
        if (query) {
            const q = query.toLowerCase();
            allFiles = allFiles.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
        }

        if (allFiles.length === 0) {
            const emptyLbl = new St.Label({
                text: t('no_files_found', 'Немає файлів'),
                style: 'font-size: 14px; color: rgba(255, 255, 255, 0.45); margin: 40px auto;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._filesContentBox.add_child(emptyLbl);
            return;
        }

        // Section 1: "Пропозиції" (Suggestions) - Top 5 items
        const suggestions = allFiles.slice(0, 5);
        const suggTitle = new St.Label({
            text: 'Пропозиції',
            style: 'font-size: 13px; font-weight: 700; color: #ffffff !important; margin: 4px 6px 10px 6px; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);',
            x_align: Clutter.ActorAlign.START,
        });
        this._filesContentBox.add_child(suggTitle);

        const suggRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'margin-bottom: 14px;',
        });
        this._filesContentBox.add_child(suggRow);

        for (const file of suggestions) {
            const card = this._createFileCard(file);
            suggRow.add_child(card);
        }

        // Section 2: "Недавні" (Recent) - 5 columns grid
        const recents = allFiles.slice(5);
        if (recents.length > 0) {
            const recentTitle = new St.Label({
                text: 'Недавні',
                style: 'font-size: 13px; font-weight: 700; color: #ffffff !important; margin: 10px 6px 10px 6px; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20);',
                x_align: Clutter.ActorAlign.START,
            });
            this._filesContentBox.add_child(recentTitle);

            let currentRow = null;
            for (let i = 0; i < recents.length; i++) {
                if (i % 5 === 0) {
                    currentRow = new St.BoxLayout({
                        vertical: false,
                        x_expand: true,
                        style: 'margin-bottom: 10px;',
                    });
                    this._filesContentBox.add_child(currentRow);
                }
                const card = this._createFileCard(recents[i]);
                currentRow.add_child(card);
            }
        }
    }

    _createFileCard(file) {
        const btn = new St.Button({
            style: 'width: 124px; min-width: 124px; padding: 8px 4px; border-radius: 12px; margin-right: 4px;',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const col = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.set_child(col);

        // Vector Document Sheet Icon
        const gfile = Gio.File.new_for_path(file.iconSvg);
        const icon = new St.Icon({
            gicon: new Gio.FileIcon({ file: gfile }),
            icon_size: 58,
            x_align: Clutter.ActorAlign.CENTER,
        });
        col.add_child(icon);

        // Filename label
        const titleLbl = new St.Label({
            text: file.name,
            style: 'font-size: 11px; font-weight: 500; color: #ffffff !important; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; text-align: center; margin-top: 6px; max-width: 112px;',
            x_align: Clutter.ActorAlign.CENTER,
        });
        if (titleLbl.clutter_text) {
            titleLbl.clutter_text.set_line_wrap(true);
            titleLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        }
        col.add_child(titleLbl);

        btn.connect('notify::hover', () => {
            if (btn.hover) {
                btn.set_style('width: 124px; min-width: 124px; padding: 8px 4px; border-radius: 12px; margin-right: 4px; background-color: rgba(255, 255, 255, 0.12);');
            } else {
                btn.set_style('width: 124px; min-width: 124px; padding: 8px 4px; border-radius: 12px; margin-right: 4px; background-color: transparent;');
            }
        });

        btn.connect('clicked', () => {
            this.close();
            openFileDirectly(file.uri);
        });

        return btn;
    }

    // -------------------------------------------------------------------------
    // APPS VIEW (Dock Applications Menu Authenticity - Photo 1)
    // -------------------------------------------------------------------------
    _loadAppsView(query = '') {
        const q = (query || '').trim();
        const hasFilter = !!q || !!this._selectedAppsCategory;

        if (!hasFilter && this._appsDefaultLoaded && this._appsContentBox.get_n_children() > 0) {
            return;
        }

        this._appsContentBox.destroy_all_children();

        const apps = this._filterApps(q);

        if (apps.length === 0) {
            const emptyLbl = new St.Label({
                text: t('no_apps_found', 'Немає програм'),
                style: 'font-size: 14px; color: rgba(255, 255, 255, 0.45); margin: 40px auto;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._appsContentBox.add_child(emptyLbl);
            if (!hasFilter) this._appsDefaultLoaded = true;
            return;
        }

        let currentRow = null;
        for (let i = 0; i < apps.length; i++) {
            if (i % APPS_COLUMNS === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    style: 'margin-bottom: 10px;',
                });
                this._appsContentBox.add_child(currentRow);
            }

            const app = apps[i];
            const btn = this._createAppGridItem(app);
            currentRow.add_child(btn);
        }

        if (!hasFilter) {
            this._appsDefaultLoaded = true;
        } else {
            this._appsDefaultLoaded = false;
        }
    }

    _createAppGridItem(app) {
        const item = new St.Button({
            style_class: 'mac-app-grid-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.START,
        });

        item.set_width(APPS_COLUMN_WIDTH);
        item.width = APPS_COLUMN_WIDTH;
        const baseStyle = `width: ${APPS_COLUMN_WIDTH}px; min-width: ${APPS_COLUMN_WIDTH}px; max-width: ${APPS_COLUMN_WIDTH}px; height: 82px; min-height: 82px; max-height: 82px; margin: 0 1px; padding: 6px 2px 4px 2px; border-radius: 12px;`;
        item.set_style(`${baseStyle} background-color: transparent;`);

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        item.set_child(box);

        const iconActor = createSmoothAppIcon(app, APPS_ICON_SIZE);
        iconActor.set_style('margin-bottom: 5px; icon-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);');
        box.add_child(iconActor);

        const label = new St.Label({
            text: app.get_name() || '',
            style_class: 'mac-app-title',
            style: `font-size: 11px !important; color: #ffffff !important; ` +
                   `text-align: center !important; font-weight: 500 !important; ` +
                   `text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; ` +
                   `width: ${APPS_COLUMN_WIDTH - 4}px; max-width: ${APPS_COLUMN_WIDTH - 4}px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        if (label.clutter_text) {
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        }
        box.add_child(label);

        item.connect('notify::hover', () => {
            if (item.hover) {
                item.set_style(`${baseStyle} background-color: rgba(255, 255, 255, 0.12);`);
            } else {
                item.set_style(`${baseStyle} background-color: transparent;`);
            }
        });

        item.connect('clicked', () => {
            this.close();
            app.activate();
        });

        // DND Support to Dock
        item._delegate = item;
        item.app = app;
        item.is_window_backed = () => false;
        item.getDragActor = () => createSmoothAppIcon(app, APPS_ICON_SIZE);
        item.getDragActorSource = () => item;
        try {
            const draggable = DND.makeDraggable(item, {
                restoreOnSuccess: true,
                dragActorOpacity: 220,
            });
            draggable.connect('drag-begin', () => {
                this.close();
            });
        } catch (_) {}

        return item;
    }

    // -------------------------------------------------------------------------
    // CLIPBOARD VIEW (Clipboard History with Authentic Image Thumbnails)
    // -------------------------------------------------------------------------
    _loadClipboardView(query = '') {
        this._clipboardContentBox.destroy_all_children();

        let items = [];
        try {
            if (GLib.file_test(CLIPBOARD_CACHE_FILE, GLib.FileTest.EXISTS)) {
                const [ok, bytes] = GLib.file_get_contents(CLIPBOARD_CACHE_FILE);
                if (ok) {
                    items = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                }
            }
        } catch (_) {}

        if (query) {
            const q = query.toLowerCase();
            items = items.filter(it => {
                const t = (it.title || '').toLowerCase();
                const s = (it.subtitle || '').toLowerCase();
                const txt = (it.text || '').toLowerCase();
                return t.includes(q) || s.includes(q) || txt.includes(q);
            });
        }

        if (items.length === 0) {
            const emptyLbl = new St.Label({
                text: t('clipboard_empty', 'Буфер обміну порожній'),
                style: 'font-size: 14px; color: rgba(255, 255, 255, 0.45); margin: 40px auto;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._clipboardContentBox.add_child(emptyLbl);
            return;
        }

        for (const item of items.slice(0, 30)) {
            const rowBtn = new St.Button({
                style: 'padding: 8px 12px; margin-bottom: 4px; border-radius: 12px; background-color: rgba(255, 255, 255, 0.06);',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: true,
            });

            const row = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBtn.set_child(row);

            // Left Thumbnail / Icon slot (38x38 px)
            const iconSlot = new St.BoxLayout({
                style: 'width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; clip-to-allocation: true;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            if (item.type === 'image' && item.imagePath && GLib.file_test(item.imagePath, GLib.FileTest.EXISTS)) {
                iconSlot.set_style('width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: rgba(0, 0, 0, 0.30); clip-to-allocation: true;');
                const imgIcon = new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(item.imagePath)),
                    icon_size: 38,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                applyActorSmoothing(imgIcon);
                iconSlot.add_child(imgIcon);
            } else if (item.type === 'color' && item.text) {
                iconSlot.set_style(`width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: ${item.text}; border: 1px solid rgba(255, 255, 255, 0.20);`);
            } else {
                iconSlot.set_style('width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: rgba(255, 255, 255, 0.06);');
                let iconName = 'text-x-generic-symbolic';
                if (item.type === 'file') iconName = 'folder-symbolic';
                else if (item.type === 'link') iconName = 'emblem-web-symbolic';

                const icon = new St.Icon({
                    icon_name: iconName,
                    icon_size: 22,
                    style: 'color: rgba(255, 255, 255, 0.85);',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                iconSlot.add_child(icon);
            }
            row.add_child(iconSlot);

            // Text column
            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(textBox);

            const titleLbl = new St.Label({
                text: item.title || item.text || 'Елемент',
                style: 'font-size: 13.5px; font-weight: 600; color: #ffffff;',
                x_align: Clutter.ActorAlign.START,
            });
            if (titleLbl.clutter_text) {
                titleLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            }
            textBox.add_child(titleLbl);

            const timeStr = item.timestamp ? ` • ${formatTimeAgo(item.timestamp)}` : '';
            const subText = `${item.subtitle || ''}${timeStr}`.trim();
            if (subText) {
                const subLbl = new St.Label({
                    text: subText,
                    style: 'font-size: 11px; color: rgba(255, 255, 255, 0.48); margin-top: 2px;',
                    x_align: Clutter.ActorAlign.START,
                });
                textBox.add_child(subLbl);
            }

            // Right Copy Button
            const copyBtn = new St.Button({
                style_class: 'mac-clipboard-copy-btn',
                style: 'width: 32px; height: 32px; min-width: 32px; min-height: 32px; border-radius: 9999px; background-color: rgba(255, 255, 255, 0.08); margin-left: 8px;',
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const copyIcon = new St.Icon({
                icon_name: 'edit-copy-symbolic',
                icon_size: 15,
                style: 'color: rgba(255, 255, 255, 0.85);',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            copyBtn.set_child(copyIcon);

            copyBtn.connect('clicked', () => {
                if (globalThis.macClipboardStore) {
                    globalThis.macClipboardStore.restore(item);
                    try { globalThis.macClipboardStore.moveToTop?.(item); } catch (_) {}
                }
                copyIcon.icon_name = 'object-select-symbolic';
                copyIcon.style = 'color: #34c759;';
            });
            row.add_child(copyBtn);

            rowBtn.connect('notify::hover', () => {
                if (rowBtn.hover) {
                    rowBtn.set_style('padding: 8px 12px; margin-bottom: 4px; border-radius: 12px; background-color: rgba(255, 255, 255, 0.16);');
                } else {
                    rowBtn.set_style('padding: 8px 12px; margin-bottom: 4px; border-radius: 12px; background-color: rgba(255, 255, 255, 0.06);');
                }
            });

            rowBtn.connect('clicked', () => {
                if (globalThis.macClipboardStore) {
                    globalThis.macClipboardStore.restore(item);
                }
                this.close();
            });

            this._clipboardContentBox.add_child(rowBtn);
        }
    }

    _onDestroy() {
        this._cancelSyncLoop();
        if (Main.overview) {
            try { Main.overview.disconnectObject(this); } catch (_) {}
        }
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }
        if (this._debounceId) {
            try { GLib.source_remove(this._debounceId); } catch (_) {}
            this._debounceId = 0;
        }
        if (this._systemModalSignalId) {
            try { Main.layoutManager.disconnect(this._systemModalSignalId); } catch (_) {}
            this._systemModalSignalId = 0;
        }
        if (this._screenshotSignalId && Main.screenshotUI) {
            try { Main.screenshotUI.disconnect(this._screenshotSignalId); } catch (_) {}
            this._screenshotSignalId = 0;
        }
        if (this._glass) {
            try { this._glass.destroy(); } catch (_) {}
            this._glass = null;
        }
    }

    destroy() {
        this._onDestroy();
        super.destroy();
    }
});

let _spotlightDialog = null;

export function ensureSearchDialog() {
    if (_spotlightDialog) {
        let isDead = false;
        try {
            if (!_spotlightDialog.get_parent() || !_isActorValid(_spotlightDialog)) {
                isDead = true;
            }
        } catch (_) {
            isDead = true;
        }
        if (isDead) {
            try { _spotlightDialog.destroy(); } catch (_) {}
            _spotlightDialog = null;
        }
    }
    if (!_spotlightDialog) {
        try {
            const strays = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'mac-spotlight-wrapper');
            strays.forEach(s => { try { s.destroy(); } catch (_) {} });
        } catch (_) {}
        _spotlightDialog = new MacSpotlightDialog();
    }
    globalThis._macSpotlightGlobalInstance = _spotlightDialog;
    globalThis._macSpotlightToggle = toggleSearchDialog;
    globalThis.toggleMacSpotlight = toggleSearchDialog;
    globalThis.closeMacSpotlight = closeSearchDialog;
    return _spotlightDialog;
}

export function toggleSearchDialog() {
    ensureSearchDialog();

    if (_spotlightDialog._isOpen) {
        _spotlightDialog.close();
        return;
    }

    const isClipboardOpen = !!(globalThis._macClipboardGlobalInstance?._isOpen);
    const isNCOpen = !!(globalThis._tahoeNCOpen ||
                        (typeof globalThis.__tahoeNC?.isNCOpen === 'function' && globalThis.__tahoeNC.isNCOpen()) ||
                        Main.panel.statusArea?.dateMenu?.menu?.isOpen);
    const isQSOpen = !!(globalThis._tahoeQSIsOpen ||
                        Main.panel.statusArea?.quickSettings?.menu?.isOpen);
    const isAppsOpen = !!(globalThis._macApplicationsGlobalInstance?._isOpen ||
                          globalThis._macAppsMenuGlobalInstance?._isOpen);

    if (isClipboardOpen || isNCOpen || isQSOpen || isAppsOpen) {
        try { globalThis._macClipboardGlobalInstance?.close?.(false); } catch (_) {}
        try { globalThis._tahoeNCClose?.(false); } catch (_) {}
        try { globalThis.__tahoeNC?.closeNC?.(false); } catch (_) {}
        try { globalThis._tahoeQSClose?.(); } catch (_) {}
        try { globalThis._macApplicationsGlobalInstance?.close?.(false); } catch (_) {}
        try { globalThis._macAppsMenuGlobalInstance?.close?.(false); } catch (_) {}
        if (Main.panel.statusArea?.dateMenu?.menu?.isOpen) {
            try { Main.panel.statusArea.dateMenu.menu.close(true); } catch (_) {}
        }
        if (Main.panel.statusArea?.quickSettings?.menu?.isOpen) {
            try { Main.panel.statusArea.quickSettings.menu.close(true); } catch (_) {}
        }
        return;
    }

    if (typeof globalThis._macCloseAllCenters === 'function') {
        globalThis._macCloseAllCenters('spotlight');
    }
    if (Main.overview?.visible) {
        Main.overview.hide();
    }
    _spotlightDialog.open();
}

export function closeSearchDialog(immediate = true) {
    if (_spotlightDialog) {
        _spotlightDialog.close(immediate);
    }
}

export function destroySearchDialog() {
    if (_spotlightDialog) {
        try { _spotlightDialog.destroy(); } catch (_) {}
        _spotlightDialog = null;
    }
}

globalThis._macSpotlightToggle = toggleSearchDialog;
globalThis.toggleMacSpotlight = toggleSearchDialog;
globalThis.closeMacSpotlight = closeSearchDialog;
globalThis._macSpotlightClose = closeSearchDialog;
