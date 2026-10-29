import Capacitor
import Foundation

/// The page's UDP socket (see mobile/src/native.ts). Datagrams arrive as "message" events with base64 data.
@objc(HelmUdpPlugin)
public class HelmUdpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HelmUdpPlugin"
    public let jsName = "HelmUdp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "bind", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private lazy var udp = HelmUdp { [weak self] id, data, host, port in
        self?.notifyListeners("message", data: ["id": id, "data": data.base64EncodedString(), "host": host, "port": port])
    }

    @objc func bind(_ call: CAPPluginCall) {
        do { call.resolve(["id": try udp.bind()]) } catch { call.reject(error.localizedDescription) }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let id = call.getInt("id"), let text = call.getString("data"), let host = call.getString("host"), let port = call.getInt("port"), let data = Data(base64Encoded: text) else {
            call.reject("bad arguments")
            return
        }
        udp.send(id: id, data: data, host: host, port: port)
        call.resolve()
    }

    @objc func close(_ call: CAPPluginCall) {
        if let id = call.getInt("id") { udp.close(id: id) }
        call.resolve()
    }

    deinit { udp.closeAll() }
}
