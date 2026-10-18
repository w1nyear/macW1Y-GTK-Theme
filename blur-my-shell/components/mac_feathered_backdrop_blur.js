import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let BlurModule = null;
try {
    BlurModule = globalThis.imports?.gi?.Blur;
} catch (_) {}

const FRAGMENT_SHADER_SOURCE = `
    uniform sampler2D cogl_sampler;
    uniform float u_fade_width;
    uniform float u_width;
    uniform float u_height;
    uniform float u_corner_radius;

    void main() {
        vec2 st = cogl_tex_coord_in[0].st;
        vec2 p = vec2(st.x * u_width, st.y * u_height);
        
        vec2 c = vec2(u_fade_width + u_corner_radius, u_height - u_fade_width - u_corner_radius);
        
        float d;
        if (p.x < c.x && p.y > c.y) {
            float dist = length(p - c);
            d = u_corner_radius - dist;
        } else if (p.x < u_fade_width) {
            d = p.x - u_fade_width;
        } else if (p.y > u_height - u_fade_width) {
            d = (u_height - u_fade_width) - p.y;
        } else {
            d = min(p.x - u_fade_width, (u_height - u_fade_width) - p.y);
        }
        
        float a = 1.0;
        if (d < 0.0) {
            if (d <= -u_fade_width) {
                a = 0.0;
            } else {
                float t = clamp((d + u_fade_width) / max(u_fade_width, 1.0), 0.0, 1.0);
                a = smoothstep(0.0, 1.0, t);
            }
        }
        
        vec4 col = texture2D(cogl_sampler, st);
        cogl_color_out = col * a * cogl_color_in.a;
    }
`;

export class MacFeatheredBackdropBlur {
    constructor(name = 'mac-feathered-backdrop-blur') {
        this.name = name;
        this.padOrange = 20.0;
        this.fadeWidth = 70.0;
        this.cornerRadius = 26.0;
        this.blurRadius = 10; // Exactly 10px backdrop blur as requested

        this.actor = new St.Widget({
            name: this.name,
            reactive: false,
            can_focus: false,
            visible: false,
            opacity: 0,
            style: 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;',
        });

        // Background blur effect
        if (BlurModule?.BlurEffect) {
            this._blurEffect = new BlurModule.BlurEffect({
                mode: BlurModule.BlurMode?.BACKGROUND ?? 1,
                radius: this.blurRadius,
            });
        } else {
            this._blurEffect = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius: this.blurRadius,
            });
        }
        this.actor.add_effect(this._blurEffect);

        // Alpha feathering shader
        this._shader = new Clutter.ShaderEffect();
        this._shader.set_shader_source(FRAGMENT_SHADER_SOURCE);
        this.actor.add_effect(this._shader);

        this._lastW = 0;
        this._lastH = 0;
    }

    updateGeometry(contentX, contentY, contentW, contentH) {
        if (!this.actor || this.actor.is_finalized?.()) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const x = Math.round(contentX - this.padOrange - this.fadeWidth);
        const y = Math.round(monitor.y + 32);
        const rightEdge = monitor.x + monitor.width;
        const w = Math.max(10, Math.round(rightEdge - x));
        const bottomEdge = contentY + contentH + this.padOrange + this.fadeWidth;
        const h = Math.max(10, Math.round(bottomEdge - y));

        this.actor.set_position(x, y);
        this.actor.set_size(w, h);

        if (this._lastW !== w || this._lastH !== h) {
            this._lastW = w;
            this._lastH = h;
            this._shader.set_uniform_value('u_fade_width', this.fadeWidth);
            this._shader.set_uniform_value('u_width', w);
            this._shader.set_uniform_value('u_height', h);
            this._shader.set_uniform_value('u_corner_radius', this.cornerRadius);
        }
    }

    show() {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.actor.visible = true;
        this.actor.show();
    }

    hide() {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.actor.remove_all_transitions();
        this.actor.visible = false;
        this.actor.hide();
        this.actor.opacity = 0;
        this.actor.translation_x = 0;
    }

    animateSlideIn(fromX = 220, duration = 240) {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.show();
        this.actor.remove_all_transitions();
        this.actor.translation_x = fromX;
        this.actor.opacity = 0;
        this.actor.ease({
            translation_x: 0,
            opacity: 255,
            duration: duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    animateSlideOut(toX = 220, duration = 200, onComplete = null) {
        if (!this.actor || this.actor.is_finalized?.()) {
            onComplete?.();
            return;
        }
        this.actor.remove_all_transitions();
        this.actor.ease({
            translation_x: toX,
            opacity: 0,
            duration: duration,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                this.hide();
                onComplete?.();
            },
        });
    }

    destroy() {
        if (this.actor && !this.actor.is_finalized?.()) {
            this.actor.remove_all_transitions();
            if (this.actor.get_parent()) {
                this.actor.get_parent().remove_child(this.actor);
            }
            this.actor.destroy();
        }
        this.actor = null;
        this._blurEffect = null;
        this._shader = null;
    }
}
