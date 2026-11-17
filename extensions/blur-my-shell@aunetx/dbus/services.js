import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LookingGlass from 'resource:///org/gnome/shell/ui/lookingGlass.js';

const IFACE_XML = `
<node>
  <interface name="dev.aunetx.BlurMyShell">
    <!-- This method is called in preferences to pick a window -->
    <method name="pick" />
    <!-- When window is picking, send a signal to preferences -->
    <signal name="picking"></signal>
    <!-- If window is picked, send a signal to preferences -->
    <signal name="picked">
      <arg name="window" type="s" />
    </signal>
  </interface>
</node>
`;

export const ApplicationsService = class ApplicationsService {
    constructor() {
        this.DBusImpl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
    }

    /// Pick Window for Preferences Page, exported to DBus client.
    pick() {

        const send_picking_signal = _ =>
            this.DBusImpl.emit_signal(
                'picking',
                null
            );


        const send_picked_signal = wm_class =>
            this.DBusImpl.emit_signal(
                'picked',
                new GLib.Variant('(s)', [wm_class])
            );


        send_picking_signal();








        const looking_class = Main.createLookingGlass();
        looking_class.open();
        looking_class.hide();


        const inspector = new LookingGlass.Inspector(Main.createLookingGlass());
        inspector.connect('target', (me, target, _x, _y) => {

            const effect_name = 'lookingGlass_RedBorderEffect';
            target
                .get_effects()
                .filter(e => e.toString().includes(effect_name))
                .forEach(e => target.remove_effect(e));



            const type_str = target.toString();

            let actor = target;
            if (type_str.includes('MetaSurfaceActor'))
                actor = target.get_parent();

            if (!actor.toString().includes('WindowActor'))
                actor = actor.get_parent();

            if (!actor.toString().includes('WindowActor'))
                return send_picked_signal('window-not-found');

            send_picked_signal(
                actor.meta_window.get_wm_class() ?? 'window-not-found'
            );
        });


        inspector.connect('closed', _ => looking_class.close());
    }

    export() {
        this.DBusImpl.export(
            Gio.DBus.session,
            '/dev/aunetx/BlurMyShell'
        );
    };

    unexport() {
        this.DBusImpl.unexport();
    }
};
