import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { getAppFavorites } from 'resource:///org/gnome/shell/ui/appFavorites.js';
import { Dash } from 'resource:///org/gnome/shell/ui/dash.js';

const DIALOG_WIDTH = 714;
const DIALOG_HEIGHT = 530;
const COLUMNS = 7;
const COLUMN_WIDTH = 94;
const ICON_SIZE = 52;
const CORNER_RADIUS = 24.0;
const TINT_STRENGTH = 0.05;
const BLUR_RADIUS = 2.0;

const CATEGORIES = [
    {
        id: 'utility',
        label: 'Утиліти',
        match: ['utility', 'system', 'settings', 'terminalemulator', 'terminal', 'filemanager', 'archiving', 'monitor', 'security', 'clock', 'calculator', 'preferences', 'help', 'desktopsettings']
    },
    {
        id: 'communication',
        label: 'Спілкування',
        match: ['network', 'chat', 'instantmessaging', 'email', 'feed', 'webbrowser', 'ircclient', 'telephony', 'contactmanagement', 'social', 'news']
    },
    {
        id: 'productivity',
        label: 'Продуктивність',
        match: ['office', 'development', 'texteditor', 'ide', 'editor', 'graphics', 'audiovideo', 'audio', 'video', 'photography', 'publishing', 'viewer', 'documentation', 'audiovideoediting', 'database']
    },
    {
        id: 'other',
        label: 'Інше',
        match: []
    }
];

// Ensure Dash can resolve apps from custom drag sources
function _ensureDashGetAppHook() {
    if (Dash && !Dash._macthemeGetAppHooked) {
        const origGetAppFromSource = Dash.getAppFromSource;
        Dash.getAppFromSource = function(source) {
            if (source?.app) return source.app;
            if (source?._app) return source._app;
            if (source?._delegate?.app) return source._delegate.app;
            return origGetAppFromSource ? origGetAppFromSource.call(this, source) : null;
        };
        Dash._macthemeGetAppHooked = true;
    }
}

// Global Dock drag-off-to-unpin monitor
let _dockDragMonitor = null;

function _ensureDockDragMonitor() {
    if (_dockDragMonitor) return;

    _dockDragMonitor = {
        dragDrop: (dropEvent) => {
            const icon = globalThis._activeDockDragIcon;
            if (!icon || !icon.app) return DND.DragDropResult.CONTINUE;

            const appId = icon.app.get_id?.();
            if (!appId || appId === 'launchpad.desktop') {
                return DND.DragDropResult.CONTINUE;
            }

            try {
                const dock = Main.layoutManager.uiGroup.get_children().find(c => c.constructor.name === 'DashToDock');
                if (!dock) return DND.DragDropResult.CONTINUE;

                const container = dock.dash?._container || dock.dash;
                if (!container) return DND.DragDropResult.CONTINUE;

                const [gx, gy] = container.get_transformed_position();
                const [gw, gh] = container.get_transformed_size();
                const [px, py] = global.get_pointer();

                const margin = 28;
                const isInsideDock = (
                    px >= (gx - margin) &&
                    px <= (gx + gw + margin) &&
                    py >= (gy - margin) &&
                    py <= (gy + gh + margin)
                );

                if (!isInsideDock) {
                    // Dropped outside dock area -> unpin from favorites
                    const favs = getAppFavorites();
                    if (favs.isFavorite(appId)) {
                        favs.removeFavorite(appId);
                    }

                    // Authentic macOS "poof" animation
                    if (dropEvent.dropActor) {
                        dropEvent.dropActor.remove_all_transitions();
                        dropEvent.dropActor.ease({
                            opacity: 0,
                            scale_x: 1.4,
                            scale_y: 1.4,
                            duration: 220,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                try { dropEvent.dropActor?.destroy?.(); } catch (_) {}
                            }
                        });
                    }

                    globalThis._activeDockDragIcon = null;
                    return DND.DragDropResult.SUCCESS;
                }
            } catch (e) {
                console.error('[MacApplications] dock drag monitor error:', e);
            }

            return DND.DragDropResult.CONTINUE;
        }
    };

    try {
        DND.addDragMonitor(_dockDragMonitor);
    } catch (e) {
        console.error('[MacApplications] failed to add drag monitor:', e);
    }
}

// Hook dock icons to record active drag
function _hookDockIconsForDrag() {
    try {
        const dock = Main.layoutManager.uiGroup.get_children().find(c => c.constructor.name === 'DashToDock');
        if (dock?.dash?.getAppIcons) {
            const icons = dock.dash.getAppIcons();
            icons.forEach(appIcon => {
                if (appIcon._draggable && !appIcon._dragHookAttached) {
                    appIcon._draggable.connect('drag-begin', () => {
                        globalThis._activeDockDragIcon = appIcon;
                    });
                    appIcon._draggable.connect('drag-end', () => {
                        globalThis._activeDockDragIcon = null;
                    });
                    appIcon._draggable.connect('drag-cancelled', () => {
                        globalThis._activeDockDragIcon = null;
                    });
                    appIcon._dragHookAttached = true;
                }
            });
        }
    } catch (_) {}
}

export const MacApplicationsDialog = GObject.registerClass({
    GTypeName: `MacApplicationsDialog_${Math.floor(Math.random() * 1000000)}`,
}, class MacApplicationsDialog extends Clutter.Actor {
    _init() {
        super._init({
            name: 'mac-applications-wrapper',
            reactive: true,
            visible: false,
        });

        this._isOpen = false;
        this._isAnimating = false;
        this._appSystem = Shell.AppSystem.get_default();
        this._selectedCategory = null;
        this._categoryButtons = [];
        this._gridButtons = [];
        this._currentQuery = '';
        this._searchTimeoutId = 0;
        this._stageSignalId = 0;
        this._glass = null;

        _ensureDashGetAppHook();
        _ensureDockDragMonitor();
        _hookDockIconsForDrag();

        // 1. Transparent Backdrop Click-Catcher (closes on click outside)
        this._backdrop = new Clutter.Actor({
            name: 'mac-applications-backdrop',
            reactive: true,
            visible: false,
        });
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._backdrop);

        // 2. Main Floating Applications Container (LQ-Visual Glass)
        this._box = new St.BoxLayout({
            name: 'mac-applications-box',
            style_class: 'mac-applications-box',
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            clip_to_allocation: true,
        });
        this._box.set_style(
            'background-color: transparent !important; ' +
            'background: none !important; ' +
            `border-radius: ${CORNER_RADIUS}px !important; ` +
            'border: 1px solid rgba(255, 255, 255, 0.20) !important; ' +
            'padding: 16px 16px 14px 16px; ' +
            'box-shadow: none !important;'
        );
        this.add_child(this._box);

        this._initGlass();

        // 3. Header Row: App Store 'A' icon, search field "| Програми", and "..." menu button
        this._headerRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'height: 44px; margin-bottom: 12px;',
        });
        this._box.add_child(this._headerRow);

        // App Store icon matching reference image
        let appIconGIcon = null;
        try {
            const home = GLib.get_home_dir();
            const candidates = [
                `${home}/.local/share/icons/MacTahoe/apps/scalable/Appstore.svg`,
                `${home}/.local/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
                `${home}/.local/share/icons/macW1Y-dark/apps/scalable/Appstore.svg`,
                `/usr/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
            ];
            for (const p of candidates) {
                if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
                    appIconGIcon = Gio.FileIcon.new(Gio.File.new_for_path(p));
                    break;
                }
            }
        } catch (_) {}

        this._appLogo = new St.Icon({
            gicon: appIconGIcon,
            icon_name: appIconGIcon ? null : 'applications-other-symbolic',
            icon_size: 26,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 4px; margin-right: 12px; opacity: 0.9;',
        });
        this._headerRow.add_child(this._appLogo);

        // Search Entry
        this._entry = new St.Entry({
            name: 'mac-applications-search',
            hint_text: 'Програми',
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 18px !important; font-weight: 500 !important; color: #ffffff !important; ' +
                   'background-color: transparent !important; background: none !important; ' +
                   'border: none !important; box-shadow: none !important; outline: none !important;',
        });
        if (this._entry.clutter_text?.set_single_line_mode) {
            this._entry.clutter_text.set_single_line_mode(true);
        }
        this._headerRow.add_child(this._entry);

        // Overflow "..." icon
        this._moreIcon = new St.Icon({
            icon_name: 'view-more-symbolic',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(255, 255, 255, 0.60); margin-right: 6px;',
        });
        this._headerRow.add_child(this._moreIcon);

        // 4. Category Filter Bar (4 rounded pills matching reference image)
        this._categoryRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'height: 32px; margin-bottom: 14px;',
        });
        this._box.add_child(this._categoryRow);
        this._buildCategoryButtons();

        // 5. Scroll Wrapper with BinLayout containing ScrollView and Bottom Fade Overlay
        this._scrollWrapper = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            style: 'height: 382px; min-height: 382px; max-height: 382px;',
        });
        this._box.add_child(this._scrollWrapper);

        this._scrollView = new St.ScrollView({
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'height: 382px; padding-right: 2px; padding-bottom: 4px;',
        });
        this._scrollWrapper.add_child(this._scrollView);

        this._gridContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this._scrollView.add_child(this._gridContainer);

        // Subtle gradient blur and darkening at the bottom (like the menubar)
        this._bottomFade = new St.Widget({
            style: 'background-gradient-direction: vertical; ' +
                   'background-gradient-start: rgba(18, 18, 18, 0.0); ' +
                   'background-gradient-end: rgba(18, 18, 18, 0.85); ' +
                   'border-bottom-left-radius: 20px; ' +
                   'border-bottom-right-radius: 20px;',
            height: 36,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
        });
        try {
            this._bottomFade.add_effect(new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 8 }));
        } catch (_) {}
        this._scrollWrapper.add_child(this._bottomFade);

        // 6. Connect Input & Keyboard Navigation
        const ct = this._entry.clutter_text;
        ct.connect('text-changed', () => {
            if (this._searchTimeoutId) {
                GLib.source_remove(this._searchTimeoutId);
            }
            this._searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                this._searchTimeoutId = 0;
                this._currentQuery = this._entry.text.trim();
                this._refreshGrid(true);
                return GLib.SOURCE_REMOVE;
            });
        });

        ct.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                if (this._gridButtons.length > 0) {
                    const first = this._gridButtons[0];
                    if (first?.app) {
                        this._launchApp(first.app);
                    }
                }
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Down) {
                if (this._gridButtons.length > 0) {
                    this._gridButtons[0].grab_key_focus();
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildCategoryButtons() {
        this._categoryRow.destroy_all_children();
        this._categoryButtons = [];

        CATEGORIES.forEach(cat => {
            const isSelected = (this._selectedCategory === cat.id);
            const btn = new St.Button({
                style_class: 'mac-category-pill',
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const pillBg = isSelected ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)';
            const pillColor = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
            btn.set_style(
                `background-color: ${pillBg}; ` +
                `color: ${pillColor}; ` +
                'border-radius: 10px; ' +
                'height: 32px; ' +
                'margin: 0 4px; ' +
                'font-size: 13px; ' +
                'font-weight: 500;'
            );

            const label = new St.Label({
                text: cat.label,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(label);

            btn.connect('clicked', () => {
                if (this._selectedCategory === cat.id) {
                    this._selectedCategory = null; // Toggle off to show all
                } else {
                    this._selectedCategory = cat.id;
                }
                this._buildCategoryButtons();
                this._refreshGrid(true);
            });

            btn.connect('notify::hover', () => {
                const hover = btn.hover;
                const active = (this._selectedCategory === cat.id);
                if (active) {
                    btn.set_style(
                        'background-color: rgba(255, 255, 255, 0.32); ' +
                        'color: #ffffff; border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 500;'
                    );
                } else {
                    const bg = hover ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.08)';
                    btn.set_style(
                        `background-color: ${bg}; ` +
                        'color: rgba(255, 255, 255, 0.85); border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 500;'
                    );
                }
            });

            this._categoryRow.add_child(btn);
            this._categoryButtons.push(btn);
        });
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
                owner: 'applications',
            });
            this._glass.setIsDock(true);
            this._glass.setCornerSmoothingEnabled(0.0);
            this._glass.setCornerRadius(CORNER_RADIUS);
            this._glass.setTintColor(0.0, 0.0, 0.0);
            this._glass.setTintStrength(TINT_STRENGTH);
            this._glass.setBrightness(1.0);
            this._glass.setSaturation(1.0);
            this._glass.setContrast(1.0);
            this._glass.setBlurRadius(BLUR_RADIUS);
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
            console.error(`[MacApplications] Error initializing BackdropGlass: ${e}`);
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
        const rawH = box.height > 0 ? box.height : DIALOG_HEIGHT;

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
        this._glass.setCornerRadius(CORNER_RADIUS);
        this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
        this._glass.set_clip(localBgX, localBgY, bgW, bgH);
        this._glass.syncSources();
    }

    _getAppCategory(app) {
        const info = app.get_app_info?.() || app;
        let catStr = '';
        try {
            catStr = (info.get_categories?.() || '').toLowerCase();
        } catch (_) {}

        // Match priority: communication -> productivity -> utility -> other
        const priorityOrder = ['communication', 'productivity', 'utility'];
        for (const catId of priorityOrder) {
            const cat = CATEGORIES.find(c => c.id === catId);
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
            if (!id || seen.has(id) || id === 'launchpad.desktop') continue;
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
        const usage = Shell.AppUsage.get_default();
        const mostUsed = usage.get_most_used() || [];
        const recent = [];
        const seen = new Set();

        for (const app of mostUsed) {
            const id = app?.get_id?.();
            if (id && id !== 'launchpad.desktop' && allApps.some(a => a.get_id() === id)) {
                if (!seen.has(id)) {
                    seen.add(id);
                    recent.push(app);
                    if (recent.length >= COLUMNS) break;
                }
            }
        }

        // If fewer than COLUMNS, supplement with favorite/top apps
        if (recent.length < COLUMNS) {
            const favs = getAppFavorites().getFavorites();
            for (const app of favs) {
                const id = app?.get_id?.();
                if (id && id !== 'launchpad.desktop' && !seen.has(id) && allApps.some(a => a.get_id() === id)) {
                    seen.add(id);
                    recent.push(app);
                    if (recent.length >= COLUMNS) break;
                }
            }
        }

        // Pad from allApps if still needed
        if (recent.length < COLUMNS) {
            for (const app of allApps) {
                const id = app.get_id();
                if (!seen.has(id)) {
                    seen.add(id);
                    recent.push(app);
                    if (recent.length >= COLUMNS) break;
                }
            }
        }

        return recent.slice(0, COLUMNS);
    }

    _filterApps() {
        const allApps = this._getAllApps();
        const query = this._currentQuery.toLowerCase();
        const category = this._selectedCategory;

        // If search query is present
        if (query) {
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

                const matchesQuery = name.includes(query) ||
                                     desc.includes(query) ||
                                     exec.includes(query) ||
                                     id.includes(query) ||
                                     keywords.includes(query);

                if (!matchesQuery) return false;
                if (category && this._getAppCategory(app) !== category) return false;
                return true;
            }).sort((a, b) => a.get_name().localeCompare(b.get_name()));
        }

        // If category is selected without search query
        if (category) {
            return allApps.filter(app => this._getAppCategory(app) === category)
                          .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        }

        // Normal state: Row 1 has 7 Recent Apps, followed by all remaining installed apps
        const recentApps = this._getRecentApps(allApps);
        const recentIds = new Set(recentApps.map(a => a.get_id()));

        const remaining = allApps
            .filter(a => !recentIds.has(a.get_id()))
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        return [...recentApps, ...remaining];
    }

    _createAppItem(app, index) {
        const item = new St.Button({
            style_class: 'mac-app-grid-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.START,
        });

        item.set_width(COLUMN_WIDTH);
        item.width = COLUMN_WIDTH;
        item.set_style(
            `width: ${COLUMN_WIDTH}px; ` +
            `min-width: ${COLUMN_WIDTH}px; ` +
            `max-width: ${COLUMN_WIDTH}px; ` +
            'height: 82px; ' +
            'min-height: 82px; ' +
            'max-height: 82px; ' +
            'margin: 0 1px; ' +
            'padding: 6px 2px 4px 2px; ' +
            'border-radius: 12px; ' +
            'background-color: transparent; ' +
            'transition-duration: 150ms;'
        );

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        item.set_child(box);

        let iconActor = null;
        try {
            iconActor = app.create_icon_texture?.(ICON_SIZE);
        } catch (_) {}

        if (!iconActor) {
            iconActor = new St.Icon({
                gicon: app.get_icon?.() || null,
                icon_name: 'application-x-executable',
                icon_size: ICON_SIZE,
            });
        }
        iconActor.x_align = Clutter.ActorAlign.CENTER;
        iconActor.y_align = Clutter.ActorAlign.CENTER;
        iconActor.set_style('margin-bottom: 5px;');
        box.add_child(iconActor);

        const label = new St.Label({
            text: app.get_name() || '',
            style_class: 'mac-app-title',
            style: `font-size: 11px !important; color: rgba(255, 255, 255, 0.90) !important; ` +
                   `text-align: center !important; font-weight: 500 !important; ` +
                   `width: ${COLUMN_WIDTH - 4}px; max-width: ${COLUMN_WIDTH - 4}px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        if (label.clutter_text) {
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        }
        box.add_child(label);

        // Hover & Focus Styling
        const baseStyle = `width: ${COLUMN_WIDTH}px; min-width: ${COLUMN_WIDTH}px; max-width: ${COLUMN_WIDTH}px; height: 82px; min-height: 82px; max-height: 82px; margin: 0 1px; padding: 6px 2px 4px 2px; border-radius: 12px;`;

        item.connect('notify::hover', () => {
            if (item.hover) {
                item.set_style(`${baseStyle} background-color: rgba(255, 255, 255, 0.12);`);
            } else if (!item.has_key_focus()) {
                item.set_style(`${baseStyle} background-color: transparent;`);
            }
        });

        item.connect('key-focus-in', () => {
            item.set_style(`${baseStyle} background-color: rgba(255, 255, 255, 0.20);`);
        });

        item.connect('key-focus-out', () => {
            if (!item.hover) {
                item.set_style(`${baseStyle} background-color: transparent;`);
            }
        });

        // Launch app on click
        item.connect('clicked', () => {
            this._launchApp(app);
        });

        // DND Support to Dock
        item._delegate = item;
        item.app = app;
        item.is_window_backed = () => false;
        item.getDragActor = () => {
            let dragIcon = null;
            try {
                dragIcon = app.create_icon_texture?.(ICON_SIZE);
            } catch (_) {}
            return dragIcon || new St.Icon({
                gicon: app.get_icon?.() || null,
                icon_name: 'application-x-executable',
                icon_size: ICON_SIZE,
            });
        };
        item.getDragActorSource = () => item;

        item._draggable = DND.makeDraggable(item, {
            restoreOnSuccess: false,
            timeoutThreshold: 150,
        });

        item._draggable.connect('drag-begin', () => {
            this._box.ease({
                opacity: 40,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });

        item._draggable.connect('drag-end', (_actor, _time, success) => {
            if (success) {
                this.close();
            } else {
                this._box.ease({
                    opacity: 255,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });

        item._draggable.connect('drag-cancelled', () => {
            this._box.ease({
                opacity: 255,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });

        // Keyboard navigation across 7 columns
        item.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._launchApp(app);
                return Clutter.EVENT_STOP;
            }

            const total = this._gridButtons.length;
            if (symbol === Clutter.KEY_Right && (index + 1 < total)) {
                this._gridButtons[index + 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Left && (index - 1 >= 0)) {
                this._gridButtons[index - 1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Down && (index + COLUMNS < total)) {
                this._gridButtons[index + COLUMNS].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Up) {
                if (index - COLUMNS >= 0) {
                    this._gridButtons[index - COLUMNS].grab_key_focus();
                } else {
                    this._entry.grab_key_focus();
                }
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        return item;
    }

    _buildGridItems() {
        this._gridContainer.destroy_all_children();
        this._gridButtons = [];

        const apps = this._filterApps();
        const numRows = Math.ceil(apps.length / COLUMNS);

        let appIdx = 0;
        for (let r = 0; r < numRows; r++) {
            const rowBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'margin-bottom: 8px;',
            });

            for (let c = 0; c < COLUMNS; c++) {
                if (appIdx < apps.length) {
                    const app = apps[appIdx];
                    const item = this._createAppItem(app, appIdx);
                    rowBox.add_child(item);
                    this._gridButtons.push(item);
                    appIdx++;
                } else {
                    // Transparent placeholder to maintain identical 7-column spacing
                    const spacer = new St.Widget({
                        x_expand: false,
                        style: `width: ${COLUMN_WIDTH}px; min-width: ${COLUMN_WIDTH}px; max-width: ${COLUMN_WIDTH}px; margin: 0 1px;`,
                    });
                    spacer.set_width(COLUMN_WIDTH);
                    spacer.width = COLUMN_WIDTH;
                    rowBox.add_child(spacer);
                }
            }

            this._gridContainer.add_child(rowBox);
        }
    }

    _refreshGrid(animated = true) {
        if (!animated || !this._gridContainer.visible || this._gridContainer.opacity === 0) {
            this._buildGridItems();
            return;
        }

        // Smooth transition animation when typing search or toggling categories
        this._gridContainer.remove_all_transitions();
        this._gridContainer.ease({
            opacity: 0,
            translation_y: -4,
            duration: 80,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._buildGridItems();
                this._gridContainer.translation_y = 6;
                this._gridContainer.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        });
    }

    _launchApp(app) {
        if (!app) return;
        this.close();
        try {
            app.open_new_window(-1);
        } catch (e) {
            console.error(`[MacApplications] Failed to launch ${app.get_id()}:`, e);
        }
    }

    open() {
        if (this._isOpen) return;
        this._isOpen = true;

        _hookDockIconsForDrag();

        const mon = Main.layoutManager.primaryMonitor;
        this.set_position(0, 0);
        this.set_size(mon.width, mon.height);

        this._backdrop.set_position(mon.x, mon.y);
        this._backdrop.set_size(mon.width, mon.height);
        this._backdrop.visible = true;

        const x = mon.x + Math.round((mon.width - DIALOG_WIDTH) / 2);
        const y = mon.y + Math.round((mon.height - DIALOG_HEIGHT) / 2);

        this._box.set_position(x, y);
        this._box.set_size(DIALOG_WIDTH, DIALOG_HEIGHT);
        this._box.set_pivot_point(0.5, 0.5);
        this._box.scale_x = 0.94;
        this._box.scale_y = 0.94;
        this._box.opacity = 0;

        this._currentQuery = '';
        this._entry.text = '';
        this._selectedCategory = null;
        this._buildCategoryButtons();
        this._refreshGrid(false);

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

        this._entry.grab_key_focus();

        this._box.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        this._backdrop.visible = false;
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }

        if (this._glass?.visible) {
            this._glass.hide();
        }

        this._box.ease({
            opacity: 0,
            scale_x: 0.94,
            scale_y: 0.94,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                this.visible = false;
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

    destroy() {
        if (this._searchTimeoutId) {
            GLib.source_remove(this._searchTimeoutId);
            this._searchTimeoutId = 0;
        }
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
        }
        if (this._glass) {
            try { this._glass.destroy(); } catch (_) {}
            this._glass = null;
        }
        super.destroy();
    }
});

export function toggleApplicationsDialog() {
    if (globalThis._macApplicationsGlobalInstance) {
        if (!globalThis._macApplicationsGlobalInstance.get_parent()) {
            try { globalThis._macApplicationsGlobalInstance.destroy(); } catch (_) {}
            globalThis._macApplicationsGlobalInstance = null;
        }
    }
    if (!globalThis._macApplicationsGlobalInstance) {
        try {
            const strays = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'mac-applications-wrapper');
            strays.forEach(s => { try { s.destroy(); } catch (_) {} });
        } catch (_) {}
        globalThis._macApplicationsGlobalInstance = new MacApplicationsDialog();
    }
    globalThis._macApplicationsGlobalInstance.toggle();
}

export function destroyApplicationsDialog() {
    if (globalThis._macApplicationsGlobalInstance) {
        try { globalThis._macApplicationsGlobalInstance.destroy(); } catch (_) {}
        globalThis._macApplicationsGlobalInstance = null;
    }
}

globalThis.toggleMacApplications = toggleApplicationsDialog;
globalThis.destroyMacApplications = destroyApplicationsDialog;
