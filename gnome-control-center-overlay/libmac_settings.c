#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <glib.h>
#include <gio/gio.h>
#include <json-glib/json-glib.h>

/* Forward declarations for GTK4 & Libadwaita functions */
extern double gtk_range_get_value(void *range);
extern void gtk_range_set_value(void *range, double value);
extern int adw_switch_row_get_active(void *row);
extern void adw_switch_row_set_active(void *row, int active);
extern unsigned int adw_combo_row_get_selected(void *row);
extern void adw_combo_row_set_selected(void *row, unsigned int position);
extern double adw_spin_row_get_value(void *row);
extern void adw_spin_row_set_value(void *row, double value);

typedef struct {
    int dock_blur;
    int dock_sigma;
    double dock_tint;
    int dock_radius;

    int panel_blur;
    int panel_sigma;
    double panel_tint;

    int qs_sigma;
    int qs_anim; /* 0: "window", 1: "elements" */

    int notif_blur;
    int notif_sigma;
    double notif_tint;
    int notif_radius;
} MacStylingData;

static MacStylingData state = {
    .dock_blur = 1,
    .dock_sigma = 30,
    .dock_tint = 0.36,
    .dock_radius = 28,

    .panel_blur = 1,
    .panel_sigma = 30,
    .panel_tint = 0.20,

    .qs_sigma = 30,
    .qs_anim = 0, /* default "window" */

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
    char *anim_path = g_build_filename(dir, "control-center-animation.json", NULL);

    const char *anim_str = (state.qs_anim == 1) ? "elements" : "window";

    char dock_tint_buf[G_ASCII_DTOSTR_BUF_SIZE];
    char panel_tint_buf[G_ASCII_DTOSTR_BUF_SIZE];
    char notif_tint_buf[G_ASCII_DTOSTR_BUF_SIZE];
    g_ascii_formatd(dock_tint_buf, sizeof(dock_tint_buf), "%.2f", state.dock_tint);
    g_ascii_formatd(panel_tint_buf, sizeof(panel_tint_buf), "%.2f", state.panel_tint);
    g_ascii_formatd(notif_tint_buf, sizeof(notif_tint_buf), "%.2f", state.notif_tint);

    char *json = g_strdup_printf(
        "{\n"
        "  \"dock_blur\": %s,\n"
        "  \"dock_sigma\": %d,\n"
        "  \"dock_tint\": %s,\n"
        "  \"dock_radius\": %d,\n"
        "  \"panel_blur\": %s,\n"
        "  \"panel_sigma\": %d,\n"
        "  \"panel_tint\": %s,\n"
        "  \"qs_sigma\": %d,\n"
        "  \"qs_anim\": \"%s\",\n"
        "  \"notif_blur\": %s,\n"
        "  \"notif_sigma\": %d,\n"
        "  \"notif_tint\": %s,\n"
        "  \"notif_radius\": %d\n"
        "}\n",
        state.dock_blur ? "true" : "false",
        state.dock_sigma,
        dock_tint_buf,
        state.dock_radius,
        state.panel_blur ? "true" : "false",
        state.panel_sigma,
        panel_tint_buf,
        state.qs_sigma,
        anim_str,
        state.notif_blur ? "true" : "false",
        state.notif_sigma,
        notif_tint_buf,
        state.notif_radius
    );
    g_file_set_contents(path, json, -1, NULL);
    g_free(json);
    g_free(path);

    char *anim_json = g_strdup_printf("{\n  \"mode\": \"%s\"\n}\n", anim_str);
    g_file_set_contents(anim_path, anim_json, -1, NULL);
    g_free(anim_json);
    g_free(anim_path);
    g_free(dir);
}

static gboolean save_css_cb(gpointer user_data) {
    css_timer_id = 0;
    char *cmd = g_strdup_printf(
        "python3 -c '\n"
        "import re, os\n"
        "css_path = os.path.expanduser(\"~/.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css\")\n"
        "if os.path.exists(css_path):\n"
        "    with open(css_path, \"r\") as f: c = f.read()\n"
        "    c = re.sub(r\"(#dashtodockContainer\\.dashtodock #dash \\.dash-background \\{\\s*background-color:\\s*rgba\\(36,\\s*36,\\s*36,\\s*)[0-9.]+(\\) !important;\\s*border: 1px solid rgba\\(255, 255, 255, 0\\.16\\) !important;\\s*box-shadow: 0 8px 32px 0 rgba\\(0, 0, 0, 0\\.35\\) !important;\\s*border-radius:\\s*)[0-9]+px( !important;\\s*\\})\", rf\"\\g<1>%.2f\\g<2>%dpx\\g<3>\", c)\n"
        "    c = re.sub(r\"(#dash \\.dash-background \\{\\s*background-color:\\s*rgba\\(36,\\s*36,\\s*36,\\s*)[0-9.]+(\\) !important;\\s*border-radius:\\s*)[0-9]+px( !important;)\", rf\"\\g<1>%.2f\\g<2>%dpx\\g<3>\", c)\n"
        "    c = re.sub(r\"(\\.mac-notification-banner \\{\\s*width: 395px !important;\\s*min-height: 56px !important;\\s*padding: 10px 14px !important;\\s*border-radius:\\s*)[0-9]+px( !important;\\s*background-color:\\s*rgba\\(36,\\s*36,\\s*36,\\s*)[0-9.]+(\\) !important;)\", rf\"\\g<1>%dpx\\g<2>%.2f\\g<3>\", c)\n"
        "    c = re.sub(r\"(#panel \\{\\s*font-weight: 500;\\s*color: white;\\s*transition-duration: 250ms;\\s*height: 34px !important;\\s*background-color:\\s*)[^;]+(;)\", rf\"\\g<1>rgba(36, 36, 36, %.2f) !important\\g<2>\", c)\n"
        "    with open(css_path, \"w\") as f: f.write(c)\n"
        "'",
        state.dock_tint, state.dock_radius,
        state.dock_tint, state.dock_radius,
        state.notif_radius, state.notif_tint,
        state.panel_tint
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

static void run_dconf_write(const char *path, const char *val) {
    char *cmd = g_strdup_printf("dconf write %s \"%s\"", path, val);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
}

/* Initialization signals from GtkBuilder (realize) */
void init_dock_blur(void *widget, gpointer data) {
    load_config();
    in_init = 1;
    adw_switch_row_set_active(widget, state.dock_blur);
    in_init = 0;
}

void init_dock_sigma(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.dock_sigma);
    in_init = 0;
}

void init_dock_tint(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, state.dock_tint * 100.0);
    in_init = 0;
}

void init_dock_radius(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.dock_radius);
    in_init = 0;
}

void init_panel_blur(void *widget, gpointer data) {
    in_init = 1;
    adw_switch_row_set_active(widget, state.panel_blur);
    in_init = 0;
}

void init_panel_sigma(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.panel_sigma);
    in_init = 0;
}

void init_panel_tint(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, state.panel_tint * 100.0);
    in_init = 0;
}

void init_qs_sigma(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.qs_sigma);
    in_init = 0;
}

void init_qs_anim(void *widget, gpointer data) {
    in_init = 1;
    adw_combo_row_set_selected(widget, (unsigned int)state.qs_anim);
    in_init = 0;
}

void init_notif_blur(void *widget, gpointer data) {
    in_init = 1;
    adw_switch_row_set_active(widget, state.notif_blur);
    in_init = 0;
}

void init_notif_sigma(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.notif_sigma);
    in_init = 0;
}

void init_notif_tint(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, state.notif_tint * 100.0);
    in_init = 0;
}

void init_notif_radius(void *widget, gpointer data) {
    in_init = 1;
    gtk_range_set_value(widget, (double)state.notif_radius);
    in_init = 0;
}

/* Event handlers on user change */
void on_dock_blur_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    state.dock_blur = adw_switch_row_get_active(widget);
    save_styling_json();
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/dash-to-dock/blur",
                    state.dock_blur ? "true" : "false");
}

void on_dock_sigma_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.dock_sigma = (int)gtk_range_get_value(widget);
    save_styling_json();
    char val[16];
    snprintf(val, sizeof(val), "%d", state.dock_sigma);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/dash-to-dock/sigma", val);
}

void on_dock_tint_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.dock_tint = gtk_range_get_value(widget) / 100.0;
    save_styling_json();
    schedule_css_save();
}

void on_dock_radius_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.dock_radius = (int)gtk_range_get_value(widget);
    save_styling_json();
    char val[16];
    snprintf(val, sizeof(val), "%d", state.dock_radius);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/dash-to-dock/corner-radius", val);
    schedule_css_save();
}

void on_panel_blur_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    state.panel_blur = adw_switch_row_get_active(widget);
    save_styling_json();
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/panel/blur",
                    state.panel_blur ? "true" : "false");
}

void on_panel_sigma_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.panel_sigma = (int)gtk_range_get_value(widget);
    save_styling_json();
    char val[16];
    snprintf(val, sizeof(val), "%d", state.panel_sigma);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/panel/sigma", val);
}

void on_panel_tint_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.panel_tint = gtk_range_get_value(widget) / 100.0;
    save_styling_json();
    schedule_css_save();
}

void on_qs_sigma_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.qs_sigma = (int)gtk_range_get_value(widget);
    save_styling_json();
    char val[16];
    snprintf(val, sizeof(val), "%d", state.qs_sigma);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/quick-settings/sigma", val);
}

void on_qs_anim_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    state.qs_anim = (int)adw_combo_row_get_selected(widget);
    save_styling_json();
    const char *mode = (state.qs_anim == 1) ? "elements" : "window";
    char val[32];
    snprintf(val, sizeof(val), "'%s'", mode);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/quick-settings/animation-mode", val);
}

void on_notif_blur_changed(void *widget, void *pspec, gpointer data) {
    if (in_init) return;
    state.notif_blur = adw_switch_row_get_active(widget);
    save_styling_json();
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/notification/blur",
                    state.notif_blur ? "true" : "false");
}

void on_notif_sigma_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.notif_sigma = (int)gtk_range_get_value(widget);
    save_styling_json();
    char val[16];
    snprintf(val, sizeof(val), "%d", state.notif_sigma);
    run_dconf_write("/org/gnome/shell/extensions/blur-my-shell/notification/sigma", val);
}

void on_notif_tint_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.notif_tint = gtk_range_get_value(widget) / 100.0;
    save_styling_json();
    schedule_css_save();
}

void on_notif_radius_changed(void *widget, gpointer data) {
    if (in_init) return;
    state.notif_radius = (int)gtk_range_get_value(widget);
    save_styling_json();
    schedule_css_save();
}

void on_test_notif_clicked(void *widget, gpointer data) {
    save_styling_json();
    schedule_css_save();
    g_spawn_command_line_async("notify-send \"macOS Notification\" \"Тестове повідомлення з плавним виїздом з правого краю та Liquid Glass розмиттям!\"", NULL);
}

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


