
















import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import Mtk from 'gi://Mtk';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Glass from './glass.js';


export const EFFECT_WIDTH = 320;
export const MAX_SCALE = 2.0;



export const MAX_EFFECT_WIDTH = 560;
export const MAX_PERP_OVERFLOW = 3;
const SPRING_OMEGA = 20.0;
const MAX_FRAME_DT = 1 / 30;
const SETTLE_ENVELOPE = 0.002;
const SETTLE_VELOCITY = 0.02;





const CURSOR_TAU = 0.015;

const PIVOTS = {
    [St.Side.BOTTOM]: [0.5, 1],
    [St.Side.TOP]: [0.5, 0],
    [St.Side.LEFT]: [0, 0.5],
    [St.Side.RIGHT]: [1, 0.5],
};

export class DockMagnifier {






    constructor(dash, hoverBox, position, settings) {
        this._dash = dash;
        this._hoverBox = hoverBox;
        this._position = position;
        this._settings = settings;
        this._horizontal = position === St.Side.BOTTOM ||
                           position === St.Side.TOP;
        this._pivot = new Graphene.Point({
            x: PIVOTS[position][0],
            y: PIVOTS[position][1],
        });
        this._paused = false;
        this._suspended = false;

        this._envelope = 0;
        this._velocity = 0;
        this._target = 0;

        this._timeline = null;
        this._signalIds = [];
        this._transformed = new Map();
        this._risen = new Map();
        this._cursor = null;
        this._debugPointer = null;

        this._readSettings();
        this._connectSignals();
        this._unclipContainmentChain();
        this._syncTarget();
        this._dash._background?.show?.();
    }

    destroy() {
        this._stopTimeline();

        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];

        this._clearTransforms();
        this._reclipContainmentChain();

        this._dash = null;
        this._hoverBox = null;
        this._settings = null;
    }

    _readSettings() {
        if (this._settings) {
            this._maxScale = this._settings.get_double('magnify-max-scale');
            this._effectWidth = this._settings.get_int('magnify-effect-width');
            this._rise = this._settings.get_double('magnify-rise');
        } else {
            this._maxScale = MAX_SCALE;
            this._effectWidth = EFFECT_WIDTH;
            this._rise = 0;
        }
    }

    _connectSignals() {
        const connect = (obj, name, cb) => {
            this._signalIds.push([obj, obj.connect(name, cb)]);
        };
        connect(this._hoverBox, 'notify::hover', () => this._syncTarget());


        connect(this._dash, 'items-allocated', () => {
            if (!this._paused && this._envelope > 0)
                this.update();
        });


        connect(this._dash, 'menu-opened', () => this._setPaused(true));
        connect(this._dash, 'menu-closed', () => this._setPaused(false));


        connect(Main.overview, 'item-drag-begin',
            () => this._setSuspended(true));
        connect(Main.overview, 'item-drag-end',
            () => this._setSuspended(false));
        connect(Main.overview, 'item-drag-cancelled',
            () => this._setSuspended(false));
        connect(Main.overview, 'showing', () => {
            this._setSuspended(true);
            this.reset();
        });
        connect(Main.overview, 'hiding', () => {
            this.reset();
        });
        connect(Main.overview, 'hidden', () => {
            this._setSuspended(false);
            this.reset();
            this._syncTarget();
        });
        if (Main.screenshotUI) {
            connect(Main.screenshotUI, 'notify::visible', () => {
                if (Main.screenshotUI.visible) {
                    if (this._target === 0 && this._envelope > 0) {
                        this._envelope = 0;
                        this._velocity = 0;
                        this._stopTimeline();
                        this._clearTransforms();
                    }
                } else {
                    this._notifyDockUpdate();
                }
            });
        }
        if (this._settings) {
            const onSettings = () => {
                this._readSettings();
                if (this._envelope > 0)
                    this.update();
            };
            connect(this._settings, 'changed::magnify-max-scale', () => {
                onSettings();


                this._dash.refreshIconResolution();
            });
            connect(this._settings, 'changed::magnify-effect-width', onSettings);
            connect(this._settings, 'changed::magnify-rise', onSettings);
        }
        if (this._dash?._box) {
            connect(this._dash._box, 'child-added', (_, child) => {
                this._unclipActor(child);
            });
        }
    }

    _unclipActor(actor) {
        if (!actor)
            return;
        try {
            if (actor.clip_to_view !== undefined)
                actor.clip_to_view = false;
        } catch (_) {}
        try {
            actor.clip_to_allocation = false;
        } catch (_) {}
        if (actor.get_children) {
            for (const child of actor.get_children())
                this._unclipActor(child);
        }
    }






    _unclipContainmentChain() {
        this._dash._box.clip_to_view = false;
        this._dash._box.clip_to_allocation = false;
        this._dash._boxContainer.clip_to_view = false;
        this._dash._boxContainer.clip_to_allocation = false;
        this._dash._dashContainer.clip_to_view = false;
        this._dash._dashContainer.clip_to_allocation = false;
        if (this._dash._scrollView)
            this._dash._scrollView.clip_to_allocation = false;
        this._hoverBox.clip_to_view = false;
        this._hoverBox.clip_to_allocation = false;
        this._dash.clip_to_allocation = false;
        this._savedOffscreenRedirect = this._dash.offscreen_redirect;
        this._dash.offscreen_redirect = Clutter.OffscreenRedirect.NONE;

        if (this._dash?._box) {
            for (const child of this._dash._box.get_children())
                this._unclipActor(child);
        }
        if (this._dash?._showAppsIcon)
            this._unclipActor(this._dash._showAppsIcon);
    }

    _reclipContainmentChain() {
        this._dash._box.clip_to_view = true;
        this._dash._boxContainer.clip_to_view = true;
        this._dash._dashContainer.clip_to_view = true;
        this._hoverBox.clip_to_view = true;
        this._dash.offscreen_redirect = this._savedOffscreenRedirect;
    }

    _setPaused(paused) {
        this._paused = paused;
        if (paused)
            this._stopTimeline();
        else
            this._syncTarget();
    }

    reset() {
        this._stopTimeline();
        this._target = 0;
        this._envelope = 0;
        this._velocity = 0;
        this._cursor = null;
        this._cursorMoved = false;
        this._clearTransforms();
    }

    _setSuspended(suspended) {
        this._suspended = suspended;
        if (suspended) {
            this._stopTimeline();
            this._target = 0;
            this._envelope = 0;
            this._velocity = 0;
            this._cursor = null;
            this._clearTransforms();
        } else {
            this._target = 0;
            this._envelope = 0;
            this._velocity = 0;
            this._cursor = null;
            this._clearTransforms();
            this._syncTarget();
        }
    }

    _isPointerOverDock() {
        if (!this._hoverBox || !this._hoverBox.has_allocation())
            return false;
        if (Main.overview.visibleTarget || Main.overview.visible)
            return false;
        try {
            const [x, y] = this._debugPointer ?? global.get_pointer();
            const [boxX, boxY] = this._hoverBox.get_transformed_position();
            const [w, h] = this._hoverBox.get_transformed_size?.() || [this._hoverBox.width, this._hoverBox.height];
            const margin = 12;
            const inBounds = x >= boxX - margin && x <= boxX + w + margin &&
                             y >= boxY - margin && y <= boxY + h + margin;
            if (!inBounds)
                return false;
            return true;
        } catch (_) {
            return false;
        }
    }

    _syncTarget() {
        if (this._paused || this._suspended)
            return;
        const isOver = this._isPointerOverDock();
        this._target = isOver ? 1 : 0;
        if (this._target > 0 || this._envelope > 0)
            this._startTimeline();
    }

    _startTimeline() {
        if (this._timeline)
            return;

        this._cursor = null;
        this._timeline = Clutter.Timeline.new_for_actor(this._dash, 3600 * 1000);
        this._timeline.set_repeat_count(-1);
        this._timeline.connect('new-frame', () => this._onFrame());
        this._timeline.start();
    }

    _stopTimeline() {
        if (!this._timeline)
            return;
        this._timeline.stop();
        this._timeline = null;
    }

    _pointerAxis() {
        const pointer = this._debugPointer ?? global.get_pointer();
        return this._horizontal ? pointer[0] : pointer[1];
    }

    _advanceCursor(dt) {
        const raw = this._pointerAxis();
        if (this._cursor === null) {
            this._cursor = raw;
            this._cursorMoved = true;
        } else {
            const prev = this._cursor;
            this._cursor += (raw - this._cursor) * (1 - Math.exp(-dt / CURSOR_TAU));
            this._cursorMoved = Math.abs(this._cursor - prev) > 0.05 || Math.abs(raw - this._cursor) > 0.1;
        }
    }

    _onFrame() {
        if (!this._dash.get_stage()) {
            this._stopTimeline();
            return;
        }

        const dt = Math.min(this._timeline.get_delta() / 1000, MAX_FRAME_DT);

        this._advanceCursor(dt);

        if (!this._paused && !this._suspended) {
            const isOver = this._isPointerOverDock();
            if (isOver && this._target === 0)
                this._target = 1;
            else if (!isOver && this._target === 1)
                this._target = 0;
        }

        const prevEnvelope = this._envelope;

        const w = SPRING_OMEGA;
        this._velocity += (-2 * w * this._velocity -
                           w * w * (this._envelope - this._target)) * dt;
        this._envelope += this._velocity * dt;
        if (this._envelope < 0)
            this._envelope = 0;


        if (this._target === 1 &&
            Math.abs(this._envelope - 1) < SETTLE_ENVELOPE &&
            Math.abs(this._velocity) < SETTLE_VELOCITY) {
            this._envelope = 1;
            this._velocity = 0;
        }

        if (this._target === 0 &&
            Math.abs(this._envelope) < SETTLE_ENVELOPE &&
            Math.abs(this._velocity) < SETTLE_VELOCITY) {
            this._envelope = 0;
            this._velocity = 0;
            this._stopTimeline();
            this._clearTransforms();
            return;
        }


        const envelopeChanged = Math.abs(this._envelope - prevEnvelope) > 0.0001;
        if (!envelopeChanged && !this._cursorMoved)
            return;

        this.update();
    }






    update() {
        if (!this._dash._box.has_allocation())
            return;



        const cursor = this._cursor ?? this._pointerAxis();

        const elements = this._collectElements();
        if (elements.length === 0)
            return;

        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const effectWidth = this._effectWidth * scaleFactor;
        const eff = this._envelope * (this._maxScale - 1);


        const minP = cursor - effectWidth / 2;
        for (const el of elements) {
            if (el.fixed)
                continue;
            const theta = Math.min(Math.max(
                ((el.center - minP) / effectWidth) * 2 * Math.PI, 0),
            2 * Math.PI);
            el.scale = 1 + eff * ((1 - Math.cos(theta)) / 2);
        }



        const n = elements.length;
        const bounds = new Array(n + 1);
        bounds[0] = elements[0].p1;
        for (let i = 1; i < n; i++)
            bounds[i] = (elements[i - 1].p2 + elements[i].p1) / 2;
        bounds[n] = elements[n - 1].p2;

        const newBounds = new Array(n + 1);
        newBounds[0] = bounds[0];
        for (let i = 0; i < n; i++) {
            newBounds[i + 1] = newBounds[i] +
                (bounds[i + 1] - bounds[i]) * elements[i].scale;
        }





        const baseCenter = (bounds[0] + bounds[n]) / 2;
        const newCenter = (newBounds[0] + newBounds[n]) / 2;
        const shift = baseCenter - newCenter;





        const riseNorm = this._maxScale > 1
            ? this._rise / (this._maxScale - 1) : 0;

        for (let i = 0; i < n; i++) {
            const el = elements[i];
            const newCenter = newBounds[i] +
                (el.center - bounds[i]) * el.scale + shift;
            this._apply(el.actor, el.scale, newCenter - el.center);
            if (riseNorm > 0) {
                this._applyRise(el.container,
                    riseNorm * el.thickness * (el.scale - 1));
            }
            el.container.updateLabelPosition?.();
        }
        if (riseNorm === 0 && this._risen.size > 0)
            this._clearRisen();







        const bgActor = this._dash._background;
        const dashPos = this._dash.get_transformed_position();
        const horizontal = this._horizontal;
        const dashP = horizontal ? dashPos[0] : dashPos[1];
        const bgP1 = dashP + (horizontal ? bgActor.allocation.x1 : bgActor.allocation.y1);
        const bgP2 = dashP + (horizontal ? bgActor.allocation.x2 : bgActor.allocation.y2);
        const basePadL = Math.max(2, bounds[0] - bgP1);
        const basePadR = Math.max(2, bgP2 - bounds[n]);

        const padL = basePadL + Math.max(0, elements[0].scale - 1) * 12;
        const padR = basePadR + Math.max(0, elements[n - 1].scale - 1) * 12;

        this._stretchBackground(bounds[0], bounds[n],
            newBounds[0] + shift, newBounds[n] + shift, padL, padR);
        this._queueStageRedraw();
    }









    _collectElements() {
        const horizontal = this._horizontal;
        const dashPos = this._dash.get_transformed_position();
        const dashP = horizontal ? dashPos[0] : dashPos[1];
        const baseP = child => {
            let p = dashP;
            for (let a = child; a && a !== this._dash; a = a.get_parent())
                p += horizontal ? a.allocation.x1 : a.allocation.y1;
            return p;
        };

        const elements = [];
        const pushItem = child => {
            if (!child.visible || !child.has_allocation())
                return;


            if (child.animatingOut)
                return;



            const target = child.child ?? child;
            const p = baseP(child);
            const size = horizontal
                ? child.allocation.get_width() : child.allocation.get_height();
            elements.push({
                actor: target,
                container: child,
                p1: p,
                p2: p + size,
                center: p + size / 2,


                thickness: horizontal
                    ? child.allocation.get_height()
                    : child.allocation.get_width(),
                scale: 1,


                fixed: !!child.get_style_class_name?.()
                    ?.includes('dash-separator'),
            });
        };

        for (const child of this._dash._box.get_children())
            pushItem(child);




        const showApps = this._dash._showAppsIcon;
        const host = this._dash._boxContainer;
        if (host) {
            for (const sibling of host.get_children()) {
                if (sibling === this._dash._box || sibling === showApps)
                    continue;
                if (!sibling.name?.endsWith('-strip') ||
                    !sibling.visible || !sibling.has_allocation())
                    continue;
                for (const child of sibling.get_children())
                    pushItem(child);
            }
        }
        if (showApps?.get_parent())
            pushItem(showApps);

        elements.sort((a, b) => a.p1 - b.p1);
        return elements;
    }

    _apply(actor, scale, translation) {
        if (!this._transformed.has(actor)) {
            actor.pivot_point = this._pivot;
            const destroyId = actor.connect('destroy',
                () => this._transformed.delete(actor));
            this._transformed.set(actor, destroyId);
        }
        actor.set_scale(scale, scale);
        if (this._horizontal)
            actor.translation_x = translation;
        else
            actor.translation_y = translation;
    }

    _applyRise(container, offset) {
        if (!this._risen.has(container)) {
            const destroyId = container.connect('destroy',
                () => this._risen.delete(container));
            this._risen.set(container, destroyId);
        }

        switch (this._position) {
        case St.Side.BOTTOM:
            container.translation_y = -offset;
            break;
        case St.Side.TOP:
            container.translation_y = offset;
            break;
        case St.Side.LEFT:
            container.translation_x = offset;
            break;
        case St.Side.RIGHT:
            container.translation_x = -offset;
            break;
        }
    }

    _clearRisen() {
        for (const [container, destroyId] of this._risen) {
            container.disconnect(destroyId);
            if (this._horizontal)
                container.translation_y = 0;
            else
                container.translation_x = 0;
        }
        this._risen.clear();
    }







    _stretchBackground(baseL, baseR, newL, newR, padL, padR) {
        const bg = this._dash._background;
        if (!bg)
            return;
        if (!bg.visible)
            bg.show();
        if (!bg.has_allocation())
            return;

        const horizontal = this._horizontal;
        const dashPos = this._dash.get_transformed_position();
        const dashP = horizontal ? dashPos[0] : dashPos[1];
        const bgP1 = dashP +
            (horizontal ? bg.allocation.x1 : bg.allocation.y1);
        const bgP2 = dashP +
            (horizontal ? bg.allocation.x2 : bg.allocation.y2);

        if (padL === undefined)
            padL = Math.max(0, baseL - bgP1);
        if (padR === undefined)
            padR = Math.max(0, bgP2 - baseR);

        const baseSize = bgP2 - bgP1;
        if (baseSize <= 0)
            return;

        const targetL = newL - padL;
        const targetR = newR + padR;
        const scale = (targetR - targetL) / baseSize;
        const translation = targetL - bgP1;




        if (this._lastBgScale !== undefined &&
            Math.abs(this._lastBgScale - scale) < 0.0005 &&
            Math.abs(this._lastBgTrans - translation) < 0.05) {
            return;
        }
        this._lastBgScale = scale;
        this._lastBgTrans = translation;

        if (!this._transformed.has(bg)) {
            bg.pivot_point = new Graphene.Point({x: 0, y: 0});
            const destroyId = bg.connect('destroy',
                () => this._transformed.delete(bg));
            this._transformed.set(bg, destroyId);
        }
        if (horizontal) {
            bg.set_scale(scale, 1);
            bg.translation_x = translation;
        } else {
            bg.set_scale(1, scale);
            bg.translation_y = translation;
        }

        this._stretchBlurGroup(bgP1, scale, translation);
        this._notifyDockUpdate();
    }
















    _stretchBlurGroup(bgP1, scale, delta) {
        const parent = this._dash.get_parent();
        if (!parent)
            return;
        const group = parent.get_children().find(
            c => c.name === Glass.BLUR_GROUP_NAME);
        if (!group?.has_allocation())
            return;

        const horizontal = this._horizontal;
        const dashPos = this._dash.get_transformed_position();




        const groupP = (horizontal ? dashPos[0] : dashPos[1]) -
            (horizontal ? this._dash.allocation.x1 : this._dash.allocation.y1) +
            (horizontal ? group.allocation.x1 : group.allocation.y1);

        if (!this._transformed.has(group)) {
            group.pivot_point = new Graphene.Point({x: 0, y: 0});
            const destroyId = group.connect('destroy',
                () => this._transformed.delete(group));
            this._transformed.set(group, destroyId);
        }
        const translation = delta + (bgP1 - groupP) * (1 - scale);
        if (horizontal) {
            group.set_scale(scale, 1);
            group.translation_x = translation;
        } else {
            group.set_scale(1, scale);
            group.translation_y = translation;
        }
    }

    _clearTransforms() {
        this._lastBgScale = undefined;
        this._lastBgTrans = undefined;
        this._cursor = null;
        this._cursorMoved = false;
        for (const [actor, destroyId] of this._transformed) {
            actor.disconnect(destroyId);
            actor.set_scale(1, 1);

            if (this._horizontal)
                actor.translation_x = 0;
            else
                actor.translation_y = 0;
        }
        this._transformed.clear();
        this._clearRisen();



        const host = this._dash._boxContainer;
        const labelTargets = [...this._dash._box.get_children()];
        if (host) {
            for (const sibling of host.get_children()) {
                if (sibling !== this._dash._box && sibling.name?.endsWith('-strip'))
                    labelTargets.push(...sibling.get_children());
            }
        }
        for (const child of labelTargets)
            child.updateLabelPosition?.();

        this._notifyDockUpdate();
        this._queueStageRedraw();
    }

    _queueStageRedraw() {
        try {
            if (!this._dash?.get_stage?.())
                return;
            const monitor = Main.layoutManager.findMonitorForActor(this._dash) ??
                            Main.layoutManager.primaryMonitor;
            if (!monitor)
                return;

            const container = this._dash.get_parent()?.get_parent()?.get_parent();
            container?.queue_redraw?.();
            this._dash.queue_redraw();

            const PADDING = 360;
            let rect;
            switch (this._position) {
            case St.Side.BOTTOM:
                rect = new Mtk.Rectangle({
                    x: monitor.x,
                    y: Math.max(0, monitor.y + monitor.height - PADDING),
                    width: monitor.width,
                    height: PADDING,
                });
                break;
            case St.Side.TOP:
                rect = new Mtk.Rectangle({
                    x: monitor.x,
                    y: monitor.y,
                    width: monitor.width,
                    height: PADDING,
                });
                break;
            case St.Side.LEFT:
                rect = new Mtk.Rectangle({
                    x: monitor.x,
                    y: monitor.y,
                    width: PADDING,
                    height: monitor.height,
                });
                break;
            case St.Side.RIGHT:
                rect = new Mtk.Rectangle({
                    x: Math.max(0, monitor.x + monitor.width - PADDING),
                    y: monitor.y,
                    width: PADDING,
                    height: monitor.height,
                });
                break;
            default:
                rect = new Mtk.Rectangle({
                    x: monitor.x,
                    y: Math.max(0, monitor.y + monitor.height - PADDING),
                    width: monitor.width,
                    height: PADDING,
                });
                break;
            }
            global.stage.queue_redraw_with_clip(rect);
        } catch (_) {}
    }

    _notifyDockUpdate() {
        if (typeof global._liquidGlassDockSync === 'function') {
            try {
                global._liquidGlassDockSync();
            } catch (_) {}
        }
    }



    setDebugState(stageX, stageY, envelope) {
        this._debugPointer = [stageX, stageY];
        this._cursor = this._horizontal ? stageX : stageY;
        if (envelope !== undefined)
            this._envelope = envelope;
        this.update();
    }

    clearDebugState() {
        this._debugPointer = null;
        this._cursor = null;
    }
}
