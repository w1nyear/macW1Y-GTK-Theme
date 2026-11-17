// SPDX-License-Identifier: GPL-3.0-or-later



export class FocusMyWindow {
    enable() {

        this._handlerid = null;
    }

    disable() {
        if (this._handlerid) {
            global.display.disconnect(this._handlerid);
            this._handlerid = null;
        }
    }
}

let focusMyWindowInstance = null;

export function enable() {
    if (!focusMyWindowInstance) {
        focusMyWindowInstance = new FocusMyWindow();
        focusMyWindowInstance.enable();
    }
}

export function disable() {
    if (focusMyWindowInstance) {
        focusMyWindowInstance.disable();
        focusMyWindowInstance = null;
    }
}
