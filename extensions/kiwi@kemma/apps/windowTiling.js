// SPDX-License-Identifier: GPL-3.0-or-later




import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const GLYPH_W = 26;
const GLYPH_H = 18;
const PANE_GAP = 1;
const GLYPH_BORDER = 1;
const SECTION_LABEL_OPACITY = 150;
const PANE_GHOST_OPACITY = 115;

const ANIMATION_MS = 300;

const FULL = { x: 0, y: 0, w: 1, h: 1 };


const LAYOUTS = {
    'left':         { x: 0,     y: 0,     w: 1 / 2, h: 1 },
    'right':        { x: 1 / 2, y: 0,     w: 1 / 2, h: 1 },
    'top':          { x: 0,     y: 0,     w: 1,     h: 1 / 2 },
    'bottom':       { x: 0,     y: 1 / 2, w: 1,     h: 1 / 2 },
    'top-left':     { x: 0,     y: 0,     w: 1 / 2, h: 1 / 2 },
    'top-right':    { x: 1 / 2, y: 0,     w: 1 / 2, h: 1 / 2 },
    'bottom-left':  { x: 0,     y: 1 / 2, w: 1 / 2, h: 1 / 2 },
    'bottom-right': { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
};

const ARRANGEMENTS = {
    'left-right': ['left', 'right'],
    'right-left': ['right', 'left'],
    'quarters': ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
};

const MOVING_GRAB_OPS = [
    Meta.GrabOp.MOVING,
    Meta.GrabOp.MOVING_UNCONSTRAINED,
    Meta.GrabOp.KEYBOARD_MOVING,
];

let _grabOpBeginId = null;



const MAXIMIZE_ARGS = parseInt(Config.PACKAGE_VERSION) >= 49
    ? [] : [Meta.MaximizeFlags.BOTH];

function maximizeWindow(win) {
    win.maximize(...MAXIMIZE_ARGS);
}

function unmaximizeWindow(win) {
    win.unmaximize(...MAXIMIZE_ARGS);
}

function isMaximized(win) {
    return !!win && win.maximized_horizontally && win.maximized_vertically;
}




export function canTile(win) {
    return !!win && win.resizeable;
}

function focusWindow() {
    return global.display.focus_window;
}


export function canRestore(win) {
    return !!win && (!!win._kiwiRestore || isMaximized(win));
}





function moveResizeAnimated(win, x, y, w, h, animate, fromRect) {
    const actor = win.get_compositor_private();


    const from = fromRect || win.get_frame_rect();

    win.move_resize_frame(false, x, y, w, h);

    if (!animate || !actor || !from.width || !from.height)
        return;
    if (from.x === x && from.y === y && from.width === w && from.height === h)
        return;

    actor.remove_all_transitions();
    actor.set_pivot_point(0, 0);
    actor.translation_x = from.x - x;
    actor.translation_y = from.y - y;
    actor.scale_x = from.width / w;
    actor.scale_y = from.height / h;
    actor.ease({
        translation_x: 0,
        translation_y: 0,
        scale_x: 1,
        scale_y: 1,
        duration: ANIMATION_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}


function stashGeometry(win) {
    if (win._kiwiRestore)
        return;

    if (isMaximized(win)) {
        win._kiwiRestore = { maximized: true };
    } else {
        const r = win.get_frame_rect();
        win._kiwiRestore = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
}

function frameFor(win, key) {
    const wa = win.get_work_area_current_monitor();
    const f = LAYOUTS[key];

    const x1 = wa.x + Math.round(f.x * wa.width);
    const x2 = wa.x + Math.round((f.x + f.w) * wa.width);
    const y1 = wa.y + Math.round(f.y * wa.height);
    const y2 = wa.y + Math.round((f.y + f.h) * wa.height);
    return [x1, y1, x2 - x1, y2 - y1];
}

function tileWindow(win, key, animate = true) {
    if (!canTile(win))
        return;

    stashGeometry(win);

    const from = win.get_frame_rect();
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (isMaximized(win))
        unmaximizeWindow(win);

    const [x, y, w, h] = frameFor(win, key);
    moveResizeAnimated(win, x, y, w, h, animate, from);
}

function restoreWindow(win, animate = true) {
    if (!win)
        return;

    const stash = win._kiwiRestore;
    delete win._kiwiRestore;

    if (!stash) {

        if (isMaximized(win))
            unmaximizeWindow(win);
        return;
    }

    if (stash.maximized) {
        maximizeWindow(win);
        return;
    }

    const from = win.get_frame_rect();
    if (isMaximized(win))
        unmaximizeWindow(win);
    moveResizeAnimated(win, stash.x, stash.y, stash.width, stash.height, animate, from);
}


export function restoreAllWindows(focused) {
    const workspace = global.workspace_manager.get_active_workspace();
    const tiled = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(win => win._kiwiRestore);

    for (const win of tiled)
        restoreWindow(win);



    if (!tiled.length)
        restoreWindow(focused);
}

export function toggleFullscreen(win) {
    if (!win)
        return;

    if (win.is_fullscreen())
        win.unmake_fullscreen();
    else
        win.make_fullscreen();
}


function tilePartners(win) {
    const workspace = global.workspace_manager.get_active_workspace();
    return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(other => other !== win && !other.minimized && !other.is_skip_taskbar() &&
                         other.get_monitor() === win.get_monitor() && canTile(other));
}

function arrangeWindows(win, kind) {
    if (!canTile(win))
        return;

    const keys = ARRANGEMENTS[kind];
    const partners = tilePartners(win).slice(0, keys.length - 1);

    tileWindow(win, keys[0]);
    partners.forEach((other, index) => {
        tileWindow(other, keys[index + 1]);
        other.raise();
    });
    win.activate(global.get_current_time());
}






function onGrabOpBegin(_display, win, grabOp) {
    if (!win || !win._kiwiRestore)
        return;

    if (!MOVING_GRAB_OPS.includes(grabOp))
        return;

    const before = win.get_frame_rect();
    const [pointerX] = global.get_pointer();

    const ratio = before.width > 0
        ? Math.min(1, Math.max(0, (pointerX - before.x) / before.width)) : 0.5;




    const stash = win._kiwiRestore;
    delete win._kiwiRestore;
    if (stash.maximized || isMaximized(win))
        return;

    moveResizeAnimated(win,
        Math.round(pointerX - ratio * stash.width), before.y, stash.width, stash.height,
        true, before);
}

export function enableDragRestore() {
    if (_grabOpBeginId)
        return;

    _grabOpBeginId = global.display.connect('grab-op-begin', onGrabOpBegin);
}

export function disableDragRestore() {


    for (const win of global.display.get_tab_list(Meta.TabList.NORMAL, null))
        delete win._kiwiRestore;

    if (!_grabOpBeginId)
        return;

    global.display.disconnect(_grabOpBeginId);
    _grabOpBeginId = null;
}





function makeGlyph(panes) {
    const glyph = new St.Widget({
        style_class: 'kiwi-tile-glyph',
        layout_manager: new Clutter.BinLayout(),
        width: GLYPH_W,
        height: GLYPH_H,
    });

    const inner = new St.Widget({
        layout_manager: new Clutter.FixedLayout(),
        width: GLYPH_W - 2 * GLYPH_BORDER,
        height: GLYPH_H - 2 * GLYPH_BORDER,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    glyph.add_child(inner);

    for (const pane of panes) {
        const actor = new St.Widget({ style_class: 'kiwi-tile-pane' });



        if (pane.ghost)
            actor.opacity = PANE_GHOST_OPACITY;
        const x1 = Math.round(pane.x * inner.width);
        const x2 = Math.round((pane.x + pane.w) * inner.width);
        const y1 = Math.round(pane.y * inner.height);
        const y2 = Math.round((pane.y + pane.h) * inner.height);
        actor.set_position(x1 + PANE_GAP, y1 + PANE_GAP);
        actor.set_size(Math.max(1, x2 - x1 - PANE_GAP * 2), Math.max(1, y2 - y1 - PANE_GAP * 2));
        inner.add_child(actor);
    }

    return glyph;
}



export function createTileGrid(gettext, onActivated) {
    const _ = gettext;
    const sections = [
        [_('Move & Resize'), [
            [_('Left'), [LAYOUTS['left']], 0, () => tileWindow(focusWindow(), 'left')],
            [_('Right'), [LAYOUTS['right']], 0, () => tileWindow(focusWindow(), 'right')],
            [_('Top'), [LAYOUTS['top']], 0, () => tileWindow(focusWindow(), 'top')],
            [_('Bottom'), [LAYOUTS['bottom']], 0, () => tileWindow(focusWindow(), 'bottom')],
        ]],
        [_('Fill & Arrange'), [
            [_('Fill'), [FULL], 0, () => {
                const win = focusWindow();
                if (win) {
                    stashGeometry(win);
                    maximizeWindow(win);
                }
            }],
            [_('Left & Right'),
                [LAYOUTS['left'], { ...LAYOUTS['right'], ghost: true }],
                1, () => arrangeWindows(focusWindow(), 'left-right')],
            [_('Right & Left'),
                [LAYOUTS['right'], { ...LAYOUTS['left'], ghost: true }],
                1, () => arrangeWindows(focusWindow(), 'right-left')],
            [_('Quarters'), [
                LAYOUTS['top-left'],
                { ...LAYOUTS['top-right'], ghost: true },
                { ...LAYOUTS['bottom-left'], ghost: true },
                { ...LAYOUTS['bottom-right'], ghost: true },
            ], 3, () => arrangeWindows(focusWindow(), 'quarters')],
        ]],
    ];

    const actor = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'kiwi-tiling-grid',
    });


    if (Main.getStyleVariant() === 'light')
        actor.add_style_class_name('light');

    const arrangeTiles = [];

    for (const [label, tiles] of sections) {
        const sectionLabel = new St.Label({ text: label, style_class: 'kiwi-tiling-section-label' });
        sectionLabel.opacity = SECTION_LABEL_OPACITY;
        actor.add_child(sectionLabel);

        const row = new St.BoxLayout({ style_class: 'kiwi-tiling-row' });
        for (const [name, panes, needs, run] of tiles) {
            const button = new St.Button({
                style_class: 'kiwi-tile-button',
                track_hover: true,
                accessible_name: name,
            });
            button.set_child(makeGlyph(panes));
            button.connect('clicked', () => {
                onActivated();
                run();
            });
            row.add_child(button);

            if (needs)
                arrangeTiles.push([button, needs]);
        }
        actor.add_child(row);
    }

    const sync = win => {
        const available = win ? tilePartners(win).length : 0;
        for (const [button, needed] of arrangeTiles) {
            const usable = available >= needed;
            button.reactive = usable;
            button.opacity = usable ? 255 : 90;
        }
    };

    return { actor, sync };
}
