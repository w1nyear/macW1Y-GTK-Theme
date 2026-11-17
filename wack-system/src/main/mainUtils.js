import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function _log(msg) {
    console.log(msg);
}

export function _logError(msg) {
    console.error(msg);
}

export function _setActorVisible(actor, visible, opacity) {
    if (!actor)
        return;

    actor.visible = visible;
    actor.opacity = opacity;
}

export const PowerProfilesIface = `<node>
<interface name="net.hadess.PowerProfiles">
    <property name="ActiveProfile" type="s" access="readwrite"/>
</interface>
</node>`;

export function hasFingerprint(_userName) {


    return false;
}

export function getAuthSubtitleText(_userName) {
    const locale = GLib.getenv('LANG') || '';
    const isUk = locale.startsWith('uk');
    return isUk ? 'TouchID або пароль' : 'TouchID or Password';
}
