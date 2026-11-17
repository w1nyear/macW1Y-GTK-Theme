import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import { QS_MENU_TOGGLE_CLASS, offscreenFormat, paintNodeWithContext, setUniformVector, uniformDeclarations, safeRegisterClass } from './shellVersion.js';
import { GlassActor, StageCopier, addBlit, createTarget, isPaintingView, RelaySet, localToStage } from './rendering/backdropGlass.js';
import { configureSamplerLayer } from './rendering/pipelines.js';
import { setTranslationIfChanged, setScaleIfChanged, isActorValid } from './actors.js';




const TRANSPARENT_OVERRIDE = 'background-color: transparent !important;';

function _withOverride(origStyle) {
    return origStyle ? `${origStyle} ${TRANSPARENT_OVERRIDE}` : TRANSPARENT_OVERRIDE;
}

function _releaseEntry(pod, entry) {
    if (entry.destroyId)
        pod.disconnect(entry.destroyId);
    for (const { actor, origStyle } of entry.styledSubs) {
        if (actor instanceof St.Widget)
            actor.set_style(origStyle || null);
    }
}

export class ToggleStyles {
    _logger;
    _isOpen;

    constructor(_logger, _isOpen) {
        this._logger = _logger;
        this._isOpen = _isOpen;
    }

    sync(root) {
        const toggles = this._findAllToggleContainers(root);
        this._ensureToggleStyles(toggles);
        return toggles;
    }

    colorFor(actor) {
        return this._toggleRegions.get(actor);
    }


    resetDiagnostics() {
        this._debugToggleColorLogFrames = 15;
    }




    static TOGGLE_COLOR_SAMPLE_MS = 100;


    static TOGGLE_COLOR_FULL_PASS_EVERY = 8;


    _toggleRegions = new Map();
    _toggleColorTimerId = 0;
    _resamplePassCount = 0;
    _debugToggleColorLogFrames = 15;











    _findAllToggleContainers(actor, found = [], inSystemItem = false) {
        if (!actor)
            return found;
        const leaf = this._toggleLeafKind(actor, inSystemItem);
        if (leaf === 'slider') {
            if (actor.visible && this._paintsOwnBackground(actor))
                found.push(actor);
            return found;
        }
        if (leaf === 'toggle') {
            if (actor.visible)
                found.push(actor);
            return found;
        }
        let entersSystemItem = inSystemItem ||
            (actor instanceof St.Widget && actor.has_style_class_name('quick-settings-system-item'));
        for (let child of actor.get_children())
            this._findAllToggleContainers(child, found, entersSystemItem);
        return found;
    }

    _toggleLeafKind(actor, inSystemItem) {
        if (!(actor instanceof St.Widget))
            return null;
        if (actor.has_style_class_name(QS_MENU_TOGGLE_CLASS))
            return 'toggle';
        if (actor.has_style_class_name('quick-toggle'))
            return 'toggle';

        if (inSystemItem && actor.has_style_class_name('icon-button'))
            return 'toggle';
        if (actor.has_style_class_name('quick-slider'))
            return 'slider';
        return null;
    }





    _paintsOwnBackground(actor) {
        if (this._toggleRegions.has(actor))
            return true;
        let bg = this._readThemeBg(actor);
        return !!(bg && bg.a > 0.02);
    }




    _getStylableSubActors(pod) {
        const found = [];
        const walk = (actor) => {
            if (actor instanceof St.Widget)
                found.push(actor);
            for (let child of actor.get_children())
                walk(child);
        };
        walk(pod);
        return found;
    }



    _getPrimaryToggleButton(pod) {
        if (pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS)) {
            let found = null;
            const search = (actor) => {
                if (found)
                    return;
                for (let child of actor.get_children()) {
                    if (found)
                        return;
                    if (child instanceof St.Widget && child.has_style_class_name('quick-toggle')) {
                        found = child;
                        return;
                    }
                    search(child);
                }
            };
            search(pod);
            if (found)
                return found;
        }
        return pod;
    }


    _getToggleIconActors(root) {
        const found = [];
        const walk = (actor) => {
            if (actor instanceof St.Widget && actor.has_style_class_name('quick-toggle-icon')) {
                found.push(actor);
            }
            for (let child of actor.get_children())
                walk(child);
        };
        if (root)
            walk(root);
        return found;
    }



    _readThemeBg(actor) {
        if (!(actor instanceof St.Widget))
            return null;
        actor.ensure_style();
        let themeNode = actor.get_theme_node();
        let bg = themeNode.get_background_color();
        if (bg.alpha / 255 > 0.02)
            return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };
        let [gradType, start, end] = themeNode.get_background_gradient();
        if (gradType !== St.GradientType.NONE) {
            let a = ((start.alpha + end.alpha) / 2) / 255;
            if (a > 0.02) {
                return {
                    r: ((start.red + end.red) / 2) / 255,
                    g: ((start.green + end.green) / 2) / 255,
                    b: ((start.blue + end.blue) / 2) / 255,
                    a,
                };
            }
        }
        return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };
    }




    // color really showing there. `a` is the accumulated coverage.
    _compositeOverAncestors(actor, own) {

        let outR = 0, outG = 0, outB = 0, outA = 0;
        const add = (c) => {
            if (!c || !(c.a > 0))
                return;
            let w = c.a * (1 - outA);
            outR += c.r * w;
            outG += c.g * w;
            outB += c.b * w;
            outA += w;
        };
        add(own);
        let node = actor ? actor.get_parent() : null;

        let guard = 32;
        while (node && outA < 0.995 && guard-- > 0) {
            if (node instanceof St.Widget)
                add(this._readThemeBg(node));
            node = node.get_parent();
        }
        if (outA <= 0)
            return { r: 0, g: 0, b: 0, a: 0 };
        return { r: outR / outA, g: outG / outA, b: outB / outA, a: outA };
    }







    _samplePodColor(pod, primary) {
        let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS);
        let candidates = [primary];
        if (isHasMenu && pod !== primary)
            candidates.push(pod);
        for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod)) {
            if (icon !== primary && icon !== pod)
                candidates.push(icon);
        }
        let bestActor = null;
        let bestOwn = null;
        for (let candidate of candidates) {
            let own = this._readThemeBg(candidate);
            if (!own)
                continue;
            if (!bestOwn || own.a > bestOwn.a) {
                bestOwn = own;
                bestActor = candidate;
            }
        }
        if (bestOwn && bestOwn.a > 0.02) {
            return this._compositeOverAncestors(bestActor, bestOwn);
        }

        return this._compositeOverAncestors(pod, null);
    }





    _ensureToggleStyles(toggles) {
        for (let pod of toggles) {
            if (!(pod instanceof St.Widget))
                continue;
            const entry = this._ensureEntry(pod);
            const primary = this._getPrimaryToggleButton(pod);


            if (primary instanceof St.Widget && !this._hasOverride(primary))
                this._updateBaseColor(entry, pod, primary);
            this._overrideSubStyles(entry, pod);
        }
    }

    _ensureEntry(pod) {
        let entry = this._toggleRegions.get(pod);
        if (entry)
            return entry;

        entry = { destroyId: 0, baseColor: [1.0, 1.0, 1.0], baseAlpha: 0, styledSubs: [], stateKey: '' };
        this._toggleRegions.set(pod, entry);
        entry.destroyId = pod.connect('destroy', () => {
            this._toggleRegions.delete(pod);
        });
        return entry;
    }

    _hasOverride(actor) {
        const style = actor.get_style();
        return !!style && style.includes(TRANSPARENT_OVERRIDE);
    }

    _updateBaseColor(entry, pod, primary) {
        const sampled = this._samplePodColor(pod, primary);

        if (sampled.a > 0.02) {
            entry.baseColor = [sampled.r, sampled.g, sampled.b];
            entry.baseAlpha = sampled.a;
        }
        return sampled;
    }

    _overrideSubStyles(entry, pod) {
        const known = new Set(entry.styledSubs.map(s => s.actor));
        for (let sub of this._getStylableSubActors(pod)) {
            if (!(sub instanceof St.Widget) || this._hasOverride(sub))
                continue;
            const origStyle = sub.get_style() || '';
            sub.set_style(_withOverride(origStyle));
            if (!known.has(sub))
                entry.styledSubs.push({ actor: sub, origStyle });
        }
    }



    _resampleToggleColors() {
        let forceFull = (this._resamplePassCount++ % ToggleStyles.TOGGLE_COLOR_FULL_PASS_EVERY) === 0;
        for (const [pod, entry] of this._toggleRegions.entries())
            this._resamplePod(pod, entry, forceFull);
        if (this._debugToggleColorLogFrames > 0)
            this._debugToggleColorLogFrames--;
    }

    _resamplePod(pod, entry, forceFull) {
        const primary = this._getPrimaryToggleButton(pod);
        const stateKey = this._podStateKey(pod, primary);
        if (!forceFull && stateKey === entry.stateKey)
            return;
        entry.stateKey = stateKey;
        for (const { actor, origStyle } of entry.styledSubs) {
            if (actor instanceof St.Widget)
                actor.set_style(origStyle || null);
        }
        if (this._releaseIfSliderLostPill(pod, entry))
            return;
        if (primary instanceof St.Widget) {
            const sampled = this._updateBaseColor(entry, pod, primary);
            if (this._debugToggleColorLogFrames > 0)
                this._logPodColor(pod, primary, entry, sampled);
        }
        for (const { actor, origStyle } of entry.styledSubs) {
            if (actor instanceof St.Widget)
                actor.set_style(_withOverride(origStyle));
        }
    }






    _releaseIfSliderLostPill(pod, entry) {
        if (!(pod instanceof St.Widget) || !pod.has_style_class_name('quick-slider'))
            return false;
        const pill = this._readThemeBg(pod);
        if (pill && pill.a > 0.02)
            return false;
        this._logger.log(`[Liquid Glass][toggle-color] releasing .quick-slider pod — theme no longer paints a pill ` +
            `(bg=${JSON.stringify(pill)})`);
        if (entry.destroyId)
            pod.disconnect(entry.destroyId);
        this._toggleRegions.delete(pod);
        return true;
    }

    _logPodColor(pod, primary, entry, sampled) {
        let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS);
        let podCls = pod instanceof St.Widget ? (pod.get_style_class_name() || '') : '';
        let primaryCls = primary.get_style_class_name() || '';
        let checked = primary.has_style_pseudo_class('checked');

        let wrapperBg = isHasMenu ? this._readThemeBg(pod) : null;
        let iconBgs = this._getToggleIconActors(pod !== primary ? primary : pod)
            .map(a => JSON.stringify(this._readThemeBg(a))).join(' ');
        this._logger.log(`[Liquid Glass][toggle-color] pod class="${podCls}" isHasMenu=${isHasMenu} ` +
            `primary class="${primaryCls}" checked=${checked} ` +
            `primaryBg=${JSON.stringify(this._readThemeBg(primary))} ` +
            `wrapperBg=${wrapperBg ? JSON.stringify(wrapperBg) : 'n/a'} ` +
            `iconBg=[${iconBgs || 'none'}] ` +
            `chosen.a=${sampled.a.toFixed(2)} trusted=${sampled.a > 0.02} ` +
            `entry.baseColor=[${entry.baseColor.map(v => v.toFixed(2)).join(',')}] entry.baseAlpha=${entry.baseAlpha.toFixed(2)}`);
    }

    start() {
        this._resampleToggleColors();
        if (this._toggleColorTimerId !== 0)
            return;
        this._toggleColorTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ToggleStyles.TOGGLE_COLOR_SAMPLE_MS, () => {
            if (!this._isOpen()) {
                this._toggleColorTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._resampleToggleColors();
            return GLib.SOURCE_CONTINUE;
        });
    }


    _podStateKey(pod, primary) {
        const STATES = ['checked', 'hover', 'active', 'insensitive', 'focus', 'selected'];
        let actors = [pod];
        if (primary !== pod)
            actors.push(primary);
        for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod))
            actors.push(icon);
        let key = '';
        for (let actor of actors) {
            if (!(actor instanceof St.Widget)) {
                key += '?|';
                continue;
            }
            for (let state of STATES)
                key += actor.has_style_pseudo_class(state) ? '1' : '0';
            key += '|';
        }
        return key;
    }

    stop() {
        if (this._toggleColorTimerId !== 0) {
            GLib.source_remove(this._toggleColorTimerId);
            this._toggleColorTimerId = 0;
        }
    }


    clear() {
        this.stop();
        for (const [pod, entry] of this._toggleRegions.entries())
            _releaseEntry(pod, entry);
        this._toggleRegions.clear();
    }
}


















const READER_BASE = 256;

export const BackdropReader = safeRegisterClass({ GTypeName: 'WackGlass_BackdropReader' }, paintNodeWithContext(class BackdropReader extends Clutter.Actor {
    _init(logger) {
        super._init({ name: 'liquid-glass-backdrop-reader', reactive: false, width: READER_BASE, height: READER_BASE });
        Shell.util_set_hidden_from_pick(this, true);
        this.copier = new StageCopier(logger);
        this._rect = null;
    }

    vfunc_pick(_pickContext) {
    }



    setStageRect(rect) {


        if (!rect.every(Number.isFinite))
            return;
        this._rect = rect;
        const parent = this.get_parent();
        if (!parent)
            return;
        const [ok0, x0, y0] = parent.transform_stage_point(rect[0], rect[1]);
        const [ok1, x1, y1] = parent.transform_stage_point(rect[2], rect[3]);
        if (!ok0 || !ok1 || ![x0, y0, x1, y1].every(Number.isFinite))
            return;
        setTranslationIfChanged(this, x0, y0);
        setScaleIfChanged(this, Math.max(x1 - x0, 1) / READER_BASE, Math.max(y1 - y0, 1) / READER_BASE);
    }

    vfunc_paint_node(root, paintContext) {
        if (this._rect)
            this.copier.take(this, root, paintContext, this._rect);
    }
}));



const COMPOSE_DECL = 'uniform vec4 d_rect;\nuniform vec4 m_rect;\n';
const COMPOSE_BODY = 'vec2 uv = cogl_tex_coord_in[0].st;\n' +
    'vec4 d = texture2D(cogl_sampler0, mix(d_rect.xy, d_rect.zw, uv));\n' +
    'vec4 m = texture2D(cogl_sampler1, mix(m_rect.xy, m_rect.zw, uv));\n' +
    'cogl_color_out = m + d * (1.0 - m.a);\n';

export const ToggleBackdropGlass = safeRegisterClass({ GTypeName: 'WackGlass_ToggleBackdropGlass' }, paintNodeWithContext(class ToggleBackdropGlass extends GlassActor {
    _init(params = {}) {
        super._init(params);
        this.reader = new BackdropReader(params.logger);
        this.reader.hide();
        this._relays = new RelaySet(this, actor => actor === this.reader);
        this._wasPainted = false;
        this._material = null;
        this._materialUV = null;
        this._materialCopies = 0;
        this._composed = null;
        this._composeSerial = 0;
        this._composeBase = null;
    }



    vfunc_map() {
        super.vfunc_map();
        this.reader.show();
        this._relays.redrawArea();
    }

    vfunc_unmap() {
        this.reader.hide();
        super.vfunc_unmap();
    }

    _onShadersLoaded() {
        super._onShadersLoaded();
        this._relays.redrawArea();
    }


    syncSources() {
        const area = this._sampleAreaRect();
        if (!area)
            return;
        const changed = this._relays.sync(area);
        this.reader.setStageRect(localToStage(this, area[0], area[1], area[0] + area[2], area[1] + area[3]));
        const painted = this.get_paint_opacity() > 0;
        if (changed || (painted && !this._wasPainted))
            this._relays.redrawArea();
        this._wasPainted = painted;
        this.reader.copier.prune(this.reader.peek_stage_views());
    }

    vfunc_paint_node(root, paintContext) {
        const ctx = this._beginPaint();
        if (!ctx)
            return;
        const scale = this._paintScale();
        const s = this._sampleShaderRect();
        if (!scale || !s)
            return;
        const { kx, ky, resW, resH } = scale;
        const local = [s[0] * kx, s[1] * ky, (s[0] + s[2]) * kx, (s[1] + s[3]) * ky];
        const desktop = this.reader.copier.lastCopy;
        if (!desktop?.rect) {

            this._relays.redrawArea();
            return;
        }
        this._takeMaterial(root, paintContext, local);
        if (!this._material || !this._materialUV)
            return;
        const composed = this._compose(root, ctx, desktop.texture, desktop.rect, local);
        if (!composed)
            return;
        this._runBlur(root, ctx, composed.texture, s, [composed.texture, this._composeSerial]);
        const compositeRect = this._composite(root, composed.texture, s, kx, ky, resW, resH);
        this._snapshot(() => {
            const round = (v) => +v.toFixed(2);
            return {
                mode: 'toggle-backdrop',
                desktop: `${desktop.width}x${desktop.height}`,
                desktopStageRect: desktop.rect?.map(round) ?? null,
                material: `${this._material.width}x${this._material.height}`,
                blurRect: s.map(round),
                compositeRect: compositeRect.map(round),
            };
        });
    }


    _offscreenAncestor() {
        for (let a = this.get_parent(); a; a = a.get_parent()) {
            if (a.get_offscreen_redirect() & Clutter.OffscreenRedirect.ALWAYS)
                return a;
        }
        return null;
    }









    _takeMaterial(root, paintContext, local) {
        if (this.is_in_clone_paint() || !isPaintingView())
            return;
        const fb = paintContext.get_framebuffer();
        if (!(fb instanceof Cogl.Offscreen) || StageCopier.liveView(this, paintContext))
            return;
        const menu = this._offscreenAncestor();
        const pv = menu?.get_paint_volume();
        if (!menu || !pv)
            return;

        const origin = pv.get_origin();
        const width = Math.round(pv.get_width());
        const height = Math.round(pv.get_height());
        const offX = Math.trunc(Math.ceil(origin.x + pv.get_width() + 0.75) - width - 3);
        const offY = Math.trunc(Math.ceil(origin.y + pv.get_height() + 0.75) - height - 3);
        const cs = menu.get_resource_scale();
        const a = this.apply_relative_transform_to_point(menu, new Graphene.Point3D({ x: local[0], y: local[1], z: 0 }));
        const b = this.apply_relative_transform_to_point(menu, new Graphene.Point3D({ x: local[2], y: local[3], z: 0 }));
        const sx0 = (Math.min(a.x, b.x) - offX) * cs;
        const sy0 = (Math.min(a.y, b.y) - offY) * cs;
        const sx1 = (Math.max(a.x, b.x) - offX) * cs;
        const sy1 = (Math.max(a.y, b.y) - offY) * cs;
        const fx0 = Math.max(0, Math.floor(sx0));
        const fy0 = Math.max(0, Math.floor(sy0));
        const fx1 = Math.min(fb.get_width(), Math.ceil(sx1));
        const fy1 = Math.min(fb.get_height(), Math.ceil(sy1));
        const w = fx1 - fx0;
        const h = fy1 - fy0;
        if (!(w >= 1) || !(h >= 1))
            return;
        if (!this._material || this._material.width !== w || this._material.height !== h) {
            const target = createTarget(w, h, offscreenFormat(fb), this._logger);
            this._material = target ? { ...target, width: w, height: h } : null;
            if (!this._material)
                return;
        }
        addBlit(root, fb, this._material.framebuffer, this.color_state, [fx0, fy0, w, h]);
        this._materialUV = [(sx0 - fx0) / w, (sy0 - fy0) / h, (sx1 - fx0) / w, (sy1 - fy0) / h];
        this._materialCopies++;
    }



    _compose(root, ctx, desktop, desktopRect, local) {
        const material = this._material;
        const w = material.width;
        const h = material.height;
        if (!this._composed || this._composed.width !== w || this._composed.height !== h) {
            const target = createTarget(w, h, null, this._logger);
            this._composed = target ? { ...target, width: w, height: h } : null;
            if (!this._composed)
                return null;
        }
        if (!this._composeBase) {
            this._composeBase = Cogl.Pipeline.new(ctx);
            configureSamplerLayer(this._composeBase, 0);
            configureSamplerLayer(this._composeBase, 1);
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, uniformDeclarations(COMPOSE_DECL), null);
            snippet.set_replace(COMPOSE_BODY);
            this._composeBase.add_snippet(snippet);
        }
        const pipeline = this._renderer.passes.pipeline('toggle-compose', this._composeBase);
        pipeline.set_layer_texture(0, desktop);
        pipeline.set_layer_texture(1, material.texture);

        const st = localToStage(this, local[0], local[1], local[2], local[3]);
        const dw = desktopRect[2] - desktopRect[0];
        const dh = desktopRect[3] - desktopRect[1];
        setUniformVector(pipeline, 'd_rect', [
            (st[0] - desktopRect[0]) / dw, (st[1] - desktopRect[1]) / dh,
            (st[2] - desktopRect[0]) / dw, (st[3] - desktopRect[1]) / dh,
        ]);
        setUniformVector(pipeline, 'm_rect', this._materialUV);
        this._renderer.passes.add(root, this._composed.framebuffer, pipeline, w, h, [0, 0, 1, 1]);
        this._composeSerial++;
        return this._composed;
    }


    get stats() {
        const c = this.reader.copier;
        return {
            paints: this._paints, copies: c.copyCount, reuses: c.reuseCount, misses: c.missCount,
            offStage: c.offStageCount, materialCopies: this._materialCopies,
        };
    }

    describe() {
        return {
            ...super.describe(),
            ...this.stats,
            relays: this._relays.names(),
            relayChanges: this._relays.changes,
            sampleArea: this._relays.areaRect(),
        };
    }



    cleanup() {
        super.cleanup();
        this._relays.clear();
        this.reader.copier.clear();
        if (isActorValid(this.reader))
            this.reader.destroy();
        this._material = null;
        this._composed = null;
        this._composeBase = null;
    }
}));
