import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import { PaintSignals } from '../conveniences/paint_signals.js';
import * as utils from '../conveniences/utils.js';

import { Pipeline } from '../conveniences/pipeline.js';

const BlurModule = await utils.import_in_shell_only('gi://Blur');
const Shell = await utils.import_in_shell_only('gi://Shell');
const BlurOrShell = utils.is_usable_blur_module(BlurModule) ? BlurModule : Shell;
const SUPPORTS_CORNER_RADIUS = Boolean(
    BlurOrShell?.BlurEffect?.list_properties()
        .some(property => property.name === 'corner-radius')
);

const DASH_STYLES = [
    "transparent-dash",
    "light-dash",
    "dark-dash"
];

/// Manages blur and styling for an individual Dash to Dock instance
class DashInfos {
    constructor(
        dash_blur, dash, dash_container, dash_background,
        background, background_group, bg_manager, paint_signals
    ) {
        this.dash_blur = dash_blur;
        this.dash = dash;
        this.dash_container = dash_container;
        this.dash_background = dash_background;
        this.background = background;
        this.background_group = background_group;
        this.bg_manager = bg_manager;
        this.paint_signals = paint_signals;
        this.settings = dash_blur.settings;
        this.old_style = this.dash._background?.style;

        this.updateId = 0;
        this._first_boot = true;
        this._restack_id = 0;
        this._workspace_id = 0;

        this.disable_offscreen_redirect();

        if (this.background_group) {
            this.bg_allocation_id = this.background_group.connect('notify::allocation', () => {
                this.schedule_update();
            });
        }

        let monitor = Main.layoutManager.findMonitorForActor(this.dash_container);
        this.current_monitor_index = monitor ? monitor.index : null;

        this.dash_destroy_id = dash.connect('destroy', () => this.remove_dash_blur());
        this.dash_blur_connections_ids = [];
        this.dash_blur_connections_ids.push(
            this.dash_blur.connect('remove-dashes', () => this.remove_dash_blur()),
            this.dash_blur.connect('override-style', () => this.override_style()),
            this.dash_blur.connect('remove-style', () => this.remove_style()),
            this.dash_blur.connect('show', () => {
                if (this.dash_blur.is_static)
                    this.background_group?.show();
                else
                    this.apply_dynamic_blur();
            }),
            this.dash_blur.connect('hide', () => {
                this.background_group?.hide();
                this.remove_dynamic_blur();
            }),
            this.dash_blur.connect('update-size', () => this.schedule_update()),
            this.dash_blur.connect('change-blur-type', () => this.change_blur_type()),
            this.dash_blur.connect('update-pipeline', () => this.update_pipeline())
        );

        // Instantly apply dynamic blur on the desktop
        if (!this.dash_blur.is_static) {
            this.apply_dynamic_blur();
        }
    }

    disable_offscreen_redirect() {
        try {
            if (this.dash_container)
                this.dash_container.set_offscreen_redirect(0);
            if (this.dash_container?._slider)
                this.dash_container._slider.set_offscreen_redirect(0);
            let dash_box = this.dash_container?._slider?.get_child();
            if (dash_box)
                dash_box.set_offscreen_redirect(0);
            if (this.dash)
                this.dash.set_offscreen_redirect(0);
            if (this.dash_background)
                this.dash_background.set_offscreen_redirect(0);
        } catch (e) {
            console.error(`[BlurMyShell] DashToDock disable_offscreen_redirect error: ${e}`);
        }
    }

    schedule_update() {
        this.clear_pending_idles();
        this.updateId = global.compositor.get_laters().add(Meta.LaterType.IDLE, () => {
            this.updateId = 0;
            this.update_size();
            return false;
        });
    }

    clear_pending_idles() {
        if (this.updateId) {
            global.compositor.get_laters().remove(this.updateId);
            this.updateId = 0;
        }
    }

    apply_dynamic_blur() {
        if (!this.dash_background || !BlurOrShell?.BlurEffect)
            return;

        this.disable_offscreen_redirect();

        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        const scale = theme_context ? theme_context.scale_factor : 1;
        const radius = Math.max(1, (this.settings.dash_to_dock.SIGMA || 30) * scale);
        // User requested dock blur radius and tint radius matching dock radius (28px)
        const corner_radius = Math.round((this.settings.dash_to_dock.CORNER_RADIUS || 28) * scale);

        let effect = this.dash_background.get_effect('bms-dock-blur');
        if (!effect) {
            const params = {
                name: 'bms-dock-blur',
                radius: radius,
                mode: BlurOrShell.BlurMode.BACKGROUND,
            };
            if (SUPPORTS_CORNER_RADIUS) {
                params.corner_radius = corner_radius;
            }

            try {
                effect = new BlurOrShell.BlurEffect(params);
                this.dash_background.add_effect(effect);
                console.log(`[BlurMyShell] Successfully applied bms-dock-blur (radius: ${radius}, corner_radius: ${corner_radius})`);
            } catch (err) {
                console.error(`[BlurMyShell] DashToDock error adding dynamic blur: ${err}`);
            }
        } else {
            effect.radius = radius;
            if (SUPPORTS_CORNER_RADIUS)
                effect.corner_radius = corner_radius;
        }

        if (effect && this.dash_blur?.paint_signals) {
            this.dash_blur.paint_signals.connect(this.dash_background, effect);
        }

        if (!this._restack_id && global.display) {
            this._restack_id = global.display.connect('restacked', () => {
                let eff = this.dash_background?.get_effect('bms-dock-blur');
                if (eff)
                    eff.queue_repaint();
            });
        }

        if (!this._workspace_id && global.workspace_manager) {
            this._workspace_id = global.workspace_manager.connect('active-workspace-changed', () => {
                let eff = this.dash_background?.get_effect('bms-dock-blur');
                if (eff)
                    eff.queue_repaint();
            });
        }

        if (this.background_group) {
            if (this.background_group.get_parent())
                this.background_group.get_parent().remove_child(this.background_group);
            this.background_group.destroy();
            this.background_group = null;
        }
    }

    remove_dynamic_blur() {
        try {
            if (this.dash_background) {
                if (this.dash_blur?.paint_signals)
                    this.dash_blur.paint_signals.disconnect_all_for_actor(this.dash_background);
                this.dash_background.remove_effect_by_name('bms-dock-blur');
            }
        } catch (_e) {}

        if (this._restack_id && global.display) {
            global.display.disconnect(this._restack_id);
            this._restack_id = 0;
        }
        if (this._workspace_id && global.workspace_manager) {
            global.workspace_manager.disconnect(this._workspace_id);
            this._workspace_id = 0;
        }
    }

    remove_dash_blur() {
        this.remove_dynamic_blur();
        this.remove_style();
        this.destroy_dash();

        const dash_infos_index = this.dash_blur.dashes.indexOf(this);
        if (dash_infos_index >= 0)
            this.dash_blur.dashes.splice(dash_infos_index, 1);

        if (this.bg_allocation_id && this.background_group) {
            this.background_group.disconnect(this.bg_allocation_id);
            this.bg_allocation_id = null;
        }
        this.dash_blur_connections_ids.forEach(id => { if (id) this.dash_blur.disconnect(id); });
        this.dash_blur_connections_ids = [];
        if (this.dash_destroy_id)
            this.dash.disconnect(this.dash_destroy_id);
        this.dash_destroy_id = null;
    }

    override_style() {
        this.remove_style();

        const style = DASH_STYLES[
            this.settings.dash_to_dock.STYLE_DASH_TO_DOCK
        ];

        if (style && !this.dash.has_style_class_name(style))
            this.dash.add_style_class_name(style);
    }

    remove_style() {
        if (this.dash?._background)
            this.dash._background.style = this.old_style;

        DASH_STYLES.forEach(
            style => {
                this.dash?.remove_style_class_name(style);
                this.dash_background?.remove_style_class_name(style);
            }
        );
    }

    destroy_dash() {
        this.clear_pending_idles();
        this.remove_dynamic_blur();

        if (this.paint_signals)
            this.paint_signals.disconnect_all();

        if (this.background_group && this.dash) {
            const parent = this.dash.get_parent();
            if (parent && parent.contains(this.background_group))
                parent.remove_child(this.background_group);
        }

        if (this.bg_manager) {
            if (this.bg_manager._bms_pipeline) {
                this.bg_manager._bms_pipeline.destroy();
                this.bg_manager._bms_pipeline = null;
            }
            this.bg_manager.backgroundActor = null;
            this.bg_manager.destroy();
            this.bg_manager = null;
        }

        if (this.bg_allocation_id && this.background_group) {
            this.background_group.disconnect(this.bg_allocation_id);
            this.bg_allocation_id = null;
        }
        
        this._first_boot = null;

        if (this.background_group) {
            this.background_group.destroy();
            this.background_group = null;
        }
    }

    change_blur_type() {
        this.destroy_dash();

        if (this.dash_blur.is_static) {
            let blur_result = this.dash_blur.add_blur(this.dash, this.dash_container);
            if (!blur_result)
                return;

            let [
                background, background_group, bg_manager, paint_signals
            ] = blur_result;

            this.background = background;
            this.background_group = background_group;
            this.bg_manager = bg_manager;
            this.paint_signals = paint_signals;

            if (this.background_group) {
                this.dash.get_parent().insert_child_at_index(this.background_group, 0);

                this.bg_allocation_id = this.background_group.connect('notify::allocation', () => {
                    this.schedule_update();
                });
            }
        } else {
            this.apply_dynamic_blur();
        }

        this.schedule_update();
    }

    update_pipeline() {
        if (this.bg_manager?._bms_pipeline) {
            this.bg_manager._bms_pipeline.change_pipeline_to(
                this.settings.dash_to_dock.PIPELINE
            );
        }
    }

    update_size() {
        this.disable_offscreen_redirect();

        if (!this.dash_blur.is_static) {
            this.apply_dynamic_blur();
            return;
        }

        if (!this.dash_blur._has_valid_allocation(this.dash_container) ||
            !this.dash_blur._has_valid_allocation(this.dash) ||
            !this.dash_blur._has_valid_allocation(this.dash_background))
            return;

        this.remove_dynamic_blur();
        if (this.background_group)
            this.background_group.show();

        let monitor = Main.layoutManager.findMonitorForActor(this.dash_container);
        if (!monitor) return;

        if (this.current_monitor_index !== monitor.index) {
            this.current_monitor_index = monitor.index;
            this.change_blur_type(); 
            return;
        }

        let dash_box = this.get_dash_position(this.dash_container);
        if (!dash_box)
            return;

        const inset = utils.static_blur_clip_inset();
        const clip_x = Math.floor(dash_box.clip_x) - inset;
        const clip_y = Math.floor(dash_box.clip_y) - inset;
        const clip_w = Math.ceil(this.dash_background.width) + inset * 2;
        const clip_h = Math.ceil(this.dash_background.height) + inset * 2;

        if (this.background) {
            this.background.x = dash_box.background_x + inset;
            this.background.y = dash_box.background_y + inset;
            this.background.set_clip(clip_x, clip_y, clip_w, clip_h);
        }
        
        if (this._first_boot) {
            if (this.settings.dash_to_dock.UNBLUR_IN_OVERVIEW && Main.overview.visible) {
                this.background_group?.hide();
            }
            this._first_boot = false;
        }
    }

    get_dash_position(dash_container) {
        let monitor = Main.layoutManager.findMonitorForActor(this.dash_container);
        if (!monitor)
            return;

        let dash_box = dash_container._slider.get_child();
        if (!dash_box)
            return null;

        let parent = this.background_group?.get_parent();
        if (!parent)
            return;

        let [parent_stage_x, parent_stage_y] = parent.get_transformed_position();
        let [bg_stage_x, bg_stage_y] = this.dash_background.get_transformed_position();

        let background_x = monitor.x - parent_stage_x;
        let background_y = monitor.y - parent_stage_y;

        let clip_x = bg_stage_x - monitor.x;
        let clip_y = bg_stage_y - monitor.y;

        return {background_x, background_y, clip_x, clip_y};
    }
}

export const DashBlur = class DashBlur extends Signals.EventEmitter {
    constructor(connections, settings, effects_manager) {
        super();
        this.dashes = [];
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.paint_signals = new PaintSignals(connections);
        this.is_static = this.settings.dash_to_dock.STATIC_BLUR;
        this.enabled = false;
    }

    disable_offscreen_redirect(dash_container, dash) {
        try {
            if (dash_container)
                dash_container.set_offscreen_redirect(0);
            if (dash_container?._slider)
                dash_container._slider.set_offscreen_redirect(0);
            let dash_box = dash_container?._slider?.get_child();
            if (dash_box)
                dash_box.set_offscreen_redirect(0);
            if (dash)
                dash.set_offscreen_redirect(0);
            if (dash?._background)
                dash._background.set_offscreen_redirect(0);
        } catch (e) {
            console.error(`[BlurMyShell] DashToDock disable_offscreen_redirect error: ${e}`);
        }
    }

    enable() {
        this.connections.connect(Main.uiGroup, 'child-added', (_, actor) => {
            if (
                (actor.get_name() === "dashtodockContainer") &&
                (actor.constructor.name === 'DashToDock' || actor.constructor.name.includes('DashToDock'))
            )
                this.try_blur(actor);
        });

        this.blur_existing_dashes();
        this.connect_to_overview();

        this.connections.connect(
            this.settings.dash_to_dock.settings,
            'changed::sigma',
            () => this.dashes.forEach(d => d.apply_dynamic_blur())
        );
        this.connections.connect(
            this.settings.dash_to_dock.settings,
            'changed::corner-radius',
            () => this.dashes.forEach(d => d.apply_dynamic_blur())
        );

        this.update_size();

        this.enabled = true;
    }

    blur_existing_dashes() {
        const purge_bms = (parent) => {
            if (!parent || !parent.get_children) return;
            for (let child of [...parent.get_children()]) {
                const name = child.get_name?.() || '';
                if (name === 'bms-dash-backgroundgroup' || name === 'bms-dash-blurred-widget') {
                    try {
                        if (parent.contains(child)) parent.remove_child(child);
                        child.destroy();
                    } catch (_e) {}
                } else {
                    purge_bms(child);
                }
            }
        };
        purge_bms(Main.uiGroup);

        Main.uiGroup.get_children().filter((child) => {
            return (child.get_name() === "dashtodockContainer") &&
                (child.constructor.name === 'DashToDock' || child.constructor.name.includes('DashToDock'));
        }).forEach(dash_container => this.try_blur(dash_container));
    }

    _has_valid_allocation(actor) {
        return actor &&
            (!actor.has_allocation || actor.has_allocation()) &&
            actor.width > 0 && actor.height > 0;
    }

    _defer_blur_until_allocated(dash_container, dash) {
        if (dash_container._bms_pending_blur_setup)
            return;

        dash_container._bms_pending_blur_setup = true;
        
        const connections = [];
        const cleanup = () => {
            delete dash_container._bms_pending_blur_setup;
            delete dash_container._bms_defer_cleanup;
            connections.forEach(({ actor, id }) => {
                if (actor && id)
                    actor.disconnect(id);
            });
        };

        const retry = () => {
            if (!dash_container._bms_pending_blur_setup)
                return;

            let current_dash_box = dash_container._slider?.get_child();
            let current_dash = dash || current_dash_box?.get_children().find(child => child.get_name() === 'dash');

            if (!this._has_valid_allocation(dash_container) ||
                !this._has_valid_allocation(current_dash_box) ||
                !this._has_valid_allocation(current_dash))
                return;

            cleanup();
            this.try_blur(dash_container);
        };

        const dash_cont_id = dash_container.connect('notify::allocation', retry);
        connections.push({ actor: dash_container, id: dash_cont_id });

        if (dash) {
            const dash_id = dash.connect('notify::allocation', retry);
            connections.push({ actor: dash, id: dash_id });
        }

        const destroy_id = dash_container.connect('destroy', cleanup);
        connections.push({ actor: dash_container, id: destroy_id });

        dash_container._bms_defer_cleanup = cleanup;
    }

    try_blur(dash_container) {
        let dash_box = dash_container._slider?.get_child();
        if (!dash_box){
            this._defer_blur_until_allocated(dash_container);
            return;
        }

        let dash = dash_box.get_children().find(child => {
            return child.get_name() === 'dash';
        });

        if (!dash ||
            !this._has_valid_allocation(dash_container) ||
            !this._has_valid_allocation(dash_box) ||
            !this._has_valid_allocation(dash)) {
                this._defer_blur_until_allocated(dash_container, dash);
                return;
        }

        let dash_exist = this.dashes.find(info => info.dash === dash);
        if (dash_exist) {
            dash_exist.remove_dash_blur();
        }

        const purge_lingering_bms = (parent) => {
            if (!parent || !parent.get_children) return;
            const children = [...parent.get_children()];
            for (let child of children) {
                const name = child.get_name?.() || '';
                if (name === 'bms-dash-backgroundgroup' || name === 'bms-dash-blurred-widget') {
                    console.log(`[BlurMyShell] Purging lingering dock actor: ${name}`);
                    try {
                        if (parent.contains(child)) parent.remove_child(child);
                        child.destroy();
                    } catch (e) {
                        console.error(`[BlurMyShell] Error destroying ${name}: ${e}`);
                    }
                } else {
                    purge_lingering_bms(child);
                }
            }
        };

        purge_lingering_bms(dash_container);
        purge_lingering_bms(Main.uiGroup);

        let infos = this.blur_dash_from(dash, dash_container);
        if (infos) {
            this.dashes.push(infos);
        }
    }

    blur_dash_from(dash, dash_container) {
        this.disable_offscreen_redirect(dash_container, dash);

        let background = null, background_group = null, bg_manager = null, paint_signals = null;

        if (this.is_static) {
            let blur_result = this.add_blur(dash, dash_container);
            if (blur_result) {
                [background, background_group, bg_manager, paint_signals] = blur_result;
                if (background_group)
                    dash.get_parent().insert_child_at_index(background_group, 0);
            }
        }

        this.connections.connect(
            dash,
            ['notify::width', 'notify::height', 'notify::x', 'notify::y', 'notify::allocation'],
            _ => this.update_size()
        );
        this.connections.connect(
            dash_container,
            [
                'notify::width', 
                'notify::height', 
                'notify::y', 
                'notify::x', 
                'notify::style-class-name',
                'notify::allocation'
            ],
            _ => this.update_size()
        );

        const slider = dash_container._slider;
        if (slider) {
            this.connections.connect(
                slider,
                ['notify::slide-x', 'notify::slide-y', 'notify::allocation'],
                _ => this.update_size()
            );
        }

        const dash_background = dash._background ||
            dash.get_children().find(child => child.has_style_class_name('dash-background')) ||
            dash;

        if (dash_background && dash_background !== dash) {
            this.connections.connect(
                dash_background,
                ['notify::width', 'notify::height', 'notify::x', 'notify::y', 'notify::allocation'],
                _ => this.update_size()
            );
        }

        if (!dash_background)
            return null;

        let infos = new DashInfos(
            this,
            dash,
            dash_container,
            dash_background,
            background,
            background_group,
            bg_manager,
            paint_signals
        );

        this.update_size();

        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.update_size();
            return false;
        });

        this.update_background();

        return infos;
    }

    add_blur(dash, dash_container = null) {
        if (!this.is_static)
            return [null, null, null, null];

        const target_actor = dash_container || dash;
        const monitor = Main.layoutManager.findMonitorForActor(target_actor) || Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;

        const background_group = new Meta.BackgroundGroup({
            name: 'bms-dash-backgroundgroup', width: 0, height: 0
        });

        let bg_manager_list = [];
        const pipeline = new Pipeline(
            global.blur_my_shell._effects_manager,
            global.blur_my_shell._pipelines_manager,
            this.settings.dash_to_dock.PIPELINE
        );
        let background = pipeline.create_background_with_effects(
            monitor.index, bg_manager_list,
            background_group, 'bms-dash-blurred-widget'
        );
        let bg_manager = bg_manager_list[0];

        return [background, background_group, bg_manager, null];
    }

    change_blur_type() {
        this.is_static = this.settings.dash_to_dock.STATIC_BLUR;
        this.emit('change-blur-type');

        this.update_background();
    }

    connect_to_overview() {
        this.connections.disconnect_all_for(Main.overview);

        if (this.settings.dash_to_dock.UNBLUR_IN_OVERVIEW) {
            this.connections.connect(
                Main.overview, 'showing', _ => this.hide()
            );
            this.connections.connect(
                Main.overview, 'hidden', _ => this.show()
            );
        }
    }

    update_background() {
        if (this.settings.dash_to_dock.OVERRIDE_BACKGROUND)
            this.emit('override-style');
        else
            this.emit('remove-style');
    }

    update_pipeline() {
        this.emit('update-pipeline');
    }

    update_size() {
        this.emit('update-size');
    }

    show() {
        this.emit('show');
    }

    hide() {
        this.emit('hide');
    }

    disable() {
        this.emit('remove-dashes');

        for (let child of Main.uiGroup.get_children()) {
            if (child._bms_defer_cleanup)
                child._bms_defer_cleanup();
            delete child._bms_pending_blur_setup;
        }

        this.dashes = [];
        this.connections.disconnect_all();

        this.enabled = false;
    }
};
