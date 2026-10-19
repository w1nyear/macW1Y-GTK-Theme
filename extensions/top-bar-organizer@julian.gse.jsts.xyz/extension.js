"use strict";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Panel from "resource:///org/gnome/shell/ui/panel.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import BoxOrderManager from "./extensionModules/BoxOrderManager.js";
export default class TopBarOrganizerExtension extends Extension {
    _settings;
    _boxOrderManager;
    _settingsHandlerIds;
    enable() {
        this._settings = this.getSettings();
        this._boxOrderManager = new BoxOrderManager({}, this._settings);
        /// Stuff to do on startup(extension enable).
        // Initially handle new top bar items and order top bar boxes.
        this.#handleNewItemsAndOrderTopBar();
        // Overwrite the `Panel._addToPanelBox` method with one handling new
        // items.
        this.#overwritePanelAddToPanelBox();
        // Handle AppIndicators getting ready, to handle new AppIndicator items.
        this._boxOrderManager.connect("appIndicatorReady", () => {
            this.#handleNewItemsAndOrderTopBar();
        });
        // Handle changes of settings.
        this._settingsHandlerIds = [];
        const addSettingsChangeHandler = (settingsName) => {
            const handlerId = this._settings.connect(`changed::${settingsName}`, () => {
                this.#handleNewItemsAndOrderTopBar();
            });
            this._settingsHandlerIds.push(handlerId);
        };
        addSettingsChangeHandler("left-box-order");
        addSettingsChangeHandler("center-box-order");
        addSettingsChangeHandler("right-box-order");
        addSettingsChangeHandler("hide");
        addSettingsChangeHandler("show");
    }
    disable() {
        // Revert the overwrite of `Panel._addToPanelBox`.
        // @ts-ignore
        Panel.Panel.prototype._addToPanelBox = Panel.Panel.prototype._originalAddToPanelBox;
        // Set `Panel._originalAddToPanelBox` to `undefined`.
        // @ts-ignore
        Panel.Panel.prototype._originalAddToPanelBox = undefined;
        // Disconnect signals.
        for (const handlerId of this._settingsHandlerIds) {
            this._settings.disconnect(handlerId);
        }
        this._boxOrderManager.disconnectSignals();
        // @ts-ignore
        this._settings = null;
        // @ts-ignore
        this._boxOrderManager = null;
    }
    ////////////////////////////////////////////////////////////////////////////
    /// Methods used on extension enable.                                    ///
    ////////////////////////////////////////////////////////////////////////////
    /**
     * Overwrite `Panel._addToPanelBox` with a custom method, which simply calls
     * the original one and handles new items and orders the top bar afterwards.
     */
    #overwritePanelAddToPanelBox() {
        if (Panel.Panel.prototype._originalAddToPanelBox)
            return;
        Panel.Panel.prototype._originalAddToPanelBox = Panel.Panel.prototype._addToPanelBox;
        const handleNewItemsAndOrderTopBar = () => {
            this.#handleNewItemsAndOrderTopBar();
        };
        // Overwrite `Panel._addToPanelBox`.
        Panel.Panel.prototype._addToPanelBox = function (role, indicator, position, box) {
            if (typeof this._originalAddToPanelBox === 'function')
                this._originalAddToPanelBox(role, indicator, position, box);
            else if (typeof Panel.Panel.prototype._originalAddToPanelBox === 'function')
                Panel.Panel.prototype._originalAddToPanelBox.call(this, role, indicator, position, box);
            handleNewItemsAndOrderTopBar();
        };
    }
    ////////////////////////////////////////////////////////////////////////////
    /// Helper methods holding logic needed by other methods.                ///
    ////////////////////////////////////////////////////////////////////////////
    /**
     * This method orders the top bar items of the specified box according to
     * the configured box orders.
     * @param {Box} box - The box to order.
     */
    #orderTopBarItems(box) {
        // Only run, when the session mode is "user" or the parent session mode
        // is "user".
        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }
        // Get the valid box order.
        const validBoxOrder = this._boxOrderManager.getValidBoxOrder(box);
        // Get the relevant box of `Main.panel`.
        let panelBox = Main.panel[`_${box}Box`];
        /// Go through the items of the validBoxOrder and order the GNOME Shell
        /// top bar box accordingly.
        for (let i = 0; i < validBoxOrder.length; i++) {
            const item = validBoxOrder[i];
            // Get the indicator container associated with the current role.
            const associatedIndicatorContainer = Main.panel.statusArea[item.role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {
                // TODO: maybe add logging
                continue;
            }
            // Save whether or not the indicator container is visible.
            const isVisible = associatedIndicatorContainer.visible;
            const parent = associatedIndicatorContainer.get_parent();
            if (parent !== null) {
                parent.remove_child(associatedIndicatorContainer);
            }
            if (box === "right") {
                // If the target panel box is the right panel box, insert the
                // indicator container at index `-1`, which just adds it to the
                // end (correct order is ensured, since `validBoxOrder` is
                // sorted correctly and we're looping over it in order).
                // This way unaccounted-for indicator containers will be at the
                // left, which is preferred, since the box is logically
                // right-to-left.
                // The same applies for indicator containers, which are just
                // temporarily unaccounted for (like for indicator containers of
                // not yet ready app indicators), since them being at the right
                // for a probably temporary stay causes all the indicator
                // containers to shift.
                panelBox.insert_child_at_index(associatedIndicatorContainer, -1);
            }
            else {
                panelBox.insert_child_at_index(associatedIndicatorContainer, i);
            }
            // Hide the indicator container...
            // - ...if it wasn't visible before and the hide property of the
            //   item is "default".
            // - if the hide property of the item is "hide".
            // In all other cases have the item show.
            // An e.g. screen recording indicator still wouldn't show tho, since
            // this here acts on the indicator container, but a screen recording
            // indicator is hidden on the indicator level.
            if ((!isVisible && item.hide === "default") ||
                item.hide === "hide") {
                associatedIndicatorContainer.hide();
            }
        }
        // To handle the case, where the box order got set to a permutation
        // of an outdated box order, it would be wise, if the caller updated the
        // box order now to include the items present in the top bar.
    }
    /**
     * This method handles all new items currently present in the top bar and
     * orders the items of all top bar boxes.
     */
    #handleNewItemsAndOrderTopBar() {
        // Only run, when the session mode is "user" or the parent session mode
        // is "user".
        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }
        this._boxOrderManager.saveNewTopBarItems();
        this.#orderTopBarItems("left");
        this.#orderTopBarItems("center");
        this.#orderTopBarItems("right");
        // In `this.#orderTopBarItems` it says to update the box orders to
        // include potentially new items, since the ordering might have been
        // based on an outdated box order. However, since we already handle new
        // top bar items at the beginning of this method, this isn't a concern.
    }
}
