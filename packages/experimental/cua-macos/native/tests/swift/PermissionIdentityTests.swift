// The selected catalog entry must still identify the executable inspected for consent.
import AppKit
import Darwin
import Foundation
import Testing
@testable import CuaNative

@Test func rejectsAChangedExecutableBeforeProducingAnAuthorizationIdentity() throws {
    let identity = try NativePlatform.identity(getpid())
    do {
        _ = try ApplicationAuthorization.describe(identity, name: "Fixture", expectedExecutablePath: "/not/the/running/executable")
        Issue.record("A changed executable was accepted")
    } catch let error as NativeFailure {
        #expect(error.code == "STALE_APP")
    }
}

@Test func readsTheProcessPathWhenTheCatalogHasNoExecutableLocation() throws {
    let identity = try NativePlatform.identity(getpid())
    let path = try #require(NativePlatform.executablePath(identity.pid))
    let observed = try ApplicationAuthorization.describe(identity, name: "Fixture", expectedExecutablePath: nil)
    #expect(observed["persistable"] == .bool(true))
    #expect(try ApplicationAuthorization.describe(identity, name: "Fixture", expectedExecutablePath: path) == observed)
}

@MainActor @Test func applicationIconsUseBoundedNativePNGs() throws {
    let encoded = try #require(ApplicationCatalog.icon(at: "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder"))
    #expect(encoded.hasPrefix("data:image/png;base64,"))
    let data = try #require(Data(base64Encoded: String(encoded.dropFirst("data:image/png;base64,".count))))
    let bitmap = try #require(NSBitmapImageRep(data: data))
    #expect(bitmap.pixelsWide == 64)
    #expect(bitmap.pixelsHigh == 64)
    #expect(encoded.utf8.count <= 65536)
}

@Test func unbundledRunningProcessesReceivePersistentPathConsent() throws {
    var records: [JSONValue] = []
    for _ in 0..<2 {
        let process = Process()
        let input = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/cat")
        process.standardInput = input
        process.standardOutput = FileHandle.nullDevice
        try process.run()
        defer {
            input.fileHandleForWriting.closeFile()
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
        }
        let identity = try NativePlatform.identity(process.processIdentifier)
        let executable = try #require(NativePlatform.executablePath(identity.pid))
        let authorization = try ApplicationAuthorization.describe(identity, name: "Fixture", expectedExecutablePath: executable)
        #expect(authorization["persistable"] == .bool(true))
        #expect(authorization["id"].string?.count == 64)
        records.append(authorization)
    }
    #expect(records[0] == records[1])
}

@Test func resolvesTheCurrentProcessResponsibility() throws {
    let responsible = try #require(NativePlatform.responsiblePID(getpid()))
    #expect(responsible > 0)
    #expect(NativePlatform.responsiblePID(responsible) == responsible)
}

@MainActor @Test func unknownResponsibilityDoesNotInventAnApplication() {
    #expect(SystemPermissions.responsibleApplication(for: 1) == nil)
    #expect(SystemPermissions.responsibleApplication(for: Int32.max) == nil)
    #expect(NativePlatform.responsiblePID(Int32.max) == nil)
}

@MainActor @Test func permissionStatusKeepsProcessDiagnosticsSeparateFromLaunchMetadata() {
    let permissions = SystemPermissions()
    let state = permissions.status()
    #expect(state["helper"]["pid"] == .number(Double(getpid())))
    #expect(state["parent"]["pid"] == .number(Double(getppid())))
    if let source = state["launchApplication"].object {
        #expect(source["name"]?.string?.isEmpty == false)
        #expect(source["path"]?.string?.hasSuffix(".app") == true)
    }
    #expect(permissions.status()["launchApplication"] == state["launchApplication"])
}
