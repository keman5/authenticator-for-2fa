import Foundation
import LocalAuthentication

struct TouchIDRequest: Codable, Sendable {
    let version: Int
    let action: String
    let nonce: String
    let reason: String?

    var isValid: Bool {
        version == 1 && ["status", "authenticate"].contains(action)
        && nonce.count == 64 && nonce.allSatisfy { $0.isHexDigit && $0.isASCII }
        && (action != "authenticate" || (reason.map { !$0.isEmpty && $0.count <= 256 } ?? false))
    }
}

struct TouchIDResponse: Encodable, Sendable {
    let version = 1
    let nonce: String
    let supported: Bool
    let verified: Bool
    let error: String?
}

struct TouchID {
    static func failure(_ error: Error?) -> String {
        guard let error = error as? LAError else { return "failed" }
        // Newer macOS reports an unpaired biometric accessory as -12.
        if error.code.rawValue == -12 { return "unavailable" }
        return switch error.code {
        case .userCancel, .appCancel, .systemCancel, .userFallback: "cancelled"
        case .biometryLockout: "locked"
        case .biometryNotEnrolled: "notEnrolled"
        case .biometryNotAvailable, .passcodeNotSet, .notInteractive: "unavailable"
        default: "failed"
        }
    }

    static func respond(to request: TouchIDRequest) async -> TouchIDResponse {
        guard request.isValid else {
            return TouchIDResponse(nonce: "", supported: false, verified: false, error: "invalid")
        }
        let context = LAContext()
        defer { context.invalidate() }
        context.localizedFallbackTitle = ""
        context.touchIDAuthenticationAllowableReuseDuration = 0
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        guard available && context.biometryType == .touchID else {
            return TouchIDResponse(nonce: request.nonce, supported: false, verified: false,
                                   error: error.map { failure($0) } ?? "unavailable")
        }
        if request.action == "status" {
            return TouchIDResponse(nonce: request.nonce, supported: true, verified: false, error: nil)
        }
        do {
            let success = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                                                           localizedReason: request.reason ?? "")
            return TouchIDResponse(nonce: request.nonce, supported: true, verified: success,
                                   error: success ? nil : "failed")
        } catch {
            return TouchIDResponse(nonce: request.nonce, supported: true, verified: false, error: failure(error))
        }
    }
}
