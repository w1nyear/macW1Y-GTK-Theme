// SPDX-License-Identifier: GPL-3.0-or-later





import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MARK = 'tahoe-polkit';

let _enabled = false;
let _settings = null;
let _actorAddedIds = [];
const _styled = new Set();

function _styleDialog(dialog) {
    if (!dialog || _styled.has(dialog))
        return;
    _styled.add(dialog);
    try {
        dialog.add_style_class_name(MARK);
    } catch (_) {
        return;
    }


    try {
        dialog._userAvatar?.hide();
    } catch (_) {

    }


    try {
        const header = new St.BoxLayout({
            style_class: 'tahoe-polkit-header',
            orientation: Clutter.Orientation.VERTICAL,
        });
        const icon = new St.Icon({
            style_class: 'tahoe-polkit-lock',
            icon_name: 'changes-prevent-symbolic',
        });
        header.add_child(icon);
        const content = dialog.contentLayout;
        if (content)
            content.insert_child_at_index(header, 0);
    } catch (_) {

    }


    try {
        if (dialog._okButton)
            dialog._okButton.label = 'Unlock';
    } catch (_) {

    }

    try {
        dialog.connect('destroy', () => _styled.delete(dialog));
    } catch (_) {

    }
}

function _onActorAdded(_group, actor) {
    try {
        if (actor?.has_style_class_name?.('prompt-dialog')) {
            console.log('[tahoe-polkit] styling prompt dialog');
            _styleDialog(actor);
        }
    } catch (_) {

    }
}

function _sweepExisting() {
    const walk = actor => {
        _onActorAdded(null, actor);
        try {
            (actor.get_children?.() ?? []).forEach(walk);
        } catch (_) {

        }
    };
    for (const group of [Main.layoutManager.modalDialogGroup,
                         Main.layoutManager.uiGroup]) {
        try {
            walk(group);
        } catch (_) {

        }
    }
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('polkit-dialog-macw1y'))
        return;
    _enabled = true;
    console.log('[tahoe-polkit] enabled');


    for (const group of [Main.layoutManager.modalDialogGroup,
                         Main.layoutManager.uiGroup]) {
        try {
            _actorAddedIds.push([group, group.connect(
                'actor-added', _onActorAdded)]);
        } catch (_) {

        }
    }
    _sweepExisting();
}

export function disable() {
    _enabled = false;
    for (const [group, id] of _actorAddedIds) {
        try {
            group.disconnect(id);
        } catch (_) {

        }
    }
    _actorAddedIds = [];
    for (const dialog of _styled) {
        try {
            dialog.remove_style_class_name(MARK);
        } catch (_) {

        }
    }
    _styled.clear();
    _settings = null;
}
