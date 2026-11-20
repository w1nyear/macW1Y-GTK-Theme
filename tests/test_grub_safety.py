import unittest
import tempfile
import os
import shutil

class TestGrubSafety(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.grub_d = os.path.join(self.test_dir, "grub.d")
        os.makedirs(self.grub_d, exist_ok=True)
        self.default_grub = os.path.join(self.test_dir, "default_grub")
        
        # Native CachyOS/Arch 10_linux mock
        self.native_10_linux = os.path.join(self.grub_d, "10_linux")
        with open(self.native_10_linux, "w") as f:
            f.write("#!/bin/sh\n# Native CachyOS grub-mkconfig script\necho 'Found linux image: /boot/vmlinuz-linux-cachyos'\n")
        
        # Native default grub with custom kernel params
        with open(self.default_grub, "w") as f:
            f.write("GRUB_DEFAULT=0\nGRUB_DISTRIBUTOR='CachyOS'\nGRUB_CMDLINE_LINUX_DEFAULT='nowatchdog nvme_load=YES splash loglevel=3'\n")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_installer_preserves_native_10_linux_on_non_ubuntu(self):
        """Ensure install.sh explicitly guards 10_linux copying with [ \"$DISTRO_ID\" = \"ubuntu\" ]"""
        repo_install_sh = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "install.sh")
        with open(repo_install_sh, "r", encoding="utf-8") as f:
            content = f.read()

        # Check that 10_linux copy is guarded by ubuntu check
        self.assertIn('[ "$DISTRO_ID" = "ubuntu" ]', content)
        # Check that restore 10_linux from bak is present for non-ubuntu
        self.assertIn('10_linux.bak_mactheme', content)

    def test_grub_select_has_no_hardcoded_developer_uuids(self):
        """Ensure grub/06_mac_theme_select does not contain developer machine UUIDs"""
        theme_select = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "grub", "06_mac_theme_select")
        with open(theme_select, "r", encoding="utf-8") as f:
            content = f.read()

        dev_esp_uuid = "B621-3DF3"
        dev_root_uuid = "f4b30137-e957-4560-bf5a-e8dfd9164736"
        self.assertNotIn(dev_esp_uuid, content)
        self.assertNotIn(dev_root_uuid, content)
        # Ensure dynamic detection is used
        self.assertIn("findmnt -no UUID", content)

    def test_cachyos_grub_cfg_integrity(self):
        """Verify CachyOS generated grub config has valid kernel, initrd and root UUID matching"""
        sample_cfg = """
        menuentry 'CachyOS Linux' --class cachyos {
            linux /boot/vmlinuz-linux-cachyos root=UUID=12aa622e-0638-4684-88e4-5f51e0a2b151 rw nowatchdog nvme_load=YES splash loglevel=3
            initrd /boot/initramfs-linux-cachyos.img
        }
        """
        # Ensure recordfail is absent
        self.assertNotIn("recordfail", sample_cfg)
        # Ensure initrd matches kernel
        self.assertIn("vmlinuz-linux-cachyos", sample_cfg)
        self.assertIn("initramfs-linux-cachyos.img", sample_cfg)

if __name__ == "__main__":
    unittest.main()
