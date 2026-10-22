// Date widget (macOS Tahoe): red weekday on top, huge day number.
// Content is centered inside the card.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

// GLib get_day_of_week(): Mon=1..Sun=7. Map to English names (Sun is index 7 % 7 = 0).
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY',
    'THURSDAY', 'FRIDAY', 'SATURDAY'];

export const DateWidget = GObject.registerClass({GTypeName: 'Tahoe_DateWidget_' + Math.floor(Math.random() * 10000000)},
class DateWidget extends St.Widget {
    _init({settings = null, darkText = false, ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-date',
            reactive: true,
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._day = new St.Label({
            style_class: 'tw-date-weekday',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._num = new St.Label({
            style_class: 'tw-date-num',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this.add_child(this._day);
        this.add_child(this._num);
        this.setDarkText(darkText);
        this._settings = settings;
        this._offsetsId = 0;
        if (settings) {
            try {
                this._applyOffsets();
                this._offsetsId = settings.connect('changed', (_s, key) => {
                    if (key === 'date-title-x' || key === 'date-title-y' ||
                        key === 'date-num-x' || key === 'date-num-y')
                        this._applyOffsets();
                });
            } catch (_) {
                // static settings
            }
        }
        this.connect('destroy', () => this.destroy());
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
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
        this._sync();
    }

    setDarkText(dark) {
        // Weekday stays macOS red (readable on both cards); the big
        // number needs dark ink on a light card.
        this._num.remove_style_class_name('tw-dark');
        if (dark)
            this._num.add_style_class_name('tw-dark');
    }

    _applyOffsets() {
        // Nudge texts without disturbing the layout.
        try {
            const tx = this._settings.get_int('date-title-x') || 0;
            const ty = this._settings.get_int('date-title-y') || 0;
            const nx = this._settings.get_int('date-num-x') || 0;
            const ny = this._settings.get_int('date-num-y') || 0;
            this._day.translation_x = tx;
            this._day.translation_y = ty;
            this._num.translation_x = nx;
            this._num.translation_y = ny;
        } catch (_) {
            // gone
        }
    }

    _sync() {
        try {
            const now = GLib.DateTime.new_now_local();
            this._day.text = WEEKDAYS[now.get_day_of_week() % 7];
            const d = now.get_day_of_month();
            if (d !== this._num.text)
                this._num.text = String(d);
        } catch (_) {
            // no clock
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        if (this._offsetsId && this._settings) {
            try {
                this._settings.disconnect(this._offsetsId);
            } catch (e) {
                // gone
            }
            this._offsetsId = 0;
        }
        super.destroy();
    }
});

export const DATE_W = 200;
export const DATE_H = 200;
