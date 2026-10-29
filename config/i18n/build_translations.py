#!/usr/bin/env python3
"""
macW1Y 0.4 - Unified Internationalization (i18n/l10n) Build System.
Compiles central translations into:
1. config/i18n/translations.json
2. extensions/appmenu@ChathurangaBW.github.io/mac_i18n.js
3. extensions/blur-my-shell@aunetx/components/mac_i18n.js
4. extensions/kiwi@kemma/apps/mac_i18n.js
5. control-center/mac_i18n.h (for libmac_settings.c)
6. src/mac_i18n.h (for mac_nautilus.c & mac_nautilus_menu.c)
7. bin/mac_i18n.py (for mac-styling-settings & mac-diagnostics)
"""
import json
import os
import sys

# Define base translations for all 34 languages
from translations_data import TRANSLATIONS, RTL_LANGUAGES

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))

def main():
    print(f"Building macW1Y i18n system for {len(TRANSLATIONS)} languages...")
    
    # 1. Output config/i18n/translations.json
    trans_json_path = os.path.join(REPO_ROOT, "config/i18n/translations.json")
    with open(trans_json_path, "w", encoding="utf-8") as f:
        json.dump(TRANSLATIONS, f, ensure_ascii=False, indent=2)
    print(f"-> Generated {trans_json_path}")

    # 2. Generate mac_i18n.js for GJS Extensions
    js_template = '''// SPDX-License-Identifier: GPL-3.0-or-later
// macW1Y 0.4 Unified Internationalization & Localization Runtime
// Automatically adapts to Ubuntu system locale and GNOME preferences.

import GLib from 'gi://GLib';

let _debugLocale = null;

export function setDebugLocale(locale) {
    _debugLocale = locale;
}

export const RTL_LANGUAGES = new Set(''' + json.dumps(list(RTL_LANGUAGES)) + ''');

export const TRANSLATIONS = ''' + json.dumps(TRANSLATIONS, ensure_ascii=False, indent=4) + ''';

/**
 * Get active system locale code (e.g. 'uk', 'en', 'pl', 'de', 'fr', etc.)
 * Checks GLib.get_language_names() in order of preference.
 */
export function getLocale() {
    if (_debugLocale) return _debugLocale;
    try {
        const langs = GLib.get_language_names();
        for (const l of langs) {
            if (!l || l === 'C' || l === 'POSIX') continue;
            const fullNorm = l.split('.')[0].replace('-', '_').toLowerCase();
            if (TRANSLATIONS[fullNorm]) {
                return fullNorm;
            }
            const code = fullNorm.split('_')[0];
            if (code && TRANSLATIONS[code]) {
                return code;
            }
        }
    } catch (_) {}
    return 'en';
}

/**
 * Returns true if the active language is right-to-left (e.g. Arabic, Hebrew, Persian).
 */
export function isRTL() {
    return RTL_LANGUAGES.has(getLocale());
}

/**
 * Translate a key into the active system language.
 * Falls back to English if the key is missing in active locale.
 */
export function t(key, fallback, overrideLocale = null) {
    const lang = overrideLocale || getLocale();
    if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key] !== undefined) {
        return TRANSLATIONS[lang][key];
    }
    if (TRANSLATIONS['en'] && TRANSLATIONS['en'][key] !== undefined) {
        return TRANSLATIONS['en'][key];
    }
    return fallback !== undefined ? fallback : key;
}

/**
 * Formatted translation with parameter replacement, e.g. {query}, {time}, {rpm}
 */
export function tf(key, params = {}, fallback, overrideLocale = null) {
    let str = t(key, fallback, overrideLocale);
    for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}
'''

    # Write mac_i18n.js to the 3 target extension locations
    js_destinations = [
        os.path.join(REPO_ROOT, "extensions/appmenu@ChathurangaBW.github.io/mac_i18n.js"),
        os.path.join(REPO_ROOT, "extensions/blur-my-shell@aunetx/components/mac_i18n.js"),
        os.path.join(REPO_ROOT, "extensions/kiwi@kemma/apps/mac_i18n.js"),
    ]
    for dest in js_destinations:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(js_template)
        print(f"-> Generated {dest}")

    # 3. Generate Python module bin/mac_i18n.py
    py_module = '''# SPDX-License-Identifier: GPL-3.0-or-later
# macW1Y 0.4 Unified i18n for Python utilities

import os
import locale
import json

RTL_LANGUAGES = set(''' + repr(list(RTL_LANGUAGES)) + ''')

TRANSLATIONS = ''' + json.dumps(TRANSLATIONS, ensure_ascii=False, indent=4) + '''

def get_locale():
    # Check env vars first
    for env in ('LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'):
        val = os.environ.get(env)
        if val:
            for part in val.split(':'):
                part = part.split('.')[0].replace('-', '_').lower()
                if part in TRANSLATIONS:
                    return part
                base = part.split('_')[0]
                if base in TRANSLATIONS:
                    return base
    try:
        loc = locale.getdefaultlocale()[0]
        if loc:
            norm = loc.replace('-', '_').lower()
            if norm in TRANSLATIONS:
                return norm
            base = norm.split('_')[0]
            if base in TRANSLATIONS:
                return base
    except Exception:
        pass
    return 'en'

def is_rtl():
    return get_locale() in RTL_LANGUAGES

def t(key, fallback=None, override_locale=None):
    lang = override_locale or get_locale()
    if lang in TRANSLATIONS and key in TRANSLATIONS[lang]:
        return TRANSLATIONS[lang][key]
    if 'en' in TRANSLATIONS and key in TRANSLATIONS['en']:
        return TRANSLATIONS['en'][key]
    return fallback if fallback is not None else key

def tf(key, params=None, fallback=None, override_locale=None):
    text = t(key, fallback, override_locale)
    if params:
        for k, v in params.items():
            text = text.replace(f"{{{k}}}", str(v))
    return text
'''
    py_dest = os.path.join(REPO_ROOT, "bin/mac_i18n.py")
    with open(py_dest, "w", encoding="utf-8") as f:
        f.write(py_module)
    print(f"-> Generated {py_dest}")

    # 4. Generate C Header for libmac_settings and nautilus
    # We output an efficient static lookup table for C
    c_keys = [
        "power_mode", "power_performance", "power_performance_desc",
        "power_balanced", "power_balanced_desc", "power_saver", "power_saver_desc",
        "power_settings", "fan_speed", "fan_cpu", "fan_gpu", "fan_auto",
        "fan_dynamic_range", "fan_min_threshold", "fan_max_threshold", "no_fans_detected",
        "show_original", "show_original_desc", "uninstall_app", "uninstall_app_desc",
        "bookmarks_favorites", "bookmarks_locations", "bookmark_recent", "bookmark_home",
        "bookmark_applications", "bookmark_desktop", "bookmark_documents", "bookmark_downloads",
        "bookmark_pictures", "bookmark_movies", "bookmark_trash"
    ]
    
    c_header = '''/* SPDX-License-Identifier: GPL-3.0-or-later */
/* macW1Y 0.4 C Localization Header */
#ifndef MAC_I18N_H
#define MAC_I18N_H

#include <glib.h>
#include <string.h>

static inline const char *mac_get_locale(void) {
    const gchar * const *langs = g_get_language_names();
    if (!langs) return "en";
    for (int i = 0; langs[i] != NULL; i++) {
        const char *l = langs[i];
        if (!l || strcmp(l, "C") == 0 || strcmp(l, "POSIX") == 0) continue;
        if (g_str_has_prefix(l, "uk")) return "uk";
        if (g_str_has_prefix(l, "pl")) return "pl";
        if (g_str_has_prefix(l, "de")) return "de";
        if (g_str_has_prefix(l, "fr")) return "fr";
        if (g_str_has_prefix(l, "es")) return "es";
        if (g_str_has_prefix(l, "it")) return "it";
        if (g_str_has_prefix(l, "pt")) return "pt";
        if (g_str_has_prefix(l, "cs")) return "cs";
        if (g_str_has_prefix(l, "tr")) return "tr";
        if (g_str_has_prefix(l, "zh")) return "zh";
        if (g_str_has_prefix(l, "ja")) return "ja";
        if (g_str_has_prefix(l, "ko")) return "ko";
        if (g_str_has_prefix(l, "ru")) return "ru";
        if (g_str_has_prefix(l, "be")) return "be";
        if (g_str_has_prefix(l, "nl")) return "nl";
        if (g_str_has_prefix(l, "sk")) return "sk";
        if (g_str_has_prefix(l, "ro")) return "ro";
        if (g_str_has_prefix(l, "hu")) return "hu";
        if (g_str_has_prefix(l, "bg")) return "bg";
        if (g_str_has_prefix(l, "sr")) return "sr";
        if (g_str_has_prefix(l, "hr")) return "hr";
        if (g_str_has_prefix(l, "sl")) return "sl";
        if (g_str_has_prefix(l, "ar")) return "ar";
        if (g_str_has_prefix(l, "he")) return "he";
        if (g_str_has_prefix(l, "fa")) return "fa";
        if (g_str_has_prefix(l, "en")) return "en";
    }
    return "en";
}

typedef struct {
    const char *key;
    const char *uk;
    const char *en;
    const char *de;
    const char *fr;
    const char *es;
    const char *pl;
} MacCKeyEntry;

static const MacCKeyEntry MAC_C_ENTRIES[] = {
'''
    for k in c_keys:
        uk_val = TRANSLATIONS.get("uk", {}).get(k, k).replace('"', '\\"')
        en_val = TRANSLATIONS.get("en", {}).get(k, k).replace('"', '\\"')
        de_val = TRANSLATIONS.get("de", {}).get(k, en_val).replace('"', '\\"')
        fr_val = TRANSLATIONS.get("fr", {}).get(k, en_val).replace('"', '\\"')
        es_val = TRANSLATIONS.get("es", {}).get(k, en_val).replace('"', '\\"')
        pl_val = TRANSLATIONS.get("pl", {}).get(k, en_val).replace('"', '\\"')
        c_header += f'    {{ "{k}", "{uk_val}", "{en_val}", "{de_val}", "{fr_val}", "{es_val}", "{pl_val}" }},\n'
    c_header += '''    { NULL, NULL, NULL, NULL, NULL, NULL, NULL }
};

static inline const char *mac_tr(const char *key, const char *fallback) {
    const char *loc = mac_get_locale();
    for (int i = 0; MAC_C_ENTRIES[i].key != NULL; i++) {
        if (strcmp(MAC_C_ENTRIES[i].key, key) == 0) {
            if (strcmp(loc, "uk") == 0 && MAC_C_ENTRIES[i].uk) return MAC_C_ENTRIES[i].uk;
            if (strcmp(loc, "de") == 0 && MAC_C_ENTRIES[i].de) return MAC_C_ENTRIES[i].de;
            if (strcmp(loc, "fr") == 0 && MAC_C_ENTRIES[i].fr) return MAC_C_ENTRIES[i].fr;
            if (strcmp(loc, "es") == 0 && MAC_C_ENTRIES[i].es) return MAC_C_ENTRIES[i].es;
            if (strcmp(loc, "pl") == 0 && MAC_C_ENTRIES[i].pl) return MAC_C_ENTRIES[i].pl;
            if (MAC_C_ENTRIES[i].en) return MAC_C_ENTRIES[i].en;
            break;
        }
    }
    return fallback ? fallback : key;
}

#endif /* MAC_I18N_H */
'''
    c_dest1 = os.path.join(REPO_ROOT, "control-center/mac_i18n.h")
    c_dest2 = os.path.join(REPO_ROOT, "src/mac_i18n.h")
    with open(c_dest1, "w", encoding="utf-8") as f:
        f.write(c_header)
    with open(c_dest2, "w", encoding="utf-8") as f:
        f.write(c_header)
    print(f"-> Generated {c_dest1} and {c_dest2}")
    print("i18n build completed successfully!")

if __name__ == "__main__":
    main()
