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
        CAPPluginMethod(name: "musicApps", returnType: CAPPluginReturnPromise)
    ]

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
    /// READING a page — a Find's article, an activity's map pin — and which
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
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else {
            call.reject("Only http(s) links can be handed to iOS.")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("iOS didn’t open that link.") }
            }
        }
    }

    /// Is Spotify on this phone? Asked so that nobody has to be.
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
    /// signal is Spotify or no Spotify. Anyone the guess gets wrong (both
    /// installed, Apple preferred) has the picker on the profile editor.
    @objc func musicApps(_ call: CAPPluginCall) {
        // `canOpenURL` is main-actor work like `open` above, and a bridge call
        // arrives on Capacitor's queue.
        DispatchQueue.main.async {
            let spotify = URL(string: "spotify://").map {
                UIApplication.shared.canOpenURL($0)
            } ?? false
            call.resolve(["spotify": spotify])
        }
    }
}
