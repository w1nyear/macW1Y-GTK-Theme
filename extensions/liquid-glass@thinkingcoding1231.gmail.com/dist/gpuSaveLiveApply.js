




















import { UILayerSampler, WindowCloneManager, reportFrameLoopError } from './utils.js?v=fix4';
import { ApplicationManager } from './applicationManager.js';
import * as Gate from './glassGate.js?v=fix4';

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


                    return undefined;
                }
                const result = original.apply(this, args);
                Gate.glassRefreshDone(key, extra);
                return result;
            } catch (e) {

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

        const sProto = UILayerSampler?.prototype;
        if (sProto) {
            lines.push(_wrap(sProto, 'refresh', (self) => ({
                key: self._selfActor ?? self,
                extra: (() => {
                    try {


                        const r = self._cullRect;
                        return r ? (((r[0] | 0) * 73856093) ^ ((r[1] | 0) * 19349663) ^
                            ((r[2] | 0) * 83492791) ^ ((r[3] | 0) * 2654435761)) | 0 : 0;
                    } catch (_) {
                        return 0;
                    }
                })(),
            })));
        }

        if (sProto)
            lines.push(_wrap(sProto, 'sync', () => null));

        const wProto = WindowCloneManager?.prototype;
        if (wProto) {
            lines.push(_wrap(wProto, 'sync', (self) => ({ key: self ?? self.windowClonesContainer })));
        }

        const aProto = ApplicationManager?.prototype;
        if (aProto) {
            lines.push(_wrap(aProto, '_syncState', (self, args) => {
                const state = args?.[0];
                if (!state)
                    return null;
                try {
                    if (state.isDirty === true) {

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
