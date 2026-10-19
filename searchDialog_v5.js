import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { _ } from './i18n.js';
import { t, tf } from './mac_i18n.js';

const RECENT_ITEMS_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const CLIPBOARD_CACHE_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'mac-clipboard', 'history.json']);
const ICONS_DIR = '/home/vitaliy/macW1Y/icons';

const SEARCH_DEBOUNCE_MS = 50;
const DIALOG_WIDTH = 700;
const PILL_HEIGHT = 54;
const COLLAPSED_PILL_WIDTH = 480;
const BUTTONS_BOX_WIDTH = 192;
const BUTTON_SIZE = 50;
const CORNER_RADIUS = 26;

const PILL_COLLAPSED_STYLE =
    'width: 480px; min-width: 480px; max-width: 480px; height: 54px; min-height: 54px; padding: 0 16px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
    'border-radius: 27px; ' +
    'box-shadow: none !important;';

const PILL_EXPANDED_STYLE =
    'width: 700px; min-width: 700px; max-width: 700px; height: 54px; min-height: 54px; padding: 0 20px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
    'border-radius: 26px 26px 0 0; ' +
    'box-shadow: none !important;';

const _gobjectToString = GObject.Object.prototype.toString;

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
        if (glass._cleanedUp) return false;
        return typeof glass.visible === 'boolean' && glass.get_parent() !== null;
    } catch (_) {
        return false;
    }
}

const BTN_NORMAL_STYLE =
    'width: 50px; min-width: 50px; height: 50px; min-height: 50px; ' +
    'border-radius: 26px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
    'box-shadow: none !important;';

const BTN_HOVER_STYLE =
    'width: 50px; min-width: 50px; height: 50px; min-height: 50px; ' +
    'border-radius: 26px; ' +
    'background-color: transparent !important; ' +
    'background: none !important; ' +
    'border: none !important; ' +
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
        this._mode = 'search'; // 'search' | 'files' | 'apps' | 'clipboard'
        this._buttonsCollapsed = false;
        this._activeFilter = null; // null | 'preview' | 'pages' | 'pdf' | 'video' | 'text'

        this._appSystem = Shell.AppSystem.get_default();
        this._resultButtons = [];
        this._selectedIndex = -1;
        this._debounceId = 0;
        this._lastQuery = '';
        this._modalGrab = null;

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
        this.add_child(this._box);
        this._box.connect('notify::height', () => this._syncGlass());
        this._box.connect('notify::width', () => this._syncGlass());

        this.connect('destroy', () => {
            this._onDestroy();
        });

        this._glass = null;
        this._initializingGlass = false;
        this._stageSignalId = 0;

        // 3. Top Row Container: Contains Search Pill + 3 Circular Action Buttons
        this._topRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'height: 54px; min-height: 54px;',
            clip_to_allocation: false,
        });
        this._box.add_child(this._topRow);

        // 3A. Search Pill (Width: 492px collapsed, 680px expanded)
        this._searchPill = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            width: COLLAPSED_PILL_WIDTH,
            style: PILL_COLLAPSED_STYLE,
        });
        this._topRow.add_child(this._searchPill);

        this._searchIcon = new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 20,
            style: 'color: rgba(255, 255, 255, 0.65); margin-left: 4px; margin-right: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchPill.add_child(this._searchIcon);

        this._entry = new St.Entry({
            style_class: 'mac-spotlight-entry',
            style: 'font-size: 19px !important; color: #ffffff !important; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; outline: none !important;',
            hint_text: t('spotlight_search', 'Пошук Spotlight'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (this._entry.clutter_text?.set_single_line_mode) {
            this._entry.clutter_text.set_single_line_mode(true);
        }
        this._searchPill.add_child(this._entry);

        // Options Button `...` (more options button on right of search pill, visible in 'files' mode)
        this._optionsBtn = new St.Button({
            style: 'width: 32px; height: 32px; border-radius: 16px; background-color: rgba(255, 255, 255, 0.08); margin-right: 2px;',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            reactive: true,
            can_focus: true,
        });
        const optionsLbl = new St.Label({
            text: '•••',
            style: 'font-size: 11px; font-weight: bold; color: rgba(255, 255, 255, 0.75);',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._optionsBtn.set_child(optionsLbl);
        this._optionsBtn.connect('clicked', () => {
            // Toggle sort order or refresh files
            this._loadFilesView();
        });
        this._searchPill.add_child(this._optionsBtn);

        // 3B. Buttons Container: Holds the 3 Circular Buttons on the right
        this._buttonsBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;',
            clip_to_allocation: false,
        });
        this._topRow.add_child(this._buttonsBox);

        // Button 1: Центр програм (App Store 'A' icon) - launches existing system Applications dialog from the dock
        this._btnApps = this._createCircleButton('mac-spotlight-apps', t('applications', 'Центр програм'), () => {
            const boxPos = this._box.get_transformed_position();
            const fromRect = {
                x: boxPos[0],
                y: boxPos[1],
                width: this._box.width,
                height: this._box.height,
            };
            this.close(true);
            if (typeof globalThis.toggleMacApplications === 'function') {
                globalThis.toggleMacApplications({ fromRect });
            }
        });
        this._buttonsBox.add_child(this._btnApps);

        // Gap 10px
        const gap1 = new St.Widget({ width: 10, height: 1 });
        this._buttonsBox.add_child(gap1);

        // Button 2: Файли (Folder icon) - opens existing system Files (Nautilus)
        this._btnFiles = this._createCircleButton('mac-spotlight-files', t('files', 'Файли'), () => {
            this.close(true);
            const app = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
            if (app) {
                app.activate();
            }
        });
        this._buttonsBox.add_child(this._btnFiles);

        // Gap 10px
        const gap2 = new St.Widget({ width: 10, height: 1 });
        this._buttonsBox.add_child(gap2);

        // Button 3: Буфер обміну (Clipboard icon) - opens existing system Mac Clipboard dialog
        this._btnClipboard = this._createCircleButton('mac-spotlight-clipboard', t('clipboard', 'Буфер обміну'), () => {
            const boxPos = this._box.get_transformed_position();
            const fromRect = {
                x: boxPos[0],
                y: boxPos[1],
                width: this._box.width,
                height: this._box.height,
            };
            this.close(true);
            if (typeof globalThis.toggleMacClipboard === 'function') {
                globalThis.toggleMacClipboard({ fromRect });
            }
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
            style: 'max-height: 420px;',
        });
        this._scrollWrapper.add_child(this._scrollView);

        this._resultsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0 18px 14px 10px;',
        });
        this._scrollView.add_child(this._resultsBox);

        this._bottomFade = new St.Widget({
            style: 'background-gradient-direction: vertical; ' +
                   'background-gradient-start: rgba(18, 18, 18, 0.0); ' +
                   'background-gradient-end: rgba(18, 18, 18, 0.25); ' +
                   'border-bottom-left-radius: 26px; ' +
                   'border-bottom-right-radius: 26px;',
            height: 38,
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

        this._filesScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 480px;',
        });
        this._filesView.add_child(this._filesScrollView);

        this._filesContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0 18px 18px 18px;',
        });
        this._filesScrollView.add_child(this._filesContentBox);

        // 4C. Apps View
        this._appsView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._resultsWrapper.add_child(this._appsView);

        this._appsScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 460px;',
        });
        this._appsView.add_child(this._appsScrollView);

        this._appsContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 10px 18px 18px 18px;',
        });
        this._appsScrollView.add_child(this._appsContentBox);

        // 4D. Clipboard View
        this._clipboardView = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._resultsWrapper.add_child(this._clipboardView);

        this._clipboardScrollView = new St.ScrollView({
            style_class: 'mac-spotlight-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'max-height: 460px;',
        });
        this._clipboardView.add_child(this._clipboardScrollView);

        this._clipboardContentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 10px 18px 18px 18px;',
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

            if (symbol === Clutter.KEY_Escape) {
                if (this._mode !== 'search') {
                    this._setMode('search');
                    return Clutter.EVENT_STOP;
                }
                this.close();
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                this.close(true);
                Main.overview.show();
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
                style: 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.88);',
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
                btn._label.set_style('font-size: 13px; font-weight: 700; color: #ffffff;');
            } else {
                btn.set_style(
                    'background-color: rgba(255, 255, 255, 0.12); ' +
                    'border-radius: 14px; ' +
                    'padding: 5px 14px; ' +
                    'margin-right: 8px;'
                );
                btn._label.set_style('font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.88);');
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
        const tintVal = isDark ? 0.0 : 1.0;
        const tintStrength = 0.03; // Exactly 3% as requested by user
        return { isDark, tintVal, tintStrength };
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
            const { tintVal, tintStrength } = this._getThemeParams();
            this._glass.setIsDock(false);
            this._glass.setCornerSmoothingEnabled(0.0);
            this._glass.setCornerRadius(CORNER_RADIUS);
            this._glass.setTintColor(tintVal, tintVal, tintVal);
            this._glass.setTintStrength(tintStrength);
            this._glass.setBrightness(1.0);
            this._glass.setSaturation(1.0);
            this._glass.setContrast(1.0);
            this._glass.setBlurRadius(2.0);
            this._glass.setPadding(0);
            try {
                this._glass._renderer.uniforms.set('shadow_intensity', 0.0);
                this._glass._renderer.uniforms.set('shadow_radius', 0.0);
                this._glass._renderer.uniforms.set('shadow_max_radius', 0.0);
            } catch (_) {}
            this._glass.hide();

            if (!this._isOpen) {
                try { this._glass.hide(); } catch (_) {}
                return;
            }

            if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
            }
            this._syncGlass();
        } catch (e) {
            console.error(`[Spotlight] Error initializing BackdropGlass: ${e}`);
        } finally {
            this._initializingGlass = false;
        }
    }

    _collapseButtonsAndExpandPill() {
        if (this._buttonsCollapsed) return;
        this._buttonsCollapsed = true;

        this._buttonsBox.visible = false;
        this._buttonsBox.opacity = 0;
        this._buttonsBox.set_style('width: 0; min-width: 0; max-width: 0; margin: 0; padding: 0;');

        this._searchPill.set_style(PILL_EXPANDED_STYLE);
        this._searchPill.width = DIALOG_WIDTH;

        try { this._syncGlass(); } catch (_) {}
    }

    _uncollapseButtonsAndContractPill() {
        if (!this._buttonsCollapsed) return;
        this._buttonsCollapsed = false;

        this._searchPill.set_style(PILL_COLLAPSED_STYLE);
        this._searchPill.width = COLLAPSED_PILL_WIDTH;

        this._buttonsBox.set_style('margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;');
        this._btnApps.translation_x = 0;
        this._btnApps.opacity = 255;
        this._btnFiles.translation_x = 0;
        this._btnFiles.opacity = 255;
        this._btnClipboard.scale_x = 1.0;
        this._btnClipboard.scale_y = 1.0;
        this._btnClipboard.opacity = 255;
        this._buttonsBox.opacity = 255;
        this._buttonsBox.visible = true;

        this._resultsWrapper.visible = false;
        this._resultsWrapper.opacity = 0;
        this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);

        try { this._syncGlass(); } catch (_) {}
    }

    _syncGlass() {
        try {
            if (!this._isOpen || !_isGlassAlive(this._glass)) {
                return;
            }

            const box = this._box;
            if (!box || !_isActorValid(box) || !box.visible) {
                return;
            }

            const opacity = box.get_paint_opacity ? box.get_paint_opacity() : box.opacity;
            if (opacity <= 0) {
                return;
            }

            const mon = Main.layoutManager.primaryMonitor;
            const scaleX = box.scale_x ?? 1.0;
            const scaleY = box.scale_y ?? 1.0;
            const rawW = box.width > 0 ? box.width : DIALOG_WIDTH;
            const rawH = box.height > 0 ? box.height : PILL_HEIGHT;

            if (this._glass.opacity !== opacity) {
                this._glass.opacity = opacity;
            }
            if (!this._glass.visible) {
                this._glass.show();
            }

            this._glass.set_position(mon.x, mon.y);
            this._glass.set_size(mon.width, mon.height);
            this._glass.setResolution(mon.width, mon.height);

            const hasText = (this._entry && this._entry.get_text) ? this._entry.get_text().trim().length > 0 : false;
            const hasResults = this._resultsWrapper && this._resultsWrapper.visible && (box.height > PILL_HEIGHT + 10);
            const isExpanded = this._buttonsCollapsed || hasText || hasResults || this._mode !== 'search';

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

                const { tintVal, tintStrength } = this._getThemeParams();
                const regions = [
                    { x: pillX, y: pillY, w: pillW, h: pillH, tintR: tintVal, tintG: tintVal, tintB: tintVal, baseStrength: tintStrength },
                    { x: b1X, y: b1Y, w: b1W, h: b1H, tintR: tintVal, tintG: tintVal, tintB: tintVal, baseStrength: this._btnApps.hover ? tintStrength * 2.5 : tintStrength },
                    { x: b2X, y: b2Y, w: b2W, h: b2H, tintR: tintVal, tintG: tintVal, tintB: tintVal, baseStrength: this._btnFiles.hover ? tintStrength * 2.5 : tintStrength },
                    { x: b3X, y: b3Y, w: b3W, h: b3H, tintR: tintVal, tintG: tintVal, tintB: tintVal, baseStrength: this._btnClipboard.hover ? tintStrength * 2.5 : tintStrength },
                ];

                const minX = Math.min(pillX, b1X, b2X, b3X);
                const minY = Math.min(pillY, b1Y, b2Y, b3Y);
                const maxX = Math.max(pillX + pillW, b1X + b1W, b2X + b2W, b3X + b3W);
                const maxY = Math.max(pillY + pillH, b1Y + b1H, b2Y + b2H, b3Y + b3H);

                this._glass.setMultiRegionMode(true);
                this._glass.setGlassRegions(regions);
                this._glass.set_clip(minX - 4, minY - 4, (maxX - minX) + 8, (maxY - minY) + 8);
            } else {
                const w = Math.round(DIALOG_WIDTH * scaleX);
                const h = Math.round(rawH * scaleY);
                const bx = box.x;
                const by = box.y;

                const localBgX = Math.round(bx - mon.x);
                const localBgY = Math.round(by - mon.y);
                const bgW = Math.round(w);
                const bgH = Math.round(h);

                this._glass.setMultiRegionMode(false);
                const { tintVal, tintStrength } = this._getThemeParams();
                this._glass.setTintColor(tintVal, tintVal, tintVal);
                this._glass.setTintStrength(tintStrength);
                this._glass.setCornerRadius(CORNER_RADIUS);
                this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
                this._glass.set_clip(localBgX - 4, localBgY - 4, bgW + 8, bgH + 8);
            }

            if (typeof this._glass.syncSources === 'function') {
                this._glass.syncSources();
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
            this._entry.hint_text = t('spotlight_search', 'Пошук Spotlight');
            this._optionsBtn.visible = false;

            this._filesView.visible = false;
            this._appsView.visible = false;
            this._clipboardView.visible = false;
            this._searchView.visible = true;

            this._uncollapseButtonsAndContractPill();
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
                this._entry.hint_text = t('files', 'Файли');
                this._optionsBtn.visible = true;
                this._loadFilesView();
                this._expandToHeight(580);
            } else if (newMode === 'apps') {
                const f = Gio.File.new_for_path(`${ICONS_DIR}/mac-spotlight-apps.svg`);
                this._searchIcon.set_gicon(new Gio.FileIcon({ file: f }));
                this._entry.hint_text = t('search_apps', 'Пошук програм');
                this._optionsBtn.visible = false;
                this._loadAppsView();
                this._expandToHeight(540);
            } else if (newMode === 'clipboard') {
                const f = Gio.File.new_for_path(`${ICONS_DIR}/mac-spotlight-clipboard.svg`);
                this._searchIcon.set_gicon(new Gio.FileIcon({ file: f }));
                this._entry.hint_text = t('search_clipboard', 'Пошук у буфері');
                this._optionsBtn.visible = false;
                this._loadClipboardView();
                this._expandToHeight(540);
            }
        }
    }

    _expandToHeight(targetHeight) {
        if (!this._resultsWrapper.visible) {
            this._resultsWrapper.visible = true;
            this._resultsWrapper.opacity = 0;
        }

        this._box.ease({
            height: targetHeight,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        this._resultsWrapper.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        try { this._syncGlass(); } catch (_) {}
    }

    open() {
        if (this._isOpen) return;
        if (Main.overview?.visible) return;
        this._isOpen = true;
        this._mode = 'search';
        this._buttonsCollapsed = false;
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
        this._box.set_pivot_point(0.5, 0.0);
        this._box.scale_x = 0.94;
        this._box.scale_y = 0.94;
        this._box.opacity = 0;

        // Reset search pill and buttons
        this._searchPill.set_size(COLLAPSED_PILL_WIDTH, PILL_HEIGHT);
        this._searchPill.width = COLLAPSED_PILL_WIDTH;
        this._searchPill.set_style(PILL_COLLAPSED_STYLE);
        this._buttonsBox.set_style('margin-left: 16px; width: 192px; min-width: 192px; height: 54px; padding-right: 8px;');
        this._buttonsBox.visible = true;
        this._buttonsBox.opacity = 255;
        this._btnApps.translation_x = 0;
        this._btnApps.opacity = 255;
        this._btnFiles.translation_x = 0;
        this._btnFiles.opacity = 255;
        this._btnClipboard.scale_x = 1.0;
        this._btnClipboard.scale_y = 1.0;
        this._btnClipboard.opacity = 255;

        this._searchIcon.set_gicon(null);
        this._searchIcon.icon_name = 'system-search-symbolic';
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

        this._box.remove_all_transitions();
        this.remove_all_transitions();

        if (!this.get_parent()) {
            Main.layoutManager.uiGroup.add_child(this);
        }
        this.visible = true;

        let glassValid = false;
        try {
            if (_isGlassAlive(this._glass)) {
                glassValid = true;
            }
        } catch (_) {
            glassValid = false;
            this._glass = null;
        }

        if (glassValid) {
            try {
                this._glass.remove_all_transitions();
                if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                    Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
                }
                Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
                Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
                this._glass.show();
                this._glass.opacity = 255;
                this._glass._backdropLocked = false;
                if (typeof this._glass.forceRefresh === 'function') {
                    this._glass.forceRefresh(1);
                }
                this._syncGlass();
            } catch (err) {
                this._glass = null;
                this._initGlass();
                Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
            }
        } else {
            this._glass = null;
            this._initGlass();
            Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
        }

        if (!this._stageSignalId) {
            this._stageSignalId = global.stage.connect('before-update', () => {
                try {
                    this._syncGlass();
                } catch (e) {
                    if (this._stageSignalId) {
                        try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
                        this._stageSignalId = 0;
                    }
                }
            });
        }

        try {
            if (global.stage.grab) {
                this._modalGrab = global.stage.grab(this);
            } else {
                Main.pushModal(this);
            }
        } catch (_) {}

        this._entry.grab_key_focus();

        this._box.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._syncGlass();
            },
        });
    }

    close(immediate = false) {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }

        if (this._modalGrab) {
            try { this._modalGrab.dismiss(); } catch (_) {}
            this._modalGrab = null;
        } else {
            try { Main.popModal(this); } catch (_) {}
        }

        const hideGlass = () => {
            try {
                if (_isGlassAlive(this._glass)) {
                    this._glass.remove_all_transitions();
                    this._glass.opacity = 0;
                    this._glass.visible = false;
                    this._glass.hide();
                    this._glass._backdropLocked = false;
                }
            } catch (_) {}
        };

        if (immediate) {
            hideGlass();
            this._box.remove_all_transitions();
            this._box.opacity = 0;
            this.visible = false;
            this._backdrop.visible = false;
            this._entry.text = '';
            this._resultsWrapper.visible = false;
            this._resultsBox.destroy_all_children();
            this._resultButtons = [];
            this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
            return;
        }

        if (_isGlassAlive(this._glass)) {
            this._glass.ease({
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    hideGlass();
                },
            });
        }
        this._backdrop.visible = false;
        this._box.ease({
            opacity: 0,
            scale_x: 0.94,
            scale_y: 0.94,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.visible = false;
                this._entry.text = '';
                this._resultsWrapper.visible = false;
                this._resultsBox.destroy_all_children();
                this._resultButtons = [];
                this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
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
        const q = query.toLowerCase();
        const apps = this._appSystem.get_installed();
        const hits = [];

        for (const app of apps) {
            const name = app.get_name() || '';
            const desc = app.get_description() || '';
            const id = app.get_id() || '';
            const exec = (app.get_app_info ? app.get_app_info()?.get_executable?.() : null) || '';
            const text = `${name} ${desc} ${id} ${exec}`.toLowerCase();

            let score = 99;
            if (name.toLowerCase().startsWith(q) || exec.toLowerCase().startsWith(q)) score = 1;
            else if (text.includes(q)) score = 2;

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
                duration: 140,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    this._resultsWrapper.visible = false;
                },
            });
            this._box.ease({
                height: PILL_HEIGHT,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
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
                const gicon = item.app.get_icon ? item.app.get_icon() : null;
                if (gicon) {
                    iconActor = new St.Icon({ gicon, icon_size: 32 });
                } else if (item.app.create_icon_texture) {
                    iconActor = item.app.create_icon_texture(32);
                } else {
                    iconActor = new St.Icon({ icon_name: 'application-x-executable', icon_size: 32 });
                }
            } else if (item.iconName) {
                iconActor = new St.Icon({
                    icon_name: item.iconName,
                    icon_size: 24,
                    style: item.type === 'fallback-gemini' ? 'color: #388bfd;' : 'color: rgba(255, 255, 255, 0.90);',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
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
                style: 'font-size: 14px; font-weight: 500; color: #ffffff;',
                x_align: Clutter.ActorAlign.START,
            });
            textBox.add_child(titleLbl);

            if (item.subtitle) {
                const subLbl = new St.Label({
                    text: item.subtitle,
                    style_class: 'mac-spotlight-item-subtitle',
                    style: 'font-size: 11px; color: rgba(255, 255, 255, 0.55);',
                    x_align: Clutter.ActorAlign.START,
                });
                textBox.add_child(subLbl);
            }

            // Category badge
            if (item.category) {
                const badge = new St.Label({
                    text: item.category,
                    style_class: 'mac-spotlight-item-badge',
                    style: 'font-size: 11px; color: rgba(255, 255, 255, 0.40); padding: 2px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.08); margin-left: 8px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                row.add_child(badge);
            }

            btn.itemData = item;
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
        const targetHeight = PILL_HEIGHT + 14 + visibleCount * 52;
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
                if (item.app) item.app.activate();
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
        const files = [];
        const seen = new Set();

        // 1. Read recently-used.xbel
        try {
            if (GLib.file_test(RECENT_ITEMS_FILE, GLib.FileTest.EXISTS)) {
                const [ok, bytes] = GLib.file_get_contents(RECENT_ITEMS_FILE);
                if (ok) {
                    const xml = new TextDecoder('utf-8').decode(bytes);
                    const matches = [...xml.matchAll(/<bookmark href="([^"]+)"[\s\S]*?(?:<title>([^<]*)<\/title>)?[\s\S]*?<\/bookmark>/g)];
                    for (let i = matches.length - 1; i >= 0; i--) {
                        const m = matches[i];
                        const uri = m[1];
                        if (!uri || !uri.startsWith('file://')) continue;
                        const path = decodeURIComponent(uri.replace('file://', ''));
                        if (seen.has(path)) continue;
                        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) continue;
                        seen.add(path);

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

        // 2. Complement with standard directories
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
                while ((info = enumerator.next_file(null)) !== null) {
                    if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                    const name = info.get_name();
                    if (name.startsWith('.')) continue;
                    const path = GLib.build_filenamev([d, name]);
                    if (seen.has(path)) continue;
                    seen.add(path);
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
            style: 'font-size: 13px; font-weight: 700; color: #ffffff; margin: 4px 6px 10px 6px;',
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
                style: 'font-size: 13px; font-weight: 700; color: #ffffff; margin: 10px 6px 10px 6px;',
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
            style: 'font-size: 11px; font-weight: 500; color: #ffffff; text-align: center; margin-top: 6px; max-width: 112px;',
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
    // APPS VIEW (Applications Menu)
    // -------------------------------------------------------------------------
    _loadAppsView(query = '') {
        this._appsContentBox.destroy_all_children();

        const q = query.toLowerCase();
        const apps = this._appSystem.get_installed().filter(app => {
            if (!q) return true;
            const name = (app.get_name() || '').toLowerCase();
            const desc = (app.get_description() || '').toLowerCase();
            return name.includes(q) || desc.includes(q);
        });

        if (apps.length === 0) {
            const emptyLbl = new St.Label({
                text: t('no_apps_found', 'Немає програм'),
                style: 'font-size: 14px; color: rgba(255, 255, 255, 0.45); margin: 40px auto;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._appsContentBox.add_child(emptyLbl);
            return;
        }

        let currentRow = null;
        for (let i = 0; i < apps.length; i++) {
            if (i % 5 === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    style: 'margin-bottom: 12px;',
                });
                this._appsContentBox.add_child(currentRow);
            }

            const app = apps[i];
            const btn = new St.Button({
                style: 'width: 124px; min-width: 124px; padding: 10px 4px; border-radius: 12px; margin-right: 4px;',
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

            const gicon = app.get_icon ? app.get_icon() : null;
            let iconTexture;
            if (gicon) {
                iconTexture = new St.Icon({ gicon, icon_size: 46 });
            } else if (app.create_icon_texture) {
                iconTexture = app.create_icon_texture(46);
            } else {
                iconTexture = new St.Icon({ icon_name: 'application-x-executable', icon_size: 46 });
            }
            iconTexture.x_align = Clutter.ActorAlign.CENTER;
            col.add_child(iconTexture);

            const nameLbl = new St.Label({
                text: app.get_name(),
                style: 'font-size: 12px; font-weight: 500; color: #ffffff; text-align: center; margin-top: 6px; max-width: 112px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (nameLbl.clutter_text) {
                nameLbl.clutter_text.set_line_wrap(true);
                nameLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            }
            col.add_child(nameLbl);

            btn.connect('notify::hover', () => {
                if (btn.hover) {
                    btn.set_style('width: 124px; min-width: 124px; padding: 10px 4px; border-radius: 12px; margin-right: 4px; background-color: rgba(255, 255, 255, 0.12);');
                } else {
                    btn.set_style('width: 124px; min-width: 124px; padding: 10px 4px; border-radius: 12px; margin-right: 4px; background-color: transparent;');
                }
            });

            btn.connect('clicked', () => {
                this.close();
                app.activate();
            });

            currentRow.add_child(btn);
        }
    }

    // -------------------------------------------------------------------------
    // CLIPBOARD VIEW (Clipboard History)
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
                style: 'padding: 8px 12px; margin-bottom: 4px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.06);',
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

            // Icon
            let iconName = 'edit-copy-symbolic';
            if (item.type === 'image') iconName = 'image-x-generic-symbolic';
            else if (item.type === 'file') iconName = 'folder-symbolic';

            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 22,
                style: 'color: rgba(255, 255, 255, 0.75); margin-right: 12px;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(icon);

            // Text column
            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(textBox);

            const titleLbl = new St.Label({
                text: item.title || item.text || 'Елемент',
                style: 'font-size: 13px; font-weight: 500; color: #ffffff;',
                x_align: Clutter.ActorAlign.START,
            });
            if (titleLbl.clutter_text) {
                titleLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            }
            textBox.add_child(titleLbl);

            if (item.subtitle) {
                const subLbl = new St.Label({
                    text: item.subtitle,
                    style: 'font-size: 11px; color: rgba(255, 255, 255, 0.45);',
                    x_align: Clutter.ActorAlign.START,
                });
                textBox.add_child(subLbl);
            }

            // Copy Action Button
            const copyIcon = new St.Icon({
                icon_name: 'edit-copy-symbolic',
                icon_size: 16,
                style: 'color: rgba(255, 255, 255, 0.50); margin-left: 8px;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(copyIcon);

            rowBtn.connect('notify::hover', () => {
                if (rowBtn.hover) {
                    rowBtn.set_style('padding: 8px 12px; margin-bottom: 4px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.16);');
                } else {
                    rowBtn.set_style('padding: 8px 12px; margin-bottom: 4px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.06);');
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

export function toggleSearchDialog() {
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

    if (_spotlightDialog._isOpen) {
        _spotlightDialog.close();
    } else {
        if (Main.overview?.visible) {
            Main.overview.hide();
        }
        _spotlightDialog.open();
    }
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
