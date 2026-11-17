// SPDX-License-Identifier: GPL-3.0-or-later




import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { connectPaintSignal } from './blurPaintSignal.js';
import { dashOf, dockContainers } from './dockUtils.js';

let enabled = false;
let dockSearchId = null;
let dashes = [];
let blurRepaintSignals = []; // global event signal connections for blur repaints
let blurRepaintIdleId = 0;

function _scheduleBlurRepaint() {
    if (blurRepaintIdleId || dashes.length === 0) return;
    blurRepaintIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        blurRepaintIdleId = 0;
        for (const info of dashes) {
            if (info.blurEffect && info.blurWidget?.visible) {
                try { info.blurEffect.queue_repaint(); } catch (_) {}
            }
        }
        return GLib.SOURCE_REMOVE;
    });
}

function _connectRepaintSignals() {
    _disconnectRepaintSignals();


    const restackedId = global.display.connect('restacked', _scheduleBlurRepaint);
    blurRepaintSignals.push({ obj: global.display, id: restackedId });


    const wmSignals = ['map', 'destroy', 'minimize', 'unminimize', 'switch-workspace'];
    for (const sigName of wmSignals) {
        try {
            const id = global.window_manager.connect(sigName, _scheduleBlurRepaint);
            blurRepaintSignals.push({ obj: global.window_manager, id });
        } catch (_) {}
    }


    const backgroundGroup = Main.layoutManager?._backgroundGroup;
    if (backgroundGroup) {
        for (const bg of backgroundGroup) {
            const id = bg.connect('notify::content', _scheduleBlurRepaint);
            blurRepaintSignals.push({ obj: bg, id });
        }
        const addId = backgroundGroup.connect('child-added', (_group, child) => {
            const id = child.connect('notify::content', _scheduleBlurRepaint);
            blurRepaintSignals.push({ obj: child, id });
        });
        const removeId = backgroundGroup.connect('child-removed', (_group, child) => {
            blurRepaintSignals = blurRepaintSignals.filter(s => s.obj !== child);
        });
        blurRepaintSignals.push({ obj: backgroundGroup, id: addId });
        blurRepaintSignals.push({ obj: backgroundGroup, id: removeId });
    }


    const showId = Main.overview.connect('showing', _scheduleBlurRepaint);
    const hideId = Main.overview.connect('hidden', _scheduleBlurRepaint);
    blurRepaintSignals.push({ obj: Main.overview, id: showId });
    blurRepaintSignals.push({ obj: Main.overview, id: hideId });
}

function _disconnectRepaintSignals() {
    for (const { obj, id } of blurRepaintSignals) {
        try { obj.disconnect(id); } catch (_) {}
    }
    blurRepaintSignals = [];
    if (blurRepaintIdleId) {
        GLib.Source.remove(blurRepaintIdleId);
        blurRepaintIdleId = 0;
    }
}

function _hasValidAllocation(actor) {
    return actor && actor.has_allocation() && actor.width > 0 && actor.height > 0;
}

function _tryBlurDock(dockContainer) {
    const dash = dashOf(dockContainer);
    if (!dash) return;
    const dashBox = dash.get_parent();


    if (dashBox.get_children().some(c => c.name === 'kiwi-dock-blur-group'))
        return;


    const dashBackground = dash.get_children().find(c =>
        c.get_style_class_name?.()?.includes('dash-background')
    );
    if (!dashBackground) return;


    const backgroundGroup = new Meta.BackgroundGroup({
        name: 'kiwi-dock-blur-group',
        width: 0,
        height: 0,
    });

    const blurWidget = new St.Widget({ name: 'kiwi-dock-blur' });

    const blurEffect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        radius: 30,
        brightness: 1.0,
    });
    blurWidget.add_effect(blurEffect);
    backgroundGroup.insert_child_at_index(blurWidget, 0);



    connectPaintSignal(blurWidget, _scheduleBlurRepaint);


    dashBox.insert_child_at_index(backgroundGroup, 0);


    let lastRect = null;
    const updateSize = () => {
        if (!blurWidget || !dashBackground) return;




        if (!_hasValidAllocation(dash) || !_hasValidAllocation(dashBackground)) {
            retryUpdateSize();
            return;
        }
        const w = dashBackground.width;
        const h = dashBackground.height;
        const x = dashBackground.x;
        const y = dashBackground.y + dash.y;
        retryAttempts = 0;




        if (lastRect && lastRect.x === x && lastRect.y === y &&
            lastRect.w === w && lastRect.h === h)
            return;
        lastRect = { x, y, w, h };

        blurWidget.set_size(w, h);
        blurWidget.set_position(x, y);
        _scheduleBlurRepaint();
    };






    let updateLaterId = 0;
    const queueUpdateSize = () => {
        if (updateLaterId) return;
        updateLaterId = global.compositor.get_laters().add(Meta.LaterType.IDLE, () => {
            updateLaterId = 0;
            updateSize();
            return GLib.SOURCE_REMOVE;
        });
    };



    let retryId = 0;
    let retryAttempts = 0;
    const retryUpdateSize = () => {
        if (retryId || retryAttempts >= 25) return;
        retryAttempts++;
        retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            retryId = 0;
            queueUpdateSize();
            return GLib.SOURCE_REMOVE;
        });
    };
    queueUpdateSize();



    const watched = [
        [dash, ['allocation', 'width', 'height', 'x', 'y']],
        [dashBackground, ['allocation', 'width', 'height', 'x', 'y']],
        [dockContainer, ['width', 'height']],
    ];
    const signals = [];
    for (const [actor, properties] of watched) {
        for (const property of properties)
            signals.push({ actor, id: actor.connect(`notify::${property}`, queueUpdateSize) });
    }

    const info = {
        dockContainer,
        dashBox,
        dash,
        dashBackground,
        backgroundGroup,
        blurWidget,
        blurEffect,
        signals,
        destroyId: null,
        cancelUpdate: () => {
            if (updateLaterId) {
                global.compositor.get_laters().remove(updateLaterId);
                updateLaterId = 0;
            }
            if (retryId) {
                GLib.Source.remove(retryId);
                retryId = 0;
            }
        },
    };


    info.destroyId = dash.connect('destroy', () => _removeDashBlur(info, false));

    dashes.push(info);

    // Connect global repaint signals when first dash is blurred
    if (dashes.length === 1)
        _connectRepaintSignals();
}

function _removeDashBlur(info, disconnectDestroy = true) {
    info.cancelUpdate();


    for (const { actor, id } of info.signals) {
        try { actor.disconnect(id); } catch (_) {}
    }
    info.signals = [];

    if (disconnectDestroy && info.destroyId && info.dash) {
        try { info.dash.disconnect(info.destroyId); } catch (_) {}
    }
    info.destroyId = null;


    if (info.backgroundGroup && info.dashBox) {
        try { info.dashBox.remove_child(info.backgroundGroup); } catch (_) {}
    }
    if (info.backgroundGroup) {
        info.backgroundGroup.destroy_all_children();
        info.backgroundGroup.destroy();
    }
    info.backgroundGroup = null;
    info.blurWidget = null;
    info.blurEffect = null;


    const idx = dashes.indexOf(info);
    if (idx >= 0) dashes.splice(idx, 1);

    // Disconnect global signals when no more blurred dashes
    if (dashes.length === 0)
        _disconnectRepaintSignals();
}

function _blurExistingDocks() {
    dockContainers().forEach(container => _tryBlurDock(container));
}

function _removeAllBlurs() {

    [...dashes].forEach(info => _removeDashBlur(info));
}

let childAddedId = null;
let startupCompleteId = null;

export function enable() {


    if (enabled)
        return;
    enabled = true;




    if (Main.layoutManager._startingUp) {
        startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
            Main.layoutManager.disconnect(startupCompleteId);
            startupCompleteId = null;
            _enable();
        });
        return;
    }
    _enable();
}

function _enable() {

    childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (actor.name === 'dashtodockContainer')
            _tryBlurDock(actor);
    });


    _blurExistingDocks();


    if (dashes.length === 0) {
        let attempts = 0;
        dockSearchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            attempts++;
            _blurExistingDocks();
            if (dashes.length > 0 || attempts >= 10) {
                dockSearchId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}

export function disable() {
    enabled = false;

    if (startupCompleteId) {
        Main.layoutManager.disconnect(startupCompleteId);
        startupCompleteId = null;
    }

    if (dockSearchId) {
        GLib.Source.remove(dockSearchId);
        dockSearchId = null;
    }

    if (childAddedId) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = null;
    }

    _removeAllBlurs();
    _disconnectRepaintSignals();
}
