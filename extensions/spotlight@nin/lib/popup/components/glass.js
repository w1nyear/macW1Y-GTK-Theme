// Spotlight: refractive Liquid Glass behind the popup.
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Same engine tahoe-widgets uses: a shared LiquidEffect from the liquid-glass
// extension sampling live window + wallpaper clones. Falls back to the CSS
// translucent panel when liquid-glass is unavailable. Nothing throws outward.
//
// Visuals follow the glass-* GSettings keys live: tint color/strength, blur,
// corner radius, saturation and refraction (edge distortion).
// Glass hugs the panel: a small margin just for the rim glow. (A wide
// margin reads as a broken oversized halo over windows.)
const GLASS_MARGIN = 8;
const GLASS_CLIP_PAD = 200;

// Fallback panel fill per theme; the user tint is mixed in by strength.
// Dark is near-black, like Tahoe dark glass.
const FALLBACK_DARK = [0, 0, 0, 0.55];
const FALLBACK_LIGHT = [246, 246, 250, 0.6];

function lgDir() {
    try {
        return GLib.build_filenamev([GLib.get_home_dir(),
            '.local', 'share', 'gnome-shell', 'extensions',
            'liquid-glass@thinkingcoding1231.gmail.com']);
    } catch (_) {
        return null;
    }
}

// rgba() string -> [r, g, b] 0..1 floats. Anything unparseable -> white.
function parseTint(str) {
    try {
        const m = String(str).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m)
            return [Math.min(255, +m[1]) / 255, Math.min(255, +m[2]) / 255, Math.min(255, +m[3]) / 255];
    } catch (_) {
        // fall through
    }
    return [1, 1, 1];
}

export class SpotlightGlass {
    constructor(popup, content, settings, target = null) {
        this._popup = popup;
        this._content = content;
        this._target = target || content;
        this._settings = settings;
        this._built = false;
        this._loading = false;
        this._dead = false;
        this._frameSyncId = 0;
        this._last = null;
        this._lastR = null;
        this._mirror = null;
        this._mirrorSrc = null;
        this._settingsChangedId = 0;
        // Live-update the refractive params and the fallback CSS fill.
        // applyTheme() owns the theme-light class; refreshCss() only reads it.
        try {
            this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
                if (this._dead)
                    return;
                if (typeof key !== 'string')
                    return;
                // Engine switch rebuilds the whole stack.
                if (key === 'glass-engine') {
                    this._rebuildEngine();
                    return;
                }
                if (key.startsWith('glass-') || key === 'theme-preference') {
                    this._applyEffectParams();
                    this.refreshCss();
                }
            });
        } catch (_) {
            this._settingsChangedId = 0;
        }
    }

    _engine() {
        try {
            if (this._settings.get_string('glass-engine') === 'wallpaper')
                return 'wallpaper';
        } catch (_) {
            // default below
        }
        return 'full';
    }

    // Tears the stack down and rebuilds it under the new engine. Used
    // when the user flips glass-engine while the popup is open.
    _rebuildEngine() {
        if (this._dead)
            return;
        this._lastR = null;
        this._teardown();
        this._last = null;
        this._mirrorSrc = null;
        this.attach();
        // attach() is async; if the stack already existed the show path
        // below restarts the tick once the build lands. When built, the
        // next tick picks the new engine up on its own.
        this.show();
    }

    get live() {
        return this._built && !!this._effect;
    }

    // Builds the stack on first open (lazy import) and starts the frame tick.
    // On success the content gets .spotlight-glass (transparent fill).
    attach() {
        if (this._built || this._loading || this._dead)
            return;
        const dir = lgDir();
        if (!dir)
            return;
        this._loading = true;
        const base = `file://${dir}/dist`;
        Promise.all([import(`${base}/liquidEffect.js`), import(`${base}/utils.js`)])
            .then(([le, utils]) => {
                this._loading = false;
                if (this._dead || this._built)
                    return;
                if (!le?.LiquidEffect || !utils?.UnpickableActor)
                    return;
                try {
                    this._build(le.LiquidEffect, utils);
                } catch (e) {
                    console.log(`[spotlight] glass unavailable: ${e.message}`);
                    this._teardown();
                }
            })
            .catch(e => {
                this._loading = false;
                console.log(`[spotlight] glass unavailable: ${e?.message ?? e}`);
            });
    }

    _lgSettings() {
        try {
            return new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com',
            });
        } catch (_) {
            return null;
        }
    }

    // Wallpaper actor for the given monitor, following wallpaper and
    // monitor changes. Same source tahoe-widgets mirrors.
    _bgSource(monitor) {
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

    _glassRadius() {
        return Math.max(0, Math.min(60, this._glassInt('glass-radius', 26)));
    }

    // Wanted corner radius: half the panel height when collapsed (a real
    // stadium — a fixed 300px radius degrades the shader's rounded-rect
    // SDF into a pointed "lens" on short panels), user setting otherwise.
    // Tool buttons are always full circles.
    _wantedRadius() {
        if (this._target !== this._content)
            return 999;
        try {
            if (this._content?.has_style_class_name?.('spotlight-collapsed')) {
                const h = this._lastH;
                if (Number.isFinite(h) && h > 0)
                    return Math.min(60, Math.max(8, h / 2));
                return 32;
            }
        } catch (_) {
            // content gone
        }
        return this._glassRadius();
    }

    // Corner radius + fallback tint as inline style. The radius always
    // applies (keeps CSS and the refractive region in sync); the tinted
    // fill only applies without live glass, since live glass means a
    // transparent panel over the refractive stack. The detached tool
    // circles follow the same fill so every sheet matches.
    refreshCss() {
        if (this._dead || !this._target)
            return;
        try {
            const light = this._popup._content.has_style_class_name('theme-light');
            const base = light ? FALLBACK_LIGHT : FALLBACK_DARK;
            const [tr, tg, tb] = parseTint(this._settings.get_string('glass-tint'));
            const s = Math.max(0, Math.min(100, this._glassInt('glass-tint-strength', 16))) / 100;
            const rr = Math.round(base[0] + (tr * 255 - base[0]) * s);
            const gg = Math.round(base[1] + (tg * 255 - base[1]) * s);
            const bb = Math.round(base[2] + (tb * 255 - base[2]) * s);
            const bg = `background-color: rgba(${rr}, ${gg}, ${bb}, ${base[3]});`;
            if (this.live) {
                this._target.set_style(`border-radius: ${this._wantedRadius()}px;`);
                return;
            }
            this._target.set_style(
                `border-radius: ${this._wantedRadius()}px;${bg}`);
        } catch (_) {
            // settings/target gone
        }
    }

    // Pushes the glass-* keys into the refractive effect.
    _applyEffectParams() {
        const e = this._effect;
        if (!e)
            return;
        try {
            // Tahoe look: soft blur, user tint, boosted saturation, gentle rim.
            e.setCornerRadius(Math.min(300, this._wantedRadius()));
            e.setBlurRadius(this._glassInt('glass-blur', 14));
            const [tr, tg, tb] = parseTint(this._settings.get_string('glass-tint'));
            e.setTintColor(tr, tg, tb);
            e.setTintStrength(this._glassInt('glass-tint-strength', 16) / 100);
            e.setSaturation(this._glassInt('glass-saturation', 85) / 100);
            e.setBrightness(1.0);
            e.setContrast(1.0);
            try {
                e._setFloat('displacement_scale', this._glassInt('glass-refraction', 92));
            } catch (_) {
                // older liquid-glass without the uniforms
            }
        } catch (_) {
            // effect gone
        }
    }

    _build(LiquidEffect, utils) {
        const {UnpickableActor, WindowCloneManager, UILayerSampler} = utils;
        if (!WindowCloneManager || !UILayerSampler)
            throw new Error('liquid-glass utils incomplete');
        const parent = this._popup.get_parent() ?? Main.layoutManager.uiGroup;
        this._utils = utils;

        this._bgActor = new UnpickableActor();
        this._bgActor.set_name('liquid-glass-bg-actor');
        this._bgActor.visible = false;

        this._liquidBox = new UnpickableActor();
        this._liquidBox.set_name('liquid-box');
        this._liquidBox.set_clip_to_allocation(true);
        this._bgActor.add_child(this._liquidBox);

        // 1px guard against the BMS black-screen bug, same as other managers.
        const dummy = new UnpickableActor();
        dummy.set_size(1, 1);
        dummy.set_opacity(0);
        this._liquidBox.add_child(dummy);

        this._cloneContainer = new UnpickableActor();
        this._cloneContainer.set_name('clone-container-spotlight');
        this._liquidBox.add_child(this._cloneContainer);

        try {
            parent.insert_child_below(this._bgActor, this._popup);
        } catch (_) {
            parent.add_child(this._bgActor);
        }

        this._effect = new LiquidEffect({
            extensionPath: lgDir(),
            settings: this._lgSettings(),
            owner: 'spotlight',
        });
        // Tahoe recipe: multi-region mode with one region for the popup.
        // Single-geometry mode renders the deep uniforms (displacement,
        // ior, profile) as a broken dark lens, so it is not used here.
        this._effect.setPadding(20);
        this._effect.setIsDock(false);
        try {
            this._effect.setMultiRegionMode(true);
        } catch (_) {
            // older liquid-glass without multi-region support
        }
        this._applyEffectParams();
        try {
            this._effect._setFloat('sheen_intensity', 0);
            this._effect._setFloat('rim_intensity', 0.08);
            this._effect._setFloat('rim_width', 5.0);
            this._effect._setFloat('rim_power', 6.0);
            this._effect._setFloat('rim_directional_power', 2.7);
            this._effect._setFloat('rim_light_color_intensity', 1.4);
            this._effect._setFloat('specular_intensity', 0);
            this._effect._setFloat('ior', 2.4);
            this._effect._setFloat('chroma_strength', 0.006);
            this._effect._setFloat('edge_smoothing', 2.0);
            this._effect._setFloat('profile_shape_n', 7.0);
            this._effect._setFloat('max_z', 25);
        } catch (_) {
            // older liquid-glass without the uniforms
        }
        this._liquidBox.add_effect(this._effect);

        // Wallpaper-only mirror: the exact tahoe-widgets recipe (a single
        // wallpaper clone, no window/UI machinery). Most compatible; the
        // default engine.
        if (this._engine() === 'wallpaper') {
            const monitor = this._popup._monitor ??
                Main.layoutManager.primaryMonitor;
            this._mirror = new Clutter.Clone();
            this._mirror.set_size(global.stage.width, global.stage.height);
            if (monitor)
                this._mirror.set_position(-monitor.x, -monitor.y);
            this._liquidBox.add_child(this._mirror);
            this._mirrorSrc = null;
        } else {
            this._windowClones = new WindowCloneManager(
                this._liquidBox, this._cloneContainer, 'lg-spotlight');
            this._uiSampler = new UILayerSampler(
                this._bgActor, this._liquidBox,
                [this._popup, global.windowGroup, global.window_group],
                this._cloneContainer, 'spotlight', [this._popup]);
            this._windowClones.rebuildClones();
        }
        try {
            this._uiSampler?.rebindSelf?.();
        } catch (_) {
            // older sampler without rebind
        }
        // Mutual exclusions with the other liquid-glass sheets (dock,
        // menus, ...): no glass may ever sample another glass, otherwise
        // the captures feed back into each other.
        try {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                if (child === this._bgActor)
                    continue;
                const isLiquidBg = child.get_name?.() === 'liquid-glass-bg-actor' ||
                    (typeof child.get_children === 'function' &&
                        child.get_children().some(c => c.get_name?.() === 'liquid-box'));
                if (isLiquidBg)
                    this._uiSampler?.addExclusion?.(child);
            }
        } catch (_) {
            // group gone
        }
        try {
            this._uiSampler?.refresh();
        } catch (_) {
            // sampler gone
        }

        this._built = true;
        this._target.add_style_class_name('spotlight-glass');
        // Drop the fallback fill (inline style beats the transparent class).
        this.refreshCss();
        this._startTick();
        this._syncGeometry();
    }

    _startTick() {
        if (this._frameSyncId !== 0)
            return;
        const tick = () => {
            this._frameSyncId = 0;
            if (this._dead || !this._built || !this._popup._visible)
                return GLib.SOURCE_REMOVE;
            if (this._utils?.isFrameSyncFrozen?.()) {
                this._frameSyncId = global.compositor.get_laters().add(
                    Meta.LaterType.BEFORE_REDRAW, tick);
                return GLib.SOURCE_REMOVE;
            }
            try {
                this._utils.ensureGlassAllocated?.(this._bgActor);
            } catch (_) {
                // gone
            }
            try {
                this._syncGeometry();
                // The pill collapses/expands as the query empties/fills.
                const wantR = Math.min(300, this._wantedRadius());
                if (wantR !== this._lastR) {
                    this._lastR = wantR;
                    try {
                        this._effect?.setCornerRadius(wantR);
                    } catch (_) {
                        // effect gone
                    }
                    this.refreshCss();
                }
                this._windowClones?.setOffset?.(-this._monX, -this._monY);
                this._uiSampler?.refresh?.();
                this._utils.syncGlassCaptureClip?.({
                    cloneContainer: this._cloneContainer,
                    effect: this._effect,
                    originX: this._monX,
                    originY: this._monY,
                    uiSampler: this._uiSampler,
                    windowCloneManager: this._windowClones,
                });
                this._uiSampler?.sync?.(this._monX, this._monY, this._monW, this._monH);
                this._windowClones?.sync?.();
            } catch (e) {
                this._utils.reportFrameLoopError?.('SpotlightGlass', e);
            }
            this._frameSyncId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW, tick);
            return GLib.SOURCE_REMOVE;
        };
        try {
            this._frameSyncId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW, tick);
        } catch (_) {
            this._frameSyncId = 0;
        }
    }

    _syncGeometry() {
        if (!this._bgActor || !this._effect)
            return;
        const [ax, ay, w, h] = this._utils.getTransformedRect(this._target);
        if (![ax, ay, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
            this._bgActor.hide();
            return;
        }
        this._lastH = h;
        // The popup's own monitor: the primary one is wrong on multi-monitor
        // setups and shifts the whole sheet (the "too narrow" symptom).
        const monitor = this._popup._monitor ??
            Main.layoutManager.primaryMonitor;
        // Wallpaper engine: track the wallpaper actor (it is replaced on
        // wallpaper/monitor changes) and keep the mirror aligned.
        if (this._mirror) {
            try {
                const src = this._bgSource(monitor);
                if (src && this._mirrorSrc !== src) {
                    this._mirror.source = src;
                    this._mirrorSrc = src;
                }
                this._utils.setSizeIfChanged?.(this._mirror,
                    global.stage.width, global.stage.height);
                if (monitor)
                    this._utils.setPositionIfChanged?.(this._mirror,
                        -monitor.x, -monitor.y);
            } catch (_) {
                // mirror gone
            }
        }
        this._monX = monitor?.x ?? 0;
        this._monY = monitor?.y ?? 0;
        this._monW = Math.max(1, monitor?.width ?? 1);
        this._monH = Math.max(1, monitor?.height ?? 1);
        const bgW = w + GLASS_MARGIN * 2;
        const bgH = h + GLASS_MARGIN * 2;
        const bgX = ax - GLASS_MARGIN;
        const bgY = ay - GLASS_MARGIN;
        const key = [bgX, bgY, bgW, bgH, this._monW, this._monH].join(',');
        if (key !== this._last) {
            this._last = key;
            this._bgActor.set_position(this._monX, this._monY);
            this._bgActor.set_size(this._monW, this._monH);
            this._liquidBox.set_position(0, 0);
            this._liquidBox.set_size(this._monW, this._monH);
            this._utils.setClipIfChanged?.(this._bgActor,
                bgX - this._monX - GLASS_CLIP_PAD, bgY - this._monY - GLASS_CLIP_PAD,
                bgW + GLASS_CLIP_PAD * 2, bgH + GLASS_CLIP_PAD * 2);
            this._effect.setResolution(this._monW, this._monH);
            // One Tahoe-style region for the whole popup (panel + tool
            // pill + gap), in monitor-local coordinates.
            try {
                const [tr, tg, tb] = parseTint(this._settings.get_string('glass-tint'));
                const strength = Math.max(0, Math.min(100,
                    this._glassInt('glass-tint-strength', 16))) / 100;
                this._effect.setGlassRegions([{
                    x: bgX - this._monX, y: bgY - this._monY, w: bgW, h: bgH,
                    tintR: tr, tintG: tg, tintB: tb, baseStrength: strength,
                }]);
            } catch (_) {
                // effect gone
            }
        }
        this._bgActor.opacity = this._popup.opacity;
        if (!this._bgActor.visible)
            this._bgActor.show();
    }

    // Called on close: stop the tick and hide the stack (kept for next open).
    hide() {
        if (this._frameSyncId !== 0) {
            try {
                global.compositor.get_laters().remove(this._frameSyncId);
            } catch (_) {
                // gone
            }
            this._frameSyncId = 0;
        }
        try {
            this._bgActor?.hide?.();
        } catch (_) {
            // gone
        }
    }

    // Called on open when the stack already exists.
    show() {
        if (!this._built)
            return;
        this._last = null;
        this._lastR = null;
        this._windowClones?.rebuildClones?.();
        this._uiSampler?.refresh?.();
        this._startTick();
        this._syncGeometry();
    }

    _teardown() {
        this.hide();
        try {
            this._effect?.cleanup?.();
        } catch (_) {
            // already cleaned
        }
        this._effect = null;
        try {
            this._windowClones?.destroy?.();
        } catch (_) {
            // gone
        }
        this._windowClones = null;
        try {
            this._uiSampler?.destroy?.();
        } catch (_) {
            // gone
        }
        this._uiSampler = null;
        try {
            this._bgActor?.destroy?.();
        } catch (_) {
            // gone
        }
        this._bgActor = null;
        this._liquidBox = null;
        this._cloneContainer = null;
        this._mirror = null;
        this._mirrorSrc = null;
        this._built = false;
        try {
            this._target?.remove_style_class_name?.('spotlight-glass');
        } catch (_) {
            // gone
        }
        // Back to the tinted fallback fill if the panel is still around.
        this.refreshCss();
    }

    destroy() {
        this._dead = true;
        if (this._settingsChangedId && this._settings) {
            try {
                this._settings.disconnect(this._settingsChangedId);
            } catch (_) {
                // gone
            }
            this._settingsChangedId = 0;
        }
        this._teardown();
        this._popup = null;
        this._content = null;
        this._settings = null;
        this._utils = null;
    }
}
