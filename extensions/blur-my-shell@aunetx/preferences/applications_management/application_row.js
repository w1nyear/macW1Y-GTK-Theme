import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { pick, on_picking, on_picked } from '../../dbus/client.js';


export const ApplicationRow = GObject.registerClass({
    GTypeName: 'ApplicationRow',
    Template: GLib.uri_resolve_relative(import.meta.url, '../../ui/application-row.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'window_picker',
        'window_class',
        'picking_failure_toast',
        'window_not_found_toast'
    ],
}, class ApplicationRow extends Adw.ExpanderRow {
    constructor(list, app_page, app_name) {
        super({});
        this._list = list;
        this._app_page = app_page;


        let action_row = this.child.get_first_child().get_first_child();
        let remove_button = new Gtk.Button({
            'icon-name': 'remove-row-symbolic',
            'width-request': 38,
            'height-request': 38,
            'margin-top': 6,
            'margin-bottom': 6,
        });
        remove_button.add_css_class('circular');
        remove_button.add_css_class('flat');
        action_row.add_prefix(remove_button);


        remove_button.connect('clicked', () => this._remove_row());


        this._window_class.buffer.bind_property(
            'text', this, 'title',
            Gio.SettingsBindFlags.BIDIRECTIONNAL
        );


        if (app_name)
            this._window_class.buffer.text = app_name;
        else {
            app_page.close_all_expanded_rows();
            this.set_expanded(true);
            this._do_pick_window(true);
        }


        this._window_picker.connect('clicked', () => this._do_pick_window());


        this._window_class.connect('changed',
            () => this._update_rows_titles()
        );
    }

    _remove_row() {
        this._app_page["remove_from_" + this._list](this);
    }

    _update_rows_titles() {
        this._app_page["update_" + this._list + "_titles"](this);
    }

    _do_pick_window(remove_if_failed = false) {

        let has_responded = false;
        let should_take_answer = true;
        setTimeout(() => {
            if (!has_responded) {

                this._app_page._preferences_window.add_toast(
                    this._picking_failure_toast
                );


                should_take_answer = false;


                if (remove_if_failed)
                    this._remove_row();
            }
        }, 250);

        on_picking(() =>
            has_responded = true
        );

        on_picked(wm_class => {
            if (should_take_answer) {
                if (wm_class == 'window-not-found') {
                    console.warn("Can't pick window from here");
                    this._app_page._preferences_window.add_toast(
                        this._window_not_found_toast
                    );
                    return;
                }
                this._window_class.buffer.text = wm_class;
            }
        });

        pick();
    }
});
