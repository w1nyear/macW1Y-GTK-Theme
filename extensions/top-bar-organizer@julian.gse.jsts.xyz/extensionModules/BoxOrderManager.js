"use strict";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";







export default class BoxOrderManager extends GObject.Object {
    static {
        GObject.registerClass({
            Signals: {
                "appIndicatorReady": {},
            },
        }, this);
    }


    #appIndicatorReadyHandlerIdMap;
    #appIndicatorItemSettingsIdToRolesMap;
    #taskUpUltraLiteItemRoles;
    #settings;
    constructor(params = {}, settings) {
        // @ts-ignore Params should be passed, see: https://gjs.guide/guides/gobject/subclassing.html#subclassing-gobject
        super(params);
        this.#appIndicatorReadyHandlerIdMap = new Map();
        this.#appIndicatorItemSettingsIdToRolesMap = new Map();
        this.#taskUpUltraLiteItemRoles = [];
        this.#settings = settings;
    }






    #getBoxOrder(box) {
        return this.#settings.get_strv(`${box}-box-order`);
    }







    #saveBoxOrder(box, boxOrder) {
        const currentBoxOrder = this.#getBoxOrder(box);


        if (JSON.stringify(boxOrder) !== JSON.stringify(currentBoxOrder)) {
            this.#settings.set_strv(`${box}-box-order`, boxOrder);
        }
    }
















    #handleAppIndicatorItem(indicatorContainer, role) {




        const appIndicator = indicatorContainer.get_child?.()?._indicator;
        let application = appIndicator?.id;
        if (!application && this.#appIndicatorReadyHandlerIdMap) {
            if (appIndicator) {
                const handlerId = appIndicator.connect("ready", () => {
                    this.emit("appIndicatorReady");
                    appIndicator.disconnect(handlerId);
                    this.#appIndicatorReadyHandlerIdMap.delete(handlerId);
                });
                this.#appIndicatorReadyHandlerIdMap.set(handlerId, appIndicator);
            }
            throw new Error("Application can't be determined.");
        }


        if (application.startsWith("dropbox-client-")) {
            application = "dropbox-client";
        }

        const itemSettingsId = `appindicator-kstatusnotifieritem-${application}`;

        let roles = this.#appIndicatorItemSettingsIdToRolesMap.get(itemSettingsId);
        if (roles) {


            if (!roles.includes(role)) {
                roles.push(role);
            }
        }
        else {

            this.#appIndicatorItemSettingsIdToRolesMap.set(itemSettingsId, [role]);
        }

        return itemSettingsId;
    }










    #handleTaskUpUltraLiteItem(role) {
        const roles = this.#taskUpUltraLiteItemRoles;
        if (!roles.includes(role)) {
            roles.push(role);
        }
        return "item-role-group-task-up-ultralite";
    }









    #getResolvedBoxOrder(box) {
        let boxOrder = this.#getBoxOrder(box);
        const itemsToHide = this.#settings.get_strv("hide");
        const itemsToShow = this.#settings.get_strv("show");
        let resolvedBoxOrder = [];
        for (const itemSettingsId of boxOrder) {
            const resolvedBoxOrderItem = {
                settingsId: itemSettingsId,
                role: "",
                hide: "",
            };

            if (itemsToHide.includes(resolvedBoxOrderItem.settingsId)) {
                resolvedBoxOrderItem.hide = "hide";
            }
            else if (itemsToShow.includes(resolvedBoxOrderItem.settingsId)) {
                resolvedBoxOrderItem.hide = "show";
            }
            else {
                resolvedBoxOrderItem.hide = "default";
            }




            if (!itemSettingsId.startsWith("appindicator-kstatusnotifieritem-") &&
                itemSettingsId !== "item-role-group-task-up-ultralite") {
                resolvedBoxOrderItem.role = resolvedBoxOrderItem.settingsId;
                resolvedBoxOrder.push(resolvedBoxOrderItem);
                continue;
            }



            let roles = [];
            if (itemSettingsId.startsWith("appindicator-kstatusnotifieritem-")) {
                roles = this.#appIndicatorItemSettingsIdToRolesMap.get(resolvedBoxOrderItem.settingsId) ?? [];
            }
            else if (itemSettingsId === "item-role-group-task-up-ultralite") {
                roles = this.#taskUpUltraLiteItemRoles;
            }


            for (const role of roles) {
                const newResolvedBoxOrderItem = JSON.parse(JSON.stringify(resolvedBoxOrderItem));
                newResolvedBoxOrderItem.role = role;
                resolvedBoxOrder.push(newResolvedBoxOrderItem);
            }
        }
        return resolvedBoxOrder;
    }





    disconnectSignals() {
        for (const [handlerId, appIndicator] of this.#appIndicatorReadyHandlerIdMap) {
            if (handlerId && appIndicator?.signalHandlerIsConnected(handlerId)) {
                appIndicator.disconnect(handlerId);
            }
        }
        // @ts-ignore
        this.#appIndicatorReadyHandlerIdMap = null;
    }








    getValidBoxOrder(box) {

        let resolvedBoxOrder = this.#getResolvedBoxOrder(box);




        const indicatorContainers = new Set([
            Main.panel._leftBox.get_children(),
            Main.panel._centerBox.get_children(),
            Main.panel._rightBox.get_children(),
        ].flat().filter(ic => ic instanceof St.Bin));



        let validBoxOrder = [];
        for (const item of resolvedBoxOrder) {
            const associatedIndicatorContainer = Main.panel.statusArea[item.role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {

                continue;
            }
            if (indicatorContainers.has(associatedIndicatorContainer)) {
                validBoxOrder.push(item);
            }
        }
        return validBoxOrder;
    }




    saveNewTopBarItems() {


        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }

        const boxOrders = {
            left: this.#getBoxOrder("left"),
            center: this.#getBoxOrder("center"),
            right: this.#getBoxOrder("right"),
        };


        let indicatorContainerRoleMap = new Map();
        for (const role in Main.panel.statusArea) {
            const associatedIndicatorContainer = Main.panel.statusArea[role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {

                continue;
            }
            indicatorContainerRoleMap.set(associatedIndicatorContainer, role);
        }




        const boxIndicatorContainers = {
            left: Main.panel._leftBox.get_children().filter(ic => ic instanceof St.Bin),
            center: Main.panel._centerBox.get_children().filter(ic => ic instanceof St.Bin),


            right: Main.panel._rightBox.get_children().filter(ic => ic instanceof St.Bin).reverse(),
        };


        const addNewItemSettingsIdsToBoxOrder = (indicatorContainers, boxOrder, box) => {
            for (const indicatorContainer of indicatorContainers) {


                let role = indicatorContainerRoleMap.get(indicatorContainer);
                if (!role) {
                    continue;
                }

                let itemSettingsId;
                if (role.startsWith("appindicator-")) {



                    try {
                        itemSettingsId = this.#handleAppIndicatorItem(indicatorContainer, role);
                    }
                    catch (e) {
                        if (!(e instanceof Error)) {
                            throw (e);
                        }
                        if (e.message !== "Application can't be determined.") {
                            throw (e);
                        }
                        continue;
                    }
                }
                else if (role.startsWith("task-button-")) {


                    itemSettingsId = this.#handleTaskUpUltraLiteItem(role);
                }
                else {
                    itemSettingsId = role;
                }


                if (!boxOrders.left.includes(itemSettingsId)
                    && !boxOrders.center.includes(itemSettingsId)
                    && !boxOrders.right.includes(itemSettingsId)) {
                    if (box === "right") {


                        boxOrder.unshift(itemSettingsId);
                    }
                    else {
                        boxOrder.push(itemSettingsId);
                    }
                }
            }
        };
        addNewItemSettingsIdsToBoxOrder(boxIndicatorContainers.left, boxOrders.left, "left");
        addNewItemSettingsIdsToBoxOrder(boxIndicatorContainers.center, boxOrders.center, "center");
        addNewItemSettingsIdsToBoxOrder(boxIndicatorContainers.right, boxOrders.right, "right");
        this.#saveBoxOrder("left", boxOrders.left);
        this.#saveBoxOrder("center", boxOrders.center);
        this.#saveBoxOrder("right", boxOrders.right);
    }
}
