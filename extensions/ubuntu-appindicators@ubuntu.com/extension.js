


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



import * as Extension from 'resource:///org/gnome/shell/extensions/extension.js';

import * as StatusNotifierWatcher from './statusNotifierWatcher.js';
import * as Interfaces from './interfaces.js';
import * as TrayIconsManager from './trayIconsManager.js';
import * as Util from './util.js';
import {Logger} from './logger.js';
import {SettingsManager} from './settingsManager.js';

export default class AppIndicatorExtension extends Extension.Extension {
    constructor(...args) {
        super(...args);

        Logger.init(this);
        Interfaces.initialize(this);

        this._isEnabled = false;
        this._statusNotifierWatcher = null;
        this._watchDog = new Util.NameWatcher(StatusNotifierWatcher.WATCHER_BUS_NAME);
        this._watchDogId = this._watchDog.connect('vanished',
            () => this._maybeEnableAfterNameAvailable());




        /* eslint-disable no-undef */
        if (typeof global['--appindicator-extension-on-reload'] === 'function')
            global['--appindicator-extension-on-reload']();

        global['--appindicator-extension-on-reload'] = () => {
            Logger.debug('Reload detected, destroying old watchdog');
            this._watchDog.disconnect(this._watchDogId);
            this._watchDog.destroy();
            this._watchDog = null;
        };
        /* eslint-enable no-undef */
    }

    enable() {
        this._isEnabled = true;
        SettingsManager.initialize(this);
        Util.tryCleanupOldIndicators();
        this._maybeEnableAfterNameAvailable();
        TrayIconsManager.TrayIconsManager.initialize();
    }

    disable() {
        this._isEnabled = false;
        TrayIconsManager.TrayIconsManager.destroy();

        if (this._statusNotifierWatcher !== null) {
            this._statusNotifierWatcher.destroy();
            this._statusNotifierWatcher = null;
        }

        SettingsManager.destroy();
    }







    _maybeEnableAfterNameAvailable() {

        if (!this._isEnabled || this._statusNotifierWatcher)
            return;

        if (this._watchDog.nameAcquired && this._watchDog.nameOnBus)
            return;

        this._statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher(
            this, this._watchDog);
    }
}
