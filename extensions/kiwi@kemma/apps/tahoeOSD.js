// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe volume/brightness OSD (macOS Tahoe / Sequoia style):
// A dark glass pill under the Control Center button with title, icons,
// and a sleek segmented bar with subtle dots.
// Intercepts Main.osdWindowManager to completely suppress stock OSD.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_makeGlassStack, isPanelOpen} from './tahoeControlCenter.js';
import {isNCOpen as isNCPanelOpen} from './tahoeNotifications.js';

// Liquid-glass helpers live in another extension. Static
// `import ... from 'file://' + ...` is a SyntaxError (module specifiers must
// be string literals), so load them dynamically at runtime.
let ensureGlassAllocated = () => {};
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist/utils.js').then(m => {
    if (m.ensureGlassAllocated)
        ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
}).catch(e => console.warn(`[tahoe-osd] liquid-glass utils unavailable: ${e}`));

const OSD_W = 300;
const HIDE_MS = 1800;
const OSD_PAD = 20;
const OSD_RADIUS = 22;

// Segmented bar (Tahoe OSD): solid fill + a dots row beneath. Dots at/left
// of the value are bold and opaque, the rest small and faint.
const TahoeSegSlider = GObject.registerClass({
    GTypeName: `TahoeSegSlider_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
}, class TahoeSegSlider extends St.DrawingArea {
    _init() {
        super._init({reactive: false, height: 28});
        this._v = 0;
        this.connect('repaint', () => {
            try {
                this._paint();
            } catch (_) {}
        });
    }

    setValue(v) {
        const nv = Math.max(0, Math.min(1, v));
        if (Math.abs(nv - this._v) < 0.0005)
            return;
        this._v = nv;
        try {
            this.queue_repaint();
        } catch (_) {}
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
            if (sw <= 0 || sh <= 0)
                return;
            const w = this.width || sw, h = this.height || sh;
            const k = sw / (w || 1);
            cr.save();
            cr.scale(k, k);
            const v = this._v;

            // solid background track
            const barY = Math.round(h * 0.28), barH = 5;
            cr.setSourceRGBA(1, 1, 1, 0.28);
            this._rr(cr, 0, barY, w, barH, barH / 2);
            cr.fill();

            // filled bar
            if (v > 0.001) {
                cr.setSourceRGBA(1, 1, 1, 1);
                this._rr(cr, 0, barY, Math.max(barH, Math.round(w * v)), barH, barH / 2);
                cr.fill();
            }

            // dots row beneath: 17 faint small dots
            const n = 17;
            const dy = h * 0.78;
            for (let i = 0; i < n; i++) {
                const x = (i + 0.5) * w / n;
                cr.setSourceRGBA(1, 1, 1, 0.35);
                cr.arc(x, dy, 1.5, 0, Math.PI * 2);
                cr.fill();
            }
            cr.restore();
        } finally {
            try {
                cr.$dispose();
            } catch (_) {}
        }
    }
});

let _box = null;
let _title = null;
let _iconL = null;
let _iconR = null;
let _slider = null;
let _hideId = 0;
let _glass = null;
let _control = null;
let _sinkIds = [];
let _sinkReady = false;
let _brightScale = null;
let _brightIds = [];
let _brightReady = false;
let _screenProxy = null;
let _origShowOsdWindow = null;

function _anchorX(monitor) {
    try {
        const btn = Main.panel?.statusArea?.['ydotool-trigger-button'] ||
                    Main.panel?.statusArea?.['quickSettings'];
        const actor = btn?.actor ?? btn;
        if (actor) {
            const [x] = actor.get_transformed_position();
            const w = actor.width || 0;
            if (x > 0 && w > 0)
                return Math.round(x + w / 2);
        }
    } catch (_) {}
    return Math.round(monitor.x + monitor.width - 170);
}

function _hideStockOsd() {
    try {
        const mgr = Main.osdWindowManager;
        if (mgr) {
            if (typeof mgr.hideAll === 'function')
                mgr.hideAll();
            for (const w of (mgr._osdWindows || [])) {
                try {
                    w.cancel?.();
                    w.hide?.();
                    w.opacity = 0;
                } catch (_) {}
            }
        }
    } catch (_) {}
}

function _interceptStockOsd() {
    const mgr = Main.osdWindowManager;
    if (!mgr || _origShowOsdWindow)
        return;

    _origShowOsdWindow = mgr._showOsdWindow;
    _hideStockOsd();

    for (const w of (mgr._osdWindows || [])) {
        if (w && !w._origShow) {
            w._origShow = w.show;
            w.show = function() {
                try {
                    this.opacity = 0;
                    this.hide();
                } catch (_) {}
            };
        }
    }

    mgr._showOsdWindow = function(monitorIndex, icon, label, level, maxLevel) {
        try {
            if (this._osdWindows && this._osdWindows[monitorIndex]) {
                const w = this._osdWindows[monitorIndex];
                w.cancel?.();
                w.hide?.();
                w.opacity = 0;
            }
        } catch (_) {}

        const handled = _handleOsdCall(monitorIndex, icon, label, level, maxLevel);
        if (!handled && _origShowOsdWindow) {
            return _origShowOsdWindow.call(this, monitorIndex, icon, label, level, maxLevel);
        }
    };
}

function _restoreStockOsd() {
    const mgr = Main.osdWindowManager;
    if (!mgr)
        return;
    if (_origShowOsdWindow) {
        mgr._showOsdWindow = _origShowOsdWindow;
        _origShowOsdWindow = null;
    }
    for (const w of (mgr._osdWindows || [])) {
        if (w && w._origShow) {
            w.show = w._origShow;
            delete w._origShow;
        }
    }
}

function _getAudioDeviceTitle() {
    try {
        if (_control && _control.get_state() === Gvc.MixerControlState.READY) {
            const sink = _control.get_default_sink();
            if (sink) {
                const desc = (sink.description ?? '').toString();
                if (/bluetooth|bluez|buds|airpods|headset|headphone/i.test(desc)) {
                    return desc || 'Навушники';
                }
                if (/speaker|cavs|internal|built-in|alc|analog/i.test(desc)) {
                    return 'Динаміки MacBook Air';
                }
                if (desc)
                    return desc;
            }
        }
    } catch (_) {}
    return 'Динаміки MacBook Air';
}

function _handleOsdCall(monitorIndex, icon, label, level, maxLevel) {
    let iconName = '';
    if (icon) {
        if (typeof icon.to_string === 'function')
            iconName = icon.to_string();
        if (!iconName && typeof icon.get_names === 'function') {
            const names = icon.get_names();
            if (names && names.length > 0)
                iconName = names[0];
        }
    }
    iconName = (iconName || '').toLowerCase();

    const isVolume = iconName.includes('audio') || iconName.includes('volume') ||
                     iconName.includes('speaker') || iconName.includes('headphone') ||
                     iconName.includes('sound');
    const isBrightness = iconName.includes('brightness') || iconName.includes('display');

    if (!isVolume && !isBrightness)
        return false;

    if (isBrightness) {
        let val = 0.5;
        if (level !== undefined && level !== null) {
            val = (maxLevel && maxLevel > 0) ? (level / maxLevel) : level;
        } else if (_brightScale?.value !== undefined) {
            val = _brightScale.value;
        }
        val = Math.max(0, Math.min(1, val));
        _show('brightness', 'Дисплей',
            'display-brightness-symbolic',
            'display-brightness-symbolic',
            val);
        return true;
    }

    if (isVolume) {
        let val = 0;
        let isMuted = iconName.includes('muted');
        if (level !== undefined && level !== null) {
            val = (maxLevel && maxLevel > 0) ? (level / maxLevel) : level;
            if (val <= 0)
                isMuted = true;
        } else if (_control && _control.get_state() === Gvc.MixerControlState.READY && _control.get_default_sink()) {
            const sink = _control.get_default_sink();
            const max = _control.get_vol_max_norm() || 65536;
            val = sink.volume / max;
            isMuted = !!sink.is_muted;
        }
        val = Math.max(0, Math.min(1, val));
        const title = _getAudioDeviceTitle();
        _show('volume', title,
            isMuted ? 'audio-volume-muted-symbolic' : 'audio-volume-low-symbolic',
            isMuted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic',
            isMuted ? 0 : val);
        return true;
    }

    return false;
}

function _osdSurf() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('color-scheme') === 'prefer-dark')
            return {c: [0.05, 0.05, 0.07], a: 0.10};
    } catch (_) {}
    return {c: [0.78, 0.78, 0.80], a: 0.10};
}

function _ensureGlass() {
    if (_glass)
        return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const s = _makeGlassStack(monitor, OSD_RADIUS, 'osd', false);
        Main.layoutManager.uiGroup.add_child(s.bgActor);
        try {
            s.bgActor.hide();
        } catch (_) {}
        try {
            Main.layoutManager.uiGroup.set_child_below_sibling(s.bgActor, _box);
        } catch (_) {}
        try {
            s.uiSampler.addExclusion(_box);
        } catch (_) {}
        s.wcm.rebuildClones();
        s.uiSampler.rebindSelf();
        s.uiSampler.refresh();
        _glass = s;
        return true;
    } catch (_) {
        _glass = null;
        return false;
    }
}

function _syncGlass() {
    const s = _glass;
    if (!s || !_box)
        return false;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const [bx, by] = _box.get_transformed_position();
        const bw = _box.width, bh = _box.height;
        if (!(bw > 0) || !(bh > 0) || !isFinite(bx) || !isFinite(by))
            return false;

        s.bgActor.set_position(monitor.x, monitor.y);
        if (!s.bgActor.visible)
            s.bgActor.show();
        s.bgActor.opacity = 255;
        const rx = (bx - monitor.x) - OSD_PAD;
        const ry = (by - monitor.y) - OSD_PAD;
        const surf = _osdSurf();

        s.effect.setGlassRegions([{
            x: rx, y: ry, w: bw + OSD_PAD * 2, h: bh + OSD_PAD * 2,
            tintR: surf.c[0], tintG: surf.c[1], tintB: surf.c[2],
            baseStrength: surf.a,
        }]);
        s.effect.setResolution(monitor.width, monitor.height);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        setClipIfChanged(s.bgActor, rx - 100, ry - 100,
            bw + OSD_PAD * 2 + 200, bh + OSD_PAD * 2 + 200);
        s.wcm.setOffset(-monitor.x, -monitor.y);
        syncGlassCaptureClip({
            cloneContainer: s.cloneContainer,
            effect: s.effect,
            originX: monitor.x,
            originY: monitor.y,
            uiSampler: s.uiSampler,
            windowCloneManager: s.wcm,
        });
        ensureGlassAllocated(s.bgActor);
        s.uiSampler.refresh();
        s.uiSampler.sync(monitor.x, monitor.y, monitor.width, monitor.height);
        s.wcm.sync();
        return true;
    } catch (_) {}
    return false;
}

function _destroyGlass() {
    const s = _glass;
    _glass = null;
    if (!s)
        return;
    try {
        s.effect?.cleanup?.();
    } catch (_) {}
    try {
        s.uiSampler?.destroy?.();
    } catch (_) {}
    try {
        s.wcm?.destroy?.();
    } catch (_) {}
    try {
        s.bgActor?.destroy?.();
    } catch (_) {}
}

function _hideNow() {
    _hideId = 0;
    if (!_box)
        return GLib.SOURCE_REMOVE;
    if (_glass) {
        try {
            _glass.bgActor.hide();
        } catch (_) {}
    }
    try {
        _box.ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    if (_box)
                        _box.hide();
                } catch (_) {}
            },
        });
    } catch (_) {
        try {
            _box.hide();
        } catch (_) {}
    }
    return GLib.SOURCE_REMOVE;
}

function _show(kind, title, iconL, iconR, value) {
    if (!_box)
        return;

    // Never over an open Control Center or Notification Center
    try {
        const ccOpen = !!globalThis._tahoeQSOpen || (typeof isPanelOpen === 'function' && isPanelOpen());
        const ncOpen = !!globalThis._tahoeNCOpen || (typeof isNCPanelOpen === 'function' && isNCPanelOpen());
        if (ccOpen || ncOpen) {
            if (_box.visible) {
                try {
                    _box.hide();
                } catch (_) {}
            }
            if (_glass) {
                try {
                    _glass.bgActor.hide();
                } catch (_) {}
            }
            return;
        }
    } catch (_) {}

    _hideStockOsd();

    try {
        _title.text = title;
        _iconL.icon_name = iconL;
        _iconR.icon_name = iconR;
        _slider.setValue(value);
    } catch (_) {}

    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const panelH = Math.round(Main.layoutManager.panelBox?.height ?? 34);
        const cx = Math.max(monitor.x + OSD_W / 2,
            Math.min(monitor.x + monitor.width - OSD_W / 2, _anchorX(monitor)));
        _box.set_position(Math.round(cx - OSD_W / 2), monitor.y + panelH + 8);

        const firstShow = !_box.visible;
        try {
            if (_ensureGlass())
                _syncGlass();
        } catch (_) {}

        if (firstShow) {
            _box.opacity = 0;
            _box.show();
            let tries = 0;
            const step = () => {
                let ok = false;
                try {
                    ok = _syncGlass();
                } catch (_) {}
                tries++;
                try {
                    if ((ok || tries > 20) && _box && _box.visible) {
                        _box.ease({
                            opacity: 255, duration: 150,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                        return GLib.SOURCE_REMOVE;
                    }
                } catch (_) {
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            };
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, step);
        } else {
            _box.remove_all_transitions();
            if (_box.opacity < 255) {
                try {
                    _box.ease({opacity: 255, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                } catch (_) {}
            }
            if (_glass?.bgActor && !_glass.bgActor.visible) {
                try {
                    _glass.bgActor.show();
                    _glass.bgActor.opacity = 255;
                } catch (_) {}
            }
            try {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    try {
                        _syncGlass();
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            } catch (_) {}
        }
    } catch (_) {}

    try {
        if (_hideId)
            GLib.Source.remove(_hideId);
    } catch (_) {}
    _hideId = 0;
    try {
        _hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_MS, _hideNow);
    } catch (_) {
        _hideId = 0;
    }
}

function _onVolume() {
    try {
        if (!_control || _control.get_state() !== Gvc.MixerControlState.READY)
            return;
        const sink = _control.get_default_sink();
        if (!sink)
            return;
        const max = _control.get_vol_max_norm() || 65536;
        const v = Math.max(0, Math.min(1, sink.volume / max));
        if (!_sinkReady) {
            _sinkReady = true;
            return;
        }
        const title = _getAudioDeviceTitle();
        const muted = !!sink.is_muted;
        _show('volume', title,
            muted ? 'audio-volume-muted-symbolic' : 'audio-volume-low-symbolic',
            muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic',
            muted ? 0 : v);
    } catch (_) {}
}

function _hookSink(sink) {
    for (const id of _sinkIds) {
        try {
            sink.disconnect(id);
        } catch (_) {}
    }
    _sinkIds = [];
    if (!sink)
        return;
    try {
        _sinkIds.push(sink.connect('notify::volume', _onVolume));
        _sinkIds.push(sink.connect('notify::mute', _onVolume));
    } catch (_) {}
}

function _onBrightness(v) {
    if (!_brightReady) {
        _brightReady = true;
        return;
    }
    try {
        _show('brightness', 'Дисплей',
            'display-brightness-symbolic',
            'display-brightness-symbolic', v);
    } catch (_) {}
}

export function enable() {
    disable();
    try {
        const oldBoxes = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.has_style_class_name && c.has_style_class_name('tahoe-osd')
        );
        for (const b of oldBoxes) {
            try { b.destroy(); } catch (_) {}
        }
    } catch (_) {}
    try {
        _box = new St.BoxLayout({
            style_class: 'tahoe-osd',
            vertical: true,
            visible: false,
            opacity: 0,
            reactive: false,
        });
        _box.set_width(OSD_W);

        const headRow = new St.BoxLayout({style_class: 'tahoe-osd-head'});
        _title = new St.Label({style_class: 'tahoe-osd-title', text: ''});
        try {
            _title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (_) {}
        headRow.add_child(_title);

        const barRow = new St.BoxLayout({style_class: 'tahoe-osd-bar'});
        _iconL = new St.Icon({
            style_class: 'tahoe-osd-endicon',
            icon_size: 15,
            y_align: Clutter.ActorAlign.CENTER,
        });
        _slider = new TahoeSegSlider();
        _slider.x_expand = true;
        _slider.y_align = Clutter.ActorAlign.CENTER;
        try {
            _slider.reactive = false;
            _slider.can_focus = false;
        } catch (_) {}
        _iconR = new St.Icon({
            style_class: 'tahoe-osd-endicon-big',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
        });
        barRow.add_child(_iconL);
        barRow.add_child(_slider);
        barRow.add_child(_iconR);

        _box.add_child(headRow);
        _box.add_child(barRow);
        Main.layoutManager.uiGroup.add_child(_box);
    } catch (_) {
        _box = null;
        return;
    }

    _interceptStockOsd();

    // volume backend
    try {
        _control = new Gvc.MixerControl({name: 'Tahoe OSD'});
        _control.open();
        const id = _control.connect('state-changed', () => {
            try {
                if (_control.get_state() !== Gvc.MixerControlState.READY)
                    return;
                _control.disconnect(id);
                _hookSink(_control.get_default_sink());
                _control.connect('default-sink-changed', () => {
                    try {
                        _hookSink(_control.get_default_sink());
                    } catch (_) {}
                    _onVolume();
                });
                _onVolume();
            } catch (_) {}
        });
    } catch (_) {
        _control = null;
    }

    // brightness backend 1: shell brightnessManager
    try {
        const bm = Main.brightnessManager;
        if (bm?.globalScale) {
            _brightScale = bm.globalScale;
            _brightIds.push(_brightScale.connect('notify::value', () => {
                try {
                    _onBrightness(_brightScale.value);
                } catch (_) {}
            }));
        }
    } catch (_) {}

    // brightness backend 2: gsd-power D-Bus fallback
    if (!_brightScale) {
        try {
            _screenProxy = Gio.DBusProxy.new_sync(
                Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
                'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power/Screen',
                'org.gnome.SettingsDaemon.Power.Screen', null);
            if (_screenProxy) {
                _brightIds.push(_screenProxy.connect('g-properties-changed', () => {
                    try {
                        const b = _screenProxy.get_cached_property('Brightness');
                        if (b !== null)
                            _onBrightness(b.unpack() / 100);
                    } catch (_) {}
                }));
            }
        } catch (_) {
            _screenProxy = null;
        }
    }
}

export function disable() {
    _restoreStockOsd();
    _destroyGlass();
    if (_hideId) {
        try {
            GLib.Source.remove(_hideId);
        } catch (_) {}
        _hideId = 0;
    }
    for (const id of _sinkIds) {
        try {
            _control?.get_default_sink()?.disconnect(id);
        } catch (_) {}
    }
    _sinkIds = [];
    for (const id of _brightIds) {
        try {
            _brightScale?.disconnect(id);
        } catch (_) {}
        try {
            _screenProxy?.disconnect(id);
        } catch (_) {}
    }
    _brightIds = [];
    _brightScale = null;
    _screenProxy = null;
    try {
        _control?.close?.();
    } catch (_) {}
    _control = null;
    _sinkReady = false;
    _brightReady = false;
    if (_box) {
        try {
            _box.destroy();
        } catch (_) {}
        _box = null;
    }
    _title = null;
    _iconL = null;
    _iconR = null;
    _slider = null;
}
