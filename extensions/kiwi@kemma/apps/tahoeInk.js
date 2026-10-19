// SPDX-License-Identifier: GPL-3.0-or-later
// Adaptive ink: text/icons follow the brightness BEHIND them, not the theme.
// Sampling cascade (first sane source wins, checked at runtime):
//   1. Shell.Screenshot.pick_color (cheap, sync)
//   2. screenshot_area to a temp PNG (heavier, sync)
//   3. wallpaper pixbuf mapped onto the monitor (no windows, always works)
//   4. theme fallback
// Median over a point grid (robust against our own icons in a sample),
// hysteresis against flicker.
//   ink 'dark'  = dark text/icons (background is light)
//   ink 'light' = white text/icons (background is dark)

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POLL_MS = 5000;
const TO_LIGHT = 0.38;  // median lum below -> white ink
const TO_DARK = 0.62;   // median lum above -> dark ink
const TMP_DIR = '/tmp/opencode';

let _topbarInk = null;
let _panelInk = null;
let _panelRect = null;
let _watchers = new Set();
let _timer = 0;
let _shot = null;
let _wallCache = {path: '', pb: null};
let _method = 0; // 0 unknown, 1 pick, 2 area, 3 wallpaper, 4 theme
let _bgSettings = null;
let _bgIds = [];
let _recheckId = 0;

function _themeInk() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        return iface.get_string('color-scheme') === 'prefer-light' ? 'dark' : 'light';
    } catch (_) {
        return 'light';
    }
}

function _median(vals) {
    const v = vals.filter(x => x >= 0).sort((a, b) => a - b);
    if (!v.length)
        return -1;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function _pushInk(med, cur) {
    if (med < 0)
        return cur ?? _themeInk();
    if (med < TO_LIGHT)
        return 'light';
    if (med > TO_DARK)
        return 'dark';
    return cur ?? _themeInk();
}

// ---- method 1: pick_color ----

function _shooter() {
    if (!_shot) {
        try {
            _shot = new Shell.Screenshot();
        } catch (_) {
            _shot = null;
        }
    }
    return _shot;
}

function _pickLum(x, y) {
    try {
        const s = _shooter();
        if (!s || typeof s.pick_color !== 'function')
            return -1;
        const [ok, color] = s.pick_color(Math.round(x), Math.round(y));
        if (!ok || !color || color.red === undefined)
            return -1;
        return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
    } catch (_) {
        return -1;
    }
}

// ---- method 2: area screenshot to temp PNG ----

function _areaLum(rect) {
    try {
        const s = _shooter();
        if (!s || typeof s.screenshot_area !== 'function')
            return -1;
        try {
            GLib.mkdir_with_parents(TMP_DIR, 0o700);
        } catch (_) {
            // exists
        }
        const path = `${TMP_DIR}/tahoe-ink.png`;
        const ok = s.screenshot_area(false,
            Math.round(rect.x), Math.round(rect.y),
            Math.max(1, Math.round(rect.w)), Math.max(1, Math.round(rect.h)),
            path);
        if (!ok)
            return -1;
        const lum = _pixbufGridLum(path, 0, 0,
            Math.round(rect.w), Math.round(rect.h), 1);
        try {
            GLib.unlink(path);
        } catch (_) {
            // leftover
        }
        return lum;
    } catch (_) {
        return -1;
    }
}

function _pixbufGridLum(path, ox, oy, w, h, div) {
    try {
        const pb = GdkPixbuf.Pixbuf.new_from_file(path);
        return _pbGridLum(pb, ox, oy, w, h, div);
    } catch (_) {
        return -1;
    }
}

function _pbGridLum(pb, ox, oy, w, h, div) {
    try {
        const pw = pb.get_width(), ph = pb.get_height();
        const rs = pb.get_rowstride(), nch = pb.get_n_channels();
        const px = pb.get_pixels();
        if (!px || pw <= 0 || ph <= 0)
            return -1;
        const vals = [];
        const xs = [0.15, 0.5, 0.85], ys = [0.2, 0.5, 0.8];
        for (const fy of ys) {
            for (const fx of xs) {
                const sx = Math.min(pw - 1, Math.max(0, Math.round((ox + w * fx) / div)));
                const sy = Math.min(ph - 1, Math.max(0, Math.round((oy + h * fy) / div)));
                const o = sy * rs + sx * nch;
                if (o + 2 < px.length)
                    vals.push((0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255);
            }
        }
        return _median(vals);
    } catch (_) {
        return -1;
    }
}

// ---- method 3: wallpaper pixbuf, zoom-mapped onto the monitor ----

function _wallpaperPath() {
    try {
        const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const dark = iface.get_string('color-scheme') !== 'prefer-light';
        let uri = '';
        try {
            uri = bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri') || '';
        } catch (_) {
            uri = '';
        }
        if (!uri) {
            try {
                uri = bg.get_string('picture-uri') || '';
            } catch (_) {
                uri = '';
            }
        }
        if (uri.startsWith('file://')) {
            try {
                return Gio.File.new_for_uri(uri).get_path();
            } catch (_) {
                return '';
            }
        }
        return '';
    } catch (_) {
        return '';
    }
}

function _wallLum(rect) {
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return -1;
        const path = _wallpaperPath();
        if (!path)
            return -1;
        // cache the decoded pixbuf (a 4MB JPEG decode every poll is waste);
        // reload on wallpaper change only
        let pb = null;
        try {
            if (_wallCache.path === path && _wallCache.pb)
                pb = _wallCache.pb;
            else {
                pb = GdkPixbuf.Pixbuf.new_from_file(path);
                _wallCache = {path, pb};
            }
        } catch (_) {
            _wallCache = {path: '', pb: null};
            return -1;
        }
        if (!pb)
            return -1;
        const pw = pb.get_width(), ph = pb.get_height();
        if (!(pw > 0) || !(ph > 0))
            return -1;
        // 'zoom': scale to fill, centered crop
        const scale = Math.max(monitor.width / pw, monitor.height / ph);
        const sw = monitor.width / scale, sh = monitor.height / scale;
        const ox = (pw - sw) / 2 - monitor.x / scale;
        const oy = (ph - sh) / 2 - monitor.y / scale;
        return _pbGridLum(pb, ox + rect.x / scale, oy + rect.y / scale,
            rect.w / scale, rect.h / scale, 1);
    } catch (_) {
        return -1;
    }
}

// ---- rects + poll ----

function _topbarRect() {
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelH = Main.layoutManager.panelBox?.height ?? 34;
        if (!monitor || !(panelH > 0))
            return null;
        return {x: monitor.x, y: monitor.y, w: monitor.width, h: panelH};
    } catch (_) {
        return null;
    }
}

function _sampleRect(rect) {
    if (!rect || !(rect.w > 0) || !(rect.h > 0))
        return -1;
    // sticky method: reuse what worked, re-probe on failure
    const order = _method === 1 ? [1, 2, 3]
        : _method === 2 ? [2, 1, 3]
        : _method === 3 ? [3, 1, 2] : [1, 2, 3];
    for (const m of order) {
        let lum = -1;
        try {
            if (m === 1) {
                const vals = [];
                const xs = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
                for (const fx of xs)
                    vals.push(_pickLum(rect.x + rect.w * fx, rect.y + rect.h / 2));
                lum = _median(vals);
            } else if (m === 2) {
                lum = _areaLum(rect);
            } else {
                lum = _wallLum(rect);
            }
        } catch (_) {
            lum = -1;
        }
        if (lum >= 0) {
            _method = m;
            return lum;
        }
    }
    _method = 4;
    return -1;
}

function _poll() {
    // Topbar: wallpaper only. Stage sampling here is poisoned by the panel's
    // own dark veil + icons composited over the strip (median drags dark and
    // ink locks to theme) - wallpaper is veil-proof by construction.
    try {
        const tr = _topbarRect();
        if (tr) {
            const next = _pushInk(_wallLum(tr), _topbarInk);
            if (next !== _topbarInk) {
                _topbarInk = next;
                _applyPanelClass();
                _notify();
            }
        }
    } catch (_) {
        // keep last ink
    }
    try {
        if (_panelRect) {
            const next = _pushInk(_sampleRect(_panelRect), _panelInk);
            if (next !== _panelInk) {
                _panelInk = next;
                _notify();
            }
        }
    } catch (_) {
        // keep last ink
    }
}

function _applyPanelClass() {
    try {
        const panel = Main.panel;
        if (!panel)
            return;
        panel.remove_style_class_name('tahoe-ink-dark');
        panel.remove_style_class_name('tahoe-ink-light');
        panel.add_style_class_name(
            _topbarInk === 'light' ? 'tahoe-ink-light' : 'tahoe-ink-dark');
    } catch (_) {
        // panel gone
    }
}

function _notify() {
    for (const cb of _watchers) {
        try {
            cb();
        } catch (_) {
            // watcher gone
        }
    }
}

function _scheduleRecheck() {
    if (_recheckId)
        return;
    try {
        _recheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            _recheckId = 0;
            _poll();
            return GLib.SOURCE_REMOVE;
        });
    } catch (_) {
        _recheckId = 0;
    }
}

export function getTopbarInk() {
    return _topbarInk ?? _themeInk();
}

export function getPanelInk() {
    return _panelInk ?? _themeInk();
}

export function notePanelRect(rect) {
    _panelRect = rect;
    if (rect) {
        try {
            const next = _pushInk(_sampleRect(rect), _panelInk);
            if (next !== _panelInk) {
                _panelInk = next;
                _notify();
            }
        } catch (_) {
            // theme fallback stays
        }
    }
}

export function watchInk(cb) {
    _watchers.add(cb);
    return () => _watchers.delete(cb);
}

export function enable() {
    if (!_topbarInk)
        _topbarInk = _themeInk();
    if (!_panelInk)
        _panelInk = _themeInk();
    if (!_bgSettings) {
        try {
            _bgSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            _bgIds.push(_bgSettings.connect('changed::picture-uri', _scheduleRecheck));
            _bgIds.push(_bgSettings.connect('changed::picture-uri-dark', _scheduleRecheck));
        } catch (_) {
            _bgSettings = null;
            _bgIds = [];
        }
    }
    _applyPanelClass();
    _poll();
    if (!_timer) {
        try {
            _timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
                _poll();
                return GLib.SOURCE_CONTINUE;
            });
        } catch (_) {
            _timer = 0;
        }
    }
}

export function disable() {
    if (_timer) {
        try {
            GLib.Source.remove(_timer);
        } catch (_) {
            // gone
        }
        _timer = 0;
    }
    if (_recheckId) {
        try {
            GLib.Source.remove(_recheckId);
        } catch (_) {
            // gone
        }
        _recheckId = 0;
    }
    for (const id of _bgIds) {
        try {
            _bgSettings?.disconnect(id);
        } catch (_) {
            // gone
        }
    }
    _bgIds = [];
    _bgSettings = null;
    _watchers.clear();
    _shot = null;
    _wallCache = {path: '', pb: null};
    _panelRect = null;
    try {
        Main.panel?.remove_style_class_name('tahoe-ink-dark');
        Main.panel?.remove_style_class_name('tahoe-ink-light');
    } catch (_) {
        // gone
    }
}
