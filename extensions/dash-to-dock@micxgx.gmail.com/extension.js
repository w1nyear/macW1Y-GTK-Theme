

import {DockManager} from './docking.js';
import {Extension} from './dependencies/shell/extensions/extension.js';


export let dockManager;

export default class DashToDockExtension extends Extension.Extension {
    enable() {


        this._shutdownID = global.connect('shutdown', () => this.disable());
        dockManager = new DockManager(this);
    }

    disable() {
        global.disconnect(this._shutdownID);
        delete this._shutdownID;
        dockManager?.destroy();
        dockManager = null;
    }
}
