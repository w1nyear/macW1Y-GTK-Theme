import GObject from 'gi://GObject';

import * as utils from '../conveniences/utils.js';
import * as uniforms from '../conveniences/shader_uniforms.js';
const St = await utils.import_in_shell_only('gi://St');
const Shell = await utils.import_in_shell_only('gi://Shell');
const Clutter = await utils.import_in_shell_only('gi://Clutter');

const SHADER_FILENAME = 'gradient_panel.glsl';
const SHADER_SOURCE = utils.get_shader_source(Shell, SHADER_FILENAME, import.meta.url);
const DEFAULT_PARAMS = {
    top_darkness: 0.0,
    bottom_darkness: 0.0,
    top_blur: 0.0,
    bottom_blur: 0.0,
    width: 0.0,
    height: 0.0,
    clip: [0, 0, -1, -1],
};

const GRADIENT_PANEL_EFFECT_META = {
    GTypeName: "GradientPanelEffect",
    Properties: {
        'top_darkness': GObject.ParamSpec.double(
            'top_darkness',
            'Top darkness',
            'Darkness amount at the top (0 = clear, 1 = black)',
            GObject.ParamFlags.READWRITE,
            0.0, 1.0,
            0.65,
        ),
        'bottom_darkness': GObject.ParamSpec.double(
            'bottom_darkness',
            'Bottom darkness',
            'Darkness amount at the bottom (0 = clear, 1 = black)',
            GObject.ParamFlags.READWRITE,
            0.0, 1.0,
            0.0,
        ),
        'top_blur': GObject.ParamSpec.double(
            'top_blur',
            'Top blur',
            'Blur radius at the top',
            GObject.ParamFlags.READWRITE,
            0.0, 100.0,
            20.0,
        ),
        'bottom_blur': GObject.ParamSpec.double(
            'bottom_blur',
            'Bottom blur',
            'Blur radius at the bottom',
            GObject.ParamFlags.READWRITE,
            0.0, 100.0,
            0.0,
        ),
        'width': GObject.ParamSpec.double(
            'width',
            'Width',
            'Width',
            GObject.ParamFlags.READWRITE,
            0.0, Number.MAX_SAFE_INTEGER,
            0.0,
        ),
        'height': GObject.ParamSpec.double(
            'height',
            'Height',
            'Height',
            GObject.ParamFlags.READWRITE,
            0.0, Number.MAX_SAFE_INTEGER,
            0.0,
        ),
    }
};

const GradientPanelEffectClass = utils.IS_IN_PREFERENCES ? null : class GradientPanelEffect extends Clutter.ShaderEffect {
    constructor(params) {
        super();
        utils.initialize_shader_effect(this, SHADER_SOURCE);

        this._clip_x0 = null;
        this._clip_y0 = null;
        this._clip_width = null;
        this._clip_height = null;

        utils.setup_params(this, params);

        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        theme_context.connectObject('notify::scale-factor', _ => this.update_scale(), this);
    }

    static get default_params() {
        return DEFAULT_PARAMS;
    }

    update_scale() {
        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        const scale = theme_context ? theme_context.scale_factor : 1;
        const top = this._top_blur ?? DEFAULT_PARAMS.top_blur;
        const bottom = this._bottom_blur ?? DEFAULT_PARAMS.bottom_blur;
        uniforms.set_uniform(this, 'top_blur', parseFloat(top * scale));
        uniforms.set_uniform(this, 'bottom_blur', parseFloat(bottom * scale));
    }

    get top_darkness() {
        return this._top_darkness;
    }

    set top_darkness(value) {
        if (this._top_darkness !== value) {
            this._top_darkness = value;
            uniforms.set_uniform(this, 'top_darkness', parseFloat(this._top_darkness));
        }
    }

    get bottom_darkness() {
        return this._bottom_darkness;
    }

    set bottom_darkness(value) {
        if (this._bottom_darkness !== value) {
            this._bottom_darkness = value;
            uniforms.set_uniform(this, 'bottom_darkness', parseFloat(this._bottom_darkness));
        }
    }

    get top_blur() {
        return this._top_blur;
    }

    set top_blur(value) {
        if (this._top_blur !== value) {
            this._top_blur = value;
            this.update_scale();
            this.queue_repaint();
        }
    }

    get bottom_blur() {
        return this._bottom_blur;
    }

    set bottom_blur(value) {
        if (this._bottom_blur !== value) {
            this._bottom_blur = value;
            this.update_scale();
            this.queue_repaint();
        }
    }

    get width() {
        return this._width;
    }

    set width(value) {
        const v = Math.max(1, value || 1);
        if (this._width !== v) {
            this._width = v;
            uniforms.set_uniform(this, 'width', parseFloat(this._width + 3.0 - 1e-6));
        }
    }

    get height() {
        return this._height;
    }

    set height(value) {
        const v = Math.max(1, value || 1);
        if (this._height !== v) {
            this._height = v;
            uniforms.set_uniform(this, 'height', parseFloat(this._height + 3.0 - 1e-6));
        }
    }

    detach_actor_clip_sync(actor = this.get_actor()) {
        if (!actor || !this._actor_connection_clip_rect_id)
            return;
        actor.disconnect(this._actor_connection_clip_rect_id);
        this._actor_connection_clip_rect_id = null;
    }

    sync_actor_clip(actor) {
        this.detach_actor_clip_sync(actor);
        this.clip = actor.has_clip ? actor.get_clip() : [0, 0, -10, -10];
        this._actor_connection_clip_rect_id = actor.connect('notify::clip-rect', _ => {
            this.clip = actor.has_clip ? actor.get_clip() : [0, 0, -10, -10];
        });
    }

    get clip() {
        return [this._clip_x0, this._clip_y0, this._clip_width, this._clip_height];
    }

    set clip(value) {
        [this._clip_x0, this._clip_y0, this._clip_width, this._clip_height] = value;
        uniforms.set_uniform(this, 'clip_x0', parseFloat(this._clip_x0 - 1e-6));
        uniforms.set_uniform(this, 'clip_y0', parseFloat(this._clip_y0 - 1e-6));
        uniforms.set_uniform(this, 'clip_width', parseFloat(this._clip_width <= 0 ? -1 : this._clip_width + 3 - 1e-6));
        uniforms.set_uniform(this, 'clip_height', parseFloat(this._clip_height <= 0 ? -1 : this._clip_height + 3 - 1e-6));
    }

    vfunc_set_actor(actor) {
        if (this._actor_connection_size_id) {
            let old_actor = this.get_actor();
            old_actor?.disconnect(this._actor_connection_size_id);
        }
        this.detach_actor_clip_sync();

        if (actor) {
            this.width = actor.width;
            this.height = actor.height;
            this._actor_connection_size_id = actor.connect('notify::size', _ => {
                this.width = actor.width;
                this.height = actor.height;
            });
            this.sync_actor_clip(actor);
        } else {
            this._actor_connection_size_id = null;
        }

        super.vfunc_set_actor(actor);
    }

    vfunc_paint_target(paint_node, paint_context) {
        uniforms.upload_uniforms(this);
        super.vfunc_paint_target(paint_node, paint_context);
    }
};

export const GradientPanelEffect = utils.IS_IN_PREFERENCES
    ? { default_params: DEFAULT_PARAMS }
    : utils.register_shader_effect(GRADIENT_PANEL_EFFECT_META, GradientPanelEffectClass, SHADER_SOURCE);
