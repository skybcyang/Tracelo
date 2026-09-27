import CaptureCore
import Foundation
let examples = ["只有标题", "  中文 *任务* [链接] <tag> 😀  \n背景\n\n![图片](任务附件/截图.png)\nhttps://example.com/a/b\n尾行", "反斜线\\与\"引号\"\n\t制表\u{0008}\u{0001}\u{2028}分隔符\n<!-- 注释 -->"]
let index = Int(CommandLine.arguments.dropFirst().first ?? "0") ?? 0
let request = try CaptureRequest(text: examples[index], id: "desktop-fixture-\(index)", eventID: "created-\(index)", now: Date(timeIntervalSince1970: 1790467200.123), timezone: TimeZone(identifier: "Asia/Shanghai")!)
print(request.markdown, terminator: "")
