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
        uk: 'Сьогодні подій немає', pl: 'Brak wydarzeń na dziś', de: 'Heute keine Ereignisse',
        fr: 'Aucun événement aujourd’hui', es: 'Sin eventos hoy', it: 'Nessun evento oggi',
        pt: 'Sem eventos hoje', cs: 'Dnes žádné události', sk: 'Dnes žiadne udalosti',
        nl: 'Geen evenementen vandaag', ro: 'Niciun eveniment astăzi', hu: 'Ma nincsenek események',
        tr: 'Bugün etkinlik yok', ru: 'Сегодня событий нет', be: 'Сёння падзей няма',
        bg: 'Няма събития днес', sr: 'Данас нема догађаја', hr: 'Danas nema događaja',
        sl: 'Danes ni dogodkov', lt: 'Šiandien įvykių nėra', lv: 'Šodien nav notikumu',
        et: 'Täna pole sündmusi', ja: '今日の予定はありません', ko: '오늘 일정 없음',
        zh: '今天没有日程', zh_tw: '今天沒有活動', vi: 'Hôm nay không có sự kiện',
        th: 'ไม่มีกิจกรรมวันนี้', hi: 'आज कोई कार्यक्रम नहीं', bn: 'আজ কোনো ইভেন্ট নেই',
        ar: 'لا توجد أحداث اليوم', fa: 'امروز رویدادی نیست', he: 'אין אירועים היום',
    },
    'Today': {
        uk: 'Сьогодні', pl: 'Dzisiaj', de: 'Heute', fr: 'Aujourd’hui',
        es: 'Hoy', it: 'Oggi', pt: 'Hoje', cs: 'Dnes', sk: 'Dnes',
        nl: 'Vandaag', ro: 'Astăzi', hu: 'Ma', tr: 'Bugün', ru: 'Сегодня',
        be: 'Сёння', bg: 'Днес', sr: 'Данас', hr: 'Danas', sl: 'Danes',
        lt: 'Šiandien', lv: 'Šodien', et: 'Täna', ja: '今日', ko: '오늘',
        zh: '今天', zh_tw: '今天', vi: 'Hôm nay', th: 'วันนี้', hi: 'आज',
        bn: 'আজ', ar: 'اليوم', fa: 'امروز', he: 'היום',
    },
    'All day': {
        uk: 'Увесь день', pl: 'Cały dzień', de: 'Ganztägig', fr: 'Toute la journée',
        es: 'Todo el día', it: 'Tutto il giorno', pt: 'O dia todo', cs: 'Celý den',
        sk: 'Celý deň', nl: 'Hele dag', ro: 'Toată ziua', hu: 'Egész nap',
        tr: 'Tüm gün', ru: 'Весь день', be: 'Увесь дзень', bg: 'Цял ден',
        sr: 'Цео дан', hr: 'Cijeli dan', sl: 'Ves dan', lt: 'Visą dieną',
        lv: 'Visu dienu', et: 'Terve päev', ja: '終日', ko: '하루 종일',
        zh: '全天', zh_tw: '整天', vi: 'Cả ngày', th: 'ทั้งวัน', hi: 'पूरा दिन',
        bn: 'সারাদিন', ar: 'طوال اليوم', fa: 'تمام روز', he: 'כל היום',
    },
    "I'm waiting 🐾": {
        uk: 'Я чекаю 🐾', pl: 'Czekam 🐾', de: 'Ich warte 🐾', fr: 'J’attends 🐾',
        es: 'Estoy esperando 🐾', it: 'Sto aspettando 🐾', pt: 'Estou à espera 🐾',
        cs: 'Čekám 🐾', sk: 'Čakám 🐾', nl: 'Ik wacht 🐾', ro: 'Aștept 🐾',
        hu: 'Várok 🐾', tr: 'Bekliyorum 🐾', ru: 'Я жду 🐾', be: 'Я чакаю 🐾',
        bg: 'Чакам 🐾', sr: 'Чекам 🐾', hr: 'Čekam 🐾', sl: 'Čakam 🐾',
        lt: 'Laukiu 🐾', lv: 'Gaidu 🐾', et: 'Ootan 🐾', ja: '待っています 🐾',
        ko: '기다리고 있어요 🐾', zh: '我在等你 🐾', zh_tw: '我在等你 🐾', vi: 'Đang chờ nè 🐾',
        th: 'ฉันกำลังรออยู่ 🐾', hi: 'मैं इंतज़ार कर रहा हूँ 🐾', bn: 'অপেক্ষা করছি 🐾',
        ar: 'أنا بانتظارك 🐾', fa: 'منتظرم 🐾', he: 'אני מחכה 🐾',
    },
    'Play something to get going': {
        uk: 'Увімкни щось, щоб почати', pl: 'Włącz coś, aby zacząć', de: 'Spiele etwas ab, um zu starten',
        fr: 'Lancez un morceau pour commencer', es: 'Reproduce algo para empezar', it: 'Riproduci qualcosa per iniziare',
        pt: 'Reproduz algo para começar', cs: 'Přehrajte něco pro začátek', sk: 'Prehrajte niečo na začiatok',
        nl: 'Speel iets af om te beginnen', ro: 'Redă ceva pentru a începe', hu: 'Indíts el egy zenét',
        tr: 'Başlamak için bir şey çal', ru: 'Включи что-нибудь, чтобы начать', be: 'Уключыце што-небудзь, каб пачаць',
        bg: 'Пусни нещо, за да започнем', sr: 'Пусти нешто да кренемо', hr: 'Pusti nešto za početak',
        sl: 'Predvajaj nekaj za začetek', lt: 'Paleiskite muziką, kad pradėtumėte', lv: 'Atskaņo kaut ko, lai sāktu',
        et: 'Pane midagi mängima', ja: '何か再生して始めましょう', ko: '음악을 재생해 보세요',
        zh: '播放音乐以开始', zh_tw: '播放音樂即可開始', vi: 'Phát nhạc để bắt đầu',
        th: 'เปิดเพลงเพื่อเริ่มต้น', hi: 'शुरू करने के लिए कुछ चलाएँ', bn: 'শুরু করতে কিছু বাজান',
        ar: 'شغّل شيئًا للبدء', fa: 'برای شروع آهنگی پخش کن', he: 'הפעל מוזיקה כדי להתחיל',
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
