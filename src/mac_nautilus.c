#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <time.h>
#include <gtk/gtk.h>
#include <adwaita.h>
#include <gio/gio.h>
#include <math.h>

static gboolean is_nautilus(void)
{
    static int cached = -1;
    if (cached != -1) return cached;
    const char *prg = program_invocation_short_name;
    if (prg && (strcmp(prg, "nautilus") == 0 || strcmp(prg, "nautilus.orig") == 0 || strcmp(prg, "org.gnome.Nautilus") == 0)) {
        cached = 1;
    } else {
        cached = 0;
    }
    return cached;
}

__attribute__((constructor))
void init_mac_nautilus(void)
{
    if (is_nautilus()) {
        unsetenv("LD_PRELOAD");
    }
}

static gboolean (*orig_g_file_copy)(GFile *source,
                                    GFile *destination,
                                    GFileCopyFlags flags,
                                    GCancellable *cancellable,
                                    GFileProgressCallback progress_callback,
                                    gpointer progress_callback_data,
                                    GError **error) = NULL;

static gboolean (*orig_g_file_move)(GFile *source,
                                    GFile *destination,
                                    GFileCopyFlags flags,
                                    GCancellable *cancellable,
                                    GFileProgressCallback progress_callback,
                                    gpointer progress_callback_data,
                                    GError **error) = NULL;

static gboolean is_installer_extension(const char *path)
{
    if (!path) return FALSE;
    const char *dot = strrchr(path, '.');
    if (!dot) return FALSE;
    char ext[16] = {0};
    size_t i;
    for (i = 0; i < sizeof(ext) - 1 && dot[i]; i++) {
        ext[i] = (char)g_ascii_tolower(dot[i]);
    }
    ext[i] = '\0';
    if (strcmp(ext, ".exe") == 0 ||
        strcmp(ext, ".msi") == 0 ||
        strcmp(ext, ".bat") == 0 ||
        strcmp(ext, ".cmd") == 0 ||
        strcmp(ext, ".sh") == 0 ||
        strcmp(ext, ".bash") == 0 ||
        strcmp(ext, ".bin") == 0 ||
        strcmp(ext, ".run") == 0 ||
        strcmp(ext, ".appimage") == 0) {
        return TRUE;
    }
    return FALSE;
}

static void mac_record_app_drop(GFile *source, GFile *destination, gboolean is_move)
{
    if (!source || !destination) return;
    char *src_path = g_file_get_path(source);
    char *dest_path = g_file_get_path(destination);
    if (!src_path || !dest_path) {
        g_free(src_path);
        g_free(dest_path);
        return;
    }

    const char *home = g_get_home_dir();
    if (!home) {
        g_free(src_path);
        g_free(dest_path);
        return;
    }

    char apps_dir[512];
    snprintf(apps_dir, sizeof(apps_dir), "%s/Applications", home);
    size_t apps_len = strlen(apps_dir);

    /* Check if destination is inside ~/Applications and source is outside */
    if (strncmp(dest_path, apps_dir, apps_len) == 0 &&
        (dest_path[apps_len] == '/' || dest_path[apps_len] == '\0') &&
        !(strncmp(src_path, apps_dir, apps_len) == 0 && (src_path[apps_len] == '/' || src_path[apps_len] == '\0'))) {

        char *src_dir = g_path_get_dirname(src_path);
        char *base_name = g_path_get_basename(dest_path);

        /* 1. Write metadata JSON into /run/user/<uid>/mac-app-sources/<basename>.json */
        const char *runtime_dir = g_get_user_runtime_dir();
        if (runtime_dir) {
            char meta_dir[512];
            snprintf(meta_dir, sizeof(meta_dir), "%s/mac-app-sources", runtime_dir);
            g_mkdir_with_parents(meta_dir, 0700);
            char meta_file[1024];
            snprintf(meta_file, sizeof(meta_file), "%s/%s.json", meta_dir, base_name);

            char *json_content = g_strdup_printf(
                "{\n"
                "  \"dest_basename\": \"%s\",\n"
                "  \"dest_path\": \"%s\",\n"
                "  \"source_path\": \"%s\",\n"
                "  \"source_dir\": \"%s\",\n"
                "  \"is_move\": %s,\n"
                "  \"timestamp\": %ld\n"
                "}\n",
                base_name, dest_path, src_path, src_dir,
                is_move ? "true" : "false", (long)time(NULL)
            );
            if (json_content) {
                g_file_set_contents(meta_file, json_content, -1, NULL);
                g_free(json_content);
            }
        }

        /* 2. Mirror into ~/.cache/mac-app-sources/<basename>.json */
        char cache_meta_dir[512];
        snprintf(cache_meta_dir, sizeof(cache_meta_dir), "%s/.cache/mac-app-sources", home);
        g_mkdir_with_parents(cache_meta_dir, 0700);
        char cache_meta_file[1024];
        snprintf(cache_meta_file, sizeof(cache_meta_file), "%s/%s.json", cache_meta_dir, base_name);
        char *cache_json = g_strdup_printf(
            "{\n"
            "  \"dest_basename\": \"%s\",\n"
            "  \"dest_path\": \"%s\",\n"
            "  \"source_path\": \"%s\",\n"
            "  \"source_dir\": \"%s\",\n"
            "  \"is_move\": %s,\n"
            "  \"timestamp\": %ld\n"
            "}\n",
            base_name, dest_path, src_path, src_dir,
            is_move ? "true" : "false", (long)time(NULL)
        );
        if (cache_json) {
            g_file_set_contents(cache_meta_file, cache_json, -1, NULL);
            g_free(cache_json);
        }

        g_free(src_dir);
        g_free(base_name);
    }

    g_free(src_path);
    g_free(dest_path);
}

gboolean g_file_copy(GFile *source,
                     GFile *destination,
                     GFileCopyFlags flags,
                     GCancellable *cancellable,
                     GFileProgressCallback progress_callback,
                     gpointer progress_callback_data,
                     GError **error)
{
    if (!orig_g_file_copy) {
        orig_g_file_copy = dlsym(RTLD_NEXT, "g_file_copy");
    }

    if (is_nautilus()) {
        mac_record_app_drop(source, destination, FALSE);
    }

    if (orig_g_file_copy) {
        gboolean res = orig_g_file_copy(source, destination, flags, cancellable,
                                        progress_callback, progress_callback_data, error);
        if (res && is_nautilus() && destination && source) {
            char *dpath = g_file_get_path(destination);
            char *spath = g_file_get_path(source);
            if (dpath && spath) {
                setxattr(dpath, "user.mac_source_path", spath, strlen(spath), 0);
                char *sdir = g_path_get_dirname(spath);
                if (sdir) {
                    setxattr(dpath, "user.mac_source_dir", sdir, strlen(sdir), 0);
                    g_free(sdir);
                }
            }
            g_free(dpath);
            g_free(spath);
        }
        return res;
    }
    return FALSE;
}

gboolean g_file_move(GFile *source,
                     GFile *destination,
                     GFileCopyFlags flags,
                     GCancellable *cancellable,
                     GFileProgressCallback progress_callback,
                     gpointer progress_callback_data,
                     GError **error)
{
    if (!orig_g_file_move) {
        orig_g_file_move = dlsym(RTLD_NEXT, "g_file_move");
    }
    if (!orig_g_file_copy) {
        orig_g_file_copy = dlsym(RTLD_NEXT, "g_file_copy");
    }

    if (is_nautilus() && source && destination) {
        char *src_p = g_file_get_path(source);
        char *dest_p = g_file_get_path(destination);
        const char *home = g_get_home_dir();

        if (src_p && dest_p && home) {
            char apps_dir[512];
            snprintf(apps_dir, sizeof(apps_dir), "%s/Applications", home);
            size_t apps_len = strlen(apps_dir);

            /* If moving an installer/executable into Applications from outside:
               DO NOT DESTROY THE ORIGINAL FILE IN SOURCE DIRECTORY!
               Record the source info, and COPY the file instead of moving it! */
            if (strncmp(dest_p, apps_dir, apps_len) == 0 &&
                (dest_p[apps_len] == '/' || dest_p[apps_len] == '\0') &&
                !(strncmp(src_p, apps_dir, apps_len) == 0 && (src_p[apps_len] == '/' || src_p[apps_len] == '\0')) &&
                is_installer_extension(src_p)) {

                mac_record_app_drop(source, destination, TRUE);

                if (orig_g_file_copy) {
                    gboolean res = orig_g_file_copy(source, destination, flags | G_FILE_COPY_OVERWRITE,
                                                    cancellable, progress_callback, progress_callback_data, error);
                    if (res) {
                        setxattr(dest_p, "user.mac_source_path", src_p, strlen(src_p), 0);
                        char *sdir = g_path_get_dirname(src_p);
                        if (sdir) {
                            setxattr(dest_p, "user.mac_source_dir", sdir, strlen(sdir), 0);
                            g_free(sdir);
                        }
                    }
                    g_free(src_p);
                    g_free(dest_p);
                    return res;
                }
            }
        }
        g_free(src_p);
        g_free(dest_p);

        mac_record_app_drop(source, destination, TRUE);
    }

    if (orig_g_file_move) {
        return orig_g_file_move(source, destination, flags, cancellable,
                                progress_callback, progress_callback_data, error);
    }
    return FALSE;
}

static void (*orig_gtk_list_box_set_sort_func)(GtkListBox *box,
                                               GtkListBoxSortFunc sort_func,
                                               gpointer user_data,
                                               GDestroyNotify destroy) = NULL;

static void (*orig_gtk_list_box_set_header_func)(GtkListBox *box,
                                                 GtkListBoxUpdateHeaderFunc header_func,
                                                 gpointer user_data,
                                                 GDestroyNotify destroy) = NULL;

static const char *(*orig_g_file_info_get_display_name)(GFileInfo *info) = NULL;
static gboolean (*orig_g_file_info_get_is_symlink)(GFileInfo *info) = NULL;
static gboolean (*orig_g_file_info_get_attribute_boolean)(GFileInfo *info, const char *attribute) = NULL;
static GBinding *(*orig_g_object_bind_property)(gpointer source, const gchar *source_property,
                                                gpointer target, const gchar *target_property,
                                                GBindingFlags flags) = NULL;

const char *g_file_info_get_display_name(GFileInfo *info)
{
    if (!orig_g_file_info_get_display_name) {
        orig_g_file_info_get_display_name = dlsym(RTLD_NEXT, "g_file_info_get_display_name");
    }
    if (!orig_g_file_info_get_display_name) return NULL;
    if (!info) return NULL;

    const char *name = orig_g_file_info_get_display_name(info);
    if (!name || !is_nautilus()) return name;
    
    if (g_str_has_suffix(name, ".desktop")) {
        const char *cached = g_object_get_data(G_OBJECT(info), "mac_clean_display_name");
        if (cached) return cached;

        size_t len = strlen(name);
        if (len > 8) {
            char *clean = g_strndup(name, len - 8);
            g_object_set_data_full(G_OBJECT(info), "mac_clean_display_name", clean, g_free);
            return clean;
        }
    }
    return name;
}

static const char *safe_get_name(GFileInfo *info)
{
    if (!info) return NULL;
    if (!g_file_info_has_attribute(info, "standard::name")) return NULL;
    return g_file_info_get_name(info);
}

static const char *(*orig_g_file_info_get_symlink_target)(GFileInfo *info) = NULL;
const char *g_file_info_get_symlink_target(GFileInfo *info)
{
    if (!orig_g_file_info_get_symlink_target) {
        orig_g_file_info_get_symlink_target = dlsym(RTLD_NEXT, "g_file_info_get_symlink_target");
    }
    if (!orig_g_file_info_get_symlink_target) return NULL;
    if (!is_nautilus()) return orig_g_file_info_get_symlink_target(info);

    const char *name = safe_get_name(info);
    if (name && g_str_has_suffix(name, ".desktop")) {
        return NULL;
    }
    return orig_g_file_info_get_symlink_target(info);
}

gboolean g_file_info_get_is_symlink(GFileInfo *info)
{
    if (!orig_g_file_info_get_is_symlink) {
        orig_g_file_info_get_is_symlink = dlsym(RTLD_NEXT, "g_file_info_get_is_symlink");
    }
    if (!orig_g_file_info_get_is_symlink) return FALSE;
    if (!is_nautilus()) return orig_g_file_info_get_is_symlink(info);

    const char *name = safe_get_name(info);
    if (name && g_str_has_suffix(name, ".desktop")) {
        return FALSE;
    }
    return orig_g_file_info_get_is_symlink(info);
}

gboolean g_file_info_get_attribute_boolean(GFileInfo *info, const char *attribute)
{
    if (!orig_g_file_info_get_attribute_boolean) {
        orig_g_file_info_get_attribute_boolean = dlsym(RTLD_NEXT, "g_file_info_get_attribute_boolean");
    }
    if (!orig_g_file_info_get_attribute_boolean) return FALSE;
    if (!is_nautilus()) return orig_g_file_info_get_attribute_boolean(info, attribute);

    if (attribute) {
        if (strcmp(attribute, "access::can-write") == 0) {
            const char *name = safe_get_name(info);
            if (name && g_str_has_suffix(name, ".desktop")) {
                return TRUE;
            }
        } else if (strcmp(attribute, "standard::is-symlink") == 0) {
            const char *name = safe_get_name(info);
            if (name && g_str_has_suffix(name, ".desktop")) {
                return FALSE;
            }
        }
    }
    return orig_g_file_info_get_attribute_boolean(info, attribute);
}

GBinding *g_object_bind_property(gpointer source, const gchar *source_property,
                                 gpointer target, const gchar *target_property,
                                 GBindingFlags flags)
{
    if (!orig_g_object_bind_property) {
        orig_g_object_bind_property = dlsym(RTLD_NEXT, "g_object_bind_property");
    }
    if (!orig_g_object_bind_property) return NULL;
    
    if (is_nautilus() &&
        g_strcmp0(source_property, "symbolic-icon") == 0 &&
        g_strcmp0(target_property, "start-icon") == 0 &&
        G_IS_OBJECT(target) &&
        g_object_class_find_property(G_OBJECT_GET_CLASS(target), "uri")) {
        gchar *uri = NULL;
        g_object_get(target, "uri", &uri, NULL);
        if (uri && (g_str_has_suffix(uri, "/Applications") || g_str_has_suffix(uri, "/Applications/"))) {
            g_free(uri);
            GIcon *icon = g_themed_icon_new("software-store-symbolic");
            g_object_set(source, "symbolic-icon", icon, NULL);
            g_object_unref(icon);
            return orig_g_object_bind_property(source, source_property, target, target_property, flags);
        }
        g_free(uri);
    }
    
    return orig_g_object_bind_property(source, source_property, target, target_property, flags);
}

static gboolean is_ukrainian_locale(void)
{
    const char *lang = g_getenv("LANG");
    const char *lc_all = g_getenv("LC_ALL");
    const char *lc_messages = g_getenv("LC_MESSAGES");
    const char *l = lc_all ? lc_all : (lc_messages ? lc_messages : lang);
    return (l && g_str_has_prefix(l, "uk"));
}

static gboolean uri_matches_xdg(const char *uri, GUserDirectory dir, const char *alt1, const char *alt2)
{
    if (!uri) return FALSE;
    const char *path = g_get_user_special_dir(dir);
    if (path) {
        GFile *f = g_file_new_for_path(path);
        if (f) {
            char *f_uri = g_file_get_uri(f);
            g_object_unref(f);
            if (f_uri) {
                gboolean m = (g_str_equal(uri, f_uri) ||
                              (g_str_has_prefix(uri, f_uri) && uri[strlen(f_uri)] == '/'));
                g_free(f_uri);
                if (m) return TRUE;
            }
        }
    }
    if (alt1 && (g_str_has_suffix(uri, alt1) || g_str_has_suffix(uri, "/Desktop/")))
        return TRUE;
    if (alt2 && g_str_has_suffix(uri, alt2))
        return TRUE;
    return FALSE;
}

static int get_row_priority(GtkListBoxRow *row)
{
    if (!row || !G_IS_OBJECT(row)) return 9999;
    
    gchar *uri = NULL;
    gchar *label = NULL;
    gint section_type = 0;
    
    GObjectClass *oc = G_OBJECT_GET_CLASS(row);
    if (g_object_class_find_property(oc, "uri"))
        g_object_get(row, "uri", &uri, NULL);
    if (g_object_class_find_property(oc, "label"))
        g_object_get(row, "label", &label, NULL);
    if (g_object_class_find_property(oc, "section-type"))
        g_object_get(row, "section-type", &section_type, NULL);
    
    int rank = 500;
    const char *home = g_get_home_dir();
    
    if (uri != NULL) {
        if (g_str_has_prefix(uri, "recent:///")) {
            rank = 10;
        } else if (g_str_has_prefix(uri, "file://") && home && g_str_equal(uri + 7, home)) {
            rank = 20;
        } else if (g_str_has_prefix(uri, "starred:///")) {
            rank = 950; // hide
        } else if (g_str_has_prefix(uri, "x-network-view:///") || g_str_has_prefix(uri, "network:///")) {
            rank = 960; // hide
        } else if (g_str_has_prefix(uri, "trash:///")) {
            rank = 800; // bottom
        } else if (g_str_has_suffix(uri, "/Applications") || g_str_has_suffix(uri, "/Applications/")) {
            rank = 100;
        } else if (uri_matches_xdg(uri, G_USER_DIRECTORY_DESKTOP, "/Desktop", "/%D0%94%D0%B5%D1%81%D0%BA%D1%82%D0%BE%D0%BF") ||
                   g_str_has_suffix(uri, "/%D0%A1%D1%82%D1%96%D0%BB%D1%8C%D0%BD%D0%B8%D1%86%D1%8F") ||
                   g_str_has_suffix(uri, "/%D0%A0%D0%BE%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D1%96%D0%BB")) {
            rank = 110;
        } else if (uri_matches_xdg(uri, G_USER_DIRECTORY_DOCUMENTS, "/Documents", "/%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D0%B8")) {
            rank = 120;
        } else if (uri_matches_xdg(uri, G_USER_DIRECTORY_DOWNLOAD, "/Downloads", "/%D0%97%D0%B0%D0%B2%D0%B0%D0%BD%D1%82%D0%B0%D0%B6%D0%B5%D0%BD%D0%B5") ||
                   g_str_has_suffix(uri, "/%D0%97%D0%B0%D0%B2%D0%B0%D0%BD%D1%82%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D1%8F")) {
            rank = 130;
        } else if (uri_matches_xdg(uri, G_USER_DIRECTORY_PICTURES, "/Pictures", "/%D0%97%D0%BE%D0%B1%D1%80%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D1%8F")) {
            rank = 140;
        } else if (uri_matches_xdg(uri, G_USER_DIRECTORY_VIDEOS, "/Videos", "/%D0%92%D1%96%D0%B4%D0%B5%D0%BE")) {
            rank = 150;
        } else if (section_type == 2) { /* BOOKMARKS */
            rank = 160;
        } else if (section_type == 4) { /* MOUNTS */
            rank = 300;
        }
    } else {
        if (label && (g_str_equal(label, "Створити закладку") || g_str_equal(label, "New bookmark"))) {
            rank = 999; /* hide */
        } else if (section_type == 4) {
            rank = 300;
        }
    }
    
    g_free(uri);
    g_free(label);
    return rank;
}

static gint mac_sidebar_sort_func(GtkListBoxRow *row1, GtkListBoxRow *row2, gpointer user_data G_GNUC_UNUSED)
{
    int p1 = get_row_priority(row1);
    int p2 = get_row_priority(row2);
    
    if (p1 != p2) {
        return p1 - p2;
    }
    
    gchar *label1 = NULL, *label2 = NULL;
    gint idx1 = 0, idx2 = 0;
    GObjectClass *oc1 = G_OBJECT_GET_CLASS(row1);
    GObjectClass *oc2 = G_OBJECT_GET_CLASS(row2);
    
    if (g_object_class_find_property(oc1, "label"))
        g_object_get(row1, "label", &label1, NULL);
    if (g_object_class_find_property(oc1, "order-index"))
        g_object_get(row1, "order-index", &idx1, NULL);
        
    if (g_object_class_find_property(oc2, "label"))
        g_object_get(row2, "label", &label2, NULL);
    if (g_object_class_find_property(oc2, "order-index"))
        g_object_get(row2, "order-index", &idx2, NULL);
    
    int res = 0;
    if (idx1 != idx2 && idx1 > 0 && idx2 > 0) {
        res = idx1 - idx2;
    } else if (label1 && label2) {
        res = g_utf8_collate(label1, label2);
    }
    
    g_free(label1);
    g_free(label2);
    return res;
}

static void find_and_style_images(GtkWidget *widget, gboolean orange)
{
    if (!widget) return;
    if (GTK_IS_IMAGE(widget)) {
        if (orange) {
            gtk_widget_add_css_class(widget, "sidebar-orange-icon");
            gtk_widget_remove_css_class(widget, "sidebar-neutral-icon");
        } else {
            gtk_widget_remove_css_class(widget, "sidebar-orange-icon");
            gtk_widget_add_css_class(widget, "sidebar-neutral-icon");
        }
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_and_style_images(child, orange);
    }
}

static void mac_sidebar_header_func(GtkListBoxRow *row, GtkListBoxRow *before, gpointer user_data G_GNUC_UNUSED)
{
    if (!row || !G_IS_OBJECT(row)) return;
    
    int p = get_row_priority(row);
    if (p >= 900) {
        gtk_widget_set_visible(GTK_WIDGET(row), FALSE);
        gtk_list_box_row_set_header(row, NULL);
        return;
    }
    gtk_widget_set_visible(GTK_WIDGET(row), TRUE);
    
    /* Dynamic renaming and icon setup */
    gchar *uri = NULL;
    gchar *cur_label = NULL;
    GObjectClass *oc = G_OBJECT_GET_CLASS(row);
    if (g_object_class_find_property(oc, "uri"))
        g_object_get(row, "uri", &uri, NULL);
    if (g_object_class_find_property(oc, "label"))
        g_object_get(row, "label", &cur_label, NULL);
    
    gboolean has_start_icon = g_object_class_find_property(oc, "start-icon") != NULL;
    gboolean has_label = g_object_class_find_property(oc, "label") != NULL;
    
    gboolean uk = is_ukrainian_locale();

    if (uri) {
        if (p == 10) {
            const char *target = uk ? "Недавні" : "Recent";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *clock = g_themed_icon_new("preferences-system-time-symbolic");
                g_object_set(row, "start-icon", clock, NULL);
                g_object_unref(clock);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 20) {
            const char *target = uk ? "Домівка" : "Home";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 100) {
            const char *target = uk ? "Програми" : "Applications";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *app_icon = g_themed_icon_new("software-store-symbolic");
                g_object_set(row, "start-icon", app_icon, NULL);
                g_object_unref(app_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 110) {
            const char *target = uk ? "Робочий стіл" : "Desktop";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *desk_icon = g_themed_icon_new("user-desktop-symbolic");
                g_object_set(row, "start-icon", desk_icon, NULL);
                g_object_unref(desk_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 120) {
            const char *target = uk ? "Документи" : "Documents";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *doc_icon = g_themed_icon_new("folder-documents-symbolic");
                g_object_set(row, "start-icon", doc_icon, NULL);
                g_object_unref(doc_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 130) {
            const char *target = uk ? "Завантаження" : "Downloads";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *dl_icon = g_themed_icon_new("folder-download-symbolic");
                g_object_set(row, "start-icon", dl_icon, NULL);
                g_object_unref(dl_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 140) {
            const char *target = uk ? "Фото" : "Pictures";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *pic_icon = g_themed_icon_new("folder-pictures-symbolic");
                g_object_set(row, "start-icon", pic_icon, NULL);
                g_object_unref(pic_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 150) {
            const char *target = uk ? "Відеозаписи" : "Movies";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *vid_icon = g_themed_icon_new("folder-videos-symbolic");
                g_object_set(row, "start-icon", vid_icon, NULL);
                g_object_unref(vid_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 800) {
            const char *target = uk ? "Кошик" : "Trash";
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            find_and_style_images(GTK_WIDGET(row), FALSE);
        } else if (p == 300) {
            find_and_style_images(GTK_WIDGET(row), FALSE);
        }
    }
    
    /* Section headers */
    int before_p = before ? get_row_priority(before) : 0;
    
    /* Favorites section begins at rank 100 */
    if (p >= 100 && p < 300 && before_p < 100) {
        GtkWidget *header = gtk_list_box_row_get_header(row);
        if (!header || !g_object_get_data(G_OBJECT(header), "mac-favorites-header")) {
            GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
            GtkWidget *lbl = gtk_label_new(uk ? "Вибрані" : "Favorites");
            gtk_widget_add_css_class(lbl, "mac-sidebar-header");
            gtk_widget_set_halign(lbl, GTK_ALIGN_START);
            gtk_box_append(GTK_BOX(box), lbl);
            g_object_set_data(G_OBJECT(box), "mac-favorites-header", GINT_TO_POINTER(1));
            gtk_list_box_row_set_header(row, box);
        }
    }
    /* Mounts / Disks section begins at rank 300 */
    else if (p >= 300 && p < 800 && before_p < 300) {
        GtkWidget *header = gtk_list_box_row_get_header(row);
        if (!header || !g_object_get_data(G_OBJECT(header), "mac-mounts-header")) {
            GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
            GtkWidget *lbl = gtk_label_new(uk ? "Місця" : "Locations");
            gtk_widget_add_css_class(lbl, "mac-sidebar-header");
            gtk_widget_set_halign(lbl, GTK_ALIGN_START);
            gtk_box_append(GTK_BOX(box), lbl);
            g_object_set_data(G_OBJECT(box), "mac-mounts-header", GINT_TO_POINTER(1));
            gtk_list_box_row_set_header(row, box);
        }
    }
    /* Trash separator if directly following mounts */
    else if (p == 800 && before_p >= 300 && before_p < 800) {
        GtkWidget *header = gtk_list_box_row_get_header(row);
        if (!header || !GTK_IS_SEPARATOR(header)) {
            GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
            gtk_widget_add_css_class(sep, "sidebar-trash-separator");
            gtk_list_box_row_set_header(row, sep);
        }
    } else {
        gtk_list_box_row_set_header(row, NULL);
    }
    
    g_free(uri);
    g_free(cur_label);
}

void gtk_list_box_set_sort_func(GtkListBox *box,
                                GtkListBoxSortFunc sort_func,
                                gpointer user_data,
                                GDestroyNotify destroy)
{
    if (!orig_gtk_list_box_set_sort_func) {
        orig_gtk_list_box_set_sort_func = dlsym(RTLD_NEXT, "gtk_list_box_set_sort_func");
    }
    if (!orig_gtk_list_box_set_sort_func) return;

    if (is_nautilus() && GTK_IS_WIDGET(box) && gtk_widget_has_css_class(GTK_WIDGET(box), "navigation-sidebar")) {
        orig_gtk_list_box_set_sort_func(box, mac_sidebar_sort_func, user_data, destroy);
    } else {
        orig_gtk_list_box_set_sort_func(box, sort_func, user_data, destroy);
    }
}

void gtk_list_box_set_header_func(GtkListBox *box,
                                  GtkListBoxUpdateHeaderFunc header_func,
                                  gpointer user_data,
                                  GDestroyNotify destroy)
{
    if (!orig_gtk_list_box_set_header_func) {
        orig_gtk_list_box_set_header_func = dlsym(RTLD_NEXT, "gtk_list_box_set_header_func");
    }
    if (!orig_gtk_list_box_set_header_func) return;

    if (is_nautilus() && GTK_IS_WIDGET(box) && gtk_widget_has_css_class(GTK_WIDGET(box), "navigation-sidebar")) {
        orig_gtk_list_box_set_header_func(box, mac_sidebar_header_func, user_data, destroy);
    } else {
        orig_gtk_list_box_set_header_func(box, header_func, user_data, destroy);
    }
}

static void (*orig_gtk_window_present)(GtkWindow *window) = NULL;
static void (*orig_gtk_window_present_with_time)(GtkWindow *window, guint32 timestamp) = NULL;

static void find_buttons_in_sidebar(GtkWidget *widget, GtkWidget **search_btn, GtkWidget **menu_btn)
{
    if (!widget) return;
    if (GTK_IS_TOGGLE_BUTTON(widget)) {
        const char *action = gtk_actionable_get_action_name(GTK_ACTIONABLE(widget));
        if (g_strcmp0(action, "slot.search-global") == 0) {
            *search_btn = widget;
        }
    } else if (GTK_IS_MENU_BUTTON(widget)) {
        const char *icon = gtk_menu_button_get_icon_name(GTK_MENU_BUTTON(widget));
        if (g_strcmp0(icon, "open-menu-symbolic") == 0) {
            *menu_btn = widget;
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_buttons_in_sidebar(child, search_btn, menu_btn);
    }
}

static void hide_folder_search_button(GtkWidget *widget)
{
    if (!widget) return;
    if (GTK_IS_TOGGLE_BUTTON(widget)) {
        const char *action = gtk_actionable_get_action_name(GTK_ACTIONABLE(widget));
        if (g_strcmp0(action, "slot.search-visible") == 0) {
            gtk_widget_set_visible(widget, FALSE);
            GtkWidget *parent = gtk_widget_get_parent(widget);
            if (parent && GTK_IS_STACK(parent)) {
                gtk_widget_set_visible(parent, FALSE);
            }
            return;
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        hide_folder_search_button(child);
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

static void find_split_view(GtkWidget *widget, AdwOverlaySplitView **split_view)
{
    if (!widget || *split_view) return;
    if (ADW_IS_OVERLAY_SPLIT_VIEW(widget)) {
        *split_view = ADW_OVERLAY_SPLIT_VIEW(widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_split_view(child, split_view);
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

static void shift_start_box(GtkWidget *widget)
{
    if (!widget) return;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(widget), "NautilusHistoryControls") == 0) {
        gtk_widget_set_margin_start(widget, 15);
        fprintf(stderr, "[MAC-NAUTILUS] Found NautilusHistoryControls! Set margin_start to 15\n");
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        shift_start_box(child);
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

static void find_and_enable_scrolled_windows(GtkWidget *widget)
{
    if (!widget) return;
    if (GTK_IS_SCROLLED_WINDOW(widget)) {
        enable_smooth_scrolling_for_scrolled_window(GTK_SCROLLED_WINDOW(widget));
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_and_enable_scrolled_windows(child);
    }
}

static void (*orig_gtk_scrolled_window_set_child)(GtkScrolledWindow *sw, GtkWidget *child) = NULL;

void gtk_scrolled_window_set_child(GtkScrolledWindow *sw, GtkWidget *child)
{
    if (!orig_gtk_scrolled_window_set_child) {
        orig_gtk_scrolled_window_set_child = dlsym(RTLD_NEXT, "gtk_scrolled_window_set_child");
    }
    if (orig_gtk_scrolled_window_set_child) {
        orig_gtk_scrolled_window_set_child(sw, child);
    }
    if (is_nautilus() && sw) {
        enable_smooth_scrolling_for_scrolled_window(sw);
    }
}

static gboolean mac_fix_nautilus_window(gpointer user_data)
{
    GtkWindow *window = GTK_WINDOW(user_data);
    if (!window || !GTK_IS_WINDOW(window)) return G_SOURCE_REMOVE;

    if (g_object_get_data(G_OBJECT(window), "mac_headerbars_reorganized")) {
        return G_SOURCE_REMOVE;
    }

    AdwOverlaySplitView *split_view = NULL;
    find_split_view(GTK_WIDGET(window), &split_view);
    if (!split_view) {
        return G_SOURCE_REMOVE;
    }

    GtkWidget *sidebar = adw_overlay_split_view_get_sidebar(split_view);
    GtkWidget *content = adw_overlay_split_view_get_content(split_view);
    if (!sidebar || !content) return G_SOURCE_REMOVE;

    GList *sidebar_bars = NULL;
    GList *content_bars = NULL;
    find_headerbars_recursive(sidebar, &sidebar_bars);
    find_headerbars_recursive(content, &content_bars);

    if (sidebar_bars && content_bars) {
        AdwHeaderBar *sidebar_hb = ADW_HEADER_BAR(sidebar_bars->data);
        AdwHeaderBar *content_hb = ADW_HEADER_BAR(content_bars->data);

        GtkWidget *search_btn = NULL;
        GtkWidget *menu_btn = NULL;
        find_buttons_in_sidebar(GTK_WIDGET(sidebar_hb), &search_btn, &menu_btn);

        /* 1. Hide title and title-widget in sidebar headerbar (no title near controls) */
        adw_header_bar_set_show_title(sidebar_hb, FALSE);
        adw_header_bar_set_title_widget(sidebar_hb, NULL);

        /* 2. Reparent search and menu buttons to content headerbar (right side, separate buttons) */
        if (menu_btn) {
            g_object_ref(menu_btn);
            remove_from_headerbar(sidebar_hb, menu_btn);
            adw_header_bar_pack_end(content_hb, menu_btn);
            g_object_unref(menu_btn);
        }
        if (search_btn) {
            g_object_ref(search_btn);
            remove_from_headerbar(sidebar_hb, search_btn);
            adw_header_bar_pack_end(content_hb, search_btn);
            g_object_unref(search_btn);
        }

        /* 3. Hide redundant folder search button from pathbar */
        hide_folder_search_button(GTK_WIDGET(content_hb));

        /* 4. Shift content headerbar down by 3px and increase left width/margin by 15px */
        gtk_widget_set_margin_top(GTK_WIDGET(content_hb), 3);
        shift_start_box(GTK_WIDGET(content_hb));

        g_object_set_data(G_OBJECT(window), "mac_headerbars_reorganized", GINT_TO_POINTER(1));
    }

    g_list_free(sidebar_bars);
    g_list_free(content_bars);
    return G_SOURCE_REMOVE;
}

void gtk_window_present(GtkWindow *window)
{
    if (!orig_gtk_window_present) {
        orig_gtk_window_present = dlsym(RTLD_NEXT, "gtk_window_present");
    }
    if (orig_gtk_window_present) {
        orig_gtk_window_present(window);
    }
    if (is_nautilus() && window) {
        find_and_enable_scrolled_windows(GTK_WIDGET(window));
        mac_fix_nautilus_window(window);
        g_idle_add(mac_fix_nautilus_window, window);
    }
}

void gtk_window_present_with_time(GtkWindow *window, guint32 timestamp)
{
    if (!orig_gtk_window_present_with_time) {
        orig_gtk_window_present_with_time = dlsym(RTLD_NEXT, "gtk_window_present_with_time");
    }
    if (orig_gtk_window_present_with_time) {
        orig_gtk_window_present_with_time(window, timestamp);
    }
    if (is_nautilus() && window) {
        find_and_enable_scrolled_windows(GTK_WIDGET(window));
        mac_fix_nautilus_window(window);
        g_idle_add(mac_fix_nautilus_window, window);
    }
}
