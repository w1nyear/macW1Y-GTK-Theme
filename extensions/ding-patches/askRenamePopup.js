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
/* exported AskRenamePopup */
"use strict";
const Atk = imports.gi.Atk;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const DBusUtils = imports.dbusUtils;
const DesktopIconsUtil = imports.desktopIconsUtil;
const Gettext = imports.gettext.domain("ding");
const SignalManager = imports.signalManager;

const _ = Gettext.gettext;

var AskRenamePopup = class extends SignalManager.SignalManager {
    constructor(extensionManager, fileItem, allowReturnOnSameName, closeCB) {
        super();
        this._extensionManager = extensionManager;
        this._closeCB = closeCB;
        this._allowReturnOnSameName = allowReturnOnSameName;
        this._desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        this._fileItem = fileItem;
        this._isDestroyed = false;

        let targetX = 100;
        let targetY = 100;
        let popupW = 340;
        let popupH = 86;
        try {
            let [iconX, iconY] = fileItem._grid.coordinatesLocalToGlobal(0, 0, fileItem._iconContainer);
            let iconW = fileItem._iconContainer.get_allocated_width() || 48;
            let iconH = fileItem._iconContainer.get_allocated_height() || 48;
            if (iconX === undefined || isNaN(iconX)) {
                iconX = fileItem.iconRectangle.x;
                iconY = fileItem.iconRectangle.y;
                iconW = fileItem.iconRectangle.width;
                iconH = fileItem.iconRectangle.height;
            }
            if (fileItem.relativeX > 0.5) {
                targetX = iconX - popupW - 12;
            } else {
                targetX = iconX + iconW + 12;
            }
            targetY = iconY;
            let monitor = fileItem._grid ? fileItem._grid._desktopDescription : null;
            if (monitor) {
                let minX = monitor.x + 10;
                let maxX = monitor.x + monitor.width - popupW - 10;
                let minY = monitor.y + 10;
                let maxY = monitor.y + monitor.height - popupH - 10;
                targetX = Math.max(minX, Math.min(targetX, maxX));
                targetY = Math.max(minY, Math.min(targetY, maxY));
            }
        } catch (e) {
            console.log("Failed to calculate coordinates for rename popup: " + e.message);
            targetX = 200;
            targetY = 200;
        }
        targetX = Math.round(targetX);
        targetY = Math.round(targetY);

        this._window = new Gtk.Window({
            type: Gtk.WindowType.TOPLEVEL,
            decorated: false,
            resizable: false,
            title: `@!${targetX},${targetY};HTDF`,
        });
        this._window.set_skip_taskbar_hint(true);
        this._window.set_skip_pager_hint(true);
        this._window.set_keep_above(true);
        this._window.stick();

        let screen = Gdk.Screen.get_default();
        let visual = screen.get_rgba_visual();
        if (visual) {
            this._window.set_visual(visual);
        }
        this._window.set_app_paintable(true);
        this._window.get_style_context().add_class("rename-popup");

        let contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
        });
        contentBox.get_style_context().add_class("rename-box");
        this._window.add(contentBox);

        let label = new Gtk.Label({
            label: fileItem.isDirectory ? _("Folder name") : _("File name"),
            justify: Gtk.Justification.LEFT,
            halign: Gtk.Align.START,
        });
        contentBox.pack_start(label, false, false, 0);
        contentBox.get_accessible().add_relationship(Atk.RelationType.LABELLED_BY, label.get_accessible());

        let row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
        });
        contentBox.pack_start(row, false, false, 0);

        this._textArea = new Gtk.Entry();
        this._textArea.text = fileItem.fileName;
        this._textArea.set_width_chars(24);
        row.pack_start(this._textArea, true, true, 0);

        this._button = new Gtk.Button({label: allowReturnOnSameName ? _("OK") : _("Rename")});
        this._button.get_style_context().add_class("suggested-action");
        row.pack_start(this._button, false, false, 0);

        this.connectSignal(this._button, "clicked", this._do_rename.bind(this));
        this.connectSignal(this._textArea, "changed", this._validate.bind(this));
        this.connectSignal(this._textArea, "activate", this._do_rename.bind(this));

        let isReady = false;
        this.connectSignal(this._window, "map-event", () => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (!this._isDestroyed) {
                    isReady = true;
                }
                return GLib.SOURCE_REMOVE;
            });
            return false;
        });

        this.connectSignal(this._window, "focus-out-event", () => {
            if (isReady && !this._isDestroyed) {
                this._cleanAll();
            }
            return false;
        });

        this.connectSignal(this._window, "key-press-event", (widget, event) => {
            let [, keyval] = event.get_keyval();
            if (keyval === Gdk.KEY_Escape) {
                this._cleanAll();
                return true;
            }
            return false;
        });

        this.connectSignal(this._window, "delete-event", () => {
            this._cleanAll();
            return false;
        });

        this._extensionManager.showPopup();
        this._window.show_all();
        this._window.present();
        this._validate();
        this._textArea.grab_focus_without_selecting();
        this._textArea.select_region(0, DesktopIconsUtil.getFileExtensionOffset(fileItem.fileName, {"isDirectory": fileItem.isDirectory}).offset);
    }

    _cleanAll() {
        if (this._isDestroyed) {
            return;
        }
        this._isDestroyed = true;
        this.disconnectAllSignals();
        this._extensionManager.hidePopup();
        if (this._window) {
            this._window.destroy();
            this._window = null;
        }
        this._closeCB();
    }

    updateFileItem(fileItem) {
        this._fileItem = fileItem;
        if (fileItem) {
            this._textArea.set_position(this._cursorPosition);
        } else {
            this._cursorPosition = this._textArea.get_position();
        }
    }

    _validate() {
        let text = this._textArea.text;
        let finalPath = `${this._desktopPath}/${text}`;
        let finalFile = Gio.File.new_for_commandline_arg(finalPath);
        if ((text == "") || (text.indexOf("/") !== -1) ||
           ((text == this._fileItem.fileName) && !this._allowReturnOnSameName) ||
           (finalFile.query_exists(null) && (text !== this._fileItem.fileName))) {
            this._button.sensitive = false;
        } else {
            this._button.sensitive = true;
        }
    }

    _do_rename() {
        if (!this._button.sensitive) {
            return;
        }
        let newName = this._textArea.text;
        let oldName = this._fileItem.fileName;
        let uri = this._fileItem.file.get_uri();
        this._cleanAll();
        if (oldName == newName) {
            return;
        }
        DBusUtils.RemoteFileOperations.RenameURIRemote(
            uri, newName
        );
    }

    closeWindow() {
        this._cleanAll();
    }
};
