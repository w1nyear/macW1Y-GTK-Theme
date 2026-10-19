"use strict";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import ScrollManager from "./ScrollManager.js";
import PrefsBoxOrderListEmptyPlaceholder from "./PrefsBoxOrderListEmptyPlaceholder.js";
// Imports to make UI file work.
// eslint-disable-next-line
import PrefsBoxOrderListBox from "./PrefsBoxOrderListBox.js";
export default class PrefsPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass({
            GTypeName: "PrefsPage",
            Template: GLib.uri_resolve_relative(import.meta.url, "../ui/prefs-page.ui", GLib.UriFlags.NONE),
            InternalChildren: [
                "left-box-order-list-box",
                "center-box-order-list-box",
                "right-box-order-list-box",
            ],
        }, this);
    }
    _dndEnded;
    constructor(params = {}) {
        super(params);
        this.#setupDNDScroll();
    }
    /**
     * This function sets up Drag-and-Drop scrolling.
     * This means that scroll up or down is happening when a Drag-and-Drop
     * operation is in progress and the user has their cursor either in the
     * upper or lower 10% of this widget respectively.
     */
    #setupDNDScroll() {
        // Pass `this.get_first_child()` to the ScrollManager, since this
        // `PrefsPage` extends an `Adw.PreferencesPage` and the first child of
        // an `Adw.PreferencesPage` is the built-in `Gtk.ScrolledWindow`.
        const scrollManager = new ScrollManager(this.get_first_child());
        /// Setup GtkDropControllerMotion event controller and make use of its
        /// events.
        let controller = new Gtk.DropControllerMotion();
        // Make sure scrolling stops, when DND operation ends.
        this._dndEnded = true;
        // Scroll, when the pointer is in the right places and a DND operation
        // is properly set up (this._dndEnded is false).
        controller.connect("motion", (_, _x, y) => {
            if ((y <= this.get_allocated_height() * 0.1) && !this._dndEnded) {
                // If the pointer is currently in the upper ten percent of this
                // widget, then scroll up.
                scrollManager.startScrollUp();
            }
            else if ((y >= this.get_allocated_height() * 0.9) && !this._dndEnded) {
                // If the pointer is currently in the lower ten percent of this
                // widget, then scroll down.
                scrollManager.startScrollDown();
            }
            else {
                // Otherwise stop scrolling.
                scrollManager.stopScrollAll();
            }
        });
        const stopScrollAllAtDNDEnd = () => {
            this._dndEnded = true;
            scrollManager.stopScrollAll();
        };
        controller.connect("leave", () => {
            stopScrollAllAtDNDEnd();
        });
        controller.connect("enter", () => {
            // Make use of `this._dndEnded` to setup stopScrollAtDNDEnd only
            // once per DND operation.
            if (this._dndEnded) {
                const drag = controller.get_drop()?.get_drag() ?? null;
                // Ensure we have a Gdk.Drag.
                // If this is not the case for whatever reason, then don't start
                // DND scrolling and just return.
                if (!(drag instanceof Gdk.Drag)) {
                    // TODO: maybe add logging
                    return;
                }
                drag.connect("drop-performed", () => {
                    stopScrollAllAtDNDEnd();
                });
                drag.connect("dnd-finished", () => {
                    stopScrollAllAtDNDEnd();
                });
                drag.connect("cancel", () => {
                    stopScrollAllAtDNDEnd();
                });
                this._dndEnded = false;
            }
        });
        this.add_controller(controller);
    }
    onRowMove(listBox, row, direction) {
        const rowPosition = row.get_index();
        if (direction === "up") { // If the direction of the move is up.
            // Handle the case, where the row is the topmost row in the list box.
            if (rowPosition === 0) {
                switch (listBox.boxOrder) {
                    // If the row is also in the topmost list box, then do
                    // nothing and return.
                    case "left-box-order":
                        log("The row is already the topmost row in the topmost box order.");
                        return;
                    // If the row is in the center list box, then move it up to
                    // the left one.
                    case "center-box-order":
                        listBox.removeRow(row);
                        this._left_box_order_list_box.insertRow(row, -1);
                        // First save the box order of the destination, then do
                        // "a save for clean up".
                        this._left_box_order_list_box.saveBoxOrderToSettings();
                        this._left_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;
                    // If the row is in the right list box, then move it up to
                    // the center one.
                    case "right-box-order":
                        listBox.removeRow(row);
                        this._center_box_order_list_box.insertRow(row, -1);
                        this._center_box_order_list_box.saveBoxOrderToSettings();
                        this._center_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;
                }
            }
            // Else just move the row up in the box.
            listBox.removeRow(row);
            listBox.insertRow(row, rowPosition - 1);
            listBox.saveBoxOrderToSettings();
            listBox.determineRowMoveActionEnable();
            return;
        }
        else { // Else the direction of the move must be down.
            // Handle the case, where the row is the bottommost row in the list box.
            const rowNextSibling = row.get_next_sibling();
            if (rowNextSibling instanceof PrefsBoxOrderListEmptyPlaceholder || rowNextSibling === null) {
                switch (listBox.boxOrder) {
                    // If the row is also in the bottommost list box, then do
                    // nothing and return.
                    case "right-box-order":
                        log("The row is already the bottommost row in the bottommost box order.");
                        return;
                    // If the row is in the center list box, then move it down
                    // to the right one.
                    case "center-box-order":
                        listBox.removeRow(row);
                        this._right_box_order_list_box.insertRow(row, 0);
                        this._right_box_order_list_box.saveBoxOrderToSettings();
                        this._right_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;
                    // If the row is in the left list box, then move it down to
                    // the center one.
                    case "left-box-order":
                        listBox.removeRow(row);
                        this._center_box_order_list_box.insertRow(row, 0);
                        this._center_box_order_list_box.saveBoxOrderToSettings();
                        this._center_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;
                }
            }
            // Else just move the row down in the box.
            listBox.removeRow(row);
            listBox.insertRow(row, rowPosition + 1);
            listBox.saveBoxOrderToSettings();
            listBox.determineRowMoveActionEnable();
            return;
        }
    }
}
