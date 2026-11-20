/* DING: Desktop Icons New Generation for GNOME Shell
 *
 * Copyright (C) 2019 Sergio Costas (rastersoft@gmail.com)
 * Based on code original (C) Carlos Soriano
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
'use strict';
imports.gi.versions.Gtk = '3.0';

const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GioSSS = Gio.SettingsSchemaSource;
const DesktopIconsUtil = imports.desktopIconsUtil;
const Enums = imports.enums;
const PrefsWindow = imports.prefswindow;

const Gettext = imports.gettext;

var _ = Gettext.domain('ding').gettext;

var nautilusSettings;
var nautilusCompression;
var gtkSettings;
var desktopSettings;
var mutterSettings = null;
var a11YKeyboard = null;
var a11YApplications = null;
var a11YInterface = null;
// This is already in Nautilus settings, so it should not be made tweakable here
var CLICK_POLICY_SINGLE = false;
var prefsWindow;

/**
 *
 * @param path
 */
function init(path) {
    const schemaSource = GioSSS.get_default();
    const schemaGtk = schemaSource.lookup(Enums.SCHEMA_GTK, true);
    gtkSettings = new Gio.Settings({settings_schema: schemaGtk});
    const schemaObj = schemaSource.lookup(Enums.SCHEMA_NAUTILUS, true);
    if (!schemaObj) {
        nautilusSettings = null;
    } else {
        nautilusSettings = new Gio.Settings({settings_schema: schemaObj});
        nautilusSettings.connect('changed', _onNautilusSettingsChanged);
        _onNautilusSettingsChanged();
    }
    const compressionSchema = schemaSource.lookup(Enums.SCHEMA_NAUTILUS_COMPRESSION, true);
    if (!compressionSchema) {
        nautilusCompression = null;
    } else {
        nautilusCompression = new Gio.Settings({settings_schema: compressionSchema});
    }
    const schemaInterface = schemaSource.lookup(Enums.SCHEMA_INTERFACE, true);
    if (schemaInterface) {
        this.schemaGnomeInterface = new Gio.Settings({ settings_schema: schemaInterface});
    }
    const schemaA11YKeyboard = schemaSource.lookup(Enums.SCHEMA_A11Y_KEYBOARD, true);
    if (schemaA11YKeyboard) {
        a11YKeyboard = new Gio.Settings({ settings_schema: schemaA11YKeyboard});
    }
    const schemaA11YApplications = schemaSource.lookup(Enums.SCHEMA_A11Y_APPLICATIONS, true);
    if (schemaA11YApplications) {
        a11YApplications = new Gio.Settings({ settings_schema: schemaA11YApplications});
    }
    const schemaA11YInterface = schemaSource.lookup(Enums.SCHEMA_A11Y_INTERFACE, true);
    if (schemaA11YInterface) {
        a11YInterface = new Gio.Settings({ settings_schema: schemaA11YInterface });
    }

    desktopSettings = PrefsWindow.get_schema(path, Enums.SCHEMA);
    let schemaMutter = schemaSource.lookup(Enums.SCHEMA_MUTTER, true);
    if (schemaMutter) {
        mutterSettings = new Gio.Settings({settings_schema: schemaMutter});
    }
}

/**
 *
 */
function showPreferences() {
    if (prefsWindow) {
        return;
    }
    prefsWindow = new Gtk.Window({
        resizable: false,
        window_position: Gtk.WindowPosition.CENTER,
    });
    prefsWindow.connect('destroy', () => {
        prefsWindow = null;
    });
    prefsWindow.set_title(_('Settings'));
    DesktopIconsUtil.windowHidePagerTaskbarModal(prefsWindow, true);
    let frame = PrefsWindow.preferencesFrame(Gtk, desktopSettings, nautilusSettings, gtkSettings);
    prefsWindow.add(frame);
    prefsWindow.show_all();
}

/**
 *
 */
function _onNautilusSettingsChanged() {
    CLICK_POLICY_SINGLE = nautilusSettings.get_string('click-policy') == 'single';
}

/**
 *
 */
function get_icon_size() {
    return Enums.ICON_SIZE[desktopSettings.get_string('icon-size')];
}

/**
 *
 */
function get_desired_width() {
    return Enums.ICON_WIDTH[desktopSettings.get_string('icon-size')];
}

/**
 *
 */
function get_desired_height() {
    return Enums.ICON_HEIGHT[desktopSettings.get_string('icon-size')];
}

function increase_icon_size() {
    const currentSize = desktopSettings.get_enum('icon-size');
    switch(currentSize) {
        case 3: // tiny
            desktopSettings.set_enum('icon-size', 0); // small
            break;
        case 2: // large
            break;
        default:
            desktopSettings.set_enum('icon-size', currentSize+1);
            break;
    }
}

function decrease_icon_size() {
    const currentSize = desktopSettings.get_enum('icon-size');
    switch(currentSize) {
        case 3: // tiny
            break;
        case 0: // small
            desktopSettings.set_enum('icon-size', 3);
            break;
        default:
            desktopSettings.set_enum('icon-size', currentSize-1);
            break;
    }
}

/**
 *
 */
function get_start_corner() {
    return Enums.START_CORNER[desktopSettings.get_string('start-corner')].slice();
}

/**
 *
 */
function getSortOrder() {
    return Enums.SortOrder[desktopSettings.get_string(Enums.SortOrder.ORDER)];
}

/**
 *
 * @param order
 */
function setSortOrder(order) {
    let x = Object.values(Enums.SortOrder).indexOf(order);
    desktopSettings.set_enum(Enums.SortOrder.ORDER, x);
}

/**
 *
 */
function getUnstackList() {
    return desktopSettings.get_strv('unstackedtypes');
}

/**
 *
 * @param array
 */
function setUnstackList(array) {
    desktopSettings.set_strv('unstackedtypes', array);
}
