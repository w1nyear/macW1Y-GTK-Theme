// macOS-style "pull out of the dock to remove": releasing a pinned app icon
// far outside the dock unpins it with a poof (puff up + fade), instead of
// snapping back. Running-only icons, the trash, Show Apps and kiwi's strips
// have no favorite id and are left alone.

import {
    Clutter,
} from './dependencies/gi.js';

import {
    AppFavorites,
    Main,
} from './dependencies/shell/ui.js';

// Pointer travel outside the dock rect that counts as "pulled out".
const REMOVE_DISTANCE = 100;

let _beginId = 0;
let _endId = 0;
let _cancelId = 0;
let _dragSource = null;

function _dockContainer() {
    try {
        for (const child of Main.uiGroup.get_children()) {
            if (child.get_name?.() === 'dashtodockContainer')
                return child;
        }
    } catch (_) {
        // uiGroup gone
    }
    return null;
}

function _insideDock(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        try {
            if (a.get_name?.() === 'dashtodockContainer')
                return true;
        } catch (_) {
            return false;
        }
    }
    return false;
}

function _onDragBegin(_overview, source) {
    _dragSource = source ?? null;
}

function _onDragEnd() {
    const source = _dragSource;
    _dragSource = null;
    if (!source)
        return;

    const id = source.app?.get_id?.();
    if (!id || !_insideDock(source))
        return;

    let favs = null;
    try {
        favs = AppFavorites.getAppFavorites();
    } catch (_) {
        return;
    }
    if (!favs?.isFavorite?.(id))
        return;

    const dock = _dockContainer();
    if (!dock?.has_allocation())
        return;
    const [dx, dy] = dock.get_transformed_position();
    const dw = dock.get_width();
    const dh = dock.get_height();
    if (dw <= 0 || dh <= 0)
        return;
    const [px, py] = global.get_pointer();
    const ox = px < dx ? dx - px : (px > dx + dw ? px - (dx + dw) : 0);
    const oy = py < dy ? dy - py : (py > dy + dh ? py - (dy + dh) : 0);
    if (Math.hypot(ox, oy) < REMOVE_DISTANCE)
        return;

    // Poof, then unpin.
    try {
        const target = source.icon ?? source;
        target.set_pivot_point(0.5, 0.5);
        target.ease({
            scale_x: 1.6,
            scale_y: 1.6,
            opacity: 0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    favs.removeFavorite(id);
                } catch (_) {
                    // already gone
                }
            },
        });
    } catch (_) {
        try {
            favs.removeFavorite(id);
        } catch (_) {
            // already gone
        }
    }
}

export function enable() {
    if (_beginId)
        return;
    _beginId = Main.overview.connect('item-drag-begin', _onDragBegin);
    _endId = Main.overview.connect('item-drag-end', _onDragEnd);
    _cancelId = Main.overview.connect('item-drag-cancelled', () => {
        _dragSource = null;
    });
}

export function disable() {
    if (_beginId) {
        try {
            Main.overview.disconnect(_beginId);
        } catch (_) {
            // already gone
        }
        _beginId = 0;
    }
    if (_endId) {
        try {
            Main.overview.disconnect(_endId);
        } catch (_) {
            // already gone
        }
        _endId = 0;
    }
    if (_cancelId) {
        try {
            Main.overview.disconnect(_cancelId);
        } catch (_) {
            // already gone
        }
        _cancelId = 0;
    }
    _dragSource = null;
}
