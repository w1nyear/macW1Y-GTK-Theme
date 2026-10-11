uniform sampler2D tex;
uniform float top_darkness;
uniform float bottom_darkness;
uniform float top_blur;
uniform float bottom_blur;
uniform float width;
uniform float height;
uniform float clip_x0;
uniform float clip_y0;
uniform float clip_width;
uniform float clip_height;

void main() {
    vec2 uv = cogl_tex_coord_in[0].st;

    // Calculate current vertical position in actor space
    float pos_y = uv.y * max(1.0, height);

    // Calculate normalized vertical position t across the panel (0.0 = top, 1.0 = bottom)
    float t = 0.0;
    if (clip_height > 0.0) {
        t = clamp((pos_y - clip_y0) / clip_height, 0.0, 1.0);
    } else {
        t = clamp(pos_y / max(1.0, height), 0.0, 1.0);
    }

    // Interpolate darkness and blur
    float cur_dim = clamp(mix(top_darkness, bottom_darkness, t), 0.0, 1.0);
    float cur_blur = max(0.0, mix(top_blur, bottom_blur, t));

    vec4 col = vec4(0.0);

    if (cur_blur <= 0.5) {
        col = texture2D(tex, uv);
    } else {
        vec2 px_step = vec2(1.0 / max(1.0, width), 1.0 / max(1.0, height));
        col = texture2D(tex, uv);
        float total_weight = 1.0;

        // 16 sampling points on a Fibonacci spiral for smooth isotropic blur
        for (int i = 1; i <= 16; i++) {
            float fi = float(i);
            float r = sqrt(fi / 16.0);
            float theta = fi * 2.39996323;
            vec2 offset = vec2(cos(theta), sin(theta)) * (r * cur_blur) * px_step;
            vec2 sample_uv = clamp(uv + offset, vec2(0.0), vec2(1.0));

            float w = exp(-2.0 * r * r);
            col += texture2D(tex, sample_uv) * w;
            total_weight += w;
        }

        col /= total_weight;
    }

    // Blur layer blurs ONLY the wallpaper; gradient darkening is overlaid cleanly on top
    cogl_color_out = col;
}
