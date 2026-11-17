


uniform vec2 inv_size;
uniform float blur_radius;


void main() {
    vec2 uv = cogl_tex_coord_in[0].st;
    float r = blur_radius;

    vec4 col  = texture2D(cogl_sampler0, uv) * 4.0;
    col += texture2D(cogl_sampler0, uv + vec2( r,  r) * inv_size);
    col += texture2D(cogl_sampler0, uv + vec2( r, -r) * inv_size);
    col += texture2D(cogl_sampler0, uv + vec2(-r,  r) * inv_size);
    col += texture2D(cogl_sampler0, uv + vec2(-r, -r) * inv_size);

    cogl_color_out = col / 8.0;
}
