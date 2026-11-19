// SPDX-License-Identifier: GPL-3.0-or-later



import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IDLE_CLEANUP_TTL_MS = 60000;

class MacAnimationCacheEngine {
    constructor() {
        this._resources = new Map();
        this._pipelines = new Map();
        this._prewarmed = new Set();
        this._maxBytes = CACHE_MAX_BYTES;
        this._schedulerState = 'IDLE';
        this._cachedBytes = 0;

        this._stats = {
            overviewOpenCount: 0,
            overviewTotalTimeMs: 0,
            overviewAvgOpenMs: 0,
            spotlightOpenCount: 0,
            spotlightTotalTimeMs: 0,
            spotlightAvgOpenMs: 0,
            cacheHits: 0,
            cacheMisses: 0,
            cachedResourcesCount: 0,
            activeAnimations: 0,
            activeTimers: 0,
            lastFrameTimeMs: null,
            targetFrameTimeMs: null,
            frameSampleCount: 0,
            estimatedDroppedFrames: 0,
            hitchCount: 0,
            freezeCount: 0,
            maxFrameGapMs: 0,
            invalidationReasons: [],
            schedulerState: 'IDLE',
        };

        this._signals = [];
        this._cleanupTimerId = 0;
        this._frameSignalId = 0;
        this._lastFrameTimestamp = 0;
        this._activeUiCapture = null;
        this._recentUiCaptures = [];
        this._uiCaptureStats = new Map();

        this._initSignalListeners();
        this._startIdleCleanupTimer();
        this._startFrameTimingTracker();
    }

    _initSignalListeners() {
        try {
            if (Main.layoutManager) {
                const monId = Main.layoutManager.connect('monitors-changed', () => {
                    this.invalidate('monitors-changed');
                });
                this._signals.push([Main.layoutManager, monId]);
            }
            if (global.display) {
                const waId = global.display.connect('workareas-changed', () => {
                    this.invalidate('workareas-changed');
                });
                this._signals.push([global.display, waId]);
            }

            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                const themeId = themeContext.connect('changed', () => {
                    this.invalidate('theme-changed');
                });
                this._signals.push([themeContext, themeId]);
            }
        } catch (e) {
            console.warn('[MacAnimationCache] Signal listener setup warning:', e);
        }
    }

    _startIdleCleanupTimer() {
        if (this._cleanupTimerId) {
            GLib.source_remove(this._cleanupTimerId);
        }
        this._cleanupTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30, () => {
            this._evictExpiredResources();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _startFrameTimingTracker() {
        if (this._frameSignalId || !global.stage?.connect)
            return;

        this._frameSignalId = global.stage.connect('after-paint', (_stage, view) => {
            const capture = this._activeUiCapture;
            if (!capture)
                return;

            const now = GLib.get_monotonic_time();
            if (now >= capture.deadlineUs) {
                this._finishUiCapture(capture);
                return;
            }

            const refreshRate = Number(view?.get_refresh_rate?.()) || 60;
            const targetMs = 1000 / refreshRate;
            const intervalMs = (now - capture.lastPaintUs) / 1000;
            capture.lastPaintUs = now;
            capture.frameCount++;

            if (capture.firstPaintLatencyMs === null) {
                capture.firstPaintLatencyMs = intervalMs;
            } else if (intervalMs > 0) {
                capture.frameIntervalsMs.push(intervalMs);
                if (capture.frameIntervalsMs.length > 240)
                    capture.frameIntervalsMs.shift();

                this._stats.frameSampleCount++;
                this._stats.lastFrameTimeMs = Math.round(intervalMs * 10) / 10;
                this._stats.targetFrameTimeMs = Math.round(targetMs * 10) / 10;
                this._stats.maxFrameGapMs = Math.max(this._stats.maxFrameGapMs, intervalMs);
                capture.maxFrameGapMs = Math.max(capture.maxFrameGapMs, intervalMs);

                if (intervalMs >= targetMs * 1.5) {
                    const missed = Math.max(1, Math.round(intervalMs / targetMs) - 1);
                    this._stats.estimatedDroppedFrames += missed;
                    capture.estimatedDroppedFrames += missed;
                }
                if (intervalMs >= 50) {
                    this._stats.hitchCount++;
                    capture.hitchCount++;
                }
                if (intervalMs >= 100) {
                    this._stats.freezeCount++;
                    capture.freezeCount++;
                }
            }
        });

        try {
            if (Main.overview) {
                for (const signal of ['showing', 'hiding']) {
                    const id = Main.overview.connect(signal, () => this.beginUiCapture(`overview-${signal}`));
                    this._signals.push([Main.overview, id]);
                }
            }
            const menus = [
                ['control-center', Main.panel?.statusArea?.quickSettings?.menu],
                ['notification-center', Main.panel?.statusArea?.dateMenu?.menu],
            ];
            for (const [name, menu] of menus) {
                if (!menu?.connect)
                    continue;
                const id = menu.connect('open-state-changed', (_menu, isOpen) => {
                    this.beginUiCapture(`${name}-${isOpen ? 'open' : 'close'}`);
                });
                this._signals.push([menu, id]);
            }
        } catch (e) {
            console.warn('[MacAnimationCache] UI capture signal setup warning:', e);
        }
    }

    beginUiCapture(component, durationMs = 1500) {
        if (this._activeUiCapture)
            this._finishUiCapture(this._activeUiCapture);

        const now = GLib.get_monotonic_time();
        this._activeUiCapture = {
            component: String(component || 'unspecified'),
            startedAtUs: now,
            deadlineUs: now + Math.max(100, Math.min(5000, Number(durationMs) || 1500)) * 1000,
            lastPaintUs: now,
            firstPaintLatencyMs: null,
            frameCount: 0,
            frameIntervalsMs: [],
            estimatedDroppedFrames: 0,
            hitchCount: 0,
            freezeCount: 0,
            maxFrameGapMs: 0,
        };
    }

    _finishUiCapture(capture) {
        if (!capture || this._activeUiCapture !== capture)
            return;

        const sortedIntervals = capture.frameIntervalsMs.slice().sort((a, b) => a - b);
        const p95Index = Math.max(0, Math.ceil(sortedIntervals.length * 0.95) - 1);

        const result = {
            component: capture.component,
            firstPaintLatencyMs: capture.firstPaintLatencyMs === null
                ? null : Math.round(capture.firstPaintLatencyMs * 10) / 10,
            frameCount: capture.frameCount,
            p95FrameGapMs: sortedIntervals.length
                ? Math.round(sortedIntervals[p95Index] * 10) / 10 : null,
            estimatedDroppedFrames: capture.estimatedDroppedFrames,
            hitchCount: capture.hitchCount,
            freezeCount: capture.freezeCount,
            maxFrameGapMs: Math.round(capture.maxFrameGapMs * 10) / 10,
        };
        const previous = this._uiCaptureStats.get(capture.component) || {
            samples: 0,
            firstPaintTotalMs: 0,
            firstPaintSamples: 0,
            firstPaintMaxMs: 0,
            estimatedDroppedFrames: 0,
            hitchCount: 0,
            freezeCount: 0,
            maxFrameGapMs: 0,
        };
        previous.samples++;
        if (result.firstPaintLatencyMs !== null) {
            previous.firstPaintTotalMs += result.firstPaintLatencyMs;
            previous.firstPaintSamples++;
            previous.firstPaintMaxMs = Math.max(previous.firstPaintMaxMs, result.firstPaintLatencyMs);
        }
        previous.estimatedDroppedFrames += result.estimatedDroppedFrames;
        previous.hitchCount += result.hitchCount;
        previous.freezeCount += result.freezeCount;
        previous.maxFrameGapMs = Math.max(previous.maxFrameGapMs, result.maxFrameGapMs);
        this._uiCaptureStats.set(capture.component, previous);
        this._recentUiCaptures.push(result);
        if (this._recentUiCaptures.length > 40)
            this._recentUiCaptures.shift();

        this._activeUiCapture = null;
        this._lastFrameTimestamp = 0;
    }

    setSchedulerState(state) {
        if (this._schedulerState === state) return;
        this._schedulerState = state;
        this._stats.schedulerState = state;


        try {
            const ext = Main.extensionManager?.lookup('liquid-glass@thinkingcoding1231.gmail.com');
            const sharedEngine = ext?.stateObj?.sharedEngine || globalThis.__macSharedGlassEngine;
            if (sharedEngine?.scheduler) {
                if (state === 'HIGH_LOAD') {
                    sharedEngine.scheduler.setState?.('HIGH_LOAD');
                } else if (state === 'ANIMATION') {
                    sharedEngine.scheduler.setState?.('ANIMATION');
                } else if (state === 'IDLE') {
                    sharedEngine.scheduler.setState?.('IDLE');
                }
            }
        } catch (_) {}
    }





    async prewarmAll() {
        this.setSchedulerState('PREWARMING');
        try {
            await this.prewarmOverview();
            await this.prewarmSpotlight();
            await this.prewarmQuickSettings();
            await this.prewarmOSD();
            await this.prewarmDock();
        } catch (e) {
            console.warn('[MacAnimationCache] Prewarm error:', e);
        } finally {
            this.setSchedulerState('IDLE');
        }
    }

    async prewarmOverview() {
        if (this._prewarmed.has('overview')) return;
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                try {

                    const bgGroup = Main.layoutManager.overviewGroup?.get_children()
                        ?.find(c => c.name === 'mac-overview-wallpaper-group');
                    if (bgGroup) {
                        bgGroup.opacity = 255;
                        bgGroup.visible = true;
                    }


                    if (typeof globalThis._macEnsurePersistentDingClones === 'function') {
                        globalThis._macEnsurePersistentDingClones();
                    }

                    this._prewarmed.add('overview');
                } catch (e) {
                    console.warn('[MacAnimationCache] prewarmOverview error:', e);
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async prewarmSpotlight() {
        if (this._prewarmed.has('spotlight')) return;
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                try {

                    if (typeof globalThis.ensureSearchDialog === 'function') {
                        const dlg = globalThis.ensureSearchDialog();
                        if (dlg && typeof dlg._initGlass === 'function' && !dlg._glass) {
                            dlg._initGlass().catch(() => {});
                        }
                    } else if (typeof globalThis._macSpotlightGlobalInstance?._initGlass === 'function') {
                        globalThis._macSpotlightGlobalInstance._initGlass().catch(() => {});
                    }
                    this._prewarmed.add('spotlight');
                } catch (e) {
                    console.warn('[MacAnimationCache] prewarmSpotlight error:', e);
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async prewarmQuickSettings() {
        if (this._prewarmed.has('quicksettings')) return;
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                try {

                    const kiwi = Main.extensionManager?.lookup('kiwi@kemma')?.stateObj;
                    if (kiwi?._quickSettings) {
                        kiwi._quickSettings._ensurePrewarmed?.();
                    }
                    this._prewarmed.add('quicksettings');
                } catch (e) {
                    console.warn('[MacAnimationCache] prewarmQuickSettings error:', e);
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async prewarmOSD() {
        if (this._prewarmed.has('osd')) return;
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                try {
                    const kiwi = Main.extensionManager?.lookup('kiwi@kemma')?.stateObj;
                    if (kiwi?._osd) {
                        kiwi._osd._ensurePrewarmed?.();
                    }
                    this._prewarmed.add('osd');
                } catch (e) {
                    console.warn('[MacAnimationCache] prewarmOSD error:', e);
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    async prewarmDock() {
        if (this._prewarmed.has('dock')) return;
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                try {

                    const d2d = Main.extensionManager?.lookup('dash2dock-motion@unmade.space')?.stateObj;
                    if (d2d?._dock) {
                        d2d._dock._ensurePrewarmed?.();
                    }
                    this._prewarmed.add('dock');
                } catch (e) {
                    console.warn('[MacAnimationCache] prewarmDock error:', e);
                }
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }





    get(key) {
        const entry = this._resources.get(key);
        if (entry) {
            entry.lastUsed = GLib.get_monotonic_time();
            this._stats.cacheHits++;
            return entry.resource;
        }
        this._stats.cacheMisses++;
        return null;
    }

    set(key, resource, sizeBytes = 1024, ttlMs = IDLE_CLEANUP_TTL_MS) {
        if (this._resources.has(key)) {
            const old = this._resources.get(key);
            this._cachedBytes -= old.sizeBytes;
        }


        while (this._cachedBytes + sizeBytes > this._maxBytes && this._resources.size > 0) {
            this._evictOldest();
        }

        this._resources.set(key, {
            resource,
            lastUsed: GLib.get_monotonic_time(),
            ttlMs,
            sizeBytes,
        });
        this._cachedBytes += sizeBytes;
        this._stats.cachedResourcesCount = this._resources.size;
        this._stats.cachedBytes = this._cachedBytes;
    }

    has(key) {
        return this._resources.has(key);
    }

    remove(key) {
        if (!this._resources.has(key)) return;
        const entry = this._resources.get(key);
        this._cachedBytes -= entry.sizeBytes;
        try {
            if (entry.resource?.destroy && !entry.resource.is_destroyed?.()) {
                entry.resource.destroy();
            }
        } catch (_) {}
        this._resources.delete(key);
        this._stats.cachedResourcesCount = this._resources.size;
        this._stats.cachedBytes = this._cachedBytes;
    }

    _evictOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [key, entry] of this._resources.entries()) {
            if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.remove(oldestKey);
        }
    }

    _evictExpiredResources() {
        const now = GLib.get_monotonic_time();
        const expiredKeys = [];
        for (const [key, entry] of this._resources.entries()) {
            if (entry.ttlMs > 0 && (now - entry.lastUsed) / 1000 > entry.ttlMs) {
                expiredKeys.push(key);
            }
        }
        for (const key of expiredKeys) {
            this.remove(key);
        }
    }

    invalidate(reason = 'unknown') {
        const timestamp = new Date().toISOString();
        this._stats.invalidationReasons.push({ reason, timestamp });
        if (this._stats.invalidationReasons.length > 20) {
            this._stats.invalidationReasons.shift();
        }


        const keysToRemove = [];
        for (const [key, entry] of this._resources.entries()) {
            if (!key.startsWith('static:')) {
                keysToRemove.push(key);
            }
        }
        for (const key of keysToRemove) {
            this.remove(key);
        }

        this._prewarmed.clear();


        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this.prewarmAll();
            return GLib.SOURCE_REMOVE;
        });
    }





    recordOverviewOpen(durationMs) {
        this._stats.overviewOpenCount++;
        this._stats.overviewTotalTimeMs += durationMs;
        this._stats.overviewAvgOpenMs = Math.round(
            (this._stats.overviewTotalTimeMs / this._stats.overviewOpenCount) * 10
        ) / 10;
    }

    recordSpotlightOpen(durationMs) {
        this._stats.spotlightOpenCount++;
        this._stats.spotlightTotalTimeMs += durationMs;
        this._stats.spotlightAvgOpenMs = Math.round(
            (this._stats.spotlightTotalTimeMs / this._stats.spotlightOpenCount) * 10
        ) / 10;
    }

    getDiagnostics() {
        if (this._activeUiCapture && GLib.get_monotonic_time() >= this._activeUiCapture.deadlineUs)
            this._finishUiCapture(this._activeUiCapture);

        let activeTimers = 0;
        let activeAnimations = 0;
        try {
            if (global.stage) {
                activeAnimations = global.stage.get_children?.()?.length || 0;
            }
        } catch (_) {}

        return {
            status: this._stats.freezeCount > 0 || this._stats.hitchCount > 0
                ? 'DEGRADED'
                : (this._stats.frameSampleCount > 0 ? 'MEASURED' : 'UNMEASURED'),
            schedulerState: this._schedulerState,
            overview: {
                openCount: this._stats.overviewOpenCount,
                avgOpenMs: this._stats.overviewAvgOpenMs,
            },
            spotlight: {
                openCount: this._stats.spotlightOpenCount,
                avgOpenMs: this._stats.spotlightAvgOpenMs,
            },
            cache: {
                items: this._resources.size,
                bytes: this._cachedBytes,
                maxBytes: this._maxBytes,
                hits: this._stats.cacheHits,
                misses: this._stats.cacheMisses,
                hitRatioPct: (this._stats.cacheHits + this._stats.cacheMisses) > 0
                    ? Math.round((this._stats.cacheHits / (this._stats.cacheHits + this._stats.cacheMisses)) * 100)
                    : 100,
            },
            performance: {
                lastFrameTimeMs: this._stats.lastFrameTimeMs,
                targetFrameTimeMs: this._stats.targetFrameTimeMs,
                fpsEstimate: this._stats.lastFrameTimeMs > 0
                    ? Math.round(1000.0 / this._stats.lastFrameTimeMs)
                    : null,
                frameSampleCount: this._stats.frameSampleCount,
                estimatedDroppedFrames: this._stats.estimatedDroppedFrames,
                hitchCount: this._stats.hitchCount,
                freezeCount: this._stats.freezeCount,
                maxFrameGapMs: Math.round(this._stats.maxFrameGapMs * 10) / 10,
                captureActive: !!this._activeUiCapture,
                components: Object.fromEntries([...this._uiCaptureStats].map(([name, stats]) => [name, {
                    ...stats,
                    averageFirstPaintMs: stats.firstPaintSamples
                        ? Math.round((stats.firstPaintTotalMs / stats.firstPaintSamples) * 10) / 10
                        : null,
                }])),
                recentCaptures: this._recentUiCaptures.slice(-10),
            },
            prewarmed: Array.from(this._prewarmed),
            invalidationReasons: this._stats.invalidationReasons.slice(-5),
        };
    }

    destroy() {
        if (this._cleanupTimerId) {
            GLib.source_remove(this._cleanupTimerId);
            this._cleanupTimerId = 0;
        }
        if (this._frameSignalId && global.stage) {
            try { global.stage.disconnect(this._frameSignalId); } catch (_) {}
            this._frameSignalId = 0;
        }
        this._activeUiCapture = null;
        this._uiCaptureStats.clear();
        this._recentUiCaptures = [];
        for (const [obj, id] of this._signals) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._signals = [];

        for (const [key] of this._resources) {
            this.remove(key);
        }
        this._resources.clear();
        this._prewarmed.clear();
    }
}

// Global Singleton Instance
if (!globalThis.__MacAnimationCache) {
    globalThis.__MacAnimationCache = new MacAnimationCacheEngine();
}

export const MacAnimationCache = globalThis.__MacAnimationCache;
export default MacAnimationCache;
