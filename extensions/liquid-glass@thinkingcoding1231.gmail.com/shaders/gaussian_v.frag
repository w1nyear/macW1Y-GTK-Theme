
















uniform vec2 inv_size;
uniform float blur_radius;

const float GAUSSIAN_OFFSET_1 = 1.3846153846;
const float GAUSSIAN_OFFSET_2 = 3.2307692308;
const float GAUSSIAN_WEIGHT_0 = 0.2270270270;
const float GAUSSIAN_WEIGHT_1 = 0.3162162162;
const float GAUSSIAN_WEIGHT_2 = 0.0702702703;

void main() {
    vec2 uv = cogl_tex_coord_in[0].st;

    float o1 = GAUSSIAN_OFFSET_1 * blur_radius;
    float o2 = GAUSSIAN_OFFSET_2 * blur_radius;


    vec2 v1 = vec2(0.0, o1 * inv_size.y);
    vec2 v2 = vec2(0.0, o2 * inv_size.y);


    vec4 col = texture2D(cogl_sampler0, uv) * GAUSSIAN_WEIGHT_0;


    col += texture2D(cogl_sampler0, uv + v1) * GAUSSIAN_WEIGHT_1;
    col += texture2D(cogl_sampler0, uv - v1) * GAUSSIAN_WEIGHT_1;


    col += texture2D(cogl_sampler0, uv + v2) * GAUSSIAN_WEIGHT_2;
    col += texture2D(cogl_sampler0, uv - v2) * GAUSSIAN_WEIGHT_2;

    cogl_color_out = col;
}
