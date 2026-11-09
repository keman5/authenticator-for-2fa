import Foundation
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let message = item.userInfo?[SFExtensionMessageKey],
              let data = try? JSONSerialization.data(withJSONObject: message),
              data.count <= 4096,
              let request = try? JSONDecoder().decode(TouchIDRequest.self, from: data) else {
            context.cancelRequest(withError: CocoaError(.fileReadCorruptFile))
            return
        }
        Task {
            let response = await TouchID.respond(to: request)
            let result = NSExtensionItem()
            if let data = try? JSONEncoder().encode(response),
               let message = try? JSONSerialization.jsonObject(with: data) {
                result.userInfo = [SFExtensionMessageKey: message]
                context.completeRequest(returningItems: [result], completionHandler: nil)
            } else {
                context.cancelRequest(withError: CocoaError(.fileWriteUnknown))
            }
        }
    }
}
