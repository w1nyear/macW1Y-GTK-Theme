// Spotlight: Applications browse view, an embedded port of kiwi's Tahoe
// Applications (Launchpad) window (kiwi@kemma/apps/tahoeApps.js). Same
// structure, same tahoe-* style classes and metrics, adapted to live inside
// the Spotlight panel instead of a fullscreen overlay: no overlay, no
// modal grab, no keybinding hijack, no glass of its own (the panel behind
// already refracts). Closing and launching report back through callbacks.
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Mirrors kiwi's buckets, order and column math exactly.
const CATEGORIES = [
    {title: 'Social', match: ['Network']},
    {title: 'Creativity', match: ['Graphics', 'AudioVideo', 'Audio', 'Video']},
    {title: 'Productivity & Finance', match: ['Office']},
    {title: 'Utilities', match: ['Utility', 'System', 'Settings', 'Development', 'Science']},
    {title: 'Other', match: null},
];

const ITEM_W = 88;
const ROW_GAP = 8;
const COL_GAP = 1;
const CONTENT_PAD = 22;
const APP_ICON_SIZE = 64;
const HEADER_ICON_SIZE = 24;

const _normCache = new Map();
const NORM_LOAD_PX = 192;

function _normPixbufForGicon(gicon) {
    try {
        if (gicon instanceof Gio.FileIcon) {
            const path = gicon.get_file()?.get_path?.();
            if (!path)
                return null;
            return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, NORM_LOAD_PX, NORM_LOAD_PX, true);
        }
        if (gicon instanceof Gio.ThemedIcon) {
            const names = gicon.get_names?.() ?? [];
            let display = null;
            try {
                display = Gdk.Display.get_default();
            } catch (_) {
                display = null;
            }
            if (!display)
                return null;
            const theme = Gtk.IconTheme.get_for_display(display);
            for (const name of names) {
                if (typeof name !== 'string' || name.endsWith('-symbolic'))
                    continue;
                try {
                    const paintable = theme.lookup_icon(name, null, NORM_LOAD_PX, 1,
                        Gtk.TextDirection.NONE, Gtk.IconLookupFlags.FORCE_SIZE);
                    const file = paintable?.get_file?.();
                    const path = file?.get_path?.();
                    if (path)
                        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, NORM_LOAD_PX, NORM_LOAD_PX, true);
                } catch (_) {
                    // next name
                }
            }
            return null;
        }
    } catch (_) {
        // unresolvable
    }
    return null;
}

// Uniform visual icon size, whitespace ignored: resolves the app GIcon to
// a pixbuf, trims transparent padding, scales the CONTENT (not the canvas)
// so its longest side equals iconSize, and centers it. Anything
// unresolvable returns null and the caller falls back to stock textures.
function _normalizedAppIcon(gicon, iconSize) {
    try {
        if (!gicon || !(iconSize > 0))
            return null;
        const key = `${gicon.to_string()}@${iconSize}`;
        let bytesIcon = _normCache.get(key) ?? null;
        if (!bytesIcon) {
            if (_normCache.size > 300)
                _normCache.clear();
            const src = _normPixbufForGicon(gicon);
            if (!src)
                return null;
            const w = src.get_width(), h = src.get_height();
            const px = src.get_pixels();
            const rs = src.get_rowstride(), nch = src.get_n_channels();
            if (!px || w <= 0 || h <= 0)
                return null;
            let x0 = w, y0 = h, x1 = -1, y1 = -1;
            const step = 2;
            for (let yy = 0; yy < h; yy += step) {
                for (let xx = 0; xx < w; xx += step) {
                    const o = yy * rs + xx * nch;
                    const a = nch >= 4 ? px[o + 3] : 255;
                    if (a > 16) {
                        if (xx < x0) x0 = xx;
                        if (xx > x1) x1 = xx;
                        if (yy < y0) y0 = yy;
                        if (yy > y1) y1 = yy;
                    }
                }
            }
            if (x1 < x0 || y1 < y0)
                return null;
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            const scale = iconSize / Math.max(bw, bh);
            const dw = Math.max(1, Math.round(bw * scale));
            const dh = Math.max(1, Math.round(bh * scale));
            const crop = GdkPixbuf.Pixbuf.new_subpixbuf(src, x0, y0, bw, bh);
            const scaled = crop.scale_simple(dw, dh, GdkPixbuf.InterpType.BILINEAR);
            const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, iconSize, iconSize);
            canvas.fill(0x00000000);
            scaled.copy_area(0, 0, dw, dh, canvas,
                Math.round((iconSize - dw) / 2), Math.round((iconSize - dh) / 2));
            const [ok, bytes] = canvas.save_to_bufferv('png', [], []);
            if (!ok || !bytes)
                return null;
            bytesIcon = Gio.BytesIcon.new(GLib.Bytes.new(bytes));
            _normCache.set(key, bytesIcon);
        }
        return new St.Icon({gicon: bytesIcon, icon_size: iconSize});
    } catch (_) {
        return null;
    }
}

export const AppsView = GObject.registerClass(
class AppsView extends St.BoxLayout {
    // Positional callbacks: a plain props object would be mistaken for
    // GObject construct properties and throw on the unknown keys.
    // onDone runs after an app launches (popup closes itself there),
    // onHide only leaves the view (back button, Escape).
    _init(onDone, onHide) {
        super._init({
            style_class: 'spotlight-apps',
            vertical: true,
            x_expand: true,
            visible: false,
        });
        this._onDone = onDone;
        this._onHide = onHide;
        this._dark = true;
        this._pills = [];
        this._sections = [];
        this._rows = [];
        this._items = [];
        this._recents = [];
        this._records = [];
        this._menu = null;
        this._showSystem = false;
        this._groupByCategory = true;
        this._vadjConn = 0;

        const header = new St.BoxLayout({style_class: 'tahoe-header'});
        header.set_style('spacing: 12px; padding: 4px 20px 2px 20px;');
        header.add_child(this._makeHeaderIcon());

        const entry = new St.Entry({
            style_class: 'tahoe-search',
            hint_text: 'Приложения',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        entry.clutter_text.connect('text-changed', () => this._applyFilter());
        entry.clutter_text.connect('activate', () => this._launchFirstVisible());
        entry.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        header.add_child(entry);
        this._entry = entry;

        const moreBtn = new St.Button({
            style_class: 'tahoe-more',
            label: '…',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: false,
            track_hover: true,
        });
        moreBtn.connect('clicked', () => this._toggleMenu(moreBtn));
        header.add_child(moreBtn);
        this.add_child(header);

        this.add_child(this._makeDivider());

        const pillsBox = new St.BoxLayout({
            style_class: 'tahoe-pills',
            x_expand: true,
        });
        pillsBox.set_style('spacing: 8px; padding: 6px 20px 10px 20px;');
        for (const cat of CATEGORIES) {
            const pill = new St.Button({
                style_class: 'tahoe-pill',
                label: cat.title,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                can_focus: false,
                track_hover: true,
            });
            const pillLabel = pill.get_child();
            if (pillLabel instanceof St.Label) {
                pillLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                pillLabel.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            }
            pill.connect('button-press-event', () => {
                this._jumpToCategory(cat.title);
                return Clutter.EVENT_STOP;
            });
            pillsBox.add_child(pill);
            this._pills.push({btn: pill, title: cat.title});
        }
        this.add_child(pillsBox);

        this.add_child(this._makeDivider());

        const content = new St.BoxLayout({
            style_class: 'tahoe-content',
            vertical: true,
            x_expand: true,
        });
        content.set_style(`spacing: 4px; padding: 4px ${CONTENT_PAD}px 0 ${CONTENT_PAD}px;`);
        const scroll = new St.ScrollView({
            style_class: 'tahoe-scroll',
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_mouse_scrolling: true,
            child: content,
        });
        this.add_child(scroll);
        this._scroll = scroll;
        this._content = content;
        try {
            this._vadjConn = scroll.vadjustment.connect('notify::value',
                () => this._updateActivePill());
        } catch (_) {
            this._vadjConn = 0;
        }

        this._empty = new St.Label({
            style_class: 'tahoe-empty',
            text: 'No applications found',
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        content.add_child(this._empty);
    }

    // ------------------------------------------------------------------ show

    setDark(dark) {
        this._dark = !!dark;
        if (dark)
            this.add_style_class_name('tahoe-dark');
        else
            this.remove_style_class_name('tahoe-dark');
    }

    // (Re)builds from the installed apps and shows the view. availWidth is
    // the grid width in px; columns adapt to it like kiwi does.
    showView(availWidth, dark) {
        this.setDark(dark);
        const w = Number.isFinite(availWidth) && availWidth > 0
            ? availWidth : 372;
        this._availWidth = w;
        this._entry.clutter_text.set_text('');
        this._collect();
        this._loadRecents();
        this._rebuildGrid();
        const firstCat = this._sections.find(s => s.title !== 'Recommended');
        if (firstCat)
            this._setActivePill(firstCat.title);
        this.show();
        this._entry.grab_key_focus();
    }

    hideView() {
        this._closeMenu();
        this.hide();
    }

    _hide() {
        try {
            this._onHide();
        } catch (_) {
            // popup gone
        }
    }

    // -------------------------------------------------------------- app data

    _collect() {
        const system = Shell.AppSystem.get_default();
        const records = [];

        for (const item of system.get_installed()) {
            try {
                const info = typeof item.get_app_info === 'function'
                    ? item.get_app_info()
                    : item;
                if (!info)
                    continue;

                const id = info.get_id?.();
                if (!id)
                    continue;

                // Tahoe: Finder and the Launchpad stub are not apps.
                if (id === 'org.gnome.Nautilus.desktop' ||
                    id === 'org.gnome.Shell.Extensions.Kiwi.Launchpad.desktop')
                    continue;

                if (!this._showSystem && typeof info.should_show === 'function' &&
                    !info.should_show())
                    continue;

                const name = info.get_display_name?.() ||
                    info.get_name?.() || id;
                const cats = (info.get_categories?.() || '')
                    .split(';')
                    .filter(c => c.length > 0);

                const app = typeof item.create_icon_texture === 'function'
                    ? item
                    : system.lookup_app(id);

                records.push({
                    id,
                    name,
                    lower: name.toLowerCase(),
                    cats,
                    info,
                    app,
                    category: this._categoryOf(cats),
                });
            } catch (_) {
                // Skip entries with invalid metadata (e.g. bad encodings).
            }
        }

        records.sort((a, b) => a.name.localeCompare(b.name));
        this._records = records;
    }

    _categoryOf(cats) {
        for (const cat of CATEGORIES) {
            if (!cat.match)
                continue;
            if (cat.match.some(c => cats.includes(c)))
                return cat.title;
        }
        return 'Other';
    }

    // ------------------------------------------------------------------- grid

    _rebuildGrid() {
        const content = this._content;
        if (!content)
            return;

        for (const section of this._sections) {
            section.actor.destroy();
            section.divider?.destroy();
        }
        this._sections = [];
        this._rows = [];
        this._items = [];

        const gap = COL_GAP;
        const avail = this._availWidth ?? 372;
        const cols = Math.min(7, Math.max(1,
            Math.floor((avail + gap) / (ITEM_W + gap))));
        this._columns = cols;
        const itemW = Math.floor((avail - gap * (cols - 1)) / cols);

        let groups;
        if (this._groupByCategory) {
            groups = CATEGORIES.map(cat => ({
                title: cat.title,
                records: this._records.filter(r => r.category === cat.title),
            })).filter(g => g.records.length > 0);
        } else {
            groups = [{title: null, records: this._records}];
        }

        // Recommended: the most recently launched apps, one row, on top.
        if (this._groupByCategory && this._recents.length) {
            const seen = new Set();
            const recentRecords = [];
            for (const id of this._recents) {
                const rec = this._records.find(r => r.id === id);
                if (rec && !seen.has(rec)) {
                    seen.add(rec);
                    recentRecords.push(rec);
                }
                if (recentRecords.length >= cols)
                    break;
            }
            if (recentRecords.length)
                groups.unshift({title: 'Recommended', records: recentRecords});
        }

        for (const group of groups) {
            const section = new St.BoxLayout({
                style_class: 'tahoe-section',
                vertical: true,
                x_expand: true,
            });
            const secRec = {title: group.title, actor: section, rows: []};

            if (group.title && group.title !== 'Recommended') {
                section.add_child(new St.Label({
                    style_class: 'tahoe-section-title',
                    text: group.title,
                }));
            }

            for (let i = 0; i < group.records.length; i += cols) {
                const chunk = group.records.slice(i, i + cols);
                const row = new St.BoxLayout({
                    style_class: 'tahoe-row',
                    x_expand: true,
                });
                row.set_style(`spacing: ${gap}px;`);
                const rowRec = {actor: row, items: []};

                for (const record of chunk) {
                    const button = this._makeItem(record, itemW);
                    row.add_child(button);
                    const itemRec = {
                        actor: button,
                        record,
                        lower: record.lower,
                        row: rowRec,
                        section: secRec,
                    };
                    rowRec.items.push(itemRec);
                    this._items.push(itemRec);
                }

                section.add_child(row);
                secRec.rows.push(rowRec);
                this._rows.push(rowRec);
            }

            content.add_child(section);
            if (group.title === 'Recommended') {
                secRec.divider = this._makeDivider();
                content.add_child(secRec.divider);
            }
            this._sections.push(secRec);
        }

        this._applyFilter();
    }

    _makeItem(record, itemW) {
        const button = new St.Button({
            style_class: 'tahoe-app',
            reactive: true,
            can_focus: false,
            track_hover: true,
        });
        button.width = itemW;

        const box = new St.BoxLayout({
            style_class: 'tahoe-app-box',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let icon = null;
        try {
            const gicon = record.info?.get_icon?.();
            if (gicon)
                icon = _normalizedAppIcon(gicon, APP_ICON_SIZE);
        } catch (_) {
            icon = null;
        }
        if (!icon && record.app) {
            try {
                icon = record.app.create_icon_texture(APP_ICON_SIZE);
            } catch (_) {
                icon = null;
            }
        }
        if (!icon) {
            icon = new St.Icon({icon_size: APP_ICON_SIZE});
            const gicon = record.info.get_icon?.();
            if (gicon)
                icon.gicon = gicon;
            else
                icon.icon_name = 'application-x-executable-symbolic';
        }
        icon.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);

        const label = new St.Label({
            style_class: 'tahoe-app-label',
            text: record.name,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        box.add_child(label);

        button.child = box;
        let fired = false;
        const fire = () => {
            if (fired)
                return;
            fired = true;
            this._launch(record);
        };
        button.connect('button-press-event', () => {
            fire();
            return Clutter.EVENT_STOP;
        });
        button.connect('clicked', fire);
        return button;
    }

    // App Store logo recoloured to the current ink, like kiwi; falls back
    // to the stock grid icon when the logo file is unavailable.
    _makeHeaderIcon() {
        const icon = new St.Icon({
            icon_size: Math.round(HEADER_ICON_SIZE * 0.875),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'tahoe-header-icon',
        });
        try {
            const color = this._dark ? '#f5f5f7' : '#3c3c43';
            const src = Gio.File.new_for_path(
                GLib.build_filenamev([GLib.get_home_dir(), 'app-store-logo.svg']));
            const [, bytes] = src.load_contents(null);
            let svg = new TextDecoder().decode(bytes);
            svg = svg.replace(/#000000/gi, color).replace(/#000([^0-9a-fA-F]|$)/gi,
                color + '$1');
            svg = svg.replace('<svg', '<svg opacity="0.7"');
            const cacheDir = GLib.build_filenamev([GLib.get_home_dir(), '.cache']);
            GLib.mkdir_with_parents(cacheDir, 0o755);
            const dst = Gio.File.new_for_path(
                GLib.build_filenamev([cacheDir, this._dark ?
                    'tahoe-app-store-icon-dark.svg' :
                    'tahoe-app-store-icon-light.svg']));
            dst.replace_contents(new TextEncoder().encode(svg), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            icon.gicon = new Gio.FileIcon({file: dst});
        } catch (_) {
            icon.icon_name = 'view-app-grid-symbolic';
        }
        return icon;
    }

    _makeDivider() {
        return new St.Widget({
            style_class: 'tahoe-divider',
            x_expand: true,
        });
    }

    // ----------------------------------------------------------------- filter

    _applyFilter() {
        if (!this._entry)
            return;

        const query = this._entry.clutter_text.get_text().trim().toLowerCase();
        let anyVisible = false;

        for (const item of this._items) {
            const show = query.length === 0 || item.lower.includes(query);
            item.actor.visible = show;
            if (show)
                anyVisible = true;
        }

        for (const row of this._rows)
            row.actor.visible = row.items.some(i => i.actor.visible);

        for (const section of this._sections) {
            section.actor.visible = section.rows.some(r => r.actor.visible);
            if (section.divider)
                section.divider.visible = section.actor.visible;
        }

        if (this._empty)
            this._empty.visible = !anyVisible;

        this._updateActivePill();
    }

    // ------------------------------------------------------------------ pills

    _setActivePill(title) {
        for (const pill of this._pills) {
            if (pill.title !== null && pill.title === title)
                pill.btn.add_style_class_name('tahoe-pill-active');
            else
                pill.btn.remove_style_class_name('tahoe-pill-active');
        }
    }

    _updateActivePill() {
        if (!this.is_mapped())
            return;
        if (!this._sections.length)
            return;

        const [, contentY] = this._content.get_transformed_position();
        const value = this._scroll.vadjustment.value;

        let active = -1;
        let first = -1;
        this._sections.forEach((section, index) => {
            if (!section.actor.visible)
                return;
            if (section.title === 'Recommended')
                return;
            if (first === -1)
                first = index;
            const [, sectionY] = section.actor.get_transformed_position();
            if (sectionY - contentY <= value + 30)
                active = index;
        });

        if (active === -1)
            active = first;
        if (active === -1)
            return;

        this._setActivePill(this._sections[active].title);
    }

    _jumpToCategory(title) {
        const section = this._sections.find(s => s.title === title);

        if (!section) {
            if (this._entry.clutter_text.get_text() !== '')
                this._entry.clutter_text.set_text('');
            return;
        }

        const needsClear = !section.actor.visible &&
            this._entry.clutter_text.get_text() !== '';

        if (needsClear) {
            this._entry.clutter_text.set_text('');
            // Positions are stale until the next allocation; defer the jump.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                this._scrollToSection(section);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._scrollToSection(section);
        }
    }

    _scrollToSection(section) {
        if (!this._scroll || !this._content)
            return;

        const [, contentY] = this._content.get_transformed_position();
        const [, sectionY] = section.actor.get_transformed_position();

        const adj = this._scroll.vadjustment;
        const max = Math.max(adj.lower, adj.upper - adj.page_size);
        let target = sectionY - contentY - 8;
        target = Math.min(Math.max(target, adj.lower), max);

        if (typeof adj.ease === 'function') {
            adj.ease(target, {
                duration: 350,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            adj.value = target;
        }

        this._setActivePill(section.title);
    }

    // ------------------------------------------------------------------ menu

    _toggleMenu(anchor) {
        if (this._menu) {
            this._closeMenu();
            return;
        }

        const menu = new St.BoxLayout({
            style_class: 'tahoe-drop',
            vertical: true,
        });
        if (this._dark)
            menu.add_style_class_name('tahoe-dark');
        this._menu = menu;

        const entries = [
            {
                text: 'Group by category',
                get: () => this._groupByCategory,
                toggle: () => {
                    this._groupByCategory = !this._groupByCategory;
                    this._rebuildGrid();
                },
            },
            {
                text: 'Show system apps',
                get: () => this._showSystem,
                toggle: () => {
                    this._showSystem = !this._showSystem;
                    this._collect();
                    this._rebuildGrid();
                },
            },
        ];

        for (const def of entries) {
            const row = new St.Button({
                style_class: 'tahoe-drop-item',
                x_expand: true,
                can_focus: false,
                track_hover: true,
            });
            const box = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(new St.Label({
                text: def.text,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const check = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER,
                visible: def.get(),
            });
            box.add_child(check);
            row.child = box;
            row.connect('clicked', () => {
                def.toggle();
                check.visible = def.get();
                this._closeMenu();
            });
            menu.add_child(row);
        }

        Main.layoutManager.uiGroup.add_child(menu);

        const [ax, ay] = anchor.get_transformed_position();
        const [, menuW] = menu.get_preferred_width(-1);
        menu.width = Math.max(menuW, 220);
        menu.x = Math.max(ax + anchor.width - menu.width, 8);
        menu.y = ay + anchor.height + 6;
    }

    _closeMenu() {
        if (!this._menu)
            return;
        const menu = this._menu;
        this._menu = null;
        try {
            menu.destroy();
        } catch (_) {
            // already gone
        }
    }

    // ---------------------------------------------------------------- launch

    _launch(record) {
        this._recordRecent(record.id);
        try {
            if (record.app)
                record.app.activate();
            else
                record.info.launch([],
                    global.create_app_launch_context(0, -1));
        } catch (_) {
            // launch failed, view still closes below
        }
        try {
            this._onDone();
        } catch (_) {
            // popup gone
        }
    }

    _launchFirstVisible() {
        const first = this._items.find(i => i.actor.visible);
        if (first)
            this._launch(first.record);
    }

    // --------------------------------------------------------------- recents

    // Shared with kiwi's window, so Recommended stays consistent.
    _recentPath() {
        return GLib.build_filenamev(
            [GLib.get_home_dir(), '.cache', 'tahoe-recent-apps.json']);
    }

    _loadRecents() {
        try {
            const file = Gio.File.new_for_path(this._recentPath());
            const [, bytes] = file.load_contents(null);
            const ids = JSON.parse(new TextDecoder().decode(bytes));
            this._recents = Array.isArray(ids)
                ? ids.filter(id => typeof id === 'string').slice(0, 12)
                : [];
        } catch (_) {
            this._recents = [];
        }
        if (!this._recents.length) {
            try {
                const mostUsed = Shell.AppUsage.get_default().get_most_used();
                const ids = (mostUsed ?? []).map(app => {
                    try {
                        return app.get_id();
                    } catch (_) {
                        return null;
                    }
                }).filter(id => typeof id === 'string');
                this._recents = [...new Set(ids)].slice(0, 12);
                if (this._recents.length)
                    this._saveRecents();
            } catch (_) {
                // usage stats unavailable: stays empty until first launch
            }
        }
    }

    _saveRecents() {
        try {
            const file = Gio.File.new_for_path(this._recentPath());
            file.replace_contents(
                new TextEncoder().encode(JSON.stringify(this._recents)),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (_) {
            // cache write is best-effort
        }
    }

    _recordRecent(id) {
        if (!id)
            return;
        this._recents =
            [id, ...this._recents.filter(r => r !== id)].slice(0, 12);
        this._saveRecents();
    }

    destroy() {
        this._closeMenu();
        if (this._vadjConn) {
            try {
                this._scroll.vadjustment.disconnect(this._vadjConn);
            } catch (_) {
                // adjustment gone with the scroll view
            }
            this._vadjConn = 0;
        }
        this._pills = [];
        this._sections = [];
        this._rows = [];
        this._items = [];
        super.destroy();
    }
});
