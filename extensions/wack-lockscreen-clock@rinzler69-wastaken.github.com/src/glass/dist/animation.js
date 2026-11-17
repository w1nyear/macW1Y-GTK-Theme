import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { isActorValid } from './actors.js';
import { reportFrameLoopError } from './logger.js';


export function hexToColorArray(hex) {
    if (!hex || !hex.startsWith('#') || hex.length !== 7)
        return [1.0, 1.0, 1.0];
    return [
        parseInt(hex.slice(1, 3), 16) / 255.0,
        parseInt(hex.slice(3, 5), 16) / 255.0,
        parseInt(hex.slice(5, 7), 16) / 255.0,
    ];
}

export function hexToRgb(hex) {
    const value = parseInt(hex.replace('#', ''), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex(r, g, b) {
    return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

export function crossFadeColorAt(start, startAlpha, target, targetAlpha, progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (p < 0.5) {
        const local = p / 0.5;
        const a = startAlpha * (1 - local * local);
        return { r: start.r, g: start.g, b: start.b, a };
    }
    const local = (p - 0.5) / 0.5;

    const e = 1 - (1 - local) * (1 - local);
    return { r: target.r, g: target.g, b: target.b, a: targetAlpha * e };
}



const CROSS_FADE_LUMA_DELTA = 0.4;

export function shouldCrossFadeColors(start, target) {
    const luma = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return Math.abs(luma(target) - luma(start)) > CROSS_FADE_LUMA_DELTA;
}


export function lerpColorAt(start, startAlpha, target, targetAlpha, progress) {
    const p = Math.max(0, Math.min(1, progress));
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return {
        r: Math.round(start.r + (target.r - start.r) * e),
        g: Math.round(start.g + (target.g - start.g) * e),
        b: Math.round(start.b + (target.b - start.b) * e),
        a: startAlpha + (targetAlpha - startAlpha) * e,
    };
}

let _adaptiveColorMode = 'cross-fade';

export function setAdaptiveColorMode(mode) {
    _adaptiveColorMode = mode === 'rgb-lerp' ? 'rgb-lerp' : 'cross-fade';
}

export function getAdaptiveColorMode() {
    return _adaptiveColorMode;
}


export function resolveCrossFade(start, target) {
    return _adaptiveColorMode === 'cross-fade' && shouldCrossFadeColors(start, target);
}

class AdaptiveColorTweener {
    _entries = new Map();
    _laterId = 0;






    add(actor, entry, batchStart) {
        if (!actor)
            return;
        const prev = this._entries.get(actor);


        const startRgb = prev?.last
            ? { r: prev.last.r, g: prev.last.g, b: prev.last.b }
            : entry.startRgb;
        const startAlpha = prev?.last ? prev.last.a : entry.startAlpha;
        this._entries.set(actor, {
            ...entry,
            startRgb,
            startAlpha,
            crossFade: entry.crossFade && shouldCrossFadeColors(startRgb, entry.targetRgb),
            startTime: batchStart ?? GLib.get_monotonic_time(),
        });
        this._schedule();
    }

    cancel(actor) {
        this._entries.delete(actor);
    }

    stopAll() {
        this._entries.clear();
        this._unschedule();
    }

    isAnimating(actor) {
        return this._entries.has(actor);
    }

    _schedule() {
        if (this._laterId !== 0)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => { this._tick(); return false; });
    }

    _unschedule() {
        if (this._laterId === 0)
            return;
        global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;
    }

    _applyEntry(e, now) {
        const elapsedMs = (now - e.startTime) / 1000;
        const progress = e.durationMs > 0 ? Math.min(elapsedMs / e.durationMs, 1) : 1;
        const c = e.crossFade
            ? crossFadeColorAt(e.startRgb, e.startAlpha, e.targetRgb, e.targetAlpha, progress)
            : lerpColorAt(e.startRgb, e.startAlpha, e.targetRgb, e.targetAlpha, progress);
        const a = Math.max(0, Math.min(1, c.a));


        const same = e.coalesce !== false && e.last &&
            e.last.r === c.r && e.last.g === c.g && e.last.b === c.b &&
            Math.abs(e.last.a - a) < 0.002;
        if (!same) {
            e.last = { r: c.r, g: c.g, b: c.b, a };
            e.apply(c.r, c.g, c.b, a, progress);
        }
        return progress;
    }

    _tick() {
        this._laterId = 0;
        const now = GLib.get_monotonic_time();
        for (const [actor, e] of [...this._entries]) {
            if (!isActorValid(actor)) {
                this._entries.delete(actor);
                continue;
            }
            const progress = this._applyEntry(e, now);
            if (progress >= 1)
                this._entries.delete(actor);
        }
        if (this._entries.size > 0)
            this._schedule();
    }
}

export const adaptiveColorTweener = new AdaptiveColorTweener();
export const SAME_FRAME_WINDOW_US = 4000;
// Diagnostic switch (global._lgGlass.freezeSync): every per-frame sync tick


let _frameSyncFrozen = false;

export function setFrameSyncFrozen(frozen) {
    _frameSyncFrozen = !!frozen;
}

export function isFrameSyncFrozen() {
    return _frameSyncFrozen;
}

export function addBeforeRedraw(callback) {
    return global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, callback);
}

export function removeBeforeRedraw(id) {
    if (!id)
        return;
    global.compositor.get_laters().remove(id);
}




export function startLaterLoop(slot, loop) {
    if (slot.get() !== 0)
        return false;
    const tick = () => {
        slot.set(0);
        if (!loop.alive())
            return GLib.SOURCE_REMOVE;
        slot.set(addBeforeRedraw(tick));
        if (loop.honourFreeze && isFrameSyncFrozen())
            return GLib.SOURCE_REMOVE;
        try {
            loop.step();
        }
        catch (e) {
            reportFrameLoopError(loop.errorTag, e);
        }
        return GLib.SOURCE_REMOVE;
    };
    slot.set(addBeforeRedraw(tick));
    return true;
}

export function stopLaterLoop(slot) {
    const id = slot.get();
    slot.set(0);
    removeBeforeRedraw(id);
}




export function startStageLoop(signal, first, tick) {
    if (signal.get() !== 0)
        return false;
    signal.set(global.stage.connect('before-update', tick));
    first.set(addBeforeRedraw(() => {
        first.set(0);
        tick();
        return GLib.SOURCE_REMOVE;
    }));
    return true;
}

export function stopStageLoop(signal, first) {
    const signalId = signal.get();
    signal.set(0);
    if (signalId)
        global.stage.disconnect(signalId);
    stopLaterLoop(first);
}







export function startSyncLoop(signal, first, loop) {
    let lastUs = 0;
    return startStageLoop(signal, first, () => {
        if (!loop.alive()) {
            stopStageLoop(signal, first);
            return;
        }
        if (loop.honourFreeze && isFrameSyncFrozen())
            return;
        const nowUs = GLib.get_monotonic_time();
        if (nowUs - lastUs < SAME_FRAME_WINDOW_US)
            return;
        lastUs = nowUs;
        try {
            loop.step();
        }
        catch (e) {
            reportFrameLoopError(loop.errorTag, e);
        }
    });
}

const MAX_INTERVAL_MS = 50;
let _nextId = 0;
const _tickers = new Map();






export function addFrameTicker(cb, minIntervalMs = 0) {
    const id = ++_nextId;
    const ticker = { laterId: 0, cb, minUs: Math.max(0, minIntervalMs || 0) * 1000, last: 0 };
    _tickers.set(id, ticker);
    const schedule = () => {
        ticker.laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            ticker.laterId = 0;
            if (_tickers.get(id) !== ticker)
                return GLib.SOURCE_REMOVE;
            let keep = true;
            const now = GLib.get_monotonic_time();



            const due = ticker.last === 0 ||
                now - ticker.last >= Math.max(SAME_FRAME_WINDOW_US, ticker.minUs - SAME_FRAME_WINDOW_US);
            if (due) {
                ticker.last = now;
                try {
                    keep = !!ticker.cb();
                }
                catch (e) {
                    keep = false;
                    reportFrameLoopError('frameTicker', e);
                }
            }
            if (_tickers.get(id) !== ticker)
                return GLib.SOURCE_REMOVE;
            if (keep)
                schedule();
            else
                _tickers.delete(id);
            return GLib.SOURCE_REMOVE;
        });
    };
    schedule();
    return id;
}

export function removeFrameTicker(id) {
    const ticker = _tickers.get(id);
    if (!ticker)
        return;
    _tickers.delete(id);
    if (!ticker.laterId)
        return;
    global.compositor.get_laters().remove(ticker.laterId);
    ticker.laterId = 0;
}






export function normalizeAnimationIntervalMs(v) {
    if (!Number.isFinite(v) || v <= 16)
        return 0;
    return Math.min(Math.round(v), MAX_INTERVAL_MS);
}




export const MAX_STEP_S = 0.066;
const SUB_STEP_S = 0.002;


export class Spring {
    stiffness;
    damping;
    mass;
    value;
    velocity;
    target;

    constructor(stiffness, damping, mass) {
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
        this.value = 0;
        this.velocity = 0;
        this.target = 0;
    }

    updateParams(stiffness, damping, mass) {
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
    }

    update(elapsedMs) {
        let dt = elapsedMs / 1000;
        if (dt > MAX_STEP_S)
            dt = MAX_STEP_S;


        const mass = this.mass > 1e-3 ? this.mass : 1e-3;
        let remaining = dt;
        while (remaining > 1e-6) {
            const h = Math.min(remaining, SUB_STEP_S);
            const springForce = -this.stiffness * (this.value - this.target);
            const dampingForce = -this.damping * this.velocity;
            const acceleration = (springForce + dampingForce) / mass;
            this.velocity += acceleration * h;
            this.value += this.velocity * h;
            remaining -= h;
        }

        return Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.001;
    }
}



export class SwiftSpring {
    response = 0.4;
    dampingFraction = 0.7;
    mass = 1.0;
    value = 0;
    velocity = 0;
    target = 0;

    constructor(response, dampingFraction, mass = 1.0) {
        this.updateParams(response, dampingFraction, mass);
    }


    updateParams(response, dampingFraction, mass = 1.0) {
        if (response > 0.01)
            this.response = response;
        if (dampingFraction >= 0)
            this.dampingFraction = dampingFraction;
        if (mass > 0.01)
            this.mass = mass;
    }

    update(elapsedMs) {
        let dt = elapsedMs / 1000;
        if (!(dt > 0))
            return false;
        if (dt > 0.1)
            dt = 0.1;
        if (!Number.isFinite(this.value) || !Number.isFinite(this.velocity)) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        const x0 = this.value - this.target;
        const v0 = this.velocity;
        if (Math.abs(x0) < 0.001 && Math.abs(v0) < 0.001) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        const omega0 = (2 * Math.PI) / this.response;
        const zeta = this.dampingFraction;
        let x_t = 0;
        let v_t = 0;
        if (zeta < 0.999) {

            const omegaD = omega0 * Math.sqrt(1.0 - zeta * zeta);
            const alpha = zeta * omega0;
            const exp = Math.exp(-alpha * dt);
            const cos = Math.cos(omegaD * dt);
            const sin = Math.sin(omegaD * dt);
            x_t = exp * (x0 * cos + ((v0 + alpha * x0) / omegaD) * sin);
            v_t = exp * (v0 * cos - ((alpha * v0 + omega0 * omega0 * x0) / omegaD) * sin);
        }
        else if (zeta > 1.001) {

            const beta = omega0 * Math.sqrt(zeta * zeta - 1.0);
            const gamma1 = -zeta * omega0 + beta;
            const gamma2 = -zeta * omega0 - beta;
            const exp1 = Math.exp(gamma1 * dt);
            const exp2 = Math.exp(gamma2 * dt);
            const c1 = (v0 - gamma2 * x0) / (gamma1 - gamma2);
            const c2 = x0 - c1;
            x_t = c1 * exp1 + c2 * exp2;
            v_t = c1 * gamma1 * exp1 + c2 * gamma2 * exp2;
        }
        else {

            const exp = Math.exp(-omega0 * dt);
            x_t = exp * (x0 + (v0 + omega0 * x0) * dt);
            v_t = exp * (v0 - omega0 * (v0 + omega0 * x0) * dt);
        }
        this.value = x_t + this.target;
        this.velocity = v_t;
        if (!Number.isFinite(this.value)) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        this.value = Math.max(-0.5, Math.min(2.5, this.value));
        if (Math.abs(this.value - this.target) < 0.001 && Math.abs(this.velocity) < 0.001) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        return false;
    }
}





export class RectSpring {
    _from;
    _to;
    _progress;
    _lastUs = 0;

    constructor(rect, response = 0.42, dampingFraction = 0.72) {
        this._from = [...rect];
        this._to = [...rect];
        this._progress = new SwiftSpring(response, dampingFraction);
        this._progress.value = 1;
        this._progress.target = 1;
    }

    setTarget(target, nowUs) {
        if (target.every((v, i) => Math.abs(v - this._to[i]) < 0.5))
            return;
        this._from = this.rect(nowUs);
        this._to = [...target];
        this._progress.value = 0;
        this._progress.velocity = 0;
    }

    rect(nowUs) {
        if (this._lastUs)
            this._progress.update((nowUs - this._lastUs) / 1000);
        this._lastUs = nowUs;
        const p = this._progress.value;
        return this._from.map((v, i) => v + (this._to[i] - v) * p);
    }

    settled() {
        return this._progress.value === this._progress.target && this._progress.velocity === 0;
    }
}

const CLOSE_SPEED = 15.0;
const CLOSED_BELOW = 0.005;
const OPEN_SNAP_DISTANCE = 0.002;
const OPEN_SNAP_VELOCITY = 0.03;

function clampOpacity(v) {
    return Math.min(255, Math.max(0, v));
}


function stepClosing(scale, elapsedMs) {
    const dt = Math.min(elapsedMs / 1000, MAX_STEP_S);
    const k = 1.0 - Math.exp(-CLOSE_SPEED * dt);
    scale.value += (0 - scale.value) * k;
    if (scale.value < CLOSED_BELOW)
        return { s: 0, stopped: true };
    return { s: scale.value, stopped: false };
}


function stepOpening(scale, elapsedMs) {
    const settled = scale.update(elapsedMs);
    const s = scale.value;

    if (Math.abs(1.0 - s) < OPEN_SNAP_DISTANCE && Math.abs(scale.velocity) < OPEN_SNAP_VELOCITY)
        return { s: 1.0, stopped: true };
    return { s, stopped: settled };
}

export function stepMenuSpring(scale, elapsedMs) {
    const closing = scale.target === 0;
    const { s, stopped } = closing ? stepClosing(scale, elapsedMs) : stepOpening(scale, elapsedMs);


    if (closing)
        return { closing, stopped, scale: Math.max(0.001, s), opacity: clampOpacity((s - 0.3) / 0.7 * 255) };
    return { closing, stopped, scale: 0.2 + s * 0.8, opacity: clampOpacity((s / 0.3) * 255) };
}

export function applyMenuFrame(frame, animActor, glass, menuActor, sync) {
    animActor.set_scale(frame.scale, frame.scale);
    glass.opacity = frame.opacity;
    animActor.opacity = frame.opacity;
    sync();
    if (!frame.stopped)
        return;
    if (frame.closing) {
        if (!menuActor)
            return;
        menuActor.hide();
        glass.opacity = 0;
        animActor.opacity = 0;
        return;
    }
    animActor.set_scale(1.0, 1.0);
    animActor.opacity = 255;
    glass.opacity = 255;
    sync();
}

export function showMenuAtRest(glass, animActor) {
    if (!glass)
        return;
    glass.remove_all_transitions();
    glass.opacity = 255;
    glass.set_scale(1.0, 1.0);
    if (!animActor)
        return;
    animActor.set_scale(1.0, 1.0);
    animActor.opacity = 255;
}



function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
}

export class RectTween {
    _durationMs;
    _from = [0, 0, 1, 1];
    _to = [0, 0, 1, 1];
    _startUs = 0;

    constructor(_durationMs) {
        this._durationMs = _durationMs;
    }


    start(rect, target, nowUs) {
        this._from = [...rect];
        this._to = [...target];
        this._startUs = nowUs;
    }


    setTarget(target, nowUs) {
        if (target.every((v, i) => Math.abs(v - this._to[i]) < 0.5))
            return;
        this.start(this.rect(nowUs), target, nowUs);
    }


    remaining(nowUs) {
        return Math.max(this._durationMs - (nowUs - this._startUs) / 1000, 0);
    }

    rect(nowUs) {
        const t = Math.min(Math.max((nowUs - this._startUs) / (this._durationMs * 1000), 0), 1);
        const k = easeOutCubic(t);
        return this._from.map((v, i) => v + (this._to[i] - v) * k);
    }
}

const STEP_S = 0.002;
const MAX_FRAME_S = 0.05;

class MorphSpring {
    value;
    _stiffness;
    _damping;
    velocity = 0;
    target;

    constructor(value, _stiffness, _damping) {
        this.value = value;
        this._stiffness = _stiffness;
        this._damping = _damping;
        this.target = value;
    }

    step(dt) {
        const acc = -this._stiffness * (this.value - this.target) - this._damping * this.velocity;
        this.velocity += acc * dt;
        this.value += this.velocity * dt;
    }

    settled(within) {
        return Math.abs(this.value - this.target) < within && Math.abs(this.velocity) < within * 10;
    }
}


const OPEN_MOVE = [144, 14];
const CLOSE_MOVE = [130, 18];
const CONTENT_FADE = [137, 20];


const THROW = 16;





const PUSH = 3.65;
const PUSH_MIN = 0.67;





const DROP_SIZE = 1.15;
const CAPSULE_S = 0.14;
const CLOCK_START = 0.3;
const CLOCK_POWER = 8;
const CAPSULE_PUSH = 2.2;

const ROUND_S = 0.1;


const REVEAL_S = 0.12;



const SETTLED_SWING = 0.25;
const OPEN_SIZE_S = 0.3;
const CLOSE_SIZE_S = 0.25;
const CONTENT_SCALE_S = 0.3;

const CONTENT_CLOSED_SCALE = 2;


const LENS_S = 0.3;






const ARRIVE_HEIGHTS = 2;
const ARRIVE_MAX_S = 0.6;
const CLOSE_CAPSULE_S = 0.16;
const FADE_DELAY_S = 0.24;
const FADE_S = 0.12;





const SOFTEN_HEIGHTS = 1.5;
const SOFTEN_S = 0.1;

function cubicBezier(x1, y1, x2, y2) {
    const at = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    const slope = (t, a, b) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
    return x => {
        if (x <= 0 || x >= 1)
            return Math.min(Math.max(x, 0), 1);
        let t = x;
        for (let i = 0; i < 8; i++) {
            const d = slope(t, x1, x2);
            if (Math.abs(d) < 1e-6)
                break;
            t = Math.min(Math.max(t - (at(t, x1, x2) - x) / d, 0), 1);
        }
        return at(t, y1, y2);
    };
}


const openSize = cubicBezier(0.8, 0.3, 0.5, 0.8);

const easeOut = (t) => 1 - (1 - t) ** 2;

const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;



const CLOSE_FADE_HOLD = 1.0;

const FADE_STEP_S = 0.002;
const OPEN_FADE = (() => {
    const fade = new MorphSpring(0, CONTENT_FADE[0], CONTENT_FADE[1]);
    fade.target = 1;
    const values = [];
    for (let t = 0; t < 1; t += FADE_STEP_S) {
        values.push(clamp01(fade.value));
        fade.step(FADE_STEP_S);
    }
    return values;
})();

function clamp01(t) {
    return Math.min(Math.max(t, 0), 1);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

export class MenuMorphMotion {
    opening;
    _buttonRect;
    _menu;
    _menuRadius;
    _t = 0;
    _x;
    _y;
    _opacity;


    _capsuleS;
    _sizeFrom;


    _radiusFrom;


    _roundS = 0;

    _glassFrom = 1;
    _softenFrom = 0;
    _contentFrom;
    _lensFrom;

    _arrivedAt = -1;
    _arrivedSize = [];


    _furthest = 0;
    _soften = 0;
    _frame;
    _pushVx = 0;
    _pushVy = 0;






    constructor(opening, _buttonRect, _menu, _menuRadius, from = null, velocities = null, random = Math.random) {
        this.opening = opening;
        this._buttonRect = _buttonRect;
        this._menu = _menu;
        this._menuRadius = _menuRadius;
        const start = from ?? (opening
            ? {
                body: [..._buttonRect], bodyRadius: _buttonRect[3] / 2, contentScale: CONTENT_CLOSED_SCALE,
                contentOpacity: 0, lens: 1, glassOpacity: 1, soften: 0, done: false
            }
            : {
                body: [..._menu], bodyRadius: _menuRadius, contentScale: 1, contentOpacity: 1, lens: 0, glassOpacity: 1,
                soften: 0, done: false
            });
        this._frame = start;
        this._capsuleS = opening && !from ? CAPSULE_S : 0;
        const [stiffness, damping] = opening ? OPEN_MOVE : CLOSE_MOVE;

        const [cx, y] = center(start.body);
        this._x = new MorphSpring(cx, stiffness, damping);
        this._y = new MorphSpring(y, stiffness, damping);
        this._opacity = new MorphSpring(start.contentOpacity, CONTENT_FADE[0], CONTENT_FADE[1]);
        if (velocities)
            [this._x.velocity, this._y.velocity] = velocities;
        const drop = this._drop();
        this._sizeFrom = this._capsuleS ? [drop, drop] : [start.body[2], start.body[3]];
        this._radiusFrom = opening
            ? start.bodyRadius / Math.max(Math.min(start.body[2], start.body[3]) / 2, 1)
            : start.bodyRadius;
        if (opening && from) {
            const [fw, fh] = [start.body[2], start.body[3]];
            if (Math.min(fw, fh) <= drop * 1.01 && Math.max(fw, fh) > drop * 1.05)
                this._roundS = ROUND_S;
        }
        this._contentFrom = start.contentScale;
        this._lensFrom = start.lens;
        this._glassFrom = start.glassOpacity;
        this._softenFrom = start.soften;
        this._aim();
        if (opening && !velocities) {
            const launch = this._capsuleS ? CAPSULE_PUSH : THROW * 0.5;
            for (const s of [this._x, this._y])
                s.velocity = (s.target - s.value) * launch;
            const angle = random() * Math.PI;
            const push = PUSH * Math.min(_menu[2], _menu[3]) * lerp(PUSH_MIN, 1, random());
            this._pushVx = Math.cos(angle) * push;
            this._pushVy = Math.sin(angle) * push;
        }
    }


    get velocities() {
        return [this._x.velocity, this._y.velocity];
    }

    get frame() {
        return this._frame;
    }


    retarget(button, menu, menuRadius) {
        this._buttonRect = button;
        if (menu)
            this._menu = menu;
        this._menuRadius = menuRadius;
        this._aim();
    }


    _drop() {
        const [, , w, h] = this._buttonRect;
        return Math.max(Math.min(h * DROP_SIZE, w), 1);
    }

    _aim() {
        [this._x.target, this._y.target] = center(this.opening ? this._menu : this._buttonRect);
        this._opacity.target = this.opening ? 1 : 0;
    }


    step(elapsed, speed) {
        let dt = Math.min(Math.max(elapsed, 0), MAX_FRAME_S);
        dt *= speed;
        this._t += dt;
        this._frame = this.opening ? this._open(dt) : this._close(dt);
        return this._frame;
    }

    _stepSprings(dt, motionOnly = false) {
        const springs = motionOnly ? [this._x, this._y] : [this._x, this._y, this._opacity];
        for (let t = 0; t < dt; t += STEP_S) {
            const h = Math.min(STEP_S, dt - t);
            for (const s of springs)
                s.step(h);
        }
    }

    _open(dt) {
        if (this._capsuleS) {



            const before = this._t - dt;
            const span = Math.min(this._t, this._capsuleS) - Math.min(before, this._capsuleS);
            if (span > 0) {
                const u = (before + span / 2) / this._capsuleS;
                const ease = u * u * u * (u * (u * 6 - 15) + 10);
                this._stepSprings(span * lerp(CLOCK_START, 1, ease ** CLOCK_POWER), true);
            }
        }
        if (this._t < this._capsuleS) {
            const t = this._t / this._capsuleS;

            const k = easeInOut(clamp01((t - 0.3) / 0.7));
            const [, , bw, bh] = this._buttonRect;
            const drop = this._drop();
            const w = lerp(bw, drop, k), h = lerp(bh, drop, k);
            const x = this._x.value, y = this._y.value;
            this._radiusFrom = 1;
            return {
                body: [x - w / 2, y - h / 2, w, h], bodyRadius: Math.min(w, h) / 2,
                contentScale: CONTENT_CLOSED_SCALE, contentOpacity: 0, lens: 1, glassOpacity: 1, soften: 0, done: false
            };
        }
        const t = this._t - this._capsuleS;
        this._stepSprings(Math.min(dt, t));
        if (t > 0 && t < 0.2 && (this._pushVx !== 0 || this._pushVy !== 0)) {
            const forceFactor = Math.sin((t / 0.2) * Math.PI) * (dt / 0.2);
            this._x.velocity += this._pushVx * forceFactor;
            this._y.velocity += this._pushVy * forceFactor;
        }
        const g = t - this._roundS;
        let w, h, radius;
        if (g < 0) {

            const drop = this._drop();
            const c = easeInOut(clamp01(t / this._roundS));
            w = lerp(this._sizeFrom[0], drop, c);
            h = lerp(this._sizeFrom[1], drop, c);
            radius = Math.min(w, h) / 2;
        }
        else {
            const from = this._roundS ? [this._drop(), this._drop()] : this._sizeFrom;
            const k = openSize(clamp01(g / OPEN_SIZE_S));
            w = lerp(from[0], this._menu[2], k);
            h = lerp(from[1], this._menu[3], k);

            const menuRound = this._menuRadius / Math.max(Math.min(this._menu[2], this._menu[3]) / 2, 1);
            const roundFrom = this._roundS ? 1 : this._radiusFrom;

            radius = Math.max(lerp(roundFrom, menuRound, k) * Math.min(w, h) / 2, Math.min(this._menuRadius, w / 2, h / 2));
        }
        const k = openSize(clamp01(Math.max(g, 0) / OPEN_SIZE_S));
        const reveal = clamp01(t / REVEAL_S);
        const moving = !this._x.settled(0.5) || !this._y.settled(0.5);

        const swing = lerp(1, SETTLED_SWING, k ** 3);
        const x = this._x.target + (this._x.value - this._x.target) * swing;
        const y = this._y.target + (this._y.value - this._y.target) * swing;
        return {
            body: [x - w / 2, y - h / 2, w, h],
            bodyRadius: Math.min(radius, w / 2, h / 2),
            contentScale: lerp(this._contentFrom, 1, easeOut(clamp01(t / CONTENT_SCALE_S))),
            contentOpacity: clamp01(this._opacity.value),
            lens: this._lensFrom * (1 - clamp01(t / LENS_S) ** 2),
            glassOpacity: lerp(this._glassFrom, 1, reveal),
            soften: lerp(this._softenFrom, 0, reveal),
            done: !moving && g >= OPEN_SIZE_S,
        };
    }


    _closeOpacity(w, h) {
        const drop = this._drop();
        const grown = Math.min((w - drop) / Math.max(this._menu[2] - drop, 1), (h - drop) / Math.max(this._menu[3] - drop, 1));
        const k = clamp01(grown);
        let lo = 0, hi = 1;
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2;
            if (openSize(mid) < k)
                lo = mid;
            else
                hi = mid;
        }
        return OPEN_FADE[Math.min(Math.round(lo * OPEN_SIZE_S * CLOSE_FADE_HOLD / FADE_STEP_S), OPEN_FADE.length - 1)];
    }

    _close(dt) {
        this._stepSprings(dt);
        const t = this._t;
        const drop = this._drop();
        const targetW = Math.min(this._sizeFrom[0], drop);
        const targetH = Math.min(this._sizeFrom[1], drop);
        const k = easeOut(clamp01(t / CLOSE_SIZE_S));
        const w = lerp(this._sizeFrom[0], targetW, k);
        const h = lerp(this._sizeFrom[1], targetH, k);

        const radius = lerp(this._radiusFrom, Math.min(w, h) / 2, k);
        let body = [this._x.value - w / 2, this._y.value - h / 2, w, h];
        let bodyRadius = Math.min(radius, w / 2, h / 2);
        const [hx, hy] = center(this._buttonRect);
        const near = Math.hypot(this._x.value - hx, this._y.value - hy) <= this._buttonRect[3] * ARRIVE_HEIGHTS;
        if (this._arrivedAt < 0 && ((near && t >= CLOSE_SIZE_S) || t >= ARRIVE_MAX_S || this._sizeFrom[0] <= drop)) {
            this._arrivedAt = t;
            this._arrivedSize = [w, h];
        }
        let glassOpacity = 1;
        let since = -1;
        if (this._arrivedAt >= 0) {

            since = t - this._arrivedAt;
            const c = easeInOut(clamp01(since / CLOSE_CAPSULE_S));
            const [aw, ah] = this._arrivedSize;
            const [, , bw, bh] = this._buttonRect;
            const cw = lerp(aw, bw, c), ch = lerp(ah, bh, c);
            const cx = lerp(this._x.value, hx, c), cy = lerp(this._y.value, hy, c);
            body = [cx - cw / 2, cy - ch / 2, cw, ch];
            bodyRadius = Math.min(cw, ch) / 2;
            glassOpacity = 1 - easeInOut(clamp01((since - FADE_DELAY_S) / FADE_S));
        }


        const gap = rectGap(body, this._buttonRect);
        this._furthest = Math.max(this._furthest, gap);
        const ramp = Math.min(this._buttonRect[3] * SOFTEN_HEIGHTS, this._furthest);
        const closeness = ramp > 0 ? 1 - gap / ramp : 1;
        this._soften = Math.max(this._soften, clamp01(closeness), since >= 0 ? clamp01(since / SOFTEN_S) : 0);
        const soften = this._soften;
        return {
            body,
            bodyRadius,
            contentScale: lerp(this._contentFrom, CONTENT_CLOSED_SCALE, easeOut(clamp01(t / CONTENT_SCALE_S))),
            contentOpacity: this._closeOpacity(w, h),
            lens: lerp(this._lensFrom, 1, easeOut(clamp01(t / LENS_S))),
            glassOpacity,
            soften,
            done: glassOpacity === 0,
        };
    }
}


function rectGap(a, b) {
    const dx = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), 0);
    const dy = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]), 0);
    return Math.hypot(dx, dy);
}

function center(r) {
    return [r[0] + r[2] / 2, r[1] + r[3] / 2];
}






const START_SCALE = 0.7;


const RESPONSE_S = 0.27;
const DAMPING_FRACTION = 0.66;


const START_VELOCITY = 4;


const SLOWEST_SPEED = 0.65;

const SETTLE_S = Math.log(500) / (DAMPING_FRACTION * 2 * Math.PI / RESPONSE_S);

export const MIN_GLASS_GAP = 3;

const YIELD_POWER = 8;


export function introProgress(t) {
    if (t <= 0)
        return 0;
    const omega0 = 2 * Math.PI / RESPONSE_S;
    const zeta = DAMPING_FRACTION;
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega0 * t);
    return 1 - decay * (Math.cos(omegaD * t) + (zeta * omega0 - START_VELOCITY) / omegaD * Math.sin(omegaD * t));
}






export class ToggleIntro {
    _rects;
    _center;
    _speeds;

    _pairs = [];

    constructor(_rects, anchor, expand) {
        this._rects = _rects;
        const x0 = Math.min(..._rects.map(r => r[0]));
        const y0 = Math.min(..._rects.map(r => r[1]));
        const x1 = Math.max(..._rects.map(r => r[0] + r[2]));
        const y1 = Math.max(..._rects.map(r => r[1] + r[3]));
        this._center = [(x0 + x1) / 2, (y0 + y1) / 2];
        const distances = _rects.map(r => Math.hypot(r[0] + r[2] / 2 - anchor[0], r[1] + r[3] / 2 - anchor[1]));
        const near = Math.min(...distances);
        const span = Math.max(...distances) - near;
        this._speeds = distances.map(d => span > 0 ? 1 - (1 - SLOWEST_SPEED) * (d - near) / span : 1);
        for (let i = 0; i < _rects.length; i++) {
            for (let j = i + 1; j < _rects.length; j++) {
                const rest = distance(_rects[i], _rects[j]);

                if (rest - 2 * expand < 0)
                    continue;
                this._pairs.push({ i, j, gap: Math.min(rest, 2 * expand + MIN_GLASS_GAP) });
            }
        }
    }

    frame(t) {
        const [cx, cy] = this._center;
        const progress = this._speeds.map(speed => introProgress(t * speed));
        const rects = this._rects.map((r, i) => {
            const k = START_SCALE + (1 - START_SCALE) * progress[i];
            const mx = cx + (r[0] + r[2] / 2 - cx) * k;
            const my = cy + (r[1] + r[3] / 2 - cy) * k;
            return [mx - r[2] * k / 2, my - r[3] * k / 2, r[2] * k, r[3] * k];
        });
        this._keepApart(rects);
        return {
            rects,
            opacity: progress.map(p => Math.min(Math.max(p, 0), 1)),
            done: t >= SETTLE_S / SLOWEST_SPEED,
        };
    }






    _keepApart(rects) {
        for (let pass = 0; pass < 3; pass++) {
            for (const { i, j, gap } of this._pairs) {
                const short = gap - distance(rects[i], rects[j]);
                if (short <= 0)
                    continue;
                const [gx, gy] = axisGaps(rects[i], rects[j]);
                const [wi, wj] = [i, j].map(n => (rects[n][2] / this._rects[n][2]) ** YIELD_POWER);
                for (const [n, weight] of [[i, wi / (wi + wj)], [j, wj / (wi + wj)]]) {
                    const r = rects[n];

                    const shrink = (axis) => (r[axis + 2] - 2 * short * weight) / r[axis + 2];
                    const k = Math.max(gx > 0 && gy > 0 ? Math.min(shrink(0), shrink(1)) : shrink(gx > gy ? 0 : 1), 0.5);
                    const [mx, my] = [r[0] + r[2] / 2, r[1] + r[3] / 2];
                    rects[n] = [mx - r[2] * k / 2, my - r[3] * k / 2, r[2] * k, r[3] * k];
                }
            }
        }
    }
}


function axisGaps(a, b) {
    return [Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]), Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3])];
}


function distance(a, b) {
    const [gx, gy] = axisGaps(a, b);
    return gx > 0 && gy > 0 ? Math.hypot(gx, gy) : Math.max(gx, gy);
}
