import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type { Logger } from './logger.js';

const UUID = 'blur-my-shell@aunetx';
const POPUP_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell.popup';
// The typings still call this state by its pre-46 name, ENABLED.
const ACTIVE = (ExtensionState as unknown as { ACTIVE: number }).ACTIVE;

// Blur my Shell's settings for popups, from its own schemas the way its
// getSettings() finds them, or null for a version without popup blur.
function popupSettings(extensionPath: string): Gio.Settings | null {
  const defaultSource = Gio.SettingsSchemaSource.get_default();
  const dir = GLib.build_filenamev([extensionPath, 'schemas']);
  let source = defaultSource;
  if (GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS)) {
    // Loading a compiled schema file throws a GError when it is unreadable.
    try {
      source = Gio.SettingsSchemaSource.new_from_directory(dir, defaultSource, false);
    } catch {
      return null;
    }
  }
  const schema = source?.lookup(POPUP_SCHEMA, true);
  return schema ? new Gio.Settings({ settings_schema: schema }) : null;
}

/**
 * Blur my Shell 74 blurs popup menus, notifications and OSDs by
 * default and repaints their backgrounds, which then show through the glass.
 * Publishes whether that is on for the preferences window and logs it.
 */
export class BlurMyShellWatch {
  private _stateId = 0;
  private _popup: Gio.Settings | null = null;
  private _popupId = 0;
  private _blurring: boolean | null = null;

  constructor(private _settings: Gio.Settings, private _logger: Logger) {}

  setup() {
    this._stateId = Main.extensionManager.connect('extension-state-changed', (_manager: any, extension: any) => {
      if (extension.uuid === UUID) this._sync();
    });
    this._sync();
  }

  private _sync() {
    const extension = Main.extensionManager.lookup(UUID);
    const path = extension?.state === ACTIVE ? extension.path : null;
    if (path && !this._popup) {
      this._popup = popupSettings(path);
      if (this._popup) this._popupId = this._popup.connect('changed::blur', () => this._update());
    } else if (!path) {
      this._dropPopup();
    }
    this._update();
  }

  private _update() {
    const blurring = this._popup?.get_boolean('blur') ?? false;
    if (blurring === this._blurring) return;
    this._blurring = blurring;
    if (blurring !== this._settings.get_boolean('blur-my-shell-popup-blur'))
      this._settings.set_boolean('blur-my-shell-popup-blur', blurring);
    if (blurring) {
      this._logger.warn('[Liquid Glass] Blur my Shell is blurring popups, which shows through the glass on menus, '
        + 'notifications and OSDs. Turn off Popups in Blur my Shell.');
    }
  }

  private _dropPopup() {
    if (this._popupId) this._popup!.disconnect(this._popupId);
    this._popupId = 0;
    this._popup = null;
  }

  cleanup() {
    Main.extensionManager.disconnect(this._stateId);
    this._stateId = 0;
    this._dropPopup();
    this._settings.set_boolean('blur-my-shell-popup-blur', false);
  }
}
