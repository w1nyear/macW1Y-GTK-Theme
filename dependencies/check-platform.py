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
        if not (path.parent / 'extension.js').is_file():
            raise ValueError(f'Неповне розширення {path.parent.name}: немає extension.js')
        data = json.loads(path.read_text())
        if str(major) not in data.get('shell-version', []):
            result.append(path.parent.name)
    return result


def is_supported_distribution():
    os_release = {}
    p = pathlib.Path('/etc/os-release')
    if p.exists():
        for line in p.read_text().splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                os_release[k.strip()] = v.strip().strip('"').strip("'")
    distro_id = os_release.get('ID', '').lower()
    id_like = os_release.get('ID_LIKE', '').lower()
    supported = (
        'ubuntu', 'debian', 'pop', 'linuxmint', 'mint', 'elementary',
        'neon', 'zorin', 'fedora', 'arch', 'cachyos', 'manjaro', 'endeavouros'
    )
    return any(s in distro_id or s in id_like for s in supported), distro_id or 'unknown'


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
            sys.exit(f'Встановлення зупинено: підтримуються лише GNOME 46 і новіші (виявлено {major[1]}). Ubuntu 24.04–26.10+, Linux Mint 22+, Debian 13+, Fedora 40–44+, Arch Linux / CachyOS.')
        incompatible = incompatible_extensions(root, major[1])
    except (FileNotFoundError, OSError) as error:
        if isinstance(error, FileNotFoundError) or 'No such file' in str(error):
            supported, distro_id = is_supported_distribution()
            if supported:
                print(f'GNOME Shell наразі не встановлено (дистрибутив: {distro_id}). Під час встановлення macW1Y буде завантажено та встановлено GNOME 46+ та замінено старе середовище.')
                return
            sys.exit(f'Не знайдено GNOME Shell у системі {distro_id}. Для роботи macW1Y потрібен GNOME 46+.')
        sys.exit(f'Не вдалося перевірити GNOME: {error}')
    except (ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f'Не вдалося перевірити GNOME: {error}')
    if incompatible:
        sys.exit('Встановлення зупинено: несумісні з GNOME ' + major[1] + ' розширення:\n' + '\n'.join(incompatible))
    print('Версія GNOME відповідає метаданим розширень; це не замінює перевірку у цільовій ОС.')


if __name__ == '__main__':
    main()
