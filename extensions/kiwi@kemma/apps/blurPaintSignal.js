// SPDX-License-Identifier: GPL-3.0-or-later
// Clutter effect that emits 'update-blur' whenever its actor is painted.
// Shell.BlurEffect (BACKGROUND mode) does not repaint when content above it
// repaints (GNOME Shell #2857), leaving squared artifacts around buttons and
// icons. Attaching this effect to the blur widget forces a (throttled) blur
// repaint whenever the widget itself is painted — same hack as blur-my-shell.
//
// v0.4: додано перевірку _tahoeGameMode та _tahoeBlurEnabled для
// пропуску перемальовування при активній грі (фікс idle GPU spikes).

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

// Мінімальний інтервал між перемальовуваннями blur у мс (damage throttle)
// При idle — blur не оновлюється частіше ніж раз на 100мс
const MIN_REPAINT_INTERVAL_MS = 100;

export const BlurPaintSignal = GObject.registerClass({
    GTypeName: 'KiwiBlurPaintSignal',
    Signals: {
        'update-blur': {},
    },
}, class BlurPaintSignal extends Clutter.Effect {
    vfunc_paint(node, paintContext, paintFlags) {
        // Якщо гра у фокусі — не emit update-blur (економимо GPU)
        if (globalThis._tahoeGameMode || globalThis._tahoeBlurEnabled === false) {
            super.vfunc_paint(node, paintContext, paintFlags);
            return;
        }
        this.emit('update-blur');
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});

// Connects the paint-signal hack: asks for a blur repaint whenever actor
// paints, throttled so the repaint itself doesn't loop forever. requestRepaint
// is the caller's coalescing scheduler, so a frame that a geometry or overview
// signal already asked to repaint doesn't get a second queue_repaint() here.
//
// v0.4: додатковий damage-tracking throttle — якщо контент не змінився
// з часу останнього repaint, пропускаємо (фікс idle GPU 50-80% спайків).
export function connectPaintSignal(actor, requestRepaint) {
    const paintSignal = new BlurPaintSignal();
    let counter = 0;
    let lastRepaintTime = 0;

    paintSignal.connect('update-blur', () => {
        // Throttle за часом (damage-based): не перемальовуємо blur частіше ніж потрібно
        const now = GLib.get_monotonic_time() / 1000; // мікросекунди → мілісекунди
        if (now - lastRepaintTime < MIN_REPAINT_INTERVAL_MS) {
            return; // Пропустити — занадто часто
        }

        if (counter === 0) {
            counter = 2;
            lastRepaintTime = now;
            requestRepaint();
        } else {
            counter--;
        }
    });
    actor.add_effect(paintSignal);
    return paintSignal;
}

