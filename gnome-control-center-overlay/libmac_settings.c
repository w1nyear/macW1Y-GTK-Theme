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
#include "mac_i18n.h"

typedef struct {
    int menubar_tint;   /* 0 - 100 */
    int menubar_blur;   /* 0 - 100 */

    int liquid_shape;      /* 0 - 3 (0=RoundRect, 1=Circle, 2=Capsule, 3=Squircle) */
    int liquid_refraction; /* 0 - 100 */
    int liquid_blur;       /* 0 - 50 */
    int liquid_tint;       /* 0 - 100 */
    int liquid_chroma;     /* 0 - 100 */
    int liquid_rim;        /* 0 - 100 */
    int liquid_specular;   /* 0 - 100 */
    int liquid_shadow;     /* 0 - 100 */

    int spotlight_blur;    /* 0 - 50 */
    int spotlight_tint;    /* 0 - 100 */
    int spotlight_shadow;  /* 0 - 100 */

    int blur_sigma;     /* 0 - 100 */
    int blur_tint;      /* 0 - 100 */

    int menu_tint;      /* 0 - 100 */
    int menu_blur;      /* 0 - 100 */
    int menu_shadow_blur;     /* 0 - 100 (radius px) */
    int menu_shadow_strength; /* 0 - 100 (intensity %) */

    int widget_blur;    /* 0 - 50 px */
    int widget_tint;    /* 0 - 100 % */
    int widget_shadow;  /* 0 - 100 % */

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

    .liquid_shape = 0,
    .liquid_refraction = 60,
    .liquid_blur = 20,
    .liquid_tint = 12,
    .liquid_chroma = 20,
    .liquid_rim = 45,
    .liquid_specular = 25,
    .liquid_shadow = 35,

    .spotlight_blur = 18,
    .spotlight_tint = 15,
    .spotlight_shadow = 35,

    .blur_sigma = 30,
    .blur_tint = 36,

    .menu_tint = 35,
    .menu_blur = 30,
    .menu_shadow_blur = 30,
    .menu_shadow_strength = 55,

    .widget_blur = 20,
    .widget_tint = 42,
    .widget_shadow = 35,

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
static guint liquid_glass_timer_id = 0;
static guint spotlight_timer_id = 0;
static guint blur_sigma_timer_id = 0;
static guint blur_tint_timer_id = 0;
static guint menu_blur_timer_id = 0;
static guint menu_tint_timer_id = 0;
static guint menu_shadow_timer_id = 0;
static guint widget_timer_id = 0;

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
            if (json_object_has_member(obj, "liquid_shape"))
                state.liquid_shape = (int)json_object_get_int_member(obj, "liquid_shape");
            else
                state.liquid_shape = 0;

            if (json_object_has_member(obj, "liquid_refraction"))
                state.liquid_refraction = (int)json_object_get_int_member(obj, "liquid_refraction");
            else
                state.liquid_refraction = 60;

            if (json_object_has_member(obj, "liquid_blur"))
                state.liquid_blur = (int)json_object_get_int_member(obj, "liquid_blur");
            else if (json_object_has_member(obj, "dock_glass_strength"))
                state.liquid_blur = (int)round(json_object_get_double_member(obj, "dock_glass_strength") * 50.0);
            else
                state.liquid_blur = 20;

            if (json_object_has_member(obj, "liquid_tint"))
                state.liquid_tint = (int)json_object_get_int_member(obj, "liquid_tint");
            else if (json_object_has_member(obj, "dock_tint_strength"))
                state.liquid_tint = (int)round(json_object_get_double_member(obj, "dock_tint_strength") * 100.0);
            else
                state.liquid_tint = 12;

            if (json_object_has_member(obj, "liquid_chroma"))
                state.liquid_chroma = (int)json_object_get_int_member(obj, "liquid_chroma");
            else
                state.liquid_chroma = 20;

            if (json_object_has_member(obj, "liquid_rim"))
                state.liquid_rim = (int)json_object_get_int_member(obj, "liquid_rim");
            else
                state.liquid_rim = 45;

            if (json_object_has_member(obj, "liquid_specular"))
                state.liquid_specular = (int)json_object_get_int_member(obj, "liquid_specular");
            else
                state.liquid_specular = 25;

            if (json_object_has_member(obj, "liquid_shadow"))
                state.liquid_shadow = (int)json_object_get_int_member(obj, "liquid_shadow");
            else
                state.liquid_shadow = 35;

            /* Group 3: Spotlight */
            if (json_object_has_member(obj, "spotlight_blur"))
                state.spotlight_blur = (int)json_object_get_int_member(obj, "spotlight_blur");
            else
                state.spotlight_blur = 18;

            if (json_object_has_member(obj, "spotlight_tint"))
                state.spotlight_tint = (int)json_object_get_int_member(obj, "spotlight_tint");
            else
                state.spotlight_tint = 15;

            if (json_object_has_member(obj, "spotlight_shadow"))
                state.spotlight_shadow = (int)json_object_get_int_member(obj, "spotlight_shadow");
            else
                state.spotlight_shadow = 35;

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

            /* Group 5: Widgets */
            if (json_object_has_member(obj, "widget_blur"))
                state.widget_blur = (int)json_object_get_int_member(obj, "widget_blur");
            else
                state.widget_blur = 20;

            if (json_object_has_member(obj, "widget_tint"))
                state.widget_tint = (int)json_object_get_int_member(obj, "widget_tint");
            else
                state.widget_tint = 42;

            if (json_object_has_member(obj, "widget_shadow"))
                state.widget_shadow = (int)json_object_get_int_member(obj, "widget_shadow");
            else
                state.widget_shadow = 35;

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
        "  \"liquid_shape\": %d,\n"
        "  \"liquid_refraction\": %d,\n"
        "  \"liquid_blur\": %d,\n"
        "  \"liquid_tint\": %d,\n"
        "  \"liquid_chroma\": %d,\n"
        "  \"liquid_rim\": %d,\n"
        "  \"liquid_specular\": %d,\n"
        "  \"liquid_shadow\": %d,\n"
        "  \"spotlight_blur\": %d,\n"
        "  \"spotlight_tint\": %d,\n"
        "  \"spotlight_shadow\": %d,\n"
        "  \"blur_sigma\": %d,\n"
        "  \"blur_tint\": %d,\n"
        "  \"menu_tint\": %d,\n"
        "  \"menu_blur\": %d,\n"
        "  \"menu_shadow_blur\": %d,\n"
        "  \"menu_shadow_strength\": %d,\n"
        "  \"widget_blur\": %d,\n"
        "  \"widget_tint\": %d,\n"
        "  \"widget_shadow\": %d,\n"
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
        state.liquid_shape,
        state.liquid_refraction,
        state.liquid_blur,
        state.liquid_tint,
        state.liquid_chroma,
        state.liquid_rim,
        state.liquid_specular,
        state.liquid_shadow,
        state.spotlight_blur,
        state.spotlight_tint,
        state.spotlight_shadow,
        state.blur_sigma,
        state.blur_tint,
        state.menu_tint,
        state.menu_blur,
        state.menu_shadow_blur,
        state.menu_shadow_strength,
        state.widget_blur,
        state.widget_tint,
        state.widget_shadow,
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

static void safe_set_int(GSettings *s, GSettingsSchema *schema, const char *key, int val) {
    if (schema && g_settings_schema_has_key(schema, key)) {
        g_settings_set_int(s, key, val);
    }
}

static void safe_set_double(GSettings *s, GSettingsSchema *schema, const char *key, double val) {
    if (schema && g_settings_schema_has_key(schema, key)) {
        g_settings_set_double(s, key, val);
    }
}

static void safe_set_string(GSettings *s, GSettingsSchema *schema, const char *key, const char *val) {
    if (schema && g_settings_schema_has_key(schema, key)) {
        g_settings_set_string(s, key, val);
    }
}

static void apply_liquid_glass(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    const char *schema_id = "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com";
    if (!g_settings_schema_source_lookup(src, schema_id, TRUE)) {
        return;
    }

    GSettings *lg = g_settings_new(schema_id);
    if (!lg) return;

    GSettingsSchema *schema = NULL;
    g_object_get(lg, "settings-schema", &schema, NULL);

    int radius = state.liquid_blur;
    double tint = (double)state.liquid_tint / 100.0;
    double disp_scale = (double)state.liquid_refraction * 1.5;
    double ior = 1.0 + ((double)state.liquid_refraction / 100.0) * 1.0;
    double chroma = ((double)state.liquid_chroma / 100.0) * 0.04;
    double rim = (double)state.liquid_rim / 100.0;
    double specular = (double)state.liquid_specular / 100.0;
    double shadow_int = ((double)state.liquid_shadow / 100.0) * 0.8;
    double shadow_rad = fmax(10.0, ((double)state.liquid_shadow / 100.0) * 60.0);

    const char *blur_keys[] = {
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

    for (int i = 0; blur_keys[i] != NULL; i++) {
        safe_set_int(lg, schema, blur_keys[i], radius);
    }

    const char *tint_keys[] = {
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

    for (int i = 0; tint_keys[i] != NULL; i++) {
        safe_set_double(lg, schema, tint_keys[i], tint);
    }

    safe_set_int(lg, schema, "glass-shape-type", state.liquid_shape);
    safe_set_double(lg, schema, "glass-displacement-scale", disp_scale);
    safe_set_double(lg, schema, "glass-ior", ior);
    safe_set_double(lg, schema, "glass-chroma-strength", chroma);
    safe_set_double(lg, schema, "glass-rim-intensity", rim);
    safe_set_double(lg, schema, "glass-specular-intensity", specular);
    safe_set_double(lg, schema, "shadow-intensity", shadow_int);
    safe_set_double(lg, schema, "shadow-radius", shadow_rad);

    safe_set_string(lg, schema, "menu-tint-color", "#000000");
    safe_set_string(lg, schema, "desktop-menu-tint-color", "#000000");
    safe_set_string(lg, schema, "panel-menu-tint-color", "#000000");

    if (schema) g_settings_schema_unref(schema);
    g_object_unref(lg);
}

static gboolean apply_liquid_glass_cb(gpointer user_data) {
    (void)user_data;
    liquid_glass_timer_id = 0;
    apply_liquid_glass();
    return G_SOURCE_REMOVE;
}

static void schedule_liquid_glass_apply(void) {
    if (liquid_glass_timer_id != 0) {
        g_source_remove(liquid_glass_timer_id);
        liquid_glass_timer_id = 0;
    }
    liquid_glass_timer_id = g_timeout_add(100, (GSourceFunc)apply_liquid_glass_cb, NULL);
}

static gboolean apply_spotlight_cb(gpointer user_data) {
    (void)user_data;
    spotlight_timer_id = 0;
    save_styling_json();
    return G_SOURCE_REMOVE;
}

static void schedule_spotlight_apply(void) {
    if (spotlight_timer_id == 0) {
        spotlight_timer_id = g_timeout_add(60, (GSourceFunc)apply_spotlight_cb, NULL);
    }
}

static void apply_widget_settings(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    const char *schema_id = "org.gnome.shell.extensions.desktop-widgets-r3nhick";
    if (!g_settings_schema_source_lookup(src, schema_id, TRUE)) return;

    GSettings *dw = g_settings_new(schema_id);
    if (!dw) return;

    g_settings_set_int(dw, "blur-radius-px", state.widget_blur);
    g_settings_set_int(dw, "tint-alpha-pct", state.widget_tint);
    g_settings_set_int(dw, "style-shadow-size", state.widget_shadow);
    g_object_unref(dw);
}

static gboolean apply_widget_cb(gpointer user_data) {
    (void)user_data;
    widget_timer_id = 0;
    apply_widget_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_widget_apply(void) {
    if (widget_timer_id != 0) {
        g_source_remove(widget_timer_id);
        widget_timer_id = 0;
    }
    widget_timer_id = g_timeout_add(50, (GSourceFunc)apply_widget_cb, NULL);
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

/* ========================================================================= */
/* Interactive Liquid Glass Live Preview Widget (GTK4 + Cairo + Wallpapers)  */
/* ========================================================================= */

static void draw_rounded_rect_path(cairo_t *cr, double x, double y, double w, double h, double r) {
    if (w < 2.0 * r) r = w / 2.0;
    if (h < 2.0 * r) r = h / 2.0;
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -G_PI / 2.0, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, G_PI / 2.0);
    cairo_arc(cr, x + r, y + h - r, r, G_PI / 2.0, G_PI);
    cairo_arc(cr, x + r, y + r, r, G_PI, 3.0 * G_PI / 2.0);
    cairo_close_path(cr);
}

static GtkWidget *g_liquid_preview_w = NULL;
static double g_glass_x = -1.0;
static double g_glass_y = -1.0;
static double g_glass_drag_start_x = 0;
static double g_glass_drag_start_y = 0;
static gboolean g_glass_is_dragging = FALSE;
static cairo_surface_t *g_cached_bg_surface = NULL;
static int g_cached_bg_w = 0;
static int g_cached_bg_h = 0;
static char *g_cached_bg_path = NULL;

static void redraw_liquid_preview(void) {
    if (g_liquid_preview_w && GTK_IS_WIDGET(g_liquid_preview_w)) {
        gtk_widget_queue_draw(g_liquid_preview_w);
    }
}

static char *get_user_wallpaper_path(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src || !g_settings_schema_source_lookup(src, "org.gnome.desktop.background", TRUE))
        return NULL;
    GSettings *bg_settings = g_settings_new("org.gnome.desktop.background");
    char *uri = g_settings_get_string(bg_settings, "picture-uri-dark");
    if (!uri || strlen(uri) == 0) {
        if (uri) g_free(uri);
        uri = g_settings_get_string(bg_settings, "picture-uri");
    }
    g_object_unref(bg_settings);
    if (!uri) return NULL;
    char *filename = g_filename_from_uri(uri, NULL, NULL);
    g_free(uri);
    return filename;
}

static cairo_surface_t *get_cached_wallpaper_surface(int target_w, int target_h) {
    char *path = get_user_wallpaper_path();
    if (!path) return NULL;

    if (g_cached_bg_surface && g_cached_bg_w == target_w && g_cached_bg_h == target_h &&
        g_cached_bg_path && strcmp(g_cached_bg_path, path) == 0) {
        g_free(path);
        return g_cached_bg_surface;
    }

    if (g_cached_bg_surface) {
        cairo_surface_destroy(g_cached_bg_surface);
        g_cached_bg_surface = NULL;
    }
    if (g_cached_bg_path) {
        g_free(g_cached_bg_path);
        g_cached_bg_path = NULL;
    }

    GError *err = NULL;
    GdkPixbuf *pb = gdk_pixbuf_new_from_file_at_scale(path, target_w, -1, TRUE, &err);
    if (!pb) {
        if (err) g_error_free(err);
        g_free(path);
        return NULL;
    }

    int pw = gdk_pixbuf_get_width(pb);
    int ph = gdk_pixbuf_get_height(pb);

    if (ph < target_h) {
        GdkPixbuf *pb2 = gdk_pixbuf_scale_simple(pb, (int)ceil((double)pw * target_h / ph), target_h, GDK_INTERP_BILINEAR);
        g_object_unref(pb);
        pb = pb2;
        pw = gdk_pixbuf_get_width(pb);
        ph = gdk_pixbuf_get_height(pb);
    }

    int crop_x = CLAMP((pw - target_w) / 2, 0, pw - target_w);
    int crop_y = CLAMP((ph - target_h) / 2, 0, ph - target_h);
    GdkPixbuf *cropped = gdk_pixbuf_new_subpixbuf(pb, crop_x, crop_y, target_w, target_h);

    cairo_surface_t *surf = cairo_image_surface_create(CAIRO_FORMAT_RGB24, target_w, target_h);
    int c_w = gdk_pixbuf_get_width(cropped);
    int c_h = gdk_pixbuf_get_height(cropped);
    int c_stride = gdk_pixbuf_get_rowstride(cropped);
    int c_n_channels = gdk_pixbuf_get_n_channels(cropped);
    guchar *c_pixels = gdk_pixbuf_get_pixels(cropped);

    cairo_surface_flush(surf);
    unsigned char *s_data = cairo_image_surface_get_data(surf);
    int s_stride = cairo_image_surface_get_stride(surf);

    for (int y = 0; y < c_h; y++) {
        guchar *p_src = c_pixels + y * c_stride;
        uint32_t *p_dst = (uint32_t *)(s_data + y * s_stride);
        for (int x = 0; x < c_w; x++) {
            guchar r = p_src[x * c_n_channels + 0];
            guchar g = p_src[x * c_n_channels + 1];
            guchar b = p_src[x * c_n_channels + 2];
            p_dst[x] = (0xFF << 24) | (r << 16) | (g << 8) | b;
        }
    }
    cairo_surface_mark_dirty(surf);

    g_object_unref(cropped);
    g_object_unref(pb);

    g_cached_bg_surface = surf;
    g_cached_bg_w = target_w;
    g_cached_bg_h = target_h;
    g_cached_bg_path = path;
    return g_cached_bg_surface;
}

static void on_liquid_drag_begin(GtkGestureDrag *gesture, double start_x, double start_y, gpointer user_data) {
    (void)gesture;
    GtkWidget *widget = GTK_WIDGET(user_data);
    int w = gtk_widget_get_width(widget);
    int h = gtk_widget_get_height(widget);
    int gw = 150, gh = 110;
    if (state.liquid_shape == 1) { gw = 116; gh = 116; }
    else if (state.liquid_shape == 2) { gw = 160; gh = 92; }
    else if (state.liquid_shape == 3) { gw = 124; gh = 124; }

    if (g_glass_x < 0) {
        g_glass_x = (w - gw) / 2.0;
        g_glass_y = (h - gh) / 2.0;
    }

    if (start_x >= g_glass_x && start_x <= g_glass_x + gw &&
        start_y >= g_glass_y && start_y <= g_glass_y + gh) {
        g_glass_is_dragging = TRUE;
        g_glass_drag_start_x = g_glass_x;
        g_glass_drag_start_y = g_glass_y;
        gtk_widget_set_cursor_from_name(widget, "grabbing");
    } else {
        g_glass_is_dragging = TRUE;
        g_glass_x = CLAMP(start_x - gw / 2.0, 6.0, w - gw - 6.0);
        g_glass_y = CLAMP(start_y - gh / 2.0, 6.0, h - gh - 6.0);
        g_glass_drag_start_x = g_glass_x;
        g_glass_drag_start_y = g_glass_y;
        gtk_widget_set_cursor_from_name(widget, "grabbing");
        gtk_widget_queue_draw(widget);
    }
}

static void on_liquid_drag_update(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    (void)gesture;
    if (!g_glass_is_dragging) return;
    GtkWidget *widget = GTK_WIDGET(user_data);
    int w = gtk_widget_get_width(widget);
    int h = gtk_widget_get_height(widget);
    int gw = 150, gh = 110;
    if (state.liquid_shape == 1) { gw = 116; gh = 116; }
    else if (state.liquid_shape == 2) { gw = 160; gh = 92; }
    else if (state.liquid_shape == 3) { gw = 124; gh = 124; }

    g_glass_x = CLAMP(g_glass_drag_start_x + offset_x, 6.0, w - gw - 6.0);
    g_glass_y = CLAMP(g_glass_drag_start_y + offset_y, 6.0, h - gh - 6.0);
    gtk_widget_queue_draw(widget);
}

static void on_liquid_drag_end(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    (void)gesture; (void)offset_x; (void)offset_y;
    g_glass_is_dragging = FALSE;
    GtkWidget *widget = GTK_WIDGET(user_data);
    gtk_widget_set_cursor_from_name(widget, "grab");
}

/* ========================================================================= */
/* Exact GLSL glass.frag shader simulation from ryohsuke1231/liquid-glass    */
/* with multi-shape geometry support:                                        */
/* 0 = Rounded Rect, 1 = Circle, 2 = Capsule, 3 = Apple Squircle             */
/* ========================================================================= */

static inline double glsl_sdRoundRect(double px, double py, double bx, double by, double r) {
    double dx = fabs(px) - bx + r;
    double dy = fabs(py) - by + r;
    double max_d = fmax(dx, dy);
    double len_d = sqrt(fmax(dx, 0.0) * fmax(dx, 0.0) + fmax(dy, 0.0) * fmax(dy, 0.0));
    return fmin(max_d, 0.0) + len_d - r;
}

static inline double glsl_sdSquircle(double px, double py, double bx, double by, double n) {
    double ax = fmax(bx, 1.0);
    double ay = fmax(by, 1.0);
    double qx = fabs(px) / ax;
    double qy = fabs(py) / ay;
    double d_norm = pow(pow(qx, n) + pow(qy, n), 1.0 / n) - 1.0;
    return d_norm * fmin(ax, ay);
}

static inline double glsl_sdShape(double px, double py, double bx, double by, double r, int shape) {
    if (shape == 3) {
        return glsl_sdSquircle(px, py, bx, by, 4.2);
    } else if (shape == 2) {
        double cap_r = fmin(bx, by);
        return glsl_sdRoundRect(px, py, bx, by, cap_r);
    } else if (shape == 1) {
        double cir_r = fmin(bx, by);
        return sqrt(px * px + py * py) - cir_r;
    }
    return glsl_sdRoundRect(px, py, bx, by, r);
}

static inline double glsl_smoothstep(double edge0, double edge1, double x) {
    if (edge0 >= edge1) return (x >= edge0) ? 1.0 : 0.0;
    double t = CLAMP((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static inline void glsl_sdRoundRectDir(double px, double py, double bx, double by, double r, double *out_x, double *out_y) {
    double qx = fabs(px) - bx + r;
    double qy = fabs(py) - by + r;
    double sign_x = (px >= 0.0) ? 1.0 : -1.0;
    double sign_y = (py >= 0.0) ? 1.0 : -1.0;
    if (fmax(qx, qy) < 0.0) {
        if (qx > qy) {
            *out_x = sign_x;
            *out_y = 0.0;
        } else {
            *out_x = 0.0;
            *out_y = sign_y;
        }
        return;
    }
    double mqx = fmax(qx, 0.0) + 1e-6;
    double mqy = fmax(qy, 0.0) + 1e-6;
    double len = sqrt(mqx * mqx + mqy * mqy);
    *out_x = sign_x * (mqx / len);
    *out_y = sign_y * (mqy / len);
}

static inline void glsl_sdShapeDir(double px, double py, double bx, double by, double r, int shape, double *out_x, double *out_y) {
    if (shape == 3) {
        double eps = 0.5;
        double dx = glsl_sdSquircle(px + eps, py, bx, by, 4.2) - glsl_sdSquircle(px - eps, py, bx, by, 4.2);
        double dy = glsl_sdSquircle(px, py + eps, bx, by, 4.2) - glsl_sdSquircle(px, py - eps, bx, by, 4.2);
        double len = sqrt(dx * dx + dy * dy) + 1e-6;
        *out_x = dx / len;
        *out_y = dy / len;
    } else if (shape == 2) {
        double cap_r = fmin(bx, by);
        glsl_sdRoundRectDir(px, py, bx, by, cap_r, out_x, out_y);
    } else if (shape == 1) {
        double len = sqrt(px * px + py * py) + 1e-6;
        *out_x = px / len;
        *out_y = py / len;
    } else {
        glsl_sdRoundRectDir(px, py, bx, by, r, out_x, out_y);
    }
}

static void draw_shape_path(cairo_t *cr, double gx, double gy, double gw, double gh, double gr, int shape) {
    if (shape == 1) { // Circle
        double r = fmin(gw, gh) * 0.5;
        double cx = gx + gw * 0.5;
        double cy = gy + gh * 0.5;
        cairo_new_sub_path(cr);
        cairo_arc(cr, cx, cy, r, 0.0, 2.0 * M_PI);
        cairo_close_path(cr);
    } else if (shape == 2) { // Capsule
        double r = fmin(gw, gh) * 0.5;
        draw_rounded_rect_path(cr, gx, gy, gw, gh, r);
    } else if (shape == 3) { // Squircle
        double ax = gw * 0.5;
        double ay = gh * 0.5;
        double cx = gx + ax;
        double cy = gy + ay;
        double n = 4.2;
        double p = 2.0 / n;
        cairo_new_sub_path(cr);
        const int steps = 96;
        for (int i = 0; i <= steps; i++) {
            double theta = (double)i * (2.0 * M_PI / (double)steps);
            double c = cos(theta);
            double s = sin(theta);
            double x = cx + ax * (c >= 0.0 ? 1.0 : -1.0) * pow(fabs(c), p);
            double y = cy + ay * (s >= 0.0 ? 1.0 : -1.0) * pow(fabs(s), p);
            if (i == 0)
                cairo_move_to(cr, x, y);
            else
                cairo_line_to(cr, x, y);
        }
        cairo_close_path(cr);
    } else { // 0: Rounded Rect
        draw_rounded_rect_path(cr, gx, gy, gw, gh, gr);
    }
}

static inline double glsl_profileHeight(double t, double zScale, double profile_n) {
    double n = fmax(profile_n, 1.01);
    double invT = CLAMP(1.0 - t, 0.0, 1.0);
    double inner = fmax(1.0 - pow(invT, n), 0.0);
    double h = pow(inner, 1.0 / n);
    return h * zScale;
}

static inline double glsl_getHeight(double px, double py, double bx, double by, double r, double zScale, double edge_smoothing, double profile_n, int shape) {
    double d = glsl_sdShape(px, py, bx, by, r, shape);
    double smoothZone = fmax(edge_smoothing, 1.0);
    if (d > smoothZone)
        return 0.0;

    double maxDepth = (shape > 0) ? fmax(fmin(bx, by), 1.0) : fmax(r, 1.0);
    double interiorDepth = fmax(-d, 0.0);
    double t = CLAMP(interiorDepth / maxDepth, 0.0, 1.0);

    double h = glsl_profileHeight(t, zScale, profile_n);
    double fade = 1.0 - glsl_smoothstep(-smoothZone, smoothZone, d);
    return h * fade;
}

static inline void glsl_heightGradient(double px, double py, double bx, double by, double r, double zScale, double edge_smoothing, double profile_n, double e, int shape, double *out_gx, double *out_gy) {
    double dir_x, dir_y;
    glsl_sdShapeDir(px, py, bx, by, r, shape, &dir_x, &dir_y);
    double hOut = glsl_getHeight(px + dir_x * e, py + dir_y * e, bx, by, r, zScale, edge_smoothing, profile_n, shape);
    double hIn  = glsl_getHeight(px - dir_x * e, py - dir_y * e, bx, by, r, zScale, edge_smoothing, profile_n, shape);
    double factor = (hOut - hIn) / (2.0 * e);
    *out_gx = dir_x * factor;
    *out_gy = dir_y * factor;
}

static inline void glsl_getNormal(double gx, double gy, double *out_nx, double *out_ny, double *out_nz) {
    double vx = -gx;
    double vy = -gy;
    double vz = 1.0;
    double len = sqrt(vx * vx + vy * vy + vz * vz);
    *out_nx = vx / len;
    *out_ny = vy / len;
    *out_nz = vz / len;
}

static inline void sample_bilinear(const unsigned char *src_pixels, int stride, int width, int height, double sx, double sy, double *out_r, double *out_g, double *out_b) {
    int x0 = (int)floor(sx);
    int y0 = (int)floor(sy);
    int x1 = x0 + 1;
    int y1 = y0 + 1;
    double fx = sx - x0;
    double fy = sy - y0;

    x0 = CLAMP(x0, 0, width - 1);
    x1 = CLAMP(x1, 0, width - 1);
    y0 = CLAMP(y0, 0, height - 1);
    y1 = CLAMP(y1, 0, height - 1);

    uint32_t c00 = *(const uint32_t *)(src_pixels + y0 * stride + x0 * 4);
    uint32_t c10 = *(const uint32_t *)(src_pixels + y0 * stride + x1 * 4);
    uint32_t c01 = *(const uint32_t *)(src_pixels + y1 * stride + x0 * 4);
    uint32_t c11 = *(const uint32_t *)(src_pixels + y1 * stride + x1 * 4);

    double r00 = (c00 >> 16) & 0xFF, g00 = (c00 >> 8) & 0xFF, b00 = c00 & 0xFF;
    double r10 = (c10 >> 16) & 0xFF, g10 = (c10 >> 8) & 0xFF, b10 = c10 & 0xFF;
    double r01 = (c01 >> 16) & 0xFF, g01 = (c01 >> 8) & 0xFF, b01 = c01 & 0xFF;
    double r11 = (c11 >> 16) & 0xFF, g11 = (c11 >> 8) & 0xFF, b11 = c11 & 0xFF;

    double r0 = r00 * (1.0 - fx) + r10 * fx;
    double g0 = g00 * (1.0 - fx) + g10 * fx;
    double b0 = b00 * (1.0 - fx) + b10 * fx;

    double r1 = r01 * (1.0 - fx) + r11 * fx;
    double g1 = g01 * (1.0 - fx) + g11 * fx;
    double b1 = b01 * (1.0 - fx) + b11 * fx;

    *out_r = r0 * (1.0 - fy) + r1 * fy;
    *out_g = g0 * (1.0 - fy) + g1 * fy;
    *out_b = b0 * (1.0 - fy) + b1 * fy;
}

static void draw_repo_glass_element(cairo_t *cr, cairo_surface_t *bg, int width, int height,
                                    double gx, double gy, double gw, double gh, double gr, int shape) {
    if (!bg) return;

    // 1. Drop shadow with true shape contour
    double shadow_val = (double)state.liquid_shadow / 100.0;
    if (shadow_val > 0.02) {
        for (int i = 4; i >= 1; i--) {
            double expand = i * 2.5;
            double alpha = (shadow_val * 0.14) / i;
            draw_shape_path(cr, gx - expand, gy + 3.5 - expand / 2.0, gw + expand * 2.0, gh + expand * 2.0, gr + expand, shape);
            cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, alpha);
            cairo_fill(cr);
        }
    }

    cairo_save(cr);
    draw_shape_path(cr, gx, gy, gw, gh, gr, shape);
    cairo_clip(cr);

    int igx = (int)round(gx);
    int igy = (int)round(gy);
    int igw = (int)round(gw);
    int igh = (int)round(gh);

    cairo_surface_flush(bg);
    unsigned char *src_pixels = cairo_image_surface_get_data(bg);
    int src_stride = cairo_image_surface_get_stride(bg);

    cairo_surface_t *glass_surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, igw, igh);
    cairo_surface_flush(glass_surf);
    unsigned char *dst_pixels = cairo_image_surface_get_data(glass_surf);
    int dst_stride = cairo_image_surface_get_stride(glass_surf);

    double bx = gw * 0.5;
    double by = gh * 0.5;
    double max_z = 25.0;
    double profile_n = 7.0;
    double edge_smoothing = 2.0;
    double edgeFeather = fmax(edge_smoothing, 0.75);
    double ior = 2.40;
    double eta = 1.0 / fmax(ior, 1.001);

    // Upstream repo shader parameters:
    double disp_scale = ((double)state.liquid_refraction / 60.0) * 18.0;
    double chroma_str = ((double)state.liquid_chroma / 30.0) * 2.0;
    double tint_strength = ((double)state.liquid_tint / 100.0);
    double rim_intensity = ((double)state.liquid_rim / 50.0) * 0.60;
    double rim_width = 4.5;
    double rim_power = 4.0;
    double rim_directional_power = 2.7;
    double rim_light_color_intensity = 1.4;
    double sheen_intensity = 0.30;
    double spec_intensity = ((double)state.liquid_specular / 50.0) * 0.50;
    double shininess = 32.0;
    double ao_intensity = 0.30;
    double ao_radius = 8.0;

    double light_angle_rad = 1.5707963267948966; // 90 deg
    double lx_dir = cos(light_angle_rad);
    double ly_dir = sin(light_angle_rad);
    double lz_dir = 0.38;
    double l_len = sqrt(lx_dir * lx_dir + ly_dir * ly_dir + lz_dir * lz_dir);
    lx_dir /= l_len; ly_dir /= l_len; lz_dir /= l_len;

    for (int ly = 0; ly < igh; ly++) {
        uint32_t *dst_row = (uint32_t *)(dst_pixels + ly * dst_stride);
        double py = ly - by + 0.5;
        for (int lx = 0; lx < igw; lx++) {
            double px = lx - bx + 0.5;
            double d = glsl_sdShape(px, py, bx, by, gr, shape);
            if (d > 0.8) {
                dst_row[lx] = 0;
                continue;
            }

            double outsideTransition = glsl_smoothstep(-edgeFeather, edgeFeather, d);
            double insideMask = 1.0 - outsideTransition;

            // 1. Height gradient & 3D normal vector
            double grad_x, grad_y;
            glsl_heightGradient(px, py, bx, by, gr, max_z, edge_smoothing, profile_n, 0.5, shape, &grad_x, &grad_y);
            double nx, ny, nz;
            glsl_getNormal(grad_x, grad_y, &nx, &ny, &nz);

            // 2. Snell refraction ray
            double dot_NI = -nz;
            double k = 1.0 - eta * eta * (1.0 - dot_NI * dot_NI);
            double disp_x = 0.0, disp_y = 0.0;
            if (k >= 0.0 && d <= 0.0) {
                double factor = eta * dot_NI + sqrt(k);
                double ray_x = -factor * nx;
                double ray_y = -factor * ny;
                double ray_z = -eta - factor * nz;
                double safe_z = fmax(-ray_z, 0.15);
                disp_x = (ray_x / safe_z) * disp_scale;
                disp_y = (ray_y / safe_z) * disp_scale;
                double disp_len = sqrt(disp_x * disp_x + disp_y * disp_y);
                if (disp_len > 35.0) {
                    disp_x = (disp_x / disp_len) * 35.0;
                    disp_y = (disp_y / disp_len) * 35.0;
                }
                double edgeDampen = glsl_smoothstep(0.0, edgeFeather * 3.0, -d);
                disp_x *= edgeDampen;
                disp_y *= edgeDampen;
            }

            double disp_len = sqrt(disp_x * disp_x + disp_y * disp_y);
            double chroma_dx = (disp_len > 1e-5) ? (disp_x / disp_len) * chroma_str : 0.0;
            double chroma_dy = (disp_len > 1e-5) ? (disp_y / disp_len) * chroma_str : 0.0;

            double sx = gx + lx + disp_x;
            double sy = gy + ly + disp_y;

            double cr_r, cr_g, cr_b;
            sample_bilinear(src_pixels, src_stride, width, height, sx, sy, &cr_r, &cr_g, &cr_b);
            if (chroma_str > 0.01) {
                double r_val, dummy_g, dummy_b, b_val;
                sample_bilinear(src_pixels, src_stride, width, height, sx + chroma_dx, sy + chroma_dy, &r_val, &dummy_g, &dummy_b);
                sample_bilinear(src_pixels, src_stride, width, height, sx - chroma_dx, sy - chroma_dy, &dummy_g, &dummy_b, &b_val);
                cr_r = r_val;
                cr_b = b_val;
            }

            // 3. Tint
            double tint_r = 41.0, tint_g = 41.0, tint_b = 46.0;
            double base_r = cr_r * (1.0 - tint_strength) + tint_r * tint_strength;
            double base_g = cr_g * (1.0 - tint_strength) + tint_g * tint_strength;
            double base_b = cr_b * (1.0 - tint_strength) + tint_b * tint_strength;

            // 4. Ambient Occlusion (inner edge darkening)
            double aoMask = 1.0 - glsl_smoothstep(0.0, fmax(ao_radius, 0.001), -d);
            double aoFactor = 1.0 - aoMask * ao_intensity;
            base_r *= aoFactor;
            base_g *= aoFactor;
            base_b *= aoFactor;

            // 5. Lighting: Rim, Specular, Sheen
            double safeRimWidth = fmax(rim_width, 0.001);
            double edgeBand = (1.0 - glsl_smoothstep(0.0, safeRimWidth, fabs(d))) * (rim_width >= 0.0005 ? 1.0 : 0.0);
            double rimDot = 1.0 - fmax(nz, 0.0);
            double rimFresnel = pow(fmax(rimDot, 0.0), rim_power);
            double dotNL = nx * lx_dir + ny * ly_dir + nz * lz_dir;
            double lightMask = pow(fabs(dotNL), rim_directional_power);
            double rimShape = (pow(edgeBand, 0.85) * 0.45 + rimFresnel * 0.55) * edgeBand;
            double finalRimLight = rimShape * lightMask * rim_intensity * rim_light_color_intensity * 255.0;

            // Specular reflection
            double r_dir_z = 2.0 * dotNL * nz - lz_dir;
            double specDot = fmax(r_dir_z, 0.0);
            double specLight = pow(specDot, shininess) * spec_intensity * 255.0;
            double specMask = (0.25 * (1.0 - insideMask) + insideMask) * CLAMP(edgeBand + insideMask * 0.65, 0.0, 1.0);
            specLight *= specMask;

            // Sheen
            double sheenFacing = fmax(dotNL, 0.0);
            double surfaceSheen = pow(sheenFacing, 1.65) * (1.0 * (1.0 - edgeBand) + 0.55 * edgeBand);
            double sheenLight = surfaceSheen * sheen_intensity * 255.0;

            double added = specLight + finalRimLight + sheenLight;
            double lit_r = base_r + added - (base_r * added / 255.0);
            double lit_g = base_g + added - (base_g * added / 255.0);
            double lit_b = base_b + added - (base_b * added / 255.0);

            uint8_t out_a = (uint8_t)CLAMP(insideMask * 255.0, 0, 255);
            uint8_t out_r = (uint8_t)CLAMP(lit_r, 0, 255);
            uint8_t out_g = (uint8_t)CLAMP(lit_g, 0, 255);
            uint8_t out_b = (uint8_t)CLAMP(lit_b, 0, 255);

            dst_row[lx] = (out_a << 24) | (out_r << 16) | (out_g << 8) | out_b;
        }
    }

    cairo_surface_mark_dirty(glass_surf);
    cairo_set_source_surface(cr, glass_surf, igx, igy);
    cairo_paint(cr);
    cairo_surface_destroy(glass_surf);

    // Center icon/dots for repo element
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.65);
    for (int d = -1; d <= 1; d++) {
        cairo_arc(cr, gx + gw / 2.0 + d * 9.0, gy + gh / 2.0, 2.2, 0, 2 * G_PI);
        cairo_fill(cr);
    }

    cairo_restore(cr);
}

static void liquid_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    // 1. Clip preview container with rounded corners
    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    // 2. Wallpaper background
    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_pattern_t *fallback = cairo_pattern_create_linear(0, 0, width, height);
        cairo_pattern_add_color_stop_rgb(fallback, 0.0, 0.12, 0.15, 0.22);
        cairo_pattern_add_color_stop_rgb(fallback, 1.0, 0.25, 0.18, 0.15);
        cairo_set_source(cr, fallback);
        cairo_paint(cr);
        cairo_pattern_destroy(fallback);
    }

    // 3. Interactive Liquid Glass Shape Element
    double gw = 150.0, gh = 110.0, gr = 24.0;
    if (state.liquid_shape == 1) { // Circle
        gw = 116.0; gh = 116.0; gr = 58.0;
    } else if (state.liquid_shape == 2) { // Capsule
        gw = 160.0; gh = 92.0; gr = 46.0;
    } else if (state.liquid_shape == 3) { // Squircle
        gw = 124.0; gh = 124.0; gr = 28.0;
    }

    if (g_glass_x < 0) {
        g_glass_x = (width - gw) / 2.0;
        g_glass_y = (height - gh) / 2.0;
    }
    double gx = CLAMP(g_glass_x, 6.0, width - gw - 6.0);
    double gy = CLAMP(g_glass_y, 6.0, height - gh - 6.0);

    // Render using the physical repo shader with the active shape
    draw_repo_glass_element(cr, bg, width, height, gx, gy, gw, gh, gr, state.liquid_shape);

    // Floating shape badge above element
    const char *shape_names[] = {
        "Заокруглений прямокутник",
        "Коло",
        "Капсула",
        "Сквіркл Apple"
    };
    int shape_idx = CLAMP(state.liquid_shape, 0, 3);
    char badge_text[128];
    g_snprintf(badge_text, sizeof(badge_text), "Liquid Glass • %s", shape_names[shape_idx]);

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 11.0);
    cairo_text_extents_t ext;
    cairo_text_extents(cr, badge_text, &ext);
    double bx = gx + (gw - ext.width) / 2.0;
    double by = gy - 10.0;
    if (by < 16.0) by = gy + gh + 18.0;

    draw_rounded_rect_path(cr, bx - 10.0, by - 12.0, ext.width + 20.0, 19.0, 9.5);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.58);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, bx - 10.0, by - 12.0, ext.width + 20.0, 19.0, 9.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.15);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);

    cairo_move_to(cr, bx, by + 1.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_show_text(cr, badge_text);

    // Outer preview border
    cairo_restore(cr);
    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_liquid_preview(void *widget, gpointer data) {
    (void)data;
    g_liquid_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), liquid_preview_draw_func, NULL, NULL);

    GtkGesture *drag = gtk_gesture_drag_new();
    gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(drag), GDK_BUTTON_PRIMARY);
    g_signal_connect(drag, "drag-begin", G_CALLBACK(on_liquid_drag_begin), widget);
    g_signal_connect(drag, "drag-update", G_CALLBACK(on_liquid_drag_update), widget);
    g_signal_connect(drag, "drag-end", G_CALLBACK(on_liquid_drag_end), widget);
    gtk_widget_add_controller(GTK_WIDGET(widget), GTK_EVENT_CONTROLLER(drag));

    gtk_widget_set_cursor_from_name(GTK_WIDGET(widget), "grab");
}

/* Group 2: Liquid Glass Callbacks */
void init_liquid_shape(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    guint idx = (guint)CLAMP(state.liquid_shape, 0, 3);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), idx);
    in_init = 0;
}

void on_liquid_shape_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    guint sel = adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    state.liquid_shape = (int)CLAMP((int)sel, 0, 3);
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

void init_liquid_refraction(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_refraction);
    in_init = 0;
}

void on_liquid_refraction_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_refraction = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

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
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
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
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

void init_liquid_chroma(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_chroma);
    in_init = 0;
}

void on_liquid_chroma_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_chroma = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

void init_liquid_rim(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_rim);
    in_init = 0;
}

void on_liquid_rim_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_rim = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

void init_liquid_specular(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_specular);
    in_init = 0;
}

void on_liquid_specular_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_specular = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

void init_liquid_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.liquid_shadow);
    in_init = 0;
}

void on_liquid_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.liquid_shadow = (int)lround(gtk_range_get_value(widget));
    schedule_liquid_glass_apply();
    redraw_liquid_preview();
    schedule_json_save();
}

/* Group: Spotlight Callbacks */
void init_spotlight_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.spotlight_blur);
    in_init = 0;
}

void on_spotlight_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.spotlight_blur = (int)lround(gtk_range_get_value(widget));
    schedule_spotlight_apply();
    schedule_json_save();
}

void init_spotlight_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.spotlight_tint);
    in_init = 0;
}

void on_spotlight_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.spotlight_tint = (int)lround(gtk_range_get_value(widget));
    schedule_spotlight_apply();
    schedule_json_save();
}

void init_spotlight_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.spotlight_shadow);
    in_init = 0;
}

void on_spotlight_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.spotlight_shadow = (int)lround(gtk_range_get_value(widget));
    schedule_spotlight_apply();
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

/* Group 5: Widgets Callbacks */
void init_widget_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.widget_blur);
    in_init = 0;
}

void on_widget_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.widget_blur = (int)lround(gtk_range_get_value(widget));
    schedule_widget_apply();
    schedule_json_save();
}

void init_widget_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.widget_tint);
    in_init = 0;
}

void on_widget_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.widget_tint = (int)lround(gtk_range_get_value(widget));
    schedule_widget_apply();
    schedule_json_save();
}

void init_widget_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.widget_shadow);
    in_init = 0;
}

void on_widget_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.widget_shadow = (int)lround(gtk_range_get_value(widget));
    schedule_widget_apply();
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
            mac_tr("power_performance_desc", "Швидкодія: Р-ядра (0-7) закріплено за іграми • Е-ядра (8-11) для фонових задач ОС"));
    } else if (g_strcmp0(profile, "power-saver") == 0) {
        adw_action_row_set_subtitle(ADW_ACTION_ROW(g_game_mode_switch_w),
            mac_tr("power_saver_desc", "Заощадження: знижена частота ядер, тихий режим"));
    } else {
        adw_action_row_set_subtitle(ADW_ACTION_ROW(g_game_mode_switch_w),
            mac_tr("power_balanced_desc", "Баланс: стандартна швидкодія та динамічний розподіл ядер"));
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
            mac_tr("power_performance_desc", "Швидкодія: Р-ядра (0-7) закріплено за іграми • Е-ядра (8-11) для фонових задач ОС"));
    } else {
        g_spawn_command_line_async("powerprofilesctl set balanced", NULL);
        g_spawn_command_line_async("sudo /usr/local/bin/mac-gamemode off", NULL);
        adw_action_row_set_subtitle(ADW_ACTION_ROW(widget),
            mac_tr("power_balanced_desc", "Баланс: стандартна швидкодія та динамічний розподіл ядер"));
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
    if (!raw) return g_strdup(strcmp(mac_get_locale(), "uk") == 0 ? "Невідома відеокарта" : "Unknown Graphics Card");

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
        g_strlcpy(g_detected_gpus[0].pretty_name, (strcmp(mac_get_locale(), "uk") == 0 ? "Інтегрована відеокарта" : "Integrated Graphics"), 128);
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

static void on_fan_card_destroy(gpointer user_data) {
    DualRangeSliderData *d = (DualRangeSliderData *)user_data;
    if (!d) return;
    g_fan_subrows_data = g_list_remove(g_fan_subrows_data, d);
    if (d->subtitle_label) {
        g_object_remove_weak_pointer(G_OBJECT(d->subtitle_label), (gpointer *)&d->subtitle_label);
        d->subtitle_label = NULL;
    }
    if (d->badge_label) {
        g_object_remove_weak_pointer(G_OBJECT(d->badge_label), (gpointer *)&d->badge_label);
        d->badge_label = NULL;
    }
    if (d->drawing_area) {
        g_object_remove_weak_pointer(G_OBJECT(d->drawing_area), (gpointer *)&d->drawing_area);
        d->drawing_area = NULL;
    }
    g_free(d);

    if (g_fan_subrows_data == NULL && g_fan_rpm_timer_id != 0) {
        g_source_remove(g_fan_rpm_timer_id);
        g_fan_rpm_timer_id = 0;
    }
}

static gboolean update_fan_rpms_timer_cb(gpointer user_data) {
    (void)user_data;
    if (!g_fan_subrows_data) {
        g_fan_rpm_timer_id = 0;
        return G_SOURCE_REMOVE;
    }

    detect_fans();

    for (GList *l = g_fan_subrows_data; l != NULL; l = l->next) {
        DualRangeSliderData *d = (DualRangeSliderData *)l->data;
        if (!d || !d->subtitle_label) continue;
        if (!GTK_IS_WIDGET(d->subtitle_label) || !GTK_IS_LABEL(d->subtitle_label)) continue;
        if (!gtk_widget_get_mapped(GTK_WIDGET(d->subtitle_label))) continue;

        int rpm = d->is_gpu ? g_gpu_fan_rpm : g_cpu_fan_rpm;
        if (rpm > 0) {
            char sub_text[128];
            snprintf(sub_text, sizeof(sub_text), (strcmp(mac_get_locale(), "uk") == 0 ? "Авторегулювання швидкості • %d RPM" : "Auto speed adjustment • %d RPM"), rpm);
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
    GtkWidget *title_lbl = gtk_label_new(is_gpu ? mac_tr("fan_gpu", "Вентилятор відеокарти (GPU)") : mac_tr("fan_cpu", "Вентилятор процесора (ЦП)"));
    gtk_label_set_xalign(GTK_LABEL(title_lbl), 0.0);
    gtk_widget_add_css_class(title_lbl, "fan-card-title");

    char sub_text[128];
    int rpm = is_gpu ? g_gpu_fan_rpm : g_cpu_fan_rpm;
    if (rpm > 0) {
        snprintf(sub_text, sizeof(sub_text), (strcmp(mac_get_locale(), "uk") == 0 ? "Авторегулювання швидкості • %d RPM" : "Auto speed adjustment • %d RPM"), rpm);
    } else {
        snprintf(sub_text, sizeof(sub_text), "%s", mac_tr("fan_dynamic_range", "Динамічний діапазон авторегулювання швидкості"));
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

    g_object_add_weak_pointer(G_OBJECT(sub_lbl), (gpointer *)&slider_data->subtitle_label);
    g_object_add_weak_pointer(G_OBJECT(badge), (gpointer *)&slider_data->badge_label);
    g_object_add_weak_pointer(G_OBJECT(area), (gpointer *)&slider_data->drawing_area);

    g_fan_subrows_data = g_list_append(g_fan_subrows_data, slider_data);
    g_object_set_data_full(G_OBJECT(card), "fan_slider_data", slider_data, on_fan_card_destroy);

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

    GtkWidget *min_lbl = gtk_label_new(mac_tr("fan_min_threshold", "Мін: тихий поріг"));
    gtk_label_set_xalign(GTK_LABEL(min_lbl), 0.0);
    gtk_widget_add_css_class(min_lbl, "dim-label");
    gtk_widget_add_css_class(min_lbl, "caption");
    gtk_widget_set_hexpand(min_lbl, TRUE);
    gtk_box_append(GTK_BOX(labels_box), min_lbl);

    GtkWidget *max_lbl = gtk_label_new(mac_tr("fan_max_threshold", "Макс: пікове навантаження"));
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
    g_object_set_data(G_OBJECT(sub_row), "is_fan_subrow", GINT_TO_POINTER(1));
    g_object_set_data(G_OBJECT(sub_row), "profile_idx", GINT_TO_POINTER(profile_idx));

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
        GtkWidget *no_fans_lbl = gtk_label_new(mac_tr("no_fans_detected", "У пристрої не виявлено керованих вентиляторів"));
        gtk_widget_add_css_class(no_fans_lbl, "dim-label");
        gtk_box_append(GTK_BOX(container), no_fans_lbl);
    }

    gtk_revealer_set_child(GTK_REVEALER(revealer), container);
    gtk_list_box_row_set_child(GTK_LIST_BOX_ROW(sub_row), revealer);
    gtk_widget_set_visible(sub_row, FALSE);

    return sub_row;
}

static int get_row_sort_key(GtkListBoxRow *row) {
    if (!row) return 999;
    if (g_object_get_data(G_OBJECT(row), "is_fan_subrow") != NULL) {
        int p = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "profile_idx"));
        return (p * 10) + 1;
    }

    GType prof_type = g_type_from_name("CcPowerProfileRow");
    int profile_val = 1;

    if (prof_type != 0 && g_type_is_a(G_OBJECT_TYPE(row), prof_type)) {
        typedef int (*CcGetProfileFn)(void *);
        static CcGetProfileFn get_prof = NULL;
        if (!get_prof) get_prof = (CcGetProfileFn)dlsym(RTLD_DEFAULT, "cc_power_profile_row_get_profile");
        if (get_prof) {
            int p = get_prof(row);
            if (p >= 0 && p <= 2) profile_val = p;
        }
    } else if (ADW_IS_PREFERENCES_ROW(row)) {
        const char *title = adw_preferences_row_get_title(ADW_PREFERENCES_ROW(row));
        if (title) {
            if (strstr(title, "Швидкодія") || strstr(title, "Performance") || strstr(title, "швидкодія")) {
                profile_val = 0;
            } else if (strstr(title, "Заощадження") || strstr(title, "Power") || strstr(title, "заощадження")) {
                profile_val = 2;
            } else {
                profile_val = 1;
            }
        }
    }

    return (profile_val * 10) + 0;
}

static int mac_safe_power_profile_sort_func(GtkListBoxRow *row1, GtkListBoxRow *row2, gpointer user_data) {
    (void)user_data;
    int k1 = get_row_sort_key(row1);
    int k2 = get_row_sort_key(row2);
    if (k1 < k2) return -1;
    if (k1 > k2) return 1;
    return 0;
}

typedef struct {
    GtkListBoxRow *row;
    void *unused1;
    int category;
    int unused2;
    char *id;
} MacPanelRowData;

static int get_sidebar_panel_group(const char *id) {
    if (!id) return -1;
    if (g_strcmp0(id, "account") == 0) return 0;
    if (g_strcmp0(id, "wifi") == 0 ||
        g_strcmp0(id, "bluetooth") == 0 ||
        g_strcmp0(id, "network") == 0 ||
        g_strcmp0(id, "wwan") == 0 ||
        g_strcmp0(id, "mobile-broadband") == 0 ||
        g_strcmp0(id, "power") == 0) return 1;

    if (g_strcmp0(id, "system") == 0 ||
        g_strcmp0(id, "universal-access") == 0 ||
        g_strcmp0(id, "background") == 0 ||
        g_strcmp0(id, "ubuntu") == 0 ||
        g_strcmp0(id, "widgets") == 0 ||
        g_strcmp0(id, "display") == 0 ||
        g_strcmp0(id, "multitasking") == 0) return 2;

    if (g_strcmp0(id, "notifications") == 0 ||
        g_strcmp0(id, "sound") == 0) return 3;

    return 4; /* Група 4: Різне */
}

static const char *get_sidebar_row_panel_id(GtkListBoxRow *row) {
    if (!row) return NULL;
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
        return "account";
    }
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_widgets_row"))) {
        return "widgets";
    }
    void *d = g_object_get_data(G_OBJECT(row), "data");
    if (!d) return NULL;
    return *((const char **)((char *)d + 0x18));
}

static double get_sidebar_panel_rank(GtkListBoxRow *row) {
    if (!row) return 999.0;
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
        return -30.0;
    }
    const char *id = get_sidebar_row_panel_id(row);
    if (!id) return 999.0;

    static const char * const panel_order[] = {
        /* Група 1: Мережа та живлення */
        "wifi", "bluetooth", "network", "wwan", "mobile-broadband", "power",

        /* Група 2: Системні параметри */
        "system", "universal-access", "background", "ubuntu", "widgets", "display", "multitasking",

        /* Група 3: Звук і сповіщення */
        "notifications", "sound",

        /* Група 4: Різне */
        "applications", "search", "online-accounts", "sharing",
        "mouse", "keyboard", "color", "printers",
        "privacy", "wacom", "wellbeing",
        NULL
    };
    for (int i = 0; panel_order[i] != NULL; i++) {
        if (g_strcmp0(panel_order[i], id) == 0) {
            return (double)i;
        }
    }
    return 500.0;
}

static gboolean is_sidebar_group_start_id(const char *id) {
    if (!id) return FALSE;
    if (g_strcmp0(id, "system") == 0) return TRUE;        /* Початок Групи 2 (Системні параметри) */
    if (g_strcmp0(id, "notifications") == 0) return TRUE; /* Початок Групи 3 (Звук і сповіщення) */
    if (g_strcmp0(id, "applications") == 0) return TRUE;  /* Початок Групи 4 (Різне) */
    return FALSE;
}

static void update_sidebar_group_spacing(GtkListBox *listbox) {
    if (!listbox) return;
    for (int i = 0; ; i++) {
        GtkListBoxRow *row = gtk_list_box_get_row_at_index(listbox, i);
        if (!row) break;

        /* Примусово прибираємо будь-які GtkSeparator хедери, встановлені GNOME */
        gtk_list_box_row_set_header(row, NULL);

        if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
            gtk_widget_remove_css_class(GTK_WIDGET(row), "mac-sidebar-group-start");
            continue;
        }

        const char *id = get_sidebar_row_panel_id(row);
        if (is_sidebar_group_start_id(id)) {
            gtk_widget_add_css_class(GTK_WIDGET(row), "mac-sidebar-group-start");
        } else {
            gtk_widget_remove_css_class(GTK_WIDGET(row), "mac-sidebar-group-start");
        }
    }
}

static gboolean update_sidebar_group_spacing_idle(gpointer user_data) {
    GtkListBox *box = GTK_LIST_BOX(user_data);
    if (box && GTK_IS_LIST_BOX(box)) {
        update_sidebar_group_spacing(box);
    }
    return G_SOURCE_REMOVE;
}

static int mac_main_listbox_sort_func(GtkListBoxRow *row1, GtkListBoxRow *row2, gpointer user_data) {
    (void)user_data;
    double r1 = get_sidebar_panel_rank(row1);
    double r2 = get_sidebar_panel_rank(row2);
    if (r1 < r2) return -1;
    if (r1 > r2) return 1;
    return 0;
}

void gtk_list_box_set_sort_func(GtkListBox *box,
                                GtkListBoxSortFunc sort_func,
                                gpointer user_data,
                                GDestroyNotify destroy)
{
    static void (*orig_set_sort_func)(GtkListBox *, GtkListBoxSortFunc, gpointer, GDestroyNotify) = NULL;
    if (!orig_set_sort_func) orig_set_sort_func = dlsym(RTLD_NEXT, "gtk_list_box_set_sort_func");

    const char *id = (box && GTK_IS_BUILDABLE(box)) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(box)) : NULL;
    const char *name = (box && GTK_IS_WIDGET(box)) ? gtk_widget_get_name(GTK_WIDGET(box)) : NULL;

    gboolean is_power_profile_list = FALSE;
    if ((id && g_strcmp0(id, "power_profile_listbox") == 0) ||
        (name && g_strcmp0(name, "power_profile_listbox") == 0)) {
        is_power_profile_list = TRUE;
    } else if (box && GTK_IS_WIDGET(box)) {
        GType panel_type = g_type_from_name("CcPowerPanel");
        if (panel_type != 0 && gtk_widget_get_ancestor(GTK_WIDGET(box), panel_type) != NULL) {
            GtkWidget *section = gtk_widget_get_ancestor(GTK_WIDGET(box), g_type_from_name("AdwPreferencesGroup"));
            if (section) {
                const char *sec_id = GTK_IS_BUILDABLE(section) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(section)) : NULL;
                if (sec_id && g_strcmp0(sec_id, "power_profile_section") == 0) {
                    is_power_profile_list = TRUE;
                }
            }
        }
    }

    if (is_power_profile_list && sort_func != NULL) {
        if (orig_set_sort_func) {
            orig_set_sort_func(box, mac_safe_power_profile_sort_func, NULL, NULL);
        }
        return;
    }

    /* Check sidebar main_listbox */
    gboolean is_sidebar_main_list = FALSE;
    if ((id && g_strcmp0(id, "main_listbox") == 0) ||
        (name && g_strcmp0(name, "main_listbox") == 0)) {
        is_sidebar_main_list = TRUE;
    } else if (box && GTK_IS_WIDGET(box)) {
        GType plist_type = g_type_from_name("CcPanelList");
        if (plist_type != 0 && gtk_widget_get_ancestor(GTK_WIDGET(box), plist_type) != NULL) {
            if (gtk_widget_has_css_class(GTK_WIDGET(box), "navigation-sidebar")) {
                if ((!id || g_strcmp0(id, "search_listbox") != 0) &&
                    (!name || g_strcmp0(name, "search_listbox") != 0)) {
                    is_sidebar_main_list = TRUE;
                }
            }
        }
    }

    if (is_sidebar_main_list) {
        if (orig_set_sort_func) {
            orig_set_sort_func(box, mac_main_listbox_sort_func, NULL, NULL);
        }
        return;
    }

    if (orig_set_sort_func) {
        orig_set_sort_func(box, sort_func, user_data, destroy);
    }
}

void gtk_list_box_set_header_func(GtkListBox *box,
                                  GtkListBoxUpdateHeaderFunc update_header,
                                  gpointer user_data,
                                  GDestroyNotify destroy)
{
    static void (*orig_set_header_func)(GtkListBox *, GtkListBoxUpdateHeaderFunc, gpointer, GDestroyNotify) = NULL;
    if (!orig_set_header_func) orig_set_header_func = dlsym(RTLD_NEXT, "gtk_list_box_set_header_func");

    const char *id = (box && GTK_IS_BUILDABLE(box)) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(box)) : NULL;
    const char *name = (box && GTK_IS_WIDGET(box)) ? gtk_widget_get_name(GTK_WIDGET(box)) : NULL;

    gboolean is_sidebar_main_list = FALSE;
    if ((id && g_strcmp0(id, "main_listbox") == 0) ||
        (name && g_strcmp0(name, "main_listbox") == 0)) {
        is_sidebar_main_list = TRUE;
    } else if (box && GTK_IS_WIDGET(box)) {
        GType plist_type = g_type_from_name("CcPanelList");
        if (plist_type != 0 && gtk_widget_get_ancestor(GTK_WIDGET(box), plist_type) != NULL) {
            if (gtk_widget_has_css_class(GTK_WIDGET(box), "navigation-sidebar")) {
                if ((!id || g_strcmp0(id, "search_listbox") != 0) &&
                    (!name || g_strcmp0(name, "search_listbox") != 0)) {
                    is_sidebar_main_list = TRUE;
                }
            }
        }
    }

    if (is_sidebar_main_list) {
        /* Disallow GNOME's hardcoded category separators inside macOS sidebar */
        if (orig_set_header_func) {
            orig_set_header_func(box, NULL, NULL, NULL);
        }
        return;
    }

    if (orig_set_header_func) {
        orig_set_header_func(box, update_header, user_data, destroy);
    }
}

static gboolean attach_fan_subrow_idle(gpointer user_data) {
    GtkWidget *btn = GTK_WIDGET(user_data);
    if (!btn || !GTK_IS_WIDGET(btn)) return G_SOURCE_REMOVE;

    GType prof_type = g_type_from_name("CcPowerProfileRow");
    GtkWidget *row = prof_type ? gtk_widget_get_ancestor(btn, prof_type) : NULL;
    if (!row) row = gtk_widget_get_ancestor(btn, g_type_from_name("AdwActionRow"));
    if (!row) row = gtk_widget_get_ancestor(btn, GTK_TYPE_LIST_BOX_ROW);
    if (!row) return G_SOURCE_REMOVE;

    GtkWidget *listbox = gtk_widget_get_ancestor(row, GTK_TYPE_LIST_BOX);
    if (!listbox) return G_SOURCE_CONTINUE;

    if (g_object_get_data(G_OBJECT(row), "has_fan_subrow")) return G_SOURCE_REMOVE;

    int idx = gtk_list_box_row_get_index(GTK_LIST_BOX_ROW(row));
    if (idx < 0) return G_SOURCE_CONTINUE;

    g_object_set_data(G_OBJECT(row), "has_fan_subrow", GINT_TO_POINTER(1));

    int profile_idx = 1;
    if (prof_type != 0 && g_type_is_a(G_OBJECT_TYPE(row), prof_type)) {
        typedef int (*CcGetProfileFn)(void *);
        CcGetProfileFn get_prof = (CcGetProfileFn)dlsym(RTLD_DEFAULT, "cc_power_profile_row_get_profile");
        if (get_prof) {
            int p = get_prof(row);
            if (p >= 0 && p <= 2) profile_idx = p;
        }
    } else if (ADW_IS_PREFERENCES_ROW(row)) {
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
    g_object_set_data(G_OBJECT(sub_row), "is_fan_subrow", GINT_TO_POINTER(1));
    g_object_set_data(G_OBJECT(sub_row), "profile_idx", GINT_TO_POINTER(profile_idx));

    /* Ensure listbox has safe sort func installed so it won't crash when sorting sub_row */
    static void (*orig_set_sort_func)(GtkListBox *, GtkListBoxSortFunc, gpointer, GDestroyNotify) = NULL;
    if (!orig_set_sort_func) orig_set_sort_func = dlsym(RTLD_NEXT, "gtk_list_box_set_sort_func");
    if (orig_set_sort_func) {
        orig_set_sort_func(GTK_LIST_BOX(listbox), mac_safe_power_profile_sort_func, NULL, NULL);
    }

    gtk_list_box_insert(GTK_LIST_BOX(listbox), sub_row, idx + 1);

    return G_SOURCE_REMOVE;
}

static GList *g_fan_expand_buttons = NULL;

static void find_toggle_button_child(GtkWidget *widget, gpointer data);

static void on_fan_expand_btn_destroyed(gpointer data, GObject *where_the_object_was) {
    (void)data;
    g_fan_expand_buttons = g_list_remove(g_fan_expand_buttons, where_the_object_was);
}

static void register_fan_expand_button(GtkWidget *btn) {
    if (!btn || !GTK_IS_TOGGLE_BUTTON(btn)) return;
    if (g_list_find(g_fan_expand_buttons, btn)) return;
    g_fan_expand_buttons = g_list_append(g_fan_expand_buttons, btn);
    g_object_weak_ref(G_OBJECT(btn), on_fan_expand_btn_destroyed, NULL);
}

void mac_power_profile_fan_btn_realize(GtkWidget *btn, gpointer user_data) {
    (void)user_data;
    if (!btn) return;
    gtk_widget_set_name(btn, "profile_fan_expand_btn");
    register_fan_expand_button(btn);
    g_idle_add(attach_fan_subrow_idle, btn);
}

void mac_power_profile_fan_btn_toggled(GtkWidget *btn, gpointer user_data) {
    (void)user_data;
    if (!btn || !GTK_IS_TOGGLE_BUTTON(btn)) return;
    gtk_widget_set_name(btn, "profile_fan_expand_btn");
    register_fan_expand_button(btn);

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
        /* Mutually exclusive radio accordion: close any other open power profile sub-rows */
        static gboolean in_accordion_sync = FALSE;
        if (!in_accordion_sync) {
            in_accordion_sync = TRUE;

            /* 1. Deselect other buttons in registered list */
            for (GList *l = g_fan_expand_buttons; l != NULL; l = l->next) {
                GtkWidget *other = GTK_WIDGET(l->data);
                if (other && other != btn && GTK_IS_TOGGLE_BUTTON(other)) {
                    if (gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(other))) {
                        gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(other), FALSE);
                    }
                }
            }

            /* 2. Fail-safe scan of parent listbox rows */
            GtkWidget *row = gtk_widget_get_ancestor(btn, GTK_TYPE_LIST_BOX_ROW);
            GtkWidget *listbox = row ? gtk_widget_get_ancestor(row, GTK_TYPE_LIST_BOX) : NULL;
            if (listbox) {
                for (GtkWidget *child = gtk_widget_get_first_child(listbox); child != NULL; child = gtk_widget_get_next_sibling(child)) {
                    if (child == row || child == sub_row) continue;
                    GtkWidget *other_btn = NULL;
                    find_toggle_button_child(child, &other_btn);
                    if (other_btn && other_btn != btn && GTK_IS_TOGGLE_BUTTON(other_btn)) {
                        if (gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(other_btn))) {
                            gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(other_btn), FALSE);
                        }
                    }
                }
            }

            in_accordion_sync = FALSE;
        }

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
    gboolean created_dynamic = FALSE;

    if (!btn) {
        btn = gtk_toggle_button_new();
        gtk_button_set_icon_name(GTK_BUTTON(btn), "pan-down-symbolic");
        gtk_widget_set_valign(btn, GTK_ALIGN_CENTER);
        gtk_widget_set_tooltip_text(btn, mac_tr("fan_speed", "Швидкість вентиляторів"));
        gtk_widget_add_css_class(btn, "flat");
        gtk_widget_add_css_class(btn, "circular");
        adw_action_row_add_suffix(ADW_ACTION_ROW(row), btn);
        created_dynamic = TRUE;
    }

    if (btn) {
        gtk_widget_set_name(btn, "profile_fan_expand_btn");
        register_fan_expand_button(btn);
        if (created_dynamic && !g_object_get_data(G_OBJECT(btn), "signals_hooked")) {
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

static void find_view_switchers_recursive(GtkWidget *widget, GList **list)
{
    if (!widget) return;
    if (ADW_IS_VIEW_SWITCHER(widget)) {
        *list = g_list_append(*list, widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_view_switchers_recursive(child, list);
    }
}

typedef struct {
    GtkWidget *switcher;
    gboolean has_bounds;
    float pill_x, pill_y, pill_w, pill_h;
    float start_x, start_w, target_x, target_w;
    AdwAnimation *anim;
} MacSwitcherAnimData;

static void (*orig_switcher_snapshot)(GtkWidget *widget, GtkSnapshot *snapshot) = NULL;

static void mac_switcher_anim_cb(double value, gpointer user_data) {
    MacSwitcherAnimData *data = (MacSwitcherAnimData *)user_data;
    if (!data || !data->switcher) return;
    data->pill_x = data->start_x + (data->target_x - data->start_x) * (float)value;
    data->pill_w = data->start_w + (data->target_w - data->start_w) * (float)value;
    gtk_widget_queue_draw(data->switcher);
}

static void mac_update_switcher_pill(GtkWidget *vs, gboolean animate) {
    if (!vs || !ADW_IS_VIEW_SWITCHER(vs)) return;
    MacSwitcherAnimData *data = g_object_get_data(G_OBJECT(vs), "mac-switcher-anim");
    if (!data) return;

    GtkWidget *active_btn = NULL;
    for (GtkWidget *c = gtk_widget_get_first_child(vs); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        if (GTK_IS_TOGGLE_BUTTON(c) && gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(c))) {
            active_btn = c;
            break;
        }
    }
    if (!active_btn) return;

    graphene_rect_t bounds;
    if (!gtk_widget_compute_bounds(active_btn, vs, &bounds)) return;

    float tx = bounds.origin.x;
    float ty = bounds.origin.y;
    float tw = bounds.size.width;
    float th = bounds.size.height;

    if (tw <= 0.0f || th <= 0.0f) return;

    if (!data->has_bounds || !animate) {
        if (data->anim) {
            adw_animation_pause(data->anim);
            g_object_unref(data->anim);
            data->anim = NULL;
        }
        data->has_bounds = TRUE;
        data->pill_x = tx;
        data->pill_y = ty;
        data->pill_w = tw;
        data->pill_h = th;
        data->target_x = tx;
        data->target_w = tw;
        gtk_widget_queue_draw(vs);
        return;
    }

    if (fabsf(data->target_x - tx) < 0.5f && fabsf(data->target_w - tw) < 0.5f) return;

    data->start_x = data->pill_x;
    data->start_w = data->pill_w;
    data->target_x = tx;
    data->target_w = tw;
    data->pill_y = ty;
    data->pill_h = th;

    if (data->anim) {
        adw_animation_pause(data->anim);
        g_object_unref(data->anim);
        data->anim = NULL;
    }

    AdwAnimationTarget *target = adw_callback_animation_target_new(mac_switcher_anim_cb, data, NULL);
    AdwTimedAnimation *t_anim = ADW_TIMED_ANIMATION(adw_timed_animation_new(vs, 0.0, 1.0, 220, target));
    adw_timed_animation_set_easing(t_anim, ADW_EASE_OUT_CUBIC);
    data->anim = ADW_ANIMATION(t_anim);
    adw_animation_play(data->anim);
}

static void on_switcher_btn_toggled(GtkToggleButton *btn, gpointer user_data) {
    if (gtk_toggle_button_get_active(btn)) {
        mac_update_switcher_pill(GTK_WIDGET(user_data), TRUE);
    }
}

static void on_switcher_stack_child_notify(GObject *stack, GParamSpec *pspec, gpointer user_data) {
    (void)stack;
    (void)pspec;
    mac_update_switcher_pill(GTK_WIDGET(user_data), TRUE);
}

static void setup_mac_view_switcher(GtkWidget *vs);

static void mac_view_switcher_snapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
    MacSwitcherAnimData *data = g_object_get_data(G_OBJECT(widget), "mac-switcher-anim");
    if (!data) {
        setup_mac_view_switcher(widget);
        data = g_object_get_data(G_OBJECT(widget), "mac-switcher-anim");
    }

    if (data) {
        for (GtkWidget *c = gtk_widget_get_first_child(widget); c != NULL; c = gtk_widget_get_next_sibling(c)) {
            if (GTK_IS_TOGGLE_BUTTON(c) && !g_object_get_data(G_OBJECT(c), "mac_btn_connected")) {
                g_object_set_data(G_OBJECT(c), "mac_btn_connected", GINT_TO_POINTER(1));
                g_signal_connect(c, "toggled", G_CALLBACK(on_switcher_btn_toggled), widget);
            }
        }

        if (!data->has_bounds) {
            mac_update_switcher_pill(widget, FALSE);
        }

        if (data->has_bounds && data->pill_w > 0.0f && data->pill_h > 0.0f) {
            graphene_rect_t rect = GRAPHENE_RECT_INIT(
                data->pill_x, data->pill_y, data->pill_w, data->pill_h
            );
            GskRoundedRect rounded;
            float radius = data->pill_h / 2.0f;
            gsk_rounded_rect_init_from_rect(&rounded, &rect, radius);

            GdkRGBA shadow_color = { 0.0f, 0.0f, 0.0f, 0.40f };
            gtk_snapshot_append_outset_shadow(snapshot, &rounded, &shadow_color, 0.0f, 1.5f, 0.0f, 3.0f);

            gtk_snapshot_push_rounded_clip(snapshot, &rounded);
            GdkRGBA bg_color = { 0.17f, 0.17f, 0.19f, 0.95f };
            gtk_snapshot_append_color(snapshot, &bg_color, &rect);

            GdkRGBA border_color = { 1.0f, 1.0f, 1.0f, 0.14f };
            float border_widths[4] = { 1.0f, 1.0f, 1.0f, 1.0f };
            GdkRGBA border_colors[4] = { border_color, border_color, border_color, border_color };
            gtk_snapshot_append_border(snapshot, &rounded, border_widths, border_colors);

            gtk_snapshot_pop(snapshot);
        }
    }

    if (orig_switcher_snapshot) {
        orig_switcher_snapshot(widget, snapshot);
    }
}

static void setup_mac_view_switcher(GtkWidget *vs) {
    if (!vs || !ADW_IS_VIEW_SWITCHER(vs)) return;
    if (g_object_get_data(G_OBJECT(vs), "mac-switcher-anim")) return;

    static gboolean hook_installed = FALSE;
    if (!hook_installed) {
        hook_installed = TRUE;
        GtkWidgetClass *wclass = GTK_WIDGET_CLASS(g_type_class_ref(ADW_TYPE_VIEW_SWITCHER));
        orig_switcher_snapshot = wclass->snapshot;
        wclass->snapshot = mac_view_switcher_snapshot;
    }

    MacSwitcherAnimData *data = g_new0(MacSwitcherAnimData, 1);
    data->switcher = vs;
    g_object_set_data_full(G_OBJECT(vs), "mac-switcher-anim", data, g_free);

    for (GtkWidget *c = gtk_widget_get_first_child(vs); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        if (GTK_IS_TOGGLE_BUTTON(c)) {
            g_object_set_data(G_OBJECT(c), "mac_btn_connected", GINT_TO_POINTER(1));
            g_signal_connect(c, "toggled", G_CALLBACK(on_switcher_btn_toggled), vs);
        }
    }

    AdwViewStack *stack = adw_view_switcher_get_stack(ADW_VIEW_SWITCHER(vs));
    if (stack) {
        g_signal_connect(stack, "notify::visible-child", G_CALLBACK(on_switcher_stack_child_notify), vs);
    }
}

static void configure_toolbar_views_recursive(GtkWidget *widget, gboolean is_sidebar)
{
    if (!widget) return;
    if (ADW_IS_TOOLBAR_VIEW(widget)) {
        AdwToolbarView *tv = ADW_TOOLBAR_VIEW(widget);
        adw_toolbar_view_set_extend_content_to_top_edge(tv, FALSE);
        adw_toolbar_view_set_extend_content_to_bottom_edge(tv, FALSE);
        adw_toolbar_view_set_top_bar_style(tv, ADW_TOOLBAR_FLAT);
        adw_toolbar_view_set_bottom_bar_style(tv, ADW_TOOLBAR_FLAT);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        configure_toolbar_views_recursive(child, is_sidebar);
    }
}

/* ========================================================================= */
/* Desktop Widgets Settings Callbacks                                       */
/* ========================================================================= */

#define DW_SCHEMA "org.gnome.shell.extensions.desktop-widgets-r3nhick"

static void ensure_dw_extension_enabled(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src || !g_settings_schema_source_lookup(src, "org.gnome.shell", TRUE)) return;
    GSettings *shell_settings = g_settings_new("org.gnome.shell");
    if (!shell_settings) return;
    char **enabled = g_settings_get_strv(shell_settings, "enabled-extensions");
    gboolean found = FALSE;
    if (enabled) {
        for (int i = 0; enabled[i] != NULL; i++) {
            if (g_strcmp0(enabled[i], "desktop-widgets@r3nhick") == 0) {
                found = TRUE;
                break;
            }
        }
    }
    if (!found) {
        int len = enabled ? g_strv_length(enabled) : 0;
        char **new_enabled = g_new0(char *, len + 2);
        for (int i = 0; i < len; i++) new_enabled[i] = g_strdup(enabled[i]);
        new_enabled[len] = g_strdup("desktop-widgets@r3nhick");
        new_enabled[len + 1] = NULL;
        g_settings_set_strv(shell_settings, "enabled-extensions", (const char * const *)new_enabled);
        g_strfreev(new_enabled);
    }
    if (enabled) g_strfreev(enabled);
    g_object_unref(shell_settings);
}

static GSettings *get_dw_settings(void) {
    ensure_dw_extension_enabled();
    static GSettings *dw_settings = NULL;
    if (!dw_settings) {
        GSettingsSchemaSource *src = g_settings_schema_source_get_default();
        if (src && g_settings_schema_source_lookup(src, DW_SCHEMA, TRUE)) {
            dw_settings = g_settings_new(DW_SCHEMA);
        }
    }
    return dw_settings;
}

void init_dw_edit_mode(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "edit-mode"));
    in_init = 0;
}

void on_dw_edit_mode_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "edit-mode", active);
}

void on_dw_add_widgets_clicked(void *button, gpointer data) {
    (void)button; (void)data;
    ensure_dw_extension_enabled();
    GSettings *s = get_dw_settings();
    if (s) {
        g_settings_set_boolean(s, "edit-mode", TRUE);
        g_settings_set_boolean(s, "open-widget-picker", TRUE);
    }
    g_spawn_command_line_async("sh -c 'pkill -f org.gnome.Shell.Extensions 2>/dev/null; sleep 0.1; gnome-extensions prefs desktop-widgets@r3nhick'", NULL);
}

void on_dw_arrange_clicked(void *button, gpointer data) {
    (void)button; (void)data;
    GSettings *s = get_dw_settings();
    if (s) {
        g_settings_set_boolean(s, "arrange-widgets", TRUE);
    }
}

void init_dw_gap(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    int gap = g_settings_get_int(s, "widget-gap");
    gtk_range_set_value(GTK_RANGE(widget), gap);
    in_init = 0;
}

void on_dw_gap_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    int gap = (int)round(gtk_range_get_value(GTK_RANGE(widget)));
    g_settings_set_int(s, "widget-gap", gap);
}

void init_dw_pause_fullscreen(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "pause-animations-fullscreen"));
    in_init = 0;
}

void on_dw_pause_fullscreen_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "pause-animations-fullscreen", active);
}

void init_dw_panel_icon(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "show-panel-icon"));
    in_init = 0;
}

void on_dw_panel_icon_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "show-panel-icon", active);
}

void init_dw_theme(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    char *theme = g_settings_get_string(s, "widget-theme-unified");
    guint idx = 0;
    if (theme && g_ascii_strcasecmp(theme, "light") == 0) {
        idx = 1;
    }
    g_free(theme);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), idx);
    in_init = 0;
}

void on_dw_theme_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    guint sel = adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    const char *theme = (sel == 1) ? "light" : "dark";
    g_settings_set_boolean(s, "use-custom-widget-theme", TRUE);
    g_settings_set_boolean(s, "use-same-theme-for-both", TRUE);
    g_settings_set_string(s, "widget-theme-unified", theme);
}

void init_dw_border_radius(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    int radius = g_settings_get_int(s, "style-border-radius");
    gtk_range_set_value(GTK_RANGE(widget), radius);
    in_init = 0;
}

void on_dw_border_radius_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    int radius = (int)round(gtk_range_get_value(GTK_RANGE(widget)));
    g_settings_set_int(s, "style-border-radius", radius);
}

void init_dw_opacity(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    double op = g_settings_get_double(s, "style-widget-opacity");
    gtk_range_set_value(GTK_RANGE(widget), round(op * 100.0));
    in_init = 0;
}

void on_dw_opacity_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    double val = gtk_range_get_value(GTK_RANGE(widget));
    g_settings_set_double(s, "style-widget-opacity", val / 100.0);
}

void init_dw_use_custom_accent(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "style-use-custom-accent"));
    in_init = 0;
}

void on_dw_use_custom_accent_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "style-use-custom-accent", active);
}

void init_dw_clock_seconds(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "digitalclock-show-seconds"));
    in_init = 0;
}

void on_dw_clock_seconds_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "digitalclock-show-seconds", active);
    g_settings_set_boolean(s, "clock-smooth-seconds", active);
}

void init_dw_battery_percent(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "battery-show-percent"));
    in_init = 0;
}

void on_dw_battery_percent_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "battery-show-percent", active);
}

void init_dw_music_browsers(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), g_settings_get_boolean(s, "music-ignore-browsers"));
    in_init = 0;
}

void on_dw_music_browsers_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    gboolean active = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    g_settings_set_boolean(s, "music-ignore-browsers", active);
}

void on_dw_advanced_clicked(void *button, gpointer data) {
    (void)button; (void)data;
    g_spawn_command_line_async("sh -c 'pkill -f org.gnome.Shell.Extensions 2>/dev/null; sleep 0.1; gnome-extensions prefs desktop-widgets@r3nhick'", NULL);
}

static void find_list_boxes_recursive(GtkWidget *widget, GList **list)
{
    if (!widget) return;
    if (GTK_IS_LIST_BOX(widget)) {
        *list = g_list_append(*list, widget);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_list_boxes_recursive(child, list);
    }
}

static GtkWidget *get_widgets_page(void)
{
    static GtkWidget *widgets_page = NULL;
    if (widgets_page) return widgets_page;

    GtkBuilder *builder = gtk_builder_new();
    const char *overlay_path = "/usr/share/mactheme/gnome-control-center-overlay/cc-widgets-panel.ui";
    char *user_path = NULL;
    const char *home = g_get_home_dir();
    if (home) {
        user_path = g_build_filename(home, ".local", "share", "gnome-control-center-overlay", "cc-widgets-panel.ui", NULL);
    }
    const char *local_path = "/home/vitaliy/MACTHEMEFILES/control-center/cc-widgets-panel.ui";

    const char *path_to_use = NULL;
    if (g_file_test(overlay_path, G_FILE_TEST_EXISTS)) {
        path_to_use = overlay_path;
    } else if (user_path && g_file_test(user_path, G_FILE_TEST_EXISTS)) {
        path_to_use = user_path;
    } else if (g_file_test(local_path, G_FILE_TEST_EXISTS)) {
        path_to_use = local_path;
    }

    GError *error = NULL;
    gboolean loaded = FALSE;
    if (path_to_use) {
        loaded = gtk_builder_add_from_file(builder, path_to_use, &error);
    }
    if (user_path) g_free(user_path);

    if (loaded) {
        widgets_page = GTK_WIDGET(gtk_builder_get_object(builder, "widgets_page"));
        if (widgets_page) {
            g_object_ref(widgets_page);
        }
    } else {
        if (error) {
            g_warning("macW1Y: Failed to load cc-widgets-panel.ui: %s", error->message);
            g_error_free(error);
        }
    }
    g_object_unref(builder);
    return widgets_page;
}

static void init_mac_settings_css(void) {
    static gboolean css_inited = FALSE;
    if (css_inited) return;
    css_inited = TRUE;

    GtkCssProvider *provider = gtk_css_provider_new();
    gtk_css_provider_load_from_string(provider,
        "window.mac-settings-window list.mac-settings-sidebar-list, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar { "
        "  background-color: transparent; "
        "  padding: 4px 0px; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row { "
        "  min-height: 32px; "
        "  padding: 3px 6px; "
        "  margin: 1.5px 18px 1.5px 8px; "
        "  border-radius: 8px; "
        "  font-size: 13px; "
        "  color: rgba(255, 255, 255, 0.90); "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:hover, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:hover { "
        "  border-radius: 8px; "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected { "
        "  border-radius: 8px; "
        "  background-color: #fa6e0a; "
        "  color: #ffffff; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row.mac-sidebar-group-start, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row.mac-sidebar-group-start { "
        "  margin-top: 14px; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list separator, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar separator, "
        "window.mac-settings-window list.mac-settings-sidebar-list > separator, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar > separator { "
        "  min-height: 0px; "
        "  min-width: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:not(.mac-settings-account-row) image, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:not(.mac-settings-account-row) image { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  -gtk-icon-size: 13px; "
        "  background-color: #1e1e20; "
        "  border: 1px solid rgba(255, 255, 255, 0.06); "
        "  border-radius: 5px; "
        "  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45); "
        "  margin-right: 0px; "
        "  margin-left: 0px; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected:not(.mac-settings-account-row) image, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected:not(.mac-settings-account-row) image { "
        "  color: #ffffff; "
        "  background-color: #1e1e20; "
        "  border: 1px solid rgba(255, 255, 255, 0.08); "
        "  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45); "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row label, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row label { "
        "  font-size: 13px; "
        "  margin-top: 1px; "
        "  margin-bottom: 0px; "
        "  margin-left: 0px; "
        "  padding-top: 0px; "
        "  padding-bottom: 0px; "
        "  padding-left: 0px; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected label, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected label { "
        "  color: #ffffff; "
        "  font-weight: 500; "
        "} "
        "window.mac-settings-window .mac-settings-account-row { "
        "  min-height: 48px; "
        "  padding: 6px 10px; "
        "  margin: 6px 18px 18px 8px; "
        "  border-radius: 8px; "
        "  background-color: transparent; "
        "  border-width: 0; "
        "  box-shadow: none; "
        "  outline-width: 0; "
        "} "
        "window.mac-settings-window .mac-settings-account-row:hover { "
        "  border-radius: 8px; "
        "  background-color: rgba(255, 255, 255, 0.05); "
        "} "
        "window.mac-settings-window .mac-settings-account-row:selected { "
        "  border-radius: 8px; "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "} "
        "window.mac-settings-window .mac-settings-account-row avatar { "
        "  border-radius: 9999px; "
        "  background-color: transparent; "
        "  border-width: 0; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window .mac-settings-account-row avatar image { "
        "  background-color: transparent; "
        "  border-width: 0; "
        "  box-shadow: none; "
        "  border-radius: 9999px; "
        "  min-width: 36px; "
        "  min-height: 36px; "
        "  margin: 0; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window .mac-settings-account-row .account-title { "
        "  font-weight: 600; "
        "  font-size: 13.5px; "
        "  color: #ffffff; "
        "} "
        "window.mac-settings-window .mac-settings-account-row .account-subtitle { "
        "  font-size: 11px; "
        "  color: rgba(255, 255, 255, 0.55); "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar { "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  padding: 4px 10px 4px 10px; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar > revealer > box { "
        "  background: transparent; "
        "  border: none; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar entry { "
        "  min-height: 28px; "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "  border: 1px solid rgba(255, 255, 255, 0.08); "
        "  color: #ffffff; "
        "  font-size: 13px; "
        "  padding: 2px 12px; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar entry:focus-within { "
        "  background-color: rgba(255, 255, 255, 0.12); "
        "  border-color: rgba(255, 255, 255, 0.20); "
        "} "
        ".mac-panel-header-banner, "
        ".mac-panel-header-badge, "
        ".mac-panel-header-title, "
        ".mac-panel-header-subtitle { "
        "  opacity: 0; "
        "  font-size: 0px; "
        "  min-height: 0px; "
        "  min-width: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window preferencespage, "
        "window.mac-settings-window .content-pane preferencespage { "
        "  padding-top: 0px; "
        "} "
        "window.mac-settings-window preferencespage > scrolledwindow > viewport, "
        "window.mac-settings-window preferencespage > scrolledwindow > viewport > clamp { "
        "  padding-top: 0px; "
        "  padding-bottom: 24px; "
        "} "
        "window.mac-settings-window preferencespage > scrolledwindow > viewport > clamp > box, "
        "window.mac-settings-window preferencespage clamp > box { "
        "  margin-top: 4px; "
        "  margin-bottom: 24px; "
        "} "
        "window.mac-settings-window preferencesgroup:first-child, "
        "window.mac-settings-window preferencespage preferencesgroup:first-child { "
        "  margin-top: 2px; "
        "} "
        "window.mac-settings-window infobar, "
        "window.mac-settings-window .permission-infobar, "
        "window.mac-settings-window banner, "
        "window.mac-settings-window adwbanner, "
        "window.mac-settings-window infobar > revealer, "
        "window.mac-settings-window .permission-infobar > revealer, "
        "window.mac-settings-window banner > revealer, "
        "window.mac-settings-window adwbanner > revealer { "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window banner > revealer > widget, "
        "window.mac-settings-window banner > revealer > box, "
        "window.mac-settings-window adwbanner > revealer > widget, "
        "window.mac-settings-window adwbanner > revealer > box, "
        "window.mac-settings-window infobar > revealer > widget, "
        "window.mac-settings-window infobar > revealer > box, "
        "window.mac-settings-window .permission-infobar > revealer > widget, "
        "window.mac-settings-window .permission-infobar banner > revealer > widget { "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.09); "
        "  border: 1px solid rgba(255, 255, 255, 0.10); "
        "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); "
        "  padding: 4px 16px; "
        "  margin: 4px 15px 8px 15px; "
        "} "
        "window.mac-settings-window banner button, "
        "window.mac-settings-window adwbanner button, "
        "window.mac-settings-window infobar button, "
        "window.mac-settings-window .permission-infobar button, "
        "window.mac-settings-window .mac-pill-btn { "
        "  border-radius: 9999px; "
        "  min-height: 24px; "
        "  padding: 2px 14px; "
        "} "
        "window.mac-settings-window banner button label, "
        "window.mac-settings-window adwbanner button label, "
        "window.mac-settings-window infobar button label, "
        "window.mac-settings-window .permission-infobar button label { "
        "  border-radius: 9999px; "
        "} "
        "window.mac-settings-window list.boxed-list, "
        "window.mac-settings-window preferencesgroup list, "
        "window.mac-settings-window preferencespage list.boxed-list, "
        "window.mac-settings-window .content-pane list.boxed-list, "
        "window.mac-settings-window .mac-settings-content list.boxed-list { "
        "  background-color: #1e1e1e; "
        "  border: 1px solid rgba(255, 255, 255, 0.07); "
        "  border-radius: 14px; "
        "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.20); "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "  margin-bottom: 12px; "
        "} "
        "window.mac-settings-window preferencespage list:not(.boxed-list), "
        "window.mac-settings-window preferencespage row.button, "
        "window.mac-settings-window #add_user_button_row, "
        "window.mac-settings-window #add_enterprise_user_button_row, "
        "window.mac-settings-window preferencesgroup.separate-rows list { "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "} "
        "window.mac-settings-window preferencespage preferencesgroup > box > box.header, "
        "window.mac-settings-window .content-pane preferencesgroup > box > box.header, "
        "window.mac-settings-window .mac-settings-content preferencesgroup > box > box.header, "
        "window.mac-settings-window preferencesgroup > box > box.header, "
        "window.mac-settings-window preferencesgroup box.header, "
        "window.mac-settings-window preferencesgroup > box > label.title, "
        "window.mac-settings-window preferencesgroup > label.title, "
        "window.mac-settings-window preferencespage .boxed-list-title, "
        "window.mac-settings-window preferencespage label.heading, "
        "window.mac-settings-window .mac-settings-content label.heading, "
        "window.mac-settings-window label.heading, "
        "window.mac-settings-window #list_label, "
        "window.mac-settings-window .mac-panel-section-title { "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "  margin-bottom: 4px; "
        "  padding-left: 0px; "
        "} "
        "window.mac-settings-window preferencespage list.boxed-list row.expander, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander, "
        "window.mac-settings-window list.boxed-list row.expander { "
        "  padding: 0; "
        "  margin: 0; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "} "
        "window.mac-settings-window preferencespage list.boxed-list row.expander:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander:hover, "
        "window.mac-settings-window list.boxed-list row.expander:hover { "
        "  background: transparent; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window list.boxed-list row, "
        "window.mac-settings-window list.boxed-list > row, "
        "window.mac-settings-window preferencesgroup list > row, "
        "window.mac-settings-window preferencespage list.boxed-list row, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row, "
        "window.mac-settings-window .content-pane list.boxed-list row, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row, "
        "window.mac-settings-window adwactionrow, "
        "window.mac-settings-window adwswitchrow, "
        "window.mac-settings-window adwcomborow, "
        "window.mac-settings-window adwentryrow, "
        "window.mac-settings-window adwexpanderrow, "
        "window.mac-settings-window adwspinrow, "
        "window.mac-settings-window cclistrow, "
        "window.mac-settings-window ccwificonnectionrow, "
        "window.mac-settings-window preferencespage row.button, "
        "window.mac-settings-window #add_user_button_row, "
        "window.mac-settings-window #add_enterprise_user_button_row, "
        "window.mac-settings-window list.boxed-list row.expander row.header { "
        "  min-height: 35px; "
        "  padding: 0px 14px; "
        "  margin: 0px; "
        "  border-bottom: none; "
        "} "
        "window.mac-settings-window list.boxed-list row > box.header, "
        "window.mac-settings-window list.boxed-list row box.header, "
        "window.mac-settings-window adwactionrow > box.header, "
        "window.mac-settings-window adwswitchrow > box.header, "
        "window.mac-settings-window adwcomborow > box.header, "
        "window.mac-settings-window adwentryrow > box.header, "
        "window.mac-settings-window cclistrow > box.header, "
        "window.mac-settings-window ccwificonnectionrow > box.header { "
        "  min-height: 35px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "  border-spacing: 10px; "
        "} "
        "window.mac-settings-window list.boxed-list row > box.header > box.title, "
        "window.mac-settings-window adwactionrow > box.header > box.title, "
        "window.mac-settings-window cclistrow > box.header > box.title, "
        "window.mac-settings-window ccwificonnectionrow > box.header > box.title { "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list row checkbutton, "
        "window.mac-settings-window adwactionrow checkbutton { "
        "  min-height: 20px; "
        "  min-width: 20px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list row label.title, "
        "window.mac-settings-window list.boxed-list > row label.title, "
        "window.mac-settings-window adwactionrow label.title, "
        "window.mac-settings-window adwswitchrow label.title, "
        "window.mac-settings-window adwcomborow label.title, "
        "window.mac-settings-window adwentryrow label.title, "
        "window.mac-settings-window adwexpanderrow label.title, "
        "window.mac-settings-window cclistrow label.title, "
        "window.mac-settings-window preferencesgroup label.title, "
        "window.mac-settings-window .content-pane label.title { "
        "  font-size: 13.5px; "
        "  font-weight: 500; "
        "  line-height: 1.2; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window preferencesgroup label.subtitle, "
        "window.mac-settings-window preferencesgroup .subtitle, "
        "window.mac-settings-window list.boxed-list row label.subtitle, "
        "window.mac-settings-window list.boxed-list row .subtitle, "
        "window.mac-settings-window adwactionrow label.subtitle, "
        "window.mac-settings-window adwactionrow .subtitle, "
        "window.mac-settings-window adwswitchrow label.subtitle, "
        "window.mac-settings-window adwswitchrow .subtitle, "
        "window.mac-settings-window adwcomborow label.subtitle, "
        "window.mac-settings-window adwcomborow .subtitle, "
        "window.mac-settings-window adwentryrow label.subtitle, "
        "window.mac-settings-window adwentryrow .subtitle, "
        "window.mac-settings-window cclistrow label.subtitle, "
        "window.mac-settings-window cclistrow .subtitle, "
        "window.mac-settings-window preferencespage label.subtitle, "
        "window.mac-settings-window preferencespage .subtitle, "
        "window.mac-settings-window .content-pane label.subtitle, "
        "window.mac-settings-window .content-pane .subtitle, "
        "window.mac-settings-window .mac-settings-content label.subtitle, "
        "window.mac-settings-window .mac-settings-content .subtitle { "
        "  font-size: 0px; "
        "  min-height: 0px; "
        "  min-width: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "  line-height: 0; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window list.boxed-list row image.expander, "
        "window.mac-settings-window list.boxed-list row image:dir(ltr):last-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row image:dir(ltr):last-child, "
        "window.mac-settings-window cclistrow image:dir(ltr):last-child { "
        "  color: rgba(255, 255, 255, 0.30); "
        "  -gtk-icon-size: 11px; "
        "  min-height: 11px; "
        "  min-width: 11px; "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list row > box.header > box.suffixes, "
        "window.mac-settings-window list.boxed-list row > box.header > button:last-child, "
        "window.mac-settings-window list.boxed-list row > box.header > switch:last-child, "
        "window.mac-settings-window list.boxed-list row > box.header > image:last-child { "
        "  margin-right: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list row button:not(.accent-button), "
        "window.mac-settings-window adwactionrow button:not(.accent-button) { "
        "  min-height: 22px; "
        "  padding: 2px 8px; "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window #accent_box, "
        "#accent_box { "
        "  margin-top: 10px; "
        "  margin-bottom: 10px; "
        "} "
        "window.mac-settings-window #accent_box button, "
        "window.mac-settings-window #accent_box button.accent-button, "
        "window.mac-settings-window button.accent-button, "
        "preferencesgroup button.accent, "
        "preferencesgroup button.accent-button, "
        "#accent_box button, "
        "#accent_box button.accent-button, "
        "button.accent-button { "
        "  min-width: 24px; "
        "  min-height: 24px; "
        "  padding: 0px; "
        "  margin: 0px 4px; "
        "  border-radius: 9999px; "
        "  border: none; "
        "  outline: none; "
        "  -gtk-icon-source: none; "
        "  background-clip: border-box; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window #accent_box button:hover, "
        "#accent_box button:hover, "
        "button.accent-button:hover, "
        "preferencesgroup button.accent:hover, "
        "preferencesgroup button.accent-button:hover { "
        "  min-width: 24px; "
        "  min-height: 24px; "
        "  padding: 0px; "
        "  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25); "
        "} "
        "window.mac-settings-window #accent_box button:checked, "
        "#accent_box button:checked, "
        "button.accent-button:checked, "
        "preferencesgroup button.accent:checked, "
        "preferencesgroup button.accent-button:checked { "
        "  min-width: 24px; "
        "  min-height: 24px; "
        "  padding: 0px; "
        "  -gtk-icon-source: none; "
        "  color: transparent; "
        "  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-bg-color) 60%, transparent); "
        "} "
        "window.mac-settings-window #accent_box button:checked:hover, "
        "#accent_box button:checked:hover, "
        "button.accent-button:checked:hover, "
        "preferencesgroup button.accent:checked:hover, "
        "preferencesgroup button.accent-button:checked:hover { "
        "  min-width: 24px; "
        "  min-height: 24px; "
        "  padding: 0px; "
        "  -gtk-icon-source: none; "
        "  color: transparent; "
        "  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-bg-color) 75%, transparent); "
        "} "
        "window.mac-settings-window list.boxed-list row combobox, "
        "window.mac-settings-window list.boxed-list row dropdown, "
        "window.mac-settings-window adwcomborow dropdown { "
        "  min-height: 22px; "
        "  padding: 1px 6px; "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list row entry, "
        "window.mac-settings-window adwentryrow entry { "
        "  min-height: 24px; "
        "  padding: 2px 8px; "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:hover, "
        "window.mac-settings-window list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window preferencespage list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander row.header:hover { "
        "  background-color: rgba(255, 255, 255, 0.04); "
        "} "
        "window.mac-settings-window list.boxed-list > row + row, "
        "window.mac-settings-window preferencespage list.boxed-list > row + row, "
        "window.mac-settings-window .content-pane list.boxed-list > row + row, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row + row { "
        "  border-top: 1px solid transparent; "
        "  border-image: linear-gradient(to right, transparent 0%, transparent 2%, rgba(255, 255, 255, 0.07) 2%, rgba(255, 255, 255, 0.07) 98%, transparent 98%, transparent 100%) 1 0 0 0/1px 0 0 0 stretch; "
        "} "
        "window.mac-settings-window list.boxed-list > row:hover + row, "
        "window.mac-settings-window preferencespage list.boxed-list > row:hover + row, "
        "window.mac-settings-window .content-pane list.boxed-list > row:hover + row, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:hover + row { "
        "  border-top: 1px solid transparent; "
        "  border-image: linear-gradient(to right, transparent 0%, transparent 2%, rgba(255, 255, 255, 0.07) 2%, rgba(255, 255, 255, 0.07) 98%, transparent 98%, transparent 100%) 1 0 0 0/1px 0 0 0 stretch; "
        "} "
        "window.mac-settings-window list.boxed-list row > box.header > image:first-child, "
        "window.mac-settings-window list.boxed-list row > box > image:first-child, "
        "window.mac-settings-window list.boxed-list row image.icon, "
        "window.mac-settings-window list.boxed-list row > image:first-child, "
        "window.mac-settings-window preferencespage list.boxed-list row > box.header > image:first-child, "
        "window.mac-settings-window preferencespage list.boxed-list row > box > image:first-child, "
        "window.mac-settings-window preferencespage list.boxed-list row image.icon, "
        "window.mac-settings-window preferencespage list.boxed-list row > image:first-child { "
        "  min-width: 18px; "
        "  min-height: 18px; "
        "  -gtk-icon-size: 18px; "
        "  margin-right: 10px; "
        "  margin-left: 0px; "
        "} "
        "window.mac-settings-window #app_listbox row image { "
        "  min-width: 24px; "
        "  min-height: 24px; "
        "  -gtk-icon-size: 24px; "
        "  margin-right: 12px; "
        "  margin-left: 0px; "
        "} "
        "window.mac-settings-window .content-pane searchbar, "
        "window.mac-settings-window .mac-settings-content searchbar { "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  padding: 4px 0px; "
        "} "
        "window.mac-settings-window .content-pane searchbar > revealer > box, "
        "window.mac-settings-window .content-pane searchbar clamp, "
        "window.mac-settings-window .mac-settings-content searchbar > revealer > box, "
        "window.mac-settings-window .mac-settings-content searchbar clamp { "
        "  padding-left: 0px; "
        "  padding-right: 0px; "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "} "
        "window.mac-settings-window .content-pane searchbar entry, "
        "window.mac-settings-window .mac-settings-content searchbar entry, "
        "window.mac-settings-window #app_search_entry { "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "  min-height: 32px; "
        "  border-radius: 8px; "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "  border: 1px solid rgba(255, 255, 255, 0.08); "
        "} "
        "window.mac-settings-window .mac-settings-content-headerbar.has-view-switcher, "
        "window.mac-settings-window .mac-settings-switcher-headerbar, "
        "window.mac-settings-window .panel-has-switcher .mac-settings-content-headerbar { "
        "  min-height: 48px; "
        "  background: linear-gradient(to bottom, "
        "    #1e1e1e 0%, "
        "    rgba(30, 30, 32, 0.96) 50%, "
        "    rgba(30, 30, 32, 0.85) 75%, "
        "    rgba(30, 30, 32, 0.35) 90%, "
        "    transparent 100%); "
        "  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); "
        "} "
        "window.mac-settings-window viewswitcher, "
        "window.mac-settings-window .mac-view-switcher, "
        "window.mac-settings-window headerbar viewswitcher { "
        "  min-height: 28px; "
        "  border-radius: 9999px; "
        "  padding: 3px; "
        "  background-color: rgba(20, 20, 22, 0.75); "
        "  background-image: none; "
        "  border: 1px solid rgba(255, 255, 255, 0.08); "
        "  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.40); "
        "} "
        "window.mac-settings-window viewswitcher button.toggle, "
        "window.mac-settings-window .mac-view-switcher button.toggle, "
        "window.mac-settings-window headerbar viewswitcher button.toggle { "
        "  min-height: 24px; "
        "  padding: 3px 14px; "
        "  margin: 0 1px; "
        "  border-radius: 9999px; "
        "  font-size: 13px; "
        "  color: rgba(255, 255, 255, 0.75); "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  transition: color 150ms ease-out; "
        "} "
        "window.mac-settings-window viewswitcher button.toggle:hover, "
        "window.mac-settings-window .mac-view-switcher button.toggle:hover, "
        "window.mac-settings-window headerbar viewswitcher button.toggle:hover { "
        "  color: #ffffff; "
        "  background-color: rgba(255, 255, 255, 0.06); "
        "} "
        "window.mac-settings-window viewswitcher button.toggle:checked, "
        "window.mac-settings-window .mac-view-switcher button.toggle:checked, "
        "window.mac-settings-window headerbar viewswitcher button.toggle:checked { "
        "  color: #ffffff; "
        "  font-weight: 600; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window .panel-has-switcher preferencespage > scrolledwindow > viewport, "
        "window.mac-settings-window .panel-has-switcher preferencespage > scrolledwindow > viewport > clamp { "
        "  padding-top: 0px; "
        "  padding-bottom: 24px; "
        "} "
        "window.mac-settings-window .panel-has-switcher preferencespage > scrolledwindow > undershoot.top, "
        "window.mac-settings-window .panel-has-switcher scrolledwindow > undershoot.top { "
        "  min-height: 96px; "
        "  background: linear-gradient(to bottom, "
        "    #1e1e1e 0%, "
        "    rgba(30, 30, 30, 0.98) 35%, "
        "    rgba(30, 30, 30, 0.88) 60%, "
        "    rgba(30, 30, 30, 0.45) 80%, "
        "    transparent 100%); "
        "} "
        "window.mac-settings-window .mac-nav-header-box { "
        "  margin-left: 6px; "
        "  border-spacing: 12px; "
        "} "
        "window.mac-settings-window .mac-nav-pill, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill { "
        "  padding: 2px 2px; "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "  border: 1px solid rgba(255, 255, 255, 0.08); "
        "} "
        "window.mac-settings-window .mac-nav-pill > button, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button { "
        "  min-height: 29px; "
        "  min-width: 29px; "
        "  padding: 0; "
        "  margin: 0; "
        "  border-radius: 9999px; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  color: rgba(255, 255, 255, 0.85); "
        "} "
        "window.mac-settings-window .mac-nav-pill > button image, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button image { "
        "  -gtk-icon-size: 14px; "
        "  margin: 0; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:first-child, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:first-child { "
        "  border-top-left-radius: 9999px; "
        "  border-bottom-left-radius: 9999px; "
        "  border-top-right-radius: 0; "
        "  border-bottom-right-radius: 0; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:last-child, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:last-child { "
        "  border-top-left-radius: 0; "
        "  border-bottom-left-radius: 0; "
        "  border-top-right-radius: 9999px; "
        "  border-bottom-right-radius: 9999px; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:hover, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:hover { "
        "  background-color: rgba(255, 255, 255, 0.12); "
        "  color: #ffffff; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:active, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:active { "
        "  background-color: rgba(255, 255, 255, 0.20); "
        "  color: #ffffff; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:disabled, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:disabled { "
        "  color: rgba(255, 255, 255, 0.25); "
        "  background: transparent; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window .mac-nav-pill separator, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill separator { "
        "  min-width: 1px; "
        "  background-color: rgba(255, 255, 255, 0.12); "
        "  margin: 4px 0px; "
        "} "
        "window.mac-settings-window .mac-panel-title-label { "
        "  font-size: 14px; "
        "  font-weight: 700; "
        "  color: #ffffff; "
        "  margin-left: 4px; "
        "} "
        "window.mac-settings-window switch { "
        "  min-width: 42px; "
        "  min-height: 24px; "
        "  padding: 0; "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.16); "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  outline: none; "
        "  transition: background-color 200ms ease-out, opacity 200ms ease-out; "
        "} "
        "window.mac-settings-window switch:hover { "
        "  background-color: rgba(255, 255, 255, 0.22); "
        "} "
        "window.mac-settings-window switch:checked { "
        "  background-color: #007aff; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window switch:checked:hover { "
        "  background-color: #1a88ff; "
        "} "
        "window.mac-settings-window :disabled { "
        "  filter: none; "
        "} "
        "window.mac-settings-window label:disabled, "
        "window.mac-settings-window .title:disabled, "
        "window.mac-settings-window .subtitle:disabled, "
        "window.mac-settings-window list.boxed-list row:disabled label.title, "
        "window.mac-settings-window list.boxed-list row:disabled .title { "
        "  opacity: 0.50; "
        "} "
        "window.mac-settings-window image:disabled { "
        "  opacity: 0.50; "
        "} "
        "window.mac-settings-window switch:disabled { "
        "  filter: none; "
        "  opacity: 1.0; "
        "  background-color: rgba(255, 255, 255, 0.12); "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window switch:checked:disabled { "
        "  opacity: 1.0; "
        "  background-color: #007aff; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window switch > slider { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: 2px; "
        "  padding: 0; "
        "  border-radius: 9999px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), 0 2px 5px rgba(0, 0, 0, 0.14); "
        "  transition: margin 300ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              min-width 300ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              min-height 300ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              background-color 300ms ease, "
        "              background-image 300ms ease, "
        "              box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1); "
        "} "
        "window.mac-settings-window switch:checked > slider { "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "} "
        "window.mac-settings-window switch:disabled > slider, "
        "window.mac-settings-window switch:checked:disabled > slider { "
        "  filter: none; "
        "  opacity: 1.0; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); "
        "} "
        "window.mac-settings-window switch:active > slider, "
        "window.mac-settings-window switch > slider:active, "
        "window.mac-settings-window switch:checked:active > slider, "
        "window.mac-settings-window switch:checked > slider:active { "
        "  min-width: 32px; "
        "  min-height: 22px; "
        "  margin: 1px; "
        "  background-color: transparent; "
        "  background-image: url('file:///home/vitaliy/.config/gtk-4.0/assets/scalable/slider-glass.svg'); "
        "  background-repeat: no-repeat; "
        "  background-size: 100% 100%; "
        "  border: none; "
        "  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.20); "
        "  transition: min-width 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              min-height 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              margin 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              background-image 100ms ease-in, "
        "              box-shadow 100ms cubic-bezier(0, 0, 0.2, 1); "
        "} "
        "window.mac-settings-window scale { "
        "  min-height: 24px; "
        "  min-width: 24px; "
        "  padding: 4px; "
        "} "
        "window.mac-settings-window scale > trough { "
        "  min-height: 4px; "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.16); "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window scale > trough > highlight { "
        "  min-height: 4px; "
        "  border-radius: 9999px; "
        "  background-color: #007aff; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider, "
        "window.mac-settings-window scale > trough > slider { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: -8px -10px; "
        "  border-radius: 9999px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.10); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.12); "
        "  transition: min-width 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              min-height 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              margin 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              background-color 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              background-image 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              border 220ms cubic-bezier(0.16, 1, 0.3, 1); "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider:hover, "
        "window.mac-settings-window scale > trough > slider:hover { "
        "  background-color: #ffffff; "
        "  border-color: rgba(0, 0, 0, 0.12); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), 0 3px 10px rgba(0, 0, 0, 0.15); "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider:active, "
        "window.mac-settings-window scale > trough > slider:active { "
        "  min-width: 42px; "
        "  min-height: 28px; "
        "  margin: -12px -15px; "
        "  background-color: transparent; "
        "  background-image: url('file:///home/vitaliy/.config/gtk-4.0/assets/scalable/slider-glass.svg'); "
        "  background-repeat: no-repeat; "
        "  background-size: 100% 100%; "
        "  border: none; "
        "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.40), 0 1px 3px rgba(0, 0, 0, 0.20); "
        "} "
        "window.mac-settings-window scale.vertical > trough > slider:active { "
        "  min-width: 28px; "
        "  min-height: 42px; "
        "  margin: -15px -12px; "
        "  background-color: transparent; "
        "  background-image: url('file:///home/vitaliy/.config/gtk-4.0/assets/scalable/slider-glass-vertical.svg'); "
        "  background-repeat: no-repeat; "
        "  background-size: 100% 100%; "
        "  border: none; "
        "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.40), 0 1px 3px rgba(0, 0, 0, 0.20); "
        "} "
        "window.mac-settings-window scale:disabled { "
        "  filter: none; "
        "  opacity: 1.0; "
        "} "
        "window.mac-settings-window scale:disabled > trough { "
        "  background-color: rgba(255, 255, 255, 0.10); "
        "} "
        "window.mac-settings-window scale:disabled > trough > highlight { "
        "  background-color: rgba(0, 122, 255, 0.50); "
        "} "
        "window.mac-settings-window scale:disabled > trough > slider, "
        "window.mac-settings-window scale > trough > slider:disabled { "
        "  filter: none; "
        "  opacity: 1.0; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.10); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22); "
        "}"
    );
    gtk_style_context_add_provider_for_display(
        gdk_display_get_default(),
        GTK_STYLE_PROVIDER(provider),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION + 200
    );
    g_object_unref(provider);
}

static GtkListBoxRow *create_account_row(AdwNavigationSplitView *split_view) {
    (void)split_view;
    GtkListBoxRow *row = GTK_LIST_BOX_ROW(gtk_list_box_row_new());
    gtk_widget_add_css_class(GTK_WIDGET(row), "mac-settings-account-row");
    gtk_widget_set_margin_bottom(GTK_WIDGET(row), 18);
    g_object_set_data(G_OBJECT(row), "is_account_row", GINT_TO_POINTER(1));

    MacPanelRowData *row_data = g_new0(MacPanelRowData, 1);
    row_data->row = row;
    row_data->id = g_strdup("account");
    g_object_set_data_full(G_OBJECT(row), "data", row_data, (GDestroyNotify)g_free);

    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    gtk_widget_set_margin_start(box, 4);
    gtk_widget_set_margin_end(box, 4);
    gtk_widget_set_margin_top(box, 4);
    gtk_widget_set_margin_bottom(box, 4);

    const char *real_name = g_get_real_name();
    const char *user_name = g_get_user_name();
    const char *disp_name = (real_name && real_name[0] && g_strcmp0(real_name, "Unknown") != 0) ? real_name : (user_name ? user_name : "User");

    GtkWidget *avatar = adw_avatar_new(36, disp_name, TRUE);
    adw_avatar_set_show_initials(ADW_AVATAR(avatar), TRUE);

    GdkTexture *tex = NULL;
    char *acc_icon = g_strdup_printf("/var/lib/AccountsService/icons/%s", user_name ? user_name : "vitaliy");
    char *face_path = g_build_filename(g_get_home_dir(), ".face", NULL);
    char *face_icon_path = g_build_filename(g_get_home_dir(), ".face.icon", NULL);

    if (g_file_test(acc_icon, G_FILE_TEST_EXISTS)) {
        tex = gdk_texture_new_from_filename(acc_icon, NULL);
    }
    if (!tex && g_file_test(face_path, G_FILE_TEST_EXISTS)) {
        tex = gdk_texture_new_from_filename(face_path, NULL);
    }
    if (!tex && g_file_test(face_icon_path, G_FILE_TEST_EXISTS)) {
        tex = gdk_texture_new_from_filename(face_icon_path, NULL);
    }

    if (tex) {
        adw_avatar_set_custom_image(ADW_AVATAR(avatar), GDK_PAINTABLE(tex));
        adw_avatar_set_show_initials(ADW_AVATAR(avatar), FALSE);
        g_object_unref(tex);
    }

    g_free(acc_icon);
    g_free(face_path);
    g_free(face_icon_path);

    gtk_box_append(GTK_BOX(box), avatar);

    GtkWidget *tbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    gtk_widget_set_valign(tbox, GTK_ALIGN_CENTER);
    gtk_widget_set_hexpand(tbox, TRUE);

    GtkWidget *name_lbl = gtk_label_new(disp_name);
    gtk_label_set_xalign(GTK_LABEL(name_lbl), 0.0);
    gtk_widget_add_css_class(name_lbl, "account-title");
    gtk_box_append(GTK_BOX(tbox), name_lbl);

    GtkWidget *sub_lbl = gtk_label_new(mac_tr("apple_account", "Обліковий запис Apple"));
    gtk_label_set_xalign(GTK_LABEL(sub_lbl), 0.0);
    gtk_widget_add_css_class(sub_lbl, "account-subtitle");
    gtk_box_append(GTK_BOX(tbox), sub_lbl);

    gtk_box_append(GTK_BOX(box), tbox);

    /* Arrow removed per user request: only account */

    gtk_list_box_row_set_child(row, box);
    return row;
}

static GtkListBoxRow *create_alert_row(const char *icon_name, const char *text, int count, const char *data_key) {
    GtkListBoxRow *row = GTK_LIST_BOX_ROW(gtk_list_box_row_new());
    gtk_widget_add_css_class(GTK_WIDGET(row), "mac-settings-alert-row");
    g_object_set_data(G_OBJECT(row), data_key, GINT_TO_POINTER(1));

    MacPanelRowData *row_data = g_new0(MacPanelRowData, 1);
    row_data->row = row;
    row_data->id = g_strdup(data_key);
    g_object_set_data_full(G_OBJECT(row), "data", row_data, (GDestroyNotify)g_free);

    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_widget_set_margin_start(box, 4);
    gtk_widget_set_margin_end(box, 4);
    gtk_widget_set_margin_top(box, 2);
    gtk_widget_set_margin_bottom(box, 2);

    GtkWidget *icon = gtk_image_new_from_icon_name(icon_name);
    gtk_image_set_pixel_size(GTK_IMAGE(icon), 15);
    gtk_box_append(GTK_BOX(box), icon);

    GtkWidget *lbl = gtk_label_new(text);
    gtk_label_set_xalign(GTK_LABEL(lbl), 0.0);
    gtk_widget_set_hexpand(lbl, TRUE);
    gtk_box_append(GTK_BOX(box), lbl);

    char count_str[16];
    snprintf(count_str, sizeof(count_str), "%d", count);
    GtkWidget *badge = gtk_label_new(count_str);
    gtk_widget_add_css_class(badge, "mac-alert-badge");
    gtk_widget_set_valign(badge, GTK_ALIGN_CENTER);
    gtk_box_append(GTK_BOX(box), badge);

    gtk_list_box_row_set_child(row, box);
    return row;
}

static void activate_system_row_by_id(GtkWidget *root, const char *row_id) {
    if (!root) return;
    const char *bid = GTK_IS_BUILDABLE(root) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(root)) : NULL;
    if (g_strcmp0(bid, row_id) == 0) {
        gtk_widget_activate(root);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(root); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        activate_system_row_by_id(child, row_id);
    }
}

static void open_system_subpage(AdwNavigationSplitView *split_view, GtkListBox *box, const char *row_id) {
    if (!split_view || !box) return;

    g_object_set_data(G_OBJECT(split_view), "mac_target_subpage_row", (gpointer)row_id);

    for (GtkWidget *child = gtk_widget_get_first_child(GTK_WIDGET(box)); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        if (GTK_IS_LIST_BOX_ROW(child)) {
            MacPanelRowData *d = g_object_get_data(G_OBJECT(child), "data");
            if (d && g_strcmp0(d->id, "system") == 0) {
                gtk_list_box_select_row(box, GTK_LIST_BOX_ROW(child));
                g_signal_emit_by_name(box, "row-activated", child);
                break;
            }
        }
    }

    AdwNavigationPage *content_p = adw_navigation_split_view_get_content(split_view);
    if (content_p) {
        activate_system_row_by_id(GTK_WIDGET(content_p), row_id);
    }
}

static void find_clamp_boxes_recursive(GtkWidget *widget, GList **list) {
    if (!widget) return;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(widget), "AdwClamp") == 0) {
        GtkWidget *c = gtk_widget_get_first_child(widget);
        if (c && GTK_IS_BOX(c)) {
            *list = g_list_append(*list, c);
            return;
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_clamp_boxes_recursive(child, list);
    }
}

static const char *get_panel_icon_name(const char *id) {
    if (!id) return "emblem-system-symbolic";
    if (g_strcmp0(id, "system") == 0) return "emblem-system-symbolic";
    if (g_strcmp0(id, "wifi") == 0) return "network-wireless-symbolic";
    if (g_strcmp0(id, "bluetooth") == 0) return "bluetooth-active-symbolic";
    if (g_strcmp0(id, "network") == 0) return "network-wired-symbolic";
    if (g_strcmp0(id, "display") == 0) return "video-display-symbolic";
    if (g_strcmp0(id, "sound") == 0) return "audio-volume-high-symbolic";
    if (g_strcmp0(id, "power") == 0) return "battery-level-100-charged-symbolic";
    if (g_strcmp0(id, "background") == 0) return "preferences-desktop-wallpaper-symbolic";
    if (g_strcmp0(id, "ubuntu") == 0) return "preferences-desktop-theme-symbolic";
    if (g_strcmp0(id, "widgets") == 0) return "view-grid-symbolic";
    if (g_strcmp0(id, "multitasking") == 0) return "preferences-system-windows-symbolic";
    if (g_strcmp0(id, "notifications") == 0) return "preferences-system-notifications-symbolic";
    if (g_strcmp0(id, "search") == 0) return "preferences-system-search-symbolic";
    if (g_strcmp0(id, "mouse") == 0) return "input-mouse-symbolic";
    if (g_strcmp0(id, "keyboard") == 0) return "input-keyboard-symbolic";
    if (g_strcmp0(id, "printers") == 0) return "printer-symbolic";
    if (g_strcmp0(id, "privacy") == 0) return "preferences-system-privacy-symbolic";
    if (g_strcmp0(id, "universal-access") == 0) return "preferences-desktop-accessibility-symbolic";
    if (g_strcmp0(id, "color") == 0) return "preferences-color-symbolic";
    if (g_strcmp0(id, "online-accounts") == 0) return "goa-panel-symbolic";
    if (g_strcmp0(id, "sharing") == 0) return "preferences-system-sharing-symbolic";
    if (g_strcmp0(id, "applications") == 0) return "preferences-desktop-apps-symbolic";
    return "emblem-system-symbolic";
}

static const char *get_panel_title_fallback(const char *id) {
    if (!id) return "Основні";
    if (g_strcmp0(id, "system") == 0) return "Основні";
    if (g_strcmp0(id, "wifi") == 0) return "Wi-Fi";
    if (g_strcmp0(id, "bluetooth") == 0) return "Bluetooth";
    if (g_strcmp0(id, "network") == 0) return "Мережа";
    if (g_strcmp0(id, "display") == 0) return "Дисплеї";
    if (g_strcmp0(id, "sound") == 0) return "Звук";
    if (g_strcmp0(id, "power") == 0) return "Живлення";
    if (g_strcmp0(id, "background") == 0) return "Шпалери";
    if (g_strcmp0(id, "ubuntu") == 0) return "Вигляд";
    if (g_strcmp0(id, "widgets") == 0) return "Віджети";
    if (g_strcmp0(id, "multitasking") == 0) return "Багатозадачність";
    if (g_strcmp0(id, "notifications") == 0) return "Сповіщення";
    if (g_strcmp0(id, "search") == 0) return "Пошук";
    if (g_strcmp0(id, "mouse") == 0) return "Миша";
    if (g_strcmp0(id, "keyboard") == 0) return "Клавіатура";
    if (g_strcmp0(id, "printers") == 0) return "Принтери";
    if (g_strcmp0(id, "privacy") == 0) return "Конфіденційність";
    if (g_strcmp0(id, "universal-access") == 0) return "Універсальний доступ";
    if (g_strcmp0(id, "color") == 0) return "Колір";
    if (g_strcmp0(id, "online-accounts") == 0) return "Облікові записи";
    if (g_strcmp0(id, "sharing") == 0) return "Спільний доступ";
    if (g_strcmp0(id, "applications") == 0) return "Програми";
    return "Параметри";
}

static const char *get_panel_description(const char *id) {
    if (!id) return "Налаштуйте основні параметри Mac, такі як оновлення ПЗ, мова пристрою та AirDrop.";
    if (g_strcmp0(id, "system") == 0) return "Налаштуйте основні параметри Mac, такі як оновлення ПЗ, мова пристрою та AirDrop.";
    if (g_strcmp0(id, "wifi") == 0) return "Підключення до бездротових мереж, налаштування відомих точок доступу та безпеки.";
    if (g_strcmp0(id, "bluetooth") == 0) return "Підключення бездротових аксесуарів, мишей, клавіатур та навушників.";
    if (g_strcmp0(id, "network") == 0) return "Налаштування дротових мережевих адаптерів, проксі-серверів та VPN.";
    if (g_strcmp0(id, "display") == 0) return "Роздільна здатність, масштабування екрана, частота оновлення та колірні профілі.";
    if (g_strcmp0(id, "sound") == 0) return "Гучність системи, вибір вихідних динаміків, мікрофонів та звукових ефектів.";
    if (g_strcmp0(id, "power") == 0) return "Режими енергоспоживання, криві вентиляторів та стан акумулятора.";
    if (g_strcmp0(id, "background") == 0) return "Вибір зображення робочого столу, динамічні шпалери та кольори.";
    if (g_strcmp0(id, "ubuntu") == 0) return "Світле та темне оформлення, акцентні кольори, розмір значків та стиль інтерфейсу.";
    if (g_strcmp0(id, "widgets") == 0) return "Налаштування розміщення, стилю та параметрів віджетів робочого столу.";
    if (g_strcmp0(id, "multitasking") == 0) return "Гарячі кути, поведінка вікон, робочі простори та багатозадачність.";
    if (g_strcmp0(id, "notifications") == 0) return "Керування сповіщеннями від програм, банерами та режимом не турбувати.";
    if (g_strcmp0(id, "search") == 0) return "Джерела пошуку Spotlight, індексація файлів та швидкі команди.";
    if (g_strcmp0(id, "mouse") == 0) return "Швидкість курсора, природне прокручування, жести трекпада та дотик.";
    if (g_strcmp0(id, "keyboard") == 0) return "Джерела введення, комбінації клавіш, швидкість повторення та розкладки.";
    if (g_strcmp0(id, "printers") == 0) return "Підключення принтерів, черги друку та сканери.";
    if (g_strcmp0(id, "privacy") == 0) return "Дозволи для програм, доступ до камери, мікрофона, геопозиції та захист даних.";
    if (g_strcmp0(id, "universal-access") == 0) return "Спеціальні можливості: збільшення, контрастність, екранний диктор і слух.";
    if (g_strcmp0(id, "color") == 0) return "Колірні профілі монітора та калібрування дисплея.";
    if (g_strcmp0(id, "online-accounts") == 0) return "Підключення хмарних сервісів, пошти, контактів та календарів.";
    if (g_strcmp0(id, "sharing") == 0) return "Спільний доступ до файлів, віддалене керування та медіасервер.";
    if (g_strcmp0(id, "applications") == 0) return "Типові програми, дозволи та керування встановленими додатками.";
    return "Керування системними параметрами та персоналізацією пристрою.";
}

static const char *get_panel_id_from_widget(GtkWidget *widget) {
    if (!widget) return NULL;
    const char *type_name = G_OBJECT_TYPE_NAME(widget);
    if (!type_name) return NULL;

    if (g_str_has_prefix(type_name, "CcWifiPanel")) return "wifi";
    if (g_str_has_prefix(type_name, "CcBluetoothPanel")) return "bluetooth";
    if (g_str_has_prefix(type_name, "CcNetworkPanel")) return "network";
    if (g_str_has_prefix(type_name, "CcWwanPanel")) return "wwan";
    if (g_str_has_prefix(type_name, "CcPowerPanel")) return "power";
    if (g_str_has_prefix(type_name, "CcSystemPanel")) return "system";
    if (g_str_has_prefix(type_name, "CcDisplayPanel")) return "display";
    if (g_str_has_prefix(type_name, "CcSoundPanel")) return "sound";
    if (g_str_has_prefix(type_name, "CcBackgroundPanel")) return "background";
    if (g_str_has_prefix(type_name, "CcUbuntuPanel")) return "ubuntu";
    if (g_str_has_prefix(type_name, "CcMultitaskingPanel")) return "multitasking";
    if (g_str_has_prefix(type_name, "CcApplicationsPanel")) return "applications";
    if (g_str_has_prefix(type_name, "CcNotificationsPanel")) return "notifications";
    if (g_str_has_prefix(type_name, "CcSearchPanel")) return "search";
    if (g_str_has_prefix(type_name, "CcOnlineAccountsPanel")) return "online-accounts";
    if (g_str_has_prefix(type_name, "CcSharingPanel")) return "sharing";
    if (g_str_has_prefix(type_name, "CcWellbeingPanel")) return "wellbeing";
    if (g_str_has_prefix(type_name, "CcMousePanel")) return "mouse";
    if (g_str_has_prefix(type_name, "CcKeyboardPanel")) return "keyboard";
    if (g_str_has_prefix(type_name, "CcPrintersPanel")) return "printers";
    if (g_str_has_prefix(type_name, "CcPrivacyPanel")) return "privacy";
    if (g_str_has_prefix(type_name, "CcUaPanel")) return "universal-access";
    if (g_str_has_prefix(type_name, "CcColorPanel")) return "color";
    if (g_str_has_prefix(type_name, "CcWacomPanel")) return "wacom";

    if (ADW_IS_NAVIGATION_PAGE(widget)) {
        const char *tag = adw_navigation_page_get_tag(ADW_NAVIGATION_PAGE(widget));
        if (tag && (g_strcmp0(tag, "widgets") == 0 || g_strcmp0(tag, "widgets_page") == 0)) return "widgets";
        const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
        if (bid && (g_strcmp0(bid, "widgets") == 0 || g_strcmp0(bid, "widgets_page") == 0)) return "widgets";
    }
    return NULL;
}

static void remove_panel_header_banner_if_any(GtkWidget *widget) {
    if (!widget) return;
    GtkWidget *child = gtk_widget_get_first_child(widget);
    while (child) {
        GtkWidget *next = gtk_widget_get_next_sibling(child);
        if (gtk_widget_has_css_class(child, "mac-panel-header-banner")) {
            GtkWidget *p = gtk_widget_get_parent(child);
            if (p && GTK_IS_BOX(p)) {
                gtk_box_remove(GTK_BOX(p), child);
            }
        } else {
            remove_panel_header_banner_if_any(child);
        }
        child = next;
    }
}

static void expand_clamps_recursive(GtkWidget *widget) {
    if (!widget) return;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(widget), "AdwClamp") == 0) {
        adw_clamp_set_maximum_size(ADW_CLAMP(widget), 1800);
        adw_clamp_set_tightening_threshold(ADW_CLAMP(widget), 1600);
        gtk_widget_set_valign(widget, GTK_ALIGN_START);
        gtk_widget_set_vexpand(widget, FALSE);
        GtkWidget *child = gtk_widget_get_first_child(widget);
        if (child && GTK_IS_BOX(child)) {
            gtk_widget_set_valign(child, GTK_ALIGN_START);
            gtk_widget_set_vexpand(child, FALSE);
        }
    }
    if (ADW_IS_PREFERENCES_GROUP(widget)) {
        gtk_widget_set_valign(widget, GTK_ALIGN_START);
        gtk_widget_set_vexpand(widget, FALSE);
    }
    if (GTK_IS_LABEL(widget)) {
        const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
        if (g_strcmp0(bid, "list_label") == 0 || gtk_widget_has_css_class(widget, "heading")) {
            GtkWidget *parent = gtk_widget_get_parent(widget);
            if (parent && GTK_IS_BOX(parent)) {
                gtk_widget_set_margin_start(parent, 15);
                gtk_widget_set_margin_end(parent, 15);
            } else {
                gtk_widget_set_margin_start(widget, 15);
                gtk_widget_set_margin_end(widget, 15);
            }
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        expand_clamps_recursive(child);
    }
}

static void hide_subtitles_recursive(GtkWidget *widget) {
    if (!widget) return;
    if (GTK_IS_LABEL(widget)) {
        if (gtk_widget_has_css_class(widget, "subtitle")) {
            gtk_widget_set_visible(widget, FALSE);
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        hide_subtitles_recursive(child);
    }
}

static void ensure_panel_header_banner(GtkWidget *target_root, const char *panel_id, const char *panel_title) {
    (void)panel_id; (void)panel_title;
    if (!target_root) return;
    remove_panel_header_banner_if_any(target_root);
}

static void fix_accent_color_buttons(GtkWidget *widget) {
    if (!widget) return;
    const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
    const char *name = gtk_widget_get_name(widget);
    if (g_strcmp0(bid, "accent_box") == 0 || g_strcmp0(name, "accent_box") == 0) {
        gtk_widget_set_halign(widget, GTK_ALIGN_CENTER);
        for (GtkWidget *b = gtk_widget_get_first_child(widget); b; b = gtk_widget_get_next_sibling(b)) {
            gtk_widget_set_size_request(b, 24, 24);
            gtk_widget_set_valign(b, GTK_ALIGN_CENTER);
            gtk_widget_set_halign(b, GTK_ALIGN_CENTER);
        }
        return;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
        fix_accent_color_buttons(c);
    }
}

static void update_panel_headerbar(AdwNavigationSplitView *split_view);

static gboolean update_panel_headerbar_idle_cb(gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (split_view && ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) {
        update_panel_headerbar(split_view);
    }
    return G_SOURCE_REMOVE;
}

static void schedule_update_panel_headerbar(AdwNavigationSplitView *split_view)
{
    if (!split_view || !ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) return;
    update_panel_headerbar(split_view);
    g_idle_add(update_panel_headerbar_idle_cb, split_view);
    g_timeout_add(50, update_panel_headerbar_idle_cb, split_view);
    g_timeout_add(150, update_panel_headerbar_idle_cb, split_view);
    g_timeout_add(300, update_panel_headerbar_idle_cb, split_view);
}

static void sync_sidebar_selection(AdwNavigationSplitView *split_view, const char *panel_id) {
    if (!split_view || !panel_id) return;
    static gboolean in_sync = FALSE;
    if (in_sync) return;

    AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
    if (!sidebar) return;

    GList *list_boxes = NULL;
    find_list_boxes_recursive(GTK_WIDGET(sidebar), &list_boxes);
    GtkListBox *main_listbox = NULL;
    for (GList *l = list_boxes; l != NULL; l = l->next) {
        GtkWidget *w = GTK_WIDGET(l->data);
        const char *bid = GTK_IS_BUILDABLE(w) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(w)) : NULL;
        if (g_strcmp0(bid, "main_listbox") == 0) {
            main_listbox = GTK_LIST_BOX(w);
            break;
        }
    }
    g_list_free(list_boxes);
    if (!main_listbox) return;

    GtkListBoxRow *cur_selected = gtk_list_box_get_selected_row(main_listbox);
    if (cur_selected) {
        MacPanelRowData *d = g_object_get_data(G_OBJECT(cur_selected), "data");
        if (d && g_strcmp0(d->id, panel_id) == 0) return;
    }

    in_sync = TRUE;
    for (GtkWidget *ch = gtk_widget_get_first_child(GTK_WIDGET(main_listbox)); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
        if (GTK_IS_LIST_BOX_ROW(ch)) {
            MacPanelRowData *d = g_object_get_data(G_OBJECT(ch), "data");
            if (d && g_strcmp0(d->id, panel_id) == 0) {
                gtk_list_box_select_row(main_listbox, GTK_LIST_BOX_ROW(ch));
                break;
            }
        }
    }
    in_sync = FALSE;
}

static void on_main_listbox_selected_row_changed(GtkListBox *box, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!box || !split_view) return;
    GtkListBoxRow *row = gtk_list_box_get_selected_row(box);
    if (!row) return;

    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
        return;
    }

    MacPanelRowData *d = g_object_get_data(G_OBJECT(row), "data");
    if (d && d->id) {
        g_object_set_data(G_OBJECT(split_view), "mac_current_panel_id", (gpointer)d->id);
    }
    schedule_update_panel_headerbar(split_view);
}

static void on_main_listbox_row_activated(GtkListBox *box, GtkListBoxRow *row, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view || !row) return;

    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
        g_signal_stop_emission_by_name(box, "row-activated");
        open_system_subpage(split_view, box, "users_row");
        return;
    }

    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_widgets_row"))) {
        g_signal_stop_emission_by_name(box, "row-activated");
        GtkWidget *page = get_widgets_page();
        if (page) {
            adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
            adw_navigation_split_view_set_show_content(split_view, TRUE);
            schedule_update_panel_headerbar(split_view);
            gtk_list_box_select_row(box, row);
        }
        return;
    }

    MacPanelRowData *d = g_object_get_data(G_OBJECT(row), "data");
    if (d && d->id) {
        g_object_set_data(G_OBJECT(split_view), "mac_current_panel_id", (gpointer)d->id);
    }
    schedule_update_panel_headerbar(split_view);
}

static void find_labels_recursive(GtkWidget *widget, GList **list) {
    if (!widget) return;
    if (GTK_IS_LABEL(widget)) {
        *list = g_list_append(*list, widget);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_labels_recursive(child, list);
    }
}

static void find_search_bars_recursive(GtkWidget *widget, GList **list) {
    if (!widget) return;
    if (GTK_IS_SEARCH_BAR(widget)) {
        *list = g_list_append(*list, widget);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_search_bars_recursive(child, list);
    }
}

static void on_search_mode_notify(GObject *gobject, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data G_GNUC_UNUSED) {
    if (!gtk_search_bar_get_search_mode(GTK_SEARCH_BAR(gobject))) {
        gtk_search_bar_set_search_mode(GTK_SEARCH_BAR(gobject), TRUE);
    }
}

static void mac_nav_push_history(AdwNavigationSplitView *split_view, const char *panel_id) {
    if (!split_view || !panel_id) return;
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(split_view), "mac_navigating_history"))) return;

    GList *history = g_object_get_data(G_OBJECT(split_view), "mac_panel_history");
    int idx = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(split_view), "mac_history_idx"));

    if (history) {
        GList *cur_node = g_list_nth(history, idx);
        if (cur_node) {
            char *cur_panel = (char *)cur_node->data;
            if (cur_panel && g_strcmp0(cur_panel, panel_id) == 0) return;
        }
    }

    /* Truncate history after idx */
    while (g_list_length(history) > (guint)(idx + 1)) {
        GList *last = g_list_last(history);
        g_free(last->data);
        history = g_list_delete_link(history, last);
    }

    history = g_list_append(history, g_strdup(panel_id));
    idx = g_list_length(history) - 1;

    g_object_set_data(G_OBJECT(split_view), "mac_panel_history", history);
    g_object_set_data(G_OBJECT(split_view), "mac_history_idx", GINT_TO_POINTER(idx));
}

static const char *get_active_sidebar_panel_title(AdwNavigationSplitView *split_view) {
    if (!split_view) return NULL;
    AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
    if (!sidebar) return NULL;
    GList *list_boxes = NULL;
    find_list_boxes_recursive(GTK_WIDGET(sidebar), &list_boxes);
    GtkListBox *main_listbox = NULL;
    for (GList *l = list_boxes; l != NULL; l = l->next) {
        const char *bid = GTK_IS_BUILDABLE(l->data) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(l->data)) : NULL;
        if (g_strcmp0(bid, "main_listbox") == 0) {
            main_listbox = GTK_LIST_BOX(l->data);
            break;
        }
    }
    g_list_free(list_boxes);
    if (!main_listbox) return NULL;
    GtkListBoxRow *row = gtk_list_box_get_selected_row(main_listbox);
    if (!row) return NULL;
    GList *labels = NULL;
    find_labels_recursive(GTK_WIDGET(row), &labels);
    const char *found_text = NULL;
    for (GList *ll = labels; ll != NULL; ll = ll->next) {
        const char *t = gtk_label_get_text(GTK_LABEL(ll->data));
        if (t && t[0] && g_strcmp0(t, " ") != 0) {
            found_text = t;
            break;
        }
    }
    g_list_free(labels);
    return found_text;
}

static void on_mac_nav_back_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data) {
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view) return;

    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (!content_page) return;

    GList *nav_views = NULL;
    find_navigation_views(GTK_WIDGET(content_page), &nav_views);
    if (nav_views) {
        AdwNavigationView *nv = ADW_NAVIGATION_VIEW(nav_views->data);
        AdwNavigationPage *vis_p = adw_navigation_view_get_visible_page(nv);
        if (vis_p && adw_navigation_view_get_previous_page(nv, vis_p) != NULL) {
            adw_navigation_view_pop(nv);
            g_list_free(nav_views);
            return;
        }
        g_list_free(nav_views);
    }

    /* History back between panels */
    GList *history = g_object_get_data(G_OBJECT(split_view), "mac_panel_history");
    int idx = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(split_view), "mac_history_idx"));
    if (history && idx > 0) {
        idx--;
        GList *node = g_list_nth(history, idx);
        if (node && node->data) {
            const char *target_id = (const char *)node->data;
            g_object_set_data(G_OBJECT(split_view), "mac_navigating_history", GINT_TO_POINTER(1));
            g_object_set_data(G_OBJECT(split_view), "mac_history_idx", GINT_TO_POINTER(idx));

            AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
            if (sidebar) {
                GList *list_boxes = NULL;
                find_list_boxes_recursive(GTK_WIDGET(sidebar), &list_boxes);
                GtkListBox *main_listbox = NULL;
                for (GList *l = list_boxes; l != NULL; l = l->next) {
                    const char *bid = GTK_IS_BUILDABLE(l->data) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(l->data)) : NULL;
                    if (g_strcmp0(bid, "main_listbox") == 0) {
                        main_listbox = GTK_LIST_BOX(l->data);
                        break;
                    }
                }
                g_list_free(list_boxes);
                if (main_listbox) {
                    for (GtkWidget *ch = gtk_widget_get_first_child(GTK_WIDGET(main_listbox)); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
                        if (GTK_IS_LIST_BOX_ROW(ch)) {
                            MacPanelRowData *d = g_object_get_data(G_OBJECT(ch), "data");
                            if (d && g_strcmp0(d->id, target_id) == 0) {
                                gtk_list_box_select_row(main_listbox, GTK_LIST_BOX_ROW(ch));
                                g_signal_emit_by_name(main_listbox, "row-activated", ch);
                                break;
                            }
                        }
                    }
                }
            }
            g_object_set_data(G_OBJECT(split_view), "mac_navigating_history", GINT_TO_POINTER(0));
            update_panel_headerbar(split_view);
        }
    }
}

static void on_mac_nav_fwd_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data) {
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view) return;

    GList *history = g_object_get_data(G_OBJECT(split_view), "mac_panel_history");
    int idx = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(split_view), "mac_history_idx"));
    if (history && (guint)(idx + 1) < g_list_length(history)) {
        idx++;
        GList *node = g_list_nth(history, idx);
        if (node && node->data) {
            const char *target_id = (const char *)node->data;
            g_object_set_data(G_OBJECT(split_view), "mac_navigating_history", GINT_TO_POINTER(1));
            g_object_set_data(G_OBJECT(split_view), "mac_history_idx", GINT_TO_POINTER(idx));

            AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
            if (sidebar) {
                GList *list_boxes = NULL;
                find_list_boxes_recursive(GTK_WIDGET(sidebar), &list_boxes);
                GtkListBox *main_listbox = NULL;
                for (GList *l = list_boxes; l != NULL; l = l->next) {
                    const char *bid = GTK_IS_BUILDABLE(l->data) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(l->data)) : NULL;
                    if (g_strcmp0(bid, "main_listbox") == 0) {
                        main_listbox = GTK_LIST_BOX(l->data);
                        break;
                    }
                }
                g_list_free(list_boxes);
                if (main_listbox) {
                    for (GtkWidget *ch = gtk_widget_get_first_child(GTK_WIDGET(main_listbox)); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
                        if (GTK_IS_LIST_BOX_ROW(ch)) {
                            MacPanelRowData *d = g_object_get_data(G_OBJECT(ch), "data");
                            if (d && g_strcmp0(d->id, target_id) == 0) {
                                gtk_list_box_select_row(main_listbox, GTK_LIST_BOX_ROW(ch));
                                g_signal_emit_by_name(main_listbox, "row-activated", ch);
                                break;
                            }
                        }
                    }
                }
            }
            g_object_set_data(G_OBJECT(split_view), "mac_navigating_history", GINT_TO_POINTER(0));
            update_panel_headerbar(split_view);
        }
    }
}

static void hide_unwanted_headerbar_buttons(GtkWidget *widget, GtkWidget *nav_box) {
    if (!widget) return;
    if (widget == nav_box) return;
    if (GTK_IS_BUTTON(widget)) {
        const char *icon_name = gtk_button_get_icon_name(GTK_BUTTON(widget));
        if (g_strcmp0(icon_name, "edit-find-symbolic") == 0 ||
            g_strcmp0(icon_name, "open-menu-symbolic") == 0) {
            gtk_widget_set_visible(widget, FALSE);
        }
    }
    for (GtkWidget *ch = gtk_widget_get_first_child(widget); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
        hide_unwanted_headerbar_buttons(ch, nav_box);
    }
}

static void on_visible_page_changed_cb(GObject *gobject G_GNUC_UNUSED, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    schedule_update_panel_headerbar(split_view);
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

    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (!content_page) return;

    GList *nav_views = NULL;
    find_navigation_views(GTK_WIDGET(content_page), &nav_views);
    GtkWidget *target_root = GTK_WIDGET(content_page);
    gboolean is_subpage = FALSE;
    AdwNavigationPage *vis_p = NULL;

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
        const char *target_row = g_object_get_data(G_OBJECT(split_view), "mac_target_subpage_row");
        if (!target_row && g_getenv("MAC_SETTINGS_TARGET_ROW") && !g_object_get_data(G_OBJECT(nv), "mac_env_target_row_done")) {
            target_row = g_getenv("MAC_SETTINGS_TARGET_ROW");
            g_object_set_data(G_OBJECT(nv), "mac_env_target_row_done", GINT_TO_POINTER(1));
        }
        if (target_row) {
            g_object_set_data(G_OBJECT(split_view), "mac_target_subpage_row", NULL);
            if (g_strcmp0(target_row, "mac_styling_row") == 0) {
                adw_navigation_view_push_by_tag(nv, "mac-styling");
            }
            activate_system_row_by_id(GTK_WIDGET(content_page), target_row);
        }
        vis_p = adw_navigation_view_get_visible_page(nv);
        if (vis_p) {
            target_root = GTK_WIDGET(vis_p);
            if (adw_navigation_view_get_previous_page(nv, vis_p) != NULL) {
                is_subpage = TRUE;
            }
        }
        g_list_free(nav_views);
    }

    const char *detected_id = get_panel_id_from_widget(GTK_WIDGET(content_page));
    if (detected_id) {
        g_object_set_data(G_OBJECT(split_view), "mac_current_panel_id", (gpointer)detected_id);
    }
    const char *cur_id = detected_id ? detected_id : g_object_get_data(G_OBJECT(split_view), "mac_current_panel_id");
    if (!cur_id) cur_id = "system";

    expand_clamps_recursive(target_root);
    remove_panel_header_banner_if_any(target_root);
    hide_subtitles_recursive(target_root);
    fix_accent_color_buttons(target_root);

    sync_sidebar_selection(split_view, cur_id);

    if (!is_subpage && cur_id) {
        mac_nav_push_history(split_view, cur_id);
    }

    GList *content_bars = NULL;
    find_headerbars_recursive(target_root, &content_bars);
    if (!content_bars && target_root != GTK_WIDGET(content_page)) {
        find_headerbars_recursive(GTK_WIDGET(content_page), &content_bars);
    }
    if (!content_bars) {
        GtkWidget *win = gtk_widget_get_ancestor(GTK_WIDGET(split_view), GTK_TYPE_WINDOW);
        if (win) {
            find_headerbars_recursive(win, &content_bars);
            AdwNavigationPage *sidebar = adw_navigation_split_view_get_sidebar(split_view);
            if (sidebar) {
                GList *sb_bars = NULL;
                find_headerbars_recursive(GTK_WIDGET(sidebar), &sb_bars);
                for (GList *s = sb_bars; s != NULL; s = s->next) {
                    content_bars = g_list_remove(content_bars, s->data);
                }
                g_list_free(sb_bars);
            }
        }
    }
    if (!content_bars) return;

    for (GList *l = content_bars; l != NULL; l = l->next) {
        if (!ADW_IS_HEADER_BAR(l->data)) continue;
        AdwHeaderBar *target_hb = ADW_HEADER_BAR(l->data);
        gtk_widget_add_css_class(GTK_WIDGET(target_hb), "mac-settings-content-headerbar");
        gtk_widget_set_margin_top(GTK_WIDGET(target_hb), 3);

        /* Hide standard title and back button */
        adw_header_bar_set_show_title(target_hb, FALSE);
        adw_header_bar_set_show_back_button(target_hb, FALSE);

        /* Ensure mac_nav_box with Nautilus < | > pill and title label */
        GtkWidget *nav_box = g_object_get_data(G_OBJECT(target_hb), "mac_nav_box");
        GtkWidget *back_btn = g_object_get_data(G_OBJECT(target_hb), "mac_back_btn");
        GtkWidget *fwd_btn = g_object_get_data(G_OBJECT(target_hb), "mac_fwd_btn");
        GtkWidget *title_label = g_object_get_data(G_OBJECT(target_hb), "mac_title_label");

        if (!nav_box) {
            nav_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
            gtk_widget_add_css_class(nav_box, "mac-nav-header-box");
            gtk_widget_set_valign(nav_box, GTK_ALIGN_CENTER);
            gtk_widget_set_margin_start(nav_box, 6);

            GtkWidget *pill = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
            gtk_widget_add_css_class(pill, "mc-toggle-group");
            gtk_widget_add_css_class(pill, "mac-nav-pill");
            gtk_widget_set_valign(pill, GTK_ALIGN_CENTER);

            back_btn = gtk_button_new_from_icon_name("go-previous-symbolic");
            gtk_widget_add_css_class(back_btn, "mac-nav-btn");
            gtk_widget_add_css_class(back_btn, "mac-nav-back");
            gtk_widget_set_size_request(back_btn, 29, 29);
            gtk_widget_set_tooltip_text(back_btn, mac_tr("back", "Назад"));
            g_signal_connect(back_btn, "clicked", G_CALLBACK(on_mac_nav_back_clicked), split_view);
            gtk_box_append(GTK_BOX(pill), back_btn);

            GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_VERTICAL);
            gtk_widget_add_css_class(sep, "mac-nav-sep");
            gtk_box_append(GTK_BOX(pill), sep);

            fwd_btn = gtk_button_new_from_icon_name("go-next-symbolic");
            gtk_widget_add_css_class(fwd_btn, "mac-nav-btn");
            gtk_widget_add_css_class(fwd_btn, "mac-nav-fwd");
            gtk_widget_set_size_request(fwd_btn, 29, 29);
            gtk_widget_set_tooltip_text(fwd_btn, mac_tr("forward", "Вперед"));
            g_signal_connect(fwd_btn, "clicked", G_CALLBACK(on_mac_nav_fwd_clicked), split_view);
            gtk_box_append(GTK_BOX(pill), fwd_btn);

            gtk_box_append(GTK_BOX(nav_box), pill);

            title_label = gtk_label_new("");
            gtk_widget_add_css_class(title_label, "mac-panel-title-label");
            gtk_widget_set_valign(title_label, GTK_ALIGN_CENTER);
            gtk_label_set_xalign(GTK_LABEL(title_label), 0.0);
            gtk_box_append(GTK_BOX(nav_box), title_label);

            g_object_set_data(G_OBJECT(target_hb), "mac_nav_box", nav_box);
            g_object_set_data(G_OBJECT(target_hb), "mac_back_btn", back_btn);
            g_object_set_data(G_OBJECT(target_hb), "mac_fwd_btn", fwd_btn);
            g_object_set_data(G_OBJECT(target_hb), "mac_title_label", title_label);

            adw_header_bar_pack_start(target_hb, nav_box);
        }

        gtk_widget_set_visible(nav_box, TRUE);
        if (back_btn) {
            gtk_widget_set_size_request(back_btn, 29, 29);
            gtk_widget_set_visible(back_btn, TRUE);
        }
        if (fwd_btn) {
            gtk_widget_set_size_request(fwd_btn, 29, 29);
            gtk_widget_set_visible(fwd_btn, TRUE);
        }
        if (title_label) {
            gtk_widget_set_visible(title_label, TRUE);
        }
        hide_unwanted_headerbar_buttons(GTK_WIDGET(target_hb), nav_box);

        /* Update title */
        const char *header_title = NULL;
        if (is_subpage && vis_p) {
            header_title = adw_navigation_page_get_title(vis_p);
        }
        if (!header_title || !header_title[0]) {
            header_title = get_active_sidebar_panel_title(split_view);
        }
        if (!header_title || !header_title[0]) {
            header_title = adw_navigation_page_get_title(content_page);
        }
        gtk_label_set_text(GTK_LABEL(title_label), (header_title && header_title[0]) ? header_title : "Параметри");

        /* Update sensitivity of back / fwd */
        GList *history = g_object_get_data(G_OBJECT(split_view), "mac_panel_history");
        int hist_idx = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(split_view), "mac_history_idx"));
        if (is_subpage) {
            gtk_widget_set_sensitive(back_btn, TRUE);
            gtk_widget_set_sensitive(fwd_btn, FALSE);
        } else {
            gtk_widget_set_sensitive(back_btn, hist_idx > 0);
            gtk_widget_set_sensitive(fwd_btn, history && (guint)(hist_idx + 1) < g_list_length(history));
        }

        GList *switchers = NULL;
        find_view_switchers_recursive(GTK_WIDGET(target_hb), &switchers);
        if (switchers) {
            gtk_widget_add_css_class(GTK_WIDGET(target_hb), "has-view-switcher");
            gtk_widget_add_css_class(GTK_WIDGET(target_hb), "mac-settings-switcher-headerbar");
            for (GList *sl = switchers; sl != NULL; sl = sl->next) {
                gtk_widget_add_css_class(GTK_WIDGET(sl->data), "mac-view-switcher");
                setup_mac_view_switcher(GTK_WIDGET(sl->data));
            }
            g_list_free(switchers);
        }
    }
    GtkWidget *search_btn = g_object_get_data(G_OBJECT(split_view), "mac_search_btn");
    GtkWidget *menu_btn = g_object_get_data(G_OBJECT(split_view), "mac_menu_btn");
    if (menu_btn) {
        gtk_widget_set_visible(menu_btn, FALSE);
        if (gtk_widget_get_parent(menu_btn)) {
            GtkWidget *p = gtk_widget_get_parent(menu_btn);
            if (ADW_IS_HEADER_BAR(p)) remove_from_headerbar(ADW_HEADER_BAR(p), menu_btn);
            else if (GTK_IS_BOX(p)) gtk_box_remove(GTK_BOX(p), menu_btn);
        }
    }
    if (search_btn) {
        gtk_widget_set_visible(search_btn, FALSE);
        if (gtk_widget_get_parent(search_btn)) {
            GtkWidget *p = gtk_widget_get_parent(search_btn);
            if (ADW_IS_HEADER_BAR(p)) remove_from_headerbar(ADW_HEADER_BAR(p), search_btn);
            else if (GTK_IS_BOX(p)) gtk_box_remove(GTK_BOX(p), search_btn);
        }
    }



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
    schedule_update_panel_headerbar(split_view);
}

static void find_search_entries_recursive(GtkWidget *widget, GList **list) {
    if (!widget) return;
    if (GTK_IS_SEARCH_ENTRY(widget)) {
        *list = g_list_append(*list, widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_search_entries_recursive(child, list);
    }
}

static void style_sidebar_row_recursive(GtkWidget *widget) {
    if (!widget) return;
    if (GTK_IS_IMAGE(widget)) {
        gtk_image_set_pixel_size(GTK_IMAGE(widget), 13);
        gtk_widget_set_halign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_margin_start(widget, 0);
        gtk_widget_set_margin_end(widget, 0);
    }
    if (GTK_IS_LABEL(widget)) {
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_label_set_xalign(GTK_LABEL(widget), 0.0);
        gtk_widget_set_margin_top(widget, 1);
        gtk_widget_set_margin_bottom(widget, 0);
        gtk_widget_set_margin_start(widget, 0);
        gtk_widget_set_margin_end(widget, 0);
    }
    if (GTK_IS_GRID(widget)) {
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_margin_top(widget, 0);
        gtk_widget_set_margin_bottom(widget, 0);
        gtk_widget_set_margin_start(widget, 0);
        gtk_widget_set_margin_end(widget, 0);
        gtk_grid_set_column_spacing(GTK_GRID(widget), 6);
    }
    if (GTK_IS_BOX(widget)) {
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_margin_top(widget, 0);
        gtk_widget_set_margin_bottom(widget, 0);
        gtk_widget_set_margin_start(widget, 0);
        gtk_widget_set_margin_end(widget, 0);
        gtk_box_set_spacing(GTK_BOX(widget), 6);
    }
    for (GtkWidget *ch = gtk_widget_get_first_child(widget); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
        style_sidebar_row_recursive(ch);
    }
}

static gboolean mac_fix_settings_window(gpointer user_data)
{
    GtkWindow *window = GTK_WINDOW(user_data);
    if (!window || !GTK_IS_WINDOW(window)) return G_SOURCE_REMOVE;
    init_mac_settings_css();
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

    gtk_widget_add_css_class(GTK_WIDGET(sidebar), "mac-settings-sidebar");

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
        if (search_btn) gtk_widget_set_visible(search_btn, FALSE);
        if (menu_btn) gtk_widget_set_visible(menu_btn, FALSE);
        g_list_free(sidebar_bars);
    }

    /* Ensure search bar is always visible and in search mode */
    GList *sb_list = NULL;
    find_search_bars_recursive(GTK_WIDGET(sidebar), &sb_list);
    for (GList *l = sb_list; l != NULL; l = l->next) {
        GtkSearchBar *sb = GTK_SEARCH_BAR(l->data);
        gtk_search_bar_set_search_mode(sb, TRUE);
        gtk_search_bar_set_show_close_button(sb, FALSE);
        if (!g_object_get_data(G_OBJECT(sb), "mac_search_mode_locked")) {
            g_signal_connect(sb, "notify::search-mode-enabled", G_CALLBACK(on_search_mode_notify), NULL);
            g_object_set_data(G_OBJECT(sb), "mac_search_mode_locked", GINT_TO_POINTER(1));
        }
    }
    g_list_free(sb_list);

    GList *searches = NULL;
    find_search_entries_recursive(GTK_WIDGET(sidebar), &searches);
    for (GList *l = searches; l != NULL; l = l->next) {
        GtkWidget *se = GTK_WIDGET(l->data);
        if (!g_object_get_data(G_OBJECT(se), "mac_search_configured")) {
            g_object_set(se, "placeholder-text", mac_tr("search", "Пошук"), NULL);
            g_object_set_data(G_OBJECT(se), "mac_search_configured", GINT_TO_POINTER(1));
        }
    }
    g_list_free(searches);

    if (sidebar) {
        configure_toolbar_views_recursive(GTK_WIDGET(sidebar), TRUE);
    }
    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (content_page) {
        gtk_widget_add_css_class(GTK_WIDGET(content_page), "mac-settings-content");
        configure_toolbar_views_recursive(GTK_WIDGET(content_page), FALSE);
    }
    schedule_update_panel_headerbar(split_view);

    /* Locate main_listbox in sidebar and inject Widgets, Account, and Alert rows */
    GList *list_boxes = NULL;
    find_list_boxes_recursive(GTK_WIDGET(sidebar), &list_boxes);
    GtkListBox *main_listbox = NULL;
    for (GList *l = list_boxes; l != NULL; l = l->next) {
        GtkWidget *w = GTK_WIDGET(l->data);
        const char *bid = GTK_IS_BUILDABLE(w) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(w)) : NULL;
        if (g_strcmp0(bid, "main_listbox") == 0) {
            main_listbox = GTK_LIST_BOX(w);
            break;
        }
    }
    if (!main_listbox && list_boxes) {
        for (GList *l = list_boxes; l != NULL; l = l->next) {
            GtkWidget *w = GTK_WIDGET(l->data);
            if (gtk_widget_has_css_class(w, "navigation-sidebar")) {
                const char *bid = GTK_IS_BUILDABLE(w) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(w)) : NULL;
                if (!bid || g_strcmp0(bid, "search_listbox") != 0) {
                    main_listbox = GTK_LIST_BOX(w);
                    break;
                }
            }
        }
    }
    g_list_free(list_boxes);

    if (main_listbox) {
        gtk_widget_add_css_class(GTK_WIDGET(main_listbox), "mac-settings-sidebar-list");

        if (!g_object_get_data(G_OBJECT(main_listbox), "mac_account_row_added")) {
            GtkListBoxRow *account_row = create_account_row(split_view);
            gtk_list_box_append(main_listbox, GTK_WIDGET(account_row));
            g_object_set_data(G_OBJECT(main_listbox), "mac_account_row_added", GINT_TO_POINTER(1));
        }

        GtkListBoxRow *widgets_row = g_object_get_data(G_OBJECT(split_view), "mac_widgets_row");
        if (!g_object_get_data(G_OBJECT(main_listbox), "mac_widgets_row_added")) {
            widgets_row = GTK_LIST_BOX_ROW(gtk_list_box_row_new());
            g_object_set_data(G_OBJECT(widgets_row), "is_widgets_row", GINT_TO_POINTER(1));

            GtkWidget *grid = gtk_grid_new();
            gtk_widget_set_hexpand(grid, TRUE);
            gtk_widget_set_valign(grid, GTK_ALIGN_CENTER);
            gtk_widget_set_margin_top(grid, 0);
            gtk_widget_set_margin_bottom(grid, 0);
            gtk_widget_set_margin_start(grid, 0);
            gtk_widget_set_margin_end(grid, 0);
            gtk_grid_set_column_spacing(GTK_GRID(grid), 6);

            GtkWidget *image = gtk_image_new_from_icon_name("view-grid-symbolic");
            gtk_image_set_pixel_size(GTK_IMAGE(image), 13);
            gtk_widget_set_halign(image, GTK_ALIGN_CENTER);
            gtk_widget_set_valign(image, GTK_ALIGN_CENTER);
            gtk_grid_attach(GTK_GRID(grid), image, 0, 0, 1, 1);

            GtkWidget *label = gtk_label_new(mac_tr("widgets", "Віджети"));
            gtk_label_set_xalign(GTK_LABEL(label), 0.0);
            gtk_widget_set_valign(label, GTK_ALIGN_CENTER);
            gtk_widget_set_margin_start(label, 0);
            gtk_widget_set_margin_top(label, 1);
            gtk_widget_set_margin_bottom(label, 0);
            gtk_widget_set_hexpand(label, TRUE);
            gtk_grid_attach(GTK_GRID(grid), label, 1, 0, 1, 1);

            gtk_list_box_row_set_child(widgets_row, grid);

            MacPanelRowData *row_data = g_new0(MacPanelRowData, 1);
            row_data->row = widgets_row;
            row_data->id = g_strdup("widgets");
            g_object_set_data_full(G_OBJECT(widgets_row), "data", row_data, (GDestroyNotify)g_free);

            gtk_list_box_append(main_listbox, GTK_WIDGET(widgets_row));

            g_object_set_data(G_OBJECT(main_listbox), "mac_widgets_row_added", GINT_TO_POINTER(1));
            g_object_set_data(G_OBJECT(split_view), "mac_widgets_row", widgets_row);
        }

        if (!g_object_get_data(G_OBJECT(main_listbox), "mac_listbox_connected")) {
            gtk_list_box_set_sort_func(main_listbox, mac_main_listbox_sort_func, NULL, NULL);
            gtk_list_box_set_header_func(main_listbox, NULL, NULL, NULL);
            gtk_list_box_invalidate_sort(main_listbox);
            gtk_list_box_invalidate_headers(main_listbox);

            g_signal_connect(main_listbox, "row-activated", G_CALLBACK(on_main_listbox_row_activated), split_view);
            g_signal_connect(main_listbox, "notify::selected-row", G_CALLBACK(on_main_listbox_selected_row_changed), split_view);
            g_object_set_data(G_OBJECT(main_listbox), "mac_listbox_connected", GINT_TO_POINTER(1));
        }

        /* Style all rows inside main_listbox to ensure compact macOS heights */
        for (GtkWidget *ch = gtk_widget_get_first_child(GTK_WIDGET(main_listbox)); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
            if (GTK_IS_LIST_BOX_ROW(ch)) {
                if (!g_object_get_data(G_OBJECT(ch), "is_account_row")) {
                    style_sidebar_row_recursive(ch);
                }
            }
        }

        update_sidebar_group_spacing(main_listbox);
        g_idle_add(update_sidebar_group_spacing_idle, main_listbox);

        if (g_getenv("MAC_SETTINGS_OPEN_WIDGETS") && !g_object_get_data(G_OBJECT(split_view), "mac_widgets_opened")) {
            g_object_set_data(G_OBJECT(split_view), "mac_widgets_opened", GINT_TO_POINTER(1));
            if (widgets_row) {
                gtk_list_box_select_row(main_listbox, widgets_row);
            }
            GtkWidget *page = get_widgets_page();
            if (page) {
                adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
                adw_navigation_split_view_set_show_content(split_view, TRUE);
                schedule_update_panel_headerbar(split_view);
            }
        }
    }

    if (g_getenv("MAC_SETTINGS_TEST_CLICKS") && main_listbox) {
        printf("--- MAC_SETTINGS_TEST_CLICKS START ---\n");
        const char *test_ids[] = {
            "wifi", "bluetooth", "network", "power",
            "system", "universal-access", "background", "ubuntu", "widgets", "display", "multitasking",
            "notifications", "sound",
            "applications", "search", "online-accounts", "sharing",
            "mouse", "keyboard", "printers", "privacy",
            NULL
        };
        for (int t = 0; test_ids[t] != NULL; t++) {
            const char *target = test_ids[t];
            for (GtkWidget *child = gtk_widget_get_first_child(GTK_WIDGET(main_listbox)); child != NULL; child = gtk_widget_get_next_sibling(child)) {
                if (GTK_IS_LIST_BOX_ROW(child)) {
                    MacPanelRowData *d = g_object_get_data(G_OBJECT(child), "data");
                    if (d && g_strcmp0(d->id, target) == 0) {
                        g_signal_emit_by_name(main_listbox, "row-activated", child);
                        AdwNavigationPage *cp = adw_navigation_split_view_get_content(split_view);
                        const char *cur_id = g_object_get_data(G_OBJECT(split_view), "mac_current_panel_id");
                        printf("Activated %-16s -> cur_id=%-16s content=%s\n", target, cur_id ? cur_id : "null", cp ? G_OBJECT_TYPE_NAME(cp) : "null");
                        break;
                    }
                }
            }
        }
        printf("--- MAC_SETTINGS_TEST_CLICKS END ---\n");
        exit(0);
    }

    expand_clamps_recursive(GTK_WIDGET(window));
    remove_panel_header_banner_if_any(GTK_WIDGET(window));

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



