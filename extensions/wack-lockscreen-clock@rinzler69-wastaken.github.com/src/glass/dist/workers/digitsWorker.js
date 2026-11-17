



import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { DigitsMaker, fontKey } from '../desktop/glassText.js';
import { serveRequests } from './workerProcess.js';
const maker = new DigitsMaker();

function save(bytes) {
    const [fd, path] = GLib.file_open_tmp('liquid-glass-digits-XXXXXX');
    GLib.close(fd);
    const file = Gio.File.new_for_path(path);
    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.NONE, null, (_f, res) => {
            try {
                file.replace_contents_finish(res);
                resolve(path);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}



let newest = '';
await serveRequests(async (request) => {
    if (fontKey(request) !== newest)
        throw new Error('a newer font was asked for');
    const digits = await maker.make(request);
    const path = await save(digits.bytes);
    return { path, width: digits.width, height: digits.height, band: digits.band, digitHeight: digits.digitHeight };
}, request => {
    newest = fontKey(request);
    maker.keepOnly(request);
});
