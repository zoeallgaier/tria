import UIKit
import Capacitor

/// Capacitor's own bridge controller with two of its defaults turned back on.
///
/// `CAPBridgeViewController.prepareWebView` hard-sets both of these and exposes
/// no config key for either, so a `capacitor.config.json` entry can't reach
/// them — the only seam is a subclass, which is the whole reason this file
/// exists. `Main.storyboard` names it as the scene's `customClass`; if that ever
/// gets reset to `CAPBridgeViewController`, both features below go silent with
/// nothing in the log to say so.
class TriaViewController: CAPBridgeViewController {

    /// A plugin that lives in the app target rather than in a node module has to
    /// be handed to the bridge by name — Capacitor only auto-discovers the ones
    /// listed in `capacitor.config.json`'s `packageClassList`, which the CLI
    /// generates from `package.json` and would overwrite on the next
    /// `ios-sync.sh`. `capacitorDidLoad` is the documented seam for exactly
    /// this, and it runs before the web view loads, so `TriaSettings` is
    /// callable by the time app.js can ask for it.
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TriaSettingsPlugin())
        // 1.4's native chrome, registered the same way and for the same reason.
        // Note what it costs: `verify-plugins.sh` reads `packageClassList` and
        // so cannot see either of these. A plugin that fails to compile in is
        // the missing-push failure again — no build error, no crash, one line in
        // the device log at the moment somebody taps — except this time the
        // thing that is missing is the app's navigation. That is why app.js
        // treats the CSS chrome as the default and only switches over once this
        // plugin has actually answered; see docs/native-chrome.md.
        bridge?.registerPluginInstance(TriaChromePlugin())
    }

    /// `--bg` from `css/tokens.css`, in the one form CSS can't reach: light
    /// `#edeef0`, dark `#0e1012`. A `UIColor` built from a trait closure
    /// re-resolves itself when the system scheme flips, so this needs no
    /// `traitCollectionDidChange` and can't drift out of step with the
    /// stylesheet's `prefers-color-scheme`. If the token ever changes, change it
    /// here too — these two literals are the copy.
    private static let paper = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.055, green: 0.063, blue: 0.071, alpha: 1)  // #0e1012
            : UIColor(red: 0.929, green: 0.933, blue: 0.941, alpha: 1)  // #edeef0
    }

    override func viewDidLoad() {
        // super creates the web view and applies Capacitor's defaults. Both
        // lines below are corrections to those defaults, so they have to run
        // after it, not before.
        super.viewDidLoad()

        // The rubber band IS Tria's pull-to-refresh. Capacitor sets
        // `bounces = false` to make a wrapped site feel less like a page, but
        // the ptr module in app.js reads the overscroll directly — a negative
        // window.scrollY is the pull, and with the bounce off that reading never
        // arrives, so the five-dot indicator could not appear no matter what the
        // web layer did. `alwaysBounceVertical` matters as much as `bounces`: a
        // short page (an empty feed, a quiet Updates) has nothing to scroll, and
        // without it the gesture is dead on exactly the screens where a refresh
        // is the thing you most want to try.
        webView?.scrollView.bounces = true
        webView?.scrollView.alwaysBounceVertical = true

        // Swipe from the left edge to go back, the way every other iOS app
        // works. Tria's routes are hash changes, which WebKit keeps in the
        // web view's own back-forward list, so the gesture drives `hashchange`
        // and the router picks it up unmodified — no bridge call, no JS gesture
        // handler competing with the scroll.
        webView?.allowsBackForwardNavigationGestures = true

        // What you see UNDER the page when the bounce above turns the rubber
        // band back on. The document's own fill stops at the end of the
        // document, so the overscroll gap is painted by the scroll view, and
        // `prepareWebView` fills it with `UIColor.systemBackground` when the
        // config names no colour — pure #ffffff or pure #000000, neither of
        // which is a colour Tria uses anywhere. So every pull opened a hard
        // white (or black) seam above a page of cool paper, which read as the
        // app coming apart rather than as a gesture. `backgroundColor` in
        // `capacitor.config.json` is a single static hex with no light/dark
        // form, so it can only ever be wrong in one scheme — hence the dynamic
        // colour above, set here rather than there.
        //
        // All three surfaces, because which one shows depends on state the
        // subclass shouldn't have to predict: the scroll view fills the
        // overscroll gap, the web view shows through wherever the document
        // isn't opaque, and the controller's own view is what's on screen
        // before the first paint and during a rotation.
        view.backgroundColor = Self.paper
        webView?.backgroundColor = Self.paper
        webView?.scrollView.backgroundColor = Self.paper
    }
}
