import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function run() {
    try {
        global.context.unsafe_mode = true;
        console.log('[UNSAFE_RUNNER] Ran successfully, unsafe_mode is now:', global.context.unsafe_mode);
    } catch (e) {
        console.error('[UNSAFE_RUNNER] Error:', e);
    }
}
