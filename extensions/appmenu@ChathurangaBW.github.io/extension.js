import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { MenuManager } from './menuManager.js';
import { UserSwitcherController } from './userSwitcher.js';
import { setLoggerSettings, debug } from './logger.js';
import { disposeViewActions } from './actions/viewActions.js';
import { WorkspaceIndicatorController } from './workspaceIndicator.js';
import { toggleSearchDialog, destroySearchDialog } from './searchDialog.js';
import { toggleApplicationsDialog, destroyApplicationsDialog } from './applications_menu_v5b.js';
import { toggleClipboardDialog, destroyClipboardDialog } from './clipboardDialog.js';
import { initI18n } from './i18n.js';

const FOCUS_DEBOUNCE_MS = 50;

export default class AppMenuExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._menuManager = null;
        this._settings = null;
        this._focusTimeoutId = 0;
        this._focusedWindow = null;
        this._hasMenuFocusState = false;
        this._userSwitcherController = null;
        this._workspaceIndicatorController = null;
        this._searchShortcutInstalled = false;
        this._clipboardShortcutInstalled = false;
        this._overviewHidden = false;
        this._overviewWasVisible = false;
    }

    async enable() {
        globalThis._macAppMenuExtension = this;
        this._settings = this.getSettings('org.gnome.shell.extensions.appmenu');
        initI18n(this);
        setLoggerSettings(this._settings);
        debug('Enabling extension.');

        this._focusedWindow = null;
        this._hasMenuFocusState = false;

        const uuid = this.metadata.uuid || 'appmenu@ChathurangaBW.github.io';
        this._removeStalePanelButtons(uuid);
        try {
            const baseUri = this.dir.get_uri();
            const mmMod = await import(`${baseUri}/menuManager.js`);
            this._menuManager = new mmMod.MenuManager(uuid, this._settings);
        } catch (e) {
            console.error(`[AppMenu] dynamic import menuManager error: ${e}`);
            this._menuManager = new MenuManager(uuid, this._settings);
        }

        const initialWindow = global.display.get_focus_window();
        this._updateMenu(initialWindow);

        global.display.connectObject(
            'notify::focus-window', () => {
                this._scheduleMenuUpdate();
            },
            this
        );

        this._syncOverviewButton();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'hide-overview-button') {
                this._syncOverviewButton();
            }
        });

        this._userSwitcherController = new UserSwitcherController(this, this._settings);
        try {
            const wsModule = await import(`./workspaceIndicator.js`);
            this._workspaceIndicatorController = new wsModule.WorkspaceIndicatorController(this._settings);
        } catch (_) {
            this._workspaceIndicatorController = new WorkspaceIndicatorController(this._settings);
        }
        this._addSearchKeybinding();
        this._addClipboardKeybinding();
        const baseUri = this.dir.get_uri();
        try {
            const m = await import(`${baseUri}/searchDialog.js?v=${Date.now()}`);
            globalThis._macSpotlightToggle = (mode = 'search') => m.toggleSearchDialog(typeof mode === 'string' ? mode : 'search');
            globalThis.toggleMacSpotlight = (mode = 'search') => m.toggleSearchDialog(typeof mode === 'string' ? mode : 'search');
            globalThis.toggleMacApplications = () => m.toggleSearchDialog('apps');
            globalThis.toggleApplicationsMenu = () => m.toggleSearchDialog('apps');
            globalThis.toggleMacClipboard = () => m.toggleSearchDialog('clipboard');
            try {
                m.ensureSearchDialog?.();
                m.prewarmSpotlight?.();
            } catch (_) {}
        } catch (_) {
            globalThis._macSpotlightToggle = (mode = 'search') => toggleSearchDialog(typeof mode === 'string' ? mode : 'search');
            globalThis.toggleMacSpotlight = (mode = 'search') => toggleSearchDialog(typeof mode === 'string' ? mode : 'search');
            globalThis.toggleMacApplications = () => toggleSearchDialog('apps');
            globalThis.toggleApplicationsMenu = () => toggleSearchDialog('apps');
            globalThis.toggleMacClipboard = () => toggleSearchDialog('clipboard');
            try { toggleSearchDialog('search'); } catch (_) {}
        }

        if (Main.overview) {
            Main.overview.connectObject('showing', () => {
                try { globalThis._macApplicationsGlobalInstance?.close?.(true); } catch (_) {}
                try { globalThis.closeMacSpotlight?.(true); } catch (_) {}
                try { globalThis._macClipboardGlobalInstance?.close?.(true); } catch (_) {}
            }, this);
        }

        if (Main.sessionMode) {
            Main.sessionMode.connectObject('updated', () => {
                this._syncSessionMode();
                this._syncSpotlightKeybinding();
            }, this);
            this._syncSessionMode();
        }
    }

    _syncSessionMode() {
        const isLocked = Boolean(
            Main.sessionMode?.isLocked ||
            Main.sessionMode?.currentMode === 'unlock-dialog' ||
            Main.sessionMode?.currentMode === 'gdm'
        );
        const statusArea = Main.panel?.statusArea;
        if (!statusArea) return;
        for (const name of Object.keys(statusArea)) {
            if (name.startsWith(`${this.uuid}-`)) {
                const indicator = statusArea[name];
                if (indicator?.container) {
                    indicator.container.visible = !isLocked;
                }
            }
        }
    }

    _removeStalePanelButtons(uuid) {
        const statusArea = Main.panel?.statusArea;
        if (!statusArea) return;

        for (const name of Object.keys(statusArea)) {
            if (!name.startsWith(`${uuid}-`))
                continue;

            try {
                statusArea[name]?.destroy();
            } catch (e) {
                debug(`Could not remove stale panel button ${name}: ${e}`);
            }
            delete statusArea[name];
        }
    }

    _syncOverviewButton() {
        let activities = Main.panel.statusArea['activities'];
        if (!activities) return;
        let shouldHide = this._settings.get_boolean('hide-overview-button');
        if (shouldHide && !this._overviewHidden) {
            this._overviewWasVisible = activities.visible;
            activities.hide();
            this._overviewHidden = true;
        } else if (!shouldHide && this._overviewHidden) {
            if (this._overviewWasVisible)
                activities.show();
            this._overviewHidden = false;
            this._overviewWasVisible = false;
        }
    }

    _addSearchKeybinding() {
        if (!this._settings)
            return;
        if (this._searchShortcutInstalled && Main.wm._allowedKeybindings?.['search-shortcut'])
            return;
        if (this._searchShortcutInstalled) {
            try { Main.wm.removeKeybinding('search-shortcut'); } catch (_) {}
            this._searchShortcutInstalled = false;
        }

        Main.wm.addKeybinding(
            'search-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                if (typeof globalThis.isMacSpotlightBlocked === 'function' && globalThis.isMacSpotlightBlocked()) {
                    return;
                }
                if (globalThis._macSpotlightToggle)
                    globalThis._macSpotlightToggle();
                else
                    toggleSearchDialog();
            }
        );
        this._searchShortcutInstalled = true;
    }

    _removeSearchKeybinding() {
        if (!this._searchShortcutInstalled && !Main.wm._allowedKeybindings?.['search-shortcut'])
            return;

        try { Main.wm.removeKeybinding('search-shortcut'); } catch (_) {}
        this._searchShortcutInstalled = false;
    }

    _addClipboardKeybinding() {
        if (!this._settings)
            return;
        if (this._clipboardShortcutInstalled && Main.wm._allowedKeybindings?.['clipboard-shortcut'])
            return;
        if (this._clipboardShortcutInstalled) {
            try { Main.wm.removeKeybinding('clipboard-shortcut'); } catch (_) {}
            this._clipboardShortcutInstalled = false;
        }

        Main.wm.addKeybinding(
            'clipboard-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                if (typeof globalThis.isMacSpotlightBlocked === 'function' && globalThis.isMacSpotlightBlocked()) {
                    return;
                }
                if (globalThis.toggleMacClipboard)
                    globalThis.toggleMacClipboard();
                else
                    toggleSearchDialog('clipboard');
            }
        );
        this._clipboardShortcutInstalled = true;
    }

    _removeClipboardKeybinding() {
        if (!this._clipboardShortcutInstalled && !Main.wm._allowedKeybindings?.['clipboard-shortcut'])
            return;

        try { Main.wm.removeKeybinding('clipboard-shortcut'); } catch (_) {}
        this._clipboardShortcutInstalled = false;
    }

    _syncSpotlightKeybinding() {
        // Keep keybindings registered while enabled so GNOME never gets stuck with ActionMode.NONE (0);
        // blocking is enforced dynamically inside the keybinding callback itself.
        if (!this._searchShortcutInstalled || !Main.wm._allowedKeybindings?.['search-shortcut']) {
            this._addSearchKeybinding();
        }
        if (!this._clipboardShortcutInstalled || !Main.wm._allowedKeybindings?.['clipboard-shortcut']) {
            this._addClipboardKeybinding();
        }
        const blocked = (typeof globalThis.isMacSpotlightBlocked === 'function')
            ? globalThis.isMacSpotlightBlocked()
            : false;
        if (blocked) {
            try {
                if (globalThis._macSpotlightGlobalInstance?._isOpen) {
                    globalThis._macSpotlightGlobalInstance.close(true);
                }
            } catch (_) {}
        }
    }

    _updateMenu(window) {
        if (!this._menuManager) return;

        const lockEnabled = this._settings
            ? this._settings.get_boolean('lock-to-focused-app')
            : true;

        if (lockEnabled && this._hasMenuFocusState && window === this._focusedWindow)
            return;



        this._focusedWindow = window;
        this._hasMenuFocusState = true;
        debug(`Updating menu for ${window?.get_title?.() || 'Desktop'}.`);
        this._menuManager.updateMenuForWindow(window, true);
    }

    _scheduleMenuUpdate() {
        if (this._focusTimeoutId)
            GLib.source_remove(this._focusTimeoutId);

        this._focusTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            FOCUS_DEBOUNCE_MS,
            () => {
                this._focusTimeoutId = 0;
                const activeWindow = global.display.get_focus_window();
                this._updateMenu(activeWindow);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    updateLocale(lang) {
        if (lang) {
            import('./i18n.js').then(mod => {
                if (mod.setDebugLocale) mod.setDebugLocale(lang);
                if (this._menuManager) {
                    const win = global.display.get_focus_window();
                    this._updateMenu(win);
                }
            }).catch(() => {});
        }
    }

    disable() {
        globalThis._macAppMenuExtension = null;
        debug('Disabling extension.');

        const uuid = this.metadata.uuid || 'appmenu@ChathurangaBW.github.io';
        this._removeStalePanelButtons(uuid);

        global.display.disconnectObject(this);
        const tracker = global.backend?.get_cursor_tracker?.();
        if (tracker) {
            try { tracker.disconnectObject(this); } catch (_) {}
        }
        if (global.window_manager) {
            try { global.window_manager.disconnectObject(this); } catch (_) {}
        }
        if (Main.sessionMode) {
            try { Main.sessionMode.disconnectObject(this); } catch (_) {}
        }
        if (Main.overview) {
            try { Main.overview.disconnectObject(this); } catch (_) {}
        }
        this._removeSearchKeybinding();
        this._removeClipboardKeybinding();
        destroySearchDialog();
        destroyApplicationsDialog();
        destroyClipboardDialog();
        globalThis._macSpotlightToggle = null;
        globalThis.toggleMacApplications = null;
        globalThis.toggleMacClipboard = null;
        globalThis.closeMacApplications = null;
        globalThis.closeMacSpotlight = null;
        globalThis.closeMacClipboard = null;

        if (this._focusTimeoutId) {
            GLib.source_remove(this._focusTimeoutId);
            this._focusTimeoutId = 0;
        }

        this._focusedWindow = null;
        this._hasMenuFocusState = false;

        if (this._menuManager) {
            this._menuManager.destroy();
            this._menuManager = null;
        }

        if (this._userSwitcherController) {
            this._userSwitcherController.destroy();
            this._userSwitcherController = null;
        }

        if (this._workspaceIndicatorController) {
            this._workspaceIndicatorController.destroy();
            this._workspaceIndicatorController = null;
        }

        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._overviewHidden && this._overviewWasVisible) {
            let activities = Main.panel.statusArea['activities'];
            if (activities) activities.show();
        }
        this._overviewHidden = false;
        this._overviewWasVisible = false;

        disposeViewActions();
        setLoggerSettings(null);
        this._settings = null;
    }
}
