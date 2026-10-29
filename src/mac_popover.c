#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <math.h>
#include <gtk/gtk.h>
#include <gsk/gsk.h>
#include <graphene.h>

/* =========================================================================
 * macOS Tahoe GtkPopover Smooth Open & Close Animation (Opacity + Scaling)
 * ========================================================================= */
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
    double p = (double)elapsed / 110000.0; /* 110ms macOS quad ease-in */
    if (p >= 1.0) p = 1.0;

    double opacity = 1.0 - (p * p);
    double scale = 1.0 - 0.05 * (p * p); /* 1.0 -> 0.95 */
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
    double p = (double)elapsed / 140000.0; /* 140ms macOS cubic ease-out */
    if (p >= 1.0) p = 1.0;

    double ease = 1.0 - pow(1.0 - p, 3);
    double scale = 0.94 + 0.06 * ease; /* 0.94 -> 1.0 */
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

__attribute__((constructor))
static void ctor_mac_popover(void) {
    /* Safety guard: only initialize if GTK is linked and active in process */
    if (!dlsym(RTLD_DEFAULT, "gtk_init")) {
        return;
    }
    g_type_ensure(GTK_TYPE_POPOVER);
    install_mac_popover_hooks();
}
