// SPDX-License-Identifier: GPL-3.0-or-later























import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { dashOf, dockSettings, disconnectAll, prefersDark, watchDocks } from './dockUtils.js';


const LIGHT_CLASS = 'kiwi-dock-light';
const DARK_CLASS = 'kiwi-dock-dark';

const SCHEME_LIGHT_CLASS = 'kiwi-dock-scheme-light';
const SCHEME_DARK_CLASS = 'kiwi-dock-scheme-dark';



const DOT_KEY = 'custom-theme-running-dots-color';
const PILL_KEY = 'background-color';
const SAVED_KEYS = [DOT_KEY, PILL_KEY];




const DOT_COLOR = { light: 'rgb(28,28,28)', dark: 'rgb(250,250,251)' };







const PILL_COLOR = { light: 'rgb(120,120,120)', dark: 'rgb(28,28,28)' };

const BAND = 4;
const GAP = 6;
const SHADOW = 24;
const MIN_OUTSIDE = 160;
const SETTLE = 200;



const LIGHT_ENTER = 0.62;
const LIGHT_LEAVE = 0.5;

let enabled = false;
let d2d;
let bgSettings;
let screenshot;
let globalSignals = [];
let windowSignals = [];
let sources = {};
let savedColors = null;
let docks = [];
let mode = null;
let scheme = null;
let settleId = 0;
let sampling = false;








function _band(container) {
    const dash = dashOf(container);
    const pill = dash?.get_children().find(child =>
        child.get_style_class_name?.()?.includes('dash-background'));
    const monitor = Main.layoutManager.findMonitorForActor(container);
    if (!pill?.has_allocation() || !monitor)
        return null;

    const [px, py] = pill.get_transformed_position();
    const [pw, ph] = pill.get_transformed_size();
    if (pw < 1 || ph < 1)
        return null;

    const position = d2d.get_string('dock-position');
    const vertical = position === 'LEFT' || position === 'RIGHT';
    const span = vertical ? monitor.height : monitor.width;
    const covered = vertical ? ph : pw;






    const inset = vertical ? pw / 2 : ph / 2;
    const rect = vertical
        ? {
            x: position === 'LEFT'
                ? monitor.x + inset : monitor.x + monitor.width - inset,
            y: monitor.y, width: BAND, height: monitor.height,
        }
        : {
            x: monitor.x,
            y: position === 'TOP'
                ? monitor.y + inset : monitor.y + monitor.height - inset,
            width: monitor.width, height: BAND,
        };




    if (span - covered >= MIN_OUTSIDE) {
        const start = (vertical ? py : px) - (vertical ? monitor.y : monitor.x) - SHADOW;
        return {
            rect: _clamp(rect, monitor),
            skip: [Math.max(0, start / span), Math.min(1, (start + covered + 2 * SHADOW) / span)],
        };
    }



    const thickness = 2 * inset + GAP + BAND;
    const outside = vertical
        ? {
            ...rect,
            x: position === 'LEFT'
                ? monitor.x + thickness : monitor.x + monitor.width - thickness,
        }
        : {
            ...rect,
            y: position === 'TOP'
                ? monitor.y + thickness : monitor.y + monitor.height - thickness,
        };
    return { rect: _clamp(outside, monitor), skip: [0, 0] };
}

function _clamp(rect, monitor) {
    const x = Math.max(monitor.x, Math.min(Math.round(rect.x), monitor.x + monitor.width - 1));
    const y = Math.max(monitor.y, Math.min(Math.round(rect.y), monitor.y + monitor.height - 1));
    return {
        x, y,
        width: Math.max(1, Math.min(Math.round(rect.width), monitor.x + monitor.width - x)),
        height: Math.max(1, Math.min(Math.round(rect.height), monitor.y + monitor.height - y)),
    };
}







function _luminance(pixbuf, skip) {
    const pixels = pixbuf.get_pixels();
    const stride = pixbuf.get_rowstride();
    const channels = pixbuf.get_n_channels();
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const horizontal = width >= height;
    const length = horizontal ? width : height;
    const from = Math.round(skip[0] * length);
    const to = Math.round(skip[1] * length);

    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const along = horizontal ? x : y;
            if (along >= from && along < to)
                continue;
            const i = y * stride + x * channels;
            sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            count++;
        }
    }
    return count ? sum / count / 255 : 0;
}

function _read() {
    if (sampling || Main.overview.visible)
        return;



    const band = docks.reduce((found, { container }) => found ?? _band(container), null);
    if (!band || !screenshot)
        return;

    const { rect, skip } = band;
    const stream = Gio.MemoryOutputStream.new_resizable();
    sampling = true;
    screenshot.screenshot_area(rect.x, rect.y, rect.width, rect.height, stream,
        (source, result) => {
            sampling = false;
            if (!enabled)
                return;
            try {
                source.screenshot_area_finish(result);
                stream.close(null);
                const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(
                    Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes()), null);
                _apply(_luminance(pixbuf, skip));
            } catch (_e) {

            }
        });
}



function _schedule() {
    if (settleId)
        return;
    settleId = GLib.timeout_add(GLib.PRIORITY_LOW, SETTLE, () => {
        settleId = 0;
        _read();
        return GLib.SOURCE_REMOVE;
    });
}




function _repaintIndicators(actor) {
    if (actor instanceof St.DrawingArea) {
        actor.queue_repaint();
        return;
    }
    for (const child of actor.get_children())
        _repaintIndicators(child);
}

function _styleContainer(container) {
    if (mode) {
        container.add_style_class_name(mode === 'light' ? LIGHT_CLASS : DARK_CLASS);
        container.remove_style_class_name(mode === 'light' ? DARK_CLASS : LIGHT_CLASS);
    }
    if (scheme) {
        container.add_style_class_name(scheme === 'light' ? SCHEME_LIGHT_CLASS : SCHEME_DARK_CLASS);
        container.remove_style_class_name(scheme === 'light' ? SCHEME_DARK_CLASS : SCHEME_LIGHT_CLASS);
    }
    _repaintIndicators(container);
}

function _apply(luminance) {
    const wanted = mode === 'light'
        ? (luminance < LIGHT_LEAVE ? 'dark' : 'light')
        : (luminance > LIGHT_ENTER ? 'light' : 'dark');
    if (wanted === mode)
        return;

    mode = wanted;
    d2d.set_string(DOT_KEY, DOT_COLOR[mode]);
    docks.forEach(({ container }) => _styleContainer(container));
}

function _syncScheme() {
    const wanted = prefersDark() ? 'dark' : 'light';
    if (wanted === scheme)
        return;

    scheme = wanted;
    d2d.set_string(PILL_KEY, PILL_COLOR[scheme]);
    docks.forEach(({ container }) => _styleContainer(container));
}

function _attach(container) {
    if (docks.some(dock => dock.container === container))
        return;



    const entry = { container };
    entry.destroyId = container.connect('destroy', () => {
        docks = docks.filter(other => other !== entry);
    });
    docks.push(entry);

    _styleContainer(container);
    _schedule();
}





function _connectWindowSignals() {
    _disconnectWindowSignals();

    const workspace = global.workspace_manager.get_active_workspace();
    windowSignals.push(
        [workspace, workspace.connect('window-added', (_ws, win) => {
            _connectWindow(win);
            _schedule();
        })],
        [workspace, workspace.connect('window-removed', _schedule)]);

    workspace.list_windows().forEach(_connectWindow);
}

function _connectWindow(metaWindow) {
    for (const signal of ['position-changed', 'size-changed', 'notify::minimized'])
        windowSignals.push([metaWindow, metaWindow.connect(signal, _schedule)]);


    windowSignals.push([metaWindow, metaWindow.connect('unmanaged', () => {
        windowSignals = windowSignals.filter(([object]) => object !== metaWindow);
        _schedule();
    })]);
}

function _disconnectWindowSignals() {
    disconnectAll(windowSignals);
    windowSignals = [];
}



export function enable() {


    if (enabled)
        return;

    d2d = dockSettings();
    if (!d2d)
        return;
    enabled = true;

    savedColors = Object.fromEntries(SAVED_KEYS.map(key => [key, d2d.get_string(key)]));
    screenshot = null;
    bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });

    for (const [object, signal] of [
        [global.display, 'restacked'],
        [global.window_manager, 'switch-workspace'],
        [Main.overview, 'hidden'],
        [bgSettings, 'changed::picture-uri'],
        [bgSettings, 'changed::picture-uri-dark'],
        [d2d, 'changed::dock-position'],
    ])
        globalSignals.push([object, object.connect(signal, _schedule)]);



    const stSettings = St.Settings.get();
    globalSignals.push([stSettings, stSettings.connect('notify::color-scheme', () => {
        _syncScheme();
        _schedule();
    })]);





    const backgrounds = Main.layoutManager._backgroundGroup;
    if (backgrounds) {
        for (const signal of ['child-added', 'child-removed'])
            globalSignals.push([backgrounds, backgrounds.connect(signal, _schedule)]);
    }

    globalSignals.push([global.workspace_manager,
        global.workspace_manager.connect('active-workspace-changed', _connectWindowSignals)]);

    _connectWindowSignals();
    _syncScheme();
    watchDocks({ attach: _attach, count: () => docks.length, globalSignals, sources });
    _schedule();
}

export function disable() {
    enabled = false;

    for (const id of [settleId, sources.dockSearch]) {
        if (id)
            GLib.Source.remove(id);
    }
    settleId = 0;
    sources.dockSearch = 0;

    disconnectAll(globalSignals);
    globalSignals = [];
    _disconnectWindowSignals();

    for (const { container, destroyId } of docks) {
        container.disconnect(destroyId);
        for (const name of [LIGHT_CLASS, DARK_CLASS, SCHEME_LIGHT_CLASS, SCHEME_DARK_CLASS])
            container.remove_style_class_name(name);
        _repaintIndicators(container);
    }
    docks = [];


    for (const [key, value] of Object.entries(savedColors ?? {}))
        d2d.set_string(key, value);
    savedColors = null;

    d2d = null;
    bgSettings = null;
    screenshot = null;
    mode = null;
    scheme = null;
    sampling = false;
}
