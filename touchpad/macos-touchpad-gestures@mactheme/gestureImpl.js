import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WindowSwitcherPopup } from 'resource:///org/gnome/shell/ui/altTab.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

const SOCKET_PATH = `/run/user/${GLib.get_user_name() === 'vitaliy' ? '1000' : GLib.get_uid()}/mac_touchpad.sock`;

export default class GestureImpl {
    constructor(ext) {
        this._ext = ext;
        this._switcher = null;
        this._dragWindow = null;
        this._socketConn = null;
        this._cursorHidden = false;
        this._stageEventId = 0;
        this._pinchTriggered = false;
    }

    enable() {
        try {
            const EvalIface = `
            <node>
              <interface name="org.gnome.Shell.Extensions.EvalHelper">
                <method name="Eval">
                  <arg type="s" direction="in" name="code"/>
                  <arg type="s" direction="out" name="result"/>
                </method>
              </interface>
            </node>`;
            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(EvalIface, {
                Eval: async (code) => {
                    try {
                        let res = eval(code);
                        if (res && typeof res.then === 'function')
                            res = await res;
                        return JSON.stringify(res !== undefined ? res : null) ?? 'null';
                    } catch (e) {
                        return `ERROR: ${e?.name}: ${e?.message}\n${e?.stack || e}`;
                    }
                }
            });
            this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/EvalHelper');
            log('[EvalHelper] DBus interface registered at /org/gnome/Shell/Extensions/EvalHelper');
        } catch (e) {
            log(`[EvalHelper] DBus registration error: ${e}`);
        }

        // 1. Strict 4-finger restriction for Workspace Horizontal Animation
        this._setupStrictWorkspaceSwipe();

        // 2. Setup Unix Domain Socket listener for mac-touchpad-daemon
        this._setupSocketListener();

        // 3. Pinch in (Copy) and Pinch out (Paste) via Clutter
        this._stageEventId = global.stage.connect(
            'captured-event::touchpad',
            this._handlePinchEvent.bind(this)
        );

        // 4. Restrict Overview to Mission Control (Workspace/Window picker only)
        this._setupOverviewAppGridRestriction();

        log('[macOS Gestures v2] GestureImpl enabled with topmost window targeting & cursor auto-hide.');
    }

    disable() {
        if (this._dbusImpl) {
            try { this._dbusImpl.unexport(); } catch (_) {}
            this._dbusImpl = null;
        }
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }

        this._showCursor();
        this._cleanupSocketListener();
        this._restoreWorkspaceSwipe();
        this._cleanupAltTab();

        this._dragWindow = null;
        log('[macOS Gestures v2] GestureImpl disabled.');
    }

    /* -------------------------------------------------------------
     * 1. WORKSPACE SWIPING: STRICT 4-FINGERS ONLY
     * ------------------------------------------------------------- */
    _setupStrictWorkspaceSwipe() {
        const tg = Main.wm._workspaceAnimation?._swipeTracker?._touchpadGesture;
        if (tg) {
            this._origTgHandleEvent = tg.constructor.prototype._handleEvent;
            const origFn = this._origTgHandleEvent;

            try {
                global.stage.disconnectObject(tg);
            } catch (e) {}

            tg._handleEvent = function(actor, event) {
                if (event.type() === Clutter.EventType.TOUCHPAD_SWIPE) {
                    const count = event.get_touchpad_gesture_finger_count();
                    // STRICT REQUIREMENT: Only 4 fingers allowed for workspace switching!
                    if (count !== 4)
                        return Clutter.EVENT_PROPAGATE;
                }
                return origFn.call(this, actor, event);
            };

            global.stage.connectObject(
                'event::touchpad',
                tg._handleEvent.bind(tg),
                tg
            );
        }
    }

    _restoreWorkspaceSwipe() {
        const tg = Main.wm._workspaceAnimation?._swipeTracker?._touchpadGesture;
        if (tg) {
            try {
                global.stage.disconnectObject(tg);
            } catch (e) {}

            if (this._origTgHandleEvent) {
                tg._handleEvent = this._origTgHandleEvent;
            }

            global.stage.connectObject(
                'event::touchpad',
                tg._handleEvent.bind(tg),
                tg
            );
        }
    }

    /* -------------------------------------------------------------
     * 2. CURSOR VISIBILITY CONTROLS
     * ------------------------------------------------------------- */
    _hideCursor() {
        try {
            if (!this._cursorHidden && global.backend?.get_cursor_tracker) {
                global.backend.get_cursor_tracker().inhibit_cursor_visibility();
                this._cursorHidden = true;
            }
        } catch (e) {
            log(`[macOS Gestures] Cursor hide error: ${e}`);
        }
    }

    _showCursor() {
        try {
            if (this._cursorHidden && global.backend?.get_cursor_tracker) {
                global.backend.get_cursor_tracker().uninhibit_cursor_visibility();
                this._cursorHidden = false;
            }
        } catch (e) {
            log(`[macOS Gestures] Cursor show error: ${e}`);
        }
    }

    /* -------------------------------------------------------------
     * 3. SOCKET SERVICE FOR HARDWARE DAEMON
     * ------------------------------------------------------------- */
    _setupSocketListener() {
        try {
            const sockFile = Gio.File.new_for_path(SOCKET_PATH);
            try { sockFile.delete(null); } catch (e) {}

            this._socketService = new Gio.SocketService();
            const addr = Gio.UnixSocketAddress.new(SOCKET_PATH);
            this._socketService.add_address(addr, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);

            this._socketService.connect('incoming', (svc, conn) => {
                this._socketConn = conn;
                const dis = new Gio.DataInputStream({
                    base_stream: conn.get_input_stream(),
                });
                const readNext = () => {
                    dis.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                        try {
                            const [line] = stream.read_line_finish_utf8(res);
                            if (line !== null) {
                                this._handleDaemonCommand(line.trim());
                                readNext();
                            }
                        } catch (e) {}
                    });
                };
                readNext();
                return true;
            });

            this._socketService.start();
            log(`[macOS Gestures] SocketService listening on ${SOCKET_PATH}`);
        } catch (e) {
            log(`[macOS Gestures] Error creating SocketService: ${e}`);
        }
    }

    _cleanupSocketListener() {
        if (this._socketService) {
            try {
                this._socketService.stop();
                this._socketService.close();
            } catch (e) {}
            this._socketService = null;
        }
        this._socketConn = null;
        try {
            const sockFile = Gio.File.new_for_path(SOCKET_PATH);
            sockFile.delete(null);
        } catch (e) {}
    }

    _sendToDaemon(cmd) {
        if (!this._socketConn) return;
        try {
            const outStream = this._socketConn.get_output_stream();
            const msg = cmd.endsWith('\n') ? cmd : (cmd + '\n');
            const bytes = new GLib.Bytes(new TextEncoder().encode(msg));
            outStream.write_bytes(bytes, null);
            outStream.flush(null);
        } catch (e) {
            log(`[macOS Gestures] Error sending to daemon: ${e}`);
        }
    }

    _handleDaemonCommand(cmd) {
        if (!cmd) return;

        if (cmd === 'TRI_DOWN') {
            this._hideCursor();
        } else if (cmd === 'TRI_UP') {
            this._showCursor();
        } else if (cmd === 'CMD_COPY') {
            this._showOsd('Скопійовано', 'edit-copy-symbolic');
        } else if (cmd === 'CMD_PASTE') {
            this._showOsd('Вставлено', 'edit-paste-symbolic');
        } else if (cmd === '4FG_TAP') {
            if (Main.overview.visible) {
                Main.overview.hide();
            } else {
                Main.overview.show();
            }
        } else if (cmd === '4FG_DOUBLE_TAP') {
            if (typeof globalThis.toggleMacApplications === 'function') {
                globalThis.toggleMacApplications();
            } else if (typeof Main.overview.showApps === 'function') {
                Main.overview.showApps();
            }
        } else if (cmd === 'CLIPBOARD_TOGGLE') {
            if (typeof globalThis.toggleMacClipboard === 'function') {
                globalThis.toggleMacClipboard();
            }
        } else if (cmd === 'OVERVIEW_OPEN') {
            if (!Main.overview.visible) {
                Main.overview.show();
            }
        } else if (cmd === 'OVERVIEW_CLOSE') {
            if (Main.overview.visible) {
                Main.overview.hide();
            }
        } else if (cmd === 'ALTTAB_START') {
            // STRICT REQUIREMENT: Alt+Tab ONLY works when on desktop, NOT during overview!
            if (Main.overview.visible) {
                log('[macOS Gestures] Alt+Tab blocked: overview is visible');
                return;
            }
            this._openAltTab();
            this._hideCursor();
        } else if (cmd.startsWith('ALTTAB_STEP')) {
            if (!Main.overview.visible) {
                const parts = cmd.split(' ');
                const step = parts[1] === '+1' ? 1 : -1;
                this._stepAltTab(step);
            }
        } else if (cmd === 'ALTTAB_END') {
            this._commitAltTab();
            this._showCursor();
        } else if (cmd.startsWith('DRAG_START')) {
            this._handleDragStart();
        } else if (cmd.startsWith('DRAG_MOVE')) {
            const parts = cmd.split(' ');
            const dx = parseInt(parts[1], 10) || 0;
            const dy = parseInt(parts[2], 10) || 0;
            this._handleDragMove(dx, dy);
        } else if (cmd === 'DRAG_END') {
            this._handleDragEnd();
        }
    }

    /* -------------------------------------------------------------
     * 4. ALT+TAB WINDOW SWITCHER CONTROLLER
     * ------------------------------------------------------------- */
    _openAltTab() {
        if (this._switcher) return;

        try {
            this._switcher = new WindowSwitcherPopup();
            if (!this._switcher._items || this._switcher._items.length === 0) {
                this._switcher.destroy();
                this._switcher = null;
                return;
            }

            this._switcher.show(false, 'switch-windows', 0);
            this._switcher._showImmediately();
            if (this._switcher._noModsTimeoutId) {
                GLib.source_remove(this._switcher._noModsTimeoutId);
                this._switcher._noModsTimeoutId = 0;
            }

            // Initial selection step
            this._stepAltTab(1);
        } catch (e) {
            log(`[macOS Gestures] AltTab error: ${e}`);
            this._cleanupAltTab();
        }
    }

    _stepAltTab(step) {
        if (!this._switcher || !this._switcher._items || this._switcher._items.length <= 1)
            return;

        const count = this._switcher._items.length;
        let currentIndex = this._switcher._selectedIndex >= 0 ? this._switcher._selectedIndex : 0;
        let nextIndex = (currentIndex + step) % count;
        if (nextIndex < 0) nextIndex += count;

        this._switcher._select(nextIndex);

        try {
            const scrollView = this._switcher._switcherList?._scrollView;
            const adjustment = scrollView?.hscroll?.adjustment;
            const transition = adjustment?.get_transition('value');
            if (transition) transition.advance(150);
        } catch (e) {}
    }

    _commitAltTab() {
        if (this._switcher) {
            try {
                this._switcher._finish(global.get_current_time());
            } catch (e) {
                log(`[macOS Gestures] AltTab commit error: ${e}`);
                this._cleanupAltTab();
            }
            this._switcher = null;
        }
    }

    _cleanupAltTab() {
        if (this._switcher) {
            try { this._switcher.destroy(); } catch (e) {}
            this._switcher = null;
        }
    }

    /* -------------------------------------------------------------
     * 5. THREE-FINGER DRAGGING (TOPMOST WINDOW ONLY)
     * ------------------------------------------------------------- */
    _handleDragStart() {
        this._dragWindow = null;
        const [px, py] = global.get_pointer();
        const activeWs = global.workspace_manager.get_active_workspace();

        // 1. Stage actor hit-test: physical topmost visible actor on screen
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, px, py);
        let win = null;
        let a = actor;
        while (a) {
            if (a.meta_window) {
                win = a.meta_window;
                break;
            }
            a = a.get_parent ? a.get_parent() : null;
        }

        if (win) {
            let type = win.get_window_type();
            if ((type === Meta.WindowType.NORMAL ||
                 type === Meta.WindowType.DIALOG ||
                 type === Meta.WindowType.MODAL_DIALOG) &&
                win.allows_move() &&
                !win.is_hidden() &&
                !win.minimized &&
                (win.get_workspace() === activeWs || win.is_on_all_workspaces())) {
                this._dragWindow = win;
                Main.activateWindow(win);
                this._hideCursor();
                log(`[macOS Gestures v3] Selected TOPMOST window via stage hit-test: ${win.get_title()}`);
                return;
            }
        }

        // 2. Fallback: Tab list in MRU order (index 0 is topmost/active window)
        const wins = global.display.get_tab_list(Meta.TabList.NORMAL, activeWs);
        for (let w of wins) {
            if (!w || w.is_hidden() || w.minimized) continue;
            let type = w.get_window_type();
            if (type !== Meta.WindowType.NORMAL && 
                type !== Meta.WindowType.DIALOG && 
                type !== Meta.WindowType.MODAL_DIALOG) continue;
            if (!w.allows_move()) continue;

            let r = w.get_frame_rect();
            if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
                this._dragWindow = w;
                Main.activateWindow(w);
                this._hideCursor();
                log(`[macOS Gestures v3] Selected TOPMOST window from tab list: ${w.get_title()}`);
                return;
            }
        }

        // 3. No movable window under cursor (e.g. desktop background) - DO NOT SELECT!
        log('[macOS Gestures v3] No movable window under cursor - drag ignored (cursor hidden, no selection)');
    }

    _handleDragMove(dx, dy) {
        if (this._dragWindow) {
            try {
                let r = this._dragWindow.get_frame_rect();
                this._dragWindow.move_frame(true, r.x + dx, r.y + dy);
            } catch (e) {
                this._dragWindow = null;
                this._showCursor();
            }
        }
    }

    _handleDragEnd() {
        this._dragWindow = null;
        this._showCursor();
    }

    /* -------------------------------------------------------------
     * 6. THREE-FINGER PINCH: IN (COPY) / OUT (PASTE)
     * ------------------------------------------------------------- */
    _handlePinchEvent(actor, event) {
        if (event.type() !== Clutter.EventType.TOUCHPAD_PINCH)
            return Clutter.EVENT_PROPAGATE;

        const fingers = event.get_touchpad_gesture_finger_count();
        if (fingers !== 3 && fingers !== 4)
            return Clutter.EVENT_PROPAGATE;

        const phase = event.get_gesture_phase();
        if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
            this._pinchTriggered = false;
        } else if (phase === Clutter.TouchpadGesturePhase.UPDATE) {
            if (!this._pinchTriggered) {
                const scale = event.get_gesture_pinch_scale();
                if (scale <= 0.82) {
                    // Pinch in -> Copy
                    this._pinchTriggered = true;
                    this._sendToDaemon('CMD_COPY');
                    this._showOsd('Скопійовано', 'edit-copy-symbolic');
                } else if (scale >= 1.18) {
                    // Pinch out -> Paste
                    this._pinchTriggered = true;
                    this._sendToDaemon('CMD_PASTE');
                    this._showOsd('Вставлено', 'edit-paste-symbolic');
                }
            }
        } else if (phase === Clutter.TouchpadGesturePhase.END || phase === Clutter.TouchpadGesturePhase.CANCEL) {
            this._pinchTriggered = false;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _showOsd(label, iconName) {
        try {
            Main.osdWindowManager._showOsdWindow(
                0,
                Gio.ThemedIcon.new(iconName),
                label,
                null,
                null
            );
        } catch (osdErr) {}
    }

    _setupOverviewAppGridRestriction() {
        try {
            const ov = Main.overview;
            const ctrl = ov._overview?._controls ?? ov._controls;
            if (!ctrl) return;

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
    }
}

