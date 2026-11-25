import GLib from 'gi://GLib';

const BCP47_MAP = {
    uk: 'uk-UA',
    en: 'en-US',
    pl: 'pl-PL',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-PT',
    cs: 'cs-CZ',
    sk: 'sk-SK',
    nl: 'nl-NL',
    ro: 'ro-RO',
    hu: 'hu-HU',
    bg: 'bg-BG',
    ru: 'ru-RU',
    tr: 'tr-TR',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
    zh_tw: 'zh-TW',
    hi: 'hi-IN',
    bn: 'bn-BD',
    th: 'th-TH',
    vi: 'vi-VN',
    ar: 'ar-SA',
    he: 'he-IL',
    fa: 'fa-IR',
    lt: 'lt-LT',
    lv: 'lv-LV',
    et: 'et-EE',
    hr: 'hr-HR',
    sr: 'sr-RS',
    sl: 'sl-SI',
    be: 'be-BY',
};

const QUICK_STRINGS = {
    'No events today': {
        uk: 'Сьогодні подій немає',
        pl: 'Brak wydarzeń na dziś',
        de: 'Heute keine Ereignisse',
        fr: 'Aucun événement aujourd’hui',
        es: 'Sin eventos hoy',
        it: 'Nessun evento oggi',
        pt: 'Sem eventos hoje',
        cs: 'Dnes žádné události',
        sk: 'Dnes žiadne udalosti',
        nl: 'Geen evenementen vandaag',
        ro: 'Niciun eveniment astăzi',
        hu: 'Ma nincsenek események',
        tr: 'Bugün etkinlik yok',
        ru: 'Сегодня событий нет',
    },
    'Today': {
        uk: 'Сьогодні',
        pl: 'Dzisiaj',
        de: 'Heute',
        fr: 'Aujourd’hui',
        es: 'Hoy',
        it: 'Oggi',
        pt: 'Hoje',
        cs: 'Dnes',
        sk: 'Dnes',
        nl: 'Vandaag',
        ro: 'Astăzi',
        hu: 'Ma',
        tr: 'Bugün',
        ru: 'Сегодня',
    },
    'All day': {
        uk: 'Увесь день',
        pl: 'Cały dzień',
        de: 'Ganztägig',
        fr: 'Toute la journée',
        es: 'Todo el día',
        it: 'Tutto il giorno',
        pt: 'O dia todo',
        cs: 'Celý den',
        sk: 'Celý deň',
        nl: 'Hele dag',
        ro: 'Toată ziua',
        hu: 'Egész nap',
        tr: 'Tüm gün',
        ru: 'Весь день',
    },
};

export function getModpackLangCode() {
    if (globalThis._macModpackLocale) {
        return String(globalThis._macModpackLocale).trim().toLowerCase();
    }
    try {
        const path = `${GLib.get_home_dir()}/.config/mac-styling/locale`;
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim().toLowerCase();
                if (s) return s;
            }
        }
    } catch (_) {}
    const env = (GLib.getenv('LC_ALL') || GLib.getenv('LANG') || 'en').split('.')[0].split('_')[0].toLowerCase();
    return env || 'en';
}

export function getModpackIntlLocale() {
    const code = getModpackLangCode();
    return BCP47_MAP[code] || code.replace('_', '-') || undefined;
}

export function trWidget(text, fallbackGettext) {
    const code = getModpackLangCode();
    if (code === 'en') return text;
    const entry = QUICK_STRINGS[text];
    if (entry && entry[code]) {
        return entry[code];
    }
    return typeof fallbackGettext === 'function' ? fallbackGettext(text) : text;
}
