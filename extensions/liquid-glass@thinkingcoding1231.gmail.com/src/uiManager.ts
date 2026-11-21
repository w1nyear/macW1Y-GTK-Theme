
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import { LiquidEffect } from './liquidEffect.js';
import { StageContrastSampler, AdaptiveContrastConfig } from './contrastSampler.js';
import { UnpickableActor, UILayerSampler, UnpickableWidget, WindowCloneManager, reportFrameLoopError, ensureGlassAllocated,
  resolveMonitorGeometry, isActorValid, getAllocatedSize, isFrameSyncFrozen,
  setClipIfChanged, syncGlassCaptureClip, resolveCrossFade, adaptiveColorTweener } from './utils.js';

import { Logger } from './logger.js';





const SHADER_PADDING = 20;


const SAMPLE_PER_ELEMENT = false;

interface CustomBannerActor extends St.Widget {
  _colorTweenId?: number;
  _currentTargetColor?: string;
  _currentInsensitiveState?: boolean;
  _isUpdatingAlpha?: boolean;
}


const MIN_MENU_SCALE = 0.5;

export class UIManager {
  private extensionPath: string;
  private _settings: Gio.Settings;
  private _logger: Logger;
  private targetActor: St.Widget;
  private menu: any;
  private animActor: St.Widget;
  private bgActor: Clutter.Actor | null;
  private effect: LiquidEffect | null;

  private _cloneContainer: Clutter.Actor | null = null;
  private _windowCloneManager: WindowCloneManager | null = null;

  private _signals: { target: any, id: number }[];
  private _animSignalId: number = 0;
  private _destroySignalId = 0;
  private _actorDestroyed = false;
  private _frameSyncId: number;



  private _torndown: boolean = false;
  private _glassExpand: number;
  private _menuXoffset: number;
  private _menuYoffset: number;
  private _menuScale: number = 1.0;
  private _ownsAccentCss: boolean = true;
  private _matchQuickSettingsHeight: boolean = false;
  private _tickId: number;
  private _contrastSampler: StageContrastSampler;
  private _adaptiveTimerId: number;
  private _adaptiveInFlight: boolean;
  private _styledActors: Map<Clutter.Actor, string>;
  private _settingsSignals: number[];
  private _isEffectActive: boolean;
  private _adaptiveConfig!: typeof AdaptiveContrastConfig;
  private liquidBox: Clutter.Actor | null = null;
  private _stableBaseW: number | undefined;
  private _stableBaseH: number | undefined;
  private _lastValidAnimAbsX: number | undefined;
  private _lastValidAnimAbsY: number | undefined;
  private _lastBgW: number | undefined;
  private _lastBgH: number | undefined;
  private _lastBgX: number | undefined;
  private _lastBgY: number | undefined;


  private _springScale: Spring;
  private _springPos: Spring;
  private _springStiffness: number;
  private _springDamping: number;
  private _springMass: number;


  private _swiftAnimation: boolean = false;
  private _swiftResponse: number = 0.3;
  private _swiftDampingFraction: number = 0.65;

  private _swiftSpringScale: SwiftSpring;
  private _swiftSpringPos: SwiftSpring;

  private _enableAnimation: boolean;

  private _interfaceSettings: Gio.Settings | null = null;
  private _accentColorSignalId: number = 0;

  private _dynamicCssFile: Gio.File | null = null;
  private _cornerRadius: number = 0;

  private _animationInterval: number = 16;
  private _uiSampler: UILayerSampler | null = null;

  private _lastScreenW: number | undefined;
  private _lastScreenH: number | undefined;



  private _menuRoot: Clutter.Actor | null = null;

  constructor(extensionPath: string, settings: Gio.Settings, logger: Logger,
              panelButton: any = Main.panel.statusArea.dateMenu, ownsAccentCss: boolean = true,
              private _enableKey: string = 'enable-menu-glass',






              private _keyPrefix: string = 'menu',






              private _label: string = 'menu') {
    this.extensionPath = extensionPath;
    this._settings = settings;
    this._logger = logger;
    this._ownsAccentCss = ownsAccentCss;

    this.targetActor = panelButton.menu.actor as St.Widget;
    this.menu = panelButton.menu;
    this.animActor = panelButton.menu.box as St.Widget;

    this.bgActor = null;
    this.effect = null;

    this._signals = [];
    this._frameSyncId = 0;

    this._glassExpand = 0;
    this._menuXoffset = 0;
    this._menuYoffset = 0;


    this._springScale = new Spring(120, 8, 1.0);
    this._springPos = new Spring(300, 12, 1.0);
    this._springStiffness = 120;
    this._springDamping = 8;
    this._springMass = 1.0;

    this._swiftSpringScale = new SwiftSpring(this._swiftResponse, this._swiftDampingFraction);
    this._swiftSpringPos = new SwiftSpring(this._swiftResponse, this._swiftDampingFraction);

    this._enableAnimation = false;
    this._tickId = 0;

    this._contrastSampler = new StageContrastSampler();
    this._adaptiveTimerId = 0;
    this._adaptiveInFlight = false;
    this._styledActors = new Map();

    this._settingsSignals = [];
    this._isEffectActive = false;


    this._animSignalId = this.menu.connect('open-state-changed', (menu: any, isOpen: boolean) => {
      if (!this._isEffectActive) return;
      if (isOpen) {
        this._applyMenuScale();
        this._startAnimation(1);
      } else {
        this._startAnimation(0);
      }
    });
    this._destroySignalId = this.targetActor.connect('destroy', () => {
      this._actorDestroyed = true;
      this._destroySignalId = 0;
      this.cleanup();
    });
  }

  setup() {
    if (!this._settings) return;
    this._bindSettings();

    this._enableAnimation = this._settings.get_boolean(this._animationKey());
    this._menuScale = this._settings.get_double(this._key('scale'));
    this._matchQuickSettingsHeight = this._settings.get_boolean(this._key('match-quick-settings-height'));
    this._applyMenuScale();
    this._springStiffness = this._settings.get_double(this._key('spring-stiffness'));
    this._springDamping = this._settings.get_double(this._key('spring-damping'));
    this._springMass = this._settings.get_double(this._key('spring-mass'));
    this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    this._springPos.updateParams(this._springStiffness, this._springDamping, this._springMass);

    this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    this._accentColorSignalId = this._interfaceSettings.connect('changed::accent-color', () => {

      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        this._applySystemAccentColor();
        return GLib.SOURCE_REMOVE;
      });
    });


    this._applySystemAccentColor();

    if (this._settings.get_boolean(this._enableKey)) {
      this._applyEffect();
    }
  }

  private _applySystemAccentColor() {
    if (!this._ownsAccentCss || !this.targetActor) return;


    const parent = new UnpickableWidget({ style_class: 'calendar' });
    const child = new UnpickableWidget({ style_class: 'calendar-day calendar-today' });
    parent.add_child(child);


    Main.layoutManager.uiGroup.add_child(parent);
    child.ensure_style();


    const themeNode = child.get_theme_node();
    const bgColor = themeNode.get_background_color();


    Main.layoutManager.uiGroup.remove_child(parent);
    parent.destroy();


    const colorStr = this._rgbToHex(bgColor.red, bgColor.green, bgColor.blue);


    const cssContent = `
      .liquid-glass-menu-root .calendar-today,
      .liquid-glass-menu-root .calendar-today:hover,
      .liquid-glass-menu-root .calendar-today:active,
      .liquid-glass-menu-root .calendar-today:checked,
      .liquid-glass-menu-root .calendar-today:focus {
        background-color: ${colorStr} !important;
        color: white !important;
      }
    `;

    try {
      const cacheDir = GLib.get_user_cache_dir();
      const filePath = GLib.build_filenamev([cacheDir, 'liquid-glass-accent.css']);

      GLib.file_set_contents(filePath, cssContent);

      const themeContext = St.ThemeContext.get_for_stage(global.stage);
      const theme = themeContext.get_theme();

      if (this._dynamicCssFile) {
        theme.unload_stylesheet(this._dynamicCssFile);
      }

      this._dynamicCssFile = Gio.File.new_for_path(filePath);
      theme.load_stylesheet(this._dynamicCssFile);

      this._logger.log(`[Liquid Glass] [UIManager] System accent color applied: ${colorStr}`);
    } catch (e) {
      this._logger.error(`[Liquid Glass] [UIManager] Failed to apply system accent color: ${e}`);
    }
  }


  _hexToColorArray(hex: string): [number, number, number] {
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return [1.0, 1.0, 1.0];
    let r = parseInt(hex.slice(1, 3), 16) / 255.0;
    let g = parseInt(hex.slice(3, 5), 16) / 255.0;
    let b = parseInt(hex.slice(5, 7), 16) / 255.0;
    return [r, g, b];
  }

  _naturalHeightOf(actor: any): number {
    if (!actor || !isActorValid(actor))
      return 0;

    try {
      const [, allocated] = getAllocatedSize(actor);
      if (allocated > 1)
        return allocated;
    } catch (e) {   }

    try {
      const [, natural] = actor.get_preferred_height(-1);
      if (natural > 1)
        return natural;
    } catch (e) {   }

    return 0;
  }

  _quickSettingsHeightScale(): number | null {
    const quickSettings = Main.panel.statusArea.quickSettings?.menu;
    if (!quickSettings)
      return null;

    const targetHeight = this._naturalHeightOf(quickSettings.actor) || this._naturalHeightOf(quickSettings.box);
    const ownHeight = this._naturalHeightOf(this.targetActor) || this._naturalHeightOf(this.animActor);
    if (targetHeight <= 0 || ownHeight <= 0)
      return null;

    const ratio = targetHeight / ownHeight;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }

  _applyMenuScale() {
    if (!this.targetActor || !isActorValid(this.targetActor))
      return;

    let requested = this._menuScale;
    if (this._matchQuickSettingsHeight) {
      const matched = this._quickSettingsHeightScale();
      if (matched !== null)
        requested = matched;
    }

    const scale = Number.isFinite(requested)
      ? Math.min(1.0, Math.max(MIN_MENU_SCALE, requested))
      : 1.0;

    this.targetActor.set_pivot_point(0.5, 0.0);
    this.targetActor.set_scale(scale, scale);
  }

  _getMenuMonitorGeometry() {
    return resolveMonitorGeometry([this.menu?.sourceActor, this.targetActor]);
  }



















  private _restackGlass(): void {
    const uiGroup = Main.layoutManager.uiGroup;
    const root = this._menuRoot;
    if (!this.bgActor || !root) return;
    if (!isActorValid(root) || root.get_parent() !== uiGroup) return;
    if (this.bgActor.get_parent() !== uiGroup) return;

    const children = uiGroup.get_children();
    const rootIndex = children.indexOf(root);
    if (rootIndex < 0) return;
    if (children.indexOf(this.bgActor) === rootIndex - 1) return;

    uiGroup.set_child_below_sibling(this.bgActor, root);
  }


  private _key(suffix: string): string {
    return `${this._keyPrefix}-${suffix}`;
  }


  private _animationKey(): string {
    return `enable-${this._keyPrefix}-animation`;
  }


  _bindSettings() {
    const connectSetting = (key: string, callback: Function) => {
      let id = this._settings.connect(`changed::${key}`, callback.bind(this));
      this._settingsSignals.push(id);
    };


    connectSetting(this._enableKey, () => {
      let enabled = this._settings.get_boolean(this._enableKey);
      if (enabled && !this._isEffectActive) this._applyEffect();
      else if (!enabled && this._isEffectActive) this._removeEffect();
    });

    connectSetting(this._animationKey(), () => {
      this._enableAnimation = this._settings.get_boolean(this._animationKey());
    });

    connectSetting(this._key('spring-stiffness'), () => {
      this._springStiffness = this._settings.get_double(this._key('spring-stiffness'));
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting(this._key('spring-damping'), () => {
      this._springDamping = this._settings.get_double(this._key('spring-damping'));
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting(this._key('spring-mass'), () => {
      this._springMass = this._settings.get_double(this._key('spring-mass'));
      if (this._springScale) this._springScale.updateParams(this._springStiffness, this._springDamping, this._springMass);
    });

    connectSetting(this._key('animation-interval-ms'), () => {
      this._animationInterval = this._settings.get_int(this._key('animation-interval-ms'));
    });

    connectSetting(this._key('tint-color'), () => {
      if (this.effect) {
        let colorArray = this._hexToColorArray(this._settings.get_string(this._key('tint-color')));
        this.effect.setTintColor(...colorArray);
      }
    });

    connectSetting(this._key('tint-strength'), () => {
      if (this.effect) {
        this.effect.setTintStrength(this._settings.get_double(this._key('tint-strength')));
      }
    });

    connectSetting(this._key('blur-radius'), () => {
      if (this.effect) {
        this.effect.setBlurRadius(this._settings.get_int(this._key('blur-radius')));
      }
    });

    connectSetting(this._key('brightness'), () => {
      if (this.effect) {
        this.effect.setBrightness(this._settings.get_double(this._key('brightness')));
      }
    });

    connectSetting(this._key('contrast'), () => {
      if (this.effect) {
        this.effect.setContrast(this._settings.get_double(this._key('contrast')));
      }
    });

    connectSetting(this._key('saturation'), () => {
      if (this.effect) {
        this.effect.setSaturation(this._settings.get_double(this._key('saturation')));
      }
    });

    connectSetting(this._key('corner-radius'), () => {
      if (this.effect) {
        this._cornerRadius = this._settings.get_double(this._key('corner-radius'));
        this.effect.setCornerRadius(this._cornerRadius);
      }
    });

    connectSetting(this._key('glass-expand'), () => {
      if (this.effect) {
        this._glassExpand = this._settings.get_int(this._key('glass-expand'));
      }
    });

    connectSetting(this._key('x-offset'), () => {
      if (this.animActor) {
        this._menuXoffset = this._settings.get_int(this._key('x-offset'));
        this.animActor.translation_x = this._menuXoffset;
      }
    });

    connectSetting(this._key('scale'), () => {
      this._menuScale = this._settings.get_double(this._key('scale'));
      this._applyMenuScale();
    });

    connectSetting(this._key('match-quick-settings-height'), () => {
      this._matchQuickSettingsHeight = this._settings.get_boolean(this._key('match-quick-settings-height'));
      this._applyMenuScale();
    });

    connectSetting(this._key('y-offset'), () => {
      if (this.animActor) {
        this._menuYoffset = this._settings.get_int(this._key('y-offset'));
        this.animActor.translation_y = this._menuYoffset;
      }
    });

    connectSetting(this._key('enable-adaptive-text-color'), () => {
      this._adaptiveConfig.enabled = this._settings.get_boolean(this._key('enable-adaptive-text-color'));
    });

    connectSetting(this._key('sample-interval-ms'), () => {
      this._adaptiveConfig.sampleIntervalMs = this._settings.get_int(this._key('sample-interval-ms'));
    });
  }

  _applyEffect() {
    if (this._isEffectActive) return;
    this._isEffectActive = true;

    if (!this.targetActor) return;


    this.targetActor.add_style_class_name('liquid-glass-transparent');
    this.animActor.add_style_class_name('liquid-glass-transparent');
    this.animActor.add_style_class_name('liquid-glass-menu-root');


    this._menuXoffset = this._settings.get_int(this._key('x-offset'));
    this._menuYoffset = this._settings.get_int(this._key('y-offset'));
    this.animActor.translation_x = this._menuXoffset;
    this.animActor.translation_y = this._menuYoffset;

    this._glassExpand = this._settings.get_int(this._key('glass-expand'));
    this._animationInterval = this._settings.get_int(this._key('animation-interval-ms'));

    this._adaptiveConfig = {
      ...AdaptiveContrastConfig,
      enabled: this._settings.get_boolean(this._key('enable-adaptive-text-color')),
      samplePerElement: SAMPLE_PER_ELEMENT,
      sampleIntervalMs: this._settings.get_int(this._key('sample-interval-ms')),
    };


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



    this.animActor.set_pivot_point(0.5, 0.0);

    this.bgActor.set_pivot_point(0.0, 0.0);


    let menuRoot: Clutter.Actor = this.menu.actor;
    while (menuRoot.get_parent() && menuRoot.get_parent() !== Main.layoutManager.uiGroup) {
      const p = menuRoot.get_parent();
      if (!p) break;
      menuRoot = p;
    }


    this._menuRoot = menuRoot;
    if (menuRoot.get_parent() === Main.layoutManager.uiGroup) {
      Main.layoutManager.uiGroup.insert_child_below(this.bgActor, menuRoot);
    } else {
      Main.layoutManager.uiGroup.add_child(this.bgActor);
    }


    this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, `lg-${this._label}`);



    this._uiSampler = new UILayerSampler(
      this.bgActor,
      this.liquidBox,
      [menuRoot, global.windowGroup, global.window_group],
      this._cloneContainer,
      this._label
    );

    let blurRadius = this._settings.get_int(this._key('blur-radius'));
    let tintColorStr = this._settings.get_string(this._key('tint-color'));
    let tintStrength = this._settings.get_double(this._key('tint-strength'));
    let brightness = this._settings.get_double(this._key('brightness'));
    let contrast = this._settings.get_double(this._key('contrast'));
    let saturation = this._settings.get_double(this._key('saturation'));
    this._cornerRadius = this._settings.get_double(this._key('corner-radius'));


    this.effect = new LiquidEffect({ extensionPath: this.extensionPath, settings: this._settings, owner: this._label } as any);
    this.effect.setPadding(SHADER_PADDING);
    this.effect.setTintColor(...this._hexToColorArray(tintColorStr));
    this.effect.setTintStrength(tintStrength);
    this.effect.setCornerRadius(this._cornerRadius);
    this.effect.setIsDock(false);
    this.effect.setBrightness(brightness);
    this.effect.setContrast(contrast);
    this.effect.setSaturation(saturation);
    this.effect.setBlurRadius(blurRadius);
    if (this._keyPrefix === 'panel-menu') {
      (this.effect as any).setShadowIntensityMultiplier(1.0 / 3.0);
    }
    this.liquidBox.add_effect(this.effect);
    this.bgActor.hide();


    const laterAdd = (laterType: Meta.LaterType, callback: GLib.SourceFunc) => {
      return global.compositor?.get_laters?.().add(laterType, callback);
    };

    const laterRemove = (id: number) => {
      if (!id) return;
      if (global.compositor?.get_laters)
        global.compositor.get_laters().remove(id);
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

          if (isLiquidBg) {
            this._uiSampler.addExclusion(child);
          }
        }
      }


      this._restackGlass();

      this._windowCloneManager?.rebuildClones();
      this._uiSampler?.rebindSelf();
      this._uiSampler?.refresh();
    };





    let frameTick = () => {
      this._frameSyncId = 0;









      if (this._torndown) return GLib.SOURCE_REMOVE;
      const isTargetClosing = this.targetActor && this.targetActor.visible && this.targetActor.opacity > 0;
      if (!this.bgActor || (this.menu && !this.menu.isOpen && !isTargetClosing)) {
        if (this.bgActor && this.bgActor.visible) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
        }
        return GLib.SOURCE_REMOVE;
      }
      if (!this.targetActor.mapped) {
        this._frameSyncId = laterAdd(frameLaterType, frameTick);
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
        reportFrameLoopError('UIManager', e);
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

    const resetOnClose = (force: boolean = false) => {
      const isTargetClosing = !force && this.targetActor && this.targetActor.visible && this.targetActor.opacity > 0;
      if (isTargetClosing) {
        return;
      }
      this._stopAdaptiveColorSampling();
      stopFrameSync();
      this._stableBaseW = undefined;
      this._stableBaseH = undefined;
      this._lastValidAnimAbsX = undefined;
      this._lastValidAnimAbsY = undefined;
      this._lastBgW = undefined;
      this._lastBgH = undefined;
      this._lastBgX = undefined;
      this._lastBgY = undefined;
      this._windowCloneManager?.setCullRect(null);
      this._uiSampler?.setCullRect(null);
      if (this.bgActor) {
        this.bgActor.hide();
        this.bgActor.opacity = 0;
      }
      if (this.animActor) {
        this.animActor.opacity = 0;
      }
    };



    this._signals.push({
      target: this.menu,
      id: this.menu.connect('open-state-changed', (menu: any, isOpen: boolean) => {
        if (isOpen) {
          this._stableBaseW = undefined;
          this._stableBaseH = undefined;
          startFrameSync();
          this._startAdaptiveColorSampling(true);
        } else {
          const isTargetClosing = this.targetActor && this.targetActor.visible && this.targetActor.opacity > 0;
          if (!isTargetClosing) {
            resetOnClose(true);
          }
        }
      })
    });


    this._signals.push({
      target: this.menu.actor,
      id: this.menu.actor.connect('notify::mapped', () => {
        if (this.menu.actor.mapped) {
          if (this.menu && this.menu.isOpen) {
            startFrameSync();
          }
        } else {
          resetOnClose(true);
        }
      })
    });

    this._signals.push({
      target: this.menu,
      id: this.menu.connect('menu-closed', () => {
        resetOnClose(true);
      })
    });

    this._signals.push({
      target: this.menu.actor,
      id: this.menu.actor.connect('notify::visible', () => {
        if (!this.menu.actor.visible) {
          resetOnClose();
        }
      })
    });

    this._updateResolution();
    if (this.targetActor.mapped) {
      startFrameSync();
    }
  }


  _syncGeometry() {
    if ((this.bgActor as any)?._isClosingAnimation) {
      return;
    }
    const isTargetClosing = this.targetActor && this.targetActor.visible && this.targetActor.opacity > 0;
    if (!this.bgActor || !this.targetActor || !this.targetActor.mapped || (this.menu && !this.menu.isOpen && !isTargetClosing)) {
      if (this.bgActor && this.bgActor.visible) {
        this.bgActor.hide();
        this.bgActor.opacity = 0;
      }
      return;
    }
    if (!this._enableAnimation) {
      this.bgActor.opacity = this.targetActor.opacity;
    }
    if (this.bgActor.opacity > 0 && !this.bgActor.visible) {
      this.bgActor.show();
    } else if (this.bgActor.opacity === 0 && this.bgActor.visible) {
      this.bgActor.hide();
    }
    let [inW, inH] = this.animActor.get_size();
    let [outW, outH] = this.targetActor.get_size();
    let [scaleX, scaleY] = this.animActor.get_scale();

    inW = Number.isNaN(inW) || inW <= 0 ? (this._stableBaseW || 1) : inW;
    inH = Number.isNaN(inH) || inH <= 0 ? (this._stableBaseH || 1) : inH;
    scaleX = Number.isNaN(scaleX) ? 1.0 : scaleX;
    scaleY = Number.isNaN(scaleY) ? 1.0 : scaleY;

    scaleX *= this.targetActor.get_scale()[0];
    scaleY *= this.targetActor.get_scale()[1];

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

    let isUnpositioned = Number.isNaN(animAbsX) || Number.isNaN(animAbsY) ||
                         (animAbsX <= 10 && animAbsY <= 10) || animAbsY < 20;

    if (isUnpositioned && this.menu) {
      const bp = (this.menu as any)._boxPointer;
      if (bp && bp._sourceActor && bp._sourceActor.mapped && typeof bp._reposition === 'function') {
        try {
          const box = new Clutter.ActorBox();
          bp._reposition(box);
          const bpThemeNode = bp.get_theme_node();
          const borderWidth = bpThemeNode ? bpThemeNode.get_length('-arrow-border-width') : 0;
          const rise = bpThemeNode ? bpThemeNode.get_length('-arrow-rise') : 0;
          animAbsX = box.x1 + borderWidth + this._menuXoffset;
          animAbsY = box.y1 + borderWidth + (bp._arrowSide === St.Side.TOP ? rise : 0) + this._menuYoffset;
          isUnpositioned = false;
        } catch (_) {}
      }
    }


    if (isUnpositioned) {
      if (this._lastValidAnimAbsX !== undefined && this._lastValidAnimAbsY !== undefined) {
        animAbsX = this._lastValidAnimAbsX;
        animAbsY = this._lastValidAnimAbsY;
      } else {
        let monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
          animAbsX = (monitor.width / 2) - (w / 2) + this._menuXoffset;
          animAbsY = (Main.panel.height || 27) + this._menuYoffset;
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


    let monitor = this._getMenuMonitorGeometry();
    let monitorX = monitor?.x ?? 0;
    let monitorY = monitor?.y ?? 0;
    let screenW = Math.max(1, monitor?.width ?? 1);
    let screenH = Math.max(1, monitor?.height ?? 1);

    if (!Number.isNaN(bgX) && !Number.isNaN(bgY) && w >= 1.0 && h >= 1.0) {


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



        const CLIP_PADDING = 36;



        setClipIfChanged(
          this.bgActor,
          localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
          bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
        );

        const SHADOW_MAX_RADIUS = 30;
        this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);


        this.effect?.setResolution(screenW, screenH);



        this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);

        this._lastBgW = bgW; this._lastBgH = bgH;
        this._lastBgX = bgX; this._lastBgY = bgY;
        this._lastScreenW = screenW; this._lastScreenH = screenH;
      }
    }

    if (this.effect) {
      let currentScale = Math.min(scaleX, scaleY);
      this.effect.setCornerRadius(this._cornerRadius * currentScale);

      if (typeof this.effect.setAnimationScale === 'function') {
        this.effect.setAnimationScale(currentScale);
      }

      const bp = (this.menu as any)?._boxPointer;
      if (bp && typeof bp.get_theme_node === 'function') {
        try {
          const themeNode = bp.get_theme_node();
          const rise = themeNode ? themeNode.get_length('-arrow-rise') : 0;
          const base = themeNode ? (themeNode.get_length('-arrow-base') || 18.0) : 18.0;
          if (rise > 0 && bp._arrowSide !== undefined) {
            let sideNum = 0;
            if (bp._arrowSide === St.Side.TOP) sideNum = 1;
            else if (bp._arrowSide === St.Side.RIGHT) sideNum = 2;
            else if (bp._arrowSide === St.Side.BOTTOM) sideNum = 3;
            else if (bp._arrowSide === St.Side.LEFT) sideNum = 4;

            let origin = 0;
            const src = bp._arrowActor || bp._sourceActor;
            if (src && src.mapped && typeof src.get_transformed_extents === 'function') {
              const srcExtents = src.get_transformed_extents();
              const srcTl = srcExtents.get_top_left();
              const srcBr = srcExtents.get_bottom_right();
              if (sideNum === 1 || sideNum === 3) {
                const srcCenterX = (srcTl.x + srcBr.x) * 0.5;
                const glassCenterX = animAbsX + w * 0.5;
                origin = srcCenterX - glassCenterX;
                const r = (this._cornerRadius || 20.0) * currentScale;
                const arrowHalfBase = (base * currentScale) * 0.5;
                const maxOrigin = Math.max(0, (w * 0.5) - r - arrowHalfBase);
                origin = Math.max(-maxOrigin, Math.min(maxOrigin, origin));
              } else {
                const srcCenterY = (srcTl.y + srcBr.y) * 0.5;
                const glassCenterY = animAbsY + h * 0.5;
                origin = srcCenterY - glassCenterY;
                const r = (this._cornerRadius || 20.0) * currentScale;
                const arrowHalfBase = (base * currentScale) * 0.5;
                const maxOrigin = Math.max(0, (h * 0.5) - r - arrowHalfBase);
                origin = Math.max(-maxOrigin, Math.min(maxOrigin, origin));
              }
            } else if (sideNum === 1 || sideNum === 3) {
              origin = (bp._arrowOrigin || (w * 0.5)) - (w * 0.5);
            } else {
              origin = (bp._arrowOrigin || (h * 0.5)) - (h * 0.5);
            }
            this.effect.setArrow(sideNum, origin, base * currentScale, rise * currentScale, 2.0, 5.0);
          } else {
            this.effect.setArrow(0, 0, 0, 0);
          }
        } catch (_) {
          this.effect.setArrow(0, 0, 0, 0);
        }
      } else {
        this.effect.setArrow(0, 0, 0, 0);
      }
    }





    this._windowCloneManager?.setOffset(-monitorX, -monitorY);
    this._uiSampler?.refresh();






    syncGlassCaptureClip({
      cloneContainer: this._cloneContainer,
      effect: this.effect,
      originX: monitorX,
      originY: monitorY,
      uiSampler: this._uiSampler,
      windowCloneManager: this._windowCloneManager,
    });

    this._uiSampler?.sync(monitorX, monitorY, screenW, screenH);
    this._windowCloneManager?.sync();
  }


  _updateResolution() {
    if (!this.bgActor || !this.effect) return;
    let [width, height] = this.bgActor.get_size();
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      this.effect.setResolution(width, height);
    }
  }


  _hasStyleClass(actor: Clutter.Actor, className: string) {
    return actor instanceof St.Widget &&
      actor.has_style_class_name(className);
  }

  _collectAdaptiveTextTargets(actor: Clutter.Actor = this.menu?.actor, targets: Clutter.Actor[] = []) {
    if (!actor) return targets;
    return this._findAllTextActors(this.menu?.actor);
  }

  _findAllTextActors(actor: Clutter.Actor, foundActors: Clutter.Actor[] = []) {
    if (!actor) return foundActors;

    if (actor instanceof St.Label || actor instanceof Clutter.Text || actor instanceof St.Button || actor instanceof St.Icon) {
      if (actor.visible) {
        foundActors.push(actor);
      }
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
      isInsensitive = (actor.reactive === false) || (typeof actor.has_style_pseudo_class === 'function' && actor.has_style_pseudo_class('insensitive'));
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
        try {
          actor.remove_style_class_name('adaptive-text-transition');
          actor.remove_style_class_name('adaptive-color-light');
          actor.remove_style_class_name('adaptive-color-dark');
          actor.set_style(originalStyle || null);
        } catch (e) { }
      }
    }
    this._styledActors.clear();

  }


  _applyAdaptiveColorMap(colorMap: Map<Clutter.Actor, string>, skipAnimations = false) {
    if (!colorMap || colorMap.size === 0)
      return;




    const batchStart = GLib.get_monotonic_time();
    for (const [actor, color] of colorMap.entries()) {
      this._setActorColor(actor as unknown as CustomBannerActor, color, skipAnimations, batchStart);
    }
  }


  _startAdaptiveColorSampling(skipAnimations = false) {
    if (!this._adaptiveConfig.enabled)
      return;

    this._updateAdaptiveTextColors(skipAnimations);

    if (this._adaptiveTimerId !== 0)
      return;

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
    if (!this._adaptiveConfig.enabled || this._adaptiveInFlight)
      return;

    const targets = this._collectAdaptiveTextTargets();
    if (targets.length === 0)
      return;

    this._adaptiveInFlight = true;

    this._contrastSampler
      .chooseColorsForActors(targets, this._adaptiveConfig)
      .then(colorMap => {
        if (!this._isEffectActive || this._actorDestroyed) return;
        this._applyAdaptiveColorMap(colorMap, skipAnimations);
      })
      .catch(e => {
        this._logger.error(`[Liquid Glass] Menu adaptive color update failed: ${e}`);
      })
      .finally(() => {
        this._adaptiveInFlight = false;
      });
  }


  _hexToRgb(hex: string) {
    let bigint = parseInt(hex.replace('#', ''), 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255
    };
  }


  _rgbToHex(r: number, g: number, b: number) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
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


  _startAnimation(targetValue: number) {
    let isClosing = (targetValue === 0);
    if (this._tickId !== 0) {
      GLib.source_remove(this._tickId);
      this._tickId = 0;
    }

    if (!this._enableAnimation) {
      if (this.bgActor) {
        if (!(this.bgActor as any)._isClosingAnimation) {
          this.bgActor.remove_all_transitions();
        }
        if (isClosing) {
          const isTargetClosing = this.targetActor && this.targetActor.visible && this.targetActor.opacity > 0;
          if (!isTargetClosing && !(this.bgActor as any)._isClosingAnimation) {
            this.bgActor.opacity = 0;
            this.bgActor.visible = false;
            this.bgActor.hide();
          }
        } else {
          (this.bgActor as any)._isClosingAnimation = false;
          this.bgActor.opacity = 255;
          this.bgActor.visible = true;
          this.bgActor.show();
          this.bgActor.set_scale(1.0, 1.0);
          this.bgActor.set_pivot_point(0.0, 0.0);
        }

        if (this.animActor) {
          this.animActor.remove_all_transitions();
          this.animActor.set_scale(1.0, 1.0);
          if (!isClosing) {
            this.animActor.opacity = 255;
          }
        }
      }
      return;
    }

    if (this.animActor) this.animActor.remove_all_transitions();
    if (this.bgActor) this.bgActor.remove_all_transitions();

    if (this._swiftAnimation) {
      this._swiftSpringScale.updateParams(this._swiftResponse, this._swiftDampingFraction);
      this._swiftSpringPos.updateParams(this._swiftResponse, this._swiftDampingFraction);
      this._swiftSpringScale.target = targetValue;
      this._swiftSpringPos.target = targetValue;
      if (Number.isNaN(this._swiftSpringScale.value)) this._swiftSpringScale.value = 0;
      if (Number.isNaN(this._swiftSpringPos.value)) this._swiftSpringPos.value = 0;
    } else {
      this._springScale.target = targetValue;
      this._springPos.target = targetValue;
    }

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

        let isClosing = this._swiftAnimation ? (this._swiftSpringScale.target === 0) : (this._springScale.target === 0);

        let dt = elapsedMs / 1000;
        if (dt > 0.033) dt = 0.033;

        let stopped = false;
        let s: number, p: number;

        if (isClosing) {
          let speed = 15.0;
          if (this._swiftAnimation) {
            this._swiftSpringScale.value += (0 - this._swiftSpringScale.value) * (1.0 - Math.exp(-speed * dt));
            this._swiftSpringPos.value += (0 - this._swiftSpringPos.value) * (1.0 - Math.exp(-speed * dt));
            s = this._swiftSpringScale.value;
            p = this._swiftSpringPos.value;
          } else {
            this._springScale.value += (0 - this._springScale.value) * (1.0 - Math.exp(-speed * dt));
            this._springPos.value += (0 - this._springPos.value) * (1.0 - Math.exp(-speed * dt));
            s = this._springScale.value;
            p = this._springPos.value;
          }

          if (s < 0.005) {
            s = 0; p = 0;
            stopped = true;
          }
        } else {
          if (this._swiftAnimation) {
            stopped = this._swiftSpringScale.update(elapsedMs) && this._swiftSpringPos.update(elapsedMs);
            s = this._swiftSpringScale.value;
            p = this._swiftSpringPos.value;
          } else {
            stopped = this._springScale.update(elapsedMs) && this._springPos.update(elapsedMs);
            s = this._springScale.value;
            p = this._springPos.value;
          }

          if (Math.abs(1.0 - s) < 0.002 && Math.abs(this._swiftAnimation ? this._swiftSpringScale.velocity : this._springScale.velocity) < 0.03) {
            s = 1.0;
            p = 1.0;
            stopped = true;
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
            this.bgActor.visible = false;
            this.animActor.opacity = 0;
          }

          if (!isClosing) {
            this.animActor.set_scale(1.0, 1.0);
            this.animActor.opacity = 255;
            this.bgActor.opacity = 255;
            this.bgActor.visible = true;
            this._syncGeometry();
          }
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }
  }

  _removeEffect() {
    if (!this._isEffectActive) return;
    this._isEffectActive = false;

    this._stopAdaptiveColorSampling();
    this._clearAdaptiveStyles();


    for (let sig of this._signals) {
      try {
        if (sig && sig.id) sig.target.disconnect(sig.id);
      } catch (e) { }
    }
    this._signals = [];

    if (this._tickId && this._tickId !== 0) {
      GLib.Source.remove(this._tickId);
      this._tickId = 0;
    }


    if (this._frameSyncId !== 0) {
      if (global.compositor?.get_laters)
        global.compositor.get_laters().remove(this._frameSyncId);
      this._frameSyncId = 0;
    }

    if (this._interfaceSettings && this._accentColorSignalId) {
      this._interfaceSettings.disconnect(this._accentColorSignalId);
      this._accentColorSignalId = 0;
      this._interfaceSettings = null;
    }


    if (!this._actorDestroyed) this.targetActor.remove_style_class_name('liquid-glass-transparent');
    if (!this._actorDestroyed && this.animActor) {
      this.animActor.remove_style_class_name('liquid-glass-transparent');
      this.animActor.remove_style_class_name('liquid-glass-menu-root');

      this.animActor.translation_x = 0;
      this.animActor.translation_y = 0;
      this.animActor.set_scale(1.0, 1.0);
      this.animActor.opacity = 255;
    }
    if (this._dynamicCssFile) {
      const themeContext = St.ThemeContext.get_for_stage(global.stage);
      const theme = themeContext.get_theme();
      theme.unload_stylesheet(this._dynamicCssFile);
      this._dynamicCssFile = null;
    }

    if (!this._actorDestroyed) {
      this.targetActor.translation_y = 0;
      this.targetActor.set_scale(1.0, 1.0);
      this.targetActor.opacity = 255;
    }

    if (!this._actorDestroyed && this.menu.actor) {
      this.menu.actor.opacity = 255;

      if (this.menu.isOpen) {
        this.menu.close(false);
      }
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
    this._cloneContainer = null;
    this._menuRoot = null;


    this._uiSampler?.destroy();
    this._uiSampler = null;
    this._windowCloneManager?.destroy();
    this._windowCloneManager = null;

    this._stableBaseW = undefined;
    this._stableBaseH = undefined;
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

    _setupJellyTouchAndDrag() {
      // Elasticity and jelly spring effect removed for context menus
      this._jellySignals = [];
    }
cleanup() {
    this._torndown = true;
    if (this._jellySignals) {
      for (let sigId of this._jellySignals) {
        try { this.animActor.disconnect(sigId); } catch (_) {}
      }
      this._jellySignals = [];
    }


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

    // These connections also exist when the global menu effect is disabled,

    this._teardownStep('menuSignals', () => {
      if (this._animSignalId) {
        this.menu.disconnect(this._animSignalId);
        this._animSignalId = 0;
      }
      if (this._destroySignalId) {
        this.targetActor.disconnect(this._destroySignalId);
        this._destroySignalId = 0;
      }
      if (this._interfaceSettings && this._accentColorSignalId) {
        this._interfaceSettings.disconnect(this._accentColorSignalId);
        this._accentColorSignalId = 0;
        this._interfaceSettings = null;
      }
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

class SwiftSpring {
  response: number;
  dampingFraction: number;
  mass: number;

  value: number;
  velocity: number;
  target: number;

  constructor(response: number, dampingFraction: number, mass: number = 1.0) {
    this.response = typeof response === 'number' && !isNaN(response) && response > 0.01 ? response : 0.4;
    this.dampingFraction = typeof dampingFraction === 'number' && !isNaN(dampingFraction) && dampingFraction >= 0 ? dampingFraction : 0.7;
    this.mass = typeof mass === 'number' && !isNaN(mass) && mass > 0.01 ? mass : 1.0;

    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }

  updateParams(response: number, dampingFraction: number, mass: number = 1.0) {
    if (typeof response === 'number' && !isNaN(response) && response > 0.01) this.response = response;
    if (typeof dampingFraction === 'number' && !isNaN(dampingFraction) && dampingFraction >= 0) this.dampingFraction = dampingFraction;
    if (typeof mass === 'number' && !isNaN(mass) && mass > 0.01) this.mass = mass;
  }

  update(elapsedMs: number): boolean {
    let dt = elapsedMs / 1000;

    if (isNaN(dt) || dt <= 0) return false;
    if (dt > 0.1) dt = 0.1;

    if (isNaN(this.value) || !isFinite(this.value) || isNaN(this.velocity) || !isFinite(this.velocity)) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }

    const x0 = this.value - this.target;
    const v0 = this.velocity;

    if (Math.abs(x0) < 0.001 && Math.abs(v0) < 0.001) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }

    const omega0 = (2 * Math.PI) / this.response;
    const zeta = this.dampingFraction;

    let x_t = 0;
    let v_t = 0;


    if (zeta < 0.999) {

      const omegaD = omega0 * Math.sqrt(1.0 - zeta * zeta);
      const alpha = zeta * omega0;
      const exp = Math.exp(-alpha * dt);
      const cos = Math.cos(omegaD * dt);
      const sin = Math.sin(omegaD * dt);

      x_t = exp * (x0 * cos + ((v0 + alpha * x0) / omegaD) * sin);
      v_t = exp * (v0 * cos - ((alpha * v0 + omega0 * omega0 * x0) / omegaD) * sin);
    } else if (zeta > 1.001) {

      const beta = omega0 * Math.sqrt(zeta * zeta - 1.0);
      const gamma1 = -zeta * omega0 + beta;
      const gamma2 = -zeta * omega0 - beta;
      const exp1 = Math.exp(gamma1 * dt);
      const exp2 = Math.exp(gamma2 * dt);

      const c1 = (v0 - gamma2 * x0) / (gamma1 - gamma2);
      const c2 = x0 - c1;

      x_t = c1 * exp1 + c2 * exp2;
      v_t = c1 * gamma1 * exp1 + c2 * gamma2 * exp2;
    } else {

      const exp = Math.exp(-omega0 * dt);
      x_t = exp * (x0 + (v0 + omega0 * x0) * dt);
      v_t = exp * (v0 - omega0 * (v0 + omega0 * x0) * dt);
    }

    this.value = x_t + this.target;
    this.velocity = v_t;

    if (isNaN(this.value) || !isFinite(this.value)) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }
    this.value = Math.max(-0.5, Math.min(2.5, this.value));

    if (Math.abs(this.value - this.target) < 0.001 && Math.abs(this.velocity) < 0.001) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }

    return false;
  }
}
