import BackgroundTasks
import UserNotifications
import WebKit

/// The background task: when iOS allows (it decides; usually every 15 minutes or much less often, and not at all for an app that is rarely
/// opened), collect what the paired computers are holding for this phone and show it as notifications. The protocol is TypeScript, so this
/// runs the app's own `collect.html` in a hidden web view and gives it a few native functions (preferences, a UDP socket, a notification, "done").
enum BackgroundCollect {
    static let identifier = "app.helm.mobile.collect"
    private static var current: CollectRun?

    /// Call once at launch, before the app finishes starting.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            schedule()
            let run = CollectRun { success in task.setTaskCompleted(success: success); current = nil }
            current = run
            task.expirationHandler = { run.stop() }
            DispatchQueue.main.async { run.start() }
        }
    }

    /// Asks for the next run, no sooner than 15 minutes from now.
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

/// Serves the app's bundled web files to the hidden page on its own scheme, so module scripts load (they do not from file URLs).
private final class AssetHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = Bundle.main.resourceURL?.appendingPathComponent("public") else { task.didFailWithError(URLError(.badURL)); return }
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
        let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json", "svg": "image/svg+xml", "woff2": "font/woff2", "woff": "font/woff"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": types[file.pathExtension] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

private final class CollectRun: NSObject, WKScriptMessageHandler {
    private let finish: (Bool) -> Void
    private var web: WKWebView?
    private let udp: HelmUdp
    private var finished = false

    init(finish: @escaping (Bool) -> Void) {
        self.finish = finish
        var forward: ((Int, Data, String, Int) -> Void)?
        udp = HelmUdp { id, data, host, port in forward?(id, data, host, port) }
        super.init()
        forward = { [weak self] id, data, host, port in
            DispatchQueue.main.async {
                self?.web?.evaluateJavaScript("window.__helmUdp&&window.__helmUdp(\(id),'\(data.base64EncodedString())','\(host.replacingOccurrences(of: "'", with: ""))',\(port))")
            }
        }
    }

    /// The preferences the page reads, as the app's Preferences plugin stored them (UserDefaults, with this prefix).
    private func preferences() -> String {
        var out: [String: String] = [:]
        for key in ["helm.instances", "helm.seenNotices"] {
            if let value = UserDefaults.standard.string(forKey: "CapacitorStorage." + key) { out[key] = value }
        }
        let data = (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    func start() {
        let saved = UserDefaults.standard.string(forKey: "CapacitorStorage.helm.instances") ?? ""
        guard saved.contains("\"desktop\"") else { return complete(true) }

        let shim = """
        (function(){var prefs=\(preferences());var n=0;function post(m){window.webkit.messageHandlers.helm.postMessage(m);}
        window.HelmHeadless={getPref:function(k){return k in prefs?prefs[k]:null},setPref:function(k,v){prefs[k]=v;post({t:'pref',k:k,v:v})},
        udpBind:function(){var id=++n;post({t:'bind',id:id});return id},udpSend:function(id,d,h,p){post({t:'send',id:id,d:d,h:h,p:p})},
        udpClose:function(id){post({t:'close',id:id})},notify:function(j){post({t:'notify',j:j})},done:function(c){post({t:'done',n:c})}};})();
        """
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(self, name: "helm")
        configuration.setURLSchemeHandler(AssetHandler(), forURLScheme: "helm-collect")
        let view = WKWebView(frame: .zero, configuration: configuration)
        web = view
        view.load(URLRequest(url: URL(string: "helm-collect://app/collect.html")!))
        // A background run has about thirty seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.complete(true) }
    }

    func stop() { DispatchQueue.main.async { self.complete(false) } }

    private func complete(_ success: Bool) {
        guard !finished else { return }
        finished = true
        udp.closeAll()
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "helm")
        web = nil
        finish(success)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let kind = m["t"] as? String else { return }
        switch kind {
        case "pref":
            if let k = m["k"] as? String, let v = m["v"] as? String { UserDefaults.standard.set(v, forKey: "CapacitorStorage." + k) }
        case "bind":
            if let id = m["id"] as? Int { _ = try? udp.bind(as: id) }
        case "send":
            if let id = m["id"] as? Int, let d = m["d"] as? String, let h = m["h"] as? String, let p = m["p"] as? Int, let data = Data(base64Encoded: d) { udp.send(id: id, data: data, host: h, port: p) }
        case "close":
            if let id = m["id"] as? Int { udp.close(id: id) }
        case "notify":
            if let json = m["j"] as? String, let data = json.data(using: .utf8), let n = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let content = UNMutableNotificationContent()
                content.title = n["title"] as? String ?? "helm"
                content.body = n["body"] as? String ?? ""
                content.subtitle = n["instanceName"] as? String ?? ""
                // Capacitor's notification plugin reports a tap with this as its `extra` (mobile-app/src/open.ts reads it).
                content.userInfo = ["instance": n["instanceId"] as? String ?? "", "session": n["sessionId"] as? String ?? "", "kind": n["kind"] as? String ?? ""]
                if (n["silent"] as? Bool) != true { content.sound = .default }
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: n["id"] as? String ?? UUID().uuidString, content: content, trigger: nil))
            }
        case "done":
            complete(true)
        default: break
        }
    }
}
