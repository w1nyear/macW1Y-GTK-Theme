// SPDX-FileCopyrightText: 2026 Disk_MTH
// SPDX-License-Identifier: GPL-2.0-or-later

// A Quick Settings menu taller than the screen runs off the bottom edge and
// there is no way to reach what is down there. Three things in GNOME Shell
// 49-51 add up to that:
//
//  1. PanelMenu.Button._onOpenStateChanged does set a max-height on
//     `menu.actor` on every open. But QuickSettingsMenu replaces `actor` with
//     a 0x0 St.Widget that exists only to host the submenu overlay, so that
//     ceiling lands on an actor which constrains nothing.
//  2. There is no scroll view at the top level. PopupSubMenu has one, which
//     is why submenus scroll and the menu holding them does not; PopupMenu
//     itself only does `_boxPointer.bin.set_child(this.box)`.
//  3. The submenus are not inside the popup at all. `_overlay` is a sibling
//     of `_boxPointer` under that 0x0 widget, held over the right row by
//     constraints, and nothing clips it. Scroll the grid and an open submenu
//     travels with its toggle straight out of the menu, over the panel and
//     the desktop.
//
// So: a scroll view around the grid, a ceiling in a place that actually bites,
// and the overlay left where it is but clipped and kept in step. No shell
// method is replaced. `addItem`, `insertItemBefore`, `getFirstItem`, `open`
// and `close` go on driving the same `_grid` and `_overlay` objects, so other
// extensions adding toggles see no difference.
//
//   before                             after
//   ------                             -----
//   actor        St.Widget 0x0         actor
//   +- _boxPointer                     +- _boxPointer   <- max-height here
//   |  +- bin                          |  +- bin
//   |     +- box  .quick-settings      |     +- box
//   |        +- _grid                  |        +- scrollView
//   +- _overlay   (submenus)           |           +- viewport
//                                      |              +- _grid
//                                      +- _overlay   (submenus, unmoved)
//
// The overlay does not move, and that is the point: the shell dims the box
// pointer while a submenu is up, so anything inside it recedes and the
// overlay, being outside, keeps its colours. Put the overlay in with the grid
// -- which an earlier version of this did, to make it scroll -- and the dim
// covers the submenu as well, with no way back: the effect is additive through
// an 8-bit texture, so cancelling it clips white text down to grey. The
// overlay stays outside and keeps up by other means; see _followScroll().

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

// Logical pixels left between the popup and the edge of the work area, so a
// menu that had to be clamped does not sit flush against the screen.
const EDGE_MARGIN = 12;

export class QuickSettingsScroll {
    constructor() {
        this._menu = null;
        this._scrollView = null;
        this._stack = null;
        this._themeContext = null;
        // Everything revert() needs to put the shell back exactly as it was.
        this._gridIndex = -1;
        this._boxPointerStyle = null;
    }

    /* ------------------------------- apply ------------------------------ */

    apply() {
        if (this._scrollView)
            return;

        const menu = Main.panel.statusArea.quickSettings?.menu;
        // A shell whose Quick Settings no longer looks like the tree above.
        // Nothing is touched: a half-built patch would be worse than a menu
        // that still cannot scroll.
        if (!menu?.box || !menu._grid || !menu._overlay || !menu._boxPointer) {
            console.warn('quick-settings-scroll: Quick Settings does not look ' +
                'like the tree this patches; leaving it alone');
            return;
        }

        const { box, _grid: grid, _overlay: overlay } = menu;

        // Recorded before anything moves, so revert() has what it needs even
        // if the surgery below gives up half way.
        this._menu = menu;
        this._boxPointerStyle = menu._boxPointer.style;
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        // Positions, not just parents: another extension may already have put
        // a row of its own in `box`, and putting the grid back on the end of
        // it would silently reorder that extension's menu.
        this._gridIndex = box.get_children().indexOf(grid);

        this._scrollView = new St.ScrollView({
            style_class: 'qs-scroll-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            // EXTERNAL rather than NEVER, and it is not a detail: NEVER makes
            // the view's own minimum height that of its child, which is the
            // very thing the max-height below has to be free to override.
            // EXTERNAL reports a minimum of zero and draws no scrollbar,
            // which is exactly the pair we want -- a bar inside a popup this
            // narrow would have to eat into the grid or overlap a toggle.
            // Neither policy stops the wheel: st_scroll_view_scroll_event
            // never reads it. The fade at the top and bottom edges, from
            // stylesheet.css, is what says there is more menu past them.
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });

        box.remove_child(grid);

        // St.Viewport and not a plain St.Widget: a ScrollView only takes a
        // child implementing StScrollable, and Viewport is the one that does
        // it. It scrolls by transform rather than by reallocation, and that is
        // what lets the overlay stay outside and still keep up: its submenus'
        // BindConstraints resolve the toggle's position *in overlay
        // coordinates*, and the toggle is inside the viewport, so the scroll
        // is already in that figure. What the constraints do not do on their
        // own is re-run, a transform repainting without relayout, which is
        // what _followScroll() below asks for.
        this._stack = new St.Viewport({ x_expand: true });
        this._stack.add_child(grid);
        this._scrollView.child = this._stack;
        box.insert_child_at_index(this._scrollView, this._gridIndex);

        this._watchSubmenus(overlay);
        this._followScroll(overlay);

        // What actually turns the wheel, and the reason a scroll view alone
        // is not enough.
        //
        // A wheel over a quick toggle never reaches the view above it. The
        // toggles are St.Buttons, and an St.Button carries a
        // ClutterClickGesture as an actor action; actions run in the capture
        // phase, ahead of every signal, and the event is gone before an
        // ancestor is asked. Measured in a nested shell with the pointer on a
        // toggle: not one actor on the chain from that toggle up to the stage
        // sees the event, in either phase, and the menu does not move. The
        // frame around the grid and the gaps between toggles do scroll, which
        // is what makes the fault look intermittent rather than total.
        //
        // So this listens in the capture phase, on the way down, before any
        // of that can happen, and on the box pointer because it is an
        // ancestor of everything in the popup. What genuinely wants a wheel
        // of its own still gets it: _onCapturedEvent steps back for sliders
        // and for the scroll views inside a submenu's list.
        menu._boxPointer.connectObject(
            'captured-event', (_a, event) => this._onCapturedEvent(event), this);

        this._themeContext.connectObject(
            'notify::scale-factor', () => this._clamp(), this);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._clamp(), this);
        menu.connectObject('open-state-changed', (_m, isOpen) => {
            // Recomputed per open like the shell does with its own ceiling,
            // and wound back on close so the menu never reopens halfway down
            // where it was left.
            if (isOpen)
                this._clamp();
            else
                this._scrollView.vadjustment.value = 0;
        }, this);

        this._clamp();
    }

    /* ------------------------------- wheel ------------------------------ */

    // Everything the popup is handed, on the way down. Only scrolls are of
    // interest, and only those no one under the pointer has a better claim to.
    _onCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.SCROLL)
            return Clutter.EVENT_PROPAGATE;

        // Whatever sits under the pointer keeps its own wheel if turning it
        // there means something: the volume and brightness sliders, and the
        // scroll view a long submenu list carries. Walked from the target
        // upwards and stopped at our own view, so only what is *nearer* the
        // pointer than the menu-wide scroll wins.
        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (let a = target; a && a !== this._scrollView; a = a.get_parent()) {
            // A slider always wants its wheel: turning it there sets a value.
            // A nested scroll view -- a long list inside a submenu -- only
            // wants it while it has somewhere to go. One that has reached its
            // end, or never had a range at all, would otherwise swallow the
            // wheel and leave the menu behind it motionless, which is the
            // same dead feel this extension exists to remove.
            if (a instanceof Slider ||
                (a instanceof St.ScrollView &&
                 a.vadjustment.upper > a.vadjustment.page_size))
                return Clutter.EVENT_PROPAGATE;
        }

        return this._onScroll(event);
    }

    // Deliberately the same arithmetic st_scroll_view_scroll_event does, by
    // calling the same function on the same adjustment, so that the menu
    // moves by the same amount wherever in it the pointer happens to be.
    _onScroll(event) {
        const adj = this._scrollView.vadjustment;

        // One notch of a wheel arrives twice: once as the discrete event and
        // once as the smooth one mutter synthesises beside it. Acting on both
        // scrolls the menu at double speed, so the emulated one is swallowed
        // and not acted on -- which is what st_scroll_view_scroll_event does
        // with it, two lines into the same function.
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
            // Horizontal, or a direction St itself would not act on.
            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_STOP;
    }

    /* ------------------------------ submenus ---------------------------- */

    // Submenu actors come and go as extensions add and remove toggles, so
    // this follows the overlay's children rather than taking one snapshot.
    _watchSubmenus(overlay) {
        for (const actor of overlay)
            this._watchSubmenu(actor);

        overlay.connectObject(
            'child-added', (_o, actor) => this._watchSubmenu(actor),
            'child-removed', (_o, actor) => this._unwatchSubmenu(actor),
            this);
    }

    // The second place a wheel has to be caught, and the one that took longest
    // to find. An open submenu takes the grab, and under a grab mutter starts
    // delivery at the grabbed actor rather than at the top of the tree -- so
    // every listener above this one, the box pointer's included, stops seeing
    // scroll events the moment a submenu is up. Measured: with a submenu open
    // and 250px of range to move, not one listener on the way down fired, and
    // the menu sat still. There is no single ancestor that catches both cases,
    // because which actor is the grab root is exactly what changes; so both
    // roots are listened on.
    _watchSubmenu(actor) {
        actor.connectObject(
            'captured-event', (_a, event) => this._onCapturedEvent(event), this);
    }

    _unwatchSubmenu(actor) {
        actor.disconnectObject(this);
    }

    /* ------------------------------ scroll ------------------------------ */

    // Two things the overlay needs while the grid underneath it moves.
    //
    // It has to keep up. Its submenus are placed by BindConstraints against
    // the toggles, and those answer with positions from the unscrolled grid
    // however far the wheel has been turned -- measured: scroll 150px and the
    // toggle moves from y=387 to y=237 while its submenu stays at 435. So the
    // overlay is translated by the scroll instead. A transform rather than a
    // move, so the constraints go on resolving to the same figures and there
    // is nothing to double-count.
    //
    // And nothing clips it. Inside the popup that never mattered, because the
    // grid reserves exactly the room an open submenu takes. Scrolled, the
    // submenu travels with its toggle and would run past the top or bottom of
    // the popup onto the panel and the desktop, so it is clipped to what the
    // scroll view can actually show.
    _followScroll(overlay) {
        this._scrollView.vadjustment.connectObject('notify::value', () => {
            // A transform, not a move: the submenus keep the positions their
            // constraints gave them against the unscrolled grid -- measured,
            // those do not re-resolve when a viewport scrolls, since scrolling
            // one is itself a transform and never reaches the constraint --
            // and the whole overlay slides by the same amount the grid did.
            overlay.translation_y = -this._scrollView.vadjustment.value;
            this._syncOverlayClip();
        }, this);

        // Clip only, no relayout: the overlay's height feeds the placeholder
        // that sizes the grid, which sizes the view, so asking for a relayout
        // from an allocation handler is a loop waiting to happen.
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

    /* ------------------------------- clamp ------------------------------ */

    // What actually makes the thing scroll: a scroll view scrolls only when
    // something bounds its height, and nothing here does. The ceiling goes on
    // the BoxPointer rather than on the view because BoxPointer's
    // vfunc_get_preferred_height ends in themeNode.adjust_preferred_height,
    // so the figure it reads covers the whole popup, arrow and borders
    // included, and there is no chrome left over to guess at.
    _clamp() {
        if (!this._scrollView)
            return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.primaryIndex);
        // The work area is in physical pixels and a CSS length is a logical
        // one, so the scale factor has to come back out before this is
        // written into a style.
        const scale = this._themeContext.scale_factor || 1;
        const maxHeight = Math.round(workArea.height / scale) - EDGE_MARGIN;

        // A zero-height work area is not hypothetical: the shell hands one
        // out before the first monitor has landed. The ceiling computed from
        // it comes out negative, and a negative max-height collapses the
        // popup to its bare arrow. Leave the last good one standing; the
        // monitors-changed that follows recomputes it.
        if (maxHeight <= 0)
            return;

        this._menu._boxPointer.style = `max-height: ${maxHeight}px;`;
    }

    /* ------------------------------ revert ------------------------------ */

    // The Quick Settings menu outlives the extension: it is the shell's, and
    // it is still there after disable(). So this has to be exact, not merely
    // close, and it runs in reverse order of apply().
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

        // The grid is pulled out before the view goes: destroying a
        // ScrollView takes everything still inside it with it, and of the two
        // actors in there only the stack is ours.
        this._stack.remove_child(grid);
        box.remove_child(this._scrollView);
        this._scrollView.destroy();   // and the now-empty stack with it

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
