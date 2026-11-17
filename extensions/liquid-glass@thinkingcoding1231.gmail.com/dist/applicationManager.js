
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { LiquidEffect, noteStrandEntry } from './liquidEffect.js?v=fix1';
import GLib from 'gi://GLib';
import { UnpickableClone, UnpickableActor, InverseCornerEffect, getWindowActors, isActorValid, InvertedPositionConstraint, getAllocatedSize, setActorVisible, ensureGlassAllocated, isFrameSyncFrozen, getNestedGlassFix, innerGlassEffectOf, isFocusDebugEnabled, setTranslationIfChanged, setSizeIfChanged, setScaleIfChanged, setOpacityIfChanged, isCullSiteEnabled, rectsIntersect, setCloneCulled, createBackgroundMirror, reportClonedWindowActors, releaseClonedWindowActors, ensureWindowActorAllocated, glassRefreshDue, glassRefreshDone } from './utils.js?v=fix3';


















const GLASS_MIN_MARGIN = 10;



const SHADOW_MARGIN_HEADROOM = 20;


const GLASS_MAX_MARGIN = 100 + SHADOW_MARGIN_HEADROOM;

const CORNER_PADDING = 3;

































const CORNER_REVEAL_ENABLED = false;





































const BASE_LAYER_ENABLED = false;








const WINDOW_ACTOR_STRANDED_FRAMES = 14;


const WINDOW_ACTOR_RELAYOUT_FRAMES = 4;




















const MAX_ANCHOR_DISPLACEMENT = 256;





























const MAX_STRANDED_COUNTER_SCALE = 4;



const MENU_WINDOW_TYPES = [
    Meta.WindowType.DROPDOWN_MENU,
    Meta.WindowType.POPUP_MENU,
    Meta.WindowType.MENU,
];



const MAX_TRANSIENT_DEPTH = 8;
export class ApplicationManager {
    extensionPath;
    _states;
    _settings;
    _logger;
    _settingsSignals;
    _frameSyncId;



    _torndown = false;
    _windowCreatedId;
    _restackedId = 0;
    _rebuildQueued = false;








    _debugFocusLogFrames = 0;





    static CLONE_CULL_MARGIN = 48;
    static DEBUG_FOCUS_LOG_FRAME_COUNT = 8;
    _debugArmSignals = [];



    _displacedContainers = new Set();


    _strandedScaleWindows = new Set();












    _anomalousClones = new Set();




    _rebuildFollowupLaterId = 0;


    _glassMargin = GLASS_MIN_MARGIN;
    constructor(extensionPath, settings, logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
        this._states = new Map();
        this._settingsSignals = [];
        this._frameSyncId = 0;
        this._frameHeartbeatId = 0;
        this._idleFrameCount = 0;
        this._frameTicking = false;
        this._windowCreatedId = 0;
        this._mapId = 0;
        this._restackedId = 0;
    }
    setup() {
        this._logger.log("[Liquid Glass] ApplicationManager setup starting...");

        this._glassMargin = this._computeGlassMargin();
        this._bindSettings();

        const handleActor = (actor) => {
            if (!actor || !(actor instanceof Meta.WindowActor) || this._states.has(actor))
                return;
            const trySetup = () => {
                if (!isActorValid(actor) || this._states.has(actor))
                    return;
                const mw = typeof actor.get_meta_window === 'function' ? actor.get_meta_window() : null;
                if (mw) {
                    const r = mw.get_frame_rect();
                    if (!r || r.width <= 0 || r.height <= 0) {
                        return;
                    }
                }
                if (this._shouldApplyToWindow(actor) && !this._states.has(actor)) {
                    this._setupWindow(actor);
                    this._rebuildAllClones();
                }
            };

            actor.connect('notify::allocation', () => {
                if (!this._states.has(actor))
                    trySetup();
            });
            const metaWin = typeof actor.get_meta_window === 'function' ? actor.get_meta_window() : null;
            if (metaWin) {
                metaWin.connect('size-changed', () => {
                    if (!this._states.has(actor))
                        trySetup();
                });
            }
            if (actor.has_first_frame) {
                trySetup();
            } else {
                actor.connect('first-frame', () => trySetup());
            }
            actor.connect('notify::mapped', () => {
                if (actor.is_mapped())
                    trySetup();
            });
            if (actor.is_mapped()) {
                trySetup();
            }
        };

        this._windowCreatedId = global.display.connect('window-created', (_d, metaWindow) => {
            this._logger.log(`[Liquid Glass] window-created event: window title = "${metaWindow.get_title()}", class = "${metaWindow.get_wm_class()}"`);
            const obj = metaWindow.get_compositor_private();
            if (obj) {
                handleActor(obj);
            } else {
                const notifyId = metaWindow.connect('notify::compositor-private', () => {
                    const act = metaWindow.get_compositor_private();
                    if (act) {
                        metaWindow.disconnect(notifyId);
                        handleActor(act);
                    }
                });
            }
        });

        this._mapId = global.window_manager.connect('map', (_wm, actor) => {
            handleActor(actor);
        });

        this._restackedId = global.display.connect('restacked', () => {
            this._rebuildAllClones();
            this._armFocusDebug('restacked');
        });





        for (const sig of ['grab-op-end', 'grab-op-begin']) {
            try {
                this._debugArmSignals.push({
                    obj: global.display,
                    id: global.display.connect(sig, () => this._armFocusDebug(sig)),
                });
            }
            catch (e) {   }
        }
        this._logger.log("[Liquid Glass] checking if effect enabled in setup: " + this._isEffectEnabled());
        if (this._isEffectEnabled())
            this._applyEffects();
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
        this._teardownStep('displaySignals', () => {
            if (this._windowCreatedId) {
                global.display.disconnect(this._windowCreatedId);
                this._windowCreatedId = 0;
            }
            if (this._mapId) {
                global.window_manager.disconnect(this._mapId);
                this._mapId = 0;
            }
            if (this._restackedId) {
                global.display.disconnect(this._restackedId);
                this._restackedId = 0;
            }
        });
        this._teardownStep('debugArmSignals', () => {
            for (const sig of this._debugArmSignals) {
                try {
                    sig.obj.disconnect(sig.id);
                }
                catch (e) { }
            }
            this._debugArmSignals = [];
            this._displacedContainers.clear();
            this._strandedScaleWindows.clear();
        });
        this._teardownStep('settingsSignals', () => {
            this._settingsSignals.forEach(id => {
                try {
                    this._settings.disconnect(id);
                }
                catch (e) { }
            });
            this._settingsSignals = [];
        });
        this._teardownStep('removeAllEffects', () => this._removeAllEffects());
    }
    _bindSettings() {
        const connectSetting = (key, callback) => {
            let id = this._settings.connect(`changed::${key}`, callback);
            this._settingsSignals.push(id);
        };






        for (const profile of ['application', 'desktop-menu']) {
            connectSetting(this._profileEnableKey(profile), () => {
                this._logger.log(`[Liquid Glass] ${this._profileEnableKey(profile)} changed to: ` +
                    this._isProfileEnabled(profile));


                this._syncWhitelist();
                if (this._isEffectEnabled())
                    this._startFrameSync();
            });


            for (const suffix of ['tint-color', 'tint-strength', 'blur-radius', 'corner-radius',
                'brightness', 'contrast', 'saturation']) {
                connectSetting(this._profileKey(profile, suffix), () => this._updateEffectParams());
                if (profile === 'desktop-menu') {
                    connectSetting(`desktop-menu-${suffix}`, () => this._updateEffectParams());
                    connectSetting(`menu-${suffix}`, () => this._updateEffectParams());
                }
            }

            connectSetting(this._profileKey(profile, 'content-opacity'), () => this._updateWindowOpacities());
        }
        connectSetting('enable-menu-glass', () => {
            this._syncWhitelist();
            if (this._isEffectEnabled())
                this._startFrameSync();
        });

        connectSetting('application-glass-all-windows', () => this._syncWhitelist());
        connectSetting('application-window-whitelist', () => this._syncWhitelist());

        connectSetting('application-window-blacklist', () => this._syncWhitelist());



        connectSetting('shadow-radius', () => this._updateGlassMargin());
        connectSetting('shadow-intensity', () => this._updateGlassMargin());
    }
    _getContentOpacity(profile = 'application') {
        try {
            const key = this._profileKey(profile, 'content-opacity');
            if (this._settings.settings_schema?.has_key?.(key)) {
                return this._settings.get_double(key);
            }
        } catch (_) {}
        try {
            if (this._settings.settings_schema?.has_key?.('desktop-menu-content-opacity')) {
                return this._settings.get_double('desktop-menu-content-opacity');
            }
        } catch (_) {}
        return 1.0;
    }
    _updateWindowOpacities() {
        for (let state of this._states.values()) {
            const targetOpacity = Math.round(this._getContentOpacity(state.profile) * 255);



            if (isActorValid(state.surfaceActor)) {
                state.surfaceActor.opacity = targetOpacity;
            }
        }
    }

    _profileKey(profile, suffix) {
        if (profile === 'desktop-menu') {
            const menuKey = `menu-${suffix}`;
            if (suffix !== 'content-opacity' && this._settings.settings_schema?.has_key?.(menuKey)) {
                return menuKey;
            }
            return `desktop-menu-${suffix}`;
        }
        return `${profile}-${suffix}`;
    }

    _profileEnableKey(profile) {
        if (profile === 'desktop-menu') {
            return 'enable-desktop-menu-glass';
        }
        return `enable-${profile}-glass`;
    }
    _isProfileEnabled(profile) {
        if (profile === 'desktop-menu') {
            return this._settings.get_boolean('enable-desktop-menu-glass') ||
                   this._settings.get_boolean('enable-menu-glass');
        }
        return this._settings.get_boolean(this._profileEnableKey(profile));
    }








    _isEffectEnabled() {
        return this._isProfileEnabled('application') || this._isProfileEnabled('desktop-menu');
    }
    _getWhitelist() {
        let whitelist = this._settings.get_strv('application-window-whitelist');
        return whitelist;
    }
    _getBlacklist() {
        let blacklist = this._settings.get_strv('application-window-blacklist');
        return blacklist;
    }



    _listContainsClass(list, wmClass) {
        if (!wmClass)
            return false;
        const normalized = wmClass.toLowerCase();
        return list.some((entry) => entry.toLowerCase() === normalized);
    }
    _windowMatchesWhitelist(metaWindow) {
        if (!metaWindow)
            return false;
        const whitelist = this._getWhitelist();
        const appName = metaWindow.get_wm_class();
        const gtkAppId = metaWindow.get_gtk_application_id ? metaWindow.get_gtk_application_id() : null;
        if (whitelist.length === 0) {
            return false;
        }
        let ret = this._listContainsClass(whitelist, appName) || this._listContainsClass(whitelist, gtkAppId);
        if (!ret) {
            this._logger.log("[Liquid Glass] window is not in whitelist. name = " + appName);
        }
        else {
            this._logger.log("[Liquid Glass] window is in whitelist. name = " + appName);
        }
        return ret;
    }
    _windowMatchesBlacklist(metaWindow) {
        if (!metaWindow)
            return false;
        const blacklist = this._getBlacklist();
        if (blacklist.length === 0) {
            return false;
        }
        const appName = metaWindow.get_wm_class();
        const gtkAppId = metaWindow.get_gtk_application_id ? metaWindow.get_gtk_application_id() : null;
        const ret = this._listContainsClass(blacklist, appName) || this._listContainsClass(blacklist, gtkAppId);
        if (ret) {
            this._logger.log("[Liquid Glass] window is in blacklist, skipping. name = " + appName);
        }
        return ret;
    }























    _getRootWindow(metaWindow) {
        if (!metaWindow)
            return null;
        let curr = metaWindow;
        for (let depth = 0; depth < MAX_TRANSIENT_DEPTH; depth++) {
            try {
                const parent = curr.get_transient_for();
                if (!parent)
                    break;
                curr = parent;
            }
            catch (_) {
                break;
            }
        }
        return curr;
    }
    _isContextMenuWindow(metaWindow) {
        if (!metaWindow)
            return false;
        if (metaWindow.is_override_redirect())
            return false;
        if (!MENU_WINDOW_TYPES.includes(metaWindow.get_window_type()))
            return false;

        const rootWin = this._getRootWindow(metaWindow);

        if ((rootWin && this._windowMatchesBlacklist(rootWin)) || this._windowMatchesBlacklist(metaWindow)) {
            return false;
        }

        return true;
    }
    _getMenuArrowConfig(metaWindow, rect, visW, visH) {

        return { side: 0, origin: 0, base: 0, rise: 0, radius: 0, fillet: 0 };
    }





    _profileForWindow(windowActor) {
        const metaWindow = windowActor?.get_meta_window?.();
        if (!metaWindow)
            return null;


        if (this._isContextMenuWindow(metaWindow))
            return this._isProfileEnabled('desktop-menu') ? 'desktop-menu' : null;
        if (!this._isProfileEnabled('application'))
            return null;



        const applyAll = this._settings.get_boolean('application-glass-all-windows');
        if (applyAll) {
            const windowType = metaWindow.get_window_type();
            const isNormal = windowType === Meta.WindowType.NORMAL ||
                windowType === Meta.WindowType.DIALOG ||
                windowType === Meta.WindowType.MODAL_DIALOG;
            if (!isNormal) {
                this._logger.log(`[Liquid Glass] window "${metaWindow.get_title()}" has special type ${windowType}, skipping...`);
                return null;
            }
            if (this._windowMatchesBlacklist(metaWindow)) {
                return null;
            }
            return 'application';
        }
        return this._windowMatchesWhitelist(metaWindow) ? 'application' : null;
    }
    _shouldApplyToWindow(windowActor) {
        return this._profileForWindow(windowActor) !== null;
    }
    _applyEffects() {
        this._logger.log("[Liquid Glass] _applyEffects called");
        this._buildForExistingWindows();
        this._startFrameSync();
    }
    _removeAllEffects() {
        if (this._frameHeartbeatId) {
            GLib.source_remove(this._frameHeartbeatId);
            this._frameHeartbeatId = 0;
        }
        if (this._frameSyncId) {
            if (global.compositor?.get_laters) {
                global.compositor.get_laters().remove(this._frameSyncId);
            }
            this._frameSyncId = 0;
        }
        if (this._rebuildFollowupLaterId) {
            if (global.compositor?.get_laters) {
                global.compositor.get_laters().remove(this._rebuildFollowupLaterId);
            }
            this._rebuildFollowupLaterId = 0;
        }





        for (let state of this._states.values()) {
            try {
                this._cleanupState(state);
            }
            catch (e) {
                this._logger?.error(`[Liquid Glass] per-window cleanup failed: ${e}`);
            }
        }
        this._states.clear();
        this._rebuildQueued = false;
    }
    _syncWhitelist() {
        if (!this._isEffectEnabled()) {
            this._removeAllEffects();
            return;
        }
        for (let [actor, state] of [...this._states.entries()]) {



            if (this._profileForWindow(actor) !== state.profile) {
                this._cleanupState(state);
                this._states.delete(actor);
            }
        }
        for (let actor of getWindowActors()) {
            if (this._shouldApplyToWindow(actor) && !this._states.has(actor))
                this._setupWindow(actor);
        }
        this._rebuildAllClones();
    }









    _computeGlassMargin() {
        let radius = 0;
        let intensity = 0;
        try {
            radius = this._settings.get_double('shadow-radius');
            intensity = this._settings.get_double('shadow-intensity');
        }
        catch (e) {
            return GLASS_MIN_MARGIN;
        }
        if (!(radius > 0) || !(intensity > 0))
            return GLASS_MIN_MARGIN;
        return Math.min(GLASS_MAX_MARGIN, Math.max(GLASS_MIN_MARGIN, Math.ceil(radius) + SHADOW_MARGIN_HEADROOM));
    }










    _updateGlassMargin() {
        const next = this._computeGlassMargin();
        if (next === this._glassMargin)
            return;
        this._glassMargin = next;
        const shadowRoom = Math.max(0, next - SHADOW_MARGIN_HEADROOM);
        for (let state of this._states.values()) {
            try {
                state.effect.setPadding(next);
                state.effect.setShadowMaxRadius(shadowRoom);
                state.roundingEffect.setInset(next);
                state.geomSig = undefined;
            }
            catch (e) {
                this._logger.error(`[Liquid Glass] Failed to apply the new glass margin: ${e}`);
            }
        }
    }
    _updateEffectParams() {
        for (let state of this._states.values()) {
            const k = (suffix) => this._profileKey(state.profile, suffix);
            let tintColorStr = this._settings.get_string(k('tint-color'));
            let tintStrength = this._settings.get_double(k('tint-strength'));
            let blurRadius = this._settings.get_int(k('blur-radius'));
            let cornerRadius = this._settings.get_double(k('corner-radius'));
            let brightness = this._settings.get_double(k('brightness'));
            let contrast = this._settings.get_double(k('contrast'));
            let saturation = this._settings.get_double(k('saturation'));
            state.effect.setTintColor(...this._hexToColorArray(tintColorStr));
            state.effect.setTintStrength(tintStrength);
            state.effect.setCornerRadius(cornerRadius);
            state.radiusScaleApplied = 1;
            state.effect.setBlurRadius(blurRadius);
            state.effect.setBrightness(brightness);
            state.effect.setContrast(contrast);
            state.effect.setSaturation(saturation);
            state.roundingEffect.setRadius(cornerRadius + CORNER_PADDING);
            state.roundingEffect.setGlassRadius(cornerRadius);
            state.roundingEffect.setInset(this._cornerOverlayInset());
        }
    }










    _cornerOverlayInset() {
        return this._glassMargin;
    }












    _startFrameSync() {
        this._idleFrameCount = 0;
        if (this._frameSyncId === 0)
            this._frameTick();
    }
    _scheduleFrameHeartbeat() {
        if (this._frameHeartbeatId || this._torndown)
            return;

        this._frameHeartbeatId = GLib.timeout_add(GLib.PRIORITY_LOW, 1500, () => {
            this._frameHeartbeatId = 0;
            if (!this._torndown && this._states.size > 0) {
                this._startFrameSync();
                this._scheduleFrameHeartbeat();
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    _rebuildAllClones() {
        if (this._rebuildQueued)
            return;
        this._rebuildQueued = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._states.size === 0) {
                this._rebuildQueued = false;
                return GLib.SOURCE_REMOVE;
            }
            for (let state of this._states.values()) {
                this._rebuildWindowClones(state);
            }
            this._rebuildQueued = false;
























            const FOLLOWUP_FRAME_COUNT = 0;
            let followupFramesLeft = FOLLOWUP_FRAME_COUNT;



            const runFollowup = () => {
                followupFramesLeft--;
                if (this._states.size > 0) {
                    for (let state of this._states.values()) {
                        this._rebuildWindowClones(state);
                    }
                }
                if (followupFramesLeft > 0) {
                    this._rebuildFollowupLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, runFollowup);
                }
                else {
                    this._rebuildFollowupLaterId = 0;
                }
                return GLib.SOURCE_REMOVE;
            };
            this._rebuildFollowupLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, runFollowup);
            return GLib.SOURCE_REMOVE;
        });
    }
    _buildForExistingWindows() {
        for (let actor of getWindowActors()) {
            if (this._shouldApplyToWindow(actor))
                this._setupWindow(actor);
        }
    }
    _setupWindow(windowActor) {
        if (!windowActor || !(windowActor instanceof Meta.WindowActor) || this._states.has(windowActor))
            return;
        const profile = this._profileForWindow(windowActor);
        if (!profile)
            return;
        let surfaceActor = windowActor.get_first_child();
        if (!surfaceActor) {
            return;
        }
        let parent = windowActor.get_parent();
        if (!parent)
            return;






















        //      the symptom also happened with only partial coverage. NOT









        let originalOpacity = surfaceActor.opacity;
        surfaceActor.opacity = Math.round(this._getContentOpacity(profile) * 255);








        let baseActor = new St.Widget({
            name: 'lgw-base',
            style_class: 'liquid-glass-base-actor',
            reactive: false,
            clip_to_allocation: true,
            visible: true,
        });
        windowActor.insert_child_below(baseActor, surfaceActor);
        if (!BASE_LAYER_ENABLED)
            setActorVisible(baseActor, false);
        let bgActor = new St.Widget({
            name: 'lgw-bg',
            style_class: 'liquid-glass-bg-actor',
            reactive: false,
            clip_to_allocation: false,
            visible: true,
        });
        windowActor.insert_child_above(bgActor, baseActor);































        let clipBox = new St.Widget({
            name: 'lgw-clipbox',
            clip_to_allocation: true,
            reactive: false,
        });
        bgActor.add_child(clipBox);

        let monitor = Main.layoutManager.primaryMonitor;




        let baseClone = createBackgroundMirror('lgw-base-wallpaper-clone');
        if (monitor) {
            baseClone.set_size(monitor.width, monitor.height);
        }
        baseActor.add_child(baseClone);
        let baseWindowsContainer = new Clutter.Actor();
        baseWindowsContainer.set_name('lgw-base-windows');
        baseActor.add_child(baseWindowsContainer);
        let bgClone = createBackgroundMirror('lgw-bg-wallpaper-clone');
        if (monitor) {
            bgClone.set_size(monitor.width, monitor.height);
        }
        clipBox.add_child(bgClone);

        const metaWin = typeof windowActor.get_meta_window === 'function' ? windowActor.get_meta_window() : null;
        const parentWin = metaWin && typeof metaWin.get_transient_for === 'function' ? metaWin.get_transient_for() : null;
        const isParentDesktop = parentWin && typeof parentWin.get_window_type === 'function' && parentWin.get_window_type() === Meta.WindowType.DESKTOP;
        const isSubsurfaceMenu = profile === 'desktop-menu' && metaWin && parentWin && !isParentDesktop;
        if (profile === 'desktop-menu') {
            setActorVisible(bgClone, true);
            if (BASE_LAYER_ENABLED) {
                setActorVisible(baseClone, true);
            }
        }
        let effect = new LiquidEffect({
            extensionPath: this.extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: profile,
        });
        const k = (suffix) => this._profileKey(profile, suffix);
        let tintColorStr = this._settings.get_string(k('tint-color'));
        let tintStrength = this._settings.get_double(k('tint-strength'));
        let cornerRadius = this._settings.get_double(k('corner-radius'));
        let blurRadius = this._settings.get_int(k('blur-radius'));
        let brightness = this._settings.get_double(k('brightness'));
        let contrast = this._settings.get_double(k('contrast'));
        let saturation = this._settings.get_double(k('saturation'));
        effect.setPadding(this._glassMargin);
        effect.setTintColor(...this._hexToColorArray(tintColorStr));
        effect.setTintStrength(tintStrength);
        effect.setCornerRadius(cornerRadius);
        effect.setBlurRadius(blurRadius);
        effect.setBrightness(brightness);
        effect.setContrast(contrast);
        effect.setSaturation(saturation);
        effect.setIsDock(false);






        if (profile === 'desktop-menu') {
            effect.setSurfaceLightEnabled(true);
            effect.setCornerRadius(cornerRadius || 20.0);
            effect.setTintColor(...this._hexToColorArray(tintColorStr));
            effect.setTintStrength(tintStrength);
            effect.setBlurRadius(blurRadius || 10);
            effect.setArrow(0, 0, 0, 0);
            surfaceActor.opacity = 255;
        } else {
            effect.setSurfaceLightEnabled(false);
            effect.setArrow(0, 0, 0, 0);
        }


        effect.setShadowMaxRadius(Math.max(0, this._glassMargin - SHADOW_MARGIN_HEADROOM));
        bgActor.add_effect(effect);
        let windowsContainer = new Clutter.Actor();
        windowsContainer.set_name('lgw-bg-windows');
        clipBox.add_child(windowsContainer);
        let cornerOverlay = new UnpickableActor({
            name: 'lgw-corner-overlay',
            clip_to_allocation: true,
            reactive: false,
        });
        let cornerOverlayClone = new UnpickableClone({ source: baseActor });
        cornerOverlayClone.set_name('lgw-corner-overlay-clone');
        cornerOverlay.add_child(cornerOverlayClone);
        let roundingEffect = new InverseCornerEffect();
        roundingEffect.setRadius(cornerRadius + CORNER_PADDING);
        roundingEffect.setGlassRadius(cornerRadius);
        roundingEffect.setInset(this._cornerOverlayInset());
        cornerOverlay.add_effect(roundingEffect);
        windowActor.add_child(cornerOverlay);
        if (!CORNER_REVEAL_ENABLED)
            setActorVisible(cornerOverlay, false);
        const createConstraint = () => new InvertedPositionConstraint({
            source: windowActor,
            offset_x: -this._glassMargin,
            offset_y: -this._glassMargin
        });
        const constraints = {
            bg: createConstraint(),
            windows: createConstraint(),
            base: createConstraint(),
            baseWindows: createConstraint()
        };
        bgClone.add_constraint(constraints.bg);
        windowsContainer.add_constraint(constraints.windows);
        baseClone.add_constraint(constraints.base);
        baseWindowsContainer.add_constraint(constraints.baseWindows);
        let state = {
            windowActor,
            surfaceActor,
            bgActor,
            clipBox,
            bgClone,
            windowsContainer,
            clones: new Map(),
            effect,
            baseActor,
            baseClone,
            baseWindowsContainer,
            baseClones: new Map(),
            roundingEffect,
            cornerOverlay,
            cornerOverlayClone,
            signals: [],
            originalOpacity,
            profile,
            isDirty: true,
            constraints,
        };
        this._states.set(windowActor, state);
        this._startFrameSync();
        this._scheduleFrameHeartbeat();
        this._rebuildWindowClones(state);
        this._syncState(state);

        state.signals.push({
            obj: windowActor,
            id: windowActor.connect('notify::allocation', () => {
                state.isDirty = true;
                this._startFrameSync();
            })
        });





























        state.signals.push({
            obj: windowActor,
            id: windowActor.connect('notify::mapped', () => {
                if (!isActorValid(windowActor) || !windowActor.mapped)
                    return;
                this._startFrameSync();
                this._forceGlassReallocation(state);
            })
        });

        if (metaWin) {
            state.signals.push({
                obj: metaWin,
                id: metaWin.connect('size-changed', () => {


                    state.frameLocal = undefined;
                    this._rebuildWindowClones(state);

                    state.isDirty = true;
                    this._startFrameSync();
                })
            });
            state.signals.push({
                obj: metaWin,
                id: metaWin.connect('position-changed', () => {

                    state.isDirty = true;
                    this._startFrameSync();
                })
            });
        }

        global.compositor.get_laters().add(Meta.LaterType.IDLE, () => {
            if (this._states.has(windowActor)) {

                state.isDirty = true;
            }
            return false;
        });













        state.signals.push({
            obj: windowActor,
            id: windowActor.connect('destroy', () => {
                if (this._torndown)
                    return;
                this._cleanupState(state);
                this._states.delete(windowActor);
                this._rebuildAllClones();
            })
        });
    }
    _hexToColorArray(hex) {
        if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7)
            return [1.0, 1.0, 1.0];
        let r = parseInt(hex.slice(1, 3), 16) / 255.0;
        let g = parseInt(hex.slice(3, 5), 16) / 255.0;
        let b = parseInt(hex.slice(5, 7), 16) / 255.0;
        return [r, g, b];
    }
    _rebuildWindowClones(state) {
        state.clones.forEach(clone => clone.destroy());
        state.clones.clear();
        state.windowsContainer.remove_all_children();
        state.baseClones.forEach(clone => clone.destroy());
        state.baseClones.clear();
        state.baseWindowsContainer.remove_all_children();
        const debugLog = this._debugFocusLogFrames > 0;
        if (debugLog) {
            const titles = getWindowActors().map((a) => {
                const mw = typeof a.get_meta_window === 'function' ? a.get_meta_window() : null;
                return mw ? (mw.get_title() || '(untitled)') : '(?)';
            });
            const ownTitle = (() => {
                const mw = state.windowActor.get_meta_window();
                return mw ? (mw.get_title() || '(untitled)') : '(?)';
            })();
            this._logger.log(`[Liquid Glass][focus-debug] _rebuildWindowClones for="${ownTitle}" ` +
                `stackingOrder=[${titles.join(', ')}]`);
        }

        for (let actor of getWindowActors()) {




            if (actor === state.windowActor) {
                if (state.profile === 'desktop-menu') {
                    continue;
                }
                break;
            }
            if (!(actor instanceof Meta.WindowActor))
                continue;

            if (state.profile === 'desktop-menu') {
                const mw = typeof actor.get_meta_window === 'function' ? actor.get_meta_window() : null;
                if (mw) {
                    const type = mw.get_window_type();
                    if (type === Meta.WindowType.DROPDOWN_MENU ||
                        type === Meta.WindowType.POPUP_MENU ||
                        type === Meta.WindowType.MENU ||
                        type === Meta.WindowType.TOOLTIP) {
                        continue;
                    }
                }
            }



















            let [srcW, srcH] = getAllocatedSize(actor);
            if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
                continue;
            }
            let clone = new UnpickableClone({ source: actor });
            const behindTitle = (() => {
                try {
                    const mw = actor.get_meta_window();
                    return (mw && mw.get_title()) || '(untitled)';
                }
                catch (_) {
                    return '(?)';
                }
            })();
            clone.set_name(`lgw-behind:${behindTitle}`);
















            clone.set_position(0, 0);
            clone.translation_x = actor.x;
            clone.translation_y = actor.y;
            clone.set_size(srcW, srcH);
            clone.set_scale(actor.scale_x, actor.scale_y);
            clone.opacity = actor.opacity;
            state.windowsContainer.add_child(clone);
            state.clones.set(actor, clone);


            if (BASE_LAYER_ENABLED) {
                let baseClone = new UnpickableClone({ source: actor });
                baseClone.set_name(`lgw-base-behind:${behindTitle}`);
                baseClone.set_position(0, 0);
                baseClone.translation_x = actor.x;
                baseClone.translation_y = actor.y;
                baseClone.set_size(srcW, srcH);
                baseClone.set_scale(actor.scale_x, actor.scale_y);
                baseClone.opacity = actor.opacity;
                state.baseWindowsContainer.add_child(baseClone);
                state.baseClones.set(actor, baseClone);
            }
        }
    }
















    _frameLocalOffset(state, actor, rect, bufferRect) {
        const px = actor.x;
        const py = actor.y;
        const prev = state.frameLocalActorPos;
        const stationary = !!prev && prev[0] === px && prev[1] === py;
        state.frameLocalActorPos = [px, py];
        if (!state.frameLocal || stationary) {
            const fx = rect.x - bufferRect.x;
            const fy = rect.y - bufferRect.y;
            if (Number.isFinite(fx) && Number.isFinite(fy)) {
                state.frameLocal = [fx, fy];
            }
        }
        return state.frameLocal ?? [0, 0];
    }

















































    _applyCounterScale(child, windowActor, dx, dy, w, h) {
        const [sx, sy] = this._animationScale(windowActor);
        child.set_pivot_point(0, 0);
        child.remove_clip();
        child.set_size(w, h);
        if (sx === 1 && sy === 1) {
            child.set_scale(1, 1);
            child.set_position(dx, dy);
            return;
        }
        child.set_scale(1 / sx, 1 / sy);
        child.set_position(dx / sx, dy / sy);
    }



    _animationScale(windowActor) {
        let [sx, sy] = windowActor.get_scale();
        if (!Number.isFinite(sx) || sx <= 0)
            sx = 1;
        if (!Number.isFinite(sy) || sy <= 0)
            sy = 1;
        return [sx, sy];
    }







    _syncAnimatedCornerRadius(state, scale) {
        const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
        if (state.radiusScaleApplied === s)
            return;
        state.radiusScaleApplied = s;
        const cornerRadius = this._settings.get_double(this._profileKey(state.profile, 'corner-radius'));
        state.effect.setCornerRadius(cornerRadius * s);
        state.roundingEffect.setRadius((cornerRadius + CORNER_PADDING) * s);
        state.roundingEffect.setGlassRadius(cornerRadius * s);
    }
    _syncState(state) {
        let actor = state.windowActor;
        if (!actor || !actor.get_stage() || !actor.mapped) {
            state.bgActor.visible = false;
            state.baseActor.visible = false;
            state.cornerOverlay.visible = false;



            state.geomSig = undefined;
            return;
        }
        const metaWin = actor.get_meta_window();
        if (!metaWin)
            return;
        state.effect.beginBatch();
        try {
            this._syncStateInner(state, actor, metaWin);
        }
        finally {







            state.effect.endBatch();
        }
    }





    _syncStateInner(state, actor, metaWin) {

        const workspaceManager = global.workspace_manager;
        const activeWorkspace = workspaceManager.get_active_workspace();
        const winWorkspace = metaWin.get_workspace();
        if (winWorkspace && winWorkspace !== activeWorkspace) {
            setActorVisible(state.bgActor, false);
            setActorVisible(state.baseActor, false);
            setActorVisible(state.cornerOverlay, false);




            state.geomSig = undefined;
            return;
        }
        if (this._debugFocusLogFrames > 0)
            this._logFocusDebugInfo(state);
        const rect = metaWin.get_frame_rect();
        const bufferRect = metaWin.get_buffer_rect();
        if (!rect || !bufferRect || rect.width <= 0 || rect.height <= 0) {
            setActorVisible(state.bgActor, false);
            setActorVisible(state.baseActor, false);
            setActorVisible(state.cornerOverlay, false);




            state.geomSig = undefined;
            return;
        }
        setActorVisible(state.bgActor, true);
        setActorVisible(state.baseActor, BASE_LAYER_ENABLED);






















        const frameLocal = this._frameLocalOffset(state, actor, rect, bufferRect);
        const frameLocalX = frameLocal[0];
        const frameLocalY = frameLocal[1];








        const margin = this._glassMargin;
        const [sx, sy] = this._animationScale(actor);
        const visW = rect.width * sx;
        const visH = rect.height * sy;



        const frameDX = frameLocalX * sx;
        const frameDY = frameLocalY * sy;





        const baseActorW = visW + (margin * 2);
        const baseActorH = visH + (margin * 2);
























        const [pivotFxEarly, pivotFyEarly] = actor.get_pivot_point();
        const [actorWEarly, actorHEarly] = getAllocatedSize(actor);
        const anchorOffByEarly = this._checkContainerAnchor(state);






        if (this._counterScaleWouldStrand(state)) {



            this._setGlassStrandHidden(state, true);
            state.geomSig = undefined;
            return;
        }
        const GEOM_SIG_LEN = 16;
        let sig = state.geomSig;
        if (!sig || sig.length !== GEOM_SIG_LEN) {
            sig = new Float64Array(GEOM_SIG_LEN);


            sig.fill(NaN);
            state.geomSig = sig;
        }
        let geomUnchanged = anchorOffByEarly <= MAX_ANCHOR_DISPLACEMENT;
        const sigValues = [
            rect.x, rect.y, rect.width, rect.height,
            bufferRect.x, bufferRect.y, bufferRect.width, bufferRect.height,
            frameLocalX, frameLocalY,
            sx, sy,
            actor.translation_x || 0, actor.translation_y || 0,
            pivotFxEarly * (Number.isFinite(actorWEarly) ? actorWEarly : 0),
            pivotFyEarly * (Number.isFinite(actorHEarly) ? actorHEarly : 0),
        ];
        for (let i = 0; i < GEOM_SIG_LEN; i++) {
            if (sig[i] !== sigValues[i]) {
                geomUnchanged = false;
                sig[i] = sigValues[i];
            }
        }
        if (geomUnchanged) {
            this._syncClones(state);
            return;
        }
        state.effect?.markBackdropDirty?.();
        if (BASE_LAYER_ENABLED)
            this._applyCounterScale(state.baseActor, actor, frameDX - margin, frameDY - margin, baseActorW, baseActorH);

        const bgW = visW + (margin * 2);
        const bgH = visH + (margin * 2);
        const localX = frameDX - margin;
        const localY = frameDY - margin;
        this._applyCounterScale(state.bgActor, actor, localX, localY, bgW, bgH);












        state.glassScreenRect = [
            actor.x + (actor.translation_x || 0) + localX,
            actor.y + (actor.translation_y || 0) + localY,
            bgW,
            bgH,
        ];
        state.clipBox.set_position(0, 0);
        state.clipBox.set_size(bgW, bgH);

        state.windowsContainer.set_size(bgW, bgH);
        if (BASE_LAYER_ENABLED)
            state.baseWindowsContainer.set_size(baseActorW, baseActorH);




        if (state.effect) {
            state.effect.setResolution(bgW, bgH);
            if (state.profile === 'desktop-menu') {
                const arrowCfg = this._getMenuArrowConfig(metaWin, rect, visW, visH);
                if (arrowCfg.side === 1) {
                    state.effect.setGlassGeometry(0, arrowCfg.rise, bgW, bgH - arrowCfg.rise);
                    state.effect.setArrow(1, arrowCfg.origin, arrowCfg.base, arrowCfg.rise, arrowCfg.radius, arrowCfg.fillet);
                } else if (arrowCfg.side === 3) {
                    state.effect.setGlassGeometry(0, 0, bgW, bgH - arrowCfg.rise);
                    state.effect.setArrow(3, arrowCfg.origin, arrowCfg.base, arrowCfg.rise, arrowCfg.radius, arrowCfg.fillet);
                } else {
                    state.effect.setGlassGeometry(0, 0, bgW, bgH);
                    state.effect.setArrow(0, 0, 0, 0);
                }
            } else {
                state.effect.setGlassGeometry(0, 0, bgW, bgH);
                state.effect.setArrow(0, 0, 0, 0);
            }
        }





        this._syncAnimatedCornerRadius(state, sx);





        const anchorOffBy = anchorOffByEarly;































        const pivotPxX = (Number.isFinite(pivotFxEarly) ? pivotFxEarly : 0) * (Number.isFinite(actorWEarly) ? actorWEarly : 0);
        const pivotPxY = (Number.isFinite(pivotFyEarly) ? pivotFyEarly : 0) * (Number.isFinite(actorHEarly) ? actorHEarly : 0);
        const anchorDX = (actor.translation_x || 0) + pivotPxX * (1 - sx);
        const anchorDY = (actor.translation_y || 0) + pivotPxY * (1 - sy);
        const offsetX = -anchorDX - localX;
        const offsetY = -anchorDY - localY;




        state.constraints.bg.setOffset(offsetX, offsetY);
        state.constraints.windows.setOffset(offsetX, offsetY);
        if (BASE_LAYER_ENABLED) {
            state.constraints.base.setOffset(offsetX, offsetY);
            state.constraints.baseWindows.setOffset(offsetX, offsetY);
        }
        this._syncClones(state);





        setActorVisible(state.cornerOverlay, CORNER_REVEAL_ENABLED);
        if (CORNER_REVEAL_ENABLED) {
            const baseW = visW + (margin * 2);
            const baseH = visH + (margin * 2);
            this._applyCounterScale(state.cornerOverlay, actor, frameDX - margin, frameDY - margin, baseW, baseH);
            state.cornerOverlayClone.set_position(0, 0);
            state.cornerOverlayClone.set_size(baseW, baseH);
        }









        if (anchorOffBy > MAX_ANCHOR_DISPLACEMENT) {



            this._setGlassStrandHidden(state, true);




            state.geomSig = undefined;
        }
        else {
            this._setGlassStrandHidden(state, false);
        }
    }

























    _repairNestedGlass(state) {
        const mode = getNestedGlassFix();
        if (mode === 'off')
            return;
        const bg = state.bgActor;
        if (!bg || !isActorValid(bg) || !bg.mapped || !bg.visible)
            return;




        if (mode === 'damage') {
            this._syncDamageHooks(state);
            return;
        }



        if (mode === 'recapture') {
            bg.queue_redraw();
            return;
        }




        let seen = state.nestedSerials;
        if (!seen) {
            seen = new Map();
            state.nestedSerials = seen;
        }
        let stale = false;
        for (const [src, clone] of state.clones.entries()) {
            if (!isActorValid(clone) || !clone.visible)
                continue;
            const inner = innerGlassEffectOf(src);
            if (!inner)
                continue;
            const serial = inner._recaptureSerial;
            if (seen.get(src) !== serial) {
                seen.set(src, serial);
                stale = true;
            }
        }


        if (seen.size > state.clones.size) {
            for (const src of [...seen.keys()])
                if (!state.clones.has(src))
                    seen.delete(src);
        }
        if (stale)
            bg.queue_redraw();
    }




















    _syncDamageHooks(state) {
        let hooks = state.damageHooks;
        if (!hooks) {
            hooks = new Map();
            state.damageHooks = hooks;
        }
        for (const src of state.clones.keys()) {
            if (hooks.has(src))
                continue;
            if (!isActorValid(src))
                continue;
            try {
                const id = src.connect('damaged', () => {
                    state.isDirty = true;
                    state.effect?.markBackdropDirty?.();
                    const bg = state.bgActor;
                    if (bg && isActorValid(bg) && bg.mapped && bg.visible) {
                        bg.queue_redraw();
                        this._startFrameSync();
                    }
                });
                hooks.set(src, id);
            }
            catch (_) {   }
        }


        if (hooks.size > state.clones.size) {
            for (const [src, id] of [...hooks]) {
                if (state.clones.has(src))
                    continue;
                try {
                    if (isActorValid(src))
                        src.disconnect(id);
                }
                catch (_) { }
                hooks.delete(src);
            }
        }
    }
    _releaseDamageHooks(state) {
        if (!state.damageHooks)
            return;
        for (const [src, id] of state.damageHooks) {
            try {
                if (isActorValid(src))
                    src.disconnect(id);
            }
            catch (_) { }
        }
        state.damageHooks.clear();
        state.damageHooks = undefined;
    }
    _syncClones(state) {

















        const [animSx, animSy] = this._animationScale(state.windowActor);
        const cullRect = (isCullSiteEnabled('app') && animSx === 1 && animSy === 1)
            ? state.glassScreenRect
            : undefined;


        let clonesChanged = false;
        for (let [src, clone] of state.clones.entries()) {
            if (!isActorValid(src) || !src.visible || !src.mapped) {
                if (isActorValid(clone))
                    setActorVisible(clone, false);
                this._clearCloneAnomaly(clone);
                continue;
            }
            if (isActorValid(clone)) {
                if (this._shouldCullClone(src, cullRect)) {
                    setCloneCulled(clone, true, this._cullWhy(src, cullRect, 'blurred'));
                    this._clearCloneAnomaly(clone);
                    continue;
                }
                setCloneCulled(clone, false, 'app/blurred');
                setActorVisible(clone, true);





                if (clone.x !== 0 || clone.y !== 0)
                    clone.set_position(0, 0);
                clonesChanged = setTranslationIfChanged(clone, src.x, src.y) || clonesChanged;
                clonesChanged = setSizeIfChanged(clone, src.width, src.height) || clonesChanged;
                clonesChanged = setScaleIfChanged(clone, src.scale_x, src.scale_y) || clonesChanged;
                clonesChanged = setOpacityIfChanged(clone, src.opacity) || clonesChanged;
                this._checkCloneAnomaly(clone, src, 'blurred');
            }
        }
        if (clonesChanged) {
            state.effect?.markBackdropDirty?.();
        }
        this._syncDamageHooks(state);



        reportClonedWindowActors(state, state.clones.keys());
        this._repairNestedGlass(state);


        if (!BASE_LAYER_ENABLED)
            return;
        for (let [src, clone] of state.baseClones.entries()) {
            if (!isActorValid(src) || !src.visible || !src.mapped) {
                if (isActorValid(clone))
                    setActorVisible(clone, false);
                this._clearCloneAnomaly(clone);
                continue;
            }
            if (isActorValid(clone)) {
                if (this._shouldCullClone(src, cullRect)) {
                    setCloneCulled(clone, true, this._cullWhy(src, cullRect, 'base'));
                    this._clearCloneAnomaly(clone);
                    continue;
                }
                setCloneCulled(clone, false, 'app/base');
                setActorVisible(clone, true);
                if (clone.x !== 0 || clone.y !== 0)
                    clone.set_position(0, 0);
                setTranslationIfChanged(clone, src.x, src.y);
                setSizeIfChanged(clone, src.width, src.height);
                setScaleIfChanged(clone, src.scale_x, src.scale_y);
                setOpacityIfChanged(clone, src.opacity);
                this._checkCloneAnomaly(clone, src, 'base');
            }
        }
    }









    _checkCloneAnomaly(clone, src, kind) {
        let mapped = true, w = -1, h = -1;
        try {
            mapped = clone.mapped;
        }
        catch (e) { }
        try {
            [w, h] = clone.get_size();
        }
        catch (e) { }
        const degenerate = !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0;
        const anomalous = !mapped || degenerate;
        if (anomalous && !this._anomalousClones.has(clone)) {
            this._anomalousClones.add(clone);
            const srcMetaWindow = typeof src.get_meta_window === 'function' ? src.get_meta_window() : null;
            const srcTitle = srcMetaWindow ? (srcMetaWindow.get_title() || '(untitled)') : '(?)';
            this._logger.log(`[Liquid Glass][clone-anomaly] ENTER kind=${kind} src="${srcTitle}" ` +
                `mapped=${mapped} size=(${w}x${h}) ` +
                `clone.(x,y)=(${clone.x},${clone.y}) clone.visible=${clone.visible} clone.opacity=${clone.opacity}`);
        }
        else if (!anomalous && this._anomalousClones.has(clone)) {
            this._anomalousClones.delete(clone);
            const srcMetaWindow = typeof src.get_meta_window === 'function' ? src.get_meta_window() : null;
            const srcTitle = srcMetaWindow ? (srcMetaWindow.get_title() || '(untitled)') : '(?)';
            this._logger.log(`[Liquid Glass][clone-anomaly] EXIT kind=${kind} src="${srcTitle}"`);
        }
    }
    _clearCloneAnomaly(clone) {
        this._anomalousClones.delete(clone);
    }















    _cullWhy(src, cullRect, kind) {
        const [w, h] = getAllocatedSize(src);
        return `src=(${Math.round(src.x)},${Math.round(src.y)},${Math.round(w)}x${Math.round(h)}) ` +
            `glassRect=[${cullRect.map(Math.round)}] app/${kind}`;
    }
    _shouldCullClone(src, cullRect) {
        if (!cullRect)
            return false;
        const [w, h] = getAllocatedSize(src);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
            return false;
        const x = src.x, y = src.y;
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return false;
        const m = ApplicationManager.CLONE_CULL_MARGIN;
        return !rectsIntersect(x - m, y - m, w + m * 2, h + m * 2, cullRect);
    }
    _frameTick() {
        if (this._frameTicking)
            return;

        this._frameTicking = true;
        try {
            this._runFrameTick();
        } finally {
            this._frameTicking = false;
        }
    }
    _runFrameTick() {
        let needsAnotherFrame = false;
        if (this._torndown)
            return;
        if (!this._states || this._states.size === 0) {
            this._frameSyncId = 0;
            return;
        }


        if (isFrameSyncFrozen()) {
            this._frameSyncId = 0;
            this._scheduleFrameHeartbeat();
            return;
        }
        for (let state of this._states.values()) {
            try {
                const metaWin = state.windowActor?.get_meta_window?.();


                if (!metaWin)
                    continue;








































                try {
                    const label = metaWin.get_title() || '(untitled)';
                    if (state.effect._diagOwnerLabel !== label)
                        state.effect._diagOwnerLabel = label;
                }
                catch (_) {   }
                const rescue = ensureWindowActorAllocated(state.windowActor, WINDOW_ACTOR_RELAYOUT_FRAMES, WINDOW_ACTOR_STRANDED_FRAMES);
                if (rescue) {
                    const title = metaWin.get_title() || '(untitled)';

                    noteStrandEntry(title, `wa.alloc=${state.windowActor.has_allocation()} ` +
                        `wg.alloc=${(() => {
                            const p = state.windowActor.get_parent();
                            return p ? p.has_allocation() : '-';
                        })()} ` +
                        `scale=${state.windowActor.scale_x.toFixed(3)} op=${state.windowActor.opacity} ` +
                        `min=${metaWin.minimized} stage=${rescue}`);






                    this._logger.log(`[Liquid Glass][strand] ${rescue} for "${title}" — ` +
                        `wa(mapped=${state.windowActor.mapped},vis=${state.windowActor.visible},` +
                        `alloc=${state.windowActor.has_allocation()},op=${state.windowActor.opacity},` +
                        `scale=${state.windowActor.scale_x.toFixed(3)}) ` +
                        `parent(${(() => {
                            const p = state.windowActor.get_parent();
                            return p ? `${p.constructor?.name},mapped=${p.mapped},alloc=${p.has_allocation()}` : 'none';
                        })()}) ` +
                        `bg(mapped=${state.bgActor.mapped},vis=${state.bgActor.visible},` +
                        `alloc=${state.bgActor.has_allocation()}) ` +
                        `min=${metaWin.minimized}`);
                }
                ensureGlassAllocated(state.bgActor);
                ensureGlassAllocated(state.baseActor);
                ensureGlassAllocated(state.cornerOverlay);






                const refreshDue = glassRefreshDue(state.bgActor);
                if (refreshDue || state.isDirty) {
                    needsAnotherFrame = true;
                    state.isDirty = false;
                    this._syncState(state);
                    glassRefreshDone(state.bgActor);
                }
                if (this._debugFocusLogFrames > 0)
                    this._logFocusDebugInfo(state);
            }
            catch (e) {
                this._logger.error(`[Liquid Glass] Error in _syncState: ${e}`);
            }
        }
        if (this._debugFocusLogFrames > 0)
            this._debugFocusLogFrames--;
        this._idleFrameCount = needsAnotherFrame ? 0 : this._idleFrameCount + 1;
        if (this._idleFrameCount < 8 && this._states.size > 0) {
            this._frameSyncId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._frameTick();
                return false;
            });
        } else {
            this._frameSyncId = 0;
        }
    }










    _armFocusDebug(reason) {





        if (!isFocusDebugEnabled())
            return;
        this._debugFocusLogFrames = ApplicationManager.DEBUG_FOCUS_LOG_FRAME_COUNT;
        this._logger.log(`[Liquid Glass][focus-debug] ---- ${reason} event ----`);
    }







































    _forceGlassReallocation(state) {
        if (state.remapReallocLaterId)
            return;
        state.remapReallocLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            state.remapReallocLaterId = 0;
            try {
                if (this._torndown || !this._states.has(state.windowActor))
                    return false;
                if (!isActorValid(state.windowActor) || !state.windowActor.mapped)
                    return false;
                let rescued = 0;
                for (const actor of [state.bgActor, state.baseActor,
                    state.cornerOverlay, state.windowsContainer]) {
                    if (isActorValid(actor) && ensureGlassAllocated(actor, 1))
                        rescued++;
                }
                state.isDirty = true;
                if (rescued > 0) {
                    const metaWin = state.windowActor.get_meta_window();
                    const title = metaWin ? (metaWin.get_title() || '(untitled)') : '(?)';
                    this._logger.log(`[Liquid Glass][min-restore] re-allocated ${rescued} glass actor(s) for ` +
                        `"${title}" after its window actor was remapped`);
                }
            }
            catch (e) {
                this._logger.error(`[Liquid Glass] _forceGlassReallocation failed: ${e}`);
            }
            return false;
        });
    }





























    _setGlassStrandHidden(state, hidden) {
        const wanted = hidden ? 0 : 255;
        for (const actor of [state.bgActor, state.baseActor, state.cornerOverlay]) {
            if (!isActorValid(actor))
                continue;
            if (actor.opacity !== wanted)
                actor.opacity = wanted;
        }
    }
    _counterScaleWouldStrand(state) {
        const container = state.windowsContainer;
        if (!isActorValid(container))
            return false;
        const [sx, sy] = this._animationScale(state.windowActor);
        const counterScale = Math.max(1 / sx, 1 / sy);
        let stranded = false;
        if (counterScale > MAX_STRANDED_COUNTER_SCALE) {
            try {
                stranded = !container.has_allocation();
            }
            catch (_) {
                stranded = false;
            }
        }
        const known = this._strandedScaleWindows.has(container);
        if (stranded && !known) {
            this._strandedScaleWindows.add(container);
            const metaWin = state.windowActor.get_meta_window();
            const title = metaWin ? (metaWin.get_title() || '(untitled)') : '(?)';
            this._logger.log(`[Liquid Glass][anchor] REFUSED window="${title}" ` +
                `counterScale=${counterScale.toFixed(1)}x scale=(${sx.toFixed(4)},${sy.toFixed(4)}) ` +
                `container.hasAlloc=false — glass hidden for this frame rather than ` +
                `written with a transform the stale allocation cannot cancel`);
        }
        else if (!stranded && known) {
            this._strandedScaleWindows.delete(container);
            this._logger.log('[Liquid Glass][anchor] REFUSED cleared');
        }
        return stranded;
    }
    _checkContainerAnchor(state) {
        const container = state.windowsContainer;
        if (!isActorValid(container))
            return 0;
        let x = NaN, y = NaN;
        try {
            [x, y] = container.get_transformed_position();
        }
        catch (e) {
            return 0;
        }
        const offBy = (!Number.isFinite(x) || !Number.isFinite(y))
            ? Infinity
            : Math.max(Math.abs(x), Math.abs(y));
        const displaced = offBy > 1;
        const known = this._displacedContainers.has(container);
        if (displaced && !known) {
            this._displacedContainers.add(container);
            const metaWin = state.windowActor.get_meta_window();
            const title = metaWin ? (metaWin.get_title() || '(untitled)') : '(?)';
            const [sx, sy] = this._animationScale(state.windowActor);
            this._logger.log(`[Liquid Glass][anchor] DRIFT window="${title}" ` +
                `container.transformedPos=(${Math.round(x)},${Math.round(y)}) expected=(0,0) ` +
                `windowActor.(x,y)=(${state.windowActor.x},${state.windowActor.y}) ` +
                `translation=(${state.windowActor.translation_x},${state.windowActor.translation_y}) ` +
                `scale=(${sx.toFixed(4)},${sy.toFixed(4)}) ` +
                `constraint.offset=(${state.constraints.windows.offset_x},${state.constraints.windows.offset_y})`);
        }
        else if (!displaced && known) {
            this._displacedContainers.delete(container);
            this._logger.log('[Liquid Glass][anchor] RECOVERED');
        }
        return offBy;
    }
    _logFocusDebugInfo(state) {
        const actor = state.windowActor;
        const metaWin = actor.get_meta_window();
        if (!metaWin)
            return;
        const title = metaWin.get_title() || '(untitled)';
        const [actorX, actorY] = [actor.x, actor.y];
        const [tX, tY] = actor.get_transformed_position();
        const frameRect = metaWin.get_frame_rect();
        const bufferRect = metaWin.get_buffer_rect();
        const [asx, asy] = this._animationScale(actor);



        let ancX = NaN, ancY = NaN;
        try {
            [ancX, ancY] = state.windowsContainer.get_transformed_position();
        }
        catch (e) { }
        this._logger.log(`[Liquid Glass][focus-debug] window="${title}" ` +
            `windowActor.(x,y)=(${actorX},${actorY}) ` +
            `transformedPos=(${Math.round(tX)},${Math.round(tY)}) ` +
            `translation=(${actor.translation_x},${actor.translation_y}) ` +
            `scale=(${asx.toFixed(4)},${asy.toFixed(4)}) ` +
            `frameRect=(${frameRect.x},${frameRect.y},${frameRect.width}x${frameRect.height}) ` +
            `bufferRect=(${bufferRect.x},${bufferRect.y},${bufferRect.width}x${bufferRect.height}) ` +
            `actorX-bufferRect.x=${actorX - bufferRect.x} actorY-bufferRect.y=${actorY - bufferRect.y} ` +
            `containerAnchor=(${Math.round(ancX)},${Math.round(ancY)}) ` +
            `bgActor.hasAlloc=${state.bgActor.has_allocation()} ` +
            `container.hasAlloc=${state.windowsContainer.has_allocation()}`);
        for (let [src, clone] of state.clones.entries()) {
            if (!isActorValid(src) || !isActorValid(clone))
                continue;
            const srcMetaWindow = typeof src.get_meta_window === 'function'
                ? src.get_meta_window() : null;
            const srcTitle = srcMetaWindow ? (srcMetaWindow.get_title() || '(untitled)') : '(?)';
            const [srcX, srcY] = [src.x, src.y];
            const [srcTX, srcTY] = src.get_transformed_position();




            let cloneScreenX = NaN, cloneScreenY = NaN;
            try {
                [cloneScreenX, cloneScreenY] = clone.get_transformed_position();
            }
            catch (e) { }
            this._logger.log(`[Liquid Glass][focus-debug]   behind-clone src="${srcTitle}" ` +
                `src.(x,y)=(${srcX},${srcY}) src.transformedPos=(${Math.round(srcTX)},${Math.round(srcTY)}) ` +
                `diff=(${Math.round(srcTX - srcX)},${Math.round(srcTY - srcY)}) ` +
                `clone.translation=(${clone.translation_x},${clone.translation_y}) ` +
                `clone.size=(${clone.width}x${clone.height}) ` +
                `clone.screenPos=(${Math.round(cloneScreenX)},${Math.round(cloneScreenY)}) ` +
                `clone.hasAlloc=${clone.has_allocation()} clone.mapped=${clone.mapped}`);
        }
    }
    _cleanupState(state) {
        if (!state)
            return;



        this._releaseDamageHooks(state);
        releaseClonedWindowActors(state);


        if (state.remapReallocLaterId) {
            try {
                global.compositor.get_laters().remove(state.remapReallocLaterId);
            }
            catch (_) {   }
            state.remapReallocLaterId = 0;
        }




        if (state.surfaceActor) {
            try {
                if (isActorValid(state.surfaceActor)) {
                    state.surfaceActor.opacity = state.originalOpacity;
                }
            }
            catch (e) {

            }
        }
        if (state.signals) {
            state.signals.forEach(sig => {
                try {
                    sig.obj.disconnect(sig.id);
                }
                catch (e) { }
            });
            state.signals = [];
        }








        if (state.constraints) {
            if (isActorValid(state.bgClone))
                state.bgClone.remove_constraint(state.constraints.bg);
            if (isActorValid(state.windowsContainer))
                state.windowsContainer.remove_constraint(state.constraints.windows);
            if (isActorValid(state.baseClone))
                state.baseClone.remove_constraint(state.constraints.base);
            if (isActorValid(state.baseWindowsContainer))
                state.baseWindowsContainer.remove_constraint(state.constraints.baseWindows);
            state.constraints.bg.source = null;
            state.constraints.windows.source = null;
            state.constraints.base.source = null;
            state.constraints.baseWindows.source = null;
        }
        state.clones.forEach(clone => { if (isActorValid(clone))
            clone.destroy(); });
        state.clones.clear();
        state.baseClones.forEach(clone => { if (isActorValid(clone))
            clone.destroy(); });
        state.baseClones.clear();
        if (state.effect) {
            try {
                state.effect.cleanup();
            }
            catch (e) { }
        }
        if (isActorValid(state.bgActor))
            state.bgActor.destroy();
        if (isActorValid(state.baseActor))
            state.baseActor.destroy();
        if (isActorValid(state.cornerOverlay))
            state.cornerOverlay.destroy();
    }
}
