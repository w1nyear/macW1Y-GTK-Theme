import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

export const SHELL_MAJOR = parseInt(Config.PACKAGE_VERSION, 10);


export const MENU_NO_ANIMATION = SHELL_MAJOR >= 51 ? { animate: false } : 0;

export const MENU_ANIMATION = SHELL_MAJOR >= 51 ? { animate: true } : ~0;



export function coglContext() {
    const backend = SHELL_MAJOR >= 48
        ? global.stage.context.get_backend()
        : Clutter.get_default_backend();
    return backend.get_cogl_context();
}




export function newRootNode(framebuffer, colorState) {
    if (SHELL_MAJOR >= 48)
        return Clutter.RootNode.new(framebuffer, colorState, new Cogl.Color(), 0);
    const clearColor = SHELL_MAJOR >= 47 ? new Cogl.Color() : new Clutter.Color();
    return Clutter.RootNode.new(framebuffer, clearColor, 0);
}



export function paintStageToContent(rect, scale) {
    if (SHELL_MAJOR >= 50)
        return global.stage.paint_to_content(rect, scale, null, Clutter.PaintFlag.NO_CURSORS);
    return global.stage.paint_to_content(rect, scale, Clutter.PaintFlag.NO_CURSORS);
}




export function offscreenFormat(framebuffer) {
    return SHELL_MAJOR >= 47 ? framebuffer.get_texture().get_format() : null;
}


export function accentColors() {
    if (SHELL_MAJOR < 47)
        return null;
    const [accent, accentFg] = St.ThemeContext.get_for_stage(global.stage).get_accent_color();
    return accent && accentFg ? [accent, accentFg] : null;
}


export function watchAccentColor(callback) {
    if (SHELL_MAJOR < 47)
        return () => { };
    const context = St.ThemeContext.get_for_stage(global.stage);
    const id = context.connect('notify::accent-color', callback);
    return () => context.disconnect(id);
}





export function undoCloneScale(clone, volume) {
    if (SHELL_MAJOR >= 47)
        return;
    const transform = clone.get_transform();
    const sx = transform.get_x_scale();
    const sy = transform.get_y_scale();
    if (sx > 0 && sy > 0 && (sx !== 1 || sy !== 1)) {
        volume.set_width(volume.get_width() / sx);
        volume.set_height(volume.get_height() / sy);
    }
}





export function canCloneSource(source) {
    if (SHELL_MAJOR >= 47)
        return true;
    const box = source.get_allocation_box();
    return box.get_width() > 0 && box.get_height() > 0;
}



export function verticalBoxParams() {
    return SHELL_MAJOR >= 48 ? { orientation: Clutter.Orientation.VERTICAL } : { orientation: Clutter.Orientation.VERTICAL };
}

const CLUTTER_CURSORS = {
    n: 'N_RESIZE', s: 'S_RESIZE', e: 'E_RESIZE', w: 'W_RESIZE',
    ne: 'NE_RESIZE', nw: 'NW_RESIZE', se: 'SE_RESIZE', sw: 'SW_RESIZE', move: 'MOVE',
};
const META_CURSORS = {
    n: 'NORTH_RESIZE', s: 'SOUTH_RESIZE', e: 'EAST_RESIZE', w: 'WEST_RESIZE',
    ne: 'NE_RESIZE', nw: 'NW_RESIZE', se: 'SE_RESIZE', sw: 'SW_RESIZE', move: 'MOVE_OR_RESIZE_WINDOW',
};



export function setHoverCursor(actor, shape) {
    if (SHELL_MAJOR >= 50) {
        actor.set_cursor_type(Clutter.CursorType[CLUTTER_CURSORS[shape]]);
        return;
    }
    const cursor = Meta.Cursor[META_CURSORS[shape]];
    actor.connect('enter-event', () => {
        global.display.set_cursor(cursor);
        return Clutter.EVENT_PROPAGATE;
    });
    actor.connect('leave-event', () => {
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        return Clutter.EVENT_PROPAGATE;
    });
}



export function resetHoverCursor() {
    if (SHELL_MAJOR < 50)
        global.display.set_cursor(Meta.Cursor.DEFAULT);
}



export const QS_MENU_TOGGLE_CLASS = SHELL_MAJOR >= 48 ? 'quick-toggle-has-menu' : 'quick-menu-toggle';



export const BANNER_TRANSPARENT_CLASS = SHELL_MAJOR >= 47
    ? 'liquid-glass-transparent' : 'liquid-glass-transparent-keep-border';





const UNIFORM_ARRAYS = SHELL_MAJOR >= 48;



export function setUniformArray(pipeline, location, name, values) {
    if (UNIFORM_ARRAYS) {
        pipeline.set_uniform_float(location, 1, values.length, values);
        return;
    }
    for (let i = 0; i < values.length; i++)
        pipeline.set_uniform_1f(pipeline.get_uniform_location(`${name}[${i}]`), values[i]);
}


export function setUniformVector(pipeline, name, values) {
    if (UNIFORM_ARRAYS) {
        pipeline.set_uniform_float(pipeline.get_uniform_location(name), values.length, 1, values);
        return;
    }
    for (let i = 0; i < values.length; i++)
        pipeline.set_uniform_1f(pipeline.get_uniform_location(`${name}_${i}`), values[i]);
}




export function uniformDeclarations(decl) {
    if (UNIFORM_ARRAYS)
        return decl;
    return decl.replace(/uniform\s+vec([234])\s+(\w+)\s*;/g, (_match, size, name) => {
        const parts = Array.from({ length: Number(size) }, (_unused, i) => `${name}_${i}`);
        return `uniform float ${parts.join(', ')};\n#define ${name} vec${size}(${parts.join(', ')})\n`;
    });
}






export function paintNodeWithContext(klass) {
    if (SHELL_MAJOR >= 47)
        return klass;
    const proto = klass.prototype;
    const paintNode = proto.vfunc_paint_node;
    delete proto.vfunc_paint_node;
    const parentPaint = Object.getPrototypeOf(proto).vfunc_paint;
    proto.vfunc_paint = function (paintContext) {

        const root = Clutter.ClipNode.new();
        paintNode.call(this, root, paintContext);
        root.paint(paintContext);
        parentPaint.call(this, paintContext);
    };
    return klass;
}

export function safeRegisterClass(metaOrKlass, maybeKlass) {
    let meta = maybeKlass ? metaOrKlass : {};
    let klass = maybeKlass || metaOrKlass;
    let name = meta?.GTypeName || klass.name || 'GjsClass';
    if (GObject.type_from_name(name)) {
        name = `${name}_${GLib.uuid_string_random().replace(/-/g, '_')}`;
    }
    return GObject.registerClass({ ...meta, GTypeName: name }, klass);
}
