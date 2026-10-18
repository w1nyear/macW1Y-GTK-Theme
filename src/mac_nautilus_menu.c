#include <gtk/gtk.h>
#include <nautilus-extension.h>
#include <gio/gio.h>
#include <unistd.h>
#include <stdlib.h>

#define MAC_TYPE_APP_MENU_PROVIDER (mac_app_menu_provider_get_type ())

G_DECLARE_FINAL_TYPE (MacAppMenuProvider,
                      mac_app_menu_provider,
                      MAC, APP_MENU_PROVIDER,
                      GObject)

struct _MacAppMenuProvider {
    GObject parent_instance;
};

static void mac_app_menu_provider_iface_init (NautilusMenuProviderInterface *iface);

G_DEFINE_DYNAMIC_TYPE_EXTENDED (MacAppMenuProvider,
                                mac_app_menu_provider,
                                G_TYPE_OBJECT,
                                0,
                                G_IMPLEMENT_INTERFACE_DYNAMIC (NAUTILUS_TYPE_MENU_PROVIDER,
                                                               mac_app_menu_provider_iface_init))

static void mac_app_menu_provider_init (MacAppMenuProvider *self G_GNUC_UNUSED) {}
static void mac_app_menu_provider_class_init (MacAppMenuProviderClass *klass G_GNUC_UNUSED) {}
static void mac_app_menu_provider_class_finalize (MacAppMenuProviderClass *klass G_GNUC_UNUSED) {}

static void on_show_real_activate (NautilusMenuItem *item G_GNUC_UNUSED, gpointer user_data)
{
    const char *path = (const char *)user_data;
    if (!path) return;
    char target_path[PATH_MAX] = {0};
    
    GKeyFile *kf = g_key_file_new();
    if (g_key_file_load_from_file(kf, path, G_KEY_FILE_NONE, NULL)) {
        gchar *real = g_key_file_get_string(kf, "Desktop Entry", "X-Mac-Real-Path", NULL);
        if (real && g_file_test(real, G_FILE_TEST_EXISTS)) {
            g_strlcpy(target_path, real, sizeof(target_path));
        }
        g_free(real);
    }
    g_key_file_free(kf);
    
    if (target_path[0] == '\0') {
        if (!realpath(path, target_path)) {
            g_strlcpy(target_path, path, sizeof(target_path));
        }
    }
    
    char *cmd = g_strdup_printf("nautilus --select \"%s\" &", target_path);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
}

static void on_uninstall_activate (NautilusMenuItem *item G_GNUC_UNUSED, gpointer user_data)
{
    const char *path = (const char *)user_data;
    if (!path) return;
    char *cmd = g_strdup_printf("/usr/local/bin/mac-uninstall-app \"%s\" &", path);
    g_spawn_command_line_async(cmd, NULL);
    g_free(cmd);
}

static GList *mac_app_get_file_items (NautilusMenuProvider *provider G_GNUC_UNUSED, GList *files)
{
    if (!files || files->next != NULL) {
        return NULL;
    }
    
    NautilusFileInfo *file = NAUTILUS_FILE_INFO (files->data);
    gchar *uri = nautilus_file_info_get_uri (file);
    if (!uri) return NULL;
    
    gchar *path = g_filename_from_uri (uri, NULL, NULL);
    g_free (uri);
    if (!path) return NULL;
    
    const char *home = g_get_home_dir();
    char apps_prefix[512];
    snprintf(apps_prefix, sizeof(apps_prefix), "%s/Applications", home ? home : "");
    
    gboolean is_app = g_str_has_suffix (path, ".desktop") ||
                      (home && g_str_has_prefix (path, apps_prefix));
                      
    if (!is_app) {
        g_free (path);
        return NULL;
    }
    
    GList *items = NULL;
    
    NautilusMenuItem *item_show = nautilus_menu_item_new ("MacApp::ShowReal",
                                                          "Показати оригінал",
                                                          "Відкрити каталог із оригінальним файлом програми",
                                                          "folder-symbolic");
    g_signal_connect_data (item_show, "activate", G_CALLBACK (on_show_real_activate),
                           g_strdup (path), (GClosureNotify) g_free, 0);
    items = g_list_append (items, item_show);
    
    NautilusMenuItem *item_del = nautilus_menu_item_new ("MacApp::Uninstall",
                                                         "Видалити програму з системи…",
                                                         "Деінсталювати або видалити цей додаток",
                                                         "user-trash-symbolic");
    g_signal_connect_data (item_del, "activate", G_CALLBACK (on_uninstall_activate),
                           g_strdup (path), (GClosureNotify) g_free, 0);
    items = g_list_append (items, item_del);
    
    g_free (path);
    return items;
}

static void mac_app_menu_provider_iface_init (NautilusMenuProviderInterface *iface)
{
    iface->get_file_items = mac_app_get_file_items;
    iface->get_background_items = NULL;
}

void nautilus_module_initialize (GTypeModule *module)
{
    mac_app_menu_provider_register_type (module);
}

void nautilus_module_shutdown (void) {}

void nautilus_module_list_types (const GType **types, int *num_types)
{
    static GType type_list[1] = { 0 };
    type_list[0] = MAC_TYPE_APP_MENU_PROVIDER;
    *types = type_list;
    *num_types = G_N_ELEMENTS (type_list);
}
