"use strict";
import GObject from "gi://GObject";
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
export default class PrefsBoxOrderItemOptionsDialog extends Adw.Dialog {
    static {
        GObject.registerClass({
            GTypeName: "PrefsBoxOrderItemOptionsDialog",
            Template: GLib.uri_resolve_relative(import.meta.url, "../ui/prefs-box-order-item-options-dialog.ui", GLib.UriFlags.NONE),
            InternalChildren: [
                "visibility-row",
            ],
        }, this);
    }
    #settings;
    item;
    constructor(params = {}, item) {
        super(params);
        // Associate `this` with an item.
        this.item = item;
        // Load the settings.
        this.#settings = ExtensionPreferences.lookupByURL(import.meta.url).getSettings();
        // Set the selected visibility row choice to the settings value.
        const itemsToHide = new Set(this.#settings.get_strv("hide"));
        const itemsToShow = new Set(this.#settings.get_strv("show"));
        if (itemsToHide.has(this.item)) {
            this._visibility_row.set_selected(1);
        }
        else if (itemsToShow.has(this.item)) {
            this._visibility_row.set_selected(2);
        }
        else {
            this._visibility_row.set_selected(0);
        }
    }
    onVisibilityRowSelectionChanged() {
        const visibility = this._visibility_row.get_selected_item().get_string();
        const itemsToHide = new Set(this.#settings.get_strv("hide"));
        const itemsToShow = new Set(this.#settings.get_strv("show"));
        switch (visibility) {
            case "Forcefully Hide":
                itemsToHide.add(this.item);
                itemsToShow.delete(this.item);
                break;
            case "Forcefully Show":
                itemsToHide.delete(this.item);
                itemsToShow.add(this.item);
                break;
            case "Default":
                itemsToHide.delete(this.item);
                itemsToShow.delete(this.item);
                break;
        }
        this.#settings.set_strv("hide", Array.from(itemsToHide));
        this.#settings.set_strv("show", Array.from(itemsToShow));
    }
}
