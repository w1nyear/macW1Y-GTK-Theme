


import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { LiquidEffect } from '../liquidEffect.js?v=fix3';
import {
    UnpickableActor,
    WindowCloneManager,
    UILayerSampler,
    syncGlassCaptureClip,
    ensureGlassAllocated,
    reportFrameLoopError,
    isFrameSyncFrozen,
    glassRefreshDue,
    glassRefreshDone,
    glassForceRefresh,
    addGlassWakeListener,
    removeGlassWakeListener,
    isActorNearGlass
} from '../utils.js?v=fix4';

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

function _registerBackdropGlass(cls) {
    if (globalThis.__LiquidGlass_classes?.BackdropGlass) return globalThis.__LiquidGlass_classes.BackdropGlass;
    if (!globalThis.__LiquidGlass_classes) globalThis.__LiquidGlass_classes = {};
    try {
        return (globalThis.__LiquidGlass_classes.BackdropGlass = GObject.registerClass({ GTypeName: 'macW1YBackdropGlass' }, cls));
    } catch (_) {
        return (globalThis.__LiquidGlass_classes.BackdropGlass = GObject.registerClass({ GTypeName: 'macW1YBackdropGlass_' + Date.now() }, cls));
    }
}

export const BackdropGlass = _registerBackdropGlass(class BackdropGlass extends UnpickableActor {
    _init({ extensionPath, settings, logger, owner = 'dialog', excludeActors = [] } = {}) {
        super._init({
            name: 'liquid-glass-bg-actor',
            visible: false,
        });
        this.set_clip(0, 0, 0, 0);

        this._owner = owner;
        this._settings = settings || lgSettings();
        this._backdropLocked = false;
        this._frameSyncId = 0;
        this._cleanedUp = false;

        this._renderer = {
            uniforms: new Map(),
        };


        this._liquidBox = new UnpickableActor({
            name: 'liquid-box',
            clip_to_allocation: true,
        });
        this.add_child(this._liquidBox);


        const dummy = new UnpickableActor();
        dummy.set_size(1, 1);
        dummy.set_opacity(0);
        this._liquidBox.add_child(dummy);


        this._cloneContainer = new UnpickableActor({
            name: `clone-container-${owner}`,
        });
        this._liquidBox.add_child(this._cloneContainer);


        this._effect = new LiquidEffect({
            extensionPath: extensionPath || lgDir(),
            settings: lgSettings() || this._settings,
            owner: this._owner,
        });


        this._effect.setPadding(20);
        this._effect.setIsDock(false);
        this._effect.setCornerRadius(26.0);
        this._effect.setBlurRadius(8);
        this._effect.setTintColor(0, 0, 0);
        this._effect.setTintStrength(0.02);
        this._effect.setSaturation(1.0);
        this._effect.setBrightness(1.0);
        this._effect.setContrast(1.0);

        this._liquidBox.add_effect(this._effect);

        const mon = Main.layoutManager.primaryMonitor;
        const monX = mon?.x ?? 0;
        const monY = mon?.y ?? 0;
        const monW = Math.max(1, mon?.width ?? 1920);
        const monH = Math.max(1, mon?.height ?? 1080);
        this.set_position(monX, monY);
        this.set_size(monW, monH);
        this.setResolution(monW, monH);

        this._windowClones = new WindowCloneManager(
            this._liquidBox,
            this._cloneContainer,
            `lg-${owner}`
        );
        const baseExclusions = [this, global.windowGroup, global.window_group];
        if (Array.isArray(excludeActors)) {
            for (const a of excludeActors) {
                if (a && !baseExclusions.includes(a)) baseExclusions.push(a);
            }
        }
        if (owner === 'notification-banner' || owner === 'notification') {
            if (Main.messageTray && !baseExclusions.includes(Main.messageTray)) {
                baseExclusions.push(Main.messageTray);
            }
            if (Main.messageTray?._bannerBin && !baseExclusions.includes(Main.messageTray._bannerBin)) {
                baseExclusions.push(Main.messageTray._bannerBin);
            }
        }

        this._uiSampler = new UILayerSampler(
            this,
            this._liquidBox,
            baseExclusions,
            this._cloneContainer,
            owner,
            baseExclusions
        );
        if (Array.isArray(excludeActors)) {
            for (const a of excludeActors) {
                if (a) {
                    try { this._uiSampler.addExclusion(a); } catch (_) {}
                }
            }
        }
        if (owner === 'notification-banner' || owner === 'notification') {
            try {
                if (Main.messageTray) this._uiSampler.addExclusion(Main.messageTray);
                if (Main.messageTray?._bannerBin) this._uiSampler.addExclusion(Main.messageTray._bannerBin);
            } catch (_) {}
        }
        this._windowClones.rebuildClones();

        try {
            this._uiSampler?.rebindSelf?.();
        } catch (_) {}


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

        this._wakeUnsub = (damagedActor, reason) => {
            if (this._cleanedUp || !this.visible) return;
            if (['restacked', 'fullscreen', 'overview', 'layout', 'overview-scroll', 'overview-transition'].includes(reason)) {
                glassForceRefresh?.(this);
                try { this._windowClones?.rebuildClones?.(); } catch (_) {}
                try { this._uiSampler?.rebindSelf?.(); } catch (_) {}
                try { this._uiSampler?.refresh?.(); } catch (_) {}
                try { this._effect?.markBackdropDirty?.(); } catch (_) {}
            }
            if (!damagedActor || isActorNearGlass(damagedActor, this) || Main.overview?.visible) {
                this._effect?.markBackdropDirty?.();
                this.wakeFrameSync?.();
            }
        };
        addGlassWakeListener?.(this._wakeUnsub);
        this._startTick();
    }

    get effect() {
        return this._effect;
    }

    getResolution() {
        return this._effect?.getResolution?.() ?? [this.width, this.height];
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
        try {
            this._effect?.setGlassRegions(regions);
            if (Array.isArray(regions) && regions.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const r of regions) {
                    if (!r) continue;
                    minX = Math.min(minX, r.x ?? 0);
                    minY = Math.min(minY, r.y ?? 0);
                    maxX = Math.max(maxX, (r.x ?? 0) + (r.w ?? 0));
                    maxY = Math.max(maxY, (r.y ?? 0) + (r.h ?? 0));
                }
                if (Number.isFinite(minX) && maxX > minX) {
                    const P = 32;
                    const cX = Math.max(0, Math.floor(minX - P));
                    const cY = Math.max(0, Math.floor(minY - P));
                    const cW = Math.max(1, Math.ceil(maxX - minX + 2 * P));
                    const cH = Math.max(1, Math.ceil(maxY - minY + 2 * P));
                    this.set_clip(cX, cY, cW, cH);
                    this._windowClones?.applyBgCloneClip?.([cX, cY, cW, cH]);
                }
            } else if (Array.isArray(regions) && regions.length === 0) {
                this.set_clip(0, 0, 0, 0);
                this._windowClones?.applyBgCloneClip?.(null);
            }
        } catch (_) {}
    }

    setResolution(w, h) {
        try {
            this._effect?.setResolution(w, h);
            this.set_size(w, h);
            this._liquidBox?.set_size(w, h);
            this.wakeFrameSync();
        } catch (_) {}
    }

    setGlassGeometry(x, y, w, h) {
        try {
            this._effect?.setGlassGeometry(x, y, w, h);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
                const P = 32;
                const cX = Math.max(0, Math.floor(x - P));
                const cY = Math.max(0, Math.floor(y - P));
                const cW = Math.max(1, Math.ceil(w + 2 * P));
                const cH = Math.max(1, Math.ceil(h + 2 * P));
                this.set_clip(cX, cY, cW, cH);
                this._windowClones?.applyBgCloneClip?.([cX, cY, cW, cH]);
            }
            this.wakeFrameSync();
        } catch (_) {}
    }

    addExclusion(actor) {
        try {
            if (actor) {
                this._uiSampler?.addExclusion(actor);
            }
        } catch (_) {}
    }

    syncSources() {
        try {
            this._uiSampler?.refresh?.();
            this._windowClones?.rebuildClones?.();
            glassForceRefresh?.(this);
            this.wakeFrameSync();
        } catch (_) {}
    }

    forceRefresh(n) {
        try {
            this._uiSampler?.refresh?.();
            this._windowClones?.rebuildClones?.();
            glassForceRefresh?.(this);
            this.wakeFrameSync();
        } catch (_) {}
    }

    wakeFrameSync() {
        this._idleCount = 0;
        if (this._idleTimeoutId) {
            GLib.source_remove(this._idleTimeoutId);
            this._idleTimeoutId = 0;
        }
        if (this._frameSyncId === 0 && !this._cleanedUp && this.visible) {
            this._startTick();
        }
    }

    _scheduleIdleHeartbeat() {
        if (this._idleTimeoutId || this._cleanedUp || !this.visible)
            return;
        const intervalMs = Main.overview?.visible ? 150 : 1500;
        this._idleTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
            this._idleTimeoutId = 0;
            if (this._cleanedUp || !this.visible)
                return GLib.SOURCE_REMOVE;
            let drifted = false;
            try {
                drifted = Main.overview?.visible || isBackdropDirtyOrChanged?.(this);
            } catch (_) {
                drifted = true;
            }
            if (drifted) {
                this._effect?.markBackdropDirty?.();
                this.wakeFrameSync();
            } else {
                this._scheduleIdleHeartbeat();
            }
            return GLib.SOURCE_REMOVE;
        });
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



            let doHeavy = true;
            if (this._backdropLocked) {
                doHeavy = false;
            } else {
                try {
                    doHeavy = glassRefreshDue?.(this);
                } catch (_) {
                    doHeavy = true;
                }
            }
            try {
                ensureGlassAllocated?.(this);
                if (doHeavy) {
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
                    this._effect?.markBackdropDirty?.();
                    glassRefreshDone?.(this);
                }
            } catch (e) {
                reportFrameLoopError?.(`BackdropGlass_${this._owner}`, e);
            }


            if (doHeavy || Main.overview?.visible) {
                this._idleCount = 0;
            } else {
                this._idleCount = (this._idleCount || 0) + 1;
            }
            if (this._idleCount < 8 || Main.overview?.visible) {
                this._frameSyncId = global.compositor
                    .get_laters()
                    .add(Meta.LaterType.BEFORE_REDRAW, tick);
            } else {
                this._frameSyncId = 0;
                this._scheduleIdleHeartbeat();
            }
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
        const mon = Main.layoutManager.primaryMonitor;
        const monW = Math.max(1, mon?.width ?? 1920);
        const monH = Math.max(1, mon?.height ?? 1080);
        this.setResolution(monW, monH);
        super.show();
        try {
            this._effect?.markBackdropDirty?.();
            this._windowClones?.rebuildClones?.();
            this._uiSampler?.refresh?.();
            glassForceRefresh?.(this);
            this.wakeFrameSync();
        } catch (_) {}
    }

    hide() {
        if (this._idleTimeoutId) {
            GLib.source_remove(this._idleTimeoutId);
            this._idleTimeoutId = 0;
        }
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
        if (this._wakeUnsub) {
            removeGlassWakeListener?.(this._wakeUnsub);
            this._wakeUnsub = null;
        }
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
