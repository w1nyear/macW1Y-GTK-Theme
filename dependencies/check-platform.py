#!/usr/bin/env python3
"""Перевірка сумісності до будь-яких змін системи."""
import json
import pathlib
import re
import subprocess
import sys


def incompatible_extensions(root, major):
    result = []
    metadata = sorted((root / 'extensions').glob('*/metadata.json'))
    if not metadata:
        raise ValueError('Не знайдено метаданих розширень: неповний пакет інсталятора')
    for path in metadata:
        data = json.loads(path.read_text())
        if str(major) not in data.get('shell-version', []):
            result.append(path.parent.name)
    return result


def main():
    root = pathlib.Path(sys.argv[1]).resolve()
    if pathlib.Path('/run/ostree-booted').exists():
        sys.exit('Незмінювані системи OSTree поки не підтримуються.')
    try:
        version = subprocess.check_output(['gnome-shell', '--version'], text=True)
        major = re.search(r'\b(\d+)\.', version)
        if not major:
            major = re.search(r'\b(\d+)\b', version)
        if not major:
            raise ValueError(version)
        major_num = int(major[1])
        if major_num < 46:
            sys.exit(f'Встановлення зупинено: підтримуються лише GNOME 46 і новіші (виявлено {major[1]}). Ubuntu 24.04+, Debian 13+, Fedora 40+, Arch Linux / CachyOS.')
        incompatible = incompatible_extensions(root, major[1])
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f'Не вдалося перевірити GNOME: {error}')
    if incompatible:
        sys.exit('Встановлення зупинено: несумісні з GNOME ' + major[1] + ' розширення:\n' + '\n'.join(incompatible))
    print('Версія GNOME відповідає метаданим розширень; це не замінює перевірку у цільовій ОС.')


if __name__ == '__main__':
    main()
