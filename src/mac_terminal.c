#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <unistd.h>
#include <sys/types.h>
#include <termios.h>
#include <gtk/gtk.h>
#include <adwaita.h>

/* =========================================================================
 * macW1Y macOS Tahoe Terminal (Ptyxis) Customizer & Redesign
 *
 * Implements 1:1 macOS Terminal header bar & layout:
 * - Window controls (traffic lights) on the left.
 * - All other buttons (new tab splitbutton, menu button, overview) removed.
 * - Dynamic macOS title: [📁] <folder> — <path> — <columns>x<rows>
 * - Folder tracking via VTE URI and /proc/<tcgetpgrp>/cwd.
 * - Live window dimensions tracking (e.g. 120x30).
 * ========================================================================= */

static void (*orig_gtk_window_present)(GtkWindow *window) = NULL;
static void (*orig_gtk_window_present_with_time)(GtkWindow *window, guint32 timestamp) = NULL;

typedef struct {
    GtkWidget *window;
    GtkWidget *header_bar;
    GtkWidget *title_box;
    GtkWidget *lbl_folder;
    GtkWidget *lbl_path;
    GtkWidget *lbl_size;
    GtkWidget *vte_terminal;
    guint timer_id;
} MacTerminalData;

/* VTE function pointer types */
typedef glong (*vte_get_count_fn)(void *terminal);
typedef const char *(*vte_get_uri_fn)(void *terminal);
typedef void *(*vte_get_pty_fn)(void *terminal);
typedef int (*vte_pty_get_fd_fn)(void *pty);

static vte_get_count_fn p_vte_col_count = NULL;
static vte_get_count_fn p_vte_row_count = NULL;
static vte_get_uri_fn p_vte_curr_dir_uri = NULL;
static vte_get_pty_fn p_vte_get_pty = NULL;
static vte_pty_get_fd_fn p_vte_pty_get_fd = NULL;

static void init_vte_symbols(void) {
    if (!p_vte_col_count) p_vte_col_count = (vte_get_count_fn)dlsym(RTLD_DEFAULT, "vte_terminal_get_column_count");
    if (!p_vte_row_count) p_vte_row_count = (vte_get_count_fn)dlsym(RTLD_DEFAULT, "vte_terminal_get_row_count");
    if (!p_vte_curr_dir_uri) p_vte_curr_dir_uri = (vte_get_uri_fn)dlsym(RTLD_DEFAULT, "vte_terminal_get_current_directory_uri");
    if (!p_vte_get_pty) p_vte_get_pty = (vte_get_pty_fn)dlsym(RTLD_DEFAULT, "vte_terminal_get_pty");
    if (!p_vte_pty_get_fd) p_vte_pty_get_fd = (vte_pty_get_fd_fn)dlsym(RTLD_DEFAULT, "vte_pty_get_fd");
}

static GtkWidget *find_vte_terminal_recursive(GtkWidget *widget) {
    if (!widget) return NULL;
    GType vte_type = g_type_from_name("VteTerminal");
    if (vte_type != G_TYPE_INVALID && g_type_is_a(G_OBJECT_TYPE(widget), vte_type)) {
        return widget;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget);
         child != NULL;
         child = gtk_widget_get_next_sibling(child)) {
        GtkWidget *res = find_vte_terminal_recursive(child);
        if (res) return res;
    }
    return NULL;
}

static GtkWidget *find_active_vte_terminal(GtkWidget *window) {
    if (!window) return NULL;
    GObject *active_tab = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(window), "active-tab")) {
        g_object_get(G_OBJECT(window), "active-tab", &active_tab, NULL);
        if (active_tab) {
            GtkWidget *vte = find_vte_terminal_recursive(GTK_WIDGET(active_tab));
            g_object_unref(active_tab);
            if (vte) return vte;
        }
    }
    return find_vte_terminal_recursive(window);
}

static GtkWidget *find_main_header_bar(GtkWidget *widget) {
    if (!widget) return NULL;
    if (ADW_IS_HEADER_BAR(widget) && gtk_widget_has_css_class(widget, "main-header-bar")) {
        return widget;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget);
         child != NULL;
         child = gtk_widget_get_next_sibling(child)) {
        GtkWidget *res = find_main_header_bar(child);
        if (res) return res;
    }
    return NULL;
}

static GtkWidget *find_center_box(GtkWidget *widget) {
    if (!widget) return NULL;
    if (GTK_IS_CENTER_BOX(widget)) {
        return widget;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget);
         child != NULL;
         child = gtk_widget_get_next_sibling(child)) {
        GtkWidget *res = find_center_box(child);
        if (res) return res;
    }
    return NULL;
}

static void get_terminal_cwd(MacTerminalData *data, char *out_folder, size_t folder_sz, char *out_path, size_t path_sz) {
    char cwd_buf[1024] = {0};
    gboolean got_cwd = FALSE;

    /* 1. Try VTE current directory URI (OSC 7) */
    if (data->vte_terminal && p_vte_curr_dir_uri) {
        const char *uri = p_vte_curr_dir_uri(data->vte_terminal);
        if (uri && *uri) {
            char *filename = g_filename_from_uri(uri, NULL, NULL);
            if (filename) {
                g_strlcpy(cwd_buf, filename, sizeof(cwd_buf));
                g_free(filename);
                got_cwd = TRUE;
            }
        }
    }

    /* 2. Fallback: inspect /proc/<tcgetpgrp>/cwd from terminal PTY fd */
    if (!got_cwd && data->vte_terminal && p_vte_get_pty && p_vte_pty_get_fd) {
        void *pty = p_vte_get_pty(data->vte_terminal);
        if (pty) {
            int fd = p_vte_pty_get_fd(pty);
            if (fd >= 0) {
                pid_t pgrp = tcgetpgrp(fd);
                if (pgrp > 0) {
                    char proc_path[64];
                    snprintf(proc_path, sizeof(proc_path), "/proc/%d/cwd", (int)pgrp);
                    ssize_t len = readlink(proc_path, cwd_buf, sizeof(cwd_buf) - 1);
                    if (len > 0) {
                        cwd_buf[len] = '\0';
                        got_cwd = TRUE;
                    }
                }
            }
        }
    }

    /* 3. Fallback: User home directory */
    if (!got_cwd) {
        const char *home = g_get_home_dir();
        g_strlcpy(cwd_buf, home ? home : "/", sizeof(cwd_buf));
    }

    /* Format display path (replace $HOME with ~) */
    const char *home = g_get_home_dir();
    char display_path[1024];
    if (home && g_str_has_prefix(cwd_buf, home)) {
        const char *sub = cwd_buf + strlen(home);
        if (*sub == '\0') {
            snprintf(display_path, sizeof(display_path), "~");
        } else if (*sub == '/') {
            snprintf(display_path, sizeof(display_path), "~%s", sub);
        } else {
            g_strlcpy(display_path, cwd_buf, sizeof(display_path));
        }
    } else {
        g_strlcpy(display_path, cwd_buf, sizeof(display_path));
    }

    g_strlcpy(out_path, display_path, path_sz);

    /* Format folder name (basename of cwd) */
    char *base = g_path_get_basename(cwd_buf);
    if (base) {
        g_strlcpy(out_folder, base, folder_sz);
        g_free(base);
    } else {
        g_strlcpy(out_folder, "~", folder_sz);
    }
}

static gboolean update_terminal_title_cb(gpointer user_data) {
    MacTerminalData *data = (MacTerminalData *)user_data;
    if (!data || !GTK_IS_WIDGET(data->window) || !gtk_widget_get_realized(data->window)) {
        return G_SOURCE_CONTINUE;
    }

    /* Track active terminal in current tab */
    data->vte_terminal = find_active_vte_terminal(data->window);

    char folder[256] = {0};
    char path[1024] = {0};
    get_terminal_cwd(data, folder, sizeof(folder), path, sizeof(path));

    long cols = 120;
    long rows = 30;
    if (data->vte_terminal && p_vte_col_count && p_vte_row_count) {
        cols = p_vte_col_count(data->vte_terminal);
        rows = p_vte_row_count(data->vte_terminal);
        if (cols <= 0) cols = 120;
        if (rows <= 0) rows = 30;
    }

    char size_buf[64];
    snprintf(size_buf, sizeof(size_buf), "%ldx%ld", cols, rows);

    gtk_label_set_text(GTK_LABEL(data->lbl_folder), folder);
    gtk_label_set_text(GTK_LABEL(data->lbl_path), path);
    gtk_label_set_text(GTK_LABEL(data->lbl_size), size_buf);

    return G_SOURCE_CONTINUE;
}

static void mac_terminal_data_destroy(gpointer user_data) {
    MacTerminalData *data = (MacTerminalData *)user_data;
    if (data) {
        if (data->timer_id > 0) {
            g_source_remove(data->timer_id);
            data->timer_id = 0;
        }
        g_free(data);
    }
}

static void init_terminal_css(void) {
    static gboolean css_initialized = FALSE;
    if (css_initialized) return;
    css_initialized = TRUE;

    GtkCssProvider *provider = gtk_css_provider_new();
    const char *css = 
        ".ptyxis-window headerbar {"
        "   padding-top: 2px;"
        "   padding-bottom: 2px;"
        "}"
        ".mac-terminal-title-box {"
        "   margin-left: 10px;"
        "}"
        ".mac-terminal-folder-icon {"
        "   margin-right: 2px;"
        "}"
        ".mac-terminal-folder-label {"
        "   font-family: 'SF Pro Display', 'SF Pro Text', 'SF Pro', system-ui, sans-serif;"
        "   font-weight: 600;"
        "   font-size: 13px;"
        "   color: #ffffff;"
        "}"
        ".mac-terminal-sep {"
        "   font-family: 'SF Pro Display', 'SF Pro Text', 'SF Pro', system-ui, sans-serif;"
        "   font-size: 13px;"
        "   color: rgba(255, 255, 255, 0.4);"
        "   margin-left: 2px;"
        "   margin-right: 2px;"
        "}"
        ".mac-terminal-path-label {"
        "   font-family: 'SF Pro Display', 'SF Pro Text', 'SF Pro', system-ui, sans-serif;"
        "   font-weight: 400;"
        "   font-size: 13px;"
        "   color: rgba(255, 255, 255, 0.85);"
        "}"
        ".mac-terminal-size-label {"
        "   font-family: 'SF Pro Display', 'SF Pro Text', 'SF Pro', system-ui, sans-serif;"
        "   font-weight: 400;"
        "   font-size: 13px;"
        "   color: rgba(255, 255, 255, 0.85);"
        "}";

    gtk_css_provider_load_from_string(provider, css);
    GdkDisplay *disp = gdk_display_get_default();
    if (disp) {
        gtk_style_context_add_provider_for_display(
            disp,
            GTK_STYLE_PROVIDER(provider),
            GTK_STYLE_PROVIDER_PRIORITY_APPLICATION + 100
        );
    }
    g_object_unref(provider);
}

static void apply_mac_terminal_styling(GtkWindow *window) {
    if (g_object_get_data(G_OBJECT(window), "mac_terminal_applied")) return;
    g_object_set_data(G_OBJECT(window), "mac_terminal_applied", GINT_TO_POINTER(1));

    init_terminal_css();
    init_vte_symbols();

    GtkWidget *header_bar = find_main_header_bar(GTK_WIDGET(window));
    if (!header_bar) {
        return;
    }

    /* 1. Hide default title widget (AdwWindowTitle) */
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(header_bar), NULL);

    /* 2. Hide unwanted buttons */
    GtkWidget *center_box = find_center_box(header_bar);
    if (center_box) {
        /* Hide right/end buttons entirely */
        GtkWidget *end_widget = gtk_center_box_get_end_widget(GTK_CENTER_BOX(center_box));
        if (end_widget) {
            gtk_widget_set_visible(end_widget, FALSE);
        }
        /* Hide center widget */
        GtkWidget *ctr_widget = gtk_center_box_get_center_widget(GTK_CENTER_BOX(center_box));
        if (ctr_widget) {
            gtk_widget_set_visible(ctr_widget, FALSE);
        }

        /* In start widget, find box and hide everything except GtkWindowControls */
        GtkWidget *start_widget = gtk_center_box_get_start_widget(GTK_CENTER_BOX(center_box));
        if (start_widget) {
            for (GtkWidget *w = gtk_widget_get_first_child(start_widget); w != NULL; w = gtk_widget_get_next_sibling(w)) {
                if (GTK_IS_BOX(w)) {
                    for (GtkWidget *inner = gtk_widget_get_first_child(w); inner != NULL; inner = gtk_widget_get_next_sibling(inner)) {
                        if (GTK_IS_WINDOW_CONTROLS(inner) || g_strcmp0(G_OBJECT_TYPE_NAME(inner), "GtkWindowControls") == 0) {
                            gtk_widget_set_visible(inner, TRUE);
                        } else {
                            gtk_widget_set_visible(inner, FALSE);
                        }
                    }
                } else if (!GTK_IS_WINDOW_CONTROLS(w) && g_strcmp0(G_OBJECT_TYPE_NAME(w), "GtkWindowControls") != 0) {
                    gtk_widget_set_visible(w, FALSE);
                }
            }
        }
    }

    /* 3. Create macOS Terminal title box: [📁] folder — path — 120x30 */
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    gtk_widget_add_css_class(box, "mac-terminal-title-box");
    gtk_widget_set_valign(box, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_start(box, 6);

    /* Load authentic macOS folder icon using GtkPicture */
    GtkWidget *icon = NULL;
    const char *folder_icon_paths[] = {
        "/usr/share/icons/MacTahoe-dark/places/scalable/folder.svg",
        "/home/vitaliy/.local/share/icons/MacTahoe-dark/places/scalable/folder.svg",
        "/usr/share/icons/MacTahoe/places/scalable/folder.svg",
        "/home/vitaliy/.local/share/icons/MacTahoe/places/scalable/folder.svg",
        NULL
    };
    for (int i = 0; folder_icon_paths[i]; i++) {
        if (access(folder_icon_paths[i], R_OK) == 0) {
            GFile *gf = g_file_new_for_path(folder_icon_paths[i]);
            GdkTexture *tex = gdk_texture_new_from_file(gf, NULL);
            g_object_unref(gf);
            if (tex) {
                icon = gtk_picture_new_for_paintable(GDK_PAINTABLE(tex));
                gtk_picture_set_can_shrink(GTK_PICTURE(icon), TRUE);
                gtk_widget_set_size_request(icon, 16, 16);
                g_object_unref(tex);
                break;
            }
        }
    }
    if (!icon) {
        icon = gtk_image_new_from_icon_name("folder");
        gtk_image_set_pixel_size(GTK_IMAGE(icon), 16);
    }
    gtk_widget_add_css_class(icon, "mac-terminal-folder-icon");
    gtk_box_append(GTK_BOX(box), icon);

    GtkWidget *lbl_folder = gtk_label_new("");
    gtk_widget_add_css_class(lbl_folder, "mac-terminal-folder-label");
    gtk_label_set_single_line_mode(GTK_LABEL(lbl_folder), TRUE);
    gtk_box_append(GTK_BOX(box), lbl_folder);

    GtkWidget *lbl_sep1 = gtk_label_new("—");
    gtk_widget_add_css_class(lbl_sep1, "mac-terminal-sep");
    gtk_box_append(GTK_BOX(box), lbl_sep1);

    GtkWidget *lbl_path = gtk_label_new("");
    gtk_widget_add_css_class(lbl_path, "mac-terminal-path-label");
    gtk_label_set_single_line_mode(GTK_LABEL(lbl_path), TRUE);
    gtk_label_set_ellipsize(GTK_LABEL(lbl_path), PANGO_ELLIPSIZE_MIDDLE);
    gtk_label_set_max_width_chars(GTK_LABEL(lbl_path), 40);
    gtk_box_append(GTK_BOX(box), lbl_path);

    GtkWidget *lbl_sep2 = gtk_label_new("—");
    gtk_widget_add_css_class(lbl_sep2, "mac-terminal-sep");
    gtk_box_append(GTK_BOX(box), lbl_sep2);

    GtkWidget *lbl_size = gtk_label_new("120x30");
    gtk_widget_add_css_class(lbl_size, "mac-terminal-size-label");
    gtk_label_set_single_line_mode(GTK_LABEL(lbl_size), TRUE);
    gtk_box_append(GTK_BOX(box), lbl_size);

    /* Pack at the start of header bar: directly right of traffic lights */
    adw_header_bar_pack_start(ADW_HEADER_BAR(header_bar), box);

    /* Set up dynamic periodic updates */
    MacTerminalData *data = g_new0(MacTerminalData, 1);
    data->window = GTK_WIDGET(window);
    data->header_bar = header_bar;
    data->title_box = box;
    data->lbl_folder = lbl_folder;
    data->lbl_path = lbl_path;
    data->lbl_size = lbl_size;
    data->vte_terminal = find_active_vte_terminal(GTK_WIDGET(window));
    data->timer_id = g_timeout_add(250, update_terminal_title_cb, data);

    g_object_set_data_full(G_OBJECT(window), "mac_terminal_data", data, mac_terminal_data_destroy);

    /* Trigger immediate initial update */
    update_terminal_title_cb(data);
}

void gtk_window_present(GtkWindow *window) {
    if (!orig_gtk_window_present) {
        orig_gtk_window_present = dlsym(RTLD_NEXT, "gtk_window_present");
    }
    if (orig_gtk_window_present) {
        orig_gtk_window_present(window);
    }
    if (window && g_strcmp0(G_OBJECT_TYPE_NAME(window), "PtyxisWindow") == 0) {
        apply_mac_terminal_styling(window);
    }
}

void gtk_window_present_with_time(GtkWindow *window, guint32 timestamp) {
    if (!orig_gtk_window_present_with_time) {
        orig_gtk_window_present_with_time = dlsym(RTLD_NEXT, "gtk_window_present_with_time");
    }
    if (orig_gtk_window_present_with_time) {
        orig_gtk_window_present_with_time(window, timestamp);
    }
    if (window && g_strcmp0(G_OBJECT_TYPE_NAME(window), "PtyxisWindow") == 0) {
        apply_mac_terminal_styling(window);
    }
}
