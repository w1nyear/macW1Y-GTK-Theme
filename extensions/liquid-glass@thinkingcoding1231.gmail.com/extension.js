import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { UIManager } from './dist/uiManager.js?v=fix3';
import { PanelMenuManager } from './dist/panelMenuManager.js?v=fix2';
import { DashManager } from './dist/dockManager.js?v=fix6';
import { NotificationManager } from './dist/notificationManager.js?v=fix3';
import { QuickSettingsManager } from './dist/quickSettingsManager.js?v=fix3';
import { OsdManager } from './dist/osdManager.js?v=fix3';
import { ApplicationManager } from './dist/applicationManager.js?v=fix6';
import { WindowListService } from './dist/windowListService.js?v=fix2';
import { Logger } from './dist/logger.js?v=fix2';
import { setUtilsLogger, adaptiveColorTweener, destroySharedBackgroundSource,
  releaseAllClonedWindowActors, installGlassSceneListeners,
  removeGlassSceneListeners } from './dist/utils.js?v=fix4';
import { startGlassRingSampler, flushGlassRing } from './dist/liquidEffect.js?v=fix3';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

const DASH_RESCAN_IDLE_TICKS = 6;
const DASH_RESCAN_INTERVAL_MS = 150;

export default class LiquidGlassExtension extends Extension {





















  enable() {
    if (this._active) {
      console.warn('[Liquid Glass] enable() called while already enabled — ignoring (this would have stacked a second set of managers).');
      return;
    }
    this._active = true;

    try { installGlassSceneListeners(); } catch (e) {
      console.error(`[Liquid Glass] Could not monitor scene transitions: ${e}`);
    }

    try {
      this._installDumpLoopKeybinding();
    } catch (e) {
      console.error(`[Liquid Glass] could not install the dump-loop keybinding: ${e}`);
    }

    try {
      this._enableInner();
    } catch (e) {
      console.error(`[Liquid Glass] enable() failed: ${e}\n${e?.stack ?? ''}`);



      try {
        this.disable();
      } catch (e2) {
        console.error(`[Liquid Glass] cleanup after a failed enable() also failed: ${e2}`);
      }
    }
  }

  _enableInner() {



    console.log('[Liquid Glass] Enabling...');

    this._dashDocks = [];
    this._settings = this.getSettings("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");

    try {
      const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
      if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
        const [ok, bytes] = GLib.file_get_contents(confPath);
        if (ok) {
          const st = JSON.parse(new TextDecoder().decode(bytes));
          const schema = this._settings.settings_schema;
          const setIntIf = (k, v) => {
            if (schema?.has_key(k) && this._settings.get_int(k) !== v) this._settings.set_int(k, v);
          };
          const setDblIf = (k, v) => {
            if (schema?.has_key(k) && Math.abs(this._settings.get_double(k) - v) > 1e-6) this._settings.set_double(k, v);
          };
          if (typeof st.liquid_shape === 'number') setIntIf('glass-shape-type', st.liquid_shape);
          if (typeof st.liquid_refraction === 'number') {
            setDblIf('glass-displacement-scale', st.liquid_refraction * 1.5);
            setDblIf('glass-ior', 1.0 + (st.liquid_refraction / 100.0) * 1.0);
          }
          if (typeof st.liquid_chroma === 'number') setDblIf('glass-chroma-strength', (st.liquid_chroma / 100.0) * 0.04);
          if (typeof st.liquid_rim === 'number') {
            const rim = st.liquid_rim / 100.0;
            setDblIf('glass-rim-intensity', rim);
            setDblIf('glass-sheen-intensity', 0.16 + rim * 0.24);
          }
          if (typeof st.liquid_specular === 'number') setDblIf('glass-specular-intensity', st.liquid_specular / 100.0);
          if (typeof st.liquid_shadow === 'number') setDblIf('shadow-intensity', Math.max(0.0, Math.min(1.0, st.liquid_shadow / 100.0)));
        }
      }
    } catch (e) {
      console.warn(`[Liquid Glass] Failed to sync styling.json on startup: ${e}`);
    }


    this._logger = new Logger(this._settings);


    setUtilsLogger(this._logger);

    this._logger.log(`[Liquid Glass] Enabled. UUID: ${this.uuid}`);









    const start = (name, fn) => {
      try {
        fn();
      } catch (e) {
        console.error(`[Liquid Glass] ${name} setup failed during enable(): ${e}\n${e?.stack ?? ''}`);
      }
    };



    start('uiManager', () => {
      this._uiManager = new UIManager(this.dir.get_path(), this._settings, this._logger);
      this._uiManager.setup();
    });

    start('panelMenuManager', () => {
      this._panelMenuManager = new PanelMenuManager(this.dir.get_path(), this._settings, this._logger);
      this._panelMenuManager.setup();
    });


    start('notificationManager', () => {
      this._notificationManager = new NotificationManager(this.dir.get_path(), this._settings, this._logger);
      this._notificationManager.setup();
    });


    start('osdManager', () => {
      this._osdManager = new OsdManager(this.dir.get_path(), this._settings, this._logger);
      this._osdManager.setup();
    });


    start('applicationManager', () => {
      this._applicationManager = new ApplicationManager(this.dir.get_path(), this._settings, this._logger);
      this._applicationManager.setup();
    });




    start('windowListService', () => {
      this._windowListService = new WindowListService(this._logger);
      this._windowListService.setup();
    });

    const startQs = () => {
      if (this._quickSettingsManager || !this._settings.get_boolean('enable-quick-settings-glass'))
        return;
      start('quickSettingsManager', () => {
        this._quickSettingsManager = new QuickSettingsManager(this.dir.get_path(), this._settings, this._logger);
        this._quickSettingsManager.setup();
      });
    };

    if (this._settings.get_boolean('enable-quick-settings-glass')) {
      this._quickSettingsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        this._quickSettingsTimeoutId = 0;
        startQs();
        return GLib.SOURCE_REMOVE;
      });
    }

    this._qsGlassSettingId = this._settings.connect('changed::enable-quick-settings-glass', () => {
      const enabled = this._settings.get_boolean('enable-quick-settings-glass');
      if (enabled) {
        startQs();
      } else if (this._quickSettingsManager) {
        teardown('quickSettingsManager', () => {
          this._quickSettingsManager.cleanup();
          this._quickSettingsManager = null;
        });
      }
    });


    this._timeoutId = 0;

    this._reconnectTimeoutId = 0;
    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this._scheduleDashRescan();
    });

    this._uiGroupChildAddedId = Main.layoutManager.uiGroup.connect('child-added', (group, actor) => {
      if (actor && (actor.name === 'dashtodockContainer' || actor.name === 'dashtodockBox')) {
        this._findDashToDock();
        this._scheduleDashRescan();
      }
    });

    this._extStateChangedId = Main.extensionManager.connect('extension-state-changed', (mgr, ext) => {
      if (ext && ext.uuid && ext.uuid.includes('dock')) {
        this._findDashToDock();
        this._scheduleDashRescan();
      }
    });


    try {
      this._findDashToDock();
    } catch (_) {}
    this._scheduleDashRescan();
  }

  _collectDashContainers() {
    const found = [];
    const skip = global.window_group;
    const walk = (actor) => {
      if (actor === skip)
        return;
      if (actor.get_name && actor.get_name() === 'dashtodockDashContainer') {
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
    const containers = this._collectDashContainers();

    if (containers.length === 0)
      return false;

    let added = 0;
    for (const container of containers) {
      if (this._dashDocks.some(entry => entry.container === container))
        continue;

      const entry = { container, manager: null, destroyId: 0 };
      this._dashDocks.push(entry);

      try {
        entry.manager = new DashManager(this.dir.get_path(), container, this._settings, this._logger);
        entry.manager.setup();
        entry.destroyId = container.connect('destroy', () => {
          entry.destroyId = 0;
          try {
            this._releaseDashDock(entry);
          } finally {
            this._scheduleDashRescan();
          }
        });
        added++;
      } catch (e) {
        this._logger.log(`[Liquid Glass] Failed to attach glass to a dock: ${e}`);
        try {
          this._releaseDashDock(entry);
        } catch (releaseError) {
          this._logger.log(`[Liquid Glass] Failed to release a dock: ${releaseError}`);
        }
      }
    }

    if (added > 0)
      this._logger.log(`[Liquid Glass] Dash to Dock containers with glass: ${this._dashDocks.length}`);

    return added > 0;
  }

  _releaseDashDock(entry) {
    const index = this._dashDocks.indexOf(entry);
    if (index >= 0)
      this._dashDocks.splice(index, 1);

    if (entry.destroyId !== 0) {
      try {
        entry.container.disconnect(entry.destroyId);
      } catch (e) { }
      entry.destroyId = 0;
    }

    if (entry.manager) {
      entry.manager.cleanup();
      entry.manager = null;
    }
  }

  _scheduleDashRescan() {
    if (this._reconnectTimeoutId !== 0)
      GLib.Source.remove(this._reconnectTimeoutId);

    let idleTicks = 0;
    let sourceId = 0;

    sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DASH_RESCAN_INTERVAL_MS, () => {
      let keepGoing = false;
      try {
        idleTicks = this._findDashToDock() ? 0 : idleTicks + 1;
        keepGoing = idleTicks < DASH_RESCAN_IDLE_TICKS;
      } finally {
        if (!keepGoing && this._reconnectTimeoutId === sourceId)
          this._reconnectTimeoutId = 0;
      }
      return keepGoing ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    });

    this._reconnectTimeoutId = sourceId;
  }







  _installDumpLoopKeybinding() {
    this._dumpLoopId = 0;


    this._ringSamplerId = startGlassRingSampler(50);
    Main.wm.addKeybinding(
      'dump-loop-keybinding',
      this.getSettings('org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com'),
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => this._toggleDumpLoop()
    );
  }

  _toggleDumpLoop() {
    if (this._dumpLoopId) {
      GLib.source_remove(this._dumpLoopId);
      this._dumpLoopId = 0;
      console.log('[Liquid Glass][dump-loop] STOPPED early by Ctrl+Alt+L');
      Main.notify('Liquid Glass', 'Diagnostic dump stopped');
      return;
    }



    try {
      flushGlassRing();
    } catch (e) {
      console.error(`[Liquid Glass][ring] flush failed: ${e}`);
    }

    const INTERVAL_MS = 100;
    const TICKS = 600;
    let count = 0;
    const seconds = (TICKS * INTERVAL_MS) / 1000;
    const endsAt = new Date(Date.now() + seconds * 1000);
    const hhmmss = d => [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');


    console.log(`[Liquid Glass][dump-loop] STARTED ${TICKS} ticks @ ${INTERVAL_MS}ms, ends ${hhmmss(endsAt)}`);
    Main.notify('Liquid Glass',
      `Diagnostic dump running ${seconds}s — ends at ${hhmmss(endsAt)} (Ctrl+Alt+L to stop)`);

    this._dumpLoopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL_MS, () => {
      try {
        global._lgGlass?.dump();
      } catch (e) {
        console.error(`[Liquid Glass][dump-loop] dump failed: ${e}`);
      }
      if (++count < TICKS) return GLib.SOURCE_CONTINUE;
      this._dumpLoopId = 0;
      console.log('[Liquid Glass][dump-loop] FINISHED');
      return GLib.SOURCE_REMOVE;
    });
  }

  _removeDumpLoopKeybinding() {
    if (this._ringSamplerId) {
      try { GLib.source_remove(this._ringSamplerId); } catch (e) { }
      this._ringSamplerId = 0;
    }
    if (this._dumpLoopId) {
      try { GLib.source_remove(this._dumpLoopId); } catch (e) { }
      this._dumpLoopId = 0;
    }
    try { Main.wm.removeKeybinding('dump-loop-keybinding'); } catch (e) { }
  }

  disable() {
    this._active = false;

    try { removeGlassSceneListeners(); } catch (_) {}

    try { this._removeDumpLoopKeybinding(); } catch (e) { }










    this._logger?.log(`[Liquid Glass] Disabling...`);





    try { adaptiveColorTweener.stopAll(); } catch (e) { }


    try { destroySharedBackgroundSource(); } catch (e) { }


    try { releaseAllClonedWindowActors(); } catch (e) { }

    if (this._quickSettingsTimeoutId && this._quickSettingsTimeoutId !== 0) {
      GLib.Source.remove(this._quickSettingsTimeoutId);
      this._quickSettingsTimeoutId = 0;
    }

    if (this._qsGlassSettingId) {
      try { this._settings.disconnect(this._qsGlassSettingId); } catch (_) {}
      this._qsGlassSettingId = 0;
    }


    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = 0;
    }

    if (this._uiGroupChildAddedId) {
      try { Main.layoutManager.uiGroup.disconnect(this._uiGroupChildAddedId); } catch (e) { }
      this._uiGroupChildAddedId = 0;
    }

    if (this._extStateChangedId) {
      try { Main.extensionManager.disconnect(this._extStateChangedId); } catch (e) { }
      this._extStateChangedId = 0;
    }

    if (this._timeoutId !== 0) {
      GLib.Source.remove(this._timeoutId);
      this._timeoutId = 0;
    }

    if (this._reconnectTimeoutId !== 0) {
      GLib.Source.remove(this._reconnectTimeoutId);
      this._reconnectTimeoutId = 0;
    }














    const teardown = (name, fn) => {
      try {
        fn();
      } catch (e) {


        try {
          this._logger?.error(`[Liquid Glass] ${name} cleanup failed during disable(): ${e}`);
        } catch (_) {
          console.error(`[Liquid Glass] ${name} cleanup failed during disable(): ${e}`);
        }
      }
    };

    teardown('panelMenuManager', () => {
      this._panelMenuManager?.cleanup();
      this._panelMenuManager = null;
    });

    teardown('uiManager', () => {
      if (this._uiManager) {
        this._uiManager.cleanup();
        this._uiManager = null;
      }
    });

    teardown('quickSettingsManager', () => {
      if (this._quickSettingsManager) {
        this._quickSettingsManager.cleanup();
        this._quickSettingsManager = null;
      }
    });


    for (const entry of [...(this._dashDocks ?? [])]) {
      teardown('dashDock', () => this._releaseDashDock(entry));
    }
    this._dashDocks = [];

    teardown('notificationManager', () => {
      if (this._notificationManager) {
        this._notificationManager.cleanup();
        this._notificationManager = null;
      }
    });

    teardown('osdManager', () => {
      if (this._osdManager) {
        this._osdManager.cleanup();
        this._osdManager = null;
      }
    });

    teardown('applicationManager', () => {
      if (this._applicationManager) {
        this._applicationManager.cleanup();
        this._applicationManager = null;
      }
    });

    teardown('windowListService', () => {
      if (this._windowListService) {
        this._windowListService.cleanup();
        this._windowListService = null;
      }
    });




    this._settings = null;
    this._panelMenuManager = null;
    this._uiManager = null;
    this._quickSettingsManager = null;
    this._dashDocks = [];
    this._notificationManager = null;
    this._osdManager = null;
    this._applicationManager = null;
    this._windowListService = null;

    teardown('logger', () => {
      if (this._logger) {
        setUtilsLogger(null);
        this._logger.cleanup();
        this._logger = null;
      }
    });
    setUtilsLogger(null);
    this._logger = null;






    console.log('[Liquid Glass] Disabled (teardown reached the end).');
  }
}
