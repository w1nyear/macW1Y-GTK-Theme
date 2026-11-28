"""Unit tests for Super+P monitor layout persistence (bin/mac-monitor-persist)."""
import importlib.machinery
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOADER = importlib.machinery.SourceFileLoader("mac_monitor_persist", str(ROOT / "bin/mac-monitor-persist"))
SPEC = importlib.util.spec_from_loader("mac_monitor_persist", LOADER)
MOD = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(MOD)


def make_state(serial=1, monitors=None, logical_monitors=None):
    if monitors is None:
        monitors = [
            (
                ("eDP-1", "BOE", "0x095f", "0000"),
                [("1920x1080@60", 1920, 1080, 60.0, 1.0, [1.0], {"is-current": True, "is-preferred": True})],
                {},
            ),
            (
                ("HDMI-1", "DEL", "Dell U2720Q", "SN123"),
                [("2560x1440@60", 2560, 1440, 60.0, 1.0, [1.0], {"is-current": True, "is-preferred": True})],
                {},
            ),
        ]
    if logical_monitors is None:
        # External-only layout (HDMI-1 active, eDP-1 disabled)
        logical_monitors = [
            (0, 0, 1.0, 0, True, [("HDMI-1", "DEL", "Dell U2720Q", "SN123")], {}),
        ]
    return (serial, monitors, logical_monitors, {"layout-mode": 1})


class MonitorPersistTests(unittest.TestCase):
    def test_fingerprint_is_order_independent(self):
        st1 = make_state()
        st2 = make_state(monitors=list(reversed(st1[1])))
        fp1, _ = MOD.compute_hardware_fingerprint(st1[1])
        fp2, _ = MOD.compute_hardware_fingerprint(st2[1])
        self.assertEqual(fp1, fp2)

    def test_save_and_build_restore_payload_for_external_only(self):
        with tempfile.TemporaryDirectory() as folder:
            profile_file = pathlib.Path(folder) / "monitor-profiles.json"

            # User pressed Super+P -> External Only (HDMI-1 only)
            external_only_state = make_state(serial=7)
            snap = MOD.snapshot_layout(external_only_state)
            self.assertEqual(len(snap["logical_monitors"]), 1)
            self.assertEqual(snap["logical_monitors"][0]["monitors"][0]["connector"], "HDMI-1")

            store = MOD.load_profiles(profile_file)
            store["profiles"][snap["fingerprint"]] = snap
            MOD.save_profiles(profile_file, store)

            # On next boot, GNOME resets to Join Displays (both eDP-1 and HDMI-1)
            boot_state = make_state(
                serial=12,
                logical_monitors=[
                    (0, 0, 1.0, 0, True, [("eDP-1", "BOE", "0x095f", "0000")], {}),
                    (1920, 0, 1.0, 0, False, [("HDMI-1", "DEL", "Dell U2720Q", "SN123")], {}),
                ],
            )
            boot_snap = MOD.snapshot_layout(boot_state)
            saved = MOD.load_profiles(profile_file)["profiles"][boot_snap["fingerprint"]]
            self.assertFalse(MOD.layouts_match(boot_snap, saved))

            payload = MOD.build_apply_payload(boot_state[0], saved, boot_state[1])
            self.assertIsNotNone(payload)
            serial, method, logical_arg, _props = payload
            self.assertEqual(serial, 12)
            self.assertEqual(method, MOD.APPLY_METHOD_PERSISTENT)
            self.assertEqual(len(logical_arg), 1)
            self.assertEqual(logical_arg[0][5][0][0], "HDMI-1")
            self.assertEqual(logical_arg[0][5][0][1], "2560x1440@60")

    def test_no_restore_when_layout_already_matches(self):
        st = make_state()
        snap = MOD.snapshot_layout(st)
        self.assertTrue(MOD.layouts_match(snap, snap))

    def test_unplugged_external_monitor_does_not_apply_stale_profile(self):
        dual_state = make_state()
        saved = MOD.snapshot_layout(dual_state)
        laptop_only_monitors = [dual_state[1][0]]  # Only eDP-1 connected
        payload = MOD.build_apply_payload(2, saved, laptop_only_monitors)
        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
