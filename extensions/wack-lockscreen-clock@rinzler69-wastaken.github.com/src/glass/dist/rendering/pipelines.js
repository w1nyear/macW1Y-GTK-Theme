import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import { uniformDeclarations, setUniformVector, coglContext, safeRegisterClass } from '../shellVersion.js';




export function splitShader(src, warn) {
    const match = src.match(/void\s+main\s*\(\s*\)\s*\{/);
    if (!match || match.index === undefined) {
        warn?.('[Liquid Glass] void main() not found; treating entire source as decl.');
        return { decl: src, body: '' };
    }
    const decl = src.substring(0, match.index);
    const rest = src.substring(match.index + match[0].length);

    let depth = 1;
    let bodyEnd = 0;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '{')
            depth++;
        else if (rest[i] === '}') {
            depth--;
            if (depth === 0) {
                bodyEnd = i;
                break;
            }
        }
    }
    return { decl, body: rest.substring(0, bodyEnd) };
}








export function computeGaussianKernel(sigma, fetchPairs) {
    const sideTaps = Math.max(2, fetchPairs * 2);
    const raw = [];
    let sum = 0;
    for (let i = 0; i <= sideTaps; i++) {
        const w = Math.exp(-(i * i) / (2 * sigma * sigma));
        raw.push(w);
        sum += (i === 0) ? w : w * 2;
    }
    for (let i = 0; i <= sideTaps; i++) {
        raw[i] /= sum;
    }
    const offsets = [0];
    const weights = [raw[0]];
    for (let p = 0; p < fetchPairs; p++) {
        const i = p * 2 + 1;
        const j = i + 1;
        const w0 = raw[i] ?? 0;
        const w1 = (j <= sideTaps) ? raw[j] : 0;
        const wSum = w0 + w1;
        const offset = wSum > 0 ? (i * w0 + j * w1) / wSum : i;
        offsets.push(offset);
        weights.push(wSum);
    }
    return { offsets, weights };
}





export function buildGaussianSnippet(kernel, direction) {
    const decl = `uniform vec2 inv_size;    /* 1/width, 1/height of the SOURCE texture */\n` +
        `uniform float kernel_scale; /* dynamic scale based on the sigma ratio, avoids recompiling */\n`;
    const lines = [];
    lines.push(`vec2 uv = cogl_tex_coord_in[0].st;`);
    lines.push(`vec4 col = texture2D(cogl_sampler0, uv) * ${kernel.weights[0].toFixed(8)};`);
    for (let i = 1; i < kernel.offsets.length; i++) {
        const off = kernel.offsets[i].toFixed(8);
        const w = kernel.weights[i].toFixed(8);
        const plusVec = direction === 'h'
            ? `vec2(${off} * kernel_scale * inv_size.x, 0.0)`
            : `vec2(0.0, ${off} * kernel_scale * inv_size.y)`;
        lines.push(`col += texture2D(cogl_sampler0, uv + ${plusVec}) * ${w};`);
        lines.push(`col += texture2D(cogl_sampler0, uv - ${plusVec}) * ${w};`);
    }
    lines.push(`cogl_color_out = col;`);
    return { decl, body: '\n    ' + lines.join('\n    ') + '\n' };
}

const SHADER_FILES = ['downsample.frag', 'upsample.frag', 'glass.frag'];



const shaderSources = new Map();

export function clearShaderSources() {
    shaderSources.clear();
}

export class ShaderPipelines {
    _logger;
    _shapeTexture;



    constructor(_logger, _shapeTexture = false) {
        this._logger = _logger;
        this._shapeTexture = _shapeTexture;
    }

    async load(extensionPath, cancellable = null) {
        if (!extensionPath)
            throw new Error('Missing extension path for shader loading');
        const sources = [];
        for (const name of SHADER_FILES)
            sources.push(await this._readFileAsync(`${extensionPath}/shaders/${name}`, cancellable));
        [this._downsampleSource, this._upsampleSource, this._glassSource] = sources;
    }


    loadCached(extensionPath) {
        const sources = SHADER_FILES.map(name => shaderSources.get(`${extensionPath}/shaders/${name}`));
        if (!extensionPath || sources.some(source => source === undefined))
            return false;
        [this._downsampleSource, this._upsampleSource, this._glassSource] = sources;
        return true;
    }

    clear() {
        this.downsample = null;
        this.upsample = null;
        this.composite = null;
        this.passthrough = null;
        this.boxDown = null;
    }


    downsample = null;
    upsample = null;
    composite = null;



    passthrough = null;

    boxDown = null;
    _downsampleSource = null;
    _upsampleSource = null;
    _glassSource = null;


    _readFileAsync(path, cancellable) {
        return new Promise((resolve, reject) => {
            const file = Gio.File.new_for_path(path);
            file.load_contents_async(cancellable, (_, res) => {
                try {
                    const [ok, bytes] = file.load_contents_finish(res);
                    if (!ok) {
                        reject(new Error(`load_contents_finish returned false for ${path}`));
                    }
                    else {
                        const source = new TextDecoder('utf-8').decode(bytes);
                        shaderSources.set(path, source);
                        resolve(source);
                    }
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    }





    initialize(ctx) {
        this.downsample = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this.downsample, 0);
        if (this._downsampleSource) {
            const downSnippet = splitShader(this._downsampleSource, message => this._logger?.warn(message));
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(downSnippet.decl), null);
            s.set_replace(downSnippet.body);
            this.downsample.add_snippet(s);
        }
        this.upsample = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this.upsample, 0);
        if (this._upsampleSource) {
            const upSnippet = splitShader(this._upsampleSource, message => this._logger?.warn(message));
            const s = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(upSnippet.decl), null);
            s.set_replace(upSnippet.body);
            this.upsample.add_snippet(s);
        }
        this.passthrough = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this.passthrough, 0);




        this.boxDown = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this.boxDown, 0);
        {
            const boxSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations('uniform vec2 inv_size;\n'), null);
            boxSnip.set_replace('vec2 uv = cogl_tex_coord_in[0].st;\n' +
                'vec4 c  = texture2D(cogl_sampler0, uv + vec2( 1.0,  1.0) * inv_size);\n' +
                'c += texture2D(cogl_sampler0, uv + vec2( 1.0, -1.0) * inv_size);\n' +
                'c += texture2D(cogl_sampler0, uv + vec2(-1.0,  1.0) * inv_size);\n' +
                'c += texture2D(cogl_sampler0, uv + vec2(-1.0, -1.0) * inv_size);\n' +
                'cogl_color_out = c * 0.25;\n');
            this.boxDown.add_snippet(boxSnip);
        }


        this.composite = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this.composite, 0);
        if (this._shapeTexture)
            configureSamplerLayer(this.composite, SHAPE_LAYER);

        this.composite.set_blend('RGBA = ADD(SRC_COLOR, DST_COLOR * (1 - SRC_COLOR[A]))');
        this._loadCompositeShader();
    }






    _loadCompositeShader() {
        if (!this.composite || !this._glassSource)
            return;
        let { decl, body } = splitShader(this._glassSource, message => this._logger?.warn(message));
        decl = decl.replace(/uniform\s+sampler2D\s+cogl_sampler\d*\s*;[^\n]*/g, '');
        body = body.replace(/\bcogl_sampler\b/g, 'cogl_sampler0');
        if (this._shapeTexture)
            decl = `#define LG_SHAPE_TEXTURE 1\n${decl}`;
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(decl), null);
        snippet.set_replace(body);
        this.composite.add_snippet(snippet);
    }
}


export const SHAPE_LAYER = 2;


export function configureSamplerLayer(pipeline, layer) {
    pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    pipeline.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
}

export class RenderPasses {

    _passPipelines = new Map();

    clear() {
        this._passPipelines.clear();
    }








    pipeline(key, base) {
        const cached = this._passPipelines.get(key);
        if (cached && cached.base === base)
            return cached.copy;
        const copy = base.copy();
        copy.set_blend('RGBA = ADD(SRC_COLOR, 0)');
        this._passPipelines.set(key, { base, copy });
        return copy;
    }








    add(parentNode, targetFbo, pipeline, destW, destH, uv) {
        targetFbo.orthographic(0, 0, destW, destH, -1, 1);
        const layerNode = Clutter.LayerNode.new_to_framebuffer(targetFbo, pipeline);
        parentNode.add_child(layerNode);
        const drawNode = Clutter.PipelineNode.new(pipeline);
        layerNode.add_child(drawNode);
        drawNode.add_texture_rectangle(new Clutter.ActorBox({ x1: 0, y1: 0, x2: destW, y2: destH }), uv[0], uv[1], uv[2], uv[3]);
    }







    composite(parentNode, pipeline, dest, uv) {
        const drawNode = Clutter.PipelineNode.new(pipeline);
        parentNode.add_child(drawNode);
        drawNode.add_texture_rectangle(new Clutter.ActorBox({ x1: dest[0], y1: dest[1], x2: dest[2], y2: dest[3] }), uv[0], uv[1], uv[2], uv[3]);
    }
}


export function setPipelineVec2(pipeline, name, x, y) {
    setUniformVector(pipeline, name, [x, y]);
}

export function setPipelineFloat(pipeline, name, value) {
    pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
}

export class BlurRenderer {
    _pipelines;
    _passes;
    _repaint;

    constructor(_pipelines, _passes, _repaint) {
        this._pipelines = _pipelines;
        this._passes = _passes;
        this._repaint = _repaint;
    }

    get radius() { return this._targetRadius; }

    get downscale() { return this._blurDownscale; }

    get passCount() { return this.PASS_COUNT; }

    get result() { return this._blurResultTex; }

    get width() { return this._poolWidth; }

    get height() { return this._poolHeight; }

    get ready() { return this.PASS_COUNT === 0 || this._blurFbos.length > 0; }

    get needsCompile() { return this._gaussianPipelineDirty && this._pendingGaussianKernel !== null; }

    invalidate() { this._destroyTexturePool(); }

    compilePending(ctx) {
        if (!this.needsCompile)
            return;
        this._gaussianHPipeline = null;
        this._gaussianVPipeline = null;
        this._compileGaussianPipelines(ctx, this._pendingGaussianKernel);
    }

    render(parent, source, uv, inputKey) {
        this._blurResultTex = null;
        this._renderedKey = null;
        if (this.PASS_COUNT <= 0)
            return;
        if (this._blurMethod === 0) {
            if (this._gaussianHPipeline && this._gaussianVPipeline)
                this._runGaussianBlur(parent, source, uv);
        }
        else
            this._runDualKawaseBlur(parent, source, uv);


        if (inputKey && this._blurResultTex !== null)
            this._renderedKey = [...inputKey, ...this._configKey()];
    }

    canReuse(inputKey) {
        const stored = this._renderedKey;
        if (stored === null || this._blurResultTex === null || this.PASS_COUNT <= 0)
            return false;
        const config = this._configKey();
        if (stored.length !== inputKey.length + config.length)
            return false;
        for (let i = 0; i < inputKey.length; i++)
            if (stored[i] !== inputKey[i])
                return false;
        for (let i = 0; i < config.length; i++)
            if (stored[inputKey.length + i] !== config[i])
                return false;
        return true;
    }

    _renderedKey = null;

    _configKey() {
        const p = this._pipelines;
        return [this._blurFbos[0] ?? null, this._blurMethod, this.PASS_COUNT, this._blurDownscale,
            this._blurRadiusDown, this._blurRadiusUp, this._gaussianScale,
            this._gaussianHPipeline, this._gaussianVPipeline,
            p.downsample, p.upsample, p.passthrough, p.boxDown];
    }

    setDownscale(factor) {
        if (factor === this._blurDownscale)
            return;
        this._blurDownscale = factor;

        this._destroyTexturePool();
        this.setBlurRadius(this._targetRadius);
        this._repaint();
    }

    reload() {
        this._gaussianHPipeline = null;
        this._gaussianVPipeline = null;
        this._gaussianKernel = null;
        this._gaussianFetchPairs = 0;
        this.setBlurRadius(this._targetRadius);
    }

    clear() {
        this._destroyTexturePool();
        this._gaussianHPipeline = null;
        this._gaussianVPipeline = null;
        this._gaussianKernel = null;
        this._pendingGaussianKernel = null;
        this._gaussianPipelineDirty = false;
        this._gaussianBaseSigma = 0;
        this._gaussianScale = 1;
        this._gaussianFetchPairs = 0;
    }

    describe() {
        const result = this._blurResultTex;
        return {
            blurMethod: this._blurMethod, passCount: this.PASS_COUNT,
            pool: this._poolWidth + 'x' + this._poolHeight, poolLevels: this._blurFbos.length,
            blurResult: result ? result.get_width() + 'x' + result.get_height() : 'NULL (layer 1 falls back to the unblurred copy)',
            radiusDown: this._blurRadiusDown, radiusUp: this._blurRadiusUp, targetRadius: this._targetRadius,
            gaussianPipelines: !!(this._gaussianHPipeline && this._gaussianVPipeline),
        };
    }


    _blurTextures = [];
    _blurFbos = [];

    _gaussianTempTextures = [];
    _gaussianTempFbos = [];




    _upTextures = [];
    _upFbos = [];

    _blurResultTex = null;
    _gaussianHPipeline = null;
    _gaussianVPipeline = null;
    _blurMethod = 1;


    _gaussianKernel = null;
    _pendingGaussianKernel = null;
    _gaussianPipelineDirty = false;


    _gaussianBaseSigma = 0;
    _gaussianScale = 1.0;
    _gaussianFetchPairs = 0;
    _poolWidth = 0;
    _poolHeight = 0;

    _blurDownscale = 2;

    PASS_COUNT = 4;

    _blurRadiusDown = 0.5;
    _blurRadiusUp = 1.0;

    _targetRadius = 15.0;


    _compileGaussianPipelines(ctx, kernel) {
        this._gaussianHPipeline = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this._gaussianHPipeline, 0);
        const hSnippet = buildGaussianSnippet(kernel, 'h');
        const hSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(hSnippet.decl), null);
        hSnip.set_replace(hSnippet.body);
        this._gaussianHPipeline.add_snippet(hSnip);
        this._gaussianVPipeline = Cogl.Pipeline.new(ctx);
        configureSamplerLayer(this._gaussianVPipeline, 0);
        const vSnippet = buildGaussianSnippet(kernel, 'v');
        const vSnip = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(vSnippet.decl), null);
        vSnip.set_replace(vSnippet.body);
        this._gaussianVPipeline.add_snippet(vSnip);
        this._gaussianKernel = kernel;
        this._gaussianPipelineDirty = false;
        this._pendingGaussianKernel = null;
    }






    resize(ctx, w, h) {
        this._destroyTexturePool();
        const shift = this._blurDownscale >= 4 ? 2 : 1;
        let pw = Math.max(w >> shift, 1);
        let ph = Math.max(h >> shift, 1);
        for (let i = 0; i < this.PASS_COUNT; i++) {
            const tex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
            this._blurTextures.push(tex);
            this._blurFbos.push(Cogl.Offscreen.new_with_texture(tex));
            const tmpTex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
            this._gaussianTempTextures.push(tmpTex);
            this._gaussianTempFbos.push(Cogl.Offscreen.new_with_texture(tmpTex));
            const upTex = Cogl.Texture2D.new_with_size(ctx, pw, ph);
            this._upTextures.push(upTex);
            this._upFbos.push(Cogl.Offscreen.new_with_texture(upTex));
            pw = Math.max(pw >> 1, 1);
            ph = Math.max(ph >> 1, 1);
        }
        this._poolWidth = w;
        this._poolHeight = h;
    }



    _runDualKawaseBlur(parentNode, srcTex, srcUV) {
        let currentSrc = srcTex;
        for (let i = 0; i < this.PASS_COUNT; i++) {
            const destFbo = this._blurFbos[i];
            const destTex = this._blurTextures[i];
            const destW = destTex.get_width();
            const destH = destTex.get_height();
            const invW = 1.0 / currentSrc.get_width();
            const invH = 1.0 / currentSrc.get_height();

            const uv = (i === 0) ? srcUV : [0, 0, 1, 1];


            const boxFirst = i === 0 && this._blurDownscale >= 4 && this._pipelines.boxDown !== null;
            const pipeline = boxFirst
                ? this._passes.pipeline('kawase-down-0-box', this._pipelines.boxDown)
                : this._passes.pipeline(`kawase-down-${i}`, this._pipelines.downsample);
            pipeline.set_layer_texture(0, currentSrc);
            setPipelineVec2(pipeline, 'inv_size', invW, invH);
            if (!boxFirst)
                setPipelineFloat(pipeline, 'blur_radius', this._blurRadiusDown);
            this._passes.add(parentNode, destFbo, pipeline, destW, destH, uv);
            currentSrc = destTex;
        }
        if (this.PASS_COUNT <= 1) {
            this._blurResultTex = this._blurTextures[0];
            return;
        }
        for (let i = this.PASS_COUNT - 1; i > 0; i--) {
            const srcTexture = (i === this.PASS_COUNT - 1)
                ? this._blurTextures[i]
                : this._upTextures[i];
            const destFbo = this._upFbos[i - 1];
            const destTex = this._upTextures[i - 1];
            const destW = destTex.get_width();
            const destH = destTex.get_height();
            const invW = 1.0 / srcTexture.get_width();
            const invH = 1.0 / srcTexture.get_height();
            const pipeline = this._passes.pipeline(`kawase-up-${i}`, this._pipelines.upsample);
            pipeline.set_layer_texture(0, srcTexture);
            setPipelineVec2(pipeline, 'inv_size', invW, invH);
            setPipelineFloat(pipeline, 'blur_radius', this._blurRadiusUp);
            this._passes.add(parentNode, destFbo, pipeline, destW, destH, [0, 0, 1, 1]);
        }
        this._blurResultTex = this._upTextures[0];
    }




    _runGaussianBlur(parentNode, srcTex, srcUV) {
        const tempFbo = this._gaussianTempFbos[0];
        const tempTex = this._gaussianTempTextures[0];
        const destFbo = this._blurFbos[0];
        const destTex = this._blurTextures[0];
        const destW = destTex.get_width();
        const destH = destTex.get_height();


        const wideDownsample = this._blurDownscale >= 4 && this._pipelines.boxDown !== null;
        const prePipeline = wideDownsample
            ? this._passes.pipeline('gauss-pre-box', this._pipelines.boxDown)
            : this._passes.pipeline('gauss-pre', this._pipelines.passthrough);
        prePipeline.set_layer_texture(0, srcTex);
        if (wideDownsample) {
            setPipelineVec2(prePipeline, 'inv_size', 1.0 / srcTex.get_width(), 1.0 / srcTex.get_height());
        }
        this._passes.add(parentNode, destFbo, prePipeline, destW, destH, srcUV);
        const hPipeline = this._passes.pipeline('gauss-h', this._gaussianHPipeline);
        hPipeline.set_layer_texture(0, destTex);
        setPipelineVec2(hPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
        setPipelineFloat(hPipeline, 'kernel_scale', this._gaussianScale);
        this._passes.add(parentNode, tempFbo, hPipeline, destW, destH, [0, 0, 1, 1]);

        const vPipeline = this._passes.pipeline('gauss-v', this._gaussianVPipeline);
        vPipeline.set_layer_texture(0, tempTex);
        setPipelineVec2(vPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
        setPipelineFloat(vPipeline, 'kernel_scale', this._gaussianScale);
        const outFbo = this._upFbos[0];
        this._passes.add(parentNode, outFbo, vPipeline, destW, destH, [0, 0, 1, 1]);
        this._blurResultTex = this._upTextures[0];
    }



    _destroyTexturePool() {
        this._blurFbos = [];
        this._blurTextures = [];
        this._gaussianTempFbos = [];
        this._gaussianTempTextures = [];
        this._upFbos = [];
        this._upTextures = [];
        this._blurResultTex = null;

        this._renderedKey = null;
        this._poolWidth = 0;
        this._poolHeight = 0;
    }



    setBlurMethod(method) {
        if (this._blurMethod === method)
            return;
        this._blurMethod = method;
        this.setBlurRadius(this._targetRadius);
        this._repaint();
    }

    setBlurRadius(radius) {
        this._targetRadius = radius;
        if (this._blurMethod === 0) {
            this._setGaussianBlurRadius(radius);
            return;
        }
        this._setDualKawaseBlurRadius(radius);
    }






    _setGaussianBlurRadius(radius) {


        const RES_SCALE = this._blurDownscale >= 4 ? 4.0 : 2.0;
        const MAX_SIGMA_TEXEL = 15.0;


        const MIN_SIGMA_TEXEL = 1.0;
        if (radius <= 0) {
            if (this.PASS_COUNT !== 0) {
                this.PASS_COUNT = 0;
                this._destroyTexturePool();
            }
            this._gaussianScale = 0.0;
            this._repaint();
            return;
        }
        const sigmaTexel = Math.min(radius / RES_SCALE, MAX_SIGMA_TEXEL);
        const kernelSigma = Math.max(sigmaTexel, MIN_SIGMA_TEXEL);


        const sideTaps = Math.max(2, Math.ceil(kernelSigma * 4));
        const fetchPairs = Math.max(2, Math.ceil(sideTaps / 2));
        const needsRecompile = this._gaussianFetchPairs !== fetchPairs ||
            (!this._gaussianKernel && !this._pendingGaussianKernel);
        if (needsRecompile) {
            const kernel = computeGaussianKernel(kernelSigma, fetchPairs);
            this._pendingGaussianKernel = kernel;
            this._gaussianPipelineDirty = true;
            this._gaussianFetchPairs = fetchPairs;
            this._gaussianBaseSigma = kernelSigma;
            this._gaussianScale = sigmaTexel / kernelSigma;
        }
        else {
            this._gaussianScale = this._gaussianBaseSigma > 0
                ? sigmaTexel / this._gaussianBaseSigma
                : 1.0;
        }

        if (this.PASS_COUNT !== 1) {
            this.PASS_COUNT = 1;
            this._destroyTexturePool();
        }
        this._repaint();
    }





    _setDualKawaseBlurRadius(radius) {
        let newPassCount = 0;
        let offsetDown = 0.0;
        let offsetUp = 0.0;
        if (radius > 0) {
            let p = Math.floor(Math.log2(radius + 1));
            newPassCount = Math.max(1, Math.min(4, p));


            let baseR = (newPassCount === 1) ? 0 : Math.pow(2, newPassCount) - 1;
            let nextR = Math.pow(2, newPassCount + 1) - 1;
            let t = (radius - baseR) / (nextR - baseR);
            t = Math.max(0.0, Math.min(1.0, t));
            let s = 0.25 * Math.pow(t, 3) - 0.75 * Math.pow(t, 2) + 1.5 * t;
            let minOffset = (newPassCount === 1) ? 0.0 : 0.5;
            let maxOffset = 1.0;
            let r = minOffset + s * (maxOffset - minOffset);
            offsetDown = r;
            offsetUp = r * 1.5;
        }
        if (this.PASS_COUNT !== newPassCount ||
            this._blurRadiusDown !== offsetDown ||
            this._blurRadiusUp !== offsetUp) {
            const passCountChanged = this.PASS_COUNT !== newPassCount;
            this.PASS_COUNT = newPassCount;
            this._blurRadiusDown = offsetDown;
            this._blurRadiusUp = offsetUp;
            if (passCountChanged)
                this._destroyTexturePool();
            this._repaint();
        }
    }
}









const DECL = `
// The glass's box in the offscreen (texture coordinates), and px on screen per
// texture width and height.
uniform vec4 lens_box;
uniform vec2 lens_px;
uniform float lens_radius;
uniform float lens_band;
uniform float lens_depth;
uniform float lens_ior;
uniform float lens_opacity;

float lensBox(vec2 p) {
    vec2 q = abs(p) - (lens_box.zw - lens_box.xy) * lens_px * 0.5 + lens_radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - lens_radius;
}

// A round rim rising over lens_band px from the outline, flat inside it.
float lensHeight(vec2 p) {
    float t = clamp(-lensBox(p) / lens_band, 0.0, 1.0);
    return sqrt(1.0 - (1.0 - t) * (1.0 - t)) * lens_band;
}
`;
const BODY = `
vec2 uv = cogl_tex_coord_in[0].st;
vec2 p = (uv - (lens_box.xy + lens_box.zw) * 0.5) * lens_px;
vec2 slope = vec2(lensHeight(p + vec2(0.5, 0.0)) - lensHeight(p - vec2(0.5, 0.0)),
                  lensHeight(p + vec2(0.0, 0.5)) - lensHeight(p - vec2(0.0, 0.5)));
vec3 ray = refract(vec3(0.0, 0.0, -1.0), normalize(vec3(-slope, 1.0)), 1.0 / max(lens_ior, 1.001));
vec2 shift = ray.xy / max(-ray.z, 0.15) * lens_depth;
vec4 color = texture2D(cogl_sampler0, clamp(uv + shift / lens_px, lens_box.xy, lens_box.zw));
float inside = 1.0 - smoothstep(-0.5, 0.5, lensBox(p));
cogl_color_out = color * (lens_opacity * inside);
`;


const DEPTH = 80;
const IOR = 1.5;
const BAND = 70;







export function rectInOffscreen(actor, rect) {
    const volume = actor.get_paint_volume();
    if (!volume)
        return null;
    const origin = volume.get_origin();
    const w = Math.round(volume.get_width()) + 3, h = Math.round(volume.get_height()) + 3;
    const x0 = Math.ceil(origin.x + volume.get_width() + 0.75) - w;
    const y0 = Math.ceil(origin.y + volume.get_height() + 0.75) - h;
    const [cx, cy, cw, ch] = rect;
    return { box: [(cx - x0) / w, (cy - y0) / h, (cx + cw - x0) / w, (cy + ch - y0) / h], width: w, height: h };
}


export const ContentLens = safeRegisterClass({ GTypeName: 'WackGlass_ContentLens' }, class ContentLens extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._pipeline = null;
        this._uniforms = { box: [0, 0, 1, 1], px: [1, 1], radius: 0, band: 1, depth: 0, ior: IOR };
        this._clip = [0, 0, 1, 1];
        this._scale = 1;
    }


    vfunc_paint_target(node, _paintContext) {
        const texture = this.get_texture();
        if (!texture)
            return;
        if (!this._pipeline) {
            this._pipeline = Cogl.Pipeline.new(coglContext());
            configureSamplerLayer(this._pipeline, 0);
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(DECL), null);
            snippet.set_replace(BODY);
            this._pipeline.add_snippet(snippet);
            this._apply();
        }
        this._locate();
        const pipeline = this._pipeline;
        pipeline.set_layer_texture(0, texture);
        pipeline.set_uniform_1f(pipeline.get_uniform_location('lens_opacity'), this.get_actor().get_paint_opacity() / 255);
        const drawNode = Clutter.PipelineNode.new(pipeline);
        node.add_child(drawNode);
        drawNode.add_rectangle(new Clutter.ActorBox({ x1: 0, y1: 0, x2: texture.get_width(), y2: texture.get_height() }));
    }






    shape(clip, scale, radius, depth) {
        const u = this._uniforms;
        this._clip = clip;
        this._scale = scale;
        const half = Math.min(clip[2], clip[3]) * scale / 2;
        u.radius = Math.min(Math.max(radius, 0), half);
        u.band = Math.max(Math.min(BAND, half), 1);
        u.depth = DEPTH * depth;
        u.ior = 1 + (IOR - 1) * depth;
        this._apply();
        this.queue_repaint();
    }

    _locate() {
        const box = rectInOffscreen(this.get_actor(), this._clip);
        if (!box)
            return;
        const u = this._uniforms;
        u.box = box.box;
        u.px = [box.width * this._scale, box.height * this._scale];
        this._apply();
    }

    _apply() {
        const p = this._pipeline;
        if (!p)
            return;
        const u = this._uniforms;
        setUniformVector(p, 'lens_box', u.box);
        setUniformVector(p, 'lens_px', u.px);
        p.set_uniform_1f(p.get_uniform_location('lens_radius'), u.radius);
        p.set_uniform_1f(p.get_uniform_location('lens_band'), u.band);
        p.set_uniform_1f(p.get_uniform_location('lens_depth'), u.depth);
        p.set_uniform_1f(p.get_uniform_location('lens_ior'), u.ior);
    }
});
