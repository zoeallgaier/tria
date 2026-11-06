import Foundation
import UIKit
import Capacitor

/// One method: open this app's own page in iOS Settings.
///
/// It exists because of the one push failure the app could see but not answer.
/// `UNUserNotificationCenter.requestAuthorization` is a ONE-SHOT per install —
/// once it has been answered, either way, `requestPermissions` resolves
/// instantly with no UI, forever. So a reader who tapped "Don't Allow" (or who
/// switched Tria's notifications off in Settings later) lands in a state where
/// the profile's Notifications switch cannot do the thing it names: tapping it
/// raises no system prompt, because iOS will never show that prompt again. The
/// switch stayed off, nothing visible happened, and the only route out lived in
/// an app Tria couldn't point at.
///
/// The web has no equivalent and needs none — a browser's permission is
/// re-askable from its own site settings, which the reader already knows how to
/// reach. This is iOS-specific plumbing for an iOS-specific dead end.
///
/// It has to be native. `location.href = 'app-settings:'` does nothing at all
/// from the webview (measured, not assumed — Capacitor's navigation delegate
/// hands off `http(s)` and leaves every other scheme inert), and
/// @capacitor/browser is SFSafariViewController, which takes web URLs only. A
/// `UIApplication.open` is the only thing that reaches Settings, and only native
/// code can make that call.
@objc(TriaSettingsPlugin)
public class TriaSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaSettingsPlugin"
    public let jsName = "TriaSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "musicApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pageHead", returnType: CAPPluginReturnPromise)
    ]

    /// The top of a web page, read so a link in a post can draw its title and
    /// picture (`linkMeta` in app.js parses it). It has to be native: a page in
    /// a web view can't read another site, CORS sees to that, and the app needs
    /// no server of its own this way. See `TriaPageReader` for the limits.
    @objc func pageHead(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              TriaPageReader.allowed(url) else {
            call.reject("That isn't a public web page.")
            return
        }
        Task {
            do { call.resolve(try await TriaPageReader.shared.head(of: url)) }
            catch { call.reject("That page didn't answer.") }
        }
    }

    /// A universal link (triaonline.com/u/…, /p/…, /c/…) that opened the app,
    /// as an `openLink` event for app.js to route. SceneDelegate hands the link
    /// to Capacitor's proxy; this picks it up from there. Retained until a
    /// listener consumes it, because on a cold launch the link arrives before
    /// app.js has booted, and `lastURL` covers a link that came in before this
    /// plugin loaded at all.
    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(linkOpened(_:)),
                                               name: .capacitorOpenUniversalLink, object: nil)
        if let url = ApplicationDelegateProxy.shared.lastURL { sendLink(url) }
    }

    @objc private func linkOpened(_ note: Notification) {
        guard let url = (note.object as? [String: Any])?["url"] as? URL else { return }
        sendLink(url)
    }

    private func sendLink(_ url: URL) {
        notifyListeners("openLink", data: ["url": url.absoluteString], retainUntilConsumed: true)
    }

    /// Resolves once iOS has accepted the hand-off, rejects if it refuses. The
    /// caller in app.js treats a rejection as "say where to go in words
    /// instead", so silence is never an outcome — the reader always learns
    /// something, whether or not Settings actually opened.
    @objc func openSettings(_ call: CAPPluginCall) {
        // `openSettingsURLString` is a plain string constant, so the optional
        // unwrap is a formality; the `canOpenURL` check is not, and neither is
        // the main-queue hop — `UIApplication.shared.open` is main-actor work
        // and a bridge call arrives on Capacitor's own queue.
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.reject("Settings can’t be opened on this device.")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("Settings didn’t open.") }
            }
        }
    }

    /// Hand a web URL to iOS itself, rather than to the in-app browser.
    ///
    /// THIS IS NOT @capacitor/browser, and the difference is the whole reason it
    /// exists. That plugin presents SFSafariViewController, which is right for
    /// READING a page — a linked article, an activity's map pin — and which
    /// deliberately does not follow a universal link into the app that claims
    /// the domain. A song's link claims one: `music.apple.com` belongs to Apple
    /// Music and `open.spotify.com` to Spotify, and handed to UIApplication each
    /// lands IN that app when it's installed and on the web player when it
    /// isn't. Through the in-app sheet it is always the web player, which is the
    /// wrong half of what "open my song" means.
    ///
    /// There is no iOS notion of a default music app to target — unlike the
    /// browser and mail, it isn't a setting and there's no API to ask. The
    /// universal link IS the mechanism: whoever owns the domain gets the tap.
    ///
    /// http(s) ONLY. These URLs reach here from a link a person pasted into the
    /// picker, and `UIApplication.open` will launch any scheme some installed
    /// app has registered. The store already refuses to save anything but https
    /// (see setListeningTo); this is the second of the two checks, on the side
    /// of the bridge where the call actually happens.
    ///
    /// Plus webcal(s), for one caller: the profile's Subscribe to calendar,
    /// whose link Tria builds itself (openCalendarSubscribe). Calendar owns
    /// that scheme, so it is still a hand-off to a system app, not to whatever
    /// an installed app registered.
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              ["https", "http", "webcals", "webcal"].contains(scheme) else {
            call.reject("Only http(s) and calendar links can be handed to iOS.")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("iOS didn’t open that link.") }
            }
        }
    }

    /// Is Spotify on this phone, or YouTube Music? Asked so that nobody has to be.
    ///
    /// A song's link belongs to whoever set it, and search can only find Apple's
    /// copy without a key — so a Spotify listener tapping somebody's song lands
    /// on a page selling them a service they already declined. The web's fix is
    /// to pick the link at the reading end (see songLink in app.js), which needs
    /// to know which end that is.
    ///
    /// iOS will not say which music app is "default" — unlike the browser and
    /// mail, there is no such setting and no API for one. But `canOpenURL` will
    /// say what is INSTALLED, and having gone and installed Spotify is a
    /// stronger signal than a modal interrupting the tap to ask. It needs the
    /// scheme declared in LSApplicationQueriesSchemes; undeclared, it silently
    /// answers false, which is exactly the old behaviour and so fails safe.
    ///
    /// Apple Music is NOT queried, and its absence from the answer is the point:
    /// it ships preinstalled, so its presence tells us nothing about anybody. The
    /// signal is Spotify, YouTube Music, or neither; which one wins when both
    /// are installed is app.js's call (`musicService`). Anyone the guess gets
    /// wrong has the picker on the profile editor.
    ///
    /// `youtubemusic` is the scheme `com.google.ios.youtubemusic` registers, the
    /// bundle its apple-app-site-association names for music.youtube.com.
    @objc func musicApps(_ call: CAPPluginCall) {
        // `canOpenURL` is main-actor work like `open` above, and a bridge call
        // arrives on Capacitor's queue.
        DispatchQueue.main.async {
            let installed = { (scheme: String) -> Bool in
                URL(string: scheme + "://").map { UIApplication.shared.canOpenURL($0) } ?? false
            }
            call.resolve(["spotify": installed("spotify"), "youtube": installed("youtubemusic")])
        }
    }

    /// Which icon is on the home screen: `""` for Tria's own, otherwise the
    /// alternate's name (`TriaAppIcon-<accent key>`, see gen-alt-icons.js).
    @objc func appIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "name": UIApplication.shared.alternateIconName ?? "",
                "supported": UIApplication.shared.supportsAlternateIcons
            ])
        }
    }

    /// Switch the home screen icon. iOS answers with its own alert ("You have
    /// changed the icon for Tria"), which no public API can hold back, so this
    /// is only ever called from a pick the reader made on purpose. `""` puts
    /// Tria's own back.
    @objc func setAppIcon(_ call: CAPPluginCall) {
        let raw = call.getString("name") ?? ""
        let name: String? = raw.isEmpty ? nil : raw
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("This phone can’t change Tria’s icon.")
                return
            }
            if UIApplication.shared.alternateIconName == name { call.resolve(); return }
            UIApplication.shared.setAlternateIconName(name) { error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        }
    }
}

/// Reads as little of a page as a link's tile needs, and every reader's phone
/// runs it, so a hostile link has to cost nothing: no cookies go out, the read
/// stops at `</head>` or a megabyte and gives up inside ten seconds, a page that
/// isn't HTML is never downloaded, and neither a link nor a redirect may reach
/// the phone's own network (that would raise iOS's local network prompt, and
/// point somebody's post at their router). The user agent names the preview bots
/// because that is who sites serve their preview tags to, the same words Apple's
/// LinkPresentation sends.
private final class TriaPageReader: NSObject, URLSessionTaskDelegate {
    static let shared = TriaPageReader()
    private static let limit = 1_000_000

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 10
        config.httpAdditionalHeaders = [
            "User-Agent": "Mozilla/5.0 (compatible; Tria/2.0; +https://triaonline.com) facebookexternalhit/1.1 Facebot Twitterbot/1.0",
            "Accept": "text/html,application/xhtml+xml"
        ]
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    static func allowed(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased(), host.contains("."), !host.contains(":"),
              !host.hasSuffix(".local"), !host.hasSuffix(".localhost") else { return false }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return true }     // a name, not an address
        switch (parts[0], parts[1]) {
        case (0, _), (10, _), (127, _), (169, 254), (192, 168): return false
        case (172, 16...31): return false
        default: return true
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(Self.allowed) == true ? request : nil)
    }

    func head(of url: URL) async throws -> [String: Any] {
        let (bytes, response) = try await session.bytes(from: url)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let answer = (http.url ?? url).absoluteString
        let type = (http.mimeType ?? "").lowercased()
        guard type.contains("html") else { return ["url": answer, "type": type, "html": ""] }

        var data = Data()
        let end = Data("</head>".utf8)
        for try await byte in bytes {
            data.append(byte)
            if data.count >= Self.limit { break }
            if data.count % 8192 == 0, data.range(of: end, in: max(0, data.count - 8200)..<data.count) != nil { break }
        }
        return ["url": answer, "type": type, "html": Self.text(data, named: http.textEncodingName)]
    }

    private static func text(_ data: Data, named charset: String?) -> String {
        if let charset {
            let cf = CFStringConvertIANACharSetNameToEncoding(charset as CFString)
            if cf != kCFStringEncodingInvalidId,
               let text = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))) {
                return text
            }
        }
        return String(decoding: data, as: UTF8.self)
    }
}
