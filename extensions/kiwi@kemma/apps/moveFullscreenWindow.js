// SPDX-License-Identifier: GPL-3.0-or-later












import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const MIN_WORKSPACES = 2;


const KEEP_EMPTY_WORKSPACE_AT_END = true;


const FULLSCREEN_ISOLATION_DELAY = 600;



const FULLSCREEN_RESTORE_DELAY = 600;


const WORKSPACE_CLEANUP_DELAY = 600;



const MAX_WORKSPACES = 36;



const FULLSCREEN_ANIMATION_SLOWDOWN = 3;



const SLOWDOWN_RESET_DELAY = 700;


class FullscreenWorkspaceManager {
    constructor() {

        this._windowSignals = new Map();


        this._pendingIsolation = new Map();


        this._pendingRestore = new Map();


        this._fullscreenWorkspaces = new Map();


        this._pendingCleanup = new Map();


        this._pendingWindowCreated = new Map();


        this._pendingWindowUnmanaged = new Map();

        // Global signal IDs
        this._windowCreatedId = null;
        this._workspacesChangedId = null;
        this._workspaceSwitchedId = null;


        this._checkWorkspacesId = 0;


        this._isCreatingWorkspace = false;


        this._mutterSettings = null;
        this._wmPreferences = null;


        this._slowdownResetId = 0;
        this._originalSlowDownFactor = 1;
    }






    _raiseSlowdown(resetDelay) {
        const settings = St.Settings.get();


        if (this._slowdownResetId === 0) {
            this._originalSlowDownFactor = settings.slow_down_factor;
        } else {
            GLib.Source.remove(this._slowdownResetId);
            this._slowdownResetId = 0;
        }

        settings.slow_down_factor = FULLSCREEN_ANIMATION_SLOWDOWN;

        this._slowdownResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, resetDelay, () => {
            St.Settings.get().slow_down_factor = this._originalSlowDownFactor;
            this._slowdownResetId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }










    _activateWorkspaceWithSlowAnimation(targetWs, movingWindow) {
        this._raiseSlowdown(SLOWDOWN_RESET_DELAY);

        const animation = Main.wm?._workspaceAnimation;
        if (movingWindow && animation) {

            animation.movingWindow = movingWindow;
            targetWs.activate_with_focus(movingWindow, global.get_current_time());
        } else {
            targetWs.activate(global.get_current_time());
        }
    }








    _getWorkspaceManager() {
        return global.workspace_manager;
    }





    _isDynamicWorkspaceMode() {
        if (!this._mutterSettings) {
            return true;
        }
        return this._mutterSettings.get_boolean('dynamic-workspaces');
    }





    _isWorkspacesOnlyOnPrimary() {
        if (!this._mutterSettings) {
            return false;
        }
        return this._mutterSettings.get_boolean('workspaces-only-on-primary');
    }







    _filterWorkspaceRelevantWindows(windows) {
        if (!this._isWorkspacesOnlyOnPrimary()) {
            return windows;
        }

        return windows.filter(w => w.is_on_primary_monitor());
    }





    _getMaxAllowedWorkspaces() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return MAX_WORKSPACES;

        if (this._isDynamicWorkspaceMode()) {
            return MAX_WORKSPACES;
        }


        if (this._wmPreferences) {
            try {
                const numWorkspaces = this._wmPreferences.get_int('num-workspaces');
                return Math.min(numWorkspaces, MAX_WORKSPACES);
            } catch (e) {

                return Math.min(wm.n_workspaces, MAX_WORKSPACES);
            }
        }

        return Math.min(wm.n_workspaces, MAX_WORKSPACES);
    }








    _canAppendWorkspace(bypassNumWorkspacesLimit = false) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return false;


        if (wm.n_workspaces >= MAX_WORKSPACES)
            return false;


        if (!bypassNumWorkspacesLimit) {
            const maxAllowed = this._getMaxAllowedWorkspaces();
            if (wm.n_workspaces >= maxAllowed)
                return false;
        }


        if (this._isCreatingWorkspace)
            return false;

        return true;
    }




    _getMainWorkspace() {
        const wm = this._getWorkspaceManager();
        if (!wm || wm.n_workspaces < 1)
            return null;
        return wm.get_workspace_by_index(0);
    }




    _isFullscreenWorkspace(workspaceIndex) {
        return this._fullscreenWorkspaces.has(workspaceIndex);
    }




    _getFullscreenWindowOnWorkspace(workspaceIndex) {
        return this._fullscreenWorkspaces.get(workspaceIndex) || null;
    }





    _findFirstEmptyWorkspaceAfter(startIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return null;

        for (let i = startIndex + 1; i < wm.n_workspaces; i++) {
            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length === 0) {
                    return ws;
                }
            }
        }
        return null;
    }





    _findLastOccupiedWorkspaceIndex() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return -1;

        for (let i = wm.n_workspaces - 1; i >= 0; i--) {
            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length > 0) {
                    return i;
                }
            }
        }
        return -1;
    }







    _ensureEmptyWorkspaceAtEnd() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;


        if (this._isCreatingWorkspace)
            return;


        while (wm.n_workspaces < MIN_WORKSPACES && this._canAppendWorkspace(true)) {
            this._isCreatingWorkspace = true;
            wm.append_new_workspace(false, global.get_current_time());
            this._isCreatingWorkspace = false;
        }

        if (!KEEP_EMPTY_WORKSPACE_AT_END)
            return;

        const lastOccupied = this._findLastOccupiedWorkspaceIndex();




        if (lastOccupied >= 0 && wm.n_workspaces <= lastOccupied + 1 && this._canAppendWorkspace(true)) {
            this._isCreatingWorkspace = true;
            wm.append_new_workspace(false, global.get_current_time());
            this._isCreatingWorkspace = false;
        }
    }




    _queueCheckWorkspaces() {
        if (this._checkWorkspacesId !== 0)
            return;

        this._checkWorkspacesId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._checkWorkspacesId = 0;
            this._checkWorkspaces();
            return GLib.SOURCE_REMOVE;
        });
    }






    _checkWorkspaces() {

        this._ensureEmptyWorkspaceAtEnd();
    }





    _onWorkspaceSwitched(wm, from, to, _direction) {

        this._cancelWorkspaceCleanup(to);


        if (from !== to && from > 0) {


            if (!this._isDynamicWorkspaceMode()) {
                this._scheduleCleanupAllEmptyWorkspaces();
            } else {

                this._scheduleWorkspaceCleanup(from);
            }
        }
    }





    _scheduleWorkspaceCleanup(workspaceIndex) {

        this._cancelWorkspaceCleanup(workspaceIndex);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORKSPACE_CLEANUP_DELAY, () => {
            this._pendingCleanup.delete(workspaceIndex);
            this._cleanupWorkspaceIfEmpty(workspaceIndex);
            return GLib.SOURCE_REMOVE;
        });

        this._pendingCleanup.set(workspaceIndex, sourceId);
    }





    _cleanupWorkspaceIfEmpty(workspaceIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;


        if (workspaceIndex <= 0)
            return;


        if (wm.n_workspaces <= MIN_WORKSPACES)
            return;


        if (workspaceIndex >= wm.n_workspaces)
            return;

        const ws = wm.get_workspace_by_index(workspaceIndex);
        if (!ws)
            return;

        const windows = this._filterWorkspaceRelevantWindows(
            ws.list_windows().filter(w => !w.skip_taskbar)
        );


        if (windows.length === 0 && !ws.active) {

            const lastOccupied = this._findLastOccupiedWorkspaceIndex();
            if (workspaceIndex === lastOccupied + 1 && wm.n_workspaces === workspaceIndex + 1) {

                return;
            }


            if (wm.n_workspaces - 1 < MIN_WORKSPACES)
                return;

            this._fullscreenWorkspaces.delete(workspaceIndex);
            wm.remove_workspace(ws, global.get_current_time());
            this._shiftFullscreenIndicesAfterRemove(workspaceIndex);
        }


        this._ensureEmptyWorkspaceAtEnd();
    }




    _cancelWorkspaceCleanup(workspaceIndex) {
        const sourceId = this._pendingCleanup.get(workspaceIndex);
        if (sourceId) {
            GLib.Source.remove(sourceId);
            this._pendingCleanup.delete(workspaceIndex);
        }
    }




    _scheduleCleanupAllEmptyWorkspaces() {

        const CLEANUP_ALL_ID = -1;


        this._cancelWorkspaceCleanup(CLEANUP_ALL_ID);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORKSPACE_CLEANUP_DELAY, () => {
            this._pendingCleanup.delete(CLEANUP_ALL_ID);
            this._cleanupAllEmptyWorkspaces();
            return GLib.SOURCE_REMOVE;
        });

        this._pendingCleanup.set(CLEANUP_ALL_ID, sourceId);
    }





    _cleanupAllEmptyWorkspaces() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;


        if (wm.n_workspaces <= MIN_WORKSPACES)
            return;


        const activeWs = wm.get_active_workspace();
        const activeIndex = activeWs ? activeWs.index() : -1;


        const lastOccupied = this._findLastOccupiedWorkspaceIndex();


        const emptyIndices = [];
        for (let i = 1; i < wm.n_workspaces; i++) {

            if (i === activeIndex)
                continue;


            if (KEEP_EMPTY_WORKSPACE_AT_END && i === lastOccupied + 1 && i === wm.n_workspaces - 1)
                continue;

            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length === 0) {
                    emptyIndices.push(i);
                }
            }
        }


        emptyIndices.sort((a, b) => b - a);

        for (const idx of emptyIndices) {

            if (wm.n_workspaces <= MIN_WORKSPACES)
                break;


            if (idx >= wm.n_workspaces || idx <= 0)
                continue;

            const ws = wm.get_workspace_by_index(idx);
            if (!ws)
                continue;

            const windows = this._filterWorkspaceRelevantWindows(
                ws.list_windows().filter(w => !w.skip_taskbar)
            );
            if (windows.length === 0 && !ws.active) {
                this._fullscreenWorkspaces.delete(idx);
                wm.remove_workspace(ws, global.get_current_time());

                this._shiftFullscreenIndicesAfterRemove(idx);
            }
        }


        this._ensureEmptyWorkspaceAtEnd();
    }








    _onWindowCreated(display, window) {
        this._connectWindowSignals(window);



        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingWindowCreated.delete(window);
            this._redirectWindowFromFullscreenWorkspace(window);

            this._ensureEmptyWorkspaceAtEnd();
            return GLib.SOURCE_REMOVE;
        });
        this._pendingWindowCreated.set(window, sourceId);
    }




    _connectWindowSignals(window) {
        if (this._windowSignals.has(window))
            return;


        if (window.skip_taskbar)
            return;

        const fullscreenId = window.connect('notify::fullscreen', () => {
            this._onWindowFullscreenChanged(window);
        });

        const unmanagedId = window.connect('unmanaged', () => {
            this._onWindowUnmanaged(window);
        });

        this._windowSignals.set(window, {
            fullscreen: fullscreenId,
            unmanaged: unmanagedId,
        });


        this._captureOriginalWorkspace(window);


        if (window.is_fullscreen()) {
            this._onWindowFullscreenChanged(window);
        }
    }




    _disconnectWindowSignals(window) {
        const signals = this._windowSignals.get(window);
        if (signals) {
            window.disconnect(signals.fullscreen);
            window.disconnect(signals.unmanaged);
            this._windowSignals.delete(window);
        }
    }




    _captureOriginalWorkspace(window) {
        if (window._kiwi_originalWorkspaceIndex === undefined) {
            const ws = window.get_workspace();
            window._kiwi_originalWorkspaceIndex = ws ? ws.index() : 0;
        }
    }








    _onWindowFullscreenChanged(window) {
        if (window.is_fullscreen()) {
            this._scheduleIsolation(window);
        } else {
            this._cancelPendingIsolation(window);
            this._restoreWindowFromFullscreen(window);
        }
    }




    _scheduleIsolation(window) {
        if (window._kiwi_isolated || this._pendingIsolation.has(window))
            return;


        this._captureOriginalWorkspace(window);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FULLSCREEN_ISOLATION_DELAY, () => {
            this._pendingIsolation.delete(window);

            if (!window.is_fullscreen())
                return GLib.SOURCE_REMOVE;

            this._isolateFullscreenWindow(window);

            return GLib.SOURCE_REMOVE;
        });

        this._pendingIsolation.set(window, sourceId);
    }




    _cancelPendingIsolation(window) {
        const sourceId = this._pendingIsolation.get(window);
        if (sourceId) {
            GLib.Source.remove(sourceId);
            this._pendingIsolation.delete(window);
        }
    }











    _isolateFullscreenWindow(window) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        if (window._kiwi_isolated)
            return;

        let currentWs = null;
        let currentIndex = 0;
        let otherWindowsOnCurrent = 0;

        currentWs = window.get_workspace();
        currentIndex = currentWs?.index?.() ?? 0;
        const allWindows = this._filterWorkspaceRelevantWindows(
            currentWs?.list_windows?.().filter(w => !w.skip_taskbar) || []
        );
        otherWindowsOnCurrent = allWindows.filter(w => w !== window).length;





        const shouldMove = (currentIndex === 0) || (otherWindowsOnCurrent > 0);

        if (!shouldMove) {

            window._kiwi_isolated = true;
            window._kiwi_fullscreenWorkspaceIndex = currentIndex;
            this._fullscreenWorkspaces.set(currentIndex, window);
            this._ensureEmptyWorkspaceAtEnd();
            return;
        }


        const desiredTargetIndex = currentIndex + 1;
        let targetWs = null;


        if (desiredTargetIndex < wm.n_workspaces) {
            const existingWs = wm.get_workspace_by_index(desiredTargetIndex);
            if (existingWs) {
                const existingWindows = this._filterWorkspaceRelevantWindows(
                    existingWs.list_windows().filter(w => !w.skip_taskbar)
                );
                if (existingWindows.length === 0) {

                    targetWs = existingWs;
                } else {




                    const lastOccupiedIndex = this._findLastOccupiedWorkspaceIndex();
                    let shiftDestinationWs = null;


                    if (lastOccupiedIndex >= 0 && lastOccupiedIndex + 1 < wm.n_workspaces) {
                        shiftDestinationWs = wm.get_workspace_by_index(lastOccupiedIndex + 1);
                    }


                    if (!shiftDestinationWs) {
                        if (this._canAppendWorkspace(true)) {
                            this._isCreatingWorkspace = true;
                            shiftDestinationWs = wm.append_new_workspace(false, global.get_current_time());
                            this._isCreatingWorkspace = false;
                        } else {

                            console.warn('Kiwi: Cannot isolate fullscreen window - maximum workspace limit reached');
                            return;
                        }
                    }

                    if (!shiftDestinationWs) {
                        console.warn('Kiwi: Failed to create destination workspace for shifting');
                        return;
                    }



                    const newLastOccupiedIndex = this._findLastOccupiedWorkspaceIndex();
                    for (let i = newLastOccupiedIndex; i >= desiredTargetIndex; i--) {
                        const sourceWs = wm.get_workspace_by_index(i);
                        if (!sourceWs)
                            continue;

                        const windowsToMove = this._filterWorkspaceRelevantWindows(
                            sourceWs.list_windows().filter(w => !w.skip_taskbar)
                        );
                        if (windowsToMove.length === 0)
                            continue;


                        const targetShiftWs = wm.get_workspace_by_index(i + 1);
                        if (!targetShiftWs)
                            continue;


                        for (const w of windowsToMove) {
                            w.change_workspace(targetShiftWs);


                            if (w._kiwi_fullscreenWorkspaceIndex === i) {
                                w._kiwi_fullscreenWorkspaceIndex = i + 1;
                                this._fullscreenWorkspaces.delete(i);
                                this._fullscreenWorkspaces.set(i + 1, w);
                            }
                        }
                    }


                    targetWs = existingWs;
                }
            }
        }


        if (!targetWs) {
            if (this._canAppendWorkspace(true)) {
                this._isCreatingWorkspace = true;
                targetWs = wm.append_new_workspace(false, global.get_current_time());
                this._isCreatingWorkspace = false;
            } else {


                console.warn('Kiwi: Cannot isolate fullscreen window - maximum workspace limit reached');
                return;
            }
        }

        if (!targetWs)
            return;


        let finalTargetIndex = targetWs.index();

        const leavingWorkspaceIndex = currentIndex;


        window.change_workspace(targetWs);



        this._activateWorkspaceWithSlowAnimation(targetWs, window);


        window._kiwi_isolated = true;
        window._kiwi_fullscreenWorkspaceIndex = finalTargetIndex;
        this._fullscreenWorkspaces.set(finalTargetIndex, window);


        this._cancelWorkspaceCleanup(finalTargetIndex);


        if (leavingWorkspaceIndex > 0) {
            this._scheduleWorkspaceCleanup(leavingWorkspaceIndex);
        }


        this._ensureEmptyWorkspaceAtEnd();
    }




    _shiftFullscreenIndicesAfterRemove(removedIndex) {
        const newMap = new Map();
        for (const [idx, win] of this._fullscreenWorkspaces) {
            if (idx > removedIndex) {

                const newIdx = idx - 1;
                newMap.set(newIdx, win);
                if (win._kiwi_fullscreenWorkspaceIndex !== undefined) {
                    win._kiwi_fullscreenWorkspaceIndex = newIdx;
                }
            } else if (idx < removedIndex) {
                newMap.set(idx, win);
            }

        }
        this._fullscreenWorkspaces = newMap;


        for (const [win] of this._windowSignals) {
            if (win._kiwi_originalWorkspaceIndex !== undefined &&
                win._kiwi_originalWorkspaceIndex > removedIndex) {
                win._kiwi_originalWorkspaceIndex -= 1;
            }
        }
    }




    _restoreWindowFromFullscreen(window) {
        if (!window._kiwi_isolated)
            return;


        this._cancelPendingRestore(window);

        const fullscreenWsIndex = window._kiwi_fullscreenWorkspaceIndex;
        const originalIndex = window._kiwi_originalWorkspaceIndex;


        window._kiwi_isolated = false;
        window._kiwi_fullscreenWorkspaceIndex = undefined;


        if (fullscreenWsIndex !== undefined) {
            this._fullscreenWorkspaces.delete(fullscreenWsIndex);
        }


        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FULLSCREEN_RESTORE_DELAY, () => {
            this._pendingRestore.delete(window);
            this._executeWindowRestore(window, originalIndex, fullscreenWsIndex);
            return GLib.SOURCE_REMOVE;
        });

        this._pendingRestore.set(window, sourceId);
    }




    _cancelPendingRestore(window) {
        const sourceId = this._pendingRestore.get(window);
        if (sourceId) {
            GLib.Source.remove(sourceId);
            this._pendingRestore.delete(window);
        }
    }




    _executeWindowRestore(window, originalIndex, fullscreenWsIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;


        let targetIndex = 0;
        if (originalIndex !== undefined && originalIndex >= 0) {

            targetIndex = Math.min(originalIndex, Math.max(0, wm.n_workspaces - 1));
        }


        const targetWs = wm.get_workspace_by_index(targetIndex);
        if (targetWs) {
            window.change_workspace(targetWs);

            this._activateWorkspaceWithSlowAnimation(targetWs, window);
        }


        window._kiwi_originalWorkspaceIndex = undefined;


        if (fullscreenWsIndex !== undefined && fullscreenWsIndex > 0) {
            this._scheduleWorkspaceCleanup(fullscreenWsIndex);
        }
    }




    _onWindowUnmanaged(window) {

        this._cancelPendingIsolation(window);
        this._cancelPendingRestore(window);

        const fullscreenWsIndex = window._kiwi_fullscreenWorkspaceIndex;
        const originalIndex = window._kiwi_originalWorkspaceIndex;


        let windowWorkspaceIndex = null;
        const ws = window.get_workspace();
        windowWorkspaceIndex = ws?.index?.() ?? null;


        this._disconnectWindowSignals(window);


        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingWindowUnmanaged.delete(window);
            const wm = this._getWorkspaceManager();
            if (!wm)
                return GLib.SOURCE_REMOVE;




            if (fullscreenWsIndex !== undefined &&
                originalIndex !== undefined && originalIndex >= 0 && originalIndex < wm.n_workspaces) {
                const ws = wm.get_workspace_by_index(originalIndex);
                if (ws && !ws.active) {
                    this._activateWorkspaceWithSlowAnimation(ws);
                }
            }


            if (fullscreenWsIndex !== undefined) {
                this._fullscreenWorkspaces.delete(fullscreenWsIndex);
            }


            const wsToCleanup = fullscreenWsIndex ?? windowWorkspaceIndex;
            if (wsToCleanup !== null && wsToCleanup > 0) {
                this._scheduleWorkspaceCleanup(wsToCleanup);
            }

            return GLib.SOURCE_REMOVE;
        });
        this._pendingWindowUnmanaged.set(window, sourceId);
    }




    _redirectWindowFromFullscreenWorkspace(window) {
        if (!window || window.is_fullscreen() || window.skip_taskbar)
            return;

        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        const currentWs = window.get_workspace();
        if (!currentWs)
            return;

        const currentIndex = currentWs.index();


        const fullscreenWindow = this._getFullscreenWindowOnWorkspace(currentIndex);
        if (fullscreenWindow && fullscreenWindow !== window) {

            const mainWs = this._getMainWorkspace();
            if (mainWs && mainWs.index() !== currentIndex) {
                window.change_workspace(mainWs);

                window._kiwi_originalWorkspaceIndex = 0;
            }
        }
    }








    enable() {
        const wm = this._getWorkspaceManager();


        this._mutterSettings = new Gio.Settings({
            schema_id: 'org.gnome.mutter'
        });
        this._wmPreferences = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.preferences'
        });


        this._windowCreatedId = global.display.connect(
            'window-created',
            this._onWindowCreated.bind(this)
        );


        if (wm) {
            this._workspacesChangedId = wm.connect(
                'notify::n-workspaces',
                this._queueCheckWorkspaces.bind(this)
            );


            this._workspaceSwitchedId = wm.connect(
                'workspace-switched',
                this._onWorkspaceSwitched.bind(this)
            );
        }


        global.get_window_actors().forEach(actor => {
            const window = actor.meta_window;
            if (window) {
                this._connectWindowSignals(window);
            }
        });
    }




    disable() {
        // Disconnect global signals
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        const wm = this._getWorkspaceManager();
        if (wm) {
            if (this._workspacesChangedId) {
                wm.disconnect(this._workspacesChangedId);
                this._workspacesChangedId = null;
            }
            if (this._workspaceSwitchedId) {
                wm.disconnect(this._workspaceSwitchedId);
                this._workspaceSwitchedId = null;
            }
        }


        if (this._checkWorkspacesId !== 0) {
            GLib.Source.remove(this._checkWorkspacesId);
            this._checkWorkspacesId = 0;
        }


        if (this._slowdownResetId !== 0) {
            GLib.Source.remove(this._slowdownResetId);
            this._slowdownResetId = 0;
            St.Settings.get().slow_down_factor = this._originalSlowDownFactor;
        }


        for (const [, sourceId] of this._pendingIsolation) {
            GLib.Source.remove(sourceId);
        }
        this._pendingIsolation.clear();


        for (const [, sourceId] of this._pendingRestore) {
            GLib.Source.remove(sourceId);
        }
        this._pendingRestore.clear();


        for (const [, sourceId] of this._pendingCleanup) {
            GLib.Source.remove(sourceId);
        }
        this._pendingCleanup.clear();


        for (const [, sourceId] of this._pendingWindowCreated) {
            GLib.Source.remove(sourceId);
        }
        this._pendingWindowCreated.clear();


        for (const [, sourceId] of this._pendingWindowUnmanaged) {
            GLib.Source.remove(sourceId);
        }
        this._pendingWindowUnmanaged.clear();


        for (const [window, signals] of this._windowSignals) {
            window.disconnect(signals.fullscreen);
            window.disconnect(signals.unmanaged);

            delete window._kiwi_originalWorkspaceIndex;
            delete window._kiwi_fullscreenWorkspaceIndex;
            delete window._kiwi_isolated;
        }
        this._windowSignals.clear();


        this._fullscreenWorkspaces.clear();


        this._mutterSettings = null;
        this._wmPreferences = null;


        this._isCreatingWorkspace = false;
    }
}

let _instance = null;

export function enable() {
    if (!_instance) {
        _instance = new FullscreenWorkspaceManager();
        _instance.enable();
    }
}

export function disable() {
    if (_instance) {
        _instance.disable();
        _instance = null;
    }
}
