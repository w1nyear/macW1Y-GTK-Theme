// backdropGlass.js — Liquid Glass Rendering Engine for Shell Popups & Dialogs
// Compatible with GNOME-Tahoe Liquid Glass shader & Clutter pipeline.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LiquidEffect } from '../liquidEffect.js';
import {
    UnpickableActor,
    WindowCloneManager,
    UILayerSampler,
    syncGlassCaptureClip,
    ensureGlassAllocated,
    reportFrameLoopError,
    isFrameSyncFrozen
} from '../utils.js';

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

export const BackdropGlass = GObject.registerClass({
    GTypeName: 'MacTahoeBackdropGlass',
}, class BackdropGlass extends UnpickableActor {
    _init({ extensionPath, settings, logger, owner = 'dialog' } = {}) {
        super._init({
            name: 'liquid-glass-bg-actor',
            visible: false,
        });

        this._owner = owner;
        this._settings = settings || lgSettings();
        this._backdropLocked = false;
        this._frameSyncId = 0;
        this._cleanedUp = false;

        this._renderer = {
            uniforms: new Map(),
        };

        // Inner liquid box container with clip to allocation
        this._liquidBox = new UnpickableActor({
            name: 'liquid-box',
            clip_to_allocation: true,
        });
        this.add_child(this._liquidBox);

        // Dummy 1px guard against black frame
        const dummy = new UnpickableActor();
        dummy.set_size(1, 1);
        dummy.set_opacity(0);
        this._liquidBox.add_child(dummy);

        // Clone container for windows
        this._cloneContainer = new UnpickableActor({
            name: `clone-container-${owner}`,
        });
        this._liquidBox.add_child(this._cloneContainer);

        // Liquid Effect instance
        this._effect = new LiquidEffect({
            extensionPath: extensionPath || lgDir(),
            settings: this._settings,
            owner: this._owner,
        });

        // Tahoe default parameters (matching friend's project)
        this._effect.setPadding(20);
        this._effect.setIsDock(false);
        this._effect.setCornerRadius(26.0);
        this._effect.setBlurRadius(8);
        this._effect.setTintColor(0, 0, 0);
        this._effect.setTintStrength(0.05);
        this._effect.setSaturation(1.0);
        this._effect.setBrightness(1.0);
        this._effect.setContrast(1.0);

        try {
            this._effect._setFloat('displacement_scale', 85.0);
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
            `lg-${owner}`
        );
        this._uiSampler = new UILayerSampler(
            this,
            this._liquidBox,
            [this, global.windowGroup, global.window_group],
            this._cloneContainer,
            owner,
            [this]
        );
        this._windowClones.rebuildClones();

        try {
            this._uiSampler?.rebindSelf?.();
        } catch (_) {}

        // Mutual exclusion with other liquid-glass sheets
        try {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                if (child === this) continue;
                const isLiquidBg =
                    child.get_name?.() === 'liquid-glass-bg-actor' ||
                    (typeof child.get_children === 'function' &&
                        child.get_children().some(c => c.get_name?.() === 'liquid-box'));
                if (isLiquidBg) {
                    this._uiSampler?.addExclusion?.(child);
                }
            }
        } catch (_) {}

        this._startTick();
    }

    setIsDock(b) {
        try { this._effect?.setIsDock(b); } catch (_) {}
    }

    setCornerSmoothingEnabled(b) {
        try { this._effect?.setCornerSmoothingEnabled(b); } catch (_) {}
    }

    setCornerRadius(r) {
        try { this._effect?.setCornerRadius(r); } catch (_) {}
    }

    setTintColor(r, g, b) {
        try { this._effect?.setTintColor(r, g, b); } catch (_) {}
    }

    setTintStrength(s) {
        try { this._effect?.setTintStrength(s); } catch (_) {}
    }

    setBrightness(b) {
        try { this._effect?.setBrightness(b); } catch (_) {}
    }

    setSaturation(s) {
        try { this._effect?.setSaturation(s); } catch (_) {}
    }

    setContrast(c) {
        try { this._effect?.setContrast(c); } catch (_) {}
    }

    setBlurRadius(r) {
        try { this._effect?.setBlurRadius(r); } catch (_) {}
    }

    setPadding(p) {
        try { this._effect?.setPadding(p); } catch (_) {}
    }

    setMultiRegionMode(b) {
        try { this._effect?.setMultiRegionMode(b); } catch (_) {}
    }

    setGlassRegions(regions) {
        try { this._effect?.setGlassRegions(regions); } catch (_) {}
    }

    setResolution(w, h) {
        try {
            this._effect?.setResolution(w, h);
            this.set_size(w, h);
            this._liquidBox?.set_size(w, h);
        } catch (_) {}
    }

    forceRefresh(n) {
        try {
            this._uiSampler?.refresh?.();
            this._windowClones?.rebuildClones?.();
        } catch (_) {}
    }

    _startTick() {
        if (this._frameSyncId !== 0) return;
        const tick = () => {
            this._frameSyncId = 0;
            if (this._cleanedUp || !this.visible) return GLib.SOURCE_REMOVE;
            if (isFrameSyncFrozen?.()) {
                this._frameSyncId = global.compositor
                    .get_laters()
                    .add(Meta.LaterType.BEFORE_REDRAW, tick);
                return GLib.SOURCE_REMOVE;
            }
            try {
                ensureGlassAllocated?.(this);
                this._uiSampler?.refresh?.();
                const mon = Main.layoutManager.primaryMonitor;
                const monX = mon?.x ?? 0;
                const monY = mon?.y ?? 0;
                const monW = Math.max(1, mon?.width ?? 1);
                const monH = Math.max(1, mon?.height ?? 1);
                this._windowClones?.setOffset?.(-monX, -monY);
                syncGlassCaptureClip?.({
                    cloneContainer: this._cloneContainer,
                    effect: this._effect,
                    originX: monX,
                    originY: monY,
                    uiSampler: this._uiSampler,
                    windowCloneManager: this._windowClones,
                });
                this._uiSampler?.sync?.(monX, monY, monW, monH);
                this._windowClones?.sync?.();
            } catch (e) {
                reportFrameLoopError?.(`BackdropGlass_${this._owner}`, e);
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

    show() {
        super.show();
        try {
            this._windowClones?.rebuildClones?.();
            this._uiSampler?.refresh?.();
            this._startTick();
        } catch (_) {}
    }

    hide() {
        if (this._frameSyncId !== 0) {
            try {
                global.compositor.get_laters().remove(this._frameSyncId);
            } catch (_) {}
            this._frameSyncId = 0;
        }
        super.hide();
    }

    destroy() {
        this._cleanedUp = true;
        this.hide();
        try { this._effect?.cleanup?.(); } catch (_) {}
        this._effect = null;
        try { this._windowClones?.destroy?.(); } catch (_) {}
        this._windowClones = null;
        try { this._uiSampler?.destroy?.(); } catch (_) {}
        this._uiSampler = null;
        super.destroy();
    }
});
