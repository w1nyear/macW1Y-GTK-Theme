// World clock widget (macOS Tahoe): four mini analog dials with the
// city name, day word and hour offset below each one.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {cairoInk, cairoSub} from './theme.js';

const CITIES = [
    {city: 'Cupertino', zone: 'America/Los_Angeles'},
    {city: 'Tokyo', zone: 'Asia/Tokyo'},
    {city: 'Sydney', zone: 'Australia/Sydney'},
    {city: 'Paris', zone: 'Europe/Paris'},
];

const FACE = 76;

function drawFace(face, dt, ink, sub, numeralScale = 1, cscale = 1) {
    try {
        if (!face.is_mapped() || (face.width || 0) <= 0)
            return;
    } catch (_) {
        return;
    }
    const cr = face.get_context();
    const [sw, sh] = face.get_surface_size();
    const [aw, ah] = [face.width || FACE, face.height || FACE];
    if (sw <= 0 || sh <= 0)
        return;
    cr.save();
    cr.scale(sw / aw, sh / ah);
    const cx = aw / 2, cy = ah / 2;
    const R = Math.min(aw, ah) / 2 - 3;
    const h = dt.get_hour() % 12 + dt.get_minute() / 60;
    const m = dt.get_minute() + dt.get_second() / 60;
    const s = dt.get_second();
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        cr.setSourceRGBA(...sub, 0.8);
        cr.setLineWidth(1.2 * cscale);
        cr.moveTo(cx + Math.sin(a) * (R - 5 * cscale), cy - Math.cos(a) * (R - 5 * cscale));
        cr.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
        cr.stroke();
    }
    cr.selectFontFace('SF Pro Display', 0, 1);
    cr.setFontSize(8 * numeralScale * cscale);
    for (let n = 1; n <= 12; n++) {
        const a = n * Math.PI / 6;
        const txt = String(n);
        const ext = cr.textExtents(txt);
        cr.setSourceRGBA(...ink, 0.9);
        cr.moveTo(cx + Math.sin(a) * (R - 12 * cscale) - ext.width / 2,
                  cy - Math.cos(a) * (R - 12 * cscale) + ext.height / 2);
        cr.showText(txt);
    }
    const hand = (angle, len, width, color) => {
        cr.setSourceRGBA(...color);
        cr.setLineWidth(width * cscale);
        cr.setLineCap(1);
        cr.moveTo(cx, cy);
        cr.lineTo(cx + Math.sin(angle) * len, cy - Math.cos(angle) * len);
        cr.stroke();
    };
    hand(h * Math.PI / 6, R * 0.5, 2.6, [...ink, 0.95]);
    hand(m * Math.PI / 30, R * 0.75, 1.8, [...ink, 0.95]);
    hand(s * Math.PI / 30, R * 0.82, 0.9, [1, 0.37, 0.34, 0.95]);
    cr.setSourceRGBA(...ink, 0.95);
    cr.arc(cx, cy, 1.8 * cscale, 0, 2 * Math.PI);
    cr.fill();
    cr.restore();
    cr.$dispose();
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY',
    'THURSDAY', 'FRIDAY', 'SATURDAY'];

const OFFSET_KEYS = [
    'worldclock-cell0-x', 'worldclock-cell0-y',
    'worldclock-cell1-x', 'worldclock-cell1-y',
    'worldclock-cell2-x', 'worldclock-cell2-y',
    'worldclock-cell3-x', 'worldclock-cell3-y',
];

export const WorldClockWidget = GObject.registerClass(
class WorldClockWidget extends St.Widget {
    _init({settings = null, theme = 'glass', darkText = false, variant = 'wide', ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-worldclock',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._theme = theme;
        this._darkText = darkText;
        this._settings = settings;
        this._offsetId = 0;
        this._rowBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
        });
        this._gridBox = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            x_expand: true,
        });
        this.add_child(this._rowBox);
        this.add_child(this._gridBox);
        this._cells = CITIES.map(c => {
            const cell = new St.BoxLayout({
                style_class: 'tw-wc-cell',
                vertical: true,
                x_expand: true,
            });
            const face = new St.DrawingArea({style_class: 'tw-wc-face'});
            face.set_size(FACE, FACE);
            const city = new St.Label({style_class: 'tw-wc-city', text: c.city});
            const day = new St.Label({style_class: 'tw-wc-day', text: ''});
            const off = new St.Label({style_class: 'tw-wc-off', text: ''});
            cell.add_child(face);
            cell.add_child(city);
            cell.add_child(day);
            cell.add_child(off);
            this._rowBox.add_child(cell);
            let tz = null;
            try {
                tz = GLib.TimeZone.new(c.zone);
            } catch (_) {
                tz = null;
            }
            const ref = {...c, tz, face, cityLabel: city, day, off, cell};
            // paint ONLY here: get_context() is valid solely during repaint
            face.connect('repaint', () => {
                try {
                    this._drawFace(ref);
                } catch (_) {
                    // no surface
                }
            });
            return ref;
        });
        this._timerId = 0;
        this._variant = null;
        this.setVariant(variant);
        if (settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                    if (key === 'worldclock-text-size' || key === 'text-size') {
                        for (const ref of this._cells) {
                            try {
                                if (ref.face.is_mapped())
                                    ref.face.queue_repaint();
                            } catch (_) {
                                // not on stage
                            }
                        }
                    }
                });
            } catch (_) {
                // static settings
            }
        this.connect('destroy', () => this.destroy());
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._startTimer();
            else
                this._stopTimer();
        });
        this._startTimer();
        this._sync();
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            this._cells.forEach((ref, i) => {
                const dx = this._settings.get_int(`worldclock-cell${i}-x`) || 0;
                const dy = this._settings.get_int(`worldclock-cell${i}-y`) || 0;
                ref.cell.translation_x = dx;
                ref.cell.translation_y = dy;
            });
        } catch (_) {
            // gone
        }
    }

    // Wide: four dials in a row. Square: 2x2 grid of dials.
    setVariant(v) {
        if (v !== 'wide' && v !== 'square')
            v = 'wide';
        if (this._variant === v)
            return;
        this._variant = v;
        try {
            const grid = this._gridBox.layout_manager;
            this._cells.forEach((ref, i) => {
                try {
                    if (v === 'square')
                        grid.attach(ref.cell, i % 2, Math.floor(i / 2), 1, 1);
                    else
                        this._rowBox.add_child(ref.cell);
                } catch (_) {
                    // gone
                }
            });
            this._rowBox.visible = v !== 'square';
            this._gridBox.visible = v === 'square';
            for (const ref of this._cells) {
                try {
                    if (ref.face.is_mapped())
                        ref.face.queue_repaint();
                } catch (_) {
                    // not on stage
                }
            }
        } catch (_) {
            // no layout
        }
    }

    getVariantSize() {
        return this._variant === 'square' ? [230, 270] : [WORLDCLOCK_W, WORLDCLOCK_H];
    }

    setTheme(theme) {
        this._theme = theme;
        this._sync();
    }

    setDarkText(dark) {
        this._darkText = dark;
        try {
            for (const c of this._cells) {
                for (const label of [c.cityLabel, c.day, c.off]) {
                    try {
                        label.remove_style_class_name('tw-dark');
                        if (dark)
                            label.add_style_class_name('tw-dark');
                    } catch (_) {
                        // gone
                    }
                }
                try {
                    if (c.face.is_mapped())
                        c.face.queue_repaint();
                } catch (_) {
                    // not on stage
                }
            }
        } catch (_) {
            // gone
        }
    }

    _startTimer() {
        if (this._timerId)
            return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            try {
                if (!this.get_stage()) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._sync();
                return GLib.SOURCE_CONTINUE;
            } catch (_) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    // Dial numerals follow the widget text size (own key, then global;
    // base 15px).
    _numeralScale() {
        for (const key of ['worldclock-text-size', 'text-size']) {
            try {
                const v = this._settings?.get_int(key) ?? 0;
                if (Number.isFinite(v) && v > 0)
                    return Math.max(0.6, Math.min(2.2, v / 15));
            } catch (_) {
                // next key
            }
        }
        return 1;
    }

    // Crisp resize: redraw dials at real pixels instead of magnifying
    // a bitmap (which pixelates text).
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        try {
            for (const ref of this._cells) {
                ref.face.set_size(Math.round(FACE * s), Math.round(FACE * s));
                if (ref.face.is_mapped())
                    ref.face.queue_repaint();
            }
        } catch (_) {
            // gone
        }
    }

    _drawFace(c) {
        let dt = null;
        try {
            dt = c.tz ? GLib.DateTime.new_now(c.tz) : GLib.DateTime.new_now_local();
        } catch (_) {
            dt = GLib.DateTime.new_now_local();
        }
        // Ink follows setDarkText (user tint aware); theme fallback stays.
        const ink = this._darkText ? [0.13, 0.13, 0.15] : cairoInk(this._theme, 'card');
        const sub = this._darkText ? [0.4, 0.4, 0.42] : cairoSub(this._theme, 'card');
        drawFace(c.face, dt, ink, sub, this._numeralScale(), this._cscale ?? 1);
    }

    _sync() {
        // labels + repaint requests only: no Cairo outside repaint
        try {
            const nowLocal = GLib.DateTime.new_now_local();
            for (const c of this._cells) {
                let dt = null;
                try {
                    dt = c.tz ? GLib.DateTime.new_now(c.tz) : nowLocal;
                } catch (_) {
                    dt = nowLocal;
                }
                try {
                    if (c.face.is_mapped())
                        c.face.queue_repaint();
                } catch (_) {
                    // not on stage
                }
                try {
                    const dayDiff = Math.round((dt.to_unix() - nowLocal.to_unix()) / 86400);
                    const wd = DAYS[dt.get_day_of_week() % 7];
                    c.day.text = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow'
                        : dayDiff === -1 ? 'Yesterday' : wd.charAt(0) + wd.slice(1).toLowerCase();
                    const offH = Math.round((dt.get_utc_offset() - nowLocal.get_utc_offset()) / 3600);
                    c.off.text = `${offH >= 0 ? '+' : ''}${offH}HRS`;
                } catch (_) {
                    // labels stay
                }
            }
        } catch (_) {
            // no clock
        }
    }

    destroy() {
        this._stopTimer();
        if (this._offsetId && this._settings) {
            try {
                this._settings.disconnect(this._offsetId);
            } catch (e) {
                // gone
            }
            this._offsetId = 0;
        }
        super.destroy();
    }
});

export const WORLDCLOCK_W = 400;
export const WORLDCLOCK_H = 185;
