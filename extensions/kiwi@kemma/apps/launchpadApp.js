/*
 * Kiwi is not macW1Y – macW1Y-inspired enhancements for GNOME Shell.
 * Copyright (C) 2025  Arnis Kemlers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { toggle as tahoeToggle } from './tahoeApps.js';


const LAUNCHPAD_DESKTOP_ID = 'org.gnome.Shell.Extensions.Kiwi.Launchpad.desktop';
const ICON_RELATIVE_PATH = 'icons/launchpad.svg';
const DBUS_NAME = 'org.gnome.Shell.Extensions.Kiwi';

const APP_DBUS_NAME = 'org.gnome.Shell.Extensions.Kiwi.Launchpad';
const DBUS_OBJECT_PATH = '/org/gnome/Shell/Extensions/Kiwi';
const DBUS_INTERFACE_XML = `
<node>
  <interface name="org.gnome.Shell.Extensions.Kiwi">
    <method name="ShowLaunchpad"/>
  </interface>
</node>`;

const APP_DBUS_OBJECT_PATH = '/org/gnome/Shell/Extensions/Kiwi/Launchpad';
const APP_DBUS_INTERFACE_XML = `
<node>
    <interface name="org.freedesktop.Application">
        <method name="Activate">
            <arg type="a{sv}" direction="in"/>
        </method>
    </interface>
</node>`;

let _enabled = false;
let _busOwnerId = 0;
let _dbusExport = null;
let _appBusOwnerId = 0;
let _appDbusExport = null;
const _mainLoopSources = new Set();
const _overviewSignalIds = new Set();
let gettextFunc = (message) => message;

function _queueIdle(callback) {
    const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        _mainLoopSources.delete(id);
        return callback();
    });
    _mainLoopSources.add(id);
}

function _clearMainLoopSources() {
    for (const id of _mainLoopSources)
        GLib.Source.remove(id);
    _mainLoopSources.clear();
}

function _disconnectOverviewHandler(id) {
    if (!_overviewSignalIds.has(id))
        return;
    Main.overview.disconnect(id);
    _overviewSignalIds.delete(id);
}

function _clearOverviewHandlers() {
    for (const id of _overviewSignalIds) {
        Main.overview.disconnect(id);
    }
    _overviewSignalIds.clear();
}

function _isAppGridVisible() {
    if (!Main.overview.visible)
        return false;


    const overview = Main.overview;
    let controls = overview._overview?._controls;
    if (!controls)
        controls = overview.controls || overview._controls;

    if (!controls)
        return false;


    if (controls._stateAdjustment)
        return controls._stateAdjustment.value === 2;


    const dash = controls.dash || controls._dash;
    if (dash?.showAppsButton)
        return Boolean(dash.showAppsButton.checked);

    return false;
}

function _activateLaunchpad() {


    _queueIdle(() => {
        tahoeToggle();
        return GLib.SOURCE_REMOVE;
    });
    return 'OK';
}

function _getOverviewControls() {
    const overview = Main.overview;
    let controls = overview._overview?._controls;
    if (!controls)
        controls = overview.controls || overview._controls;
    return controls || null;
}

function _ensureDbusService() {
    if (_busOwnerId !== 0)
        return;

    const implementation = {
        ShowLaunchpad: () => _activateLaunchpad(),
    };

    _dbusExport = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE_XML, implementation);
    _busOwnerId = Gio.bus_own_name(
        Gio.BusType.SESSION,
        DBUS_NAME,
        Gio.BusNameOwnerFlags.REPLACE,
        connection => {
            _dbusExport.export(connection, DBUS_OBJECT_PATH);
        },
        null,
        () => {
            if (_dbusExport) {
                _dbusExport.unexport();
                _dbusExport = null;
            }
            _busOwnerId = 0;
        },
    );

    const appImplementation = {
        Activate(_platformData) {
            _activateLaunchpad();
        },
    };
    _appDbusExport = Gio.DBusExportedObject.wrapJSObject(APP_DBUS_INTERFACE_XML, appImplementation);
    _appBusOwnerId = Gio.bus_own_name(
        Gio.BusType.SESSION,
        APP_DBUS_NAME,
        Gio.BusNameOwnerFlags.REPLACE,
        connection => {
            _appDbusExport.export(connection, APP_DBUS_OBJECT_PATH);
        },
        null,
        () => {
            if (_appDbusExport) {
                _appDbusExport.unexport();
                _appDbusExport = null;
            }
            _appBusOwnerId = 0;
        },
    );
}

function _teardownDbusService() {
    if (_busOwnerId !== 0) {
        Gio.bus_unown_name(_busOwnerId);
        _busOwnerId = 0;
    }

    if (_appBusOwnerId !== 0) {
        Gio.bus_unown_name(_appBusOwnerId);
        _appBusOwnerId = 0;
    }

    if (_dbusExport) {
        _dbusExport.unexport();
        _dbusExport = null;
    }
    if (_appDbusExport) {
        _appDbusExport.unexport();
        _appDbusExport = null;
    }
}

export function enable(extension, gettext) {
    gettextFunc = typeof gettext === 'function' ? gettext : (message) => message;



    if (_enabled)
        return;
    if (!extension || !extension.dir) {
        console.error('Launchpad: Missing extension context');
        return;
    }

    _enabled = true;
    _ensureDbusService();

    const desktopDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
    GLib.mkdir_with_parents(desktopDir, 0o755);

    const desktopPath = GLib.build_filenamev([desktopDir, LAUNCHPAD_DESKTOP_ID]);


    const settings = extension.getSettings();
    const customIconPath = settings.get_string('launchpad-app-custom-icon');
    let iconPath = null;

    if (customIconPath) {
        const customFile = Gio.File.new_for_path(customIconPath);
        if (customFile.query_exists(null))
            iconPath = customIconPath;
    }

    if (!iconPath) {
        const iconFile = extension.dir.resolve_relative_path(ICON_RELATIVE_PATH);
        iconPath = iconFile ? iconFile.get_path() : null;
    }

    if (!iconPath) {
        console.error('Launchpad: Failed to resolve icon path');
        return;
    }
    const desktopContent = `
        [Desktop Entry]
        Type=Application
        Name=${gettextFunc('Launchpad')}
        Comment=${gettextFunc('Open Application Overview')}
        Icon=${iconPath}
        DBusActivatable=true
        Exec=/usr/bin/true
        Terminal=false
        Categories=Utility;
        StartupNotify=false
        NoDisplay=false
        X-GNOME-UsesNotifications=false
`;

    try {
        GLib.file_set_contents(desktopPath, desktopContent);
    } catch (e) {
        console.error('Launchpad: Failed to create desktop file:', e);
        return;
    }

    _queueIdle(() => {
        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            const favorites = shellSettings.get_strv('favorite-apps');

            const OLD_ID = 'launchpad-kiwi.desktop';
            for (let i = favorites.length - 1; i >= 0; i--) {
                if (favorites[i] === OLD_ID)
                    favorites.splice(i, 1);
            }

            const existingIndex = favorites.indexOf(LAUNCHPAD_DESKTOP_ID);
            if (existingIndex >= 0)
                favorites.splice(existingIndex, 1);
            const insertPosition = Math.min(1, favorites.length);
            favorites.splice(insertPosition, 0, LAUNCHPAD_DESKTOP_ID);
            shellSettings.set_strv('favorite-apps', favorites);
        } catch (e) {
            console.error('Launchpad: Failed to add to favorites:', e);
        }
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    _enabled = false;
    try {
        const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        const favorites = shellSettings.get_strv('favorite-apps');
        const index = favorites.indexOf(LAUNCHPAD_DESKTOP_ID);
        if (index >= 0) {
            favorites.splice(index, 1);
            shellSettings.set_strv('favorite-apps', favorites);
        }
    } catch (e) {
        console.error('Launchpad: Failed to remove from favorites:', e);
    }

    _teardownDbusService();
    _clearMainLoopSources();
    _clearOverviewHandlers();

    const desktopPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', LAUNCHPAD_DESKTOP_ID]);
    const oldDesktopPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', 'launchpad-kiwi.desktop']);

    try {
        GLib.unlink(desktopPath);
    } catch (e) {

    }
    try {
        GLib.unlink(oldDesktopPath);
    } catch (e) {

    }

    gettextFunc = (message) => message;
}
