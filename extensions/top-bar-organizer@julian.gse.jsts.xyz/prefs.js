"use strict";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import PrefsPage from "./prefsModules/PrefsPage.js";
export default class TopBarOrganizerPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        const provider = new Gtk.CssProvider();
        provider.load_from_path(this.metadata.dir.get_path() + "/css/prefs.css");
        const defaultGdkDisplay = Gdk.Display.get_default();
        Gtk.StyleContext.add_provider_for_display(defaultGdkDisplay, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        const prefsPage = new PrefsPage();
        prefsPage.connect("destroy", () => {
            Gtk.StyleContext.remove_provider_for_display(defaultGdkDisplay, provider);
        });
        return prefsPage;
    }
}
