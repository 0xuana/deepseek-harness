"""Verify bundle consent across cold and running application copies without desktop input."""
import argparse
from contextlib import ExitStack
import hashlib
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
        identities = []
        for name, bundle_id in [("Version One", identifier), ("Version Two", identifier), ("Other", identifier + ".other")]:
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
            pending = helper.call("getApp", {"selector": str(app)})
            assert pending["pid"] is None and not state.exists(), pending
            assert pending["authorization"]["persistable"] is True, pending
            launched = helper.call("launchApp", {"appHandle": pending["appHandle"]})
            pid = launched["pid"]
            cleanup.callback(stop_application, pid)
            wait_for_state(state, lambda value: value["pid"] == pid)
            running = helper.call("getApp", {"selector": str(pid)})
            assert running["authorization"] == pending["authorization"], (pending, running)
            assert Path(running["authorization"]["executablePath"]) == executable, running
            identities.append(running["authorization"]["id"])
        assert identities[0] == identities[1] == expected, identities
        assert identities[2] != expected, identities
        print("PASS: cold/running identities agree; simultaneous ad-hoc copies share consent; other IDs stay separate")


if __name__ == "__main__":
    main()
