// SPDX-License-Identifier: GPL-3.0-or-later





import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DashItemContainer } from 'resource:///org/gnome/shell/ui/dash.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const CONTAINER_NAME = 'dashtodockContainer';
const D2D_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const D2D_UUIDS = [
    'dash-to-dock@micxgx.gmail.com',
    'ubuntu-dock@ubuntu.com',
    'dash2dock-motion@unmade.space',
];


const DOCK_SCHEMA_IDS = {
    'dash2dock-motion@unmade.space': 'org.gnome.shell.extensions.dash2dock-motion',
};
const DOCK_SEARCH_INTERVAL = 1000;
const DOCK_SEARCH_TRIES = 10;
const PRESS_EFFECT = 'kiwi-press-darken';
const PRESS_BRIGHTNESS = -0.6;



export function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scaleFactor;
}

export function prefersDark() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK;
}

export function disconnectAll(pairs) {
    for (const [object, id] of pairs)
        object.disconnect(id);
}














export function isDock(actor) {
    return actor.name === CONTAINER_NAME && actor._slider !== undefined;
}


export function dockContainers() {
    return Main.uiGroup.get_children().filter(isDock);
}







export function dashOf(dockContainer) {
    const dashBox = dockContainer._slider?.get_child();
    return dashBox?.get_children().find(child => child.name === 'dash') ?? null;
}

function isHorizontal(dash) {
    return dash._isHorizontal ?? true;
}










export function watchDocks({ attach, count, globalSignals, sources }) {
    const uiGroupId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (isDock(actor))
            attach(actor);
    });
    globalSignals.push([Main.uiGroup, uiGroupId]);

    dockContainers().forEach(attach);
    if (count() > 0)
        return;

    let attempts = 0;
    if (sources.dockSearch)
        GLib.Source.remove(sources.dockSearch);
    sources.dockSearch = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DOCK_SEARCH_INTERVAL, () => {
        dockContainers().forEach(attach);
        if (count() > 0 || ++attempts >= DOCK_SEARCH_TRIES) {
            sources.dockSearch = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}









export function makeStrip(dash, name) {
    const horizontal = isHorizontal(dash);
    return new St.BoxLayout({
        name,
        orientation: horizontal
            ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
        x_align: horizontal ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
        y_align: horizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
    });
}

export function makeDashSeparator(dash) {
    const horizontal = isHorizontal(dash);
    return new St.Widget({
        style_class: 'dash-separator',
        x_align: horizontal ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        y_align: horizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        width: horizontal ? -1 : dash.iconSize,
        height: horizontal ? dash.iconSize : -1,
    });
}

let d2dSettings;





function lookupDockSchema() {
    const source = Gio.SettingsSchemaSource.get_default();





    const active = D2D_UUIDS.filter(uuid =>
        Main.extensionManager.lookup(uuid)?.state === ExtensionState.ACTIVE);
    const rest = D2D_UUIDS.filter(uuid => !active.includes(uuid));

    for (const uuid of [...active, ...rest]) {
        const dir = Main.extensionManager.lookup(uuid)?.dir.get_child('schemas');
        if (!dir?.get_child('gschemas.compiled').query_exists(null))
            continue;
        const own = Gio.SettingsSchemaSource.new_from_directory(dir.get_path(), source, true)
            .lookup(DOCK_SCHEMA_IDS[uuid] ?? D2D_SCHEMA, true);
        if (own)
            return own;
    }


    return source?.lookup(D2D_SCHEMA, true) ?? null;
}


export function dockSettings() {
    if (d2dSettings === undefined) {
        const schema = lookupDockSchema();
        d2dSettings = schema ? new Gio.Settings({ settings_schema: schema }) : null;
    }
    return d2dSettings;
}





export function dockActive() {
    return D2D_UUIDS.some(uuid =>
        Main.extensionManager.lookup(uuid)?.state === ExtensionState.ACTIVE);
}

export function isDockExtension(extension) {
    return D2D_UUIDS.includes(extension.uuid);
}







function tooltipsHidden() {
    return dockSettings()?.get_boolean('hide-tooltip') ?? false;
}









export function makeDashItem(dash, child, labelText) {
    const sibling = dash._box.get_children().find(c => typeof c.setLabelText === 'function');
    const Container = sibling ? sibling.constructor : DashItemContainer;
    const item = sibling ? new Container(dash._position) : new Container();
    item.setChild(child);
    item.setLabelText(labelText);
    dash._hookUpLabel(item);


    const showLabel = item.showLabel.bind(item);
    item.showLabel = () => {
        if (!tooltipsHidden())
            showLabel();
    };
    return item;
}

export function isTrashItem(child) {
    return !!child.child?._delegate?.app?.isTrash;
}









export function dashEndsWithSeparator(dash) {
    const last = dash._box.get_children().findLast(child => !isTrashItem(child));
    return !!last?.get_style_class_name?.()?.includes('dash-separator');
}












export function applyIconOffset(dash, actor) {
    const button = dash._box.get_children().find(c => c.child?._delegate?.icon)?.child;
    let offset = 0;

    if (button) {
        const icon = button._delegate.icon;
        button.ensure_style();
        icon.ensure_style();
        const [near, far] = isHorizontal(dash)
            ? [St.Side.TOP, St.Side.BOTTOM] : [St.Side.LEFT, St.Side.RIGHT];
        const step = node => node.get_padding(near) - node.get_padding(far);
        offset = Math.round(
            (step(button.get_theme_node()) + step(icon.get_theme_node())) / 2);
    }

    if (isHorizontal(dash))
        actor.translation_y = offset;
    else
        actor.translation_x = offset;
}









export function syncDarken(button, active = true) {
    if (active && button.pressed) {
        const effect = new Clutter.BrightnessContrastEffect({ name: PRESS_EFFECT });
        effect.set_brightness(PRESS_BRIGHTNESS);
        button.add_effect(effect);
    } else {
        button.remove_effect_by_name(PRESS_EFFECT);
    }
}
