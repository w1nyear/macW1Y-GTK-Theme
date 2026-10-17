#!/usr/bin/env python3
import struct
import sys

def patch_file(path, patches):
    with open(path, 'rb') as f:
        data = bytearray(f.read())
    
    for offset, old_val, new_val in patches:
        curr = struct.unpack('<Q', data[offset:offset+8])[0]
        if curr != new_val:
            assert curr == old_val, f'Mismatch at {hex(offset)} in {path}: expected {hex(old_val)} or {hex(new_val)}, got {hex(curr)}'
            data[offset:offset+8] = struct.pack('<Q', new_val)
            print(f'Patched {path} at {hex(offset)}: {hex(old_val)} -> {hex(new_val)}')
        else:
            print(f'Already patched {path} at {hex(offset)}: {hex(new_val)}')
    
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Successfully updated {path}')

def main():
    # 1. x86_64-efi normal.mod
    efi_patches = [
        (0x2a590, 0x74e7, 0x752d), # UP -> boot
        (0x2a5d8, 0x75ac, 0x74e7), # LEFT -> prev
        (0x2a608, 0x752d, 0x74ef), # RIGHT -> next
    ]
    patch_file('/boot/grub/x86_64-efi/normal.mod', efi_patches)
    patch_file('/usr/lib/grub/x86_64-efi/normal.mod', efi_patches)

    # 2. grubx64.efi
    base = 0x84e78
    standalone_patches = [
        (base + 0x2a590, 0x74e7, 0x752d), # UP -> boot
        (base + 0x2a5d8, 0x75ac, 0x74e7), # LEFT -> prev
        (base + 0x2a608, 0x752d, 0x74ef), # RIGHT -> next
    ]
    patch_file('/boot/efi/EFI/ubuntu/grubx64.efi', standalone_patches)

    # 3. x86_64-emu normal.mod
    emu_patches = [
        (0xa3f90, 0x7516, 0x755c), # UP -> boot
        (0xa3fd8, 0x75db, 0x7516), # LEFT -> prev
        (0xa4008, 0x755c, 0x751e), # RIGHT -> next
    ]
    patch_file('/usr/lib/grub/x86_64-emu/normal.mod', emu_patches)
    print('All key navigation patches applied successfully!')

if __name__ == '__main__':
    main()
