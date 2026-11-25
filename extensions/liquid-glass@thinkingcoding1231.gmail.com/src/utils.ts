






import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Mtk from 'gi://Mtk';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';







type UtilsLogger = { log: (...args: any[]) => void };
let _utilsLogger: UtilsLogger | null = null;
export function setUtilsLogger(logger: UtilsLogger | null): void {
  _utilsLogger = logger;
}
function utilsLog(msg: string): void {
  try { _utilsLogger?.log(msg); } catch (_) {   }
}









































































const _strandedFrames: WeakMap<Clutter.Actor, number> = new WeakMap();
const STRANDED_FRAMES_BEFORE_RESCUE = 3;
















































export function ensureWindowActorAllocated(
  actor: any,
  relayoutFrames: number,
  remapFrames: number
): '' | 'relayout' | 'remap' {
  try {
    if (!actor) return '';
    if (_windowActorRescueMode === 'off') return '';

    if (!actor.visible || !actor.mapped || actor.has_allocation()) {
      _windowActorStrandedFrames.delete(actor);
      return '';
    }

    const strandedFor = (_windowActorStrandedFrames.get(actor) ?? 0) + 1;
    _windowActorStrandedFrames.set(actor, strandedFor);

    if (_windowActorRescueMode !== 'remap' && strandedFor === relayoutFrames) {























      let ancestor: any = actor.get_parent();
      while (ancestor && isActorValid(ancestor) && !ancestor.has_allocation())
        ancestor = ancestor.get_parent();
      if (ancestor && isActorValid(ancestor)) {
        ancestor.queue_relayout();
        return 'relayout';
      }
    }

    if (strandedFor >= remapFrames) {
      _windowActorStrandedFrames.delete(actor);
      actor.hide();
      actor.show();
      return 'remap';
    }

    return '';
  } catch (_) {
    return '';
  }
}

const _windowActorStrandedFrames: Map<any, number> = new Map();





export type WindowActorRescueMode = 'two-stage' | 'remap' | 'off';
let _windowActorRescueMode: WindowActorRescueMode = 'two-stage';
const WINDOW_ACTOR_RESCUE_MODES: WindowActorRescueMode[] =
  ['two-stage', 'remap', 'off'];

export function setWindowActorRescueMode(mode: WindowActorRescueMode): void {
  _windowActorRescueMode =
    WINDOW_ACTOR_RESCUE_MODES.includes(mode) ? mode : 'two-stage';
}
export function getWindowActorRescueMode(): WindowActorRescueMode {
  return _windowActorRescueMode;
}

export function ensureGlassAllocated(
  actor: Clutter.Actor | null,
  framesBeforeRescue: number = STRANDED_FRAMES_BEFORE_RESCUE
): boolean {
  try {
    if (!actor) return false;




    if (!actor.visible || !actor.mapped || actor.has_allocation()) {
      _strandedFrames.delete(actor);
      return false;
    }

    const strandedFor = (_strandedFrames.get(actor) ?? 0) + 1;
    if (strandedFor < framesBeforeRescue) {
      _strandedFrames.set(actor, strandedFor);
      return false;
    }
    _strandedFrames.delete(actor);

    actor.hide();
    actor.show();
    return true;
  } catch (_) {
    return false;
  }
}




















export function setActorVisible(actor: Clutter.Actor, visible: boolean): void {
  try {
    if (!actor) return;
    if (actor.visible === visible) return;
    actor.visible = visible;
    if (visible) {
      actor.queue_relayout();
      actor.get_parent()?.queue_relayout();
    }
  } catch (_) {   }
}





























// A/B: global._lgGlass.diffWrites(false) restores the unconditional writes.
let _diffWritesEnabled = true;

export function setDiffWritesEnabled(enabled: boolean): void {
  _diffWritesEnabled = !!enabled;
}

export function isDiffWritesEnabled(): boolean {
  return _diffWritesEnabled;
}

interface CloneWriteCache {
  _lgTx?: number;
  _lgTy?: number;
  _lgW?: number;
  _lgH?: number;
  _lgSx?: number;
  _lgSy?: number;
  _lgPx?: number;
  _lgPy?: number;
  _lgOpacity?: number;
}


export function invalidateCloneWriteCache(actor: any): void {
  if (!actor) return;
  const c = actor as CloneWriteCache;
  c._lgTx = c._lgTy = c._lgW = c._lgH = undefined;
  c._lgSx = c._lgSy = c._lgPx = c._lgPy = c._lgOpacity = undefined;
}

export function setTranslationIfChanged(actor: any, x: number, y: number): boolean {
  const c = actor as CloneWriteCache;
  if (_diffWritesEnabled && c._lgTx === x && c._lgTy === y) return false;
  c._lgTx = x; c._lgTy = y;
  actor.translation_x = x;
  actor.translation_y = y;
  return true;
}

export function setSizeIfChanged(actor: any, w: number, h: number): boolean {
  const c = actor as CloneWriteCache;
  if (_diffWritesEnabled && c._lgW === w && c._lgH === h) return false;
  c._lgW = w; c._lgH = h;
  actor.set_size(w, h);
  return true;
}

export function setScaleIfChanged(actor: any, sx: number, sy: number): boolean {
  const c = actor as CloneWriteCache;
  if (_diffWritesEnabled && c._lgSx === sx && c._lgSy === sy) return false;
  c._lgSx = sx; c._lgSy = sy;
  actor.set_scale(sx, sy);
  return true;
}

export function setPivotIfChanged(actor: any, px: number, py: number): boolean {
  const c = actor as CloneWriteCache;
  if (_diffWritesEnabled && c._lgPx === px && c._lgPy === py) return false;
  c._lgPx = px; c._lgPy = py;
  actor.set_pivot_point(px, py);
  return true;
}

export function setClipIfChanged(actor: any, x: number, y: number, w: number, h: number): boolean {
  const c = actor as any;
  if (_diffWritesEnabled &&
      c._lgClipX === x && c._lgClipY === y && c._lgClipW === w && c._lgClipH === h) return false;
  c._lgClipX = x; c._lgClipY = y; c._lgClipW = w; c._lgClipH = h;
  actor.set_clip(x, y, w, h);
  return true;
}























































// A/B: global._lgGlass.captureClip(false) / .cloneCull(false).




















// monitor, say). Turn it on with global._lgGlass.captureClip(true).
let _captureClipEnabled = false;
let _cloneCullEnabled = true;

export function setCaptureClipEnabled(enabled: boolean): void {
  _captureClipEnabled = !!enabled;
}

export function isCaptureClipEnabled(): boolean {
  return _captureClipEnabled;
}

export function setCloneCullEnabled(enabled: boolean): void {
  _cloneCullEnabled = !!enabled;
}

export function isCloneCullEnabled(): boolean {
  return _cloneCullEnabled;
}






//   global._lgGlass.cullApp(false)      ApplicationManager._syncClones()


//   global._lgGlass.cullWindows(false)  WindowCloneManager.sync()


//   global._lgGlass.cullUi(false)       UILayerSampler.syncProperties()



let _cullApp = true;
let _cullWindows = true;
let _cullUi = true;

export function setCullSiteEnabled(site: 'app' | 'windows' | 'ui', enabled: boolean): void {
  if (site === 'app') _cullApp = !!enabled;
  else if (site === 'windows') _cullWindows = !!enabled;
  else _cullUi = !!enabled;
}

export function isCullSiteEnabled(site: 'app' | 'windows' | 'ui'): boolean {
  if (!_cloneCullEnabled) return false;
  if (site === 'app') return _cullApp;
  if (site === 'windows') return _cullWindows;
  return _cullUi;
}


export type GlassRect = [number, number, number, number];


export function rectsIntersect(
  ax: number, ay: number, aw: number, ah: number,
  b: GlassRect
): boolean {
  return ax < b[0] + b[2] && ax + aw > b[0] &&
    ay < b[1] + b[3] && ay + ah > b[1];
}


export function unionRectInto(a: GlassRect, b: GlassRect): void {
  const x1 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.max(a[1] + a[3], b[1] + b[3]);
  a[0] = Math.min(a[0], b[0]);
  a[1] = Math.min(a[1], b[1]);
  a[2] = x1 - a[0];
  a[3] = y1 - a[1];
}

export function setPositionIfChanged(actor: any, x: number, y: number): boolean {
  const c = actor as any;
  if (_diffWritesEnabled && c._lgPosX === x && c._lgPosY === y) return false;
  c._lgPosX = x; c._lgPosY = y;
  actor.set_position(x, y);
  return true;
}



























export function setCloneCulled(actor: any, culled: boolean, why?: string): void {
  if (!actor) return;
  const wasCulled = !!actor._lgCulled;
  if (wasCulled === !!culled) return;
  actor._lgCulled = !!culled;







  if (why) {
    let name = '(?)';
    try { name = actor.get_name?.() || '(unnamed)'; } catch (_) { }
    utilsLog(`[Liquid Glass][cull] ${culled ? 'CULL ' : 'SHOW '} "${name}" ${why}`);
  }
  if (culled) {
    actor.opacity = 0;
  } else {


    actor._lgOpacity = undefined;
  }




















  try { actor.get_parent?.()?.queue_redraw(); } catch (_) {   }
}


export function isCloneCulled(actor: any): boolean {
  return !!(actor && actor._lgCulled);
}

export function setOpacityIfChanged(actor: any, opacity: number): boolean {
  const c = actor as CloneWriteCache;


  if ((actor as any)._lgCulled) return false;
  if (_diffWritesEnabled && c._lgOpacity === opacity) return false;
  c._lgOpacity = opacity;
  actor.opacity = opacity;
  return true;
}


















const _frameLoopErrorLastLogged: Map<string, number> = new Map();
const FRAME_LOOP_ERROR_LOG_INTERVAL_MS = 5000;
export function reportFrameLoopError(tag: string, e: unknown): void {
  try {
    const now = Date.now();
    const last = _frameLoopErrorLastLogged.get(tag) ?? 0;
    if (now - last < FRAME_LOOP_ERROR_LOG_INTERVAL_MS) return;
    _frameLoopErrorLastLogged.set(tag, now);
    console.error(`[Liquid Glass] exception in ${tag} frame sync (loop kept alive): ${e}`);
    const stack = (e as any)?.stack;
    if (stack) console.error(`[Liquid Glass] ${stack}`);
  } catch (_) {   }
}




















export interface RgbColor { r: number; g: number; b: number; }

export function crossFadeColorAt(
  start: RgbColor, startAlpha: number,
  target: RgbColor, targetAlpha: number,
  progress: number
): { r: number; g: number; b: number; a: number } {
  const p = Math.max(0, Math.min(1, progress));
  if (p < 0.5) {
    const local = p / 0.5;

    const a = startAlpha * (1 - local * local);
    return { r: start.r, g: start.g, b: start.b, a };
  }
  const local = (p - 0.5) / 0.5;

  const e = 1 - (1 - local) * (1 - local);
  return { r: target.r, g: target.g, b: target.b, a: targetAlpha * e };
}






const CROSS_FADE_LUMA_DELTA = 0.4;

export function shouldCrossFadeColors(start: RgbColor, target: RgbColor): boolean {
  const luma = (c: RgbColor) =>
    (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return Math.abs(luma(target) - luma(start)) > CROSS_FADE_LUMA_DELTA;
}







export function lerpColorAt(
  start: RgbColor, startAlpha: number,
  target: RgbColor, targetAlpha: number,
  progress: number
): { r: number; g: number; b: number; a: number } {
  const p = Math.max(0, Math.min(1, progress));
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  return {
    r: Math.round(start.r + (target.r - start.r) * e),
    g: Math.round(start.g + (target.g - start.g) * e),
    b: Math.round(start.b + (target.b - start.b) * e),
    a: startAlpha + (targetAlpha - startAlpha) * e,
  };
}







// global._lgGlass.textColorMode('rgb-lerp') / ('cross-fade').
export type AdaptiveColorMode = 'cross-fade' | 'rgb-lerp';

let _adaptiveColorMode: AdaptiveColorMode = 'cross-fade';

export function setAdaptiveColorMode(mode: AdaptiveColorMode): void {
  _adaptiveColorMode = mode === 'rgb-lerp' ? 'rgb-lerp' : 'cross-fade';
}

export function getAdaptiveColorMode(): AdaptiveColorMode {
  return _adaptiveColorMode;
}





export function resolveCrossFade(start: RgbColor, target: RgbColor): boolean {
  return _adaptiveColorMode === 'cross-fade' && shouldCrossFadeColors(start, target);
}























interface ColorTweenEntry {
  startRgb: RgbColor;
  startAlpha: number;
  targetRgb: RgbColor;
  targetAlpha: number;
  crossFade: boolean;
  durationMs: number;
  startTime: number;


  apply: (r: number, g: number, b: number, a: number, progress: number) => void;




  coalesce?: boolean;
  last?: { r: number; g: number; b: number; a: number };
}

class AdaptiveColorTweener {
  private _entries: Map<any, ColorTweenEntry> = new Map();
  private _laterId: number = 0;






  add(actor: any, entry: Omit<ColorTweenEntry, 'startTime' | 'last'>, batchStart?: number): void {
    if (!actor) return;
    const prev = this._entries.get(actor);



    const startRgb = prev?.last
      ? { r: prev.last.r, g: prev.last.g, b: prev.last.b }
      : entry.startRgb;
    const startAlpha = prev?.last ? prev.last.a : entry.startAlpha;

    this._entries.set(actor, {
      ...entry,
      startRgb,
      startAlpha,
      crossFade: entry.crossFade && shouldCrossFadeColors(startRgb, entry.targetRgb),
      startTime: batchStart ?? GLib.get_monotonic_time(),
    });
    this._schedule();
  }

  cancel(actor: any): void {
    this._entries.delete(actor);
  }

  stopAll(): void {
    this._entries.clear();
    this._unschedule();
  }

  isAnimating(actor: any): boolean {
    return this._entries.has(actor);
  }

  private _schedule(): void {
    if (this._laterId !== 0) return;
    try {
      this._laterId = (global as any).compositor.get_laters().add(
        Meta.LaterType.BEFORE_REDRAW,
        () => { this._tick(); return false; }
      );
    } catch (_) {
      this._laterId = 0;
    }
  }

  private _unschedule(): void {
    if (this._laterId === 0) return;
    try { (global as any).compositor.get_laters().remove(this._laterId); } catch (_) { }
    this._laterId = 0;
  }

  private _tick(): void {
    this._laterId = 0;
    const now = GLib.get_monotonic_time();

    for (const [actor, e] of [...this._entries]) {
      if (!isActorValid(actor)) { this._entries.delete(actor); continue; }

      const elapsedMs = (now - e.startTime) / 1000;
      const progress = e.durationMs > 0 ? Math.min(elapsedMs / e.durationMs, 1) : 1;
      const c = e.crossFade
        ? crossFadeColorAt(e.startRgb, e.startAlpha, e.targetRgb, e.targetAlpha, progress)
        : lerpColorAt(e.startRgb, e.startAlpha, e.targetRgb, e.targetAlpha, progress);
      const a = Math.max(0, Math.min(1, c.a));




      const same = e.coalesce !== false && e.last &&
        e.last.r === c.r && e.last.g === c.g && e.last.b === c.b &&
        Math.abs(e.last.a - a) < 0.002;
      if (!same) {
        e.last = { r: c.r, g: c.g, b: c.b, a };
        try { e.apply(c.r, c.g, c.b, a, progress); } catch (_) { }
      }

      if (progress >= 1) this._entries.delete(actor);
    }

    if (this._entries.size > 0) this._schedule();
  }
}

export const adaptiveColorTweener = new AdaptiveColorTweener();


























// global._lgGlass.nestedFix('off' | 'recapture' | 'propagate').
export type NestedGlassFix = 'off' | 'recapture' | 'propagate' | 'damage';



















let _nestedGlassFix: NestedGlassFix = 'off';

const NESTED_FIX_MODES: NestedGlassFix[] = ['off', 'recapture', 'propagate', 'damage'];

export function setNestedGlassFix(mode: NestedGlassFix): void {
  _nestedGlassFix = NESTED_FIX_MODES.includes(mode) ? mode : 'off';
}

export function getNestedGlassFix(): NestedGlassFix {
  return _nestedGlassFix;
}




















// global._lgGlass.focusDebug(true).
let _focusDebugEnabled = false;

export function setFocusDebugEnabled(on: boolean): void { _focusDebugEnabled = !!on; }
export function isFocusDebugEnabled(): boolean { return _focusDebugEnabled; }

export function innerGlassEffectOf(windowActor: any): any | null {
  try {
    if (!windowActor || !isActorValid(windowActor)) return null;
    for (const c of windowActor.get_children()) {
      if ((c.name || '') !== 'lgw-bg') continue;
      const fx = c.get_effects()[0];
      if (fx && typeof fx._recaptureSerial === 'number') return fx;
    }
  } catch (_) {   }
  return null;
}

























export function getAllocatedSize(actor: Clutter.Actor): [number, number] {
  try {
    const box = actor.get_allocation_box();
    const w = box.get_width();
    const h = box.get_height();
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return [w, h];
    }
  } catch (_) {   }



  try {
    const [w, h] = actor.get_size();
    return [w, h];
  } catch (_) {
    return [0, 0];
  }
}























export function getTransformedRect(actor: Clutter.Actor): [number, number, number, number] {
  try {
    const r = actor.get_transformed_extents();
    const x = r.origin.x, y = r.origin.y;
    const w = r.size.width, h = r.size.height;
    if (Number.isFinite(x) && Number.isFinite(y) &&
      Number.isFinite(w) && Number.isFinite(h)) {
      return [x, y, w, h];
    }
  } catch (_) {   }

  try {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = getAllocatedSize(actor);
    return [x, y, w, h];
  } catch (_) {
    return [0, 0, 0, 0];
  }
}










































export function computeCaptureLayout(
  actor: Clutter.Actor | null, srcW: number, srcH: number,
  allocW: number, allocH: number
): { uv: number[]; dest: number[] } {
  const centredFallback = (): { uv: number[]; dest: number[] } => {
    const padW = srcW - allocW;
    const padH = srcH - allocH;
    if (padW === 0 && padH === 0) {
      return { uv: [0, 0, 1, 1], dest: [0, 0, allocW, allocH] };
    }
    const x0 = padW / 2, y0 = padH / 2;
    return {
      uv: [
        x0 / srcW, y0 / srcH,
        Math.min(1.0, (x0 + allocW) / srcW),
        Math.min(1.0, (y0 + allocH) / srcH),
      ],
      dest: [x0, y0, x0 + allocW, y0 + allocH],
    };
  };

  if (!actor) return centredFallback();





  let rawX1 = 0, rawY1 = 0, rawX2 = allocW, rawY2 = allocH;
  try {
    const pv = (actor as any).get_paint_volume?.();
    if (pv) {
      const origin = pv.get_origin();
      rawX1 = origin.x;
      rawY1 = origin.y;
      rawX2 = rawX1 + pv.get_width();
      rawY2 = rawY1 + pv.get_height();
    }
  } catch (e) {

  }
  if (!Number.isFinite(rawX1) || !Number.isFinite(rawY1) ||
    !Number.isFinite(rawX2) || !Number.isFinite(rawY2)) {
    return centredFallback();
  }


  const nearbyint = (v: number) => Math.trunc(v < 0 ? v - 0.5 : v + 0.5);

  let x1 = rawX1, y1 = rawY1, x2 = rawX2, y2 = rawY2;

  if ((rawX2 - rawX1) * (rawY2 - rawY1) !== 0) {
    const w = nearbyint(rawX2 - rawX1);
    const h = nearbyint(rawY2 - rawY1);
    x2 = Math.ceil(rawX2 + 0.75);
    y2 = Math.ceil(rawY2 + 0.75);
    x1 = x2 - w - 3;
    y1 = y2 - h - 3;
  }

  const boxW = x2 - x1;
  const boxH = y2 - y1;
  if (!(boxW > 0) || !(boxH > 0)) return centredFallback();




  const fboOffX = Math.trunc(x1);
  const fboOffY = Math.trunc(y1);





  const scale = Math.max(1, Math.round(srcW / boxW));
  if (Math.ceil(boxW * scale) !== srcW || Math.ceil(boxH * scale) !== srcH) {
    return centredFallback();
  }

  const padLeft = -fboOffX * scale;
  const padTop = -fboOffY * scale;
  const contentW = allocW * scale;
  const contentH = allocH * scale;

  if (!(padLeft >= 0) || !(padTop >= 0) ||
    padLeft + contentW > srcW || padTop + contentH > srcH) {
    return centredFallback();
  }

  return {
    uv: [
      padLeft / srcW, padTop / srcH,
      (padLeft + contentW) / srcW, (padTop + contentH) / srcH,
    ],
    dest: [padLeft, padTop, padLeft + contentW, padTop + contentH],
  };
}









































export class SelfExcludingSnapshotCapture {
  private _content: any = null;
  private _rectGetter: () => [number, number, number, number];

  private _hideActors: Set<Clutter.Actor> = new Set();
  private _stage: Clutter.Stage;
  private _refCount: number = 0;
  private _afterPaintId: number = 0;
  private _destroyed: boolean = false;






  private static readonly FRAME_SKIP = 1;
  private _frameCounter: number = 0;







  private _label: string;
  private _failCount: number = 0;
  private _okCount: number = 0;






  private _activeCheck: (() => boolean) | null;

  constructor(
    stage: Clutter.Stage, hideActor: Clutter.Actor,
    rectGetter: () => [number, number, number, number],
    label: string = 'snapshot',
    activeCheck: (() => boolean) | null = null
  ) {
    this._stage = stage;
    this._label = label;
    this._activeCheck = activeCheck;
    if (hideActor) this._hideActors.add(hideActor);
    this._rectGetter = rectGetter;
    this._captureOnce();
    try {
      this._afterPaintId = (this._stage as any).connect('after-paint', () => {
        if (this._destroyed) return;
        this._frameCounter++;
        if (this._frameCounter % SelfExcludingSnapshotCapture.FRAME_SKIP !== 0) return;
        this._captureOnce();
      });
    } catch (e) {
    }
  }

  retain(): void { this._refCount++; }
  release(): boolean {
    this._refCount--;
    if (this._refCount <= 0) { this.destroy(); return true; }
    return false;
  }


  addHideActor(actor: Clutter.Actor | null | undefined): void {
    if (actor) this._hideActors.add(actor);
  }


  removeHideActor(actor: Clutter.Actor | null | undefined): void {
    if (actor) this._hideActors.delete(actor);
  }


  private _report(kind: string, detail: string): void {
    this._failCount++;
    if (this._failCount <= 2 || this._failCount % 300 === 0) {
      console.warn(
        `[Liquid Glass][snapshot:${this._label}] ${kind} (failures=${this._failCount}, ` +
        `successes=${this._okCount}): ${detail}`
      );
    }
  }

  private _captureOnce(): void {
    if (this._activeCheck) {
      try {
        if (!this._activeCheck()) return;
      } catch (e) {
        return;
      }
    }

    const [x, y, w, h] = this._rectGetter();
    if (w <= 0 || h <= 0) {
      this._report('empty capture rect', `x=${x} y=${y} w=${w} h=${h}`);
      return;
    }



    const hidden: Clutter.Actor[] = [];
    try {
      for (const actor of this._hideActors) {
        try {
          if (actor && actor.visible) {
            actor.hide();
            hidden.push(actor);
          }
        } catch (_) {   }
      }

      const rect = new Mtk.Rectangle({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
      const scale = 1;








      const NO_CURSORS = (Clutter as any).PaintFlag?.NO_CURSORS ?? 0;
      const CLEAR = (Clutter as any).PaintFlag?.CLEAR ?? 0;
      const paintFlags = NO_CURSORS | CLEAR;
      const content = (this._stage as any).paint_to_content?.(rect, scale, null, paintFlags);
      if (content) {
        this._content = content;
        this._okCount++;
      } else {
        this._report('paint_to_content returned null',
          `rect=${rect.x},${rect.y} ${rect.width}x${rect.height}`);
      }
    } catch (e) {
      this._report('paint_to_content threw', `${e}`);
    } finally {
      for (const actor of hidden) {
        try { actor.show(); } catch (_) {   }
      }
    }
  }

  getContent(): any | null {
    return this._content;
  }

  destroy(): void {
    this._destroyed = true;
    if (this._afterPaintId) {
      try { (this._stage as any).disconnect(this._afterPaintId); } catch (_) {   }
      this._afterPaintId = 0;
    }
  }
}




const _selfExcludingSnapshotRegistry: Map<Clutter.Actor, SelfExcludingSnapshotCapture> = new Map();

function acquireSelfExcludingSnapshot(
  sourceActor: Clutter.Actor,
  stage: Clutter.Stage,
  hideActor: Clutter.Actor,
  rectGetter: () => [number, number, number, number],
  label: string = 'bms'
): SelfExcludingSnapshotCapture {
  let cap = _selfExcludingSnapshotRegistry.get(sourceActor);
  if (!cap) {
    cap = new SelfExcludingSnapshotCapture(stage, hideActor, rectGetter, label);
    _selfExcludingSnapshotRegistry.set(sourceActor, cap);
  } else {
    cap.addHideActor(hideActor);
  }
  cap.retain();
  return cap;
}

function releaseSelfExcludingSnapshot(sourceActor: Clutter.Actor, hideActor?: Clutter.Actor): void {
  const cap = _selfExcludingSnapshotRegistry.get(sourceActor);
  if (!cap) return;



  cap.removeHideActor(hideActor);
  if (cap.release()) {
    _selfExcludingSnapshotRegistry.delete(sourceActor);
  }
}





export const UnpickableClone = GObject.registerClass(
  class UnpickableClone extends Clutter.Clone {
    vfunc_pick(_pickContext: any): void {

    }
  }
);






export const UnpickableActor = GObject.registerClass(
  class UnpickableActor extends Clutter.Actor {
    vfunc_pick(_pickContext: any): void {

    }
  }
);






























































































































export const BackgroundMirror = GObject.registerClass(
  class BackgroundMirror extends Clutter.Actor {
    declare _mirrors: Map<any, any>;
    declare _groupHandlers: number[];
    declare _sourceGroup: any;

    _init(params: any = {}): void {
      super._init(params);
      this._mirrors = new Map();
      this._groupHandlers = [];
      this._sourceGroup = null;

      const group = Main.layoutManager?._backgroundGroup ?? null;
      if (!group) return;
      this._sourceGroup = group;

      this._groupHandlers.push(
        group.connect('child-added', (_g: any, child: any) => this._addMirror(child)),
        group.connect('child-removed', (_g: any, child: any) => this._removeMirror(child)),



















        group.connect('notify::first-child', () => this._restack()),
        group.connect('notify::last-child', () => this._restack())
      );
      if (Main.layoutManager) {
        this._groupHandlers.push(
          Main.layoutManager.connect('monitors-changed', () => this._onMonitorsChanged())
        );
      }
      this.connect('destroy', () => this._onDestroy());

      for (const child of group.get_children()) this._addMirror(child);
    }





    _contentProps(): string[] {
      return [
        'background',
        'brightness',
        'vignette',
        'vignette-sharpness',
        'gradient',
        'gradient-height',
        'gradient-max-darkness',
        'rounded-clip-radius',
      ];
    }

    _addMirror(child: any): void {
      try {
        this._addMirrorUnsafe(child);
      } catch (e) {



        utilsLog(`[bg-mirror] _addMirror failed: ${e}`);
      }
    }

    _addMirrorUnsafe(child: any): void {
      if (!child || this._mirrors.has(child)) return;
      const srcContent = child.content;




      if (!srcContent || !(srcContent instanceof Meta.BackgroundContent)) return;

      let mirror: any;
      try {
        mirror = new Meta.BackgroundActor({
          meta_display: global.display,
          monitor: child.monitor,
          reactive: false,
        });
      } catch (e) {
        utilsLog(`[bg-mirror] could not create Meta.BackgroundActor: ${e}`);
        return;
      }
      mirror.set_name('lg-bg-mirror');























      mirror.visible = false;

      const dstContent = mirror.content;
      if (dstContent) {
        for (const prop of this._contentProps()) {
          try {
            srcContent.bind_property(prop, dstContent, prop, GObject.BindingFlags.SYNC_CREATE);
          } catch (e) {


            utilsLog(`[bg-mirror] skipped content prop '${prop}': ${e}`);
          }
        }



        try {
          if (!dstContent.background && srcContent.background)
            dstContent.set_background(srcContent.background);
        } catch (e) {
          utilsLog(`[bg-mirror] set_background failed: ${e}`);
        }
      }

      try {
        child.bind_property('opacity', mirror, 'opacity', GObject.BindingFlags.SYNC_CREATE);
      } catch (e) {
        utilsLog(`[bg-mirror] opacity binding failed: ${e}`);
      }



      const syncVisible = () => {
        if (!isActorValid(mirror)) return;
        let hasBackground = false;
        try { hasBackground = !!(mirror.content && mirror.content.background); } catch (_) {   }
        const wanted = hasBackground && isActorValid(child) && child.visible;
        if (mirror.visible !== wanted) mirror.visible = wanted;
      };
      const watchers: Array<[any, number]> = [];
      try {
        watchers.push([child, child.connect('notify::visible', syncVisible)]);





        watchers.push([child, child.connect('notify::opacity', () => this._restack())]);
        if (dstContent)
          watchers.push([dstContent, dstContent.connect('notify::background', syncVisible)]);
      } catch (e) {
        utilsLog(`[bg-mirror] visibility watchers failed: ${e}`);
      }
      mirror.connect('destroy', () => {
        for (const [obj, id] of watchers) {
          try { obj.disconnect(id); } catch (_) {   }
        }
        watchers.length = 0;
      });
      syncVisible();





      mirror.set_position(child.x, child.y);
      mirror.set_size(child.width, child.height);






      for (const coordinate of [
        Clutter.BindCoordinate.X,
        Clutter.BindCoordinate.Y,
        Clutter.BindCoordinate.WIDTH,
        Clutter.BindCoordinate.HEIGHT,
      ]) {
        mirror.add_constraint(new Clutter.BindConstraint({ source: child, coordinate }));
      }

      this._mirrors.set(child, mirror);
      this.add_child(mirror);


      this._restack();
    }

    _removeMirror(child: any): void {
      const mirror = this._mirrors.get(child);
      if (!mirror) return;
      this._mirrors.delete(child);
      if (isActorValid(mirror)) mirror.destroy();
    }






    _restack(): void {
      if (!isActorValid(this._sourceGroup)) return;

      const wanted: any[] = [];
      for (const child of this._sourceGroup.get_children()) {
        const mirror = this._mirrors.get(child);
        if (mirror && isActorValid(mirror)) wanted.push(mirror);
      }

      const current = this.get_children();
      let ordered = current.length === wanted.length;
      if (ordered) {
        for (let i = 0; i < wanted.length; i++) {
          if (current[i] !== wanted[i]) { ordered = false; break; }
        }
      }
      if (ordered) return;

      for (let i = 0; i < wanted.length; i++) this.set_child_at_index(wanted[i], i);


      utilsLog(`[bg-mirror] restacked ${wanted.length} wallpaper mirror(s)`);
    }

    _onMonitorsChanged(): void {
      if (!isActorValid(this._sourceGroup)) return;
      try {
        this.set_size(this._sourceGroup.width, this._sourceGroup.height);
      } catch (_) {}
      for (const [child, mirror] of this._mirrors) {
        if (isActorValid(mirror)) {
          try { mirror.destroy(); } catch (_) {}
        }
      }
      this._mirrors.clear();
      for (const child of this._sourceGroup.get_children()) {
        this._addMirror(child);
      }
      this._restack();
    }

    _onDestroy(): void {
      for (const id of this._groupHandlers) {
        try {
          if (isActorValid(this._sourceGroup))
            this._sourceGroup.disconnect(id);
        } catch (_) {}
        try {
          Main.layoutManager?.disconnect(id);
        } catch (_) {}
      }
      this._groupHandlers = [];
      this._mirrors.clear();
      this._sourceGroup = null;
    }

    vfunc_pick(_pickContext: any): void {

    }
  }
);






let _backgroundMirrorEnabled = true;
export function setBackgroundMirrorEnabled(enabled: boolean): void {
  _backgroundMirrorEnabled = !!enabled;
}
export function isBackgroundMirrorEnabled(): boolean {
  return _backgroundMirrorEnabled;
}







const wallpaperRegistry = ((globalThis as any).__macw1yGlassWallpaper ??= { source: null });

function ensureSharedBackgroundSource(): any {
  const current = getSharedBackgroundSource();
  if (current) return current;
  const uiGroup = Main.layoutManager?.uiGroup;
  const group = Main.layoutManager?._backgroundGroup;
  if (!uiGroup || !group) return null;

  const source: any = new BackgroundMirror();
  source.set_name('lg-bg-mirror-source');
  source.set_position(-10000, -10000);
  source.set_size(group.width, group.height);



  for (const coordinate of [Clutter.BindCoordinate.WIDTH, Clutter.BindCoordinate.HEIGHT]) {
    try {
      source.add_constraint(new Clutter.BindConstraint({ source: group, coordinate }));
    } catch (e) {
      utilsLog(`[bg-mirror] source size constraint failed: ${e}`);
    }
  }




  // NEVER placed in global.window_group, which breaks Mutter window stacking.
  source.opacity = 255;
  source.reactive = false;
  source._glassCloneCount = 0;
  uiGroup.add_child(source);
  wallpaperRegistry.source = source;
  source.connect('destroy', () => {
    if (wallpaperRegistry.source === source) wallpaperRegistry.source = null;
  });
  return source;
}

























































export const CullOptOutEffect = GObject.registerClass(



  class CullOptOutEffect extends Clutter.Effect {}
);

const CULL_OPT_OUT_NAME = 'lg-cull-opt-out';
const _cullOptOutOwners: Map<any, Set<any>> = new Map();
const _cullOptOutEffects: Map<any, any> = new Map();
let _cullOptOutEnabled = true;

function _reconcileCullOptOut(): void {
  const before = _cullOptOutEffects.size;
  const wanted = new Set<any>();
  if (_cullOptOutEnabled) {
    for (const actors of _cullOptOutOwners.values()) {
      for (const actor of actors) {
        if (isActorValid(actor)) wanted.add(actor);
      }
    }
  }

  for (const actor of wanted) {
    if (_cullOptOutEffects.has(actor)) continue;
    try {
      const effect: any = new CullOptOutEffect();
      actor.add_effect_with_name(CULL_OPT_OUT_NAME, effect);
      _cullOptOutEffects.set(actor, effect);
    } catch (e) {
      utilsLog(`[cull-opt-out] could not attach: ${e}`);
    }
  }

  for (const [actor, effect] of [..._cullOptOutEffects.entries()]) {
    if (wanted.has(actor)) continue;
    _cullOptOutEffects.delete(actor);
    try {
      if (isActorValid(actor)) actor.remove_effect(effect);
    } catch (_) {   }
  }

  if (_cullOptOutEffects.size !== before) {


    utilsLog(`[cull-opt-out] holding ${_cullOptOutEffects.size} window actor(s)` +
      ` [${[..._cullOptOutEffects.keys()].map(a => {
        try { return a.get_meta_window()?.get_title() ?? '?'; } catch (_) { return '?'; }
      }).join(', ')}]`);
  }
}

function _sameSet(a: Set<any> | undefined, b: Iterable<any>): boolean {
  if (!a) return false;
  let n = 0;
  for (const x of b) {
    if (!a.has(x)) return false;
    n++;
  }
  return n === a.size;
}





export function reportClonedWindowActors(owner: any, actors: Iterable<any>): void {
  if (_sameSet(_cullOptOutOwners.get(owner), actors)) return;
  _cullOptOutOwners.set(owner, new Set(actors));
  _reconcileCullOptOut();
}


export function releaseClonedWindowActors(owner: any): void {
  if (_cullOptOutOwners.delete(owner)) _reconcileCullOptOut();
}


export function releaseAllClonedWindowActors(): void {
  _cullOptOutOwners.clear();
  _reconcileCullOptOut();
}




export function setCullOptOutEnabled(enabled: boolean): void {
  _cullOptOutEnabled = !!enabled;
  _reconcileCullOptOut();
}
export function isCullOptOutEnabled(): boolean {
  return _cullOptOutEnabled;
}


export function getSharedBackgroundSource(): any {
  const source = wallpaperRegistry.source;
  return isActorValid(source) ? source : null;
}

export function destroySharedBackgroundSource(): void {
  const source = getSharedBackgroundSource();
  if (source && source._glassCloneCount === 0) source.destroy();
}









export function createBackgroundMirror(name: string): Clutter.Actor {
  let source: any = null;
  if (_backgroundMirrorEnabled) {
    try {
      source = ensureSharedBackgroundSource();
    } catch (e) {
      utilsLog(`[bg-mirror] shared source unavailable, falling back: ${e}`);
      source = null;
    }
  }
  if (!source) source = Main.layoutManager._backgroundGroup;

  const clone: any = new UnpickableClone({ source });
  if (source && source === wallpaperRegistry.source) {
    source._glassCloneCount++;
    clone.connect('destroy', () => {
      if (wallpaperRegistry.source !== source) return;
      if (--source._glassCloneCount === 0 && !source._glassReleasePending) {
        source._glassReleasePending = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (wallpaperRegistry.source === source) {
            source._glassReleasePending = false;
            destroySharedBackgroundSource();
          }
          return GLib.SOURCE_REMOVE;
        });
      }
    });
  }
  clone.set_name(name);
  return clone;
}















export const UnpickableStyledWidget = GObject.registerClass(
  class UnpickableStyledWidget extends St.Widget {
    vfunc_pick(_pickContext: any): void {

    }
  }
);



































export const LayoutOpaqueActor = GObject.registerClass(
  class LayoutOpaqueActor extends UnpickableActor {
    vfunc_get_preferred_width(_forHeight: number): [number, number] {
      return [0, 0];
    }
    vfunc_get_preferred_height(_forWidth: number): [number, number] {
      return [0, 0];
    }
  }
);





export const UnpickableWidget = GObject.registerClass(
  class UnpickableWidget extends St.Widget {
    vfunc_pick(_pickContext: any): void {

    }
  }
);









export const TextureBlitActor = GObject.registerClass({
  GTypeName: 'LiquidGlassTextureBlitActor',
}, class TextureBlitActor extends Clutter.Actor {

  declare private _getTexture: (() => Cogl.Texture2D | null) | null;
  declare private _sourceActor: Clutter.Actor | null;
  declare private _pipeline: Cogl.Pipeline | null;

  _init(params: any = {}) {
    super._init(params);
    this._getTexture = null;
    this._sourceActor = null;
    this._pipeline = null;
  }

  vfunc_pick(_pickContext: any): void { }

  setTextureGetter(fn: () => Cogl.Texture2D | null): void {
    this._getTexture = fn;
  }

  setSourceActor(actor: Clutter.Actor): void {
    this._sourceActor = actor;
  }

  private _getCoglContext(): Cogl.Context | null {
    try {
      const backend = typeof Clutter.get_default_backend === 'function'
        ? Clutter.get_default_backend()
        : (global.stage?.get_context?.() || global.stage?.context)?.get_backend?.() || global.backend;
      return backend?.get_cogl_context?.() as Cogl.Context;
    } catch (e) {
      return null;
    }
  }

  vfunc_paint(paintContext: Clutter.PaintContext): void {
    if (!this._getTexture) return;
    const tex = this._getTexture();
    if (!tex) return;

    try {
      if (!this._pipeline) {
        const ctx = this._getCoglContext();
        if (!ctx) return;
        this._pipeline = Cogl.Pipeline.new(ctx);
        this._pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        this._pipeline.set_layer_filters(
          0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR
        );
      }

      const texW = tex.get_width();
      const texH = tex.get_height();






      let uMin = 0, vMin = 0, uMax = 1, vMax = 1;
      const src = this._sourceActor;
      if (src) {
        const [rawW, rawH] = getAllocatedSize(src);
        const allocW = Number.isFinite(rawW) && rawW > 0 ? Math.round(rawW) : texW;
        const allocH = Number.isFinite(rawH) && rawH > 0 ? Math.round(rawH) : texH;

        if ((allocW !== texW || allocH !== texH) && texW > 0 && texH > 0) {
          const uv = computeCaptureLayout(src, texW, texH, allocW, allocH).uv;
          uMin = uv[0]; vMin = uv[1]; uMax = uv[2]; vMax = uv[3];
        }
      }

      this._pipeline.set_layer_texture(0, tex);

      const [w, h] = this.get_size();
      if (!(w > 0) || !(h > 0)) return;

      const fb = paintContext.get_framebuffer() as unknown as Cogl.Framebuffer;
      fb.draw_textured_rectangle(this._pipeline, 0, 0, w, h, uMin, vMin, uMax, vMax);
    } catch (e) {
    }
  }
});
export type TextureBlitActor = InstanceType<typeof TextureBlitActor>;







/**
 * How UILayerSampler supplies a uiGroup child that has a Blur My Shell target
 * under it.
 *
 * Neither of the first two is right, and which one is in use decides which
 * symptom appears — measured in a native session by toggling the two
 * extensions on in either order:
 *
 *   SNAPSHOT — Liquid Glass sees BMS at clone time and takes a self-excluding
 *     stage snapshot of the child's rect. BMS itself keeps working, but the
 *     snapshot is of the WHOLE stage cropped to that rect, so anything else
 *     overlapping it is captured too: with the dock moved to the top edge it
 *     overlaps the panel and its icons show up as ghosts inside the dock's own
 *     glass. The window texture lag was reported in this configuration as well.
 *
 *   CLONE — Liquid Glass was enabled first, found no BMS target, and made an
 *     ordinary Clutter.Clone. No ghosts and no lag, but BMS's own panel
 *     rendering drifts by about 10px wherever the dock overlaps the panel:
 *     Shell.BlurEffect in background mode samples the framebuffer under the
 *     actor, and painting that actor a second time inside our offscreen gives
 *     it a second, differently-positioned consumer.
 *
 *   SKIP — leave the child out of the glass entirely. No ghosts, no lag, BMS
 *     untouched; the cost is that the panel simply does not appear in the
 *     blurred backdrop.
 *
 * Switchable at runtime (global._lgGlass.bmsMode(n)) so the attribution can be
 * settled inside one session instead of by rebuilding between orders.
 */
export const BMS_MODE = { SNAPSHOT: 0, CLONE: 1, SKIP: 2, REPLICATE: 3 };





































let _bmsMode: number = BMS_MODE.REPLICATE;


const _liveSamplers: Set<UILayerSampler> = new Set();

export function setBmsMode(mode: number): string {
  _bmsMode = mode;
  let n = 0;
  for (const sampler of _liveSamplers) {
    try { sampler.rebuildBmsClones(); n++; } catch (_) { }
  }
  const name = mode === BMS_MODE.SNAPSHOT ? 'SNAPSHOT'
    : mode === BMS_MODE.CLONE ? 'CLONE'
      : mode === BMS_MODE.SKIP ? 'SKIP'
        : mode === BMS_MODE.REPLICATE ? 'REPLICATE' : `? (${mode})`;
  const msg = `[Liquid Glass] BMS mode = ${name} on ${n} sampler(s)`;
  console.log(msg);
  return msg;
}

export function getBmsMode(): number {
  return _bmsMode;
}

export class UILayerSampler {
  private readonly _selfActor: Clutter.Actor;
  private readonly _container: Clutter.Actor;
  private readonly _extraExclusions: Set<Clutter.Actor>;

  private _selfRoot: Clutter.Actor | null = null;
  private _label: string = '?';


  private _bmsStateAtClone: Map<Clutter.Actor, boolean> = new Map();

  private _lastBmsTarget: Clutter.Actor | null | undefined = undefined;
  private _ancestorExclusionSources: Clutter.Actor[] = [];


  private _clonedNamesLogged: string = '';
  private _clones: Map<Clutter.Actor, Clutter.Actor> = new Map();
  private _uiClonesContainer: Clutter.Actor | null = null;





  private _existingEffectCache: Map<Clutter.Actor, { actor: Clutter.Actor; effect: Clutter.OffscreenEffect } | null> = new Map();





  // falls through — this toggle mainly matters for *other* extensions that

  private _useCaptureFixForBms: boolean = true;




  private _delayedCaptureOwners: Map<Clutter.Actor, { source: Clutter.Actor; hideActor: Clutter.Actor }> = new Map();



  private _driftingClones: Set<Clutter.Actor> = new Set();




  private _cullRect: GlassRect | null = null;












  private _bmsScreenRects: GlassRect[] = [];

  constructor(
    selfActor: Clutter.Actor,
    container: Clutter.Actor,
    extraExclusions: Clutter.Actor[] = [],
    cloneContainer: Clutter.Actor | null = null,
    label: string = '?',













    ancestorExclusions: Clutter.Actor[] = []
  ) {
    this._selfActor = selfActor;
    this._container = container;
    this._extraExclusions = new Set(extraExclusions);
    this._ancestorExclusionSources = ancestorExclusions.slice();
    this._label = label;
    this._selfRoot = this._findUiGroupAncestor(selfActor);
    _liveSamplers.add(this);

    this._uiClonesContainer = new UnpickableActor();
    this._uiClonesContainer.set_name("ui-clones-container");


    this._uiClonesContainer.connect('destroy', () => {
      this._uiClonesContainer = null;
    });

    if (cloneContainer) {
      cloneContainer.add_child(this._uiClonesContainer);
    } else {
      this._container.add_child(this._uiClonesContainer);
    }
  }





  setCullRect(rect: GlassRect | null): void {
    this._cullRect = rect;
  }







  getBmsScreenRects(): GlassRect[] {
    return this._bmsScreenRects;
  }


  hasUnmeasuredBmsReplica(): boolean {
    if (this._bmsScreenRects.length > 0) return false;
    for (const clone of this._clones.values()) {
      if ((clone as any)._lgBmsReplica) return true;
    }
    return false;
  }

  private _findUiGroupAncestor(actor: Clutter.Actor): Clutter.Actor | null {
    const uiGroup = Main.layoutManager.uiGroup;
    let current: Clutter.Actor | null = actor;
    while (current) {
      if (current.get_parent() === uiGroup) return current;
      current = current.get_parent();
    }
    return null;
  }


  addExclusion(actor: Clutter.Actor) {
    if (!actor) return;
    this._extraExclusions.add(actor);
  }








  private _resolveBmsTargetActor(): Clutter.Actor | null {
    try {
      const ext = (Main as any).extensionManager?.lookup?.('blur-my-shell@aunetx');
      const actor = ext?.stateObj?._panel_blur?.actors_list?.[0]?.bg_manager?.backgroundActor;
      return (actor as Clutter.Actor) ?? null;
    } catch (_) {
      return null;
    }
  }






  private _findBmsDescendant(child: Clutter.Actor): Clutter.Actor | null {
    const target = this._resolveBmsTargetActor();
    if (!target) return null;
    if (child === target) return target;
    try {
      if (typeof (child as any).contains === 'function' && (child as any).contains(target)) {
        return target;
      }
    } catch (_) {   }
    return null;
  }








  setDebugDisableBmsClone(_disabled: boolean): void {   }

  setDebugBmsProbeEnabled(_enabled: boolean): void {   }

























  private _createBmsReplicaActor(child: Clutter.Actor): Clutter.Actor | null {
    try {
      const target = this._findBmsDescendant(child);
      if (!target) return null;



      let bmsGroup: Clutter.Actor | null = target;
      while (bmsGroup && bmsGroup.get_parent() !== child) {
        bmsGroup = bmsGroup.get_parent();
      }
      if (!bmsGroup) return null;

      const container = new UnpickableActor();
      container.set_name(`${(child as any).name ?? 'bms'}-replica`);

      const blurWidget = new St.Widget({ name: 'lg-bms-replica-blur' });
      blurWidget.add_effect(this._buildReplicaBlurEffect(target));
      container.add_child(blurWidget);

      const parts: { src: Clutter.Actor, clone: Clutter.Actor }[] = [];
      for (const c of child.get_children()) {
        if (c === bmsGroup) continue;
        const clone = new UnpickableClone({ source: c });
        clone.set_name(`${(c as any).name ?? 'part'}-replicaClone`);
        container.add_child(clone);
        parts.push({ src: c, clone });
      }
      if (parts.length === 0) {
        container.destroy();
        return null;
      }

      (container as any)._lgBmsReplica = { blurWidget, parts, bmsTarget: target };
      utilsLog(`[Liquid Glass][ui-sampler:${this._label}] BMS replica built for ` +
        `name="${(child as any).name ?? '(unnamed)'}" with ${parts.length} part(s)`);
      return container;
    } catch (e) {
      reportFrameLoopError('UILayerSampler._createBmsReplicaActor', e);
      return null;
    }
  }






  private _captureOffset(): [number, number] {
    try {
      const off = (this._container as any)?._lgCaptureOffset;
      if (Array.isArray(off) && Number.isFinite(off[0]) && Number.isFinite(off[1]))
        return [off[0], off[1]];
    } catch (_) {   }
    return [0, 0];
  }



























  private _buildReplicaBlurEffect(bmsTarget: Clutter.Actor): Clutter.Effect {
    try {
      const theirs: any = (bmsTarget.get_effects() ?? [])
        .find((e: any) => typeof e?.radius === 'number');
      if (theirs) {
        const Ctor: any = Object.getPrototypeOf(theirs)?.constructor;
        if (typeof Ctor === 'function') {








          const cornerRadius =
            theirs.unscaled_corner_radius ?? theirs.corner_radius ?? 0;

          const params: any = {
            unscaled_radius: theirs.unscaled_radius ?? theirs.radius ?? 0,
            brightness: theirs.brightness ?? 1.0,
            corner_radius: cornerRadius,
          };

          const ours = new Ctor(params);
          utilsLog(`[Liquid Glass][ui-sampler:${this._label}] replica blur uses ` +
            `${Ctor.name ?? '?'} (matching BMS's own effect), ` +
            `unscaled_radius=${params.unscaled_radius} brightness=${params.brightness} ` +
            `corner_radius=${params.corner_radius}`);
          return ours as Clutter.Effect;
        }
      }
    } catch (e) {
      utilsLog(`[Liquid Glass][ui-sampler:${this._label}] could not mirror BMS's ` +
        `blur effect (${e}); falling back to Shell.BlurEffect`);
    }


    return new Shell.BlurEffect({
      mode: Shell.BlurMode.BACKGROUND,
      radius: 0,
      brightness: 1.0,
    }) as unknown as Clutter.Effect;
  }







  private _syncBmsReplica(source: Clutter.Actor, replica: any): void {
    try {
      const parts: { src: Clutter.Actor, clone: Clutter.Actor }[] = replica.parts;
      let panelRect: [number, number, number, number] | null = null;

      for (const { src, clone } of parts) {
        if (!isActorValid(src) || !isActorValid(clone)) continue;
        const [w, h] = getAllocatedSize(src);
        if (!(w > 0) || !(h > 0)) {
          setActorVisible(clone, false);
          continue;
        }
        setPositionIfChanged(clone, src.x, src.y);
        setSizeIfChanged(clone, w, h);
        setOpacityIfChanged(clone, src.opacity);
        setActorVisible(clone, src.visible && src.mapped);
        if (!panelRect) panelRect = [src.x, src.y, w, h];
      }

      const blurWidget: Clutter.Actor = replica.blurWidget;
      if (isActorValid(blurWidget) && panelRect) {
        replica.panelRect = panelRect;






















        const [offX, offY] = this._captureOffset();
        setPositionIfChanged(blurWidget, panelRect[0] + offX, panelRect[1] + offY);
        setSizeIfChanged(blurWidget, panelRect[2], panelRect[3]);
        setActorVisible(blurWidget, true);



        const src = replica.bmsTarget as Clutter.Actor;
        let ours = blurWidget.get_effects()[0] as any;
        if (ours && isActorValid(src)) {
          const theirs = (src.get_effects() ?? []).find(
            (e: any) => typeof e?.radius === 'number') as any;
          if (theirs) {





            if (Object.getPrototypeOf(ours)?.constructor !==
              Object.getPrototypeOf(theirs)?.constructor) {
              try {
                blurWidget.remove_effect(ours);
                blurWidget.add_effect(this._buildReplicaBlurEffect(src));
                ours = blurWidget.get_effects()[0] as any;
              } catch (_) {   }
            }

            if (ours.radius !== theirs.radius) ours.radius = theirs.radius;
            if (ours.brightness !== theirs.brightness) ours.brightness = theirs.brightness;
          }
        }
      }
      this._reportReplicaGeometry(source, replica);
    } catch (e) {
      reportFrameLoopError('UILayerSampler._syncBmsReplica', e);
    }
  }









  private _reportReplicaGeometry(source: Clutter.Actor, replica: any): void {
    if (!_utilsLogger) return;
    try {
      const blurWidget: Clutter.Actor = replica.blurWidget;
      const [srcAbsX, srcAbsY] = source.get_transformed_position();
      const [bwAbsX, bwAbsY] = blurWidget.get_transformed_position();
      const [bwW, bwH] = blurWidget.get_size();
      const ours: any = blurWidget.get_effects()[0];
      const theirs: any = (replica.bmsTarget?.get_effects?.() ?? [])
        .find((e: any) => typeof e?.radius === 'number');

      const parts = replica.parts
        .map((p: any) => `${(p.src as any).name ?? '?'}@(${p.src.x},${p.src.y})` +
          `${getAllocatedSize(p.src)[0]}x${getAllocatedSize(p.src)[1]}`)
        .join(' ');

      const line =
        `src=${(source as any).name ?? '?'}@(${Math.round(srcAbsX)},${Math.round(srcAbsY)}) ` +
        `parts=[${parts}] ` +
        `blur=(${blurWidget.x},${blurWidget.y}) ${bwW}x${bwH} ` +
        `blurAbs=(${Math.round(bwAbsX)},${Math.round(bwAbsY)}) ` +
        `r=${ours?.radius}/${theirs?.radius} b=${ours?.brightness}/${theirs?.brightness} ` +
        `capOff=(${this._captureOffset()[0]},${this._captureOffset()[1]}) ` +
        `cls=${Object.getPrototypeOf(ours ?? {})?.constructor?.name ?? '?'}/` +
        `${Object.getPrototypeOf(theirs ?? {})?.constructor?.name ?? '?'}`;

      if (line === replica.lastGeomLine) return;
      replica.lastGeomLine = line;
      utilsLog(`[Liquid Glass][ui-sampler:${this._label}] replica geom ${line}`);
    } catch (_) {   }
  }







  private _createSelfExcludingSnapshotActor(child: Clutter.Actor): Clutter.Actor | null {
    try {
      const stage = child.get_stage() as Clutter.Stage | null;
      if (!stage) return null;
      if (typeof (stage as any).paint_to_content !== 'function') return null;
      if (!this._selfRoot) return null;
      const selfRoot = this._selfRoot;

      const rectGetter = (): [number, number, number, number] => {
        const [x, y] = child.get_transformed_position();
        const [w, h] = getAllocatedSize(child);
        if (Number.isNaN(x) || Number.isNaN(y) || w <= 0 || h <= 0) {
          return [0, 0, 0, 0];
        }
        return [x, y, w, h];
      };

      const capture = acquireSelfExcludingSnapshot(child, stage, selfRoot, rectGetter);

      const actor = new UnpickableActor();
      actor.set_name(`${child.name}-selfExcludingSnapshot`);




      const applyContent = () => {
        if ((actor as any)._isDisposed) return;
        const content = capture.getContent();
        if (content && actor.content !== content) {
          actor.content = content;
        }
      };
      let afterPaintId = 0;
      try {
        afterPaintId = (stage as any).connect('after-paint', applyContent);
      } catch (e) {
      }
      applyContent();

      this._delayedCaptureOwners.set(actor, { source: child, hideActor: selfRoot });
      actor.connect('destroy', () => {
        (actor as any)._isDisposed = true;
        if (afterPaintId) { try { (stage as any).disconnect(afterPaintId); } catch (_) {   } }
        const owner = this._delayedCaptureOwners.get(actor);
        if (owner) {
          releaseSelfExcludingSnapshot(owner.source, owner.hideActor);
          this._delayedCaptureOwners.delete(actor);
        }
      });

      return actor;
    } catch (e) {
      return null;
    }
  }


  setUseCaptureFixForBms(enabled: boolean): void {
    this._useCaptureFixForBms = enabled;
  }








  private _findExistingOffscreenEffect(
    root: Clutter.Actor
  ): { actor: Clutter.Actor; effect: Clutter.OffscreenEffect } | null {
    const stack: Clutter.Actor[] = [root];
    const visited = new Set<Clutter.Actor>();

    while (stack.length > 0) {
      const actor = stack.pop()!;
      if (visited.has(actor)) continue;
      visited.add(actor);

      try {
        const effects: Clutter.Effect[] = (actor as any).get_effects?.() ?? [];
        for (const effect of effects) {
          if (!(effect instanceof Clutter.OffscreenEffect)) continue;
          const gtypeName = (effect.constructor as any)?.$gtype?.name ?? '';
          if (gtypeName.startsWith('LiquidGlass')) continue;
          return { actor, effect: effect as Clutter.OffscreenEffect };
        }

        const children: Clutter.Actor[] = (actor as any).get_children?.() ?? [];
        for (const c of children) stack.push(c);
      } catch (_) {   }
    }
    return null;
  }









  private _createExistingEffectBlitActor(child: Clutter.Actor): Clutter.Actor | null {
    let found = this._existingEffectCache.get(child);
    if (found === undefined) {
      found = this._findExistingOffscreenEffect(child);
      this._existingEffectCache.set(child, found);
    }
    if (!found) return null;

    const { actor: effectOwner, effect } = found;
    const blit = new TextureBlitActor();
    blit.setSourceActor(effectOwner);
    blit.setTextureGetter(() => effect.get_texture() as Cogl.Texture2D | null);
    return blit;
  }

  rebindSelf() {
    this._selfRoot = this._findUiGroupAncestor(this._selfActor);
  }













  private _containsOtherLiquidGlassRoot(root: Clutter.Actor): boolean {
    const stack: Clutter.Actor[] = [root];
    const visited = new Set<Clutter.Actor>();
    while (stack.length > 0) {
      const actor = stack.pop()!;
      if (visited.has(actor)) continue;
      visited.add(actor);
      try {
        const name = (actor as any).name;
        if (name === 'liquid-glass-bg-actor' || name === 'liquid-box') return true;
        const children: Clutter.Actor[] = (actor as any).get_children?.() ?? [];
        for (const c of children) stack.push(c);
      } catch (_) {   }
    }
    return false;
  }













  private _insertCloneInZOrder(child: Clutter.Actor, clone: Clutter.Actor): void {
    if (!this._uiClonesContainer) return;
    try {
      const uiGroup = Main.layoutManager.uiGroup;
      const siblings = uiGroup.get_children();
      const idx = siblings.indexOf(child);
      if (idx < 0) return;

      let insertAboveClone: Clutter.Actor | null = null;
      for (let i = idx - 1; i >= 0; i--) {
        const prevClone = this._clones.get(siblings[i]);
        if (prevClone && !(prevClone as any)._isDisposed) {
          insertAboveClone = prevClone;
          break;
        }
      }
      if (insertAboveClone) {
        this._uiClonesContainer.set_child_above_sibling(clone, insertAboveClone);
      } else {


        this._uiClonesContainer.set_child_below_sibling(clone, null);
      }
    } catch (e) {
    }
  }






  refresh() {
    if (!this._selfRoot) this._selfRoot = this._findUiGroupAncestor(this._selfActor);

    const uiGroup = Main.layoutManager.uiGroup;
    const children = uiGroup.get_children();
    const seen = new Set<Clutter.Actor>();



    const bmsTarget = this._resolveBmsTargetActor();
    if (this._lastBmsTarget !== bmsTarget) {
      const first = this._lastBmsTarget === undefined;
      this._lastBmsTarget = bmsTarget;
      if (!first) this._reevaluateBmsClones();
    }


    const dynamicExclusions = new Set<Clutter.Actor>();
    for (const src of this._ancestorExclusionSources) {
      try {
        if (!isActorValid(src)) continue;
        const root = this._findUiGroupAncestor(src);
        if (root) dynamicExclusions.add(root);
      } catch (_) {   }
    }

    for (const child of children) {




      try {
        if ((child as any)._isDisposed) continue;
        if (!isActorValid(child)) continue;
        if (child === this._selfActor || child === this._selfRoot) continue;
        if (child === Main.layoutManager._backgroundGroup) continue;





        if ((child as any).name?.startsWith('liquid-glass-bg-actor') ||
            (child as any).name?.startsWith('liquid-box') ||
            (child as any).name?.startsWith('tahoe-') ||
            (child as any).name === 'tahoe-control-center-overlay' ||
            (child as any).name === 'tahoe-submenu-popup' ||
            (child as any).has_style_class_name?.('tahoe-submenu-glass-popup') ||
            (child as any).has_style_class_name?.('popup-menu-boxpointer')) continue;
        if ((child as any).name === 'screenshotUIGroup' || (child as any).name?.toLowerCase().includes('screenshot') || child === Main.screenshotUI || child === (Main.screenshotUI as any)?.get_parent()) continue;
        if ((child as any).name === 'iconsContainer' ||
            (child as any).name?.startsWith('iconsContainer') ||
            (child as any)._isDndDragActor ||
            child === (globalThis as any)._activeDndDragActor ||
            (child as any).name === 'dnd-feedback' ||
            (child as any).has_style_class_name?.('dnd-feedback') ||
            (child as any).name === 'Dummy Cursor' ||
            (child as any)._delegate?.app ||
            (child as any).app) continue;
        if (this._extraExclusions.has(child)) continue;
        if (dynamicExclusions.has(child)) continue;
        if (!child.visible || !child.mapped) continue;



        if (!this._clones.has(child) && this._containsOtherLiquidGlassRoot(child)) {









          utilsLog(
            `[Liquid Glass][ui-sampler] permanent exclusion of uiGroup child ` +
            `name="${(child as any).name ?? '(unnamed)'}" ` +
            `type=${child.constructor?.name} ` +
            `(nested liquid-glass root found during deep scan)`
          );
          this.addExclusion(child);
          continue;
        }
        seen.add(child);
        if (!this._clones.has(child)) {
          child.connect('destroy', () => {
            (child as any)._isDisposed = true;
            const clone = this._clones.get(child);
            if (clone) {
              this._clones.delete(child);
              try { clone.destroy(); } catch (_) { }
            }
          });

          const bmsTarget = this._findBmsDescendant(child);




          if (bmsTarget && _bmsMode === BMS_MODE.SKIP) {
            seen.delete(child);
            continue;
          }

          let sourceClone: Clutter.Actor | null = null;
          if (bmsTarget && _bmsMode === BMS_MODE.REPLICATE) {
            sourceClone = this._createBmsReplicaActor(child);
            if (!sourceClone) {



              utilsLog(`[Liquid Glass][ui-sampler:${this._label}] BMS replica ` +
                `could not be built for name="${(child as any).name ?? '(unnamed)'}"; ` +
                `leaving it out of the glass rather than cloning BMS's target`);
              seen.delete(child);
              continue;
            }
          }
          if (!sourceClone && bmsTarget && _bmsMode === BMS_MODE.SNAPSHOT) {


            sourceClone = this._createSelfExcludingSnapshotActor(child);


            if (!sourceClone && this._useCaptureFixForBms) {
              sourceClone = this._createExistingEffectBlitActor(child);
            }
          }

          if (!sourceClone) {
            sourceClone = new UnpickableClone({ source: child });
          }



          this._bmsStateAtClone.set(child, !!bmsTarget);
          sourceClone.set_name(`${child.name}-sourceClone`);

          sourceClone.connect('destroy', () => {
            this._clones.delete(child);
          });

          this._uiClonesContainer?.add_child(sourceClone);
          this._clones.set(child, sourceClone);
          this._insertCloneInZOrder(child, sourceClone);
        }
      } catch (e) {
        reportFrameLoopError('UILayerSampler.refresh', e);
      }
    }

    for (const [actor, sourceClone] of this._clones) {
      if (!seen.has(actor)) {
        try { sourceClone.destroy(); } catch (_) { }
        this._clones.delete(actor);
      }
    }

    this._reportClonedSet();
    this._reportClonedWindowGroups();
  }

  private static _stageToLocal(
    actor: Clutter.Actor,
    stageX: number,
    stageY: number
  ): [number, number] {
    try {
      const res = (actor as any).transform_stage_point(stageX, stageY);
      if (Array.isArray(res) && res[0] === true) {
        return [res[1] as number, res[2] as number];
      }
    } catch (_) { }

    try {
      const [cx, cy] = actor.get_transformed_position();
      return [
        stageX - (Number.isNaN(cx) ? 0 : cx),
        stageY - (Number.isNaN(cy) ? 0 : cy),
      ];
    } catch (_) {
      return [stageX, stageY];
    }
  }






  syncProperties(
    source: Clutter.Actor,
    sourceClone: Clutter.Actor,
    containerW: number,
    containerH: number,
    cX: number,
    cY: number
  ) {
    if (!source || !sourceClone) return;
    try {
      const [absX, absY] = source.get_transformed_position();
      const [w, h] = getAllocatedSize(source);

      if (Number.isNaN(absX) || Number.isNaN(absY) || w <= 0 || h <= 0) {
        setActorVisible(sourceClone, false);
        return;
      }

      const scaleX = source.scale_x;
      const scaleY = source.scale_y;










      const scaledW = w * scaleX;
      const scaledH = h * scaleY;

















      const cull = this._cullRect;
      const cullable = !!cull && isCullSiteEnabled('ui') &&
        !(sourceClone as any)._lgBmsReplica &&
        scaledW > 0 && scaledH > 0 &&
        Number.isFinite(absX) && Number.isFinite(absY);
      if (cullable && !rectsIntersect(absX, absY, scaledW, scaledH, cull!)) {
        setCloneCulled(sourceClone, true,
          `src=(${Math.round(absX)},${Math.round(absY)},${Math.round(scaledW)}x${Math.round(scaledH)}) ` +
          `cullRect=[${cull!.map(Math.round)}] label=${this._label}`);
        return;
      }
      setCloneCulled(sourceClone, false, `label=${this._label}`);





      if (sourceClone.x !== 0 || sourceClone.y !== 0) sourceClone.set_position(0, 0);
      setTranslationIfChanged(sourceClone, absX, absY);

      setSizeIfChanged(sourceClone, scaledW, scaledH);
      setScaleIfChanged(sourceClone, 1.0, 1.0);
      setPivotIfChanged(sourceClone, 0, 0);

      setOpacityIfChanged(sourceClone, source.opacity);

      const replica = (sourceClone as any)._lgBmsReplica;
      if (replica) {
        this._syncBmsReplica(source, replica);




        const pr = replica.panelRect;
        if (pr && pr[2] > 0 && pr[3] > 0)
          this._bmsScreenRects.push([absX + pr[0], absY + pr[1], pr[2], pr[3]]);
      }

      this._checkCloneDrift(source, sourceClone, absX, absY);

      const localX = absX - cX;
      const localY = absY - cY;

      const isVisible = source.visible && source.mapped;





      if (isVisible && containerW > 0 && containerH > 0) {
        const isIntersecting =
          localX < containerW &&
          (localX + scaledW) > 0 &&
          localY < containerH &&
          (localY + scaledH) > 0;

        setActorVisible(sourceClone, isIntersecting);
      } else {
        setActorVisible(sourceClone, isVisible);
      }
    } catch (_) { }
  }






  private _checkCloneDrift(
    source: Clutter.Actor,
    sourceClone: Clutter.Actor,
    expectX: number,
    expectY: number
  ): void {
    if (!_utilsLogger) return;
    try {
      const [gotX, gotY] = sourceClone.get_transformed_position();
      const drifted = !Number.isFinite(gotX) || !Number.isFinite(gotY) ||
        Math.abs(gotX - expectX) > 1 || Math.abs(gotY - expectY) > 1;
      const known = this._driftingClones.has(sourceClone);

      if (drifted && !known) {
        this._driftingClones.add(sourceClone);
        utilsLog(
          `[Liquid Glass][ui-sampler] DRIFT clone for ` +
          `name="${(source as any).name ?? '(unnamed)'}" ` +
          `type=${source.constructor?.name} ` +
          `expected=(${Math.round(expectX)},${Math.round(expectY)}) ` +
          `got=(${Math.round(gotX)},${Math.round(gotY)}) ` +
          `containerPos=${this._uiClonesContainer?.get_transformed_position()} ` +
          `clone.hasAlloc=${sourceClone.has_allocation()}`
        );
      } else if (!drifted && known) {
        this._driftingClones.delete(sourceClone);
        utilsLog(`[Liquid Glass][ui-sampler] RECOVERED clone for name="${(source as any).name ?? '(unnamed)'}"`);
      }
    } catch (_) {   }
  }













  sync(cX?: number, cY?: number, cW?: number, cH?: number) {

    this._bmsScreenRects = [];

    let contW = cW ?? 0;
    let contH = cH ?? 0;
    let contAbsX = cX ?? 0;
    let contAbsY = cY ?? 0;

    if (cX === undefined || cY === undefined) {
      try {
        const [cw, ch] = this._container.get_size();
        if (!Number.isNaN(cw)) contW = cw;
        if (!Number.isNaN(ch)) contH = ch;

        const [tx, ty] = this._container.get_transformed_position();
        contAbsX = Number.isNaN(tx) ? 0 : tx;
        contAbsY = Number.isNaN(ty) ? 0 : ty;
      } catch (_) { }
    }


    try {
      const parent = this._uiClonesContainer?.get_parent();
      if (parent && this._uiClonesContainer) {
        const siblings = parent.get_children();
        if (siblings[siblings.length - 1] !== this._uiClonesContainer) {
          parent.set_child_above_sibling(this._uiClonesContainer, null);
        }
      }
    } catch (e) {
      reportFrameLoopError('UILayerSampler.sync', e);
    }


    if (this._uiClonesContainer) {
      if (this._uiClonesContainer.x !== 0 || this._uiClonesContainer.y !== 0)
        this._uiClonesContainer.set_position(0, 0);
      setTranslationIfChanged(this._uiClonesContainer, -contAbsX, -contAbsY);
    }

    for (const [actor, sourceClone] of this._clones) {
      this.syncProperties(actor, sourceClone, contW, contH, contAbsX, contAbsY);
    }
  }





















  private _reevaluateBmsClones(): void {


    this._existingEffectCache.clear();

    for (const [child, wasBms] of [...this._bmsStateAtClone]) {
      try {
        if (!isActorValid(child)) {
          this._bmsStateAtClone.delete(child);
          continue;
        }
        const isBms = !!this._findBmsDescendant(child);
        if (isBms === wasBms) continue;

        utilsLog(`[Liquid Glass][ui-sampler:${this._label}] BMS state changed for ` +
          `name="${(child as any).name ?? '(unnamed)'}" (${wasBms} -> ${isBms}); rebuilding its clone`);

        const clone = this._clones.get(child);
        if (clone) {
          this._clones.delete(child);
          try { clone.destroy(); } catch (_) { }
        }
        this._bmsStateAtClone.delete(child);
      } catch (e) {
        reportFrameLoopError('UILayerSampler._reevaluateBmsClones', e);
      }
    }



  }






  rebuildBmsClones(): void {
    this._existingEffectCache.clear();
    for (const [child] of [...this._bmsStateAtClone]) {
      try {
        if (isActorValid(child) && !this._findBmsDescendant(child)) continue;
        const clone = this._clones.get(child);
        if (clone) {
          this._clones.delete(child);
          try { clone.destroy(); } catch (_) { }
        }
        this._bmsStateAtClone.delete(child);
      } catch (e) {
        reportFrameLoopError('UILayerSampler.rebuildBmsClones', e);
      }
    }
    this._clonedNamesLogged = '';
  }










  /**
   * [window-clone-clip] Holds the cull opt-out for the windows this sampler
   * reaches THROUGH a cloned window group.
   *
   * The sampler clones uiGroup's children wholesale, and two of those children
   * are global.window_group and global.top_window_group — so every window
   * actor inside them is painted through a Clutter.Clone here too, and takes
   * the same damage-region clip from MetaShapedTexture that CullOptOutEffect
   * exists to defeat. (The UI actors themselves are St widgets: not
   * MetaCullable, no clip state, nothing to fix.)
   *
   * In practice those windows are usually already covered, because whichever
   * glass owns this sampler also runs a WindowCloneManager that clones the
   * same actors individually and holds the opt-out for them. That is luck,
   * not design: a window the manager skips (no allocation yet, hidden behind
   * a cull) would still be reached through the group clone.
   */
  private _reportClonedWindowGroups(): void {
    let clonesAWindowGroup = false;
    for (const child of this._clones.keys()) {
      if (child === (global as any).window_group || child === (global as any).top_window_group) {
        clonesAWindowGroup = true;
        break;
      }
    }


    reportClonedWindowActors(this, clonesAWindowGroup ? getWindowActors() : []);
  }

  private _reportClonedSet(): void {
    let names = '';
    for (const actor of this._clones.keys()) {
      let n = '(unnamed)';
      try { n = (actor as any).name || actor.constructor?.name || '(unnamed)'; } catch (_) { }
      names += (names ? ', ' : '') + n;
    }
    if (names === this._clonedNamesLogged) return;
    this._clonedNamesLogged = names;
    utilsLog(`[Liquid Glass][ui-sampler:${this._label}] cloning [${names}]`);
  }

  destroy() {
    _liveSamplers.delete(this);
    releaseClonedWindowActors(this);
    this._bmsStateAtClone.clear();
    if (this._uiClonesContainer) {
      try { this._uiClonesContainer.destroy(); } catch (_) { }
    }
    this._clones.clear();
    this._driftingClones.clear();
    this._selfRoot = null;
    this._existingEffectCache.clear();
  }
}


export class WindowCloneManager {


  private _cullRect: GlassRect | null = null;

  private windowClonesContainer: Clutter.Actor | null = null;
  private _windowClones: Map<Clutter.Actor, Clutter.Clone>;


  private _damageHooks: Map<any, number> = new Map();


  private bgClone: Clutter.Actor | null = null;

  private container: Clutter.Actor | null = null;
  private cloneContainer: Clutter.Actor | null = null;







  private label: string;

  constructor(container: Clutter.Actor, cloneContainer: Clutter.Actor | null = null, label: string = 'lg') {
    this.container = container;
    this.label = label;
    this._windowClones = new Map();




    this.bgClone = createBackgroundMirror(`${this.label}-bgclone`);
    this.bgClone.connect('destroy', () => { this.bgClone = null; });

    this.windowClonesContainer = new UnpickableActor();
    this.windowClonesContainer.set_name(`${this.label}-window-clones`);
    this.windowClonesContainer.connect('destroy', () => { this.windowClonesContainer = null; });

    this.cloneContainer = cloneContainer;





    if (this.cloneContainer) {
      this.cloneContainer.add_child(this.windowClonesContainer);
    } else {
      this.container.add_child(this.windowClonesContainer);
    }


    this.container.insert_child_at_index(this.bgClone, 0);
  }

  rebuildClones() {
    if (!isActorValid(this.container)) return;

    this._cullRect = null;

    if (isActorValid(this.bgClone)) { this.bgClone!.destroy(); }
    if (isActorValid(this.windowClonesContainer)) { this.windowClonesContainer!.destroy(); }




    this._windowClones.clear();




    this.bgClone = createBackgroundMirror(`${this.label}-bgclone`);
    this.bgClone.connect('destroy', () => { this.bgClone = null; });

    this.windowClonesContainer = new UnpickableActor();
    this.windowClonesContainer.set_name(`${this.label}-window-clones`);
    this.windowClonesContainer.connect('destroy', () => { this.windowClonesContainer = null; });

    if (isActorValid(this.cloneContainer)) {
      this.cloneContainer!.add_child(this.windowClonesContainer);
    } else {
      this.container!.add_child(this.windowClonesContainer);
    }
    this.container!.insert_child_at_index(this.bgClone, 0);

    this.sync();
  }











  setOffset(x: number, y: number) {



    if (this.windowClonesContainer) {
      if (this.windowClonesContainer.x !== 0 || this.windowClonesContainer.y !== 0)
        this.windowClonesContainer.set_position(0, 0);
      setTranslationIfChanged(this.windowClonesContainer, x, y);
    }
    if (this.bgClone) {
      if (this.bgClone.x !== 0 || this.bgClone.y !== 0) this.bgClone.set_position(0, 0);
      setTranslationIfChanged(this.bgClone, x, y);
    }
  }





  setCullRect(rect: GlassRect | null): void {
    this._cullRect = rect;
  }

















  applyBgCloneClip(rect: GlassRect | null): void {
    const bg = this.bgClone;
    if (!bg || !isActorValid(bg)) return;
    if (rect) {
      setClipIfChanged(bg, rect[0], rect[1], rect[2], rect[3]);
    } else if ((bg as any)._lgClipW !== undefined) {
      (bg as any)._lgClipW = undefined;
      try { bg.remove_clip(); } catch (_) { }
    }
  }
















  private _syncDamageHooks(): void {
    const container = this.container;
    if (getNestedGlassFix() !== 'damage' || !container || !isActorValid(container)) {
      this._releaseDamageHooks();
      return;
    }

    for (const src of this._windowClones.keys()) {
      if (this._damageHooks.has(src)) continue;
      if (!isActorValid(src) || !innerGlassEffectOf(src)) continue;
      try {
        const id = (src as any).connect('damaged', () => {
          if (isActorValid(container) && container.mapped && container.visible)
            container.queue_redraw();
        });
        this._damageHooks.set(src, id);
      } catch (_) {   }
    }

    if (this._damageHooks.size > this._windowClones.size) {
      for (const [src, id] of [...this._damageHooks]) {
        if (this._windowClones.has(src)) continue;
        try { if (isActorValid(src)) (src as any).disconnect(id); } catch (_) { }
        this._damageHooks.delete(src);
      }
    }
  }

  private _releaseDamageHooks(): void {
    if (this._damageHooks.size === 0) return;
    for (const [src, id] of this._damageHooks) {
      try { if (isActorValid(src)) (src as any).disconnect(id); } catch (_) { }
    }
    this._damageHooks.clear();
  }

  sync() {
    this._syncDamageHooks();



    reportClonedWindowActors(this, this._windowClones.keys());
    let windows = getWindowActors();
    let activeWindows = new Set();
    let zIndex = 0;





    if (!isActorValid(this.windowClonesContainer)) return;

    for (let w of windows) {
      if (!isActorValid(w)) continue;
      let metaWindow = w.get_meta_window();
      if (!metaWindow || metaWindow.minimized || !w.visible) continue;






      let [width, height] = getAllocatedSize(w);

      if (width <= 0 || height <= 0) continue;




      const wX = w.x + w.translation_x;
      const wY = w.y + w.translation_y;













      activeWindows.add(w);
      const sxSafe = Number.isFinite(w.scale_x) && w.scale_x > 0 ? w.scale_x : 1;
      const sySafe = Number.isFinite(w.scale_y) && w.scale_y > 0 ? w.scale_y : 1;


























      const culled = !!this._cullRect && isCullSiteEnabled('windows') &&
        !rectsIntersect(wX, wY, width * sxSafe, height * sySafe, this._cullRect);

      let clone = this._windowClones.get(w);




      if (clone && !isActorValid(clone)) {
        this._windowClones.delete(w);
        clone = undefined;
      }
      if (!clone) {
        clone = new UnpickableClone({ source: w });
        const wTitle = (() => {
          try { return metaWindow.get_title() || '(untitled)'; } catch (_) { return '(?)'; }
        })();
        clone.set_name(`${this.label}-winclone:${wTitle}`);
        clone.connect('destroy', () => { this._windowClones.delete(w); });
        this.windowClonesContainer?.add_child(clone);
        this._windowClones.set(w, clone);
      }




      setActorVisible(clone, true);
      setCloneCulled(clone, culled,
        culled
          ? `src=(${Math.round(wX)},${Math.round(wY)},${Math.round(width * sxSafe)}x${Math.round(height * sySafe)}) ` +
            `cullRect=[${this._cullRect!.map(Math.round)}] label=${this.label}`
          : `label=${this.label}`);







      const tX = wX;
      const tY = wY;
      const pX = w.pivot_point ? w.pivot_point.x : 0;
      const pY = w.pivot_point ? w.pivot_point.y : 0;

      clone.remove_transition('position');
      clone.remove_transition('size');
      clone.remove_transition('translation-x');
      clone.remove_transition('translation-y');

























      if (clone.x !== 0 || clone.y !== 0) clone.set_position(0, 0);
      setTranslationIfChanged(clone, tX, tY);

      setSizeIfChanged(clone, width, height);

      clone.remove_transition('scale-x');
      clone.remove_transition('scale-y');
      setScaleIfChanged(clone, w.scale_x, w.scale_y);

      setPivotIfChanged(clone, pX, pY);








      setOpacityIfChanged(clone, w.opacity);








      if (!isDiffWritesEnabled() || (clone as any)._lgZIndex !== zIndex) {
        (clone as any)._lgZIndex = zIndex;
        this.windowClonesContainer?.set_child_at_index(clone, zIndex);
      }
      zIndex++;
    }



    for (let [w, clone] of this._windowClones.entries()) {
      if (!activeWindows.has(w)) {
        if (isActorValid(clone)) clone.destroy();
        this._windowClones.delete(w);
      }
    }
  }

  destroy() {



    this._releaseDamageHooks();

    releaseClonedWindowActors(this);

    if (isActorValid(this.windowClonesContainer)) {
      try { this.windowClonesContainer!.destroy(); } catch (_) {   }
    }
    this._windowClones.clear();
    if (isActorValid(this.bgClone)) {
      try { this.bgClone!.destroy(); } catch (_) {   }
    }
    this.container = null;
  }
}













export const InverseCornerEffect = GObject.registerClass(
  {
    GTypeName: 'LiquidGlassInverseCornerEffect',
  },
  class InverseCornerEffect extends Clutter.ShaderEffect {
    private _radius: number = 0;
    private _inset: number = 0;




    private _glassRadius: number = 0;

    setRadius(radius: number) {
      this._radius = radius;
      this._updateShader();
    }

    setGlassRadius(radius: number) {
      this._glassRadius = radius;
      this._updateShader();
    }

    setInset(inset: number) {
      this._inset = inset;
      this._updateShader();
    }

    _updateShader() {
      const shader = `
        uniform sampler2D cogl_sampler;
        uniform float radius;
        uniform float glass_radius;
        uniform float inset;
        uniform float width;
        uniform float height;

        float sdRoundRect(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b + vec2(r);
          return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
        }

        void main() {
          vec2 st = cogl_tex_coord_in[0].st;
          vec2 resolution = vec2(width, height);
          vec2 p = (st * resolution) - (resolution * 0.5);

          // [FIX] Box half-size at the window's TRUE edge, not shrunk by
          // "inset" on every side. This overlay's actor is padded by
          // SHADER_PADDING beyond the real window bounds on all sides, and
          // "inset" here is exactly that padding — so windowHalf lands
          // precisely on the real window edge.
          //
          // Previously this used (resolution - inset*2)*0.5 with
          // inset = SHADER_PADDING + CORNER_PADDING, which shrank the box by
          // the SAME amount on every side, not just near the corners. Per
          // sdRoundRect's construction, its straight-edge (non-corner)
          // zero-crossing sits exactly at the box half-size regardless of
          // "radius" — only points within "radius" of an actual corner get
          // pulled inward. So shrinking the box itself (rather than only
          // widening "radius") revealed a uniform band along the ENTIRE
          // perimeter — straight edges included — instead of just the 4
          // corners. That band unconditionally painted this overlay's raw,
          // unblurred/untinted/un-shadowed source at full alpha, erasing the
          // drop shadow right next to the window on every edge (reported as
          // an unnatural halo/"frame" around the window), and — since its
          // width is a fixed pixel count independent of actor scale — became
          // sharply more visible whenever GNOME Shell's open/close animation
          // scaled the window down (the same fixed-pixel band read as a much
          // larger fraction of the shrunk window).
          //
          // "radius" (cornerRadius + CORNER_PADDING, set by the caller) is
          // intentionally a couple pixels larger than the glass shape's own
          // corner_radius so the cut safely over-reveals past the glass's
          // own antialiased corner — but that over-cut should only pull the
          // 4 corners inward, not shift the straight edges too.
          vec2 windowHalf = max(resolution * 0.5 - vec2(inset), vec2(1.0));

          // [FIX] This overlay redraws the raw, sharp background on top of the
          // glass, so every pixel it covers is a pixel of drop shadow that
          // cannot be seen. It must therefore cover the corner arcs and
          // NOTHING else. Three terms, each removing one way it used to
          // overreach:
          //
          //   1. outside the cut arc          — the original test
          //   2. still inside the glass shape — stops it reaching outward into
          //                                     the shadow at all
          //   3. only where the two arcs differ — zero along the straight
          //                                     edges, so no seam there
          //
          // History: with only term 1, sdRoundRect is positive everywhere
          // outside the box, so the overlay painted the ENTIRE margin ring and
          // erased the whole drop shadow. Bounding it by the window's square
          // bounds fixed the straight edges but not the corners: the notch
          // between the rounded arc and the square corner is precisely where
          // the shadow wraps around, and the overlay was still sitting on it.
          // Bounding by the glass shape instead is what actually separates
          // "erase the glass's corner" from "do not touch the shadow".
          float dCut = sdRoundRect(p, windowHalf, radius);
          float dGlass = sdRoundRect(p, windowHalf, max(glass_radius, 0.0));

          // 1. Outside the cut arc.
          float alpha = smoothstep(-0.5, 0.5, dCut);

          // 2. Inside the glass, plus a small outward guard so the glass's own
          //    antialiased boundary is covered rather than left as a fringe.
          //    Term 3 keeps this guard from eating shadow along the edges.
          alpha *= 1.0 - smoothstep(-0.5, 0.5, dGlass - 1.5);

          // 3. Corner-only. A rounded rect with a larger radius is a subset of
          //    one with a smaller radius, and the two coincide exactly along
          //    the straight sides — so this difference is 0 there and grows to
          //    about 0.41 * (radius - glass_radius) at the square corner.
          alpha *= smoothstep(0.15, 0.6, dCut - dGlass);

          // Fade out at the very edges of the overlay actor to ensure it blends seamlessly
          // with the background and hides any potential window shadow cutoff.
          // (With the notch restriction above this is normally already 1
          // throughout the painted region — the notches sit at least "inset"
          // px in from the actor edge — but it still guards a degenerate
          // inset smaller than the fade distance.)
          vec2 edgeDist = min(st, 1.0 - st) * resolution;
          float edgeFade = smoothstep(0.0, 10.0, min(edgeDist.x, edgeDist.y));
          alpha *= edgeFade;

          cogl_color_out = texture2D(cogl_sampler, st) * alpha * cogl_color_in;
        }
      `;
      this.set_shader_source(shader);
      this._updateUniforms();
    }

    _setUniform(name: string, value: number) {
      let gval = new GObject.Value();
      gval.init(GObject.TYPE_FLOAT);
      gval.set_float(value);
      this.set_uniform_value(name, gval);
    }

    _updateUniforms() {
      let actor = (this as any).get_actor();
      if (!actor) return;

      let w = actor.width;
      let h = actor.height;

      if (Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) return;

      this._setUniform('radius', this._radius);
      this._setUniform('glass_radius', this._glassRadius);
      this._setUniform('inset', this._inset);
      this._setUniform('width', w);
      this._setUniform('height', h);
    }

    vfunc_paint_target(node: any, paint_context: any): void {
      this._updateUniforms();
      super.vfunc_paint_target(node, paint_context);
    }
  }
);

/**
 * Safe helper to retrieve window actors, compatible with GNOME Shell
 * pre-48 (global.get_window_actors) and 48+/GNOME 50 (Mutter moved it to
 * global.compositor.get_window_actors). Every call site in this extension
 * that needs the current list of window actors should go through this
 * instead of calling either API directly.
 */
export function getWindowActors(): any[] {
  if (global.compositor && typeof (global.compositor as any).get_window_actors === 'function') {
    return (global.compositor as any).get_window_actors();
  }
  if (typeof (global as any).get_window_actors === 'function') {
    return (global as any).get_window_actors();
  }
  return [];
}























// global._lgGlass.freezeSync(true) / (false).
let _frameSyncFrozen = false;

export function setFrameSyncFrozen(frozen: boolean): void {
  _frameSyncFrozen = !!frozen;
}

export function isFrameSyncFrozen(): boolean {
  return _frameSyncFrozen;
}
























const _gobjectToString: (this: any) => string =
  (GObject as any).Object.prototype.toString;

export function isActorValid(actor: any): boolean {
  if (!actor) return false;

  let desc: string;
  try {
    desc = _gobjectToString.call(actor);
  } catch (e) {
    return false;
  }


  if (desc.indexOf('(DISPOSED)') >= 0 || desc.indexOf('(FINALIZED)') >= 0)
    return false;




  try {
    return typeof actor.visible === 'boolean';
  } catch (e) {
    return false;
  }
}

export function resolveMonitorGeometry(candidates: any[]): any {
  const layoutManager = Main.layoutManager;

  for (const actor of candidates) {
    if (!actor || !isActorValid(actor)) continue;

    const [width, height] = actor.get_size();
    if (!(width > 0 && height > 0)) continue;

    const index = layoutManager.findIndexForActor(actor);
    if (index >= 0)
      return layoutManager.monitors[index] || layoutManager.primaryMonitor;
  }

  return layoutManager.monitors[layoutManager.primaryIndex] || layoutManager.primaryMonitor;
}

export const InvertedPositionConstraint = GObject.registerClass({
  GTypeName: 'InvertedPositionConstraint',
  Properties: {
    'source': GObject.ParamSpec.object(
      'source', 'Source', 'Source Actor',
      GObject.ParamFlags.READWRITE,
      Clutter.Actor.$gtype
    ),
    'offset-x': GObject.ParamSpec.double(
      'offset-x', 'Offset X', 'X Offset',
      GObject.ParamFlags.READWRITE,
      Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0.0
    ),
    'offset-y': GObject.ParamSpec.double(
      'offset-y', 'Offset Y', 'Y Offset',
      GObject.ParamFlags.READWRITE,
      Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0.0
    ),
  },
}, class InvertedPositionConstraint extends Clutter.Constraint {
  declare source: Clutter.Actor | null;
  declare offset_x: number;
  declare offset_y: number;

  private _sourceXId: number = 0;
  private _sourceYId: number = 0;

  _init(props?: any) {
    super._init(props);


    this.connect('notify::source', this._onSourceChanged.bind(this));

















    this.connect('notify::offset-x', () => this._queueRelayout());
    this.connect('notify::offset-y', () => this._queueRelayout());

    if (this.source) {
      this._onSourceChanged();
    }
  }

  private _queueRelayout(): void {
    try {
      const actor = this.get_actor();
      if (actor) actor.queue_relayout();
    } catch (_) {   }
  }










  setOffset(x: number, y: number): void {
    const nx = Number.isFinite(x) ? x : 0;
    const ny = Number.isFinite(y) ? y : 0;
    if (this.offset_x === nx && this.offset_y === ny) return;
    this.offset_x = nx;
    this.offset_y = ny;
    this._queueRelayout();
  }

  private _onSourceChanged() {
    this._disconnectSignals();

    if (this.source) {
      const queueRelayout = () => {
        const actor = this.get_actor();
        if (actor) {
          actor.queue_relayout();
        }
      };


      this._sourceXId = this.source.connect('notify::x', queueRelayout);
      this._sourceYId = this.source.connect('notify::y', queueRelayout);


      queueRelayout();
    }
  }

  private _disconnectSignals() {
    if (!this.source) return;
    if (this._sourceXId) { this.source.disconnect(this._sourceXId); this._sourceXId = 0; }
    if (this._sourceYId) { this.source.disconnect(this._sourceYId); this._sourceYId = 0; }
  }

  vfunc_update_allocation(actor: Clutter.Actor, allocation: Clutter.ActorBox) {
    if (!this.source)
      return;


    const [x, y] = this.source.get_position();


    const width = allocation.get_width();
    const height = allocation.get_height();


    const targetX = -x + (this.offset_x ?? 0.0);
    const targetY = -y + (this.offset_y ?? 0.0);


    allocation.x1 = targetX;
    allocation.y1 = targetY;
    allocation.x2 = targetX + width;
    allocation.y2 = targetY + height;
  }
});
export type InvertedPositionConstraint = InstanceType<typeof InvertedPositionConstraint>;


























export function syncGlassCaptureClip(opts: {

  cloneContainer: Clutter.Actor | null,

  effect: any,

  originX: number,
  originY: number,
  uiSampler?: UILayerSampler | null,
  windowCloneManager?: WindowCloneManager | null,
}): void {
  const { cloneContainer, effect, originX, originY } = opts;
  const uiSampler = opts.uiSampler ?? null;
  const windowCloneManager = opts.windowCloneManager ?? null;

  const clear = () => {
    if (cloneContainer && isActorValid(cloneContainer) &&
        (cloneContainer as any)._lgClipW !== undefined) {
      (cloneContainer as any)._lgClipX = undefined;
      (cloneContainer as any)._lgClipY = undefined;
      (cloneContainer as any)._lgClipW = undefined;
      (cloneContainer as any)._lgClipH = undefined;
      try { cloneContainer.remove_clip(); } catch (_) { }
    }
    uiSampler?.setCullRect(null);
    windowCloneManager?.setCullRect(null);
    windowCloneManager?.applyBgCloneClip(null);
    if (effect) effect._lgCaptureClip = null;
  };

  if (!isCaptureClipEnabled() && !isCloneCullEnabled()) { clear(); return; }
  if (!effect || typeof effect.getCaptureClipRect !== 'function') { clear(); return; }

  let rect: GlassRect | null = null;
  try {
    const r = effect.getCaptureClipRect();
    if (r) rect = [r[0], r[1], r[2], r[3]];
  } catch (_) {
    clear();
    return;
  }
  if (!rect) { clear(); return; }




  if (uiSampler?.hasUnmeasuredBmsReplica()) { clear(); return; }







  const bmsRects = uiSampler?.getBmsScreenRects() ?? [];
  for (const b of bmsRects) {
    unionRectInto(rect, [b[0] - originX, b[1] - originY, b[2], b[3]]);
  }

  const [resW, resH] = typeof effect.getResolution === 'function'
    ? effect.getResolution() : [0, 0];
  if (resW >= 1 && resH >= 1) {
    const x1 = Math.min(resW, rect[0] + rect[2]);
    const y1 = Math.min(resH, rect[1] + rect[3]);
    rect[0] = Math.max(0, rect[0]);
    rect[1] = Math.max(0, rect[1]);
    rect[2] = x1 - rect[0];
    rect[3] = y1 - rect[1];
    if (!(rect[2] >= 2) || !(rect[3] >= 2)) { clear(); return; }
  }

  if (isCaptureClipEnabled() && cloneContainer && isActorValid(cloneContainer)) {
    setClipIfChanged(cloneContainer, rect[0], rect[1], rect[2], rect[3]);
  } else if (cloneContainer && isActorValid(cloneContainer) &&
             (cloneContainer as any)._lgClipW !== undefined) {
    (cloneContainer as any)._lgClipW = undefined;
    try { cloneContainer.remove_clip(); } catch (_) { }
  }

  // [DIAG] Visible in global._lgGlass.dump() as `captureClip`.
  effect._lgCaptureClip = rect.slice();

  const screenRect: GlassRect = [rect[0] + originX, rect[1] + originY, rect[2], rect[3]];



  windowCloneManager?.applyBgCloneClip(isCaptureClipEnabled() ? screenRect : null);

  uiSampler?.setCullRect(screenRect);
  windowCloneManager?.setCullRect(screenRect);
}
