
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



// Looking Glass via global._lgGlass.earlyExit(false) so a suspected rendering



uniform float early_exit_enabled;




//         RED   = shadowAlpha  (the drop shadow's own coverage)






// global._lgGlass.debugView(1). Disables the early exits while active so the

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



float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
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


float normalizedDepth(float d, vec2 b, float r) {

    float maxDepth = (shape_type > 0.5 && isDock < 0.5) ? max(min(b.x, b.y), 1.0) : max(r, 1.0);

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


float getHeight(vec2 p, vec2 b, float r, float zScale) {
    float d = (multi_region_mode > 0.5) ? sdShape(p, b, r, shape_type) : sdPopover(p, b, r, arrow_side, arrow_origin, arrow_base, arrow_rise, arrow_radius, arrow_fillet);







    float smoothZone = max(edge_smoothing, 1.0);
    if (d > smoothZone)
        return 0.0;

    float t = normalizedDepth(d, b, r);
    float h = profileHeight(t, zScale);



    float fade = 1.0 - smoothstep(-smoothZone, smoothZone, d);
    return h * fade;
}


float gradientStep(vec2 resolution) {
    float minRes = max(min(resolution.x, resolution.y), 1.0);
    return clamp(minRes / 560.0, 0.45, 1.20);
}




vec2 sdRoundRectDir(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    if (max(q.x, q.y) < 0.0) {

        return (q.x > q.y) ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    }

    return sign(p) * normalize(max(q, 0.0) + vec2(1e-6));
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


vec2 sdPopoverDir(vec2 p, vec2 b, float r, float side, float origin, float baseW, float rise, float tipR, float fillet) {
    if (side < 0.5 || rise <= 0.0) {
        return sdRoundRectDir(p, b, r);
    }
    float eps = 0.5;
    float dx = sdPopover(p + vec2(eps, 0.0), b, r, side, origin, baseW, rise, tipR, fillet)
             - sdPopover(p - vec2(eps, 0.0), b, r, side, origin, baseW, rise, tipR, fillet);
    float dy = sdPopover(p + vec2(0.0, eps), b, r, side, origin, baseW, rise, tipR, fillet)
             - sdPopover(p - vec2(0.0, eps), b, r, side, origin, baseW, rise, tipR, fillet);
    return normalize(vec2(dx, dy) + vec2(1e-6));
}


vec2 heightGradient(vec2 p, vec2 b, float r, float zScale, vec2 resolution) {
    vec2 dir = (multi_region_mode > 0.5) ? sdShapeDir(p, b, r, shape_type) : sdPopoverDir(p, b, r, arrow_side, arrow_origin, arrow_base, arrow_rise, arrow_radius, arrow_fillet);
    float e = gradientStep(resolution);

    float hOut = getHeight(p + dir * e, b, r, zScale);
    float hIn  = getHeight(p - dir * e, b, r, zScale);

    return dir * ((hOut - hIn) / (2.0 * e));
}


vec3 getNormal(vec2 gradH) {
    return normalize(vec3(-gradH.x, -gradH.y, 1.0));
}


vec2 getDisplacement(float d, vec3 normal, vec2 resolution) {
    if (d > 0.0)
        return vec2(0.0);


    vec3 viewDir = vec3(0.0, 0.0, -1.0);


    float eta = 1.0 / max(ior, 1.001);
    vec3 refractedRay = refract(viewDir, normal, eta);


    if (length(refractedRay) < 0.0001)
        return vec2(0.0);

    float minRes = max(min(resolution.x, resolution.y), 1.0);
    float thicknessNorm = displacement_scale / minRes;



    float safe_z = max(-refractedRay.z, 0.15);
    vec2 displacement = (refractedRay.xy / safe_z) * thicknessNorm;
    float max_disp = 0.30;
    if (length(displacement) > max_disp) {
        displacement = normalize(displacement) * max_disp;
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
    if (blur_rect_w < 1.0 || blur_rect_h < 1.0) {
        vec2 mFull = vec2(1.2) / max(resolution, vec2(1.0));
        return clamp(fullUV, mFull, vec2(1.0) - mFull);
    }
    vec2 size = vec2(blur_rect_w, blur_rect_h);
    vec2 m = vec2(1.2) / size;
    return clamp((fullUV * resolution - vec2(blur_rect_x, blur_rect_y)) / size,
                 m, vec2(1.0) - m);
}


vec3 applySCB(vec3 color, float b, float c, float s) {

    color *= b;


    color = mix(vec3(0.5), color, c);



    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, s);


    return max(color, 0.0);
}










vec4 panelFallback(vec2 pixel_coord, float coveredAlpha) {
    vec2 panelCenter = vec2(panel_rect_x, panel_rect_y) + vec2(panel_rect_w, panel_rect_h) * 0.5;
    vec2 panelLocal = pixel_coord - panelCenter;
    vec2 panelBox = max(vec2(panel_rect_w, panel_rect_h) * 0.5, vec2(1.0));
    float panelDist = sdShape(panelLocal, panelBox, corner_radius, shape_type);
    float panelMask = 1.0 - smoothstep(-1.0, 1.0, panelDist);

    float contribution = panel_bg_a * (1.0 - coveredAlpha) * panelMask;
    return vec4(vec3(panel_bg_r, panel_bg_g, panel_bg_b) * contribution, contribution);
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
    float d;

    if (multi_region_mode > 0.5) {
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





































    float outsideTransition = smoothstep(-edgeFeather, edgeFeather, d);
    float insideMask = 1.0 - outsideTransition;
    float outsideMask = outsideTransition;
























    float shadowReach = (multi_region_mode > 0.5) ? 0.0 : max(shadow_max_radius, 5.0);
    if (early_exit_enabled > 0.5 && debug_view < 0.5 && d >= max(shadowReach, edgeFeather)) {
        cogl_color_out = panelFallback(pixel_coord, 0.0) * cogl_color_in;
        return;
    }






















    float smoothZoneEarly = max(edge_smoothing, 1.0);
    float depthReach = (shape_type > 0.5 && isDock < 0.5) ? min(box_size.x, box_size.y) : corner_radius;
    float interiorThreshold = max(
        max(depthReach + gradientStep(resolution) + smoothZoneEarly,
            edgeFeather * 4.0),
        max(ao_radius, rim_width));
    if (early_exit_enabled > 0.5 && debug_view < 0.5 && -d >= interiorThreshold) {


        vec2 uvFlat = stabilizedUV(uv, uv);



        vec2 texelFlat = vec2(0.75) / resolution;
        vec4 fTap1 = texture2D(cogl_sampler1, blurUV(uvFlat + vec2( 0.375, -0.125) * texelFlat, resolution));
        vec4 fTap2 = texture2D(cogl_sampler1, blurUV(uvFlat + vec2( 0.125,  0.375) * texelFlat, resolution));
        vec4 fTap3 = texture2D(cogl_sampler1, blurUV(uvFlat + vec2(-0.375,  0.125) * texelFlat, resolution));
        vec4 fTap4 = texture2D(cogl_sampler1, blurUV(uvFlat + vec2(-0.125, -0.375) * texelFlat, resolution));
        vec3 flatRgb = (fTap1.rgb + fTap2.rgb + fTap3.rgb + fTap4.rgb) * 0.25;
        float fAlpha = (fTap1.a + fTap2.a + fTap3.a + fTap4.a) * 0.25;
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




















    float lightAngleRad = radians(light_angle_deg);
    vec2 lightDir2D = vec2(cos(lightAngleRad), -sin(lightAngleRad));
    vec2 shadowDir   = -lightDir2D;



    vec2 outwardDir = normalize(local_pos + vec2(1e-4));



    float lightAlignment = max(dot(outwardDir, shadowDir), 0.0);




    float dirRadius    = 0.85 + lightAlignment * 0.15;
    float dirIntensity = 0.85 + lightAlignment * 0.15;











    float maxRadius = max(shadow_max_radius, 5.0);
    float effectiveRadius    = min(shadow_radius * dirRadius, maxRadius);









    float radiusEnable = smoothstep(0.0, 0.75, shadow_radius);
    float effectiveIntensity = shadow_intensity * dirIntensity * radiusEnable;








    float safeRadius = max(effectiveRadius, 0.001);



    float umbra_t = clamp(d / max(safeRadius * 0.40, 0.5), 0.0, 1.0);





    float umbraFade = 1.0 - umbra_t;
    float umbraEase = umbraFade * umbraFade * umbraFade *
        (umbraFade * (umbraFade * 6.0 - 15.0) + 10.0);
    float umbra  = umbraEase * 0.80;
















    float penumbra_t = clamp(d / safeRadius, 0.0, 1.0);
    float penumbraFade = 1.0 - penumbra_t;
    float penumbraEase = penumbraFade * penumbraFade * penumbraFade *
        (penumbraFade * (penumbraFade * 6.0 - 15.0) + 10.0);
    float penumbra = penumbraEase * 0.55;


    float shadowAlpha = clamp(
        (umbra + penumbra) * outsideMask * effectiveIntensity,
        0.0, 1.0
    );


























    float boundsFade = 1.0 - smoothstep(maxRadius * 0.85, maxRadius, d);



    float boundsMask = boundsFade * boundsFade * boundsFade *
        (boundsFade * (boundsFade * 6.0 - 15.0) + 10.0);
    shadowAlpha *= boundsMask;







    shadowAlpha *= 1.0 - step(maxRadius, d);



    // shadow-radius/shadow-intensity are shared global settings that other



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








    vec2 gradH = heightGradient(local_pos, box_size, corner_radius, max_z, resolution);
    vec3 normal = getNormal(gradH);

    vec2 disp = vec2(0.0);
    float edgeDampen = 0.0;
    if (displacement_scale > 0.001) {
        disp = getDisplacement(d, normal, resolution);
        edgeDampen = smoothstep(0.0, edgeFeather * 3.0, -d);
        disp *= edgeDampen;
    }

    vec2 refractedUv = (displacement_scale > 0.001) ? stabilizedUV(uv + disp, uv) : uv;
    vec2 uvG = refractedUv;

    vec2 chromaVec = vec2(0.0);
    bool chromaActive = false;
    if (chroma_strength > 0.0001 && length(disp) > 0.00001) {
        vec2 chromaDir = normalize(disp);
        chromaVec = chromaDir * (chroma_strength / resolution) * edgeDampen;
        vec2 chromaPx = chromaVec * resolution;
        chromaActive = dot(chromaPx, chromaPx) > 1.0e-4;
    }




    float edgeProximity = 1.0 - smoothstep(0.0, edgeFeather * 4.0, -d);
    float aa_spread = mix(0.75, 2.5, edgeProximity);
    vec2 texel = vec2(aa_spread) / resolution;

    vec2 off1 = vec2( 0.375, -0.125) * texel;
    vec2 off2 = vec2( 0.125,  0.375) * texel;
    vec2 off3 = vec2(-0.375,  0.125) * texel;
    vec2 off4 = vec2(-0.125, -0.375) * texel;






    #define SAFE(u) blurUV(u, resolution)


    vec3 refractedRgb;
    float sampledAlpha;
    if (chromaActive) {
        vec2 uvR = stabilizedUV(refractedUv + chromaVec, refractedUv);
        vec2 uvB = stabilizedUV(refractedUv - chromaVec, refractedUv);

        refractedRgb = vec3(
            (texture2D(cogl_sampler1, SAFE(uvR + off1)).r +
             texture2D(cogl_sampler1, SAFE(uvR + off2)).r +
             texture2D(cogl_sampler1, SAFE(uvR + off3)).r +
             texture2D(cogl_sampler1, SAFE(uvR + off4)).r) * 0.25,

            (texture2D(cogl_sampler1, SAFE(uvG + off1)).g +
             texture2D(cogl_sampler1, SAFE(uvG + off2)).g +
             texture2D(cogl_sampler1, SAFE(uvG + off3)).g +
             texture2D(cogl_sampler1, SAFE(uvG + off4)).g) * 0.25,

            (texture2D(cogl_sampler1, SAFE(uvB + off1)).b +
             texture2D(cogl_sampler1, SAFE(uvB + off2)).b +
             texture2D(cogl_sampler1, SAFE(uvB + off3)).b +
             texture2D(cogl_sampler1, SAFE(uvB + off4)).b) * 0.25
        );
        sampledAlpha = (texture2D(cogl_sampler1, SAFE(uvG + off1)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off2)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off3)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off4)).a) * 0.25;
    } else if (displacement_scale <= 0.001) {
        // Direct single-tap fetch when refraction is 0: massive GPU performance boost!
        refractedRgb = texture2D(cogl_sampler1, SAFE(uvG)).rgb;
        sampledAlpha = texture2D(cogl_sampler1, SAFE(uvG)).a;
    } else {
        refractedRgb = (texture2D(cogl_sampler1, SAFE(uvG + off1)).rgb +
                        texture2D(cogl_sampler1, SAFE(uvG + off2)).rgb +
                        texture2D(cogl_sampler1, SAFE(uvG + off3)).rgb +
                        texture2D(cogl_sampler1, SAFE(uvG + off4)).rgb) * 0.25;
        sampledAlpha = (texture2D(cogl_sampler1, SAFE(uvG + off1)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off2)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off3)).a +
                        texture2D(cogl_sampler1, SAFE(uvG + off4)).a) * 0.25;
    }
    if (sampledAlpha < 0.20) {
        vec3 fallbackBg = mix(vec3(0.12, 0.12, 0.14), activeTint, activeBaseStrength);
        refractedRgb = mix(fallbackBg, refractedRgb, clamp(sampledAlpha / 0.20, 0.0, 1.0));
    }


    vec3 adjustedRefracted = applySCB(refractedRgb, brightness, contrast, saturation);
    vec3 refracted = adjustedRefracted;

















    vec3 insideBaseColor = mix(refracted, activeTint, activeBaseStrength);
    if (tint_strength > 0.001) {
        insideBaseColor = mix(insideBaseColor, vec3(tint_r, tint_g, tint_b), tint_strength);
    }





















    vec3 baseColor = insideBaseColor;





























    if (ao_intensity > 0.001) {
        float aoMask = 1.0 - smoothstep(0.0, max(ao_radius, 0.001), -d);
        baseColor *= (1.0 - aoMask * ao_intensity);
    }

















    vec3 lightDir = normalize(vec3(cos(lightAngleRad), sin(lightAngleRad), 0.38));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    float response = 1.0;















    // -------------------------------------------------------------
    // Directional Glass Edge Highlights & Specular Borders
    // - Top and bottom: white borders, diffusing inward toward the center, fading before corners
    // - Left and right: translucent dark borders, diffusing inward, fading before corners
    // -------------------------------------------------------------
    vec2 outDir = (multi_region_mode > 0.5)
        ? sdShapeDir(local_pos, box_size, corner_radius, shape_type)
        : sdPopoverDir(local_pos, box_size, corner_radius, arrow_side, arrow_origin, arrow_base, arrow_rise, arrow_radius, arrow_fillet);

    float cornerFactor = clamp(2.0 * abs(outDir.x) * abs(outDir.y), 0.0, 1.0);
    float cornerSuppression = 1.0 - smoothstep(0.05, 0.65, cornerFactor);
    float horizWeight = abs(outDir.y);
    float vertWeight = abs(outDir.x);
    float isTop = clamp(-outDir.y, 0.0, 1.0);
    float isBottom = clamp(outDir.y, 0.0, 1.0);
    float edgeDist = abs(d);
    float inwardDist = max(-d, 0.0);

    // 1. White borders on top & bottom (crisp edge + inward blur toward center, suppressed at corners)
    float whiteWidth = 1.5;
    float whiteLine = 1.0 - smoothstep(0.0, whiteWidth, edgeDist);
    float inwardSheen = (1.0 - smoothstep(0.0, 5.2, inwardDist));
    inwardSheen = pow(inwardSheen, 1.2) * 0.19;

    float topIntensity = 0.48;
    float bottomIntensity = 0.28;
    float whiteIntensity = mix(bottomIntensity, topIntensity, isTop / max(horizWeight, 1e-4));
    float whiteFalloff = pow(horizWeight, 1.2);
    float whiteBorder = (whiteLine * 0.85 + inwardSheen) * whiteIntensity * whiteFalloff * cornerSuppression;

    // 2. Translucent dark borders on left & right (crisp edge + inward blur, suppressed at corners)
    float darkWidth = 1.2;
    float darkLine = 1.0 - smoothstep(0.0, darkWidth, edgeDist);
    float darkInwardSheen = (1.0 - smoothstep(0.0, 4.0, inwardDist));
    darkInwardSheen = pow(darkInwardSheen, 1.3) * 0.22;
    float darkIntensity = 0.28;
    float darkFalloff = pow(vertWeight, 1.35);
    float darkBorder = (darkLine * 0.75 + darkInwardSheen) * darkIntensity * darkFalloff * cornerSuppression;

    // Apply dark border directly to base glass color
    baseColor *= (1.0 - darkBorder * insideMask);

    float safeRimWidth = max(rim_width, 0.001);
    float edgeBand = (1.0 - smoothstep(0.0, safeRimWidth, abs(d))) * step(0.0005, rim_width);

    float finalRimLight = 0.0;
    if (rim_intensity > 0.001) {
        float rimDot = 1.0 - max(dot(normal, viewDir), 0.0);
        float rimFresnel = pow(max(rimDot, 0.0), max(rim_power, 0.001));
        float lightMask = pow(abs(dot(normal, lightDir)), max(rim_directional_power, 1.0));
        float rimShape = mix(pow(edgeBand, 0.85), rimFresnel, 0.55) * edgeBand;
        finalRimLight = rimShape * lightMask * rim_intensity * rim_light_color_intensity * 0.4 * response;
    }

    float specularLight = 0.0;
    if (specular_intensity > 0.001) {
        float specularDot = max(dot(reflectDir, viewDir), 0.0);
        specularLight = pow(specularDot, max(shininess, 1.0)) * specular_intensity * response;
        float specMask = mix(0.25, 1.0, insideMask) * clamp(edgeBand + insideMask * 0.65, 0.0, 1.0);
        specularLight *= specMask;
    }

    float idleRim = edgeBand * 0.005;

    vec3 sheenColor = vec3(0.0);
    if (sheen_intensity > 0.001) {
        float sheenFacing = max(dot(normal, lightDir), 0.0);
        float surfaceSheen = pow(sheenFacing, 1.65);
        surfaceSheen *= mix(1.0, 0.55, edgeBand);
        sheenColor = vec3(1.0) * surfaceSheen * sheen_intensity;
    }

    float alpha = insideMask;

    vec3 glassWhiteHighlight = vec3(whiteBorder) * insideMask;
    vec3 addedLight = (vec3(specularLight + finalRimLight + idleRim) + sheenColor + glassWhiteHighlight) * surface_light_enabled;

    vec3 litColor = baseColor + addedLight - (baseColor * addedLight);


    if (pointer_x >= 0.0 && pointer_y >= 0.0 && intensity > 0.0) {
        vec2 touchPos = vec2(pointer_x, pointer_y);
        float touchDist = length(gl_FragCoord.xy - touchPos);
        float touchRadius = max(mouse_radius, 45.0);
        float touchGlow = exp(-0.5 * (touchDist * touchDist) / (touchRadius * touchRadius)) * intensity * 0.45;
        litColor += vec3(touchGlow) * insideMask;
    }




    float maxChannel = max(litColor.r, max(litColor.g, litColor.b));
    if (maxChannel > 1.0) {
        litColor /= maxChannel;
    }

    litColor = max(litColor, 0.0);





    // must already be multiplied by its coverage, otherwise any non-zero color
    // at zero coverage leaks as a constant tint across the whole actor.









    // At zero total coverage this is exactly vec4(0) -> no rectangle.
    float shadowContribution = shadowAlpha * (1.0 - alpha);
    vec3 finalRgb   = litColor * alpha + shadowColor * shadowContribution;
    float finalAlpha = alpha + shadowContribution;


















    vec4 panelTerm = panelFallback(pixel_coord, finalAlpha);
    finalRgb += panelTerm.rgb;
    finalAlpha += panelTerm.a;


    cogl_color_out = vec4(finalRgb, finalAlpha) * cogl_color_in;
}
