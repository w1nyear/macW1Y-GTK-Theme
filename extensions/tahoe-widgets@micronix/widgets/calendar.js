// Month calendar widget: St grid, today circled. Rebuilds when the day
// flips (checked once a minute).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const OFFSET_KEYS = [
    'calendar-title-x', 'calendar-title-y',
    'calendar-grid-x', 'calendar-grid-y',
];

const CELL_KEYS = ['calendar-cell-w', 'calendar-cell-h'];

export const CalendarWidget = GObject.registerClass(
class CalendarWidget extends St.Widget {
    _init({settings = null, darkText = false, variant = 'wide', ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-calendar',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._darkText = darkText;
        this._day = -1;
        this._grid = null;
        this._settings = settings;
        this._offsetId = 0;
        this._title = new St.Label({style_class: 'tw-cal-title'});
        this.add_child(this._title);

        this.connect('destroy', () => this.destroy());
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            try {
                if (!this.get_stage()) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._maybeRebuild();
                return GLib.SOURCE_CONTINUE;
            } catch (_) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
        });
        this._variant = null;
        this.setVariant(variant);
        if (settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                    if (CELL_KEYS.includes(key))
                        this._maybeRebuild(true);
                });
            } catch (_) {
                // static settings
            }
        }
    }

    setDarkText(dark) {
        this._darkText = dark;
        this._title.remove_style_class_name('tw-dark');
        if (dark)
            this._title.add_style_class_name('tw-dark');
        this._maybeRebuild(true);
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            this._title.translation_x = this._settings.get_int('calendar-title-x') || 0;
            this._title.translation_y = this._settings.get_int('calendar-title-y') || 0;
            if (this._grid) {
                this._grid.translation_x = this._settings.get_int('calendar-grid-x') || 0;
                this._grid.translation_y = this._settings.get_int('calendar-grid-y') || 0;
            }
        } catch (_) {
            // gone
        }
    }

    // Wide template: roomier day cells. Square: compact grid.
    setVariant(v) {
        if (v !== 'wide' && v !== 'square')
            v = 'wide';
        if (this._variant === v)
            return;
        this._variant = v;
        try {
            this.remove_style_class_name('cal-wide');
            if (v === 'wide')
                this.add_style_class_name('cal-wide');
        } catch (_) {
            // gone
        }
        this._maybeRebuild(true);
    }

    getVariantSize() {
        // Conservative estimate (always >= real paint) so the fit-scale
        // never lets rows spill outside the card.
        let cw = this._variant === 'wide' ? 52 : 24;
        let ch = 24;
        try {
            const sw = this._settings?.get_int('calendar-cell-w');
            if (Number.isFinite(sw) && sw > 0)
                cw = sw;
            const sh = this._settings?.get_int('calendar-cell-h');
            if (Number.isFinite(sh) && sh > 0)
                ch = sh;
        } catch (_) {
            // defaults stay
        }
        return [7 * cw + 64, 110 + 6 * ch];
    }

    // Custom cell size wins via inline style; at defaults the stylesheet
    // rules apply (compact grid, roomy wide cells). Everything scales
    // with the content scale so resizing stays crisp.
    _cellSizeStyle() {
        const s = this._cscale ?? 1;
        let custom = false, w = 24, h = 24;
        try {
            const sw = this._settings?.get_int('calendar-cell-w');
            if (Number.isFinite(sw) && sw !== 24) {
                w = sw;
                custom = true;
            }
            const sh = this._settings?.get_int('calendar-cell-h');
            if (Number.isFinite(sh) && sh !== 24) {
                h = sh;
                custom = true;
            }
        } catch (_) {
            // stylesheet stays
        }
        if (!custom && this._variant !== 'wide' && s === 1)
            return '';
        const baseW = custom ? w : (this._variant === 'wide' ? 52 : 24);
        const baseH = custom ? h : 24;
        return `min-width: ${Math.round(baseW * s)}px; min-height: ${Math.round(baseH * s)}px;`;
    }

    // Crisp resize hook (see extension): bigger cells, vector re-render.
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        this._maybeRebuild(true);
    }

    _maybeRebuild(force = false) {
        const day = GLib.DateTime.new_now_local().get_day_of_month();
        if (force || day !== this._day)
            this._build();
    }

    _build() {
        const now = GLib.DateTime.new_now_local();
        const year = now.get_year();
        const month = now.get_month();
        const today = now.get_day_of_month();
        this._day = today;

        this._title.text = MONTHS[month - 1].toUpperCase();
        if (this._darkText)
            this._title.add_style_class_name('tw-dark');

        if (this._grid)
            this._grid.destroy();
        const grid = new St.Widget({
            style_class: 'tw-cal-grid',
            layout_manager: new Clutter.GridLayout(),
        });
        this.add_child(grid);
        this._grid = grid;
        const lm = grid.layout_manager;

        const first = GLib.DateTime.new_local(year, month, 1, 0, 0, 0);
        // GLib: Sunday=7; US columns start Sunday.
        const lead = first.get_day_of_week() % 7;
        const nextMonth = month === 12
            ? GLib.DateTime.new_local(year + 1, 1, 1, 0, 0, 0)
            : GLib.DateTime.new_local(year, month + 1, 1, 0, 0, 0);
        const days = nextMonth.add_days(-1).get_day_of_month();

        WEEKDAYS.forEach((wd, col) => {
            const l = new St.Label({
                style_class: 'tw-cal-dow' + (this._darkText ? ' tw-dark' : ''),
                text: wd,
            });
            const cs = this._cellSizeStyle();
            if (cs)
                l.set_style(cs);
            lm.attach(l, col, 0, 1, 1);
        });

        for (let d = 1; d <= days; d++) {
            const cell = d - 1 + lead;
            const col = cell % 7;
            const row = 1 + Math.floor(cell / 7);
            const l = new St.Label({
                style_class: 'tw-cal-day'
                    + (d === today ? ' tw-cal-today' : '')
                    + (this._darkText ? ' tw-dark' : ''),
                text: String(d),
            });
            const cs = this._cellSizeStyle();
            if (cs)
                l.set_style(cs);
            lm.attach(l, col, row, 1, 1);
        }
        this._applyTextOffsets();
    }

    destroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
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

export const CALENDAR_W = 230;
export const CALENDAR_H = 260;
