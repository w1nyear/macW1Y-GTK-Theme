// SPDX-License-Identifier: GPL-3.0-or-later




import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    applyIconOffset, dashEndsWithSeparator, dashOf, disconnectAll, dockSettings, isTrashItem,
    makeDashItem, makeDashSeparator, makeStrip, scaleFactor, watchDocks,
} from './dockUtils.js';




const TILE_ALONG = 1.15;
const TILE_ACROSS = 1;
const THUMBNAIL_RADIUS = 4;
const BADGE_FRACTION = 0.4;
const RESTORE_GRACE = 500;
const GEOMETRY_SETTLE = 100;



const TILE_SLOT_TIME = 160;
const TILE_GROW_TIME = 240;

let enabled = false;
const TRASH_SCALE = 1.05;

let docks = [];
let order = [];
let snapshots = new Map();
let windowSignals = new Map();
let globalSignals = [];
let restoring = new Set();
let d2dSettings = null;
const sources = {
    dockSearch: 0, restoreGrace: 0, geometryUpdate: 0, trashAdoption: 0, separatorSync: 0,
};



function _isEligible(win) {
    return !!win && win.window_type === Meta.WindowType.NORMAL && !win.is_skip_taskbar();
}

function _captureSnapshot(win) {
    const actor = win.get_compositor_private();
    if (!actor)
        return null;



    const frame = win.get_frame_rect();
    const clip = new Mtk.Rectangle({
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
    });

    try {
        const content = actor.paint_to_content(clip);
        if (content)
            return { content, width: frame.width, height: frame.height };
    } catch (_) {

    }
    return null;
}








function _trackWindow(win) {
    if (!_isEligible(win) || windowSignals.has(win))
        return;

    windowSignals.set(win, [
        win.connect('notify::minimized', () =>
            win.minimized ? _addWindow(win) : _removeWindow(win)),
        win.connect('unmanaged', () => _untrackWindow(win)),
    ]);

    if (win.minimized)
        _addWindow(win);
}

function _untrackWindow(win) {
    for (const id of windowSignals.get(win) ?? [])
        win.disconnect(id);
    windowSignals.delete(win);
    _removeWindow(win);
}

function _addWindow(win) {
    if (!enabled || order.includes(win))
        return;



    if (!snapshots.has(win)) {
        const snapshot = _captureSnapshot(win);
        if (snapshot)
            snapshots.set(win, snapshot);
    }



    const info = _dockForWindow(win);
    if (info?.strip.get_stage())
        win.set_icon_geometry(_nextSlotRect(info));

    order.push(win);
    restoring.delete(win);
    _syncDocks();
}

function _removeWindow(win) {
    if (!order.includes(win))
        return;

    order = order.filter(w => w !== win);
    snapshots.delete(win);

    if (enabled) {
        _holdGeometry(win);
        _syncDocks();
    }
}







function _holdGeometry(win) {
    restoring.add(win);

    if (sources.restoreGrace)
        GLib.Source.remove(sources.restoreGrace);
    sources.restoreGrace = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_GRACE, () => {
        sources.restoreGrace = 0;
        restoring.clear();
        _queueIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}



const CORNER_UNIFORMS = `
    uniform float width;
    uniform float height;
    uniform float radius;
`;

// does not stair-step. Leaves the coverage in 'a'.
const CORNER_COVERAGE = `
    vec2 size = vec2(width, height);
    vec2 uv = cogl_tex_coord_in[0].xy;
    // How far the pixel reaches past the corner arc, 0 while inside
    vec2 d = max(vec2(radius) - min(uv * size, size - uv * size), vec2(0.0));
    float a = clamp(radius - length(d) + 0.5, 0.0, 1.0);
`;



const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
        this.set_shader_source(`
            uniform sampler2D tex;
            ${CORNER_UNIFORMS}

            void main() {
                ${CORNER_COVERAGE}
                cogl_color_out = texture2D(tex, uv) * a;
            }
        `);
    }
});






function _newRoundedCornersEffect() {
    if (Clutter.ShaderEffect.prototype.set_shader_source)
        return new RoundedCornersEffect();

    return Clutter.ShaderEffect.new_with_snippet(
        Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, CORNER_UNIFORMS, `
            ${CORNER_COVERAGE}
            cogl_color_out *= a;
        `));
}

function _tileBox(dash) {
    const scale = scaleFactor();
    const isHorizontal = dash._isHorizontal ?? true;
    const along = Math.round(dash.iconSize * TILE_ALONG * scale);
    const across = Math.round(dash.iconSize * TILE_ACROSS * scale);
    return isHorizontal ? [along, across] : [across, along];
}







function _roundCorners(actor) {
    const effect = _newRoundedCornersEffect();
    actor.add_effect(effect);

    const { width, height } = actor;
    const radius = Math.min(THUMBNAIL_RADIUS * scaleFactor(), width / 2, height / 2);


    effect.set_uniform_value('width', width - 1e-6);
    effect.set_uniform_value('height', height - 1e-6);
    effect.set_uniform_value('radius', radius - 1e-6);




    actor.connect('notify::allocation', () => {
        const box = actor.get_allocation_box();
        effect.enabled = box.get_width() >= 1 && box.get_height() >= 1;
    });
}

function _makeWindowTile(win, dash) {
    const button = new St.Button({
        style_class: 'kiwi-minimized-tile',
        can_focus: true,
        track_hover: true,



        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    const snapshot = snapshots.get(win);
    const [boxWidth, boxHeight] = _tileBox(dash);


    applyIconOffset(dash, button);


    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: boxWidth,
        height: boxHeight,
    });

    if (snapshot) {

        const fit = Math.min(boxWidth / snapshot.width, boxHeight / snapshot.height);
        const thumbnail = new St.Widget({
            content: snapshot.content,
            width: Math.round(snapshot.width * fit),
            height: Math.round(snapshot.height * fit),
        });


        thumbnail.set_content_scaling_filters(
            Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
        _roundCorners(thumbnail);
        box.add_child(thumbnail);
    } else {
        box.add_child(app
            ? app.create_icon_texture(dash.iconSize)
            : new St.Icon({ icon_name: 'application-x-executable', icon_size: dash.iconSize }));
    }

    if (app && snapshot) {
        const badge = app.create_icon_texture(
            Math.max(16, Math.round(dash.iconSize * BADGE_FRACTION)));

        badge.set({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
        });
        box.add_child(badge);
    }

    button.set_child(box);
    return button;
}



function _syncDocks() {
    docks.forEach(_syncDock);
    _queueIconGeometry();
}








function _syncDock(info) {
    const { dash, strip } = info;
    const rebuild = info.iconSize !== dash.iconSize;
    info.iconSize = dash.iconSize;

    if (rebuild) {
        info.separator?.destroy();
        info.separator = null;
    }

    info.tiles = info.tiles.filter(({ win, item }) => {
        if (!rebuild && order.includes(win))
            return true;
        if (rebuild)
            item.destroy();
        else
            _animateOut(info, item);
        return false;
    });

    for (const win of order) {
        if (info.tiles.some(tile => tile.win === win))
            continue;

        const item = _makeTileItem(info, win);
        if (info.trashItem)
            strip.insert_child_below(item, info.trashItem);
        else
            strip.add_child(item);
        _animateIn(info, item);
        info.tiles.push({ win, item });
    }

    _syncSeparator(info);

    if (info.trashItem) {

        if (strip.get_last_child() !== info.trashItem)
            strip.set_child_above_sibling(info.trashItem, null);

        info.trashItem.child.icon?.setIconSize(dash.iconSize);

        info.trashItem.child.set_pivot_point(0.5, 0.5);
        info.trashItem.child.set_scale(TRASH_SCALE, TRASH_SCALE);
    }
}








function _tileAxes(dash) {
    if (dash._isHorizontal ?? true) {
        const y = dash._position === St.Side.TOP ? 0 : 1;
        return { slot: 'scale_x', grow: 'scale_y', pivot: new Graphene.Point({ x: 0.5, y }) };
    }

    const x = dash._position === St.Side.RIGHT ? 1 : 0;
    return { slot: 'scale_y', grow: 'scale_x', pivot: new Graphene.Point({ x, y: 0.5 }) };
}








function _animateIn(info, item) {
    const { slot, grow, pivot } = _tileAxes(info.dash);
    const tile = item.child;


    item[grow] = 1;
    tile.pivot_point = pivot;
    tile[grow] = 0;

    item.ease({
        [slot]: 1,
        opacity: 255,
        duration: TILE_SLOT_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    tile.ease({
        [grow]: 1,
        delay: TILE_SLOT_TIME,
        duration: TILE_GROW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function _animateOut(info, item) {
    const { slot, grow } = _tileAxes(info.dash);

    item.animatingOut = true;
    item.label?.hide();


    item.child.ease({
        [grow]: 0,
        duration: TILE_GROW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    item.ease({
        [slot]: 0,
        opacity: 0,
        delay: TILE_GROW_TIME,
        duration: TILE_SLOT_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,


        onStopped: () => item.destroy(),
    });
}

function _makeTileItem(info, win) {
    const { dash } = info;
    const button = _makeWindowTile(win, dash);
    const item = makeDashItem(dash, button, win.get_title() ?? '');

    button.connect('clicked', () => {


        win.set_icon_geometry(_itemRect(item));
        win.activate(global.get_current_time());
    });

    return item;
}

function _syncSeparator(info) {


    const wanted = !dashEndsWithSeparator(info.dash) &&
        (info.tiles.length > 0 || !!info.trashItem);

    if (wanted && !info.separator) {
        info.separator = makeDashSeparator(info.dash);
        info.strip.insert_child_at_index(info.separator, 0);
    } else if (!wanted && info.separator) {
        info.separator.destroy();
        info.separator = null;
    }
}





function _queueSeparatorSync() {
    if (sources.separatorSync || !enabled)
        return;

    sources.separatorSync = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.separatorSync = 0;
        docks.forEach(_syncSeparator);
        return GLib.SOURCE_REMOVE;
    });
}



function _findTrashItem(dash) {
    return dash._box.get_children().find(isTrashItem) ?? null;
}








function _adoptTrash(info) {
    const item = _findTrashItem(info.dash);
    if (!item || item === info.trashItem)
        return;

    info.trashItem?.destroy();
    info.dash._box.remove_child(item);
    info.strip.add_child(item);


    item.visible = true;


    item.show(false);
    info.trashItem = item;
    _syncDock(info);
}

function _queueTrashAdoption() {
    if (sources.trashAdoption || !enabled)
        return;

    sources.trashAdoption = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.trashAdoption = 0;
        docks.forEach(_adoptTrash);
        return GLib.SOURCE_REMOVE;
    });
}

function _releaseTrash(info, removeActors) {


    const pending = removeActors ? _findTrashItem(info.dash) : null;
    if (pending)
        pending.visible = true;

    if (!info.trashItem)
        return;

    if (removeActors && !pending) {
        info.strip.remove_child(info.trashItem);
        info.dash._box.add_child(info.trashItem);
    }
    info.trashItem = null;
}

function _dropTrash() {


    for (const info of docks) {
        info.trashItem?.destroy();
        info.trashItem = null;
    }
    _syncDocks();
}



function _itemRect(item) {
    const [x, y] = item.get_transformed_position();
    const [width, height] = item.get_transformed_size();
    return new Mtk.Rectangle({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
    });
}







function _nextSlotRect(info) {
    const { dash, strip, trashItem } = info;
    const size = Math.round(dash.iconSize * scaleFactor());
    if (trashItem) {
        const rect = _itemRect(trashItem);
        rect.width = size;
        rect.height = size;
        return rect;
    }

    const isHorizontal = dash._isHorizontal ?? true;
    const [x, y] = strip.get_transformed_position();
    const [width, height] = strip.get_transformed_size();
    return new Mtk.Rectangle({
        x: Math.round(isHorizontal ? x + width : x),
        y: Math.round(isHorizontal ? y : y + height),
        width: size,
        height: size,
    });
}

function _dockForWindow(win) {
    const monitorIndex = win.get_monitor();
    return docks.find(info => info.dash._monitorIndex === monitorIndex) ?? docks[0];
}






function _applyIconGeometry() {
    const windows = global.get_window_actors()
        .map(actor => actor.meta_window)
        .filter(win => _isEligible(win) &&
            !order.includes(win) && !restoring.has(win));

    for (const info of docks) {
        if (!info.strip.get_stage())
            continue;

        const slot = _nextSlotRect(info);

        for (const { win, item } of info.tiles) {

            const rect = _itemRect(item);
            win.set_icon_geometry(rect.width && rect.height ? rect : slot);
        }

        for (const win of windows) {
            if (_dockForWindow(win) === info)
                win.set_icon_geometry(slot);
        }
    }
}






function _queueIconGeometry() {
    if (!enabled)
        return;

    if (sources.geometryUpdate)
        GLib.Source.remove(sources.geometryUpdate);
    sources.geometryUpdate = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GEOMETRY_SETTLE, () => {
        sources.geometryUpdate = 0;
        _applyIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}

function _attachDock(dockContainer) {
    const dash = dashOf(dockContainer);
    if (!dash?._box || !dash._boxContainer)
        return;
    if (docks.some(info => info.dash === dash))
        return;

    const isHorizontal = dash._isHorizontal ?? true;
    const strip = makeStrip(dash, 'kiwi-minimized-strip');
    dash._boxContainer.insert_child_above(strip, dash._box);

    const info = {
        dash,
        strip,
        iconSize: dash.iconSize,
        signals: [],
        tiles: [],
        separator: null,
        trashItem: null,
    };



    const allocationId = strip.connect('notify::allocation', () => _queueIconGeometry());
    info.signals.push([strip, allocationId]);


    const sizeId = dash._box.connect(
        isHorizontal ? 'notify::height' : 'notify::width', () => {
            if (dash.iconSize !== info.iconSize)
                _syncDock(info);
        });
    info.signals.push([dash._box, sizeId]);



    const addedId = dash._box.connect('child-added', (_box, child) => {
        if (isTrashItem(child)) {
            child.hide();
            _queueTrashAdoption();
        } else {
            _queueSeparatorSync();
        }
    });
    info.signals.push([dash._box, addedId]);


    const removedId = dash._box.connect('child-removed', () => _queueSeparatorSync());
    info.signals.push([dash._box, removedId]);

    const destroyId = dash.connect('destroy', () => _detachDock(info, false));
    info.signals.push([dash, destroyId]);

    docks.push(info);
    _adoptTrash(info);
    _syncDock(info);
}

function _detachDock(info, removeActors = true) {
    disconnectAll(info.signals);
    info.signals = [];

    _releaseTrash(info, removeActors);

    if (removeActors) {
        info.strip.destroy_all_children();
        info.strip.destroy();
    }

    docks = docks.filter(d => d !== info);
}



export function enable() {
    if (enabled)
        return;
    enabled = true;



    d2dSettings = dockSettings();
    if (d2dSettings) {
        const trashSettingId = d2dSettings.connect('changed::show-trash', () => {
            if (d2dSettings.get_boolean('show-trash'))
                _queueTrashAdoption();
            else
                _dropTrash();
        });
        globalSignals.push([d2dSettings, trashSettingId]);
    }

    const createdId = global.display.connect('window-created',
        (_display, win) => _trackWindow(win));
    globalSignals.push([global.display, createdId]);



    const mapId = global.window_manager.connect('map', () => _queueIconGeometry());
    globalSignals.push([global.window_manager, mapId]);



    const destroyId = global.window_manager.connect('destroy', () => _queueIconGeometry());
    globalSignals.push([global.window_manager, destroyId]);



    const windows = global.get_window_actors().map(actor => actor.meta_window);
    for (const win of snapshots.keys()) {
        if (!windows.includes(win) || !win.minimized)
            snapshots.delete(win);
    }
    windows.forEach(_trackWindow);


    if (Main.layoutManager._startingUp) {
        const startupId = Main.layoutManager.connect('startup-complete', () => _watchDocks());
        globalSignals.push([Main.layoutManager, startupId]);
        return;
    }
    _watchDocks();
}

function _watchDocks() {
    watchDocks({
        attach: _attachDock,
        count: () => docks.length,
        globalSignals,
        sources,
    });
}

export function disable() {
    enabled = false;

    for (const key of Object.keys(sources)) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    disconnectAll(globalSignals);
    globalSignals = [];

    [...docks].forEach(info => _detachDock(info));

    for (const [win, ids] of windowSignals) {
        disconnectAll(ids.map(id => [win, id]));


        win.set_icon_geometry(null);
    }
    windowSignals.clear();
    restoring.clear();
    order = [];

    d2dSettings = null;
}
