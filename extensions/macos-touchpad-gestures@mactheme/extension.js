import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WindowSwitcherPopup } from 'resource:///org/gnome/shell/ui/altTab.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SOCKET_PATH = `/run/user/${GLib.get_user_name() === 'vitaliy' ? '1000' : GLib.get_uid()}/mac_touchpad.sock`;

export default class MacOSTouchpadGestures extends Extension {
    enable() {
        this._switcher = null;
        this._dragWindow = null;
        this._socketConn = null;

        // 1. Strict 4-finger restriction for Workspace Horizontal Animation
        this._setupStrictWorkspaceSwipe();

        // 2. Setup Unix Domain Socket listener for mac-touchpad-daemon
        this._setupSocketListener();

        // 3. Pinch in (Copy) and Pinch out (Paste) via Clutter
        this._pinchTriggered = false;
        this._stageEventId = global.stage.connect(
            'captured-event::touchpad',
            this._handlePinchEvent.bind(this)
        );

        log('[macOS Gestures] Extension initialized with strict 4-finger workspaces & hardware daemon socket.');
    }

    disable() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }

        this._cleanupSocketListener();
        this._restoreWorkspaceSwipe();
        this._cleanupAltTab();

        this._dragWindow = null;
        log('[macOS Gestures] Extension disabled.');
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
     * 2. SOCKET SERVICE FOR HARDWARE DAEMON
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
        log(`[macOS Gestures] Handling daemon command: ${cmd}`);

        if (cmd === '4FG_TAP') {
            if (Main.overview.visible) {
                Main.overview.hide();
            } else {
                Main.overview.show();
            }
        } else if (cmd === '4FG_DOUBLE_TAP') {
            Main.overview.showApps();
        } else if (cmd === 'ALTTAB_START') {
            this._openAltTab();
        } else if (cmd.startsWith('ALTTAB_STEP')) {
            const parts = cmd.split(' ');
            const step = parts[1] === '+1' ? 1 : -1;
            this._stepAltTab(step);
        } else if (cmd === 'ALTTAB_END') {
            this._commitAltTab();
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
     * 3. ALT+TAB WINDOW SWITCHER CONTROLLER
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
     * 4. 3-FINGER DRAGGING (WINDOW / DESKTOP FILE)
     * ------------------------------------------------------------- */
    _handleDragStart() {
        this._dragWindow = null;
        const [px, py] = global.get_pointer();
        const wins = global.display.sort_windows_by_stacking(global.display.list_all_windows(), true);
        for (let w of wins) {
            if (w.is_hidden() || !w.is_on_primary_monitor()) continue;
            if (w.get_window_type() !== 0) continue; // Only normal application windows
            if (!w.allows_move()) continue;
            let r = w.get_frame_rect();
            if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
                this._dragWindow = w;
                log(`[macOS Gestures] 3-finger moving window: ${w.get_title()}`);
                break;
            }
        }

        if (!this._dragWindow) {
            // Not over a normal window -> Dragging file or desktop item!
            log('[macOS Gestures] 3-finger dragging file/desktop item');
            this._sendToDaemon('EMIT_BTN_DOWN');
        }
    }

    _handleDragMove(dx, dy) {
        if (this._dragWindow) {
            try {
                let r = this._dragWindow.get_frame_rect();
                this._dragWindow.move_frame(true, r.x + dx, r.y + dy);
            } catch (e) {
                this._dragWindow = null;
            }
        }
    }

    _handleDragEnd() {
        if (this._dragWindow) {
            this._dragWindow = null;
        } else {
            this._sendToDaemon('EMIT_BTN_UP');
        }
    }

    /* -------------------------------------------------------------
     * 5. THREE-FINGER PINCH: IN (COPY) / OUT (PASTE)
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
}
