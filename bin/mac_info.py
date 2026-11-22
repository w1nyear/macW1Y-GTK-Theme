#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""macW1Y centralized project metadata and version loader."""
import os
import sys
import json
from pathlib import Path

DEFAULT_NAME = "macW1Y"
DEFAULT_VERSION = "0.7.1"
DEFAULT_CODENAME = "Tahoe"

def find_info_json():
    candidates = [
        Path(__file__).resolve().parent.parent / "info.json",
        Path(__file__).resolve().parent / "info.json",
        Path.cwd() / "info.json",
        Path("/usr/share/mactheme/info.json"),
        Path.home() / ".local/share/macW1Y/info.json",
        Path.home() / ".config/mac-styling/info.json",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None

def get_info():
    info_file = find_info_json()
    if info_file:
        try:
            with open(info_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "name": DEFAULT_NAME,
        "version": DEFAULT_VERSION,
        "codename": DEFAULT_CODENAME,
    }

def get_version():
    return get_info().get("version", DEFAULT_VERSION)

def get_name():
    return get_info().get("name", DEFAULT_NAME)

def get_codename():
    return get_info().get("codename", DEFAULT_CODENAME)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if arg in ("--json", "-j"):
            print(json.dumps(get_info(), indent=2, ensure_ascii=False))
            sys.exit(0)
        elif arg in ("--name", "-n"):
            print(get_name())
            sys.exit(0)
        elif arg in ("--codename", "-c"):
            print(get_codename())
            sys.exit(0)
        elif arg in ("--help", "-h"):
            print(f"Usage: {sys.argv[0]} [--version | --json | --name | --codename]")
            sys.exit(0)
    print(get_version())
