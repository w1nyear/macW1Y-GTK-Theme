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
const MAX_TITLE_W = OSD_W - 32; // 268px
const HIDE_MS = 1800;
const OSD_PAD = 20;
const OSD_RADIUS = 22;

function _setTitleText(text) {
    if (!_title)
        return;
    _title.text = text;
    try {
        _title.set_width(MAX_TITLE_W);
        if (_title.clutter_text) {
            _title.clutter_text.set_width(MAX_TITLE_W);
            _title.clutter_text.single_line_mode = true;
            _title.clutter_text.line_wrap = false;
            _title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const layout = _title.clutter_text.get_layout();
            if (layout) {
                layout.set_width(MAX_TITLE_W * Pango.SCALE);
                layout.set_ellipsize(Pango.EllipsizeMode.END);
            }
        }
    } catch (_) {}
}

function _getAccentColor() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const name = iface.get_string('accent-color') || 'blue';
        const ACCENT_MAP = {
            'blue':   [0.05, 0.56, 1.00], // #0c8eff / #007aff macOS vibrant blue
            'teal':   [0.13, 0.56, 0.64],
            'green':  [0.20, 0.78, 0.35], // #34c759
            'yellow': [1.00, 0.80, 0.00], // #ffcc00
            'orange': [1.00, 0.58, 0.00], // #ff9500
            'red':    [1.00, 0.23, 0.19], // #ff3b30
            'pink':   [1.00, 0.18, 0.33], // #ff2d55
            'purple': [0.69, 0.32, 0.87], // #af52de
            'slate':  [0.56, 0.56, 0.58], // #8e8e93
        };
        return ACCENT_MAP[name] || ACCENT_MAP['blue'];
    } catch (_) {
        return [0.05, 0.56, 1.00];
    }
}

function _isOverampAllowed() {
    try {
        const soundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        return soundSettings.get_boolean('allow-volume-above-100-percent');
    } catch (_) {
        return false;
    }
}

// Segmented bar (Tahoe OSD): solid fill + a dots row beneath. Dots at/left
// of the value are bold and opaque, the rest small and faint.
// Aligned with 16 discrete steps of volume/brightness.
const TahoeSegSlider = GObject.registerClass({
    GTypeName: `TahoeSegSlider_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
}, class TahoeSegSlider extends St.DrawingArea {
    _init() {
        super._init({reactive: false, height: 20});
        this._v = 0;
        this._isOveramp = false;
        this.connect('repaint', () => {
            try {
                this._paint();
            } catch (_) {}
        });
    }

    setValue(v, isOveramp = false) {
        const nv = Math.max(0, Math.min(1.53, v));
        const noa = !!isOveramp;
        if (Math.abs(nv - this._v) < 0.0005 && this._isOveramp === noa)
            return;
        this._v = nv;
        this._isOveramp = noa;
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
            let v = this._v;
            const isOveramp = this._isOveramp || v > 1.0001;

            // solid background track
            const barY = 5, barH = 5;
            const r = barH / 2;
            cr.setSourceRGBA(1, 1, 1, 0.18);
            this._rr(cr, 0, barY, w, barH, r);
            cr.fill();

            // Colors: RED if overamplified (100%+), solid opaque WHITE if <= 100%
            const RED = [1.00, 0.23, 0.19];
            const WHITE = [1.00, 1.00, 1.00];
            const [colorR, colorG, colorB] = isOveramp ? RED : WHITE;

            // Step snapping for 16 segments (matching volume/brightness stops)
            const n = 16;
            const stepIdx = Math.max(0, Math.min(n, Math.round(v * n)));
            if (v <= 1.0001 && Math.abs(v - stepIdx / n) <= 0.038)
                v = stepIdx / n;

            // 17 dots (i = 0 to 16): dot 0 at the start of slider, dot 16 at the end
            const dotXs = [];
            for (let i = 0; i <= n; i++) {
                dotXs.push(r + i * (w - 2 * r) / n);
            }

            // filled bar: stops exactly where the dot is
            let fillW = 0;
            if (isOveramp) {
                fillW = w;
                cr.setSourceRGBA(colorR, colorG, colorB, 1.0);
                this._rr(cr, 0, barY, fillW, barH, r);
                cr.fill();
            } else if (v > 0.001) {
                if (Math.abs(v - stepIdx / n) < 0.001) {
                    fillW = (stepIdx === n) ? w : dotXs[stepIdx];
                } else {
                    fillW = Math.max(barH, Math.min(w, Math.round(r + v * (w - 2 * r))));
                }
                cr.setSourceRGBA(colorR, colorG, colorB, 1.0);
                this._rr(cr, 0, barY, fillW, barH, r);
                cr.fill();
            }

            // dots row beneath: 17 dots precisely aligned, dot 0 at start, closer to slider
            const dy = barY + barH + 3.5;
            for (let i = 0; i <= n; i++) {
                const dotX = dotXs[i];
                const isActive = isOveramp || (stepIdx > 0 && i <= stepIdx && fillW > 0);
                if (isActive) {
                    cr.setSourceRGBA(colorR, colorG, colorB, 1.0);
                } else {
                    cr.setSourceRGBA(1, 1, 1, 0.18);
                }
                cr.arc(dotX, dy, 1.0, 0, Math.PI * 2);
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
let _osdShadow = null;
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
let _lastKnownPanelH = 34;

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

function _isFullscreenOrPanelHidden(monitor) {
    try {
        if (monitor && monitor.inFullscreen)
            return true;
        if (global.display?.get_monitor_in_fullscreen && monitor &&
            global.display.get_monitor_in_fullscreen(monitor.index))
            return true;
        const focusWin = global.display?.focus_window;
        if (focusWin && focusWin.is_fullscreen() && (!monitor || focusWin.get_monitor() === monitor.index))
            return true;
        const ws = global.workspace_manager?.get_active_workspace();
        if (ws && ws.list_windows().some(w => w.is_fullscreen() && (!monitor || w.get_monitor() === monitor.index)))
            return true;
        const panel = Main.panel;
        const panelBox = Main.layoutManager?.panelBox;
        if (!panel || !panel.visible || panel.opacity === 0 || panel.translation_y < -5 || panel.y < -5)
            return true;
        if (panelBox && (!panelBox.visible || panelBox.opacity === 0 || panelBox.translation_y < -5 || panelBox.y < -5 || panelBox.height === 0))
            return true;
    } catch (_) {}
    return false;
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
    if (!mgr)
        return;
    if (mgr._showOsdWindow && mgr._showOsdWindow._isTahoeOSD)
        return;
    if (_origShowOsdWindow)
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

    const handler = function(monitorIndex, icon, label, level, maxLevel) {
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
    handler._isTahoeOSD = true;
    mgr._showOsdWindow = handler;
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
        const ctrl = (_control && _control.get_state() === Gvc.MixerControlState.READY)
            ? _control
            : (Main.panel.statusArea.quickSettings?._volumeOutput?._control ?? null);

        if (ctrl) {
            const sink = ctrl.get_default_sink();
            if (sink) {
                let desc = '';
                if (typeof sink.get_description === 'function')
                    desc = (sink.get_description() ?? '').toString().trim();
                if (!desc && sink.description)
                    desc = (sink.description ?? '').toString().trim();

                if (!desc) {
                    try {
                        const port = sink.get_port ? sink.get_port() : null;
                        if (port)
                            desc = (port.human_name || port.port || '').toString().trim();
                    } catch (_) {}
                }

                if (desc)
                    return desc;
            }
        }
    } catch (_) {}
    return 'Динаміки';
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
        const overampAllowed = _isOverampAllowed();
        const maxLimit = overampAllowed ? 1.53 : 1.0;

        if (level !== undefined && level !== null) {
            if (maxLevel && maxLevel > 0) {
                val = maxLevel === 150 ? (level / 100) : (level / maxLevel);
            } else {
                val = level;
            }
            if (val <= 0)
                isMuted = true;
        } else if (_control && _control.get_state() === Gvc.MixerControlState.READY && _control.get_default_sink()) {
            const sink = _control.get_default_sink();
            const maxNorm = _control.get_vol_max_norm() || 65536;
            val = sink.volume / maxNorm;
            isMuted = !!sink.is_muted;
        }
        val = Math.max(0, Math.min(maxLimit, val));
        const title = _getAudioDeviceTitle();
        _show('volume', title,
            isMuted ? 'audio-volume-muted-symbolic' : (val > 1.0001 ? 'audio-volume-overamplified-symbolic' : 'audio-volume-low-symbolic'),
            isMuted ? 'audio-volume-muted-symbolic' : (val > 1.0001 ? 'audio-volume-overamplified-symbolic' : 'audio-volume-high-symbolic'),
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
        const oldGlassActors = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.name && c.name === 'liquid-glass-bg-actor-osd'
        );
        for (const g of oldGlassActors) {
            try { g.destroy(); } catch (_) {}
        }
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const s = _makeGlassStack(monitor, OSD_RADIUS, 'osd', false);
        Main.layoutManager.uiGroup.add_child(s.bgActor);
        try {
            s.bgActor.hide();
        } catch (_) {}
        if (_osdShadow) {
            try {
                Main.layoutManager.uiGroup.set_child_below_sibling(_osdShadow, s.bgActor);
            } catch (_) {}
            try {
                s.uiSampler.addExclusion(_osdShadow);
            } catch (_) {}
        }
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
        if (typeof bx !== 'number' || typeof by !== 'number' || !Number.isFinite(bx) || !Number.isFinite(by) || bx <= 0 || by <= 0)
            return false;
        if (typeof bw !== 'number' || typeof bh !== 'number' || !Number.isFinite(bw) || !Number.isFinite(bh) || bw <= 0 || bh <= 0)
            return false;

        if (_osdShadow) {
            _osdShadow.set_position(bx, by);
            _osdShadow.set_size(bw, bh);
            try {
                Main.layoutManager.uiGroup.set_child_below_sibling(_osdShadow, s.bgActor);
                Main.layoutManager.uiGroup.set_child_below_sibling(s.bgActor, _box);
            } catch (_) {}
        }

        s.bgActor.set_position(monitor.x, monitor.y);
        if (!s.bgActor.visible)
            s.bgActor.show();
        s.bgActor.opacity = 255;
        const rx = (bx - monitor.x) - OSD_PAD;
        const ry = (by - monitor.y) - OSD_PAD;
        const surf = _osdSurf();

        s.effect.setCornerRadius(OSD_RADIUS);
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
    if (s) {
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
    try {
        const leftovers = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.name && c.name === 'liquid-glass-bg-actor-osd'
        );
        for (const l of leftovers) {
            try { l.destroy(); } catch (_) {}
        }
    } catch (_) {}
}

function _hideNow() {
    _hideId = 0;
    if (_glass) {
        try {
            _glass.bgActor.hide();
        } catch (_) {}
    }
    if (_osdShadow) {
        try {
            _osdShadow.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try {
                        if (_osdShadow)
                            _osdShadow.hide();
                    } catch (_) {}
                },
            });
        } catch (_) {
            try {
                _osdShadow.hide();
            } catch (_) {}
        }
    }
    if (!_box)
        return GLib.SOURCE_REMOVE;
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
            if (_osdShadow?.visible) {
                try {
                    _osdShadow.hide();
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
        const isOveramp = (kind === 'volume' && value > 1.0001);
        const fullTitle = isOveramp ? `${title} · ${Math.round(value * 100)}%` : title;
        _setTitleText(fullTitle);
        _iconL.icon_name = iconL;
        _iconR.icon_name = iconR;
        _slider.setValue(value, isOveramp);
    } catch (_) {}

    try {
        let monitor = Main.layoutManager.primaryMonitor;
        try {
            const currentMonIdx = global.display?.get_current_monitor ? global.display.get_current_monitor() : -1;
            const focusWin = global.display?.focus_window;
            if (focusWin && focusWin.is_fullscreen()) {
                const winMonIndex = focusWin.get_monitor();
                const winMon = Main.layoutManager.monitors[winMonIndex];
                if (winMon)
                    monitor = winMon;
            } else if (currentMonIdx >= 0 && Main.layoutManager.monitors[currentMonIdx]) {
                const currentMon = Main.layoutManager.monitors[currentMonIdx];
                if (currentMon && (currentMon.inFullscreen || (global.display.get_monitor_in_fullscreen && global.display.get_monitor_in_fullscreen(currentMonIdx)))) {
                    monitor = currentMon;
                }
            }
        } catch (_) {}
        if (!monitor)
            return;

        const curPanelH = Main.layoutManager.panelBox?.height;
        if (typeof curPanelH === 'number' && curPanelH > 20)
            _lastKnownPanelH = Math.round(curPanelH);
        const panelH = _lastKnownPanelH || 34;

        let boxX;
        if (_isFullscreenOrPanelHidden(monitor)) {
            // Fullscreen application (not maximized) or hidden menubar: center horizontally across the screen
            boxX = Math.round(monitor.x + (monitor.width - OSD_W) / 2);
        } else {
            // Desktop or maximized window with visible menubar: align under the top-right tray / quick settings
            const cx = Math.max(monitor.x + OSD_W / 2,
                Math.min(monitor.x + monitor.width - OSD_W / 2, _anchorX(monitor)));
            boxX = Math.round(cx - OSD_W / 2);
        }
        const boxY = monitor.y + panelH + 8;
        _box.set_position(boxX, boxY);
        if (_osdShadow) {
            _osdShadow.set_position(boxX, boxY);
            _osdShadow.set_width(OSD_W);
            if (_box.height > 0)
                _osdShadow.set_height(_box.height);
        }

        const firstShow = !_box.visible;
        try {
            if (_ensureGlass())
                _syncGlass();
        } catch (_) {}

        if (firstShow) {
            _box.opacity = 0;
            _box.show();
            if (_osdShadow) {
                _osdShadow.opacity = 0;
                _osdShadow.show();
            }
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
                        if (_osdShadow && _osdShadow.visible) {
                            _osdShadow.ease({
                                opacity: 255, duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                        }
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
            if (_osdShadow)
                _osdShadow.remove_all_transitions();
            if (_box.opacity < 255) {
                try {
                    _box.ease({opacity: 255, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                } catch (_) {}
            }
            if (_osdShadow) {
                if (!_osdShadow.visible)
                    _osdShadow.show();
                if (_osdShadow.opacity < 255) {
                    try {
                        _osdShadow.ease({opacity: 255, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                    } catch (_) {}
                }
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
        const maxNorm = _control.get_vol_max_norm() || 65536;
        const overampAllowed = _isOverampAllowed();
        const maxLimit = overampAllowed ? 1.53 : 1.0;
        const v = Math.max(0, Math.min(maxLimit, sink.volume / maxNorm));
        if (!_sinkReady) {
            _sinkReady = true;
            return;
        }
        const title = _getAudioDeviceTitle();
        const muted = !!sink.is_muted;
        _show('volume', title,
            muted ? 'audio-volume-muted-symbolic' : (v > 1.0001 ? 'audio-volume-overamplified-symbolic' : 'audio-volume-low-symbolic'),
            muted ? 'audio-volume-muted-symbolic' : (v > 1.0001 ? 'audio-volume-overamplified-symbolic' : 'audio-volume-high-symbolic'),
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
        const oldShadows = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.has_style_class_name && c.has_style_class_name('tahoe-osd-shadow')
        );
        for (const s of oldShadows) {
            try { s.destroy(); } catch (_) {}
        }
        const oldBoxes = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.has_style_class_name && c.has_style_class_name('tahoe-osd')
        );
        for (const b of oldBoxes) {
            try { b.destroy(); } catch (_) {}
        }
        const oldGlassActors = Main.layoutManager.uiGroup.get_children().filter(c =>
            c.name && c.name === 'liquid-glass-bg-actor-osd'
        );
        for (const g of oldGlassActors) {
            try { g.destroy(); } catch (_) {}
        }
    } catch (_) {}
    try {
        _osdShadow = new St.Widget({
            style_class: 'tahoe-osd-shadow',
            visible: false,
            opacity: 0,
            reactive: false,
        });
        _osdShadow.set_width(OSD_W);
        Main.layoutManager.uiGroup.add_child(_osdShadow);

        _box = new St.BoxLayout({
            style_class: 'tahoe-osd',
            vertical: true,
            visible: false,
            opacity: 0,
            reactive: false,
        });
        _box.set_width(OSD_W);

        const headRow = new St.BoxLayout({
            style_class: 'tahoe-osd-head',
            x_expand: false,
        });
        headRow.set_width(MAX_TITLE_W);

        _title = new St.Label({
            style_class: 'tahoe-osd-title',
            text: '',
            x_expand: false,
        });
        _title.set_width(MAX_TITLE_W);
        try {
            _title.clutter_text.set_width(MAX_TITLE_W);
            _title.clutter_text.single_line_mode = true;
            _title.clutter_text.line_wrap = false;
            _title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (_) {}
        headRow.add_child(_title);

        const barRow = new St.BoxLayout({style_class: 'tahoe-osd-bar'});
        _iconL = new St.Icon({
            style_class: 'tahoe-osd-endicon',
            icon_size: 15,
            y_align: Clutter.ActorAlign.CENTER,
        });
        _iconL.translation_y = -2;
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
        _iconR.translation_y = -1;
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
    if (_osdShadow) {
        try {
            _osdShadow.destroy();
        } catch (_) {}
        _osdShadow = null;
    }
    _title = null;
    _iconL = null;
    _iconR = null;
    _slider = null;
}

export function showTest(kind = 'volume', title = 'Raptor Lake-P/U/H cAVS Speaker', iconL = 'audio-volume-low-symbolic', iconR = 'audio-volume-high-symbolic', val = 0.35) {
    _show(kind, title, iconL, iconR, val);
}
