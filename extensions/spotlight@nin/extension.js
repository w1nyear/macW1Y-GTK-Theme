// Spotlight: a compact launcher for GNOME Shell
// SPDX-License-Identifier: GPL-3.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SpotlightPopup} from './lib/popup/widget/spotlightPopup.js';
import {KeybindingManager} from './lib/core/keybinding.js';

// Entry point. Keeping enable and disable adjacent makes the cleanup symmetry obvious at a glance.
export default class SpotlightExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._popup = new SpotlightPopup(this._settings);
        // Steal the overview search widgets permanently. The overview search stays gone
        // for as long as Spotlight is loaded, which is the whole point of the extension.
        this._popup.stealOverviewSearch();
        this._keybindingManager = new KeybindingManager();
        this._keybindingManager.enable();
        const shortcuts = this._settings.get_strv('toggle-shortcut');
        const accelerator = shortcuts.length > 0 ? shortcuts[0] : '<Control>space';
        if (shortcuts.length === 0)
            this._settings.set_strv('toggle-shortcut', [accelerator]);
        this._grabShortcut(accelerator);
        this._settings.connectObject('changed::toggle-shortcut', () => {
            this._keybindingManager.unlisten();
            const arr = this._settings.get_strv('toggle-shortcut');
            if (arr.length > 0)
                this._grabShortcut(arr[0]);
        }, this);
        this._publishGlobals();
    }

    // Publishes the globalThis entry points the rest of the macOS theming
    // ecosystem (kiwi centerManager, blur-my-shell, dash-to-dock, gestures,
    // eval-helper, appmenu) uses to open/close Spotlight and the Applications
    // Center. The Applications Center (Launchpad) now lives INSIDE Spotlight
    // as its apps view, so both entry points resolve to the same popup.
    _publishGlobals() {
        const popup = this._popup;
        globalThis._macSpotlightNinInstance = popup;
        // kiwi's centerManager closes Spotlight through this instance.
        globalThis._macSpotlightGlobalInstance = popup;
        globalThis._macSpotlightClose = () => popup?.close();
        globalThis.toggleMacSpotlight = () => popup?.toggle();
        globalThis._macSpotlightToggle = () => popup?.toggle();
        globalThis.closeMacSpotlight = () => popup?.close();
        // The Applications Center (Launchpad) now lives INSIDE Spotlight as
        // its apps view, so both entry points resolve to the same popup.
        globalThis._macApplicationsGlobalInstance = popup;
        globalThis._macApplicationsClose = () => popup?.close();
        globalThis.toggleMacApplications = () => popup?.openApps();
        globalThis.toggleApplicationsMenu = () => popup?.openApps();
        globalThis.closeMacApplications = () => popup?.close();
    }

    _clearGlobals() {
        if (globalThis._macSpotlightNinInstance === this._popup)
            globalThis._macSpotlightNinInstance = null;
        if (globalThis._macSpotlightGlobalInstance === this._popup)
            globalThis._macSpotlightGlobalInstance = null;
        if (globalThis._macApplicationsGlobalInstance === this._popup)
            globalThis._macApplicationsGlobalInstance = null;
        globalThis.toggleMacSpotlight = null;
        globalThis._macSpotlightToggle = null;
        globalThis.closeMacSpotlight = null;
        globalThis._macSpotlightClose = null;
        globalThis.toggleMacApplications = null;
        globalThis.toggleApplicationsMenu = null;
        globalThis.closeMacApplications = null;
        globalThis._macApplicationsClose = null;
    }
    _grabShortcut(accelerator) {
        this._keybindingManager.listenFor(accelerator, () => {
            if (this._popup.visible)
                this._popup.close();
            else
                this._popup.open();
        });
    }
    disable() {
        // Defensive and idempotent: GNOME Shell can call disable() after a
        // partial enable or more than once across reloads. Every step is
        // guarded so a null field never throws and leaves a stale ERROR state.
        try { this._settings?.disconnectObject(this); } catch (_) {}
        try { this._keybindingManager?.disable(); } catch (_) {}
        this._keybindingManager = null;
        // Return the stolen widgets to the overview before destroying things so nothing leaks.
        try { this._popup?.returnOverviewSearch(); } catch (_) {}
        this._clearGlobals();
        try { this._popup?.destroy(); } catch (_) {}
        this._popup = null;
        this._settings = null;
    }
}
