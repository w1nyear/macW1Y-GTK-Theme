import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { safeRegisterClass } from './shellVersion.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';




const _gobjectToString = GObject.Object.prototype.toString;






export function isActorValid(actor) {
    if (!actor)
        return false;
    const desc = _gobjectToString.call(actor);
    if (desc.includes('(DISPOSED)') || desc.includes('(FINALIZED)'))
        return false;

    return typeof actor.visible === 'boolean';
}






export function getAllocatedSize(actor) {
    const box = actor.get_allocation_box();
    const w = box.get_width();
    const h = box.get_height();
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
        return [w, h];

    const [sw, sh] = actor.get_size();
    return [sw, sh];
}







export function getTransformedRect(actor) {
    const r = actor.get_transformed_extents();
    const x = r.origin.x, y = r.origin.y;
    const w = r.size.width, h = r.size.height;
    if (Number.isFinite(x) && Number.isFinite(y) &&
        Number.isFinite(w) && Number.isFinite(h))
        return [x, y, w, h];
    const [px, py] = actor.get_transformed_position();
    const [aw, ah] = getAllocatedSize(actor);
    return [px, py, aw, ah];
}

export function resolveMonitorGeometry(candidates) {
    const layoutManager = Main.layoutManager;
    for (const actor of candidates) {
        if (!actor || !isActorValid(actor))
            continue;
        const [width, height] = actor.get_size();
        if (!(width > 0 && height > 0))
            continue;
        const index = layoutManager.findIndexForActor(actor);
        if (index >= 0)
            return layoutManager.monitors[index] || layoutManager.primaryMonitor;
    }
    return layoutManager.monitors[layoutManager.primaryIndex] || layoutManager.primaryMonitor;
}

export function getWindowActors() {
    return global.get_window_actors();
}









export function windowMayCover(actor, rect) {
    let top = actor;
    while (top && top.get_parent() !== global.window_group)
        top = top.get_parent();
    if (!top)
        return false;
    for (let above = top.get_next_sibling(); above; above = above.get_next_sibling()) {
        if (!(above instanceof Meta.WindowActor) || !above.visible || above.get_paint_opacity() !== 255)
            continue;
        if (above.get_effects().some(effect => effect.enabled))
            continue;
        const box = above.get_transformed_extents();
        const [x, y] = [box.get_x(), box.get_y()];
        if (x < rect[2] && y < rect[3] && x + box.get_width() > rect[0] && y + box.get_height() > rect[1])
            return true;
    }
    return false;
}






// global._lgGlass.diffWrites(false) restores unconditional writes.
let _diffWritesEnabled = true;

export function setDiffWritesEnabled(enabled) {
    _diffWritesEnabled = !!enabled;
}

export function isDiffWritesEnabled() {
    return _diffWritesEnabled;
}


const _lastWritten = new WeakMap();



function writeIfChanged(actor, setter, values, write) {
    let written = _lastWritten.get(actor);
    if (!written) {
        written = new Map();
        _lastWritten.set(actor, written);
    }
    const previous = written.get(setter);
    if (_diffWritesEnabled && previous && values.every((value, index) => value === previous[index]))
        return false;
    written.set(setter, values);
    write();
    return true;
}

export function setTranslationIfChanged(actor, x, y) {
    return writeIfChanged(actor, 'translation', [x, y], () => {
        actor.translation_x = x;
        actor.translation_y = y;
    });
}

export function setSizeIfChanged(actor, width, height) {
    return writeIfChanged(actor, 'size', [width, height], () => actor.set_size(width, height));
}

export function setScaleIfChanged(actor, scaleX, scaleY) {
    return writeIfChanged(actor, 'scale', [scaleX, scaleY], () => actor.set_scale(scaleX, scaleY));
}

export function setClipIfChanged(actor, x, y, width, height) {
    return writeIfChanged(actor, 'clip', [x, y, width, height], () => actor.set_clip(x, y, width, height));
}

export function setPositionIfChanged(actor, x, y) {
    return writeIfChanged(actor, 'position', [x, y], () => actor.set_position(x, y));
}










const _strandedFrames = new WeakMap();
const STRANDED_FRAMES_BEFORE_RESCUE = 3;
const _windowActorStrandedFrames = new Map();
let _windowActorRescueMode = 'two-stage';
const WINDOW_ACTOR_RESCUE_MODES = ['two-stage', 'remap', 'off'];

export function setWindowActorRescueMode(mode) {
    _windowActorRescueMode =
        WINDOW_ACTOR_RESCUE_MODES.includes(mode) ? mode : 'two-stage';
}

export function getWindowActorRescueMode() {
    return _windowActorRescueMode;
}









export function ensureWindowActorAllocated(actor, relayoutFrames, remapFrames) {
    if (!actor)
        return '';
    if (_windowActorRescueMode === 'off')
        return '';
    if (!actor.visible || !actor.mapped || actor.has_allocation()) {
        _windowActorStrandedFrames.delete(actor);
        return '';
    }
    const strandedFor = (_windowActorStrandedFrames.get(actor) ?? 0) + 1;
    _windowActorStrandedFrames.set(actor, strandedFor);
    if (_windowActorRescueMode !== 'remap' && strandedFor === relayoutFrames) {


        let ancestor = actor.get_parent();
        while (ancestor && isActorValid(ancestor) && !ancestor.has_allocation())
            ancestor = ancestor.get_parent();
        if (ancestor && isActorValid(ancestor)) {
            ancestor.queue_relayout();
            return 'relayout';
        }
    }
    if (strandedFor >= remapFrames) {
        _windowActorStrandedFrames.delete(actor);
        actor.hide();
        actor.show();
        return 'remap';
    }
    return '';
}






export function clearStranded(actor) {
    _strandedFrames.delete(actor);
    _windowActorStrandedFrames.delete(actor);
}






export function ensureGlassAllocated(actor, framesBeforeRescue = STRANDED_FRAMES_BEFORE_RESCUE) {
    if (!actor)
        return false;

    if (!actor.visible || !actor.mapped || actor.has_allocation()) {
        _strandedFrames.delete(actor);
        return false;
    }
    const strandedFor = (_strandedFrames.get(actor) ?? 0) + 1;
    if (strandedFor < framesBeforeRescue) {
        _strandedFrames.set(actor, strandedFor);
        return false;
    }
    _strandedFrames.delete(actor);
    actor.hide();
    actor.show();
    return true;
}






export function setActorVisible(actor, visible) {
    if (!actor)
        return;
    if (actor.visible === visible)
        return;
    actor.visible = visible;
    if (visible) {
        actor.queue_relayout();
        actor.get_parent()?.queue_relayout();
    }
}

export const GLASS_CLIP_PADDING = 200;
export const GLASS_SHADOW_MAX_RADIUS = GLASS_CLIP_PADDING - 20;

export function placeScreenGlass(glass, x, y, screenW, screenH, clip) {


    glass.remove_transition('size');
    glass.remove_transition('position');
    glass.set_position(x, y);
    glass.set_size(screenW, screenH);
    glass.remove_transition('size');
    glass.remove_transition('position');
    setClipIfChanged(glass, clip.x - GLASS_CLIP_PADDING, clip.y - GLASS_CLIP_PADDING, clip.w + GLASS_CLIP_PADDING * 2, clip.h + GLASS_CLIP_PADDING * 2);
}




export function resolveGlassOrigin(actor, memory, fallback) {
    const [x, y] = actor.get_transformed_position();
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
        memory._lastValidAnimAbsX = x;
        memory._lastValidAnimAbsY = y;
        return [x, y];
    }
    if (memory._lastValidAnimAbsX !== undefined && memory._lastValidAnimAbsY !== undefined)
        return [memory._lastValidAnimAbsX, memory._lastValidAnimAbsY];
    return fallback();
}

export function applyGlassScale(effect, cornerRadius, scaleX, scaleY) {
    if (!effect)
        return;

    const currentScale = Math.min(scaleX, scaleY);
    effect.setCornerRadius(cornerRadius * currentScale);
    effect.setAnimationScale(currentScale);
}






export const UnpickableActor = safeRegisterClass({ GTypeName: 'WackGlass_UnpickableActor' }, class UnpickableActor extends Clutter.Actor {
    _init(params = {}) {
        super._init(params);
        Shell.util_set_hidden_from_pick(this, true);
    }

    vfunc_pick(_pickContext) {
    }
});







export const UnpickableWidget = safeRegisterClass({ GTypeName: 'WackGlass_UnpickableWidget' }, class UnpickableWidget extends St.Widget {
    _init(params = {}) {
        super._init(params);
        Shell.util_set_hidden_from_pick(this, true);
    }

    vfunc_pick(_pickContext) {
    }
});








export const LayoutOpaqueActor = safeRegisterClass({ GTypeName: 'WackGlass_LayoutOpaqueActor' }, class LayoutOpaqueActor extends UnpickableActor {
    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }
});
