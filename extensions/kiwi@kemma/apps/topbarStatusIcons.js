// SPDX-License-Identifier: GPL-3.0-or-later





import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import NM from 'gi://NM';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getTopbarInk, watchInk} from './tahoeInk.js';

const FOCUS_WHITE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/icons/tahoe-focus.svg';
const FOCUS_BLACK = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/icons/tahoe-focus-black.svg';
const AIR_DIR = GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/icons/';
const AIR_WHITE = 'file://' + AIR_DIR + 'tahoe-airplane.svg';
const AIR_BLACK = 'file://' + AIR_DIR + 'tahoe-airplane-black.svg';

let _focusBin = null;
let _focusIcon = null;
let _airBin = null;
let _airIcon = null;
let _inkUnwatch = null;
let _notifSettings = null;
let _notifId = 0;
let _nm = null;
const _nmIds = [];
let _bt = null;
const _btIds = [];

function _makeBin(child) {
    const bin = new St.Bin({
        style_class: 'kiwi-topbar-statusicon',
        reactive: false,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    try {
        child.reactive = false;
        child.x_align = Clutter.ActorAlign.CENTER;
        child.y_align = Clutter.ActorAlign.CENTER;
    } catch (_) {

    }
    bin.set_child(child);
    return bin;
}




function _place(bin, anchorRole, side) {
    try {
        const rightBox = Main.panel?._rightBox;
        if (!rightBox || bin.get_parent() === rightBox)
            return;
        const anchor = Main.panel?.statusArea?.[anchorRole];
        const kids = rightBox.get_children();
        let idx = -1;
        if (anchor) {
            const actor = anchor instanceof Clutter.Actor ? anchor : anchor?.actor;
            if (actor)
                idx = kids.indexOf(actor);
        }
        if (idx < 0) {
            rightBox.insert_child_at_index(bin, 0);
            return;
        }
        rightBox.insert_child_at_index(bin, side === 'right' ? idx : idx + 1);
    } catch (_) {

    }
}



function _syncIconTheme() {
    try {
        const dark = getTopbarInk() !== 'dark';
        if (_airIcon)
            _airIcon.gicon = Gio.icon_new_for_string(dark ? AIR_WHITE : AIR_BLACK);
        if (_focusIcon)
            _focusIcon.gicon = Gio.icon_new_for_string(dark ? FOCUS_WHITE : FOCUS_BLACK);
    } catch (_) {

    }
}

function _syncFocus() {
    try {
        if (_focusBin && _notifSettings)
            _focusBin.visible = !_notifSettings.get_boolean('show-banners');
    } catch (_) {

    }
}


function _syncAir() {
    try {
        if (!_airBin)
            return;

        let wifiOff = false;
        try {
            wifiOff = _nm ? !_nm.wireless_enabled : false;
        } catch (_) {
            wifiOff = false;
        }
        let btOff = false;
        try {
            btOff = _bt ? !_bt.default_adapter_powered : false;
        } catch (_) {
            btOff = false;
        }
        _airBin.visible = wifiOff && (_bt ? btOff : true);
    } catch (_) {

    }
}

export function enable() {
    if (!_focusBin) {
        try {
            _focusIcon = new St.Icon({icon_size: 16, reactive: false});
            _focusBin = _makeBin(_focusIcon);
            _syncIconTheme();
        } catch (_) {
            _focusBin = null;
            _focusIcon = null;
        }
    }
    if (!_airBin) {
        try {
            _airIcon = new St.Icon({icon_size: 16, reactive: false});
            _airBin = _makeBin(_airIcon);
            _syncIconTheme();
        } catch (_) {
            _airBin = null;
            _airIcon = null;
        }
    }
    if (_focusBin)
        _place(_focusBin, 'ydotool-trigger-button');
    if (_airBin)
        _place(_airBin, 'kiwi-wifi-button');

    if (!_notifSettings) {
        try {
            _notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            _notifId = _notifSettings.connect('changed::show-banners', _syncFocus);
        } catch (_) {
            _notifSettings = null;
            _notifId = 0;
        }
    }
    if (!_inkUnwatch) {
        try {
            _inkUnwatch = watchInk(() => _syncIconTheme());
            _syncIconTheme();
        } catch (_) {
            _inkUnwatch = null;
        }
    }
    if (!_nm) {
        try {
            NM.Client.new_async(null, (o, res) => {
                try {
                    const client = NM.Client.new_finish(res);
                    _nm = client;
                    try {
                        _nmIds.push(client.connect('notify::wireless-enabled', _syncAir));
                        _nmIds.push(client.connect('notify::primary-connection', _syncAir));
                    } catch (_) {

                    }
                    _syncAir();
                } catch (_) {

                }
            });
        } catch (_) {

        }
    }
    if (!_bt) {
        try {
            _bt = new GnomeBluetooth.Client();
            try {
                _btIds.push(_bt.connect('notify::default-adapter-powered', _syncAir));
                _btIds.push(_bt.connect('notify::default-adapter', _syncAir));
            } catch (_) {

            }
        } catch (_) {
            _bt = null;
        }
    }
}

export function disable() {
    if (_notifSettings && _notifId) {
        try {
            _notifSettings.disconnect(_notifId);
        } catch (_) {

        }
    }
    _notifSettings = null;
    _notifId = 0;
    if (_inkUnwatch) {
        try {
            _inkUnwatch();
        } catch (_) {

        }
    }
    _inkUnwatch = null;
    _airIcon = null;
    _focusIcon = null;
    if (_nm) {
        for (const id of _nmIds) {
            try {
                _nm.disconnect(id);
            } catch (_) {

            }
        }
        _nmIds.length = 0;
    }
    _nm = null;
    if (_bt) {
        for (const id of _btIds) {
            try {
                _bt.disconnect(id);
            } catch (_) {

            }
        }
        _btIds.length = 0;
    }
    _bt = null;
    for (const b of [_focusBin, _airBin]) {
        if (b) {
            try {
                b.destroy();
            } catch (_) {

            }
        }
    }
    _focusBin = null;
    _airBin = null;
}
