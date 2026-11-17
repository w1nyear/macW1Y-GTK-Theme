// SPDX-License-Identifier: GPL-3.0-or-later





import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { dashOf, dockContainers, isDock, prefersDark, syncDarken } from './dockUtils.js';

const STYLE_CLASS = 'kiwi-dock-styled';
const LABEL_CLASS = 'kiwi-dock-label';
const DARK_CLASS = 'dark';

let childAddedId = null;
let colorSchemeId = null;
let boxSignals = [];






function _dashLabels() {
    return Main.uiGroup.get_children().filter(child =>
        child.has_style_class_name?.('dash-label')
    );
}

function _syncLabel(label) {
    label.add_style_class_name(LABEL_CLASS);
    if (prefersDark())
        label.add_style_class_name(DARK_CLASS);
    else
        label.remove_style_class_name(DARK_CLASS);
}

function _syncAllLabels() {
    _dashLabels().forEach(_syncLabel);
}

function _wireItem(item) {
    const button = item.child;
    if (!(button instanceof St.Button) || button._kiwiPressId)
        return;
    button._kiwiPressId = button.connect('notify::pressed', () => syncDarken(button));
}

function _unwireItem(item) {
    const button = item.child;
    if (!button?._kiwiPressId)
        return;
    button.disconnect(button._kiwiPressId);
    button._kiwiPressId = 0;
    syncDarken(button, false);
}

function _applyDock(container) {
    container.add_style_class_name(STYLE_CLASS);

    const box = dashOf(container)?._box;
    if (!box)
        return;

    box.get_children().forEach(_wireItem);


    const entry = { box };
    entry.addedId = box.connect('child-added', (_box, item) => _wireItem(item));



    entry.destroyId = box.connect('destroy', () => {
        boxSignals = boxSignals.filter(other => other !== entry);
    });
    boxSignals.push(entry);
}

export function enable() {

    if (childAddedId)
        return;



    childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (isDock(actor))
            _applyDock(actor);
        else if (actor.has_style_class_name?.('dash-label'))
            _syncLabel(actor);
    });

    colorSchemeId = St.Settings.get().connect('notify::color-scheme', _syncAllLabels);

    dockContainers().forEach(_applyDock);
    _syncAllLabels();
}

export function disable() {
    if (childAddedId) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = null;
    }

    if (colorSchemeId) {
        St.Settings.get().disconnect(colorSchemeId);
        colorSchemeId = null;
    }

    for (const { box, addedId, destroyId } of boxSignals) {
        box.disconnect(addedId);
        box.disconnect(destroyId);
    }
    boxSignals = [];

    for (const label of _dashLabels()) {
        label.remove_style_class_name(LABEL_CLASS);
        label.remove_style_class_name(DARK_CLASS);
    }

    for (const container of dockContainers()) {
        container.remove_style_class_name(STYLE_CLASS);
        dashOf(container)?._box?.get_children().forEach(_unwireItem);
    }
}
