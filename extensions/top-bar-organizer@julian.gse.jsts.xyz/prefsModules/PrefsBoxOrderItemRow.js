"use strict";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import PrefsBoxOrderItemOptionsDialog from "./PrefsBoxOrderItemOptionsDialog.js";
export default class PrefsBoxOrderItemRow extends Adw.ActionRow {
    static {
        GObject.registerClass({
            GTypeName: "PrefsBoxOrderItemRow",
            Template: GLib.uri_resolve_relative(import.meta.url, "../ui/prefs-box-order-item-row.ui", GLib.UriFlags.NONE),
            Signals: {
                "move": {
                    param_types: [GObject.TYPE_STRING],
                },
            },
        }, this);
        this.install_action("row.forget", null, (self, _actionName, _param) => {
            const parentListBox = self.get_parent();
            parentListBox.removeRow(self);
            parentListBox.saveBoxOrderToSettings();
            parentListBox.determineRowMoveActionEnable();
        });
        this.install_action("row.options", null, (self, _actionName, _param) => {
            const itemOptionsDialog = new PrefsBoxOrderItemOptionsDialog({
                // Get the title from self as the constructor of
                // PrefsBoxOrderItemRow already processes the item name into a
                // nice title.
                title: self.get_title()
            }, self.item);
            itemOptionsDialog.present(self);
        });
        this.install_action("row.move-up", null, (self, _actionName, _param) => self.emit("move", "up"));
        this.install_action("row.move-down", null, (self, _actionName, _param) => self.emit("move", "down"));
    }
    item;
    #drag_starting_point_x;
    #drag_starting_point_y;
    constructor(params = {}, item) {
        super(params);
        // Associate `this` with an item.
        this.item = item;
        if (this.item.startsWith("appindicator-kstatusnotifieritem-")) {
            // Set the title to something nicer, if the associated item is an
            // AppIndicator/KStatusNotifierItem item.
            this.set_title(this.item.replace("appindicator-kstatusnotifieritem-", ""));
        }
        else if (this.item === "item-role-group-task-up-ultralite") {
            // Set the title to something nicer, if the item in question is the
            // Task Up UltraLite item role group.
            this.set_title("Task Up UltraLite Items");
        }
        else {
            // Otherwise just set it to `item`.
            this.set_title(this.item);
        }
    }
    onDragPrepare(_source, x, y) {
        const value = new GObject.Value();
        value.init(PrefsBoxOrderItemRow.$gtype);
        value.set_object(this);
        this.#drag_starting_point_x = x;
        this.#drag_starting_point_y = y;
        return Gdk.ContentProvider.new_for_value(value);
    }
    onDragBegin(_source, drag) {
        let dragWidget = new Gtk.ListBox();
        let allocation = this.get_allocation();
        dragWidget.set_size_request(allocation.width, allocation.height);
        let dragPrefsBoxOrderItemRow = new PrefsBoxOrderItemRow({}, this.item);
        dragWidget.append(dragPrefsBoxOrderItemRow);
        dragWidget.drag_highlight_row(dragPrefsBoxOrderItemRow);
        let currentDragIcon = Gtk.DragIcon.get_for_drag(drag);
        currentDragIcon.set_child(dragWidget);
        // Even tho this should always be the case, ensure the values for the hotspot aren't undefined.
        if (typeof this.#drag_starting_point_x !== "undefined" &&
            typeof this.#drag_starting_point_y !== "undefined") {
            drag.set_hotspot(this.#drag_starting_point_x, this.#drag_starting_point_y);
        }
    }
    // Handle a new drop on `this` properly.
    // `value` is the thing getting dropped.
    onDrop(_target, value, _x, _y) {
        // According to the type annotations of Gtk.DropTarget, value is of type
        // GObject.Value, so ensure the one we work with is of type
        // PrefsBoxOrderItemRow.
        if (!(value instanceof PrefsBoxOrderItemRow)) {
            // TODO: maybe add logging
            return false;
        }
        // If `this` got dropped onto itself, do nothing.
        if (value === this) {
            return false;
        }
        // Get the GtkListBoxes of `this` and the drop value.
        const ownListBox = this.get_parent();
        const valueListBox = value.get_parent();
        // Get the position of `this` and the drop value.
        const ownPosition = this.get_index();
        const valuePosition = value.get_index();
        // Remove the drop value from its list box.
        valueListBox.removeRow(value);
        // Since an element got potentially removed from the list of `this`,
        // get the position of `this` again.
        const updatedOwnPosition = this.get_index();
        if (ownListBox !== valueListBox) {
            // First handle the case where `this` and the drop value are in
            // different list boxes.
            if ((ownListBox.boxOrder === "right-box-order" && valueListBox.boxOrder === "left-box-order")
                || (ownListBox.boxOrder === "right-box-order" && valueListBox.boxOrder === "center-box-order")
                || (ownListBox.boxOrder === "center-box-order" && valueListBox.boxOrder === "left-box-order")) {
                // If the list box of the drop value comes before the list
                // box of `this`, add the drop value after `this`.
                ownListBox.insertRow(value, updatedOwnPosition + 1);
            }
            else {
                // Otherwise, add the drop value where `this` currently is.
                ownListBox.insertRow(value, updatedOwnPosition);
            }
        }
        else {
            if (valuePosition < ownPosition) {
                // If the drop value was before `this`, add the drop value
                // after `this`.
                ownListBox.insertRow(value, updatedOwnPosition + 1);
            }
            else {
                // Otherwise, add the drop value where `this` currently is.
                ownListBox.insertRow(value, updatedOwnPosition);
            }
        }
        /// Finally save the box order(/s) to settings and make sure move
        /// actions are correctly enabled/disabled.
        ownListBox.saveBoxOrderToSettings();
        ownListBox.determineRowMoveActionEnable();
        // If the list boxes of `this` and the drop value were different, handle
        // the former list box of the drop value as well.
        if (ownListBox !== valueListBox) {
            valueListBox.saveBoxOrderToSettings();
            valueListBox.determineRowMoveActionEnable();
        }
        return true;
    }
}
