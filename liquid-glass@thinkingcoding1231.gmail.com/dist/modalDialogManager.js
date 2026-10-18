import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { BackdropGlass } from './rendering/backdropGlass.js';
import { isActorValid } from './actors/lifecycle.js';
import { ensureGlassAllocated } from './actors/allocation.js';
import { setClipIfChanged } from './actors/writes.js';

const GLASS_CLIP_PADDING = 200;
const GLASS_SHADOW_MAX_RADIUS = 180;
const DEFAULT_CORNER_RADIUS = 35.0;

export class ModalDialogManager {
    constructor(extensionPath, settings, logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
        this._dialogStates = new Map();
        this._signals = [];
        this._stageLoopId = 0;
        this._isEffectActive = false;
        this._cornerRadius = DEFAULT_CORNER_RADIUS;
    }

    setup() {
        if (this._isEffectActive) return;
        this._isEffectActive = true;

        this._scanExisting();

        const mg = Main.layoutManager.modalDialogGroup;
        if (mg) {
            this._signals.push({
                target: mg,
                id: mg.connect('child-added', (_group, child) => {
                    this._attachToDialog(child);
                }),
            });
        }

        if (ModalDialog.ModalDialog && !ModalDialog.ModalDialog.prototype._origOpenWithGlass) {
            ModalDialog.ModalDialog.prototype._origOpenWithGlass = ModalDialog.ModalDialog.prototype.open;
            const self = this;
            ModalDialog.ModalDialog.prototype.open = function(...args) {
                self._attachToDialog(this);
                return this._origOpenWithGlass(...args);
            };
        }

        this._stageLoopId = global.stage.connect('before-update', () => {
            this._onBeforeUpdate();
        });

        this._signals.push({
            target: Main.layoutManager,
            id: Main.layoutManager.connect('monitors-changed', () => {
                for (const [_dialog, state] of this._dialogStates) {
                    if (state.glass) {
                        try { state.glass.invalidate(); } catch (_) {}
                    }
                }
            }),
        });

        this._logger?.log('[Liquid Glass] ModalDialogManager setup complete');
    }

    _scanExisting() {
        if (Main.endSessionDialog) {
            this._attachToDialog(Main.endSessionDialog);
        }
        const mg = Main.layoutManager.modalDialogGroup;
        if (mg) {
            for (const child of mg.get_children()) {
                this._attachToDialog(child);
            }
        }
    }

    _attachToDialog(dialogActor) {
        if (!dialogActor || this._dialogStates.has(dialogActor)) return;

        const stack = dialogActor.backgroundStack;
        const dialogBox = dialogActor.dialogLayout?._dialog;
        if (!stack || !dialogBox) return;

        dialogBox.remove_style_class_name('liquid-glass-transparent');
        dialogBox.add_style_class_name('liquid-glass-dialog-box');

        // Remove any old/lingering glass
        for (const child of stack.get_children()) {
            if (child.name === 'liquid-glass-dialog-actor') {
                stack.remove_child(child);
                try { child.destroy(); } catch (_) {}
            }
        }

        const glass = new BackdropGlass({
            extensionPath: this.extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: 'modal-dialog',
        });
        glass.name = 'liquid-glass-dialog-actor';
        glass.set_pivot_point(0, 0);

        stack.insert_child_below(glass, dialogActor.dialogLayout);

        glass.setCornerRadius(this._cornerRadius);
        glass.setIsDock(false);
        glass.setPadding(0);
        glass.setBlurRadius(15.0);
        glass.setBrightness(1.05);
        glass.setContrast(1.0);
        glass.setSaturation(1.4);
        glass.setTintColor(1.0, 1.0, 1.0);
        glass.setTintStrength(0.18);
        glass.setSurfaceLightEnabled(true);
        glass.hide();

        const state = {
            dialogActor,
            dialogBox,
            glass,
            lastX: undefined,
            lastY: undefined,
            lastW: undefined,
            lastH: undefined,
        };

        const destroyId = dialogActor.connect('destroy', () => {
            this._detachFromDialog(dialogActor);
        });
        state.destroyId = destroyId;

        this._dialogStates.set(dialogActor, state);
    }

    _detachFromDialog(dialogActor) {
        const state = this._dialogStates.get(dialogActor);
        if (!state) return;
        this._dialogStates.delete(dialogActor);

        if (state.dialogBox) {
            try { state.dialogBox.remove_style_class_name('liquid-glass-dialog-box'); } catch (_) {}
        }
        if (state.destroyId) {
            try { dialogActor.disconnect(state.destroyId); } catch (_) {}
        }
        if (state.glass) {
            try {
                state.glass.cleanup();
                state.glass.destroy();
            } catch (_) {}
        }
    }

    _onBeforeUpdate() {
        if (this._dialogStates.size === 0) return;

        for (const [dialogActor, state] of this._dialogStates) {
            this._syncDialog(state);
        }
    }

    _syncDialog(state) {
        const { dialogActor, dialogBox, glass } = state;
        if (!isActorValid(dialogActor) || !isActorValid(dialogBox) || !isActorValid(glass)) return;

        const isOpeningOrOpen = dialogActor.visible && dialogActor.mapped && dialogActor.opacity > 0;
        if (!isOpeningOrOpen) {
            if (glass.visible) glass.hide();
            return;
        }

        ensureGlassAllocated(glass);
        if (!glass.visible) glass.show();
        glass.opacity = dialogActor.opacity;

        let monitorIndex = dialogActor._monitorConstraint?.index ?? -1;
        if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();
        let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
        let monitorX = monitor?.x ?? 0;
        let monitorY = monitor?.y ?? 0;
        let screenW = Math.max(1, monitor?.width ?? 1);
        let screenH = Math.max(1, monitor?.height ?? 1);

        const [diagAbsX, diagAbsY] = dialogBox.get_transformed_position();
        const [w, h] = dialogBox.get_size();

        if (Number.isNaN(diagAbsX) || Number.isNaN(diagAbsY) || w <= 1 || h <= 1) return;

        const localBgX = Math.round(diagAbsX - monitorX);
        const localBgY = Math.round(diagAbsY - monitorY);
        const bgW = Math.round(w);
        const bgH = Math.round(h);

        glass.set_position(0, 0);
        glass.set_size(screenW, screenH);

        if (state.lastX !== localBgX || state.lastY !== localBgY || state.lastW !== bgW || state.lastH !== bgH) {
            state.lastX = localBgX;
            state.lastY = localBgY;
            state.lastW = bgW;
            state.lastH = bgH;

            setClipIfChanged(glass, localBgX - GLASS_CLIP_PADDING, localBgY - GLASS_CLIP_PADDING, bgW + GLASS_CLIP_PADDING * 2, bgH + GLASS_CLIP_PADDING * 2);
            glass.setShadowMaxRadius(GLASS_SHADOW_MAX_RADIUS);
            glass.setResolution(screenW, screenH);
            glass.setPadding(0);
            glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);
            glass.setCornerRadius(this._cornerRadius);
        }

        glass.syncSources();
    }

    cleanup() {
        this._isEffectActive = false;
        if (this._stageLoopId) {
            global.stage.disconnect(this._stageLoopId);
            this._stageLoopId = 0;
        }
        for (const s of this._signals) {
            try { s.target.disconnect(s.id); } catch (_) {}
        }
        this._signals = [];

        if (ModalDialog.ModalDialog && ModalDialog.ModalDialog.prototype._origOpenWithGlass) {
            ModalDialog.ModalDialog.prototype.open = ModalDialog.ModalDialog.prototype._origOpenWithGlass;
            delete ModalDialog.ModalDialog.prototype._origOpenWithGlass;
        }

        for (const [dialogActor, state] of this._dialogStates) {
            this._detachFromDialog(dialogActor);
        }
        this._dialogStates.clear();
    }
}
