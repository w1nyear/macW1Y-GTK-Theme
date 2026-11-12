// Heavily based on https://github.com/yilozt/rounded-window-corners
// Enhanced with exact branchless SDF and subpixel antialiasing for macW1Y

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

// Signed Distance Function for a 2D rounded rectangle
// Mathematically exact, branchless C1 continuity across both straight edges and corner arcs.
// Prevents GPU 2x2 fragment quad derivative divergence (fwidth) that causes horizontal slits.
float sdRoundRect(vec2 p, vec2 center, vec2 half_size, float r_top, float r_bottom) {
    vec2 local_p = p - center;
    float r = (local_p.y < 0.0) ? r_top : r_bottom;
    vec2 q = abs(local_p) - half_size + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

vec4 getTexture(vec2 uv) {
    return texture2D(tex, clamp(uv, 0.0, 1.0));
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

    vec2 half_size = vec2(bounds.z - bounds.x, bounds.w - bounds.y) * 0.5;
    vec2 center = vec2(bounds.x + bounds.z, bounds.y + bounds.w) * 0.5;

    // Safety clamp
    half_size = max(half_size, vec2(1.0));
    float max_r = min(half_size.x, half_size.y);
    float r_val = (straight_corners != 0) ? 0.0 : clamp(radius, 0.0, max_r);
    float r_top = (corners_top != 0) ? r_val : 0.0;
    float r_bottom = (corners_bottom != 0) ? r_val : 0.0;

    float dist = sdRoundRect(pos, center, half_size, r_top, r_bottom);

    // Adaptive subpixel antialiasing
    float fw = max(fwidth(dist), 1.0);
    float alpha = 1.0 - smoothstep(-0.5 * fw, 0.5 * fw, dist);

    cogl_color_out = vec4(c.rgb * alpha, c.a * alpha);
}
