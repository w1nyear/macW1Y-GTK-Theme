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

export const GLASS_REFRESH_ACTIVE_INTERVAL_US = 8333;   // до 120 FPS під час активного руху/трансформації (macW1Y ProMotion)
export const GLASS_REFRESH_BACKGROUND_INTERVAL_US = 16666; // 60 FPS для фонових змін під склом (відео, ігри, анімації)
export const GLASS_REFRESH_60FPS_INTERVAL_US = 16666;      // звичайна межа 60 FPS
export const GLASS_REFRESH_HEARTBEAT_US = 1500000;         // пульс узгодженості у спокої: 1.5 с

let _backdropDamageVersion = 0;
let _backdropFailCounter = 0;
let _backdropSurfaceCount = 0;
let _backdropRefreshCount = 0;
let _backdropSkipCount = 0;
let _eventDrivenDefault = true;
const _backdropDamageHooked = new WeakSet();
const _backdropPolls = new WeakMap();
const _wakeListeners = new Set();

export function addGlassWakeListener(fn) {
    if (typeof fn === 'function')
        _wakeListeners.add(fn);
}

export function removeGlassWakeListener(fn) {
    _wakeListeners.delete(fn);
}

export function notifyGlassWake(actor) {
    for (const fn of _wakeListeners) {
        try {
            fn(actor);
        } catch (_) {}
    }
}

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
        if (!actor || !_isActorValid(actor) || _backdropDamageHooked.has(actor))
            return;
        _backdropDamageHooked.add(actor);
        actor.connect('damaged', () => {
            actor._lastDamageUs = GLib.get_monotonic_time();
            noteWindowContentDamaged();
            notifyGlassWake(actor);
        });
        actor.connect('destroy', () => {
            _backdropDamageHooked.delete(actor);
        });
    } catch (_) {}
}

export function hookWindowDamage(actor) {
    _hookWindowDamage(actor);
}

/** Перевіряє, чи вікно перетинає або знаходиться близько (в межах 100px) до актора скла. */
export function isActorNearGlass(windowActor, glassActor) {
    try {
        if (!windowActor || !_isActorValid(windowActor))
            return false;
        if (!glassActor || !_isActorValid(glassActor))
            return false;

        const wRect = windowActor.get_buffer_rect?.();
        let wX = wRect?.x;
        let wY = wRect?.y;
        let wW = wRect?.width;
        let wH = wRect?.height;

        if (!Number.isFinite(wX) || !Number.isFinite(wY) || !wW || !wH || wW <= 0 || wH <= 0) {
            const [wx, wy] = windowActor.get_transformed_position?.() ?? [windowActor.x, windowActor.y];
            const [ww, wh] = windowActor.get_transformed_size?.() ?? [windowActor.width, windowActor.height];
            wX = wx; wY = wy; wW = ww; wH = wh;
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

        // Зона чутливості 100px навколо елемента скла
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
    const nowUs = GLib.get_monotonic_time();
    return {
        lastScanH: 0,
        lastDamage: -1,
        lastOwnH: -1,
        dirty: true,
        lastFull: 0,
        settleUntilUs: nowUs + 800000 // 800ms адаптивного осідання після створення/відкриття
    };
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
        if (!st.lastFull) {
            st.settleUntilUs = nowUs + 800000;
            return true; // перший тік після створення / show().
        }

        const scanH = _stageBackdropHash(nowUs);
        const dmg = _backdropDamageVersion;
        const ownH = _hmix(_ownGlassHash(glassActor), extraHash);

        const scanChanged = (st.lastScanH !== scanH);
        const ownChanged = (st.lastOwnH !== ownH);
        const dmgChanged = (st.lastDamage !== dmg);

        // Перевіряємо, чи елемент зараз у періоді осідання після відкриття
        const isSettling = (nowUs < (st.settleUntilUs || 0));

        // Перевіряємо, чи було пошкодження (відео, гра, анімація) вікна під чи поблизу скла
        let isNearDamaged = false;
        if (dmgChanged) {
            try {
                const actors = global.get_window_actors?.() ?? [];
                for (let i = 0; i < actors.length; i++) {
                    const a = actors[i];
                    if (a && a.visible && a.mapped && (a._lastDamageUs && a._lastDamageUs >= st.lastFull)) {
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

        if (scanChanged || ownChanged || isNearDamaged || isSettling) {
            st.lastScanH = scanH;
            st.lastDamage = dmg;
            st.lastOwnH = ownH;
            st.dirty = true;
        }

        const sinceFull = nowUs - st.lastFull;

        if (st.dirty) {
            // macW1Y ProMotion Dynamic Adaptivity:
            // Активний рух власної геометрії скла -> до 120 FPS (8.3 мс)
            // Зміна фону під склом / вікно поруч (відео, гра, анімація) -> 60 FPS (16.6 мс)
            const dueInterval = ownChanged ? GLASS_REFRESH_ACTIVE_INTERVAL_US : GLASS_REFRESH_60FPS_INTERVAL_US;
            if (sinceFull >= dueInterval) {
                return true;
            }
            _backdropSkipCount++;
            return false;
        }

        // Пульс узгодженості у спокої: 1.5 с
        if (sinceFull >= GLASS_REFRESH_HEARTBEAT_US) {
            return true;
        }

        // [GPU-OPTIMIZE] У спокої, коли нічого не брудне (st.dirty === false),
        // не виконувати дорогі оновлення взагалі (0% GPU в idle).
        _backdropSkipCount++;
        return false;
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
        st.settleUntilUs = GLib.get_monotonic_time() + 800000;
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

/**
 * Швидка пасивна перевірка для фонового watchdog/heartbeat:
 * повертає true, якщо фон, вікна або пошкодження сцени змінилися
 * з моменту останнього рефрешу цього скла.
 * Нуль GPU, час перевірки <0.005 мс.
 */
export function isBackdropDirtyOrChanged(glassActor) {
    try {
        if (!glassActor) return false;
        let st = _backdropPolls.get(glassActor);
        if (!st) return true;
        const nowUs = GLib.get_monotonic_time();
        if (st.dirty || (st.settleUntilUs && nowUs < st.settleUntilUs)) return true;
        const scanH = _stageBackdropHash(nowUs);
        if (st.lastScanH !== scanH) return true;
        const dmg = _backdropDamageVersion;
        if (st.lastDamage !== dmg) {
            const actors = global.get_window_actors?.() ?? [];
            for (let i = 0; i < actors.length; i++) {
                const a = actors[i];
                if (a && a.visible && a.mapped && (a._lastDamageUs && a._lastDamageUs >= st.lastFull)) {
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
