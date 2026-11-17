"use strict";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import PrefsBoxOrderItemRow from "./PrefsBoxOrderItemRow.js";
import PrefsBoxOrderListEmptyPlaceholder from "./PrefsBoxOrderListEmptyPlaceholder.js";
export default class PrefsBoxOrderListBox extends Gtk.ListBox {
    static {
        GObject.registerClass({
            GTypeName: "PrefsBoxOrderListBox",
            Template: GLib.uri_resolve_relative(import.meta.url, "../ui/prefs-box-order-list-box.ui", GLib.UriFlags.NONE),
            Properties: {
                BoxOrder: GObject.ParamSpec.string("box-order", "Box Order", "The box order this PrefsBoxOrderListBox is associated with.", GObject.ParamFlags.READWRITE, ""),
            },
            Signals: {
                "row-move": {
                    param_types: [PrefsBoxOrderItemRow.$gtype, GObject.TYPE_STRING],
                },
            },
        }, this);
    }
    _boxOrder;
    #settings;
    #rowSignalHandlerIds = new Map();



    constructor(params = {}) {
        super(params);

        this.#settings = ExtensionPreferences.lookupByURL(import.meta.url).getSettings();


        this.set_placeholder(new PrefsBoxOrderListEmptyPlaceholder());
    }
    get boxOrder() {
        return this._boxOrder;
    }
    set boxOrder(value) {
        this._boxOrder = value;

        const boxOrder = this.#settings.get_strv(this._boxOrder);


        for (const item of boxOrder) {
            const row = new PrefsBoxOrderItemRow({}, item);
            this.insertRow(row, -1);
        }
        this.determineRowMoveActionEnable();
        this.notify("box-order");
    }





    insertRow(row, position) {
        this.insert(row, position);
        const signalHandlerIds = [];
        signalHandlerIds.push(row.connect("move", (row, direction) => {
            this.emit("row-move", row, direction);
        }));
        this.#rowSignalHandlerIds.set(row, signalHandlerIds);
    }




    removeRow(row) {
        const signalHandlerIds = this.#rowSignalHandlerIds.get(row) ?? [];
        for (const id of signalHandlerIds) {
            row.disconnect(id);
        }
        this.remove(row);
    }




    saveBoxOrderToSettings() {
        let currentBoxOrder = [];
        for (let potentialPrefsBoxOrderItemRow of this) {

            if (!(potentialPrefsBoxOrderItemRow instanceof PrefsBoxOrderItemRow)) {
                continue;
            }
            const item = potentialPrefsBoxOrderItemRow.item;
            currentBoxOrder.push(item);
        }
        this.#settings.set_strv(this.boxOrder, currentBoxOrder);
    }




    determineRowMoveActionEnable() {
        for (let potentialPrefsBoxOrderItemRow of this) {

            if (!(potentialPrefsBoxOrderItemRow instanceof PrefsBoxOrderItemRow)) {
                continue;
            }
            const row = potentialPrefsBoxOrderItemRow;


            if (row.get_index() === 0 && this.boxOrder === "left-box-order") {
                row.action_set_enabled("row.move-up", false);
            }
            else {
                row.action_set_enabled("row.move-up", true);
            }


            const rowNextSibling = row.get_next_sibling();
            if ((rowNextSibling instanceof PrefsBoxOrderListEmptyPlaceholder || rowNextSibling === null) && this.boxOrder === "right-box-order") {
                row.action_set_enabled("row.move-down", false);
            }
            else {
                row.action_set_enabled("row.move-down", true);
            }
        }
    }
}
