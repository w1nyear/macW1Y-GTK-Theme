// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style top bar buttons: Battery (percentage + icon, opens
// Settings -> Power) and Search (opens Spotlight, falls back to overview).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Cairo from 'cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {getTopbarInk, watchInk} from './tahoeInk.js';

let _batteryButton = null;
let _batteryBox = null;
let _batteryLabel = null;
let _batteryDrawingArea = null;
let _batteryProxy = null;
let _batteryChangedId = 0;
let _clickId = 0;
let _searchButton = null;
let _interfaceSettings = null;
let _interfaceChangedId = 0;
let _currentBatteryPercentage = 100;
let _currentBatteryState = 2; // discharging
let _inkUnwatch = null;

function _onBatteryRepaint(area) {
    if (!area)
        return;
    const cr = area.get_context();
    const [sw, sh] = area.get_surface_size();
    const aw = area.width || 27;
    const ah = area.height || 16;

    cr.save();
    cr.scale(sw / aw, sh / ah);
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);

    const percentage = _currentBatteryPercentage;
    const state = _currentBatteryState;
    const charging = (state === 1 || state === 5);
    const pct = Math.max(0, Math.min(1.0, percentage / 100.0));

    let isDarkInk = false;
    try {
        if (typeof getTopbarInk === 'function')
            isDarkInk = (getTopbarInk() === 'dark');
    } catch (_) {}

    const bw = 22.0;
    const bh = 11.5;
    const br = 3.6;
    const bx = 1.0;
    const by = (ah - bh) / 2.0;

    const gap = 1.2;
    const nw = 1.6;
    const nh = 4.8;
    const nr = 0.8;
    const nx = bx + bw + gap;
    const ny = by + (bh - nh) / 2.0;

    function roundedRect(x, y, w, h, r) {
        cr.newSubPath();
        cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
        cr.closePath();
    }

    // 1. Base uncharged capsule
    roundedRect(bx, by, bw, bh, br);
    if (isDarkInk) {
        cr.setSourceRGBA(0.0, 0.0, 0.0, 0.28);
    } else {
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.40);
    }
    cr.fill();

    // 2. Terminal nipple
    cr.newSubPath();
    cr.arc(nx + nw - nr, ny + nr, nr, -Math.PI / 2, 0);
    cr.arc(nx + nw - nr, ny + nh - nr, nr, 0, Math.PI / 2);
    cr.lineTo(nx, ny + nh);
    cr.lineTo(nx, ny);
    cr.closePath();
    if (isDarkInk) {
        cr.setSourceRGBA(0.0, 0.0, 0.0, 0.28);
    } else {
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.40);
    }
    cr.fill();

    // 3. Charged level fill
    if (pct > 0.005) {
        cr.save();
        roundedRect(bx, by, bw, bh, br);
        cr.clip();

        const fillW = bw * pct;
        cr.rectangle(bx, by, fillW, bh);

        if (pct <= 0.10 && !charging) {
            cr.setSourceRGBA(255 / 255, 59 / 255, 48 / 255, 1.0);
        } else if (pct <= 0.20 && !charging) {
            cr.setSourceRGBA(255 / 255, 204 / 255, 0 / 255, 1.0);
        } else if (isDarkInk) {
            cr.setSourceRGBA(0.0, 0.0, 0.0, 1.0);
        } else {
            cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        }
        cr.fill();

        // 4. Lightning bolt if charging
        if (charging) {
            const cx = bx + bw / 2.0;
            const cy = by + bh / 2.0;
            cr.newPath();
            cr.moveTo(cx + 0.5, cy - 4.2);
            cr.lineTo(cx - 2.0, cy + 0.4);
            cr.lineTo(cx - 0.2, cy + 0.4);
            cr.lineTo(cx - 0.7, cy + 4.2);
            cr.lineTo(cx + 2.0, cy - 0.4);
            cr.lineTo(cx + 0.2, cy - 0.4);
            cr.closePath();

            if (pct >= 0.5) {
                cr.setOperator(Cairo.Operator.CLEAR);
                cr.fill();
            } else {
                if (isDarkInk) {
                    cr.setSourceRGBA(0.0, 0.0, 0.0, 1.0);
                } else {
                    cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
                }
                cr.fill();
            }
        }

        cr.restore();
    }

    cr.restore();
    cr.$dispose();
}

function _syncBatteryPercentageVisibility() {
    if (!_batteryLabel && _batteryButton) {
        try {
            const box = _batteryButton.get_child_at_index(0);
            _batteryLabel = box?.get_children?.()?.find(c => c instanceof St.Label) || null;
        } catch (_) {}
    }
    if (!_batteryLabel && Main.panel.statusArea['kiwi-wifi-button']) {
        try {
            const box = Main.panel.statusArea['kiwi-wifi-button'].get_child_at_index(0);
            _batteryLabel = box?.get_children?.()?.find(c => c instanceof St.Label) || null;
        } catch (_) {}
    }
    if (!_batteryLabel)
        return;
    let showPercentage = false;
    try {
        if (!_interfaceSettings)
            _interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        showPercentage = _interfaceSettings.get_boolean('show-battery-percentage');
    } catch (_) {
        showPercentage = false;
    }
    _batteryLabel.visible = showPercentage;
}

function _openPowerSettings() {
    // GNOME Settings -> Power panel (macOS: clicking battery opens settings)
    try {
        GLib.spawn_command_line_async('gnome-control-center power');
        return;
    } catch (_) {
        // fall through
    }
    try {
        Gio.AppInfo.launch_default_for_uri('settings://power', null);
    } catch (_) {
        // no settings app
    }
}

function _iconForLevel(percentage, state) {
    // UPower states: 1 = charging, 2 = discharging, 4 = fully charged,
    // 5 = pending charge. Everything else treats as on-battery.
    const charging = state === 1 || state === 5;
    const full = state === 4 || percentage >= 99.5;
    if (full)
        return charging ? 'battery-level-100-charged-symbolic' : 'battery-level-100-charged-symbolic';
    let level = Math.round(percentage / 10) * 10;
    level = Math.max(0, Math.min(90, level));
    if (charging)
        return `battery-level-${level}-charging-symbolic`;
    return `battery-level-${level}-symbolic`;
}

function _updateBattery() {
    try {
        if (!_batteryProxy || !_batteryLabel || !_batteryDrawingArea)
            return;
        _syncBatteryPercentageVisibility();
        const pctProp = _batteryProxy.get_cached_property('Percentage');
        const stateProp = _batteryProxy.get_cached_property('State');
        if (!pctProp || !stateProp)
            return;
        const percentage = pctProp.unpack();
        const state = stateProp.unpack();
        _currentBatteryPercentage = percentage;
        _currentBatteryState = state;
        // macOS shows "87 %" style: rounded number + icon
        _batteryLabel.text = `${Math.round(percentage)}%`;
        _batteryDrawingArea.queue_repaint();
    } catch (_) {
        // keep last value
    }
}

function _initBatteryProxy() {
    try {
        const upower = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_interface_name: 'org.freedesktop.UPower',
            g_object_path: '/org/freedesktop/UPower',
            g_name: 'org.freedesktop.UPower',
            g_flags: Gio.DBusProxyFlags.NONE,
        });
        upower.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
            let batteryPath = null;
            try {
                proxy.init_finish(res);
                let devices = [];
                try {
                    const variant = proxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null);
                    if (variant)
                        devices = variant.deep_unpack ? variant.deep_unpack()[0] : [];
                } catch (_) {
                    devices = [];
                }
                if (Array.isArray(devices) && devices.length)
                    batteryPath = devices.find(p => /battery_BAT\d+/i.test(p) || /battery/i.test(p)) || null;
            } catch (_) {
                batteryPath = null;
            }
            if (!batteryPath)
                batteryPath = '/org/freedesktop/UPower/devices/battery_BAT0';

            const makeDevice = path => {
                try {
                    const dev = new Gio.DBusProxy({
                        g_connection: Gio.DBus.system,
                        g_interface_name: 'org.freedesktop.UPower.Device',
                        g_object_path: path,
                        g_name: 'org.freedesktop.UPower',
                        g_flags: Gio.DBusProxyFlags.NONE,
                    });
                    dev.init_async(GLib.PRIORITY_DEFAULT, null, (dp, dr) => {
                        try {
                            dp.init_finish(dr);
                            _batteryProxy = dp;
                            _updateBattery();
                            try {
                                if (_batteryChangedId && _batteryProxy)
                                    _batteryProxy.disconnect(_batteryChangedId);
                            } catch (_) { /* stale */ }
                            _batteryChangedId = 0;
                            try {
                                _batteryChangedId = _batteryProxy.connect('g-properties-changed', _updateBattery);
                            } catch (_) {
                                _batteryChangedId = 0;
                            }
                        } catch (_) {
                            // BAT0 missing (desktop?) - try BAT1 once
                            if (path.endsWith('BAT0'))
                                makeDevice('/org/freedesktop/UPower/devices/battery_BAT1');
                        }
                    });
                } catch (_) {
                    // no battery
                }
            };
            makeDevice(batteryPath);
        });
    } catch (_) {
        // UPower unavailable
    }
}

function _toggleSpotlight() {
    try {
        if (typeof globalThis._macSpotlightToggle === 'function') {
            globalThis._macSpotlightToggle();
            return;
        }
        if (typeof globalThis.toggleMacSpotlight === 'function') {
            globalThis.toggleMacSpotlight();
            return;
        }
    } catch (_) {
        // fall through to the overview
    }
    try {
        Main.overview.toggle();
    } catch (_) {
        // ignore
    }
}

export function enable() {
    if (!_batteryButton && !Main.panel.statusArea['kiwi-wifi-button']) {
        _batteryButton = new PanelMenu.Button(0.0, 'Battery', true);
        _batteryBox = new St.BoxLayout({
            style_class: 'kiwi-battery-box',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        _batteryLabel = new St.Label({
            style_class: 'kiwi-battery-label',
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
        });
        _batteryDrawingArea = new St.DrawingArea({
            width: 27,
            height: 16,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'kiwi-battery-icon',
        });
        _batteryDrawingArea.connect('repaint', () => _onBatteryRepaint(_batteryDrawingArea));
        _batteryBox.add_child(_batteryLabel);
        _batteryBox.add_child(_batteryDrawingArea);
        _batteryButton.add_child(_batteryBox);
        _clickId = _batteryButton.connect('button-press-event', () => {
            _openPowerSettings();
            return Clutter.EVENT_STOP;
        });
        // NOTE: role id stays 'kiwi-wifi-button' - topbarStatusIcons.js anchors
        // the airplane indicator to it, so renaming would orphan that icon.
        Main.panel.addToStatusArea('kiwi-wifi-button', _batteryButton, 0, 'right');
        if (!_interfaceSettings) {
            try {
                _interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            } catch (_) {}
        }
        if (_interfaceSettings && !_interfaceChangedId) {
            _interfaceChangedId = _interfaceSettings.connect('changed::show-battery-percentage', () => {
                _syncBatteryPercentageVisibility();
            });
        }
        if (!_inkUnwatch) {
            try {
                _inkUnwatch = watchInk(() => {
                    _batteryDrawingArea?.queue_repaint();
                });
            } catch (_) {
                _inkUnwatch = null;
            }
        }
        _syncBatteryPercentageVisibility();
        _initBatteryProxy();
        _updateBattery();
    } else if (!_batteryButton && Main.panel.statusArea['kiwi-wifi-button']) {
        _batteryButton = Main.panel.statusArea['kiwi-wifi-button'];
        try {
            _batteryBox = _batteryButton.get_child_at_index(0);
            const children = _batteryBox?.get_children?.() || [];
            _batteryLabel = children.find(c => c instanceof St.Label) || null;
            const oldIcon = children.find(c => c instanceof St.Icon);
            if (oldIcon) {
                try { _batteryBox.remove_child(oldIcon); oldIcon.destroy(); } catch (_) {}
            }
            _batteryDrawingArea = children.find(c => c instanceof St.DrawingArea) || null;
            if (!_batteryDrawingArea) {
                _batteryDrawingArea = new St.DrawingArea({
                    width: 27,
                    height: 16,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'kiwi-battery-icon',
                });
                _batteryDrawingArea.connect('repaint', () => _onBatteryRepaint(_batteryDrawingArea));
                _batteryBox.add_child(_batteryDrawingArea);
            }
        } catch (_) {}
        if (!_interfaceSettings) {
            try {
                _interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            } catch (_) {}
        }
        if (_interfaceSettings && !_interfaceChangedId) {
            _interfaceChangedId = _interfaceSettings.connect('changed::show-battery-percentage', () => {
                _syncBatteryPercentageVisibility();
            });
        }
        if (!_inkUnwatch) {
            try {
                _inkUnwatch = watchInk(() => {
                    _batteryDrawingArea?.queue_repaint();
                });
            } catch (_) {
                _inkUnwatch = null;
            }
        }
        _syncBatteryPercentageVisibility();
        _initBatteryProxy();
        _updateBattery();
    }

    // Spotlight button removed per user request. Destroy if still in statusArea.
    if (Main.panel.statusArea['kiwi-search-button']) {
        try {
            Main.panel.statusArea['kiwi-search-button'].destroy();
        } catch (_) {}
    }
    _searchButton = null;
}

export function disable() {
    if (_inkUnwatch) {
        try { _inkUnwatch(); } catch (_) {}
        _inkUnwatch = null;
    }
    if (_interfaceChangedId && _interfaceSettings) {
        try {
            _interfaceSettings.disconnect(_interfaceChangedId);
        } catch (_) {}
        _interfaceChangedId = 0;
    }
    _interfaceSettings = null;

    if (_batteryChangedId && _batteryProxy) {
        try {
            _batteryProxy.disconnect(_batteryChangedId);
        } catch (_) {
            // gone
        }
    }
    _batteryChangedId = 0;
    _batteryProxy = null;
    if (_batteryButton) {
        try {
            if (_clickId)
                _batteryButton.disconnect(_clickId);
        } catch (_) {
            // gone
        }
        _clickId = 0;
        try {
            _batteryButton.destroy();
        } catch (_) {
            // already gone
        }
        _batteryButton = null;
    }
    _batteryBox = null;
    _batteryLabel = null;
    if (_batteryDrawingArea) {
        try { _batteryDrawingArea.destroy(); } catch (_) {}
        _batteryDrawingArea = null;
    }
    if (_searchButton) {
        try {
            _searchButton.destroy();
        } catch (_) {
            // already gone
        }
        _searchButton = null;
    }
    if (Main.panel.statusArea['kiwi-search-button']) {
        try {
            Main.panel.statusArea['kiwi-search-button'].destroy();
        } catch (_) {}
    }
}
