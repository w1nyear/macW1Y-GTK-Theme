


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



export let StatusNotifierItem = null;
export let StatusNotifierWatcher = null;
export let DBusMenu = null;


function loadInterfaceXml(extension, filename) {
    const interfacesDir = extension.dir.get_child('interfaces-xml');
    const file = interfacesDir.get_child(filename);
    const [result, contents] = imports.gi.GLib.file_get_contents(file.get_path());

    if (result) {





        let nodeContents = contents;
        if (contents instanceof Uint8Array)
            nodeContents = imports.byteArray.toString(contents);
        return `<node>${nodeContents}</node>`;
    } else {
        throw new Error(`AppIndicatorSupport: Could not load file: ${filename}`);
    }
}

export function initialize(extension) {
    StatusNotifierItem = loadInterfaceXml(extension, 'StatusNotifierItem.xml');
    StatusNotifierWatcher = loadInterfaceXml(extension, 'StatusNotifierWatcher.xml');
    DBusMenu = loadInterfaceXml(extension, 'DBusMenu.xml');
}

export function destroy() {
    StatusNotifierItem = null;
    StatusNotifierWatcher = null;
    DBusMenu = null;
}
