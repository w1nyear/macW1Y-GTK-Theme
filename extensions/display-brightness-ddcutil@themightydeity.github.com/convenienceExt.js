import Gio from 'gi://Gio';

export function isNullOrWhitespace(str) {
    return str === undefined || str === null || str.match(/^\s*$/) !== null;
}






export function brightnessLog(settings, ...args) {
    if (settings.get_boolean('verbose-debugging'))
        console.log(`display-brightness-ddcutil extension: `, ...args);
}

export async function spawnWithCallback(settings, argv, callback) {
    brightnessLog(settings, `Calling: ${argv.join(' ')}`);
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

        await proc.communicate_utf8_async(null, null, async (proc, res)=>{
            const [, stdout, stderr] = proc.communicate_utf8_finish(res);
            if (proc.get_successful()) {
                await callback(stdout);
            } else {




                if (stderr)
                    await callback(stderr);
                else if (stdout)
                    await callback(stdout);
                else
                    await callback("");
            }
        });

    } catch (e) {
        brightnessLog(settings, e);
    }
}








export function getVCPInfoAsArray(val) {
    const matched = val.trim().match(/^VCP.*$/gm)
    if(matched !== null){
        return matched.join('\n').split(' ')
    }else{
        return []
    }
}

export function sliderValuePercentFixed(sliderValue){
    return Math.round(sliderValue * 100);
}
