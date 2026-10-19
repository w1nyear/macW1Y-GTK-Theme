// SPDX-License-Identifier: GPL-3.0-or-later
// Quick settings keep every feature; their button in the top bar is gone
// entirely (no icons, no box, no click area). The stock open path
// (panel.toggleQuickSettings) refuses unmapped/unreactive indicators, so
// it cannot be used with a hidden button - instead the shortcut calls
// menu.open() DIRECTLY, which has no such checks. With Tahoe enabled
// that method is hooked to the control center (and toggles it, since
// _openPanel closes an open panel); with Tahoe off it opens the stock
// popup. Either way the menu stays reachable with no topbar button.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SHORTCUT = 'quick-settings-shortcut';
const HIDE_KEY = 'hide-quick-settings-button';

let extension = null;
let bound = false;
let _watchId = 0;

function _openQs() {
    try {
        Main.panel.statusArea.quickSettings?.menu?.open?.();
    } catch (_) {
        // no menu here
    }
}

function _apply() {
    try {
        const settings = extension?.getSettings();
        const qs = Main.panel.statusArea.quickSettings;
        if (!settings || !qs)
            return;
        // full hide: no icons, no box, no click area
        qs.visible = !settings.get_boolean(HIDE_KEY);
    } catch (_) {
        // panel gone
    }
}

export function enable(ext) {
    if (ext)
        extension = ext;
    const settings = extension?.getSettings();
    if (!settings)
        return;

    _apply();
    if (!_watchId) {
        try {
            _watchId = settings.connect(`changed::${HIDE_KEY}`, _apply);
        } catch (_) {
            _watchId = 0;
        }
    }

    if (!bound) {
        Main.wm.addKeybinding(
            SHORTCUT, settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            _openQs);
        bound = true;
    }
}

export function disable() {
    if (bound) {
        Main.wm.removeKeybinding(SHORTCUT);
        bound = false;
    }
    if (_watchId) {
        try {
            extension?.getSettings()?.disconnect(_watchId);
        } catch (_) {
            // gone
        }
        _watchId = 0;
    }
    try {
        const qs = Main.panel.statusArea.quickSettings;
        if (qs)
            qs.visible = true;
    } catch (_) {
        // panel gone
    }
    extension = null;
}
