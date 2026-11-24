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

static void mac_draw_rounded_rect(cairo_t *cr, double x, double y, double w, double h, double r) {
    if (r > w / 2.0) r = w / 2.0;
    if (r > h / 2.0) r = h / 2.0;
    if (r < 0.5) r = 0.5;
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -G_PI_2, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, G_PI_2);
    cairo_arc(cr, x + r, y + h - r, r, G_PI_2, G_PI);
    cairo_arc(cr, x + r, y + r, r, G_PI, 3.0 * G_PI_2);
    cairo_close_path(cr);
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
        double px = 6.0;
        double py = 2.5;
        double r_corner = 7.5;
        double r_fillet = 6.0;

        MacLineBox pill_lines[8];
        for (int i = 0; i < n_lines; i++) {
            pill_lines[i].x = raw_lines[i].x - px;
            pill_lines[i].w = raw_lines[i].w + 2.0 * px;
            if (i == 0) {
                pill_lines[i].y = raw_lines[i].y - py;
            } else {
                pill_lines[i].y = raw_lines[i].y;
            }
            if (i == n_lines - 1) {
                pill_lines[i].h = (raw_lines[i].y + raw_lines[i].h + py) - pill_lines[i].y;
            } else {
                pill_lines[i].h = (raw_lines[i + 1].y - pill_lines[i].y) + 0.5;
            }
        }

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

        if (n_lines == 1) {
            cairo_new_path(cr);
            mac_draw_rounded_rect(cr, pill_lines[0].x, pill_lines[0].y, pill_lines[0].w, pill_lines[0].h, r_corner);
            cairo_fill(cr);
        } else if (n_lines == 2) {
            double x0L = pill_lines[0].x, x0R = pill_lines[0].x + pill_lines[0].w;
            double y0T = pill_lines[0].y, y0B = pill_lines[0].y + pill_lines[0].h;
            double x1L = pill_lines[1].x, x1R = pill_lines[1].x + pill_lines[1].w;
            double y1T = y0B, y1B = pill_lines[1].y + pill_lines[1].h;

            double dwL = x1L - x0L;
            double dwR = x0R - x1R;
            double min_step = 8.5;

            if (dwL >= min_step && dwR >= min_step) {

                double rf_R = r_fillet;
                if (rf_R > dwR / 2.0) rf_R = dwR / 2.0;
                if (rf_R > pill_lines[0].h / 2.0) rf_R = pill_lines[0].h / 2.0;
                if (rf_R > pill_lines[1].h / 2.0) rf_R = pill_lines[1].h / 2.0;
                if (rf_R < 1.0) rf_R = 1.0;

                double rf_L = r_fillet;
                if (rf_L > dwL / 2.0) rf_L = dwL / 2.0;
                if (rf_L > pill_lines[0].h / 2.0) rf_L = pill_lines[0].h / 2.0;
                if (rf_L > pill_lines[1].h / 2.0) rf_L = pill_lines[1].h / 2.0;
                if (rf_L < 1.0) rf_L = 1.0;

                double rtl = r_corner;
                if (rtl > pill_lines[0].w / 2.0) rtl = pill_lines[0].w / 2.0;
                if (rtl > pill_lines[0].h / 2.0) rtl = pill_lines[0].h / 2.0;

                double rtr = r_corner;
                if (rtr > pill_lines[0].w / 2.0) rtr = pill_lines[0].w / 2.0;
                if (rtr > pill_lines[0].h / 2.0) rtr = pill_lines[0].h / 2.0;

                double rbl = r_corner;
                if (rbl > pill_lines[1].w / 2.0) rbl = pill_lines[1].w / 2.0;
                if (rbl > pill_lines[1].h / 2.0) rbl = pill_lines[1].h / 2.0;

                double rbr = r_corner;
                if (rbr > pill_lines[1].w / 2.0) rbr = pill_lines[1].w / 2.0;
                if (rbr > pill_lines[1].h / 2.0) rbr = pill_lines[1].h / 2.0;

                cairo_new_path(cr);
                cairo_arc(cr, x0R - rtr, y0T + rtr, rtr, 1.5 * G_PI, 2.0 * G_PI);
                cairo_arc(cr, x0R - rf_R, y0B - rf_R, rf_R, 0, 0.5 * G_PI);
                cairo_arc_negative(cr, x1R + rf_R, y0B + rf_R, rf_R, 1.5 * G_PI, G_PI);
                cairo_arc(cr, x1R - rbr, y1B - rbr, rbr, 0, 0.5 * G_PI);
                cairo_arc(cr, x1L + rbl, y1B - rbl, rbl, 0.5 * G_PI, G_PI);
                cairo_arc_negative(cr, x1L - rf_L, y0B + rf_L, rf_L, 0, 1.5 * G_PI);
                cairo_arc(cr, x0L + rf_L, y0B - rf_L, rf_L, 0.5 * G_PI, G_PI);
                cairo_arc(cr, x0L + rtl, y0T + rtl, rtl, G_PI, 1.5 * G_PI);
                cairo_close_path(cr);
                cairo_fill(cr);
            } else if (dwL <= -min_step && dwR <= -min_step) {

                double rf_R = r_fillet;
                if (rf_R > -dwR / 2.0) rf_R = -dwR / 2.0;
                if (rf_R > pill_lines[0].h / 2.0) rf_R = pill_lines[0].h / 2.0;
                if (rf_R > pill_lines[1].h / 2.0) rf_R = pill_lines[1].h / 2.0;
                if (rf_R < 1.0) rf_R = 1.0;

                double rf_L = r_fillet;
                if (rf_L > -dwL / 2.0) rf_L = -dwL / 2.0;
                if (rf_L > pill_lines[0].h / 2.0) rf_L = pill_lines[0].h / 2.0;
                if (rf_L > pill_lines[1].h / 2.0) rf_L = pill_lines[1].h / 2.0;
                if (rf_L < 1.0) rf_L = 1.0;

                double rtl = r_corner;
                if (rtl > pill_lines[0].w / 2.0) rtl = pill_lines[0].w / 2.0;
                if (rtl > pill_lines[0].h / 2.0) rtl = pill_lines[0].h / 2.0;

                double rtr = r_corner;
                if (rtr > pill_lines[0].w / 2.0) rtr = pill_lines[0].w / 2.0;
                if (rtr > pill_lines[0].h / 2.0) rtr = pill_lines[0].h / 2.0;

                double rbl = r_corner;
                if (rbl > pill_lines[1].w / 2.0) rbl = pill_lines[1].w / 2.0;
                if (rbl > pill_lines[1].h / 2.0) rbl = pill_lines[1].h / 2.0;

                double rbr = r_corner;
                if (rbr > pill_lines[1].w / 2.0) rbr = pill_lines[1].w / 2.0;
                if (rbr > pill_lines[1].h / 2.0) rbr = pill_lines[1].h / 2.0;

                cairo_new_path(cr);
                cairo_arc(cr, x0R - rtr, y0T + rtr, rtr, 1.5 * G_PI, 2.0 * G_PI);
                cairo_arc_negative(cr, x0R + rf_R, y0B - rf_R, rf_R, G_PI, 0.5 * G_PI);
                cairo_arc(cr, x1R - rf_R, y0B + rf_R, rf_R, 1.5 * G_PI, 2.0 * G_PI);
                cairo_arc(cr, x1R - rbr, y1B - rbr, rbr, 0, 0.5 * G_PI);
                cairo_arc(cr, x1L + rbl, y1B - rbl, rbl, 0.5 * G_PI, G_PI);
                cairo_arc(cr, x1L + rf_L, y0B + rf_L, rf_L, G_PI, 1.5 * G_PI);
                cairo_arc_negative(cr, x0L - rf_L, y0B - rf_L, rf_L, 0.5 * G_PI, 0);
                cairo_arc(cr, x0L + rtl, y0T + rtl, rtl, G_PI, 1.5 * G_PI);
                cairo_close_path(cr);
                cairo_fill(cr);
            } else {

                double ux_min = (x0L < x1L) ? x0L : x1L;
                double ux_max = (x0R > x1R) ? x0R : x1R;
                double uy_min = y0T;
                double uy_max = y1B;
                cairo_new_path(cr);
                mac_draw_rounded_rect(cr, ux_min, uy_min, ux_max - ux_min, uy_max - uy_min, r_corner);
                cairo_fill(cr);
            }
        } else {

            double ux_min = pill_lines[0].x;
            double ux_max = pill_lines[0].x + pill_lines[0].w;
            double uy_min = pill_lines[0].y;
            double uy_max = pill_lines[n_lines - 1].y + pill_lines[n_lines - 1].h;
            double min_w = pill_lines[0].w;
            double max_w = pill_lines[0].w;
            for (int i = 0; i < n_lines; i++) {
                if (pill_lines[i].x < ux_min) ux_min = pill_lines[i].x;
                if (pill_lines[i].x + pill_lines[i].w > ux_max) ux_max = pill_lines[i].x + pill_lines[i].w;
                if (pill_lines[i].w < min_w) min_w = pill_lines[i].w;
                if (pill_lines[i].w > max_w) max_w = pill_lines[i].w;
            }
            if ((max_w - min_w) < 17.0) {
                cairo_new_path(cr);
                mac_draw_rounded_rect(cr, ux_min, uy_min, ux_max - ux_min, uy_max - uy_min, r_corner);
                cairo_fill(cr);
            } else {
                cairo_new_path(cr);
                for (int i = 0; i < n_lines; i++) {
                    mac_draw_rounded_rect(cr, pill_lines[i].x, pill_lines[i].y, pill_lines[i].w, pill_lines[i].h, r_corner);
                }
                cairo_fill(cr);
            }
        }
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

static void find_and_style_images(GtkWidget *widget, gboolean orange G_GNUC_UNUSED)
{
    if (!widget) return;
    if (GTK_IS_IMAGE(widget)) {
        if (is_inside_button(widget)) {
            gtk_widget_remove_css_class(widget, "sidebar-orange-icon");
            gtk_widget_remove_css_class(widget, "sidebar-neutral-icon");
            gtk_widget_add_css_class(widget, "mac-eject-icon");
            return;
        }
        gtk_widget_remove_css_class(widget, "sidebar-orange-icon");
        gtk_widget_add_css_class(widget, "sidebar-neutral-icon");
        return;
    }
    for (GtkWidget *child = gtk_widget_get_first_child(widget); child != NULL; child = gtk_widget_get_next_sibling(child)) {
        find_and_style_images(child, FALSE);
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

    gboolean uk = is_ukrainian_locale();

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
    }

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

static void style_pathbar_children(GtkWidget *widget)
{
    if (!widget) return;
    gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
    gtk_widget_set_vexpand(widget, FALSE);
    if (GTK_IS_SCROLLED_WINDOW(widget)) {
        gtk_widget_set_size_request(widget, -1, 24);
    }
    if (GTK_IS_BUTTON(widget) || GTK_IS_MENU_BUTTON(widget)) {
        gtk_widget_set_size_request(widget, -1, 22);
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
        gtk_widget_set_size_request(widget, -1, 26);
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

static void style_history_buttons(GtkWidget *widget)
{
    if (!widget) return;
    gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
    gtk_widget_set_size_request(widget, -1, 26);
    if (GTK_IS_BUTTON(widget)) {
        gtk_widget_set_size_request(widget, 24, 24);
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_halign(widget, GTK_ALIGN_CENTER);
        gtk_widget_add_css_class(widget, "mac-history-button");
    }
    for (GtkWidget *ch = gtk_widget_get_first_child(widget); ch != NULL; ch = gtk_widget_get_next_sibling(ch)) {
        style_history_buttons(ch);
    }
}

static void shift_start_box(GtkWidget *widget)
{
    if (!widget) return;
    if (g_strcmp0(G_OBJECT_TYPE_NAME(widget), "NautilusHistoryControls") == 0) {
        fprintf(stderr, "[MAC-NAUTILUS] History controls type=%s css_name=%s\n",
                G_OBJECT_TYPE_NAME(widget), gtk_widget_get_css_name(widget));
        gtk_widget_add_css_class(widget, "mac-history-controls");
        gtk_widget_set_margin_start(widget, 10);
        gtk_widget_set_valign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_halign(widget, GTK_ALIGN_CENTER);
        gtk_widget_set_size_request(widget, -1, 26);
        style_history_buttons(widget);
        fprintf(stderr, "[MAC-NAUTILUS] Found NautilusHistoryControls! Configured proportional 26px height\n");
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

    gtk_widget_add_css_class(GTK_WIDGET(window), "nautilus-window");

    static gboolean css_loaded = FALSE;
    if (!css_loaded) {
        css_loaded = TRUE;
        GtkCssProvider *provider = gtk_css_provider_new();
        const char *custom_css =
            "window.nautilus-window headerbar,\n"
            "window.nautilus-window .content-pane headerbar,\n"
            "window.nautilus-window .sidebar-pane headerbar,\n"
            "window.nautilus-window .nautilus-content-headerbar,\n"
            "window.nautilus-window .nautilus-sidebar-headerbar {\n"
            "    min-height: 28px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window toolbarview > .top-bar,\n"
            "window.nautilus-window .content-pane toolbarview > .top-bar,\n"
            "window.nautilus-window .sidebar-pane toolbarview > .top-bar {\n"
            "    min-height: 28px;\n"
            "    padding-top: 5px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "}\n"
            "window.nautilus-window tabbar,\n"
            "window.nautilus-window .top-bar tabbar {\n"
            "    margin-top: 4px;\n"
            "}\n"
            "window.nautilus-window toolbarview > .top-bar .collapse-spacing headerbar,\n"
            "window.nautilus-window toolbarview > .top-bar .collapse-spacing headerbar > windowhandle > box,\n"
            "window.nautilus-window headerbar windowhandle,\n"
            "window.nautilus-window headerbar centerbox {\n"
            "    min-height: 28px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "}\n"
            "window.nautilus-window headerbar button.back {\n"
            "    min-height: 0px;\n"
            "    min-width: 0px;\n"
            "    padding: 0px;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar,\n"
            "window.nautilus-window #NautilusPathBar,\n"
            "window.nautilus-window .mac-pathbar,\n"
            "headerbar .nautilus-pathbar,\n"
            "headerbar #NautilusPathBar,\n"
            ".nautilus-pathbar,\n"
            "#NautilusPathBar {\n"
            "    min-height: 26px;\n"
            "    padding: 0 4px;\n"
            "    margin: 2px 4px;\n"
            "    border-radius: 9999px;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.08);\n"
            "    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar:backdrop,\n"
            "window.nautilus-window #NautilusPathBar:backdrop,\n"
            "headerbar .nautilus-pathbar:backdrop,\n"
            ".nautilus-pathbar:backdrop,\n"
            "#NautilusPathBar:backdrop {\n"
            "    background-color: rgba(255, 255, 255, 0.06);\n"
            "    border-color: rgba(255, 255, 255, 0.05);\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > scrolledwindow,\n"
            "window.nautilus-window #NautilusPathBar > scrolledwindow,\n"
            "headerbar .nautilus-pathbar > scrolledwindow,\n"
            ".nautilus-pathbar > scrolledwindow {\n"
            "    min-height: 22px;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > scrolledwindow > viewport,\n"
            "window.nautilus-window #NautilusPathBar > scrolledwindow > viewport,\n"
            ".nautilus-pathbar > scrolledwindow > viewport {\n"
            "    background: transparent;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar .nautilus-path-button,\n"
            "window.nautilus-window #NautilusPathBar .nautilus-path-button,\n"
            "window.nautilus-window .nautilus-pathbar #NautilusPathButton,\n"
            "window.nautilus-window #NautilusPathBar #NautilusPathButton,\n"
            "headerbar .nautilus-pathbar .nautilus-path-button,\n"
            ".nautilus-path-button {\n"
            "    min-height: 22px;\n"
            "    padding: 0 6px;\n"
            "    margin: 0 1px;\n"
            "    font-size: 12.5px;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar .nautilus-path-button:hover,\n"
            "window.nautilus-window #NautilusPathBar .nautilus-path-button:hover,\n"
            ".nautilus-path-button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar .nautilus-path-button:active,\n"
            "window.nautilus-window #NautilusPathBar .nautilus-path-button:active,\n"
            ".nautilus-path-button:active {\n"
            "    background-color: rgba(255, 255, 255, 0.20);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar .nautilus-path-button image,\n"
            "window.nautilus-window #NautilusPathBar .nautilus-path-button image,\n"
            ".nautilus-path-button image {\n"
            "    min-width: 14px;\n"
            "    min-height: 14px;\n"
            "    -gtk-icon-size: 14px;\n"
            "    margin: 0 4px 0 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar .nautilus-path-button label,\n"
            "window.nautilus-window #NautilusPathBar .nautilus-path-button label,\n"
            ".nautilus-path-button label {\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    line-height: 1;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > menubutton,\n"
            "window.nautilus-window #NautilusPathBar > menubutton,\n"
            "headerbar .nautilus-pathbar > menubutton,\n"
            ".nautilus-pathbar > menubutton {\n"
            "    min-height: 22px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > menubutton > button,\n"
            "window.nautilus-window #NautilusPathBar > menubutton > button,\n"
            "headerbar .nautilus-pathbar > menubutton > button,\n"
            ".nautilus-pathbar > menubutton > button {\n"
            "    min-height: 22px;\n"
            "    min-width: 22px;\n"
            "    padding: 0 4px;\n"
            "    margin: 0;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.85);\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > menubutton > button:hover,\n"
            "window.nautilus-window #NautilusPathBar > menubutton > button:hover,\n"
            ".nautilus-pathbar > menubutton > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar > menubutton > button:active,\n"
            "window.nautilus-window #NautilusPathBar > menubutton > button:active,\n"
            ".nautilus-pathbar > menubutton > button:active {\n"
            "    background-color: rgba(255, 255, 255, 0.20);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .content-pane headerbar box.end > button,\n"
            "window.nautilus-window .content-pane headerbar .end > button,\n"
            "window.nautilus-window headerbar box.end > button,\n"
            "window.nautilus-window headerbar .end > button,\n"
            "window.nautilus-window headerbar button.mac-circle-button,\n"
            "window.nautilus-window headerbar button.mac-search-button {\n"
            "    min-width: 26px;\n"
            "    min-height: 26px;\n"
            "    border-radius: 9999px;\n"
            "    padding: 0;\n"
            "    margin: 2px 4px;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.08);\n"
            "    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window headerbar menubutton.mac-circle-button,\n"
            "window.nautilus-window headerbar box.end > menubutton,\n"
            "window.nautilus-window headerbar .end > menubutton,\n"
            "window.nautilus-window .content-pane headerbar box.end > menubutton,\n"
            "window.nautilus-window .content-pane headerbar .end > menubutton {\n"
            "    opacity: 0;\n"
            "    min-width: 0;\n"
            "    min-height: 0;\n"
            "    padding: 0;\n"
            "    margin: 0;\n"
            "}\n"
            "window.nautilus-window .content-pane headerbar box.end > button image,\n"
            "window.nautilus-window .content-pane headerbar .end > button image,\n"
            "window.nautilus-window headerbar box.end > button image,\n"
            "window.nautilus-window headerbar .end > button image,\n"
            "window.nautilus-window headerbar button.mac-circle-button image,\n"
            "window.nautilus-window headerbar button.mac-search-button image {\n"
            "    min-width: 13px;\n"
            "    min-height: 13px;\n"
            "    -gtk-icon-size: 13px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window .content-pane headerbar box.end > button:hover,\n"
            "window.nautilus-window .content-pane headerbar .end > button:hover,\n"
            "window.nautilus-window headerbar box.end > button:hover,\n"
            "window.nautilus-window headerbar .end > button:hover,\n"
            "window.nautilus-window headerbar button.mac-circle-button:hover,\n"
            "window.nautilus-window headerbar button.mac-search-button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.16);\n"
            "    border-color: rgba(255, 255, 255, 0.12);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .content-pane headerbar box.end > button:active,\n"
            "window.nautilus-window .content-pane headerbar box.end > button:checked,\n"
            "window.nautilus-window .content-pane headerbar .end > button:active,\n"
            "window.nautilus-window .content-pane headerbar .end > button:checked,\n"
            "window.nautilus-window headerbar box.end > button:active,\n"
            "window.nautilus-window headerbar box.end > button:checked,\n"
            "window.nautilus-window headerbar .end > button:active,\n"
            "window.nautilus-window headerbar .end > button:checked,\n"
            "window.nautilus-window headerbar button.mac-circle-button:active,\n"
            "window.nautilus-window headerbar button.mac-circle-button:checked,\n"
            "window.nautilus-window headerbar button.mac-search-button:active,\n"
            "window.nautilus-window headerbar button.mac-search-button:checked {\n"
            "    background-color: rgba(255, 255, 255, 0.24);\n"
            "    border-color: rgba(255, 255, 255, 0.16);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton,\n"
            "window.nautilus-window headerbar NautilusViewControls splitbutton,\n"
            "window.nautilus-window headerbar #view_split_button {\n"
            "    border-radius: 9999px;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.08);\n"
            "    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);\n"
            "    padding: 0;\n"
            "    margin: 2px 3px;\n"
            "    min-height: 26px;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > separator {\n"
            "    min-width: 1px;\n"
            "    min-height: 14px;\n"
            "    margin: 5px 0;\n"
            "    padding: 0;\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    border: none;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button {\n"
            "    min-width: 26px;\n"
            "    min-height: 26px;\n"
            "    padding: 0 4px 0 6px;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    border-top-left-radius: 9999px;\n"
            "    border-bottom-left-radius: 9999px;\n"
            "    border-top-right-radius: 0;\n"
            "    border-bottom-right-radius: 0;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > button:active,\n"
            "window.nautilus-window headerbar splitbutton > button:checked {\n"
            "    background-color: rgba(255, 255, 255, 0.20);\n"
            "    color: #ffffff;\n"
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
            "    min-height: 26px;\n"
            "    padding: 0 6px 0 2px;\n"
            "    margin: 0;\n"
            "    border: none;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    border-top-right-radius: 9999px;\n"
            "    border-bottom-right-radius: 9999px;\n"
            "    border-top-left-radius: 0;\n"
            "    border-bottom-left-radius: 0;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:active,\n"
            "window.nautilus-window headerbar splitbutton > menubutton > button:checked {\n"
            "    background-color: rgba(255, 255, 255, 0.20);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window .nautilus-pathbar button,\n"
            "window.nautilus-window #NautilusPathBar button,\n"
            "window.nautilus-window .nautilus-pathbar menubutton > button,\n"
            "window.nautilus-window #NautilusPathBar menubutton > button {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window headerbar .mac-history-controls,\n"
            "window.nautilus-window headerbar NautilusHistoryControls,\n"
            "window.nautilus-window headerbar .history-controls,\n"
            "window.nautilus-window headerbar #history_controls,\n"
            "headerbar NautilusHistoryControls {\n"
            "    min-height: 26px;\n"
            "    padding: 0;\n"
            "    margin: 2px 4px;\n"
            "}\n"
            "window.nautilus-window headerbar .mac-history-controls > box,\n"
            "window.nautilus-window headerbar .mac-history-controls box,\n"
            "window.nautilus-window headerbar NautilusHistoryControls > box,\n"
            "window.nautilus-window headerbar .history-controls > box,\n"
            "window.nautilus-window headerbar #history_controls > box {\n"
            "    min-height: 26px;\n"
            "    border-radius: 9999px;\n"
            "    padding: 0 1px;\n"
            "    margin: 0;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.08);\n"
            "    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);\n"
            "}\n"
            "window.nautilus-window headerbar .mac-history-controls button,\n"
            "window.nautilus-window headerbar button.mac-history-button,\n"
            "button.mac-history-button,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button,\n"
            "window.nautilus-window headerbar .history-controls button,\n"
            "window.nautilus-window headerbar #history_controls button,\n"
            "headerbar NautilusHistoryControls button,\n"
            "headerbar .history-controls button,\n"
            "NautilusHistoryControls button {\n"
            "    min-width: 24px;\n"
            "    min-height: 24px;\n"
            "    padding: 0;\n"
            "    margin: 1px 0;\n"
            "    border-radius: 9999px;\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    color: rgba(255, 255, 255, 0.88);\n"
            "}\n"
            "window.nautilus-window headerbar button.mac-history-button image,\n"
            "button.mac-history-button image,\n"
            "window.nautilus-window headerbar NautilusHistoryControls button image,\n"
            "window.nautilus-window headerbar .history-controls button image,\n"
            "window.nautilus-window headerbar #history_controls button image,\n"
            "headerbar NautilusHistoryControls button image,\n"
            "headerbar .history-controls button image,\n"
            "NautilusHistoryControls button image {\n"
            "    min-width: 12px;\n"
            "    min-height: 12px;\n"
            "    -gtk-icon-size: 12px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "}\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:hover,\n"
            "window.nautilus-window headerbar #history_controls button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.14);\n"
            "    color: #ffffff;\n"
            "}\n"
            "window.nautilus-window headerbar NautilusHistoryControls button:active,\n"
            "window.nautilus-window headerbar #history_controls button:active {\n"
            "    background-color: rgba(255, 255, 255, 0.22);\n"
            "    color: #ffffff;\n"
            "}\n"
            "/* Sidebar buttons identical to Settings */\n"
            "window.nautilus-window .sidebar-pane placessidebar,\n"
            "window.nautilus-window .sidebar-pane placessidebar > scrolledwindow,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar,\n"
            "window.nautilus-window .navigation-sidebar,\n"
            "window.nautilus-window placessidebar {\n"
            "    padding: 0px;\n"
            "    margin: 0px;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row,\n"
            "window.nautilus-window .sidebar-pane placessidebar .navigation-sidebar:not(.view) > row,\n"
            "window.nautilus-window .sidebar-pane row,\n"
            "window.nautilus-window .navigation-sidebar row,\n"
            "window.nautilus-window list.navigation-sidebar row,\n"
            "window.nautilus-window placessidebar row,\n"
            "window.nautilus-window row.sidebar-row {\n"
            "    min-height: 28px;\n"
            "    padding: 2px 8px 2px 8px;\n"
            "    margin: 1.5px 15px 1.5px 10px;\n"
            "    border-radius: 7px;\n"
            "    font-size: 13px;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:hover,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row:hover,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:hover,\n"
            "window.nautilus-window .sidebar-pane placessidebar .navigation-sidebar:not(.view) > row:hover,\n"
            "window.nautilus-window .sidebar-pane row:hover,\n"
            "window.nautilus-window .navigation-sidebar row:hover,\n"
            "window.nautilus-window list.navigation-sidebar row:hover,\n"
            "window.nautilus-window placessidebar row:hover,\n"
            "window.nautilus-window row.sidebar-row:hover {\n"
            "    border-radius: 7px;\n"
            "    background-color: rgba(255, 255, 255, 0.06);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row:selected,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected,\n"
            "window.nautilus-window .sidebar-pane placessidebar .navigation-sidebar:not(.view) > row:selected,\n"
            "window.nautilus-window .sidebar-pane row:selected,\n"
            "window.nautilus-window .navigation-sidebar row:selected,\n"
            "window.nautilus-window list.navigation-sidebar row:selected,\n"
            "window.nautilus-window placessidebar row:selected,\n"
            "window.nautilus-window row.sidebar-row:selected {\n"
            "    border-radius: 7px;\n"
            "    background-color: rgba(255, 255, 255, 0.10);\n"
            "    color: @accent_bg_color;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected:hover,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row:selected:hover,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected:hover,\n"
            "window.nautilus-window .sidebar-pane placessidebar .navigation-sidebar:not(.view) > row:selected:hover,\n"
            "window.nautilus-window .sidebar-pane row:selected:hover,\n"
            "window.nautilus-window .navigation-sidebar row:selected:hover,\n"
            "window.nautilus-window list.navigation-sidebar row:selected:hover,\n"
            "window.nautilus-window placessidebar row:selected:hover,\n"
            "window.nautilus-window row.sidebar-row:selected:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.14);\n"
            "    color: @accent_bg_color;\n"
            "}\n"
            "/* Completely remove background/border/shadow from ALL inner elements inside sidebar rows */\n"
            "window.nautilus-window .sidebar-pane row *,\n"
            "window.nautilus-window .sidebar-pane row:hover *,\n"
            "window.nautilus-window .sidebar-pane row:selected *,\n"
            "window.nautilus-window .navigation-sidebar row *,\n"
            "window.nautilus-window .navigation-sidebar row:hover *,\n"
            "window.nautilus-window .navigation-sidebar row:selected *,\n"
            "window.nautilus-window placessidebar row *,\n"
            "window.nautilus-window placessidebar row:hover *,\n"
            "window.nautilus-window placessidebar row:selected *,\n"
            "window.nautilus-window row.sidebar-row *,\n"
            "window.nautilus-window row.sidebar-row:hover *,\n"
            "window.nautilus-window row.sidebar-row:selected *,\n"
            ".navigation-sidebar row:selected *,\n"
            "list.navigation-sidebar row:selected *,\n"
            "placessidebar row:selected *,\n"
            "window.nautilus-window row:selected label selection,\n"
            "window.nautilus-window row:selected selection {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
            "    background-image: none;\n"
            "    box-shadow: none;\n"
            "    border: none;\n"
            "    outline: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row image,\n"
            "window.nautilus-window .navigation-sidebar row image,\n"
            "window.nautilus-window list.navigation-sidebar row image,\n"
            "window.nautilus-window placessidebar row image,\n"
            "window.nautilus-window row.sidebar-row image,\n"
            "window.nautilus-window row image.sidebar-orange-icon,\n"
            "window.nautilus-window row image.sidebar-neutral-icon {\n"
            "    min-width: 18px;\n"
            "    min-height: 18px;\n"
            "    -gtk-icon-size: 18px;\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    padding: 0;\n"
            "    margin-right: 8px;\n"
            "    margin-left: 0px;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "}\n"
            "window.nautilus-window .sidebar-pane row:selected image,\n"
            "window.nautilus-window .navigation-sidebar row:selected image,\n"
            "window.nautilus-window list.navigation-sidebar row:selected image,\n"
            "window.nautilus-window placessidebar row:selected image,\n"
            "window.nautilus-window row.sidebar-row:selected image,\n"
            "window.nautilus-window row:selected image.sidebar-orange-icon,\n"
            "window.nautilus-window row:selected image.sidebar-neutral-icon {\n"
            "    color: @accent_bg_color;\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "/* Sidebar buttons (e.g. Eject drive button) */\n"
            "window.nautilus-window .sidebar-pane placessidebar row button.sidebar-button,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button#eject_button,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button,\n"
            "window.nautilus-window .sidebar-pane row button.sidebar-button,\n"
            "window.nautilus-window .sidebar-pane row button#eject_button,\n"
            "window.nautilus-window .sidebar-pane row button,\n"
            "window.nautilus-window .navigation-sidebar row button.sidebar-button,\n"
            "window.nautilus-window .navigation-sidebar row button#eject_button,\n"
            "window.nautilus-window .navigation-sidebar row button,\n"
            "window.nautilus-window placessidebar row button.sidebar-button,\n"
            "window.nautilus-window placessidebar row button#eject_button,\n"
            "window.nautilus-window placessidebar row button,\n"
            "placessidebar .navigation-sidebar > row button.sidebar-button,\n"
            "placessidebar row button.sidebar-button,\n"
            "placessidebar row #eject_button,\n"
            "placessidebar row button {\n"
            "    min-width: 24px;\n"
            "    min-height: 24px;\n"
            "    padding: 0;\n"
            "    margin: 0 4px 0 0;\n"
            "    border-radius: 9999px;\n"
            "    border: none;\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row button.sidebar-button image,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button#eject_button image,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button image,\n"
            "window.nautilus-window .sidebar-pane placessidebar row button image.mac-eject-icon,\n"
            "window.nautilus-window .sidebar-pane row button image,\n"
            "window.nautilus-window .navigation-sidebar row button image,\n"
            "window.nautilus-window placessidebar row button image,\n"
            "image.mac-eject-icon,\n"
            ".mac-eject-icon,\n"
            "placessidebar .navigation-sidebar > row button.sidebar-button image,\n"
            "placessidebar .navigation-sidebar > row button.sidebar-button > image,\n"
            "placessidebar row button.sidebar-button image,\n"
            "placessidebar row #eject_button image,\n"
            "placessidebar row button image {\n"
            "    min-width: 14px;\n"
            "    min-height: 14px;\n"
            "    -gtk-icon-size: 14px;\n"
            "    margin: 0;\n"
            "    padding: 0;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row label,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row label,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row label,\n"
            "window.nautilus-window .sidebar-pane row label,\n"
            "window.nautilus-window .navigation-sidebar row label,\n"
            "window.nautilus-window placessidebar row label,\n"
            "window.nautilus-window row.sidebar-row label {\n"
            "    font-size: 13px;\n"
            "    margin-top: 0px;\n"
            "    margin-bottom: 0px;\n"
            "    padding-top: 0px;\n"
            "    padding-bottom: 0px;\n"
            "    color: rgba(255, 255, 255, 0.90);\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane placessidebar row:selected label,\n"
            "window.nautilus-window .sidebar-pane placessidebar list.navigation-sidebar row:selected label,\n"
            "window.nautilus-window .sidebar-pane list.navigation-sidebar row:selected label,\n"
            "window.nautilus-window .sidebar-pane row:selected label,\n"
            "window.nautilus-window .navigation-sidebar row:selected label,\n"
            "window.nautilus-window placessidebar row:selected label,\n"
            "window.nautilus-window row.sidebar-row:selected label {\n"
            "    color: @accent_bg_color;\n"
            "    font-weight: 500;\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    background-image: none;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane headerbar windowcontrols,\n"
            "window.nautilus-window headerbar windowcontrols,\n"
            "window.nautilus-window windowcontrols {\n"
            "    margin-top: -15px;\n"
            "    margin-bottom: 0px;\n"
            "    margin-left: 5px;\n"
            "    padding: 0px;\n"
            "}\n"
            "window.nautilus-window .sidebar-pane headerbar windowcontrols button.close,\n"
            "window.nautilus-window .sidebar-pane headerbar windowcontrols button.minimize,\n"
            "window.nautilus-window .sidebar-pane headerbar windowcontrols button.maximize {\n"
            "    min-width: 14px;\n"
            "    min-height: 14px;\n"
            "    padding: 0;\n"
            "    margin-top: 0px;\n"
            "}\n"
            "/* Remove checkerboard and box-shadow on all thumbnails in Nautilus */\n"
            "window.nautilus-window .view .thumbnail,\n"
            "window.nautilus-window .nautilus-properties .thumbnail,\n"
            "window.nautilus-window .nautilus-grid-view .thumbnail,\n"
            "window.nautilus-window .nautilus-list-view .thumbnail,\n"
            "window.nautilus-window gridview > child .thumbnail,\n"
            "window.nautilus-window columnview > listview > row .thumbnail,\n"
            ".view .thumbnail,\n"
            ".nautilus-properties .thumbnail,\n"
            ".nautilus-grid-view .thumbnail,\n"
            ".nautilus-list-view .thumbnail,\n"
            ".thumbnail,\n"
            ".icon .thumbnail,\n"
            ".grid-view .thumbnail,\n"
            "picture.thumbnail,\n"
            "image.thumbnail,\n"
            "widget.thumbnail {\n"
            "    background: none;\n"
            "    background-image: none;\n"
            "    background-color: transparent;\n"
            "    box-shadow: none;\n"
            "    border-width: 0px;\n"
            "    border-style: none;\n"
            "    border-radius: 0px;\n"
            "}\n"
            ".view .thumbnail {\n"
            "    filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.3));\n"
            "}\n"
            "/* macW1Y-style selection: icon background transparent, only filename pill highlighted */\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected,\n"
            "window.nautilus-window gridview > child:selected,\n"
            ".nautilus-grid-view gridview > child:selected,\n"
            "gridview > child:selected {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    box-shadow: none;\n"
            "    outline: none;\n"
            "    border: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected:hover,\n"
            "window.nautilus-window gridview > child:selected:hover,\n"
            ".nautilus-grid-view gridview > child:selected:hover,\n"
            "gridview > child:selected:hover,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:hover,\n"
            "window.nautilus-window gridview > child:hover,\n"
            ".nautilus-grid-view gridview > child:hover,\n"
            "gridview > child:hover {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    box-shadow: none;\n"
            "    border: none;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child .icon-ui-labels-box,\n"
            "window.nautilus-window gridview > child .icon-ui-labels-box,\n"
            ".nautilus-grid-view gridview > child .icon-ui-labels-box,\n"
            "gridview > child .icon-ui-labels-box,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected .icon-ui-labels-box,\n"
            "window.nautilus-window gridview > child:selected .icon-ui-labels-box,\n"
            ".nautilus-grid-view gridview > child:selected .icon-ui-labels-box,\n"
            "gridview > child:selected .icon-ui-labels-box {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child .icon-ui-labels-box #label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child #labels_box #label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child label#label,\n"
            "window.nautilus-window gridview > child .icon-ui-labels-box #label,\n"
            "window.nautilus-window gridview > child label#label,\n"
            ".nautilus-grid-view gridview > child .icon-ui-labels-box #label,\n"
            ".nautilus-grid-view gridview > child label#label,\n"
            "gridview > child .icon-ui-labels-box #label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected .icon-ui-labels-box #label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected #labels_box #label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected label#label,\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected label:not(.caption):not(.dim-label),\n"
            "window.nautilus-window gridview > child:selected .icon-ui-labels-box #label,\n"
            "window.nautilus-window gridview > child:selected label#label,\n"
            ".nautilus-grid-view gridview > child:selected .icon-ui-labels-box #label,\n"
            ".nautilus-grid-view gridview > child:selected label#label,\n"
            "gridview > child:selected .icon-ui-labels-box #label {\n"
            "    background-color: transparent;\n"
            "    background: transparent;\n"
            "    color: #ffffff;\n"
            "    border: none;\n"
            "    box-shadow: none;\n"
            "    border-radius: 0px;\n"
            "    padding: 4px 6px;\n"
            "    margin: 1px 2px;\n"
            "}\n"
            "window.nautilus-window .nautilus-grid-view gridview > child:selected label.caption,\n"
            "window.nautilus-window gridview > child:selected label.caption,\n"
            ".nautilus-grid-view gridview > child:selected label.caption,\n"
            "gridview > child:selected label.caption {\n"
            "    color: rgba(255, 255, 255, 0.70);\n"
            "}\n"
            "/* macOS-style floating capsule banner & rounded button (e.g. Trash Bar) */\n"
            "window.nautilus-window banner,\n"
            "window.nautilus-window adwbanner,\n"
            "window.nautilus-window infobar,\n"
            ".nautilus-window banner,\n"
            ".nautilus-window adwbanner,\n"
            ".nautilus-window infobar,\n"
            "window.nautilus-window banner > revealer,\n"
            "window.nautilus-window adwbanner > revealer,\n"
            "window.nautilus-window infobar > revealer,\n"
            ".nautilus-window banner > revealer,\n"
            ".nautilus-window adwbanner > revealer,\n"
            ".nautilus-window infobar > revealer {\n"
            "    background: transparent;\n"
            "    background-color: transparent;\n"
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
            "window.nautilus-window infobar > revealer > box,\n"
            ".nautilus-window banner > revealer > widget,\n"
            ".nautilus-window banner > revealer > box,\n"
            ".nautilus-window adwbanner > revealer > widget,\n"
            ".nautilus-window adwbanner > revealer > box,\n"
            ".nautilus-window infobar > revealer > widget,\n"
            ".nautilus-window infobar > revealer > box {\n"
            "    border-radius: 9999px;\n"
            "    background-color: rgba(255, 255, 255, 0.09);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.10);\n"
            "    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);\n"
            "    padding: 4px 16px;\n"
            "    margin: 6px 16px 8px 16px;\n"
            "}\n"
            "window.nautilus-window.mac-theme-light banner > revealer > widget,\n"
            "window.nautilus-window.mac-theme-light banner > revealer > box,\n"
            "window.nautilus-window.mac-theme-light adwbanner > revealer > widget,\n"
            "window.nautilus-window.mac-theme-light adwbanner > revealer > box,\n"
            "window.nautilus-window.mac-theme-light infobar > revealer > widget,\n"
            "window.nautilus-window.mac-theme-light infobar > revealer > box,\n"
            ".mac-theme-light .nautilus-window banner > revealer > widget,\n"
            ".mac-theme-light .nautilus-window banner > revealer > box,\n"
            ".mac-theme-light .nautilus-window adwbanner > revealer > widget,\n"
            ".mac-theme-light .nautilus-window adwbanner > revealer > box,\n"
            ".mac-theme-light .nautilus-window infobar > revealer > widget,\n"
            ".mac-theme-light .nautilus-window infobar > revealer > box {\n"
            "    background-color: rgba(0, 0, 0, 0.06);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.08);\n"
            "    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);\n"
            "}\n"
            "window.nautilus-window banner button,\n"
            "window.nautilus-window adwbanner button,\n"
            "window.nautilus-window infobar button,\n"
            ".nautilus-window banner button,\n"
            ".nautilus-window adwbanner button,\n"
            ".nautilus-window infobar button {\n"
            "    border-radius: 9999px;\n"
            "    min-height: 24px;\n"
            "    padding: 2px 14px;\n"
            "    background-color: rgba(255, 255, 255, 0.12);\n"
            "    border: 1px solid rgba(255, 255, 255, 0.14);\n"
            "    color: #ffffff;\n"
            "    margin-right: -8px;\n"
            "}\n"
            "window.nautilus-window banner button:hover,\n"
            "window.nautilus-window adwbanner button:hover,\n"
            "window.nautilus-window infobar button:hover,\n"
            ".nautilus-window banner button:hover,\n"
            ".nautilus-window adwbanner button:hover,\n"
            ".nautilus-window infobar button:hover {\n"
            "    background-color: rgba(255, 255, 255, 0.20);\n"
            "    border-color: rgba(255, 255, 255, 0.22);\n"
            "}\n"
            "window.nautilus-window banner button:active,\n"
            "window.nautilus-window adwbanner button:active,\n"
            "window.nautilus-window infobar button:active,\n"
            ".nautilus-window banner button:active,\n"
            ".nautilus-window adwbanner button:active,\n"
            ".nautilus-window infobar button:active {\n"
            "    background-color: rgba(255, 255, 255, 0.28);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light banner button,\n"
            "window.nautilus-window.mac-theme-light adwbanner button,\n"
            "window.nautilus-window.mac-theme-light infobar button,\n"
            ".mac-theme-light .nautilus-window banner button,\n"
            ".mac-theme-light .nautilus-window adwbanner button,\n"
            ".mac-theme-light .nautilus-window infobar button {\n"
            "    background-color: rgba(0, 0, 0, 0.06);\n"
            "    border: 1px solid rgba(0, 0, 0, 0.08);\n"
            "    color: rgba(0, 0, 0, 0.88);\n"
            "}\n"
            "window.nautilus-window.mac-theme-light banner button:hover,\n"
            "window.nautilus-window.mac-theme-light adwbanner button:hover,\n"
            "window.nautilus-window.mac-theme-light infobar button:hover,\n"
            ".mac-theme-light .nautilus-window banner button:hover,\n"
            ".mac-theme-light .nautilus-window adwbanner button:hover,\n"
            ".mac-theme-light .nautilus-window infobar button:hover {\n"
            "    background-color: rgba(0, 0, 0, 0.10);\n"
            "    border-color: rgba(0, 0, 0, 0.12);\n"
            "}\n"
            "window.nautilus-window banner button:dir(rtl),\n"
            "window.nautilus-window adwbanner button:dir(rtl),\n"
            "window.nautilus-window infobar button:dir(rtl),\n"
            ".nautilus-window banner button:dir(rtl),\n"
            ".nautilus-window adwbanner button:dir(rtl),\n"
            ".nautilus-window infobar button:dir(rtl) {\n"
            "    margin-left: -8px;\n"
            "    margin-right: 0px;\n"
            "}\n"
            "window.nautilus-window banner button label,\n"
            "window.nautilus-window adwbanner button label,\n"
            "window.nautilus-window infobar button label,\n"
            ".nautilus-window banner button label,\n"
            ".nautilus-window adwbanner button label,\n"
            ".nautilus-window infobar button label {\n"
            "    border-radius: 9999px;\n"
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

        gtk_widget_add_css_class(GTK_WIDGET(sidebar_hb), "nautilus-sidebar-headerbar");
        gtk_widget_add_css_class(GTK_WIDGET(content_hb), "nautilus-content-headerbar");

        GtkWidget *search_btn = NULL;
        GtkWidget *menu_btn = NULL;
        find_buttons_in_sidebar(GTK_WIDGET(sidebar_hb), &search_btn, &menu_btn);
        fprintf(stderr, "[MAC-NAUTILUS] find_buttons_in_sidebar: search_btn=%p, menu_btn=%p\n",
                (void*)search_btn, (void*)menu_btn);


        adw_header_bar_set_show_title(sidebar_hb, FALSE);
        adw_header_bar_set_title_widget(sidebar_hb, NULL);


        adw_header_bar_set_show_start_title_buttons(sidebar_hb, TRUE);
        adw_header_bar_set_show_end_title_buttons(sidebar_hb, FALSE);
        adw_header_bar_set_show_start_title_buttons(content_hb, FALSE);
        adw_header_bar_set_show_end_title_buttons(content_hb, FALSE);


        if (menu_btn) {
            remove_from_headerbar(sidebar_hb, menu_btn);
        }
        if (search_btn) {
            g_object_ref(search_btn);
            remove_from_headerbar(sidebar_hb, search_btn);
            gtk_widget_set_visible(search_btn, TRUE);
            gtk_widget_set_valign(search_btn, GTK_ALIGN_CENTER);
            gtk_widget_set_halign(search_btn, GTK_ALIGN_CENTER);
            gtk_widget_set_size_request(search_btn, 26, 26);
            gtk_widget_add_css_class(search_btn, "mac-circle-button");
            gtk_widget_add_css_class(search_btn, "mac-search-button");
            adw_header_bar_pack_end(content_hb, search_btn);
            fprintf(stderr, "[MAC-NAUTILUS] Reparented search_btn to content_hb, visible=%d\n",
                    gtk_widget_get_visible(search_btn));
            g_object_unref(search_btn);
        }


        hide_folder_search_button(GTK_WIDGET(content_hb));
        find_and_style_pathbar(GTK_WIDGET(content_hb));


        gtk_widget_set_margin_top(GTK_WIDGET(content_hb), 0);
        gtk_widget_set_margin_top(GTK_WIDGET(sidebar_hb), 0);
        gtk_widget_set_margin_bottom(GTK_WIDGET(content_hb), 0);
        gtk_widget_set_margin_bottom(GTK_WIDGET(sidebar_hb), 0);
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
        install_mac_popover_hooks();
        install_mac_grid_label_hooks();
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
        install_mac_popover_hooks();
        install_mac_grid_label_hooks();
        find_and_enable_scrolled_windows(GTK_WIDGET(window));
        mac_fix_nautilus_window(window);
        g_idle_add(mac_fix_nautilus_window, window);
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
