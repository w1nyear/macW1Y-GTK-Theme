import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { dispatch } from './actions/dispatcher.js';
import { buildAppMenu, buildFallbackAppMenu } from './menus/appMenu.js';
import { buildmacW1YMenu } from './menus/mainMenu.js';
import { buildFileMenu } from './menus/fileMenu.js';
import { buildEditMenu } from './menus/editMenu.js';
import { buildViewMenu } from './menus/viewMenu.js';
import { buildGoMenu } from './menus/goMenu.js';
import { buildWindowMenu } from './menus/windowMenu.js';
import { buildHelpMenu } from './menus/helpMenu.js';
import { RecentItemsSubmenu } from './recentItemsSubmenu.js';
import { CascadingSubmenuMenuItem } from './cascadingSubmenuMenuItem.js';
import { RealMenuManager } from './realMenuManager.js';
import * as Logger from './logger.js';

const ACCENT_COLOR_MAP = {
    'blue':   '#007aff',
    'teal':   '#30b0c7',
    'green':  '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff6a00',
    'red':    '#ff3b30',
    'pink':   '#ff2d55',
    'purple': '#af52de',
    'slate':  '#8e8e93',
    'brown':  '#a27447',
};

function getSystemAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#ff6a00';
    } catch (_e) {
        return '#ff6a00';
    }
}

function formatAppIdentifier(identifier) {
    if (!identifier || typeof identifier !== 'string') return '';
    let s = identifier.trim();
    s = s.replace(/\.desktop$/i, '');
    if (/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(s)) {
        const parts = s.split('.');
        s = parts[parts.length - 1];
    }
    s = s.replace(/[-_]?(appimage|linux|x86_64|amd64|bin)$/i, '');
    s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    s = s.replace(/[-_]+/g, ' ').trim();
    return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}


const DEFAULT_ICON = 'start-here-symbolic';


const EXTENSION_ICONS_DIR = (() => {

    try {
        const url = import.meta.url;
        if (url.startsWith('file://')) {
            const [filePath] = GLib.filename_from_uri(url);
            const extensionDir = GLib.path_get_dirname(filePath);
            return GLib.build_filenamev([extensionDir, 'icons']);
        }
    } catch (e) {

    }

    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local', 'share', 'gnome-shell', 'extensions',
        'appmenu@ChathurangaBW.github.io', 'icons'
    ]);
})();

import { _ } from './i18n.js';


function _getStaticMenus() {
    return [
        { label: _("File"),   children: buildFileMenu() },
        { label: _("Edit"),   children: buildEditMenu() },
        { label: _("View"),   children: buildViewMenu() },
        { label: _("Go"),     children: buildGoMenu() },
    ];
}

class AppMenuHoverGlide {
    constructor(menu) {
        this.menu = menu;
        this.pill = null;
        this.activeItem = null;
        this.signals = [];
        this.hideTimeout = 0;
        this.setup();
    }

    setup() {
        this.menu._macHoverTracker = this;
        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (open) {
                this.ensurePill();
                this.updateItems();
            } else {
                this.hidePill(true);
            }
        }, this);

        if (this.menu.box) {
            this.menu.box.add_style_class_name('mac-menu-hover-glide-active');
            this.menu.box.connectObject(
                'child-added', () => this.updateItems(),
                'child-removed', () => this.updateItems(),
                this
            );
        }

        if (this.menu.isOpen) {
            this.ensurePill();
            this.updateItems();
        }

        if (!this._interfaceSettings) {
            try {
                this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                this._accentSignalId = this._interfaceSettings.connect('changed::accent-color', () => {
                    const acc = getSystemAccentColor();
                    if (this.pill) {
                        this.pill.style = `background-color: ${acc} !important; border-radius: 9999px !important; box-shadow: none !important;`;
                    }
                });
            } catch (_) {}
        }
    }

    ensurePill() {
        const accent = getSystemAccentColor();
        if (this.pill && this.pill.get_parent()) {
            this.pill.style = `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`;
            return;
        }
        const box = this.menu.box;
        const parent = box ? box.get_parent() : null;
        if (!parent) return;


        for (const c of parent.get_children()) {
            if (c !== this.pill && c.name === 'mac-menu-hover-pill') {
                try { c.destroy(); } catch (_) {}
            }
        }

        this.pill = new St.Widget({
            name: 'mac-menu-hover-pill',
            style_class: 'mac-menu-hover-pill',
            style: `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            opacity: 0,
            reactive: false,
        });

        try {
            parent.insert_child_below(this.pill, box);
        } catch (_e) {
            try { parent.add_child(this.pill); } catch (_e2) {}
        }
    }

    isEligible(child) {
        if (!child || !child.visible || !child.reactive || child.sensitive === false) return false;
        if (child.has_style_class_name && (
            child.has_style_class_name('popup-separator-menu-item') ||
            child.has_style_class_name('appmenu-separator-menu-item') ||
            child.has_style_class_name('popup-inactive-menu-item') ||
            child.has_style_class_name('popup-sub-menu') ||
            child.has_style_class_name('mac-menu-section-label') ||
            child.has_style_class_name('mac-menu-hover-pill')
        )) return false;
        return true;
    }

    updateItems() {
        this.cleanupSignals();
        const box = this.menu.box;
        if (!box) return;

        const children = box.get_children();
        for (const child of children) {
            if (!this.isEligible(child)) continue;

            if (child.menu && !child.menu._appMenuHoverGlide && child.menu.box) {
                child.menu._appMenuHoverGlide = new AppMenuHoverGlide(child.menu);
            }

            const hoverId = child.connect('notify::hover', () => this.onItem(child));
            const activeId = child.connect('notify::active', () => this.onItem(child));
            this.signals.push({ actor: child, id: hoverId });
            this.signals.push({ actor: child, id: activeId });
        }
    }

    onItem(child) {
        if (child.hover || child.active) {
            if (this.hideTimeout) {
                GLib.source_remove(this.hideTimeout);
                this.hideTimeout = 0;
            }
            this.glideTo(child);
        } else {
            if (!this.hideTimeout) {
                this.hideTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                    this.hideTimeout = 0;
                    const any = this.menu.box?.get_children().some(c => this.isEligible(c) && (c.hover || c.active));
                    if (!any) this.hidePill(false);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    glideTo(child) {
        if (!this.isEligible(child) || !child.get_stage()) return;
        this.ensurePill();
        if (!this.pill) return;
        const parent = this.menu.box?.get_parent();
        if (!parent || !parent.get_stage()) return;

        try {
            const [px, py] = parent.get_transformed_position();
            const [cx, cy] = child.get_transformed_position();
            if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

            const ab = child.get_allocation_box ? child.get_allocation_box() : null;
            let w = (ab && ab.x2 > ab.x1) ? (ab.x2 - ab.x1) : child.width;
            let h = (ab && ab.y2 > ab.y1) ? (ab.y2 - ab.y1) : child.height;
            if (w <= 0 || h <= 0) return;


            const pillAb = this.pill.get_allocation_box ? this.pill.get_allocation_box() : null;
            const originX = (pillAb && pillAb.x2 >= pillAb.x1) ? pillAb.x1 : 0;
            const originY = (pillAb && pillAb.y2 >= pillAb.y1) ? pillAb.y1 : 0;

            const tx = (cx - px) - originX;
            const ty = (cy - py) - originY;

            this.activeItem = child;
            this.pill.remove_all_transitions();

            if (this.pill.opacity === 0) {
                this.pill.translation_x = tx;
                this.pill.translation_y = ty;
                this.pill.width = w;
                this.pill.height = h;
                this.pill.scale_x = 0.95;
                this.pill.scale_y = 0.95;
                this.pill.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this.pill.ease({
                    translation_x: tx,
                    translation_y: ty,
                    width: w,
                    height: h,
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 130,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        } catch (_) {}
    }

    hidePill(immediate = false) {
        this.activeItem = null;
        if (this.hideTimeout) {
            GLib.source_remove(this.hideTimeout);
            this.hideTimeout = 0;
        }
        if (!this.pill) return;
        this.pill.remove_all_transitions();
        if (immediate) {
            this.pill.opacity = 0;
        } else {
            this.pill.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    cleanupSignals() {
        for (const s of this.signals) {
            try { s.actor.disconnect(s.id); } catch (_) {}
        }
        this.signals = [];
    }

    destroy() {
        if (this._interfaceSettings && this._accentSignalId) {
            try { this._interfaceSettings.disconnect(this._accentSignalId); } catch (_) {}
            this._accentSignalId = 0;
            this._interfaceSettings = null;
        }
        this.cleanupSignals();
        if (this.hideTimeout) {
            try { GLib.source_remove(this.hideTimeout); } catch (_) {}
            this.hideTimeout = 0;
        }
        if (this.pill) {
            try { this.pill.destroy(); } catch (_) {}
            this.pill = null;
        }
        try {
            if (this.menu) {
                delete this.menu._macHoverTracker;
                delete this.menu._hasHoverTracker;
                delete this.menu._appMenuHoverGlide;
                if (this.menu.box) {
                    this.menu.box.remove_style_class_name('mac-menu-hover-glide-active');
                    this.menu.box.disconnectObject(this);
                }
            }
        } catch (_) {}
        try { this.menu?.disconnectObject(this); } catch (_) {}
    }
}

const TopLevelMenuButton = GObject.registerClass(
  class TopLevelMenuButton extends PanelMenu.Button {
    _init(label, children, appInstance = null, menuManagerInstance = null, isAppName = false) {
      super._init(0.0, label);
      this.add_style_class_name('appmenu-panel-button');


      this._setupMenuBoxPointer();

      this._appInstance = appInstance;
      this._menuManagerInstance = menuManagerInstance;
      this._isIcon = false;
      this._isAppName = Boolean(isAppName);


       if (label && (label.includes('distributor-logo') || label.includes('-logo') || false || label === DEFAULT_ICON)) {
        this._isIcon = true;
        this._iconSize = this._menuManagerInstance?._cachedIconSize ?? 16;
        this._titleWidget = new St.Icon({
            icon_size: this._iconSize,
            style_class: 'system-status-icon',
        });
        this.add_child(this._titleWidget);
        this._loadIcon(label);
      } else {
        let title = new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-button-label'
        });
        this.add_child(title);
        this._titleWidget = title;
      }
      this._menuOpenSignalId = 0;
      this._menuOpenHandler = null;
      this._subMenuSignalIds = [];
      this._destroyed = false;

      this.setIsAppName(this._isAppName);
      this._setMenuOpenHandler(null);
      this._buildSubMenu(children, this.menu);
      this._macHoverGlide = new AppMenuHoverGlide(this.menu);
    }

    setIsAppName(isAppName) {
        this._isAppName = Boolean(isAppName);
        if (this._isIcon) {
            this.remove_style_class_name('appmenu-app-name-button');
            this.remove_style_class_name('appmenu-menu-item-button');
            this.add_style_class_name('appmenu-icon-button');
            return;
        }
        this.remove_style_class_name('appmenu-icon-button');
        if (this._isAppName) {
            this.remove_style_class_name('appmenu-menu-item-button');
            this.add_style_class_name('appmenu-app-name-button');
            if (this._titleWidget && this._titleWidget.set_text) {
                this._titleWidget.remove_style_class_name('appmenu-menu-item-label');
                this._titleWidget.add_style_class_name('appmenu-app-name-label');
                this._titleWidget.set_style('font-weight: 700 !important;');
            }
        } else {
            this.remove_style_class_name('appmenu-app-name-button');
            this.add_style_class_name('appmenu-menu-item-button');
            if (this._titleWidget && this._titleWidget.set_text) {
                this._titleWidget.remove_style_class_name('appmenu-app-name-label');
                this._titleWidget.add_style_class_name('appmenu-menu-item-label');
                this._titleWidget.set_style('font-weight: 400 !important;');
            }
        }
    }

    _executeNativeAction(action, closeMenu = true) {
        const targetWindow = global.display.get_focus_window();
        const targetApp = this._appInstance;


        if (closeMenu && this.menu) {
            this.menu.close(true);
        }


        if (action.startsWith('spawn-command:')) {
            let cmd = action.slice('spawn-command:'.length);
            try {
                let [, argv] = GLib.shell_parse_argv(cmd);
                GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
            } catch (e) {
                Logger.error(`Failed to spawn custom command '${cmd}': ${e}`);
            }
            return;
        }
        if (action.startsWith('custom-shortcut:')) {
            let accel = action.slice('custom-shortcut:'.length);
            action = `custom-shortcut:${accel}`;
        }



        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (this._menuManagerInstance)
                this._menuManagerInstance._timeoutIds = this._menuManagerInstance._timeoutIds.filter(id => id !== timeoutId);

            if (this._destroyed || this._menuManagerInstance?._destroyed)
                return GLib.SOURCE_REMOVE;
            if (targetWindow && global.display.get_focus_window() !== targetWindow) {
                Logger.debug(`Cancelled '${action}' because focus changed before dispatch.`);
                return GLib.SOURCE_REMOVE;
            }

            if (action.startsWith('custom-shortcut:')) {
                this._sendAccelerator(action.slice('custom-shortcut:'.length));
                return GLib.SOURCE_REMOVE;
            }
            const ctx = {
                window: targetWindow,
                app: targetApp,
            };
            dispatch(action, ctx, this._menuManagerInstance);
            return GLib.SOURCE_REMOVE;
        });

        if (this._menuManagerInstance) {
            this._menuManagerInstance._timeoutIds.push(timeoutId);
        }
    }

    updateLabel(label) {
        const isIconName = label && (label.includes('distributor-logo') || label.includes('-logo') || false || label === DEFAULT_ICON);
        if (isIconName && !this._isIcon) {
            this._isIcon = true;
            if (this._titleWidget) {
                this.remove_child(this._titleWidget);
                this._titleWidget.destroy();
            }
            this._iconSize = this._menuManagerInstance?._cachedIconSize ?? 16;
            this._titleWidget = new St.Icon({
                icon_size: this._iconSize,
                style_class: 'system-status-icon',
            });
            this.add_child(this._titleWidget);
            this.setIsAppName(this._isAppName);
        } else if (!isIconName && this._isIcon) {
            this._isIcon = false;
            if (this._titleWidget) {
                this.remove_child(this._titleWidget);
                this._titleWidget.destroy();
            }
            let title = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'panel-button-label'
            });
            this.add_child(title);
            this._titleWidget = title;
            this.setIsAppName(this._isAppName);
        }
        if (this._isIcon) {
            this._loadIcon(label);
            return;
        }
        const newText = _(label);
        if (this._titleWidget) {
            if (this._titleWidget.text !== newText) {
                if (this._titleWidget.text) {
                    this._titleWidget.remove_all_transitions();
                    this._titleWidget.opacity = 0;
                    this._titleWidget.set_text(newText);
                    this._titleWidget.ease({
                        opacity: 255,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                } else {
                    this._titleWidget.set_text(newText);
                }
            }
        }
    }

    _loadIcon(label) {
        if (!this._titleWidget || !label) return;
        const iconChanged = (this._currentIconLabel !== undefined && this._currentIconLabel !== label);
        this._currentIconLabel = label;
        if (iconChanged) {
            this._titleWidget.remove_all_transitions();
            this._titleWidget.opacity = 0;
        }

        if (label === 'apple-logo' || label === 'apple' || label === 'macW1Y' || label === 'system-logo') {
            let logoFile = Gio.File.new_for_path(
                GLib.build_filenamev([EXTENSION_ICONS_DIR, 'apple-logo.svg']));
            if (!logoFile.query_exists(null)) {
                logoFile = Gio.File.new_for_path(
                    GLib.build_filenamev([EXTENSION_ICONS_DIR, 'system-logo.svg']));
            }
            if (logoFile.query_exists(null)) {
                this._titleWidget.set_icon_name(null);
                this._titleWidget.set_gicon(Gio.FileIcon.new(logoFile));
                this._titleWidget.set_icon_size(this._menuManagerInstance?._cachedIconSize ?? 16);
                if (iconChanged) {
                    this._titleWidget.ease({
                        opacity: 255,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
                return;
            }
        }

        if (label === DEFAULT_ICON) {
            this._titleWidget.set_gicon(null);
            this._titleWidget.set_icon_name(label);
            this._titleWidget.set_icon_size(this._menuManagerInstance?._cachedIconSize ?? 16);
            if (iconChanged) {
                this._titleWidget.ease({
                    opacity: 255,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
            return;
        }

        const iconFile = Gio.File.new_for_path(
            GLib.build_filenamev([EXTENSION_ICONS_DIR, `${label}.svg`]));
        if (iconFile.query_exists(null)) {
            this._titleWidget.set_icon_name(null);
            this._titleWidget.set_gicon(Gio.FileIcon.new(iconFile));
            this._titleWidget.set_icon_size(this._menuManagerInstance?._cachedIconSize ?? 16);
        } else {
            this._titleWidget.set_gicon(null);
            this._titleWidget.set_icon_name(label);
            this._titleWidget.set_icon_size(this._menuManagerInstance?._cachedIconSize ?? 16);
        }
        if (iconChanged) {
            this._titleWidget.ease({
                opacity: 255,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _setMenuOpenHandler(handler) {
        if (this._destroyed || !this.menu)
            return;
        this._menuOpenHandler = handler;
        if (this._menuOpenSignalId) {
            try { this.menu.disconnect(this._menuOpenSignalId); } catch (_e) {}
            this._menuOpenSignalId = 0;
        }

        this._menuOpenSignalId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen && !this._destroyed) {
                if (this._menuManagerInstance && Array.isArray(this._menuManagerInstance._buttons)) {
                    this._menuManagerInstance._buttons.forEach(btn => {
                        if (btn !== this && btn?.menu && (btn.menu.isOpen || btn.menu.actor?.visible)) {
                            try {
                                btn.menu.close(0);
                                if (btn.menu.actor) {
                                    btn.menu.actor.hide();
                                    btn.menu.actor.opacity = 0;
                                }
                            } catch (_) {}
                        }
                    });
                }
                this._menuOpenHandler?.();
            }
        });
    }

    _disconnectMenuSignals() {
        if (this._menuOpenSignalId && this.menu) {
            try { this.menu.disconnect(this._menuOpenSignalId); } catch (_e) {}
            this._menuOpenSignalId = 0;
        }

        this._subMenuSignalIds.forEach(({target, id}) => {
            try { target.disconnect(id); } catch (_e) {}
        });
        this._subMenuSignalIds = [];
    }

    _setupMenuBoxPointer() {
      if (!this.menu)
          return;
      if (typeof this.menu.setSourceAlignment === 'function')
          this.menu.setSourceAlignment(0.0);
      if (this.menu.actor)
          this.menu.actor.add_style_class_name('appmenu-popup-menu');
      if (this.menu.box)
          this.menu.box.add_style_class_name('appmenu-popup-menu-content');
      const bp = this.menu._boxPointer;
      if (!bp)
          return;
      bp._drawBorder = function() {};
      if (typeof bp.setSourceAlignment === 'function')
          bp.setSourceAlignment(0.0);
      bp._arrowAlignment = 0.0;
      if (!bp._origReposition) {
          bp._origReposition = bp._reposition;
          bp._reposition = function(allocationBox) {
              this._origReposition(allocationBox);
              if (!this._sourceActor || !allocationBox)
                  return;
              try {
                  const [sourceX] = this._sourceActor.get_transformed_position();
                  const curOrigin = allocationBox.get_origin();
                  const monitorIndex = Main.layoutManager.findIndexForActor(this._sourceActor);
                  const workarea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
                  const [, , natWidth] = this.get_preferred_size();
                  let targetX = sourceX;
                  if (targetX < workarea.x + 4)
                      targetX = workarea.x + 4;
                  if (targetX + natWidth > workarea.x + workarea.width - 4)
                      targetX = workarea.x + workarea.width - 4 - natWidth;

                  let parent = this.get_parent();
                  let success, x, y;
                  while (parent && !success) {
                      [success, x, y] = parent.transform_stage_point(targetX, curOrigin[1]);
                      parent = parent.get_parent();
                  }
                  if (success) {
                      allocationBox.set_origin(Math.floor(x), Math.floor(curOrigin[1]));
                  }
              } catch (_e) {}
          };
      }
    }

    rebuildMenu(children, openHandler = null) {
        if (this._destroyed || !this.menu)
            return;

        this._disconnectMenuSignals();

        try {
            this.menu.removeAll();
        } catch (_e) {

            return;
        }
        this._setupMenuBoxPointer();
        this._setMenuOpenHandler(openHandler);
        this._buildSubMenu(children, this.menu);
        this._macHoverGlide?.updateItems();
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._menuOpenHandler = null;
        this._disconnectMenuSignals();
        if (this._macHoverGlide) {
            try { this._macHoverGlide.destroy(); } catch (_) {}
            this._macHoverGlide = null;
        }
        try { this.menu?.close(true); } catch (_e) {}
        super.destroy();
    }

        _buildSubMenu(menuItems, parentMenu) {
      const hasAnyOrnament = menuItems.some(it => it && (it.ornament === 'check' || it.ornament === 'dot' || it.ornament === 'none'));
      for (let idx = 0; idx < menuItems.length; idx++) {
        const item = menuItems[idx];
        const label = _(item.label);
        if (item.type === "separator") {
          const sep = new PopupMenu.PopupSeparatorMenuItem();
          sep.add_style_class_name('appmenu-separator-menu-item');
          parentMenu.addMenuItem(sep);
        } else if (item.type === "section-header") {
          let headerItem = new PopupMenu.PopupMenuItem(label, { activate: false });
          headerItem.setSensitive(false);
          headerItem.label.add_style_class_name('popup-subtitle-menu-item');
          headerItem.add_style_class_name('appmenu-popup-menu-item');
          parentMenu.addMenuItem(headerItem);
        } else if (item.type === "submenu") {
          const recentMenuManager = this._menuManagerInstance?._recentMenuManager ?? null;
          const subMenu = new CascadingSubmenuMenuItem(label, parentMenu, recentMenuManager);
          subMenu.add_style_class_name('appmenu-popup-menu-item');
          if (typeof item.onOpen === 'function') {
              subMenu.setOnOpen(item.onOpen);
          }
          this._buildSubMenu(item.children || [], subMenu.menu);
          parentMenu.addMenuItem(subMenu);
        } else if (item.type === "recent-submenu") {
          const recentMenuManager = this._menuManagerInstance?._recentMenuManager ?? null;
          const recentSubmenu = new RecentItemsSubmenu(label, parentMenu, recentMenuManager);
          recentSubmenu.add_style_class_name('appmenu-popup-menu-item');
          parentMenu.addMenuItem(recentSubmenu);
        } else {
          const menuItem = new PopupMenu.PopupMenuItem(label);
          menuItem.add_style_class_name('appmenu-popup-menu-item');
          if (item.sensitive === false)
            menuItem.setSensitive(false);
          if (item.ornament === 'dot') {
            menuItem.setOrnament(PopupMenu.Ornament.DOT);
          } else if (item.ornament === 'check') {
            menuItem.setOrnament(PopupMenu.Ornament.CHECK);
          } else if (item.ornament === 'none' || hasAnyOrnament) {
            menuItem.setOrnament(PopupMenu.Ornament.NONE);
          } else {
            menuItem.setOrnament(PopupMenu.Ornament.HIDDEN);
          }
          if (typeof item.activate === 'function') {
            const aid = menuItem.connect("activate", () => { item.activate(); });
            this._subMenuSignalIds.push({ target: menuItem, id: aid });
          } else if (item.action) {
            const aid = menuItem.connect("activate", () => { this._executeNativeAction(item.action, true); });
            this._subMenuSignalIds.push({ target: menuItem, id: aid });
          }
          parentMenu.addMenuItem(menuItem);
        }
      }
        }


    _sendAccelerator(accel) {
        try {
            let [success, keyval, mods] = Clutter.accelerator_parse(accel);
            if (!success) {
                Logger.error(`Could not parse shortcut '${accel}'`);
                return;
            }
            let seat = Clutter.get_default_backend().get_default_seat();
            let vd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            if (!vd) return;

            let modKeys = [];
            if (mods & Clutter.ModifierType.CONTROL_MASK) modKeys.push(Clutter.KEY_Control_L);
            if (mods & Clutter.ModifierType.SHIFT_MASK) modKeys.push(Clutter.KEY_Shift_L);
            if (mods & Clutter.ModifierType.MOD1_MASK) modKeys.push(Clutter.KEY_Alt_L);
            if (mods & Clutter.ModifierType.SUPER_MASK) modKeys.push(Clutter.KEY_Super_L);

            let t = GLib.get_monotonic_time();
            modKeys.forEach(k => {
                vd.notify_keyval(t, k, Clutter.KeyState.PRESSED);
                t += 5;
            });
            vd.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
            t += 5;
            vd.notify_keyval(t, keyval, Clutter.KeyState.RELEASED);
            t += 5;
            modKeys.slice().reverse().forEach(k => {
                vd.notify_keyval(t, k, Clutter.KeyState.RELEASED);
                t += 5;
            });
        } catch (e) {
            Logger.error(`Failed to send accelerator '${accel}': ${e}`);
        }
    }
  }
);

export class MenuManager {
    constructor(uuid, settings) {
        this.uuid = uuid;
        this._settings = settings;
        this._buttons = [];
        this._timeoutIds = [];
        this._destroyed = false;
        this._recentMenuManager = new PopupMenu.PopupMenuManager(this);


        this._virtualDevice = null;


        this._cachedBlacklistKey = null;
        this._cachedBlacklistLower = null;
        this._cachedBlacklistSet = null;


        this._distroIcon = DEFAULT_ICON;
        this._realMenuManager = new RealMenuManager(this._settings, () => {
            this.updateMenuForWindow(global.display.get_focus_window(), true);
        });


        this._cachedMenuIcon = this._settings ? this._settings.get_string('menu-icon') : '';
        this._cachedShowOsIcon = this._settings ? this._settings.get_boolean('show-os-icon') : true;
        this._cachedIconSize = this._settings ? Math.max(12, Math.min(36, this._settings.get_int('icon-size') || 16)) : 16;


        this._windowTracker = Shell.WindowTracker.get_default();
        this._appSystem = Shell.AppSystem.get_default();

            this._lastDiagnostics = null;


        if (this._settings) {
            this._settingsSignalIds = [
                this._settings.connect('changed::show-os-icon', () => {
                    this._cachedShowOsIcon = this._settings.get_boolean('show-os-icon');
                    this._updateOsIconVisibility();
                }),
                this._settings.connect('changed::menu-icon', () => {
                    this._cachedMenuIcon = this._settings.get_string('menu-icon');

                    this.updateMenuForWindow(global.display.get_focus_window(), true);
                }),
                this._settings.connect('changed::use-real-menus', () => {
                    this._realMenuManager.invalidate();
                    this.updateMenuForWindow(global.display.get_focus_window(), true);
                }),
                this._settings.connect('changed::icon-size', () => {
                    this._cachedIconSize = Math.max(12, Math.min(36, this._settings.get_int('icon-size') || 16));
                    if (this._buttons.length > 0) {
                        const btn0 = this._buttons[0];
                        if (btn0._isIcon && btn0._titleWidget) {
                            btn0._titleWidget.set_icon_size(this._cachedIconSize);
                        }
                    }
                    this.updateMenuForWindow(global.display.get_focus_window(), true);
                }),
            ];
        } else {
            this._settingsSignalIds = [];
        }
    }

    get _menuIcon() {
        return (this._cachedMenuIcon && this._cachedMenuIcon.length > 0)
            ? this._cachedMenuIcon
            : DEFAULT_ICON;
    }

    get _showOsIcon() {
        return this._cachedShowOsIcon;
    }

    _updateOsIconVisibility() {
        if (this._buttons.length === 0) return;
        const osIconBtn = this._buttons[0];
        osIconBtn.visible = this._showOsIcon;
    }

    get _blacklist() {
        if (!this._settings) return [];
        const raw = this._settings.get_strv('app-blacklist');

        const key = raw.join('\0');
        if (key !== this._cachedBlacklistKey) {
            this._cachedBlacklistKey = key;
            this._cachedBlacklistLower = raw.map(s => s.toLowerCase());
            this._cachedBlacklistSet = new Set(this._cachedBlacklistLower);
        }
        return this._cachedBlacklistLower;
    }

        getVirtualDevice() {
        if (!this._virtualDevice) {
            try {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            } catch (e) {
                Logger.error(`Failed to create virtual device: ${e}`);
            }
        }
        return this._virtualDevice;
        }

        _settingBool(key, fallback = false) {
            try {
                return this._settings?.get_boolean(key) ?? fallback;
            } catch (_e) {
                return fallback;
            }
        }

        _buildTroubleshootingInfo() {
            const info = this._lastDiagnostics ?? {};
            const lines = [
                'AppMenu troubleshooting info',
                `UUID: ${this.uuid}`,
                `Extension metadata version: 7`,
                `GNOME Shell: ${Config.PACKAGE_VERSION ?? 'unknown'}`,
                `Session: ${GLib.getenv('XDG_SESSION_TYPE') || 'unknown'}`,
                `Focused app: ${info.appName ?? _('Desktop')}`,
                `Application ID: ${info.appId ?? 'none'}`,
                `Window class: ${info.wmClass || 'none'}`,
                `Window title present: ${info.hasWindowTitle ? 'yes' : 'no'}`,
                `Real menus setting: ${this._settingBool('use-real-menus', true) ? 'enabled' : 'disabled'}`,
                `Menu source: ${info.menuSource ?? 'fallback'}`,
                `Debug logging: ${this._settingBool('debug-logging', false) ? 'enabled' : 'disabled'}`,
                `User switcher: ${this._settingBool('show-user-switcher', true) ? 'enabled' : 'disabled'}`,
                `Workspace indicator: ${this._settingBool('show-workspace-indicator', false) ? 'enabled' : 'disabled'}`,
                'Install note: on Wayland, log out and log back in after installing or upgrading.',
            ];
            return lines.join('\n');
        }

        _copyTroubleshootingInfo() {
            const text = this._buildTroubleshootingInfo();
            try {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                Main.notify(_('AppMenu'), _('Troubleshooting info copied to clipboard.'));
                Logger.debug('Troubleshooting info copied to clipboard.');
            } catch (e) {
                Logger.error(`Failed to copy troubleshooting info: ${e}`);
                Main.notify(_('AppMenu'), _('Could not copy troubleshooting info. Enable debug logging and check the journal.'));
            }
        }

        _buildStatusMenuChildren() {
            return [];
        }

        updateMenuForWindow(window, force = false) {
        if (this._destroyed)
            return;


        let appName = "Finder";
        let isAppFocused = false;
        let detectedApp = null;

        if (window) {
            let windowType = window.get_window_type();

            if (windowType === 0) {
                detectedApp = this._windowTracker.get_window_app(window);


                const blacklistLower = this._blacklist;
                const blacklistSet = this._cachedBlacklistSet;
                if (blacklistLower.length > 0) {
                    const idLower = detectedApp ? (detectedApp.get_id() || "").toLowerCase() : "";
                    const nameLower = detectedApp ? (detectedApp.get_name() || "").toLowerCase() : "";
                    const wmClassLower = (window.get_wm_class() || "").toLowerCase();
                    const titleLower = (window.get_title() || "").toLowerCase();


                    const isBlacklisted = blacklistSet.has(idLower) ||
                        blacklistSet.has(nameLower) ||
                        blacklistSet.has(wmClassLower) ||
                        blacklistSet.has(titleLower) ||
                        blacklistLower.some(item =>
                            idLower.includes(item) ||
                            nameLower.includes(item) ||
                            wmClassLower.includes(item) ||
                            titleLower.includes(item)
                        );

                    if (isBlacklisted) {
                        detectedApp = null;
                    }
                }

                if (detectedApp) {
                    appName = detectedApp.get_name();
                    isAppFocused = true;
                } else if (window.get_wm_class()) {
                    const wmClass = window.get_wm_class();
                    const wmLower = wmClass.toLowerCase();
                    const parts = wmClass.split('.');
                    const lastPart = parts[parts.length - 1];
                    const lastLower = lastPart.toLowerCase();
                    const midPart = parts.length > 2 ? parts[1].toLowerCase() : '';

                    let fallbackApp = this._appSystem.lookup_desktop_wmclass(wmClass) ||
                                      this._appSystem.lookup_desktop_wmclass(wmLower) ||
                                      this._appSystem.lookup_app(wmClass + '.desktop') ||
                                      this._appSystem.lookup_app(wmLower + '.desktop');

                    if (!fallbackApp) {
                        const candidates = [
                            lastPart,
                            lastLower,
                            'appimage-' + lastLower,
                            midPart ? 'appimage-' + midPart : null,
                            midPart ? midPart : null,
                        ].filter(Boolean);

                        for (const cand of candidates) {
                            fallbackApp = this._appSystem.lookup_desktop_wmclass(cand) ||
                                          this._appSystem.lookup_app(cand + '.desktop') ||
                                          this._appSystem.lookup_app(cand.toLowerCase() + '.desktop');
                            if (fallbackApp) break;
                        }
                    }

                    if (!fallbackApp) {
                        try {
                            const installed = this._appSystem.get_installed();
                            for (const appInfo of installed) {
                                const swm = (appInfo.get_startup_wm_class?.() || appInfo.get_string?.('StartupWMClass') || '').toLowerCase();
                                if (swm && (swm === wmLower || swm === lastLower || wmLower.endsWith(swm) || swm.endsWith(lastLower))) {
                                    fallbackApp = this._appSystem.lookup_app(appInfo.get_id());
                                    if (fallbackApp) break;
                                }
                                const id = (appInfo.get_id?.() || '').toLowerCase();
                                if (id === `appimage-${lastLower}.desktop` || (midPart && id === `appimage-${midPart}.desktop`)) {
                                    fallbackApp = this._appSystem.lookup_app(appInfo.get_id());
                                    if (fallbackApp) break;
                                }
                            }
                        } catch (_) {}
                    }

                    if (fallbackApp) {
                        detectedApp = fallbackApp;
                        appName = fallbackApp.get_name();
                    } else {
                        appName = formatAppIdentifier(wmClass);
                    }
                    isAppFocused = true;
                }
            }
        }

        const wmClass = window?.get_wm_class?.() ?? '';


        if (appName && /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(appName.trim())) {
            appName = formatAppIdentifier(appName);
        }


        {
            const appNameLower = String(appName || '').toLowerCase();
            const appIdLower = (detectedApp?.get_id?.() || '').toLowerCase();
            const wmClassLower = wmClass.toLowerCase();
            if (appIdLower.includes('nautilus') ||
                wmClassLower.includes('nautilus') ||
                appNameLower.includes('nautilus') ||
                appNameLower === 'files' || appNameLower === 'файли' || appNameLower === 'файлы') {
                appName = 'Finder';
            }
        }

            const realMenuData = this._realMenuManager.updateForWindow(window, appName, detectedApp, wmClass);
            const menuSource = realMenuData?.topLevelMenus?.length
                ? _('Real exported menus')
                : _('Fallback menus');
            this._lastDiagnostics = {
                appName,
                appId: detectedApp?.get_id?.() ?? null,
                wmClass,
                hasWindowTitle: Boolean(window?.get_title?.()),
                menuSource,
            };

        const fallbackAppChildren = isAppFocused
            ? buildAppMenu(appName, detectedApp, window)
            : buildFallbackAppMenu();


        let augmentedAppChildren = fallbackAppChildren.slice();
        if (isAppFocused && detectedApp) {
            let openWindows = detectedApp.get_windows();
            if (openWindows && openWindows.length > 1) {
                let winItems = [];
                winItems.push({ type: 'section-header', label: _('Open Windows') });
                openWindows.forEach(w => {
                    let t = w.get_title() || appName;
                    winItems.push({
                        label: w === window ? `✓ ${t}` : t,
                        activate: () => {
                            try { w.activate(global.get_current_time()); } catch (e) {}
                        }
                    });
                });
                winItems.push({ type: 'separator' });
                augmentedAppChildren = [...winItems, ...augmentedAppChildren];
            }


            augmentedAppChildren.push({ type: 'separator' });
            augmentedAppChildren.push({
                label: _('App Details'),
                activate: () => {
                    try {
                        GLib.spawn_async(null,
                            ['gnome-software', `--details=${detectedApp.get_id()}`],
                            null, GLib.SpawnFlags.SEARCH_PATH, null);
                    } catch (e) {}
                }
            });
            augmentedAppChildren.push({
                label: _('Quit %s').replace('%s', appName),
                activate: () => {
                    try {
                        let wins = detectedApp.get_windows();
                        if (wins && wins.length > 0)
                            wins.forEach(w => w.delete(global.get_current_time()));
                    } catch (e) {}
                }
            });
        }

        const appChildren = realMenuData?.appMenuChildren?.length
            ? realMenuData.appMenuChildren
            : augmentedAppChildren;


        let customMenus = [];
        try {
            let raw = this._settings.get_string('custom-app-menus') || '[]';
            let sections = JSON.parse(raw);
            if (Array.isArray(sections)) {
                sections = sections.filter(s => s && s.enabled !== false);
                sections.forEach(section => {
                    let items = Array.isArray(section.items) ? section.items : [];
                    let children = items.filter(e => e && e.value).map(e => ({
                        label: e.label || _('(untitled)'),
                        action: e.kind === 'shortcut'
                            ? `custom-shortcut:${e.value}`
                            : `spawn-command:${e.value}`,
                    }));
                    if (children.length === 0)
                        children.push({ label: _('No items configured'), sensitive: false });
                    customMenus.push({
                        type: 'submenu',
                        label: section.label || _('Custom'),
                        children,
                    });
                });
            }
        } catch (e) {   }

        const windowChildren = buildWindowMenu(window, detectedApp);
        const mainChildren = [
            { label: _("About This System"), action: "about-this-system" },
            { type: "separator" },
            { label: _("System Settings"), action: "system-settings" },
            { label: _("Software"), action: "app-store" },
            { type: "separator" },
            { type: "recent-submenu", label: _("Recent Items") },
            { label: _("Search..."), action: "open-search" },
            { type: "separator" },
            { label: _("Force Quit..."), action: "force-quit" },
            { type: "separator" },
            { label: _("Sleep"), action: "sleep" },
            { label: _("Restart"), action: "restart" },
            { label: _("Shut Down"), action: "shut-down" },
            { type: "separator" },
            { label: _("Lock Screen"), action: "lock-screen" },
            { label: _("Log Out..."), action: "log-out" },
        ];

        let topLevelMenus = realMenuData?.topLevelMenus?.length
            ? realMenuData.topLevelMenus.slice()
            : _getStaticMenus().concat([{ label: _('Window'), children: windowChildren }]);

        if (realMenuData?.topLevelMenus?.length) {
            const winTrans = _('Window').toLowerCase();
            const hasWindowMenu = topLevelMenus.some(menu => {
                const l = String(menu.label || '').toLowerCase();
                return l === 'window' || l === winTrans;
            });
            if (!hasWindowMenu)
                topLevelMenus.push({ label: _('Window'), children: windowChildren });
        }

        const newMenuData = [
            { label: this._menuIcon, children: mainChildren },
            { label: appName, children: appChildren },
            ...topLevelMenus,
            ...customMenus,
        ];


        while (this._buttons.length < newMenuData.length) {
            const idx = this._buttons.length;
            const data = newMenuData[idx];
            const isAppName = (idx === 1);
            const role = `${this.uuid}-${idx}`;
            if (Main.panel.statusArea[role]) {
                try { Main.panel.statusArea[role].destroy(); } catch (_) {}
                delete Main.panel.statusArea[role];
            }




            const btn = new TopLevelMenuButton(data.label, [], detectedApp, this, isAppName);
            Main.panel.addToStatusArea(role, btn, idx + 1, 'left');
            this._buttons.push(btn);
        }

        for (let i = 0; i < newMenuData.length; i++) {
            const btn = this._buttons[i];
            if (!btn || btn._destroyed)
                continue;
            const data = newMenuData[i];

            btn._appInstance = detectedApp;
            btn.setIsAppName(i === 1);
            btn.updateLabel(data.label);
            btn.rebuildMenu(data.children, data.onOpen ?? null);
            if (btn.menu && !btn.menu._macHoverTracker) {
                btn.menu._macHoverTracker = new AppMenuHoverGlide(btn.menu);
            }
        }

        const isLocked = Boolean(
            Main.sessionMode?.isLocked ||
            Main.sessionMode?.currentMode === 'unlock-dialog' ||
            Main.sessionMode?.currentMode === 'gdm'
        );
        if (isLocked) {
            for (const b of this._buttons) {
                if (b?.container) b.container.visible = false;
            }
        }


        while (this._buttons.length > newMenuData.length) {
            const extra = this._buttons.pop();
            try { extra.destroy(); } catch (_e) {}
        }


        if (this._buttons.length > 0 && !this._buttons[0]._destroyed) {
            try { this._buttons[0].visible = this._showOsIcon; } catch (_e) {}
        }
    }

    clear() {
        for (let idx = 0; idx < this._buttons.length; idx++) {
            const role = `${this.uuid}-${idx}`;
            delete Main.panel.statusArea[role];
        }
        this._buttons.forEach(btn => {
            try { btn.destroy(); } catch (_e) {}
        });
        this._buttons = [];


        if (this._timeoutIds && this._timeoutIds.length > 0) {
            this._timeoutIds.forEach(id => GLib.source_remove(id));
            this._timeoutIds = [];
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;


        if (this._settings && this._settingsSignalIds) {
            this._settingsSignalIds.forEach(id => {
                try { this._settings.disconnect(id); } catch (_e) {   }
            });
            this._settingsSignalIds = [];
        }
        this.clear();
        this._virtualDevice = null;
        this._realMenuManager?.destroy();
        this._realMenuManager = null;
    }
}
