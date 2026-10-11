import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'blur-my-shell@aunetx';
const POPUP_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell.popup';

// Blur my Shell's popup settings, from the schemas it ships in the user's or a
// system extension directory, as its own getSettings() reads them.
function popupSettings() {
  const defaultSource = Gio.SettingsSchemaSource.get_default();
  const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
    .map(dir => GLib.build_filenamev([dir, 'gnome-shell', 'extensions', UUID, 'schemas']));
  for (const dir of dirs) {
    if (!GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS)) continue;
    // Loading a compiled schema file throws a GError when it is unreadable.
    try {
      const schema = Gio.SettingsSchemaSource.new_from_directory(dir, defaultSource, false).lookup(POPUP_SCHEMA, false);
      if (schema) return new Gio.Settings({settings_schema: schema});
    } catch {
      continue;
    }
  }
  const schema = defaultSource?.lookup(POPUP_SCHEMA, true);
  return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

// Shown while the shell reports Blur my Shell's popup blur on: it repaints the
// menus, notifications and OSDs under the glass, where it shows through.
export function addBlurMyShellWarning(page, controls) {
  const group = new Adw.PreferencesGroup();
  const row = new Adw.ActionRow({
    title: 'Blur my Shell is blurring popups',
    subtitle: 'Its blur shows through the glass on menus, notifications and OSDs. Turn off Popups in Blur my Shell.',
  });
  row.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
  const popup = popupSettings();
  if (popup) {
    const button = new Gtk.Button({label: 'Turn Off', valign: Gtk.Align.CENTER});
    button.connect('clicked', () => popup.set_boolean('blur', false));
    row.add_suffix(button);
  }
  group.add(row);
  page.add(group);
  controls.watch(['blur-my-shell-popup-blur'], () => {
    group.visible = controls.settings.get_boolean('blur-my-shell-popup-blur');
  });
}
