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
    /**
     * @param {Object} params
     */
    constructor(params = {}) {
        super(params);
        // Load the settings.
        this.#settings = ExtensionPreferences.lookupByURL(import.meta.url).getSettings();
        // Add a placeholder widget for the case, where no GtkListBoxRows are
        // present.
        this.set_placeholder(new PrefsBoxOrderListEmptyPlaceholder());
    }
    get boxOrder() {
        return this._boxOrder;
    }
    set boxOrder(value) {
        this._boxOrder = value;
        // Get the actual box order for the given box order name from settings.
        const boxOrder = this.#settings.get_strv(this._boxOrder);
        // Populate this GtkListBox with GtkListBoxRows for the items of the
        // given configured box order.
        for (const item of boxOrder) {
            const row = new PrefsBoxOrderItemRow({}, item);
            this.insertRow(row, -1);
        }
        this.determineRowMoveActionEnable();
        this.notify("box-order");
    }
    /**
     * Inserts the given PrefsBoxOrderItemRow to this list box at the given
     * position.
     * Also handles stuff like connecting signals.
     */
    insertRow(row, position) {
        this.insert(row, position);
        const signalHandlerIds = [];
        signalHandlerIds.push(row.connect("move", (row, direction) => {
            this.emit("row-move", row, direction);
        }));
        this.#rowSignalHandlerIds.set(row, signalHandlerIds);
    }
    /**
     * Removes the given PrefsBoxOrderItemRow from this list box.
     * Also handles stuff like disconnecting signals.
     */
    removeRow(row) {
        const signalHandlerIds = this.#rowSignalHandlerIds.get(row) ?? [];
        for (const id of signalHandlerIds) {
            row.disconnect(id);
        }
        this.remove(row);
    }
    /**
     * Saves the box order represented by `this` (and its
     * `PrefsBoxOrderItemRows`) to settings.
     */
    saveBoxOrderToSettings() {
        let currentBoxOrder = [];
        for (let potentialPrefsBoxOrderItemRow of this) {
            // Only process PrefsBoxOrderItemRows.
            if (!(potentialPrefsBoxOrderItemRow instanceof PrefsBoxOrderItemRow)) {
                continue;
            }
            const item = potentialPrefsBoxOrderItemRow.item;
            currentBoxOrder.push(item);
        }
        this.#settings.set_strv(this.boxOrder, currentBoxOrder);
    }
    /**
     * Determines whether or not each move action of each PrefsBoxOrderItemRow
     * should be enabled or disabled.
     */
    determineRowMoveActionEnable() {
        for (let potentialPrefsBoxOrderItemRow of this) {
            // Only process PrefsBoxOrderItemRows.
            if (!(potentialPrefsBoxOrderItemRow instanceof PrefsBoxOrderItemRow)) {
                continue;
            }
            const row = potentialPrefsBoxOrderItemRow;
            // If the current row is the topmost row in the topmost list box,
            // then disable the move-up action.
            if (row.get_index() === 0 && this.boxOrder === "left-box-order") {
                row.action_set_enabled("row.move-up", false);
            }
            else { // Else enable it.
                row.action_set_enabled("row.move-up", true);
            }
            // If the current row is the bottommost row in the bottommost list
            // box, then disable the move-down action.
            const rowNextSibling = row.get_next_sibling();
            if ((rowNextSibling instanceof PrefsBoxOrderListEmptyPlaceholder || rowNextSibling === null) && this.boxOrder === "right-box-order") {
                row.action_set_enabled("row.move-down", false);
            }
            else { // Else enable it.
                row.action_set_enabled("row.move-down", true);
            }
        }
    }
}
