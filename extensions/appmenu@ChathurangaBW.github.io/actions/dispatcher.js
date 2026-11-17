import { windowActions } from './windowActions.js';
import { fileActions } from './fileActions.js';
import { viewActions } from './viewActions.js';
import { executeKeyboardAction } from './keyboardActions.js';
import * as Logger from '../logger.js';
import { toggleSearchDialog } from '../searchDialog.js';












const registry = { ...windowActions, ...fileActions, ...viewActions };






export function dispatch(actionStr, ctx, manager) {
    if (actionStr === 'open-search') {
        if (typeof globalThis._macSpotlightToggle === 'function') {
            globalThis._macSpotlightToggle();
        } else {
            toggleSearchDialog();
        }
        return true;
    }
    const colonIdx = actionStr.indexOf(':');
    const action = colonIdx === -1 ? actionStr : actionStr.slice(0, colonIdx);
    const param = colonIdx === -1 ? null : actionStr.slice(colonIdx + 1);

    const handler = registry[action];
    if (handler) {
        try {

            const result = handler(ctx, param, manager);
            if (result && typeof result.then === 'function') {
                result.catch(e => Logger.error(`Action "${action}" failed: ${e}`));
            }
            return true;
        } catch (e) {
            Logger.error(`Action "${action}" failed: ${e}`);
            return false;
        }
    }


    if (executeKeyboardAction(action, manager, ctx?.window ?? null)) return true;

    Logger.warn(`Unknown action: "${action}"`);
    return false;
}
