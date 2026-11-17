











import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import {LiquidGlass} from './glass_v4.js?v=fix5';
import {macColors} from './colors.js';
import {parseCssColor} from '../utils/ported.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const HOVER_FADE_MS = 180;

export class WidgetGlass {




    constructor({settings, isDark = null}) {
        this._settings = settings;
        this._isDark = isDark;
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});


        this._records = new Map();
    }

    sync(views) {
        const s = this._settings();
        const isGlass = s.get_int('style-mode') === 0;

        if (!isGlass) {
            this.destroy();
            return;
        }

        const viewsArray = Array.from(views);
        const live = new Set();

        for (const view of viewsArray) {
            if (!view?.actor || !view?.widget) {
                continue;
            }

            live.add(view.id);
            this._syncView(view);
        }

        for (const id of [...this._records.keys()]) {
            if (!live.has(id)) {
                this._detach(id);
            }
        }
    }

    destroy() {
        for (const id of [...this._records.keys()]) {
            this._detach(id);
        }
    }

    _syncView(view) {
        let record = this._records.get(view.id);


        if (record && record.actor !== view.actor) {
            this._detach(view.id);
            record = null;
        }

        if (!record) {
            record = this._attach(view);
            if (!record) {
                return;
            }
            this._records.set(view.id, record);
        }

        this._updateGlassParams(record);
        this._updateGeometry(record);
    }

    _attach(view) {
        const {actor, widget} = view;
        const container = actor.get_parent();

        if (!container) {
            console.warn(`[desktop-widgets glass] Widget ${widget.type} has no parent container`);
            return null;
        }

        const glass = new LiquidGlass();



        container.insert_child_at_index(glass, 0);
        if (container.set_child_below_sibling)
            container.set_child_below_sibling(glass, actor);


        container.queue_relayout();

        const record = {
            actor,
            widget,
            glass,
            container,
            signalIds: [],
            pointer: [-1, -1],
            hoverFade: 0,
            fadeFrom: 0,
            fadeTo: 0,
            timeline: null,
        };

        const updateGeometry = () => this._updateGeometry(record);
        const updateParams = () => this._updateGlassParams(record);

        record.signalIds.push(actor.connect('notify::x', updateGeometry));
        record.signalIds.push(actor.connect('notify::y', updateGeometry));
        record.signalIds.push(actor.connect('notify::width', updateGeometry));
        record.signalIds.push(actor.connect('notify::height', updateGeometry));
        record.signalIds.push(actor.connect('notify::opacity', updateParams));

        record.signalIds.push(actor.connect('notify::allocation', updateGeometry));


        record.signalIds.push(actor.connect('motion-event', (_actor, event) => {
            const [sx, sy] = event.get_coords();
            const [ok, lx, ly] = actor.transform_stage_point(sx, sy);
            const [width, height] = actor.get_size();
            record.pointer = ok && width > 0 && height > 0
                ? [lx / width, ly / height]
                : [-1, -1];
            this._syncPointer(record);
            return Clutter.EVENT_PROPAGATE;
        }));
        record.signalIds.push(actor.connect('notify::hover', () => {
            this._animateHover(record, actor.hover ? 1 : 0);
        }));

        record.signalIds.push(actor.connect('destroy', () => {
            this._detach(view.id);
        }));


        this._updateGeometry(record);
        this._updateGlassParams(record);


        const [x, y] = actor.get_transformed_position();
        if (!Number.isFinite(x) || !Number.isFinite(y)) {

            const stage = actor.get_stage();
            if (stage) {
                const paintId = stage.connect('after-paint', () => {
                    this._updateGeometry(record);
                    this._updateGlassParams(record);
                    stage.disconnect(paintId);
                });
            }
        }

        return record;
    }

    _updateGeometry(record) {
        const {actor, glass} = record;

        const [width, height] = actor.get_size();
        if (width <= 0 || height <= 0)
            return;

        const [stageX, stageY] = actor.get_transformed_position();


        if (!Number.isFinite(stageX) || !Number.isFinite(stageY))
            return;

        const parent = glass.get_parent();

        if (parent) {
            const [parentX, parentY] = parent.get_transformed_position();
            if (!Number.isFinite(parentX) || !Number.isFinite(parentY))
                return;

            glass.set_position(Math.round(stageX - parentX), Math.round(stageY - parentY));



            if (parent.set_child_below_sibling)
                parent.set_child_below_sibling(glass, actor);
        }

        const geomX = Math.round(stageX);
        const geomY = Math.round(stageY);
        const geomW = Math.round(width);
        const geomH = Math.round(height);

        glass.setGeometry(geomX, geomY, geomW, geomH);
        glass.opacity = actor.opacity;


        if (!glass.get_stage()) {
            glass.realize();
        }


        const glassBox = new Clutter.ActorBox();
        glassBox.x1 = glass.x;
        glassBox.y1 = glass.y;
        glassBox.x2 = glass.x + geomW;
        glassBox.y2 = glass.y + geomH;
        glass.allocate(glassBox);
    }

    _updateGlassParams(record) {
        const {actor, glass, widget} = record;
        const s = this._settings();
        const systemIsDark = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const dark = this._isDark
            ? this._isDark()
            : (s.get_int('appearance') === 0 ||
                (s.get_int('appearance') === 2 && systemIsDark));
        const colors = macColors(0, dark ? 0 : 1, systemIsDark);



        const background = s.get_string('style-background').trim();
        let tint = colors.glassTint;
        let tintAlpha = s.get_int('tint-alpha-pct') / 100;

        if (background && /^(#[0-9a-fA-F]{3,8}|rgba?\(.+\))$/.test(background)) {
            tint = parseCssColor(background);
            if (typeof tint.a === 'number')
                tintAlpha *= tint.a;
        } else if (typeof tint?.a === 'number') {
            tintAlpha *= tint.a;
        }


        let radius = s.get_int('style-border-radius');


        if (actor.get_style) {
            const style = actor.get_style();
            if (style) {
                const radiusMatch = style.match(/border-radius:\s*(\d+(?:\.\d+)?)\s*px/);
                if (radiusMatch) {
                    radius = parseFloat(radiusMatch[1]);
                }
            }
        }

        let blurRadius = Math.max(0, s.get_int('blur-radius-px'));

        glass.setParams({
            radius: radius,
            roundness: 2,
            tint,
            tintAlpha,
            blurRadius,
            solid: false,
        });

        glass.opacity = actor.opacity;
    }

    _syncPointer(record) {
        if (record.hoverFade <= 0) {
            record.glass.setPointer(-1, -1, 0);
            return;
        }

        const [u, v] = record.pointer;
        record.glass.setPointer(u, v, record.hoverFade);
    }

    _animateHover(record, target) {
        if (!record.timeline) {
            record.timeline = new Clutter.Timeline({actor: record.glass, duration: HOVER_FADE_MS});
            record.timeline.connect('new-frame', () => {
                const t = record.timeline.get_progress();
                record.hoverFade = record.fadeFrom + (record.fadeTo - record.fadeFrom) * t;
                this._syncPointer(record);
            });
        }

        record.timeline.stop();
        record.fadeFrom = record.hoverFade;
        record.fadeTo = target;
        record.timeline.rewind();
        record.timeline.start();
    }

    _detach(id) {
        const record = this._records.get(id);
        if (!record)
            return;

        record.timeline?.stop();

        for (const signalId of record.signalIds) {
            try {
                record.actor.disconnect(signalId);
            } catch (e) {

            }
        }

        if (record.glass) {
            record.glass.get_parent()?.remove_child(record.glass);
            record.glass.destroy();
        }

        this._records.delete(id);
    }
}
