// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe volume/brightness OSD (macOS Sonoma style): icon + glass pill with slider under it.
// Listens to PulseAudio sink volume and screen brightness; suppresses stock OSD via hideAll().
// If Control Center is open, only updates the slider there (no icon/menu animation).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_makeGlassStack, isPanelOpen, getQSPanelBox} from './tahoeControlCenter.js';
import {isNCOpen as isNCPanelOpen} from './tahoeNotifications.js';

// Liquid-glass helpers from liquid-glass extension
let ensureGlassAllocated = () => {};
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist/utils.js').then(m => {
    if (m.ensureGlassAllocated) ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.setClipIfChanged) setClipIfChanged = m.setClipIfChanged;
    if (m.syncGlassCaptureClip) syncGlassCaptureClip = m.syncGlassCaptureClip;
}).catch(e => console.warn(`[tahoe-osd] liquid-glass utils unavailable: ${e}`));

const OSD_W = 280;
const HIDE_MS = 1800;
const OSD_PAD = 20;
const OSD_RADIUS = 22;
const ICON_SIZE = 48;
const FADE_DURATION = 150;

// Custom slider: 3-segment bar (Tahoe style) + over-amplification marker at 66%
const TahoeSegSlider = GObject.registerClass(
class TahoeSegSlider extends St.DrawingArea {
    _init() {
        super._init({reactive: false, height: 36});
        this._v = 0;
        this.connect('repaint', () => {
            try { this._paint(); } catch (_) {}
        });
    }

    setValue(v) {
        const nv = Math.max(0, Math.min(1.5, v)); // allow up to 150%
        if (Math.abs(nv - this._v) < 0.0005) return;
        this._v = nv;
        try { this.queue_repaint(); } catch (_) {}
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
            const v = this._v;
            const barY = Math.round(h * 0.35), barH = 6;
            const segmentW = (w - 12) / 3; // 3 segments with small gaps

            // Background track
            cr.setSourceRGBA(1, 1, 1, 0.22);
            this._rr(cr, 6, barY, w - 12, barH, barH / 2);
            cr.fill();

            // Filled segments
            const filledSegments = Math.min(3, Math.floor(v * 3 + 0.001));
            for (let i = 0; i < filledSegments; i++) {
                const segX = 6 + i * (segmentW + 4);
                cr.setSourceRGBA(1, 1, 1, 1);
                this._rr(cr, segX, barY, segmentW, barH, barH / 2);
                cr.fill();
            }

            // Partial fill of the next segment (smooth)
            const partial = v * 3 - filledSegments;
            if (partial > 0.001 && filledSegments < 3) {
                const segX = 6 + filledSegments * (segmentW + 4);
                cr.setSourceRGBA(1, 1, 1, 1);
                this._rr(cr, segX, barY, Math.max(barH, Math.round(segmentW * partial)), barH, barH / 2);
                cr.fill();
            }

            // Over-amplification marker at 66% (2/3 position)
            if (v > 1.0) {
                const markerX = 6 + (w - 12) * (2/3);
                cr.setSourceRGBA(1, 0.8, 0.2, 1); // amber warning
                cr.setLineWidth(2.5);
                cr.moveTo(markerX, barY - 4);
                cr.lineTo(markerX, barY + barH + 4);
                cr.stroke();
                // Small triangle on top
                cr.moveTo(markerX, barY - 6);
                cr.lineTo(markerX - 4, barY - 10);
                cr.lineTo(markerX + 4, barY - 10);
                cr.closePath();
                cr.fill();
            }

            cr.restore();
        } finally {
            try { cr.$dispose(); } catch (_) {}
        }
    }
});

let _box = null;
let _icon = null;
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
let _currentKind = null; // 'volume' | 'brightness'

// Surface fill for glass (matches QS pills)
function _osdSurf() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('color-scheme') === 'prefer-dark')
            return {c: [0.05, 0.05, 0.07], a: 0.10};
    } catch (_) {}
    return {c: [0.78, 0.78, 0.80], a: 0.10};
}

// Glass stack for the pill (same as QS)
function _ensureGlass() {
    if (_glass) return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return false;
        const s = _makeGlassStack(monitor, OSD_RADIUS, 'osd', false);
        Main.layoutManager.uiGroup.add_child(s.bgActor);
        try { s.bgActor.hide(); } catch (_) {}
        try { Main.layoutManager.uiGroup.set_child_below_sibling(s.bgActor, _box); } catch (_) {}

        // never clone the pill into its own blur
        try { s.uiSampler.addExclusion(_box); } catch (_) {}
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
    if (!s || !_box) return false;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return false;
        const [bx, by] = _box.get_transformed_position();
        const bw = _box.width, bh = _box.height;
        if (!(bw > 0) || !(bh > 0) || !isFinite(bx) || !isFinite(by)) return false;
        s.bgActor.set_position(monitor.x, monitor.y);
        if (!s.bgActor.visible) s.bgActor.show();
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
        setClipIfChanged(s.bgActor, rx - 100, ry - 100, bw + OSD_PAD * 2 + 200, bh + OSD_PAD * 2 + 200);
        s.wcm.setOffset(-monitor.x, -monitor.y);
        syncGlassCaptureClip({
            cloneContainer: s.cloneContainer, effect: s.effect,
            originX: monitor.x, originY: monitor.y,
            uiSampler: s.uiSampler, windowCloneManager: s.wcm,
        });
        ensureGlassAllocated(s.bgActor);
        s.uiSampler.refresh();
        s.uiSampler.sync(monitor.x, monitor.y, monitor.width, monitor.height);
        s.wcm.sync();
        return true;
    } catch (_) { return false; }
}

function _destroyGlass() {
    const s = _glass; _glass = null;
    if (!s) return;
    try { s.effect?.cleanup?.(); } catch (_) {}
    try { s.uiSampler?.destroy?.(); } catch (_) {}
    try { s.wcm?.destroy?.(); } catch (_) {}
    try { s.bgActor?.destroy?.(); } catch (_) {}
}

function _hideNow() {
    _hideId = 0;
    if (!_box) return GLib.SOURCE_REMOVE;
    if (_glass) {
        try { _glass.bgActor.hide(); } catch (_) {}
    }
    try {
        _box.ease({
            opacity: 0, duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => { try { if (_box) _box.hide(); } catch (_) {} }
        });
    } catch (_) { try { _box.hide(); } catch (_) {} }
    return GLib.SOURCE_REMOVE;
}

// Get the slider box from Control Center if open
function _getCCSlider(kind) {
    if (!isPanelOpen()) return null;
    try {
        const box = getQSPanelBox();
        if (!box) return null;
        // Find the slider in the CC panel by looking for the card with matching icons
        // We'll traverse the panel's children
        const findSlider = (actor) => {
            if (!actor) return null;
            if (actor._tahoeSlider && actor._tahoeKind === kind) return actor;
            for (const ch of actor.get_children()) {
                const found = findSlider(ch);
                if (found) return found;
            }
            return null;
        };
        return findSlider(box);
    } catch (_) { return null; }
}

// Update slider in Control Center if open
function _updateCCSlider(kind, value) {
    const slider = _getCCSlider(kind);
    if (slider && slider.setValue) {
        slider.setValue(value);
        return true;
    }
    return false;
}

// Main show function
function _show(kind, title, iconName, value) {
    if (!_box) return;

    // If Control Center is open, just update its slider and return
    if (isPanelOpen()) {
        _updateCCSlider(kind, value);
        return;
    }

    // Don't show if Notification Center is open
    try {
        if (isNCPanelOpen()) {
            if (_box.visible) { try { _box.hide(); } catch (_) {} }
            if (_glass) { try { _glass.bgActor.hide(); } catch (_) {} }
            return;
        }
    } catch (_) {}

    _hideStockOsd();
    _currentKind = kind;

    // Set icon
    try { _icon.icon_name = iconName; } catch (_) {}

    // Set slider value
    try { _slider.setValue(value); } catch (_) {}

    // Position: centered horizontally, below top bar
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const panelH = Math.round(Main.layoutManager.panelBox?.height ?? 34);
        const cx = monitor.x + monitor.width / 2;
        _box.set_position(Math.round(cx - OSD_W / 2), monitor.y + panelH + 8);

        const firstShow = !_box.visible;
        if (_ensureGlass()) _syncGlass();

        if (firstShow) {
            // Fade in icon + pill together
            _box.opacity = 0;
            _box.show();
            let tries = 0;
            const step = () => {
                let ok = false;
                try { ok = _syncGlass(); } catch (_) {}
                tries++;
                try {
                    if ((ok || tries > 20) && _box && _box.visible) {
                        _box.ease({
                            opacity: 255, duration: FADE_DURATION,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                        return GLib.SOURCE_REMOVE;
                    }
                } catch (_) { return GLib.SOURCE_REMOVE; }
                return GLib.SOURCE_CONTINUE;
            };
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, step);
        } else {
            if (_box.opacity < 255) {
                try {
                    _box.ease({opacity: 255, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                } catch (_) {}
            }
            try {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { try { _syncGlass(); } catch (_) {}; return GLib.SOURCE_REMOVE; });
            } catch (_) {}
        }
    } catch (_) {}

    // Auto-hide timer
    try { if (_hideId) GLib.Source.remove(_hideId); } catch (_) {}
    _hideId = 0;
    try { _hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_MS, _hideNow); } catch (_) {}
}

function _hideStockOsd() {
    try {
        const mgr = Main.osdWindowManager;
        if (mgr && typeof mgr.hideAll === 'function') mgr.hideAll();
    } catch (_) {}
}

function _isBtSink(sink) {
    try {
        const desc = (sink.description ?? '').toString();
        return /bluetooth|bluez|buds|airpods|headset|headphone/i.test(desc);
    } catch (_) { return false; }
}

function _onVolume() {
    try {
        if (!_control || _control.get_state() !== Gvc.MixerControlState.READY) return;
        const sink = _control.get_default_sink();
        if (!sink) return;
        const max = _control.get_vol_max_norm() || 65536;
        const v = Math.max(0, Math.min(1.5, sink.volume / max)); // allow 150%
        if (!_sinkReady) { _sinkReady = true; return; }
        let desc = '';
        try { desc = (sink.description ?? '').toString() || 'Звук'; } catch (_) { desc = 'Звук'; }
        const muted = !!sink.is_muted;
        _show('volume', desc,
            muted ? 'audio-volume-muted-symbolic'
                : (_isBtSink(sink) ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic'),
            muted ? 0 : v);
    } catch (_) {}
}

function _hookSink(sink) {
    for (const id of _sinkIds) { try { sink.disconnect(id); } catch (_) {} }
    _sinkIds = [];
    if (!sink) return;
    try {
        _sinkIds.push(sink.connect('notify::volume', _onVolume));
        _sinkIds.push(sink.connect('notify::mute', _onVolume));
    } catch (_) {}
}

function _onBrightness(v) {
    if (!_brightReady) { _brightReady = true; return; }
    try {
        const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
        _show('brightness', `Дисплей · ${pct}%`, 'display-brightness-symbolic', v);
    } catch (_) {}
}

export function enable() {
    if (_box) return;
    try {
        _box = new St.BoxLayout({
            style_class: 'tahoe-osd',
            vertical: true,
            visible: false,
            opacity: 0,
            reactive: false,
        });
        _box.set_width(OSD_W);

        // Icon row (centered)
        const iconRow = new St.BoxLayout({style_class: 'tahoe-osd-icon-row', x_align: Clutter.ActorAlign.CENTER});
        _icon = new St.Icon({style_class: 'tahoe-osd-icon', icon_size: ICON_SIZE});
        iconRow.add_child(_icon);

        // Slider pill (glass)
        const barRow = new St.BoxLayout({style_class: 'tahoe-osd-bar', x_align: Clutter.ActorAlign.CENTER});
        _slider = new TahoeSegSlider();
        _slider.x_expand = true;
        _slider.set_width(OSD_W - 32);
        barRow.add_child(new St.BoxLayout({width: 16})); // left padding
        barRow.add_child(_slider);
        barRow.add_child(new St.BoxLayout({width: 16})); // right padding

        _box.add_child(iconRow);
        _box.add_child(barRow);

        Main.layoutManager.uiGroup.add_child(_box);
    } catch (_) { _box = null; return; }

    // Volume backend
    try {
        _control = new Gvc.MixerControl({name: 'Tahoe OSD'});
        _control.open();
        const id = _control.connect('state-changed', () => {
            try {
                if (_control.get_state() !== Gvc.MixerControlState.READY) return;
                _control.disconnect(id);
                _hookSink(_control.get_default_sink());
                _control.connect('default-sink-changed', () => {
                    try { _hookSink(_control.get_default_sink()); } catch (_) {}
                    _onVolume();
                });
                _onVolume();
            } catch (_) {}
        });
    } catch (_) { _control = null; }

    // Brightness backend 1: shell brightnessManager
    try {
        const bm = Main.brightnessManager;
        if (bm?.globalScale) {
            _brightScale = bm.globalScale;
            _brightIds.push(_brightScale.connect('notify::value', () => {
                try { _onBrightness(_brightScale.value); } catch (_) {}
            }));
        }
    } catch (_) {}
    // Brightness backend 2: gsd-power D-Bus fallback
    if (!_brightScale) {
        try {
            _screenProxy = Gio.DBusProxy.new_sync(
                Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
                'org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power/Screen',
                'org.gnome.SettingsDaemon.Power.Screen', null);
            if (_screenProxy) {
                _brightIds.push(_screenProxy.connect('g-properties-changed', () => {
                    try {
                        const b = _screenProxy.get_cached_property('Brightness');
                        if (b !== null) _onBrightness(b.unpack() / 100);
                    } catch (_) {}
                }));
            }
        } catch (_) { _screenProxy = null; }
    }
}

export function disable() {
    _destroyGlass();
    if (_hideId) { try { GLib.Source.remove(_hideId); } catch (_) {}; _hideId = 0; }
    for (const id of _sinkIds) {
        try { _control?.get_default_sink()?.disconnect(id); } catch (_) {}
    }
    _sinkIds = [];
    for (const id of _brightIds) {
        try { _brightScale?.disconnect(id); } catch (_) {}
        try { _screenProxy?.disconnect(id); } catch (_) {}
    }
    _brightIds = []; _brightScale = null; _screenProxy = null;
    try { _control?.close?.(); } catch (_) {}; _control = null;
    _sinkReady = false; _brightReady = false;
    if (_box) { try { _box.destroy(); } catch (_) {}; _box = null; }
    _icon = null; _slider = null; _currentKind = null;
}