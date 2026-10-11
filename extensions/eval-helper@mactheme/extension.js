import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

export default class EvalHelper extends Extension {
    enable() {
        global.context.unsafe_mode = true;

        // Group notifications by application name so multiple notifications from the same app stack together
        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && !this._origGetSourceForPidAndName) {
            this._origGetSourceForPidAndName = fdo._getSourceForPidAndName.bind(fdo);
            const origFn = this._origGetSourceForPidAndName;
            fdo._getSourceForPidAndName = function(sender, pid, appName) {
                const key = (appName && appName.trim()) ? appName.trim() : (pid || sender || 'generic');
                let source = this._sourceForPidAndName.get(key);
                if (source)
                    return source;

                source = origFn(sender, null, key);
                this._sourceForPidAndName.set(key, source);
                source.connect('destroy', () => {
                    this._sourceForPidAndName.delete(key);
                });
                return source;
            };
        }

        // Steal focus / automatically raise windows that demand attention or are newly opened
        const wah = Main.windowAttentionHandler;
        if (wah && !this._origOnWindowDemandsAttention) {
            this._origOnWindowDemandsAttention = wah._onWindowDemandsAttention.bind(wah);
            wah._onWindowDemandsAttention = function(display, window) {
                if (!window || window.has_focus() || window.is_skip_taskbar())
                    return;
                Main.activateWindow(window);
            };
        }

        this._demandsAttentionId = global.display.connect('window-demands-attention', (display, window) => {
            if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                Main.activateWindow(window);
            }
        });

        this._markedUrgentId = global.display.connect('window-marked-urgent', (display, window) => {
            if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                Main.activateWindow(window);
            }
        });

        this._mapId = global.window_manager.connect('map', (wm, windowActor) => {
            let window = windowActor.get_meta_window ? windowActor.get_meta_window() : null;
            if (!window)
                return;
            let type = window.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG && type !== Meta.WindowType.MODAL_DIALOG)
                return;
            if (window.is_skip_taskbar())
                return;
            if (window.customJS_ding && window.customJS_ding.keepAtBottom)
                return;

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                    Main.activateWindow(window);
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        // macOS Startup Transition: Smooth opacity fade-in, rock-solid wallpaper (no zoom/scale)
        if (Main.layoutManager) {
            this._origStartupAnimationSession = Main.layoutManager._startupAnimationSession;
            Main.layoutManager._startupAnimationSession = async function() {
                if (this._startInOverview) {
                    await Main.overview.runStartupAnimation();
                } else {
                    this.panelBox.ease({
                        opacity: 255,
                        duration: 700,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });

                    for (const child of this.uiGroup.get_children()) {
                        if (child !== this._backgroundGroup && child !== this._systemBackground && child !== this._coverPane) {
                            if (child.opacity !== 255) {
                                child.ease({
                                    opacity: 255,
                                    duration: 700,
                                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                });
                            }
                        }
                    }

                    await global.window_group.easeAsync({
                        opacity: 255,
                        duration: 700,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    }).catch(() => {});
                }
            };
        }
    }

    disable() {
        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && this._origGetSourceForPidAndName) {
            fdo._getSourceForPidAndName = this._origGetSourceForPidAndName;
            this._origGetSourceForPidAndName = null;
        }

        const wah = Main.windowAttentionHandler;
        if (wah && this._origOnWindowDemandsAttention) {
            wah._onWindowDemandsAttention = this._origOnWindowDemandsAttention;
            this._origOnWindowDemandsAttention = null;
        }

        if (this._demandsAttentionId) {
            global.display.disconnect(this._demandsAttentionId);
            this._demandsAttentionId = null;
        }

        if (this._markedUrgentId) {
            global.display.disconnect(this._markedUrgentId);
            this._markedUrgentId = null;
        }

        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = null;
        }

        if (Main.layoutManager && this._origStartupAnimationSession) {
            Main.layoutManager._startupAnimationSession = this._origStartupAnimationSession;
            this._origStartupAnimationSession = null;
        }
    }
}
