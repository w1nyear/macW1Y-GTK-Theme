// SPDX-License-Identifier: GPL-3.0-or-later


import {MozillaThemeManager} from './mozillaThemeManager.js';

let _manager = null;

export function enable(ext) {
    if (!_manager) {
        _manager = new MozillaThemeManager(ext, {
            settingsKey: 'enable-thunderbird-styling',
            profileBaseDir: '.thunderbird',
            cssPrefix: 'thunderbirdWindowControls',
            logPrefix: 'ThunderbirdTheme',
        });
        _manager.enable();
    }
}

export function disable() {
    if (_manager) {
        _manager.disable();
        _manager = null;
    }
}
