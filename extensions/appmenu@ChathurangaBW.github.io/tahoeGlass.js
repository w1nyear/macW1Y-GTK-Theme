// tahoeGlass.js — macOS Tahoe Refractive Liquid Glass engine integration
// Based on GNOME-Tahoe-main liquid-glass and spotlight@nin engine.
// Provides live refractive liquid glass with window+wallpaper cloning and mutual exclusion.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GLASS_MARGIN = 8;
const GLASS_CLIP_PAD = 200;

function lgDir() {
    try {
        return GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local',
            'share',
            'gnome-shell',
            'extensions',
            'liquid-glass@thinkingcoding1231.gmail.com'
        ]);
    } catch (_) {
        return null;
    }
}

function lgSettings() {
    try {
        return new Gio.Settings({
            schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com',
        });
    } catch (_) {
        return null;
    }
}

export class TahoeGlass {
    constructor({
        target,
        parentActor = null,
        cornerRadius = 26,
        blurRadius = 8,
        tintColor = [0, 0, 0],
        tintStrength = 0.05,
        displacementScale = 85.0,
        owner = 'tahoe-glass'
    }) {
        this._target = target;
        this._parentActor = parentActor || target;
        this._cornerRadius = cornerRadius;
        this._blurRadius = blurRadius;
        this._tintColor = tintColor;
        this._tintStrength = tintStrength;
        this._displacementScale = displacementScale;
        this._owner = owner;

        this._built = false;
        this._loading = false;
        this._dead = false;
        this._frameSyncId = 0;
        this._last = null;
        this._lastR = null;
        this._utils = null;
        this._effect = null;
        this._bgActor = null;
        this._liquidBox = null;
        this._cloneContainer = null;
        this._windowClones = null;
        this._uiSampler = null;
    }

    get live() {
        return this._built && !!this._effect;
    }

    setCornerRadius(radius) {
        this._cornerRadius = radius;
        if (this._effect) {
            try {
                this._effect.setCornerRadius(radius);
            } catch (_) {}
        }
    }

    attach() {
        if (this._built || this._loading || this._dead) return;
        const dir = lgDir();
        if (!dir) return;

        this._loading = true;
        const base = `file://${dir}/dist`;
        Promise.all([
            import(`${base}/liquidEffect.js`),
            import(`${base}/utils.js`)
        ])
            .then(([le, utils]) => {
                this._loading = false;
                if (this._dead || this._built) return;
                if (!le?.LiquidEffect || !utils?.UnpickableActor) return;
                try {
                    this._build(le.LiquidEffect, utils);
                } catch (e) {
                    console.log(`[TahoeGlass ${this._owner}] build failed: ${e.message}`);
                    this._teardown();
                }
            })
            .catch(e => {
                this._loading = false;
                console.log(`[TahoeGlass ${this._owner}] import failed: ${e?.message ?? e}`);
            });
    }

    _build(LiquidEffect, utils) {
        const { UnpickableActor, WindowCloneManager, UILayerSampler } = utils;
        if (!WindowCloneManager || !UILayerSampler) {
            throw new Error('liquid-glass utils incomplete');
        }

        this._utils = utils;
        const parent = this._parentActor.get_parent() ?? Main.layoutManager.uiGroup;

        this._bgActor = new UnpickableActor();
        this._bgActor.set_name('liquid-glass-bg-actor');
        this._bgActor.visible = false;

        this._liquidBox = new UnpickableActor();
        this._liquidBox.set_name('liquid-box');
        this._liquidBox.set_clip_to_allocation(true);
        this._bgActor.add_child(this._liquidBox);

        // 1px guard against black-screen bug
        const dummy = new UnpickableActor();
        dummy.set_size(1, 1);
        dummy.set_opacity(0);
        this._liquidBox.add_child(dummy);

        this._cloneContainer = new UnpickableActor();
        this._cloneContainer.set_name(`clone-container-${this._owner}`);
        this._liquidBox.add_child(this._cloneContainer);

        try {
            parent.insert_child_below(this._bgActor, this._parentActor);
        } catch (_) {
            parent.add_child(this._bgActor);
        }

        const settings = lgSettings();
        this._effect = new LiquidEffect({
            extensionPath: lgDir(),
            settings,
            owner: this._owner,
        });

        this._effect.setPadding(20);
        this._effect.setIsDock(false);
        try {
            this._effect.setMultiRegionMode(true);
        } catch (_) {}

        this._effect.setCornerRadius(this._cornerRadius);
        this._effect.setBlurRadius(this._blurRadius);
        this._effect.setTintColor(this._tintColor[0], this._tintColor[1], this._tintColor[2]);
        this._effect.setTintStrength(this._tintStrength);
        this._effect.setSaturation(1.0);
        this._effect.setBrightness(1.0);
        this._effect.setContrast(1.0);

        try {
            this._effect._setFloat('displacement_scale', this._displacementScale);
            this._effect._setFloat('sheen_intensity', 0.08);
            this._effect._setFloat('rim_intensity', 0.0);
            this._effect._setFloat('rim_width', 0.0);
            this._effect._setFloat('specular_intensity', 0.0);
            this._effect._setFloat('ior', 1.50);
            this._effect._setFloat('chroma_strength', 0.40);
            this._effect._setFloat('edge_smoothing', 0.99);
            this._effect._setFloat('profile_shape_n', 5.40);
            this._effect._setFloat('max_z', 12.0);
        } catch (_) {}

        this._liquidBox.add_effect(this._effect);

        this._windowClones = new WindowCloneManager(
            this._liquidBox,
            this._cloneContainer,
            `lg-${this._owner}`
        );
        this._uiSampler = new UILayerSampler(
            this._bgActor,
            this._liquidBox,
            [this._parentActor, global.windowGroup, global.window_group],
            this._cloneContainer,
            this._owner,
            [this._parentActor]
        );
        this._windowClones.rebuildClones();

        try {
            this._uiSampler?.rebindSelf?.();
        } catch (_) {}

        // Mutual exclusions with other liquid-glass sheets
        try {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                if (child === this._bgActor) continue;
                const isLiquidBg =
                    child.get_name?.() === 'liquid-glass-bg-actor' ||
                    (typeof child.get_children === 'function' &&
                        child.get_children().some(c => c.get_name?.() === 'liquid-box'));
                if (isLiquidBg) {
                    this._uiSampler?.addExclusion?.(child);
                }
            }
        } catch (_) {}

        try {
            this._uiSampler?.refresh();
        } catch (_) {}

        this._built = true;
        this._startTick();
        this._syncGeometry();
    }

    _startTick() {
        if (this._frameSyncId !== 0) return;
        const tick = () => {
            this._frameSyncId = 0;
            if (this._dead || !this._built || !this._parentActor.visible) {
                return GLib.SOURCE_REMOVE;
            }
            if (this._utils?.isFrameSyncFrozen?.()) {
                this._frameSyncId = global.compositor
                    .get_laters()
                    .add(Meta.LaterType.BEFORE_REDRAW, tick);
                return GLib.SOURCE_REMOVE;
            }
            try {
                this._utils.ensureGlassAllocated?.(this._bgActor);
            } catch (_) {}

            try {
                this._syncGeometry();
                const wantR = Math.min(300, this._cornerRadius);
                if (wantR !== this._lastR) {
                    this._lastR = wantR;
                    try {
                        this._effect?.setCornerRadius(wantR);
                    } catch (_) {}
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
                this._utils?.reportFrameLoopError?.(`TahoeGlass_${this._owner}`, e);
            }

            this._frameSyncId = global.compositor
                .get_laters()
                .add(Meta.LaterType.BEFORE_REDRAW, tick);
            return GLib.SOURCE_REMOVE;
        };

        try {
            this._frameSyncId = global.compositor
                .get_laters()
                .add(Meta.LaterType.BEFORE_REDRAW, tick);
        } catch (_) {
            this._frameSyncId = 0;
        }
    }

    _syncGeometry() {
        if (!this._bgActor || !this._effect || !this._target) return;
        let rect = null;
        try {
            rect = this._utils.getTransformedRect(this._target);
        } catch (_) {
            return;
        }
        if (!rect) return;
        const [ax, ay, w, h] = rect;
        if (![ax, ay, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
            this._bgActor.hide();
            return;
        }

        const monitor =
            Main.layoutManager.findMonitorForActor?.(this._parentActor) ??
            Main.layoutManager.primaryMonitor;
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
            this._utils.setClipIfChanged?.(
                this._bgActor,
                bgX - this._monX - GLASS_CLIP_PAD,
                bgY - this._monY - GLASS_CLIP_PAD,
                bgW + GLASS_CLIP_PAD * 2,
                bgH + GLASS_CLIP_PAD * 2
            );
            this._effect.setResolution(this._monW, this._monH);
            try {
                this._effect.setGlassRegions([
                    {
                        x: bgX - this._monX,
                        y: bgY - this._monY,
                        w: bgW,
                        h: bgH,
                        tintR: this._tintColor[0],
                        tintG: this._tintColor[1],
                        tintB: this._tintColor[2],
                        baseStrength: this._tintStrength,
                    },
                ]);
            } catch (_) {}
        }

        this._bgActor.opacity = this._parentActor.opacity;
        if (!this._bgActor.visible && this._parentActor.visible) {
            this._bgActor.show();
        }
    }

    show() {
        if (!this._built) {
            this.attach();
            return;
        }
        this._last = null;
        this._lastR = null;
        try {
            this._windowClones?.rebuildClones?.();
            this._uiSampler?.refresh?.();
            this._startTick();
            this._syncGeometry();
            this._bgActor?.show();
        } catch (_) {}
    }

    hide() {
        if (this._frameSyncId !== 0) {
            try {
                global.compositor.get_laters().remove(this._frameSyncId);
            } catch (_) {}
            this._frameSyncId = 0;
        }
        try {
            this._bgActor?.hide();
        } catch (_) {}
    }

    _teardown() {
        this.hide();
        try {
            this._effect?.cleanup?.();
        } catch (_) {}
        this._effect = null;
        try {
            this._windowClones?.destroy?.();
        } catch (_) {}
        this._windowClones = null;
        try {
            this._uiSampler?.destroy?.();
        } catch (_) {}
        this._uiSampler = null;
        try {
            this._bgActor?.destroy?.();
        } catch (_) {}
        this._bgActor = null;
        this._liquidBox = null;
        this._cloneContainer = null;
        this._built = false;
    }

    destroy() {
        this._dead = true;
        this._teardown();
        this._target = null;
        this._parentActor = null;
        this._utils = null;
    }
}
