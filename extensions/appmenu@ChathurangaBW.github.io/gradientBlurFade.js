import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

const GRADIENT_BLUR_FADE_SHADER = `
    uniform sampler2D tex;
    uniform float width;
    uniform float height;
    uniform float fade_offset_top;
    uniform float fade_offset_bottom;
    uniform float fade_edges_top;
    uniform float fade_edges_bottom;

    // 16-tap Vogel spiral offsets uniformly distributed inside a circle of radius 1.0
    // Eliminates multi-tap discrete echo rings and ghosting artifacts.
    const vec2 V_00 = vec2( 0.176777,  0.000000);
    const vec2 V_01 = vec2(-0.225772,  0.206826);
    const vec2 V_02 = vec2( 0.034558, -0.393771);
    const vec2 V_03 = vec2( 0.284571,  0.371173);
    const vec2 V_04 = vec2(-0.522223, -0.092374);
    const vec2 V_05 = vec2( 0.494695, -0.314685);
    const vec2 V_06 = vec2(-0.165466,  0.615525);
    const vec2 V_07 = vec2(-0.315561, -0.607594);
    const vec2 V_08 = vec2( 0.684642,  0.250030);
    const vec2 V_09 = vec2(-0.712256,  0.294009);
    const vec2 V_10 = vec2( 0.343354, -0.733729);
    const vec2 V_11 = vec2( 0.253730,  0.808932);
    const vec2 V_12 = vec2(-0.764746, -0.443186);
    const vec2 V_13 = vec2( 0.897134, -0.197232);
    const vec2 V_14 = vec2(-0.547507,  0.778772);
    const vec2 V_15 = vec2(-0.126487, -0.976090);

    void main() {
        vec2 uv = cogl_tex_coord_in[0].st;
        float y = uv.y * max(1.0, height);
        
        float t = 0.0;
        if (fade_edges_top > 0.5 && y < fade_offset_top && fade_offset_top > 0.0) {
            float dist_top = y;
            float p_top = clamp(1.0 - (dist_top / fade_offset_top), 0.0, 1.0);
            t = max(t, p_top);
        }
        if (fade_edges_bottom > 0.5 && y > (height - fade_offset_bottom) && fade_offset_bottom > 0.0) {
            float dist_bottom = height - y;
            float p_bottom = clamp(1.0 - (dist_bottom / fade_offset_bottom), 0.0, 1.0);
            t = max(t, p_bottom);
        }

        vec4 sharp = texture2D(tex, uv);
        if (t <= 0.001) {
            cogl_color_out = sharp;
            return;
        }

        // Dynamic progressive single-pass blur:
        // As content reaches the boundary (t: 0 -> 1), blur radius expands smoothly from 0 to 5.0px.
        // Bilinear texture filtering merges the tightly spaced 16 Vogel taps into a continuous optical blur
        // without discrete echo rings or ghost images.
        vec2 px_step = vec2(1.0 / max(1.0, width), 1.0 / max(1.0, height));
        vec2 blur_r = px_step * (t * 5.0);

        vec4 blurred = vec4(0.0);
        blurred += texture2D(tex, clamp(uv + V_00 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_01 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_02 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_03 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_04 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_05 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_06 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_07 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_08 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_09 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_10 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_11 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_12 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_13 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_14 * blur_r, vec2(0.0), vec2(1.0)));
        blurred += texture2D(tex, clamp(uv + V_15 * blur_r, vec2(0.0), vec2(1.0)));
        blurred *= 0.0625; // 1.0 / 16.0

        // Smooth opacity dissolve at the very edge (dissolves cleanly into the background)
        float alpha_fade = 1.0 - smoothstep(0.40, 1.0, t);
        cogl_color_out = blurred * clamp(alpha_fade, 0.0, 1.0);
    }
`;

function _setFloat(effect, name, val) {
    try {
        // GJS converts whole numbers to G_TYPE_INT which fails in Cogl against GLSL 'uniform float'.
        // Adding 0.0001 forces GJS to pass G_TYPE_DOUBLE / float.
        effect.set_uniform_value(name, parseFloat(val) + 0.0001);
    } catch (_) {}
}

let EffectClass = globalThis.__AppmenuGradientBlurFadeEffect;
if (!EffectClass) {
    EffectClass = GObject.registerClass(
    class AppmenuGradientBlurFadeEffect extends Clutter.ShaderEffect {
        constructor(topOffset = 48.0, bottomOffset = 76.0) {
            super();
            this.set_shader_source(GRADIENT_BLUR_FADE_SHADER);
            this._topOffset = topOffset;
            this._bottomOffset = bottomOffset;
            this._fadeTop = false;
            this._fadeBottom = false;
            this._targetActor = null;
            this._adj = null;
            this._updateAdj = null;
        }
    });
    globalThis.__AppmenuGradientBlurFadeEffect = EffectClass;
}

EffectClass.prototype.setOffsets = function(topOffset, bottomOffset) {
    if (topOffset !== undefined) this._topOffset = topOffset;
    if (bottomOffset !== undefined) this._bottomOffset = bottomOffset;
    this.updateBounds();
};

EffectClass.prototype.attachTo = function(actor, scrollView = null) {
    if (!actor) return;
    try {
        this.set_shader_source(GRADIENT_BLUR_FADE_SHADER);
    } catch (_) {}
    this._targetActor = actor;
    actor.add_effect(this);

    actor.connectObject('notify::allocation', () => this.updateBounds(), this);
    actor.connectObject('destroy', () => this.detach(), this);

    let sv = scrollView;
    if (!sv) {
        if (actor.vadjustment) {
            sv = actor;
        } else if (actor.get_children) {
            const findSv = (node) => {
                if (!node) return null;
                if (node.vadjustment) return node;
                if (node.get_children) {
                    for (const c of node.get_children()) {
                        const found = findSv(c);
                        if (found) return found;
                    }
                }
                return null;
            };
            sv = findSv(actor);
        }
    }

    const adj = sv ? (sv.vadjustment || (sv.get_vscroll_bar && sv.get_vscroll_bar().get_adjustment())) : null;
    if (adj) {
        this._adj = adj;
        const onAdjChanged = () => {
            const val = adj.value;
            const upper = adj.upper;
            const page = adj.page_size;
            const canScroll = upper > page + 1.0;

            const fadeTop = canScroll && val > 1.0;
            const fadeBottom = canScroll && val < (upper - page - 1.0);

            if (fadeTop !== this._fadeTop || fadeBottom !== this._fadeBottom) {
                this._fadeTop = fadeTop;
                this._fadeBottom = fadeBottom;
                _setFloat(this, 'fade_edges_top', fadeTop ? 1.0 : 0.0);
                _setFloat(this, 'fade_edges_bottom', fadeBottom ? 1.0 : 0.0);
                this.queue_repaint();
            }
        };
        this._updateAdj = onAdjChanged;
        adj.connectObject('changed', onAdjChanged, 'notify::value', onAdjChanged, 'notify::upper', onAdjChanged, 'notify::page-size', onAdjChanged, this);
        onAdjChanged();

        if (sv) {
            let targetValue = adj.value;
            let lastScrollTime = 0;
            sv.connectObject('scroll-event', (_actor, event) => {
                const direction = event.get_scroll_direction();
                let delta = 0;
                if (direction === Clutter.ScrollDirection.UP) delta = -1;
                else if (direction === Clutter.ScrollDirection.DOWN) delta = 1;
                else if (direction === Clutter.ScrollDirection.SMOOTH) {
                    const [dx, dy] = event.get_scroll_delta();
                    delta = dy;
                }
                if (delta === 0) return Clutter.EVENT_PROPAGATE;

                const lower = adj.lower;
                const upper = adj.upper;
                const pageSize = adj.page_size;
                const maxVal = Math.max(lower, upper - pageSize);
                if (maxVal <= lower) return Clutter.EVENT_PROPAGATE;

                const now = GLib.get_monotonic_time();
                if ((now - lastScrollTime) > 300000) {
                    targetValue = adj.value;
                }
                lastScrollTime = now;

                const step = Math.max(50, adj.step_increment || 60);
                targetValue = Math.clamp(targetValue + delta * step, lower, maxVal);

                adj.ease(targetValue, {
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });

                return Clutter.EVENT_STOP;
            }, this);
        }
    }
    this.updateBounds();
};

EffectClass.prototype.detach = function() {
    if (this._adj) {
        this._adj.disconnectObject(this);
        this._adj = null;
    }
    this._updateAdj = null;
    if (this._targetActor) {
        this._targetActor.disconnectObject(this);
        this._targetActor = null;
    }
};

EffectClass.prototype.updateBounds = function() {
    if (!this._targetActor) return;
    const [w, h] = this._targetActor.get_size();
    if (w > 0 && h > 0) {
        _setFloat(this, 'width', w);
        _setFloat(this, 'height', h);
        _setFloat(this, 'fade_offset_top', this._topOffset);
        _setFloat(this, 'fade_offset_bottom', this._bottomOffset);
        _setFloat(this, 'fade_edges_top', this._fadeTop ? 1.0 : 0.0);
        _setFloat(this, 'fade_edges_bottom', this._fadeBottom ? 1.0 : 0.0);
        this.queue_repaint();
    }
    if (this._updateAdj) {
        this._updateAdj();
    }
};

export const GradientBlurFadeEffect = EffectClass;

export function applyGradientBlurFade(actor, topOffset = 48.0, bottomOffset = 76.0, scrollView = null) {
    if (!actor) return null;
    let target = actor;
    let scroll = scrollView;

    if (!scroll && actor.vadjustment) {
        scroll = actor;
        if (actor.get_parent()) {
            target = actor.get_parent();
        }
    }
    const effect = new GradientBlurFadeEffect(topOffset, bottomOffset);
    effect.attachTo(target, scroll);
    return effect;
}
