// glassGate.js — [GPU-SAVE] шлюз подій для Liquid Glass / Blur поверхонь.
//
// НОВИЙ файл (створено для гарячого завантаження у живій сесії): у dist/utils.js
// класи реєструють GType-імена (registerClass), тому повторний import того
// модуля в тій самій сесії падає з «Type name ... is already registered».
// Цей файл НЕ має registerClass — його можна чесно завантажувати/перевантажувати
// будь-коли (у тому числі версіоновано), і він містить тільки логіку шлюзу.
//
// Призначення: скло оновлює свій фон СТРОГО при будь-якій зміні того, що воно
// показує, і СТРОГО не частіше ніж 60 FPS (не герцовка екрана). У спокої
// дорогі оновлення не виконуються взагалі; залишковий «пульс» 1 Гц гарантує
// узгодженість (застряглі аллокації, семпли UI, кросфейди шпалер).
//
// Джерела фактів (все чисте JS-CPU, нуль GPU):
//   1. спільний stage-хеш: кількість+геометрія+mapped/visible/opacity всіх
//      MetaWindowActor (memo-кеш 4 мс, щоб N поверхонь не повторювали роботу
//      в межах одного кадру);
//   2. глобальний лічильник 'damaged' (вміст вікна змінився);
//   3. кількість дітей backgroundGroup (зміна шпалер);
//   4. геометрія моніторів;
//   5. власна геометрія/opacity скла.
//
// A/B відкат з EvalHelper:
//     globalThis._macGlassEventDriven = false;  // стара поведінка (кожен тік)
//     globalThis._macGlassStats();              // лічильники

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const GLASS_REFRESH_60FPS_INTERVAL_US = 16666; // жорстка межа 1/60 с
export const GLASS_REFRESH_HEARTBEAT_US = 1000000;    // пульс узгодженості: 1 с

let _backdropDamageVersion = 0;
let _backdropFailCounter = 0;
let _backdropSurfaceCount = 0;
let _backdropRefreshCount = 0;
let _backdropSkipCount = 0;
let _eventDrivenDefault = true;
const _backdropDamageHooked = new WeakSet();
const _backdropPolls = new WeakMap();

function _isActorValid(actor) {
    try {
        return !!actor && typeof actor === 'object' && !actor._isDisposed;
    } catch (_) {
        return false;
    }
}

/** Вміст вікна перемалювався — глобальний тригер для всіх скляних поверхонь. */
export function noteWindowContentDamaged() {
    _backdropDamageVersion++;
}

/** A/B-перемикач: false → glassRefreshDue завжди true (стара покадрова поведінка). */
export function setGlassEventDriven(enabled) {
    _eventDrivenDefault = !!enabled;
}

export function isGlassEventDriven() {
    if (typeof globalThis._macGlassEventDriven === 'boolean')
        return globalThis._macGlassEventDriven;
    return _eventDrivenDefault;
}

/** 32-бітний мікс хеша без алокаций. */
function _hmix(h, v) {
    const n = Number.isFinite(v) ? (v | 0) : 0;
    return (h ^ (n + 0x9E3779B9 + ((h << 6) | (h >>> 26)))) | 0;
}

let _stageScan = { at: -1e12, h: 0 };
function _stageBackdropHash(nowUs) {
    if (nowUs - _stageScan.at < 4000)
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
                const r = a.get_buffer_rect?.();
                if (r) {
                    h = _hmix(h, r.x); h = _hmix(h, r.y);
                    h = _hmix(h, r.width); h = _hmix(h, r.height);
                }
                h = _hmix(h, a.visible ? 1 : 0);
                h = _hmix(h, a.mapped ? 1 : 0);
                h = _hmix(h, a.get_opacity?.());
            } catch (_) {
                h = _hmix(h, i * 1000 + 7);
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
        // Зміна шпалер: GNOME міняє дітей backgroundGroup під час кросфейду.
        const bg = lm?.backgroundGroup;
        h = _hmix(h, bg && _isActorValid(bg) ? bg.get_n_children() : 0);
    } catch (_) {
        // Збій діагностики → хеш, який постійно міняється: кожен тік дає 'due'.
        // Безпечність важливіша за економію.
        return _hmix(_stageScan.h, ++_backdropFailCounter);
    }
    _stageScan = { at: nowUs, h };
    return h;
}

function _hookWindowDamage(actor) {
    try {
        if (_backdropDamageHooked.has(actor))
            return;
        _backdropDamageHooked.add(actor);
        actor.connect('damaged', () => {
            noteWindowContentDamaged();
        });
    } catch (_) {}
}

/** Хеш власної геометрії скла. */
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
    return { lastScanH: 0, lastDamage: -1, lastOwnH: -1, dirty: false, lastFull: 0 };
}

/**
 * Вирішує, чи виконувати дорогий рефреш на цьому тіку для цього скла.
 * До прикладу використання — doc у utils.js [GPU-SAVE] блоку.
 */
export function glassRefreshDue(glassActor, extraHash) {
    try {
        if (!isGlassEventDriven())
            return true; // A/B: стара поведінка — кожен тік.
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        const nowUs = GLib.get_monotonic_time();
        const scanH = _stageBackdropHash(nowUs);
        const dmg = _backdropDamageVersion;
        const ownH = _hmix(_ownGlassHash(glassActor), extraHash);
        if (st.lastScanH !== scanH || st.lastOwnH !== ownH) {
            st.lastScanH = scanH;
            st.lastDamage = dmg;
            st.lastOwnH = ownH;
            st.dirty = true;
        }
        if (!st.lastFull)
            return true; // перший тік після створення / show().
        const sinceFull = nowUs - st.lastFull;
        if (st.dirty)
            return sinceFull >= GLASS_REFRESH_60FPS_INTERVAL_US;
        return sinceFull >= GLASS_REFRESH_HEARTBEAT_US;
    } catch (e) {
        globalThis._lastDueError = `${e?.message || e}\n${e?.stack || ''}`;
        return true;
    }
}

/** Викликати ПІСЛЯ успішного повного рефрешу. */
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
        st.dirty = false;
        st.lastScanH = _stageBackdropHash(nowUs);
        st.lastDamage = _backdropDamageVersion;
        st.lastOwnH = _hmix(_ownGlassHash(glassActor), extraHash);
    } catch (_) {}
}

/** Форсувати повний рефреш на наступному перевіреному тіку. */
export function glassForceRefresh(glassActor) {
    try {
        let st = _backdropPolls.get(glassActor);
        if (!st) {
            st = _newPollState();
            _backdropPolls.set(glassActor, st);
        }
        st.dirty = true;
        st.lastFull = 0;
    } catch (_) {}
}

/** Обгортка-хвороби для прототипів: true → виконати оригінал. Повертає
 *  {due, finish()}. Ключ — сам інстанс (WeakMap), тож можна патчити
 *  прототипи класів, а стан тримати за кожним об'єктом. */
export function glassGateInstance(key) {
    return {
        due: (extraHash) => glassRefreshDue(key, extraHash),
        done: (extraHash) => glassRefreshDone(key, extraHash),
    };
}

/** spare entry для діагностики з EvalHelper. */
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

if (typeof globalThis._macGlassStats !== 'function')
    globalThis._macGlassStats = _macGlassStats;
