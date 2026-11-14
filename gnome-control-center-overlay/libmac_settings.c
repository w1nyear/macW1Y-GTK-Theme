#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <glib.h>
#include <gio/gio.h>
#include <dlfcn.h>
#include <gtk/gtk.h>
#include <adwaita.h>
#include <json-glib/json-glib.h>
#include <pango/pangocairo.h>


#include <math.h>
#include "mac_i18n.h"

typedef struct {
    int menubar_tint;   /* 0 - 100 */
    int menubar_blur;   /* 0 - 100 */

    int liquid_shape;      /* 0 - 2 (0=RoundRect, 1=Circle, 2=Capsule) */
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

    int widget_radius;  /* 0 - 40 px */
    int widget_blur;    /* 0 - 50 px */
    int widget_tint;    /* 0 - 100 % */
    int widget_shadow;  /* 0 - 100 % */

    /* Group: Dock */
    int dock_tint;      /* 0 - 100 % */
    int dock_blur;      /* 0 - 50 px */
    int dock_shadow;    /* 0 - 100 % */

    /* Group: Alerts / Dialogs */
    int alert_tint;     /* 0 - 100 % */
    int alert_blur;     /* 0 - 50 px */
    int alert_shadow;   /* 0 - 100 % */

    /* Group: Notifications */
    int notification_blur;   /* 0 - 50 px */
    int notification_tint;   /* 0 - 100 % */
    int notification_shadow; /* 0 - 100 % */

    /* Group: Labels (Бірки) */
    int label_blur;          /* 0 - 50 px */
    int label_tint;          /* 0 - 100 % */
    int label_shadow;        /* 0 - 100 % */

    /* Legacy fields for backward compatibility */
    int dock_sigma;
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

static void apply_widget_settings(void);
static void apply_dock_settings(void);
static void schedule_dock_apply(void);
static void apply_label_settings(void);
static void schedule_label_apply(void);
static void apply_alert_settings(void);
static void schedule_alert_apply(void);
static void apply_notification_settings(void);
static void schedule_notification_apply(void);

static void redraw_menubar_preview(void);
static void redraw_dock_preview(void);
static void redraw_labels_preview(void);
static void redraw_alerts_preview(void);
static void redraw_notifications_preview(void);
static void redraw_spotlight_preview(void);
static void redraw_blur_preview(void);
static void redraw_context_menu_preview(void);
static void redraw_widgets_preview(void);
static GtkWidget *get_mac_styling_page(void);
static void clear_blurred_wallpaper_cache(void);
static cairo_surface_t *get_cached_blurred_wallpaper_surface(int target_w, int target_h, int radius);
static void draw_frosted_glass_card(cairo_t *cr, cairo_surface_t *blurred_bg,
                                    double x, double y, double w, double h, double r,
                                    double tint_alpha, double shadow_alpha, double sheen);
static void reorder_group_previews_to_top(GtkWidget *widget);
static void on_mac_styling_page_map(GtkWidget *widget, gpointer user_data);


static MacStylingData state = {
    .menubar_tint = 30,
    .menubar_blur = 25,

    .liquid_shape = 2,
    .liquid_refraction = 80,
    .liquid_blur = 9,
    .liquid_tint = 15,
    .liquid_chroma = 10,
    .liquid_rim = 40,
    .liquid_specular = 10,
    .liquid_shadow = 49,

    .dock_tint = 0,
    .dock_blur = 1,
    .dock_shadow = 0,

    .label_blur = 30,
    .label_tint = 28,
    .label_shadow = 25,

    .alert_tint = 20,
    .alert_blur = 15,
    .alert_shadow = 35,

    .notification_blur = 15,
    .notification_tint = 20,
    .notification_shadow = 35,

    .spotlight_blur = 25,
    .spotlight_tint = 15,
    .spotlight_shadow = 35,

    .blur_sigma = 31,
    .blur_tint = 29,

    .menu_tint = 20,
    .menu_blur = 9,
    .menu_shadow_blur = 51,
    .menu_shadow_strength = 30,

    .widget_radius = 35,
    .widget_blur = 1,
    .widget_tint = 20,
    .widget_shadow = 30,

    .dock_sigma = 1,
    .dock_radius = 28,

    .panel_blur = 1,
    .panel_sigma = 25,
    .panel_tint = 0.30,

    .qs_sigma = 30,
    .qs_anim = 0,

    .notif_blur = 1,
    .notif_sigma = 30,
    .notif_tint = 0.29,
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
                state.liquid_shape = (int)CLAMP((int)json_object_get_int_member(obj, "liquid_shape"), 0, 2);
            else
                state.liquid_shape = 2;

            if (json_object_has_member(obj, "liquid_refraction"))
                state.liquid_refraction = (int)json_object_get_int_member(obj, "liquid_refraction");
            else
                state.liquid_refraction = 80;

            if (json_object_has_member(obj, "liquid_blur"))
                state.liquid_blur = (int)json_object_get_int_member(obj, "liquid_blur");
            else if (json_object_has_member(obj, "dock_glass_strength"))
                state.liquid_blur = (int)round(json_object_get_double_member(obj, "dock_glass_strength") * 50.0);
            else
                state.liquid_blur = 9;

            if (json_object_has_member(obj, "liquid_tint"))
                state.liquid_tint = (int)json_object_get_int_member(obj, "liquid_tint");
            else if (json_object_has_member(obj, "dock_tint_strength"))
                state.liquid_tint = (int)round(json_object_get_double_member(obj, "dock_tint_strength") * 100.0);
            else
                state.liquid_tint = 15;

            if (json_object_has_member(obj, "liquid_chroma"))
                state.liquid_chroma = (int)json_object_get_int_member(obj, "liquid_chroma");
            else
                state.liquid_chroma = 10;

            if (json_object_has_member(obj, "liquid_rim"))
                state.liquid_rim = (int)json_object_get_int_member(obj, "liquid_rim");
            else
                state.liquid_rim = 40;

            if (json_object_has_member(obj, "liquid_specular"))
                state.liquid_specular = (int)json_object_get_int_member(obj, "liquid_specular");
            else
                state.liquid_specular = 10;

            if (json_object_has_member(obj, "liquid_shadow"))
                state.liquid_shadow = (int)json_object_get_int_member(obj, "liquid_shadow");
            else
                state.liquid_shadow = 49;

            /* Group 3: Spotlight */
            if (json_object_has_member(obj, "spotlight_blur")) {
                int val = (int)json_object_get_int_member(obj, "spotlight_blur");
                state.spotlight_blur = (val <= 1) ? 25 : val;
            } else {
                state.spotlight_blur = 25;
            }

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
                state.menu_tint = 20;

            if (json_object_has_member(obj, "menu_blur"))
                state.menu_blur = (int)json_object_get_int_member(obj, "menu_blur");
            else
                state.menu_blur = 9;

            if (json_object_has_member(obj, "menu_shadow_blur"))
                state.menu_shadow_blur = (int)json_object_get_int_member(obj, "menu_shadow_blur");
            else
                state.menu_shadow_blur = 51;

            if (json_object_has_member(obj, "menu_shadow_strength"))
                state.menu_shadow_strength = (int)json_object_get_int_member(obj, "menu_shadow_strength");
            else
                state.menu_shadow_strength = 30;

            /* Group 5: Widgets */
            if (json_object_has_member(obj, "widget_radius"))
                state.widget_radius = (int)json_object_get_int_member(obj, "widget_radius");
            else
                state.widget_radius = 35;

            if (json_object_has_member(obj, "widget_blur"))
                state.widget_blur = (int)json_object_get_int_member(obj, "widget_blur");
            else
                state.widget_blur = 1;

            if (json_object_has_member(obj, "widget_tint"))
                state.widget_tint = (int)json_object_get_int_member(obj, "widget_tint");
            else
                state.widget_tint = 20;

            if (json_object_has_member(obj, "widget_shadow"))
                state.widget_shadow = (int)json_object_get_int_member(obj, "widget_shadow");
            else
                state.widget_shadow = 30;

            /* Group: Dock */
            if (json_object_has_member(obj, "dock_tint")) {
                JsonNode *node = json_object_get_member(obj, "dock_tint");
                if (json_node_get_value_type(node) == G_TYPE_INT64) {
                    state.dock_tint = (int)json_node_get_int(node);
                } else if (json_node_get_value_type(node) == G_TYPE_DOUBLE) {
                    double d = json_node_get_double(node);
                    state.dock_tint = (d <= 1.0) ? (int)round(d * 100.0) : (int)round(d);
                }
            } else {
                state.dock_tint = 0;
            }

            if (json_object_has_member(obj, "dock_blur")) {
                JsonNode *node = json_object_get_member(obj, "dock_blur");
                if (json_node_get_value_type(node) == G_TYPE_INT64) {
                    state.dock_blur = (int)json_node_get_int(node);
                } else if (json_node_get_value_type(node) == G_TYPE_BOOLEAN) {
                    if (json_object_has_member(obj, "dock_sigma")) {
                        state.dock_blur = (int)json_object_get_int_member(obj, "dock_sigma");
                    } else {
                        state.dock_blur = json_node_get_boolean(node) ? 9 : 0;
                    }
                }
            } else if (json_object_has_member(obj, "dock_sigma")) {
                state.dock_blur = (int)json_object_get_int_member(obj, "dock_sigma");
            } else {
                state.dock_blur = 1;
            }

            if (json_object_has_member(obj, "dock_shadow")) {
                state.dock_shadow = (int)json_object_get_int_member(obj, "dock_shadow");
            } else {
                state.dock_shadow = 0;
            }

            /* Group: Labels (Бірки) */
            if (json_object_has_member(obj, "label_blur"))
                state.label_blur = (int)json_object_get_int_member(obj, "label_blur");
            else
                state.label_blur = 30;

            if (json_object_has_member(obj, "label_tint"))
                state.label_tint = (int)json_object_get_int_member(obj, "label_tint");
            else
                state.label_tint = 28;

            if (json_object_has_member(obj, "label_shadow"))
                state.label_shadow = (int)json_object_get_int_member(obj, "label_shadow");
            else
                state.label_shadow = 25;

            /* Group: Alerts / Dialogs */
            if (json_object_has_member(obj, "alert_tint"))
                state.alert_tint = (int)json_object_get_int_member(obj, "alert_tint");
            else
                state.alert_tint = 20;

            if (json_object_has_member(obj, "alert_blur"))
                state.alert_blur = (int)json_object_get_int_member(obj, "alert_blur");
            else
                state.alert_blur = 15;

            if (json_object_has_member(obj, "alert_shadow"))
                state.alert_shadow = (int)json_object_get_int_member(obj, "alert_shadow");
            else
                state.alert_shadow = 35;

            /* Group: Notifications */
            if (json_object_has_member(obj, "notification_blur"))
                state.notification_blur = (int)json_object_get_int_member(obj, "notification_blur");
            else
                state.notification_blur = 15;

            if (json_object_has_member(obj, "notification_tint"))
                state.notification_tint = (int)json_object_get_int_member(obj, "notification_tint");
            else
                state.notification_tint = 20;

            if (json_object_has_member(obj, "notification_shadow"))
                state.notification_shadow = (int)json_object_get_int_member(obj, "notification_shadow");
            else
                state.notification_shadow = 35;

            /* Legacy */
            if (json_object_has_member(obj, "dock_sigma"))
                state.dock_sigma = (int)json_object_get_int_member(obj, "dock_sigma");
            else
                state.dock_sigma = state.dock_blur;
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
    g_ascii_formatd(dock_tint_buf, sizeof(dock_tint_buf), "%.2f", (double)state.dock_tint / 100.0);
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
        "  \"dock_tint\": %d,\n"
        "  \"dock_blur\": %d,\n"
        "  \"dock_shadow\": %d,\n"
        "  \"label_blur\": %d,\n"
        "  \"label_tint\": %d,\n"
        "  \"label_shadow\": %d,\n"
        "  \"alert_tint\": %d,\n"
        "  \"alert_blur\": %d,\n"
        "  \"alert_shadow\": %d,\n"
        "  \"notification_blur\": %d,\n"
        "  \"notification_tint\": %d,\n"
        "  \"notification_shadow\": %d,\n"
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
        "  \"widget_radius\": %d,\n"
        "  \"dock_sigma\": %d,\n"
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
        state.dock_tint,
        state.dock_blur,
        state.dock_shadow,
        state.label_blur,
        state.label_tint,
        state.label_shadow,
        state.alert_tint,
        state.alert_blur,
        state.alert_shadow,
        state.notification_blur,
        state.notification_tint,
        state.notification_shadow,
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
        state.widget_radius,
        state.dock_blur,
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

static gboolean mac_is_light_mode(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return FALSE;
    GSettingsSchema *schema = g_settings_schema_source_lookup(src, "org.gnome.desktop.interface", TRUE);
    if (!schema) return FALSE;
    g_settings_schema_unref(schema);
    GSettings *iface = g_settings_new("org.gnome.desktop.interface");
    if (!iface) return FALSE;
    char *scheme = g_settings_get_string(iface, "color-scheme");
    gboolean is_light = (scheme && (g_strcmp0(scheme, "prefer-light") == 0 || g_strcmp0(scheme, "default") == 0));
    g_free(scheme);
    g_object_unref(iface);
    return is_light;
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

    gboolean is_light = mac_is_light_mode();
    const char *tint_col = is_light ? "#ffffff" : "#000000";
    const char *dock_col = is_light ? "#ffffff" : "#29292e";

    int radius = state.liquid_blur;
    double tint = (double)state.liquid_tint / 100.0;
    double disp_scale = (double)state.liquid_refraction * 1.5;
    double ior = 1.0 + ((double)state.liquid_refraction / 100.0) * 1.0;
    double chroma = ((double)state.liquid_chroma / 100.0) * 0.04;
    double rim = (double)state.liquid_rim / 100.0;
    double specular = (double)state.liquid_specular / 100.0;

    /* Base Liquid Glass blur for quick-settings, notifications, applications, osd */
    const char *blur_keys[] = {
        "quick-settings-blur-radius",
        "notification-blur-radius",
        "application-blur-radius",
        "osd-blur-radius",
        NULL
    };

    for (int i = 0; blur_keys[i] != NULL; i++) {
        safe_set_int(lg, schema, blur_keys[i], radius);
    }

    /* Base Liquid Glass tint for quick-settings, notifications, applications, osd */
    const char *tint_keys[] = {
        "quick-settings-tint-strength",
        "quick-settings-toggle-tint-strength",
        "notification-tint-strength",
        "application-tint-strength",
        "osd-tint-strength",
        NULL
    };

    for (int i = 0; tint_keys[i] != NULL; i++) {
        safe_set_double(lg, schema, tint_keys[i], tint);
    }

    /* Global Liquid Glass physical shader optics */
    safe_set_int(lg, schema, "glass-shape-type", state.liquid_shape);
    safe_set_double(lg, schema, "glass-displacement-scale", disp_scale);
    safe_set_double(lg, schema, "glass-ior", ior);
    safe_set_double(lg, schema, "glass-chroma-strength", chroma);
    safe_set_double(lg, schema, "glass-rim-intensity", rim);
    safe_set_double(lg, schema, "glass-specular-intensity", specular);

    /* Preserve Dock configuration (from Dock group) - do not stomp with liquid_* values */
    safe_set_int(lg, schema, "dock-blur-radius", state.dock_blur);
    double dock_tint_val = (double)state.dock_tint / 100.0;
    if (dock_tint_val < 0.0) dock_tint_val = 0.0;
    if (dock_tint_val > 1.0) dock_tint_val = 1.0;
    safe_set_double(lg, schema, "dock-tint-strength", dock_tint_val);
    double dock_brightness = is_light ? (1.0 + (dock_tint_val * 0.25)) : (1.0 - (dock_tint_val * 0.5));
    if (dock_brightness < 0.2) dock_brightness = 0.2;
    if (dock_brightness > 1.25) dock_brightness = 1.25;
    safe_set_double(lg, schema, "dock-brightness", dock_brightness);
    safe_set_string(lg, schema, "dock-tint-color", dock_col);

    /* Preserve Context Menu configuration (from Group 4) - do not stomp with liquid_* values */
    int menu_radius = (state.menu_blur > 0) ? (int)round((double)state.menu_blur * 30.0 / 100.0) : 0;
    if (state.menu_blur > 0 && menu_radius < 1) menu_radius = 1;
    safe_set_int(lg, schema, "menu-blur-radius", menu_radius);
    safe_set_int(lg, schema, "desktop-menu-blur-radius", menu_radius);
    safe_set_int(lg, schema, "panel-menu-blur-radius", menu_radius);

    double menu_tint_val = (double)state.menu_tint / 100.0;
    double menu_brightness = is_light ? (1.0 + (menu_tint_val * 0.25)) : (1.0 - (menu_tint_val * 0.5));
    if (menu_brightness < 0.2) menu_brightness = 0.2;
    if (menu_brightness > 1.25) menu_brightness = 1.25;
    safe_set_double(lg, schema, "menu-tint-strength", menu_tint_val);
    safe_set_double(lg, schema, "desktop-menu-tint-strength", menu_tint_val);
    safe_set_double(lg, schema, "panel-menu-tint-strength", menu_tint_val);
    safe_set_double(lg, schema, "menu-brightness", menu_brightness);
    safe_set_double(lg, schema, "desktop-menu-brightness", menu_brightness);
    safe_set_double(lg, schema, "panel-menu-brightness", menu_brightness);

    safe_set_string(lg, schema, "menu-tint-color", tint_col);
    safe_set_string(lg, schema, "desktop-menu-tint-color", tint_col);
    safe_set_string(lg, schema, "panel-menu-tint-color", tint_col);
    safe_set_string(lg, schema, "quick-settings-tint-color", tint_col);
    safe_set_string(lg, schema, "osd-tint-color", tint_col);
    safe_set_string(lg, schema, "notification-tint-color", tint_col);
    safe_set_string(lg, schema, "application-tint-color", tint_col);

    double menu_shadow_rad = (double)state.menu_shadow_blur;
    safe_set_double(lg, schema, "shadow-radius", menu_shadow_rad);

    double dock_shadow_int = (double)state.dock_shadow / 100.0;
    if (dock_shadow_int < 0.0) dock_shadow_int = 0.0;
    if (dock_shadow_int > 1.0) dock_shadow_int = 1.0;
    safe_set_double(lg, schema, "shadow-intensity", dock_shadow_int);

    if (schema) g_settings_schema_unref(schema);
    g_object_unref(lg);

    /* Preserve desktop widgets configuration (from Group 5) */
    apply_widget_settings();

    /* Preserve dock configuration (from Dock group) */
    apply_dock_settings();
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

static void apply_spotlight_settings(void) {
    save_styling_json();
    /* Notify GNOME Shell via D-Bus to reload spotlight styling in real-time */
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (bus) {
        g_dbus_connection_call(bus,
            "org.gnome.Shell",
            "/org/gnome/Shell/Extensions/EvalHelper",
            "org.gnome.Shell.Extensions.EvalHelper",
            "SyncSpotlightStyling",
            NULL,
            NULL,
            G_DBUS_CALL_FLAGS_NONE,
            -1,
            NULL,
            NULL,
            NULL);
        g_object_unref(bus);
    }
}

static gboolean apply_spotlight_cb(gpointer user_data) {
    (void)user_data;
    spotlight_timer_id = 0;
    apply_spotlight_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_spotlight_apply(void) {
    if (spotlight_timer_id != 0) {
        g_source_remove(spotlight_timer_id);
        spotlight_timer_id = 0;
    }
    spotlight_timer_id = g_timeout_add(50, (GSourceFunc)apply_spotlight_cb, NULL);
}

static guint dock_timer_id = 0;
static guint alert_timer_id = 0;

static void apply_alert_settings(void) {
    /* Notify GNOME Shell via D-Bus to reload alert styling in real-time */
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (bus) {
        g_dbus_connection_call(bus,
            "org.gnome.Shell",
            "/org/gnome/Shell/Extensions/EvalHelper",
            "org.gnome.Shell.Extensions.EvalHelper",
            "SyncAlertStyling",
            NULL,
            NULL,
            G_DBUS_CALL_FLAGS_NONE,
            -1,
            NULL,
            NULL,
            NULL);
        g_object_unref(bus);
    }
}

static gboolean apply_alert_cb(gpointer user_data) {
    (void)user_data;
    alert_timer_id = 0;
    apply_alert_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_alert_apply(void) {
    if (alert_timer_id != 0) {
        g_source_remove(alert_timer_id);
        alert_timer_id = 0;
    }
    alert_timer_id = g_timeout_add(50, (GSourceFunc)apply_alert_cb, NULL);
}

static guint notif_timer_id = 0;

static void apply_notification_settings(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (src) {
        const char *lg_schema = "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com";
        if (g_settings_schema_source_lookup(src, lg_schema, TRUE)) {
            GSettings *lg = g_settings_new(lg_schema);
            if (lg) {
                GSettingsSchema *schema = NULL;
                g_object_get(lg, "settings-schema", &schema, NULL);

                int blur_rad = state.notification_blur;
                if (blur_rad < 0) blur_rad = 0;
                if (blur_rad > 50) blur_rad = 50;
                safe_set_int(lg, schema, "notification-blur-radius", blur_rad);

                double tint_val = (double)state.notification_tint / 100.0;
                if (tint_val < 0.0) tint_val = 0.0;
                if (tint_val > 1.0) tint_val = 1.0;
                safe_set_double(lg, schema, "notification-tint-strength", tint_val);

                if (schema) g_settings_schema_unref(schema);
                g_object_unref(lg);
            }
        }
    }

    /* Notify GNOME Shell via D-Bus to reload notification styling in real-time */
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (bus) {
        g_dbus_connection_call(bus,
            "org.gnome.Shell",
            "/org/gnome/Shell/Extensions/EvalHelper",
            "org.gnome.Shell.Extensions.EvalHelper",
            "SyncNotificationStyling",
            NULL,
            NULL,
            G_DBUS_CALL_FLAGS_NONE,
            -1,
            NULL,
            NULL,
            NULL);
        g_object_unref(bus);
    }
}

static gboolean apply_notif_cb(gpointer user_data) {
    (void)user_data;
    notif_timer_id = 0;
    apply_notification_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_notification_apply(void) {
    if (notif_timer_id != 0) {
        g_source_remove(notif_timer_id);
        notif_timer_id = 0;
    }
    notif_timer_id = g_timeout_add(50, (GSourceFunc)apply_notif_cb, NULL);
}

static void apply_dock_settings(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    gboolean is_light = mac_is_light_mode();

    /* 1. Apply to Liquid Glass */
    const char *lg_schema = "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com";
    if (g_settings_schema_source_lookup(src, lg_schema, TRUE)) {
        GSettings *lg = g_settings_new(lg_schema);
        if (lg) {
            GSettingsSchema *schema = NULL;
            g_object_get(lg, "settings-schema", &schema, NULL);

            int blur_rad = state.dock_blur;
            if (blur_rad < 0) blur_rad = 0;
            if (blur_rad > 50) blur_rad = 50;
            safe_set_int(lg, schema, "dock-blur-radius", blur_rad);

            const char *dock_col = is_light ? "#ffffff" : "#29292e";

            double tint_val = (double)state.dock_tint / 100.0;
            if (tint_val < 0.0) tint_val = 0.0;
            if (tint_val > 1.0) tint_val = 1.0;
            safe_set_double(lg, schema, "dock-tint-strength", tint_val);

            double brightness = is_light ? (1.0 + (tint_val * 0.25)) : (1.0 - (tint_val * 0.5));
            if (brightness < 0.2) brightness = 0.2;
            if (brightness > 1.25) brightness = 1.25;
            safe_set_double(lg, schema, "dock-brightness", brightness);
            safe_set_string(lg, schema, "dock-tint-color", dock_col);

            double shadow_val = (double)state.dock_shadow / 100.0;
            if (shadow_val < 0.0) shadow_val = 0.0;
            if (shadow_val > 1.0) shadow_val = 1.0;
            safe_set_double(lg, schema, "shadow-intensity", shadow_val);

            if (schema) g_settings_schema_unref(schema);
            g_object_unref(lg);
        }
    }

    /* 2. Apply to blur-my-shell dash-to-dock */
    const char *bms_dock_schema = "org.gnome.shell.extensions.blur-my-shell.dash-to-dock";
    if (g_settings_schema_source_lookup(src, bms_dock_schema, TRUE)) {
        GSettings *bms = g_settings_new(bms_dock_schema);
        if (bms) {
            GSettingsSchema *schema = NULL;
            g_object_get(bms, "settings-schema", &schema, NULL);

            int sigma = state.dock_blur;
            if (sigma < 0) sigma = 0;
            safe_set_int(bms, schema, "sigma", sigma);

            double tint_val = (double)state.dock_tint / 100.0;
            double brightness = is_light ? (1.0 + (tint_val * 0.25)) : (1.0 - (tint_val * 0.5));
            if (brightness < 0.2) brightness = 0.2;
            if (brightness > 1.25) brightness = 1.25;
            safe_set_double(bms, schema, "brightness", brightness);

            if (schema) g_settings_schema_unref(schema);
            g_object_unref(bms);
        }
    }
}

static gboolean apply_dock_cb(gpointer user_data) {
    (void)user_data;
    dock_timer_id = 0;
    apply_dock_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_dock_apply(void) {
    if (dock_timer_id != 0) {
        g_source_remove(dock_timer_id);
        dock_timer_id = 0;
    }
    dock_timer_id = g_timeout_add(50, (GSourceFunc)apply_dock_cb, NULL);
}

static guint label_timer_id = 0;

static void apply_label_settings(void) {
    save_styling_json();
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (bus) {
        g_dbus_connection_call(bus,
            "org.gnome.Shell",
            "/org/gnome/Shell/Extensions/EvalHelper",
            "org.gnome.Shell.Extensions.EvalHelper",
            "SyncLabelStyling",
            NULL, NULL, G_DBUS_CALL_FLAGS_NONE, -1, NULL, NULL, NULL);
        g_object_unref(bus);
    }
}

static gboolean apply_label_cb(gpointer user_data) {
    (void)user_data;
    label_timer_id = 0;
    apply_label_settings();
    return G_SOURCE_REMOVE;
}

static void schedule_label_apply(void) {
    if (label_timer_id != 0) {
        g_source_remove(label_timer_id);
        label_timer_id = 0;
    }
    label_timer_id = g_timeout_add(50, (GSourceFunc)apply_label_cb, NULL);
}

static void apply_widget_settings(void) {
    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (!src) return;

    const char *schema_id = "org.gnome.shell.extensions.desktop-widgets-r3nhick";
    if (!g_settings_schema_source_lookup(src, schema_id, TRUE)) return;

    GSettings *dw = g_settings_new(schema_id);
    if (!dw) return;

    g_settings_set_int(dw, "style-border-radius", state.widget_radius);
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

    gboolean is_light = mac_is_light_mode();
    double tint = (double)state.blur_tint / 100.0;
    double brightness = is_light ? (1.0 + (tint * 0.25)) : (1.0 - (tint * 0.5));
    if (brightness < 0.2) brightness = 0.2;
    if (brightness > 1.25) brightness = 1.25;

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

    gboolean is_light = mac_is_light_mode();
    const char *tint_col = is_light ? "#ffffff" : "#000000";
    double tint = (double)state.menu_tint / 100.0;
    double brightness = is_light ? (1.0 + (tint * 0.25)) : (1.0 - (tint * 0.5));
    if (brightness < 0.2) brightness = 0.2;
    if (brightness > 1.25) brightness = 1.25;

    if (g_settings_schema_source_lookup(src, "org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com", TRUE)) {
        GSettings *lg = g_settings_new("org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com");
        g_settings_set_string(lg, "menu-tint-color", tint_col);
        g_settings_set_string(lg, "desktop-menu-tint-color", tint_col);
        g_settings_set_string(lg, "panel-menu-tint-color", tint_col);
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
    redraw_menubar_preview();
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
    redraw_menubar_preview();
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

static void get_system_accent_color(double *r, double *g, double *b) {
    *r = 1.0; *g = 0.416; *b = 0.0; /* default mac accent #ff6a00 */
    AdwStyleManager *sm = adw_style_manager_get_default();
    if (sm) {
        const GdkRGBA *sm_rgba = adw_style_manager_get_accent_color_rgba(sm);
        if (sm_rgba) {
            *r = sm_rgba->red;
            *g = sm_rgba->green;
            *b = sm_rgba->blue;
        }
    }
}

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

#define WALLPAPER_CACHE_SIZE 64
typedef struct {
    int w;
    int h;
    cairo_surface_t *surf;
} WallpaperCacheEntry;

static WallpaperCacheEntry g_wallpaper_cache[WALLPAPER_CACHE_SIZE] = {{0}};
static int g_wallpaper_cache_count = 0;
static GdkPixbuf *g_master_wallpaper_pb = NULL;
static char *g_wallpaper_cached_path = NULL;
static gint64 g_wallpaper_cached_mtime = 0;
static GMutex g_wallpaper_mutex;

static void clear_wallpaper_cache_unlocked(void) {
    for (int i = 0; i < g_wallpaper_cache_count; i++) {
        if (g_wallpaper_cache[i].surf) {
            cairo_surface_destroy(g_wallpaper_cache[i].surf);
            g_wallpaper_cache[i].surf = NULL;
        }
    }
    g_wallpaper_cache_count = 0;
    if (g_master_wallpaper_pb) {
        g_object_unref(g_master_wallpaper_pb);
        g_master_wallpaper_pb = NULL;
    }
    if (g_wallpaper_cached_path) {
        g_free(g_wallpaper_cached_path);
        g_wallpaper_cached_path = NULL;
    }
    g_wallpaper_cached_mtime = 0;
    clear_blurred_wallpaper_cache();
}

static void clear_wallpaper_cache(void) {
    g_mutex_lock(&g_wallpaper_mutex);
    clear_wallpaper_cache_unlocked();
    g_mutex_unlock(&g_wallpaper_mutex);
}

static void free_pixbuf_data(guchar *pixels, gpointer data) {
    (void)data;
    g_free(pixels);
}

static void ensure_master_wallpaper_pixbuf_unlocked(void) {
    char *path = get_user_wallpaper_path();
    if (!path) return;

    struct stat st;
    gint64 mtime = 0;
    if (stat(path, &st) == 0) {
        mtime = (gint64)st.st_mtime;
    }

    if (g_master_wallpaper_pb && g_wallpaper_cached_path &&
        strcmp(g_wallpaper_cached_path, path) == 0 &&
        g_wallpaper_cached_mtime == mtime) {
        g_free(path);
        return;
    }

    clear_wallpaper_cache_unlocked();

    g_wallpaper_cached_path = g_strdup(path);
    g_wallpaper_cached_mtime = mtime;

    const char *cache_dir = g_get_user_cache_dir();
    char *mactheme_dir = g_build_filename(cache_dir, "mactheme", NULL);
    g_mkdir_with_parents(mactheme_dir, 0755);

    typedef struct {
        uint32_t magic;       /* 0x4D414357 = 'MACW' */
        uint32_t version;     /* 1 */
        int32_t  width;
        int32_t  height;
        int32_t  rowstride;
        int32_t  n_channels;
    } MacWpThumbHeader;

    guint path_hash = g_str_hash(path);
    char *thumb_path = g_strdup_printf("%s/wp_%08x_%lx.raw", mactheme_dir, path_hash, (gulong)mtime);

    FILE *f_in = fopen(thumb_path, "rb");
    if (f_in) {
        MacWpThumbHeader hdr;
        if (fread(&hdr, sizeof(hdr), 1, f_in) == 1 &&
            hdr.magic == 0x4D414357 && hdr.version == 1 &&
            hdr.width > 0 && hdr.height > 0 &&
            hdr.n_channels >= 3 && hdr.rowstride >= hdr.width * hdr.n_channels) {
            size_t pixel_bytes = (size_t)hdr.height * hdr.rowstride;
            guchar *pixels = (guchar *)g_try_malloc(pixel_bytes);
            if (pixels && fread(pixels, pixel_bytes, 1, f_in) == 1) {
                g_master_wallpaper_pb = gdk_pixbuf_new_from_data(
                    pixels, GDK_COLORSPACE_RGB, (hdr.n_channels == 4),
                    8, hdr.width, hdr.height, hdr.rowstride,
                    free_pixbuf_data, NULL
                );
            } else if (pixels) {
                g_free(pixels);
            }
        }
        fclose(f_in);
    }

    if (!g_master_wallpaper_pb) {
        GError *err = NULL;
        g_master_wallpaper_pb = gdk_pixbuf_new_from_file_at_scale(path, 1024, -1, TRUE, &err);
        if (g_master_wallpaper_pb) {
            FILE *f_out = fopen(thumb_path, "wb");
            if (f_out) {
                MacWpThumbHeader hdr = {
                    .magic = 0x4D414357,
                    .version = 1,
                    .width = gdk_pixbuf_get_width(g_master_wallpaper_pb),
                    .height = gdk_pixbuf_get_height(g_master_wallpaper_pb),
                    .rowstride = gdk_pixbuf_get_rowstride(g_master_wallpaper_pb),
                    .n_channels = gdk_pixbuf_get_n_channels(g_master_wallpaper_pb)
                };
                fwrite(&hdr, sizeof(hdr), 1, f_out);
                fwrite(gdk_pixbuf_get_pixels(g_master_wallpaper_pb),
                       (size_t)hdr.height * hdr.rowstride, 1, f_out);
                fclose(f_out);
            }
        } else {
            if (err) g_error_free(err);
        }
    }

    g_free(thumb_path);
    g_free(mactheme_dir);
    g_free(path);
}

static gpointer preload_wallpaper_worker(gpointer data) {
    (void)data;
    g_mutex_lock(&g_wallpaper_mutex);
    ensure_master_wallpaper_pixbuf_unlocked();
    g_mutex_unlock(&g_wallpaper_mutex);
    return NULL;
}

static void on_bg_picture_changed(GSettings *settings, const gchar *key, gpointer user_data) {
    (void)settings; (void)key; (void)user_data;
    clear_wallpaper_cache();
    g_thread_new("mac-wp-reload", preload_wallpaper_worker, NULL);
}

static gboolean g_wallpaper_preload_started = FALSE;
static void start_wallpaper_preload(void) {
    if (g_wallpaper_preload_started) return;
    g_wallpaper_preload_started = TRUE;

    GSettingsSchemaSource *src = g_settings_schema_source_get_default();
    if (src && g_settings_schema_source_lookup(src, "org.gnome.desktop.background", TRUE)) {
        GSettings *bg = g_settings_new("org.gnome.desktop.background");
        g_signal_connect(bg, "changed::picture-uri-dark", G_CALLBACK(on_bg_picture_changed), NULL);
        g_signal_connect(bg, "changed::picture-uri", G_CALLBACK(on_bg_picture_changed), NULL);
    }

    g_thread_new("mac-wp-preload", preload_wallpaper_worker, NULL);
}

static cairo_surface_t *get_cached_wallpaper_surface(int target_w, int target_h) {
    if (target_w <= 0 || target_h <= 0) return NULL;

    g_mutex_lock(&g_wallpaper_mutex);

    /* Check if already in cache */
    for (int i = 0; i < g_wallpaper_cache_count; i++) {
        if (g_wallpaper_cache[i].w == target_w && g_wallpaper_cache[i].h == target_h && g_wallpaper_cache[i].surf) {
            cairo_surface_t *surf = g_wallpaper_cache[i].surf;
            g_mutex_unlock(&g_wallpaper_mutex);
            return surf;
        }
    }

    ensure_master_wallpaper_pixbuf_unlocked();
    if (!g_master_wallpaper_pb) {
        g_mutex_unlock(&g_wallpaper_mutex);
        return NULL;
    }

    int pw = gdk_pixbuf_get_width(g_master_wallpaper_pb);
    int ph = gdk_pixbuf_get_height(g_master_wallpaper_pb);
    if (pw <= 0 || ph <= 0) {
        g_mutex_unlock(&g_wallpaper_mutex);
        return NULL;
    }

    double scale_w = (double)target_w / (double)pw;
    double scale_h = (double)target_h / (double)ph;
    double scale = (scale_w > scale_h) ? scale_w : scale_h;
    int scaled_w = (int)ceil((double)pw * scale);
    int scaled_h = (int)ceil((double)ph * scale);

    GdkPixbuf *scaled = gdk_pixbuf_scale_simple(g_master_wallpaper_pb, scaled_w, scaled_h, GDK_INTERP_BILINEAR);
    if (!scaled) {
        g_mutex_unlock(&g_wallpaper_mutex);
        return NULL;
    }

    int crop_x = CLAMP((scaled_w - target_w) / 2, 0, scaled_w - target_w);
    int crop_y = CLAMP((scaled_h - target_h) / 2, 0, scaled_h - target_h);
    GdkPixbuf *cropped = gdk_pixbuf_new_subpixbuf(scaled, crop_x, crop_y, target_w, target_h);

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
    g_object_unref(scaled);

    /* Store in cache */
    if (g_wallpaper_cache_count >= WALLPAPER_CACHE_SIZE) {
        if (g_wallpaper_cache[0].surf) {
            cairo_surface_destroy(g_wallpaper_cache[0].surf);
        }
        for (int i = 0; i < WALLPAPER_CACHE_SIZE - 1; i++) {
            g_wallpaper_cache[i] = g_wallpaper_cache[i + 1];
        }
        g_wallpaper_cache_count = WALLPAPER_CACHE_SIZE - 1;
    }

    g_wallpaper_cache[g_wallpaper_cache_count].w = target_w;
    g_wallpaper_cache[g_wallpaper_cache_count].h = target_h;
    g_wallpaper_cache[g_wallpaper_cache_count].surf = surf;
    g_wallpaper_cache_count++;

    g_mutex_unlock(&g_wallpaper_mutex);
    return surf;
}

/* ========================================================================= */
/* Fast Multi-Pass Separable Box Blur Engine & Blurred Wallpaper Cache       */
/* ========================================================================= */

static void box_blur_horizontal(uint32_t *src, uint32_t *dst, int w, int h, int r) {
    if (r <= 0) { memcpy(dst, src, (size_t)w * h * sizeof(uint32_t)); return; }
    if (r > w / 2) r = w / 2;
    float iarr = 1.0f / (r + r + 1);
    for (int y = 0; y < h; y++) {
        int ti = y * w, li = ti, ri = ti + r;
        uint32_t fv = src[ti], lv = src[ti + w - 1];
        int val_a = ((fv >> 24) & 0xff) * (r + 1);
        int val_r = ((fv >> 16) & 0xff) * (r + 1);
        int val_g = ((fv >> 8) & 0xff) * (r + 1);
        int val_b = (fv & 0xff) * (r + 1);
        for (int j = 0; j < r; j++) {
            uint32_t c = src[ti + j];
            val_a += (c >> 24) & 0xff; val_r += (c >> 16) & 0xff;
            val_g += (c >> 8) & 0xff; val_b += c & 0xff;
        }
        for (int j = 0; j <= r; j++) {
            uint32_t c = src[ri++];
            val_a += (c >> 24) & 0xff; val_r += (c >> 16) & 0xff;
            val_g += (c >> 8) & 0xff; val_b += c & 0xff;
            dst[ti++] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
            val_a -= (fv >> 24) & 0xff; val_r -= (fv >> 16) & 0xff;
            val_g -= (fv >> 8) & 0xff; val_b -= fv & 0xff;
        }
        for (int j = r + 1; j < w - r; j++) {
            uint32_t c1 = src[ri++], c2 = src[li++];
            val_a += ((c1 >> 24) & 0xff) - ((c2 >> 24) & 0xff);
            val_r += ((c1 >> 16) & 0xff) - ((c2 >> 16) & 0xff);
            val_g += ((c1 >> 8) & 0xff) - ((c2 >> 8) & 0xff);
            val_b += (c1 & 0xff) - (c2 & 0xff);
            dst[ti++] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
        }
        for (int j = w - r; j < w; j++) {
            uint32_t c = src[li++];
            val_a += ((lv >> 24) & 0xff) - ((c >> 24) & 0xff);
            val_r += ((lv >> 16) & 0xff) - ((c >> 16) & 0xff);
            val_g += ((lv >> 8) & 0xff) - ((c >> 8) & 0xff);
            val_b += (lv & 0xff) - (c & 0xff);
            dst[ti++] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
        }
    }
}

static void box_blur_vertical(uint32_t *src, uint32_t *dst, int w, int h, int r) {
    if (r <= 0) { memcpy(dst, src, (size_t)w * h * sizeof(uint32_t)); return; }
    if (r > h / 2) r = h / 2;
    float iarr = 1.0f / (r + r + 1);
    for (int x = 0; x < w; x++) {
        int ti = x, li = ti, ri = ti + r * w;
        uint32_t fv = src[ti], lv = src[ti + (h - 1) * w];
        int val_a = ((fv >> 24) & 0xff) * (r + 1);
        int val_r = ((fv >> 16) & 0xff) * (r + 1);
        int val_g = ((fv >> 8) & 0xff) * (r + 1);
        int val_b = (fv & 0xff) * (r + 1);
        for (int j = 0; j < r; j++) {
            uint32_t c = src[ti + j * w];
            val_a += (c >> 24) & 0xff; val_r += (c >> 16) & 0xff;
            val_g += (c >> 8) & 0xff; val_b += c & 0xff;
        }
        for (int j = 0; j <= r; j++) {
            uint32_t c = src[ri]; ri += w;
            val_a += (c >> 24) & 0xff; val_r += (c >> 16) & 0xff;
            val_g += (c >> 8) & 0xff; val_b += c & 0xff;
            dst[ti] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
            ti += w;
            val_a -= (fv >> 24) & 0xff; val_r -= (fv >> 16) & 0xff;
            val_g -= (fv >> 8) & 0xff; val_b -= fv & 0xff;
        }
        for (int j = r + 1; j < h - r; j++) {
            uint32_t c1 = src[ri], c2 = src[li]; ri += w; li += w;
            val_a += ((c1 >> 24) & 0xff) - ((c2 >> 24) & 0xff);
            val_r += ((c1 >> 16) & 0xff) - ((c2 >> 16) & 0xff);
            val_g += ((c1 >> 8) & 0xff) - ((c2 >> 8) & 0xff);
            val_b += (c1 & 0xff) - (c2 & 0xff);
            dst[ti] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
            ti += w;
        }
        for (int j = h - r; j < h; j++) {
            uint32_t c = src[li]; li += w;
            val_a += ((lv >> 24) & 0xff) - ((c >> 24) & 0xff);
            val_r += ((lv >> 16) & 0xff) - ((c >> 16) & 0xff);
            val_g += ((lv >> 8) & 0xff) - ((c >> 8) & 0xff);
            val_b += (lv & 0xff) - (c & 0xff);
            dst[ti] = (((int)(val_a * iarr)) << 24) | (((int)(val_r * iarr)) << 16) | (((int)(val_g * iarr)) << 8) | ((int)(val_b * iarr));
            ti += w;
        }
    }
}

#define BLURRED_WALLPAPER_CACHE_SIZE 64
typedef struct {
    int w;
    int h;
    int radius;
    cairo_surface_t *surf;
} BlurredWallpaperCacheEntry;

static BlurredWallpaperCacheEntry g_blurred_wallpaper_cache[BLURRED_WALLPAPER_CACHE_SIZE] = {{0}};
static int g_blurred_wallpaper_cache_count = 0;

static void clear_blurred_wallpaper_cache(void) {
    for (int i = 0; i < g_blurred_wallpaper_cache_count; i++) {
        if (g_blurred_wallpaper_cache[i].surf) {
            cairo_surface_destroy(g_blurred_wallpaper_cache[i].surf);
            g_blurred_wallpaper_cache[i].surf = NULL;
        }
    }
    g_blurred_wallpaper_cache_count = 0;
}

static cairo_surface_t *get_cached_blurred_wallpaper_surface(int target_w, int target_h, int radius) {
    if (target_w <= 0 || target_h <= 0) return NULL;
    int r = CLAMP(radius, 1, 60);

    for (int i = 0; i < g_blurred_wallpaper_cache_count; i++) {
        if (g_blurred_wallpaper_cache[i].w == target_w &&
            g_blurred_wallpaper_cache[i].h == target_h &&
            g_blurred_wallpaper_cache[i].radius == r &&
            g_blurred_wallpaper_cache[i].surf) {
            return g_blurred_wallpaper_cache[i].surf;
        }
    }

    cairo_surface_t *base = get_cached_wallpaper_surface(target_w, target_h);
    if (!base) return NULL;

    cairo_surface_flush(base);
    int s_stride = cairo_image_surface_get_stride(base);
    unsigned char *s_data = cairo_image_surface_get_data(base);
    if (!s_data) return NULL;

    uint32_t *buf1 = (uint32_t *)g_malloc((size_t)target_w * target_h * sizeof(uint32_t));
    uint32_t *buf2 = (uint32_t *)g_malloc((size_t)target_w * target_h * sizeof(uint32_t));

    for (int y = 0; y < target_h; y++) {
        memcpy(buf1 + y * target_w, s_data + y * s_stride, (size_t)target_w * sizeof(uint32_t));
    }

    // Pass 1
    box_blur_horizontal(buf1, buf2, target_w, target_h, r);
    box_blur_vertical(buf2, buf1, target_w, target_h, r);

    // Pass 2 for smooth Gaussian roll-off
    int r2 = (int)(r * 0.7);
    if (r2 > 0) {
        box_blur_horizontal(buf1, buf2, target_w, target_h, r2);
        box_blur_vertical(buf2, buf1, target_w, target_h, r2);
    }

    cairo_surface_t *blurred = cairo_image_surface_create(CAIRO_FORMAT_RGB24, target_w, target_h);
    cairo_surface_flush(blurred);
    unsigned char *b_data = cairo_image_surface_get_data(blurred);
    int b_stride = cairo_image_surface_get_stride(blurred);

    for (int y = 0; y < target_h; y++) {
        memcpy(b_data + y * b_stride, buf1 + y * target_w, (size_t)target_w * sizeof(uint32_t));
    }
    cairo_surface_mark_dirty(blurred);

    g_free(buf1);
    g_free(buf2);

    if (g_blurred_wallpaper_cache_count >= BLURRED_WALLPAPER_CACHE_SIZE) {
        if (g_blurred_wallpaper_cache[0].surf) {
            cairo_surface_destroy(g_blurred_wallpaper_cache[0].surf);
        }
        for (int i = 0; i < BLURRED_WALLPAPER_CACHE_SIZE - 1; i++) {
            g_blurred_wallpaper_cache[i] = g_blurred_wallpaper_cache[i + 1];
        }
        g_blurred_wallpaper_cache_count = BLURRED_WALLPAPER_CACHE_SIZE - 1;
    }

    g_blurred_wallpaper_cache[g_blurred_wallpaper_cache_count].w = target_w;
    g_blurred_wallpaper_cache[g_blurred_wallpaper_cache_count].h = target_h;
    g_blurred_wallpaper_cache[g_blurred_wallpaper_cache_count].radius = r;
    g_blurred_wallpaper_cache[g_blurred_wallpaper_cache_count].surf = blurred;
    g_blurred_wallpaper_cache_count++;

    return blurred;
}

static void draw_frosted_glass_card(cairo_t *cr, cairo_surface_t *blurred_bg,
                                    double x, double y, double w, double h, double r,
                                    double tint_alpha, double shadow_alpha, double sheen) {
    if (w <= 0.0 || h <= 0.0) return;

    // 1. Soft multi-pass drop shadow behind the card
    if (shadow_alpha > 0.01) {
        for (int i = 5; i >= 1; i--) {
            double exp = i * 2.5;
            double a = (shadow_alpha * 0.16) / i;
            draw_rounded_rect_path(cr, x - exp * 0.5, y + 2.0 + exp * 0.5, w + exp, h + exp * 0.8, r + exp * 0.5);
            cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, a);
            cairo_fill(cr);
        }
    }

    // 2. Clip card shape to paint blurred wallpaper
    cairo_save(cr);
    draw_rounded_rect_path(cr, x, y, w, h, r);
    cairo_clip(cr);

    // Blurred wallpaper underneath
    if (blurred_bg) {
        cairo_set_source_surface(cr, blurred_bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.14, 0.18);
        cairo_paint(cr);
    }

    // Glass tint overlay (Reversible: bright white frosted glass in light mode, dark tint in dark mode)
    double ta = CLAMP(tint_alpha, 0.12, 0.92);
    if (mac_is_light_mode()) {
        cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, ta * 0.85);
    } else {
        cairo_set_source_rgba(cr, 0.07, 0.08, 0.11, ta);
    }
    cairo_paint(cr);

    // Top-down specular reflection / sheen
    cairo_pattern_t *pat = cairo_pattern_create_linear(x, y, x, y + h);
    double sh = CLAMP(sheen, 0.04, 0.35);
    cairo_pattern_add_color_stop_rgba(pat, 0.0, 1.0, 1.0, 1.0, sh + 0.08);
    cairo_pattern_add_color_stop_rgba(pat, 0.35, 1.0, 1.0, 1.0, sh * 0.4);
    cairo_pattern_add_color_stop_rgba(pat, 1.0, 1.0, 1.0, 1.0, 0.01);
    cairo_set_source(cr, pat);
    cairo_paint(cr);
    cairo_pattern_destroy(pat);

    cairo_restore(cr);

    // 3. Specular rim highlight border
    draw_rounded_rect_path(cr, x + 0.5, y + 0.5, w - 1.0, h - 1.0, r);
    cairo_pattern_t *rim_pat = cairo_pattern_create_linear(x, y, x + w, y + h);
    if (mac_is_light_mode()) {
        cairo_pattern_add_color_stop_rgba(rim_pat, 0.0, 1.0, 1.0, 1.0, 0.85);
        cairo_pattern_add_color_stop_rgba(rim_pat, 0.45, 1.0, 1.0, 1.0, 0.50);
        cairo_pattern_add_color_stop_rgba(rim_pat, 1.0, 1.0, 1.0, 1.0, 0.30);
    } else {
        cairo_pattern_add_color_stop_rgba(rim_pat, 0.0, 1.0, 1.0, 1.0, 0.38);
        cairo_pattern_add_color_stop_rgba(rim_pat, 0.45, 1.0, 1.0, 1.0, 0.18);
        cairo_pattern_add_color_stop_rgba(rim_pat, 1.0, 1.0, 1.0, 1.0, 0.08);
    }
    cairo_set_source(cr, rim_pat);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
    cairo_pattern_destroy(rim_pat);
}

static void reorder_group_previews_to_top(GtkWidget *widget) {
    if (!widget) return;
    if (ADW_IS_PREFERENCES_GROUP(widget)) {
        GtkWidget *outer_box = gtk_widget_get_first_child(widget);
        if (outer_box && GTK_IS_BOX(outer_box)) {
            GtkWidget *header_box = gtk_widget_get_first_child(outer_box);
            if (header_box) {
                GtkWidget *content_box = gtk_widget_get_next_sibling(header_box);
                if (content_box && GTK_IS_BOX(content_box)) {
                    GtkWidget *first = gtk_widget_get_first_child(content_box);
                    if (first && GTK_IS_LIST_BOX(first)) {
                        GtkWidget *second = gtk_widget_get_next_sibling(first);
                        if (second && GTK_IS_BOX(second)) {
                            gtk_box_reorder_child_after(GTK_BOX(content_box), second, NULL);
                        }
                    }
                }
            }
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        reorder_group_previews_to_top(child);
    }
}

typedef struct {
    const char *row_id;
    const char *title_dark_uk;
    const char *title_light_uk;
    const char *title_dark_en;
    const char *title_light_en;
} TintRowInfo;

static const TintRowInfo s_tint_rows[] = {
    { "liquid_tint_row", "Затемнення (тінт)", "Засвітлення (тінт)", "Darkening (tint)", "Lightening (tint)" },
    { "menubar_tint_row", "Затемнення градієнтне", "Засвітлення градієнтне", "Gradient darkening", "Gradient lightening" },
    { "dock_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "label_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "alert_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "notification_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "spotlight_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "blur_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "menu_tint_row", "Затемнення", "Засвітлення", "Darkening", "Lightening" },
    { "widget_tint_row", "Затемнення фону", "Засвітлення фону", "Darkening background", "Lightening background" },
    { NULL, NULL, NULL, NULL, NULL }
};

typedef struct {
    const char *group_id;
    const char *desc_dark_uk;
    const char *desc_light_uk;
    const char *desc_dark_en;
    const char *desc_light_en;
} TintGroupInfo;

static const TintGroupInfo s_tint_groups[] = {
    { "liquid_group", "Налаштування параметрів Liquid Glass (розмиття, затінення, насиченість)", "Налаштування параметрів Liquid Glass (розмиття, засвітлення, насиченість)", "Settings for Liquid Glass (blur, darkening, saturation)", "Settings for Liquid Glass (blur, lightening, saturation)" },
    { "menubar_group", "Налаштування затемнення та розмиття верхньої панелі", "Налаштування засвітлення та розмиття верхньої панелі", "Upper menubar darkening and blur settings", "Upper menubar lightening and blur settings" },
    { "dock_group", "Параметри затемнення, розмиття та тіні нижньої панелі Док", "Параметри засвітлення, розмиття та тіні нижньої панелі Док", "Dock darkening, blur and shadow settings", "Dock lightening, blur and shadow settings" },
    { "label_group", "Параметри розмиття, затемнення та тіні бірок програм док-панелі", "Параметри розмиття, засвітлення та тіні бірок програм док-панелі", "Dock label blur, darkening and shadow settings", "Dock label blur, lightening and shadow settings" },
    { "alert_group", "Параметри затемнення, розмиття та тіні діалогових вікон попереджень", "Параметри засвітлення, розмиття та тіні діалогових вікон попереджень", "Alert dialog darkening, blur and shadow settings", "Alert dialog lightening, blur and shadow settings" },
    { "notification_group", "Параметри розмиття, затемнення та тіні для сповіщень та Центру повідомлень", "Параметри розмиття, засвітлення та тіні для сповіщень та Центру повідомлень", "Notification blur, darkening and shadow settings", "Notification blur, lightening and shadow settings" },
    { "spotlight_group", "Параметри розмиття, затемнення та тіні Spotlight і Spotlight меню", "Параметри розмиття, засвітлення та тіні Spotlight і Spotlight меню", "Spotlight blur, darkening and shadow settings", "Spotlight blur, lightening and shadow settings" },
    { "blur_group", "Глобальні параметри фонового розмиття та затемнення", "Глобальні параметри фонового розмиття та засвітлення", "Global background blur and darkening settings", "Global background blur and lightening settings" },
    { "menu_group", "Глобальні параметри затемнення та розмиття контекстних меню", "Глобальні параметри засвітлення та розмиття контекстних меню", "Context menu darkening and blur settings", "Context menu lightening and blur settings" },
    { "widget_group", "Параметри заокруглення, тіні, розмиття та затемнення фону віджетів стільниці", "Параметри заокруглення, тіні, розмиття та засвітлення фону віджетів стільниці", "Desktop widget radius, shadow, blur and darkening settings", "Desktop widget radius, shadow, blur and lightening settings" },
    { NULL, NULL, NULL, NULL, NULL }
};

static void redraw_all_mac_styling_previews(void) {
    redraw_liquid_preview();
    redraw_menubar_preview();
    redraw_dock_preview();
    redraw_labels_preview();
    redraw_alerts_preview();
    redraw_notifications_preview();
    redraw_spotlight_preview();
    redraw_blur_preview();
    redraw_context_menu_preview();
    redraw_widgets_preview();
}

static void update_mac_styling_tint_labels(GtkWidget *widget, gboolean is_light) {
    if (!widget) return;
    const char *loc = mac_get_locale();
    gboolean is_uk = (loc && (strcmp(loc, "uk") == 0 || strcmp(loc, "uk_UA") == 0));

    if (GTK_IS_BUILDABLE(widget)) {
        const char *bid = gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget));
        if (bid) {
            for (int i = 0; s_tint_rows[i].row_id != NULL; i++) {
                if (g_strcmp0(bid, s_tint_rows[i].row_id) == 0 && ADW_IS_PREFERENCES_ROW(widget)) {
                    const char *target = is_light ? (is_uk ? s_tint_rows[i].title_light_uk : s_tint_rows[i].title_light_en)
                                                  : (is_uk ? s_tint_rows[i].title_dark_uk : s_tint_rows[i].title_dark_en);
                    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(widget), target);
                    break;
                }
            }
            for (int i = 0; s_tint_groups[i].group_id != NULL; i++) {
                if (g_strcmp0(bid, s_tint_groups[i].group_id) == 0 && ADW_IS_PREFERENCES_GROUP(widget)) {
                    const char *target = is_light ? (is_uk ? s_tint_groups[i].desc_light_uk : s_tint_groups[i].desc_light_en)
                                                  : (is_uk ? s_tint_groups[i].desc_dark_uk : s_tint_groups[i].desc_dark_en);
                    adw_preferences_group_set_description(ADW_PREFERENCES_GROUP(widget), target);
                    break;
                }
            }
        }
    }

    for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
        update_mac_styling_tint_labels(c, is_light);
    }
}

static void on_mac_styling_page_map(GtkWidget *widget, gpointer user_data) {
    (void)user_data;
    reorder_group_previews_to_top(widget);
    update_mac_styling_tint_labels(widget, mac_is_light_mode());
    redraw_all_mac_styling_previews();
}


static void on_liquid_drag_begin(GtkGestureDrag *gesture, double start_x, double start_y, gpointer user_data) {
    (void)gesture;
    GtkWidget *widget = GTK_WIDGET(user_data);
    int w = gtk_widget_get_width(widget);
    int h = gtk_widget_get_height(widget);
    int gw = 150, gh = 110;
    if (state.liquid_shape == 1) { gw = 116; gh = 116; }
    else if (state.liquid_shape == 2) { gw = 160; gh = 92; }

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
/* 0 = Rounded Rect, 1 = Circle, 2 = Capsule                                 */
/* ========================================================================= */

static inline double glsl_sdRoundRect(double px, double py, double bx, double by, double r) {
    double dx = fabs(px) - bx + r;
    double dy = fabs(py) - by + r;
    double max_d = fmax(dx, dy);
    double len_d = sqrt(fmax(dx, 0.0) * fmax(dx, 0.0) + fmax(dy, 0.0) * fmax(dy, 0.0));
    return fmin(max_d, 0.0) + len_d - r;
}

static inline double glsl_sdShape(double px, double py, double bx, double by, double r, int shape) {
    if (shape == 2) {
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
    if (shape == 2) {
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
    }

    if (g_glass_x < 0) {
        g_glass_x = (width - gw) / 2.0;
        g_glass_y = (height - gh) / 2.0;
    }
    double gx = CLAMP(g_glass_x, 6.0, width - gw - 6.0);
    double gy = CLAMP(g_glass_y, 6.0, height - gh - 6.0);

    // Frosted liquid glass background if liquid_blur > 0
    cairo_surface_t *bg_for_glass = bg;
    if (state.liquid_blur > 0) {
        cairo_surface_t *bl = get_cached_blurred_wallpaper_surface(width, height, CLAMP(state.liquid_blur * 2, 1, 40));
        if (bl) bg_for_glass = bl;
    }
    // Render using the physical repo shader with the active shape
    draw_repo_glass_element(cr, bg_for_glass, width, height, gx, gy, gw, gh, gr, state.liquid_shape);

    // Floating shape badge above element
    const char *shape_names[] = {
        "Заокруглений прямокутник",
        "Коло",
        "Капсула"
    };
    int shape_idx = CLAMP(state.liquid_shape, 0, 2);
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

/* ========================================================================= */
/* Live Preview: Menubar Preview                                            */
/* ========================================================================= */

static GtkWidget *g_menubar_preview_w = NULL;
static void redraw_menubar_preview(void) {
    if (g_menubar_preview_w && GTK_IS_WIDGET(g_menubar_preview_w)) {
        gtk_widget_queue_draw(g_menubar_preview_w);
    }
}

static void menubar_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    double mb_h = 28.0;
    int blur_r = CLAMP(state.menubar_blur, 6, 45);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    // Clip top bar for frosted glass
    cairo_save(cr);
    cairo_rectangle(cr, 0, 0, width, mb_h);
    cairo_clip(cr);

    if (blurred_bg) {
        cairo_set_source_surface(cr, blurred_bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.10, 0.12, 0.15);
        cairo_paint(cr);
    }

    double tint_frac = (double)state.menubar_tint / 100.0;
    double ta = CLAMP(0.25 + tint_frac * 0.60, 0.12, 0.92);
    cairo_set_source_rgba(cr, 0.06, 0.07, 0.09, ta);
    cairo_paint(cr);

    // Specular top-down gradient
    cairo_pattern_t *pat = cairo_pattern_create_linear(0, 0, 0, mb_h);
    cairo_pattern_add_color_stop_rgba(pat, 0.0, 1.0, 1.0, 1.0, 0.15);
    cairo_pattern_add_color_stop_rgba(pat, 1.0, 1.0, 1.0, 1.0, 0.02);
    cairo_set_source(cr, pat);
    cairo_paint(cr);
    cairo_pattern_destroy(pat);

    cairo_restore(cr);

    // Specular bottom border line
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.18);
    cairo_set_line_width(cr, 1.0);
    cairo_move_to(cr, 0, mb_h - 0.5);
    cairo_line_to(cr, width, mb_h - 0.5);
    cairo_stroke(cr);

    // Apple Logo 
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_arc(cr, 16.5, 14.5, 3.8, 0, 2 * G_PI);
    cairo_fill(cr);
    cairo_arc(cr, 19.5, 14.5, 3.8, 0, 2 * G_PI);
    cairo_fill(cr);
    cairo_arc(cr, 18.0, 10.5, 1.5, 0, 2 * G_PI);
    cairo_fill(cr);

    // Menus
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 10.5);
    cairo_move_to(cr, 30.0, 17.5);
    cairo_show_text(cr, "Finder");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.85);
    cairo_move_to(cr, 76.0, 17.5);
    cairo_show_text(cr, "Файл");
    cairo_move_to(cr, 114.0, 17.5);
    cairo_show_text(cr, "Редагування");
    cairo_move_to(cr, 198.0, 17.5);
    cairo_show_text(cr, "Вигляд");
    cairo_move_to(cr, 248.0, 17.5);
    cairo_show_text(cr, "Вікно");

    // Right status items
    cairo_move_to(cr, width - 110.0, 17.5);
    cairo_show_text(cr, "Пн 2 лис 14:28");

    // Wi-Fi
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.85);
    cairo_set_line_width(cr, 1.2);
    cairo_arc(cr, width - 130.0, 16.0, 5.5, -G_PI * 0.75, -G_PI * 0.25);
    cairo_stroke(cr);
    cairo_arc(cr, width - 130.0, 16.0, 3.0, -G_PI * 0.75, -G_PI * 0.25);
    cairo_stroke(cr);
    cairo_arc(cr, width - 130.0, 16.0, 1.0, 0, 2 * G_PI);
    cairo_fill(cr);

    // Battery
    double bx_b = width - 156.0, by_b = 10.5;
    draw_rounded_rect_path(cr, bx_b, by_b, 17.0, 9.0, 2.5);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
    draw_rounded_rect_path(cr, bx_b + 2.0, by_b + 2.0, 10.0, 5.0, 1.5);
    cairo_fill(cr);
    cairo_rectangle(cr, bx_b + 17.5, by_b + 2.5, 1.2, 4.0);
    cairo_fill(cr);

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_menubar_preview(void *widget, gpointer data) {
    (void)data;
    g_menubar_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), menubar_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Dock Preview                                                */
/* ========================================================================= */

static GtkWidget *g_dock_preview_w = NULL;
static void redraw_dock_preview(void) {
    if (g_dock_preview_w && GTK_IS_WIDGET(g_dock_preview_w)) {
        gtk_widget_queue_draw(g_dock_preview_w);
    }
}

static void dock_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    double dw = 264.0, dh = 56.0, dr = 18.0;
    double dx = (width - dw) / 2.0;
    double dy = height - dh - 12.0;

    int blur_r = CLAMP(state.dock_blur, 6, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.22 + ((double)state.dock_tint / 100.0) * 0.55;
    double shadow_a = ((double)state.dock_shadow / 100.0) * 0.85;

    draw_frosted_glass_card(cr, blurred_bg, dx, dy, dw, dh, dr, tint_a, shadow_a, 0.16);

    // Specular top rim line for dock shelf
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.35);
    cairo_set_line_width(cr, 1.0);
    cairo_move_to(cr, dx + dr, dy + 0.5);
    cairo_line_to(cr, dx + dw - dr, dy + 0.5);
    cairo_stroke(cr);

    double icon_sz = 34.0;
    double icon_y = dy + (dh - icon_sz) / 2.0 - 2.0;
    double start_x = dx + 14.0;
    double gap = 11.0;

    /* 1. Finder */
    double ix1 = start_x;
    draw_rounded_rect_path(cr, ix1, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgb(cr, 0.14, 0.55, 0.94);
    cairo_fill(cr);
    cairo_save(cr);
    draw_rounded_rect_path(cr, ix1, icon_y, icon_sz, icon_sz, 8.0);
    cairo_clip(cr);
    cairo_move_to(cr, ix1 + icon_sz, icon_y);
    cairo_line_to(cr, ix1 + 16.0, icon_y);
    cairo_curve_to(cr, ix1 + 14.0, icon_y + 12.0, ix1 + 18.0, icon_y + 20.0, ix1 + 17.0, icon_y + icon_sz);
    cairo_line_to(cr, ix1 + icon_sz, icon_y + icon_sz);
    cairo_close_path(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.22);
    cairo_fill(cr);
    cairo_restore(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_arc(cr, ix1 + 12.0, icon_y + 13.0, 1.5, 0, 2 * G_PI);
    cairo_fill(cr);
    cairo_arc(cr, ix1 + 22.0, icon_y + 13.0, 1.5, 0, 2 * G_PI);
    cairo_fill(cr);
    cairo_set_line_width(cr, 1.6);
    cairo_arc(cr, ix1 + 17.0, icon_y + 17.0, 7.5, 0.2 * G_PI, 0.8 * G_PI);
    cairo_stroke(cr);
    cairo_arc(cr, ix1 + icon_sz / 2.0, dy + dh - 3.5, 1.6, 0, 2 * G_PI);
    cairo_fill(cr);

    /* 2. Launchpad */
    double ix2 = ix1 + icon_sz + gap;
    draw_rounded_rect_path(cr, ix2, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgb(cr, 0.25, 0.27, 0.32);
    cairo_fill(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.90);
    for (int r = 0; r < 3; r++) {
        for (int c = 0; c < 3; c++) {
            cairo_arc(cr, ix2 + 9.0 + c * 8.0, icon_y + 9.0 + r * 8.0, 1.7, 0, 2 * G_PI);
            cairo_fill(cr);
        }
    }

    /* 3. Safari */
    double ix3 = ix2 + icon_sz + gap;
    draw_rounded_rect_path(cr, ix3, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgb(cr, 0.98, 0.98, 0.99);
    cairo_fill(cr);
    cairo_arc(cr, ix3 + icon_sz / 2.0, icon_y + icon_sz / 2.0, 13.0, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 0.12, 0.58, 0.95);
    cairo_fill(cr);
    double cx_s = ix3 + icon_sz / 2.0;
    double cy_s = icon_y + icon_sz / 2.0;
    cairo_move_to(cr, cx_s, cy_s);
    cairo_line_to(cr, cx_s + 7.5, cy_s - 7.5);
    cairo_line_to(cr, cx_s + 2.0, cy_s - 1.5);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.95, 0.22, 0.22);
    cairo_fill(cr);
    cairo_move_to(cr, cx_s, cy_s);
    cairo_line_to(cr, cx_s - 7.5, cy_s + 7.5);
    cairo_line_to(cr, cx_s - 2.0, cy_s + 1.5);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.98, 0.98, 0.98);
    cairo_fill(cr);
    cairo_arc(cr, cx_s, dy + dh - 3.5, 1.6, 0, 2 * G_PI);
    cairo_fill(cr);

    /* 4. Settings */
    double ix4 = ix3 + icon_sz + gap;
    draw_rounded_rect_path(cr, ix4, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgb(cr, 0.48, 0.50, 0.54);
    cairo_fill(cr);
    double cx_g = ix4 + icon_sz / 2.0;
    double cy_g = icon_y + icon_sz / 2.0;
    cairo_arc(cr, cx_g, cy_g, 8.5, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 0.88, 0.90, 0.92);
    cairo_fill(cr);
    cairo_arc(cr, cx_g, cy_g, 4.0, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 0.48, 0.50, 0.54);
    cairo_fill(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_arc(cr, cx_g, dy + dh - 3.5, 1.6, 0, 2 * G_PI);
    cairo_fill(cr);

    /* Separator groove */
    double sx_d = ix4 + icon_sz + 8.0;
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.16);
    cairo_set_line_width(cr, 1.0);
    cairo_move_to(cr, sx_d, icon_y + 4.0);
    cairo_line_to(cr, sx_d, icon_y + icon_sz - 4.0);
    cairo_stroke(cr);

    /* 5. Trash */
    double ix5 = sx_d + 8.0;
    draw_rounded_rect_path(cr, ix5, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.14);
    cairo_fill(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.90);
    cairo_set_line_width(cr, 1.4);
    cairo_move_to(cr, ix5 + 10.0, icon_y + 11.0);
    cairo_line_to(cr, ix5 + icon_sz - 10.0, icon_y + 11.0);
    cairo_stroke(cr);
    cairo_move_to(cr, ix5 + 11.5, icon_y + 13.0);
    cairo_line_to(cr, ix5 + 13.0, icon_y + icon_sz - 9.0);
    cairo_line_to(cr, ix5 + icon_sz - 13.0, icon_y + icon_sz - 9.0);
    cairo_line_to(cr, ix5 + icon_sz - 11.5, icon_y + 13.0);
    cairo_close_path(cr);
    cairo_stroke(cr);

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_dock_preview(void *widget, gpointer data) {
    (void)data;
    g_dock_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), dock_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Labels (Бірки) Preview                                      */
/* ========================================================================= */

static GtkWidget *g_labels_preview_w = NULL;
static void redraw_labels_preview(void) {
    if (g_labels_preview_w && GTK_IS_WIDGET(g_labels_preview_w)) {
        gtk_widget_queue_draw(g_labels_preview_w);
    }
}

static void labels_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    // 1. Wallpaper background
    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    // 2. Dock shelf at bottom
    double dw = 210.0, dh = 48.0, dr = 16.0;
    double dx = (width - dw) / 2.0;
    double dy = height - dh - 8.0;

    cairo_surface_t *dock_blur_bg = get_cached_blurred_wallpaper_surface(width, height, 25);
    draw_frosted_glass_card(cr, dock_blur_bg, dx, dy, dw, dh, dr, 0.28, 0.40, 0.16);

    double icon_sz = 34.0;
    double icon_y = dy + (dh - icon_sz) / 2.0;

    // Terminal icon (dark square with prompt)
    double icon1_x = dx + 32.0;
    draw_rounded_rect_path(cr, icon1_x, icon_y, icon_sz, icon_sz, 8.0);
    cairo_set_source_rgb(cr, 0.10, 0.10, 0.12);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, icon1_x + 0.5, icon_y + 0.5, icon_sz - 1.0, icon_sz - 1.0, 8.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.18);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
    // Terminal prompt > _
    cairo_set_source_rgb(cr, 0.20, 0.80, 0.95);
    cairo_set_line_width(cr, 2.0);
    cairo_set_line_cap(cr, CAIRO_LINE_CAP_ROUND);
    cairo_move_to(cr, icon1_x + 10.0, icon_y + 12.0);
    cairo_line_to(cr, icon1_x + 16.0, icon_y + 17.0);
    cairo_line_to(cr, icon1_x + 10.0, icon_y + 22.0);
    cairo_stroke(cr);
    cairo_move_to(cr, icon1_x + 18.0, icon_y + 22.0);
    cairo_line_to(cr, icon1_x + 24.0, icon_y + 22.0);
    cairo_stroke(cr);

    // Telegram / Messages icon (green rounded square with white speech bubble)
    double icon2_x = dx + dw - 32.0 - icon_sz;
    draw_rounded_rect_path(cr, icon2_x, icon_y, icon_sz, icon_sz, 8.0);
    cairo_pattern_t *tg_pat = cairo_pattern_create_linear(icon2_x, icon_y, icon2_x, icon_y + icon_sz);
    cairo_pattern_add_color_stop_rgb(tg_pat, 0.0, 0.40, 0.88, 0.35);
    cairo_pattern_add_color_stop_rgb(tg_pat, 1.0, 0.25, 0.78, 0.25);
    cairo_set_source(cr, tg_pat);
    cairo_fill(cr);
    cairo_pattern_destroy(tg_pat);
    draw_rounded_rect_path(cr, icon2_x + 0.5, icon_y + 0.5, icon_sz - 1.0, icon_sz - 1.0, 8.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.25);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
    // Speech bubble
    double bx = icon2_x + 9.0, by = icon_y + 9.0, bw = 17.0, bh = 14.0;
    draw_rounded_rect_path(cr, bx, by, bw, bh, 5.0);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_fill(cr);
    cairo_move_to(cr, bx + 3.0, by + bh);
    cairo_line_to(cr, bx - 1.0, by + bh + 4.0);
    cairo_line_to(cr, bx + 6.0, by + bh);
    cairo_close_path(cr);
    cairo_fill(cr);

    // Active running dot under Telegram icon
    cairo_arc(cr, icon2_x + icon_sz / 2.0, dy + dh - 3.5, 1.8, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_fill(cr);

    // 3. Dock Label Pill above Telegram icon
    double lw = 80.0, lh = 26.0, lr = 13.0;
    double lx = icon2_x + (icon_sz - lw) / 2.0;
    double ly = icon_y - lh - 11.0;

    int blur_r = CLAMP(state.label_blur, 0, 50);
    cairo_surface_t *lbl_blur_bg = (blur_r > 0) ? get_cached_blurred_wallpaper_surface(width, height, blur_r) : bg;

    double tint_a = CLAMP((double)state.label_tint / 100.0, 0.05, 0.95);
    double shadow_a = CLAMP((double)state.label_shadow / 100.0, 0.0, 1.0);

    // Draw frosted glass pill
    draw_frosted_glass_card(cr, lbl_blur_bg, lx, ly, lw, lh, lr, tint_a, shadow_a, 0.12);

    // 4. Arrow tail pointing down toward icon
    double tcx = lx + lw / 2.0;
    double ty = ly + lh;
    double halfBase = 6.0, rise = 6.0;

    // Tail shadow
    if (shadow_a > 0.05) {
        cairo_save(cr);
        cairo_move_to(cr, tcx - halfBase, ty - 0.5);
        cairo_line_to(cr, tcx + halfBase, ty - 0.5);
        cairo_line_to(cr, tcx, ty + rise);
        cairo_close_path(cr);
        cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, shadow_a * 0.35);
        cairo_fill(cr);
        cairo_restore(cr);
    }

    // Tail body (matching tint)
    cairo_move_to(cr, tcx - halfBase, ty - 0.5);
    cairo_line_to(cr, tcx + halfBase, ty - 0.5);
    cairo_line_to(cr, tcx, ty + rise);
    cairo_close_path(cr);
    cairo_set_source_rgba(cr, 0.12, 0.12, 0.14, tint_a);
    cairo_fill(cr);

    // Tail border contour
    cairo_move_to(cr, tcx - halfBase, ty - 0.5);
    cairo_line_to(cr, tcx, ty + rise);
    cairo_line_to(cr, tcx + halfBase, ty - 0.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.22);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    // 5. Label text: "Telegram"
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 12.0);
    cairo_text_extents_t te;
    cairo_text_extents(cr, "Telegram", &te);
    // Subtle text shadow
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.55);
    cairo_move_to(cr, tcx - te.width / 2.0 - te.x_bearing, ly + (lh - te.height) / 2.0 - te.y_bearing + 1.0);
    cairo_show_text(cr, "Telegram");
    // Text fill
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_move_to(cr, tcx - te.width / 2.0 - te.x_bearing, ly + (lh - te.height) / 2.0 - te.y_bearing);
    cairo_show_text(cr, "Telegram");

    // 6. Realistic mouse cursor arrow pointing at Telegram icon
    double mx = icon2_x + icon_sz / 2.0 + 4.0;
    double my = icon_y + icon_sz - 2.0;
    cairo_save(cr);
    cairo_translate(cr, mx, my);
    // Cursor shadow
    cairo_move_to(cr, 1.0, 1.0);
    cairo_line_to(cr, 1.0, 13.0);
    cairo_line_to(cr, 4.0, 10.0);
    cairo_line_to(cr, 7.0, 15.0);
    cairo_line_to(cr, 9.0, 14.0);
    cairo_line_to(cr, 6.0, 9.0);
    cairo_line_to(cr, 10.0, 9.0);
    cairo_close_path(cr);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.40);
    cairo_fill(cr);
    // Cursor white body + dark outline
    cairo_move_to(cr, 0.0, 0.0);
    cairo_line_to(cr, 0.0, 12.0);
    cairo_line_to(cr, 3.0, 9.0);
    cairo_line_to(cr, 6.0, 14.0);
    cairo_line_to(cr, 8.0, 13.0);
    cairo_line_to(cr, 5.0, 8.0);
    cairo_line_to(cr, 9.0, 8.0);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_fill_preserve(cr);
    cairo_set_source_rgb(cr, 0.15, 0.15, 0.15);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
    cairo_restore(cr);

    cairo_restore(cr);

    // Specular border on outer preview rectangle
    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_labels_preview(void *widget, gpointer data) {
    (void)data;
    g_labels_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), labels_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Alerts Preview                                              */
/* ========================================================================= */

static GtkWidget *g_alerts_preview_w = NULL;
static void redraw_alerts_preview(void) {
    if (g_alerts_preview_w && GTK_IS_WIDGET(g_alerts_preview_w)) {
        gtk_widget_queue_draw(g_alerts_preview_w);
    }
}

static void alerts_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    // Modal background darkening over wallpaper
    double tint_val = (double)state.alert_tint / 100.0;
    double backdrop_alpha = CLAMP(0.25 + tint_val * 0.50, 0.18, 0.85);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, backdrop_alpha);
    cairo_paint(cr);

    // Modal alert card
    double cw = 246.0, ch = 140.0, cr_r = 18.0;
    double cx = (width - cw) / 2.0;
    double cy = (height - ch) / 2.0;

    int blur_r = CLAMP(state.alert_blur, 6, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double shadow_a = ((double)state.alert_shadow / 100.0) * 0.90;
    double card_tint_a = 0.32 + tint_val * 0.50;

    draw_frosted_glass_card(cr, blurred_bg, cx, cy, cw, ch, cr_r, card_tint_a, shadow_a, 0.16);

    // Amber warning triangle icon (macOS Warning Badge)
    double tri_cx = cx + cw / 2.0;
    double tri_cy = cy + 24.0;
    double tri_sz = 14.0;
    cairo_move_to(cr, tri_cx, tri_cy - tri_sz);
    cairo_line_to(cr, tri_cx + tri_sz * 1.15, tri_cy + tri_sz * 0.85);
    cairo_line_to(cr, tri_cx - tri_sz * 1.15, tri_cy + tri_sz * 0.85);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.98, 0.70, 0.12);
    cairo_fill(cr);

    // Exclamation mark inside warning triangle
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 13.0);
    cairo_set_source_rgb(cr, 0.10, 0.10, 0.10);
    cairo_text_extents_t ex_w;
    cairo_text_extents(cr, "!", &ex_w);
    cairo_move_to(cr, tri_cx - ex_w.width / 2.0 - ex_w.x_bearing, tri_cy + ex_w.height / 2.0 + 1.0);
    cairo_show_text(cr, "!");

    // Title
    cairo_set_font_size(cr, 11.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.96);
    const char *title_txt = "Спорожнити Смітник?";
    cairo_text_extents(cr, title_txt, &ex_w);
    cairo_move_to(cr, cx + (cw - ex_w.width) / 2.0, cy + 54.0);
    cairo_show_text(cr, title_txt);

    // Subtitle
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 9.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.65);
    const char *sub_txt = "Цю дію неможливо скасувати.";
    cairo_text_extents(cr, sub_txt, &ex_w);
    cairo_move_to(cr, cx + (cw - ex_w.width) / 2.0, cy + 70.0);
    cairo_show_text(cr, sub_txt);

    // Button row
    double btn_y = cy + ch - 34.0;
    double btn_w = 98.0;
    double btn_h = 24.0;
    double btn_r = 7.0;

    // Cancel button
    double b1_x = cx + 16.0;
    draw_rounded_rect_path(cr, b1_x, btn_y, btn_w, btn_h, btn_r);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.14);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, b1_x + 0.5, btn_y + 0.5, btn_w - 1.0, btn_h - 1.0, btn_r);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.18);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);
    cairo_set_font_size(cr, 10.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.90);
    cairo_text_extents(cr, "Скасувати", &ex_w);
    cairo_move_to(cr, b1_x + (btn_w - ex_w.width) / 2.0, btn_y + 15.5);
    cairo_show_text(cr, "Скасувати");

    // Destructive Empty Trash button
    double b2_x = cx + cw - 16.0 - btn_w;
    draw_rounded_rect_path(cr, b2_x, btn_y, btn_w, btn_h, btn_r);
    cairo_set_source_rgb(cr, 0.88, 0.22, 0.20);
    cairo_fill(cr);
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 10.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_text_extents(cr, "Спорожнити", &ex_w);
    cairo_move_to(cr, b2_x + (btn_w - ex_w.width) / 2.0, btn_y + 15.5);
    cairo_show_text(cr, "Спорожнити");

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_alerts_preview(void *widget, gpointer data) {
    (void)data;
    g_alerts_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), alerts_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Notifications Preview                                       */
/* ========================================================================= */

static GtkWidget *g_notifications_preview_w = NULL;
static void redraw_notifications_preview(void) {
    if (g_notifications_preview_w && GTK_IS_WIDGET(g_notifications_preview_w)) {
        gtk_widget_queue_draw(g_notifications_preview_w);
    }
}

static void notifications_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    double nw = 280.0, nh = 66.0, nr = 16.0;
    double nx = (width - nw) / 2.0;
    double ny = (height - nh) / 2.0;

    int blur_r = CLAMP(state.notification_blur, 6, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.28 + ((double)state.notification_tint / 100.0) * 0.55;
    double shadow_a = ((double)state.notification_shadow / 100.0) * 0.85;

    draw_frosted_glass_card(cr, blurred_bg, nx, ny, nw, nh, nr, tint_a, shadow_a, 0.15);

    // Messages green squircle icon
    double icon_sz = 38.0;
    double ix = nx + 12.0;
    double iy = ny + (nh - icon_sz) / 2.0;
    draw_rounded_rect_path(cr, ix, iy, icon_sz, icon_sz, 9.0);
    cairo_set_source_rgb(cr, 0.19, 0.78, 0.35);
    cairo_fill(cr);
    // Speech bubble
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_arc(cr, ix + 19.0, iy + 17.5, 8.5, 0, 2 * G_PI);
    cairo_fill(cr);
    cairo_move_to(cr, ix + 14.0, iy + 21.5);
    cairo_line_to(cr, ix + 10.5, iy + 27.0);
    cairo_line_to(cr, ix + 19.0, iy + 25.0);
    cairo_close_path(cr);
    cairo_fill(cr);

    // Text content
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 10.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.96);
    cairo_move_to(cr, nx + 58.0, ny + 22.0);
    cairo_show_text(cr, "Повідомлення");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 9.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.55);
    cairo_move_to(cr, nx + 150.0, ny + 22.0);
    cairo_show_text(cr, "•  щойно");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 10.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.92);
    cairo_move_to(cr, nx + 58.0, ny + 38.0);
    cairo_show_text(cr, "Олександр");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 9.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.80);
    cairo_move_to(cr, nx + 58.0, ny + 51.0);
    cairo_show_text(cr, "Зустрінемось о 14:00 біля кав'ярні?");

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_notifications_preview(void *widget, gpointer data) {
    (void)data;
    g_notifications_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), notifications_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Spotlight Preview & Interactive Easter Egg                  */
/* ========================================================================= */

static GtkWidget *g_spotlight_preview_w = NULL;
static gboolean spotlight_input_active = FALSE;
static gboolean spotlight_easter_egg_revealed = FALSE;
static char spotlight_input_text[128] = {0};
static gboolean spotlight_cursor_visible = TRUE;
static guint spotlight_cursor_timer_id = 0;
static guint64 spotlight_last_click_time = 0;
static int spotlight_consecutive_clicks = 0;

/* Smooth Expansion / Collapse Animation Engine */
static guint spotlight_anim_tick_id = 0;
static gint64 spotlight_anim_last_time = 0;
static double spotlight_anim_current_progress = 0.0; /* 0.0 = collapsed, 1.0 = expanded */
static double spotlight_anim_target_progress = 0.0;

static void redraw_spotlight_preview(void) {
    if (g_spotlight_preview_w && GTK_IS_WIDGET(g_spotlight_preview_w)) {
        gtk_widget_queue_draw(g_spotlight_preview_w);
    }
}

static gboolean spotlight_anim_tick_cb(GtkWidget *widget G_GNUC_UNUSED,
                                       GdkFrameClock *frame_clock G_GNUC_UNUSED,
                                       gpointer user_data G_GNUC_UNUSED)
{
    if (!g_spotlight_preview_w || !GTK_IS_WIDGET(g_spotlight_preview_w)) {
        spotlight_anim_tick_id = 0;
        return G_SOURCE_REMOVE;
    }

    gint64 now = g_get_monotonic_time();
    double dt = (double)(now - spotlight_anim_last_time) / 1000000.0;
    spotlight_anim_last_time = now;
    if (dt <= 0.0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    double diff = spotlight_anim_target_progress - spotlight_anim_current_progress;
    if (fabs(diff) < 0.002) {
        spotlight_anim_current_progress = spotlight_anim_target_progress;
        int req_h = (int)lround(150.0 + spotlight_anim_current_progress * (330.0 - 150.0));
        gtk_widget_set_size_request(g_spotlight_preview_w, -1, req_h);
        spotlight_anim_tick_id = 0;
        redraw_spotlight_preview();
        return G_SOURCE_REMOVE;
    }

    /* Critically damped macOS-style fluid exponential easing */
    double speed = (spotlight_anim_target_progress > spotlight_anim_current_progress) ? 14.0 : 18.0;
    double factor = 1.0 - exp(-speed * dt);
    spotlight_anim_current_progress += diff * factor;

    int req_h = (int)lround(150.0 + spotlight_anim_current_progress * (330.0 - 150.0));
    gtk_widget_set_size_request(g_spotlight_preview_w, -1, req_h);
    redraw_spotlight_preview();

    return G_SOURCE_CONTINUE;
}

static void spotlight_start_anim(double target)
{
    spotlight_anim_target_progress = target;
    if (g_spotlight_preview_w && GTK_IS_WIDGET(g_spotlight_preview_w)) {
        if (spotlight_anim_tick_id == 0) {
            spotlight_anim_last_time = g_get_monotonic_time();
            spotlight_anim_tick_id = gtk_widget_add_tick_callback(g_spotlight_preview_w,
                                                                 spotlight_anim_tick_cb,
                                                                 NULL, NULL);
        }
    }
}

static gboolean spotlight_cursor_blink_cb(gpointer user_data) {
    (void)user_data;
    if (!spotlight_input_active || !g_spotlight_preview_w || !GTK_IS_WIDGET(g_spotlight_preview_w)) {
        spotlight_cursor_timer_id = 0;
        return G_SOURCE_REMOVE;
    }
    spotlight_cursor_visible = !spotlight_cursor_visible;
    redraw_spotlight_preview();
    return G_SOURCE_CONTINUE;
}

static void draw_safari_compass_icon(cairo_t *cr, double cx, double cy, double radius) {
    cairo_save(cr);

    // Drop shadow under Safari icon
    cairo_arc(cr, cx, cy + 1.0, radius + 0.5, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.28);
    cairo_fill(cr);

    // Outer Blue circular gradient
    cairo_pattern_t *bg_pat = cairo_pattern_create_linear(cx, cy - radius, cx, cy + radius);
    cairo_pattern_add_color_stop_rgb(bg_pat, 0.0, 0.12, 0.65, 0.98); // #1FA6FA
    cairo_pattern_add_color_stop_rgb(bg_pat, 1.0, 0.04, 0.40, 0.84); // #0A66D6
    cairo_arc(cr, cx, cy, radius, 0, 2 * G_PI);
    cairo_set_source(cr, bg_pat);
    cairo_fill(cr);
    cairo_pattern_destroy(bg_pat);

    // White rim border
    cairo_arc(cr, cx, cy, radius - 0.5, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.35);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    // Subtle compass dial ticks (12 points)
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.45);
    cairo_set_line_width(cr, 0.8);
    for (int i = 0; i < 12; i++) {
        double angle = i * (G_PI / 6.0);
        double r1 = radius - 3.2;
        double r2 = radius - 1.6;
        cairo_move_to(cr, cx + r1 * cos(angle), cy + r1 * sin(angle));
        cairo_line_to(cr, cx + r2 * cos(angle), cy + r2 * sin(angle));
        cairo_stroke(cr);
    }

    // Compass Needle rotated -45 deg (pointing North-East / 01:30)
    cairo_save(cr);
    cairo_translate(cr, cx, cy);
    cairo_rotate(cr, -G_PI / 4.0);

    double needle_len = radius - 3.0;
    double needle_w = 3.2;

    // Red half (North-East)
    cairo_move_to(cr, 0, -needle_len);
    cairo_line_to(cr, needle_w, 0);
    cairo_line_to(cr, 0, 0);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 1.0, 0.23, 0.19); // #FF3B30
    cairo_fill(cr);

    cairo_move_to(cr, 0, -needle_len);
    cairo_line_to(cr, -needle_w, 0);
    cairo_line_to(cr, 0, 0);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.90, 0.15, 0.12);
    cairo_fill(cr);

    // White half (South-West)
    cairo_move_to(cr, 0, needle_len);
    cairo_line_to(cr, needle_w, 0);
    cairo_line_to(cr, 0, 0);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.96, 0.96, 0.98);
    cairo_fill(cr);

    cairo_move_to(cr, 0, needle_len);
    cairo_line_to(cr, -needle_w, 0);
    cairo_line_to(cr, 0, 0);
    cairo_close_path(cr);
    cairo_set_source_rgb(cr, 0.82, 0.82, 0.85);
    cairo_fill(cr);

    cairo_restore(cr);

    // Center pivot
    cairo_arc(cr, cx, cy, 1.8, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_fill(cr);

    cairo_restore(cr);
}

static void on_spotlight_preview_clicked(GtkGestureClick *gesture, int n_press, double x, double y, gpointer user_data) {
    (void)gesture;
    GtkWidget *widget = GTK_WIDGET(user_data);

    // If Easter Egg is revealed or expanding and user clicked on the "esc" close badge
    if (spotlight_anim_current_progress > 0.6 && g_spotlight_preview_w && GTK_IS_WIDGET(g_spotlight_preview_w)) {
        int width = gtk_widget_get_width(g_spotlight_preview_w);
        int height = gtk_widget_get_height(g_spotlight_preview_w);
        double max_sw = CLAMP((double)width - 40.0, 360.0, 520.0);
        double sw = 290.0 + spotlight_anim_current_progress * (max_sw - 290.0);
        double sh = 46.0 + spotlight_anim_current_progress * (286.0 - 46.0);
        double sx = (width - sw) / 2.0;
        double sy = (height - sh) / 2.0;
        double esc_w = 42.0, esc_h = 20.0;
        double esc_x = sx + sw - esc_w - 14.0;
        double esc_y = sy + 15.0;
        if (x >= esc_x - 8.0 && x <= esc_x + esc_w + 8.0 && y >= esc_y - 8.0 && y <= esc_y + esc_h + 8.0) {
            spotlight_input_active = FALSE;
            spotlight_easter_egg_revealed = FALSE;
            spotlight_input_text[0] = '\0';
            spotlight_consecutive_clicks = 0;
            if (spotlight_cursor_timer_id != 0) {
                g_source_remove(spotlight_cursor_timer_id);
                spotlight_cursor_timer_id = 0;
            }
            spotlight_start_anim(0.0);
            gtk_widget_set_cursor_from_name(g_spotlight_preview_w, "default");
            return;
        }
    }

    guint64 now = g_get_monotonic_time();
    if (now - spotlight_last_click_time < 1200000) { // within 1.2s
        spotlight_consecutive_clicks++;
    } else {
        spotlight_consecutive_clicks = 1;
    }
    spotlight_last_click_time = now;

    if (n_press >= 3 || spotlight_consecutive_clicks >= 3) {
        spotlight_input_active = TRUE;
        spotlight_cursor_visible = TRUE;
        if (spotlight_cursor_timer_id == 0) {
            spotlight_cursor_timer_id = g_timeout_add(500, spotlight_cursor_blink_cb, NULL);
        }
        gtk_widget_grab_focus(widget);
        gtk_widget_set_cursor_from_name(widget, "text");
        redraw_spotlight_preview();
    } else if (spotlight_input_active) {
        gtk_widget_grab_focus(widget);
        gtk_widget_set_cursor_from_name(widget, "text");
    }
}

static gboolean on_spotlight_key_pressed(GtkEventControllerKey *controller,
                                        guint keyval,
                                        guint keycode,
                                        GdkModifierType state_mask,
                                        gpointer user_data) {
    (void)controller; (void)keycode; (void)state_mask; (void)user_data;
    if (!spotlight_input_active) return FALSE;

    if (keyval == GDK_KEY_BackSpace) {
        size_t len = strlen(spotlight_input_text);
        if (len > 0) {
            size_t i = len - 1;
            while (i > 0 && ((unsigned char)spotlight_input_text[i] & 0xC0) == 0x80) {
                i--;
            }
            spotlight_input_text[i] = '\0';
        }
        if (strcasestr(spotlight_input_text, "macw1y") != NULL ||
            strcasestr(spotlight_input_text, "ьфсц1н") != NULL) {
            if (!spotlight_easter_egg_revealed) {
                spotlight_easter_egg_revealed = TRUE;
                spotlight_start_anim(1.0);
            }
        } else {
            if (spotlight_easter_egg_revealed) {
                spotlight_easter_egg_revealed = FALSE;
                spotlight_start_anim(0.0);
            }
        }
        spotlight_cursor_visible = TRUE;
        redraw_spotlight_preview();
        return TRUE;
    } else if (keyval == GDK_KEY_Escape) {
        spotlight_input_active = FALSE;
        spotlight_easter_egg_revealed = FALSE;
        spotlight_input_text[0] = '\0';
        spotlight_consecutive_clicks = 0;
        if (spotlight_cursor_timer_id != 0) {
            g_source_remove(spotlight_cursor_timer_id);
            spotlight_cursor_timer_id = 0;
        }
        spotlight_start_anim(0.0);
        if (g_spotlight_preview_w && GTK_IS_WIDGET(g_spotlight_preview_w)) {
            gtk_widget_set_cursor_from_name(g_spotlight_preview_w, "default");
        }
        return TRUE;
    } else if (keyval == GDK_KEY_Return || keyval == GDK_KEY_KP_Enter) {
        return TRUE;
    } else {
        gunichar ch = gdk_keyval_to_unicode(keyval);
        if (ch >= 32 && ch != 0x7F) {
            char utf[8] = {0};
            int bytes = g_unichar_to_utf8(ch, utf);
            utf[bytes] = '\0';
            if (strlen(spotlight_input_text) + bytes < sizeof(spotlight_input_text) - 1) {
                strcat(spotlight_input_text, utf);
            }
            if (strcasestr(spotlight_input_text, "macw1y") != NULL ||
                strcasestr(spotlight_input_text, "ьфсц1н") != NULL) {
                if (!spotlight_easter_egg_revealed) {
                    spotlight_easter_egg_revealed = TRUE;
                    spotlight_start_anim(1.0);
                }
            }
            spotlight_cursor_visible = TRUE;
            redraw_spotlight_preview();
            return TRUE;
        }
    }
    return FALSE;
}

static void spotlight_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.22);
    cairo_paint(cr);

    int blur_r = CLAMP(state.spotlight_blur, 6, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.26 + ((double)state.spotlight_tint / 100.0) * 0.55;
    double shadow_a = ((double)state.spotlight_shadow / 100.0) * 0.85;

    double ar, ag, ab;
    get_system_accent_color(&ar, &ag, &ab);

    double p = spotlight_anim_current_progress;

    /* Animated dimensions interpolated continuously by the frame clock */
    double min_sw = 290.0, max_sw = CLAMP((double)width - 40.0, 360.0, 520.0);
    double sw = min_sw + p * (max_sw - min_sw);
    double min_sh = 46.0, max_sh = 286.0;
    double sh = min_sh + p * (max_sh - min_sh);
    double min_sr = 23.0, max_sr = 16.0;
    double sr = min_sr + p * (max_sr - min_sr);
    double sx = (width - sw) / 2.0;
    double sy = (height - sh) / 2.0;

    // Draw frosted glass card
    draw_frosted_glass_card(cr, blurred_bg, sx, sy, sw, sh, sr, tint_a, shadow_a, 0.16 + p * 0.04);
    draw_rounded_rect_path(cr, sx + 0.5, sy + 0.5, sw - 1.0, sh - 1.0, sr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12 + p * 0.10);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);

    // Magnifying glass icon (smoothly positions with card expansion)
    double icon_cx = sx + 22.0 + p * 3.0;
    double icon_cy = sy + 21.0 + p * 4.0;
    double icon_r = 6.0 + p * 1.0;
    cairo_set_source_rgb(cr, ar, ag, ab);
    cairo_set_line_width(cr, 1.8 + p * 0.2);
    cairo_arc(cr, icon_cx, icon_cy, icon_r, 0, 2 * G_PI);
    cairo_stroke(cr);
    cairo_move_to(cr, icon_cx + icon_r * 0.72, icon_cy + icon_r * 0.72);
    cairo_line_to(cr, icon_cx + icon_r * 0.72 + 4.5 + p * 1.5, icon_cy + icon_r * 0.72 + 4.5 + p * 1.5);
    cairo_stroke(cr);

    // Search input text / placeholder
    double text_x = sx + 38.0 + p * 8.0;
    double text_y = sy + 27.5 + p * 3.5;
    double font_sz = 12.0 + p * 4.0;
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, font_sz);

    if (spotlight_input_active) {
        if (spotlight_input_text[0] != '\0') {
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95 + p * 0.03);
            cairo_move_to(cr, text_x, text_y);
            cairo_show_text(cr, spotlight_input_text);

            if (spotlight_cursor_visible) {
                cairo_text_extents_t ext;
                cairo_text_extents(cr, spotlight_input_text, &ext);
                cairo_rectangle(cr, text_x + ext.x_advance + 2.0, sy + 14.0 + p * 1.0, 1.5 + p * 0.5, 18.0 + p * 2.0);
                cairo_set_source_rgba(cr, ar, ag, ab, 0.95);
                cairo_fill(cr);
            }
        } else {
            if (spotlight_cursor_visible) {
                cairo_rectangle(cr, text_x, sy + 14.0, 1.5, 18.0);
                cairo_set_source_rgba(cr, ar, ag, ab, 0.95);
                cairo_fill(cr);
            }
            cairo_set_font_size(cr, 12.0);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.38);
            cairo_move_to(cr, text_x + 4.0, text_y);
            cairo_show_text(cr, "Пошук у Spotlight...");
        }
    } else {
        cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.72);
        cairo_move_to(cr, text_x, text_y);
        cairo_show_text(cr, "Пошук у Spotlight...");
    }

    // Shortcut badge "⌘ Пробіл" (fades out during expansion)
    if (p < 0.7 && !spotlight_input_active) {
        double badge_alpha = CLAMP((0.6 - p) / 0.6, 0.0, 1.0);
        if (badge_alpha > 0.02) {
            double badge_w = 60.0, badge_h = 22.0;
            double bx = sx + sw - badge_w - 12.0;
            double by = sy + (sh - badge_h) / 2.0;
            draw_rounded_rect_path(cr, bx, by, badge_w, badge_h, 7.0);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.14 * badge_alpha);
            cairo_fill(cr);
            draw_rounded_rect_path(cr, bx + 0.5, by + 0.5, badge_w - 1.0, badge_h - 1.0, 7.0);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.18 * badge_alpha);
            cairo_set_line_width(cr, 0.8);
            cairo_stroke(cr);
            cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
            cairo_set_font_size(cr, 9.5);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.88 * badge_alpha);
            cairo_move_to(cr, bx + 7.5, by + 14.5);
            cairo_show_text(cr, "⌘ Пробіл");
        }
    }

    // Close "esc" badge (fades in as window expands)
    if (p > 0.15) {
        double esc_alpha = CLAMP((p - 0.15) / 0.85, 0.0, 1.0);
        if (esc_alpha > 0.02) {
            double esc_w = 42.0, esc_h = 20.0;
            double esc_x = sx + sw - esc_w - 14.0;
            double esc_y = sy + 15.0;
            draw_rounded_rect_path(cr, esc_x, esc_y, esc_w, esc_h, 6.0);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12 * esc_alpha);
            cairo_fill(cr);
            cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
            cairo_set_font_size(cr, 9.5);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.70 * esc_alpha);
            cairo_move_to(cr, esc_x + 11.5, esc_y + 13.5);
            cairo_show_text(cr, "esc");
        }
    }

    // Content area below search bar with fluid clipping and slide-in
    if (p > 0.08) {
        cairo_save(cr);
        draw_rounded_rect_path(cr, sx, sy, sw, sh, sr);
        cairo_clip(cr);

        // Separator line
        cairo_move_to(cr, sx + 14.0, sy + 51.0);
        cairo_line_to(cr, sx + sw - 14.0, sy + 51.0);
        cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12 * p);
        cairo_set_line_width(cr, 1.0);
        cairo_stroke(cr);

        if (p > 0.18) {
            double content_alpha = CLAMP((p - 0.18) / 0.82, 0.0, 1.0);
            double slide_y = (1.0 - content_alpha) * 18.0;

            cairo_save(cr);
            cairo_translate(cr, 0, slide_y);

            // Safari header row
            draw_safari_compass_icon(cr, sx + 34.0, sy + 76.0, 15.0);

            cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
            cairo_set_font_size(cr, 13.0);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95 * content_alpha);
            cairo_move_to(cr, sx + 58.0, sy + 73.0);
            cairo_show_text(cr, "Результати у інтернеті");

            cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
            cairo_set_font_size(cr, 10.5);
            cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.52 * content_alpha);
            cairo_move_to(cr, sx + 58.0, sy + 87.0);
            cairo_show_text(cr, "Safari — веб-пошук");

            // Snippet description card
            double card_x = sx + 14.0;
            double card_y = sy + 102.0;
            double card_w = sw - 28.0;
            double card_h = sh - 116.0;
            if (card_h > 24.0) {
                draw_rounded_rect_path(cr, card_x, card_y, card_w, card_h, 10.0);
                cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.22 * content_alpha);
                cairo_fill(cr);
                draw_rounded_rect_path(cr, card_x + 0.5, card_y + 0.5, card_w - 1.0, card_h - 1.0, 10.0);
                cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.10 * content_alpha);
                cairo_set_line_width(cr, 1.0);
                cairo_stroke(cr);

                // Pango formatted description
                PangoLayout *layout = pango_cairo_create_layout(cr);
                pango_layout_set_width(layout, (int)((card_w - 24.0) * PANGO_SCALE));
                pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
                pango_layout_set_spacing(layout, (int)(4.0 * PANGO_SCALE));
                PangoFontDescription *desc = pango_font_description_from_string("SF Pro Text 11.5");
                pango_layout_set_font_description(layout, desc);
                pango_font_description_free(desc);

                char hex_main[16], hex_femboy[16];
                snprintf(hex_main, sizeof(hex_main), "#f0f2f5%02x", (int)(content_alpha * 245));
                snprintf(hex_femboy, sizeof(hex_femboy), "#ff94c2%02x", (int)(content_alpha * 245));

                char markup[768];
                snprintf(markup, sizeof(markup),
                    "<span foreground=\"%s\">"
                    "<b>macW1Y</b> is the less popular but the most alike macOS modpack that makes GNOME beautiful with Liquid Glass and Apple HIG design."
                    "</span>\n\n"
                    "<span foreground=\"%s\">"
                    "Also this modpack was made by a femboy. In Telegram @w1nyear channel chat you can find w1nyear's thighs with thigh highs."
                    "</span>", hex_main, hex_femboy);

                pango_layout_set_markup(layout, markup, -1);
                cairo_move_to(cr, card_x + 12.0, card_y + 12.0);
                pango_cairo_show_layout(cr, layout);
                g_object_unref(layout);
            }
            cairo_restore(cr);
        }
        cairo_restore(cr);
    }

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_spotlight_preview(void *widget, gpointer data) {
    (void)data;
    g_spotlight_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), spotlight_preview_draw_func, NULL, NULL);

    gtk_widget_set_focusable(GTK_WIDGET(widget), TRUE);

    GtkGestureClick *click = GTK_GESTURE_CLICK(gtk_gesture_click_new());
    gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(click), 0);
    g_signal_connect(click, "pressed", G_CALLBACK(on_spotlight_preview_clicked), widget);
    gtk_widget_add_controller(GTK_WIDGET(widget), GTK_EVENT_CONTROLLER(click));

    GtkEventController *key_ctrl = gtk_event_controller_key_new();
    g_signal_connect(key_ctrl, "key-pressed", G_CALLBACK(on_spotlight_key_pressed), widget);
    gtk_widget_add_controller(GTK_WIDGET(widget), key_ctrl);
}

/* ========================================================================= */
/* Live Preview: Blur Preview                                                */
/* ========================================================================= */

static GtkWidget *g_blur_preview_w = NULL;
static void redraw_blur_preview(void) {
    if (g_blur_preview_w && GTK_IS_WIDGET(g_blur_preview_w)) {
        gtk_widget_queue_draw(g_blur_preview_w);
    }
}

static void blur_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    double bw = 270.0, bh = 88.0, br = 18.0;
    double bx = (width - bw) / 2.0;
    double by = (height - bh) / 2.0;

    int blur_r = CLAMP(state.blur_sigma / 2, 4, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.28 + ((double)state.blur_tint / 100.0) * 0.55;

    draw_frosted_glass_card(cr, blurred_bg, bx, by, bw, bh, br, tint_a, 0.70, 0.16);

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 11.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.96);
    cairo_move_to(cr, bx + 18.0, by + 28.0);
    cairo_show_text(cr, "Глобальне розмиття (Blur)");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 9.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.72);
    cairo_move_to(cr, bx + 18.0, by + 46.0);
    cairo_show_text(cr, "Фонове системне скло та матовість");

    double ar, ag, ab;
    get_system_accent_color(&ar, &ag, &ab);
    gboolean is_light = mac_is_light_mode();
    const char *loc = mac_get_locale();
    gboolean is_uk = (loc && (strcmp(loc, "uk") == 0 || strcmp(loc, "uk_UA") == 0));
    const char *tint_word = is_light ? (is_uk ? "Засвітлення" : "Lightening") : (is_uk ? "Затемнення" : "Darkening");
    char val_txt[64];
    g_snprintf(val_txt, sizeof(val_txt), "Sigma: %d • %s: %d%%", state.blur_sigma, tint_word, state.blur_tint);
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 9.0);
    cairo_text_extents_t ex_v;
    cairo_text_extents(cr, val_txt, &ex_v);
    double pw = ex_v.width + 16.0, ph = 18.0;
    double px = bx + 18.0, py = by + 58.0;
    draw_rounded_rect_path(cr, px, py, pw, ph, 9.0);
    cairo_set_source_rgba(cr, ar, ag, ab, 0.35);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, px + 0.5, py + 0.5, pw - 1.0, ph - 1.0, 9.0);
    cairo_set_source_rgba(cr, ar, ag, ab, 0.80);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_move_to(cr, px + 8.0, py + 12.5);
    cairo_show_text(cr, val_txt);

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_blur_preview(void *widget, gpointer data) {
    (void)data;
    g_blur_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), blur_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Context Menu Preview                                        */
/* ========================================================================= */

static GtkWidget *g_context_menu_preview_w = NULL;
static void redraw_context_menu_preview(void) {
    if (g_context_menu_preview_w && GTK_IS_WIDGET(g_context_menu_preview_w)) {
        gtk_widget_queue_draw(g_context_menu_preview_w);
    }
}

static void context_menu_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
    (void)area; (void)user_data;
    if (width <= 0 || height <= 0) return;

    cairo_save(cr);
    draw_rounded_rect_path(cr, 0, 0, width, height, 14.0);
    cairo_clip(cr);

    cairo_surface_t *bg = get_cached_wallpaper_surface(width, height);
    if (bg) {
        cairo_set_source_surface(cr, bg, 0, 0);
        cairo_paint(cr);
    } else {
        cairo_set_source_rgb(cr, 0.12, 0.15, 0.22);
        cairo_paint(cr);
    }

    double mw = 206.0, mh = 146.0, mr = 13.0;
    double mx = (width - mw) / 2.0;
    double my = (height - mh) / 2.0;

    int blur_r = CLAMP(state.menu_blur, 6, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.28 + ((double)state.menu_tint / 100.0) * 0.55;
    double shadow_a = ((double)state.menu_shadow_strength / 100.0) * 0.85;

    draw_frosted_glass_card(cr, blurred_bg, mx, my, mw, mh, mr, tint_a, shadow_a, 0.15);

    double ar, ag, ab;
    get_system_accent_color(&ar, &ag, &ab);

    // Top 3 quick action capsule buttons
    double pill_y = my + 8.0, pill_h = 22.0;
    // Capsule 1: Grid [ ⊞ ]
    draw_rounded_rect_path(cr, mx + 10.0, pill_y, 28.0, pill_h, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, mx + 10.5, pill_y + 0.5, 27.0, pill_h - 1.0, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.16);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.85);
    for (int r = 0; r < 2; r++) {
        for (int c = 0; c < 2; c++) {
            cairo_rectangle(cr, mx + 16.0 + c * 8.0, pill_y + 6.0 + r * 6.0, 5.0, 4.5);
            cairo_fill(cr);
        }
    }

    // Capsule 2: More [ ··· ]
    draw_rounded_rect_path(cr, mx + 44.0, pill_y, 28.0, pill_h, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, mx + 44.5, pill_y + 0.5, 27.0, pill_h - 1.0, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.16);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.85);
    for (int d = -1; d <= 1; d++) {
        cairo_arc(cr, mx + 58.0 + d * 5.0, pill_y + 11.0, 1.6, 0, 2 * G_PI);
        cairo_fill(cr);
    }

    // Capsule 3: Search [ ⌕ ]
    double p3_w = 30.0;
    double p3_x = mx + mw - 10.0 - p3_w;
    draw_rounded_rect_path(cr, p3_x, pill_y, p3_w, pill_h, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_fill(cr);
    draw_rounded_rect_path(cr, p3_x + 0.5, pill_y + 0.5, p3_w - 1.0, pill_h - 1.0, 7.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.16);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);
    // Magnifier icon in capsule 3
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.85);
    cairo_set_line_width(cr, 1.2);
    cairo_arc(cr, p3_x + 13.0, pill_y + 10.0, 3.8, 0, 2 * G_PI);
    cairo_stroke(cr);
    cairo_move_to(cr, p3_x + 16.0, pill_y + 13.0);
    cairo_line_to(cr, p3_x + 19.5, pill_y + 16.5);
    cairo_stroke(cr);

    // Row 1: "Режим редагування" with system accent orange toggle switch ON
    double r1_y = my + 36.0, r1_h = 28.0;
    draw_rounded_rect_path(cr, mx + 5.0, r1_y, mw - 10.0, r1_h, 7.0);
    cairo_set_source_rgba(cr, ar, ag, ab, 0.20);
    cairo_fill(cr);

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 10.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_move_to(cr, mx + 14.0, r1_y + 18.0);
    cairo_show_text(cr, "Режим редагування");

    // Toggle switch pill: accent colored
    double sw_w = 32.0, sw_h = 18.0, sw_r = 9.0;
    double sw_x = mx + mw - 12.0 - sw_w;
    double sw_y = r1_y + (r1_h - sw_h) / 2.0;
    draw_rounded_rect_path(cr, sw_x, sw_y, sw_w, sw_h, sw_r);
    cairo_set_source_rgb(cr, ar, ag, ab);
    cairo_fill(cr);
    // Knob shadow
    cairo_arc(cr, sw_x + sw_w - sw_r, sw_y + sw_r + 0.5, 7.2, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.30);
    cairo_fill(cr);
    // Knob body
    cairo_arc(cr, sw_x + sw_w - sw_r, sw_y + sw_r, 7.0, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_fill(cr);

    // Thin separator line
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 0.8);
    cairo_move_to(cr, mx + 10.0, my + 71.0);
    cairo_line_to(cr, mx + mw - 10.0, my + 71.0);
    cairo_stroke(cr);

    // Row 2: "Додати віджети..."
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 10.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.88);
    cairo_move_to(cr, mx + 14.0, my + 92.0);
    cairo_show_text(cr, "Додати віджети...");

    // Row 3: "Упорядкувати віджети" + chevron ›
    cairo_move_to(cr, mx + 14.0, my + 116.0);
    cairo_show_text(cr, "Упорядкувати віджети");
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 11.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.45);
    cairo_move_to(cr, mx + mw - 20.0, my + 116.0);
    cairo_show_text(cr, "›");

    // Row 4: "Змінити шпалери..."
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 10.5);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.88);
    cairo_move_to(cr, mx + 14.0, my + 138.0);
    cairo_show_text(cr, "Змінити шпалери...");

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_context_menu_preview(void *widget, gpointer data) {
    (void)data;
    g_context_menu_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), context_menu_preview_draw_func, NULL, NULL);
}

/* ========================================================================= */
/* Live Preview: Widgets Preview                                             */
/* ========================================================================= */

static GtkWidget *g_widgets_preview_w = NULL;
static void redraw_widgets_preview(void) {
    if (g_widgets_preview_w && GTK_IS_WIDGET(g_widgets_preview_w)) {
        gtk_widget_queue_draw(g_widgets_preview_w);
    }
}

static void widgets_preview_draw_func(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer user_data) {
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
        cairo_pattern_t *fb = cairo_pattern_create_linear(0, 0, width, height);
        cairo_pattern_add_color_stop_rgb(fb, 0.0, 0.12, 0.15, 0.22);
        cairo_pattern_add_color_stop_rgb(fb, 1.0, 0.25, 0.18, 0.15);
        cairo_set_source(cr, fb);
        cairo_paint(cr);
        cairo_pattern_destroy(fb);
    }

    // 3. Frosted Glass Widget Squircle Card
    double ww = 150.0, wh = 142.0;
    double wr = (double)CLAMP(state.widget_radius, 6, 44);
    double wx = (width - ww) / 2.0;
    double wy = (height - wh) / 2.0;

    int blur_r = CLAMP(state.widget_blur, 4, 50);
    cairo_surface_t *blurred_bg = get_cached_blurred_wallpaper_surface(width, height, blur_r);

    double tint_a = 0.25 + ((double)state.widget_tint / 100.0) * 0.55;
    double shadow_a = ((double)state.widget_shadow / 100.0) * 0.85;

    draw_frosted_glass_card(cr, blurred_bg, wx, wy, ww, wh, wr, tint_a, shadow_a, 0.14);

    // 4. Apple World Clock inside the Frosted Card
    double cx = wx + ww / 2.0;
    double cy = wy + 52.0;
    double cr_dial = 34.0;

    // Dial background: rich dark radial gradient (Apple dark mode)
    cairo_pattern_t *dial_pat = cairo_pattern_create_radial(cx, cy - 6.0, 2.0, cx, cy, cr_dial);
    cairo_pattern_add_color_stop_rgba(dial_pat, 0.0, 0.16, 0.17, 0.20, 0.95);
    cairo_pattern_add_color_stop_rgba(dial_pat, 1.0, 0.08, 0.09, 0.11, 0.98);
    cairo_arc(cr, cx, cy, cr_dial, 0, 2 * G_PI);
    cairo_set_source(cr, dial_pat);
    cairo_fill(cr);
    cairo_pattern_destroy(dial_pat);

    // Subtle dial inner bezel ring
    cairo_arc(cr, cx, cy, cr_dial, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 0.8);
    cairo_stroke(cr);

    // 12 Authentic Apple Clock Tick Marks
    for (int t = 0; t < 12; t++) {
        double ang = t * (G_PI / 6.0) - G_PI / 2.0;
        int is_q = (t % 3 == 0);
        double len = is_q ? 4.8 : 2.6;
        double lw = is_q ? 1.6 : 0.85;
        double alpha = is_q ? 0.95 : 0.45;
        cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, alpha);
        cairo_set_line_width(cr, lw);
        cairo_set_line_cap(cr, CAIRO_LINE_CAP_ROUND);
        cairo_move_to(cr, cx + cos(ang) * (cr_dial - 2.5 - len), cy + sin(ang) * (cr_dial - 2.5 - len));
        cairo_line_to(cr, cx + cos(ang) * (cr_dial - 2.5), cy + sin(ang) * (cr_dial - 2.5));
        cairo_stroke(cr);
    }

    // Hands with drop shadows
    double h_ang = -G_PI * 0.65; // ~10:09
    double m_ang = -G_PI * 0.14;
    double ar, ag, ab;
    get_system_accent_color(&ar, &ag, &ab);
    double s_ang = G_PI * 0.58;

    // Hour hand shadow + hand
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.40);
    cairo_set_line_width(cr, 2.6);
    cairo_set_line_cap(cr, CAIRO_LINE_CAP_ROUND);
    cairo_move_to(cr, cx + 0.8, cy + 1.2);
    cairo_line_to(cr, cx + cos(h_ang) * 16.0 + 0.8, cy + sin(h_ang) * 16.0 + 1.2);
    cairo_stroke(cr);

    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_move_to(cr, cx, cy);
    cairo_line_to(cr, cx + cos(h_ang) * 16.0, cy + sin(h_ang) * 16.0);
    cairo_stroke(cr);

    // Minute hand shadow + hand
    cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.40);
    cairo_set_line_width(cr, 2.0);
    cairo_move_to(cr, cx + 0.8, cy + 1.2);
    cairo_line_to(cr, cx + cos(m_ang) * 24.0 + 0.8, cy + sin(m_ang) * 24.0 + 1.2);
    cairo_stroke(cr);

    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.98);
    cairo_move_to(cr, cx, cy);
    cairo_line_to(cr, cx + cos(m_ang) * 24.0, cy + sin(m_ang) * 24.0);
    cairo_stroke(cr);

    // Accent Second hand with circular counterweight
    cairo_set_source_rgb(cr, ar, ag, ab);
    cairo_set_line_width(cr, 1.2);
    cairo_move_to(cr, cx - cos(s_ang) * 6.5, cy - sin(s_ang) * 6.5);
    cairo_line_to(cr, cx + cos(s_ang) * 26.0, cy + sin(s_ang) * 26.0);
    cairo_stroke(cr);

    // Counterweight circle
    cairo_arc(cr, cx - cos(s_ang) * 4.5, cy - sin(s_ang) * 4.5, 2.0, 0, 2 * G_PI);
    cairo_fill(cr);

    // Metallic center pin
    cairo_arc(cr, cx, cy, 2.5, 0, 2 * G_PI);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.95);
    cairo_fill(cr);
    cairo_arc(cr, cx, cy, 1.0, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, ar, ag, ab);
    cairo_fill(cr);

    // Typography (Apple Cupertino World Clock)
    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, 11.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.96);
    cairo_text_extents_t ex_t;
    cairo_text_extents(cr, "КИЇВ", &ex_t);
    cairo_move_to(cr, cx - ex_t.width / 2.0, wy + 106.0);
    cairo_show_text(cr, "КИЇВ");

    cairo_select_font_face(cr, "SF Pro Text", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, 9.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.55);
    cairo_text_extents(cr, "+0 ГОД", &ex_t);
    cairo_move_to(cr, cx - ex_t.width / 2.0, wy + 120.0);
    cairo_show_text(cr, "+0 ГОД");

    cairo_restore(cr);

    draw_rounded_rect_path(cr, 0.5, 0.5, width - 1.0, height - 1.0, 14.0);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
    cairo_set_line_width(cr, 1.0);
    cairo_stroke(cr);
}

void init_widgets_preview(void *widget, gpointer data) {
    (void)data;
    g_widgets_preview_w = GTK_WIDGET(widget);
    gtk_drawing_area_set_draw_func(GTK_DRAWING_AREA(widget), widgets_preview_draw_func, NULL, NULL);
}

/* Group 2: Liquid Glass Callbacks */
void init_liquid_shape(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    guint idx = (guint)CLAMP(state.liquid_shape, 0, 2);
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), idx);
    in_init = 0;
}

void on_liquid_shape_changed(void *widget, void *pspec, gpointer data) {
    (void)pspec; (void)data;
    if (in_init) return;
    guint sel = adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    state.liquid_shape = (int)CLAMP((int)sel, 0, 2);
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
    redraw_spotlight_preview();
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
    redraw_spotlight_preview();
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
    redraw_spotlight_preview();
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
    redraw_blur_preview();
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
    redraw_blur_preview();
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
    redraw_context_menu_preview();
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
    redraw_context_menu_preview();
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
    redraw_context_menu_preview();
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
    redraw_context_menu_preview();
    schedule_menu_shadow_apply();
    schedule_json_save();
}

/* Group 5: Widgets Callbacks */
void init_widget_radius(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.widget_radius);
    in_init = 0;
}

void on_widget_radius_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.widget_radius = (int)lround(gtk_range_get_value(widget));
    redraw_widgets_preview();
    schedule_widget_apply();
    schedule_json_save();
}

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
    redraw_widgets_preview();
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
    redraw_widgets_preview();
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
    redraw_widgets_preview();
    schedule_widget_apply();
    schedule_json_save();
}

/* Group: Dock Callbacks */
void init_dock_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.dock_tint);
    in_init = 0;
}

void on_dock_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.dock_tint = (int)lround(gtk_range_get_value(widget));
    redraw_dock_preview();
    schedule_dock_apply();
    schedule_json_save();
}

void init_dock_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.dock_blur);
    in_init = 0;
}

void on_dock_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.dock_blur = (int)lround(gtk_range_get_value(widget));
    redraw_dock_preview();
    schedule_dock_apply();
    schedule_json_save();
}

void init_dock_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.dock_shadow);
    in_init = 0;
}

void on_dock_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.dock_shadow = (int)lround(gtk_range_get_value(widget));
    redraw_dock_preview();
    schedule_dock_apply();
    schedule_json_save();
}

/* Group: Labels Callbacks */
void init_label_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.label_blur);
    in_init = 0;
}

void on_label_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.label_blur = (int)lround(gtk_range_get_value(widget));
    redraw_labels_preview();
    schedule_label_apply();
    schedule_json_save();
}

void init_label_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.label_tint);
    in_init = 0;
}

void on_label_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.label_tint = (int)lround(gtk_range_get_value(widget));
    redraw_labels_preview();
    schedule_label_apply();
    schedule_json_save();
}

void init_label_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.label_shadow);
    in_init = 0;
}

void on_label_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.label_shadow = (int)lround(gtk_range_get_value(widget));
    redraw_labels_preview();
    schedule_label_apply();
    schedule_json_save();
}

/* Group: Alerts Callbacks */
void init_alert_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.alert_tint);
    in_init = 0;
}

void on_alert_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.alert_tint = (int)lround(gtk_range_get_value(widget));
    redraw_alerts_preview();
    schedule_alert_apply();
    schedule_json_save();
}

void init_alert_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.alert_blur);
    in_init = 0;
}

void on_alert_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.alert_blur = (int)lround(gtk_range_get_value(widget));
    redraw_alerts_preview();
    schedule_alert_apply();
    schedule_json_save();
}

void init_alert_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.alert_shadow);
    in_init = 0;
}

void on_alert_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.alert_shadow = (int)lround(gtk_range_get_value(widget));
    redraw_alerts_preview();
    schedule_alert_apply();
    schedule_json_save();
}

/* Group: Notifications Callbacks */
void init_notification_blur(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.notification_blur);
    in_init = 0;
}

void on_notification_blur_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.notification_blur = (int)lround(gtk_range_get_value(widget));
    redraw_notifications_preview();
    schedule_notification_apply();
    schedule_json_save();
}

void init_notification_tint(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.notification_tint);
    in_init = 0;
}

void on_notification_tint_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.notification_tint = (int)lround(gtk_range_get_value(widget));
    redraw_notifications_preview();
    schedule_notification_apply();
    schedule_json_save();
}

void init_notification_shadow(void *widget, gpointer data) {
    (void)data;
    load_config();
    in_init = 1;
    gtk_scale_set_digits(GTK_SCALE(widget), 0);
    gtk_range_set_round_digits(GTK_RANGE(widget), 0);
    gtk_range_set_value(widget, (double)state.notification_shadow);
    in_init = 0;
}

void on_notification_shadow_changed(void *widget, gpointer data) {
    (void)data;
    if (in_init) return;
    state.notification_shadow = (int)lround(gtk_range_get_value(widget));
    redraw_notifications_preview();
    schedule_notification_apply();
    schedule_json_save();
}

/* Legacy stubs so unresolved symbol errors never occur */
void init_dock_sigma(void *widget, gpointer data) { (void)widget; (void)data; }
void on_dock_sigma_changed(void *widget, gpointer data) { (void)widget; (void)data; }
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
    char *cmd = g_strdup_printf("/bin/bash -c '/usr/local/bin/mac-apply-theme && notify-send -i preferences-desktop-theme \"macW1Y\" \"%s\"'",
                                mac_tr("ssot_restored_notification", "Оформлення успішно відновлено до еталону SSOT!"));
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
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
    GdkRGBA accent_rgba;
    accent_rgba.red = 0.0; accent_rgba.green = 0.478; accent_rgba.blue = 1.0; accent_rgba.alpha = 1.0;
    AdwStyleManager *sm = adw_style_manager_get_default();
    if (sm) {
        is_dark = adw_style_manager_get_dark(sm);
        const GdkRGBA *sm_rgba = adw_style_manager_get_accent_color_rgba(sm);
        if (sm_rgba) {
            accent_rgba = *sm_rgba;
        }
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
        cairo_set_source_rgba(cr, accent_rgba.red, accent_rgba.green, accent_rgba.blue, 1.0);
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

    cairo_set_source_rgba(cr, accent_rgba.red, accent_rgba.green, accent_rgba.blue, 1.0);
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

    cairo_set_source_rgba(cr, accent_rgba.red, accent_rgba.green, accent_rgba.blue, 1.0);
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
        g_strcmp0(id, "mobile-broadband") == 0) return 1;

    if (g_strcmp0(id, "power") == 0 ||
        g_strcmp0(id, "system") == 0 ||
        g_strcmp0(id, "universal-access") == 0) return 2;

    if (g_strcmp0(id, "display") == 0 ||
        g_strcmp0(id, "background") == 0 ||
        g_strcmp0(id, "ubuntu") == 0 ||
        g_strcmp0(id, "multitasking") == 0 ||
        g_strcmp0(id, "widgets") == 0 ||
        g_strcmp0(id, "search") == 0) return 3;

    if (g_strcmp0(id, "notifications") == 0 ||
        g_strcmp0(id, "sound") == 0 ||
        g_strcmp0(id, "wellbeing") == 0) return 4;

    if (g_strcmp0(id, "privacy") == 0) return 5;

    if (g_strcmp0(id, "online-accounts") == 0) return 6;

    if (g_strcmp0(id, "keyboard") == 0 ||
        g_strcmp0(id, "mouse") == 0 ||
        g_strcmp0(id, "printers") == 0 ||
        g_strcmp0(id, "color") == 0 ||
        g_strcmp0(id, "sharing") == 0 ||
        g_strcmp0(id, "applications") == 0 ||
        g_strcmp0(id, "wacom") == 0) return 7;

    if (g_strcmp0(id, "mac-styling") == 0) return 8;

    return 7;
}

static const char *get_sidebar_row_panel_id(GtkListBoxRow *row) {
    if (!row) return NULL;
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_account_row"))) {
        return "account";
    }
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_widgets_row"))) {
        return "widgets";
    }
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_mac_styling_row"))) {
        return "mac-styling";
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
        /* Група 1: Мережа та зв'язок */
        "wifi", "bluetooth", "network", "wwan", "mobile-broadband",

        /* Група 2: Акумулятор, Система, Доступність */
        "power", "system", "about", "datetime", "region", "universal-access",

        /* Група 3: Дисплеї, Шпалери, Оформлення, Робочий стіл і Dock, Віджети, Spotlight */
        "display", "background", "ubuntu", "multitasking", "widgets", "search",

        /* Група 4: Сповіщення, Звук, Фокусування / Екранний час */
        "notifications", "sound", "wellbeing",

        /* Група 5: Конфіденційність і безпека */
        "privacy", "users",

        /* Група 6: Облікові записи */
        "online-accounts",

        /* Група 7: Пристрої та периферія */
        "keyboard", "mouse", "printers", "color", "sharing", "applications", "wacom",

        /* Група 8: Mac стилізація (замість macFUSE в самому низу) */
        "mac-styling",
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
    if (g_strcmp0(id, "power") == 0) return TRUE;           /* Група 2 */
    if (g_strcmp0(id, "display") == 0) return TRUE;         /* Група 3 */
    if (g_strcmp0(id, "notifications") == 0) return TRUE;   /* Група 4 */
    if (g_strcmp0(id, "privacy") == 0) return TRUE;         /* Група 5 */
    if (g_strcmp0(id, "online-accounts") == 0) return TRUE; /* Група 6 */
    if (g_strcmp0(id, "keyboard") == 0) return TRUE;        /* Група 7 */
    if (g_strcmp0(id, "mac-styling") == 0) return TRUE;     /* Група 8 (в самому низу замість macFUSE) */
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
    (void)row;
    /* Feature removed per user request: switching power modes must not change fan speeds,
     * and fan control UI is removed from Settings. */
    return;
}

void gtk_widget_init_template(GtkWidget *widget)
{
    static void (*orig_init_template)(GtkWidget *) = NULL;
    if (!orig_init_template) orig_init_template = dlsym(RTLD_NEXT, "gtk_widget_init_template");
    if (orig_init_template) orig_init_template(widget);
}

void gtk_widget_class_set_template_from_resource(GtkWidgetClass *widget_class, const char *resource_name)
{
    static void (*orig_set_template)(GtkWidgetClass *, const char *) = NULL;
    if (!orig_set_template) orig_set_template = dlsym(RTLD_NEXT, "gtk_widget_class_set_template_from_resource");
    if (orig_set_template) orig_set_template(widget_class, resource_name);
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

static AdwNavigationSplitView *g_last_split_view = NULL;

static void find_navigation_split_view(GtkWidget *widget, AdwNavigationSplitView **split_view)
{
    if (!widget || *split_view) return;
    if (ADW_IS_NAVIGATION_SPLIT_VIEW(widget)) {
        *split_view = ADW_NAVIGATION_SPLIT_VIEW(widget);
        g_last_split_view = *split_view;
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
        adw_navigation_view_set_animate_transitions(ADW_NAVIGATION_VIEW(widget), FALSE);
        *list = g_list_append(*list, widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_navigation_views(child, list);
    }
}

static void schedule_update_panel_headerbar(AdwNavigationSplitView *split_view);

/* Fast instant navigation hooks: eliminate the 0.5s spring slide lag across Settings */
void adw_navigation_view_push(AdwNavigationView *self, AdwNavigationPage *page)
{
    static void (*orig_adw_nav_push)(AdwNavigationView *, AdwNavigationPage *) = NULL;
    if (!orig_adw_nav_push) orig_adw_nav_push = dlsym(RTLD_NEXT, "adw_navigation_view_push");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    if (orig_adw_nav_push) orig_adw_nav_push(self, page);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
}

void adw_navigation_view_push_by_tag(AdwNavigationView *self, const char *tag)
{
    static void (*orig_adw_nav_push_by_tag)(AdwNavigationView *, const char *) = NULL;
    if (!orig_adw_nav_push_by_tag) orig_adw_nav_push_by_tag = dlsym(RTLD_NEXT, "adw_navigation_view_push_by_tag");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    if (orig_adw_nav_push_by_tag) orig_adw_nav_push_by_tag(self, tag);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
}

gboolean adw_navigation_view_pop(AdwNavigationView *self)
{
    static gboolean (*orig_adw_nav_pop)(AdwNavigationView *) = NULL;
    if (!orig_adw_nav_pop) orig_adw_nav_pop = dlsym(RTLD_NEXT, "adw_navigation_view_pop");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    gboolean res = FALSE;
    if (orig_adw_nav_pop) res = orig_adw_nav_pop(self);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
    return res;
}

gboolean adw_navigation_view_pop_to_page(AdwNavigationView *self, AdwNavigationPage *page)
{
    static gboolean (*orig_adw_nav_pop_to_page)(AdwNavigationView *, AdwNavigationPage *) = NULL;
    if (!orig_adw_nav_pop_to_page) orig_adw_nav_pop_to_page = dlsym(RTLD_NEXT, "adw_navigation_view_pop_to_page");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    gboolean res = FALSE;
    if (orig_adw_nav_pop_to_page) res = orig_adw_nav_pop_to_page(self, page);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
    return res;
}

gboolean adw_navigation_view_pop_to_tag(AdwNavigationView *self, const char *tag)
{
    static gboolean (*orig_adw_nav_pop_to_tag)(AdwNavigationView *, const char *) = NULL;
    if (!orig_adw_nav_pop_to_tag) orig_adw_nav_pop_to_tag = dlsym(RTLD_NEXT, "adw_navigation_view_pop_to_tag");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    gboolean res = FALSE;
    if (orig_adw_nav_pop_to_tag) res = orig_adw_nav_pop_to_tag(self, tag);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
    return res;
}

void adw_navigation_view_replace(AdwNavigationView *self, AdwNavigationPage **pages, int n_pages)
{
    static void (*orig_adw_nav_replace)(AdwNavigationView *, AdwNavigationPage **, int) = NULL;
    if (!orig_adw_nav_replace) orig_adw_nav_replace = dlsym(RTLD_NEXT, "adw_navigation_view_replace");
    if (self && G_IS_OBJECT(self) && ADW_IS_NAVIGATION_VIEW(self)) {
        adw_navigation_view_set_animate_transitions(self, FALSE);
    }
    if (orig_adw_nav_replace) orig_adw_nav_replace(self, pages, n_pages);
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
}

void adw_navigation_split_view_set_content(AdwNavigationSplitView *self, AdwNavigationPage *content)
{
    static void (*orig_set_content)(AdwNavigationSplitView *, AdwNavigationPage *) = NULL;
    if (!orig_set_content) orig_set_content = dlsym(RTLD_NEXT, "adw_navigation_split_view_set_content");
    if (content && G_IS_OBJECT(content)) {
        GList *nvs = NULL;
        find_navigation_views(GTK_WIDGET(content), &nvs);
        g_list_free(nvs);
    }
    if (orig_set_content) orig_set_content(self, content);
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
        if (is_sidebar) {
            adw_toolbar_view_set_extend_content_to_top_edge(tv, FALSE);
            adw_toolbar_view_set_extend_content_to_bottom_edge(tv, FALSE);
        } else {
            adw_toolbar_view_set_extend_content_to_top_edge(tv, FALSE);
            adw_toolbar_view_set_extend_content_to_bottom_edge(tv, TRUE);
        }
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
            if (dw_settings) {
                /* Widgets follow system light/dark theme automatically */
                g_settings_set_boolean(dw_settings, "use-custom-widget-theme", FALSE);
                g_settings_set_int(dw_settings, "appearance", 2);
            }
        }
    }
    return dw_settings;
}

static GtkWidget *g_dw_edit_mode_row = NULL;

/* Увімкнути / вимкнути режим редагування віджетів і оновити перемикач у Параметрах. */
static void dw_set_edit_mode(gboolean active) {
    GSettings *s = get_dw_settings();
    if (!s) return;
    g_settings_set_boolean(s, "edit-mode", active);
    if (g_dw_edit_mode_row)
        adw_switch_row_set_active(ADW_SWITCH_ROW(g_dw_edit_mode_row), active);
}

/* При закритті вікна Параметрів режим редагування віджетів має вимкнутися. */
static gboolean dw_settings_window_close_cb(GtkWindow *win, gpointer user_data) {
    (void)win; (void)user_data;
    dw_set_edit_mode(FALSE);
    return FALSE;
}

static void dw_attach_settings_close_handler(AdwNavigationSplitView *sv) {
    if (!sv) return;
    GtkWidget *win = gtk_widget_get_ancestor(GTK_WIDGET(sv), GTK_TYPE_WINDOW);
    if (!win) return;
    if (g_object_get_data(G_OBJECT(win), "mac-dw-close-connected")) return;
    g_signal_connect(win, "close-request", G_CALLBACK(dw_settings_window_close_cb), NULL);
    g_object_set_data(G_OBJECT(win), "mac-dw-close-connected", GINT_TO_POINTER(1));
}

void init_dw_edit_mode(void *widget, gpointer data) {
    (void)data;
    GSettings *s = get_dw_settings();
    if (!s || !widget) return;
    g_dw_edit_mode_row = GTK_WIDGET(widget);
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

static void schedule_update_panel_headerbar(AdwNavigationSplitView *split_view);
static AdwNavigationView *global_widgets_nav_view = NULL;
static AdwToastOverlay *global_widgets_picker_toast_overlay = NULL;
G_MODULE_EXPORT void on_widgets_nav_view_popped(AdwNavigationView *nv, AdwNavigationPage *page, gpointer user_data);

static const char *get_default_widget_size(const char *type) {
    if (!type) return "small";
    if (g_strcmp0(type, "applauncher") == 0 ||
        g_strcmp0(type, "binaryclock") == 0 ||
        g_strcmp0(type, "photos") == 0 ||
        g_strcmp0(type, "battery") == 0 ||
        g_strcmp0(type, "music") == 0 ||
        g_strcmp0(type, "todo") == 0 ||
        g_strcmp0(type, "github") == 0 ||
        g_strcmp0(type, "screentime") == 0 ||
        g_strcmp0(type, "notes") == 0 ||
        g_strcmp0(type, "lava") == 0 ||
        g_strcmp0(type, "stopwatch") == 0 ||
        g_strcmp0(type, "folder") == 0 ||
        g_strcmp0(type, "timer") == 0) {
        return "medium";
    }
    return "small";
}

static void add_widget_to_desktop(GtkWidget *widget, const char *type, const char *label) {
    g_print("macW1Y: add_widget_to_desktop type=%s, label=%s\n", type ? type : "null", label ? label : "null");
    ensure_dw_extension_enabled();
    dw_set_edit_mode(TRUE);

    GSettings *s = get_dw_settings();
    if (!s || !type) return;

    char *json_str = g_settings_get_string(s, "layout-json");
    JsonParser *parser = json_parser_new();
    const char *initial = (json_str && *json_str) ? json_str : "{\"version\":3,\"widgets\":[]}";
    if (!json_parser_load_from_data(parser, initial, -1, NULL)) {
        json_parser_load_from_data(parser, "{\"version\":3,\"widgets\":[]}", -1, NULL);
    }

    JsonNode *root = json_parser_get_root(parser);
    if (!root || !JSON_NODE_HOLDS_OBJECT(root)) {
        if (json_str) g_free(json_str);
        g_object_unref(parser);
        return;
    }

    JsonObject *root_obj = json_node_get_object(root);
    if (!json_object_has_member(root_obj, "version")) {
        json_object_set_int_member(root_obj, "version", 3);
    }

    JsonArray *widgets_arr = NULL;
    if (json_object_has_member(root_obj, "widgets")) {
        widgets_arr = json_object_get_array_member(root_obj, "widgets");
    }
    if (!widgets_arr) {
        widgets_arr = json_array_new();
        json_object_set_array_member(root_obj, "widgets", widgets_arr);
    }

    guint count = json_array_get_length(widgets_arr);
    gint64 now_ms = g_get_real_time() / 1000;
    char *widget_id = g_strdup_printf("%s-%" G_GINT64_FORMAT, type, now_ms);

    JsonObject *w_obj = json_object_new();
    json_object_set_string_member(w_obj, "id", widget_id);
    json_object_set_string_member(w_obj, "type", type);
    json_object_set_string_member(w_obj, "size", get_default_widget_size(type));
    json_object_set_int_member(w_obj, "x", 24 + ((count % 8) * 30));
    json_object_set_int_member(w_obj, "y", 80 + ((count % 8) * 30));
    json_object_set_object_member(w_obj, "data", json_object_new());
    json_object_set_array_member(w_obj, "stack", json_array_new());
    json_object_set_boolean_member(w_obj, "pinned", FALSE);

    json_array_add_object_element(widgets_arr, w_obj);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, root);
    gsize out_len = 0;
    char *out_str = json_generator_to_data(gen, &out_len);
    if (out_str) {
        g_settings_set_string(s, "layout-json", out_str);
        g_free(out_str);
    }

    g_object_unref(gen);
    g_object_unref(parser);
    if (json_str) g_free(json_str);
    g_free(widget_id);

    /* Показуємо спливаюче сповіщення у вікні вибору віджетів */
    AdwToastOverlay *toast_overlay = global_widgets_picker_toast_overlay;
    if (!toast_overlay && widget && GTK_IS_WIDGET(widget)) {
        GtkWidget *anc = gtk_widget_get_ancestor(widget, ADW_TYPE_TOAST_OVERLAY);
        if (anc) toast_overlay = ADW_TOAST_OVERLAY(anc);
    }
    if (toast_overlay) {
        char *toast_msg = g_strdup_printf("Віджет «%s» додано на стільницю", label ? label : type);
        AdwToast *toast = adw_toast_new(toast_msg);
        adw_toast_set_timeout(toast, 2);
        adw_toast_overlay_add_toast(toast_overlay, toast);
        g_free(toast_msg);
    }
}

G_MODULE_EXPORT void on_dw_add_clock(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "clock", "Аналоговий годинник"); }
G_MODULE_EXPORT void on_dw_add_digitalclock(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "digitalclock", "Цифровий годинник"); }
G_MODULE_EXPORT void on_dw_add_binaryclock(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "binaryclock", "Бінарний годинник"); }
G_MODULE_EXPORT void on_dw_add_calendar(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "calendar", "Календар"); }
G_MODULE_EXPORT void on_dw_add_weather(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "weather", "Погода"); }
G_MODULE_EXPORT void on_dw_add_photos(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "photos", "Фотогалерея"); }
G_MODULE_EXPORT void on_dw_add_battery(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "battery", "Рівень заряду"); }
G_MODULE_EXPORT void on_dw_add_music(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "music", "Музичний плеєр"); }
G_MODULE_EXPORT void on_dw_add_todo(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "todo", "Список справ"); }
G_MODULE_EXPORT void on_dw_add_github(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "github", "Активність GitHub"); }
G_MODULE_EXPORT void on_dw_add_screentime(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "screentime", "Екранний час"); }
G_MODULE_EXPORT void on_dw_add_system(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "system", "Системний монітор"); }
G_MODULE_EXPORT void on_dw_add_notes(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "notes", "Нотатки"); }
G_MODULE_EXPORT void on_dw_add_pomodoro(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "pomodoro", "Таймер Pomodoro"); }
G_MODULE_EXPORT void on_dw_add_lava(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "lava", "Лава-лампа"); }
G_MODULE_EXPORT void on_dw_add_stopwatch(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "stopwatch", "Секундомір"); }
G_MODULE_EXPORT void on_dw_add_folder(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "folder", "Швидка папка"); }
G_MODULE_EXPORT void on_dw_add_timer(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "timer", "Таймер зворотного відліку"); }
G_MODULE_EXPORT void on_dw_add_applauncher(void *b, gpointer d) { (void)d; add_widget_to_desktop(GTK_WIDGET(b), "applauncher", "Панель запуску"); }

G_MODULE_EXPORT void on_widgets_picker_shown(AdwNavigationPage *page, gpointer user_data) {
    (void)page; (void)user_data;
    g_print("macW1Y: widgets_picker shown -> turning edit mode ON\n");
    dw_set_edit_mode(TRUE);
}

G_MODULE_EXPORT void on_widgets_picker_hidden(AdwNavigationPage *page, gpointer user_data) {
    (void)page; (void)user_data;
    g_print("macW1Y: widgets_picker hidden -> turning edit mode OFF\n");
    dw_set_edit_mode(FALSE);
}

G_MODULE_EXPORT void on_widgets_nav_view_popped(AdwNavigationView *nv, AdwNavigationPage *page, gpointer user_data) {
    (void)nv; (void)user_data;
    if (!page || !ADW_IS_NAVIGATION_PAGE(page)) return;
    const char *tag = adw_navigation_page_get_tag(page);
    g_print("macW1Y: widgets nav page popped, tag=%s\n", tag ? tag : "null");
    if (tag && g_strcmp0(tag, "widgets_picker") == 0) {
        dw_set_edit_mode(FALSE);
    }
    if (g_last_split_view) {
        schedule_update_panel_headerbar(g_last_split_view);
    }
}

G_MODULE_EXPORT void on_dw_add_widgets_clicked(void *button, gpointer data) {
    (void)data;
    g_print("macW1Y: on_dw_add_widgets_clicked invoked!\n");
    ensure_dw_extension_enabled();
    dw_set_edit_mode(TRUE);

    AdwNavigationView *nv = global_widgets_nav_view;
    if (button && GTK_IS_WIDGET(button)) {
        GtkWidget *ancestor = gtk_widget_get_ancestor(GTK_WIDGET(button), ADW_TYPE_NAVIGATION_VIEW);
        if (ancestor) nv = ADW_NAVIGATION_VIEW(ancestor);
    }
    if (nv) {
        adw_navigation_view_push_by_tag(nv, "widgets_picker");
        if (button && GTK_IS_WIDGET(button)) {
            GtkWidget *sv = gtk_widget_get_ancestor(GTK_WIDGET(button), ADW_TYPE_NAVIGATION_SPLIT_VIEW);
            if (sv) {
                schedule_update_panel_headerbar(ADW_NAVIGATION_SPLIT_VIEW(sv));
                dw_attach_settings_close_handler(ADW_NAVIGATION_SPLIT_VIEW(sv));
            }
        }
        if (g_last_split_view) {
            schedule_update_panel_headerbar(g_last_split_view);
            dw_attach_settings_close_handler(g_last_split_view);
        }
    } else {
        g_warning("macW1Y: on_dw_add_widgets_clicked could not find navigation view!");
    }
}

G_MODULE_EXPORT void on_dw_arrange_clicked(void *button, gpointer data) {
    (void)button; (void)data;
    g_print("macW1Y: on_dw_arrange_clicked invoked!\n");
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
    state.widget_radius = radius;
    schedule_json_save();
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

static void bind_widgets_configurator_settings(GtkBuilder *builder) {
    GSettings *s = get_dw_settings();
    if (!s || !builder) return;

    GObject *w;
    #define BIND_SWITCH(id, key) \
        if ((w = gtk_builder_get_object(builder, id))) { \
            g_settings_bind(s, key, w, "active", G_SETTINGS_BIND_DEFAULT); \
        }
    #define BIND_SPIN(id, key) \
        if ((w = gtk_builder_get_object(builder, id))) { \
            g_settings_bind(s, key, w, "value", G_SETTINGS_BIND_DEFAULT); \
        }
    #define BIND_ENTRY(id, key) \
        if ((w = gtk_builder_get_object(builder, id))) { \
            g_settings_bind(s, key, w, "text", G_SETTINGS_BIND_DEFAULT); \
        }

    /* 1. Clocks */
    BIND_SWITCH("cfg_digitalclock_show_seconds", "digitalclock-show-seconds");
    BIND_SWITCH("cfg_digitalclock_smooth_seconds", "digitalclock-smooth-seconds");
    BIND_SWITCH("cfg_clock_smooth_seconds", "clock-smooth-seconds");
    BIND_SWITCH("cfg_digitalclock_show_ampm", "digitalclock-show-ampm");
    BIND_SWITCH("cfg_binaryclock_use_accent", "binaryclock-use-accent-color");

    /* 2. Calendar */
    BIND_SPIN("cfg_calendar_lookahead_row", "calendar-lookahead");
    BIND_SWITCH("cfg_calendar_use_accent", "calendar-use-accent-color");
    BIND_SWITCH("cfg_calendar_show_page_dots", "calendar-show-page-dots");

    /* 3. Weather */
    BIND_SWITCH("cfg_weather_use_accent", "weather-use-accent-color");
    BIND_SWITCH("cfg_weather_show_page_dots", "weather-show-page-dots");

    /* 4. Battery */
    BIND_SPIN("cfg_battery_slot_count_row", "battery-slot-count");
    BIND_SWITCH("cfg_battery_show_percent", "battery-show-percent");
    BIND_SWITCH("cfg_battery_use_accent", "battery-use-accent-color");

    /* 5. Music */
    BIND_SWITCH("cfg_music_ignore_browsers", "music-ignore-browsers");
    BIND_ENTRY("cfg_music_custom_app_entry", "music-custom-app");

    /* 6. System */
    BIND_SWITCH("cfg_system_page_indicator_accent", "system-page-indicator-accent");
    BIND_SWITCH("cfg_system_show_page_dashes", "system-show-page-dashes");

    /* 7. Photos */
    BIND_ENTRY("cfg_custom_photo_entry", "custom-photo");

    /* 8. Pomodoro */
    BIND_SPIN("cfg_pomodoro_work_row", "pomodoro-work-minutes");
    BIND_SPIN("cfg_pomodoro_short_break_row", "pomodoro-short-break-minutes");
    BIND_SPIN("cfg_pomodoro_long_break_row", "pomodoro-long-break-minutes");
    BIND_SPIN("cfg_pomodoro_sessions_row", "pomodoro-sessions-before-long-break");

    /* 9. Notes */
    BIND_SPIN("cfg_notes_title_size_row", "notes-title-font-size");
    BIND_SPIN("cfg_notes_content_size_row", "notes-content-font-size");

    /* 10. GitHub */
    BIND_ENTRY("cfg_github_username_entry", "github-username");
    BIND_SWITCH("cfg_github_use_green", "github-use-green");

    /* 11. Folders */
    BIND_ENTRY("cfg_folder_file_manager_entry", "folder-file-manager");
    BIND_SWITCH("cfg_folder_show_names", "folder-show-names");

    /* 12. Screen Time */
    BIND_SPIN("cfg_screentime_retention_row", "screentime-retention-days");
    BIND_SWITCH("cfg_screentime_show_nav_buttons", "screentime-show-nav-buttons");

    /* 13. Lava Lamp */
    BIND_SWITCH("cfg_lava_use_accent", "lava-use-accent-color");

    #undef BIND_SWITCH
    #undef BIND_SPIN
    #undef BIND_ENTRY
}

G_MODULE_EXPORT void on_dw_advanced_clicked(void *button, gpointer data) {
    (void)data;
    g_print("macW1Y: on_dw_advanced_clicked invoked!\n");
    AdwNavigationView *nv = global_widgets_nav_view;
    if (button && GTK_IS_WIDGET(button)) {
        GtkWidget *ancestor = gtk_widget_get_ancestor(GTK_WIDGET(button), ADW_TYPE_NAVIGATION_VIEW);
        if (ancestor) nv = ADW_NAVIGATION_VIEW(ancestor);
    }
    if (nv) {
        adw_navigation_view_push_by_tag(nv, "widgets_configurator");
        if (button && GTK_IS_WIDGET(button)) {
            GtkWidget *sv = gtk_widget_get_ancestor(GTK_WIDGET(button), ADW_TYPE_NAVIGATION_SPLIT_VIEW);
            if (sv) {
                schedule_update_panel_headerbar(ADW_NAVIGATION_SPLIT_VIEW(sv));
            }
        }
        if (g_last_split_view) {
            schedule_update_panel_headerbar(g_last_split_view);
        }
    } else {
        g_warning("macW1Y: on_dw_advanced_clicked could not find navigation view!");
    }
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

static char *mac_get_localized_ui_path(const char *basename)
{
    const char *loc = mac_get_locale();
    const char *home = g_get_home_dir();
    char *path = NULL;

    /* 1. If locale is not Ukrainian, try localized overlay directory first */
    if (loc && strcmp(loc, "uk") != 0) {
        /* System localized overlay */
        path = g_build_filename("/usr/share/mactheme/gnome-control-center-overlay/locales", loc, basename, NULL);
        if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
        g_free(path);

        /* User localized overlay */
        if (home) {
            path = g_build_filename(home, ".local", "share", "gnome-control-center-overlay", "locales", loc, basename, NULL);
            if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
            g_free(path);
        }

        /* Repo localized overlay */
        path = g_build_filename("/home/vitaliy/MACTHEMEFILES/control-center/locales", loc, basename, NULL);
        if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
        g_free(path);

        /* Fallback to English localized overlay if language overlay missing */
        if (strcmp(loc, "en") != 0) {
            path = g_build_filename("/usr/share/mactheme/gnome-control-center-overlay/locales", "en", basename, NULL);
            if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
            g_free(path);

            if (home) {
                path = g_build_filename(home, ".local", "share", "gnome-control-center-overlay", "locales", "en", basename, NULL);
                if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
                g_free(path);
            }

            path = g_build_filename("/home/vitaliy/MACTHEMEFILES/control-center/locales", "en", basename, NULL);
            if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
            g_free(path);
        }
    }

    /* Fallback to default overlay (Ukrainian / SSOT baseline) */
    path = g_build_filename("/usr/share/mactheme/gnome-control-center-overlay", basename, NULL);
    if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
    g_free(path);

    if (home) {
        path = g_build_filename(home, ".local", "share", "gnome-control-center-overlay", basename, NULL);
        if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
        g_free(path);
    }

    path = g_build_filename("/home/vitaliy/MACTHEMEFILES/control-center", basename, NULL);
    if (g_file_test(path, G_FILE_TEST_EXISTS)) return path;
    g_free(path);

    return NULL;
}

static GtkWidget *get_widgets_page(void)
{
    static GtkWidget *widgets_page = NULL;
    if (widgets_page) return widgets_page;

    GtkBuilder *builder = gtk_builder_new();
    char *path_to_use = mac_get_localized_ui_path("cc-widgets-panel.ui");

    GError *error = NULL;
    gboolean loaded = FALSE;
    if (path_to_use) {
        loaded = gtk_builder_add_from_file(builder, path_to_use, &error);
        g_free(path_to_use);
    }

    if (loaded) {
        widgets_page = GTK_WIDGET(gtk_builder_get_object(builder, "widgets_page"));
        global_widgets_nav_view = ADW_NAVIGATION_VIEW(gtk_builder_get_object(builder, "widgets_nav_view"));
        global_widgets_picker_toast_overlay = ADW_TOAST_OVERLAY(gtk_builder_get_object(builder, "widgets_picker_toast_overlay"));
        if (global_widgets_nav_view) {
            adw_navigation_view_set_animate_transitions(global_widgets_nav_view, FALSE);
            g_signal_connect(global_widgets_nav_view, "popped", G_CALLBACK(on_widgets_nav_view_popped), NULL);
        }
        bind_widgets_configurator_settings(builder);
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

static void on_interface_color_scheme_changed(GSettings *settings, const gchar *key, gpointer user_data) {
    (void)settings; (void)key;
    GtkWidget *page = (GtkWidget *)user_data;
    if (page && GTK_IS_WIDGET(page)) {
        update_mac_styling_tint_labels(page, mac_is_light_mode());
        redraw_all_mac_styling_previews();
    }
}

static GtkWidget *get_mac_styling_page(void)
{
    static GtkWidget *mac_styling_page = NULL;
    if (mac_styling_page) return mac_styling_page;

    start_wallpaper_preload();

    GtkBuilder *builder = gtk_builder_new();
    char *path_to_use = mac_get_localized_ui_path("cc-mac-styling-panel.ui");

    GError *error = NULL;
    gboolean loaded = FALSE;
    if (path_to_use) {
        loaded = gtk_builder_add_from_file(builder, path_to_use, &error);
        g_free(path_to_use);
    }

    if (loaded) {
        mac_styling_page = GTK_WIDGET(gtk_builder_get_object(builder, "mac_styling_page"));
        if (mac_styling_page) {
            g_object_ref(mac_styling_page);
            reorder_group_previews_to_top(mac_styling_page);
            update_mac_styling_tint_labels(mac_styling_page, mac_is_light_mode());
            g_signal_connect(mac_styling_page, "map", G_CALLBACK(on_mac_styling_page_map), NULL);

            static gboolean s_scheme_listener_added = FALSE;
            if (!s_scheme_listener_added) {
                s_scheme_listener_added = TRUE;
                GSettingsSchemaSource *src = g_settings_schema_source_get_default();
                if (src && g_settings_schema_source_lookup(src, "org.gnome.desktop.interface", TRUE)) {
                    GSettings *iface = g_settings_new("org.gnome.desktop.interface");
                    g_signal_connect(iface, "changed::color-scheme", G_CALLBACK(on_interface_color_scheme_changed), mac_styling_page);
                }
            }
        }
    } else {
        if (error) {
            g_warning("macW1Y: Failed to load cc-mac-styling-panel.ui: %s", error->message);
            g_error_free(error);
        }
    }
    g_object_unref(builder);
    return mac_styling_page;
}

/* ========================================================================= */
/* Screenshot & Screencast Settings Panel                                    */
/* ========================================================================= */

typedef struct {
    int image_format;        /* 0=PNG, 1=JPEG, 2=WebP */
    int image_quality;       /* 70 - 100 */
    gboolean show_cursor;    /* TRUE/FALSE */
    gboolean shutter_sound;  /* TRUE/FALSE */
    int timer_delay;         /* 0=0s, 1=3s, 2=5s, 3=10s */

    int video_container;     /* 0=MP4, 1=WebM, 2=MKV */
    int video_codec;         /* 0=H.264, 1=VP9, 2=AV1 */
    int video_fps;           /* 0=60, 1=30 */
    gboolean screencast_cursor; /* TRUE/FALSE */
    gboolean record_audio;   /* TRUE/FALSE */

    gboolean processing_enabled; /* TRUE/FALSE */
    int processing_target;       /* 0=native, 1=1080p, 2=2k, 3=4k */
    int processing_algorithm;    /* 0=lanczos, 1=bicubic, 2=unsharp */
    int processing_scope;        /* 0=both, 1=screenshots, 2=screencasts */
    gboolean keep_original;      /* TRUE/FALSE */
} MacScreenshotData;

static MacScreenshotData scr_state = {
    .image_format = 0,
    .image_quality = 95,
    .show_cursor = TRUE,
    .shutter_sound = TRUE,
    .timer_delay = 0,
    .video_container = 0,
    .video_codec = 0,
    .video_fps = 0,
    .screencast_cursor = TRUE,
    .record_audio = FALSE,
    .processing_enabled = TRUE,
    .processing_target = 2,
    .processing_algorithm = 0,
    .processing_scope = 0,
    .keep_original = FALSE
};

static int scr_in_init = 0;

static char *get_screenshot_json_path(void) {
    const char *home = g_get_home_dir();
    if (!home) return NULL;
    return g_build_filename(home, ".config", "mac-styling", "screenshot.json", NULL);
}

static void load_screenshot_config(void) {
    char *path = get_screenshot_json_path();
    if (!path || !g_file_test(path, G_FILE_TEST_EXISTS)) {
        g_free(path);
        return;
    }
    JsonParser *parser = json_parser_new();
    GError *error = NULL;
    if (json_parser_load_from_file(parser, path, &error)) {
        JsonNode *root = json_parser_get_root(parser);
        if (root && JSON_NODE_HOLDS_OBJECT(root)) {
            JsonObject *obj = json_node_get_object(root);
            if (json_object_has_member(obj, "image_format"))
                scr_state.image_format = (int)json_object_get_int_member(obj, "image_format");
            if (json_object_has_member(obj, "image_quality"))
                scr_state.image_quality = (int)json_object_get_int_member(obj, "image_quality");
            if (json_object_has_member(obj, "show_cursor"))
                scr_state.show_cursor = json_object_get_boolean_member(obj, "show_cursor");
            if (json_object_has_member(obj, "shutter_sound"))
                scr_state.shutter_sound = json_object_get_boolean_member(obj, "shutter_sound");
            if (json_object_has_member(obj, "timer_delay"))
                scr_state.timer_delay = (int)json_object_get_int_member(obj, "timer_delay");

            if (json_object_has_member(obj, "video_container"))
                scr_state.video_container = (int)json_object_get_int_member(obj, "video_container");
            if (json_object_has_member(obj, "video_codec"))
                scr_state.video_codec = (int)json_object_get_int_member(obj, "video_codec");
            if (json_object_has_member(obj, "video_fps"))
                scr_state.video_fps = (int)json_object_get_int_member(obj, "video_fps");
            if (json_object_has_member(obj, "screencast_cursor"))
                scr_state.screencast_cursor = json_object_get_boolean_member(obj, "screencast_cursor");
            if (json_object_has_member(obj, "record_audio"))
                scr_state.record_audio = json_object_get_boolean_member(obj, "record_audio");

            if (json_object_has_member(obj, "processing_enabled"))
                scr_state.processing_enabled = json_object_get_boolean_member(obj, "processing_enabled");
            if (json_object_has_member(obj, "processing_target"))
                scr_state.processing_target = (int)json_object_get_int_member(obj, "processing_target");
            if (json_object_has_member(obj, "processing_algorithm"))
                scr_state.processing_algorithm = (int)json_object_get_int_member(obj, "processing_algorithm");
            if (json_object_has_member(obj, "processing_scope"))
                scr_state.processing_scope = (int)json_object_get_int_member(obj, "processing_scope");
            if (json_object_has_member(obj, "keep_original"))
                scr_state.keep_original = json_object_get_boolean_member(obj, "keep_original");
        }
    }
    if (error) g_error_free(error);
    g_object_unref(parser);
    g_free(path);
}

static void save_screenshot_config(void) {
    char *path = get_screenshot_json_path();
    if (!path) return;
    char *dir = g_path_get_dirname(path);
    g_mkdir_with_parents(dir, 0755);
    g_free(dir);

    char *json = g_strdup_printf(
        "{\n"
        "  \"image_format\": %d,\n"
        "  \"image_quality\": %d,\n"
        "  \"show_cursor\": %s,\n"
        "  \"shutter_sound\": %s,\n"
        "  \"timer_delay\": %d,\n"
        "  \"video_container\": %d,\n"
        "  \"video_codec\": %d,\n"
        "  \"video_fps\": %d,\n"
        "  \"screencast_cursor\": %s,\n"
        "  \"record_audio\": %s,\n"
        "  \"processing_enabled\": %s,\n"
        "  \"processing_target\": %d,\n"
        "  \"processing_algorithm\": %d,\n"
        "  \"processing_scope\": %d,\n"
        "  \"keep_original\": %s\n"
        "}\n",
        scr_state.image_format,
        scr_state.image_quality,
        scr_state.show_cursor ? "true" : "false",
        scr_state.shutter_sound ? "true" : "false",
        scr_state.timer_delay,
        scr_state.video_container,
        scr_state.video_codec,
        scr_state.video_fps,
        scr_state.screencast_cursor ? "true" : "false",
        scr_state.record_audio ? "true" : "false",
        scr_state.processing_enabled ? "true" : "false",
        scr_state.processing_target,
        scr_state.processing_algorithm,
        scr_state.processing_scope,
        scr_state.keep_original ? "true" : "false"
    );

    g_file_set_contents(path, json, -1, NULL);
    g_free(json);
    g_free(path);
}

G_MODULE_EXPORT void init_screenshot_format(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.image_format);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screenshot_format_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.image_format = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screenshot_quality(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    gtk_range_set_value(GTK_RANGE(widget), (double)scr_state.image_quality);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screenshot_quality_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.image_quality = (int)lround(gtk_range_get_value(GTK_RANGE(widget)));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screenshot_cursor(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.show_cursor);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screenshot_cursor_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.show_cursor = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screenshot_sound(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.shutter_sound);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screenshot_sound_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.shutter_sound = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screenshot_delay(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.timer_delay);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screenshot_delay_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.timer_delay = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screencast_container(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.video_container);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screencast_container_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.video_container = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screencast_codec(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.video_codec);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screencast_codec_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.video_codec = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screencast_fps(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.video_fps);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screencast_fps_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.video_fps = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screencast_cursor(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.screencast_cursor);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screencast_cursor_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.screencast_cursor = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_screencast_audio(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.record_audio);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_screencast_audio_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.record_audio = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_processing_enabled(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.processing_enabled);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_processing_enabled_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.processing_enabled = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_processing_resolution(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.processing_target);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_processing_resolution_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.processing_target = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_processing_scope(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.processing_scope);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_processing_scope_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.processing_scope = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_processing_algorithm(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_combo_row_set_selected(ADW_COMBO_ROW(widget), scr_state.processing_algorithm);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_processing_algorithm_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.processing_algorithm = (int)adw_combo_row_get_selected(ADW_COMBO_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void init_processing_keep_original(void *widget, gpointer data) {
    (void)data;
    load_screenshot_config();
    scr_in_init = 1;
    adw_switch_row_set_active(ADW_SWITCH_ROW(widget), scr_state.keep_original);
    scr_in_init = 0;
}

G_MODULE_EXPORT void on_processing_keep_original_changed(void *widget, gpointer data) {
    (void)data;
    if (scr_in_init) return;
    scr_state.keep_original = adw_switch_row_get_active(ADW_SWITCH_ROW(widget));
    save_screenshot_config();
}

G_MODULE_EXPORT void on_open_screenshots_folder_clicked(void *widget, gpointer data) {
    (void)widget; (void)data;
    const char *home = g_get_home_dir();
    if (!home) return;
    char *dir = g_build_filename(home, "Зображення", "Знімки екрана", NULL);
    g_mkdir_with_parents(dir, 0755);
    char *cmd = g_strdup_printf("xdg-open '%s' 2>/dev/null &", dir);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
    g_free(dir);
}

G_MODULE_EXPORT void on_open_screencasts_folder_clicked(void *widget, gpointer data) {
    (void)widget; (void)data;
    const char *home = g_get_home_dir();
    if (!home) return;
    char *dir = g_build_filename(home, "Відео", "Трансляції з екрана", NULL);
    g_mkdir_with_parents(dir, 0755);
    char *cmd = g_strdup_printf("xdg-open '%s' 2>/dev/null &", dir);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
    g_free(dir);
}

G_MODULE_EXPORT void on_reset_screenshot_defaults_clicked(void *widget, gpointer data) {
    (void)widget; (void)data;
    scr_state.image_format = 0;
    scr_state.image_quality = 95;
    scr_state.show_cursor = TRUE;
    scr_state.shutter_sound = TRUE;
    scr_state.timer_delay = 0;
    scr_state.video_container = 0;
    scr_state.video_codec = 0;
    scr_state.video_fps = 0;
    scr_state.screencast_cursor = TRUE;
    scr_state.record_audio = FALSE;
    scr_state.processing_enabled = TRUE;
    scr_state.processing_target = 2;
    scr_state.processing_algorithm = 0;
    scr_state.processing_scope = 0;
    scr_state.keep_original = FALSE;
    save_screenshot_config();
}

static GtkWidget *get_screenshot_page(void)
{
    static GtkWidget *screenshot_page = NULL;
    if (screenshot_page) return screenshot_page;

    GtkBuilder *builder = gtk_builder_new();
    char *path_to_use = mac_get_localized_ui_path("cc-screenshot-panel.ui");

    GError *error = NULL;
    gboolean loaded = FALSE;
    if (path_to_use) {
        loaded = gtk_builder_add_from_file(builder, path_to_use, &error);
        g_free(path_to_use);
    }

    if (loaded) {
        screenshot_page = GTK_WIDGET(gtk_builder_get_object(builder, "screenshot_page"));
        if (screenshot_page) {
            g_object_ref(screenshot_page);
        }
    } else {
        if (error) {
            g_warning("macW1Y: Failed to load cc-screenshot-panel.ui: %s", error->message);
            g_error_free(error);
        }
    }
    g_object_unref(builder);
    return screenshot_page;
}

static void schedule_update_panel_headerbar(AdwNavigationSplitView *split_view);

G_MODULE_EXPORT void on_screenshot_row_clicked(GtkWidget *widget, gpointer user_data)
{
    (void)user_data;
    AdwNavigationView *nv = NULL;
    if (widget) {
        GtkWidget *ancestor = gtk_widget_get_ancestor(widget, ADW_TYPE_NAVIGATION_VIEW);
        if (ancestor) nv = ADW_NAVIGATION_VIEW(ancestor);
    }
    if (!nv && g_last_split_view) {
        AdwNavigationPage *cp = adw_navigation_split_view_get_content(g_last_split_view);
        if (cp) {
            GList *nav_views = NULL;
            find_navigation_views(GTK_WIDGET(cp), &nav_views);
            if (nav_views) {
                nv = ADW_NAVIGATION_VIEW(nav_views->data);
                g_list_free(nav_views);
            }
        }
    }
    if (nv) {
        if (nv != global_widgets_nav_view && !adw_navigation_view_find_page(nv, "screenshot")) {
            GtkWidget *sp = get_screenshot_page();
            if (sp) {
                adw_navigation_view_add(nv, ADW_NAVIGATION_PAGE(sp));
            }
        }
        adw_navigation_view_push_by_tag(nv, "screenshot");
        if (g_last_split_view) {
            schedule_update_panel_headerbar(g_last_split_view);
        }
    }
}


static void init_mac_settings_css(void) {
    static gboolean css_inited = FALSE;
    if (css_inited) return;
    css_inited = TRUE;

    /* Sync slider glass SVGs to active accent color */
    GSettingsSchemaSource *source = g_settings_schema_source_get_default();
    if (source) {
        GSettingsSchema *schema = g_settings_schema_source_lookup(source, "org.gnome.desktop.interface", TRUE);
        if (schema) {
            GSettings *iface_settings = g_settings_new("org.gnome.desktop.interface");
            if (iface_settings) {
                gchar *accent = g_settings_get_string(iface_settings, "accent-color");
                if (accent) {
                    char *argv[] = {
                        "/home/vitaliy/MACTHEMEFILES/bin/mac-generate-slider-glass.py",
                        accent,
                        NULL
                    };
                    g_spawn_async(NULL, argv, NULL, G_SPAWN_SEARCH_PATH, NULL, NULL, NULL, NULL);
                    g_free(accent);
                }
                g_object_unref(iface_settings);
            }
            g_settings_schema_unref(schema);
        }
    }

    GtkCssProvider *provider = gtk_css_provider_new();
    gtk_css_provider_load_from_string(provider,
        "window.mac-settings-window, "
        "window.mac-settings-window.background, "
        "window.mac-settings-window > dialog-host, "
        "window.mac-settings-window navigation-split-view, "
        "window.mac-settings-window .content-pane, "
        "window.mac-settings-window .mac-settings-content { "
        "  background-color: var(--mac-window-bg, #202022); "
        "  background: #202022; "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "} "
        "window.mac-settings-window navigation-split-view > widget.sidebar-pane, "
        "window.mac-settings-window navigation-split-view .sidebar-pane, "
        "window.mac-settings-window .sidebar-pane, "
        "window.mac-settings-window .sidebar-pane:dir(ltr), "
        "window.mac-settings-window .sidebar-pane:dir(rtl), "
        "window.mac-settings-window navigation-split-view > widget:first-child, "
        "window.mac-settings-window .mac-settings-sidebar, "
        "window.mac-settings-window navigation-view-page.mac-settings-sidebar { "
        "  margin: 6px 0px 6px 6px; "
        "  border: none; "
        "  border-radius: 14px; "
        "  background-color: var(--mac-sidebar-bg, #18181a); "
        "  background: #18181a; "
        "  background-clip: padding-box; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window preferencesgroup > box > box.header, "
        "window.mac-settings-window preferencesgroup box.header, "
        "window.mac-settings-window preferencesgroup > box > box.header label.heading, "
        "window.mac-settings-window preferencesgroup > box > box.header .heading, "
        "window.mac-settings-window preferencesgroup > box > box.header label.title, "
        "window.mac-settings-window preferencesgroup > box > box.header label, "
        "window.mac-settings-window preferencesgroup box.header label, "
        "window.mac-settings-window label.heading, "
        "window.mac-settings-window .heading, "
        "window.mac-settings-window label.title, "
        "window.mac-settings-window #list_label, "
        "window.mac-settings-window #default_label, "
        "window.mac-settings-window #dark_label, "
        "window.mac-settings-window .mac-panel-section-title { "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "} "
        "window.mac-settings-window preferencesgroup > box > box.header button.flat, "
        "window.mac-settings-window preferencesgroup > box > box.header button.flat label { "
        "  color: @accent_bg_color; "
        "  font-weight: 500; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar { "
        "  background-color: transparent; "
        "  padding: 4px 0px; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row { "
        "  min-height: 28px; "
        "  padding: 2px 8px; "
        "  margin: 1.5px 26px 1.5px 10px; "
        "  border-radius: 7px; "
        "  font-size: 13px; "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:hover, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:hover { "
        "  border-radius: 7px; "
        "  background-color: rgba(255, 255, 255, 0.06); "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected { "
        "  border-radius: 7px; "
        "  background-color: rgba(255, 255, 255, 0.10); "
        "  color: @accent_bg_color; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected *, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected * { "
        "  background-color: transparent; "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected:hover, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected:hover { "
        "  background-color: rgba(255, 255, 255, 0.14); "
        "  color: @accent_bg_color; "
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
        "  min-width: 18px; "
        "  min-height: 18px; "
        "  -gtk-icon-size: 18px; "
        "  background-color: transparent; "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  margin-right: 0px; "
        "  margin-left: 0px; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected:not(.mac-settings-account-row) image, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected:not(.mac-settings-account-row) image { "
        "  color: @accent_bg_color; "
        "  background-color: transparent; "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row label, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row label { "
        "  font-size: 13px; "
        "  margin-top: 0px; "
        "  margin-bottom: 0px; "
        "  margin-left: 0px; "
        "  padding-top: 0px; "
        "  padding-bottom: 0px; "
        "  padding-left: 0px; "
        "} "
        "window.mac-settings-window list.mac-settings-sidebar-list row:selected label, "
        "window.mac-settings-window .mac-settings-sidebar list.navigation-sidebar row:selected label { "
        "  color: @accent_bg_color; "
        "  font-weight: 500; "
        "} "
        "window.mac-settings-window .mac-settings-account-row { "
        "  min-height: 48px; "
        "  padding: 6px 10px; "
        "  margin: 6px 26px 18px 10px; "
        "  border-radius: 8px; "
        "  background-color: transparent; "
        "  border-width: 0; "
        "  box-shadow: none; "
        "  outline-width: 0; "
        "} "
        "window.mac-settings-window .mac-settings-account-row:hover { "
        "  border-radius: 8px; "
        "  background-color: var(--mac-row-hover, color-mix(in srgb, @window_fg_color 5%, transparent)); "
        "} "
        "window.mac-settings-window .mac-settings-account-row:selected { "
        "  border-radius: 8px; "
        "  background-color: var(--mac-row-active, color-mix(in srgb, @window_fg_color 8%, transparent)); "
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
        "  color: var(--mac-text-primary, @window_fg_color); "
        "} "
        "window.mac-settings-window .mac-settings-account-row .account-subtitle { "
        "  font-size: 11px; "
        "  color: var(--mac-text-secondary, color-mix(in srgb, @window_fg_color 55%, transparent)); "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar { "
        "  background: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  padding: 4px 26px 4px 10px; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar > revealer > box { "
        "  background: transparent; "
        "  border: none; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar entry { "
        "  min-height: 28px; "
        "  border-radius: 9999px; "
        "  background-color: var(--mac-input-bg, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  border: 1px solid var(--mac-input-border, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  font-size: 13px; "
        "  padding: 2px 12px; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar searchbar entry:focus-within { "
        "  background-color: var(--mac-input-focus-bg, color-mix(in srgb, @window_fg_color 12%, transparent)); "
        "  border-color: var(--mac-input-focus-border, color-mix(in srgb, @window_fg_color 20%, transparent)); "
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
        "  margin-top: 10px; "
        "  margin-bottom: 24px; "
        "} "
        "window.mac-settings-window preferencesgroup:first-child, "
        "window.mac-settings-window preferencespage preferencesgroup:first-child { "
        "  margin-top: 4px; "
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
        "window.mac-settings-window banner button, "
        "window.mac-settings-window adwbanner button, "
        "window.mac-settings-window infobar button, "
        "window.mac-settings-window .permission-infobar button { "
        "  margin-right: -12px; "
        "} "
        "window.mac-settings-window banner button:dir(rtl), "
        "window.mac-settings-window adwbanner button:dir(rtl), "
        "window.mac-settings-window infobar button:dir(rtl), "
        "window.mac-settings-window .permission-infobar button:dir(rtl) { "
        "  margin-left: -12px; "
        "  margin-right: 0px; "
        "} "
        "window.mac-settings-window banner button label, "
        "window.mac-settings-window adwbanner button label, "
        "window.mac-settings-window infobar button label, "
        "window.mac-settings-window .permission-infobar button label { "
        "  border-radius: 9999px; "
        "} "
        "window.mac-settings-window list.boxed-list:not(.nested), "
        "window.mac-settings-window preferencesgroup > box > box > list.boxed-list:not(.nested), "
        "window.mac-settings-window preferencesgroup > box > list.boxed-list:not(.nested), "
        "window.mac-settings-window preferencespage list.boxed-list:not(.nested), "
        "window.mac-settings-window .content-pane list.boxed-list:not(.nested), "
        "window.mac-settings-window .mac-settings-content list.boxed-list:not(.nested) { "
        "  background-color: var(--mac-card-bg, @card_bg_color); "
        "  border: 1px solid var(--mac-card-border, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  border-radius: 14px; "
        "  box-shadow: var(--mac-card-shadow, 0 1px 3px rgba(0, 0, 0, 0.06)); "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "  margin-bottom: 12px; "
        "  padding: 0px; "
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
        "window.mac-settings-window preferencespage .boxed-list-title, "
        "window.mac-settings-window #list_label, "
        "window.mac-settings-window .mac-panel-section-title { "
        "  margin-left: 15px; "
        "  margin-right: 15px; "
        "  margin-bottom: 4px; "
        "  padding-left: 0px; "
        "} "
        "window.mac-settings-window preferencesgroup > box > box.header label.heading, "
        "window.mac-settings-window preferencesgroup > box > box.header .heading, "
        "window.mac-settings-window preferencesgroup > box > box.header label.title, "
        "window.mac-settings-window preferencesgroup > box > box.header label, "
        "window.mac-settings-window preferencesgroup box.header label, "
        "preferencesgroup > box > box.header label.heading, "
        "preferencesgroup > box > box.header .heading, "
        "preferencesgroup > box > box.header label.title, "
        "preferencesgroup > box > box.header label, "
        "preferencesgroup box.header label { "
        "  margin-left: 0px; "
        "  margin-right: 0px; "
        "  padding-left: 0px; "
        "} "
        "window.mac-settings-window row.expander, "
        "window.mac-settings-window adwexpanderrow, "
        "window.mac-settings-window preferencespage list.boxed-list row.expander, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander, "
        "window.mac-settings-window list.boxed-list row.expander { "
        "  padding: 0; "
        "  margin: 0; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  border-radius: 0; "
        "} "
        "window.mac-settings-window row.expander > box > list, "
        "window.mac-settings-window row.expander list.nested, "
        "window.mac-settings-window row.expander list, "
        "window.mac-settings-window adwexpanderrow list, "
        "window.mac-settings-window list.boxed-list row.expander list, "
        "window.mac-settings-window preferencesgroup row.expander list, "
        "window.mac-settings-window preferencespage row.expander list, "
        "window.mac-settings-window preferencesgroup list.nested, "
        "window.mac-settings-window preferencespage list.nested { "
        "  padding: 0; "
        "  margin: 0; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  border-radius: 0; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window row.expander row.header, "
        "window.mac-settings-window row.expander > box.header, "
        "window.mac-settings-window row.expander > box > list > row.header, "
        "window.mac-settings-window adwexpanderrow row.header { "
        "  border-radius: 0; "
        "  border: none; "
        "  box-shadow: none; "
        "  margin: 0; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window row.expander list.nested > row { "
        "  min-height: 35px; "
        "  padding: 0px 14px 0px 24px; "
        "  margin: 0px; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window row.expander list.nested > row:hover { "
        "  background-color: rgba(255, 255, 255, 0.04); "
        "} "
        "window.mac-settings-window row.expander list.nested > row:active { "
        "  background-color: rgba(255, 255, 255, 0.08); "
        "} "
        "window.mac-settings-window list.boxed-list > row:last-child.expander:checked list.nested > row:last-child, "
        "window.mac-settings-window list.boxed-list > row:only-child.expander:checked list.nested > row:last-child { "
        "  border-bottom-left-radius: 14px; "
        "  border-bottom-right-radius: 14px; "
        "  border-top-left-radius: 0px; "
        "  border-top-right-radius: 0px; "
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
        "window.mac-settings-window preferencesgroup > box > box > list > row, "
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
        "  background-color: transparent; "
        "  border-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:first-child, "
        "window.mac-settings-window list.boxed-list row:not(.expander):first-child, "
        "window.mac-settings-window preferencesgroup list > row:first-child, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:first-child, "
        "window.mac-settings-window preferencespage list.boxed-list > row:first-child, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):first-child, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:first-child, "
        "window.mac-settings-window .content-pane list.boxed-list > row:first-child, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):first-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:first-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):first-child, "
        "window.mac-settings-window adwactionrow:first-child, "
        "window.mac-settings-window adwswitchrow:first-child, "
        "window.mac-settings-window adwcomborow:first-child, "
        "window.mac-settings-window adwentryrow:first-child, "
        "window.mac-settings-window adwexpanderrow:first-child, "
        "window.mac-settings-window adwspinrow:first-child, "
        "window.mac-settings-window cclistrow:first-child, "
        "window.mac-settings-window ccwificonnectionrow:first-child, "
        "window.mac-settings-window list.boxed-list > row:first-child.expander row.header { "
        "  border-top-left-radius: 14px; "
        "  border-top-right-radius: 14px; "
        "  border-bottom-left-radius: 0px; "
        "  border-bottom-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:last-child, "
        "window.mac-settings-window list.boxed-list row:not(.expander):last-child, "
        "window.mac-settings-window preferencesgroup list > row:last-child, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:last-child, "
        "window.mac-settings-window preferencespage list.boxed-list > row:last-child, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):last-child, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:last-child, "
        "window.mac-settings-window .content-pane list.boxed-list > row:last-child, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):last-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:last-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):last-child, "
        "window.mac-settings-window adwactionrow:last-child, "
        "window.mac-settings-window adwswitchrow:last-child, "
        "window.mac-settings-window adwcomborow:last-child, "
        "window.mac-settings-window adwentryrow:last-child, "
        "window.mac-settings-window adwexpanderrow:last-child, "
        "window.mac-settings-window adwspinrow:last-child, "
        "window.mac-settings-window cclistrow:last-child, "
        "window.mac-settings-window ccwificonnectionrow:last-child, "
        "window.mac-settings-window list.boxed-list > row:last-child.expander:not(:checked) row.header { "
        "  border-bottom-left-radius: 14px; "
        "  border-bottom-right-radius: 14px; "
        "  border-top-left-radius: 0px; "
        "  border-top-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window list.boxed-list row:not(.expander):not(:first-child):not(:last-child), "
        "window.mac-settings-window preferencesgroup list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window preferencesgroup > box > box > list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window preferencespage list.boxed-list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):not(:first-child):not(:last-child), "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window .content-pane list.boxed-list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):not(:first-child):not(:last-child), "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:not(:first-child):not(:last-child), "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):not(:first-child):not(:last-child), "
        "window.mac-settings-window adwactionrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window adwswitchrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window adwcomborow:not(:first-child):not(:last-child), "
        "window.mac-settings-window adwentryrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window adwexpanderrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window adwspinrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window cclistrow:not(:first-child):not(:last-child), "
        "window.mac-settings-window ccwificonnectionrow:not(:first-child):not(:last-child) { "
        "  border-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:only-child, "
        "window.mac-settings-window list.boxed-list row:not(.expander):only-child, "
        "window.mac-settings-window preferencesgroup list > row:only-child, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:only-child, "
        "window.mac-settings-window preferencespage list.boxed-list > row:only-child, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):only-child, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:only-child, "
        "window.mac-settings-window .content-pane list.boxed-list > row:only-child, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):only-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:only-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):only-child, "
        "window.mac-settings-window adwactionrow:only-child, "
        "window.mac-settings-window adwswitchrow:only-child, "
        "window.mac-settings-window adwcomborow:only-child, "
        "window.mac-settings-window adwentryrow:only-child, "
        "window.mac-settings-window adwexpanderrow:only-child, "
        "window.mac-settings-window adwspinrow:only-child, "
        "window.mac-settings-window cclistrow:only-child, "
        "window.mac-settings-window ccwificonnectionrow:only-child, "
        "window.mac-settings-window preferencespage row.button, "
        "window.mac-settings-window #add_user_button_row, "
        "window.mac-settings-window #add_enterprise_user_button_row { "
        "  border-radius: 14px; "
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
        "window.mac-settings-window preferencesgroup list.boxed-list row:not(.property) label.subtitle, "
        "window.mac-settings-window preferencesgroup list.boxed-list row:not(.property) .subtitle, "
        "window.mac-settings-window list.boxed-list row:not(.property) label.subtitle, "
        "window.mac-settings-window list.boxed-list row:not(.property) .subtitle, "
        "window.mac-settings-window adwactionrow:not(.property) label.subtitle, "
        "window.mac-settings-window adwactionrow:not(.property) .subtitle, "
        "window.mac-settings-window adwswitchrow label.subtitle, "
        "window.mac-settings-window adwswitchrow .subtitle, "
        "window.mac-settings-window adwcomborow label.subtitle, "
        "window.mac-settings-window adwcomborow .subtitle, "
        "window.mac-settings-window adwentryrow label.subtitle, "
        "window.mac-settings-window adwentryrow .subtitle, "
        "window.mac-settings-window cclistrow label.subtitle, "
        "window.mac-settings-window cclistrow .subtitle, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.property) label.subtitle, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.property) .subtitle, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.property) label.subtitle, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.property) .subtitle, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.property) label.subtitle, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.property) .subtitle { "
        "  font-size: 0px; "
        "  min-height: 0px; "
        "  min-width: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "  line-height: 0; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window row.property, "
        "window.mac-settings-window adwactionrow.property, "
        "window.mac-settings-window list.boxed-list row.property { "
        "  min-height: 38px; "
        "  padding: 0px 16px; "
        "} "
        "window.mac-settings-window row.property > box.header, "
        "window.mac-settings-window adwactionrow.property > box.header { "
        "  min-height: 38px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window row.property label.title, "
        "window.mac-settings-window row.property .title, "
        "window.mac-settings-window adwactionrow.property label.title, "
        "window.mac-settings-window adwactionrow.property .title { "
        "  font-size: 13px; "
        "  font-weight: 400; "
        "  color: alpha(@window_fg_color, 0.70); "
        "  min-height: 20px; "
        "  line-height: 1.2; "
        "  opacity: 1; "
        "} "
        "window.mac-settings-window row.property label.subtitle, "
        "window.mac-settings-window row.property .subtitle, "
        "window.mac-settings-window adwactionrow.property label.subtitle, "
        "window.mac-settings-window adwactionrow.property .subtitle { "
        "  font-size: 13px; "
        "  font-weight: 500; "
        "  color: @window_fg_color; "
        "  min-height: 20px; "
        "  min-width: 20px; "
        "  line-height: 1.2; "
        "  opacity: 1; "
        "} "
        "window.mac-settings-window list.boxed-list row image.expander, "
        "window.mac-settings-window list.boxed-list row image:dir(ltr):last-child, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row image:dir(ltr):last-child, "
        "window.mac-settings-window cclistrow image:dir(ltr):last-child { "
        "  color: color-mix(in srgb, @window_fg_color 30%, transparent); "
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
        "window.mac-settings-window list.boxed-list row button.text-button:not(.accent-button), "
        "window.mac-settings-window adwactionrow button.text-button:not(.accent-button) { "
        "  min-height: 26px; "
        "  padding: 2px 10px; "
        "  margin: 0px 3px; "
        "  border-radius: 8px; "
        "} "
        "window.mac-settings-window list.boxed-list row button:not(.text-button):not(.accent-button), "
        "window.mac-settings-window adwactionrow button:not(.text-button):not(.accent-button), "
        "window.mac-settings-window list.boxed-list row button.image-button:not(.accent-button), "
        "window.mac-settings-window adwactionrow button.image-button:not(.accent-button), "
        "window.mac-settings-window list.boxed-list row button.circular:not(.accent-button), "
        "window.mac-settings-window adwactionrow button.circular:not(.accent-button), "
        "window.mac-settings-window list.boxed-list row box.suffixes button:not(.text-button):not(.accent-button), "
        "window.mac-settings-window adwactionrow box.suffixes button:not(.text-button):not(.accent-button) { "
        "  min-width: 28px; "
        "  min-height: 28px; "
        "  padding: 0px; "
        "  margin-top: 10px; "
        "  margin-bottom: 10px; "
        "  margin-left: 3px; "
        "  margin-right: 3px; "
        "  border-radius: 9999px; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window list.boxed-list row button:not(.text-button):not(.accent-button):hover, "
        "window.mac-settings-window adwactionrow button:not(.text-button):not(.accent-button):hover, "
        "window.mac-settings-window list.boxed-list row button.image-button:not(.accent-button):hover, "
        "window.mac-settings-window adwactionrow button.image-button:not(.accent-button):hover { "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.12); "
        "} "
        "window.mac-settings-window list.boxed-list row button:not(.text-button):not(.accent-button):active, "
        "window.mac-settings-window adwactionrow button:not(.text-button):not(.accent-button):active, "
        "window.mac-settings-window list.boxed-list row button.image-button:not(.accent-button):active, "
        "window.mac-settings-window adwactionrow button.image-button:not(.accent-button):active { "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.20); "
        "} "
        "navigation-split-view .sidebar-pane headerbar windowtitle, "
        "navigation-split-view .sidebar-pane headerbar label.title, "
        "overlay-split-view .sidebar-pane headerbar windowtitle, "
        "overlay-split-view .sidebar-pane headerbar label.title, "
        ".sidebar-pane headerbar windowtitle, "
        ".sidebar-pane headerbar label.title { "
        "  opacity: 0; "
        "  font-size: 0px; "
        "  min-width: 0px; "
        "  min-height: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window headerbar windowtitle, "
        "window.mac-settings-window headerbar label.title { "
        "  opacity: 0; "
        "  font-size: 0px; "
        "  min-width: 0px; "
        "  min-height: 0px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "} "
        "window.mac-settings-window dialog headerbar windowtitle, "
        "window.mac-settings-window dialog headerbar label.title { "
        "  opacity: 1; "
        "  font-size: inherit; "
        "} "
        "window.mac-settings-window splitbutton.image-button > button { "
        "  min-width: 28px; "
        "  min-height: 28px; "
        "  padding: 0px; "
        "  border-radius: 9999px; "
        "} "
        "window.mac-settings-window splitbutton.image-button > button:hover { "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.16); "
        "} "
        "window.mac-settings-window splitbutton.image-button > button:active { "
        "  border-radius: 9999px; "
        "  background-color: rgba(255, 255, 255, 0.24); "
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
        "window.mac-settings-window preferencesgroup list > row:hover, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):hover, "
        "window.mac-settings-window preferencespage list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander row.header:hover, "
        "window.mac-settings-window adwactionrow:hover, "
        "window.mac-settings-window adwswitchrow:hover, "
        "window.mac-settings-window adwcomborow:hover, "
        "window.mac-settings-window adwentryrow:hover, "
        "window.mac-settings-window adwexpanderrow:hover, "
        "window.mac-settings-window adwspinrow:hover, "
        "window.mac-settings-window cclistrow:hover, "
        "window.mac-settings-window ccwificonnectionrow:hover, "
        "window.mac-settings-window preferencespage row.button:hover, "
        "window.mac-settings-window #add_user_button_row:hover, "
        "window.mac-settings-window #add_enterprise_user_button_row:hover { "
        "  background-color: rgba(255, 255, 255, 0.06); "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:first-child:hover, "
        "window.mac-settings-window list.boxed-list row:not(.expander):first-child:hover, "
        "window.mac-settings-window preferencesgroup list > row:first-child:hover, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:first-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list > row:first-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):first-child:hover, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:first-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list > row:first-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):first-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:first-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):first-child:hover, "
        "window.mac-settings-window adwactionrow:first-child:hover, "
        "window.mac-settings-window adwswitchrow:first-child:hover, "
        "window.mac-settings-window adwcomborow:first-child:hover, "
        "window.mac-settings-window adwentryrow:first-child:hover, "
        "window.mac-settings-window adwexpanderrow:first-child:hover, "
        "window.mac-settings-window adwspinrow:first-child:hover, "
        "window.mac-settings-window cclistrow:first-child:hover, "
        "window.mac-settings-window ccwificonnectionrow:first-child:hover, "
        "window.mac-settings-window list.boxed-list > row:first-child.expander row.header:hover { "
        "  border-top-left-radius: 14px; "
        "  border-top-right-radius: 14px; "
        "  border-bottom-left-radius: 0px; "
        "  border-bottom-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:last-child:hover, "
        "window.mac-settings-window list.boxed-list row:not(.expander):last-child:hover, "
        "window.mac-settings-window preferencesgroup list > row:last-child:hover, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:last-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list > row:last-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):last-child:hover, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:last-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list > row:last-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):last-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:last-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):last-child:hover, "
        "window.mac-settings-window adwactionrow:last-child:hover, "
        "window.mac-settings-window adwswitchrow:last-child:hover, "
        "window.mac-settings-window adwcomborow:last-child:hover, "
        "window.mac-settings-window adwentryrow:last-child:hover, "
        "window.mac-settings-window adwexpanderrow:last-child:hover, "
        "window.mac-settings-window adwspinrow:last-child:hover, "
        "window.mac-settings-window cclistrow:last-child:hover, "
        "window.mac-settings-window ccwificonnectionrow:last-child:hover, "
        "window.mac-settings-window list.boxed-list > row:last-child.expander:not(:checked) row.header:hover { "
        "  border-bottom-left-radius: 14px; "
        "  border-bottom-right-radius: 14px; "
        "  border-top-left-radius: 0px; "
        "  border-top-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window list.boxed-list row:not(.expander):not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window preferencesgroup list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window preferencespage list.boxed-list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window .content-pane list.boxed-list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwactionrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwswitchrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwcomborow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwentryrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwexpanderrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window adwspinrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window cclistrow:not(:first-child):not(:last-child):hover, "
        "window.mac-settings-window ccwificonnectionrow:not(:first-child):not(:last-child):hover { "
        "  border-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:only-child:hover, "
        "window.mac-settings-window list.boxed-list row:not(.expander):only-child:hover, "
        "window.mac-settings-window preferencesgroup list > row:only-child:hover, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:only-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list > row:only-child:hover, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):only-child:hover, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:only-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list > row:only-child:hover, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):only-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:only-child:hover, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):only-child:hover, "
        "window.mac-settings-window adwactionrow:only-child:hover, "
        "window.mac-settings-window adwswitchrow:only-child:hover, "
        "window.mac-settings-window adwcomborow:only-child:hover, "
        "window.mac-settings-window adwentryrow:only-child:hover, "
        "window.mac-settings-window adwexpanderrow:only-child:hover, "
        "window.mac-settings-window adwspinrow:only-child:hover, "
        "window.mac-settings-window cclistrow:only-child:hover, "
        "window.mac-settings-window ccwificonnectionrow:only-child:hover, "
        "window.mac-settings-window preferencespage row.button:hover, "
        "window.mac-settings-window #add_user_button_row:hover, "
        "window.mac-settings-window #add_enterprise_user_button_row:hover { "
        "  border-radius: 14px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:active, "
        "window.mac-settings-window list.boxed-list row:not(.expander):active, "
        "window.mac-settings-window list.boxed-list row.expander row.header:active, "
        "window.mac-settings-window preferencesgroup list > row:active, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:active, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):active, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:active, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):active, "
        "window.mac-settings-window preferencespage list.boxed-list row.expander row.header:active, "
        "window.mac-settings-window .content-pane list.boxed-list row.expander row.header:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row.expander row.header:active, "
        "window.mac-settings-window adwactionrow:active, "
        "window.mac-settings-window adwswitchrow:active, "
        "window.mac-settings-window adwcomborow:active, "
        "window.mac-settings-window adwentryrow:active, "
        "window.mac-settings-window adwexpanderrow:active, "
        "window.mac-settings-window adwspinrow:active, "
        "window.mac-settings-window cclistrow:active, "
        "window.mac-settings-window ccwificonnectionrow:active, "
        "window.mac-settings-window preferencespage row.button:active, "
        "window.mac-settings-window #add_user_button_row:active, "
        "window.mac-settings-window #add_enterprise_user_button_row:active { "
        "  background-color: rgba(255, 255, 255, 0.09); "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:first-child:active, "
        "window.mac-settings-window list.boxed-list row:not(.expander):first-child:active, "
        "window.mac-settings-window preferencesgroup list > row:first-child:active, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:first-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list > row:first-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):first-child:active, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:first-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list > row:first-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):first-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:first-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):first-child:active, "
        "window.mac-settings-window adwactionrow:first-child:active, "
        "window.mac-settings-window adwswitchrow:first-child:active, "
        "window.mac-settings-window adwcomborow:first-child:active, "
        "window.mac-settings-window adwentryrow:first-child:active, "
        "window.mac-settings-window adwexpanderrow:first-child:active, "
        "window.mac-settings-window adwspinrow:first-child:active, "
        "window.mac-settings-window cclistrow:first-child:active, "
        "window.mac-settings-window ccwificonnectionrow:first-child:active, "
        "window.mac-settings-window list.boxed-list > row:first-child.expander row.header:active { "
        "  border-top-left-radius: 14px; "
        "  border-top-right-radius: 14px; "
        "  border-bottom-left-radius: 0px; "
        "  border-bottom-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:last-child:active, "
        "window.mac-settings-window list.boxed-list row:not(.expander):last-child:active, "
        "window.mac-settings-window preferencesgroup list > row:last-child:active, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:last-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list > row:last-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):last-child:active, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:last-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list > row:last-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):last-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:last-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):last-child:active, "
        "window.mac-settings-window adwactionrow:last-child:active, "
        "window.mac-settings-window adwswitchrow:last-child:active, "
        "window.mac-settings-window adwcomborow:last-child:active, "
        "window.mac-settings-window adwentryrow:last-child:active, "
        "window.mac-settings-window adwexpanderrow:last-child:active, "
        "window.mac-settings-window adwspinrow:last-child:active, "
        "window.mac-settings-window cclistrow:last-child:active, "
        "window.mac-settings-window ccwificonnectionrow:last-child:active, "
        "window.mac-settings-window list.boxed-list > row:last-child.expander:not(:checked) row.header:active { "
        "  border-bottom-left-radius: 14px; "
        "  border-bottom-right-radius: 14px; "
        "  border-top-left-radius: 0px; "
        "  border-top-right-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window list.boxed-list row:not(.expander):not(:first-child):not(:last-child):active, "
        "window.mac-settings-window preferencesgroup list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window preferencespage list.boxed-list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):not(:first-child):not(:last-child):active, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window .content-pane list.boxed-list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):not(:first-child):not(:last-child):active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwactionrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwswitchrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwcomborow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwentryrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwexpanderrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window adwspinrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window cclistrow:not(:first-child):not(:last-child):active, "
        "window.mac-settings-window ccwificonnectionrow:not(:first-child):not(:last-child):active { "
        "  border-radius: 0px; "
        "} "
        "window.mac-settings-window list.boxed-list > row:only-child:active, "
        "window.mac-settings-window list.boxed-list row:not(.expander):only-child:active, "
        "window.mac-settings-window preferencesgroup list > row:only-child:active, "
        "window.mac-settings-window preferencesgroup > box > box > list > row:only-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list > row:only-child:active, "
        "window.mac-settings-window preferencespage list.boxed-list row:not(.expander):only-child:active, "
        "window.mac-settings-window preferencespage list:not(.boxed-list) > row:only-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list > row:only-child:active, "
        "window.mac-settings-window .content-pane list.boxed-list row:not(.expander):only-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row:only-child:active, "
        "window.mac-settings-window .mac-settings-content list.boxed-list row:not(.expander):only-child:active, "
        "window.mac-settings-window adwactionrow:only-child:active, "
        "window.mac-settings-window adwswitchrow:only-child:active, "
        "window.mac-settings-window adwcomborow:only-child:active, "
        "window.mac-settings-window adwentryrow:only-child:active, "
        "window.mac-settings-window adwexpanderrow:only-child:active, "
        "window.mac-settings-window adwspinrow:only-child:active, "
        "window.mac-settings-window cclistrow:only-child:active, "
        "window.mac-settings-window ccwificonnectionrow:only-child:active, "
        "window.mac-settings-window preferencespage row.button:active, "
        "window.mac-settings-window #add_user_button_row:active, "
        "window.mac-settings-window #add_enterprise_user_button_row:active { "
        "  border-radius: 14px; "
        "} "
        "window.mac-settings-window list.boxed-list > row + row, "
        "window.mac-settings-window preferencesgroup > box > box > list.boxed-list > row + row, "
        "window.mac-settings-window preferencespage list.boxed-list > row + row, "
        "window.mac-settings-window .content-pane list.boxed-list > row + row, "
        "window.mac-settings-window .mac-settings-content list.boxed-list > row + row, "
        "window.mac-settings-window row.expander:checked list.nested, "
        "window.mac-settings-window row.expander list.nested > row { "
        "  border-top: 1px solid transparent; "
        "  border-image: linear-gradient(to right, transparent 0%, transparent 2%, rgba(255, 255, 255, 0.07) 2%, rgba(255, 255, 255, 0.07) 98%, transparent 98%, transparent 100%) 1 0 0 0/1px 0 0 0 stretch; "
        "} "
        "window.mac-settings-window list.boxed-list > row:hover + row, "
        "window.mac-settings-window preferencesgroup > box > box > list.boxed-list > row:hover + row, "
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
        "window.mac-settings-window toolbarview > .top-bar, "
        "window.mac-settings-window toolbarview > .top-bar.flat, "
        "window.mac-settings-window toolbarview > .top-bar.raised, "
        "window.mac-settings-window toolbarview > .top-bar.raised.border, "
        "window.mac-settings-window toolbarview > revealer.top-bar, "
        "window.mac-settings-window toolbarview > .top-bar, "
        "window.mac-settings-window toolbarview > .top-bar.flat, "
        "window.mac-settings-window headerbar, "
        "window.mac-settings-window headerbar.flat, "
        "window.mac-settings-window headerbar.default-decoration, "
        "window.mac-settings-window .mac-settings-content-headerbar, "
        "window.mac-settings-window .mac-settings-content-headerbar.has-view-switcher, "
        "window.mac-settings-window .mac-settings-switcher-headerbar, "
        "window.mac-settings-window .panel-has-switcher .mac-settings-content-headerbar { "
        "  min-height: 48px; "
        "  background: var(--mac-window-bg, #202022); "
        "  background-color: var(--mac-window-bg, #202022); "
        "  background-image: none; "
        "  border: none; "
        "  border-bottom: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window .mac-settings-sidebar, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview > .top-bar, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview > .top-bar headerbar, "
        "window.mac-settings-window .mac-settings-sidebar headerbar, "
        "window.mac-settings-window .mac-settings-sidebar-headerbar, "
        "window.mac-settings-window navigation-split-view > widget:first-child, "
        "window.mac-settings-window navigation-split-view > widget:first-child toolbarview, "
        "window.mac-settings-window navigation-split-view > widget:first-child toolbarview > .top-bar, "
        "window.mac-settings-window navigation-split-view > widget:first-child headerbar, "
        "window.mac-settings-window .sidebar-pane headerbar, "
        "window.mac-settings-window .sidebar-pane toolbarview > .top-bar, "
        "window.mac-settings-window .sidebar-pane toolbarview > .top-bar headerbar { "
        "  min-height: 48px; "
        "  background: var(--mac-sidebar-bg, #18181a); "
        "  background-color: var(--mac-sidebar-bg, #18181a); "
        "  background-image: none; "
        "  border: none; "
        "  border-bottom: none; "
        "  box-shadow: none; "
        "  margin-top: -7px; "
        "} "
        "window.mac-settings-window viewswitcher, "
        "window.mac-settings-window .mac-view-switcher, "
        "window.mac-settings-window headerbar viewswitcher { "
        "  min-height: 28px; "
        "  border-radius: 9999px; "
        "  padding: 3px; "
        "  background-color: var(--mac-input-bg, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  background-image: none; "
        "  border: 1px solid var(--mac-input-border, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.10); "
        "} "
        "window.mac-settings-window viewswitcher button.toggle, "
        "window.mac-settings-window .mac-view-switcher button.toggle, "
        "window.mac-settings-window headerbar viewswitcher button.toggle { "
        "  min-height: 24px; "
        "  padding: 3px 14px; "
        "  margin: 0 1px; "
        "  border-radius: 9999px; "
        "  font-size: 13px; "
        "  color: var(--mac-text-secondary, color-mix(in srgb, @window_fg_color 70%, transparent)); "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  transition: color 150ms ease-out; "
        "} "
        "window.mac-settings-window viewswitcher button.toggle:hover, "
        "window.mac-settings-window .mac-view-switcher button.toggle:hover, "
        "window.mac-settings-window headerbar viewswitcher button.toggle:hover { "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  background-color: var(--mac-row-hover, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "} "
        "window.mac-settings-window viewswitcher button.toggle:checked, "
        "window.mac-settings-window .mac-view-switcher button.toggle:checked, "
        "window.mac-settings-window headerbar viewswitcher button.toggle:checked { "
        "  color: var(--mac-text-primary, @window_fg_color); "
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
        "window.mac-settings-window preferencespage scrolledwindow undershoot.top, "
        "window.mac-settings-window preferencespage > scrolledwindow > undershoot.top, "
        "window.mac-settings-window .content-pane scrolledwindow undershoot.top, "
        "window.mac-settings-window toolbarview.undershoot-top scrolledwindow undershoot.top, "
        "window.mac-settings-window toolbarview.undershoot-top scrolledwindow > undershoot.top, "
        "window.mac-settings-window .panel-has-switcher preferencespage scrolledwindow undershoot.top, "
        "window.mac-settings-window .panel-has-switcher scrolledwindow undershoot.top { "
        "  min-height: 48px; "
        "  background: linear-gradient(to bottom, "
        "    @window_bg_color 0%, "
        "    alpha(@window_bg_color, 0.90) 16px, "
        "    alpha(@window_bg_color, 0.40) 32px, "
        "    transparent 48px); "
        "  border: none; "
        "  box-shadow: none; "
        "  opacity: 1; "
        "} "
        "window.mac-settings-window preferencespage scrolledwindow undershoot.bottom, "
        "window.mac-settings-window preferencespage > scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .content-pane scrolledwindow undershoot.bottom, "
        "window.mac-settings-window toolbarview.undershoot-bottom scrolledwindow undershoot.bottom, "
        "window.mac-settings-window toolbarview.undershoot-bottom scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .panel-has-switcher preferencespage scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .panel-has-switcher scrolledwindow undershoot.bottom { "
        "  min-height: 28px; "
        "  background: linear-gradient(to top, "
        "    @window_bg_color 0%, "
        "    alpha(@window_bg_color, 0.90) 10px, "
        "    alpha(@window_bg_color, 0.40) 18px, "
        "    transparent 28px); "
        "  border: none; "
        "  box-shadow: none; "
        "  opacity: 1; "
        "} "
        "window.mac-settings-window .sidebar-pane scrolledwindow undershoot.top, "
        "window.mac-settings-window undershoot, "
        "window.mac-settings-window undershoot.top, "
        "window.mac-settings-window undershoot.bottom, "
        "window.mac-settings-window scrolledwindow undershoot, "
        "window.mac-settings-window scrolledwindow undershoot.top, "
        "window.mac-settings-window scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .sidebar-pane scrolledwindow undershoot.top, "
        "window.mac-settings-window .sidebar-pane scrolledwindow > undershoot.top, "
        "window.mac-settings-window .sidebar-pane scrolledwindow.undershoot-top > undershoot.top, "
        "window.mac-settings-window .sidebar-pane toolbarview.undershoot-top scrolledwindow > undershoot.top, "
        "window.mac-settings-window .sidebar-pane toolbarview.undershoot-top scrolledwindow undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow > undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow.undershoot-top > undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview.undershoot-top scrolledwindow > undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview.undershoot-top scrolledwindow undershoot.top, "
        "window.mac-settings-window .mac-settings-sidebar-list undershoot.top, "
        "navigation-split-view .sidebar-pane scrolledwindow undershoot.top, "
        "navigation-split-view .sidebar-pane scrolledwindow > undershoot.top, "
        "navigation-split-view .sidebar-pane scrolledwindow.undershoot-top > undershoot.top, "
        "navigation-split-view .sidebar-pane toolbarview.undershoot-top scrolledwindow > undershoot.top, "
        "navigation-split-view > .sidebar-pane scrolledwindow undershoot.top, "
        "navigation-split-view > .sidebar-pane scrolledwindow > undershoot.top, "
        "navigation-split-view > .sidebar-pane scrolledwindow.undershoot-top > undershoot.top, "
        "navigation-split-view > .sidebar-pane toolbarview.undershoot-top scrolledwindow > undershoot.top { "
        "  min-height: 0px; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window .sidebar-pane scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .sidebar-pane scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .sidebar-pane scrolledwindow.undershoot-bottom > undershoot.bottom, "
        "window.mac-settings-window .sidebar-pane toolbarview.undershoot-bottom scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .sidebar-pane toolbarview.undershoot-bottom scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow.undershoot-bottom > undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview.undershoot-bottom scrolledwindow > undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar toolbarview.undershoot-bottom scrolledwindow undershoot.bottom, "
        "window.mac-settings-window .mac-settings-sidebar-list undershoot.bottom, "
        "navigation-split-view .sidebar-pane scrolledwindow undershoot.bottom, "
        "navigation-split-view .sidebar-pane scrolledwindow > undershoot.bottom, "
        "navigation-split-view .sidebar-pane scrolledwindow.undershoot-bottom > undershoot.bottom, "
        "navigation-split-view .sidebar-pane toolbarview.undershoot-bottom scrolledwindow > undershoot.bottom, "
        "navigation-split-view > .sidebar-pane scrolledwindow undershoot.bottom, "
        "navigation-split-view > .sidebar-pane scrolledwindow > undershoot.bottom, "
        "navigation-split-view > .sidebar-pane scrolledwindow.undershoot-bottom > undershoot.bottom, "
        "navigation-split-view > .sidebar-pane toolbarview.undershoot-bottom scrolledwindow > undershoot.bottom { "
        "  min-height: 0px; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window .sidebar-pane undershoot.left, "
        "window.mac-settings-window .sidebar-pane undershoot.right, "
        "window.mac-settings-window .sidebar-pane scrolledwindow > undershoot.left, "
        "window.mac-settings-window .sidebar-pane scrolledwindow > undershoot.right, "
        "window.mac-settings-window .mac-settings-sidebar undershoot.left, "
        "window.mac-settings-window .mac-settings-sidebar undershoot.right, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow > undershoot.left, "
        "window.mac-settings-window .mac-settings-sidebar scrolledwindow > undershoot.right, "
        "navigation-split-view > .sidebar-pane undershoot.left, "
        "navigation-split-view > .sidebar-pane undershoot.right { "
        "  min-height: 0px; "
        "  min-width: 0px; "
        "  background: none; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  opacity: 0; "
        "} "
        "window.mac-settings-window .mac-nav-header-box { "
        "  margin-left: 6px; "
        "  border-spacing: 12px; "
        "} "
        "window.mac-settings-window .mac-nav-pill, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill { "
        "  padding: 0; "
        "  border-radius: 9999px; "
        "  background-color: var(--mac-input-bg, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  border: 1px solid var(--mac-input-border, color-mix(in srgb, @window_fg_color 8%, transparent)); "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button, "
        "window.mac-settings-window .mac-nav-btn { "
        "  min-height: 28px; "
        "  min-width: 28px; "
        "  padding: 0; "
        "  margin: 0; "
        "  border-radius: 9999px; "
        "  border-top-left-radius: 9999px; "
        "  border-bottom-left-radius: 9999px; "
        "  border-top-right-radius: 9999px; "
        "  border-bottom-right-radius: 9999px; "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border: none; "
        "  box-shadow: none; "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  transition: background-color 150ms ease-out; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button image, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button image, "
        "window.mac-settings-window .mac-nav-btn image { "
        "  -gtk-icon-size: 14px; "
        "  margin: 0; "
        "  padding: 0; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:first-child, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:first-child, "
        "window.mac-settings-window .mac-nav-pill > button:last-child, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:last-child, "
        "window.mac-settings-window .mac-nav-pill > button + button, "
        "window.mac-settings-window .mc-toggle-group > button + button { "
        "  border-radius: 9999px; "
        "  border-top-left-radius: 9999px; "
        "  border-bottom-left-radius: 9999px; "
        "  border-top-right-radius: 9999px; "
        "  border-bottom-right-radius: 9999px; "
        "  border-left: none; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:hover, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:hover, "
        "window.mac-settings-window .mac-nav-btn:hover { "
        "  background-color: var(--mac-row-hover, color-mix(in srgb, @window_fg_color 12%, transparent)); "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  border-radius: 9999px; "
        "  border-top-left-radius: 9999px; "
        "  border-bottom-left-radius: 9999px; "
        "  border-top-right-radius: 9999px; "
        "  border-bottom-right-radius: 9999px; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:active, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:active, "
        "window.mac-settings-window .mac-nav-btn:active { "
        "  background-color: var(--mac-row-active, color-mix(in srgb, @window_fg_color 20%, transparent)); "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  border-radius: 9999px; "
        "  border-top-left-radius: 9999px; "
        "  border-bottom-left-radius: 9999px; "
        "  border-top-right-radius: 9999px; "
        "  border-bottom-right-radius: 9999px; "
        "} "
        "window.mac-settings-window .mac-nav-pill > button:disabled, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill > button:disabled, "
        "window.mac-settings-window .mac-nav-btn:disabled { "
        "  color: var(--mac-text-disabled, color-mix(in srgb, @window_fg_color 30%, transparent)); "
        "  background: transparent; "
        "  background-color: transparent; "
        "  border-radius: 9999px; "
        "} "
        "window.mac-settings-window .mac-nav-pill separator, "
        "window.mac-settings-window .mc-toggle-group.mac-nav-pill separator, "
        "window.mac-settings-window separator.mac-nav-sep { "
        "  min-width: 1px; "
        "  background-color: var(--mac-card-sep, color-mix(in srgb, @window_fg_color 12%, transparent)); "
        "  border: none; "
        "  opacity: 1; "
        "  margin: 4px 0px; "
        "} "
        "window.mac-settings-window .mac-panel-title-label { "
        "  font-size: 14px; "
        "  font-weight: 700; "
        "  color: var(--mac-text-primary, @window_fg_color); "
        "  margin-left: 4px; "
        "  margin-top: 1px; "
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
        "  background-color: @accent_bg_color; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "window.mac-settings-window switch:checked:hover { "
        "  background-color: color-mix(in srgb, @accent_bg_color 85%, white); "
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
        "  background-color: @accent_bg_color; "
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
        "window.mac-settings-window switch:not(:checked):active > slider, "
        "window.mac-settings-window switch:not(:checked) > slider:active, "
        "window.mac-settings-window switch:not(:checked):focus > slider { "
        "  min-width: 26px; "
        "  min-height: 20px; "
        "  margin: 2px 1px; "
        "  border-radius: 9999px; "
        "  background-color: #d1d1d6; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.15); "
        "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28); "
        "  transition: min-width 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              margin 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              background-color 100ms ease-in, "
        "              box-shadow 100ms cubic-bezier(0, 0, 0.2, 1); "
        "} "
        "window.mac-settings-window switch:checked:active > slider, "
        "window.mac-settings-window switch:checked > slider:active, "
        "window.mac-settings-window switch:checked:focus > slider { "
        "  min-width: 26px; "
        "  min-height: 20px; "
        "  margin: 2px 1px; "
        "  border-radius: 9999px; "
        "  background-color: @accent_bg_color; "
        "  background-image: none; "
        "  border: 2px solid #ffffff; "
        "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35); "
        "  transition: min-width 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              margin 100ms cubic-bezier(0, 0, 0.2, 1), "
        "              background-color 100ms ease-in, "
        "              box-shadow 100ms cubic-bezier(0, 0, 0.2, 1); "
        "} "
        "window.mac-settings-window scale, "
        "window.mac-settings-window scale.horizontal { "
        "  min-height: 24px; "
        "  min-width: 24px; "
        "  padding: 2px 0px; "
        "  margin: 0px; "
        "} "
        "window.mac-settings-window scale > value { "
        "  font-size: 11px; "
        "  margin: 0px; "
        "  padding: 0px; "
        "  color: rgba(255, 255, 255, 0.45); "
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
        "  background-color: @accent_bg_color; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "} "
        "@keyframes macSliderExpandH { "
        "  0% { transform: scale(0.75, 0.90); opacity: 0.90; } "
        "  60% { transform: scale(1.05, 1.02); opacity: 1.0; } "
        "  100% { transform: scale(1.0, 1.0); opacity: 1.0; } "
        "} "
        "@keyframes macSliderExpandV { "
        "  0% { transform: scale(0.90, 0.75); opacity: 0.90; } "
        "  60% { transform: scale(1.02, 1.05); opacity: 1.0; } "
        "  100% { transform: scale(1.0, 1.0); opacity: 1.0; } "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider, "
        "window.mac-settings-window scale.horizontal:not(.marks-before):not(.marks-after) > trough > slider, "
        "window.mac-settings-window scale.horizontal.marks-before > trough > slider, "
        "window.mac-settings-window scale.horizontal.marks-after > trough > slider, "
        "window.mac-settings-window scale.horizontal slider, "
        "window.mac-settings-window scale > trough > slider, "
        "window.mac-settings-window scale slider { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: -8px -10px; "
        "  border-radius: 9999px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.12); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.12); "
        "  outline: none; "
        "  transform: scale(1.0); "
        "  transition: min-width 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              min-height 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              margin 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              background-color 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              box-shadow 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              border-color 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              transform 240ms cubic-bezier(0.16, 1, 0.3, 1); "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider:hover, "
        "window.mac-settings-window scale.horizontal.marks-before > trough > slider:hover, "
        "window.mac-settings-window scale.horizontal.marks-after > trough > slider:hover, "
        "window.mac-settings-window scale.horizontal slider:hover, "
        "window.mac-settings-window scale > trough > slider:hover, "
        "window.mac-settings-window scale slider:hover { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: -8px -10px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.15); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 3px 8px rgba(0, 0, 0, 0.16); "
        "  transform: scale(1.05); "
        "} "
        "window.mac-settings-window scale.horizontal > trough > slider:active, "
        "window.mac-settings-window scale.horizontal:not(.marks-before):not(.marks-after) > trough > slider:active, "
        "window.mac-settings-window scale.horizontal.marks-before > trough > slider:active, "
        "window.mac-settings-window scale.horizontal.marks-after > trough > slider:active, "
        "window.mac-settings-window scale.horizontal slider:active, "
        "window.mac-settings-window scale > trough > slider:active, "
        "window.mac-settings-window scale slider:active { "
        "  min-width: 38px; "
        "  min-height: 20px; "
        "  margin: -8px -17px; "
        "  border-radius: 9999px; "
        "  background-color: transparent; "
        "  background-image: url('file:///home/vitaliy/.config/gtk-4.0/assets/scalable/slider-glass.svg'); "
        "  background-repeat: no-repeat; "
        "  background-size: 100% 100%; "
        "  border: none; "
        "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.40), 0 1px 3px rgba(0, 0, 0, 0.20); "
        "  outline: none; "
        "  animation: macSliderExpandH 220ms cubic-bezier(0.16, 1, 0.3, 1); "
        "  transform: scale(1.0); "
        "} "
        "window.mac-settings-window scale.vertical > trough > slider, "
        "window.mac-settings-window scale.vertical slider { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: -10px -8px; "
        "  border-radius: 9999px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.18); "
        "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 3px 8px rgba(0, 0, 0, 0.22); "
        "  outline: none; "
        "  transform: scale(1.0); "
        "  transition: min-width 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              min-height 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              margin 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              background-color 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              box-shadow 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              border-color 240ms cubic-bezier(0.16, 1, 0.3, 1), "
        "              transform 240ms cubic-bezier(0.16, 1, 0.3, 1); "
        "} "
        "window.mac-settings-window scale.vertical > trough > slider:hover, "
        "window.mac-settings-window scale.vertical slider:hover { "
        "  min-width: 20px; "
        "  min-height: 20px; "
        "  margin: -10px -8px; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.22); "
        "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.40), 0 3px 10px rgba(0, 0, 0, 0.25); "
        "  transform: scale(1.05); "
        "} "
        "window.mac-settings-window scale.vertical > trough > slider:active, "
        "window.mac-settings-window scale.vertical slider:active { "
        "  min-width: 20px; "
        "  min-height: 38px; "
        "  margin: -17px -8px; "
        "  border-radius: 9999px; "
        "  background-color: transparent; "
        "  background-image: url('file:///home/vitaliy/.config/gtk-4.0/assets/scalable/slider-glass-vertical.svg'); "
        "  background-repeat: no-repeat; "
        "  background-size: 100% 100%; "
        "  border: none; "
        "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.40), 0 1px 3px rgba(0, 0, 0, 0.20); "
        "  outline: none; "
        "  animation: macSliderExpandV 220ms cubic-bezier(0.16, 1, 0.3, 1); "
        "  transform: scale(1.0); "
        "} "
        "window.mac-settings-window scale:disabled { "
        "  filter: none; "
        "  opacity: 1.0; "
        "} "
        "window.mac-settings-window scale:disabled > trough { "
        "  background-color: rgba(255, 255, 255, 0.10); "
        "} "
        "window.mac-settings-window scale:disabled > trough > highlight { "
        "  background-color: alpha(@accent_bg_color, 0.50); "
        "} "
        "window.mac-settings-window scale:disabled > trough > slider, "
        "window.mac-settings-window scale > trough > slider:disabled { "
        "  filter: none; "
        "  opacity: 1.0; "
        "  background-color: #ffffff; "
        "  background-image: none; "
        "  border: 1px solid rgba(0, 0, 0, 0.10); "
        "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22); "
        "} "
        "window.mac-settings-window button.suggested-action, "
        "window.mac-settings-window menubutton.suggested-action > button, "
        "window.mac-settings-window splitbutton.suggested-action > button, "
        "window.mac-settings-window splitbutton.suggested-action > menubutton > button { "
        "  background-color: @accent_bg_color; "
        "  color: @accent_fg_color; "
        "} "
        "button.mac-action-accent-btn, "
        "window.mac-settings-window button.mac-action-accent-btn, "
        "window.mac-settings-window button.suggested-action.circular { "
        "  background-color: @accent_bg_color; "
        "  color: #ffffff; "
        "  border: none; "
        "  box-shadow: none; "
        "  min-width: 28px; "
        "  min-height: 28px; "
        "  padding: 4px; "
        "  border-radius: 9999px; "
        "} "
        "button.mac-action-accent-btn:hover, "
        "window.mac-settings-window button.mac-action-accent-btn:hover, "
        "window.mac-settings-window button.suggested-action.circular:hover { "
        "  background-color: color-mix(in srgb, @accent_bg_color 85%, white); "
        "  color: #ffffff; "
        "} "
        "button.mac-action-accent-btn image, "
        "button.mac-action-accent-btn GtkImage, "
        "window.mac-settings-window button.mac-action-accent-btn image, "
        "window.mac-settings-window button.mac-action-accent-btn GtkImage, "
        "window.mac-settings-window button.suggested-action image, "
        "window.mac-settings-window button.suggested-action.circular image { "
        "  color: #ffffff; "
        "  -gtk-icon-palette: error #ffffff, success #ffffff, warning #ffffff; "
        "} "
        "window.mac-settings-window button.suggested-action:hover, "
        "window.mac-settings-window menubutton.suggested-action > button:hover, "
        "window.mac-settings-window splitbutton.suggested-action > button:hover, "
        "window.mac-settings-window splitbutton.suggested-action > menubutton > button:hover { "
        "  background-color: color-mix(in srgb, @accent_bg_color 85%, white); "
        "  color: @accent_fg_color; "
        "} "
        "button.mac-action-accent-btn:active, "
        "window.mac-settings-window button.mac-action-accent-btn:active, "
        "window.mac-settings-window button.suggested-action.circular:active { "
        "  background-color: color-mix(in srgb, @accent_bg_color 75%, black); "
        "  color: #ffffff; "
        "  border-radius: 9999px; "
        "} "
        "window.mac-settings-window button.suggested-action:active, "
        "window.mac-settings-window button.suggested-action:checked, "
        "window.mac-settings-window menubutton.suggested-action > button:active, "
        "window.mac-settings-window menubutton.suggested-action > button:checked, "
        "window.mac-settings-window splitbutton.suggested-action > button:active, "
        "window.mac-settings-window splitbutton.suggested-action > button:checked { "
        "  background-color: color-mix(in srgb, @accent_bg_color 80%, black); "
        "  color: @accent_fg_color; "
        "} "
        "window.mac-settings-window button:checked:not(.flat):not(.accent-button):not(.background-preview-button), "
        "window.mac-settings-window togglebutton:checked:not(.flat):not(.background-preview-button), "
        "window.mac-settings-window .mac-pill-btn.active, "
        "window.mac-settings-window .mac-pill-btn:checked { "
        "  background-color: @accent_bg_color; "
        "  color: @accent_fg_color; "
        "} "
        "window.mac-settings-window check:checked, "
        "window.mac-settings-window check:indeterminate, "
        "window.mac-settings-window radio:checked, "
        "window.mac-settings-window radio:indeterminate { "
        "  background-color: @accent_bg_color; "
        "  color: @accent_fg_color; "
        "} "
        "window.mac-settings-window .background-preview-button, "
        "window.mac-settings-window button.background-preview-button, "
        "window.mac-settings-window togglebutton.background-preview-button, "
        ".background-preview-button { "
        "  border-radius: 14px; "
        "  padding: 4px; "
        "  background: none; "
        "  background-color: transparent; "
        "  background-image: none; "
        "  border: none; "
        "  box-shadow: none; "
        "  outline: none; "
        "  transition: box-shadow 150ms ease; "
        "} "
        "window.mac-settings-window .background-preview-button:hover, "
        ".background-preview-button:hover { "
        "  border-radius: 14px; "
        "  box-shadow: 0 0 0 2px color-mix(in srgb, @window_fg_color 25%, transparent); "
        "} "
        "window.mac-settings-window .background-preview-button:checked, "
        "window.mac-settings-window togglebutton.background-preview-button:checked, "
        ".background-preview-button:checked { "
        "  border-radius: 14px; "
        "  box-shadow: 0 0 0 3px @accent_bg_color; "
        "  background: none; "
        "  background-color: transparent; "
        "} "
        "window.mac-settings-window .background-preview-button:focus:focus-visible, "
        "window.mac-settings-window .background-preview-button:checked:focus:focus-visible { "
        "  border-radius: 14px; "
        "  box-shadow: 0 0 0 3px @accent_bg_color, 0 0 0 5px color-mix(in srgb, @accent_bg_color 30%, transparent); "
        "} "
        "background-preview { "
        "  border-radius: 12px; "
        "} "
        "background-preview .window { "
        "  border-radius: 8px; "
        "} "
        "#default_preview .window, "
        "background-preview .window.front.light, "
        "background-preview .window.back { "
        "  background-color: rgba(255, 255, 255, 0.85); "
        "  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(240, 240, 245, 0.80) 100%); "
        "  border: 1px solid rgba(255, 255, 255, 0.85); "
        "  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.95); "
        "} "
        "#default_preview .window .header-bar, "
        "background-preview .window.front.light .header-bar { "
        "  background-color: rgba(255, 255, 255, 0.94); "
        "  border-bottom: 1px solid rgba(0, 0, 0, 0.08); "
        "  min-height: 15px; "
        "} "
        "#default_preview .window .sidebar, "
        "background-preview .window.front.light .sidebar { "
        "  background-color: rgba(235, 235, 242, 0.80); "
        "  border-right: 1px solid rgba(0, 0, 0, 0.08); "
        "  min-width: 30px; "
        "} "
        "#dark_preview .window, "
        "background-preview .window.dark, "
        "background-preview .window.front.dark { "
        "  background-color: rgba(34, 34, 38, 0.86); "
        "  background-image: linear-gradient(180deg, rgba(50, 50, 56, 0.92) 0%, rgba(28, 28, 32, 0.82) 100%); "
        "  border: 1px solid rgba(255, 255, 255, 0.15); "
        "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.18); "
        "} "
        "#dark_preview .window .header-bar, "
        "background-preview .window.dark .header-bar { "
        "  background-color: rgba(52, 52, 58, 0.94); "
        "  border-bottom: 1px solid rgba(0, 0, 0, 0.40); "
        "  min-height: 15px; "
        "} "
        "#dark_preview .window .sidebar, "
        "background-preview .window.dark .sidebar { "
        "  background-color: rgba(28, 28, 32, 0.82); "
        "  border-right: 1px solid rgba(0, 0, 0, 0.40); "
        "  min-width: 30px; "
        "}"
    );
    gtk_style_context_add_provider_for_display(
        gdk_display_get_default(),
        GTK_STYLE_PROVIDER(provider),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION + 800
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

    GtkWidget *sub_lbl = gtk_label_new(mac_tr("apple_account", "Акаунт"));
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

static const char *get_panel_id_from_widget(GtkWidget *widget);

typedef gboolean (*CcShellSetActivePanelFromIdFunc)(gpointer shell, const char *id, GVariant *parameters, GError **error);
static CcShellSetActivePanelFromIdFunc orig_cc_shell_set_active_panel_from_id = NULL;

static void update_window_active_panel_id(AdwNavigationSplitView *split_view, const char *new_id G_GNUC_UNUSED) {
    if (!split_view) return;
    GtkWidget *win = gtk_widget_get_ancestor(GTK_WIDGET(split_view), GTK_TYPE_WINDOW);
    if (!win) return;

    if (g_strcmp0(G_OBJECT_TYPE_NAME(win), "CcWindow") == 0) {
        char **win_cur_id = (char **)((char *)win + 0x60);
        if (win_cur_id && *win_cur_id) {
            g_free(*win_cur_id);
            *win_cur_id = NULL;
        }

        void *panel_list = *((void **)((char *)win + 0x38));
        if (panel_list && G_IS_OBJECT(panel_list) && g_strcmp0(G_OBJECT_TYPE_NAME(panel_list), "CcPanelList") == 0) {
            char **pl_cur_id = (char **)((char *)panel_list + 0x40);
            if (pl_cur_id && *pl_cur_id) {
                g_free(*pl_cur_id);
                *pl_cur_id = NULL;
            }
        }
    }
}

static gboolean switch_to_shell_panel_id(AdwNavigationSplitView *split_view, const char *id) {
    if (!split_view || !id) return FALSE;
    GtkWidget *win = gtk_widget_get_ancestor(GTK_WIDGET(split_view), GTK_TYPE_WINDOW);
    if (!win) return FALSE;

    if (!orig_cc_shell_set_active_panel_from_id) {
        orig_cc_shell_set_active_panel_from_id = (CcShellSetActivePanelFromIdFunc)dlsym(RTLD_DEFAULT, "cc_shell_set_active_panel_from_id");
    }
    if (orig_cc_shell_set_active_panel_from_id) {
        return orig_cc_shell_set_active_panel_from_id(win, id, NULL, NULL);
    }
    return FALSE;
}

static void activate_system_row_by_id(GtkWidget *root, const char *row_id) {
    if (!root) return;
    const char *bid = GTK_IS_BUILDABLE(root) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(root)) : NULL;
    gboolean match = FALSE;
    if (g_strcmp0(bid, row_id) == 0) match = TRUE;
    if (!match && GTK_IS_ACTIONABLE(root)) {
        GVariant *target = gtk_actionable_get_action_target_value(GTK_ACTIONABLE(root));
        if (target && g_variant_is_of_type(target, G_VARIANT_TYPE_STRING)) {
            const char *str = g_variant_get_string(target, NULL);
            if (g_strcmp0(str, row_id) == 0 ||
                (g_strcmp0(row_id, "about_row") == 0 && g_strcmp0(str, "about") == 0)) {
                match = TRUE;
            }
        }
    }
    if (match) {
        if (GTK_IS_LIST_BOX_ROW(root)) {
            GtkWidget *parent = gtk_widget_get_ancestor(root, GTK_TYPE_LIST_BOX);
            if (parent) {
                gtk_list_box_select_row(GTK_LIST_BOX(parent), GTK_LIST_BOX_ROW(root));
                g_signal_emit_by_name(parent, "row-activated", root);
            }
        }
        gtk_widget_activate(root);
        if (GTK_IS_ACTIONABLE(root)) {
            const char *act = gtk_actionable_get_action_name(GTK_ACTIONABLE(root));
            GVariant *target = gtk_actionable_get_action_target_value(GTK_ACTIONABLE(root));
            if (act && target) {
                gtk_widget_activate_action_variant(root, act, target);
            }
        }
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(root); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        activate_system_row_by_id(child, row_id);
    }
}

static void open_system_subpage(AdwNavigationSplitView *split_view, GtkListBox *box, const char *row_id) {
    if (!split_view || !box) return;

    g_object_set_data(G_OBJECT(split_view), "mac_target_subpage_row", (gpointer)row_id);

    AdwNavigationPage *cur_content = adw_navigation_split_view_get_content(split_view);
    const char *cur_cid = cur_content ? get_panel_id_from_widget(GTK_WIDGET(cur_content)) : NULL;
    if (g_strcmp0(cur_cid, "mac-styling") == 0 || g_strcmp0(cur_cid, "widgets") == 0) {
        switch_to_shell_panel_id(split_view, "system");
    }

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

static gboolean open_about_delayed_cb(gpointer user_data) {
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view) return G_SOURCE_REMOVE;
    AdwNavigationPage *content_page = adw_navigation_split_view_get_content(split_view);
    if (content_page) {
        GList *nav_views = NULL;
        find_navigation_views(GTK_WIDGET(content_page), &nav_views);
        if (nav_views) {
            AdwNavigationView *nv = ADW_NAVIGATION_VIEW(nav_views->data);
            AdwNavigationPage *vis = nv ? adw_navigation_view_get_visible_page(nv) : NULL;
            const char *tag = vis ? adw_navigation_page_get_tag(vis) : NULL;
            g_list_free(nav_views);
            if (g_strcmp0(tag, "about") == 0) {
                return G_SOURCE_REMOVE;
            }
        }
        activate_system_row_by_id(GTK_WIDGET(content_page), "about_row");
    }
    return G_SOURCE_REMOVE;
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
    if (g_strcmp0(id, "mac-styling") == 0) return "preferences-desktop-theme-symbolic";
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
    if (g_strcmp0(id, "mac-styling") == 0) return "Mac стилізація";
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
    if (g_strcmp0(id, "mac-styling") == 0) return "Налаштування розмиття скла Liquid Glass, прозорості та тіней системи.";
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
        if (tag && (g_strcmp0(tag, "widgets") == 0 || g_strcmp0(tag, "widgets_page") == 0 || g_strcmp0(tag, "widgets_main") == 0 || g_strcmp0(tag, "widgets_configurator") == 0 || g_strcmp0(tag, "widgets_picker") == 0)) return "widgets";
        if (tag && (g_strcmp0(tag, "mac-styling") == 0 || g_strcmp0(tag, "mac_styling_page") == 0)) return "mac-styling";
        const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
        if (bid && (g_strcmp0(bid, "widgets") == 0 || g_strcmp0(bid, "widgets_page") == 0 || g_strcmp0(bid, "widgets_main_page") == 0 || g_strcmp0(bid, "widgets_configurator_page") == 0 || g_strcmp0(bid, "widgets_picker_page") == 0)) return "widgets";
        if (bid && (g_strcmp0(bid, "mac-styling") == 0 || g_strcmp0(bid, "mac_styling_page") == 0)) return "mac-styling";
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
        if (!g_object_get_data(G_OBJECT(widget), "mac_clamp_expanded")) {
            adw_clamp_set_maximum_size(ADW_CLAMP(widget), 1800);
            adw_clamp_set_tightening_threshold(ADW_CLAMP(widget), 1600);
            gtk_widget_set_valign(widget, GTK_ALIGN_START);
            gtk_widget_set_vexpand(widget, FALSE);
            GtkWidget *child = gtk_widget_get_first_child(widget);
            if (child && GTK_IS_BOX(child)) {
                gtk_widget_set_valign(child, GTK_ALIGN_START);
                gtk_widget_set_vexpand(child, FALSE);
            }
            g_object_set_data(G_OBJECT(widget), "mac_clamp_expanded", GINT_TO_POINTER(1));
        }
    }
    if (ADW_IS_PREFERENCES_GROUP(widget)) {
        gtk_widget_set_valign(widget, GTK_ALIGN_START);
        gtk_widget_set_vexpand(widget, FALSE);
    }
    if (GTK_IS_LABEL(widget)) {
        const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
        GtkWidget *ancestor_group = gtk_widget_get_ancestor(widget, ADW_TYPE_PREFERENCES_GROUP);
        if (ancestor_group != NULL) {
            gtk_widget_set_margin_start(widget, 0);
            gtk_widget_set_margin_end(widget, 0);
            GtkWidget *parent = gtk_widget_get_parent(widget);
            if (parent && GTK_IS_BOX(parent)) {
                gtk_widget_set_margin_start(parent, 0);
                gtk_widget_set_margin_end(parent, 0);
            }
        } else if (g_strcmp0(bid, "list_label") == 0 || gtk_widget_has_css_class(widget, "heading")) {
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

static void on_property_row_subtitle_notify(GObject *gobject, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data G_GNUC_UNUSED);

static void find_title_box_recursive(GtkWidget *w, GtkWidget **out_box) {
    if (!w || *out_box) return;
    if (GTK_IS_BOX(w)) {
        gboolean has_title = FALSE, has_subtitle = FALSE;
        for (GtkWidget *ch = gtk_widget_get_first_child(w); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
            if (GTK_IS_LABEL(ch)) {
                if (gtk_widget_has_css_class(ch, "title")) has_title = TRUE;
                if (gtk_widget_has_css_class(ch, "subtitle")) has_subtitle = TRUE;
            }
        }
        if (has_title && has_subtitle) {
            *out_box = w;
            return;
        }
    }
    for (GtkWidget *ch = gtk_widget_get_first_child(w); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
        find_title_box_recursive(ch, out_box);
    }
}

static gboolean is_property_widget(GtkWidget *widget) {
    if (!widget) return FALSE;
    if (gtk_widget_has_css_class(widget, "property")) return TRUE;
    if (GTK_IS_BUILDABLE(widget)) {
        const char *bid = gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget));
        if (bid && (g_strcmp0(bid, "os_name_row") == 0 ||
                    g_strcmp0(bid, "hardware_model_row") == 0 ||
                    g_strcmp0(bid, "processor_row") == 0 ||
                    g_strcmp0(bid, "memory_row") == 0 ||
                    g_strcmp0(bid, "disk_row") == 0)) {
            return TRUE;
        }
    }
    return FALSE;
}

static void format_property_rows_recursive(GtkWidget *widget) {
    if (!widget) return;

    if (is_property_widget(widget)) {
        gtk_widget_set_visible(widget, TRUE);
        GtkWidget *t_box = NULL;
        find_title_box_recursive(widget, &t_box);
        if (t_box) {
            gtk_orientable_set_orientation(GTK_ORIENTABLE(t_box), GTK_ORIENTATION_HORIZONTAL);
            gtk_widget_set_hexpand(t_box, TRUE);
            gtk_box_set_spacing(GTK_BOX(t_box), 16);

            for (GtkWidget *ch = gtk_widget_get_first_child(t_box); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
                if (GTK_IS_LABEL(ch)) {
                    gtk_widget_set_visible(ch, TRUE);
                    if (gtk_widget_has_css_class(ch, "title")) {
                        gtk_widget_set_hexpand(ch, FALSE);
                        gtk_widget_set_halign(ch, GTK_ALIGN_START);
                        gtk_label_set_xalign(GTK_LABEL(ch), 0.0f);
                    } else if (gtk_widget_has_css_class(ch, "subtitle")) {
                        gtk_widget_set_hexpand(ch, TRUE);
                        gtk_widget_set_halign(ch, GTK_ALIGN_END);
                        gtk_label_set_xalign(GTK_LABEL(ch), 1.0f);
                        gtk_label_set_ellipsize(GTK_LABEL(ch), PANGO_ELLIPSIZE_END);
                        gtk_label_set_selectable(GTK_LABEL(ch), TRUE);
                    }
                }
            }
        }
        if (!g_object_get_data(G_OBJECT(widget), "mac_property_formatted")) {
            g_signal_connect(widget, "notify::subtitle", G_CALLBACK(on_property_row_subtitle_notify), NULL);
            g_object_set_data(G_OBJECT(widget), "mac_property_formatted", GINT_TO_POINTER(1));
        }
    }

    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        format_property_rows_recursive(child);
    }
}

static void on_property_row_subtitle_notify(GObject *gobject, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data G_GNUC_UNUSED) {
    if (GTK_IS_WIDGET(gobject)) {
        format_property_rows_recursive(GTK_WIDGET(gobject));
    }
}

static void hide_subtitles_recursive(GtkWidget *widget) {
    if (!widget) return;
    if (is_property_widget(widget)) {
        return;
    }
    if (GTK_IS_LABEL(widget)) {
        if (gtk_widget_has_css_class(widget, "subtitle")) {
            GtkWidget *row = gtk_widget_get_ancestor(widget, GTK_TYPE_LIST_BOX_ROW);
            if (row && is_property_widget(row)) {
                gtk_widget_set_visible(widget, TRUE);
                return;
            }
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
        if (!g_object_get_data(G_OBJECT(widget), "mac_accent_box_fixed")) {
            g_object_set_data(G_OBJECT(widget), "mac_accent_box_fixed", GINT_TO_POINTER(1));
            gtk_widget_set_halign(widget, GTK_ALIGN_CENTER);
            for (GtkWidget *b = gtk_widget_get_first_child(widget); b; b = gtk_widget_get_next_sibling(b)) {
                gtk_widget_set_size_request(b, 24, 24);
                gtk_widget_set_valign(b, GTK_ALIGN_CENTER);
                gtk_widget_set_halign(b, GTK_ALIGN_CENTER);
            }
        }
        return;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
        fix_accent_color_buttons(c);
    }
}

static void on_color_scheme_toggle_toggled(GtkToggleButton *btn, gpointer user_data) {
    if (!gtk_toggle_button_get_active(btn)) return;
    const char *target_mode = (const char *)user_data;
    if (!target_mode) return;
    char *cmd = g_strdup_printf("/usr/local/bin/mac-theme-sync %s", target_mode);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
}

static void polish_background_panel(GtkWidget *widget) {
    if (!widget) return;

    /* 1. Find default_label and rename to 'Світла' (or 'Light') */
    const char *bid = GTK_IS_BUILDABLE(widget) ? gtk_buildable_get_buildable_id(GTK_BUILDABLE(widget)) : NULL;
    if (g_strcmp0(bid, "default_label") == 0 && GTK_IS_LABEL(widget)) {
        const char *loc = mac_get_locale();
        if (loc && (strcmp(loc, "uk") == 0 || strcmp(loc, "uk_UA") == 0)) {
            gtk_label_set_text(GTK_LABEL(widget), "Світла");
        } else {
            gtk_label_set_text(GTK_LABEL(widget), "Light");
        }
    } else if (GTK_IS_LABEL(widget)) {
        const char *txt = gtk_label_get_text(GTK_LABEL(widget));
        if (txt && (g_strcmp0(txt, "Типово") == 0 || g_strcmp0(txt, "_Типово") == 0 || g_strcmp0(txt, "Default") == 0)) {
            const char *loc = mac_get_locale();
            if (loc && (strcmp(loc, "uk") == 0 || strcmp(loc, "uk_UA") == 0)) {
                gtk_label_set_text(GTK_LABEL(widget), "Світла");
            } else {
                gtk_label_set_text(GTK_LABEL(widget), "Light");
            }
        }
    }

    /* 2. Wire default_toggle and dark_toggle to trigger mac-theme-sync */
    if (g_strcmp0(bid, "default_toggle") == 0 && GTK_IS_TOGGLE_BUTTON(widget)) {
        if (!g_object_get_data(G_OBJECT(widget), "mac_theme_sync_hooked")) {
            g_object_set_data(G_OBJECT(widget), "mac_theme_sync_hooked", GINT_TO_POINTER(1));
            g_signal_connect(widget, "toggled", G_CALLBACK(on_color_scheme_toggle_toggled), (gpointer)"light");
        }
    }
    if (g_strcmp0(bid, "dark_toggle") == 0 && GTK_IS_TOGGLE_BUTTON(widget)) {
        if (!g_object_get_data(G_OBJECT(widget), "mac_theme_sync_hooked")) {
            g_object_set_data(G_OBJECT(widget), "mac_theme_sync_hooked", GINT_TO_POINTER(1));
            g_signal_connect(widget, "toggled", G_CALLBACK(on_color_scheme_toggle_toggled), (gpointer)"dark");
        }
    }

    for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
        polish_background_panel(c);
    }
}

static void update_panel_headerbar(AdwNavigationSplitView *split_view);
static guint s_update_headerbar_idle_id = 0;

static gboolean update_panel_headerbar_idle_cb(gpointer user_data)
{
    s_update_headerbar_idle_id = 0;
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (split_view && G_IS_OBJECT(split_view) && ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) {
        update_panel_headerbar(split_view);
    }
    return G_SOURCE_REMOVE;
}

static void schedule_update_panel_headerbar(AdwNavigationSplitView *split_view)
{
    if (!split_view || !G_IS_OBJECT(split_view) || !ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) return;
    update_panel_headerbar(split_view);
    if (s_update_headerbar_idle_id == 0) {
        s_update_headerbar_idle_id = g_idle_add(update_panel_headerbar_idle_cb, split_view);
    }
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

static void on_main_listbox_row_activated(GtkListBox *box, GtkListBoxRow *row, gpointer user_data)
{
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view || !row || !G_IS_OBJECT(row) || !G_IS_OBJECT(split_view) || !ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) return;
    g_object_set_data(G_OBJECT(split_view), "mac_user_navigated", GINT_TO_POINTER(1));

    gboolean is_widgets_row = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_widgets_row"));
    if (!is_widgets_row) {
        dw_set_edit_mode(FALSE);  /* вихід із розділу Віджети — вимкнути режим редагування */
        if (global_widgets_nav_view) {
            adw_navigation_view_pop_to_tag(global_widgets_nav_view, "widgets_main");
        }
    }

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
            gtk_list_box_select_row(box, row);
            update_window_active_panel_id(split_view, "widgets");
            schedule_update_panel_headerbar(split_view);
            dw_attach_settings_close_handler(split_view);  /* закриття Параметрів — вимкнути режим редагування */
        }
        return;
    }

    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "is_mac_styling_row"))) {
        g_signal_stop_emission_by_name(box, "row-activated");
        GtkWidget *page = get_mac_styling_page();
        if (page) {
            adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
            adw_navigation_split_view_set_show_content(split_view, TRUE);
            gtk_list_box_select_row(box, row);
            update_window_active_panel_id(split_view, "mac-styling");
            schedule_update_panel_headerbar(split_view);
        }
        return;
    }

    MacPanelRowData *d = g_object_get_data(G_OBJECT(row), "data");
    if (d && d->id) {
        g_object_set_data(G_OBJECT(split_view), "mac_current_panel_id", (gpointer)d->id);

        AdwNavigationPage *cur_content = adw_navigation_split_view_get_content(split_view);
        if (cur_content) {
            const char *cur_cid = get_panel_id_from_widget(GTK_WIDGET(cur_content));
            if (g_strcmp0(cur_cid, "mac-styling") == 0 || g_strcmp0(cur_cid, "widgets") == 0) {
                switch_to_shell_panel_id(split_view, d->id);
            }
        }
    }
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
        reorder_group_previews_to_top(GTK_WIDGET(content_p));
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
        if (nv != global_widgets_nav_view && !adw_navigation_view_find_page(nv, "screenshot")) {
            GtkWidget *sp = get_screenshot_page();
            if (sp) {
                adw_navigation_view_add(nv, ADW_NAVIGATION_PAGE(sp));
            }
        }
        if (g_getenv("MAC_SETTINGS_OPEN_SCREENSHOT") && !g_object_get_data(G_OBJECT(nv), "mac_screenshot_pushed")) {
            g_object_set_data(G_OBJECT(nv), "mac_screenshot_pushed", GINT_TO_POINTER(1));
            adw_navigation_view_push_by_tag(nv, "screenshot");
        }
        if (g_getenv("MAC_SETTINGS_OPEN_ABOUT") && !g_object_get_data(G_OBJECT(split_view), "mac_about_pushed")) {
            g_object_set_data(G_OBJECT(split_view), "mac_about_pushed", GINT_TO_POINTER(1));
            if (content_page) {
                activate_system_row_by_id(GTK_WIDGET(content_page), "about_row");
            }
            g_timeout_add(100, open_about_delayed_cb, split_view);
            g_timeout_add(300, open_about_delayed_cb, split_view);
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
            } else if (g_strcmp0(target_row, "screenshot_row") == 0) {
                adw_navigation_view_push_by_tag(nv, "screenshot");
            } else if (g_strcmp0(target_row, "about_row") == 0 || g_strcmp0(target_row, "about") == 0) {
                activate_system_row_by_id(GTK_WIDGET(content_page), "about_row");
            } else {
                activate_system_row_by_id(GTK_WIDGET(content_page), target_row);
            }
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
    format_property_rows_recursive(target_root);
    fix_accent_color_buttons(target_root);
    polish_background_panel(target_root);

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
            gtk_widget_set_margin_top(title_label, 1);
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
            gtk_widget_set_margin_top(title_label, 1);
        }
        if (title_label) {
            gtk_widget_set_visible(title_label, TRUE);
        }
        hide_unwanted_headerbar_buttons(GTK_WIDGET(target_hb), nav_box);

        /* Update title */
        const char *header_title = NULL;
        if (is_subpage && vis_p) {
            header_title = adw_navigation_page_get_title(vis_p);
            if (!header_title || !header_title[0]) {
                const char *tag = adw_navigation_page_get_tag(vis_p);
                if (tag) {
                    if (g_strcmp0(tag, "about") == 0) header_title = mac_tr("about", "Про систему");
                    else if (g_strcmp0(tag, "datetime") == 0) header_title = mac_tr("datetime", "Дата й час");
                    else if (g_strcmp0(tag, "region") == 0) header_title = mac_tr("region", "Регіон та мова");
                    else if (g_strcmp0(tag, "users") == 0) header_title = mac_tr("users", "Користувачі");
                    else if (g_strcmp0(tag, "remote-desktop") == 0) header_title = mac_tr("remote_desktop", "Віддалена стільниця");
                    else if (g_strcmp0(tag, "screenshot") == 0) header_title = mac_tr("screenshot", "Скріншот");
                    else if (g_strcmp0(tag, "multitasking") == 0) header_title = mac_tr("multitasking", "Багатозадачність");
                    else if (g_strcmp0(tag, "apps") == 0) header_title = mac_tr("apps", "Програми");
                }
            }
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


static gboolean open_widgets_delayed_cb(gpointer user_data) {
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view || !ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) return G_SOURCE_REMOVE;
    if (g_object_get_data(G_OBJECT(split_view), "mac_user_navigated")) return G_SOURCE_REMOVE;
    GtkListBoxRow *row = g_object_get_data(G_OBJECT(split_view), "mac_widgets_row");
    GtkListBox *box = g_object_get_data(G_OBJECT(split_view), "mac_main_listbox");
    if (box && row) {
        gtk_list_box_select_row(box, row);
    }
    GtkWidget *page = get_widgets_page();
    if (page) {
        adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
        adw_navigation_split_view_set_show_content(split_view, TRUE);
        update_window_active_panel_id(split_view, "widgets");
        schedule_update_panel_headerbar(split_view);
        GSettings *s = get_dw_settings();
        if (s && g_settings_get_boolean(s, "open-widget-picker")) {
            g_settings_set_boolean(s, "open-widget-picker", FALSE);
            if (global_widgets_nav_view) {
                adw_navigation_view_push_by_tag(global_widgets_nav_view, "widgets_picker");
                dw_set_edit_mode(TRUE);
                schedule_update_panel_headerbar(split_view);
            }
        }
    }
    return G_SOURCE_REMOVE;
}

static gboolean open_styling_delayed_cb(gpointer user_data) {
    AdwNavigationSplitView *split_view = ADW_NAVIGATION_SPLIT_VIEW(user_data);
    if (!split_view || !ADW_IS_NAVIGATION_SPLIT_VIEW(split_view)) return G_SOURCE_REMOVE;
    if (g_object_get_data(G_OBJECT(split_view), "mac_user_navigated")) return G_SOURCE_REMOVE;
    GtkListBoxRow *row = g_object_get_data(G_OBJECT(split_view), "mac_styling_row");
    GtkListBox *box = g_object_get_data(G_OBJECT(split_view), "mac_main_listbox");
    if (box && row) {
        gtk_list_box_select_row(box, row);
    }
    GtkWidget *page = get_mac_styling_page();
    if (page) {
        adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
        adw_navigation_split_view_set_show_content(split_view, TRUE);
        update_window_active_panel_id(split_view, "mac-styling");
        schedule_update_panel_headerbar(split_view);
    }
    return G_SOURCE_REMOVE;
}

static gboolean warmup_mac_styling_idle(gpointer user_data) {
    (void)user_data;
    get_mac_styling_page();
    return G_SOURCE_REMOVE;
}

static void on_style_manager_notify_dark(GObject *gobject, GParamSpec *pspec, gpointer user_data) {
    (void)gobject; (void)pspec;
    AdwNavigationSplitView *split_view = (AdwNavigationSplitView *)user_data;
    GtkWidget *msp = get_mac_styling_page();
    if (msp) {
        update_mac_styling_tint_labels(msp, mac_is_light_mode());
    }
    if (split_view && GTK_IS_WIDGET(split_view)) {
        schedule_update_panel_headerbar(split_view);
    }
    redraw_all_mac_styling_previews();
}

static gboolean mac_fix_settings_window(gpointer user_data)
{
    GtkWindow *window = GTK_WINDOW(user_data);
    if (!window || !GTK_IS_WINDOW(window)) return G_SOURCE_REMOVE;

    static gboolean s_warmup_scheduled = FALSE;
    if (!s_warmup_scheduled) {
        s_warmup_scheduled = TRUE;
        start_wallpaper_preload();
        g_idle_add(warmup_mac_styling_idle, NULL);
    }

    init_mac_settings_css();
    gtk_widget_add_css_class(GTK_WIDGET(window), "mac-settings-window");

    AdwNavigationSplitView *split_view = NULL;
    find_navigation_split_view(GTK_WIDGET(window), &split_view);
    if (!split_view) return G_SOURCE_REMOVE;

    AdwStyleManager *sm = adw_style_manager_get_default();
    if (sm && !g_object_get_data(G_OBJECT(sm), "mac_dark_notify_connected")) {
        g_object_set_data(G_OBJECT(sm), "mac_dark_notify_connected", GINT_TO_POINTER(1));
        g_signal_connect(sm, "notify::dark", G_CALLBACK(on_style_manager_notify_dark), split_view);
    }

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
        gtk_widget_set_margin_top(GTK_WIDGET(sidebar_hb), 0);

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

        GtkListBoxRow *mac_styling_row = g_object_get_data(G_OBJECT(split_view), "mac_styling_row");
        if (!g_object_get_data(G_OBJECT(main_listbox), "mac_styling_row_added")) {
            mac_styling_row = GTK_LIST_BOX_ROW(gtk_list_box_row_new());
            g_object_set_data(G_OBJECT(mac_styling_row), "is_mac_styling_row", GINT_TO_POINTER(1));

            GtkWidget *grid = gtk_grid_new();
            gtk_widget_set_hexpand(grid, TRUE);
            gtk_widget_set_valign(grid, GTK_ALIGN_CENTER);
            gtk_widget_set_margin_top(grid, 0);
            gtk_widget_set_margin_bottom(grid, 0);
            gtk_widget_set_margin_start(grid, 0);
            gtk_widget_set_margin_end(grid, 0);
            gtk_grid_set_column_spacing(GTK_GRID(grid), 6);

            GtkWidget *image = gtk_image_new_from_icon_name("preferences-desktop-theme-symbolic");
            gtk_image_set_pixel_size(GTK_IMAGE(image), 13);
            gtk_widget_set_halign(image, GTK_ALIGN_CENTER);
            gtk_widget_set_valign(image, GTK_ALIGN_CENTER);
            gtk_grid_attach(GTK_GRID(grid), image, 0, 0, 1, 1);

            GtkWidget *label = gtk_label_new(mac_tr("mac_styling", "Mac стилізація"));
            gtk_label_set_xalign(GTK_LABEL(label), 0.0);
            gtk_widget_set_valign(label, GTK_ALIGN_CENTER);
            gtk_widget_set_margin_start(label, 0);
            gtk_widget_set_margin_top(label, 1);
            gtk_widget_set_margin_bottom(label, 0);
            gtk_widget_set_hexpand(label, TRUE);
            gtk_grid_attach(GTK_GRID(grid), label, 1, 0, 1, 1);

            gtk_list_box_row_set_child(mac_styling_row, grid);

            MacPanelRowData *row_data = g_new0(MacPanelRowData, 1);
            row_data->row = mac_styling_row;
            row_data->id = g_strdup("mac-styling");
            g_object_set_data_full(G_OBJECT(mac_styling_row), "data", row_data, (GDestroyNotify)g_free);

            gtk_list_box_append(main_listbox, GTK_WIDGET(mac_styling_row));

            g_object_set_data(G_OBJECT(main_listbox), "mac_styling_row_added", GINT_TO_POINTER(1));
            g_object_set_data(G_OBJECT(split_view), "mac_styling_row", mac_styling_row);
        }

        if (!g_object_get_data(G_OBJECT(main_listbox), "mac_listbox_connected")) {
            gtk_list_box_set_sort_func(main_listbox, mac_main_listbox_sort_func, NULL, NULL);
            gtk_list_box_set_header_func(main_listbox, NULL, NULL, NULL);
            gtk_list_box_invalidate_sort(main_listbox);
            gtk_list_box_invalidate_headers(main_listbox);
            gtk_list_box_set_activate_on_single_click(main_listbox, TRUE);

            g_signal_connect(main_listbox, "row-activated", G_CALLBACK(on_main_listbox_row_activated), split_view);
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

        if (g_getenv("MAC_SETTINGS_OPEN_WIDGETS")) {
            g_object_set_data(G_OBJECT(split_view), "mac_main_listbox", main_listbox);
            if (widgets_row) {
                g_object_set_data(G_OBJECT(split_view), "mac_widgets_row", widgets_row);
                gtk_list_box_select_row(main_listbox, widgets_row);
            }
            GtkWidget *page = get_widgets_page();
            if (page) {
                adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
                adw_navigation_split_view_set_show_content(split_view, TRUE);
                update_window_active_panel_id(split_view, "widgets");
                schedule_update_panel_headerbar(split_view);
            }
            g_timeout_add(100, open_widgets_delayed_cb, split_view);
            g_timeout_add(300, open_widgets_delayed_cb, split_view);
            g_timeout_add(600, open_widgets_delayed_cb, split_view);
            dw_attach_settings_close_handler(split_view);
        }

        if (g_getenv("MAC_SETTINGS_OPEN_STYLING")) {
            g_object_set_data(G_OBJECT(split_view), "mac_main_listbox", main_listbox);
            if (mac_styling_row) {
                g_object_set_data(G_OBJECT(split_view), "mac_styling_row", mac_styling_row);
                gtk_list_box_select_row(main_listbox, mac_styling_row);
            }
            GtkWidget *page = get_mac_styling_page();
            if (page) {
                adw_navigation_split_view_set_content(split_view, ADW_NAVIGATION_PAGE(page));
                adw_navigation_split_view_set_show_content(split_view, TRUE);
                update_window_active_panel_id(split_view, "mac-styling");
                schedule_update_panel_headerbar(split_view);
            }
            g_timeout_add(100, open_styling_delayed_cb, split_view);
            g_timeout_add(300, open_styling_delayed_cb, split_view);
            g_timeout_add(600, open_styling_delayed_cb, split_view);
        }
    }

    expand_clamps_recursive(GTK_WIDGET(window));
    remove_panel_header_banner_if_any(GTK_WIDGET(window));
    reorder_group_previews_to_top(GTK_WIDGET(window));

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
        start_wallpaper_preload();
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
        start_wallpaper_preload();
        mac_fix_settings_window(window);
        g_idle_add(mac_fix_settings_window, window);
    }
}



