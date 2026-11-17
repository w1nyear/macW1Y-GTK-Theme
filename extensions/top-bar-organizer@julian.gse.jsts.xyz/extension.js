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


        this.#handleNewItemsAndOrderTopBar();


        this.#overwritePanelAddToPanelBox();

        this._boxOrderManager.connect("appIndicatorReady", () => {
            this.#handleNewItemsAndOrderTopBar();
        });

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

        // @ts-ignore
        if (Panel.Panel.prototype._originalAddToPanelBox) {
            Panel.Panel.prototype._addToPanelBox = Panel.Panel.prototype._originalAddToPanelBox;
            // @ts-ignore
            delete Panel.Panel.prototype._originalAddToPanelBox;
        }
        // @ts-ignore
        delete Main.panel?._originalAddToPanelBox;

        for (const handlerId of this._settingsHandlerIds) {
            this._settings.disconnect(handlerId);
        }
        this._boxOrderManager.disconnectSignals();
        // @ts-ignore
        this._settings = null;
        // @ts-ignore
        this._boxOrderManager = null;
    }







    #overwritePanelAddToPanelBox() {
        if (Panel.Panel.prototype._originalAddToPanelBox)
            return;
        const origMethod = Panel.Panel.prototype._addToPanelBox;
        Panel.Panel.prototype._originalAddToPanelBox = origMethod;
        const handleNewItemsAndOrderTopBar = () => {
            this.#handleNewItemsAndOrderTopBar();
        };

        Panel.Panel.prototype._addToPanelBox = function (role, indicator, position, box) {
            origMethod.call(this, role, indicator, position, box);
            handleNewItemsAndOrderTopBar();
        };
    }








    #orderTopBarItems(box) {


        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }

        const validBoxOrder = this._boxOrderManager.getValidBoxOrder(box);

        let panelBox = Main.panel[`_${box}Box`];


        for (let i = 0; i < validBoxOrder.length; i++) {
            const item = validBoxOrder[i];

            const associatedIndicatorContainer = Main.panel.statusArea[item.role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {

                continue;
            }

            const isVisible = associatedIndicatorContainer.visible;
            const parent = associatedIndicatorContainer.get_parent();
            if (parent !== null) {
                parent.remove_child(associatedIndicatorContainer);
            }
            if (box === "right") {












                panelBox.insert_child_at_index(associatedIndicatorContainer, -1);
            }
            else {
                panelBox.insert_child_at_index(associatedIndicatorContainer, i);
            }








            if ((!isVisible && item.hide === "default") ||
                item.hide === "hide") {
                associatedIndicatorContainer.hide();
            }
        }



    }




    #handleNewItemsAndOrderTopBar() {


        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }
        this._boxOrderManager.saveNewTopBarItems();
        this.#orderTopBarItems("left");
        this.#orderTopBarItems("center");
        this.#orderTopBarItems("right");




    }
}
