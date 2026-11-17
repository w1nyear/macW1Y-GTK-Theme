// SPDX-License-Identifier: GPL-3.0-or-later


import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { createTileGrid, canTile, canRestore, restoreAllWindows, toggleFullscreen } from './windowTiling.js';

let indicator = null;
let _extension = null;

const ACCEL_OPACITY = 110;




const MENU_CLOSE_ARGS = parseInt(Config.PACKAGE_VERSION) >= 51
    ? { animate: true } : true;


const KIWI_MENU_ITEMS = [
    '_tilingMenuItem', '_tilingSeparator', '_fullscreenMenuItem',
    '_restoreMenuItem', '_alwaysOnTopMenuItem', '_restoreSeparator',
];



function formatAccel(accel) {
    return accel
        .replace(/<Super>/g, 'Super+')
        .replace(/<Shift>/g, 'Shift+')
        .replace(/<Control>|<Primary>/g, 'Ctrl+')
        .replace(/<Alt>/g, 'Alt+');
}



function addAccelLabel(item, accel) {
    if (!item || !accel || item._kiwiAccelAdded)
        return;

    item._kiwiAccelAdded = true;
    item.label.x_expand = true;

    const label = new St.Label({
        text: formatAccel(accel),
        style_class: 'kiwi-menu-accel',
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.opacity = ACCEL_OPACITY;
    item.add_child(label);
}



function windowForActor(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        if (a.metaWindow)
            return a.metaWindow;
    }
    return null;
}

const WindowTitleIndicator = GObject.registerClass(
class WindowTitleIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-title', true);

        this._syncMenuIdleId = null;
        this._focusSyncIdleId = null;
        this._settings = _extension.getSettings();
        this._wmKeybindings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
        this._gettext = _extension.gettext.bind(_extension);

        this._menu = new AppMenu(this);
        this.setMenu(this._menu);
        Main.panel.menuManager.addMenu(this._menu);

        this._box = new St.BoxLayout({style_class: 'panel-button'});

        this._icon = new St.Icon({
            style_class: 'app-menu-icon kiwi-window-title-icon',
            icon_size: 16,
        });
        this._icon.visible = this._settings.get_boolean('show-window-title-icon');
        this._iconVisibilityId = this._settings.connect('changed::show-window-title-icon',
            () => this._icon.visible = this._settings.get_boolean('show-window-title-icon'));
        this._box.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            style: 'max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
        });
        this._box.add_child(this._label);
        this.add_child(this._box);
        this._focusWindow = null;
        this._hoverWindow = null;
        this._stageEventId = null;
        this._focusWindowSignal = global.display.connect('notify::focus-window',
            this._onFocusedWindowChanged.bind(this));

        this._overviewShowingId = Main.overview.connect('showing',
            () => this._startHoverTracking());


        this._overviewHidingId = Main.overview.connect('hiding', () => {
            this._stopHoverTracking();
            this._setHoverWindow(null);
        });

        this._onFocusedWindowChanged();

        for (const name of KIWI_MENU_ITEMS)
            this[name] = null;

        this._menuOpenStateId = this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._updateAppMenuAccels();
                this._updateKiwiMenuItems();
                this._queueMenuAlignment();
            }
        });

        this._overviewHiddenId = Main.overview.connect('hidden',
            () => this._onOverviewHidden());
    }




    _startHoverTracking() {
        if (this._stageEventId)
            return;

        this._stageEventId = global.stage.connect('captured-event', (stage, event) => {
            const type = event.type();
            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.ENTER)
                this._setHoverWindow(windowForActor(stage.get_event_actor(event)));
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _stopHoverTracking() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = null;
        }
    }

    _setHoverWindow(window) {
        if (window === this._hoverWindow)
            return;

        this._hoverWindow = window;
        this._updateWindowTitle();
    }

    _onFocusedWindowChanged() {
        let window = global.display.focus_window;




        if (!window && (Main.overview.visible || (this.menu && this.menu.isOpen)))
            return;

        if (this._focusWindow) {
            this._focusWindow.disconnect(this._titleSignal);
            this._focusWindow = null;
        }

        if (window) {
            this._focusWindow = window;
            this._titleSignal = window.connect('notify::title',
                this._updateWindowTitle.bind(this));
            this._updateWindowTitle();
            this.show();
        } else {
            this._clearDisplay();
        }
    }




    _onOverviewHidden() {
        if (this._focusSyncIdleId)
            GLib.Source.remove(this._focusSyncIdleId);

        this._focusSyncIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._focusSyncIdleId = null;
            this._onFocusedWindowChanged();
            return GLib.SOURCE_REMOVE;
        });
    }


    _updateWindowTitle() {
        const titleWindow = this._hoverWindow ?? this._focusWindow;
        if (!titleWindow) return;

        let windowTitle = titleWindow.get_title();


        if (!windowTitle) {
            this._clearDisplay();
            return;
        }


        const normalizedTitle = windowTitle.trim().toLowerCase();
        if (normalizedTitle.startsWith('com.') || normalizedTitle.startsWith('gjs') || normalizedTitle.includes('@!0,0')) {
            this._clearDisplay();
            return;
        }

        windowTitle = windowTitle.trim();

        const tracker = Shell.WindowTracker.get_default();
        const app = tracker ? tracker.get_window_app(titleWindow) : null;
        const appName = app ? app.get_name() : null;
        const normalizedAppName = appName ? appName.trim().toLowerCase() : '';
        if (normalizedAppName.startsWith('com.') || normalizedAppName.startsWith('gjs')) {
            this._clearDisplay();
            return;
        }

        const dashIndex = Math.max(windowTitle.lastIndexOf(' - '), windowTitle.lastIndexOf(' — '));
        if (dashIndex !== -1) {
            windowTitle = windowTitle.substring(0, dashIndex);
        }

        if (app) {
            this._icon.gicon = app.get_icon();
            this._label.text = ` ${app.get_name()} — ${windowTitle}`;
            this._menu.setApp(app);
        } else {
            this._icon.gicon = null;
            this._label.text = ` ${windowTitle}`;
            this._menu.setApp(null);
        }

        this.show();

        this._queueMenuAlignment();
    }



    _queueMenuAlignment() {
        if (this._syncMenuIdleId)
            GLib.Source.remove(this._syncMenuIdleId);

        this._syncMenuIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncMenuAlignment();
            this._syncMenuIdleId = null;
            return GLib.SOURCE_REMOVE;
        });
    }





    _newWindowItem() {
        const menu = this._menu;
        if (menu._newWindowItem && menu._newWindowItem.visible)
            return menu._newWindowItem;

        const appInfo = menu._app && menu._app.appInfo;
        if (!appInfo || !appInfo.list_actions().includes('new-window'))
            return null;


        const name = appInfo.get_action_name('new-window');
        return menu._actionSection._getMenuItems()
            .find(item => item.label && item.label.text === name) || null;
    }





    _updateAppMenuAccels() {
        addAccelLabel(this._menu._quitItem, '<Control>Q');
        addAccelLabel(this._newWindowItem(), '<Control>N');
    }





    _updateKiwiMenuItems() {
        this._destroyKiwiMenuItems();

        const win = this._focusWindow;
        if (!win)
            return;

        const _ = this._gettext;
        let position = 0;

        if (canTile(win) && this._settings.get_boolean('show-tiling-title-menu')) {
            const grid = createTileGrid(this._gettext, () => this._menu.close());
            grid.sync(win);


            this._tilingMenuItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'kiwi-tiling-menu-item',
            });
            this._tilingMenuItem.add_child(grid.actor);
            this._menu.addMenuItem(this._tilingMenuItem, position++);

            this._tilingSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this._menu.addMenuItem(this._tilingSeparator, position++);
        }



        const isFullscreen = win.is_fullscreen();
        this._fullscreenMenuItem = new PopupMenu.PopupMenuItem(
            isFullscreen ? _('Leave Fullscreen') : _('Fullscreen'));
        this._fullscreenMenuItem.connect('activate', () => toggleFullscreen(win));


        addAccelLabel(this._fullscreenMenuItem,
            this._wmKeybindings.get_strv('toggle-fullscreen')[0]);
        this._menu.addMenuItem(this._fullscreenMenuItem, position++);

        this._restoreMenuItem = new PopupMenu.PopupMenuItem(_('Restore Window'));
        this._restoreMenuItem.connect('activate', () => restoreAllWindows(win));
        if (isFullscreen || !canRestore(win))
            this._restoreMenuItem.setSensitive(false);
        this._menu.addMenuItem(this._restoreMenuItem, position++);

        this._alwaysOnTopMenuItem = new PopupMenu.PopupMenuItem(_('Always on Top'));


        if (win.is_above()) {
            this._alwaysOnTopMenuItem.label.x_expand = true;
            this._alwaysOnTopMenuItem.add_child(new St.Icon({
                icon_name: 'object-select-symbolic',
                style_class: 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        this._alwaysOnTopMenuItem.connect('activate', () => {
            if (win.is_above())
                win.unmake_above();
            else
                win.make_above();
        });
        addAccelLabel(this._alwaysOnTopMenuItem,
            this._wmKeybindings.get_strv('toggle-above')[0]);
        this._menu.addMenuItem(this._alwaysOnTopMenuItem, position++);


        this._restoreSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._menu.addMenuItem(this._restoreSeparator, position++);
    }

    _destroyKiwiMenuItems() {
        for (const name of KIWI_MENU_ITEMS) {
            this[name]?.destroy();
            this[name] = null;
        }
    }




    _clearDisplay(resetMenu = true) {
        this._label.text = '';
        this._icon.gicon = null;
        if (resetMenu && this._menu) {
            if (this.menu && this.menu.isOpen)
                this.menu.close(MENU_CLOSE_ARGS);
            this._menu.setApp(null);
        }
        this.hide();
    }

    _syncMenuAlignment() {
        const buttonBox = this.get_allocation_box();
        const labelBox = this._label.get_allocation_box();
        const labelLeft = labelBox.x1 - buttonBox.x1;

        let menuWidth = this._menu.actor.get_width();
        if (menuWidth <= 0) {
            const [, natWidth] = this._menu.actor.get_preferred_width(-1);
            menuWidth = natWidth;
        }

        if (menuWidth <= 0)
            return;

        const alignment = Math.max(0, Math.min(1, labelLeft / menuWidth));
        if (this._menu.actor.setSourceAlignment)
            this._menu.actor.setSourceAlignment(alignment);
        if (this._menu.actor.setArrowAlignment)
            this._menu.actor.setArrowAlignment(alignment);
        else
            this._menu._arrowAlignment = alignment;
    }

    destroy() {
        this._stopHoverTracking();

        if (this._syncMenuIdleId) {
            GLib.Source.remove(this._syncMenuIdleId);
            this._syncMenuIdleId = null;
        }
        if (this._focusSyncIdleId) {
            GLib.Source.remove(this._focusSyncIdleId);
            this._focusSyncIdleId = null;
        }

        this._destroyKiwiMenuItems();
        this._wmKeybindings = null;
        if (this._iconVisibilityId) {
            this._settings.disconnect(this._iconVisibilityId);
            this._iconVisibilityId = null;
        }
        this._settings = null;
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
        }
        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
        }
        if (this._menuOpenStateId) {
            this._menu.disconnect(this._menuOpenStateId);
        }
        if (this._focusWindowSignal) {
            global.display.disconnect(this._focusWindowSignal);
        }
        if (this._focusWindow && this._titleSignal) {
            this._focusWindow.disconnect(this._titleSignal);
        }
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
        }
        super.destroy();
    }
});

export function enable(ext) {
    _extension = ext;
    if (!indicator) {
        indicator = new WindowTitleIndicator();
        Main.panel.addToStatusArea('window-title', indicator, -1, 'left');
    }
}

export function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
    _extension = null;
}
