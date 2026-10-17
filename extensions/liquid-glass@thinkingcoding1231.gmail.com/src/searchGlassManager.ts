import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import { BackdropGlass } from './rendering/backdropGlass.js';
import { startStageLoop, stopStageLoop } from './animation/frameLoops.js';
import { isActorValid } from './actors/lifecycle.js';
import { hexToColorArray } from './animation/colors.js';
import { setClipIfChanged } from './actors/writes.js';
import type { Logger } from './logger.js';
import type Gio from 'gi://Gio';

const SHADER_PADDING = 20;

export class SearchGlassManager {
    private extensionPath: string;
    private _settings: Gio.Settings;
    private _logger: Logger;
    public glass: BackdropGlass | null = null;
    private _frameSignalId = 0;
    private _frameSyncId = 0;
    private _signals: number[] = [];
    private _overviewSignals: number[] = [];
    private _monitorsChangedId = 0;
    private _isActive = false;
    private _lastGeom = { x: null as number | null, y: null as number | null, w: null as number | null, h: null as number | null, opacity: null as number | null };

    constructor(extensionPath: string, settings: Gio.Settings, logger: Logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
    }

    setup() {
        this._createGlass();
        this._connectOverview();
    }

    private _createGlass() {
        if (this.glass) return;

        const glass = new BackdropGlass({
            extensionPath: this.extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: 'search-entry',
        } as any);
        glass.set_size(1.0, 1.0);
        glass.set_pivot_point(0.0, 0.0);
        glass.hide();

        const og = Main.layoutManager.overviewGroup;
        const ov = Main.overview._overview;
        if (og && ov) {
            og.insert_child_below(glass, ov);
        } else {
            Main.layoutManager.uiGroup.add_child(glass);
        }

        this.glass = glass;
        this._applyGlassParameters();
    }

    private _applyGlassParameters() {
        if (!this.glass) return;

        let tintColorStr = '#ffffff';
        let tintStrength = 0.12;
        let blurRadius = 16;
        let brightness = 1.0;
        let saturation = 1.4;
        let contrast = 1.0;

        if (this._settings) {
            try {
                if (this._settings.settings_schema?.has_key('menu-tint-color'))
                    tintColorStr = this._settings.get_string('menu-tint-color');
                if (this._settings.settings_schema?.has_key('menu-tint-strength'))
                    tintStrength = Math.min(0.25, this._settings.get_double('menu-tint-strength'));
                if (this._settings.settings_schema?.has_key('menu-blur-radius'))
                    blurRadius = this._settings.get_int('menu-blur-radius');
            } catch (e) {
                // use defaults
            }
        }

        this.glass.setPadding(SHADER_PADDING);
        this.glass.setTintColor(...hexToColorArray(tintColorStr));
        this.glass.setTintStrength(tintStrength);
        this.glass.setIsDock(false);
        this.glass.setBrightness(brightness);
        this.glass.setSaturation(saturation);
        this.glass.setContrast(contrast);
        this.glass.setBlurRadius(blurRadius);
    }

    private _connectOverview() {
        const ov = Main.overview;
        if (!ov) return;

        const onShow = () => {
            this._isActive = true;
            this._createGlass();
            this._startLoop();
            this._syncGeometry(true);
        };

        const onHide = () => {
            this._isActive = false;
            this._hideGlass();
            this._stopLoop();
        };

        this._overviewSignals.push(ov.connect('showing', onShow));
        this._overviewSignals.push(ov.connect('shown', onShow));
        this._overviewSignals.push(ov.connect('hiding', onHide));
        this._overviewSignals.push(ov.connect('hidden', onHide));

        const se = ov.searchEntry;
        if (se) {
            const onSeChange = () => {
                if (this._isActive) {
                    this._syncGeometry();
                }
            };
            this._signals.push(se.connect('notify::allocation', onSeChange));
            this._signals.push(se.connect('notify::opacity', onSeChange));
            this._signals.push(se.connect('notify::position', onSeChange));
            this._signals.push(se.connect('notify::visible', onSeChange));

            const bin = se.get_parent();
            if (bin) {
                this._signals.push(bin.connect('notify::translation-y', onSeChange));
                this._signals.push(bin.connect('notify::opacity', onSeChange));
            }
        }

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            if (this.glass && this._isActive) {
                this._syncGeometry(true);
            }
        });

        if (ov.visible || (ov as any)._visible) {
            onShow();
        }
    }

    private _startLoop() {
        if (this._frameSignalId) return;
        startStageLoop(this._frameSignalSlot, this._frameSlot, () => {
            if (this._isActive) {
                this._syncGeometry();
            } else {
                this._stopLoop();
            }
        });
    }

    private _stopLoop() {
        if (this._frameSignalId) {
            stopStageLoop(this._frameSignalSlot, this._frameSlot);
            this._frameSignalId = 0;
            this._frameSyncId = 0;
        }
    }

    private _hideGlass() {
        if (this.glass && this.glass.visible) {
            this.glass.hide();
        }
        this._stopLoop();
        this._lastGeom = { x: null, y: null, w: null, h: null, opacity: null };
    }

    private _syncGeometry(force = false) {
        if (!this.glass) return;
        const se = Main.overview.searchEntry;
        if (!se || !isActorValid(se)) {
            this._hideGlass();
            return;
        }

        const opacity = se.get_paint_opacity();
        if (!se.visible || opacity <= 0) {
            this._hideGlass();
            return;
        }

        let [w, h] = se.get_size();
        let box = se.get_allocation_box();
        let allocW = box.get_width();
        let allocH = box.get_height();
        if (allocW > 0 && allocH > 0) {
            w = allocW;
            h = allocH;
        }
        if (w <= 0 || h <= 0) {
            let [minW, natW] = se.get_preferred_width(-1);
            let [minH, natH] = se.get_preferred_height(natW);
            w = natW;
            h = natH;
        }
        if (w <= 0 || h <= 0) return;

        let [tx, ty] = se.get_transformed_position();
        if (tx === null || Number.isNaN(tx) || ty === null || Number.isNaN(ty)) {
            return;
        }

        let monitorIndex = Main.layoutManager.findIndexForActor(se);
        if (monitorIndex < 0) monitorIndex = Main.layoutManager.primaryIndex;
        let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
        let monitorX = monitor?.x ?? 0;
        let monitorY = monitor?.y ?? 0;
        let screenW = Math.max(1, monitor?.width ?? 1920);
        let screenH = Math.max(1, monitor?.height ?? 1080);

        let localBgX = tx - monitorX - SHADER_PADDING;
        let localBgY = ty - monitorY - SHADER_PADDING;
        let bgW = w + SHADER_PADDING * 2;
        let bgH = h + SHADER_PADDING * 2;

        const geomChanged = force ||
            this._lastGeom.x !== localBgX ||
            this._lastGeom.y !== localBgY ||
            this._lastGeom.w !== bgW ||
            this._lastGeom.h !== bgH ||
            this._lastGeom.opacity !== opacity;

        if (geomChanged) {
            this.glass.opacity = opacity;
            if (!this.glass.visible) {
                this.glass.show();
            }

            this.glass.set_position(monitorX, monitorY);
            this.glass.set_size(screenW, screenH);
            this.glass.setResolution(screenW, screenH);
            this.glass.setCornerRadius(h / 2.0); // Exact circular pill capsule
            this.glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);

            const CLIP_PADDING = 80;
            setClipIfChanged(
                this.glass,
                localBgX - CLIP_PADDING, localBgY - CLIP_PADDING,
                bgW + CLIP_PADDING * 2, bgH + CLIP_PADDING * 2
            );

            this._lastGeom = { x: localBgX, y: localBgY, w: bgW, h: bgH, opacity };
        }

        this.glass.syncSources();
    }

    private get _frameSlot() {
        return { get: () => this._frameSyncId, set: (id: number) => { this._frameSyncId = id; } };
    }

    private get _frameSignalSlot() {
        return { get: () => this._frameSignalId, set: (id: number) => { this._frameSignalId = id; } };
    }

    cleanup() {
        this._stopLoop();

        const ov = Main.overview;
        if (ov) {
            this._overviewSignals.forEach(id => {
                try { ov.disconnect(id); } catch (_) {}
            });
        }
        this._overviewSignals = [];

        for (const id of this._signals) {
            try {
                if (ov?.searchEntry) ov.searchEntry.disconnect(id);
            } catch (_) {}
        }
        this._signals = [];

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        if (this.glass) {
            this.glass.destroy();
            this.glass = null;
        }
    }
}
