// Analog clock widget: Cairo face with ticks, numerals and hands,
// refreshed every second while mapped.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const SIZE = 190;

const OFFSET_KEYS = ['clock-face-x', 'clock-face-y'];

export const ClockWidget = GObject.registerClass(
class ClockWidget extends St.Widget {
    _init({settings = null, darkText = false, ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-clock',
            reactive: true,
            ...rest,
        });
        this._darkText = darkText;
        this._settings = settings;
        this._offsetId = 0;

        this._face = new St.DrawingArea({x_expand: true, y_expand: true});
        this._face.set_size(SIZE, SIZE);
        this.add_child(this._face);
        this._face.connect('repaint', () => this._draw());
        if (settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                    if (key === 'clock-text-size' || key === 'text-size')
                        this._face.queue_repaint();
                });
            } catch (_) {
                // static settings
            }
        }

        this.connect('destroy', () => this.destroy());
        this._timerId = 0;
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._startTimer();
            else
                this._stopTimer();
        });
        this._startTimer();
    }

    _startTimer() {
        if (this._timerId)
            return;
        try {
            this._face.queue_repaint();
        } catch (_) {}
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            try {
                if (!this._face || this._face.is_finalized?.() || !this.get_stage()) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (this._face.is_mapped())
                    this._face.queue_repaint();
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

    setDarkText(dark) {
        if (this._darkText === dark)
            return;
        this._darkText = dark;
        this._face.queue_repaint();
    }

    // Dial numerals follow the widget text size (own key, then global;
    // base 15px).
    _numeralScale() {
        for (const key of ['clock-text-size', 'text-size']) {
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

    // Crisp resize: redraw the dial at real pixels instead of magnifying
    // a bitmap (which pixelates text). Geometry follows the allocated
    // face size; fixed pen widths scale explicitly.
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        try {
            this._face.set_size(Math.round(SIZE * s), Math.round(SIZE * s));
            this._face.queue_repaint();
        } catch (_) {
            // gone
        }
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            this._face.translation_x = this._settings.get_int('clock-face-x') || 0;
            this._face.translation_y = this._settings.get_int('clock-face-y') || 0;
        } catch (_) {
            // gone
        }
    }

    _draw() {
        // get_context() on an unmapped area segfaults: never touch it early.
        try {
            if (!this._face.is_mapped())
                return;
        } catch (_) {
            return;
        }
        const cr = this._face.get_context();
        const [sw, sh] = this._face.get_surface_size();
        const [aw, ah] = [this._face.width || SIZE, this._face.height || SIZE];
        if (sw <= 0 || sh <= 0)
            return;
        cr.save();
        cr.scale(sw / aw, sh / ah);

        const cx = aw / 2, cy = ah / 2;
        const k = this._cscale ?? 1;
        const R = Math.min(aw, ah) / 2 - 6;
        const ink = this._darkText ? [0.13, 0.13, 0.15] : [1, 1, 1];

        const now = GLib.DateTime.new_now_local();
        const h = now.get_hour() % 12 + now.get_minute() / 60;
        const m = now.get_minute() + now.get_second() / 60;
        const s = now.get_second();

        // Ticks.
        for (let i = 0; i < 60; i++) {
            const a = i * Math.PI / 30;
            const big = i % 5 === 0;
            const r1 = R - (big ? 10 : 5) * k;
            cr.setSourceRGBA(...ink, big ? 0.9 : 0.45);
            cr.setLineWidth((big ? 2.2 : 1.1) * k);
            cr.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
            cr.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
            cr.stroke();
        }

        // Numerals.
        cr.selectFontFace('SF Pro Display', 0, 1);
        cr.setFontSize(13 * this._numeralScale() * k);
        for (let n = 1; n <= 12; n++) {
            const a = n * Math.PI / 6;
            const txt = String(n);
            const ext = cr.textExtents(txt);
            cr.setSourceRGBA(...ink, 0.9);
            cr.moveTo(cx + Math.sin(a) * (R - 22 * k) - ext.width / 2,
                      cy - Math.cos(a) * (R - 22 * k) + ext.height / 2);
            cr.showText(txt);
        }

        const hand = (angle, len, width, color) => {
            cr.setSourceRGBA(...color);
            cr.setLineWidth(width);
            cr.setLineCap(1);
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(angle) * len, cy - Math.cos(angle) * len);
            cr.stroke();
        };
        hand(h * Math.PI / 6, R * 0.52, 4.5 * k, [...ink, 0.95]);
        hand(m * Math.PI / 30, R * 0.78, 3.0 * k, [...ink, 0.95]);
        hand(s * Math.PI / 30, R * 0.86, 1.2 * k, [1, 0.37, 0.34, 0.95]);

        cr.setSourceRGBA(...ink, 0.95);
        cr.arc(cx, cy, 3.2 * k, 0, 2 * Math.PI);
        cr.fill();

        cr.restore();
        cr.$dispose();
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

export const CLOCK_W = SIZE;
export const CLOCK_H = SIZE;
