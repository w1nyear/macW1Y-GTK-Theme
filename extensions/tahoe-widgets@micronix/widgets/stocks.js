// Stocks widget (macOS Tahoe): index rows with price + day change.
// Free Stooq daily CSV, no API key. Always a near-black card.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';

const SYMBOLS = [
    {sym: '^dji', name: 'Dow Jones', sub: 'Dow Jones Industrial Aver…'},
    {sym: '^ndq', name: 'NASDAQ', sub: 'NASDAQ Composite'},
    {sym: '^nya', name: 'NYSE', sub: 'NYSE Composite'},
];

const OFFSET_KEYS = [
    'stocks-row0-x', 'stocks-row0-y',
    'stocks-row1-x', 'stocks-row1-y',
    'stocks-row2-x', 'stocks-row2-y',
];

function fmtPrice(v) {
    return v.toLocaleString('en-US', {maximumFractionDigits: v >= 1000 ? 0 : 2});
}

function parseCsv(text) {
    // Symbol,Date,Open,High,Low,Close,Volume per line, newest last
    const closes = {};
    for (const line of text.split('\n')) {
        const c = line.trim().split(',');
        if (c.length < 6)
            continue;
        const close = Number(c[5]);
        if (!Number.isFinite(close))
            continue;
        const sym = c[0].toLowerCase();
        if (!closes[sym])
            closes[sym] = [];
        closes[sym].push(close);
    }
    return closes;
}

export const StocksWidget = GObject.registerClass({GTypeName: 'Tahoe_StocksWidget_' + Math.floor(Math.random() * 10000000)},
class StocksWidget extends St.Widget {
    _init({settings = null, darkText = false, ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-stocks',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._rows = new St.BoxLayout({
            style_class: 'tw-stocks-rows',
            vertical: true,
            y_expand: true,
        });
        this.add_child(this._rows);
        this._settings = settings;
        this._offsetId = 0;
        for (const s of SYMBOLS) {
            const row = new St.BoxLayout({style_class: 'tw-stock-row'});
            const arrow = new St.Label({style_class: 'tw-stock-arrow', text: '▲'});
            const names = new St.BoxLayout({style_class: 'tw-stock-names', vertical: true, x_expand: true});
            const name = new St.Label({style_class: 'tw-stock-name', text: s.name});
            const sub = new St.Label({style_class: 'tw-stock-sub', text: s.sub});
            try {
                name.clutter_text.ellipsize = 3;
                sub.clutter_text.ellipsize = 3;
            } catch (_) {
                // no clutter text
            }
            names.add_child(name);
            names.add_child(sub);
            const nums = new St.BoxLayout({style_class: 'tw-stock-nums', vertical: true});
            const price = new St.Label({style_class: 'tw-stock-price', text: '—'});
            const pct = new St.Label({style_class: 'tw-stock-pct', text: ''});
            nums.add_child(price);
            nums.add_child(pct);
            row.add_child(arrow);
            row.add_child(names);
            row.add_child(nums);
            this._rows.add_child(row);
            s._row = row;
            s._arrow = arrow;
            s._price = price;
            s._pct = pct;
        }
        if (settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                });
            } catch (_) {
                // static settings
            }
        }
        this._session = new Soup.Session({timeout: 25});
        this._timerId = 0;
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

    setDarkText(_dark) {
        // always light ink on the black card
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            SYMBOLS.forEach((s, i) => {
                if (!s._row)
                    return;
                s._row.translation_x = this._settings.get_int(`stocks-row${i}-x`) || 0;
                s._row.translation_y = this._settings.get_int(`stocks-row${i}-y`) || 0;
            });
        } catch (_) {
            // gone
        }
    }

    refresh() {
        try {
            const url = 'https://stooq.com/q/d/l/?s='
                + SYMBOLS.map(s => encodeURIComponent(s.sym)).join(',')
                + '&i=d';
            const msg = Soup.Message.new('GET', url);
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
                (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);
                        const closes = parseCsv(new TextDecoder().decode(bytes.get_data()));
                        for (const s of SYMBOLS) {
                            const hist = closes[s.sym.toLowerCase()] ?? [];
                            if (hist.length < 2)
                                continue;
                            const last = hist[hist.length - 1];
                            const prev = hist[hist.length - 2];
                            const chg = (last - prev) / prev * 100;
                            const up = chg >= 0;
                            s._price.text = fmtPrice(last);
                            s._pct.text = `${up ? '+' : ''}${chg.toFixed(2)}%`;
                            s._arrow.text = up ? '▲' : '▼';
                            const col = up ? '#30d658' : '#ff453a';
                            s._arrow.set_style(`color: ${col};`);
                            s._pct.set_style(`color: ${col};`);
                        }
                    } catch (e) {
                        // offline, keep placeholders
                    }
                });
        } catch (e) {
            // no network
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

export const STOCKS_W = 300;
export const STOCKS_H = 200;
