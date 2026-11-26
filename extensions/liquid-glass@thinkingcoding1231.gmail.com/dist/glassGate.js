

























import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const GLASS_REFRESH_ACTIVE_INTERVAL_US = 8333;
export const GLASS_REFRESH_BACKGROUND_INTERVAL_US = 16666;
export const GLASS_REFRESH_60FPS_INTERVAL_US = 16666;
export const GLASS_REFRESH_PIXEL_INTERVAL_US = 33333;
export const GLASS_REFRESH_HEARTBEAT_US = 1500000;

let _systemGlassFps = 60;
let _glassFpsIntervalUs = 16666;
let _glassFpsMonitor = null;
globalThis._macGlassIntervalUs = _glassFpsIntervalUs;

function _loadGlassFps() {
    try {
        const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'macW1Y', 'glass-fps']);
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null)) {
            const [ok, bytes] = file.load_contents(null);
            if (ok && bytes) {
                const txt = new TextDecoder().decode(bytes).trim();
                const parsed = parseInt(txt, 10);
                if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 240) {
                    _systemGlassFps = parsed;
                    _glassFpsIntervalUs = Math.max(4166, Math.round(1000000 / _systemGlassFps));
                    globalThis._macGlassIntervalUs = _glassFpsIntervalUs;
                }
            }
        }
    } catch (_) {}
}

function _ensureGlassFpsMonitor() {
    if (_glassFpsMonitor) return;
    _loadGlassFps();
    try {
        const path = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'macW1Y', 'glass-fps']);
        const file = Gio.File.new_for_path(path);
        _glassFpsMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        _glassFpsMonitor.connect('changed', (_m, _f, _o, eventType) => {
            if (eventType === Gio.FileMonitorEvent.CHANGED ||
                eventType === Gio.FileMonitorEvent.CREATED ||
                eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
                _loadGlassFps();
            }
        });
    } catch (_) {}
}

_ensureGlassFpsMonitor();

export function getGlassRefreshIntervalUs() {
    return _glassFpsIntervalUs;
}

let _backdropDamageVersion = 0;
let _nonWindowDamageVersion = 0;
let _backdropSceneVersion = 1;
let _backdropFailCounter = 0;
let _backdropSurfaceCount = 0;
let _backdropRefreshCount = 0;
let _backdropSkipCount = 0;
let _eventDrivenDefault = true;
const _backdropDamageHooked = new WeakSet();
const _bgChildSignals = new Map();
const _backdropPolls = new WeakMap();
const _wakeListeners = new Set();
let _sceneSignalIds = [];
let _sceneInvalidationId = 0;
let _pendingSceneReason = null;

export function addGlassWakeListener(fn) {
    if (typeof fn === 'function')
        _wakeListeners.add(fn);
}

export function removeGlassWakeListener(fn) {
    _wakeListeners.delete(fn);
}

export function notifyGlassWake(actor, reason = null) {
    for (const fn of _wakeListeners) {
        try {
            fn(actor, reason);
        } catch (_) {}
    }
}

function _invalidateBackdropScene(reason) {
    _backdropSceneVersion++;
    _backdropDamageVersion++;
    if (reason === 'background' || reason === 'layout')
        _nonWindowDamageVersion++;
    _stageScan = { at: -1e12, h: 0 };
    notifyGlassWake(null, reason);
}

function _noteNonWindowDamage(reason = 'background') {
    _backdropDamageVersion++;
    _nonWindowDamageVersion++;
    notifyGlassWake(null, reason);
}

function _hookBgChild(actor) {
    try {
        if (!actor || !_isActorValid(actor) || _bgChildSignals.has(actor))
            return;
        const ids = [];
        for (const sig of ['damaged', 'notify::content', 'notify::visible', 'notify::opacity']) {
            try {
                const id = actor.connect(sig, () => {
                    if (sig === 'damaged' || sig === 'notify::content')
                        _noteNonWindowDamage('background');
                    else
                        _invalidateBackdropScene('background');
                });
                if (id)
                    ids.push(id);
            } catch (_) {}
        }
        try {
            const did = actor.connect('destroy', () => _unhookBgChild(actor));
            if (did)
                ids.push(did);
        } catch (_) {}
        _bgChildSignals.set(actor, ids);
    } catch (_) {}
}

function _unhookBgChild(actor) {
    const ids = _bgChildSignals.get(actor);
    if (!ids)
        return;
    _bgChildSignals.delete(actor);
    for (const id of ids) {
        try { actor.disconnect(id); } catch (_) {}
    }
}

function _scheduleSceneInvalidation(reason) {
    _pendingSceneReason = reason;
    if (_sceneInvalidationId)
        return;

    _sceneInvalidationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 90, () => {
        _sceneInvalidationId = 0;
        const pendingReason = _pendingSceneReason;
        _pendingSceneReason = null;
        _invalidateBackdropScene(pendingReason);
        return GLib.SOURCE_REMOVE;
    });
}

export function installGlassSceneListeners() {
    if (_sceneSignalIds.length > 0)
        return;

    try {
        for (const signal of ['restacked', 'in-fullscreen-changed', 'notify::focus-window']) {
            const id = global.display.connect(signal, () => _scheduleSceneInvalidation(
                signal === 'restacked' ? 'restacked' : (signal === 'in-fullscreen-changed' ? 'fullscreen' : 'focus')));
            _sceneSignalIds.push([global.display, id]);
        }
    } catch (_) {}

    try {
        for (const signal of ['showing', 'hiding', 'item-drag-begin', 'item-drag-end', 'window-drag-begin', 'window-drag-end']) {
            const id = Main.overview.connect(signal, () => _scheduleSceneInvalidation('overview'));
            _sceneSignalIds.push([Main.overview, id]);
        }
        const ctrl = Main.overview?._overview?.controls;
        if (ctrl?._workspaceAdjustment) {
            const id = ctrl._workspaceAdjustment.connect('notify::value', () => _invalidateBackdropScene('overview-scroll'));
            _sceneSignalIds.push([ctrl._workspaceAdjustment, id]);
        }
        if (ctrl?._stateAdjustment) {
            const id = ctrl._stateAdjustment.connect('notify::value', () => _invalidateBackdropScene('overview-transition'));
            _sceneSignalIds.push([ctrl._stateAdjustment, id]);
        }
    } catch (_) {}

    try {
        for (const signal of ['switch-workspace', 'size-change', 'minimize', 'unminimize', 'destroy']) {
            const id = global.window_manager.connect(signal, () => _scheduleSceneInvalidation(signal));
            _sceneSignalIds.push([global.window_manager, id]);
        }
    } catch (_) {}

    try {
        for (const signal of ['active-workspace-changed', 'showing-desktop-changed']) {
            const id = global.workspace_manager.connect(signal, () => _scheduleSceneInvalidation(signal));
            _sceneSignalIds.push([global.workspace_manager, id]);
        }
    } catch (_) {}

    try {
        for (const signal of ['monitors-changed', 'workareas-changed']) {
            const id = Main.layoutManager.connect(signal, () => _scheduleSceneInvalidation('layout'));
            _sceneSignalIds.push([Main.layoutManager, id]);
        }
    } catch (_) {}

    try {
        const bgGroup = Main.layoutManager?._backgroundGroup ?? Main.layoutManager?.backgroundGroup;
        if (bgGroup) {
            for (const child of bgGroup.get_children?.() ?? [])
                _hookBgChild(child);
            const addId = bgGroup.connect('child-added', (_g, child) => {
                _hookBgChild(child);
                _invalidateBackdropScene('background');
            });
            const remId = bgGroup.connect('child-removed', (_g, child) => {
                _unhookBgChild(child);
                _invalidateBackdropScene('background');
            });
            _sceneSignalIds.push([bgGroup, addId], [bgGroup, remId]);
        }
    } catch (_) {}

    try {
        const src = Gio.SettingsSchemaSource.get_default();
        if (src?.lookup('org.gnome.desktop.background', true)) {
            const bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
            for (const key of ['picture-uri', 'picture-uri-dark', 'primary-color', 'secondary-color', 'color-options', 'picture-options']) {
                const id = bgSettings.connect(`changed::${key}`, () => {
                    _nonWindowDamageVersion++;
                    _scheduleSceneInvalidation('background');
                });
                _sceneSignalIds.push([bgSettings, id]);
            }
        }
        if (src?.lookup('org.gnome.desktop.interface', true)) {
            const ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            const id = ifaceSettings.connect('changed::color-scheme', () => {
                _nonWindowDamageVersion++;
                _scheduleSceneInvalidation('background');
            });
            _sceneSignalIds.push([ifaceSettings, id]);
        }
    } catch (_) {}
}

export function removeGlassSceneListeners() {
    if (_sceneInvalidationId) {
        GLib.source_remove(_sceneInvalidationId);
        _sceneInvalidationId = 0;
    }
    _pendingSceneReason = null;
    for (const actor of Array.from(_bgChildSignals.keys()))
        _unhookBgChild(actor);
    for (const [object, id] of _sceneSignalIds) {
        try { object.disconnect(id); } catch (_) {}
    }
    _sceneSignalIds = [];
}

function _isActorValid(actor) {
    try {
        return !!actor && typeof actor === 'object' && !actor._isDisposed;
    } catch (_) {
        return false;
    }
}


export function noteWindowContentDamaged() {
    _backdropDamageVersion++;
}

export function noteNonWindowContentDamaged(reason = 'background') {
    _noteNonWindowDamage(reason);
}


export function setGlassEventDriven(enabled) {
    _eventDrivenDefault = !!enabled;
}

export function isGlassEventDriven() {
    if (typeof globalThis._macGlassEventDriven === 'boolean')
        return globalThis._macGlassEventDriven;
    return _eventDrivenDefault;
}


function _hmix(h, v) {
    const n = Number.isFinite(v) ? (v | 0) : 0;
    return (h ^ (n + 0x9E3779B9 + ((h << 6) | (h >>> 26)))) | 0;
}

let _stageScan = { at: -1e12, h: 0 };
function _stageBackdropHash(nowUs) {
    if (nowUs - _stageScan.at < 8000)
        return _stageScan.h;
    let h = 1234567;
    try {
        const actors = global.get_window_actors?.() ?? [];
        h = _hmix(h, actors.length);
        for (let i = 0; i < actors.length; i++) {
            const a = actors[i];
            try {
                if (!_isActorValid(a)) {
                    h = _hmix(h, -i);
                    continue;
                }
                _hookWindowDamage(a);
                let wX = a.x + (a.translation_x || 0);
                let wY = a.y + (a.translation_y || 0);
                let wW = a.width;
                let wH = a.height;
                const mw = a.get_meta_window?.();
                if (mw) {
                    try {
                        const fr = mw.get_frame_rect?.();
                        if (fr && fr.width > 0 && fr.height > 0) {
                            wX = fr.x; wY = fr.y; wW = fr.width; wH = fr.height;
                        }
                    } catch (_) {}
                }
                h = _hmix(h, Math.round(wX));
                h = _hmix(h, Math.round(wY));
                h = _hmix(h, Math.round(wW));
                h = _hmix(h, Math.round(wH));
                h = _hmix(h, a.visible ? 1 : 0);
                h = _hmix(h, a.mapped ? 1 : 0);
                h = _hmix(h, a.get_opacity?.() ?? 255);
            } catch (_) {
                h = _hmix(h, i * 1000 + 7);
            }
        }

        if (Main.overview?.visible) {
            h = _hmix(h, 99991);
            const ctrl = Main.overview._overview?.controls;
            if (ctrl) {
                if (ctrl._workspaceAdjustment)
                    h = _hmix(h, Math.round((ctrl._workspaceAdjustment.value || 0) * 1000));
                if (ctrl._stateAdjustment)
                    h = _hmix(h, Math.round((ctrl._stateAdjustment.value || 0) * 1000));
            }
        }

        const lm = Main.layoutManager;
        const mons = lm?.monitors ?? [];
        h = _hmix(h, mons.length);
        for (let i = 0; i < mons.length; i++) {
            const m = mons[i];
            if (!m)
                continue;
            h = _hmix(h, m.x); h = _hmix(h, m.y);
            h = _hmix(h, m.width); h = _hmix(h, m.height);
        }

        const bg = lm?._backgroundGroup ?? lm?.backgroundGroup;
        h = _hmix(h, bg && _isActorValid(bg) ? bg.get_n_children() : 0);
        h = _hmix(h, _nonWindowDamageVersion);
    } catch (_) {
        return _hmix(_stageScan.h, ++_backdropFailCounter);
    }
    _stageScan = { at: nowUs, h };
    return h;
}

function _hookWindowDamage(actor) {
    try {
        if (!actor || !_isActorValid(actor) || _backdropDamageHooked.has(actor))
            return;
        _backdropDamageHooked.add(actor);
        actor._lastDamageUs = actor._lastDamageUs || 0;

        const onMotionOrDamage = (reason) => {
            actor._lastDamageUs = GLib.get_monotonic_time();
            if (reason !== 'window-damaged')
                _stageScan.at = -1e12;
            noteWindowContentDamaged();
            notifyGlassWake(actor, reason);
        };

        actor.connect('damaged', () => onMotionOrDamage('window-damaged'));
        actor.connect('notify::position', () => onMotionOrDamage('window-moved'));
        actor.connect('notify::size', () => onMotionOrDamage('window-moved'));
        actor.connect('notify::translation-x', () => onMotionOrDamage('window-moved'));
        actor.connect('notify::translation-y', () => onMotionOrDamage('window-moved'));
        actor.connect('notify::visible', () => onMotionOrDamage('window-moved'));
        actor.connect('notify::mapped', () => onMotionOrDamage('window-moved'));

        let mwSigs = [];
        const mw = actor.get_meta_window?.();
        if (mw) {
            try {
                mwSigs.push(mw.connect('position-changed', () => onMotionOrDamage('window-moved')));
                mwSigs.push(mw.connect('size-changed', () => onMotionOrDamage('window-moved')));
                mwSigs.push(mw.connect('workspace-changed', () => onMotionOrDamage('window-moved')));
            } catch (_) {}
        }

        actor.connect('destroy', () => {
            _backdropDamageHooked.delete(actor);
            for (let id of mwSigs) {
                try { mw?.disconnect(id); } catch (_) {}
            }
        });
    } catch (_) {}
}

export function hookWindowDamage(actor) {
    _hookWindowDamage(actor);
}


export function isActorNearGlass(windowActor, glassActor) {
    try {
        if (!windowActor || !_isActorValid(windowActor))
            return false;
        if (!glassActor || !_isActorValid(glassActor))
            return false;

        const mw = windowActor.get_meta_window?.();
        if (mw?.is_fullscreen?.()) {
            const winMon = mw.get_monitor();
            const glassMon = Main.layoutManager.findIndexForActor(glassActor);
            return winMon === glassMon || winMon < 0 || glassMon < 0;
        }

        let [wX, wY] = windowActor.get_transformed_position?.() ?? [windowActor.x, windowActor.y];
        let [wW, wH] = windowActor.get_transformed_size?.() ?? [windowActor.width, windowActor.height];
        if (mw) {
            try {
                const fr = mw.get_frame_rect?.();
                if (fr && fr.width > 0 && fr.height > 0) {
                    wX = fr.x; wY = fr.y; wW = fr.width; wH = fr.height;
                }
            } catch (_) {}
        }

        if (!Number.isFinite(wX) || !Number.isFinite(wY) || !wW || !wH || wW <= 0 || wH <= 0)
            return true;

        let [gx, gy] = glassActor.get_transformed_position?.() ?? [glassActor.x, glassActor.y];
        let [gw, gh] = glassActor.get_transformed_size?.() ?? [glassActor.width, glassActor.height];

        if (glassActor.has_clip?.()) {
            const clipRes = glassActor.get_clip?.();
            if (Array.isArray(clipRes)) {
                if (clipRes.length === 5 && clipRes[0]) {
                    gx += clipRes[1];
                    gy += clipRes[2];
                    gw = clipRes[3];
                    gh = clipRes[4];
                } else if (clipRes.length === 4) {
                    gx += clipRes[0];
                    gy += clipRes[1];
                    gw = clipRes[2];
                    gh = clipRes[3];
                }
            }
        }

        if (!Number.isFinite(gx) || !Number.isFinite(gy) || !gw || !gh || gw <= 0 || gh <= 0)
            return true;


        const MARGIN = 100;
        const gLeft = gx - MARGIN;
        const gTop = gy - MARGIN;
        const gRight = gx + gw + MARGIN;
        const gBottom = gy + gh + MARGIN;

        return !(
            wX + wW < gLeft ||
            wX > gRight ||
            wY + wH < gTop ||
            wY > gBottom
        );
    } catch (_) {
        return true;
    }
}


function _ownGlassHash(actor) {
    if (!actor)
        return 0;
    let h = 1;
    try {
        if (!_isActorValid(actor))
            return -1;
        h = _hmix(h, actor.get_x?.());
        h = _hmix(h, actor.get_y?.());
        h = _hmix(h, actor.get_width?.());
        h = _hmix(h, actor.get_height?.());
        h = _hmix(h, actor.translation_x);
        h = _hmix(h, actor.translation_y);
        h = _hmix(h, actor.opacity);
    } catch (_) {
        return -2;
    }
    return h;
}

function _newPollState() {
    _backdropSurfaceCount++;
    const nowUs = GLib.get_monotonic_time();
    return {
        lastScanH: 0,
        lastDamage: -1,
        lastNonWindowDamage: -1,
        lastOwnH: -1,
        dirty: true,
        lastFull: 0,
        lastDamageCheckUs: 0,
        forceStructural: true,
        lastRefreshStructural: true,
        lastSceneVersion: _backdropSceneVersion,
        settleUntilUs: nowUs + 800000
    };
}





export function glassRefreshDue(glassActor, extraHash) {
    try {
        if (!isGlassEventDriven())
            return true;
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        const nowUs = GLib.get_monotonic_time();
        if (!st.lastFull) {
            st.forceStructural = true;
            st.lastRefreshStructural = true;
            st.settleUntilUs = nowUs + 800000;
            return true;
        }

        const scanH = _stageBackdropHash(nowUs);
        const dmg = _backdropDamageVersion;
        const nonWinDmg = _nonWindowDamageVersion;
        const ownH = _hmix(_ownGlassHash(glassActor), extraHash);

        const scanChanged = (st.lastScanH !== scanH);
        const ownChanged = (st.lastOwnH !== ownH);
        const dmgChanged = (st.lastDamage !== dmg);
        const nonWinDmgChanged = (st.lastNonWindowDamage !== nonWinDmg);
        const sceneChanged = st.lastSceneVersion !== _backdropSceneVersion;


        const isSettling = (nowUs < (st.settleUntilUs || 0));


        let isNearDamaged = nonWinDmgChanged;
        if (dmgChanged && !isNearDamaged) {
            try {
                const actors = global.get_window_actors?.() ?? [];
                const minDmgUs = st.lastDamageCheckUs || 0;
                for (let i = 0; i < actors.length; i++) {
                    const a = actors[i];
                    if (a && a.visible && a.mapped) {
                        if (minDmgUs > 0 && a._lastDamageUs !== undefined && a._lastDamageUs < minDmgUs)
                            continue;
                        if (isActorNearGlass(a, glassActor)) {
                            isNearDamaged = true;
                            break;
                        }
                    }
                }
            } catch (_) {
                isNearDamaged = true;
            }
        }

        const structuralChange = scanChanged || ownChanged || isSettling || sceneChanged || nonWinDmgChanged || st.forceStructural || !!Main.overview?.visible;
        if (structuralChange || isNearDamaged) {
            st.lastScanH = scanH;
            st.lastDamage = dmg;
            st.lastNonWindowDamage = nonWinDmg;
            st.lastOwnH = ownH;
            st.lastSceneVersion = _backdropSceneVersion;
            st.dirty = true;
            if (structuralChange)
                st.lastRefreshStructural = true;
        }

        const sinceFull = nowUs - st.lastFull;

        if (st.dirty || Main.overview?.visible) {
            const targetUs = _glassFpsIntervalUs;
            let dueInterval;
            if (ownChanged)
                dueInterval = Math.min(GLASS_REFRESH_ACTIVE_INTERVAL_US, targetUs);
            else if (scanChanged || sceneChanged || isSettling || st.forceStructural || Main.overview?.visible)
                dueInterval = targetUs;
            else
                dueInterval = Math.max(targetUs, GLASS_REFRESH_PIXEL_INTERVAL_US);
            return sinceFull >= dueInterval;
        }


        if (sinceFull >= GLASS_REFRESH_HEARTBEAT_US) {
            st.lastRefreshStructural = true;
            return true;
        }



        return false;
    } catch (e) {
        globalThis._lastDueError = `${e?.message || e}\n${e?.stack || ''}`;
        return true;
    }
}


export function glassRefreshDone(glassActor, extraHash) {
    try {
        _backdropRefreshCount++;
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        const nowUs = GLib.get_monotonic_time();
        st.lastFull = nowUs;
        st.lastDamageCheckUs = nowUs;
        st.dirty = false;
        st.forceStructural = false;
        st.lastRefreshStructural = false;
        st.lastScanH = _stageBackdropHash(nowUs);
        st.lastDamage = _backdropDamageVersion;
        st.lastNonWindowDamage = _nonWindowDamageVersion;
        st.lastOwnH = _hmix(_ownGlassHash(glassActor), extraHash);
        st.lastSceneVersion = _backdropSceneVersion;
    } catch (_) {}
}


export function glassMarkDirty(glassActor) {
    try {
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        st.dirty = true;
    } catch (_) {}
}


export function glassNeedsStructureSync(glassActor) {
    try {
        const st = _backdropPolls.get(glassActor);
        if (!st)
            return true;
        return !!(st.lastRefreshStructural || st.forceStructural || !st.lastFull);
    } catch (_) {
        return true;
    }
}


export function glassForceRefresh(glassActor, settleMs = 800) {
    try {
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        st.dirty = true;
        st.forceStructural = true;
        st.lastRefreshStructural = true;
        st.lastFull = 0;
        st.settleUntilUs = GLib.get_monotonic_time() + (Math.max(0, Number(settleMs) || 0) * 1000);
    } catch (_) {}
}




export function glassGateInstance(key) {
    return {
        due: (extraHash) => glassRefreshDue(key, extraHash),
        done: (extraHash) => glassRefreshDone(key, extraHash),
    };
}


function _macGlassStats() {
    try {
        return JSON.stringify({
            eventDriven: isGlassEventDriven(),
            surfaces: _backdropSurfaceCount,
            damageVersion: _backdropDamageVersion,
            refreshes: _backdropRefreshCount,
            skips: _backdropSkipCount,
            stageScanCacheMs: Math.max(0, Math.round((GLib.get_monotonic_time() - _stageScan.at) / 1000)),
            note: 'eventDriven ON: рефреш лише при змінах (≤60 FPS, пульс 1 Гц)',
        });
    } catch (e) {
        return JSON.stringify({ err: String(e) });
    }
}

export function getActorPollState(actor) {
    return _backdropPolls.get(actor);
}

export function glassPollStats(enable) {
    if (enable === undefined || enable === null)
        return { refreshes: _backdropRefreshCount, surfaces: _backdropSurfaceCount,
            damageVersion: _backdropDamageVersion };
    if (enable) {
        _backdropRefreshCount = 0;
        return { refreshes: 0, started: true };
    }
    return { refreshes: _backdropRefreshCount, stopped: true };
}







export function isBackdropDirtyOrChanged(glassActor) {
    try {
        if (!glassActor) return false;
        if (Main.overview?.visible) return true;
        let st = _backdropPolls.get(glassActor);
        if (!st) return true;
        const nowUs = GLib.get_monotonic_time();
        if (st.dirty || st.lastSceneVersion !== _backdropSceneVersion ||
            (st.settleUntilUs && nowUs < st.settleUntilUs)) return true;
        const scanH = _stageBackdropHash(nowUs);
        if (st.lastScanH !== scanH) return true;
        const dmg = _backdropDamageVersion;
        if (st.lastDamage !== dmg) {
            const actors = global.get_window_actors?.() ?? [];
            for (let i = 0; i < actors.length; i++) {
                const a = actors[i];
                if (a && a.visible && a.mapped) {
                    if (isActorNearGlass(a, glassActor)) {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch (_) {
        return true;
    }
}

if (typeof globalThis._macGlassStats !== 'function')
    globalThis._macGlassStats = _macGlassStats;
