/* SPDX-License-Identifier: GPL-3.0-or-later */
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
    { "power_mode", "Режим живлення", "Power Mode", "Energiemodus", "Mode d'alimentation", "Modo de energía", "Tryb zasilania" },
    { "power_performance", "Швидкодія", "Performance", "Leistung", "Performances", "Rendimiento", "Wydajność" },
    { "power_performance_desc", "Висока швидкодія та споживання енергії", "High performance and power usage", "Hohe Leistung und Energieverbrauch", "Performances élevées et consommation accrue", "Alto rendimiento y mayor consumo", "Wysoka wydajność i zużycie energii" },
    { "power_balanced", "Баланс", "Balanced", "Ausgeglichen", "Équilibré", "Equilibrado", "Równowaga" },
    { "power_balanced_desc", "Стандартна швидкодія та споживання енергії", "Standard performance and power usage", "Standardleistung und Energieverbrauch", "Performances et consommation standards", "Rendimiento y consumo estándar", "Standardowa wydajność i zużycie energii" },
    { "power_saver", "Заощадження", "Power Saver", "Energiesparen", "Économie d'énergie", "Ahorro de energía", "Oszczędzanie energii" },
    { "power_saver_desc", "Знижена швидкодія та споживання енергії", "Reduced performance and power usage", "Reduzierte Leistung und Energieverbrauch", "Performances et consommation réduites", "Rendimiento y consumo reducidos", "Zmniejszona wydajność i zużycie energii" },
    { "power_settings", "Параметри живлення…", "Power Settings…", "Energieeinstellungen…", "Réglages d'alimentation…", "Ajustes de energía…", "Ustawienia zasilania…" },
    { "fan_speed", "Швидкість вентиляторів", "Fan Speed", "Lüftergeschwindigkeit", "Vitesse des ventilateurs", "Velocidad de ventiladores", "Prędkość wentylatorów" },
    { "fan_cpu", "Вентилятор процесора (CPU)", "Processor Fan (CPU)", "Prozessorlüfter (CPU)", "Ventilateur processeur (CPU)", "Ventilador del procesador (CPU)", "Wentylator procesora (CPU)" },
    { "fan_gpu", "Вентилятор відеокарти (GPU)", "Graphics Fan (GPU)", "Grafikkartenlüfter (GPU)", "Ventilateur graphique (GPU)", "Ventilador de gráficos (GPU)", "Wentylator karty graficznej (GPU)" },
    { "fan_auto", "Авторегулювання швидкості • {rpm} RPM", "Auto speed adjustment • {rpm} RPM", "Automatische Regelung • {rpm} RPM", "Régulation automatique • {rpm} RPM", "Ajuste automático • {rpm} RPM", "Automatyczna regulacja • {rpm} RPM" },
    { "fan_dynamic_range", "Динамічний діапазон авторегулювання швидкості", "Dynamic auto speed adjustment range", "Dynamischer Bereich der automatischen Regelung", "Plage dynamique de régulation automatique", "Rango dinámico de ajuste automático", "Dynamiczny zakres automatycznej regulacji" },
    { "fan_min_threshold", "Мін: тихий поріг", "Min: quiet threshold", "Min: leise Schwelle", "Min: seuil silencieux", "Mín: umbral silencioso", "Min: cichy próg" },
    { "fan_max_threshold", "Макс: пікове навантаження", "Max: peak load", "Max: Spitzenlast", "Max: charge de pointe", "Máx: carga máxima", "Maks: obciążenie szczytowe" },
    { "no_fans_detected", "У пристрої не виявлено керованих вентиляторів", "No controllable fans detected in device", "Keine steuerbaren Lüfter im Gerät gefunden", "Aucun ventilateur contrôlable détecté", "No se detectaron ventiladores controlables", "Nie wykryto sterowanych wentylatorów" },
    { "show_original", "Показати оригінал", "Show Original", "Original zeigen", "Afficher l'original", "Mostrar original", "Pokaż oryginał" },
    { "show_original_desc", "Відкрити каталог із оригінальним файлом програми", "Open directory containing original app file", "Verzeichnis mit Originaldatei der App öffnen", "Ouvrir le dossier contenant le fichier original de l'app", "Abrir la carpeta con el archivo original de la app", "Otwórz katalog z oryginalnym plikiem aplikacji" },
    { "uninstall_app", "Видалити програму з системи…", "Remove application from system…", "App vom System entfernen…", "Supprimer l'application du système…", "Eliminar aplicación del sistema…", "Usuń program z systemu…" },
    { "uninstall_app_desc", "Деінсталювати або видалити цей додаток", "Uninstall or remove this application", "Diese App deinstallieren oder entfernen", "Désinstaller ou supprimer cette application", "Desinstalar o eliminar esta aplicación", "Odinstaluj lub usuń tę aplikację" },
    { "bookmarks_favorites", "Вибрані", "Favorites", "Favoriten", "Favoris", "Favoritos", "Ulubione" },
    { "bookmarks_locations", "Місця", "Locations", "Orte", "Emplacements", "Ubicaciones", "Miejsca" },
    { "bookmark_recent", "Недавні", "Recent", "Zuletzt benutzt", "Récents", "Recientes", "Ostatnie" },
    { "bookmark_home", "Домівка", "Home", "Benutzerordner", "Dossier de départ", "Inicio", "Katalog domowy" },
    { "bookmark_applications", "Програми", "Applications", "Programme", "Applications", "Aplicaciones", "Programy" },
    { "bookmark_desktop", "Робочий стіл", "Desktop", "Schreibtisch", "Bureau", "Escritorio", "Biurko" },
    { "bookmark_documents", "Документи", "Documents", "Dokumente", "Documents", "Documentos", "Dokumenty" },
    { "bookmark_downloads", "Завантаження", "Downloads", "Downloads", "Téléchargements", "Descargas", "Pobrane" },
    { "bookmark_pictures", "Фото", "Pictures", "Bilder", "Images", "Imágenes", "Obrazy" },
    { "bookmark_movies", "Відеозаписи", "Movies", "Filme", "Vidéos", "Películas", "Wideo" },
    { "bookmark_trash", "Кошик", "Trash", "Papierkorb", "Corbeille", "Papelera", "Kosz" },
    { NULL, NULL, NULL, NULL, NULL, NULL, NULL }
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
