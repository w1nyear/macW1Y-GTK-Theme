import Adw from 'gi://Adw';

const LEGACY = {
  keyboard: ['enable-keyboard-menu-glass', 'Keyboard layout'],
  vitalsMenu: ['enable-vitals-menu-glass', 'Vitals'],
};

export function addPanelMenus(page, controls) {
  const group = controls.group(page, 'Detected top bar menus',
    'Menus of the other top bar indicators. The calendar and quick settings have their own settings.');
  const empty = new Adw.ActionRow({title: 'No additional menus detected'});
  group.add(empty);
  const rows = new Map();
  const settings = controls.settings;
  let syncing = false;
  const add = name => {
    const title = LEGACY[name]?.[1] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
    const row = new Adw.SwitchRow({title, use_markup: false});
    row.connect('notify::active', () => {
      if (syncing) return;
      if (LEGACY[name]) {
        controls.write({[LEGACY[name][0]]: row.active});
        return;
      }
      const disabled = new Set(settings.get_strv('disabled-extra-menus'));
      if (row.active) disabled.delete(name);
      else disabled.add(name);
      controls.write({'disabled-extra-menus': [...disabled].sort()});
    });
    rows.set(name, row);
    group.add(row);
    return row;
  };
  controls.watch(['detected-extra-menus', 'disabled-extra-menus', 'enable-extra-menu-glass',
    ...Object.values(LEGACY).map(([key]) => key)], () => {
    syncing = true;
    try {
      const names = settings.get_strv('detected-extra-menus');
      const disabled = new Set(settings.get_strv('disabled-extra-menus'));
      for (const [name, row] of rows) {
        if (names.includes(name)) continue;
        group.remove(row);
        rows.delete(name);
      }
      for (const name of names) {
        const row = rows.get(name) ?? add(name);
        row.active = LEGACY[name] ? settings.get_boolean(LEGACY[name][0]) : !disabled.has(name);
      }
      empty.visible = names.length === 0;
      group.sensitive = settings.get_boolean('enable-extra-menu-glass');
    } finally {
      syncing = false;
    }
  });
  return group;
}
