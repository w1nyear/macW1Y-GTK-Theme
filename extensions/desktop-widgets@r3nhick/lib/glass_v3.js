// Liquid-glass backdrop for GNOME Shell desktop widgets.
// Uses the macOS Tahoe physical liquid-glass pipeline (LiquidEffect with glass.frag)
// powered by Dual Kawase blur, Snell refraction, chromatic dispersion, physical specular rim,
// ambient occlusion and wallpaper mirror.

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const BLUR_PAD = 48;
export const BLUR_RADIUS_SCALE = 3;
export const MAX_BLUR_RADIUS = 200;

export function effectFrame(x, y, width, height) {
    const axis = (start, size) => {
        const padded = Math.round(size) + 3;
        const paddedStart = Math.ceil(start + size + 0.75) - padded;
        return [(start - paddedStart) / padded, size / padded];
    };
    const [fx, fw] = axis(x, width);
    const [fy, fh] = axis(y, height);
    return [fx, fy, fw, fh];
}

const LG_EXT_DIR = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.local',
    'share',
    'gnome-shell',
    'extensions',
    'liquid-glass@thinkingcoding1231.gmail.com'
]);

let LiquidEffect = null;
let createBackgroundMirror = null;

try {
    const effMod = await import('file://' + LG_EXT_DIR + '/dist/liquidEffect.js');
    const utilMod = await import('file://' + LG_EXT_DIR + '/dist/utils.js');
    LiquidEffect = effMod?.LiquidEffect ?? null;
    createBackgroundMirror = utilMod?.createBackgroundMirror ?? null;
} catch (e) {
    console.warn('[desktop-widgets] Error importing LiquidEffect from liquid-glass:', e);
}

const GLASS_CLASS_KEY = '__DW_LiquidGlass_v5__';
if (!globalThis[GLASS_CLASS_KEY]) {
    globalThis[GLASS_CLASS_KEY] = GObject.registerClass(
        {
            GTypeName: 'DW_LiquidGlass_Actor_V5',
        },
        class LiquidGlass extends St.Widget {
            _init() {
                super._init({
                    clip_to_allocation: true,
                    style: 'background-color: transparent;',
                });

                this._screenX = 0;
                this._screenY = 0;
                this._width = 1;
                this._height = 1;
                this._radius = 16;
                this._params = null;

                this._wpClone = null;
                this._effect = null;

                this._initPipeline();

                Main.layoutManager.connectObject('monitors-changed', () => {
                    this._syncWallpaper();
                }, this);

                this.connect('destroy', () => {
                    this._cleanup();
                });
            }

            _initPipeline() {
                if (!LiquidEffect || !createBackgroundMirror) {
                    return;
                }

                try {
                    this._wpClone = createBackgroundMirror('dw-glass-wp-mirror');
                    this.add_child(this._wpClone);

                    let lgSettings = null;
                    try {
                        lgSettings = new Gio.Settings({
                            schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com',
                        });
                    } catch (_) {}

                    this._effect = new LiquidEffect({
                        extensionPath: LG_EXT_DIR,
                        settings: lgSettings,
                        owner: 'desktop-widget-glass',
                    });

                    this._effect.setPadding(0);
                    this._effect.setIsDock(false);
                    this._effect.setBrightness(1.0);
                    this._effect.setContrast(1.0);
                    this._effect.setSaturation(1.0);
                    this.add_effect(this._effect);
                } catch (err) {
                    console.warn('[desktop-widgets] Failed to initialize LiquidGlass pipeline:', err);
                }
            }

            _syncWallpaper() {
                if (this._wpClone && Number.isFinite(this._screenX) && Number.isFinite(this._screenY)) {
                    this._wpClone.set_position(-this._screenX, -this._screenY);
                }
                if (this._effect) {
                    this._effect.markBackdropDirty();
                    this.queue_redraw();
                }
            }

            setGeometry(x, y, width, height) {
                this._screenX = x;
                this._screenY = y;
                this._width = Math.max(1, width);
                this._height = Math.max(1, height);

                this.set_size(this._width, this._height);

                if (this._wpClone) {
                    this._wpClone.set_position(-x, -y);
                }

                if (this._effect) {
                    this._effect.setResolution(this._width, this._height);
                    this._effect.setGlassGeometry(0, 0, this._width, this._height);
                    this._effect.markBackdropDirty();
                    this.queue_redraw();
                }
            }

            setParams(p) {
                this._params = p;
                const radius = p.radius || 16;
                this._radius = radius;

                if (this._effect) {
                    this._effect.setCornerRadius(radius);
                    this._effect.setBlurRadius(Math.max(p.blurRadius || 20, 16));

                    // Normalize tint colors (0..1)
                    let r = 18 / 255, g = 22 / 255, b = 28 / 255;
                    if (p.tint) {
                        r = (typeof p.tint.r === 'number' && p.tint.r <= 1) ? p.tint.r : (p.tint.r / 255 || 0.07);
                        g = (typeof p.tint.g === 'number' && p.tint.g <= 1) ? p.tint.g : (p.tint.g / 255 || 0.09);
                        b = (typeof p.tint.b === 'number' && p.tint.b <= 1) ? p.tint.b : (p.tint.b / 255 || 0.11);
                    }
                    const strength = p.tintAlpha ?? 0.42;

                    this._effect.setTintColor(r, g, b);
                    this._effect.setTintStrength(strength);

                    const disp = Math.max(p.refractScale || 35.0, 30.0);
                    const ior = p.refractIOR || 1.50;
                    const chroma = p.chromaStrength || 0.35;
                    const spec = p.specStrength || 0.65;

                    this._effect._setFloat('displacement_scale', disp);
                    this._effect._setFloat('ior', ior);
                    this._effect._setFloat('chroma_strength', chroma);
                    this._effect._setFloat('rim_intensity', 0.85);
                    this._effect._setFloat('rim_width', 4.5);
                    this._effect._setFloat('rim_power', 4.0);
                    this._effect._setFloat('specular_intensity', spec);
                    this._effect._setFloat('sheen_intensity', 0.30);
                    this._effect._setFloat('ao_intensity', 0.30);
                    this._effect._setFloat('ao_radius', 8.0);
                    this._effect._setFloat('shadow_intensity', 0.35);
                    this._effect._setFloat('shadow_radius', 16.0);

                    this._effect.markBackdropDirty();
                    this.queue_redraw();
                }
            }

            setPointer(u, v, fade) {
                if (this._effect) {
                    this._effect.queue_repaint();
                }
            }

            _cleanup() {
                Main.layoutManager.disconnectObject(this);
                if (this._wpClone) {
                    try { this._wpClone.destroy(); } catch (_) {}
                    this._wpClone = null;
                }
                if (this._effect) {
                    try { this.remove_effect(this._effect); } catch (_) {}
                    this._effect = null;
                }
            }
        }
    );
}
const LiquidGlass = globalThis[GLASS_CLASS_KEY];

export { LiquidGlass };
