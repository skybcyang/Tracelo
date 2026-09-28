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
        for (content, width, height, expectedWidth, expectedHeight) in [(20.0, 1440.0, 900.0, 560.0, 260.0), (600, 1440, 900, 560, 420), (600, 400, 350, 368, 318)] {
            let size = capturePanelSize(contentHeight: content, available: CGSize(width: width, height: height))
            XCTAssertEqual(size.width, expectedWidth)
            XCTAssertEqual(size.height, expectedHeight)
        }
    }
}
let tests = CaptureCoreTests()
try tests.testFirstLineIsTitleAndNotesKeepOrder()
try tests.testAtomicPublishDoesNotOverwriteAndRetryIsIdempotent()
try tests.testConfigurationRejectsEscapingVaultAndMissingDirectories()
tests.testInputPolicyProtectsIMEAndPreservesShiftReturn()
tests.testPanelFitsAvailableScreenAndGrowsWithContent()
print("Capture core: 5 tests passed")
