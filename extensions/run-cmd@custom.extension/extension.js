import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';




let getTopbarInk = () => 'light';
let watchInk = () => () => {};
const _INK_URL = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/apps/tahoeInk.js';
let _inkReady = null;
function _loadInk() {
    if (!_inkReady) {
        _inkReady = import(_INK_URL).then(m => {
            if (m.getTopbarInk)
                getTopbarInk = m.getTopbarInk;
            if (m.watchInk)
                watchInk = m.watchInk;
            return m;
        }).catch(e => {
            console.warn(`[run-cmd] tahoeInk unavailable: ${e}`);
            return null;
        });
    }
    return _inkReady;
}
_loadInk();

const SYSTEM_LIGHT_PATH = '/usr/share/mactheme/icons/controlcenter.png';
const SYSTEM_DARK_PATH = '/usr/share/mactheme/icons/controlcenter-dark.png';
const FALLBACK_LIGHT = GLib.get_home_dir() + '/controlcenter.png';
const FALLBACK_DARK = GLib.get_home_dir() + '/controlcenter-dark.png';


function themedIconPath() {
    const isDarkInk = (getTopbarInk() === 'dark');
    try {
        if (isDarkInk) {
            if (GLib.file_test(SYSTEM_DARK_PATH, GLib.FileTest.EXISTS))
                return SYSTEM_DARK_PATH;
            if (GLib.file_test(FALLBACK_DARK, GLib.FileTest.EXISTS))
                return FALLBACK_DARK;
        }
    } catch (_) {}
    if (GLib.file_test(SYSTEM_LIGHT_PATH, GLib.FileTest.EXISTS))
        return SYSTEM_LIGHT_PATH;
    return FALLBACK_LIGHT;
}

export default class RunCommandExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Ydotool Trigger', true);

        const FADE_DURATION = 200;

        this._iconBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
        });

        this._ccIcon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            opacity: 255,
        });
        this._icon = this._ccIcon;
        this._syncIcon();

        this._osdIcon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16,
            opacity: 0,
        });

        this._iconBox.add_child(this._ccIcon);
        this._iconBox.add_child(this._osdIcon);
        this._indicator.add_child(this._iconBox);

        this._indicator._ccIcon = this._ccIcon;
        this._indicator._osdIcon = this._osdIcon;
        this._indicator._iconBox = this._iconBox;

        this._indicator._setOsdOverride = (iconName) => {
            if (!this._ccIcon || !this._osdIcon) return;
            this._osdActive = true;
            this._indicator.add_style_pseudo_class('checked');
            this._osdIcon.icon_name = iconName;


            if (this._osdIcon.opacity === 255 && this._ccIcon.opacity === 0) {
                return;
            }

            this._ccIcon.remove_all_transitions();
            this._osdIcon.remove_all_transitions();

            this._ccIcon.ease({
                opacity: 0,
                duration: FADE_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._osdIcon.ease({
                opacity: 255,
                duration: FADE_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        };

        this._indicator._clearOsdOverride = () => {
            if (!this._ccIcon || !this._osdIcon) return;
            this._osdActive = false;
            this._indicator.remove_style_pseudo_class('checked');

            if (this._osdIcon.opacity === 0 && this._ccIcon.opacity === 255) {
                this._osdIcon.icon_name = null;
                return;
            }

            this._ccIcon.remove_all_transitions();
            this._osdIcon.remove_all_transitions();

            this._osdIcon.ease({
                opacity: 0,
                duration: FADE_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._osdActive && this._osdIcon) {
                        this._osdIcon.icon_name = null;
                    }
                },
            });
            this._ccIcon.ease({
                opacity: 255,
                duration: FADE_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        };

        globalThis._macSetControlCenterOsdIcon = (iconName) => {
            if (this._indicator?._setOsdOverride) {
                this._indicator._setOsdOverride(iconName);
            }
        };

        globalThis._macRestoreControlCenterIcon = () => {
            if (this._indicator?._clearOsdOverride) {
                this._indicator._clearOsdOverride();
            }
        };

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        try {
            this._inkUnwatch = watchInk(() => this._syncIcon());
        } catch (e) {
            this._inkUnwatch = null;
        }


        _loadInk().then(m => {
            if (!m || !this._indicator)
                return;
            try {
                if (this._inkUnwatch)
                    this._inkUnwatch();
            } catch (e) {

            }
            try {
                this._inkUnwatch = watchInk(() => this._syncIcon());
            } catch (e) {
                this._inkUnwatch = null;
            }
            this._syncIcon();
        });

        this._indicator.connect('button-press-event', () => {
            if (this._indicator?._clearOsdOverride)
                this._indicator._clearOsdOverride();
            if (typeof globalThis._tahoeQSToggle === 'function') {
                globalThis._tahoeQSToggle();
                return;
            }
            import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/apps/tahoeQuickSettings.js?v=live').then(mod => {
                try {
                    mod.togglePanel();
                } catch (e) {
                    logError(e);
                }
            }).catch(logError);
        });

        Main.panel.addToStatusArea('ydotool-trigger-button', this._indicator, 1, 'right');
    }

    _syncIcon() {
        const icon = this._ccIcon || this._icon;
        if (!icon)
            return;
        try {
            const file = Gio.File.new_for_path(themedIconPath());
            icon.gicon = new Gio.FileIcon({file});
        } catch (e) {

        }
    }

    disable() {
        if (globalThis._macSetControlCenterOsdIcon)
            delete globalThis._macSetControlCenterOsdIcon;
        if (globalThis._macRestoreControlCenterIcon)
            delete globalThis._macRestoreControlCenterIcon;
        if (this._indicator?._clearOsdOverride) {
            this._indicator._clearOsdOverride();
        }
        if (this._inkUnwatch) {
            try {
                this._inkUnwatch();
            } catch (e) {

            }
            this._inkUnwatch = null;
        }
        if (this._themeChangedId && this._interfaceSettings) {
            try {
                this._interfaceSettings.disconnect(this._themeChangedId);
            } catch (e) {

            }
            this._themeChangedId = 0;
        }
        this._interfaceSettings = null;
        this._icon = null;
        this._ccIcon = null;
        this._osdIcon = null;
        this._iconBox = null;
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
