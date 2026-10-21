import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Liquid-glass helpers live in another extension. Static
// `import ... from 'file://' + ...` is a SyntaxError (module specifiers must
// be string literals), so load them dynamically at runtime.
let LiquidEffect = null;
let UnpickableActor = null;
let UILayerSampler = null;
let WindowCloneManager = null;
let ensureGlassAllocated = () => {};
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
const _LG_BASE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist';
import(_LG_BASE + '/liquidEffect.js').then(m => {
    if (m.LiquidEffect)
        LiquidEffect = m.LiquidEffect;
}).catch(e => console.warn(`[tahoe-apps] liquidEffect unavailable: ${e}`));
import(_LG_BASE + '/utils.js').then(m => {
    if (m.UnpickableActor)
        UnpickableActor = m.UnpickableActor;
    if (m.UILayerSampler)
        UILayerSampler = m.UILayerSampler;
    if (m.WindowCloneManager)
        WindowCloneManager = m.WindowCloneManager;
    if (m.ensureGlassAllocated)
        ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
}).catch(e => console.warn(`[tahoe-apps] liquid-glass utils unavailable: ${e}`));

// Only Clutter.ColorizeEffect exists in this build (Desaturate and
// BrightnessContrast throw at construction). Single effect, tint passed
// via constructor.
function _newTintChain(r, g, b) {
    try {
        const effect = new Clutter.ColorizeEffect({
            tint: {red: r, green: g, blue: b, alpha: 255},
        });
        effect._isIconTint = true;
        return [effect];
    } catch (e) {
        return null;
    }
}

// macOS Tahoe-style "Applications" (Launchpad) window that replaces
// GNOME's app grid. Grabs the shell's toggle-application-view binding
// and intercepts overview.showApps()/selectApp() so every activation
// path (Super+A, dock button, D-Bus) lands on this window.

const KEYBINDING = 'toggle-application-view';

const CATEGORIES = [
    {title: 'Social', match: ['Network']},
    {title: 'Creativity', match: ['Graphics', 'AudioVideo', 'Audio', 'Video']},
    {title: 'Productivity & Finance', match: ['Office']},
    {title: 'Utilities', match: ['Utility', 'System', 'Settings', 'Development', 'Science']},
    {title: 'Other', match: null},
];

const ITEM_W = 88;       // nominal item width used for column math
const ROW_GAP = 8;       // vertical: keep in sync with .tahoe-section spacing
const COL_GAP = 1;       // horizontal: keep in sync with .tahoe-row spacing
const CONTENT_PAD = 22;   // keep in sync with .tahoe-content horizontal padding
const SCROLLBAR_GAP = 0;  // full width: the grid is clipped to the window

// Uniform visual icon size, whitespace ignored (reference: the clock icon,
// whose content fills its frame edge to edge). Resolves the app GIcon to a
// pixbuf, trims transparent padding, scales the CONTENT (not the canvas) so
// its longest side equals iconSize, and centers it. Anything unresolvable
// returns null and the caller falls back to the stock texture path.
const _normCache = new Map();
const NORM_LOAD_PX = 192;

function _normPixbufForGicon(gicon) {
    try {
        if (gicon instanceof Gio.FileIcon) {
            const path = gicon.get_file()?.get_path?.();
            if (!path)
                return null;
            return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, NORM_LOAD_PX, NORM_LOAD_PX, true);
        }
        if (gicon instanceof Gio.ThemedIcon) {
            const names = gicon.get_names?.() ?? [];
            let display = null;
            try {
                display = Gdk.Display.get_default();
            } catch (_) {
                display = null;
            }
            if (!display)
                return null;
            const theme = Gtk.IconTheme.get_for_display(display);
            for (const name of names) {
                if (typeof name !== 'string' || name.endsWith('-symbolic'))
                    continue;
                try {
                    const paintable = theme.lookup_icon(name, null, NORM_LOAD_PX, 1,
                        Gtk.TextDirection.NONE, Gtk.IconLookupFlags.FORCE_SIZE);
                    const file = paintable?.get_file?.();
                    const path = file?.get_path?.();
                    if (path)
                        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, NORM_LOAD_PX, NORM_LOAD_PX, true);
                } catch (_) {
                    // next name
                }
            }
            return null;
        }
    } catch (_) {
        // unresolvable
    }
    return null;
}

function _normalizedAppIcon(gicon, iconSize) {
    try {
        if (!gicon || !(iconSize > 0))
            return null;
        const key = `${gicon.to_string()}@${iconSize}`;
        let bytesIcon = _normCache.get(key) ?? null;
        if (!bytesIcon) {
            if (_normCache.size > 300)
                _normCache.clear();
            const src = _normPixbufForGicon(gicon);
            if (!src)
                return null;
            const w = src.get_width(), h = src.get_height();
            const px = src.get_pixels();
            const rs = src.get_rowstride(), nch = src.get_n_channels();
            if (!px || w <= 0 || h <= 0)
                return null;
            let x0 = w, y0 = h, x1 = -1, y1 = -1;
            const step = 2;
            for (let yy = 0; yy < h; yy += step) {
                for (let xx = 0; xx < w; xx += step) {
                    const o = yy * rs + xx * nch;
                    const a = nch >= 4 ? px[o + 3] : 255;
                    if (a > 16) {
                        if (xx < x0) x0 = xx;
                        if (xx > x1) x1 = xx;
                        if (yy < y0) y0 = yy;
                        if (yy > y1) y1 = yy;
                    }
                }
            }
            if (x1 < x0 || y1 < y0)
                return null;
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            const scale = iconSize / Math.max(bw, bh);
            const dw = Math.max(1, Math.round(bw * scale));
            const dh = Math.max(1, Math.round(bh * scale));
            const crop = GdkPixbuf.Pixbuf.new_subpixbuf(src, x0, y0, bw, bh);
            const scaled = crop.scale_simple(dw, dh, GdkPixbuf.InterpType.BILINEAR);
            const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, iconSize, iconSize);
            canvas.fill(0x00000000);
            scaled.copy_area(0, 0, dw, dh, canvas,
                Math.round((iconSize - dw) / 2), Math.round((iconSize - dh) / 2));
            const [ok, bytes] = canvas.save_to_bufferv('png', [], []);
            if (!ok || !bytes)
                return null;
            bytesIcon = Gio.BytesIcon.new(GLib.Bytes.new(bytes));
            _normCache.set(key, bytesIcon);
        }
        return new St.Icon({gicon: bytesIcon, icon_size: iconSize});
    } catch (_) {
        return null;
    }
}

const LG_SCHEMA_ID = 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com';
const LG_UUID = 'liquid-glass@thinkingcoding1231.gmail.com';

function _loadLiquidGlassSettings() {
    try {
        return new Gio.Settings({schema_id: LG_SCHEMA_ID});
    } catch (_) {
        // Not in the default GSettings source (extension schemas live in
        // the extension's own schemas/ dir). Fall through to manual load.
    }
    try {
        const dir = GLib.build_filenamev([GLib.get_home_dir(),
            '.local', 'share', 'gnome-shell', 'extensions', LG_UUID, 'schemas']);
        const source = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source?.lookup(LG_SCHEMA_ID, false);
        if (schema)
            return new Gio.Settings({settings_schema: schema});
    } catch (_) {
        // liquid-glass not installed
    }
    return null;
}

class TahoeApps {
    enable(settings) {
        this._overlay = null;
        this._window = null;
        this._grab = null;
        this._menu = null;
        this._entry = null;
        this._scroll = null;
        this._content = null;
        this._empty = null;
        this._pills = [];
        this._pillsBox = null;
        this._sections = [];
        this._rows = [];
        this._items = [];
        this._vadjConn = null;
        this._pendingOpen = false;
        this._hiddenId = 0;
        this._safetyId = 0;
        this._showSystem = false;
        this._groupByCategory = true;
        this._recents = [];
        this._glassSettings = _loadLiquidGlassSettings();
        this._settings = settings;
        this._frameLaterId = 0;
        this._laters = null;
        this._glassState = null;
        this._bgActor = null;
        this._cloneContainerRef = null;

        // Redirect showApps / selectApp to our own window.
        this._origShowAppsOwn = Object.hasOwn(Main.overview, 'showApps');
        this._origShowApps = Main.overview.showApps;
        Main.overview.showApps = () => this._toggle();

        this._origSelectAppOwn = Object.hasOwn(Main.overview, 'selectApp');
        this._origSelectApp = Main.overview.selectApp;
        Main.overview.selectApp = () => this._toggle();

        // Grab the Launchpad keybinding with our own handler.
        this._keySettings = new Gio.Settings({
            schema_id: 'org.gnome.shell.keybindings',
        });
        this._keyFlags = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
        this._keyModes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        try {
            Main.wm.removeKeybinding(KEYBINDING);
            Main.wm.addKeybinding(KEYBINDING, this._keySettings, this._keyFlags,
                this._keyModes, () => this._toggle());
        } catch (e) {
            console.error(`[tahoe-apps] failed to grab ${KEYBINDING}: ${e}`);
        }

        this._showingId = Main.overview.connect('showing', () => {
            this._cancelPendingOpen();
            if (this._overlay)
                this._close();
        });

        // Live-apply appearance settings: reopen the window with the new
        // values while it is shown.
        this._settingsChangedId = settings.connect('changed', () => {
            if (!this._overlay)
                return;
            this._close();
            this._build();
        });
    }

    disable() {
        this._cancelPendingOpen();
        this._close();

        if (this._showingId) {
            Main.overview.disconnect(this._showingId);
            this._showingId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._origShowAppsOwn)
            Main.overview.showApps = this._origShowApps;
        else
            delete Main.overview.showApps;

        if (this._origSelectAppOwn)
            Main.overview.selectApp = this._origSelectApp;
        else
            delete Main.overview.selectApp;

        try {
            Main.wm.removeKeybinding(KEYBINDING);
            const controls = this._findControls();
            const handler = controls &&
                typeof controls._toggleAppsPage === 'function'
                ? controls._toggleAppsPage.bind(controls)
                : () => Main.overview.showApps();
            Main.wm.addKeybinding(KEYBINDING, this._keySettings,
                this._keyFlags, this._keyModes, handler);
        } catch (e) {
            console.error(`[tahoe-apps] failed to restore ${KEYBINDING}: ${e}`);
        }

        this._keySettings = null;
        this._records = null;
    }

    _findControls() {
        const overview = Main.overview;
        return overview._overview?._controls ??
            overview.controls ??
            overview._overview?.controls ??
            overview._controls ??
            null;
    }

    // ---------------------------------------------------------------- toggling

    _toggle() {
        if (this._overlay) {
            this._close();
            return;
        }
        if (Main.overview.visible) {
            this._openAfterOverview();
            return;
        }
        this._build();
    }

    _openAfterOverview() {
        if (this._pendingOpen)
            return;
        this._pendingOpen = true;

        this._hiddenId = Main.overview.connect('hidden',
            () => this._finishPendingOpen());
        this._safetyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            this._safetyId = 0;
            this._finishPendingOpen();
            return GLib.SOURCE_REMOVE;
        });

        Main.overview.hide();
    }

    _finishPendingOpen() {
        if (!this._pendingOpen)
            return;
        this._pendingOpen = false;
        if (this._hiddenId) {
            Main.overview.disconnect(this._hiddenId);
            this._hiddenId = 0;
        }
        if (this._safetyId) {
            GLib.source_remove(this._safetyId);
            this._safetyId = 0;
        }
        if (!this._overlay)
            this._build();
    }

    _cancelPendingOpen() {
        if (!this._pendingOpen)
            return;
        this._pendingOpen = false;
        if (this._hiddenId) {
            Main.overview.disconnect(this._hiddenId);
            this._hiddenId = 0;
        }
        if (this._safetyId) {
            GLib.source_remove(this._safetyId);
            this._safetyId = 0;
        }
    }

    // ---------------------------------------------------------------- building

    _monitorAtPointer() {
        try {
            const [px, py] = global.get_pointer();
            const monitor = Main.layoutManager.monitors.find(m =>
                px >= m.x && px < m.x + m.width &&
                py >= m.y && py < m.y + m.height);
            if (monitor)
                return monitor;
        } catch (e) {
            // fall through to the primary monitor
        }
        return Main.layoutManager.primaryMonitor;
    }

    // Idle step 1: glass actors + effect (shader compile), inserted
    // below the already-visible overlay.
    _setupGlassStep1() {
        const p = this._pendingGlass;
        if (!p || !this._overlay)
            return;
        const {monitor, winW, winH, tahoeRadius} = p;
        const PAD = 20;
        const CLIP_PAD = 200;
        const bgActor = new UnpickableActor();
        bgActor.set_name('liquid-glass-bg-actor');
        bgActor.set_position(monitor.x, monitor.y);
        bgActor.set_size(monitor.width, monitor.height);
        this._bgActor = bgActor;

        const liquidBox = new UnpickableActor();
        liquidBox.set_name('liquid-box');
        liquidBox.set_clip_to_allocation(true);
        liquidBox.set_position(0, 0);
        liquidBox.set_size(monitor.width, monitor.height);
        bgActor.add_child(liquidBox);
        this._liquidBox = liquidBox;

        // dummyBreaker: prevents the BMS black-screen optimization bug.
        const dummyBreaker = new UnpickableActor();
        dummyBreaker.set_name('optimization-breaker');
        dummyBreaker.set_size(1.0, 1.0);
        dummyBreaker.set_opacity(0);
        liquidBox.add_child(dummyBreaker);

        const mirror = new Clutter.Clone({
            source: Main.layoutManager._backgroundGroup,
        });
        mirror.set_size(global.stage.width, global.stage.height);
        mirror.set_position(-monitor.x, -monitor.y);
        liquidBox.add_child(mirror);

        const cloneContainer = new UnpickableActor();
        cloneContainer.set_name('clone-container');
        liquidBox.add_child(cloneContainer);
        this._cloneContainerRef = cloneContainer;

        // Glass rect = window rect grown by PAD, in monitor-local coords.
        const gX = p.winX + p.overlayX - monitor.x - PAD;
        const gY = p.winY + p.overlayY - monitor.y - PAD;
        this._glassState = null;
        try {
            const extensionPath = GLib.get_home_dir() +
                '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com';
            const effect = new LiquidEffect({
                extensionPath,
                settings: this._glassSettings,
                owner: 'tahoe-apps',
            });
            effect.setPadding(PAD);
            effect.setCornerRadius(tahoeRadius);
            effect.setIsDock(false);
            effect.setResolution(monitor.width, monitor.height);
            effect.setGlassGeometry(gX, gY, winW + PAD * 2, winH + PAD * 2);
            setClipIfChanged(bgActor, gX - CLIP_PAD, gY - CLIP_PAD,
                winW + PAD * 2 + CLIP_PAD * 2,
                winH + PAD * 2 + CLIP_PAD * 2);
            effect.setShadowMaxRadius(CLIP_PAD - 20);
            // A visible soft shadow under the window: stronger and wider
            // than the liquid-glass defaults (local override — the global
            // shadow settings keep driving the dock and notifications).
            effect._setFloat('shadow_radius', 56.0);
            effect._setFloat('shadow_intensity', 0.2);
            effect.setBlurRadius(this._settings.get_int('tahoe-glass-blur'));
            if (this._tahoeDark)
                effect.setTintColor(0.08, 0.08, 0.09);
            else
                effect.setTintColor(1, 1, 1);
            effect.setTintStrength(
                this._settings.get_int('tahoe-glass-tint') / 100);
            effect.setBrightness(
                this._settings.get_int('tahoe-glass-brightness') / 100);
            effect.setContrast(1.0);
            effect.setSaturation(1.1);
            liquidBox.add_effect(effect);

            p.effect = effect;
            p.liquidBox = liquidBox;
            p.cloneContainer = cloneContainer;
            Main.layoutManager.uiGroup.insert_child_below(bgActor, this._overlay);
        } catch (e) {
            console.error(`[tahoe-apps] liquid glass effect failed: ${e}`);
            this._pendingGlass = null;
            return;
        }
        this._glassIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._glassIdleId = 0;
            this._setupGlassStep2();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Idle step 2: clone rebuild + sampler (the slowest part) + sync tick.
    _setupGlassStep2() {
        const p = this._pendingGlass;
        this._pendingGlass = null;
        if (!p || !this._overlay)
            return;
        try {
            const windowCloneManager =
                new WindowCloneManager(p.liquidBox, p.cloneContainer, 'lg-tahoe');
            const uiSampler = new UILayerSampler(this._bgActor, p.liquidBox,
                [this._overlay, global.windowGroup, global.window_group],
                p.cloneContainer, 'tahoe');
            windowCloneManager.rebuildClones();
            uiSampler.rebindSelf();
            uiSampler.refresh();

            this._glassState = {
                effect: p.effect,
                windowCloneManager,
                uiSampler,
                monitor: p.monitor,
            };
        } catch (e) {
            console.error(`[tahoe-apps] liquid glass clones failed: ${e}`);
            return;
        }

        // Per-frame clone sync (dock/OSD manager pattern): keeps the
        // offscreen capture of everything behind the window up to date so
        // the shader refracts live content.
        if (this._glassState) {
            this._laters = global.compositor.get_laters();
            const tick = () => {
                this._frameLaterId = 0;
                if (!this._overlay || !this._glassState)
                    return GLib.SOURCE_REMOVE;
                try {
                    const st = this._glassState;
                    ensureGlassAllocated(st.bgActor ?? this._bgActor);
                    st.windowCloneManager.setOffset(
                        -st.monitor.x, -st.monitor.y);
                    st.uiSampler.refresh();
                    syncGlassCaptureClip({
                        cloneContainer: this._cloneContainerRef,
                        effect: st.effect,
                        originX: st.monitor.x,
                        originY: st.monitor.y,
                        uiSampler: st.uiSampler,
                        windowCloneManager: st.windowCloneManager,
                    });
                    st.uiSampler.sync(st.monitor.x, st.monitor.y,
                        st.monitor.width, st.monitor.height);
                    st.windowCloneManager.sync();
                } catch (e) {
                    console.error(`[tahoe-apps] glass sync failed: ${e}`);
                }
                this._frameLaterId =
                    this._laters.add(Meta.LaterType.BEFORE_REDRAW, tick);
                return GLib.SOURCE_REMOVE;
            };
            this._frameLaterId =
                this._laters.add(Meta.LaterType.BEFORE_REDRAW, tick);
        }
    }

    _build() {
        if (this._overlay)
            return;

        const monitor = this._monitorAtPointer();
        const panelH = Main.layoutManager.panelBox.height;

        const overlay = new St.Widget({
            style_class: 'tahoe-overlay',
            reactive: true,
            x: 0,
            y: panelH,
            width: global.stage.width,
            height: global.stage.height - panelH,
        });
        overlay.connect('button-press-event', () => {
            if (this._menu)
                this._closeMenu();
            else
                this._close();
            return Clutter.EVENT_STOP;
        });
        overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._menu)
                    this._closeMenu();
                else
                    this._close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const S = Math.max(0.5, Math.min(1.5,
            this._settings.get_int('tahoe-scale') / 100));
        this._scale = S;

        const winW = Math.round(monitor.width *
            this._settings.get_int('tahoe-window-width') / 100 * S);
        const winH = Math.round(monitor.height *
            this._settings.get_int('tahoe-window-height') / 100 * S);

        const win = new St.BoxLayout({
            style_class: 'tahoe-window',
            vertical: true,
            reactive: true,
        });
        win.set_size(winW, winH);
        win.x = monitor.x + Math.round((monitor.width - winW) / 2);
        win.y = monitor.y + Math.round((monitor.height - winH) / 2) - panelH;
        const tahoeRadius = Math.round(
            this._settings.get_int('tahoe-glass-radius') * S);
        win.style = `font-family: "${this._settings.get_string('tahoe-font')}";` +
            ` font-size: ${Math.round(this._settings.get_int('tahoe-font-size') * S)}px;` +
            ' font-weight: normal;' +
            ` border-radius: ${tahoeRadius}px;` +
            ' border-top: 2px solid rgba(200, 200, 200, 0.50);' +
            ' border-bottom: 2px solid rgba(200, 200, 200, 0.50);' +
            ' border-left: none; border-right: none;';
        win.connect('button-press-event', () => {
            if (this._menu)
                this._closeMenu();
            return Clutter.EVENT_STOP;
        });

        // Theme: explicit override, else system scheme + GTK theme name.
        let dark = false;
        const themeMode = this._settings.get_string('tahoe-theme');
        if (themeMode === 'dark') {
            dark = true;
        } else if (themeMode !== 'light') {
            try {
                const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
                const scheme = iface.get_string('color-scheme');
                const gtkTheme = iface.get_string('gtk-theme') || '';
                const themeIsLight = (/light/i.test(gtkTheme) && !/dark/i.test(gtkTheme)) ||
                    gtkTheme === 'Adwaita' || gtkTheme === 'Default';
                if (scheme === 'prefer-light')
                    dark = false;
                else if (scheme === 'prefer-dark')
                    dark = !themeIsLight;
                else
                    dark = false;
            } catch (e) {
                // light theme fallback
            }
        }
        if (dark)
            overlay.add_style_class_name('tahoe-dark');
        this._tahoeDark = dark;

        // Liquid glass (LiquidEffect from the liquid-glass extension) with the
        // dock/OSD architecture: bgActor + liquidBox cover the whole monitor,
        // the shader is told where the window lives via setGlassGeometry().
        // WindowCloneManager + UILayerSampler deposit clones of everything
        // behind the window (windows, dock, panel) into the effect's offscreen
        // capture — that content is what the refraction distorts, exactly like
        // in the dock.
        // Glass is heavy (shader compile + clone rebuild blocks the main
        // thread ~1s, freezing dock/panel glass). Paint + animate first,
        // build glass in two idle steps.
        this._pendingGlass = {
            monitor, winW, winH, tahoeRadius,
            winX: win.x, winY: win.y,
            overlayX: overlay.x, overlayY: overlay.y,
        };

        // Header: icon + search entry + "…" button.
        const header = new St.BoxLayout({
            style_class: 'tahoe-header',
            x_expand: true,
        });
        header.set_style(
            `spacing: ${12 * S}px; padding: ${4 * S}px ${20 * S}px ` +
            `${2 * S}px ${20 * S}px;`);
        header.add_child(this._makeHeaderIcon());

        const entry = new St.Entry({
            style_class: 'tahoe-search',
            hint_text: 'Приложения',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const clutterText = entry.clutter_text;
        clutterText.connect('text-changed', () => this._applyFilter());
        clutterText.connect('activate', () => this._launchFirstVisible());
        entry.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._menu)
                    this._closeMenu();
                else
                    this._close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        header.add_child(entry);

        const moreBtn = new St.Button({
            style_class: 'tahoe-more',
            label: '…',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        moreBtn.connect('clicked', () => this._toggleMenu(moreBtn));
        header.add_child(moreBtn);
        win.add_child(header);

        // Thin black divider between search and categories.
        win.add_child(this._makeDivider());

        // Category pills (jump links).
        const pillsBox = new St.BoxLayout({
            style_class: 'tahoe-pills',
            x_expand: true,
        });
        pillsBox.set_style(
            `spacing: ${8 * S}px; padding: ${6 * S}px ${20 * S}px ` +
            `${10 * S}px ${20 * S}px;`);
        this._pills = [];
        for (const cat of CATEGORIES) {
            const pill = new St.Button({
                style_class: 'tahoe-pill',
                label: cat.title,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            const pillLabel = pill.get_child();
            if (pillLabel instanceof St.Label) {
                pillLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                pillLabel.clutter_text
                    .set_line_alignment(Pango.Alignment.CENTER);
            }
            pill.connect('button-press-event', () => {
                this._jumpToCategory(cat.title);
                return Clutter.EVENT_STOP;
            });
            pillsBox.add_child(pill);
            this._pills.push({btn: pill, title: cat.title});
        }
        win.add_child(pillsBox);

        // Thin black divider between categories and applications.
        win.add_child(this._makeDivider());

        // Scrollable grid.
        const content = new St.BoxLayout({
            style_class: 'tahoe-content',
            vertical: true,
            x_expand: true,
        });
        const pad22 = Math.round(CONTENT_PAD * S);
        const rowGap = Math.round(ROW_GAP * S);
        content.set_style(
            `spacing: ${4 * S}px; padding: ${4 * S}px ${pad22}px 0 ${pad22}px;`);
        const scroll = new St.ScrollView({
            style_class: 'tahoe-scroll',
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            // AUTOMATIC: St itself drives the wheel, including touchpad
            // smooth scrolling — the bar below is fully hidden by CSS.
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_mouse_scrolling: true,
            child: content,
        });
        win.add_child(scroll);

        this._overlay = overlay;
        this._window = win;
        this._entry = entry;
        this._scroll = scroll;
        this._content = content;
        this._pillsBox = pillsBox;
        this._moreBtn = moreBtn;

        this._empty = new St.Label({
            style_class: 'tahoe-empty',
            text: 'No applications found',
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        content.add_child(this._empty);

        this._collect();
        this._loadRecents();
        this._rebuildGrid();
        const firstCat = this._sections.find(s => s.title !== 'Recommended');
        if (firstCat)
            this._setActivePill(firstCat.title);

        this._vadjConn = {
            adj: scroll.vadjustment,
            id: scroll.vadjustment.connect('notify::value',
                () => this._updateActivePill()),
        };

        overlay.add_child(win);

        // Appearance animation: fade + slight scale-up.
        win.set_pivot_point(0.5, 0.5);
        win.opacity = 0;
        win.scale_x = 0.96;
        win.scale_y = 0.96;
        overlay.opacity = 0;
        Main.layoutManager.uiGroup.add_child(overlay);

        this._grab = Main.pushModal(overlay,
            {actionMode: Shell.ActionMode.NORMAL});
        if (!this._grab)
            console.error('[tahoe-apps] pushModal returned no grab');
        entry.grab_key_focus();

        overlay.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        win.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });

        // Glass builds in idle steps so the window paints + animates first.
        this._glassIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._glassIdleId = 0;
            this._setupGlassStep1();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------------------------------------------------------------- app data

    // Accepts '#rrggbb[aa]' and 'rgb()/rgba()' (what Gtk.ColorButton writes).
    // Returns a plain {red, green, blue, alpha} struct for Clutter effects.
    // Builds a real Cogl.Color: plain JS objects do not reliably marshal
    // into the effect's tint struct (silent white = invisible tint).
    _makeTintColor(spec) {
        const c = this._parseAccentColor(spec);
        if (!c)
            return null;
        try {
            const color = new Cogl.Color();
            color.init_from_4ub(c.red, c.green, c.blue, c.alpha);
            return color;
        } catch (e) {
            return c;
        }
    }

    _parseAccentColor(spec) {
        if (typeof spec !== 'string')
            return null;
        const s = spec.trim();
        let m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
        if (m) {
            return {
                red: parseInt(m[1].slice(0, 2), 16),
                green: parseInt(m[1].slice(2, 4), 16),
                blue: parseInt(m[1].slice(4, 6), 16),
                alpha: m[2] ? parseInt(m[2], 16) : 255,
            };
        }
        m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
        if (m) {
            let a = 255;
            if (m[4] !== undefined) {
                const f = parseFloat(m[4]);
                a = f <= 1 ? Math.round(f * 255) : Math.round(f);
            }
            return {
                red: Math.min(255, parseInt(m[1], 10)),
                green: Math.min(255, parseInt(m[2], 10)),
                blue: Math.min(255, parseInt(m[3], 10)),
                alpha: Math.max(0, Math.min(255, a)),
            };
        }
        return null;
    }

    // Icon styles removed - plain stock icons only. Kept as a no-op
    // so existing call sites don't need touching.
    _applyIconTint(icon) {
        return;
    }

    _collect() {
        const system = Shell.AppSystem.get_default();
        const records = [];

        for (const item of system.get_installed()) {
            try {
                const info = typeof item.get_app_info === 'function'
                    ? item.get_app_info()
                    : item;
                if (!info)
                    continue;

                const id = info.get_id?.();
                if (!id)
                    continue;

                // Tahoe: Finder and the Launchpad stub are not apps.
                if (id === 'org.gnome.Nautilus.desktop' ||
                    id === 'org.gnome.Shell.Extensions.Kiwi.Launchpad.desktop')
                    continue;

                if (!this._showSystem && typeof info.should_show === 'function' &&
                    !info.should_show())
                    continue;

                const name = info.get_display_name?.() ||
                    info.get_name?.() || id;
                const cats = (info.get_categories?.() || '')
                    .split(';')
                    .filter(c => c.length > 0);

                const app = typeof item.create_icon_texture === 'function'
                    ? item
                    : system.lookup_app(id);

                records.push({
                    id,
                    name,
                    lower: name.toLowerCase(),
                    cats,
                    info,
                    app,
                    category: this._categoryOf(cats),
                });
            } catch (e) {
                // Skip entries with invalid metadata (e.g. bad encodings).
            }
        }

        records.sort((a, b) => a.name.localeCompare(b.name));
        this._records = records;
    }

    _categoryOf(cats) {
        for (const cat of CATEGORIES) {
            if (!cat.match)
                continue;
            if (cat.match.some(c => cats.includes(c)))
                return cat.title;
        }
        return 'Other';
    }

    // ------------------------------------------------------------------- grid

    _rebuildGrid() {
        if (!this._content)
            return;

        for (const section of this._sections) {
            section.actor.destroy();
            section.divider?.destroy();
        }
        this._sections = [];
        this._rows = [];
        this._items = [];

        const winW = this._window.width;
        const S = this._scale ?? 1;
        const itemWNom = Math.round(ITEM_W * S);
        const gap = Math.round(COL_GAP * S);
        const avail = winW - Math.round(CONTENT_PAD * S) * 2 - SCROLLBAR_GAP;
        const cols = Math.min(7, Math.max(1,
            Math.floor((avail + gap) / (itemWNom + gap))));
        const itemW = Math.floor((avail - gap * (cols - 1)) / cols);

        let groups;
        if (this._groupByCategory) {
            groups = CATEGORIES.map(cat => ({
                title: cat.title,
                records: this._records.filter(r => r.category === cat.title),
            })).filter(g => g.records.length > 0);
            this._pillsBox.visible = true;
        } else {
            groups = [{title: null, records: this._records}];
            this._pillsBox.visible = false;
        }

        // Recommended: the most recently launched apps, one row, on top —
        // pills stay category-only, so this section never takes a pill.
        if (this._groupByCategory && this._recents.length) {
            const seen = new Set();
            const recentRecords = [];
            for (const id of this._recents) {
                const rec = this._records.find(r => r.id === id);
                if (rec && !seen.has(rec)) {
                    seen.add(rec);
                    recentRecords.push(rec);
                }
                if (recentRecords.length >= cols)
                    break;
            }
            if (recentRecords.length)
                groups.unshift({title: 'Recommended', records: recentRecords});
        }

        for (const group of groups) {
            const section = new St.BoxLayout({
                style_class: 'tahoe-section',
                vertical: true,
                x_expand: true,
            });
            const secRec = {title: group.title, actor: section, rows: []};

            if (group.title && group.title !== 'Recommended') {
                section.add_child(new St.Label({
                    style_class: 'tahoe-section-title',
                    text: group.title,
                }));
            }

            for (let i = 0; i < group.records.length; i += cols) {
                const chunk = group.records.slice(i, i + cols);
                const row = new St.BoxLayout({
                    style_class: 'tahoe-row',
                    x_expand: true,
                });
                row.set_style(`spacing: ${gap}px;`);
                const rowRec = {actor: row, items: []};

                for (const record of chunk) {
                    const button = this._makeItem(record, itemW);
                    row.add_child(button);
                    const itemRec = {
                        actor: button,
                        record,
                        lower: record.lower,
                        row: rowRec,
                        section: secRec,
                    };
                    rowRec.items.push(itemRec);
                    this._items.push(itemRec);
                }

                section.add_child(row);
                secRec.rows.push(rowRec);
                this._rows.push(rowRec);
            }

            this._content.add_child(section);
            // Divider between Recommended and the category list below it.
            if (group.title === 'Recommended') {
                secRec.divider = this._makeDivider();
                this._content.add_child(secRec.divider);
            }
            this._sections.push(secRec);
        }

        this._applyFilter();
    }

    _makeItem(record, itemW) {
        const button = new St.Button({
            style_class: 'tahoe-app',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        button.width = itemW;

        const box = new St.BoxLayout({
            style_class: 'tahoe-app-box',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const iconSize = Math.round(
            this._settings.get_int('tahoe-app-icon-size') * (this._scale ?? 1));
        // uniform visual size, whitespace ignored (see _normalizedAppIcon);
        // anything unresolvable falls back to the stock texture path.
        let icon = null;
        try {
            const gicon = record.info?.get_icon?.();
            if (gicon)
                icon = _normalizedAppIcon(gicon, iconSize);
        } catch (_) {
            icon = null;
        }
        if (!icon && record.app) {
            try {
                icon = record.app.create_icon_texture(iconSize);
            } catch (e) {
                icon = null;
            }
        }
        if (!icon) {
            icon = new St.Icon({icon_size: iconSize});
            const gicon = record.info.get_icon?.();
            if (gicon)
                icon.gicon = gicon;
            else
                icon.icon_name = 'application-x-executable-symbolic';
        }
        icon.x_align = Clutter.ActorAlign.CENTER;
        this._applyIconTint(icon);
        box.add_child(icon);

        const label = new St.Label({
            style_class: 'tahoe-app-label',
            text: record.name,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        box.add_child(label);

        button.child = box;
        let fired = false;
        const fire = () => {
            if (fired)
                return;
            fired = true;
            this._launch(record);
        };
        // Launch on press: St.Button 'clicked' never fires under the modal
        // grab, so the press path is the primary trigger; 'clicked' stays as
        // the keyboard (Enter) fallback.
        button.connect('button-press-event', () => {
            fire();
            return Clutter.EVENT_STOP;
        });
        button.connect('clicked', fire);
        return button;
    }

    // ------------------------------------------------------------- header icon

    // App Store logo recoloured to the current text colour (dark text on the
    // light theme, light text on the dark one) — SVG fills are rewritten to
    // the target colour and cached, then loaded as a FileIcon.
    _makeHeaderIcon() {
        const S = this._scale ?? 1;
        const icon = new St.Icon({
            icon_size: Math.round(this._settings.get_int('tahoe-header-icon-size') *
                S * 0.875),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'tahoe-header-icon',
        });
        // Поднять иконку на уровень текста Applications.
        icon.translation_y = 0;
        try {
            // Match the hint text exactly: same colour at 0.7 opacity.
            const color = this._tahoeDark ? '#f5f5f7' : '#3c3c43';
            const src = Gio.File.new_for_path('/home/micronix/app-store-logo.svg');
            const [, bytes] = src.load_contents(null);
            let svg = new TextDecoder().decode(bytes);
            svg = svg.replace(/#000000/gi, color).replace(/#000([^0-9a-fA-F]|$)/gi,
                color + '$1');
            svg = svg.replace('<svg', '<svg opacity="0.7"');
            const cacheDir = GLib.build_filenamev([GLib.get_home_dir(), '.cache']);
            GLib.mkdir_with_parents(cacheDir, 0o755);
            const dst = Gio.File.new_for_path(
                GLib.build_filenamev([cacheDir, this._tahoeDark ?
                    'tahoe-app-store-icon-dark.svg' :
                    'tahoe-app-store-icon-light.svg']));
            dst.replace_contents(new TextEncoder().encode(svg), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            icon.gicon = new Gio.FileIcon({file: dst});
        } catch (e) {
            icon.icon_name = 'view-app-grid-symbolic';
        }
        return icon;
    }

    // Thin black 1px divider between the window's stacked areas.
    _makeDivider() {
        return new St.Widget({
            style_class: 'tahoe-divider',
            x_expand: true,
        });
    }

    // ----------------------------------------------------------------- filter

    _applyFilter() {
        if (!this._entry)
            return;

        const query = this._entry.clutter_text.get_text().trim().toLowerCase();
        let anyVisible = false;

        for (const item of this._items) {
            const show = query.length === 0 || item.lower.includes(query);
            item.actor.visible = show;
            if (show)
                anyVisible = true;
        }

        for (const row of this._rows)
            row.actor.visible = row.items.some(i => i.actor.visible);

        for (const section of this._sections) {
            section.actor.visible = section.rows.some(r => r.actor.visible);
            if (section.divider)
                section.divider.visible = section.actor.visible;
        }

        if (this._empty)
            this._empty.visible = !anyVisible;

        this._updateActivePill();
    }

    // ------------------------------------------------------------------ pills

    _setActivePill(title) {
        for (const pill of this._pills) {
            if (pill.title !== null && pill.title === title)
                pill.btn.add_style_class_name('tahoe-pill-active');
            else
                pill.btn.remove_style_class_name('tahoe-pill-active');
        }
    }

    _updateActivePill() {
        if (!this._overlay || !this._content || !this._content.is_mapped())
            return;
        if (!this._sections.length)
            return;

        const [, contentY] = this._content.get_transformed_position();
        const value = this._scroll.vadjustment.value;

        let active = -1;
        let first = -1;
        this._sections.forEach((section, index) => {
            if (!section.actor.visible)
                return;
            if (section.title === 'Recommended')
                return;
            if (first === -1)
                first = index;
            const [, sectionY] = section.actor.get_transformed_position();
            if (sectionY - contentY <= value + 30)
                active = index;
        });

        if (active === -1)
            active = first;
        if (active === -1)
            return;

        this._setActivePill(this._sections[active].title);
    }

    _jumpToCategory(title) {
        const section = this._sections.find(s => s.title === title);

        if (!section) {
            if (this._entry.clutter_text.get_text() !== '')
                this._entry.clutter_text.set_text('');
            return;
        }

        const needsClear = !section.actor.visible &&
            this._entry.clutter_text.get_text() !== '';

        if (needsClear) {
            this._entry.clutter_text.set_text('');
            // Positions are stale until the next allocation; defer the jump.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                this._scrollToSection(section);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._scrollToSection(section);
        }
    }

    _scrollToSection(section) {
        if (!this._scroll || !this._content)
            return;

        const [, contentY] = this._content.get_transformed_position();
        const [, sectionY] = section.actor.get_transformed_position();

        const adj = this._scroll.vadjustment;
        const max = Math.max(adj.lower, adj.upper - adj.page_size);
        let target = sectionY - contentY - 8;
        target = Math.min(Math.max(target, adj.lower), max);

        if (typeof adj.ease === 'function') {
            adj.ease(target, {
                duration: 350,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            adj.value = target;
        }

        this._setActivePill(section.title);
    }

    // ------------------------------------------------------------------ menu

    _toggleMenu(anchor) {
        if (this._menu) {
            this._closeMenu();
            return;
        }
        if (!this._overlay)
            return;

        const menu = new St.BoxLayout({
            style_class: 'tahoe-drop',
            vertical: true,
        });
        this._menu = menu;

        const entries = [
            {
                text: 'Group by category',
                get: () => this._groupByCategory,
                toggle: () => {
                    this._groupByCategory = !this._groupByCategory;
                    this._rebuildGrid();
                },
            },
            {
                text: 'Show system apps',
                get: () => this._showSystem,
                toggle: () => {
                    this._showSystem = !this._showSystem;
                    this._collect();
                    this._rebuildGrid();
                },
            },
        ];

        for (const def of entries) {
            const row = new St.Button({
                style_class: 'tahoe-drop-item',
                x_expand: true,
                can_focus: true,
                track_hover: true,
            });
            const box = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(new St.Label({
                text: def.text,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const check = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER,
                visible: def.get(),
            });
            box.add_child(check);
            row.child = box;
            row.connect('clicked', () => {
                def.toggle();
                check.visible = def.get();
                this._closeMenu();
            });
            menu.add_child(row);
        }

        this._overlay.add_child(menu);

        const [ax, ay] = anchor.get_transformed_position();
        const [ox, oy] = this._overlay.get_transformed_position();
        const [, menuW] = menu.get_preferred_width(-1);
        menu.width = Math.max(menuW, 220);
        menu.x = Math.max(ax - ox + anchor.width - menu.width, 8);
        menu.y = ay - oy + anchor.height + 6;
    }

    _closeMenu() {
        if (!this._menu)
            return;
        const menu = this._menu;
        this._menu = null;
        menu.destroy();
    }

    // ---------------------------------------------------------------- launch

    _launch(record) {
        console.log(`[tahoe-apps] launch ${record.id}`);
        this._recordRecent(record.id);
        try {
            if (record.app)
                record.app.activate();
            else
                record.info.launch([],
                    global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`[tahoe-apps] failed to launch ${record.id}: ${e}`);
        }
        this._close();
    }

    _launchFirstVisible() {
        const first = this._items.find(i => i.actor.visible);
        if (first)
            this._launch(first.record);
    }

    // --------------------------------------------------------------- recents

    _recentPath() {
        return GLib.build_filenamev(
            [GLib.get_home_dir(), '.cache', 'tahoe-recent-apps.json']);
    }

    _loadRecents() {
        try {
            const file = Gio.File.new_for_path(this._recentPath());
            const [, bytes] = file.load_contents(null);
            const ids = JSON.parse(new TextDecoder().decode(bytes));
            this._recents = Array.isArray(ids)
                ? ids.filter(id => typeof id === 'string').slice(0, 12)
                : [];
        } catch (e) {
            this._recents = [];
        }
        // First run (or empty cache): seed from the shell's own usage
        // stats, so Recommended is populated before anything is launched
        // from this window.
        if (!this._recents.length) {
            try {
                const mostUsed = Shell.AppUsage.get_default().get_most_used();
                const ids = (mostUsed ?? []).map(app => {
                    try {
                        return app.get_id();
                    } catch (e) {
                        return null;
                    }
                }).filter(id => typeof id === 'string');
                this._recents = [...new Set(ids)].slice(0, 12);
                if (this._recents.length)
                    this._saveRecents();
            } catch (e) {
                // usage stats unavailable: stays empty until first launch
            }
        }
    }

    _saveRecents() {
        try {
            const file = Gio.File.new_for_path(this._recentPath());
            file.replace_contents(
                new TextEncoder().encode(JSON.stringify(this._recents)),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            // cache write is best-effort
        }
    }

    _recordRecent(id) {
        if (!id)
            return;
        this._recents =
            [id, ...this._recents.filter(r => r !== id)].slice(0, 12);
        this._saveRecents();
    }

    // ----------------------------------------------------------------- close

    _close() {
        if (!this._overlay)
            return;

        this._cancelPendingOpen();
        this._closeMenu();

        // Cancel pending idle glass steps from a lightning open/close.
        if (this._glassIdleId) {
            try {
                GLib.source_remove(this._glassIdleId);
            } catch (e) {
                // already fired
            }
            this._glassIdleId = 0;
        }
        this._pendingGlass = null;

        // Stop the per-frame glass sync and tear the effect down before the
        // actors go away (effect must be cleaned up before bgActor.destroy()).
        if (this._frameLaterId && this._laters) {
            try {
                this._laters.remove(this._frameLaterId);
            } catch (e) {
                // later may already be gone
            }
            this._frameLaterId = 0;
        }
        const glassState = this._glassState;
        this._glassState = null;
        if (glassState) {
            try {
                glassState.effect.cleanup();
            } catch (e) {
                // effect may already be cleaned
            }
            try {
                glassState.uiSampler.destroy();
            } catch (e) {
                // sampler may already be gone
            }
            try {
                glassState.windowCloneManager.destroy();
            } catch (e) {
                // clone manager may already be gone
            }
        }
        if (this._bgActor) {
            try {
                this._bgActor.destroy();
            } catch (e) {
                // actor may already be gone
            }
            this._bgActor = null;
        }
        this._cloneContainerRef = null;

        const overlay = this._overlay;
        this._overlay = null;
        this._window = null;
        this._entry = null;
        this._scroll = null;
        this._content = null;
        this._empty = null;
        this._pills = [];
        this._pillsBox = null;
        this._moreBtn = null;
        this._sections = [];
        this._rows = [];
        this._items = [];

        if (this._vadjConn) {
            try {
                this._vadjConn.adj.disconnect(this._vadjConn.id);
            } catch (e) {
                // adjustment may already be gone with the scroll view
            }
            this._vadjConn = null;
        }

        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                console.error(`[tahoe-apps] popModal failed: ${e}`);
            }
            this._grab = null;
        }

        overlay.destroy();
    }
}

let _instance = null;

export function enable(settings) {
    if (_instance)
        return;
    _instance = new TahoeApps();
    _instance.enable(settings);
}

export function disable() {
    if (!_instance)
        return;
    _instance.disable();
    _instance = null;
}

export function toggle() {
    if (_instance)
        _instance._toggle();
}
