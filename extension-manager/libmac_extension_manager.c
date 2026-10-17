#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <glib.h>
#include <glib-object.h>
#include <gio/gio.h>

/* GTK4 & Libadwaita forward declarations */
extern void *adw_preferences_group_new(void);
extern void adw_preferences_group_set_title(void *group, const char *title);
extern void adw_preferences_group_add(void *group, void *child);
extern void *adw_expander_row_new(void);
extern void adw_preferences_row_set_title(void *row, const char *title);
extern void adw_expander_row_set_subtitle(void *row, const char *subtitle);
extern void adw_expander_row_set_icon_name(void *row, const char *icon_name);
extern void adw_expander_row_set_expanded(void *row, gboolean expanded);
extern void adw_expander_row_add_row(void *row, void *child);
extern void adw_preferences_page_add(void *page, void *group);
extern void *gtk_widget_get_parent(void *widget);
extern const char *adw_preferences_group_get_title(void *group);
extern void *gtk_custom_filter_new(gboolean (*match_func)(gpointer, gpointer), gpointer user_data, GDestroyNotify user_destroy);
extern void *gtk_filter_list_model_new(void *model, void *filter);

static const char * const MACW1Y_UUIDS[] = {
    "appmenu@ChathurangaBW.github.io",
    "blur-my-shell@aunetx",
    "compiz-alike-magic-lamp-effect@hermes83.github.com",
    "dash-to-dock@micxgx.gmail.com",
    "eval-helper@mactheme",
    "liquid-glass@thinkingcoding1231.gmail.com",
    "macos-touchpad-gestures@mactheme",
    "Rounded_Corners@lennart-k",
    "stage-manager@gnome-stage-manager",
    "user-theme@gnome-shell-extensions.gcampax.github.com",
    "wack-lockscreen-clock@rinzler69-wastaken.github.com",
    NULL
};

static gboolean is_macw1y_uuid(const char *uuid) {
    if (!uuid) return FALSE;
    for (int i = 0; MACW1Y_UUIDS[i] != NULL; i++) {
        if (strcmp(uuid, MACW1Y_UUIDS[i]) == 0) return TRUE;
    }
    return FALSE;
}

static gboolean filter_out_macw1y(gpointer item, gpointer user_data) {
    if (!item) return FALSE;
    char *uuid = NULL;
    g_object_get(item, "uuid", &uuid, NULL);
    if (!uuid) return TRUE;
    gboolean is_mac = is_macw1y_uuid(uuid);
    g_free(uuid);
    return !is_mac;
}

typedef void *(*CreateWidgetFunc)(gpointer item, gpointer user_data);

typedef struct {
    void *expander;
    GListModel *model;
    CreateWidgetFunc create_widget_func;
    gpointer user_data;
} MacW1YBinding;

static void populate_macw1y_expander(MacW1YBinding *binding) {
    if (!binding || !binding->expander || !binding->model) return;
    
    guint n = g_list_model_get_n_items(binding->model);
    int mac_count = 0;
    for (guint i = 0; i < n; i++) {
        gpointer item = g_list_model_get_object(binding->model, i);
        if (item) {
            char *uuid = NULL;
            char *name = NULL;
            g_object_get(item, "uuid", &uuid, "name", &name, NULL);
            if (uuid && is_macw1y_uuid(uuid)) {
                void *row = binding->create_widget_func(item, binding->user_data);
                if (row) {
                    adw_expander_row_add_row(binding->expander, row);
                    mac_count++;
                }
            }
            g_free(uuid);
            g_free(name);
            g_object_unref(item);
        }
    }
    
    char sub[128];
    snprintf(sub, sizeof(sub), "Модпак трансформації macOS (%d розширень)", mac_count);
    adw_expander_row_set_subtitle(binding->expander, sub);
}

static void *find_ancestor_preferences_page(void *widget) {
    void *cur = widget;
    while (cur) {
        GTypeInstance *inst = (GTypeInstance *)cur;
        if (inst && inst->g_class) {
            const char *type_name = g_type_name(inst->g_class->g_type);
            if (type_name && strcmp(type_name, "AdwPreferencesPage") == 0) {
                return cur;
            }
        }
        cur = gtk_widget_get_parent(cur);
    }
    return NULL;
}

void adw_preferences_group_bind_model(void *group, void *model, void *create_widget_func, void *user_data, void *destroy) {
    static void (*orig_bind_model)(void*, void*, void*, void*, void*) = NULL;
    if (!orig_bind_model) orig_bind_model = dlsym(RTLD_NEXT, "adw_preferences_group_bind_model");
    
    const char *title = adw_preferences_group_get_title(group);
    
    /* Search group has no title (or empty) */
    if (!title || strlen(title) == 0) {
        orig_bind_model(group, model, create_widget_func, user_data, destroy);
        return;
    }
    
    /* Check if this is the user extensions group */
    gboolean is_user_group = FALSE;
    if (G_IS_LIST_MODEL(model) && g_list_model_get_n_items(G_LIST_MODEL(model)) > 0) {
        gpointer first = g_list_model_get_object(G_LIST_MODEL(model), 0);
        if (first) {
            gboolean is_user = FALSE;
            g_object_get(first, "is-user", &is_user, NULL);
            is_user_group = is_user;
            g_object_unref(first);
        }
    }
    
    if (is_user_group) {
        /* 1. Filter out macW1Y from user_prefs_group */
        void *custom_filter = gtk_custom_filter_new(filter_out_macw1y, NULL, NULL);
        void *clean_user_model = gtk_filter_list_model_new(model, custom_filter);
        
        /* Bind clean model to user_prefs_group */
        orig_bind_model(group, clean_user_model, create_widget_func, user_data, destroy);
        
        /* Ensure user_prefs_group visibility follows clean_user_model item count */
        g_object_bind_property(clean_user_model, "n-items",
                               group, "visible",
                               G_BINDING_SYNC_CREATE);
        
        /* 2. Create the macW1Y expandable subgroup at the bottom of the page */
        void *parent_page = find_ancestor_preferences_page(group);
        if (parent_page) {
            void *mac_group = adw_preferences_group_new();
            void *mac_expander = adw_expander_row_new();
            
            adw_preferences_row_set_title(mac_expander, "macW1Y");
            adw_expander_row_set_subtitle(mac_expander, "Модпак трансформації macOS");
            adw_expander_row_set_icon_name(mac_expander, "preferences-desktop-theme-symbolic");
            adw_expander_row_set_expanded(mac_expander, FALSE);
            
            adw_preferences_group_add(mac_group, mac_expander);
            
            MacW1YBinding *binding = g_new0(MacW1YBinding, 1);
            binding->expander = mac_expander;
            binding->model = g_object_ref(G_LIST_MODEL(model));
            binding->create_widget_func = (CreateWidgetFunc)create_widget_func;
            binding->user_data = user_data;
            
            populate_macw1y_expander(binding);
            
            adw_preferences_page_add(parent_page, mac_group);
        }
        return;
    }
    
    orig_bind_model(group, model, create_widget_func, user_data, destroy);
}
