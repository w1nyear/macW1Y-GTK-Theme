// Weather widget: Open-Meteo current temperature + condition + H/L.
// Condition glyphs are text-presentation emoji (monochrome by design).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';

const OFFSET_KEYS = [
    'weather-city-x', 'weather-city-y',
    'weather-temp-x', 'weather-temp-y',
    'weather-cond-x', 'weather-cond-y',
    'weather-hilow-x', 'weather-hilow-y',
    'weather-strip-x', 'weather-strip-y',
];

// U+FE0E forces text (single-tone) presentation.
const GLYPHS = [
    [0, 'Clear', '☀︎'],
    [1, 'Mostly Clear', '🌤︎'],
    [2, 'Partly Cloudy', '⛅︎'],
    [3, 'Overcast', '☁︎'],
    [45, 'Foggy', '☁︎'],
    [48, 'Icy Fog', '☁︎'],
    [51, 'Light Drizzle', '🌧︎'],
    [61, 'Rain', '🌧︎'],
    [71, 'Snow', '❄︎'],
    [80, 'Showers', '🌧︎'],
    [95, 'Thunderstorm', '⛈︎'],
];

function describe(code) {
    let best = GLYPHS[0];
    for (const g of GLYPHS) {
        if (code >= g[0])
            best = g;
    }
    return [best[1], best[2]];
}

export const WeatherWidget = GObject.registerClass({GTypeName: 'Tahoe_WeatherWidget_' + Math.floor(Math.random() * 10000000)},
class WeatherWidget extends St.Widget {
    _init({settings = null, darkText = false, variant = 'wide', ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-weather',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._settings = settings;
        this._darkText = darkText;

        this._city = new St.Label({style_class: 'tw-city'});
        this._tempRow = new St.BoxLayout({style_class: 'tw-temp-row'});
        this._temp = new St.Label({style_class: 'tw-temp', text: '—'});
        this._glyph = new St.Label({style_class: 'tw-glyph', text: '☁︎'});
        this._tempRow.add_child(this._temp);
        this._tempRow.add_child(this._glyph);
        this._cond = new St.Label({style_class: 'tw-cond', text: '…'});
        this._hilow = new St.Label({style_class: 'tw-hilow', text: ''});
        this._strip = new St.BoxLayout({style_class: 'tw-strip'});

        this.add_child(this._city);
        this.add_child(this._tempRow);
        this.add_child(this._cond);
        this.add_child(this._hilow);
        this.add_child(this._strip);

        this._session = new Soup.Session({timeout: 20});
        this._timerId = 0;
        this._variant = null;
        this.setVariant(variant);
        this._offsetId = 0;
        if (this._settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = this._settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                });
            } catch (_) {
                // static settings
            }
        }
        this.connect('destroy', () => this.destroy());
        this.refresh();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1800, () => {
            try {
                if (!this.get_stage()) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            } catch (_) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    // Wide: full card with the hourly strip. Square: compact card,
    // strip hidden, bigger type to fill it.
    setVariant(v) {
        if (v !== 'wide' && v !== 'square')
            v = 'wide';
        if (this._variant === v)
            return;
        this._variant = v;
        try {
            this._strip.visible = v !== 'square';
            this.remove_style_class_name('tw-square');
            if (v === 'square')
                this.add_style_class_name('tw-square');
        } catch (_) {
            // gone
        }
    }

    getVariantSize() {
        return this._variant === 'square' ? [230, 230] : [WEATHER_W, WEATHER_H];
    }

    // Crisp resize hook: strip cells take real pixels, fonts re-render.
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        if (this._lastHourly)
            this._fillStrip(this._lastHourly);
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            const get = k => {
                try {
                    return this._settings.get_int(k) || 0;
                } catch (_) {
                    return 0;
                }
            };
            this._city.translation_x = get('weather-city-x');
            this._city.translation_y = get('weather-city-y');
            this._tempRow.translation_x = get('weather-temp-x');
            this._tempRow.translation_y = get('weather-temp-y');
            this._cond.translation_x = get('weather-cond-x');
            this._cond.translation_y = get('weather-cond-y');
            this._hilow.translation_x = get('weather-hilow-x');
            this._hilow.translation_y = get('weather-hilow-y');
            this._strip.translation_x = get('weather-strip-x');
            this._strip.translation_y = get('weather-strip-y');
        } catch (_) {
            // gone
        }
    }

    setDarkText(dark) {
        this._darkText = dark;
        for (const child of [this._city, this._temp, this._glyph, this._cond, this._hilow]) {
            child.remove_style_class_name('tw-dark');
            if (dark)
                child.add_style_class_name('tw-dark');
        }
        // Hourly strip cells are rebuilt on refresh; fix up the live ones.
        try {
            for (const col of this._strip.get_children()) {
                for (const label of col.get_children()) {
                    try {
                        label.remove_style_class_name('tw-dark');
                        if (dark)
                            label.add_style_class_name('tw-dark');
                    } catch (_) {
                        // gone
                    }
                }
            }
        } catch (_) {
            // no strip
        }
    }

    _hourLabel(iso) {
        try {
            const h = Number(iso.slice(11, 13));
            if (h === 0)
                return '12 AM';
            if (h < 12)
                return `${h} AM`;
            if (h === 12)
                return '12 PM';
            return `${h - 12} PM`;
        } catch (_) {
            return '';
        }
    }

    _fillStrip(hourly) {
        try {
            this._strip.destroy_all_children();
            const times = hourly.time ?? [];
            const temps = hourly.temperature_2m ?? [];
            const codes = hourly.weather_code ?? [];
            const nowKey = GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:00');
            let start = times.indexOf(nowKey);
            if (start < 0)
                start = 0;
            for (let k = 0; k < 6; k++) {
                const i = start + k;
                if (i >= times.length)
                    break;
                const t = Math.round(temps[i] ?? NaN);
                const [, glyph] = describe(codes[i] ?? 3);
                const col = new St.BoxLayout({style_class: 'tw-hcell', vertical: true});
                const cs = this._cscale ?? 1;
                if (cs !== 1) {
                    try {
                        col.set_style(`min-width: ${Math.round(62 * cs)}px;`);
                    } catch (_) {
                        // CSS width stays
                    }
                }
                const dk = this._darkText ? ' tw-dark' : '';
                const hh = new St.Label({style_class: 'tw-hh' + dk, text: this._hourLabel(times[i] ?? '')});
                const hg = new St.Label({style_class: 'tw-hg' + dk, text: glyph});
                const ht = new St.Label({style_class: 'tw-ht' + dk, text: Number.isFinite(t) ? `${t}°` : '—'});
                col.add_child(hh);
                col.add_child(hg);
                col.add_child(ht);
                this._strip.add_child(col);
            }
        } catch (_) {
            // no hourly data
        }
    }

    refresh() {
        try {
            const city = this._settings?.get_string('city') || 'Moscow';
            const lat = this._settings?.get_double('latitude') ?? 55.75;
            const lon = this._settings?.get_double('longitude') ?? 37.61;
            this._city.text = city;

            const url = 'https://api.open-meteo.com/v1/forecast' +
                `?latitude=${lat}&longitude=${lon}` +
                '&current=temperature_2m,weather_code' +
                '&hourly=temperature_2m,weather_code' +
                '&daily=temperature_2m_max,temperature_2m_min&forecast_days=1' +
                '&timezone=auto';
            const msg = Soup.Message.new('GET', url);
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
                (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);
                        const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        const cur = data?.current ?? {};
                        const daily = data?.daily ?? {};
                        const t = Math.round(cur.temperature_2m ?? NaN);
                        this._temp.text = Number.isFinite(t) ? `${t}°` : '—';
                        const [label, glyph] = describe(cur.weather_code ?? 3);
                        this._cond.text = label;
                        this._glyph.text = glyph;
                        const hi = Math.round(daily.temperature_2m_max?.[0] ?? NaN);
                        const lo = Math.round(daily.temperature_2m_min?.[0] ?? NaN);
                        this._hilow.text = Number.isFinite(hi) && Number.isFinite(lo)
                            ? `H:${hi}° L:${lo}°` : '';
                        this._lastHourly = data?.hourly ?? null;
                        this._fillStrip(data?.hourly ?? {});
                    } catch (e) {
                        this._cond.text = 'Offline';
                    }
                });
        } catch (e) {
            this._cond.text = 'Offline';
        }
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
        try {
            this._session?.abort();
        } catch (e) {
            // ignore
        }
        this._session = null;
        super.destroy();
    }
});

export const WEATHER_W = 460;
export const WEATHER_H = 210;
