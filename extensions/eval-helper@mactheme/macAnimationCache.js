// SPDX-License-Identifier: GPL-3.0-or-later



import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IDLE_CLEANUP_TTL_MS = 60000;

class MacAnimationCacheEngine {
    constructor() {
        this._resources = new Map();
        this._pipelines = new Map();
        this._prewarmed = new Set();
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
            lastFrameTimeMs: 16.6,
            invalidationReasons: [],
            schedulerState: 'IDLE',
        };

        this._signals = [];
        this._cleanupTimerId = 0;
        this._frameClockId = 0;
        this._lastFrameTimestamp = 0;

        this._initSignalListeners();
        this._startIdleCleanupTimer();
        this._startFrameTimingTracker();
    }

    _initSignalListeners() {
        try {
            if (global.display) {
                const monId = global.display.connect('monitors-changed', () => {
                    this.invalidate('monitors-changed');
                });
                const waId = global.display.connect('workareas-changed', () => {
                    this.invalidate('workareas-changed');
                });
                this._signals.push([global.display, monId], [global.display, waId]);
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
        if (global.compositor?.get_laters) {
            this._frameClockId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW,
                () => {
                    const now = GLib.get_monotonic_time();
                    if (this._lastFrameTimestamp > 0) {
                        const deltaMs = (now - this._lastFrameTimestamp) / 1000.0;
                        if (deltaMs > 1.0 && deltaMs < 200.0) {
                            this._stats.lastFrameTimeMs = Math.round(deltaMs * 10) / 10;
                            if (deltaMs > 33.3 && this._schedulerState !== 'HIGH_LOAD') {
                                this.setSchedulerState('HIGH_LOAD');
                            } else if (deltaMs <= 18.0 && this._schedulerState === 'HIGH_LOAD') {
                                this.setSchedulerState('IDLE');
                            }
                        }
                    }
                    this._lastFrameTimestamp = now;
                    return true;
                }
            );
        }
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
        let activeTimers = 0;
        let activeAnimations = 0;
        try {
            if (global.stage) {
                activeAnimations = global.stage.get_children?.()?.length || 0;
            }
        } catch (_) {}

        return {
            status: 'HEALTHY',
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
                targetFrameTimeMs: 16.67,
                fpsEstimate: this._stats.lastFrameTimeMs > 0
                    ? Math.min(60, Math.round(1000.0 / this._stats.lastFrameTimeMs))
                    : 60,
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
        if (this._frameClockId && global.compositor?.get_laters) {
            global.compositor.get_laters().remove(this._frameClockId);
            this._frameClockId = 0;
        }
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
