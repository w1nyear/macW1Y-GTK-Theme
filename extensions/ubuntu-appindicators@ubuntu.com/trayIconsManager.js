


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import * as IndicatorStatusIcon from './indicatorStatusIcon.js';
import * as Util from './util.js';
import * as SettingsManager from './settingsManager.js';

let trayIconsManager;

export class TrayIconsManager extends Signals.EventEmitter {
    static initialize() {
        if (!trayIconsManager)
            trayIconsManager = new TrayIconsManager();
        return trayIconsManager;
    }

    static destroy() {
        trayIconsManager.destroy();
    }

    constructor() {
        super();

        if (trayIconsManager)
            throw new Error('TrayIconsManager is already constructed');

        this._changedId = SettingsManager.getDefaultGSettings().connect(
            'changed::legacy-tray-enabled', () => this._toggle());

        this._toggle();
    }

    _toggle() {
        if (SettingsManager.getDefaultGSettings().get_boolean('legacy-tray-enabled'))
            this._enable();
        else
            this._disable();
    }

    _getPanelBgColor() {
        return Main.panel?.get_parent()
            ? Main.panel.get_theme_node()?.get_background_color() : null;
    }

    _enable() {
        if (this._tray)
            return;

        this._tray = new Shell.TrayManager({bgColor: this._getPanelBgColor()});
        Util.connectSmart(this._tray, 'tray-icon-added', this, this.onTrayIconAdded);
        Util.connectSmart(this._tray, 'tray-icon-removed', this, this.onTrayIconRemoved);

        this._tray.manage_screen(Main.panel);
    }

    _disable() {
        if (!this._tray)
            return;

        IndicatorStatusIcon.getTrayIcons().forEach(i => i.destroy());
        this._tray.unmanage_screen();
        this._tray = null;
    }

    onTrayIconAdded(_tray, icon) {
        const trayIcon = new IndicatorStatusIcon.IndicatorStatusTrayIcon(icon);
        IndicatorStatusIcon.addIconToPanel(trayIcon);
    }

    onTrayIconRemoved(_tray, icon) {
        try {
            const [trayIcon] = IndicatorStatusIcon.getTrayIcons().filter(i => i.icon === icon);
            trayIcon.destroy();
        } catch (e) {
            Util.Logger.warning(`No icon container found for ${icon.title} (${icon})`);
        }
    }

    destroy() {
        this.emit('destroy');
        SettingsManager.getDefaultGSettings().disconnect(this._changedId);
        this._disable();
        trayIconsManager = null;
    }
}
