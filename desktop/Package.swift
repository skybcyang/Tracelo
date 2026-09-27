// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "TraceloCapture", platforms: [.macOS(.v13)], products: [
    .executable(name: "TraceloCapture", targets: ["TraceloCapture"]),
    .executable(name: "archive-fixture", targets: ["ArchiveFixture"])
], targets: [
    .target(name: "CaptureCore"),
    .executableTarget(name: "TraceloCapture", dependencies: ["CaptureCore"]),
    .executableTarget(name: "ArchiveFixture", dependencies: ["CaptureCore"]),
    .executableTarget(name: "CaptureCoreTests", dependencies: ["CaptureCore"], path: "Tests/CaptureCoreTests")
])
