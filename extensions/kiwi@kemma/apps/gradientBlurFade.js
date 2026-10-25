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
            t = max(t, clamp(1.0 - (y / fade_offset_top), 0.0, 1.0));
        }
        if (fade_edges_bottom > 0.5 && y > (height - fade_offset_bottom) && fade_offset_bottom > 0.0) {
            float dist_bottom = height - y;
            t = max(t, clamp(1.0 - (dist_bottom / fade_offset_bottom), 0.0, 1.0));
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

export const GradientBlurFadeEffect = GObject.registerClass(
class KiwiGradientBlurFadeEffect extends Clutter.ShaderEffect {
    constructor(topOffset = 44.0, bottomOffset = 44.0) {
        super();
        this.set_shader_source(GRADIENT_BLUR_FADE_SHADER);
        this._topOffset = topOffset;
        this._bottomOffset = bottomOffset;
        this._fadeTop = false;
        this._fadeBottom = false;
        this._targetActor = null;
        this._adj = null;
    }

    attachTo(scrollView) {
        if (!scrollView) return;
        this._targetActor = scrollView;
        scrollView.add_effect(this);

        scrollView.connectObject('notify::allocation', () => this.updateBounds(), this);
        scrollView.connectObject('destroy', () => this.detach(), this);

        const adj = scrollView.vadjustment || (scrollView.get_vscroll_bar && scrollView.get_vscroll_bar().get_adjustment());
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
                    this.set_uniform_value('fade_edges_top', fadeTop ? 1.0 : 0.0);
                    this.set_uniform_value('fade_edges_bottom', fadeBottom ? 1.0 : 0.0);
                    this.queue_repaint();
                }
            };
            adj.connectObject('changed', onAdjChanged, 'notify::value', onAdjChanged, this);
            onAdjChanged();
        }
        this.updateBounds();
    }

    detach() {
        if (this._adj) {
            this._adj.disconnectObject(this);
            this._adj = null;
        }
        if (this._targetActor) {
            this._targetActor.disconnectObject(this);
            this._targetActor = null;
        }
    }

    updateBounds() {
        if (!this._targetActor) return;
        const [w, h] = this._targetActor.get_size();
        if (w > 0 && h > 0) {
            this.set_uniform_value('width', parseFloat(w));
            this.set_uniform_value('height', parseFloat(h));
            this.set_uniform_value('fade_offset_top', parseFloat(this._topOffset));
            this.set_uniform_value('fade_offset_bottom', parseFloat(this._bottomOffset));
            this.set_uniform_value('fade_edges_top', this._fadeTop ? 1.0 : 0.0);
            this.set_uniform_value('fade_edges_bottom', this._fadeBottom ? 1.0 : 0.0);
        }
    }
});

export function applyGradientBlurFade(scrollView, topOffset = 44.0, bottomOffset = 44.0) {
    if (!scrollView) return null;
    const effect = new GradientBlurFadeEffect(topOffset, bottomOffset);
    effect.attachTo(scrollView);
    return effect;
}
