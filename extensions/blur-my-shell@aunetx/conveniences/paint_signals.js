import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

// 60 FPS max update rate (16,666 microseconds = 1/60s).
// Ensures blur updates smoothly at up to 60 FPS while dragging/resizing,
// while avoiding excessive redraws on 165Hz high-refresh displays.
const MIN_INTERVAL_US = 16666;

export const PaintSignals = class PaintSignals {
    constructor(connections) {
        this.entries = new Map();
        this.connections = connections;
    }

    connect(actor, blur_effect) {
        this.disconnect_all_for_actor(actor);

        let last_repaint_us = 0;
        let last_x = NaN;
        let last_y = NaN;
        let last_w = NaN;
        let last_h = NaN;

        const paint_effect = new PaintCallbackEffect();
        paint_effect.set_callback(() => {
            let cur_x = NaN, cur_y = NaN;
            try {
                const pos = actor.get_transformed_position();
                cur_x = pos[0];
                cur_y = pos[1];
            } catch (_) { }

            const cur_w = actor.width;
            const cur_h = actor.height;

            const moved = (cur_x !== last_x || cur_y !== last_y || cur_w !== last_w || cur_h !== last_h);
            if (!moved) {
                // Window geometry is unchanged; do NOT trigger redundant repaints!
                return;
            }

            const now = GLib.get_monotonic_time();
            if (now - last_repaint_us < MIN_INTERVAL_US) {
                return;
            }

            last_repaint_us = now;
            last_x = cur_x;
            last_y = cur_y;
            last_w = cur_w;
            last_h = cur_h;
            blur_effect.queue_repaint();
        });

        actor.add_effect(paint_effect);
        const destroy_id = this.connections.connect(actor, 'destroy', () => {
            paint_effect.set_callback(null);
            this.entries.delete(actor);
        });
        this.entries.set(actor, { paint_effect, destroy_id, mark_dirty: () => { last_x = NaN; } });
    }

    mark_dirty(actor) {
        const entry = this.entries.get(actor);
        if (entry && entry.mark_dirty)
            entry.mark_dirty();
    }

    disconnect_all_for_actor(actor) {
        const entry = this.entries.get(actor);
        if (!entry)
            return;

        this.entries.delete(actor);
        entry.paint_effect.set_callback(null);
        this.connections.disconnect(actor, entry.destroy_id);
        actor.remove_effect(entry.paint_effect);
    }

    disconnect_all() {
        for (const actor of [...this.entries.keys()])
            this.disconnect_all_for_actor(actor);
    }
};

const PaintCallbackEffect = globalThis.__BmsPaintCallbackEffect ||
    (globalThis.__BmsPaintCallbackEffect = GObject.registerClass(
        { GTypeName: GObject.type_from_name('BmsPaintCallbackEffect') === 0 ? 'BmsPaintCallbackEffect' : 'BmsPaintCallbackEffect_v2' },
        class PaintCallbackEffect extends Clutter.Effect {
            set_callback(callback) {
                this._callback = callback;
            }

            vfunc_paint(node, paint_context, paint_flags) {
                if (this._callback)
                    this._callback();
                super.vfunc_paint(node, paint_context, paint_flags);
            }
        }
    ));
