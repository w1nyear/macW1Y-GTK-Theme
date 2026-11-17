// SPDX-License-Identifier: GPL-3.0-or-later













import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

const GROUP_NAME = 'kiwi-overview-blur-group';
const EFFECT_NAME = 'kiwi-overview-blur';





const BLUR_RADIUS = 60;


const BRIGHTNESS_DARK = 0.80;
const BRIGHTNESS_LIGHT = 0.65;

let _enabled = false;
let _settings = null;
let _group = null;
let _managers = [];
let _groupSignals = [];
let _globalSignals = [];

function _brightness() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK
        ? BRIGHTNESS_DARK : BRIGHTNESS_LIGHT;
}

function _disconnect(list) {
    for (const [obj, id] of list) {
        try { obj.disconnect(id); } catch (_) {   }
    }
    list.length = 0;
}

function _teardown() {
    _disconnect(_groupSignals);



    _managers.forEach(manager => manager.destroy());
    _managers = [];

    if (_group) {
        _group.get_parent()?.remove_child(_group);
        _group.destroy_all_children();
        _group.destroy();
        _group = null;
    }
}

function _build() {
    _teardown();

    _group = new Meta.BackgroundGroup({ name: GROUP_NAME });
    const brightness = _brightness();

    Main.layoutManager.monitors.forEach((monitor, index) => {
        const holder = new St.Widget({
            name: EFFECT_NAME,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        holder.add_effect_with_name(EFFECT_NAME, new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: BLUR_RADIUS,
            brightness,
        }));





        _managers.push(new Background.BackgroundManager({
            container: holder,
            monitorIndex: index,
            controlPosition: false,
        }));

        _group.add_child(holder);
    });

    const overviewGroup = Main.layoutManager.overviewGroup;
    overviewGroup.insert_child_at_index(_group, 0);



    _groupSignals.push([overviewGroup, overviewGroup.connect('child-added', (group, child) => {
        if (child !== _group)
            group.set_child_below_sibling(_group, null);
    })]);
}

function _syncBrightness() {
    const brightness = _brightness();
    _group?.get_children().forEach(holder => {
        const effect = holder.get_effect(EFFECT_NAME);
        if (effect)
            effect.brightness = brightness;
    });
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('overview-wallpaper-background'))
        return;
    _enabled = true;

    _build();


    _globalSignals.push([Main.layoutManager,
        Main.layoutManager.connect('monitors-changed', () => _build())]);


    _globalSignals.push([St.Settings.get(),
        St.Settings.get().connect('notify::color-scheme', () => _syncBrightness())]);
}



export function refresh() {
    if (_enabled && !_group)
        _build();
}

export function disable() {
    _enabled = false;
    _disconnect(_globalSignals);
    _teardown();
    _settings = null;
}
