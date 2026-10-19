// SPDX-License-Identifier: GPL-3.0-or-later
// macOS Tahoe-style top bar gradient: a semi-transparent dark veil over the
// panel that fades out toward its bottom edge. Same no-layout pattern as the
// panel blur (Meta.BackgroundGroup + sized St.Widgets), so panel layout is
// never disturbed. Toggle: 'panel-gradient' gsettings key.

import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let gradientGroup = null;
let gradientWidget = null;
let gradientWidgetTop = null;
let sizeSignals = [];
let settingsObj = null;
let settingsSignal = 0;

function _syncSize() {
    const panel = Main.panel;
    if (!gradientWidget || !panel)
        return;
    gradientWidget.set_position(panel.x, panel.y);
    gradientWidget.set_size(panel.width, panel.height);
    // Upper veil: top 55% of the bar, adds extra darkness at the very top
    // so the falloff reads as a smooth progressive fade, not a flat bar.
    if (gradientWidgetTop) {
        gradientWidgetTop.set_position(panel.x, panel.y);
        gradientWidgetTop.set_size(panel.width, Math.round(panel.height * 0.55));
    }
}

function _apply() {
    if (!gradientGroup)
        return;
    let on = true;
    try {
        on = settingsObj.get_boolean('panel-gradient');
    } catch (_) {
        // settings gone: keep visible
    }
    gradientGroup.visible = on;
}

export function enable(settings) {
    if (gradientGroup) {
        settingsObj = settings ?? settingsObj;
        _apply();
        return;
    }
    if (!settings)
        return;
    settingsObj = settings;

    const panel = Main.panel;
    const panelBox = panel?.get_parent();
    if (!panel || !panelBox)
        return;

    // BackgroundGroup keeps the widgets out of panelBox layout.
    gradientGroup = new Meta.BackgroundGroup({
        name: 'kiwi-panel-gradient-group',
        width: 0,
        height: 0,
    });
    gradientWidget = new St.Widget({
        name: 'kiwi-panel-gradient',
        style_class: 'kiwi-panel-gradient',
        reactive: false,
        track_hover: false,
    });
    gradientWidgetTop = new St.Widget({
        name: 'kiwi-panel-gradient-top',
        style_class: 'kiwi-panel-gradient-top',
        reactive: false,
        track_hover: false,
    });
    gradientGroup.insert_child_at_index(gradientWidgetTop, 0);
    gradientGroup.insert_child_at_index(gradientWidget, 0);
    panelBox.insert_child_at_index(gradientGroup, 0);

    sizeSignals = [
        {actor: panel, id: panel.connect('notify::position', _syncSize)},
        {actor: panel, id: panel.connect('notify::size', _syncSize)},
        {actor: panelBox, id: panelBox.connect('notify::size', _syncSize)},
        {actor: panelBox, id: panelBox.connect('notify::position', _syncSize)},
    ];
    settingsSignal = settings.connect('changed::panel-gradient', _apply);

    _syncSize();
    _apply();
}

export function disable() {
    if (settingsSignal && settingsObj) {
        try {
            settingsObj.disconnect(settingsSignal);
        } catch (_) {
            // already gone
        }
        settingsSignal = 0;
    }
    settingsObj = null;

    for (const {actor, id} of sizeSignals) {
        try {
            actor.disconnect(id);
        } catch (_) {
            // already gone
        }
    }
    sizeSignals = [];

    if (gradientGroup) {
        const panelBox = Main.panel?.get_parent();
        if (panelBox) {
            try {
                panelBox.remove_child(gradientGroup);
            } catch (_) {
                // already removed
            }
        }
        try {
            gradientGroup.destroy_all_children();
        } catch (_) {
            // ignore
        }
        try {
            gradientGroup.destroy();
        } catch (_) {
            // ignore
        }
        gradientGroup = null;
    }
    gradientWidget = null;
    gradientWidgetTop = null;
}
