// SPDX-License-Identifier: GPL-3.0-or-later
// macOS Tahoe Screen Recording & Screen Sharing Menubar Indicator
// Displays a macOS-style circular disc with a centered square cutout on the menubar
// to the left of system icons whenever screen recording or screen sharing is active.
// Clicking opens a Liquid Glass popup menu with live timer, status details, and stop button.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { getTopbarInk, watchInk } from './tahoeInk.js';

// Cairo-rendered macOS recording indicator icon:
// A solid circular disc with a centered rounded square cutout.
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
            const R = 8.5;     // outer circle radius (17px diameter)
            const sq = 7.0;    // inner square cutout size
            const sqR = 1.2;   // corner radius of inner square

            cr.set_fill_rule(imports.gi.cairo.FillRule.EVEN_ODD);

            // 1. Outer circle
            cr.arc(cx, cy, R, 0, 2 * Math.PI);

            // 2. Inner rounded square cutout
            const x = cx - sq / 2;
            const y = cy - sq / 2;
            this._rr(cr, x, y, sq, sq, sqR);

            // Adaptive color matching menubar ink (pure white on dark glass, near-black on light)
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
        this.accessible_name = 'Запис екрана / Трансляція';
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

        // Section 1: Header (Title + Live Timer with recording dot)
        const headItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'mac-screencast-header-item',
        });
        const headBox = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-screencast-header',
            x_expand: true,
        });

        const topRow = new St.BoxLayout({
            style_class: 'mac-screencast-title-row',
            x_expand: true,
        });

        // Pulsing red indicator dot in header
        const hDot = new St.Icon({
            icon_name: 'media-record-symbolic',
            icon_size: 15,
            style_class: 'mac-screencast-red-dot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(hDot);

        this._titleLabel = new St.Label({
            style_class: 'mac-screencast-head-title',
            text: 'Запис екрана',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(this._titleLabel);

        this._timerLabel = new St.Label({
            style_class: 'mac-screencast-head-timer',
            text: '00:00',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(this._timerLabel);
        headBox.add_child(topRow);

        headItem.add_child(headBox);
        this.menu.addMenuItem(headItem);

        // Section 2: Info Card (Details)
        const cardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'mac-screencast-card-item',
        });
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'mac-screencast-card',
            x_expand: true,
        });

        // Row: Source
        this._srcRow = this._createInfoRow('Джерело:', 'Весь екран');
        card.add_child(this._srcRow.box);

        // Row: Resolution
        const mon = Main.layoutManager.primaryMonitor;
        const resText = mon ? `${mon.width} × ${mon.height}` : '1920 × 1080';
        this._resRow = this._createInfoRow('Роздільність:', resText);
        card.add_child(this._resRow.box);

        // Row: Destination / Type
        this._destRow = this._createInfoRow('Збереження:', 'Папка «Відео»');
        card.add_child(this._destRow.box);

        cardItem.add_child(card);
        this.menu.addMenuItem(cardItem);

        // Section 3: Prominent Red Stop Button
        const stopItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
            style_class: 'mac-screencast-stop-menu-item',
        });
        const stopBtn = new St.Button({
            style_class: 'mac-screencast-stop-btn',
            x_expand: true,
            can_focus: true,
            reactive: true,
        });
        const stopRow = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-screencast-stop-row',
        });
        const stopIcon = new St.Icon({
            icon_name: 'media-playback-stop-symbolic',
            icon_size: 14,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._stopLabel = new St.Label({
            text: 'Зупинити запис',
            y_align: Clutter.ActorAlign.CENTER,
        });
        stopRow.add_child(stopIcon);
        stopRow.add_child(this._stopLabel);
        stopBtn.set_child(stopRow);

        const onStopTrigger = () => {
            this.menu.close();
            this.stopAll();
        };
        stopBtn.connect('clicked', onStopTrigger);
        stopItem.connect('activate', onStopTrigger);
        stopItem.add_child(stopBtn);
        this.menu.addMenuItem(stopItem);

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Section 4: Secondary actions
        this._openFolderItem = new PopupMenu.PopupMenuItem('Відкрити папку із записами');
        this._openFolderItem.connect('activate', () => {
            this._openVideosFolder();
        });
        this.menu.addMenuItem(this._openFolderItem);

        const ssItem = new PopupMenu.PopupMenuItem('Зробити знімок екрана…');
        ssItem.connect('activate', () => {
            try {
                Main.screenshotUI?.open();
            } catch (_) {}
        });
        this.menu.addMenuItem(ssItem);

        const dispItem = new PopupMenu.PopupMenuItem('Параметри дисплея…');
        dispItem.connect('activate', () => {
            try {
                Gio.AppInfo.create_from_commandline('gnome-control-center display', null, 0).launch([], null);
            } catch (_) {}
        });
        this.menu.addMenuItem(dispItem);
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
            }

            const kids = rightBox.get_children();
            // Find target system icon: keyboard, kiwi-wifi-button, ydotool-trigger-button
            const targetRoles = ['keyboard', 'kiwi-wifi-button', 'ydotool-trigger-button'];
            let targetIdx = -1;
            for (const role of targetRoles) {
                const btn = Main.panel.statusArea?.[role];
                const a = btn instanceof Clutter.Actor ? btn : btn?.container || btn?.actor;
                if (a) {
                    const idx = kids.indexOf(a);
                    if (idx >= 0 && (targetIdx === -1 || idx < targetIdx)) {
                        targetIdx = idx;
                    }
                }
            }
            if (targetIdx >= 0) {
                const curIdx = kids.indexOf(actor);
                if (curIdx !== targetIdx) {
                    rightBox.set_child_at_index(actor, targetIdx);
                }
            } else {
                rightBox.set_child_at_index(actor, 0);
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
            if (isRec && isShare) {
                this._titleLabel.text = 'Запис та трансляція';
                this._stopLabel.text = 'Зупинити все';
                this._destRow.l.text = 'Статус:';
                this._destRow.v.text = 'Запис + PipeWire трансляція';
                this._openFolderItem.visible = true;
            } else if (isRec) {
                this._titleLabel.text = 'Запис екрана';
                this._stopLabel.text = 'Зупинити запис';
                this._destRow.l.text = 'Збереження:';
                this._destRow.v.text = 'Папка «Відео»';
                this._openFolderItem.visible = true;
            } else {
                this._titleLabel.text = 'Трансляція екрана';
                this._stopLabel.text = 'Зупинити трансляцію';
                this._destRow.l.text = 'Сесія:';
                this._destRow.v.text = 'PipeWire ScreenCast';
                this._openFolderItem.visible = false;
            }

            if (!this.visible) {
                this._secondsPassed = 0;
                this._updateTimer();
                this.visible = true;
            }

            if (!this._timerId) {
                this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    this._secondsPassed++;
                    this._updateTimer();
                    return GLib.SOURCE_CONTINUE;
                });
            }

            this._ensurePosition();
        } else {
            this.visible = false;
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
            this._secondsPassed = 0;
            if (this.menu?.isOpen)
                this.menu.close();
        }
    }

    showTest(active = true, mode = 'recording') {
        if (active) {
            this._isRecording = (mode === 'recording');
            this._isSharing = (mode === 'sharing');
            this._titleLabel.text = mode === 'recording' ? 'Запис екрана' : 'Трансляція екрана';
            this._stopLabel.text = mode === 'recording' ? 'Зупинити запис' : 'Зупинити трансляцію';
            this.visible = true;
            this._ensurePosition();
            if (!this._timerId) {
                this._secondsPassed = 14;
                this._updateTimer();
                this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    this._secondsPassed++;
                    this._updateTimer();
                    return GLib.SOURCE_CONTINUE;
                });
            }
        } else {
            this.visible = false;
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
            this._secondsPassed = 0;
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

    // Suppress stock GNOME Shell indicators so they don't duplicate or show the stock GNOME UI
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

    // Hook Screenshot UI screencast
    try {
        if (Main.screenshotUI) {
            _screenshotSignalId = Main.screenshotUI.connect(
                'notify::screencast-in-progress',
                () => _indicator?._sync()
            );
        }
    } catch (_) {}

    // Hook Remote Access Controller (PipeWire screen sharing / portals)
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

    // Hook adaptive ink to repaint icon on topbar theme/wallpaper change
    try {
        _inkUnwatch = watchInk(() => {
            _indicator?._icon?.queue_repaint();
        });
    } catch (_) {}

    // Initial sync
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

    // Restore stock indicators
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
