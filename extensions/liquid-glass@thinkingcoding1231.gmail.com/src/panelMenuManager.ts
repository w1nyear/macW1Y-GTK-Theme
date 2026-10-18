import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { UIManager } from './uiManager.js';
import { Logger } from './logger.js';

// Settings prefix for every detected panel menu, separate from the calendar's
// `menu-*` keys (see UIManager._keyPrefix).
const PANEL_MENU_PREFIX = 'panel-menu';

// Menus that had their own switch before the generic detection existed.
const LEGACY_KEYS: Record<string, string> = {
  keyboard: 'enable-keyboard-menu-glass',
  vitalsMenu: 'enable-vitals-menu-glass',
};

// The popup menus a status area entry opens, with the names they are listed
// under. ArcMenu destroys the button's own menu and opens two of its own.
function menusOf(name: string, button: any): [string, any][] {
  if (button.arcMenu)
    return [[name, button.arcMenu], [`${name}ContextMenu`, button.arcMenuContextMenu]];
  return [[name, button.menu]];
}

export class PanelMenuManager {
  private _signals: { target: any; id: number }[] = [];
  private _buttons = new Map<any, number[]>();
  // Menu actor -> its glass, with the indicator name for the logs.
  private _menus = new Map<any, { name: string; manager: UIManager }>();
  private _idleId = 0;

  constructor(private _path: string, private _settings: Gio.Settings, private _logger: Logger) {}

  setup() {
    const schedule = () => this._scheduleScan();
    const watch = (target: any, signal: string) => {
      this._signals.push({ target, id: target.connect(signal, schedule) });
    };
    // Defer until addToStatusArea() has finished registering the indicator.
    const panel = Main.panel as any;
    for (const box of [panel._leftBox, panel._centerBox, panel._rightBox]) {
      watch(box, 'child-added');
      watch(box, 'child-removed');
    }
    watch(Main.extensionManager, 'extension-state-changed');
    for (const key of ['enable-extra-menu-glass', 'disabled-extra-menus', ...Object.values(LEGACY_KEYS)])
      watch(this._settings, `changed::${key}`);

    const anyPM = PopupMenu.PopupMenu.prototype as any;
    if (!anyPM._origOpenWithGlass) {
      anyPM._origOpenWithGlass = PopupMenu.PopupMenu.prototype.open;
      const self = this;
      anyPM.open = function(this: any, animate: any) {
        if (!this._glassManager && !self._menus.has(this) && this.actor && this.box && isActorValid(this.actor) && isActorValid(this.box)) {
          const reserved = new Set([Main.panel?.statusArea?.quickSettings?.menu]);
          if (!reserved.has(this) && this.constructor.name !== 'QuickSettingsMenu') {
            try {
              const manager = new UIManager(self._path, self._settings, self._logger, { menu: this }, false, 'enable-extra-menu-glass', PANEL_MENU_PREFIX, 'menu:popup', false);
              manager.setup();
              this._glassManager = manager;
              this.connectObject('destroy', () => {
                manager.cleanup();
                this._glassManager = null;
              }, this);
            } catch (e) {
              this._glassManager = null;
            }
          }
        const glass = this._glassManager?.glass || (self as any)._menus.get(this)?.manager?.glass;
        if (glass) {
          glass._copier?.clear();
          if (typeof glass.forceRefresh === 'function') {
            glass.forceRefresh(400);
          }
          glass.queue_redraw();
        }
        return anyPM._origOpenWithGlass.call(this, animate);
      };
    }

    this._scheduleScan();
  }

  private _scheduleScan() {
    if (this._idleId) return;
    this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._idleId = 0;
      this._scan();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _scan() {
    const panel = Main.panel as any;
    const { buttons, wanted, detected } = this._discover(panel);
    this._forgetButtons(buttons);
    this._detachUnwanted(wanted);
    this._attachWanted(wanted);
    detected.sort();
    if (JSON.stringify(detected) !== JSON.stringify(this._settings.get_strv('detected-extra-menus')))
      this._settings.set_strv('detected-extra-menus', detected);
  }

  private _discover(panel: any): { buttons: Set<any>, wanted: Map<any, { name: string }>, detected: string[] } {
    const buttons = new Set<any>();
    const wanted = new Map<any, { name: string }>();
    const detected: string[] = [];
    const disabled = new Set(this._settings.get_strv('disabled-extra-menus'));
    const enabled = this._settings.get_boolean('enable-extra-menu-glass');
    const reserved = new Set([panel.statusArea.dateMenu?.menu, panel.statusArea.quickSettings?.menu]);

    for (const [name, button] of Object.entries<any>(panel.statusArea)) {
      try {
        const c = button?.container ?? button;
        if (!button || !c || !panel.contains(c)) continue;
        buttons.add(button);
        this._watchButton(button);
      } catch (_e) {
        continue;
      }
      for (const [menuName, menu] of menusOf(name, button)) {
        // Dummy menus and custom non-popup actors cannot use UIManager.
        // Calendar and Quick Settings already have their own managers.
        if (!(menu instanceof PopupMenu.PopupMenu) || reserved.has(menu) || !menu.actor || !menu.box)
          continue;
        try {
          if (!menu.actor.get_parent() || !menu.box.get_parent())
            continue;
        } catch (_e) {
          continue;
        }
        detected.push(menuName);
        const allowed = LEGACY_KEYS[menuName]
          ? this._settings.get_boolean(LEGACY_KEYS[menuName]) : !disabled.has(menuName);
        if (enabled && allowed) wanted.set(menu, { name: menuName });
      }
    }
    return { buttons, wanted, detected };
  }

  private _watchButton(button: any) {
    if (this._buttons.has(button)) return;
    this._buttons.set(button, [
      button.connect('menu-set', () => this._scheduleScan()),
      button.connect('destroy', () => {
        this._buttons.delete(button);
        this._scheduleScan();
      }),
    ]);
  }

  private _forgetButtons(present: Set<any>) {
    for (const [button, ids] of this._buttons) {
      if (present.has(button)) continue;
      for (const id of ids) button.disconnect(id);
      this._buttons.delete(button);
    }
  }

  private _detachUnwanted(wanted: Map<any, unknown>) {
    // Keep existing instances: a new indicator must not close another menu.
    for (const [menu, entry] of this._menus) {
      if (wanted.has(menu)) continue;
      this._menus.delete(menu);
      if (menu._glassManager === entry.manager) {
        menu._glassManager = null;
      }
      entry.manager.cleanup();
    }
  }

  // Most of these menus belong to other extensions and may not be built the
  // way UIManager expects; such a menu is skipped instead of stopping the scan.
  private _attachWanted(wanted: Map<any, { name: string }>) {
    for (const [menu, { name }] of wanted) {
      if (this._menus.has(menu)) continue;
      const manager = new UIManager(this._path, this._settings, this._logger, { menu }, false,
        'enable-extra-menu-glass', PANEL_MENU_PREFIX, `menu:${name}`, false);
      try {
        manager.setup();
        this._menus.set(menu, { name, manager });
        menu._glassManager = manager;
      } catch (e) {
        manager.cleanup();
        this._logger.log(`[Liquid Glass] Could not attach panel menu glass to "${name}": ${e}`);
      }
    }
  }

  cleanup() {
    if (this._idleId) {
      GLib.Source.remove(this._idleId);
      this._idleId = 0;
    }

    for (const { target, id } of this._signals)
      target.disconnect(id);
    this._signals = [];

    for (const [button, ids] of this._buttons) {
      for (const id of ids)
        button.disconnect(id);
    }
    this._buttons.clear();

    for (const [menu, { manager }] of this._menus.entries()) {
      if (menu._glassManager === manager) {
        menu._glassManager = null;
      }
      manager.cleanup();
    }
    this._menus.clear();

    const anyPM = PopupMenu.PopupMenu.prototype as any;
    if (anyPM._origOpenWithGlass) {
      anyPM.open = anyPM._origOpenWithGlass;
      delete anyPM._origOpenWithGlass;
    }

    this._settings.set_strv('detected-extra-menus', []);
  }
}
