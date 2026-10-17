import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { _ } from './i18n.js';
import { t, tf } from './mac_i18n.js';

const RECENT_ITEMS_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const SEARCH_DEBOUNCE_MS = 50;
const MAX_RESULTS_PER_SECTION = 5;
const PILL_HEIGHT = 54;
const DIALOG_WIDTH = 660;

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

let _cachedRecent = [];
let _recentLoaded = false;

function _ensureRecentLoaded() {
    if (_recentLoaded) return;
    _recentLoaded = true;
    try {
        const file = Gio.File.new_for_path(RECENT_ITEMS_FILE);
        file.load_contents_async(null, (_src, res) => {
            try {
                const [ok, bytes] = file.load_contents_finish(res);
                if (ok) {
                    const xml = new TextDecoder('utf-8').decode(bytes);
                    const matches = [...xml.matchAll(/<bookmark href="([^"]+)"[\s\S]*?<title>([^<]*)<\/title>/g)];
                    _cachedRecent = matches.map(m => {
                        const uri = m[1];
                        const title = m[2] || decodeURIComponent(uri.split('/').pop() || uri);
                        return {
                            type: 'file',
                            title,
                            subtitle: decodeURIComponent(uri).replace('file://', ''),
                            uri,
                        };
                    }).slice(0, 50);
                }
            } catch (_) {}
        });
    } catch (_) {}
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
        this._appSystem = Shell.AppSystem.get_default();
        this._resultButtons = [];
        this._selectedIndex = -1;
        this._debounceId = 0;
        this._lastQuery = '';
        this._modalGrab = null;

        // 1. Transparent Backdrop Click-Catcher (No screen dimming!)
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

        // 2. Main Floating Spotlight Container (Pure Glass overlay)
        this._box = new St.BoxLayout({
            name: 'mac-spotlight-box',
            style_class: 'mac-spotlight-box',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            clip_to_allocation: true,
        });
        const SPOTLIGHT_RADIUS = 27;
        this._box.set_style(
            'background-color: transparent !important; ' +
            'background: none !important; ' +
            `border-radius: ${SPOTLIGHT_RADIUS}px !important; ` +
            'border: 1px solid rgba(255, 255, 255, 0.20) !important; ' +
            'box-shadow: none !important;'
        );
        this.add_child(this._box);

        this._glass = null;
        this._stageSignalId = 0;
        this._initGlass();

        // 3. Top Search Pill Row (54px tall)
        this._searchRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'height: 54px; min-height: 54px; padding: 0 16px;',
        });
        this._box.add_child(this._searchRow);

        this._searchIcon = new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 22,
            style: 'color: rgba(255, 255, 255, 0.60); margin-left: 6px; margin-right: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchRow.add_child(this._searchIcon);

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
        this._searchRow.add_child(this._entry);

        // 4. Results Section (hidden by default)
        this._resultsWrapper = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
            opacity: 0,
        });
        this._box.add_child(this._resultsWrapper);

        // Thin subtle divider
        this._divider = new St.Widget({
            style_class: 'mac-spotlight-divider',
            style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.12); margin: 2px 20px 8px 20px;',
        });
        this._resultsWrapper.add_child(this._divider);

        // Scrollable results container with bottom gradient blur & darkening
        this._scrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._resultsWrapper.add_child(this._scrollWrapper);

        this._scrollView = new St.ScrollView({
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
            style: 'padding: 0 10px 14px 10px;',
        });
        this._scrollView.add_child(this._resultsBox);

        this._bottomFade = new St.Widget({
            style: 'background-gradient-direction: vertical; ' +
                   'background-gradient-start: rgba(18, 18, 18, 0.0); ' +
                   'background-gradient-end: rgba(18, 18, 18, 0.85); ' +
                   'border-bottom-left-radius: 27px; ' +
                   'border-bottom-right-radius: 27px;',
            height: 38,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
        });
        try {
            this._bottomFade.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 10 }));
        } catch (_) {}
        this._scrollWrapper.add_child(this._bottomFade);

        // 5. Connect Input & Keyboard Signals
        const ct = this._entry.clutter_text;
        ct.connect('text-changed', () => {
            this._scheduleSearch();
        });
        ct.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

            if (symbol === Clutter.KEY_Escape || (isCtrl && symbol === Clutter.KEY_space)) {
                this.close();
                return Clutter.EVENT_STOP;
            }

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

            return Clutter.EVENT_PROPAGATE;
        });

        _ensureRecentLoaded();
    }

    async _initGlass() {
        if (this._glass) return;
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
            });
            this._glass.setIsDock(true); // Simple circular arcs (matching CSS border-radius)
            this._glass.setCornerSmoothingEnabled(0.0);
            this._glass.setCornerRadius(27.0); // Exact radius matching Spotlight
            this._glass.setTintColor(0.0, 0.0, 0.0);
            this._glass.setTintStrength(0.05); // Exact 5% darkening requested
            this._glass.setBrightness(1.0);
            this._glass.setSaturation(1.0);
            this._glass.setContrast(1.0);
            this._glass.setBlurRadius(2.0); // 2px subtle blur requested
            this._glass.setPadding(0);
            try {
                this._glass._renderer.uniforms.set('shadow_intensity', 0.0);
                this._glass._renderer.uniforms.set('shadow_radius', 0.0);
                this._glass._renderer.uniforms.set('shadow_max_radius', 0.0);
            } catch (_) {}
            this._glass.hide();

            if (this._isOpen) {
                if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                    Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
                }
                this._syncGlass();
            }
        } catch (e) {
            console.error(`[Spotlight] Error initializing BackdropGlass: ${e}`);
        }
    }

    _syncGlass() {
        if (!this._glass || !this._isOpen) {
            if (this._glass?.visible) this._glass.hide();
            return;
        }

        const box = this._box;
        if (!box.visible) {
            if (this._glass?.visible) this._glass.hide();
            return;
        }

        const opacity = box.get_paint_opacity();
        if (opacity <= 0) {
            if (this._glass?.visible) this._glass.hide();
            return;
        }

        const mon = Main.layoutManager.primaryMonitor;
        const scaleX = box.scale_x ?? 1.0;
        const scaleY = box.scale_y ?? 1.0;
        const rawW = box.width > 0 ? box.width : DIALOG_WIDTH;
        const rawH = box.height > 0 ? box.height : PILL_HEIGHT;

        const w = rawW * scaleX;
        const h = rawH * scaleY;
        const bx = box.x + (rawW - w) * 0.5;
        const by = box.y;

        const localBgX = Math.round(bx - mon.x);
        const localBgY = Math.round(by - mon.y);
        const bgW = Math.round(w);
        const bgH = Math.round(h);

        if (this._glass.opacity !== opacity) {
            this._glass.opacity = opacity;
        }
        if (!this._glass.visible) {
            this._glass.show();
        }

        this._glass.set_position(mon.x, mon.y);
        this._glass.set_size(mon.width, mon.height);
        this._glass.setResolution(mon.width, mon.height);
        this._glass.setCornerRadius(27.0);
        this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
        this._glass.set_clip(localBgX, localBgY, bgW, bgH);
        this._glass.syncSources();
    }

    open() {
        if (this._isOpen) return;
        this._isOpen = true;

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

        this._resultsWrapper.visible = false;
        this._resultsWrapper.opacity = 0;
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

        if (this._glass) {
            if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
            }
            Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
            Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
            this._syncGlass();
        } else {
            this._initGlass();
            Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
        }

        if (!this._stageSignalId) {
            this._stageSignalId = global.stage.connect('before-update', () => {
                this._syncGlass();
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
        });
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this._modalGrab) {
            try { this._modalGrab.dismiss(); } catch (_) {}
            this._modalGrab = null;
        } else {
            try { Main.popModal(this); } catch (_) {}
        }

        if (this._glass && this._glass.visible) {
            this._glass.ease({
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._glass) this._glass.hide();
                    if (!this._isOpen && this._stageSignalId) {
                        global.stage.disconnect(this._stageSignalId);
                        this._stageSignalId = 0;
                    }
                },
            });
        } else {
            if (this._stageSignalId) {
                global.stage.disconnect(this._stageSignalId);
                this._stageSignalId = 0;
            }
        }

        this._box.ease({
            opacity: 0,
            scale_x: 0.94,
            scale_y: 0.94,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.visible = false;
                this._backdrop.visible = false;
                this._entry.text = '';
                this._resultsWrapper.visible = false;
                this._resultsBox.destroy_all_children();
                this._resultButtons = [];
                this._box.set_size(DIALOG_WIDTH, PILL_HEIGHT);
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

        // If empty: smoothly collapse to pill (54px)
        if (query.length === 0) {
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

        // Gather search items
        const results = [];

        // A. Directory browse if starts with ~ or /
        if (query.startsWith('~') || query.startsWith('/')) {
            const dirResults = this._searchDirectory(query);
            results.push(...dirResults);
        }

        // B. Installed Applications
        results.push(...this._searchApps(query));

        // C. System Settings
        results.push(...this._searchSettings(query));

        // D. Recent Files
        results.push(...this._searchRecent(query));

        // E. Fallback / Search actions (Always available or if no items)
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

        return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, MAX_RESULTS_PER_SECTION);
    }

    _searchSettings(query) {
        const q = query.toLowerCase();
        const hits = [];

        for (const s of SETTINGS_PANELS) {
            const title = t(s.key, s.fallback);
            let matched = false;
            if (title.toLowerCase().includes(q)) matched = true;
            else {
                for (const m of s.match) {
                    if (m.toLowerCase().includes(q)) { matched = true; break; }
                }
            }

            if (matched) {
                hits.push({
                    type: 'settings',
                    title,
                    subtitle: tf('system_settings_arrow', { title }, `Параметри системи → ${title}`),
                    panel: s.panel,
                    iconName: 'preferences-system-symbolic',
                    category: t('category_settings', 'Параметри'),
                });
            }
        }

        return hits.slice(0, 3);
    }

    _searchRecent(query) {
        const q = query.toLowerCase();
        const hits = [];

        for (const item of _cachedRecent) {
            if (item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q)) {
                hits.push({
                    type: 'file',
                    title: item.title,
                    subtitle: item.subtitle,
                    uri: item.uri,
                    iconName: 'text-x-generic-symbolic',
                    category: t('category_file', 'Файл'),
                });
            }
        }

        return hits.slice(0, 3);
    }

    _searchDirectory(query) {
        let path = query;
        if (path.startsWith('~')) {
            path = GLib.get_home_dir() + path.slice(1);
        }

        const hits = [];
        try {
            let dirPath = path;
            let filterPrefix = '';
            if (!GLib.file_test(dirPath, GLib.FileTest.IS_DIR)) {
                dirPath = GLib.path_get_dirname(path);
                filterPrefix = GLib.path_get_basename(path).toLowerCase();
            }

            if (GLib.file_test(dirPath, GLib.FileTest.IS_DIR)) {
                const dir = Gio.File.new_for_path(dirPath);
                const enumerator = dir.enumerate_children('standard::name,standard::type,standard::icon', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (filterPrefix && !name.toLowerCase().startsWith(filterPrefix))
                        continue;
                    const isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
                    const child = dir.get_child(name);
                    hits.push({
                        type: isDir ? 'dir' : 'file',
                        title: name,
                        subtitle: child.get_path(),
                        uri: child.get_uri(),
                        iconName: isDir ? 'folder-symbolic' : 'text-x-generic-symbolic',
                        category: isDir ? t('category_folder', 'Папка') : t('category_file', 'Файл'),
                    });
                    if (hits.length >= 8) break;
                }
            }
        } catch (_) {}

        return hits;
    }

    _renderResults(items) {
        this._resultsBox.destroy_all_children();
        this._resultButtons = [];
        this._selectedIndex = -1;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const btn = new St.Button({
                style_class: 'mac-spotlight-item',
                style: 'padding: 6px 12px; margin: 2px 4px; border-radius: 10px; background-color: transparent !important;',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: true,
            });

            const row = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            btn.add_child(row);

            // Icon Slot (transparent, no grey background, properly centered)
            const iconSlot = new St.BoxLayout({
                style_class: 'mac-spotlight-icon-slot mac-spotlight-icon-squircle',
                style: 'width: 36px; height: 36px; min-width: 36px; min-height: 36px; background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important; margin-right: 14px;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            let iconActor = null;
            if (item.type === 'app' && item.app?.get_icon?.()) {
                iconActor = new St.Icon({
                    gicon: item.app.get_icon(),
                    icon_size: 32,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            } else {
                iconActor = new St.Icon({
                    icon_name: item.iconName || 'system-search-symbolic',
                    icon_size: 24,
                    style: item.type === 'fallback-gemini' ? 'color: #388bfd;' : 'color: rgba(255, 255, 255, 0.90);',
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

            // Category badge on right
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

        // Expand downwards with animation!
        if (!this._resultsWrapper.visible) {
            this._resultsWrapper.visible = true;
            this._resultsWrapper.opacity = 0;
        }

        const visibleCount = Math.min(items.length, 7);
        const targetHeight = PILL_HEIGHT + 10 + visibleCount * 52;

        this._box.ease({
            height: targetHeight,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        this._resultsWrapper.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._setSelectedIndex(0);
    }

    _moveSelection(delta) {
        if (this._resultButtons.length === 0) return;
        const count = this._resultButtons.length;
        const next = this._selectedIndex < 0 ? 0 : (this._selectedIndex + delta + count) % count;
        this._setSelectedIndex(next);
    }

    _setSelectedIndex(index) {
        this._selectedIndex = index;
        this._resultButtons.forEach((btn, idx) => {
            if (idx === index) {
                btn.set_style('padding: 6px 12px; margin: 2px 4px; border-radius: 10px; background-color: rgba(255, 255, 255, 0.16) !important;');
                try { Util.ensureActorVisibleInScrollView?.(this._scrollView, btn); } catch (_) {}
            } else {
                btn.set_style('padding: 6px 12px; margin: 2px 4px; border-radius: 10px; background-color: transparent !important;');
            }
        });
    }

    _activateCurrent() {
        if (this._selectedIndex >= 0 && this._resultButtons[this._selectedIndex]) {
            this._activate(this._resultButtons[this._selectedIndex].itemData);
        } else if (this._resultButtons[0]) {
            this._activate(this._resultButtons[0].itemData);
        }
    }

    _activate(item) {
        if (!item) return;
        this.close();

        try {
            if (item.type === 'app') {
                item.app.open_new_window(-1);
            } else if (item.type === 'settings') {
                const argv = item.panel ? ['gnome-control-center', item.panel] : ['gnome-control-center'];
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            } else if (item.type === 'file' || item.type === 'dir') {
                Gio.AppInfo.launch_default_for_uri(item.uri, null);
            } else if (item.type === 'fallback-nautilus') {
                // Open Nautilus
                Util.spawnCommandLine(`nautilus --new-window`);
            } else if (item.type === 'fallback-web') {
                // Web search
                const url = `https://www.google.com/search?q=${encodeURIComponent(item.query)}`;
                Gio.AppInfo.launch_default_for_uri(url, null);
            } else if (item.type === 'fallback-gemini') {
                // Gemini query: copy to clipboard and open Gemini
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, item.query);
                const geminiUrl = `https://gemini.google.com/app?q=${encodeURIComponent(item.query)}`;
                Gio.AppInfo.launch_default_for_uri(geminiUrl, null);
            }
        } catch (e) {
            console.error(`[Spotlight] activation error: ${e}`);
        }
    }

    destroy() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        if (this._stageSignalId) {
            try {
                global.stage.disconnect(this._stageSignalId);
            } catch (_) {}
            this._stageSignalId = 0;
        }
        if (this._glass) {
            try {
                this._glass.destroy();
            } catch (_) {}
            this._glass = null;
        }
        if (this._modalGrab) {
            try { this._modalGrab.dismiss(); } catch (_) {}
            this._modalGrab = null;
        }
        super.destroy();
    }
});

export function toggleSearchDialog() {
    if (globalThis._macSpotlightGlobalInstance) {
        if (!globalThis._macSpotlightGlobalInstance.get_parent()) {
            try { globalThis._macSpotlightGlobalInstance.destroy(); } catch (_) {}
            globalThis._macSpotlightGlobalInstance = null;
        }
    }
    if (!globalThis._macSpotlightGlobalInstance) {
        try {
            const strays = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'mac-spotlight-wrapper');
            strays.forEach(s => { try { s.destroy(); } catch (_) {} });
        } catch (_) {}
        globalThis._macSpotlightGlobalInstance = new MacSpotlightDialog();
    }
    globalThis._macSpotlightGlobalInstance.toggle();
}

export function destroySearchDialog() {
    if (globalThis._macSpotlightGlobalInstance) {
        try { globalThis._macSpotlightGlobalInstance.destroy(); } catch (_) {}
        globalThis._macSpotlightGlobalInstance = null;
    }
}

globalThis.toggleMacSpotlight = toggleSearchDialog;
globalThis.destroyMacSpotlight = destroySearchDialog;
