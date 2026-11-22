
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { LiquidEffect } from './liquidEffect.js?v=fix3';
import { UnpickableActor, UILayerSampler, WindowCloneManager, reportFrameLoopError, ensureGlassAllocated, isFrameSyncFrozen, setClipIfChanged, syncGlassCaptureClip } from './utils.js?v=fix4';
import { glassRefreshDue, glassRefreshDone, glassForceRefresh, isBackdropDirtyOrChanged, addGlassWakeListener, removeGlassWakeListener, isActorNearGlass, hookWindowDamage } from './glassGate.js?v=fix4';

const SHADER_PADDING = 20;




function _dockGlassExtras(localBgX, localBgY, bgW, bgH, screenW, screenH) {
    const q = (v) => Number.isFinite(v) ? Math.round(v * 4) | 0 : 0;
    return ((q(localBgX) * 73856093) ^ (q(localBgY) * 19349663) ^
        (q(bgW) * 83492791) ^ (q(bgH) * 2654435761) ^
        ((screenW | 0) * 1274126177) ^ ((screenH | 0) * 1550398307)) | 0;
}

function hexToColorArray(hex) {
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
        return [1.0, 1.0, 1.0];
    }
    let r = parseInt(hex.slice(1, 3), 16) / 255.0;
    let g = parseInt(hex.slice(3, 5), 16) / 255.0;
    let b = parseInt(hex.slice(5, 7), 16) / 255.0;
    return [r, g, b];
}
export class DashManager {
    extensionPath;
    targetActor;
    _settings;

    bgActor = null;

    effect = null;




    liquidBox = null;
    _lastScreenW;
    _lastScreenH;
    _glassExpand;
    _signals;
    _settingsSignals;
    _frameSyncId;



    _torndown = false;
    _isEffectActive;
    _originalStyle;
    _currentMarginStyle;
    _dockParent = null;
    _cloneContainer = null;
    _lastAbsX;
    _lastAbsY;
    _lastTW;
    _lastTH;
    _stableDeltaW;
    _stableDeltaH;
    _lastBgW;
    _lastBgH;
    _lastBgX;
    _lastBgY;
    _lastBaseW;
    _lastBaseH;
    _lastRestingAbsX;
    _lastRestingAbsY;
    _lastRestingBaseW;
    _lastRestingBaseH;
    _outputLogs = false;
    _marginValue = 0;

    _lastHidden;
    _uiSampler = null;
    _windowCloneManager = null;
    _logger;

    constructor(extensionPath, targetActor, settings, logger) {
        this.extensionPath = extensionPath;
        this.targetActor = targetActor;
        this._settings = settings;
        this._logger = logger;
        this._glassExpand = 0;
        this._signals = [];
        this._settingsSignals = [];
        this._frameSyncId = 0;
        this._isEffectActive = false;
    }

    setup() {
        if (!this.targetActor || !this._settings)
            return;
        global._liquidGlassDockSync = () => {
            this.wakeFrameSync();
            this._syncGeometry();
        };
        if (Main.screenshotUI) {
            this._signals.push(Main.screenshotUI.connect('notify::visible', () => {
                if (!Main.screenshotUI.visible) {
                    this.wakeFrameSync();
                }
            }));
        }

        this._bindSettings();

        if (this._settings.get_boolean('enable-dock-glass')) {
            this._applyEffect();
            this._restackGlass();
        }
    }

    _bindSettings() {
        const connectSetting = (key, callback) => {
            let id = this._settings.connect(`changed::${key}`, callback.bind(this));
            this._settingsSignals.push(id);
        };

        connectSetting('enable-dock-glass', () => {
            let enabled = this._settings.get_boolean('enable-dock-glass');
            if (enabled && !this._isEffectActive) {
                this._applyEffect();
            }
            else if (!enabled && this._isEffectActive) {
                this._removeEffect();
            }
        });
        connectSetting('dock-glass-expand', () => {
            if (this.effect && this._isEffectActive) {
                this._glassExpand = this._settings.get_int('dock-glass-expand');
            }
        });

        connectSetting('dock-margin-bottom', () => {
            if (this._isEffectActive)
                this._applyMargin();
            this._marginValue = this._settings.get_int('dock-margin-bottom') || 0;
        });

        connectSetting('dock-tint-color', () => {
            if (this.effect && this._isEffectActive) {
                let colorArray = hexToColorArray(this._settings.get_string('dock-tint-color'));
                this.effect.setTintColor(...colorArray);
            }
        });
        connectSetting('dock-tint-strength', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setTintStrength(this._settings.get_double('dock-tint-strength'));
            }
        });
        connectSetting('dock-blur-radius', () => {
            const radius = this._settings.get_int('dock-blur-radius');
            if (this.effect && this._isEffectActive)
                this.effect.setBlurRadius(radius);
        });
        connectSetting('dock-corner-radius', () => {
            this._applyAdaptiveRadius();
        });
        connectSetting('output-logs', () => {
            this._outputLogs = this._settings.get_boolean('output-logs');
        });
        connectSetting('dock-brightness', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setBrightness(this._settings.get_double('dock-brightness'));
            }
        });
        connectSetting('dock-contrast', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setContrast(this._settings.get_double('dock-contrast'));
            }
        });
        connectSetting('dock-saturation', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setSaturation(this._settings.get_double('dock-saturation'));
            }
        });
    }

    _applyMargin() {
        if (!this.targetActor)
            return;
        let marginBottom = this._settings.get_int('dock-margin-bottom');
        let [w, h] = this.targetActor.get_size();
        let [x, y] = this.targetActor.get_transformed_position();
        let monitorIndex = Main.layoutManager.findIndexForActor(this.targetActor);
        if (monitorIndex < 0)
            monitorIndex = Main.layoutManager.primaryIndex;
        let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

        let distLeft = x - monitor.x;
        let distRight = (monitor.x + monitor.width) - (x + w);
        let distTop = y - monitor.y;
        let distBottom = (monitor.y + monitor.height) - (y + h);
        let minEdge = Math.min(distLeft, distRight, distTop, distBottom);
        let marginStyle = '';
        if (minEdge === distBottom || minEdge === distTop) {
            if (minEdge === distBottom) {
                marginStyle = `margin-bottom: ${marginBottom}px;`;
            }
            else {
                marginStyle = `margin-top: ${marginBottom}px;`;
            }
        }
        else {
            if (minEdge === distRight) {
                marginStyle = `margin-right: ${marginBottom}px;`;
            }
            else {
                marginStyle = `margin-left: ${marginBottom}px;`;
            }
        }
        if (this._originalStyle === undefined) {
            this._originalStyle = this.targetActor.get_style() || '';
        }
        this._currentMarginStyle = marginStyle;
        this.targetActor.set_style(`${this._originalStyle} ${marginStyle}`);
    }



    _scheduleMarginReconcile() {
        this._cancelMarginReconcile();
        const reapply = () => {
            if (!this._isEffectActive)
                return GLib.SOURCE_REMOVE;
            try {
                this._applyMargin();
            } catch (e) {

            }
            return GLib.SOURCE_REMOVE;
        };
        this._marginRetryIds = [
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, reapply),
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6000, reapply),
        ];
        try {
            this._layoutSignals = [
                Main.layoutManager.connect('startup-complete', reapply),
                Main.layoutManager.connect('monitors-changed', reapply),
            ];
        } catch (e) {
            this._layoutSignals = null;
        }
    }

    _cancelMarginReconcile() {
        if (this._marginRetryIds) {
            for (const id of this._marginRetryIds) {
                try {
                    GLib.source_remove(id);
                } catch (e) {

                }
            }
            this._marginRetryIds = null;
        }
        if (this._layoutSignals) {
            for (const id of this._layoutSignals) {
                try {
                    Main.layoutManager.disconnect(id);
                } catch (e) {

                }
            }
            this._layoutSignals = null;
        }
    }



    _applyAdaptiveRadius() {
        if (!this.effect || !this._isEffectActive || !this.targetActor)
            return;
        try {
            const configured = this._settings.get_double('dock-corner-radius');
            const [, h] = this.targetActor.get_size();
            let radius = configured;
            if (h > 0)
                radius = Math.min(configured, Math.max(6, h * 0.33));
            this.effect.setCornerRadius(radius);
        } catch (e) {

        }
    }

    _restackGlass() {
        const uiGroup = Main.layoutManager.uiGroup;
        let dockRoot = this.targetActor;
        while (dockRoot && dockRoot.get_parent() !== uiGroup) {
            let p = dockRoot.get_parent();
            if (!p)
                break;
            dockRoot = p;
        }
        if (!this.bgActor || !dockRoot || dockRoot.get_parent() !== uiGroup)
            return;
        if (this.bgActor.get_parent() !== uiGroup)
            return;
        const children = uiGroup.get_children();
        const rootIndex = children.indexOf(dockRoot);
        const bgIndex = children.indexOf(this.bgActor);
        if (rootIndex < 0 || bgIndex < 0)
            return;
        if (bgIndex !== rootIndex - 1) {
            uiGroup.set_child_below_sibling(this.bgActor, dockRoot);
        }
    }

    _applyEffect() {
        if (this._isEffectActive)
            return;
        this._isEffectActive = true;
        this.targetActor.add_style_class_name('liquid-glass-transparent');
        this._dockParent = this.targetActor.get_parent();
        if (this._dockParent) {
            this._dockParent.add_style_class_name('liquid-glass-transparent');
        }
        this.bgActor = new UnpickableActor();
        this.bgActor.set_name('liquid-glass-bg-actor');
        this.bgActor.set_size(1.0, 1.0);



        this.liquidBox = new UnpickableActor();
        this.liquidBox.set_name("liquid-box");
        this.liquidBox.set_clip_to_allocation(true);
        this.bgActor.add_child(this.liquidBox);

        let dummyBreaker = new UnpickableActor();
        dummyBreaker.set_name("optimization-breaker");
        dummyBreaker.set_size(1.0, 1.0);
        dummyBreaker.set_opacity(0);
        this.liquidBox.add_child(dummyBreaker);



        this._cloneContainer = new UnpickableActor();
        this._cloneContainer.set_name("clone-container");
        this.liquidBox.add_child(this._cloneContainer);

        this._applyMargin();
        this._scheduleMarginReconcile();
        this._marginValue = this._settings.get_int('dock-margin-bottom');
        this._glassExpand = this._settings.get_int("dock-glass-expand");
        this._outputLogs = this._settings.get_boolean('output-logs');
        let dockRoot = this.targetActor;
        while (dockRoot && dockRoot.get_parent() !== Main.layoutManager.uiGroup) {
            let p = dockRoot.get_parent();
            if (!p)
                break;
            dockRoot = p;
        }
        if (dockRoot && dockRoot.get_parent() === Main.layoutManager.uiGroup) {
            Main.layoutManager.uiGroup.insert_child_below(this.bgActor, dockRoot);
        }
        else {
            Main.layoutManager.uiGroup.add_child(this.bgActor);
        }
        this._restackGlass();

        let blurRadius = this._settings.get_int('dock-blur-radius');
        let tintColorStr = this._settings.get_string('dock-tint-color');
        let tintStrength = this._settings.get_double('dock-tint-strength');
        let cornerRadius = this._settings.get_double('dock-corner-radius');
        let brightness = this._settings.get_double('dock-brightness');
        let contrast = this._settings.get_double('dock-contrast');
        let saturation = this._settings.get_double('dock-saturation');
        this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, logger: this._logger, owner: 'dock' });
        this.effect.setPadding(SHADER_PADDING);
        this.effect.setTintColor(...hexToColorArray(tintColorStr));
        this.effect.setTintStrength(tintStrength);
        this._applyAdaptiveRadius();
        this.effect.setBrightness(brightness);
        this.effect.setContrast(contrast);
        this.effect.setSaturation(saturation);
        this.effect.setBlurRadius(blurRadius);
        this.effect.setIsDock(true);
        this.liquidBox.add_effect(this.effect);

        this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-dock');






        this._uiSampler = new UILayerSampler(this.bgActor, this.liquidBox, [dockRoot, global.windowGroup, global.window_group], this._cloneContainer, 'dock', [this.targetActor]);
        this.bgActor.show();
        glassForceRefresh?.(this.bgActor);
        const laterAdd = (laterType, callback) => {
            return global.compositor.get_laters().add(laterType, callback);
        };
        const frameLaterType = Meta.LaterType.BEFORE_REDRAW;

        let buildClones = () => {
            if (!this.bgActor)
                return;

            if (this._uiSampler) {
                for (let child of Main.layoutManager.uiGroup.get_children()) {
                    if (child === this.bgActor)
                        continue;


                    let isLiquidBg = child.name === 'liquid-glass-bg-actor' ||
                        (typeof child.get_children === 'function' &&
                            child.get_children().some(c => c.name === 'liquid-box'));
                    if (isLiquidBg || child.name === 'iconsContainer' || child.name === 'Dummy Cursor' || child._delegate?.app || child.app) {
                        this._uiSampler.addExclusion(child);
                    }
                }
            }
            this._windowCloneManager?.rebuildClones();
            this._uiSampler?.rebindSelf();
            this._uiSampler?.refresh();


            glassForceRefresh?.(this.bgActor);
        };








        let frameTick = () => {
            this._frameSyncId = 0;









            if (this._torndown)
                return GLib.SOURCE_REMOVE;
            if (!this.bgActor || !this.targetActor.mapped)
                return GLib.SOURCE_REMOVE;


            if (isFrameSyncFrozen()) {
                this._frameSyncId = laterAdd(frameLaterType, frameTick);
                return GLib.SOURCE_REMOVE;
            }




            ensureGlassAllocated(this.bgActor);
            let didRefresh = false;
            try {
                didRefresh = !!this._syncGeometry();
            }
            catch (e) {
                reportFrameLoopError('DockManager', e);
            }
            if (didRefresh || Main.overview?.visible) {
                this._idleCount = 0;
            } else {
                this._idleCount = (this._idleCount || 0) + 1;
            }
            if (this._idleCount < 8 || Main.overview?.visible) {
                this._frameSyncId = laterAdd(frameLaterType, frameTick);
            } else {
                this._frameSyncId = 0;
                this._scheduleIdleHeartbeat();
            }
            return GLib.SOURCE_REMOVE;
        };
        this.wakeFrameSync = () => {
            if (this._torndown || !this.bgActor || !this.targetActor?.mapped) return;
            this._idleCount = 0;
            if (this._idleTimeoutId) {
                GLib.source_remove(this._idleTimeoutId);
                this._idleTimeoutId = 0;
            }
            if (this._frameSyncId === 0) {
                this._frameSyncId = laterAdd(frameLaterType, frameTick);
            }
        };
        this._wakeUnsub = (damagedActor, reason) => {
            if (this._torndown || !this.bgActor || !this.targetActor?.mapped) return;
            if (['restacked', 'fullscreen', 'overview', 'layout', 'overview-scroll', 'overview-transition', 'window-moved'].includes(reason)) {
                glassForceRefresh?.(this.bgActor);
                try { this._windowCloneManager?.rebuildClones?.(); } catch (_) {}
                try { this._uiSampler?.rebindSelf?.(); } catch (_) {}
                try { this._uiSampler?.refresh?.(); } catch (_) {}
                try { this.effect?.markBackdropDirty?.(); } catch (_) {}
            }
            if (!damagedActor || isActorNearGlass(damagedActor, this.bgActor) || Main.overview?.visible) {
                this.effect?.markBackdropDirty?.();
                this.wakeFrameSync();
            }
        };
        addGlassWakeListener(this._wakeUnsub);
        this._scheduleIdleHeartbeat = () => {
            if (this._idleTimeoutId || this._torndown)
                return;

            const intervalMs = Main.overview?.visible ? 150 : 1500;
            this._idleTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
                this._idleTimeoutId = 0;
                if (this._torndown || !this.bgActor || !this.targetActor?.mapped)
                    return GLib.SOURCE_REMOVE;
                let drifted = false;
                try {
                    drifted = Main.overview?.visible || isBackdropDirtyOrChanged(this.bgActor);
                } catch (_) {
                    drifted = true;
                }
                if (drifted) {
                    this.effect?.markBackdropDirty?.();
                    this.wakeFrameSync();
                } else {
                    this._scheduleIdleHeartbeat();
                }
                return GLib.SOURCE_REMOVE;
            });
        };
        this._windowSignals = new Map();
        this._syncWindowSignals = () => {
            if (this._torndown) return;
            try {
                let actors = global.get_window_actors?.() ?? [];
                let currentWindows = new Set();
                for (let a of actors) {
                    if (!a || a._isDisposed) continue;
                    hookWindowDamage?.(a);
                    let mw = a.get_meta_window?.();
                    if (!mw) continue;
                    currentWindows.add(mw);
                    if (!this._windowSignals.has(mw)) {
                        let sigs = [];
                        try {
                            sigs.push(mw.connect('position-changed', () => this.wakeFrameSync()));
                            sigs.push(mw.connect('size-changed', () => this.wakeFrameSync()));
                            sigs.push(mw.connect('workspace-changed', () => this.wakeFrameSync()));
                            sigs.push(mw.connect('unmanaged', () => {
                                this._cleanupWindowSignals?.(mw);
                                this.wakeFrameSync();
                            }));
                        } catch (_) {}
                        this._windowSignals.set(mw, sigs);
                    }
                }
                for (let [mw, sigs] of this._windowSignals.entries()) {
                    if (!currentWindows.has(mw)) {
                        this._cleanupWindowSignals?.(mw);
                    }
                }
            } catch (_) {}
        };
        this._cleanupWindowSignals = (mw) => {
            if (!this._windowSignals) return;
            let sigs = this._windowSignals.get(mw);
            if (sigs) {
                for (let s of sigs) {
                    try { mw.disconnect(s); } catch (_) {}
                }
                this._windowSignals.delete(mw);
            }
        };
        let startFrameSync = () => {
            this.wakeFrameSync();
            if (this._frameSyncId === 0 && !this._torndown && this.bgActor && this.targetActor?.mapped) {
                buildClones();
                this._syncWindowSignals();
                this._frameSyncId = laterAdd(frameLaterType, frameTick);
            }
        };
        let mapSignalId = this.targetActor.connect('notify::mapped', () => {
            if (this.targetActor.mapped) {
                startFrameSync();
            }
            else {
                if (this._frameSyncId !== 0) {
                    this._frameSyncId = 0;
                }
                if (this._idleTimeoutId) {
                    GLib.source_remove(this._idleTimeoutId);
                    this._idleTimeoutId = 0;
                }
            }
        });
        this._signals.push(mapSignalId);
        this._signals.push(this.targetActor.connect('notify::allocation', () => {
            this.wakeFrameSync();
            try {
                this._applyAdaptiveRadius();
            } catch (e) {

            }
        }));
        this._signals.push(this.targetActor.connect('enter-event', () => {
            this.wakeFrameSync();
            return false;
        }));
        this._signals.push(this.targetActor.connect('leave-event', () => {
            this.wakeFrameSync();
            return false;
        }));
        try {
            let rId = global.display.connect('restacked', () => this.wakeFrameSync());
            this._signals.push({ disconnect: () => { try { global.display.disconnect(rId); } catch(_) {} } });
        } catch (_) {}
        try {
            let fsId = global.display.connect('in-fullscreen-changed', () => this.wakeFrameSync());
            this._signals.push({ disconnect: () => { try { global.display.disconnect(fsId); } catch(_) {} } });
        } catch (_) {}
        try {
            let fwId = global.display.connect('notify::focus-window', () => this.wakeFrameSync());
            this._signals.push({ disconnect: () => { try { global.display.disconnect(fwId); } catch(_) {} } });
        } catch (_) {}
        try {
            let wcId = global.display.connect('window-created', () => {
                this._syncWindowSignals?.();
                this.wakeFrameSync();
            });
            this._signals.push({ disconnect: () => { try { global.display.disconnect(wcId); } catch(_) {} } });
        } catch (_) {}
        try {
            let waId = global.display.connect('workareas-changed', () => this.wakeFrameSync());
            this._signals.push({ disconnect: () => { try { global.display.disconnect(waId); } catch(_) {} } });
        } catch (_) {}
        try {
            let wemId = global.display.connect('window-entered-monitor', () => {
                this._syncWindowSignals?.();
                this.wakeFrameSync();
            });
            this._signals.push({ disconnect: () => { try { global.display.disconnect(wemId); } catch(_) {} } });
        } catch (_) {}
        try {
            let wlmId = global.display.connect('window-left-monitor', () => {
                this._syncWindowSignals?.();
                this.wakeFrameSync();
            });
            this._signals.push({ disconnect: () => { try { global.display.disconnect(wlmId); } catch(_) {} } });
        } catch (_) {}
        try {
            let wmPurgeId = global.display.connect('gl-video-memory-purged', () => {
                this._windowCloneManager?.rebuildClones();
                this.wakeFrameSync();
            });
            this._signals.push({ disconnect: () => { try { global.display.disconnect(wmPurgeId); } catch(_) {} } });
        } catch (_) {}

        if (global.window_manager) {
            try {
                let wmSwId = global.window_manager.connect('switch-workspace', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.window_manager.disconnect(wmSwId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wmMinId = global.window_manager.connect('minimize', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.window_manager.disconnect(wmMinId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wmUnminId = global.window_manager.connect('unminimize', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.window_manager.disconnect(wmUnminId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wmSzId = global.window_manager.connect('size-change', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.window_manager.disconnect(wmSzId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wmDesId = global.window_manager.connect('destroy', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.window_manager.disconnect(wmDesId); } catch(_) {} } });
            } catch (_) {}
        }

        if (global.workspace_manager) {
            try {
                let wsmSwId = global.workspace_manager.connect('workspace-switched', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.workspace_manager.disconnect(wsmSwId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wsmActId = global.workspace_manager.connect('active-workspace-changed', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.workspace_manager.disconnect(wsmActId); } catch(_) {} } });
            } catch (_) {}
            try {
                let wsmDeskId = global.workspace_manager.connect('showing-desktop-changed', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { global.workspace_manager.disconnect(wsmDeskId); } catch(_) {} } });
            } catch (_) {}
        }

        if (Main.overview) {
            try {
                let ovShowId = Main.overview.connect('showing', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { Main.overview.disconnect(ovShowId); } catch(_) {} } });
            } catch (_) {}
            try {
                let ovHideId = Main.overview.connect('hiding', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { Main.overview.disconnect(ovHideId); } catch(_) {} } });
            } catch (_) {}
            try {
                let ovHiddenId = Main.overview.connect('hidden', () => {
                    this._windowCloneManager?.rebuildClones();
                    this.wakeFrameSync();
                });
                this._signals.push({ disconnect: () => { try { Main.overview.disconnect(ovHiddenId); } catch(_) {} } });
            } catch (_) {}
        }

        if (Main.sessionMode) {
            try {
                let smId = Main.sessionMode.connect('updated', () => this.wakeFrameSync());
                this._signals.push({ disconnect: () => { try { Main.sessionMode.disconnect(smId); } catch(_) {} } });
            } catch (_) {}
        }
        if (Main.screenShield) {
            try {
                let ssId = Main.screenShield.connect('active-changed', () => {
                    if (!Main.screenShield.active) {
                        this._windowCloneManager?.rebuildClones();
                        this.wakeFrameSync();
                    }
                });
                this._signals.push({ disconnect: () => { try { Main.screenShield.disconnect(ssId); } catch(_) {} } });
            } catch (_) {}
        }
        let d2dInit = this.targetActor;
        while (d2dInit && d2dInit.constructor?.name !== 'DashToDock') {
            d2dInit = d2dInit.get_parent();
        }
        if (d2dInit) {
            try {
                this._signals.push(d2dInit.connect('showing', () => this.wakeFrameSync()));
                this._signals.push(d2dInit.connect('hiding', () => this.wakeFrameSync()));
                this._signals.push(d2dInit.connect('notify::translation-y', () => this.wakeFrameSync()));
                this._signals.push(d2dInit.connect('notify::visible', () => this.wakeFrameSync()));
                if (d2dInit.dash) {
                    this._signals.push(d2dInit.dash.connect('notify::translation-y', () => this.wakeFrameSync()));
                    this._signals.push(d2dInit.dash.connect('notify::opacity', () => this.wakeFrameSync()));
                }
                if (d2dInit._slider) {
                    this._signals.push(d2dInit._slider.connect('notify::slide-x', () => this.wakeFrameSync()));
                    this._signals.push(d2dInit._slider.connect('notify::y', () => this.wakeFrameSync()));
                }
            } catch (_) {}
        }
        if (this.targetActor.mapped) {
            startFrameSync();
        }
    }
    _syncGeometry() {
        this._restackGlass();
        if (!this.bgActor || !this.targetActor || !this.targetActor.mapped) {
            if (this.bgActor) {
                this.bgActor.hide();
                this.bgActor.opacity = 0;
            }
            return false;
        }

        let monitorIndex = Main.layoutManager.findIndexForActor(this.targetActor);
        if (monitorIndex < 0) {
            monitorIndex = Main.layoutManager.primaryIndex;
        }
        let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
        let marginBottom = this._settings ? this._settings.get_int('dock-margin-bottom') : 8;
        if (!Number.isFinite(marginBottom) || marginBottom < 0) marginBottom = 8;


        let isFullscreen = false;
        try {
            isFullscreen = (monitorIndex >= 0 && global.display.get_monitor_in_fullscreen(monitorIndex)) ||
                           global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex) ||
                           !!monitor?.inFullscreen;
        } catch (_) {}


        let d2d = this.targetActor;
        while (d2d && d2d.constructor?.name !== 'DashToDock') {
            d2d = d2d.get_parent();
        }

        const isD2DTransitioning = Boolean(d2d && (
            d2d._dockState === 1   ||
            d2d._dockState === 3
        ));


        if (isFullscreen) {
            const isD2DShowing = d2d && d2d.visible && d2d.mapped &&
                                 (d2d._dockState === 2   || d2d._dockState === 3  ) &&
                                 (d2d._dockState === 3 || !d2d._slider || d2d._slider.slide_x > 0.05);
            if (!isD2DShowing) {
                this.bgActor.hide();
                this.bgActor.opacity = 0;
                return false;
            }
        }


        if (d2d && d2d._dockState === 1  ) {
            return false;
        }


        if (d2d && (!d2d.visible || !d2d.mapped || d2d._dockState === 0   || (d2d._slider && d2d._slider.slide_x <= 0.001))) {
            this.bgActor.hide();
            this.bgActor.opacity = 0;
            this.bgActor.translation_y = 0;
            return false;
        }

        let sourceActor = this.targetActor;
        let children = this.targetActor.get_children();
        for (let i = 0; i < children.length; i++) {
            if (children[i].has_style_class_name('dash-background')) {
                children[i].opacity = 0;
                sourceActor = children[i];
            }
        }

        let [baseW, baseH] = sourceActor.get_size();
        let [absX, absY] = sourceActor.get_transformed_position();
        if (Number.isNaN(absX) || Number.isNaN(absY))
            return false;


        let hasSlabBounds = false;
        let iconBounds = null;
        const getIconBounds = () => {
            if (iconBounds !== null) return iconBounds;
            let icons = [];
            const walkIcons = (a) => {
                if (!a) return;
                const name = a.constructor?.name || '';
                const cls = a.has_style_class_name ? a.get_style_class_name() : '';
                if ((name === 'St_Icon' || name === 'BaseIcon' || cls?.includes('overview-icon')) && a.visible) {
                    let [ix, iy] = a.get_transformed_position();
                    let [iw, ih] = a.get_transformed_size();
                    if (Number.isFinite(ix) && Number.isFinite(iy) && iw > 0 && ih > 0) {
                        icons.push({ x: ix, y: iy, w: iw, h: ih });
                    }
                }
                for (const ch of (a.get_children ? a.get_children() : [])) {
                    walkIcons(ch);
                }
            };
            walkIcons(this.targetActor);

            if (icons.length > 0) {
                icons.sort((a, b) => a.x - b.x);
                let minX = icons[0].x;
                let maxX = icons[icons.length - 1].x + icons[icons.length - 1].w;

                const minH = Math.min(...icons.map(ic => ic.h));
                const restingIcons = icons.filter(ic => ic.h <= minH + 6);
                const targetIcons = restingIcons.length > 0 ? restingIcons : icons;

                let minY = Infinity, maxY = -Infinity;
                for (const ic of targetIcons) {
                    if (ic.y < minY) minY = ic.y;
                    if (ic.y + ic.h > maxY) maxY = ic.y + ic.h;
                }
                if (minY < maxY) {
                    iconBounds = {
                        minX, maxX, minY, maxY,
                        h: maxY - minY,
                        centerY: (minY + maxY) * 0.5
                    };
                } else {
                    iconBounds = false;
                }
            } else {
                iconBounds = false;
            }
            return iconBounds;
        };

        const slab = this._findDashBackground(this.targetActor.get_parent() || this.targetActor);
        if (slab) {
            if (!slab.visible) {
                try { slab.show(); } catch (_) {}
            }
            let slW, slH, slX, slY;
            try {
                [slW, slH] = slab.get_transformed_size();
                [slX, slY] = slab.get_transformed_position();
            } catch (_) {}
            if (Number.isFinite(slX) && Number.isFinite(slW) && slW > 50 && Number.isFinite(slY)) {
                const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;

                if (!isD2DTransitioning && slY >= screenBottom) {
                    this.bgActor.hide();
                    this.bgActor.opacity = 0;
                    return false;
                }

                this._lastSlabW = slW;
                this._lastSlabH = slH;
                this._lastSlabX = slX;
                this._lastSlabY = slY;

                let pillW = slW - 8;
                let pillX = slX + 4;
                const ib = (slH && slH > 30 && Number.isFinite(slY) && slY > 0) ? null : getIconBounds();
                let pillH = (slH && slH > 30) ? slH : (ib ? (ib.h + 20) : 74);
                let pillY = (Number.isFinite(slY) && slY > 0) ? slY : (ib ? Math.round(ib.centerY - (pillH * 0.5)) : slY);

                absX = pillX - 4;
                absY = pillY - 4;
                baseW = pillW + 8;
                baseH = pillH + 8;
                hasSlabBounds = true;
            }
        }

        let hasIconBounds = false;
        const fallbackIb = (!hasSlabBounds && !isD2DTransitioning) ? getIconBounds() : null;
        if (fallbackIb) {
            const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;
            if (fallbackIb.minY >= screenBottom) {
                this.bgActor.hide();
                this.bgActor.opacity = 0;
                return false;
            }

            let isHorizontal = (fallbackIb.maxX - fallbackIb.minX) >= fallbackIb.h;
            let pillX, pillY, pillW, pillH;
            let sidePad = 12;
            if (isHorizontal) {
                pillH = (this._lastSlabH && this._lastSlabH > 30) ? this._lastSlabH : (fallbackIb.h + 20);
                pillY = Math.round(fallbackIb.centerY - (pillH * 0.5));
                pillX = fallbackIb.minX - sidePad;
                pillW = (fallbackIb.maxX - fallbackIb.minX) + sidePad * 2;
            } else {
                pillW = fallbackIb.h + 20;
                let isLeft = monitor && (fallbackIb.minX - monitor.x < (monitor.x + monitor.width) - fallbackIb.maxX);
                pillX = isLeft ? (monitor.x + 4) : (monitor ? (monitor.x + monitor.width - 4 - pillW) : (fallbackIb.minX - 11));
                pillY = fallbackIb.minY - sidePad;
                pillH = fallbackIb.h + sidePad * 2;
            }
            absX = pillX - 4;
            absY = pillY - 4;
            baseW = pillW + 8;
            baseH = pillH + 8;
            hasIconBounds = true;
        }


        if (isD2DTransitioning && this._lastRestingAbsY !== undefined) {
            absX = this._lastRestingAbsX;
            absY = this._lastRestingAbsY;
            baseW = this._lastRestingBaseW;
            baseH = this._lastRestingBaseH;
            hasSlabBounds = true;
        } else if (hasSlabBounds || hasIconBounds) {
            const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;
            if (absY < screenBottom && (!monitor || absY >= monitor.y)) {
                this._lastRestingAbsX = absX;
                this._lastRestingAbsY = absY;
                this._lastRestingBaseW = baseW;
                this._lastRestingBaseH = baseH;
            }
        }


        if (!hasSlabBounds && !hasIconBounds) {
            this.bgActor.hide();
            this.bgActor.opacity = 0;
            return false;
        }


        let w = Math.max(1.0, baseW);
        let h = Math.max(1.0, baseH);
        if (baseW <= 9 || baseH <= 9) {
            this.bgActor.hide();
            this.bgActor.opacity = 0;


            this._lastBgW = undefined;
            this._lastBgH = undefined;
            this._lastBgX = undefined;
            this._lastBgY = undefined;
            return false;
        }

        let visibleW = baseW;
        let visibleH = baseH;
        if (monitor) {
            if (absX < monitor.x)
                visibleW -= (monitor.x - absX);
            if (absY < monitor.y)
                visibleH -= (monitor.y - absY);
            if (absX + baseW > monitor.x + monitor.width)
                visibleW -= ((absX + baseW) - (monitor.x + monitor.width));
            if (absY + baseH > monitor.y + monitor.height)
                visibleH -= ((absY + baseH) - (monitor.y + monitor.height));
        }

        if (visibleW <= 1 || visibleH <= 1) {
            if (this._lastHidden !== true) {
                this._lastHidden = true;
                this._logger.log(`[Liquid Glass][dock] hiding the glass: visible=(${visibleW.toFixed(1)}x${visibleH.toFixed(1)}) ` +
                    `base=(${baseW.toFixed(1)}x${baseH.toFixed(1)}) abs=(${absX.toFixed(1)},${absY.toFixed(1)}) ` +
                    `monitor=(${monitor?.x},${monitor?.y},${monitor?.width}x${monitor?.height}) ` +
                    `margin=${this._marginValue}`);
            }
            this.bgActor.opacity = 0;
            this.bgActor.hide();
            return false;
        }
        else {
            if (this._lastHidden === true) {
                this._lastHidden = false;
                this._logger.log('[Liquid Glass][dock] glass visible again');
                glassForceRefresh?.(this.bgActor);
                this.wakeFrameSync();
            }
            this.bgActor.show();
            if (!isD2DTransitioning) {
                this.bgActor.opacity = this.targetActor.opacity;
                this.bgActor.translation_y = 0;
            }
        }
        let bgW = Math.max(1.0, w + (SHADER_PADDING * 2) + (this._glassExpand * 2));
        let bgH = Math.max(1.0, h + (SHADER_PADDING * 2) + (this._glassExpand * 2));
        let bgX = absX - SHADER_PADDING - this._glassExpand;
        let bgY = absY - SHADER_PADDING - this._glassExpand;





        let screenW = monitor.width;
        let screenH = monitor.height;



        let localBgX = bgX - monitor.x;
        let localBgY = bgY - monitor.y;

        if (!isD2DTransitioning && (this._lastBgW !== bgW || this._lastBgH !== bgH ||
            this._lastBgX !== bgX || this._lastBgY !== bgY ||
            this._lastScreenW !== screenW || this._lastScreenH !== screenH)) {
            this.bgActor.remove_transition('size');
            this.bgActor.remove_transition('position');
            this.bgActor.set_position(monitor.x, monitor.y);
            this.bgActor.set_size(screenW, screenH);
            this.bgActor.remove_transition('size');
            this.bgActor.remove_transition('position');
            this.liquidBox?.set_position(0, 0);
            this.liquidBox?.set_size(screenW, screenH);
            this._lastBgW = bgW;
            this._lastBgH = bgH;
            this._lastBgX = bgX;
            this._lastBgY = bgY;
            this._lastScreenW = screenW;
            this._lastScreenH = screenH;
        }






        const CLIP_PADDING = 36;







        setClipIfChanged(this.bgActor, localBgX - CLIP_PADDING, localBgY - CLIP_PADDING, bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2);
        const SHADOW_MAX_RADIUS = 32;
        this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);













        this.effect?.setResolution(screenW, screenH);




        this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);





        this._windowCloneManager?.setOffset(-monitor.x, -monitor.y);





        const extraH = _dockGlassExtras(localBgX, localBgY, bgW, bgH, screenW, screenH);
        if (!glassRefreshDue?.(this.bgActor, extraH))
            return false;





        syncGlassCaptureClip({
            cloneContainer: this._cloneContainer,
            effect: this.effect,
            originX: monitor.x,
            originY: monitor.y,
            uiSampler: this._uiSampler,
            windowCloneManager: this._windowCloneManager,
        });


        this._uiSampler?.refresh();
        this._uiSampler?.sync(monitor.x, monitor.y, screenW, screenH);
        this._windowCloneManager?.sync();
        this._syncWindowSignals?.();
        this.effect?.markBackdropDirty?.();
        glassRefreshDone?.(this.bgActor, extraH);
        return true;
    }

    _removeEffect() {
        if (!this._isEffectActive)
            return;
        this._isEffectActive = false;
        this._currentMarginStyle = undefined;
        if (this._idleTimeoutId) {
            GLib.source_remove(this._idleTimeoutId);
            this._idleTimeoutId = 0;
        }
        if (this._windowSignals) {
            for (let [mw, sigs] of this._windowSignals.entries()) {
                for (let s of sigs) {
                    try { mw.disconnect(s); } catch (_) {}
                }
            }
            this._windowSignals.clear();
        }


        try {
            for (let sigId of this._signals) {
                if (typeof sigId === 'object' && sigId && typeof sigId.disconnect === 'function') {
                    sigId.disconnect();
                } else if (typeof sigId === 'number') {
                    this.targetActor.disconnect(sigId);
                }
            }
            this.targetActor.remove_style_class_name('liquid-glass-transparent');
            if (this._originalStyle !== undefined) {
                this.targetActor.set_style(this._originalStyle);
                this._originalStyle = undefined;
            }
            let children = this.targetActor.get_children();
            for (let i = 0; i < children.length; i++) {
                if (children[i].has_style_class_name('dash-background')) {
                    children[i].opacity = 255;
                }
            }
        }
        catch (e) {

        }
        this._cancelMarginReconcile();
        this._signals = [];
        this.targetActor.remove_style_class_name('liquid-glass-transparent');
        try {
            if (this._dockParent) {
                this._dockParent.remove_style_class_name('liquid-glass-transparent');
            }
        }
        catch (e) { }
        this._dockParent = null;
        if (this._originalStyle !== undefined) {
            this.targetActor.set_style(this._originalStyle);
            this._originalStyle = undefined;
        }
        let children = this.targetActor.get_children();
        for (let i = 0; i < children.length; i++) {
            if (children[i].has_style_class_name('dash-background')) {
                children[i].opacity = 255;
            }
        }
        if (this._frameSyncId !== 0) {
            if (global.compositor?.get_laters) {
                global.compositor.get_laters().remove(this._frameSyncId);
            }
            else {

            }
            this._frameSyncId = 0;
        }
        if (this.effect) {
            this.effect.cleanup();
            this.effect = null;
        }
        if (this.bgActor) {
            this.bgActor.destroy();
            this.bgActor = null;
        }


        this.liquidBox = null;
        this._uiSampler?.destroy();
        this._windowCloneManager?.destroy();
        if (this._wakeUnsub) {
            removeGlassWakeListener(this._wakeUnsub);
            this._wakeUnsub = null;
        }
    }








    _teardownStep(name, fn) {
        try {
            fn();
        }
        catch (e) {
            try {
                this._logger?.error(`[Liquid Glass] ${this.constructor.name}.${name} failed during cleanup: ${e}`);
            }
            catch (_) {
                console.error(`[Liquid Glass] ${name} failed during cleanup: ${e}`);
            }
        }
    }
    cleanup() {
        this._torndown = true;
        this._teardownStep('globalSync', () => {
            if (global._liquidGlassDockSync) {
                delete global._liquidGlassDockSync;
            }
        });



        this._teardownStep('frameSync', () => {
            if (this._frameSyncId !== 0) {
                if (global.compositor?.get_laters)
                    global.compositor.get_laters().remove(this._frameSyncId);
                this._frameSyncId = 0;
            }
            if (this._idleTimeoutId) {
                GLib.source_remove(this._idleTimeoutId);
                this._idleTimeoutId = 0;
            }
        });

        this._teardownStep('removeEffect', () => this._removeEffect());
        if (this._wakeUnsub) {
            removeGlassWakeListener(this._wakeUnsub);
            this._wakeUnsub = null;
        }

        this._teardownStep('settingsSignals', () => {
            if (this._settings) {
                for (let id of this._settingsSignals) {
                    try {
                        this._settings.disconnect(id);
                    }
                    catch (e) { }
                }
                this._settingsSignals = [];
            }
        });
    }

    _findReferenceActor(actor) {
        if (!actor)
            return null;

        if (!actor || typeof actor.get_children !== 'function') {
            return null;
        }

        if (actor.constructor && actor.constructor.name === 'BaseIcon') {
            return actor;
        }
        if (actor.toString().includes('BaseIcon')) {
            return actor;
        }
        if (actor.toString().includes('IndicatorDrawingArea')) {
            return actor;
        }

        const children = actor.get_children();
        for (const child of children) {
            const found = this._findReferenceActor(child);
            if (found) {
                return found;
            }
        }
        return null;
    }



    _findDashBackground(root, depth = 4) {
        if (!root || depth < 0 || typeof root.get_children !== 'function')
            return null;
        let children;
        try {
            children = root.get_children();
        }
        catch (e) {
            return null;
        }
        for (const child of children) {
            if (child && typeof child.has_style_class_name === 'function' &&
                child.has_style_class_name('dash-background')) {
                return child;
            }
        }
        for (const child of children) {
            const found = this._findDashBackground(child, depth - 1);
            if (found) {
                return found;
            }
        }
        return null;
    }
}
