// Tahoe Widgets: draggable, resizable desktop widgets (clock, calendar,
// weather) with real liquid glass (same engine as the Tahoe Control
// Center): one shared refractive stack behind all widgets, regions track
// the widget rects. Falls back to flat translucent cards when the
// liquid-glass extension is unavailable.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ClockWidget, CLOCK_W, CLOCK_H} from './widgets/clock.js?v=2';
import {CalendarWidget, CALENDAR_W, CALENDAR_H} from './widgets/calendar.js?v=2';
import {WeatherWidget, WEATHER_W, WEATHER_H} from './widgets/weather.js?v=2';
import {WorldClockWidget, WORLDCLOCK_W, WORLDCLOCK_H} from './widgets/worldclock.js?v=2';
import {DateWidget, DATE_W, DATE_H} from './widgets/date.js?v=2';
import {RemindersWidget, REMINDERS_W, REMINDERS_H} from './widgets/reminders.js?v=2';
import {StocksWidget, STOCKS_W, STOCKS_H} from './widgets/stocks.js?v=2';
import {NewsWidget, NEWS_W, NEWS_H} from './widgets/news.js?v=2';

import {paintBox, paintInk, usesDarkInk} from './widgets/theme.js';

const SCHEMA = 'org.gnome.shell.extensions.tahoe-widgets';

// Glass regions extend past the card so blur/refraction/rim have room,
// exactly like the Control Center pills.
const GLASS_MARGIN = 22;
const GLASS_CLIP_PAD = 200;

function _lgDir() {
    try {
        return GLib.build_filenamev([GLib.get_home_dir(),
            '.local', 'share', 'gnome-shell', 'extensions',
            'liquid-glass@thinkingcoding1231.gmail.com']);
    } catch (_) {
        return null;
    }
}

// rgba() string -> [r, g, b] floats. Anything unparseable -> white.
function _parseTint(str) {
    try {
        const m = String(str).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m)
            return [Math.min(255, +m[1]) / 255, Math.min(255, +m[2]) / 255, Math.min(255, +m[3]) / 255];
    } catch (_) {
        // fall through
    }
    return [1, 1, 1];
}

function _luminance([r, g, b]) {
    const f = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const DEFS = [
    {key: 'worldclock', visible: 'worldclock-visible', pad: false, kind: 'card',
     variantKey: 'worldclock-variant', shapeDefault: 'wide',
     make: o => new WorldClockWidget({settings: o.settings, theme: o.theme, variant: o.variant}),
     w: WORLDCLOCK_W, h: WORLDCLOCK_H},
    {key: 'calendar', visible: 'calendar-visible', pad: true, kind: 'card',
     variantKey: 'calendar-variant', shapeDefault: 'square',
     make: o => new CalendarWidget({settings: o.settings, darkText: o.darkText, variant: o.variant}),
     w: CALENDAR_W, h: CALENDAR_H},
    {key: 'reminders', visible: 'reminders-visible', pad: true, kind: 'card',
     variantKey: 'reminders-variant', shapeDefault: 'wide',
     make: o => new RemindersWidget({settings: o.settings, darkText: o.darkText}),
     w: REMINDERS_W, h: REMINDERS_H},
    {key: 'date', visible: 'date-visible', pad: true, kind: 'card',
     variantKey: 'date-variant', shapeDefault: 'square',
     make: o => new DateWidget({settings: o.settings, darkText: o.darkText}),
     w: DATE_W, h: DATE_H},
    {key: 'weather', visible: 'weather-visible', pad: true, kind: 'weather',
     variantKey: 'weather-variant', shapeDefault: 'wide',
     make: o => new WeatherWidget({settings: o.settings, darkText: o.darkText, variant: o.variant}),
     w: WEATHER_W, h: WEATHER_H},
    {key: 'stocks', visible: 'stocks-visible', pad: true, kind: 'stocks',
     variantKey: 'stocks-variant', shapeDefault: 'wide',
     make: o => new StocksWidget({settings: o.settings, darkText: o.darkText}),
     w: STOCKS_W, h: STOCKS_H},
    {key: 'news', visible: 'news-visible', pad: true, kind: 'card',
     variantKey: 'news-variant', shapeDefault: 'wide',
     make: o => new NewsWidget({settings: o.settings, darkText: o.darkText, variant: o.variant}),
     w: NEWS_W, h: NEWS_H},
    {key: 'clock', visible: 'clock-visible', pad: false, kind: 'card',
     variantKey: 'clock-variant', shapeDefault: 'square',
     make: o => new ClockWidget({settings: o.settings, darkText: o.darkText}),
     w: CLOCK_W, h: CLOCK_H},
];

// Uniform templates: every widget lives in one of these two footprints.
// 'wide' value = rectangle, 'square' value = square. Content keeps its
// aspect and fits inside (centered, shrinking only if it overflows).
// Dimensions come from settings (square-size, rect-width, rect-height).
const TEMPLATE_SQUARE = [230, 230];
const TEMPLATE_RECT = [460, 230];

// Text ink inherited by every label inside the widget.
function inkStyle(theme, kind, pad) {
    return paintInk(theme, kind, pad);
}

class TahoeWidgets {
    constructor(settings) {
        this._settings = settings;
        this._items = new Map();
        this._changedId = 0;
        this._drag = null;
        this._bgGroup = null;
        this._bgAddedId = 0;
        this._bgRemovedId = 0;
        this._dead = false;
        // Liquid glass: one shared stack (mirror + refractive effect) for
        // all widgets. Loaded lazily; stays null without liquid-glass.
        this._glass = null;
        this._lgLoading = false;
    }

    // Desired order inside the background group: shell wallpaper actors,
    // then our glass stack, then the widget containers on top.
    _fixBgOrder() {
        if (this._dead)
            return;
        const bg = this._bgGroup;
        if (!bg)
            return;
        try {
            const wanted = [];
            for (const item of this._items.values()) {
                try {
                    if (item.container.get_parent() !== bg)
                        bg.add_child(item.container);
                    wanted.push(item.container);
                } catch (_) {
                    // gone
                }
            }
            let anchor = null;
            if (this._glass?.bgActor) {
                try {
                    const g = this._glass.bgActor;
                    if (g.get_parent() !== bg)
                        bg.add_child(g);
                    // Glass below the first widget, above everything else.
                    if (wanted.length)
                        bg.set_child_below_sibling(g, wanted[0]);
                    anchor = g;
                } catch (_) {
                    anchor = null;
                }
            }
            // Widgets stacked in definition order on top.
            for (const c of wanted) {
                try {
                    if (anchor)
                        bg.set_child_above_sibling(c, anchor);
                    anchor = c;
                } catch (_) {
                    // gone
                }
            }
        } catch (_) {
            // group gone
        }
    }

    // ---------------- liquid glass (shared refractive stack) ----------------
    // One stack for all widgets: wallpaper mirror + LiquidEffect, regions
    // follow the widget rects (recomputed on every move/resize/setting).
    // Behind a widget there is only wallpaper (windows are all in front),
    // so no window/UI clone machinery is needed at all.

    _lgSettings() {
        try {
            return new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com',
            });
        } catch (_) {
            return null;
        }
    }

    _glassInt(key, dflt) {
        try {
            const v = this._settings.get_int(key);
            if (Number.isFinite(v))
                return v;
        } catch (_) {
            // missing key
        }
        return dflt;
    }

    _glassTintRgb() {
        try {
            return _parseTint(this._settings.get_string('glass-tint'));
        } catch (_) {
            return [0.16, 0.16, 0.18];
        }
    }

    // Dark ink when the user tint is light (applies to the glass theme;
    // stocks always keeps white ink on its black card).
    _glassInkDark() {
        try {
            return _luminance(this._glassTintRgb()) > 0.45;
        } catch (_) {
            return false;
        }
    }

    _glassRadius() {
        return Math.max(0, Math.min(60, this._glassInt('glass-radius', 26)));
    }

    // Transparent card in glass mode: blur + user tint come from the
    // effect behind it. Flat tint card when glass is unavailable.
    _containerGlassStyle() {
        const r = this._glassRadius();
        return 'background-color: transparent;border: none;' +
            `border-radius: ${r}px;`;
    }

    _initGlass() {
        if (this._glass || this._lgLoading || this._dead)
            return;
        const dir = _lgDir();
        if (!dir)
            return;
        this._lgLoading = true;
        const base = `file://${dir}/dist`;
        Promise.all([import(`${base}/liquidEffect.js`), import(`${base}/utils.js`)])
            .then(([le, utils]) => {
                this._lgLoading = false;
                if (this._dead || this._glass)
                    return;
                if (!le?.LiquidEffect || !utils?.UnpickableActor)
                    return;
                try {
                    this._buildGlass(le.LiquidEffect, utils);
                } catch (e) {
                    console.log(`[tahoe-widgets] glass unavailable: ${e.message}`);
                    this._glass = null;
                }
                if (!this._glass)
                    return;
                this._applyGlassParams();
                this._fixBgOrder();
                // Re-style containers now that glass exists (transparent
                // cards over the refractive stack).
                for (const item of this._items.values()) {
                    try {
                        this._applyItem(item);
                    } catch (_) {
                        // gone
                    }
                }
                this._syncWidgetGlass();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    if (!this._dead)
                        this._syncWidgetGlass();
                    return GLib.SOURCE_REMOVE;
                });
            })
            .catch(e => {
                this._lgLoading = false;
                console.log(`[tahoe-widgets] glass unavailable: ${e?.message ?? e}`);
            });
    }

    _buildGlass(LiquidEffect, utils) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._bgGroup)
            return;
        const {UnpickableActor, setClipIfChanged, getTransformedRect} = utils;
        if (!UnpickableActor || !setClipIfChanged || !getTransformedRect)
            throw new Error('liquid-glass utils incomplete');

        const bgActor = new UnpickableActor();
        bgActor.set_name('liquid-glass-bg-actor-tahoe-widgets');
        bgActor.set_pivot_point(0, 0);
        bgActor.visible = false;

        const liquidBox = new UnpickableActor();
        liquidBox.set_name('liquid-box-tahoe-widgets');
        liquidBox.set_clip_to_allocation(true);
        bgActor.add_child(liquidBox);

        // Same 1px guard kiwi uses against the BMS black-screen bug.
        const dummy = new UnpickableActor();
        dummy.set_size(1, 1);
        dummy.set_opacity(0);
        liquidBox.add_child(dummy);

        const mirror = new Clutter.Clone();
        mirror.set_size(global.stage.width, global.stage.height);
        mirror.set_position(-monitor.x, -monitor.y);
        liquidBox.add_child(mirror);

        const effect = new LiquidEffect({
            extensionPath: _lgDir(),
            settings: this._lgSettings(),
            owner: 'tahoe-widgets',
        });
        liquidBox.add_effect(effect);

        this._glass = {
            bgActor, liquidBox, mirror, effect,
            setClipIfChanged, getTransformedRect,
            size: null, clip: null, srcActor: null,
        };
    }

    _applyGlassParams() {
        const g = this._glass;
        if (!g?.effect)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        try {
            const e = g.effect;
            e.setPadding(20);
            e.setCornerRadius(this._glassRadius());
            e.setIsDock(false);
            e.setMultiRegionMode(true);
            e.setBlurRadius(this._glassInt('glass-blur', 12));
            const [tr, tg, tb] = this._glassTintRgb();
            e.setTintColor(tr, tg, tb);
            e.setTintStrength(this._glassInt('glass-tint-strength', 12) / 100);
            e.setBrightness(1.0);
            e.setContrast(1.0);
            e.setSaturation(this._glassInt('glass-saturation', 85) / 100);
            e.setSurfaceLightEnabled(true);
            try {
                e._setFloat('sheen_intensity', 0);
                e._setFloat('rim_intensity', 0.08);
                e._setFloat('rim_width', 5.0);
                e._setFloat('rim_power', 6.0);
                e._setFloat('rim_directional_power', 2.7);
                e._setFloat('rim_light_color_intensity', 1.4);
                e._setFloat('specular_intensity', 0);
                e._setFloat('displacement_scale', 92);
                e._setFloat('ior', 2.4);
                e._setFloat('chroma_strength', 0.006);
                e._setFloat('edge_smoothing', 2.0);
                e._setFloat('profile_shape_n', 7.0);
                e._setFloat('max_z', 25);
            } catch (_) {
                // older liquid-glass without the uniforms
            }
            if (monitor) {
                e.setResolution(monitor.width, monitor.height);
                g.liquidBox.set_position(0, 0);
                g.liquidBox.set_size(monitor.width, monitor.height);
                g.mirror.set_size(global.stage.width, global.stage.height);
                g.mirror.set_position(-monitor.x, -monitor.y);
                g.bgActor.set_position(monitor.x, monitor.y);
            }
        } catch (e) {
            // effect gone
        }
    }

    _bgWallpaperActor(monitor) {
        try {
            const mgrs = Main.layoutManager._bgManagers;
            const bg = mgrs?.[monitor?.index ?? 0]?.backgroundActor;
            if (bg)
                return bg;
        } catch (_) {
            // fall through
        }
        try {
            return Main.layoutManager._backgroundGroup ?? null;
        } catch (_) {
            return null;
        }
    }

    _syncWidgetGlass() {
        const g = this._glass;
        if (!g?.effect || this._dead)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._bgGroup)
            return;
        let theme = 'glass';
        try {
            theme = this._settings.get_string('theme');
        } catch (_) {
            // default glass
        }
        try {
            // Wallpaper actor can be replaced on wallpaper/monitor change.
            const src = this._bgWallpaperActor(monitor);
            if (src && g.srcActor !== src) {
                try {
                    g.mirror.source = src;
                    g.srcActor = src;
                } catch (_) {
                    // keep old source
                }
            }
            const regions = [];
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            if (theme === 'glass') {
                for (const item of this._items.values()) {
                    try {
                        const c = item.container;
                        if (!c.visible || !c.mapped)
                            continue;
                        const [ax, ay, w, h] = g.getTransformedRect(c);
                        if (!(w > 0) || !(h > 0) || Number.isNaN(ax) || Number.isNaN(ay))
                            continue;
                        const [tr, tg, tb] = this._glassTintRgb();
                        const rx = (ax - monitor.x) - GLASS_MARGIN;
                        const ry = (ay - monitor.y) - GLASS_MARGIN;
                        const rw = w + GLASS_MARGIN * 2;
                        const rh = h + GLASS_MARGIN * 2;
                        regions.push({
                            x: rx, y: ry, w: rw, h: rh,
                            tintR: tr, tintG: tg, tintB: tb,
                            baseStrength: this._glassInt('glass-tint-strength', 12) / 100,
                        });
                        minX = Math.min(minX, rx);
                        minY = Math.min(minY, ry);
                        maxX = Math.max(maxX, rx + rw);
                        maxY = Math.max(maxY, ry + rh);
                    } catch (_) {
                        // gone
                    }
                }
            }
            if (!regions.length) {
                if (g.bgActor.visible)
                    g.bgActor.hide();
                return;
            }
            if (!g.bgActor.visible)
                g.bgActor.show();
            g.effect.setGlassRegions(regions);
            const clip = [minX - GLASS_CLIP_PAD, minY - GLASS_CLIP_PAD,
                (maxX - minX) + GLASS_CLIP_PAD * 2, (maxY - minY) + GLASS_CLIP_PAD * 2];
            if (!g.clip || g.clip.some((v, i) => v !== clip[i])) {
                g.clip = clip;
                g.setClipIfChanged(g.bgActor, clip[0], clip[1], clip[2], clip[3]);
            }
        } catch (_) {
            // gone
        }
    }

    _destroyGlass() {
        const g = this._glass;
        this._glass = null;
        if (!g)
            return;
        try {
            g.effect?.cleanup?.();
        } catch (_) {
            // already cleaned
        }
        try {
            g.bgActor?.destroy?.();
        } catch (_) {
            // gone
        }
    }

    // Widgets must live ABOVE the wallpaper. In current GNOME the
    // wallpaper (Meta_BackgroundGroup) sits INSIDE window_group, so the
    // old "insert below window_group" parked widgets UNDER the opaque
    // background and they never painted on stage (while offscreen glass
    // clones, which skip the background, still showed them). Parenting to
    // the background group itself, pinned on top, fixes the layering for
    // good: wallpaper below, normal windows still above.

    // Widget scale (pivot top-left so the saved x/y stays put while the
    // widget grows right and down). Clamped to the schema range.
    _scaleOf(key) {
        try {
            const s = this._settings.get_double(`${key}-scale`);
            if (Number.isFinite(s))
                return Math.max(0.5, Math.min(2.0, s));
        } catch (e) {
            // key missing: normal size
        }
        return 1.0;
    }

    // Stored shape name ('wide' = rectangle, anything else = square).
    // Falls back to the definition default.
    _shapeOf(def) {
        let v = null;
        try {
            v = def.variantKey ? this._settings.get_string(def.variantKey) : null;
        } catch (_) {
            v = null;
        }
        if (!v)
            v = def.shapeDefault || 'square';
        return v === 'wide' ? 'wide' : 'square';
    }

    // Template footprint in pixels for a definition, from user settings.
    _footprint(def) {
        const t = this._templateDims();
        return this._shapeOf(def) === 'wide' ? t.rect : t.square;
    }

    // Template footprint in pixels, from user settings (square-size,
    // rect-width, rect-height). Falls back to built-in defaults.
    _templateDims() {
        let s = 230, rw = 460, rh = 230;
        try {
            const v = this._settings.get_int('square-size');
            if (Number.isFinite(v) && v > 0)
                s = v;
        } catch (_) {
            // default stays
        }
        try {
            const v = this._settings.get_int('rect-width');
            if (Number.isFinite(v) && v > 0)
                rw = v;
        } catch (_) {
            // default stays
        }
        try {
            const v = this._settings.get_int('rect-height');
            if (Number.isFinite(v) && v > 0)
                rh = v;
        } catch (_) {
            // default stays
        }
        return {square: [s, s], rect: [rw, rh]};
    }

    // Root text size in px for one widget: its own key first, then the
    // global text-size fallback (0 = automatic, inherit shell font).
    _textPxFor(def) {
        for (const key of [`${def.key}-text-size`, 'text-size']) {
            try {
                const v = this._settings.get_int(key);
                if (Number.isFinite(v) && v > 0)
                    return Math.min(32, Math.round(v));
            } catch (_) {
                // missing key, try next
            }
        }
        return 0;
    }

    // Root text size in px (0 = automatic, inherit shell font).
    _textPx() {
        try {
            const v = this._settings.get_int('text-size');
            if (Number.isFinite(v) && v > 0)
                return Math.min(32, Math.round(v));
        } catch (_) {
            // automatic
        }
        return 0;
    }

    // Natural content size of a widget (variant-aware where supported).
    _naturalSize(def, content) {
        try {
            if (content && typeof content.getVariantSize === 'function') {
                const [vw, vh] = content.getVariantSize();
                if (Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0)
                    return [Math.round(vw), Math.round(vh)];
            }
        } catch (_) {
            // default footprint stays
        }
        return [def.w, def.h];
    }

    enable() {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelH = Main.layoutManager.panelBox.height;
        // Auto-layout: fill the right column top to bottom, then spill
        // into further columns to the left. A single column overflows a
        // 1080p screen (8 widgets no longer fit), leaving widgets stranded
        // below the visible area with no way to reach them.
        const EDGE = 24;
        const COL_GAP = 16;
        const ROW_GAP = 16;
        const topY = monitor.y + panelH + 24;
        const bottomEdge = monitor.y + monitor.height - EDGE;
        const autoPos = new Map();
        {
            let colRight = monitor.x + monitor.width - EDGE;
            let y = topY;
            let colW = 0;
            for (const def of DEFS) {
                const [fw, fh] = this._footprint(def);
                if (y + fh > bottomEdge && y > topY) {
                    colRight -= colW + COL_GAP;
                    y = topY;
                    colW = 0;
                }
                autoPos.set(def.key, [colRight - fw, y]);
                y += fh + ROW_GAP;
                colW = Math.max(colW, fw);
            }
        }

        for (const def of DEFS) {
            let x = this._settings.get_int(`${def.key}-x`);
            let y = this._settings.get_int(`${def.key}-y`);
            if (x < 0 || y < 0)
                [x, y] = autoPos.get(def.key);

            const theme = this._settings.get_string('theme');

            // Container: BinLayout stacks content (fills the box) with the
            // resize grip pinned to the bottom-right corner. Background
            // lives on the container itself.
            const container = new St.Widget({
                style_class: 'tahoe-widget-box',
                reactive: true,
                layout_manager: new Clutter.BinLayout(),
            });
            container.set_position(x, y);
            container.set_style(paintBox(theme, def.kind));

            let variant = null;
            if (def.variantKey) {
                try {
                    variant = this._settings.get_string(def.variantKey);
                } catch (_) {
                    variant = null;
                }
            }
            const content = def.make({
                settings: this._settings,
                theme,
                darkText: usesDarkInk(theme, def.kind),
                variant,
            });
            content.set_style(inkStyle(theme, def.kind, def.pad));
            container.add_child(content);

            // Into the background group (above the wallpaper). Falls back
            // to below window_group only where _backgroundGroup is absent.
            this._bgGroup = Main.layoutManager._backgroundGroup ?? null;
            if (this._bgGroup) {
                try {
                    this._bgGroup.add_child(container);
                } catch (_) {
                    // already parented
                }
            } else {
                const below = global.window_group ?? global.windowGroup ?? null;
                if (below)
                    Main.layoutManager.uiGroup.insert_child_below(container, below);
                else
                    Main.layoutManager.uiGroup.add_child(container);
            }

            container.connect('button-press-event', (_a, event) => {
                if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                    return Clutter.EVENT_PROPAGATE;
                this._beginDrag(def.key, event);
                return Clutter.EVENT_STOP;
            });

            const item = {def, container, content, x, y, cw: 0, ch: 0, scale: 1};
            this._items.set(def.key, item);
            this._applyItem(item);
        }

        console.log(`[tahoe-widgets] boot v3: ${this._items.size} widgets live`);

        // Order now that everything exists: wallpaper actors, glass
        // stack, widget containers on top.
        this._fixBgOrder();

        // Build the shared liquid-glass stack (lazy import: without the
        // liquid-glass extension the widgets keep their flat cards).
        this._initGlass();

        // Heartbeat: cheap insurance that allocations stay valid
        // (relayout recomputes them if anything disturbs the stacking).
        this._beatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            for (const item of this._items.values()) {
                try {
                    item.container.queue_relayout();
                } catch (e) {
                    // gone
                }
                try {
                    item.container.queue_redraw();
                } catch (e) {
                    // gone
                }
            }
            return GLib.SOURCE_CONTINUE;
        });

        // Background-group guards: keep widget containers pinned above any
        // wallpaper actor the shell (or Ding's overview layer) adds later,
        // and re-adopt them if anything removes them. Not our own churn:
        // restacks never emit these signals, so no loops.
        try {
            if (this._bgGroup) {
                this._bgAddedId = this._bgGroup.connect('actor-added', (_g, actor) => {
                    if (this._dead)
                        return;
                    try {
                        if (this._glass?.bgActor === actor)
                            return;
                        let ours = false;
                        for (const item of this._items.values()) {
                            if (item.container === actor) {
                                ours = true;
                                break;
                            }
                        }
                        if (!ours)
                            this._fixBgOrder();
                    } catch (e) {
                        // gone
                    }
                });
                this._bgRemovedId = this._bgGroup.connect('actor-removed', (_g, actor) => {
                    if (this._dead)
                        return;
                    try {
                        if (this._glass?.bgActor === actor) {
                            // Glass stack torn out from under us: rebuild order.
                            this._fixBgOrder();
                            return;
                        }
                        for (const item of this._items.values()) {
                            if (item.container === actor) {
                                this._fixBgOrder();
                                break;
                            }
                        }
                    } catch (e) {
                        // gone
                    }
                });
            }
        } catch (e) {
            this._bgAddedId = 0;
            this._bgRemovedId = 0;
        }

        try {
            this._monChangedId = Main.layoutManager.connect('monitors-changed',
                () => {
                    this._fixBgOrder();
                    this._syncWidgetGlass();
                });
        } catch (e) {
            this._monChangedId = 0;
        }
        try {
            this._overviewHiddenId = Main.overview.connect('hidden', () => {
                for (const item of this._items.values()) {
                    try {
                        item.container.queue_relayout();
                    } catch (e) {
                        // gone
                    }
                }
            });
        } catch (e) {
            this._overviewHiddenId = 0;
        }

        this._changedId = this._settings.connect('changed', (_s, key) => {
            if (typeof key === 'string' && (key.startsWith('glass-') ||
                key === 'square-size' || key === 'rect-width' ||
                key === 'rect-height' || key === 'text-size')) {
                // Global geometry/ink tuning: re-apply everything.
                for (const item of this._items.values()) {
                    try {
                        this._applyItem(item);
                    } catch (_) {
                        // gone
                    }
                }
                this._applyGlassParams();
                this._syncWidgetGlass();
                return;
            }
            for (const item of this._items.values()) {
                if (key === item.def.visible ||
                    key === `${item.def.key}-x` || key === `${item.def.key}-y` ||
                    key === `${item.def.key}-scale` ||
                    key === `${item.def.key}-text-size` ||
                    key === 'theme' || key === 'city' ||
                    key === 'latitude' || key === 'longitude' ||
                    key === 'reminders' || key === 'news-feed' ||
                    (item.def.variantKey && key === item.def.variantKey))
                    this._applyItem(item);
            }
            if (key === 'theme')
                this._syncWidgetGlass();
        });
    }

    // Ink follows the user tint in glass mode (light tint -> dark text),
    // otherwise the per-surface defaults. Stocks always keeps white ink.
    _inkDarkFor(def, theme) {
        if (def.kind === 'stocks')
            return false;
        if (theme === 'glass')
            return this._glassInkDark();
        return usesDarkInk(theme, def.kind);
    }

    _applyItem(item) {
        const visible = this._settings.get_boolean(item.def.visible);
        item.container.visible = visible;
        if (!visible) {
            this._syncWidgetGlass();
            return;
        }

        const x = this._settings.get_int(`${item.def.key}-x`);
        const y = this._settings.get_int(`${item.def.key}-y`);
        if (x >= 0 && y >= 0 && (x !== item.x || y !== item.y)) {
            item.x = x;
            item.y = y;
            item.container.set_position(x, y);
        }

        const theme = this._settings.get_string('theme');
        // Shape variant first: content layout follows it...
        if (item.def.variantKey && typeof item.content.setVariant === 'function') {
            try {
                item.content.setVariant(this._settings.get_string(item.def.variantKey));
            } catch (_) {
                // keeps current shape
            }
        }
        // ...then the uniform template box times the user scale, all in
        // real pixels (never a bitmap transform, so nothing pixelates):
        // content layout scales with it, fonts re-render via em, fixed
        // graphics follow through setContentScale. The fit transform only
        // ever shrinks (visually lossless) and only on overflow.
        try {
            const [nw, nh] = this._naturalSize(item.def, item.content);
            const [tw, th] = this._footprint(item.def);
            item.cw = tw;
            item.ch = th;
            const s = this._scaleOf(item.def.key);
            item.scale = s;
            item.container.set_size(Math.round(tw * s), Math.round(th * s));
            if (typeof item.content.setContentScale === 'function') {
                try {
                    item.content.setContentScale(s);
                } catch (_) {
                    // widget keeps base graphics
                }
            }
            item.content.set_size(Math.round(nw * s), Math.round(nh * s));
            let f = Math.min(1, tw / nw, th / nh);
            if (!Number.isFinite(f) || f <= 0)
                f = 1;
            f = Math.max(0.5, f);
            item.content.set_pivot_point(0.5, 0.5);
            item.content.set_scale(f, f);
        } catch (_) {
            // footprint stays
        }
        if (theme === 'glass' && this._glass)
            item.container.set_style(this._containerGlassStyle());
        else
            item.container.set_style(paintBox(theme, item.def.kind));
        // Root text size scales all em-based labels at once: explicit
        // pixels win, otherwise the user scale as em (crisp re-render).
        let ink = inkStyle(theme, item.def.kind, item.def.pad);
        const px = this._textPxFor(item.def);
        if (px > 0)
            ink += ` font-size: ${px}px;`;
        else if (item.scale && item.scale !== 1)
            ink += ` font-size: ${item.scale}em;`;
        item.content.set_style(ink);

        const darkText = this._inkDarkFor(item.def, theme);
        if (typeof item.content.setDarkText === 'function')
            item.content.setDarkText(darkText);
        if (typeof item.content.setTheme === 'function')
            item.content.setTheme(theme);
        if (item.def.key === 'weather' &&
            (this._lastCity === undefined ||
             this._settings.get_string('city') !== this._lastCity)) {
            this._lastCity = this._settings.get_string('city');
            item.content.refresh();
        }
        if (item.def.key === 'news' &&
            (this._lastFeed === undefined ||
             this._settings.get_string('news-feed') !== this._lastFeed)) {
            this._lastFeed = this._settings.get_string('news-feed');
            item.content.refresh();
        }
        // Footprint may have changed (variant/scale/visibility): rebuild
        // the glass regions to match.
        this._syncWidgetGlass();
    }

    _beginDrag(key, event) {
        const item = this._items.get(key);
        if (!item)
            return;
        // A press landing mid-drag (multi-touch, double press) must not
        // orphan the live motion handler.
        if (this._drag?.item === item)
            return Clutter.EVENT_STOP;
        const [stageX, stageY] = event.get_coords();
        if (!Number.isFinite(stageX) || !Number.isFinite(stageY))
            return Clutter.EVENT_PROPAGATE;
        // Anchor from the live actor position, never from possibly stale
        // cached state, so the widget cannot jump on grab or on release.
        let ax = item.x, ay = item.y;
        try {
            const [cx, cy] = item.container.get_position();
            if (Number.isFinite(cx) && Number.isFinite(cy)) {
                ax = Math.round(cx);
                ay = Math.round(cy);
            }
        } catch (_) {
            // cached position stays
        }
        item.x = ax;
        item.y = ay;
        this._drag = {
            item,
            dx: stageX - ax,
            dy: stageY - ay,
            motionId: global.stage.connect('motion-event', (_a, ev) => {
                const [mx, my] = ev.get_coords();
                if (!Number.isFinite(mx) || !Number.isFinite(my))
                    return Clutter.EVENT_STOP;
                item.x = Math.round(mx - this._drag.dx);
                item.y = Math.round(my - this._drag.dy);
                item.container.set_position(item.x, item.y);
                this._syncWidgetGlass();
                return Clutter.EVENT_STOP;
            }),
        };
        const upId = global.stage.connect('button-release-event', () => {
            this._endDrag(upId);
            return Clutter.EVENT_STOP;
        });
        this._drag.upId = upId;
    }

    _endDrag(upId) {
        if (!this._drag)
            return;
        const {item, motionId} = this._drag;
        try {
            global.stage.disconnect(motionId);
        } catch (e) {
            // already gone
        }
        try {
            global.stage.disconnect(upId);
        } catch (e) {
            // already gone
        }
        this._drag = null;
        // Adopt the live actor position: whatever is on screen is truth,
        // so no stale math can shift the widget after release.
        try {
            const [cx, cy] = item.container.get_position();
            if (Number.isFinite(cx) && Number.isFinite(cy)) {
                item.x = Math.round(cx);
                item.y = Math.round(cy);
            }
        } catch (e) {
            // cached position stays
        }
        try {
            this._settings.set_int(`${item.def.key}-x`, item.x);
            this._settings.set_int(`${item.def.key}-y`, item.y);
        } catch (e) {
            // read-only settings
        }
    }

    disable() {
        this._dead = true;
        this._destroyGlass();
        if (this._beatId) {
            try {
                GLib.source_remove(this._beatId);
            } catch (e) {
                // gone
            }
            this._beatId = 0;
        }
        if (this._bgAddedId && this._bgGroup) {
            try {
                this._bgGroup.disconnect(this._bgAddedId);
            } catch (e) {
                // gone
            }
            this._bgAddedId = 0;
        }
        if (this._bgRemovedId && this._bgGroup) {
            try {
                this._bgGroup.disconnect(this._bgRemovedId);
            } catch (e) {
                // gone
            }
            this._bgRemovedId = 0;
        }
        this._bgGroup = null;
        if (this._monChangedId) {
            try {
                Main.layoutManager.disconnect(this._monChangedId);
            } catch (e) {
                // gone
            }
            this._monChangedId = 0;
        }
        if (this._overviewHiddenId) {
            try {
                Main.overview.disconnect(this._overviewHiddenId);
            } catch (e) {
                // gone
            }
            this._overviewHiddenId = 0;
        }
        if (this._drag) {
            try {
                global.stage.disconnect(this._drag.motionId);
            } catch (e) {
                // gone
            }
            try {
                global.stage.disconnect(this._drag.upId);
            } catch (e) {
                // gone
            }
            this._drag = null;
        }
        if (this._changedId && this._settings) {
            try {
                this._settings.disconnect(this._changedId);
            } catch (e) {
                // gone
            }
            this._changedId = 0;
        }
        for (const item of this._items.values()) {
            try {
                item.container.destroy();
            } catch (e) {
                // gone
            }
        }
        this._items.clear();
        this._settings = null;
    }
}

let _instance = null;

export default class TahoeWidgetsExtension extends Extension {
    enable() {
        if (_instance)
            return;
        _instance = new TahoeWidgets(this.getSettings(SCHEMA));
        _instance.enable();
    }

    disable() {
        if (!_instance)
            return;
        _instance.disable();
        _instance = null;
    }
}
