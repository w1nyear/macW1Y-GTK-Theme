# Security Policy

## Supported Versions

The macW1Y team actively maintains security fixes for the latest release versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.8.x   | :white_check_mark: |
| < 0.8   | :x:                |

---

## Reporting a Vulnerability

We take the security and integrity of user systems very seriously. If you discover a vulnerability or potential security issue affecting `install.sh`, background services, daemon helpers, or any part of the macW1Y transformation modpack:

1. **GitHub Private Vulnerability Reporting (Recommended)**:
   Please report it privately via GitHub:
   - Navigate to the **Security** tab of this repository.
   - Click **Report a vulnerability** to open an advisory draft.
   - This ensures sensitive technical details remain private while a patch is prepared and verified.

2. **Direct Contact**:
   If Private Vulnerability Reporting is unavailable, please email details directly to:
   - **`vitaliyvinarskij6@gmail.com`**

Please include:
- A clear description of the issue, affected component, and system environment.
- Steps to reproduce or proof-of-concept.
- Any suggestions for remediation.

We strive to acknowledge receipt within 24–48 hours and work with reporters on a responsible disclosure timeline.

---

## Security Principles & System Hardening

macW1Y adheres to strict system security and privilege separation standards:
- **No Hardcoded Accounts in Sudoers**: No personal or hardcoded username is ever granted `NOPASSWD` or elevated permissions.
- **Administrative Group Restrictions**: Sudoers helper rules (such as `mac-boot-config` for macOS-style boot settings) are strictly restricted to verified administrative groups (`%sudo` on Debian/Ubuntu, `%wheel` on Fedora/Arch).
- **Root Ownership Enforcement**: All system binaries (`/usr/local/bin/*`), libraries (`/usr/local/lib/*`), configurations (`/etc/*`), and overlays (`/usr/share/mactheme/*`) are strictly owned by `root:root` with read-only/execute permissions for regular users.
- **Secure Temporary Files**: All installer builds and extractions use randomized temporary directories created with `mktemp -d` and protected by cleanup traps.
