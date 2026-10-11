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

export function hasFingerprint(userName) {
    if (!userName)
        userName = GLib.get_user_name();
    if (!userName)
        return false;
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        const reply = bus.call_sync(
            'net.reactivated.Fprint',
            '/net/reactivated/Fprint/Manager',
            'net.reactivated.Fprint.Manager',
            'GetDefaultDevice',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null
        );
        const [devPath] = reply.recursiveUnpack();
        if (!devPath)
            return false;
        const devReply = bus.call_sync(
            'net.reactivated.Fprint',
            devPath,
            'net.reactivated.Fprint.Device',
            'ListEnrolledFingers',
            new GLib.Variant('(s)', [userName]),
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null
        );
        const [fingers] = devReply.recursiveUnpack();
        return Array.isArray(fingers) && fingers.length > 0;
    } catch (_) {
        return false;
    }
}

export function getAuthSubtitleText(userName) {
    const hasFp = hasFingerprint(userName);
    const locale = GLib.getenv('LANG') || '';
    const isUk = locale.startsWith('uk');
    if (hasFp) {
        return isUk ? 'Touch ID або введіть пароль' : 'Touch ID or Enter Password';
    } else {
        return isUk ? 'Введіть пароль' : 'Enter Password';
    }
}
