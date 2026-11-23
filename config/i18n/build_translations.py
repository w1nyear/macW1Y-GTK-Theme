#!/usr/bin/env python3
"""
macW1Y 0.6 - Unified Internationalization (i18n/l10n) Build System.
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
// macW1Y 0.6 Unified Internationalization & Localization Runtime
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
        if (typeof globalThis._macModpackLocale === 'string' && globalThis._macModpackLocale) {
            const loc = globalThis._macModpackLocale.toLowerCase();
            if (TRANSLATIONS[loc]) return loc;
            const base = loc.split('_')[0].split('-')[0];
            if (TRANSLATIONS[base]) return base;
        }
    } catch (_) {}
    try {
        const file = `${GLib.get_home_dir()}/.config/mac-styling/locale`;
        if (GLib.file_test(file, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(file);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim().toLowerCase();
                if (s && TRANSLATIONS[s]) return s;
                const base = s.split('_')[0];
                if (base && TRANSLATIONS[base]) return base;
            }
        }
    } catch (_) {}
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

    # Write mac_i18n.js to the 4 target extension locations
    js_destinations = [
        os.path.join(REPO_ROOT, "extensions/appmenu@ChathurangaBW.github.io/mac_i18n.js"),
        os.path.join(REPO_ROOT, "extensions/blur-my-shell@aunetx/components/mac_i18n.js"),
        os.path.join(REPO_ROOT, "extensions/kiwi@kemma/apps/mac_i18n.js"),
        os.path.join(REPO_ROOT, "extensions/eval-helper@mactheme/mac_i18n.js"),
    ]
    for dest in js_destinations:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(js_template)
        print(f"-> Generated {dest}")

    # 3. Generate Python module bin/mac_i18n.py
    py_module = '''# SPDX-License-Identifier: GPL-3.0-or-later
# macW1Y 0.6 Unified i18n for Python utilities

import os
import locale
import json

RTL_LANGUAGES = set(''' + repr(list(RTL_LANGUAGES)) + ''')

TRANSLATIONS = ''' + json.dumps(TRANSLATIONS, ensure_ascii=False, indent=4) + '''

def get_locale():
    # Check ~/.config/mac-styling/locale first
    loc_file = os.path.expanduser("~/.config/mac-styling/locale")
    if os.path.exists(loc_file):
        try:
            with open(loc_file, "r", encoding="utf-8") as f:
                s = f.read().strip().lower()
                if s in TRANSLATIONS:
                    return s
                base = s.split('_')[0]
                if base in TRANSLATIONS:
                    return base
        except Exception:
            pass
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

def is_rtl(lang=None):
    if lang is None:
        lang = get_locale()
    if not lang:
        return False
    lang = lang.replace('-', '_').split('.')[0]
    base = lang.split('_')[0].lower()
    return lang.lower() in RTL_LANGUAGES or base in RTL_LANGUAGES

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

    c_keys = [
        "about", "apps", "back", "datetime", "forward", "multitasking", "region",
        "remote_desktop", "screenshot", "users", "settings",
        "power_mode", "power_performance", "power_performance_desc",
        "power_balanced", "power_balanced_desc", "power_saver", "power_saver_desc",
        "power_settings", "fan_speed", "fan_cpu", "fan_gpu", "fan_auto",
        "fan_dynamic_range", "fan_min_threshold", "fan_max_threshold", "no_fans_detected",
        "show_original", "show_original_desc", "uninstall_app", "uninstall_app_desc",
        "bookmarks_favorites", "bookmarks_locations", "bookmark_recent", "bookmark_home",
        "bookmark_applications", "bookmark_desktop", "bookmark_documents", "bookmark_downloads",
        "bookmark_pictures", "bookmark_movies", "bookmark_trash", "widgets", "mac_styling",
        "system_account", "storage_alert", "software_update_alert", "search",
        "ssot_restored_notification", "dock_edge_distance", "dock_edge_distance_desc",
        "dock_icon_size", "dock_icon_size_desc", "dock_size", "dock_size_desc",
        "dock_spacing", "dock_spacing_desc", "stage_manager", "light", "light_mode",
        "bench_glass_title", "bench_original_glass", "bench_refresh_rate", "bench_element_count",
        "bench_hint", "shape_rect", "shape_circle", "shape_capsule", "pause", "original", "elements_short"
    ]
    c_languages = sorted(TRANSLATIONS, key=lambda code: (-len(code), code))

    def c_string(value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'

    c_header = '''/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef MAC_I18N_H
#define MAC_I18N_H
#include <glib.h>
#include <string.h>
#define MAC_I18N_COUNT LOCALE_COUNT
static const char *MAC_I18N_LANGUAGES[] = { LANGUAGE_CODES };
static inline const char *mac_normalize_locale(const char *value) {
    if (!value) return NULL;
    gchar *normalized = g_ascii_strdown(value, -1);
    for (gchar *p = normalized; *p; p++) {
        if (*p == '-') *p = '_';
        if (*p == '.' || *p == '@') { *p = '\\0'; break; }
    }
    for (int i = 0; MAC_I18N_LANGUAGES[i] != NULL; i++) {
        const char *code = MAC_I18N_LANGUAGES[i];
        gsize length = strlen(code);
        if (g_str_has_prefix(normalized, code) && (normalized[length] == '\\0' || normalized[length] == '_')) {
            g_free(normalized);
            return code;
        }
    }
    g_free(normalized);
    return NULL;
}
static inline const char *mac_get_locale(void) {
    gchar *loc_path = g_build_filename(g_get_home_dir(), ".config", "mac-styling", "locale", NULL);
    if (g_file_test(loc_path, G_FILE_TEST_EXISTS)) {
        gchar *contents = NULL;
        if (g_file_get_contents(loc_path, &contents, NULL, NULL) && contents) {
            g_strstrip(contents);
            const char *locale = mac_normalize_locale(contents);
            g_free(contents);
            g_free(loc_path);
            if (locale) return locale;
        }
    }
    g_free(loc_path);
    const gchar * const *languages = g_get_language_names();
    if (languages) {
        for (int i = 0; languages[i] != NULL; i++) {
            if (!languages[i] || strcmp(languages[i], "C") == 0 || strcmp(languages[i], "POSIX") == 0) continue;
            const char *locale = mac_normalize_locale(languages[i]);
            if (locale) return locale;
        }
    }
    return "en";
}
typedef struct { const char *key; const char *values[MAC_I18N_COUNT]; } MacCKeyEntry;
static const MacCKeyEntry MAC_C_ENTRIES[] = {
'''
    for key in c_keys:
        values = [c_string(TRANSLATIONS.get(language, {}).get(key, TRANSLATIONS["en"].get(key, key))) for language in c_languages]
        c_header += f'    {{ {c_string(key)}, {{ {", ".join(values)} }} }},\n'
    c_header += f'    {{ NULL, {{ {", ".join(["NULL"] * len(c_languages))} }} }}\n}};\n'
    c_header += '''static inline const char *mac_tr(const char *key, const char *fallback) {
    const char *locale = mac_get_locale();
    for (int i = 0; MAC_C_ENTRIES[i].key != NULL; i++) {
        if (strcmp(MAC_C_ENTRIES[i].key, key) != 0) continue;
        for (int j = 0; j < MAC_I18N_COUNT; j++) {
            if (strcmp(locale, MAC_I18N_LANGUAGES[j]) == 0 && MAC_C_ENTRIES[i].values[j]) return MAC_C_ENTRIES[i].values[j];
        }
        break;
    }
    return fallback ? fallback : key;
}
#endif
'''
    c_header = c_header.replace("LOCALE_COUNT", str(len(c_languages)))
    c_header = c_header.replace("LANGUAGE_CODES", ", ".join(c_string(language) for language in c_languages) + ", NULL")
    c_dest1 = os.path.join(REPO_ROOT, "control-center/mac_i18n.h")
    c_dest2 = os.path.join(REPO_ROOT, "src/mac_i18n.h")
    c_dest3 = os.path.join(REPO_ROOT, "gnome-control-center-overlay/mac_i18n.h")
    with open(c_dest1, "w", encoding="utf-8") as f:
        f.write(c_header)
    with open(c_dest2, "w", encoding="utf-8") as f:
        f.write(c_header)
    with open(c_dest3, "w", encoding="utf-8") as f:
        f.write(c_header)
    print(f"-> Generated {c_dest1}, {c_dest2}, and {c_dest3}")
    print("i18n build completed successfully!")

if __name__ == "__main__":
    main()
