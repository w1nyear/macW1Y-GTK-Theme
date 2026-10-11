import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {UIManager} from './dist/uiManager.js';
import {PanelMenuManager} from './dist/panelMenuManager.js';
import {BlurMyShellWatch} from './dist/blurMyShell.js';
import {DashManager} from './dist/dockManager.js';
import {NotificationManager} from './dist/notificationManager.js';
import {QuickSettingsManager} from './dist/quickSettingsManager.js';
import {OsdManager} from './dist/osdManager.js';
import {ApplicationManager} from './dist/applicationManager.js';
import {WindowListService} from './dist/windowListService.js';
import {Logger} from './dist/logger.js';
import {adaptiveColorTweener} from './dist/animation/colors.js';
import {installGlassDiagnostics, removeGlassDiagnostics, flushGlassRing,
  dumpGlassState} from './dist/diagnostics/glass.js';
import {diagnosticLog, setUtilsLogger} from './dist/diagnostics/logging.js';

const QUICK_SETTINGS_DELAY_MS = 1500;
const DASH_SEARCH_DELAY_MS = 2000;
const DASH_RESCAN_IDLE_TICKS = 2;
const DASH_RESCAN_INTERVAL_MS = 2000;
const DUMP_LOOP_INTERVAL_MS = 100;
const DUMP_LOOP_TICKS = 600;

export default class LiquidGlassExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._logger = new Logger(this._settings);
    // Modules without settings of their own log through the same
    // `output-logs`-gated logger.
    setUtilsLogger(this._logger);
    installGlassDiagnostics();

    const path = this.dir.get_path();

    this._uiManager = new UIManager(path, this._settings, this._logger);
    this._uiManager.setup();

    this._panelMenuManager = new PanelMenuManager(path, this._settings, this._logger);
    this._panelMenuManager.setup();

    this._blurMyShellWatch = new BlurMyShellWatch(this._settings, this._logger);
    this._blurMyShellWatch.setup();

    this._notificationManager = new NotificationManager(path, this._settings, this._logger);
    this._notificationManager.setup();

    this._osdManager = new OsdManager(path, this._settings, this._logger);
    this._osdManager.setup();

    this._applicationManager = new ApplicationManager(path, this._settings, this._logger);
    this._applicationManager.setup();

    // Lets the preferences window, which cannot use Meta or Shell, offer a
    // picker of the open windows.
    this._windowListService = new WindowListService(this._logger);
    this._windowListService.setup();

    // The shell adds some Quick Settings items asynchronously at startup, so
    // the menu is styled once they are in place.
    this._quickSettingsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, QUICK_SETTINGS_DELAY_MS, () => {
      this._quickSettingsTimeoutId = 0;
      this._quickSettingsManager = new QuickSettingsManager(path, this._settings, this._logger);
      this._quickSettingsManager.setup();
      return GLib.SOURCE_REMOVE;
    });

    // Dash to Dock may create its dock after we are enabled, and recreates it
    // when monitors change, when it is enabled again and for some of its
    // settings, so look for it after a delay and rescan whenever one appears.
    this._dashDocks = [];
    this._dashRescanId = 0;
    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
      () => this._scheduleDashRescan());
    this._uiChildAddedId = Main.layoutManager.uiGroup.connect('child-added', (_group, child) => {
      if (child.get_name() === 'dashtodockContainer')
        this._scheduleDashRescan();
    });
    this._dashSearchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DASH_SEARCH_DELAY_MS, () => {
      this._dashSearchId = 0;
      this._findDashToDock();
      this._scheduleDashRescan();
      return GLib.SOURCE_REMOVE;
    });

    this._dumpLoopId = 0;
    this._dumpKeybindingInstalled = false;
    this._dumpSettingId = this._settings.connect('changed::enable-dump-shortcut',
      () => this._syncDumpLoopKeybinding());
    this._syncDumpLoopKeybinding();
  }

  disable() {
    this._settings.disconnect(this._dumpSettingId);
    this._stopDumpLoop();
    if (this._dumpKeybindingInstalled) {
      Main.wm.removeKeybinding('dump-loop-keybinding');
      this._dumpKeybindingInstalled = false;
    }

    // Shared state that no single manager owns.
    adaptiveColorTweener.stopAll();

    if (this._quickSettingsTimeoutId) {
      GLib.Source.remove(this._quickSettingsTimeoutId);
      this._quickSettingsTimeoutId = 0;
    }

    Main.layoutManager.disconnect(this._monitorsChangedId);
    Main.layoutManager.uiGroup.disconnect(this._uiChildAddedId);
    if (this._dashSearchId) {
      GLib.Source.remove(this._dashSearchId);
      this._dashSearchId = 0;
    }
    if (this._dashRescanId) {
      GLib.Source.remove(this._dashRescanId);
      this._dashRescanId = 0;
    }

    this._panelMenuManager.cleanup();
    this._panelMenuManager = null;

    this._blurMyShellWatch.cleanup();
    this._blurMyShellWatch = null;

    this._uiManager.cleanup();
    this._uiManager = null;

    this._quickSettingsManager?.cleanup();
    this._quickSettingsManager = null;

    for (const entry of [...this._dashDocks])
      this._releaseDashDock(entry);
    this._dashDocks = [];

    this._notificationManager.cleanup();
    this._notificationManager = null;

    this._osdManager.cleanup();
    this._osdManager = null;

    this._applicationManager.cleanup();
    this._applicationManager = null;

    this._windowListService.cleanup();
    this._windowListService = null;

    removeGlassDiagnostics();
    setUtilsLogger(null);
    this._logger.cleanup();
    this._logger = null;
    this._settings = null;
  }

  _collectDashContainers() {
    const found = [];
    const walk = actor => {
      if (actor === global.window_group)
        return;
      if (actor.get_name() === 'dashtodockDashContainer') {
        found.push(actor);
        return;
      }
      for (const child of actor.get_children())
        walk(child);
    };
    walk(Main.layoutManager.uiGroup);
    return found;
  }

  _findDashToDock() {
    let added = 0;
    for (const container of this._collectDashContainers()) {
      if (this._dashDocks.some(entry => entry.container === container))
        continue;

      const manager = new DashManager(this.dir.get_path(), container, this._settings, this._logger);
      manager.setup();
      const entry = {container, manager, destroyId: 0};
      entry.destroyId = container.connect('destroy', () => {
        entry.destroyId = 0;
        this._releaseDashDock(entry);
        this._scheduleDashRescan();
      });
      this._dashDocks.push(entry);
      added++;
    }

    if (added > 0)
      this._logger.log(`[Liquid Glass] Dash to Dock containers with glass: ${this._dashDocks.length}`);

    return added > 0;
  }

  _releaseDashDock(entry) {
    const index = this._dashDocks.indexOf(entry);
    if (index >= 0)
      this._dashDocks.splice(index, 1);

    if (entry.destroyId) {
      entry.container.disconnect(entry.destroyId);
      entry.destroyId = 0;
    }

    entry.manager.cleanup();
  }

  // Keeps looking until DASH_RESCAN_IDLE_TICKS scans in a row find nothing new.
  _scheduleDashRescan() {
    if (this._dashRescanId)
      GLib.Source.remove(this._dashRescanId);

    let idleTicks = 0;
    this._dashRescanId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DASH_RESCAN_INTERVAL_MS, () => {
      idleTicks = this._findDashToDock() ? 0 : idleTicks + 1;
      if (idleTicks < DASH_RESCAN_IDLE_TICKS)
        return GLib.SOURCE_CONTINUE;
      this._dashRescanId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  // Optional shortcut (enable-dump-shortcut, off by default) that writes the
  // state of every glass to the journal for 60 seconds, for bug reports.
  // Press it again to stop early.
  _syncDumpLoopKeybinding() {
    const wanted = this._settings.get_boolean('enable-dump-shortcut');
    if (wanted && !this._dumpKeybindingInstalled) {
      Main.wm.addKeybinding(
        'dump-loop-keybinding',
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => this._toggleDumpLoop()
      );
      this._dumpKeybindingInstalled = true;
    } else if (!wanted && this._dumpKeybindingInstalled) {
      Main.wm.removeKeybinding('dump-loop-keybinding');
      this._dumpKeybindingInstalled = false;
      this._stopDumpLoop();
    }
  }

  // The accelerator as the user sees it, for the notifications.
  _dumpShortcutLabel() {
    const accel = this._settings.get_strv('dump-loop-keybinding')[0];
    if (!accel)
      return 'the shortcut';
    return accel.replace(/<Control>/gi, 'Ctrl+').replace(/<Alt>/gi, 'Alt+')
      .replace(/<Shift>/gi, 'Shift+').replace(/<Super>/gi, 'Super+')
      .replace(/\+([a-z])$/, (_, k) => `+${k.toUpperCase()}`);
  }

  _stopDumpLoop() {
    if (!this._dumpLoopId)
      return false;
    GLib.Source.remove(this._dumpLoopId);
    this._dumpLoopId = 0;
    return true;
  }

  _toggleDumpLoop() {
    if (this._stopDumpLoop()) {
      Main.notify('Liquid Glass', 'Diagnostic dump stopped');
      return;
    }

    // The ring buffer holds the frames before the key press, which the dump
    // loop that starts now cannot capture.
    flushGlassRing();

    const seconds = (DUMP_LOOP_TICKS * DUMP_LOOP_INTERVAL_MS) / 1000;
    const endsAt = new Date(Date.now() + seconds * 1000);
    const hhmmss = d => [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
    // Marks where the capture starts in the journal.
    diagnosticLog(`[Liquid Glass][dump-loop] STARTED ${DUMP_LOOP_TICKS} ticks @ ${DUMP_LOOP_INTERVAL_MS}ms, ends ${hhmmss(endsAt)}`);
    Main.notify('Liquid Glass',
      `Diagnostic dump running ${seconds}s — ends at ${hhmmss(endsAt)} (${this._dumpShortcutLabel()} to stop)`);

    let count = 0;
    this._dumpLoopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DUMP_LOOP_INTERVAL_MS, () => {
      dumpGlassState();
      if (++count < DUMP_LOOP_TICKS)
        return GLib.SOURCE_CONTINUE;
      this._dumpLoopId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }
}
