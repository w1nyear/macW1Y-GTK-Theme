import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { update_from_old_settings } from './conveniences/settings_updater.js';
import { PipelinesManager } from './conveniences/pipelines_manager.js';
import { EffectsManager } from './conveniences/effects_manager.js';
import { Connections } from './conveniences/connections.js';
import { Settings } from './conveniences/settings.js';
import { KEYS } from './conveniences/keys.js';

import { PanelBlur } from './components/panel.js';
import { OverviewBlur } from './components/overview.js';
import { DashBlur } from './components/dash_to_dock.js';
import { LockscreenBlur } from './components/lockscreen.js';
import { AppFoldersBlur } from './components/appfolders.js';
import { WindowListBlur } from './components/window_list.js';
import { CoverflowAltTabBlur } from './components/coverflow_alt_tab.js';
import { ApplicationsBlur } from './components/applications.js';
import { ScreenshotBlur } from './components/screenshot.js';
import { PopupBlur } from './components/popup.js';
import { QuickSettingsBlur } from './components/quick_settings.js';
import { MenuBarController } from './components/menubar_v29.js';
import { NotificationsController } from './components/notifications_v4.js';
import { NativeDynamicBlurEffect } from './effects/native_dynamic_gaussian_blur.js';



export default class BlurMyShell extends Extension {

    enable() {
        // add the extension to global to make it accessible to other extensions

        global.blur_my_shell = this;
        globalThis.Main = Main;
        globalThis.Clutter = Clutter;
        globalThis.Meta = Meta;
        globalThis.GLib = GLib;
        globalThis.Gio = Gio;


        update_from_old_settings(this.getSettings());



        this._settings = new Settings(KEYS, this.getSettings());

        this._log("enabling extension...");


        this._connection = new Connections;

        // store it in a global array
        this._connections = [this._connection];

        // create a global effects manager (to prevent RAM bleeding)
        this._effects_manager = new EffectsManager(this._connection);

        // create a global pipelines manager, that helps talking with preferences
        this._pipelines_manager = new PipelinesManager(this._settings);


        let init = () => {

            let connection = new Connections;


            this._connections.push(connection);

            return [connection, this._settings, this._effects_manager];
        };

        this._panel_blur = new PanelBlur(...init());
        this._dash_to_dock_blur = new DashBlur(...init());
        this._overview_blur = new OverviewBlur(...init());
        this._lockscreen_blur = new LockscreenBlur(...init());
        this._appfolder_blur = new AppFoldersBlur(...init());
        this._window_list_blur = new WindowListBlur(...init());
        this._coverflow_alt_tab_blur = new CoverflowAltTabBlur(...init());
        this._applications_blur = new ApplicationsBlur(...init());
        this._screenshot_blur = new ScreenshotBlur(...init());
        this._popup = new PopupBlur(...init());
        this._quick_settings_blur = new QuickSettingsBlur(...init());
        this._menubar_controller = new MenuBarController(...init(), this._popup);
        this._notifications_controller = new NotificationsController(...init());


        this._connect_to_settings();


        if (this._settings.lockscreen.BLUR && !this._lockscreen_blur.enabled)
            this._lockscreen_blur.enable();


        this._update_rounded_blur_found();


        this._user_session_mode_enabled = false;
        this._on_session_mode_changed(Main.sessionMode);


        this._connection.connect(Main.sessionMode, 'updated',
            () => this._on_session_mode_changed(Main.sessionMode)
        );
    }


    _enable_user_session() {
        this._log("changing mode to user session...");


        this._update_clipped_redraws();




        if (Main.layoutManager._startingUp) {
            this._connection.connect(
                Main.layoutManager,
                'startup-complete',
                () => this._enable_components()
            );
        } else
            this._enable_components();



        try {
            if (this._settings.overview.BLUR && !this._overview_blur?.enabled)
                this._overview_blur?.enable();
        } catch (e) { console.error('[Blur my Shell] early overview error:', e); }

        try {
            if (this._settings.panel.BLUR && !this._panel_blur?.enabled)
                this._panel_blur?.enable();
        } catch (e) { console.error('[Blur my Shell] early panel error:', e); }



        this._user_session_mode_enabled = true;
    }














    disable() {
        this._log("disabling extension...");


        if (this._user_session_mode_enabled)
            this._disable_user_session();
        this._overview_blur.restore_patched_proto();


        this._popup.disable();
        this._lockscreen_blur.disable();


        this._panel_blur = null;
        this._dash_to_dock_blur = null;
        this._overview_blur = null;
        this._appfolder_blur = null;
        this._lockscreen_blur = null;
        this._window_list_blur = null;
        this._coverflow_alt_tab_blur = null;
        this._applications_blur = null;
        this._screenshot_blur = null;
        this._popup = null;
        this._quick_settings_blur?.disable();
        this._menubar_controller?.disable();
        this._notifications_controller?.disable();
        this._quick_settings_blur = null;
        this._menubar_controller = null;
        this._notifications_controller = null;

        this._effects_manager.destroy_all();
        this._pipelines_manager.destroy();
        this._effects_manager = null;
        this._pipelines_manager = null;

        if (this._dbusImpl) {
            try { this._dbusImpl.unexport(); } catch (_) {}
            this._dbusImpl = null;
        }


        this._settings.disconnect_all_settings();


        this._connections.forEach((connections) => {
            connections.disconnect_all();
        });
        this._connections = [];


        this._reenable_clipped_redraws();

        // remove the extension from GJS's global
        delete global.blur_my_shell;

        this._log("extension disabled.");

        this._settings = null;
    }


    _disable_user_session() {
        this._log("disabling user session mode...");


        this._panel_blur?.disable();
        this._dash_to_dock_blur?.disable();
        this._overview_blur?.disable();
        this._appfolder_blur?.disable();
        this._window_list_blur?.disable();
        this._coverflow_alt_tab_blur?.disable();
        this._applications_blur?.disable();
        this._screenshot_blur?.disable();
        this._quick_settings_blur?.disable();
        this._menubar_controller?.disable();
        this._notifications_controller?.disable();


        this._reenable_clipped_redraws();



        this._user_session_mode_enabled = false;
    }


    _restart() {
        this._log("restarting...");

        this._disable_user_session();
        this._enable_user_session();

        this._log("restarted.");
    }



    _on_session_mode_changed(session) {
        if (session.currentMode === 'user' || session.parentMode === 'user') {
            if (!this._user_session_mode_enabled)

                this._enable_user_session();
        }
        else if (session.currentMode === 'unlock-dialog') {
            if (this._user_session_mode_enabled)

                this._disable_user_session();
        }
    }


    _update_rounded_blur_found() {
        if (!NativeDynamicBlurEffect.supports_corner_radius) {
            this._settings.ROUNDED_BLUR_FOUND = false;
            this._log("using original implementation for the native blur effect")
        } else {
            this._settings.ROUNDED_BLUR_FOUND = true;
            this._log("using native rounded corners for the blur effect")
        }
    }





    _update_clipped_redraws() {
        if (this._settings.HACKS_LEVEL === 2)
            this._disable_clipped_redraws();
        else
            this._reenable_clipped_redraws();
    }


    _disable_clipped_redraws() {

    }



    _reenable_clipped_redraws() {
        let gnome_shell_major_version = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
        if (gnome_shell_major_version >= 48)
            Clutter.remove_debug_flags(
                null, Clutter.DrawDebugFlag.DISABLE_CLIPPED_REDRAWS, null
            );
        else
            Meta.remove_clutter_debug_flags(
                null, Clutter.DrawDebugFlag.DISABLE_CLIPPED_REDRAWS, null
            );
    }



    _enable_components() {
        if (!this._dash_to_dock_blur) {
            let connection = new Connections;
            this._connections.push(connection);
            this._dash_to_dock_blur = new DashBlur(connection, this._settings, this._effects_manager);
        }
        if (!this._notifications_controller) {
            let connection = new Connections;
            this._connections.push(connection);
            this._notifications_controller = new NotificationsController(connection, this._settings, this._effects_manager);
        }
        if (!this._menubar_controller) {
            let connection = new Connections;
            this._connections.push(connection);
            this._menubar_controller = new MenuBarController(connection, this._settings, this._effects_manager, this._popup);
        }



        try {
            if (this._settings.panel.BLUR && !this._panel_blur.enabled)
                this._panel_blur.enable();
        } catch (e) { console.error('[Blur my Shell] panel error:', e); }

        try {
            if (this._settings.dash_to_dock.BLUR && !this._dash_to_dock_blur.enabled)
                this._dash_to_dock_blur.enable();
        } catch (e) { console.error('[Blur my Shell] dash_to_dock error:', e); }

        try {
            if (this._settings.overview.BLUR && !this._overview_blur?.enabled)
                this._overview_blur?.enable();
        } catch (e) { console.error('[Blur my Shell] overview error:', e); }

        try {
            if (this._settings.appfolder.BLUR)
                this._appfolder_blur.enable();
        } catch (e) { console.error('[Blur my Shell] appfolder error:', e); }

        try {
            if (this._settings.applications.BLUR)
                this._applications_blur.enable();
        } catch (e) { console.error('[Blur my Shell] applications error:', e); }

        try {
            if (this._settings.window_list.BLUR)
                this._window_list_blur.enable();
        } catch (e) { console.error('[Blur my Shell] window_list error:', e); }

        try {
            if (this._settings.coverflow_alt_tab.BLUR)
                this._coverflow_alt_tab_blur.enable();
        } catch (e) { console.error('[Blur my Shell] coverflow error:', e); }

        try {
            if (this._settings.screenshot.BLUR)
                this._screenshot_blur.enable();
        } catch (e) { console.error('[Blur my Shell] screenshot error:', e); }

        try {
            if (this._settings.popup.BLUR)
                this._popup.enable();
        } catch (e) { console.error('[Blur my Shell] popup error:', e); }

        try {
            this._quick_settings_blur.enable();
        } catch (e) {
            console.error('[Blur my Shell] quick_settings error:', e);
        }

        try {
            if (this._menubar_controller && !this._menubar_controller?.enabled)
                this._menubar_controller.enable();
        } catch (e) {
            console.error('[Blur my Shell] menubar error:', e);
        }

        if (this._notifications_controller) {
            try {
                this._notifications_controller.enable();
            } catch (e) {
                console.error('[Blur my Shell] notifications error:', e);
            }
        }

        this._log("all components enabled.");
    }


    _connect_to_settings() {


        this._settings.HACKS_LEVEL_changed(() => this._restart());





        this._settings.overview.BLUR_changed(() => {
            if (this._settings.overview.BLUR)
                this._overview_blur.enable();
            else
                this._overview_blur.disable();
        });


        this._settings.overview.PIPELINE_changed(() => {
            if (this._settings.overview.BLUR)
                this._overview_blur.update_backgrounds();
        });


        this._settings.overview.STYLE_COMPONENTS_changed(() => {
            if (this._settings.overview.BLUR)
                this._overview_blur.update_components_classname();
        });





        this._settings.appfolder.BLUR_changed(() => {
            if (this._settings.appfolder.BLUR)
                this._appfolder_blur.enable();
            else
                this._appfolder_blur.disable();
        });


        this._settings.appfolder.SIGMA_changed(() => {
            if (this._settings.appfolder.BLUR)
                this._appfolder_blur.set_sigma(
                    this._settings.appfolder.SIGMA
                );
        });


        this._settings.appfolder.BRIGHTNESS_changed(() => {
            if (this._settings.appfolder.BLUR)
                this._appfolder_blur.set_brightness(
                    this._settings.appfolder.BRIGHTNESS
                );
        });


        this._settings.appfolder.STYLE_DIALOGS_changed(() => {
            if (this._settings.appfolder.BLUR)
                this._appfolder_blur.blur_appfolders();
        });





        this._settings.panel.BLUR_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.enable();
            else
                this._panel_blur.disable();
        });


        this._settings.panel.STATIC_BLUR_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.reset();
        });


        this._settings.panel.PIPELINE_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.update_pipeline();
        });


        this._settings.panel.SIGMA_changed(() => {
            if (this._quick_settings_blur?.enabled)
                this._quick_settings_blur.set_sigma(this._settings.panel.SIGMA);
        });


        this._settings.panel.UNBLUR_IN_OVERVIEW_changed(() => {
            this._panel_blur.connect_to_windows_and_overview();
        });


        this._settings.panel.FORCE_LIGHT_TEXT_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.update_light_text_classname();
        });


        this._settings.panel.OVERRIDE_BACKGROUND_changed(() => {
            if (this._settings.panel.BLUR) {
                this._panel_blur.connect_to_windows_and_overview();
                this._panel_blur.reset();
            }
        });


        this._settings.panel.STYLE_PANEL_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.connect_to_windows_and_overview();
        });


        this._settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY_changed(() => {
            if (this._settings.panel.BLUR) {
                this._panel_blur.connect_to_windows_and_overview();
                this._panel_blur.reset();
            }
        });

        this._settings.panel.OVERRIDE_BACKGROUND_DYNAMICALLY_MODE_changed(() => {
            if (this._settings.panel.BLUR) {
                this._panel_blur.connect_to_windows_and_overview();
                this._panel_blur.reset();
            }
        });

        this._settings.panel.GRADIENT_PANEL_changed(() => {
            if (this._settings.panel.BLUR) {
                this._panel_blur.update_visibility() ;
            }
        });

        this._settings.panel.GRADIENT_PANEL_MODE_changed(() => {
            if (this._settings.panel.BLUR) {
                this._panel_blur.update_visibility();
            }
        });




        this._settings.dash_to_dock.BLUR_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.enable();
            else
                this._dash_to_dock_blur.disable();
        });


        this._settings.dash_to_dock.STATIC_BLUR_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.change_blur_type();
        });


        this._settings.dash_to_dock.PIPELINE_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.update_pipeline();
        });


        this._settings.dash_to_dock.OVERRIDE_BACKGROUND_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.update_background();
        });


        this._settings.dash_to_dock.STYLE_DASH_TO_DOCK_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.update_background();
        });


        this._settings.dash_to_dock.UNBLUR_IN_OVERVIEW_changed(() => {
            if (this._settings.dash_to_dock.BLUR)
                this._dash_to_dock_blur.connect_to_overview();
        });





        this._settings.applications.BLUR_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.enable();
            else
                this._applications_blur.disable();
        });


        this._settings.applications.STATIC_BLUR_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.change_blur_type();
        });


        this._settings.applications.PIPELINE_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.change_pipeline();
        });


        this._settings.applications.CORNER_WHEN_MAXIMIZED_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.update_all_corner_radii();
        });


        this._settings.applications.OPACITY_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.set_opacity(
                    this._settings.applications.OPACITY
                );
        });


        this._settings.applications.DYNAMIC_OPACITY_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.init_dynamic_opacity();
        });


        this._settings.applications.BLUR_ON_OVERVIEW_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.connect_to_overview();
        });


        this._settings.applications.UNBLUR_WHEN_FULLSCREEN_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.update_fullscreen_status();
        });


        this._settings.applications.ENABLE_ALL_changed(() => {
            if (this._settings.applications.BLUR)
                this._applications_blur.update_all_windows();
        });


        this._settings.applications.WHITELIST_changed(() => {
            if (
                this._settings.applications.BLUR
                && !this._settings.applications.ENABLE_ALL
            )
                this._applications_blur.update_all_windows();
        });


        this._settings.applications.BLACKLIST_changed(() => {
            if (
                this._settings.applications.BLUR
                && this._settings.applications.ENABLE_ALL
            )
                this._applications_blur.update_all_windows();
        });





        this._settings.lockscreen.BLUR_changed(() => {
            if (this._settings.lockscreen.BLUR)
                this._lockscreen_blur.enable();
            else
                this._lockscreen_blur.disable();
        });


        this._settings.lockscreen.PIPELINE_changed(() => {
            if (this._settings.lockscreen.BLUR)
                this._lockscreen_blur.update_lockscreen();
        });





        this._settings.window_list.BLUR_changed(() => {
            if (this._settings.window_list.BLUR)
                this._window_list_blur.enable();
            else
                this._window_list_blur.disable();
        });





        this._settings.coverflow_alt_tab.BLUR_changed(() => {
            if (this._settings.coverflow_alt_tab.BLUR)
                this._coverflow_alt_tab_blur.enable();
            else
                this._coverflow_alt_tab_blur.disable();
        });





        this._settings.hidetopbar.COMPATIBILITY_changed(() => {

            this._panel_blur.connect_to_windows_and_overview();
        });





        this._settings.dash_to_panel.BLUR_ORIGINAL_PANEL_changed(() => {
            if (this._settings.panel.BLUR)
                this._panel_blur.reset();
        });





        this._settings.screenshot.BLUR_changed(() => {
            if (this._settings.screenshot.BLUR)
                this._screenshot_blur.enable();
            else
                this._screenshot_blur.disable();
        });


        this._settings.screenshot.PIPELINE_changed(() => {
            if (this._settings.screenshot.BLUR)
                this._screenshot_blur.update_pipeline();
        });





        this._settings.popup.BLUR_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.enable();
            else
                this._popup.disable();
        });

        this._settings.popup.STATIC_BLUR_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.reset();
        });

        this._settings.popup.PIPELINE_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.update_pipeline();
        });


        this._settings.popup.OVERRIDE_BACKGROUND_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.update_background();
        });



        this._settings.popup.PRESERVE_SHELL_THEME_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.update_background();
        });


        this._settings.popup.STYLE_POPUP_changed(() => {
            if (this._settings.popup.BLUR)
                this._popup.update_background();
        });
    }

    _log(str) {
        if (this._settings.DEBUG)
            console.log(`[Blur my Shell > extension]    ${str}`);
    }
}
