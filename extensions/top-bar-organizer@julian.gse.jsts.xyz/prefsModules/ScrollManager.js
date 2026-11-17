"use strict";
import GLib from "gi://GLib";
export default class ScrollManager {
    #gtkScrolledWindow;
    #scrollUp;
    #scrollDown;
    constructor(gtkScrolledWindow) {
        this.#gtkScrolledWindow = gtkScrolledWindow;
        this.#scrollUp = false;
        this.#scrollDown = false;
    }
    startScrollUp() {

        if (this.#scrollUp) {
            return;
        }

        this.stopScrollDown();
        this.#scrollUp = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {


            const newVAdjustementValue = Math.max(this.#gtkScrolledWindow.vadjustment.get_value() - this.#gtkScrolledWindow.vadjustment.get_step_increment(), 0);

            if (newVAdjustementValue === this.#gtkScrolledWindow.vadjustment.get_value()) {
                this.#scrollUp = false;
                return this.#scrollUp;
            }

            this.#gtkScrolledWindow.vadjustment.set_value(newVAdjustementValue);
            return this.#scrollUp;
        });
    }
    startScrollDown() {

        if (this.#scrollDown) {
            return;
        }

        this.stopScrollUp();
        this.#scrollDown = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {


            const newVAdjustementValue = Math.min(this.#gtkScrolledWindow.vadjustment.get_value() + this.#gtkScrolledWindow.vadjustment.get_step_increment(), this.#gtkScrolledWindow.vadjustment.get_upper() - this.#gtkScrolledWindow.vadjustment.get_page_size());

            if (newVAdjustementValue === this.#gtkScrolledWindow.vadjustment.get_value()) {
                this.#scrollDown = false;
                return this.#scrollDown;
            }

            this.#gtkScrolledWindow.vadjustment.set_value(newVAdjustementValue);
            return this.#scrollDown;
        });
    }
    stopScrollUp() {
        this.#scrollUp = false;
    }
    stopScrollDown() {
        this.#scrollDown = false;
    }
    stopScrollAll() {
        this.stopScrollUp();
        this.stopScrollDown();
    }
}
