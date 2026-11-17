import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { t, tf, getLocale, setDebugLocale } from './mac_i18n.js';

const USER_CONFIG_FILE = `${GLib.get_home_dir()}/.config/mac-styling/macSetupWizard`;
const USER_LOCAL_FILE = `${GLib.get_home_dir()}/.local/share/macW1Y/macSetupWizard`;
const SYSTEM_FILE = '/etc/macW1Y/macSetupWizard';
const VERSION_FILE = `${GLib.get_home_dir()}/.config/mac-styling/version`;
const LOCALE_CONFIG_FILE = `${GLib.get_home_dir()}/.config/mac-styling/locale`;
const ICON_PATH = `${GLib.get_home_dir()}/.local/share/icons/macW1Y-dark/apps/scalable/preferences-desktop-theme.svg`;

const ACCENT_COLOR_MAP = {
    'blue':   '#007aff',
    'teal':   '#30b0c7',
    'green':  '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff6a00',
    'red':    '#ff3b30',
    'pink':   '#ff2d55',
    'purple': '#af52de',
    'slate':  '#8e8e93',
    'brown':  '#a27447',
};

export const SUPPORTED_LANGUAGES = [
    { code: 'uk', native: 'Українська', name: 'Ukrainian' },
    { code: 'en', native: 'English', name: 'English' },
    { code: 'be', native: 'Беларуская', name: 'Belarusian' },
    { code: 'bg', native: 'Български', name: 'Bulgarian' },
    { code: 'bn', native: 'বাংলা', name: 'Bangla' },
    { code: 'cs', native: 'Čeština', name: 'Czech' },
    { code: 'de', native: 'Deutsch', name: 'German' },
    { code: 'es', native: 'Español', name: 'Spanish' },
    { code: 'et', native: 'Eesti', name: 'Estonian' },
    { code: 'fr', native: 'Français', name: 'French' },
    { code: 'hi', native: 'हिन्दी', name: 'Hindi' },
    { code: 'hr', native: 'Hrvatski', name: 'Croatian' },
    { code: 'hu', native: 'Magyar', name: 'Hungarian' },
    { code: 'it', native: 'Italiano', name: 'Italian' },
    { code: 'ja', native: '日本語', name: 'Japanese' },
    { code: 'ko', native: '한국어', name: 'Korean' },
    { code: 'lt', native: 'Lietuvių', name: 'Lithuanian' },
    { code: 'lv', native: 'Latviešu', name: 'Latvian' },
    { code: 'nl', native: 'Nederlands', name: 'Dutch' },
    { code: 'pl', native: 'Polski', name: 'Polish' },
    { code: 'pt', native: 'Português', name: 'Portuguese' },
    { code: 'ro', native: 'Română', name: 'Romanian' },
    { code: 'ru', native: 'Русский', name: 'Russian' },
    { code: 'sk', native: 'Slovenčina', name: 'Slovak' },
    { code: 'sl', native: 'Slovenščina', name: 'Slovenian' },
    { code: 'sr', native: 'Српски', name: 'Serbian' },
    { code: 'th', native: 'ไทย', name: 'Thai' },
    { code: 'tr', native: 'Türkçe', name: 'Turkish' },
    { code: 'vi', native: 'Tiếng Việt', name: 'Vietnamese' },
    { code: 'zh', native: '简体中文', name: 'Chinese (Simplified)' },
    { code: 'zh_tw', native: '繁體中文', name: 'Chinese (Traditional)' },
    { code: 'ar', native: 'العربية', name: 'Arabic' },
    { code: 'fa', native: 'فارسی', name: 'Persian' },
    { code: 'he', native: 'עברית', name: 'Hebrew' },
    { code: 'ace', native: 'Acehnese', name: 'Acehnese' },
    { code: 'af', native: 'Afrikaans', name: 'Afrikaans' },
    { code: 'ak', native: 'Akan', name: 'Akan' },
    { code: 'am', native: 'አማርኛ', name: 'Amharic' },
    { code: 'as', native: 'অসমীয়া', name: 'Assamese' },
    { code: 'ast', native: 'Asturianu', name: 'Asturian' },
    { code: 'awa', native: 'अवधी', name: 'Awadhi' },
    { code: 'ay', native: 'Aymara', name: 'Aymara' },
    { code: 'az', native: 'Azərbaycan', name: 'Azerbaijani' },
    { code: 'ba', native: 'Башҡорт теле', name: 'Bashkir' },
    { code: 'bho', native: 'भोजपुरी', name: 'Bhojpuri' },
    { code: 'cjy', native: '晋语', name: 'Jin Chinese' },
    { code: 'gan', native: '赣语', name: 'Gan Chinese' },
    { code: 'hak', native: '客家話', name: 'Hakka Chinese' },
    { code: 'hne', native: 'छत्तीसगढ़ी', name: 'Chhattisgarhi' },
    { code: 'hsn', native: '湘语', name: 'Xiang Chinese' },
    { code: 'mag', native: 'मगही', name: 'Magahi' },
    { code: 'mwr', native: 'मारवाड़ी', name: 'Marwari' },
    { code: 'nan', native: '閩南語', name: 'Southern Min' },
    { code: 'om', native: 'Afaan Oromoo', name: 'Oromo' },
    { code: 'pcm', native: 'Naijá', name: 'Nigerian Pidgin' },
    { code: 'skr', native: 'سرائیکی', name: 'Saraiki' },
    { code: 'wuu', native: '吴语', name: 'Wu Chinese' },
    { code: 'yue', native: '粵語', name: 'Cantonese' },
    { code: 'ab', native: 'Аԥсшәа', name: 'Abkhazian' },
    { code: 'ach', native: 'Acoli', name: 'Acoli' },
    { code: 'an', native: 'Aragonés', name: 'Aragonese' },
    { code: 'arn', native: 'Mapudungun', name: 'Mapuche' },
    { code: 'ary', native: 'Moroccan Arabic', name: 'Moroccan Arabic' },
    { code: 'bar', native: 'Bavarian', name: 'Bavarian' },
    { code: 'bem', native: 'Ichibemba', name: 'Bemba' },
    { code: 'bi', native: 'Bislama', name: 'Bislama' },
    { code: 'bo', native: 'བོད་སྐད་', name: 'Tibetan' },
    { code: 'br', native: 'Brezhoneg', name: 'Breton' },
    { code: 'bs', native: 'Bosanski', name: 'Bosnian' },
    { code: 'byn', native: 'ብሊን', name: 'Blin' },
    { code: 'ca', native: 'Català', name: 'Catalan' },
    { code: 'ce', native: 'Нохчийн', name: 'Chechen' },
    { code: 'ceb', native: 'Cebuano', name: 'Cebuano' },
    { code: 'ch', native: 'Chamorro', name: 'Chamorro' },
    { code: 'chr', native: 'ᏣᎳᎩ', name: 'Cherokee' },
    { code: 'ckb', native: 'کوردیی ناوەندی', name: 'Central Kurdish' },
    { code: 'co', native: 'Corsu', name: 'Corsican' },
    { code: 'crh', native: 'Crimean Tatar', name: 'Crimean Tatar' },
    { code: 'csb', native: 'Kashubian', name: 'Kashubian' },
    { code: 'cv', native: 'Чӑваш', name: 'Chuvash' },
    { code: 'cy', native: 'Cymraeg', name: 'Welsh' },
    { code: 'da', native: 'Dansk', name: 'Danish' },
    { code: 'dv', native: 'ދިވެހިބަސް', name: 'Divehi' },
    { code: 'dz', native: 'རྫོང་ཁ', name: 'Dzongkha' },
    { code: 'ee', native: 'Eʋegbe', name: 'Ewe' },
    { code: 'el', native: 'Ελληνικά', name: 'Greek' },
    { code: 'eo', native: 'Esperanto', name: 'Esperanto' },
    { code: 'eu', native: 'Euskara', name: 'Basque' },
    { code: 'ff', native: 'Pulaar', name: 'Fula' },
    { code: 'fi', native: 'Suomi', name: 'Finnish' },
    { code: 'fil', native: 'Filipino', name: 'Filipino' },
    { code: 'fo', native: 'Føroyskt', name: 'Faroese' },
    { code: 'frp', native: 'Arpitan', name: 'Arpitan' },
    { code: 'fur', native: 'Furlan', name: 'Friulian' },
    { code: 'fy', native: 'Frysk', name: 'Western Frisian' },
    { code: 'ga', native: 'Gaeilge', name: 'Irish' },
    { code: 'gd', native: 'Gàidhlig', name: 'Scottish Gaelic' },
    { code: 'gez', native: 'ግዕዝኛ', name: 'Geez' },
    { code: 'gl', native: 'Galego', name: 'Galician' },
    { code: 'gn', native: 'Avañe’ẽ', name: 'Guarani' },
    { code: 'gu', native: 'ગુજરાતી', name: 'Gujarati' },
    { code: 'gv', native: 'Gaelg', name: 'Manx' },
    { code: 'ha', native: 'Hausa', name: 'Hausa' },
    { code: 'haw', native: 'ʻŌlelo Hawaiʻi', name: 'Hawaiian' },
    { code: 'ht', native: 'Haitian Creole', name: 'Haitian Creole' },
    { code: 'hy', native: 'Հայերեն', name: 'Armenian' },
    { code: 'ia', native: 'Interlingua', name: 'Interlingua' },
    { code: 'id', native: 'Indonesia', name: 'Indonesian' },
    { code: 'ie', native: 'Interlingue', name: 'Interlingue' },
    { code: 'io', native: 'Ido', name: 'Ido' },
    { code: 'is', native: 'Íslenska', name: 'Icelandic' },
    { code: 'iu', native: 'ᐃᓄᒃᑎᑐᑦ', name: 'Inuktitut' },
    { code: 'jam', native: 'Jamaican Creole English', name: 'Jamaican Creole English' },
    { code: 'jbo', native: 'La .lojban.', name: 'Lojban' },
    { code: 'jv', native: 'Jawa', name: 'Javanese' },
    { code: 'ka', native: 'Ქართული', name: 'Georgian' },
    { code: 'kab', native: 'Taqbaylit', name: 'Kabyle' },
    { code: 'ki', native: 'Gikuyu', name: 'Kikuyu' },
    { code: 'kk', native: 'Қазақ тілі', name: 'Kazakh' },
    { code: 'kl', native: 'Kalaallisut', name: 'Kalaallisut' },
    { code: 'km', native: 'ខ្មែរ', name: 'Khmer' },
    { code: 'kmr', native: 'Kurdî (kurmancî) (Tirkîye)', name: 'Kurdish (Türkiye)' },
    { code: 'kn', native: 'ಕನ್ನಡ', name: 'Kannada' },
    { code: 'kok', native: 'कोंकणी', name: 'Konkani' },
    { code: 'ku', native: 'Kurdî (kurmancî)', name: 'Kurdish' },
    { code: 'kv', native: 'Komi', name: 'Komi' },
    { code: 'kw', native: 'Kernewek', name: 'Cornish' },
    { code: 'ky', native: 'Кыргызча', name: 'Kyrgyz' },
    { code: 'lb', native: 'Lëtzebuergesch', name: 'Luxembourgish' },
    { code: 'lg', native: 'Luganda', name: 'Ganda' },
    { code: 'lld', native: 'Ladin', name: 'LLD' },
    { code: 'ln', native: 'Lingála', name: 'Lingala' },
    { code: 'lo', native: 'ລາວ', name: 'Lao' },
    { code: 'mai', native: 'मैथिली', name: 'Maithili' },
    { code: 'mg', native: 'Malagasy', name: 'Malagasy' },
    { code: 'mhr', native: 'Mhr', name: 'MHR' },
    { code: 'mi', native: 'Māori', name: 'Māori' },
    { code: 'mjw', native: 'Mjw', name: 'MJW' },
    { code: 'mk', native: 'Македонски', name: 'Macedonian' },
    { code: 'ml', native: 'മലയാളം', name: 'Malayalam' },
    { code: 'mn', native: 'Монгол', name: 'Mongolian' },
    { code: 'mnw', native: 'Mnw', name: 'MNW' },
    { code: 'mr', native: 'मराठी', name: 'Marathi' },
    { code: 'ms', native: 'Melayu', name: 'Malay' },
    { code: 'mt', native: 'Malti', name: 'Maltese' },
    { code: 'my', native: 'မြန်မာ', name: 'Burmese' },
    { code: 'na', native: 'Nauru', name: 'Nauru' },
    { code: 'nah', native: 'Nah', name: 'NAH' },
    { code: 'nb', native: 'Norsk bokmål', name: 'Norwegian Bokmål' },
    { code: 'nds', native: 'Neddersass’sch', name: 'Low German' },
    { code: 'ne', native: 'नेपाली', name: 'Nepali' },
    { code: 'nn', native: 'Norsk nynorsk', name: 'Norwegian Nynorsk' },
    { code: 'nso', native: 'Sesotho sa Leboa', name: 'Northern Sotho' },
    { code: 'nv', native: 'Diné Bizaad', name: 'Navajo' },
    { code: 'oc', native: 'Occitan', name: 'Occitan' },
    { code: 'or', native: 'ଓଡ଼ିଆ', name: 'Odia' },
    { code: 'os', native: 'Ирон', name: 'Ossetic' },
    { code: 'ota', native: 'Ottoman Turkish', name: 'Ottoman Turkish' },
    { code: 'pa', native: 'ਪੰਜਾਬੀ', name: 'Punjabi' },
    { code: 'pam', native: 'Pampanga', name: 'Pampanga' },
    { code: 'pap', native: 'Papiamentu', name: 'Papiamento' },
    { code: 'pi', native: 'Pali', name: 'Pali' },
    { code: 'pms', native: 'Piedmontese', name: 'Piedmontese' },
    { code: 'ps', native: 'پښتو', name: 'Pashto' },
    { code: 'qu', native: 'Runasimi', name: 'Quechua' },
    { code: 'rw', native: 'Ikinyarwanda', name: 'Kinyarwanda' },
    { code: 'sa', native: 'संस्कृत भाषा', name: 'Sanskrit' },
    { code: 'sat', native: 'ᱥᱟᱱᱛᱟᱲᱤ', name: 'Santali' },
    { code: 'sc', native: 'Sardu', name: 'Sardinian' },
    { code: 'sco', native: 'Scots', name: 'Scots' },
    { code: 'sd', native: 'سنڌي', name: 'Sindhi' },
    { code: 'se', native: 'Davvisámegiella', name: 'Northern Sami' },
    { code: 'shn', native: 'တႆး', name: 'Shan' },
    { code: 'si', native: 'සිංහල', name: 'Sinhala' },
    { code: 'so', native: 'Soomaali', name: 'Somali' },
    { code: 'son', native: 'Son', name: 'SON' },
    { code: 'sq', native: 'Shqip', name: 'Albanian' },
    { code: 'st', native: 'Sesotho', name: 'Southern Sotho' },
    { code: 'su', native: 'Basa Sunda', name: 'Sundanese' },
    { code: 'sv', native: 'Svenska', name: 'Swedish' },
    { code: 'sw', native: 'Kiswahili', name: 'Swahili' },
    { code: 'szl', native: 'Ślōnski', name: 'Silesian' },
    { code: 'ta', native: 'தமிழ்', name: 'Tamil' },
    { code: 'te', native: 'తెలుగు', name: 'Telugu' },
    { code: 'tg', native: 'Тоҷикӣ', name: 'Tajik' },
    { code: 'ti', native: 'ትግርኛ', name: 'Tigrinya' },
    { code: 'tig', native: 'ትግረ', name: 'Tigre' },
    { code: 'tk', native: 'Türkmen dili', name: 'Turkmen' },
    { code: 'tl', native: 'Filipino (Pilipinas)', name: 'Filipino (Philippines)' },
    { code: 'trv', native: 'Patas Taroko', name: 'Taroko' },
    { code: 'tt', native: 'Татар', name: 'Tatar' },
    { code: 'tzm', native: 'Tamaziɣt n laṭlaṣ', name: 'Central Atlas Tamazight' },
    { code: 'ug', native: 'ئۇيغۇرچە', name: 'Uyghur' },
    { code: 'ur', native: 'اردو', name: 'Urdu' },
    { code: 'uz', native: 'O‘zbek', name: 'Uzbek' },
    { code: 've', native: 'Tshivenḓa', name: 'Venda' },
    { code: 'vec', native: 'Veneto', name: 'Venetian' },
    { code: 'wa', native: 'Walon', name: 'Walloon' },
    { code: 'wal', native: 'ወላይታቱ', name: 'Wolaytta' },
    { code: 'wo', native: 'Wolof', name: 'Wolof' },
    { code: 'xh', native: 'IsiXhosa', name: 'Xhosa' },
    { code: 'yo', native: 'Èdè Yorùbá', name: 'Yoruba' },
    { code: 'zu', native: 'IsiZulu', name: 'Zulu' },
    { code: 'hmn', native: 'Hmong', name: 'Hmong' },
    { code: 'la', native: 'Latina', name: 'Latin' },
    { code: 'ny', native: 'Nyanja', name: 'Nyanja' },
    { code: 'sm', native: 'Gagana Samoa', name: 'Samoan' },
    { code: 'sn', native: 'ChiShona', name: 'Shona' },
    { code: 'tok', native: 'Toki pona', name: 'Toki Pona' },
];

export function getSortedLanguageList(systemLocale) {
    const sysCode = (systemLocale || 'en').split('.')[0].replace('-', '_').toLowerCase();
    const baseCode = sysCode.split('_')[0];

    let sysLang = SUPPORTED_LANGUAGES.find(l => l.code === sysCode || l.code === baseCode);
    if (!sysLang) {
        sysLang = SUPPORTED_LANGUAGES.find(l => l.code === 'en') || SUPPORTED_LANGUAGES[0];
    }

    const others = SUPPORTED_LANGUAGES.filter(l => l.code !== sysLang.code);
    others.sort((a, b) => a.native.localeCompare(b.native, 'en'));

    return [sysLang, ...others];
}

export function getAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#ff6a00';
    } catch (_) {
        return '#ff6a00';
    }
}

export function hexToRgba(hex, alpha) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getModpackVersion() {
    try {
        if (GLib.file_test(VERSION_FILE, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(VERSION_FILE);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim();
                if (s) return s;
            }
        }
    } catch (_) {}
    return '0.6';
}

export function saveModpackLocale(langCode) {
    try {
        const dir = GLib.path_get_dirname(LOCALE_CONFIG_FILE);
        GLib.mkdir_with_parents(dir, 0o755);
        GLib.file_set_contents(LOCALE_CONFIG_FILE, `${langCode}\n`);
    } catch (e) {
        console.error(`[macSetupWizard] Error writing locale: ${e}`);
    }
    setDebugLocale(langCode);
}

export function applyModpackSystemLocale(langCode, isFinal = false) {
    saveModpackLocale(langCode);
    try {
        const bin = '/usr/local/bin/mac-apply-locale';
        if (GLib.file_test(bin, GLib.FileTest.EXISTS)) {
            const flag = isFinal ? '' : ' -q';
            GLib.spawn_command_line_async(`${bin} ${langCode}${flag}`);
        }
    } catch (e) {
        console.error(`[macSetupWizard] Error applying system locale: ${e}`);
    }
}

export function getSetupWizardFlag() {
    for (const f of [USER_CONFIG_FILE, USER_LOCAL_FILE]) {
        try {
            if (GLib.file_test(f, GLib.FileTest.EXISTS)) {
                const [ok, bytes] = GLib.file_get_contents(f);
                if (ok) {
                    const s = new TextDecoder().decode(bytes).trim();
                    if (s === '0') return false;
                    if (s === '1') return true;
                }
            }
        } catch (_) {}
    }
    try {
        if (GLib.file_test(SYSTEM_FILE, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(SYSTEM_FILE);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim();
                return s === '1';
            }
        }
    } catch (_) {}
    return false;
}

export function setSetupWizardFlag(val) {
    const str = val ? '1' : '0';
    for (const f of [USER_CONFIG_FILE, USER_LOCAL_FILE]) {
        try {
            const dir = GLib.path_get_dirname(f);
            GLib.mkdir_with_parents(dir, 0o755);
            GLib.file_set_contents(f, `${str}\n`);
        } catch (e) {
            console.error(`[macSetupWizard] Error writing to ${f}: ${e}`);
        }
    }
    try {
        if (GLib.file_test(SYSTEM_FILE, GLib.FileTest.EXISTS)) {
            GLib.file_set_contents(SYSTEM_FILE, `${str}\n`);
        }
    } catch (_) {}
}

export function hasTouchpadGestures() {
    try {
        const seat = Clutter.get_default_backend().get_default_seat();
        if (seat && typeof seat.list_devices === 'function') {
            const devs = seat.list_devices();
            for (const d of devs) {
                if (d.get_device_type() === Clutter.InputDeviceType.TOUCHPAD_DEVICE) {
                    return true;
                }
            }
        }
    } catch (_) {}
    const sockPath = `/run/user/${GLib.get_uid()}/mac_touchpad.sock`;
    if (GLib.file_test(sockPath, GLib.FileTest.EXISTS)) return true;
    return false;
}

export class MacSetupWizard {
    constructor() {
        this._overlay = null;
        this._blurClone = null;
        this._welcomeBox = null;
        this._continueBtnBox = null;
        this._dialogCard = null;
        this._pageContainer = null;
        this._currentPage = 1;
        this._totalPages = 4;
        this._hiddenElements = [];
        this._miniWin = null;
        this._gestureSuccess = false;
        this._gestureDistance = 0;
        this._step2ContinueBtn = null;
        this._step2StatusLabel = null;
        this._isDark = true;
        this._selectedLocale = getLocale();
        this._sortedLanguages = getSortedLanguageList(this._selectedLocale);
        this._langRowButtons = new Map();
    }

    start({ force = false } = {}) {
        if (!force && !getSetupWizardFlag()) {
            return false;
        }


        try {
            const existing = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'macSetupWizardOverlay');
            for (const o of existing) {
                try { o.destroy(); } catch (_) {}
            }
        } catch (_) {}

        if (this._overlay) {
            this.destroy();
        }

        globalThis.macSetupWizardActive = true;
        globalThis._macSetupWizardInstance = this;

        try {
            const scheme = Gio.Settings.new('org.gnome.desktop.interface').get_string('color-scheme');
            this._isDark = scheme !== 'prefer-light';
        } catch (_) {
            this._isDark = true;
        }

        this._selectedLocale = getLocale();
        this._sortedLanguages = getSortedLanguageList(this._selectedLocale);


        this._isolateDesktop();


        this._buildOverlay();


        this._buildScreen1();

        return true;
    }

    _isolateDesktop() {
        this._hiddenElements = [];


        if (Main.panel) {
            this._hiddenElements.push({
                actor: Main.panel,
                origOpacity: 255,
                origReactive: true
            });
            Main.panel.opacity = 0;
            Main.panel.reactive = false;
        }


        try {
            const dingActors = (global.window_group?.get_children() || []).filter(c => {
                const mw = c.meta_window || c.get_meta_window?.();
                return mw && (mw.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                              mw.get_title?.()?.startsWith('Desktop Icons'));
            });
            for (const actor of dingActors) {
                this._hiddenElements.push({
                    actor,
                    origOpacity: 255,
                    origReactive: true
                });
                actor.ease({
                    opacity: 0,
                    duration: 350,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        actor.opacity = 0;
                        actor.reactive = false;
                    }
                });
            }
        } catch (_) {}
    }

    _restoreDesktop() {
        for (const item of this._hiddenElements) {
            try {
                const targetOpacity = item.origOpacity !== undefined ? item.origOpacity : 255;
                if (item.actor && item.actor.ease) {
                    item.actor.ease({
                        opacity: targetOpacity,
                        duration: 400,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (item.actor) {
                                item.actor.opacity = targetOpacity;
                                item.actor.reactive = true;
                            }
                        }
                    });
                } else if (item.actor) {
                    item.actor.opacity = targetOpacity;
                    item.actor.reactive = true;
                }
            } catch (_) {}
        }
        this._hiddenElements = [];


        if (Main.panel) {
            Main.panel.opacity = 255;
            Main.panel.reactive = true;
        }


        try {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                const name = child.name || '';
                const cname = child.constructor.name || '';
                if (name === 'dashtodockContainer' || cname === 'DashToDock' || name === 'dock-container' ||
                    name === 'iconsContainer' || cname === 'DesktopIcons' || name === 'ding-container' ||
                    name.includes('liquid-glass')) {
                    child.opacity = 255;
                    child.reactive = true;
                }
            }
        } catch (_) {}
    }

    _buildOverlay() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;

        this._overlay = new St.Widget({
            name: 'macSetupWizardOverlay',
            x: 0,
            y: 0,
            width: stageW,
            height: stageH,
            reactive: true,
            opacity: 0
        });


        try {
            const bgGroup = Main.layoutManager._backgroundGroup;
            if (bgGroup) {
                this._blurClone = new Clutter.Clone({
                    source: bgGroup,
                    width: stageW,
                    height: stageH
                });
                const blurEffect = new Shell.BlurEffect({
                    mode: Shell.BlurMode.ACTOR,
                    radius: 60
                });
                this._blurClone.add_effect(blurEffect);
                this._overlay.add_child(this._blurClone);
            }
        } catch (e) {
            console.error(`[macSetupWizard] Could not clone background: ${e}`);
        }


        const scrim = new St.Widget({
            width: stageW,
            height: stageH,
            style: 'background-color: rgba(0, 0, 0, 0.32);'
        });
        this._overlay.add_child(scrim);

        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, null);

        this._overlay.ease({
            opacity: 255,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _buildScreen1() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;


        const textH = 120;
        this._welcomeBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: stageW,
            height: textH,
            x: 0,
            y: Math.round((stageH - textH) / 2) - 30,
            opacity: 0
        });

        const welcomeLabel = new St.Label({
            text: 'Welcome to macW1Y',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: "font-family: 'Default Rounded', 'Default Display', default, system-ui, sans-serif, sans-serif; " +
                   "font-size: 64px; font-weight: 600; color: #ffffff; text-align: center; " +
                   "text-shadow: 0 4px 28px rgba(0, 0, 0, 0.60); letter-spacing: -0.5px;"
        });
        this._welcomeBox.add_child(welcomeLabel);
        this._overlay.add_child(this._welcomeBox);


        const btnBoxW = 140;
        const btnBoxH = 90;
        this._continueBtnBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x: Math.round((stageW - btnBoxW) / 2),
            y: stageH - 130,
            width: btnBoxW,
            height: btnBoxH,
            opacity: 0
        });

        const circleBtn = new St.Button({
            style: "width: 46px; height: 46px; border-radius: 9999px; " +
                   "background-color: rgba(255, 255, 255, 0.22); " +
                   "border: 1px solid rgba(255, 255, 255, 0.35); " +
                   "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.30);",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            reactive: true
        });

        const iconBin = new St.Bin({
            width: 46,
            height: 46,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        const arrowIcon = new St.Icon({
            icon_name: 'go-next-symbolic',
            icon_size: 18,
            style: 'color: #ffffff;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        iconBin.set_child(arrowIcon);
        circleBtn.set_child(iconBin);

        circleBtn.connect('enter-event', () => {
            circleBtn.style = "width: 46px; height: 46px; border-radius: 9999px; " +
                              "background-color: rgba(255, 255, 255, 0.38); " +
                              "border: 1px solid rgba(255, 255, 255, 0.50); " +
                              "box-shadow: 0 4px 20px rgba(255, 255, 255, 0.25);";
        });
        circleBtn.connect('leave-event', () => {
            circleBtn.style = "width: 46px; height: 46px; border-radius: 9999px; " +
                              "background-color: rgba(255, 255, 255, 0.22); " +
                              "border: 1px solid rgba(255, 255, 255, 0.35); " +
                              "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.30);";
        });

        const labelText = new St.Label({
            text: t('wizard_continue', 'Continue', this._selectedLocale),
            style: "font-family: 'Default', default, system-ui, sans-serif, sans-serif; " +
                   "font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.92); " +
                   "text-align: center; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.60); margin-top: 6px;"
        });

        circleBtn.connect('clicked', () => {
            this._transitionToScreen2();
        });

        this._continueBtnBox.add_child(circleBtn);
        this._continueBtnBox.add_child(labelText);
        this._overlay.add_child(this._continueBtnBox);


        this._welcomeBox.ease({
            opacity: 255,
            duration: 600,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        this._continueBtnBox.ease({
            opacity: 255,
            duration: 600,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _transitionToScreen2() {
        if (this._welcomeBox) {
            this._welcomeBox.ease({
                opacity: 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._welcomeBox) {
                        this._welcomeBox.destroy();
                        this._welcomeBox = null;
                    }
                }
            });
        }
        if (this._continueBtnBox) {
            this._continueBtnBox.ease({
                opacity: 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._continueBtnBox) {
                        this._continueBtnBox.destroy();
                        this._continueBtnBox = null;
                    }
                    this._buildCard();
                }
            });
        }
    }

    _applyNextBtnStyle() {
        if (!this._nextBtn) return;
        const bg = this._accentColor || '#ff6a00';
        const shadow = hexToRgba(bg, 0.38);
        this._nextBtn.style = `padding: 7px 26px; border-radius: 9999px; font-size: 13px; font-weight: 600; ` +
                              `background-color: ${bg}; color: #ffffff; border: none; box-shadow: 0 2px 10px ${shadow};`;
    }

    _applyBackBtnStyle() {
        if (!this._backBtn) return;
        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const bg = this._isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';
        const border = this._isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
        this._backBtn.style = `padding: 7px 22px; border-radius: 9999px; font-size: 13px; font-weight: 500; ` +
                              `background-color: ${bg}; color: ${titleColor}; border: 1px solid ${border};`;
    }

    _buildCard() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;
        this._cardW = 760;
        this._cardH = 550;
        const cardW = this._cardW;
        const cardH = this._cardH;
        const padX = 22;
        const contentW = cardW - (padX * 2);
        this._accentColor = getAccentColor();

        const cardBg = this._isDark ? '#28282a' : '#ffffff';
        const cardBorder = this._isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
        const cardShadow = this._isDark ? '0 24px 72px rgba(0, 0, 0, 0.65)' : '0 24px 72px rgba(0, 0, 0, 0.25)';
        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const subColor = this._isDark ? '#a1a1a6' : '#86868b';

        this._dialogCard = new St.Widget({
            name: 'macSetupWizardCard',
            x: Math.round((stageW - cardW) / 2),
            y: Math.round((stageH - cardH) / 2) + 20,
            width: cardW,
            height: cardH,
            reactive: true,
            opacity: 0,
            style: `background-color: ${cardBg}; border: 1px solid ${cardBorder}; ` +
                   `border-radius: 22px; box-shadow: ${cardShadow};`
        });

        const mainLayout = new St.BoxLayout({
            vertical: true,
            width: cardW,
            height: cardH,
            style: 'padding: 40px 22px 20px 22px;'
        });


        const headerBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 16px;'
        });

        this._headerIcon = new St.Icon({
            icon_size: 56,
            style: 'margin-bottom: 10px;'
        });
        headerBox.add_child(this._headerIcon);

        this._titleLabel = new St.Label({
            text: '',
            style: `font-family: 'Default Display', default, system-ui, sans-serif, sans-serif; font-size: 22px; font-weight: 700; color: ${titleColor}; text-align: center;`
        });
        headerBox.add_child(this._titleLabel);

        this._subtitleLabel = new St.Label({
            text: '',
            style: `font-family: 'Default', default, system-ui, sans-serif, sans-serif; font-size: 13px; font-weight: 400; color: ${subColor}; text-align: center; margin-top: 3px;`
        });
        headerBox.add_child(this._subtitleLabel);
        mainLayout.add_child(headerBox);


        this._pageContainer = new St.BoxLayout({
            vertical: true,
            width: contentW,
            height: 280,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true
        });
        mainLayout.add_child(this._pageContainer);


        this._bottomBar = new St.BoxLayout({
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            width: contentW,
            style: 'spacing: 12px; margin-top: auto; margin-bottom: 2px;'
        });

        this._backBtn = new St.Button({
            label: t('wizard_back', 'Назад', this._selectedLocale),
            can_focus: true,
            reactive: false,
            visible: false,
            opacity: 0
        });
        this._applyBackBtnStyle();
        this._backBtn.connect('clicked', () => {
            this._prevPage();
        });
        this._backBtn.connect('enter-event', () => {
            const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
            const bg = this._isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.10)';
            const border = this._isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.16)';
            this._backBtn.style = `padding: 7px 22px; border-radius: 9999px; font-size: 13px; font-weight: 500; ` +
                                  `background-color: ${bg}; color: ${titleColor}; border: 1px solid ${border};`;
        });
        this._backBtn.connect('leave-event', () => {
            this._applyBackBtnStyle();
        });
        this._bottomBar.add_child(this._backBtn);

        const spacer = new St.Widget({ x_expand: true });
        this._bottomBar.add_child(spacer);

        this._nextBtn = new St.Button({
            label: t('wizard_continue', 'Продовжити', this._selectedLocale),
            can_focus: true,
            reactive: true
        });
        this._applyNextBtnStyle();
        this._nextBtn.connect('clicked', () => {
            this._nextPage();
        });
        this._nextBtn.connect('enter-event', () => {
            const bg = this._accentColor || '#ff6a00';
            this._nextBtn.style = `padding: 7px 26px; border-radius: 9999px; font-size: 13px; font-weight: 600; ` +
                                  `background-color: ${bg}; color: #ffffff; border: none; box-shadow: 0 4px 16px ${hexToRgba(bg, 0.55)};`;
        });
        this._nextBtn.connect('leave-event', () => {
            this._applyNextBtnStyle();
        });
        this._bottomBar.add_child(this._nextBtn);
        mainLayout.add_child(this._bottomBar);

        this._dialogCard.add_child(mainLayout);
        this._overlay.add_child(this._dialogCard);


        this._currentPage = 1;
        this._renderCurrentPage();


        this._dialogCard.ease({
            opacity: 255,
            y: Math.round((stageH - cardH) / 2),
            duration: 400,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _selectLanguage(langCode) {
        this._selectedLocale = langCode;
        applyModpackSystemLocale(langCode, false);


        this._titleLabel.text = t('select_language', 'Виберіть мову', langCode);
        this._subtitleLabel.text = t('select_language_sub', 'Виберіть основну мову для інтерфейсу системи.', langCode);
        this._nextBtn.set_label(t('wizard_continue', 'Продовжити', langCode));
        this._backBtn.set_label(t('wizard_back', 'Назад', langCode));


        for (const [code, row] of this._langRowButtons.entries()) {
            const isSelected = (code === langCode);
            row.btn.style = isSelected
                ? 'background-color: #007aff; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;'
                : 'background-color: transparent; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;';
            row.label.style = isSelected
                ? 'font-size: 13px; font-weight: 600; color: #ffffff;'
                : `font-size: 13px; font-weight: 400; color: ${this._isDark ? '#e0e0e0' : '#1d1d1f'};`;
        }
    }

    _renderCurrentPage() {
        this._pageContainer.destroy_all_children();
        globalThis.macSetupWizardGestureHook = null;

        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const subColor = this._isDark ? '#a1a1a6' : '#86868b';
        const rowBg = this._isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.03)';
        const rowBorder = this._isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
        const curLang = this._selectedLocale;

        if (this._currentPage === 1) {

            this._headerIcon.gicon = null;
            this._headerIcon.icon_name = 'preferences-desktop-locale-symbolic';
            this._headerIcon.icon_size = 56;
            this._headerIcon.style = 'color: #007aff; margin-bottom: 10px;';

            this._titleLabel.text = t('select_language', 'Виберіть мову', curLang);
            this._subtitleLabel.text = t('select_language_sub', 'Виберіть основну мову для інтерфейсу системи.', curLang);

            this._backBtn.visible = false;
            this._backBtn.opacity = 0;
            this._backBtn.reactive = false;

            this._nextBtn.set_label(t('wizard_continue', 'Продовжити', curLang));
            this._applyNextBtnStyle();

            const centerWrapper = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true
            });

            const listW = 380;
            const listH = 260;
            const boxBg = this._isDark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.9)';
            const boxBorder = this._isDark ? 'rgba(0, 122, 255, 0.45)' : 'rgba(0, 122, 255, 0.55)';

            const listBox = new St.Widget({
                width: listW,
                height: listH,
                reactive: true,
                style: `background-color: ${boxBg}; border: 1.5px solid ${boxBorder}; border-radius: 10px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);`
            });

            const scrollView = new St.ScrollView({
                width: listW,
                height: listH,
                hscrollbar_policy: 1,
                vscrollbar_policy: 0,
                style: 'padding: 4px;'
            });

            const itemsBox = new St.BoxLayout({
                vertical: true,
                width: listW - 12,
                style: 'spacing: 1px;'
            });

            this._langRowButtons.clear();
            for (const item of this._sortedLanguages) {
                const isSelected = (item.code === this._selectedLocale);
                const rowBtn = new St.Button({
                    can_focus: true,
                    reactive: true,
                    x_align: Clutter.ActorAlign.FILL,
                    style: isSelected
                        ? 'background-color: #007aff; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;'
                        : 'background-color: transparent; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;'
                });

                const rowLabel = new St.Label({
                    text: item.native,
                    style: isSelected
                        ? 'font-size: 13px; font-weight: 600; color: #ffffff;'
                        : `font-size: 13px; font-weight: 400; color: ${this._isDark ? '#e0e0e0' : '#1d1d1f'};`
                });

                rowBtn.set_child(rowLabel);

                rowBtn.connect('clicked', () => {
                    this._selectLanguage(item.code);
                });

                rowBtn.connect('enter-event', () => {
                    if (item.code !== this._selectedLocale) {
                        rowBtn.style = `background-color: ${this._isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;`;
                    }
                });

                rowBtn.connect('leave-event', () => {
                    if (item.code !== this._selectedLocale) {
                        rowBtn.style = 'background-color: transparent; border-radius: 6px; padding: 6px 14px; margin: 2px 4px;';
                    }
                });

                this._langRowButtons.set(item.code, { btn: rowBtn, label: rowLabel });
                itemsBox.add_child(rowBtn);
            }

            scrollView.set_child(itemsBox);
            listBox.add_child(scrollView);
            centerWrapper.add_child(listBox);
            this._pageContainer.add_child(centerWrapper);

        } else if (this._currentPage === 2) {

            try {
                const iconFile = Gio.File.new_for_path(ICON_PATH);
                this._headerIcon.gicon = new Gio.FileIcon({ file: iconFile });
                this._headerIcon.icon_name = null;
                this._headerIcon.icon_size = 60;
                this._headerIcon.style = 'margin-bottom: 10px;';
            } catch (_) {
                this._headerIcon.gicon = null;
                this._headerIcon.icon_name = 'preferences-desktop-theme-symbolic';
                this._headerIcon.icon_size = 60;
                this._headerIcon.style = `color: ${this._accentColor}; margin-bottom: 10px;`;
            }

            const ver = getModpackVersion();
            this._titleLabel.text = tf('wizard_welcome_title', { version: ver }, `macW1Y ${ver} успішно встановлено`, curLang);
            this._subtitleLabel.text = t('wizard_welcome_sub', 'Оновлена конфігурація та нативні компоненти macW1Y Tahoe', curLang);

            this._backBtn.visible = true;
            this._backBtn.opacity = 255;
            this._backBtn.reactive = true;
            this._backBtn.set_label(t('wizard_back', 'Назад', curLang));
            this._applyBackBtnStyle();

            this._nextBtn.set_label(t('wizard_continue', 'Продовжити', curLang));
            this._applyNextBtnStyle();

            const page2Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL,
                style: 'spacing: 12px;'
            });

            const items = [
                {
                    icon: 'preferences-desktop-theme-symbolic',
                    title: t('wizard_feat1_title', 'macW1Y Tahoe Liquid Glass & SSOT', curLang),
                    desc: t('wizard_feat1_desc', 'Повний набір єдиних стилів GTK3/GTK4, плавні вікна, шрифти macW1Y Default та нативні віджети.', curLang)
                },
                {
                    icon: 'preferences-system-performance-symbolic',
                    title: t('wizard_feat2_title', 'Апаратне прискорення та відгук', curLang),
                    desc: t('wizard_feat2_desc', 'Стабільні 60-120 FPS, високошвидкісна частота опитування миші та плавна анімація інтерфейсу.', curLang)
                },
                {
                    icon: 'input-touchpad-symbolic',
                    title: t('wizard_feat3_title', 'Підтримка жестів macW1Y Trackpad', curLang),
                    desc: t('wizard_feat3_desc', 'Нативне 3-пальцеве переміщення вікон, 4-пальцеві віртуальні столи та розумний буфер обміну.', curLang)
                }
            ];

            for (const item of items) {
                const row = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `background-color: ${rowBg}; border: 1px solid ${rowBorder}; border-radius: 14px; padding: 14px 20px; spacing: 16px;`
                });

                const icon = new St.Icon({
                    icon_name: item.icon,
                    icon_size: 26,
                    style: `color: ${this._accentColor}; min-width: 30px;`
                });
                row.add_child(icon);

                const textBox = new St.BoxLayout({ vertical: true, x_expand: true });
                const rTitle = new St.Label({
                    text: item.title,
                    style: `font-size: 13px; font-weight: 600; color: ${titleColor};`
                });
                const rDesc = new St.Label({
                    text: item.desc,
                    style: `font-size: 11px; font-weight: 400; color: ${subColor}; margin-top: 3px;`
                });
                textBox.add_child(rTitle);
                textBox.add_child(rDesc);
                row.add_child(textBox);

                page2Box.add_child(row);
            }

            this._pageContainer.add_child(page2Box);

        } else if (this._currentPage === 3 && hasTouchpadGestures()) {

            this._headerIcon.gicon = null;
            this._headerIcon.icon_name = 'input-touchpad-symbolic';
            this._headerIcon.icon_size = 56;
            this._headerIcon.style = `color: ${this._accentColor}; margin-bottom: 10px;`;

            this._titleLabel.text = t('wizard_gesture_title', 'Жест переміщення трьома пальцями', curLang);
            this._subtitleLabel.text = t('wizard_gesture_sub', 'Спробуйте перемістити міні-вікно macW1Y всередині області трьома пальцями на тачпаді.', curLang);

            this._backBtn.visible = true;
            this._backBtn.opacity = 255;
            this._backBtn.reactive = true;
            this._backBtn.set_label(t('wizard_back', 'Назад', curLang));
            this._applyBackBtnStyle();

            this._nextBtn.set_label(t('wizard_continue', 'Продовжити', curLang));
            this._applyNextBtnStyle();

            const page3Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL
            });

            const areaW = this._cardW - 44;
            const areaH = 185;
            const areaBg = this._isDark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.04)';
            const areaBorder = this._isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';

            const testArea = new St.Widget({
                width: areaW,
                height: areaH,
                reactive: true,
                style: `background-color: ${areaBg}; border: 1px dashed ${areaBorder}; border-radius: 14px;`
            });

            const miniW = 240;
            const miniH = 125;
            let miniX = Math.round((areaW - miniW) / 2);
            let miniY = Math.round((areaH - miniH) / 2);

            this._miniWin = new St.Widget({
                name: 'macMiniPreviewWindow',
                x: miniX,
                y: miniY,
                width: miniW,
                height: miniH,
                reactive: true,
                style: `background-color: ${this._isDark ? '#323236' : '#ffffff'}; ` +
                       `border: 1px solid ${this._isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.10)'}; ` +
                       `border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.40);`
            });

            const miniLayout = new St.BoxLayout({
                vertical: true,
                width: miniW,
                height: miniH
            });

            const miniTitlebar = new St.BoxLayout({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.CENTER,
                height: 24,
                style: `padding: 6px 8px; border-bottom: 1px solid ${this._isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}; spacing: 5px;`
            });

            const tlRed = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #ff5f56;' });
            const tlYellow = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #ffbd2e;' });
            const tlGreen = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #27c93f;' });
            miniTitlebar.add_child(tlRed);
            miniTitlebar.add_child(tlYellow);
            miniTitlebar.add_child(tlGreen);

            const miniTitle = new St.Label({
                text: 'macW1Y Finder',
                x_expand: true,
                style: `font-size: 10px; font-weight: 600; color: ${titleColor}; text-align: center; margin-right: 24px;`
            });
            miniTitlebar.add_child(miniTitle);
            miniLayout.add_child(miniTitlebar);

            const miniBody = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                height: miniH - 24,
                style: 'spacing: 8px;'
            });
            const folderIcon = new St.Icon({
                icon_name: 'folder-symbolic',
                icon_size: 28,
                style: `color: ${this._accentColor};`
            });
            const folderLabel = new St.Label({
                text: t('bookmark_documents', 'Документи', curLang),
                style: `font-size: 11px; font-weight: 500; color: ${titleColor};`
            });
            miniBody.add_child(folderIcon);
            miniBody.add_child(folderLabel);
            miniLayout.add_child(miniBody);

            this._miniWin.add_child(miniLayout);

            this._miniWin.connect('button-press-event', () => {
                if (this._step2StatusLabel && !this._gestureSuccess) {
                    this._step2StatusLabel.text = t('wizard_gesture_warn', '⚠️ Переміщення працює виключно жестом трьох пальців по тачпаду!', curLang);
                    this._step2StatusLabel.style = 'font-size: 12px; font-weight: 600; color: #ff9f0a; margin-top: 8px;';
                }
                return Clutter.EVENT_PROPAGATE;
            });

            testArea.add_child(this._miniWin);
            page3Box.add_child(testArea);

            this._gestureDistance = 0;
            this._gestureSuccess = false;
            this._step2StatusLabel = new St.Label({
                text: t('wizard_gesture_wait', 'Очікування жесту: покладіть три пальці на тачпад і проведіть у будь-який бік', curLang),
                style: `font-size: 12px; font-weight: 500; color: ${subColor}; text-align: center; margin-top: 8px;`
            });
            page3Box.add_child(this._step2StatusLabel);

            globalThis.macSetupWizardGestureHook = (cmd, dx = 0, dy = 0) => {
                if (!this._miniWin) return false;

                if (cmd === 'DRAG_MOVE') {
                    miniX = Math.max(8, Math.min(areaW - miniW - 8, miniX + dx));
                    miniY = Math.max(8, Math.min(areaH - miniH - 8, miniY + dy));
                    this._miniWin.set_position(miniX, miniY);

                    this._gestureDistance += Math.hypot(dx, dy);
                    if (this._gestureDistance > 25 && !this._gestureSuccess) {
                        this._gestureSuccess = true;
                        if (this._step2StatusLabel) {
                            this._step2StatusLabel.text = t('wizard_gesture_success', '✓ Чудово! Жест трьома пальцями працює бездоганно.', curLang);
                            this._step2StatusLabel.style = 'font-size: 12px; font-weight: 600; color: #34c759; margin-top: 8px;';
                        }
                    }
                    return true;
                }
                if (cmd === 'DRAG_START' || cmd === 'DRAG_END') {
                    return true;
                }
                return false;
            };

            this._pageContainer.add_child(page3Box);

        } else {

            this._currentPage = 4;
            this._headerIcon.gicon = null;
            this._headerIcon.icon_name = 'emblem-ok-symbolic';
            this._headerIcon.icon_size = 56;
            this._headerIcon.style = 'color: #34c759; margin-bottom: 10px;';

            this._titleLabel.text = t('wizard_done_title', 'Цей Mac налаштовано', curLang);
            this._subtitleLabel.text = t('wizard_done_sub', 'Першопочаткове налаштування macW1Y завершено. Можна продовжувати роботу.', curLang);

            this._backBtn.visible = true;
            this._backBtn.opacity = 255;
            this._backBtn.reactive = true;
            this._backBtn.set_label(t('wizard_back', 'Назад', curLang));
            this._applyBackBtnStyle();

            this._nextBtn.set_label(t('wizard_start', 'Почати роботу', curLang));
            this._applyNextBtnStyle();

            const page4Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL,
                style: 'spacing: 12px;'
            });


            const banner = new St.BoxLayout({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'background-color: rgba(52, 199, 89, 0.12); border: 1px solid rgba(52, 199, 89, 0.30); border-radius: 14px; padding: 14px 20px; spacing: 16px;'
            });
            const checkIcon = new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 28,
                style: 'color: #34c759;'
            });
            banner.add_child(checkIcon);

            const bannerText = new St.BoxLayout({ vertical: true, x_expand: true });
            const bTitle = new St.Label({
                text: t('wizard_ready_title', 'Система готова до роботи', curLang),
                style: `font-size: 13px; font-weight: 600; color: ${titleColor};`
            });
            const bDesc = new St.Label({
                text: t('wizard_ready_desc', 'Усі системні розширення, нативні стилі та драйвери жестів синхронізовані.', curLang),
                style: `font-size: 11px; font-weight: 400; color: ${subColor}; margin-top: 2px;`
            });
            bannerText.add_child(bTitle);
            bannerText.add_child(bDesc);
            banner.add_child(bannerText);
            page4Box.add_child(banner);


            const tipsBox = new St.BoxLayout({
                vertical: true,
                style: `background-color: ${rowBg}; border: 1px solid ${rowBorder}; border-radius: 14px; padding: 14px 20px; spacing: 10px;`
            });
            const tipsTitle = new St.Label({
                text: t('wizard_tips_title', 'Корисні комбінації та підказки:', curLang),
                style: `font-size: 12px; font-weight: 600; color: ${titleColor}; margin-bottom: 4px;`
            });
            tipsBox.add_child(tipsTitle);

            const tips = [
                {
                    key: t('wizard_tip1_key', 'Ctrl + Пробіл', curLang),
                    desc: t('wizard_tip1_desc', 'Розумний швидкий пошук Spotlight', curLang)
                },
                {
                    key: t('wizard_tip2_key', 'F4 або Super', curLang),
                    desc: t('wizard_tip2_desc', 'Повноекранне меню програм Launchpad', curLang)
                },
                {
                    key: t('wizard_tip3_key', 'Правий верхній кут', curLang),
                    desc: t('wizard_tip3_desc', 'Швидкі перемикачі та Центр керування', curLang)
                }
            ];

            for (const tItem of tips) {
                const tr = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 12px;'
                });
                const kBadge = new St.Label({
                    text: tItem.key,
                    style: `font-size: 11px; font-weight: 600; color: ${this._accentColor}; background-color: ${hexToRgba(this._accentColor, this._isDark ? 0.20 : 0.12)}; padding: 3px 10px; border-radius: 6px;`
                });
                const dLabel = new St.Label({
                    text: tItem.desc,
                    style: `font-size: 11px; font-weight: 400; color: ${subColor};`
                });
                tr.add_child(kBadge);
                tr.add_child(dLabel);
                tipsBox.add_child(tr);
            }
            page4Box.add_child(tipsBox);

            this._pageContainer.add_child(page4Box);
        }
    }

    _nextPage() {
        if (this._currentPage === 1) {
            this._currentPage = 2;
            this._renderCurrentPage();
        } else if (this._currentPage === 2) {
            if (hasTouchpadGestures()) {
                this._currentPage = 3;
            } else {
                this._currentPage = 4;
            }
            this._renderCurrentPage();
        } else if (this._currentPage === 3) {
            this._currentPage = 4;
            this._renderCurrentPage();
        } else if (this._currentPage === 4) {
            this.finish();
        }
    }

    _prevPage() {
        if (this._currentPage === 4) {
            if (hasTouchpadGestures()) {
                this._currentPage = 3;
            } else {
                this._currentPage = 2;
            }
            this._renderCurrentPage();
        } else if (this._currentPage === 3) {
            this._currentPage = 2;
            this._renderCurrentPage();
        } else if (this._currentPage === 2) {
            this._currentPage = 1;
            this._renderCurrentPage();
        }
    }

    finish() {

        applyModpackSystemLocale(this._selectedLocale, true);


        setSetupWizardFlag(false);
        globalThis.macSetupWizardActive = false;
        globalThis.macSetupWizardGestureHook = null;

        if (this._dialogCard) {
            this._dialogCard.ease({
                opacity: 0,
                duration: 350,
                mode: Clutter.AnimationMode.EASE_IN_QUAD
            });
        }

        if (this._overlay) {
            this._overlay.ease({
                opacity: 0,
                duration: 450,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    this.destroy();
                }
            });
        } else {
            this.destroy();
        }


        this._restoreDesktop();
    }

    destroy() {
        globalThis.macSetupWizardActive = false;
        globalThis.macSetupWizardGestureHook = null;
        this._restoreDesktop();

        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._blurClone = null;
        this._welcomeBox = null;
        this._continueBtnBox = null;
        this._dialogCard = null;
        this._pageContainer = null;
        this._miniWin = null;
    }
}

let _wizardInstance = null;

export function getSetupWizardInstance() {
    if (!_wizardInstance) {
        _wizardInstance = new MacSetupWizard();
    }
    return _wizardInstance;
}

export function startSetupWizard(force = false) {
    const inst = getSetupWizardInstance();
    return inst.start({ force });
}

export function stopSetupWizard() {
    if (_wizardInstance) {
        _wizardInstance.finish();
    }
}
