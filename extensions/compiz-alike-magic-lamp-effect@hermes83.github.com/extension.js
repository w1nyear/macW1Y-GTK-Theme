
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

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SettingsData } from './settings_data.js';

const MINIMIZE_EFFECT_NAME = 'minimize-magic-lamp-effect';
const UNMINIMIZE_EFFECT_NAME = 'unminimize-magic-lamp-effect';
const SNAPSHOT_OVERLAY_NAME = 'mac-window-snapshot-overlay';

function captureWindowSnapshot(actor) {
    if (!actor || !actor.mapped || !actor.meta_window) return null;
    try {
        const snap = actor.paint_to_content(null);
        if (snap) {
            actor.meta_window._macCachedSnapshot = snap;
            return snap;
        }
    } catch (_) {}
    return actor.meta_window._macCachedSnapshot || null;
}

function applySnapshotOverlay(actor) {
    if (!actor || !actor.meta_window) return;
    const snap = actor.meta_window._macCachedSnapshot;
    if (!snap) return;

    try {
        let overlay = actor.get_children().find(c => c.name === SNAPSHOT_OVERLAY_NAME);
        if (!overlay) {
            overlay = new Clutter.Actor({
                name: SNAPSHOT_OVERLAY_NAME,
                width: actor.width,
                height: actor.height,
                content: snap,
            });
            actor.add_child(overlay);
        } else {
            overlay.width = actor.width;
            overlay.height = actor.height;
            overlay.content = snap;
        }
    } catch (_) {}
}

function removeSnapshotOverlay(actor) {
    if (!actor) return;
    try {
        let overlay = actor.get_children().find(c => c.name === SNAPSHOT_OVERLAY_NAME);
        if (overlay) {
            overlay.destroy();
        }
    } catch (_) {}
}

export default class CompizMagicLampEffectExtension extends Extension {

    enable() {
        this.settingsData = new SettingsData(this.getSettings());

        // https://github.com/GNOME/gnome-shell/blob/master/js/ui/windowManager.js

        if (Main.wm._minimizeWindow && !this._origWmMinimizeWindow) {
            this._origWmMinimizeWindow = Main.wm._minimizeWindow;
            Main.wm._minimizeWindow = function(shellwm, actor) {
                shellwm.completed_minimize(actor);
            };
        }

        if (Main.wm._unminimizeWindow && !this._origWmUnminimizeWindow) {
            this._origWmUnminimizeWindow = Main.wm._unminimizeWindow;
            Main.wm._unminimizeWindow = function(shellwm, actor) {
                shellwm.completed_unminimize(actor);
            };
        }

        Main.wm._shellwm.original_completed_minimize = Main.wm._shellwm.completed_minimize;
        Main.wm._shellwm.completed_minimize = function(actor) {
            return;
        };

        Main.wm._shellwm.original_completed_unminimize = Main.wm._shellwm.completed_unminimize;
        Main.wm._shellwm.completed_unminimize = function(actor) {
            return;
        };

        // Continuous snapshot tracking for focused windows
        this._lastFocusWindow = null;
        this._focusNotifyId = global.display.connect('notify::focus-window', () => {
            if (this._lastFocusWindow && !this._lastFocusWindow.minimized) {
                const actor = this._lastFocusWindow.get_compositor_private?.();
                if (actor && actor.mapped) {
                    captureWindowSnapshot(actor);
                }
            }
            const win = global.display.focus_window;
            this._lastFocusWindow = win;
            if (win && !win.minimized) {
                const actor = win.get_compositor_private?.();
                if (actor && actor.mapped) {
                    captureWindowSnapshot(actor);
                }
            }
        });

        this._overviewShowingId = Main.overview.connect('showing', () => {
            global.get_window_actors().forEach(actor => {
                if (actor && actor.meta_window) {
                    if (actor.meta_window.minimized) {
                        applySnapshotOverlay(actor);
                    }
                }
            });
        });

        this._windowCreatedId = global.display.connect('window-created', (d, win) => {
            this._trackWindow(win);
        });
        global.get_window_actors().forEach(actor => {
            if (actor.meta_window) this._trackWindow(actor.meta_window);
        });

        this.minimizeId = global.window_manager.connect("minimize", (e, actor) => {
            if (actor) {
                captureWindowSnapshot(actor);
                applySnapshotOverlay(actor);
            }

            if (Main.overview.visible) {
                Main.wm._shellwm.original_completed_minimize(actor);
                return;
            }

            let icon = this.getIcon(actor);

            this.destroyActorEffect(actor);

            actor.add_effect_with_name(MINIMIZE_EFFECT_NAME, new MagicLampMinimizeEffect({settingsData: this.settingsData, icon: icon}));
        });

        this.unminimizeId = global.window_manager.connect("unminimize", (e, actor) => {
            actor.show();
            if (actor) {
                applySnapshotOverlay(actor);
            }

            if (Main.overview.visible) {
                Main.wm._shellwm.original_completed_unminimize(actor);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    removeSnapshotOverlay(actor);
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }

            let icon = this.getIcon(actor);

            this.destroyActorEffect(actor);

            actor.add_effect_with_name(UNMINIMIZE_EFFECT_NAME, new MagicLampUnminimizeEffect({settingsData: this.settingsData, icon: icon}));
        });
    }

    _trackWindow(win) {
        if (!win || win._macLampTracked) return;
        win._macLampTracked = true;
        win.connectObject('notify::minimized', () => {
            const actor = win.get_compositor_private?.();
            if (!win.minimized && actor) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    if (!win.minimized && actor) {
                        removeSnapshotOverlay(actor);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else if (win.minimized && actor) {
                applySnapshotOverlay(actor);
            }
        }, this);
    }

    disable() {
        if (this.settingsData) {
            this.settingsData = null;
        }
        if (this._focusNotifyId) {
            global.display.disconnect(this._focusNotifyId);
            this._focusNotifyId = null;
        }
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        if (this.minimizeId) {
            global.window_manager.disconnect(this.minimizeId);
            this.minimizeId = null;
        }
        if (this.unminimizeId) {
            global.window_manager.disconnect(this.unminimizeId);
            this.unminimizeId = null;
        }
    
        global.get_window_actors().forEach((actor) => {
            if (actor.meta_window) {
                actor.meta_window.disconnectObject(this);
                delete actor.meta_window._macLampTracked;
            }
            removeSnapshotOverlay(actor);
            this.destroyActorEffect(actor);
        });
        
        if (this._origWmMinimizeWindow && Main.wm) {
            Main.wm._minimizeWindow = this._origWmMinimizeWindow;
            this._origWmMinimizeWindow = null;
        }
        if (this._origWmUnminimizeWindow && Main.wm) {
            Main.wm._unminimizeWindow = this._origWmUnminimizeWindow;
            this._origWmUnminimizeWindow = null;
        }
        if (Main.wm._shellwm.original_completed_minimize) {
            Main.wm._shellwm.completed_minimize = Main.wm._shellwm.original_completed_minimize;
            Main.wm._shellwm.original_completed_minimize = null;
        }
        if (Main.wm._shellwm.original_completed_unminimize) {
            Main.wm._shellwm.completed_unminimize = Main.wm._shellwm.original_completed_unminimize;    
            Main.wm._shellwm.original_completed_unminimize = null;
        }
    }

    getIcon(actor) {
        let [success, icon] = actor.meta_window.get_icon_geometry();
        if (success) {
            return icon;
        } 
    
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (monitor && Main.overview.dash) {
            let dashIcon = null;
            let transformed_position = null;
            let pids = null;
            let pid = actor.get_meta_window() ? actor.get_meta_window().get_pid() : null;
            if (pid && Main.overview.dash._box) {
                Main.overview.dash._box.get_children()
                    .filter(dashElement => dashElement.child && dashElement.child._delegate && dashElement.child._delegate.app)
                    .forEach(dashElement => {
                        pids = dashElement.child._delegate.app.get_pids();
                        if (pids && pids.indexOf(pid) >= 0) {
                            transformed_position = dashElement.get_transformed_position();
                            if (transformed_position && transformed_position[0]) {
                                dashIcon = {x: transformed_position[0], y: monitor.y + monitor.height, width: 0, height: 0};
                                return;
                            }
                        }
                    });
            }
            if (dashIcon) {
                return dashIcon;
            }

            return {x: monitor.x + monitor.width / 2, y: monitor.y + monitor.height, width: 0, height: 0};
        }

        return {x: 0, y: 0, width: 0, height: 0};    
    }

    destroyActorEffect(actor) {
        if (!actor) {
            return;
        }

        let minimizeEffect = actor.get_effect(MINIMIZE_EFFECT_NAME);
        if (minimizeEffect) {
            minimizeEffect.destroy();
        }

        let unminimizeEffect = actor.get_effect(UNMINIMIZE_EFFECT_NAME);
        if (unminimizeEffect) {
            unminimizeEffect.destroy();
        }
    }
}

class AbstractCommonMagicLampEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }    

    _init(params = {}) {
        super._init();

        this.settingsData = params.settingsData;

        this.EPSILON = 40;

        this.isMinimizeEffect = false;
        this.newFrameEvent = null;
        this.completedEvent = null;
        
        this.timerId = null;
        this.msecs = 0;

        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.window = {x: 0, y: 0, width: 0, height: 0, scale: 1};
        this.icon = params.icon;
        
        this.progress = 0;
        this.split = 0.3;
        this.k = 0;
        this.j = 0;
        this.expandWidth = 0;
        this.fullWidth = 0;
        this.expandHeight = 0;
        this.fullHeight = 0;
        this.width = 0;
        this.height = 0;
        this.x = 0;
        this.y = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.effectX = 0;
        this.effectY = 0;
        this.iconPosition = null;

        this.toTheBorder = true;   // true
        this.maxIconSize = null;    // 48
        this.alignIcon = 'center';  // 'left-top'

        this.EFFECT = this.settingsData.EFFECT.get(); //'default' - 'sine'
        this.DURATION = this.settingsData.DURATION.get();
        this.X_TILES = this.settingsData.X_TILES.get();
        this.Y_TILES = this.settingsData.Y_TILES.get();

        this.initialized = false;
    }

    destroy_actor(actor) {}

    on_tick_elapsed(timer, msecs) {}

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);

        if (!this.actor || this.initialized) {
            return;
        }

        this.initialized = true;
        
        this.monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];

        [this.window.x, this.window.y] = [this.actor.get_x() - this.monitor.x, this.actor.get_y() - this.monitor.y];
        [this.window.width, this.window.height] = actor.get_size();
        
        if (!this.icon || (this.icon.x == 0 && this.icon.y == 0 && this.icon.width == 0 && this.icon.height == 0)) {
            this.icon.x = this.monitor.x + this.monitor.width / 2;
            this.icon.y = this.monitor.height + this.monitor.y;
        }

        Main.layoutManager.monitors.forEach((monitor, monitorIndex)  => {
            let scale = 1;
            if (global.display && global.display.get_monitor_scale) {
                scale = global.display.get_monitor_scale(monitorIndex);
            }

            if (this.icon.x >= monitor.x && this.icon.x <= monitor.x + monitor.width * scale && this.icon.y >= monitor.y && this.icon.y <= monitor.y + monitor.height * scale)  {
                this.iconMonitor = monitor;
            }
        });
        if (this.iconMonitor.x == 0 && this.iconMonitor.y == 0 && this.iconMonitor.width == 0 && this.iconMonitor.height == 0) {
            this.iconMonitor = this.monitor;
            // this.icon.x = this.monitor.x + this.monitor.width / 2;
            // this.icon.y = this.monitor.height + this.monitor.y;
        }

        [this.icon.x, this.icon.y, this.icon.width, this.icon.height] = [this.icon.x - this.monitor.x, this.icon.y - this.monitor.y, this.icon.width, this.icon.height];

        if (this.icon.y + this.icon.height >= this.monitor.height - this.EPSILON) {
            this.iconPosition = St.Side.BOTTOM;
            if (this.toTheBorder) {
                this.icon.y = this.iconMonitor.y + this.iconMonitor.height - this.monitor.y
                this.icon.height = 0;
            }
        } else if (this.icon.x <= this.EPSILON) {
            this.iconPosition = St.Side.LEFT;
            if (this.toTheBorder) {
                this.icon.x = this.iconMonitor.x - this.monitor.x;
                this.icon.width = 0;
            }
        } else if (this.icon.x + this.icon.width >= this.monitor.width - this.EPSILON) {
            this.iconPosition = St.Side.RIGHT;
            if (this.toTheBorder) {
                this.icon.x = this.iconMonitor.x + this.iconMonitor.width - this.monitor.x;
                this.icon.width = 0;
            }
        } else {
            this.iconPosition = St.Side.TOP;
            if (this.toTheBorder) {
                this.icon.y = this.iconMonitor.y - this.monitor.y;
                this.icon.height = 0;
            }
        }

        if (this.iconPosition == St.Side.BOTTOM) {
            this.expandHeight = (this.iconMonitor.height - this.icon.height - this.window.y - this.window.height);
        } else if (this.iconPosition == St.Side.RIGHT) {
            this.expandWidth = (this.iconMonitor.width - this.icon.width - this.window.x - this.window.width);
        }

        this.set_n_tiles(this.X_TILES, this.Y_TILES);
        
        this.timerId = new Clutter.Timeline({ actor: this.actor, duration: this.DURATION + (this.monitor.width * this.monitor.height) / (this.window.width * this.window.height) });
        this.newFrameEvent = this.timerId.connect('new-frame', this.on_tick_elapsed.bind(this));
        this.completedEvent = this.timerId.connect('completed', this.destroy.bind(this));
        this.timerId.start();
    }

    destroy() {
        if (this.timerId) {
            if (this.newFrameEvent) {
                this.timerId.disconnect(this.newFrameEvent);
                this.newFrameEvent = null;
            }
            if (this.completedEvent) {
                this.timerId.disconnect(this.completedEvent);
                this.completedEvent = null;
            }
            this.timerId = null;
        }

        let actor = this.get_actor();
        if (actor) {
            if (this.paintEvent) {
                actor.disconnect(this.paintEvent);
                this.paintEvent = null;
            }
            actor.remove_effect(this);

            this.destroy_actor(actor);
        }
    }

    updateFrameParams() {
        if (!this.initialized) return;

        const oneMinusK = 1 - this.k;
        const oneMinusJ = 1 - this.j;

        if (this.iconPosition == St.Side.BOTTOM) {
            this.fullHeight = (this.iconMonitor.height - this.icon.height - this.window.y) - this.expandHeight * oneMinusK;
            this.height = this.fullHeight - this.j * this.fullHeight;
            this.offsetY = this.iconMonitor.height - this.icon.height - this.window.y - this.height - this.expandHeight * oneMinusK;
            this.invFullHeight = this.fullHeight > 0 ? 1 / this.fullHeight : 0;
            this.diffIconWinX = this.icon.x - this.window.x;
            this.diffWinIconW = this.window.width - this.icon.width;
            this.oneMinusJ = oneMinusJ;
            this.oneMinusK = oneMinusK;
            this.termJ = this.diffIconWinX * this.j;
            this.termK = this.diffIconWinX * this.k;
        } else if (this.iconPosition == St.Side.RIGHT) {
            this.fullWidth = (this.iconMonitor.width - this.icon.width - this.window.x) - this.expandWidth * oneMinusK;
            this.width = this.fullWidth - this.j * this.fullWidth;
            this.offsetX = this.iconMonitor.width - this.icon.width - this.window.x - this.width - this.expandWidth * oneMinusK;
            this.invFullWidth = this.fullWidth > 0 ? 1 / this.fullWidth : 0;
            this.diffIconWinY = this.icon.y - this.window.y;
            this.diffWinIconH = this.window.height - this.icon.height;
            this.oneMinusJ = oneMinusJ;
            this.oneMinusK = oneMinusK;
            this.termJ = this.diffIconWinY * this.j;
            this.termK = this.diffIconWinY * this.k;
        } else if (this.iconPosition == St.Side.LEFT) {
            this.width = this.window.width - this.icon.width + this.window.x * this.k;
            this.offsetX = this.icon.width - this.window.x * this.k;
            this.invWidth = this.width > 0 ? 1 / this.width : 0;
            this.diffIconWinY = this.icon.y - this.window.y;
            this.diffWinIconH = this.window.height - this.icon.height;
            this.oneMinusJ = oneMinusJ;
            this.oneMinusK = oneMinusK;
        } else if (this.iconPosition == St.Side.TOP) {
            this.height = this.window.height - this.icon.height + this.window.y * this.k;
            this.offsetY = this.icon.height - this.window.y * this.k;
            this.invHeight = this.height > 0 ? 1 / this.height : 0;
            this.diffIconWinX = this.icon.x - this.window.x;
            this.diffWinIconW = this.window.width - this.icon.width;
            this.oneMinusJ = oneMinusJ;
            this.oneMinusK = oneMinusK;
        }
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized) return;

        let propX = w / this.window.width;
        let propY = h / this.window.height;

        if (this.iconPosition == St.Side.BOTTOM) {
            const y = v.ty * this.height;
            const x = v.tx * this.icon.width +
                    v.tx * this.diffWinIconW * this.oneMinusJ * (1 - v.ty) +
                    v.tx * this.diffWinIconW * this.oneMinusK * v.ty;

            const offsetX = this.termK * (y * this.invFullHeight) + this.termJ;
            let effectX = 0;
            if (this.EFFECT === 'sine') {
                effectX = Math.sin((this.height - y) * this.invFullHeight * Math.PI * 4) * this.window.width / 14 * this.k;
            } else {
                effectX = Math.sin(((this.height - y) * this.invFullHeight) * 2 * Math.PI + Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
            }

            v.x = (x + offsetX + effectX) * propX;
            v.y = (y + this.offsetY) * propY;
        } else if (this.iconPosition == St.Side.RIGHT) {
            const x = v.tx * this.width;
            const y = v.ty * this.icon.height +
                    v.ty * this.diffWinIconH * this.oneMinusJ * (1 - v.tx) +
                    v.ty * this.diffWinIconH * this.oneMinusK * v.tx;

            const offsetY = this.termK * (x * this.invFullWidth) + this.termJ;
            let effectY = 0;
            if (this.EFFECT === 'sine') {
                effectY = Math.sin((this.width - x) * this.invFullWidth * Math.PI * 4) * this.window.height / 14 * this.k;
            } else {
                effectY = Math.sin(((this.width - x) * this.invFullWidth) * 2 * Math.PI + Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
            }

            v.x = (x + this.offsetX) * propX;
            v.y = (y + offsetY + effectY) * propY;
        } else if (this.iconPosition == St.Side.LEFT) {
            const x = (this.width - this.j * this.width) * v.tx;  
            const y = v.ty * this.window.height * (x + (this.width - x) * this.oneMinusK) * this.invWidth + 
                    v.ty * this.icon.height * (this.width - x) * this.invWidth;

            const offsetY = this.diffIconWinY * ((this.width - x) * this.invWidth) * this.k;
            let effectY = 0;
            if (this.EFFECT === 'sine') {
                effectY = Math.sin(x * this.invWidth * Math.PI * 4) * this.window.height / 14 * this.k;
            } else {
                effectY = Math.sin((0.5 - (this.width - x) * this.invWidth) * 2 * Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
            }

            v.x = (x + this.offsetX) * propX;
            v.y = (y + offsetY + effectY) * propY;
        } else if (this.iconPosition == St.Side.TOP) {
            const y = (this.height - this.j * this.height) * v.ty;
            const x = v.tx * this.window.width * (y + (this.height - y) * this.oneMinusK) * this.invHeight + 
                    v.tx * this.icon.width * (this.height - y) * this.invHeight;

            const offsetX = this.diffIconWinX * ((this.height - y) * this.invHeight) * this.k;
            let effectX = 0;
            if (this.EFFECT === 'sine') {
                effectX = Math.sin(y * this.invHeight * Math.PI * 4) * this.window.width / 14 * this.k;
            } else {
                effectX = Math.sin((0.5 - (this.height - y) * this.invHeight) * 2 * Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
            }

            v.x = (x + offsetX + effectX) * propX;
            v.y = (y + this.offsetY) * propY;
        }
    }
}

class MagicLampMinimizeEffect extends AbstractCommonMagicLampEffect {
    static {
        GObject.registerClass(this);
    }
       
    _init(params = {}) {
        super._init(params);

        this.k = 0;
        this.j = 0;
        this.isMinimizeEffect = true;
    }

    destroy_actor(actor) {
        Main.wm._shellwm.original_completed_minimize(actor);
    }

    on_tick_elapsed(timer, msecs) {
        if (Main.overview.visible) {
            this.destroy();
            return;
        }

        this.progress = timer.get_progress();
        this.k = this.progress <= this.split ? this.progress * (1 / this.split) : 1;
        this.j = this.progress > this.split ? (this.progress - this.split) * (1 / (1 - this.split)) : 0;

        this.updateFrameParams();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}
    
class MagicLampUnminimizeEffect extends AbstractCommonMagicLampEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init(params);

        this.k = 1;
        this.j = 1;
        this.isMinimizeEffect = false;
    }
    
    destroy_actor(actor) {
        Main.wm._shellwm.original_completed_unminimize(actor);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (actor && actor.meta_window && !actor.meta_window.minimized) {
                removeSnapshotOverlay(actor);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    on_tick_elapsed(timer, msecs) {
        if (Main.overview.visible) {
            this.destroy();
            return;
        }   

        this.progress = timer.get_progress();
        this.k = 1 - (this.progress > (1 - this.split) ? (this.progress - (1 - this.split)) * (1 / (1 - (1 - this.split))) : 0);
        this.j = 1 - (this.progress <= (1 - this.split) ? this.progress * (1 / (1 - this.split)) : 1);

        this.updateFrameParams();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}