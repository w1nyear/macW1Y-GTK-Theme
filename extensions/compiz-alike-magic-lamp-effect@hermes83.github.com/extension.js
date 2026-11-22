
/*
 * Compiz-alike-magic-lamp-effect for GNOME Shell
 *
 * Copyright (C) 2020
 *     Mauro Pepe <https://github.com/hermes83/compiz-alike-magic-lamp-effect>
 *
 * This file is part of the gnome-shell extension Compiz-alike-magic-lamp-effect.
 *
 * gnome-shell extension Compiz-alike-magic-lamp-effect is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * gnome-shell extension Compiz-alike-magic-lamp-effect is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE.  See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell extension Compiz-alike-magic-lamp-effect.  If not, see
 * <http://www.gnu.org/licenses/>.
 */
'use strict';

import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SettingsData } from './settings_data.js';

function dockIconRect(win) {
    const [ok, rect] = win.get_icon_geometry();
    if (ok && rect.width > 0 && rect.height > 0)
        return rect;

    const monitor = Main.layoutManager.monitors[win.get_monitor()];
    const dash = Main.overview.dash;
    const item = dash?._box?.get_children().find(child =>
        child.child?._delegate?.app?.get_windows().includes(win));
    const anchor = item?.mapped ? item : dash;
    if (anchor?.mapped) {
        const [x, y] = anchor.get_transformed_position();
        const [width, height] = anchor.get_transformed_size();
        if (width > 0 && height > 0)
            return {x: x + width / 2, y: y + height / 2, width: 0, height: 0};
    }
    const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
    return {x: monitor.x + monitor.width / 2, y: area.y + area.height, width: 0, height: 0};
}

export default class CompizMagicLampEffectExtension extends Extension {
    enable() {
        this.settingsData = new SettingsData(this.getSettings());
        this.animations = new Map();
        this.handlers = ['minimize', 'unminimize'].map(signal =>
            global.window_manager.connect_after(signal, (wm, actor) =>
                this.animate(wm, actor, signal === 'minimize')));
    }

    animate(wm, actor, minimizing) {
        this.animations.get(actor)?.();
        const pending = minimizing ? Main.wm._minimizing : Main.wm._unminimizing;
        if (!pending?.has(actor) || Main.overview.visible)
            return;

        const win = actor.meta_window;
        const stageActive = !!globalThis._stageManagerEnabled;

        if (win?._stageSwitching || stageActive) {
            if (minimizing) {
                Main.wm._minimizeWindowDone(wm, actor);
            } else {
                Main.wm._unminimizeWindowDone(wm, actor);
                actor.set_opacity(0);
                const rect = win.get_buffer_rect();
                if (rect.width > 0 && rect.height > 0)
                    actor.set_position(rect.x, rect.y);
            }
            return;
        }

        const rect = win.get_buffer_rect();
        const icon = dockIconRect(win);
        if (rect.width <= 0 || rect.height <= 0) return;
        if (!minimizing) {
            Main.wm._unminimizeWindowDone(wm, actor);
            actor.set_position(rect.x, rect.y);
        }
        const content = actor.paint_to_content(null);
        if (!content) return;
        const proxy = new Clutter.Actor({name: 'macw1y-lamp-snapshot',
            x: rect.x, y: rect.y, width: rect.width, height: rect.height, reactive: false});
        const draw = makeLamp(proxy, content, rect, icon, this.settingsData);
        draw(minimizing ? 0 : 1);
        const timeline = new Clutter.Timeline({actor: proxy,
            duration: Math.max(1, Math.round(this.settingsData.DURATION.get()))});
        const finish = () => {
            if (!this.animations.delete(actor)) return;
            timeline.stop();
            actor.disconnect(destroyId);
            proxy.destroy();
            if (!minimizing) actor.opacity = 255;
        };
        const destroyId = actor.connect('destroy', finish);
        this.animations.set(actor, finish);
        Main.uiGroup.insert_child_above(proxy, global.window_group);
        timeline.connect('new-frame', () => draw(minimizing ? timeline.get_progress() : 1 - timeline.get_progress()));
        timeline.connect('completed', finish);
        if (minimizing) {
            Main.wm._minimizeWindowDone(wm, actor);
        } else {
            actor.opacity = 0;
        }
        timeline.start();
    }

    disable() {
        for (const id of this.handlers) global.window_manager.disconnect(id);
        for (const finish of this.animations.values()) finish();
    }
}

function makeLamp(proxy, content, rect, icon, settings) {
    const cx = icon.x + icon.width / 2;
    const cy = icon.y + icon.height / 2;
    const monitor = Main.layoutManager.monitors.find(m => cx >= m.x && cx < m.x + m.width &&
        cy >= m.y && cy < m.y + m.height) ?? Main.layoutManager.primaryMonitor;
    const horizontalEdge = Math.min(Math.abs(cy - monitor.y), Math.abs(monitor.y + monitor.height - cy));
    const verticalEdge = Math.min(Math.abs(cx - monitor.x), Math.abs(monitor.x + monitor.width - cx));
    const vertical = horizontalEdge <= verticalEdge;
    const length = vertical ? rect.height : rect.width;
    const breadth = vertical ? rect.width : rect.height;
    const end = vertical ? cy - rect.y : cx - rect.x;
    const center = vertical ? cx - rect.x : cy - rect.y;
    const tip = Math.min(breadth, Math.max(1, vertical ? icon.width : icon.height));
    const towardsEnd = end >= length / 2;
    const tiles = vertical ? settings.Y_TILES.get() : settings.X_TILES.get();
    const count = Math.min(length, 96, Math.max(24, Math.round(tiles * 4)));
    const wave = settings.EFFECT.get() === 'sine';
    const strips = [];
    for (let i = 0; i < count; i++) {
        const start = Math.round(i * length / count);
        const span = Math.round((i + 1) * length / count) - start;
        const strip = new Clutter.Actor({width: vertical ? breadth : span,
            height: vertical ? span : breadth, clip_to_allocation: true});
        strip.add_child(new Clutter.Actor({content, x: vertical ? 0 : -start,
            y: vertical ? -start : 0, width: rect.width, height: rect.height}));
        proxy.add_child(strip);
        strips.push({strip, start, span, matrix: new Graphene.Matrix()});
    }
    return progress => {
        const pull = Math.min(1, progress / 0.35);
        const fold = Math.max(0, (progress - 0.35) / 0.65);
        const first = towardsEnd ? fold * end : pull * end;
        const last = length + (end - length) * (towardsEnd ? pull : fold);
        const edge = fraction => {
            const along = towardsEnd ? fraction : 1 - fraction;
            const curve = along * along * (3 - 2 * along);
            const bend = fold + (1 - fold) * pull * curve;
            const width = breadth + (tip - breadth) * bend;
            const wobble = wave ? Math.sin(along * 2 * Math.PI) * breadth * 0.07 * pull * (1 - fold) : 0;
            return {width, across: (center - tip / 2) * bend + wobble};
        };
        let near = edge(0);
        for (const {strip, start, span, matrix} of strips) {
            const far = edge((start + span) / length);
            const ratio = near.width / far.width;
            const taper = (ratio - 1) / span;
            const shear = (far.across - near.across) * ratio / span;
            const scale = Math.max(0.001, (last - first) / length) * ratio;
            const crossScale = near.width / breadth;
            const axis = first + (last - first) * start / length;
            matrix.init_from_float(vertical
                ? [crossScale,0,0,0, shear,scale,0,taper, 0,0,1,0, 0,0,0,1]
                : [scale,shear,0,taper, 0,crossScale,0,0, 0,0,1,0, 0,0,0,1]);
            strip.set_position(vertical ? near.across : axis, vertical ? axis : near.across);
            strip.set_transform(matrix);
            near = far;
        }
    };
}
