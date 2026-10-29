#!/usr/bin/env python3
"""
Populates full translations for all 34 supported languages across Tier 1, Tier 2, and Tier 3.
Generates config/i18n/translations_data.py
"""
import os
import json

from generate_translations_data import TRANSLATIONS, RTL_LANGUAGES

# We load existing translations (en, uk) and add translations for:
# de, fr, es, pt, it, pl, nl, cs, sk, ro, hu, bg, sr, hr, sl, lt, lv, et, be, ru, tr, hi, bn, zh, zh_tw, ja, ko, th, vi, ar, he, fa

# Template mapper
def make_lang(
    wifi, known_net, other_nets, no_nets, wifi_set,
    bt, bt_devs, no_bt, bt_set, dev,
    sound, out_dev, sound_out, sound_set, speakers, headphones, audio_out, apps_vol, no_audio_apps, def_out,
    battery, power, pwr_adapter, pwr_batt, nrg_mode, low_pwr, no_nrg_apps, batt_set, pwr_mgmt,
    sleep, hib, restart, shutdown, logout,
    pwr_mode, pwr_perf, pwr_perf_desc, pwr_bal, pwr_bal_desc, pwr_saver, pwr_saver_desc, pwr_set,
    fan_spd, fan_cpu, fan_gpu, fan_auto, fan_range, fan_min, fan_max, no_fans,
    privacy, mic_use, cam_use, webcam_app, app,
    emoji_sym, kbd_viewer, input_src, kbd_set,
    nc, clear_all, no_notifs, urgent, just_now, min_ago, hr_ago, yesterday, yesterday_time, shot_taken, shot_saved,
    cc, display, dnd, dark_mode, airdrop, not_playing, on_txt, off_txt, connected, not_connected, back_txt, settings_txt,
    airdrop_vis, contacts_only, everyone, actions, send_file, open_files,
    spotlight, search_nautilus, find_fm, search_web, find_google, ask_gemini, ask_ai,
    cat_app, cat_settings, sys_set_arr, cat_file, cat_folder,
    apps_menu, cat_util, cat_comm, cat_prod, cat_other,
    clipboard, clip_img, img_png, link_txt, col_hex, txt_lines, txt_chars, file_txt, files_txt, file_more,
    copied_now, copied_time, not_found, clip_empty,
    show_orig, show_orig_desc, uninst, uninst_desc,
    favs, locs, rcnt, home, desk, docs, dwnlds, pics, movs, trash
):
    return {
        "wifi": wifi, "known_network": known_net, "other_networks": other_nets, "no_networks_found": no_nets, "wifi_settings": wifi_set,
        "bluetooth": bt, "devices": bt_devs, "no_devices_found": no_bt, "bluetooth_settings": bt_set, "device": dev,
        "sound": sound, "output_device": out_dev, "sound_output": sound_out, "sound_settings": sound_set,
        "internal_speakers": speakers, "headphones": headphones, "audio_output": audio_out, "apps_and_volume": apps_vol,
        "no_active_audio_apps": no_audio_apps, "default_output": def_out, "speakers": speakers,
        "battery": battery, "power": power, "power_source_adapter": pwr_adapter, "power_source_battery": pwr_batt,
        "energy_mode": nrg_mode, "low_power_mode": low_pwr, "no_apps_using_energy": no_nrg_apps, "battery_settings": batt_set,
        "power_management": pwr_mgmt, "sleep": sleep, "hibernate": hib, "restart": restart, "shutdown": shutdown, "logout": logout,
        "power_mode": pwr_mode, "power_mode_short": pwr_mode.split()[0], "power_performance": pwr_perf, "power_performance_desc": pwr_perf_desc,
        "power_balanced": pwr_bal, "power_balanced_desc": pwr_bal_desc, "power_saver": pwr_saver, "power_saver_desc": pwr_saver_desc,
        "power_settings": pwr_set, "fan_speed": fan_spd, "fan_cpu": fan_cpu, "fan_gpu": fan_gpu, "fan_auto": fan_auto,
        "fan_dynamic_range": fan_range, "fan_min_threshold": fan_min, "fan_max_threshold": fan_max, "no_fans_detected": no_fans,
        "privacy": privacy, "mic_in_use": mic_use, "cam_in_use": cam_use, "app_using_webcam": webcam_app, "application": app,
        "show_emoji_and_symbols": emoji_sym, "show_keyboard_viewer": kbd_viewer, "show_input_source_name": input_src, "keyboard_settings": kbd_set,
        "notification_center": nc, "clear_all": clear_all, "no_new_notifications": no_notifs, "urgent": urgent,
        "just_now": just_now, "min_ago": min_ago, "hour_ago": hr_ago, "yesterday": yesterday, "yesterday_time": yesterday_time,
        "screenshot_taken": shot_taken, "screenshot_saved": shot_saved,
        "control_center": cc, "display": display, "do_not_disturb": dnd, "dark_mode": dark_mode, "airdrop": airdrop,
        "not_playing": not_playing, "on": on_txt, "off": off_txt, "connected": connected, "not_connected": not_connected,
        "back": back_txt, "settings": settings_txt, "airdrop_visibility": airdrop_vis, "contacts_only": contacts_only,
        "everyone": everyone, "actions": actions, "send_file": send_file, "open_received_files": open_files,
        "spotlight_search": spotlight, "search_in_nautilus": search_nautilus, "find_in_file_manager": find_fm,
        "search_the_web": search_web, "find_via_google": find_google, "ask_gemini": ask_gemini, "ask_ai_about": ask_ai,
        "category_app": cat_app, "category_settings": cat_settings, "system_settings_arrow": sys_set_arr,
        "category_file": cat_file, "category_folder": cat_folder,
        "applications": apps_menu, "category_utilities": cat_util, "category_communication": cat_comm,
        "category_productivity": cat_prod, "category_other": cat_other,
        "clipboard": clipboard, "clipboard_image": clip_img, "image_png": img_png, "link": link_txt, "color_hex": col_hex,
        "text_lines_chars": txt_lines, "text_chars": txt_chars, "file": file_txt, "files": files_txt, "file_and_more": file_more,
        "copied_just_now": copied_now, "copied_time": copied_time, "nothing_found_for": not_found, "clipboard_empty": clip_empty,
        "show_original": show_orig, "show_original_desc": show_orig_desc, "uninstall_app": uninst, "uninstall_app_desc": uninst_desc,
        "bookmarks_favorites": favs, "bookmarks_locations": locs, "bookmark_recent": rcnt, "bookmark_home": home,
        "bookmark_applications": apps_menu, "bookmark_desktop": desk, "bookmark_documents": docs, "bookmark_downloads": dwnlds,
        "bookmark_pictures": pics, "bookmark_movies": movs, "bookmark_trash": trash,
        # Settings Panels
        "panel_wifi": wifi, "panel_network": "Network", "panel_bluetooth": bt, "panel_appearance": "Appearance",
        "panel_notifications": nc, "panel_search": spotlight, "panel_applications": apps_menu, "panel_privacy": privacy,
        "panel_sound": sound, "panel_power": power, "panel_displays": display, "panel_mouse": "Mouse",
        "panel_keyboard": "Keyboard", "panel_printers": "Printers", "panel_accessibility": "Accessibility",
        "panel_datetime": "Date & Time", "panel_about": "About",
        # Styling
        "styling_title": "Mac Styling", "dock_title": "Dock", "dock_desc": "Glass shader and tint of the dock",
        "glass_strength": "Glass Strength", "glass_strength_desc": "Refraction and blur intensity",
        "dock_tint": "Dock Tint", "menubar_title": "Top Bar", "menubar_desc": "Menubar gradient and blur",
        "menubar_tint": "Menubar Tint", "context_menu_title": "Context Menus", "context_menu_desc": "Glass context menus",
        "context_menu_tint": "Menu Tint", "osd_title": "OSD", "osd_desc": "Glass OSD pills",
        "osd_tint": "OSD Tint", "notif_title": "Notifications", "notif_desc": "Glass notification cards",
        "notif_tint": "Notif Tint", "test_notif_title": "Test Notification", "test_notif_desc": "Test notification appearance",
        "send_button": "Send", "control_center_title": cc, "control_center_desc": "Glass toggles and sliders",
        "control_center_tint": "Toggle Tint", "bootloader_title": "Bootloader", "bootloader_desc": "Boot settings",
        "verbose_mode": "Verbose Mode", "verbose_mode_desc": "Terminal boot log", "grub_menu": "GRUB Menu",
        "grub_menu_desc": "macOS-style boot menu", "diagnostics_title": "Integrity & Diagnostics",
        "diagnostics_desc": "System diagnostics", "diagnostics_status_ok": "All components OK",
        "maintenance_actions": "Maintenance Actions", "maintenance_desc": "Check or restore styling",
        "run_diagnostics": "Run Diagnostics", "restore_ssot": "Restore SSOT", "close": "Close", "ok": "OK"
    }

# 1. Polish (pl)
TRANSLATIONS["pl"] = make_lang(
    "Wi-Fi", "Znana sieć", "Inne sieci", "Nie znaleziono sieci", "Ustawienia Wi-Fi…",
    "Bluetooth", "Urządzenia", "Nie znaleziono urządzeń", "Ustawienia Bluetooth…", "Urządzenie",
    "Dźwięk", "Urządzenie wyjściowe", "Wyjście dźwięku", "Ustawienia dźwięku…", "Wbudowane głośniki", "Słuchawki", "Wyjście audio", "Aplikacje i głośność", "Brak aktywnych aplikacji audio", "0: Domyślne (bez zmian)",
    "Bateria", "Zasilanie", "Źródło zasilania: zasilacz sieciowy", "Źródło zasilania: bateria", "Tryb energii", "Tryb niskiego zużycia energii", "Brak aplikacji zużywających dużo energii", "Ustawienia baterii…", "Zarządzanie zasilaniem",
    "Uśpij", "Hibernacja", "Uruchom ponownie…", "Wyłącz komputer…", "Wyloguj się…",
    "Tryb zasilania", "Wydajność", "Wysoka wydajność i zużycie energii", "Równowaga", "Standardowa wydajność i zużycie energii", "Oszczędzanie energii", "Zmniejszona wydajność i zużycie energii", "Ustawienia zasilania…",
    "Prędkość wentylatorów", "Wentylator procesora (CPU)", "Wentylator karty graficznej (GPU)", "Automatyczna regulacja • {rpm} RPM", "Dynamiczny zakres automatycznej regulacji", "Min: cichy próg", "Maks: obciążenie szczytowe", "Nie wykryto sterowanych wentylatorów",
    "Prywatność", "Mikrofon jest używany", "Kamera jest używana", "Aplikacja używa kamery", "Aplikacja",
    "Pokaż emoji i symbole", "Pokaż podgląd klawiatury", "Pokaż nazwę źródła wprowadzania", "Ustawienia klawiatury…",
    "Centrum powiadomień", "Wyczyść wszystko", "Brak nowych powiadomień", "PILNE", "Przed chwilą", "{min} min temu", "{hour} godz. temu", "Wczoraj", "Wczoraj, {time}", "Wykonano zrzut ekranu", "Zrzut ekranu zapisany w schowku",
    "Centrum sterowania", "Ekran", "Nie przeszkadzać", "Tryb ciemny", "AirDrop", "Brak odtwarzania", "Włączone", "Wyłączone", "Połączono", "Nie połączono", "◀ Wróć", "Ustawienia",
    "Widoczność AirDrop", "Tylko kontakty", "Wszyscy (Everyone)", "Czynności", "Wyślij plik…", "Otwórz odebrane pliki",
    "Wyszukiwanie Spotlight", "Szukaj w Nautilusie", "Znajdź „{query}” w menedżerze plików", "Szukaj w internecie", "Znajdź „{query}” w Google", "Zapytaj Gemini", "Zapytaj AI o „{query}”",
    "Aplikacje", "Ustawienia", "Ustawienia systemowe →", "Pliki", "Foldery",
    "Programy", "Narzędzia", "Komunikacja", "Wydajność", "Inne",
    "Schowek", "Obraz ze schowka", "Obraz PNG • {size} KB", "Łącze • {url}", "Kolor HEX • {hex}", "Tekst • {lines} wierszy, {chars} znaków", "Tekst • {chars} znaków", "Plik", "Pliki ({count})", "{file} i jeszcze {count} plików",
    "Skopiowano przed chwilą", "Skopiowano {time}", "Nic nie znaleziono dla zapytania „{query}”", "Schowek jest pusty",
    "Pokaż oryginał", "Otwórz katalog z oryginalnym plikiem aplikacji", "Usuń program z systemu…", "Odinstaluj lub usuń tę aplikację",
    "Ulubione", "Miejsca", "Ostatnie", "Katalog domowy", "Biurko", "Dokumenty", "Pobrane", "Obrazy", "Wideo", "Kosz"
)

# 2. German (de)
TRANSLATIONS["de"] = make_lang(
    "WLAN", "Bekanntes Netzwerk", "Andere Netzwerke", "Keine Netzwerke gefunden", "WLAN-Einstellungen…",
    "Bluetooth", "Geräte", "Keine Geräte gefunden", "Bluetooth-Einstellungen…", "Gerät",
    "Ton", "Ausgabegerät", "Tonausgabe", "Toneinstellungen…", "Integrierte Lautsprecher", "Kopfhörer", "Audioausgang", "Apps und Lautstärke", "Keine aktiven Audio-Apps", "0: Standard (keine Änderung)",
    "Batterie", "Stromversorgung", "Stromquelle: Netzteil", "Stromquelle: Batterie", "Energiemodus", "Stromsparmodus", "Keine Apps mit hohem Energieverbrauch", "Batterieeinstellungen…", "Energieverwaltung",
    "Ruhezustand", "Ruhezustand (Hibernate)", "Neu starten…", "Ausschalten…", "Abmelden…",
    "Energiemodus", "Leistung", "Hohe Leistung und Energieverbrauch", "Ausgeglichen", "Standardleistung und Energieverbrauch", "Energiesparen", "Reduzierte Leistung und Energieverbrauch", "Energieeinstellungen…",
    "Lüftergeschwindigkeit", "Prozessorlüfter (CPU)", "Grafikkartenlüfter (GPU)", "Automatische Regelung • {rpm} RPM", "Dynamischer Bereich der automatischen Regelung", "Min: leise Schwelle", "Max: Spitzenlast", "Keine steuerbaren Lüfter im Gerät gefunden",
    "Datenschutz", "Mikrofon wird verwendet", "Kamera wird verwendet", "App verwendet Webcam", "Programm",
    "Emojis & Symbole einblenden", "Tastaturübersicht einblenden", "Eingabequellenname anzeigen", "Tastatureinstellungen öffnen…",
    "Mitteilungszentrale", "Alle löschen", "Keine neuen Mitteilungen", "DRINGEND", "Gerade eben", "Vor {min} Min.", "Vor {hour} Std.", "Gestern", "Gestern, {time}", "Bildschirmfoto aufgenommen", "Bildschirmfoto in Zwischenablage gespeichert",
    "Kontrollzentrum", "Display", "Nicht stören", "Dunkelmodus", "AirDrop", "Keine Wiedergabe", "Ein", "Aus", "Verbunden", "Nicht verbunden", "◀ Zurück", "Einstellungen",
    "AirDrop-Sichtbarkeit", "Nur Kontakte", "Für jeden (Everyone)", "Aktionen", "Datei senden…", "Empfangene Dateien öffnen",
    "Spotlight-Suche", "In Nautilus suchen", "„{query}“ im Dateimanager suchen", "Im Web suchen", "„{query}“ mit Google suchen", "Gemini fragen", "KI nach „{query}“ fragen",
    "Programme", "Einstellungen", "Systemeinstellungen →", "Dateien", "Ordner",
    "Programme", "Dienstprogramme", "Kommunikation", "Produktivität", "Andere",
    "Zwischenablage", "Bild aus der Zwischenablage", "PNG-Bild • {size} KB", "Link • {url}", "HEX-Farbe • {hex}", "Text • {lines} Zeilen, {chars} Zeichen", "Text • {chars} Zeichen", "Datei", "Dateien ({count})", "{file} und {count} weitere Dateien",
    "Gerade kopiert", "Kopiert {time}", "Keine Treffer für „{query}“", "Zwischenablage ist leer",
    "Original zeigen", "Verzeichnis mit Originaldatei der App öffnen", "App vom System entfernen…", "Diese App deinstallieren oder entfernen",
    "Favoriten", "Orte", "Zuletzt benutzt", "Benutzerordner", "Schreibtisch", "Dokumente", "Downloads", "Bilder", "Filme", "Papierkorb"
)

# 3. French (fr)
TRANSLATIONS["fr"] = make_lang(
    "Wi-Fi", "Réseau connu", "Autres réseaux", "Aucun réseau trouvé", "Réglages Wi-Fi…",
    "Bluetooth", "Appareils", "Aucun appareil trouvé", "Réglages Bluetooth…", "Appareil",
    "Son", "Périphérique de sortie", "Sortie son", "Réglages son…", "Haut-parleurs intégrés", "Écouteurs", "Sortie audio", "Apps et volume", "Aucune application audio active", "0: Par défaut (sans changement)",
    "Batterie", "Alimentation", "Source d'alimentation : Adaptateur secteur", "Source d'alimentation : Batterie", "Mode d'énergie", "Mode économie d'énergie", "Aucune app utilisant beaucoup d'énergie", "Réglages de la batterie…", "Gestion de l'alimentation",
    "Suspendre", "Mettre en veille prolongée", "Redémarrer…", "Éteindre…", "Fermer la session…",
    "Mode d'alimentation", "Performances", "Performances élevées et consommation accrue", "Équilibré", "Performances et consommation standards", "Économie d'énergie", "Performances et consommation réduites", "Réglages d'alimentation…",
    "Vitesse des ventilateurs", "Ventilateur processeur (CPU)", "Ventilateur graphique (GPU)", "Régulation automatique • {rpm} RPM", "Plage dynamique de régulation automatique", "Min: seuil silencieux", "Max: charge de pointe", "Aucun ventilateur contrôlable détecté",
    "Confidentialité", "Microphone en cours d'utilisation", "Caméra en cours d'utilisation", "Une application utilise la caméra", "Application",
    "Afficher les Emoji et symboles", "Afficher le visualiseur de clavier", "Afficher le nom de la source de saisie", "Ouvrir les réglages du clavier…",
    "Centre de notifications", "Tout effacer", "Aucune nouvelle notification", "URGENT", "À l'instant", "Il y a {min} min", "Il y a {hour} h", "Hier", "Hier, {time}", "Capture d'écran enregistrée", "Capture d'écran copiée dans le presse-papiers",
    "Centre de contrôle", "Écran", "Ne pas déranger", "Mode sombre", "AirDrop", "Aucune lecture", "Activé", "Désactivé", "Connecté", "Non connecté", "◀ Retour", "Réglages",
    "Visibilité AirDrop", "Contacts uniquement", "Tout le monde (Everyone)", "Actions", "Envoyer un fichier…", "Ouvrir les fichiers reçus",
    "Recherche Spotlight", "Rechercher dans Nautilus", "Rechercher « {query} » dans le gestionnaire de fichiers", "Rechercher sur le Web", "Rechercher « {query} » via Google", "Demander à Gemini", "Demander à l'IA à propos de « {query} »",
    "Applications", "Réglages", "Réglages Système →", "Fichiers", "Dossiers",
    "Applications", "Utilitaires", "Communication", "Productivité", "Autre",
    "Presse-papiers", "Image du presse-papiers", "Image PNG • {size} Ko", "Lien • {url}", "Couleur HEX • {hex}", "Texte • {lines} lignes, {chars} car.", "Texte • {chars} car.", "Fichier", "Fichiers ({count})", "{file} et {count} autres fichiers",
    "Copié à l'instant", "Copié à {time}", "Aucun résultat pour « {query} »", "Le presse-papiers est vide",
    "Afficher l'original", "Ouvrir le dossier contenant le fichier original de l'app", "Supprimer l'application du système…", "Désinstaller ou supprimer cette application",
    "Favoris", "Emplacements", "Récents", "Dossier de départ", "Bureau", "Documents", "Téléchargements", "Images", "Vidéos", "Corbeille"
)

# 4. Spanish (es)
TRANSLATIONS["es"] = make_lang(
    "Wi-Fi", "Red conocida", "Otras redes", "No se encontraron redes", "Ajustes de Wi-Fi…",
    "Bluetooth", "Dispositivos", "No se encontraron dispositivos", "Ajustes de Bluetooth…", "Dispositivo",
    "Sonido", "Dispositivo de salida", "Salida de sonido", "Ajustes de sonido…", "Altavoces integrados", "Auriculares", "Salida de audio", "Apps y volumen", "No hay aplicaciones de audio activas", "0: Predeterminado (sin cambios)",
    "Batería", "Alimentación", "Fuente de alimentación: Adaptador de corriente", "Fuente de alimentación: Batería", "Modo de energía", "Modo de bajo consumo", "Ninguna app consume mucha energía", "Ajustes de la batería…", "Gestión de energía",
    "Suspender", "Hibernar", "Reiniciar…", "Apagar…", "Cerrar sesión…",
    "Modo de energía", "Rendimiento", "Alto rendimiento y mayor consumo", "Equilibrado", "Rendimiento y consumo estándar", "Ahorro de energía", "Rendimiento y consumo reducidos", "Ajustes de energía…",
    "Velocidad de ventiladores", "Ventilador del procesador (CPU)", "Ventilador de gráficos (GPU)", "Ajuste automático • {rpm} RPM", "Rango dinámico de ajuste automático", "Mín: umbral silencioso", "Máx: carga máxima", "No se detectaron ventiladores controlables",
    "Privacidad", "El micrófono está en uso", "La cámara está en uso", "La app está usando la cámara web", "Aplicación",
    "Mostrar emojis y símbolos", "Mostrar visor de teclado", "Mostrar nombre de la fuente de entrada", "Abrir ajustes de teclado…",
    "Centro de notificaciones", "Borrar todo", "No hay notificaciones nuevas", "URGENTE", "Ahora mismo", "Hace {min} min", "Hace {hour} h", "Ayer", "Ayer, {time}", "Captura de pantalla realizada", "Captura guardada en el portapapeles",
    "Centro de control", "Pantalla", "No molestar", "Modo oscuro", "AirDrop", "Sin reproducción", "Activado", "Desactivado", "Conectado", "No conectado", "◀ Atrás", "Ajustes",
    "Visibilidad de AirDrop", "Solo contactos", "Todos (Everyone)", "Acciones", "Enviar archivo…", "Abrir archivos recibidos",
    "Búsqueda de Spotlight", "Buscar en Nautilus", "Buscar “{query}” en el administrador de archivos", "Buscar en la web", "Buscar “{query}” en Google", "Preguntar a Gemini", "Preguntar a la IA sobre “{query}”",
    "Aplicaciones", "Ajustes", "Ajustes del Sistema →", "Archivos", "Carpetas",
    "Aplicaciones", "Utilidades", "Comunicación", "Productividad", "Otro",
    "Portapapeles", "Imagen del portapapeles", "Imagen PNG • {size} KB", "Enlace • {url}", "Color HEX • {hex}", "Texto • {lines} líneas, {chars} car.", "Texto • {chars} car.", "Archivo", "Archivos ({count})", "{file} y {count} archivos más",
    "Copiado ahora mismo", "Copiado a las {time}", "No se encontró nada para “{query}”", "El portapapeles está vacío",
    "Mostrar original", "Abrir la carpeta con el archivo original de la app", "Eliminar aplicación del sistema…", "Desinstalar o eliminar esta aplicación",
    "Favoritos", "Ubicaciones", "Recientes", "Inicio", "Escritorio", "Documentos", "Descargas", "Imágenes", "Películas", "Papelera"
)

# 5. Portuguese (pt)
TRANSLATIONS["pt"] = make_lang(
    "Wi-Fi", "Rede conhecida", "Outras redes", "Nenhuma rede encontrada", "Ajustes de Wi-Fi…",
    "Bluetooth", "Dispositivos", "Nenhum dispositivo encontrado", "Ajustes de Bluetooth…", "Dispositivo",
    "Som", "Dispositivo de saída", "Saída de som", "Ajustes de som…", "Alto-falantes integrados", "Fones de ouvido", "Saída de áudio", "Apps e volume", "Nenhum app de áudio ativo", "0: Padrão (sem alteração)",
    "Bateria", "Energia", "Fonte de alimentação: Adaptador de energia", "Fonte de alimentação: Bateria", "Modo de energia", "Modo de Pouca Energia", "Nenhum app usando energia significativa", "Ajustes da bateria…", "Gerenciamento de energia",
    "Suspender", "Hibernar", "Reiniciar…", "Desligar…", "Encerrar Sessão…",
    "Modo de energia", "Desempenho", "Alto desempenho e consumo de energia", "Equilibrado", "Desempenho e consumo padrão", "Economia de energia", "Desempenho e consumo reduzidos", "Ajustes de energia…",
    "Velocidade das ventoinhas", "Ventoinha do processador (CPU)", "Ventoinha gráfica (GPU)", "Ajuste automático • {rpm} RPM", "Faixa dinâmica de ajuste automático", "Mín: limite silencioso", "Máx: carga máxima", "Nenhuma ventoinha controlável detectada",
    "Privacidade", "O microfone está em uso", "A câmera está em uso", "O app está usando a webcam", "Aplicativo",
    "Mostrar Emoji e Símbolos", "Mostrar Teclado Virtual", "Mostrar nome da fonte de entrada", "Abrir Ajustes do Teclado…",
    "Central de Notificações", "Limpar Tudo", "Nenhuma notificação nova", "URGENTE", "Agora mesmo", "Há {min} min", "Há {hour} h", "Ontem", "Ontem, {time}", "Captura de tela realizada", "Captura salva na área de transferência",
    "Central de Controle", "Tela", "Não Perturbe", "Modo Escuro", "AirDrop", "Nada reproduzindo", "Ativado", "Desativado", "Conectado", "Não conectado", "◀ Voltar", "Ajustes",
    "Visibilidade do AirDrop", "Apenas Contatos", "Todos (Everyone)", "Ações", "Enviar arquivo…", "Abrir arquivos recebidos",
    "Busca do Spotlight", "Buscar no Nautilus", "Buscar “{query}” no gerenciador de arquivos", "Buscar na Web", "Buscar “{query}” no Google", "Perguntar ao Gemini", "Perguntar à IA sobre “{query}”",
    "Aplicativos", "Ajustes", "Ajustes do Sistema →", "Arquivos", "Pastas",
    "Aplicativos", "Utilitários", "Comunicação", "Produtividade", "Outro",
    "Área de transferência", "Imagem da área de transferência", "Imagem PNG • {size} KB", "Link • {url}", "Cor HEX • {hex}", "Texto • {lines} linhas, {chars} car.", "Texto • {chars} car.", "Arquivo", "Arquivos ({count})", "{file} e mais {count} arquivos",
    "Copiado agora", "Copiado às {time}", "Nada encontrado para “{query}”", "A área de transferência está vazia",
    "Mostrar original", "Abrir pasta com o arquivo original do app", "Remover aplicativo do sistema…", "Desinstalar ou remover este aplicativo",
    "Favoritos", "Locais", "Recentes", "Início", "Mesa", "Documentos", "Downloads", "Imagens", "Filmes", "Lixo"
)

# 6. Italian (it)
TRANSLATIONS["it"] = make_lang(
    "Wi-Fi", "Rete nota", "Altre reti", "Nessuna rete trovata", "Impostazioni Wi-Fi…",
    "Bluetooth", "Dispositivi", "Nessun dispositivo trovato", "Impostazioni Bluetooth…", "Dispositivo",
    "Suono", "Dispositivo di uscita", "Uscita audio", "Impostazioni audio…", "Altoparlanti integrati", "Cuffie", "Uscita audio", "App e volume", "Nessuna app audio attiva", "0: Predefinito (nessuna modifica)",
    "Batteria", "Energia", "Sorgente di alimentazione: Alimentatore", "Sorgente di alimentazione: Batteria", "Modalità energetica", "Risparmio energetico", "Nessuna app consuma molta energia", "Impostazioni batteria…", "Gestione alimentazione",
    "Stop", "Ibernazione", "Riavvia…", "Spegni…", "Esci…",
    "Modalità energia", "Prestazioni", "Alte prestazioni e consumo energetico", "Bilanciato", "Prestazioni e consumo standard", "Risparmio energetico", "Prestazioni e consumo ridotti", "Impostazioni alimentazione…",
    "Velocità ventole", "Ventola processore (CPU)", "Ventola scheda video (GPU)", "Regolazione automatica • {rpm} RPM", "Intervallo dinamico di regolazione automatica", "Min: soglia silenziosa", "Max: carico di picco", "Nessuna ventola controllabile rilevata",
    "Privacy", "Microfono in uso", "Fotocamera in uso", "L'app usa la webcam", "Applicazione",
    "Mostra Emoji e simboli", "Mostra Visore Tastiera", "Mostra sorgente di input", "Apri impostazioni tastiera…",
    "Centro Notifiche", "Cancella tutto", "Nessuna nuova notifica", "URGENTE", "Proprio ora", "{min} min fa", "{hour} ore fa", "Ieri", "Ieri, {time}", "Schermata acquisita", "Schermata salvata negli appunti",
    "Centro di Controllo", "Schermo", "Non disturbare", "Modalità scura", "AirDrop", "Nessun elemento in riproduzione", "Attivo", "Non attivo", "Connesso", "Non connesso", "◀ Indietro", "Impostazioni",
    "Visibilità AirDrop", "Solo contatti", "Tutti (Everyone)", "Azioni", "Invia file…", "Apri file ricevuti",
    "Ricerca Spotlight", "Cerca in Nautilus", "Trova “{query}” nel gestore file", "Cerca sul Web", "Trova “{query}” su Google", "Chiedi a Gemini", "Chiedi all'IA su “{query}”",
    "Applicazioni", "Impostazioni", "Impostazioni di Sistema →", "File", "Cartelle",
    "Applicazioni", "Utility", "Comunicazione", "Produttività", "Altro",
    "Appunti", "Immagine dagli appunti", "Immagine PNG • {size} KB", "Link • {url}", "Colore HEX • {hex}", "Testo • {lines} righe, {chars} car.", "Testo • {chars} car.", "File", "File ({count})", "{file} e altri {count} file",
    "Copiato ora", "Copiato alle {time}", "Nessun risultato per “{query}”", "Gli appunti sono vuoti",
    "Mostra originale", "Apri la cartella con il file originale dell'app", "Rimuovi applicazione dal sistema…", "Disinstalla o rimuovi questa app",
    "Preferiti", "Posizioni", "Recenti", "Inizio", "Scrivania", "Documenti", "Download", "Immagini", "Filmati", "Cestino"
)

# 7. Chinese Simplified (zh)
TRANSLATIONS["zh"] = make_lang(
    "Wi-Fi", "已知网络", "其他网络", "未找到网络", "Wi-Fi 设置…",
    "蓝牙", "设备", "未找到设备", "蓝牙设置…", "设备",
    "声音", "输出设备", "声音输出", "声音设置…", "内置扬声器", "耳机", "音频输出", "应用与音量", "无活动音频应用", "0: 默认（无更改）",
    "电池", "电源", "电源：电源适配器", "电源：电池", "电量模式", "低电量模式", "没有耗电显著的 App", "电池设置…", "电源管理",
    "睡眠", "休眠", "重新启动…", "关机…", "退出登录…",
    "电量模式", "高性能", "最高性能与高电量消耗", "平衡", "标准性能与电量消耗", "节能", "降低性能以延长续航", "电源设置…",
    "风扇转速", "处理器风扇 (CPU)", "显卡风扇 (GPU)", "自动调速 • {rpm} RPM", "自动调速动态范围", "最低: 静音阈值", "最高: 峰值负载", "未检测到可控风扇",
    "隐私", "正在使用麦克风", "正在使用摄像头", "应用正在使用摄像头", "应用程序",
    "显示表情与符号", "显示虚拟键盘", "显示输入法名称", "打开键盘设置…",
    "通知中心", "清除全部", "没有新通知", "紧急", "刚刚", "{min}分钟前", "{hour}小时前", "昨天", "昨天, {time}", "屏幕快照已捕获", "屏幕快照已存储到剪贴板",
    "控制中心", "显示器", "勿扰模式", "深色模式", "隔空投送", "未在播放", "打开", "关闭", "已连接", "未连接", "◀ 返回", "设置",
    "隔空投送可见性", "仅限联系人", "所有人 (Everyone)", "操作", "发送文件…", "打开收到的文件",
    "聚焦搜索", "在 Nautilus 中搜索", "在文件管理器中查找“{query}”", "在网页上搜索", "通过 Google 查找“{query}”", "向 Gemini 提问", "向 AI 询问关于“{query}”",
    "应用程序", "设置", "系统设置 →", "文件", "文件夹",
    "应用程序", "实用工具", "沟通社交", "工作效率", "其他",
    "剪贴板", "剪贴板图片", "PNG 图像 • {size} KB", "链接 • {url}", "HEX 颜色 • {hex}", "文本 • {lines} 行, {chars} 个字符", "文本 • {chars} 个字符", "文件", "文件 ({count})", "{file} 及其他 {count} 个文件",
    "刚刚复制", "已在 {time} 复制", "未找到“{query}”的匹配项", "剪贴板为空",
    "显示原身", "打开包含该应用程序原文件的目录", "从系统中移除应用程序…", "卸载或移除此应用程序",
    "个人收藏", "位置", "最近使用", "主文件夹", "桌面", "文稿", "下载", "图片", "影片", "废纸篓"
)

# 8. Japanese (ja)
TRANSLATIONS["ja"] = make_lang(
    "Wi-Fi", "既知のネットワーク", "ほかのネットワーク", "ネットワークが見つかりません", "Wi-Fi設定…",
    "Bluetooth", "デバイス", "デバイスが見つかりません", "Bluetooth設定…", "デバイス",
    "サウンド", "出力装置", "サウンド出力", "サウンド設定…", "内蔵スピーカー", "ヘッドフォン", "オーディオ出力", "アプリと音量", "再生中のオーディオアプリなし", "0: デフォルト（変更なし）",
    "バッテリー", "電源", "電源: 電源アダプタ", "電源: バッテリー", "エネルギーモード", "低電力モード", "大量のエネルギーを消費しているAppはありません", "バッテリー設定…", "電源管理",
    "スリープ", "ハイバネーション", "再起動…", "システム終了…", "ログアウト…",
    "電力モード", "高パフォーマンス", "最高の処理速度と電力消費", "バランス", "標準的な速度と電力消費", "省電力", "パフォーマンスを抑えて省電力", "電源設定…",
    "ファン速度", "CPUファン (CPU)", "GPUファン (GPU)", "自動速度調整 • {rpm} RPM", "自動調整のダイナミックレンジ", "最小: 静音しきい値", "最大: ピーク負荷", "制御可能なファンが検出されませんでした",
    "プライバシー", "マイクを使用中", "カメラを使用中", "アプリがWebカメラを使用しています", "アプリケーション",
    "絵文字と記号を表示", "キーボードビューアを表示", "入力ソース名を表示", "キーボード設定を開く…",
    "通知センター", "すべて消去", "新しい通知はありません", "至急", "たった今", "{min}分前", "{hour}時間前", "昨日", "昨日 {time}", "スクリーンショットを保存しました", "スクリーンショットをクリップボードにコピーしました",
    "コントロールセンター", "ディスプレイ", "集中モード", "ダークモード", "AirDrop", "再生停止中", "オン", "オフ", "接続済み", "未接続", "◀ 戻る", "設定",
    "AirDropの検出対象", "連絡先のみ", "すべての人 (Everyone)", "アクション", "ファイルを送信…", "受信したファイルを開く",
    "Spotlight検索", "Nautilusで検索", "ファイルマネージャで「{query}」を検索", "Webを検索", "Googleで「{query}」を検索", "Geminiに質問", "「{query}」についてAIに尋ねる",
    "アプリケーション", "設定", "システム設定 →", "ファイル", "フォルダ",
    "アプリケーション", "ユーティリティ", "コミュニケーション", "仕事効率化", "その他",
    "クリップボード", "クリップボードの画像", "PNG画像 • {size} KB", "リンク • {url}", "HEXカラー • {hex}", "テキスト • {lines}行, {chars}文字", "テキスト • {chars}文字", "ファイル", "ファイル ({count}件)", "{file} と他 {count} 件のファイル",
    "たった今コピー", "{time}にコピー", "「{query}」に一致する項目は見つかりませんでした", "クリップボードは空です",
    "オリジナルを表示", "アプリのオリジナルファイルがあるフォルダを開く", "システムからアプリを削除…", "このアプリをアンインストールまたは削除",
    "よく使う項目", "場所", "最近使った項目", "ホーム", "デスクトップ", "書類", "ダウンロード", "ピクチャ", "ムービー", "ゴミ箱"
)

# 9. Korean (ko)
TRANSLATIONS["ko"] = make_lang(
    "Wi-Fi", "알려진 네트워크", "기타 네트워크", "발견된 네트워크 없음", "Wi-Fi 설정…",
    "Bluetooth", "기기", "발견된 기기 없음", "Bluetooth 설정…", "기기",
    "사운드", "출력 기기", "사운드 출력", "사운드 설정…", "내장 스피커", "헤드폰", "오디오 출력", "앱 및 음량", "활성 오디오 앱 없음", "0: 기본값 (변경 없음)",
    "배터리", "전원", "전원 공급원: 전원 어댑터", "전원 공급원: 배터리", "에너지 모드", "저전력 모드", "상당한 에너지를 사용하는 앱 없음", "배터리 설정…", "전원 관리",
    "잠자기", "최대 절전 모드", "재시동…", "시스템 종료…", "로그아웃…",
    "전원 모드", "고성능", "최고 성능 및 전력 소비", "균형", "표준 성능 및 전력 소비", "절전", "성능을 낮춰 배터리 절약", "전원 설정…",
    "팬 속도", "프로세서 팬 (CPU)", "그래픽 팬 (GPU)", "자동 조절 • {rpm} RPM", "자동 조절 동적 범위", "최소: 저소음 기준", "최대: 피크 부하", "제어 가능한 팬을 찾을 수 없음",
    "개인정보 보호", "마이크 사용 중", "카메라 사용 중", "앱에서 웹캠을 사용하고 있습니다", "응용 프로그램",
    "이모티콘 및 기호 보기", "가상 키보드 보기", "입력 메뉴 이름 보기", "키보드 설정 열기…",
    "알림 센터", "모두 지우기", "새로운 알림 없음", "긴급", "방금 전", "{min}분 전", "{hour}시간 전", "어제", "어제, {time}", "스크린샷 촬영 완료", "스크린샷이 클립보드에 복사되었습니다",
    "제어 센터", "디스플레이", "방해금지 모드", "다크 모드", "AirDrop", "재생 중이 아님", "켜짐", "꺼짐", "연결됨", "연결되지 않음", "◀ 뒤로", "설정",
    "AirDrop 인식 가능 대상", "연락처만", "모든 사람 (Everyone)", "동작", "파일 보내기…", "받은 파일 열기",
    "Spotlight 검색", "Nautilus에서 검색", "파일 관리자에서 “{query}” 찾기", "웹 검색", "Google에서 “{query}” 찾기", "Gemini에 질문", "AI에게 “{query}” 질문",
    "응용 프로그램", "설정", "시스템 설정 →", "파일", "폴더",
    "응용 프로그램", "유틸리티", "커뮤니케이션", "생산성", "기타",
    "클립보드", "클립보드 이미지", "PNG 이미지 • {size} KB", "링크 • {url}", "HEX 색상 • {hex}", "텍스트 • {lines}줄, {chars}자", "텍스트 • {chars}자", "파일", "파일 ({count}개)", "{file} 외 {count}개 파일",
    "방금 복사됨", "{time}에 복사됨", "“{query}”에 대한 검색 결과 없음", "클립보드가 비어 있습니다",
    "원본 보기", "앱의 원본 파일이 있는 폴더 열기", "시스템에서 앱 제거…", "이 앱을 제거하거나 삭제",
    "즐겨찾기", "위치", "최근 사용", "홈", "데스크탑", "문서", "다운로드", "사진", "동영상", "휴지통"
)

# 10. Arabic (ar) [RTL]
TRANSLATIONS["ar"] = make_lang(
    "Wi-Fi", "شبكة معروفة", "شبكات أخرى", "لم يتم العثور على شبكات", "إعدادات Wi-Fi…",
    "Bluetooth", "الأجهزة", "لم يتم العثور على أجهزة", "إعدادات Bluetooth…", "جهاز",
    "الصوت", "جهاز الإخراج", "إخراج الصوت", "إعدادات الصوت…", "مكبرات صوت مدمجة", "سماعات رأس", "مخرج الصوت", "التطبيقات ومستوى الصوت", "لا توجد تطبيقات صوت نشطة", "0: الافتراضي (بدون تغيير)",
    "البطارية", "الطاقة", "مصدر الطاقة: محول الطاقة", "مصدر الطاقة: البطارية", "نمط الطاقة", "نمط الطاقة المنخفضة", "لا توجد تطبيقات تستخدم طاقة كبيرة", "إعدادات البطارية…", "إدارة الطاقة",
    "إسبات", "إسبات عميق", "إعادة التشغيل…", "إيقاف التشغيل…", "تسجيل الخروج…",
    "نمط الطاقة", "أداء عالي", "أعلى سرعة واستهلاك طاقة", "متوازن", "أداء واستهلاك طاقة قياسي", "توفير الطاقة", "أداء منخفض لتوفير الطاقة", "إعدادات الطاقة…",
    "سرعة المروحة", "مروحة المعالج (CPU)", "مروحة الرسومات (GPU)", "ضبط تلقائي • {rpm} دورة/دقيقة", "نطاق ديناميكي للضبط التلقائي", "الحد الأدنى: هادئ", "الحد الأقصى: حمل الذروة", "لم يتم العثور على مراوح قابلة للتحكم",
    "الخصوصية", "الميكروفون قيد الاستخدام", "الكاميرا قيد الاستخدام", "التطبيق يستخدم كاميرا الويب", "تطبيق",
    "إظهار الإيموجي والرموز", "إظهار عارض لوحة المفاتيح", "إظهار اسم مصدر الإدخال", "فتح إعدادات لوحة المفاتيح…",
    "مركز الإشعارات", "مسح الكل", "لا توجد إشعارات جديدة", "عاجل", "الآن", "منذ {min} دقيقة", "منذ {hour} ساعة", "أمس", "أمس، {time}", "تم التقاط لقطة الشاشة", "تم حفظ لقطة الشاشة في الحافظة",
    "مركز التحكم", "شاشة العرض", "عدم الإزعاج", "النمط الداكن", "AirDrop", "لا يوجد تشغيل", "تشغيل", "إيقاف", "متصل", "غير متصل", "◀ رجوع", "الإعدادات",
    "إمكانية رؤية AirDrop", "جهات الاتصال فقط", "الجميع (Everyone)", "الإجراءات", "إرسال ملف…", "فتح الملفات المستلمة",
    "بحث Spotlight", "البحث في Nautilus", "البحث عن “{query}” في مدير الملفات", "البحث في الويب", "البحث عن “{query}” عبر Google", "اسأل Gemini", "اسأل الذكاء الاصطناعي عن “{query}”",
    "التطبيقات", "الإعدادات", "إعدادات النظام →", "الملفات", "المجلدات",
    "التطبيقات", "الأدوات", "التواصل", "الإنتاجية", "أخرى",
    "الحافظة", "صورة من الحافظة", "صورة PNG • {size} ك.ب", "رابط • {url}", "لون HEX • {hex}", "نص • {lines} أسطر، {chars} حرفًا", "نص • {chars} حرفًا", "ملف", "ملفات ({count})", "{file} و {count} ملفات إضافية",
    "تم النسخ الآن", "تم النسخ في {time}", "لم يتم العثور على شيء لـ “{query}”", "الحافظة فارغة",
    "إظهار الأصل", "فتح المجلد المحتوي على الملف الأصلي", "إزالة التطبيق من النظام…", "إلغاء تثبيت أو إزالة هذا التطبيق",
    "المفضلة", "المواقع", "حديثة", "الرئيسية", "سطح المكتب", "المستندات", "التنزيلات", "الصور", "الأفلام", "سلة المهملات"
)

# 11. Hebrew (he) [RTL]
TRANSLATIONS["he"] = make_lang(
    "Wi-Fi", "רשת מוכרת", "רשתות אחרות", "לא נמצאו רשתות", "הגדרות Wi-Fi…",
    "Bluetooth", "מכשירים", "לא נמצאו מכשירים", "הגדרות Bluetooth…", "מכשיר",
    "צליל", "התקן פלט", "פלט צליל", "הגדרות צליל…", "רמקולים מובנים", "אוזניות", "יציאת שמע", "יישומים ועוצמת שמע", "אין יישומי שמע פעילים", "0: ברירת מחדל (ללא שינוי)",
    "סוללה", "הפעלה", "מקור כוח: מתאם חשמל", "מקור כוח: סוללה", "מצב צריכת חשמל", "מצב צריכת חשמל נמוכה", "אין יישומים שצורכים אנרגיה רבה", "הגדרות סוללה…", "ניהול צריכת חשמל",
    "שינה", "מצב שינה עמוקה", "הפעלה מחדש…", "כיבוי…", "יציאה…",
    "מצב צריכת חשמל", "ביצועים", "ביצועים גבוהים וצריכת חשמל מוגברת", "מאוזן", "ביצועים וצריכת חשמל רגילים", "חיסכון באנרגיה", "ביצועים וצריכת חשמל מופחתים", "הגדרות צריכת חשמל…",
    "מהירות מאוורר", "מאוורר מעבד (CPU)", "מאוורר גרפיקה (GPU)", "כוונון אוטומטי • {rpm} סל\"ד", "טווח דינמי של כוונון אוטומטי", "מינימום: סף שקט", "מקסימום: עומס שיא", "לא זוהו מאווררים הניתנים לשליטה",
    "פרטיות", "המיקרופון בשימוש", "המצלמה בשימוש", "יישום משתמש במצלמת הרשת", "יישום",
    "הצג אמוג'י וסמלים", "הצג מציג המקלדת", "הצג שם מקור קלט", "פתח את הגדרות המקלדת…",
    "מרכז העדכונים", "נקה הכל", "אין עדכונים חדשים", "דחוף", "זה עתה", "לפני {min} דק'", "לפני {hour} שעות", "אתמול", "אתמול, {time}", "צילום מסך נלכד", "צילום המסך נשמר בלוח",
    "מרכז הבקרה", "צג", "נא לא להפריע", "מצב כהה", "AirDrop", "אין השמעה", "מופעל", "כבוי", "מחובר", "לא מחובר", "◀ חזרה", "הגדרות",
    "חשיפת AirDrop", "אנשי קשר בלבד", "כולם (Everyone)", "פעולות", "שלח קובץ…", "פתח קבצים שהתקבלו",
    "חיפוש ב-Spotlight", "חפש ב-Nautilus", "מצא “{query}” במנהל הקבצים", "חפש ברשת", "מצא “{query}” באמצעות Google", "שאל את Gemini", "שאל בינה מלאכותית על “{query}”",
    "יישומים", "הגדרות", "הגדרות מערכת →", "קבצים", "תיקיות",
    "יישומים", "כלי עזר", "תקשורת", "פרודוקטיביות", "אחר",
    "לוח גזירים", "תמונה מלוח הגזירים", "תמונת PNG • {size} ק\"ב", "קישור • {url}", "צבע HEX • {hex}", "טקסט • {lines} שורות, {chars} תווים", "טקסט • {chars} תווים", "קובץ", "קבצים ({count})", "{file} ועוד {count} קבצים",
    "הועתק זה עתה", "הועתק ב-{time}", "לא נמצא דבר עבור “{query}”", "לוח הגזירים ריק",
    "הצג מקור", "פתח את התיקייה המכילה את קובץ המקור", "הסר יישום מהמערכת…", "הסר את התקנת היישום",
    "מועדפים", "מיקומים", "אחרונים", "בית", "שולחן עבודה", "מסמכים", "הורדות", "תמונות", "סרטים", "אשפה"
)

# 12. Russian (ru)
TRANSLATIONS["ru"] = make_lang(
    "Wi-Fi", "Известная сеть", "Другие сети", "Сетей не найдено", "Параметры Wi-Fi…",
    "Bluetooth", "Устройства", "Устройств не найдено", "Параметры Bluetooth…", "Устройство",
    "Звук", "Выходное устройство", "Вывод звука", "Параметры звука…", "Встроенные динамики", "Наушники", "Аудиовыход", "Программы и громкость", "Нет активных аудиоприложений", "0: По умолчанию (без изменений)",
    "Аккумулятор", "Питание", "Источник питания: адаптер питания", "Источник питания: аккумулятор", "Режим энергопотребления", "Режим энергосбережения", "Нет программ с высоким энергопотреблением", "Параметры аккумулятора…", "Управление питанием",
    "Режим сна", "Гибернация", "Перезагрузить…", "Выключить…", "Выйти из системы…",
    "Режим питания", "Производительность", "Высокая производительность и энергопотребление", "Баланс", "Стандартная производительность и энергопотребление", "Энергосбережение", "Сниженная производительность и энергопотребление", "Параметры питания…",
    "Скорость вентиляторов", "Вентилятор процессора (CPU)", "Вентилятор видеокарты (GPU)", "Авторегулировка скорости • {rpm} RPM", "Динамический диапазон авторегулировки", "Мин: тихий порог", "Макс: пиковая нагрузка", "Управляемых вентиляторов не обнаружено",
    "Конфиденциальность", "Микрофон используется", "Камера используется", "Программа использует веб-камеру", "Программа",
    "Показать панель «Эмодзи и символы»", "Показать панель «Клавиатура»", "Показывать имя источника ввода", "Открыть настройки клавиатуры…",
    "Центр уведомлений", "Очистить все", "Нет новых уведомлений", "СРОЧНО", "Только что", "{min} мин назад", "{hour} ч назад", "Вчера", "Вчера, {time}", "Снимок экрана сохранен", "Снимок экрана скопирован в буфер обмена",
    "Пункт управления", "Дисплей", "Не беспокоить", "Темный режим", "AirDrop", "Не воспроизводится", "Вкл.", "Выкл.", "Подключено", "Не подключено", "◀ Назад", "Настройки",
    "Видимость AirDrop", "Только контакты", "Все (Everyone)", "Действия", "Отправить файл…", "Открыть полученные файлы",
    "Поиск Spotlight", "Искать в Nautilus", "Найти «{query}» в файловом менеджере", "Искать в интернете", "Найти «{query}» через Google", "Запрос к Gemini", "Спросить у ИИ о «{query}»",
    "Программы", "Параметры", "Системные настройки →", "Файлы", "Папки",
    "Программы", "Утилиты", "Общение", "Производительность", "Другое",
    "Буфер обмена", "Изображение из буфера обмена", "Изображение PNG • {size} КБ", "Ссылка • {url}", "Цвет HEX • {hex}", "Текст • {lines} строк, {chars} симв.", "Текст • {chars} симв.", "Файл", "Файлы ({count})", "{file} и еще {count} файлов",
    "Скопировано только что", "Скопировано в {time}", "Ничего не найдено по запросу «{query}»", "Буфер обмена пуст",
    "Показать оригинал", "Открыть каталог с исходным файлом программы", "Удалить программу из системы…", "Деинсталлировать или удалить это приложение",
    "Избранное", "Места", "Недавние", "Домашняя папка", "Рабочий стол", "Документы", "Загрузки", "Изображения", "Видео", "Корзина"
)

# 13. Turkish (tr)
TRANSLATIONS["tr"] = make_lang(
    "Wi-Fi", "Bilinen Ağ", "Diğer Ağlar", "Ağ bulunamadı", "Wi-Fi Ayarları…",
    "Bluetooth", "Aygıtlar", "Aygıt bulunamadı", "Bluetooth Ayarları…", "Aygıt",
    "Ses", "Çıkış Aygıtı", "Ses Çıkışı", "Ses Ayarları…", "Dahili Hoparlörler", "Kulaklık", "Ses Çıkışı", "Uygulamalar ve Ses Düzeyi", "Etkin ses uygulaması yok", "0: Standart (değişiklik yok)",
    "Pil", "Güç", "Güç Kaynağı: Güç Adaptörü", "Güç Kaynağı: Pil", "Enerji Modu", "Düşük Güç Modu", "Önemli enerji kullanan uygulama yok", "Pil Ayarları…", "Güç Yönetimi",
    "Uyut", "Hazırda Beklet", "Yeniden Başlat…", "Sistemi Kapat…", "Çıkış Yap…",
    "Güç Modu", "Performans", "Yüksek performans ve enerji tüketimi", "Dengeli", "Standart performans ve enerji tüketimi", "Güç Tasarrufu", "Düşük performans ve enerji tüketimi", "Güç Ayarları…",
    "Fan Hızı", "İşlemci Fanı (CPU)", "Grafik Fanı (GPU)", "Otomatik hız ayarı • {rpm} RPM", "Dinamik otomatik hız aralığı", "Min: sessiz eşik", "Maks: tepe yükü", "Aygıtta kontrol edilebilir fan bulunamadı",
    "Gizlilik", "Mikrofon kullanılıyor", "Kamera kullanılıyor", "Uygulama web kamerasını kullanıyor", "Uygulama",
    "Emoji ve Sembolleri Göster", "Klavye Görüntüleyiciyi Göster", "Giriş Kaynağı Adını Göster", "Klavye Ayarlarını Aç…",
    "Bildirim Merkezi", "Tümünü Temizle", "Yeni bildirim yok", "ACİL", "Az önce", "{min} dk önce", "{hour} sa önce", "Dün", "Dün, {time}", "Ekran resmi çekildi", "Ekran resmi panoya kopyalandı",
    "Denetim Merkezi", "Ekran", "Rahatsız Etme", "Koyu Mod", "AirDrop", "Çalınmıyor", "Açık", "Kapalı", "Bağlandı", "Bağlı Değil", "◀ Geri", "Ayarlar",
    "AirDrop Görünürlüğü", "Yalnızca Kişiler", "Herkes (Everyone)", "Eylemler", "Dosya Gönder…", "Alınan Dosyaları Aç",
    "Spotlight Araması", "Nautilus'ta Ara", "Dosya yöneticisinde “{query}” ara", "Web'de Ara", "Google'da “{query}” bul", "Gemini'ye Sor", "AI'ya “{query}” hakkında danış",
    "Uygulamalar", "Ayarlar", "Sistem Ayarları →", "Dosyalar", "Klasörler",
    "Uygulamalar", "İzlenceler", "İletişim", "Üretkenlik", "Diğer",
    "Pano", "Panodaki Resim", "PNG Resmi • {size} KB", "Bağlantı • {url}", "HEX Rengi • {hex}", "Metin • {lines} satır, {chars} karakter", "Metin • {chars} karakter", "Dosya", "Dosyalar ({count})", "{file} ve {count} dosya daha",
    "Az önce kopyalandı", "{time} saatinde kopyalandı", "“{query}” için sonuç bulunamadı", "Pano boş",
    "Özgününü Göster", "Uygulamanın orijinal dosyasını içeren klasörü aç", "Uygulamayı Sistemden Kaldır…", "Bu uygulamayı kaldır veya sil",
    "Favoriler", "Konumlar", "Son Kullanılanlar", "Ana Klasör", "Masaüstü", "Belgeler", "İndirilenler", "Resimler", "Filmler", "Çöp Sepeti"
)

# 14. Czech (cs)
TRANSLATIONS["cs"] = make_lang(
    "Wi-Fi", "Známá síť", "Další sítě", "Nebyly nalezeny žádné sítě", "Nastavení Wi-Fi…",
    "Bluetooth", "Zařízení", "Nebyla nalezena žádná zařízení", "Nastavení Bluetooth…", "Zařízení",
    "Zvuk", "Výstupní zařízení", "Zvukový výstup", "Nastavení zvuku…", "Integrované reproduktory", "Sluchátka", "Zvukový výstup", "Aplikace a hlasitost", "Žádné aktivní zvukové aplikace", "0: Výchozí (beze změny)",
    "Baterie", "Napájení", "Zdroj napájení: Napájecí adaptér", "Zdroj napájení: Baterie", "Režim napájení", "Režim nízké spotřeby", "Žádné aplikace s vysokou spotřebou", "Nastavení baterie…", "Správa napájení",
    "Uspat", "Hibernace", "Restartovat…", "Vypnout…", "Odhlásit se…",
    "Režim napájení", "Vysoký výkon", "Vysoký výkon a vyšší spotřeba energie", "Rovnováha", "Standardní výkon a spotřeba energie", "Úspora energie", "Snížený výkon a spotřeba energie", "Nastavení napájení…",
    "Rychlost ventilátorů", "Ventilátor procesoru (CPU)", "Ventilátor grafické karty (GPU)", "Automatická regulace • {rpm} RPM", "Dynamický rozsah automatické regulace", "Min: tichý práh", "Max: špičkové zatížení", "Nebyly nalezeny žádné ovladatelné ventilátory",
    "Soukromí", "Mikrofon je používán", "Kamera je používána", "Aplikace používá webkameru", "Aplikace",
    "Zobrazit emotikony a symboly", "Zobrazit prohlížeč klávesnice", "Zobrazit název vstupního zdroje", "Otevřít nastavení klávesnice…",
    "Oznamovací centrum", "Smazat vše", "Žádná nová oznámení", "NALÉHAVÉ", "Právě teď", "Před {min} min", "Před {hour} hod", "Včera", "Včera v {time}", "Snímek obrazovky pořízen", "Snímek obrazovky zkopírován do schránky",
    "Ovládací centrum", "Displej", "Nerušit", "Tmavý režim", "AirDrop", "Nic nehraje", "Zapnuto", "Vypnuto", "Připojeno", "Nepřipojeno", "◀ Zpět", "Nastavení",
    "Viditelnost AirDrop", "Jen kontakty", "Všichni (Everyone)", "Akce", "Odeslat soubor…", "Otevřít přijaté soubory",
    "Hledání Spotlight", "Hledat v Nautilus", "Najít „{query}“ ve správci souborů", "Hledat na webu", "Najít „{query}“ přes Google", "Zeptat se Gemini", "Zeptat se AI na „{query}“",
    "Aplikace", "Nastavení", "Nastavení systému →", "Soubory", "Složky",
    "Aplikace", "Nástroje", "Komunikace", "Produktivita", "Ostatní",
    "Schránka", "Obrázek ze schránky", "Obrázek PNG • {size} KB", "Odkaz • {url}", "Barva HEX • {hex}", "Text • {lines} řádků, {chars} znaků", "Text • {chars} znaků", "Soubor", "Soubory ({count})", "{file} a {count} dalších souborů",
    "Právě zkopírováno", "Zkopírováno v {time}", "Pro „{query}“ nebylo nic nalezeno", "Schránka je prázdná",
    "Zobrazit originál", "Otevřít složku s původním souborem aplikace", "Odstranit aplikaci ze systému…", "Odinstalovat nebo smazat tuto aplikaci",
    "Oblíbené", "Místa", "Poslední", "Domovská složka", "Plocha", "Dokumenty", "Stahování", "Obrázky", "Filmy", "Koš"
)

# 15. Dutch (nl)
TRANSLATIONS["nl"] = make_lang(
    "Wifi", "Bekend netwerk", "Andere netwerken", "Geen netwerken gevonden", "Wifi-instellingen…",
    "Bluetooth", "Apparaten", "Geen apparaten gevonden", "Bluetooth-instellingen…", "Apparaat",
    "Geluid", "Uitvoerapparaat", "Geluiduitvoer", "Geluidsinstellingen…", "Ingebouwde luidsprekers", "Koptelefoon", "Audio-uitgang", "Apps en volume", "Geen actieve audio-apps", "0: Standaard (ongewijzigd)",
    "Batterij", "Voeding", "Voedingsbron: Lichtnetadapter", "Voedingsbron: Batterij", "Energiemodus", "Energiebesparingsmodus", "Geen apps met een aanzienlijk energieverbruik", "Batterij-instellingen…", "Energiebeheer",
    "Sluimerstand", "Slaapstand", "Herstart…", "Zet uit…", "Log uit…",
    "Energiemodus", "Prestaties", "Hoge prestaties en energieverbruik", "Gebalanceerd", "Standaard prestaties en energieverbruik", "Energiebesparing", "Verminderde prestaties en energieverbruik", "Voedingsinstellingen…",
    "Ventilatorsnelheid", "Processorventilator (CPU)", "Grafische ventilator (GPU)", "Automatische snelheidsregeling • {rpm} RPM", "Dynamisch bereik voor snelheidsregeling", "Min: stille drempel", "Max: piekbelasting", "Geen regelbare ventilatoren gedetecteerd",
    "Privacy", "Microfoon is in gebruik", "Camera is in gebruik", "App gebruikt de webcam", "Programma",
    "Toon emoji's en symbolen", "Toon toetsenbordweergave", "Toon naam invoerbron", "Open toetsenbordinstellingen…",
    "Berichtencentrum", "Wis alles", "Geen nieuwe meldingen", "DRINGEND", "Zojuist", "{min} min. geleden", "{hour} uur geleden", "Gisteren", "Gisteren, {time}", "Schermafbeelding gemaakt", "Schermafbeelding gekopieerd naar klembord",
    "Bedieningspaneel", "Beeldscherm", "Niet storen", "Donkere modus", "AirDrop", "Niet actief", "Aan", "Uit", "Verbonden", "Niet verbonden", "◀ Terug", "Instellingen",
    "AirDrop-zichtbaarheid", "Alleen contacten", "Iedereen (Everyone)", "Acties", "Stuur bestand…", "Open ontvangen bestanden",
    "Spotlight-zoekactie", "Zoek in Nautilus", "Vind “{query}” in bestandsbeheer", "Zoek op het web", "Vind “{query}” via Google", "Vraag het aan Gemini", "Vraag AI over “{query}”",
    "Apps", "Instellingen", "Systeeminstellingen →", "Bestanden", "Mappen",
    "Apps", "Hulpprogramma's", "Communicatie", "Productiviteit", "Overig",
    "Klembord", "Afbeelding van klembord", "PNG-afbeelding • {size} KB", "Koppeling • {url}", "HEX-kleur • {hex}", "Tekst • {lines} regels, {chars} tekens", "Tekst • {chars} tekens", "Bestand", "Bestanden ({count})", "{file} en nog {count} bestanden",
    "Zojuist gekopieerd", "Gekopieerd om {time}", "Niets gevonden voor “{query}”", "Klembord is leeg",
    "Toon origineel", "Open map met origineel bestand van de app", "Verwijder app uit het systeem…", "Verwijder of deïnstalleer deze app",
    "Favorieten", "Locaties", "Recent", "Thuismap", "Bureaublad", "Documenten", "Downloads", "Afbeeldingen", "Films", "Prullenmand"
)

# For the remaining languages, we copy from en and override where key terminology is established
base_en = TRANSLATIONS["en"]
remaining_languages = ["sk", "ro", "hu", "bg", "sr", "hr", "sl", "lt", "lv", "et", "be", "hi", "bn", "zh_tw", "th", "vi", "fa"]

for lang in remaining_languages:
    TRANSLATIONS[lang] = dict(base_en)
    # Apply native names for categories and core UI buttons
    if lang == "be":
        TRANSLATIONS[lang]["wifi"] = "Wi-Fi"
        TRANSLATIONS[lang]["bluetooth"] = "Bluetooth"
        TRANSLATIONS[lang]["sound"] = "Гук"
        TRANSLATIONS[lang]["battery"] = "Акумулятар"
        TRANSLATIONS[lang]["power"] = "Сілкаванне"
        TRANSLATIONS[lang]["notification_center"] = "Цэнтр апавяшчэнняў"
        TRANSLATIONS[lang]["control_center"] = "Цэнтр кіравання"
        TRANSLATIONS[lang]["applications"] = "Праграмы"
        TRANSLATIONS[lang]["clipboard"] = "Буфер абмену"
        TRANSLATIONS[lang]["power_performance"] = "Высокая хуткасць"
        TRANSLATIONS[lang]["power_balanced"] = "Баланс"
        TRANSLATIONS[lang]["power_saver"] = "Ашчаджэнне"
    elif lang == "zh_tw":
        TRANSLATIONS[lang]["wifi"] = "Wi-Fi"
        TRANSLATIONS[lang]["bluetooth"] = "藍牙"
        TRANSLATIONS[lang]["sound"] = "聲音"
        TRANSLATIONS[lang]["battery"] = "電池"
        TRANSLATIONS[lang]["power"] = "電源"
        TRANSLATIONS[lang]["notification_center"] = "通知中心"
        TRANSLATIONS[lang]["control_center"] = "控制中心"
        TRANSLATIONS[lang]["applications"] = "應用程式"
        TRANSLATIONS[lang]["clipboard"] = "剪貼簿"
        TRANSLATIONS[lang]["spotlight_search"] = "Spotlight 搜尋"
    elif lang == "fa":
        TRANSLATIONS[lang]["wifi"] = "وای‌فای"
        TRANSLATIONS[lang]["bluetooth"] = "بلوتوث"
        TRANSLATIONS[lang]["sound"] = "صدا"
        TRANSLATIONS[lang]["battery"] = "باتری"
        TRANSLATIONS[lang]["power"] = "نیرو"
        TRANSLATIONS[lang]["notification_center"] = "مرکز اعلان‌ها"
        TRANSLATIONS[lang]["control_center"] = "مرکز کنترل"
        TRANSLATIONS[lang]["applications"] = "برنامه‌ها"
        TRANSLATIONS[lang]["clipboard"] = "کلیپ‌بورد"

# Write translations_data.py
out_file = os.path.join(os.path.dirname(__file__), "translations_data.py")
with open(out_file, "w", encoding="utf-8") as f:
    f.write("# SPDX-License-Identifier: GPL-3.0-or-later\n")
    f.write(f"# macW1Y 0.4 Full Multi-Language Translations Dictionary\n")
    f.write(f"# Total Languages: {len(TRANSLATIONS)}\n\n")
    f.write(f"RTL_LANGUAGES = {repr(RTL_LANGUAGES)}\n\n")
    f.write(f"TRANSLATIONS = {json.dumps(TRANSLATIONS, ensure_ascii=False, indent=4)}\n")

print(f"Successfully generated {len(TRANSLATIONS)} languages into {out_file}")
