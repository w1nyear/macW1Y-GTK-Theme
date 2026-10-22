// Weather widget: Open-Meteo current temperature + condition + H/L.
// City label is clickable → Nominatim geocode search popup (all languages,
// including Ukrainian villages). Weather data: Open-Meteo for all locations.
// Condition glyphs are text-presentation emoji (monochrome by design).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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

// ─── City-search popup ────────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA  = 'MacTahoeWeather/1.0 (GNOME-Shell widget)';

function _nominatimSearch(session, query, callback) {
    const encoded = encodeURIComponent(query.trim());
    const url = `${NOMINATIM_URL}?q=${encoded}&format=json&addressdetails=1&limit=6&accept-language=uk,en`;
    const msg = Soup.Message.new('GET', url);
    try {
        msg.request_headers.append('User-Agent', NOMINATIM_UA);
    } catch (_) {}
    session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
        try {
            const bytes = sess.send_and_read_finish(res);
            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            callback(null, Array.isArray(data) ? data : []);
        } catch (e) {
            callback(e, []);
        }
    });
}

// ─── Widget class ────────────────────────────────────────────────────────────

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
        this._searchPopup = null;
        this._searchClickId = 0;

        // City label — reactive so user can click to change city.
        this._city = new St.Label({
            style_class: 'tw-city tw-city-clickable',
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        // Temperature row (temp + glyph icon) — centered.
        this._tempRow = new St.BoxLayout({
            style_class: 'tw-temp-row',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._temp  = new St.Label({style_class: 'tw-temp',  text: '—'});
        this._glyph = new St.Label({style_class: 'tw-glyph', text: '☁︎'});
        this._tempRow.add_child(this._temp);
        this._tempRow.add_child(this._glyph);

        this._cond  = new St.Label({
            style_class: 'tw-cond',
            text: '…',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._hilow = new St.Label({
            style_class: 'tw-hilow',
            text: '',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._strip = new St.BoxLayout({
            style_class: 'tw-strip',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        this.add_child(this._city);
        this.add_child(this._tempRow);
        this.add_child(this._cond);
        this.add_child(this._hilow);
        this.add_child(this._strip);

        // City click → open search popup.
        this._city.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this._toggleSearch();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

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

    // ── variant / size ────────────────────────────────────────────────────────

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

    // ── offsets ───────────────────────────────────────────────────────────────

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
            this._city.translation_x    = get('weather-city-x');
            this._city.translation_y    = get('weather-city-y');
            this._tempRow.translation_x = get('weather-temp-x');
            this._tempRow.translation_y = get('weather-temp-y');
            this._cond.translation_x    = get('weather-cond-x');
            this._cond.translation_y    = get('weather-cond-y');
            this._hilow.translation_x   = get('weather-hilow-x');
            this._hilow.translation_y   = get('weather-hilow-y');
            this._strip.translation_x   = get('weather-strip-x');
            this._strip.translation_y   = get('weather-strip-y');
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

    // ── hourly strip ──────────────────────────────────────────────────────────

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

    // ── weather fetch ─────────────────────────────────────────────────────────

    refresh() {
        try {
            const city = this._settings?.get_string('city') || 'Kyiv';
            const lat  = this._settings?.get_double('latitude')  ?? 50.45;
            const lon  = this._settings?.get_double('longitude') ?? 30.52;
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
                        const cur   = data?.current ?? {};
                        const daily = data?.daily   ?? {};
                        const t = Math.round(cur.temperature_2m ?? NaN);
                        this._temp.text = Number.isFinite(t) ? `${t}°` : '—';
                        const [label, glyph] = describe(cur.weather_code ?? 3);
                        this._cond.text  = label;
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

    // ── City search popup ─────────────────────────────────────────────────────

    _toggleSearch() {
        if (this._searchPopup) {
            this._closeSearch();
        } else {
            this._openSearch();
        }
    }

    _openSearch() {
        this._closeSearch(); // guard against double-open

        // ── Build popup ────────────────────────────────────────────────────────
        const popup = new St.BoxLayout({
            style_class: 'tw-search-popup',
            vertical: true,
            reactive: true,
            can_focus: true,
        });

        // Title row
        const titleRow = new St.BoxLayout({style_class: 'tw-search-titlerow'});
        const titleLbl = new St.Label({
            style_class: 'tw-search-title',
            text: '🔍  Місто / село',
            x_expand: true,
        });
        const closeBtn = new St.Button({
            style_class: 'tw-search-close',
            label: '✕',
            reactive: true,
        });
        closeBtn.connect('clicked', () => this._closeSearch());
        titleRow.add_child(titleLbl);
        titleRow.add_child(closeBtn);
        popup.add_child(titleRow);

        // Search entry
        const entry = new St.Entry({
            style_class: 'tw-search-entry',
            hint_text: 'Введіть місто, село або район…',
            can_focus: true,
            x_expand: true,
        });
        popup.add_child(entry);

        // Search button row
        const btnRow = new St.BoxLayout({style_class: 'tw-search-btnrow'});
        const searchBtn = new St.Button({
            style_class: 'tw-search-btn',
            label: 'Пошук',
            reactive: true,
            x_expand: true,
        });
        btnRow.add_child(searchBtn);
        popup.add_child(btnRow);

        // Results scroll area
        const resultsBox = new St.BoxLayout({
            style_class: 'tw-search-results',
            vertical: true,
        });
        popup.add_child(resultsBox);

        const doSearch = () => {
            const q = entry.get_text().trim();
            if (!q) return;
            // Show loading indicator
            resultsBox.destroy_all_children();
            const loading = new St.Label({
                style_class: 'tw-search-loading',
                text: '⏳  Пошук…',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            resultsBox.add_child(loading);

            _nominatimSearch(this._session, q, (err, results) => {
                resultsBox.destroy_all_children();
                if (err || !results.length) {
                    resultsBox.add_child(new St.Label({
                        style_class: 'tw-search-noresult',
                        text: err ? `Помилка мережі` : 'Нічого не знайдено',
                        x_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                    }));
                    return;
                }

                for (const item of results) {
                    const countryCode = (item.address?.country_code || '').toLowerCase();
                    const shortName =
                        item.address?.city        ||
                        item.address?.town        ||
                        item.address?.village     ||
                        item.address?.hamlet      ||
                        item.address?.suburb      ||
                        item.name                 ||
                        item.display_name.split(',')[0];
                    const region =
                        item.address?.state       ||
                        item.address?.county      ||
                        item.address?.country     ||
                        '';
                    const flag = _countryFlag(countryCode);
                    const displayLine = `${flag}  ${shortName}${region ? ', ' + region : ''}`;

                    const lat = parseFloat(item.lat);
                    const lon = parseFloat(item.lon);

                    const row = new St.Button({
                        style_class: 'tw-search-result-item',
                        reactive: true,
                        can_focus: true,
                        x_expand: true,
                    });
                    const lbl = new St.Label({
                        style_class: 'tw-search-result-label',
                        text: displayLine.length > 68 ? displayLine.slice(0, 65) + '…' : displayLine,
                        x_expand: true,
                    });
                    row.add_child(lbl);
                    row.connect('clicked', () => {
                        try {
                            this._settings?.set_string('city', shortName);
                            this._settings?.set_double('latitude', lat);
                            this._settings?.set_double('longitude', lon);
                        } catch (_) {}
                        this._closeSearch();
                        this.refresh();
                    });
                    resultsBox.add_child(row);
                }
            });
        };

        searchBtn.connect('clicked', doSearch);
        entry.clutter_text.connect('activate', doSearch);

        // Escape closes
        popup.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeSearch();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // ── Position near the weather widget ──────────────────────────────────
        try {
            const [ax, ay] = this._city.get_transformed_position();
            const monitor   = Main.layoutManager.primaryMonitor;
            const popW      = 340;
            let   px        = Math.round(ax);
            let   py        = Math.round(ay) + 32;
            if (px + popW > monitor.x + monitor.width)
                px = monitor.x + monitor.width - popW - 8;
            if (px < monitor.x + 8)
                px = monitor.x + 8;
            popup.set_position(px, py);
            popup.set_width(popW);
        } catch (_) {
            popup.set_position(100, 100);
            popup.set_width(340);
        }

        Main.layoutManager.uiGroup.add_child(popup);
        this._searchPopup = popup;

        // Focus after adding to stage
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            try { entry.grab_key_focus(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });

        // Click outside to close
        this._searchClickId = global.stage.connect('button-press-event', (_stage, ev) => {
            try {
                const src = ev.get_source?.() ?? null;
                if (popup && !popup.contains(src))
                    this._closeSearch();
            } catch (_) {
                this._closeSearch();
            }
        });
    }

    _closeSearch() {
        if (this._searchClickId) {
            try { global.stage.disconnect(this._searchClickId); } catch (_) {}
            this._searchClickId = 0;
        }
        if (this._searchPopup) {
            try { this._searchPopup.destroy(); } catch (_) {}
            this._searchPopup = null;
        }
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    destroy() {
        this._closeSearch();
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

// ─── Country flag helper ──────────────────────────────────────────────────────

function _countryFlag(code) {
    if (!code || code.length !== 2) return '🌍';
    try {
        const cp1 = 0x1F1E6 + (code.toUpperCase().charCodeAt(0) - 65);
        const cp2 = 0x1F1E6 + (code.toUpperCase().charCodeAt(1) - 65);
        return String.fromCodePoint(cp1, cp2);
    } catch (_) {
        return '🌍';
    }
}

export const WEATHER_W = 460;
export const WEATHER_H = 210;
