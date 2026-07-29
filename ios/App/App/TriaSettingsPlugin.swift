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
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
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
}
