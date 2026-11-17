import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';


export function addMenu(window) {
    const builder = new Gtk.Builder();


    builder.add_from_file(GLib.filename_from_uri(GLib.uri_resolve_relative(import.meta.url, '../ui/menu.ui', GLib.UriFlags.NONE))[0]);
    let menu_util = builder.get_object('menu_util');
    window.add(menu_util);
    try {
        addMenuToHeader(window, builder);
    } catch (error) {

    }
    window.remove(menu_util);
}

function addMenuToHeader(window, builder) {

    const page = builder.get_object('menu_util');
    const pages_stack = page.get_parent();
    const content_stack = pages_stack.get_parent().get_parent();
    const preferences = content_stack.get_parent();
    const headerbar = preferences.get_first_child().get_next_sibling()
        .get_first_child().get_first_child().get_first_child();
    headerbar.pack_start(builder.get_object('info_menu'));


    const actionGroup = new Gio.SimpleActionGroup();
    window.insert_action_group('prefs', actionGroup);


    const actions = [
        {
            name: 'open-bug-report',
            link: 'https://github.com/aunetx/blur-my-shell/issues'
        },
        {
            name: 'open-readme',
            link: 'https://github.com/aunetx/blur-my-shell'
        },
        {
            name: 'open-license',
            link: 'https://github.com/aunetx/blur-my-shell/blob/master/LICENSE'
        },
        {
            name: 'donate-github',
            link: 'https://github.com/sponsors/aunetx'
        },
        {
            name: 'donate-kofi',
            link: 'https://ko-fi.com/aunetx'
        },
    ];

    actions.forEach(action => {
        let act = new Gio.SimpleAction({ name: action.name });
        act.connect(
            'activate',
            () => Gtk.show_uri(window, action.link, Gdk.CURRENT_TIME)
        );
        actionGroup.add_action(act);
    });
}
