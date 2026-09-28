import Foundation
import CaptureCore
func XCTAssertEqual<T: Equatable>(_ a: T, _ b: T) { precondition(a == b, "Expected \(b), got \(a)") }
func XCTAssertThrowsError<T>(_ action: @autoclosure () throws -> T) { do { _ = try action(); fatalError("Expected error") } catch {} }
final class CaptureCoreTests {
    func testFirstLineIsTitleAndNotesKeepOrder() throws {
        let draft = try CaptureDraft("  中文 *任务*  \r\n背景\n\n![图片](image.png)")
        XCTAssertEqual(draft.title, "中文 *任务*")
        XCTAssertEqual(draft.notes, "背景\n\n![图片](image.png)")
        XCTAssertThrowsError(try CaptureDraft(" \n备注不能代替标题"))
    }
    func testAtomicPublishDoesNotOverwriteAndRetryIsIdempotent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let request = try CaptureRequest(text: "任务\n详情", id: "fixed-id", eventID: "event", now: Date(timeIntervalSince1970: 0), timezone: TimeZone(secondsFromGMT: 0)!)
        let url = try request.publish(to: directory)
        XCTAssertEqual(try request.publish(to: directory), url)
        XCTAssertEqual(try String(contentsOf: url), request.markdown)
        let other = try CaptureRequest(text: "其他", id: "fixed-id", eventID: "event", now: Date(timeIntervalSince1970: 0), timezone: TimeZone(secondsFromGMT: 0)!)
        XCTAssertThrowsError(try other.publish(to: directory))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["fixed-id.md"])
    }
    func testConfigurationRejectsEscapingVaultAndMissingDirectories() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertThrowsError(try CaptureConfiguration(vault: directory.path, taskDirectory: "../escape").destination())
        XCTAssertThrowsError(try CaptureConfiguration(vault: directory.path, taskDirectory: "missing").destination())
        XCTAssertEqual(try CaptureConfiguration(vault: directory.path, taskDirectory: ".").destination().path, directory.resolvingSymlinksInPath().path)
    }
    func testInputPolicyProtectsIMEAndPreservesShiftReturn() {
        XCTAssertEqual(inputAction(keyCode: 36, shift: false, marked: true), .system)
        XCTAssertEqual(inputAction(keyCode: 36, shift: true, marked: false), .system)
        XCTAssertEqual(inputAction(keyCode: 36, shift: false, marked: false), .submit)
        XCTAssertEqual(inputAction(keyCode: 53, shift: false, marked: false), .dismiss)
    }
    func testPanelFitsAvailableScreenAndGrowsWithContent() {
        for (content, width, height, expectedWidth, expectedHeight) in [(20.0, 1440.0, 900.0, 560.0, 260.0), (600, 1440, 900, 560, 760), (1000, 1440, 900, 560, 780), (600, 400, 350, 368, 318)] {
            let size = capturePanelSize(contentHeight: content, available: CGSize(width: width, height: height))
            XCTAssertEqual(size.width, expectedWidth)
            XCTAssertEqual(size.height, expectedHeight)
        }
    }
    func testSharedRequestPreservesBytesAndRejectsMismatchedOrUnsafeHeader() throws {
        let original = try CaptureRequest(text: "任务\n详情", id: "shared-id")
        let shared = try CaptureRequest(id: original.id, markdown: original.markdown)
        XCTAssertEqual(shared.markdown, original.markdown)
        XCTAssertThrowsError(try CaptureRequest(id: "different-id", markdown: original.markdown))
        XCTAssertThrowsError(try CaptureRequest(id: "../escape", markdown: original.markdown))
        XCTAssertThrowsError(try CaptureRequest(id: "shared-id", markdown: "# no archive header"))
        XCTAssertThrowsError(try CaptureRequest(id: "shared-id", markdown: original.markdown.replacingOccurrences(of: "\"version\": 1", with: "\"version\": 2")))
        XCTAssertThrowsError(try CaptureRequest(id: "shared-id", markdown: original.markdown.replacingOccurrences(of: "\"events\": [", with: "\"invalidEvents\": [")))
        XCTAssertThrowsError(try CaptureRequest(id: "shared-id", markdown: original.markdown.replacingOccurrences(of: "\"important\": false", with: "\"important\": \"false\"")))
        XCTAssertThrowsError(try CaptureRequest(id: "shared-id", markdown: original.markdown.replacingOccurrences(of: "\"timezone\":", with: "\"invalidTimezone\":")))
        for id in ["NUL", "bad?name", "trailing.", "bad\u{0}", String(repeating: "x", count: 181)] {
            XCTAssertThrowsError(try CaptureRequest(text: "任务", id: id))
        }
    }
    func testStructuredDraftRoundTripPreservesAllFieldsAndMigratesLegacy() throws {
        let draft = try CaptureFormDraft(json: ["title": "标题", "notes": "详情\n第二行", "groupId": "group-a", "quadrant": "important_urgent", "todos": ["第一项", "第二项"], "dueDate": "2026-10-01", "initialProgress": "初始进展", "expanded": ["todos": true, "due": true, "progress": false]])
        let restored = try CaptureFormDraft(data: draft.data)
        XCTAssertEqual(restored.data, draft.data)
        XCTAssertEqual(restored.values["todos"] as? [String], ["第一项", "第二项"])
        let legacy = CaptureFormDraft(legacyText: "  旧标题  \r\n旧详情\r\n\r\n末尾")
        XCTAssertEqual(legacy.values["title"] as? String, "旧标题")
        XCTAssertEqual(legacy.values["notes"] as? String, "旧详情\n\n末尾")
        XCTAssertThrowsError(try CaptureFormDraft(data: Data("broken".utf8)))
        XCTAssertThrowsError(try CaptureFormDraft(json: ["invalid": Double.nan]))
    }
    func testGroupsSourceMissingIsEmptyButUnreadableSourceFails() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let configuration = CaptureConfiguration(vault: directory.path, taskDirectory: ".")
        XCTAssertEqual(try configuration.groupsSource(), "")
        let source = "分组原文\n保持原始字节"
        let groups = directory.appendingPathComponent("_groups.md")
        try source.write(to: groups, atomically: true, encoding: .utf8)
        XCTAssertEqual(try configuration.groupsSource(), source)
        try Data([0xff, 0xfe, 0xff]).write(to: groups)
        XCTAssertThrowsError(try configuration.groupsSource())
    }
}
let tests = CaptureCoreTests()
try tests.testFirstLineIsTitleAndNotesKeepOrder()
try tests.testAtomicPublishDoesNotOverwriteAndRetryIsIdempotent()
try tests.testConfigurationRejectsEscapingVaultAndMissingDirectories()
tests.testInputPolicyProtectsIMEAndPreservesShiftReturn()
tests.testPanelFitsAvailableScreenAndGrowsWithContent()
try tests.testSharedRequestPreservesBytesAndRejectsMismatchedOrUnsafeHeader()
try tests.testStructuredDraftRoundTripPreservesAllFieldsAndMigratesLegacy()
try tests.testGroupsSourceMissingIsEmptyButUnreadableSourceFails()
print("Capture core: 8 tests passed")
