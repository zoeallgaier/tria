import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    /* The six empty lifecycle stubs Xcode's template ships (willResignActive,
       didEnterBackground, willEnterForeground, didBecomeActive, willTerminate)
       are gone. They did nothing: Capacitor listens for the equivalent
       UIApplication notifications on NotificationCenter rather than through this
       delegate, and Tria's own foreground re-pull runs off the webview's
       visibilitychange. They are also the exact methods UIScene stops calling,
       so deleting them removes the only part of this file that would have
       quietly become dead on adoption. What stays here is what genuinely belongs
       to the APP rather than to a scene: the two APNs forwards below. */

    // APNs hands its answer to the app delegate and nowhere else. The Capacitor
    // push plugin listens on NotificationCenter for these two names, so without
    // these forwards it never learns the device token: `register()` resolves
    // happily, the `registration` event never fires, and push is silently dead —
    // no error, no log, just a switch in the profile that turns on and does
    // nothing. Everything the web gets from `pushManager.subscribe()` arrives
    // through this method instead.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/* ── UIScene ─────────────────────────────────────────────────────────────────
   Adopted because the newer SDKs require it: an app still built on the
   "the app IS its one window" model gets a console warning today and, per that
   warning, will FAIL TO LAUNCH once Apple enforces it. Nothing to do with what
   Tria shows — it is about the app being able to be asked for a second window
   (iPad side-by-side, Stage Manager, the folding phones), even though Tria says
   no to that: UIApplicationSupportsMultipleScenes is false.

   This class is EMPTY ON PURPOSE and that is the safe version, not a stub to
   fill in later. Info.plist's scene configuration names `Main` as the scene's
   storyboard, so UIKit builds the window, instantiates the storyboard's initial
   view controller (TriaViewController) and assigns it to `window` itself. The
   classic way to get a black screen here is to implement
   `scene(_:willConnectTo:)` and not do the window setup UIKit was already doing.
   So: don't add one unless something actually needs it.

   It also lives in AppDelegate.swift rather than in a SceneDelegate.swift of its
   own. The Xcode project lists its source files individually (objectVersion 60,
   no filesystem-synchronized group), so a NEW file has to be registered in
   project.pbxproj by hand — and a Swift file that exists on disk but is missing
   from the target compiles to nothing, which would surface as
   `UISceneDelegateClassName` naming a class that isn't there, i.e. a launch
   failure with no build error. A class in a file already in the target cannot
   fail that way. Swift class names are module-scoped, so
   `$(PRODUCT_MODULE_NAME).SceneDelegate` resolves to App.SceneDelegate wherever
   it is declared.

   What did NOT move: the two APNs forwards above. A device token belongs to the
   APP, not to a window, and UIApplicationDelegate is still where APNs delivers
   it. Both `open url` and `continue userActivity` are dead code either way —
   Tria registers no CFBundleURLTypes and holds no associated-domains
   entitlement, so nothing has ever called them. */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
}
