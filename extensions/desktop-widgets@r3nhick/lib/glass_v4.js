// Liquid-glass backdrop for GNOME Shell desktop widgets.
// Uses the macW1Y physical liquid-glass pipeline (LiquidEffect with glass.frag)
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

const GLASS_CLASS_KEY = '__DW_LiquidGlass_v6__';
if (!globalThis[GLASS_CLASS_KEY]) {
    globalThis[GLASS_CLASS_KEY] = GObject.registerClass(
        {
            GTypeName: 'DW_LiquidGlass_Actor_V6',
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
                    this._effect.setSurfaceLightEnabled(true);
                    this._effect.setShadowIntensity(0.0);
                    this._effect.setShadowMaxRadius(0.0);
                    this.add_effect(this._effect);

                    // A Clone does not reliably inherit its source size. It
                    // must cover the full wallpaper and be offset so the
                    // widget's clipped area samples the matching screen area.
                    this._syncWallpaper();

                } catch (err) {
                    console.warn('[desktop-widgets] Failed to initialize LiquidGlass pipeline:', err);
                }
            }

            _syncWallpaper() {
                const bgGroup = Main.layoutManager._backgroundGroup;
                if (this._wpClone && bgGroup) {
                    this._wpClone.set_size(bgGroup.width, bgGroup.height);
                    if (Number.isFinite(this._screenX) && Number.isFinite(this._screenY)) {
                        this._wpClone.set_position(-this._screenX, -this._screenY);
                    }
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

                this._syncWallpaper();

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

                this.visible = true;
                this.opacity = 255;

                if (this._effect) {
                    this._effect.setCornerRadius(radius);

                    const blur = typeof p.blurRadius === 'number' ? Math.max(0, p.blurRadius) : 0;
                    this._effect.setBlurRadius(blur);

                    // Normalize tint colors (0..1)
                    let r = 0.0, g = 0.0, b = 0.0;
                    if (p.tint) {
                        r = (typeof p.tint.r === 'number' && p.tint.r <= 1) ? p.tint.r : (p.tint.r / 255 || 0.0);
                        g = (typeof p.tint.g === 'number' && p.tint.g <= 1) ? p.tint.g : (p.tint.g / 255 || 0.0);
                        b = (typeof p.tint.b === 'number' && p.tint.b <= 1) ? p.tint.b : (p.tint.b / 255 || 0.0);
                    }
                    const tintAlpha = typeof p.tintAlpha === 'number' ? Math.max(0, Math.min(1.0, p.tintAlpha)) : 0.0;

                    this._effect.setTintColor(r, g, b);
                    this._effect.setTintStrength(tintAlpha);
                    this._effect.setSurfaceLightEnabled(true);

                    // Outer drop shadow is rendered with CSS box-shadow and border-radius on the wrapper actor.
                    // Keep shader shadow at 0.0 so glass.frag strictly respects corner rounding with zero square corner leakage.
                    this._effect.setShadowIntensity(0.0);
                    this._effect.setShadowMaxRadius(0.0);

                    this._effect.markBackdropDirty();
                    this.queue_redraw();
                }
            }

            setPointer(u, v, fade) {
                if (this._effect && typeof this._effect.setPointer === 'function') {
                    this._effect.setPointer(u, v, fade);
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
