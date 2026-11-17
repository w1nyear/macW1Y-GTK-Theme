
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { LiquidEffect } from './liquidEffect.js';
import Gio from 'gi://Gio';
import { UnpickableActor, UILayerSampler, WindowCloneManager, reportFrameLoopError, ensureGlassAllocated, isFrameSyncFrozen,
  setClipIfChanged, syncGlassCaptureClip } from './utils.js';

import { Logger } from './logger.js';


const SHADER_PADDING = 20;


function hexToColorArray(hex: string): [number, number, number] {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
    return [1.0, 1.0, 1.0];
  }
  let r = parseInt(hex.slice(1, 3), 16) / 255.0;
  let g = parseInt(hex.slice(3, 5), 16) / 255.0;
  let b = parseInt(hex.slice(5, 7), 16) / 255.0;
  return [r, g, b];
}

export class DashManager {
  private extensionPath: string;
  private targetActor: St.Widget;
  private _settings: Gio.Settings;


  private bgActor: Clutter.Actor | null = null;

  private effect: LiquidEffect | null = null;





  private liquidBox: Clutter.Actor | null = null;

  private _lastScreenW: number | undefined;
  private _lastScreenH: number | undefined;

  private _glassExpand: number;


  private _signals: number[];
  private _settingsSignals: number[];
  private _frameSyncId: number;



  private _torndown: boolean = false;
  private _isEffectActive: boolean;

  private _originalStyle: string | undefined;
  private _currentMarginStyle: string | undefined;
  private _dockParent: St.Widget | null = null;

  private _cloneContainer: Clutter.Actor | null = null;

  private _lastAbsX: number | undefined;
  private _lastAbsY: number | undefined;
  private _lastTW: number | undefined;
  private _lastTH: number | undefined;
  private _stableDeltaW: number | undefined;
  private _stableDeltaH: number | undefined;
  private _lastBgW: number | undefined;
  private _lastBgH: number | undefined;
  private _lastBgX: number | undefined;
  private _lastBgY: number | undefined;

  private _lastBaseW: number | undefined;
  private _lastBaseH: number | undefined;
  private _lastRestingAbsX: number | undefined;
  private _lastRestingAbsY: number | undefined;
  private _lastRestingBaseW: number | undefined;
  private _lastRestingBaseH: number | undefined;
  private _lastSlabW: number | undefined;
  private _lastSlabH: number | undefined;
  private _lastSlabX: number | undefined;

  private _outputLogs: boolean = false;

  private _marginValue: number = 0;

  private _lastHidden: boolean | undefined;

  private _uiSampler: UILayerSampler | null = null;
  private _windowCloneManager: WindowCloneManager | null = null;

  private _logger: Logger;


  constructor(extensionPath: string, targetActor: St.Widget, settings: Gio.Settings, logger: Logger) {
    this.extensionPath = extensionPath;
    this.targetActor = targetActor;
    this._settings = settings;
    this._logger = logger;

    this._glassExpand = 0;

    this._signals = [];
    this._settingsSignals = [];
    this._frameSyncId = 0;
    this._isEffectActive = false;
  }


  setup() {
    if (!this.targetActor || !this._settings) return;

    (global as any)._liquidGlassDockSync = () => {
      this.wakeFrameSync();
      this._syncGeometry();
    };
    if (Main.screenshotUI) {
      this._signals.push(Main.screenshotUI.connect('notify::visible', () => {
        if (!Main.screenshotUI.visible) {
          this.wakeFrameSync();
        }
      }));
    }


    this._bindSettings();


    if (this._settings.get_boolean('enable-dock-glass')) {
      this._applyEffect();
      this._restackGlass();
    }
  }


  _bindSettings() {
    const connectSetting = (key, callback) => {
      let id = this._settings.connect(`changed::${key}`, callback.bind(this));
      this._settingsSignals.push(id);
    };


    connectSetting('enable-dock-glass', () => {
      let enabled = this._settings.get_boolean('enable-dock-glass');
      if (enabled && !this._isEffectActive) {
        this._applyEffect();
      } else if (!enabled && this._isEffectActive) {
        this._removeEffect();
      }
    });

    connectSetting('dock-glass-expand', () => {
      if (this.effect && this._isEffectActive) {
        this._glassExpand = this._settings.get_int('dock-glass-expand');
      }
    });


    connectSetting('dock-margin-bottom', () => {
      if (this._isEffectActive) this._applyMargin();
      this._marginValue = this._settings.get_int('dock-margin-bottom') || 0;
    });


    connectSetting('dock-tint-color', () => {
      if (this.effect && this._isEffectActive) {
        let colorArray = hexToColorArray(this._settings.get_string('dock-tint-color'));
        this.effect.setTintColor(...colorArray);
      }
    });

    connectSetting('dock-tint-strength', () => {
      if (this.effect && this._isEffectActive) {
        this.effect.setTintStrength(this._settings.get_double('dock-tint-strength'));
      }
    });

    connectSetting('dock-blur-radius', () => {
      const radius = this._settings.get_int('dock-blur-radius');
      if (this.effect && this._isEffectActive) this.effect.setBlurRadius(radius);
    });

    connectSetting('dock-corner-radius', () => {
      if (this.effect && this._isEffectActive) {
        this.effect.setCornerRadius(this._settings.get_double('dock-corner-radius'));
      }
    });

    connectSetting('output-logs', () => {
      this._outputLogs = this._settings.get_boolean('output-logs');
    });

    connectSetting('dock-brightness', () => {
      if (this.effect && this._isEffectActive) {
        this.effect.setBrightness(this._settings.get_double('dock-brightness'));
      }
    });

    connectSetting('dock-contrast', () => {
      if (this.effect && this._isEffectActive) {
        this.effect.setContrast(this._settings.get_double('dock-contrast'));
      }
    });

    connectSetting('dock-saturation', () => {
      if (this.effect && this._isEffectActive) {
        this.effect.setSaturation(this._settings.get_double('dock-saturation'));
      }
    });
  }


  _applyMargin() {
    if (!this.targetActor) return;

    let marginBottom = this._settings.get_int('dock-margin-bottom');

    let [w, h] = this.targetActor.get_size();
    let [x, y] = this.targetActor.get_transformed_position();

    let monitorIndex = Main.layoutManager.findIndexForActor(this.targetActor);
    if (monitorIndex < 0) monitorIndex = Main.layoutManager.primaryIndex;
    let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;


    let distLeft = x - monitor.x;
    let distRight = (monitor.x + monitor.width) - (x + w);
    let distTop = y - monitor.y;
    let distBottom = (monitor.y + monitor.height) - (y + h);
    let minEdge = Math.min(distLeft, distRight, distTop, distBottom);

    let marginStyle = '';
    if (minEdge === distBottom || minEdge === distTop) {
      if (minEdge === distBottom) {
        marginStyle = `margin-bottom: ${marginBottom}px;`;
      } else {
        marginStyle = `margin-top: ${marginBottom}px;`;
      }
    } else {
      if (minEdge === distRight) {
        marginStyle = `margin-right: ${marginBottom}px;`;
      } else {
        marginStyle = `margin-left: ${marginBottom}px;`;
      }
    }

    if (this._originalStyle === undefined) {
      this._originalStyle = this.targetActor.get_style() || '';
    }
    this._currentMarginStyle = marginStyle;
    this.targetActor.set_style(`${this._originalStyle} ${marginStyle}`);
  }

  _restackGlass(): void {
    const uiGroup = Main.layoutManager.uiGroup;
    let dockRoot: St.Widget | null = this.targetActor;
    while (dockRoot && dockRoot.get_parent() !== uiGroup) {
      let p = dockRoot.get_parent() as St.Widget | null;
      if (!p) break;
      dockRoot = p;
    }
    if (!this.bgActor || !dockRoot || dockRoot.get_parent() !== uiGroup)
      return;
    if (this.bgActor.get_parent() !== uiGroup)
      return;
    const children = uiGroup.get_children();
    const rootIndex = children.indexOf(dockRoot);
    const bgIndex = children.indexOf(this.bgActor);
    if (rootIndex < 0 || bgIndex < 0)
      return;
    if (bgIndex !== rootIndex - 1) {
      uiGroup.set_child_below_sibling(this.bgActor, dockRoot);
    }
  }

  _applyEffect() {
    if (this._isEffectActive) return;
    this._isEffectActive = true;

    this.targetActor.add_style_class_name('liquid-glass-transparent');

    this._dockParent = this.targetActor.get_parent() as St.Widget | null;
    if (this._dockParent) {
      this._dockParent.add_style_class_name('liquid-glass-transparent');
    }

    this.bgActor = new UnpickableActor();
    this.bgActor.set_name('liquid-glass-bg-actor');

    this.bgActor.set_size(1.0, 1.0);




    this.liquidBox = new UnpickableActor();
    this.liquidBox.set_name("liquid-box");
    this.liquidBox.set_clip_to_allocation(true);
    this.bgActor.add_child(this.liquidBox);


    let dummyBreaker = new UnpickableActor();
    dummyBreaker.set_name("optimization-breaker");
    dummyBreaker.set_size(1.0, 1.0);
    dummyBreaker.set_opacity(0);
    this.liquidBox.add_child(dummyBreaker);




    this._cloneContainer = new UnpickableActor();
    this._cloneContainer.set_name("clone-container");
    this.liquidBox.add_child(this._cloneContainer);


    this._applyMargin();
    this._marginValue = this._settings.get_int('dock-margin-bottom');
    this._glassExpand = this._settings.get_int("dock-glass-expand");
    this._outputLogs = this._settings.get_boolean('output-logs');

    let dockRoot = this.targetActor;
    while (dockRoot && dockRoot.get_parent() !== Main.layoutManager.uiGroup) {
      let p = dockRoot.get_parent() as St.Widget | null;
      if (!p) break;
      dockRoot = p;
    }

    if (dockRoot && dockRoot.get_parent() === Main.layoutManager.uiGroup) {
      Main.layoutManager.uiGroup.insert_child_below(this.bgActor, dockRoot);
    } else {
      Main.layoutManager.uiGroup.add_child(this.bgActor);
    }
    this._restackGlass();


    let blurRadius = this._settings.get_int('dock-blur-radius');
    let tintColorStr = this._settings.get_string('dock-tint-color');
    let tintStrength = this._settings.get_double('dock-tint-strength');
    let cornerRadius = this._settings.get_double('dock-corner-radius');
    let brightness = this._settings.get_double('dock-brightness');
    let contrast = this._settings.get_double('dock-contrast');
    let saturation = this._settings.get_double('dock-saturation');

    this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, logger: this._logger, owner: 'dock' } as any);
    this.effect.setPadding(SHADER_PADDING);
    this.effect.setTintColor(...hexToColorArray(tintColorStr));
    this.effect.setTintStrength(tintStrength);
    this.effect.setCornerRadius(cornerRadius);
    this.effect.setBrightness(brightness);
    this.effect.setContrast(contrast);
    this.effect.setSaturation(saturation);
    this.effect.setBlurRadius(blurRadius);

    this.effect.setIsDock(true);
    this.liquidBox.add_effect(this.effect);


    this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-dock');






    this._uiSampler = new UILayerSampler(
      this.bgActor, this.liquidBox,
      [dockRoot, global.windowGroup, global.window_group],
      this._cloneContainer,
      'dock',
      [this.targetActor]);

    this.bgActor.show();

    const laterAdd = (laterType: Meta.LaterType, callback: GLib.SourceFunc) => {
      return global.compositor.get_laters().add(laterType, callback);
    };

    const frameLaterType = Meta.LaterType.BEFORE_REDRAW;


    let buildClones = () => {
      if (!this.bgActor) return;


      if (this._uiSampler) {
        for (let child of Main.layoutManager.uiGroup.get_children()) {
          if (child === this.bgActor) continue;



          let isLiquidBg = child.name === 'liquid-glass-bg-actor' ||
            (typeof child.get_children === 'function' &&
              child.get_children().some(c => c.name === 'liquid-box'));

          if (isLiquidBg || (child as any).name === 'iconsContainer' || (child as any).name === 'Dummy Cursor' || (child as any)._delegate?.app || (child as any).app) {
            this._uiSampler.addExclusion(child);
          }
        }
      }

      this._windowCloneManager?.rebuildClones();
      this._uiSampler?.rebindSelf();
      this._uiSampler?.refresh();
    };









    let frameTick = () => {
      this._frameSyncId = 0;









      if (this._torndown) return GLib.SOURCE_REMOVE;
      if (!this.bgActor || !this.targetActor.mapped) return GLib.SOURCE_REMOVE;



      if (isFrameSyncFrozen()) {
        this._frameSyncId = laterAdd(frameLaterType, frameTick);
        return GLib.SOURCE_REMOVE;
      }





      ensureGlassAllocated(this.bgActor);
      try {
        this._syncGeometry();
      } catch (e) {
        reportFrameLoopError('DockManager', e);
      }
      this._frameSyncId = laterAdd(frameLaterType, frameTick);
      return GLib.SOURCE_REMOVE;
    };

    let startFrameSync = () => {
      if (this._frameSyncId === 0) {
        buildClones();
        this._frameSyncId = laterAdd(frameLaterType, frameTick);
      }
    };

    let mapSignalId = this.targetActor.connect('notify::mapped', () => {
      if (this.targetActor.mapped) {
        startFrameSync();
      } else {
        if (this._frameSyncId !== 0) {
          this._frameSyncId = 0;
        }
      }
    });
    this._signals.push(mapSignalId);

    try {
      let rId = (global.display as any).connect('restacked', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(rId); } catch (_) {} } });
    } catch (_) {}
    try {
      let fsId = (global.display as any).connect('in-fullscreen-changed', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(fsId); } catch (_) {} } });
    } catch (_) {}
    try {
      let fwId = (global.display as any).connect('notify::focus-window', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(fwId); } catch (_) {} } });
    } catch (_) {}
    try {
      let wcId = (global.display as any).connect('window-created', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(wcId); } catch (_) {} } });
    } catch (_) {}
    try {
      let waId = (global.display as any).connect('workareas-changed', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(waId); } catch (_) {} } });
    } catch (_) {}
    try {
      let wemId = (global.display as any).connect('window-entered-monitor', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(wemId); } catch (_) {} } });
    } catch (_) {}
    try {
      let wlmId = (global.display as any).connect('window-left-monitor', () => this.wakeFrameSync());
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(wlmId); } catch (_) {} } });
    } catch (_) {}
    try {
      let wmPurgeId = (global.display as any).connect('gl-video-memory-purged', () => {
        this._windowCloneManager?.rebuildClones();
        this.wakeFrameSync();
      });
      this._signals.push({ disconnect: () => { try { (global.display as any).disconnect(wmPurgeId); } catch (_) {} } });
    } catch (_) {}

    if ((global as any).window_manager) {
      try {
        let wmSwId = (global as any).window_manager.connect('switch-workspace', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).window_manager.disconnect(wmSwId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wmMinId = (global as any).window_manager.connect('minimize', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).window_manager.disconnect(wmMinId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wmUnminId = (global as any).window_manager.connect('unminimize', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).window_manager.disconnect(wmUnminId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wmSzId = (global as any).window_manager.connect('size-change', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).window_manager.disconnect(wmSzId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wmDesId = (global as any).window_manager.connect('destroy', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).window_manager.disconnect(wmDesId); } catch (_) {} } });
      } catch (_) {}
    }

    if ((global as any).workspace_manager) {
      try {
        let wsmSwId = (global as any).workspace_manager.connect('workspace-switched', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).workspace_manager.disconnect(wsmSwId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wsmActId = (global as any).workspace_manager.connect('active-workspace-changed', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).workspace_manager.disconnect(wsmActId); } catch (_) {} } });
      } catch (_) {}
      try {
        let wsmDeskId = (global as any).workspace_manager.connect('showing-desktop-changed', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (global as any).workspace_manager.disconnect(wsmDeskId); } catch (_) {} } });
      } catch (_) {}
    }

    if ((Main as any).overview) {
      try {
        let ovShowId = (Main as any).overview.connect('showing', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (Main as any).overview.disconnect(ovShowId); } catch (_) {} } });
      } catch (_) {}
      try {
        let ovHideId = (Main as any).overview.connect('hiding', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (Main as any).overview.disconnect(ovHideId); } catch (_) {} } });
      } catch (_) {}
      try {
        let ovHiddenId = (Main as any).overview.connect('hidden', () => {
          this._windowCloneManager?.rebuildClones();
          this.wakeFrameSync();
        });
        this._signals.push({ disconnect: () => { try { (Main as any).overview.disconnect(ovHiddenId); } catch (_) {} } });
      } catch (_) {}
    }

    if ((Main as any).sessionMode) {
      try {
        let smId = (Main as any).sessionMode.connect('updated', () => this.wakeFrameSync());
        this._signals.push({ disconnect: () => { try { (Main as any).sessionMode.disconnect(smId); } catch (_) {} } });
      } catch (_) {}
    }
    if ((Main as any).screenShield) {
      try {
        let ssId = (Main as any).screenShield.connect('active-changed', () => {
          if (!(Main as any).screenShield.active) {
            this._windowCloneManager?.rebuildClones();
            this.wakeFrameSync();
          }
        });
        this._signals.push({ disconnect: () => { try { (Main as any).screenShield.disconnect(ssId); } catch (_) {} } });
      } catch (_) {}
    }
    let d2dInit = this.targetActor as any;
    while (d2dInit && d2dInit.constructor?.name !== 'DashToDock') {
      d2dInit = d2dInit.get_parent();
    }
    if (d2dInit) {
      try {
        this._signals.push(d2dInit.connect('showing', () => this.wakeFrameSync()));
        this._signals.push(d2dInit.connect('hiding', () => this.wakeFrameSync()));
        this._signals.push(d2dInit.connect('notify::translation-y', () => this.wakeFrameSync()));
        this._signals.push(d2dInit.connect('notify::visible', () => this.wakeFrameSync()));
        if ((d2dInit as any).dash) {
          this._signals.push((d2dInit as any).dash.connect('notify::translation-y', () => this.wakeFrameSync()));
          this._signals.push((d2dInit as any).dash.connect('notify::opacity', () => this.wakeFrameSync()));
        }
        if (d2dInit._slider) {
          this._signals.push(d2dInit._slider.connect('notify::slide-x', () => this.wakeFrameSync()));
          this._signals.push(d2dInit._slider.connect('notify::y', () => this.wakeFrameSync()));
        }
      } catch (_) {}
    }
    if (this.targetActor.mapped) {
      startFrameSync();
    }
  }

  _syncGeometry() {
    this._restackGlass();
    if (!this.bgActor || !this.targetActor || !this.targetActor.mapped) {
      if (this.bgActor) {
        this.bgActor.hide();
        this.bgActor.opacity = 0;
      }
      return false;
    }

    let monitorIndex = Main.layoutManager.findIndexForActor(this.targetActor);
    if (monitorIndex < 0) {
      monitorIndex = Main.layoutManager.primaryIndex;
    }
    let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
    let marginBottom = this._settings ? this._settings.get_int('dock-margin-bottom') : 8;
    if (!Number.isFinite(marginBottom) || marginBottom < 0) marginBottom = 8;


    let isFullscreen = false;
    try {
      isFullscreen = (monitorIndex >= 0 && (global.display as any).get_monitor_in_fullscreen(monitorIndex)) ||
                     (global.display as any).get_monitor_in_fullscreen(Main.layoutManager.primaryIndex) ||
                     !!(monitor as any)?.inFullscreen;
    } catch (_) {}


    let d2d = this.targetActor as any;
    while (d2d && d2d.constructor?.name !== 'DashToDock') {
      d2d = d2d.get_parent();
    }

    const isD2DTransitioning = Boolean(d2d && (
      (d2d as any)._dockState === 1   ||
      (d2d as any)._dockState === 3
    ));


    if (isFullscreen) {
      const isD2DShowing = d2d && d2d.visible && d2d.mapped &&
                           ((d2d as any)._dockState === 2   || (d2d as any)._dockState === 3  ) &&
                           ((d2d as any)._dockState === 3 || !(d2d as any)._slider || (d2d as any)._slider.slide_x > 0.05);
      if (!isD2DShowing) {
        this.bgActor.hide();
        this.bgActor.opacity = 0;
        return false;
      }
    }


    if (d2d && !isD2DTransitioning && (!d2d.visible || !d2d.mapped || (d2d as any)._dockState === 0   || ((d2d as any)._slider && (d2d as any)._slider.slide_x <= 0.001))) {
      this.bgActor.hide();
      this.bgActor.opacity = 0;
      (this.bgActor as any).translation_y = 0;
      return false;
    }

    let sourceActor = this.targetActor;
    let children = this.targetActor.get_children() as St.Widget[];
    for (let i = 0; i < children.length; i++) {
      if (children[i].has_style_class_name('dash-background')) {
        children[i].opacity = 0;
        sourceActor = children[i];
      }
    }


    let [baseW, baseH] = sourceActor.get_size();
    let [absX, absY] = sourceActor.get_transformed_position();
    if (Number.isNaN(absX) || Number.isNaN(absY)) return false;


    let hasSlabBounds = false;
    const slab = this._findDashBackground(this.targetActor.get_parent() || this.targetActor);
    if (slab) {
      if (!slab.visible) {
        try { slab.show(); } catch (_) {}
      }
      let slW: number | undefined, slH: number | undefined, slX: number | undefined, slY: number | undefined;
      try {
        [slW, slH] = slab.get_transformed_size();
        [slX, slY] = slab.get_transformed_position();
      } catch (_) {}
      if (Number.isFinite(slX) && Number.isFinite(slW) && slW! > 50 && Number.isFinite(slY)) {
        const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;

        if (!isD2DTransitioning && slY! >= screenBottom) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
          return false;
        }

        this._lastSlabW = slW;
        this._lastSlabH = slH;
        this._lastSlabX = slX;

        let pillW = slW! - 8;
        let pillX = slX! + 4;
        let pillH = 74;

        absX = pillX - 4;
        absY = slY! + 2;
        baseW = pillW + 8;
        baseH = pillH + 8;
        hasSlabBounds = true;
      }
    }

    let hasIconBounds = false;
    if (!hasSlabBounds && !isD2DTransitioning) {
      let icons: { x: number; y: number; w: number; h: number }[] = [];
      const walkIcons = (a: any) => {
        if (!a) return;
        if ((a.constructor?.name === 'St_Icon' || a.has_style_class_name?.('overview-icon')) && a.visible) {
          let [ix, iy] = a.get_transformed_position();
          let [iw, ih] = a.get_transformed_size();
          if (Number.isFinite(ix) && Number.isFinite(iy) && iw > 0 && ih > 0) {
            icons.push({ x: ix, y: iy, w: iw, h: ih });
          }
        }
        for (const ch of (a.get_children ? a.get_children() : [])) {
          walkIcons(ch);
        }
      };
      walkIcons(this.targetActor);

      if (icons.length > 0) {
        icons.sort((a, b) => a.x - b.x);
        let minX = icons[0].x;
        let maxX = icons[icons.length - 1].x + icons[icons.length - 1].w;
        let minY = Infinity, maxY = -Infinity;
        let baseIconW = 0, baseIconH = 0;
        for (const ic of icons) {
          if (ic.y < minY) minY = ic.y;
          if (ic.y + ic.h > maxY) maxY = ic.y + ic.h;
          if (baseIconW === 0 || ic.w < baseIconW) baseIconW = ic.w;
          if (baseIconH === 0 || ic.h < baseIconH) baseIconH = ic.h;
        }
        const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;
        if (!isD2DTransitioning && minY >= screenBottom) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
          return false;
        }

        let isHorizontal = (maxX - minX) >= (maxY - minY);
        let pillX: number, pillY: number, pillW: number, pillH: number;
        let sidePad = 6;
        if (isHorizontal) {
          pillH = 74;
          let isTop = monitor && (minY - monitor.y < (monitor.y + monitor.height) - maxY);
          pillY = isTop ? (monitor.y + 4) : (minY - Math.round((pillH - (maxY - minY)) * 0.5));
          let sidePadL = sidePad;
          let sidePadR = sidePad;
          pillX = minX - sidePadL;
          pillW = (maxX - minX) + sidePadL + sidePadR;
        } else {
          pillW = (baseIconW || 54) + 20;
          let isLeft = monitor && (minX - monitor.x < (monitor.x + monitor.width) - maxX);
          pillX = isLeft ? (monitor.x + 4) : (monitor ? (monitor.x + monitor.width - 4 - pillW) : (minX - 11));
          let sidePadT = sidePad + Math.max(0, (icons[0]?.h || baseIconH) / (baseIconH || 54) - 1) * 10;
          let sidePadB = sidePad + Math.max(0, (icons[icons.length - 1]?.h || baseIconH) / (baseIconH || 54) - 1) * 10;
          pillY = minY - sidePadT;
          pillH = (maxY - minY) + sidePadT + sidePadB;
        }
        absX = pillX - 4;
        absY = pillY - 4;
        baseW = pillW + 8;
        baseH = pillH + 8;
        hasIconBounds = true;
      }
    }


    if (isD2DTransitioning && this._lastRestingAbsY !== undefined) {
      absX = this._lastRestingAbsX!;
      absY = this._lastRestingAbsY!;
      baseW = this._lastRestingBaseW!;
      baseH = this._lastRestingBaseH!;
      hasSlabBounds = true;
    } else if (hasSlabBounds || hasIconBounds) {
      this._lastRestingAbsX = absX;
      this._lastRestingAbsY = absY;
      this._lastRestingBaseW = baseW;
      this._lastRestingBaseH = baseH;
    }


    if (!hasSlabBounds && !hasIconBounds) {
      this.bgActor.hide();
      this.bgActor.opacity = 0;
      return false;
    }


    let w = Math.max(1.0, baseW);
    let h = Math.max(1.0, baseH);

    if (baseW <= 9 || baseH <= 9) {
      this.bgActor.hide();
      this.bgActor.opacity = 0;


      this._lastBgW = undefined;
      this._lastBgH = undefined;
      this._lastBgX = undefined;
      this._lastBgY = undefined;
      return false;
    }

    let visibleW = baseW;
    let visibleH = baseH;
    if (monitor) {
      if (absX < monitor.x) visibleW -= (monitor.x - absX);
      if (absY < monitor.y) visibleH -= (monitor.y - absY);
      if (absX + baseW > monitor.x + monitor.width) visibleW -= ((absX + baseW) - (monitor.x + monitor.width));
      if (absY + baseH > monitor.y + monitor.height) visibleH -= ((absY + baseH) - (monitor.y + monitor.height));
    }

    if (visibleW <= 1 || visibleH <= 1) {
      if (this._lastHidden !== true) {
        this._lastHidden = true;
        this._logger.log(
          `[Liquid Glass][dock] hiding the glass: visible=(${visibleW.toFixed(1)}x${visibleH.toFixed(1)}) ` +
          `base=(${baseW.toFixed(1)}x${baseH.toFixed(1)}) abs=(${absX.toFixed(1)},${absY.toFixed(1)}) ` +
          `monitor=(${monitor?.x},${monitor?.y},${monitor?.width}x${monitor?.height}) ` +
          `margin=${this._marginValue}`);
      }
      this.bgActor.opacity = 0;
      this.bgActor.hide();
      return false;
    } else {
      if (this._lastHidden === true) {
        this._lastHidden = false;
        this._logger.log('[Liquid Glass][dock] glass visible again');
      }
      this.bgActor.show();
      if (!isD2DTransitioning) {
        this.bgActor.opacity = this.targetActor.opacity;
        (this.bgActor as any).translation_y = 0;
      }
    }

    let bgW = Math.max(1.0, w + (SHADER_PADDING * 2) + (this._glassExpand * 2));
    let bgH = Math.max(1.0, h + (SHADER_PADDING * 2) + (this._glassExpand * 2));
    let bgX = absX - SHADER_PADDING - this._glassExpand;
    let bgY = absY - SHADER_PADDING - this._glassExpand;






    let screenW = monitor.width;
    let screenH = monitor.height;




    let localBgX = bgX - monitor.x;
    let localBgY = bgY - monitor.y;


    if (this._lastBgW !== bgW || this._lastBgH !== bgH ||
      this._lastBgX !== bgX || this._lastBgY !== bgY ||
      this._lastScreenW !== screenW || this._lastScreenH !== screenH) {

      this.bgActor.remove_transition('size');
      this.bgActor.remove_transition('position');
      this.bgActor.set_position(monitor.x, monitor.y);
      this.bgActor.set_size(screenW, screenH);
      this.bgActor.remove_transition('size');
      this.bgActor.remove_transition('position');

      this.liquidBox?.set_position(0, 0);
      this.liquidBox?.set_size(screenW, screenH);

      this._lastBgW = bgW; this._lastBgH = bgH;
      this._lastBgX = bgX; this._lastBgY = bgY;
      this._lastScreenW = screenW; this._lastScreenH = screenH;
    }








    const CLIP_PADDING = 36;








    setClipIfChanged(
      this.bgActor,
      localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
      bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
    );
    const SHADOW_MAX_RADIUS = 32;
    this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);















    this.effect?.setResolution(screenW, screenH);





    this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);






    this._windowCloneManager?.setOffset(-monitor.x, -monitor.y);







    syncGlassCaptureClip({
      cloneContainer: this._cloneContainer,
      effect: this.effect,
      originX: monitor.x,
      originY: monitor.y,
      uiSampler: this._uiSampler,
      windowCloneManager: this._windowCloneManager,
    });



    this._uiSampler?.refresh();
    this._uiSampler?.sync(monitor.x, monitor.y, screenW, screenH);

    this._windowCloneManager?.sync();
  }


  _removeEffect() {
    if (!this._isEffectActive) return;
    this._isEffectActive = false;

    this._currentMarginStyle = undefined;



    try {
      for (let sigId of this._signals) {
        this.targetActor.disconnect(sigId);
      }
      this.targetActor.remove_style_class_name('liquid-glass-transparent');

      if (this._originalStyle !== undefined) {
        this.targetActor.set_style(this._originalStyle);
        this._originalStyle = undefined;
      }
      let children = this.targetActor.get_children() as St.Widget[];
      for (let i = 0; i < children.length; i++) {
        if (children[i].has_style_class_name('dash-background')) {
          children[i].opacity = 255;
        }
      }
    } catch (e) {

    }

    this._signals = [];

    this.targetActor.remove_style_class_name('liquid-glass-transparent');

    try {
      if (this._dockParent) {
        this._dockParent.remove_style_class_name('liquid-glass-transparent');
      }
    } catch (e) { }
    this._dockParent = null;

    if (this._originalStyle !== undefined) {
      this.targetActor.set_style(this._originalStyle);
      this._originalStyle = undefined;
    }

    let children = this.targetActor.get_children() as St.Widget[];
    for (let i = 0; i < children.length; i++) {
      if (children[i].has_style_class_name('dash-background')) {
        children[i].opacity = 255;
      }
    }

    if (this._frameSyncId !== 0) {
      if (global.compositor?.get_laters) {
        global.compositor.get_laters().remove(this._frameSyncId);
      } else {

      }
      this._frameSyncId = 0;
    }

    if (this.effect) {
      this.effect.cleanup();
      this.effect = null;
    }

    if (this.bgActor) {
      this.bgActor.destroy();
      this.bgActor = null;
    }


    this.liquidBox = null;

    this._uiSampler?.destroy();
    this._windowCloneManager?.destroy();
  }









  private _teardownStep(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      try {
        this._logger?.error(`[Liquid Glass] ${this.constructor.name}.${name} failed during cleanup: ${e}`);
      } catch (_) {
        console.error(`[Liquid Glass] ${name} failed during cleanup: ${e}`);
      }
    }
  }

  cleanup() {
    this._torndown = true;

    this._teardownStep('globalSync', () => {
      if ((global as any)._liquidGlassDockSync) {
        delete (global as any)._liquidGlassDockSync;
      }
    });




    this._teardownStep('frameSync', () => {
      if (this._frameSyncId !== 0) {
        if (global.compositor?.get_laters)
          global.compositor.get_laters().remove(this._frameSyncId);
        this._frameSyncId = 0;
      }
    });


    this._teardownStep('removeEffect', () => this._removeEffect());


    this._teardownStep('settingsSignals', () => {
      if (this._settings) {
        for (let id of this._settingsSignals) {
          try { this._settings.disconnect(id); } catch (e) { }
        }
        this._settingsSignals = [];
      }
    });
  }


  private _findReferenceActor(actor: Clutter.Actor): Clutter.Actor | null {
    if (!actor) return null;

    if (!actor || typeof actor.get_children !== 'function') {
      return null;
    }


    if (actor.toString().includes('IndicatorDrawingArea')) {
      return actor;
    }


    const children = actor.get_children();
    for (const child of children) {
      const found = this._findReferenceActor(child);
      if (found) {
        return found;
      }
    }

    return null;
  }




  private _findDashBackground(root: Clutter.Actor | null, depth = 4): Clutter.Actor | null {
    if (!root || depth < 0 || typeof (root as any).get_children !== 'function') return null;
    let children: Clutter.Actor[];
    try {
      children = root.get_children();
    } catch (e) {
      return null;
    }
    for (const child of children) {
      if (child && typeof (child as any).has_style_class_name === 'function' &&
          (child as any).has_style_class_name('dash-background')) {
        return child;
      }
    }
    for (const child of children) {
      const found = this._findDashBackground(child, depth - 1);
      if (found) return found;
    }
    return null;
  }
}
