#!/usr/bin/env python3
"""Pre-flight platform and GNOME compatibility checks before mutating the system."""
import json
import pathlib
import re
import shutil
import subprocess
import sys


def incompatible_extensions(root, major):
    result = []
    metadata = sorted((pathlib.Path(root) / 'extensions').glob('*/metadata.json'))
    if not metadata:
        raise ValueError('No extension metadata found: incomplete installer package')
    for path in metadata:
        if not (path.parent / 'extension.js').is_file():
            raise ValueError(f'Incomplete extension {path.parent.name}: missing extension.js')
        data = json.loads(path.read_text(encoding='utf-8'))
        if str(major) not in data.get('shell-version', []):
            result.append(path.parent.name)
    return result


def parse_gnome_major(version_output):
    match = re.search(r'\b(\d+)\.', version_output)
    if not match:
        match = re.search(r'\b(\d+)\b', version_output)
    if not match:
        raise ValueError(f'Unable to parse GNOME Shell version: {version_output!r}')
    return match.group(1), int(match.group(1))


def inspect_shell_schema(gsettings_bin='gsettings'):
    """Inspect org.gnome.shell schema keys without assuming distro-specific keys exist."""
    if not shutil.which(gsettings_bin):
        return {'available': False, 'keys': set(), 'has_start_in_overview': False}
    try:
        out = subprocess.check_output([gsettings_bin, 'list-keys', 'org.gnome.shell'], text=True, stderr=subprocess.DEVNULL)
        keys = {line.strip() for line in out.splitlines() if line.strip()}
        return {
            'available': True,
            'keys': keys,
            'has_start_in_overview': 'start-in-overview' in keys,
        }
    except (OSError, subprocess.CalledProcessError):
        return {'available': False, 'keys': set(), 'has_start_in_overview': False}


def check_disk_space(path='/', min_mb=500):
    usage = shutil.disk_usage(path)
    free_mb = usage.free // (1024 * 1024)
    return free_mb >= min_mb, free_mb


def main():
    if len(sys.argv) < 2:
        sys.exit('Usage: check-platform.py <repo_root>')
    root = pathlib.Path(sys.argv[1]).resolve()
    if pathlib.Path('/run/ostree-booted').exists():
        sys.exit('Immutable OSTree systems are not currently supported.')
    try:
        version = subprocess.check_output(['gnome-shell', '--version'], text=True)
        major_str, major_num = parse_gnome_major(version)
        if major_num < 46:
            sys.exit(
                f'Installation stopped: GNOME 46 or newer is required (detected {major_str}).'
            )
        incompatible = incompatible_extensions(root, major_str)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f'Failed to verify GNOME Shell: {error}')
    if incompatible:
        sys.exit(
            f'Installation stopped: extensions do not declare GNOME {major_str} support:\n'
            + '\n'.join(incompatible)
        )

    schema_info = inspect_shell_schema()
    if schema_info['available'] and not schema_info['has_start_in_overview']:
        print(
            'Note: org.gnome.shell does not define start-in-overview on this system; '
            'private GNOME Shell layout overlay is not recommended and remains opt-in.'
        )

    print(
        f'Static metadata check passed for GNOME {major_str}. '
        'Note: extension metadata alone does not guarantee runtime compatibility on your distribution.'
    )


if __name__ == '__main__':
    main()
