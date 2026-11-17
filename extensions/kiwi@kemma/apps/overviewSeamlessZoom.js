// SPDX-License-Identifier: GPL-3.0-or-later






import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ControlsState } from 'resource:///org/gnome/shell/ui/overviewControls.js';
import { Workspace, WorkspaceBackground } from 'resource:///org/gnome/shell/ui/workspace.js';


const BACKGROUND_MARGIN = 12;

let _overviewHiddenId = 0;
let _controlsLayout = null;
let _origComputeBox = null;
let _origInit = null;
let _initPatch = null;



const SeamlessWorkspaceBackground = GObject.registerClass(
class SeamlessWorkspaceBackground extends WorkspaceBackground {
    vfunc_allocate(box) {
        const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        const [width, height] = box.get_size();

        const scaledHeight = Math.max(height - BACKGROUND_MARGIN * 2 * scaleFactor, 0);
        const scaledWidth = height > 0 ? (scaledHeight / height) * width : 0;

        const scaledBox = new Clutter.ActorBox();
        scaledBox.set_origin(
            box.x1 + (width - scaledWidth) / 2,
            box.y1 + (height - scaledHeight) / 2);
        scaledBox.set_size(scaledWidth, scaledHeight);

        const myBox = box.interpolate(scaledBox, this._stateAdjustment.value);
        this.set_allocation(myBox);
        this._bin.allocate(this.get_theme_node().get_content_box(myBox));
    }


    _updateRoundedClipBounds() {}
});

function patchWorkspace(workspace) {
    const layout = workspace._container.layout_manager;



    Object.defineProperty(layout, '_workarea', {
        configurable: true,
        get() {
            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            if (!monitor)
                return Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
            if (this._kiwiMonitor !== monitor) {
                this._kiwiMonitor = monitor;
                this._kiwiRect = new Mtk.Rectangle({
                    x: monitor.x,
                    y: monitor.y,
                    width: monitor.width,
                    height: monitor.height,
                });
            }
            return this._kiwiRect;
        },
        set() {},
    });

    const stock = workspace._background;
    workspace._background = new SeamlessWorkspaceBackground(
        workspace.monitorIndex, layout.stateAdjustment);
    workspace.replace_child(stock, workspace._background);
    stock.destroy();
}

function restoreWorkspace(workspace) {
    const layout = workspace._container.layout_manager;

    if (Object.getOwnPropertyDescriptor(layout, '_workarea')?.get) {
        delete layout._workarea;
        layout._workarea = Main.layoutManager.getWorkAreaForMonitor(layout._monitorIndex);
        layout._needsLayout = true;
        layout.layout_changed();
    }

    if (workspace._background instanceof SeamlessWorkspaceBackground) {
        const seamless = workspace._background;
        workspace._background = new WorkspaceBackground(
            workspace.monitorIndex, layout.stateAdjustment);
        workspace.replace_child(seamless, workspace._background);
        seamless.destroy();
    }
}


function restoreLiveWorkspaces() {
    const display = Main.overview._overview.controls._workspacesDisplay;
    for (const view of display._workspacesViews ?? []) {
        const inner = view._workspacesView ?? view;
        const workspaces = inner._workspaces ?? (inner._workspace ? [inner._workspace] : []);
        workspaces.forEach(restoreWorkspace);
    }
}

function applyPatches() {

    _controlsLayout = Main.overview._overview.controls.layout_manager;
    const origComputeBox = _controlsLayout._computeWorkspacesBoxForState;
    _origComputeBox = origComputeBox;
    _controlsLayout._computeWorkspacesBoxForState = function (state, ...args) {
        const box = origComputeBox.call(this, state, ...args);
        const monitor = Main.layoutManager.primaryMonitor;
        if (state === ControlsState.HIDDEN && monitor) {
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            box.set_origin(box.x1 - (workArea.x - monitor.x), box.y1 - (workArea.y - monitor.y));
            box.set_size(monitor.width, monitor.height);
        }
        return box;
    };

    _origInit = Workspace.prototype._init;
    _initPatch = function (metaWorkspace, monitorIndex, overviewAdjustment) {
        _origInit.call(this, metaWorkspace, monitorIndex, overviewAdjustment);
        if (monitorIndex === Main.layoutManager.primaryIndex)
            patchWorkspace(this);
    };
    Workspace.prototype._init = _initPatch;
}

export function enable() {
    if (_origInit || _overviewHiddenId)
        return;



    if (Main.overview.visible) {
        _overviewHiddenId = Main.overview.connect('hidden', () => {
            if (Main.overview._shown)
                return;
            Main.overview.disconnect(_overviewHiddenId);
            _overviewHiddenId = 0;
            applyPatches();
        });
    } else {
        applyPatches();
    }
}

export function disable() {
    if (_overviewHiddenId) {
        Main.overview.disconnect(_overviewHiddenId);
        _overviewHiddenId = 0;
    }
    if (!_origInit)
        return;

    _controlsLayout._computeWorkspacesBoxForState = _origComputeBox;
    if (Workspace.prototype._init === _initPatch)
        Workspace.prototype._init = _origInit;
    restoreLiveWorkspaces();

    _controlsLayout = null;
    _origComputeBox = null;
    _origInit = null;
    _initPatch = null;
}
