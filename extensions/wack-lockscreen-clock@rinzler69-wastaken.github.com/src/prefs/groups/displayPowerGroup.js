import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export function buildDisplayPowerGroup(settings, _, settingsSignalIds) {
    const displayPowerGroup = new Adw.PreferencesGroup({
        title: _('Display and Power'),
    });

    const enableUnblankRow = new Adw.ExpanderRow({
        title: _('Keep Screen On'),
        subtitle: _('Prevent the screen from immediately turning off when locked. The screen will still turn off after the normal timeout duration set in system settings.'),
        show_enable_switch: true,
    });
    enableUnblankRow.enable_expansion = settings.get_boolean('enable-unblank');
    enableUnblankRow.connect('notify::enable-expansion', () => {
        settings.set_boolean('enable-unblank', enableUnblankRow.enable_expansion);
    });
    settingsSignalIds.push(settings.connect('changed::enable-unblank', () => {
        enableUnblankRow.enable_expansion = settings.get_boolean('enable-unblank');
    }));
    displayPowerGroup.add(enableUnblankRow);

    const unblankOnAcOnlyRow = new Adw.ActionRow({
        title: _('Only on AC Power'),
        subtitle: _('Only keep the screen on if the system is plugged in'),
    });
    const unblankOnAcOnlySwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        active: settings.get_boolean('unblank-on-ac-only'),
    });
    unblankOnAcOnlySwitch.connect('notify::active', () => {
        settings.set_boolean('unblank-on-ac-only', unblankOnAcOnlySwitch.active);
    });
    settingsSignalIds.push(settings.connect('changed::unblank-on-ac-only', () => {
        unblankOnAcOnlySwitch.active = settings.get_boolean('unblank-on-ac-only');
    }));
    unblankOnAcOnlyRow.add_suffix(unblankOnAcOnlySwitch);
    unblankOnAcOnlyRow.activatable_widget = unblankOnAcOnlySwitch;
    enableUnblankRow.add_row(unblankOnAcOnlyRow);

    const escToSleepRow = new Adw.ActionRow({
        title: _('Escape to Sleep / Suspend'),
        subtitle: _('Press Escape on the lock screen to sleep display (or suspend)'),
    });
    const escToSleepSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        active: settings.get_boolean('esc-to-sleep'),
    });
    escToSleepSwitch.connect('notify::active', () => {
        settings.set_boolean('esc-to-sleep', escToSleepSwitch.active);
    });
    settingsSignalIds.push(settings.connect('changed::esc-to-sleep', () => {
        escToSleepSwitch.active = settings.get_boolean('esc-to-sleep');
    }));
    escToSleepRow.add_suffix(escToSleepSwitch);
    escToSleepRow.activatable_widget = escToSleepSwitch;
    displayPowerGroup.add(escToSleepRow);

    return displayPowerGroup;
}
