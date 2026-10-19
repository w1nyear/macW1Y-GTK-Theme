// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe Edit Controls menu: opens when the "Edit Controls" pill is clicked
// instead of Settings. 1:1 with macOS Tahoe:
//   left sidebar (search + category list), right pane (section headers +
//   control tiles), footer (hint + blue "Done" button).
// Drag a tile into the Control Center to add it; drag CC elements to
// reorder; "−" badge removes; click cycles size (small/large).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MENU_W = 660;
const MENU_H = 700;
const SIDEBAR_W = 200;
const FOOTER_H = 52;
const TILE_R = 31;           // tile circle radius
const TILE_ICON = 22;
const SECT_GAP = 18;

let _menu = null;            // {overlay, win, sidebar, content, footer, ...}
let _onDone = null;          // callback when Done is pressed
let _catalog = null;         // array of control defs (set by QS)

// ── catalog ──────────────────────────────────────────────────────────
// Each control: {id, title, icon, gicon?, category, size}
// size = current default size in CC ('small'|'half'|'wide')
export function setCatalog(items) {
    _catalog = items;
}

function _categories() {
    // sidebar categories, order matches macOS Tahoe reference
    return [
        {id: 'all', title: 'All Controls', icon: 'view-grid-symbolic', color: '#8e8e93'},
        {id: 'battery', title: 'Battery', icon: 'battery-symbolic', color: '#30d158'},
        {id: 'clock', title: 'Clock', icon: 'preferences-system-time-symbolic', color: '#8e8e93'},
        {id: 'connectivity', title: 'Connectivity', icon: 'network-wireless-symbolic', color: '#0a84ff'},
        {id: 'desktop', title: 'Desktop & Finder', icon: 'folder-symbolic', color: '#0a84ff'},
        {id: 'display', title: 'Display & Brightness', icon: 'display-brightness-symbolic', color: '#0a84ff'},
        {id: 'fastuser', title: 'Fast User Switching', icon: 'system-users-symbolic', color: '#8e8e93'},
        {id: 'focus', title: 'Focus', icon: 'weather-clear-night-symbolic', color: '#bf5af2'},
        {id: 'home', title: 'Home', icon: 'user-home-symbolic', color: '#ff9f0a'},
        {id: 'keyboards', title: 'Keyboards', icon: 'input-keyboard-symbolic', color: '#8e8e93'},
        {id: 'lockscreen', title: 'Lock Screen', icon: 'system-lock-screen-symbolic', color: '#8e8e93'},
        {id: 'notes', title: 'Notes', icon: 'accessories-text-editor-symbolic', color: '#ffcc00'},
        {id: 'nowplaying', title: 'Now Playing', icon: 'multimedia-player-symbolic', color: '#ff2d55'},
        {id: 'screenshot', title: 'Screenshot', icon: 'camera-photo-symbolic', color: '#8e8e93'},
        {id: 'shortcuts', title: 'Shortcuts', icon: 'system-run-symbolic', color: '#bf5af2'},
        {id: 'sounds', title: 'Sounds', icon: 'audio-volume-high-symbolic', color: '#ff375f'},
        {id: 'stagemanager', title: 'Stage Manager', icon: 'preferences-desktop-display-symbolic', color: '#8e8e93'},
    ];
}

// ── helpers ──────────────────────────────────────────────────────────
function _gicon(name) {
    try {
        return Gio.Icon.new_for_string(name);
    } catch (_) {
        return null;
    }
}

function _makeTile(ctrl) {
    // circle tile with icon + label below (macOS Tahoe edit menu tile)
    const wrap = new St.BoxLayout({vertical: true, x_expand: false,
        y_expand: false, style_class: 'tahoe-qse-tile-wrap'});
    const circle = new St.Bin({
        style_class: 'tahoe-qse-tile-circle',
        width: TILE_R * 2, height: TILE_R * 2,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = new St.Icon({
        icon_name: ctrl.icon || 'applications-system-symbolic',
        icon_size: TILE_ICON,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (ctrl.gicon)
        icon.gicon = ctrl.gicon;
    circle.set_child(icon);
    wrap.add_child(circle);
    const label = new St.Label({
        text: ctrl.title,
        style_class: 'tahoe-qse-tile-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });
    try {
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    } catch (_) { /* no text */ }
    wrap.add_child(label);
    wrap._ctrl = ctrl;
    wrap._circle = circle;
    return wrap;
}

function _makeSection(title, controls) {
    const sect = new St.BoxLayout({vertical: true, x_expand: true,
        style_class: 'tahoe-qse-section'});
    if (title) {
        const h = new St.Label({text: title, style_class: 'tahoe-qse-sect-title'});
        sect.add_child(h);
    }
    const grid = new St.BoxLayout({x_expand: true, style_class: 'tahoe-qse-grid'});
    // pack tiles into rows of 3
    let row = new St.BoxLayout({x_expand: true, style_class: 'tahoe-qse-grid-row'});
    let col = 0;
    for (const c of controls) {
        const t = _makeTile(c);
        row.add_child(t);
        col++;
        if (col >= 3) {
            grid.add_child(row);
            row = new St.BoxLayout({x_expand: true, style_class: 'tahoe-qse-grid-row'});
            col = 0;
        }
    }
    if (col > 0)
        grid.add_child(row);
    sect.add_child(grid);
    return sect;
}

// ── sidebar ──────────────────────────────────────────────────────────
function _buildSidebar() {
    const sb = new St.BoxLayout({vertical: true, x_expand: false, y_expand: true,
        style_class: 'tahoe-qse-sidebar', width: SIDEBAR_W});

    // search entry
    const searchBox = new St.BoxLayout({x_expand: true, style_class: 'tahoe-qse-search-box'});
    const searchIcon = new St.Icon({icon_name: 'system-search-symbolic', icon_size: 14,
        y_align: Clutter.ActorAlign.CENTER, style_class: 'tahoe-qse-search-icon'});
    const searchText = new St.Entry({style_class: 'tahoe-qse-search-entry',
        hint_text: 'Search Controls', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    searchBox.add_child(searchIcon);
    searchBox.add_child(searchText);
    sb.add_child(searchBox);

    // category list
    const cats = _categories();
    for (let i = 0; i < cats.length; i++) {
        const cat = cats[i];
        const row = new St.BoxLayout({x_expand: true, reactive: true, can_focus: true,
            style_class: 'tahoe-qse-cat-row' + (i === 0 ? ' selected' : '')});
        // colored square icon
        const sq = new St.Bin({style_class: 'tahoe-qse-cat-sq',
            width: 22, height: 22, x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER});
        try {
            sq.set_style(`background-color: ${cat.color}; border-radius: 5px;`);
        } catch (_) { /* css */ }
        const sqIcon = new St.Icon({icon_name: cat.icon, icon_size: 13,
            style_class: 'tahoe-qse-cat-icon'});
        sq.set_child(sqIcon);
        row.add_child(sq);
        const lbl = new St.Label({text: cat.title, style_class: 'tahoe-qse-cat-label',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        try { lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
        row.add_child(lbl);
        row._catId = cat.id;
        sb.add_child(row);
    }
    return sb;
}

// ── content pane ─────────────────────────────────────────────────────
function _buildContent() {
    const scroll = new St.ScrollView({style_class: 'tahoe-qse-scroll',
        x_expand: true, y_expand: true, overlay_scrollbars: true});
    const content = new St.BoxLayout({vertical: true, x_expand: true,
        style_class: 'tahoe-qse-content'});
    scroll.set_child(content);

    // group catalog controls by category into sections
    const cats = _categories().filter(c => c.id !== 'all');
    const byCat = {};
    for (const c of (_catalog ?? [])) {
        const k = c.category || 'other';
        (byCat[k] = byCat[k] ?? []).push(c);
    }
    // show sections for categories that have controls
    for (const cat of cats) {
        const items = byCat[cat.id];
        if (!items?.length)
            continue;
        content.add_child(_makeSection(cat.title, items));
    }
    // uncategorized bucket
    if (byCat.other?.length)
        content.add_child(_makeSection(null, byCat.other));

    return {scroll, content};
}

// ── footer ───────────────────────────────────────────────────────────
function _buildFooter() {
    const f = new St.BoxLayout({x_expand: true, height: FOOTER_H,
        style_class: 'tahoe-qse-footer'});
    const hint = new St.Label({
        text: 'Drag a control to place it in Control Center…',
        style_class: 'tahoe-qse-hint',
        x_expand: true, y_align: Clutter.ActorAlign.CENTER,
    });
    f.add_child(hint);
    const done = new St.Button({
        style_class: 'tahoe-qse-done',
        label: 'Done',
        reactive: true, can_focus: true,
        x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
    });
    f.add_child(done);
    return {f, done};
}

// ── open / close ─────────────────────────────────────────────────────
export function openEditMenu(catalog, onDone) {
    if (_menu)
        closeEditMenu();
    _catalog = catalog;
    _onDone = onDone;

    const monitor = Main.layoutManager.primaryMonitor;
    const ccX = monitor.x + monitor.width - 320 - 12;   // CC panel x
    const x = ccX - MENU_W - 16;
    const y = monitor.y + (monitor.height - MENU_H) / 2;

    const overlay = new Clutter.Actor({
        reactive: true, x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
    });
    overlay.connect('button-press-event', (a, ev) => {
        try {
            if (global.stage.get_event_actor(ev) !== a)
                return Clutter.EVENT_PROPAGATE;
        } catch (_) { return Clutter.EVENT_PROPAGATE; }
        closeEditMenu();
        return Clutter.EVENT_PROPAGATE;
    });
    overlay.connect('key-press-event', (_a, ev) => {
        if (ev.get_key_symbol() === Clutter.KEY_Escape) {
            closeEditMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    // window
    const win = new St.BoxLayout({vertical: true, x_expand: false, y_expand: false,
        style_class: 'tahoe-qse-win', width: MENU_W, height: MENU_H});
    win.set_position(x - monitor.x, y - monitor.y);

    // body: sidebar + content
    const body = new St.BoxLayout({x_expand: true, y_expand: true});
    const sidebar = _buildSidebar();
    const {scroll, content} = _buildContent();
    body.add_child(sidebar);
    body.add_child(scroll);
    win.add_child(body);

    // footer
    const {f: footer, done} = _buildFooter();
    win.add_child(footer);

    overlay.add_child(win);

    // Done → close menu (keep CC open in normal mode)
    done.connect('clicked', () => closeEditMenu());

    // drag start on tiles: button-press on a tile → begin drag
    content.connect('button-press-event', (actor, ev) => {
        let target = ev.get_source();
        while (target && target !== content && !target._ctrl)
            target = target.get_parent();
        if (!target?._ctrl)
            return Clutter.EVENT_PROPAGATE;
        _startDrag(target, ev, overlay);
        return Clutter.EVENT_STOP;
    });

    Main.layoutManager.uiGroup.add_child(overlay);
    try {
        Main.layoutManager.uiGroup.set_child_below_sibling(
            overlay, Main.layoutManager.panelBox);
    } catch (_) { /* on top */ }

    overlay.opacity = 0;
    overlay.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

    _menu = {overlay, win, sidebar, scroll, content, footer};
    console.log('[tahoe-qse] edit menu opened');
}

export function closeEditMenu() {
    if (!_menu)
        return;
    const m = _menu;
    _menu = null;
    try { m.overlay.destroy(); } catch (_) { /* gone */ }
    // any close (Done, X, Escape) leaves CC edit mode
    try { _onDone?.(); } catch (_) { /* no cb */ }
    _onDone = null;
    console.log('[tahoe-qse] edit menu closed');
}

export function isEditMenuOpen() {
    return !!_menu;
}

// ── drag tile → CC ───────────────────────────────────────────────────
function _startDrag(tile, ev, overlay) {
    const ctrl = tile._ctrl;
    let ghost = null;
    let moved = false;

    const onMotion = (_a, mev) => {
        const [mx, my] = mev.get_coords();
        if (!moved) {
            // threshold: only start ghost after 6px movement
            const [sx, sy] = ev.get_coords();
            if (Math.abs(mx - sx) < 6 && Math.abs(my - sy) < 6)
                return Clutter.EVENT_PROPAGATE;
            moved = true;
            ghost = new St.BoxLayout({style_class: 'tahoe-qse-ghost'});
            ghost.set_size(tile.width, tile.height);
            const ic = tile._circle.get_child()?.clone();
            if (ic)
                ghost.add_child(ic);
            overlay.add_child(ghost);
        }
        if (ghost)
            ghost.set_position(mx - overlay.x - ghost.width / 2,
                my - overlay.y - ghost.height / 2);
        return Clutter.EVENT_STOP;
    };

    const onRelease = (_a, rev) => {
        global.stage.disconnect(cMotion);
        global.stage.disconnect(cRelease);
        if (ghost)
            ghost.destroy();
        if (!moved)
            return Clutter.EVENT_PROPAGATE;
        const [mx, my] = rev.get_coords();
        // check drop over CC panel
        try {
            import('./tahoeControlCenter.js').then(qs => {
                if (qs.tryDropControl?.(ctrl, mx, my))
                    console.log(`[tahoe-qse] dropped ${ctrl.id} into CC`);
            }).catch(() => {});
        } catch (_) { /* no qs */ }
        return Clutter.EVENT_STOP;
    };

    const cMotion = global.stage.connect('captured-event', onMotion);
    const cRelease = global.stage.connect('button-release-event', onRelease);
    // auto-cleanup after 5s safety
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
        try { global.stage.disconnect(cMotion); } catch (_) {}
        try { global.stage.disconnect(cRelease); } catch (_) {}
        if (ghost) { try { ghost.destroy(); } catch (_) {} }
        return GLib.SOURCE_REMOVE;
    });
}
