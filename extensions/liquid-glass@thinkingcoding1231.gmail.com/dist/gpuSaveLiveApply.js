// gpuSaveLiveApply.js — [GPU-SAVE] гарячий патч живої сесії.
//
// Проблема: dist/utils.js + менеджери реєструють GType-імена, тому повторний
// import цих модулів у тій самій сесії не_DRUCK («Type name already registered»),
// а без реєстру — модуль-кеш GJS повертає старий інстанс; reloadExtension не
// інваліду ES-модулі (докладно — done.txt, п. 5 канону: «Extensions can only be
// imported once»). Тобто ефективний шлях одразу цього життя — обернути
// ПРОТОТИПИ живих класів шлюзом glassGate.js:
//
//   • UILayerSampler.prototype.refresh  — важка перебірка-будувальник клонів UI;
//   • WindowCloneManager.prototype.sync — покрокова синхронізація клонів вікон;
//   • UILayerSampler.prototype.sync     — позиції клонів uiGroup;
//   • ApplicationManager.prototype._syncState — синхронізація скла вікна.
//
// Уся логіка-TIK (BEFORE_REDRAW-ланцюжки) залишається як була: вони самі
// стають дешевик, бо важливі всередині ці вызовы тепер шлются шлюзом:
// у спокої — 0 GPU-роботи; при зміні — рефреш ≤60 FPS; пульс 1 Гц.
//
// Ідемпотентно: повторний apply робить nothing (обгортки позначені).
// A/B через globalThis._macGlassEventDriven = false.

import { UILayerSampler, WindowCloneManager, reportFrameLoopError } from './utils.js';
import { ApplicationManager } from './applicationManager.js';
import * as Gate from './glassGate.js';

const _tag = '_gpuSaveGated';

function _wrap(proto, name, keyOf) {
    const original = proto[name];
    if (typeof original !== 'function')
        return `skip:${name}:missing`;
    if (original[_tag])
        return `skip:${name}:already`;
    const gated = function (...args) {
        let key = null;
        let extra;
        try {
            // Формат keyOf: об'єкт-ключ шлюзу (bgActor або сам інстанс),
            // extra — необов'язковий числовий хеш додаткових фактів.
            const plan = keyOf(this, args);
            if (typeof plan === 'object' && plan !== null) {
                key = plan.key;
                extra = plan.extra;
            }
            else if (plan !== null && plan !== undefined) {
                key = plan;
            }
        } catch (_) {
            key = null;
        }
        if (key !== null && key !== undefined) {
            try {
                if (!Gate.isGlassEventDriven())
                    return original.apply(this, args);
                const due = Gate.glassRefreshDue(key, extra);
                if (!due) {
                    // Пропущено роботу; шлюз викличе оригінал при найближчій
                    // зміні (≤60 FPS) чи на пульсі 1 Гц.
                    return undefined;
                }
                const result = original.apply(this, args);
                Gate.glassRefreshDone(key, extra);
                return result;
            } catch (e) {
                // Шлюз зламався → поведінка як була: виконати оригінал напряму.
                try {
                    return original.apply(this, args);
                } catch (e2) {
                    reportFrameLoopError?.(`GPU-SAVE:${name}`, e2);
                    return undefined;
                }
            }
        }
        return original.apply(this, args);
    };
    try {
        Object.defineProperty(gated, _tag, { value: true });
    } catch (_) {
        gated[_tag] = true;
    }
    proto[name] = gated;
    return `patched:${name}`;
}

let _applied = false;

export function applyLivePatch() {
    const lines = [];
    if (_applied)
        return { applied: true, lines: ['already-applied'] };
    try {
        // UILayerSampler.refresh — ключ: сам інстанс семплира.
        const sProto = UILayerSampler?.prototype;
        if (sProto) {
            lines.push(_wrap(sProto, 'refresh', (self) => ({
                key: self._selfActor ?? self,
                extra: (() => {
                    try {
                        // Хеш кулл-ректу: карта-sempl, моніктор у цьому циклі
                        // змінюється через setCullRect — відловлюємо зміну.
                        const r = self._cullRect;
                        return r ? (((r[0] | 0) * 73856093) ^ ((r[1] | 0) * 19349663) ^
                            ((r[2] | 0) * 83492791) ^ ((r[3] | 0) * 2654435761)) | 0 : 0;
                    } catch (_) {
                        return 0;
                    }
                })(),
            })));
        }
        // UILayerSampler.sync — позиції клонів UI (теж найважлівіша частина).
        if (sProto)
            lines.push(_wrap(sProto, 'sync', () => null)); // sync поки залишаємо необмеженим (чека watchers)
        // WindowCloneManager.sync — ключ: сам менеджер (унікальний об'єкт).
        const wProto = WindowCloneManager?.prototype;
        if (wProto) {
            lines.push(_wrap(wProto, 'sync', (self) => ({ key: self ?? self.windowClonesContainer })));
        }
        // ApplicationManager._syncState — кожне скляна поверхня вікна.
        const aProto = ApplicationManager?.prototype;
        if (aProto) {
            lines.push(_wrap(aProto, '_syncState', (self, args) => {
                const state = args?.[0];
                if (!state)
                    return null;
                try {
                    if (state.isDirty === true) {
                        // Власні сигнали аллокації вікна — обов'язковий рефреш.
                        state.isDirty = false;
                        return { key: state.bgActor ?? state, force: true };
                    }
                } catch (_) { /* fallthrough */ }
                return { key: state.bgActor ?? state };
            }));
        }
        _applied = true;
    } catch (e) {
        lines.push('apply-error:' + String(e).slice(0, 120));
    }
    return { applied: _applied, lines };
}

export function isLivePatchApplied() {
    return _applied;
}

/** Швидкий A/B перемикач з живого шелла. */
export function setEventDriven(enabled) {
    try {
        Gate.setGlassEventDriven(enabled);
    } catch (_) {}
    return Gate.isGlassEventDriven();
}

if (typeof globalThis._macGlassLivePatchInfo !== 'function')
    globalThis._macGlassLivePatchInfo = () => JSON.stringify({
        applied: _applied,
        eventDriven: Gate.isGlassEventDriven(),
    });
