// sharedGlassEngine.js — Unified Shared Liquid Glass Render Engine for macW1Y
// Centralized GPU Pipeline, Texture Pool, Intelligent Damage Tracking & Adaptive Scheduler.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ========== CONSTANTS & TUNING ==========
export const TARGET_FRAME_BUDGET_MS = 16.67; // 60 FPS
export const HIGH_LOAD_THRESHOLD_MS = 25.0;  // Frame drop trigger
export const TEXTURE_BUCKET_ALIGN = 64;      // Quantization granularity for texture reuse
export const TEXTURE_CACHE_TTL_MS = 15000;   // Keep unused textures in pool for 15s

// Helper for rectangle intersection
export function rectsIntersect(r1x, r1y, r1w, r1h, r2x, r2y, r2w, r2h) {
    return !(
        r1x + r1w <= r2x ||
        r1x >= r2x + r2w ||
        r1y + r1h <= r2y ||
        r1y >= r2y + r2h
    );
}

// Align size up to bucket to prevent constant reallocations during motion/resize
export function bucketSize(val, align = TEXTURE_BUCKET_ALIGN) {
    if (!Number.isFinite(val) || val <= 0) return align;
    return Math.ceil(val / align) * align;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PIPELINE POOL (Reusable Shaders & Compilations)
// ─────────────────────────────────────────────────────────────────────────────
class SharedPipelinePool {
    constructor() {
        this._compositeBase = null;
        this._downsampleBase = null;
        this._upsampleBase = null;
        this._gaussianPipelines = new Map(); // key: fetchPairs -> { h, v }
        this._fallbackTintPipeline = null;
        this._extensionPath = null;
    }

    init(extensionPath) {
        this._extensionPath = extensionPath;
    }

    _getCoglContext() {
        return Clutter.get_default_backend().get_cogl_context();
    }

    _loadShader(filename) {
        try {
            const extDir = this._extensionPath || (GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com');
            const path = GLib.build_filenamev([extDir, 'shaders', filename]);
            const [ok, bytes] = GLib.file_get_contents(path);
            if (ok) {
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(bytes);
            }
        } catch (_) {}
        return null;
    }

    _configureSampler(pipeline, layer) {
        pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        pipeline.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    }

    getFallbackTintPipeline(ctx) {
        if (this._fallbackTintPipeline) return this._fallbackTintPipeline.copy();
        ctx = ctx || this._getCoglContext();
        if (!ctx) return null;

        try {
            const p = Cogl.Pipeline.new(ctx);
            // macOS Tahoe dark frosted glass fallback: #1d1d20 with alpha 0.72
            const color = new Cogl.Color();
            color.init_from_4f(0.114, 0.114, 0.125, 0.72);
            p.set_color(color);
            p.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1 - SRC_COLOR[A]))');
            this._fallbackTintPipeline = p;
            return p.copy();
        } catch (e) {
            console.error(`[SharedGlassEngine] Failed to create fallback tint pipeline: ${e}`);
            return null;
        }
    }

    getDownsamplePipeline(ctx, shaderSource) {
        if (this._downsampleBase) return this._downsampleBase.copy();
        ctx = ctx || this._getCoglContext();
        shaderSource = shaderSource || this._loadShader('downsample.frag');
        if (!ctx || !shaderSource) return null;

        try {
            const p = Cogl.Pipeline.new(ctx);
            this._configureSampler(p, 0);
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, shaderSource, null);
            snippet.set_replace('cogl_color_out = downsample(cogl_sampler0, cogl_tex_coord_in[0].st);');
            p.add_snippet(snippet);
            this._downsampleBase = p;
            return p.copy();
        } catch (e) {
            console.error(`[SharedGlassEngine] Failed to compile downsample pipeline: ${e}`);
            return null;
        }
    }

    getUpsamplePipeline(ctx, shaderSource) {
        if (this._upsampleBase) return this._upsampleBase.copy();
        ctx = ctx || this._getCoglContext();
        shaderSource = shaderSource || this._loadShader('upsample.frag');
        if (!ctx || !shaderSource) return null;

        try {
            const p = Cogl.Pipeline.new(ctx);
            this._configureSampler(p, 0);
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, shaderSource, null);
            snippet.set_replace('cogl_color_out = upsample(cogl_sampler0, cogl_tex_coord_in[0].st);');
            p.add_snippet(snippet);
            this._upsampleBase = p;
            return p.copy();
        } catch (e) {
            console.error(`[SharedGlassEngine] Failed to compile upsample pipeline: ${e}`);
            return null;
        }
    }

    getCompositePipeline(ctx, glassSource, splitShaderFn) {
        if (this._compositeBase) return this._compositeBase.copy();
        ctx = ctx || this._getCoglContext();
        if (!ctx || !glassSource || typeof splitShaderFn !== 'function') return null;

        try {
            const p = Cogl.Pipeline.new(ctx);
            p.set_blend('RGBA = ADD (SRC_COLOR * 1, DST_COLOR * (1 - SRC_COLOR:A))');
            this._configureSampler(p, 0);
            this._configureSampler(p, 1);

            let { decl, body } = splitShaderFn(glassSource);
            decl = decl.replace(/uniform\s+sampler2D\s+cogl_sampler\d*\s*;[^\n]*/g, '');
            body = body.replace(/\bcogl_sampler\b/g, 'cogl_sampler0');
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, decl, null);
            snippet.set_replace(body);
            p.add_snippet(snippet);

            this._compositeBase = p;
            return p.copy();
        } catch (e) {
            console.error(`[SharedGlassEngine] Failed to compile composite glass pipeline: ${e}`);
            return null;
        }
    }

    getGaussianPipelines(ctx, fetchPairs, buildSnippetFn, computeKernelFn) {
        const cached = this._gaussianPipelines.get(fetchPairs);
        if (cached) {
            return {
                h: cached.h.copy(),
                v: cached.v.copy(),
                kernel: cached.kernel
            };
        }

        ctx = ctx || this._getCoglContext();
        if (!ctx || typeof buildSnippetFn !== 'function' || typeof computeKernelFn !== 'function') {
            return null;
        }

        try {
            const kernel = computeKernelFn(Math.max(1.0, fetchPairs), fetchPairs);
            const hP = Cogl.Pipeline.new(ctx);
            this._configureSampler(hP, 0);
            const hSnippet = buildSnippetFn(kernel, 'h');
            const hSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, hSnippet.decl, null);
            hSnip.set_replace(hSnippet.body);
            hP.add_snippet(hSnip);

            const vP = Cogl.Pipeline.new(ctx);
            this._configureSampler(vP, 0);
            const vSnippet = buildSnippetFn(kernel, 'v');
            const vSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, vSnippet.decl, null);
            vSnip.set_replace(vSnippet.body);
            vP.add_snippet(vSnip);

            const entry = { h: hP, v: vP, kernel };
            this._gaussianPipelines.set(fetchPairs, entry);
            return {
                h: hP.copy(),
                v: vP.copy(),
                kernel
            };
        } catch (e) {
            console.error(`[SharedGlassEngine] Failed to compile gaussian pipelines (fetchPairs=${fetchPairs}): ${e}`);
            return null;
        }
    }

    warmup(ctx) {
        try {
            ctx = ctx || this._getCoglContext();
            if (!ctx) return;
            this.getFallbackTintPipeline(ctx);
            console.log('[SharedGlassEngine] Pipelines warmed up successfully.');
        } catch (e) {
            console.warn(`[SharedGlassEngine] Warmup notice: ${e}`);
        }
    }

    clear() {
        this._compositeBase = null;
        this._downsampleBase = null;
        this._upsampleBase = null;
        this._gaussianPipelines.clear();
        this._fallbackTintPipeline = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TEXTURE POOL (Reusable FBO / Texture Buffer Ring)
// ─────────────────────────────────────────────────────────────────────────────
class SharedTexturePool {
    constructor() {
        // Pool indexed by bucket key: "width_height" -> Array<{ tex, fbo, inUse, lastUsedMs }>
        this._pool = new Map();
        this._cleanupTimerId = 0;
        this._allocatedCount = 0;
        this._reusedCount = 0;
        this._startPeriodicCleanup();
    }

    _startPeriodicCleanup() {
        if (this._cleanupTimerId) return;
        this._cleanupTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, 20, () => {
            this.purgeStale(TEXTURE_CACHE_TTL_MS);
            return GLib.SOURCE_CONTINUE;
        });
    }

    acquireBuffer(ctx, w, h) {
        ctx = ctx || Clutter.get_default_backend().get_cogl_context();
        const bw = Math.max(1, bucketSize(w));
        const bh = Math.max(1, bucketSize(h));
        const key = `${bw}_${bh}`;

        let list = this._pool.get(key);
        if (!list) {
            list = [];
            this._pool.set(key, list);
        }

        const now = GLib.get_monotonic_time() / 1000;
        for (const item of list) {
            if (!item.inUse) {
                item.inUse = true;
                item.lastUsedMs = now;
                this._reusedCount++;
                return item;
            }
        }

        // Allocate new pair
        try {
            const tex = Cogl.Texture2D.new_with_size(ctx, bw, bh);
            const fbo = Cogl.Offscreen.new_with_texture(tex);
            const item = {
                key,
                bw,
                bh,
                tex,
                fbo,
                inUse: true,
                lastUsedMs: now
            };
            list.push(item);
            this._allocatedCount++;
            return item;
        } catch (e) {
            console.error(`[SharedGlassEngine] Texture allocation failed (${bw}x${bh}): ${e}`);
            return null;
        }
    }

    releaseBuffer(item) {
        if (!item) return;
        item.inUse = false;
        item.lastUsedMs = GLib.get_monotonic_time() / 1000;
    }

    acquire(w, h) {
        const ctx = global.stage?.context || null;
        return this.acquireBuffer(ctx, w, h);
    }

    release(item) {
        this.releaseBuffer(item);
    }

    purgeAll() {
        this.clear();
    }

    purgeIdle(maxAgeMs = 0) {
        this.purgeStale(maxAgeMs);
    }

    purgeStale(maxAgeMs = TEXTURE_CACHE_TTL_MS) {
        const now = GLib.get_monotonic_time() / 1000;
        for (const [key, list] of this._pool.entries()) {
            const retained = [];
            for (const item of list) {
                if (item.inUse || (now - item.lastUsedMs) < maxAgeMs) {
                    retained.push(item);
                } else {
                    // Let GC collect Cogl textures
                    this._allocatedCount = Math.max(0, this._allocatedCount - 1);
                }
            }
            if (retained.length === 0) {
                this._pool.delete(key);
            } else {
                this._pool.set(key, retained);
            }
        }
    }

    clear() {
        if (this._cleanupTimerId) {
            GLib.source_remove(this._cleanupTimerId);
            this._cleanupTimerId = 0;
        }
        this._pool.clear();
        this._allocatedCount = 0;
    }

    getStats() {
        let total = 0;
        let inUse = 0;
        for (const list of this._pool.values()) {
            total += list.length;
            for (const item of list) {
                if (item.inUse) inUse++;
            }
        }
        return {
            totalBuffers: total,
            inUseBuffers: inUse,
            allocatedCount: this._allocatedCount,
            reusedCount: this._reusedCount
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INTELLIGENT BACKGROUND TRACKING & DAMAGE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
class BackgroundDamageTracker {
    constructor() {
        this._elements = new Map(); // id -> { actor, getRect, onDirty, isFullscreenAware }
        this._signalIds = [];
        this._windowHooked = new WeakSet();
        this._isTopFullscreen = false;
        this._lastTopWindow = null;
        this._activeWorkspace = null;
        this._monitorGeometry = null;
        this._globalDamageSeq = 0;
    }

    init() {
        this._connectShellSignals();
        this._updateFullscreenStatus();
    }

    _connectShellSignals() {
        const connect = (obj, sig, fn) => {
            if (obj && typeof obj.connect === 'function') {
                const id = obj.connect(sig, fn);
                this._signalIds.push({ obj, id });
            }
        };

        // Workspace switch
        if (global.window_manager) {
            connect(global.window_manager, 'switch-workspace', () => {
                this.invalidateAll('workspace-switch');
            });
            connect(global.window_manager, 'minimize', (_wm, actor) => {
                this._onWindowDamageOrChange(actor, 'minimize');
            });
            connect(global.window_manager, 'unminimize', (_wm, actor) => {
                this._onWindowDamageOrChange(actor, 'unminimize');
            });
            connect(global.window_manager, 'map', (_wm, actor) => {
                this._hookWindowActor(actor);
                this._onWindowDamageOrChange(actor, 'map');
            });
            connect(global.window_manager, 'destroy', (_wm, actor) => {
                this._onWindowDamageOrChange(actor, 'destroy');
            });
        }

        // Display restacking & fullscreen
        if (global.display) {
            connect(global.display, 'restacked', () => {
                this._updateFullscreenStatus();
                this.invalidateAll('restacked');
            });
            connect(global.display, 'in-fullscreen-changed', () => {
                this._updateFullscreenStatus();
                this.invalidateAll('fullscreen-changed');
            });
            connect(global.display, 'notify::focus-window', () => {
                this._updateFullscreenStatus();
            });
        }

        // Monitors changed
        if (Main.layoutManager) {
            connect(Main.layoutManager, 'monitors-changed', () => {
                this.invalidateAll('monitors-changed');
            });
        }

        // Initial hook of open windows
        const actors = global.get_window_actors?.() ?? [];
        for (const a of actors) {
            this._hookWindowActor(a);
        }
    }

    _hookWindowActor(actor) {
        if (!actor || this._windowHooked.has(actor) || actor._isDisposed) return;
        this._windowHooked.add(actor);

        try {
            actor.connectObject(
                'damaged', () => this._onWindowDamageOrChange(actor, 'damaged'),
                'notify::position', () => this._onWindowDamageOrChange(actor, 'position'),
                'notify::size', () => this._onWindowDamageOrChange(actor, 'size'),
                'notify::visible', () => this._onWindowDamageOrChange(actor, 'visible'),
                'notify::opacity', () => this._onWindowDamageOrChange(actor, 'opacity'),
                'destroy', () => {
                    this._windowHooked.delete(actor);
                    this._onWindowDamageOrChange(actor, 'destroy');
                },
                this
            );
        } catch (_) {}
    }

    _updateFullscreenStatus() {
        try {
            const fw = global.display?.focus_window;
            const isFs = fw ? fw.is_fullscreen() : false;
            this._isTopFullscreen = isFs;
            this._lastTopWindow = fw;
            return isFs;
        } catch (_) {
            this._isTopFullscreen = false;
            return false;
        }
    }

    isTopWindowFullscreen() {
        return this._isTopFullscreen;
    }

    getTopWindow() {
        return this._lastTopWindow;
    }

    _onWindowDamageOrChange(actor, reason) {
        this._globalDamageSeq++;
        if (!actor || actor._isDisposed) {
            this.invalidateAll(reason);
            return;
        }

        // Compute damaged region in stage coordinates
        let dx, dy, dw, dh;
        const bufRect = actor.get_buffer_rect?.();
        if (bufRect && bufRect.width > 0 && bufRect.height > 0) {
            dx = bufRect.x;
            dy = bufRect.y;
            dw = bufRect.width;
            dh = bufRect.height;
        } else {
            const [x, y] = actor.get_transformed_position?.() ?? [actor.x, actor.y];
            const [w, h] = actor.get_transformed_size?.() ?? [actor.width, actor.height];
            dx = x; dy = y; dw = w; dh = h;
        }

        if (!Number.isFinite(dx) || !Number.isFinite(dy) || !dw || !dh || dw <= 0 || dh <= 0) {
            this.invalidateAll(reason);
            return;
        }

        // Margin padding around window for shadow/glow
        const MARGIN = 40;
        this.invalidateRegion(dx - MARGIN, dy - MARGIN, dw + MARGIN * 2, dh + MARGIN * 2, reason);
    }

    registerElement(id, entry) {
        // entry: { actor, getRect: () => [x,y,w,h], onDirty: (reason) => void, isFullscreenAware }
        this._elements.set(id, entry);
    }

    unregisterElement(id) {
        this._elements.delete(id);
    }

    invalidateRegion(rx, ry, rw, rh, reason = 'damage') {
        for (const [id, el] of this._elements.entries()) {
            try {
                if (!el.actor || el.actor._isDisposed || !el.actor.visible) continue;
                const gRect = el.getRect ? el.getRect() : null;
                if (!gRect) {
                    el.onDirty?.(reason);
                    continue;
                }
                const [gx, gy, gw, gh] = gRect;
                if (rectsIntersect(rx, ry, rw, rh, gx, gy, gw, gh)) {
                    el.onDirty?.(reason);
                }
            } catch (err) {
                console.warn(`[SharedGlassEngine] Invalidate error for ${id}: ${err}`);
            }
        }
    }

    invalidateAll(reason = 'global') {
        for (const [id, el] of this._elements.entries()) {
            try {
                if (el.actor && !el.actor._isDisposed && el.actor.visible) {
                    el.onDirty?.(reason);
                }
            } catch (_) {}
        }
    }

    destroy() {
        for (const { obj, id } of this._signalIds) {
            try {
                if (obj && typeof obj.disconnect === 'function') obj.disconnect(id);
            } catch (_) {}
        }
        this._signalIds = [];
        this._elements.clear();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ADAPTIVE RENDER SCHEDULER (IDLE, INTERACTION, ANIMATION, HIGH_LOAD)
// ─────────────────────────────────────────────────────────────────────────────
class AdaptiveRenderScheduler {
    constructor() {
        this._mode = 'IDLE'; // 'IDLE' | 'INTERACTION' | 'ANIMATION' | 'HIGH_LOAD'
        this._interactionUntilUs = 0;
        this._highLoadUntilUs = 0;
        this._pendingTasks = new Map(); // id -> callback
        this._frameLaterId = 0;
        this._lastFrameTimeMs = 0;
        this._frameTimeSamples = [];
        this._downscaleFactor = 1.0;
    }

    setMode(mode) {
        this._mode = mode;
    }

    getMode() {
        const nowUs = GLib.get_monotonic_time();
        if (nowUs < this._highLoadUntilUs) return 'HIGH_LOAD';
        if (nowUs < this._interactionUntilUs) return 'INTERACTION';
        return this._mode;
    }

    notifyInteraction(durationMs = 350) {
        this._interactionUntilUs = GLib.get_monotonic_time() + durationMs * 1000;
        if (this._mode !== 'HIGH_LOAD') {
            this._mode = 'INTERACTION';
        }
    }

    reportFrameTime(durationMs) {
        this._lastFrameTimeMs = durationMs;
        this._frameTimeSamples.push(durationMs);
        if (this._frameTimeSamples.length > 30) this._frameTimeSamples.shift();

        // Adaptive High Load Trigger
        if (durationMs > HIGH_LOAD_THRESHOLD_MS) {
            this._highLoadUntilUs = GLib.get_monotonic_time() + 1500 * 1000; // 1.5s recovery window
            this._mode = 'HIGH_LOAD';
            this._downscaleFactor = 0.5; // Reduce resolution under high load
        } else if (GLib.get_monotonic_time() > this._highLoadUntilUs && this._downscaleFactor < 1.0) {
            this._downscaleFactor = 1.0;
            if (this._mode === 'HIGH_LOAD') this._mode = 'IDLE';
        }
    }

    getDownscaleFactor() {
        return this._downscaleFactor;
    }

    getAverageFrameTime() {
        if (this._frameTimeSamples.length === 0) return 0;
        const sum = this._frameTimeSamples.reduce((a, b) => a + b, 0);
        return sum / this._frameTimeSamples.length;
    }

    scheduleRender(id, fn) {
        this._pendingTasks.set(id, fn);
        if (this._frameLaterId !== 0) return;

        this._frameLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._frameLaterId = 0;
            const startUs = GLib.get_monotonic_time();
            const tasks = [...this._pendingTasks.values()];
            this._pendingTasks.clear();

            for (const task of tasks) {
                try {
                    task();
                } catch (e) {
                    console.error(`[SharedGlassEngine] Render task failed: ${e}`);
                }
            }

            const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;
            this.reportFrameTime(elapsedMs);
            return GLib.SOURCE_REMOVE;
        });
    }

    cancelRender(id) {
        this._pendingTasks.delete(id);
    }

    destroy() {
        if (this._frameLaterId !== 0) {
            try {
                global.compositor.get_laters().remove(this._frameLaterId);
            } catch (_) {}
            this._frameLaterId = 0;
        }
        this._pendingTasks.clear();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DIAGNOSTICS & PERFORMANCE METRICS
// ─────────────────────────────────────────────────────────────────────────────
class LiquidGlassDiagnostics {
    constructor() {
        this._enabled = false;
        this._frameCount = 0;
        this._fps = 0;
        this._lastFpsTimestamp = GLib.get_monotonic_time();
        this._blurDurationSumMs = 0;
        this._blurCount = 0;
        this._cacheHits = 0;
        this._cacheMisses = 0;
        this._skippedPaints = 0;
        this._dirtyPaints = 0;
        this._droppedFrames16 = 0;
        this._droppedFrames33 = 0;
        this._droppedFrames50 = 0;
    }

    enable() {
        this._enabled = true;
        this.reset();
        console.log('[SharedGlassEngine] Diagnostics enabled.');
    }

    disable() {
        this._enabled = false;
    }

    isEnabled() {
        return this._enabled;
    }

    recordPaint({ isBlur, durationMs, cacheHit, isDirty, skipped }) {
        if (!this._enabled) return;
        this._frameCount++;

        if (isBlur) {
            this._blurDurationSumMs += durationMs;
            this._blurCount++;
        }

        if (cacheHit) this._cacheHits++;
        else this._cacheMisses++;

        if (skipped) this._skippedPaints++;
        if (isDirty) this._dirtyPaints++;

        if (durationMs > 50.0) this._droppedFrames50++;
        else if (durationMs > 33.33) this._droppedFrames33++;
        else if (durationMs > 16.67) this._droppedFrames16++;

        const now = GLib.get_monotonic_time();
        const elapsedSec = (now - this._lastFpsTimestamp) / 1000000;
        if (elapsedSec >= 1.0) {
            this._fps = Math.round(this._frameCount / elapsedSec);
            this._frameCount = 0;
            this._lastFpsTimestamp = now;
        }
    }

    reset() {
        this._frameCount = 0;
        this._fps = 0;
        this._lastFpsTimestamp = GLib.get_monotonic_time();
        this._blurDurationSumMs = 0;
        this._blurCount = 0;
        this._cacheHits = 0;
        this._cacheMisses = 0;
        this._skippedPaints = 0;
        this._dirtyPaints = 0;
        this._droppedFrames16 = 0;
        this._droppedFrames33 = 0;
        this._droppedFrames50 = 0;
    }

    getMetrics() {
        const avgBlurMs = this._blurCount > 0 ? (this._blurDurationSumMs / this._blurCount).toFixed(2) : '0.00';
        const hitRatio = (this._cacheHits + this._cacheMisses) > 0
            ? ((this._cacheHits / (this._cacheHits + this._cacheMisses)) * 100).toFixed(1) + '%'
            : '100%';

        return {
            fps: this._fps,
            avgBlurMs: parseFloat(avgBlurMs),
            cacheHitRatio: hitRatio,
            cacheHits: this._cacheHits,
            cacheMisses: this._cacheMisses,
            dirtyRedraws: this._dirtyPaints,
            dirtyPaints: this._dirtyPaints,
            blurCount: this._blurCount,
            skippedRedraws: this._skippedPaints,
            skippedPaints: this._skippedPaints,
            droppedFramesOver16ms: this._droppedFrames16,
            droppedFramesOver33ms: this._droppedFrames33,
            droppedFramesOver50ms: this._droppedFrames50
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SHARED GLASS RENDER ENGINE (SINGLETON)
// ─────────────────────────────────────────────────────────────────────────────
export class SharedGlassRenderEngine {
    constructor() {
        this.pipelines = new SharedPipelinePool();
        this.textures = new SharedTexturePool();
        this.damageTracker = new BackgroundDamageTracker();
        this.scheduler = new AdaptiveRenderScheduler();
        this.diagnostics = new LiquidGlassDiagnostics();
        this._initialized = false;
        this._extensionPath = null;
    }

    init({ extensionPath, settings, logger } = {}) {
        if (this._initialized) return;
        this._initialized = true;
        this._extensionPath = extensionPath || GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local',
            'share',
            'gnome-shell',
            'extensions',
            'liquid-glass@thinkingcoding1231.gmail.com'
        ]);

        this.pipelines.init(this._extensionPath);
        this.damageTracker.init();

        // Warmup pipelines safely
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this.pipelines.warmup();
            return GLib.SOURCE_REMOVE;
        });

        console.log('[SharedGlassEngine] Initialized successfully.');
    }

    destroy() {
        this.damageTracker.destroy();
        this.scheduler.destroy();
        this.textures.clear();
        this.pipelines.clear();
        this._initialized = false;
    }
}

// Register singleton on globalThis
if (!globalThis._macSharedGlassEngine) {
    globalThis._macSharedGlassEngine = new SharedGlassRenderEngine();
}

export function getSharedGlassEngine() {
    if (!globalThis._macSharedGlassEngine) {
        globalThis._macSharedGlassEngine = new SharedGlassRenderEngine();
    }
    return globalThis._macSharedGlassEngine;
}
