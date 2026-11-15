# macW1Y / Ubuntu 26.04 Compatibility and Risk Inventory

**Status:** Initial static audit, 2026-11-15. Not an approval to install.

**Review target:** silverhawk-tech/macW1Y-GTK-Theme, baseline main tree 84a8bdd25c19a640acf210168d67085e9dc05941. The GitHub tree contains 55,765 entries (approximately 48,432 under icons). Examined the full root installer/uninstaller, AI instructions, package manifest, and representative scripts, system services, extensions, and metadata. This was not a line-by-line security audit of all source files, binaries, or assets; no execution or live compatibility testing occurred.

## Target environment to verify before deployment

The user reports a BOSGAME mini-PC development workstation running Ubuntu 26.04.1 LTS with GNOME/Wayland, gnome-remote-desktop/RDP (Thincast), AnyDesk, Tailscale, SSH, a development toolchain, and an existing independent local ci-farm. Treat all versions, account paths, available physical recovery, and installed extension versions as **unverified on this audit session** until captured read-only on the target.

Ubuntu 26.04 / GNOME Shell 50 is the intended adaptation target, not a blanket compatibility certification. Bundled GNOME extension metadata frequently lists version 50; that alone does not verify extension safety, actual ABI/API compatibility, or compatibility with the workstation's package versions.

## Findings (repo evidence)

| Tier | Component | Evidence and implication | Decision |
| --- | --- | --- | --- |
| **CRITICAL** | Unrestricted sudo | etc/sudoers.d/99-mactheme contains: vitaliy ALL=(ALL) NOPASSWD: ALL. install.sh:1168-1175 copies its sudoers directory into /etc/sudoers.d. The username is hard-coded; broad passwordless root permission is unacceptable regardless. | Exclude entirely |
| **CRITICAL** | Arbitrary shell JavaScript evaluation over D-Bus | extensions/eval-helper@mactheme/extension.js:437-443 exports an Eval method that calls eval(code), and line 553 publishes a session D-Bus object. An arbitrary-code execution surface inside GNOME Shell is incompatible with the safety baseline. | Exclude until independently redesigned/audited |
| **CRITICAL** | GNOME Shell binary diversion | install.sh:1385-1431 uses dpkg-divert to move /usr/bin/gnome-shell and installs bin/gnome-shell, which sets G_RESOURCE_OVERLAYS. A failure risks the graphical session and remote desktop. | Exclude |
| **HIGH** | Nautilus binary wrapper and preload | install.sh:450-470 renames /usr/bin/nautilus to .orig, writes a wrapper, and uses LD_PRELOAD with bundled/native .so libraries. | Exclude |
| **HIGH** | Bootloader/initramfs | install.sh:1610-1746 changes Plymouth, /etc/initramfs-tools, /etc/default/grub, multiple /etc/grub.d files (including 10_linux), GRUB menu assets, and runs update-initramfs/update-grub. apply_plymouth.sh also touches sudoers, GRUB, and initramfs. | Exclude |
| **HIGH** | Full environment rewrite | install.sh:1767-1773 replaces the entire /etc/environment, rather than adding a scoped file. This may erase important workstation settings. | Exclude |
| **HIGH** | Login and GDM | install.sh:1437-1604 changes GDM dconf, greeter, session integration, automatic-login state, and fingerprint-related PAM behavior. | Exclude |
| **HIGH** | Broad dconf mutation | install.sh:738-778 applies dconf/gnome-all.dconf at the root dconf path; keyboard layout is handled specially, but many other existing settings may be overwritten. | Exclude; replace with reviewed per-key changes |
| **HIGH** | Extension re-enabling and validation bypass | bin/mac-ensure-extensions.sh forces disable-user-extensions=false, disables extension-version-validation, and re-enables a large extension set. This defeats rollback and compatibility checks. | Exclude |
| **HIGH** | Driver, daemon, input and privileges | install.sh:1098-1141 deploys a touchpad daemon, writes udev rules, and adds the user to the input group; install.sh:1146-1320 alters GPU/game-mode tooling, sudoers, and system services. | Exclude |
| **HIGH** | Unsafe generic removal | uninstall.sh:135-244 removes system and /usr/local paths, including /usr/local/bin/steam, and resets preferences to Yaru rather than preserving the prior baseline. Cannot be considered a safe rollback. | Exclude; build ownership-aware rollback |
| **HIGH** | Unreviewed native binaries | lib/ contains multiple .so libraries and a typelib; extensions and source code use in-process GTK/GNOME hooks. No binary provenance, reproducibility, or runtime audit has been established. | Exclude from initial rollout |
| **MEDIUM** | Package footprint | dependencies/apt-packages.txt includes Wine/i386, NVIDIA PRIME, development libraries, GRUB, and Plymouth regardless of appearance-only objectives; install.sh:279-341 adds the i386 architecture and builds a third-party GNOME library. | Avoid new packages by default |
| **MEDIUM** | Conflicting extensions | extensions/ contains 25 extension directories and an additional DING patch directory; enabled dock, top bar, blur, and window-management features may collide with Ubuntu defaults or each other. | One-at-a-time testing only |
| **MEDIUM** | Upstream machine assumptions | AI_INSTRUCTIONS.md and AI_Instructions.md explicitly assume /home/vitaliy, direct system sync and one-turn deployment; install.sh also contains fixed source-path substitution. | Superseded by AGENTS.md and fork warning |
| **LEGAL REVIEW** | Bundled Apple materials | README references Apple SF Pro fonts, macOS sounds, wallpapers, and Apple-like marks. Upstream attribution/license claims do not by themselves prove redistribution rights. | Keep existing history untouched; verify before distributing adapted bundles |
| **CI** | Repository workflows | Recursive GitHub tree scan found no .github/workflows entries at the audit baseline. This is **not** proof that repository Actions are disabled in GitHub settings. | No GitHub Actions now or later; local ci-farm only |

### Compatibility candidates

- **Candidate A — cosmetic user-space assets:** selectively copy CSS/GTK themes, icon theme, and wallpaper assets to a test profile or temporary directory, after file and license review. Avoid the root installer and global symlinks.
- **Candidate B — isolated GNOME user extensions:** validate a single extension against the target GNOME version, initially with all competing dock/menu extensions disabled. Examples advertising Shell 50 include Cupertino Dock Lite, Kiwi, Blur My Shell, and Liquid Glass. Metadata compatibility is an initial filter, **not a GO decision**.
- **Candidate C — advanced overlays, Finder/Settings integrations, native .so, GNOME Shell/GDM replacement, boot visuals, device controls:** out of scope for first rollout. Must not be pulled in transitively by an installer.

## Required workstation snapshot (read-only; run only after manager review)

    cat /etc/os-release
    gnome-shell --version
    echo "$XDG_SESSION_TYPE"
    echo "$XDG_CURRENT_DESKTOP"
    gnome-extensions list --enabled
    gsettings get org.gnome.desktop.interface gtk-theme
    gsettings get org.gnome.desktop.interface icon-theme
    gsettings get org.gnome.shell favorite-apps
    command -v anydesk
    command -v tailscale
    command -v ssh
    systemctl --user --no-pager status gnome-remote-desktop.service

Additional backups and network/remote checks require a deliberately reviewed command set. Read-only collection is not a license to change settings. Do not store sensitive system details or logs in public Git history.

## Definition of a compatibility pass

1. All planned changes are user-scoped, listed in a manifest, and can be reversed without relying on the upstream uninstaller.
2. GUI boots normally; existing session, keyboard, and desktop settings remain intact.
3. AnyDesk, GNOME Remote Desktop/RDP, Tailscale, SSH, terminal keyboard/clipboard, and local login remain functional before and after each tested component.
4. Local ci-farm checks pass; no GitHub-hosted CI is configured or run.
5. Real GNOME/Wayland testing completed for each enabled extension; no forced version-validation bypass.
6. A proven recovery procedure is available independent of the session being modified.

**Current verdict:** No-Go for upstream full install; safe to plan and implement a narrowly scoped cosmetic-only adaptation in the repository.
