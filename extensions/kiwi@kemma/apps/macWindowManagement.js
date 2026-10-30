// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-Style Window Management & Fullscreen Edge Reveals
//
// 1. Dragging a window flush against the top menubar and releasing ->
//    Maximizes to monitor work area, keeping the menubar VISIBLE (macOS Zoom).
// 2. Clicking the window's green "fullscreen" button ("квадратик") ->
//    Expands to TRUE FULLSCREEN (win.make_fullscreen()), HIDING the menubar.
//    Clicking it again restores to windowed mode.
// 3. While in fullscreen mode:
//    - Hovering top edge reveals / slides down the top menubar smoothly.
//    - Hovering bottom edge reveals / slides up the dock smoothly.
//    - Moving pointer away smoothly hides them back.

import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MOVING_GRAB_OPS = [
    Meta.GrabOp.MOVING,
    Meta.GrabOp.MOVING_UNCONSTRAINED,
];

const PANEL_ANIM_MS = 240;
const DOCK_ANIM_MS = 0.25;
const EDGE_TRIGGER_PX = 4;
const LEAVE_DEBOUNCE_MS = 260;

let _enabled = false;
let _signals = [];

// Drag-to-top tracking state
let _draggingWindow = null;
let _dragPollTimer = null;
let _showingTilePreview = false;
let _snapWindow = null;
let _lastDragEndTime = 0;

// Fullscreen monitoring state
let _hasFullscreen = false;
let _topTriggerActor = null;
let _bottomTriggerActor = null;
let _panelRevealed = false;
let _panelHiding = false;
let _dockRevealed = false;
let _panelHideTimer = null;
let _dockHideTimer = null;
let _fullscreenWatcherTimer = null;
let _recomputeIdleId = null;
let _shrunkActors = new Set();

function _getPanelBox() {
    return Main.layoutManager?.panelBox ?? null;
}

function _getPanelHeight() {
    return _getPanelBox()?.height || Main.panel?.height || 38;
}

function _getDockContainer() {
    try {
        const cdl = Main.extensionManager?.lookup('cupertino-dock-lite@rinzler69-wastaken.github.com')?.stateObj;
        if (cdl?.dashContainer)
            return cdl.dashContainer;
        const d2d = Main.extensionManager?.lookup('dash2dock-motion@unmade.space')?.stateObj;
        if (d2d?._dockManager?.docks?.length)
            return d2d._dockManager.docks[0];
    } catch (_) {}
    return null;
}

function _setPanelTrackFullscreen(enable) {
    try {
        const lm = Main.layoutManager;
        const panelBox = _getPanelBox();
        if (!lm || !panelBox) return;

        const tracked = lm._trackedActors?.find(a => a && a.actor === panelBox);
        if (tracked && typeof tracked.trackFullscreen === 'boolean') {
            tracked.trackFullscreen = enable;
        }
    } catch (_) {}
}

function _isAnyPanelMenuOpen() {
    try {
        if (Main.panel?.menuManager?._activeMenu) return true;
        if (Main.panel?.statusArea) {
            for (const indicator of Object.values(Main.panel.statusArea)) {
                if (indicator?.menu?.isOpen) return true;
            }
        }
        if (globalThis._tahoeQSIsOpen || globalThis._tahoeNCIsOpen) return true;
        if (Main.overview?.visible) return true;
    } catch (_) {}
    return false;
}

function _isAnyDockPopupOpen() {
    try {
        if (Main.layoutManager?.modalCount > 0) return true;
        const cdl = Main.extensionManager?.lookup('cupertino-dock-lite@rinzler69-wastaken.github.com')?.stateObj;
        if (cdl?.animator?.isJumping?.()) return true;
    } catch (_) {}
    return false;
}

function _getFullscreenActors(monitorIndex) {
    const ws = global.workspace_manager?.get_active_workspace();
    if (!ws) return [];
    const windows = ws.list_windows?.() || [];
    return windows
        .filter(w => !w.minimized && w.window_type === Meta.WindowType.NORMAL && (monitorIndex === undefined || w.get_monitor() === monitorIndex))
        .filter(w => w.is_fullscreen() || (w.maximized_vertically && w.maximized_horizontally && _hasFullscreen))
        .map(w => w.get_compositor_private())
        .filter(Boolean);
}

function _restoreShrunkActors(animated = true) {
    for (const actor of _shrunkActors) {
        try {
            if (actor && !actor.is_finalized?.()) {
                actor.remove_all_transitions();
                if (animated) {
                    actor.ease({
                        translation_y: 0,
                        scale_y: 1.0,
                        duration: PANEL_ANIM_MS,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                } else {
                    actor.translation_y = 0;
                    actor.scale_y = 1.0;
                }
            }
        } catch (_) {}
    }
    _shrunkActors.clear();
}

function _setPanelSolidDarkStyle(enable) {
    try {
        const panelBox = _getPanelBox();
        const panel = Main.panel;
        const bmsBg = panelBox?.get_children?.()?.find(c => c.name === 'bms-panel-backgroundgroup');

        if (enable) {
            if (panelBox) {
                panelBox.set_style('background-color: #000000 !important; background: #000000 !important; border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.60) !important;');
            }
            if (panel) {
                panel.set_style('background-color: #000000 !important; background: #000000 !important;');
                panel.remove_style_class_name('tahoe-ink-dark');
                panel.add_style_class_name('tahoe-ink-light');
            }
            if (bmsBg) {
                bmsBg.opacity = 0;
            }
        } else {
            if (panelBox) {
                panelBox.set_style('');
            }
            if (panel) {
                panel.set_style('');
            }
            if (bmsBg) {
                bmsBg.opacity = 255;
            }
        }
    } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag Window Flush Against Menubar -> Maximize to Work Area / Fullscreen
// ─────────────────────────────────────────────────────────────────────────────

function _onGrabOpBegin(_display, window, op) {
    if (!_enabled || !window || window.window_type !== Meta.WindowType.NORMAL)
        return;

    if (!MOVING_GRAB_OPS.includes(op))
        return;

    _restoreShrunkActors(false);
    _setPanelSolidDarkStyle(false);

    // Якщо перетягується повноекранне вікно, повертаємо його у віконний режим для вільного перетягування
    if (window.is_fullscreen()) {
        try {
            window.unmake_fullscreen();
        } catch (_) {}
    }

    _draggingWindow = window;
    _snapWindow = null;

    if (_dragPollTimer) {
        GLib.Source.remove(_dragPollTimer);
        _dragPollTimer = null;
    }

    _dragPollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
        if (!_enabled || !_draggingWindow) {
            _dragPollTimer = null;
            return GLib.SOURCE_REMOVE;
        }

        try {
            const [px, py] = global.get_pointer();
            const frame = _draggingWindow.get_frame_rect();
            const monitor = _draggingWindow.get_monitor();
            const wa = Main.layoutManager.getWorkAreaForMonitor(monitor);
            const menubarBottom = wa.y;

            // When top of window approaches menubar bottom (or pointer is near menubar)
            const isNearMenubar = (frame.y <= menubarBottom + 14 || py <= menubarBottom + 16) && py >= 0;

            if (isNearMenubar) {
                if (!_showingTilePreview) {
                    _showingTilePreview = true;
                    _snapWindow = _draggingWindow;
                    try {
                        const mon = Main.layoutManager.monitors[monitor] || Main.layoutManager.primaryMonitor;
                        const fullRect = { x: mon.x, y: mon.y, width: mon.width, height: mon.height };
                        Main.wm._showTilePreview(global.window_manager, _draggingWindow, fullRect, monitor);
                    } catch (_) {}
                }
            } else if (_showingTilePreview) {
                _showingTilePreview = false;
                _snapWindow = null;
                try {
                    Main.wm._hideTilePreview();
                } catch (_) {}
            }
        } catch (_) {}

        return GLib.SOURCE_CONTINUE;
    });
}

function _onGrabOpEnd(_display, window, _op) {
    _lastDragEndTime = Date.now();

    if (_dragPollTimer) {
        GLib.Source.remove(_dragPollTimer);
        _dragPollTimer = null;
    }

    if (_showingTilePreview) {
        _showingTilePreview = false;
        try {
            Main.wm._hideTilePreview();
        } catch (_) {}

        const targetWin = _snapWindow || window || _draggingWindow;
        if (targetWin && targetWin.window_type === Meta.WindowType.NORMAL) {
            targetWin._justMaximizedFromDrag = Date.now();
            try {
                targetWin.make_fullscreen();
            } catch (_) {}
        }
    }

    _draggingWindow = null;
    _snapWindow = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Green Button Click -> True Fullscreen (win.make_fullscreen())
// ─────────────────────────────────────────────────────────────────────────────

function _onSizeChange(_wm, actor, whichChange, oldFrameRect) {
    if (!_enabled || !actor) return;
    const win = actor.meta_window;
    if (!win || win.window_type !== Meta.WindowType.NORMAL) return;

    if (!win.is_fullscreen()) {
        try {
            actor.remove_all_transitions();
            actor.translation_y = 0;
            actor.scale_y = 1.0;
            _shrunkActors.delete(actor);
        } catch (_) {}
    }

    if (whichChange === Meta.SizeChange.MAXIMIZE || whichChange === Meta.SizeChange.UNMAXIMIZE) {
        // If maximized from drag to top, preserve work area maximize (menubar visible)
        if (win._justMaximizedFromDrag && (Date.now() - win._justMaximizedFromDrag < 800)) {
            _queueRecomputeFullscreen();
            return;
        }

        // Check if cursor clicked on the green window-control button (top-left)
        const [px, py] = global.get_pointer();
        if (oldFrameRect && oldFrameRect.width > 0) {
            const relX = px - oldFrameRect.x;
            const relY = py - oldFrameRect.y;

            // In macOS button layout (close, minimize, maximize):
            // Green button sits at ~50..85px horizontally, 0..45px vertically
            if (relX >= 0 && relX <= 95 && relY >= 0 && relY <= 45) {
                // User clicked green button! Toggle TRUE FULLSCREEN
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (win && !win.is_fullscreen()) {
                        win.make_fullscreen();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _queueRecomputeFullscreen();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen Mode: Edge Hover Reveals (Menubar on Top, Dock on Bottom)
// ─────────────────────────────────────────────────────────────────────────────

function _cancelPanelHide() {
    if (_panelHideTimer) {
        GLib.Source.remove(_panelHideTimer);
        _panelHideTimer = null;
    }
}

function _cancelDockHide() {
    if (_dockHideTimer) {
        GLib.Source.remove(_dockHideTimer);
        _dockHideTimer = null;
    }
}

function _startFullscreenWatcher() {
    if (_fullscreenWatcherTimer) return;

    _fullscreenWatcherTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {
        if (!_enabled || !_hasFullscreen) {
            _fullscreenWatcherTimer = null;
            return GLib.SOURCE_REMOVE;
        }

        try {
            const [px, py] = global.get_pointer();
            const primaryMonitor = Main.layoutManager.primaryMonitor;
            const panelHeight = _getPanelHeight();

            // Edge trigger reveals (guard against immediate trigger right after drag release)
            if (py <= 2 && !_panelRevealed && (Date.now() - _lastDragEndTime > 300)) {
                _showPanelAnimated();
            }
            if (py >= primaryMonitor.y + primaryMonitor.height - 3 && !_dockRevealed) {
                _showDockAnimated();
            }

            // 1. Panel hide watch
            if (_panelRevealed) {
                if (py <= panelHeight + 8) {
                    _cancelPanelHide();
                } else if (!_isAnyPanelMenuOpen() && !_panelHideTimer) {
                    _panelHideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LEAVE_DEBOUNCE_MS, () => {
                        _panelHideTimer = null;
                        if (!_enabled) return GLib.SOURCE_REMOVE;
                        const [, currY] = global.get_pointer();
                        if (currY > panelHeight + 8 && !_isAnyPanelMenuOpen()) {
                            _hidePanelAnimated();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }

            // 2. Dock hide watch
            if (_dockRevealed) {
                const dockHeight = 95;
                const dockTop = primaryMonitor.y + primaryMonitor.height - dockHeight - 20;
                if (py >= dockTop) {
                    _cancelDockHide();
                } else if (!_isAnyDockPopupOpen() && !_dockHideTimer) {
                    _dockHideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LEAVE_DEBOUNCE_MS, () => {
                        _dockHideTimer = null;
                        if (!_enabled) return GLib.SOURCE_REMOVE;
                        const [, currY] = global.get_pointer();
                        if (currY < dockTop && !_isAnyDockPopupOpen()) {
                            _hideDockAnimated();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        } catch (_) {}

        return GLib.SOURCE_CONTINUE;
    });
}

function _showPanelAnimated() {
    if (!_enabled) return;
    if (_panelRevealed && !_panelHiding) return;
    const panelBox = _getPanelBox();
    if (!panelBox) return;

    _cancelPanelHide();
    _panelHiding = false;
    _setPanelTrackFullscreen(false);
    panelBox.visible = true;
    _panelRevealed = true;

    // Apply 100% solid dark/black styling
    _setPanelSolidDarkStyle(true);

    const h = _getPanelHeight();
    const primaryMonitor = Main.layoutManager.primaryMonitor;
    const monH = primaryMonitor?.height || 1080;

    panelBox.remove_all_transitions();
    if (panelBox.translation_y === 0 && !_panelHiding) {
        panelBox.translation_y = -h;
    }
    panelBox.ease({
        translation_y: 0,
        duration: PANEL_ANIM_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            panelBox.translation_y = 0;
        },
    });

    // Shrink fullscreen window actor(s) so window yields space to menubar
    const targetActors = _getFullscreenActors(primaryMonitor.index);
    for (const actor of targetActors) {
        try {
            actor.remove_all_transitions();
            actor.set_pivot_point(0, 0);
            actor.ease({
                translation_y: h,
                scale_y: (monH - h) / monH,
                duration: PANEL_ANIM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            _shrunkActors.add(actor);
        } catch (_) {}
    }
}

function _hidePanelAnimated() {
    if (!_enabled || !_panelRevealed || _panelHiding) return;
    const panelBox = _getPanelBox();
    if (!panelBox) return;

    _cancelPanelHide();
    _panelHiding = true;

    const h = _getPanelHeight();
    panelBox.remove_all_transitions();
    panelBox.ease({
        translation_y: -h,
        duration: PANEL_ANIM_MS,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
            _panelRevealed = false;
            _panelHiding = false;
            panelBox.translation_y = 0;
            _setPanelSolidDarkStyle(false);
            _setPanelTrackFullscreen(true);
            Main.layoutManager?._updateVisibility?.();
        },
    });

    // Restore fullscreen window(s) back to original height
    _restoreShrunkActors(true);
}

function _showDockAnimated() {
    if (!_enabled || _dockRevealed) return;
    const dc = _getDockContainer();
    if (!dc) return;

    _cancelDockHide();
    _dockRevealed = true;
    try {
        if (typeof dc._animateIn === 'function')
            dc._animateIn(DOCK_ANIM_MS, 0);
    } catch (_) {}
}

function _hideDockAnimated() {
    if (!_enabled || !_dockRevealed) return;
    const dc = _getDockContainer();
    if (!dc) return;

    _cancelDockHide();
    try {
        if (typeof dc._animateOut === 'function')
            dc._animateOut(DOCK_ANIM_MS, 0);
    } catch (_) {}
    _dockRevealed = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover Edge Trigger Actors
// ─────────────────────────────────────────────────────────────────────────────

function _createEdgeTriggers() {
    _destroyEdgeTriggers();

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    // Top hover edge
    _topTriggerActor = new Clutter.Actor({
        name: 'mac-top-edge-hover',
        reactive: true,
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: EDGE_TRIGGER_PX,
        opacity: 0,
    });
    _topTriggerActor.connect('enter-event', () => {
        if (_hasFullscreen && (Date.now() - _lastDragEndTime > 300))
            _showPanelAnimated();
    });

    // Bottom hover edge
    _bottomTriggerActor = new Clutter.Actor({
        name: 'mac-bottom-edge-hover',
        reactive: true,
        x: monitor.x,
        y: monitor.y + monitor.height - EDGE_TRIGGER_PX,
        width: monitor.width,
        height: EDGE_TRIGGER_PX,
        opacity: 0,
    });
    _bottomTriggerActor.connect('enter-event', () => {
        if (_hasFullscreen)
            _showDockAnimated();
    });

    try {
        Main.layoutManager.addChrome(_topTriggerActor, { affectsStruts: false, trackFullscreen: false });
        Main.layoutManager.addChrome(_bottomTriggerActor, { affectsStruts: false, trackFullscreen: false });
    } catch (_) {}
}

function _destroyEdgeTriggers() {
    if (_topTriggerActor) {
        try { Main.layoutManager.removeChrome(_topTriggerActor); } catch (_) {}
        try { _topTriggerActor.destroy(); } catch (_) {}
        _topTriggerActor = null;
    }
    if (_bottomTriggerActor) {
        try { Main.layoutManager.removeChrome(_bottomTriggerActor); } catch (_) {}
        try { _bottomTriggerActor.destroy(); } catch (_) {}
        _bottomTriggerActor = null;
    }
}

function _queueRecomputeFullscreen() {
    if (_recomputeIdleId) return;
    _recomputeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        _recomputeIdleId = null;
        if (!_enabled) return GLib.SOURCE_REMOVE;
        _recomputeFullscreen();
        return GLib.SOURCE_REMOVE;
    });
}

function _recomputeFullscreen() {
    let hasFS = false;
    try {
        const ws = global.workspace_manager?.get_active_workspace();
        if (ws) {
            const windows = ws.list_windows?.() || [];
            hasFS = windows.some(w => !w.minimized && w.is_fullscreen() && w.window_type === Meta.WindowType.NORMAL);
        }
        if (!hasFS) {
            hasFS = global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
        }
    } catch (_) {}

    _hasFullscreen = hasFS;

    if (hasFS) {
        if (!_topTriggerActor || !_bottomTriggerActor)
            _createEdgeTriggers();
        _startFullscreenWatcher();

        // Clean up any tracked shrunk actors that are no longer fullscreen
        for (const actor of _shrunkActors) {
            try {
                const win = actor.meta_window;
                if (!win || !win.is_fullscreen() || win.minimized) {
                    actor.remove_all_transitions();
                    actor.translation_y = 0;
                    actor.scale_y = 1.0;
                    _shrunkActors.delete(actor);
                }
            } catch (_) {
                _shrunkActors.delete(actor);
            }
        }
    } else {
        _destroyEdgeTriggers();
        _cancelPanelHide();
        _cancelDockHide();

        if (_fullscreenWatcherTimer) {
            GLib.Source.remove(_fullscreenWatcherTimer);
            _fullscreenWatcherTimer = null;
        }

        // Restore any shrunk actors immediately
        _restoreShrunkActors(false);

        // Restore menubar
        const panelBox = _getPanelBox();
        if (panelBox) {
            panelBox.remove_all_transitions();
            panelBox.translation_y = 0;
            panelBox.visible = true;
        }
        _setPanelSolidDarkStyle(false);
        _setPanelTrackFullscreen(true);
        try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}
        _panelRevealed = false;
        _panelHiding = false;

        // Restore dock
        const dc = _getDockContainer();
        if (dc && typeof dc._animateIn === 'function') {
            try { dc._animateIn(0.3, 0.1); } catch (_) {}
        }
        _dockRevealed = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enable / Disable Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function enable() {
    if (_enabled) return;
    _enabled = true;

    // Connect display and window manager signals
    try {
        _signals.push([global.display, global.display.connect('grab-op-begin', _onGrabOpBegin)]);
        _signals.push([global.display, global.display.connect('grab-op-end', _onGrabOpEnd)]);
        _signals.push([global.display, global.display.connect('in-fullscreen-changed', () => _queueRecomputeFullscreen())]);
        _signals.push([global.display, global.display.connect('notify::focus-window', () => _queueRecomputeFullscreen())]);
        _signals.push([global.window_manager, global.window_manager.connect('size-change', _onSizeChange)]);
        _signals.push([global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', () => _queueRecomputeFullscreen())]);
        _signals.push([Main.overview, Main.overview.connect('showing', () => {
            _cancelPanelHide();
            _cancelDockHide();
            _restoreShrunkActors(false);
            _setPanelSolidDarkStyle(false);
            const panelBox = _getPanelBox();
            if (panelBox) {
                panelBox.remove_all_transitions();
                panelBox.translation_y = 0;
            }
            _setPanelTrackFullscreen(false);
        })]);
        _signals.push([Main.overview, Main.overview.connect('hidden', () => _queueRecomputeFullscreen())]);
        _signals.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => {
            if (_hasFullscreen)
                _createEdgeTriggers();
        })]);
    } catch (e) {
        console.warn(`[macWindowManagement] connect error: ${e}`);
    }

    _queueRecomputeFullscreen();
}

export function disable() {
    _enabled = false;

    if (_recomputeIdleId) {
        GLib.Source.remove(_recomputeIdleId);
        _recomputeIdleId = null;
    }
    if (_dragPollTimer) {
        GLib.Source.remove(_dragPollTimer);
        _dragPollTimer = null;
    }
    if (_fullscreenWatcherTimer) {
        GLib.Source.remove(_fullscreenWatcherTimer);
        _fullscreenWatcherTimer = null;
    }
    _cancelPanelHide();
    _cancelDockHide();

    if (_showingTilePreview) {
        try { Main.wm._hideTilePreview(); } catch (_) {}
        _showingTilePreview = false;
    }

    _destroyEdgeTriggers();
    _restoreShrunkActors(false);
    _setPanelSolidDarkStyle(false);

    // Disconnect signals
    for (const [obj, id] of _signals) {
        try { obj.disconnect(id); } catch (_) {}
    }
    _signals = [];

    // Restore panel
    const panelBox = _getPanelBox();
    if (panelBox) {
        panelBox.remove_all_transitions();
        panelBox.translation_y = 0;
        panelBox.visible = true;
    }
    _setPanelTrackFullscreen(true);
    try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}

    // Restore dock
    const dc = _getDockContainer();
    if (dc && typeof dc._animateIn === 'function') {
        try { dc._animateIn(0.3, 0.1); } catch (_) {}
    }

    _draggingWindow = null;
    _snapWindow = null;
    _hasFullscreen = false;
    _panelRevealed = false;
    _panelHiding = false;
    _dockRevealed = false;
}
