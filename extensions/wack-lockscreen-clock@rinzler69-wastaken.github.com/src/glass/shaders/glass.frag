
uniform sampler2D cogl_sampler0;
uniform sampler2D cogl_sampler1;

uniform float resolution_x;
uniform float resolution_y;
uniform float corner_radius;
uniform float max_z;
uniform float displacement_scale;
uniform float edge_smoothing;
uniform float profile_shape_n;
uniform float ior;
uniform float chroma_strength;
uniform float tint_strength;
uniform float tint_r;
uniform float tint_g;
uniform float tint_b;
uniform float specular_intensity;
uniform float rim_width;
uniform float rim_intensity;
uniform float rim_directional_power;
uniform float rim_power;
uniform float rim_light_color_intensity;
uniform float sheen_intensity;
uniform float shininess;

uniform float outline_width;
uniform float outline_r;
uniform float outline_g;
uniform float outline_b;


uniform float surface_light_enabled;

uniform float highlight_backdrop_color;


uniform float corner_smoothing;

uniform float corner_smoothing_enabled;

uniform float ao_intensity;
uniform float ao_radius;
uniform float light_angle_deg;
uniform float shadow_radius;
uniform float shadow_intensity;


uniform float shadow_max_radius;
uniform float padding;
uniform float isDock;




uniform float blur_rect_x;
uniform float blur_rect_y;
uniform float blur_rect_w;
uniform float blur_rect_h;


uniform float blur_tex_w;
uniform float blur_tex_h;








#define EDGE_LENS_FALLOFF 2.4



#define EDGE_LENS_REACH 96.0





#define EDGE_LENS_BAND 22.0

// Diagnostic switches, set through global._lgGlass. MaterialSettings seeds





uniform float edge_taps_enabled;
uniform float early_exit_enabled;
uniform float debug_view;

uniform float brightness;
uniform float contrast;
uniform float saturation;



uniform float dock_x;
uniform float dock_y;
uniform float dock_w;
uniform float dock_h;




#define MAX_GLASS_REGIONS 16
uniform float multi_region_mode;
uniform float region_count;
uniform float region_x[MAX_GLASS_REGIONS];
uniform float region_y[MAX_GLASS_REGIONS];
uniform float region_w[MAX_GLASS_REGIONS];
uniform float region_h[MAX_GLASS_REGIONS];
uniform float region_tint_r[MAX_GLASS_REGIONS];
uniform float region_tint_g[MAX_GLASS_REGIONS];
uniform float region_tint_b[MAX_GLASS_REGIONS];


uniform float region_base_strength[MAX_GLASS_REGIONS];

#ifdef LG_SHAPE_TEXTURE





uniform float shape_range;
uniform float shape_band;
#endif


float sdCircleRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}








vec2 cornerShape(vec2 b, float r) {
    r = min(r, min(b.x, b.y));
    float s = clamp(corner_smoothing, 0.0, 1.0) * corner_smoothing_enabled;
    float k = min(1.0 + s, max(min(b.x, b.y) / max(r, 1.0e-3), 1.0));

    float n = -1.0 / log2(1.0 - 0.29289322 / k);
    return vec2(r * k, n);
}


float superLength(vec2 q, float n) {
    float m = max(q.x, q.y);
    if (m <= 0.0)
        return 0.0;
    vec2 u = q / m;
    return m * pow(pow(u.x, n) + pow(u.y, n), 1.0 / n);
}







float sdRoundRect(vec2 p, vec2 b, vec2 corner) {
    float r = corner.x;
    float n = corner.y;
    vec2 d = abs(p) - b + vec2(r);
    vec2 q = max(d, 0.0);
    float len = superLength(q, n);
    if (len <= 0.0)
        return max(d.x, d.y) - r;
    vec2 g = pow(q / len, vec2(n - 1.0));
    float gradLen = mix(1.0, length(g), clamp(len / max(r, 1.0e-3), 0.0, 1.0));
    return (len - r) / max(gradLen, 0.5);
}




void findActiveRegion(vec2 pixel_coord, float pad, out vec2 outLocalPos, out vec2 outBoxSize, out vec3 outTint, out float outBaseStrength) {
    float bestD = 1.0e6;
    outLocalPos = vec2(1.0e6);
    outBoxSize = vec2(1.0);
    outTint = vec3(1.0);
    outBaseStrength = 0.0;

    int count = int(min(region_count, float(MAX_GLASS_REGIONS)));

    for (int i = 0; i < MAX_GLASS_REGIONS; i++) {
        if (i >= count) break;

        vec2 rPos = vec2(region_x[i], region_y[i]);
        vec2 rSize = vec2(region_w[i], region_h[i]);
        vec2 rCenter = rPos + rSize * 0.5;
        vec2 rLocal = pixel_coord - rCenter;

        vec2 actual_size = rSize - vec2(pad * 2.0);
        vec2 rBox = max(actual_size * 0.5, vec2(1.0));



        float d = sdCircleRoundRect(rLocal, rBox, corner_radius);
        if (d < bestD) {
            bestD = d;
            outLocalPos = rLocal;
            outBoxSize = rBox;
            outTint = vec3(region_tint_r[i], region_tint_g[i], region_tint_b[i]);
            outBaseStrength = region_base_strength[i];
        }
    }
}



float normalizedDepth(float d, vec2 b, float r) {
    float maxDepth = max(r, 1.0);

    float interiorDepth = max(-d, 0.0);
    return clamp(interiorDepth / maxDepth, 0.0, 1.0);
}


float profileHeight(float t, float zScale) {
    float n = max(profile_shape_n, 1.01);
    float invT = clamp(1.0 - t, 0.0, 1.0);
    float inner = max(1.0 - pow(invT, n), 0.0);
    float h = pow(inner, 1.0 / n);
    return h * zScale;
}



float getHeight(vec2 p, vec2 b, vec2 corner, float band, float zScale) {
    float d = sdRoundRect(p, b, corner);




    float smoothZone = max(edge_smoothing, 1.0);
    if (d > smoothZone)
        return 0.0;

    float t = normalizedDepth(d, b, band);
    float h = profileHeight(t, zScale);

    float fade = 1.0 - smoothstep(-smoothZone, smoothZone, d);
    return h * fade;
}



float lensBandFor(float halfMin) {
    return max(min(EDGE_LENS_BAND, halfMin), 1.0);
}




float lensScaleFor(float band) {
    return band / max(EDGE_LENS_BAND, 1.0);
}


float gradientStep(vec2 resolution) {
    float minRes = max(min(resolution.x, resolution.y), 1.0);
    return clamp(minRes / 560.0, 0.45, 1.20);
}




vec2 sdRoundRectDir(vec2 p, vec2 b, vec2 corner) {
    vec2 q = abs(p) - b + vec2(corner.x);
    if (max(q.x, q.y) < 0.0) {
        return (q.x > q.y) ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    }
    vec2 u = max(q, 0.0) / max(max(q.x, q.y), 1.0e-6);
    return sign(p) * normalize(pow(u, vec2(corner.y - 1.0)) + vec2(1e-6));
}








vec2 heightGradient(vec2 p, vec2 b, vec2 corner, float band, float zScale, vec2 resolution) {
    vec2 dir = sdRoundRectDir(p, b, corner);
    float e = gradientStep(resolution);

    float hOut = getHeight(p + dir * e, b, corner, band, zScale);
    float hIn  = getHeight(p - dir * e, b, corner, band, zScale);

    return dir * ((hOut - hIn) / (2.0 * e));
}

vec3 getNormal(vec2 gradH) {
    return normalize(vec3(-gradH.x, -gradH.y, 1.0));
}

#ifdef LG_SHAPE_TEXTURE
float shapeDistanceAt(vec2 texel, vec2 texSize) {
    vec2 c = texture2D(cogl_sampler2, texel / texSize).rg;
    return mix(-shape_range, shape_range, (c.r * 65280.0 + c.g * 255.0) / 65535.0);
}


float shapeTextureSD(vec2 p) {
    vec2 size = max(vec2(dock_w, dock_h), vec2(1.0));
    vec2 st = p / size + 0.5;

    vec2 beyond = max(abs(st - 0.5) - 0.5, 0.0) * size;
    vec2 texel = clamp(st * size, vec2(0.5), size - 0.5);
    return shapeDistanceAt(texel, size * vec2(1.0, 2.0)) + length(beyond);
}




float shapeLensSD(vec2 p) {
    vec2 size = max(vec2(dock_w, dock_h), vec2(1.0));
    vec2 st = p / size + 0.5;
    vec2 beyond = max(abs(st - 0.5) - 0.5, 0.0) * size;
    vec2 t = clamp(st, vec2(0.0), vec2(1.0)) * size - 0.5;
    vec2 i = floor(t);
    vec2 f = t - i;
    vec2 f2 = f * f;
    vec2 f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    vec2 w3 = f3 / 6.0;
    vec2 g0 = w0 + w1;
    vec2 g1 = w2 + w3;

    vec2 lo = vec2(0.5, size.y + 0.5);
    vec2 hi = vec2(size.x - 0.5, size.y * 2.0 - 0.5);
    vec2 h0 = clamp(i - 0.5 + w1 / g0 + vec2(0.0, size.y), lo, hi);
    vec2 h1 = clamp(i + 1.5 + w3 / g1 + vec2(0.0, size.y), lo, hi);
    vec2 texSize = size * vec2(1.0, 2.0);
    float d = g0.y * (g0.x * shapeDistanceAt(h0, texSize) + g1.x * shapeDistanceAt(vec2(h1.x, h0.y), texSize)) +
              g1.y * (g0.x * shapeDistanceAt(vec2(h0.x, h1.y), texSize) + g1.x * shapeDistanceAt(h1, texSize));
    return d + length(beyond);
}
#endif

#ifdef LG_SHAPE_TEXTURE


vec2 shapeDir(vec2 p) {
    const float e = 0.5;
    vec2 g = vec2(shapeLensSD(p + vec2(e, 0.0)) - shapeLensSD(p - vec2(e, 0.0)),
                  shapeLensSD(p + vec2(0.0, e)) - shapeLensSD(p - vec2(0.0, e)));
    float len = length(g);
    return len > 1.0e-5 ? g / len : vec2(1.0, 0.0);
}


float heightAtDistance(float d, vec2 b, float band, float zScale) {
    float smoothZone = max(edge_smoothing, 1.0);
    if (d > smoothZone)
        return 0.0;
    float t = normalizedDepth(d, b, band);
    float h = profileHeight(t, zScale * lensScaleFor(band));
    float fade = 1.0 - smoothstep(-smoothZone, smoothZone, d);
    return h * fade;
}





vec2 shapeHeightGradient(vec2 p, vec2 b, float zScale, vec2 resolution) {
    float e = gradientStep(resolution);
    const float g = 0.5;
    vec2 grad = vec2(shapeLensSD(p + vec2(g, 0.0)) - shapeLensSD(p - vec2(g, 0.0)),
                     shapeLensSD(p + vec2(0.0, g)) - shapeLensSD(p - vec2(0.0, g))) / (2.0 * g);
    float d = shapeTextureSD(p);
    float band = max(shape_band, 1.0);
    float slope = (heightAtDistance(d + e, b, band, zScale) - heightAtDistance(d - e, b, band, zScale)) / (2.0 * e);
    return grad * slope;
}
#endif


vec2 getDisplacement(float d, vec3 normal, vec2 resolution) {
    if (d > 0.0)
        return vec2(0.0);


    vec3 viewDir = vec3(0.0, 0.0, -1.0);
    float eta = 1.0 / max(ior, 1.001);
    vec3 refractedRay = refract(viewDir, normal, eta);


    if (length(refractedRay) < 0.0001)
        return vec2(0.0);

    float minRes = max(min(resolution.x, resolution.y), 1.0);


    float safe_z = max(-refractedRay.z, 0.15);



    vec2 displacement = (refractedRay.xy / safe_z) *
                        (displacement_scale / max(resolution, vec2(1.0)));

    float max_disp_px = 0.30 * minRes;
    vec2 dispPx = displacement * resolution;
    float dispLenPx = length(dispPx);
    if (dispLenPx > max_disp_px) {
        displacement *= max_disp_px / dispLenPx;
    }

    return displacement;
}



vec2 stabilizedUV(vec2 candidate, vec2 fallback) {
    vec2 clamped = clamp(candidate, vec2(0.001), vec2(0.999));
    float edgeDist = min(min(candidate.x, candidate.y), min(1.0 - candidate.x, 1.0 - candidate.y));
    float keep = smoothstep(-0.04, 0.03, edgeDist);
    return mix(fallback, clamped, keep);
}



vec2 blurUV(vec2 fullUV, vec2 resolution) {
    vec2 uv;
    vec2 size;
    if (blur_rect_w < 1.0 || blur_rect_h < 1.0) {
        vec2 mFull = vec2(1.2) / max(resolution, vec2(1.0));
        uv = clamp(fullUV, mFull, vec2(1.0) - mFull);
        size = max(resolution, vec2(1.0));
    } else {
        size = vec2(blur_rect_w, blur_rect_h);
        vec2 m = vec2(1.2) / size;
        uv = clamp((fullUV * resolution - vec2(blur_rect_x, blur_rect_y)) / size,
                   m, vec2(1.0) - m);
    }





    vec2 texSize = vec2(blur_tex_w, blur_tex_h);
    if (texSize.x >= 2.0 && texSize.y >= 2.0 &&
        min(size.x / texSize.x, size.y / texSize.y) > 1.05) {
        vec2 t = uv * texSize - 0.5;
        vec2 f = fract(t);
        f = f * f * (3.0 - 2.0 * f);
        uv = (floor(t) + 0.5 + f) / texSize;
    }
    return uv;
}





vec3 sampleBackdrop(vec2 uvc, vec2 ext, vec2 texel, vec2 resolution) {
    vec2 o1 = vec2( 0.375, -0.125) * texel;
    vec2 o2 = vec2( 0.125,  0.375) * texel;
    vec2 o3 = vec2(-0.375,  0.125) * texel;
    vec2 o4 = vec2(-0.125, -0.375) * texel;

    vec4 t1 = texture2D(cogl_sampler1, blurUV(uvc + o1, resolution));
    vec4 t2 = texture2D(cogl_sampler1, blurUV(uvc + o2, resolution));
    vec4 t3 = texture2D(cogl_sampler1, blurUV(uvc + o3, resolution));
    vec4 t4 = texture2D(cogl_sampler1, blurUV(uvc + o4, resolution));
    vec3 sum = (t1.rgb + t2.rgb + t3.rgb + t4.rgb) * 0.25;
    float avgA = (t1.a + t2.a + t3.a + t4.a) * 0.25;
    if (avgA < 0.20) {
        vec3 fallbackBg = vec3(0.12, 0.12, 0.14);
        sum = mix(fallbackBg, sum, clamp(avgA / 0.20, 0.0, 1.0));
    }
    return sum;

    if (dot(ext, ext) <= 0.0)
        return sum * 0.25;



    sum +=
        texture2D(cogl_sampler1, blurUV(uvc + ext * 0.90 + o1, resolution)).rgb +
        texture2D(cogl_sampler1, blurUV(uvc + ext * 0.55 + o2, resolution)).rgb +
        texture2D(cogl_sampler1, blurUV(uvc + ext * 0.22 + o3, resolution)).rgb +
        texture2D(cogl_sampler1, blurUV(uvc - ext * 0.22 + o4, resolution)).rgb +
        texture2D(cogl_sampler1, blurUV(uvc - ext * 0.55 + o1, resolution)).rgb +
        texture2D(cogl_sampler1, blurUV(uvc - ext * 0.90 + o2, resolution)).rgb;

    return sum * 0.1;
}



float ditherLSB(vec2 p) {
    return (fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}


float erfcPositive(float x) {
    float p = 1.0 + x * (0.278393 + x * (0.230389 + x * (0.000972 + x * 0.078108)));
    float p2 = p * p;
    return 1.0 / (p2 * p2);
}


#define HIGHLIGHT_CHROMA_GAIN 1.25



vec3 toOklab(vec3 c) {
    vec3 lin = pow(max(c, 0.0), vec3(2.2));
    vec3 lms = vec3(
        dot(lin, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
        dot(lin, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
        dot(lin, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
    lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
    return vec3(
        dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
        dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
        dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}


vec3 oklabToLinear(vec3 lab) {
    vec3 lms = vec3(
        dot(lab, vec3(1.0, 0.3963377774, 0.2158037573)),
        dot(lab, vec3(1.0, -0.1055613458, -0.0638541728)),
        dot(lab, vec3(1.0, -0.0894841775, -1.2914855480)));
    lms = lms * lms * lms;
    return vec3(
        dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
        dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
        dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));
}



float gamutRoom(float from, float delta) {
    if (delta > 1.0e-6)
        return (1.0 - from) / delta;
    if (delta < -1.0e-6)
        return -from / delta;
    return 1.0;
}










vec3 backdropHighlight(vec3 base, vec3 lit, float light) {
    vec3 litLab = toOklab(lit);
    vec2 baseChroma = toOklab(base).yz * HIGHLIGHT_CHROMA_GAIN;
    litLab.yz = mix(litLab.yz, baseChroma, clamp(light * 4.0, 0.0, 1.0));

    vec3 from = pow(max(lit, 0.0), vec3(2.2));
    vec3 delta = oklabToLinear(litLab) - from;
    float t = min(min(gamutRoom(from.r, delta.r), gamutRoom(from.g, delta.g)),
                  min(gamutRoom(from.b, delta.b), 1.0));
    return pow(clamp(from + delta * max(t, 0.0), 0.0, 1.0), vec3(1.0 / 2.2));
}


vec3 applySCB(vec3 color, float b, float c, float s) {
    color *= b;

    color = mix(vec3(0.5), color, c);

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, s);

    return max(color, 0.0);
}

void main() {
    vec2 resolution = vec2(resolution_x, resolution_y);
    vec2 uv = cogl_tex_coord_in[0].st;

    vec2 pixel_coord = uv * resolution;


    float edgeFeather = max(edge_smoothing, 0.75);

    vec2 local_pos;
    vec2 box_size;
    vec3 activeTint;

    float activeBaseStrength = 0.0;

    if (multi_region_mode > 0.5) {
        findActiveRegion(pixel_coord, padding, local_pos, box_size, activeTint, activeBaseStrength);
    } else {


        vec2 dock_center = vec2(dock_x + dock_w * 0.5, dock_y + dock_h * 0.5);
        local_pos = pixel_coord - dock_center;

        if (isDock > 0.5) {

            vec2 actual_size = vec2(dock_w, dock_h) - vec2(padding * 2.0) - vec2(edgeFeather * 2.0);
            box_size = max(actual_size * 0.5, vec2(1.0));
        } else {
            vec2 actual_size = vec2(dock_w, dock_h) - vec2(padding * 2.0);
            box_size = max(actual_size * 0.5, vec2(1.0));
        }

        activeTint = vec3(tint_r, tint_g, tint_b);
    }

    vec2 corner = cornerShape(box_size, corner_radius);
    float d = sdRoundRect(local_pos, box_size, corner);

    float lensBand = lensBandFor(min(box_size.x, box_size.y));

#ifdef LG_SHAPE_TEXTURE
    d = shapeTextureSD(local_pos);
    lensBand = max(shape_band, 1.0);
#endif
    float lensScale = lensScaleFor(lensBand);



    float outsideTransition = smoothstep(-edgeFeather, edgeFeather, d);
    float insideMask = 1.0 - outsideTransition;
    float outsideMask = outsideTransition;






    float shadowReach = (multi_region_mode > 0.5) ? 0.0 : max(shadow_max_radius, 5.0);
    if (early_exit_enabled > 0.5 && debug_view < 0.5 && d >= max(shadowReach, edgeFeather)) {
        cogl_color_out = vec4(0.0);
        return;
    }





    float smoothZoneEarly = max(edge_smoothing, 1.0);
    float interiorThreshold = max(
        max(lensBand + gradientStep(resolution) + smoothZoneEarly,
            edgeFeather * 4.0),
        max(max(ao_radius, rim_width), outline_width + 1.0));
    if (early_exit_enabled > 0.5 && debug_view < 0.5 && -d >= interiorThreshold) {
        vec2 uvFlat = stabilizedUV(uv, uv);


        vec2 texelFlat = vec2(0.75) / resolution;
        vec3 flatRgb = (
            texture2D(cogl_sampler1, blurUV(uvFlat + vec2( 0.375, -0.125) * texelFlat, resolution)).rgb +
            texture2D(cogl_sampler1, blurUV(uvFlat + vec2( 0.125,  0.375) * texelFlat, resolution)).rgb +
            texture2D(cogl_sampler1, blurUV(uvFlat + vec2(-0.375,  0.125) * texelFlat, resolution)).rgb +
            texture2D(cogl_sampler1, blurUV(uvFlat + vec2(-0.125, -0.375) * texelFlat, resolution)).rgb
        ) * 0.25;

        flatRgb = applySCB(flatRgb, brightness, contrast, saturation);
        flatRgb = mix(flatRgb, activeTint, activeBaseStrength);
        flatRgb = mix(flatRgb, vec3(tint_r, tint_g, tint_b), tint_strength);



        vec3 lightDirFlat = normalize(vec3(cos(radians(light_angle_deg)),
                                           sin(radians(light_angle_deg)), 0.38));
        float facing = max(lightDirFlat.z, 0.0);
        float specFlat = pow(facing, max(shininess, 1.0)) * specular_intensity * 0.65;
        float sheenFlat = pow(facing, 1.65) * sheen_intensity;
        float lightFlat = (specFlat + sheenFlat) * surface_light_enabled;

        vec3 litFlat = flatRgb + lightFlat - (flatRgb * lightFlat);
        float maxChannelFlat = max(litFlat.r, max(litFlat.g, litFlat.b));
        if (maxChannelFlat > 1.0) {
            litFlat /= maxChannelFlat;
        }
        litFlat = max(litFlat, 0.0);
        if (highlight_backdrop_color > 0.5 && lightFlat > 0.0)
            litFlat = backdropHighlight(flatRgb, litFlat, lightFlat);

        litFlat = max(litFlat + ditherLSB(pixel_coord), 0.0);

        cogl_color_out = vec4(litFlat, 1.0) * cogl_color_in;
        return;
    }





    float lightAngleRad = radians(light_angle_deg);
    vec2 lightDir2D = vec2(cos(lightAngleRad), -sin(lightAngleRad));
    vec2 shadowDir   = -lightDir2D;



#ifdef LG_SHAPE_TEXTURE
    vec2 outwardDir = shapeDir(local_pos);
#else
    vec2 outwardDir = normalize(local_pos + vec2(1e-4));
#endif
    float lightAlignment = max(dot(outwardDir, shadowDir), 0.0);



    float dirRadius    = 0.85 + lightAlignment * 0.15;
    float dirIntensity = 0.85 + lightAlignment * 0.15;


    float maxRadius = max(shadow_max_radius, 5.0);
    float effectiveRadius    = min(shadow_radius * dirRadius, maxRadius);



    float radiusEnable = smoothstep(0.0, 0.75, shadow_radius);
    float effectiveIntensity = shadow_intensity * dirIntensity * radiusEnable;



    float safeRadius = max(effectiveRadius, 0.001);





    float shadow_t = clamp(d / safeRadius, 0.0, 1.0);
    float edgeShadow = 0.18 * erfcPositive(shadow_t * 2.619) +
        1.17 * erfcPositive(shadow_t * 0.895);
    float shadowWindow = 1.0 - shadow_t * shadow_t;
    shadowWindow = shadowWindow * shadowWindow * shadowWindow;


    float shadowAlpha = clamp(
        edgeShadow * shadowWindow * outsideMask * effectiveIntensity,
        0.0, 1.0
    );



    if (shadowAlpha > 0.0)
        shadowAlpha = max(shadowAlpha + ditherLSB(pixel_coord + vec2(37.0, 17.0)), 0.0);

    if (multi_region_mode > 0.5) {
        shadowAlpha = 0.0;
    }

    if (debug_view > 0.5) {


        float dbgShadow = (debug_view < 1.5) ? pow(shadowAlpha, 0.35) : shadowAlpha;
        float dbgInside = (debug_view < 1.5) ? pow(insideMask, 0.35) : insideMask;
        cogl_color_out = vec4(dbgShadow, dbgInside, 0.0, 1.0) * cogl_color_in;
        return;
    }

    vec3 shadowColor = vec3(0.03, 0.04, 0.08);

#ifdef LG_SHAPE_TEXTURE
    vec2 gradH = shapeHeightGradient(local_pos, box_size, max_z, resolution);
#else
    vec2 gradH = heightGradient(local_pos, box_size, corner, lensBand, max_z * lensScale, resolution);
#endif
    vec3 normal = getNormal(gradH);

    vec2 disp = getDisplacement(d, normal, resolution);






    float bevelPx = lensBand;
    float depthPx = max(-d, 0.0);
    float edgeT = clamp(1.0 - depthPx / bevelPx, 0.0, 1.0);

    float lensShape = pow(edgeT, EDGE_LENS_FALLOFF);

    vec2 dispPx = disp * resolution * lensShape * lensScale;
    float dispLenPx = length(dispPx);
    vec2 dispDirPx = dispPx / max(dispLenPx, 1.0e-4);
    if (dispLenPx > EDGE_LENS_REACH) {
        dispLenPx = EDGE_LENS_REACH;
        dispPx = dispDirPx * EDGE_LENS_REACH;
    }

    disp = dispPx / max(resolution, vec2(1.0));





    float shapeRate = EDGE_LENS_FALLOFF * pow(edgeT, EDGE_LENS_FALLOFF - 1.0) / bevelPx;
    float footprintPx = 2.0 * dispLenPx * (shapeRate + 1.0 / bevelPx);
    vec2 footprintExt = (footprintPx > 2.0 && edge_taps_enabled > 0.5)
        ? dispDirPx * (min(footprintPx, 64.0) * 0.5) / resolution
        : vec2(0.0);

    vec2 refractedUv = stabilizedUV(uv + disp, uv);




    vec2 chromaVec = disp * clamp(chroma_strength, 0.0, 1.0);
    vec2 uvG = refractedUv;



    vec2 chromaPx = chromaVec * resolution;
    bool chromaActive = dot(chromaPx, chromaPx) > 1.0e-4;


    float edgeProximity = 1.0 - smoothstep(0.0, edgeFeather * 4.0, -d);
    float aa_spread = mix(0.75, 2.5, edgeProximity);
    vec2 texel = vec2(aa_spread) / resolution;

    vec3 refractedRgb;
    if (chromaActive) {
        vec2 uvR = stabilizedUV(refractedUv - chromaVec, refractedUv);
        vec2 uvB = stabilizedUV(refractedUv + chromaVec, refractedUv);

        refractedRgb = vec3(
            sampleBackdrop(uvR, footprintExt, texel, resolution).r,
            sampleBackdrop(uvG, footprintExt, texel, resolution).g,
            sampleBackdrop(uvB, footprintExt, texel, resolution).b
        );
    } else {
        refractedRgb = sampleBackdrop(uvG, footprintExt, texel, resolution);
    }

    vec3 adjustedRefracted = applySCB(refractedRgb, brightness, contrast, saturation);
    vec3 refracted = adjustedRefracted;



    vec3 insideBaseColor = mix(refracted, activeTint, activeBaseStrength);
    insideBaseColor = mix(insideBaseColor, vec3(tint_r, tint_g, tint_b), tint_strength);

    // Not multiplied by insideMask: the final composite applies the coverage

    vec3 baseColor = insideBaseColor;

#ifdef LG_SHAPE_TEXTURE


    float whiteFrost = mix(0.45, 0.70, clamp(-d / max(lensBand, 1.0), 0.0, 1.0));
    baseColor = mix(baseColor, vec3(1.0, 1.0, 1.0), whiteFrost);
#endif



    float aoMask = 1.0 - smoothstep(0.0, max(ao_radius, 0.001), -d);

    vec3 lightDir = normalize(vec3(cos(lightAngleRad), sin(lightAngleRad), 0.38));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    float response = 1.0;



    float safeRimWidth = max(rim_width, 0.001);
    float edgeBand = (1.0 - smoothstep(0.0, safeRimWidth, abs(d))) * step(0.0005, rim_width);

    float rimDot = 1.0 - max(dot(normal, viewDir), 0.0);
    float rimFresnel = pow(max(rimDot, 0.0), max(rim_power, 0.001));
    float lightMask = pow(abs(dot(normal, lightDir)), max(rim_directional_power, 1.0));



    float aoLight = mix(1.0, 1.0 - lightMask, surface_light_enabled);
    baseColor *= (1.0 - aoMask * ao_intensity * aoLight);

    float rimShape = mix(pow(edgeBand, 0.85), rimFresnel, 0.55) * edgeBand;
    float finalRimLight = rimShape * lightMask * rim_intensity * rim_light_color_intensity;
    finalRimLight *= response;

    float specularDot = max(dot(reflectDir, viewDir), 0.0);
    float specularLight = pow(specularDot, max(shininess, 1.0));
    specularLight *= specular_intensity * response;
    float specMask = mix(0.25, 1.0, insideMask) * clamp(edgeBand + insideMask * 0.65, 0.0, 1.0);
    specularLight *= specMask;

    float idleRim = edgeBand * 0.008;

    float sheenFacing = max(dot(normal, lightDir), 0.0);
    float surfaceSheen = pow(sheenFacing, 1.65);
    surfaceSheen *= mix(1.0, 0.55, edgeBand);
    float sheenLight = surfaceSheen * sheen_intensity;

    float alpha = insideMask;

    float addedLight = (specularLight + finalRimLight + idleRim + sheenLight) * surface_light_enabled;
#ifdef LG_SHAPE_TEXTURE

    addedLight += 0.25 * surface_light_enabled;
#endif



    vec3 litColor = baseColor + addedLight - (baseColor * addedLight);



    float maxChannel = max(litColor.r, max(litColor.g, litColor.b));
    if (maxChannel > 1.0) {
        litColor /= maxChannel;
    }
    litColor = max(litColor, 0.0);


    if (highlight_backdrop_color > 0.5 && addedLight > 0.0 && alpha > 0.0)
        litColor = backdropHighlight(baseColor, litColor, addedLight);


    // is blended here; the outer one is the glass's own coverage.
    if (outline_width > 0.0) {
        float outlineMask = smoothstep(-outline_width - 0.5, -outline_width + 0.5, d);
        litColor = mix(litColor, vec3(outline_r, outline_g, outline_b), outlineMask);
    }


    // of src.a, so a colour emitted at zero coverage would tint the whole

    float shadowContribution = shadowAlpha * (1.0 - alpha);
    vec3 finalRgb   = litColor * alpha + shadowColor * shadowContribution;
    float finalAlpha = alpha + shadowContribution;

    // Scaled by the coverage to keep the colour premultiplied.
    finalRgb = max(finalRgb + ditherLSB(pixel_coord) * finalAlpha, 0.0);

    cogl_color_out = vec4(finalRgb, finalAlpha) * cogl_color_in;
}
