#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <string.h>
#include <unistd.h>
#include <cairo/cairo.h>

#define CLAMP(x, l, u) ((x) < (l) ? (l) : ((x) > (u) ? (u) : (x)))
#define MAX_BENCHMARK_ELEMENTS 60
#define DEFAULT_BENCH_FPS_THRESHOLD 60.0
#define DEFAULT_DURATION 10.0

typedef struct {
    double x, y;
    double vx, vy;
    double w, h, r;
    int shape;
} BenchmarkElement;

static BenchmarkElement g_elements[MAX_BENCHMARK_ELEMENTS];
static uint32_t s_scratch_pixels[320 * 320];

static inline double get_time_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static inline double fast_sd_shape(double px, double py, double bx, double by, double r, int shape, double *out_nx, double *out_ny) {
    if (shape == 2) {
        r = fmin(bx, by);
    } else if (shape == 1) {
        double len = sqrt(px * px + py * py) + 1e-6;
        *out_nx = px / len;
        *out_ny = py / len;
        return len - fmin(bx, by);
    }
    double qx = fabs(px) - bx + r;
    double qy = fabs(py) - by + r;
    double max_qx = fmax(qx, 0.0);
    double max_qy = fmax(qy, 0.0);
    double out_len = sqrt(max_qx * max_qx + max_qy * max_qy);
    double in_dist = fmin(fmax(qx, qy), 0.0);
    double d = out_len + in_dist - r;
    if (out_len > 1e-5) {
        double inv = 1.0 / out_len;
        *out_nx = (px < 0.0 ? -max_qx : max_qx) * inv;
        *out_ny = (py < 0.0 ? -max_qy : max_qy) * inv;
    } else {
        *out_nx = (qx > qy) ? (px < 0.0 ? -1.0 : 1.0) : 0.0;
        *out_ny = (qx > qy) ? 0.0 : (py < 0.0 ? -1.0 : 1.0);
    }
    return d;
}

static inline double glsl_smoothstep(double edge0, double edge1, double x) {
    double t = CLAMP((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

typedef struct {
    double disp_factor;
    double sinA;
    double cosA;
    double insideMask;
    double rimEdge;
    double chromaDampen;
    double ao;
} DepthLUT;

static DepthLUT s_depth_lut[256];
static double s_last_ior = -1.0;
static double s_last_disp_scale = -1.0;
static double s_last_rim = -1.0;
static double s_last_bevel = -1.0;

static void build_depth_lut(double ior, double disp_scale, double rim_intensity, double bevel_width) {
    if (ior == s_last_ior && disp_scale == s_last_disp_scale && rim_intensity == s_last_rim && bevel_width == s_last_bevel)
        return;
    s_last_ior = ior;
    s_last_disp_scale = disp_scale;
    s_last_rim = rim_intensity;
    s_last_bevel = bevel_width;

    double eta = 1.0 / fmax(ior, 1.001);
    double edgeFeather = 1.8;

    for (int i = 0; i < 256; i++) {
        double depth = (double)i / 255.0;
        double d = -depth * bevel_width;

        double insideMask = 1.0 - glsl_smoothstep(-edgeFeather, edgeFeather, d);
        double u = 1.0 - depth;
        double slope = (u * u * u) * 0.85;
        double sinA = slope * (1.0 - slope * slope * 0.166667);
        double cosA = sqrt(fmax(1.0 - sinA * sinA, 0.0));

        double k = 1.0 - eta * eta * sinA * sinA;
        double factor = (k >= 0.0) ? (sqrt(k) - eta * cosA) : 0.0;
        double ray_x = factor * sinA;
        double ray_z = -eta - factor * cosA;
        double safe_z = fmax(-ray_z, 0.15);

        double edgeDampen = glsl_smoothstep(0.0, edgeFeather * 3.0, -d);
        double disp_factor = (ray_x / safe_z) * disp_scale * edgeDampen;

        double rimDot = 1.0 - cosA;
        double rimFresnel = rimDot * rimDot;
        double edgeBand = 1.0 - depth;
        double rimEdge = rimFresnel * (rim_intensity * 1.5) * edgeBand * 255.0;

        /* Ambient occlusion darkens ONLY within 8px of the outer frame edge, never the interior */
        double aoDist = depth * bevel_width;
        double aoMask = 1.0 - glsl_smoothstep(0.0, 8.0, aoDist);
        double ao = 1.0 - aoMask * 0.30;

        s_depth_lut[i].disp_factor = disp_factor;
        s_depth_lut[i].sinA = sinA;
        s_depth_lut[i].cosA = cosA;
        s_depth_lut[i].insideMask = insideMask;
        s_depth_lut[i].rimEdge = rimEdge;
        s_depth_lut[i].chromaDampen = edgeDampen;
        s_depth_lut[i].ao = ao;
    }
}

static inline void sample_bilinear_fast(const unsigned char *src_pixels, int stride, int width, int height,
                                       double sx, double sy, double *out_r, double *out_g, double *out_b) {
    int x0 = (int)sx;
    int y0 = (int)sy;
    if (sx < 0) x0--;
    if (sy < 0) y0--;

    if (__builtin_expect(x0 >= 0 && x0 < width - 1 && y0 >= 0 && y0 < height - 1, 1)) {
        int fx = (int)((sx - x0) * 256.0);
        int fy = (int)((sy - y0) * 256.0);
        int ifx = 256 - fx;
        int ify = 256 - fy;

        const uint32_t *row0 = (const uint32_t *)(src_pixels + y0 * stride) + x0;
        const uint32_t *row1 = (const uint32_t *)(src_pixels + (y0 + 1) * stride) + x0;

        uint32_t c00 = row0[0];
        uint32_t c10 = row0[1];
        uint32_t c01 = row1[0];
        uint32_t c11 = row1[1];

        int w00 = (ifx * ify) >> 8;
        int w10 = (fx * ify) >> 8;
        int w01 = (ifx * fy) >> 8;
        int w11 = (fx * fy) >> 8;

        *out_r = (w00 * ((c00 >> 16) & 0xFF) + w10 * ((c10 >> 16) & 0xFF) +
                  w01 * ((c01 >> 16) & 0xFF) + w11 * ((c11 >> 16) & 0xFF)) >> 8;
        *out_g = (w00 * ((c00 >> 8) & 0xFF) + w10 * ((c10 >> 8) & 0xFF) +
                  w01 * ((c01 >> 8) & 0xFF) + w11 * ((c11 >> 8) & 0xFF)) >> 8;
        *out_b = (w00 * (c00 & 0xFF) + w10 * (c10 & 0xFF) +
                  w01 * (c01 & 0xFF) + w11 * (c11 & 0xFF)) >> 8;
    } else {
        int cx0 = CLAMP(x0, 0, width - 1);
        int cx1 = CLAMP(x0 + 1, 0, width - 1);
        int cy0 = CLAMP(y0, 0, height - 1);
        int cy1 = CLAMP(y0 + 1, 0, height - 1);

        double fx = sx - x0;
        double fy = sy - y0;

        uint32_t c00 = *(const uint32_t *)(src_pixels + cy0 * stride + cx0 * 4);
        uint32_t c10 = *(const uint32_t *)(src_pixels + cy0 * stride + cx1 * 4);
        uint32_t c01 = *(const uint32_t *)(src_pixels + cy1 * stride + cx0 * 4);
        uint32_t c11 = *(const uint32_t *)(src_pixels + cy1 * stride + cx1 * 4);

        double r0 = ((c00 >> 16) & 0xFF) * (1.0 - fx) + ((c10 >> 16) & 0xFF) * fx;
        double g0 = ((c00 >> 8) & 0xFF) * (1.0 - fx) + ((c10 >> 8) & 0xFF) * fx;
        double b0 = (c00 & 0xFF) * (1.0 - fx) + (c10 & 0xFF) * fx;

        double r1 = ((c01 >> 16) & 0xFF) * (1.0 - fx) + ((c11 >> 16) & 0xFF) * fx;
        double g1 = ((c01 >> 8) & 0xFF) * (1.0 - fx) + ((c11 >> 8) & 0xFF) * fx;
        double b1 = (c01 & 0xFF) * (1.0 - fx) + (c11 & 0xFF) * fx;

        *out_r = r0 * (1.0 - fy) + r1 * fy;
        *out_g = g0 * (1.0 - fy) + g1 * fy;
        *out_b = b0 * (1.0 - fy) + b1 * fy;
    }
}

static inline double sample_channel_fast(const unsigned char *src_pixels, int stride, int width, int height,
                                         double sx, double sy, int shift) {
    int x0 = (int)sx;
    int y0 = (int)sy;
    if (sx < 0) x0--;
    if (sy < 0) y0--;

    if (__builtin_expect(x0 >= 0 && x0 < width - 1 && y0 >= 0 && y0 < height - 1, 1)) {
        int fx = (int)((sx - x0) * 256.0);
        int fy = (int)((sy - y0) * 256.0);
        int ifx = 256 - fx;
        int ify = 256 - fy;

        const uint32_t *row0 = (const uint32_t *)(src_pixels + y0 * stride) + x0;
        const uint32_t *row1 = (const uint32_t *)(src_pixels + (y0 + 1) * stride) + x0;

        int w00 = (ifx * ify) >> 8;
        int w10 = (fx * ify) >> 8;
        int w01 = (ifx * fy) >> 8;
        int w11 = (fx * fy) >> 8;

        return (w00 * ((row0[0] >> shift) & 0xFF) + w10 * ((row0[1] >> shift) & 0xFF) +
                w01 * ((row1[0] >> shift) & 0xFF) + w11 * ((row1[1] >> shift) & 0xFF)) >> 8;
    } else {
        int cx0 = CLAMP(x0, 0, width - 1);
        int cx1 = CLAMP(x0 + 1, 0, width - 1);
        int cy0 = CLAMP(y0, 0, height - 1);
        int cy1 = CLAMP(y0 + 1, 0, height - 1);

        double fx = sx - x0;
        double fy = sy - y0;

        uint32_t c00 = *(const uint32_t *)(src_pixels + cy0 * stride + cx0 * 4);
        uint32_t c10 = *(const uint32_t *)(src_pixels + cy0 * stride + cx1 * 4);
        uint32_t c01 = *(const uint32_t *)(src_pixels + cy1 * stride + cx0 * 4);
        uint32_t c11 = *(const uint32_t *)(src_pixels + cy1 * stride + cx1 * 4);

        double v0 = ((c00 >> shift) & 0xFF) * (1.0 - fx) + ((c10 >> shift) & 0xFF) * fx;
        double v1 = ((c01 >> shift) & 0xFF) * (1.0 - fx) + ((c11 >> shift) & 0xFF) * fx;
        return v0 * (1.0 - fy) + v1 * fy;
    }
}

static void draw_shape_path(cairo_t *cr, double x, double y, double w, double h, double r, int shape) {
    if (shape == 1) {
        cairo_arc(cr, x + w * 0.5, y + h * 0.5, fmin(w, h) * 0.5, 0, 2 * M_PI);
    } else if (shape == 2) {
        double rad = fmin(w, h) * 0.5;
        cairo_arc(cr, x + w - rad, y + rad, rad, -M_PI * 0.5, 0);
        cairo_arc(cr, x + w - rad, y + h - rad, rad, 0, M_PI * 0.5);
        cairo_arc(cr, x + rad, y + h - rad, rad, M_PI * 0.5, M_PI);
        cairo_arc(cr, x + rad, y + rad, rad, M_PI, M_PI * 1.5);
        cairo_close_path(cr);
    } else {
        cairo_arc(cr, x + w - r, y + r, r, -M_PI * 0.5, 0);
        cairo_arc(cr, x + w - r, y + h - r, r, 0, M_PI * 0.5);
        cairo_arc(cr, x + r, y + h - r, r, M_PI * 0.5, M_PI);
        cairo_arc(cr, x + r, y + r, r, M_PI, M_PI * 1.5);
        cairo_close_path(cr);
    }
}

static void draw_benchmark_glass_element(cairo_t *cr, cairo_surface_t *bg, int width, int height,
                                         double gx, double gy, double gw, double gh, double gr, int shape, int active_elem_count) {
    if (!bg) return;

    double shadow_val = 0.45;
    if (shadow_val > 0.02) {
        int passes = (active_elem_count > 10) ? 2 : 4;
        for (int i = passes; i >= 1; i--) {
            double expand = (passes == 2) ? (i * 4.0) : (i * 2.5);
            double alpha = (passes == 2) ? ((shadow_val * 0.22) / i) : ((shadow_val * 0.14) / i);
            draw_shape_path(cr, gx - expand, gy - 3.5 - expand * 0.5, gw + expand * 2.0, gh + expand * 2.0, gr + expand, shape);
            cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, alpha);
            cairo_fill(cr);
        }
    }

    int igx = (int)round(gx);
    int igy = (int)round(gy);
    int igw = (int)round(gw);
    int igh = (int)round(gh);
    if (igw > 320) igw = 320;
    if (igh > 320) igh = 320;

    cairo_surface_flush(bg);
    unsigned char *src_pixels = cairo_image_surface_get_data(bg);
    int src_stride = cairo_image_surface_get_stride(bg);

    double bx = gw * 0.5;
    double by = gh * 0.5;
    if (shape == 2) gr = fmin(bx, by);

    double max_z = 25.0;
    double bevel_width = CLAMP(max_z * 0.75 + gr * 0.2, 4.0, 28.0);
    double inv_bevel = 1.0 / bevel_width;

    double ior = 2.12;
    double disp_scale = 24.0;
    double chroma_str = 0.66;
    double tint_strength = 0.0;
    double rim_intensity = 0.48;

    build_depth_lut(ior, disp_scale, rim_intensity, bevel_width);

    double ly_dir = 0.93;
    double lz_dir = 0.35;

    double tint_r = 41.0, tint_g = 41.0, tint_b = 46.0;
    double one_minus_tint = 1.0 - tint_strength;
    double tint_r_str = tint_r * tint_strength;
    double tint_g_str = tint_g * tint_strength;
    double tint_b_str = tint_b * tint_strength;
    double const_sheen = pow(lz_dir, 1.65) * 0.30 * 255.0;

    uint8_t lut_r[256], lut_g[256], lut_b[256];
    for (int i = 0; i < 256; i++) {
        double base_r = (double)i * one_minus_tint + tint_r_str;
        double base_g = (double)i * one_minus_tint + tint_g_str;
        double base_b = (double)i * one_minus_tint + tint_b_str;
        lut_r[i] = (uint8_t)CLAMP(base_r + const_sheen - (base_r * const_sheen * (1.0 / 255.0)), 0, 255);
        lut_g[i] = (uint8_t)CLAMP(base_g + const_sheen - (base_g * const_sheen * (1.0 / 255.0)), 0, 255);
        lut_b[i] = (uint8_t)CLAMP(base_b + const_sheen - (base_b * const_sheen * (1.0 / 255.0)), 0, 255);
    }

    double circle_r = (shape == 1) ? fmin(bx, by) : 0.0;
    double safe_inner_x = (shape == 0) ? (bx - bevel_width - gr) : -1.0;
    double safe_inner_y = (shape == 0) ? (by - bevel_width) : -1.0;

    for (int ly = 0; ly < igh; ly++) {
        uint32_t *dst_row = s_scratch_pixels + ly * igw;
        double py = ly - by + 0.5;
        int bg_y = CLAMP(igy + ly, 0, height - 1);
        const uint32_t *src_row = (const uint32_t *)(src_pixels + bg_y * src_stride);

        double qy = fabs(py) - by + gr;
        double max_qy = fmax(qy, 0.0);
        double max_qy_sq = max_qy * max_qy;
        double sign_y = (py >= 0.0) ? 1.0 : -1.0;

        for (int lx = 0; lx < igw; lx++) {
            double px = lx - bx + 0.5;

            /* Flat interior fast path: direct 32-bit pixel fetch and constant sheen */
            if (safe_inner_x > 0.0 && fabs(px) <= safe_inner_x && fabs(py) <= safe_inner_y) {
                int bg_x = CLAMP(igx + lx, 0, width - 1);
                uint32_t c = src_row[bg_x];
                dst_row[lx] = (0xFF << 24) | (lut_r[(c >> 16) & 0xFF] << 16) | (lut_g[(c >> 8) & 0xFF] << 8) | lut_b[c & 0xFF];
                continue;
            }

            double n2d_x, n2d_y, d;
            if (shape == 1) {
                double len = sqrt(px * px + py * py) + 1e-6;
                double inv_len = 1.0 / len;
                n2d_x = px * inv_len;
                n2d_y = py * inv_len;
                d = len - circle_r;
            } else {
                double qx = fabs(px) - bx + gr;
                double max_qx = fmax(qx, 0.0);
                double sign_x = (px >= 0.0) ? 1.0 : -1.0;

                if (max_qx > 0.0 && max_qy > 0.0) {
                    double out_len = sqrt(max_qx * max_qx + max_qy_sq);
                    double inv_len = 1.0 / out_len;
                    n2d_x = sign_x * (max_qx * inv_len);
                    n2d_y = sign_y * (max_qy * inv_len);
                    d = out_len - gr;
                } else if (max_qx > 0.0) {
                    n2d_x = sign_x;
                    n2d_y = 0.0;
                    d = max_qx + qy - gr;
                } else if (max_qy > 0.0) {
                    n2d_x = 0.0;
                    n2d_y = sign_y;
                    d = max_qy + qx - gr;
                } else {
                    if (qx > qy) {
                        n2d_x = sign_x;
                        n2d_y = 0.0;
                        d = qx - gr;
                    } else {
                        n2d_x = 0.0;
                        n2d_y = sign_y;
                        d = qy - gr;
                    }
                }
            }

            if (d > 0.8) {
                dst_row[lx] = 0;
                continue;
            }

            double depth = -d * inv_bevel;
            if (depth >= 1.0) {
                int bg_x = CLAMP(igx + lx, 0, width - 1);
                uint32_t c = src_row[bg_x];
                dst_row[lx] = (0xFF << 24) | (lut_r[(c >> 16) & 0xFF] << 16) | (lut_g[(c >> 8) & 0xFF] << 8) | lut_b[c & 0xFF];
                continue;
            }

            if (depth < 0.0) depth = 0.0;
            int lidx = (int)(depth * 255.0);
            const DepthLUT *item = &s_depth_lut[lidx];

            double disp_factor = item->disp_factor;
            double disp_x = -n2d_x * disp_factor;
            double disp_y = -n2d_y * disp_factor;

            double sx = gx + lx + disp_x;
            double sy = gy + ly + disp_y;

            double cr_r, cr_g, cr_b;
            if (chroma_str > 0.01 && disp_factor > 0.1) {
                cr_g = sample_channel_fast(src_pixels, src_stride, width, height, sx, sy, 8);
                double c_off_x = -n2d_x * (chroma_str * item->chromaDampen);
                double c_off_y = -n2d_y * (chroma_str * item->chromaDampen);
                cr_r = sample_channel_fast(src_pixels, src_stride, width, height, sx + c_off_x, sy + c_off_y, 16);
                cr_b = sample_channel_fast(src_pixels, src_stride, width, height, sx - c_off_x, sy - c_off_y, 0);
            } else {
                sample_bilinear_fast(src_pixels, src_stride, width, height, sx, sy, &cr_r, &cr_g, &cr_b);
            }

            double base_r = (cr_r * one_minus_tint + tint_r_str) * item->ao;
            double base_g = (cr_g * one_minus_tint + tint_g_str) * item->ao;
            double base_b = (cr_b * one_minus_tint + tint_b_str) * item->ao;

            double dotNL = n2d_y * item->sinA * ly_dir + item->cosA * lz_dir;
            double lightMask = pow(fabs(dotNL), 2.7);
            double finalRimLight = item->rimEdge * lightMask;
            double sheenFacing = fmax(dotNL, 0.0);
            double sheenLight = pow(sheenFacing, 1.65) * 0.30 * 255.0;

            double added = finalRimLight + sheenLight;
            double lit_r = base_r + added - (base_r * added * (1.0 / 255.0));
            double lit_g = base_g + added - (base_g * added * (1.0 / 255.0));
            double lit_b = base_b + added - (base_b * added * (1.0 / 255.0));

            uint8_t out_a = (uint8_t)CLAMP(item->insideMask * 255.0, 0, 255);
            uint8_t out_r = (uint8_t)CLAMP(lit_r, 0, 255);
            uint8_t out_g = (uint8_t)CLAMP(lit_g, 0, 255);
            uint8_t out_b = (uint8_t)CLAMP(lit_b, 0, 255);

            dst_row[lx] = (out_a << 24) | (out_r << 16) | (out_g << 8) | out_b;
        }
    }

    cairo_surface_t *glass_surf = cairo_image_surface_create_for_data(
        (unsigned char *)s_scratch_pixels, CAIRO_FORMAT_ARGB32, igw, igh, igw * 4);
    cairo_surface_mark_dirty(glass_surf);
    cairo_set_source_surface(cr, glass_surf, igx, igy);
    cairo_paint(cr);
    cairo_surface_destroy(glass_surf);

    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.65);
    double cx = gx + gw * 0.5;
    double cy = gy + gh * 0.5;
    cairo_new_sub_path(cr);
    cairo_arc(cr, cx - 9.0, cy, 2.2, 0, 2 * M_PI);
    cairo_new_sub_path(cr);
    cairo_arc(cr, cx, cy, 2.2, 0, 2 * M_PI);
    cairo_new_sub_path(cr);
    cairo_arc(cr, cx + 9.0, cy, 2.2, 0, 2 * M_PI);
    cairo_fill(cr);
}

static void init_elements(int width, int height) {
    for (int i = 0; i < MAX_BENCHMARK_ELEMENTS; i++) {
        int sh = i % 3;
        double w = 110.0, h = 70.0, r = 20.0;
        if (sh == 1) {
            w = 70.0; h = 70.0; r = 35.0;
        } else if (sh == 2) {
            w = 120.0; h = 60.0; r = 30.0;
        } else {
            w = 100.0; h = 65.0; r = 18.0;
        }
        g_elements[i].w = w;
        g_elements[i].h = h;
        g_elements[i].r = r;
        g_elements[i].shape = sh;

        double max_x = fmax(width - w - 10.0, 10.0);
        double max_y = fmax(height - h - 10.0, 10.0);
        g_elements[i].x = 10.0 + ((i * 53) % (int)max_x);
        g_elements[i].y = 10.0 + ((i * 37) % (int)max_y);

        double speed_x = 45.0 + (i * 13 % 45);
        double speed_y = 35.0 + (i * 19 % 45);
        if (i % 2 == 1) speed_x = -speed_x;
        if ((i / 2) % 2 == 1) speed_y = -speed_y;
        g_elements[i].vx = speed_x;
        g_elements[i].vy = speed_y;
    }
}

int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    bool cli_mode = false;
    bool json_mode = false;
    double threshold_fps = DEFAULT_BENCH_FPS_THRESHOLD;
    double duration = DEFAULT_DURATION;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--cli") == 0 || strcmp(argv[i], "-c") == 0) {
            cli_mode = true;
        } else if (strcmp(argv[i], "--json") == 0 || strcmp(argv[i], "-j") == 0) {
            json_mode = true;
        } else if (strcmp(argv[i], "--threshold") == 0 && i + 1 < argc) {
            threshold_fps = atof(argv[++i]);
        } else if (strcmp(argv[i], "--duration") == 0 && i + 1 < argc) {
            duration = atof(argv[++i]);
        }
    }

    int width = 600, height = 210;
    cairo_surface_t *target = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_t *cr = cairo_create(target);

    cairo_surface_t *bg = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_t *bg_cr = cairo_create(bg);
    cairo_pattern_t *pat = cairo_pattern_create_linear(0, 0, width, height);
    cairo_pattern_add_color_stop_rgb(pat, 0.0, 0.15, 0.20, 0.35);
    cairo_pattern_add_color_stop_rgb(pat, 1.0, 0.85, 0.45, 0.20);
    cairo_set_source(bg_cr, pat);
    cairo_paint(bg_cr);
    cairo_pattern_destroy(pat);
    cairo_destroy(bg_cr);

    init_elements(width, height);

    if (cli_mode) {
        printf("\033[1;36m============================================================\033[0m\n");
        printf("\033[1;37m        macW1Y Liquid Glass Performance Benchmark           \033[0m\n");
        printf("\033[1;36m============================================================\033[0m\n");
        printf("Running 10s stress test (up to 50 glass elements, limit 120 FPS)...\n\n");
    }

    double start_time = get_time_sec();
    double last_report_time = start_time;
    double last_frame_time = start_time;
    double sum_stress_fps = 0.0;
    int stress_samples = 0;
    double min_stress_fps = 999.0;

    while (1) {
        double now = get_time_sec();
        double elapsed = now - start_time;
        if (elapsed >= duration) break;

        /* Ramp up elements across first 5 seconds:
           0.0s - 1.0s: 1 element
           1.0s - 2.0s: 5 elements
           2.0s - 3.0s: 15 elements
           3.0s - 4.0s: 30 elements
           4.0s - end : 50 elements */
        int n_elems = 1;
        if (elapsed >= 4.0) n_elems = 50;
        else if (elapsed >= 3.0) n_elems = 30;
        else if (elapsed >= 2.0) n_elems = 15;
        else if (elapsed >= 1.0) n_elems = 5;

        double dt = now - last_frame_time;
        if (dt < 0.00833) {
            /* 120 FPS limit target interval */
            usleep((useconds_t)((0.00833 - dt) * 1000000));
            now = get_time_sec();
            dt = now - last_frame_time;
        }
        last_frame_time = now;

        /* Move elements */
        for (int i = 0; i < n_elems; i++) {
            g_elements[i].x += g_elements[i].vx * dt;
            g_elements[i].y += g_elements[i].vy * dt;

            double min_x = 6.0;
            double max_x = width - g_elements[i].w - 6.0;
            double min_y = 6.0;
            double max_y = height - g_elements[i].h - 6.0;

            if (max_x > min_x) {
                if (g_elements[i].x < min_x) {
                    g_elements[i].x = min_x;
                    g_elements[i].vx = fabs(g_elements[i].vx);
                } else if (g_elements[i].x > max_x) {
                    g_elements[i].x = max_x;
                    g_elements[i].vx = -fabs(g_elements[i].vx);
                }
            }
            if (max_y > min_y) {
                if (g_elements[i].y < min_y) {
                    g_elements[i].y = min_y;
                    g_elements[i].vy = fabs(g_elements[i].vy);
                } else if (g_elements[i].y > max_y) {
                    g_elements[i].y = max_y;
                    g_elements[i].vy = -fabs(g_elements[i].vy);
                }
            }
        }

        /* Render offscreen frame */
        double rf_t0 = get_time_sec();
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);

        for (int i = 0; i < n_elems; i++) {
            draw_benchmark_glass_element(cr, bg, width, height,
                g_elements[i].x, g_elements[i].y,
                g_elements[i].w, g_elements[i].h,
                g_elements[i].r, g_elements[i].shape, n_elems);
        }
        double rf_t1 = get_time_sec();
        double render_sec = rf_t1 - rf_t0;
        double frame_fps = (render_sec > 0.0001) ? (1.0 / render_sec) : 120.0;
        if (frame_fps > 120.0) frame_fps = 120.0;

        /* During the second half (5s-10s), sample minimum sustained FPS under full stress */
        if (elapsed >= 5.0) {
            sum_stress_fps += frame_fps;
            stress_samples++;
            if (frame_fps < min_stress_fps) {
                min_stress_fps = frame_fps;
            }
        }

        /* Progress reporting every 0.1s */
        if (now - last_report_time >= 0.1) {
            double pct = (elapsed / duration) * 100.0;
            if (pct > 100.0) pct = 100.0;
            double cur_min = (stress_samples > 0) ? min_stress_fps : frame_fps;

            if (cli_mode) {
                int bar_w = 28;
                int filled = (int)(pct / 100.0 * bar_w);
                printf("\r  [%-28.*s] %5.1f%% | %2d elems | %5.1f FPS (Min: %5.1f)",
                       filled, "============================", pct, n_elems, frame_fps, cur_min);
                fflush(stdout);
            } else if (!json_mode) {
                printf("PROGRESS:%.1f:%d:%.1f:%.1f\n", pct, n_elems, frame_fps, cur_min);
            }
            last_report_time = now;
        }
    }

    if (min_stress_fps > 120.0 || stress_samples == 0) min_stress_fps = 60.0;
    double avg_stress_fps = (stress_samples > 0) ? (sum_stress_fps / stress_samples) : min_stress_fps;

    const char *recommendation = (min_stress_fps >= threshold_fps) ? "shader" : "blur";

    if (cli_mode) {
        printf("\r  [============================] 100.0%% | 50 elems | Done!                 \n\n");
        printf("\033[1;32mBenchmark Complete!\033[0m\n");
        printf("  • Minimum Measured FPS (50 elements): \033[1m%.1f FPS\033[0m\n", min_stress_fps);
        printf("  • Average Measured FPS (50 elements): \033[1m%.1f FPS\033[0m\n", avg_stress_fps);
        printf("  • Threshold:                          \033[1m%.1f FPS\033[0m\n", threshold_fps);
        if (strcmp(recommendation, "shader") == 0) {
            printf("  • Recommendation:                     \033[1;32mLiquid Glass Shader\033[0m (System is fast enough)\n");
        } else {
            printf("  • Recommendation:                     \033[1;33mPure Blur (Lightweight)\033[0m (Recommended for weak/integrated GPU)\n");
        }
        printf("\n");
    } else if (json_mode) {
        printf("{\"min_fps\": %.1f, \"avg_fps\": %.1f, \"recommendation\": \"%s\", \"threshold\": %.1f}\n",
               min_stress_fps, avg_stress_fps, recommendation, threshold_fps);
    } else {
        printf("PROGRESS:100.0:50:%.1f:%.1f\n", avg_stress_fps, min_stress_fps);
        printf("RESULT:min_fps=%.1f:avg_fps=%.1f:recommendation=%s:threshold=%.1f\n",
               min_stress_fps, avg_stress_fps, recommendation, threshold_fps);
    }

    cairo_destroy(cr);
    cairo_surface_destroy(target);
    cairo_surface_destroy(bg);
    return 0;
}
