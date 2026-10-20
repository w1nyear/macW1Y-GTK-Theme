import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const CACHE_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'mac-clipboard']);
const IMAGES_DIR = GLib.build_filenamev([CACHE_DIR, 'images']);
const HISTORY_FILE = GLib.build_filenamev([CACHE_DIR, 'history.json']);
const MAX_HISTORY_ITEMS = 80;
const DIALOG_WIDTH = 540;
const DIALOG_MAX_HEIGHT = 600;
const CORNER_RADIUS = 26;

// Ensure storage directories exist
try {
    GLib.mkdir_with_parents(IMAGES_DIR, 0o755);
} catch (_) {}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Скопійовано щойно';
    const now = Date.now();
    const diff = Math.max(0, now - timestamp);
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    if (diff < 60000) {
        return 'Скопійовано щойно';
    }
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return `Скопійовано ${hh}:${mm}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `Вчора ${hh}:${mm}`;
    }
    const months = ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'];
    return `${date.getDate()} ${months[date.getMonth()]} ${hh}:${mm}`;
}

function getFileIconName(filename, isDir = false) {
    if (isDir) return 'folder-symbolic';
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
        case 'png': case 'jpg': case 'jpeg': case 'svg': case 'gif': case 'webp': case 'bmp':
            return 'image-x-generic-symbolic';
        case 'mp4': case 'mkv': case 'mov': case 'avi': case 'webm':
            return 'video-x-generic-symbolic';
        case 'mp3': case 'wav': case 'flac': case 'ogg': case 'm4a':
            return 'audio-x-generic-symbolic';
        case 'zip': case 'tar': case 'gz': case '7z': case 'rar': case 'deb':
            return 'package-x-generic-symbolic';
        case 'pdf':
            return 'application-pdf-symbolic';
        case 'txt': case 'md': case 'log':
            return 'text-x-generic-symbolic';
        case 'js': case 'ts': case 'py': case 'c': case 'cpp': case 'sh': case 'json': case 'html': case 'css':
            return 'text-x-script-symbolic';
        default:
            return 'text-x-generic-symbolic';
    }
}

// ------------------------------------------------------------------------------
// Clipboard Storage & Live Listener
// ------------------------------------------------------------------------------
class ClipboardStore {
    constructor() {
        this._items = [];
        this._listening = false;
        this._ownerChangedId = 0;
        this._saveTimeoutId = 0;
        this._lastCaptureHash = '';
        this._loadHistory();
        this._startWatcher();
    }

    _loadHistory() {
        try {
            if (GLib.file_test(HISTORY_FILE, GLib.FileTest.EXISTS)) {
                const [ok, contents] = GLib.file_get_contents(HISTORY_FILE);
                if (ok) {
                    const parsed = JSON.parse(new TextDecoder('utf-8').decode(contents));
                    if (Array.isArray(parsed)) {
                        this._items = parsed;
                    }
                }
            }
        } catch (e) {
            this._items = [];
        }
    }

    _scheduleSave() {
        if (this._saveTimeoutId) return;
        this._saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._saveTimeoutId = 0;
            this._saveHistory();
            return GLib.SOURCE_REMOVE;
        });
    }

    _saveHistory() {
        try {
            const data = JSON.stringify(this._items.slice(0, MAX_HISTORY_ITEMS), null, 2);
            GLib.file_set_contents(HISTORY_FILE, data);
        } catch (_) {}
    }

    _startWatcher() {
        if (this._listening) return;
        try {
            const sel = global.display.get_selection();
            if (sel) {
                this._ownerChangedId = sel.connect('owner-changed', (_selection, selectionType) => {
                    if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                        this._handleClipboardChange();
                    }
                });
                this._listening = true;
            }
        } catch (e) {
            console.error('[MacClipboard] Failed to connect to selection owner-changed: ' + e);
        }
    }

    _handleClipboardChange() {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._captureCurrent();
            return GLib.SOURCE_REMOVE;
        });
    }

    _captureCurrent() {
        try {
            const cb = St.Clipboard.get_default();
            const mimes = Array.from(cb.get_mimetypes(St.ClipboardType.CLIPBOARD) || []);
            if (mimes.length === 0) return;

            // 1. Image Capture
            if (mimes.some(m => m.startsWith('image/'))) {
                const imgMime = mimes.find(m => m === 'image/png') || mimes.find(m => m.startsWith('image/'));
                cb.get_content(St.ClipboardType.CLIPBOARD, imgMime, (_cb, bytes) => {
                    if (!bytes || bytes.get_size() === 0) return;
                    const size = bytes.get_size();
                    const hash = `img_${size}_${GLib.get_monotonic_time()}`;
                    if (this._lastCaptureHash === hash) return;
                    this._lastCaptureHash = hash;

                    const id = `item_${Date.now()}`;
                    const imgPath = GLib.build_filenamev([IMAGES_DIR, `${id}.png`]);
                    try {
                        const file = Gio.File.new_for_path(imgPath);
                        file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.NONE, null);
                        
                        const item = {
                            id,
                            type: 'image',
                            title: 'Зображення з буфера обміну',
                            subtitle: `Зображення PNG • ${(size / 1024).toFixed(1)} КБ`,
                            imagePath: imgPath,
                            mimeType: imgMime,
                            timestamp: Date.now(),
                        };
                        this._pushItem(item);
                    } catch (_) {}
                });
                return;
            }

            // 2. File / URI List Capture
            if (mimes.includes('text/uri-list') || mimes.includes('x-special/gnome-copied-files')) {
                const targetMime = mimes.includes('text/uri-list') ? 'text/uri-list' : 'x-special/gnome-copied-files';
                cb.get_content(St.ClipboardType.CLIPBOARD, targetMime, (_cb, bytes) => {
                    let text = '';
                    if (bytes && bytes.get_size() > 0) {
                        try {
                            text = new TextDecoder('utf-8').decode(bytes.get_data());
                        } catch (_) {}
                    }
                    if (!text || !text.includes('file://')) {
                        // Fallback to get_text just in case
                        cb.get_text(St.ClipboardType.CLIPBOARD, (_c, fallbackText) => {
                            if (fallbackText && fallbackText.includes('file://')) {
                                this._processFileText(fallbackText);
                            }
                        });
                        return;
                    }
                    this._processFileText(text);
                });
                return;
            }

            // 3. Plain Text / URLs / Code Capture
            cb.get_text(St.ClipboardType.CLIPBOARD, (_cb, text) => {
                if (!text || text.trim().length === 0) return;
                const trimmed = text.trim();
                const hash = `txt_${trimmed.length}_${trimmed.slice(0, 40)}`;
                if (this._lastCaptureHash === hash) return;
                this._lastCaptureHash = hash;

                let type = 'text';
                let title = trimmed.split('\n')[0].trim();
                if (title.length > 70) {
                    title = title.slice(0, 68) + '…';
                }

                // Check for URL
                if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
                    type = 'link';
                } else if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
                    type = 'color';
                }

                const lineCount = trimmed.split('\n').length;
                let subtitle = '';
                if (type === 'link') {
                    subtitle = `Посилання • ${trimmed.replace(/^https?:\/\//i, '').slice(0, 45)}`;
                } else if (type === 'color') {
                    subtitle = `Колір HEX • ${trimmed}`;
                } else {
                    subtitle = lineCount > 1 
                        ? `Текст • ${lineCount} рядків, ${trimmed.length} симв.`
                        : `Текст • ${trimmed.length} симв.`;
                }

                const item = {
                    id: `item_${Date.now()}`,
                    type,
                    title,
                    subtitle,
                    text: trimmed,
                    timestamp: Date.now(),
                };
                this._pushItem(item);
            });
        } catch (_) {}
    }

    _processFileText(text) {
        if (!text || !text.includes('file://')) return;
        const lines = text.split('\n')
            .map(l => l.trim().replace(/\r$/, ''))
            .filter(l => l.startsWith('file://'));
        if (lines.length === 0) return;

        const hash = `files_${lines.join('|')}`;
        if (this._lastCaptureHash === hash) return;
        this._lastCaptureHash = hash;

        const names = lines.map(u => {
            try {
                const unesc = decodeURIComponent(u.replace('file://', ''));
                return GLib.path_get_basename(unesc);
            } catch (_) {
                return 'Файл';
            }
        });

        const firstFile = names[0];
        const count = names.length;
        const title = count === 1 ? firstFile : `${firstFile} та ще ${count - 1} файлів`;
        const subtitle = count === 1 ? `Файл • ${firstFile}` : `Файли (${count} шт.)`;

        const item = {
            id: `item_${Date.now()}`,
            type: 'file',
            title,
            subtitle,
            uris: lines,
            rawText: text,
            firstFileName: firstFile,
            timestamp: Date.now(),
        };
        this._pushItem(item);
    }

    _pushItem(item) {
        // Deduplicate against the most recent item
        const existingIdx = this._items.findIndex(it => {
            if (it.type !== item.type) return false;
            if (it.type === 'text' || it.type === 'link' || it.type === 'color') return it.text === item.text;
            if (it.type === 'file') return it.uris?.join('|') === item.uris?.join('|');
            return false;
        });

        if (existingIdx === 0) {
            // Update timestamp of top item
            this._items[0].timestamp = item.timestamp;
            this._scheduleSave();
            return;
        } else if (existingIdx > 0) {
            this._items.splice(existingIdx, 1);
        }

        this._items.unshift(item);
        if (this._items.length > MAX_HISTORY_ITEMS) {
            const removed = this._items.splice(MAX_HISTORY_ITEMS);
            for (const r of removed) {
                if (r.type === 'image' && r.imagePath) {
                    try { Gio.File.new_for_path(r.imagePath).delete(null); } catch (_) {}
                }
            }
        }
        this._scheduleSave();

        if (globalThis._macClipboardGlobalInstance?._isOpen) {
            globalThis._macClipboardGlobalInstance._refreshList();
        }
    }

    getItems() {
        return this._items;
    }

    clear() {
        for (const it of this._items) {
            if (it.type === 'image' && it.imagePath) {
                try { Gio.File.new_for_path(it.imagePath).delete(null); } catch (_) {}
            }
        }
        this._items = [];
        this._scheduleSave();
    }

    deleteItem(id) {
        const idx = this._items.findIndex(it => it.id === id);
        if (idx >= 0) {
            const it = this._items[idx];
            if (it.type === 'image' && it.imagePath) {
                try { Gio.File.new_for_path(it.imagePath).delete(null); } catch (_) {}
            }
            this._items.splice(idx, 1);
            this._scheduleSave();
        }
    }

    restore(item) {
        if (!item) return;
        const cb = St.Clipboard.get_default();
        try {
            if (item.type === 'image' && item.imagePath) {
                const file = Gio.File.new_for_path(item.imagePath);
                if (file.query_exists(null)) {
                    const [ok, contents] = file.load_contents(null);
                    if (ok) {
                        const bytes = GLib.Bytes.new(contents);
                        cb.set_content(St.ClipboardType.CLIPBOARD, item.mimeType || 'image/png', bytes);
                    }
                }
            } else if (item.type === 'file' && item.uris) {
                const uriData = item.uris.join('\r\n') + '\r\n';
                const bytes = new GLib.Bytes(new TextEncoder().encode(uriData));
                cb.set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', bytes);
            } else if (item.text) {
                cb.set_text(St.ClipboardType.CLIPBOARD, item.text);
            }
        } catch (_) {}
    }
}

const clipboardStore = new ClipboardStore();

// ------------------------------------------------------------------------------
// MacClipboardDialog UI (Pure Liquid Glass & macOS Styling)
// ------------------------------------------------------------------------------
export const MacClipboardDialog = GObject.registerClass({
    GTypeName: `MacClipboardDialog_${Math.floor(Math.random() * 1000000)}`,
}, class MacClipboardDialog extends Clutter.Actor {
    _init() {
        super._init({
            name: 'mac-clipboard-wrapper',
            reactive: true,
            visible: false,
        });

        this._isOpen = false;
        this._isAnimating = false;
        this._modalGrab = null;
        this._glass = null;
        this._stageSignalId = 0;
        this._selectedIndex = -1;
        this._rowButtons = [];
        this._displayedItems = [];

        // 1. Transparent Backdrop Click-Catcher (Dismiss on outside click)
        this._backdrop = new Clutter.Actor({
            name: 'mac-clipboard-backdrop',
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

        // 2. Main Floating Box (Liquid Glass Overlay)
        this._box = new St.BoxLayout({
            name: 'mac-clipboard-box',
            style_class: 'mac-clipboard-box',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            clip_to_allocation: true,
        });
        this._box.set_style(
            'background-color: transparent !important; background: none !important; ' +
            `border-radius: ${CORNER_RADIUS}px !important; ` +
            'border: none !important; ' +
            'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.40) !important;'
        );
        this.add_child(this._box);

        this.connect('destroy', () => {
            this.destroy();
        });

        this._initializingGlass = false;

        // 3. Top Header / Search Row
        this._headerRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'height: 56px; min-height: 56px; padding: 0 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
        });
        this._headerBox = this._headerRow;
        this._box.add_child(this._headerRow);

        this._headerIcon = new St.Icon({
            icon_name: 'edit-paste-symbolic',
            icon_size: 22,
            style: 'color: rgba(255, 255, 255, 0.75); margin-left: 4px; margin-right: 12px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerRow.add_child(this._headerIcon);

        this._searchEntry = new St.Entry({
            style_class: 'mac-clipboard-search',
            style: 'font-size: 18px !important; font-weight: 600 !important; color: #ffffff !important; ' +
                   'hint-text-color: #ffffff !important; ' +
                   'text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; ' +
                   'background-color: transparent !important; background: none !important; ' +
                   'border: none !important; box-shadow: none !important; outline: none !important;',
            hint_text: 'Буфер обміну',
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (this._searchEntry.clutter_text?.set_single_line_mode) {
            this._searchEntry.clutter_text.set_single_line_mode(true);
        }
        if (this._searchEntry.clutter_text) {
            try {
                if (typeof Clutter.Color === 'function')
                    this._searchEntry.clutter_text.set_color(new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 }));
            } catch (_) {}
        }
        this._headerRow.add_child(this._searchEntry);

        // Header Action: Clear History Button
        this._clearBtn = new St.Button({
            style_class: 'mac-clipboard-header-btn',
            style: 'padding: 6px 10px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); margin-right: 2px;',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const clearIcon = new St.Icon({
            icon_name: 'view-more-horizontal-symbolic',
            icon_size: 18,
            style: 'color: rgba(255, 255, 255, 0.70);',
        });
        this._clearBtn.set_child(clearIcon);
        this._clearBtn.connect('clicked', () => {
            clipboardStore.clear();
            this._refreshList();
        });
        this._headerRow.add_child(this._clearBtn);

        // 4. Scrollable Container for Clipboard Entries
        this._scrollView = new St.ScrollView({
            style_class: 'mac-clipboard-scroll',
            style: 'padding: 6px 0;',
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._scrollWrapper = this._scrollView;
        this._box.add_child(this._scrollView);

        this._listContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 4px 18px 4px 8px;',
        });
        this._scrollView.set_child(this._listContainer);

        // 5. Connect Search & Keyboard Events
        const ct = this._searchEntry.clutter_text;
        ct.connect('text-changed', () => {
            this._refreshList();
        });
        ct.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                this.close(true);
                Main.overview.show();
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
            if (symbol === Clutter.KEY_Delete) {
                this._deleteCurrent();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
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
                owner: 'clipboard',
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
            this._glass.setBlurRadius(8.0);
            this._glass.setPadding(0);
            this._glass.hide();

            if (!this._isOpen) {
                if (this._glass && !this._glass.is_finalized?.()) {
                    try {
                        this._glass.remove_all_transitions();
                        this._glass.opacity = 0;
                        this._glass.visible = false;
                        this._glass.hide();
                    } catch (_) {}
                }
                return;
            }

            if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
            }
            this._box.set_style(
                'background-color: transparent !important; background: none !important; ' +
                `border-radius: ${CORNER_RADIUS}px !important; ` +
                'border: none !important; ' +
                'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.40) !important;'
            );
            this._syncGlass();
        } catch (_) {
        } finally {
            this._initializingGlass = false;
        }
    }

    _syncGlass() {
        if (!this._isOpen || !this._glass || this._glass.is_finalized?.()) return;
        const box = this._box;
        if (!box || !box.visible) {
            if (this._glass.visible) this._glass.hide();
            return;
        }

        const mon = Main.layoutManager.primaryMonitor;
        const scaleX = box.scale_x ?? 1.0;
        const scaleY = box.scale_y ?? 1.0;
        const rawW = box.width > 0 ? box.width : DIALOG_WIDTH;
        const rawH = box.height > 0 ? box.height : DIALOG_MAX_HEIGHT;

        const w = rawW * scaleX;
        const h = rawH * scaleY;
        const bx = box.x + (rawW - w) * 0.5;
        const by = box.y;

        const localBgX = Math.round(bx - mon.x);
        const localBgY = Math.round(by - mon.y);
        const bgW = Math.round(w);
        const bgH = Math.round(h);

        this._glass.opacity = box.opacity;
        if (!this._glass.visible) this._glass.show();

        this._glass.set_position(mon.x, mon.y);
        this._glass.set_size(mon.width, mon.height);
        this._glass.setResolution(mon.width, mon.height);
        const { tintVal, tintStrength } = this._getThemeParams();
        this._glass.setIsDock(false);
        this._glass.setTintColor(tintVal, tintVal, tintVal);
        this._glass.setTintStrength(tintStrength);
        this._glass.setBlurRadius(8.0);
        this._glass.setCornerRadius(CORNER_RADIUS);
        this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
        const CLIP_PAD = 40;
        this._glass.set_clip(localBgX - CLIP_PAD, localBgY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
        this._glass.syncSources();
    }

    open(options = {}) {
        if (this._isOpen) return;
        if (Main.overview?.visible) return;
        if (typeof globalThis._macCloseAllCenters === 'function') {
            globalThis._macCloseAllCenters('clipboard');
        } else {
            try { globalThis._tahoeQSClose?.(); } catch (_) {}
            try { globalThis._tahoeNCClose?.(true); } catch (_) {}
            try { globalThis._macSpotlightGlobalInstance?.close?.(true); } catch (_) {}
        }
        this._isOpen = true;

        const mon = Main.layoutManager.primaryMonitor;
        this.set_position(0, 0);
        this.set_size(mon.width, mon.height);

        this._backdrop.set_position(mon.x, mon.y);
        this._backdrop.set_size(mon.width, mon.height);
        this._backdrop.visible = true;

        const h = Math.min(DIALOG_MAX_HEIGHT, Math.round(mon.height * 0.75));
        const targetX = mon.x + Math.round((mon.width - DIALOG_WIDTH) / 2);
        const targetY = mon.y + Math.round((mon.height - h) / 2);

        this._searchEntry.text = '';
        this._refreshList();

        this._box.remove_all_transitions();
        this.remove_all_transitions();

        if (!this.get_parent()) {
            Main.layoutManager.uiGroup.add_child(this);
        }
        this.visible = true;

        if (this._glass && !this._glass.is_finalized?.()) {
            if (this._glass.get_parent() !== Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this);
            }
            Main.layoutManager.uiGroup.set_child_above_sibling(this._glass, null);
            Main.layoutManager.uiGroup.set_child_above_sibling(this, this._glass);
            this._box.set_style(
                'background-color: transparent !important; background: none !important; ' +
                `border-radius: ${CORNER_RADIUS}px !important; ` +
                'border: none !important; ' +
                'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.40) !important;'
            );
            this._glass.show();
            this._glass.opacity = 255;
            this._syncGlass();
        } else {
            this._glass = null;
            this._box.set_style(
                'background-color: transparent !important; background: none !important; ' +
                `border-radius: ${CORNER_RADIUS}px !important; ` +
                'border: none !important; ' +
                'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.40) !important;'
            );
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

        this._searchEntry.grab_key_focus();

        const fromRect = options?.fromRect;
        if (fromRect) {
            this._box.set_position(fromRect.x, fromRect.y);
            this._box.set_size(fromRect.width, fromRect.height);
            this._box.set_pivot_point(0.5, 0.0);
            this._box.scale_x = 1.0;
            this._box.scale_y = 1.0;
            this._box.opacity = 255;

            this._headerRow.opacity = 0;
            this._scrollWrapper.opacity = 0;

            this._box.ease({
                x: targetX,
                y: targetY,
                width: DIALOG_WIDTH,
                height: h,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });

            this._headerRow.ease({
                opacity: 255,
                duration: 200,
                delay: 60,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._scrollWrapper.ease({
                opacity: 255,
                duration: 220,
                delay: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._box.set_position(targetX, targetY);
            this._box.set_size(DIALOG_WIDTH, h);
            this._box.set_pivot_point(0.5, 0.5);
            this._box.scale_x = 0.95;
            this._box.scale_y = 0.95;
            this._box.opacity = 0;
            this._headerRow.opacity = 255;
            this._scrollWrapper.opacity = 255;

            this._box.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
    }

    close(immediate = false) {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this._modalGrab) {
            try { this._modalGrab.dismiss(); } catch (_) {}
            this._modalGrab = null;
        } else {
            try { Main.popModal(this); } catch (_) {}
        }

        if (this._stageSignalId) {
            global.stage.disconnect(this._stageSignalId);
            this._stageSignalId = 0;
        }

        if (immediate) {
            this._box.remove_all_transitions();
            this._box.opacity = 0;
            if (this._glass && !this._glass.is_finalized?.()) {
                try {
                    this._glass.remove_all_transitions();
                    this._glass.opacity = 0;
                    this._glass.visible = false;
                    this._glass.hide();
                    this._glass.backdropLocked = false;
                } catch (_) {}
            }
            this.visible = false;
            this._backdrop.visible = false;
            return;
        }

        if (this._glass && !this._glass.is_finalized?.() && this._glass.visible) {
            this._glass.ease({
                opacity: 0,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._glass && !this._glass.is_finalized?.()) {
                        try {
                            this._glass.remove_all_transitions();
                            this._glass.visible = false;
                            this._glass.hide();
                            this._glass.backdropLocked = false;
                        } catch (_) {}
                    }
                },
            });
        }

        this._box.ease({
            opacity: 0,
            scale_x: 0.95,
            scale_y: 0.95,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.visible = false;
                this._backdrop.visible = false;
                if (this._glass && !this._glass.is_finalized?.()) {
                    try {
                        this._glass.remove_all_transitions();
                        this._glass.visible = false;
                        this._glass.hide();
                        this._glass.backdropLocked = false;
                    } catch (_) {}
                }
            },
        });
    }

    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    _refreshList() {
        this._listContainer.destroy_all_children();
        this._rowButtons = [];
        this._selectedIndex = -1;

        const allItems = clipboardStore.getItems();
        const q = this._searchEntry.text.trim().toLowerCase();

        this._displayedItems = allItems.filter(it => {
            if (!q) return true;
            if (it.title?.toLowerCase().includes(q)) return true;
            if (it.subtitle?.toLowerCase().includes(q)) return true;
            if (it.text?.toLowerCase().includes(q)) return true;
            if (it.firstFileName?.toLowerCase().includes(q)) return true;
            return false;
        });

        if (this._displayedItems.length === 0) {
            const emptyLabel = new St.Label({
                text: q ? `Нічого не знайдено за запитом "${this._searchEntry.text}"` : 'Буфер обміну порожній',
                style: 'color: rgba(255, 255, 255, 0.40); font-size: 14px; text-align: center; margin: 40px 0;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._listContainer.add_child(emptyLabel);
            return;
        }

        this._displayedItems.forEach((item, index) => {
            const btn = new St.Button({
                style_class: 'mac-clipboard-row',
                style: 'padding: 8px 12px; margin: 2px 4px; border-radius: 12px; background-color: transparent !important;',
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

            // Left Thumbnail / Icon slot (38x38 px)
            const iconSlot = new St.BoxLayout({
                style: 'width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; clip-to-allocation: true;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            if (item.type === 'image' && item.imagePath && GLib.file_test(item.imagePath, GLib.FileTest.EXISTS)) {
                iconSlot.set_style('width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: rgba(0,0,0,0.30); clip-to-allocation: true;');
                const imgIcon = new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(item.imagePath)),
                    icon_size: 38,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                iconSlot.add_child(imgIcon);
            } else if (item.type === 'color' && item.text) {
                iconSlot.set_style(`width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: ${item.text}; border: 1px solid rgba(255,255,255,0.20);`);
            } else {
                iconSlot.set_style('width: 38px; height: 38px; min-width: 38px; min-height: 38px; border-radius: 9px; margin-right: 12px; background-color: rgba(255,255,255,0.06);');
                let iconName = 'text-x-generic-symbolic';
                if (item.type === 'file') iconName = getFileIconName(item.firstFileName || '');
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

            // Middle Text Column
            const textCol = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(textCol);

            const titleLbl = new St.Label({
                text: item.title,
                style: 'font-size: 13.5px; font-weight: 600; color: #ffffff;',
                x_align: Clutter.ActorAlign.START,
            });
            textCol.add_child(titleLbl);

            const subText = `${item.subtitle} • ${formatTimeAgo(item.timestamp)}`;
            const subLbl = new St.Label({
                text: subText,
                style: 'font-size: 11px; color: rgba(255, 255, 255, 0.48); margin-top: 2px;',
                x_align: Clutter.ActorAlign.START,
            });
            textCol.add_child(subLbl);

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
                this._activateItem(item, copyIcon);
            });
            row.add_child(copyBtn);

            btn.connect('clicked', () => {
                this._activateItem(item, copyIcon);
            });
            btn.connect('notify::hover', () => {
                if (btn.hover) {
                    this._setSelectedIndex(index);
                }
            });

            this._rowButtons.push(btn);
            this._listContainer.add_child(btn);
        });

        this._setSelectedIndex(0);
    }

    _moveSelection(delta) {
        if (this._rowButtons.length === 0) return;
        const count = this._rowButtons.length;
        const next = this._selectedIndex < 0 ? 0 : (this._selectedIndex + delta + count) % count;
        this._setSelectedIndex(next);
    }

    _setSelectedIndex(index) {
        this._selectedIndex = index;
        this._rowButtons.forEach((btn, idx) => {
            if (idx === index) {
                btn.set_style('padding: 8px 12px; margin: 2px 4px; border-radius: 12px; background-color: rgba(255, 255, 255, 0.13) !important;');
                try { Util.ensureActorVisibleInScrollView?.(this._scrollView, btn); } catch (_) {}
            } else {
                btn.set_style('padding: 8px 12px; margin: 2px 4px; border-radius: 12px; background-color: transparent !important;');
            }
        });
    }

    _activateCurrent() {
        if (this._selectedIndex >= 0 && this._displayedItems[this._selectedIndex]) {
            this._activateItem(this._displayedItems[this._selectedIndex]);
        }
    }

    _deleteCurrent() {
        if (this._selectedIndex >= 0 && this._displayedItems[this._selectedIndex]) {
            const it = this._displayedItems[this._selectedIndex];
            clipboardStore.deleteItem(it.id);
            this._refreshList();
        }
    }

    _activateItem(item, iconWidget = null) {
        if (!item) return;
        clipboardStore.restore(item);

        if (iconWidget) {
            iconWidget.icon_name = 'object-select-symbolic';
            iconWidget.style = 'color: #34c759;';
        }

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (Main.overview) {
            try { Main.overview.disconnectObject(this); } catch (_) {}
        }
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }
        if (this._glass) {
            try { this._glass.destroy(); } catch (_) {}
            this._glass = null;
        }
        if (this._modalGrab) {
            try { this._modalGrab.dismiss(); } catch (_) {}
            this._modalGrab = null;
        }
        super.destroy();
    }
});

export function toggleClipboardDialog(options = {}) {
    if (globalThis._macClipboardGlobalInstance) {
        if (!globalThis._macClipboardGlobalInstance.get_parent() || globalThis._macClipboardGlobalInstance.is_finalized?.()) {
            try { globalThis._macClipboardGlobalInstance.destroy(); } catch (_) {}
            globalThis._macClipboardGlobalInstance = null;
        }
    }
    if (!globalThis._macClipboardGlobalInstance) {
        try {
            const strays = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'mac-clipboard-wrapper');
            strays.forEach(s => { try { s.destroy(); } catch (_) {} });
            const strayGlasses = Main.layoutManager.uiGroup.get_children().filter(c => c._owner === 'clipboard' || (c.name === 'liquid-glass-bg-actor' && c._owner === 'clipboard'));
            strayGlasses.forEach(g => { try { g.destroy(); } catch (_) {} });
        } catch (_) {}
        globalThis._macClipboardGlobalInstance = new MacClipboardDialog();
    }
    if (globalThis._macClipboardGlobalInstance._isOpen) {
        globalThis._macClipboardGlobalInstance.close();
    } else {
        if (typeof globalThis._macCloseAllCenters === 'function') {
            globalThis._macCloseAllCenters('clipboard');
        } else {
            try { globalThis._tahoeQSClose?.(); } catch (_) {}
            try { globalThis._tahoeNCClose?.(true); } catch (_) {}
            try { globalThis._macSpotlightGlobalInstance?.close?.(true); } catch (_) {}
        }
        if (Main.overview?.visible) {
            Main.overview.hide();
        }
        globalThis._macClipboardGlobalInstance.open(options);
    }
}

export function openClipboardDialog(options = {}) {
    if (!globalThis._macClipboardGlobalInstance) {
        globalThis._macClipboardGlobalInstance = new MacClipboardDialog();
    }
    if (typeof globalThis._macCloseAllCenters === 'function') {
        globalThis._macCloseAllCenters('clipboard');
    } else {
        try { globalThis._tahoeQSClose?.(); } catch (_) {}
        try { globalThis._tahoeNCClose?.(true); } catch (_) {}
        try { globalThis._macSpotlightGlobalInstance?.close?.(true); } catch (_) {}
    }
    if (Main.overview?.visible) {
        Main.overview.hide();
    }
    globalThis._macClipboardGlobalInstance.open(options);
}

export function closeClipboardDialog(immediate = true) {
    if (globalThis._macClipboardGlobalInstance) {
        globalThis._macClipboardGlobalInstance.close(immediate);
    }
}

export function destroyClipboardDialog() {
    if (globalThis._macClipboardGlobalInstance) {
        try { globalThis._macClipboardGlobalInstance.destroy(); } catch (_) {}
        globalThis._macClipboardGlobalInstance = null;
    }
}

globalThis.toggleMacClipboard = toggleClipboardDialog;
globalThis.closeMacClipboard = closeClipboardDialog;
globalThis._macClipboardClose = closeClipboardDialog;
globalThis.destroyMacClipboard = destroyClipboardDialog;
globalThis.macClipboardStore = clipboardStore;
