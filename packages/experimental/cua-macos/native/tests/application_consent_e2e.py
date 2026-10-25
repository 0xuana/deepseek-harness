"""Verify bundle consent across cold and running application copies without desktop input."""
import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import uuid

from capabilities_e2e import stop_application, wait_for_state
from native_test_support import BINARY, ROOT, NativeHelper


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", type=Path, default=BINARY)
    args = parser.parse_args()
    transcript = []
    with tempfile.TemporaryDirectory(prefix="dsh-cua-consent-") as temporary, ExitStack() as cleanup:
        root = Path(temporary)
        binary = root / "fixture"
        subprocess.run(["xcrun", "swiftc", str(ROOT / "tests/CapabilitiesFixture.swift"), "-o", str(binary)],
                       check=True, timeout=60)
        identifier = "test.dsh.consent." + uuid.uuid4().hex
        expected = hashlib.sha256(("macos:bundle-id:" + identifier).encode()).hexdigest()
        helper = NativeHelper(transcript, args.helper)
        cleanup.callback(helper.stop)
        register = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
        def fixture(name, bundle_id):
            app = root / (name + ".app")
            executable = app / "Contents/MacOS/fixture"
            executable.parent.mkdir(parents=True)
            shutil.copy2(binary, executable)
            state = root / (name + ".json")
            info = {"CFBundleIdentifier": bundle_id, "CFBundleName": name, "CFBundleDisplayName": name,
                    "CFBundleExecutable": "fixture", "CFBundlePackageType": "APPL",
                    "DSHFixtureStatePath": str(state), "DSHFixtureBackground": True}
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
            cleanup.callback(subprocess.run, [register, "-u", str(app)], check=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            def stop_started_fixture():
                if state.exists():
                    stop_application(json.loads(state.read_text())["pid"])
            cleanup.callback(stop_started_fixture)
            return app, executable, state, info

        for change in ["identifier", "missing-identifier", "executable", "missing-plist"]:
            app, executable, state, info = fixture("Changed " + change, identifier + "." + change)
            pending = helper.call("getApp", {"selector": str(app)})
            plist = app / "Contents/Info.plist"
            if change == "identifier":
                info["CFBundleIdentifier"] += ".replacement"
            elif change == "missing-identifier":
                del info["CFBundleIdentifier"]
            elif change == "executable":
                info["CFBundleExecutable"] = "replacement"
                shutil.copy2(binary, executable.with_name("replacement"))
            if change == "missing-plist":
                plist.unlink()
            else:
                plist.write_bytes(plistlib.dumps(info))
            helper.call("launchApp", {"appHandle": pending["appHandle"]}, error_code="STALE_APP")
            assert not state.exists(), "The replaced application was started before refusal"
            assert not any(app["isRunning"] for app in helper.call("findApps", {"query": str(app), "maxAppMatches": 20}))

        identities = []
        for name, bundle_id in [("Version One", identifier), ("Version Two", identifier), ("Other", identifier + ".other")]:
            app, executable, state, info = fixture(name, bundle_id)
            pending = helper.call("getApp", {"selector": str(app)})
            assert pending["pid"] is None and not state.exists(), pending
            assert pending["authorization"]["persistable"] is True, pending
            launched = helper.call("launchApp", {"appHandle": pending["appHandle"]})
            pid = launched["pid"]
            wait_for_state(state, lambda value: value["pid"] == pid)
            running = helper.call("getApp", {"selector": str(pid)})
            assert running["authorization"]["id"] == pending["authorization"]["id"], (pending, running)
            assert running["authorization"]["persistable"] is True, running
            assert Path(running["authorization"]["executablePath"]).samefile(executable), running
            assert Path(pending["authorization"]["executablePath"]).samefile(executable), pending
            identities.append(running["authorization"]["id"])
        assert identities[0] == identities[1] == expected, identities
        assert identities[2] != expected, identities
        print("PASS: changed bundles cannot launch; cold/running identities agree; copies share consent; other IDs stay separate")


if __name__ == "__main__":
    main()
