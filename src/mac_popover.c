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

/* =========================================================================
 * macOS Tahoe Window Controls Liquid Glass Jelly Drag & Spring Physics
 * ========================================================================= */
static void (*orig_wc_map)(GtkWidget *widget) = NULL;
static void (*orig_wc_snapshot)(GtkWidget *widget, GtkSnapshot *snapshot) = NULL;

typedef struct {
    gboolean is_dragging;
    gboolean is_holding;
    guint hold_timer_id;
    GtkGesture *gesture;
    GtkWidget *wc_widget;
    double start_x, start_y;
    double offset_x, offset_y;
    double cur_sx, cur_sy;
    double cur_tx, cur_ty;
    double vel_sx, vel_sy;
    double vel_tx, vel_ty;
    guint tick_id;
    gint64 last_time;
    int target_button_idx; /* 0: close, 1: min, 2: max */
} MacWcDragData;

static MacWcDragData *get_wc_drag_data(GtkWidget *w) {
    MacWcDragData *d = g_object_get_data(G_OBJECT(w), "mac_wc_drag_data");
    if (!d) {
        d = g_new0(MacWcDragData, 1);
        d->cur_sx = 1.0;
        d->cur_sy = 1.0;
        g_object_set_data_full(G_OBJECT(w), "mac_wc_drag_data", d, g_free);
    }
    return d;
}

static gboolean mac_wc_spring_tick(GtkWidget *widget, GdkFrameClock *clock, gpointer user_data) {
    MacWcDragData *d = (MacWcDragData *)user_data;
    gint64 now = gdk_frame_clock_get_frame_time(clock);
    if (d->last_time == 0) {
        d->last_time = now;
        return G_SOURCE_CONTINUE;
    }
    double dt = (double)(now - d->last_time) / 1000000.0;
    d->last_time = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0.0) return G_SOURCE_CONTINUE;

    double stiffness = 280.0;
    double damping = 16.0;

    double f_sx = -stiffness * (d->cur_sx - 1.0) - damping * d->vel_sx;
    d->vel_sx += f_sx * dt;
    d->cur_sx += d->vel_sx * dt;

    double f_sy = -stiffness * (d->cur_sy - 1.0) - damping * d->vel_sy;
    d->vel_sy += f_sy * dt;
    d->cur_sy += d->vel_sy * dt;

    double f_tx = -stiffness * d->cur_tx - damping * d->vel_tx;
    d->vel_tx += f_tx * dt;
    d->cur_tx += d->vel_tx * dt;

    double f_ty = -stiffness * d->cur_ty - damping * d->vel_ty;
    d->vel_ty += f_ty * dt;
    d->cur_ty += d->vel_ty * dt;

    gtk_widget_queue_draw(widget);

    gboolean settled = (fabs(d->cur_sx - 1.0) < 0.005) &&
                       (fabs(d->cur_sy - 1.0) < 0.005) &&
                       (fabs(d->cur_tx) < 0.1) &&
                       (fabs(d->cur_ty) < 0.1) &&
                       (fabs(d->vel_sx) < 0.01) &&
                       (fabs(d->vel_sy) < 0.01);

    if (settled) {
        d->cur_sx = 1.0;
        d->cur_sy = 1.0;
        d->cur_tx = 0.0;
        d->cur_ty = 0.0;
        d->vel_sx = 0.0; d->vel_sy = 0.0;
        d->vel_tx = 0.0; d->vel_ty = 0.0;
        d->tick_id = 0;
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

static gboolean on_wc_hold_timeout(gpointer user_data) {
    MacWcDragData *d = (MacWcDragData *)user_data;
    d->hold_timer_id = 0;
    if (d->is_dragging) {
        d->is_holding = TRUE;
        d->cur_sx = 1.18;
        d->cur_sy = 1.18;
        if (d->gesture) {
            gtk_gesture_set_state(d->gesture, GTK_EVENT_SEQUENCE_CLAIMED);
        }
        if (d->wc_widget) {
            gtk_widget_queue_draw(d->wc_widget);
        }
    }
    return G_SOURCE_REMOVE;
}

static void on_wc_drag_begin(GtkGestureDrag *gesture, double start_x, double start_y, gpointer user_data) {
    GtkWidget *wc = GTK_WIDGET(user_data);

    MacWcDragData *d = get_wc_drag_data(wc);
    if (d->tick_id) {
        gtk_widget_remove_tick_callback(wc, d->tick_id);
        d->tick_id = 0;
    }
    if (d->hold_timer_id) {
        g_source_remove(d->hold_timer_id);
        d->hold_timer_id = 0;
    }

    d->gesture = GTK_GESTURE(gesture);
    d->wc_widget = wc;
    d->is_dragging = TRUE;
    d->is_holding = FALSE;
    d->start_x = start_x;
    d->start_y = start_y;
    d->offset_x = 0;
    d->offset_y = 0;
    d->cur_sx = 1.0;
    d->cur_sy = 1.0;
    d->cur_tx = 0;
    d->cur_ty = 0;
    d->vel_sx = 0; d->vel_sy = 0;
    d->vel_tx = 0; d->vel_ty = 0;

    /* Do NOT claim sequence on begin; allow standard click events to reach child GtkButtons */
    gtk_gesture_set_state(GTK_GESTURE(gesture), GTK_EVENT_SEQUENCE_NONE);

    /* Determine target button index based on child bounds */
    int b_idx = 0;
    int found_idx = -1;
    double min_dist_to_center = 1e9;
    int closest_idx = 0;

    for (GtkWidget *child = gtk_widget_get_first_child(wc); child != NULL; child = gtk_widget_get_next_sibling(child), b_idx++) {
        graphene_rect_t b;
        if (gtk_widget_compute_bounds(child, wc, &b)) {
            double center_x = (double)b.origin.x + (double)b.size.width * 0.5;
            double dist_to_center = fabs(start_x - center_x);
            if (dist_to_center < min_dist_to_center) {
                min_dist_to_center = dist_to_center;
                closest_idx = b_idx;
            }
            if (start_x >= (double)b.origin.x - 2.0 && start_x <= (double)b.origin.x + (double)b.size.width + 2.0) {
                found_idx = b_idx;
            }
        }
    }
    if (found_idx >= 0) {
        d->target_button_idx = found_idx;
    } else if (min_dist_to_center < 50.0) {
        d->target_button_idx = closest_idx;
    } else {
        if (start_x < 24.0) d->target_button_idx = 0;
        else if (start_x < 46.0) d->target_button_idx = 1;
        else d->target_button_idx = 2;
    }

    /* Start hold timer (280ms): only activate jelly if held! */
    d->hold_timer_id = g_timeout_add(280, on_wc_hold_timeout, d);
}

static void on_wc_drag_update(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    GtkWidget *wc = GTK_WIDGET(user_data);
    MacWcDragData *d = get_wc_drag_data(wc);
    if (!d->is_dragging) return;

    d->offset_x = offset_x;
    d->offset_y = offset_y;

    double dist = hypot(offset_x, offset_y);
    if (!d->is_holding && dist > 5.0) {
        if (d->hold_timer_id) {
            g_source_remove(d->hold_timer_id);
            d->hold_timer_id = 0;
        }
        d->is_holding = TRUE;
        if (d->gesture) {
            gtk_gesture_set_state(d->gesture, GTK_EVENT_SEQUENCE_CLAIMED);
        }
    }

    if (!d->is_holding) return;

    if (dist > 0.5) {
        /* Smooth elastic stretch and volume-preserving compression */
        double stretch = 1.15 + fmin(dist * 0.025, 0.45); /* Max stretch ~1.60 */
        double compress = fmax(0.70, 1.15 / sqrt(stretch / 1.15));

        /* Smooth continuous interpolation between horizontal and vertical axes (ZERO abrupt snap!) */
        double t_axis = (dist > 0.001) ? (offset_x * offset_x) / (dist * dist) : 0.5;
        d->cur_sx = compress + (stretch - compress) * t_axis;
        d->cur_sy = stretch - (stretch - compress) * t_axis;

        /* Damped elastic translation tracking cursor with smooth limits */
        double max_tx = 36.0;
        double max_ty = 24.0;
        d->cur_tx = CLAMP(offset_x * 0.35, -max_tx, max_tx);
        d->cur_ty = CLAMP(offset_y * 0.35, -max_ty, max_ty);
    } else {
        d->cur_sx = 1.15;
        d->cur_sy = 1.15;
        d->cur_tx = 0.0;
        d->cur_ty = 0.0;
    }

    gtk_widget_queue_draw(wc);
}

static void on_wc_drag_end(GtkGestureDrag *gesture, double offset_x, double offset_y, gpointer user_data) {
    GtkWidget *wc = GTK_WIDGET(user_data);
    MacWcDragData *d = get_wc_drag_data(wc);
    if (!d->is_dragging) return;
    d->is_dragging = FALSE;

    if (d->hold_timer_id) {
        g_source_remove(d->hold_timer_id);
        d->hold_timer_id = 0;
    }

    if (!d->is_holding) {
        /* Simple click without holding: DO NOT animate, keep 1.0! */
        d->cur_sx = 1.0;
        d->cur_sy = 1.0;
        d->cur_tx = 0.0;
        d->cur_ty = 0.0;
        gtk_widget_queue_draw(wc);
        gtk_gesture_set_state(GTK_GESTURE(gesture), GTK_EVENT_SEQUENCE_DENIED);
        return;
    }

    d->is_holding = FALSE;
    d->last_time = 0;
    if (d->tick_id == 0) {
        d->tick_id = gtk_widget_add_tick_callback(wc, mac_wc_spring_tick, d, NULL);
    }

    /* Check if pointer is still over widget after release to keep or clear hover state */
    if (!gtk_widget_contains(wc, d->start_x + offset_x, d->start_y + offset_y)) {
        gtk_widget_remove_css_class(wc, "mac-controls-hover");
        for (GtkWidget *child = gtk_widget_get_first_child(wc); child != NULL; child = gtk_widget_get_next_sibling(child)) {
            gtk_widget_remove_css_class(child, "mac-group-hover");
        }
    }
}

static void mac_wc_snapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
    MacWcDragData *d = get_wc_drag_data(widget);
    if (!d || (!d->is_holding && fabs(d->cur_sx - 1.0) < 0.001 && fabs(d->cur_sy - 1.0) < 0.001 && fabs(d->cur_tx) < 0.01 && fabs(d->cur_ty) < 0.01)) {
        if (orig_wc_snapshot) orig_wc_snapshot(widget, snapshot);
        return;
    }

    /* Step 1: Draw non-target static buttons first */
    GtkWidget *target_child = NULL;
    int idx = 0;
    for (GtkWidget *child = gtk_widget_get_first_child(widget);
         child != NULL;
         child = gtk_widget_get_next_sibling(child), idx++) {
        if (idx == d->target_button_idx) {
            target_child = child;
        } else {
            gtk_widget_snapshot_child(widget, child, snapshot);
        }
    }

    /* Step 2: Draw the target (jelly) button last so it renders on top around ITS OWN center */
    if (target_child) {
        graphene_rect_t bounds;
        float cx, cy;
        if (gtk_widget_compute_bounds(target_child, widget, &bounds)) {
            cx = bounds.origin.x + bounds.size.width * 0.5f;
            cy = bounds.origin.y + bounds.size.height * 0.5f;
        } else {
            float cw = (float)gtk_widget_get_width(target_child);
            float ch = (float)gtk_widget_get_height(target_child);
            cx = (float)d->target_button_idx * 21.0f + cw * 0.5f;
            cy = ch * 0.5f;
        }

        graphene_point_t p1, p2;
        graphene_point_init(&p1, cx + (float)d->cur_tx, cy + (float)d->cur_ty);
        graphene_point_init(&p2, -cx, -cy);

        GskTransform *t = gsk_transform_translate(NULL, &p1);
        t = gsk_transform_scale(t, (float)d->cur_sx, (float)d->cur_sy);
        t = gsk_transform_translate(t, &p2);

        gtk_snapshot_save(snapshot);
        gtk_snapshot_transform(snapshot, t);
        gsk_transform_unref(t);

        gtk_widget_snapshot_child(widget, target_child, snapshot);

        gtk_snapshot_restore(snapshot);
    }
}

static void on_wc_motion_enter(GtkEventControllerMotion *ctrl, double x, double y, gpointer user_data) {
    GtkWidget *wc = GTK_WIDGET(user_data);
    gtk_widget_add_css_class(wc, "mac-controls-hover");
    for (GtkWidget *child = gtk_widget_get_first_child(wc);
         child != NULL;
         child = gtk_widget_get_next_sibling(child)) {
        gtk_widget_add_css_class(child, "mac-group-hover");
    }
}

static void on_wc_motion_leave(GtkEventControllerMotion *ctrl, gpointer user_data) {
    GtkWidget *wc = GTK_WIDGET(user_data);
    MacWcDragData *d = get_wc_drag_data(wc);
    if (d && (d->is_dragging || d->is_holding)) {
        /* Keep group hover active while user is dragging jelly */
        return;
    }
    gtk_widget_remove_css_class(wc, "mac-controls-hover");
    for (GtkWidget *child = gtk_widget_get_first_child(wc);
         child != NULL;
         child = gtk_widget_get_next_sibling(child)) {
        gtk_widget_remove_css_class(child, "mac-group-hover");
    }
}

static void mac_wc_map(GtkWidget *w) {
    if (orig_wc_map) orig_wc_map(w);

    if (!g_object_get_data(G_OBJECT(w), "mac_wc_gesture_installed")) {
        g_object_set_data(G_OBJECT(w), "mac_wc_gesture_installed", GINT_TO_POINTER(1));
        
        GtkGesture *gesture = gtk_gesture_drag_new();
        gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(gesture), 1);
        gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(gesture), GTK_PHASE_CAPTURE);
        g_signal_connect(gesture, "drag-begin", G_CALLBACK(on_wc_drag_begin), w);
        g_signal_connect(gesture, "drag-update", G_CALLBACK(on_wc_drag_update), w);
        g_signal_connect(gesture, "drag-end", G_CALLBACK(on_wc_drag_end), w);
        gtk_widget_add_controller(w, GTK_EVENT_CONTROLLER(gesture));

        GtkEventController *motion = gtk_event_controller_motion_new();
        gtk_event_controller_set_propagation_phase(motion, GTK_PHASE_CAPTURE);
        g_signal_connect(motion, "enter", G_CALLBACK(on_wc_motion_enter), w);
        g_signal_connect(motion, "leave", G_CALLBACK(on_wc_motion_leave), w);
        gtk_widget_add_controller(w, motion);
    }
}

static void install_mac_wc_hooks(void) {
    static gboolean installed = FALSE;
    if (installed) return;
    installed = TRUE;

    g_type_ensure(GTK_TYPE_WINDOW_CONTROLS);
    GtkWidgetClass *klass = GTK_WIDGET_CLASS(g_type_class_ref(GTK_TYPE_WINDOW_CONTROLS));
    if (klass) {
        orig_wc_map = klass->map;
        klass->map = mac_wc_map;
        orig_wc_snapshot = klass->snapshot;
        klass->snapshot = mac_wc_snapshot;
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
    install_mac_wc_hooks();
}
