import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { WorkspaceAnimationController } from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
const wac_proto = WorkspaceAnimationController.prototype;

import { Pipeline } from '../conveniences/pipeline.js';

const OVERVIEW_COMPONENTS_STYLE = [
    "overview-components-light",
    "overview-components-dark",
    "overview-components-transparent"
];


export const OverviewBlur = class OverviewBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.overview_background_managers = [];
        this.overview_background_group = new Meta.BackgroundGroup(
            { name: 'bms-overview-backgroundgroup' }
        );
        this.animation_background_managers = [];
        this.animation_background_group = new Meta.BackgroundGroup(
            { name: 'bms-animation-backgroundgroup' }
        );
        this.enabled = false;
        this.proto_patched = false;
    }

    enable() {
        this._log("blurring overview");


        Main.uiGroup.add_style_class_name("blurred-overview");


        this.update_components_classname();


        this.update_backgrounds();


        this.connections.connect(Main.layoutManager, 'monitors-changed',
            _ => this.update_backgrounds()
        );


        this.overview_background_group.opacity = Main.overview.visible ? 255 : 0;
        this.overview_background_group.visible = Main.overview.visible;

        const baseRadius = (this.settings.overview?.SIGMA ?? 30.0);
        const baseBrightness = (this.settings.overview?.BRIGHTNESS ?? 1.0);

        const configureEffects = () => {
            const children = this.overview_background_group.get_children();
            const targetRadius = Math.max(0.5, baseRadius);
            for (const widget of children) {
                const effs = widget.get_effects ? widget.get_effects() : [];
                for (const eff of effs) {
                    if (eff.radius !== undefined && eff.radius !== targetRadius) {
                        eff.radius = targetRadius;
                    }
                    if (eff.brightness !== undefined && eff.brightness !== baseBrightness) {
                        eff.brightness = baseBrightness;
                    }
                }
            }
        };
        configureEffects();

        const stateAdjustment = Main.overview?._controls?._stateAdjustment
            ?? Main.overview?._overview?._controls?._stateAdjustment;

        this._lastOverviewOpacity = -1;

        const updateOpacity = (progress) => {
            const p = Math.max(0, Math.min(1, progress));
            const targetOpacity = Math.round(p * 255);
            if (this._lastOverviewOpacity === targetOpacity)
                return;
            this._lastOverviewOpacity = targetOpacity;

            if (this.overview_background_group.opacity !== targetOpacity)
                this.overview_background_group.opacity = targetOpacity;

            if (targetOpacity > 0 && !this.overview_background_group.visible) {
                this.overview_background_group.show();
            } else if (targetOpacity === 0 && this.overview_background_group.visible) {
                this.overview_background_group.hide();
            }
        };

        if (stateAdjustment) {
            this.connections.connect(stateAdjustment, 'notify::value', () => {
                updateOpacity(stateAdjustment.value);
            });
        }

        this.connections.connect(Main.overview, 'showing', () => {
            configureEffects();
            this.overview_background_group.show();
            if (!stateAdjustment) {
                this.overview_background_group.remove_all_transitions();
                this.overview_background_group.ease({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });

        this.connections.connect(Main.overview, 'shown', () => {
            if (!this.overview_background_group.visible)
                this.overview_background_group.show();
            if (this.overview_background_group.opacity !== 255)
                this.overview_background_group.opacity = 255;
            this._lastOverviewOpacity = 255;
        });

        this.connections.connect(Main.overview, 'hiding', () => {
            if (!stateAdjustment) {
                this.overview_background_group.remove_all_transitions();
                this.overview_background_group.ease({
                    opacity: 0,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });

        this.connections.connect(Main.overview, 'hidden', () => {
            this.overview_background_group.remove_all_transitions();
            if (this.overview_background_group.opacity !== 0)
                this.overview_background_group.opacity = 0;
            this.overview_background_group.hide();
            this._lastOverviewOpacity = 0;
        });


        const patchOverviewControls = () => {
            try {
                const ov = Main.overview;
                const ctrl = ov._overview?._controls ?? ov._controls;
                if (!ctrl) return;
                if (ctrl._macControlsPatched) return;
                ctrl._macControlsPatched = true;

                if (ctrl._stateAdjustment) {
                    ctrl._stateAdjustment.upper = 1;
                    if (ctrl._stateAdjustment.value > 1)
                        ctrl._stateAdjustment.value = 1;
                }

                if (ctrl._appDisplay) {
                    ctrl._appDisplay.visible = false;
                    ctrl._appDisplay.opacity = 0;
                    ctrl._appDisplay.reactive = false;
                }

                ctrl._shiftState = function(direction) {
                    let {currentState, finalState} = this._stateAdjustment.getStateTransitionParams();
                    if (direction === Meta.MotionDirection.DOWN)
                        finalState = Math.max(finalState - 1, 0);
                    else if (direction === Meta.MotionDirection.UP)
                        finalState = Math.min(finalState + 1, 1);

                    if (finalState === currentState)
                        return;

                    if (currentState === 0 && finalState === 1) {
                        Main.overview.show();
                    } else if (finalState === 0) {
                        Main.overview.hide();
                    } else {
                        this._stateAdjustment.ease(finalState, {
                            duration: 250,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    }
                };

                ctrl.gestureBegin = function(tracker) {
                    const baseDistance = global.screen_height;
                    const progress = Math.min(1.0, this._stateAdjustment.value);
                    const points = [0, 1];
                    const transition = this._stateAdjustment.get_transition('value');
                    const cancelProgress = transition
                        ? Math.min(1.0, transition.get_interval().peek_final_value())
                        : Math.min(1.0, Math.round(progress));
                    this._stateAdjustment.remove_transition('value');
                    tracker.confirmSwipe(baseDistance, points, progress, cancelProgress);
                    this.prepareToEnterOverview();
                    this._stateAdjustment.gestureInProgress = true;
                };

                ctrl.gestureProgress = function(progress) {
                    this._stateAdjustment.value = Math.min(1.0, progress);
                };

                ctrl.gestureEnd = function(target, duration, onComplete) {
                    target = Math.min(1.0, target);
                    if (target === 0)
                        this.prepareToLeaveOverview();
                    if (this.dash?.showAppsButton)
                        this.dash.showAppsButton.checked = false;
                    this._stateAdjustment.remove_transition('value');
                    this._stateAdjustment.ease(target, {
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete,
                    });
                    this._stateAdjustment.gestureInProgress = false;
                };

                ctrl._updateAppDisplayVisibility = function() {
                    if (this._appDisplay) {
                        this._appDisplay.visible = false;
                        this._appDisplay.opacity = 0;
                        this._appDisplay.reactive = false;
                    }
                };

                ctrl._toggleAppsPage = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    }
                };

                ov.showApps = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    } else {
                        Main.overview.show(1);
                    }
                };

                if (!ov._macOrigShow) {
                    ov._macOrigShow = ov.show.bind(ov);
                    ov.show = function(state = 1) {
                        if (state > 1) state = 1;
                        return ov._macOrigShow(state);
                    };
                }
            } catch (_) {}
        };
        patchOverviewControls();
        this.connections.connect(Main.overview, 'showing', () => {
            patchOverviewControls();
        });





        if (!this.proto_patched) {


            this._original_PrepareSwitch = wac_proto._prepareWorkspaceSwitch;
            this._original_FinishSwitch = wac_proto._finishWorkspaceSwitch;

            const w_m = global.workspace_manager;
            const outer_this = this;



            wac_proto._prepareWorkspaceSwitch = function (...params) {
                outer_this._log("prepare workspace switch");
                outer_this._original_PrepareSwitch.apply(this, params);



                if (
                    outer_this.settings.applications.BLUR
                ) {
                    let ws_index = w_m.get_active_workspace_index();
                    [ws_index - 1, ws_index + 1].forEach(
                        i => w_m.get_workspace_by_index(i)?.list_windows().forEach(
                            window => window.get_compositor_private().show()
                        )
                    );
                }

                Main.uiGroup.insert_child_above(
                    outer_this.animation_background_group,
                    global.window_group
                );

                outer_this.animation_background_managers.forEach(bg_manager => {
                    if (bg_manager._bms_pipeline.actor)
                        if (
                            Meta.prefs_get_workspaces_only_on_primary() &&
                            bg_manager._monitorIndex !== Main.layoutManager.primaryMonitor.index
                        )
                            bg_manager._bms_pipeline.actor.visible = false;
                        else
                            bg_manager._bms_pipeline.actor.visible = true;
                });
            };


            wac_proto._finishWorkspaceSwitch = function (...params) {
                outer_this._log("finish workspace switch");
                outer_this._original_FinishSwitch.apply(this, params);


                if (
                    outer_this.settings.applications.BLUR
                ) {

                    const blacklist = outer_this.settings.applications.BLACKLIST || [];
                    const blacklist_regexes = blacklist.map(pattern => {
                        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                        return new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                    });

                    for (let i = 0; i < w_m.get_n_workspaces(); i++) {
                        if (i != w_m.get_active_workspace_index())
                            w_m.get_workspace_by_index(i)?.list_windows().forEach(
                                window => {



                                    if (window.is_on_all_workspaces()) return;



                                    if (window.get_window_type() === Meta.WindowType.DESKTOP)
                                        return;



                                    const wm_class = window.get_wm_class();
                                    if (wm_class && blacklist_regexes.some(re => re.test(wm_class)))
                                        return;

                                    window.get_compositor_private().hide();
                                }
                            );
                    }
                }

                Main.uiGroup.remove_child(outer_this.animation_background_group);
            };

            this.proto_patched = true;
        }

        this.enabled = true;
    }

    update_backgrounds() {

        this.remove_background_actors();

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            const pipeline_overview = new Pipeline(
                this.effects_manager,
                global.blur_my_shell._pipelines_manager,
                this.settings.overview.PIPELINE
            );
            pipeline_overview.create_background_with_effects(
                i, this.overview_background_managers,
                this.overview_background_group, 'bms-overview-blurred-widget'
            );

            const pipeline_animation = new Pipeline(
                this.effects_manager,
                global.blur_my_shell._pipelines_manager,
                this.settings.overview.PIPELINE
            );
            pipeline_animation.create_background_with_effects(
                i, this.animation_background_managers,
                this.animation_background_group, 'bms-animation-blurred-widget'
            );
        }

        Main.layoutManager.overviewGroup.insert_child_at_index(this.overview_background_group, 0);
        this.overview_background_group.opacity = Main.overview.visible ? 255 : 0;

    }



    update_components_classname() {
        OVERVIEW_COMPONENTS_STYLE.forEach(
            style => Main.uiGroup.remove_style_class_name(style)
        );

        if (this.settings.overview.STYLE_COMPONENTS > 0)
            Main.uiGroup.add_style_class_name(
                OVERVIEW_COMPONENTS_STYLE[this.settings.overview.STYLE_COMPONENTS - 1]
            );
    }

    remove_background_actors() {
        this.overview_background_group.remove_all_children();
        this.animation_background_group.remove_all_children();

        this.connections.disconnect_all_for(Main.layoutManager.overviewGroup);
        if (this.overview_background_group.get_parent())
            Main.layoutManager.overviewGroup.remove_child(this.overview_background_group);

        this.overview_background_managers.forEach(background_manager => {
            background_manager._bms_pipeline.destroy();
            background_manager.destroy();
        });
        this.animation_background_managers.forEach(background_manager => {
            background_manager._bms_pipeline.destroy();
            background_manager.destroy();
        });
        this.overview_background_managers = [];
        this.animation_background_managers = [];
    }

    disable() {
        this._log("removing blur from overview");

        this.remove_background_actors();
        Main.uiGroup.remove_style_class_name("blurred-overview");
        OVERVIEW_COMPONENTS_STYLE.forEach(
            style => Main.uiGroup.remove_style_class_name(style)
        );

        this.connections.disconnect_all();
        this.enabled = false;
    }

    restore_patched_proto() {
        if (this.proto_patched) {
            if (this._original_PrepareSwitch)
                wac_proto._prepareWorkspaceSwitch = this._original_PrepareSwitch;
            if (this._original_FinishSwitch)
                wac_proto._finishWorkspaceSwitch = this._original_FinishSwitch;

            this.proto_patched = false;
        }
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > overview]     ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > overview]     ${str}`);
    }
};
