import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as uniforms from './shader_uniforms.js';
import * as utils from './utils.js';
















export const Pipeline = class Pipeline {
    constructor(effects_manager, pipelines_manager, pipeline_id, actor = null, options = {}) {
        this.effects_manager = effects_manager;
        this.pipelines_manager = pipelines_manager;
        this.effects = [];
        this.effect_overrides = options.effect_overrides ?? {};
        this.set_pipeline_id(pipeline_id);
        this.attach_pipeline_to_actor(actor);
    }







    create_background_with_effects(
        monitor_index,
        background_managers,
        background_group,
        widget_name,
        use_absolute_position = true
    ) {
        let monitor = Main.layoutManager.monitors[monitor_index];

        this.remove_pipeline_from_actor();


        this.actor = new St.Widget({
            name: widget_name,
            x: use_absolute_position ? monitor.x : 0,
            y: utils.subpixel_stage_offset() + (use_absolute_position ? monitor.y : 0),
            z_position: 1,
            width: monitor.width,
            height: monitor.height
        });

        if (this.pipeline_id)
            this.attach_pipeline_to_actor(this.actor);

        let bg_manager = new Background.BackgroundManager({
            container: this.actor,
            monitorIndex: monitor_index,
            controlPosition: false,
        });
        bg_manager._bms_pipeline = this;





        this.child_added_id = this.actor.connect(
            'child-added', (container, child) => {
                if (child instanceof Meta.BackgroundActor)
                    container.set_child_below_sibling(child, null);
            }
        );

        background_managers.push(bg_manager);
        background_group.insert_child_at_index(this.actor, 0);

        return this.actor;
    };




    set_pipeline_id(pipeline_id) {

        this.remove_connections();


        this.pipeline_id = pipeline_id;


        this._pipeline_changed_id = this.pipelines_manager.connect(
            this.pipeline_id + '::pipeline-updated',
            (_, new_pipeline) => this.update_effects_from_pipeline(new_pipeline)
        );
        this._pipeline_destroyed_id = this.pipelines_manager.connect(
            this.pipeline_id + '::pipeline-destroyed',
            _ => this.change_pipeline_to("pipeline_default")
        );
    }



    remove_connections() {
        if (this._pipeline_changed_id)
            this.pipelines_manager.disconnect(this._pipeline_changed_id);
        if (this._pipeline_destroyed_id)
            this.pipelines_manager.disconnect(this._pipeline_destroyed_id);
        this._pipeline_changed_id = null;
        this._pipeline_destroyed_id = null;
    }


    attach_pipeline_to_actor(actor) {
        if (!actor) {
            this.remove_pipeline_from_actor();
            return;
        }

        this.disconnect_actor_destroy();
        this.actor = actor;


        let pipeline = this.pipelines_manager.pipelines[this.pipeline_id];
        if (!pipeline) {
            this._warn(`could not attach pipeline to actor, pipeline "${this.pipeline_id}" not found`);

            if ("pipeline_default" in this.pipelines_manager.pipelines) {
                this.set_pipeline_id("pipeline_default");
                pipeline = this.pipelines_manager.pipelines["pipeline_default"];
            } else
                return;
        }

        this.actor_destroy_id = this.actor.connect(
            "destroy", () => this.remove_pipeline_from_actor()
        );


        this.update_effects_from_pipeline(pipeline);
    }

    remove_pipeline_from_actor() {
        this.remove_all_effects();
        this.disconnect_actor_destroy();
        this.disconnect_child_added();
        this.actor = null;
    }

    disconnect_actor_destroy() {
        if (this.actor && this.actor_destroy_id) {
            this.actor.disconnect(this.actor_destroy_id);
        }
        this.actor_destroy_id = null;
    }

    disconnect_child_added() {
        if (this.actor && this.child_added_id) {
            this.actor.disconnect(this.child_added_id);
        }
        this.child_added_id = null;
    }


    update_effects_from_pipeline(pipeline) {

        this.remove_all_effects();


        pipeline.effects.forEach(effect => {
            if (effect.type === 'pixelize')
                this.build_pixelize_effect(effect);
            else if ('new_' + effect.type + '_effect' in this.effects_manager)
                this.build_effect(effect);
            else
                this._warn(`could not add effect to actor, effect "${effect.type}" not found`);
        });
        this.effects.reverse();


        if (this.actor)
            this.effects.forEach(effect => {
                this.actor.add_effect(effect);
                uniforms.mark_dirty(effect);
            });
        else
            this._warn(`could not add effect to actor, actor does not exist anymore`);
    }

    build_pixelize_effect(effect_infos) {
        const effect_params = this.get_effect_params(effect_infos);
        const effect_overrides = this.get_effect_overrides(effect_infos.type, effect_params);
        const params = {
            ...effect_params,
            ...effect_overrides,
        };

        const downscale = this.effects_manager.new_downscale_effect({
            divider: params.factor,
            downsampling_mode: params.downsampling_mode,
            opacity_factor: params.opacity_factor,
        });
        const upscale = this.effects_manager.new_upscale_effect({
            factor: params.factor,
            opacity_factor: params.opacity_factor,
        });

        this.setup_effect(downscale, effect_infos, effect_params, 'downscale');
        this.setup_effect(upscale, effect_infos, effect_params, 'upscale');
    }



    build_effect(effect_infos) {
        const effect_params = this.get_effect_params(effect_infos);
        const effect_overrides = this.get_effect_overrides(effect_infos.type, effect_params);
        let effect = this.effects_manager['new_' + effect_infos.type + '_effect']({
            ...effect_params,
            ...effect_overrides,
        });
        this.setup_effect(effect, effect_infos, effect_params);
    }

    setup_effect(effect, effect_infos, effect_params, pixelize_role = null) {
        effect._bms_effect_type = effect_infos.type;
        effect._bms_effect_id = effect_infos.id;
        effect._bms_effect_params = effect_params;
        effect._bms_pixelize_role = pixelize_role;
        this.effects.push(effect);


        effect._effect_key_removed_id = this.pipelines_manager.connect(
            this.pipeline_id + '::effect-' + effect_infos.id + '-key-removed', (_, key) => {
                const default_value = this.get_effect_default_param(effect, key);
                effect._bms_effect_params[key] = default_value;
                if (!this.apply_effect_override(effect, key))
                    this.set_effect_param(effect, key, default_value);
            }
        );
        effect._effect_key_updated_id = this.pipelines_manager.connect(
            this.pipeline_id + '::effect-' + effect_infos.id + '-key-updated', (_, key, value) => {
                effect._bms_effect_params[key] = value;
                if (!this.apply_effect_override(effect, key))
                    this.set_effect_param(effect, key, value);
            }
        );
        effect._effect_key_added_id = this.pipelines_manager.connect(
            this.pipeline_id + '::effect-' + effect_infos.id + '-key-added', (_, key, value) => {
                effect._bms_effect_params[key] = value;
                if (!this.apply_effect_override(effect, key))
                    this.set_effect_param(effect, key, value);
            }
        );
    }

    get_effect_params(effect_infos) {
        const effect_class = this.effects_manager.SUPPORTED_EFFECTS[effect_infos.type]?.class;
        return {
            ...(effect_class?.default_params ?? {}),
            ...(effect_infos.params ?? {}),
        };
    }

    get_effect_default_param(effect, key) {
        return this.effects_manager.SUPPORTED_EFFECTS[effect._bms_effect_type]
            ?.class
            ?.default_params
            ?.[key];
    }

    get_effect_overrides(effect_type, effect_params = {}) {
        const overrides = this.effect_overrides[effect_type] ?? {};
        return typeof overrides === 'function' ? overrides(effect_params) : overrides;
    }

    apply_effect_override(effect, key) {
        const overrides = this.get_effect_overrides(effect._bms_effect_type, effect._bms_effect_params);
        if (!(key in overrides))
            return false;

        this.set_effect_param(effect, key, overrides[key]);
        return true;
    }

    apply_effect_overrides(effect_type = null) {
        this.effects.forEach(effect => {
            if (effect_type && effect._bms_effect_type !== effect_type)
                return;

            const overrides = this.get_effect_overrides(effect._bms_effect_type, effect._bms_effect_params);
            Object.keys(overrides).forEach(key => this.set_effect_param(effect, key, overrides[key]));
        });
    }

    set_effect_param(effect, key, value) {
        if (effect._bms_effect_type !== 'pixelize') {
            effect[key] = value;
            return;
        }

        if (key === 'factor') {
            if (effect._bms_pixelize_role === 'downscale')
                effect.divider = value;
            else if (effect._bms_pixelize_role === 'upscale')
                effect.factor = value;
            return;
        }

        if (key === 'downsampling_mode') {
            if (effect._bms_pixelize_role === 'downscale')
                effect.downsampling_mode = value;
            return;
        }

        if (key in effect)
            effect[key] = value;
    }



    remove_all_effects() {
        this.effects.forEach(effect => {
            this.effects_manager.remove(effect);
            [
                effect._effect_key_removed_id,
                effect._effect_key_updated_id,
                effect._effect_key_added_id
            ].forEach(
                id => { if (id) this.pipelines_manager.disconnect(id); }
            );
            delete effect._effect_key_removed_id;
            delete effect._effect_key_updated_id;
            delete effect._effect_key_added_id;
            delete effect._bms_effect_type;
            delete effect._bms_effect_id;
            delete effect._bms_effect_params;
            delete effect._bms_pixelize_role;
        });
        this.effects = [];
    }



    change_pipeline_to(pipeline_id) {
        this.set_pipeline_id(pipeline_id);
        this.attach_pipeline_to_actor(this.actor);
    }



    destroy() {
        this.remove_connections();
        this.remove_pipeline_from_actor();
        this.pipeline_id = null;
    }

    _warn(str) {
        console.warn(`[Blur my Shell > pipeline]     ${str}`);
    }
};
