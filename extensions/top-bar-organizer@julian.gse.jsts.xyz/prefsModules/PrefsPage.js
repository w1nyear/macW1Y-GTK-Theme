"use strict";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import ScrollManager from "./ScrollManager.js";
import PrefsBoxOrderListEmptyPlaceholder from "./PrefsBoxOrderListEmptyPlaceholder.js";

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






    #setupDNDScroll() {



        const scrollManager = new ScrollManager(this.get_first_child());


        let controller = new Gtk.DropControllerMotion();

        this._dndEnded = true;


        controller.connect("motion", (_, _x, y) => {
            if ((y <= this.get_allocated_height() * 0.1) && !this._dndEnded) {


                scrollManager.startScrollUp();
            }
            else if ((y >= this.get_allocated_height() * 0.9) && !this._dndEnded) {


                scrollManager.startScrollDown();
            }
            else {

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


            if (this._dndEnded) {
                const drag = controller.get_drop()?.get_drag() ?? null;



                if (!(drag instanceof Gdk.Drag)) {

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
        if (direction === "up") {

            if (rowPosition === 0) {
                switch (listBox.boxOrder) {


                    case "left-box-order":
                        log("The row is already the topmost row in the topmost box order.");
                        return;


                    case "center-box-order":
                        listBox.removeRow(row);
                        this._left_box_order_list_box.insertRow(row, -1);


                        this._left_box_order_list_box.saveBoxOrderToSettings();
                        this._left_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;


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

            listBox.removeRow(row);
            listBox.insertRow(row, rowPosition - 1);
            listBox.saveBoxOrderToSettings();
            listBox.determineRowMoveActionEnable();
            return;
        }
        else {

            const rowNextSibling = row.get_next_sibling();
            if (rowNextSibling instanceof PrefsBoxOrderListEmptyPlaceholder || rowNextSibling === null) {
                switch (listBox.boxOrder) {


                    case "right-box-order":
                        log("The row is already the bottommost row in the bottommost box order.");
                        return;


                    case "center-box-order":
                        listBox.removeRow(row);
                        this._right_box_order_list_box.insertRow(row, 0);
                        this._right_box_order_list_box.saveBoxOrderToSettings();
                        this._right_box_order_list_box.determineRowMoveActionEnable();
                        listBox.saveBoxOrderToSettings();
                        listBox.determineRowMoveActionEnable();
                        return;


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

            listBox.removeRow(row);
            listBox.insertRow(row, rowPosition + 1);
            listBox.saveBoxOrderToSettings();
            listBox.determineRowMoveActionEnable();
            return;
        }
    }
}
