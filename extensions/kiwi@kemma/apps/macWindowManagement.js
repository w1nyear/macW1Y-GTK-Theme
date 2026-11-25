// SPDX-License-Identifier: GPL-3.0-or-later














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


let _draggingWindow = null;
let _dragPollTimer = null;
let _showingTilePreview = false;
let _snapWindow = null;
let _lastDragEndTime = 0;


let _hasFullscreen = false;
let _isUnfullscreenAnimating = false;
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
let _fsDragState = null;

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
        const dockActor = Main.uiGroup?.get_children()?.find(c => c.name === 'dashtodockContainer');
        if (dockActor)
            return dockActor;
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

function _installerOwnsFullscreen() {
    let win = global.display.get_focus_window();
    for (let depth = 0; win && depth < 8; depth++) {
        if (win.get_gtk_application_id?.() === 'org.mactheme.installer.gui' && win.is_fullscreen())
            return true;
        win = win.get_transient_for?.();
    }
    return false;
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
                panel.set_style('background-color: #000000 !important; background: #000000 !important; background-gradient-direction: none !important;');
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





export function animateEnterFullscreen(win, startRect = null) {
    if (!win || win.window_type !== Meta.WindowType.NORMAL)
        return;

    const actor = win.get_compositor_private();
    if (!actor) {
        try { win.make_fullscreen(); } catch (_) {}
        return;
    }

    const currentRect = win.get_frame_rect();
    const fromRect = startRect || {
        x: currentRect.x,
        y: currentRect.y,
        width: currentRect.width,
        height: currentRect.height,
    };

    const monIndex = win.get_monitor();
    const mon = Main.layoutManager.monitors[monIndex] || Main.layoutManager.primaryMonitor;
    const targetRect = {
        x: mon.x,
        y: mon.y,
        width: mon.width,
        height: mon.height,
    };


    win._macFullscreenFromRect = { ...fromRect };

    let clone = null;
    try {
        const content = actor.paint_to_content(null);
        if (content) {
            clone = new Clutter.Actor({
                name: 'mac-fullscreen-expand-clone',
                content,
                x: fromRect.x,
                y: fromRect.y,
                width: fromRect.width,
                height: fromRect.height,
                opacity: 255,
                reactive: false,
            });
            Main.uiGroup.add_child(clone);
        }
    } catch (e) {
        console.warn(`[macWindowManagement] enter snapshot error: ${e}`);
    }

    if (win._fullscreenAnimClone) {
        try { win._fullscreenAnimClone.destroy(); } catch (_) {}
    }
    win._fullscreenAnimClone = clone;


    if (clone) {
        actor.opacity = 0;
    }

    win._justMaximizedFromDrag = Date.now();
    try {
        win.make_fullscreen();
    } catch (_) {}


    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
        try {
            if (actor && !actor.is_finalized?.() && actor.opacity === 0) {
                actor.opacity = 255;
            }
        } catch (_) {}
        return GLib.SOURCE_REMOVE;
    });

    if (clone) {
        clone.ease({
            x: targetRect.x,
            y: targetRect.y,
            width: targetRect.width,
            height: targetRect.height,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    if (actor && !actor.is_finalized?.()) {
                        actor.opacity = 255;
                    }
                } catch (_) {}
                clone.ease({
                    opacity: 0,
                    duration: 60,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        try { clone.destroy(); } catch (_) {}
                        if (win._fullscreenAnimClone === clone) {
                            win._fullscreenAnimClone = null;
                        }
                    },
                });
            },
        });
    } else {
        actor.opacity = 255;
    }
}

function _startMenubarDockUnfullscreenAnim() {
    _isUnfullscreenAnimating = true;

    const panelBox = _getPanelBox();
    const panelHeight = _getPanelHeight();
    if (panelBox) {
        panelBox.visible = true;
        _setPanelTrackFullscreen(false);
        _setPanelSolidDarkStyle(true);
        panelBox.remove_all_transitions();
        if (panelBox.translation_y !== 0 || !_panelRevealed) {
            panelBox.translation_y = -panelHeight;
            panelBox.ease({
                translation_y: 0,
                duration: 280,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
    }

    const dc = _getDockContainer();
    if (dc && typeof dc._animateIn === 'function') {
        try { dc._animateIn(0.28, 0); } catch (_) {}
    }
}

function _destroyFullscreenAnimClone(win) {
    if (!win) return;
    if (win._fullscreenAnimClone) {
        try { win._fullscreenAnimClone.destroy(); } catch (_) {}
        win._fullscreenAnimClone = null;
    }
    if (win._fullscreenAnimWrapper) {
        try { win._fullscreenAnimWrapper.destroy(); } catch (_) {}
        win._fullscreenAnimWrapper = null;
    }
}

function _finishUnfullscreenTransition(win, onComplete = null, targetRect = null, animGen = null) {
    if (win && animGen !== null && win._macFsAnimGen !== animGen)
        return;
    _isUnfullscreenAnimating = false;
    if (win) {
        win._macExitingFullscreen = false;
        _destroyFullscreenAnimClone(win);
        const actor = win.get_compositor_private();
        if (actor && !actor.is_finalized?.()) {
            actor.opacity = 255;
            actor.translation_x = 0;
            actor.translation_y = 0;
            actor.scale_x = 1.0;
            actor.scale_y = 1.0;
            actor.set_pivot_point(0, 0);
        }
    }

    const panelBox = _getPanelBox();
    if (panelBox) {
        panelBox.translation_y = 0;
        panelBox.visible = true;
    }
    _setPanelSolidDarkStyle(false);
    _setPanelTrackFullscreen(true);
    try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}
    _panelRevealed = false;
    _panelHiding = false;

    if (typeof onComplete === 'function') {
        try { onComplete(targetRect); } catch (_) {}
    }

    _queueRecomputeFullscreen();
}

function _executeUnfullscreenShrinkAnimation(win, actor, fsRect, targetRect, callUnmakeFullscreen, onComplete = null) {
    _startMenubarDockUnfullscreenAnim();
    const animGen = (win._macFsAnimGen = (win._macFsAnimGen || 0) + 1);

    const panelBox = _getPanelBox();
    let wrapper = null;
    let clone = null;
    try {
        const content = actor.paint_to_content(null);
        if (content) {
            const safeW = Math.max(1, targetRect.width);
            const safeH = Math.max(1, targetRect.height);
            wrapper = new Clutter.Actor({
                name: 'mac-unfullscreen-shrink-wrapper',
                x: targetRect.x,
                y: targetRect.y,
                opacity: 255,
                reactive: false,
            });
            clone = new Clutter.Actor({
                name: 'mac-unfullscreen-shrink-clone',
                content,
                x: 0,
                y: 0,
                width: safeW,
                height: safeH,
                opacity: 255,
                reactive: false,
            });
            clone.set_pivot_point(0, 0);
            clone.scale_x = fsRect.width / safeW;
            clone.scale_y = fsRect.height / safeH;
            clone.translation_x = fsRect.x - targetRect.x;
            clone.translation_y = fsRect.y - targetRect.y;
            wrapper.add_child(clone);

            if (panelBox && panelBox.get_parent() === Main.uiGroup) {
                Main.uiGroup.insert_child_below(wrapper, panelBox);
            } else {
                Main.uiGroup.add_child(wrapper);
            }
        }
    } catch (e) {
        console.warn(`[macWindowManagement] unfullscreen snapshot error: ${e}`);
        wrapper = null;
        clone = null;
    }

    _destroyFullscreenAnimClone(win);
    win._fullscreenAnimWrapper = wrapper;
    win._fullscreenAnimClone = clone;

    if (clone) {
        actor.opacity = 0;
    }

    if (callUnmakeFullscreen) {
        try {
            win.unmake_fullscreen();
            win.unmaximize();
        } catch (_) {}
        try {
            win.move_resize_frame(true, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
        } catch (_) {}
    }

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 420, () => {
        if (win._macFsAnimGen !== animGen)
            return GLib.SOURCE_REMOVE;
        try {
            if (actor && !actor.is_finalized?.() && actor.opacity === 0) {
                actor.opacity = 255;
            }
        } catch (_) {}
        if (_isUnfullscreenAnimating) {
            _finishUnfullscreenTransition(win, onComplete, targetRect, animGen);
        }
        return GLib.SOURCE_REMOVE;
    });

    if (clone && wrapper) {
        clone.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (win._macFsAnimGen !== animGen)
                    return;
                try {
                    if (actor && !actor.is_finalized?.()) {
                        actor.opacity = 255;
                    }
                } catch (_) {}
                clone.ease({
                    opacity: 0,
                    duration: 40,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        _finishUnfullscreenTransition(win, onComplete, targetRect, animGen);
                    },
                });
            },
        });
    } else {
        const scaleX = fsRect.width / Math.max(1, targetRect.width);
        const scaleY = fsRect.height / Math.max(1, targetRect.height);
        actor.remove_all_transitions();
        actor.set_pivot_point(0, 0);
        actor.scale_x = scaleX;
        actor.scale_y = scaleY;
        actor.translation_x = fsRect.x - targetRect.x;
        actor.translation_y = fsRect.y - targetRect.y;
        actor.opacity = 255;
        actor.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                try {
                    actor.set_pivot_point(0, 0);
                    actor.scale_x = 1.0;
                    actor.scale_y = 1.0;
                    actor.translation_x = 0;
                    actor.translation_y = 0;
                } catch (_) {}
                _finishUnfullscreenTransition(win, onComplete, targetRect, animGen);
            },
        });
    }
}

export function animateExitFullscreen(win, onComplete = null, targetRectOverride = null) {
    if (!win || win.window_type !== Meta.WindowType.NORMAL)
        return;
    if (win._macExitingFullscreen)
        return;

    const actor = win.get_compositor_private();
    if (!actor) {
        try {
            win.unmake_fullscreen();
            win.unmaximize();
        } catch (_) {}
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    win._macExitingFullscreen = true;
    _restoreShrunkActors(false);

    const fsRect = win.get_frame_rect();
    const monIndex = win.get_monitor();
    const mon = Main.layoutManager.monitors[monIndex] || Main.layoutManager.primaryMonitor;
    const wa = Main.layoutManager.getWorkAreaForMonitor(monIndex);

    let targetRect = targetRectOverride || win._macFullscreenFromRect;
    const isTooLarge = targetRect && targetRect.width >= wa.width - 8 && targetRect.height >= wa.height - 8;
    if (!targetRect || targetRect.width < 200 || targetRect.height < 150 || (!targetRectOverride && isTooLarge)) {
        const defaultW = Math.min(1280, Math.round(mon.width * 0.75));
        const defaultH = Math.min(800, Math.round(mon.height * 0.75));
        targetRect = {
            x: Math.round(mon.x + (mon.width - defaultW) / 2),
            y: Math.round(wa.y + Math.max(20, (wa.height - defaultH) / 2)),
            width: defaultW,
            height: defaultH,
        };
    }

    _executeUnfullscreenShrinkAnimation(win, actor, fsRect, targetRect, true, onComplete);
}

function _animateUnfullscreenFromSizeChange(win, actor, oldFrameRect) {
    if (!win || !actor) return;

    win._macExitingFullscreen = true;
    _restoreShrunkActors(false);

    const monIndex = win.get_monitor();
    const mon = Main.layoutManager.monitors[monIndex] || Main.layoutManager.primaryMonitor;
    const wa = Main.layoutManager.getWorkAreaForMonitor(monIndex);

    const fsRect = (oldFrameRect && oldFrameRect.width >= 200 && oldFrameRect.height >= 150)
        ? { x: oldFrameRect.x, y: oldFrameRect.y, width: oldFrameRect.width, height: oldFrameRect.height }
        : { x: mon.x, y: mon.y, width: mon.width, height: mon.height };

    let targetRect = win.get_frame_rect();
    if (!targetRect || targetRect.width < 200 || targetRect.height < 150) {
        targetRect = win._macFullscreenFromRect;
    }
    if (!targetRect || targetRect.width < 200 || targetRect.height < 150) {
        const defaultW = Math.min(1280, Math.round(mon.width * 0.75));
        const defaultH = Math.min(800, Math.round(mon.height * 0.75));
        targetRect = {
            x: Math.round(mon.x + (mon.width - defaultW) / 2),
            y: Math.round(wa.y + Math.max(20, (wa.height - defaultH) / 2)),
            width: defaultW,
            height: defaultH,
        };
        try {
            win.move_resize_frame(true, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
        } catch (_) {}
    }

    _executeUnfullscreenShrinkAnimation(win, actor, fsRect, targetRect, false, null);
}

function _onGrabOpBegin(_display, window, op) {
    if (!_enabled || !window || window.window_type !== Meta.WindowType.NORMAL)
        return;

    if (!MOVING_GRAB_OPS.includes(op))
        return;

    _restoreShrunkActors(false);
    _setPanelSolidDarkStyle(false);


    if (window.is_fullscreen() && !window._macExitingFullscreen) {
        try {
            animateExitFullscreen(window);
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
            if (_draggingWindow._fullscreenAnimWrapper) {
                try {
                    _draggingWindow._fullscreenAnimWrapper.set_position(frame.x, frame.y);
                } catch (_) {}
            }
            const monitor = _draggingWindow.get_monitor();
            const wa = Main.layoutManager.getWorkAreaForMonitor(monitor);
            const menubarBottom = wa.y;


            const isNearMenubar = !_draggingWindow._macExitingFullscreen && (frame.y <= menubarBottom + 14 || py <= menubarBottom + 16) && py >= 0;

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
            animateEnterFullscreen(targetWin, targetWin.get_frame_rect());
        }
    }

    _draggingWindow = null;
    _snapWindow = null;
}





function _onSizeChange(_wm, actor, whichChange, oldFrameRect) {
    if (!_enabled || !actor) return;
    const win = actor.meta_window;
    if (!win || win.window_type !== Meta.WindowType.NORMAL) return;

    if (whichChange === Meta.SizeChange.FULLSCREEN) {
        if (!win._macFullscreenFromRect && oldFrameRect && oldFrameRect.width >= 200 && oldFrameRect.height >= 150) {
            win._macFullscreenFromRect = {
                x: oldFrameRect.x,
                y: oldFrameRect.y,
                width: oldFrameRect.width,
                height: oldFrameRect.height,
            };
        }
        _queueRecomputeFullscreen();
        return;
    }

    if (whichChange === Meta.SizeChange.UNFULLSCREEN) {
        if (win._macExitingFullscreen || win._fullscreenAnimClone) {
            return;
        }
        _animateUnfullscreenFromSizeChange(win, actor, oldFrameRect);
        return;
    }

    if (win._macExitingFullscreen) {
        return;
    }

    try {
        actor.remove_all_transitions();
        actor.translation_y = 0;
        actor.scale_y = 1.0;
        _shrunkActors.delete(actor);
    } catch (_) {}

    if (whichChange === Meta.SizeChange.UNMAXIMIZE) {
        _restoreShrunkActors(false);
        _queueRecomputeFullscreen();
        return;
    }

    if (whichChange === Meta.SizeChange.MAXIMIZE) {
        _restoreShrunkActors(false);
        _queueRecomputeFullscreen();
        return;
    }

    _queueRecomputeFullscreen();
}





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

    _fullscreenWatcherTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
        if (!_enabled || !_hasFullscreen) {
            _fullscreenWatcherTimer = null;
            _fsDragState = null;
            return GLib.SOURCE_REMOVE;
        }

        try {
            if (_installerOwnsFullscreen()) {
                _fsDragState = null;
                return GLib.SOURCE_CONTINUE;
            }
            const [px, py, mask] = global.get_pointer();
            const isLmbDown = (mask & Clutter.ModifierType.BUTTON1_MASK) !== 0;
            const primaryMonitor = Main.layoutManager.primaryMonitor;
            const panelHeight = _getPanelHeight();


            if (isLmbDown) {
                if (!_fsDragState) {

                    const maxHeaderY = (_panelRevealed ? panelHeight : 0) + 75;
                    if (py >= 0 && py <= maxHeaderY) {
                        _fsDragState = {
                            startX: px,
                            startY: py,
                            isDragging: false,
                            win: null,
                            offsetX: 0,
                            offsetY: 0,
                        };
                    }
                } else if (!_fsDragState.isDragging) {
                    const dy = py - _fsDragState.startY;
                    const dx = px - _fsDragState.startX;

                    if (dy > 12 || Math.hypot(dx, dy) > 16) {
                        const ws = global.workspace_manager?.get_active_workspace();
                        let win = global.display.focus_window;
                        if (!win || !win.is_fullscreen() || win.window_type !== Meta.WindowType.NORMAL) {
                            win = ws?.list_windows?.().find(w => !w.minimized && w.is_fullscreen() && w.window_type === Meta.WindowType.NORMAL);
                        }
                        if (win && win.is_fullscreen() && !win._macExitingFullscreen) {
                            _fsDragState.isDragging = true;
                            _fsDragState.win = win;


                            _restoreShrunkActors(false);
                            _cancelPanelHide();
                            _cancelDockHide();

                            const mon = Main.layoutManager.monitors[win.get_monitor()] || primaryMonitor;
                            const wa = Main.layoutManager.getWorkAreaForMonitor(mon.index);
                            const saved = win._macFullscreenFromRect;
                            const hasWindowedSaved = saved && saved.width >= 300 && saved.height >= 200 &&
                                (saved.width < wa.width - 8 || saved.height < wa.height - 8);
                            const targetW = hasWindowedSaved ? saved.width : Math.min(1280, Math.round(mon.width * 0.75));
                            const targetH = hasWindowedSaved ? saved.height : Math.min(800, Math.round(mon.height * 0.75));
                            const targetX = Math.max(mon.x, Math.min(px - Math.round(targetW / 2), mon.x + mon.width - targetW));
                            const targetY = Math.max(wa.y + 8, py - 24);
                            const dragTargetRect = { x: targetX, y: targetY, width: targetW, height: targetH };

                            _fsDragState.offsetX = Math.round(targetW / 2);
                            _fsDragState.offsetY = 24;

                            animateExitFullscreen(win, (rect) => {
                                if (_fsDragState && _fsDragState.win === win) {
                                    const frame = rect || win.get_frame_rect();
                                    _fsDragState.offsetX = Math.min(Math.max(px - frame.x, 60), Math.max(frame.width - 60, 60));
                                    _fsDragState.offsetY = 24;
                                }
                            }, dragTargetRect);
                        } else {
                            _fsDragState = null;
                        }
                    }
                } else if (_fsDragState.isDragging && _fsDragState.win) {

                    const targetX = px - _fsDragState.offsetX;
                    const targetY = py - _fsDragState.offsetY;
                    try { _fsDragState.win.move_frame(true, targetX, targetY); } catch (_) {}
                    if (_fsDragState.win._fullscreenAnimWrapper) {
                        try {
                            _fsDragState.win._fullscreenAnimWrapper.set_position(targetX, targetY);
                        } catch (_) {}
                    }
                }
            } else {
                if (_fsDragState) {
                    if (_fsDragState.isDragging && _fsDragState.win) {
                        const win = _fsDragState.win;
                        const wa = Main.layoutManager.getWorkAreaForMonitor(primaryMonitor.index);
                        const menubarBottom = wa.y;
                        const snapY = (_fsDragState.startY <= panelHeight)
                            ? Math.max(16, Math.round(menubarBottom * 0.6))
                            : menubarBottom + 16;

                        if (py <= snapY && py >= 0) {
                            animateEnterFullscreen(win, win.get_frame_rect());
                        }
                        _queueRecomputeFullscreen();
                    }
                    _fsDragState = null;
                }
            }


            if (!_fsDragState?.isDragging) {
                if (py <= 2 && !_panelRevealed && (Date.now() - _lastDragEndTime > 300)) {
                    _showPanelAnimated();
                }
                if (py >= primaryMonitor.y + primaryMonitor.height - 3 && !_dockRevealed) {
                    _showDockAnimated();
                }
            }


            if (_panelRevealed && (!_fsDragState || !_fsDragState.isDragging)) {
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


            if (_dockRevealed && (!_fsDragState || !_fsDragState.isDragging)) {
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
    if (_installerOwnsFullscreen()) return;
    if (!_enabled) return;
    if (_panelRevealed && !_panelHiding) return;
    const panelBox = _getPanelBox();
    if (!panelBox) return;

    _cancelPanelHide();
    _panelHiding = false;
    _setPanelTrackFullscreen(false);
    panelBox.visible = true;
    _panelRevealed = true;


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


    _restoreShrunkActors(true);
}

function _showDockAnimated() {
    if (_installerOwnsFullscreen()) return;
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
    if (!_enabled) return;
    const dc = _getDockContainer();
    if (!dc) return;

    _cancelDockHide();
    try {
        if (typeof dc._animateOut === 'function')
            dc._animateOut(DOCK_ANIM_MS, 0);
    } catch (_) {}
    _dockRevealed = false;
}





function _createEdgeTriggers() {
    _destroyEdgeTriggers();

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;


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
        if (_installerOwnsFullscreen()) {
            _destroyEdgeTriggers();
            _cancelPanelHide();
            _cancelDockHide();
            _restoreShrunkActors(false);
            _panelRevealed = false;
            _panelHiding = false;
            const panelBox = _getPanelBox();
            if (panelBox) {
                panelBox.remove_all_transitions();
                panelBox.translation_y = 0;
                panelBox.hide();
            }
            _setPanelSolidDarkStyle(false);
            _setPanelTrackFullscreen(true);
            return;
        }
        if (!_topTriggerActor || !_bottomTriggerActor)
            _createEdgeTriggers();
        _startFullscreenWatcher();


        _hideDockAnimated();


        if (!Main.overview?.visible && !_isAnyPanelMenuOpen() && !_panelRevealed) {
            _cancelPanelHide();
            _panelHiding = false;
            _setPanelSolidDarkStyle(false);
            const panelBox = _getPanelBox();
            if (panelBox) {
                panelBox.remove_all_transitions();
                panelBox.translation_y = 0;
                panelBox.visible = false;
            }
            _setPanelTrackFullscreen(true);
            try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}
        }


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


        _restoreShrunkActors(false);

        if (!_isUnfullscreenAnimating) {
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

            const dc = _getDockContainer();
            if (dc && typeof dc._animateIn === 'function') {
                try { dc._animateIn(0.3, 0.1); } catch (_) {}
            }
            _dockRevealed = false;
        }
    }
}





export function enable() {
    if (_enabled) return;
    _enabled = true;

    globalThis._macWindowManagement = {
        animateEnterFullscreen,
        animateExitFullscreen,
    };


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
        _signals.push([Main.overview, Main.overview.connect('hiding', () => {
            if (_hasFullscreen && !_isAnyPanelMenuOpen()) {
                _cancelPanelHide();
                _panelRevealed = false;
                _panelHiding = false;
                _setPanelSolidDarkStyle(false);
                const panelBox = _getPanelBox();
                if (panelBox) {
                    panelBox.remove_all_transitions();
                    panelBox.translation_y = 0;
                    panelBox.visible = false;
                }
                _setPanelTrackFullscreen(true);
                try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}
            }
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

    if (globalThis._macWindowManagement) {
        delete globalThis._macWindowManagement;
    }

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


    for (const [obj, id] of _signals) {
        try { obj.disconnect(id); } catch (_) {}
    }
    _signals = [];


    const panelBox = _getPanelBox();
    if (panelBox) {
        panelBox.remove_all_transitions();
        panelBox.translation_y = 0;
        panelBox.visible = true;
    }
    _setPanelTrackFullscreen(true);
    try { Main.layoutManager?._updateVisibility?.(); } catch (_) {}


    const dc = _getDockContainer();
    if (dc && typeof dc._animateIn === 'function') {
        try { dc._animateIn(0.3, 0.1); } catch (_) {}
    }

    _draggingWindow = null;
    _snapWindow = null;
    _hasFullscreen = false;
    _isUnfullscreenAnimating = false;
    _panelRevealed = false;
    _panelHiding = false;
    _dockRevealed = false;
    _fsDragState = null;
}
