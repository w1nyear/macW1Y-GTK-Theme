// SPDX-License-Identifier: GPL-3.0-or-later


import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';

export const AddUsernameToQuickMenu = GObject.registerClass(
class AddUsernameToQuickMenu extends St.Widget {
    _init() {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true,
            style_class: 'username-container',
        });

        this._usernameLabel = new St.Label({
            text: GLib.get_real_name() + '  ',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
            y_expand: false,
            style_class: 'username-label',
        });
        this.add_child(this._usernameLabel);


        this.visible = false;

        this._mappedId = null;
    }

    animateIn() {

        this.visible = true;


        if (this.mapped) {
            this._startSlideIn();
        } else {
            this._mappedId = this.connect('notify::mapped', () => {
                if (this.mapped) {
                    if (this._mappedId) {
                        this.disconnect(this._mappedId);
                        this._mappedId = null;
                    }
                    this._startSlideIn();
                }
            });
        }
    }

    _startSlideIn() {

        let [, naturalWidth] = this._usernameLabel.get_preferred_width(-1);


        this.set_width(naturalWidth);


        this._usernameLabel.translation_x = naturalWidth;


        this._usernameLabel.ease({
            translation_x: 0,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._usernameLabel.translation_x = 0;
            },
        });
    }

    animateOut(callback) {

        let [, naturalWidth] = this._usernameLabel.get_preferred_width(-1);


        this._usernameLabel.remove_all_transitions();


        this._usernameLabel.ease({
            translation_x: naturalWidth,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._usernameLabel.translation_x = naturalWidth;
                this.visible = false;

                if (callback) {
                    callback();
                }
            },
        });
    }

    destroy() {
        if (this._mappedId) {
            this.disconnect(this._mappedId);
            this._mappedId = null;
        }
        this._usernameLabel.remove_all_transitions();
        super.destroy();
    }
});

let addUsernameInstance;

export function enable() {
    if (!addUsernameInstance) {
        addUsernameInstance = new AddUsernameToQuickMenu();
        const QuickSettingsMenu = Main.panel.statusArea.quickSettings;


        QuickSettingsMenu._indicators.insert_child_at_index(addUsernameInstance, 0);


        addUsernameInstance.animateIn();
    }
}

export function disable() {
    if (addUsernameInstance) {
        const instance = addUsernameInstance;
        addUsernameInstance = null;

        const QuickSettingsMenu = Main.panel.statusArea.quickSettings;
        QuickSettingsMenu._indicators.remove_child(instance);
        instance.destroy();
    }
}
