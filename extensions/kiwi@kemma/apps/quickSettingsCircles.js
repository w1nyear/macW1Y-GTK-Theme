// SPDX-License-Identifier: GPL-3.0-or-later
// Hides the round system toggles at the top of Quick Settings
// (wifi, bluetooth and friends). Sliders, battery and system rows stay.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let _enabled = false;
let _settings = null;
let _openStateId = 0;
const _hidden = new Set();

function _grid() {
    try {
        const qs = Main.panel?.statusArea?.quickSettings;
        return qs?.menu?._grid ?? null;
    } catch (_) {
        return null;
    }
}

function _forgetDead() {
    for (const actor of _hidden) {
        let alive = true;
        try {
            void actor.get_parent();
        } catch (_) {
            alive = false;
        }
        if (!alive)
            _hidden.delete(actor);
    }
}

function _isToggle(actor, depth = 0) {
    try {
        if (typeof actor.has_style_class_name === 'function' &&
            (actor.has_style_class_name('quick-toggle') ||
             actor.has_style_class_name('quick-toggle-has-menu')))
            return true;
        if (depth >= 2)
            return false;
        for (const child of actor.get_children?.() ?? []) {
            if (_isToggle(child, depth + 1))
                return true;
        }
    } catch (_) {
        // gone mid-walk
    }
    return false;
}

function _isSlider(actor, depth = 0) {
    try {
        if (typeof actor.has_style_class_name === 'function' &&
            actor.has_style_class_name('quick-slider'))
            return true;
        if (depth >= 2)
            return false;
        for (const child of actor.get_children?.() ?? []) {
            if (_isSlider(child, depth + 1))
                return true;
        }
    } catch (_) {
        // gone mid-walk
    }
    return false;
}

function _apply() {
    const grid = _grid();
    if (!grid)
        return;
    _forgetDead();
    // Only toggles above the first slider: battery/system rows below stay.
    let pastSliders = false;
    for (const child of grid.get_children()) {
        try {
            if (_isSlider(child)) {
                pastSliders = true;
                continue;
            }
            if (pastSliders || !_isToggle(child))
                continue;
            if (_enabled) {
                if (child.visible)
                    _hidden.add(child);
                child.visible = false;
            }
        } catch (_) {
            // gone mid-walk
        }
    }
}

function _restore() {
    for (const actor of _hidden) {
        try {
            actor.visible = true;
        } catch (_) {
            // destroyed
        }
    }
    _hidden.clear();
}

function _onOpenState(_menu, isOpen) {
    if (isOpen && _enabled)
        _apply();
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('hide-qs-circles'))
        return;
    _enabled = true;

    try {
        const menu = Main.panel?.statusArea?.quickSettings?.menu;
        if (menu)
            _openStateId = menu.connect('open-state-changed', _onOpenState);
    } catch (_) {
        _openStateId = 0;
    }
    _apply();
}

export function disable() {
    _enabled = false;
    if (_openStateId) {
        try {
            Main.panel?.statusArea?.quickSettings?.menu?.disconnect(_openStateId);
        } catch (_) {
            // already gone
        }
        _openStateId = 0;
    }
    _restore();
    _settings = null;
}
