import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { ApplicationsService } from '../dbus/services.js';
import { PaintSignals } from '../conveniences/paint_signals.js';
import { DummyPipeline } from '../conveniences/dummy_pipeline.js';
import { Pipeline } from '../conveniences/pipeline.js';








function wildcardToRegex(pattern) {

    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    const regex = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    return new RegExp(regex, 'i');
}








function compilePatterns(patterns, cache) {
    return patterns.map(pattern => {
        if (cache.has(pattern)) {
            return cache.get(pattern);
        }
        const regex = wildcardToRegex(pattern);
        cache.set(pattern, regex);
        return regex;
    });
}


function matchesAnyPattern(value, patterns) {
    if (!value || patterns.length === 0) {
        return false;
    }
    return patterns.some(pattern => pattern.test(value));
}

const SYSTEM_SIDEBAR_WIDTHS = {
    'org.gnome.Settings': 280,
    'gnome-control-center': 280,
    'org.gnome.Nautilus': 240,
    'nautilus': 240,
    'org.gnome.DiskUtility': 280,
    'gnome-disks': 280,
    'org.gnome.baobab': 280,
    'baobab': 280,
    'org.gnome.tweaks': 240,
    'gnome-tweaks': 240,
    'org.gnome.Logs': 280,
    'gnome-logs': 280,
    'org.gnome.seahorse.Application': 280,
    'seahorse': 280,
};

function isDialogOrModalWindow(meta_window) {
    if (!meta_window)
        return false;
    const windowType = typeof meta_window.get_window_type === 'function'
        ? meta_window.get_window_type()
        : meta_window.window_type;
    if (windowType !== Meta.WindowType.NORMAL)
        return true;
    if (typeof meta_window.get_transient_for === 'function' && meta_window.get_transient_for())
        return true;
    if (typeof meta_window.is_attached_dialog === 'function' && meta_window.is_attached_dialog())
        return true;
    if (typeof meta_window.can_maximize === 'function' && !meta_window.can_maximize())
        return true;
    if (typeof meta_window.allows_resize === 'function' && !meta_window.allows_resize())
        return true;
    return false;
}

export const ApplicationsBlur = class ApplicationsBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.paint_signals = new PaintSignals(connections);


        this.meta_window_map = new Map();


        this._whitelist_pattern_cache = new Map();
        this._blacklist_pattern_cache = new Map();
        this._compiled_whitelist = [];
        this._compiled_blacklist = [];


        this._update_patterns();
    }



    _update_patterns() {
        const whitelist = this.settings.applications.WHITELIST || [];
        const blacklist = this.settings.applications.BLACKLIST || [];

        this._compiled_whitelist = compilePatterns(whitelist, this._whitelist_pattern_cache);
        this._compiled_blacklist = compilePatterns(blacklist, this._blacklist_pattern_cache);

        this._log(`Patterns updated - whitelist: ${whitelist.length}, blacklist: ${blacklist.length}`);
    }

    enable() {
        this._log("blurring applications...");


        this.service = new ApplicationsService;
        this.service.export();

        this.mutter_gsettings = new Gio.Settings({ schema: 'org.gnome.mutter' });


        this.update_all_windows();


        this.connections.connect(
            global.display,
            'window-created',
            (_meta_display, meta_window) => {
                this._log("window created");

                if (meta_window)
                    this.track_new(meta_window);
            }
        );


        this.focused_window_pid = null;
        this.init_dynamic_opacity();
        this.connections.connect(
            global.display,
            'focus-window',
            (_meta_display, meta_window, _p0) => {
                if (meta_window && meta_window.bms_pid != this.focused_window_pid)
                    this.set_focus_for_window(meta_window);
                else if (!meta_window)
                    this.set_focus_for_window(null);
            }
        );

        this.connect_to_overview();
    }



    init_dynamic_opacity() {
        if (this.settings.applications.DYNAMIC_OPACITY) {

            if (global.display.focus_window)
                this.set_focus_for_window(global.display.focus_window);
        } else {

            if (this.focused_window_pid)
                this.set_focus_for_window(null);
        }
    }



    connect_to_overview() {
        this.connections.disconnect_all_for(Main.overview);
        this.overview_visible = Main.overview.visible;

        const reconcile_windows = () => this.meta_window_map.forEach(
            (meta_window, _pid) => this.reconcile_window_visibility(meta_window)
        );
        this.connections.connect(Main.overview, 'showing', _ => {
            this.overview_visible = true;
            reconcile_windows();
        });
        this.connections.connect(Main.overview, 'hidden', _ => {
            this.overview_visible = false;
            reconcile_windows();
        });

        this.meta_window_map.forEach((meta_window, _pid) =>
            this.reconcile_window_visibility(meta_window)
        );
    }


    update_all_windows() {

        this._update_patterns();



        this.meta_window_map.forEach(((_meta_window, pid) => {
            this.remove_blur(pid);
        }));

        for (
            let i = 0;
            i < global.workspace_manager.get_n_workspaces();
            ++i
        ) {
            let workspace = global.workspace_manager.get_workspace_by_index(i);
            let windows = workspace.list_windows();

            windows.forEach(meta_window => this.track_new(meta_window));
        }
    }




    track_new(meta_window) {

        const pid = ("" + Math.random()).slice(2, 16);
        meta_window.bms_pid = pid;

        this._log(`new window tracked, pid: ${pid}`);


        this.meta_window_map.set(pid, meta_window);


        this.connections.connect(
            meta_window, 'notify::wm-class',
            _ => this.check_blur(meta_window)
        );


        this.connections.connect(
            meta_window, 'size-changed',
            _ => this.update_size(pid)
        );
        if (this.settings.applications.STATIC_BLUR) {
            this.connections.connect(
                meta_window, 'position-changed',
                _ => this.update_size(pid)
            );
        }


        this.connections.connect(
            meta_window, 'unmanaging',
            _ => this.untrack_meta_window(pid)
        );

        this.check_blur(meta_window);

        if (this.settings.applications.STATIC_BLUR && meta_window.get_client_type() === Meta.WindowClientType.X11) {
            const window_actor = meta_window.get_compositor_private();
            if (window_actor) {
                this.connections.connect(window_actor, 'child-added', _ => {
                    if (!meta_window.blur_actor)
                        return;

                    window_actor.set_child_below_sibling(meta_window.blur_actor, null);
                });
            }
        }
    }



    update_size(pid) {
        if (this.meta_window_map.has(pid)) {
            const meta_window = this.meta_window_map.get(pid);
            const blur_actor = meta_window.blur_actor;
            if (blur_actor) {
                if (this.settings.applications.STATIC_BLUR) {
                    const bg_manager = meta_window.bg_manager;
                    const bg_actor_monitor_index = bg_manager.backgroundActor.monitor;
                    const window_monitor_index = meta_window.get_monitor();
                    const monitor = Main.layoutManager.monitors[window_monitor_index];

                    if (bg_actor_monitor_index !== window_monitor_index) {
                        this._log(`application (pid ${pid}) switching to monitor: ${window_monitor_index}`);



                        bg_manager._monitorIndex = window_monitor_index;
                        bg_manager._updateBackgroundActor();


                        blur_actor.width = monitor.width;
                        blur_actor.height = monitor.height;
                    }

                    const frame = meta_window.get_frame_rect();
                    const buffer = meta_window.get_buffer_rect();
                    blur_actor.x = monitor.x - buffer.x;
                    blur_actor.y = monitor.y - buffer.y;

                    const wm_class = meta_window.get_wm_class();
                    const isDialog = isDialogOrModalWindow(meta_window);
                    const sidebarWidth = (!isDialog && (SYSTEM_SIDEBAR_WIDTHS[wm_class] || (wm_class && SYSTEM_SIDEBAR_WIDTHS[wm_class.toLowerCase()]))) || 0;
                    const clipW = sidebarWidth ? Math.min(sidebarWidth, frame.width) : frame.width;


                    blur_actor.set_clip(frame.x - monitor.x, frame.y - monitor.y, clipW, frame.height);
                } else {
                    const allocation = this.compute_allocation(meta_window);
                    blur_actor.x = allocation.x;
                    blur_actor.y = allocation.y;
                    blur_actor.height = allocation.height;

                    const wm_class = meta_window.get_wm_class();
                    const isDialog = isDialogOrModalWindow(meta_window);
                    const sidebarWidth = (!isDialog && (SYSTEM_SIDEBAR_WIDTHS[wm_class] || (wm_class && SYSTEM_SIDEBAR_WIDTHS[wm_class.toLowerCase()]))) || 0;
                    if (sidebarWidth) {
                        const maxSidebar = Math.min(sidebarWidth, allocation.width);
                        blur_actor.width = maxSidebar;
                        blur_actor.set_clip(0, 0, maxSidebar, allocation.height);
                    } else {
                        blur_actor.width = allocation.width;
                        blur_actor.remove_clip();
                    }
                }
            }
        } else

            this.untrack_meta_window(pid);
    }












    check_blur(meta_window) {
        const window_wm_class = meta_window.get_wm_class() || '';
        const app_id = (meta_window.get_gtk_application_id ? meta_window.get_gtk_application_id() : '') || '';
        const sandboxed_id = (meta_window.get_sandboxed_app_id ? meta_window.get_sandboxed_app_id() : '') || '';
        const enable_all = this.settings.applications.ENABLE_ALL;
        if (window_wm_class || app_id)
            this._log(`pid ${meta_window.bms_pid} associated to wm class ${window_wm_class}, gtk id ${app_id}`);

        const is_blacklisted = (window_wm_class && matchesAnyPattern(window_wm_class, this._compiled_blacklist))
            || (app_id && matchesAnyPattern(app_id, this._compiled_blacklist))
            || (sandboxed_id && matchesAnyPattern(sandboxed_id, this._compiled_blacklist));

        const is_whitelisted = (window_wm_class && matchesAnyPattern(window_wm_class, this._compiled_whitelist))
            || (app_id && matchesAnyPattern(app_id, this._compiled_whitelist))
            || (sandboxed_id && matchesAnyPattern(sandboxed_id, this._compiled_whitelist));

        if (
            (window_wm_class !== "" || app_id !== "")
            && ((enable_all && !is_blacklisted) || (!enable_all && is_whitelisted))
            && [
                Meta.FrameType.NORMAL,
                Meta.FrameType.DIALOG,
                Meta.FrameType.MODAL_DIALOG
            ].includes(meta_window.get_frame_type())
        ) {

            if (!meta_window.blur_actor)
                this.create_blur_effect(meta_window);
        }


        else if (meta_window.blur_actor)
            this.remove_blur(meta_window.bms_pid);
    }



    create_blur_effect(meta_window) {
        const pid = meta_window.bms_pid;
        const window_actor = meta_window.get_compositor_private();

        let blur_actor;

        if (this.settings.applications.STATIC_BLUR) {
            const pipeline = new Pipeline(this.effects_manager, global.blur_my_shell._pipelines_manager, this.settings.applications.PIPELINE);
            const bg_managers = [];
            blur_actor = pipeline.create_background_with_effects(
                meta_window.get_monitor(), bg_managers, window_actor,
                'bms-application-blurred-widget'
            );

            if (bg_managers.length > 0) meta_window.bg_manager = bg_managers[0];
            else
                this._warn(`no bg_manager on blur creation for pid ${pid}`);
        } else {
            const pipeline = new DummyPipeline(
                this.effects_manager,
                this.settings.applications
            );
            [blur_actor, meta_window.bg_manager] = pipeline.create_background_with_effect(
                window_actor, 'bms-application-blurred-widget'
            );


            if (this.settings.HACKS_LEVEL === 1) {
                this._log("hack level 1");

                this.paint_signals.disconnect_all_for_actor(blur_actor);
                this.paint_signals.connect(blur_actor, pipeline.effect);
            } else {
                this.paint_signals.disconnect_all_for_actor(blur_actor);
            }
        }

        meta_window.blur_actor = blur_actor;

        if (!this.settings.applications.BLUR_ON_OVERVIEW && Main.overview.visible)
            blur_actor.hide();


        this.update_size(pid);


        this.update_corner_radius(meta_window);

        this.reconcile_window_visibility(meta_window);






        this.connections.connect(
            meta_window, 'notify::maximized-horizontally',
            _ => this.update_corner_radius(meta_window)
        );
        this.connections.connect(
            meta_window, 'notify::maximized-vertically',
            _ => this.update_corner_radius(meta_window)
        );
        this.connections.connect(
            meta_window, 'notify::fullscreen',
            _ => {
                this.update_corner_radius(meta_window);
                this.reconcile_window_visibility(meta_window);
            }
        );


        this.connections.connect(
            window_actor, 'notify::opacity',
            _ => {
                this.reconcile_window_visibility(meta_window);
            }
        );


        if (!window_actor.visible)
            blur_actor.hide();

        this.connections.connect(
            window_actor,
            'notify::visible',
            _ => this.reconcile_window_visibility(meta_window)
        );
    }




    set_focus_for_window(meta_window, focus = true) {
        let new_pid = null;
        if (meta_window) {
            new_pid = meta_window.bms_pid;
        }

        if (focus)
            this.focused_window_pid = new_pid;
        else
            this.focused_window_pid = null;

        this.meta_window_map.forEach((tracked_window, _pid) =>
            this.reconcile_window_visibility(tracked_window)
        );
    }



    update_corner_radius(meta_window) {
        const is_maximized = meta_window.maximized_horizontally || meta_window.maximized_vertically;
        const is_fullscreen = meta_window.fullscreen;

        let use_0_radius = !this.settings.applications.CORNER_WHEN_MAXIMIZED && (is_maximized || is_fullscreen);

        if (this.settings.applications.STATIC_BLUR) {
            meta_window.bg_manager?._bms_pipeline?.effects.forEach(effect => {
                if (effect.constructor.name === "CornerEffect")
                    effect.straight_corners = use_0_radius;
            })
        } else {
            const pipeline = meta_window.bg_manager?._bms_pipeline;
            if (pipeline?.effect)
                pipeline.effect.unscaled_corner_radius = use_0_radius ?
                    0 : this.settings.applications.CORNER_RADIUS;
        }
    }

    reconcile_window_visibility(meta_window, overview_visible = this.overview_visible) {
        const window_actor = meta_window.get_compositor_private();
        const blur_actor = meta_window.blur_actor;
        if (!window_actor || !blur_actor)
            return;

        const is_focused = this.settings.applications.DYNAMIC_OPACITY
            && meta_window.bms_pid === this.focused_window_pid;
        const is_fullscreen = this.settings.applications.UNBLUR_WHEN_FULLSCREEN
            && meta_window.fullscreen;
        const visible_for_blur = window_actor.visible
            || (this.settings.applications.BLUR_ON_OVERVIEW && overview_visible);
        const show_blur = visible_for_blur
            && !is_focused
            && !is_fullscreen
            && (this.settings.applications.BLUR_ON_OVERVIEW || !overview_visible);

        if (show_blur)
            blur_actor.show();
        else
            blur_actor.hide();

        const wm_class = meta_window.get_wm_class();
        const isDialog = isDialogOrModalWindow(meta_window);
        const is_sidebar_system_app = !isDialog && Boolean(wm_class && (SYSTEM_SIDEBAR_WIDTHS[wm_class] || SYSTEM_SIDEBAR_WIDTHS[wm_class.toLowerCase()]));
        const target_opacity = is_sidebar_system_app ? 255 : (show_blur ? this.settings.applications.OPACITY : 255);

        this.set_window_opacity(window_actor, target_opacity);
    }


    update_all_corner_radii() {
        this.meta_window_map.forEach(
            (meta_window, _pid) => this.update_corner_radius(meta_window)
        )
    }

    update_fullscreen_status() {
        this.meta_window_map.forEach(
            (meta_window, _pid) => this.reconcile_window_visibility(meta_window)
        );
    }


    set_window_opacity(window_actor, opacity) {

        const BLUR_ACTOR_NAMES = new Set(["blur-actor", "bms-application-blurred-widget"]);

        window_actor?.get_children().forEach(child => {

            if (!BLUR_ACTOR_NAMES.has(child.name) && child.opacity != opacity) {
                child.opacity = opacity;
            }
        });
    }


    set_opacity() {
        this.meta_window_map.forEach((meta_window, _pid) =>
            this.reconcile_window_visibility(meta_window)
        );
    }




    compute_scale(meta_window) {

        const gnome_shell_major_version = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
        const scale_monitor_framebuffer =
            gnome_shell_major_version >= 50 ||
            this.mutter_gsettings
                .get_strv('experimental-features')
                .includes('scale-monitor-framebuffer');
        const is_wayland = gnome_shell_major_version >= 50 || Meta.is_wayland_compositor();
        const monitor_index = meta_window.get_monitor();

        return !scale_monitor_framebuffer && is_wayland && meta_window.get_client_type() == 0
            ? Main.layoutManager.monitors[monitor_index].geometry_scale
            : 1;
    }



    compute_allocation(meta_window) {
        const scale = this.compute_scale(meta_window);

        let frame = meta_window.get_frame_rect();
        let buffer = meta_window.get_buffer_rect();

        return {
            x: (frame.x - buffer.x) / scale,
            y: (frame.y - buffer.y) / scale,
            width: frame.width / scale,
            height: frame.height / scale
        };
    }

    change_blur_type() {
        this._log("resetting...");

        this.disable();
        setTimeout(_ => this.enable(), 1);
    }

    change_pipeline() {
        this.update_all_windows();
    }




    remove_blur(pid) {
        this._log(`removing blur for pid ${pid}`);

        let meta_window = this.meta_window_map.get(pid);
        if (meta_window) {
            let window_actor = meta_window.get_compositor_private();
            let blur_actor = meta_window.blur_actor;
            let bg_manager = meta_window.bg_manager;

            if (blur_actor && window_actor) {

                this.set_window_opacity(window_actor, 255);


                window_actor.remove_child(blur_actor);
                bg_manager._bms_pipeline.destroy();
                bg_manager.destroy();
                blur_actor.destroy();



                delete meta_window.blur_actor;
                delete meta_window.bg_manager;


                this.paint_signals.disconnect_all_for_actor(blur_actor);
                this.connections.disconnect_all_for(window_actor);
            }
        }
    }






    untrack_meta_window(pid) {
        this.remove_blur(pid);
        let meta_window = this.meta_window_map.get(pid);
        if (meta_window) {
            this.connections.disconnect_all_for(meta_window);
            this.meta_window_map.delete(pid);
        }
    }

    disable() {
        this._log("removing blur from applications...");

        this.service?.unexport();
        delete this.mutter_gsettings;

        this.meta_window_map.forEach((_meta_window, pid) => {
            this.untrack_meta_window(pid);
        });

        this.connections.disconnect_all();
        this.paint_signals.disconnect_all();
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > applications] ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > applications] ${str}`);
    }
};
