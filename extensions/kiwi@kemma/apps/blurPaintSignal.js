// SPDX-License-Identifier: GPL-3.0-or-later









import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';



const MIN_REPAINT_INTERVAL_MS = 100;

export const BlurPaintSignal = GObject.registerClass({
    GTypeName: 'KiwiBlurPaintSignal',
    Signals: {
        'update-blur': {},
    },
}, class BlurPaintSignal extends Clutter.Effect {
    vfunc_paint(node, paintContext, paintFlags) {
        this.emit('update-blur');
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});








export function connectPaintSignal(actor, requestRepaint) {
    const paintSignal = new BlurPaintSignal();
    let counter = 0;
    let lastRepaintTime = 0;

    paintSignal.connect('update-blur', () => {

        const now = GLib.get_monotonic_time() / 1000;
        if (now - lastRepaintTime < MIN_REPAINT_INTERVAL_MS) {
            return;
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
