// SPDX-License-Identifier: GPL-3.0-or-later




import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';


const ANIM_IN_MS = 300;
const ANIM_OUT_MS = 300;
const TRIGGER_EDGE_PX = 1;


const HIDE_DELAY_MS = 300;

let fullscreenWindows = new Set();
let windowSignals = new Map();
let windowCreatedHandler = null;
let workspaceChangedHandler = null;
let overviewShowingHandler = null;
let overviewHiddenHandler = null;
let wsHasFullscreen = false;
let hotCorner = null;
let _enabled = false;
let _hideTimeoutId = null;
let _panelRevealed = false;
let _animating = false;
let _panelBoxEnterId = null;
let _panelBoxLeaveId = null;
let _panelBoxButtonReleaseId = null;
let _stageButtonReleaseId = null;
let _periodCheckId = null;
let _recomputeIdleId = null;
let _ghostMenu = null;
let _originalTrackFullscreen = null;

function _debug(_msg) {

}

function _getPanelBox() {
    return Main.layoutManager?.panelBox ?? null;
}

function _getPanelHeight() {
    return Main.panel?.height || 40;
}

function _cancelPanelTransitions() {
    _getPanelBox()?.remove_all_transitions?.();
}

function _cancelHideTimeout() {
    if (_hideTimeoutId) {
        GLib.Source.remove(_hideTimeoutId);
        _hideTimeoutId = null;
    }
}

function _cancelPeriodicCheck() {
    if (_periodCheckId) {
        GLib.Source.remove(_periodCheckId);
        _periodCheckId = null;
    }
}

function _startPeriodicCheck() {
    _cancelPeriodicCheck();
    _periodCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        if (!_enabled || !wsHasFullscreen) {
            _periodCheckId = null;
            return GLib.SOURCE_REMOVE;
        }


        let menuActuallyOpen = false;
        if (Main.panel?.menuManager) {

            if (Main.panel.menuManager._activeMenu) {
                menuActuallyOpen = true;
            }

            const statusArea = Main.panel.statusArea;
            if (statusArea) {
                for (const indicator of Object.values(statusArea)) {
                    if (indicator?.menu?.isOpen) {
                        menuActuallyOpen = true;
                        break;
                    }
                }
            }
        }


        if (!menuActuallyOpen && _panelRevealed) {
            const [, mouseY] = global.get_pointer();
            const panelHeight = _getPanelHeight();

            if (mouseY > panelHeight + 50) {
                _hidePanelAnimated();
                _periodCheckId = null;
                return GLib.SOURCE_REMOVE;
            }
        }

        return GLib.SOURCE_CONTINUE;
    });
}

function _scheduleHideAfterDelay(force = false) {
    if (!wsHasFullscreen) return;
    _cancelHideTimeout();
    _hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
        _hideTimeoutId = null;
        if (!_enabled) return GLib.SOURCE_REMOVE;
        if (force) {
            _hidePanelAnimated();
        } else {
            const [, mouseY] = global.get_pointer();
            const panelHeight = _getPanelHeight();
            if (mouseY > panelHeight + 4)
                _hidePanelAnimated();
        }
        return GLib.SOURCE_REMOVE;
    });
}

function _showPanelAnimated() {
    if (!_enabled) return;
    if (_panelRevealed || _animating) return;
    const panelBox = _getPanelBox();
    if (!panelBox) return;
    _cancelPanelTransitions();
    const h = _getPanelHeight();
    panelBox.translation_y = -h;
    _setPanelAutoHide(false);
    _animating = true;
    _panelRevealed = true;
    _startPeriodicCheck();
    try {
        panelBox.ease?.({
            translation_y: 0,
            duration: ANIM_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                _animating = false;
                _openGhostMenu();
            },
        });
    } catch (_) {
        panelBox.translation_y = 0;
        _animating = false;
        _openGhostMenu();
    }
}

function _hidePanelAnimated() {
    if (!_enabled) return;
    if (!_panelRevealed || _animating) return;
    const panelBox = _getPanelBox();
    if (!panelBox) return;
    _cancelPanelTransitions();
    _cancelPeriodicCheck();
    _animating = true;
    _closeGhostMenu();
    try {
        panelBox.ease?.({
            translation_y: -_getPanelHeight(),
            duration: ANIM_OUT_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                _animating = false;
                _panelRevealed = false;
                _setPanelAutoHide(true);
                panelBox.translation_y = 0;
            },
        });
    } catch (_) {
        _setPanelAutoHide(true);
        panelBox.translation_y = 0;
        _animating = false;
        _panelRevealed = false;
    }
}

function _openGhostMenu() {
    if (_ghostMenu) return;
    try {
        const panelBox = _getPanelBox();
        if (!panelBox) return;


    let anchor = new St.Widget({
        width: 1,
        height: 1,
        opacity: 0,
        reactive: false
    });

    anchor.set_position(global.stage.width + 100, 0);
    Main.uiGroup.add_child(anchor);
    _ghostMenu = new PopupMenu.PopupMenu(anchor, 0.5, St.Side.TOP);

    Main.panel?.menuManager?.addMenu?.(_ghostMenu);
    _ghostMenu.actor.opacity = 0;
    _ghostMenu.actor.reactive = false;
    Main.uiGroup.add_child(_ghostMenu.actor);
    _ghostMenu.open();
    _ghostMenu._ghostAnchor = anchor;
    } catch (e) { _debug('Failed to open ghost menu: ' + e); }
}

function _closeGhostMenu() {
    if (_ghostMenu) {
        _ghostMenu.close();
        Main.panel?.menuManager?.removeMenu?.(_ghostMenu);
        if (_ghostMenu.actor.get_parent())
            _ghostMenu.actor.get_parent().remove_child(_ghostMenu.actor);
        if (_ghostMenu._ghostAnchor && _ghostMenu._ghostAnchor.get_parent())
            _ghostMenu._ghostAnchor.get_parent().remove_child(_ghostMenu._ghostAnchor);
        _ghostMenu = null;
    }
}



function _setPanelAutoHide(enable) {
    if (!_enabled) return;

    try {
        const lm = Main.layoutManager;
        const panelBox = lm?.panelBox;
        if (!lm || !panelBox) return;

        const tracked = lm._trackedActors;
        if (!Array.isArray(tracked)) return;

        const record = tracked.find(a => a && a.actor === panelBox);
        if (!record || typeof record.trackFullscreen !== 'boolean') return;


        if (_originalTrackFullscreen === null) {
            _originalTrackFullscreen = record.trackFullscreen;
        }

        if (enable) {

            record.trackFullscreen = true;
        } else {

            record.trackFullscreen = false;

            panelBox.visible = true;
        }


        lm._updateVisibility?.();
    } catch (e) {
        _debug(`setPanelAutoHide error: ${e}`);
    }
}

function _createHoverArea() {
    if (!_enabled) return null;


    let primaryMonitor = global.display.get_primary_monitor();
    let geometry = global.display.get_monitor_geometry(primaryMonitor);

    const hoverArea = new Clutter.Actor({
        name: 'panel-hover-area',
        reactive: true,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: TRIGGER_EDGE_PX,
        opacity: 0,
    });







    hoverArea.connect('enter-event', () => {
        if (wsHasFullscreen) {
            _showPanelAnimated();
        }
    });

    hoverArea.connect('leave-event', () => {
        if (wsHasFullscreen) {
            _scheduleHideAfterDelay();
        }
    });

    hoverArea.connect('destroy', () => {

        _cancelHideTimeout();
    });

    return hoverArea;
}

function _connectWindowSignals(window) {
    if (windowSignals.has(window))
        return;

    let fullscreenId = window.connect('notify::fullscreen', () => {
        _onWindowFullscreenChanged(window);
    });

    let unmanagedId = window.connect('unmanaged', () => {
        _disconnectWindowSignals(window);
    });

    windowSignals.set(window, {
        fullscreen: fullscreenId,
        unmanaged: unmanagedId,
    });

    if (window.is_fullscreen())
        _onWindowFullscreenChanged(window);
}

function _disconnectWindowSignals(window) {
    if (!windowSignals.has(window))
        return;

    let signalIds = windowSignals.get(window);
    window.disconnect(signalIds.fullscreen);
    window.disconnect(signalIds.unmanaged);
    windowSignals.delete(window);

    if (fullscreenWindows.has(window)) {
        fullscreenWindows.delete(window);
        _recomputeFullscreenState();
    }
}

function _onWindowCreated(display, window) {
    if (!window) return;
    _connectWindowSignals(window);
}

function _onWindowFullscreenChanged(window) {
    if (window.is_fullscreen()) {
        fullscreenWindows.add(window);
        _recomputeFullscreenState();
    } else {
        fullscreenWindows.delete(window);
        _recomputeFullscreenState();
    }
}

function _recomputeFullscreenState() {
    if (!_enabled) return;

    fullscreenWindows.clear();
    try {
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws?.list_windows?.() || [];
        for (const w of windows) {
            if (w.is_fullscreen())
                fullscreenWindows.add(w);
        }
    } catch (e) {
        _debug(`Error listing windows: ${e}`);
    }

    const hasFS = fullscreenWindows.size > 0;
    wsHasFullscreen = hasFS;



    if (_recomputeIdleId) {
        GLib.Source.remove(_recomputeIdleId);
        _recomputeIdleId = null;
    }
    _recomputeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!_enabled) { _recomputeIdleId = null; return GLib.SOURCE_REMOVE; }

        try {
            if (Main.overview.visible) {

                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            } else if (wsHasFullscreen) {

                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(true);
                if (hotCorner) hotCorner.show();
            } else {

                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            }
        } catch (e) {
            _debug(`Idle fullscreen state error: ${e}`);
        }
        _recomputeIdleId = null;
        return GLib.SOURCE_REMOVE;
    });
}

function _onWorkspaceChanged() {
    _recomputeFullscreenState();
}

function _onOverviewShowing() {
    if (!_enabled) return;

    _setPanelAutoHide(false);
    if (hotCorner) hotCorner.hide();
}

function _onOverviewHidden() {
    if (!_enabled) return;

    _recomputeFullscreenState();
}

export function enable() {



    if (_enabled)
        return;
    disable();
    _enabled = true;
    _originalTrackFullscreen = null;

    try {
        hotCorner = _createHoverArea();
        if (hotCorner) {
            Main.layoutManager.addChrome(hotCorner, {
                trackFullscreen: false,
                affectsStruts: false,
                affectsInputRegion: true,
            });
        }
    } catch (e) {
        _debug(`Failed to construct hover area: ${e}`);
    }


    try {
        global.get_window_actors().forEach(actor => {
            let window = actor.meta_window;
            _connectWindowSignals(window);
        });
    } catch (e) { _debug(`Enumerating windows failed: ${e}`); }


    try { windowCreatedHandler = global.display.connect('window-created', _onWindowCreated); } catch (e) { _debug(`window-created connect failed: ${e}`); }
    try { workspaceChangedHandler = global.workspace_manager.connect('active-workspace-changed', _onWorkspaceChanged); } catch (e) { _debug(`workspace change connect failed: ${e}`); }
    try { overviewShowingHandler = Main.overview.connect('showing', _onOverviewShowing); } catch (e) { _debug(`overview showing connect failed: ${e}`); }
    try { overviewHiddenHandler = Main.overview.connect('hidden', _onOverviewHidden); } catch (e) { _debug(`overview hidden connect failed: ${e}`); }


    try {
        const panelBox = _getPanelBox();
        if (panelBox) {
            _panelBoxEnterId = panelBox.connect('enter-event', () => {
                _cancelHideTimeout();
            });
            _panelBoxLeaveId = panelBox.connect('leave-event', () => {
                if (wsHasFullscreen)
                    _scheduleHideAfterDelay();
            });

            _panelBoxButtonReleaseId = panelBox.connect('button-release-event', () => {
                if (wsHasFullscreen)
                    _scheduleHideAfterDelay(true);
            });
        }
    } catch (e) { _debug(`panelBox signals failed: ${e}`); }

    // Global stage capture to detect clicks outside panel
    try {
        _stageButtonReleaseId = global.stage.connect('button-release-event', (stage, event) => {
            if (!wsHasFullscreen || !_panelRevealed) return Clutter.EVENT_PROPAGATE;


            let menuActuallyOpen = false;
            if (Main.panel?.menuManager?._activeMenu) {
                menuActuallyOpen = true;
            }
            const statusArea = Main.panel.statusArea;
            if (statusArea) {
                for (const indicator of Object.values(statusArea)) {
                    if (indicator?.menu?.isOpen) {
                        menuActuallyOpen = true;
                        break;
                    }
                }
            }

            if (menuActuallyOpen) return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();
            const panelHeight = _getPanelHeight();


            if (stageY > panelHeight + 20) {
                _scheduleHideAfterDelay(true);
            }

            return Clutter.EVENT_PROPAGATE;
        });
    } catch (e) { _debug(`stage capture failed: ${e}`); }

    _recomputeFullscreenState();
}

export function disable() {
    _enabled = false;


    _cancelHideTimeout();
    _cancelPeriodicCheck();
    _closeGhostMenu();
    if (_recomputeIdleId) {
        GLib.Source.remove(_recomputeIdleId);
        _recomputeIdleId = null;
    }


    try {
        if (hotCorner) {
            hotCorner.destroy();
            hotCorner = null;
        }
    } catch (e) { _debug(`Destroy hotCorner failed: ${e}`); }


    if (windowCreatedHandler) {
        global.display.disconnect(windowCreatedHandler);
        windowCreatedHandler = null;
    }
    if (workspaceChangedHandler) {
        global.workspace_manager.disconnect(workspaceChangedHandler);
        workspaceChangedHandler = null;
    }
    if (overviewShowingHandler) {
        Main.overview.disconnect(overviewShowingHandler);
        overviewShowingHandler = null;
    }
    if (overviewHiddenHandler) {
        Main.overview.disconnect(overviewHiddenHandler);
        overviewHiddenHandler = null;
    }

    const panelBox = _getPanelBox();
    if (panelBox) {
        if (_panelBoxEnterId) { panelBox.disconnect(_panelBoxEnterId); _panelBoxEnterId = null; }
        if (_panelBoxLeaveId) { panelBox.disconnect(_panelBoxLeaveId); _panelBoxLeaveId = null; }
        if (_panelBoxButtonReleaseId) { panelBox.disconnect(_panelBoxButtonReleaseId); _panelBoxButtonReleaseId = null; }
    }


    if (_stageButtonReleaseId && global.stage) {
        global.stage.disconnect(_stageButtonReleaseId);
        _stageButtonReleaseId = null;
    }


    windowSignals.forEach((signalIds, window) => {
        window.disconnect(signalIds.fullscreen);
        window.disconnect(signalIds.unmanaged);
    });

    windowSignals.clear();
    fullscreenWindows.clear();
    wsHasFullscreen = false;
    _panelRevealed = false;
    _animating = false;



    try {
        const panelBox = _getPanelBox();
        if (panelBox) {

            _cancelPanelTransitions();


            panelBox.translation_y = 0;
            panelBox.visible = true;


            const lm = Main.layoutManager;
            if (lm) {
                const tracked = lm._trackedActors;
                if (Array.isArray(tracked)) {
                    const record = tracked.find(a => a && a.actor === panelBox);
                    if (record && typeof record.trackFullscreen === 'boolean') {

                        record.trackFullscreen = _originalTrackFullscreen !== null ? _originalTrackFullscreen : true;
                    }
                }

                lm._updateVisibility?.();
            }
        }
    } catch (e) {
        _debug(`Panel restoration failed: ${e}`);
    }


    _originalTrackFullscreen = null;
}
