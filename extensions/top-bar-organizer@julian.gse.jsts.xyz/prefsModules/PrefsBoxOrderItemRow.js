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

        this.item = item;
        if (this.item.startsWith("appindicator-kstatusnotifieritem-")) {


            this.set_title(this.item.replace("appindicator-kstatusnotifieritem-", ""));
        }
        else if (this.item === "item-role-group-task-up-ultralite") {


            this.set_title("Task Up UltraLite Items");
        }
        else {

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

        if (typeof this.#drag_starting_point_x !== "undefined" &&
            typeof this.#drag_starting_point_y !== "undefined") {
            drag.set_hotspot(this.#drag_starting_point_x, this.#drag_starting_point_y);
        }
    }


    onDrop(_target, value, _x, _y) {



        if (!(value instanceof PrefsBoxOrderItemRow)) {

            return false;
        }

        if (value === this) {
            return false;
        }

        const ownListBox = this.get_parent();
        const valueListBox = value.get_parent();

        const ownPosition = this.get_index();
        const valuePosition = value.get_index();

        valueListBox.removeRow(value);


        const updatedOwnPosition = this.get_index();
        if (ownListBox !== valueListBox) {


            if ((ownListBox.boxOrder === "right-box-order" && valueListBox.boxOrder === "left-box-order")
                || (ownListBox.boxOrder === "right-box-order" && valueListBox.boxOrder === "center-box-order")
                || (ownListBox.boxOrder === "center-box-order" && valueListBox.boxOrder === "left-box-order")) {


                ownListBox.insertRow(value, updatedOwnPosition + 1);
            }
            else {

                ownListBox.insertRow(value, updatedOwnPosition);
            }
        }
        else {
            if (valuePosition < ownPosition) {


                ownListBox.insertRow(value, updatedOwnPosition + 1);
            }
            else {

                ownListBox.insertRow(value, updatedOwnPosition);
            }
        }


        ownListBox.saveBoxOrderToSettings();
        ownListBox.determineRowMoveActionEnable();


        if (ownListBox !== valueListBox) {
            valueListBox.saveBoxOrderToSettings();
            valueListBox.determineRowMoveActionEnable();
        }
        return true;
    }
}
