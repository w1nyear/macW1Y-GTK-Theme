// SPDX-License-Identifier: GPL-3.0-or-later


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let _activitiesButton = null;

export function enable() {

    _activitiesButton = Main.panel.statusArea['activities'] || Main.panel._leftBox?.get_children()?.find(c => c?.constructor?.name?.toLowerCase().includes('activities'));
    if (_activitiesButton && _activitiesButton.visible) {
        _activitiesButton.hide();
    }
}

export function disable() {
    if (_activitiesButton && !_activitiesButton.visible) {
        _activitiesButton.show();
    }
    _activitiesButton = null;
}
