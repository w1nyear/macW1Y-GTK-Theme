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
#include <gsk/gsk.h>
#include <graphene.h>
#include "mac_i18n.h"




static void (*orig_popover_hide)(GtkWidget *widget) = NULL;
static void (*orig_popover_map)(GtkWidget *widget) = NULL;
static void (*orig_popover_snapshot)(GtkWidget *widget, GtkSnapshot *snapshot) = NULL;

typedef struct {
    guint tick_id;
    gint64 start_time;
    gboolean is_closing;
    gboolean is_opening;
    gboolean in_final_hide;
    double current_scale;
} MacPopoverAnimData;

static MacPopoverAnimData *get_popover_anim_data(GtkWidget *w) {
    MacPopoverAnimData *d = g_object_get_data(G_OBJECT(w), "mac_popover_anim_data");
    if (!d) {
        d = g_new0(MacPopoverAnimData, 1);
        d->current_scale = 1.0;
        g_object_set_data_full(G_OBJECT(w), "mac_popover_anim_data", d, g_free);
    }
    return d;
}

static void mac_popover_snapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
    MacPopoverAnimData *d = get_popover_anim_data(widget);
    if (!d || (!d->is_opening && !d->is_closing)) {
        if (orig_popover_snapshot) orig_popover_snapshot(widget, snapshot);
        return;
    }

    double scale = d->current_scale;
    if (scale <= 0.0 || fabs(scale - 1.0) < 0.001) {
        if (orig_popover_snapshot) orig_popover_snapshot(widget, snapshot);
        return;
    }

    int w = gtk_widget_get_width(widget);
    int h = gtk_widget_get_height(widget);
    float cx = (float)w * 0.5f;
    float cy = 0.0f;
    if (GTK_IS_POPOVER(widget)) {
        GtkPositionType pos = gtk_popover_get_position(GTK_POPOVER(widget));
        if (pos == GTK_POS_TOP) {
            cy = (float)h;
        } else if (pos == GTK_POS_BOTTOM) {
            cy = 0.0f;
        } else if (pos == GTK_POS_LEFT) {
            cx = (float)w;
            cy = (float)h * 0.5f;
        } else if (pos == GTK_POS_RIGHT) {
            cx = 0.0f;
            cy = (float)h * 0.5f;
        }
    }

    graphene_point_t p1, p2;
    graphene_point_init(&p1, cx, cy);
    graphene_point_init(&p2, -cx, -cy);

    GskTransform *t = gsk_transform_translate(NULL, &p1);
    t = gsk_transform_scale(t, (float)scale, (float)scale);
    t = gsk_transform_translate(t, &p2);

    gtk_snapshot_save(snapshot);
    gtk_snapshot_transform(snapshot, t);
    gsk_transform_unref(t);

    if (orig_popover_snapshot) orig_popover_snapshot(widget, snapshot);

    gtk_snapshot_restore(snapshot);
}

static gboolean mac_popover_close_tick(GtkWidget *widget, GdkFrameClock *clock, gpointer user_data) {
    MacPopoverAnimData *d = (MacPopoverAnimData *)user_data;
    gint64 now = gdk_frame_clock_get_frame_time(clock);
    if (d->start_time == 0) {
        d->start_time = now;
        return G_SOURCE_CONTINUE;
    }
    gint64 elapsed = now - d->start_time;
    double p = (double)elapsed / 110000.0;
    if (p >= 1.0) p = 1.0;

    double opacity = 1.0 - (p * p);
    double scale = 1.0 - 0.05 * (p * p);
    d->current_scale = scale;
    gtk_widget_set_opacity(widget, (float)opacity);
    gtk_widget_queue_draw(widget);

    if (p >= 1.0) {
        d->tick_id = 0;
        d->is_closing = FALSE;
        d->in_final_hide = TRUE;
        d->current_scale = 1.0;
        gtk_widget_set_opacity(widget, 1.0f);
        if (orig_popover_hide) {
            orig_popover_hide(widget);
        }
        d->in_final_hide = FALSE;
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

static gboolean mac_popover_open_tick(GtkWidget *widget, GdkFrameClock *clock, gpointer user_data) {
    MacPopoverAnimData *d = (MacPopoverAnimData *)user_data;
    gint64 now = gdk_frame_clock_get_frame_time(clock);
    if (d->start_time == 0) {
        d->start_time = now;
        return G_SOURCE_CONTINUE;
    }
    gint64 elapsed = now - d->start_time;
    double p = (double)elapsed / 140000.0;
    if (p >= 1.0) p = 1.0;

    double ease = 1.0 - pow(1.0 - p, 3);
    double scale = 0.94 + 0.06 * ease;
    d->current_scale = scale;
    gtk_widget_set_opacity(widget, (float)ease);
    gtk_widget_queue_draw(widget);

    if (p >= 1.0) {
        d->tick_id = 0;
        d->is_opening = FALSE;
        d->current_scale = 1.0;
        gtk_widget_set_opacity(widget, 1.0f);
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

static void mac_popover_map(GtkWidget *w) {
    if (GTK_IS_POPOVER(w)) {
        gtk_popover_set_has_arrow(GTK_POPOVER(w), FALSE);
    }
    if (orig_popover_map) orig_popover_map(w);

    MacPopoverAnimData *d = get_popover_anim_data(w);
    if (d->tick_id && d->is_closing) {
        gtk_widget_remove_tick_callback(w, d->tick_id);
        d->tick_id = 0;
        d->is_closing = FALSE;
    }
    d->current_scale = 0.94;
    gtk_widget_set_opacity(w, 0.0f);
    d->is_opening = TRUE;
    d->is_closing = FALSE;
    d->start_time = 0;
    if (d->tick_id) gtk_widget_remove_tick_callback(w, d->tick_id);
    d->tick_id = gtk_widget_add_tick_callback(w, mac_popover_open_tick, d, NULL);
}

GtkWidget *gtk_popover_menu_new_from_model(GMenuModel *model) {
    static GtkWidget *(*orig_pnm)(GMenuModel *) = NULL;
    if (!orig_pnm) {
        orig_pnm = dlsym(RTLD_NEXT, "gtk_popover_menu_new_from_model");
    }
    GtkWidget *w = orig_pnm ? orig_pnm(model) : NULL;
    if (w && GTK_IS_POPOVER(w)) {
        gtk_popover_set_has_arrow(GTK_POPOVER(w), FALSE);
    }
    return w;
}

static void mac_popover_hide(GtkWidget *w) {
    MacPopoverAnimData *d = get_popover_anim_data(w);
    if (d->in_final_hide) {
        if (orig_popover_hide) orig_popover_hide(w);
        return;
    }

    if (!gtk_widget_get_mapped(w) || !gtk_widget_get_visible(w)) {
        if (orig_popover_hide) orig_popover_hide(w);
        return;
    }

    if (d->is_closing) return;

    if (d->tick_id && d->is_opening) {
        gtk_widget_remove_tick_callback(w, d->tick_id);
        d->tick_id = 0;
        d->is_opening = FALSE;
    }

    d->is_closing = TRUE;
    d->is_opening = FALSE;
    d->start_time = 0;
    d->tick_id = gtk_widget_add_tick_callback(w, mac_popover_close_tick, d, NULL);
}

static void install_mac_popover_hooks(void) {
    static gboolean installed = FALSE;
    if (installed) return;
    installed = TRUE;

    GtkWidgetClass *klass = GTK_WIDGET_CLASS(g_type_class_ref(GTK_TYPE_POPOVER));
    if (klass) {
        orig_popover_map = klass->map;
        klass->map = mac_popover_map;
        orig_popover_hide = klass->hide;
        klass->hide = mac_popover_hide;
        orig_popover_snapshot = klass->snapshot;
        klass->snapshot = mac_popover_snapshot;
    }
}





static void (*orig_gtk_label_snapshot)(GtkWidget *widget, GtkSnapshot *snapshot) = NULL;

static void get_system_accent_color(double *r, double *g, double *b) {
    *r = 0.98; *g = 0.43; *b = 0.04;
    AdwStyleManager *sm = adw_style_manager_get_default();
    if (sm) {
        GdkRGBA *rgba = adw_style_manager_get_accent_color_rgba(sm);
        if (rgba) {
            *r = (double)rgba->red;
            *g = (double)rgba->green;
            *b = (double)rgba->blue;
            gdk_rgba_free(rgba);
        }
    }
}

typedef enum {
    MAC_GRID_STATE_NONE = 0,
    MAC_GRID_STATE_SELECTED = 1,
    MAC_GRID_STATE_HOVER = 2
} MacGridState;

static GtkWidget *g_active_hover_item = NULL;

static void clear_grid_item_hover(GtkWidget *item) {
    if (!item || !GTK_IS_WIDGET(item)) return;
    g_object_set_data(G_OBJECT(item), "mac-hovered", GINT_TO_POINTER(0));
    GtkWidget *label = GTK_WIDGET(g_object_get_data(G_OBJECT(item), "mac-target-label"));
    if (label && GTK_IS_WIDGET(label)) {
        g_object_set_data(G_OBJECT(label), "mac-hovered", GINT_TO_POINTER(0));
        gtk_widget_queue_draw(label);
    }
    gtk_widget_queue_draw(item);
}

static void on_item_destroy(GtkWidget *widget, gpointer user_data) {
    if (g_active_hover_item == widget) {
        g_active_hover_item = NULL;
    }
}

static void on_grid_item_enter(GtkEventControllerMotion *controller, double x, double y, gpointer user_data) {
    GtkWidget *item = GTK_WIDGET(user_data);
    if (!GTK_IS_WIDGET(item)) return;

    if (g_active_hover_item && g_active_hover_item != item) {
        clear_grid_item_hover(g_active_hover_item);
    }
    g_active_hover_item = item;

    g_object_set_data(G_OBJECT(item), "mac-hovered", GINT_TO_POINTER(1));
    GtkWidget *label = GTK_WIDGET(g_object_get_data(G_OBJECT(item), "mac-target-label"));
    if (label && GTK_IS_WIDGET(label)) {
        g_object_set_data(G_OBJECT(label), "mac-hovered", GINT_TO_POINTER(1));
        gtk_widget_queue_draw(label);
    }
    gtk_widget_queue_draw(item);
}

static void on_grid_item_leave(GtkEventControllerMotion *controller, gpointer user_data) {
    GtkWidget *item = GTK_WIDGET(user_data);
    if (!GTK_IS_WIDGET(item)) return;

    clear_grid_item_hover(item);
    if (g_active_hover_item == item) {
        g_active_hover_item = NULL;
    }
}

static void on_grid_view_leave(GtkEventControllerMotion *controller, gpointer user_data) {
    if (g_active_hover_item) {
        clear_grid_item_hover(g_active_hover_item);
        g_active_hover_item = NULL;
    }
}

static MacGridState get_grid_label_state(GtkWidget *widget) {
    if (!widget || !GTK_IS_LABEL(widget)) return MAC_GRID_STATE_NONE;

    GtkWidget *labels_box = gtk_widget_get_parent(widget);
    if (!labels_box || !gtk_widget_has_css_class(labels_box, "icon-ui-labels-box")) return MAC_GRID_STATE_NONE;

    if (gtk_widget_has_css_class(widget, "caption") || gtk_widget_has_css_class(widget, "dim-label")) {
        return MAC_GRID_STATE_NONE;
    }

    gboolean selected = FALSE;
    gboolean hovered = FALSE;

    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(widget), "mac-hovered"))) {
        hovered = TRUE;
    }

    for (GtkWidget *p = widget; p != NULL; p = gtk_widget_get_parent(p)) {
        if (GTK_IS_GRID_VIEW(p)) break;

        GtkStateFlags flags = gtk_widget_get_state_flags(p);
        if ((flags & GTK_STATE_FLAG_SELECTED) || gtk_widget_has_css_class(p, "selected")) {
            selected = TRUE;
            break;
        }
        if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(p), "mac-hovered"))) {
            hovered = TRUE;
        }
    }

    if (selected) return MAC_GRID_STATE_SELECTED;
    if (hovered) return MAC_GRID_STATE_HOVER;
    return MAC_GRID_STATE_NONE;
}

typedef struct {
    double x, y, w, h;
} MacLineBox;

/** Snaps contiguous nearly-aligned line edges so <min_step diffs form flat vertical walls. */
static void mac_snap_edge_runs(double *vals, int n, gboolean take_min, double min_step) {
    int start = 0;
    while (start < n) {
        double run_min = vals[start];
        double run_max = vals[start];
        int end = start + 1;
        while (end < n) {
            double next_min = (vals[end] < run_min) ? vals[end] : run_min;
            double next_max = (vals[end] > run_max) ? vals[end] : run_max;
            if ((next_max - next_min) < min_step) {
                run_min = next_min;
                run_max = next_max;
                end++;
            } else {
                break;
            }
        }
        double snapped = take_min ? run_min : run_max;
        for (int k = start; k < end; k++)
            vals[k] = snapped;
        start = end;
    }
}

static double mac_clamp_fillet(double r_fillet, double abs_dx, double h_a, double h_b, double w_a, double w_b) {
    double r = r_fillet;
    double cands[5] = { abs_dx / 2.0, h_a / 2.0, h_b / 2.0, w_a / 2.0, w_b / 2.0 };
    for (int i = 0; i < 5; i++) {
        if (cands[i] < r) r = cands[i];
    }
    return (r < 0.5) ? 0.5 : r;
}

static double mac_clamp_corner(double r_corner, double w, double h) {
    double r = r_corner;
    if (r > w / 2.0) r = w / 2.0;
    if (r > h / 2.0) r = h / 2.0;
    return (r < 0.5) ? 0.5 : r;
}

/** Draws a single smooth unified pill/stepped-fillet contour across 1..N wrapped lines. */
static void mac_draw_smooth_multiline_pill(cairo_t *cr, const MacLineBox *raw_lines, int n_lines,
                                           double px, double py, double r_corner, double r_fillet, double min_step) {
    if (n_lines <= 0 || n_lines > 8) return;

    double y_seam[9];
    double xL[8], xR[8], row_h[8], row_w[8];

    y_seam[0] = raw_lines[0].y - py;
    for (int i = 1; i < n_lines; i++) {
        double min_y = y_seam[i - 1] + 2.0;
        y_seam[i] = (raw_lines[i].y > min_y) ? raw_lines[i].y : min_y;
    }
    double bot_y = raw_lines[n_lines - 1].y + raw_lines[n_lines - 1].h + py;
    double min_bot = y_seam[n_lines - 1] + 2.0;
    y_seam[n_lines] = (bot_y > min_bot) ? bot_y : min_bot;

    for (int i = 0; i < n_lines; i++) {
        xL[i] = raw_lines[i].x - px;
        xR[i] = raw_lines[i].x + raw_lines[i].w + px;
    }
    mac_snap_edge_runs(xL, n_lines, TRUE, min_step);
    mac_snap_edge_runs(xR, n_lines, FALSE, min_step);

    for (int i = 0; i < n_lines; i++) {
        row_h[i] = y_seam[i + 1] - y_seam[i];
        row_w[i] = xR[i] - xL[i];
    }

    double rtl = mac_clamp_corner(r_corner, row_w[0], row_h[0]);
    double rtr = mac_clamp_corner(r_corner, row_w[0], row_h[0]);
    double rbl = mac_clamp_corner(r_corner, row_w[n_lines - 1], row_h[n_lines - 1]);
    double rbr = mac_clamp_corner(r_corner, row_w[n_lines - 1], row_h[n_lines - 1]);

    cairo_new_path(cr);
    cairo_arc(cr, xR[0] - rtr, y_seam[0] + rtr, rtr, 1.5 * G_PI, 2.0 * G_PI);

    for (int i = 0; i < n_lines - 1; i++) {
        double sy = y_seam[i + 1];
        double dx = xR[i] - xR[i + 1];
        double abs_dx = fabs(dx);
        if (abs_dx < 2.0) continue;
        double rf = mac_clamp_fillet(r_fillet, abs_dx, row_h[i], row_h[i + 1], row_w[i], row_w[i + 1]);
        if (dx > 0) {
            cairo_arc(cr, xR[i] - rf, sy - rf, rf, 0, 0.5 * G_PI);
            cairo_arc_negative(cr, xR[i + 1] + rf, sy + rf, rf, 1.5 * G_PI, G_PI);
        } else {
            cairo_arc_negative(cr, xR[i] + rf, sy - rf, rf, G_PI, 0.5 * G_PI);
            cairo_arc(cr, xR[i + 1] - rf, sy + rf, rf, 1.5 * G_PI, 2.0 * G_PI);
        }
    }

    cairo_arc(cr, xR[n_lines - 1] - rbr, y_seam[n_lines] - rbr, rbr, 0, 0.5 * G_PI);
    cairo_arc(cr, xL[n_lines - 1] + rbl, y_seam[n_lines] - rbl, rbl, 0.5 * G_PI, G_PI);

    for (int i = n_lines - 2; i >= 0; i--) {
        double sy = y_seam[i + 1];
        double dwL = xL[i + 1] - xL[i];
        double abs_dwL = fabs(dwL);
        if (abs_dwL < 2.0) continue;
        double rf = mac_clamp_fillet(r_fillet, abs_dwL, row_h[i], row_h[i + 1], row_w[i], row_w[i + 1]);
        if (dwL > 0) {
            cairo_arc_negative(cr, xL[i + 1] - rf, sy + rf, rf, 0, 1.5 * G_PI);
            cairo_arc(cr, xL[i] + rf, sy - rf, rf, 0.5 * G_PI, G_PI);
        } else {
            cairo_arc(cr, xL[i + 1] + rf, sy + rf, rf, G_PI, 1.5 * G_PI);
            cairo_arc_negative(cr, xL[i] - rf, sy - rf, rf, 0.5 * G_PI, 0);
        }
    }

    cairo_arc(cr, xL[0] + rtl, y_seam[0] + rtl, rtl, G_PI, 1.5 * G_PI);
    cairo_close_path(cr);
    cairo_fill(cr);
}

static void mac_grid_label_snapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
    if (!orig_gtk_label_snapshot) return;


    for (GtkWidget *p = widget; p != NULL; p = gtk_widget_get_parent(p)) {
        if (gtk_widget_has_css_class(p, "sidebar-pane") ||
            gtk_widget_has_css_class(p, "navigation-sidebar") ||
            gtk_widget_has_css_class(p, "placessidebar") ||
            gtk_widget_has_css_class(p, "sidebar-revealer") ||
            g_strcmp0(G_OBJECT_TYPE_NAME(p), "NautilusSidebar") == 0 ||
            g_strcmp0(G_OBJECT_TYPE_NAME(p), "NautilusSidebarRow") == 0) {
            orig_gtk_label_snapshot(widget, snapshot);
            return;
        }
    }


    gtk_widget_set_overflow(widget, GTK_OVERFLOW_VISIBLE);
    GtkWidget *labels_box = gtk_widget_get_parent(widget);
    if (labels_box) {
        gtk_widget_set_overflow(labels_box, GTK_OVERFLOW_VISIBLE);
    }

    GtkWidget *item = NULL;
    GtkWidget *grid_view = NULL;
    for (GtkWidget *p = widget; p != NULL; p = gtk_widget_get_parent(p)) {
        GtkWidget *parent = gtk_widget_get_parent(p);
        if (parent && GTK_IS_GRID_VIEW(parent)) {
            item = p;
            grid_view = parent;
            break;
        }
    }
    if (item) {
        gtk_widget_set_overflow(item, GTK_OVERFLOW_VISIBLE);
        if (!gtk_widget_has_css_class(widget, "caption") && !gtk_widget_has_css_class(widget, "dim-label")) {
            g_object_set_data(G_OBJECT(item), "mac-target-label", widget);
        }
        if (!g_object_get_data(G_OBJECT(item), "mac-hover-controller-installed")) {
            g_object_set_data(G_OBJECT(item), "mac-hover-controller-installed", GINT_TO_POINTER(1));
            g_signal_connect(item, "destroy", G_CALLBACK(on_item_destroy), NULL);
            GtkEventController *motion = gtk_event_controller_motion_new();
            g_signal_connect(motion, "enter", G_CALLBACK(on_grid_item_enter), item);
            g_signal_connect(motion, "leave", G_CALLBACK(on_grid_item_leave), item);
            gtk_widget_add_controller(item, motion);
        }
    }
    if (grid_view && !g_object_get_data(G_OBJECT(grid_view), "mac-gridview-leave-installed")) {
        g_object_set_data(G_OBJECT(grid_view), "mac-gridview-leave-installed", GINT_TO_POINTER(1));
        GtkEventController *gv_motion = gtk_event_controller_motion_new();
        g_signal_connect(gv_motion, "leave", G_CALLBACK(on_grid_view_leave), grid_view);
        gtk_widget_add_controller(grid_view, gv_motion);
    }

    MacGridState state = get_grid_label_state(widget);
    if (state == MAC_GRID_STATE_NONE) {
        orig_gtk_label_snapshot(widget, snapshot);
        return;
    }

    PangoLayout *layout = gtk_label_get_layout(GTK_LABEL(widget));
    if (!layout) {
        orig_gtk_label_snapshot(widget, snapshot);
        return;
    }

    int ox = 0, oy = 0;
    gtk_label_get_layout_offsets(GTK_LABEL(widget), &ox, &oy);

    MacLineBox raw_lines[8];
    int n_lines = 0;
    PangoLayoutIter *iter = pango_layout_get_iter(layout);
    if (iter) {
        do {
            PangoRectangle logical;
            pango_layout_iter_get_line_extents(iter, NULL, &logical);
            if (n_lines < 8 && logical.width > 0) {
                raw_lines[n_lines].x = (double)logical.x / PANGO_SCALE + ox;
                raw_lines[n_lines].y = (double)logical.y / PANGO_SCALE + oy;
                raw_lines[n_lines].w = (double)logical.width / PANGO_SCALE;
                raw_lines[n_lines].h = (double)logical.height / PANGO_SCALE;
                n_lines++;
            }
        } while (pango_layout_iter_next_line(iter));
        pango_layout_iter_free(iter);
    }

    if (n_lines <= 0) {
        orig_gtk_label_snapshot(widget, snapshot);
        return;
    }

    int widget_w = gtk_widget_get_width(widget);
    int widget_h = gtk_widget_get_height(widget);
    if (widget_w <= 0 || widget_h <= 0) {
        orig_gtk_label_snapshot(widget, snapshot);
        return;
    }

    graphene_rect_t bounds;
    graphene_rect_init(&bounds, -30.0f, -30.0f, (float)widget_w + 60.0f, (float)widget_h + 60.0f);
    cairo_t *cr = gtk_snapshot_append_cairo(snapshot, &bounds);
    if (cr) {
        if (state == MAC_GRID_STATE_SELECTED) {
            double ar, ag, ab;
            get_system_accent_color(&ar, &ag, &ab);
            if (gtk_widget_get_state_flags(widget) & GTK_STATE_FLAG_BACKDROP) {
                cairo_set_source_rgba(cr, 0.45, 0.45, 0.47, 0.90);
            } else {
                cairo_set_source_rgb(cr, ar, ag, ab);
            }
        } else {

            gboolean dark = TRUE;
            AdwStyleManager *sm = adw_style_manager_get_default();
            if (sm) dark = adw_style_manager_get_dark(sm);
            if (dark) {
                cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 0.12);
            } else {
                cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, 0.08);
            }
        }

        mac_draw_smooth_multiline_pill(cr, raw_lines, n_lines, 6.0, 2.5, 7.5, 6.0, 8.5);
        cairo_destroy(cr);
    }

    orig_gtk_label_snapshot(widget, snapshot);
}

static void install_mac_grid_label_hooks(void) {
    static gboolean installed = FALSE;
    if (installed) return;
    installed = TRUE;

    g_type_ensure(GTK_TYPE_LABEL);
    GtkWidgetClass *klass = GTK_WIDGET_CLASS(g_type_class_ref(GTK_TYPE_LABEL));
    if (klass) {
        orig_gtk_label_snapshot = klass->snapshot;
        klass->snapshot = mac_grid_label_snapshot;
    }
}

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
        g_type_ensure(GTK_TYPE_POPOVER);
        install_mac_popover_hooks();
        g_type_ensure(GTK_TYPE_LABEL);
        install_mac_grid_label_hooks();
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


    if (strncmp(dest_path, apps_dir, apps_len) == 0 &&
        (dest_path[apps_len] == '/' || dest_path[apps_len] == '\0') &&
        !(strncmp(src_path, apps_dir, apps_len) == 0 && (src_path[apps_len] == '/' || src_path[apps_len] == '\0'))) {

        char *src_dir = g_path_get_dirname(src_path);
        char *base_name = g_path_get_basename(dest_path);


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
            rank = 950;
        } else if (g_str_has_prefix(uri, "x-network-view:///") || g_str_has_prefix(uri, "network:///")) {
            rank = 960;
        } else if (g_str_has_prefix(uri, "trash:///")) {
            rank = 800;
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
        } else if (section_type == 2) {
            rank = 160;
        } else if (section_type == 4) {
            rank = 300;
        }
    } else {
        if (label && (g_str_equal(label, "Створити закладку") || g_str_equal(label, "New bookmark"))) {
            rank = 999;
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

static gboolean is_inside_button(GtkWidget *widget)
{
    for (GtkWidget *p = widget; p != NULL; p = gtk_widget_get_parent(p)) {
        if (GTK_IS_BUTTON(p)) return TRUE;
    }
    return FALSE;
}

static void find_and_style_images(GtkWidget *widget, gboolean orange)
{
    if (!widget) return;
    if (GTK_IS_IMAGE(widget)) {
        if (is_inside_button(widget)) {
            gtk_widget_remove_css_class(widget, "sidebar-orange-icon");
            gtk_widget_remove_css_class(widget, "sidebar-neutral-icon");
            gtk_widget_add_css_class(widget, "mac-eject-icon");
            return;
        }
        if (orange) {
            gtk_widget_remove_css_class(widget, "sidebar-neutral-icon");
            gtk_widget_add_css_class(widget, "sidebar-orange-icon");
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


    gchar *uri = NULL;
    gchar *cur_label = NULL;
    GObjectClass *oc = G_OBJECT_GET_CLASS(row);
    if (g_object_class_find_property(oc, "uri"))
        g_object_get(row, "uri", &uri, NULL);
    if (g_object_class_find_property(oc, "label"))
        g_object_get(row, "label", &cur_label, NULL);

    gboolean has_start_icon = g_object_class_find_property(oc, "start-icon") != NULL;
    gboolean has_label = g_object_class_find_property(oc, "label") != NULL;

    (void)is_ukrainian_locale;

    if (uri) {
        if (p == 10) {
            const char *target = mac_tr("bookmark_recent", "Recent");
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
            const char *target = mac_tr("bookmark_home", "Home");
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 100) {
            const char *target = mac_tr("bookmark_applications", "Applications");
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
            const char *target = mac_tr("bookmark_desktop", "Desktop");
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
            const char *target = mac_tr("bookmark_documents", "Documents");
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
            const char *target = mac_tr("bookmark_downloads", "Downloads");
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
            const char *target = mac_tr("bookmark_pictures", "Pictures");
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
            const char *target = mac_tr("bookmark_movies", "Movies");
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            if (has_start_icon) {
                GIcon *vid_icon = g_themed_icon_new("folder-videos-symbolic");
                g_object_set(row, "start-icon", vid_icon, NULL);
                g_object_unref(vid_icon);
            }
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p >= 100 && p < 300) {
            find_and_style_images(GTK_WIDGET(row), TRUE);
        } else if (p == 800) {
            const char *target = mac_tr("bookmark_trash", "Trash");
            if (has_label && (!cur_label || !g_str_equal(cur_label, target))) {
                g_object_set(row, "label", target, NULL);
            }
            find_and_style_images(GTK_WIDGET(row), FALSE);
        } else if (p == 300) {
            find_and_style_images(GTK_WIDGET(row), FALSE);
        }
    }


    int before_p = before ? get_row_priority(before) : 0;


    if (p >= 100 && p < 300 && before_p < 100) {
        GtkWidget *header = gtk_list_box_row_get_header(row);
        if (!header || !g_object_get_data(G_OBJECT(header), "mac-favorites-header")) {
            GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
            GtkWidget *lbl = gtk_label_new(mac_tr("bookmarks_favorites", "Favorites"));
            gtk_widget_add_css_class(lbl, "mac-sidebar-header");
            gtk_widget_set_halign(lbl, GTK_ALIGN_START);
            gtk_box_append(GTK_BOX(box), lbl);
            g_object_set_data(G_OBJECT(box), "mac-favorites-header", GINT_TO_POINTER(1));
            gtk_list_box_row_set_header(row, box);
        }
    }

    else if (p >= 300 && p < 800 && before_p < 300) {
        GtkWidget *header = gtk_list_box_row_get_header(row);
        if (!header || !g_object_get_data(G_OBJECT(header), "mac-mounts-header")) {
            GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
            GtkWidget *lbl = gtk_label_new(mac_tr("bookmarks_locations", "Locations"));
            gtk_widget_add_css_class(lbl, "mac-sidebar-header");
            gtk_widget_set_halign(lbl, GTK_ALIGN_START);
            gtk_box_append(GTK_BOX(box), lbl);
            g_object_set_data(G_OBJECT(box), "mac-mounts-header", GINT_TO_POINTER(1));
            gtk_list_box_row_set_header(row, box);
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

typedef struct {
    GtkWidget *window;
    AdwOverlaySplitView *split_view;
    AdwHeaderBar *sidebar_hb;
    AdwHeaderBar *content_hb;
    GtkWidget *content_tv;
    GtkWidget *tab_view;
    GtkWidget *bottom_bar;
    GtkWidget *bottom_path_stack;
    GtkWidget *bottom_path_box;
    GtkWidget *bottom_path_scroll;
    GtkWidget *bottom_path_entry;
    GtkWidget *bottom_info_name_lbl;
    GtkWidget *bottom_info_meta_lbl;
    GtkWidget *toolbar_switcher;
    GtkWidget *title_label;
    GtkWidget *sort_btn;
    GtkWidget *info_btn;
    GtkWidget *act_pill;
    GtkWidget *trash_btn;
    GtkWidget *eject_btn;
    GtkWidget *view_controls;
    GtkWidget *more_btn;
    GtkWidget *search_btn;
    GObject *bound_slot;
    GtkSelectionModel *bound_model;
    GCancellable *info_cancellable;
    gulong slot_loc_sig;
    gulong sel_changed_sig;
    guint rebind_idle_id;
    guint path_scroll_idle_id;
    guint path_focus_idle_id;
    gboolean path_entry_closing;
} MacNautilusCtx;

static void mac_free_closure(gpointer data, GClosure *closure G_GNUC_UNUSED)
{
    g_free(data);
}

static void mac_ctx_clear_slot(MacNautilusCtx *ctx);
static void mac_ctx_schedule_rebind(MacNautilusCtx *ctx);
static void mac_update_bottom_bars(MacNautilusCtx *ctx);
static void mac_open_bottom_path_entry(MacNautilusCtx *ctx);
static void mac_close_bottom_path_entry(MacNautilusCtx *ctx);
static void mac_on_bottom_edit_clicked(GtkButton *btn, gpointer user_data);

static void mac_free_ctx(gpointer data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)data;
    if (!ctx) return;
    if (ctx->rebind_idle_id) {
        g_source_remove(ctx->rebind_idle_id);
        ctx->rebind_idle_id = 0;
    }
    if (ctx->path_scroll_idle_id) {
        g_source_remove(ctx->path_scroll_idle_id);
        ctx->path_scroll_idle_id = 0;
    }
    if (ctx->path_focus_idle_id) {
        g_source_remove(ctx->path_focus_idle_id);
        ctx->path_focus_idle_id = 0;
    }
    if (ctx->info_cancellable) {
        g_cancellable_cancel(ctx->info_cancellable);
        g_clear_object(&ctx->info_cancellable);
    }
    mac_ctx_clear_slot(ctx);
    g_free(ctx);
}

/* === Live Blurred Bottom Path Bar + Status/File-Info Bar Widget === */
typedef struct _MacBottomBlurBar {
    GtkBox parent_instance;
    GtkWidget *target_content;
    GdkPaintable *bg_paintable;
    gulong inv_sig;
    gboolean in_snapshot;
    gboolean is_dark;
} MacBottomBlurBar;

typedef struct _MacBottomBlurBarClass {
    GtkBoxClass parent_class;
} MacBottomBlurBarClass;

static GType mac_bottom_blur_bar_get_type(void);
G_DEFINE_TYPE(MacBottomBlurBar, mac_bottom_blur_bar, GTK_TYPE_BOX)

static void mac_bottom_blur_bar_invalidate_cb(GdkPaintable *paintable G_GNUC_UNUSED, gpointer user_data)
{
    MacBottomBlurBar *self = (MacBottomBlurBar *)user_data;
    if (!self || self->in_snapshot) return;
    if (gtk_widget_get_mapped(GTK_WIDGET(self))) {
        gtk_widget_queue_draw(GTK_WIDGET(self));
    }
}

static void mac_bottom_blur_bar_snapshot(GtkWidget *widget, GtkSnapshot *snapshot)
{
    MacBottomBlurBar *self = (MacBottomBlurBar *)widget;
    int w = gtk_widget_get_width(widget);
    int h = gtk_widget_get_height(widget);

    if (w > 0 && h > 0) {
        graphene_rect_t bounds = GRAPHENE_RECT_INIT(0.0f, 0.0f, (float)w, (float)h);
        gtk_snapshot_push_clip(snapshot, &bounds);

        /* Pre-fill opaque content backdrop so blur edges never sample dark transparent borders */
        GdkRGBA base = self->is_dark
            ? (GdkRGBA){ 0.125f, 0.125f, 0.125f, 1.0f }
            : (GdkRGBA){ 1.0f, 1.0f, 1.0f, 1.0f };
        gtk_snapshot_append_color(snapshot, &base, &bounds);

        if (self->bg_paintable && self->target_content &&
            gtk_widget_get_mapped(self->target_content) && !self->in_snapshot) {
            int tw = gtk_widget_get_width(self->target_content);
            int th = gtk_widget_get_height(self->target_content);
            graphene_point_t zero = GRAPHENE_POINT_INIT(0.0f, 0.0f);
            graphene_point_t pt = GRAPHENE_POINT_INIT(0.0f, 0.0f);
            if (tw > 0 && th > 0 &&
                gtk_widget_compute_point(widget, self->target_content, &zero, &pt)) {
                self->in_snapshot = TRUE;
                gtk_snapshot_push_blur(snapshot, 24.0f);
                gtk_snapshot_save(snapshot);
                graphene_point_t shift = GRAPHENE_POINT_INIT(-pt.x, -pt.y);
                gtk_snapshot_translate(snapshot, &shift);
                gdk_paintable_snapshot(self->bg_paintable, snapshot, (double)tw, (double)th);
                gtk_snapshot_restore(snapshot);
                gtk_snapshot_pop(snapshot);
                self->in_snapshot = FALSE;
            }
        }

        GdkRGBA tint = self->is_dark
            ? (GdkRGBA){ 0.125f, 0.125f, 0.133f, 0.62f }
            : (GdkRGBA){ 0.965f, 0.965f, 0.975f, 0.76f };
        gtk_snapshot_append_color(snapshot, &tint, &bounds);
        gtk_snapshot_pop(snapshot);
    }

    GTK_WIDGET_CLASS(mac_bottom_blur_bar_parent_class)->snapshot(widget, snapshot);
}

static void mac_bottom_blur_bar_dispose(GObject *obj)
{
    MacBottomBlurBar *self = (MacBottomBlurBar *)obj;
    if (self->bg_paintable) {
        if (self->inv_sig) {
            g_signal_handler_disconnect(self->bg_paintable, self->inv_sig);
            self->inv_sig = 0;
        }
        g_clear_object(&self->bg_paintable);
    }
    if (self->target_content) {
        g_object_remove_weak_pointer(G_OBJECT(self->target_content), (gpointer *)&self->target_content);
        self->target_content = NULL;
    }
    G_OBJECT_CLASS(mac_bottom_blur_bar_parent_class)->dispose(obj);
}

static void mac_bottom_blur_bar_init(MacBottomBlurBar *self G_GNUC_UNUSED)
{
}

static void mac_bottom_blur_bar_class_init(MacBottomBlurBarClass *klass)
{
    GObjectClass *obj_class = G_OBJECT_CLASS(klass);
    GtkWidgetClass *widget_class = GTK_WIDGET_CLASS(klass);
    obj_class->dispose = mac_bottom_blur_bar_dispose;
    widget_class->snapshot = mac_bottom_blur_bar_snapshot;
}

static GtkWidget *mac_bottom_blur_bar_new(GtkWidget *target_content, gboolean is_dark)
{
    MacBottomBlurBar *self = g_object_new(mac_bottom_blur_bar_get_type(),
                                          "orientation", GTK_ORIENTATION_VERTICAL,
                                          "spacing", 0,
                                          NULL);
    self->is_dark = is_dark;
    gtk_widget_set_hexpand(GTK_WIDGET(self), TRUE);
    gtk_widget_set_vexpand(GTK_WIDGET(self), FALSE);
    gtk_widget_set_overflow(GTK_WIDGET(self), GTK_OVERFLOW_HIDDEN);
    gtk_widget_add_css_class(GTK_WIDGET(self), "mac-bottom-blur-bar");

    if (target_content && GTK_IS_WIDGET(target_content)) {
        self->target_content = target_content;
        g_object_add_weak_pointer(G_OBJECT(target_content), (gpointer *)&self->target_content);
        self->bg_paintable = gtk_widget_paintable_new(target_content);
        if (self->bg_paintable) {
            self->inv_sig = g_signal_connect(self->bg_paintable, "invalidate-contents",
                                             G_CALLBACK(mac_bottom_blur_bar_invalidate_cb), self);
        }
    }
    return GTK_WIDGET(self);
}

static void mac_ensure_finder_icons(void)
{
    static gboolean registered = FALSE;
    if (registered) return;
    registered = TRUE;

    static const struct {
        const char *name;
        const char *svg;
    } icons[] = {
        {
            "mac-finder-back-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path d=\"M 9.85 2.75 C 10.18 2.42 10.72 2.42 11.05 2.75 C 11.38 3.08 11.38 3.62 11.05 3.95 L 7.00 8.00 L 11.05 12.05 C 11.38 12.38 11.38 12.92 11.05 13.25 C 10.72 13.58 10.18 13.58 9.85 13.25 L 5.20 8.60 C 4.87 8.27 4.87 7.73 5.20 7.40 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-forward-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path d=\"M 6.15 2.75 C 5.82 2.42 5.28 2.42 4.95 2.75 C 4.62 3.08 4.62 3.62 4.95 3.95 L 9.00 8.00 L 4.95 12.05 C 4.62 12.38 4.62 12.92 4.95 13.25 C 5.28 13.58 5.82 13.58 6.15 13.25 L 10.80 8.60 C 11.13 8.27 11.13 7.73 10.80 7.40 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-sort-list-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<circle cx=\"2.5\" cy=\"4.2\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"4.8\" y=\"3.45\" width=\"8.0\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "<circle cx=\"2.5\" cy=\"8.0\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"4.8\" y=\"7.25\" width=\"9.2\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "<circle cx=\"2.5\" cy=\"11.8\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"4.8\" y=\"11.05\" width=\"6.2\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-chevron-down-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 16\">"
            "<path d=\"M 2.35 6.05 C 2.65 5.75 3.12 5.75 3.42 6.05 L 6.00 8.65 L 8.58 6.05 C 8.88 5.75 9.35 5.75 9.65 6.05 C 9.95 6.35 9.95 6.82 9.65 7.12 L 6.53 10.25 C 6.24 10.55 5.76 10.55 5.47 10.25 L 2.35 7.12 C 2.05 6.82 2.05 6.35 2.35 6.05 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-info-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<circle cx=\"8.0\" cy=\"3.4\" r=\"1.05\" fill=\"currentColor\"/>"
            "<path d=\"M 6.2 6.0 H 8.65 V 12.2 H 10.25 C 10.6 12.2 10.85 12.45 10.85 12.75 C 10.85 13.05 10.6 13.3 10.25 13.3 H 5.75 C 5.4 13.3 5.15 13.05 5.15 12.75 C 5.15 12.45 5.4 12.2 5.75 12.2 H 7.35 V 7.1 H 6.2 C 5.85 7.1 5.6 6.85 5.6 6.55 C 5.6 6.25 5.85 6.0 6.2 6.0 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-trash-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path d=\"M 2.8 4.0 H 13.2 C 13.55 4.0 13.8 4.25 13.8 4.6 C 13.8 4.95 13.55 5.2 13.2 5.2 H 2.8 C 2.45 5.2 2.2 4.95 2.2 4.6 C 2.2 4.25 2.45 4.0 2.8 4.0 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 5.4 2.1 H 10.6 V 4.3 H 5.4 Z M 6.6 3.2 V 3.4 H 9.4 V 3.2 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 3.6 4.8 H 12.4 L 11.6 12.9 C 11.53 13.55 11.0 14.0 10.35 14.0 H 5.65 C 5.0 14.0 4.47 13.55 4.4 12.9 Z M 4.9 5.9 L 5.55 12.5 C 5.58 12.72 5.75 12.85 5.95 12.85 H 10.05 C 10.25 12.85 10.42 12.72 10.45 12.5 L 11.1 5.9 Z\" fill=\"currentColor\"/>"
            "<rect x=\"6.45\" y=\"6.8\" width=\"1.15\" height=\"4.8\" rx=\"0.55\" fill=\"currentColor\"/>"
            "<rect x=\"8.40\" y=\"6.8\" width=\"1.15\" height=\"4.8\" rx=\"0.55\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-eject-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path fill-rule=\"evenodd\" d=\"M 8.0 2.8 L 13.1 8.9 C 13.4 9.25 13.15 9.8 12.68 9.8 H 3.32 C 2.85 9.8 2.6 9.25 2.9 8.9 Z M 8.0 4.65 L 4.75 8.55 H 11.25 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 3.0 11.1 H 13.0 C 13.35 11.1 13.6 11.35 13.6 11.7 V 13.1 C 13.6 13.45 13.35 13.7 13.0 13.7 H 3.0 C 2.65 13.7 2.4 13.45 2.4 13.1 V 11.7 C 2.4 11.35 2.65 11.1 3.0 11.1 Z M 3.6 12.25 V 12.55 H 12.4 V 12.25 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-grid-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path fill-rule=\"evenodd\" d=\"M 3.3 1.9 H 6.1 C 6.87 1.9 7.5 2.53 7.5 3.3 V 6.1 C 7.5 6.87 6.87 7.5 6.1 7.5 H 3.3 C 2.53 7.5 1.9 6.87 1.9 6.1 V 3.3 C 1.9 2.53 2.53 1.9 3.3 1.9 Z M 3.55 3.2 C 3.35 3.2 3.2 3.35 3.2 3.55 V 5.85 C 3.2 6.05 3.35 6.2 3.55 6.2 H 5.85 C 6.05 6.2 6.2 6.05 6.2 5.85 V 3.55 C 6.2 3.35 6.05 3.2 5.85 3.2 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 9.9 1.9 H 12.7 C 13.47 1.9 14.1 2.53 14.1 3.3 V 6.1 C 14.1 6.87 13.47 7.5 12.7 7.5 H 9.9 C 9.13 7.5 8.5 6.87 8.5 6.1 V 3.3 C 8.5 2.53 9.13 1.9 9.9 1.9 Z M 10.15 3.2 C 9.95 3.2 9.8 3.35 9.8 3.55 V 5.85 C 9.8 6.05 9.95 6.2 10.15 6.2 H 12.45 C 12.65 6.2 12.8 6.05 12.8 5.85 V 3.55 C 12.8 3.35 12.65 3.2 12.45 3.2 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 3.3 8.5 H 6.1 C 6.87 8.5 7.5 9.13 7.5 9.9 V 12.7 C 7.5 13.47 6.87 14.1 6.1 14.1 H 3.3 C 2.53 14.1 1.9 13.47 1.9 12.7 V 9.9 C 1.9 9.13 2.53 8.5 3.3 8.5 Z M 3.55 9.8 C 3.35 9.8 3.2 9.95 3.2 10.15 V 12.45 C 3.2 12.65 3.35 12.8 3.55 12.8 H 5.85 C 6.05 12.8 6.2 12.65 6.2 12.45 V 10.15 C 6.2 9.95 6.05 9.8 5.85 9.8 Z\" fill=\"currentColor\"/>"
            "<path fill-rule=\"evenodd\" d=\"M 9.9 8.5 H 12.7 C 13.47 8.5 14.1 9.13 14.1 9.9 V 12.7 C 14.1 13.47 13.47 14.1 12.7 14.1 H 9.9 C 9.13 14.1 8.5 13.47 8.5 12.7 V 9.9 C 8.5 9.13 9.13 8.5 9.9 8.5 Z M 10.15 9.8 C 9.95 9.8 9.8 9.95 9.8 10.15 V 12.45 C 9.8 12.65 9.95 12.8 10.15 12.8 H 12.45 C 12.65 12.8 12.8 12.65 12.8 12.45 V 10.15 C 12.8 9.95 12.65 9.8 12.45 9.8 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-list-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<circle cx=\"2.7\" cy=\"4.2\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"5.2\" y=\"3.45\" width=\"8.5\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "<circle cx=\"2.7\" cy=\"8.0\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"5.2\" y=\"7.25\" width=\"8.5\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "<circle cx=\"2.7\" cy=\"11.8\" r=\"1.0\" fill=\"currentColor\"/>"
            "<rect x=\"5.2\" y=\"11.05\" width=\"8.5\" height=\"1.5\" rx=\"0.75\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-chevron-updown-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 16\">"
            "<path d=\"M 2.55 6.35 C 2.25 6.65 2.25 7.10 2.55 7.40 C 2.85 7.70 3.30 7.70 3.60 7.40 L 6.00 4.95 L 8.40 7.40 C 8.70 7.70 9.15 7.70 9.45 7.40 C 9.75 7.10 9.75 6.65 9.45 6.35 L 6.52 3.35 C 6.23 3.05 5.77 3.05 5.48 3.35 Z\" fill=\"currentColor\"/>"
            "<path d=\"M 2.55 9.65 C 2.25 9.35 2.25 8.90 2.55 8.60 C 2.85 8.30 3.30 8.30 3.60 8.60 L 6.00 11.05 L 8.40 8.60 C 8.70 8.30 9.15 8.30 9.45 8.60 C 9.75 8.90 9.75 9.35 9.45 9.65 L 6.52 12.65 C 6.23 12.95 5.77 12.95 5.48 12.65 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-more-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path d=\"M 3.05 3.15 C 2.75 3.45 2.75 3.95 3.05 4.25 L 6.75 8.00 L 3.05 11.75 C 2.75 12.05 2.75 12.55 3.05 12.85 C 3.35 13.15 3.85 13.15 4.15 12.85 L 8.45 8.55 C 8.75 8.25 8.75 7.75 8.45 7.45 L 4.15 3.15 C 3.85 2.85 3.35 2.85 3.05 3.15 Z M 7.75 3.15 C 7.45 3.45 7.45 3.95 7.75 4.25 L 11.45 8.00 L 7.75 11.75 C 7.45 12.05 7.45 12.55 7.75 12.85 C 8.05 13.15 8.55 13.15 8.85 12.85 L 13.15 8.55 C 13.45 8.25 13.45 7.75 13.15 7.45 L 8.85 3.15 C 8.55 2.85 8.05 2.85 7.75 3.15 Z\" fill=\"currentColor\"/>"
            "</svg>"
        },
        {
            "mac-finder-search-symbolic",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">"
            "<path fill-rule=\"evenodd\" d=\"M 6.75 1.5 A 5.25 5.25 0 1 1 6.74 12.0 A 5.25 5.25 0 1 1 6.75 1.5 Z M 6.75 3.1 A 3.65 3.65 0 1 0 6.76 10.4 A 3.65 3.65 0 1 0 6.75 3.1 Z\" fill=\"currentColor\"/>"
            "<path d=\"M 10.05 10.05 C 10.40 9.70 10.96 9.70 11.31 10.05 L 14.40 13.14 C 14.75 13.49 14.75 14.05 14.40 14.40 C 14.05 14.75 13.49 14.75 13.14 14.40 L 10.05 11.31 C 9.70 10.96 9.70 10.40 10.05 10.05 Z\" fill=\"currentColor\"/>"
            "</svg>"
        }
    };

    const char *cache_dir = g_get_user_cache_dir();
    if (!cache_dir) return;

    char *base_dir = g_build_filename(cache_dir, "macw1y-nautilus-icons", NULL);
    char *actions_dir = g_build_filename(base_dir, "hicolor", "scalable", "actions", NULL);
    char *hicolor_dir = g_build_filename(base_dir, "hicolor", NULL);
    char *ver_file = g_build_filename(base_dir, ".version", NULL);

    const char *stamp = "macw1y-finder-v4\n";
    gboolean up_to_date = FALSE;
    gchar *existing_stamp = NULL;
    if (g_file_get_contents(ver_file, &existing_stamp, NULL, NULL)) {
        up_to_date = (g_strcmp0(existing_stamp, stamp) == 0);
        g_free(existing_stamp);
    }

    if (!up_to_date) {
        g_mkdir_with_parents(actions_dir, 0755);
        char *idx_path = g_build_filename(hicolor_dir, "index.theme", NULL);
        const char *idx_content =
            "[Icon Theme]\n"
            "Name=Hicolor\n"
            "Directories=scalable/actions\n\n"
            "[scalable/actions]\n"
            "Size=16\n"
            "MinSize=1\n"
            "MaxSize=512\n"
            "Type=Scalable\n";
        g_file_set_contents(idx_path, idx_content, -1, NULL);
        g_free(idx_path);

        for (size_t i = 0; i < G_N_ELEMENTS(icons); i++) {
            char *fname = g_strdup_printf("%s.svg", icons[i].name);
            char *fpath = g_build_filename(actions_dir, fname, NULL);
            g_file_set_contents(fpath, icons[i].svg, -1, NULL);
            g_free(fpath);
            g_free(fname);
        }
        g_file_set_contents(ver_file, stamp, -1, NULL);
    }

    GdkDisplay *display = gdk_display_get_default();
    if (display) {
        GtkIconTheme *theme = gtk_icon_theme_get_for_display(display);
        if (theme) {
            gtk_icon_theme_add_search_path(theme, base_dir);
            gtk_icon_theme_add_search_path(theme, actions_dir);
        }
    }

    g_free(ver_file);
    g_free(hicolor_dir);
    g_free(actions_dir);
    g_free(base_dir);
}

static GtkWidget *find_descendant_by_type_name(GtkWidget *root, const char *type_name)
{
    if (!root) return NULL;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(root), type_name) == 0) {
        return root;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        GtkWidget *found = find_descendant_by_type_name(c, type_name);
        if (found) return found;
    }
    return NULL;
}

static GtkWidget *find_descendant_actionable(GtkWidget *root, const char *action_name)
{
    if (!root) return NULL;
    if (GTK_IS_ACTIONABLE(root)) {
        const char *act = gtk_actionable_get_action_name(GTK_ACTIONABLE(root));
        if (g_strcmp0(act, action_name) == 0) return root;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        GtkWidget *found = find_descendant_actionable(c, action_name);
        if (found) return found;
    }
    return NULL;
}

static GtkWidget *find_descendant_stack_with_child(GtkWidget *root, const char *child_name)
{
    if (!root) return NULL;
    if (GTK_IS_STACK(root) && gtk_stack_get_child_by_name(GTK_STACK(root), child_name) != NULL) {
        return root;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        GtkWidget *found = find_descendant_stack_with_child(c, child_name);
        if (found) return found;
    }
    return NULL;
}

static GtkWidget *find_descendant_selection_view(GtkWidget *root, GtkSelectionModel **out_model)
{
    if (!root) return NULL;
    if (GTK_IS_GRID_VIEW(root) && gtk_widget_get_mapped(root)) {
        *out_model = gtk_grid_view_get_model(GTK_GRID_VIEW(root));
        return root;
    }
    if (GTK_IS_COLUMN_VIEW(root) && gtk_widget_get_mapped(root)) {
        *out_model = gtk_column_view_get_model(GTK_COLUMN_VIEW(root));
        return root;
    }
    for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        GtkWidget *found = find_descendant_selection_view(c, out_model);
        if (found) return found;
    }
    return NULL;
}

static GtkWidget *mac_get_active_view_widget(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->window || !GTK_IS_WIDGET(ctx->window)) return NULL;
    GObject *slot = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(ctx->window), "active-slot")) {
        g_object_get(ctx->window, "active-slot", &slot, NULL);
    }
    if (!slot) return NULL;
    GtkWidget *view = GTK_IS_WIDGET(slot) ? find_descendant_by_type_name(GTK_WIDGET(slot), "NautilusFilesView") : NULL;
    if (!view && GTK_IS_WIDGET(slot)) view = GTK_WIDGET(slot);
    g_object_unref(slot);
    return view;
}

static GFile *mac_get_active_slot_location(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->window) return NULL;
    GObject *slot = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(ctx->window), "active-slot")) {
        g_object_get(ctx->window, "active-slot", &slot, NULL);
    }
    if (!slot) return NULL;
    GFile *loc = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(slot), "location")) {
        g_object_get(slot, "location", &loc, NULL);
    }
    g_object_unref(slot);
    return loc;
}

static GFile *mac_get_first_selected_location(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->bound_model || !GTK_IS_SELECTION_MODEL(ctx->bound_model)) return NULL;
    GtkBitset *bs = gtk_selection_model_get_selection(ctx->bound_model);
    if (!bs) return NULL;
    if (gtk_bitset_is_empty(bs)) {
        gtk_bitset_unref(bs);
        return NULL;
    }
    guint idx = gtk_bitset_get_minimum(bs);
    gtk_bitset_unref(bs);

    GObject *item = g_list_model_get_item(G_LIST_MODEL(ctx->bound_model), idx);
    if (!item) return NULL;

    if (g_object_class_find_property(G_OBJECT_GET_CLASS(item), "item")) {
        GObject *inner = NULL;
        g_object_get(item, "item", &inner, NULL);
        g_object_unref(item);
        item = inner;
        if (!item) return NULL;
    }

    GObject *nfile = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(item), "file")) {
        g_object_get(item, "file", &nfile, NULL);
    }
    g_object_unref(item);
    if (!nfile) return NULL;

    static GFile *(*fn_get_location)(gpointer) = NULL;
    static gboolean resolved = FALSE;
    if (!resolved) {
        resolved = TRUE;
        fn_get_location = dlsym(RTLD_DEFAULT, "nautilus_file_info_get_location");
    }

    GFile *res = NULL;
    if (fn_get_location) {
        res = fn_get_location(nfile);
    }
    g_object_unref(nfile);
    return res;
}

typedef struct {
    MacNautilusCtx *ctx;
    GtkWidget *win_ref;
    GtkWidget *leaf_img;
    GFile *loc;
    guint sel_count;
    guint total_count;
} MacBottomQueryData;

static void mac_bottom_query_data_free(MacBottomQueryData *qd)
{
    if (!qd) return;
    if (qd->win_ref) g_object_remove_weak_pointer(G_OBJECT(qd->win_ref), (gpointer *)&qd->win_ref);
    if (qd->leaf_img) g_object_remove_weak_pointer(G_OBJECT(qd->leaf_img), (gpointer *)&qd->leaf_img);
    if (qd->loc) g_object_unref(qd->loc);
    g_free(qd);
}

static void mac_gstring_replace_all(GString *gs, const char *needle, const char *repl)
{
    if (!gs || !needle || !*needle || !repl) return;
    gsize nlen = strlen(needle);
    gsize rlen = strlen(repl);
    gsize pos = 0;
    while (pos <= gs->len) {
        char *found = strstr(gs->str + pos, needle);
        if (!found) break;
        gsize idx = (gsize)(found - gs->str);
        g_string_erase(gs, (gssize)idx, (gssize)nlen);
        g_string_insert_len(gs, (gssize)idx, repl, (gssize)rlen);
        pos = idx + rlen;
    }
}

static const char *mac_items_word(guint n)
{
    const char *loc = mac_get_locale();
    gboolean is_slavic = (loc && (
        g_str_has_prefix(loc, "uk") || g_str_has_prefix(loc, "ru") ||
        g_str_has_prefix(loc, "be") || g_str_has_prefix(loc, "pl") ||
        g_str_has_prefix(loc, "cs") || g_str_has_prefix(loc, "sk") ||
        g_str_has_prefix(loc, "sr") || g_str_has_prefix(loc, "hr") ||
        g_str_has_prefix(loc, "sl") || g_str_has_prefix(loc, "bg")));
    if (is_slavic) {
        guint m10 = n % 10;
        guint m100 = n % 100;
        if (m10 == 1 && m100 != 11) return mac_tr("item_singular", "item");
        if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return mac_tr("item_few", "items");
        return mac_tr("item_many", "items");
    }
    return n == 1 ? mac_tr("item_singular", "item") : mac_tr("item_many", "items");
}

static char *mac_format_selected_text(guint sel, guint total)
{
    char sel_buf[32], tot_buf[32];
    g_snprintf(sel_buf, sizeof(sel_buf), "%u", sel);
    g_snprintf(tot_buf, sizeof(tot_buf), "%u", total);
    GString *gs = g_string_new(mac_tr("selected_of_total", "{sel} of {total} {items} selected"));
    mac_gstring_replace_all(gs, "{sel}", sel_buf);
    mac_gstring_replace_all(gs, "{total}", tot_buf);
    mac_gstring_replace_all(gs, "{items}", mac_items_word(total));
    return g_string_free(gs, FALSE);
}

static char *mac_format_free_text(const char *free_str)
{
    GString *gs = g_string_new(mac_tr("free_space_fmt", "{size} available"));
    mac_gstring_replace_all(gs, "{size}", free_str ? free_str : "");
    return g_string_free(gs, FALSE);
}

static char *mac_format_modified_date(GFileInfo *info)
{
    if (!info) return NULL;
    GDateTime *dt = g_file_info_get_modification_date_time(info);
    GDateTime *local = NULL;
    if (dt) {
        local = g_date_time_to_local(dt);
    } else if (g_file_info_has_attribute(info, G_FILE_ATTRIBUTE_TIME_MODIFIED)) {
        guint64 secs = g_file_info_get_attribute_uint64(info, G_FILE_ATTRIBUTE_TIME_MODIFIED);
        if (secs > 0) {
            local = g_date_time_new_from_unix_local((gint64)secs);
        }
    }
    if (!local) return NULL;
    char *s = g_date_time_format(local, "%d.%m.%Y, %H:%M");
    g_date_time_unref(local);
    return s;
}

static void mac_on_single_file_info_ready(GObject *src, GAsyncResult *res, gpointer user_data)
{
    MacBottomQueryData *qd = (MacBottomQueryData *)user_data;
    GError *err = NULL;
    GFileInfo *info = g_file_query_info_finish(G_FILE(src), res, &err);
    if (err) {
        g_error_free(err);
        mac_bottom_query_data_free(qd);
        return;
    }
    if (!info || !qd || !qd->win_ref || !qd->ctx ||
        !GTK_IS_LABEL(qd->ctx->bottom_info_name_lbl) ||
        !GTK_IS_LABEL(qd->ctx->bottom_info_meta_lbl)) {
        if (info) g_object_unref(info);
        mac_bottom_query_data_free(qd);
        return;
    }

    const char *disp = g_file_info_get_display_name(info);
    char *bname_fallback = NULL;
    if (!disp || !*disp) {
        bname_fallback = g_file_get_basename(G_FILE(src));
        disp = bname_fallback ? bname_fallback : "";
    }

    GFileType ftype = g_file_info_get_file_type(info);
    char *size_str = NULL;
    if (ftype == G_FILE_TYPE_DIRECTORY) {
        size_str = g_strdup(mac_tr("folder", "Folder"));
    } else {
        goffset sz = g_file_info_get_size(info);
        size_str = g_format_size((guint64)(sz > 0 ? sz : 0));
    }

    char *mod_str = mac_format_modified_date(info);
    char *meta = NULL;
    if (mod_str && *mod_str) {
        meta = g_strdup_printf("  •  %s  •  %s %s", size_str, mac_tr("modified_label", "Modified:"), mod_str);
    } else {
        meta = g_strdup_printf("  •  %s", size_str);
    }

    gtk_widget_set_visible(qd->ctx->bottom_info_name_lbl, TRUE);
    gtk_label_set_text(GTK_LABEL(qd->ctx->bottom_info_name_lbl), disp);
    gtk_label_set_text(GTK_LABEL(qd->ctx->bottom_info_meta_lbl), meta);

    GIcon *gico = g_file_info_get_icon(info);
    if (gico && qd->leaf_img && GTK_IS_IMAGE(qd->leaf_img)) {
        gtk_image_set_from_gicon(GTK_IMAGE(qd->leaf_img), gico);
    }

    g_free(meta);
    g_free(mod_str);
    g_free(size_str);
    g_free(bname_fallback);
    g_object_unref(info);
    mac_bottom_query_data_free(qd);
}

static void mac_on_fs_free_ready(GObject *src, GAsyncResult *res, gpointer user_data)
{
    MacBottomQueryData *qd = (MacBottomQueryData *)user_data;
    GError *err = NULL;
    GFileInfo *info = g_file_query_filesystem_info_finish(G_FILE(src), res, &err);
    if (err) {
        g_error_free(err);
        mac_bottom_query_data_free(qd);
        return;
    }
    if (!info || !qd || !qd->win_ref || !qd->ctx ||
        !GTK_IS_LABEL(qd->ctx->bottom_info_meta_lbl)) {
        if (info) g_object_unref(info);
        mac_bottom_query_data_free(qd);
        return;
    }

    if (g_file_info_has_attribute(info, G_FILE_ATTRIBUTE_FILESYSTEM_FREE)) {
        guint64 free_bytes = g_file_info_get_attribute_uint64(info, G_FILE_ATTRIBUTE_FILESYSTEM_FREE);
        char *free_str = g_format_size(free_bytes);
        char *avail_txt = mac_format_free_text(free_str);
        char *txt = NULL;
        if (qd->sel_count > 1) {
            char *sel_txt = mac_format_selected_text(qd->sel_count, qd->total_count);
            txt = g_strdup_printf("%s  •  %s", sel_txt, avail_txt);
            g_free(sel_txt);
        } else {
            txt = g_strdup_printf("%u %s  •  %s",
                                  qd->total_count, mac_items_word(qd->total_count), avail_txt);
        }
        gtk_label_set_text(GTK_LABEL(qd->ctx->bottom_info_meta_lbl), txt);
        g_free(txt);
        g_free(avail_txt);
        g_free(free_str);
    }

    g_object_unref(info);
    mac_bottom_query_data_free(qd);
}

static gboolean mac_scroll_pathbar_end_idle(gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (!ctx || !ctx->window || !GTK_IS_WIDGET(ctx->window)) return G_SOURCE_REMOVE;
    ctx->path_scroll_idle_id = 0;
    if (ctx->bottom_path_scroll && GTK_IS_SCROLLED_WINDOW(ctx->bottom_path_scroll)) {
        GtkAdjustment *hadj = gtk_scrolled_window_get_hadjustment(GTK_SCROLLED_WINDOW(ctx->bottom_path_scroll));
        if (hadj) {
            double upper = gtk_adjustment_get_upper(hadj);
            double page = gtk_adjustment_get_page_size(hadj);
            if (upper > page) {
                gtk_adjustment_set_value(hadj, upper - page);
            } else {
                gtk_adjustment_set_value(hadj, 0.0);
            }
        }
    }
    return G_SOURCE_REMOVE;
}

typedef struct {
    MacNautilusCtx *ctx;
    GtkWidget *popover;
    guint up_steps;
} MacPathStepData;

static void mac_navigate_up_steps(MacNautilusCtx *ctx, guint up_steps)
{
    if (!ctx || up_steps == 0) return;
    GObject *slot = NULL;
    if (ctx->window && g_object_class_find_property(G_OBJECT_GET_CLASS(ctx->window), "active-slot")) {
        g_object_get(ctx->window, "active-slot", &slot, NULL);
    }
    GtkWidget *target = (slot && GTK_IS_WIDGET(slot)) ? GTK_WIDGET(slot) : ctx->window;
    for (guint i = 0; i < up_steps; i++) {
        gtk_widget_activate_action(target, "slot.up", NULL);
    }
    if (slot) g_object_unref(slot);
}

static void mac_on_bottom_crumb_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    MacPathStepData *sd = (MacPathStepData *)user_data;
    if (!sd || !sd->ctx) return;
    mac_navigate_up_steps(sd->ctx, sd->up_steps);
}

static const char *mac_icon_for_folder_file(GFile *file, gboolean is_home, gboolean is_root)
{
    if (is_home) return "user-home";
    if (is_root) return "drive-harddisk";
    if (!file) return "folder";
    char *uri = g_file_get_uri(file);
    if (uri) {
        if (g_str_has_prefix(uri, "trash:")) { g_free(uri); return "user-trash"; }
        if (g_str_has_prefix(uri, "recent:")) { g_free(uri); return "document-open-recent-symbolic"; }
        g_free(uri);
    }
    char *p = g_file_get_path(file);
    const char *res = "folder";
    if (p) {
        if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_DESKTOP)) == 0) res = "user-desktop";
        else if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_DOCUMENTS)) == 0) res = "folder-documents";
        else if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_DOWNLOAD)) == 0) res = "folder-download";
        else if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_PICTURES)) == 0) res = "folder-pictures";
        else if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_MUSIC)) == 0) res = "folder-music";
        else if (g_strcmp0(p, g_get_user_special_dir(G_USER_DIRECTORY_VIDEOS)) == 0) res = "folder-videos";
        g_free(p);
    }
    return res;
}

static GtkWidget *mac_make_bottom_crumb_widget(const char *label, const char *icon_name,
                                               gboolean clickable, gboolean is_selected_leaf,
                                               GtkWidget **out_img)
{
    GtkWidget *w = clickable ? gtk_button_new() : gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 5);
    GtkWidget *box = clickable ? gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 5) : w;
    gtk_widget_set_valign(w, GTK_ALIGN_CENTER);
    gtk_widget_add_css_class(w, "mac-bottom-crumb");
    if (clickable) {
        gtk_widget_add_css_class(w, "flat");
        gtk_widget_set_focus_on_click(w, FALSE);
        gtk_widget_set_can_focus(w, FALSE);
    }
    if (is_selected_leaf) {
        gtk_widget_add_css_class(w, "mac-bottom-crumb-selected");
    }

    GtkWidget *img = gtk_image_new_from_icon_name(icon_name ? icon_name : "folder");
    gtk_image_set_pixel_size(GTK_IMAGE(img), 14);
    gtk_box_append(GTK_BOX(box), img);
    if (out_img) *out_img = img;

    GtkWidget *lbl = gtk_label_new(label ? label : "");
    gtk_label_set_single_line_mode(GTK_LABEL(lbl), TRUE);
    gtk_label_set_ellipsize(GTK_LABEL(lbl), PANGO_ELLIPSIZE_MIDDLE);
    gtk_label_set_max_width_chars(GTK_LABEL(lbl), is_selected_leaf ? 36 : 20);
    gtk_box_append(GTK_BOX(box), lbl);

    if (clickable) {
        gtk_button_set_child(GTK_BUTTON(w), box);
    }
    return w;
}

static void mac_update_bottom_bars(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->bottom_bar || !ctx->bottom_path_box ||
        !ctx->bottom_info_name_lbl || !ctx->bottom_info_meta_lbl) {
        return;
    }

    if (ctx->info_cancellable) {
        g_cancellable_cancel(ctx->info_cancellable);
        g_clear_object(&ctx->info_cancellable);
    }
    ctx->info_cancellable = g_cancellable_new();

    guint sel_count = 0;
    guint total_count = 0;
    if (ctx->bound_model && GTK_IS_SELECTION_MODEL(ctx->bound_model)) {
        total_count = g_list_model_get_n_items(G_LIST_MODEL(ctx->bound_model));
        GtkBitset *bs = gtk_selection_model_get_selection(ctx->bound_model);
        if (bs) {
            sel_count = (guint)gtk_bitset_get_size(bs);
            gtk_bitset_unref(bs);
        }
    }

    GFile *loc = mac_get_active_slot_location(ctx);
    GFile *sel_loc = (sel_count == 1) ? mac_get_first_selected_location(ctx) : NULL;

    if (ctx->bottom_path_stack && GTK_IS_STACK(ctx->bottom_path_stack)) {
        mac_close_bottom_path_entry(ctx);
    }

    /* Rebuild Path Bar Breadcrumbs */
    GtkWidget *old = NULL;
    while ((old = gtk_widget_get_first_child(ctx->bottom_path_box)) != NULL) {
        gtk_box_remove(GTK_BOX(ctx->bottom_path_box), old);
    }

    GtkWidget *leaf_img = NULL;
    if (loc) {
        GPtrArray *chain = g_ptr_array_new_with_free_func(g_object_unref);
        const char *home_dir = g_get_home_dir();
        GFile *home_file = home_dir ? g_file_new_for_path(home_dir) : NULL;
        gboolean stop_at_home = (home_file && (g_file_equal(loc, home_file) || g_file_has_prefix(loc, home_file)));

        GFile *cur = g_object_ref(loc);
        guint guard = 0;
        while (cur && guard < 16) {
            g_ptr_array_add(chain, cur);
            if (stop_at_home && g_file_equal(cur, home_file)) {
                break;
            }
            GFile *parent = g_file_get_parent(cur);
            if (!parent || g_file_equal(parent, cur)) {
                if (parent) g_object_unref(parent);
                break;
            }
            cur = parent;
            guard++;
        }

        for (gint i = (gint)chain->len - 1; i >= 0; i--) {
            GFile *f = g_ptr_array_index(chain, (guint)i);
            guint up_steps = (guint)i;
            gboolean is_home = (home_file && g_file_equal(f, home_file));
            GFile *p_check = g_file_get_parent(f);
            gboolean is_root = (p_check == NULL);
            if (p_check) g_object_unref(p_check);

            char *disp_alloc = NULL;
            const char *disp = NULL;
            if (is_home) {
                disp = mac_tr("bookmark_home", "Home");
            } else if (is_root) {
                char *uri = g_file_get_uri(f);
                if (uri && g_str_has_prefix(uri, "trash:")) disp = mac_tr("bookmark_trash", "Trash");
                else if (uri && g_str_has_prefix(uri, "recent:")) disp = mac_tr("bookmark_recent", "Recent");
                else {
                    disp_alloc = g_file_get_basename(f);
                    disp = (disp_alloc && *disp_alloc && g_strcmp0(disp_alloc, "/") != 0)
                        ? disp_alloc
                        : mac_tr("system_disk", "Macintosh HD");
                }
                g_free(uri);
            } else {
                disp_alloc = g_file_get_basename(f);
                disp = (disp_alloc && *disp_alloc) ? disp_alloc : "/";
            }

            const char *ico = mac_icon_for_folder_file(f, is_home, is_root);
            GtkWidget *crumb = mac_make_bottom_crumb_widget(disp, ico, TRUE,
                                                            (!sel_loc && up_steps == 0), NULL);
            if (up_steps > 0) {
                gtk_widget_add_css_class(crumb, "mac-bottom-crumb-up");
                MacPathStepData *sd = g_new0(MacPathStepData, 1);
                sd->ctx = ctx;
                sd->up_steps = up_steps;
                g_signal_connect_data(crumb, "clicked", G_CALLBACK(mac_on_bottom_crumb_clicked),
                                      sd, mac_free_closure, 0);
            } else {
                g_signal_connect(crumb, "clicked", G_CALLBACK(mac_on_bottom_edit_clicked), ctx);
            }
            gtk_box_append(GTK_BOX(ctx->bottom_path_box), crumb);

            if (i > 0 || sel_loc) {
                GtkWidget *sep = gtk_image_new_from_icon_name("mac-finder-forward-symbolic");
                gtk_image_set_pixel_size(GTK_IMAGE(sep), 9);
                gtk_widget_add_css_class(sep, "mac-bottom-crumb-sep");
                gtk_box_append(GTK_BOX(ctx->bottom_path_box), sep);
            }
            g_free(disp_alloc);
        }

        if (home_file) g_object_unref(home_file);
        g_ptr_array_free(chain, TRUE);
    }

    if (sel_loc) {
        char *bname = g_file_get_basename(sel_loc);
        GtkWidget *leaf = mac_make_bottom_crumb_widget(bname ? bname : "", "text-x-generic",
                                                       TRUE, TRUE, &leaf_img);
        g_signal_connect(leaf, "clicked", G_CALLBACK(mac_on_bottom_edit_clicked), ctx);
        gtk_box_append(GTK_BOX(ctx->bottom_path_box), leaf);
        g_free(bname);
    }

    if (ctx->path_scroll_idle_id) {
        g_source_remove(ctx->path_scroll_idle_id);
    }
    ctx->path_scroll_idle_id = g_idle_add(mac_scroll_pathbar_end_idle, ctx);

    /* Update Lower Short File Info / Status Bar */
    if (sel_count == 1 && sel_loc) {
        char *bname = g_file_get_basename(sel_loc);
        gtk_widget_set_visible(ctx->bottom_info_name_lbl, TRUE);
        gtk_label_set_text(GTK_LABEL(ctx->bottom_info_name_lbl), bname ? bname : "");
        gtk_label_set_text(GTK_LABEL(ctx->bottom_info_meta_lbl), "");
        g_free(bname);

        MacBottomQueryData *qd = g_new0(MacBottomQueryData, 1);
        qd->ctx = ctx;
        qd->win_ref = ctx->window;
        if (qd->win_ref) g_object_add_weak_pointer(G_OBJECT(qd->win_ref), (gpointer *)&qd->win_ref);
        qd->leaf_img = leaf_img;
        if (qd->leaf_img) g_object_add_weak_pointer(G_OBJECT(qd->leaf_img), (gpointer *)&qd->leaf_img);
        qd->loc = g_object_ref(sel_loc);

        g_file_query_info_async(
            sel_loc,
            G_FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME ","
            G_FILE_ATTRIBUTE_STANDARD_TYPE ","
            G_FILE_ATTRIBUTE_STANDARD_SIZE ","
            G_FILE_ATTRIBUTE_STANDARD_ICON ","
            G_FILE_ATTRIBUTE_TIME_MODIFIED,
            G_FILE_QUERY_INFO_NONE,
            G_PRIORITY_DEFAULT,
            ctx->info_cancellable,
            mac_on_single_file_info_ready,
            qd);
    } else {
        gtk_widget_set_visible(ctx->bottom_info_name_lbl, FALSE);
        char *fallback = NULL;
        if (sel_count > 1) {
            fallback = mac_format_selected_text(sel_count, total_count);
        } else {
            fallback = g_strdup_printf("%u %s", total_count, mac_items_word(total_count));
        }
        gtk_label_set_text(GTK_LABEL(ctx->bottom_info_meta_lbl), fallback);
        g_free(fallback);

        if (loc) {
            MacBottomQueryData *qd = g_new0(MacBottomQueryData, 1);
            qd->ctx = ctx;
            qd->win_ref = ctx->window;
            if (qd->win_ref) g_object_add_weak_pointer(G_OBJECT(qd->win_ref), (gpointer *)&qd->win_ref);
            qd->sel_count = sel_count;
            qd->total_count = total_count;
            g_file_query_filesystem_info_async(
                loc,
                G_FILE_ATTRIBUTE_FILESYSTEM_FREE,
                G_PRIORITY_DEFAULT,
                ctx->info_cancellable,
                mac_on_fs_free_ready,
                qd);
        }
    }

    if (sel_loc) g_object_unref(sel_loc);
    if (loc) g_object_unref(loc);
}

static void mac_update_toolbar_button_states(MacNautilusCtx *ctx)
{
    if (!ctx) return;
    guint sel_count = 0;
    if (ctx->bound_model && GTK_IS_SELECTION_MODEL(ctx->bound_model)) {
        GtkBitset *bs = gtk_selection_model_get_selection(ctx->bound_model);
        if (bs) {
            sel_count = (guint)gtk_bitset_get_size(bs);
            gtk_bitset_unref(bs);
        }
    }

    gboolean has_sel = (sel_count > 0);
    if (ctx->trash_btn && GTK_IS_WIDGET(ctx->trash_btn)) {
        gtk_widget_set_sensitive(ctx->trash_btn, has_sel);
    }

    gboolean can_eject = FALSE;
    GFile *target = mac_get_first_selected_location(ctx);
    if (!target) target = mac_get_active_slot_location(ctx);
    if (target) {
        GMount *mount = g_file_find_enclosing_mount(target, NULL, NULL);
        if (mount) {
            can_eject = g_mount_can_eject(mount) || g_mount_can_unmount(mount);
            g_object_unref(mount);
        }
        g_object_unref(target);
    }
    if (ctx->eject_btn && GTK_IS_WIDGET(ctx->eject_btn)) {
        gtk_widget_set_sensitive(ctx->eject_btn, can_eject);
    }

    mac_update_bottom_bars(ctx);
}

static void mac_on_selection_changed(GtkSelectionModel *model G_GNUC_UNUSED,
                                     guint position G_GNUC_UNUSED,
                                     guint n_items G_GNUC_UNUSED,
                                     gpointer user_data)
{
    mac_update_toolbar_button_states((MacNautilusCtx *)user_data);
}

static void mac_on_slot_location_changed(GObject *obj G_GNUC_UNUSED,
                                         GParamSpec *pspec G_GNUC_UNUSED,
                                         gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    mac_ctx_schedule_rebind(ctx);
    mac_update_toolbar_button_states(ctx);
}

static void mac_ctx_clear_slot(MacNautilusCtx *ctx)
{
    if (!ctx) return;
    if (ctx->bound_model) {
        if (ctx->sel_changed_sig) {
            g_signal_handler_disconnect(ctx->bound_model, ctx->sel_changed_sig);
            ctx->sel_changed_sig = 0;
        }
        g_object_remove_weak_pointer(G_OBJECT(ctx->bound_model), (gpointer *)&ctx->bound_model);
        ctx->bound_model = NULL;
    }
    if (ctx->bound_slot) {
        if (ctx->slot_loc_sig) {
            g_signal_handler_disconnect(ctx->bound_slot, ctx->slot_loc_sig);
            ctx->slot_loc_sig = 0;
        }
        g_object_remove_weak_pointer(ctx->bound_slot, (gpointer *)&ctx->bound_slot);
        ctx->bound_slot = NULL;
    }
}

static gboolean mac_ctx_rebind_idle(gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (!ctx || !ctx->window || !GTK_IS_WIDGET(ctx->window)) {
        if (ctx) ctx->rebind_idle_id = 0;
        return G_SOURCE_REMOVE;
    }
    ctx->rebind_idle_id = 0;

    GObject *slot = NULL;
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(ctx->window), "active-slot")) {
        g_object_get(ctx->window, "active-slot", &slot, NULL);
    }

    if (slot != ctx->bound_slot) {
        mac_ctx_clear_slot(ctx);
        if (slot) {
            ctx->bound_slot = slot;
            g_object_add_weak_pointer(ctx->bound_slot, (gpointer *)&ctx->bound_slot);
            if (g_object_class_find_property(G_OBJECT_GET_CLASS(slot), "location")) {
                ctx->slot_loc_sig = g_signal_connect(slot, "notify::location", G_CALLBACK(mac_on_slot_location_changed), ctx);
            }
        }
    }

    GtkSelectionModel *new_model = NULL;
    if (slot && GTK_IS_WIDGET(slot)) {
        find_descendant_selection_view(GTK_WIDGET(slot), &new_model);
    }
    if (new_model != ctx->bound_model) {
        if (ctx->bound_model) {
            if (ctx->sel_changed_sig) {
                g_signal_handler_disconnect(ctx->bound_model, ctx->sel_changed_sig);
                ctx->sel_changed_sig = 0;
            }
            g_object_remove_weak_pointer(G_OBJECT(ctx->bound_model), (gpointer *)&ctx->bound_model);
            ctx->bound_model = NULL;
        }
        if (new_model) {
            ctx->bound_model = new_model;
            g_object_add_weak_pointer(G_OBJECT(ctx->bound_model), (gpointer *)&ctx->bound_model);
            ctx->sel_changed_sig = g_signal_connect(new_model, "selection-changed", G_CALLBACK(mac_on_selection_changed), ctx);
        }
    }

    if (slot) g_object_unref(slot);
    mac_update_toolbar_button_states(ctx);
    return G_SOURCE_REMOVE;
}

static void mac_ctx_schedule_rebind(MacNautilusCtx *ctx)
{
    if (!ctx) return;
    if (ctx->rebind_idle_id) {
        g_source_remove(ctx->rebind_idle_id);
    }
    ctx->rebind_idle_id = g_idle_add(mac_ctx_rebind_idle, ctx);
}

static void mac_on_active_slot_changed(GObject *obj G_GNUC_UNUSED,
                                       GParamSpec *pspec G_GNUC_UNUSED,
                                       gpointer user_data)
{
    mac_ctx_schedule_rebind((MacNautilusCtx *)user_data);
}

static void mac_sync_toolbar_switcher_visibility(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->toolbar_switcher || !GTK_IS_STACK(ctx->toolbar_switcher)) return;
    const char *page = gtk_stack_get_visible_child_name(GTK_STACK(ctx->toolbar_switcher));
    gboolean is_pathbar = (g_strcmp0(page, "pathbar") == 0);
    gboolean expand_input = !is_pathbar;

    if (is_pathbar) {
        gtk_widget_set_visible(ctx->toolbar_switcher, FALSE);
        if (ctx->title_label) gtk_widget_set_visible(ctx->title_label, TRUE);
    } else {
        if (ctx->title_label) gtk_widget_set_visible(ctx->title_label, FALSE);
        gtk_widget_set_visible(ctx->toolbar_switcher, TRUE);
    }

    GtkWidget *ht = gtk_widget_get_parent(ctx->toolbar_switcher);
    if (ht) {
        gtk_widget_set_hexpand(ht, expand_input);
        gtk_widget_set_halign(ht, expand_input ? GTK_ALIGN_FILL : GTK_ALIGN_START);
    }
    gtk_widget_set_hexpand(ctx->toolbar_switcher, expand_input);

    gboolean show_browsing = !expand_input;
    if (ctx->sort_btn) gtk_widget_set_visible(ctx->sort_btn, show_browsing);
    if (ctx->info_btn) gtk_widget_set_visible(ctx->info_btn, show_browsing);
    if (ctx->act_pill) gtk_widget_set_visible(ctx->act_pill, show_browsing);
    if (ctx->view_controls) gtk_widget_set_visible(ctx->view_controls, show_browsing);
    if (ctx->more_btn) gtk_widget_set_visible(ctx->more_btn, show_browsing);
}

static void mac_on_toolbar_page_changed(GObject *obj G_GNUC_UNUSED,
                                        GParamSpec *pspec G_GNUC_UNUSED,
                                        gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    mac_sync_toolbar_switcher_visibility(ctx);
}

static void mac_close_bottom_path_entry(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->bottom_path_stack || !GTK_IS_STACK(ctx->bottom_path_stack)) return;
    if (ctx->path_entry_closing) return;
    ctx->path_entry_closing = TRUE;
    if (ctx->path_focus_idle_id) {
        g_source_remove(ctx->path_focus_idle_id);
        ctx->path_focus_idle_id = 0;
    }
    if (g_strcmp0(gtk_stack_get_visible_child_name(GTK_STACK(ctx->bottom_path_stack)), "breadcrumbs") != 0) {
        if (ctx->window && GTK_IS_WINDOW(ctx->window) && ctx->bottom_path_entry &&
            gtk_widget_is_focus(ctx->bottom_path_entry)) {
            gtk_window_set_focus(GTK_WINDOW(ctx->window), NULL);
        }
        gtk_stack_set_visible_child_name(GTK_STACK(ctx->bottom_path_stack), "breadcrumbs");
    }
    ctx->path_entry_closing = FALSE;
}

static void mac_open_bottom_path_entry(MacNautilusCtx *ctx)
{
    if (!ctx || !ctx->bottom_path_stack || !ctx->bottom_path_entry) return;
    if (ctx->path_focus_idle_id) {
        g_source_remove(ctx->path_focus_idle_id);
        ctx->path_focus_idle_id = 0;
    }
    GFile *loc = mac_get_active_slot_location(ctx);
    char *path = loc ? g_file_get_path(loc) : NULL;
    char *text = path ? path : (loc ? g_file_get_uri(loc) : g_strdup(g_get_home_dir()));
    if (loc) g_object_unref(loc);

    gtk_editable_set_text(GTK_EDITABLE(ctx->bottom_path_entry), text ? text : "");
    g_free(text);

    gtk_stack_set_visible_child_name(GTK_STACK(ctx->bottom_path_stack), "entry");
    gtk_widget_grab_focus(ctx->bottom_path_entry);
    gtk_editable_select_region(GTK_EDITABLE(ctx->bottom_path_entry), 0, -1);
}

static void mac_on_bottom_edit_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    mac_open_bottom_path_entry((MacNautilusCtx *)user_data);
}

static gboolean mac_bottom_click_is_up_crumb(GtkGesture *gesture, double x, double y)
{
    GtkWidget *w = gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(gesture));
    if (!w) return FALSE;
    GtkWidget *picked = gtk_widget_pick(w, x, y, GTK_PICK_DEFAULT);
    if (!picked) return FALSE;
    GtkWidget *btn = GTK_IS_BUTTON(picked) ? picked : gtk_widget_get_ancestor(picked, GTK_TYPE_BUTTON);
    return (btn && gtk_widget_has_css_class(btn, "mac-bottom-crumb-up"));
}

static void mac_on_bottom_path_bg_pressed(GtkGestureClick *gesture,
                                          int n_press G_GNUC_UNUSED,
                                          double x,
                                          double y,
                                          gpointer user_data G_GNUC_UNUSED)
{
    if (mac_bottom_click_is_up_crumb(GTK_GESTURE(gesture), x, y)) {
        gtk_gesture_set_state(GTK_GESTURE(gesture), GTK_EVENT_SEQUENCE_DENIED);
    } else {
        gtk_gesture_set_state(GTK_GESTURE(gesture), GTK_EVENT_SEQUENCE_CLAIMED);
    }
}

static void mac_on_bottom_path_bg_released(GtkGestureClick *gesture,
                                           int n_press G_GNUC_UNUSED,
                                           double x,
                                           double y,
                                           gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (mac_bottom_click_is_up_crumb(GTK_GESTURE(gesture), x, y)) {
        return;
    }
    mac_open_bottom_path_entry(ctx);
}

static void mac_on_bottom_path_entry_activate(GtkEntry *entry, gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (!ctx) return;
    const char *raw = gtk_editable_get_text(GTK_EDITABLE(entry));
    if (!raw) {
        mac_close_bottom_path_entry(ctx);
        return;
    }
    char *trimmed = g_strdup(raw);
    g_strstrip(trimmed);
    if (!*trimmed) {
        g_free(trimmed);
        mac_close_bottom_path_entry(ctx);
        return;
    }

    char *expanded = NULL;
    if (g_strcmp0(trimmed, "~") == 0) {
        expanded = g_strdup(g_get_home_dir());
    } else if (g_str_has_prefix(trimmed, "~/")) {
        expanded = g_build_filename(g_get_home_dir(), trimmed + 2, NULL);
    } else {
        expanded = g_strdup(trimmed);
    }
    g_free(trimmed);

    GFile *dest = NULL;
    if (expanded[0] == '/' || g_strstr_len(expanded, -1, "://") != NULL) {
        dest = g_file_parse_name(expanded);
    } else {
        GFile *cur = mac_get_active_slot_location(ctx);
        if (cur) {
            dest = g_file_resolve_relative_path(cur, expanded);
            g_object_unref(cur);
        } else {
            dest = g_file_parse_name(expanded);
        }
    }

    mac_close_bottom_path_entry(ctx);

    if (dest) {
        GObject *slot = NULL;
        if (ctx->window && g_object_class_find_property(G_OBJECT_GET_CLASS(ctx->window), "active-slot")) {
            g_object_get(ctx->window, "active-slot", &slot, NULL);
        }
        GtkWidget *target = (slot && GTK_IS_WIDGET(slot)) ? GTK_WIDGET(slot) : ctx->window;
        gboolean navigated = FALSE;

        GtkWidget *loc_page = (ctx->toolbar_switcher && GTK_IS_STACK(ctx->toolbar_switcher))
            ? gtk_stack_get_child_by_name(GTK_STACK(ctx->toolbar_switcher), "location")
            : NULL;
        GtkWidget *loc_entry = loc_page ? find_descendant_by_type_name(loc_page, "NautilusLocationEntry") : NULL;
        if (!loc_entry && loc_page && g_strcmp0(G_OBJECT_TYPE_NAME(loc_page), "NautilusLocationEntry") == 0) {
            loc_entry = loc_page;
        }
        if (loc_entry) {
            guint sig_id = g_signal_lookup("location-changed", G_OBJECT_TYPE(loc_entry));
            GSignalQuery q = {0};
            if (sig_id != 0) {
                g_signal_query(sig_id, &q);
                if (q.n_params == 1 && g_type_is_a(q.param_types[0], G_TYPE_FILE)) {
                    g_signal_emit(loc_entry, sig_id, 0, dest);
                    navigated = TRUE;
                } else if (q.n_params == 2 && g_type_is_a(q.param_types[0], G_TYPE_FILE)) {
                    g_signal_emit(loc_entry, sig_id, 0, dest, 0);
                    navigated = TRUE;
                }
            }
            if (!navigated && GTK_IS_EDITABLE(loc_entry)) {
                gtk_widget_activate_action(target, "slot.open-location", NULL);
                char *d_text = g_file_get_path(dest);
                if (!d_text) d_text = g_file_get_uri(dest);
                gtk_editable_set_text(GTK_EDITABLE(loc_entry), d_text ? d_text : expanded);
                g_free(d_text);
                g_signal_emit_by_name(loc_entry, "activate");
            }
        }
        if (slot) g_object_unref(slot);
        g_object_unref(dest);
    }
    g_free(expanded);
}

static gboolean mac_on_bottom_path_entry_key(GtkEventControllerKey *ctrl G_GNUC_UNUSED,
                                             guint keyval,
                                             guint keycode G_GNUC_UNUSED,
                                             GdkModifierType state G_GNUC_UNUSED,
                                             gpointer user_data)
{
    if (keyval == GDK_KEY_Escape) {
        mac_close_bottom_path_entry((MacNautilusCtx *)user_data);
        return TRUE;
    }
    return FALSE;
}

static gboolean mac_close_bottom_path_entry_idle(gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (!ctx || !ctx->bottom_path_stack || !GTK_IS_WIDGET(ctx->bottom_path_stack)) return G_SOURCE_REMOVE;
    ctx->path_focus_idle_id = 0;
    if (ctx->bottom_path_entry && gtk_widget_in_destruction(ctx->bottom_path_entry)) return G_SOURCE_REMOVE;
    if (!gtk_widget_is_focus(ctx->bottom_path_entry)) {
        GtkRoot *root = gtk_widget_get_root(ctx->bottom_path_entry);
        GtkWidget *focus_w = root && GTK_IS_WINDOW(root) ? gtk_window_get_focus(GTK_WINDOW(root)) : NULL;
        if (!focus_w || !gtk_widget_is_ancestor(focus_w, ctx->bottom_path_entry)) {
            mac_close_bottom_path_entry(ctx);
        }
    }
    return G_SOURCE_REMOVE;
}

static void mac_on_bottom_path_entry_leave(GtkEventControllerFocus *ctrl G_GNUC_UNUSED,
                                           gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    if (!ctx || ctx->path_entry_closing) return;
    if (ctx->path_focus_idle_id) {
        g_source_remove(ctx->path_focus_idle_id);
    }
    ctx->path_focus_idle_id = g_idle_add(mac_close_bottom_path_entry_idle, ctx);
}

static GtkWidget *mac_make_popover_menu_row(const char *label_text, const char *icon_name)
{
    GtkWidget *btn = gtk_button_new();
    gtk_widget_add_css_class(btn, "flat");
    gtk_widget_add_css_class(btn, "mac-finder-pop-row");
    gtk_widget_set_focus_on_click(btn, FALSE);
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    if (icon_name) {
        GtkWidget *img = gtk_image_new_from_icon_name(icon_name);
        gtk_image_set_pixel_size(GTK_IMAGE(img), 13);
        gtk_box_append(GTK_BOX(box), img);
    }
    GtkWidget *lbl = gtk_label_new(label_text);
    gtk_label_set_xalign(GTK_LABEL(lbl), 0.0f);
    gtk_label_set_ellipsize(GTK_LABEL(lbl), PANGO_ELLIPSIZE_MIDDLE);
    gtk_label_set_max_width_chars(GTK_LABEL(lbl), 24);
    gtk_box_append(GTK_BOX(box), lbl);
    gtk_button_set_child(GTK_BUTTON(btn), box);
    return btn;
}

typedef struct {
    MacNautilusCtx *ctx;
    GtkWidget *popover;
    const char *action;
    const char *sort_key;
    gboolean sort_desc;
    gboolean is_sort;
} MacSortActData;

static void mac_on_sort_menu_item_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    MacSortActData *d = (MacSortActData *)user_data;
    if (!d || !d->ctx) return;
    if (d->popover) gtk_popover_popdown(GTK_POPOVER(d->popover));
    GtkWidget *view = mac_get_active_view_widget(d->ctx);
    if (!view) return;
    if (d->is_sort) {
        gtk_widget_activate_action(view, "view.sort", "(sb)", d->sort_key, d->sort_desc);
    } else if (d->action) {
        gtk_widget_activate_action(view, d->action, NULL);
    }
}

static GtkWidget *mac_build_sort_popover(MacNautilusCtx *ctx)
{
    GtkWidget *pop = gtk_popover_new();
    gtk_popover_set_has_arrow(GTK_POPOVER(pop), FALSE);
    gtk_popover_set_position(GTK_POPOVER(pop), GTK_POS_BOTTOM);
    gtk_widget_add_css_class(pop, "mac-finder-menu");

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);

    static const struct {
        const char *i18n_key;
        const char *en_label;
        const char *icon;
        const char *key;
        gboolean desc;
    } sort_items[] = {
        { "sort_name_az", "Name (A–Z)", "view-sort-ascending-symbolic", "name", FALSE },
        { "sort_name_za", "Name (Z–A)", "view-sort-descending-symbolic", "name", TRUE },
        { "sort_date_new", "Date (Newest)", "document-open-recent-symbolic", "date_modified", TRUE },
        { "sort_date_old", "Date (Oldest)", "document-open-recent-symbolic", "date_modified", FALSE },
        { "sort_size", "Size", "drive-harddisk-symbolic", "size", TRUE },
        { "sort_type", "Type", "folder-symbolic", "type", FALSE },
    };

    for (size_t i = 0; i < G_N_ELEMENTS(sort_items); i++) {
        GtkWidget *row = mac_make_popover_menu_row(mac_tr(sort_items[i].i18n_key, sort_items[i].en_label), sort_items[i].icon);
        MacSortActData *d = g_new0(MacSortActData, 1);
        d->ctx = ctx;
        d->popover = pop;
        d->sort_key = sort_items[i].key;
        d->sort_desc = sort_items[i].desc;
        d->is_sort = TRUE;
        g_signal_connect_data(row, "clicked", G_CALLBACK(mac_on_sort_menu_item_clicked), d, mac_free_closure, 0);
        gtk_box_append(GTK_BOX(vbox), row);
    }

    GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_box_append(GTK_BOX(vbox), sep);

    /* Balanced full-width zoom pills (- / +) inside Icon Size row (no awkward gap) */
    GtkWidget *zoom_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    gtk_widget_add_css_class(zoom_row, "mac-finder-pop-static-row");
    GtkWidget *z_ico = gtk_image_new_from_icon_name("zoom-fit-best-symbolic");
    gtk_image_set_pixel_size(GTK_IMAGE(z_ico), 14);
    gtk_box_append(GTK_BOX(zoom_row), z_ico);
    GtkWidget *z_lbl = gtk_label_new(mac_tr("icon_size", "Icon Size"));
    gtk_label_set_xalign(GTK_LABEL(z_lbl), 0.0f);
    gtk_box_append(GTK_BOX(zoom_row), z_lbl);
    GtkWidget *z_pills = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 5);
    gtk_box_set_homogeneous(GTK_BOX(z_pills), TRUE);
    gtk_widget_set_hexpand(z_pills, TRUE);
    gtk_widget_set_halign(z_pills, GTK_ALIGN_FILL);
    GtkWidget *z_out = gtk_button_new_from_icon_name("zoom-out-symbolic");
    gtk_widget_add_css_class(z_out, "flat");
    gtk_widget_add_css_class(z_out, "mac-finder-pop-mini-btn");
    gtk_widget_set_hexpand(z_out, TRUE);
    gtk_widget_set_focus_on_click(z_out, FALSE);
    MacSortActData *dz_out = g_new0(MacSortActData, 1);
    dz_out->ctx = ctx;
    dz_out->action = "view.zoom-out";
    g_signal_connect_data(z_out, "clicked", G_CALLBACK(mac_on_sort_menu_item_clicked), dz_out, mac_free_closure, 0);
    gtk_box_append(GTK_BOX(z_pills), z_out);
    GtkWidget *z_in = gtk_button_new_from_icon_name("zoom-in-symbolic");
    gtk_widget_add_css_class(z_in, "flat");
    gtk_widget_add_css_class(z_in, "mac-finder-pop-mini-btn");
    gtk_widget_set_hexpand(z_in, TRUE);
    gtk_widget_set_focus_on_click(z_in, FALSE);
    MacSortActData *dz_in = g_new0(MacSortActData, 1);
    dz_in->ctx = ctx;
    dz_in->action = "view.zoom-in";
    g_signal_connect_data(z_in, "clicked", G_CALLBACK(mac_on_sort_menu_item_clicked), dz_in, mac_free_closure, 0);
    gtk_box_append(GTK_BOX(z_pills), z_in);
    gtk_box_append(GTK_BOX(zoom_row), z_pills);
    gtk_box_append(GTK_BOX(vbox), zoom_row);

    static const struct {
        const char *i18n_key;
        const char *en_label;
        const char *icon;
        const char *action;
    } extra_items[] = {
        { "new_folder", "New Folder", "folder-new-symbolic", "view.new-folder" },
        { "hidden_files", "Hidden Files", "view-reveal-symbolic", "view.show-hidden-files" },
        { "open_terminal", "Open Terminal", "utilities-terminal-symbolic", "view.current-directory-xdg-terminal" },
    };

    for (size_t i = 0; i < G_N_ELEMENTS(extra_items); i++) {
        GtkWidget *row = mac_make_popover_menu_row(mac_tr(extra_items[i].i18n_key, extra_items[i].en_label), extra_items[i].icon);
        MacSortActData *d = g_new0(MacSortActData, 1);
        d->ctx = ctx;
        d->popover = pop;
        d->action = extra_items[i].action;
        g_signal_connect_data(row, "clicked", G_CALLBACK(mac_on_sort_menu_item_clicked), d, mac_free_closure, 0);
        gtk_box_append(GTK_BOX(vbox), row);
    }

    gtk_popover_set_child(GTK_POPOVER(pop), vbox);
    return pop;
}

static void mac_on_info_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    GtkWidget *view = mac_get_active_view_widget(ctx);
    if (view) {
        gtk_widget_activate_action(view, "view.properties", NULL);
    }
}

static void mac_on_trash_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    GtkWidget *view = mac_get_active_view_widget(ctx);
    if (view) {
        gtk_widget_activate_action(view, "view.move-to-trash", NULL);
    }
}

static void mac_on_eject_finish(GObject *source_object, GAsyncResult *res, gpointer user_data G_GNUC_UNUSED)
{
    if (G_IS_MOUNT(source_object)) {
        g_mount_eject_with_operation_finish(G_MOUNT(source_object), res, NULL);
    }
}

static void mac_on_unmount_finish(GObject *source_object, GAsyncResult *res, gpointer user_data G_GNUC_UNUSED)
{
    if (G_IS_MOUNT(source_object)) {
        g_mount_unmount_with_operation_finish(G_MOUNT(source_object), res, NULL);
    }
}

static void mac_on_eject_clicked(GtkButton *btn G_GNUC_UNUSED, gpointer user_data)
{
    MacNautilusCtx *ctx = (MacNautilusCtx *)user_data;
    GFile *target = mac_get_first_selected_location(ctx);
    if (!target) target = mac_get_active_slot_location(ctx);
    if (!target) return;

    GMount *mount = g_file_find_enclosing_mount(target, NULL, NULL);
    g_object_unref(target);
    if (!mount) return;

    if (g_mount_can_eject(mount)) {
        g_mount_eject_with_operation(mount, G_MOUNT_UNMOUNT_NONE, NULL, NULL, mac_on_eject_finish, NULL);
    } else if (g_mount_can_unmount(mount)) {
        g_mount_unmount_with_operation(mount, G_MOUNT_UNMOUNT_NONE, NULL, NULL, mac_on_unmount_finish, NULL);
    }
    g_object_unref(mount);
}

static void mac_polish_inline_zoom_buttons(GtkWidget *box)
{
    /* Outer box.inline-buttons in GtkPopoverMenu holds [none(GtkGizmo), GtkLabel("Icon Size"), GtkBox(buttons)].
     * Never make this outer box homogeneous, otherwise the leading GtkGizmo occupies a third of the row as empty space! */
    gtk_widget_add_css_class(box, "mac-inline-zoom-row");
    gtk_box_set_homogeneous(GTK_BOX(box), FALSE);
    gtk_box_set_spacing(GTK_BOX(box), 8);
    gtk_widget_set_hexpand(box, TRUE);
    gtk_widget_set_halign(box, GTK_ALIGN_FILL);
    gtk_widget_set_valign(box, GTK_ALIGN_CENTER);

    for (GtkWidget *c = gtk_widget_get_first_child(box); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        if (GTK_IS_LABEL(c)) {
            gtk_widget_add_css_class(c, "mac-inline-zoom-label");
            gtk_label_set_xalign(GTK_LABEL(c), 0.0f);
            gtk_widget_set_halign(c, GTK_ALIGN_START);
            gtk_widget_set_valign(c, GTK_ALIGN_CENTER);
            gtk_widget_set_hexpand(c, TRUE);
        } else if (GTK_IS_BOX(c)) {
            gtk_widget_add_css_class(c, "mac-inline-zoom-box");
            gtk_box_set_homogeneous(GTK_BOX(c), TRUE);
            gtk_box_set_spacing(GTK_BOX(c), 5);
            gtk_widget_set_hexpand(c, FALSE);
            gtk_widget_set_halign(c, GTK_ALIGN_END);
            gtk_widget_set_valign(c, GTK_ALIGN_CENTER);
            for (GtkWidget *item = gtk_widget_get_first_child(c); item != NULL; item = gtk_widget_get_next_sibling(item)) {
                GtkWidget *btn = GTK_IS_BUTTON(item) ? item : gtk_widget_get_first_child(item);
                if (btn && GTK_IS_BUTTON(btn)) {
                    gtk_widget_set_hexpand(btn, FALSE);
                    gtk_widget_set_halign(btn, GTK_ALIGN_CENTER);
                }
            }
        } else if (GTK_IS_BUTTON(c)) {
            gtk_widget_set_hexpand(c, FALSE);
            gtk_widget_set_halign(c, GTK_ALIGN_END);
        } else {
            /* Collapse leading empty separator GtkGizmo inside inline-buttons row */
            gtk_widget_set_visible(c, FALSE);
        }
    }
}

static gboolean mac_widget_has_visible_action_child(GtkWidget *w)
{
    if (!w || !gtk_widget_get_visible(w)) return FALSE;
    if (GTK_IS_BUTTON(w)) return TRUE;
    if (GTK_IS_LABEL(w) || GTK_IS_SEPARATOR(w) || GTK_IS_IMAGE(w)) return FALSE;
    for (GtkWidget *c = gtk_widget_get_first_child(w); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        if (mac_widget_has_visible_action_child(c)) return TRUE;
    }
    return FALSE;
}

static void mac_polish_popover_menu_tree(GtkWidget *root)
{
    if (!root) return;
    if (GTK_IS_BOX(root)) {
        if (gtk_widget_has_css_class(root, "inline-buttons")) {
            mac_polish_inline_zoom_buttons(root);
        } else if (gtk_orientable_get_orientation(GTK_ORIENTABLE(root)) == GTK_ORIENTATION_VERTICAL) {
            /* Detect section boxes containing a title label but zero visible action widgets */
            GtkWidget *title_lbl = NULL;
            gboolean has_action = FALSE;
            int child_cnt = 0;
            for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
                child_cnt++;
                if (GTK_IS_LABEL(c) && (gtk_widget_has_css_class(c, "title") || gtk_widget_has_css_class(c, "separator"))) {
                    title_lbl = c;
                } else if (mac_widget_has_visible_action_child(c)) {
                    has_action = TRUE;
                }
            }
            if (title_lbl) {
                gtk_widget_set_visible(title_lbl, has_action);
            }
            if (g_object_get_data(G_OBJECT(root), "mac-empty-collapsed") && has_action) {
                gtk_widget_set_visible(root, TRUE);
                g_object_set_data(G_OBJECT(root), "mac-empty-collapsed", NULL);
            } else if (title_lbl && !has_action && child_cnt <= 2) {
                g_object_set_data(G_OBJECT(root), "mac-empty-collapsed", GINT_TO_POINTER(1));
                gtk_widget_set_visible(root, FALSE);
            }
        }
    }
    for (GtkWidget *c = gtk_widget_get_first_child(root); c != NULL; c = gtk_widget_get_next_sibling(c)) {
        mac_polish_popover_menu_tree(c);
    }
}

static gboolean mac_on_view_controls_popover_show_idle(gpointer user_data)
{
    GtkWidget *pop = GTK_WIDGET(user_data);
    if (pop && GTK_IS_WIDGET(pop)) {
        GtkWidget *child = gtk_popover_get_child(GTK_POPOVER(pop));
        if (child) mac_polish_popover_menu_tree(child);
    }
    return G_SOURCE_REMOVE;
}

static void mac_on_view_controls_popover_show(GtkWidget *pop, gpointer user_data G_GNUC_UNUSED)
{
    if (!pop) return;
    GtkWidget *child = gtk_popover_get_child(GTK_POPOVER(pop));
    if (child) mac_polish_popover_menu_tree(child);
    g_idle_add_full(G_PRIORITY_DEFAULT_IDLE, mac_on_view_controls_popover_show_idle,
                    g_object_ref(pop), g_object_unref);
}

static void mac_sync_view_split_icons(AdwSplitButton *split_btn)
{
    if (!split_btn || !ADW_IS_SPLIT_BUTTON(split_btn)) return;
    const char *cur = adw_split_button_get_icon_name(split_btn);
    if (cur && !g_str_has_prefix(cur, "mac-finder-")) {
        /* Nautilus binds splitbutton icon-name to the NEXT view target ("view-list-symbolic" when in Grid View) */
        if (strstr(cur, "grid")) {
            adw_split_button_set_icon_name(split_btn, "mac-finder-list-symbolic");
        } else {
            adw_split_button_set_icon_name(split_btn, "mac-finder-grid-symbolic");
        }
    }
    GtkWidget *dropdown_btn = gtk_widget_get_last_child(GTK_WIDGET(split_btn));
    if (dropdown_btn && GTK_IS_MENU_BUTTON(dropdown_btn)) {
        if (g_strcmp0(gtk_menu_button_get_icon_name(GTK_MENU_BUTTON(dropdown_btn)), "mac-finder-chevron-updown-symbolic") != 0) {
            gtk_menu_button_set_icon_name(GTK_MENU_BUTTON(dropdown_btn), "mac-finder-chevron-updown-symbolic");
        }
        GtkWidget *img = find_descendant_by_type_name(dropdown_btn, "GtkImage");
        if (img && GTK_IS_IMAGE(img)) {
            gtk_image_set_pixel_size(GTK_IMAGE(img), 13);
        }
    }
    GtkWidget *left_btn = gtk_widget_get_first_child(GTK_WIDGET(split_btn));
    if (left_btn) {
        GtkWidget *left_img = find_descendant_by_type_name(left_btn, "GtkImage");
        if (left_img && GTK_IS_IMAGE(left_img)) {
            gtk_image_set_pixel_size(GTK_IMAGE(left_img), 18);
        }
    }
}

static void mac_on_view_split_icon_changed(GObject *obj, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    mac_sync_view_split_icons(ADW_SPLIT_BUTTON(obj));
    mac_ctx_schedule_rebind((MacNautilusCtx *)user_data);
}

static void mac_sync_window_theme_class(AdwStyleManager *sm, GParamSpec *pspec G_GNUC_UNUSED, gpointer user_data)
{
    GtkWidget *win = GTK_WIDGET(user_data);
    if (!win || !GTK_IS_WIDGET(win)) return;
    gboolean is_dark = sm ? adw_style_manager_get_dark(sm) : TRUE;
    if (is_dark) {
        gtk_widget_add_css_class(win, "mac-theme-dark");
        gtk_widget_remove_css_class(win, "mac-theme-light");
    } else {
        gtk_widget_add_css_class(win, "mac-theme-light");
        gtk_widget_remove_css_class(win, "mac-theme-dark");
    }
    MacNautilusCtx *ctx = g_object_get_data(G_OBJECT(win), "mac_nautilus_ctx");
    if (ctx && ctx->bottom_bar) {
        MacBottomBlurBar *bb = (MacBottomBlurBar *)ctx->bottom_bar;
        bb->is_dark = is_dark;
        gtk_widget_queue_draw(ctx->bottom_bar);
    }
}

static void find_buttons_in_sidebar(GtkWidget *widget, GtkWidget **search_global_btn, GtkWidget **menu_btn)
{
    if (!widget) return;
    if (GTK_IS_TOGGLE_BUTTON(widget)) {
        const char *action = gtk_actionable_get_action_name(GTK_ACTIONABLE(widget));
        if (g_strcmp0(action, "slot.search-global") == 0) {
            *search_global_btn = widget;
        }
    } else if (GTK_IS_MENU_BUTTON(widget)) {
        const char *icon = gtk_menu_button_get_icon_name(GTK_MENU_BUTTON(widget));
        if (g_strcmp0(icon, "open-menu-symbolic") == 0) {
            *menu_btn = widget;
        }
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_buttons_in_sidebar(child, search_global_btn, menu_btn);
    }
}

static void reparent_widget_into(GtkWidget *widget, GtkWidget *dest_box)
{
    if (!widget || !dest_box || !GTK_IS_BOX(dest_box)) return;
    g_object_ref(widget);
    GtkWidget *parent = gtk_widget_get_parent(widget);
    if (parent) {
        if (GTK_IS_BOX(parent)) {
            gtk_box_remove(GTK_BOX(parent), widget);
        } else if (GTK_IS_STACK(parent)) {
            gtk_stack_remove(GTK_STACK(parent), widget);
        } else if (ADW_IS_HEADER_BAR(parent)) {
            adw_header_bar_remove(ADW_HEADER_BAR(parent), widget);
        } else if (ADW_IS_BIN(parent)) {
            adw_bin_set_child(ADW_BIN(parent), NULL);
        } else {
            gtk_widget_unparent(widget);
        }
    }
    gtk_box_append(GTK_BOX(dest_box), widget);
    g_object_unref(widget);
}

static void style_pathbar_children(GtkWidget *widget)
{
    if (!widget) return;
    gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
    gtk_widget_set_vexpand(widget, FALSE);
    if (GTK_IS_SCROLLED_WINDOW(widget)) {
        gtk_scrolled_window_set_propagate_natural_width(GTK_SCROLLED_WINDOW(widget), FALSE);
        gtk_widget_set_size_request(widget, -1, 28);
    }
    if (GTK_IS_BUTTON(widget) || GTK_IS_MENU_BUTTON(widget)) {
        gtk_widget_set_size_request(widget, -1, 26);
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        style_pathbar_children(child);
    }
}

static void find_and_style_pathbar(GtkWidget *widget)
{
    if (!widget) return;
    const char *type_name = G_OBJECT_TYPE_NAME(widget);
    if (g_strcmp0(type_name, "NautilusPathBar") == 0 || gtk_widget_has_css_class(widget, "nautilus-pathbar")) {
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_vexpand(widget, FALSE);
        gtk_widget_set_size_request(widget, -1, 30);
        gtk_widget_add_css_class(widget, "mac-pathbar");
        style_pathbar_children(widget);
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_and_style_pathbar(child);
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
    if (!hb || !widget || !GTK_IS_WIDGET(widget)) return;
    g_object_ref(widget);
    GtkWidget *parent = gtk_widget_get_parent(widget);
    if (parent && GTK_IS_BOX(parent)) {
        gtk_box_remove(GTK_BOX(parent), widget);
    } else {
        adw_header_bar_remove(hb, widget);
    }
    gtk_widget_set_visible(widget, FALSE);
    g_object_unref(widget);
}

static void style_history_controls_widget(GtkWidget *hist_widget)
{
    if (!hist_widget) return;
    gtk_widget_add_css_class(hist_widget, "mac-history-controls");
    gtk_widget_set_valign(hist_widget, GTK_ALIGN_CENTER);
    gtk_widget_set_halign(hist_widget, GTK_ALIGN_CENTER);
    gtk_widget_set_size_request(hist_widget, 72, 36);

    GtkWidget *box = gtk_widget_get_first_child(hist_widget);
    if (box && GTK_IS_BOX(box)) {
        gtk_widget_add_css_class(box, "mac-history-capsule");
        gtk_box_set_spacing(GTK_BOX(box), 0);

        GtkWidget *back_btn = find_descendant_actionable(box, "slot.back");
        GtkWidget *fwd_btn = find_descendant_actionable(box, "slot.forward");
        if (back_btn && GTK_IS_BUTTON(back_btn)) {
            gtk_button_set_icon_name(GTK_BUTTON(back_btn), "mac-finder-back-symbolic");
            gtk_widget_add_css_class(back_btn, "mac-history-button");
            gtk_widget_set_size_request(back_btn, 29, 28);
            GtkWidget *img = find_descendant_by_type_name(back_btn, "GtkImage");
            if (img && GTK_IS_IMAGE(img)) gtk_image_set_pixel_size(GTK_IMAGE(img), 16);
        }
        if (fwd_btn && GTK_IS_BUTTON(fwd_btn)) {
            gtk_button_set_icon_name(GTK_BUTTON(fwd_btn), "mac-finder-forward-symbolic");
            gtk_widget_add_css_class(fwd_btn, "mac-history-button");
            gtk_widget_set_size_request(fwd_btn, 29, 28);
            GtkWidget *img = find_descendant_by_type_name(fwd_btn, "GtkImage");
            if (img && GTK_IS_IMAGE(img)) gtk_image_set_pixel_size(GTK_IMAGE(img), 16);
        }
        if (back_btn && fwd_btn && !g_object_get_data(G_OBJECT(box), "mac-divider-added")) {
            g_object_set_data(G_OBJECT(box), "mac-divider-added", GINT_TO_POINTER(1));
            GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_VERTICAL);
            gtk_widget_add_css_class(sep, "mac-history-divider");
            gtk_widget_set_valign(sep, GTK_ALIGN_CENTER);
            gtk_box_insert_child_after(GTK_BOX(box), sep, back_btn);
        }
    }
}

static void shift_start_box(GtkWidget *widget)
{
    if (!widget) return;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(widget), "NautilusHistoryControls") == 0) {
        style_history_controls_widget(widget);
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

static GtkWidget *mac_make_finder_icon(const char *icon_name, int px_size)
{
    GtkWidget *img = gtk_image_new_from_icon_name(icon_name);
    gtk_image_set_pixel_size(GTK_IMAGE(img), px_size);
    return img;
}

static GtkWidget *mac_create_circle_button(const char *icon_name, const char *tooltip, const char *extra_class)
{
    GtkWidget *btn = gtk_button_new();
    gtk_button_set_child(GTK_BUTTON(btn), mac_make_finder_icon(icon_name, 18));
    if (tooltip) gtk_widget_set_tooltip_text(btn, tooltip);
    gtk_widget_set_valign(btn, GTK_ALIGN_CENTER);
    gtk_widget_set_halign(btn, GTK_ALIGN_CENTER);
    gtk_widget_set_size_request(btn, 36, 36);
    gtk_widget_set_focus_on_click(btn, FALSE);
    gtk_widget_add_css_class(btn, "mac-circle-button");
    if (extra_class) gtk_widget_add_css_class(btn, extra_class);
    return btn;
}

static gboolean mac_fix_nautilus_window(gpointer user_data)
{
    GtkWindow *window = GTK_WINDOW(user_data);
    if (!window || !GTK_IS_WINDOW(window)) return G_SOURCE_REMOVE;

    AdwOverlaySplitView *split_view = NULL;
    find_split_view(GTK_WIDGET(window), &split_view);
    if (g_strcmp0(G_OBJECT_TYPE_NAME(window), "NautilusWindow") != 0 && !split_view) {
        return G_SOURCE_REMOVE;
    }

    mac_ensure_finder_icons();
    gtk_widget_add_css_class(GTK_WIDGET(window), "nautilus-window");

    if (!g_object_get_data(G_OBJECT(window), "mac_theme_hooked")) {
        g_object_set_data(G_OBJECT(window), "mac_theme_hooked", GINT_TO_POINTER(1));
        AdwStyleManager *sm = adw_style_manager_get_default();
        mac_sync_window_theme_class(sm, NULL, window);
        if (sm) {
            g_signal_connect_object(sm, "notify::dark", G_CALLBACK(mac_sync_window_theme_class), window, 0);
        }
    }

    static gboolean css_loaded = FALSE;
    if (!css_loaded) {
        css_loaded = TRUE;
        GtkCssProvider *provider = gtk_css_provider_new();
        const char *custom_css =
            /* === Window & Panes (1:1 macOS Tahoe Finder Dark Reference) === */
            "window.nautilus-window,\n"
            "window.nautilus-window.background,\n"
            "window.nautilus-window overlay-split-view {\n"
            "    background-color: #202020;\n"
            "    background-image: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light,\n"
            "window.nautilus-window.mac-theme-light.background,\n"
            "window.nautilus-window.mac-theme-light overlay-split-view {\n"
            "    background-color: #ffffff;\n"
            "}\n"
            "window.nautilus-window.csd:not(.maximized):not(.fullscreen),\n"
            "window.nautilus-window.background.csd:not(.maximized):not(.fullscreen) {\n"
            "    border-radius: 22px;\n"
            "    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.13);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light.csd:not(.maximized):not(.fullscreen) {\n"
            "    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window .content-pane,\n"
            "window.nautilus-window .content-pane > toolbarview,\n"
            "window.nautilus-window .content-pane .view,\n"
            "window.nautilus-window .content-pane > toolbarview > scrolledwindow,\n"
            "window.nautilus-window .content-pane > scrolledwindow {\n"
            "    background-color: #202020;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .content-pane,\n"
            "window.nautilus-window.mac-theme-light .content-pane > toolbarview,\n"
            "window.nautilus-window.mac-theme-light .content-pane .view,\n"
            "window.nautilus-window.mac-theme-light .content-pane > toolbarview > scrolledwindow,\n"
            "window.nautilus-window.mac-theme-light .content-pane > scrolledwindow {\n"
            "    background-color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane,\n"
            "window.nautilus-window overlay-split-view > .sidebar-pane,\n"
            "window.nautilus-window overlay-split-view > widget:first-child {\n"
            "    background-color: #262628;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    border-right: 1px solid rgba(0, 0, 0, 0.34);\n"
            "    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);\n"
            "    margin: 0px;\n"
            "    border-radius: 0px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane,\n"
            "window.nautilus-window.mac-theme-light overlay-split-view > .sidebar-pane,\n"
            "window.nautilus-window.mac-theme-light overlay-split-view > widget:first-child {\n"
            "    background-color: #f2f2f5;\n"
            "    border-right: 1px solid rgba(0, 0, 0, 0.07);\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane headerbar,\n"
            "window.nautilus-window .sidebar-pane placessidebar,\n"
            "window.nautilus-window .sidebar-pane placessidebar > scrolledwindow,\n"
            "window.nautilus-window .sidebar-pane placessidebar scrolledwindow viewport,\n"
            "window.nautilus-window .sidebar-pane .navigation-sidebar,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar {\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            /* === Headerbar Geometry: Raised Top Bar + High/Left Traffic Lights (Photo 7) === */
            "window.nautilus-window headerbar,\n"
            "window.nautilus-window .content-pane headerbar,\n"
            "window.nautilus-window .sidebar-pane headerbar,\n"
            "window.nautilus-window .nautilus-content-headerbar,\n"
            "window.nautilus-window .nautilus-sidebar-headerbar,\n"
            "window.nautilus-window toolbarview > .top-bar,\n"
            "window.nautilus-window .content-pane toolbarview > .top-bar,\n"
            "window.nautilus-window .sidebar-pane toolbarview > .top-bar {\n"
            "    min-height: 44px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar,\n"
            "window.nautilus-window toolbarview > .top-bar .collapse-spacing headerbar.nautilus-content-headerbar,\n"
            "window.nautilus-window .content-pane toolbarview > .top-bar .collapse-spacing headerbar.nautilus-content-headerbar,\n"
            "window.nautilus-window .content-pane headerbar {\n"
            "    min-height: 44px;\n"
            "    padding: 2px 6px 2px 4px;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane headerbar,\n"
            "window.nautilus-window headerbar.nautilus-sidebar-headerbar,\n"
            "window.nautilus-window .sidebar-pane toolbarview > .top-bar .collapse-spacing headerbar.nautilus-sidebar-headerbar {\n"
            "    min-height: 44px;\n"
            "    padding: 2px 6px 2px 0px;\n"
            "}\n"
            "window.nautilus-window toolbarview > .top-bar .collapse-spacing headerbar.nautilus-content-headerbar > windowhandle,\n"
            "window.nautilus-window toolbarview > .top-bar .collapse-spacing headerbar.nautilus-content-headerbar > windowhandle > box,\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar > windowhandle,\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar > windowhandle > box,\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar centerbox {\n"
            "    min-height: 40px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "}\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar > windowhandle > box > box.start {\n"
            "    margin-left: 0px;\n"
            "    padding-left: 0px;\n"
            "    border-spacing: 3px;\n"
            "}\n"
            "window.nautilus-window headerbar.nautilus-content-headerbar > windowhandle > box > box.end {\n"
            "    margin-right: 0px;\n"
            "    padding-right: 0px;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane toolbarview > .top-bar .collapse-spacing headerbar.nautilus-sidebar-headerbar > windowhandle,\n"
            "window.nautilus-window .sidebar-pane toolbarview > .top-bar .collapse-spacing headerbar.nautilus-sidebar-headerbar > windowhandle > box,\n"
            "window.nautilus-window headerbar.nautilus-sidebar-headerbar > windowhandle,\n"
            "window.nautilus-window headerbar.nautilus-sidebar-headerbar > windowhandle > box {\n"
            "    min-height: 40px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "}\n"
            "window.nautilus-window tabbar,\n"
            "window.nautilus-window .top-bar tabbar {\n"
            "    margin-top: 0px;\n"
            "}\n"
            /* === Global Traffic Lights Raised & Left (Photo 7) === */
            "window.nautilus-window .sidebar-pane headerbar windowcontrols,\n"
            "window.nautilus-window .nautilus-sidebar-headerbar windowcontrols,\n"
            "window.nautilus-window headerbar windowcontrols,\n"
            "window.nautilus-window windowcontrols {\n"
            "    margin: 0px;\n"
            "    padding-left: 11px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "}\n"
            /* === Static Plain Text Folder Title next to [ < | > ] (No hover / No menu) === */
            "window.nautilus-window label.mac-finder-title-label {\n"
            "    font-size: 14.5px;\n"
            "    font-weight: 700;\n"
            "    letter-spacing: -0.15px;\n"
            "    color: rgba(255, 255, 255, 0.94);\n"
            "    margin: 0 6px 0 8px;\n"
            "    padding: 0;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light label.mac-finder-title-label {\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            /* === Tahoe Liquid Glass Toolbar Pills & Circles (36px + Inset Back/Fwd Hover) === */
            "window.nautilus-window headerbar button,\n"
            "window.nautilus-window headerbar button:focus,\n"
            "window.nautilus-window headerbar button:focus-visible,\n"
            "window.nautilus-window headerbar splitbutton > button:focus,\n"
            "window.nautilus-window headerbar splitbutton > button:focus-visible,\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:focus,\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:focus-visible {\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window headerbar .mac-history-controls,\n"
            "window.nautilus-window headerbar NautilusHistoryControls,\n"
            "window.nautilus-window headerbar .history-controls,\n"
            "window.nautilus-window headerbar #history_controls,\n"
            "headerbar NautilusHistoryControls {\n"
            "    min-height: 36px;\n"
            "    padding: 0;\n"
            "    margin: 0 2px 0 -4px;\n"
            "}\n"
            "window.nautilus-window headerbar .mac-history-controls > box,\n"
            "window.nautilus-window headerbar .mac-history-controls .mac-history-capsule,\n"
            "window.nautilus-window headerbar NautilusHistoryControls > box,\n"
            "window.nautilus-window headerbar .history-controls > box,\n"
            "window.nautilus-window headerbar #history_controls > box,\n"
            "window.nautilus-window headerbar box.mac-pill-group {\n"
            "    min-height: 36px;\n"
            "    border-radius: 9999px;\n"
            "    padding: 0 2px;\n"
            "    margin: 0;\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.13) 0%, rgba(255, 255, 255, 0.095) 55%, rgba(255, 255, 255, 0.115) 100%);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.13);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(255, 255, 255, 0.07), 0 2px 6px rgba(0, 0, 0, 0.25);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar .mac-history-controls > box,\n"
            "window.nautilus-window.mac-theme-light headerbar .mac-history-capsule,\n"
            "window.nautilus-window.mac-theme-light headerbar box.mac-pill-group {\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(242, 242, 246, 0.85) 100%);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.09);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 4px rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window headerbar separator.mac-history-divider {\n"
            "    min-width: 1px;\n"
            "    min-height: 16px;\n"
            "    margin: 10px 0;\n"
            "    padding: 0;\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    border: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar separator.mac-history-divider {\n"
            "    background-color: rgba(0, 0, 0, 0.10);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button,\n"
            "window.nautilus-window headerbar #history_controls button {\n"
            "    min-width: 28px;\n"
            "    min-height: 28px;\n"
            "    padding: 0;\n"
            "    margin: 3px 2px;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "    transition: background-color 120ms ease, color 120ms ease;\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn {\n"
            "    min-width: 34px;\n"
            "    min-height: 36px;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button image,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button image {\n"
            "    -gtk-icon-size: 16px;\n"
            "    min-width: 16px;\n"
            "    min-height: 16px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-history-button,\n"
            "window.nautilus-window.mac-theme-light headerbar NautilusHistoryControls button,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-pill-inner-btn {\n"
            "    color: rgba(0, 0, 0, 0.85);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button:hover,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:hover,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.13);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button:active,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:active,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn:active {\n"
            "    background-color: rgba(255, 255, 255, 0.22);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button:disabled,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:disabled,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn:disabled,\n"
            "window.nautilus-window headerbar button.mac-circle-button:disabled,\n"
            "window.nautilus-window headerbar button.mac-history-button:disabled image,\n"
            "window.nautilus-window headerbar button.mac-history-button:disabled image:disabled,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:disabled image,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:disabled image:disabled,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn:disabled image,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn:disabled image:disabled,\n"
            "window.nautilus-window headerbar button.mac-circle-button:disabled image,\n"
            "window.nautilus-window headerbar button.mac-circle-button:disabled image:disabled {\n"
            "    opacity: 1.0;\n"
            "    color: rgba(255, 255, 255, 0.44);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-history-button:disabled,\n"
            "window.nautilus-window.mac-theme-light headerbar NautilusHistoryControls button:disabled,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-pill-inner-btn:disabled,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:disabled,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-history-button:disabled image,\n"
            "window.nautilus-window.mac-theme-light headerbar NautilusHistoryControls button:disabled image,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-pill-inner-btn:disabled image,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:disabled image {\n"
            "    opacity: 1.0;\n"
            "    color: rgba(0, 0, 0, 0.36);\n"
            "}\n"

            /* === Right Toolbar Container, Circles (36x36) & Pills === */
            "window.nautilus-window headerbar box.mac-end-toolbar {\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window headerbar box.mac-end-toolbar > menubutton,\n"
            "window.nautilus-window headerbar box.mac-end-toolbar > button {\n"
            "    opacity: 1;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-circle-button,\n"
            "window.nautilus-window headerbar button.mac-search-button,\n"
            "window.nautilus-window headerbar menubutton.mac-circle-button > button,\n"
            "window.nautilus-window headerbar menubutton.mac-more-button > button,\n"
            "window.nautilus-window headerbar menubutton.mac-sort-pill > button {\n"
            "    min-width: 36px;\n"
            "    min-height: 36px;\n"
            "    border-radius: 9999px;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.13) 0%, rgba(255, 255, 255, 0.095) 55%, rgba(255, 255, 255, 0.115) 100%);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.13);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(255, 255, 255, 0.07), 0 2px 6px rgba(0, 0, 0, 0.25);\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-circle-button image,\n"
            "window.nautilus-window headerbar button.mac-search-button image,\n"
            "window.nautilus-window headerbar button.mac-pill-inner-btn image,\n"
            "window.nautilus-window headerbar menubutton.mac-more-button > button image {\n"
            "    -gtk-icon-size: 18px;\n"
            "    min-width: 18px;\n"
            "    min-height: 18px;\n"
            "}\n"
            "window.nautilus-window headerbar menubutton.mac-sort-pill > button {\n"
            "    min-width: 56px;\n"
            "    padding: 0 10px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-search-button,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-circle-button > button,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-more-button > button,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-sort-pill > button {\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(242, 242, 246, 0.85) 100%);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.09);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 4px rgba(0, 0, 0, 0.08);\n"
            "    color: rgba(0, 0, 0, 0.85);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:not(:disabled) image,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-search-button image,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-pill-inner-btn:not(:disabled) image,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-circle-button > button image,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-more-button > button image,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-sort-pill > button image {\n"
            "    color: rgba(0, 0, 0, 0.85);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-circle-button:hover,\n"
            "window.nautilus-window headerbar button.mac-search-button:hover,\n"
            "window.nautilus-window headerbar menubutton.mac-circle-button > button:hover,\n"
            "window.nautilus-window headerbar menubutton.mac-more-button > button:hover,\n"
            "window.nautilus-window headerbar menubutton.mac-sort-pill > button:hover {\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.19) 0%, rgba(255, 255, 255, 0.15) 100%);\n"
            "    border-color: rgba(255, 255, 255, 0.20);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:hover,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-search-button:hover,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-circle-button > button:hover,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-more-button > button:hover,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-sort-pill > button:hover {\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(238, 238, 243, 0.95) 100%);\n"
            "    border-color: rgba(0, 0, 0, 0.13);\n"
            "    color: #000000;\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-circle-button:active,\n"
            "window.nautilus-window headerbar button.mac-circle-button:checked,\n"
            "window.nautilus-window headerbar button.mac-search-button:active,\n"
            "window.nautilus-window headerbar button.mac-search-button:checked,\n"
            "window.nautilus-window headerbar menubutton.mac-circle-button > button:active,\n"
            "window.nautilus-window headerbar menubutton.mac-circle-button > button:checked,\n"
            "window.nautilus-window headerbar menubutton.mac-more-button > button:checked,\n"
            "window.nautilus-window headerbar menubutton.mac-sort-pill > button:checked {\n"
            "    background: rgba(255, 255, 255, 0.24);\n"
            "    border-color: rgba(255, 255, 255, 0.24);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:active,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-circle-button:checked,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-search-button:active,\n"
            "window.nautilus-window.mac-theme-light headerbar button.mac-search-button:checked,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-circle-button > button:active,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-circle-button > button:checked,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-more-button > button:checked,\n"
            "window.nautilus-window.mac-theme-light headerbar menubutton.mac-sort-pill > button:checked {\n"
            "    background: rgba(0, 0, 0, 0.10);\n"
            "    border-color: rgba(0, 0, 0, 0.14);\n"
            "    color: #000000;\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-circle-button:disabled {\n"
            "    opacity: 1.0;\n"
            "}\n"
            /* === NautilusViewControls ([ ⊞ ⌄ ] Pill) === */
            "window.nautilus-window headerbar splitbutton,\n"
            "window.nautilus-window headerbar NautilusViewControls splitbutton,\n"
            "window.nautilus-window headerbar #view_split_button {\n"
            "    border-radius: 9999px;\n"
            "    min-height: 36px;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.13) 0%, rgba(255, 255, 255, 0.095) 55%, rgba(255, 255, 255, 0.115) 100%);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.13);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(255, 255, 255, 0.07), 0 2px 6px rgba(0, 0, 0, 0.25);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar splitbutton,\n"
            "window.nautilus-window.mac-theme-light headerbar NautilusViewControls splitbutton,\n"
            "window.nautilus-window.mac-theme-light headerbar #view_split_button {\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(242, 242, 246, 0.85) 100%);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.09);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 4px rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > separator {\n"
            "    min-width: 0px;\n"
            "    min-height: 0px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    opacity: 0;\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button {\n"
            "    min-width: 28px;\n"
            "    min-height: 36px;\n"
            "    padding: 0 3px 0 10px;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    background: transparent;\n"
            "    border-top-left-radius: 9999px;\n"
            "    border-bottom-left-radius: 9999px;\n"
            "    border-top-right-radius: 0;\n"
            "    border-bottom-right-radius: 0;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.94);\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button image {\n"
            "    -gtk-icon-size: 18px;\n"
            "    min-width: 18px;\n"
            "    min-height: 18px;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > menubutton {\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button {\n"
            "    min-width: 20px;\n"
            "    min-height: 36px;\n"
            "    padding: 0 8px 0 2px;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    background: transparent;\n"
            "    border-top-right-radius: 9999px;\n"
            "    border-bottom-right-radius: 9999px;\n"
            "    border-top-left-radius: 0;\n"
            "    border-bottom-left-radius: 0;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light headerbar splitbutton > button,\n"
            "window.nautilus-window.mac-theme-light headerbar splitbutton > menubutton > button {\n"
            "    color: rgba(0, 0, 0, 0.85);\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button:hover,\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "}\n"
            /* === Inline PathBar / Location / Search === */
            "window.nautilus-window .nautilus-pathbar,\n"
            "window.nautilus-window #NautilusPathBar,\n"
            "window.nautilus-window .mac-pathbar {\n"
            "    min-height: 30px;\n"
            "    padding: 0 6px;\n"
            "    margin: 0 6px;\n"
            "    border-radius: 9999px;\n"
            "    background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.085) 100%);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.13);\n"
            "    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > scrolledwindow,\n"
            "window.nautilus-window .nautilus-pathbar > scrolledwindow > viewport {\n"
            "    background: transparent;\n"
            "    min-height: 26px;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-path-button,\n"
            "window.nautilus-window .nautilus-pathbar > menubutton > button {\n"
            "    min-height: 24px;\n"
            "    padding: 0 7px;\n"
            "    margin: 0 1px;\n"
            "    font-size: 13px;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "}\n"
            "window.nautilus-window .nautilus-path-button:hover,\n"
            "window.nautilus-window .nautilus-pathbar > menubutton > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "}\n"
            "window.nautilus-window headerbar entry,\n"
            "window.nautilus-window headerbar searchentry,\n"
            "window.nautilus-window headerbar .nautilus-query-editor {\n"
            "    min-width: 0px;\n"
            "    min-height: 34px;\n"
            "    border-radius: 9999px;\n"
            "    padding: 0 10px;\n"
            "    background-color: rgba(255, 255, 255, 0.10);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.15);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar .nautilus-query-editor {\n"
            "    background-color: transparent;\n"
            "    border: none;\n"
            "    padding: 0 6px 0 2px;\n"
            "}\n"
            /* === Compact Context Menus & Popovers (Proper Margins + Inline Zoom + Animations) === */
            "window.nautilus-window popover > contents,\n"
            "window.nautilus-window popover.menu > contents,\n"
            "window.nautilus-window popover.menu contents,\n"
            "window.nautilus-window popover.context-menu > contents,\n"
            "window.nautilus-window popover.mac-finder-menu > contents {\n"
            "    border-radius: 19px;\n"
            "    padding: 7px 7px;\n"
            "}\n"
            "window.nautilus-window popover.menu box {\n"
            "    border-spacing: 2px;\n"
            "}\n"
            "window.nautilus-window popover.menu label.title {\n"
            "    font-size: 12px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.88);\n"
            "    padding: 3px 8px 3px 10px;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover.menu label.title {\n"
            "    color: rgba(0, 0, 0, 0.82);\n"
            "}\n"
            "window.nautilus-window popover.menu box.mac-inline-zoom-row {\n"
            "    padding: 2px 3px 2px 10px;\n"
            "    margin: 0px 2px;\n"
            "}\n"
            "window.nautilus-window popover.menu label.mac-inline-zoom-label {\n"
            "    font-size: 12.5px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "    padding: 0px;\n"
            "    margin: 0px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover.menu label.mac-inline-zoom-label {\n"
            "    color: rgba(0, 0, 0, 0.86);\n"
            "}\n"
            "window.nautilus-window popover separator,\n"
            "window.nautilus-window popover.menu separator {\n"
            "    margin: 4px 10px;\n"
            "    min-height: 1px;\n"
            "    background-color: rgba(255, 255, 255, 0.11);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover separator,\n"
            "window.nautilus-window.mac-theme-light popover.menu separator {\n"
            "    background-color: rgba(0, 0, 0, 0.09);\n"
            "}\n"
            "window.nautilus-window popover button.mac-finder-pop-row,\n"
            "window.nautilus-window popover.menu modelbutton,\n"
            "window.nautilus-window popover modelbutton {\n"
            "    min-height: 24px;\n"
            "    padding: 3px 10px;\n"
            "    margin: 1px 2px;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "    font-size: 12.5px;\n"
            "    font-weight: 500;\n"
            "    transition: background-color 140ms cubic-bezier(0.25, 0.1, 0.25, 1.0), color 100ms ease, box-shadow 140ms cubic-bezier(0.25, 0.1, 0.25, 1.0), transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);\n"
            "}\n"
            "window.nautilus-window popover.menu modelbutton > box,\n"
            "window.nautilus-window popover modelbutton > box {\n"
            "    border-spacing: 6px;\n"
            "}\n"
            "window.nautilus-window popover.menu accelerator,\n"
            "window.nautilus-window popover accelerator {\n"
            "    margin-left: 18px;\n"
            "    margin-right: 0;\n"
            "    font-size: 11.5px;\n"
            "    color: rgba(255, 255, 255, 0.54);\n"
            "}\n"
            "window.nautilus-window popover.menu modelbutton:hover accelerator,\n"
            "window.nautilus-window popover modelbutton:hover accelerator {\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover.menu accelerator {\n"
            "    color: rgba(0, 0, 0, 0.45);\n"
            "}\n"
            "window.nautilus-window popover.menu arrow.left,\n"
            "window.nautilus-window popover.menu radio.left,\n"
            "window.nautilus-window popover.menu check.left {\n"
            "    margin-left: 0px;\n"
            "    margin-right: 8px;\n"
            "    min-width: 14px;\n"
            "    min-height: 14px;\n"
            "}\n"
            "window.nautilus-window popover button.mac-finder-pop-row:hover,\n"
            "window.nautilus-window popover button.mac-finder-pop-row:focus-visible,\n"
            "window.nautilus-window popover.menu modelbutton:hover,\n"
            "window.nautilus-window popover.menu modelbutton:focus-visible,\n"
            "window.nautilus-window popover modelbutton:hover,\n"
            "window.nautilus-window popover modelbutton:focus-visible {\n"
            "    background-color: @accent_bg_color;\n"
            "    background: @accent_bg_color;\n"
            "    color: #ffffff;\n"
            "    border-radius: 9999px;\n"
            "    box-shadow: 0 1px 4px alpha(@accent_bg_color, 0.38);\n"
            "}\n"
            "window.nautilus-window popover button.mac-finder-pop-row:active,\n"
            "window.nautilus-window popover.menu modelbutton:active,\n"
            "window.nautilus-window popover modelbutton:active {\n"
            "    transform: scale(0.965);\n"
            "    transition-duration: 85ms;\n"
            "}\n"
            "window.nautilus-window popover button.mac-finder-pop-row:selected:not(:hover):not(:focus-visible),\n"
            "window.nautilus-window popover button.mac-finder-pop-row:focus:not(:hover):not(:focus-visible),\n"
            "window.nautilus-window popover.menu modelbutton:selected:not(:hover):not(:focus-visible),\n"
            "window.nautilus-window popover.menu modelbutton:focus:not(:hover):not(:focus-visible) {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window popover.menu box.inline-buttons,\n"
            "window.nautilus-window popover box.mac-inline-zoom-box {\n"
            "    padding: 1px 2px;\n"
            "    margin: 0px;\n"
            "    border-spacing: 5px;\n"
            "}\n"
            "window.nautilus-window popover.menu box.inline-buttons button,\n"
            "window.nautilus-window popover.menu box.inline-buttons button.flat,\n"
            "window.nautilus-window popover.menu box.inline-buttons button.image-button.model,\n"
            "window.nautilus-window popover button.mac-finder-pop-mini-btn {\n"
            "    min-width: 28px;\n"
            "    min-height: 24px;\n"
            "    padding: 2px 8px;\n"
            "    margin: 0px;\n"
            "    border-radius: 9999px;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    background-color: rgba(255, 255, 255, 0.10);\n"
            "    color: rgba(255, 255, 255, 0.94);\n"
            "    transition: background-color 130ms ease, transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);\n"
            "}\n"
            "window.nautilus-window popover.menu box.inline-buttons button:hover,\n"
            "window.nautilus-window popover button.mac-finder-pop-mini-btn:hover {\n"
            "    background-color: @accent_bg_color;\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window popover.menu box.inline-buttons button:active,\n"
            "window.nautilus-window popover button.mac-finder-pop-mini-btn:active {\n"
            "    transform: scale(0.95);\n"
            "}\n"
            "window.nautilus-window popover box.mac-finder-pop-static-row {\n"
            "    min-height: 26px;\n"
            "    padding: 2px 3px 2px 12px;\n"
            "    margin: 1.5px 2px;\n"
            "    font-size: 12.5px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover button.mac-finder-pop-row,\n"
            "window.nautilus-window.mac-theme-light popover.menu modelbutton,\n"
            "window.nautilus-window.mac-theme-light popover box.mac-finder-pop-static-row {\n"
            "    color: rgba(0, 0, 0, 0.86);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover.menu box.inline-buttons button,\n"
            "window.nautilus-window.mac-theme-light popover.menu box.inline-buttons button.flat,\n"
            "window.nautilus-window.mac-theme-light popover button.mac-finder-pop-mini-btn {\n"
            "    background-color: rgba(0, 0, 0, 0.08);\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light popover button.mac-finder-pop-row:hover,\n"
            "window.nautilus-window.mac-theme-light popover.menu modelbutton:hover {\n"
            "    color: #ffffff;\n"
            "}\n"
            /* === Sidebar Rows, Orange Favorites Icons & Flat Solid Pill Highlight (Zero Borders/Gloss) === */
            "window.nautilus-window .sidebar-pane placessidebar,\n"
            "window.nautilus-window .sidebar-pane placessidebar > scrolledwindow,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar {\n"
            "    padding: 2px 0 10px 0;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row,\n"
            "window.nautilus-window .sidebar-pane row.sidebar-row,\n"
            "window.nautilus-window placessidebar row {\n"
            "    min-height: 28px;\n"
            "    padding: 1px 10px;\n"
            "    margin: 1px 10px;\n"
            "    border-radius: 10px;\n"
            "    border: none;\n"
            "    font-size: 13px;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane list.navigation-sidebar row,\n"
            "window.nautilus-window.mac-theme-light placessidebar row {\n"
            "    color: rgba(0, 0, 0, 0.86);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:hover,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:hover,\n"
            "window.nautilus-window placessidebar row:hover {\n"
            "    border-radius: 10px;\n"
            "    background-color: #2f2f31;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row:hover,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane list.navigation-sidebar row:hover {\n"
            "    background-color: #e6e6ea;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected,\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected:backdrop,\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected:focus,\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected:focus-within,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected:backdrop,\n"
            "window.nautilus-window placessidebar row:selected,\n"
            "window.nautilus-window placessidebar row:selected:backdrop {\n"
            "    border-radius: 10px;\n"
            "    background-color: #363638;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row:selected,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row:selected:backdrop,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane list.navigation-sidebar row:selected,\n"
            "window.nautilus-window.mac-theme-light placessidebar row:selected {\n"
            "    background-color: #dcdce0;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "    color: #000000;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected:hover,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected:hover {\n"
            "    background-color: #3e3e41;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row:selected:hover,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane list.navigation-sidebar row:selected:hover {\n"
            "    background-color: #d2d2d7;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row *,\n"
            "window.nautilus-window .sidebar-pane row:selected *,\n"
            "window.nautilus-window placessidebar row:selected * {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    box-shadow: none;\n"
            "    border: none;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane label.mac-sidebar-header {\n"
            "    font-size: 11.5px;\n"
            "    font-weight: 600;\n"
            "    color: rgba(255, 255, 255, 0.44);\n"
            "    padding: 10px 10px 3px 16px;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane label.mac-sidebar-header {\n"
            "    color: rgba(0, 0, 0, 0.45);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row image {\n"
            "    min-width: 17px;\n"
            "    min-height: 17px;\n"
            "    -gtk-icon-size: 17px;\n"
            "    margin: 0 8px 0 2px;\n"
            "    padding: 0;\n"
            "    color: rgba(255, 255, 255, 0.72);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row image.sidebar-orange-icon,\n"
            "window.nautilus-window .sidebar-pane row:selected image.sidebar-orange-icon,\n"
            "window.nautilus-window placessidebar row image.sidebar-orange-icon,\n"
            "window.nautilus-window placessidebar row:selected image.sidebar-orange-icon {\n"
            "    color: #f28617;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row image.sidebar-neutral-icon {\n"
            "    color: rgba(255, 255, 255, 0.65);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane row image.sidebar-neutral-icon {\n"
            "    color: rgba(0, 0, 0, 0.58);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row:selected image.sidebar-neutral-icon {\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane row:selected image.sidebar-neutral-icon {\n"
            "    color: #000000;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row label,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row label,\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected label,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected label,\n"
            "window.nautilus-window placessidebar row:selected label {\n"
            "    font-size: 13px;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected label,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected label,\n"
            "window.nautilus-window placessidebar row:selected label {\n"
            "    color: #ffffff;\n"
            "    font-weight: 500;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane placessidebar row label,\n"
            "window.nautilus-window.mac-theme-light .sidebar-pane list.navigation-sidebar row label,\n"
            "window.nautilus-window.mac-theme-light placessidebar row:selected label {\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            /* === Clean Eject Glyph in Sidebar (NO circular badge unless hovered) === */
            "window.nautilus-window .sidebar-pane placessidebar row button.sidebar-button,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button#eject_button,\n"
            "window.nautilus-window .sidebar-pane row button.sidebar-button,\n"
            "window.nautilus-window placessidebar row button.sidebar-button,\n"
            "window.nautilus-window placessidebar row button {\n"
            "    min-width: 20px;\n"
            "    min-height: 20px;\n"
            "    padding: 0;\n"
            "    margin: 0 2px 0 0;\n"
            "    border-radius: 9999px;\n"
            "    border: none;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row button.sidebar-button:hover,\n"
            "window.nautilus-window placessidebar row button.sidebar-button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.14);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row button.sidebar-button image,\n"
            "window.nautilus-window placessidebar row button.sidebar-button image,\n"
            "window.nautilus-window image.mac-eject-icon {\n"
            "    min-width: 12px;\n"
            "    min-height: 12px;\n"
            "    -gtk-icon-size: 12px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    color: rgba(255, 255, 255, 0.55);\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light image.mac-eject-icon {\n"
            "    color: rgba(0, 0, 0, 0.45);\n"
            "}\n"
            /* === Grid View & Finder List View Overhaul (Photo 4 1:1 Zebra Pills + Vertical Dividers) === */
            "window.nautilus-window .nautilus-grid-view gridview {\n"
            "    padding: 10px 24px 72px 24px;\n"
            "    border-spacing: 10px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-grid-view,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view,\n"
            "window.nautilus-window.mac-theme-light .nautilus-grid-view label,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view row:not(:selected) label {\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview {\n"
            "    padding-left: 16px;\n"
            "    padding-right: 16px;\n"
            "    background: transparent;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > header,\n"
            "window.nautilus-window .nautilus-list-view columnview > header.activatable,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header.activatable {\n"
            "    min-height: 28px;\n"
            "    margin: 0 0 4px 0;\n"
            "    padding: 0;\n"
            "    background: none;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    border-radius: 0px;\n"
            "    border-bottom: 1px solid rgba(255, 255, 255, 0.085);\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > header {\n"
            "    border-bottom-color: rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > header > button,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header > button,\n"
            "window.nautilus-window .nautilus-list-view columnview > header > button:last-child {\n"
            "    min-height: 26px;\n"
            "    padding: 2px 10px;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    border-style: none;\n"
            "    border-image: none;\n"
            "    border-radius: 0;\n"
            "    background: none;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "    font-size: 12px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.56);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > header > button,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview.view > header > button,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > header > button:last-child {\n"
            "    color: rgba(0, 0, 0, 0.52);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > header > button:first-child,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header > button:first-child {\n"
            "    padding-left: 12px;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > header > button:not(:last-child),\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header > button:not(:last-child) {\n"
            "    background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.14));\n"
            "    background-size: 1px 14px;\n"
            "    background-position: right center;\n"
            "    background-repeat: no-repeat;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > header > button:not(:last-child),\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview.view > header > button:not(:last-child) {\n"
            "    background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.12));\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > header > button:hover,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > header > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.04);\n"
            "    color: rgba(255, 255, 255, 0.85);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > header > button:hover,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview.view > header > button:hover {\n"
            "    background-color: rgba(0, 0, 0, 0.035);\n"
            "    color: rgba(0, 0, 0, 0.85);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview {\n"
            "    margin-left: -16px;\n"
            "    margin-right: -16px;\n"
            "    padding-top: 4px;\n"
            "    padding-bottom: 68px;\n"
            "    border-spacing: 0px;\n"
            "    background: transparent;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > listview > row,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:focus,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:focus:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > listview > row:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view columnview.view > listview > row:focus:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:focus,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:focus:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row > cell,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row > cell:focus,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row > cell:focus-visible,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row > cell:focus:focus-visible {\n"
            "    outline: 0px none transparent;\n"
            "    outline-style: none;\n"
            "    outline-width: 0px;\n"
            "    outline-color: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable {\n"
            "    margin: 0 16px;\n"
            "    padding: 0 4px;\n"
            "    min-height: 28px;\n"
            "    border-radius: 7px;\n"
            "    border: none;\n"
            "    background-image: none;\n"
            "    background-color: transparent;\n"
            "    transition: background-color 110ms ease;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:nth-child(odd):not(:selected),\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:nth-child(odd):not(:disabled):not(:selected) {\n"
            "    background-image: none;\n"
            "    background-color: rgba(255, 255, 255, 0.048);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:nth-child(odd):not(:selected),\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view listview.view > row.activatable:nth-child(odd):not(:disabled):not(:selected) {\n"
            "    background-image: none;\n"
            "    background-color: rgba(0, 0, 0, 0.038);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:nth-child(even):not(:selected),\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:nth-child(even):not(:selected) {\n"
            "    background-image: none;\n"
            "    background-color: transparent;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:hover:not(:selected),\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:hover:not(:selected) {\n"
            "    background-color: rgba(255, 255, 255, 0.088);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:hover:not(:selected),\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view listview.view > row.activatable:hover:not(:selected) {\n"
            "    background-color: rgba(0, 0, 0, 0.065);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected:hover,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:selected,\n"
            "window.nautilus-window .nautilus-list-view listview.view > row.activatable:selected:hover {\n"
            "    background-color: @accent_bg_color;\n"
            "    color: @accent_fg_color;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected label,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected cell label,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected cell label.dim-label,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:selected label,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:selected cell label,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:selected cell label.dim-label {\n"
            "    color: #ffffff;\n"
            "    opacity: 1.0;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:selected button.star,\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row:selected button.star {\n"
            "    color: #ffffff;\n"
            "    opacity: 0.85;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view .nautilus-view-cell {\n"
            "    padding: 3px 8px;\n"
            "    min-height: 24px;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row > cell:not(:first-child) label {\n"
            "    color: rgba(255, 255, 255, 0.56);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .nautilus-list-view columnview > listview > row > cell:not(:first-child) label {\n"
            "    color: rgba(0, 0, 0, 0.52);\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row:not(:hover):not(:selected) button.star:not(.starred),\n"
            "window.nautilus-window .nautilus-list-view listview.view > row:not(:hover):not(:selected) button.star:not(.starred) {\n"
            "    opacity: 0;\n"
            "}\n"
            "window.nautilus-window .nautilus-list-view button.star,\n"
            "window.nautilus-window .nautilus-list-view button.star:hover,\n"
            "window.nautilus-window .nautilus-list-view button.star:active,\n"
            "window.nautilus-window .nautilus-list-view columnview > listview > row button.star {\n"
            "    min-width: 22px;\n"
            "    min-height: 22px;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    border-radius: 9999px;\n"
            "    box-shadow: none;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    transition: opacity 120ms ease;\n"
            "}\n"
            "window.nautilus-window .content-pane scrolledwindow undershoot.bottom,\n"
            "window.nautilus-window .content-pane scrolledwindow > undershoot.bottom {\n"
            "    min-height: 0px;\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window .floating-bar,\n"
            "window.nautilus-window floatingbar {\n"
            "    opacity: 0;\n"
            "    min-width: 0px;\n"
            "    min-height: 0px;\n"
            "    margin: 0px;\n"
            "    padding: 0px;\n"
            "}\n"
            /* === Bottom Blurred Path Bar + Short File Info Status Bar (macOS Reference 1:1) === */
            "window.nautilus-window box.mac-bottom-blur-bar {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    border-top: 1px solid rgba(255, 255, 255, 0.11);\n"
            "    border-bottom-right-radius: 22px;\n"
            "    box-shadow: none;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light box.mac-bottom-blur-bar {\n"
            "    border-top: 1px solid rgba(0, 0, 0, 0.10);\n"
            "}\n"
            "window.nautilus-window box.mac-bottom-path-row,\n"
            "window.nautilus-window box.mac-bottom-entry-row {\n"
            "    min-height: 27px;\n"
            "    padding: 1px 10px;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window entry.mac-bottom-path-entry {\n"
            "    min-height: 23px;\n"
            "    padding: 0 10px;\n"
            "    margin: 1px 2px;\n"
            "    border-radius: 9999px;\n"
            "    background-color: rgba(255, 255, 255, 0.10);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.18);\n"
            "    box-shadow: none;\n"
            "    font-size: 12px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.94);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light entry.mac-bottom-path-entry {\n"
            "    background-color: rgba(255, 255, 255, 0.82);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.15);\n"
            "    color: rgba(0, 0, 0, 0.90);\n"
            "}\n"
            "window.nautilus-window entry.mac-bottom-path-entry:focus-within {\n"
            "    border-color: @accent_bg_color;\n"
            "}\n"
            "window.nautilus-window scrolledwindow.mac-bottom-path-scroll,\n"
            "window.nautilus-window scrolledwindow.mac-bottom-path-scroll > viewport {\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    min-height: 26px;\n"
            "}\n"
            "window.nautilus-window .mac-bottom-crumb {\n"
            "    min-height: 22px;\n"
            "    padding: 1px 5px;\n"
            "    margin: 0;\n"
            "    border-radius: 6px;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    font-size: 12px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.72);\n"
            "    transition: background-color 120ms ease, color 120ms ease;\n"
            "}\n"
            "window.nautilus-window button.mac-bottom-crumb:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.10);\n"
            "    color: rgba(255, 255, 255, 0.96);\n"
            "}\n"
            "window.nautilus-window .mac-bottom-crumb-selected {\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "    font-weight: 600;\n"
            "}\n"
            "window.nautilus-window image.mac-bottom-crumb-sep {\n"
            "    color: rgba(255, 255, 255, 0.34);\n"
            "    margin: 0 2px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .mac-bottom-crumb {\n"
            "    color: rgba(0, 0, 0, 0.66);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light button.mac-bottom-crumb:hover {\n"
            "    background-color: rgba(0, 0, 0, 0.06);\n"
            "    color: rgba(0, 0, 0, 0.92);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .mac-bottom-crumb-selected {\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light image.mac-bottom-crumb-sep {\n"
            "    color: rgba(0, 0, 0, 0.30);\n"
            "}\n"
            "window.nautilus-window separator.mac-bottom-divider {\n"
            "    min-height: 1px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    background-color: rgba(255, 255, 255, 0.085);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light separator.mac-bottom-divider {\n"
            "    background-color: rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window box.mac-bottom-info-row {\n"
            "    min-height: 24px;\n"
            "    padding: 1px 14px 3px 14px;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window label.mac-bottom-info-name {\n"
            "    font-size: 11.5px;\n"
            "    font-weight: 600;\n"
            "    color: rgba(255, 255, 255, 0.86);\n"
            "}\n"
            "window.nautilus-window label.mac-bottom-info-meta {\n"
            "    font-size: 11.5px;\n"
            "    font-weight: 500;\n"
            "    color: rgba(255, 255, 255, 0.62);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light label.mac-bottom-info-name {\n"
            "    color: rgba(0, 0, 0, 0.82);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light label.mac-bottom-info-meta {\n"
            "    color: rgba(0, 0, 0, 0.56);\n"
            "}\n"
            "window.nautilus-window .view .thumbnail,\n"
            "window.nautilus-window .nautilus-grid-view .thumbnail,\n"
            "window.nautilus-window .nautilus-list-view .thumbnail,\n"
            "window.nautilus-window gridview > child .thumbnail,\n"
            "window.nautilus-window columnview > listview > row .thumbnail,\n"
            ".nautilus-grid-view .thumbnail,\n"
            ".nautilus-list-view .thumbnail,\n"
            ".view .thumbnail {\n"
            "    background: none;\n"
            "    background-image: none;\n"
            "    background-color: transparent;\n"
            "    border-radius: 6px;\n"
            "    border: none;\n"
            "    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.11);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .view .thumbnail,\n"
            "window.nautilus-window.mac-theme-light .nautilus-grid-view .thumbnail {\n"
            "    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected,\n"
            "window.nautilus-window gridview > child:selected,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected:hover,\n"
            "window.nautilus-window gridview > child:selected:hover,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:hover,\n"
            "window.nautilus-window gridview > child:hover {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "    border: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child .icon-ui-labels-box,\n"
            "window.nautilus-window gridview > child .icon-ui-labels-box {\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child .icon-ui-labels-box #label,\n"
            "window.nautilus-window gridview > child .icon-ui-labels-box #label,\n"
            "window.nautilus-window gridview > child:selected .icon-ui-labels-box #label {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    color: rgba(255, 255, 255, 0.92);\n"
            "    font-size: 12.5px;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    border-radius: 0px;\n"
            "    padding: 4px 6px;\n"
            "    margin: 1px 2px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light gridview > child .icon-ui-labels-box #label {\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light gridview > child:selected .icon-ui-labels-box #label {\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected label.caption,\n"
            "window.nautilus-window gridview > child:selected label.caption {\n"
            "    color: rgba(255, 255, 255, 0.70);\n"
            "}\n"
            /* === Undershoot Soft Dissolve Matching #202020 === */
            "window.nautilus-window .content-pane scrolledwindow undershoot.top,\n"
            "window.nautilus-window .content-pane scrolledwindow > undershoot.top {\n"
            "    min-height: 24px;\n"
            "    background: linear-gradient(to bottom, #202020 0%, rgba(32, 32, 32, 0.65) 45%, transparent 100%);\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light .content-pane scrolledwindow undershoot.top {\n"
            "    background: linear-gradient(to bottom, #ffffff 0%, rgba(255, 255, 255, 0.65) 45%, transparent 100%);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane scrolledwindow undershoot.top,\n"
            "window.nautilus-window .sidebar-pane scrolledwindow > undershoot.top {\n"
            "    min-height: 20px;\n"
            "    background: linear-gradient(to bottom, #262628 0%, rgba(38, 38, 40, 0.60) 50%, transparent 100%);\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane scrolledwindow undershoot.bottom,\n"
            "window.nautilus-window .sidebar-pane scrolledwindow > undershoot.bottom {\n"
            "    min-height: 16px;\n"
            "    background: linear-gradient(to top, #262628 0%, rgba(38, 38, 40, 0.60) 50%, transparent 100%);\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            /* === Floating Capsule Banner (Trash Bar) === */
            "window.nautilus-window banner,\n"
            "window.nautilus-window adwbanner,\n"
            "window.nautilus-window infobar,\n"
            "window.nautilus-window banner > revealer,\n"
            "window.nautilus-window adwbanner > revealer,\n"
            "window.nautilus-window infobar > revealer {\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    margin: 0px;\n"
            "    padding: 0px;\n"
            "}\n"
            "window.nautilus-window banner > revealer > widget,\n"
            "window.nautilus-window banner > revealer > box,\n"
            "window.nautilus-window adwbanner > revealer > widget,\n"
            "window.nautilus-window adwbanner > revealer > box,\n"
            "window.nautilus-window infobar > revealer > widget,\n"
            "window.nautilus-window infobar > revealer > box {\n"
            "    border-radius: 9999px;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.12);\n"
            "    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);\n"
            "    padding: 4px 16px;\n"
            "    margin: 6px 16px 8px 16px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light banner > revealer > widget,\n"
            "window.nautilus-window.mac-theme-light banner > revealer > box,\n"
            "window.nautilus-window.mac-theme-light adwbanner > revealer > widget,\n"
            "window.nautilus-window.mac-theme-light adwbanner > revealer > box {\n"
            "    background-color: rgba(0, 0, 0, 0.06);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.08);\n"
            "}\n"
            "window.nautilus-window banner button,\n"
            "window.nautilus-window adwbanner button,\n"
            "window.nautilus-window infobar button {\n"
            "    border-radius: 9999px;\n"
            "    min-height: 24px;\n"
            "    padding: 2px 14px;\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.14);\n"
            "    color: #ffffff;\n"
            "    margin-right: -8px;\n"
            "}\n";
        gtk_css_provider_load_from_string(provider, custom_css);
        gtk_style_context_add_provider_for_display(
            gdk_display_get_default(),
            GTK_STYLE_PROVIDER(provider),
            GTK_STYLE_PROVIDER_PRIORITY_USER + 500);
        g_object_unref(provider);
    }

    if (g_object_get_data(G_OBJECT(window), "mac_headerbars_reorganized")) {
        return G_SOURCE_REMOVE;
    }

    if (!split_view) {
        return G_SOURCE_REMOVE;
    }

    adw_overlay_split_view_set_min_sidebar_width(split_view, 215.0);
    adw_overlay_split_view_set_max_sidebar_width(split_view, 260.0);
    adw_overlay_split_view_set_sidebar_width_fraction(split_view, 0.23);

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

        MacNautilusCtx *ctx = g_new0(MacNautilusCtx, 1);
        ctx->window = GTK_WIDGET(window);
        ctx->split_view = split_view;
        ctx->sidebar_hb = sidebar_hb;
        ctx->content_hb = content_hb;
        g_object_set_data_full(G_OBJECT(window), "mac_nautilus_ctx", ctx, mac_free_ctx);

        gtk_widget_add_css_class(GTK_WIDGET(sidebar_hb), "nautilus-sidebar-headerbar");
        gtk_widget_add_css_class(GTK_WIDGET(content_hb), "nautilus-content-headerbar");

        GtkWidget *search_global_btn = NULL;
        GtkWidget *menu_btn = NULL;
        find_buttons_in_sidebar(GTK_WIDGET(sidebar_hb), &search_global_btn, &menu_btn);

        adw_header_bar_set_show_title(sidebar_hb, FALSE);
        adw_header_bar_set_title_widget(sidebar_hb, NULL);
        adw_header_bar_set_show_start_title_buttons(sidebar_hb, TRUE);
        adw_header_bar_set_show_end_title_buttons(sidebar_hb, FALSE);

        adw_header_bar_set_show_start_title_buttons(content_hb, FALSE);
        adw_header_bar_set_show_end_title_buttons(content_hb, FALSE);
        adw_header_bar_set_centering_policy(content_hb, ADW_CENTERING_POLICY_LOOSE);

        if (search_global_btn) {
            remove_from_headerbar(sidebar_hb, search_global_btn);
        }

        /* Configure [ < | > ] history controls */
        shift_start_box(GTK_WIDGET(content_hb));

        /* Locate native toolbar switcher & hide duplicate folder search stack */
        GtkWidget *folder_search_btn = find_descendant_actionable(GTK_WIDGET(content_hb), "slot.search-visible");
        if (folder_search_btn) {
            GtkWidget *stack_parent = gtk_widget_get_parent(folder_search_btn);
            if (stack_parent && GTK_IS_STACK(stack_parent)) {
                gtk_widget_set_visible(stack_parent, FALSE);
            }
        }

        GtkWidget *new_folder_btn = find_descendant_actionable(GTK_WIDGET(content_hb), "view.new-folder");
        if (new_folder_btn) {
            gtk_widget_set_visible(new_folder_btn, FALSE);
        }

        find_and_style_pathbar(GTK_WIDGET(content_hb));
        GtkWidget *toolbar_switcher = find_descendant_stack_with_child(GTK_WIDGET(content_hb), "pathbar");
        if (toolbar_switcher && GTK_IS_STACK(toolbar_switcher)) {
            ctx->toolbar_switcher = toolbar_switcher;
        }

        /* Static non-interactive current folder title right beside [ < | > ] */
        GtkWidget *title_lbl = gtk_label_new("");
        gtk_widget_add_css_class(title_lbl, "mac-finder-title-label");
        gtk_widget_set_valign(title_lbl, GTK_ALIGN_CENTER);
        gtk_widget_set_margin_start(title_lbl, 8);
        gtk_widget_set_margin_end(title_lbl, 6);
        gtk_widget_set_can_target(title_lbl, FALSE);
        gtk_label_set_ellipsize(GTK_LABEL(title_lbl), PANGO_ELLIPSIZE_END);
        gtk_label_set_max_width_chars(GTK_LABEL(title_lbl), 28);
        g_object_bind_property(window, "title", title_lbl, "label", G_BINDING_SYNC_CREATE);
        adw_header_bar_pack_start(content_hb, title_lbl);
        ctx->title_label = title_lbl;

        if (ctx->toolbar_switcher) {
            g_signal_connect(ctx->toolbar_switcher, "notify::visible-child-name",
                             G_CALLBACK(mac_on_toolbar_page_changed), ctx);
            mac_sync_toolbar_switcher_visibility(ctx);
        }

        /* Build Right Toolbar without non-working Share / AirDrop buttons (36px pills & larger icons) */
        GtkWidget *end_bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
        gtk_widget_add_css_class(end_bar, "mac-end-toolbar");
        gtk_widget_set_valign(end_bar, GTK_ALIGN_CENTER);

        /* 1. [ ≡ ▾ ] Sort / View Options Pill */
        GtkWidget *sort_btn = gtk_menu_button_new();
        gtk_widget_add_css_class(sort_btn, "mac-sort-pill");
        gtk_widget_set_tooltip_text(sort_btn, mac_tr("sort_and_options", "Sort & View Options"));
        gtk_widget_set_valign(sort_btn, GTK_ALIGN_CENTER);
        gtk_widget_set_size_request(sort_btn, 56, 36);
        GtkWidget *sort_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
        gtk_widget_set_halign(sort_box, GTK_ALIGN_CENTER);
        gtk_widget_set_valign(sort_box, GTK_ALIGN_CENTER);
        gtk_box_append(GTK_BOX(sort_box), mac_make_finder_icon("mac-finder-sort-list-symbolic", 18));
        gtk_box_append(GTK_BOX(sort_box), mac_make_finder_icon("mac-finder-chevron-down-symbolic", 12));
        gtk_menu_button_set_child(GTK_MENU_BUTTON(sort_btn), sort_box);
        gtk_menu_button_set_popover(GTK_MENU_BUTTON(sort_btn), mac_build_sort_popover(ctx));
        gtk_box_append(GTK_BOX(end_bar), sort_btn);
        ctx->sort_btn = sort_btn;

        /* 3. ( i ) Get Info / Properties */
        ctx->info_btn = mac_create_circle_button("mac-finder-info-symbolic",
                                                 mac_tr("get_info", "Get Info"), NULL);
        g_signal_connect(ctx->info_btn, "clicked", G_CALLBACK(mac_on_info_clicked), ctx);
        gtk_box_append(GTK_BOX(end_bar), ctx->info_btn);

        /* 4. [ 🗑  ⏏ ] Trash + Eject Pill Group */
        GtkWidget *act_pill = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 2);
        gtk_widget_add_css_class(act_pill, "mac-pill-group");
        gtk_widget_set_valign(act_pill, GTK_ALIGN_CENTER);
        gtk_widget_set_size_request(act_pill, 76, 36);

        GtkWidget *trash_btn = gtk_button_new();
        gtk_button_set_child(GTK_BUTTON(trash_btn), mac_make_finder_icon("mac-finder-trash-symbolic", 18));
        gtk_widget_set_tooltip_text(trash_btn, mac_tr("move_to_trash", "Move to Trash"));
        gtk_widget_set_size_request(trash_btn, 36, 36);
        gtk_widget_set_focus_on_click(trash_btn, FALSE);
        gtk_widget_add_css_class(trash_btn, "mac-pill-inner-btn");
        g_signal_connect(trash_btn, "clicked", G_CALLBACK(mac_on_trash_clicked), ctx);
        gtk_box_append(GTK_BOX(act_pill), trash_btn);
        ctx->trash_btn = trash_btn;

        GtkWidget *eject_btn = gtk_button_new();
        gtk_button_set_child(GTK_BUTTON(eject_btn), mac_make_finder_icon("mac-finder-eject-symbolic", 18));
        gtk_widget_set_tooltip_text(eject_btn, mac_tr("eject_volume", "Eject"));
        gtk_widget_set_size_request(eject_btn, 36, 36);
        gtk_widget_set_focus_on_click(eject_btn, FALSE);
        gtk_widget_add_css_class(eject_btn, "mac-pill-inner-btn");
        g_signal_connect(eject_btn, "clicked", G_CALLBACK(mac_on_eject_clicked), ctx);
        gtk_box_append(GTK_BOX(act_pill), eject_btn);
        ctx->eject_btn = eject_btn;

        gtk_box_append(GTK_BOX(end_bar), act_pill);
        ctx->act_pill = act_pill;

        /* 6. [ ⊞ ⌄ ] Reparent NautilusViewControls */
        GtkWidget *view_controls = find_descendant_by_type_name(GTK_WIDGET(content_hb), "NautilusViewControls");
        if (view_controls) {
            reparent_widget_into(view_controls, end_bar);
            gtk_widget_set_valign(view_controls, GTK_ALIGN_CENTER);
            ctx->view_controls = view_controls;

            GtkWidget *split_btn = find_descendant_by_type_name(view_controls, "AdwSplitButton");
            if (split_btn && ADW_IS_SPLIT_BUTTON(split_btn)) {
                mac_sync_view_split_icons(ADW_SPLIT_BUTTON(split_btn));
                g_signal_connect(split_btn, "notify::icon-name", G_CALLBACK(mac_on_view_split_icon_changed), ctx);
                GtkPopover *vc_pop = adw_split_button_get_popover(ADW_SPLIT_BUTTON(split_btn));
                if (vc_pop) {
                    GtkWidget *vc_child = gtk_popover_get_child(vc_pop);
                    if (vc_child) mac_polish_popover_menu_tree(vc_child);
                    g_signal_connect(vc_pop, "show", G_CALLBACK(mac_on_view_controls_popover_show), NULL);
                }
            }
        }

        /* 7. ( » ) Reparent native App Menu (menu_btn) */
        if (menu_btn) {
            reparent_widget_into(menu_btn, end_bar);
            gtk_widget_set_visible(menu_btn, TRUE);
            gtk_widget_set_valign(menu_btn, GTK_ALIGN_CENTER);
            gtk_widget_set_halign(menu_btn, GTK_ALIGN_CENTER);
            gtk_widget_set_size_request(menu_btn, 36, 36);
            gtk_menu_button_set_icon_name(GTK_MENU_BUTTON(menu_btn), "mac-finder-more-symbolic");
            GtkWidget *mimg = find_descendant_by_type_name(menu_btn, "GtkImage");
            if (mimg && GTK_IS_IMAGE(mimg)) gtk_image_set_pixel_size(GTK_IMAGE(mimg), 18);
            gtk_widget_add_css_class(menu_btn, "mac-circle-button");
            gtk_widget_add_css_class(menu_btn, "mac-more-button");
            ctx->more_btn = menu_btn;
        }

        /* 8. ( 🔍 ) Search toggle at far right (keep native stack intact to avoid GtkStack child warnings) */
        GtkWidget *search_toggle = gtk_toggle_button_new();
        gtk_button_set_child(GTK_BUTTON(search_toggle), mac_make_finder_icon("mac-finder-search-symbolic", 18));
        gtk_widget_set_tooltip_text(search_toggle, mac_tr("search", "Search"));
        gtk_actionable_set_action_name(GTK_ACTIONABLE(search_toggle), "slot.search-visible");
        gtk_widget_set_valign(search_toggle, GTK_ALIGN_CENTER);
        gtk_widget_set_halign(search_toggle, GTK_ALIGN_CENTER);
        gtk_widget_set_size_request(search_toggle, 36, 36);
        gtk_widget_set_focus_on_click(search_toggle, FALSE);
        gtk_widget_add_css_class(search_toggle, "mac-circle-button");
        gtk_widget_add_css_class(search_toggle, "mac-search-button");
        gtk_box_append(GTK_BOX(end_bar), search_toggle);
        ctx->search_btn = search_toggle;

        gtk_widget_set_hexpand(end_bar, FALSE);
        adw_header_bar_pack_end(content_hb, end_bar);

        /* === Bottom Live-Blurred Path Bar + Short File Info Status Bar (Overlay over TabView) === */
        GtkWidget *content_tv = ADW_IS_TOOLBAR_VIEW(content)
            ? content
            : find_descendant_by_type_name(content, "AdwToolbarView");
        if (content_tv && ADW_IS_TOOLBAR_VIEW(content_tv)) {
            GtkWidget *tab_view = adw_toolbar_view_get_content(ADW_TOOLBAR_VIEW(content_tv));
            if (tab_view && GTK_IS_WIDGET(tab_view)) {
                AdwStyleManager *sm = adw_style_manager_get_default();
                gboolean is_dark = sm ? adw_style_manager_get_dark(sm) : TRUE;

                GtkWidget *tab_overlay = gtk_overlay_new();
                gtk_widget_set_hexpand(tab_overlay, TRUE);
                gtk_widget_set_vexpand(tab_overlay, TRUE);

                g_object_ref(tab_view);
                adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(content_tv), NULL);
                gtk_overlay_set_child(GTK_OVERLAY(tab_overlay), tab_view);
                g_object_unref(tab_view);
                adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(content_tv), tab_overlay);

                GtkWidget *bottom_bar = mac_bottom_blur_bar_new(tab_view, is_dark);
                gtk_widget_set_valign(bottom_bar, GTK_ALIGN_END);
                gtk_widget_set_halign(bottom_bar, GTK_ALIGN_FILL);

                GtkWidget *path_stack = gtk_stack_new();
                gtk_stack_set_transition_type(GTK_STACK(path_stack), GTK_STACK_TRANSITION_TYPE_NONE);

                GtkWidget *path_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
                gtk_widget_add_css_class(path_row, "mac-bottom-path-row");
                GtkGesture *path_click = gtk_gesture_click_new();
                gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(path_click), GDK_BUTTON_PRIMARY);
                gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(path_click), GTK_PHASE_CAPTURE);
                g_signal_connect(path_click, "pressed", G_CALLBACK(mac_on_bottom_path_bg_pressed), ctx);
                g_signal_connect(path_click, "released", G_CALLBACK(mac_on_bottom_path_bg_released), ctx);
                gtk_widget_add_controller(path_row, GTK_EVENT_CONTROLLER(path_click));

                GtkWidget *path_scroll = gtk_scrolled_window_new();
                gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(path_scroll),
                                               GTK_POLICY_EXTERNAL, GTK_POLICY_NEVER);
                gtk_widget_set_hexpand(path_scroll, TRUE);
                gtk_widget_add_css_class(path_scroll, "mac-bottom-path-scroll");

                GtkWidget *path_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 2);
                gtk_widget_set_valign(path_box, GTK_ALIGN_CENTER);
                gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(path_scroll), path_box);
                gtk_box_append(GTK_BOX(path_row), path_scroll);
                gtk_stack_add_named(GTK_STACK(path_stack), path_row, "breadcrumbs");

                GtkWidget *entry_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
                gtk_widget_add_css_class(entry_row, "mac-bottom-entry-row");
                GtkWidget *path_entry = gtk_entry_new();
                gtk_widget_add_css_class(path_entry, "mac-bottom-path-entry");
                gtk_widget_set_hexpand(path_entry, TRUE);
                gtk_widget_set_valign(path_entry, GTK_ALIGN_CENTER);
                gtk_entry_set_placeholder_text(GTK_ENTRY(path_entry), "/home/...");
                g_signal_connect(path_entry, "activate", G_CALLBACK(mac_on_bottom_path_entry_activate), ctx);
                GtkEventController *focus_ctrl = gtk_event_controller_focus_new();
                g_signal_connect(focus_ctrl, "leave", G_CALLBACK(mac_on_bottom_path_entry_leave), ctx);
                gtk_widget_add_controller(path_entry, focus_ctrl);
                GtkEventController *key_ctrl = gtk_event_controller_key_new();
                g_signal_connect(key_ctrl, "key-pressed", G_CALLBACK(mac_on_bottom_path_entry_key), ctx);
                gtk_widget_add_controller(path_entry, key_ctrl);
                gtk_box_append(GTK_BOX(entry_row), path_entry);
                gtk_stack_add_named(GTK_STACK(path_stack), entry_row, "entry");

                gtk_stack_set_visible_child_name(GTK_STACK(path_stack), "breadcrumbs");
                gtk_box_append(GTK_BOX(bottom_bar), path_stack);

                GtkWidget *mid_sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
                gtk_widget_add_css_class(mid_sep, "mac-bottom-divider");
                gtk_box_append(GTK_BOX(bottom_bar), mid_sep);

                GtkWidget *info_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
                gtk_widget_add_css_class(info_row, "mac-bottom-info-row");
                gtk_widget_set_halign(info_row, GTK_ALIGN_CENTER);
                gtk_widget_set_valign(info_row, GTK_ALIGN_CENTER);

                GtkWidget *info_name = gtk_label_new("");
                gtk_widget_add_css_class(info_name, "mac-bottom-info-name");
                gtk_label_set_single_line_mode(GTK_LABEL(info_name), TRUE);
                gtk_label_set_ellipsize(GTK_LABEL(info_name), PANGO_ELLIPSIZE_MIDDLE);
                gtk_label_set_max_width_chars(GTK_LABEL(info_name), 38);
                gtk_widget_set_visible(info_name, FALSE);
                gtk_box_append(GTK_BOX(info_row), info_name);

                GtkWidget *info_meta = gtk_label_new("");
                gtk_widget_add_css_class(info_meta, "mac-bottom-info-meta");
                gtk_label_set_single_line_mode(GTK_LABEL(info_meta), TRUE);
                gtk_label_set_ellipsize(GTK_LABEL(info_meta), PANGO_ELLIPSIZE_END);
                gtk_box_append(GTK_BOX(info_row), info_meta);

                gtk_box_append(GTK_BOX(bottom_bar), info_row);
                gtk_overlay_add_overlay(GTK_OVERLAY(tab_overlay), bottom_bar);

                ctx->content_tv = content_tv;
                ctx->tab_view = tab_view;
                ctx->bottom_bar = bottom_bar;
                ctx->bottom_path_stack = path_stack;
                ctx->bottom_path_box = path_box;
                ctx->bottom_path_scroll = path_scroll;
                ctx->bottom_path_entry = path_entry;
                ctx->bottom_info_name_lbl = info_name;
                ctx->bottom_info_meta_lbl = info_meta;
            }
        }

        if (g_object_class_find_property(G_OBJECT_GET_CLASS(window), "active-slot")) {
            g_signal_connect(window, "notify::active-slot", G_CALLBACK(mac_on_active_slot_changed), ctx);
        }
        mac_ctx_schedule_rebind(ctx);

        g_object_set_data(G_OBJECT(window), "mac_headerbars_reorganized", GINT_TO_POINTER(1));
    }

    g_list_free(sidebar_bars);
    g_list_free(content_bars);
    return G_SOURCE_REMOVE;
}

static void mac_schedule_fix_window(GtkWindow *window)
{
    g_idle_add_full(G_PRIORITY_DEFAULT_IDLE, mac_fix_nautilus_window,
                    g_object_ref(window), g_object_unref);
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
        install_mac_popover_hooks();
        install_mac_grid_label_hooks();
        find_and_enable_scrolled_windows(GTK_WIDGET(window));
        mac_fix_nautilus_window(window);
        mac_schedule_fix_window(window);
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
        install_mac_popover_hooks();
        install_mac_grid_label_hooks();
        find_and_enable_scrolled_windows(GTK_WIDGET(window));
        mac_fix_nautilus_window(window);
        mac_schedule_fix_window(window);
    }
}

static void (*orig_adw_dialog_present)(AdwDialog *self, GtkWidget *parent) = NULL;

void adw_dialog_present(AdwDialog *self, GtkWidget *parent)
{
    if (!orig_adw_dialog_present) {
        orig_adw_dialog_present = dlsym(RTLD_NEXT, "adw_dialog_present");
    }

    if (ADW_IS_ALERT_DIALOG(self)) {
        const char *heading = adw_alert_dialog_get_heading(ADW_ALERT_DIALOG(self));
        if (heading && (strstr(heading, "смітник") || strstr(heading, "Trash") || strstr(heading, "Смітник"))) {

            GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
            if (bus) {
                g_dbus_connection_call(bus,
                    "org.gnome.Shell",
                    "/org/gnome/Shell/Extensions/EvalHelper",
                    "org.gnome.Shell.Extensions.EvalHelper",
                    "ShowEmptyTrashDialog",
                    NULL,
                    NULL,
                    G_DBUS_CALL_FLAGS_NONE,
                    -1,
                    NULL,
                    NULL,
                    NULL);
                g_object_unref(bus);
            }
            return;
        }
    }

    if (orig_adw_dialog_present) {
        orig_adw_dialog_present(self, parent);
    }
}
