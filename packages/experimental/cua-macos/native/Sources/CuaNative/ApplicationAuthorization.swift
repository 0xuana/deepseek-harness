// Consent follows the bundle identifier or executable path; handles identify one process instance.
import AppKit
import CryptoKit
import Foundation

enum ApplicationAuthorization {
    // Versions and copies with the same bundle identifier share consent, regardless of signing.
    static func describe(_ identity: ProcessIdentity, name: String, expectedExecutablePath: String?) throws -> JSONValue {
        try NativePlatform.verify(identity)
        guard let executablePath = NativePlatform.executablePath(identity.pid) else {
            throw NativeFailure(code: "APP_UNAVAILABLE", message: "Cannot identify the application executable")
        }
        let path = URL(fileURLWithPath: executablePath).resolvingSymlinksInPath().path
        if let expectedExecutablePath, path != URL(fileURLWithPath: expectedExecutablePath).resolvingSymlinksInPath().path {
            throw NativeFailure(code: "STALE_APP", message: "Application executable changed during selection; select the application again")
        }
        let application = NSRunningApplication(processIdentifier: identity.pid)
        var bundleID = application?.bundleIdentifier
        if bundleID?.isEmpty != false, let url = application?.bundleURL,
           let installed = InstalledApplication.read(url), installed.executablePath == path {
            bundleID = installed.bundleID
        }
        try NativePlatform.verify(identity)
        return record(bundleID: bundleID, name: name, executablePath: path)
    }

    static func describeInstalled(_ app: InstalledApplication) throws -> JSONValue {
        guard let current = InstalledApplication.read(URL(fileURLWithPath: app.path)),
              current.bundleID == app.bundleID, current.executablePath == app.executablePath else {
            throw NativeFailure(code: "STALE_APP", message: "Application changed after selection; select it again")
        }
        return record(bundleID: current.bundleID, name: app.name, executablePath: current.executablePath)
    }

    private static func record(bundleID: String?, name: String, executablePath: String) -> JSONValue {
        let path = URL(fileURLWithPath: executablePath).resolvingSymlinksInPath().path
        let identity: String
        if let bundleID, !bundleID.isEmpty { identity = "macos:bundle-id:" + bundleID }
        else { identity = "macos:executable-path:" + path }
        return .object(["id": .string(digest(identity)), "name": .string(name),
                        "executablePath": .string(path), "persistable": .bool(true)])
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
