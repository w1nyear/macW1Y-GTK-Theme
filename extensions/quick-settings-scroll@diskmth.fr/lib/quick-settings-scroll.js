// SPDX-FileCopyrightText: 2026 Disk_MTH
// SPDX-License-Identifier: GPL-2.0-or-later











































import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';



const EDGE_MARGIN = 12;

export class QuickSettingsScroll {
    constructor() {
        this._menu = null;
        this._scrollView = null;
        this._stack = null;
        this._themeContext = null;

        this._gridIndex = -1;
        this._boxPointerStyle = null;
    }



    apply() {
        if (this._scrollView)
            return;

        const menu = Main.panel.statusArea.quickSettings?.menu;



        if (!menu?.box || !menu._grid || !menu._overlay || !menu._boxPointer) {
            console.warn('quick-settings-scroll: Quick Settings does not look ' +
                'like the tree this patches; leaving it alone');
            return;
        }

        const { box, _grid: grid, _overlay: overlay } = menu;



        this._menu = menu;
        this._boxPointerStyle = menu._boxPointer.style;
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);



        this._gridIndex = box.get_children().indexOf(grid);

        this._scrollView = new St.ScrollView({
            style_class: 'qs-scroll-view',
            hscrollbar_policy: St.PolicyType.NEVER,









            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });

        box.remove_child(grid);










        this._stack = new St.Viewport({ x_expand: true });
        this._stack.add_child(grid);
        this._scrollView.child = this._stack;
        box.insert_child_at_index(this._scrollView, this._gridIndex);

        this._watchSubmenus(overlay);
        this._followScroll(overlay);



















        menu._boxPointer.connectObject(
            'captured-event', (_a, event) => this._onCapturedEvent(event), this);

        this._themeContext.connectObject(
            'notify::scale-factor', () => this._clamp(), this);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._clamp(), this);
        menu.connectObject('open-state-changed', (_m, isOpen) => {



            if (isOpen)
                this._clamp();
            else
                this._scrollView.vadjustment.value = 0;
        }, this);

        this._clamp();
    }





    _onCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.SCROLL)
            return Clutter.EVENT_PROPAGATE;






        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (let a = target; a && a !== this._scrollView; a = a.get_parent()) {






            if (a instanceof Slider ||
                (a instanceof St.ScrollView &&
                 a.vadjustment.upper > a.vadjustment.page_size))
                return Clutter.EVENT_PROPAGATE;
        }

        return this._onScroll(event);
    }




    _onScroll(event) {
        const adj = this._scrollView.vadjustment;






        if (event.is_pointer_emulated())
            return Clutter.EVENT_STOP;

        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.SMOOTH: {
            const [, dy] = event.get_scroll_delta();
            adj.adjust_for_scroll_event(dy);
            break;
        }
        case Clutter.ScrollDirection.UP:
            adj.adjust_for_scroll_event(-1);
            break;
        case Clutter.ScrollDirection.DOWN:
            adj.adjust_for_scroll_event(1);
            break;
        default:

            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_STOP;
    }





    _watchSubmenus(overlay) {
        for (const actor of overlay)
            this._watchSubmenu(actor);

        overlay.connectObject(
            'child-added', (_o, actor) => this._watchSubmenu(actor),
            'child-removed', (_o, actor) => this._unwatchSubmenu(actor),
            this);
    }










    _watchSubmenu(actor) {
        actor.connectObject(
            'captured-event', (_a, event) => this._onCapturedEvent(event), this);
    }

    _unwatchSubmenu(actor) {
        actor.disconnectObject(this);
    }


















    _followScroll(overlay) {
        this._scrollView.vadjustment.connectObject('notify::value', () => {





            overlay.translation_y = -this._scrollView.vadjustment.value;
            this._syncOverlayClip();
        }, this);




        this._scrollView.connectObject(
            'notify::allocation', () => this._syncOverlayClip(), this);

        this._syncOverlayClip();
    }

    _syncOverlayClip() {
        if (!this._scrollView.has_allocation())
            return;

        const overlay = this._menu._overlay;
        const [viewX, viewY] = this._scrollView.get_transformed_position();
        const [overlayX, overlayY] = overlay.get_transformed_position();
        if (!Number.isFinite(viewX) || !Number.isFinite(overlayX))
            return;

        overlay.set_clip(viewX - overlayX, viewY - overlayY,
            this._scrollView.width, this._scrollView.height);
    }









    _clamp() {
        if (!this._scrollView)
            return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.primaryIndex);



        const scale = this._themeContext.scale_factor || 1;
        const maxHeight = Math.round(workArea.height / scale) - EDGE_MARGIN;






        if (maxHeight <= 0)
            return;

        this._menu._boxPointer.style = `max-height: ${maxHeight}px;`;
    }






    revert() {
        if (!this._scrollView)
            return;

        const menu = this._menu;
        const { box, _grid: grid, _overlay: overlay } = menu;

        menu.disconnectObject(this);
        menu._boxPointer.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._themeContext.disconnectObject(this);

        for (const actor of overlay)
            this._unwatchSubmenu(actor);
        overlay.disconnectObject(this);
        this._scrollView.vadjustment.disconnectObject(this);
        this._scrollView.disconnectObject(this);
        overlay.remove_clip();
        overlay.translation_y = 0;




        this._stack.remove_child(grid);
        box.remove_child(this._scrollView);
        this._scrollView.destroy();

        box.insert_child_at_index(grid, this._gridIndex);
        menu._boxPointer.style = this._boxPointerStyle;

        this._scrollView = null;
        this._stack = null;
        this._themeContext = null;
        this._gridIndex = -1;
        this._boxPointerStyle = null;
        this._menu = null;
    }
}
