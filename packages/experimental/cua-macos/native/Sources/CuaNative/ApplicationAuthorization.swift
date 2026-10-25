// Consent follows the native bundle identifier; handles still identify one process instance.
import AppKit
import CryptoKit
import Foundation

enum ApplicationAuthorization {
    // Versions and copies with the same bundle identifier share consent, regardless of signing.
    static func describe(_ identity: ProcessIdentity, name: String, expectedExecutablePath: String?) throws -> JSONValue {
        try NativePlatform.verify(identity)
        guard let executablePath = NativePlatform.executablePath(identity.pid), let expectedExecutablePath else {
            throw NativeFailure(code: "APP_UNAVAILABLE", message: "Cannot identify the application executable")
        }
        let path = URL(fileURLWithPath: executablePath).resolvingSymlinksInPath().path
        guard path == URL(fileURLWithPath: expectedExecutablePath).resolvingSymlinksInPath().path else {
            throw NativeFailure(code: "STALE_APP", message: "Application executable changed during selection; select the application again")
        }
        let persistentID = bundleIdentity(NSRunningApplication(processIdentifier: identity.pid)?.bundleIdentifier)
        let process = "process:\(identity.pid):\(identity.startedSeconds):\(identity.startedMicroseconds)"
        let id = persistentID ?? digest(path + "\n" + process)
        try NativePlatform.verify(identity)
        return .object([
            "id": .string(id), "name": .string(name), "executablePath": .string(path),
            "persistable": .bool(persistentID != nil),
        ])
    }

    static func describeInstalled(_ app: InstalledApplication) throws -> JSONValue {
        guard let current = InstalledApplication.read(URL(fileURLWithPath: app.path)),
              current.bundleID == app.bundleID, current.executablePath == app.executablePath else {
            throw NativeFailure(code: "STALE_APP", message: "Application changed after selection; select it again")
        }
        let persistentID = bundleIdentity(app.bundleID)
        let id: String
        if let persistentID { id = persistentID }
        else {
            let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: app.executablePath))
            defer { try? handle.close() } // FileHandle also owns closure if an OS close error is reported.
            var hash = SHA256()
            while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty { hash.update(data: data) }
            let executable = "executable:" + hash.finalize().map { String(format: "%02x", $0) }.joined()
            id = digest(app.executablePath + "\n" + executable)
        }
        return .object(["id": .string(id), "name": .string(app.name), "executablePath": .string(app.executablePath),
                        "persistable": .bool(persistentID != nil)])
    }

    private static func bundleIdentity(_ identifier: String?) -> String? {
        guard let identifier, !identifier.isEmpty else { return nil }
        return digest("macos:bundle-id:" + identifier)
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
