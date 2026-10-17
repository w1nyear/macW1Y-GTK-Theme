import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import { BackdropGlass } from './rendering/backdropGlass.js';
import { startStageLoop, stopStageLoop } from './animation/frameLoops.js';
import { isActorValid } from './actors/lifecycle.js';
import { hexToColorArray } from './animation/colors.js';
import { setClipIfChanged } from './actors/writes.js';

const SHADER_PADDING = 20;

export class TooltipManager {
    constructor(extensionPath, settings, logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
        this.glass = null;
        this._frameSignalId = 0;
        this._frameSyncId = 0;
        this._activeTooltip = null;
        this._trackedActors = new Set();
        this._actorSignals = new Map();
        this._uiChildAddedId = 0;
        this._monitorsChangedId = 0;
        this._lastGeom = { x: null, y: null, w: null, h: null, opacity: null };
    }

    setup() {
        this._createGlass();

        // Scan existing children of uiGroup
        for (const child of Main.layoutManager.uiGroup.get_children()) {
            this._checkActor(child);
        }

        // Watch for dynamically added labels
        this._uiChildAddedId = Main.layoutManager.uiGroup.connect('child-added', (_group, child) => {
            this._checkActor(child);
        });

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            if (this.glass && this._activeTooltip) {
                this._syncGeometry(this._activeTooltip, true);
            }
        });
    }

    _createGlass() {
        if (this.glass) return;

        const glass = new BackdropGlass({
            extensionPath: this.extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: 'tooltip',
        });
        glass.set_size(1.0, 1.0);
        glass.set_pivot_point(0.0, 0.0);
        glass.hide();

        Main.layoutManager.uiGroup.add_child(glass);
        this.glass = glass;

        this._applyGlassParameters();
    }

    _applyGlassParameters() {
        if (!this.glass) return;

        this.glass.setPadding(0);
        this.glass.setTintColor(0.0, 0.0, 0.0);
        this.glass.setTintStrength(0.05); // LQ-Visual: 5% tint
        this.glass.setCornerRadius(9999.0);
        this.glass.setIsDock(true); // Dock mode eliminates dark drop shadow
        this.glass.setBrightness(1.0);
        this.glass.setSaturation(1.0);
        this.glass.setContrast(1.0);
        this.glass.setBlurRadius(3.0); // LQ-Visual: 3px blur
        try {
            this.glass._renderer.uniforms.set('shadow_intensity', 0.0);
            this.glass._renderer.uniforms.set('shadow_radius', 0.0);
            this.glass._renderer.uniforms.set('shadow_max_radius', 0.0);
        } catch (_) {}
    }

    _isTooltipActor(actor) {
        if (!actor || !isActorValid(actor)) return false;
        if (typeof actor.has_style_class_name !== 'function') return false;

        return actor.has_style_class_name('dash-label') ||
               actor.has_style_class_name('tooltip') ||
               actor.has_style_class_name('screenshot-ui-tooltip');
    }

    _checkActor(actor) {
        if (!this._isTooltipActor(actor)) return;
        if (this._trackedActors.has(actor)) return;

        this._trackedActors.add(actor);
        const signals = [];

        const onStateChanged = () => {
            if (!isActorValid(actor)) {
                this._untrackActor(actor);
                return;
            }

            if (actor.visible) {
                if (this._activeTooltip !== actor) {
                    this._activeTooltip = actor;
                    this._restackGlassBelow(actor);
                }
                this._startLoop();
                this._syncGeometry(actor);
            } else if (this._activeTooltip === actor && !actor.visible) {
                this._activeTooltip = null;
                this._hideGlass();
            }
        };

        signals.push(actor.connect('notify::visible', onStateChanged));
        signals.push(actor.connect('notify::opacity', onStateChanged));
        signals.push(actor.connect('notify::position', onStateChanged));
        signals.push(actor.connect('notify::allocation', onStateChanged));
        signals.push(actor.connect('destroy', () => this._untrackActor(actor)));

        this._actorSignals.set(actor, signals);

        // If it's already visible when registered
        if (actor.visible) {
            onStateChanged();
        }
    }

    _untrackActor(actor) {
        this._trackedActors.delete(actor);
        const signals = this._actorSignals.get(actor);
        if (signals) {
            signals.forEach(id => {
                try { actor.disconnect(id); } catch (_) {}
            });
            this._actorSignals.delete(actor);
        }
        if (this._activeTooltip === actor) {
            this._activeTooltip = null;
            this._hideGlass();
        }
    }

    _restackGlassBelow(actor) {
        if (!this.glass || !actor) return;
        let root = actor;
        while (root.get_parent() && root.get_parent() !== Main.layoutManager.uiGroup) {
            const p = root.get_parent();
            if (!p) break;
            root = p;
        }

        try {
            if (root.get_parent() === Main.layoutManager.uiGroup) {
                Main.layoutManager.uiGroup.set_child_below_sibling(this.glass, root);
            }
        } catch (_) {}
    }

    _startLoop() {
        if (this._frameSignalId) return;
        this._frameSignalId = global.stage.connect('before-update', () => {
            if (this._activeTooltip && this._activeTooltip.visible) {
                this._syncGeometry(this._activeTooltip);
            } else {
                this._stopLoop();
            }
        });
    }

    _stopLoop() {
        if (this._frameSignalId) {
            global.stage.disconnect(this._frameSignalId);
            this._frameSignalId = 0;
        }
    }

    _hideGlass() {
        if (this.glass && this.glass.visible) {
            this.glass.hide();
        }
        this._stopLoop();
        this._lastGeom = { x: null, y: null, w: null, h: null, opacity: null };
    }

    _syncGeometry(actor, force = false) {
        if (!this.glass || !actor || !isActorValid(actor) || !actor.visible) {
            this._hideGlass();
            return;
        }

        const opacity = actor.opacity;
        if (opacity <= 0) {
            this.glass.opacity = 0;
            return;
        }

        let [w, h] = actor.get_size();
        let box = actor.get_allocation_box();
        let allocW = box.get_width();
        let allocH = box.get_height();
        if (allocW > 0 && allocH > 0) {
            w = allocW;
            h = allocH;
        }
        if (w <= 0 || h <= 0) {
            let [minW, natW] = actor.get_preferred_width(-1);
            let [minH, natH] = actor.get_preferred_height(natW);
            w = natW;
            h = natH;
        }
        if (w <= 0 || h <= 0) return;

        let absX = actor.x;
        let absY = actor.y;
        let [tx, ty] = actor.get_transformed_position();
        if (tx !== null && !Number.isNaN(tx) && ty !== null && !Number.isNaN(ty)) {
            absX = tx;
            absY = ty;
        }

        let monitorIndex = Main.layoutManager.findIndexForActor(actor);
        if (monitorIndex < 0) monitorIndex = Main.layoutManager.primaryIndex;
        let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
        let monitorX = monitor?.x ?? 0;
        let monitorY = monitor?.y ?? 0;
        let screenW = Math.max(1, monitor?.width ?? 1920);
        let screenH = Math.max(1, monitor?.height ?? 1080);

        let localBgX = Math.round(absX - monitorX);
        let localBgY = Math.round(absY - monitorY);
        let bgW = Math.round(w);
        let bgH = Math.round(h);
        let radius = Math.round(h / 2.0);

        if (!this.glass.visible) {
            this.glass.show();
        }
        this.glass.opacity = opacity;

        this.glass.set_position(monitorX, monitorY);
        this.glass.set_size(screenW, screenH);
        this.glass.setResolution(screenW, screenH);
        this.glass.setCornerRadius(radius);
        this.glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);

        const allocBox = new Clutter.ActorBox();
        allocBox.x1 = monitorX;
        allocBox.y1 = monitorY;
        allocBox.x2 = monitorX + screenW;
        allocBox.y2 = monitorY + screenH;
        this.glass.allocate(allocBox);

        const CLIP_PAD = 10;
        setClipIfChanged(
            this.glass,
            localBgX - CLIP_PAD, localBgY - CLIP_PAD,
            bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2
        );

        this.glass.syncSources();
    }

    get _frameSlot() {
        return { get: () => this._frameSyncId, set: (id) => { this._frameSyncId = id; } };
    }

    get _frameSignalSlot() {
        return { get: () => this._frameSignalId, set: (id) => { this._frameSignalId = id; } };
    }

    cleanup() {
        this._stopLoop();

        if (this._uiChildAddedId) {
            Main.layoutManager.uiGroup.disconnect(this._uiChildAddedId);
            this._uiChildAddedId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        for (const [actor, signals] of this._actorSignals.entries()) {
            signals.forEach(id => {
                try { actor.disconnect(id); } catch (_) {}
            });
        }
        this._actorSignals.clear();
        this._trackedActors.clear();
        this._activeTooltip = null;

        if (this.glass) {
            this.glass.destroy();
            this.glass = null;
        }
    }
}
