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

    int menu_tint;      /* 0 - 100 */
    int menu_blur;      /* 0 - 100 */
    int menu_shadow_blur;     /* 0 - 100 (radius px) */
    int menu_shadow_strength; /* 0 - 100 (intensity %) */

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

    .menu_tint = 35,
    .menu_blur = 30,
    .menu_shadow_blur = 30,
    .menu_shadow_strength = 55,

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
static guint json_timer_id = 0;
static guint css_timer_id = 0;
static guint menubar_blur_timer_id = 0;
static guint liquid_blur_timer_id = 0;
static guint liquid_tint_timer_id = 0;
static guint blur_sigma_timer_id = 0;
static guint blur_tint_timer_id = 0;
static guint menu_blur_timer_id = 0;
static guint menu_tint_timer_id = 0;
static guint menu_shadow_timer_id = 0;

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

            /* Group 4: Context Menu */
            if (json_object_has_member(obj, "menu_tint"))
                state.menu_tint = (int)json_object_get_int_member(obj, "menu_tint");
            else
                state.menu_tint = 35;

            if (json_object_has_member(obj, "menu_blur"))
                state.menu_blur = (int)json_object_get_int_member(obj, "menu_blur");
            else
                state.menu_blur = 30;

            if (json_object_has_member(obj, "menu_shadow_blur"))
                state.menu_shadow_blur = (int)json_object_get_int_member(obj, "menu_shadow_blur");
            else
                state.menu_shadow_blur = 30;

            if (json_object_has_member(obj, "menu_shadow_strength"))
                state.menu_shadow_strength = (int)json_object_get_int_member(obj, "menu_shadow_strength");
            else
                state.menu_shadow_strength = 55;

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

    char dock_tint_buf[16];
    char panel_tint_buf[16];
    char notif_tint_buf[16];
    g_ascii_formatd(dock_tint_buf, sizeof(dock_tint_buf), "%.2f", (double)state.blur_tint / 100.0);
    g_ascii_formatd(panel_tint_buf, sizeof(panel_tint_buf), "%.2f", (double)state.menubar_tint / 100.0);
    g_ascii_formatd(notif_tint_buf, sizeof(notif_tint_buf), "%.2f", (double)state.blur_tint / 100.0);

    char *json = g_strdup_printf(
        "{\n"
        "  \"menubar_tint\": %d,\n"
        "  \"menubar_blur\": %d,\n"
        "  \"liquid_blur\": %d,\n"
        "  \"liquid_tint\": %d,\n"
        "  \"blur_sigma\": %d,\n"
        "  \"blur_tint\": %d,\n"
        "  \"menu_tint\": %d,\n"
        "  \"menu_blur\": %d,\n"
        "  \"menu_shadow_blur\": %d,\n"
        "  \"menu_shadow_strength\": %d,\n"
        "  \"dock_blur\": %s,\n"
        "  \"dock_sigma\": %d,\n"
        "  \"dock_tint\": %s,\n"
        "  \"dock_radius\": %d,\n"
        "  \"panel_blur\": %s,\n"
        "  \"panel_sigma\": %d,\n"
        "  \"panel_tint\": %s,\n"
        "  \"qs_sigma\": %d,\n"
        "  \"notif_blur\": %s,\n"
        "  \"notif_sigma\": %d,\n"
        "  \"notif_tint\": %s,\n"
        "  \"notif_radius\": %d\n"
        "}\n",
        state.menubar_tint,
        state.menubar_blur,
        state.liquid_blur,
        state.liquid_tint,
        state.blur_sigma,
        state.blur_tint,
        state.menu_tint,
        state.menu_blur,
        state.menu_shadow_blur,
        state.menu_shadow_strength,
        (state.blur_sigma > 0) ? "true" : "false",
        state.blur_sigma,
        dock_tint_buf,
        28,
        (state.menubar_blur > 0) ? "true" : "false",
        state.menubar_blur,
        panel_tint_buf,
        state.blur_sigma,
        (state.blur_sigma > 0) ? "true" : "false",
        state.blur_sigma,
        notif_tint_buf,
        18
    );
    g_file_set_contents(path, json, -1, NULL);
    g_free(json);
    g_free(path);
    g_free(dir);
}

static gboolean save_json_cb(gpointer user_data) {
    (void)user_data;
    json_timer_id = 0;
    save_styling_json();
    return G_SOURCE_REMOVE;
}

static void schedule_json_save(void) {
    if (json_timer_id != 0) {
        g_source_remove(json_timer_id);
    }
    json_timer_id = g_timeout_add(250, (GSourceFunc)save_json_cb, NULL);
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
    css_timer_id = g_timeout_add(350, (GSourceFunc)save_css_cb, NULL);
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

static gboolean apply_menubar_blur_cb(gpointer user_data) {
    (void)user_data;
    menubar_blur_timer_id = 0;
    apply_menubar_blur();
    return G_SOURCE_REMOVE;
}

static void schedule_menubar_blur_apply(void) {
    if (menubar_blur_timer_id == 0) {
        menubar_blur_timer_id = g_timeout_add(60, (GSourceFunc)apply_menubar_blur_cb, NULL);
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

static gboolean apply_liquid_blur_cb(gpointer user_data) {
    (void)user_data;
    liquid_blur_timer_id = 0;
    apply_liquid_blur();
    return G_SOURCE_REMOVE;
}

static void schedule_liquid_blur_apply(void) {
    if (liquid_blur_timer_id == 0) {
        liquid_blur_timer_id = g_timeout_add(60, (GSourceFunc)apply_liquid_blur_cb, NULL);
    }
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
    g_settings_set_string(lg, "menu-tint-color", "#000000");
    g_settings_set_string(lg, "desktop-menu-tint-color", "#000000");
    g_settings_set_string(lg, "panel-menu-tint-color", "#000000");
    g_object_unref(lg);
}

static gboolean apply_liquid_tint_cb(gpointer user_data) {
    (void)user_data;
    liquid_tint_timer_id = 0;
    apply_liquid_tint();
    return G_SOURCE_REMOVE;
}

static void schedule_liquid_tint_apply(void) {
    if (liquid_tint_timer_id == 0) {
        liquid_tint_timer_id = g_timeout_add(60, (GSourceFunc)apply_liquid_tint_cb, NULL);
    }
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

static gboolean apply_blur_sigma_cb(gpointer user_data) {
    (void)user_data;
    blur_sigma_timer_id = 0;
    apply_blur_sigma();
    return G_SOURCE_REMOVE;
}

static void schedule_blur_sigma_apply(void) {
    if (blur_sigma_timer_id == 0) {
        blur_sigma_timer_id = g_timeout_add(60, (GSourceFunc)apply_blur_sigma_cb, NULL);
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

static gboolean apply_blur_tint_cb(gpointer user_data) {
    (void)user_data;
    blur_tint_timer_id = 0;
    apply_blur_tint();
    return G_SOURCE_REMOVE;
}

static void schedule_blur_tint_apply(void) {
    if (blur_tint_timer_id == 0) {
        blur_tint_timer_id = g_timeout_add(60, (GSourceFunc)apply_blur_tint_cb, NULL);
    }
}

/* Group 4: Context Menu (apply to liquid-glass & blur-my-shell) */
static void apply_menu_blur(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE)) {
        GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
        int radius = (state.menu_blur > 0) ? (int)round((double)state.menu_blur * 30.0 / 100.0) : 0;
        if (state.menu_blur > 0 && radius < 1) radius = 1;

        g_settings_set_int(lg, "menu-blur-radius", radius);
        g_settings_set_int(lg, "desktop-menu-blur-radius", radius);
        g_settings_set_int(lg, "panel-menu-blur-radius", radius);
        g_object_unref(lg);
    }

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.blur-my-shell.popup", TRUE)) {
        GSettings *bms_popup = g_settings_new("org.gnome.shell.extensions.blur-my-shell.popup");
        g_settings_set_int(bms_popup, "sigma", state.menu_blur);
        g_settings_set_boolean(bms_popup, "blur", state.menu_blur > 0);
        g_object_unref(bms_popup);
    }
}

static gboolean apply_menu_blur_cb(gpointer user_data) {
    (void)user_data;
    menu_blur_timer_id = 0;
    apply_menu_blur();
    return G_SOURCE_REMOVE;
}

static void schedule_menu_blur_apply(void) {
    if (menu_blur_timer_id == 0) {
        menu_blur_timer_id = g_timeout_add(60, (GSourceFunc)apply_menu_blur_cb, NULL);
    }
}

static void apply_menu_tint(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    double tint = (double)state.menu_tint / 100.0;
    double brightness = 1.0 - (tint * 0.5);
    if (brightness < 0.2) brightness = 0.2;
    if (brightness > 1.0) brightness = 1.0;

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE)) {
        GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
        g_settings_set_string(lg, "menu-tint-color", "#000000");
        g_settings_set_string(lg, "desktop-menu-tint-color", "#000000");
        g_settings_set_string(lg, "panel-menu-tint-color", "#000000");
        g_settings_set_double(lg, "menu-tint-strength", tint);
        g_settings_set_double(lg, "desktop-menu-tint-strength", tint);
        g_settings_set_double(lg, "panel-menu-tint-strength", tint);
        g_settings_set_double(lg, "menu-brightness", brightness);
        g_settings_set_double(lg, "desktop-menu-brightness", brightness);
        g_settings_set_double(lg, "panel-menu-brightness", brightness);
        g_object_unref(lg);
    }

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.blur-my-shell.popup", TRUE)) {
        GSettings *bms_popup = g_settings_new("org.gnome.shell.extensions.blur-my-shell.popup");
        g_settings_set_double(bms_popup, "brightness", brightness);
        g_object_unref(bms_popup);
    }
}

static gboolean apply_menu_tint_cb(gpointer user_data) {
    (void)user_data;
    menu_tint_timer_id = 0;
    apply_menu_tint();
    return G_SOURCE_REMOVE;
}

static void schedule_menu_tint_apply(void) {
    if (menu_tint_timer_id == 0) {
        menu_tint_timer_id = g_timeout_add(60, (GSourceFunc)apply_menu_tint_cb, NULL);
    }
}

static void apply_menu_shadow(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE)) {
        GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
        double radius = (double)state.menu_shadow_blur;
        double intensity = (double)state.menu_shadow_strength / 100.0;
        if (intensity < 0.0) intensity = 0.0;
        if (intensity > 1.0) intensity = 1.0;

        g_settings_set_double(lg, "shadow-radius", radius);
        g_settings_set_double(lg, "shadow-intensity", intensity);
        g_object_unref(lg);
    }
}

static gboolean apply_menu_shadow_cb(gpointer user_data) {
    (void)user_data;
    menu_shadow_timer_id = 0;
    apply_menu_shadow();
    return G_SOURCE_REMOVE;
}

static void schedule_menu_shadow_apply(void) {
    if (menu_shadow_timer_id == 0) {
        menu_shadow_timer_id = g_timeout_add(60, (GSourceFunc)apply_menu_shadow_cb, NULL);
    }
}

/* Initialization signals from GtkBuilder (realize) */

/* Group 1: Меню-бар */
void init_menubar_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menubar_tint);
    in_init = 0;
}

void on_menubar_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menubar_tint = (int)lround(gtk_range_get_value(widget));
    schedule_css_save();
    schedule_json_save();
}

void init_menubar_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menubar_blur);
    in_init = 0;
}

void on_menubar_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menubar_blur = (int)lround(gtk_range_get_value(widget));
    schedule_menubar_blur_apply();
    schedule_json_save();
}

/* Group 2: Liquid Glass */
void init_liquid_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_blur);
    in_init = 0;
}

void on_liquid_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_blur = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_blur_apply();
    schedule_json_save();
}

void init_liquid_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_tint);
    in_init = 0;
}

void on_liquid_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_tint = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_tint_apply();
    schedule_json_save();
}

/* Group 3: Blur */
void init_blur_sigma(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.blur_sigma);
    in_init = 0;
}

void on_blur_sigma_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.blur_sigma = (int)lround(gtk_range_get_value(widget));
    schedule_blur_sigma_apply();
    schedule_json_save();
}

void init_blur_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.blur_tint);
    in_init = 0;
}

void on_blur_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.blur_tint = (int)lround(gtk_range_get_value(widget));
    schedule_blur_tint_apply();
    schedule_css_save();
    schedule_json_save();
}

/* Group 4: Context Menu */
void init_menu_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menu_tint);
    in_init = 0;
}

void on_menu_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menu_tint = (int)lround(gtk_range_get_value(widget));
    schedule_menu_tint_apply();
    schedule_json_save();
}

void init_menu_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menu_blur);
    in_init = 0;
}

void on_menu_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menu_blur = (int)lround(gtk_range_get_value(widget));
    schedule_menu_blur_apply();
    schedule_json_save();
}

void init_menu_shadow_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menu_shadow_blur);
    in_init = 0;
}

void on_menu_shadow_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menu_shadow_blur = (int)lround(gtk_range_get_value(widget));
    schedule_menu_shadow_apply();
    schedule_json_save();
}

void init_menu_shadow_strength(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.menu_shadow_strength);
    in_init = 0;
}

void on_menu_shadow_strength_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.menu_shadow_strength = (int)lround(gtk_range_get_value(widget));
    schedule_menu_shadow_apply();
    schedule_json_save();
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

void on_run_diagnostics_clicked(void *widget, gpointer data) {
    (void)widget; (void)data;
    g_spawn_command_line_async("ptyxis -- mac-diagnostics || gnome-terminal -- mac-diagnostics || /usr/local/bin/mac-diagnostics", NULL);
}

void on_restore_theme_clicked(void *widget, gpointer data) {
    (void)widget; (void)data;
    g_spawn_command_line_async("/bin/bash -c '/usr/local/bin/mac-apply-theme && notify-send -i preferences-desktop-theme \"macW1Y\" \"Оформлення успішно відновлено до еталону SSOT!\"'", NULL);
}

static void *g_game_mode_switch_w = NULL;

static void update_game_mode_ui_for_profile(const char *profile) {
    if (!g_game_mode_switch_w) return;
    in_init = 1;
    gboolean is_perf = (g_strcmp0(profile, "performance") == 0);
    adw_switch_row_set_active(g_game_mode_switch_w, is_perf);
    if (is_perf) {
        adw_action_row_set_subtitle(ADW_ACTION_ROW(g_game_mode_switch_w),
            "Швидкодія: Р-ядра (0-7) закріплено за іграми • Е-ядра (8-11) для фонових задач ОС");
    } else if (g_strcmp0(profile, "power-saver") == 0) {
        adw_action_row_set_subtitle(ADW_ACTION_ROW(g_game_mode_switch_w),
            "Заощадження: знижена частота ядер, тихий режим");
    } else {
        adw_action_row_set_subtitle(ADW_ACTION_ROW(g_game_mode_switch_w),
            "Баланс: стандартна швидкодія та динамічний розподіл ядер");
    }
    in_init = 0;
}

static void on_power_profiles_dbus_signal(GDBusConnection *connection,
                                         const gchar *sender_name,
                                         const gchar *object_path,
                                         const gchar *interface_name,
                                         const gchar *signal_name,
                                         GVariant *parameters,
                                         gpointer user_data) {
    (void)connection; (void)sender_name; (void)object_path; (void)interface_name; (void)signal_name; (void)user_data;
    if (!g_game_mode_switch_w) return;
    GVariant *changed_properties = NULL;
    gchar *iface_name = NULL;
    g_variant_get(parameters, "(&s@a{sv}^as)", &iface_name, &changed_properties, NULL);
    if (g_strcmp0(iface_name, "net.hadess.PowerProfiles") == 0 && changed_properties) {
        GVariant *active_prop = g_variant_lookup_value(changed_properties, "ActiveProfile", G_VARIANT_TYPE_STRING);
        if (active_prop) {
            const gchar *profile = g_variant_get_string(active_prop, NULL);
            update_game_mode_ui_for_profile(profile);
            g_variant_unref(active_prop);
        }
        g_variant_unref(changed_properties);
    }
}

void init_game_mode(void *widget, gpointer data) {
    (void)data;
    g_game_mode_switch_w = widget;
    
    char current_prof[32] = "balanced";
    GDBusConnection *sys_bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, NULL);
    if (sys_bus) {
        GVariant *v = g_dbus_connection_call_sync(sys_bus,
            "net.hadess.PowerProfiles",
            "/net/hadess/PowerProfiles",
            "org.freedesktop.DBus.Properties",
            "Get",
            g_variant_new("(ss)", "net.hadess.PowerProfiles", "ActiveProfile"),
            G_VARIANT_TYPE("(v)"),
            G_DBUS_CALL_FLAGS_NONE,
            1000, NULL, NULL);
        if (v) {
            GVariant *inner = NULL;
            g_variant_get(v, "(v)", &inner);
            if (inner) {
                const gchar *s = g_variant_get_string(inner, NULL);
                if (s) g_strlcpy(current_prof, s, sizeof(current_prof));
                g_variant_unref(inner);
            }
            g_variant_unref(v);
        }

        static int dbus_subscribed = 0;
        if (!dbus_subscribed) {
            dbus_subscribed = 1;
            g_dbus_connection_signal_subscribe(sys_bus,
                "net.hadess.PowerProfiles",
                "org.freedesktop.DBus.Properties",
                "PropertiesChanged",
                "/net/hadess/PowerProfiles",
                NULL,
                G_DBUS_SIGNAL_FLAGS_NONE,
                on_power_profiles_dbus_signal,
                NULL, NULL);
        }
    }
    
    update_game_mode_ui_for_profile(current_prof);
}

void on_game_mode_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    int active = adw_switch_row_get_active(widget);
    if (active) {
        g_spawn_command_line_async("powerprofilesctl set performance", NULL);
        g_spawn_command_line_async("sudo /usr/local/bin/mac-gamemode on", NULL);
        adw_action_row_set_subtitle(ADW_ACTION_ROW(widget),
            "Швидкодія: Р-ядра (0-7) закріплено за іграми • Е-ядра (8-11) для фонових задач ОС");
    } else {
        g_spawn_command_line_async("powerprofilesctl set balanced", NULL);
        g_spawn_command_line_async("sudo /usr/local/bin/mac-gamemode off", NULL);
        adw_action_row_set_subtitle(ADW_ACTION_ROW(widget),
            "Баланс: стандартна швидкодія та динамічний розподіл ядер");
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

/* ========================================================================= */
/* Power Mode Fan Speed Control & Dynamic Dual-Thumb Range Sliders          */
/* ========================================================================= */

typedef struct {
    int min_val; /* lower fan speed % */
    int max_val; /* upper fan speed % */
} FanRange;

typedef struct {
    FanRange cpu;
    FanRange gpu;
} ProfileFanConfig;

static ProfileFanConfig g_fan_configs[3] = {
    /* 0: Performance (Швидкодія) */
    { .cpu = {20, 40}, .gpu = {20, 40} },
    /* 1: Balanced (Баланс) */
    { .cpu = {20, 30},  .gpu = {20, 30}  },
    /* 2: Power Saver (Заощадження) */
    { .cpu = {20, 20},  .gpu = {20, 20}  }
};

static gboolean g_has_cpu_fan = FALSE;
static gboolean g_has_gpu_fan = FALSE;
static int g_cpu_fan_rpm = 0;
static int g_gpu_fan_rpm = 0;
static guint g_fan_rpm_timer_id = 0;

typedef enum {
    THUMB_NONE = 0,
    THUMB_MIN,
    THUMB_MAX
} ActiveThumb;

typedef struct {
    int profile_index;
    gboolean is_gpu;
    GtkWidget *drawing_area;
    GtkWidget *badge_label;
    GtkWidget *subtitle_label;
    ActiveThumb active_thumb;
    double drag_start_x;
    int initial_min;
    int initial_max;
} DualRangeSliderData;

static GList *g_fan_subrows_data = NULL;

static void load_fan_ranges_config(void) {
    const char *home = g_get_home_dir();
    char *path = g_build_filename(home, ".config", "mac-styling", "fan-ranges.json", NULL);
    if (!g_file_test(path, G_FILE_TEST_EXISTS)) {
        g_free(path);
        return;
    }

    JsonParser *parser = json_parser_new();
    GError *error = NULL;
    if (json_parser_load_from_file(parser, path, &error)) {
        JsonNode *root = json_parser_get_root(parser);
        if (root && JSON_NODE_HOLDS_OBJECT(root)) {
            JsonObject *obj = json_node_get_object(root);
            const char *profiles[3] = {"performance", "balanced", "power-saver"};
            for (int i = 0; i < 3; i++) {
                if (json_object_has_member(obj, profiles[i])) {
                    JsonObject *p_obj = json_object_get_object_member(obj, profiles[i]);
                    if (p_obj) {
                        if (json_object_has_member(p_obj, "cpu")) {
                            JsonObject *cpu_obj = json_object_get_object_member(p_obj, "cpu");
                            if (cpu_obj) {
                                if (json_object_has_member(cpu_obj, "min"))
                                    g_fan_configs[i].cpu.min_val = json_object_get_int_member(cpu_obj, "min");
                                if (json_object_has_member(cpu_obj, "max"))
                                    g_fan_configs[i].cpu.max_val = json_object_get_int_member(cpu_obj, "max");
                            }
                        }
                        if (json_object_has_member(p_obj, "gpu")) {
                            JsonObject *gpu_obj = json_object_get_object_member(p_obj, "gpu");
                            if (gpu_obj) {
                                if (json_object_has_member(gpu_obj, "min"))
                                    g_fan_configs[i].gpu.min_val = json_object_get_int_member(gpu_obj, "min");
                                if (json_object_has_member(gpu_obj, "max"))
                                    g_fan_configs[i].gpu.max_val = json_object_get_int_member(gpu_obj, "max");
                            }
                        }
                    }
                }
            }
        }
    }
    if (error) g_error_free(error);
    g_object_unref(parser);
    g_free(path);
}

static void save_fan_ranges_config(void) {
    const char *home = g_get_home_dir();
    char *dir = g_build_filename(home, ".config", "mac-styling", NULL);
    g_mkdir_with_parents(dir, 0755);
    char *path = g_build_filename(dir, "fan-ranges.json", NULL);
    g_free(dir);

    char *json = g_strdup_printf(
        "{\n"
        "  \"performance\": {\n"
        "    \"cpu\": {\"min\": %d, \"max\": %d},\n"
        "    \"gpu\": {\"min\": %d, \"max\": %d}\n"
        "  },\n"
        "  \"balanced\": {\n"
        "    \"cpu\": {\"min\": %d, \"max\": %d},\n"
        "    \"gpu\": {\"min\": %d, \"max\": %d}\n"
        "  },\n"
        "  \"power-saver\": {\n"
        "    \"cpu\": {\"min\": %d, \"max\": %d},\n"
        "    \"gpu\": {\"min\": %d, \"max\": %d}\n"
        "  }\n"
        "}\n",
        g_fan_configs[0].cpu.min_val, g_fan_configs[0].cpu.max_val,
        g_fan_configs[0].gpu.min_val, g_fan_configs[0].gpu.max_val,
        g_fan_configs[1].cpu.min_val, g_fan_configs[1].cpu.max_val,
        g_fan_configs[1].gpu.min_val, g_fan_configs[1].gpu.max_val,
        g_fan_configs[2].cpu.min_val, g_fan_configs[2].cpu.max_val,
        g_fan_configs[2].gpu.min_val, g_fan_configs[2].gpu.max_val
    );

    g_file_set_contents(path, json, -1, NULL);
    g_free(json);
    g_free(path);
}

static void detect_fans(void) {
    g_has_cpu_fan = FALSE;
    g_has_gpu_fan = FALSE;
    g_cpu_fan_rpm = 0;
    g_gpu_fan_rpm = 0;

    for (int i = 0; i < 16; i++) {
        char path[128];
        snprintf(path, sizeof(path), "/sys/class/hwmon/hwmon%d/fan1_input", i);
        FILE *f = fopen(path, "r");
        if (f) {
            g_has_cpu_fan = TRUE;
            int rpm = 0;
            if (fscanf(f, "%d", &rpm) == 1 && rpm > 0) {
                g_cpu_fan_rpm = rpm;
            }
            fclose(f);
        }

        snprintf(path, sizeof(path), "/sys/class/hwmon/hwmon%d/fan2_input", i);
        f = fopen(path, "r");
        if (f) {
            g_has_gpu_fan = TRUE;
            int rpm = 0;
            if (fscanf(f, "%d", &rpm) == 1 && rpm > 0) {
                g_gpu_fan_rpm = rpm;
            }
            fclose(f);
        }
    }

    if (g_detected_gpu_count == 0) {
        detect_system_gpus();
    }

    if (g_detected_gpu_count > 0) {
        for (int i = 0; i < g_detected_gpu_count; i++) {
            if (g_detected_gpus[i].is_discrete) {
                g_has_gpu_fan = TRUE;
                break;
            }
        }
    }

    if (!g_has_cpu_fan && g_has_gpu_fan) {
        g_has_cpu_fan = TRUE;
    }
}

static void draw_rounded_rect(cairo_t *cr, double x, double y, double w, double h, double r) {
    if (w < 2 * r) r = w / 2.0;
    if (h < 2 * r) r = h / 2.0;
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -G_PI / 2.0, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, G_PI / 2.0);
    cairo_arc(cr, x + r, y + h - r, r, G_PI / 2.0, G_PI);
    cairo_arc(cr, x + r, y + r, r, G_PI, 3.0 * G_PI / 2.0);
    cairo_close_path(cr);
}

static void draw_dual_range_slider_cb(GtkDrawingArea *area,
                                      cairo_t *cr,
                                      int width,
                                      int height,
                                      gpointer user_data) {
    (void)area;
    DualRangeSliderData *d = (DualRangeSliderData *)user_data;
    if (!d) return;

    ProfileFanConfig *cfg = &g_fan_configs[d->profile_index];
    FanRange *range = d->is_gpu ? &cfg->gpu : &cfg->cpu;

    double pad = 12.0;
    double track_y = height / 2.0;
    double track_h = 6.0;
    double track_len = width - 2.0 * pad;
    if (track_len < 10.0) return;

    double x_min = pad + (range->min_val / 100.0) * track_len;
    double x_max = pad + (range->max_val / 100.0) * track_len;

    gboolean is_dark = TRUE;
    AdwStyleManager *sm = adw_style_manager_get_default();
    if (sm) {
        is_dark = adw_style_manager_get_dark(sm);
    }

    /* 1. Base track */
    if (is_dark) {
        cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.16);
    } else {
        cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.12);
    }
    draw_rounded_rect(cr, pad, track_y - track_h / 2.0, track_len, track_h, 3.0);
    cairo_fill(cr);

    /* 2. Highlighted range bar */
    if (x_max > x_min) {
        cairo_set_source_rgb(cr, 0.0, 0.478, 1.0); /* #007aff */
        draw_rounded_rect(cr, x_min, track_y - track_h / 2.0, x_max - x_min, track_h, 3.0);
        cairo_fill(cr);
    }

    /* 3. Min Thumb Knob */
    double radius = 9.0;
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, is_dark ? 0.35 : 0.2);
    cairo_arc(cr, x_min, track_y + 1.2, radius, 0, 2 * G_PI);
    cairo_fill(cr);

    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_arc(cr, x_min, track_y, radius, 0, 2 * G_PI);
    cairo_fill_preserve(cr);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, is_dark ? 0.18 : 0.25);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    cairo_set_source_rgb(cr, 0.0, 0.478, 1.0);
    cairo_arc(cr, x_min, track_y, 2.5, 0, 2 * G_PI);
    cairo_fill(cr);

    /* 4. Max Thumb Knob */
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, is_dark ? 0.35 : 0.2);
    cairo_arc(cr, x_max, track_y + 1.2, radius, 0, 2 * G_PI);
    cairo_fill(cr);

    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_arc(cr, x_max, track_y, radius, 0, 2 * G_PI);
    cairo_fill_preserve(cr);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, is_dark ? 0.18 : 0.25);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    cairo_set_source_rgb(cr, 0.0, 0.478, 1.0);
    cairo_arc(cr, x_max, track_y, 2.5, 0, 2 * G_PI);
    cairo_fill(cr);
}

static void on_dual_slider_drag_begin(GtkGestureDrag *gesture, double start_x, double start_y, gpointer user_data) {
    (void)start_y;
    DualRangeSliderData *d = (DualRangeSliderData *)user_data;
    if (!d || !d->drawing_area) return;

    ProfileFanConfig *cfg = &g_fan_configs[d->profile_index];
    FanRange *range = d->is_gpu ? &cfg->gpu : &cfg->cpu;

    int w = gtk_widget_get_width(d->drawing_area);
    double pad = 12.0;
    double track_len = w - 2.0 * pad;
    if (track_len < 10.0) return;

    double x_min = pad + (range->min_val / 100.0) * track_len;
    double x_max = pad + (range->max_val / 100.0) * track_len;

    double dist_min = fabs(start_x - x_min);
    double dist_max = fabs(start_x - x_max);

    if (dist_min < dist_max) {
        d->active_thumb = THUMB_MIN;
    } else {
        d->active_thumb = THUMB_MAX;
    }

    d->drag_start_x = start_x;
    d->initial_min = range->min_val;
    d->initial_max = range->max_val;

    if (dist_min > 14.0 && dist_max > 14.0) {
        int clicked_val = (int)round(((start_x - pad) / track_len) * 100.0);
        clicked_val = CLAMP(clicked_val, 0, 100);
        if (d->active_thumb == THUMB_MIN) {
            range->min_val = CLAMP(clicked_val, 0, range->max_val);
            d->initial_min = range->min_val;
        } else {
            range->max_val = CLAMP(clicked_val, range->min_val, 100);
            d->initial_max = range->max_val;
        }
        if (d->badge_label) {
            char buf[32];
            if (range->min_val == range->max_val) {
                snprintf(buf, sizeof(buf), "%d%%", range->min_val);
            } else {
                snprintf(buf, sizeof(buf), "%d%% — %d%%", range->min_val, range->max_val);
            }
            gtk_label_set_text(GTK_LABEL(d->badge_label), buf);
        }
        gtk_widget_queue_draw(d->drawing_area);
    }
}

static void on_dual_slider_drag_update(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    (void)gesture; (void)offset_y;
    DualRangeSliderData *d = (DualRangeSliderData *)user_data;
    if (!d || !d->drawing_area) return;

    ProfileFanConfig *cfg = &g_fan_configs[d->profile_index];
    FanRange *range = d->is_gpu ? &cfg->gpu : &cfg->cpu;

    int w = gtk_widget_get_width(d->drawing_area);
    double pad = 12.0;
    double track_len = w - 2.0 * pad;
    if (track_len < 10.0) return;

    double delta_pct = (offset_x / track_len) * 100.0;

    if (d->active_thumb == THUMB_MIN) {
        int new_min = (int)round(d->initial_min + delta_pct);
        range->min_val = CLAMP(new_min, 0, range->max_val);
    } else if (d->active_thumb == THUMB_MAX) {
        int new_max = (int)round(d->initial_max + delta_pct);
        range->max_val = CLAMP(new_max, range->min_val, 100);
    }

    if (d->badge_label) {
        char buf[32];
        if (range->min_val == range->max_val) {
            snprintf(buf, sizeof(buf), "%d%%", range->min_val);
        } else {
            snprintf(buf, sizeof(buf), "%d%% — %d%%", range->min_val, range->max_val);
        }
        gtk_label_set_text(GTK_LABEL(d->badge_label), buf);
    }

    gtk_widget_queue_draw(d->drawing_area);
}

static void on_dual_slider_drag_end(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    (void)gesture; (void)offset_x; (void)offset_y;
    DualRangeSliderData *d = (DualRangeSliderData *)user_data;
    if (!d) return;

    d->active_thumb = THUMB_NONE;
    save_fan_ranges_config();
}

static gboolean update_fan_rpms_timer_cb(gpointer user_data) {
    (void)user_data;
    detect_fans();

    for (GList *l = g_fan_subrows_data; l != NULL; l = l->next) {
        DualRangeSliderData *d = (DualRangeSliderData *)l->data;
        if (!d || !d->subtitle_label) continue;
        int rpm = d->is_gpu ? g_gpu_fan_rpm : g_cpu_fan_rpm;
        if (rpm > 0) {
            char sub_text[128];
            snprintf(sub_text, sizeof(sub_text), "Авторегулювання швидкості • %d RPM", rpm);
            gtk_label_set_text(GTK_LABEL(d->subtitle_label), sub_text);
        }
    }
    return G_SOURCE_CONTINUE;
}

static GtkWidget *create_fan_control_card(int profile_idx, gboolean is_gpu) {
    GtkWidget *card = gtk_box_new(GTK_ORIENTATION_VERTICAL, 6);
    gtk_widget_set_margin_top(card, 4);
    gtk_widget_set_margin_bottom(card, 6);

    /* 1. Header Box */
    GtkWidget *header_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    gtk_widget_set_valign(header_box, GTK_ALIGN_CENTER);

    GtkWidget *icon = gtk_image_new_from_icon_name(is_gpu ? "video-single-display-symbolic" : "cpu-symbolic");
    gtk_image_set_pixel_size(GTK_IMAGE(icon), 18);
    gtk_widget_set_opacity(icon, 0.85);
    gtk_box_append(GTK_BOX(header_box), icon);

    GtkWidget *title_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    GtkWidget *title_lbl = gtk_label_new(is_gpu ? "Вентилятор відеокарти (GPU)" : "Вентилятор процесора (ЦП)");
    gtk_label_set_xalign(GTK_LABEL(title_lbl), 0.0);
    gtk_widget_add_css_class(title_lbl, "fan-card-title");

    char sub_text[128];
    int rpm = is_gpu ? g_gpu_fan_rpm : g_cpu_fan_rpm;
    if (rpm > 0) {
        snprintf(sub_text, sizeof(sub_text), "Авторегулювання швидкості • %d RPM", rpm);
    } else {
        snprintf(sub_text, sizeof(sub_text), "Динамічний діапазон авторегулювання швидкості");
    }
    GtkWidget *sub_lbl = gtk_label_new(sub_text);
    gtk_label_set_xalign(GTK_LABEL(sub_lbl), 0.0);
    gtk_widget_add_css_class(sub_lbl, "dim-label");
    gtk_widget_add_css_class(sub_lbl, "caption");

    gtk_box_append(GTK_BOX(title_box), title_lbl);
    gtk_box_append(GTK_BOX(title_box), sub_lbl);
    gtk_widget_set_hexpand(title_box, TRUE);
    gtk_box_append(GTK_BOX(header_box), title_box);

    /* Badge Label */
    ProfileFanConfig *cfg = &g_fan_configs[profile_idx];
    FanRange *range = is_gpu ? &cfg->gpu : &cfg->cpu;

    char badge_text[32];
    if (range->min_val == range->max_val) {
        snprintf(badge_text, sizeof(badge_text), "%d%%", range->min_val);
    } else {
        snprintf(badge_text, sizeof(badge_text), "%d%% — %d%%", range->min_val, range->max_val);
    }
    GtkWidget *badge = gtk_label_new(badge_text);
    gtk_widget_add_css_class(badge, "fan-range-badge");
    gtk_box_append(GTK_BOX(header_box), badge);

    gtk_box_append(GTK_BOX(card), header_box);

    /* 2. Drawing Area Dual-Thumb Range Slider */
    GtkWidget *area = gtk_drawing_area_new();
    gtk_widget_set_hexpand(area, TRUE);
    gtk_widget_set_size_request(area, -1, 32);

    DualRangeSliderData *slider_data = g_new0(DualRangeSliderData, 1);
    slider_data->profile_index = profile_idx;
    slider_data->is_gpu = is_gpu;
    slider_data->drawing_area = area;
    slider_data->badge_label = badge;
    slider_data->subtitle_label = sub_lbl;
    slider_data->active_thumb = THUMB_NONE;

    g_fan_subrows_data = g_list_append(g_fan_subrows_data, slider_data);

    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(area), draw_dual_range_slider_cb, slider_data, NULL);

    GtkGesture *drag = gtk_gesture_drag_new();
    g_signal_connect(drag, "drag-begin", G_CALLBACK(on_dual_slider_drag_begin), slider_data);
    g_signal_connect(drag, "drag-update", G_CALLBACK(on_dual_slider_drag_update), slider_data);
    g_signal_connect(drag, "drag-end", G_CALLBACK(on_dual_slider_drag_end), slider_data);
    gtk_widget_add_controller(area, GTK_EVENT_CONTROLLER(drag));

    gtk_box_append(GTK_BOX(card), area);

    /* 3. Min / Max Labels */
    GtkWidget *labels_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_margin_start(labels_box, 12);
    gtk_widget_set_margin_end(labels_box, 12);
    gtk_widget_set_margin_top(labels_box, -4);

    GtkWidget *min_lbl = gtk_label_new("Мін: тихий поріг");
    gtk_label_set_xalign(GTK_LABEL(min_lbl), 0.0);
    gtk_widget_add_css_class(min_lbl, "dim-label");
    gtk_widget_add_css_class(min_lbl, "caption");
    gtk_widget_set_hexpand(min_lbl, TRUE);
    gtk_box_append(GTK_BOX(labels_box), min_lbl);

    GtkWidget *max_lbl = gtk_label_new("Макс: пікове навантаження");
    gtk_label_set_xalign(GTK_LABEL(max_lbl), 1.0);
    gtk_widget_add_css_class(max_lbl, "dim-label");
    gtk_widget_add_css_class(max_lbl, "caption");
    gtk_box_append(GTK_BOX(labels_box), max_lbl);

    gtk_box_append(GTK_BOX(card), labels_box);

    if (g_fan_rpm_timer_id == 0) {
        g_fan_rpm_timer_id = g_timeout_add_seconds(2, update_fan_rpms_timer_cb, NULL);
    }

    return card;
}

static void on_fan_revealer_child_revealed_notify(GObject *revealer, GParamSpec *pspec, gpointer user_data) {
    (void)pspec;
    GtkWidget *sub_row = GTK_WIDGET(user_data);
    if (!gtk_revealer_get_reveal_child(GTK_REVEALER(revealer)) &&
        !gtk_revealer_get_child_revealed(GTK_REVEALER(revealer))) {
        gtk_widget_set_visible(sub_row, FALSE);
    }
}

static GtkWidget *create_fan_subrow_for_profile(int profile_idx) {
    GtkWidget *sub_row = gtk_list_box_row_new();
    gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(sub_row), FALSE);
    gtk_list_box_row_set_selectable(GTK_LIST_BOX_ROW(sub_row), FALSE);
    gtk_widget_add_css_class(sub_row, "fan-settings-subrow");

    GtkWidget *revealer = gtk_revealer_new();
    gtk_revealer_set_transition_type(GTK_REVEALER(revealer), GTK_REVEALER_TRANSITION_TYPE_SLIDE_DOWN);
    gtk_revealer_set_transition_duration(GTK_REVEALER(revealer), 250);
    gtk_revealer_set_reveal_child(GTK_REVEALER(revealer), FALSE);
    g_signal_connect(revealer, "notify::child-revealed", G_CALLBACK(on_fan_revealer_child_revealed_notify), sub_row);

    GtkWidget *container = gtk_box_new(GTK_ORIENTATION_VERTICAL, 10);
    gtk_widget_add_css_class(container, "fan-subrow-container");

    detect_fans();

    /* CPU Fan */
    if (g_has_cpu_fan) {
        GtkWidget *cpu_card = create_fan_control_card(profile_idx, FALSE);
        gtk_box_append(GTK_BOX(container), cpu_card);
    }

    /* Separator if both CPU and GPU fans exist */
    if (g_has_cpu_fan && g_has_gpu_fan) {
        GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
        gtk_widget_set_opacity(sep, 0.4);
        gtk_widget_set_margin_top(sep, 4);
        gtk_widget_set_margin_bottom(sep, 4);
        gtk_box_append(GTK_BOX(container), sep);
    }

    /* GPU Fan */
    if (g_has_gpu_fan) {
        GtkWidget *gpu_card = create_fan_control_card(profile_idx, TRUE);
        gtk_box_append(GTK_BOX(container), gpu_card);
    }

    if (!g_has_cpu_fan && !g_has_gpu_fan) {
        GtkWidget *no_fans_lbl = gtk_label_new("У пристрої не виявлено керованих вентиляторів");
        gtk_widget_add_css_class(no_fans_lbl, "dim-label");
        gtk_box_append(GTK_BOX(container), no_fans_lbl);
    }

    gtk_revealer_set_child(GTK_REVEALER(revealer), container);
    gtk_list_box_row_set_child(GTK_LIST_BOX_ROW(sub_row), revealer);
    gtk_widget_set_visible(sub_row, FALSE);

    return sub_row;
}

static gboolean attach_fan_subrow_idle(gpointer user_data) {
    GtkWidget *btn = GTK_WIDGET(user_data);
    if (!btn || !GTK_IS_WIDGET(btn)) return G_SOURCE_REMOVE;

    GtkWidget *row = gtk_widget_get_ancestor(btn, g_type_from_name("AdwActionRow"));
    if (!row) row = gtk_widget_get_ancestor(btn, GTK_TYPE_LIST_BOX_ROW);
    if (!row) return G_SOURCE_REMOVE;

    GtkWidget *listbox = gtk_widget_get_ancestor(row, GTK_TYPE_LIST_BOX);
    if (!listbox) return G_SOURCE_CONTINUE;

    if (g_object_get_data(G_OBJECT(row), "has_fan_subrow")) return G_SOURCE_REMOVE;

    int idx = gtk_list_box_row_get_index(GTK_LIST_BOX_ROW(row));
    if (idx < 0) return G_SOURCE_CONTINUE;

    g_object_set_data(G_OBJECT(row), "has_fan_subrow", GINT_TO_POINTER(1));

    int profile_idx = 1;
    typedef int (*CcGetProfileFn)(void *);
    CcGetProfileFn get_prof = (CcGetProfileFn)dlsym(RTLD_DEFAULT, "cc_power_profile_row_get_profile");
    if (get_prof) {
        int p = get_prof(row);
        if (p >= 0 && p <= 2) profile_idx = p;
    } else {
        const char *title = adw_preferences_row_get_title(ADW_PREFERENCES_ROW(row));
        if (title) {
            if (strstr(title, "Швидкодія") || strstr(title, "Performance") || strstr(title, "швидкодія")) {
                profile_idx = 0;
            } else if (strstr(title, "Заощадження") || strstr(title, "Power") || strstr(title, "заощадження")) {
                profile_idx = 2;
            } else {
                profile_idx = 1;
            }
        }
    }

    load_fan_ranges_config();

    GtkWidget *sub_row = create_fan_subrow_for_profile(profile_idx);
    g_object_set_data(G_OBJECT(btn), "fan_subrow", sub_row);
    g_object_set_data(G_OBJECT(sub_row), "parent_row", row);

    gtk_list_box_insert(GTK_LIST_BOX(listbox), sub_row, idx + 1);

    return G_SOURCE_REMOVE;
}

void mac_power_profile_fan_btn_realize(GtkWidget *btn, gpointer user_data) {
    (void)user_data;
    if (!btn) return;
    g_idle_add(attach_fan_subrow_idle, btn);
}

void mac_power_profile_fan_btn_toggled(GtkWidget *btn, gpointer user_data) {
    (void)user_data;
    if (!btn) return;

    GtkWidget *sub_row = (GtkWidget *)g_object_get_data(G_OBJECT(btn), "fan_subrow");
    if (!sub_row) {
        attach_fan_subrow_idle(btn);
        sub_row = (GtkWidget *)g_object_get_data(G_OBJECT(btn), "fan_subrow");
    }
    if (!sub_row) return;

    GtkWidget *revealer = gtk_list_box_row_get_child(GTK_LIST_BOX_ROW(sub_row));
    if (!revealer || !GTK_IS_REVEALER(revealer)) return;

    gboolean active = gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(btn));
    if (active) {
        gtk_widget_set_visible(sub_row, TRUE);
        gtk_revealer_set_reveal_child(GTK_REVEALER(revealer), TRUE);
        gtk_button_set_icon_name(GTK_BUTTON(btn), "pan-up-symbolic");
    } else {
        gtk_revealer_set_reveal_child(GTK_REVEALER(revealer), FALSE);
        gtk_button_set_icon_name(GTK_BUTTON(btn), "pan-down-symbolic");
    }
}

static void find_toggle_button_child(GtkWidget *widget, gpointer data) {
    GtkWidget **found = (GtkWidget **)data;
    if (*found) return;
    if (GTK_IS_TOGGLE_BUTTON(widget)) {
        *found = widget;
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_toggle_button_child(child, data);
        if (*found) return;
    }
}

static void setup_power_profile_row_fan_button(GtkWidget *row) {
    if (!row || !GTK_IS_WIDGET(row)) return;
    if (g_object_get_data(G_OBJECT(row), "fan_btn_setup_done")) return;
    g_object_set_data(G_OBJECT(row), "fan_btn_setup_done", GINT_TO_POINTER(1));

    GtkWidget *btn = NULL;
    find_toggle_button_child(row, &btn);

    if (!btn) {
        btn = gtk_toggle_button_new();
        gtk_button_set_icon_name(GTK_BUTTON(btn), "pan-down-symbolic");
        gtk_widget_set_valign(btn, GTK_ALIGN_CENTER);
        gtk_widget_set_tooltip_text(btn, "Швидкість вентиляторів");
        gtk_widget_add_css_class(btn, "flat");
        gtk_widget_add_css_class(btn, "circular");
        adw_action_row_add_suffix(ADW_ACTION_ROW(row), btn);
    }

    if (btn) {
        gtk_widget_set_name(btn, "profile_fan_expand_btn");
        if (!g_object_get_data(G_OBJECT(btn), "signals_hooked")) {
            g_object_set_data(G_OBJECT(btn), "signals_hooked", GINT_TO_POINTER(1));
            g_signal_connect(btn, "toggled", G_CALLBACK(mac_power_profile_fan_btn_toggled), NULL);
        }
        mac_power_profile_fan_btn_realize(btn, NULL);
    }
}

void gtk_widget_init_template(GtkWidget *widget)
{
    static void (*orig_init_template)(GtkWidget *) = NULL;
    if (!orig_init_template) orig_init_template = dlsym(RTLD_NEXT, "gtk_widget_init_template");
    if (orig_init_template) orig_init_template(widget);

    if (widget) {
        GType profile_row_type = g_type_from_name("CcPowerProfileRow");
        if (profile_row_type != 0 && g_type_is_a(G_OBJECT_TYPE(widget), profile_row_type)) {
            setup_power_profile_row_fan_button(widget);
        }
    }
}

void gtk_widget_class_set_template_from_resource(GtkWidgetClass *widget_class, const char *resource_name)
{
    static void (*orig_set_template)(GtkWidgetClass *, const char *) = NULL;
    if (!orig_set_template) orig_set_template = dlsym(RTLD_NEXT, "gtk_widget_class_set_template_from_resource");
    if (orig_set_template) orig_set_template(widget_class, resource_name);

    if (resource_name && g_strcmp0(resource_name, "/org/gnome/control-center/power/cc-power-profile-row.ui") == 0) {
        gtk_widget_class_bind_template_callback_full(widget_class, "mac_power_profile_fan_btn_realize", G_CALLBACK(mac_power_profile_fan_btn_realize));
        gtk_widget_class_bind_template_callback_full(widget_class, "mac_power_profile_fan_btn_toggled", G_CALLBACK(mac_power_profile_fan_btn_toggled));
    }
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

typedef struct {
    GtkAdjustment *vadj;
    GtkWidget *widget;
    guint tick_id;
    double target_val;
    double current_val;
    gint64 last_time;
} SmoothScrollData;

static gboolean smooth_scroll_tick_cb(GtkWidget *widget G_GNUC_UNUSED,
                                      GdkFrameClock *frame_clock G_GNUC_UNUSED,
                                      gpointer user_data)
{
    SmoothScrollData *data = (SmoothScrollData *)user_data;
    if (!data || !data->vadj) return G_SOURCE_REMOVE;

    gint64 now = g_get_monotonic_time();
    double dt = (double)(now - data->last_time) / 1000000.0;
    data->last_time = now;
    if (dt <= 0.0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    double diff = data->target_val - data->current_val;
    if (fabs(diff) < 0.5) {
        gtk_adjustment_set_value(data->vadj, data->target_val);
        data->current_val = data->target_val;
        data->tick_id = 0;
        return G_SOURCE_REMOVE;
    }

    double factor = 1.0 - exp(-18.0 * dt);
    data->current_val += diff * factor;
    gtk_adjustment_set_value(data->vadj, data->current_val);

    return G_SOURCE_CONTINUE;
}

static gboolean on_scrolled_window_scroll(GtkEventControllerScroll *controller,
                                          double dx G_GNUC_UNUSED,
                                          double dy,
                                          gpointer user_data)
{
    SmoothScrollData *data = (SmoothScrollData *)user_data;
    if (!data || !data->vadj) return GDK_EVENT_PROPAGATE;

    GtkAdjustment *adj = data->vadj;
    double page_size = gtk_adjustment_get_page_size(adj);
    double lower = gtk_adjustment_get_lower(adj);
    double upper = gtk_adjustment_get_upper(adj);
    double max_val = MAX(lower, upper - page_size);

    if (max_val <= lower) return GDK_EVENT_PROPAGATE;

    GdkScrollUnit unit = gtk_event_controller_scroll_get_unit(controller);
    if (unit != GDK_SCROLL_UNIT_WHEEL) {
        return GDK_EVENT_PROPAGATE;
    }

    if (dy == 0.0) return GDK_EVENT_PROPAGATE;

    double cur = gtk_adjustment_get_value(adj);
    if (data->tick_id == 0) {
        data->target_val = cur;
        data->current_val = cur;
    }

    double step = 68.0;
    data->target_val = CLAMP(data->target_val + dy * step, lower, max_val);

    if (data->tick_id == 0) {
        data->last_time = g_get_monotonic_time();
        data->tick_id = gtk_widget_add_tick_callback(data->widget, smooth_scroll_tick_cb, data, NULL);
    }

    return GDK_EVENT_STOP;
}

static void free_smooth_scroll_data(gpointer user_data)
{
    SmoothScrollData *data = (SmoothScrollData *)user_data;
    if (data) {
        if (data->tick_id != 0 && data->widget) {
            gtk_widget_remove_tick_callback(data->widget, data->tick_id);
            data->tick_id = 0;
        }
        g_free(data);
    }
}

static void enable_smooth_scrolling_for_scrolled_window(GtkScrolledWindow *sw)
{
    if (!sw || !GTK_IS_SCROLLED_WINDOW(sw)) return;
    if (g_object_get_data(G_OBJECT(sw), "mac_smooth_scroll_attached")) return;
    g_object_set_data(G_OBJECT(sw), "mac_smooth_scroll_attached", GINT_TO_POINTER(1));

    GtkAdjustment *vadj = gtk_scrolled_window_get_vadjustment(sw);
    if (!vadj) return;

    SmoothScrollData *data = g_new0(SmoothScrollData, 1);
    data->vadj = vadj;
    data->widget = GTK_WIDGET(sw);
    data->target_val = gtk_adjustment_get_value(vadj);
    data->current_val = data->target_val;
    data->last_time = g_get_monotonic_time();

    GtkEventController *controller = gtk_event_controller_scroll_new(
        GTK_EVENT_CONTROLLER_SCROLL_VERTICAL | GTK_EVENT_CONTROLLER_SCROLL_DISCRETE);
    gtk_event_controller_set_propagation_phase(controller, GTK_PHASE_CAPTURE);
    g_signal_connect(controller, "scroll", G_CALLBACK(on_scrolled_window_scroll), data);
    gtk_widget_add_controller(GTK_WIDGET(sw), controller);

    g_object_set_data_full(G_OBJECT(sw), "mac_smooth_scroll_data", data, free_smooth_scroll_data);
}

static void find_scrolled_windows(GtkWidget *widget, GList **list)
{
    if (!widget) return;
    if (GTK_IS_SCROLLED_WINDOW(widget)) {
        *list = g_list_append(*list, widget);
        enable_smooth_scrolling_for_scrolled_window(GTK_SCROLLED_WINDOW(widget));
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_scrolled_windows(child, list);
    }
}

static void configure_toolbar_views_recursive(GtkWidget *widget, gboolean is_sidebar)
{
    if (!widget) return;
    if (ADW_IS_TOOLBAR_VIEW(widget)) {
        AdwToolbarView *tv = ADW_TOOLBAR_VIEW(widget);
        if (is_sidebar) {
            adw_toolbar_view_set_extend_content_to_top_edge(tv, FALSE);
            adw_toolbar_view_set_extend_content_to_bottom_edge(tv, FALSE);
        } else {
            adw_toolbar_view_set_extend_content_to_top_edge(tv, TRUE);
            adw_toolbar_view_set_extend_content_to_bottom_edge(tv, TRUE);
        }
        adw_toolbar_view_set_top_bar_style(tv, ADW_TOOLBAR_FLAT);
        adw_toolbar_view_set_bottom_bar_style(tv, ADW_TOOLBAR_FLAT);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        configure_toolbar_views_recursive(child, is_sidebar);
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
    AdwNavigationPage *sidebar_p = adw_navigation_split_view_get_sidebar(split_view);
    if (sidebar_p) {
        configure_toolbar_views_recursive(GTK_WIDGET(sidebar_p), TRUE);
    }
    AdwNavigationPage *content_p = adw_navigation_split_view_get_content(split_view);
    if (content_p) {
        configure_toolbar_views_recursive(GTK_WIDGET(content_p), FALSE);
    }
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
    gtk_widget_add_css_class(GTK_WIDGET(target_hb), "mac-settings-content-headerbar");
    gtk_widget_set_margin_top(GTK_WIDGET(target_hb), 3);

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
    gtk_widget_set_margin_end(menu_btn, 8);
    gtk_widget_set_margin_top(menu_btn, 0);
    gtk_widget_set_margin_bottom(menu_btn, 0);
    gtk_widget_set_margin_top(search_btn, 0);
    gtk_widget_set_margin_bottom(search_btn, 0);
    gtk_widget_set_visible(menu_btn, TRUE);
    gtk_widget_set_visible(search_btn, TRUE);

    if (g_getenv("MAC_SETTINGS_TEST_SCROLL")) {
        GList *sws = NULL;
        find_scrolled_windows(target_root, &sws);
        for (GList *l = sws; l != NULL; l = l->next) {
            GtkScrolledWindow *sw = GTK_SCROLLED_WINDOW(l->data);
            GtkAdjustment *vadj = gtk_scrolled_window_get_vadjustment(sw);
            if (vadj) {
                double val = g_ascii_strtod(g_getenv("MAC_SETTINGS_TEST_SCROLL"), NULL);
                gtk_adjustment_set_value(vadj, val > 0.0 ? val : 150.0);
            }
        }
        g_list_free(sws);
    }

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
    gtk_widget_add_css_class(GTK_WIDGET(window), "mac-settings-window");

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
        gtk_widget_add_css_class(GTK_WIDGET(sidebar_hb), "mac-settings-sidebar-headerbar");
        gtk_widget_set_margin_top(GTK_WIDGET(sidebar_hb), 3);

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

    if (sidebar) {
        configure_toolbar_views_recursive(GTK_WIDGET(sidebar), TRUE);
    }
    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (content_page) {
        configure_toolbar_views_recursive(GTK_WIDGET(content_page), FALSE);
    }
    update_panel_headerbar(split_view);

    GList *all_sws = NULL;
    find_scrolled_windows(GTK_WIDGET(window), &all_sws);
    g_list_free(all_sws);

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



