import { uniformDeclarations, setUniformVector, setUniformArray } from './uniformCompat.js';




















































































































import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Logger } from './logger.js';
import { setBmsMode, BMS_MODE, computeCaptureLayout, setFrameSyncFrozen, isFrameSyncFrozen,
  setDiffWritesEnabled, isDiffWritesEnabled,
  setCaptureClipEnabled, isCaptureClipEnabled, setCloneCullEnabled, isCloneCullEnabled,
  setCullSiteEnabled, isCullSiteEnabled,
  setAdaptiveColorMode, getAdaptiveColorMode, AdaptiveColorMode,
  setNestedGlassFix, getNestedGlassFix, NestedGlassFix,
  setFocusDebugEnabled, isFocusDebugEnabled,
  setBackgroundMirrorEnabled, isBackgroundMirrorEnabled,
  setCullOptOutEnabled, isCullOptOutEnabled,
  setWindowActorRescueMode, getWindowActorRescueMode, WindowActorRescueMode } from './utils.js';






//     global._lgGlass.dump()      // one line per instance
//     global._lgGlass.count()




const _liveEffects: Set<any> = new Set();




























let _frameSerial = 0;
let _frameSerialStage: any = null;
let _frameSerialHandler = 0;

function _ensureFrameSerialHook(): boolean {
  if (_frameSerialHandler) return true;
  try {
    const stage = (globalThis as any).global?.stage;
    if (!stage) return false;
    _frameSerialStage = stage;
    _frameSerialHandler = stage.connect('after-paint', () => { _frameSerial++; });
  } catch (e) {
    _frameSerialStage = null;
    _frameSerialHandler = 0;
  }
  return _frameSerialHandler !== 0;
}






function _frameSerialIsLive(): boolean {
  return _frameSerialHandler !== 0;
}

function _releaseFrameSerialHook(): void {
  if (!_frameSerialHandler) return;
  try { _frameSerialStage?.disconnect(_frameSerialHandler); } catch (e) { }
  _frameSerialStage = null;
  _frameSerialHandler = 0;
}























const RING_MAX = 4000;
const _ring: string[] = [];
let _ringLast: Map<any, string> = new Map();

function _ringSampleOnce(): void {
  const t = GLib.get_monotonic_time();
  for (const fx of _liveEffects) {
    if (fx._owner !== 'application') continue;
    let line = '';
    try {
      const a: any = fx.get_actor();
      if (!a) continue;
      const wa: any = a.get_parent();
      if (!wa) continue;
      const trOp: any = wa.get_transition ? wa.get_transition('opacity') : null;
      const mw = wa.get_meta_window ? wa.get_meta_window() : null;
      line =
        `${fx._diagOwnerLabel || '?'}|sc=${wa.scale_x.toFixed(3)},${wa.scale_y.toFixed(3)}` +
        `|op=${wa.opacity}|pos=${Math.round(wa.x)},${Math.round(wa.y)}` +
        `|map=${wa.mapped ? 1 : 0}|alloc=${wa.has_allocation() ? 1 : 0}` +
        `|gAlloc=${a.has_allocation() ? 1 : 0}|gPos=${Math.round(a.x)},${Math.round(a.y)}` +
        `|gSize=${Math.round(a.width)}x${Math.round(a.height)}` +
        `|min=${mw && mw.minimized ? 1 : 0}` +





        `|wgAlloc=${(() => { const wg: any = wa.get_parent();
          return wg ? (wg.has_allocation() ? 1 : 0) : '-'; })()}` +
        `|views=${(wa.peek_stage_views() || []).length}` +
        (trOp
          ? `|tr=${trOp.is_playing() ? 'play' : 'stop'},${trOp.get_progress().toFixed(3)},` +
            `${trOp.get_frame_clock() ? 'clk' : 'NOCLK'}`
          : '|tr=-');
    } catch (_) {
      continue;
    }
    if (_ringLast.get(fx) === line) continue;
    _ringLast.set(fx, line);
    _ring.push(`${t} ${line}`);
    if (_ring.length > RING_MAX) _ring.shift();
  }
}














let _autoCaptures = 0;
const AUTO_CAPTURE_LIMIT = 6;

export function noteStrandEntry(label: string, detail: string): void {


  if (!_ringArmed) return;
  if (_autoCaptures >= AUTO_CAPTURE_LIMIT) return;
  _autoCaptures++;
  console.log(`[Liquid Glass][ring] AUTO-CAPTURE ${_autoCaptures}/${AUTO_CAPTURE_LIMIT} ` +
    `on strand entry for "${label}" — ${detail}`);
  try { flushGlassRing(); } catch (e) { console.error(`[Liquid Glass][ring] ${e}`); }
}



// global._lgGlass.ring(true) arms it; Ctrl+Alt+L then flushes whatever it holds.
let _ringArmed = false;

export function setGlassRingArmed(armed: boolean): void {
  _ringArmed = !!armed;
  if (!_ringArmed) {
    _ring.length = 0;
    _ringLast = new Map();
    _autoCaptures = 0;
  }
}
export function isGlassRingArmed(): boolean {
  return _ringArmed;
}


export function startGlassRingSampler(intervalMs: number = 50): number {
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, intervalMs, () => {
    if (!_ringArmed) return GLib.SOURCE_CONTINUE;
    try { _ringSampleOnce(); } catch (_) {   }
    return GLib.SOURCE_CONTINUE;
  });
}


export function flushGlassRing(): void {
  if (!_ring.length) {
    console.log('[Liquid Glass][ring] empty');
    return;
  }
  const t0 = parseInt(_ring[0].split(' ')[0], 10);
  const tN = parseInt(_ring[_ring.length - 1].split(' ')[0], 10);
  const lines = _ring.map(r => {
    const sp = r.indexOf(' ');
    const ms = Math.round((parseInt(r.slice(0, sp), 10) - t0) / 1000);
    return `+${String(ms).padStart(6)}ms ${r.slice(sp + 1)}`;
  });




  const CHUNK = 150;
  const total = Math.ceil(lines.length / CHUNK);
  console.log(`[Liquid Glass][ring] BEGIN ${lines.length} samples spanning ` +
    `${Math.round((tN - t0) / 1000)}ms in ${total} chunk(s)`);
  for (let i = 0; i < total; i++) {
    console.log(`[Liquid Glass][ring] ${i + 1}/${total}\n` +
      lines.slice(i * CHUNK, (i + 1) * CHUNK).join('\n'));
  }
  console.log('[Liquid Glass][ring] END');

  _ring.length = 0;
  _ringLast = new Map();
}

function _registerGlassDebugHooks(): void {
  const g = globalThis as any;
  if (!g.global || g.global._lgGlass) return;
  g.global._lgGlass = {
    count: () => _liveEffects.size,



    debugView: (mode: number) => {
      let n = 0;
      for (const fx of _liveEffects) {
        try { fx.setDebugView(mode); n++; } catch (e) { }
      }
      const msg = `[Liquid Glass] debug_view = ${mode} on ${n} instance(s)`;
      console.log(msg);
      return msg;
    },


    bmsMode: (mode: number) => setBmsMode(mode),
    BMS_MODE,


    blurRect: (enabled: boolean) => {
      let n = 0;
      for (const fx of _liveEffects) {
        try { fx.setBlurRectEnabled(enabled); n++; } catch (e) { }
      }
      const msg = `[Liquid Glass] blur sub-rect ${enabled ? 'ENABLED' : 'DISABLED'} on ${n} instance(s)`;
      console.log(msg);
      return msg;
    },





    freezeSync: (frozen: boolean) => {
      setFrameSyncFrozen(frozen);
      const msg = `[Liquid Glass] per-frame sync ${frozen ? 'FROZEN' : 'RUNNING'}`;
      console.log(msg);
      return msg;
    },
    syncFrozen: () => isFrameSyncFrozen(),






    textColorMode: (mode: string) => {
      const m: AdaptiveColorMode = mode === 'rgb-lerp' ? 'rgb-lerp' : 'cross-fade';
      setAdaptiveColorMode(m);
      const msg = `[Liquid Glass] adaptive text colour mode = ${m}`;
      console.log(msg);
      return msg;
    },
    textColorModeName: () => getAdaptiveColorMode(),






    nestedFix: (mode: string) => {
      const m = mode as NestedGlassFix;
      setNestedGlassFix(m);
      const msg = `[Liquid Glass] nested-glass repair = ${m}`;
      console.log(msg);
      return msg;
    },
    nestedFixMode: () => getNestedGlassFix(),










    bgMirror: (on: boolean) => {
      setBackgroundMirrorEnabled(on);
      const msg = `[Liquid Glass] background mirror ${on ? 'ENABLED' : 'disabled'} ` +
        '(toggle the extension off/on to rebuild existing glass)';
      console.log(msg);
      return msg;
    },
    bgMirrorEnabled: () => isBackgroundMirrorEnabled(),








    cullOptOut: (on: boolean) => {
      setCullOptOutEnabled(on);
      const msg = `[Liquid Glass] cloned-window cull opt-out ${on ? 'ENABLED' : 'disabled'}`;
      console.log(msg);
      return msg;
    },
    cullOptOutEnabled: () => isCullOptOutEnabled(),











    windowRescue: (mode: string) => {
      setWindowActorRescueMode(mode as WindowActorRescueMode);
      const msg = `[Liquid Glass] window-actor rescue = ${getWindowActorRescueMode()}`;
      console.log(msg);
      return msg;
    },
    windowRescueMode: () => getWindowActorRescueMode(),



    ring: (on: boolean) => {
      setGlassRingArmed(on);
      const msg = `[Liquid Glass] ring recorder ${on ? 'ARMED (50ms)' : 'disarmed'}`;
      console.log(msg);
      return msg;
    },
    ringArmed: () => isGlassRingArmed(),
    ringFlush: () => { flushGlassRing(); return 'flushed'; },




    focusDebug: (on: boolean) => {
      setFocusDebugEnabled(on);
      const msg = `[Liquid Glass] focus-debug logging ${on ? 'ENABLED' : 'disabled'}`;
      console.log(msg);
      return msg;
    },
    focusDebugEnabled: () => isFocusDebugEnabled(),







    diffWrites: (enabled: boolean) => {
      setDiffWritesEnabled(enabled);
      const msg = `[Liquid Glass] diff writes ${enabled ? 'ENABLED' : 'DISABLED'}`;
      console.log(msg);
      return msg;
    },
    diffWritesEnabled: () => isDiffWritesEnabled(),





    captureClip: (enabled: boolean) => {
      setCaptureClipEnabled(enabled);
      const msg = `[Liquid Glass] capture clip ${enabled ? 'ENABLED' : 'DISABLED'}`;
      console.log(msg);
      return msg;
    },
    captureClipEnabled: () => isCaptureClipEnabled(),




    cloneCull: (enabled: boolean) => {
      setCloneCullEnabled(enabled);
      const msg = `[Liquid Glass] clone cull ${enabled ? 'ENABLED' : 'DISABLED'}`;
      console.log(msg);
      return msg;
    },
    cloneCullEnabled: () => isCloneCullEnabled(),



    cullApp: (enabled: boolean) => {
      setCullSiteEnabled('app', enabled);
      const msg = `[Liquid Glass] cull site app (behind-window clones) ${enabled ? 'ON' : 'OFF'}`;
      console.log(msg);
      return msg;
    },
    cullWindows: (enabled: boolean) => {
      setCullSiteEnabled('windows', enabled);
      const msg = `[Liquid Glass] cull site windows (dock/menu window clones) ${enabled ? 'ON' : 'OFF'}`;
      console.log(msg);
      return msg;
    },
    cullUi: (enabled: boolean) => {
      setCullSiteEnabled('ui', enabled);
      const msg = `[Liquid Glass] cull site ui (uiGroup clones) ${enabled ? 'ON' : 'OFF'}`;
      console.log(msg);
      return msg;
    },





    treeReport: (maxDepth: number = 4) => {
      const lines: string[] = [];
      for (const fx of _liveEffects) {
        let actor: any = null;
        try { actor = (fx as any).get_actor?.(); } catch (e) { }
        const owner = (() => {
          try { return actor?.get_parent?.()?.get_name?.() ?? actor?.get_name?.() ?? '(?)'; }
          catch (e) { return '(?)'; }
        })();
        const res = (() => { try { return (fx as any).getResolution(); } catch (e) { return [0, 0]; } })();
        lines.push(`── ${owner} res=${res[0]}x${res[1]}`);
        const walk = (a: any, depth: number) => {
          if (depth > maxDepth) return;
          let children: any[] = [];
          try { children = a.get_children(); } catch (e) { return; }
          for (const c of children) {
            let name = '(?)', vis = true, op = 255, geom = '?';
            try { name = c.get_name() || '(unnamed)'; } catch (e) { }
            try {
              vis = c.visible; op = c.opacity;
              geom = `t=(${Math.round(c.translation_x)},${Math.round(c.translation_y)}) ` +
                `p=(${Math.round(c.x)},${Math.round(c.y)}) size=${Math.round(c.width)}x${Math.round(c.height)}`;
            } catch (e) { }
            lines.push(`   ${'  '.repeat(depth)}${vis && op > 0 ? '   ' : 'XX '}"${name}" ` +
              `vis=${vis} op=${op} culled=${!!(c as any)._lgCulled} ${geom}`);
            walk(c, depth + 1);
          }
        };
        if (actor) walk(actor, 0);
      }
      const out = lines.join('\n');
      console.log(out);
      return out;
    },

    cullSites: () => ({
      app: isCullSiteEnabled('app'),
      windows: isCullSiteEnabled('windows'),
      ui: isCullSiteEnabled('ui'),
    }),






    cullReport: () => {
      const lines: string[] = [];
      for (const fx of _liveEffects) {
        let actor: any = null;
        try { actor = (fx as any).get_actor?.(); } catch (e) { }
        const owner = (() => {
          try { return actor?.get_parent?.()?.get_name?.() ?? actor?.get_name?.() ?? '(?)'; }
          catch (e) { return '(?)'; }
        })();
        const res = (() => { try { return (fx as any).getResolution(); } catch (e) { return [0, 0]; } })();
        lines.push(`── ${owner} res=${res[0]}x${res[1]} captureClip=${JSON.stringify((fx as any)._lgCaptureClip ?? null)}`);
        const walk = (a: any, depth: number) => {
          let children: any[] = [];
          try { children = a.get_children(); } catch (e) { return; }
          for (const c of children) {
            let name = '(?)', vis = true, op = 255;
            try { name = c.get_name() || `(${c.constructor?.name ?? 'actor'})`; } catch (e) { }
            try { vis = c.visible; op = c.opacity; } catch (e) { }
            if (!vis || op === 0) {
              let geom = '?';
              try {
                geom = `t=(${Math.round(c.translation_x)},${Math.round(c.translation_y)}) ` +
                  `size=${Math.round(c.width)}x${Math.round(c.height)}`;
              } catch (e) { }
              lines.push(`   ${'  '.repeat(depth)}NOT PAINTED "${name}" vis=${vis} op=${op} ` +
                `culled=${!!(c as any)._lgCulled} ${geom}`);
            } else if (depth < 6) {
              walk(c, depth + 1);
            }
          }
        };
        if (actor) walk(actor, 0);
      }
      const out = lines.join('\n');
      console.log(out);
      return out;
    },


    compositeRect: (enabled: boolean) => {
      let n = 0;
      for (const fx of _liveEffects) {
        try { fx.setCompositeRectEnabled(enabled); n++; } catch (e) { }
      }
      const msg = `[Liquid Glass] composite sub-rect ${enabled ? 'ENABLED' : 'DISABLED'} on ${n} instance(s)`;
      console.log(msg);
      return msg;
    },


    cropPass: (enabled: boolean) => {
      let n = 0;
      for (const fx of _liveEffects) {
        try { fx.setCropPassEnabled(enabled); n++; } catch (e) { }
      }
      const msg = `[Liquid Glass] crop pass ${enabled ? 'ENABLED' : 'DISABLED'} on ${n} instance(s)`;
      console.log(msg);
      return msg;
    },
    earlyExit: (enabled: boolean) => {
      let n = 0;
      for (const fx of _liveEffects) {
        try { fx.setEarlyExitEnabled(enabled); n++; } catch (e) { }
      }
      const msg = `[Liquid Glass] early exits ${enabled ? 'ENABLED' : 'DISABLED'} on ${n} instance(s)`;
      console.log(msg);
      return msg;
    },
    dump: () => {
      const rows: string[] = [];
      const now = GLib.get_monotonic_time();
      for (const fx of _liveEffects) {
        if (!fx._diagLast) {
          rows.push(`(never painted) owner=${fx._owner ?? '?'}${fx._diagOwnerLabel ? ' label=' + fx._diagOwnerLabel : ''}`);
          continue;
        }









        let live: any = {};
        try {
          const a: any = fx.get_actor();
          if (a) {
            live = {
              mapped: a.mapped,
              visible: a.visible,
              hasAlloc: a.has_allocation(),
              opacity: a.opacity,
              pos: `${Math.round(a.x)},${Math.round(a.y)}`,
            };
            const wa: any = a.get_parent();
            if (wa) {
              live.parentMapped = wa.mapped;
              live.parentHasAlloc = wa.has_allocation();
              live.parentOpacity = wa.opacity;
              live.parentScale = `${wa.scale_x.toFixed(3)},${wa.scale_y.toFixed(3)}`;
              try {
                const mw = wa.get_meta_window ? wa.get_meta_window() : null;
                if (mw) {
                  live.minimized = mw.minimized;
                  live.wRect = (() => {
                    const r = mw.get_frame_rect();
                    return `${r.x},${r.y},${r.width}x${r.height}`;
                  })();
                }
              } catch (_) {   }




















              for (const prop of ['opacity', 'scale-x']) {
                try {
                  const tr: any = wa.get_transition(prop);
                  if (tr) {























                    live[`tr_${prop}`] =
                      `playing=${tr.is_playing()},prog=${tr.get_progress().toFixed(3)}` +
                      `,dur=${tr.get_duration()}` +
                      `,clock=${tr.get_frame_clock() ? 'set' : 'NULL'}`;
                  }
                } catch (_) {   }
              }
              try {
                live.waViews = (wa.peek_stage_views() || []).length;
                const wg: any = wa.get_parent();
                if (wg) live.wgViews = (wg.peek_stage_views() || []).length;
                live.glassViews = (a.peek_stage_views() || []).length;
              } catch (_) {   }
              try {
                const destroying: any = (Main as any).wm?._destroying;
                if (destroying) live.shellDestroying = destroying.has(wa);
              } catch (_) {   }
            }
          }
        } catch (_) {   }

        rows.push(JSON.stringify({
          ...fx._diagLast,
          label: fx._diagOwnerLabel || undefined,
          paints: fx._diagPaintCount,
          composited: fx._diagCompositedPaintCount,
          blurRuns: fx._blurRuns,
          blurSkips: fx._blurSkips,
          snapshotAgeMs: Math.round((now - fx._diagLastSnapshotAt) / 1000),
          ...live,
        }));
      }
      const out = rows.length ? rows.join('\n') : '(no live LiquidEffect)';
      console.log(`[Liquid Glass][dump]\n${out}`);
      return out;
    },
  };
}





type CoglFB = Cogl.Framebuffer;

interface LiquidEffectParams {
  extensionPath?: string;
  settings?: Gio.Settings;
  logger?: Logger;
  /**
   * Which manager owns this effect ('dock', 'menu', 'notification', 'osd',
   * 'quick-settings', 'quick-settings-toggles', 'application'). Diagnostic
   * only. Without it every popup surface shows up in global._lgGlass.dump()
   * as the same actor name, "liquid-box", and telling the dock's instance
   * apart from a menu's needs cross-referencing creation timestamps in the
   * log — which is exactly the step that made the first round of paint-rate
   * analysis ambiguous.
   */
  owner?: string;
  [key: string]: any;
}


interface ShaderSnippet {

  decl: string;

  body: string;
}




type BlurMethod = 0 | 1;







interface GaussianKernel {
  offsets: number[];
  weights: number[];
}



export const LiquidEffect = GObject.registerClass({
  GTypeName: 'LiquidGlassEffect',
}, class LiquidEffect extends Clutter.OffscreenEffect {


  static MAX_GLASS_REGIONS = 16;



  declare private _extensionPath: string | undefined;

  declare private _owner: string;






  declare _diagOwnerLabel: string;
  declare private _settings: Gio.Settings | undefined;
  declare private _settingsIds: number[];
  declare private _logger: Logger | undefined;




  declare private _blurTextures: Cogl.Texture2D[];
  declare private _blurFbos: Cogl.Offscreen[];




  declare private _gaussianTempTextures: Cogl.Texture2D[];
  declare private _gaussianTempFbos: Cogl.Offscreen[];



















  declare private _upTextures: Cogl.Texture2D[];
  declare private _upFbos: Cogl.Offscreen[];



  declare private _blurResultTex: Cogl.Texture | null;



  declare private _downsamplePipeline: Cogl.Pipeline | null;
  declare private _upsamplePipeline: Cogl.Pipeline | null;

  declare private _gaussianHPipeline: Cogl.Pipeline | null;
  declare private _gaussianVPipeline: Cogl.Pipeline | null;
  declare private _compositePipeline: Cogl.Pipeline | null;











  declare private _passthroughPipeline: Cogl.Pipeline | null;


  declare private _boxDownPipeline: Cogl.Pipeline | null;


  declare private _blurMethod: BlurMethod;




  declare private _gaussianKernel: GaussianKernel | null;

  declare private _pendingGaussianKernel: GaussianKernel | null;

  declare private _gaussianPipelineDirty: boolean;



  declare private _gaussianBaseSigma: number;

  declare private _gaussianScale: number;

  declare private _gaussianFetchPairs: number;


  declare private _compUniforms: Map<string, number>;


  declare private _pendingUniforms: Map<string, number>;


  declare private _compUniformArrays: Map<string, number>;
  declare private _pendingUniformArrays: Map<string, number[]>;
















  declare private _appliedUniforms: Map<string, number>;
  declare private _appliedUniformArrays: Map<string, number[]>;



















  declare private _uniformsDirty: boolean;




  declare private _uniformScratch: number[];


  declare private _cropTexture: Cogl.Texture2D | null;
  declare private _cropFbo: Cogl.Offscreen | null;
  declare private _cropPoolW: number;
  declare private _cropPoolH: number;

  declare private _cropPassEnabled: boolean;

  // [DIAG] Last frame's resolved pipeline state, dumped by global._lgGlass.
  declare private _diagLast: any;

  declare private _poolWidth: number;
  declare private _poolHeight: number;





  declare private _glassRect: number[];
  declare private _regionRects: number[][];
  declare private _multiRegion: boolean;


  declare private _blurRect: number[] | null;


  declare private _blurRectUsed: number[] | null;

  declare private _blurRectEnabled: boolean;


  declare private _compositeRect: number[] | null;

  declare private _compositeRectEnabled: boolean;

  declare private _blurDownscale: number;



  declare private PASS_COUNT: number;





  declare private _blurRadiusDown: number;
  declare private _blurRadiusUp: number;


  declare private _targetRadius: number;


  declare private _downsampleSource: string | null;
  declare private _upsampleSource: string | null;
  declare private _glassSource: string | null;
  declare private _shadersLoaded: boolean;









  declare private _diagPaintCount: number;
  declare private _diagCompositedPaintCount: number;
  declare private _diagLastPaintLogAt: number;
  declare private _diagFirstPaintLogged: boolean;










  declare private _diagEnabled: boolean;

  // Wall-clock of the last _diagLast refresh, so global._lgGlass.dump() still

  declare private _diagLastSnapshotAt: number;




















  declare private _blurFrameSerial: number;

  declare private _blurRuns: number;
  declare private _blurSkips: number;












  declare private _recaptureSerial: number;
  declare private _lastBlurRecaptureSerial: number;
  declare private _lastBlurTimeUs: number;
  declare private _backdropDirty: boolean;




  declare private _passPipelines: Map<string, { base: Cogl.Pipeline, copy: Cogl.Pipeline }>;



  declare private _uvMismatchWarned: boolean;



  _init(params: LiquidEffectParams) {
    const extensionPath = params.extensionPath;
    const settings = params.settings;
    const logger = params.logger;
    const owner = params.owner;
    delete params.extensionPath;
    delete params.settings;
    delete params.logger;
    delete params.owner;

    super._init(params);

    this._owner = owner ?? '?';
    this._diagOwnerLabel = '';

    this._blurTextures = [];
    this._blurFbos = [];
    this._gaussianTempTextures = [];
    this._gaussianTempFbos = [];
    this._upTextures = [];
    this._upFbos = [];
    this._blurResultTex = null;
    this._downsamplePipeline = null;
    this._upsamplePipeline = null;
    this._gaussianHPipeline = null;
    this._gaussianVPipeline = null;
    this._compositePipeline = null;
    this._passthroughPipeline = null;
    this._boxDownPipeline = null;
    this._compUniforms = new Map();
    this._pendingUniforms = new Map();
    this._compUniformArrays = new Map();
    this._pendingUniformArrays = new Map();
    this._appliedUniforms = new Map();
    this._appliedUniformArrays = new Map();
    this._uniformScratch = [0];
    this._uniformsDirty = false;
    this._poolWidth = 0;
    this._poolHeight = 0;

    this.PASS_COUNT = 4;
    this._blurRadiusDown = 0.5;
    this._blurRadiusUp = 1.0;
    this._blurMethod = 1;
    this._targetRadius = 15.0;

    this._gaussianKernel = null;
    this._pendingGaussianKernel = null;
    this._gaussianPipelineDirty = false;
    this._gaussianBaseSigma = 0;
    this._gaussianScale = 1.0;
    this._gaussianFetchPairs = 0;


    this._downsampleSource = null;
    this._upsampleSource = null;
    this._glassSource = null;
    this._shadersLoaded = false;
    this._diagPaintCount = 0;
    this._diagLast = null;
    _liveEffects.add(this);
    _registerGlassDebugHooks();
    this._diagCompositedPaintCount = 0;
    this._diagLastPaintLogAt = 0;
    this._diagEnabled = false;
    this._diagLastSnapshotAt = 0;
    this._blurFrameSerial = -1;
    this._cropTexture = null;
    this._cropFbo = null;
    this._cropPoolW = 0;
    this._cropPoolH = 0;
    this._cropPassEnabled = LiquidEffect.USE_CROP_PASS;
    this._glassRect = [0, 0, 0, 0];
    this._regionRects = [];
    this._multiRegion = false;
    this._blurRect = null;
    this._blurRectUsed = null;
    this._blurRectEnabled = LiquidEffect.USE_BLUR_RECT;
    this._compositeRect = null;
    this._compositeRectEnabled = LiquidEffect.USE_COMPOSITE_RECT;
    this._blurDownscale = 1;
    this._blurRuns = 0;
    this._blurSkips = 0;
    this._recaptureSerial = 0;
    this._lastBlurRecaptureSerial = -1;
    this._lastBlurTimeUs = 0;
    this._backdropDirty = true;
    _ensureFrameSerialHook();
    this._uvMismatchWarned = false;
    this._passPipelines = new Map();
    this._diagFirstPaintLogged = false;
    this._passPipelines = new Map();
    this._uvMismatchWarned = false;

    this._extensionPath = extensionPath;
    this._settings = settings;
    this._logger = logger;





    this._setFloat('resolution_x', 0.0);
    this._setFloat('resolution_y', 0.0);
    this._setFloat('pointer_x', -100.0);
    this._setFloat('pointer_y', -100.0);
    this._setFloat('intensity', 0.0);
    this._setFloat('corner_radius', 60.0);
    this._setFloat('shape_type', 0.0);
    this._setFloat('brightness', 1.0);
    this._setFloat('contrast', 1.0);
    this._setFloat('saturation', 1.0);
    this._setFloat('padding', 20.0);









    this._setFloat('shadow_max_radius', 180.0);
    this._setFloat('isDock', 0.0);








    this._setFloat('surface_light_enabled', 1.0);


    this._setFloat('dock_x', 0.0);
    this._setFloat('dock_y', 0.0);
    this._setFloat('dock_w', 0.0);
    this._setFloat('dock_h', 0.0);





    this._setFloat('multi_region_mode', 0.0);
    this._setFloat('region_count', 0.0);


    // early exits in glass.frag OFF. Seed it explicitly; global._lgGlass

    this._setFloat('early_exit_enabled', 1.0);
    this._setFloat('debug_view', 0.0);



    this._setFloat('blur_rect_x', 0.0);
    this._setFloat('blur_rect_y', 0.0);
    this._setFloat('blur_rect_w', 0.0);
    this._setFloat('blur_rect_h', 0.0);

    this._setFloat('arrow_side', 0.0);
    this._setFloat('arrow_origin', 0.0);
    this._setFloat('arrow_base', 0.0);
    this._setFloat('arrow_rise', 0.0);
    this._setFloat('arrow_radius', 2.0);
    this._setFloat('arrow_fillet', 5.0);

    this._settingsIds = [];
    if (this._settings) {
      this._bindSettings();
    } else {

      this._setFloat('max_z', 25.0);
      this._setFloat('displacement_scale', 78.5);
      this._setFloat('edge_smoothing', 2.0);
      this._setFloat('profile_shape_n', 7.0);
      this._setFloat('ior', 2.40);
      this._setFloat('chroma_strength', 0.006);
      this._setFloat('specular_intensity', 0.0);
      this._setFloat('shininess', 42.0);
      this._setFloat('rim_width', 5.0);
      this._setFloat('rim_intensity', 0.6);
      this._setFloat('rim_directional_power', 2.7);
      this._setFloat('rim_power', 6.0);
      this._setFloat('rim_light_color_intensity', 1.4);
      this._setFloat('sheen_intensity', 0.32);
      this._setFloat('light_angle_deg', 0.0);
      this._setFloat('shadow_radius', 8.0);
      this._setFloat('shadow_intensity', 0.55);



      this._setFloat('ao_intensity', 0.25);
      this._setFloat('ao_radius', 7.5);
      this._setFloat('tint_strength', 0.0);
      this._setFloat('tint_r', 1.0);
      this._setFloat('tint_g', 1.0);
      this._setFloat('tint_b', 1.0);
    }
    this._loadAllShadersAsync();
  }




  private async _loadAllShadersAsync(): Promise<void> {






    const diagStart = GLib.get_monotonic_time();
    this._logger?.log(`[Liquid Glass][diag] LiquidEffect: starting async shader load at t=${diagStart}us ` +
      `(extensionPath=${this._extensionPath})`);
    try {
      this._downsampleSource = await this._readFileAsync(`${this._extensionPath}/shaders/downsample.frag`);
      this._upsampleSource = await this._readFileAsync(`${this._extensionPath}/shaders/upsample.frag`);
      let shaderFile = 'glass.frag';
      const optShaderPath = `${this._extensionPath}/shaders/LQ-OPTIMIZED.frag`;
      const optMarkerUser = `${GLib.get_home_dir()}/.config/macW1Y/optimized-glass`;
      const optMarkerSys = '/etc/macW1Y/optimized-glass';
      if (GLib.file_test(optShaderPath, GLib.FileTest.EXISTS)) {
        if (GLib.file_test(optMarkerUser, GLib.FileTest.EXISTS) || GLib.file_test(optMarkerSys, GLib.FileTest.EXISTS)) {
          shaderFile = 'LQ-OPTIMIZED.frag';
        }
      }
      this._glassSource = await this._readFileAsync(`${this._extensionPath}/shaders/${shaderFile}`);

      this._shadersLoaded = true;

      const elapsedMs = (GLib.get_monotonic_time() - diagStart) / 1000;
      this._logger?.log(`[Liquid Glass][diag] LiquidEffect: async shader load finished in ${elapsedMs.toFixed(1)}ms, ` +
        `calling queue_repaint() now. If the on-screen black-background bug is still visible ` +
        `after this point, the shader load itself is not the (sole) cause -- the issue is in ` +
        `getting this repaint request actually flushed to the display.`);


      this.queue_repaint();
    } catch (e) {
      this._logger?.error(`[Liquid Glass] Failed to load shaders asynchronously: ${e}`);
    }
  }




  private _readFileAsync(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (_, res) => {
        try {
          const [ok, bytes] = file.load_contents_finish(res);
          if (!ok) {
            reject(new Error(`load_contents_finish returned false for ${path}`));
          } else {
            resolve(new TextDecoder('utf-8').decode(bytes));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  }







  private _initPipelines(ctx: Cogl.Context): void {

    this._downsamplePipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._downsamplePipeline, 0);

    if (this._downsampleSource) {
      const downSnippet = this._splitShader(this._downsampleSource);
      const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(downSnippet.decl), null);
      s.set_replace(downSnippet.body);
      this._downsamplePipeline.add_snippet(s);
    }


    this._upsamplePipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._upsamplePipeline, 0);

    if (this._upsampleSource) {
      const upSnippet = this._splitShader(this._upsampleSource);
      const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(upSnippet.decl), null);
      s.set_replace(upSnippet.body);
      this._upsamplePipeline.add_snippet(s);
    }





    this._passthroughPipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._passthroughPipeline, 0);



















    this._boxDownPipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._boxDownPipeline, 0);
    {
      const boxSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
        uniformDeclarations('uniform vec2 inv_size;\n'), null);
      boxSnip.set_replace(
        'vec2 uv = cogl_tex_coord_in[0].st;\n' +
        'vec4 c  = texture2D(cogl_sampler0, uv + vec2( 1.0,  1.0) * inv_size);\n' +
        'c += texture2D(cogl_sampler0, uv + vec2( 1.0, -1.0) * inv_size);\n' +
        'c += texture2D(cogl_sampler0, uv + vec2(-1.0,  1.0) * inv_size);\n' +
        'c += texture2D(cogl_sampler0, uv + vec2(-1.0, -1.0) * inv_size);\n' +
        'cogl_color_out = c * 0.25;\n');
      this._boxDownPipeline.add_snippet(boxSnip);
    }








    this._compositePipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._compositePipeline, 0);



    this._compositePipeline.set_blend(
      'RGBA = ADD(SRC_COLOR, DST_COLOR * (1 - SRC_COLOR[A]))',
    );

    this._loadCompositeShader();





    this._appliedUniforms.clear();
    this._appliedUniformArrays.clear();
    this._applyPendingUniforms();
  }





  private _configureSamplerLayer(pipeline: Cogl.Pipeline, layer: number): void {
    pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    pipeline.set_layer_filters(
      layer,
      Cogl.PipelineFilter.LINEAR,
      Cogl.PipelineFilter.LINEAR
    );
  }




  private _splitShader(src: string): ShaderSnippet {
    const match = src.match(/void\s+main\s*\(\s*\)\s*\{/);
    if (!match || match.index === undefined) {
      this._logger?.warn('[Liquid Glass] void main() not found; treating entire source as decl.');
      return { decl: src, body: '' };
    }

    const decl = src.substring(0, match.index);
    const rest = src.substring(match.index + match[0].length);


    let depth = 1;
    let bodyEnd = 0;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++;
      else if (rest[i] === '}') {
        depth--;
        if (depth === 0) { bodyEnd = i; break; }
      }
    }

    return { decl, body: rest.substring(0, bodyEnd) };
  }










  private _loadCompositeShader(): void {
    if (!this._compositePipeline || !this._glassSource) return;

    let { decl, body } = this._splitShader(this._glassSource);


    decl = decl.replace(/uniform\s+sampler2D\s+cogl_sampler\d*\s*;[^\n]*/g, '');
    body = body.replace(/\bcogl_sampler\b/g, 'cogl_sampler0');

    const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(decl), null);
    snippet.set_replace(body);
    this._compositePipeline.add_snippet(snippet);
  }



















  private _computeGaussianKernel(sigma: number, fetchPairs: number): GaussianKernel {
    const sideTaps = Math.max(2, fetchPairs * 2);


    const raw: number[] = [];
    let sum = 0;
    for (let i = 0; i <= sideTaps; i++) {
      const w = Math.exp(-(i * i) / (2 * sigma * sigma));
      raw.push(w);
      sum += (i === 0) ? w : w * 2;
    }
    for (let i = 0; i <= sideTaps; i++) {
      raw[i] /= sum;
    }

    const offsets: number[] = [0];
    const weights: number[] = [raw[0]];

    for (let p = 0; p < fetchPairs; p++) {
      const i = p * 2 + 1;
      const j = i + 1;
      const w0 = raw[i] ?? 0;
      const w1 = (j <= sideTaps) ? raw[j] : 0;
      const wSum = w0 + w1;
      const offset = wSum > 0 ? (i * w0 + j * w1) / wSum : i;
      offsets.push(offset);
      weights.push(wSum);
    }

    return { offsets, weights };
  }










  private _buildGaussianSnippet(kernel: GaussianKernel, direction: 'h' | 'v'): ShaderSnippet {
    const decl =
      `uniform vec2 inv_size;    /* 1/width, 1/height of the SOURCE texture */\n` +
      `uniform float kernel_scale; /* dynamic scale based on the sigma ratio, avoids recompiling */\n`;

    const lines: string[] = [];
    lines.push(`vec2 uv = cogl_tex_coord_in[0].st;`);
    lines.push(`vec4 col = texture2D(cogl_sampler0, uv) * ${kernel.weights[0].toFixed(8)};`);

    for (let i = 1; i < kernel.offsets.length; i++) {
      const off = kernel.offsets[i].toFixed(8);
      const w = kernel.weights[i].toFixed(8);
      const plusVec = direction === 'h'
        ? `vec2(${off} * kernel_scale * inv_size.x, 0.0)`
        : `vec2(0.0, ${off} * kernel_scale * inv_size.y)`;
      lines.push(`col += texture2D(cogl_sampler0, uv + ${plusVec}) * ${w};`);
      lines.push(`col += texture2D(cogl_sampler0, uv - ${plusVec}) * ${w};`);
    }

    lines.push(`cogl_color_out = col;`);

    return { decl, body: '\n    ' + lines.join('\n    ') + '\n' };
  }






  private _compileGaussianPipelines(ctx: Cogl.Context, kernel: GaussianKernel): void {
    this._gaussianHPipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._gaussianHPipeline, 0);
    const hSnippet = this._buildGaussianSnippet(kernel, 'h');
    const hSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(hSnippet.decl), null);
    hSnip.set_replace(hSnippet.body);
    this._gaussianHPipeline.add_snippet(hSnip);

    this._gaussianVPipeline = Cogl.Pipeline.new(ctx);
    this._configureSamplerLayer(this._gaussianVPipeline, 0);
    const vSnippet = this._buildGaussianSnippet(kernel, 'v');
    const vSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(vSnippet.decl), null);
    vSnip.set_replace(vSnippet.body);
    this._gaussianVPipeline.add_snippet(vSnip);

    this._gaussianKernel = kernel;
    this._gaussianPipelineDirty = false;
    this._pendingGaussianKernel = null;
  }



















  private _buildTexturePool(ctx: Cogl.Context, w: number, h: number): void {
    this._destroyTexturePool();
    this._destroyCropTarget();

    const shift = this._blurDownscale >= 4 ? 2 : (this._blurDownscale === 2 ? 1 : 0);
    let pw = Math.max(w >> shift, 1);
    let ph = Math.max(h >> shift, 1);

    for (let i = 0; i < this.PASS_COUNT; i++) {
      try {

        const tex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
        const fbo = Cogl.Offscreen.new_with_texture(tex);
        this._blurTextures.push(tex);
        this._blurFbos.push(fbo);


        const tmpTex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
        const tmpFbo = Cogl.Offscreen.new_with_texture(tmpTex);
        this._gaussianTempTextures.push(tmpTex);
        this._gaussianTempFbos.push(tmpFbo);


        const upTex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
        const upFbo = Cogl.Offscreen.new_with_texture(upTex);
        this._upTextures.push(upTex);
        this._upFbos.push(upFbo);
      } catch (e) {
        this._logger?.error(`[Liquid Glass] Failed to build texture pool at pass ${i} (${pw}x${ph}): ${e}`);
        this._destroyTexturePool();
        return;
      }

      pw = Math.max(pw >> 1, 1);
      ph = Math.max(ph >> 1, 1);
    }

    this._poolWidth = w;
    this._poolHeight = h;
  }









  private _runDualKawaseBlur(parentNode: any, srcTex: Cogl.Texture, srcUV: number[]): void {
    let currentSrc: Cogl.Texture = srcTex;


    for (let i = 0; i < this.PASS_COUNT; i++) {
      const destFbo = this._blurFbos[i] as unknown as CoglFB;
      const destTex = this._blurTextures[i];
      const destW = destTex.get_width();
      const destH = destTex.get_height();

      const invW = 1.0 / currentSrc.get_width();
      const invH = 1.0 / currentSrc.get_height();







      const uv = (i === 0) ? srcUV : [0, 0, 1, 1];






      const boxFirst = i === 0 && this._blurDownscale >= 4 && this._boxDownPipeline !== null;
      const pipeline = boxFirst
        ? this._passPipeline('kawase-down-0-box', this._boxDownPipeline!)
        : this._passPipeline(`kawase-down-${i}`, this._downsamplePipeline!);
      pipeline.set_layer_texture(0, currentSrc);
      this._setPipelineVec2(pipeline, 'inv_size', invW, invH);
      if (!boxFirst)
        this._setPipelineFloat(pipeline, 'blur_radius', this._blurRadiusDown);

      this._addPassNode(parentNode, destFbo, pipeline, destW, destH, uv);

      currentSrc = destTex;
    }






    if (this.PASS_COUNT <= 1) {
      this._blurResultTex = this._blurTextures[0];
      return;
    }

    for (let i = this.PASS_COUNT - 1; i > 0; i--) {


      const srcTexture = (i === this.PASS_COUNT - 1)
        ? this._blurTextures[i]
        : this._upTextures[i];
      const destFbo = this._upFbos[i - 1] as unknown as CoglFB;
      const destTex = this._upTextures[i - 1];
      const destW = destTex.get_width();
      const destH = destTex.get_height();

      const invW = 1.0 / srcTexture.get_width();
      const invH = 1.0 / srcTexture.get_height();

      const pipeline = this._passPipeline(`kawase-up-${i}`, this._upsamplePipeline!);
      pipeline.set_layer_texture(0, srcTexture);
      this._setPipelineVec2(pipeline, 'inv_size', invW, invH);
      this._setPipelineFloat(pipeline, 'blur_radius', this._blurRadiusUp);

      this._addPassNode(parentNode, destFbo, pipeline, destW, destH, [0, 0, 1, 1]);
    }

    this._blurResultTex = this._upTextures[0];
  }














  private _runGaussianBlur(parentNode: any, srcTex: Cogl.Texture, srcUV: number[]): void {
    const tempFbo = this._gaussianTempFbos[0] as unknown as CoglFB;
    const tempTex = this._gaussianTempTextures[0];
    const destFbo = this._blurFbos[0] as unknown as CoglFB;
    const destTex = this._blurTextures[0];
    const destW = destTex.get_width();
    const destH = destTex.get_height();












    const wideDownsample = this._blurDownscale >= 4 && this._boxDownPipeline !== null;
    const prePipeline = wideDownsample
      ? this._passPipeline('gauss-pre-box', this._boxDownPipeline!)
      : this._passPipeline('gauss-pre', this._passthroughPipeline!);
    prePipeline.set_layer_texture(0, srcTex);
    if (wideDownsample) {


      this._setPipelineVec2(prePipeline, 'inv_size',
        1.0 / srcTex.get_width(), 1.0 / srcTex.get_height());
    }




    this._addPassNode(parentNode, destFbo, prePipeline, destW, destH, srcUV);



    const hPipeline = this._passPipeline('gauss-h', this._gaussianHPipeline!);
    hPipeline.set_layer_texture(0, destTex);
    this._setPipelineVec2(hPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
    this._setPipelineFloat(hPipeline, 'kernel_scale', this._gaussianScale);

    this._addPassNode(parentNode, tempFbo, hPipeline, destW, destH, [0, 0, 1, 1]);






    const vPipeline = this._passPipeline('gauss-v', this._gaussianVPipeline!);
    vPipeline.set_layer_texture(0, tempTex);
    this._setPipelineVec2(vPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
    this._setPipelineFloat(vPipeline, 'kernel_scale', this._gaussianScale);

    const outFbo = this._upFbos[0] as unknown as CoglFB;
    this._addPassNode(parentNode, outFbo, vPipeline, destW, destH, [0, 0, 1, 1]);

    this._blurResultTex = this._upTextures[0];
  }









  private _destroyTexturePool(): void {
    this._blurFbos = [];
    this._blurTextures = [];
    this._gaussianTempFbos = [];
    this._gaussianTempTextures = [];
    this._upFbos = [];
    this._upTextures = [];
    this._blurResultTex = null;
    this._poolWidth = 0;
    this._poolHeight = 0;
  }
























  vfunc_paint(node: Clutter.PaintNode, paintContext: Clutter.PaintContext,
    flags: Clutter.EffectPaintFlags): void {
    if (flags & Clutter.EffectPaintFlags.ACTOR_DIRTY) this._recaptureSerial++;
    super.vfunc_paint(node, paintContext, flags);
  }

  vfunc_paint_target(_paintNode: Clutter.PaintNode, paintContext: Clutter.PaintContext): void {













    this._diagPaintCount++;
    if (this._diagEnabled) {
      const now = GLib.get_monotonic_time();
      const actorTitle = (() => {
        try {
          const a = this.get_actor() as any;
          return a?.get_meta_window?.()?.get_title?.() ?? a?.get_name?.() ?? '?';
        } catch (e) { return '?'; }
      })();
      if (!this._diagFirstPaintLogged) {
        this._diagFirstPaintLogged = true;
        this._diagLastPaintLogAt = now;
        this._logger?.log(`[Liquid Glass][diag] LiquidEffect.vfunc_paint_target: FIRST call for "${actorTitle}" ` +
          `(paintCount=${this._diagPaintCount}, shadersLoaded=${this._shadersLoaded})`);
      } else if (now - this._diagLastPaintLogAt > 2000 * 1000) {
        this._logger?.log(`[Liquid Glass][diag] LiquidEffect.vfunc_paint_target: heartbeat for "${actorTitle}", ` +
          `paintCount=${this._diagPaintCount}, compositedCount=${this._diagCompositedPaintCount}`);
        this._diagLastPaintLogAt = now;
      }
    }


    if (!this._shadersLoaded) {
      if (this._owner === 'modal-dialog' || this._owner === 'dialog' || this._owner?.includes?.('dialog'))
        return;
      super.vfunc_paint_target(_paintNode, paintContext);
      return;
    }

    if (!this._compositePipeline) {
      try {
        const ctx = this._getCoglContext();
        if (!ctx) throw new Error('Could not obtain a Cogl context');
        this._initPipelines(ctx);
      } catch (e) {
        this._logger?.error(`[Liquid Glass] Pipeline initialization failed: ${e}`);
        if (this._owner === 'modal-dialog' || this._owner === 'dialog' || this._owner?.includes?.('dialog'))
          return;

        super.vfunc_paint_target(_paintNode, paintContext);
        return;
      }
    }





    if (!this._compositePipeline || !this._downsamplePipeline || !this._upsamplePipeline) {
      if (this._owner === 'modal-dialog' || this._owner === 'dialog' || this._owner?.includes?.('dialog'))
        return;
      super.vfunc_paint_target(_paintNode, paintContext);
      return;
    }






    if (this._gaussianPipelineDirty && this._pendingGaussianKernel) {
      try {
        const ctx = this._getCoglContext();
        if (!ctx) throw new Error('Could not obtain a Cogl context');
        this._gaussianHPipeline = null;
        this._gaussianVPipeline = null;
        this._compileGaussianPipelines(ctx, this._pendingGaussianKernel);
      } catch (e) {
        this._logger?.error(`[Liquid Glass] Failed to build Gaussian pipelines: ${e}`);
      }
    }

















    // before global.stage is reachable, and one failed attempt must not

    if (!_frameSerialIsLive()) _ensureFrameSerialHook();





    const serialIsLive = _frameSerialIsLive();
    const firstPaintThisFrame = !serialIsLive || this._blurFrameSerial !== _frameSerial;
    if (serialIsLive) this._blurFrameSerial = _frameSerial;


    const srcTex = this.get_texture() as Cogl.Texture2D | null;
    if (!srcTex) {
      super.vfunc_paint_target(_paintNode, paintContext);
      return;
    }

    const srcW = srcTex.get_width();
    const srcH = srcTex.get_height();





    const actor = this.get_actor();
    let allocW = srcW;
    let allocH = srcH;
    if (actor) {
      const [aw, ah] = actor.get_size();
      if (Number.isFinite(aw) && aw > 0) allocW = Math.round(aw);
      if (Number.isFinite(ah) && ah > 0) allocH = Math.round(ah);
    }













    const effectiveW = allocW;
    const effectiveH = allocH;

    const layout = computeCaptureLayout(actor, srcW, srcH, effectiveW, effectiveH);
    const srcUV: number[] = layout.uv;















    try {
      (actor as any)._lgCaptureOffset = [layout.dest[0], layout.dest[1]];
    } catch (e) {   }







    const resW = this._pendingUniforms.get('resolution_x') ?? 0;
    const resH = this._pendingUniforms.get('resolution_y') ?? 0;
    const spacesAgree =
      Math.abs(resW - effectiveW) <= 1 && Math.abs(resH - effectiveH) <= 1;


    const blurRect =
      (this.PASS_COUNT > 0 && spacesAgree) ? this._computeBlurRect() : null;






    const blurW = blurRect ? blurRect[2] : effectiveW;
    const blurH = blurRect ? blurRect[3] : effectiveH;
    const blurSrcUV: number[] = blurRect
      ? [
        srcUV[0] + (blurRect[0] / effectiveW) * (srcUV[2] - srcUV[0]),
        srcUV[1] + (blurRect[1] / effectiveH) * (srcUV[3] - srcUV[1]),
        srcUV[0] + ((blurRect[0] + blurRect[2]) / effectiveW) * (srcUV[2] - srcUV[0]),
        srcUV[1] + ((blurRect[1] + blurRect[3]) / effectiveH) * (srcUV[3] - srcUV[1]),
      ]
      : srcUV;







    const a = this._blurRectUsed;
    const rectUnchanged = (a === null)
      ? (blurRect === null)
      : (blurRect !== null && a[0] === blurRect[0] && a[1] === blurRect[1] &&
        a[2] === blurRect[2] && a[3] === blurRect[3]);

    const now = GLib.get_monotonic_time();


    const MIN_BLUR_INTERVAL_US = 16666;
    const timeSinceLastBlur = now - (this._lastBlurTimeUs || 0);
    const canReuseBlur = this.PASS_COUNT > 0 &&
      this._blurResultTex !== null &&
      rectUnchanged &&
      this._poolWidth === blurW &&
      this._poolHeight === blurH;


    const isDirty = (this._backdropDirty !== false);





    const reuseBlur = canReuseBlur && (!firstPaintThisFrame || !isDirty || timeSinceLastBlur < MIN_BLUR_INTERVAL_US);







    let effectiveTexOut: Cogl.Texture = srcTex;
    if (this._cropPassEnabled && !blurRect && !reuseBlur &&
      (srcW !== effectiveW || srcH !== effectiveH)) {
      try {
        const cropCtx = this._getCoglContext();
        if (cropCtx) {
          effectiveTexOut = this._addCropPassNode(
            _paintNode, cropCtx, srcTex, srcW, srcH, effectiveW, effectiveH, layout.uv
          );
        }
      } catch (e) {
        this._logger?.error(`[Liquid Glass] Crop pass node failed; continuing with the padded texture: ${e}`);
      }
    }























    const effectiveTex: Cogl.Texture = effectiveTexOut;


    const inputUV: number[] = (effectiveTex === srcTex) ? srcUV : [0, 0, 1, 1];



    const blurInputUV: number[] = blurRect ? blurSrcUV : inputUV;





    if (!reuseBlur && (blurW !== this._poolWidth || blurH !== this._poolHeight)) {
      try {
        const ctx = this._getCoglContext();
        if (!ctx) throw new Error('Could not obtain a Cogl context');
        this._buildTexturePool(ctx, blurW, blurH);
      } catch (e) {
        this._logger?.error(`[Liquid Glass] Failed to rebuild the texture pool: ${e}`);
        super.vfunc_paint_target(_paintNode, paintContext);
        return;
      }
    }

    if (this.PASS_COUNT > 0 && !this._blurFbos.length) {
      super.vfunc_paint_target(_paintNode, paintContext);
      return;
    }







    if (reuseBlur) {

      this._blurSkips++;
    } else {
      this._lastBlurTimeUs = now;
      this._lastBlurRecaptureSerial = this._recaptureSerial;
      this._backdropDirty = false;
      this._blurResultTex = null;
      this._blurRectUsed = blurRect;
      if (this.PASS_COUNT > 0) {
        this._blurRuns++;
        if (this._blurMethod === 0) {
          if (this._gaussianHPipeline && this._gaussianVPipeline) {
            this._runGaussianBlur(_paintNode, effectiveTex, blurInputUV);
          }
        } else {
          this._runDualKawaseBlur(_paintNode, effectiveTex, blurInputUV);
        }
      }
    }













    const compFb = paintContext.get_framebuffer();
    const compPipeline = this._compositePipeline!;











    const haveBlur = this.PASS_COUNT > 0 && this._blurResultTex !== null;






    const activeRect = (haveBlur && blurRect) ? blurRect : null;
    this._blurRect = activeRect;
    this._setFloat('blur_rect_x', activeRect ? activeRect[0] : 0.0);
    this._setFloat('blur_rect_y', activeRect ? activeRect[1] : 0.0);
    this._setFloat('blur_rect_w', activeRect ? activeRect[2] : 0.0);
    this._setFloat('blur_rect_h', activeRect ? activeRect[3] : 0.0);



    const layer0Tex = haveBlur ? this._blurResultTex! : effectiveTex;
    compPipeline.set_layer_texture(0, layer0Tex);
    this._configureSamplerLayer(compPipeline, 0);
    const layer0UV = haveBlur ? [0, 0, 1, 1] : inputUV;





    const layer1UV: number[] = layer0UV;
    compPipeline.set_layer_texture(1, layer0Tex);
    this._configureSamplerLayer(compPipeline, 1);




    this._applyPendingUniforms();

























    const paintOpacity = actor ? actor.get_paint_opacity() : 255;
    const color = new Cogl.Color();
    const paintOpacity_f = paintOpacity / 255;
    color.init_from_4f(paintOpacity_f, paintOpacity_f, paintOpacity_f, paintOpacity_f);
    this._compositePipeline!.set_color(color);

























    const compRect = (resW === effectiveW && resH === effectiveH)
      ? this._computeCompositeRect()
      : null;
    this._compositeRect = compRect;

    let drawRect = layout.dest;
    let drawUV = layer0UV;
    if (compRect) {
      const sx = (layout.dest[2] - layout.dest[0]) / effectiveW;
      const sy = (layout.dest[3] - layout.dest[1]) / effectiveH;
      drawRect = [
        layout.dest[0] + compRect[0] * sx,
        layout.dest[1] + compRect[1] * sy,
        layout.dest[0] + (compRect[0] + compRect[2]) * sx,
        layout.dest[1] + (compRect[1] + compRect[3]) * sy,
      ];
      const [u0, v0, u1, v1] = layer0UV;
      drawUV = [
        u0 + (compRect[0] / resW) * (u1 - u0),
        v0 + (compRect[1] / resH) * (v1 - v0),
        u0 + ((compRect[0] + compRect[2]) / resW) * (u1 - u0),
        v0 + ((compRect[1] + compRect[3]) / resH) * (v1 - v0),
      ];
    }

    this._addCompositeNode(_paintNode, drawRect, drawUV, drawUV);

    this._diagCompositedPaintCount++;








    // global._lgGlass.dump().







    const diagNow = GLib.get_monotonic_time();
    if (this._diagEnabled || diagNow - this._diagLastSnapshotAt > 1000 * 1000) {
      this._diagLastSnapshotAt = diagNow;
      this._diagLast = {
        owner: this._owner,
        actor: (() => { try { return (this.get_actor() as any)?.get_name?.() ?? '?'; } catch (e) { return '?'; } })(),
        src: `${srcW}x${srcH}`,
        alloc: `${allocW}x${allocH}`,
        uv: layout.uv.map(v => +v.toFixed(5)),
        dest: layout.dest.map(v => +v.toFixed(2)),
        blurMethod: this._blurMethod,
        passCount: this.PASS_COUNT,
        pool: `${this._poolWidth}x${this._poolHeight}`,
        poolLevels: this._blurFbos.length,
        blurResult: (() => {
          const t = this._blurResultTex as Cogl.Texture | null;
          return t ? `${t.get_width()}x${t.get_height()}`
            : 'NULL (layer 1 falls back to the SHARP capture)';
        })(),
        radiusDown: this._blurRadiusDown,
        radiusUp: this._blurRadiusUp,
        targetRadius: this._targetRadius,
        gaussianPipelines: !!(this._gaussianHPipeline && this._gaussianVPipeline),
        paintOpacity,
        paints: this._diagPaintCount,



        cropRan: effectiveTex !== srcTex,
        blurRuns: this._blurRuns,
        blurSkips: this._blurSkips,






        u: {
          shadowRadius: this._pendingUniforms.get('shadow_radius'),
          shadowIntensity: this._pendingUniforms.get('shadow_intensity'),
          shadowMaxRadius: this._pendingUniforms.get('shadow_max_radius'),
          edgeSmoothing: this._pendingUniforms.get('edge_smoothing'),
          cornerRadius: this._pendingUniforms.get('corner_radius'),
          padding: this._pendingUniforms.get('padding'),
          isDock: this._pendingUniforms.get('isDock'),
          multiRegion: this._pendingUniforms.get('multi_region_mode'),
          earlyExit: this._pendingUniforms.get('early_exit_enabled'),
          dockRect: [
            this._pendingUniforms.get('dock_x'),
            this._pendingUniforms.get('dock_y'),
            this._pendingUniforms.get('dock_w'),
            this._pendingUniforms.get('dock_h'),
          ],
          blurRect: this._blurRect ? this._blurRect.slice() : null,
          captureClip: this._lgCaptureClip ? this._lgCaptureClip.slice() : null,
          compositeRect: this._compositeRect ? this._compositeRect.slice() : null,
          blurPool: [this._poolWidth, this._poolHeight, this._blurDownscale],
        },
      };
    }
  }















  // settled in one session: global._lgGlass.cropPass(false) turns it off.























  // global._lgGlass.blurRect(false) turns it off for A/B testing.
  static USE_BLUR_RECT = true;




  static BLUR_RECT_MIN_MARGIN = 12;






  static BLUR_RECT_MIN_SAVING = 0.95;







  static BLUR_RECT_QUANTUM = 64;







  static CAPTURE_CLIP_EXTRA_MARGIN = 24;





  static CAPTURE_CLIP_MIN_SAVING = 0.85;























  // global._lgGlass.compositeRect(false) turns it off for A/B testing.
  static USE_COMPOSITE_RECT = true;


  static COMPOSITE_RECT_MIN_SAVING = 0.95;
















  private _computeCompositeRect(): number[] | null {
    if (!this._compositeRectEnabled) return null;



    if ((this._pendingUniforms.get('debug_view') ?? 0) > 0.5) return null;

    const resW = this._pendingUniforms.get('resolution_x') ?? 0;
    const resH = this._pendingUniforms.get('resolution_y') ?? 0;
    if (!(resW >= 1) || !(resH >= 1)) return null;

    const body = this._glassBodyUnion();
    if (!body) return null;
    let [x0, y0, x1, y1] = body;

    const shadowMax = Math.max(this._pendingUniforms.get('shadow_max_radius') ?? 0, 5);
    const shadowRadius = Math.max(this._pendingUniforms.get('shadow_radius') ?? 0, 0);
    const shadowIntensity = this._pendingUniforms.get('shadow_intensity') ?? 0;
    const reach = (this._multiRegion || !(shadowIntensity > 0))
      ? 0
      : Math.min(shadowRadius, shadowMax);



    const feather = Math.max(this._pendingUniforms.get('edge_smoothing') ?? 0, 0.75);
    const m = Math.ceil(reach + feather + 2);

    x0 -= m; y0 -= m; x1 += m; y1 += m;





    if ((this._pendingUniforms.get('panel_bg_a') ?? 0) > 0) {
      const px = this._pendingUniforms.get('panel_rect_x') ?? 0;
      const py = this._pendingUniforms.get('panel_rect_y') ?? 0;
      const pw = this._pendingUniforms.get('panel_rect_w') ?? 0;
      const ph = this._pendingUniforms.get('panel_rect_h') ?? 0;
      if (pw > 0 && ph > 0) {
        x0 = Math.min(x0, px - 2); y0 = Math.min(y0, py - 2);
        x1 = Math.max(x1, px + pw + 2); y1 = Math.max(y1, py + ph + 2);
      }
    }

    const maxW = Math.round(resW);
    const maxH = Math.round(resH);
    const bx = Math.max(0, Math.floor(x0));
    const by = Math.max(0, Math.floor(y0));
    const bw = Math.min(maxW, Math.ceil(x1)) - bx;
    const bh = Math.min(maxH, Math.ceil(y1)) - by;
    if (!(bw >= 2) || !(bh >= 2)) return null;
    if (bw * bh >= maxW * maxH * LiquidEffect.COMPOSITE_RECT_MIN_SAVING) return null;

    return [bx, by, bw, bh];
  }















  private _glassBodyUnion(): number[] | null {
    const pad = Math.max(this._pendingUniforms.get('padding') ?? 0, 0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rects = this._multiRegion ? this._regionRects : [this._glassRect];
    for (const r of rects) {
      const [rx, ry, rw, rh] = r;
      if (!(rw > 0) || !(rh > 0)) continue;



      const ix = Math.min(pad, Math.max(rw / 2 - 1, 0));
      const iy = Math.min(pad, Math.max(rh / 2 - 1, 0));
      if (rx + ix < x0) x0 = rx + ix;
      if (ry + iy < y0) y0 = ry + iy;
      if (rx + rw - ix > x1) x1 = rx + rw - ix;
      if (ry + rh - iy > y1) y1 = ry + rh - iy;
    }
    if (!(x1 > x0) || !(y1 > y0)) return null;
    const arrowSide = this._pendingUniforms.get('arrow_side') ?? 0;
    const arrowRise = this._pendingUniforms.get('arrow_rise') ?? 0;
    if (arrowSide === 1 && arrowRise > 0) {
      y0 = Math.max(0, y0 - arrowRise);
    } else if (arrowSide === 3 && arrowRise > 0) {
      y1 = y1 + arrowRise;
    }
    return [x0, y0, x1, y1];
  }

























































  getResolution(): [number, number] {
    return [
      this._pendingUniforms.get('resolution_x') ?? 0,
      this._pendingUniforms.get('resolution_y') ?? 0,
    ];
  }


  // so global._lgGlass.dump() can show it. Written from utils.ts.
  declare _lgCaptureClip: number[] | null;

  getCaptureClipRect(): number[] | null {
    const resW = this._pendingUniforms.get('resolution_x') ?? 0;
    const resH = this._pendingUniforms.get('resolution_y') ?? 0;
    if (!(resW >= 1) || !(resH >= 1)) return null;

    const body = this._glassBodyUnion();
    if (!body) return null;
    const [x0, y0, x1, y1] = body;


    const ior = this._pendingUniforms.get('ior') ?? 1.5;
    const dispScale = this._pendingUniforms.get('displacement_scale') ?? 0;
    const eta = 1.0 / Math.max(ior, 1.001);
    const bend = Math.min(eta / Math.sqrt(Math.max(1 - eta * eta, 1e-6)), 1 / 0.15);
    const minRes = Math.max(Math.min(resW, resH), 1);
    const dispUV = Math.min(0.30, bend * Math.max(dispScale, 0) / minRes);

    const feather = Math.max(this._pendingUniforms.get('edge_smoothing') ?? 0, 0.75);
    const blurReach = 3 * Math.max(Math.min(this._targetRadius, 30), 0);
    const extra = LiquidEffect.BLUR_RECT_MIN_MARGIN + feather + 2.5 +
      blurReach + LiquidEffect.CAPTURE_CLIP_EXTRA_MARGIN;

    const mx = Math.ceil(dispUV * resW + extra);
    const my = Math.ceil(dispUV * resH + extra);

    const maxW = Math.round(resW);
    const maxH = Math.round(resH);
    let cx = Math.max(0, Math.floor(x0 - mx));
    let cy = Math.max(0, Math.floor(y0 - my));
    let cw = Math.min(maxW, Math.ceil(x1 + mx)) - cx;
    let ch = Math.min(maxH, Math.ceil(y1 + my)) - cy;
    if (!(cw >= 2) || !(ch >= 2)) return null;



    const q = LiquidEffect.BLUR_RECT_QUANTUM;
    cw = Math.min(maxW, Math.ceil(cw / q) * q);
    ch = Math.min(maxH, Math.ceil(ch / q) * q);
    cx = Math.max(0, Math.min(cx, maxW - cw));
    cy = Math.max(0, Math.min(cy, maxH - ch));




    if (cw * ch >= resW * resH * LiquidEffect.CAPTURE_CLIP_MIN_SAVING) return null;

    return [cx, cy, cw, ch];
  }

  private _computeBlurRect(): number[] | null {
    if (!this._blurRectEnabled) return null;

    const resW = this._pendingUniforms.get('resolution_x') ?? 0;
    const resH = this._pendingUniforms.get('resolution_y') ?? 0;
    if (!(resW >= 1) || !(resH >= 1)) return null;

    const body = this._glassBodyUnion();
    if (!body) return null;
    const [x0, y0, x1, y1] = body;

    const ior = this._pendingUniforms.get('ior') ?? 1.5;
    const dispScale = this._pendingUniforms.get('displacement_scale') ?? 0;
    const eta = 1.0 / Math.max(ior, 1.001);


    const bend = Math.min(eta / Math.sqrt(Math.max(1 - eta * eta, 1e-6)), 1 / 0.15);
    const minRes = Math.max(Math.min(resW, resH), 1);
    const dispUV = Math.min(0.30, bend * Math.max(dispScale, 0) / minRes);
    const dispX = dispUV * resW;
    const dispY = dispUV * resH;

    const feather = Math.max(this._pendingUniforms.get('edge_smoothing') ?? 0, 0.75);
    const extra = LiquidEffect.BLUR_RECT_MIN_MARGIN + feather + 2.5;

    const mx = Math.ceil(dispX + extra);
    const my = Math.ceil(dispY + extra);

    const maxW = Math.round(resW);
    const maxH = Math.round(resH);
    let bx = Math.max(0, Math.floor(x0 - mx));
    let by = Math.max(0, Math.floor(y0 - my));
    let bw = Math.min(maxW, Math.ceil(x1 + mx)) - bx;
    let bh = Math.min(maxH, Math.ceil(y1 + my)) - by;
    if (!(bw >= 2) || !(bh >= 2)) return null;



    const q = LiquidEffect.BLUR_RECT_QUANTUM;
    bw = Math.min(maxW, Math.ceil(bw / q) * q);
    bh = Math.min(maxH, Math.ceil(bh / q) * q);
    bx = Math.max(0, Math.min(bx, maxW - bw));
    by = Math.max(0, Math.min(by, maxH - bh));


    if (bw * bh >= resW * resH * LiquidEffect.BLUR_RECT_MIN_SAVING) return null;

    return [bx, by, bw, bh];
  }

  static USE_CROP_PASS = true;





  private _ensureCropTarget(ctx: Cogl.Context, w: number, h: number): boolean {
    if (this._cropTexture && this._cropFbo &&
      this._cropPoolW === w && this._cropPoolH === h) {
      return true;
    }



    this._cropTexture = null;
    this._cropFbo = null;
    this._cropPoolW = 0;
    this._cropPoolH = 0;

    try {
      const tex = Cogl.Texture2D.new_with_size(ctx, w, h);
      const fbo = Cogl.Offscreen.new_with_texture(tex);
      this._cropTexture = tex;
      this._cropFbo = fbo;
      this._cropPoolW = w;
      this._cropPoolH = h;
      return true;
    } catch (e) {
      this._logger?.error(`[Liquid Glass] Failed to create crop texture (${w}x${h}): ${e}`);
      return false;
    }
  }


































  private _addCropPassNode(
    parentNode: any, ctx: Cogl.Context, srcTex: Cogl.Texture,
    srcW: number, srcH: number, allocW: number, allocH: number, uv: number[]
  ): Cogl.Texture {
    if (allocW === srcW && allocH === srcH) return srcTex;
    if (!this._passthroughPipeline) return srcTex;
    if (!this._ensureCropTarget(ctx, allocW, allocH)) return srcTex;


    const pipeline = this._passPipeline('crop', this._passthroughPipeline);
    pipeline.set_layer_texture(0, srcTex);

    this._addPassNode(parentNode, this._cropFbo, pipeline, allocW, allocH, uv);
    return this._cropTexture!;
  }

  private _destroyCropTarget(): void {
    this._cropTexture = null;
    this._cropFbo = null;
    this._cropPoolW = 0;
    this._cropPoolH = 0;
  }






















  private _passPipeline(key: string, base: Cogl.Pipeline): Cogl.Pipeline {
    const cached = this._passPipelines.get(key);
    if (cached && cached.base === base) return cached.copy;

    const copy = base.copy();
    try {
      copy.set_blend('RGBA = ADD(SRC_COLOR, 0)');
    } catch (e) {
      this._logger?.error(`[Liquid Glass] set_blend failed for pass '${key}': ${e}`);
    }
    this._passPipelines.set(key, { base, copy });
    return copy;
  }

















  private _addPassNode(
    parentNode: any, targetFbo: any, pipeline: Cogl.Pipeline,
    destW: number, destH: number, uv: number[]
  ): void {
    (targetFbo as unknown as CoglFB).orthographic(0, 0, destW, destH, -1, 1);

    const layerNode = Clutter.LayerNode.new_to_framebuffer(targetFbo, pipeline);
    parentNode.add_child(layerNode);

    const drawNode = Clutter.PipelineNode.new(pipeline);
    layerNode.add_child(drawNode);
    drawNode.add_texture_rectangle(
      new Clutter.ActorBox({ x1: 0, y1: 0, x2: destW, y2: destH }),
      uv[0], uv[1], uv[2], uv[3]
    );
  }
















  private _addCompositeNode(
    parentNode: any, dest: number[], layer0UV: number[], layer1UV: number[]
  ): void {
    if (layer0UV[0] !== layer1UV[0] || layer0UV[1] !== layer1UV[1] ||
      layer0UV[2] !== layer1UV[2] || layer0UV[3] !== layer1UV[3]) {



      if (!this._uvMismatchWarned) {
        this._uvMismatchWarned = true;
        this._logger?.error(
          '[Liquid Glass] composite layers disagree on UV range ' +
          `(layer0=[${layer0UV}] layer1=[${layer1UV}]); drawing with layer 0's range. ` +
          'This means the crop pass did not run when it was needed.'
        );
      }
    }

    const drawNode = Clutter.PipelineNode.new(this._compositePipeline!);
    parentNode.add_child(drawNode);
    drawNode.add_texture_rectangle(
      new Clutter.ActorBox({ x1: dest[0], y1: dest[1], x2: dest[2], y2: dest[3] }),
      layer0UV[0], layer0UV[1], layer0UV[2], layer0UV[3]
    );
  }







  private _setPipelineVec2(
    pipeline: Cogl.Pipeline, name: string, x: number, y: number
  ): void {
    setUniformVector(pipeline, name, [x, y]);
  }




  private _setPipelineFloat(
    pipeline: Cogl.Pipeline, name: string, value: number
  ): void {
    const loc = pipeline.get_uniform_location(name);
    pipeline.set_uniform_1f(loc, value);
  }






  private _setFloat(name: string, value: number): void {



    if (this._pendingUniforms.get(name) === value) return;

    this._pendingUniforms.set(name, value);
    this._uniformsDirty = true;
    if (this._compositePipeline) {
      this._applyUniform(name, value);
    }
  }





  private _queueRepaintIfDirty(): void {
    if (!this._uniformsDirty) return;
    this._uniformsDirty = false;
    this.queue_repaint();
  }

  private _applyUniform(name: string, value: number): void {
    if (!this._compositePipeline) return;




    if (this._appliedUniforms.get(name) === value) return;


    let loc = this._compUniforms.get(name);
    if (loc === undefined) {
      loc = this._compositePipeline.get_uniform_location(name);
      this._compUniforms.set(name, loc);
    }

    this._uniformScratch[0] = value;
    this._compositePipeline.set_uniform_1f(loc, value);
    this._appliedUniforms.set(name, value);
  }

  private _applyPendingUniforms(): void {
    for (const [name, value] of this._pendingUniforms) {
      this._applyUniform(name, value);
    }
    for (const [name, values] of this._pendingUniformArrays) {
      this._applyUniformArray(name, values);
    }
  }







  private _setFloatArray(name: string, values: number[]): void {
    const prev = this._pendingUniformArrays.get(name);
    if (prev && prev.length === values.length) {
      let same = true;
      for (let i = 0; i < values.length; i++) {
        if (prev[i] !== values[i]) { same = false; break; }
      }
      if (same) return;
    }




    this._pendingUniformArrays.set(name, values.slice());
    this._uniformsDirty = true;
    if (this._compositePipeline) {
      this._applyUniformArray(name, values);
    }
  }

  private _applyUniformArray(name: string, values: number[]): void {
    if (!this._compositePipeline) return;




    const applied = this._appliedUniformArrays.get(name);
    if (applied && applied.length === values.length) {
      let same = true;
      for (let i = 0; i < values.length; i++) {
        if (applied[i] !== values[i]) { same = false; break; }
      }
      if (same) return;
    }

    let loc = this._compUniformArrays.get(name);
    if (loc === undefined) {
      loc = this._compositePipeline.get_uniform_location(name);
      this._compUniformArrays.set(name, loc);
    }

    setUniformArray(this._compositePipeline, loc, name, values);
    this._appliedUniformArrays.set(name, values.slice());
  }



  private _getCoglContext(): Cogl.Context | null {
    try {


      const backend = Clutter.get_default_backend();
      return backend.get_cogl_context() as Cogl.Context;
    } catch (e) {
      this._logger?.error(`[Liquid Glass] Failed to obtain the Cogl context: ${e}`);
      return null;
    }
  }



  _bindSettings(): void {
    const mappings: { key: string; uniform: string }[] = [
      { key: 'glass-max-z', uniform: 'max_z' },
      { key: 'glass-displacement-scale', uniform: 'displacement_scale' },
      { key: 'glass-edge-smoothing', uniform: 'edge_smoothing' },
      { key: 'glass-profile-shape-n', uniform: 'profile_shape_n' },
      { key: 'glass-ior', uniform: 'ior' },
      { key: 'glass-chroma-strength', uniform: 'chroma_strength' },
      { key: 'glass-specular-intensity', uniform: 'specular_intensity' },
      { key: 'glass-shininess', uniform: 'shininess' },
      { key: 'glass-rim-width', uniform: 'rim_width' },
      { key: 'glass-rim-intensity', uniform: 'rim_intensity' },
      { key: 'glass-rim-directional-power', uniform: 'rim_directional_power' },
      { key: 'glass-rim-power', uniform: 'rim_power' },
      { key: 'glass-rim-light-color-intensity', uniform: 'rim_light_color_intensity' },
      { key: 'glass-sheen-intensity', uniform: 'sheen_intensity' },
      { key: 'glass-light-angle-deg', uniform: 'light_angle_deg' },
      { key: 'shadow-radius', uniform: 'shadow_radius' },
      { key: 'shadow-intensity', uniform: 'shadow_intensity' },


      { key: 'glass-ao-intensity', uniform: 'ao_intensity' },
      { key: 'glass-ao-radius', uniform: 'ao_radius' },
    ];

    const settings = this._settings;
    if (!settings) return;

    mappings.forEach(map => {
      const isCustomShadowOwner = (
        this._owner === 'desktop-widget-glass' ||
        this._owner === 'spotlight' ||
        this._owner === 'applications' ||
        this._owner === 'clipboard' ||
        this._owner === 'notification' ||
        this._owner === 'notification-banner' ||
        this._owner === 'osd' ||
        (this._owner && this._owner.includes('osd')) ||
        (this._owner && this._owner.includes('notif'))
      );
      if (isCustomShadowOwner && (map.uniform === 'shadow_intensity' || map.uniform === 'shadow_radius' || map.uniform === 'shadow_max_radius')) {
        return;
      }

      let val = settings.get_double(map.key);
      if (map.uniform === 'shadow_intensity' && this._shadowIntensityMultiplier !== undefined) {
        val *= this._shadowIntensityMultiplier;
      }
      this._setFloat(map.uniform, val);

      const id = settings.connect(`changed::${map.key}`, () => {
        let v = settings.get_double(map.key);
        if (map.uniform === 'shadow_intensity' && this._shadowIntensityMultiplier !== undefined) {
          v *= this._shadowIntensityMultiplier;
        }
        this._setFloat(map.uniform, v);
      });
      this._settingsIds.push(id);
    });

    if (settings && settings.settings_schema && settings.settings_schema.has_key('glass-shape-type')) {
      const applyShape = () => {


        const o = (this._owner || '').toLowerCase();
        if (o && (
          o.includes('dock') ||
          o.includes('panel') ||
          o.includes('osd') ||
          o.includes('notification') ||
          o.includes('quick-settings') ||
          o.includes('tahoe-qs') ||
          o.includes('tahoe-nc') ||
          o.includes('menu') ||
          o.includes('spotlight') ||
          o.includes('application') ||
          o.includes('modal') ||
          o.includes('dialog') ||
          o.includes('switcher') ||
          o.includes('clipboard') ||
          o.includes('toast') ||
          o.includes('topbar') ||
          o.includes('widget')
        )) {
          this._setFloat('shape_type', 0.0);
          return;
        }
        const shape = settings.get_int('glass-shape-type');
        this._setFloat('shape_type', (shape >= 1 && shape <= 2) ? shape : 0.0);
      };
      applyShape();
      const shapeId = settings.connect('changed::glass-shape-type', applyShape);
      this._settingsIds.push(shapeId);
    }







    const applyDownscale = () => {
      const raw = settings.get_int('glass-blur-downscale');
      const factor = raw >= 4 ? 4 : (raw <= 1 ? 1 : 2);
      if (factor === this._blurDownscale) return;
      this._blurDownscale = factor;


      this._destroyTexturePool();
      this.setBlurRadius(this._targetRadius);
      this.queue_repaint();
    };
    applyDownscale();
    const downscaleId = settings.connect('changed::glass-blur-downscale', applyDownscale);
    this._settingsIds.push(downscaleId);



    const applyBlurMethod = () => {
      const raw = settings.get_int('blur-method');
      this.setBlurMethod(raw === 0 ? 0 : 1);
    };
    applyBlurMethod();
    const blurMethodId = settings.connect('changed::blur-method', applyBlurMethod);
    this._settingsIds.push(blurMethodId);





    const applyDiagFlag = () => {
      this._diagEnabled = settings.get_boolean('glass-debug-diagnostics');
    };
    applyDiagFlag();
    const diagId = settings.connect('changed::glass-debug-diagnostics', applyDiagFlag);
    this._settingsIds.push(diagId);
  }



  cleanup(): void {
    _liveEffects.delete(this);



    if (_liveEffects.size === 0) _releaseFrameSerialHook();


    if (this._settings && this._settingsIds) {
      this._settingsIds.forEach(id => this._settings?.disconnect(id));
      this._settingsIds = [];
    }


    this._destroyTexturePool();



    this._downsamplePipeline = null;
    this._upsamplePipeline = null;
    this._passthroughPipeline = null;
    this._boxDownPipeline = null;
    this._gaussianHPipeline = null;
    this._gaussianVPipeline = null;
    this._compositePipeline = null;
    this._compUniforms.clear();
    this._pendingUniforms.clear();
    this._compUniformArrays.clear();
    this._pendingUniformArrays.clear();
    this._appliedUniforms.clear();
    this._appliedUniformArrays.clear();


    this._gaussianKernel = null;
    this._pendingGaussianKernel = null;
    this._gaussianPipelineDirty = false;
    this._gaussianBaseSigma = 0;
    this._gaussianScale = 1.0;
    this._gaussianFetchPairs = 0;
  }

  /**
   * [PERF/DEBUG] Turns glass.frag's two early exits on/off at runtime.
   *
   * They are meant to be exactly equivalent to the full per-pixel path, so
   * anything that looks different with them on is a bug in the thresholds.
   * Being able to flip this inside a running session — rather than
   * rebuilding and reproducing the state again — is what makes such a
   * report cheap to settle. Reachable as global._lgGlass.earlyExit(bool).
   */
  /**
   * [PERF/DEBUG] Turns the crop pass on/off at runtime; see USE_CROP_PASS.
   * Reachable as global._lgGlass.cropPass(bool).
   */
  setCropPassEnabled(enabled: boolean): void {
    this._cropPassEnabled = enabled;
    this.queue_repaint();
  }






  setBlurRectEnabled(enabled: boolean): void {
    this._blurRectEnabled = enabled;

    this._destroyTexturePool();
    this.queue_repaint();
  }






  setCompositeRectEnabled(enabled: boolean): void {
    this._compositeRectEnabled = enabled;
    this.queue_repaint();
  }

  setEarlyExitEnabled(enabled: boolean): void {
    this._setFloat('early_exit_enabled', enabled ? 1.0 : 0.0);
    this._queueRepaintIfDirty();
  }

  /**
   * [DEBUG] Diagnostic visualisation mode; see glass.frag's debug_view.
   * 0 = normal, 1 = shadow/shape mask view. Reachable as
   * global._lgGlass.debugView(n).
   */
  setDebugView(mode: number): void {
    this._setFloat('debug_view', mode);
    this._queueRepaintIfDirty();
  }

  setIsDock(isDock: boolean): void {
    this._setFloat('isDock', isDock ? 1.0 : 0.0);
  }

  setShapeType(shape: number): void {
    this._setFloat('shape_type', shape);
  }











  setSurfaceLightEnabled(enabled: boolean): void {
    this._setFloat('surface_light_enabled', enabled ? 1.0 : 0.0);
    this._queueRepaintIfDirty();
  }

  setPadding(pad: number): void {
    this._setFloat('padding', pad);
  }









  setShadowMaxRadius(radius: number): void {
    this._setFloat('shadow_max_radius', radius);
  }

  setShadowIntensityMultiplier(multiplier: number): void {
    (this as any)._shadowIntensityMultiplier = multiplier;
    const base = this._settings?.get_double('shadow-intensity') ?? 0.55;
    this._setFloat('shadow_intensity', base * multiplier);
    this.queue_repaint();
  }

  setShadowIntensity(intensity: number): void {
    this._setFloat('shadow_intensity', intensity);
    this.queue_repaint();
  }


















  reloadShaders(): void {
    this._compositePipeline = null;
    this._downsamplePipeline = null;
    this._upsamplePipeline = null;
    this._passthroughPipeline = null;
    this._boxDownPipeline = null;
    this._gaussianHPipeline = null;
    this._gaussianVPipeline = null;
    this._gaussianKernel = null;
    this._gaussianFetchPairs = 0;
    this._compUniforms.clear();
    this._compUniformArrays.clear();
    this._appliedUniforms.clear();
    this._appliedUniformArrays.clear();
    this._glassSource = null;
    this._downsampleSource = null;
    this._upsampleSource = null;
    this._shadersLoaded = false;







    this.setBlurRadius(this._targetRadius);
    if (typeof (this as any)._loadAllShadersAsync === 'function') {
      (this as any)._loadAllShadersAsync().then(() => {
        this.queue_repaint();
      }).catch((e: any) => {
        this._logger?.error(`[Liquid Glass] reloadShaders failed to load shaders: ${e}`);
      });
    } else {
      this.queue_repaint();
    }
  }

  setTintColor(r: number, g: number, b: number): void {
    this._setFloat('tint_r', r);
    this._setFloat('tint_g', g);
    this._setFloat('tint_b', b);
    this._queueRepaintIfDirty();
  }





  setPanelBackgroundColor(r: number, g: number, b: number, a: number): void {
    this._setFloat('panel_bg_r', r);
    this._setFloat('panel_bg_g', g);
    this._setFloat('panel_bg_b', b);
    this._setFloat('panel_bg_a', a);
    this._queueRepaintIfDirty();
  }







  setPanelRect(x: number, y: number, w: number, h: number): void {
    this._setFloat('panel_rect_x', x);
    this._setFloat('panel_rect_y', y);
    this._setFloat('panel_rect_w', w);
    this._setFloat('panel_rect_h', h);
    this._queueRepaintIfDirty();
  }

  setTintStrength(strength: number): void {
    this._setFloat('tint_strength', strength);
    this._queueRepaintIfDirty();
  }

  setCornerRadius(radius: number): void {
    this._setFloat('corner_radius', radius);
    this._queueRepaintIfDirty();
  }

  setShapeType(shape: number): void {
    this._setFloat('shape_type', shape);
    this._queueRepaintIfDirty();
  }

  setArrow(side = 0, origin = 0, base = 18.0, rise = 8.0, radius = 2.0, fillet = 5.0): void {
    this._setFloat('arrow_side', side);
    this._setFloat('arrow_origin', origin);
    this._setFloat('arrow_base', base);
    this._setFloat('arrow_rise', rise);
    this._setFloat('arrow_radius', radius);
    this._setFloat('arrow_fillet', fillet);
    this._queueRepaintIfDirty();
  }

  setAnimationScale(scale: number): void {
    const settings = this._settings;
    if (!settings) return;
    this._setFloat('displacement_scale',
      settings.get_double('glass-displacement-scale') * scale);
    this._setFloat('max_z',
      settings.get_double('glass-max-z') * scale);
    this._setFloat('chroma_strength',
      settings.get_double('glass-chroma-strength') * scale);
    this._queueRepaintIfDirty();
  }

  setPointerPosition(x: number, y: number, intensity: number): void {
    this._setFloat('pointer_x', x);
    this._setFloat('pointer_y', y);
    this._setFloat('intensity', intensity);
  }








  setResolution(width: number, height: number): void {
    this._setFloat('resolution_x', width);
    this._setFloat('resolution_y', height);
    this._queueRepaintIfDirty();
  }





  setGlassGeometry(x: number, y: number, w: number, h: number): void {
    this._setFloat('dock_x', x);
    this._setFloat('dock_y', y);
    this._setFloat('dock_w', w);
    this._setFloat('dock_h', h);



    this._glassRect[0] = x;
    this._glassRect[1] = y;
    this._glassRect[2] = w;
    this._glassRect[3] = h;
    this._queueRepaintIfDirty();
  }









  setMultiRegionMode(enabled: boolean): void {
    this._setFloat('multi_region_mode', enabled ? 1.0 : 0.0);
    this._multiRegion = enabled;
    this._queueRepaintIfDirty();
  }








  static DRAG_PERF_MODE_ENABLED = true;













  private declare _batchDepth: number;
  private declare _batchDirty: boolean;

  beginBatch(): void {
    if (!LiquidEffect.DRAG_PERF_MODE_ENABLED) return;
    this._batchDepth = (this._batchDepth || 0) + 1;
  }

  endBatch(): void {
    if (!LiquidEffect.DRAG_PERF_MODE_ENABLED) return;
    if (!this._batchDepth) return;
    this._batchDepth--;
    if (this._batchDepth === 0 && this._batchDirty) {
      this._batchDirty = false;
      // @ts-ignore — calling the inherited Clutter.Effect implementation

      Clutter.Effect.prototype.queue_repaint.call(this);
    }
  }






  markBackdropDirty(): void {
    this._backdropDirty = true;
    try { this.queue_repaint(); } catch (_) {}
  }

  queue_repaint(): void {
    this._backdropDirty = true;
    if (LiquidEffect.DRAG_PERF_MODE_ENABLED && this._batchDepth) {
      this._batchDirty = true;
      return;
    }
    // @ts-ignore
    super.queue_repaint();
  }


















  setGlassRegions(regions: {
    x: number; y: number; w: number; h: number;
    tintR: number; tintG: number; tintB: number;
    baseStrength?: number;
  }[]): void {
    const clamped = regions.slice(0, LiquidEffect.MAX_GLASS_REGIONS);

    const rx = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(0.0);
    const ry = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(0.0);
    const rw = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(0.0);
    const rh = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(0.0);
    const rTintR = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(1.0);
    const rTintG = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(1.0);
    const rTintB = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(1.0);
    const rBaseStrength = new Array(LiquidEffect.MAX_GLASS_REGIONS).fill(0.0);

    clamped.forEach((region, i) => {
      rx[i] = region.x;
      ry[i] = region.y;
      rw[i] = region.w;
      rh[i] = region.h;
      rTintR[i] = region.tintR;
      rTintG[i] = region.tintG;
      rTintB[i] = region.tintB;
      rBaseStrength[i] = Math.max(0.0, Math.min(1.0, region.baseStrength ?? 0.0));
    });


    this._regionRects = clamped.map(r => [r.x, r.y, r.w, r.h]);

    this._setFloat('region_count', clamped.length);
    this._setFloatArray('region_x', rx);
    this._setFloatArray('region_y', ry);
    this._setFloatArray('region_w', rw);
    this._setFloatArray('region_h', rh);
    this._setFloatArray('region_tint_r', rTintR);
    this._setFloatArray('region_tint_g', rTintG);
    this._setFloatArray('region_tint_b', rTintB);
    this._setFloatArray('region_base_strength', rBaseStrength);
    this._queueRepaintIfDirty();
  }

  setBrightness(brightness: number): void {
    this._setFloat('brightness', brightness);
    this._queueRepaintIfDirty();
  }

  setContrast(contrast: number): void {
    this._setFloat('contrast', contrast);
    this._queueRepaintIfDirty();
  }

  setSaturation(saturation: number): void {
    this._setFloat('saturation', saturation);
    this._queueRepaintIfDirty();
  }














  setBlurMethod(method: BlurMethod): void {
    if (this._blurMethod === method) return;
    this._blurMethod = method;
    this.setBlurRadius(this._targetRadius);
    this.queue_repaint();
  }





  setBlurRadius(radius: number): void {
    this._targetRadius = radius;

    if (this._blurMethod === 0) {
      this._setGaussianBlurRadius(radius);
      return;
    }

    this._setDualKawaseBlurRadius(radius);
  }



























  private _setGaussianBlurRadius(radius: number): void {





    const RES_SCALE = this._blurDownscale >= 4 ? 4.0 : (this._blurDownscale === 2 ? 2.0 : 1.0);
    const MAX_SIGMA_TEXEL = 15.0;











    const MIN_SIGMA_TEXEL = 1.0;

    if (radius <= 0) {
      if (this.PASS_COUNT !== 0) {
        this.PASS_COUNT = 0;
        this._destroyTexturePool();
      }
      this._gaussianScale = 0.0;
      this.queue_repaint();
      return;
    }

    const sigmaTexel = Math.min(radius / RES_SCALE, MAX_SIGMA_TEXEL);




    const kernelSigma = Math.max(sigmaTexel, MIN_SIGMA_TEXEL);





    const sideTaps = Math.max(2, Math.ceil(kernelSigma * 4));
    const fetchPairs = Math.max(2, Math.ceil(sideTaps / 2));

    const needsRecompile =
      this._gaussianFetchPairs !== fetchPairs ||
      (!this._gaussianKernel && !this._pendingGaussianKernel);

    if (needsRecompile) {
      const kernel = this._computeGaussianKernel(kernelSigma, fetchPairs);
      this._pendingGaussianKernel = kernel;
      this._gaussianPipelineDirty = true;
      this._gaussianFetchPairs = fetchPairs;
      this._gaussianBaseSigma = kernelSigma;


      this._gaussianScale = sigmaTexel / kernelSigma;
    } else {


      this._gaussianScale = this._gaussianBaseSigma > 0
        ? sigmaTexel / this._gaussianBaseSigma
        : 1.0;
    }




    if (this.PASS_COUNT !== 1) {
      this.PASS_COUNT = 1;




      this._destroyTexturePool();
    }

    this.queue_repaint();
  }




  private _setDualKawaseBlurRadius(radius: number): void {








    let newPassCount = 0;
    let offsetDown = 0.0;
    let offsetUp = 0.0;

    if (radius > 0) {


      let p = Math.floor(Math.log2(radius + 1));


      newPassCount = Math.max(1, Math.min(4, p));


      let baseR = (newPassCount === 1) ? 0 : Math.pow(2, newPassCount) - 1;
      let nextR = Math.pow(2, newPassCount + 1) - 1;

      let t = (radius - baseR) / (nextR - baseR);
      t = Math.max(0.0, Math.min(1.0, t));


      let s = 0.25 * Math.pow(t, 3) - 0.75 * Math.pow(t, 2) + 1.5 * t;


      let minOffset = (newPassCount === 1) ? 0.0 : 0.5;
      let maxOffset = 1.0;

      let r = minOffset + s * (maxOffset - minOffset);

      offsetDown = r;
      offsetUp = r * 1.5;
    }


    if (this.PASS_COUNT !== newPassCount ||
      this._blurRadiusDown !== offsetDown ||
      this._blurRadiusUp !== offsetUp) {

      const passCountChanged = this.PASS_COUNT !== newPassCount;

      this.PASS_COUNT = newPassCount;
      this._blurRadiusDown = offsetDown;
      this._blurRadiusUp = offsetUp;


      if (passCountChanged) {
        this._destroyTexturePool();
      }

      this.queue_repaint();
    }
  }
});

export type LiquidEffect = InstanceType<typeof LiquidEffect>;
