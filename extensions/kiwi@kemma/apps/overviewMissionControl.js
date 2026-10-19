// SPDX-License-Identifier: GPL-3.0-or-later
// Mission Control overview: static sharp wallpaper, no zoom-out,
// hidden panel and dock. Windows float above like macOS.
//
// The stock overview hides the real desktop background and shows a
// per-workspace wallpaper copy that shrinks with the workspace card.
// Here a static fullscreen copy sits at the bottom of overviewGroup
// while those scaling copies (and the panel + dock) stay hidden.

import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

const GROUP_NAME = 'kiwi-mc-wallpaper';

let _enabled = false;
let _settings = null;
let _group = null;
let _managers = [];
let _showingId = 0;
let _shownId = 0;
let _hiddenId = 0;
let _groupSignals = [];
let _globalSignals = [];

function _disconnect(list) {
    for (const [obj, id] of list) {
        try {
            obj.disconnect(id);
        } catch (_) {
            // actor already gone
        }
    }
    list.length = 0;
}

function _walkCopies(root, out) {
    let kids = [];
    try {
        kids = root.get_children();
    } catch (_) {
        return;
    }
    for (const child of kids) {
        try {
            if (typeof child.has_style_class_name === 'function' &&
                child.has_style_class_name('workspace-background'))
                out.push(child);
        } catch (_) {
            // gone mid-walk
        }
        _walkCopies(child, out);
    }
}

function _setCopiesVisible(visible) {
    const found = [];
    try {
        _walkCopies(Main.layoutManager.overviewGroup, found);
    } catch (_) {
        // overview not built
    }
    for (const actor of found) {
        try {
            actor.visible = visible;
        } catch (_) {
            // destroyed with its workspace
        }
    }
}

// WindowPreview icons: hide icon actors directly (CSS opacity is
// unreliable here); titles are already killed via transparent color.
function _setPreviewChromeHidden() {
    const previews = [];
    const walk = root => {
        let kids = [];
        try {
            kids = root.get_children();
        } catch (_) {
            return;
        }
        for (const child of kids) {
            try {
                if (child.metaWindow !== undefined && child._icon)
                    previews.push(child);
            } catch (_) {
                // plain actor
            }
            walk(child);
        }
    };
    try {
        walk(Main.layoutManager.overviewGroup);
    } catch (_) {
        return;
    }
    for (const preview of previews) {
        try {
            preview._icon.visible = false;
        } catch (_) {
            // gone
        }
    }
}

function _setChromeVisible(visible) {
    // macOS Mission Control: no top bar. The dock stays visible.
    try {
        if (visible)
            Main.panel.show();
        else
            Main.panel.hide();
    } catch (_) {
        // no panel in this session mode
    }
}

function _teardownBg() {
    _disconnect(_groupSignals);
    _managers.forEach(manager => {
        try {
            manager.destroy();
        } catch (_) {
            // already gone
        }
    });
    _managers = [];

    if (_group) {
        try {
            _group.get_parent()?.remove_child(_group);
            _group.destroy_all_children();
            _group.destroy();
        } catch (_) {
            // already gone
        }
        _group = null;
    }
}

function _build() {
    _teardownBg();

    _group = new Meta.BackgroundGroup({name: GROUP_NAME});

    Main.layoutManager.monitors.forEach((monitor, index) => {
        const holder = new St.Widget({
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        _managers.push(new Background.BackgroundManager({
            container: holder,
            monitorIndex: index,
            controlPosition: false,
        }));
        _group.add_child(holder);
    });

    const overviewGroup = Main.layoutManager.overviewGroup;
    overviewGroup.insert_child_at_index(_group, 0);

    // Anything the shell adds later must stay above our wallpaper.
    _groupSignals.push([overviewGroup, overviewGroup.connect('child-added', (group, child) => {
        if (child !== _group) {
            try {
                group.set_child_below_sibling(_group, null);
            } catch (_) {
                // tearing down
            }
        }
    })]);
}


function _onShowing() {
    if (!_enabled)
        return;
    if (!_group)
        _build();
    _setCopiesVisible(false);
    _setChromeVisible(false);
    _setPreviewChromeHidden();
}

function _onShown() {
    if (!_enabled)
        return;
    _setCopiesVisible(false);
    _setPreviewChromeHidden();
}

function _onHidden() {
    _setCopiesVisible(true);
    _setChromeVisible(true);
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('mission-control'))
        return;
    _enabled = true;

    _showingId = Main.overview.connect('showing', _onShowing);
    _shownId = Main.overview.connect('shown', _onShown);
    _hiddenId = Main.overview.connect('hidden', _onHidden);
    _globalSignals.push([Main.layoutManager,
        Main.layoutManager.connect('monitors-changed', () => {
            if (_enabled)
                _build();
        })]);

    if (Main.overview.visible)
        _onShowing();
}

export function disable() {
    _enabled = false;
    for (const id of [_showingId, _shownId, _hiddenId]) {
        if (id) {
            try {
                Main.overview.disconnect(id);
            } catch (_) {
                // already gone
            }
        }
    }
    _showingId = _shownId = _hiddenId = 0;
    _disconnect(_globalSignals);
    _setCopiesVisible(true);
    _setChromeVisible(true);
    _teardownBg();
    _settings = null;
}
