// Installed application discovery uses isolated bundles and does not launch user applications.
import AppKit
import Foundation
import Testing
@testable import CuaNative

private func fixtureApplication(_ directory: URL, name: String, identifier: String?) throws -> InstalledApplication {
    let app = directory.appendingPathComponent(name + ".app")
    let contents = app.appendingPathComponent("Contents")
    let executable = contents.appendingPathComponent("MacOS/app")
    try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
    var info = ["CFBundleName": name, "CFBundleExecutable": "app", "CFBundlePackageType": "APPL"]
    if let identifier { info["CFBundleIdentifier"] = identifier }
    try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
    try Data("fixture executable".utf8).write(to: executable)
    return try #require(InstalledApplication.read(app))
}

@Test @MainActor func findsStoppedApplicationsAndIdentifiesRunningMatchesWithoutLaunching() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-cua-apps-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let app = try fixtureApplication(root, name: "Fixture Editor", identifier: "test.dsh.cua." + UUID().uuidString)
    let matches = try ApplicationDiscovery.applications(matching: "fixture editor", exact: true, limit: 2,
                                                       cancellation: CancellationLatch(), roots: [root])
    #expect(matches == [app])
    #expect(app.json(catalog: ApplicationCatalogSnapshot(applications: [], frontPID: nil))["isRunning"] == .bool(false))
    let process = ApplicationInfo(pid: 123, name: app.name, bundleID: app.bundleID, path: app.path,
                                  executablePath: app.executablePath, regular: true)
    let running = app.json(catalog: ApplicationCatalogSnapshot(applications: [process], frontPID: nil))
    #expect(running["isRunning"] == .bool(true))
    #expect(running["pid"] == .number(123))
    #expect(running["path"] == .string(app.path))
}

@Test @MainActor func broadQueriesRejectInsteadOfHidingApplicationAmbiguity() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-cua-apps-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try fixtureApplication(root, name: "Fixture One", identifier: "test.dsh.one." + UUID().uuidString)
    _ = try fixtureApplication(root, name: "Fixture Two", identifier: "test.dsh.two." + UUID().uuidString)
    #expect(throws: NativeFailure.self) {
        try ApplicationDiscovery.applications(matching: "Fixture", exact: false, limit: 1, cancellation: CancellationLatch(), roots: [root])
    }
    let cancellation = CancellationLatch()
    cancellation.cancel()
    #expect(throws: NativeFailure.self) {
        try ApplicationDiscovery.applications(matching: "Fixture", exact: false, limit: 2, cancellation: cancellation, roots: [root])
    }
}

@Test(arguments: [nil, ""] as [String?]) func unidentifiedPendingIdentityChangesWhenTheExecutableChanges(identifier: String?) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-cua-apps-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let app = try fixtureApplication(root, name: "Fixture", identifier: identifier)
    let before = try ApplicationAuthorization.describeInstalled(app)
    #expect(before["persistable"] == .bool(false))
    try Data("replacement executable".utf8).write(to: URL(fileURLWithPath: app.executablePath))
    let after = try ApplicationAuthorization.describeInstalled(app)
    #expect(before["id"] != after["id"])
}

@Test func unsignedVersionsShareConsentOnlyForTheSameBundleIdentifier() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-cua-apps-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let identifier = "test.dsh.consent." + UUID().uuidString
    let first = try fixtureApplication(root, name: "Editor One", identifier: identifier)
    let second = try fixtureApplication(root, name: "Editor Two", identifier: identifier)
    let other = try fixtureApplication(root, name: "Other", identifier: identifier + ".other")
    let differentCase = try fixtureApplication(root, name: "Case", identifier: identifier.uppercased())
    let approved = try ApplicationAuthorization.describeInstalled(first)
    #expect(approved["persistable"] == .bool(true))
    let copy = try ApplicationAuthorization.describeInstalled(second)
    #expect(copy["id"] == approved["id"])
    #expect(copy["executablePath"] != approved["executablePath"])
    #expect(try ApplicationAuthorization.describeInstalled(other)["id"] != approved["id"])
    #expect(try ApplicationAuthorization.describeInstalled(differentCase)["id"] != approved["id"])
    try Data("new version".utf8).write(to: URL(fileURLWithPath: first.executablePath))
    #expect(try ApplicationAuthorization.describeInstalled(first)["id"] == approved["id"])
}

@Test(arguments: ["identifier", "missing-identifier", "executable", "missing-plist"])
func changedBundleMetadataInvalidatesACachedSelection(change: String) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-cua-apps-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let selected = try fixtureApplication(root, name: "Fixture", identifier: "test.dsh.consent." + UUID().uuidString)
    let url = URL(fileURLWithPath: selected.path)
    let plist = url.appendingPathComponent("Contents/Info.plist")
    let cachedBundle = try #require(Bundle(url: url))
    #expect(cachedBundle.bundleIdentifier == selected.bundleID)
    _ = try ApplicationAuthorization.describeInstalled(selected)
    var info = try #require(PropertyListSerialization.propertyList(from: Data(contentsOf: plist), format: nil) as? [String: String])
    switch change {
    case "identifier": info["CFBundleIdentifier"] = "test.dsh.replacement"
    case "missing-identifier": info.removeValue(forKey: "CFBundleIdentifier")
    case "executable":
        info["CFBundleExecutable"] = "replacement"
        try Data("replacement".utf8).write(to: url.appendingPathComponent("Contents/MacOS/replacement"))
    default: break
    }
    if change == "missing-plist" { try FileManager.default.removeItem(at: plist) }
    else { try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: plist) }
    do {
        _ = try ApplicationAuthorization.describeInstalled(selected)
        Issue.record("Cached application metadata allowed a changed bundle")
    } catch let error as NativeFailure {
        #expect(error.code == "STALE_APP")
    }
    withExtendedLifetime(cachedBundle) {}
}
