// src/dockManager.js
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

// Padding to allow the shader to draw effects (like refraction and blur) outside the actor's strict bounds.
const SHADER_PADDING = 20;

// Utility: Convert HEX color string (e.g., "#ffffff") to normalized RGB array [1.0, 1.0, 1.0]
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

  // private bgActor: St.Widget | null = null;
  private bgActor: Clutter.Actor | null = null;
  // Delete Shell.BlurEffect and use custom blur (dual kawase) — now handled inside LiquidEffect
  private effect: LiquidEffect | null = null;

  // Nesting order (outermost → innermost):
  //   bgActor (full monitor, no effect)
  //     └─ liquidBox  ← LiquidEffect with built-in dual-Kawase blur
  //          └─ _cloneContainer  ← bgClone + windowClones + uiClones
  private liquidBox: Clutter.Actor | null = null;

  private _lastScreenW: number | undefined;
  private _lastScreenH: number | undefined;

  private _glassExpand: number;


  private _signals: number[];
  private _settingsSignals: number[]; // GSettingsのイベントリスナーを管理
  private _frameSyncId: number;
  // [FIX] Set by cleanup() before anything that can throw. Read by the
  // per-frame BEFORE_REDRAW tick so an orphaned chain stops itself even if
  // cleanup() never reached its laterRemove(). See the note in frameTick().
  private _torndown: boolean = false;
  private _isEffectActive: boolean; // エフェクトが現在適用されているかのフラグ

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
  private _lastSlabW: number | undefined;
  private _lastSlabH: number | undefined;
  private _lastSlabX: number | undefined;

  private _outputLogs: boolean = false;

  private _marginValue: number = 0;
  // Tracks the hide/show transition so the reason is logged once, not per frame.
  private _lastHidden: boolean | undefined;

  private _uiSampler: UILayerSampler | null = null;
  private _windowCloneManager: WindowCloneManager | null = null;

  private _logger: Logger;

  // コンストラクタに settings を追加
  constructor(extensionPath: string, targetActor: St.Widget, settings: Gio.Settings, logger: Logger) {
    this.extensionPath = extensionPath;
    this.targetActor = targetActor;
    this._settings = settings; // GSettings object
    this._logger = logger; // Logger object

    this._glassExpand = 0; // ガラスエリアの拡張量（ピクセル）

    this._signals = [];
    this._settingsSignals = []; // GSettingsのイベントリスナーを管理
    this._frameSyncId = 0;
    this._isEffectActive = false; // エフェクトが現在適用されているかのフラグ
  }

  // 拡張機能が有効化された時に呼ばれるエントリーポイント
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

    // 設定の監視を開始
    this._bindSettings();

    // 初回起動時にスイッチがONならエフェクトを適用
    if (this._settings.get_boolean('enable-dock-glass')) {
      this._applyEffect();
    }
  }

  // 設定が変更された時にリアルタイムで反映するためのバインディング
  _bindSettings() {
    const connectSetting = (key, callback) => {
      let id = this._settings.connect(`changed::${key}`, callback.bind(this));
      this._settingsSignals.push(id);
    };

    // ON/OFFスイッチの切り替え
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

    // マージン変更時
    connectSetting('dock-margin-bottom', () => {
      if (this._isEffectActive) this._applyMargin();
      this._marginValue = this._settings.get_int('dock-margin-bottom') || 0;
    });

    // シェーダーパラメータの動的変更
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

  // マージンの再計算と適用（動的反映のために独立した関数化）
  _applyMargin() {
    if (!this.targetActor) return;

    let marginBottom = this._settings.get_int('dock-margin-bottom');

    let [w, h] = this.targetActor.get_size();
    let [x, y] = this.targetActor.get_transformed_position();

    let monitorIndex = Main.layoutManager.findIndexForActor(this.targetActor);
    if (monitorIndex < 0) monitorIndex = Main.layoutManager.primaryIndex;
    let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;

    // 画面の各エッジとの距離から配置場所を特定する
    let distLeft = x - monitor.x;
    let distRight = (monitor.x + monitor.width) - (x + w);
    let distTop = y - monitor.y;
    let distBottom = (monitor.y + monitor.height) - (y + h);
    let minEdge = Math.min(distLeft, distRight, distTop, distBottom);

    let marginStyle = '';
    if (minEdge === distBottom || minEdge === distTop) {
      if (minEdge === distBottom) {
        marginStyle = `margin-bottom: ${marginBottom}px;`; // 下
      } else {
        marginStyle = `margin-top: ${marginBottom}px;`;    // 上
      }
    } else {
      if (minEdge === distRight) {
        marginStyle = `margin-right: ${marginBottom}px;`;  // 右
      } else {
        marginStyle = `margin-left: ${marginBottom}px;`;   // 左
      }
    }

    if (this._originalStyle === undefined) {
      this._originalStyle = this.targetActor.get_style() || '';
    }
    this._currentMarginStyle = marginStyle;
    this.targetActor.set_style(`${this._originalStyle} ${marginStyle}`);
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

    // liquidBox: full-monitor-sized actor that holds the LiquidEffect.
    // LiquidEffect internally runs dual-Kawase blur passes before the glass composite,
    // so no separate blurBox/Shell.BlurEffect is needed.
    this.liquidBox = new UnpickableActor();
    this.liquidBox.set_name("liquid-box");
    this.liquidBox.set_clip_to_allocation(true);
    this.bgActor.add_child(this.liquidBox);

    // dummyBreaker: dummy actor to break the BMS bug
    let dummyBreaker = new UnpickableActor();
    dummyBreaker.set_name("optimization-breaker");
    dummyBreaker.set_size(1.0, 1.0);
    dummyBreaker.set_opacity(0); // 完全に透明
    this.liquidBox.add_child(dummyBreaker);

    // _cloneContainer lives inside liquidBox.
    // Clones are captured into the LiquidEffect's OffscreenEffect FBO and
    // blurred + distorted by the shader in a single pass.
    this._cloneContainer = new UnpickableActor();
    this._cloneContainer.set_name("clone-container");
    this.liquidBox.add_child(this._cloneContainer);

    // 動的マージンを適用
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

    // 設定から初期値を読み込み
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

    // WindowCloneManager + UILayerSampler deposit their clones inside liquidBox.
    this._windowCloneManager = new WindowCloneManager(this.liquidBox, this._cloneContainer, 'lg-dock');
    // [FIX] dockRoot is passed BOTH as a fixed exclusion and as an ancestor
    // source. The fixed entry covers the common case; the ancestor source is
    // what keeps the exclusion correct after Dash to Dock destroys and
    // rebuilds its container (which it does whenever its settings change,
    // including a change of dock position). Without the second one the dock
    // starts being cloned into its own glass — ghost icons inside the dock.
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

    // Rebuild clones (called on menu open): delegate entirely to WindowCloneManager + UILayerSampler
    let buildClones = () => {
      if (!this.bgActor) return;

      // _uiSampler が存在する場合のみ除外リストへの追加処理を行う
      if (this._uiSampler) {
        for (let child of Main.layoutManager.uiGroup.get_children()) {
          if (child === this.bgActor) continue;

          // 名前が 'liquid-glass-bg-actor' のもの、または 'liquid-box' を子に持つものを
          // 他のLiquid Glassエフェクトの背景アクターと判定する
          let isLiquidBg = child.name === 'liquid-glass-bg-actor' ||
            (typeof child.get_children === 'function' &&
              child.get_children().some(c => c.name === 'liquid-box'));

          if (isLiquidBg) {
            this._uiSampler.addExclusion(child);
          }
        }
      }

      this._windowCloneManager?.rebuildClones();
      this._uiSampler?.rebindSelf();
      this._uiSampler?.refresh();
    };

    // The reschedule at the end is what keeps this chain alive, so it must
    // not be reachable-only-on-success: a single throw out of
    // _syncGeometry() (a disposed clone, a destroyed dash child, ...) used
    // to skip it and freeze the dock's glass permanently — clones stuck at
    // their last position, no new UI clones (the Overview's controls never
    // appear inside the dock), and the only way back was hiding and
    // re-showing the dock, since startFrameSync() only runs from
    // 'notify::mapped'. Same shape as ApplicationManager._frameTick().
    let frameTick = () => {
      this._frameSyncId = 0;
      // [FIX] Hard stop after teardown. Every one of these ticks ends by
      // re-adding itself as a BEFORE_REDRAW later, so a cleanup() that does
      // not reach its laterRemove() — because an earlier step threw — leaves
      // a self-rescheduling chain running forever against destroyed actors,
      // holding this whole manager (and its settings and logger) alive. The
      // next enable() then builds a second set on top of a live first set,
      // which is the "the extension can no longer be enabled" symptom.
      // Removing the later is still done in cleanup(); this is the backstop
      // that does not depend on cleanup() getting that far.
      if (this._torndown) return GLib.SOURCE_REMOVE;
      if (!this.bgActor || !this.targetActor.mapped) return GLib.SOURCE_REMOVE;

      // [DIAG] See setFrameSyncFrozen() in utils.ts. Reschedules but does
      // nothing, so the cost of this poll can be measured directly.
      if (isFrameSyncFrozen()) {
        this._frameSyncId = laterAdd(frameLaterType, frameTick);
        return GLib.SOURCE_REMOVE;
      }

      // Repair the subtree if Clutter has stopped allocating it. Sampled
      // here, at the top of the tick, because the previous frame's relayout
      // has settled by now and this frame's sync has not dirtied anything
      // yet. See ensureGlassAllocated().
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

    // Fullscreen check
    let isFullscreen = false;
    try {
      isFullscreen = (monitorIndex >= 0 && (global.display as any).get_monitor_in_fullscreen(monitorIndex)) ||
                     (global.display as any).get_monitor_in_fullscreen(Main.layoutManager.primaryIndex) ||
                     !!(monitor as any)?.inFullscreen;
    } catch (_) {}

    // Find DashToDock ancestor
    let d2d = this.targetActor as any;
    while (d2d && d2d.constructor?.name !== 'DashToDock') {
      d2d = d2d.get_parent();
    }

    // Fullscreen check: if monitor is in fullscreen, hide dock glass unless dock is actively showing/shown by hover
    if (isFullscreen) {
      const isD2DShowing = d2d && d2d.visible && d2d.mapped &&
                           (d2d._dockState === 2 /* SHOWN */ || d2d._dockState === 3 /* SHOWING */) &&
                           (!d2d._slider || d2d._slider.slide_x > 0.05);
      if (!isD2DShowing) {
        this.bgActor.hide();
        this.bgActor.opacity = 0;
        return false;
      }
    }

    // If DashToDock is hidden, unmapped, or in HIDDEN state, hide glass immediately
    if (d2d && (!d2d.visible || !d2d.mapped || d2d._dockState === 0 /* HIDDEN */ || (d2d._slider && d2d._slider.slide_x <= 0.001))) {
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

    // 1. まず元の背景のサイズと位置を取得
    let [baseW, baseH] = sourceActor.get_size();
    let [absX, absY] = sourceActor.get_transformed_position();
    if (Number.isNaN(absX) || Number.isNaN(absY)) return false;

    // macOS Dock: authoritative geometry directly from dash2dock-motion background slab
    let hasSlabBounds = false;
    const slab = this._findDashBackground(this.targetActor.get_parent() || this.targetActor);
    if (slab && slab.mapped && slab.visible) {
      let slW: number | undefined, slH: number | undefined, slX: number | undefined, slY: number | undefined;
      try {
        [slW, slH] = slab.get_transformed_size();
        [slX, slY] = slab.get_transformed_position();
      } catch (_) {}
      if (Number.isFinite(slX) && Number.isFinite(slW) && slW! > 50 && Number.isFinite(slY)) {
        const screenBottom = monitor ? (monitor.y + monitor.height) : 1080;
        // If the slab has slid off the bottom of the screen
        if (slY! >= screenBottom) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
          return false;
        }

        this._lastSlabW = slW;
        this._lastSlabH = slH;
        this._lastSlabX = slX;

        let pillW = slW! - 8;
        let pillX = slX! + 4;
        let pillH = 74; // 74px (+2px dock height calibrated)
        // Follow vertical translation/sliding with slab
        absX = pillX - 4;
        absY = slY! + 2;
        baseW = pillW + 8;
        baseH = pillH + 8;
        hasSlabBounds = true;
      }
    }

    let hasIconBounds = false;
    if (!hasSlabBounds) {
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
        if (minY >= screenBottom) {
          this.bgActor.hide();
          this.bgActor.opacity = 0;
          return false;
        }

        let isHorizontal = (maxX - minX) >= (maxY - minY);
        let pillX: number, pillY: number, pillW: number, pillH: number;
        let sidePad = 10; // smaller side padding (10px)
        if (isHorizontal) {
          pillH = 74; // 74px fixed height (+2px dock height calibrated)
          let isTop = monitor && (minY - monitor.y < (monitor.y + monitor.height) - maxY);
          pillY = isTop ? (monitor.y + 4) : (minY - 4);
          let sidePadL = sidePad + Math.max(0, (icons[0]?.w || baseIconW) / (baseIconW || 54) - 1) * 10;
          let sidePadR = sidePad + Math.max(0, (icons[icons.length - 1]?.w || baseIconW) / (baseIconW || 54) - 1) * 10;
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

    // If neither slab nor icons exist or are visible, DO NOT fabricate a ghost pill!
    if (!hasSlabBounds && !hasIconBounds) {
      this.bgActor.hide();
      this.bgActor.opacity = 0;
      return false;
    }

    // 補正されたサイズを適用
    let w = Math.max(1.0, baseW);
    let h = Math.max(1.0, baseH);

    if (baseW <= 9 || baseH <= 9) {
      this.bgActor.hide();
      this.bgActor.opacity = 0;
      // stateをリセットして、次の表示時に必ずガードを通過させる 
      // Reset state to guard against the next frame tick from applying the guard.
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
      const isD2DTransitioning = d2d && ((d2d as any)._dockState === 1 /* HIDING */ || (d2d as any)._dockState === 3 /* SHOWING */);
      if (!isD2DTransitioning) {
        this.bgActor.show();
        this.bgActor.opacity = this.targetActor.opacity;
        (this.bgActor as any).translation_y = 0;
      }
    }

    let bgW = Math.max(1.0, w + (SHADER_PADDING * 2) + (this._glassExpand * 2));
    let bgH = Math.max(1.0, h + (SHADER_PADDING * 2) + (this._glassExpand * 2));
    let bgX = absX - SHADER_PADDING - this._glassExpand;
    let bgY = absY - SHADER_PADDING - this._glassExpand;

    // Full-screen FBO geometry.
    // bgActor and liquidBox are both sized to cover the entire monitor.
    // This makes the FBO coordinate system match what BMS expects (full-screen
    // absolute coordinates), eliminating the BMS blur offset and cache-pollution
    // bugs caused by the old dock-sized FBO.
    let screenW = monitor.width;
    let screenH = monitor.height;

    // Dock background position in monitor-local coordinates (monitor origin = 0,0).
    // This is what the shader receives via setGlassGeometry() to reconstruct the
    // dock-centred local coordinate system inside the full-screen FBO.
    let localBgX = bgX - monitor.x;
    let localBgY = bgY - monitor.y;

    // Detect any change in dock geometry OR monitor size to trigger a rebuild.
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


    // Soft clipping via set_clip — limits GPU fragment-shader execution
    // to the dock region + a generous margin for drop-shadow decay, without
    // using clip_to_allocation (which hard-clips child actors and severs shadows).
    //
    // CLIP_PADDING must be at least as large as the maximum shadow_radius
    // setting so the penumbra gradient has room to fade to zero naturally.
    const CLIP_PADDING = 200;
    // Clip only bgActor; liquidBox has no separate clip
    // this.liquidBox?.remove_clip();

    // [PERF] clutter_actor_set_clip() does not compare before storing: it
    // notifies and calls clutter_actor_queue_redraw() every single time. Run
    // unconditionally from this per-frame tick, it damaged the dock's glass
    // (and therefore re-ran its capture/blur/composite) on every frame with
    // nothing on screen having moved. See setClipIfChanged() in utils.ts.
    setClipIfChanged(
      this.bgActor,
      localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
      bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
    );
    const SHADOW_MAX_RADIUS = CLIP_PADDING - 20;
    this.effect?.setShadowMaxRadius(SHADOW_MAX_RADIUS);

    /*
    if (this._outputLogs) {
      const shadowRadiusSetting = this._settings.get_double('shadow-radius');
      const shadowIntensitySetting = this._settings.get_double('shadow-intensity');
      this._logger.log(`[Shadow Debug] dock(local)=(${localBgX.toFixed(1)}, ${localBgY.toFixed(1)}, ${bgW.toFixed(1)}x${bgH.toFixed(1)}) ` +
        `clip=(${(localBgX - CLIP_PADDING).toFixed(1)}, ${(localBgY - CLIP_PADDING).toFixed(1)}, ` +
        `${(bgW + CLIP_PADDING * 2).toFixed(1)}x${(bgH + CLIP_PADDING * 2).toFixed(1)}) ` +
        `shadow_max_radius=${SHADOW_MAX_RADIUS} shadow-radius=${shadowRadiusSetting} shadow-intensity=${shadowIntensitySetting} ` +
        `screen=${screenW}x${screenH}`);
    }
    */

    // setResolution receives the full monitor dimensions (was bgW/bgH).
    // The shader uses resolution to compute UV-to-pixel mapping over the full FBO.
    this.effect?.setResolution(screenW, screenH);

    // Inform the shader where the dock lives within the full-screen FBO.
    // The shader uses these to compute dock_center and box_size, replacing
    // the old "resolution * 0.5" center assumption that only worked when
    // the FBO was dock-sized.
    this.effect?.setGlassGeometry(localBgX, localBgY, bgW, bgH);

    // Clones in WindowCloneManager are placed at (w.x, w.y) — absolute screen
    // coordinates. The container shift of (-monitor.x, -monitor.y) makes each
    // clone appear at (w.x - monitor.x, w.y - monitor.y) inside the full-screen
    // FBO, which maps back to (w.x, w.y) in screen space once bgActor's
    // monitor-origin position is added by Clutter's scene graph. ✓
    this._windowCloneManager?.setOffset(-monitor.x, -monitor.y);


    // [PERF ①/①b] Clip the offscreen CAPTURE to the region this glass can
    // actually show, and hide the clones that fall outside it. Must sit
    // between setGlassGeometry() (which makes the effect's uniforms describe
    // this frame) and the two sync() calls below (which consume the cull
    // rect this sets). See syncGlassCaptureClip() in utils.ts.
    syncGlassCaptureClip({
      cloneContainer: this._cloneContainer,
      effect: this.effect,
      originX: monitor.x,
      originY: monitor.y,
      uiSampler: this._uiSampler,
      windowCloneManager: this._windowCloneManager,
    });

    // UILayerSampler is synced with the monitor origin and full-screen
    // dimensions instead of the dock-relative bgX/bgY/bgW/bgH.
    this._uiSampler?.refresh();
    this._uiSampler?.sync(monitor.x, monitor.y, screenW, screenH);

    this._windowCloneManager?.sync();
  }

  // エフェクトを画面から消し、元に戻す処理
  _removeEffect() {
    if (!this._isEffectActive) return;
    this._isEffectActive = false;

    this._currentMarginStyle = undefined;

    // Safely try to remove styles/signals. If targetActor is already destroyed, 
    // this will fail safely without breaking the rest of the cleanup.
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
      // Actor was likely destroyed, safe to ignore
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
      this._originalStyle = undefined; // 次回オンになった時に再取得できるようクリア
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
        // Meta.later_remove(this._frameSyncId);
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
    // liquidBox is a child of bgActor and is already destroyed by bgActor.destroy().
    // Just clear the reference here.
    this.liquidBox = null;

    this._uiSampler?.destroy();
    this._windowCloneManager?.destroy();
  }

  // 拡張機能全体が無効化される時の最終クリーンアップ
  // [FIX] Teardown must not be all-or-nothing.
  //
  // These steps used to run bare, one after another, so the first one that
  // threw skipped every step after it — signal handlers, actors, effects and
  // (worst of all) the per-frame later chain stayed alive, and the next
  // enable() built a second set on top. Disabling is exactly when a throw is
  // most likely: the shell is destroying the same actors we are.
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

    // 毎フレームの later チェーンを最初に、無条件で止める。_removeEffect()
    // の途中で throw しても孤児チェーンが残らないようにするため
    // （_teardownStep のコメント参照）。
    this._teardownStep('frameSync', () => {
      if (this._frameSyncId !== 0) {
        if (global.compositor?.get_laters)
          global.compositor.get_laters().remove(this._frameSyncId);
        this._frameSyncId = 0;
      }
    });

    // エフェクトを解除
    this._teardownStep('removeEffect', () => this._removeEffect());

    // メモリリークを防ぐため、GSettingsのリスナーもすべて解除する
    this._teardownStep('settingsSignals', () => {
      if (this._settings) {
        for (let id of this._settingsSignals) {
          try { this._settings.disconnect(id); } catch (e) { }
        }
        this._settingsSignals = [];
      }
    });
  }

  // ドックの内部から、計算の基準となるアイコンまたはインジケーターを1つ再帰的に探し出す
  private _findReferenceActor(actor: Clutter.Actor): Clutter.Actor | null {
    if (!actor) return null;
    // 1. 安全性のチェック：オブジェクトが存在しない、または get_children がない場合は終了
    if (!actor || typeof actor.get_children !== 'function') {
      return null;
    }

    // 2. 判定条件：文字列化して 'IndicatorDrawingArea' が含まれているか
    if (actor.toString().includes('IndicatorDrawingArea')) {
      return actor;
    }

    // 3. 子要素を再帰的に探索
    const children = actor.get_children();
    for (const child of children) {
      const found = this._findReferenceActor(child);
      if (found) {
        return found; // 見つかったら即座に返す（無駄な探索をしない）
      }
    }

    return null; // 見つからなかった場合
  }

  // Finds the dock's .dash-background slab. dash2dock-motion (and upstream
  // dash-to-dock) keep it as a *sibling* of dashtodockDashContainer under
  // #dash, so search the whole dash subtree, not just targetActor's children.
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
