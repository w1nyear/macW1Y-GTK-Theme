
// plates as distance fields and the symbol's coverage, on a square of


























import { plateColor, shapeDistance, symbolLayer, withoutPlates } from './iconAnalysis.js';
export const MAP_SIZE = 256;
export const MAP_RANGE = 16;
export const LENS_SIZE = 128;
export const LENS_RANGE = 128;



const OUTER_HALF = 0.46;
const OUTER_EXPONENT = 4;


const CONTENT_REACH = 0.74;


const SQUARE_ASPECT = 0.08;
const SQUARE_FILL = 0.72;
const SQUARE_EXPONENT = 3.5;


const CORNER_SMOOTHING = 0.5;

const SQUARE_RADIUS = 0.62;
const OUTSIDE_SHARE = 0.03;


const SLIVER_WIDTH = 2.5;
const SLIVER_INSIDE = 0.1;


const TONE_GAIN = 2.5;
const SURFACE_GAIN = 5;

function smoothCorners(shape) {
    if (shape.kind !== 'roundrect')
        return shape;
    const half = Math.min(shape.rx, shape.ry);
    const r = Math.min(shape.radius, half);
    const k = Math.min(1 + CORNER_SMOOTHING, Math.max(half / Math.max(r, 1e-3), 1));

    return { ...shape, radius: r * k, corner: -1 / Math.log2(1 - 0.29289322 / k) };
}

function isSquare(shape, width) {
    const roundEnough = shape.kind === 'roundrect' ? shape.radius <= Math.min(shape.rx, shape.ry) * SQUARE_RADIUS
        : shape.exponent >= SQUARE_EXPONENT;
    return roundEnough && !shape.ripple && Math.abs(shape.rx - shape.ry) <= Math.max(shape.rx, shape.ry) * SQUARE_ASPECT &&
        Math.min(shape.rx, shape.ry) * 2 >= width * SQUARE_FILL;
}


function outsideShare(pixels, scale, shape) {
    let outside = 0, total = 0;
    for (let i = 0; i < pixels.width * pixels.height; i++) {
        const a = pixels.data[i * 4 + 3];
        if (!a)
            continue;
        total += a;
        if (shapeDistance(shape, (i % pixels.width + 0.5) * scale, (Math.floor(i / pixels.width) + 0.5) * scale) > 1)
            outside += a;
    }
    return total ? outside / total : 0;
}

function dropSliver(symbol, pixels, scale, shape) {
    const { width: w, height: h } = pixels;
    const reach = Math.ceil(1.5 / scale);
    const outside = (i) => shapeDistance(shape, (i % w + 0.5) * scale, (Math.floor(i / w) + 0.5) * scale);
    const drop = [];
    for (let i = 0; i < symbol.length; i++) {
        if (!symbol[i] || outside(i) <= 0 || outside(i) > SLIVER_WIDTH)
            continue;
        const x = i % w, y = Math.floor(i / w);
        let inside = 0;
        for (let v = Math.max(0, y - reach); v <= Math.min(h - 1, y + reach); v++) {
            for (let u = Math.max(0, x - reach); u <= Math.min(w - 1, x + reach); u++) {
                if (outside(v * w + u) < 0)
                    inside = Math.max(inside, symbol[v * w + u]);
            }
        }
        if (inside < SLIVER_INSIDE)
            drop.push(i);
    }
    for (const i of drop)
        symbol[i] = 0;
}


function extent(pixels, scale) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < pixels.width * pixels.height; i++) {
        if (pixels.data[i * 4 + 3] < 26)
            continue;
        const x = i % pixels.width, y = Math.floor(i / pixels.width);
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x + 1);
        y2 = Math.max(y2, y + 1);
    }
    if (x2 < x1)
        return { cx: pixels.width * scale / 2, cy: pixels.height * scale / 2, half: 1 };
    return { cx: (x1 + x2) / 2 * scale, cy: (y1 + y2) / 2 * scale, half: Math.max(x2 - x1, y2 - y1) / 2 * scale };
}

function depthOf(plates, k) {
    return plates[k].parent < 0 ? 0 : depthOf(plates, plates[k].parent) + 1;
}

function encode(d) {
    return Math.round(Math.min(Math.max(0.5 - d / (2 * MAP_RANGE), 0), 1) * 255);
}


function encodeLens(d) {
    const v = Math.round(Math.min(Math.max((d + LENS_RANGE) / (2 * LENS_RANGE), 0), 1) * 65535);
    return [v >> 8, v & 255];
}


function halfWidth(shape) {
    return Math.min(shape.rx, shape.ry);
}





export function buildStyleMap(analysis, detail, size = MAP_SIZE) {

    const plates = withoutPlates(analysis.plates, plate => !plate.plain);
    const A = analysis.width;
    const scale = A / detail.width;
    const center = A / 2;

    const tops = plates.map((_, k) => k).filter(k => plates[k].parent < 0);
    const own = tops.length === 1 && isSquare(plates[tops[0]].shape, A) &&
        outsideShare(detail, scale, plates[tops[0]].shape) < OUTSIDE_SHARE;
    const half = OUTER_HALF * A;
    let outer, k, fromX, fromY;
    if (own) {
        const shape = plates[tops[0]].shape;
        k = half / Math.max(shape.rx, shape.ry);
        outer = smoothCorners({ ...shape, cx: center, cy: center, rx: shape.rx * k, ry: shape.ry * k, radius: shape.radius * k });
        fromX = shape.cx;
        fromY = shape.cy;
    }
    else {
        outer = { kind: 'superellipse', cx: center, cy: center, rx: half, ry: half, radius: 0, exponent: OUTER_EXPONENT,
            ripple: null, fit: 1 };
        const e = extent(detail, scale);
        k = Math.min(1, half * CONTENT_REACH / e.half);
        fromX = e.cx;
        fromY = e.cy;
    }
    const level = plates.map((_, i) => depthOf(plates, i) + (own ? 0 : 1));
    const { symbol, intensity, surface } = symbolLayer(plates, A, detail);
    if (own)
        dropSliver(symbol, detail, scale, plates[tops[0]].shape);
    const field = new Float32Array(symbol.length);
    for (let i = 0; i < field.length; i++)
        field[i] = symbol[i] * intensity[i];
    const sample = (x, y, values = field) => {

        const fx = x / scale - 0.5, fy = y / scale - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        let v = 0;
        for (const [dx, dy, wgt] of [[0, 0, (1 - (fx - x0)) * (1 - (fy - y0))], [1, 0, (fx - x0) * (1 - (fy - y0))],
            [0, 1, (1 - (fx - x0)) * (fy - y0)], [1, 1, (fx - x0) * (fy - y0)]]) {
            const u = x0 + dx, w = y0 + dy;
            if (u >= 0 && w >= 0 && u < detail.width && w < detail.height)
                v += values[w * detail.width + u] * wgt;
        }
        return v;
    };
    const tones = plateTones(plates, level);
    const data = new Uint8Array(size * size * 4);
    const tone = new Uint8Array(size * size * 4);
    const mapPx = size / A;

    const taps = Math.max(1, Math.ceil(1 / (k * mapPx * scale)));
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const fx = (x + 0.5) / mapPx, fy = (y + 0.5) / mapPx;
            const qx = fromX + (fx - center) / k, qy = fromY + (fy - center) / k;


            const inner = [Infinity, Infinity], innerTone = [0.5, 0.5], toneLevel = [-1, -1];

            let here = own && shapeDistance(plates[tops[0]].shape, qx, qy) < 0 ? 0 : -1;
            plates.forEach((plate, i) => {
                const l = level[i];
                if (l === 0)
                    return;
                const slot = Math.min(l, 2) - 1;
                const d = shapeDistance(plate.shape, qx, qy) * k * mapPx;


                const cover = Math.min(Math.max(0.5 - d, 0), 1);
                if (cover > 0 && l >= toneLevel[slot]) {
                    innerTone[slot] = toneLevel[slot] < 0 ? tones[i] : innerTone[slot] + (tones[i] - innerTone[slot]) * cover;
                    toneLevel[slot] = l;
                }
                else if (toneLevel[slot] < 0 && d < inner[slot]) {
                    innerTone[slot] = tones[i];
                }
                if (d < 0)
                    here = Math.max(here, l);
                inner[slot] = Math.min(inner[slot], d);
            });
            const shade = here < 0 ? 0 : sample(qx, qy, surface) * SURFACE_GAIN;
            const outerTone = here === 0 ? 0.5 + shade : 0.5;
            if (here > 0)
                innerTone[Math.min(here, 2) - 1] += shade;
            let sym = 0;
            for (let ty = 0; ty < taps; ty++) {
                for (let tx = 0; tx < taps; tx++) {
                    const sx = fromX + ((x + (tx + 0.5) / taps) / mapPx - center) / k;
                    const sy = fromY + ((y + (ty + 0.5) / taps) / mapPx - center) / k;
                    sym += sample(sx, sy);
                }
            }
            const at = (y * size + x) * 4;
            data[at] = encode(shapeDistance(outer, fx, fy) * mapPx);
            data[at + 1] = encode(inner[0]);
            data[at + 2] = encode(inner[1]);
            data[at + 3] = Math.round(Math.min(sym / (taps * taps), 1) * 255);
            const byte = (t) => Math.round(Math.min(Math.max(t, 0), 1) * 255);
            tone.set([byte(innerTone[0]), byte(innerTone[1]), byte(outerTone), 255], at);
        }
    }
    const lens = new Uint8Array(LENS_SIZE * LENS_SIZE * 2 * 4);
    const lensPx = size / LENS_SIZE;
    for (let y = 0; y < LENS_SIZE; y++) {
        for (let x = 0; x < LENS_SIZE; x++) {
            const fx = (x + 0.5) * lensPx / mapPx, fy = (y + 0.5) * lensPx / mapPx;
            const qx = fromX + (fx - center) / k, qy = fromY + (fy - center) / k;
            const inner = [Infinity, Infinity], half = [0, 0];
            plates.forEach((plate, i) => {
                if (level[i] === 0)
                    return;
                const slot = Math.min(level[i], 2) - 1;
                const d = shapeDistance(plate.shape, qx, qy) * k * mapPx;
                if (d < inner[slot]) {
                    inner[slot] = d;
                    half[slot] = halfWidth(plate.shape) * k * mapPx;
                }
            });
            const halfByte = (h) => Math.round(Math.min(h / LENS_RANGE, 1) * 255);
            const top = (y * LENS_SIZE + x) * 4, bottom = ((y + LENS_SIZE) * LENS_SIZE + x) * 4;
            lens.set([...encodeLens(shapeDistance(outer, fx, fy) * mapPx), ...encodeLens(inner[0])], top);
            lens.set([...encodeLens(inner[1]), halfByte(half[0]), halfByte(half[1])], bottom);
        }
    }
    return { size, data, tone, lens, ownPlate: own };
}




function plateTones(plates, level) {
    const tones = plates.map(() => 0.5);
    for (const slot of [1, 2]) {
        const members = plates.map((_, i) => i).filter(i => level[i] > 0 && Math.min(level[i], 2) === slot);
        if (members.length < 2)
            continue;
        const colors = members.map(i => plateColor(plates[i], plates[i].shape.cx, plates[i].shape.cy));
        const mean = [0, 1, 2].map(c => colors.reduce((sum, col) => sum + col[c], 0) / colors.length);
        const centerd = colors.map(col => col.map((v, c) => v - mean[c]));

        let dir = [1, 0, 0];
        for (let round = 0; round < 20; round++) {
            const next = [0, 0, 0];
            for (const v of centerd) {
                const dot = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
                for (let c = 0; c < 3; c++)
                    next[c] += v[c] * dot;
            }
            const len = Math.hypot(...next);
            if (len < 1e-9)
                break;
            dir = next.map(v => v / len);
        }
        if (dir[0] < 0)
            dir = dir.map(v => -v);
        members.forEach((i, m) => {
            const along = centerd[m][0] * dir[0] + centerd[m][1] * dir[1] + centerd[m][2] * dir[2];
            tones[i] = Math.min(Math.max(0.5 + along * TONE_GAIN, 0), 1);
        });
    }
    return tones;
}
