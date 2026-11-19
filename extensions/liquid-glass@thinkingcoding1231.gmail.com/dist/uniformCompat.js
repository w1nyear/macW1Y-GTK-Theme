import * as Config from 'resource:///org/gnome/shell/misc/config.js';

// У старих typelib Cogl аргумент value помилково описано як число замість масиву.
const uniformArrays = Number.parseInt(Config.PACKAGE_VERSION, 10) >= 48;

export function uniformDeclarations(decl) {
    if (uniformArrays)
        return decl;
    return decl.replace(/uniform\s+vec([234])\s+(\w+)\s*;/g, (_match, size, name) => {
        const parts = Array.from({length: Number(size)}, (_, i) => `${name}_${i}`);
        return `uniform float ${parts.join(', ')};\n#define ${name} vec${size}(${parts.join(', ')})\n`;
    });
}

export function setUniformVector(pipeline, name, values) {
    if (uniformArrays) {
        pipeline.set_uniform_float(pipeline.get_uniform_location(name), values.length, 1, values);
    } else {
        values.forEach((value, i) => pipeline.set_uniform_1f(
            pipeline.get_uniform_location(`${name}_${i}`), value));
    }
}

export function setUniformArray(pipeline, location, name, values) {
    if (uniformArrays) {
        pipeline.set_uniform_float(location, 1, values.length, values);
    } else {
        values.forEach((value, i) => pipeline.set_uniform_1f(
            pipeline.get_uniform_location(`${name}[${i}]`), value));
    }
}
