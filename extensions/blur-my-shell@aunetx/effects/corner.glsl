// Heavily based on https://github.com/yilozt/rounded-window-corners
// Enhanced with subpixel antialiasing and exact geometric continuity for macW1Y

uniform sampler2D tex;
uniform float radius;
uniform float width;
uniform float height;
uniform int corners_top;
uniform int corners_bottom;
uniform int straight_corners;

uniform float clip_x0;
uniform float clip_y0;
uniform float clip_width;
uniform float clip_height;

float circle_bounds(vec2 p, vec2 center, float clip_radius) {
    vec2 delta = p - center;
    float dist = length(delta);
    float d = dist - clip_radius;

    // Adaptive screen-space derivative antialiasing
    // Smoothstep creates a continuous C1 falloff over the subpixel boundary,
    // completely eliminating jagged staircasing ("драбини").
    float fw = max(fwidth(dist), 1.0);
    return 1.0 - smoothstep(-0.5 * fw, 0.5 * fw, d);
}

vec4 getTexture(vec2 uv) {
    return texture2D(tex, clamp(uv, 0.0, 1.0));
}

float rounded_rect_coverage(vec2 p, vec4 bounds, float clip_radius) {
    // Outside the bounds (with 1px threshold for antialiased boundary)
    if (p.x < bounds.x - 1.0 || p.x > bounds.z + 1.0 || p.y < bounds.y - 1.0 || p.y > bounds.w + 1.0) {
        return 0.0;
    }

    float center_left = bounds.x + clip_radius;
    float center_right = bounds.z - clip_radius;
    float center_top = bounds.y + clip_radius;
    float center_bottom = bounds.w - clip_radius;

    bool is_left = (p.x < center_left);
    bool is_right = (p.x > center_right);
    bool is_top = (corners_top != 0 && p.y < center_top);
    bool is_bottom = (corners_bottom != 0 && p.y > center_bottom);

    // If straight corners or in a non-corner edge region:
    if (straight_corners != 0 || (!is_left && !is_right) || (!is_top && !is_bottom)) {
        float d_left = p.x - bounds.x;
        float d_right = bounds.z - p.x;
        float d_top = p.y - bounds.y;
        float d_bottom = bounds.w - p.y;
        float min_d = min(min(d_left, d_right), min(d_top, d_bottom));
        float fw = max(fwidth(min_d), 1.0);
        return clamp(min_d / fw + 0.5, 0.0, 1.0);
    }

    vec2 center;
    center.x = is_left ? center_left : center_right;
    center.y = is_top ? center_top : center_bottom;

    return circle_bounds(p, center, clip_radius);
}

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec2 pos = uv * vec2(width, height);
    vec4 c = getTexture(uv);

    vec4 bounds;
    if (clip_width < 0. || clip_height < 0.) {
        bounds = vec4(clip_x0, clip_y0, clip_x0 + width, clip_y0 + height);
    } else {
        bounds = vec4(clip_x0, clip_y0, clip_x0 + clip_width, clip_y0 + clip_height);
    }

    float alpha = rounded_rect_coverage(pos, bounds, radius);

    cogl_color_out = vec4(c.rgb * alpha, c.a * alpha);
}
