
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { LiquidEffect } from './liquidEffect.js?v=fix3';
import { StageContrastSampler, AdaptiveContrastConfig } from './contrastSampler.js';
import { UnpickableActor, UILayerSampler, WindowCloneManager, reportFrameLoopError, ensureGlassAllocated, getTransformedRect, resolveMonitorGeometry, isFrameSyncFrozen, setClipIfChanged, syncGlassCaptureClip, resolveCrossFade, adaptiveColorTweener, addGlassWakeListener, removeGlassWakeListener, isActorNearGlass, glassForceRefresh, glassRefreshDue, glassRefreshDone } from './utils.js?v=fix4';

const SHADER_PADDING = 20;
export class NotificationManager {
    extensionPath;
    _settings;
    _logger;
    tray;
    currentBanner = null;





    bgActor = null;
    liquidBox = null;
    _cloneContainer = null;
    effect = null;
    _windowCloneManager = null;
    _uiSampler = null;
    _signals;
    _settingsSignals;
    _frameSyncId;



    _torndown = false;
    _isEffectActive;
    _bannerIdleId = 0;
    _pendingBanner = null;
    _bannerGeneration = 0;
    _originalBannerOffset = 0;
    _lastBgW;
    _lastBgH;
    _lastBgX;
    _lastBgY;
    _lastScreenW;
    _lastScreenH;
    _contrastSampler;
    _adaptiveConfig;
    _adaptiveTimerId;
    _adaptiveInFlight;
    _styledActors;
    _glassExpand;
    _baseTint;
    _currentTint;
    _notificationYOffset;
    _isFirstAdaptiveRun = true;
    constructor(extensionPath, settings, logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
        this.tray = Main.messageTray;
        this._signals = [];
        this._settingsSignals = [];
        this._frameSyncId = 0;
        this._isEffectActive = false;
        this._contrastSampler = new StageContrastSampler();
        this._adaptiveConfig = {
            ...AdaptiveContrastConfig,
            enabled: true,
            samplePerElement: false,
            sampleIntervalMs: 400,
        };
        this._adaptiveTimerId = 0;
        this._adaptiveInFlight = false;
        this._styledActors = new Map();
        this._glassExpand = 12;
        this._baseTint = 0.08;
        this._currentTint = 0.08;
        this._notificationYOffset = 10;
    }
    setup() {
        if (!this._settings)
            return;
        this._bindSettings();
        if (this._settings.get_boolean('enable-notification-glass')) {
            this._applyEffect();
        }
    }

    _hexToColorArray(hex) {
        if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7)
            return [1.0, 1.0, 1.0];
        let r = parseInt(hex.slice(1, 3), 16) / 255.0;
        let g = parseInt(hex.slice(3, 5), 16) / 255.0;
        let b = parseInt(hex.slice(5, 7), 16) / 255.0;
        return [r, g, b];
    }
    _bindSettings() {
        const connectSetting = (key, callback) => {
            let id = this._settings.connect(`changed::${key}`, callback.bind(this));
            this._settingsSignals.push(id);
        };
        connectSetting('enable-notification-glass', () => {
            let enabled = this._settings.get_boolean('enable-notification-glass');
            if (enabled && !this._isEffectActive)
                this._applyEffect();
            else if (!enabled && this._isEffectActive)
                this._removeEffect();
        });
        connectSetting('notification-tint-color', () => {
            if (this.effect && this._isEffectActive) {
                let colorArray = this._hexToColorArray(this._settings.get_string('notification-tint-color'));
                this.effect.setTintColor(...colorArray);
            }
        });
        connectSetting('notification-tint-strength', () => {
            if (this.effect && this._isEffectActive) {
                this._baseTint = this._settings.get_double('notification-tint-strength');
                this._currentTint = this._baseTint;
                this.effect.setTintStrength(this._baseTint);
            }
        });
        connectSetting('notification-blur-radius', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setBlurRadius(this._settings.get_int('notification-blur-radius'));
            }
        });
        connectSetting('notification-corner-radius', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setCornerRadius(this._settings.get_double('notification-corner-radius'));
            }
        });
        connectSetting('notification-glass-expand', () => {
            if (this._isEffectActive) {
                this._glassExpand = this._settings.get_int('notification-glass-expand');
            }
        });

        connectSetting('notification-brightness', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setBrightness(this._settings.get_double('notification-brightness'));
            }
        });
        connectSetting('notification-saturation', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setSaturation(this._settings.get_double('notification-saturation'));
            }
        });
        connectSetting('notification-contrast', () => {
            if (this.effect && this._isEffectActive) {
                this.effect.setContrast(this._settings.get_double('notification-contrast'));
            }
        });
        connectSetting('notification-enable-adaptive-text-color', () => {
            this._adaptiveConfig.enabled = this._settings.get_boolean('notification-enable-adaptive-text-color');
        });
        connectSetting('notification-sample-interval-ms', () => {
            this._adaptiveConfig.sampleIntervalMs = this._settings.get_int('notification-sample-interval-ms');
        });
        connectSetting('notification-y-offset', () => {
            this._notificationYOffset = this._settings.get_int('notification-y-offset');
        });
    }
    _applyEffect() {
        if (this._isEffectActive)
            return;
        // @ts-expect-error: _bannerBin is an internal property
        let bannerBin = this.tray._bannerBin;
        if (!bannerBin) {
            this._logger.error('[Liquid Glass] _bannerBin is not found. GNOME internal structure might have changed.');
            return;
        }
        this._isEffectActive = true;

        this._adaptiveConfig.enabled = this._settings.get_boolean('notification-enable-adaptive-text-color');
        this._adaptiveConfig.sampleIntervalMs = this._settings.get_int('notification-sample-interval-ms');
        this._glassExpand = this._settings.get_int('notification-glass-expand');
        this._baseTint = this._settings.get_double('notification-tint-strength');
        this._currentTint = this._baseTint;
        this._notificationYOffset = this._settings.get_int('notification-y-offset');

        this._signals.push(bannerBin.connect('child-added', (container, actor) => {
            if (actor === this.bgActor || actor.get_name?.() === 'liquid-glass-bg-actor')
                return;
            if (this._bannerIdleId)
                GLib.Source.remove(this._bannerIdleId);
            this._pendingBanner = actor;
            this._bannerIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._bannerIdleId = 0;
                this._pendingBanner = null;

                if (!this._isEffectActive || actor.get_parent() !== bannerBin)
                    return GLib.SOURCE_REMOVE;
                if (actor !== this.currentBanner) {
                    this._cleanupCurrentBanner();
                    this.currentBanner = actor;
                    this._setupBannerEffect(actor);
                }
                return GLib.SOURCE_REMOVE;
            });
        }));
        this._signals.push(bannerBin.connect('child-removed', (container, actor) => {
            if (actor === this.bgActor || actor.get_name?.() === 'liquid-glass-bg-actor')
                return;
            if (actor === this._pendingBanner) {
                if (this._bannerIdleId)
                    GLib.Source.remove(this._bannerIdleId);
                this._bannerIdleId = 0;
                this._pendingBanner = null;
            }
            if (actor === this.currentBanner)
                this._cleanupCurrentBanner();
        }));
        // @ts-expect-error
        if (this.tray._banner) {
            // @ts-expect-error
            this.currentBanner = this.tray._banner;
            // @ts-expect-error
            this._setupBannerEffect(this.tray._banner);
        }
    }
    _setupBannerEffect(targetActor) {
        targetActor.add_style_class_name('liquid-glass-transparent');
        // @ts-expect-error
        if (this.tray._bannerBin) {
            // @ts-expect-error
            this._originalBannerOffset = this.tray._bannerBin.translation_y;
            // @ts-expect-error: shell-owned container
            this.tray._bannerBin.translation_y = this._originalBannerOffset + this._notificationYOffset;
        }

        this.bgActor = new UnpickableActor();
        this.bgActor.set_name('liquid-glass-bg-actor');
        this.bgActor.hide();
        this.bgActor.set_size(1.0, 1.0);
        this.bgActor.set_pivot_point(0.0, 0.0);

        this.liquidBox = new UnpickableActor();
        this.liquidBox.set_name('liquid-box');
        this.liquidBox.set_clip_to_allocation(true);
        this.bgActor.add_child(this.liquidBox);

        let dummyBreaker = new UnpickableActor();
        dummyBreaker.set_name('optimization-breaker');
        dummyBreaker.set_size(1.0, 1.0);
        dummyBreaker.set_opacity(0);
        this.liquidBox.add_child(dummyBreaker);

        this._cloneContainer = new UnpickableActor();
        this._cloneContainer.set_name('clone-container');
        this.liquidBox.add_child(this._cloneContainer);

        // @ts-expect-error
        let bannerBin = this.tray._bannerBin;
        let bannerRoot = bannerBin ?? targetActor;
        while (bannerRoot.get_parent() && bannerRoot.get_parent() !== Main.layoutManager.uiGroup) {
            const p = bannerRoot.get_parent();
            if (!p)
                break;
            bannerRoot = p;
        }


        if (bannerRoot.get_parent() === Main.layoutManager.uiGroup) {
            Main.layoutManager.uiGroup.insert_child_below(this.bgActor, bannerRoot);
        }
        else {
            Main.layoutManager.uiGroup.add_child(this.bgActor);
        }

        let blurRadius = this._settings.get_int('notification-blur-radius');
        let tintColorStr = this._settings.get_string('notification-tint-color');
        let cornerRadius = this._settings.get_double('notification-corner-radius');
        let tintStrength = this._settings.get_double('notification-tint-strength');
        let brightness = this._settings.get_double('notification-brightness');
        let saturation = this._settings.get_double('notification-saturation');
        let contrast = this._settings.get_double('notification-contrast');
        this._baseTint = tintStrength;

        this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, owner: 'notification' });
        this.effect.setPadding(SHADER_PADDING);
        this.effect.setTintColor(...this._hexToColorArray(tintColorStr));
        this.effect.setTintStrength(this._baseTint);
        this.effect.setCornerRadius(cornerRadius);
        this.effect.setIsDock(false);
        this.effect.setBrightness(brightness);
        this.effect.setSaturation(saturation);
        this.effect.setContrast(contrast);
        this.effect.setBlurRadius(blurRadius);
        this.liquidBox.add_effect(this.effect);

        this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-notification');
        this._uiSampler = new UILayerSampler(this.bgActor, this.liquidBox, [bannerRoot, global.windowGroup, global.window_group], this._cloneContainer, 'notification');


        this._buildClones();

        const frameLaterType = Meta.LaterType.BEFORE_REDRAW;
        const frameTick = () => {
            this._frameSyncId = 0;









            if (this._torndown)
                return GLib.SOURCE_REMOVE;
            if (!this.bgActor || !this.currentBanner)
                return GLib.SOURCE_REMOVE;


            if (isFrameSyncFrozen()) {
                this._frameSyncId = this._laterAdd(frameLaterType, frameTick);
                return GLib.SOURCE_REMOVE;
            }






            ensureGlassAllocated(this.bgActor);
            let didRefresh = false;
            try {
                didRefresh = !!this._syncGeometry();

                let isHovered = this.currentBanner.hover;
                let targetTint = isHovered ? (this._baseTint + 0.1) : this._baseTint;
                if (Math.abs(this._currentTint - targetTint) > 0.001) {
                    this._currentTint += (targetTint - this._currentTint) * 0.1;
                    this.effect?.setTintStrength(this._currentTint);
                    didRefresh = true;
                }
            }
            catch (e) {
                reportFrameLoopError('NotificationManager', e);
            }
            if (didRefresh) {
                this._idleCount = 0;
            } else {
                this._idleCount = (this._idleCount || 0) + 1;
            }
            if (this._idleCount < 8) {
                this._frameSyncId = this._laterAdd(frameLaterType, frameTick);
            } else {
                this._frameSyncId = 0;
            }
            return GLib.SOURCE_REMOVE;
        };
        this.wakeFrameSync = () => {
            this._idleCount = 0;
            if (this._idleTimeoutId) {
                GLib.source_remove(this._idleTimeoutId);
                this._idleTimeoutId = 0;
            }
            if (this._frameSyncId === 0 && !this._torndown && this.bgActor && this.currentBanner) {
                this._frameSyncId = this._laterAdd(frameLaterType, frameTick);
            }
        };
        this._wakeUnsub = (damagedActor, reason) => {
            if (this._torndown || !this.bgActor || !this.currentBanner) return;
            if (['restacked', 'fullscreen', 'overview', 'layout'].includes(reason)) {
                glassForceRefresh?.(this.bgActor);
                try { this._windowCloneManager?.rebuildClones?.(); } catch (_) {}
                try { this._uiSampler?.rebindSelf?.(); } catch (_) {}
                try { this._uiSampler?.refresh?.(); } catch (_) {}
                try { this.effect?.markBackdropDirty?.(); } catch (_) {}
            }
            if (!damagedActor || isActorNearGlass(damagedActor, this.bgActor)) {
                this.effect?.markBackdropDirty?.();
                this.wakeFrameSync?.();
            }
        };
        addGlassWakeListener(this._wakeUnsub);
        this._scheduleIdleHeartbeat = () => {

        };
        this._frameSyncId = this._laterAdd(frameLaterType, frameTick);
        this._isFirstAdaptiveRun = true;
        this._startAdaptiveColorSampling();
    }



    _syncGeometry() {
        if (!this.bgActor || !this.currentBanner)
            return;

        // @ts-expect-error: shell-owned container
        this.tray._bannerBin.translation_y = this._originalBannerOffset + this._notificationYOffset;


        const [absX, absY, w, h] = getTransformedRect(this.currentBanner);
        const opacity = this.currentBanner.get_paint_opacity();
        if (!this.currentBanner.mapped || !this.tray.visible || opacity === 0 ||
            ![absX, absY, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
            this.bgActor.hide();
            return;
        }
        this.bgActor.opacity = opacity;
        this.bgActor.show();
        const bgW = w + this._glassExpand * 2 + SHADER_PADDING * 2;
        const bgH = h + this._glassExpand * 2 + SHADER_PADDING * 2;
        const bgX_abs = absX - this._glassExpand - SHADER_PADDING;
        const bgY_abs = absY - this._glassExpand - SHADER_PADDING;
        const monitor = resolveMonitorGeometry([this.currentBanner, this.tray]);
        let monitorX = monitor?.x ?? 0;
        let monitorY = monitor?.y ?? 0;
        let screenW = Math.max(1, monitor?.width ?? 1);
        let screenH = Math.max(1, monitor?.height ?? 1);

        let localBgX = bgX_abs - monitorX;
        let localBgY = bgY_abs - monitorY;

        if (this._lastBgW !== bgW || this._lastBgH !== bgH ||
            this._lastBgX !== bgX_abs || this._lastBgY !== bgY_abs ||
            this._lastScreenW !== screenW || this._lastScreenH !== screenH) {

            this.bgActor.remove_transition('size');
            this.bgActor.remove_transition('position');
            this.bgActor.set_position(monitorX, monitorY);
            this.bgActor.set_size(screenW, screenH);
            this.bgActor.remove_transition('size');
            this.bgActor.remove_transition('position');

            this.liquidBox?.set_position(0, 0);
            this.liquidBox?.set_size(screenW, screenH);

            const CLIP_PADDING = 200;
            this.liquidBox?.remove_clip();

            setClipIfChanged(this.bgActor, localBgX - CLIP_PADDING, localBgY - CLIP_PADDING, bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2);
            const SHADOW_MAX_RADIUS = CLIP_PADDING - 20;
            this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);


            this.effect?.setResolution(screenW, screenH);
            this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);
            this._lastBgW = bgW;
            this._lastBgH = bgH;
            this._lastBgX = bgX_abs;
            this._lastBgY = bgY_abs;
            this._lastScreenW = screenW;
            this._lastScreenH = screenH;
        }

        this._windowCloneManager?.setOffset(-monitorX, -monitorY);
        if (!glassRefreshDue?.(this.bgActor))
            return false;





        syncGlassCaptureClip({
            cloneContainer: this._cloneContainer,
            effect: this.effect,
            originX: monitorX,
            originY: monitorY,
            uiSampler: this._uiSampler,
            windowCloneManager: this._windowCloneManager,
        });
        this._uiSampler?.refresh();
        this._uiSampler?.sync(monitorX, monitorY, screenW, screenH);
        this._windowCloneManager?.sync();
        this.effect?.markBackdropDirty?.();
        glassRefreshDone?.(this.bgActor);
        return true;
    }



    _buildClones() {
        if (!this.bgActor)
            return;
        if (this._uiSampler) {
            for (let child of Main.layoutManager.uiGroup.get_children()) {
                if (child === this.bgActor)
                    continue;
                let isLiquidBg = child.get_name?.() === 'liquid-glass-bg-actor' ||
                    (typeof child.get_children === 'function' &&
                        child.get_children().some((c) => c.get_name?.() === 'liquid-box'));
                if (isLiquidBg)
                    this._uiSampler.addExclusion(child);
            }
        }
        this._windowCloneManager?.rebuildClones();
        this._uiSampler?.rebindSelf();
        this._uiSampler?.refresh();
    }

    _cleanupCurrentBanner() {
        if (this._wakeUnsub) {
            removeGlassWakeListener(this._wakeUnsub);
            this._wakeUnsub = null;
        }
        this._bannerGeneration++;
        this._stopAdaptiveColorSampling();
        this._clearAdaptiveStyles();
        // @ts-expect-error
        if (this.currentBanner && this.tray._bannerBin) {
            // @ts-expect-error
            this.tray._bannerBin.translation_y = this._originalBannerOffset;
        }
        if (this.currentBanner) {
            this.currentBanner.remove_style_class_name('liquid-glass-transparent');
            this.currentBanner = null;
        }
        if (this._idleTimeoutId) {
            GLib.source_remove(this._idleTimeoutId);
            this._idleTimeoutId = 0;
        }
        if (this._frameSyncId !== 0) {
            if (global.compositor?.get_laters)
                global.compositor.get_laters().remove(this._frameSyncId);
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
        this._cloneContainer = null;

        this._uiSampler?.destroy();
        this._uiSampler = null;
        this._windowCloneManager?.destroy();
        this._windowCloneManager = null;

        this._lastBgW = undefined;
        this._lastBgH = undefined;
        this._lastBgX = undefined;
        this._lastBgY = undefined;
        this._lastScreenW = undefined;
        this._lastScreenH = undefined;
        this._isFirstAdaptiveRun = true;
    }

    _removeEffect() {
        if (!this._isEffectActive)
            return;
        this._isEffectActive = false;
        if (this._bannerIdleId)
            GLib.Source.remove(this._bannerIdleId);
        this._bannerIdleId = 0;
        this._pendingBanner = null;
        // @ts-expect-error
        let bannerBin = this.tray._bannerBin;
        for (let sigId of this._signals) {
            try {
                bannerBin.disconnect(sigId);
            }
            catch (e) { }
        }
        this._signals = [];
        this._cleanupCurrentBanner();
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
        this._teardownStep('frameSync', () => {
            if (this._idleTimeoutId) {
            GLib.source_remove(this._idleTimeoutId);
            this._idleTimeoutId = 0;
        }
        if (this._frameSyncId !== 0) {
                if (global.compositor?.get_laters)
                    global.compositor.get_laters().remove(this._frameSyncId);
                this._frameSyncId = 0;
            }
        });
        this._teardownStep('settingsSignals', () => {
            for (let sigId of this._settingsSignals) {
                try {
                    this._settings.disconnect(sigId);
                }
                catch (e) { }
            }
            this._settingsSignals = [];
        });
        this._teardownStep('removeEffect', () => this._removeEffect());
    }

    _collectAdaptiveTextTargets(actor = this.currentBanner, targets = []) {
        if (!actor)
            return targets;
        return this._findAllTextActors(actor);
    }
    _setActorColor(actor, color, skipAnimations = false, batchStart) {
        if (!actor || typeof actor.set_style !== 'function')
            return;
        if (!this._styledActors.has(actor)) {
            this._styledActors.set(actor, actor.get_style() || '');
            actor.connect('destroy', () => {
                adaptiveColorTweener.cancel(actor);
                this._styledActors.delete(actor);
            });
        }
        if (actor._currentTargetColor === color)
            return;





        actor._currentTargetColor = color;
        this._animateActorColor(actor, color, 380, skipAnimations, batchStart);
    }
    _clearAdaptiveStyles() {
        for (const [actor, style] of this._styledActors.entries()) {
            if (actor && typeof actor.set_style === 'function') {
                adaptiveColorTweener.cancel(actor);
                actor._currentTargetColor = undefined;
                actor.remove_style_class_name('adaptive-text-transition');
                actor.remove_style_class_name('adaptive-color-light');
                actor.remove_style_class_name('adaptive-color-dark');
                actor.set_style(style);
            }
        }
        this._styledActors.clear();
    }
    _applyAdaptiveColorMap(colorMap, skipAnimations = false) {
        if (!colorMap || colorMap.size === 0)
            return;

        const batchStart = GLib.get_monotonic_time();
        for (const [actor, color] of colorMap.entries()) {
            this._setActorColor(actor, color, skipAnimations, batchStart);
        }
    }
    _startAdaptiveColorSampling() {
        if (!this._adaptiveConfig.enabled)
            return;
        this._updateAdaptiveTextColors();
        if (this._adaptiveTimerId !== 0)
            return;
        this._adaptiveTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._adaptiveConfig.sampleIntervalMs, () => {
            if (!this.currentBanner || !this.bgActor) {
                this._adaptiveTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._updateAdaptiveTextColors();
            return GLib.SOURCE_CONTINUE;
        });
    }
    _stopAdaptiveColorSampling() {
        if (this._adaptiveTimerId !== 0) {
            GLib.source_remove(this._adaptiveTimerId);
            this._adaptiveTimerId = 0;
        }
    }
    _findAllTextActors(actor, foundActors = []) {
        if (!actor)
            return foundActors;
        if (actor instanceof St.Label || actor instanceof Clutter.Text || actor instanceof St.Button) {
            if (actor.visible)
                foundActors.push(actor);
        }
        let children = actor.get_children();
        for (let i = 0; i < children.length; i++) {
            this._findAllTextActors(children[i], foundActors);
        }
        return foundActors;
    }
    _updateAdaptiveTextColors() {
        if (!this._adaptiveConfig.enabled || this._adaptiveInFlight)
            return;
        let [absX, absY] = this.currentBanner?.get_transformed_position() ?? [0, 0];
        if (absY < 0)
            return;
        const targets = this._collectAdaptiveTextTargets();
        if (targets.length === 0)
            return;
        this._adaptiveInFlight = true;
        const generation = this._bannerGeneration;
        this._contrastSampler
            .chooseColorsForActors(targets, this._adaptiveConfig)
            .then(colorMap => {
            if (generation !== this._bannerGeneration || !this.currentBanner)
                return;
            this._applyAdaptiveColorMap(colorMap, this._isFirstAdaptiveRun);
            this._isFirstAdaptiveRun = false;
        })
            .catch(e => {
            this._logger.error(`[Liquid Glass] Notification adaptive color update failed: ${e}`);
        })
            .finally(() => {
            this._adaptiveInFlight = false;
        });
    }
    _hexToRgb(hex) {
        let bigint = parseInt(hex.replace('#', ''), 16);
        return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }
    _rgbToHex(r, g, b) {
        return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
    }
    _animateActorColor(actor, targetHexColor, durationMs = 380, skipAnimations = false, batchStart) {
        if (!actor || Object.keys(actor).length === 0)
            return;




        const originalStyle = (this._styledActors.get(actor) || '').trim();
        const stylePrefix = originalStyle ? `${originalStyle.replace(/;$/, '')}; ` : '';
        let themeNode = actor.get_theme_node();
        let startColor = themeNode.get_foreground_color();
        let targetRgb = this._hexToRgb(targetHexColor);
        const apply = (r, g, b, a) => {
            const rgba = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
            try {
                actor.set_style(`${stylePrefix}color: ${rgba}; -st-icon-foreground-color: ${rgba};`);
            }
            catch (e) { }
        };
        if (skipAnimations) {
            adaptiveColorTweener.cancel(actor);
            try {
                actor.set_style(`${stylePrefix}color: ${targetHexColor}; -st-icon-foreground-color: ${targetHexColor};`);
            }
            catch (e) { }
            return;
        }
        const startRgb = { r: startColor.red, g: startColor.green, b: startColor.blue };
        const startAlpha = startColor.alpha / 255.0;


        adaptiveColorTweener.add(actor, {
            startRgb, startAlpha,
            targetRgb, targetAlpha: 1.0,
            crossFade: resolveCrossFade(startRgb, targetRgb),
            durationMs,
            apply,
        }, batchStart);
    }
    _hasStyleClass(actor, className) {
        return typeof actor?.has_style_class_name === 'function' &&
            actor.has_style_class_name(className);
    }
    _laterAdd(laterType, callback) {
        return global.compositor?.get_laters?.().add(laterType, callback);
    }
}
