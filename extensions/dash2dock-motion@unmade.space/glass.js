




















import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_MY_SHELL_UUID = 'blur-my-shell@aunetx';


const BLUR_REARM_DELAY_MS = 2500;

export const GLASS_STYLE_CLASS = 'dash2dock-motion-glass';
export const OUTLINE_STYLE_CLASS = 'dash2dock-motion-glass-outline';
export const NO_HIGHLIGHT_STYLE_CLASS = 'dash2dock-motion-no-highlight';


export const BLUR_GROUP_NAME = 'bms-dash-backgroundgroup';

export class GlassSlab {





    constructor(dash, dock, settings) {
        this._dash = dash;
        this._dock = dock;
        this._settings = settings;

        this._dock.add_style_class_name(GLASS_STYLE_CLASS);

        this._signalIds = [
            settings.connect('changed::glass-outline',
                () => this._syncOutline()),
            settings.connect('changed::show-icon-highlight',
                () => this._syncHighlight()),
        ];
        this._syncOutline();
        this._syncHighlight();

        this._rearmBlurId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            BLUR_REARM_DELAY_MS, () => {
                this._rearmBlurId = 0;
                this._rearmBlur();
                return GLib.SOURCE_REMOVE;
            });
    }





    _rearmBlur() {
        if (Main.extensionManager.lookup(BLUR_MY_SHELL_UUID)?.state !== 1)
            return;



        try {
            const bmsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.blur-my-shell.dash-to-dock' });
            if (!bmsSettings.get_boolean('blur'))
                return;
        } catch (_) {
            return;
        }

        if (!this._dash.has_allocation())
            return;

        const alreadyBlurred = this._dash.get_parent()?.get_children().some(
            child => child.get_name() === BLUR_GROUP_NAME);
        if (alreadyBlurred)
            return;

        this._dock._trackDock();
    }

    _syncOutline() {
        if (this._settings.get_boolean('glass-outline'))
            this._dock.add_style_class_name(OUTLINE_STYLE_CLASS);
        else
            this._dock.remove_style_class_name(OUTLINE_STYLE_CLASS);
    }

    _syncHighlight() {
        if (this._settings.get_boolean('show-icon-highlight'))
            this._dock.remove_style_class_name(NO_HIGHLIGHT_STYLE_CLASS);
        else
            this._dock.add_style_class_name(NO_HIGHLIGHT_STYLE_CLASS);
    }

    destroy() {
        if (this._rearmBlurId) {
            GLib.Source.remove(this._rearmBlurId);
            this._rearmBlurId = 0;
        }

        for (const id of this._signalIds)
            this._settings.disconnect(id);
        this._signalIds = [];
        if (this._dock) {
            this._dock.remove_style_class_name(GLASS_STYLE_CLASS);
            this._dock.remove_style_class_name(OUTLINE_STYLE_CLASS);
            this._dock.remove_style_class_name(NO_HIGHLIGHT_STYLE_CLASS);
        }
        this._dash = null;
        this._dock = null;
        this._settings = null;
    }
}
