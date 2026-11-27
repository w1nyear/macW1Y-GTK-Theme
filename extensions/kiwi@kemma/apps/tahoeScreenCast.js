// SPDX-License-Identifier: GPL-3.0-or-later





import Atk from 'gi://Atk';
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { getTopbarInk, watchInk } from './tahoeInk.js';
import { t } from './mac_i18n.js';



const MacScreenCastIcon = GObject.registerClass({
    GTypeName: `MacScreenCastIcon_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
}, class MacScreenCastIcon extends St.DrawingArea {
    _init() {
        super._init({
            reactive: false,
            can_focus: false,
            width: 24,
            height: 24,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_size(24, 24);
        this._isHovered = false;
        this.connect('repaint', () => this._paint());
    }

    vfunc_get_preferred_width(_forHeight) {
        return [24, 24];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [24, 24];
    }

    setHovered(hovered) {
        if (this._isHovered !== hovered) {
            this._isHovered = hovered;
            this.queue_repaint();
        }
    }

    _rr(cr, x, y, w, h, r) {
        cr.newSubPath();
        cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
        cr.closePath();
    }

    _paint() {
        const cr = this.get_context();
        try {
            const [sw, sh] = this.get_surface_size();
            if (sw <= 0 || sh <= 0) return;
            const w = this.width || sw, h = this.height || sh;
            const k = sw / (w || 1);
            cr.save();
            cr.scale(k, k);

            const cx = w / 2;
            const cy = h / 2;
            const R = 8.0;
            const sq = 6.6;
            const sqR = 1.3;

            cr.setFillRule(Cairo.FillRule?.EVEN_ODD ?? 1);

            cr.arc(cx, cy, R, 0, 2 * Math.PI);
            cr.closePath();

            const x = cx - sq / 2;
            const y = cy - sq / 2;
            this._rr(cr, x, y, sq, sq, sqR);


            let isDarkTopbar = true;
            try {
                isDarkTopbar = (typeof getTopbarInk === 'function' ? getTopbarInk() : 'dark') !== 'dark';
            } catch (_) {}

            if (isDarkTopbar) {
                cr.setSourceRGBA(1.0, 1.0, 1.0, this._isHovered ? 1.0 : 0.95);
            } else {
                cr.setSourceRGBA(0.12, 0.12, 0.14, this._isHovered ? 1.0 : 0.90);
            }
            cr.fill();

            cr.restore();
        } finally {
            try { cr.$dispose(); } catch (_) {}
        }
    }
});

const MacScreenCastButton = GObject.registerClass({
    GTypeName: `MacScreenCastButton_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
}, class MacScreenCastButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'macScreenCast', false);
        this.add_style_class_name('mac-screencast-button');
        this.accessible_name = t('screencast_title', 'Запис екрана / Трансляція');
        this.accessible_role = Atk.Role.MENU;

        this._icon = new MacScreenCastIcon();
        this.add_child(this._icon);

        this.connect('notify::hover', () => {
            this._icon.setHovered(this.hover);
        });

        this._handles = new Set();
        this._isRecording = false;
        this._isSharing = false;
        this._secondsPassed = 0;
        this._timerId = 0;

        this.visible = false;

        this._buildMenu();
    }

    _createInfoRow(label, value) {
        const box = new St.BoxLayout({
            style_class: 'mac-screencast-info-row',
            x_expand: true,
        });
        const l = new St.Label({
            style_class: 'mac-screencast-info-label',
            text: label,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        const v = new St.Label({
            style_class: 'mac-screencast-info-val',
            text: value,
            x_align: Clutter.ActorAlign.END,
        });
        box.add_child(l);
        box.add_child(v);
        return {box, l, v};
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('mac-screencast-menu');
        this._stopMenuItem = new PopupMenu.PopupMenuItem(t('stop', 'Stop'));
        this._stopMenuItem.connect('activate', () => {
            this.menu.close();
            this.stopAll();
        });
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open && this._stopMenuItem?.label) {
                this._stopMenuItem.label.text = t('stop', 'Stop');
            }
        });
        this.menu.addMenuItem(this._stopMenuItem);
    }

    _openVideosFolder() {
        try {
            let path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS);
            if (!path)
                path = GLib.get_home_dir() + '/Videos';
            const f = Gio.File.new_for_path(path);
            Gio.AppInfo.launch_default_for_uri(f.get_uri(), null);
        } catch (e) {
            console.warn(`[macScreenCast] open videos folder error: ${e}`);
        }
    }

    stopAll() {
        let didStop = false;
        try {
            if (Main.screenshotUI?.screencast_in_progress) {
                Main.screenshotUI.stopScreencast();
                didStop = true;
            }
        } catch (e) {
            console.warn(`[macScreenCast] stopScreencast error: ${e}`);
        }
        for (const h of this._handles) {
            try {
                h.stop();
                didStop = true;
            } catch (_) {}
        }
        this._handles.clear();
        this._sync();
        return didStop;
    }

    _updateTimer() {
        const s = this._secondsPassed;
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        let timeStr = '';
        if (hrs > 0) {
            timeStr = `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
        } else {
            timeStr = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
        if (this._timerLabel)
            this._timerLabel.text = timeStr;
    }

    _ensurePosition() {
        try {
            const rightBox = Main.panel?._rightBox;
            if (!rightBox) return;

            const actor = this.container || this;
            const parent = actor.get_parent();
            if (parent !== rightBox) {
                if (parent) parent.remove_child(actor);
                rightBox.insert_child_at_index(actor, 0);
            } else {
                const kids = rightBox.get_children();
                if (kids[0] !== actor) {
                    rightBox.set_child_at_index(actor, 0);
                }
            }
        } catch (_) {}
    }

    _sync() {
        const isRec = !!Main.screenshotUI?.screencast_in_progress;
        const isShare = this._handles.size > 0;
        this._isRecording = isRec;
        this._isSharing = isShare;
        const active = isRec || isShare;

        if (active) {
            if (!this.visible) {
                this._secondsPassed = 0;
            }
            this.visible = true;
            if (this.container) {
                this.container.style = null;
                this.container.set_width(-1);
                this.container.visible = true;
                this.container.show();
            }
            this._icon?.queue_repaint?.();
            this._ensurePosition();
            try { Main.panel?._rightBox?.queue_relayout?.(); } catch (_) {}
        } else {
            this.visible = false;
            if (this.container) {
                this.container.visible = false;
                this.container.hide();
            }
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
            this._secondsPassed = 0;
            if (this.menu?.isOpen)
                this.menu.close();
        }
    }

    showTest(active = true, _mode = 'recording') {
        if (active) {
            this._isRecording = true;
            this.visible = true;
            if (this.container) {
                this.container.style = null;
                this.container.set_width(-1);
                this.container.visible = true;
                this.container.show();
            }
            this._icon?.queue_repaint?.();
            this._ensurePosition();
            try { Main.panel?._rightBox?.queue_relayout?.(); } catch (_) {}
        } else {
            this.visible = false;
            if (this.container) {
                this.container.visible = false;
                this.container.hide();
            }
            if (this.menu?.isOpen)
                this.menu.close();
        }
    }
});

let _indicator = null;
let _controller = null;
let _controllerSignalId = 0;
let _screenshotSignalId = 0;
let _origRecShow = null;
let _origShareShow = null;
let _inkUnwatch = null;

export function getIndicator() {
    return _indicator;
}

export function enable(_settings = null, _gettext = null) {
    if (_indicator) return;

    try {
        _indicator = new MacScreenCastButton();
        Main.panel.addToStatusArea('macScreenCast', _indicator, 0, 'right');
        _indicator._ensurePosition();
    } catch (e) {
        console.warn(`[macScreenCast] addToStatusArea error: ${e}`);
        return;
    }


    try {
        if (Main.panel.statusArea.screenRecording) {
            const c = Main.panel.statusArea.screenRecording.container;
            c.visible = false;
            c.opacity = 0;
            _origRecShow = c.show;
            c.show = function() { this.visible = false; this.opacity = 0; };
        }
    } catch (_) {}
    try {
        if (Main.panel.statusArea.screenSharing) {
            const c = Main.panel.statusArea.screenSharing.container;
            c.visible = false;
            c.opacity = 0;
            _origShareShow = c.show;
            c.show = function() { this.visible = false; this.opacity = 0; };
        }
    } catch (_) {}


    try {
        if (Main.screenshotUI) {
            _screenshotSignalId = Main.screenshotUI.connect(
                'notify::screencast-in-progress',
                () => _indicator?._sync()
            );
        }
    } catch (_) {}


    try {
        _controller = global.backend?.get_remote_access_controller?.();
        if (_controller) {
            _controllerSignalId = _controller.connect('new-handle', (o, handle) => {
                if (!handle) return;
                _indicator?._handles?.add(handle);
                handle.connect('stopped', () => {
                    _indicator?._handles?.delete(handle);
                    _indicator?._sync();
                });
                _indicator?._sync();
            });
        }
    } catch (_) {}


    try {
        _inkUnwatch = watchInk(() => {
            _indicator?._icon?.queue_repaint();
        });
    } catch (_) {}


    _indicator._sync();
}

export function disable() {
    if (_screenshotSignalId && Main.screenshotUI) {
        try {
            Main.screenshotUI.disconnect(_screenshotSignalId);
        } catch (_) {}
        _screenshotSignalId = 0;
    }

    if (_controllerSignalId && _controller) {
        try {
            _controller.disconnect(_controllerSignalId);
        } catch (_) {}
        _controllerSignalId = 0;
    }
    _controller = null;

    if (_inkUnwatch) {
        try { _inkUnwatch(); } catch (_) {}
        _inkUnwatch = null;
    }


    try {
        if (_origRecShow && Main.panel.statusArea.screenRecording?.container) {
            Main.panel.statusArea.screenRecording.container.show = _origRecShow;
            _origRecShow = null;
        }
    } catch (_) {}
    try {
        if (_origShareShow && Main.panel.statusArea.screenSharing?.container) {
            Main.panel.statusArea.screenSharing.container.show = _origShareShow;
            _origShareShow = null;
        }
    } catch (_) {}

    if (_indicator) {
        try {
            _indicator.destroy();
        } catch (_) {}
        _indicator = null;
    }
}
