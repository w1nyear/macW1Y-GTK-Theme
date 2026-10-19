// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe volume/brightness OSD (macOS Sonoma style): a dark glass pill under
// the Control Center topbar button. Listens to the PulseAudio sink volume
// and the screen brightness; suppresses the stock OSD for those events via
// hideAll() before first paint (same frame, no flicker) and auto-hides.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_makeGlassStack, isPanelOpen} from './tahoeQuickSettings.js';
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
// glass sampling margin: exactly the shader pad, so the blur hugs the
// border (any wider reads as a second halo pill around the real one)
const OSD_PAD = 20;
const OSD_RADIUS = 22;

// Segmented bar (Tahoe OSD): solid fill + a dots row beneath. Dots at/left
// of the value are bold and opaque, the rest small and faint. Paint runs
// ONLY in the repaint handler (get_context elsewhere segfaults the shell).
const TahoeSegSlider = GObject.registerClass(
class TahoeSegSlider extends St.DrawingArea {
    _init() {
        super._init({reactive: false, height: 28});
        this._v = 0;
        this.connect('repaint', () => {
            try {
                this._paint();
            } catch (_) {
                // no surface
            }
        });
    }

    setValue(v) {
        const nv = Math.max(0, Math.min(1, v));
        if (Math.abs(nv - this._v) < 0.0005)
            return;
        this._v = nv;
        try {
            this.queue_repaint();
        } catch (_) {
            // gone
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
            if (sw <= 0 || sh <= 0)
                return;
            const w = this.width || sw, h = this.height || sh;
            const k = sw / (w || 1);
            cr.save();
            cr.scale(k, k);
            const v = this._v;
            // solid bar
            const barY = Math.round(h * 0.28), barH = 5;
            cr.setSourceRGBA(1, 1, 1, 0.28);
            this._rr(cr, 0, barY, w, barH, barH / 2);
            cr.fill();
            if (v > 0.001) {
                cr.setSourceRGBA(1, 1, 1, 1);
                this._rr(cr, 0, barY, Math.max(barH, Math.round(w * v)), barH, barH / 2);
                cr.fill();
            }
            // dots row beneath: always faint and small (never active)
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
            } catch (_) {
                // gone
            }
        }
    }
});

let _box = null;
let _headIcon = null;
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

function _anchorX(monitor) {
    // center under the Control Center (ydotool) topbar button
    try {
        const btn = Main.panel?.statusArea?.['ydotool-trigger-button'];
        const actor = btn?.actor ?? btn;
        if (actor) {
            const [x] = actor.get_transformed_position();
            const w = actor.width || 0;
            if (x > 0 && w > 0)
                return Math.round(x + w / 2);
        }
    } catch (_) {
        // fall through
    }
    return Math.round(monitor.x + monitor.width - 170);
}

function _hideStockOsd() {
    try {
        const mgr = Main.osdWindowManager;
        if (mgr && typeof mgr.hideAll === 'function')
            mgr.hideAll();
    } catch (_) {
        // stock OSD stays (double OSD, degrades gracefully)
    }
}

// Surface fill mirrors the QS pills (theme tint, same strength) so the OSD
// reads as the same glass, not a bare blur.
function _osdSurf() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('color-scheme') === 'prefer-dark')
            return {c: [0.05, 0.05, 0.07], a: 0.10};
    } catch (_) {
        // light fill stays
    }
    return {c: [0.78, 0.78, 0.80], a: 0.10};
}

// Full QS-style glass stack (refraction/rim/sheen from the user's sliders),
// NOT the pure-blur path: pure zeroes the whole rig and reads as an empty
// outline. Created lazily on first show; region re-synced on every show
// (the pill moves with the topbar button). No per-frame tick: the popup
// lives ~2s, one capture sync per show is plenty and invisible.
function _ensureGlass() {
    if (_glass)
        return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const s = _makeGlassStack(monitor, OSD_RADIUS, 'osd', false);
        Main.layoutManager.uiGroup.add_child(s.bgActor);
        // hidden until the first region sync lands: an effect with no
        // regions paints garbage (the first-show outline flash)
        try {
            s.bgActor.hide();
        } catch (_) {
            // stays
        }
        try {
            Main.layoutManager.uiGroup.set_child_below_sibling(s.bgActor, _box);
        } catch (_) {
            // order unchanged
        }
        // never clone the pill into its own blur (text ghosts)
        try {
            s.uiSampler.addExclusion(_box);
        } catch (_) {
            // sampler stays
        }
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
        // NaN position (unallocated actor) must never reach the shader:
        // NaN poisons the SDF and paints garbage outlines.
        if (!(bw > 0) || !(bh > 0) || !isFinite(bx) || !isFinite(by))
            return false;
        s.bgActor.set_position(monitor.x, monitor.y);
        if (!s.bgActor.visible)
            s.bgActor.show();
        s.bgActor.opacity = 255;
        const rx = (bx - monitor.x) - OSD_PAD;
        const ry = (by - monitor.y) - OSD_PAD;
        const surf = _osdSurf();
        try {
            const [gx, gy] = s.bgActor.get_transformed_position();
            console.log(`[tahoe-osd-geo] box=${Math.round(bx)},${Math.round(by)} ${Math.round(bw)}x${Math.round(bh)} region=${Math.round(rx)},${Math.round(ry)} ${Math.round(bw + OSD_PAD * 2)}x${Math.round(bh + OSD_PAD * 2)} bg=${Math.round(gx)},${Math.round(gy)}`);
        } catch (_) {
            // no log
        }
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
    } catch (_) {
        // panel gone
    }
    return false;
}

function _destroyGlass() {
    const s = _glass;
    _glass = null;
    if (!s)
        return;
    try {
        s.effect?.cleanup?.();
    } catch (_) {
        // already cleaned
    }
    try {
        s.uiSampler?.destroy?.();
    } catch (_) {
        // gone
    }
    try {
        s.wcm?.destroy?.();
    } catch (_) {
        // gone
    }
    try {
        s.bgActor?.destroy?.();
    } catch (_) {
        // gone
    }
}

function _hideNow() {
    _hideId = 0;
    if (!_box)
        return GLib.SOURCE_REMOVE;
    if (_glass) {
        try {
            _glass.bgActor.hide();
        } catch (_) {
            // gone
        }
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
                } catch (_) {
                    // gone
                }
            },
        });
    } catch (_) {
        try {
            _box.hide();
        } catch (_) {
            // gone
        }
    }
    return GLib.SOURCE_REMOVE;
}

function _show(kind, title, headIcon, iconL, iconR, value) {
    if (!_box)
        return;
    // never over an open Control Center or Notification Center
    // (their own sliders drive these)
    try {
        let ncOpen = false;
        try {
            ncOpen = isNCPanelOpen();
        } catch (_) {
            // nc unavailable
        }
        if (isPanelOpen() || ncOpen) {
            if (_box.visible) {
                try {
                    _box.hide();
                } catch (_) {
                    // gone
                }
            }
            if (_glass) {
                try {
                    _glass.bgActor.hide();
                } catch (_) {
                    // gone
                }
            }
            return;
        }
    } catch (_) {
        // panel state unreadable: show anyway
    }
    _hideStockOsd();
    try {
        _headIcon.icon_name = headIcon;
        _title.text = title;
        _iconL.icon_name = iconL;
        _iconR.icon_name = iconR;
        _slider.setValue(value);
    } catch (_) {
        // gone
    }
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
        } catch (_) {
            // flat pill stays
        }
        if (firstShow) {
            // Glass and pill must appear together AND with finite geometry:
            // hold opacity 0, retry the sync until allocation lands
            // (NaN positions never reach the shader), then fade in.
            // Failsafe fades in after ~320ms regardless.
            _box.opacity = 0;
            _box.show();
            try {
                let tries = 0;
                const step = () => {
                    let ok = false;
                    try {
                        ok = _syncGlass();
                    } catch (_) {
                        // retry
                    }
                    tries++;
                    try {
                        if ((ok || tries > 20) && _box && _box.visible) {
                            _box.ease({opacity: 255, duration: 150,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                            return GLib.SOURCE_REMOVE;
                        }
                    } catch (_) {
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                };
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, step);
            } catch (_) {
                try {
                    _box.ease({opacity: 255, duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                } catch (_) {
                    // gone
                }
            }
        } else {
            if (_box.opacity < 255) {
                try {
                    _box.ease({opacity: 255, duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                } catch (_) {
                    // gone
                }
            }
            // same-frame geometry (button may have moved)
            try {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    try {
                        _syncGlass();
                    } catch (_) {
                        // gone
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // gone
    }
    try {
        if (_hideId)
            GLib.Source.remove(_hideId);
    } catch (_) {
        // gone
    }
    _hideId = 0;
    try {
        _hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_MS, _hideNow);
    } catch (_) {
        _hideId = 0;
    }
}

function _isBtSink(sink) {
    try {
        const desc = (sink.description ?? '').toString();
        return /bluetooth|bluez|buds|airpods|headset|headphone/i.test(desc);
    } catch (_) {
        return false;
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
        let desc = '';
        try {
            desc = (sink.description ?? '').toString() || 'Звук';
        } catch (_) {
            desc = 'Звук';
        }
        const muted = !!sink.is_muted;
        _show('volume', desc,
            muted ? 'audio-volume-muted-symbolic'
                : (_isBtSink(sink) ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic'),
            muted ? 'audio-volume-muted-symbolic' : 'audio-volume-low-symbolic',
            'audio-volume-high-symbolic', muted ? 0 : v);
    } catch (_) {
        // gone
    }
}

function _hookSink(sink) {
    for (const id of _sinkIds) {
        try {
            sink.disconnect(id);
        } catch (_) {
            // stale
        }
    }
    _sinkIds = [];
    if (!sink)
        return;
    try {
        _sinkIds.push(sink.connect('notify::volume', _onVolume));
        _sinkIds.push(sink.connect('notify::mute', _onVolume));
    } catch (_) {
        // static
    }
}

function _onBrightness(v) {
    if (!_brightReady) {
        _brightReady = true;
        return;
    }
    try {
        const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
        _show('brightness', `Дисплей · ${pct}%`,
            'display-brightness-symbolic',
            'display-brightness-symbolic',
            'display-brightness-symbolic', v);
    } catch (_) {
        // gone
    }
}

export function enable() {
    if (_box)
        return;
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
        _headIcon = new St.Icon({style_class: 'tahoe-osd-headicon', icon_size: 16});
        _title = new St.Label({style_class: 'tahoe-osd-title', text: ''});
        try {
            _title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (_) {
            // no clutter text
        }
        headRow.add_child(_headIcon);
        headRow.add_child(_title);
        const barRow = new St.BoxLayout({style_class: 'tahoe-osd-bar'});
        _iconL = new St.Icon({style_class: 'tahoe-osd-endicon', icon_size: 15});
        _slider = new TahoeSegSlider();
        _slider.x_expand = true;
        try {
            _slider.reactive = false;
            _slider.can_focus = false;
        } catch (_) {
            // stays
        }
        _iconR = new St.Icon({style_class: 'tahoe-osd-endicon-big', icon_size: 20});
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

    // volume backend (own MixerControl, same pattern as QS)
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
                    } catch (_) {
                        // gone
                    }
                    _onVolume();
                });
                _onVolume();
            } catch (_) {
                // no sink
            }
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
                } catch (_) {
                    // gone
                }
            }));
        }
    } catch (_) {
        // no brightnessManager
    }
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
                    } catch (_) {
                        // gone
                    }
                }));
            }
        } catch (_) {
            _screenProxy = null;
        }
    }
}

export function disable() {
    _destroyGlass();
    if (_hideId) {
        try {
            GLib.Source.remove(_hideId);
        } catch (_) {
            // gone
        }
        _hideId = 0;
    }
    for (const id of _sinkIds) {
        try {
            _control?.get_default_sink()?.disconnect(id);
        } catch (_) {
            // gone
        }
    }
    _sinkIds = [];
    for (const id of _brightIds) {
        try {
            _brightScale?.disconnect(id);
        } catch (_) {
            // gone
        }
        try {
            _screenProxy?.disconnect(id);
        } catch (_) {
            // gone
        }
    }
    _brightIds = [];
    _brightScale = null;
    _screenProxy = null;
    try {
        _control?.close?.();
    } catch (_) {
        // gone
    }
    _control = null;
    _sinkReady = false;
    _brightReady = false;
    if (_box) {
        try {
            _box.destroy();
        } catch (_) {
            // gone
        }
        _box = null;
    }
    _headIcon = null;
    _title = null;
    _iconL = null;
    _iconR = null;
    _slider = null;
}
