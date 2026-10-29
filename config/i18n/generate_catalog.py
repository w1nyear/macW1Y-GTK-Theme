#!/usr/bin/env python3
"""
Generate the macW1Y 0.4 System-Wide Localization Catalog.
Integrates the complete Ubuntu /usr/share/locale list, covering up to 194+ locales
divided into 4 distinct tiers:
- Tier 1: Verified Complete Primary (Ukrainian & English)
- Tier 2: Comprehensive Major Worldwide Languages (29 languages)
- Tier 3: RTL Languages with Bidirectional Support (ar, he, fa)
- Tier 4: Transparent English Fallback (remaining 160+ Ubuntu locales)
"""
import json
import os

from translations_data import TRANSLATIONS, RTL_LANGUAGES

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))

# Map of major language native names
NATIVE_NAMES = {
    "uk": ("Ukrainian", "Українська"),
    "en": ("English", "English"),
    "pl": ("Polish", "Polski"),
    "de": ("German", "Deutsch"),
    "fr": ("French", "Français"),
    "es": ("Spanish", "Español"),
    "pt": ("Portuguese", "Português"),
    "it": ("Italian", "Italiano"),
    "nl": ("Dutch", "Nederlands"),
    "cs": ("Czech", "Čeština"),
    "sk": ("Slovak", "Slovenčina"),
    "ro": ("Romanian", "Română"),
    "hu": ("Hungarian", "Magyar"),
    "bg": ("Bulgarian", "Български"),
    "sr": ("Serbian", "Српски"),
    "hr": ("Croatian", "Hrvatski"),
    "sl": ("Slovenian", "Slovenščina"),
    "lt": ("Lithuanian", "Lietuvių"),
    "lv": ("Latvian", "Latviešu"),
    "et": ("Estonian", "Eesti"),
    "be": ("Belarusian", "Беларуская"),
    "ru": ("Russian", "Русский"),
    "tr": ("Turkish", "Türkçe"),
    "hi": ("Hindi", "हिन्दी"),
    "bn": ("Bengali", "বাংলা"),
    "zh": ("Chinese Simplified", "简体中文"),
    "zh_tw": ("Chinese Traditional", "繁體中文"),
    "ja": ("Japanese", "日本語"),
    "ko": ("Korean", "한국어"),
    "th": ("Thai", "ไทย"),
    "vi": ("Vietnamese", "Tiếng Việt"),
    "ar": ("Arabic", "العربية"),
    "he": ("Hebrew", "עברית"),
    "fa": ("Persian", "فارسی"),
}

def main():
    system_locales = sorted([d for d in os.listdir("/usr/share/locale") if not d.startswith(".")])
    
    catalog = []
    seen = set()

    # 1. Add Tier 1 (uk, en)
    for code in ["uk", "en"]:
        name, native = NATIVE_NAMES[code]
        catalog.append({
            "code": code,
            "name": name,
            "native": native,
            "tier": 1,
            "rtl": False,
            "status": "complete_verified",
            "locales": [f"{code}_{code.upper()}.UTF-8", code]
        })
        seen.add(code)

    # 2. Add Tier 2 (Major worldwide languages)
    tier2_codes = [c for c in TRANSLATIONS.keys() if c not in seen and c not in RTL_LANGUAGES]
    for code in sorted(tier2_codes):
        name, native = NATIVE_NAMES.get(code, (code.upper(), code))
        catalog.append({
            "code": code,
            "name": name,
            "native": native,
            "tier": 2,
            "rtl": False,
            "status": "comprehensive",
            "locales": [f"{code}_{code.upper()}.UTF-8", code]
        })
        seen.add(code)

    # 3. Add Tier 3 (RTL)
    for code in sorted(RTL_LANGUAGES):
        name, native = NATIVE_NAMES.get(code, (code.upper(), code))
        catalog.append({
            "code": code,
            "name": name,
            "native": native,
            "tier": 3,
            "rtl": True,
            "status": "rtl_supported",
            "locales": [f"{code}_{code.upper()}.UTF-8", code]
        })
        seen.add(code)

    # 4. Add Tier 4 (System Ubuntu locales fallback)
    for loc in system_locales:
        base = loc.split("@")[0].split(".")[0].lower()
        if base in seen:
            continue
        code = base.split("_")[0]
        if code in seen:
            continue
        
        # Determine RTL
        is_rtl = code in {"ur", "ps", "sd", "ug", "yi"}
        catalog.append({
            "code": code,
            "name": code.upper(),
            "native": code,
            "tier": 4,
            "rtl": is_rtl,
            "status": "english_fallback",
            "locales": [loc]
        })
        seen.add(code)

    out_data = {
        "version": "0.4.0",
        "total_languages": len(catalog),
        "tiers": {
            "tier_1": {
                "name": "Verified Complete (Tier 1)",
                "description": "100% verified native coverage (Ukrainian & English)",
                "count": sum(1 for c in catalog if c["tier"] == 1),
                "languages": [c["code"] for c in catalog if c["tier"] == 1]
            },
            "tier_2": {
                "name": "Comprehensive Major Languages (Tier 2)",
                "description": "Full translation of all core macOS UI controls, navigation, and settings",
                "count": sum(1 for c in catalog if c["tier"] == 2),
                "languages": [c["code"] for c in catalog if c["tier"] == 2]
            },
            "tier_3": {
                "name": "RTL Languages with Bidirectional Support (Tier 3)",
                "description": "Arabic, Hebrew, Persian with RTL orientation support",
                "count": sum(1 for c in catalog if c["tier"] == 3),
                "languages": [c["code"] for c in catalog if c["tier"] == 3]
            },
            "tier_4": {
                "name": "Ubuntu Locales with English Fallback (Tier 4)",
                "description": "Transparent fallback to English with guaranteed stability",
                "count": sum(1 for c in catalog if c["tier"] == 4),
                "languages": [c["code"] for c in catalog if c["tier"] == 4]
            }
        },
        "catalog": catalog
    }

    out_file = os.path.join(REPO_ROOT, "config/i18n/catalog.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)

    print(f"Generated catalog with {len(catalog)} languages across 4 tiers in {out_file}")

if __name__ == "__main__":
    main()
