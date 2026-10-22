#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <gtk/gtk.h>
#include <adwaita.h>
#include <gio/gio.h>

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
        } else if (g_str_has_suffix(uri, "/%D0%94%D0%B5%D1%81%D0%BA%D1%82%D0%BE%D0%BF") ||
                   g_str_has_suffix(uri, "/%D0%A0%D0%BE%D0%B1%D0%BE%D1%87%D0%B8%D0%B9%20%D1%81%D1%82%D1%96%D0%BB") ||
                   g_str_has_suffix(uri, "/Desktop")) {
            rank = 110;
        } else if (g_str_has_suffix(uri, "/%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D0%B8") ||
                   g_str_has_suffix(uri, "/Documents")) {
            rank = 120;
        } else if (g_str_has_suffix(uri, "/%D0%97%D0%B0%D0%B2%D0%B0%D0%BD%D1%82%D0%B0%D0%B6%D0%B5%D0%BD%D0%B5") ||
                   g_str_has_suffix(uri, "/%D0%97%D0%B0%D0%B2%D0%B0%D0%BD%D1%82%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D1%8F") ||
                   g_str_has_suffix(uri, "/Downloads")) {
            rank = 130;
        } else if (g_str_has_suffix(uri, "/%D0%97%D0%BE%D0%B1%D1%80%D0%B0%D0%B6%D0%B5%D0%BD%D0%BD%D1%8F") ||
                   g_str_has_suffix(uri, "/Pictures")) {
            rank = 140;
        } else if (g_str_has_suffix(uri, "/%D0%92%D1%96%D0%B4%D0%B5%D0%BE") ||
                   g_str_has_suffix(uri, "/Videos")) {
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
    
    if (uri) {
        if (p == 10) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Недавні"))) {
                g_object_set(row, "label", "Недавні", NULL);
            }
            if (has_start_icon) {
                GIcon *clock = g_themed_icon_new("preferences-system-time-symbolic");
                g_object_set(row, "start-icon", clock, NULL);
                g_object_unref(clock);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 20) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Домівка"))) {
                g_object_set(row, "label", "Домівка", NULL);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 100) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Програми"))) {
                g_object_set(row, "label", "Програми", NULL);
            }
            if (has_start_icon) {
                GIcon *app_icon = g_themed_icon_new("software-store-symbolic");
                g_object_set(row, "start-icon", app_icon, NULL);
                g_object_unref(app_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 110) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Робочий стіл"))) {
                g_object_set(row, "label", "Робочий стіл", NULL);
            }
            if (has_start_icon) {
                GIcon *desk_icon = g_themed_icon_new("user-desktop-symbolic");
                g_object_set(row, "start-icon", desk_icon, NULL);
                g_object_unref(desk_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 120) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Документи"))) {
                g_object_set(row, "label", "Документи", NULL);
            }
            if (has_start_icon) {
                GIcon *doc_icon = g_themed_icon_new("folder-documents-symbolic");
                g_object_set(row, "start-icon", doc_icon, NULL);
                g_object_unref(doc_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 130) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Завантаження"))) {
                g_object_set(row, "label", "Завантаження", NULL);
            }
            if (has_start_icon) {
                GIcon *dl_icon = g_themed_icon_new("folder-download-symbolic");
                g_object_set(row, "start-icon", dl_icon, NULL);
                g_object_unref(dl_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 140) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Фото"))) {
                g_object_set(row, "label", "Фото", NULL);
            }
            if (has_start_icon) {
                GIcon *pic_icon = g_themed_icon_new("folder-pictures-symbolic");
                g_object_set(row, "start-icon", pic_icon, NULL);
                g_object_unref(pic_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 150) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Відеозаписи"))) {
                g_object_set(row, "label", "Відеозаписи", NULL);
            }
            if (has_start_icon) {
                GIcon *vid_icon = g_themed_icon_new("folder-videos-symbolic");
                g_object_set(row, "start-icon", vid_icon, NULL);
                g_object_unref(vid_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 800) {
            if (has_label && (!cur_label || !g_str_equal(cur_label, "Кошик"))) {
                g_object_set(row, "label", "Кошик", NULL);
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
            GtkWidget *lbl = gtk_label_new("Вибрані");
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
            GtkWidget *lbl = gtk_label_new("Місця");
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
        mac_fix_nautilus_window(window);
        g_idle_add(mac_fix_nautilus_window, window);
    }
}
