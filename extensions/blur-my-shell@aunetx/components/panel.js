import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { PaintSignals } from '../conveniences/paint_signals.js';
import * as utils from '../conveniences/utils.js';

import { Pipeline } from '../conveniences/pipeline.js';
import { DummyPipeline } from '../conveniences/dummy_pipeline.js';

const DASH_TO_PANEL_UUID = 'dash-to-panel@jderose9.github.com';
const PANEL_STYLES = [
    "transparent-panel",
    "light-panel",
    "dark-panel",
    "contrasted-panel"
];

const GRADIENT_PANEL_STYLES = [
    "gradient-panel",
    "gradient-panel-reverse"
];

export const PanelBlur = class PanelBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.window_signal_ids = new Map();
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.actors_list = [];
        this.queued_updates = new Set();
        this.enabled = false;
        this._first_boot = true;
    }

    enable() {
        console.log('=== TEST_PANEL_RELOAD ===');

        if (this.enabled) {
            this._log("blur already enabled");
            return;
        }

        // global listener, so we don't miss the panel destruction event
        this._isMainPanelAlive = true;
        this.connections.connect(Main.panel, 'destroy', () => {
            this._isMainPanelAlive = false;
        });

        this._log("blurring top panel");


        this.connections.connect(
            Main.extensionManager,
            'extension-state-changed',
            (_, extension) => {
                if (extension.uuid === DASH_TO_PANEL_UUID
                    && extension.state === 1
                ) {
                    this.connections.connect(
                        global.dashToPanel,
                        'panels-created',
                        _ => this.blur_dtp_panels()
                    );

                    this.blur_existing_panels();
                }
            }
        );

        this.blur_existing_panels();


        this.panel_hide_blur_startup();



        this.connect_to_windows_and_overview();



        this._dirty = false;
        this.connections.connect(Main.layoutManager, 'monitors-changed',
            _ => this._dirty = true
        );

        this.connections.connect(global.display, 'workareas-changed', _ => {
            if (this._dirty) {

                this.reset();
                this._dirty = false;
            }
            else {



                Main.uiGroup.get_children().forEach(child => {
                    if (child.get_name() === "panelBox" &&
                        child != Main.layoutManager.panelBox &&
                        child.get_n_children() == 1
                    ) {
                        this.maybe_blur_panel(child.get_child_at_index(0));
                    }
                });
            }
        })

        this.enabled = true;
    }

    reset() {
        if (!this.enabled) {
            this._log("reset called but blur is not enabled");
            return;
        }

        this._log("resetting...");

        this.disable();
        setTimeout(_ => this.enable(), 1);
    }


    blur_existing_panels() {

        if (global.dashToPanel) {

            if (global.dashToPanel.panels)
                this.blur_dtp_panels();
        } else {

            if (this._isMainPanelAlive)
                this.maybe_blur_panel(Main.panel);


            Main.uiGroup.get_children().forEach(actor => {
                if (actor.get_name() === "panelBox" && actor.get_n_children() === 1) {
                    let multi_monitor_panel = actor.get_child_at_index(0);
                    if (this._isMainPanelAlive && multi_monitor_panel != Main.panel)
                        this.maybe_blur_panel(multi_monitor_panel);
                }
            })
        }
    }

    blur_dtp_panels() {




        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!global.dashToPanel?.panels) {
                return GLib.SOURCE_REMOVE;
            }

            this._log("Blurring Dash to Panel panels after idle.");


            global.dashToPanel.panels.forEach(p => {
                if (
                    p.panel != Main.panel ||
                    this.settings.dash_to_panel.BLUR_ORIGINAL_PANEL
                )
                    this.maybe_blur_panel(p.panel);
            });


            if (
                !global.dashToPanel.panels
                    .map(p => p.panel)
                    .includes(Main.panel)
                &&
                this.settings.dash_to_panel.BLUR_ORIGINAL_PANEL
                &&
                this._isMainPanelAlive
            )
                this.maybe_blur_panel(Main.panel);

            return GLib.SOURCE_REMOVE;
        });
    };


    maybe_blur_panel(panel) {

        let actors = this.actors_list.find(
            actors => actors.widgets.panel == panel
        );

        if (!actors)

            this.blur_panel(panel);
    }


    blur_panel(panel) {
        let geometry_actor = panel;
        let wrapper = null;
        let panel_box = panel.get_parent();
        let is_dtp_panel = false;
        if (!panel_box.name) {
            is_dtp_panel = true;
            wrapper = panel_box;
            geometry_actor = panel;
            panel_box = panel_box.get_parent();
        }

        let monitor = Main.layoutManager.findMonitorForActor(panel);
        if (!monitor)
            return;

        let background_group = new Meta.BackgroundGroup(
            { name: 'bms-panel-backgroundgroup', width: 0, height: 0 }
        );

        let background, bg_manager;
        let static_blur = this.settings.panel.STATIC_BLUR;
        let pipeline;

        if (static_blur) {
            let bg_manager_list = [];
            pipeline = new Pipeline(
                this.effects_manager,
                global.blur_my_shell._pipelines_manager,
                this.settings.panel.PIPELINE
            );
            background = pipeline.create_background_with_effects(
                monitor.index, bg_manager_list,
                background_group, 'bms-panel-blurred-widget'
            );
            bg_manager = bg_manager_list[0];
        }
        else {
            pipeline = new DummyPipeline(this.effects_manager, this.settings.panel);
            [background, bg_manager] = pipeline.create_background_with_effect(
                background_group, 'bms-panel-blurred-widget'
            );
        }

        let paint_signals = new PaintSignals(this.connections);











        {
            if (this.settings.HACKS_LEVEL === 1) {
                this._log("panel hack level 1");



                let dynamic_target = {
                    queue_repaint: () => {
                        let active_pipeline = (bg_manager && bg_manager._bms_pipeline) ? bg_manager._bms_pipeline : pipeline;

                        if (static_blur && active_pipeline && active_pipeline.effects) {

                            for (let i = 0; i < active_pipeline.effects.length; i++) {
                                let eff = active_pipeline.effects[i];
                                if (eff && typeof eff.queue_repaint === 'function') {
                                    eff.queue_repaint();
                                }
                            }
                        } else if (!static_blur && active_pipeline) {
                            let eff = active_pipeline.effect;
                            if (eff && typeof eff.queue_repaint === 'function') {
                                eff.queue_repaint();
                            }
                        }
                    }
                };

                paint_signals.disconnect_all();
                paint_signals.connect(background, dynamic_target);
            } else {
                paint_signals.disconnect_all();
            }
        }


        panel_box.insert_child_at_index(background_group, 0);


        let actors = {
            widgets: {
                panel,
                wrapper,
                panel_box,
                background,
                background_group,
                geometry_actor
            },
            static_blur,
            monitor,
            bg_manager,
            is_dtp_panel
        };
        this.actors_list.push(actors);
        background_group.connect('destroy', () => {
            actors.widgets.background_group = null;
        });


        this.queue_update_size(actors);



        this.connections.connect(
            geometry_actor,
            ['notify::allocation', 'notify::size', 'notify::position'],
            _ => this.queue_update_size(actors)
        );

        if (wrapper) {
            this.connections.connect(
                wrapper,
                ['notify::allocation', 'notify::size', 'notify::position'],
                _ => this.queue_update_size(actors)
            );
        }
        this.connections.connect(
            panel_box,
            ['notify::size', 'notify::position'],
            _ => this.queue_update_size(actors)
        );
        this.connections.connect(
            panel_box.get_parent(),
            'notify::position',
            _ => this.queue_update_size(actors)
        );


        this.connections.connect(
            panel,
            'destroy',
            _ => this.destroy_blur(actors)
        );
    }

    queue_update_size(actors) {
        if (this.queued_updates.has(actors))
            return;

        this.queued_updates.add(actors);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.queued_updates.delete(actors);

            if (!this.enabled || !this.actors_list.includes(actors))
                return GLib.SOURCE_REMOVE;

            this.update_size(actors);
            return GLib.SOURCE_REMOVE;
        });
    }

    update_size(actors) {
        let geometry_actor = actors.widgets.geometry_actor;
        let panel_box = actors.widgets.panel_box;
        let wrapper = actors.widgets.wrapper;
        let background = actors.widgets.background;
        let [width, height] = panel_box.get_size();
        let [geometry_width, geometry_height] = geometry_actor.get_size();

        if (!width || !height || !geometry_width || !geometry_height) {
            this.queue_update_size(actors);
            return;
        }


        if (actors.static_blur) {
            let monitor = Main.layoutManager.findMonitorForActor(geometry_actor);
            if (!monitor) {
                this.queue_update_size(actors);
                return;
            }

            let [p_x, p_y] = panel_box.get_position();
            let [p_p_x, p_p_y] = panel_box.get_parent().get_position();


            let g_x, g_y;
            if (actors.is_dtp_panel) {
                let [w_x, w_y] = wrapper.get_position();
                let [pan_x, pan_y] = geometry_actor.get_position();
                g_x = w_x + pan_x;
                g_y = w_y + pan_y;
            } else {
                [g_x, g_y] = geometry_actor.get_position();
            }

            let x = p_x + p_p_x - monitor.x + g_x;
            let y = p_y + p_p_y - monitor.y + g_y;
            let is_horizontal = geometry_width >= geometry_height;
            let distance_to_top = Math.abs(y);
            let distance_to_bottom = Math.abs(
                monitor.height - (y + geometry_height)
            );
            let is_bottom_panel = is_horizontal &&
                distance_to_bottom < distance_to_top;

            const inset = utils.static_blur_clip_inset();
            const offset = utils.subpixel_stage_offset();
            const workspace_edge_inset = is_bottom_panel
                ? Math.max(inset, 1)
                : inset;
            const clip_x = Math.floor(x) - inset;
            const clip_y = Math.floor(y) - workspace_edge_inset;
            const clip_w = Math.ceil(geometry_width) + inset * 2;
            const clip_h = Math.ceil(geometry_height) +
                inset + workspace_edge_inset;

            background.set_clip(clip_x, clip_y, clip_w, clip_h);
            background.x = g_x - x + inset;
            background.y = offset + g_y - y + inset;
        } else {

            if (actors.is_dtp_panel) {
                background.x = wrapper.x + geometry_actor.x;
                background.y = wrapper.y + geometry_actor.y;
            } else {
                background.x = geometry_actor.x;
                background.y = geometry_actor.y;
            }
            background.width = geometry_width;
            background.height = geometry_height;
        }


        actors.monitor = Main.layoutManager.findMonitorForActor(geometry_actor);
    }





    _getStateAdjustment() {
        return Main.overview?._controls?._stateAdjustment
            ?? Main.overview?._overview?._controls?._stateAdjustment
            ?? null;
    }


    connect_to_overview() {
        this.connections.connect(
            Main.overview, 'showing', () => {
                this.animate_overview_transition(true, 300);
            }
        );
        this.connections.connect(
            Main.overview, 'hiding', () => {
                this.animate_overview_transition(false, 300);
            }
        );
        this.connections.connect(
            Main.overview, 'hidden', () => {
                this.set_appfolder_open(false);
                this.animate_overview_transition(false, 0);
            }
        );

        if (Main.overview.visible) {
            this.animate_overview_transition(true, 0);
        } else {
            this.animate_overview_transition(false, 0);
        }
    }

    _on_overview_adjustment_changed(_stateAdjustment) {

    }

    _ensure_overview_effects_configured(bg) {


    }

    set_appfolder_open(isOpen) {
        this._appfolder_is_open = !!isOpen;

        const overviewRadius = (this.settings.overview?.SIGMA ?? 30.0);
        const overviewBrightness = (this.settings.overview?.BRIGHTNESS ?? 1.0);
        const folderSigma = (this.settings.appfolder?.SIGMA ?? 30.0);
        const targetRadius = isOpen
            ? Math.round(overviewRadius + folderSigma * 1.5)
            : overviewRadius;
        const targetBrightness = isOpen
            ? 0.90
            : overviewBrightness;



        const ov = global.blur_my_shell?._overview_blur;
        if (ov && ov.overview_background_group) {
            const children = ov.overview_background_group.get_children();
            for (let widget of children) {
                const effs = widget.get_effects?.() || [];
                effs.forEach((e, idx) => {
                    const name = e.name || `bms-ov-eff-${idx}`;
                    if (!e.name) e.name = name;
                    try {
                        widget.remove_transition(`@effects.${name}.radius`);
                        widget.remove_transition(`@effects.${name}.brightness`);
                        widget.ease_property(`@effects.${name}.radius`, targetRadius, {
                            duration: 220,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                        widget.ease_property(`@effects.${name}.brightness`, targetBrightness, {
                            duration: 220,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    } catch (_) {
                        if (typeof e.radius !== 'undefined') e.radius = targetRadius;
                        if (typeof e.brightness !== 'undefined') e.brightness = targetBrightness;
                    }
                });
            }
        }



        if (Main.panel) {
            Main.panel.set_style(
                `background-color: transparent !important; ` +
                `background-gradient-start: transparent !important; ` +
                `background-gradient-end: transparent !important; ` +
                `box-shadow: none !important; ` +
                `border-bottom: none !important; ` +
                `transition-duration: 220ms !important;`
            );
        }
    }

    animate_overview_transition(isOverview, durationMs = 300) {
        try {
            const duration = durationMs;
            const overviewRadius = (this.settings.overview?.SIGMA ?? 30.0);

            let baseDesktopTint = 0.35;
            if (this._baseDesktopTint !== undefined) {
                baseDesktopTint = this._baseDesktopTint;
            } else {
                try {
                    const configPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                    if (GLib.file_test(configPath, GLib.FileTest.EXISTS)) {
                        const [ok, content] = GLib.file_get_contents(configPath);
                        if (ok) {
                            const data = JSON.parse(new TextDecoder().decode(content));
                            if (typeof data.panel_tint === 'number') {
                                baseDesktopTint = Math.min(Math.max(data.panel_tint * 0.6, 0.25), 0.50);
                            }
                        }
                    }
                } catch (_) {}
                this._baseDesktopTint = baseDesktopTint;
            }








            this.actors_list?.forEach(actors => {
                const bg = actors.widgets?.background;
                if (!bg) return;


                let eff = null;
                const effs = bg.get_effects ? bg.get_effects() : [];
                for (let e of effs) {
                    if (e.top_blur !== undefined) {
                        eff = e;
                        if (!e.name) e.name = 'gradEff';
                        break;
                    }
                }

                bg.remove_all_transitions();
                if (eff) {
                    try {
                        bg.remove_transition('@effects.gradEff.top_blur');
                        bg.remove_transition('@effects.gradEff.bottom_blur');
                    } catch (_) {}
                }

                if (isOverview) {
                    if (duration > 0) {
                        if (eff) {
                            bg.ease_property('@effects.gradEff.bottom_blur', overviewRadius, {
                                duration: Math.round(duration * 0.75),
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            });
                            bg.ease_property('@effects.gradEff.top_blur', overviewRadius, {
                                duration: duration,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            });
                        }
                        bg.ease_property('opacity', 0, {
                            duration: duration,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                if (bg.visible) bg.hide();
                                if (eff) {
                                    eff.top_blur = 5.0;
                                    eff.bottom_blur = 0.0;
                                }
                            }
                        });
                    } else {
                        bg.opacity = 0;
                        if (bg.visible) bg.hide();
                        if (eff) {
                            eff.top_blur = 5.0;
                            eff.bottom_blur = 0.0;
                        }
                    }
                } else {


                    bg.opacity = 0;
                    if (bg.visible) bg.hide();
                }
            });




            if (Main.panel) {
                Main.panel.opacity = 255;
                Main.panel.set_style(
                    `background-color: transparent !important; ` +
                    `background: transparent !important; ` +
                    `box-shadow: none !important; ` +
                    `border-bottom: none !important; ` +
                    `transition-duration: ${duration}ms !important;`
                );
            }
        } catch (e) {
            this._log(`Error animating overview transition: ${e}`);
        }
    }

    on_overview_progress(_progress) {

    }

    set_overview_blur(enabled) {
        this.animate_overview_transition(enabled, 300);
    }


    connect_to_windows() {
        if (
            this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY
        ) {

            this.connections.connect(Main.overview, ['showing', 'hiding'],
                _ => this.update_visibility()
            );


            this.connections.connect(Main.sessionMode, 'updated',
                _ => this.update_visibility()
            );


            for (const meta_window_actor of global.get_window_actors()) {
                this.on_window_actor_added(
                    meta_window_actor.get_parent(), meta_window_actor
                );
            }


            this.connections.connect(global.window_group, 'child-added',
                this.on_window_actor_added.bind(this)
            );
            this.connections.connect(global.window_group, 'child-removed',
                this.on_window_actor_removed.bind(this)
            );


            this.connections.connect(global.window_manager, 'switch-workspace',
                _ => this.update_visibility()
            );


            this.update_visibility();
        } else {

            this.actors_list.forEach(
                actors => this.set_should_override_panel(actors, true)
            );
        }
    }




    connect_to_windows_and_overview() {
        this.disconnect_from_windows_and_overview();
        this.connect_to_overview();
        this.connect_to_windows();
    }


    disconnect_from_windows_and_overview() {

        const actors_to_disconnect = [
            Main.overview, Main.sessionMode,
            global.window_group, global.window_manager,
            Main.overview?._overview?._controls?._appDisplay,
            this._getStateAdjustment()
        ].filter(Boolean);

        for (const actor of actors_to_disconnect) {
            this.connections.disconnect_all_for(actor);
        }


        for (const [actor, ids] of this.window_signal_ids) {
            for (const id of ids) {
                actor.disconnect(id);
            }
        }
        this.window_signal_ids = new Map();
    }


    update_light_text_classname(disable = false) {
        if (!this._isMainPanelAlive)
            return;

        if (this.settings.panel.FORCE_LIGHT_TEXT && !disable)
            Main.uiGroup.add_style_class_name("panel-light-text");
        else
            Main.uiGroup.remove_style_class_name("panel-light-text");
    }


    on_window_actor_added(container, meta_window_actor) {
        this.window_signal_ids.set(meta_window_actor, [
            meta_window_actor.connect('notify::allocation',
                _ => this.update_visibility()
            ),
            meta_window_actor.connect('notify::visible',
                _ => this.update_visibility()
            )
        ]);
        this.update_visibility();
    }


    on_window_actor_removed(container, meta_window_actor) {
        for (const signalId of this.window_signal_ids.get(meta_window_actor)) {
            meta_window_actor.disconnect(signalId);
        }
        this.window_signal_ids.delete(meta_window_actor);
        this.update_visibility();
    }


    update_visibility() {
        if (
            this._isMainPanelAlive && Main.panel.has_style_pseudo_class('overview')
            || !Main.sessionMode.hasWindows
        ) {
            this.actors_list.forEach(
                actors => this.set_should_override_panel(actors, true)
            );
            return;
        }

        if (!Main.layoutManager.primaryMonitor)
            return;


        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows().filter(meta_window =>
            meta_window.showing_on_its_workspace()
            && !meta_window.is_hidden()


            && [
                Meta.WindowType.NORMAL,
                Meta.WindowType.DIALOG,
                Meta.WindowType.MODAL_DIALOG
            ].includes(meta_window.get_window_type())

            && meta_window.get_gtk_application_id() !== "com.rastersoft.ding"
            && meta_window.get_gtk_application_id() !== "com.desktop.ding"
        );



        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.actors_list


            .filter(actors => !actors.is_dtp_panel)
            .forEach(actors => {
                let panel = actors.widgets.panel;
                let panel_top = panel.get_transformed_position()[1];
                let panel_bottom = panel_top + panel.get_height();


                let window_overlap_panel = false;
                windows.forEach(meta_window => {
                    let window_monitor_i = meta_window.get_monitor();
                    let same_monitor = actors.monitor.index == window_monitor_i;

                    let window_vertical_pos = meta_window.get_frame_rect().y;
                    let window_vertical_bottom = window_vertical_pos + meta_window.get_frame_rect().height;


                    if (same_monitor
                        &&

                        ((panel_top === actors.monitor.y && window_vertical_pos < panel_bottom + 5 * scale) ||

                        (panel_top > actors.monitor.y && window_vertical_bottom > panel_top - 5 * scale))
                    )
                        window_overlap_panel = true;
                });


                this.set_should_override_panel(
                    actors, !window_overlap_panel
                );
            });
    }



    set_should_override_panel(actors, should_override) {
        let panel = actors.widgets.panel;

        if (this.settings.panel.OVERRIDE_BACKGROUND) {
            if (this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY) {
                if (this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY_MODE == 0) {


                    if (!should_override) {
                        this.proximity_show(actors, panel);
                    }
                    else {
                        this.proximity_hide(actors, panel);
                    };
                }
                if (this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY_MODE == 1) {
                    if (should_override) {
                        this.update_panel_style_class(panel, PANEL_STYLES[this.settings.panel.STYLE_PANEL]);
                    } else {
                        this.update_panel_style_class(panel, null);
                    }
                }
            }
            else {
                let target_style = null;
                if (this.settings.panel.GRADIENT_PANEL) {
                    target_style = GRADIENT_PANEL_STYLES[this.settings.panel.GRADIENT_PANEL_MODE];
                } else {
                    target_style = PANEL_STYLES[this.settings.panel.STYLE_PANEL];
                }
                this.update_panel_style_class(panel, target_style);
            }
        }
        else {
            this.update_panel_style_class(panel, null);
        }


        this.update_light_text_classname(!should_override);
    }

    update_panel_style_class(panel, target_class) {
        const ALL_STYLES = [...PANEL_STYLES, ...GRADIENT_PANEL_STYLES];


        ALL_STYLES.forEach(style => {
            if (style !== target_class) {
                panel.remove_style_class_name(style);
            }
        });


        if (target_class && !panel.has_style_class_name(target_class)) {
            panel.add_style_class_name(target_class);
        }
    }

    panel_hide_blur_dynamically() {
        if (this.settings.panel.OVERRIDE_BACKGROUND && this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY) {
            if (this.settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY_MODE == 0) {
                this.hide()
            }
            else {this.show()}
        }
        else {
            this.show()
        }
    }

    proximity_hide(actors, panel) {
        let target_style = null;
        if (this.settings.panel.GRADIENT_PANEL) {
            if (!Main.overview.visible) {
                target_style = GRADIENT_PANEL_STYLES[this.settings.panel.GRADIENT_PANEL_MODE];
            }
            else {
                target_style = this.settings.panel.UNBLUR_IN_OVERVIEW
                                ? PANEL_STYLES[0]
                                : GRADIENT_PANEL_STYLES[this.settings.panel.GRADIENT_PANEL_MODE];
            }
        }
        else {
            target_style = PANEL_STYLES[this.settings.panel.STYLE_PANEL];
        }

        this.update_panel_style_class(panel, target_style);
        if (!this.settings.panel.GRADIENT_PANEL) {
            actors.widgets.background.hide();
        }
    }

    proximity_show(actors, panel) {
        this.update_panel_style_class(panel, PANEL_STYLES[this.settings.panel.STYLE_PANEL]);
        actors.widgets.background.show();
    }

    panel_hide_blur_startup(){
        if (this._first_boot) {
            if (this.settings.panel.GRADIENT_PANEL && Main.overview.visible) {
                this.set_overview_blur(true);
            } else if (this.settings.panel.UNBLUR_IN_OVERVIEW && !this.settings.panel.GRADIENT_PANEL && Main.overview.visible) {
                this.hide();
            }
            this._first_boot = false;
        }
    }

    update_pipeline() {
        this.actors_list.forEach(actors =>
            actors.bg_manager._bms_pipeline.change_pipeline_to(
                this.settings.panel.PIPELINE
            )
        );
    }

    show() {
        this.actors_list.forEach(actors => {
            actors.widgets.background.show();
        });
    }

    hide() {
        if (this.settings.panel.GRADIENT_PANEL)
            return;
        this.actors_list.forEach(actors => {
            actors.widgets.background.hide();
        });
    }


    destroy_blur(actors) {
        this.set_should_override_panel(actors, false);

        if (actors.bg_manager) {
            if (actors.bg_manager._bms_pipeline) {
                actors.bg_manager._bms_pipeline.destroy();
                actors.bg_manager._bms_pipeline = null;
            }
            actors.bg_manager.backgroundActor = null;
            actors.bg_manager.destroy();
            actors.bg_manager = null;
        }

        if (actors.widgets && actors.widgets.background_group) {
            actors.widgets.background_group.destroy();
            actors.widgets.background_group = null;
        }

        let index = this.actors_list.indexOf(actors);
        if (index >= 0)
            this.actors_list.splice(index, 1);
    }

    disable() {
        if (!this.enabled) {
            this._log("blur already removed");
            return;
        }

        this._log("removing blur from top panel");

        this.disconnect_from_windows_and_overview();

        this.update_light_text_classname(true);

        const immutable_actors_list = [...this.actors_list];
        immutable_actors_list.forEach(actors => this.destroy_blur(actors));
        this.actors_list = [];
        this.queued_updates.clear();

        this._dirty = true;
        this._first_boot = null;

        this.connections.disconnect_all();

        this.enabled = false;
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > panel]        ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > panel]        ${str}`);
    }
};
