
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { LiquidEffect } from './liquidEffect.js';
import { StageContrastSampler, AdaptiveContrastConfig } from './contrastSampler.js';
import Gio from 'gi://Gio';
import {
  UnpickableActor,
  UnpickableClone,
  UILayerSampler,
  WindowCloneManager,
  reportFrameLoopError,
  ensureGlassAllocated,
  isActorValid,
  resolveMonitorGeometry,
  LayoutOpaqueActor,
  UnpickableStyledWidget,
  getAllocatedSize,
  getTransformedRect, isFrameSyncFrozen, setClipIfChanged, syncGlassCaptureClip,
  resolveCrossFade, adaptiveColorTweener } from './utils.js';

import { Logger } from './logger.js';





const SHADER_PADDING = 20;


const SAMPLE_PER_ELEMENT = false;

interface CustomBannerActor extends St.Widget {
  _colorTweenId?: number;
  _currentTargetColor?: string;
  _currentInsensitiveState?: boolean;
  _isUpdatingAlpha?: boolean;
}


export class QuickSettingsManager {





  private static readonly REGION_GRACE_FRAMES = 2;










  private static readonly TOGGLE_COLOR_SAMPLE_MS = 100;








  private static readonly TOGGLE_COLOR_FULL_PASS_EVERY = 8;

  private extensionPath: string;
  private _settings: Gio.Settings;
  private _logger: Logger;
  private targetActor: St.Widget;
  private menu: any;
  private animActor: St.Widget;

  private bgActor: Clutter.Actor | null;
  private liquidBox: Clutter.Actor | null = null;
  private _cloneContainer: Clutter.Actor | null = null;
  private effect: LiquidEffect | null;

  private _windowCloneManager: WindowCloneManager | null = null;
  private _uiSampler: UILayerSampler | null = null;






  private _menuRoot: Clutter.Actor | null = null;






  private _panelContentClone: any = null;



  private _toggleGlassHost: any = null;


  private _lastScreenW: number | undefined;
  private _lastScreenH: number | undefined;

  private _isEffectActive: boolean;
  private buttonAlpha: number;
  private _buttonTimerId: number;
  private _styledButtons: Map<Clutter.Actor, string>;
  private _buttonSignalIds: Map<Clutter.Actor, number[]>;
  private _signals: { target: any, id: number }[];
  private _animSignalId: number = 0;
  private _frameSyncId: number;



  private _torndown: boolean = false;
  private _glassExpand: number;
  private _menuXoffset: number;
  private _menuYoffset: number;


  private _springScale: Spring;
  private _springPos: Spring;
  private _springStiffness: number;
  private _springDamping: number;
  private _springMass: number;

  private _enableAnimation: boolean;

  private _tickId: number;
  private _contrastSampler: StageContrastSampler;
  private _adaptiveTimerId: number;
  private _adaptiveInFlight: boolean;
  private _styledActors: Map<Clutter.Actor, string>;
  private _hasAutoRefreshed: boolean;
  private _settingsSignals: number[];
  private _adaptiveConfig!: typeof AdaptiveContrastConfig;


  private _stableBaseW: number | undefined;
  private _stableBaseH: number | undefined;
  private _lastValidAnimAbsX: number | undefined;
  private _lastValidAnimAbsY: number | undefined;
  private _lastBgW: number | undefined;
  private _lastBgH: number | undefined;
  private _lastBgX: number | undefined;
  private _lastBgY: number | undefined;

  private _cornerRadius: number = 0;
  private _animationInterval: number = 16;


  private _enableSubmenuFix: boolean = false;

  private _cachedSubmenus: Clutter.Actor[] | null = null;





  private _applyTo: 'background' | 'toggles' = 'background';
  private _activeMode: 'background' | 'toggles' | null = null;





  private _tintColorArray: [number, number, number] = [1.0, 1.0, 1.0];










  private _toggleBaseStrength: number = 0.5;
  private _toggleCornerRadius: number = 18.0;















  private _toggleRegions: Map<Clutter.Actor, {
    baseColor: [number, number, number];











    baseAlpha: number;
    styledSubs: { actor: Clutter.Actor; origStyle: string }[];









    stateKey: string;
  }> = new Map();
  private _toggleColorTimerId: number = 0;




  private _resamplePassCount: number = 0;






  private _lastGoodRegions: {
    regions: { x: number; y: number; w: number; h: number; tintR: number; tintG: number; tintB: number; baseStrength: number }[];
    minX: number; minY: number; maxX: number; maxY: number;
  } | null = null;
  private _regionGraceFrames: number = 0;





  private _debugToggleColorLogFrames: number = 15;

  constructor(extensionPath: string, settings: Gio.Settings, logger: Logger) {
    this.extensionPath = extensionPath;
    this._settings = settings;
    this._logger = logger;


    this.targetActor = Main.panel.statusArea.quickSettings.menu.actor;
    this.menu = Main.panel.statusArea.quickSettings.menu;

    this.animActor = Main.panel.statusArea.quickSettings.menu.box;

    this.bgActor = null;
    this.effect = null;

    this._signals = [];
    this._frameSyncId = 0;
    this._isEffectActive = false;
    this._hasAutoRefreshed = false;

    this._glassExpand = 0;
    this._menuXoffset = 0;
    this._menuYoffset = 0;



    this._springScale = new Spring(120, 8, 1.0);
    this._springPos = new Spring(300, 12, 1.0);
    this._springStiffness = 120;
    this._springDamping = 8;
    this._springMass = 1.0;
    this._enableAnimation = true;
    this._tickId = 0;

    this._contrastSampler = new StageContrastSampler();
    this._adaptiveTimerId = 0;
    this._adaptiveInFlight = false;
    this._styledActors = new Map();

    this._settingsSignals = [];

    this.buttonAlpha = 0.8;
    this._buttonTimerId = 0;
    this._styledButtons = new Map();
    this._buttonSignalIds = new Map();

    this._enableSubmenuFix = true;
  }

  setup() {
    if (!this._settings) return;
    this._bindSettings();


    this._enableAnimation = this._settings.get_boolean('enable-quick-settings-animation');
    this._springStiffness = this._settings.get_double('quick-settings-spring-stiffness');
    this._springDamping = this._settings.get_double('quick-settings-spring-damping');
    this._springMass = this._settings.get_double('quick-settings-spring-mass');
    this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    this._springPos.updateParams(this._springStiffness, this._springDamping, this._springMass);


    this._applyTo = this._settings.get_int('quick-settings-apply-to') === 1 ? 'toggles' : 'background';
    this._toggleBaseStrength = this._settings.get_double('quick-settings-toggle-tint-strength');
    this._toggleCornerRadius = this._settings.get_double('quick-settings-toggle-corner-radius');

    if (this._settings.get_boolean('enable-quick-settings-glass')) {
      this._applyEffect();
    }
  }


  _hexToColorArray(hex: string): [number, number, number] {
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7)
      return [1.0, 1.0, 1.0];
    let r = parseInt(hex.slice(1, 3), 16) / 255.0;
    let g = parseInt(hex.slice(3, 5), 16) / 255.0;
    let b = parseInt(hex.slice(5, 7), 16) / 255.0;
    return [r, g, b];
  }

  _getMenuMonitorGeometry() {
    return resolveMonitorGeometry([this.menu?.sourceActor, this.targetActor]);
  }


  _applyMenuOffsets() {
    if (!this.targetActor) return;
    this.targetActor.translation_y = this._menuYoffset;
    this.targetActor.translation_x = this._menuXoffset;
  }


  _bindSettings() {
    const connectSetting = (key: string, callback: Function) => {
      let id = this._settings.connect(`changed::${key}`, callback.bind(this));
      this._settingsSignals.push(id);
    };


    connectSetting('enable-quick-settings-glass', () => {
      let enabled = this._settings.get_boolean('enable-quick-settings-glass');
      if (enabled && !this._isEffectActive) this._applyEffect();
      else if (!enabled && this._isEffectActive) this._removeEffect();
    });

    connectSetting('enable-quick-settings-animation', () => {
      this._enableAnimation = this._settings.get_boolean('enable-quick-settings-animation');
    });

    connectSetting('quick-settings-spring-stiffness', () => {
      this._springStiffness = this._settings.get_double('quick-settings-spring-stiffness');
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting('quick-settings-spring-damping', () => {
      this._springDamping = this._settings.get_double('quick-settings-spring-damping');
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting('quick-settings-spring-mass', () => {
      this._springMass = this._settings.get_double('quick-settings-spring-mass');
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting('quick-settings-animation-interval-ms', () => {
      this._animationInterval = this._settings.get_int('quick-settings-animation-interval-ms');
    });

    connectSetting('quick-settings-tint-color', () => {




      this._tintColorArray = this._hexToColorArray(this._settings.get_string('quick-settings-tint-color'));
      if (this.effect) {
        this.effect.setTintColor(...this._tintColorArray);
      }
    });

    connectSetting('quick-settings-tint-strength', () => {
      if (this.effect) {
        this.effect.setTintStrength(this._settings.get_double('quick-settings-tint-strength'));
      }
    });

    connectSetting('quick-settings-blur-radius', () => {
      if (this.effect) {
        this.effect.setBlurRadius(this._settings.get_int('quick-settings-blur-radius'));
      }
    });

    connectSetting('quick-settings-corner-radius', () => {
      this._cornerRadius = this._settings.get_double('quick-settings-corner-radius');



      if (this.effect && this._activeMode === 'background') {
        this.effect.setCornerRadius(this._cornerRadius);
      }
    });






    connectSetting('quick-settings-apply-to', () => {
      const newMode: 'background' | 'toggles' =
        this._settings.get_int('quick-settings-apply-to') === 1 ? 'toggles' : 'background';
      this._applyTo = newMode;

      if (this._isEffectActive && this._activeMode !== null && this._activeMode !== newMode) {
        this._removeEffect();
        this._applyEffect();
      }
    });

    connectSetting('quick-settings-toggle-tint-strength', () => {
      this._toggleBaseStrength = this._settings.get_double('quick-settings-toggle-tint-strength');
    });

    connectSetting('quick-settings-toggle-corner-radius', () => {
      this._toggleCornerRadius = this._settings.get_double('quick-settings-toggle-corner-radius');
      if (this.effect && this._activeMode === 'toggles') {
        this.effect.setCornerRadius(this._toggleCornerRadius);
      }
    });

    connectSetting('quick-settings-glass-expand', () => {
      if (this.effect) {
        this._glassExpand = this._settings.get_int('quick-settings-glass-expand');
      }
    });

    connectSetting('quick-settings-y-offset', () => {
      if (this.targetActor) {
        this._menuYoffset = this._settings.get_int('quick-settings-y-offset');
        this._applyMenuOffsets();
      }
    });

    connectSetting('quick-settings-x-offset', () => {
      if (this.targetActor) {
        this._menuXoffset = this._settings.get_int('quick-settings-x-offset');
        this._applyMenuOffsets();
      }
    });

    connectSetting('quick-settings-enable-adaptive-text-color', () => {
      this._adaptiveConfig.enabled = this._settings.get_boolean('quick-settings-enable-adaptive-text-color');
    });

    connectSetting('quick-settings-sample-interval-ms', () => {
      this._adaptiveConfig.sampleIntervalMs = this._settings.get_int('quick-settings-sample-interval-ms');
    });


    connectSetting('quick-settings-brightness', () => {
      if (this.effect) {
        this.effect.setBrightness(this._settings.get_double('quick-settings-brightness'));
      }
    });

    connectSetting('quick-settings-saturation', () => {
      if (this.effect) {
        this.effect.setSaturation(this._settings.get_double('quick-settings-saturation'));
      }
    });

    connectSetting('quick-settings-contrast', () => {
      if (this.effect) {
        this.effect.setContrast(this._settings.get_double('quick-settings-contrast'));
      }
    });
  }

  _applyClassStyles() {
    if (!this.targetActor) return;
    if (!this._hasStyleClass(this.targetActor, 'liquid-glass-transparent'))
      this.targetActor.add_style_class_name('liquid-glass-transparent');
    if (!this._hasStyleClass(this.animActor, 'liquid-glass-transparent'))
      this.animActor.add_style_class_name('liquid-glass-transparent');
    if (!this._hasStyleClass(this.animActor, 'liquid-glass-qs-root'))
      this.animActor.add_style_class_name('liquid-glass-qs-root');
  }






  _applyEffect() {
    if (this._isEffectActive) return;
    this._isEffectActive = true;

    if (!this.targetActor) return;

    this._activeMode = this._applyTo;
    this._tintColorArray = this._hexToColorArray(this._settings.get_string('quick-settings-tint-color'));

    if (this._activeMode === 'toggles') {
      this._applyToggleEffect();
    } else {
      this._applyBackgroundEffect();
    }
  }


  _applyBackgroundEffect() {

    this._menuYoffset = this._settings.get_int('quick-settings-y-offset');
    this._menuXoffset = this._settings.get_int('quick-settings-x-offset');
    this._glassExpand = this._settings.get_int('quick-settings-glass-expand');
    this._animationInterval = this._settings.get_int('quick-settings-animation-interval-ms');

    this._adaptiveConfig = {
      ...AdaptiveContrastConfig,
      enabled: this._settings.get_boolean('quick-settings-enable-adaptive-text-color'),
      samplePerElement: SAMPLE_PER_ELEMENT,
      sampleIntervalMs: this._settings.get_int('quick-settings-sample-interval-ms'),
    };



    this.bgActor = new UnpickableActor();
    this.bgActor.set_name('liquid-glass-bg-actor');


    this.bgActor.set_size(1.0, 1.0);
    this.bgActor.set_pivot_point(0.0, 0.0);


    this.liquidBox = new UnpickableActor();
    this.liquidBox.set_name('liquid-box');
    this.liquidBox.set_clip_to_allocation(true);
    this.bgActor.add_child(this.liquidBox);


    let dummyBreaker = new UnpickableActor();
    dummyBreaker.set_name('optimization-breaker');
    dummyBreaker.set_size(1.0, 1.0);
    dummyBreaker.set_opacity(0);
    this.liquidBox.add_child(dummyBreaker);


    this._cloneContainer = new UnpickableActor();
    this._cloneContainer.set_name('clone-container');
    this.liquidBox.add_child(this._cloneContainer);



    this.animActor.set_pivot_point(0.5, 0.0);

    this.bgActor.set_pivot_point(0.0, 0.0);


    let menuRoot: Clutter.Actor = this.menu.actor;
    while (menuRoot.get_parent() && menuRoot.get_parent() !== Main.layoutManager.uiGroup) {
      const p = menuRoot.get_parent();
      if (!p) break;
      menuRoot = p;
    }



    if (menuRoot.get_parent() === Main.layoutManager.uiGroup) {
      Main.layoutManager.uiGroup.insert_child_below(this.bgActor, menuRoot);
    } else {

      Main.layoutManager.uiGroup.add_child(this.bgActor);
    }


    let blurRadius = this._settings.get_int('quick-settings-blur-radius');
    let tintColorStr = this._settings.get_string('quick-settings-tint-color');
    let tintStrength = this._settings.get_double('quick-settings-tint-strength');
    this._cornerRadius = this._settings.get_double('quick-settings-corner-radius');
    let brightness = this._settings.get_double('quick-settings-brightness');
    let saturation = this._settings.get_double('quick-settings-saturation');
    let contrast = this._settings.get_double('quick-settings-contrast');



    this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, owner: 'quick-settings' } as any);

    this.effect.setPadding(SHADER_PADDING);
    this.effect.setTintColor(...this._hexToColorArray(tintColorStr));
    this.effect.setTintStrength(tintStrength);
    this.effect.setCornerRadius(this._cornerRadius);
    this.effect.setIsDock(false);
    this.effect.setBrightness(brightness);
    this.effect.setSaturation(saturation);
    this.effect.setContrast(contrast);
    this.effect.setBlurRadius(blurRadius);
    this.liquidBox.add_effect(this.effect);


    this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-qs');
    this._uiSampler = new UILayerSampler(
      this.bgActor,
      this.liquidBox,
      [menuRoot, global.windowGroup, global.window_group],
      this._cloneContainer,
      'quick-settings'
    );

    this.bgActor.hide();


    const laterAdd = (laterType: Meta.LaterType, callback: GLib.SourceFunc) => {
      return global.compositor?.get_laters?.().add(laterType, callback);
    };
    const laterRemove = (id: number) => {
      if (!id) return;
      if (global.compositor?.get_laters) global.compositor.get_laters().remove(id);
    };

    const frameLaterType = Meta.LaterType.BEFORE_REDRAW;


    let buildClones = () => {
      if (!this.bgActor) return;

      if (this._uiSampler) {
        for (let child of Main.layoutManager.uiGroup.get_children()) {
          if (child === this.bgActor) continue;
          let isLiquidBg = child.get_name?.() === 'liquid-glass-bg-actor' ||
            (typeof child.get_children === 'function' &&
              child.get_children().some((c: Clutter.Actor) => c.get_name?.() === 'liquid-box'));
          if (isLiquidBg) this._uiSampler!.addExclusion(child);
        }
      }

      this._windowCloneManager?.rebuildClones();
      this._uiSampler?.rebindSelf();
      this._uiSampler?.refresh();
    };





    let frameTick = () => {
      this._frameSyncId = 0;









      if (this._torndown) return GLib.SOURCE_REMOVE;
      if (!this.bgActor || !this.targetActor.mapped) {
        if (this.bgActor && this.bgActor.visible) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
        }
        return GLib.SOURCE_REMOVE;
      }



      if (isFrameSyncFrozen()) {
        this._frameSyncId = laterAdd(frameLaterType, frameTick);
        return GLib.SOURCE_REMOVE;
      }





      ensureGlassAllocated(this.bgActor);
      try {
        this._syncGeometry();
      } catch (e) {
        reportFrameLoopError('QuickSettingsManager', e);
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

    let stopFrameSync = () => {
      if (this._frameSyncId !== 0) {
        laterRemove(this._frameSyncId);
        this._frameSyncId = 0;
      }
    };

    if (this._hasAutoRefreshed === undefined) this._hasAutoRefreshed = false;
    this._signals = [];


    this._animSignalId = this.menu.connect('open-state-changed', (menu, isOpen: boolean) => {
      if (isOpen) {
        this._cachedSubmenus = null;
        if (!this._hasAutoRefreshed) this._hasAutoRefreshed = true;

        this._applyClassStyles();
        this._applyMenuOffsets();

        this._stableBaseW = undefined;
        this._stableBaseH = undefined;
        startFrameSync();

        this._startAdaptiveColorSampling(true);
        this._startButtonAlphaSampling();
        this._startAnimation(1);
        return;
      }

      this._applyClassStyles();
      this._applyMenuOffsets();
      this._stopAdaptiveColorSampling();
      this._stopButtonAlphaSampling();
      this._startAnimation(0);
    });



    this._signals.push({
      target: this.menu.actor,
      id: this.menu.actor.connect('notify::mapped', () => {

        if (!this.menu.actor.mapped) {

          stopFrameSync();


          if (this.bgActor) {
            this.bgActor.hide();
            this.bgActor.opacity = 0;
          }
          if (this.animActor) {
            this.animActor.opacity = 0;
          }
        }
      })
    });

    if (Main.layoutManager) {
      this._signals.push({
        target: Main.layoutManager,
        id: Main.layoutManager.connect('monitors-changed', () => {
          this._lastScreenW = 0;
          this._lastScreenH = 0;
          this._lastBgX = null;
          this._lastBgY = null;
          this._windowCloneManager?.rebuildClones();
          this._uiSampler?.rebindSelf();
          this._uiSampler?.refresh();
        }),
      });
    }

    this._updateResolution();
    if (this.targetActor.mapped) {
      startFrameSync();
    }
  }









  _applyToggleEffect() {
    if (!this.targetActor) return;






    this._debugToggleColorLogFrames = 15;
    this._lastGoodRegions = null;
    this._regionGraceFrames = 0;

    this._glassExpand = this._settings.get_int('quick-settings-glass-expand');
    this._toggleBaseStrength = this._settings.get_double('quick-settings-toggle-tint-strength');
    this._toggleCornerRadius = this._settings.get_double('quick-settings-toggle-corner-radius');

    this._adaptiveConfig = {
      ...AdaptiveContrastConfig,
      enabled: this._settings.get_boolean('quick-settings-enable-adaptive-text-color'),
      samplePerElement: SAMPLE_PER_ELEMENT,
      sampleIntervalMs: this._settings.get_int('quick-settings-sample-interval-ms'),
    };


    this.bgActor = new UnpickableActor();
    this.bgActor.set_name('liquid-glass-bg-actor');
    this.bgActor.set_size(1.0, 1.0);
    this.bgActor.set_pivot_point(0.0, 0.0);


    this.liquidBox = new UnpickableActor();
    this.liquidBox.set_name('liquid-box');
    this.liquidBox.set_clip_to_allocation(true);
    this.bgActor.add_child(this.liquidBox);


    let dummyBreaker = new UnpickableActor();
    dummyBreaker.set_name('optimization-breaker');
    dummyBreaker.set_size(1.0, 1.0);
    dummyBreaker.set_opacity(0);
    this.liquidBox.add_child(dummyBreaker);


    this._cloneContainer = new UnpickableActor();
    this._cloneContainer.set_name('clone-container');
    this.liquidBox.add_child(this._cloneContainer);

    this.bgActor.set_pivot_point(0.0, 0.0);


    let menuRoot: Clutter.Actor = this.menu.actor;
    while (menuRoot.get_parent() && menuRoot.get_parent() !== Main.layoutManager.uiGroup) {
      const p = menuRoot.get_parent();
      if (!p) break;
      menuRoot = p;
    }
    this._menuRoot = menuRoot;



































    if (!this._toggleGlassHost) {
      this._toggleGlassHost = new LayoutOpaqueActor();
      this._toggleGlassHost.set_name('liquid-glass-toggle-host');
    }
    if (this.bgActor.get_parent() !== this._toggleGlassHost) {
      this.bgActor.get_parent()?.remove_child(this.bgActor);
      this._toggleGlassHost.add_child(this.bgActor);
    }







    if (this.animActor instanceof Clutter.Actor) {
      this.animActor.insert_child_at_index(this._toggleGlassHost, 0);
    } else if (menuRoot.get_parent() === Main.layoutManager.uiGroup) {
      Main.layoutManager.uiGroup.insert_child_above(this._toggleGlassHost, menuRoot);
    } else {
      Main.layoutManager.uiGroup.add_child(this._toggleGlassHost);
    }


    let blurRadius = this._settings.get_int('quick-settings-blur-radius');
    let tintStrength = this._settings.get_double('quick-settings-tint-strength');
    let brightness = this._settings.get_double('quick-settings-brightness');
    let saturation = this._settings.get_double('quick-settings-saturation');
    let contrast = this._settings.get_double('quick-settings-contrast');

    this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, owner: 'quick-settings-toggles' } as any);
    this.effect.setPadding(SHADER_PADDING);




    this._tintColorArray = this._hexToColorArray(this._settings.get_string('quick-settings-tint-color'));
    this.effect.setTintColor(...this._tintColorArray);
    this.effect.setTintStrength(tintStrength);
    this.effect.setCornerRadius(this._toggleCornerRadius);
    this.effect.setIsDock(false);
    this.effect.setBrightness(brightness);
    this.effect.setSaturation(saturation);
    this.effect.setContrast(contrast);
    this.effect.setBlurRadius(blurRadius);
    this.effect.setMultiRegionMode(true);
    this.liquidBox.add_effect(this.effect);


    this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-qs-toggles');
    this._uiSampler = new UILayerSampler(
      this.bgActor,
      this.liquidBox,
      [menuRoot, global.windowGroup, global.window_group],
      this._cloneContainer,
      'quick-settings-toggles'
    );

    this.bgActor.hide();

    const laterAdd = (laterType: Meta.LaterType, callback: GLib.SourceFunc) => {
      return global.compositor?.get_laters?.().add(laterType, callback);
    };
    const laterRemove = (id: number) => {
      if (!id) return;
      if (global.compositor?.get_laters) global.compositor.get_laters().remove(id);
    };
    const frameLaterType = Meta.LaterType.BEFORE_REDRAW;

    let buildClones = () => {
      if (!this.bgActor) return;

      if (this._uiSampler) {
        for (let child of Main.layoutManager.uiGroup.get_children()) {
          if (child === this.bgActor) continue;
          let isLiquidBg = child.get_name?.() === 'liquid-glass-bg-actor' ||
            (typeof child.get_children === 'function' &&
              child.get_children().some((c: Clutter.Actor) => c.get_name?.() === 'liquid-box'));
          if (isLiquidBg) this._uiSampler!.addExclusion(child);
        }
      }

      this._windowCloneManager?.rebuildClones();
      this._uiSampler?.rebindSelf();
      this._uiSampler?.refresh();
    };


    let frameTick = () => {
      this._frameSyncId = 0;









      if (this._torndown) return GLib.SOURCE_REMOVE;
      if (!this.bgActor || !this.targetActor.mapped) {
        if (this.bgActor && this.bgActor.visible) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
        }
        return GLib.SOURCE_REMOVE;
      }





      ensureGlassAllocated(this.bgActor);
      try {
        this._syncToggleRegions();
      } catch (e) {
        reportFrameLoopError('QuickSettingsManager(toggles)', e);
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

    let stopFrameSync = () => {
      if (this._frameSyncId !== 0) {
        laterRemove(this._frameSyncId);
        this._frameSyncId = 0;
      }
    };

    this._signals = [];






    this._animSignalId = this.menu.connect('open-state-changed', (menu, isOpen: boolean) => {
      if (isOpen) {
        this._cachedSubmenus = null;
        startFrameSync();
        this._startAdaptiveColorSampling(true);
        this._startToggleColorSampling();
        return;
      }

      this._stopAdaptiveColorSampling();
      this._stopToggleColorSampling();
    });

    this._signals.push({
      target: this.menu.actor,
      id: this.menu.actor.connect('notify::mapped', () => {
        if (!this.menu.actor.mapped) {
          stopFrameSync();
          if (this.bgActor) {
            this.bgActor.hide();
            this.bgActor.opacity = 0;
          }
        }
      })
    });

    if (Main.layoutManager) {
      this._signals.push({
        target: Main.layoutManager,
        id: Main.layoutManager.connect('monitors-changed', () => {
          this._lastScreenW = 0;
          this._lastScreenH = 0;
          this._lastBgX = null;
          this._lastBgY = null;
          this._windowCloneManager?.rebuildClones();
          this._uiSampler?.rebindSelf();
          this._uiSampler?.refresh();
        }),
      });
    }

    this._updateResolution();
    if (this.targetActor.mapped) {
      startFrameSync();
    }
  }




























































  _findAllToggleContainers(
    actor: Clutter.Actor,
    found: Clutter.Actor[] = [],
    inSystemItem: boolean = false
  ): Clutter.Actor[] {
    if (!actor) return found;

    let isHasMenuPod = actor instanceof St.Widget && actor.has_style_class_name('quick-toggle-has-menu');
    if (isHasMenuPod) {
      if (actor.visible) found.push(actor);
      return found;
    }

    let isToggle = actor instanceof St.Widget && actor.has_style_class_name('quick-toggle');
    if (isToggle) {
      if (actor.visible) found.push(actor);
      return found;
    }


    if (inSystemItem && actor instanceof St.Widget && actor.has_style_class_name('icon-button')) {
      if (actor.visible) found.push(actor);
      return found;
    }


    if (actor instanceof St.Widget && actor.has_style_class_name('quick-slider')) {
      if (actor.visible && this._paintsOwnBackground(actor)) found.push(actor);
      return found;
    }

    let entersSystemItem = inSystemItem ||
      (actor instanceof St.Widget && actor.has_style_class_name('quick-settings-system-item'));

    let children = typeof actor.get_children === 'function' ? actor.get_children() : [];
    for (let child of children) this._findAllToggleContainers(child, found, entersSystemItem);
    return found;
  }




















  _paintsOwnBackground(actor: Clutter.Actor): boolean {
    if (this._toggleRegions.has(actor)) return true;
    let bg = this._readThemeBg(actor);
    return !!(bg && bg.a > 0.02);
  }

















  _getStylableSubActors(pod: Clutter.Actor): Clutter.Actor[] {
    const found: Clutter.Actor[] = [];
    const walk = (actor: Clutter.Actor) => {
      if (actor instanceof St.Widget) found.push(actor);
      let children = typeof (actor as any).get_children === 'function' ? (actor as any).get_children() : [];
      for (let child of children) walk(child);
    };
    walk(pod);
    return found;
  }



















  _getPrimaryToggleButton(pod: Clutter.Actor): Clutter.Actor {
    if (pod instanceof St.Widget && pod.has_style_class_name('quick-toggle-has-menu')) {
      let found: Clutter.Actor | null = null;
      const search = (actor: Clutter.Actor) => {
        if (found) return;
        let children = typeof (actor as any).get_children === 'function' ? (actor as any).get_children() : [];
        for (let child of children) {
          if (found) return;
          if (child instanceof St.Widget && child.has_style_class_name('quick-toggle')) {
            found = child;
            return;
          }
          search(child);
        }
      };
      search(pod);
      if (found) return found;
    }
    return pod;
  }




  _getToggleIconActors(root: Clutter.Actor): Clutter.Actor[] {
    const found: Clutter.Actor[] = [];
    const walk = (actor: Clutter.Actor) => {
      if (actor instanceof St.Widget && actor.has_style_class_name('quick-toggle-icon')) {
        found.push(actor);
      }
      let children = typeof (actor as any).get_children === 'function' ? (actor as any).get_children() : [];
      for (let child of children) walk(child);
    };
    if (root) walk(root);
    return found;
  }













  _readThemeBg(actor: Clutter.Actor | null): { r: number; g: number; b: number; a: number } | null {
    if (!(actor instanceof St.Widget)) return null;
    actor.ensure_style();
    let themeNode = actor.get_theme_node();
    if (!themeNode) return null;

    let bg = themeNode.get_background_color();
    if (bg && bg.alpha / 255 > 0.02)
      return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };

    try {
      let [gradType, start, end] = themeNode.get_background_gradient();
      if (gradType !== St.GradientType.NONE && start && end) {
        let a = ((start.alpha + end.alpha) / 2) / 255;
        if (a > 0.02) {
          return {
            r: ((start.red + end.red) / 2) / 255,
            g: ((start.green + end.green) / 2) / 255,
            b: ((start.blue + end.blue) / 2) / 255,
            a,
          };
        }
      }
    } catch (e) {


    }

    if (!bg) return null;
    return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };
  }
















  // Returns the composited color plus `a` — the accumulated coverage, which


  _compositeOverAncestors(
    actor: Clutter.Actor | null,
    own: { r: number; g: number; b: number; a: number } | null
  ): { r: number; g: number; b: number; a: number } {


    let outR = 0, outG = 0, outB = 0, outA = 0;

    const add = (c: { r: number; g: number; b: number; a: number } | null) => {
      if (!c || !(c.a > 0)) return;
      let w = c.a * (1 - outA);
      outR += c.r * w;
      outG += c.g * w;
      outB += c.b * w;
      outA += w;
    };

    add(own);

    let node: Clutter.Actor | null = actor ? actor.get_parent() : null;



    let guard = 32;
    while (node && outA < 0.995 && guard-- > 0) {
      if (node instanceof St.Widget) add(this._readThemeBg(node));
      node = node.get_parent();
    }

    if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    // Un-premultiply so callers get a plain color plus a coverage figure.
    return { r: outR / outA, g: outG / outA, b: outB / outA, a: outA };
  }




































  // [FIX-8] `a` is now simply the composited coverage — "how much real paint






  _samplePodColor(pod: Clutter.Actor, primary: Clutter.Actor): { r: number; g: number; b: number; a: number } {
    let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name('quick-toggle-has-menu');

    let candidates: Clutter.Actor[] = [primary];
    if (isHasMenu && pod !== primary) candidates.push(pod);























    for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod)) {
      if (icon !== primary && icon !== pod) candidates.push(icon);
    }

    let bestActor: Clutter.Actor | null = null;
    let bestOwn: { r: number; g: number; b: number; a: number } | null = null;
    for (let candidate of candidates) {
      let own = this._readThemeBg(candidate);
      if (!own) continue;
      if (!bestOwn || own.a > bestOwn.a) {
        bestOwn = own;
        bestActor = candidate;
      }
    }

    if (bestOwn && bestOwn.a > 0.02) {
      return this._compositeOverAncestors(bestActor, bestOwn);
    }




    // accumulated coverage as its alpha.
    return this._compositeOverAncestors(pod, null);
  }





















  _ensureToggleStyles(toggles: Clutter.Actor[]) {
    const OVERRIDE = 'background-color: transparent !important;';

    for (let pod of toggles) {
      if (!(pod instanceof St.Widget)) continue;

      let entry = this._toggleRegions.get(pod);
      if (!entry) {

        // never manages to sample a real color falls through to the


        entry = { baseColor: [1.0, 1.0, 1.0], baseAlpha: 0, styledSubs: [], stateKey: '' };
        this._toggleRegions.set(pod, entry);
        pod.connect('destroy', () => {
          this._toggleRegions.delete(pod);
        });
      }

      let primary = this._getPrimaryToggleButton(pod);
      if (primary instanceof St.Widget) {





        let curStyle = typeof primary.get_style === 'function' ? primary.get_style() : null;
        if (!curStyle || !curStyle.includes(OVERRIDE)) {
          let sampled = this._samplePodColor(pod, primary);





          if (sampled.a > 0.02) {
            entry.baseColor = [sampled.r, sampled.g, sampled.b];
            entry.baseAlpha = sampled.a;
          }
        }
      }

      let known = new Set(entry.styledSubs.map(s => s.actor));
      for (let sub of this._getStylableSubActors(pod)) {
        if (!(sub instanceof St.Widget)) continue;

        let style = typeof sub.get_style === 'function' ? sub.get_style() : null;
        if (style && style.includes(OVERRIDE)) continue;

        let origStyle = style || '';
        let newStyle = origStyle ? `${origStyle} ${OVERRIDE}` : OVERRIDE;
        sub.set_style(newStyle);

        if (!known.has(sub)) entry.styledSubs.push({ actor: sub, origStyle });
      }
    }
  }



















  _resampleToggleColors() {

    let forceFull = (this._resamplePassCount++ % QuickSettingsManager.TOGGLE_COLOR_FULL_PASS_EVERY) === 0;

    for (const [pod, entry] of this._toggleRegions.entries()) {
      if (!pod) continue;

      let primary = this._getPrimaryToggleButton(pod);




      let stateKey = this._podStateKey(pod, primary);
      if (!forceFull && stateKey === entry.stateKey) continue;
      entry.stateKey = stateKey;



      for (const { actor, origStyle } of entry.styledSubs) {
        if (actor instanceof St.Widget) actor.set_style(origStyle || null);
      }




























      if (pod instanceof St.Widget && pod.has_style_class_name('quick-slider')) {
        let pill = this._readThemeBg(pod);
        if (!(pill && pill.a > 0.02)) {
          this._logger.log(
            `[Liquid Glass][toggle-color] releasing .quick-slider pod — theme no longer paints a pill ` +
            `(bg=${JSON.stringify(pill)})`
          );
          this._toggleRegions.delete(pod);
          continue;
        }
      }

      if (primary instanceof St.Widget) {
        let sampled = this._samplePodColor(pod, primary);
        if (sampled.a > 0.02) {
          entry.baseColor = [sampled.r, sampled.g, sampled.b];
          entry.baseAlpha = sampled.a;
        }

        if (this._debugToggleColorLogFrames > 0) {
          let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name('quick-toggle-has-menu');
          let podCls = pod instanceof St.Widget && typeof pod.get_style_class_name === 'function' ? (pod.get_style_class_name() || '') : '';
          let primaryCls = typeof primary.get_style_class_name === 'function' ? (primary.get_style_class_name() || '') : '';
          let checked = typeof (primary as any).has_style_pseudo_class === 'function' ? (primary as any).has_style_pseudo_class('checked') : 'n/a';





          let wrapperBg = isHasMenu ? this._readThemeBg(pod) : null;




          let iconBgs = this._getToggleIconActors(pod !== primary ? primary : pod)
            .map(a => JSON.stringify(this._readThemeBg(a))).join(' ');
          this._logger.log(
            `[Liquid Glass][toggle-color] pod class="${podCls}" isHasMenu=${isHasMenu} ` +
            `primary class="${primaryCls}" checked=${checked} ` +
            `primaryBg=${JSON.stringify(this._readThemeBg(primary))} ` +
            `wrapperBg=${wrapperBg ? JSON.stringify(wrapperBg) : 'n/a'} ` +
            `iconBg=[${iconBgs || 'none'}] ` +
            `chosen.a=${sampled.a.toFixed(2)} trusted=${sampled.a > 0.02} ` +
            `entry.baseColor=[${entry.baseColor.map(v => v.toFixed(2)).join(',')}] entry.baseAlpha=${entry.baseAlpha.toFixed(2)}`
          );
        }
      }

      for (const { actor, origStyle } of entry.styledSubs) {
        if (!(actor instanceof St.Widget)) continue;
        let newStyle = origStyle
          ? `${origStyle} background-color: transparent !important;`
          : `background-color: transparent !important;`;
        actor.set_style(newStyle);
      }
    }
    if (this._debugToggleColorLogFrames > 0) this._debugToggleColorLogFrames--;
  }

  _startToggleColorSampling() {
    this._resampleToggleColors();
    if (this._toggleColorTimerId !== 0) return;

    this._toggleColorTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT, QuickSettingsManager.TOGGLE_COLOR_SAMPLE_MS, () => {
      if (!this.menu?.isOpen) {
        this._toggleColorTimerId = 0;
        return GLib.SOURCE_REMOVE;
      }
      this._resampleToggleColors();
      return GLib.SOURCE_CONTINUE;
    });
  }





  _podStateKey(pod: Clutter.Actor, primary: Clutter.Actor): string {
    const STATES = ['checked', 'hover', 'active', 'insensitive', 'focus', 'selected'];

    let actors: Clutter.Actor[] = [pod];
    if (primary !== pod) actors.push(primary);
    for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod)) actors.push(icon);

    let key = '';
    for (let actor of actors) {
      if (!(actor instanceof St.Widget) || typeof (actor as any).has_style_pseudo_class !== 'function') {
        key += '?|';
        continue;
      }
      for (let state of STATES) {
        key += (actor as any).has_style_pseudo_class(state) ? '1' : '0';
      }
      key += '|';
    }
    return key;
  }

  _stopToggleColorSampling() {
    if (this._toggleColorTimerId !== 0) {
      GLib.source_remove(this._toggleColorTimerId);
      this._toggleColorTimerId = 0;
    }
  }



  _clearToggleStyles() {
    this._stopToggleColorSampling();
    for (const [, entry] of this._toggleRegions.entries()) {
      for (const { actor, origStyle } of entry.styledSubs) {
        if (actor instanceof St.Widget && typeof actor.set_style === 'function') {
          try { actor.set_style(origStyle || null); } catch (e) { }
        }
      }
    }
    this._toggleRegions.clear();
    this._destroyPanelContentClone();
  }











































  private _panelActorWarned: boolean = false;
















  _resolvePanelActor(): Clutter.Actor | null {
    const candidates: (Clutter.Actor | null)[] = [this._menuRoot, this.targetActor, this.animActor];
    for (const actor of candidates) {
      if (!actor || !isActorValid(actor)) continue;
      let [w, h] = actor.get_size();
      let [x, y] = actor.get_transformed_position();
      if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) return actor;
    }
    if (!this._panelActorWarned) {
      this._panelActorWarned = true;
      const describe = (a: Clutter.Actor | null) => {
        if (!a) return 'null';
        try {
          return `${(a as any).get_name?.() ?? '?'}/${a.constructor?.name} ` +
            `size=${a.get_size()} pos=${a.get_transformed_position()} ` +
            `mapped=${a.mapped} parent=${(a.get_parent() as any)?.get_name?.() ?? '?'}`;
        } catch (e) { return `(threw: ${e})`; }
      };
      this._logger.error(
        '[Liquid Glass][qs-panel-clone] no usable panel actor: ' +
        `menuRoot=[${describe(this._menuRoot)}] ` +
        `targetActor=[${describe(this.targetActor)}] ` +
        `animActor=[${describe(this.animActor)}]`
      );
    }
    return null;
  }


  _resolvePanelRect(): [number, number, number, number] | null {
    const actor = this._resolvePanelActor();
    if (!actor) return null;
    let [x, y] = actor.get_transformed_position();
    let [w, h] = actor.get_size();
    return [x, y, w, h];
  }

  _ensurePanelContentClone(monitorX: number, monitorY: number): void {
    const panelActor = this._resolvePanelActor();
    if (!panelActor) return;
    if (!this._cloneContainer) return;

    if (!this._panelContentClone || !isActorValid(this._panelContentClone) ||
      !this._panelContentClone.get_stage || !this._panelContentClone.get_stage()) {
      if (isActorValid(this._panelContentClone)) {
        try { this._panelContentClone.destroy(); } catch (e) { }
      }
      let material = new UnpickableStyledWidget();
      material.set_name('liquid-glass-panel-material');
      material.set_reactive(false);
      this._panelContentClone = material;
      this._panelContentClone.connect('destroy', () => { this._panelContentClone = null; });
      this._cloneContainer.add_child(this._panelContentClone);
    }



    let cls = (this.animActor instanceof St.Widget && typeof this.animActor.get_style_class_name === 'function')
      ? (this.animActor.get_style_class_name() || '')
      : '';
    if (this._panelContentClone.get_style_class_name() !== cls) {
      this._panelContentClone.set_style_class_name(cls);
    }












    this._cloneContainer.set_child_above_sibling(this._panelContentClone, null);

    let rect = this._resolvePanelRect();
    if (rect) {







      if (this._panelContentClone.x !== 0 || this._panelContentClone.y !== 0)
        this._panelContentClone.set_position(0, 0);
      this._panelContentClone.translation_x = rect[0] - monitorX;
      this._panelContentClone.translation_y = rect[1] - monitorY;
      this._panelContentClone.set_size(rect[2], rect[3]);
    }
  }

  _destroyPanelContentClone(): void {
    if (isActorValid(this._panelContentClone)) {
      try { this._panelContentClone.destroy(); } catch (e) { }
    }
    this._panelContentClone = null;
  }








  _getAccumulatedScale(actor: Clutter.Actor): [number, number] {
    let sx = 1.0;
    let sy = 1.0;
    let node: Clutter.Actor | null = actor;
    while (node) {
      let [nsx, nsy] = node.get_scale();
      if (Number.isFinite(nsx) && nsx !== 0) sx *= nsx;
      if (Number.isFinite(nsy) && nsy !== 0) sy *= nsy;
      node = node.get_parent();
    }
    return [sx || 1.0, sy || 1.0];
  }




  _canReuseLastRegions(): boolean {
    return this._lastGoodRegions !== null &&
      this._regionGraceFrames < QuickSettingsManager.REGION_GRACE_FRAMES;
  }





  _takeLastRegions() {
    if (!this._canReuseLastRegions()) {
      this._lastGoodRegions = null;
      return null;
    }
    this._regionGraceFrames++;
    return this._lastGoodRegions;
  }





  _syncToggleRegions() {
    if (!this.bgActor || !this.targetActor || !this.targetActor.mapped) {
      if (this.bgActor && this.bgActor.visible) this.bgActor.hide();


      this._lastGoodRegions = null;
      this._regionGraceFrames = 0;
      return;
    }





    let monitor = this._getMenuMonitorGeometry();
    let monitorX = monitor?.x ?? 0;
    let monitorY = monitor?.y ?? 0;
    let screenW = Math.max(1, monitor?.width ?? 1);
    let screenH = Math.max(1, monitor?.height ?? 1);




















































    let bgPosX = monitorX;
    let bgPosY = monitorY;
    if (this.animActor instanceof Clutter.Actor && this._toggleGlassHost) {
      this.animActor.set_child_below_sibling(this._toggleGlassHost, null);

      let [hostAbsX, hostAbsY] = this._toggleGlassHost.get_transformed_position();
      let [accScaleX, accScaleY] = this._getAccumulatedScale(this._toggleGlassHost);

      if (Number.isFinite(hostAbsX) && Number.isFinite(hostAbsY)) {





        this.bgActor.set_scale(1.0 / accScaleX, 1.0 / accScaleY);
        bgPosX = (monitorX - hostAbsX) / accScaleX;
        bgPosY = (monitorY - hostAbsY) / accScaleY;
      }
    } else {
      Main.layoutManager.uiGroup.set_child_above_sibling(this.bgActor, null);
    }
    this.bgActor.set_position(bgPosX, bgPosY);

    let toggles = this._findAllToggleContainers(this.menu?.actor);
    this._ensureToggleStyles(toggles);

    this._ensurePanelContentClone(monitorX, monitorY);

    if (toggles.length === 0 && !this._canReuseLastRegions()) {
      this.bgActor.hide();
      return;
    }

    let regions: { x: number; y: number; w: number; h: number; tintR: number; tintG: number; tintB: number; baseStrength: number }[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let toggle of toggles) {
      if (!toggle.visible || !toggle.mapped) continue;














      let [absX, absY, w, h] = getTransformedRect(toggle);
      if (Number.isNaN(absX) || Number.isNaN(absY) || Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) continue;




      let regionX = (absX - monitorX) - this._glassExpand - SHADER_PADDING;
      let regionY = (absY - monitorY) - this._glassExpand - SHADER_PADDING;
      let regionW = w + (this._glassExpand * 2) + (SHADER_PADDING * 2);
      let regionH = h + (this._glassExpand * 2) + (SHADER_PADDING * 2);

      let entry = this._toggleRegions.get(toggle);
























      let hasBase = !!(entry && entry.baseAlpha > 0.02);
      let base = hasBase ? entry!.baseColor : this._tintColorArray;
      // [FIX-9] Weight the base layer by the pod's own COVERAGE.





      // opaque), so _compositeOverAncestors() always reaches coverage 1.0



      // see-through and the coverage stays at the pod's own alpha.













      // Multiplying the strength by the coverage restores the distinction





      let baseStrength = hasBase ? this._toggleBaseStrength * entry!.baseAlpha : 0.0;

      regions.push({
        x: regionX, y: regionY, w: regionW, h: regionH,
        tintR: base[0], tintG: base[1], tintB: base[2],
        baseStrength,
      });

      minX = Math.min(minX, regionX); minY = Math.min(minY, regionY);
      maxX = Math.max(maxX, regionX + regionW); maxY = Math.max(maxY, regionY + regionH);
    }












    if (regions.length === 0) {
      let reused = this._takeLastRegions();
      if (!reused) {
        this.bgActor.hide();
        return;
      }
      regions = reused.regions;
      minX = reused.minX; minY = reused.minY;
      maxX = reused.maxX; maxY = reused.maxY;
    } else {
      this._lastGoodRegions = { regions, minX, minY, maxX, maxY };
      this._regionGraceFrames = 0;
    }

    if (!this.bgActor.visible) this.bgActor.show();




























    // inside a region (`float alpha = insideMask;`), and global._lgGlass



    const TOGGLE_GLASS_OVERLAY_OPACITY = 1.0;
    let panelOpacity = this.targetActor.get_first_child()?.opacity ?? 255;
    this.bgActor.opacity = Math.round(panelOpacity * TOGGLE_GLASS_OVERLAY_OPACITY);

    this.effect?.setGlassRegions(regions);

    let bgW = maxX - minX;
    let bgH = maxY - minY;
    let localBgX = minX;
    let localBgY = minY;

    if (this._lastBgW !== bgW || this._lastBgH !== bgH ||
      this._lastBgX !== localBgX || this._lastBgY !== localBgY ||
      this._lastScreenW !== screenW || this._lastScreenH !== screenH) {

      this.bgActor.remove_transition('size');
      this.bgActor.remove_transition('position');




      this.bgActor.set_position(bgPosX, bgPosY);
      this.bgActor.set_size(screenW, screenH);
      this.bgActor.remove_transition('size');
      this.bgActor.remove_transition('position');

      this.liquidBox?.set_position(0, 0);
      this.liquidBox?.set_size(screenW, screenH);

      const CLIP_PADDING = 200;
      this.liquidBox?.remove_clip();

      setClipIfChanged(
        this.bgActor,
        localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
        bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
      );

      this.effect?.setResolution(screenW, screenH);

      this._lastBgW = bgW; this._lastBgH = bgH;
      this._lastBgX = localBgX; this._lastBgY = localBgY;
      this._lastScreenW = screenW; this._lastScreenH = screenH;
    }

    this._windowCloneManager?.setOffset(-monitorX, -monitorY);



    syncGlassCaptureClip({
      cloneContainer: this._cloneContainer,
      effect: this.effect,
      originX: monitorX,
      originY: monitorY,
      uiSampler: this._uiSampler,
      windowCloneManager: this._windowCloneManager,
    });
    this._uiSampler?.refresh();
    this._uiSampler?.sync(monitorX, monitorY, screenW, screenH);
    this._windowCloneManager?.sync();
  }





  _syncGeometry() {
    if (!this.bgActor || !this.targetActor || !this.targetActor.mapped) {
      if (this.bgActor && this.bgActor.visible) this.bgActor.hide();
      return;
    }
    if (!this.bgActor.visible) this.bgActor.show();

    if (!this._enableAnimation) {
      if (this.targetActor !== null)
        this.bgActor.opacity = this.targetActor.get_first_child()?.opacity ?? 255;
    }

    let [inW, inH] = this.animActor.get_size();
    let [outW, outH] = this.targetActor.get_size();

    inW = Number.isNaN(inW) || inW <= 0 ? (this._stableBaseW || 1) : inW;
    inH = Number.isNaN(inH) || inH <= 0 ? (this._stableBaseH || 1) : inH;

    let [scaleX, scaleY] = this.animActor.get_scale();

    if (!this._enableAnimation) {

      let gnomeAnimContainer = this.targetActor.get_first_child();
      if (gnomeAnimContainer) {
        scaleX *= gnomeAnimContainer.scale_x;
        scaleY *= gnomeAnimContainer.scale_y;
      }
    } else {
      scaleX *= this.targetActor.get_scale()[0];
      scaleY *= this.targetActor.get_scale()[1];
    }

    let themeNode = this.animActor.get_theme_node();
    let mL = themeNode ? themeNode.get_margin(St.Side.LEFT) : 0;
    let mR = themeNode ? themeNode.get_margin(St.Side.RIGHT) : 0;
    let mT = themeNode ? themeNode.get_margin(St.Side.TOP) : 0;
    let mB = themeNode ? themeNode.get_margin(St.Side.BOTTOM) : 0;
    let marginW = mL + mR;
    let marginH = mT + mB;

    let targetW = Math.round(inW);
    let targetH = Math.round(inH);



    if (Math.abs(inW - outW) <= 2 && marginW > 0) {
      targetW = Math.round(inW - marginW);
      targetH = Math.round(inH - marginH);
    }

    this._stableBaseW = targetW;
    this._stableBaseH = targetH;



    let w = Math.max(1, this._stableBaseW * scaleX);
    let h = Math.max(1, this._stableBaseH * scaleY);


    let [animAbsX, animAbsY] = this.animActor.get_transformed_position();






    if (Number.isNaN(animAbsX) || Number.isNaN(animAbsY)) {
      if (this._lastValidAnimAbsX !== undefined && this._lastValidAnimAbsY !== undefined) {

        animAbsX = this._lastValidAnimAbsX;
        animAbsY = this._lastValidAnimAbsY;
      } else {

        let monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
          animAbsX = (monitor.width / 2) - (w / 2);
          animAbsY = (Main.panel.height || 27) + (this._menuYoffset ?? 0);
        } else {
          animAbsX = 0;
          animAbsY = 0;
        }
      }
    } else {

      this._lastValidAnimAbsX = animAbsX;
      this._lastValidAnimAbsY = animAbsY;
    }



    let bgW = w + (this._glassExpand * 2) + (SHADER_PADDING * 2);
    let bgH = h + (this._glassExpand * 2) + (SHADER_PADDING * 2);


    let bgX = animAbsX - this._glassExpand - SHADER_PADDING;
    let bgY = animAbsY - this._glassExpand - SHADER_PADDING;

    if (!Number.isNaN(bgX) && !Number.isNaN(bgY) && w >= 1.0 && h >= 1.0) {

      let monitor = this._getMenuMonitorGeometry();
      let monitorX = monitor?.x ?? 0;
      let monitorY = monitor?.y ?? 0;
      let screenW = Math.max(1, monitor?.width ?? 1);
      let screenH = Math.max(1, monitor?.height ?? 1);


      let localBgX = bgX - monitorX;
      let localBgY = bgY - monitorY;



      if (this._lastBgW !== bgW || this._lastBgH !== bgH ||
        this._lastBgX !== bgX || this._lastBgY !== bgY ||
        this._lastScreenW !== screenW || this._lastScreenH !== screenH) {


        this.bgActor.remove_transition('size');
        this.bgActor.remove_transition('position');
        this.bgActor.set_position(monitorX, monitorY);
        this.bgActor.set_size(screenW, screenH);
        this.bgActor.remove_transition('size');
        this.bgActor.remove_transition('position');


        this.liquidBox?.set_position(0, 0);
        this.liquidBox?.set_size(screenW, screenH);


        const CLIP_PADDING = 200;
        this.liquidBox?.remove_clip();

        setClipIfChanged(
          this.bgActor,
          localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
          bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
        );

        const SHADOW_MAX_RADIUS = CLIP_PADDING - 20;
        this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);


        this.effect?.setResolution(screenW, screenH);
        this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);

        this._lastBgW = bgW; this._lastBgH = bgH;
        this._lastBgX = bgX; this._lastBgY = bgY;
        this._lastScreenW = screenW; this._lastScreenH = screenH;
      }


      this._windowCloneManager?.setOffset(-monitorX, -monitorY);

      syncGlassCaptureClip({
        cloneContainer: this._cloneContainer,
        effect: this.effect,
        originX: monitorX,
        originY: monitorY,
        uiSampler: this._uiSampler,
        windowCloneManager: this._windowCloneManager,
      });
      this._uiSampler?.refresh();
      this._uiSampler?.sync(monitorX, monitorY, screenW, screenH);
      this._windowCloneManager?.sync();
    }



    if (this.effect && typeof this.effect.setCornerRadius === 'function') {
      let currentScale = Math.min(scaleX, scaleY);
      this.effect.setCornerRadius(this._cornerRadius * currentScale);
      if (typeof this.effect.setAnimationScale === 'function') {
        this.effect.setAnimationScale(currentScale);
      }
    }

    this._adjustSubmenuPositions();
  }


  _updateResolution() {
    if (!this.bgActor || !this.effect) return;
    let [width, height] = this.bgActor.get_size();
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      this.effect.setResolution(width, height);
    }
  }


  _hasStyleClass(actor: Clutter.Actor, className: string) {
    return actor instanceof St.Widget && actor.has_style_class_name(className);
  }

  _collectAdaptiveTextTargets(actor = this.menu?.actor, targets = []) {
    if (!actor) return targets;
    return this._findAllTextActors(this.menu?.actor);
  }

  _findAllTextActors(actor: Clutter.Actor, foundActors: Clutter.Actor[] = []) {
    if (!actor) return foundActors;


    if (actor instanceof St.Label || actor instanceof Clutter.Text ||
      actor instanceof St.Button || actor instanceof St.Icon) {
      if (actor.visible) foundActors.push(actor);
    }


    let children = typeof actor.get_children === 'function' ? actor.get_children() : [];
    for (let i = 0; i < children.length; i++) {
      this._findAllTextActors(children[i], foundActors);
    }
    return foundActors;
  }


  _setActorColor(actor: CustomBannerActor, color: string, skipAnimations = false, batchStart?: number) {
    if (!actor || typeof actor.set_style !== 'function') return;

    if (!this._styledActors.has(actor)) {
      let origStyle = typeof actor.get_style === 'function' ? actor.get_style() : null;
      this._styledActors.set(actor, origStyle || '');

      actor.connect('destroy', () => {
        adaptiveColorTweener.cancel(actor);
        this._styledActors.delete(actor);
      });
    }

    let isInsensitive = false;
    if (actor instanceof St.Button) {
      isInsensitive = (actor.reactive === false) ||
        (typeof actor.has_style_pseudo_class === 'function' && actor.has_style_pseudo_class('insensitive'));
    }

    if (actor._currentTargetColor === color && actor._currentInsensitiveState === isInsensitive) return;





    actor._currentTargetColor = color;
    actor._currentInsensitiveState = isInsensitive;

    this._animateActorColor(actor, color, isInsensitive, 380, skipAnimations, batchStart);
  }

  _clearAdaptiveStyles() {
    for (const [actor, originalStyle] of this._styledActors.entries() as MapIterator<[CustomBannerActor, string]>) {
      if (actor && typeof actor.set_style === 'function') {
        adaptiveColorTweener.cancel(actor);
        actor._currentTargetColor = undefined;
        actor._currentInsensitiveState = undefined;
        actor.remove_style_class_name('adaptive-text-transition');
        actor.remove_style_class_name('adaptive-color-light');
        actor.remove_style_class_name('adaptive-color-dark');
        actor.set_style(originalStyle || null);
      }
    }
    this._styledActors.clear();

  }


  _applyAdaptiveColorMap(colorMap: Map<Clutter.Actor, string>, skipAnimations = false) {
    if (!colorMap || colorMap.size === 0) return;


    const batchStart = GLib.get_monotonic_time();
    for (const [actor, color] of colorMap.entries()) {
      this._setActorColor(actor as unknown as CustomBannerActor, color, skipAnimations, batchStart);
    }
  }


  _startAdaptiveColorSampling(skipAnimations = false) {
    if (!this._adaptiveConfig.enabled) return;
    this._updateAdaptiveTextColors(skipAnimations);
    if (this._adaptiveTimerId !== 0) return;

    this._adaptiveTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._adaptiveConfig.sampleIntervalMs,
      () => {
        if (!this.menu?.isOpen) {
          this._adaptiveTimerId = 0;
          return GLib.SOURCE_REMOVE;
        }
        this._updateAdaptiveTextColors(false);
        return GLib.SOURCE_CONTINUE;
      }
    );
  }


  _stopAdaptiveColorSampling() {
    if (this._adaptiveTimerId !== 0) {
      GLib.source_remove(this._adaptiveTimerId);
      this._adaptiveTimerId = 0;
    }
  }


  _updateAdaptiveTextColors(skipAnimations = false) {
    if (!this._adaptiveConfig.enabled || this._adaptiveInFlight) return;

    const targets = this._collectAdaptiveTextTargets();
    if (targets.length === 0) return;

    this._adaptiveInFlight = true;

    this._contrastSampler
      .chooseColorsForActors(targets, this._adaptiveConfig)
      .then(colorMap => {
        this._applyAdaptiveColorMap(colorMap, skipAnimations);
      })
      .catch(e => {
        this._logger.error(`[Liquid Glass] Quick Settings adaptive color update failed: ${e}`);
      })
      .finally(() => {
        this._adaptiveInFlight = false;
      });
  }

  _hexToRgb(hex: string) {
    let bigint = parseInt(hex.replace('#', ''), 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }

  _rgbToHex(r: number, g: number, b: number) {
    return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
  }

  _animateActorColor(actor: CustomBannerActor, targetHexColor: string, isInsensitive: boolean,
    durationMs = 380, skipAnimations = false, batchStart?: number) {
    if (!actor || Object.keys(actor).length === 0) return;





    const originalStyle = (this._styledActors.get(actor) || '').trim();
    const stylePrefix = originalStyle ? `${originalStyle.replace(/;$/, '')}; ` : '';
    let themeNode = actor.get_theme_node();
    let startColor = themeNode.get_foreground_color();
    let targetRgb = this._hexToRgb(targetHexColor);
    let targetAlpha = isInsensitive ? 0.5 : 1.0;
    let startAlpha = startColor.alpha / 255.0;


    const apply = (r: number, g: number, b: number, a: number) => {
      const rgba = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
      try { actor.set_style(`${stylePrefix}color: ${rgba}; -st-icon-foreground-color: ${rgba};`); } catch (e) { }
    };

    if (skipAnimations) {
      adaptiveColorTweener.cancel(actor);
      apply(targetRgb.r, targetRgb.g, targetRgb.b, targetAlpha);
      return;
    }

    const startRgb = { r: startColor.red, g: startColor.green, b: startColor.blue };


    adaptiveColorTweener.add(actor, {
      startRgb, startAlpha,
      targetRgb, targetAlpha,
      crossFade: resolveCrossFade(startRgb, targetRgb),
      durationMs,
      apply,
    }, batchStart);
  }



  _findAllButtons(actor: Clutter.Actor, foundButtons: Clutter.Actor[] = []) {
    if (!actor) return foundButtons;

    let isQuickSlider = false;
    let isToggleContainer = false;
    let isButton = actor instanceof St.Button;

    if (actor instanceof St.Widget) {
      isQuickSlider = actor.has_style_class_name('quick-slider');
      isToggleContainer = actor.has_style_class_name('quick-toggle');
    }

    if (actor.visible && !isQuickSlider) {
      if (isButton || isToggleContainer) foundButtons.push(actor);
    }

    let children = typeof actor.get_children === 'function' ? actor.get_children() : [];
    for (let i = 0; i < children.length; i++) {
      this._findAllButtons(children[i], foundButtons);
    }
    return foundButtons;
  }

  _updateSingleButtonAlpha(button: CustomBannerActor, targetAlpha: number) {
    if (!button || button._isUpdatingAlpha) return;
    button._isUpdatingAlpha = true;

    let origStyle = this._styledButtons.get(button) || '';
    button.set_style(origStyle || null);
    button.ensure_style();

    let themeNode = button.get_theme_node();
    if (themeNode) {
      let bgColor = themeNode.get_background_color();

      if (bgColor) {
        let isToggleContainer = button instanceof St.Widget && button.has_style_class_name('quick-toggle');



        if (isToggleContainer) {
          let hasColoredChild = false;
          let children = typeof button.get_children === 'function' ? button.get_children() : [];
          for (let i = 0; i < children.length; i++) {
            let child = children[i];
            if (child instanceof St.Widget) {
              let childTheme = child.get_theme_node();
              if (childTheme) {
                let childBg = childTheme.get_background_color();
                if (childBg && childBg.alpha > 0) { hasColoredChild = true; break; }
              }
            }
          }
          if (hasColoredChild) {
            let newStyle = origStyle
              ? `${origStyle} background-color: transparent !important;`
              : `background-color: transparent !important;`;
            button.set_style(newStyle);
            button._isUpdatingAlpha = false;
            return;
          }
        }


        if (bgColor.alpha === 0) {

        } else {

          let rgbaStr = `rgba(${bgColor.red}, ${bgColor.green}, ${bgColor.blue}, ${targetAlpha})`;
          let newStyle = origStyle ? `${origStyle} background-color: ${rgbaStr};` : `background-color: ${rgbaStr};`;
          button.set_style(newStyle);



          let parent = typeof button.get_parent === 'function' ? button.get_parent() : null;
          if (parent && parent instanceof St.Widget && parent.has_style_class_name('quick-toggle')) {
            this._updateSingleButtonAlpha(parent as CustomBannerActor, targetAlpha);
          }
        }
      }
    }

    button._isUpdatingAlpha = false;
  }

  _updateButtonAlpha() {
    if (!this.menu?.isOpen) return;

    const buttons = this._findAllButtons(this.menu?.actor);
    if (buttons.length === 0) return;

    let targetAlpha = this.buttonAlpha !== undefined ? this.buttonAlpha : 0.5;

    for (let button of buttons) {
      if (!this._styledButtons.has(button)) {
        if (button instanceof St.Widget) {
          let origStyle = typeof button.get_style === 'function' ? button.get_style() : null;
          this._styledButtons.set(button, origStyle || '');
        }

        const updateHandler = () => {
          if (!this.menu?.isOpen) return;
          GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._updateSingleButtonAlpha(button as CustomBannerActor, targetAlpha);
            return GLib.SOURCE_REMOVE;
          });
        };

        let signalIds: number[] = [];
        signalIds.push(button.connect('notify::hover', updateHandler));
        signalIds.push(button.connect('notify::active', updateHandler));
        signalIds.push(button.connect('notify::checked', updateHandler));
        signalIds.push(button.connect('notify::reactive', updateHandler));
        signalIds.push(button.connect('notify::mapped', updateHandler));
        signalIds.push(button.connect('key-focus-in', updateHandler));
        signalIds.push(button.connect('key-focus-out', updateHandler));
        this._buttonSignalIds.set(button, signalIds);
      }


      this._updateSingleButtonAlpha(button as unknown as CustomBannerActor, targetAlpha);
    }
  }


  _startButtonAlphaSampling() {
    this._updateButtonAlpha();
    if (this._buttonTimerId !== 0) return;

    this._buttonTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      if (!this.menu?.isOpen) {
        this._buttonTimerId = 0;
        return GLib.SOURCE_REMOVE;
      }
      this._updateButtonAlpha();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stopButtonAlphaSampling() {
    if (this._buttonTimerId !== 0) {
      GLib.source_remove(this._buttonTimerId);
      this._buttonTimerId = 0;
    }
  }


  _clearButtonStyles() {
    this._stopButtonAlphaSampling();
    if (this._buttonSignalIds) {
      for (const [button, signalIds] of this._buttonSignalIds.entries()) {
        if (button) {
          for (const id of signalIds) {
            try { button.disconnect(id); } catch (e) { }
          }
        }
      }
      this._buttonSignalIds.clear();
    }
    for (const [button, originalStyle] of this._styledButtons.entries()) {
      if (button && button instanceof St.Widget && typeof button.set_style === 'function') {
        button.set_style(originalStyle || null);
      }
    }
    this._styledButtons.clear();
  }



  _startAnimation(targetValue: number) {
    if (this._tickId !== 0) {
      GLib.source_remove(this._tickId);
      this._tickId = 0;
    }

    if (!this._enableAnimation) {
      if (this.bgActor) {
        this.bgActor.remove_all_transitions();
        const isClosing = (targetValue === 0);
        this.bgActor.opacity = isClosing ? 0 : 255;
        this.bgActor.visible = !isClosing;
        if (isClosing) {
          this.bgActor.hide();
        }
        this.bgActor.set_scale(1.0, 1.0);
        if (this.animActor) {
          this.animActor.set_scale(1.0, 1.0);
          this.animActor.opacity = isClosing ? 0 : 255;
        }
      }
      return;
    }

    if (this.animActor) this.animActor.remove_all_transitions();
    if (this.bgActor) this.bgActor.remove_all_transitions();

    this._springScale.target = targetValue;
    this._springPos.target = targetValue;

    if (this._tickId === 0) {
      let lastTime = GLib.get_monotonic_time();

      this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._animationInterval, () => {
        if (!this.bgActor || !this.targetActor) {
          this._tickId = 0;
          return GLib.SOURCE_REMOVE;
        }

        let currentTime = GLib.get_monotonic_time();
        let elapsedMs = (currentTime - lastTime) / 1000;
        lastTime = currentTime;

        let isClosing = (this._springScale.target === 0);
        let dt = elapsedMs / 1000;
        if (dt > 0.033) dt = 0.033;

        let stopped = false;
        let s: number, p: number;

        if (isClosing) {

          let speed = 15.0;
          this._springScale.value += (0 - this._springScale.value) * (1.0 - Math.exp(-speed * dt));
          this._springPos.value += (0 - this._springPos.value) * (1.0 - Math.exp(-speed * dt));
          s = this._springScale.value;
          p = this._springPos.value;

          if (s < 0.005) { s = 0; p = 0; stopped = true; }
        } else {

          stopped = this._springScale.update(elapsedMs) && this._springPos.update(elapsedMs);
          s = this._springScale.value;
          p = this._springPos.value;


          if (Math.abs(1.0 - s) < 0.002 && Math.abs(this._springScale.velocity) < 0.03) {
            s = 1.0; p = 1.0; stopped = true;
          }
        }

        let currentScale: number;
        let opacity: number;

        if (isClosing) {

          currentScale = Math.max(0.001, s);

          opacity = Math.min(255, Math.max(0, (s - 0.3) / 0.7 * 255));
        } else {
          currentScale = 0.2 + (s * 0.8);
          opacity = Math.min(255, Math.max(0, (s / 0.3) * 255));
        }

        this.animActor.set_scale(currentScale, currentScale);
        this.bgActor.opacity = opacity;
        this.animActor.opacity = opacity;

        this._syncGeometry();

        if (stopped) {
          this._tickId = 0;

          if (isClosing && this.menu.actor) {
            this.menu.actor.hide();
            this.bgActor.opacity = 0;
            this.animActor.opacity = 0;
          }

          if (!isClosing) {
            this.animActor.set_scale(1.0, 1.0);
            this.animActor.opacity = 255;
            this.bgActor.opacity = 255;
            this._syncGeometry();
          }
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }
  }




  _adjustSubmenuPositions() {
    if (!this._enableSubmenuFix || !this.menu?.isOpen || !this.animActor) return;


    if (!this._cachedSubmenus) {
      this._cachedSubmenus = [];
      let deepScan = (actor: Clutter.Actor) => {
        if (!actor) return;
        if (actor instanceof St.Widget) {
          let css = actor.get_style_class_name ? actor.get_style_class_name() : '';
          if (css && css.split(' ').includes('quick-toggle-menu')) this._cachedSubmenus!.push(actor);
        }
        let children = typeof actor.get_children === 'function' ? actor.get_children() : [];
        for (let child of children) deepScan(child);
      };
      deepScan(this.menu.actor);
    }

    let foundMenus: Clutter.Actor[] = this._cachedSubmenus;

    if (foundMenus.length === 0) return;


    let [parentAbsX, parentAbsY] = this.animActor.get_transformed_position();






    let [parentW, parentH] = getAllocatedSize(this.animActor);

    if (Number.isNaN(parentAbsX) || Number.isNaN(parentAbsY) ||
      Number.isNaN(parentW) || Number.isNaN(parentH) ||
      parentW <= 0 || parentH <= 0) return;

    for (let submenu of foundMenus) {
      if (!submenu.mapped || !submenu.visible) continue;

      let [subAbsX, subAbsY] = submenu.get_transformed_position();
      let [subW, subH] = getAllocatedSize(submenu);

      if (Number.isNaN(subAbsX) || Number.isNaN(subAbsY) ||
        Number.isNaN(subW) || Number.isNaN(subH) ||
        subW <= 0 || subH <= 0) continue;


      let currentTranslationX = submenu.translation_x || 0;
      let baseRelativeX = subAbsX - parentAbsX - currentTranslationX;
      let targetRelativeX = (parentW - subW) / 2;
      let newTranslationX = targetRelativeX - baseRelativeX;
      if (Math.abs(currentTranslationX - newTranslationX) > 0.5) {
        submenu.translation_x = newTranslationX;
      }


      let currentTranslationY = submenu.translation_y || 0;
      let baseAbsY = subAbsY - currentTranslationY;
      let subCenterY = baseAbsY + (subH / 2);
      let aboveMaxY = parentAbsY;
      let belowMinY = parentAbsY + parentH;

      let findBoundaries = (n: Clutter.Actor) => {
        if (!n || !n.visible || !n.mapped || n === submenu) return;
        if (typeof n.contains === 'function' && n.contains(submenu)) {
          let children = typeof n.get_children === 'function' ? n.get_children() : [];
          for (let child of children) findBoundaries(child);
          return;
        }
        let [, nodeY] = n.get_transformed_position();
        let [nodeW, nodeH] = getAllocatedSize(n);
        if (Number.isNaN(nodeY) || Number.isNaN(nodeW) || Number.isNaN(nodeH) ||
          nodeH <= 5 || nodeW <= 5) return;


        if (nodeY + (nodeH / 2) < subCenterY) {

          if (nodeY + nodeH <= subCenterY && nodeY + nodeH > aboveMaxY) aboveMaxY = nodeY + nodeH;
        } else {

          if (nodeY >= subCenterY && nodeY < belowMinY) belowMinY = nodeY;
        }
        let children = typeof n.get_children === 'function' ? n.get_children() : [];
        for (let child of children) findBoundaries(child);
      };


      let parentChildren = typeof this.animActor.get_children === 'function' ? this.animActor.get_children() : [];
      for (let child of parentChildren) findBoundaries(child);


      let targetTranslationY = (aboveMaxY + (belowMinY - aboveMaxY) / 2) - (subH / 2) - baseAbsY;


      if (Math.abs(currentTranslationY - targetTranslationY) > 0.5) {
        submenu.translation_y = targetTranslationY;
      }
    }
  }

  _clearSubmenuFix() {

    let foundMenus: Clutter.Actor[] = this._cachedSubmenus || [];

    if (foundMenus.length === 0) {
      let deepScan = (actor: Clutter.Actor) => {
        if (!actor) return;
        if (actor instanceof St.Widget) {
          let css = actor.get_style_class_name ? actor.get_style_class_name() : '';
          if (css && css.split(' ').includes('quick-toggle-menu')) foundMenus.push(actor);
        }
        let children = typeof actor.get_children === 'function' ? actor.get_children() : [];
        for (let child of children) deepScan(child);
      };
      if (this.menu?.actor) deepScan(this.menu.actor);
    }

    for (let submenu of foundMenus) {
      try { submenu.translation_x = 0; } catch (e) { }
    }

    this._cachedSubmenus = null;
  }


  _removeEffect() {
    if (!this._isEffectActive) return;
    this._isEffectActive = false;

    this._stopAdaptiveColorSampling();
    this._clearAdaptiveStyles();
    this._clearButtonStyles();
    this._clearSubmenuFix();
    this._clearToggleStyles();


    for (let sig of this._signals) {
      try { if (sig && sig.id) sig.target.disconnect(sig.id); } catch (e) { }
    }
    this._signals = [];

    if (this._animSignalId) {
      try { this.menu.disconnect(this._animSignalId); } catch (e) { }
      this._animSignalId = 0;
    }


    if (this._frameSyncId !== 0) {
      if (global.compositor?.get_laters)
        global.compositor.get_laters().remove(this._frameSyncId);
      this._frameSyncId = 0;
    }


    this.targetActor.remove_style_class_name('liquid-glass-transparent');
    if (this.animActor) {
      this.animActor.remove_style_class_name('liquid-glass-transparent');
      this.animActor.remove_style_class_name('liquid-glass-qs-root');
      this.animActor.translation_x = 0;
      this.animActor.translation_y = 0;
      this.animActor.set_scale(1.0, 1.0);
      this.animActor.opacity = 255;
    }

    this.targetActor.translation_y = 0;
    this.targetActor.translation_x = 0;
    this.targetActor.set_scale(1.0, 1.0);
    this.targetActor.opacity = 255;

    if (this.menu.actor) {
      this.menu.actor.opacity = 255;
      this.menu.actor.translation_x = 0;
      this.menu.actor.translation_y = 0;
      if (this.menu.isOpen) this.menu.close(false);
    }


    if (this.effect) {
      this.effect.cleanup();
      this.effect = null;
    }



    if (this.bgActor) {
      this.bgActor.destroy();
      this.bgActor = null;
    }




    if (this._toggleGlassHost) {
      if (isActorValid(this._toggleGlassHost)) {
        try { this._toggleGlassHost.destroy(); } catch (e) { }
      }
      this._toggleGlassHost = null;
    }
    this.liquidBox = null;
    this._cloneContainer = null;


    this._uiSampler?.destroy();
    this._uiSampler = null;
    this._windowCloneManager?.destroy();
    this._windowCloneManager = null;

    this._stableBaseW = undefined;
    this._stableBaseH = undefined;
    this._lastScreenW = undefined;
    this._lastScreenH = undefined;
    this._lastBgW = undefined;
    this._lastBgH = undefined;
    this._lastBgX = undefined;
    this._lastBgY = undefined;

    this._activeMode = null;
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

    this._teardownStep('frameSync', () => {
      if (this._frameSyncId !== 0) {
        if (global.compositor?.get_laters)
          global.compositor.get_laters().remove(this._frameSyncId);
        this._frameSyncId = 0;
      }
    });

    this._teardownStep('settingsSignals', () => {
      for (let sigId of this._settingsSignals) {
        try { this._settings.disconnect(sigId); } catch (e) { }
      }
      this._settingsSignals = [];
    });



    this._teardownStep('removeEffect', () => this._removeEffect());
  }
}


class Spring {
  private stiffness: number;
  private damping: number;
  private mass: number;
  public value: number;
  public velocity: number;
  public target: number;
  constructor(stiffness: number, damping: number, mass: number) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;

    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }

  updateParams(stiffness: number, damping: number, mass: number) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
  }

  update(elapsedMs: number) {

    let dt = elapsedMs / 1000;
    if (dt > 0.033) dt = 0.033;


    let springForce = -this.stiffness * (this.value - this.target);


    let dampingForce = -this.damping * this.velocity;


    let acceleration = (springForce + dampingForce) / this.mass;


    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;


    return Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.001;
  }
}
