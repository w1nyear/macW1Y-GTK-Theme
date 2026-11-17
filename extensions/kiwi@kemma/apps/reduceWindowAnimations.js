// SPDX-License-Identifier: GPL-3.0-or-later


import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';



const OPEN_DURATION = 100;
const OPEN_SCALE_FROM = 0.97;
const CLOSE_DURATION = 70;
const CLOSE_SCALE_TO = 0.97;

let _origShouldAnimateActor = null;

export function enable() {
    if (_origShouldAnimateActor)
        return;

    _origShouldAnimateActor = Main.wm._shouldAnimateActor;






    Main.wm._shouldAnimateActor = function (actor, types) {
        const shouldAnimate = _origShouldAnimateActor.call(this, actor, types);
        if (!shouldAnimate || actor._kiwiEasePatched)
            return shouldAnimate;





        actor._kiwiEasePatched = true;
        const origEase = actor.ease;
        actor.ease = function (params) {
            actor.ease = origEase;
            actor._kiwiEasePatched = false;

            const forOpening = Main.wm._mapping.has(actor);
            const forClosing = Main.wm._destroying.has(actor);

            if (!forOpening && !forClosing)
                return origEase.call(this, params);

            actor.set_pivot_point(0.5, 0.5);

            if (forOpening) {
                actor.scale_x = OPEN_SCALE_FROM;
                actor.scale_y = OPEN_SCALE_FROM;
                actor.opacity = 0;
                params.scale_x = 1;
                params.scale_y = 1;
                params.opacity = 255;
                params.duration = OPEN_DURATION;
                params.mode = Clutter.AnimationMode.EASE_OUT_QUAD;
            } else {
                params.scale_x = CLOSE_SCALE_TO;
                params.scale_y = CLOSE_SCALE_TO;
                params.opacity = 0;
                params.duration = CLOSE_DURATION;
                params.mode = Clutter.AnimationMode.EASE_IN_QUAD;
            }

            return origEase.call(this, params);
        };

        return shouldAnimate;
    };
}

export function disable() {
    if (!_origShouldAnimateActor)
        return;
    Main.wm._shouldAnimateActor = _origShouldAnimateActor;
    _origShouldAnimateActor = null;
}
