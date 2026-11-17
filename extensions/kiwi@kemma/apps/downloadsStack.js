// SPDX-License-Identifier: GPL-3.0-or-later





import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    applyIconOffset, dashEndsWithSeparator, dashOf, disconnectAll, makeDashItem,
    makeDashSeparator, makeStrip, prefersDark, scaleFactor, syncDarken, watchDocks,
} from './dockUtils.js';

const MAX_ROWS = 10;
const FILE_ICON = 1.3;
const FOLDER_SCALE = 1.1;
const ROW_SPACING = 1.2;
const FAN_START = 3;
const FAN_STEP = 1.4;
const NAME_LIMIT = 36;
const EDGE_MARGIN = 24;


const ROW_ANIMATION = 150;
const ROW_STAGGER = 12;



const ROW_CLEAR = 40;


const STACK_DEPTH = 5;
const STACK_STEP = 0.04;
const STACK_TILT = 2.2;
const REFRESH_DELAY = 400;


const STACK_EXTENT = 1;



const BEHIND_SIZE = 0.6;
const BEHIND_LIFT = 0.24;
const BEHIND_SHIFT = 0.06;
const BEHIND_TILT = 6;
const LIST_BATCH = 64;
const LIST_ATTRIBUTES = [
    'standard::name',
    'standard::display-name',
    'standard::is-hidden',
    'standard::is-backup',
    'standard::icon',
    'time::modified',
    'thumbnail::path',
].join(',');

let enabled = false;
let docks = [];
let globalSignals = [];
let fan = null;
let recent = [];
let recentCount = 0;
let recentKey = '';
let folderMonitor = null;
let behindFolder = false;
let gettextFunc = message => message;
const sources = { dockSearch: 0, replace: 0, refresh: 0 };



function _downloadsFile() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

function _openUri(uri) {
    Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
}





function _refresh() {
    _listDownloads(files => {
        if (!enabled)
            return;
        recent = files.slice(0, MAX_ROWS);
        recentCount = files.length;



        const key = `${recentCount}:${recent.map(info => [
            info.get_name(),
            _modified(info),
            info.get_attribute_byte_string('thumbnail::path') ?? '',
        ].join('@')).join('|')}`;
        if (key === recentKey)
            return;
        recentKey = key;

        docks.forEach(_syncButton);
    });
}

function _queueRefresh() {
    if (sources.refresh)
        GLib.Source.remove(sources.refresh);

    sources.refresh = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY, () => {
        sources.refresh = 0;
        _refresh();
        return GLib.SOURCE_REMOVE;
    });
}








function _listDownloads(callback) {
    _downloadsFile().enumerate_children_async(
        LIST_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
        (source, result) => {
            let enumerator = null;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (_) {

            }
            if (enumerator)
                _readBatch(enumerator, [], callback);
            else
                callback([]);
        });
}

function _readBatch(enumerator, found, callback) {
    enumerator.next_files_async(LIST_BATCH, GLib.PRIORITY_DEFAULT, null,
        (source, result) => {
            let infos = [];
            try {
                infos = source.next_files_finish(result);
            } catch (_) {
                infos = [];
            }

            if (infos.length === 0) {
                source.close_async(GLib.PRIORITY_DEFAULT, null, null);
                found.sort((a, b) => _modified(b) - _modified(a));
                callback(found);
                return;
            }

            for (const info of infos) {
                if (!info.get_is_hidden() && !info.get_is_backup())
                    found.push(info);
            }
            _readBatch(source, found, callback);
        });
}

function _modified(info) {
    return info.get_attribute_uint64('time::modified');
}









function _fileIcon(info, size) {
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: size * scaleFactor(),
        height: size * scaleFactor(),
    });

    const thumbnail = info.get_attribute_byte_string('thumbnail::path');
    const [format, imageWidth, imageHeight] = thumbnail
        ? GdkPixbuf.Pixbuf.get_file_info(thumbnail) : [null, 0, 0];

    if (format) {



        const fit = Math.min(size / imageWidth, size / imageHeight);
        const texture = St.TextureCache.get_default().load_file_async(
            Gio.File.new_for_path(thumbnail),
            Math.round(imageWidth * fit), Math.round(imageHeight * fit),
            scaleFactor(), 1);



        const framed = imageWidth !== imageHeight;


        const frame = new St.Bin({
            style_class: framed ? 'kiwi-fan-thumbnail' : '',
            child: texture,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });



        frame.connect('notify::allocation', () => {
            const allocation = frame.get_allocation_box();
            frame.offscreen_redirect =
                allocation.get_width() >= 1 && allocation.get_height() >= 1
                    ? Clutter.OffscreenRedirect.ALWAYS : 0;
        });
        box.add_child(frame);
    } else {
        box.add_child(new St.Icon({
            style_class: 'kiwi-fan-file-icon',
            gicon: info.get_icon(),
            icon_size: size,
        }));
    }

    return box;
}

function _displayName(info) {
    const name = info.get_display_name();
    return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}












function _makeRow(text, iconActor, iconClass, onActivate) {
    const row = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    const label = new St.Label({
        style_class: 'kiwi-fan-label',
        text,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const icon = new St.Button({
        style_class: iconClass,
        child: iconActor,
        y_align: Clutter.ActorAlign.CENTER,
    });


    icon.connect('notify::pressed', () => syncDarken(icon));
    icon.connect('clicked', onActivate);

    if (prefersDark()) {
        label.add_style_class_name('dark');
        icon.add_style_class_name('dark');
    }

    row.add_child(label);
    row.add_child(icon);
    row.label = label;
    row.iconButton = icon;
    return row;
}











function _placeRow(row, x, y, degrees) {
    const [, , width, height] = row.get_preferred_size();
    const [, , iconWidth] = row.iconButton.get_preferred_size();
    row.set_size(width, height);
    row.set_position(Math.round(x - width + iconWidth / 2), Math.round(y - height / 2));

    row.set_pivot_point((width - iconWidth / 2) / width, 0.5);
    row.rotation_angle_z = degrees;
}







function _rowPivot(row) {
    const [x, y] = row.get_position();
    const [pivotX, pivotY] = row.get_pivot_point();
    return [x + row.width * pivotX, y + row.height * pivotY];
}









function _animateRowIn(row, index) {
    const [pivotX, pivotY] = _rowPivot(row);
    const { start, card } = row;
    const tilt = row.rotation_angle_z;

    row.set({
        translation_x: start.x - pivotX,
        translation_y: start.y - pivotY,
        scale_x: start.scale,
        scale_y: start.scale,
        rotation_angle_z: start.tilt,
    });
    row.label.opacity = 0;

    const delay = index * ROW_STAGGER;
    row.label.ease({
        opacity: 255,
        duration: ROW_ANIMATION,
        delay,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });



    card?.ease({
        opacity: 0,
        duration: 1,
        delay: behindFolder ? delay + ROW_CLEAR : delay,
    });
    row.ease({
        translation_x: 0,
        translation_y: 0,
        scale_x: 1,
        scale_y: 1,
        rotation_angle_z: tilt,
        duration: ROW_ANIMATION,
        delay,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,



        onComplete: () => {
            row.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
        },
    });
}

function _showFan(info) {


    _lockDock(info, true);

    const [buttonX, buttonY] = info.button.get_transformed_position();
    const [buttonWidth, buttonHeight] = info.button.get_transformed_size();
    const geometry = Main.layoutManager.monitors[info.dash._monitorIndex] ??
        Main.layoutManager.primaryMonitor;
    const scale = scaleFactor();
    const iconSize = Math.round(info.dash.iconSize * FILE_ICON);
    const spacing = Math.round(iconSize * scale * ROW_SPACING);



    const dir = _fanDir(info.dash);
    const anchorX = buttonX + buttonWidth / 2;
    const anchorY = dir < 0 ? buttonY : buttonY + buttonHeight;


    const stack = info.button.child;
    const cards = stack.cards ?? [];
    const pileX = anchorX;
    const pileY = buttonY + buttonHeight / 2;
    const pile = _pileMetrics(info.dash);
    const cardStart = depth => {
        const { x, y, tilt } = _cardOffset(pile, depth);
        return { x: pileX + x, y: pileY + y, scale: pile.size / iconSize, tilt };
    };


    const reach = dir < 0
        ? anchorY - geometry.y : geometry.y + geometry.height - anchorY;
    const room = Math.floor((reach - EDGE_MARGIN) / spacing) - 1;
    const shown = recent.slice(0, Math.max(0, Math.min(MAX_ROWS, room)));

    const overlay = new St.Widget({
        name: 'kiwi-downloads-fan',
        reactive: true,
        can_focus: true,
        x: 0,
        y: 0,
        width: global.stage.width,
        height: global.stage.height,
    });



    Main.layoutManager.addTopChrome(overlay);




    let rowParent = overlay;
    if (behindFolder) {
        const [, stackY] = stack.get_transformed_position();
        const [, stackHeight] = stack.get_transformed_size();
        const edge = Math.round(dir < 0 ? stackY : stackY + stackHeight);
        rowParent = new St.Widget({
            width: global.stage.width,
            height: global.stage.height,
        });
        rowParent.set_clip(0, dir < 0 ? 0 : edge, global.stage.width,
            dir < 0 ? edge : global.stage.height - edge);
        overlay.add_child(rowParent);
    }

    const folder = _downloadsFile();
    const rows = [];

    for (const file of shown) {
        rows.push(_makeRow(
            _displayName(file), _fileIcon(file, iconSize), 'kiwi-fan-icon',
            () => {
                _openUri(folder.get_child(file.get_name()).get_uri());
                _closeFan();
            }));
    }

    const rest = recentCount - shown.length;
    let text = gettextFunc('Open in Files');
    if (rest > 0)
        text = gettextFunc('%d More in Files').replace('%d', rest);
    else if (shown.length === 0)
        text = gettextFunc('Empty');



    const more = _makeRow(
        text,
        new St.Icon({
            style_class: 'kiwi-fan-more-icon',
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(
                    GLib.get_home_dir() +
                    '/.local/share/gnome-shell/extensions/kiwi@kemma/icons/fan-more.svg'),
            }),
            icon_size: Math.round(iconSize * 0.3),
        }),
        'kiwi-fan-more',
        () => {
            _openUri(folder.get_uri());
            _closeFan();
        });
    more.add_style_class_name('kiwi-fan-more-row');
    rows.push(more);



    let x = anchorX;
    let y = anchorY;
    let angle = FAN_START;
    rows.forEach((row, index) => {


        rowParent.insert_child_at_index(row, 0);
        x += Math.sin(angle * Math.PI / 180) * spacing;
        y += dir * Math.cos(angle * Math.PI / 180) * spacing;


        _placeRow(row, x, y, -dir * angle);
        row.card = cards[index] ?? null;


        row.start = cardStart(Math.min(index, Math.max(0, pile.depth - 1)));
        _animateRowIn(row, index);
        angle += FAN_STEP;
    });



    for (const card of cards.slice(rows.length))
        card.ease({ opacity: 0, duration: 1, delay: rows.length * ROW_STAGGER });

    const grab = Main.pushModal(overlay, { actionMode: Shell.ActionMode.POPUP });



    overlay.connect('button-press-event', (actor, event) => {
        if (global.stage.get_event_actor(event) !== actor)
            return Clutter.EVENT_PROPAGATE;
        _closeFan();
        return Clutter.EVENT_STOP;
    });
    overlay.connect('key-press-event', (_actor, event) => {
        if (event.get_key_symbol() !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        _closeFan();
        return Clutter.EVENT_STOP;
    });

    fan = { overlay, grab, rows, info };

}

function _dropOverlay(overlay) {
    if (!overlay.get_stage())
        return;
    Main.layoutManager.removeChrome(overlay);
    overlay.destroy();
}









function _lockDock(info, locked) {
    const container = info.container;

    if (!container._updateDashVisibility || !container.get_stage())
        return;

    info.dash.requiresVisibility = locked;
    if (locked) {
        container._updateDashVisibility();

        container._ignoreHover = true;
    } else {
        container._ignoreHover = false;
        container._box.sync_hover();
        container._updateDashVisibility();
    }
}

function _closeFan() {
    if (!fan)
        return;

    const { overlay, grab, rows, info } = fan;
    fan = null;

    Main.popModal(grab);
    _lockDock(info, false);
    overlay.reactive = false;




    let folding = true;
    let landed = false;
    const finish = () => {
        if (folding) {
            landed = true;
            return;
        }
        if (sheet)
            _dropFanSheet({sheet});
        _dropOverlay(overlay);


        _syncButton(info);
    };




    const stack = info.button?.child;
    rows.forEach((row, index) => {
        const [pivotX, pivotY] = _rowPivot(row);
        const { start, card } = row;
        const delay = (rows.length - 1 - index) * ROW_STAGGER;
        row.offscreen_redirect = 0;
        row.label.ease({
            opacity: 0,
            duration: ROW_ANIMATION,
            delay,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });


        if (behindFolder) {
            card?.ease({
                opacity: 255,
                duration: 1,
                delay: delay + ROW_ANIMATION - ROW_CLEAR,
            });
        }
        row.ease({
            translation_x: start.x - pivotX,
            translation_y: start.y - pivotY,
            scale_x: start.scale,
            scale_y: start.scale,
            rotation_angle_z: start.tilt,
            duration: ROW_ANIMATION,
            delay,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,


            onStopped: () => {

                if (card)
                    card.opacity = 255;


                if (index === 0)
                    finish();
            },
        });
    });

    for (const card of stack?.cards.slice(rows.length) ?? []) {
        card.ease({
            opacity: 255,
            duration: 1,
            delay: (rows.length - 1) * ROW_STAGGER,
        });
    }

    folding = false;
    if (landed)
        finish();
}

function _toggleFan(info) {


    if (!_fansOut(info.dash)) {
        _openUri(_downloadsFile().get_uri());
        return;
    }

    if (fan)
        _closeFan();
    else
        _showFan(info);
}










function _fansOut(dash) {
    return dash._position === St.Side.BOTTOM || dash._position === St.Side.TOP;
}








function _fanDir(dash) {
    return dash._position === St.Side.TOP ? 1 : -1;
}








function _pileMetrics(dash) {
    const depth = Math.min(recent.length, STACK_DEPTH);
    const scale = scaleFactor();
    const dir = _fanDir(dash);
    if (behindFolder) {
        return {
            depth,
            dir,
            size: Math.round(dash.iconSize * BEHIND_SIZE),
            step: Math.round(dash.iconSize * BEHIND_SHIFT * scale),
            lift: Math.round(dash.iconSize * BEHIND_LIFT * scale),
        };
    }

    const span = Math.max(0, depth - 1) * STACK_STEP;
    return {
        depth,
        dir,
        size: Math.round(dash.iconSize * (STACK_EXTENT - span)),
        step: Math.round(dash.iconSize * STACK_STEP * scale),
        lift: 0,
    };
}









function _cardOffset(pile, depth) {


    if (!behindFolder) {
        return {
            x: depth * pile.step,
            y: pile.dir * depth * pile.step,
            tilt: -pile.dir * depth * STACK_TILT,
        };
    }



    const out = Math.ceil(depth / 2) * (depth % 2 ? 1 : -1);
    return {
        x: out * pile.step,
        y: pile.dir * pile.lift,
        tilt: -pile.dir * out * BEHIND_TILT,
    };
}








function _stackIcon(dash) {
    const scale = scaleFactor();
    const box = new St.Widget({
        style_class: behindFolder ? 'kiwi-downloads-stack behind' : 'kiwi-downloads-stack',
        layout_manager: new Clutter.BinLayout(),
        width: Math.round(dash.iconSize * scale),
        height: Math.round(dash.iconSize * scale),
    });

    const folder = new St.Icon({
        gicon: new Gio.ThemedIcon({ name: 'folder-download' }),
        icon_size: dash.iconSize,
    });


    folder.set_pivot_point(0.5, 0.5);
    folder.set_scale(FOLDER_SCALE, FOLDER_SCALE);



    box.cards = [];
    box.add_child(folder);
    return box;
}

function _makeButton(info) {
    const { dash } = info;
    const button = new St.Button({
        style_class: 'kiwi-downloads-item',
        can_focus: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.set_child(_stackIcon(dash));


    applyIconOffset(dash, button);

    button.connect('notify::pressed', () => _syncPress(info));
    button.connect('clicked', () => _toggleFan(info));
    return button;
}

function _syncButton(info) {


    if (info.button && !fan)
        info.button.set_child(_stackIcon(info.dash));
}








function _syncPress(info) {
    syncDarken(info.button, info.container.has_style_class_name('kiwi-dock-styled'));
}

function _buildItem(info) {
    info.iconSize = info.dash.iconSize;
    info.button = _makeButton(info);
    info.item = makeDashItem(info.dash, info.button, gettextFunc('Downloads'));
    info.item.connect('destroy', () => {
        info.item = null;
        info.button = null;
        _queueReplace();
    });
    info.item.show(false);
}








function _placeItem(info) {
    if (!info.item)
        _buildItem(info);

    const strip = info.dash._boxContainer.get_children()
        .find(child => child.name === 'kiwi-minimized-strip') ?? info.strip;

    if (info.item.get_parent() !== strip) {
        info.item.get_parent()?.remove_child(info.item);
        _clearStripSignal(info);
        strip.add_child(info.item);


        const addedId = strip.connect('child-added', () => _queueReplace());


        const goneId = strip.connect('destroy', () => (info.stripSignal = null));
        info.stripSignal = [strip, addedId, goneId];
    }



    const first = strip.get_first_child();
    const divider = first?.get_style_class_name?.()?.includes('dash-separator');
    const index = divider ? 1 : 0;


    if (strip.get_children().indexOf(info.item) !== index)
        strip.set_child_at_index(info.item, index);

    _syncSeparator(info, strip === info.strip);
}







function _clearStripSignal(info) {
    if (!info.stripSignal)
        return;
    const [strip, ...ids] = info.stripSignal;
    for (const id of ids)
        strip.disconnect(id);
    info.stripSignal = null;
}









function _syncSeparator(info, own) {
    const wanted = own && !dashEndsWithSeparator(info.dash);

    if (wanted && !info.separator) {
        info.separator = makeDashSeparator(info.dash);
        info.strip.insert_child_at_index(info.separator, 0);
    } else if (!wanted && info.separator) {
        info.separator.destroy();
        info.separator = null;
    }
}






function _queueReplace() {
    if (sources.replace || !enabled)
        return;
    sources.replace = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.replace = 0;
        docks.forEach(_placeItem);
        return GLib.SOURCE_REMOVE;
    });
}

function _attachDock(dockContainer) {
    const dash = dashOf(dockContainer);
    if (!dash?._box || !dash._boxContainer)
        return;
    if (docks.some(existing => existing.dash === dash))
        return;

    const isHorizontal = dash._isHorizontal ?? true;
    const strip = makeStrip(dash, 'kiwi-downloads-strip');
    dash._boxContainer.insert_child_above(strip, dash._box);

    const info = {
        dash,
        container: dockContainer,
        strip,
        item: null,
        button: null,
        iconSize: dash.iconSize,
        signals: [],
        stripSignal: null,
        separator: null,
    };



    const containerId = dash._boxContainer.connect('child-added', () => _queueReplace());
    info.signals.push([dash._boxContainer, containerId]);



    const boxAddedId = dash._box.connect('child-added', () => _queueReplace());
    info.signals.push([dash._box, boxAddedId]);
    const boxRemovedId = dash._box.connect('child-removed', () => _queueReplace());
    info.signals.push([dash._box, boxRemovedId]);


    const sizeId = dash._box.connect(
        isHorizontal ? 'notify::height' : 'notify::width', () => {
            if (dash.iconSize === info.iconSize || !info.button)
                return;
            info.iconSize = dash.iconSize;
            _syncButton(info);

            applyIconOffset(dash, info.button);
        });
    info.signals.push([dash._box, sizeId]);

    const destroyId = dash.connect('destroy', () => _detachDock(info, false));
    info.signals.push([dash, destroyId]);

    docks.push(info);
    _placeItem(info);
    _queueReplace();
}

function _detachDock(info, removeActors = true) {
    disconnectAll(info.signals);
    info.signals = [];

    _clearStripSignal(info);

    _closeFan();

    if (removeActors) {
        info.item?.destroy();
        info.strip.destroy();
    }
    info.item = null;
    info.button = null;
    info.separator = null;

    docks = docks.filter(other => other !== info);
}

function _watchDocks() {
    watchDocks({
        attach: _attachDock,
        count: () => docks.length,
        globalSignals,
        sources,
    });
}



export function enable(gettext, settings) {
    gettextFunc = gettext;
    if (enabled)
        return;
    enabled = true;

    behindFolder = settings.get_boolean('downloads-behind-folder');
    const layoutId = settings.connect('changed::downloads-behind-folder', () => {
        behindFolder = settings.get_boolean('downloads-behind-folder');
        docks.forEach(_syncButton);
    });
    globalSignals.push([settings, layoutId]);

    const overviewId = Main.overview.connect('showing', () => _closeFan());
    globalSignals.push([Main.overview, overviewId]);


    folderMonitor = _downloadsFile().monitor_directory(
        Gio.FileMonitorFlags.WATCH_MOVES, null);
    const changedId = folderMonitor.connect('changed', () => _queueRefresh());
    globalSignals.push([folderMonitor, changedId]);
    _refresh();


    if (Main.layoutManager._startingUp) {
        const startupId = Main.layoutManager.connect('startup-complete', () => _watchDocks());
        globalSignals.push([Main.layoutManager, startupId]);
        return;
    }
    _watchDocks();
}

export function disable() {
    enabled = false;

    for (const key of Object.keys(sources)) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    if (fan) {
        Main.popModal(fan.grab);
        _lockDock(fan.info, false);
        _dropOverlay(fan.overlay);
        fan = null;
    }

    disconnectAll(globalSignals);
    globalSignals = [];

    [...docks].forEach(info => _detachDock(info));

    folderMonitor?.cancel();
    folderMonitor = null;
    recent = [];
    recentCount = 0;
    recentKey = '';

    gettextFunc = message => message;
}
