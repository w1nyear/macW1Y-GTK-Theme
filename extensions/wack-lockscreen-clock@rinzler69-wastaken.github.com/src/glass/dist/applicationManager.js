import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import { BackdropGlass } from './rendering/backdropGlass.js';
import { getWindowActors, isActorValid, getAllocatedSize, setActorVisible, ensureGlassAllocated, ensureWindowActorAllocated, clearStranded, setPositionIfChanged, setSizeIfChanged } from './actors.js';
import { isFrameSyncFrozen, SAME_FRAME_WINDOW_US, hexToColorArray } from './animation.js';
import { noteStrandEntry } from './diagnostics.js';
import { reportFrameLoopError } from './logger.js';




const GLASS_MIN_MARGIN = 10;


const SHADOW_MARGIN_HEADROOM = 20;

const GLASS_MAX_MARGIN = 100 + SHADOW_MARGIN_HEADROOM;



const WINDOW_ACTOR_RELAYOUT_FRAMES = 4;
const WINDOW_ACTOR_STRANDED_FRAMES = 14;


const MENU_WINDOW_TYPES = [
    Meta.WindowType.DROPDOWN_MENU,
    Meta.WindowType.POPUP_MENU,
    Meta.WindowType.MENU,
];


const MAX_TRANSIENT_DEPTH = 8;

export class ApplicationManager {
    _extensionPath;
    _settings;
    _logger;
    _states = new Map();
    _settingsSignals = [];
    _displaySignals = [];

    _newWindows = new Map();
    _frameSignalId = 0;
    _lastTickUs = 0;
    _glassMargin = GLASS_MIN_MARGIN;
    _cornerOnMaximized = false;
    _glassOnMaximized = true;

    constructor(extensionPath, settings, logger) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
    }

    setup() {
        this._glassMargin = this._computeGlassMargin();
        this._bindSettings();
        this._displaySignals.push(global.display.connect('window-created', (_d, metaWindow) => this._onWindowCreated(metaWindow)));
        if (this._isEffectEnabled())
            this._applyEffects();
    }

    cleanup() {
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        this._displaySignals = [];
        for (const actor of [...this._newWindows.keys()])
            this._forgetNewWindow(actor);
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];
        this._removeAllEffects();
    }




    _onWindowCreated(metaWindow) {
        const actor = metaWindow.get_compositor_private();
        if (!actor)
            return;
        this._newWindows.set(actor, [
            actor.connect('first-frame', () => {
                this._forgetNewWindow(actor);
                if (this._shouldApplyToWindow(actor))
                    this._setupWindow(actor);
            }),
            actor.connect('destroy', () => this._forgetNewWindow(actor)),
        ]);
    }

    _forgetNewWindow(actor) {
        const ids = this._newWindows.get(actor);
        if (!ids)
            return;
        this._newWindows.delete(actor);
        for (const id of ids)
            actor.disconnect(id);
    }

    _bindSettings() {
        const connectSetting = (key, callback) => {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, callback));
        };
        for (const profile of ['application', 'desktop-menu']) {


            connectSetting(this._profileEnableKey(profile), () => {
                this._syncWhitelist();
                if (this._isEffectEnabled())
                    this._startFrameSync();
            });
            for (const suffix of ['tint-color', 'tint-strength', 'blur-radius', 'corner-radius',
                'brightness', 'contrast', 'saturation'])
                connectSetting(this._profileKey(profile, suffix), () => this._updateEffectParams());
            connectSetting(this._profileKey(profile, 'content-opacity'), () => this._updateWindowOpacities());
        }
        connectSetting('application-glass-all-windows', () => this._syncWhitelist());
        connectSetting('application-window-whitelist', () => this._syncWhitelist());
        connectSetting('application-window-blacklist', () => this._syncWhitelist());
        connectSetting('application-corner-on-maximized', () => { this._cornerOnMaximized = this._settings.get_boolean('application-corner-on-maximized'); this._updateMaximized(); });
        connectSetting('application-glass-on-maximized', () => { this._glassOnMaximized = this._settings.get_boolean('application-glass-on-maximized'); this._updateMaximized(); });
        this._cornerOnMaximized = this._settings.get_boolean('application-corner-on-maximized');
        this._glassOnMaximized = this._settings.get_boolean('application-glass-on-maximized');

        connectSetting('shadow-radius', () => this._updateGlassMargin());
        connectSetting('shadow-intensity', () => this._updateGlassMargin());
    }

    _getContentOpacity(profile = 'application') {
        return this._settings.get_double(this._profileKey(profile, 'content-opacity'));
    }

    _updateWindowOpacities() {
        for (const state of this._states.values()) {
            if (isActorValid(state.surfaceActor))
                state.surfaceActor.opacity = Math.round(this._getContentOpacity(state.profile) * 255);
        }
    }


    _profileKey(profile, suffix) {
        return `${profile}-${suffix}`;
    }


    _profileEnableKey(profile) {
        return `enable-${profile}-glass`;
    }

    _isProfileEnabled(profile) {
        return this._settings.get_boolean(this._profileEnableKey(profile));
    }



    _isEffectEnabled() {
        return this._isProfileEnabled('application') || this._isProfileEnabled('desktop-menu');
    }



    _listContainsClass(list, wmClass) {
        if (!wmClass)
            return false;
        const normalized = wmClass.toLowerCase();
        return list.some(entry => entry.toLowerCase() === normalized);
    }

    _windowMatchesWhitelist(metaWindow) {
        const whitelist = this._settings.get_strv('application-window-whitelist');
        return this._listContainsClass(whitelist, metaWindow.get_wm_class());
    }

    _windowMatchesBlacklist(metaWindow) {
        const blacklist = this._settings.get_strv('application-window-blacklist');
        return this._listContainsClass(blacklist, metaWindow.get_wm_class());
    }









    _isDesktopMenuWindow(metaWindow) {
        if (metaWindow.is_override_redirect())
            return false;
        if (!MENU_WINDOW_TYPES.includes(metaWindow.get_window_type()))
            return false;
        let parent = metaWindow.get_transient_for();
        for (let depth = 0; parent && depth < MAX_TRANSIENT_DEPTH; depth++) {
            if (parent.get_window_type() === Meta.WindowType.DESKTOP)
                return true;


            if (!MENU_WINDOW_TYPES.includes(parent.get_window_type()))
                return false;
            parent = parent.get_transient_for();
        }
        return false;
    }





    _profileForWindow(windowActor) {
        const metaWindow = windowActor.get_meta_window();
        if (!metaWindow)
            return null;


        if (this._isDesktopMenuWindow(metaWindow))
            return this._isProfileEnabled('desktop-menu') ? 'desktop-menu' : null;
        if (!this._isProfileEnabled('application'))
            return null;


        if (this._settings.get_boolean('application-glass-all-windows')) {
            const windowType = metaWindow.get_window_type();
            const isNormal = windowType === Meta.WindowType.NORMAL ||
                windowType === Meta.WindowType.DIALOG ||
                windowType === Meta.WindowType.MODAL_DIALOG;
            if (!isNormal || this._windowMatchesBlacklist(metaWindow))
                return null;
            return 'application';
        }
        return this._windowMatchesWhitelist(metaWindow) ? 'application' : null;
    }

    _shouldApplyToWindow(windowActor) {
        return this._profileForWindow(windowActor) !== null;
    }

    _applyEffects() {
        this._buildForExistingWindows();
        this._startFrameSync();
    }

    _removeAllEffects() {
        this._stopFrameSync();
        for (const state of this._states.values())
            this._cleanupState(state);
        this._states.clear();
    }

    _syncWhitelist() {
        if (!this._isEffectEnabled()) {
            this._removeAllEffects();
            return;
        }


        for (const [actor, state] of [...this._states.entries()]) {
            if (this._profileForWindow(actor) !== state.profile) {
                this._cleanupState(state);
                this._states.delete(actor);
            }
        }
        for (const actor of getWindowActors()) {
            if (this._shouldApplyToWindow(actor) && !this._states.has(actor))
                this._setupWindow(actor);
        }
    }



    _computeGlassMargin() {
        const radius = this._settings.get_double('shadow-radius');
        const intensity = this._settings.get_double('shadow-intensity');
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
        for (const state of this._states.values()) {
            state.glass.setPadding(next);
            state.glass.setShadowMaxRadius(shadowRoom);
        }
    }

    _updateEffectParams() {
        for (const state of this._states.values())
            this._applyAppearance(state.glass, state.profile);
        this._updateMaximized();
    }

    _applyAppearance(glass, profile) {
        const k = (suffix) => this._profileKey(profile, suffix);
        glass.setTintColor(...hexToColorArray(this._settings.get_string(k('tint-color'))));
        glass.setTintStrength(this._settings.get_double(k('tint-strength')));
        glass.setCornerRadius(this._settings.get_double(k('corner-radius')));
        glass.setBlurRadius(this._settings.get_int(k('blur-radius')));
        glass.setBrightness(this._settings.get_double(k('brightness')));
        glass.setContrast(this._settings.get_double(k('contrast')));
        glass.setSaturation(this._settings.get_double(k('saturation')));
    }



    _startFrameSync() {
        if (this._frameSignalId !== 0)
            return;
        this._frameSignalId = global.stage.connect('before-update', () => this._frameTick());
        this._frameTick();
    }

    _stopFrameSync() {
        if (!this._frameSignalId)
            return;
        global.stage.disconnect(this._frameSignalId);
        this._frameSignalId = 0;
    }

    _buildForExistingWindows() {
        for (const actor of getWindowActors()) {
            if (this._shouldApplyToWindow(actor))
                this._setupWindow(actor);
        }
    }

    _setupWindow(windowActor) {
        if (this._states.has(windowActor))
            return;
        const profile = this._profileForWindow(windowActor);
        if (!profile)
            return;
        const surfaceActor = windowActor.get_first_child();
        if (!surfaceActor || !windowActor.get_parent())
            return;
        const originalOpacity = surfaceActor.opacity;
        surfaceActor.opacity = Math.round(this._getContentOpacity(profile) * 255);



        const glass = new BackdropGlass({
            extensionPath: this._extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: profile,
            outline: profile,
        });
        glass.set_name('liquid-glass-window');
        glass.setPadding(this._glassMargin);
        this._applyAppearance(glass, profile);
        glass.setIsDock(false);


        glass.setSurfaceLightEnabled(false);

        glass.setCornerSmoothingEnabled(false);
        glass.setShadowMaxRadius(Math.max(0, this._glassMargin - SHADOW_MARGIN_HEADROOM));
        windowActor.insert_child_below(glass, surfaceActor);
        let maximized = false;
        const metaWin = windowActor.get_meta_window();
        if (metaWin) {
            maximized = metaWin.maximized_horizontally || metaWin.maximized_vertically;
        }
        const state = {
            profile,
            windowActor,
            surfaceActor,
            originalOpacity,
            glass,
            signals: [],
            maximized,
        };
        this._states.set(windowActor, state);
        state.signals.push({
            obj: windowActor,
            id: windowActor.connect('notify::mapped', () => {
                if (windowActor.mapped)
                    this._forceGlassReallocation(state);
            }),
        });
        if (metaWin) {
            state.signals.push({
                obj: metaWin,

                id: metaWin.connect('size-changed', () => { state.frameLocal = undefined; }),
            });
            state.signals.push({
                obj: metaWin,
                id: metaWin.connect('notify::maximized-horizontally', () => {
                    this._updateMaximized(state);
                }),
            });
            state.signals.push({
                obj: metaWin,
                id: metaWin.connect('notify::maximized-vertically', () => {
                    this._updateMaximized(state);
                }),
            });
        }


        state.signals.push({
            obj: windowActor,
            id: windowActor.connect('destroy', () => {
                this._cleanupState(state);
                this._states.delete(windowActor);
            }),
        });
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
            if (Number.isFinite(fx) && Number.isFinite(fy))
                state.frameLocal = [fx, fy];
        }
        return state.frameLocal ?? [0, 0];
    }

    _updateMaximized(state = null) {
        const apply = (state) => {
            const metaWin = state.windowActor.get_meta_window();
            if (!metaWin)
                return;
            state.maximized = metaWin.maximized_horizontally || metaWin.maximized_vertically;
            const shouldHideCorner = !this._cornerOnMaximized && state.maximized;
            const shouldHideGlass = !this._glassOnMaximized && state.maximized;
            state.glass.setCornerRadius(shouldHideCorner ? 0 : this._settings.get_double('application-corner-radius'));
            if (isActorValid(state.surfaceActor)) {
                state.surfaceActor.opacity = shouldHideGlass
                    ? state.originalOpacity
                    : Math.round(this._getContentOpacity(state.profile) * 255);
                this._hideGlass(state);
            }
        };
        if (!state) {
            for (const state of this._states.values())
                apply(state);
        }
        else {
            apply(state);
        }
    }



    _hideGlass(state) {
        setActorVisible(state.glass, false);
        state.geomSig = undefined;
    }


    _syncState(state) {
        const actor = state.windowActor;
        if (!actor.get_stage() || !actor.mapped) {
            this._hideGlass(state);
            return false;
        }
        const metaWin = actor.get_meta_window();
        if (!metaWin)
            return false;

        state.glass.beginBatch();
        try {
            return this._syncStateInner(state, actor, metaWin);
        }
        finally {
            state.glass.endBatch();
        }
    }








    _syncStateInner(state, actor, metaWin) {
        const winWorkspace = metaWin.get_workspace();
        if (winWorkspace && winWorkspace !== global.workspace_manager.get_active_workspace()) {
            this._hideGlass(state);
            return false;
        }
        const rect = metaWin.get_frame_rect();
        const bufferRect = metaWin.get_buffer_rect();
        if (rect.width <= 0 || rect.height <= 0) {
            this._hideGlass(state);
            return false;
        }
        const shouldHideGlass = !this._glassOnMaximized && state.maximized;
        if (shouldHideGlass) {
            this._hideGlass(state);
            return false;
        }
        setActorVisible(state.glass, true);
        const [frameLocalX, frameLocalY] = this._frameLocalOffset(state, actor, rect, bufferRect);
        const margin = this._glassMargin;
        const w = rect.width + margin * 2;
        const h = rect.height + margin * 2;
        const [pivotX, pivotY] = actor.get_pivot_point();
        const [actorW, actorH] = getAllocatedSize(actor);
        const moved = !this._updateGeometrySignature(state, [
            w, h, frameLocalX, frameLocalY,
            actor.x, actor.y,
            actor.translation_x, actor.translation_y,
            actor.scale_x, actor.scale_y,
            pivotX * (Number.isFinite(actorW) ? actorW : 0),
            pivotY * (Number.isFinite(actorH) ? actorH : 0),
        ]);
        if (moved) {
            setPositionIfChanged(state.glass, frameLocalX - margin, frameLocalY - margin);
            setSizeIfChanged(state.glass, w, h);
            state.glass.setResolution(w, h);
            state.glass.setGlassGeometry(0, 0, w, h);
        }

        state.glass.syncSources(moved);
        return moved;
    }



    _updateGeometrySignature(state, values) {
        let sig = state.geomSig;
        if (!sig || sig.length !== values.length) {
            sig = new Float64Array(values.length).fill(NaN);
            state.geomSig = sig;
        }
        let unchanged = true;
        for (let i = 0; i < sig.length; i++) {
            if (sig[i] !== values[i]) {
                unchanged = false;
                sig[i] = values[i];
            }
        }
        return unchanged;
    }

    _frameTick() {

        if (isFrameSyncFrozen())
            return;

        const nowUs = GLib.get_monotonic_time();
        if (nowUs - this._lastTickUs < SAME_FRAME_WINDOW_US)
            return;
        this._lastTickUs = nowUs;

        for (const state of this._states.values()) {
            try {
                this._syncFrameState(state);
            }
            catch (e) {
                reportFrameLoopError('ApplicationManager', e);
            }
        }
    }

    _syncFrameState(state) {
        const metaWin = state.windowActor.get_meta_window();
        if (!metaWin)
            return;
        const title = metaWin.get_title() || '(untitled)';

        state.glass._diagOwnerLabel = title;


        if (this._syncState(state)) {
            clearStranded(state.windowActor);
            clearStranded(state.glass);
            return;
        }



        const rescue = ensureWindowActorAllocated(state.windowActor, WINDOW_ACTOR_RELAYOUT_FRAMES, WINDOW_ACTOR_STRANDED_FRAMES);
        if (rescue)
            this._logStrand(state, metaWin, title, rescue);
        ensureGlassAllocated(state.glass);
    }

    _logStrand(state, metaWin, title, rescue) {
        const wa = state.windowActor;
        const parent = wa.get_parent();
        noteStrandEntry(title, `wa.alloc=${wa.has_allocation()} wg.alloc=${parent ? parent.has_allocation() : '-'} ` +
            `scale=${wa.scale_x.toFixed(3)} op=${wa.opacity} min=${metaWin.minimized} stage=${rescue}`);
        this._logger.log(`[Liquid Glass][strand] ${rescue} for "${title}" — ` +
            `wa(mapped=${wa.mapped},vis=${wa.visible},alloc=${wa.has_allocation()},op=${wa.opacity},` +
            `scale=${wa.scale_x.toFixed(3)}) ` +
            `parent(${parent ? `${parent.constructor.name},mapped=${parent.mapped},alloc=${parent.has_allocation()}` : 'none'}) ` +
            `glass(mapped=${state.glass.mapped},vis=${state.glass.visible},alloc=${state.glass.has_allocation()}) ` +
            `min=${metaWin.minimized}`);
    }







    _forceGlassReallocation(state) {
        if (state.remapReallocLaterId)
            return;
        state.remapReallocLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            state.remapReallocLaterId = 0;
            if (!state.windowActor.mapped)
                return GLib.SOURCE_REMOVE;
            if (ensureGlassAllocated(state.glass, 1)) {
                const title = state.windowActor.get_meta_window()?.get_title() || '(untitled)';
                this._logger.log(`[Liquid Glass][min-restore] re-allocated the glass for "${title}"`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cleanupState(state) {
        if (state.remapReallocLaterId) {
            global.compositor.get_laters().remove(state.remapReallocLaterId);
            state.remapReallocLaterId = 0;
        }
        for (const { obj, id } of state.signals)
            obj.disconnect(id);
        state.signals = [];


        if (isActorValid(state.surfaceActor))
            state.surfaceActor.opacity = state.originalOpacity;
        state.glass.cleanup();
        if (isActorValid(state.glass))
            state.glass.destroy();
    }
}
