// SPDX-License-Identifier: GPL-3.0-or-later











import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POLL_MS = 5000;
const TO_LIGHT = 0.38;
const TO_DARK = 0.62;
const TMP_DIR = '/tmp/opencode';

let _topbarInk = null;
let _panelInk = null;
let _panelRect = null;
let _watchers = new Set();
let _timer = 0;
let _shot = null;
let _wallCache = {path: '', pb: null};
let _method = 0;
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



function _shooter() {
    return null;
}

function _pickLum(x, y) {
    return -1;
}



function _areaLum(rect) {
    return -1;
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
    return _wallLum(rect);
}

function _poll() {



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

    }
}

function _notify() {
    for (const cb of _watchers) {
        try {
            cb();
        } catch (_) {

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

        }
        _timer = 0;
    }
    if (_recheckId) {
        try {
            GLib.Source.remove(_recheckId);
        } catch (_) {

        }
        _recheckId = 0;
    }
    for (const id of _bgIds) {
        try {
            _bgSettings?.disconnect(id);
        } catch (_) {

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

    }
}
