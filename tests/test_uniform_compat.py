from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'extensions/liquid-glass@thinkingcoding1231.gmail.com'

class UniformCompatibility(unittest.TestCase):
    def test_gjs_scalar_and_array_paths(self):
        source = (BASE / 'dist/uniformCompat.js').read_text().split('\n',1)[1].replace('export function', 'function')
        for version in (46,47,48,50,51):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as folder:
                code = f'const Config = {{PACKAGE_VERSION: "{version}"}};\n' + source + '''
let calls = [];
const pipeline = {get_uniform_location: n => n,
    set_uniform_1f: (...args) => calls.push(['scalar', ...args]),
    set_uniform_float: (...args) => calls.push(['array', ...args])};
setUniformVector(pipeline, 'size', [0.5, 0.25]);
setUniformArray(pipeline, 'weights', 'weights', [1, 2, 3]);
if (uniformArrays) {
    if (calls.length !== 2 || calls.some(c => c[0] !== 'array')) throw Error('array path');
} else {
    if (calls.length !== 5 || calls.some(c => c[0] !== 'scalar')) throw Error('unsafe old Cogl call');
    if (calls[1][1] !== 'size_1' || calls[4][1] !== 'weights[2]') throw Error('location');
    if (!uniformDeclarations('uniform vec2 size;').includes('#define size vec2(size_0, size_1)')) throw Error('GLSL');
}
'''
                path=Path(folder)/'test.js';path.write_text(code)
                subprocess.run(['gjs',str(path)],check=True,capture_output=True)
    def test_source_dist_match(self):
        self.assertEqual((BASE/'src/uniformCompat.js').read_bytes(),(BASE/'dist/uniformCompat.js').read_bytes())
