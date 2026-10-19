// Reminders widget (macOS Tahoe): local checklist, circles toggle done.
// Items live in the `reminders` strv as "title|0" / "title|1".

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const OFFSET_KEYS = [
    'reminders-head-x', 'reminders-head-y',
    'reminders-list-x', 'reminders-list-y',
];

export const RemindersWidget = GObject.registerClass(
class RemindersWidget extends St.Widget {
    _init({settings = null, darkText = false, ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-reminders',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._settings = settings;
        this._darkText = darkText;
        this._headRow = new St.BoxLayout({style_class: 'tw-rem-head'});
        this._title = new St.Label({style_class: 'tw-rem-title', text: 'Reminders'});
        this._count = new St.Label({style_class: 'tw-rem-count', text: ''});
        this._headRow.add_child(this._title);
        const hsp = new St.BoxLayout({x_expand: true});
        this._headRow.add_child(hsp);
        this._headRow.add_child(this._count);
        this.add_child(this._headRow);
        this._list = new St.BoxLayout({
            style_class: 'tw-rem-list',
            vertical: true,
            y_expand: true,
        });
        this.add_child(this._list);
        this._changedId = 0;
        this._offsetId = 0;
        this.connect('destroy', () => this.destroy());
        if (settings) {
            try {
                this._changedId = settings.connect('changed::reminders', () => this._rebuild());
            } catch (_) {
                // static
            }
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
        this._rebuild();
    }

    setDarkText(dark) {
        this._darkText = dark;
        for (const child of [this._title, this._count]) {
            child.remove_style_class_name('tw-dark');
            if (dark)
                child.add_style_class_name('tw-dark');
        }
        this._rebuild();
    }

    // Crisp resize hook: dots take real pixels (border stays vector).
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        this._rebuild();
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            this._headRow.translation_x = this._settings.get_int('reminders-head-x') || 0;
            this._headRow.translation_y = this._settings.get_int('reminders-head-y') || 0;
            this._list.translation_x = this._settings.get_int('reminders-list-x') || 0;
            this._list.translation_y = this._settings.get_int('reminders-list-y') || 0;
        } catch (_) {
            // gone
        }
    }

    _items() {
        try {
            const raw = this._settings?.get_strv('reminders') ?? [];
            return raw.map(s => {
                const i = s.lastIndexOf('|');
                if (i < 0)
                    return {title: s, done: false};
                return {title: s.slice(0, i), done: s.slice(i + 1) === '1'};
            }).filter(it => it.title.trim() !== '');
        } catch (_) {
            return [];
        }
    }

    _save(items) {
        try {
            this._settings?.set_strv('reminders',
                items.map(it => `${it.title}|${it.done ? '1' : '0'}`));
        } catch (_) {
            // read-only settings
        }
    }

    _rebuild() {
        try {
            this._list.destroy_all_children();
            const items = this._items();
            const open = items.filter(i => !i.done).length;
            this._count.text = items.length ? String(open || items.length) : '';
            if (!items.length) {
                const l = new St.Label({
                    style_class: 'tw-rem-empty' + (this._darkText ? ' tw-dark' : ''),
                    text: 'No Reminders',
                });
                this._list.add_child(l);
                return;
            }
            items.forEach((it, idx) => {
                const row = new St.BoxLayout({style_class: 'tw-rem-row'});
                const dot = new St.Button({style_class: 'tw-rem-dot' + (it.done ? ' tw-rem-done-dot' : '')});
                const ds = this._cscale ?? 1;
                if (ds !== 1) {
                    try {
                        const px = Math.round(20 * ds);
                        dot.set_style(`width: ${px}px; height: ${px}px;`);
                    } catch (_) {
                        // CSS size stays
                    }
                }
                const glyph = new St.Label({style_class: 'tw-rem-check', text: it.done ? '✓' : ''});
                dot.set_child(glyph);
                dot.connect('clicked', () => {
                    const cur = this._items();
                    if (cur[idx]) {
                        cur[idx].done = !cur[idx].done;
                        this._save(cur);
                    }
                });
                const label = new St.Label({
                    style_class: 'tw-rem-item'
                        + (it.done ? ' tw-rem-done' : '')
                        + (this._darkText ? ' tw-dark' : ''),
                    text: it.title,
                    x_expand: true,
                });
                try {
                    label.clutter_text.ellipsize = 3;
                } catch (_) {
                    // no clutter text
                }
                row.add_child(dot);
                row.add_child(label);
                this._list.add_child(row);
            });
        } catch (_) {
            // gone
        }
    }

    destroy() {
        if (this._changedId && this._settings) {
            try {
                this._settings.disconnect(this._changedId);
            } catch (_) {
                // gone
            }
            this._changedId = 0;
        }
        if (this._offsetId && this._settings) {
            try {
                this._settings.disconnect(this._offsetId);
            } catch (_) {
                // gone
            }
            this._offsetId = 0;
        }
        super.destroy();
    }
});

export const REMINDERS_W = 250;
export const REMINDERS_H = 200;
