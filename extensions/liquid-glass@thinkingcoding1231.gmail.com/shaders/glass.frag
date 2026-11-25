// shaders/glass.frag & LQ-OPTIMIZED.frag
// High-Performance Physical Liquid Glass Shader
// macW1Y Project - Optimized Physical Pipeline:
// 1. Hardware-interpolated Cogl UV & analytical SDF geometry
// 2. High-speed interior flat-glass fast-path (depth >= 0.999) with single-tap sampling
// 3. Physical Snell's law refraction & directional rim lighting on bevel borders
// 4. Safe sub-rectangle blur buffer coordinate mapping (blurUV)
// 5. Native support for rounded rectangles, circles, capsules, popovers with arrows, and multi-region tiles.

uniform sampler2D cogl_sampler0;
uniform sampler2D cogl_sampler1;

uniform float resolution_x;
uniform float resolution_y;
uniform float pointer_x;
uniform float pointer_y;
uniform float intensity;
uniform float corner_radius;
uniform float max_z;
uniform float displacement_scale;
uniform float edge_smoothing;
uniform float profile_shape_n;
uniform float ior;
uniform float chroma_strength;
uniform float blur_strength;
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
uniform float surface_light_enabled;
uniform float ao_intensity;
uniform float ao_radius;
uniform float light_angle_deg;
uniform float mouse_radius;
uniform float bg_glow_intensity;
uniform float shadow_radius;
uniform float shadow_intensity;
uniform float shadow_max_radius;
uniform float padding;
uniform float isDock;
uniform float shape_type;

uniform float blur_rect_x;
uniform float blur_rect_y;
uniform float blur_rect_w;
uniform float blur_rect_h;
uniform float early_exit_enabled;
uniform float debug_view;

uniform float outline_width;
uniform float outline_r;
uniform float outline_g;
uniform float outline_b;
uniform float highlight_backdrop_color;
uniform float corner_smoothing;
uniform float corner_smoothing_enabled;
uniform float blur_tex_w;
uniform float blur_tex_h;
uniform float edge_taps_enabled;
uniform float shape_range;
uniform float shape_band;

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

uniform float panel_bg_r;
uniform float panel_bg_g;
uniform float panel_bg_b;
uniform float panel_bg_a;
uniform float panel_rect_x;
uniform float panel_rect_y;
uniform float panel_rect_w;
uniform float panel_rect_h;

uniform float region_x[MAX_GLASS_REGIONS];
uniform float region_y[MAX_GLASS_REGIONS];
uniform float region_w[MAX_GLASS_REGIONS];
uniform float region_h[MAX_GLASS_REGIONS];
uniform float region_tint_r[MAX_GLASS_REGIONS];
uniform float region_tint_g[MAX_GLASS_REGIONS];
uniform float region_tint_b[MAX_GLASS_REGIONS];
uniform float region_base_strength[MAX_GLASS_REGIONS];

uniform float arrow_side;
uniform float arrow_origin;
uniform float arrow_base;
uniform float arrow_rise;
uniform float arrow_radius;
uniform float arrow_fillet;

// Safe sub-rectangle blur texture UV coordinate mapper
vec2 blurUV(vec2 fullUV, vec2 resolution) {
    if (blur_rect_w < 1.0 || blur_rect_h < 1.0) {
        vec2 mFull = vec2(1.2) / max(resolution, vec2(1.0));
        return clamp(fullUV, mFull, vec2(1.0) - mFull);
    }
    vec2 size = vec2(blur_rect_w, blur_rect_h);
    vec2 m = vec2(1.2) / size;
    return clamp((fullUV * resolution - vec2(blur_rect_x, blur_rect_y)) / size,
                 m, vec2(1.0) - m);
}

#define SAFE(u) blurUV(u, resolution)

vec2 stabilizedUV(vec2 candidate, vec2 fallback) {
    vec2 clamped = clamp(candidate, vec2(0.001), vec2(0.999));
    float edgeDist = min(min(candidate.x, candidate.y), min(1.0 - candidate.x, 1.0 - candidate.y));
    float keep = smoothstep(-0.04, 0.03, edgeDist);
    return mix(fallback, clamped, keep);
}

float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

vec2 sdRoundRectDir(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    if (max(q.x, q.y) < 0.0) {
        return (q.x > q.y) ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    }
    return sign(p) * normalize(max(q, 0.0) + vec2(1e-6));
}

float sdShape(vec2 p, vec2 b, float r, float shape) {
    if (isDock > 0.5) {
        return sdRoundRect(p, b, r);
    }
    if (shape > 1.5) {
        return sdRoundRect(p, b, min(b.x, b.y));
    } else if (shape > 0.5) {
        return length(p) - min(b.x, b.y);
    }
    return sdRoundRect(p, b, r);
}

vec2 sdShapeDir(vec2 p, vec2 b, float r, float shape) {
    if (isDock > 0.5) {
        return sdRoundRectDir(p, b, r);
    }
    if (shape > 1.5) {
        return sdRoundRectDir(p, b, min(b.x, b.y));
    } else if (shape > 0.5) {
        return (length(p) > 1e-4) ? normalize(p) : vec2(0.0, 1.0);
    }
    return sdRoundRectDir(p, b, r);
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
    vec2 v0 = p - p0,  v1 = p - p1,  v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdPopover(vec2 p, vec2 b, float r, float side, float origin, float baseW, float rise, float tipR, float fillet) {
    float d_box = sdRoundRect(p, b, r);
    if (side < 0.5 || rise <= 0.0) {
        return d_box;
    }

    vec2 pt;
    vec2 ob;
    if (side < 1.5) {
        pt = vec2(p.x, -p.y);
        ob = b;
    } else if (side < 2.5) {
        pt = vec2(p.y, p.x);
        ob = vec2(b.y, b.x);
    } else if (side < 3.5) {
        pt = p;
        ob = b;
    } else {
        pt = vec2(p.y, -p.x);
        ob = vec2(b.y, b.x);
    }

    vec2 q = vec2(pt.x - origin, pt.y - ob.y);
    float half_w = max(baseW * 0.5, 1.0);
    float safeFillet = max(fillet, 1.0);
    float sunken = max(safeFillet * 1.5, 8.0);
    float safeTip = clamp(tipR, 0.1, rise * 0.5);

    float d_tri = sdTriangle(q, vec2(-half_w, -sunken), vec2(0.0, rise - safeTip), vec2(half_w, -sunken)) - safeTip;
    return smin(d_box, d_tri, safeFillet);
}

vec2 sdPopoverDir(vec2 p, vec2 b, float r, float side, float origin, float baseW, float rise, float tipR, float fillet) {
    if (side < 0.5 || rise <= 0.0) {
        return sdRoundRectDir(p, b, r);
    }
    float eps = 1.0;
    float dx = sdPopover(p + vec2(eps, 0.0), b, r, side, origin, baseW, rise, tipR, fillet) -
               sdPopover(p - vec2(eps, 0.0), b, r, side, origin, baseW, rise, tipR, fillet);
    float dy = sdPopover(p + vec2(0.0, eps), b, r, side, origin, baseW, rise, tipR, fillet) -
               sdPopover(p - vec2(0.0, eps), b, r, side, origin, baseW, rise, tipR, fillet);
    vec2 grad = vec2(dx, dy);
    float len = length(grad);
    return (len > 1e-4) ? (grad / len) : sdRoundRectDir(p, b, r);
}

float findActiveRegion(vec2 pixel_coord, float pad, out vec2 outLocalPos, out vec2 outBoxSize, out vec3 outTint, out float outBaseStrength) {
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

        float d = sdShape(rLocal, rBox, corner_radius, shape_type);
        if (d < bestD) {
            bestD = d;
            outLocalPos = rLocal;
            outBoxSize = rBox;
            outTint = vec3(region_tint_r[i], region_tint_g[i], region_tint_b[i]);
            outBaseStrength = region_base_strength[i];
        }
    }

    return bestD;
}

vec4 panelFallback(vec2 pixel_coord, float coveredAlpha) {
    if (panel_bg_a <= 0.001) return vec4(0.0);
    vec2 panelCenter = vec2(panel_rect_x, panel_rect_y) + vec2(panel_rect_w, panel_rect_h) * 0.5;
    vec2 panelLocal = pixel_coord - panelCenter;
    vec2 panelBox = max(vec2(panel_rect_w, panel_rect_h) * 0.5, vec2(1.0));
    float panelDist = sdShape(panelLocal, panelBox, corner_radius, shape_type);
    float panelMask = 1.0 - smoothstep(-1.0, 1.0, panelDist);

    float contribution = panel_bg_a * (1.0 - coveredAlpha) * panelMask;
    return vec4(vec3(panel_bg_r, panel_bg_g, panel_bg_b) * contribution, contribution);
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
    if (resolution.x <= 1.0 || resolution.y <= 1.0) {
        discard;
    }

    vec2 uv = cogl_tex_coord_in[0].st;
    vec2 pixel_coord = uv * resolution;
    vec2 screenUv = uv;

    float edgeFeather = max(edge_smoothing, 0.75);

    vec2 local_pos;
    vec2 box_size;
    vec3 activeTint;
    float activeBaseStrength = 0.0;
    float d;

    if (multi_region_mode > 0.5 && region_count > 0.5) {
        d = findActiveRegion(pixel_coord, padding, local_pos, box_size, activeTint, activeBaseStrength);
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

        d = sdPopover(local_pos, box_size, corner_radius, arrow_side, arrow_origin, arrow_base, arrow_rise, arrow_radius, arrow_fillet);
        activeTint = vec3(tint_r, tint_g, tint_b);
    }

    // 1. FAST EARLY EXIT: outside shape and outer drop shadow bounds
    float effShadowRad = (multi_region_mode > 0.5) ? 0.0 : max(min(shadow_radius, shadow_max_radius), 2.0);
    float exitReach = max(effShadowRad + 2.0, edgeFeather);

    if (early_exit_enabled > 0.5 && debug_view < 0.5 && d >= exitReach) {
        vec4 pFb = panelFallback(pixel_coord, 0.0);
        if (pFb.a > 0.001) {
            cogl_color_out = pFb * cogl_color_in;
        } else {
            discard;
        }
        return;
    }

    float insideMask = 1.0 - smoothstep(-edgeFeather, edgeFeather, d);

    // 2. FAST SHADOW (Outside the glass body)
    float shadowContribution = 0.0;
    if (d > -edgeFeather && shadow_intensity > 0.001 && multi_region_mode < 0.5) {
        float st = clamp(d / effShadowRad, 0.0, 1.0);
        float sEase = (1.0 - st) * (1.0 - st);
        shadowContribution = sEase * shadow_intensity * 0.75 * (1.0 - insideMask);
    }

    if (insideMask <= 0.001) {
        vec4 pFb = panelFallback(pixel_coord, 0.0);
        if (shadowContribution > 0.001) {
            vec3 sColor = mix(pFb.rgb, vec3(0.0), shadowContribution);
            float sAlpha = max(pFb.a, shadowContribution);
            cogl_color_out = vec4(sColor, sAlpha) * cogl_color_in;
        } else if (pFb.a > 0.001) {
            cogl_color_out = pFb * cogl_color_in;
        } else {
            discard;
        }
        return;
    }

    // 3. FAST-PATH: Interior flat glass surface (depth >= 0.999)
    float minBoxDim = max(min(box_size.x, box_size.y), 1.0);
    float elemScale = clamp(minBoxDim / 110.0, 0.20, 1.0);
    float depthReach = (shape_type > 0.5 && isDock < 0.5) ? minBoxDim : corner_radius;
    float maxSafeBevel = max(minBoxDim * 0.36, 3.0);
    float bevelWidth = clamp(max_z * 0.75 + depthReach * 0.2, 4.0, min(28.0, maxSafeBevel));
    float interiorThreshold = max(bevelWidth + edgeFeather, max(ao_radius, rim_width));

    if (early_exit_enabled > 0.5 && debug_view < 0.5 && -d >= interiorThreshold) {
        vec4 fTap = texture2D(cogl_sampler1, SAFE(screenUv));
        vec3 flatRgb = fTap.rgb;
        float fAlpha = fTap.a;
        if (fAlpha < 0.20) {
            vec3 fallbackBg = mix(vec3(0.12, 0.12, 0.14), activeTint, activeBaseStrength);
            flatRgb = mix(fallbackBg, flatRgb, clamp(fAlpha / 0.20, 0.0, 1.0));
        }

        flatRgb = applySCB(flatRgb, brightness, contrast, saturation);
        flatRgb = mix(flatRgb, activeTint, activeBaseStrength);
        flatRgb = mix(flatRgb, vec3(tint_r, tint_g, tint_b), tint_strength);

        vec3 lightDirFlat = normalize(vec3(cos(radians(light_angle_deg)),
                                           sin(radians(light_angle_deg)), 0.38));
        float facing = max(lightDirFlat.z, 0.0);
        float specFlat = pow(facing, max(shininess, 1.0)) * specular_intensity * 0.65;
        float sheenFlat = pow(facing, 1.65) * sheen_intensity;
        vec3 addedFlat = vec3(specFlat + sheenFlat) * surface_light_enabled;

        vec3 litFlat = flatRgb + addedFlat - (flatRgb * addedFlat);
        float maxChannelFlat = max(litFlat.r, max(litFlat.g, litFlat.b));
        if (maxChannelFlat > 1.0) {
            litFlat /= maxChannelFlat;
        }
        litFlat = max(litFlat, 0.0);

        cogl_color_out = vec4(litFlat, 1.0) * cogl_color_in;
        return;
    }

    // 4. BEVEL & PHYSICAL SNELL REFRACTION
    vec2 normal2D = (multi_region_mode > 0.5)
        ? sdShapeDir(local_pos, box_size, corner_radius, shape_type)
        : sdPopoverDir(local_pos, box_size, corner_radius, arrow_side, arrow_origin, arrow_base, arrow_rise, arrow_radius, arrow_fillet);

    float depth = clamp(-d / bevelWidth, 0.0, 1.0);
    float u = 1.0 - depth;
    float nPower = clamp(profile_shape_n * 0.45, 2.0, 5.0);
    float slope = pow(u, nPower) * 0.85;
    float sinA = sin(slope);
    float cosA = cos(slope);
    vec3 normal = vec3(normal2D * sinA, cosA);

    vec3 viewDir = vec3(0.0, 0.0, -1.0);
    float effIor = max(ior, 1.001);
    vec3 refractedRay = refract(viewDir, normal, 1.0 / effIor);

    float minRes = max(min(resolution.x, resolution.y), 1.0);
    float effDispScale = displacement_scale * elemScale;
    float thicknessNorm = effDispScale / minRes;
    float safe_z = max(-refractedRay.z, 0.25);
    float edgeDampen = smoothstep(0.0, edgeFeather * 2.5, -d);
    vec2 dispVec = (refractedRay.xy / safe_z) * thicknessNorm * edgeDampen;

    float maxDispUV = (minBoxDim * 0.32) / minRes;
    float dispLen = length(dispVec);
    if (dispLen > maxDispUV && dispLen > 0.00001) {
        dispVec *= (maxDispUV / dispLen);
    }

    vec2 refrUv = (effDispScale > 0.001) ? stabilizedUV(screenUv + dispVec, screenUv) : screenUv;

    vec4 refrColor;
    if (chroma_strength > 0.0001 && length(dispVec) > 0.00001) {
        vec2 chromaOffset = normal2D * ((chroma_strength * elemScale) / minRes) * edgeDampen;
        float rCol = texture2D(cogl_sampler1, SAFE(stabilizedUV(refrUv + chromaOffset, refrUv))).r;
        vec4 gCol  = texture2D(cogl_sampler1, SAFE(refrUv));
        float bCol = texture2D(cogl_sampler1, SAFE(stabilizedUV(refrUv - chromaOffset, refrUv))).b;
        refrColor = vec4(rCol, gCol.g, bCol, gCol.a);
    } else {
        refrColor = texture2D(cogl_sampler1, SAFE(refrUv));
    }

    if (refrColor.a < 0.20) {
        vec4 centerTap = texture2D(cogl_sampler1, SAFE(screenUv));
        vec3 fallbackBg = (centerTap.a > 0.20)
            ? centerTap.rgb
            : mix(vec3(0.12, 0.12, 0.14), activeTint, activeBaseStrength);
        refrColor.rgb = mix(fallbackBg, refrColor.rgb, clamp(refrColor.a / 0.20, 0.0, 1.0));
    }

    // 5. COLOR CORRECTIONS & TINT
    vec3 baseColor = applySCB(refrColor.rgb, brightness, contrast, saturation);
    baseColor = mix(baseColor, activeTint, activeBaseStrength);
    baseColor = mix(baseColor, vec3(tint_r, tint_g, tint_b), tint_strength);

    float aoRadius = max(ao_radius, 4.0);
    float aoBand = 1.0 - smoothstep(0.0, aoRadius, -d);
    float ao = 1.0 - aoBand * (ao_intensity * 0.45);
    baseColor *= ao;

    // 6. PHYSICAL RIM LIGHT & SPECULAR GLINT
    float lightRad = radians(light_angle_deg);
    vec3 lightDir = normalize(vec3(cos(lightRad), sin(lightRad), 0.38));

    float rimDot = 1.0 - max(normal.z, 0.0);
    float rimFresnel = pow(rimDot, max(rim_power, 1.0));
    float nDotL = max(dot(normal, lightDir), 0.0);
    float lightMask = pow(nDotL, max(rim_directional_power, 1.0));

    float edgeBand = 1.0 - depth;
    float finalRim = rimFresnel * lightMask * (rim_intensity * 1.5) * edgeBand * surface_light_enabled;
    float sheen = pow(nDotL, 2.0) * sheen_intensity * 0.4 * surface_light_enabled;

    float touchGlow = 0.0;
    if (pointer_x >= 0.0 && pointer_y >= 0.0 && intensity > 0.0) {
        float touchDist = length(pixel_coord - vec2(pointer_x, pointer_y));
        touchGlow = exp(-0.5 * (touchDist * touchDist) / (mouse_radius * mouse_radius * 4.0)) * intensity * 0.35;
    }

    vec3 addedLight = vec3(finalRim + sheen + touchGlow);
    vec3 litColor = baseColor + addedLight - (baseColor * addedLight);

    float maxChannel = max(litColor.r, max(litColor.g, litColor.b));
    if (maxChannel > 1.0) {
        litColor /= maxChannel;
    }
    litColor = max(litColor, 0.0);

    if (outline_width > 0.0) {
        float outlineMask = smoothstep(-outline_width - 0.5, -outline_width + 0.5, d);
        litColor = mix(litColor, vec3(outline_r, outline_g, outline_b), outlineMask);
    }

    vec3 finalRgb = litColor * insideMask;
    float finalAlpha = insideMask + shadowContribution * (1.0 - insideMask);

    cogl_color_out = vec4(finalRgb, finalAlpha) * cogl_color_in;
}
