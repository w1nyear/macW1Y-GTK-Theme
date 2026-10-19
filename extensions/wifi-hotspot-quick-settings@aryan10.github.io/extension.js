import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Network from 'resource:///org/gnome/shell/ui/status/network.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const HOTSPOT_LABEL = _('Turn On Wi-Fi Hotspot');
const WIFI_PANEL_DESKTOP_FILE = 'gnome-wifi-panel.desktop';

// Hotspot activation is delegated to NetworkManager CLI.
const ENABLE_WIFI_COMMAND = ['nmcli', 'radio', 'wifi', 'on'];
const ENABLE_HOTSPOT_COMMAND = ['nmcli', 'device', 'wifi', 'hotspot'];

class HotspotMenuController {
    constructor(logger) {
        this._entries = new Map(); // menu -> {indicator, menu, item, signalId}
        this._cancellable = new Gio.Cancellable();
        this._logger = logger;
    }

    destroy() {
        this._cancellable.cancel();

        for (const entry of this._entries.values()) {
            entry.menu.disconnect(entry.signalId);
            entry.item.destroy();
        }

        this._entries.clear();
    }

    attachIndicator(indicator) {
        const menu = indicator._wirelessToggle.menu;
        if (this._entries.has(menu))
            return;

        const item = menu.addAction(HOTSPOT_LABEL, () => {
            this._turnOnHotspot(indicator).catch(e =>
                this._logger?.message(`failed to turn on hotspot: ${e}`));
        });

        const signalId = menu.connect('open-state-changed', () => {
            this._syncEntry(menu, indicator);
        });

        this._entries.set(menu, {indicator, menu, item, signalId});

        this._moveBeforeAllNetworks(menu, item);
        this._syncEntry(menu, indicator);
    }

    _moveBeforeAllNetworks(menu, item) {
        const allNetworksItem = menu._settingsActions[WIFI_PANEL_DESKTOP_FILE];
        if (!allNetworksItem)
            return;

        const items = menu._getMenuItems();
        const position = items.indexOf(allNetworksItem);

        if (position >= 0)
            menu.moveMenuItem(item, position);
    }

    _syncEntry(menu, indicator) {
        const entry = this._entries.get(menu);
        entry.item.visible = !this._isHotspotActive(indicator);
    }

    _isHotspotActive(indicator) {
        const primaryItem = indicator._wirelessToggle._itemBinding.source;
        return primaryItem.is_hotspot;
    }

    async _turnOnHotspot(indicator) {
        let result = await this._runCommand(ENABLE_WIFI_COMMAND);
        if (!result.ok) {
            this._logger?.message(`failed to enable Wi-Fi: ${result.stderr}`);
            return;
        }
    
        result = await this._runCommand(ENABLE_HOTSPOT_COMMAND);
        if (!result.ok) {
            this._logger?.message(`failed to enable hotspot: ${result.stderr}`);
            return;
        }
    
        this._syncEntry(indicator._wirelessToggle.menu, indicator);
    }

    _runCommand(argv) {
        return new Promise(resolve => {
            let proc;
            try {
                proc = Gio.Subprocess.new(
                    argv,
                    Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_PIPE
                );
            } catch (e) {
                resolve({ok: false, stderr: String(e)});
                return;
            }

            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                try {
                    const [, , stderr] = p.communicate_utf8_finish(res);
                    resolve({ok: p.get_successful(), stderr: stderr ?? ''});
                } catch (e) {
                    // Gio.IOErrorEnum.CANCELLED is expected during disable()
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        resolve({ok: false, stderr: 'cancelled'});
                    else
                        resolve({ok: false, stderr: String(e)});
                }
            });
        });
    }
}

export default class WifiHotspotQuickSettingsMenuExtension extends Extension {
    enable() {
        this._logger = this.getLogger();
        this._controller = new HotspotMenuController(this._logger);

        const controller = this._controller;
        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(
            Network.Indicator.prototype, '_init',
            originalMethod => {
                return function (...args) {
                    const result = originalMethod.call(this, ...args);
                    controller.attachIndicator(this);
                    return result;
                };
            }
        );

        const indicator = Main.panel.statusArea.quickSettings._network;
        if (indicator)
            this._controller.attachIndicator(indicator);
    }

    disable() {
        this._injectionManager.clear();
        this._injectionManager = null;

        this._controller.destroy();
        this._controller = null;

        this._logger = null;
    }
}
