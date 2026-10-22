import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Adaptive ink lives in kiwi@kemma. Static `import ... from 'file://' + ...`
// is a SyntaxError (module specifiers must be string literals), so load it
// dynamically at runtime instead.
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

// Adaptive ink (not theme): white icon on dark backgrounds, black on light.
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

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_size: 16
        });
        this._syncIcon();
        this._indicator.add_child(this._icon);

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        try {
            this._inkUnwatch = watchInk(() => this._syncIcon());
        } catch (e) {
            this._inkUnwatch = null;
        }
        // The real ink module loads async; attach the live watcher + icon
        // once it arrives (if enable() ran before the import resolved).
        _loadInk().then(m => {
            if (!m || !this._indicator)
                return;
            try {
                if (this._inkUnwatch)
                    this._inkUnwatch();
            } catch (e) {
                // stub unwarch goes away
            }
            try {
                this._inkUnwatch = watchInk(() => this._syncIcon());
            } catch (e) {
                this._inkUnwatch = null;
            }
            this._syncIcon();
        });

        this._indicator.connect('button-press-event', () => {
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
        if (!this._icon)
            return;
        try {
            const file = Gio.File.new_for_path(themedIconPath());
            this._icon.gicon = new Gio.FileIcon({file});
        } catch (e) {
            // keep the previous icon
        }
    }

    disable() {
        if (this._inkUnwatch) {
            try {
                this._inkUnwatch();
            } catch (e) {
                // already gone
            }
            this._inkUnwatch = null;
        }
        if (this._themeChangedId && this._interfaceSettings) {
            try {
                this._interfaceSettings.disconnect(this._themeChangedId);
            } catch (e) {
                // already gone
            }
            this._themeChangedId = 0;
        }
        this._interfaceSettings = null;
        this._icon = null;
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
