


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



let settingsManager;

export class SettingsManager {
    static initialize(extension) {
        SettingsManager._settingsManager = new SettingsManager(extension);
    }

    static destroy() {
        SettingsManager._settingsManager.destroy();
        SettingsManager._settingsManager = null;
    }

    static getDefault() {
        return this._settingsManager;
    }

    get gsettings() {
        return this._gsettings;
    }

    constructor(extension) {
        if (settingsManager)
            throw new Error('SettingsManager is already constructed');

        this._gsettings = extension.getSettings();
    }

    destroy() {
        this._gsettings = null;
    }
}

export function getDefault() {
    return SettingsManager.getDefault();
}

export function getDefaultGSettings() {
    return SettingsManager.getDefault().gsettings;
}
