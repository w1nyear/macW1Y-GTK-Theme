import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

const GRADIENT_BLUR_FADE_SHADER = `
    uniform sampler2D tex;
    uniform float width;
    uniform float height;
    uniform float fade_offset_top;
    uniform float fade_offset_bottom;
    uniform float fade_edges_top;
    uniform float fade_edges_bottom;

    void main() {
        vec2 uv = cogl_tex_coord_in[0].st;
        float y = uv.y * max(1.0, height);
        
        float t = 0.0;
        if (fade_edges_top > 0.5 && y < fade_offset_top && fade_offset_top > 0.0) {
            float dist_top = y;
            float p_top = clamp(1.0 - (dist_top / fade_offset_top), 0.0, 1.0);
            float curve_top = p_top * p_top * (3.0 - 2.0 * p_top);
            t = max(t, curve_top);
        }
        if (fade_edges_bottom > 0.5 && y > (height - fade_offset_bottom) && fade_offset_bottom > 0.0) {
            float dist_bottom = height - y;
            float p_bottom = clamp(1.0 - (dist_bottom / fade_offset_bottom), 0.0, 1.0);
            float curve_bottom = p_bottom * p_bottom * (3.0 - 2.0 * p_bottom);
            t = max(t, curve_bottom);
        }

        // Gradient blur: 0px at start (t=0.0), 3px at mid (t=0.5), 5px at end (t=1.0)
        float cur_blur = 0.0;
        if (t > 0.0) {
            if (t < 0.5) {
                cur_blur = mix(0.0, 3.0, t * 2.0);
            } else {
                cur_blur = mix(3.0, 5.0, (t - 0.5) * 2.0);
            }
        }

        vec4 col = texture2D(tex, uv);
        if (cur_blur > 0.1) {
            vec2 px_step = vec2(1.0 / max(1.0, width), 1.0 / max(1.0, height));
            float total_weight = 1.0;
            for (int i = 1; i <= 12; i++) {
                float fi = float(i);
                float r = sqrt(fi / 12.0);
                float theta = fi * 2.39996323;
                vec2 offset = vec2(cos(theta), sin(theta)) * (r * cur_blur) * px_step;
                vec2 sample_uv = clamp(uv + offset, vec2(0.0), vec2(1.0));
                float w = exp(-2.0 * r * r);
                col += texture2D(tex, sample_uv) * w;
                total_weight += w;
            }
            col /= total_weight;
        }

        // Alpha dissolve into underlying liquid glass
        col *= (1.0 - t);
        cogl_color_out = col;
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
