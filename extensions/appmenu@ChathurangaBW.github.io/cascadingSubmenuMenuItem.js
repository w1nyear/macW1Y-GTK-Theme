




import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 220;
const POINTER_TOLERANCE_PX = 8;

const PointerState = {
    INSIDE_POPUP: 0,
    INSIDE_SUBMENU: 1,
    BRIDGE: 2,
    OUTSIDE: 3,
};

export const CascadingSubmenuMenuItem = GObject.registerClass(
    { GTypeName: 'AppMenuCascadingSubmenuMenuItem' },
    class CascadingSubmenuMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(title, parentMenu, menuManager) {
            super._init({
                reactive: true,
                can_focus: true,
                hover: true,
            });

            this._parentMenu = parentMenu;
            this._menuManager = menuManager ?? null;
            this._managerRegistered = false;


            this.menu = null;
            this._menuHoverActor = null;
            this._hoverCloseTimeoutId = 0;
            this._openDelayTimeoutId = 0;
            this._chromeAdded = false;
            this._menuClosing = false;
            this._parentMenuItemSignalIds = [];
            this._globalHoverMonitorId = 0;
            this._isDestroyed = false;
            this._onOpenCallback = null;
            this._pointerEntered = false;
            this._outsideTicks = 0;


            this._label = new St.Label({
                text: title || '',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);

            this._arrowIcon = new St.Icon({
                icon_name: 'go-next-symbolic',
                style_class: 'popup-menu-arrow',
                icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._arrowIcon);


            this._setupSubmenu();
            this._connectEvents();
        }

        get label() {
            return this._label;
        }

        setOnOpen(callback) {
            this._onOpenCallback = callback;
        }

        _setupSubmenu() {
            this.menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.RIGHT);
            this.menu.actor.add_style_class_name('appmenu-popup-menu');
            this.menu.actor.add_style_class_name('appmenu-cascading-menu');
            this.menu.box.add_style_class_name('appmenu-popup-menu-content');
            this.menu.actor.track_hover = true;
            this.menu.actor.reactive = true;

            this._menuHoverActor = this.menu.box ?? this.menu.actor;
            if (this._menuHoverActor) {
                this._menuHoverActor.track_hover = true;
                this._menuHoverActor.reactive = true;
            }

            Main.layoutManager.addTopChrome(this.menu.actor);
            this._chromeAdded = true;


            if (!this._managerRegistered && this._menuManager && !this._parentMenu?._parentMenu) {
                this._menuManager.addMenu(this.menu);
                this._managerRegistered = true;
            }

            this.menu.connectObject('open-state-changed', (_m, open) => {
                if (open) {
                    this._cancelClose();
                    this._startGlobalHoverMonitor();
                    if (typeof this._onOpenCallback === 'function') {
                        try { this._onOpenCallback(); } catch (_) {}
                    }
                } else {
                    this._stopGlobalHoverMonitor();
                    this._setSubmenuHover(false);
                }
            }, 'activate', () => {
                this._closeEntireHierarchy();
            }, this);

            if (this._menuHoverActor) {
                this._menuHoverActor.connectObject('enter-event', () => {
                    this._pointerEntered = true;
                    this._outsideTicks = 0;
                    this._cancelClose();
                    this._cancelOpenDelay();
                    this._setSubmenuHover(true);
                    return Clutter.EVENT_PROPAGATE;
                }, 'leave-event', () => {
                    this._scheduleClose();
                    return Clutter.EVENT_PROPAGATE;
                }, this);
            }

            if (this.menu.actor) {
                this.menu.actor.connectObject('key-press-event', (_actor, event) => {
                    const symbol = event.get_key_symbol();
                    if (symbol === Clutter.KEY_Left) {
                        this._closeSubmenu();
                        this.actor.grab_key_focus();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, this);
            }

            if (this._parentMenu) {
                this._parentMenu.connectObject('open-state-changed', (_m, open) => {
                    if (!open) {
                        this._closeSubmenu();
                    }
                }, this);
            }

            this.connectObject('destroy', () => {
                this._cleanup();
            }, this);
        }

        _connectEvents() {
            this.actor.connectObject('enter-event', () => {
                this._pointerEntered = true;
                this._outsideTicks = 0;
                this._cancelClose();
                this._setSubmenuHover(true);
                this._scheduleOpen();
                return Clutter.EVENT_PROPAGATE;
            }, 'leave-event', () => {
                this._cancelOpenDelay();
                if (this.menu && this.menu.isOpen) {
                    this._setSubmenuHover(true);
                }
                this._scheduleClose();
                return Clutter.EVENT_PROPAGATE;
            }, 'button-press-event', () => {
                this._cancelClose();
                this._cancelOpenDelay();
                this.openSubmenu();
                return Clutter.EVENT_STOP;
            }, 'key-press-event', (_actor, event) => {
                const symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Right) {
                    this.openSubmenu();
                    if (this.menu && typeof this.menu._getMenuItems === 'function') {
                        const first = this.menu._getMenuItems().find(it => it.sensitive !== false && it.can_focus);
                        if (first) first.actor.grab_key_focus();
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connectObject('activate', () => {
                this._cancelClose();
                this._cancelOpenDelay();
                this.openSubmenu();
            }, this);
        }

        openSubmenu() {
            if (this._isDestroyed || !this.menu || !this._parentMenu?.isOpen)
                return;
            if (!this.menu.isOpen) {
                this._connectParentMenuItemSignals();
                this.menu.open(true);
                this._setSubmenuHover(true);
            }
        }

        _closeSubmenu() {
            if (!this.menu || this._menuClosing) return;
            this._menuClosing = true;
            try {
                this._cancelClose();
                this._stopGlobalHoverMonitor();
                this._disconnectParentMenuItemSignals();
                this._pointerEntered = false;
                this._outsideTicks = 0;
                if (this.menu.isOpen) {
                    this.menu.close(true);
                }
                this._setSubmenuHover(false);
            } finally {
                this._menuClosing = false;
            }
        }

        _closeEntireHierarchy() {
            this._closeSubmenu();
            let top = this._parentMenu;
            while (top) {
                if (typeof top.close === 'function') {
                    try { top.close(BoxPointer.PopupAnimation.FULL); } catch (_) {}
                }
                top = top._parentMenu || top._parent;
            }
        }

        _cancelClose() {
            if (this._hoverCloseTimeoutId) {
                GLib.source_remove(this._hoverCloseTimeoutId);
                this._hoverCloseTimeoutId = 0;
            }
        }

        _cancelOpenDelay() {
            if (this._openDelayTimeoutId) {
                GLib.source_remove(this._openDelayTimeoutId);
                this._openDelayTimeoutId = 0;
            }
        }

        _scheduleOpen() {
            this._cancelOpenDelay();
            if (this.menu && this.menu.isOpen) return;

            this._openDelayTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                OPEN_DELAY_MS,
                () => {
                    this._openDelayTimeoutId = 0;
                    this.openSubmenu();
                    return GLib.SOURCE_REMOVE;
                }
            );
            GLib.Source.set_name_by_id(this._openDelayTimeoutId, 'AppMenuCascadingOpenDelay');
        }

        _scheduleClose() {
            this._cancelClose();
            this._hoverCloseTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                CLOSE_DELAY_MS,
                () => {
                    const pointerState = this._getPointerState();
                    if (pointerState === PointerState.INSIDE_POPUP) {
                        this._hoverCloseTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    if (pointerState === PointerState.INSIDE_SUBMENU) {
                        this._setSubmenuHover(true);
                        this._hoverCloseTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    if (pointerState === PointerState.BRIDGE) {
                        this._setSubmenuHover(true);
                        return GLib.SOURCE_CONTINUE;
                    }

                    this._hoverCloseTimeoutId = 0;
                    this._closeSubmenu();
                    return GLib.SOURCE_REMOVE;
                }
            );
            GLib.Source.set_name_by_id(this._hoverCloseTimeoutId, 'AppMenuCascadingCloseDelay');
        }

        _startGlobalHoverMonitor() {
            if (this._globalHoverMonitorId !== 0) return;
            this._outsideTicks = 0;
            this._globalHoverMonitorId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                100,
                () => {
                    if (!this.menu || !this.menu.isOpen) {
                        this._globalHoverMonitorId = 0;
                        this._outsideTicks = 0;
                        return GLib.SOURCE_REMOVE;
                    }

                    const pointerState = this._getPointerState();
                    if (
                        pointerState === PointerState.INSIDE_POPUP ||
                        pointerState === PointerState.INSIDE_SUBMENU ||
                        pointerState === PointerState.BRIDGE
                    ) {
                        this._pointerEntered = true;
                        this._outsideTicks = 0;
                        this._setSubmenuHover(true);
                    } else if (this._pointerEntered && pointerState === PointerState.OUTSIDE) {
                        this._outsideTicks = (this._outsideTicks || 0) + 1;
                        if (this._outsideTicks >= 4) {
                            this._closeSubmenu();
                            this._globalHoverMonitorId = 0;
                            this._outsideTicks = 0;
                            return GLib.SOURCE_REMOVE;
                        }
                    }
                    return GLib.SOURCE_CONTINUE;
                }
            );
            GLib.Source.set_name_by_id(this._globalHoverMonitorId, 'AppMenuCascadingHoverMonitor');
        }

        _stopGlobalHoverMonitor() {
            if (this._globalHoverMonitorId !== 0) {
                GLib.source_remove(this._globalHoverMonitorId);
                this._globalHoverMonitorId = 0;
            }
            this._outsideTicks = 0;
        }

        _setSubmenuHover(shouldHover) {
            if (typeof this.setActive === 'function') {
                this.setActive(shouldHover);
            }
            if (typeof this.remove_style_pseudo_class === 'function') {
                if (shouldHover) {
                    this.add_style_pseudo_class('hover');
                } else {
                    this.remove_style_pseudo_class('hover');
                    this.remove_style_pseudo_class('active');
                    this.remove_style_pseudo_class('checked');
                }
            }
            if (this.actor) {
                if (typeof this.actor.set_hover === 'function') {
                    this.actor.set_hover(shouldHover);
                }
                if (typeof this.actor.remove_style_pseudo_class === 'function') {
                    if (shouldHover) {
                        this.actor.add_style_pseudo_class('hover');
                    } else {
                        this.actor.remove_style_pseudo_class('hover');
                        this.actor.remove_style_pseudo_class('active');
                        this.actor.remove_style_pseudo_class('checked');
                    }
                }
            }
        }

        _connectParentMenuItemSignals() {
            this._disconnectParentMenuItemSignals();
            if (!this._parentMenu || typeof this._parentMenu._getMenuItems !== 'function')
                return;

            const menuItems = this._parentMenu._getMenuItems();
            menuItems.forEach((item) => {
                if (!item || item === this) return;
                const actor = item.actor;
                if (!actor || actor === this.actor || !actor.reactive) return;

                actor.track_hover = true;
                const sigId = actor.connect('enter-event', () => {
                    if (!this.menu || !this.menu.isOpen)
                        return Clutter.EVENT_PROPAGATE;

                    this._cancelClose();
                    this._cancelOpenDelay();
                    this._closeSubmenu();
                    this._setSubmenuHover(false);
                    return Clutter.EVENT_PROPAGATE;
                });
                this._parentMenuItemSignalIds.push({ actor, signalId: sigId });
            });
        }

        _disconnectParentMenuItemSignals() {
            this._parentMenuItemSignalIds.forEach(({ actor, signalId }) => {
                try { actor.disconnect(signalId); } catch (_) {}
            });
            this._parentMenuItemSignalIds = [];
        }

        _getPointerPosition() {
            try {
                const seat = (typeof Clutter.get_default_backend === 'function' ? Clutter.get_default_backend() : (global.stage?.get_context?.() || global.stage?.context)?.get_backend?.() || global.backend)?.get_default_seat?.();
                const device = seat.get_pointer();
                const [, x, y] = device.get_coords();
                return [x, y];
            } catch (_) {
                return global.get_pointer();
            }
        }

        _getActorBounds(actor) {
            if (!actor) return null;
            try {
                if (!actor.is_mapped()) return null;
                const [stageX, stageY] = actor.get_transformed_position();
                const [width, height] = actor.get_transformed_size();
                if (width === 0 || height === 0) return null;
                return {
                    x1: stageX,
                    y1: stageY,
                    x2: stageX + width,
                    y2: stageY + height,
                };
            } catch (_) {
                return null;
            }
        }

        _getPointerState() {
            if (!this.menu) return PointerState.OUTSIDE;
            const [pointerX, pointerY] = this._getPointerPosition();
            const itemBounds = this._getActorBounds(this.actor);
            const popupBounds = this._getActorBounds(this._menuHoverActor ?? this.menu.actor);

            const pointWithin = (bounds, tolerance = 0) =>
                bounds &&
                pointerX >= bounds.x1 - tolerance &&
                pointerX <= bounds.x2 + tolerance &&
                pointerY >= bounds.y1 - tolerance &&
                pointerY <= bounds.y2 + tolerance;

            if (pointWithin(popupBounds, POINTER_TOLERANCE_PX))
                return PointerState.INSIDE_POPUP;

            if (pointWithin(itemBounds, POINTER_TOLERANCE_PX))
                return PointerState.INSIDE_SUBMENU;

            if (!itemBounds || !popupBounds)
                return PointerState.OUTSIDE;

            const overlapTop = Math.max(itemBounds.y1, popupBounds.y1);
            const overlapBottom = Math.min(itemBounds.y2, popupBounds.y2);

            if (overlapBottom >= overlapTop) {
                const itemRight = itemBounds.x2;
                const popupLeft = popupBounds.x1;
                const gapWidth = Math.max(0, popupLeft - itemRight);
                const bridgeTolerance = Math.min(POINTER_TOLERANCE_PX, gapWidth + 4);

                if (
                    pointerX >= itemRight - 2 &&
                    pointerX <= popupLeft + bridgeTolerance &&
                    pointerY >= overlapTop - POINTER_TOLERANCE_PX &&
                    pointerY <= overlapBottom + POINTER_TOLERANCE_PX
                ) {
                    return PointerState.BRIDGE;
                }
            }

            return PointerState.OUTSIDE;
        }

        _cleanup() {
            this._isDestroyed = true;
            this._cancelClose();
            this._cancelOpenDelay();
            this._stopGlobalHoverMonitor();
            this._disconnectParentMenuItemSignals();

            if (this.menu) {
                if (this._managerRegistered && this._menuManager) {
                    try { this._menuManager.removeMenu(this.menu); } catch (_) {}
                    this._managerRegistered = false;
                }
                if (this._chromeAdded) {
                    try { Main.layoutManager.removeChrome(this.menu.actor); } catch (_) {}
                    this._chromeAdded = false;
                }
                try { this.menu.destroy(); } catch (_) {}
                this.menu = null;
                this._menuHoverActor = null;
            }
        }

        destroy() {
            this._cleanup();
            super.destroy();
        }
    }
);
