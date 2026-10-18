import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import { BackdropGlass } from './rendering/backdropGlass.js';
import { startStageLoop, stopStageLoop } from './animation/frameLoops.js';
import { isActorValid } from './actors/lifecycle.js';
import { hexToColorArray } from './animation/colors.js';
import { setClipIfChanged } from './actors/writes.js';

const SHADER_PADDING = 20;

export class ScreenshotGlassManager {
    constructor(extensionPath, settings, logger) {
        this.extensionPath = extensionPath;
        this._settings = settings;
        this._logger = logger;
        this.glass = null;
        this._frameSignalId = 0;
        this._frameSyncId = 0;
        this._signals = [];
        this._uiSignals = [];
        this._monitorsChangedId = 0;
        this._isActive = false;
        this._lastGeom = { x: null, y: null, w: null, h: null, opacity: null };
    }

    setup() {
        this._connectScreenshotUI();
    }

    _createGlass() {
        if (this.glass) return;

        const glass = new BackdropGlass({
            extensionPath: this.extensionPath,
            settings: this._settings,
            logger: this._logger,
            owner: 'screenshot-ui-panel',
        });
        glass.set_size(1.0, 1.0);
        glass.set_pivot_point(0.0, 0.0);
        glass.hide();

        const ui = Main.screenshotUI;
        if (ui && ui._primaryMonitorBin) {
            ui.insert_child_below(glass, ui._primaryMonitorBin);
        } else if (ui) {
            ui.add_child(glass);
        } else {
            Main.layoutManager.uiGroup.add_child(glass);
        }

        this.glass = glass;
        this._applyGlassParameters();
    }

    _applyGlassParameters() {
        if (!this.glass) return;

        let tintColorStr = '#ffffff';
        let tintStrength = 0.12;
        let blurRadius = 24;
        let brightness = 1.0;
        let saturation = 1.3;
        let contrast = 1.0;

        if (this._settings) {
            try {
                if (this._settings.settings_schema.has_key('dock-tint-color'))
                    tintColorStr = this._settings.get_string('dock-tint-color');
                if (this._settings.settings_schema.has_key('dock-tint-strength'))
                    tintStrength = this._settings.get_double('dock-tint-strength');
                if (this._settings.settings_schema.has_key('dock-brightness'))
                    brightness = this._settings.get_double('dock-brightness');
                if (this._settings.settings_schema.has_key('dock-contrast'))
                    contrast = this._settings.get_double('dock-contrast');
                if (this._settings.settings_schema.has_key('dock-saturation'))
                    saturation = this._settings.get_double('dock-saturation');
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
        this.glass.setCornerRadius(28.0);
    }

    _connectScreenshotUI() {
        const ui = Main.screenshotUI;
        if (!ui) return;

        const onShow = () => {
            this._isActive = true;
            this._createGlass();
            this._startLoop();
            if (this.glass) {
                this.glass.forceRefresh(500);
            }
            this._syncGeometry(true);
        };

        const onHide = () => {
            this._isActive = false;
            this._hideGlass();
            this._stopLoop();
        };

        this._uiSignals.push(ui.connect('notify::visible', () => {
            if (ui.visible) onShow();
            else onHide();
        }));

        this._uiSignals.push(ui.connect('notify::opacity', () => {
            if (this._isActive) this._syncGeometry();
        }));

        const panel = ui._panel;
        if (panel) {
            const onPanelChange = () => {
                if (this._isActive) {
                    this._syncGeometry();
                }
            };
            this._signals.push(panel.connect('notify::allocation', onPanelChange));
            this._signals.push(panel.connect('notify::position', onPanelChange));
            this._signals.push(panel.connect('notify::size', onPanelChange));
        }

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            if (this.glass && this._isActive) {
                this._syncGeometry(true);
            }
        });

        if (ui.visible) {
            onShow();
        }
    }

    _startLoop() {
        if (this._frameSignalId) return;
        startStageLoop(this._frameSignalSlot, this._frameSlot, () => {
            if (this._isActive) {
                this._syncGeometry();
            } else {
                this._stopLoop();
            }
        });
    }

    _stopLoop() {
        if (this._frameSignalId) {
            stopStageLoop(this._frameSignalSlot, this._frameSlot);
            this._frameSignalId = 0;
            this._frameSyncId = 0;
        }
    }

    _hideGlass() {
        if (this.glass && this.glass.visible) {
            this.glass.hide();
        }
        this._stopLoop();
        this._lastGeom = { x: null, y: null, w: null, h: null, opacity: null };
    }

    _syncGeometry(force = false) {
        if (!this.glass) return;
        const ui = Main.screenshotUI;
        const panel = ui?._panel;
        if (!panel || !isActorValid(panel) || !panel.visible || !ui?.visible) {
            this._hideGlass();
            return;
        }

        const opacity = Math.min(ui.opacity, panel.get_paint_opacity());
        if (opacity <= 0) {
            this._hideGlass();
            return;
        }

        let [w, h] = panel.get_size();
        let box = panel.get_allocation_box();
        let allocW = box.get_width();
        let allocH = box.get_height();
        if (allocW > 0 && allocH > 0) {
            w = allocW;
            h = allocH;
        }
        if (w <= 0 || h <= 0) {
            let [minW, natW] = panel.get_preferred_width(-1);
            let [minH, natH] = panel.get_preferred_height(natW);
            w = natW;
            h = natH;
        }
        if (w <= 0 || h <= 0) return;

        let [tx, ty] = panel.get_transformed_position();
        if (tx === null || Number.isNaN(tx) || ty === null || Number.isNaN(ty)) {
            return;
        }

        let monitorIndex = Main.layoutManager.findIndexForActor(panel);
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
            this.glass.setCornerRadius(28.0);
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

    get _frameSlot() {
        return { get: () => this._frameSyncId, set: (id) => { this._frameSyncId = id; } };
    }

    get _frameSignalSlot() {
        return { get: () => this._frameSignalId, set: (id) => { this._frameSignalId = id; } };
    }

    cleanup() {
        this._stopLoop();

        const ui = Main.screenshotUI;
        if (ui) {
            this._uiSignals.forEach(id => {
                try { ui.disconnect(id); } catch (_) {}
            });
        }
        this._uiSignals = [];

        if (ui?._panel) {
            this._signals.forEach(id => {
                try { ui._panel.disconnect(id); } catch (_) {}
            });
        }
        this._signals = [];

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        if (this.glass) {
            this.glass.cleanup?.();
            this.glass.destroy();
            this.glass = null;
        }
        this._isActive = false;
    }
}
