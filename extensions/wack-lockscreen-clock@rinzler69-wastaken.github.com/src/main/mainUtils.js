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
    let loc = 'en';
    try {
        const file = `${GLib.get_home_dir()}/.config/mac-styling/locale`;
        if (GLib.file_test(file, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(file);
            if (ok) loc = new TextDecoder().decode(bytes).trim().toLowerCase();
        } else {
            loc = (GLib.getenv('LANGUAGE') || GLib.getenv('LANG') || 'en').toLowerCase();
        }
    } catch (_) {
        loc = (GLib.getenv('LANG') || 'en').toLowerCase();
    }
    const code = loc.split('_')[0].split('.')[0].replace('-', '_');
    const map = {
        'uk': 'TouchID або пароль',
        'es': 'TouchID o contraseña',
        'en': 'TouchID or Password',
        'pl': 'TouchID lub hasło',
        'de': 'TouchID oder Passwort',
        'fr': 'TouchID ou mot de passe',
        'it': 'TouchID o password',
        'pt': 'TouchID ou senha',
        'nl': 'TouchID of wachtwoord',
        'cs': 'TouchID nebo heslo',
        'sk': 'TouchID alebo heslo',
        'tr': 'TouchID veya parola',
        'zh': 'TouchID 或密码',
        'zh_tw': 'TouchID 或密碼',
        'ja': 'TouchID またはパスワード',
        'ko': 'TouchID 또는 암호',
        'ru': 'TouchID или пароль',
        'be': 'TouchID або пароль',
        'sr': 'TouchID или лозинка',
        'hr': 'TouchID ili lozinka',
        'sl': 'TouchID ali geslo',
        'sv': 'TouchID eller lösenord',
        'no': 'TouchID eller passord',
        'da': 'TouchID eller adgangskode',
        'fi': 'TouchID tai salasana',
        'et': 'TouchID või parool',
        'lt': 'TouchID arba slaptažodis',
        'lv': 'TouchID vai parole',
        'hu': 'TouchID vagy jelszó',
        'ro': 'TouchID sau parolă',
        'bg': 'TouchID или парола',
        'el': 'TouchID ή κωδικός πρόσβασης',
        'vi': 'TouchID hoặc mật khẩu',
        'th': 'TouchID หรือรหัสผ่าน',
        'ar': 'TouchID أو كلمة المرور',
        'fa': 'TouchID یا گذرواژه',
        'he': 'TouchID או סיסמה',
        'hi': 'TouchID या पासवर्ड',
        'bn': 'TouchID অথবা পাসওয়ার্ড',
    };
    return map[code] || 'TouchID or Password';
}
