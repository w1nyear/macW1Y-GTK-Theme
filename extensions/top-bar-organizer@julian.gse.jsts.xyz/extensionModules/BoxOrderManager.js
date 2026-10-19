"use strict";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
/**
 * This class provides an interfaces to the box orders stored in settings.
 * It takes care of handling AppIndicator and Task Up UltraLite items and
 * resolving from the internal item settings identifiers to roles.
 * In the end this results in convenient functions, which are directly useful in
 * other extension code.
 */
export default class BoxOrderManager extends GObject.Object {
    static {
        GObject.registerClass({
            Signals: {
                "appIndicatorReady": {},
            },
        }, this);
    }
    // Can't have type guarantees here, since this is working with types from
    // the KStatusNotifier/AppIndicator extension.
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
    /**
     * Gets a box order for the given top bar box from settings.
     * @param {Box} box - The top bar box for which to get the box order.
     * @returns {string[]} - The box order consisting of an array of item
     * settings identifiers.
     */
    #getBoxOrder(box) {
        return this.#settings.get_strv(`${box}-box-order`);
    }
    /**
     * Save the given box order to settings, making sure to only save a changed
     * box order, to avoid loops when listening on settings changes.
     * @param {Box} box - The top bar box for which to save the box order.
     * @param {string[]} boxOrder - The box order to save. Must be an array of
     * item settings identifiers.
     */
    #saveBoxOrder(box, boxOrder) {
        const currentBoxOrder = this.#getBoxOrder(box);
        // Only save the given box order to settings, if it is different, to
        // avoid loops when listening on settings changes.
        if (JSON.stringify(boxOrder) !== JSON.stringify(currentBoxOrder)) {
            this.#settings.set_strv(`${box}-box-order`, boxOrder);
        }
    }
    /**
     * Handles an AppIndicator/KStatusNotifierItem item by deriving a settings
     * identifier and then associating the role of the given item to the items
     * settings identifier.
     * It then returns the derived settings identifier.
     * In the case, where the settings identifier can't be derived, because the
     * application can't be determined, this method throws an error. However it
     * then also makes sure that once the app indicators "ready" signal emits,
     * this classes "appIndicatorReady" signal emits as well, such that it and
     * other methods can be called again to properly handle the item.
     * @param {St.Bin} indicatorContainer - The container of the indicator of the
     * AppIndicator/KStatusNotifierItem item.
     * @param {string} role - The role of the AppIndicator/KStatusNotifierItem
     * item.
     * @returns {string} The derived items settings identifier.
     */
    #handleAppIndicatorItem(indicatorContainer, role) {
        // Since this is working with types from the
        // AppIndicator/KStatusNotifierItem extension, we loose a bunch of type
        // safety here.
        // https://github.com/ubuntu/gnome-shell-extension-appindicator
        const appIndicator = indicatorContainer.get_child()._indicator;
        let application = appIndicator.id;
        if (!application && this.#appIndicatorReadyHandlerIdMap) {
            const handlerId = appIndicator.connect("ready", () => {
                this.emit("appIndicatorReady");
                appIndicator.disconnect(handlerId);
                this.#appIndicatorReadyHandlerIdMap.delete(handlerId);
            });
            this.#appIndicatorReadyHandlerIdMap.set(handlerId, appIndicator);
            throw new Error("Application can't be determined.");
        }
        // Since the Dropbox client appends its PID to the id, drop the PID and
        // the hyphen before it.
        if (application.startsWith("dropbox-client-")) {
            application = "dropbox-client";
        }
        // Derive the items settings identifier from the application name.
        const itemSettingsId = `appindicator-kstatusnotifieritem-${application}`;
        // Associate the role with the items settings identifier.
        let roles = this.#appIndicatorItemSettingsIdToRolesMap.get(itemSettingsId);
        if (roles) {
            // If the settings identifier already has an array of associated
            // roles, just add the role to it, if needed.
            if (!roles.includes(role)) {
                roles.push(role);
            }
        }
        else {
            // Otherwise create a new array.
            this.#appIndicatorItemSettingsIdToRolesMap.set(itemSettingsId, [role]);
        }
        // Return the item settings identifier.
        return itemSettingsId;
    }
    /**
     * Handles a Task Up UltraLite item by storing its role and returning the
     * Task Up UltraLite settings identifier.
     * This is needed since the Task Up UltraLite extension creates a bunch of
     * top bar items as part of its functionality, so we want to group them
     * under one identifier in the settings.
     * https://extensions.gnome.org/extension/7700/task-up-ultralite/
     * @param {string} role - The role of the Task Up UltraLite item.
     * @returns {string} The settings identifier to use.
     */
    #handleTaskUpUltraLiteItem(role) {
        const roles = this.#taskUpUltraLiteItemRoles;
        if (!roles.includes(role)) {
            roles.push(role);
        }
        return "item-role-group-task-up-ultralite";
    }
    /**
     * Gets a resolved box order for the given top bar box, where all
     * AppIndicator and Task Up UltraLite items got resolved using their roles,
     * meaning they might be present multiple times or not at all depending on
     * the roles stored.
     * The items of the box order also have additional information stored.
     * @param {Box} box - The top bar box for which to get the resolved box order.
     * @returns {ResolvedBoxOrderItem[]} - The resolved box order.
     */
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
            // Set the hide state of the item.
            if (itemsToHide.includes(resolvedBoxOrderItem.settingsId)) {
                resolvedBoxOrderItem.hide = "hide";
            }
            else if (itemsToShow.includes(resolvedBoxOrderItem.settingsId)) {
                resolvedBoxOrderItem.hide = "show";
            }
            else {
                resolvedBoxOrderItem.hide = "default";
            }
            // If the items settings identifier doesn't indicate that the item
            // is an AppIndicator/KStatusNotifierItem item or the Task Up
            // UltraLite item role group, then its identifier is the role and it
            // can just be added to the resolved box order.
            if (!itemSettingsId.startsWith("appindicator-kstatusnotifieritem-") &&
                itemSettingsId !== "item-role-group-task-up-ultralite") {
                resolvedBoxOrderItem.role = resolvedBoxOrderItem.settingsId;
                resolvedBoxOrder.push(resolvedBoxOrderItem);
                continue;
            }
            // If the items settings identifier indicates otherwise, then handle
            // the item specially.
            // Get the roles associated with the items settings id.
            let roles = [];
            if (itemSettingsId.startsWith("appindicator-kstatusnotifieritem-")) {
                roles = this.#appIndicatorItemSettingsIdToRolesMap.get(resolvedBoxOrderItem.settingsId) ?? [];
            }
            else if (itemSettingsId === "item-role-group-task-up-ultralite") {
                roles = this.#taskUpUltraLiteItemRoles;
            }
            // Create a new resolved box order item for each role and add it to
            // the resolved box order.
            for (const role of roles) {
                const newResolvedBoxOrderItem = JSON.parse(JSON.stringify(resolvedBoxOrderItem));
                newResolvedBoxOrderItem.role = role;
                resolvedBoxOrder.push(newResolvedBoxOrderItem);
            }
        }
        return resolvedBoxOrder;
    }
    /**
     * Disconnects all signals (and disables future signal connection).
     * This is typically used before nulling an instance of this class to make
     * sure all signals are disconnected.
     */
    disconnectSignals() {
        for (const [handlerId, appIndicator] of this.#appIndicatorReadyHandlerIdMap) {
            if (handlerId && appIndicator?.signalHandlerIsConnected(handlerId)) {
                appIndicator.disconnect(handlerId);
            }
        }
        // @ts-ignore
        this.#appIndicatorReadyHandlerIdMap = null;
    }
    /**
     * Gets a valid box order for the given top bar box, where all AppIndicator
     * and Task Up UltraLite items got resolved and where only items are
     * included, which are in some GNOME Shell top bar box.
     * The items of the box order also have additional information stored.
     * @param {Box} box - The top bar box to return the valid box order for.
     * @returns {ResolvedBoxOrderItem[]} - The valid box order.
     */
    getValidBoxOrder(box) {
        // Get a resolved box order.
        let resolvedBoxOrder = this.#getResolvedBoxOrder(box);
        // Get the indicator containers (of the items) currently present in the
        // GNOME Shell top bar.
        // They should be St.Bins (see link), so ensure that using a filter.
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/48.2/js/ui/panelMenu.js?ref_type=tags#L21
        const indicatorContainers = new Set([
            Main.panel._leftBox.get_children(),
            Main.panel._centerBox.get_children(),
            Main.panel._rightBox.get_children(),
        ].flat().filter(ic => ic instanceof St.Bin));
        // Go through the resolved box order and only add items to the valid box
        // order, where their indicator is currently present in the GNOME Shell
        // top bar.
        let validBoxOrder = [];
        for (const item of resolvedBoxOrder) {
            const associatedIndicatorContainer = Main.panel.statusArea[item.role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {
                // TODO: maybe add logging
                continue;
            }
            if (indicatorContainers.has(associatedIndicatorContainer)) {
                validBoxOrder.push(item);
            }
        }
        return validBoxOrder;
    }
    /**
     * This method saves all new items currently present in the GNOME Shell top
     * bar to the settings.
     */
    saveNewTopBarItems() {
        // Only run, when the session mode is "user" or the parent session mode
        // is "user".
        if (Main.sessionMode.currentMode !== "user" && Main.sessionMode.parentMode !== "user") {
            return;
        }
        // Get the box orders.
        const boxOrders = {
            left: this.#getBoxOrder("left"),
            center: this.#getBoxOrder("center"),
            right: this.#getBoxOrder("right"),
        };
        // Get roles (of items) currently present in the GNOME Shell top bar and
        // index them using their associated indicator container.
        let indicatorContainerRoleMap = new Map();
        for (const role in Main.panel.statusArea) {
            const associatedIndicatorContainer = Main.panel.statusArea[role]?.container;
            if (!(associatedIndicatorContainer instanceof St.Bin)) {
                // TODO: maybe add logging
                continue;
            }
            indicatorContainerRoleMap.set(associatedIndicatorContainer, role);
        }
        // Get the indicator containers (of the items) currently present in the
        // GNOME Shell top bar boxes.
        // They should be St.Bins (see link), so ensure that using a filter.
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/48.2/js/ui/panelMenu.js?ref_type=tags#L21
        const boxIndicatorContainers = {
            left: Main.panel._leftBox.get_children().filter(ic => ic instanceof St.Bin),
            center: Main.panel._centerBox.get_children().filter(ic => ic instanceof St.Bin),
            // Reverse this array, since the items in the left and center box
            // are logically LTR, while the items in the right box are RTL.
            right: Main.panel._rightBox.get_children().filter(ic => ic instanceof St.Bin).reverse(),
        };
        // This function goes through the indicator containers of the given box
        // and adds new item settings identifiers to the given box order.
        const addNewItemSettingsIdsToBoxOrder = (indicatorContainers, boxOrder, box) => {
            for (const indicatorContainer of indicatorContainers) {
                // First get the role associated with the current indicator
                // container.
                let role = indicatorContainerRoleMap.get(indicatorContainer);
                if (!role) {
                    continue;
                }
                // Then get a settings identifier for the item.
                let itemSettingsId;
                if (role.startsWith("appindicator-")) {
                    // If the role indicates that the item is an
                    // AppIndicator/KStatusNotifierItem item, then handle it
                    // differently.
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
                    // If the role indicates that the item is a Task Up
                    // UltraLite item, then handle it differently.
                    itemSettingsId = this.#handleTaskUpUltraLiteItem(role);
                }
                else { // Otherwise just use the role as the settings identifier.
                    itemSettingsId = role;
                }
                // Add the items settings identifier to the box order, if it
                // isn't in in one already.
                if (!boxOrders.left.includes(itemSettingsId)
                    && !boxOrders.center.includes(itemSettingsId)
                    && !boxOrders.right.includes(itemSettingsId)) {
                    if (box === "right") {
                        // Add the items to the beginning for this array, since
                        // its RTL.
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
