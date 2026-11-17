


// contributors. Distributed under the GNU General Public License,


import {DockManager} from './docking.js';
import {disable as dragOutDisable, enable as dragOutEnable} from './dragOutToRemove.js';
import {Extension} from './dependencies/shell/extensions/extension.js';


export let dockManager;

export default class ContentDockExtension extends Extension.Extension {
    enable() {
        dockManager = new DockManager(this);
        dragOutEnable();
    }

    disable() {
        dragOutDisable();
        dockManager?.destroy();
        dockManager = null;
    }
}
