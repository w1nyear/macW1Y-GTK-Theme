#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <glib.h>
#include <gio/gio.h>
#include <dlfcn.h>
#include <gtk/gtk.h>
#include <adwaita.h>
#include <json-glib/json-glib.h>


#include <math.h>

typedef struct {
    int menubar_tint;   /* 0 - 100 */
    int menubar_blur;   /* 0 - 100 */

    int liquid_blur;    /* 0 - 100 */
    int liquid_tint;    /* 0 - 100 */

    int blur_sigma;     /* 0 - 100 */
    int blur_tint;      /* 0 - 100 */

    /* Legacy fields for backward compatibility */
    int dock_blur;
    int dock_sigma;
    double dock_tint;
    int dock_radius;
    int panel_blur;
    int panel_sigma;
    double panel_tint;
    int qs_sigma;
    int qs_anim;
    int notif_blur;
    int notif_sigma;
    double notif_tint;
    int notif_radius;
} MacStylingData;

static MacStylingData state = {
    .menubar_tint = 35,
    .menubar_blur = 10,

    .liquid_blur = 20,
    .liquid_tint = 12,

    .blur_sigma = 30,
    .blur_tint = 36,

    .dock_blur = 1,
    .dock_sigma = 30,
    .dock_tint = 0.36,
    .dock_radius = 28,

    .panel_blur = 1,
    .panel_sigma = 10,
    .panel_tint = 0.35,

    .qs_sigma = 30,
    .qs_anim = 0,

    .notif_blur = 1,
    .notif_sigma = 30,
    .notif_tint = 0.68,
    .notif_radius = 18,
};

static int in_init = 0;
static guint css_timer_id = 0;

static void load_config(void) {
    const char *home = g_get_home_dir();
    char *conf_path = g_build_filename(home, ".config", "mac-styling", "styling.json", NULL);
    if (!g_file_test(conf_path, G_FILE_TEST_EXISTS)) {
        g_free(conf_path);
        return;
    }

    GError *error = NULL;
    JsonParser *parser = json_parser_new();
    if (json_parser_load_from_file(parser, conf_path, &error)) {
        JsonNode *root = json_parser_get_root(parser);
        if (JSON_NODE_HOLDS_OBJECT(root)) {
            JsonObject *obj = json_node_get_object(root);

            /* Group 1: Menubar */
            if (json_object_has_member(obj, "menubar_tint"))
                state.menubar_tint = (int)json_object_get_int_member(obj, "menubar_tint");
            else if (json_object_has_member(obj, "panel_tint"))
                state.menubar_tint = (int)round(json_object_get_double_member(obj, "panel_tint") * 100.0);

            if (json_object_has_member(obj, "menubar_blur"))
                state.menubar_blur = (int)json_object_get_int_member(obj, "menubar_blur");
            else if (json_object_has_member(obj, "panel_sigma"))
                state.menubar_blur = (int)json_object_get_int_member(obj, "panel_sigma");

            /* Group 2: Liquid Glass */
            if (json_object_has_member(obj, "liquid_blur"))
                state.liquid_blur = (int)json_object_get_int_member(obj, "liquid_blur");
            else if (json_object_has_member(obj, "dock_glass_strength"))
                state.liquid_blur = (int)round(json_object_get_double_member(obj, "dock_glass_strength") * 100.0);
            else
                state.liquid_blur = 20;

            if (json_object_has_member(obj, "liquid_tint"))
                state.liquid_tint = (int)json_object_get_int_member(obj, "liquid_tint");
            else if (json_object_has_member(obj, "dock_tint_strength"))
                state.liquid_tint = (int)round(json_object_get_double_member(obj, "dock_tint_strength") * 100.0);
            else
                state.liquid_tint = 12;

            /* Group 3: Blur */
            if (json_object_has_member(obj, "blur_sigma"))
                state.blur_sigma = (int)json_object_get_int_member(obj, "blur_sigma");
            else if (json_object_has_member(obj, "dock_sigma"))
                state.blur_sigma = (int)json_object_get_int_member(obj, "dock_sigma");

            if (json_object_has_member(obj, "blur_tint"))
                state.blur_tint = (int)json_object_get_int_member(obj, "blur_tint");
            else if (json_object_has_member(obj, "dock_tint"))
                state.blur_tint = (int)round(json_object_get_double_member(obj, "dock_tint") * 100.0);

            /* Legacy */
            if (json_object_has_member(obj, "dock_blur"))
                state.dock_blur = json_object_get_boolean_member(obj, "dock_blur");
            if (json_object_has_member(obj, "dock_sigma"))
                state.dock_sigma = (int)json_object_get_int_member(obj, "dock_sigma");
            if (json_object_has_member(obj, "dock_tint"))
                state.dock_tint = json_object_get_double_member(obj, "dock_tint");
            if (json_object_has_member(obj, "dock_radius"))
                state.dock_radius = (int)json_object_get_int_member(obj, "dock_radius");

            if (json_object_has_member(obj, "panel_blur"))
                state.panel_blur = json_object_get_boolean_member(obj, "panel_blur");
            if (json_object_has_member(obj, "panel_sigma"))
                state.panel_sigma = (int)json_object_get_int_member(obj, "panel_sigma");
            if (json_object_has_member(obj, "panel_tint"))
                state.panel_tint = json_object_get_double_member(obj, "panel_tint");

            if (json_object_has_member(obj, "qs_sigma"))
                state.qs_sigma = (int)json_object_get_int_member(obj, "qs_sigma");
            if (json_object_has_member(obj, "qs_anim")) {
                const char *anim = json_object_get_string_member(obj, "qs_anim");
                state.qs_anim = (strcmp(anim, "elements") == 0) ? 1 : 0;
            }

            if (json_object_has_member(obj, "notif_blur"))
                state.notif_blur = json_object_get_boolean_member(obj, "notif_blur");
            if (json_object_has_member(obj, "notif_sigma"))
                state.notif_sigma = (int)json_object_get_int_member(obj, "notif_sigma");
            if (json_object_has_member(obj, "notif_tint"))
                state.notif_tint = json_object_get_double_member(obj, "notif_tint");
            if (json_object_has_member(obj, "notif_radius"))
                state.notif_radius = (int)json_object_get_int_member(obj, "notif_radius");
        }
    }
    if (error) g_error_free(error);
    g_object_unref(parser);
    g_free(conf_path);
}

static void save_styling_json(void) {
    const char *home = g_get_home_dir();
    char *dir = g_build_filename(home, ".config", "mac-styling", NULL);
    g_mkdir_with_parents(dir, 0755);
    char *path = g_build_filename(dir, "styling.json", NULL);

    char *json = g_strdup_printf(
        "{\n"
        "  \"menubar_tint\": %d,\n"
        "  \"menubar_blur\": %d,\n"
        "  \"liquid_blur\": %d,\n"
        "  \"liquid_tint\": %d,\n"
        "  \"blur_sigma\": %d,\n"
        "  \"blur_tint\": %d,\n"
        "  \"dock_blur\": %s,\n"
        "  \"dock_sigma\": %d,\n"
        "  \"dock_tint\": %.2f,\n"
        "  \"dock_radius\": %d,\n"
        "  \"panel_blur\": %s,\n"
        "  \"panel_sigma\": %d,\n"
        "  \"panel_tint\": %.2f,\n"
        "  \"qs_sigma\": %d,\n"
        "  \"notif_blur\": %s,\n"
        "  \"notif_sigma\": %d,\n"
        "  \"notif_tint\": %.2f,\n"
        "  \"notif_radius\": %d\n"
        "}\n",
        state.menubar_tint,
        state.menubar_blur,
        state.liquid_blur,
        state.liquid_tint,
        state.blur_sigma,
        state.blur_tint,
        (state.blur_sigma > 0) ? "true" : "false",
        state.blur_sigma,
        (double)state.blur_tint / 100.0,
        28,
        (state.menubar_blur > 0) ? "true" : "false",
        state.menubar_blur,
        (double)state.menubar_tint / 100.0,
        state.blur_sigma,
        (state.blur_sigma > 0) ? "true" : "false",
        state.blur_sigma,
        (double)state.blur_tint / 100.0,
        18
    );
    g_file_set_contents(path, json, -1, NULL);
    g_free(json);
    g_free(path);
    g_free(dir);
}

static gboolean save_css_cb(gpointer user_data) {
    (void)user_data;
    css_timer_id = 0;
    char *cmd = g_strdup_printf(
        "/home/vitaliy/MACTHEMEFILES/bin/update-mac-styling-css %d %d",
        state.menubar_tint, state.blur_tint
    );
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
    return G_SOURCE_REMOVE;
}

static void schedule_css_save(void) {
    if (css_timer_id != 0) {
        g_source_remove(css_timer_id);
    }
    css_timer_id = g_timeout_add(400, (GSourceFunc)save_css_cb, NULL);
}

static void apply_menubar_blur(void) {
    char *cmd = g_strdup_printf(
        "/home/vitaliy/MACTHEMEFILES/bin/update-bms-menubar-blur %d",
        state.menubar_blur
    );
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);

    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (src && g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.blur-my-shell.panel", TRUE)) {
        GSettings *bms_panel = g_settings_new("org.gnome.shell.extensions.blur-my-shell.panel");
        g_settings_set_int(bms_panel, "sigma", state.menubar_blur);
        g_settings_set_boolean(bms_panel, "blur", state.menubar_blur > 0);
        g_object_unref(bms_panel);
    }
}

static void apply_liquid_blur(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src || !g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE))
        return;

    GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
    int radius = (state.liquid_blur > 0) ? (int)round((double)state.liquid_blur * 30.0 / 100.0) : 0;
    if (state.liquid_blur > 0 && radius < 1) radius = 1;

    const char *keys[] = {
        "dock-blur-radius",
        "quick-settings-blur-radius",
        "panel-menu-blur-radius",
        "menu-blur-radius",
        "desktop-menu-blur-radius",
        "notification-blur-radius",
        "application-blur-radius",
        "osd-blur-radius",
        NULL
    };

    for (int i = 0; keys[i] != NULL; i++) {
        g_settings_set_int(lg, keys[i], radius);
    }
    g_object_unref(lg);
}

static void apply_liquid_tint(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src || !g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE))
        return;

    GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
    double tint = (double)state.liquid_tint / 100.0;

    const char *keys[] = {
        "dock-tint-strength",
        "quick-settings-tint-strength",
        "quick-settings-toggle-tint-strength",
        "panel-menu-tint-strength",
        "menu-tint-strength",
        "desktop-menu-tint-strength",
        "notification-tint-strength",
        "application-tint-strength",
        "osd-tint-strength",
        NULL
    };

    for (int i = 0; keys[i] != NULL; i++) {
        g_settings_set_double(lg, keys[i], tint);
    }
    g_object_unref(lg);
}

static void apply_blur_sigma(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    const char *schemas[] = {
        "org.gnome.shell.extensions.blur-my-shell",
        "org.gnome.shell.extensions.blur-my-shell.applications",
        "org.gnome.shell.extensions.blur-my-shell.dash-to-dock",
        "org.gnome.shell.extensions.blur-my-shell.overview",
        "org.gnome.shell.extensions.blur-my-shell.lockscreen",
        "org.gnome.shell.extensions.blur-my-shell.appfolder",
        "org.gnome.shell.extensions.blur-my-shell.screenshot",
        "org.gnome.shell.extensions.blur-my-shell.popup",
        "org.gnome.shell.extensions.blur-my-shell.window-list",
        NULL
    };

    for (int i = 0; schemas[i] != NULL; i++) {
        if (g_settings_schema_source_lookup(src, schemas[i], TRUE)) {
            GSettings *s = g_settings_new(schemas[i]);
            g_settings_set_int(s, "sigma", state.blur_sigma);
            g_object_unref(s);
        }
    }
}

static void apply_blur_tint(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    double tint = (double)state.blur_tint / 100.0;
    double brightness = 1.0 - (tint * 0.5);
    if (brightness < 0.2) brightness = 0.2;
    if (brightness > 1.0) brightness = 1.0;

    const char *schemas[] = {
        "org.gnome.shell.extensions.blur-my-shell",
        "org.gnome.shell.extensions.blur-my-shell.applications",
        "org.gnome.shell.extensions.blur-my-shell.dash-to-dock",
        "org.gnome.shell.extensions.blur-my-shell.overview",
        "org.gnome.shell.extensions.blur-my-shell.lockscreen",
        "org.gnome.shell.extensions.blur-my-shell.appfolder",
        "org.gnome.shell.extensions.blur-my-shell.screenshot",
        "org.gnome.shell.extensions.blur-my-shell.popup",
        "org.gnome.shell.extensions.blur-my-shell.window-list",
        NULL
    };

    for (int i = 0; schemas[i] != NULL; i++) {
        if (g_settings_schema_source_lookup(src, schemas[i], TRUE)) {
            GSettings *s = g_settings_new(schemas[i]);
            g_settings_set_double(s, "brightness", brightness);
            g_object_unref(s);
        }
    }
}

/* Initialization signals from GtkBuilder (realize) */

/* Group 1: Меню-бар */
void init_menubar_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_range_set_value(widget, (double)state.menubar_tint);
    in_init = 0;
}

void on_menubar_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menubar_tint = (int)gtk_range_get_value(widget);
    save_styling_json();
    schedule_css_save();
}

void init_menubar_blur(void *widget, gpointer data) {
    (void)data;
    in_init = 1;
    gtk_range_set_value(widget, (double)state.menubar_blur);
    in_init = 0;
}

void on_menubar_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menubar_blur = (int)gtk_range_get_value(widget);
    save_styling_json();
    apply_menubar_blur();
}

/* Group 2: Liquid Glass */
void init_liquid_blur(void *widget, gpointer data) {
    (void)data;
    in_init = 1;
    gtk_range_set_value(widget, (double)state.liquid_blur);
    in_init = 0;
}

void on_liquid_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_blur = (int)gtk_range_get_value(widget);
    save_styling_json();
    apply_liquid_blur();
}

void init_liquid_tint(void *widget, gpointer data) {
    (void)data;
    in_init = 1;
    gtk_range_set_value(widget, (double)state.liquid_tint);
    in_init = 0;
}

void on_liquid_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_tint = (int)gtk_range_get_value(widget);
    save_styling_json();
    apply_liquid_tint();
}

/* Group 3: Blur */
void init_blur_sigma(void *widget, gpointer data) {
    (void)data;
    in_init = 1;
    gtk_range_set_value(widget, (double)state.blur_sigma);
    in_init = 0;
}

void on_blur_sigma_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.blur_sigma = (int)gtk_range_get_value(widget);
    save_styling_json();
    apply_blur_sigma();
}

void init_blur_tint(void *widget, gpointer data) {
    (void)data;
    in_init = 1;
    gtk_range_set_value(widget, (double)state.blur_tint);
    in_init = 0;
}

void on_blur_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.blur_tint = (int)gtk_range_get_value(widget);
    save_styling_json();
    apply_blur_tint();
    schedule_css_save();
}

/* Legacy stubs so unresolved symbol errors never occur */
void init_dock_blur(void *widget, gpointer data) { (void)widget; (void)data; }
void on_dock_blur_changed(void *widget, void *pspec, gpointer data) { (void)widget; (void)pspec; (void)data; }
void init_dock_sigma(void *widget, gpointer data) { (void)widget; (void)data; }
void on_dock_sigma_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_dock_tint(void *widget, gpointer data) { (void)widget; (void)data; }
void on_dock_tint_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_dock_radius(void *widget, gpointer data) { (void)widget; (void)data; }
void on_dock_radius_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_panel_blur(void *widget, gpointer data) { (void)widget; (void)data; }
void on_panel_blur_changed(void *widget, void *pspec, gpointer data) { (void)widget; (void)pspec; (void)data; }
void init_panel_sigma(void *widget, gpointer data) { (void)widget; (void)data; }
void on_panel_sigma_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_panel_tint(void *widget, gpointer data) { (void)widget; (void)data; }
void on_panel_tint_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_qs_sigma(void *widget, gpointer data) { (void)widget; (void)data; }
void on_qs_sigma_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_qs_anim(void *widget, gpointer data) { (void)widget; (void)data; }
void on_qs_anim_changed(void *widget, void *pspec, gpointer data) { (void)widget; (void)pspec; (void)data; }
void init_notif_blur(void *widget, gpointer data) { (void)widget; (void)data; }
void on_notif_blur_changed(void *widget, void *pspec, gpointer data) { (void)widget; (void)pspec; (void)data; }
void init_notif_sigma(void *widget, gpointer data) { (void)widget; (void)data; }
void on_notif_sigma_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_notif_tint(void *widget, gpointer data) { (void)widget; (void)data; }
void on_notif_tint_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void init_notif_radius(void *widget, gpointer data) { (void)widget; (void)data; }
void on_notif_radius_changed(void *widget, gpointer data) { (void)widget; (void)data; }
void on_test_notif_clicked(void *widget, gpointer data) { (void)widget; (void)data; }

void init_boot_verbose(void *widget, gpointer data) {
    in_init = 1;
    int is_verbose = 0;
    FILE *f = fopen("/etc/default/grub", "r");
    if (f) {
        char line[512];
        while (fgets(line, sizeof(line), f)) {
            if (strstr(line, "systemd.show_status=1")) {
                is_verbose = 1;
                break;
            }
        }
        fclose(f);
    }
    if (!is_verbose && g_file_test("/usr/share/plymouth/themes/apple-mac/verbose_on.png", G_FILE_TEST_EXISTS)) {
        is_verbose = 1;
    }
    adw_switch_row_set_active(widget, is_verbose);
    in_init = 0;
}

void on_boot_verbose_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int active = adw_switch_row_get_active(widget);
    const char *cmd = active ? "sudo /usr/local/bin/mac-boot-config set-verbose enable"
                             : "sudo /usr/local/bin/mac-boot-config set-verbose disable";
    g_spawn_command_line_async(cmd, NULL);
}

void init_boot_grub(void *widget, gpointer data) {
    in_init = 1;
    int is_grub_enabled = 0;
    FILE *f = fopen("/etc/default/grub", "r");
    if (f) {
        char line[512];
        while (fgets(line, sizeof(line), f)) {
            char *p = line;
            while (*p == ' ' || *p == '\t') p++;
            if (strncmp(p, "GRUB_TIMEOUT_STYLE=menu", 23) == 0) {
                is_grub_enabled = 1;
            } else if (strncmp(p, "GRUB_TIMEOUT=", 13) == 0 && strncmp(p, "GRUB_TIMEOUT=0", 14) != 0) {
                is_grub_enabled = 1;
            }
        }
        fclose(f);
    }
    adw_switch_row_set_active(widget, is_grub_enabled);
    in_init = 0;
}

void on_boot_grub_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int active = adw_switch_row_get_active(widget);
    const char *cmd = active ? "sudo /usr/local/bin/mac-boot-config set-grub enable"
                             : "sudo /usr/local/bin/mac-boot-config set-grub disable";
    g_spawn_command_line_async(cmd, NULL);
}

/* Fallback in case on_mac_styling_clicked is ever invoked directly */
void on_mac_styling_clicked(void *row, void *user_data) {
    /* If row or template triggered this, navigation is handled by navigation.push */
}

void init_game_mode(void *widget, gpointer data) {
    in_init = 1;
    int is_active = 0;
    FILE *f = fopen("/etc/mac-gamemode.state", "r");
    if (f) {
        char buf[16];
        if (fgets(buf, sizeof(buf), f)) {
            if (buf[0] == '1') is_active = 1;
        }
        fclose(f);
    }
    adw_switch_row_set_active(widget, is_active);
    in_init = 0;
}

void on_game_mode_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int active = adw_switch_row_get_active(widget);
    if (active) {
        g_spawn_command_line_async("sudo /usr/local/bin/mac-gamemode on", NULL);
    } else {
        g_spawn_command_line_async("sudo /usr/local/bin/mac-gamemode off", NULL);
    }
}

/* ========================================================================= */
/* Dynamic Real GPU Allocation (System, Applications, Games) & Reboot Row   */
/* ========================================================================= */

typedef struct {
    char pretty_name[128];
    char raw_name[128];
    gboolean is_discrete;
} MacGPUInfo;

static MacGPUInfo g_detected_gpus[8];
static int g_detected_gpu_count = 0;

static GtkWidget *combo_gpu_system_w = NULL;
static GtkWidget *combo_gpu_apps_w = NULL;
static GtkWidget *combo_gpu_games_w = NULL;
static GtkWidget *gpu_reboot_row_w = NULL;

static char *prettify_gpu_name(const char *raw) {
    if (!raw) return g_strdup("Невідома відеокарта");

    char clean[256];
    g_strlcpy(clean, raw, sizeof(clean));

    /* Strip multibyte trademark (™: \xe2\x84\xa2) and registered (®: \xc2\xae) */
    char *tm;
    while ((tm = strstr(clean, "\xe2\x84\xa2")) != NULL) {
        memmove(tm, tm + 3, strlen(tm + 3) + 1);
    }
    while ((tm = strstr(clean, "\xc2\xae")) != NULL) {
        memmove(tm, tm + 2, strlen(tm + 2) + 1);
    }

    /* Extract bracketed model name, e.g. [GeForce RTX 3050 6GB Laptop GPU] or [UHD Graphics] */
    char *bracket_start = strchr(clean, '[');
    char *bracket_end = bracket_start ? strchr(bracket_start, ']') : NULL;
    char model_extracted[128] = {0};
    if (bracket_start && bracket_end && bracket_end > bracket_start + 1) {
        int len = bracket_end - (bracket_start + 1);
        if (len < (int)sizeof(model_extracted)) {
            strncpy(model_extracted, bracket_start + 1, len);
            model_extracted[len] = '\0';
        }
    }

    gboolean is_nvidia = (strcasestr(clean, "NVIDIA") != NULL);
    gboolean is_intel = (strcasestr(clean, "Intel") != NULL);
    gboolean is_amd = (strcasestr(clean, "AMD") != NULL || strcasestr(clean, "Radeon") != NULL);

    if (model_extracted[0] != '\0') {
        char *lap = strcasestr(model_extracted, " Laptop GPU");
        if (lap) *lap = '\0';
        lap = strcasestr(model_extracted, " laptop GPU");
        if (lap) *lap = '\0';

        if (is_nvidia && !strcasestr(model_extracted, "NVIDIA")) {
            return g_strdup_printf("NVIDIA %s", model_extracted);
        } else if (is_intel && !strcasestr(model_extracted, "Intel")) {
            return g_strdup_printf("Intel %s", model_extracted);
        } else if (is_amd && !strcasestr(model_extracted, "AMD")) {
            return g_strdup_printf("AMD %s", model_extracted);
        } else {
            return g_strdup(model_extracted);
        }
    }

    return g_strdup(clean);
}

static void detect_system_gpus(void) {
    if (g_detected_gpu_count > 0) return;

    /* 1. SwitcherooControl D-Bus */
    GError *err = NULL;
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, &err);
    if (bus) {
        GVariant *res = g_dbus_connection_call_sync(bus,
            "net.hadess.SwitcherooControl",
            "/net/hadess/SwitcherooControl",
            "org.freedesktop.DBus.Properties",
            "Get",
            g_variant_new("(ss)", "net.hadess.SwitcherooControl", "GPUs"),
            G_VARIANT_TYPE("(v)"),
            G_DBUS_CALL_FLAGS_NONE,
            -1, NULL, &err);
        if (res) {
            GVariant *val = NULL;
            g_variant_get(res, "(v)", &val);
            if (val) {
                GVariantIter iter;
                g_variant_iter_init(&iter, val);
                GVariant *dict = NULL;
                while ((dict = g_variant_iter_next_value(&iter)) && g_detected_gpu_count < 8) {
                    const char *raw = NULL;
                    gboolean disc = FALSE;
                    g_variant_lookup(dict, "Name", "&s", &raw);
                    g_variant_lookup(dict, "Discrete", "b", &disc);
                    if (raw) {
                        char *pretty = prettify_gpu_name(raw);
                        g_strlcpy(g_detected_gpus[g_detected_gpu_count].pretty_name, pretty, 128);
                        g_strlcpy(g_detected_gpus[g_detected_gpu_count].raw_name, raw, 128);
                        g_detected_gpus[g_detected_gpu_count].is_discrete = disc;
                        g_detected_gpu_count++;
                        g_free(pretty);
                    }
                    g_variant_unref(dict);
                }
                g_variant_unref(val);
            }
            g_variant_unref(res);
        } else if (err) {
            g_clear_error(&err);
        }
        g_object_unref(bus);
    }

    /* 2. Fallback: lspci */
    if (g_detected_gpu_count == 0) {
        FILE *fp = popen("lspci 2>/dev/null", "r");
        if (fp) {
            char line[256];
            while (fgets(line, sizeof(line), fp) && g_detected_gpu_count < 8) {
                if (strstr(line, "VGA compatible controller:") || strstr(line, "3D controller:")) {
                    char *colon = strchr(line, ':');
                    if (colon) {
                        colon = strchr(colon + 1, ':');
                        if (colon) {
                            char *raw = colon + 1;
                            while (*raw == ' ') raw++;
                            g_strstrip(raw);
                            char *pretty = prettify_gpu_name(raw);
                            gboolean disc = (strcasestr(line, "3D") || strcasestr(line, "NVIDIA") || strcasestr(line, "AMD"));
                            g_strlcpy(g_detected_gpus[g_detected_gpu_count].pretty_name, pretty, 128);
                            g_strlcpy(g_detected_gpus[g_detected_gpu_count].raw_name, raw, 128);
                            g_detected_gpus[g_detected_gpu_count].is_discrete = disc;
                            g_detected_gpu_count++;
                            g_free(pretty);
                        }
                    }
                }
            }
            pclose(fp);
        }
    }

    /* 3. Fallback: default entry */
    if (g_detected_gpu_count == 0) {
        g_strlcpy(g_detected_gpus[0].pretty_name, "Інтегрована відеокарта", 128);
        g_detected_gpus[0].is_discrete = FALSE;
        g_detected_gpu_count = 1;
    }
}

static GtkStringList *create_gpu_string_list(void) {
    detect_system_gpus();
    GtkStringList *sl = gtk_string_list_new(NULL);
    for (int i = 0; i < g_detected_gpu_count; i++) {
        gtk_string_list_append(sl, g_detected_gpus[i].pretty_name);
    }
    return sl;
}

static gboolean check_pending_reboot(void) {
    char cur_boot_id[64] = {0};
    FILE *bf = fopen("/proc/sys/kernel/random/boot_id", "r");
    if (bf) {
        if (fgets(cur_boot_id, sizeof(cur_boot_id), bf)) {
            g_strstrip(cur_boot_id);
        }
        fclose(bf);
    }
    if (cur_boot_id[0] == '\0') return FALSE;

    char *user_path = g_build_filename(g_get_home_dir(), ".config", "mac-gpu-targets.json", NULL);
    const char *paths[] = { "/etc/mac-gpu-targets.json", user_path, NULL };
    gboolean pending = FALSE;

    for (int i = 0; i < 2; i++) {
        if (!paths[i] || !g_file_test(paths[i], G_FILE_TEST_EXISTS)) continue;
        JsonParser *parser = json_parser_new();
        if (json_parser_load_from_file(parser, paths[i], NULL)) {
            JsonNode *root = json_parser_get_root(parser);
            if (JSON_NODE_HOLDS_OBJECT(root)) {
                JsonObject *obj = json_node_get_object(root);
                if (json_object_has_member(obj, "pending_boot_id")) {
                    const char *p_id = json_object_get_string_member(obj, "pending_boot_id");
                    if (p_id && strcmp(p_id, cur_boot_id) == 0) {
                        pending = TRUE;
                    }
                }
            }
        }
        g_object_unref(parser);
        if (pending) break;
    }
    g_free(user_path);
    return pending;
}

static void load_gpu_targets(guint *out_sys, guint *out_apps, guint *out_games) {
    detect_system_gpus();
    guint default_disc = (g_detected_gpu_count > 1) ? 1 : 0;
    *out_sys = 0;
    *out_apps = 0;
    *out_games = default_disc;

    char *user_path = g_build_filename(g_get_home_dir(), ".config", "mac-gpu-targets.json", NULL);
    const char *paths[] = { "/etc/mac-gpu-targets.json", user_path, NULL };
    gboolean loaded = FALSE;

    for (int i = 0; i < 2; i++) {
        if (!paths[i] || !g_file_test(paths[i], G_FILE_TEST_EXISTS)) continue;
        JsonParser *parser = json_parser_new();
        if (json_parser_load_from_file(parser, paths[i], NULL)) {
            JsonNode *root = json_parser_get_root(parser);
            if (JSON_NODE_HOLDS_OBJECT(root)) {
                JsonObject *obj = json_node_get_object(root);
                if (json_object_has_member(obj, "system"))
                    *out_sys = (guint)json_object_get_int_member(obj, "system");
                if (json_object_has_member(obj, "apps"))
                    *out_apps = (guint)json_object_get_int_member(obj, "apps");
                if (json_object_has_member(obj, "games"))
                    *out_games = (guint)json_object_get_int_member(obj, "games");
                loaded = TRUE;
            }
        }
        g_object_unref(parser);
        if (loaded) break;
    }
    g_free(user_path);

    if (!loaded) {
        FILE *sf = fopen("/etc/mac-gpu.state", "r");
        if (sf) {
            char mode[32] = {0};
            if (fgets(mode, sizeof(mode), sf)) {
                g_strstrip(mode);
                if (strcmp(mode, "nvidia") == 0) {
                    *out_sys = default_disc;
                    *out_apps = default_disc;
                    *out_games = default_disc;
                } else if (strcmp(mode, "apps_nvidia") == 0) {
                    *out_sys = 0;
                    *out_apps = default_disc;
                    *out_games = default_disc;
                } else if (strcmp(mode, "intel") == 0) {
                    *out_sys = 0;
                    *out_apps = 0;
                    *out_games = 0;
                } else {
                    *out_sys = 0;
                    *out_apps = 0;
                    *out_games = default_disc;
                }
            }
            fclose(sf);
        }
    }

    if (*out_sys >= (guint)g_detected_gpu_count) *out_sys = 0;
    if (*out_apps >= (guint)g_detected_gpu_count) *out_apps = 0;
    if (*out_games >= (guint)g_detected_gpu_count) *out_games = default_disc;
}

static void save_gpu_targets(guint sys, guint apps, guint games) {
    char cur_boot_id[64] = {0};
    FILE *bf = fopen("/proc/sys/kernel/random/boot_id", "r");
    if (bf) {
        if (fgets(cur_boot_id, sizeof(cur_boot_id), bf)) {
            g_strstrip(cur_boot_id);
        }
        fclose(bf);
    }

    char *user_dir = g_build_filename(g_get_home_dir(), ".config", NULL);
    g_mkdir_with_parents(user_dir, 0755);
    char *user_path = g_build_filename(user_dir, "mac-gpu-targets.json", NULL);
    g_free(user_dir);

    char *json_content = g_strdup_printf(
        "{\n  \"system\": %u,\n  \"apps\": %u,\n  \"games\": %u,\n  \"pending_boot_id\": \"%s\"\n}\n",
        sys, apps, games, cur_boot_id
    );
    g_file_set_contents(user_path, json_content, -1, NULL);
    g_free(user_path);
    g_free(json_content);

    char *cmd = g_strdup_printf("sudo /usr/local/bin/mac-gpu-manager set-targets %u %u %u", sys, apps, games);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
}

static int in_gpu_init = 0;
static gboolean all_gpus_initialized = FALSE;

static void trigger_gpu_change(void) {
    if (in_gpu_init > 0 || in_init || !all_gpus_initialized) return;
    if (!combo_gpu_system_w || !combo_gpu_apps_w || !combo_gpu_games_w) return;

    guint sys_idx = adw_combo_row_get_selected(ADW_COMBO_ROW(combo_gpu_system_w));
    guint apps_idx = adw_combo_row_get_selected(ADW_COMBO_ROW(combo_gpu_apps_w));
    guint games_idx = adw_combo_row_get_selected(ADW_COMBO_ROW(combo_gpu_games_w));

    save_gpu_targets(sys_idx, apps_idx, games_idx);

    if (gpu_reboot_row_w) {
        gtk_widget_set_visible(gpu_reboot_row_w, TRUE);
    }
}

void init_gpu_system(void *widget, gpointer data) {
    (void)data;
    combo_gpu_system_w = GTK_WIDGET(widget);
    g_object_add_weak_pointer(G_OBJECT(widget), (gpointer *)&combo_gpu_system_w);

    in_gpu_init++;
    GtkStringList *sl = create_gpu_string_list();
    adw_combo_row_set_model(ADW_COMBO_ROW(widget), G_LIST_MODEL(sl));
    g_object_unref(sl);

    guint s = 0, a = 0, g = 0;
    load_gpu_targets(&s, &a, &g);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), s);
    in_gpu_init--;

    if (combo_gpu_system_w && combo_gpu_apps_w && combo_gpu_games_w) {
        all_gpus_initialized = TRUE;
    }
}

void on_gpu_system_changed(void *widget, void *pspec, gpointer data) {
    (void)widget; (void)pspec; (void)data;
    trigger_gpu_change();
}

void init_gpu_apps(void *widget, gpointer data) {
    (void)data;
    combo_gpu_apps_w = GTK_WIDGET(widget);
    g_object_add_weak_pointer(G_OBJECT(widget), (gpointer *)&combo_gpu_apps_w);

    in_gpu_init++;
    GtkStringList *sl = create_gpu_string_list();
    adw_combo_row_set_model(ADW_COMBO_ROW(widget), G_LIST_MODEL(sl));
    g_object_unref(sl);

    guint s = 0, a = 0, g = 0;
    load_gpu_targets(&s, &a, &g);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), a);
    in_gpu_init--;

    if (combo_gpu_system_w && combo_gpu_apps_w && combo_gpu_games_w) {
        all_gpus_initialized = TRUE;
    }
}

void on_gpu_apps_changed(void *widget, void *pspec, gpointer data) {
    (void)widget; (void)pspec; (void)data;
    trigger_gpu_change();
}

void init_gpu_games(void *widget, gpointer data) {
    (void)data;
    combo_gpu_games_w = GTK_WIDGET(widget);
    g_object_add_weak_pointer(G_OBJECT(widget), (gpointer *)&combo_gpu_games_w);

    in_gpu_init++;
    GtkStringList *sl = create_gpu_string_list();
    adw_combo_row_set_model(ADW_COMBO_ROW(widget), G_LIST_MODEL(sl));
    g_object_unref(sl);

    guint s = 0, a = 0, g = 0;
    load_gpu_targets(&s, &a, &g);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), g);
    in_gpu_init--;

    if (combo_gpu_system_w && combo_gpu_apps_w && combo_gpu_games_w) {
        all_gpus_initialized = TRUE;
    }
}

void on_gpu_games_changed(void *widget, void *pspec, gpointer data) {
    (void)widget; (void)pspec; (void)data;
    trigger_gpu_change();
}

static void trigger_system_reboot(void) {
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (bus) {
        g_dbus_connection_call(bus,
                               "org.gnome.SessionManager",
                               "/org/gnome/SessionManager",
                               "org.gnome.SessionManager",
                               "Reboot",
                               NULL,
                               NULL,
                               G_DBUS_CALL_FLAGS_NONE,
                               -1,
                               NULL,
                               NULL,
                               NULL);
        g_object_unref(bus);
    }

    GDBusConnection *sys_bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, NULL);
    if (sys_bus) {
        g_dbus_connection_call(sys_bus,
                               "org.freedesktop.login1",
                               "/org/freedesktop/login1",
                               "org.freedesktop.login1.Manager",
                               "Reboot",
                               g_variant_new("(b)", TRUE),
                               NULL,
                               G_DBUS_CALL_FLAGS_NONE,
                               -1,
                               NULL,
                               NULL,
                               NULL);
        g_object_unref(sys_bus);
    }

    g_spawn_command_line_async("systemctl reboot", NULL);
    g_spawn_command_line_async("gnome-session-quit --reboot --no-prompt", NULL);
}

void on_gpu_reboot_clicked(void *button, gpointer data) {
    (void)button; (void)data;
    trigger_system_reboot();
}

void init_gpu_reboot_button(void *widget, gpointer data) {
    (void)data;
    if (widget && GTK_IS_BUTTON(widget)) {
        g_signal_connect(widget, "clicked", G_CALLBACK(on_gpu_reboot_clicked), NULL);
    }
}

static void connect_reboot_button_recursive(GtkWidget *w) {
    if (!w) return;
    if (GTK_IS_BUTTON(w)) {
        g_signal_connect(w, "clicked", G_CALLBACK(on_gpu_reboot_clicked), NULL);
        return;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(w); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        connect_reboot_button_recursive(c);
    }
}

void init_gpu_reboot_row(void *widget, gpointer data) {
    (void)data;
    gpu_reboot_row_w = GTK_WIDGET(widget);
    g_object_add_weak_pointer(G_OBJECT(widget), (gpointer *)&gpu_reboot_row_w);

    connect_reboot_button_recursive(GTK_WIDGET(widget));

    gboolean pending = check_pending_reboot();
    gtk_widget_set_visible(GTK_WIDGET(widget), pending);
}

/* Stubs for backward compatibility if ever referenced */
void init_gpu_mode(void *widget, gpointer data) {
    (void)widget; (void)data;
}

void on_gpu_mode_changed(void *widget, void *pspec, gpointer data) {
    (void)widget; (void)pspec; (void)data;
}

static void load_touchpad_conf_full(int *drag_mode, int *copy_paste, int *delay_ms) {
    *drag_mode = 0;
    *copy_paste = 1;
    *delay_ms = 250;
    const char *home = g_get_home_dir();
    char *conf_path = g_build_filename(home, ".config", "mac-touchpad.conf", NULL);
    FILE *f = fopen(conf_path, "r");
    if (f) {
        char line[256];
        while (fgets(line, sizeof(line), f)) {
            if (strstr(line, "drag_mode=normal")) *drag_mode = 1;
            else if (strstr(line, "drag_mode=fullscreen")) *drag_mode = 0;
            else if (strstr(line, "copy_paste_enabled=0")) *copy_paste = 0;
            else if (strstr(line, "copy_paste_enabled=1")) *copy_paste = 1;
            else if (sscanf(line, "gesture_delay_ms=%d", delay_ms) == 1) {}
        }
        fclose(f);
    }
    g_free(conf_path);
}

static void save_touchpad_conf_full(int drag_mode, int copy_paste, int delay_ms) {
    const char *home = g_get_home_dir();
    char *conf_path = g_build_filename(home, ".config", "mac-touchpad.conf", NULL);
    FILE *f = fopen(conf_path, "w");
    if (f) {
        fprintf(f, "drag_mode=%s\n", drag_mode == 1 ? "normal" : "fullscreen");
        fprintf(f, "copy_paste_enabled=%d\n", copy_paste ? 1 : 0);
        fprintf(f, "gesture_delay_ms=%d\n", delay_ms);
        fclose(f);
    }
    g_free(conf_path);
}

void init_touchpad_drag_mode(void *widget, gpointer data) {
    in_init = 1;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    adw_combo_row_set_selected(widget, drag_mode);
    in_init = 0;
}

void on_touchpad_drag_mode_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    drag_mode = adw_combo_row_get_selected(widget);
    save_touchpad_conf_full(drag_mode, copy_paste, delay_ms);
}

void init_touchpad_copy_paste(void *widget, gpointer data) {
    in_init = 1;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    adw_switch_row_set_active(widget, copy_paste);
    in_init = 0;
}

void on_touchpad_copy_paste_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    copy_paste = adw_switch_row_get_active(widget);
    save_touchpad_conf_full(drag_mode, copy_paste, delay_ms);
}

void init_touchpad_gesture_delay(void *widget, gpointer data) {
    in_init = 1;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    adw_spin_row_set_value(widget, (double)delay_ms);
    in_init = 0;
}

void on_touchpad_gesture_delay_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    int drag_mode, copy_paste, delay_ms;
    load_touchpad_conf_full(&drag_mode, &copy_paste, &delay_ms);
    delay_ms = (int)adw_spin_row_get_value(widget);
    save_touchpad_conf_full(drag_mode, copy_paste, delay_ms);
}

static gboolean is_settings(void)
{
    static int cached = -1;
    if (cached != -1) return cached;
    const char *prg = program_invocation_short_name;
    if (prg && (strcmp(prg, "gnome-control-center") == 0 ||
                strcmp(prg, "gnome-control-center.orig") == 0 ||
                strcmp(prg, "org.gnome.Settings") == 0)) {
        cached = 1;
    } else {
        cached = 0;
    }
    return cached;
}

static void (*orig_settings_gtk_window_present)(GtkWindow *window) = NULL;
static void (*orig_settings_gtk_window_present_with_time)(GtkWindow *window, guint32 timestamp) = NULL;

static void hide_title_labels(GtkWidget *widget)
{
    if (!widget) return;
    if (GTK_IS_LABEL(widget)) {
        const char *txt = gtk_label_get_text(GTK_LABEL(widget));
        if (txt && (g_str_has_prefix(txt, "Парам") ||
                    g_str_equal(txt, "Settings") ||
                    g_str_equal(txt, "Paramètres") ||
                    g_str_equal(txt, "Einstellungen"))) {
            gtk_widget_set_visible(widget, FALSE);
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        hide_title_labels(child);
    }
}

static void find_buttons_in_settings_sidebar(GtkWidget *widget, GtkWidget **search_btn, GtkWidget **menu_btn)
{
    if (!widget) return;
    if (GTK_IS_TOGGLE_BUTTON(widget)) {
        const char *icon = gtk_button_get_icon_name(GTK_BUTTON(widget));
        const char *tooltip = gtk_widget_get_tooltip_text(widget);
        if (g_strcmp0(icon, "edit-find-symbolic") == 0 ||
            (tooltip && (g_str_equal(tooltip, "Search") || g_str_equal(tooltip, "Пошук")))) {
            *search_btn = widget;
        }
    } else if (GTK_IS_MENU_BUTTON(widget)) {
        const char *icon = gtk_menu_button_get_icon_name(GTK_MENU_BUTTON(widget));
        const char *tooltip = gtk_widget_get_tooltip_text(widget);
        if (g_strcmp0(icon, "open-menu-symbolic") == 0 ||
            (tooltip && (g_str_equal(tooltip, "Main Menu") || g_str_equal(tooltip, "Головне меню")))) {
            *menu_btn = widget;
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_buttons_in_settings_sidebar(child, search_btn, menu_btn);
    }
}

static void find_headerbars_recursive(GtkWidget *widget, GList **list)
{
    if (!widget) return;
    if (ADW_IS_HEADER_BAR(widget)) {
        *list = g_list_append(*list, widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_headerbars_recursive(child, list);
    }
}

static void find_navigation_split_view(GtkWidget *widget, AdwNavigationSplitView **split_view)
{
    if (!widget || *split_view) return;
    if (ADW_IS_NAVIGATION_SPLIT_VIEW(widget)) {
        *split_view = ADW_NAVIGATION_SPLIT_VIEW(widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_navigation_split_view(child, split_view);
    }
}

static void remove_from_headerbar(AdwHeaderBar *hb, GtkWidget *widget)
{
    if (!hb || !widget) return;
    adw_header_bar_remove(hb, widget);
    GtkWidget *parent = gtk_widget_get_parent(widget);
    if (parent && GTK_IS_BOX(parent)) {
        gtk_box_remove(GTK_BOX(parent), widget);
    }
}

static void find_navigation_views(GtkWidget *widget, GList **list)
{
    if (!widget) return;
    if (ADW_IS_NAVIGATION_VIEW(widget)) {
        *list = g_list_append(*list, widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_navigation_views(child, list);
    }
}

static void update_panel_headerbar(AdwNavigationSplitView *split_view);

static void on_visible_page_changed_cb(GObject *gobject G_GNUC_UNUSED, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    update_panel_headerbar(split_view);
}

static void update_panel_headerbar(AdwNavigationSplitView *split_view)
{
    if (!split_view) return;
    GtkWidget *search_btn = g_object_get_data(G_OBJECT(split_view), "mac_search_btn");
    GtkWidget *menu_btn = g_object_get_data(G_OBJECT(split_view), "mac_menu_btn");
    if (!search_btn || !menu_btn) return;

    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (!content_page) return;

    /* Check if content_page has an AdwNavigationView with a visible page */
    GList *nav_views = NULL;
    find_navigation_views(GTK_WIDGET(content_page), &nav_views);
    GtkWidget *target_root = GTK_WIDGET(content_page);

    if (nav_views) {
        AdwNavigationView *nv = ADW_NAVIGATION_VIEW(nav_views->data);
        if (!g_object_get_data(G_OBJECT(nv), "mac_connected")) {
            g_signal_connect(nv, "notify::visible-page", G_CALLBACK(on_visible_page_changed_cb), split_view);
            g_object_set_data(G_OBJECT(nv), "mac_connected", GINT_TO_POINTER(1));
        }
        if (g_getenv("MAC_SETTINGS_OPEN_STYLING") && !g_object_get_data(G_OBJECT(nv), "mac_styling_pushed")) {
            g_object_set_data(G_OBJECT(nv), "mac_styling_pushed", GINT_TO_POINTER(1));
            adw_navigation_view_push_by_tag(nv, "mac-styling");
        }
        AdwNavigationPage *vis_p = adw_navigation_view_get_visible_page(nv);
        if (vis_p) {
            target_root = GTK_WIDGET(vis_p);
        }
        g_list_free(nav_views);
    }

    GList *content_bars = NULL;
    find_headerbars_recursive(target_root, &content_bars);
    if (!content_bars) return;

    AdwHeaderBar *target_hb = ADW_HEADER_BAR(content_bars->data);

    /* Remove from previous parent if different */
    GtkWidget *p_menu = gtk_widget_get_parent(menu_btn);
    if (p_menu && p_menu != GTK_WIDGET(target_hb)) {
        if (ADW_IS_HEADER_BAR(p_menu)) {
            remove_from_headerbar(ADW_HEADER_BAR(p_menu), menu_btn);
        } else if (GTK_IS_BOX(p_menu)) {
            gtk_box_remove(GTK_BOX(p_menu), menu_btn);
        }
    }

    GtkWidget *p_search = gtk_widget_get_parent(search_btn);
    if (p_search && p_search != GTK_WIDGET(target_hb)) {
        if (ADW_IS_HEADER_BAR(p_search)) {
            remove_from_headerbar(ADW_HEADER_BAR(p_search), search_btn);
        } else if (GTK_IS_BOX(p_search)) {
            gtk_box_remove(GTK_BOX(p_search), search_btn);
        }
    }

    /* Pack into target_hb: menu_btn at far right, search_btn to its left */
    if (gtk_widget_get_parent(menu_btn) != GTK_WIDGET(target_hb)) {
        adw_header_bar_pack_end(target_hb, menu_btn);
    }
    if (gtk_widget_get_parent(search_btn) != GTK_WIDGET(target_hb)) {
        adw_header_bar_pack_end(target_hb, search_btn);
    }
    gtk_widget_set_visible(menu_btn, TRUE);
    gtk_widget_set_visible(search_btn, TRUE);

    g_list_free(content_bars);
}

static void on_content_changed_cb(GObject *gobject G_GNUC_UNUSED, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    update_panel_headerbar(split_view);
}

static gboolean mac_fix_settings_window(gpointer user_data)
{
    GtkWindow *window = GTK_WINDOW(user_data);
    if (!window || !GTK_IS_WINDOW(window)) return G_SOURCE_REMOVE;

    AdwNavigationSplitView *split_view = NULL;
    find_navigation_split_view(GTK_WIDGET(window), &split_view);
    if (!split_view) return G_SOURCE_REMOVE;

    /* Lock sidebar width to 280px to match blur and prevent unblurred scrollbar gaps */
    adw_navigation_split_view_set_min_sidebar_width(split_view, 280.0);
    adw_navigation_split_view_set_max_sidebar_width(split_view, 280.0);

    if (!g_object_get_data(G_OBJECT(split_view), "mac_signals_connected")) {
        g_signal_connect(split_view, "notify::content", G_CALLBACK(on_content_changed_cb), split_view);
        g_object_set_data(G_OBJECT(split_view), "mac_signals_connected", GINT_TO_POINTER(1));
    }

    AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
    if (!sidebar) return G_SOURCE_REMOVE;

    /* Lock empty title on sidebar page */
    if (ADW_IS_NAVIGATION_PAGE(sidebar)) {
        adw_navigation_page_set_title(sidebar, "");
    }

    GList *sidebar_bars = NULL;
    find_headerbars_recursive(GTK_WIDGET(sidebar), &sidebar_bars);
    if (sidebar_bars) {
        AdwHeaderBar *sidebar_hb = ADW_HEADER_BAR(sidebar_bars->data);

        /* 1. Hide title and any title labels in sidebar headerbar */
        adw_header_bar_set_show_title(sidebar_hb, FALSE);
        adw_header_bar_set_title_widget(sidebar_hb, NULL);
        hide_title_labels(GTK_WIDGET(sidebar_hb));

        /* 2. Find and remove search_button and menu_button */
        GtkWidget *search_btn = g_object_get_data(G_OBJECT(split_view), "mac_search_btn");
        GtkWidget *menu_btn = g_object_get_data(G_OBJECT(split_view), "mac_menu_btn");

        if (!search_btn || !menu_btn) {
            find_buttons_in_settings_sidebar(GTK_WIDGET(sidebar_hb), &search_btn, &menu_btn);
            if (search_btn && menu_btn) {
                g_object_ref(search_btn);
                g_object_ref(menu_btn);
                g_object_set_data_full(G_OBJECT(split_view), "mac_search_btn", search_btn, g_object_unref);
                g_object_set_data_full(G_OBJECT(split_view), "mac_menu_btn", menu_btn, g_object_unref);

                remove_from_headerbar(sidebar_hb, search_btn);
                remove_from_headerbar(sidebar_hb, menu_btn);
            }
        }
        g_list_free(sidebar_bars);
    }

    update_panel_headerbar(split_view);
    return G_SOURCE_REMOVE;
}

void gtk_window_present(GtkWindow *window)
{
    if (!orig_settings_gtk_window_present) {
        orig_settings_gtk_window_present = dlsym(RTLD_NEXT, "gtk_window_present");
    }
    if (orig_settings_gtk_window_present) {
        orig_settings_gtk_window_present(window);
    }
    if (is_settings() && window) {
        mac_fix_settings_window(window);
        g_idle_add(mac_fix_settings_window, window);
    }
}

void gtk_window_present_with_time(GtkWindow *window, guint32 timestamp)
{
    if (!orig_settings_gtk_window_present_with_time) {
        orig_settings_gtk_window_present_with_time = dlsym(RTLD_NEXT, "gtk_window_present_with_time");
    }
    if (orig_settings_gtk_window_present_with_time) {
        orig_settings_gtk_window_present_with_time(window, timestamp);
    }
    if (is_settings() && window) {
        mac_fix_settings_window(window);
        g_idle_add(mac_fix_settings_window, window);
    }
}



