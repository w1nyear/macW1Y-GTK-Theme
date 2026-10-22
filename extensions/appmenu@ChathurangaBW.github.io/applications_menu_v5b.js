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
        if (glass._cleanedUp || glass.is_finalized?.()) return false;
        return typeof glass.visible === 'boolean';
    } catch (_) {
        return false;
    }
}

const DIALOG_WIDTH = 714;
const DIALOG_HEIGHT = 530;
const COLUMNS = 7;
const COLUMN_WIDTH = 94;
const ICON_SIZE = 52;
const CORNER_RADIUS = 26.0;
const TINT_STRENGTH = 0.04;
const BLUR_RADIUS = 8.0;

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

        if (Main.overview) {
            Main.overview.connectObject('showing', () => {
                this.close(true);
            }, this);
        }

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
            'border: none !important; ' +
            'padding: 16px 2px 14px 2px; ' +
            'box-shadow: none !important;'
        );
        this.add_child(this._box);
        this._box.connect('notify::x', () => this._syncGlass());
        this._box.connect('notify::y', () => this._syncGlass());
        this._box.connect('notify::width', () => this._syncGlass());
        this._box.connect('notify::height', () => this._syncGlass());
        this._box.connect('notify::scale-x', () => this._syncGlass());
        this._box.connect('notify::scale-y', () => this._syncGlass());

        this.connect('captured-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS) {
                const symbol = event.get_key_symbol();
                const state = event.get_state();
                const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
                if (symbol === Clutter.KEY_Escape || (isCtrl && symbol === Clutter.KEY_space)) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.connect('destroy', () => {
            this._onDestroy();
        });

        this._initializingGlass = false;
        this._initGlassPromise = this._initGlass().catch(() => {});

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

        // 3. Header Row: App Store 'A' icon, search field "| Програми", and "..." menu button
        this._headerRow = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'height: 36px; margin-left: 18px; margin-right: 18px;',
        });
        this._box.add_child(this._headerRow);

        // Glyph icon 'A' (simple line SVG as on the macOS Tahoe reference photo)
        let appIconGIcon = null;
        try {
            let extDirPath = null;
            try { extDirPath = new URL('.', import.meta.url).pathname; } catch (_) {}
            const home = GLib.get_home_dir();
            const candidates = [
                extDirPath ? `${extDirPath}icons/mac-launchpad-a.svg` : null,
                `${home}/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/icons/mac-launchpad-a.svg`,
                `${home}/.local/share/icons/MacTahoe/apps/scalable/Appstore.svg`,
                `${home}/.local/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
                `${home}/.local/share/icons/macW1Y-dark/apps/scalable/Appstore.svg`,
                `/usr/share/icons/MacTahoe-dark/apps/scalable/Appstore.svg`,
            ];
            for (const p of candidates) {
                if (p && GLib.file_test(p, GLib.FileTest.EXISTS)) {
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
            style: 'margin-left: 4px; margin-right: 12px; opacity: 0.95; icon-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);',
        });
        this._headerRow.add_child(this._appLogo);

        // Search Entry
        this._entry = new St.Entry({
            name: 'mac-applications-search',
            hint_text: 'Програми',
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 18px !important; font-weight: 600 !important; color: #ffffff !important; ' +
                   'hint-text-color: #ffffff !important; ' +
                   'text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; ' +
                   'background-color: transparent !important; background: none !important; ' +
                   'border: none !important; box-shadow: none !important; outline: none !important;',
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
        this._headerRow.add_child(this._entry);

        // Overflow "..." icon
        this._moreIcon = new St.Icon({
            icon_name: 'view-more-symbolic',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(255, 255, 255, 0.75); margin-right: 6px; icon-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);',
        });
        this._headerRow.add_child(this._moreIcon);

        // Тонка лінія-розділювач під полем вводу (як на фото‑референсі)
        this._headerDivider = new St.Widget({
            x_expand: true,
            style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.10); margin-left: 18px; margin-right: 18px; margin-bottom: 12px;',
        });
        this._box.add_child(this._headerDivider);

        // 4. Category Filter Bar (4 rounded pills matching reference image)
        this._categoryRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'height: 32px; margin-bottom: 14px; margin-left: 18px; margin-right: 18px;',
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
            style_class: 'mac-launchpad-scroll',
            overlay_scrollbars: true,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
            style: 'height: 382px; padding-bottom: 4px;',
        });
        this._scrollWrapper.add_child(this._scrollView);

        this._gridContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style: 'padding: 0;',
        });
        this._scrollView.add_child(this._gridContainer);

        // Transparent bottom spacer without darkening gradient overlay
        this._bottomFade = new St.Widget({
            style: 'background: none !important; background-color: transparent !important;',
            height: 0,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            reactive: false,
        });
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
            const state = event.get_state();
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (symbol === Clutter.KEY_Escape || (isCtrl && symbol === Clutter.KEY_space)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                this.close(true);
                Main.overview.show();
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
                        'border: none !important; ' +
                        'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); ' +
                        'color: #ffffff !important; border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 600;'
                    );
                } else {
                    const bg = hover ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.12)';
                    const border = 'border: none !important;';
                    btn.set_style(
                        `background-color: ${bg}; ` +
                        `${border} ` +
                        'box-shadow: none; ' +
                        'color: #ffffff !important; border-radius: 10px; height: 32px; margin: 0 4px; font-size: 13px; font-weight: 600;'
                    );
                }
            });

            this._categoryRow.add_child(btn);
            this._categoryButtons.push(btn);
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
        this._glass.setBlurRadius(BLUR_RADIUS);
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
                owner: 'applications',
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

            this._box.set_style(
                'background-color: transparent !important; ' +
                'background: none !important; ' +
                `border-radius: ${CORNER_RADIUS}px !important; ` +
                'border: none !important; ' +
                'padding: 16px 2px 14px 2px; ' +
                'box-shadow: none !important;'
            );

            this._glass.show();
            this._glass.opacity = (typeof this._box.opacity === 'number' && this._box.opacity > 0) ? this._box.opacity : 255;
            this._glass._backdropLocked = false;
            if (typeof this._glass.forceRefresh === 'function') {
                this._glass.forceRefresh(1);
            }
            this._syncGlass();
        } catch (e) {
            console.error(`[MacApplications] Error initializing BackdropGlass: ${e}`);
        } finally {
            this._initializingGlass = false;
        }
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

            const mon = Main.layoutManager.primaryMonitor;
            const scaleX = box.scale_x ?? 1.0;
            const scaleY = box.scale_y ?? 1.0;
            const rawW = box.width > 0 ? box.width : DIALOG_WIDTH;
            const rawH = box.height > 0 ? box.height : DIALOG_HEIGHT;

            const w = rawW * scaleX;
            const h = rawH * scaleY;
            const bx = box.x + (rawW - w) * 0.5;
            const by = box.y + (rawH - h) * 0.5;

            const localBgX = Math.round(bx - mon.x);
            const localBgY = Math.round(by - mon.y);
            const bgW = Math.round(w);
            const bgH = Math.round(h);

            const targetOpacity = (typeof box.opacity === 'number' && box.opacity > 0) ? box.opacity : 255;
            if (this._glass.opacity !== targetOpacity) {
                this._glass.opacity = targetOpacity;
            }
            if (!this._glass.visible) {
                this._glass.show();
            }

            this._glass.set_position(mon.x, mon.y);
            this._glass.set_size(mon.width, mon.height);
            this._glass.setResolution(mon.width, mon.height);
            const { isDark, tintR, tintG, tintB, tintStrength } = this._getThemeParams();
            this._glass.setIsDock(false);
            this._glass.setTintColor(tintR, tintG, tintB);
            this._glass.setTintStrength(tintStrength);
            this._glass.setBlurRadius(BLUR_RADIUS);
            this._glass.setCornerRadius(CORNER_RADIUS);
            this._glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
            const CLIP_PAD = 60;
            this._glass.set_clip(localBgX - CLIP_PAD, localBgY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
        } catch (_) {}
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
        iconActor.set_style('margin-bottom: 5px; icon-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);');
        box.add_child(iconActor);

        const label = new St.Label({
            text: app.get_name() || '',
            style_class: 'mac-app-title',
            style: `font-size: 11px !important; color: #ffffff !important; ` +
                   `text-align: center !important; font-weight: 500 !important; ` +
                   `text-shadow: 0 1px 1px rgba(0, 0, 0, 0.20) !important; ` +
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
            if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
                this.close(true);
                Main.overview.show();
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

            // Друга тонка лінія — під сімома останніми програмами (лише у звичайному стані)
            if (r === 0 && !this._currentQuery && !this._selectedCategory && apps.length > 0) {
                const gridDivider = new St.Widget({
                    x_expand: true,
                    style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.10); margin: 2px 18px 10px 18px;',
                });
                this._gridContainer.add_child(gridDivider);
            }
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

    open(options = {}) {
        if (this._isOpen) return;
        if (Main.overview?.visible) return;
        this._isOpen = true;

        _hookDockIconsForDrag();

        const mon = Main.layoutManager.primaryMonitor;
        this.set_position(0, 0);
        this.set_size(mon.width, mon.height);

        this._backdrop.set_position(mon.x, mon.y);
        this._backdrop.set_size(mon.width, mon.height);
        this._backdrop.visible = true;

        const targetX = mon.x + Math.round((mon.width - DIALOG_WIDTH) / 2);
        const targetY = mon.y + Math.round(mon.height * 0.16);

        this._currentQuery = '';
        this._entry.text = '';
        this._selectedCategory = null;
        this._buildCategoryButtons();
        this._refreshGrid(false);

        this._box.remove_all_transitions();
        this.remove_all_transitions();

        this._box.set_position(targetX, targetY);
        this._box.set_size(DIALOG_WIDTH, DIALOG_HEIGHT);
        // macOS Tahoe style: fade-in + slight "recede" (start larger at 1.06, settle to 1.0)
        this._box.set_pivot_point(0.5, 0.5);
        this._box.scale_x = 1.06;
        this._box.scale_y = 1.06;
        this._box.opacity = 0;
        this._headerRow.opacity = 255;
        this._categoryRow.opacity = 255;
        this._scrollWrapper.opacity = 255;

        if (!this.get_parent()) {
            Main.layoutManager.uiGroup.add_child(this);
        }
        this.visible = true;

        if (_isGlassAlive(this._glass)) {
            try {
                this._glass.remove_all_transitions();
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
                this._glass.ease({
                    opacity: 255,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } catch (err) {
                try { this._glass?.destroy?.(); } catch (_) {}
                this._glass = null;
                this._initGlassPromise = this._initGlass();
                Main.layoutManager.uiGroup.set_child_above_sibling(this, null);
            }
        } else {
            try { this._glass?.destroy?.(); } catch (_) {}
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
                    this._glass.ease({
                        opacity: 255,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                }).catch(() => {});
            }
        }

        try {
            this._entry.grab_key_focus();
        } catch (_) {}

        this._box.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onUpdate: () => {
                this._syncGlass();
            },
            onComplete: () => {
                this._syncGlass();
            },
        });
    }

    close(immediate = false) {
        if (!this._isOpen) return;
        this._isOpen = false;

        this._backdrop.visible = false;
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
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

        this._box.ease({
            opacity: 0,
            scale_x: 1.06,
            scale_y: 1.06,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.visible = false;
                hideGlass();
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

    _onDestroy() {
        if (Main.overview) {
            try { Main.overview.disconnectObject(this); } catch (_) {}
        }
        if (this._searchTimeoutId) {
            try { GLib.source_remove(this._searchTimeoutId); } catch (_) {}
            this._searchTimeoutId = 0;
        }
        if (this._stageSignalId) {
            try { global.stage.disconnect(this._stageSignalId); } catch (_) {}
            this._stageSignalId = 0;
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

export function ensureApplicationsDialog() {
    if (globalThis._macApplicationsGlobalInstance) {
        let isDead = false;
        try {
            if (globalThis._macApplicationsGlobalInstance.is_finalized?.() ||
                !_isActorValid(globalThis._macApplicationsGlobalInstance)) {
                isDead = true;
            }
        } catch (_) {
            isDead = true;
        }
        if (isDead) {
            try { globalThis._macApplicationsGlobalInstance.destroy(); } catch (_) {}
            globalThis._macApplicationsGlobalInstance = null;
        }
    }
    if (!globalThis._macApplicationsGlobalInstance) {
        try {
            const strays = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'mac-applications-wrapper');
            strays.forEach(s => { try { s.destroy(); } catch (_) {} });
            const strayGlasses = Main.layoutManager.uiGroup.get_children().filter(c => c._owner === 'applications' || (c.name === 'liquid-glass-bg-actor' && c._owner === 'applications'));
            strayGlasses.forEach(g => { try { g.destroy(); } catch (_) {} });
        } catch (_) {}
        globalThis._macApplicationsGlobalInstance = new MacApplicationsDialog();
    }
    return globalThis._macApplicationsGlobalInstance;
}

export function toggleApplicationsDialog(options = {}) {
    ensureApplicationsDialog();
    if (globalThis._macApplicationsGlobalInstance._isOpen) {
        globalThis._macApplicationsGlobalInstance.close();
    } else {
        if (typeof globalThis._macCloseAllCenters === 'function') {
            globalThis._macCloseAllCenters('applications');
        } else {
            try { globalThis._tahoeQSClose?.(); } catch (_) {}
            try { globalThis._tahoeNCClose?.(true); } catch (_) {}
            try { globalThis.closeMacSpotlight?.(true); } catch (_) {}
            try { globalThis._macClipboardGlobalInstance?.close?.(true); } catch (_) {}
        }
        if (Main.overview?.visible) {
            Main.overview.hide();
        }
        globalThis._macApplicationsGlobalInstance.open(options);
    }
}

export function closeApplicationsDialog(immediate = true) {
    if (globalThis._macApplicationsGlobalInstance) {
        globalThis._macApplicationsGlobalInstance.close(immediate);
    }
}

export function destroyApplicationsDialog() {
    if (globalThis._macApplicationsGlobalInstance) {
        try { globalThis._macApplicationsGlobalInstance.destroy(); } catch (_) {}
        globalThis._macApplicationsGlobalInstance = null;
    }
}

globalThis.toggleMacApplications = toggleApplicationsDialog;
globalThis.closeMacApplications = closeApplicationsDialog;
globalThis.destroyMacApplications = destroyApplicationsDialog;
