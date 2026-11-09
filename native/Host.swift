import AppKit
import Foundation

@main
struct NativeHost {
    static func readExactly(_ count: Int) throws -> Data {
        var data = Data()
        while data.count < count {
            guard let part = try FileHandle.standardInput.read(upToCount: count - data.count), !part.isEmpty else {
                throw CocoaError(.fileReadCorruptFile)
            }
            data.append(part)
        }
        return data
    }

    static func readRequest() throws -> TouchIDRequest {
        let header = try readExactly(4)
        let length = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
        guard length > 0 && length <= 4096 else { throw CocoaError(.fileReadCorruptFile) }
        return try JSONDecoder().decode(TouchIDRequest.self, from: readExactly(Int(length)))
    }

    static func write(_ response: TouchIDResponse) throws {
        let data = try JSONEncoder().encode(response)
        var size = UInt32(data.count).littleEndian
        let header = withUnsafeBytes(of: &size) { Data($0) }
        try FileHandle.standardOutput.write(contentsOf: header + data)
    }

    @MainActor static func main() {
        do {
            let request = try readRequest()
            let application = NSApplication.shared
            application.setActivationPolicy(.accessory)
            Task { @MainActor in
                let response = await TouchID.respond(to: request)
                try? write(response)
                application.terminate(nil)
            }
            application.run()
        } catch {
            try? write(TouchIDResponse(nonce: "", supported: false, verified: false, error: "invalid"))
        }
    }
}
