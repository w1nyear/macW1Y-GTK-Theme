"use strict";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import PrefsBoxOrderItemRow from "./PrefsBoxOrderItemRow.js";
export default class PrefsBoxOrderListEmptyPlaceholder extends Gtk.Box {
    static {
        GObject.registerClass({
            GTypeName: "PrefsBoxOrderListEmptyPlaceholder",
            Template: GLib.uri_resolve_relative(import.meta.url, "../ui/prefs-box-order-list-empty-placeholder.ui", GLib.UriFlags.NONE),
        }, this);
    }


    onDrop(_target, value, _x, _y) {



        if (!(value instanceof PrefsBoxOrderItemRow)) {

            return false;
        }

        const ownListBox = this.get_parent();
        const valueListBox = value.get_parent();

        valueListBox.removeRow(value);

        ownListBox.insertRow(value, 0);


        ownListBox.saveBoxOrderToSettings();
        ownListBox.determineRowMoveActionEnable();
        valueListBox.saveBoxOrderToSettings();
        valueListBox.determineRowMoveActionEnable();
        return true;
    }
}
