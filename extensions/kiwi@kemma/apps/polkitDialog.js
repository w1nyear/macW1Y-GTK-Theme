// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style authentication dialogs (polkit): centered card, lock icon,
// round password field, gray Cancel + blue Unlock. Purely visual: the
// stock session/PAM flow is untouched, so every consumer (Settings unlock,
// Software, system dialogs) keeps working.

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

    // macOS shows a lock instead of the user avatar.
    try {
        dialog._userAvatar?.hide();
    } catch (_) {
        // older layout
    }

    // App icon header: lock + action title, like Privacy & Security.
    try {
        const header = new St.BoxLayout({
            style_class: 'tahoe-polkit-header',
            vertical: true,
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
        // keep the stock header
    }

    // Unlock reads better than Authenticate on every flow.
    try {
        if (dialog._okButton)
            dialog._okButton.label = 'Unlock';
    } catch (_) {
        // keep stock label
    }

    try {
        dialog.connect('destroy', () => _styled.delete(dialog));
    } catch (_) {
        // gone
    }
}

function _onActorAdded(_group, actor) {
    try {
        if (actor?.has_style_class_name?.('prompt-dialog')) {
            console.log('[tahoe-polkit] styling prompt dialog');
            _styleDialog(actor);
        }
    } catch (_) {
        // not a dialog
    }
}

function _sweepExisting() {
    const walk = actor => {
        _onActorAdded(null, actor);
        try {
            (actor.get_children?.() ?? []).forEach(walk);
        } catch (_) {
            // gone mid-walk
        }
    };
    for (const group of [Main.layoutManager.modalDialogGroup,
                         Main.layoutManager.uiGroup]) {
        try {
            walk(group);
        } catch (_) {
            // no group yet
        }
    }
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('polkit-dialog-macos'))
        return;
    _enabled = true;
    console.log('[tahoe-polkit] enabled');

    // Modal dialogs live in modalDialogGroup, not directly in uiGroup.
    for (const group of [Main.layoutManager.modalDialogGroup,
                         Main.layoutManager.uiGroup]) {
        try {
            _actorAddedIds.push([group, group.connect(
                'actor-added', _onActorAdded)]);
        } catch (_) {
            // group gone
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
            // already gone
        }
    }
    _actorAddedIds = [];
    for (const dialog of _styled) {
        try {
            dialog.remove_style_class_name(MARK);
        } catch (_) {
            // destroyed
        }
    }
    _styled.clear();
    _settings = null;
}
