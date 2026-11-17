import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function _writeDebugFile(prefix, msg) {
    try {
        const line = `[${new Date().toISOString()}] ${prefix} ${msg}\n`;
        const file = Gio.File.new_for_path('/var/tmp/wack/gdm-debug.log');
        let stream;
        if (file.query_exists(null)) {
            stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        } else {
            stream = file.create(Gio.FileCreateFlags.NONE, null);
        }
        stream.write_all(line, null);
        stream.close(null);
    } catch (_) {}
}

export function _log(msg) {
    console.log(msg);
    _writeDebugFile('[INFO]', msg);
}

export function _logError(msg) {
    console.error(msg);
    _writeDebugFile('[ERROR]', msg);
}

export function _setActorVisible(actor, visible, opacity) {
    if (!actor)
        return;

    actor.remove_all_transitions();
    actor.visible = visible;
    actor.opacity = opacity;
}










export function resolveGdmAccessibleUri(meta) {
    if (!meta)
        return null;
    if (meta.uri) {
        const uriPath = meta.uri.startsWith('file://') ? meta.uri.substring(7) : meta.uri;
        if (Gio.File.new_for_path(uriPath).query_exists(null))
            return meta.uri.startsWith('file://') ? meta.uri : `file://${meta.uri}`;
    }
    if (meta.resolved_slide_path)
        return meta.resolved_slide_path.startsWith('file://') ? meta.resolved_slide_path : `file://${meta.resolved_slide_path}`;
    const fallback = meta.source_uri ?? meta.uri;
    if (fallback)
        return fallback.startsWith('file://') ? fallback : `file://${fallback}`;
    return null;
}


export const GDM_USER_STACK_VERTICAL_FRACTION_WITH_CSA = 1.08;
export const GDM_USER_STACK_VERTICAL_FRACTION_NO_CSA = 1.04;
export const GDM_USER_LIST_CAP_WITH_CSA = 3;
export const GDM_USER_LIST_CAP_NO_CSA = 4;
export const GDM_DATETIME_TOP_FRACTION = 0.07;
export const GDM_CROSSFADE_DURATION = 300;
export const GDM_REST_PROMPT_VERTICAL_FRACTION = 0.66;
