import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { isWackShellInstalled, flushWackCache } from '../prefsUtils.js';



export function buildExtrasGroup(extensionPreferences, window, _) {
    const extrasGroup = new Adw.PreferencesGroup({
        title: _('Extras'),
    });

    let showDocs = true;

    

    if (showDocs) {
        const docsRow = new Adw.ActionRow({
            title: _('Upgrade to [PRO]'),
            subtitle: _('Check PRO features of this extension on this extension\'s GitHub repo.'),
        });
        const docsBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: _('Visit documentation on GitHub'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        docsBtn.connect('clicked', () => {
            Gtk.show_uri(window, extensionPreferences.metadata.url, GLib.CURRENT_TIME);
        });
        docsRow.add_suffix(docsBtn);
        extrasGroup.add(docsRow);
    }

    const wackShellExpander = new Adw.ExpanderRow({
        title: _('[BETA] WACK Shell Integration'),
    });
    const wackShellStatusLabel = new Gtk.Label({
        valign: Gtk.Align.CENTER,
    });

    const isInstalled = isWackShellInstalled();
    if (isInstalled) {
        wackShellExpander.subtitle = _('Installed. Enables crossfade transitions and Cupertino-inspired shell customisations.');
        wackShellStatusLabel.label = _('Installed');
        wackShellStatusLabel.add_css_class('success');
        wackShellExpander.add_suffix(wackShellStatusLabel);

        const checkUpdatesRow = new Adw.ActionRow({
            title: _('WACK Shell Repository'),
            subtitle: _('Open the WACK Shell repository for documentation and updates.'),
        });

        const linkBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: _('Open WACK Shell repository'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        linkBtn.connect('clicked', () => {
            Gtk.show_uri(window, 'https://github.com/rinzler69-wastaken/wack-shell', GLib.CURRENT_TIME);
        });

        checkUpdatesRow.add_suffix(linkBtn);
        wackShellExpander.add_row(checkUpdatesRow);
    } else {
        wackShellExpander.subtitle = _('Not installed. Install WACK Shell to unlock transition effects.');
        wackShellStatusLabel.label = _('Not Installed');
        wackShellStatusLabel.add_css_class('error');
        wackShellExpander.add_suffix(wackShellStatusLabel);

        const installShellRow = new Adw.ActionRow({
            title: _('WACK Shell Repository'),
            subtitle: _('Visit the repository to view installation instructions and release packages.'),
        });

        const linkBtn = new Gtk.Button({
            icon_name: 'adw-external-link-symbolic',
            tooltip_text: _('Open WACK Shell repository'),
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        linkBtn.connect('clicked', () => {
            Gtk.show_uri(window, 'https://github.com/rinzler69-wastaken/wack-shell', GLib.CURRENT_TIME);
        });

        installShellRow.add_suffix(linkBtn);
        wackShellExpander.add_row(installShellRow);
    }

    extrasGroup.add(wackShellExpander);

    const flushCacheRow = new Adw.ActionRow({
        title: _('Clear Visual Cache'),
        subtitle: _('Clears temporary visual data used for wallpapers and vibrancy effects. It will be regenerated automatically.'),
    });

    const flushBtn = new Gtk.Button({
        label: _('Clear'),
        tooltip_text: _('Clears the visual cache used for wallpapers and vibrancy effects'),
        css_classes: ['destructive-action'],
        valign: Gtk.Align.CENTER,
    });
    flushBtn.connect('clicked', () => {
        try {
            flushWackCache();
            window.add_toast(new Adw.Toast({
                title: _('Visual cache cleared successfully!'),
            }));
        } catch (e) {
            window.add_toast(new Adw.Toast({
                title: `${_('Failed to clear cache:')} ${e.message}`,
            }));
        }
    });

    flushCacheRow.add_suffix(flushBtn);
    extrasGroup.add(flushCacheRow);

    return extrasGroup;
}
