import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private static let bridgePrompt = "__CourseAppNative__"
    private static let stateKey = "course_schedule_state_json"
    private static let privacyResetKey = "privacy_reset_1_3"
    private static let updateRepository = "Plonkloving/CourseApp"

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 251 / 255, green: 250 / 255, blue: 247 / 255, alpha: 1)

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(
            WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        guard let entry = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "app") else {
            showLoadError()
            return
        }
        webView.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent())
    }

    private var bridgeScript: String {
        """
        (() => {
          const callNative = (method, args = []) => window.prompt(
            "\(Self.bridgePrompt)", JSON.stringify({method, args})
          );
          Object.defineProperty(window, "CourseAppNative", {value: {
            loadState: () => callNative("loadState") || "{}",
            saveState: (json) => callNative("saveState", [json]) || '{"ok":false,"error":"iOS 本地保存失败"}',
            getAppVersion: () => callNative("getAppVersion") || "",
            getPlatform: () => "iOS",
            checkForUpdate: () => callNative("checkForUpdate"),
            downloadUpdate: (url) => callNative("downloadUpdate", [url])
          }});
        })();
        """
    }

    private func handleBridgeRequest(_ text: String?) -> String {
        guard
            let data = text?.data(using: .utf8),
            let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let method = request["method"] as? String
        else { return "" }
        let arguments = request["args"] as? [Any] ?? []

        switch method {
        case "loadState":
            return loadState()
        case "saveState":
            guard let json = arguments.first as? String, isValidState(json) else {
                return jsonString(["ok": false, "error": "课程数据结构不合法"])
            }
            UserDefaults.standard.set(json, forKey: Self.stateKey)
            return jsonString(["ok": true])
        case "getAppVersion":
            return Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        case "getPlatform":
            return "iOS"
        case "checkForUpdate":
            checkForUpdate()
            return ""
        case "downloadUpdate":
            if let value = arguments.first as? String { openTrustedUpdate(value) }
            return ""
        default:
            return ""
        }
    }

    private func loadState() -> String {
        if !UserDefaults.standard.bool(forKey: Self.privacyResetKey) {
            UserDefaults.standard.removeObject(forKey: Self.stateKey)
            UserDefaults.standard.set(true, forKey: Self.privacyResetKey)
        }
        if let saved = UserDefaults.standard.string(forKey: Self.stateKey), isValidState(saved) {
            return saved
        }
        return #"{"version":2,"semester":{"name":"课程表","weekOneStart":"2026-08-31","classStartDate":"2026-08-31","totalWeeks":19,"campus":""},"periods":[],"sessions":[]}"#
    }

    private func isValidState(_ value: String) -> Bool {
        guard let data = value.data(using: .utf8),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let semester = state["semester"] as? [String: Any],
              ((semester["weekOneStart"] is String && semester["classStartDate"] is String) || semester["firstDay"] is String),
              let sessions = state["sessions"] as? [Any] else { return false }
        return sessions.count <= 500
    }

    private func checkForUpdate() {
        guard let url = URL(string: "https://api.github.com/repos/\(Self.updateRepository)/releases/latest") else { return }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("CourseSchedule-iOS/\(appVersion)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            var result: [String: Any] = ["ok": false]
            defer { self?.sendUpdateResult(result) }
            guard error == nil, let data,
                  let release = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                result["error"] = "检查失败：无法连接 GitHub"
                return
            }
            let assets = release["assets"] as? [[String: Any]] ?? []
            let ipa = assets.first { (($0["name"] as? String) ?? "").lowercased().hasSuffix(".ipa") }
            result = [
                "ok": true,
                "currentVersion": self?.appVersion ?? "",
                "latestVersion": ((release["tag_name"] as? String) ?? "").replacingOccurrences(of: "^[vV]", with: "", options: .regularExpression),
                "ipaUrl": (ipa?["browser_download_url"] as? String) ?? "",
                "releaseUrl": (release["html_url"] as? String) ?? ""
            ]
        }.resume()
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    private func sendUpdateResult(_ result: [String: Any]) {
        let payload = jsonString(result)
        let script = "window.onNativeUpdateCheck(\(javaScriptLiteral(payload)))"
        DispatchQueue.main.async { [weak self] in self?.webView.evaluateJavaScript(script) }
    }

    private func openTrustedUpdate(_ value: String) {
        guard let url = URL(string: value), url.scheme == "https",
              let host = url.host?.lowercased(),
              host == "github.com" || host.hasSuffix(".githubusercontent.com") else { return }
        UIApplication.shared.open(url)
    }

    private func jsonString(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }

    private func javaScriptLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let array = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }

    private func showLoadError() {
        let label = UILabel()
        label.text = "无法加载课程页面，请重新构建应用。"
        label.textAlignment = .center
        label.numberOfLines = 0
        label.frame = view.bounds.insetBy(dx: 24, dy: 24)
        view.addSubview(label)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        if prompt == Self.bridgePrompt {
            completionHandler(handleBridgeRequest(defaultText))
            return
        }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url, !url.isFileURL {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
