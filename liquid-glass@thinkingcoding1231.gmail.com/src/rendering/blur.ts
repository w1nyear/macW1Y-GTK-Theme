import Cogl from 'gi://Cogl';
import { ShaderPipelines, configureSamplerLayer } from './pipelines.js';
import { RenderPasses, setPipelineFloat, setPipelineVec2 } from './passes.js';
import { computeGaussianKernel, buildGaussianSnippet, type GaussianKernel } from './shaderSource.js';
import { uniformDeclarations } from '../shellVersion.js';

// 0: separable Gaussian (shader generated from the kernel), 1: Dual Kawase.
export type BlurMethod = 0 | 1;
// Cogl.Offscreen is a Cogl.Framebuffer; the type definitions need the cast.
type CoglFB = Cogl.Framebuffer;

export class BlurRenderer {
  constructor(
    private _pipelines: ShaderPipelines, private _passes: RenderPasses,
    private _repaint: () => void,
  ) {}

  get radius(): number { return this._targetRadius; }
  get downscale(): number { return this._blurDownscale; }
  get passCount(): number { return this.PASS_COUNT; }
  get result(): Cogl.Texture | null { return this._blurResultTex; }
  get width(): number { return this._poolWidth; }
  get height(): number { return this._poolHeight; }
  get ready(): boolean { return this.PASS_COUNT === 0 || this._blurFbos.length > 0; }
  get needsCompile(): boolean { return this._gaussianPipelineDirty && this._pendingGaussianKernel !== null; }

  invalidate(): void { this._destroyTexturePool(); }

  compilePending(ctx: Cogl.Context): void {
    if (!this.needsCompile) return;
    this._gaussianHPipeline = null;
    this._gaussianVPipeline = null;
    this._compileGaussianPipelines(ctx, this._pendingGaussianKernel!);
  }

  render(parent: any, source: Cogl.Texture, uv: number[], inputKey?: readonly unknown[]): void {
    this._blurResultTex = null;
    this._renderedKey = null;
    if (this.PASS_COUNT <= 0) return;
    if (this._blurMethod === 0) {
      if (this._gaussianHPipeline && this._gaussianVPipeline) this._runGaussianBlur(parent, source, uv);
    } else this._runDualKawaseBlur(parent, source, uv);
    // Only a chain that actually produced a result may be reused later, and
    // the key records the configuration it was produced with.
    if (inputKey && this._blurResultTex !== null) this._renderedKey = [...inputKey, ...this._configKey()];
  }

  canReuse(inputKey: readonly unknown[]): boolean {
    const stored = this._renderedKey;
    if (stored === null || this._blurResultTex === null || this.PASS_COUNT <= 0) return false;
    const config = this._configKey();
    if (stored.length !== inputKey.length + config.length) return false;
    for (let i = 0; i < inputKey.length; i++) if (stored[i] !== inputKey[i]) return false;
    for (let i = 0; i < config.length; i++) if (stored[inputKey.length + i] !== config[i]) return false;
    return true;
  }

  private _renderedKey: unknown[] | null = null;

  private _configKey(): unknown[] {
    const p = this._pipelines;
    return [this._blurFbos[0] ?? null, this._blurMethod, this.PASS_COUNT, this._blurDownscale,
      this._blurRadiusDown, this._blurRadiusUp, this._gaussianScale,
      this._gaussianHPipeline, this._gaussianVPipeline,
      p.downsample, p.upsample, p.passthrough, p.boxDown];
  }

  setDownscale(factor: number): void {
    if (factor === this._blurDownscale) return;
    this._blurDownscale = factor;
    // Level 0 changes size; the next paint rebuilds the pool.
    this._destroyTexturePool();
    this.setBlurRadius(this._targetRadius);
    this._repaint();
  }

  reload(): void {
    this._gaussianHPipeline = null;
    this._gaussianVPipeline = null;
    this._gaussianKernel = null;
    this._gaussianFetchPairs = 0;
    this.setBlurRadius(this._targetRadius);
  }

  clear(): void {
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

  // The texture pool; see resize() for the sizes.
  private _blurTextures: Cogl.Texture2D[] = [];

  private _blurFbos: Cogl.Offscreen[] = [];

  // The Gaussian horizontal pass output, per level.
  private _gaussianTempTextures: Cogl.Texture2D[] = [];

  private _gaussianTempFbos: Cogl.Offscreen[] = [];

  // Separate output targets per level, so no pass writes a framebuffer that
  // an earlier pass read. Deferred paint nodes make Cogl track dependencies
  // between framebuffers, and ping-ponging is a cycle it rejects; the passes
  // then lose their order and the composite reads an unwritten blur.
  private _upTextures: Cogl.Texture2D[] = [];

  private _upFbos: Cogl.Offscreen[] = [];

  // This frame's finished blur, read by the composite.
  private _blurResultTex: Cogl.Texture | null = null;

  private _gaussianHPipeline: Cogl.Pipeline | null = null;
  private _gaussianVPipeline: Cogl.Pipeline | null = null;

  private _blurMethod: BlurMethod = 1;

  // The kernel compiled into the H/V pipelines, and one waiting to be
  // compiled on the next paint.
  private _gaussianKernel: GaussianKernel | null = null;
  private _pendingGaussianKernel: GaussianKernel | null = null;
  private _gaussianPipelineDirty: boolean = false;

  // The sigma the compiled kernel was built for; radius changes that keep
  // the tap count only change kernel_scale = sigma / _gaussianBaseSigma.
  private _gaussianBaseSigma: number = 0;
  private _gaussianScale: number = 1.0;
  private _gaussianFetchPairs: number = 0;

  private _poolWidth: number = 0;

  private _poolHeight: number = 0;

  // glass-blur-downscale: 2 = half resolution (default), 4 = quarter.
  private _blurDownscale: number = 2;

  // Passes per direction. With 4: 1/2 → 1/4 → 1/8 → 1/16 → 1/8 → 1/4 → 1/2.
  private PASS_COUNT: number = 4;

  // The Kawase shaders' blur_radius uniforms.
  private _blurRadiusDown: number = 0.5;

  private _blurRadiusUp: number = 1.0;

  // The requested radius, before the per-method mapping.
  private _targetRadius: number = 15.0;

  // The caller drops the previous pipelines first.
  private _compileGaussianPipelines(ctx: Cogl.Context, kernel: GaussianKernel): void {
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

  /**
   * Allocates the pool for a (w, h) source. Level i is w >> (i + 1) wide
   * (level 0 at half resolution); glass-blur-downscale = 4 shifts every level
   * down one more step.
   */
  resize(ctx: Cogl.Context, w: number, h: number): void {
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

  // Dual Kawase: downsample srcTex through every level, then upsample back
  // into the _up* targets.
  private _runDualKawaseBlur(parentNode: any, srcTex: Cogl.Texture, srcUV: number[]): void {
    let currentSrc: Cogl.Texture = srcTex;

    for (let i = 0; i < this.PASS_COUNT; i++) {
      const destFbo = this._blurFbos[i] as unknown as CoglFB;
      const destTex = this._blurTextures[i];
      const destW = destTex.get_width();
      const destH = destTex.get_height();

      const invW = 1.0 / currentSrc.get_width();
      const invH = 1.0 / currentSrc.get_height();

      // Only the first pass reads the source, through srcUV.
      const uv = (i === 0) ? srcUV : [0, 0, 1, 1];

      // At downscale 4 the first pass is a 4x reduction, which Kawase's
      // kernel does not filter properly; the box filter does.
      const boxFirst = i === 0 && this._blurDownscale >= 4 && this._pipelines.boxDown !== null;
      const pipeline = boxFirst
        ? this._passes.pipeline('kawase-down-0-box', this._pipelines.boxDown!)
        : this._passes.pipeline(`kawase-down-${i}`, this._pipelines.downsample!);
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
      const destFbo = this._upFbos[i - 1] as unknown as CoglFB;
      const destTex = this._upTextures[i - 1];
      const destW = destTex.get_width();
      const destH = destTex.get_height();

      const invW = 1.0 / srcTexture.get_width();
      const invH = 1.0 / srcTexture.get_height();

      const pipeline = this._passes.pipeline(`kawase-up-${i}`, this._pipelines.upsample!);
      pipeline.set_layer_texture(0, srcTexture);
      setPipelineVec2(pipeline, 'inv_size', invW, invH);
      setPipelineFloat(pipeline, 'blur_radius', this._blurRadiusUp);

      this._passes.add(parentNode, destFbo, pipeline, destW, destH, [0, 0, 1, 1]);
    }

    this._blurResultTex = this._upTextures[0];
  }

  // Separable Gaussian on pool level 0 only: a downsampling pre-pass into
  // _blurTextures[0], the horizontal pass into the temp texture, and the
  // vertical pass into _upTextures[0].
  private _runGaussianBlur(parentNode: any, srcTex: Cogl.Texture, srcUV: number[]): void {
    const tempFbo = this._gaussianTempFbos[0] as unknown as CoglFB;
    const tempTex = this._gaussianTempTextures[0];
    const destFbo = this._blurFbos[0] as unknown as CoglFB;
    const destTex = this._blurTextures[0];
    const destW = destTex.get_width();
    const destH = destTex.get_height();

    // At downscale 2 one bilinear fetch averages the 2x2 footprint exactly;
    // at 4 the box filter is needed.
    const wideDownsample = this._blurDownscale >= 4 && this._pipelines.boxDown !== null;
    const prePipeline = wideDownsample
      ? this._passes.pipeline('gauss-pre-box', this._pipelines.boxDown!)
      : this._passes.pipeline('gauss-pre', this._pipelines.passthrough!);
    prePipeline.set_layer_texture(0, srcTex);
    if (wideDownsample) {
      setPipelineVec2(prePipeline, 'inv_size',
        1.0 / srcTex.get_width(), 1.0 / srcTex.get_height());
    }

    this._passes.add(parentNode, destFbo, prePipeline, destW, destH, srcUV);

    const hPipeline = this._passes.pipeline('gauss-h', this._gaussianHPipeline!);
    hPipeline.set_layer_texture(0, destTex);
    setPipelineVec2(hPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
    setPipelineFloat(hPipeline, 'kernel_scale', this._gaussianScale);

    this._passes.add(parentNode, tempFbo, hPipeline, destW, destH, [0, 0, 1, 1]);

    // Not back into destFbo, which the horizontal pass read (see _upTextures).
    const vPipeline = this._passes.pipeline('gauss-v', this._gaussianVPipeline!);
    vPipeline.set_layer_texture(0, tempTex);
    setPipelineVec2(vPipeline, 'inv_size', 1.0 / destW, 1.0 / destH);
    setPipelineFloat(vPipeline, 'kernel_scale', this._gaussianScale);

    const outFbo = this._upFbos[0] as unknown as CoglFB;
    this._passes.add(parentNode, outFbo, vPipeline, destW, destH, [0, 0, 1, 1]);

    this._blurResultTex = this._upTextures[0];
  }

  // Dropping the references frees the textures; GJS owns them, so
  // run_dispose() would free them twice.
  private _destroyTexturePool(): void {
    this._blurFbos = [];
    this._blurTextures = [];
    this._gaussianTempFbos = [];
    this._gaussianTempTextures = [];
    this._upFbos = [];
    this._upTextures = [];
    this._blurResultTex = null;
    // The reuse key holds the old source texture.
    this._renderedKey = null;
    this._poolWidth = 0;
    this._poolHeight = 0;
  }

  // Both methods share the pool, and the Gaussian kernel is compiled on the
  // next paint, so a repaint is all a switch needs.
  setBlurMethod(method: BlurMethod): void {
    if (this._blurMethod === method) return;
    this._blurMethod = method;
    this.setBlurRadius(this._targetRadius);
    this._repaint();
  }

  setBlurRadius(radius: number): void {
    this._targetRadius = radius;

    if (this._blurMethod === 0) {
      this._setGaussianBlurRadius(radius);
      return;
    }

    this._setDualKawaseBlurRadius(radius);
  }

  /**
   * The Gaussian uses one pool level, so a radius change never rebuilds the
   * pool. The tap count follows a 4-sigma cutoff; while it stays the same,
   * only kernel_scale changes and nothing is recompiled.
   */
  private _setGaussianBlurRadius(radius: number): void {
    // The radius is in screen pixels; one texel is RES_SCALE of them. The
    // sigma cap is in texels, so quarter resolution reaches twice as far.
    const RES_SCALE = this._blurDownscale >= 4 ? 4.0 : 2.0;
    const MAX_SIGMA_TEXEL = 15.0;

    // The kernel is at least one texel wide so it absorbs the downsample's
    // aliasing; a smaller radius only lowers kernel_scale.
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

    // A 4-sigma cutoff (3 sigma truncated visibly), two taps per fetch, and
    // at least two pairs.
    const sideTaps = Math.max(2, Math.ceil(kernelSigma * 4));
    const fetchPairs = Math.max(2, Math.ceil(sideTaps / 2));

    const needsRecompile =
      this._gaussianFetchPairs !== fetchPairs ||
      (!this._gaussianKernel && !this._pendingGaussianKernel);

    if (needsRecompile) {
      const kernel = computeGaussianKernel(kernelSigma, fetchPairs);
      this._pendingGaussianKernel = kernel;
      this._gaussianPipelineDirty = true;
      this._gaussianFetchPairs = fetchPairs;
      this._gaussianBaseSigma = kernelSigma;
      this._gaussianScale = sigmaTexel / kernelSigma;
    } else {
      this._gaussianScale = this._gaussianBaseSigma > 0
        ? sigmaTexel / this._gaussianBaseSigma
        : 1.0;
    }

    // Coming from no blur or from Dual Kawase: the next paint rebuilds the pool.
    if (this.PASS_COUNT !== 1) {
      this.PASS_COUNT = 1;
      this._destroyTexturePool();
    }

    this._repaint();
  }

  // An empirical mapping (the preferences say a Dual Kawase radius is not
  // pixel-accurate). It is not scaled for glass-blur-downscale, since that
  // would also change the pass count; at quarter resolution the same value
  // gives a wider blur.
  private _setDualKawaseBlurRadius(radius: number): void {
    let newPassCount = 0;
    let offsetDown = 0.0;
    let offsetUp = 0.0;

    if (radius > 0) {
      let p = Math.floor(Math.log2(radius + 1));
      newPassCount = Math.max(1, Math.min(4, p));

      // Position within this pass count's radius range, eased with a cubic
      // Hermite (C1 continuous) and mapped onto the tap offset.
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
