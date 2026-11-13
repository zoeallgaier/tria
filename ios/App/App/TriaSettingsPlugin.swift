import Foundation
import UIKit
import Capacitor
import AVFoundation
import CoreHaptics

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
        CAPPluginMethod(name: "setPaper", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pageHead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playClip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareClip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopClip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "goTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "feel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "navFeel", returnType: CAPPluginReturnNone)
    ]

    /// THE FEEL, Tria's own soft haptics (Zoe, 2026-11-13: "a new softer
    /// haptic almost like the refresh pull along with a soft sparkle haptic
    /// like from posting"). UIKit's impact styles are one knock each; these
    /// are Core Haptics patterns, the refresh swell's low sharpness hum and
    /// the posting twinkle's thinning taps, made quieter. `kind`:
    ///   sparkle: a like. A soft landing, then four taps fading out and
    ///            brightening, in step with the like's stars.
    ///   fly:     a double tap's like. A breath of a tap as the heart pops,
    ///            a hum rising under it while it falls to the like button
    ///            (`at` seconds in, for `ms`), and the sparkle as it lands.
    /// Fire and forget: it resolves at once, and silence is a correct answer
    /// (no haptics hardware, or System Haptics off).
    @objc func feel(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? ""
        let at = call.getDouble("at") ?? 0
        let ms = call.getDouble("ms") ?? 360
        DispatchQueue.main.async { TriaFeel.shared.play(kind, at: at, flight: ms / 1000) }
        call.resolve()
    }

    /// THE FIELD'S FEEL (Zoe, 2026-11-13: "add soft tria-esque haptics for
    /// navigating the circles page"): TriaFeel's softer patterns for moving
    /// round Explore circles. `kind`: wake, rise, settle, catch, stop, fold,
    /// unfold (see `play`). It NEVER ANSWERS: a resolve is a trip back into
    /// the page, `evaluateJavaScript` on the main thread (docs/ios-shell.md,
    /// the reason Tria's haptics are rationed), and these fire mid gesture,
    /// a pinch's patter included, so the call is simply let go. The bridge
    /// keeps no unanswered call that isn't `keepAlive`, and the page sent no
    /// callback to wait on.
    @objc func navFeel(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? ""
        DispatchQueue.main.async { TriaFeel.shared.play(kind, at: 0, flight: 0) }
    }

    /// A route opened BY THE APP, so the back swipe never skips the page
    /// under it (Zoe, 2026-11-08: back from a circle opened off the field went
    /// past Circles). WebKit marks a history entry made by script without a
    /// recent user activation, and a back swipe off a marked entry skips the
    /// one before it too; a drag (the sheet's pull up) is not an activation.
    /// A load the client asks for is never marked (`isRequestFromClientOrUserInput`),
    /// and with only the fragment changed it is the same document's hash
    /// change, so app.js's hashchange routes it as ever.
    @objc func goTo(_ call: CAPPluginCall) {
        let hash = call.getString("hash") ?? ""
        DispatchQueue.main.async {
            guard hash.hasPrefix("#"), let web = self.bridge?.webView, let here = web.url,
                  var parts = URLComponents(url: here, resolvingAgainstBaseURL: false) else {
                call.reject("Couldn't go there.")
                return
            }
            parts.percentEncodedFragment = String(hash.dropFirst())
            guard let there = parts.url else { call.reject("Couldn't go there."); return }
            web.load(URLRequest(url: there))
            call.resolve()
        }
    }

    /// A song's 30 second preview, played HERE and not in the web view (Zoe,
    /// 2026-11-06: "get rid of dynamic island for music and ios player").
    /// iOS makes an app the Now Playing app (the Dynamic Island, the lock
    /// screen's player) when it plays in a NON-MIXABLE category, and WebKit's
    /// `navigator.audioSession.type = 'playback'`, the only web way through the
    /// ringer switch, is exactly that, Web Audio or not. A mixable category can
    /// never be Now Playing, and WebKit's one mixable type, 'ambient', obeys the
    /// switch. So the clip plays through an AVPlayer in `.playback` with
    /// `.mixWithOthers` (through the switch, never Now Playing) and
    /// `.duckOthers` (someone's own music dips under it rather than fighting
    /// it, and comes back as it stops). Nothing here ever touches
    /// MPNowPlayingInfoCenter.
    private var clip: AVPlayer?
    private var clipWatch: NSKeyValueObservation?
    private var clipEnd: NSObjectProtocol?
    private var clipTurn = 0
    /// The play waiting to hear whether its clip started; every path answers it.
    private var clipPending: CAPPluginCall?
    /// The NEXT Moment's preview, loading paused (`prepareClip`), so a tap to
    /// it only has to press play: a fresh player had to fetch from Apple first.
    private var spare: AVPlayer?
    private var spareURL: URL?

    /// `{ url }` loads that preview into the spare player, paused, replacing
    /// whatever was there. One at a time.
    @objc func prepareClip(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.spareURL != url {
                self.spare?.replaceCurrentItem(with: nil)
                let player = AVPlayer(playerItem: AVPlayerItem(url: url))
                player.allowsExternalPlayback = false
                self.spare = player
                self.spareURL = url
            }
            call.resolve()
        }
    }

    /// Resolves `{ duration }` once the clip is really playing; rejects if it
    /// can't be loaded. A later play or stop cuts an earlier one off (it
    /// rejects with "stopped"), and the end of a clip is a `clipEnded` event
    /// carrying the turn it belonged to.
    @objc func playClip(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" else {
            call.reject("That isn't a clip.")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("Couldn't play it."); return }
            // One song to the next keeps the session: handing it back and
            // taking it again cost every tap a beat.
            self.endClip(release: false)
            self.clipTurn += 1
            let turn = self.clipTurn
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
                try session.setActive(true)
            } catch {
                call.reject("Couldn't play it.")
                return
            }
            // The spare, if it was readied for this very preview.
            let player: AVPlayer
            if let spare = self.spare, self.spareURL == url, spare.currentItem != nil {
                player = spare
                self.spare = nil
                self.spareURL = nil
            } else {
                player = AVPlayer(playerItem: AVPlayerItem(url: url))
                player.allowsExternalPlayback = false
            }
            guard let item = player.currentItem else { call.reject("Couldn't play it."); return }
            self.clip = player
            self.clipPending = call
            self.clipWatch = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
                DispatchQueue.main.async {
                    guard let self = self, turn == self.clipTurn, let waiting = self.clipPending else { return }
                    if p.timeControlStatus == .playing {
                        self.clipPending = nil
                        let d = item.duration.seconds
                        waiting.resolve(["duration": d.isFinite ? d : 30, "turn": turn])
                    } else if item.status == .failed {
                        self.endClip()
                    }
                }
            }
            self.clipEnd = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                guard let self = self, turn == self.clipTurn else { return }
                self.endClip()
                self.notifyListeners("clipEnded", data: ["turn": turn])
            }
            // A clip that never starts (no network) is let go of after 12s.
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
                guard let self = self, turn == self.clipTurn, self.clipPending != nil else { return }
                self.endClip()
            }
            player.play()
        }
    }

    @objc func stopClip(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.clipTurn += 1
            self.endClip()
            call.resolve()
        }
    }

    private func endClip(release: Bool = true) {
        if let waiting = clipPending {
            clipPending = nil
            waiting.reject("Couldn't play it.", "STOPPED")
        }
        clipWatch?.invalidate()
        clipWatch = nil
        if let end = clipEnd { NotificationCenter.default.removeObserver(end) }
        clipEnd = nil
        guard let player = clip else { return }
        player.pause()
        player.replaceCurrentItem(with: nil)
        clip = nil
        // Hands the speaker back, so music it ducked comes back up.
        if release { try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    }

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

    /// The page's paper (`stampPaper` in app.js): `lt` and `dk` hexes, or
    /// neither for the neutral. Laid on the surfaces under the web view at
    /// once, so an overscroll or a tab swipe never shows a seam, and kept for
    /// the next launch only when it is the reader's OWN (`keep`): a friend's
    /// profile wears their paper, and the app must not open on it tomorrow.
    @objc func setPaper(_ call: CAPPluginCall) {
        let lt = call.getString("lt") ?? "", dk = call.getString("dk") ?? ""
        let keep = call.getBool("keep") ?? true
        let animated = call.getBool("animated") ?? true   // false under a back swipe's picture
        DispatchQueue.main.async {
            let paper: [String: String]? = lt.isEmpty || dk.isEmpty ? nil : ["lt": lt, "dk": dk]
            TriaViewController.paperHex = paper
            if keep {
                if let paper { UserDefaults.standard.set(paper, forKey: TriaViewController.paperKey) }
                else { UserDefaults.standard.removeObject(forKey: TriaViewController.paperKey) }
            }
            (self.bridge?.viewController as? TriaViewController)?.repaper(animated: animated)
            call.resolve()
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


/// The patterns behind `feel`. One engine, kept, auto shutdown on, so it
/// sleeps between likes; a fresh player per feel (a pattern this short costs
/// nothing to build). Lost on a reset or a stop, and remade on the next feel.
final class TriaFeel {
    static let shared = TriaFeel()
    private var engine: CHHapticEngine?

    private func ready() -> CHHapticEngine? {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return nil }
        if engine == nil, let made = try? CHHapticEngine() {
            made.playsHapticsOnly = true
            made.isAutoShutdownEnabled = true
            made.resetHandler = { [weak self] in DispatchQueue.main.async { self?.engine = nil } }
            made.stoppedHandler = { [weak self] _ in DispatchQueue.main.async { self?.engine = nil } }
            engine = made
        }
        return engine
    }

    private static func tap(_ t: Double, _ intensity: Float, _ sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticTransient, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
        ], relativeTime: t)
    }

    /// A stretch of the refresh pull's hum: low sharpness is what makes it a
    /// swell and not a buzz.
    private static func hum(_ t: Double, _ length: Double, _ intensity: Float, _ sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticContinuous, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
        ], relativeTime: t, duration: length)
    }

    /// An intensity dial over a whole pattern, (seconds, 0 to 1). It turns
    /// down EVERY event under it, so it reads 1 wherever a tap sits.
    private static func dial(_ points: [(Double, Float)]) -> CHHapticParameterCurve {
        CHHapticParameterCurve(parameterID: .hapticIntensityControl,
                               controlPoints: points.map { CHHapticParameterCurve.ControlPoint(relativeTime: $0.0, value: $0.1) },
                               relativeTime: 0)
    }

    /// The like's twinkle: a round landing, then taps that get quieter and
    /// brighter, the way the stars wink out. The posting twinkle's shape
    /// (TWINKLE in app.js) at about half its strength and in half the time.
    /// `settle` is a flown heart going into place (Zoe, 2026-11-13: "softer
    /// when it goes into place, but I like the rhythm"): the same beats, the
    /// landing at 60% and the stars at 70%, so the double tap's pop stays the
    /// loudest thing in the flight.
    private static func sparkle(from t: Double, settle: Bool = false) -> [CHHapticEvent] {
        let land: Float = settle ? 0.6 : 1, stars: Float = settle ? 0.7 : 1
        return [tap(t, 0.52 * land, 0.22),
                tap(t + 0.085, 0.30 * stars, 0.55),
                tap(t + 0.155, 0.22 * stars, 0.68),
                tap(t + 0.245, 0.15 * stars, 0.80),
                tap(t + 0.355, 0.10 * stars, 0.90)]
    }

    func play(_ kind: String, at: Double, flight: Double) {
        guard let engine = ready() else { return }
        var events: [CHHapticEvent] = []
        var curves: [CHHapticParameterCurve] = []
        switch kind {
        case "sparkle":
            events = Self.sparkle(from: 0)
        case "fly":
            let lift = max(0, at), fall = max(0.12, flight)
            // The pop: the like itself, and the flight's strongest beat (Zoe:
            // "stronger on the initial like"). Full and still round.
            events.append(Self.tap(0, 0.8, 0.3))
            // The fall: the refresh pull's hum (sharpness 0.1), rising from
            // a whisper and cresting gently, at the landing's own weight, so
            // the heart arrives soft rather than with a thud.
            events.append(CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.3),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.1)
            ], relativeTime: lift, duration: fall))
            curves.append(CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: [
                .init(relativeTime: lift, value: 0.25),
                .init(relativeTime: lift + fall * 0.55, value: 0.6),
                .init(relativeTime: lift + fall, value: 1)
            ], relativeTime: 0))
            curves.append(CHHapticParameterCurve(parameterID: .hapticSharpnessControl, controlPoints: [
                .init(relativeTime: lift, value: 0),
                .init(relativeTime: lift + fall, value: 0.15)
            ], relativeTime: 0))
            events += Self.sparkle(from: lift + fall, settle: true)

        // THE FIELD'S FEEL (navFeel): moving round Explore circles. Softer
        // than a like, since only what you're looking at changed. The hum's
        // swell is timed to the camera's glide (GLIDE_W in app.js, a
        // critically damped spring at 11 a second: fastest at ~0.09s, all
        // but still by ~0.3s).
        case "wake":
            // A finger landed: up now, so the beat that follows is on time.
            engine.start(completionHandler: nil)
            return
        case "rise":
            // A circle comes up over its sheet, or a double tap zooms in: a
            // round pop as the finger lets go, the hum swelling with the
            // glide and gone as it slows, then a breath of a tick as it
            // lands at its size.
            events = [Self.tap(0, 0.5, 0.12),
                      Self.hum(0.015, 0.265, 0.45, 0.08),
                      Self.tap(0.3, 0.2, 0.5)]
            curves = [Self.dial([(0, 1), (0.02, 0.5), (0.09, 1), (0.28, 0.05), (0.29, 1)])]
        case "settle":
            // Put back, or a double tap zooms out: the same hum with no pop,
            // and a soft landing as the field comes to rest.
            events = [Self.hum(0, 0.26, 0.42, 0.05),
                      Self.tap(0.28, 0.34, 0.08)]
            curves = [Self.dial([(0, 0.6), (0.07, 1), (0.26, 0.05), (0.27, 1)])]
        case "catch":
            // The sheet's pull up arms Open: a soft latch and its echo.
            events = [Self.tap(0, 0.5, 0.45), Self.tap(0.05, 0.16, 0.7)]
        case "stop":
            // A pinch meets either end of the zoom: a cushion, pressed and
            // pushing back. As round as a tap gets.
            events = [Self.tap(0, 0.42, 0.04), Self.tap(0.05, 0.15, 0.04)]
        case "fold":
            // A circle folds to its face under a pinch: one quiet, dull tick.
            events = [Self.tap(0, 0.28, 0.3)]
        case "unfold":
            // And opens again: a touch brighter.
            events = [Self.tap(0, 0.3, 0.5)]
        default:
            return
        }
        do {
            let player = try engine.makePlayer(with: CHHapticPattern(events: events, parameterCurves: curves))
            engine.start { error in
                if let error { print("TriaFeel: engine start failed: \(error)"); return }
                do { try player.start(atTime: CHHapticTimeImmediate) }
                catch { print("TriaFeel: couldn't play: \(error)") }
            }
        } catch {
            print("TriaFeel: no pattern: \(error)")
            self.engine = nil
        }
    }
}
