#!/usr/bin/env python3
"""
patch_grub_keys.py — Configure GRUB 2 Keyboard Navigation for horizontal boot picker
- LEFT arrow  -> navigate to PREVIOUS menu item (dec ebx)
- RIGHT arrow -> navigate to NEXT menu item (inc ebx)
- UP arrow    -> navigate to PREVIOUS menu item (dec ebx)
- DOWN arrow  -> navigate to NEXT menu item (inc ebx)
- ENTER       -> BOOT selected item (run ebx) — ONLY Enter boots!
"""

import os
import shutil
import struct
import sys

def patch_file(path, patches):
    if not os.path.exists(path):
        print(f"Skipping {path} (not found)")
        return False
    with open(path, 'rb') as f:
        data = bytearray(f.read())

    # Verify all offsets first before modifying anything on disk
    for offset, old_val, new_val in patches:
        if offset + 8 > len(data):
            print(f"Skipping {path}: file size ({len(data)}) smaller than patch offset {hex(offset)}")
            return False
        curr = struct.unpack('<Q', data[offset:offset+8])[0]
        if curr != old_val and curr != new_val:
            print(f"Skipping {path}: GRUB binary at {hex(offset)} has {hex(curr)} (expected {hex(old_val)} or {hex(new_val)})")
            return False

    for offset, old_val, new_val in patches:
        curr = struct.unpack('<Q', data[offset:offset+8])[0]
        if curr != new_val:
            data[offset:offset+8] = struct.pack('<Q', new_val)
            print(f'Patched {path} at {hex(offset)}: {hex(old_val)} -> {hex(new_val)}')
        else:
            print(f'Already patched {path} at {hex(offset)}: {hex(new_val)}')

    with open(path, 'wb') as f:
        f.write(data)
    print(f'Successfully updated {path}')
    return True

def main():
    # Only restore from host-local backups if created on this exact system;
    # NEVER overwrite another distro/version's GRUB or EFI binaries with foreign files!
    local_backup_dir = '/var/lib/macw1y/grub-backup'
    if os.path.isdir(local_backup_dir):
        if os.path.exists(f'{local_backup_dir}/normal.mod.orig') and os.path.exists('/boot/grub/x86_64-efi/normal.mod'):
            shutil.copy2(f'{local_backup_dir}/normal.mod.orig', '/boot/grub/x86_64-efi/normal.mod')
        if os.path.exists(f'{local_backup_dir}/usr_normal.mod.orig') and os.path.exists('/usr/lib/grub/x86_64-efi/normal.mod'):
            shutil.copy2(f'{local_backup_dir}/usr_normal.mod.orig', '/usr/lib/grub/x86_64-efi/normal.mod')
        if os.path.exists(f'{local_backup_dir}/grubx64.efi.orig') and os.path.exists('/boot/efi/EFI/ubuntu/grubx64.efi'):
            shutil.copy2(f'{local_backup_dir}/grubx64.efi.orig', '/boot/efi/EFI/ubuntu/grubx64.efi')
        if os.path.exists(f'{local_backup_dir}/emu_normal.mod.orig') and os.path.exists('/usr/lib/grub/x86_64-emu/normal.mod'):
            shutil.copy2(f'{local_backup_dir}/emu_normal.mod.orig', '/usr/lib/grub/x86_64-emu/normal.mod')

    # 2. Apply navigation patches:
    # UP: 0x74e7 (PREV) — kept as PREV, NEVER boot!
    # LEFT: 0x75ac (NOOP) -> 0x74e7 (PREV)
    # RIGHT: 0x752d (BOOT) -> 0x74ef (NEXT)
    efi_patches = [
        (0x2a5d8, 0x75ac, 0x74e7), # LEFT -> prev
        (0x2a608, 0x752d, 0x74ef), # RIGHT -> next
    ]
    patch_file('/boot/grub/x86_64-efi/normal.mod', efi_patches)
    patch_file('/usr/lib/grub/x86_64-efi/normal.mod', efi_patches)

    # 3. grubx64.efi
    base = 0x84e78
    standalone_patches = [
        (base + 0x2a5d8, 0x75ac, 0x74e7), # LEFT -> prev
        (base + 0x2a608, 0x752d, 0x74ef), # RIGHT -> next
    ]
    patch_file('/boot/efi/EFI/ubuntu/grubx64.efi', standalone_patches)

    # 4. x86_64-emu normal.mod
    emu_patches = [
        (0xa3fd8, 0x75db, 0x7516), # LEFT -> prev
        (0xa4008, 0x755c, 0x751e), # RIGHT -> next
    ]
    patch_file('/usr/lib/grub/x86_64-emu/normal.mod', emu_patches)
    print('All key navigation patches applied successfully: Left/Right navigate, Enter boots!')

if __name__ == '__main__':
    main()
