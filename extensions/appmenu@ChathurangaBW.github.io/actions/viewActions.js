import Gio from 'gi://Gio';
import * as Logger from '../logger.js';

const NAUTILUS_PREFS = 'org.gnome.nautilus.preferences';


let _settingsInstance = null;
function _getSettings() {
    if (!_settingsInstance) {
        _settingsInstance = new Gio.Settings({ schema_id: NAUTILUS_PREFS });
    }
    return _settingsInstance;
}

function gsettingsSet(key, value) {
    try {
        _getSettings().set_string(key, value);
    } catch (e) {
        Logger.error(`gsettings error: ${e}`);
    }
}

function gsettingsToggle(key) {
    try {
        const s = _getSettings();
        s.set_boolean(key, !s.get_boolean(key));
    } catch (e) {
        Logger.error(`gsettings error: ${e}`);
    }
}








function applyNautilusSetting(key, value) {

    gsettingsSet(key, value);
}

function toggleNautilusSetting(key) {
    try {
        const s = _getSettings();
        s.set_boolean(key, !s.get_boolean(key));
    } catch (e) {
        Logger.error(`gsettings error: ${e}`);
    }
}

export function disposeViewActions() {
    _settingsInstance = null;
}

export const viewActions = {
    'nautilus-icon-view': () => applyNautilusSetting('default-folder-viewer', 'icon-view'),
    'nautilus-list-view': () => applyNautilusSetting('default-folder-viewer', 'list-view'),
    'nautilus-sort-name': () => applyNautilusSetting('default-sort-order', 'name'),
    'nautilus-sort-date': () => applyNautilusSetting('default-sort-order', 'mtime'),
    'nautilus-sort-size': () => applyNautilusSetting('default-sort-order', 'size'),
    'nautilus-sort-type': () => applyNautilusSetting('default-sort-order', 'type'),
    'nautilus-reverse-sort': () => toggleNautilusSetting('default-sort-in-reverse-order'),
    'nautilus-toggle-path-bar': () => toggleNautilusSetting('always-use-location-entry'),
    'nautilus-toggle-hidden': () => toggleNautilusSetting('show-hidden-files'),
};
