<!-- markdownlint-disable MD033 MD041 -->
[![GNOME Extensions downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fextensions.gnome.org%2Fextension-info%2F%3Fpk%3D10660&query=%24.downloads&label=downloads&style=flat-square&logo=gnome&logoColor=white&color=4A86CF)](https://extensions.gnome.org/extension/10660/quick-settings-scroll/)
[![GNOME Shell 46 to 51](https://img.shields.io/badge/GNOME_Shell-46%20%E2%86%92%2051-4A86CF?style=flat-square&logo=gnome&logoColor=white)](https://release.gnome.org/)
[![Latest release](https://img.shields.io/github/v/release/Disk-MTH/Quick-Settings-Scroll?style=flat-square&logo=github&label=release&color=4A86CF)](https://github.com/Disk-MTH/Quick-Settings-Scroll/releases/latest)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-3DA639?style=flat-square)](./LICENSE)

# Quick Settings Scroll

<a href="https://extensions.gnome.org/extension/10660/quick-settings-scroll/"><img align="left" width="210" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg" alt="Get it on GNOME Extensions"></a>

**Makes the GNOME Quick Settings menu scroll when it is taller than the
screen.** That is the whole extension. No preferences, no panel item, nothing
to configure: install it and the menu stops running off the bottom edge.

<br clear="left">

> **Note on development.** This extension was built based on functional specs
> and requirements, with AI assistance used for code generation and iterative
> refinement. The behaviour described below was measured in a nested GNOME
> Shell, but you might still encounter edge cases. Bug reports and
> contributions are very welcome!

## The problem

Add a few extensions with toggles of their own, or run a laptop at a small
resolution or a large text scale, and the Quick Settings menu grows past the
bottom of the screen. What is down there is simply unreachable: the popup does
not scroll, it is just cut off.

Measured in a nested shell at 800x600, with sixteen extra toggles in the menu:

| | popup height | work area | reachable |
| --- | --- | --- | --- |
| stock GNOME Shell 50 | 782px | 568px | the top 568px, the rest is off-screen |
| with this extension | 556px | 568px | all of it, by scrolling |

GNOME has an open merge request for this,
[gnome-shell!3272](https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/3272).
It was opened in April 2024 and is still unmerged. This extension exists until
it lands.

## Install

```bash
git clone https://github.com/Disk-MTH/Quick-Settings-Scroll.git
cd Quick-Settings-Scroll
make install
# Wayland: log out, log back in.
# Xorg:    Alt+F2, type r, Enter.
gnome-extensions enable quick-settings-scroll@diskmth.fr
```

`make nested` tries it in a throwaway shell in its own window, on a copy of
your settings so the nested menu carries the same extensions without writing
anything back. Resize that window short to make the menu overflow. Pack a
release zip with `make pack`.

Note that `make install` cannot reach a shell that is already running: GNOME
Shell caches extension modules, so changed code needs a fresh shell — nested,
or after a log out.

## Project layout

```
extension.js                  # entry point: apply on enable, revert on disable
lib/quick-settings-scroll.js  # the patch itself
stylesheet.css                # the fade at the scrolled edges
```

## FAQ

### Will it fight with my other extensions?

It should not. It moves shell actors rather than replacing shell methods, so
an extension that adds a toggle keeps calling the same `addItem` on the same
grid. Positions are restored by index, not appended, so an extension that put
a row of its own in the menu gets it back where it was.

### Does anything change when the menu fits on screen?

No. The scroll view draws no scrollbar and the edge fade is only painted on an
edge that has content past it, so a menu that fits looks untouched.

### Why is there no scrollbar?

A bar inside a popup this narrow has to either eat into the grid or sit over a
toggle, and both look wrong. The fade at the top and bottom edges says there is
more menu past them instead.

## License

GPL-2.0-or-later, see [LICENSE](./LICENSE), the same terms GNOME Shell itself
is published under.
