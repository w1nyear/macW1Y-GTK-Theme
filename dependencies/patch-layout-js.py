#!/usr/bin/env python3
"""
Version-agnostic macW1Y GNOME Shell layout.js overlay generator.
Splices the macW1Y cold-boot/lockscreen-to-desktop transition methods from
`gnome-shell-overlay/ui/layout.js` onto the host distribution's native
upstream `layout.js` (supporting GNOME 46, 47, 48, 49, 50, and 51 without
breaking version-specific APIs like `defaultParams.affectsInputRegion` or
`paint_to_content` arity).
"""

import re
import sys
from pathlib import Path


def extract_between(text: str, start_marker: str, end_marker: str) -> str:
    s = text.find(start_marker)
    if s < 0:
        raise ValueError(f"Start marker not found: {start_marker!r}")
    e = text.find(end_marker, s)
    if e < 0:
        raise ValueError(f"End marker not found: {end_marker!r}")
    return text[s:e]


def patch_layout_js(orig_text: str, template_text: str) -> str:
    # Check if template already matches the same GNOME Shell major API
    orig_has_affects = "affectsInputRegion" in orig_text
    tmpl_has_affects = "affectsInputRegion" in template_text
    orig_has_do_startup = "async _doStartupAnimation()" in orig_text
    tmpl_has_do_startup = "async _doStartupAnimation()" in template_text
    if orig_has_affects == tmpl_has_affects and orig_has_do_startup == tmpl_has_do_startup and "paint_to_content(rect, scale, null" in orig_text:
        # Exact upstream family match (e.g. Ubuntu 26.04 GNOME 50)
        return template_text

    out = orig_text

    # 1. Ensure Cogl import exists
    if "import Cogl from 'gi://Cogl';" not in out:
        out = out.replace(
            "import Clutter from 'gi://Clutter';\n",
            "import Clutter from 'gi://Clutter';\nimport Cogl from 'gi://Cogl';\n",
            1,
        )

    # 2. Insert macW1Y stage & cold-boot helper functions before isPopupMetaWindow
    helpers = extract_between(
        template_text,
        "function _safeSetStageBlack()",
        "\nfunction isPopupMetaWindow(",
    )
    if "function _safeSetStageBlack()" not in out:
        out = out.replace(
            "function isPopupMetaWindow(",
            helpers + "\n\nfunction isPopupMetaWindow(",
            1,
        )

    # 3. Mark _init as macLayoutOverlay and set black stage before adding uiGroup
    if "this._isMacLayoutOverlay = true;" not in out:
        out = out.replace(
            "        global.stage.add_child(this.uiGroup);",
            "        this._isMacLayoutOverlay = true;\n        _safeSetStageBlack();\n        global.stage.add_child(this.uiGroup);",
            1,
        )

    # 4. Splice startup animation block (_prepareStartupAnimation .. _startupAnimationComplete)
    startup_block = extract_between(
        template_text,
        "    async _prepareStartupAnimation()",
        "\n    setDummyCursorGeometry(",
    )
    startup_block = startup_block.replace(
        "await this._ensurePrimaryMonitor();",
        "if (typeof this._ensurePrimaryMonitor === 'function') await this._ensurePrimaryMonitor();",
    )

    # GNOME 46-48 calls _prepareStartupAnimation() directly from init() instead of
    # _doStartupAnimation(), so _prepareStartupAnimation() itself must drive
    # _startupAnimation() and _startupAnimationComplete().
    if not orig_has_do_startup:
        marker = "        if (!Main.sessionMode.isGreeter) {\n            this.emit('startup-prepared');\n        }\n    }"
        replacement = (
            "        if (!Main.sessionMode.isGreeter) {\n"
            "            this.emit('startup-prepared');\n"
            "        }\n"
            "        try {\n"
            "            await this._startupAnimation();\n"
            "        } finally {\n"
            "            this._startupAnimationComplete();\n"
            "        }\n"
            "    }"
        )
        if marker in startup_block:
            startup_block = startup_block.replace(marker, replacement, 1)
        else:
            raise ValueError("Could not splice GNOME <49 _startupAnimation invocation in _prepareStartupAnimation")

    m = re.search(
        r"    async _prepareStartupAnimation\(\)[\s\S]*?(?=\n    (?:// setDummyCursorGeometry:\n    )?setDummyCursorGeometry\()",
        out,
    )
    if not m:
        raise ValueError("Could not locate _prepareStartupAnimation..setDummyCursorGeometry block in orig layout.js")
    out = out[: m.start()] + startup_block + out[m.end() :]

    # Guard addChrome on GNOME <49 against adding chrome actors before uiGroup is realized
    add_chrome_orig = "    addChrome(actor, params) {\n        this.uiGroup.add_child(actor);"
    add_chrome_safe = (
        "    addChrome(actor, params) {\n"
        "        if (!this.uiGroup.realized) {\n"
        "            const _rid = this.uiGroup.connect('realize', () => {\n"
        "                try { this.uiGroup.disconnect(_rid); } catch (_) {}\n"
        "                try { this.addChrome(actor, params); } catch (_) {}\n"
        "            });\n"
        "            return;\n"
        "        }\n"
        "        this.uiGroup.add_child(actor);"
    )
    if add_chrome_orig in out:
        out = out.replace(add_chrome_orig, add_chrome_safe, 1)

    # Guard start-in-overview lookup when schema (e.g. Debian/Kali GNOME 50.5) lacks the key
    start_ov_pat = re.compile(
        r"        this\._startInOverview =\s*\n"
        r"            Main\.sessionMode\.hasOverview &&\s*\n"
        r"            global\.settings\.get_boolean\('start-in-overview'\);"
    )
    start_ov_safe = (
        "        this._startInOverview = false;\n"
        "        if (Main.sessionMode.hasOverview) {\n"
        "            try {\n"
        "                const schema = global.settings?.settings_schema;\n"
        "                if (schema && typeof schema.has_key === 'function' && schema.has_key('start-in-overview')) {\n"
        "                    this._startInOverview = global.settings.get_boolean('start-in-overview');\n"
        "                }\n"
        "            } catch (_e) {\n"
        "                this._startInOverview = false;\n"
        "            }\n"
        "        }"
    )
    out = start_ov_pat.sub(start_ov_safe, out, count=1)

    return out


def main() -> int:
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <layout.js.orig> <macw1y_template_layout.js> <output_layout.js>", file=sys.stderr)
        return 2
    orig_p, tmpl_p, out_p = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    patched = patch_layout_js(orig_p.read_text(encoding="utf-8"), tmpl_p.read_text(encoding="utf-8"))
    out_p.write_text(patched, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
