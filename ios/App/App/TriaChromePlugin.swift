import Foundation
import UIKit
import WebKit
import Capacitor
import CoreText
import PhotosUI
import UniformTypeIdentifiers

/// 1.4: Tria's bottom navigation, drawn by UIKit in the system's Liquid Glass.
///
/// The plan, the contract and the traps are in `docs/native-chrome.md`. The
/// short version, because it governs every line below:
///
/// **NATIVE IS A RENDERER, NOT A SECOND MODEL.** `js/app.js` remains the single
/// source of truth for what page you are on. This file is told; it never
/// decides. It knows four routes as opaque strings and hands one back when a
/// finger lands on it — it does not know what a Circle is, what Discover
/// filters, or that Updates could ever carry a COUNT — `setDots` puts a mark on
/// a destination and the mark has no number in it, which is the difference
/// between saying something happened and keeping score. Two things disagreeing
/// about where the reader is, one holding the history and the other holding the
/// highlighted tab, is the bug that rule exists to make impossible.
///
/// **The web keeps its CSS chrome and it is the default.** `data-chrome` starts
/// unset in app.js; only a resolved `setTabs` sets it. So a build where this
/// file failed to compile in — which `verify-plugins.sh` CANNOT catch, since
/// that script reads `packageClassList` and app-target plugins aren't in it —
/// or a phone below iOS 26 lands on an app that navigates exactly as 1.3 did.
/// That fallback is the whole safety net, not defensive tidiness.
///
/// **iOS 26 or nothing.** Liquid Glass is refraction plus a specular response
/// plus the system's own morph animations, and `UIGlassEffect` is the only way
/// to ask for it. Below 26 there is no half-native version worth maintaining: a
/// second chrome design, verified separately, to replace a CSS bar that is
/// already good. So `setTabs` rejects on 25 and earlier and the CSS bar stays.
/// `IPHONEOS_DEPLOYMENT_TARGET` is untouched at 15.0 — a runtime gate, never a
/// deployment bump that drops readers.
@objc(TriaChromePlugin)
public class TriaChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaChromePlugin"
    public let jsName = "TriaChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setTabs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDots", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setChrome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToolbar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "menuReady", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPostBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPostBarText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGlow", returnType: CAPPluginReturnPromise)
    ]

    /// Built on the first `setTabs` and kept for the life of the app. Nil until
    /// then, and nil forever on an OS that can't draw the material.
    ///
    /// Held as the protocol rather than as `TriaChromeBar`, because that type is
    /// `@available(iOS 26.0, *)` and a stored property cannot be — naming it
    /// here would make the whole plugin unavailable below 26, which is exactly
    /// the version that has to be able to load this class and reject politely.
    private var bar: TriaChromeControl?

    /// The invisible host a page control's menu hangs off, built on the first
    /// `presentMenu`. Same availability dance as the two above.
    private var anchored: TriaAnchoredControl?

    /// The token the next `presentMenu` will answer under. A pick carries it
    /// back, so a row tapped in a menu the page has already replaced — a card
    /// re-rendered by a refresh under an open ••• — is dropped rather than run
    /// against the wrong post.
    private var anchorToken = 0
    /// The comment bar's photo picker while it is up. PHPicker holds its
    /// delegate weakly, so this is what keeps the delegate alive until the pick.
    private var photoPicker: TriaPhotoPicker?

    /// The top bar's controls, built on the first `setToolbar`. Held as its own
    /// availability-free protocol for the same reason `bar` is.
    private var toolbar: TriaToolbarControl?

    /// A post page's comment bar, built the first time one is mounted. Same
    /// availability dance again.
    private var postBar: TriaPostBarControl?

    /// The refresh glow round the screen's edge, built on the first `setGlow`.
    /// No availability dance: it is a gradient and two strokes, nothing 26 only,
    /// so it answers on every OS the app installs on.
    private var glow: TriaEdgeGlow?

    /// The last keyboard reach handed to the web, so a notification that changes
    /// nothing costs a compare. -1 until the first one, which is what makes the
    /// very first `0` a real message rather than a no-op.
    private var toldKeyboard: CGFloat = -1

    /* HOW FAR THE KEYBOARD REACHES INTO THE PAGE — the one piece of geometry the
       web view genuinely cannot see for itself in this shell, and an
       accessibility fix rather than a chrome one.

       A keyboard covers the bottom third of the screen and the page underneath
       does not shrink: the layout viewport is the same height either way, so the
       last screenful of every route is not scrollable to while one is up. Off
       the app, `visualViewport` at least SAYS so and app.js does the arithmetic
       (see trackKeyboard). Here it says nothing at all — the fields that raise
       this keyboard are native (`TriaPostBar`, `TriaSearchField`), the keyboard
       is positioned against the window rather than against the web view, and
       WebKit is never told any of it happened. So a reader tapped the comment
       bar and the thread they were answering went behind the keys with no way to
       bring it back.

       ONE OBSERVER, ON THE PLUGIN, not on the bars. Every keyboard in the app is
       the same fact about the page, whoever raised it — our comment bar, our
       find bar, Discover's search capsule, or a web field in the composer — and
       the page's answer to all four is the same reserve. Putting it on the bar
       would have meant two copies of it and would have missed the other two.

       WHAT IS REPORTED is the reach BEYOND the safe area, because the foot of
       every page already reserves that: the home indicator's strip is under the
       keys and has nothing left to be kept clear of. An undocked or floating
       keyboard stands on nothing and reports zero, which is correct — it isn't
       covering the page, and the reader can move it. */
    override public func load() {
        let centre = NotificationCenter.default
        centre.addObserver(self, selector: #selector(keyboardMoved),
                           name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        centre.addObserver(self, selector: #selector(keyboardMoved),
                           name: UIResponder.keyboardWillShowNotification, object: nil)
        centre.addObserver(self, selector: #selector(keyboardGone),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardMoved(_ note: Notification) {
        guard let web = bridge?.webView,
              let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?
                  .cgRectValue
        else { return }
        // The notification carries a SCREEN rect. Converting it into the web
        // view's own coordinates is what keeps this honest on an iPad, in a
        // split view, and under a floating keyboard — anywhere the keys do not
        // simply span the bottom of the window.
        let frame = web.convert(end, from: web.window)
        let over = max(0, web.bounds.maxY - frame.minY)
        send(keyboard: max(0, over - web.safeAreaInsets.bottom))
    }

    @objc private func keyboardGone() { send(keyboard: 0) }

    private func send(keyboard inset: CGFloat) {
        guard abs(inset - toldKeyboard) > 0.5 else { return }
        toldKeyboard = inset
        notifyListeners("keyboardInset", data: ["inset": inset])
    }

    /// Mounts the bars (first call) or restates them (later ones — the FAB's
    /// band changes when the reader picks a colour). Resolves with the geometry
    /// the web has to reserve; rejects, loudly and harmlessly, on anything that
    /// means "keep the CSS chrome".
    ///
    /// `tabs` is `[{route, label, icon}]` and `fab` is `{route, label, glyph,
    /// colors, tint, tabTint, ink}` — `tint` is the +'s own band and `tabTint`
    /// is the lit tab's, which are the same colour only when the reader picked
    /// one; see `tabTint`. `icon` and `glyph` are SVG MARKUP — the same drawing the
    /// web nav puts in the DOM, rendered here by `TriaSVG`. Markup is
    /// presentation, which is the only kind of app vocabulary allowed across
    /// this bridge: it still cannot name a single thing the app is about.
    @objc func setTabs(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Liquid Glass needs iOS 26; the web chrome stays.")
            return
        }
        let tabs = (call.getArray("tabs") as? [[String: Any]]) ?? []
        guard !tabs.isEmpty else {
            call.reject("setTabs was handed no destinations.")
            return
        }
        let fab = call.getObject("fab")

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let hostController = self.bridge?.viewController,
                  let host = hostController.view else {
                call.reject("No view controller to hang the chrome on.")
                return
            }
            let bar: TriaChromeBar
            if let existing = self.bar as? TriaChromeBar {
                bar = existing
            } else {
                bar = TriaChromeBar()
                // Weak self in the two callbacks: the bar outlives nothing, but
                // it is retained by the view hierarchy and the plugin is
                // retained by the bridge, so a strong pair here is a cycle.
                bar.onTap = { [weak self] route in
                    self?.notifyListeners("chromeTap", data: ["route": route])
                }
                bar.onMetrics = { [weak self] bottom in
                    self?.notifyListeners("chromeMetrics", data: ["bottom": bottom])
                }
                // The controller, not its view: the tab bar is a child
                // UITabBarController now, and the web view's scroll view is
                // what it folds on. See TriaChromeBar.
                bar.install(in: hostController, scroller: self.bridge?.webView?.scrollView)
                self.bar = bar
            }
            bar.apply(tabs: tabs, fab: fab)
            // Laid out before measuring: the constraints were only just added on
            // a first call, and a measurement taken before they resolve is the
            // bar's height read as zero — which the web would reserve, putting
            // the last card of every feed under the glass.
            host.layoutIfNeeded()
            call.resolve(["bottom": bar.reservedBottom()])
        }
    }

    /// Which destination is lit. The router calls this on every route change,
    /// including the ones that light nothing (a friend's profile), which arrive
    /// as a route no tab matches — that is a legitimate state, not an error.
    @objc func selectTab(_ call: CAPPluginCall) {
        let route = call.getString("route") ?? ""
        DispatchQueue.main.async { [weak self] in
            self?.bar?.select(route: route)
            call.resolve()
        }
    }

    /// The FAB's band, restated when the reader's accent changes. Same shape as
    /// `setTabs`' `fab` argument, on its own, so a colour pick doesn't have to
    /// rebuild the tab row to repaint one disc — and retints whichever tab is
    /// lit, since it wears the same band as the +.
    @objc func setFab(_ call: CAPPluginCall) {
        let fab = call.getObject("fab")
        DispatchQueue.main.async { [weak self] in
            self?.bar?.apply(tabs: nil, fab: fab)
            call.resolve()
        }
    }

    /// A DOT ON A DESTINATION, which is the only thing this bar ever says that
    /// is not about where the reader is.
    ///
    /// `{ dots: { "<route>": "<colour>" } }`, and an EMPTY colour is "no dot" —
    /// one call carrying both the news and the ink, because two payloads can
    /// arrive a frame apart and on the one mark whose whole job is to appear
    /// that reads as a flicker rather than as news. The colour is resolved over
    /// there like every other paint that crosses here; this file is handed a
    /// number and has no idea what it means, which is the same contract
    /// `setTabs` keeps with a glyph.
    ///
    /// Routes not named are left exactly as they were, so a caller may speak
    /// about one destination without restating the row.
    @objc func setDots(_ call: CAPPluginCall) {
        var dots: [String: String] = [:]
        for (route, value) in call.getObject("dots") ?? [:] {
            dots[route] = (value as? String) ?? ""
        }
        DispatchQueue.main.async { [weak self] in
            self?.bar?.setDots(dots)
            call.resolve()
        }
    }

    /// `visible` takes the whole chrome off the screen — the post page, where
    /// the bottom of the screen belongs to the comment bar, exactly as
    /// `body.postbar-live` does on the web. `fab` alone tucks the + away, which
    /// is the composer, where it would fight the form's own publish button.
    @objc func setChrome(_ call: CAPPluginCall) {
        // Defaulted rather than optional: an absent key means "up", which is the
        // state every page but two is in.
        let visible = call.getBool("visible", true)
        let fabVisible = call.getBool("fab", true)
        DispatchQueue.main.async { [weak self] in
            self?.bar?.setVisibility(chrome: visible, fab: fabVisible)
            call.resolve()
        }
    }

    /// The TOP bar's controls: the leading chevron and the trailing actions,
    /// stated whole on every change.
    ///
    /// It carries no layout of its own. app.js measures the CSS bar it is
    /// standing in for and sends each control's RECT along with it, the same way
    /// it sends resolved colours rather than token names — a CSS pixel is a
    /// point and the web view fills the host, so a rect crosses this bridge
    /// unconverted. That is what keeps a breakpoint, a rotation, a font landing
    /// late and a pill that got narrower at 360px from each needing a Swift copy
    /// of a stylesheet rule to chase them.
    ///
    /// `bar` is `{live, holdHeader, height, title, search, controls: [...]}`;
    /// each control
    /// is `{id, kind, x, y, w, h, glyph, ink, tint, text, after, hidden,
    /// menu, label}`. `id` is the web element's own id and it is opaque here —
    /// it goes back out on a tap and app.js decides what it meant.
    @objc func setToolbar(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Liquid Glass needs iOS 26; the web toolbar stays.")
            return
        }
        let spec = call.getObject("bar") ?? [:]
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view controller to hang the toolbar on.")
                return
            }
            let toolbar: TriaToolbar
            if let existing = self.toolbar as? TriaToolbar {
                toolbar = existing
            } else {
                toolbar = TriaToolbar()
                toolbar.onTap = { [weak self] id in
                    self?.notifyListeners("toolbarTap", data: ["id": id])
                }
                // A menu button asking for its rows. The token comes back with
                // `menuReady`; see the deferred-element note on TriaToolbar.
                toolbar.onMenu = { [weak self] id, token in
                    self?.notifyListeners("toolbarMenu", data: ["id": id, "token": token])
                }
                toolbar.onPick = { [weak self] id, index in
                    self?.notifyListeners("toolbarPick", data: ["id": id, "index": index])
                }
                // Discover's search capsule: a keystroke, the X, and a caret put
                // down without the X. Each one is handed to the web half that
                // already owns it — the input, `closeSearch`, `foldIfEmpty` —
                // and none of them is decided here.
                toolbar.onSearchText = { [weak self] text in
                    self?.notifyListeners("searchText", data: ["text": text])
                }
                toolbar.onSearchClose = { [weak self] in
                    self?.notifyListeners("searchClose", data: [:])
                }
                toolbar.onSearchBlur = { [weak self] in
                    self?.notifyListeners("searchBlur", data: [:])
                }
                toolbar.install(in: host, scroller: self.bridge?.webView?.scrollView)
                self.toolbar = toolbar
            }
            toolbar.apply(spec: spec)
            call.resolve()
        }
    }

    /// A menu dropped by a control on the PAGE, rather than by one in the top
    /// bar: the post card's •••, the repost circle, the profile's colour picker.
    ///
    /// `rect` is the web button's own `getBoundingClientRect`, unconverted — a
    /// CSS pixel is a point and the web view fills the host view, the same
    /// contract every toolbar control crosses on. `items` is the list the page
    /// just built, in the shape `menuReady` takes, because it is the same menu
    /// drawn by the same builder. Resolves with the token a pick will carry.
    @objc func presentMenu(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Liquid Glass needs iOS 26; the web sheet stays.")
            return
        }
        let spec = call.getObject("rect") ?? [:]
        let rect = CGRect(x: TriaToolbar.number(spec["x"]), y: TriaToolbar.number(spec["y"]),
                          width: TriaToolbar.number(spec["w"]),
                          height: TriaToolbar.number(spec["h"]))
        let label = call.getString("label") ?? ""
        let items = (call.getArray("items") as? [[String: Any]]) ?? []
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view controller to hang the menu on.")
                return
            }
            let menu: TriaAnchoredMenu
            if let existing = self.anchored as? TriaAnchoredMenu {
                menu = existing
            } else {
                menu = TriaAnchoredMenu()
                menu.onPick = { [weak self] token, index in
                    self?.notifyListeners("menuPick", data: ["token": token, "index": index])
                }
                menu.install(in: host)
                self.anchored = menu
            }
            self.anchorToken += 1
            menu.present(token: self.anchorToken, rect: rect, label: label, items: items)
            call.resolve(["token": self.anchorToken])
        }
    }

    /// Put an anchored menu away because the card it hangs off has moved. The
    /// web watches its own anchor (it is the only side that can) and calls this
    /// the moment the rect it sent stops being true; see `TriaAnchoredMenu.dismiss`.
    @objc func dismissMenu(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.anchored?.dismiss()
            call.resolve()
        }
    }

    /// The comment bar's photo button, asked for by the web after it has checked
    /// the button is live. Straight to the system photo picker, with no menu in
    /// front of it: a hidden `<input type="file">` makes WebKit drop its own
    /// Photo Library / Take Photo / Choose File menu, anchored to the web bar
    /// native has hidden, so it grew out of the wrong place in the wrong shape.
    /// PHPicker also needs no library permission. Resolves `{data, type}` (base64
    /// bytes), `{error}`, or `{}` for a cancel; the checks and the tray stay the
    /// web's (`readCommentPhoto`).
    @objc func pickPhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let root = self.bridge?.viewController else {
                call.reject("No view controller to present the picker from.")
                return
            }
            var top: UIViewController = root
            while let shown = top.presentedViewController { top = shown }
            let picker = TriaPhotoPicker { [weak self] result in
                call.resolve(result)
                DispatchQueue.main.async { self?.photoPicker = nil }
            }
            self.photoPicker = picker
            picker.present(from: top)
        }
    }

    /// A post page's comment bar: the avatar, the field the reader types into and
    /// the send disc, in glass, riding the system keyboard.
    ///
    /// `live: false` is a navigation away from a post — the bar goes and, more
    /// importantly, the keyboard goes with it. Everything else in the spec is the
    /// geometry and the colour app.js measured off `.postbar-form`, which is
    /// still in the DOM (hidden) and is still the model this renders. See
    /// `TriaPostBar`.
    @objc func setPostBar(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Liquid Glass needs iOS 26; the web comment bar stays.")
            return
        }
        let spec = call.getObject("bar") ?? [:]
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view controller to hang the comment bar on.")
                return
            }
            let bar: TriaPostBar
            if let existing = self.postBar as? TriaPostBar {
                bar = existing
            } else {
                bar = TriaPostBar()
                bar.onText = { [weak self] text, caret in
                    self?.notifyListeners("postBarText", data: ["text": text, "selection": caret])
                }
                bar.onSend = { [weak self] in
                    self?.notifyListeners("postBarSend", data: [:])
                }
                bar.onFocus = { [weak self] focused in
                    self?.notifyListeners("postBarFocus", data: ["focused": focused])
                }
                bar.onLift = { [weak self] lift in
                    self?.notifyListeners("postBarLift", data: ["lift": lift])
                }
                bar.onDiscard = { [weak self] in
                    self?.notifyListeners("postBarDiscard", data: [:])
                }
                bar.onPick = { [weak self] in
                    self?.notifyListeners("postBarPick", data: [:])
                }
                // The web view's scroller, which is where the two ways down off
                // the keyboard hang. Optional: without it the bar still works,
                // it just loses tap-away and drag-away — the face is the third
                // way out and it is inside the pill.
                bar.install(in: host, scroller: self.bridge?.webView?.scrollView)
                self.postBar = bar
            }
            bar.apply(spec: spec)
            call.resolve()
        }
    }

    /// The web writing back into a field it does not draw: a friend picked out of
    /// the mention popover, or the form emptying itself once the comment posted.
    @objc func setPostBarText(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let selection = call.getInt("selection") ?? text.count
        let focus = call.getBool("focus", false)
        DispatchQueue.main.async { [weak self] in
            self?.postBar?.setText(text, selection: selection, focus: focus)
            call.resolve()
        }
    }

    /// The rows for a menu the system is already presenting. See `onMenu`.
    @objc func menuReady(_ call: CAPPluginCall) {
        let token = call.getInt("token") ?? -1
        let items = (call.getArray("items") as? [[String: Any]]) ?? []
        DispatchQueue.main.async { [weak self] in
            self?.toolbar?.fulfil(token: token, items: items)
            call.resolve()
        }
    }

    /// The refresh glow (2.0). `state` is `pull`, `spin` or `idle`; `quiet`
    /// dims a spin nobody's finger started, `land` closes a pulled refresh with
    /// a soft tap. The FIRST call is also the probe: app.js keeps the CSS ring
    /// until one resolves, so a binary without this method still refreshes.
    @objc func setGlow(_ call: CAPPluginCall) {
        let state = call.getString("state") ?? "idle"
        let quiet = call.getBool("quiet") ?? false
        let land = call.getBool("land") ?? false
        // Read through the bar's one colour parser. Below 26 that class doesn't
        // exist, and the glow simply keeps Tria's own ramp.
        var colors: [UIColor] = []
        if #available(iOS 26.0, *) {
            colors = ((call.getArray("colors") as? [String]) ?? [])
                .compactMap { TriaChromeBar.color(fromHex: $0) }
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let web = self.bridge?.webView, let window = web.window else {
                call.reject("No window to glow in yet.")
                return
            }
            if self.glow == nil { self.glow = TriaEdgeGlow(scroll: web.scrollView) }
            // The tips stop at the status bar's foot (Zoe: the status bar, not the header).
            let foot: CGFloat? = window.safeAreaInsets.top > 0 ? window.safeAreaInsets.top : nil
            self.glow?.set(state: state, colors: colors, depth: foot, quiet: quiet, land: land, in: window)
            call.resolve()
        }
    }
}

/// What the plugin is allowed to say to the bar.
///
/// It exists for one reason: it carries no availability annotation, so the
/// plugin can hold a reference to a control it can only *build* on iOS 26. See
/// the note on `bar` above.
protocol TriaChromeControl: AnyObject {
    func apply(tabs: [[String: Any]]?, fab: [String: Any]?)
    func select(route: String)
    func setDots(_ map: [String: String])
    func setVisibility(chrome: Bool, fab: Bool)
    func reservedBottom() -> CGFloat
}

// MARK: - The bar

/* THE RAMP, UNDER THE GLASS RATHER THAN ON IT. This is the third answer to
   "the + cannot carry the four brand stops", and the first that keeps all four.

   The first was a gradient laid over regular glass in the contentView: an
   opaque-ish layer hides the material entirely, so what you get is a slightly
   see-through disc with page text ghosting through it — the CSS failure mode
   wearing the native button's clothes. The second was
   `UIGlassEffect.tintColor`, which is ONE colour, so the disc took the middle
   stop and the travel across it was simply lost.

   THE THIRD WAS MULTIPLY, AND IT DOES NOT WORK, which is worth writing down
   because it is the obvious idea and it fails silently. `compositingFilter =
   "multiplyBlendMode"` on a layer inside `fab.contentView` renders NOTHING: a
   UIVisualEffectView composites its contentView as an isolated group, so the
   blend has no backdrop to multiply against and multiplying against nothing is
   nothing. Not a CALayer-is-macOS-only problem (the filter names do composite
   on iOS) — an isolation problem, and no ordering inside the effect view fixes
   it. Over `.clear` glass the same layer was invisible too, and the disc simply
   went dark wherever the photograph behind it was dark, which is the reason
   clear glass is wrong for this control anyway: the + is up on every route over
   a scrolling feed and cannot take its colour from what happens to be under it.

   So the ramp goes where a real backdrop is: a sibling BELOW the glass, exactly
   the button's size and shape. The material then samples, displaces and frosts
   it the way it samples anything else, which is what tinted glass physically
   is, and the four stops survive because nothing is reducing them to a colour.
   The system draws the tinting; we only supply something to tint.

   IT IS ALWAYS A CAPSULE, because every button that wears the band is one.
   There was a round version of this for the + , with the gradient's endpoints
   pulled inside the circle so the disc carried all four stops and a radial mask
   feathering the rim so the press deformation had no hard edge to slide off.
   Both were right and the button was still worse than plain glass: a 56pt disc
   has nowhere for a four-hue sweep to go. The + declines Tria's band now and
   takes an accent as a tint like everything else, so the whole round path is
   out. See `fabSpec` in app.js, and native-chrome.md for what it cost.

   AND THE RAMP IS THINNED, which is the last thing this took to actually read
   as glass. Painted opaque it is a wall: the material samples it, finds nothing
   else behind it, and has nothing to refract or displace — so the disc came out
   a flat colour with a specular rim drawn round it, tinted glass with the tint
   doing all the work and the glass doing none. It is the CSS failure mode
   again, arriving from the opposite side. Thinned, the page is behind the
   colour and the system has something to bend. `TriaBand.rampAlpha` is that
   number for every glass button and the note there says why it is not
   `--pill-alpha`.

   AND IT IS ONLY FOR THE POLYCHROME BAND NOW. This view used to draw every
   band the app has; a reader's accent is one colour and goes to the material's
   own `tintColor` instead, which is the system tinting itself. See `TriaBand`.
   The one caller that still paints an accent through here is the comment bar's
   send disc, which is deliberately not glass and takes `--pill-alpha` from the
   web the way the CSS button does.

   WHY layerClass AND NOT A SUBLAYER: a CAGradientLayer added as a sublayer
   needs its frame set by hand on every layout, and this view sits in a bar that
   resizes on rotation and on the keyboard. Being the layer means Auto Layout
   does it. */
@available(iOS 26.0, *)
final class TriaBandRamp: UIView {
    override class var layerClass: AnyClass { CAGradientLayer.self }
    private var ramp: CAGradientLayer { layer as! CAGradientLayer }

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        isUserInteractionEnabled = false
        // --brand-band is 115deg, measured CSS-style: clockwise from "to top".
        // That resolves to (sin 115, -cos 115) = (0.906, 0.423) in screen
        // coordinates, i.e. rightward and DOWN. Both points sit outside the
        // stops' own span, so the two ends of the band land on the two flat
        // ends of the capsule and all four hues are on the button. Same travel
        // as the web's, not a fresh guess.
        ramp.startPoint = CGPoint(x: 0.05, y: 0.28)
        ramp.endPoint = CGPoint(x: 0.95, y: 0.72)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func paint(_ stops: [UIColor], alpha: CGFloat) {
        // A single stop still has to be a two-entry array or CAGradientLayer
        // draws nothing at all, which is the silent failure a reader's
        // monochrome band would otherwise hit.
        let pair = stops.count == 1 ? [stops[0], stops[0]] : stops
        // Clamped rather than trusted: this number crossed the bridge, and an
        // alpha of 0 is a band nobody can see, on every route.
        let a = min(max(alpha, 0.05), 1)
        ramp.colors = pair.map { $0.withAlphaComponent(a).cgColor }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.height / 2
        layer.masksToBounds = true
    }
}

/* THE BAND, SORTED INTO THE ONE FORM THE MATERIAL CAN WEAR IT IN.

   app.js decides which of three things a band is and sends it as a shape
   rather than as a name (see `bandFill` there); this is the whole of what the
   three glass families do with the answer.

   - `tint` — one colour, which is a reader's accent. It goes to the GLASS
     ITSELF. `UIGlassEffect.tintColor` is the system tinting its own material:
     refraction, specular response, Reduce Transparency and Increase Contrast
     all arrive already answered, and nothing of the band is lost because the
     band was one colour to begin with.
   - `colors` — four hues, which is Tria's own ramp, and no single colour
     states it. So it stays a gradient UNDER the material (`TriaBandRamp`),
     thinned to `rampAlpha` so the glass still has the page behind it to bend.
   - neither — "no colour". Plain glass, and the ink comes back as `.label`
     because app.js sends none.

   WHAT WENT AWAY HERE was `TriaBandRim`: the same stops put back ABOVE the
   glass at full strength, on the argument that the material mutes what it
   samples. It does, and the lining was still the wrong answer — a colour drawn
   over Liquid Glass sits above the specular layer the material draws last, so
   the button stopped being glass with a colour and became a sticker with a
   rainbow outline. The muting is answered instead by not handing the material
   four hues when the band only has one; the one case that still has four is
   the one case a wash is right for. */
@available(iOS 26.0, *)
enum TriaBand {

    /* HOW THIN THE RAMP SITS UNDER THE MATERIAL, and it is deliberately not
       `--pill-alpha`. That token is a CONTRAST FLOOR for a fill the web paints
       against the page; there is no painted fill here, the material supplies
       the contrast and the system answers the accessibility settings itself.
       What this number decides is how much page the glass has left to bend —
       opaque was a wall (a flat coloured disc with a specular rim round it),
       and it is the knob to turn if the ramp reads as paint again.

       IT IS THINNER ON DARK PAPER, and that is a contrast decision rather than
       a taste one. The band arrives undeepened in dark mode (on ink paper the
       pastels ARE their own -ink twins; see tokens.css) and the material
       darkens what it samples, so at 0.55 it measured 0.155 to 0.207 relative
       luminance — a mid-tone, the one place on this bridge where neither ink
       clears 4.5:1. app.js answers the ink half by sending none, so the label
       is `.label` and goes white here; this is the other half, which takes the
       fill far enough down that white has somewhere to be read against. On
       paper the same band composites over near-white and stays at 0.49 to 0.73
       whatever this number is, so nothing there needs to move.

       Both figures were measured on the + , which was the roundest and the
       hardest case and no longer wears the band at all. What they govern now is
       the capsules that do: the composer's Share pill, the gate's submit, Share
       Tria, Add yours and the toolbar's CTA — same material, same thinning,
       and three of those five have TEXT for a face, which is the 4.5 above.

       A reader's ACCENT is untouched by this: it never comes through the ramp,
       it tints the material, and the system draws a tint light in both schemes
       (0.64 in dark, measured on lime) — which is why the accent keeps the
       near-black ink that would be wrong here. */
    static func rampAlpha(_ style: UIUserInterfaceStyle) -> CGFloat {
        style == .dark ? 0.42 : 0.55
    }

    /// Put a band on a glass view. Returns whether the ramp is drawing, which
    /// the callers that MOVE their ramp need — it is a sibling below the glass,
    /// not a child of it, so nothing that moves the button moves it too.
    ///
    /// The ramp is OPTIONAL because the + has none: it declines the only band a
    /// ramp is ever drawn for (see `fabSpec` in app.js), so a caller with
    /// nothing to draw one on passes nothing and gets `false` back.
    @discardableResult
    static func apply(_ spec: [String: Any],
                      glass: UIVisualEffectView,
                      ramp: TriaBandRamp? = nil) -> Bool {
        let stops = (spec["colors"] as? [String] ?? [])
            .compactMap(TriaChromeBar.color(fromHex:))
        let tint = TriaChromeBar.color(fromHex: spec["tint"] as? String ?? "")

        /* REASSIGNED, NEVER MUTATED. A UIVisualEffectView caches the effect it
           was handed, so `(glass.effect as? UIGlassEffect)?.tintColor = …`
           reaches the object and not the material: the button would hold
           whatever colour it was built with for the rest of the session and a
           colour pick would look like it did nothing. */
        let effect = UIGlassEffect(style: .regular)
        // The system's own press response, which is why no caller adds a scale
        // of its own — and why there is no haptic beside one either.
        effect.isInteractive = true
        if let tint { effect.tintColor = tint }
        glass.effect = effect

        let wantsRamp = tint == nil && !stops.isEmpty && ramp != nil
        ramp?.isHidden = !wantsRamp
        if wantsRamp {
            // A commit on the bar sends its own `wash` (THE BUTTON, 2.0: the
            // band thin under glass in the system's ink, as in a page); the
            // older ramp alphas are the fallback for a spec without one.
            let wash = TriaToolbar.number(spec["wash"], fallback: 0)
            ramp?.paint(stops, alpha: wash > 0 ? wash
                        : rampAlpha(glass.traitCollection.userInterfaceStyle))
        }
        return wantsRamp
    }
}

/// 1.8: THE FOUR DESTINATIONS IN A REAL `UITabBar`, inside a real
/// `UITabBarController`, which is where every tab bar behaviour the system
/// ships actually lives: the Liquid Glass capsule, the lens that slides to the
/// tab you pressed (and follows a finger dragged along the bar), Dynamic Type,
/// the accessibility tree, and `tabBarMinimizeBehavior`, which folds the bar to
/// one glass bubble while you read DOWN and opens it again on the way back up.
///
/// This reverses the paragraph that used to stand here. It said Tria's bar was
/// not a tab bar — a detached capsule of four icons with a round + breaking out
/// beside it — so adopting `UITabBar` would mean adopting a different design.
/// That was right, and 1.8 is the different design: the + went up to My
/// Circle's top bar beside Updates, which left four destinations and nothing
/// else, and four destinations is exactly what a `UITabBar` is for. A hand-built
/// copy of one now would be the thing 1.4 existed to stop doing.
///
/// THE CONTROLLER DOES NOT OWN THE PAGE. Capacitor's bridge controller owns the
/// web view and stays the window's root; this controller is its CHILD, and
/// every one of its four tabs is an empty, clear, untouchable page. The web view
/// is never moved into a tab. So the controller is a renderer of a bar and
/// nothing more, which is the contract every other native piece keeps: app.js
/// holds the route, a tap goes out as `chromeTap`, and the highlight comes back
/// in through `select`. `TriaTabShell` is what makes that physically true —
/// the controller's view spans the screen, and the shell hands every touch that
/// is not on the bar itself through to the web view underneath.
///
/// `fab` still arrives with `setTabs` and `setFab`, and only `tabTint` is read
/// from it now: there is no + down here to paint.
@available(iOS 26.0, *)
final class TriaChromeBar: NSObject, TriaChromeControl, UITabBarControllerDelegate {

    private enum Metric {
        /// A tab bar item's drawing. The system lays the capsule out around it;
        /// 26 is the size the icon-and-title idiom is drawn at, and the web's
        /// 28px nav glyph had no title under it to make room for.
        static let icon: CGFloat = 26
        /// Past the top of the bar, what the last card of a feed keeps clear.
        static let clearance: CGFloat = 8
    }

    /// A destination tapped, or the one you are on tapped again — app.js tells
    /// the two apart, the same way it does for the CSS nav.
    var onTap: ((String) -> Void)?
    /// The height the web has to reserve at the foot of every page.
    var onMetrics: ((CGFloat) -> Void)?

    private let controller = UITabBarController()
    private let shell = TriaTabShell()
    private var routes: [String] = []
    private var currentRoute = ""
    private var tabTint: UIColor?
    private var dots: [String: UIColor] = [:]
    private var wantsChrome = true
    private var keyboardUp = false
    private var lastReportedBottom: CGFloat = -1
    private weak var scroller: UIScrollView?

    override init() {
        super.init()
        controller.delegate = self
        /* THE BAR FOLDS WHILE YOU READ DOWN. The system's own gesture, and the
           reason this is a controller rather than a bare `UITabBar` in a view:
           minimising is the controller's behaviour, read off the content scroll
           view of the selected tab, which is handed the web view's scroll view
           as each page is made in `apply` below. Nothing here watches the scroll. */
        controller.tabBarMinimizeBehavior = .onScrollDown
        controller.view.backgroundColor = .clear
        // Ink for the lit tab. The system's default is its blue, which is not a
        // colour Tria wears anywhere; `.label` is black on paper and white on
        // ink, and a reader's accent replaces it in `apply`.
        controller.tabBar.tintColor = .label
        shell.tabBar = controller.tabBar
        shell.onLayout = { [weak self] in self?.report() }

        let centre = NotificationCenter.default
        centre.addObserver(self, selector: #selector(keyboardShown),
                           name: UIResponder.keyboardWillShowNotification, object: nil)
        centre.addObserver(self, selector: #selector(keyboardHidden),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    func install(in host: UIViewController, scroller: UIScrollView?) {
        self.scroller = scroller
        shell.frame = host.view.bounds
        shell.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addChild(controller)
        host.view.addSubview(shell)
        controller.view.frame = shell.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shell.addSubview(controller.view)
        controller.didMove(toParent: host)
    }

    func apply(tabs: [[String: Any]]?, fab fabSpec: [String: Any]?) {
        if let tabs {
            routes = tabs.compactMap { $0["route"] as? String }
            controller.setViewControllers(tabs.enumerated().map { index, tab in
                let page = TriaTabPage()
                let label = tab["label"] as? String ?? ""
                // A template, so the system inks it: its own grey for the three
                // you are not on and `tintColor` for the one you are.
                let image = TriaSVG.image(markup: tab["icon"] as? String ?? "",
                                          size: Metric.icon, ink: .black, template: true)
                page.tabBarItem = UITabBarItem(title: label, image: image, tag: index)
                // The scroll the bar folds on, handed over BEFORE the page is
                // shown. The controller registers itself as the scroll view's
                // observer only when a page comes up; handed to a page already
                // up (as `select` used to), it is stored and never observed,
                // and the bar never folds. Measured in the simulator on 26.5.
                // One web view, so all four pages hold the same one.
                page.setContentScrollView(scroller, for: .bottom)
                return page
            }, animated: false)
            paintDots()
            select(route: currentRoute)
        }
        if let fabSpec {
            tabTint = Self.color(fromHex: fabSpec["tabTint"] as? String ?? "")
            controller.tabBar.tintColor = tabTint ?? .label
        }
    }

    /// A DOT, and never a number: `badgeValue` set to the EMPTY string is the
    /// system's own unnumbered badge. The colour is the reader's `--dot`,
    /// resolved over there like every other paint on this bridge.
    func setDots(_ map: [String: String]) {
        for (route, hex) in map {
            dots[route] = Self.color(fromHex: hex)   // an empty colour is "no dot"
        }
        paintDots()
    }

    private func paintDots() {
        for (index, page) in (controller.viewControllers ?? []).enumerated() where index < routes.count {
            let item = page.tabBarItem
            if let colour = dots[routes[index]] {
                item?.badgeValue = ""
                item?.badgeColor = colour
                item?.accessibilityValue = "New"
            } else {
                item?.badgeValue = nil
                item?.accessibilityValue = nil
            }
        }
    }

    /// Which destination is lit. A route no tab names (a friend's profile, a
    /// post) leaves the last one lit, which is what a pushed page in any tab
    /// bar app does — a `UITabBarController` has no "none selected" state, and
    /// the place you came from is the honest answer to "where am I".
    func select(route: String) {
        currentRoute = route
        guard let index = routes.firstIndex(of: route),
              let pages = controller.viewControllers, index < pages.count else { return }
        if controller.selectedIndex != index { controller.selectedIndex = index }
    }

    /* A TAP CROSSES AS A ROUTE, and the system is allowed to move its lens first.
       The old bar held its highlight still until the router answered, and a real
       tab bar that does that reads as a bar that ignored the finger: the lens
       slide IS the press feedback. So this returns true and app.js confirms it
       on the next `select` — which also corrects it, on the frame after, for a
       tap the router turns down. The same tab pressed again comes through here
       too, and app.js answers that one with reclick (scroll to the top). */
    func tabBarController(_ tabBarController: UITabBarController,
                          shouldSelect viewController: UIViewController) -> Bool {
        guard let index = tabBarController.viewControllers?.firstIndex(of: viewController),
              index < routes.count else { return false }
        onTap?(routes[index])
        return true
    }

    func setVisibility(chrome: Bool, fab _: Bool) {
        wantsChrome = chrome
        syncVisibility()
    }

    /// The whole bar goes by `isHidden`, with no transition, for the reason the
    /// web gives `body.postbar-live .nav` a `display: none`: a page change has
    /// no animation in this app (navigation.md), and the post page's comment
    /// bar is the only thing that belongs at the foot of that screen.
    private func syncVisibility() {
        let up = wantsChrome && !keyboardUp
        shell.isHidden = !up
    }

    func reservedBottom() -> CGFloat {
        guard let host = shell.superview else { return 0 }
        let bar = controller.tabBar
        guard bar.bounds.height > 0 else { return 0 }
        let top = bar.convert(bar.bounds, to: host).minY
        return max(0, host.bounds.maxY - top) + Metric.clearance
    }

    /* Reported only when it GROWS or the screen changed shape, never on the way
       down. A folded bar is shorter than an open one, and a reserve that shrank
       with it would move the foot of every page while the reader is scrolling
       it — the one moment the page must hold still. */
    private var reportedFor: CGSize = .zero
    private func report() {
        let size = shell.bounds.size
        let bottom = reservedBottom()
        guard bottom > 0 else { return }
        if size != reportedFor || bottom > lastReportedBottom + 0.5 {
            reportedFor = size
            lastReportedBottom = bottom
            onMetrics?(bottom)
        }
    }

    @objc private func keyboardShown() {
        keyboardUp = true
        syncVisibility()
    }

    @objc private func keyboardHidden() {
        keyboardUp = false
        syncVisibility()
    }

    /// Hex or `rgb()`/`rgba()`, which are the two forms app.js resolves a colour
    /// to. Every native piece in this file reads its colours through here; a
    /// native copy of the web's colour derivation would be a second place for
    /// it to drift.
    static func color(fromHex raw: String) -> UIColor? {
        let text = raw.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("rgb") {
            let numbers = text.split(whereSeparator: { !"0123456789.".contains($0) })
                .compactMap { Double($0) }
            guard numbers.count >= 3 else { return nil }
            return UIColor(red: numbers[0] / 255, green: numbers[1] / 255,
                           blue: numbers[2] / 255,
                           alpha: numbers.count > 3 ? numbers[3] : 1)
        }
        var hex = text.hasPrefix("#") ? String(text.dropFirst()) : text
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        return UIColor(red: CGFloat((value >> 16) & 0xff) / 255,
                       green: CGFloat((value >> 8) & 0xff) / 255,
                       blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }
}

/// One tab's page, which is nothing. The web view under the shell is every
/// page; this only exists because a `UITabBarController` needs a controller per
/// tab to hang a `tabBarItem` on.
@available(iOS 26.0, *)
final class TriaTabPage: UIViewController {
    override func loadView() {
        let blank = UIView()
        blank.backgroundColor = .clear
        blank.isUserInteractionEnabled = false
        view = blank
    }
}

/// The tab bar controller's view spans the screen, and every point of it that is
/// not the bar has to belong to the web view underneath. So a touch is kept only
/// when it lands on something INSIDE the bar — a tab, the capsule — and never on
/// the bar's own bounds, which run the width of the screen even while the
/// capsule has folded down to one bubble at the leading edge.
@available(iOS 26.0, *)
final class TriaTabShell: UIView {
    weak var tabBar: UITabBar?
    var onLayout: (() -> Void)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, let bar = tabBar,
              let hit = super.hitTest(point, with: event) else { return nil }
        return hit !== bar && hit.isDescendant(of: bar) ? hit : nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }
}

// MARK: - The toolbar

/// What the plugin is allowed to say to the top bar. Availability-free for the
/// same reason `TriaChromeControl` is: a stored property cannot be `@available`.
protocol TriaToolbarControl: AnyObject {
    func apply(spec: [String: Any])
    func fulfil(token: Int, items: [[String: Any]])
}

/// The top bar's controls, in real glass: the leading chevron, the trailing
/// filter / ••• / friends tie / search disc, the profile editor's Save, and the
/// daily's "Add yours" pill.
///
/// **IT CARRIES NO LAYOUT.** Every control arrives with the rect app.js measured
/// off the CSS bar this is standing in for, and this class does nothing but put
/// glass there. That is the same decision as sending resolved colours instead of
/// token names, one level up: the top bar's geometry is a stylesheet with two
/// breakpoints, a safe-area inset, a pill that gives up padding at 360px and a
/// web font that changes that pill's width when it lands — every one of which
/// would otherwise need a Swift copy chasing it. A CSS pixel is a point and the
/// web view fills the host view, so a rect crosses the bridge unconverted.
///
/// **THE WEB BAR IS STILL UNDERNEATH, and that is deliberate rather than
/// unfinished.** The collapsing TITLE stays CSS: it is measured against the
/// page's own `<h1>` sliding under the bar, which is a webview measurement and
/// has no native equivalent to ask. Everything else on this bar is native now —
/// the controls, because they are buttons in the system's sense, and the
/// material, because the system had one and we were painting our own. See the
/// note on `edge` below and docs/native-chrome.md.
/// THE TOP BAR'S MATERIAL: one pane of Liquid Glass, and nothing else.
///
/// Three things have been this, and the order matters because each one failed
/// for a reason worth not repeating.
///
/// 1. `.topbar::before` — a `--bg` gradient over a `backdrop-filter`, in CSS,
///    because in 1.3 there was nothing else to build it out of.
/// 2. That same gradient copied into Swift, so the material and the buttons
///    could animate as one object. Copying it was the mistake. A hand-rolled
///    paper wash, under `.statusbar-scrim`'s hand-rolled paper wash, over a
///    photograph, is fog — and no tuning of the stops was going to make a
///    painted scrim look like the material it was imitating.
/// 3. `UIScrollEdgeElementContainerInteraction`, the system's own scroll edge
///    effect, which is the thing both of those were imitating.
///
/// **(3) CANNOT WORK IN A CAPACITOR APP, and this is the paragraph to read
/// before trying it again.** A top edge effect draws in the band a scroll view
/// reserves at its top — its adjusted content inset — and it draws by sampling
/// that scroll view's own content. Capacitor pins the web view's
/// `contentInsetAdjustmentBehavior` to `.never` (`CAPInstanceDescriptor.m`) and
/// is right to: the page lays out its own safe area with `viewport-fit=cover`
/// and `env()`, and giving the scroll view an inset would shift every page down
/// by the notch and break pull-to-refresh, which reads a negative `scrollY`.
/// Adjusted inset of zero is a band of no height, so the effect was asked for,
/// accepted, and drew nothing. Handing it a PROXY scroll view carrying the
/// inset was tried next and drew nothing either, for the second half of the
/// same reason: an empty scroll view has no content to sample. Both were built,
/// installed and screenshotted, and both put a page title through the clock.
///
/// So (4): the material is a `UIGlassEffect`, which is what the discs riding on
/// it are already made of. It is one view, one effect, one alpha — no gradient,
/// no mask, no blur view, no `--bg` stops to keep in step with a stylesheet,
/// and it refracts what passes under it rather than veiling it.
///
/// IT HAS TO BE A SIBLING BEHIND THE BAR, not a child of it: `TriaToolbar` is a
/// `UIGlassContainerEffect`, and glass inside a glass container is a second
/// material nested in the first, which the container renders in a pass of its
/// own.
@available(iOS 26.0, *)
final class TriaToolbarMaterial: UIVisualEffectView {

    /* 1.8: THE SYSTEM'S BAR MATERIAL, and (5) on the list above. Zoe: no
       heading backgrounds, just the default iOS blur. The glass pane read as an
       object sitting on the page. This is `.systemChromeMaterial`, the material
       UIKit's own bars wear, with a clean bottom edge, which is the look of
       iOS 26's `.hard` scroll edge style.

       IT HAD A FADED EDGE FOR ONE BUILD AND IT CAME OFF. A gradient mask on a
       uniform blur fades the blur's OPACITY, where the system's `.soft` edge
       grows the blur RADIUS toward the top, and the difference reads at once:
       the masked one was a band of fog. Zoe's words: it doesn't quite feel
       native. Simpler and plainer is the native answer here, so there is
       nothing hand-shaped left on this view. */
    init() {
        super.init(effect: UIBlurEffect(style: .systemChromeMaterial))
        // A backdrop. Every tap in this rect belongs to a control on top of it
        // or to the page underneath.
        isUserInteractionEnabled = false
        alpha = 0
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/// Watches the web view's scroll offset, and answers the two questions the
/// bar's header is a function of: is the page at its top, and is the reader
/// going DOWN it.
///
/// Both used to cross the bridge — `bare` as a flag on every toolbar push, read
/// off the `.topbar--bare` class app.js maintains, and the direction not at all
/// because the bar it drove was CSS. Neither needs to: the questions are about
/// a scroll view sitting right here, and a fact native can read itself is one
/// fewer thing that can arrive a frame late. What the web still owns is WHICH
/// KIND OF PAGE this is (`holdHeader`), which changes on a navigation rather
/// than on a scroll and so belongs in the payload.
///
/// The two thresholds are ONE NUMBER on purpose, matching `HEADER_SLACK` in
/// app.js: starting down from the top, the first offset that counts as "off the
/// top" has to already count as "reading", or the material fades in for the one
/// frame in between and shimmers.
///
/// KVO rather than the scroll delegate, because the web view's delegate is
/// WebKit's and taking it is a way to break scrolling itself.
@available(iOS 26.0, *)
final class TriaScrollWatch: NSObject {

    /// Far enough down that the rubber band's own fractional offsets on the way
    /// home don't flicker it. The same reasoning as `ANCHOR_SLACK` in app.js:
    /// iOS hands back sub-point offsets, so a threshold of zero is no threshold.
    private static let slack: CGFloat = 4

    struct State: Equatable {
        /// Nothing has passed under the bar yet.
        var atTop = true
        /// The reader's last move was downward, so the header stands aside.
        var reading = false
    }

    private var token: NSKeyValueObservation?
    private var last: State?
    private var lastY: CGFloat = 0

    init(of source: UIScrollView, onChange: @escaping (State) -> Void) {
        super.init()
        token = source.observe(\.contentOffset, options: [.initial, .new]) { [weak self] view, _ in
            guard let self else { return }
            let y = view.contentOffset.y + view.adjustedContentInset.top
            var state = State(atTop: y <= Self.slack, reading: self.last?.reading ?? false)
            // A move bigger than the viewport can't have come from a thumb: the
            // router teleports the window to a spotlight, to a remembered
            // position, back to the top, and a thousand-point jump reading as
            // "scrolling down fast" is a second move stapled onto a navigation
            // meant to be one fade. app.js guards its own copy the same way.
            if abs(y - self.lastY) <= view.bounds.height {
                if y > self.lastY + Self.slack { state.reading = true }
                else if y < self.lastY - Self.slack { state.reading = false }
            }
            self.lastY = y
            guard state != self.last else { return }
            self.last = state
            onChange(state)
        }
    }

    deinit { token?.invalidate() }
}

@available(iOS 26.0, *)
final class TriaToolbar: UIVisualEffectView, TriaToolbarControl {

    var onTap: ((String) -> Void)?
    var onMenu: ((String, Int) -> Void)?
    var onPick: ((String, Int) -> Void)?
    /// Discover's search, which is the one control in this bar that holds a
    /// caret. See `TriaSearchField`.
    var onSearchText: ((String) -> Void)?
    var onSearchClose: (() -> Void)?
    var onSearchBlur: (() -> Void)?

    private var controls: [String: TriaToolbarButton] = [:]
    private var search: TriaSearchField?
    private weak var scroller: UIScrollView?
    /* OXYGEN, IN THE ONE FORM UIKIT CAN READ.

       The stylesheet's `font-family: 'Oxygen'` is a `woff2` in `css/fonts/`,
       which CoreText cannot open — web font containers are not a format the
       font manager registers. So `ios-sync.sh` carries a `ttf` of the same face
       beside it (converted from that exact file, so it cannot drift), the
       bundle already copies the whole folder for the web half, and this
       registers it into the process on first ask.

       It is deliberately NOT in the asset catalog or `UIAppFonts`: both would
       mean a second copy of the typeface in the repo and a `.pbxproj` edit,
       and the one the web view is already loading is right there.

       If the registration ever fails the label falls back to the system font at
       the same size and weight. That is a visible change of typeface and not a
       broken bar, which is the right way round for a title. */
    private static var fontRegistered = false

    private static func titleFont(_ size: CGFloat) -> UIFont {
        let size = size > 0 ? size : 16.8
        if !fontRegistered {
            fontRegistered = true
            if let url = Bundle.main.url(forResource: "oxygen-700-latin", withExtension: "ttf",
                                         subdirectory: "public/css/fonts") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
        return UIFont(name: "Oxygen-Bold", size: size)
            ?? .systemFont(ofSize: size, weight: .bold)
    }

    /// The bar's material, behind this container rather than in it. See
    /// TriaToolbarMaterial, which carries the three things this was before.
    private let material = TriaToolbarMaterial()
    /// How far past the left, right and top edges the material is pushed, so
    /// that three of its four glass rims are off-screen. Any value past the
    /// display's corner radius will do.
    private var barHeight: CGFloat = 0
    private var watch: TriaScrollWatch?
    /// Whether this route draws a bar at all. Signed out there is none.
    private var live = false
    /// The collapsing small title. See `titleSpec` in app.js for why it is here
    /// rather than in the web bar it is still measured against.
    private let titleLabel = UILabel()
    private var wantsTitle = false
    /// THE WORDMARK (1.8), centred on My Circle's bar the way Instagram's sits
    /// on its home feed: the italic "tria" from `icons/wordmark.svg`, drawn by
    /// `TriaSVG` in the reader's ink. Always up while its route is, unlike the
    /// title, because it is the page's name and there is no big one to stand
    /// in for.
    private let markView = UIImageView()
    private var drawnMark = ""
    /// Nothing under the bar yet, so nothing for the material to separate it
    /// from, and whether the reader is going down the page. Native's own
    /// reading of the scroll, not a flag from the web. See `TriaScrollWatch`.
    private var scroll = TriaScrollWatch.State()
    /// Whether this route KEEPS its header once you are off the top — a profile
    /// or a daily, whose small title is a person's name or the day's prompt —
    /// or hands it back only when the reader scrolls up, which is every page
    /// named by the tab you pressed to reach it. The web decides (`holdsHeader`
    /// in app.js): it is a fact about the route, so it arrives on a navigation
    /// rather than on a scroll.
    private var holdHeader = false
    /// The header — the material behind the bar and the small title on it — is
    /// one object in two views, and this is the single answer both wear.
    private var headerUp: Bool { !scroll.atTop && (holdHeader || !scroll.reading) }
    /// The discs, on the wordmark's rule: up at the top of a page and whenever
    /// the header is, gone on a read down (Zoe, 2026-10-22: the top buttons can
    /// disappear on scroll). The web's copy is `.topbar--reading` on the two
    /// control slots in app.css.
    private var controlsUp: Bool { scroll.atTop || headerUp }

    /// Each disc fades on its own, never `contentView`: alpha on a glass
    /// container leaves its nested glass half-drawn (see the note above
    /// `materialFrame`). A nested glass element honours alpha.
    private func syncAway(animated: Bool) {
        for control in controls.values { control.setAway(!controlsUp, animated: animated) }
    }

    /// A menu the system is presenting right now and whose rows have not arrived
    /// yet. See `attachMenu` for why they arrive late.
    private var pendingMenus: [Int: ([UIMenuElement]) -> Void] = [:]
    private var menuOwners: [Int: String] = [:]
    private var nextToken = 1

    init() {
        // spacing 0, the same call the bottom bar makes and for the same reason:
        // the container is here so the discs render as one glass system, not so
        // they fuse into a segmented control. The web draws them as separate
        // discs --toolbar-gap apart and this is not the release that changes it.
        let container = UIGlassContainerEffect()
        container.spacing = 0
        super.init(effect: container)
        isUserInteractionEnabled = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func install(in host: UIView, scroller: UIScrollView?) {
        frame = host.bounds
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.alpha = 0
        titleLabel.isUserInteractionEnabled = false
        contentView.addSubview(titleLabel)
        markView.contentMode = .scaleAspectFit
        markView.isUserInteractionEnabled = false
        markView.isAccessibilityElement = true
        markView.accessibilityTraits = .header
        markView.isHidden = true
        contentView.addSubview(markView)
        host.addSubview(material)
        host.addSubview(self)
        self.scroller = scroller
        if let scroller {
            watch = TriaScrollWatch(of: scroller) { [weak self] state in
                guard let self, state != self.scroll else { return }
                let crossedTop = state.atTop != self.scroll.atTop
                self.scroll = state
                self.syncMaterial(animated: true)
                self.syncTitle(animated: true)
                self.syncAway(animated: true)
                if crossedTop { self.syncBare(animated: true) }
            }
        }
    }

    // MARK: State

    func apply(spec: [String: Any]) {
        live = spec["live"] as? Bool ?? false
        holdHeader = spec["holdHeader"] as? Bool ?? false
        // The bar is 60px plus the notch on a phone and 88 on a tablet,
        // measured by app.js off the CSS bar rather than assumed here. It is
        // the height of the material and the only geometry it needs.
        if TriaToolbar.number(spec["height"]) > 0 {
            barHeight = TriaToolbar.number(spec["height"])
        }

        if let title = spec["title"] as? [String: Any] {
            let text = title["text"] as? String ?? ""
            titleLabel.text = text
            titleLabel.font = TriaToolbar.titleFont(TriaToolbar.number(title["size"]))
            if let ink = title["ink"] as? String,
               let colour = TriaChromeBar.color(fromHex: ink) { titleLabel.textColor = colour }
            titleLabel.frame = CGRect(x: TriaToolbar.number(title["x"]),
                                      y: TriaToolbar.number(title["y"]),
                                      width: TriaToolbar.number(title["w"]),
                                      height: TriaToolbar.number(title["h"]))
            wantsTitle = (title["visible"] as? Bool ?? false) && !text.isEmpty
        }
        applyMark(spec["mark"] as? [String: Any])

        let wanted = (spec["controls"] as? [[String: Any]]) ?? []
        var seen = Set<String>()
        for item in wanted {
            guard let id = item["id"] as? String, !id.isEmpty else { continue }
            seen.insert(id)
            let control: TriaToolbarButton
            if let existing = controls[id] {
                control = existing
            } else {
                control = TriaToolbarButton(id: id)
                control.button.addTarget(self, action: #selector(tapped(_:)), for: .touchUpInside)
                contentView.addSubview(control)
                // Below the glass, so the material has something to sample. See
                // TriaToolbarButton.ramp for why it cannot live inside it.
                contentView.insertSubview(control.ramp, belowSubview: control)
                controls[id] = control
            }
            control.setAway(!controlsUp, animated: false)
            control.update(spec: item)
            control.setBare(scroll.atTop, animated: false)
            // Attached (or dropped) after the update, because whether a control
            // owns a menu can change under it: Discover's search disc is a plain
            // button, and the profile's ••• is not.
            if control.wantsMenu { attachMenu(to: control) } else { control.button.menu = nil }
        }
        // A control the page no longer mounts goes, rather than lingering
        // invisible: resetToolbar empties the web bar on every navigation, and
        // this is the same clearing seen from the other side.
        for (id, control) in controls where !seen.contains(id) {
            control.removeFromSuperview()
            controls.removeValue(forKey: id)
        }

        // Discover's search, and it is deliberately built only if a page ever
        // asks for one: every other route sends `live: false` and never pays for
        // the view. The disc it grows out of is an ordinary control above until
        // the moment it opens, at which point app.js stops sending it (see
        // CONTROL_SEL's filter) and the loop over `seen` takes it away on the
        // same frame this appears at exactly its rect.
        if let field = spec["search"] as? [String: Any] {
            if search == nil, field["live"] as? Bool == true {
                let bar = TriaSearchField()
                bar.onText = { [weak self] text in self?.onSearchText?(text) }
                bar.onClose = { [weak self] in self?.onSearchClose?() }
                bar.onBlur = { [weak self] in self?.onSearchBlur?() }
                contentView.addSubview(bar)
                search = bar
            }
            search?.apply(spec: field, scroller: scroller)
        }

        isHidden = !live
        syncMaterial(animated: !isHidden)
        syncTitle(animated: !isHidden)
        material.frame = materialFrame()
    }

    /* SINCE 2026-10-22 THE DISCS LEAVE ON A READ DOWN AGAIN, on the header's
       rule and not a gesture of their own (`controlsUp`, `syncAway`): Zoe's
       call, once the title, wordmark and tab bar all left on the same read
       down. What follows is the history, and its two facts still hold.

       THE BAR NO LONGER HIDES ON A SCROLL DOWN, and this is where that used to
       be. `setShown` faded every disc, the search capsule and the title out
       together when `.topbar--hidden` went on, and `visible` crossed the bridge
       on every push to drive it.

       It went for a design reason rather than a technical one (see the scroll
       watcher in app.js): the controls in this bar are the PAGE'S OWN — back,
       the filter dial, Save, •••, search — and a control worth putting on the
       screen is not worth making the reader scroll up to fetch. What still
       arrives with the scroll is the HEADER behind them — the material and the
       small title — which is what the gesture was really for. It kept the
       gesture's shape, too: on most routes the header stands aside while the
       reader goes DOWN a page and comes back when they reach up. See
       `headerUp`.

       Two facts it was built on are worth keeping, because the next animation
       on this class will need them both. `alpha` on a UIVisualEffectView is
       unsupported, and on a GLASS CONTAINER it is worse than unsupported: the
       container renders its nested glass in a pass of its own, so
       `contentView.alpha` leaves the discs drawn at partial strength and
       re-rendering every frame (`syncVisibility` documents the same trap on the
       bottom bar). What DOES honour alpha is a nested glass ELEMENT, which is
       how the composer's + animates and how each disc was faded here. */

    /* THE MATERIAL LEAVES WITH THE BUTTONS. It briefly did not.

       There was a version that kept the safe-area strip behind when the bar
       tucked away, on the reasoning that the clock still needs something under
       it — the job `.statusbar-scrim` was added to do. It is the wrong trade.
       A reader scrolling down asked for the chrome to go, and a glass tab
       hanging in the notch after the bar it belonged to has gone is a leftover,
       not a courtesy. iOS resolves the status bar against what is behind it and
       is allowed to do that over the page, the way it does in every app that
       scrolls content under the clock.

       So the material is `live && headerUp`: a route that draws a bar at all,
       and a header that is currently up. There was a third term, the bar being
       shown, and it went with the hide-on-scroll gesture above.

       AND IT LEAVES WITH THE TITLE, not on its own. `headerUp` is one property
       read by both, deliberately: the material and the small title are two
       views of ONE header, and the whole reason the bar's own hide-on-scroll
       came out is that two halves of one bar were animating separately and
       could not be made to agree. Change the rule in `headerUp` or in neither.

       AND IT FADES, it does not shrink. Everything else on this bar fades;
       nothing in 1.4 enters or leaves by travelling. A collapsing height read
       as the bar folding up into the notch while the discs on it dissolved in
       place, which is two animations again. Alpha is safe HERE, unlike on the
       control container — this view is one plain UIVisualEffectView, not a
       glass container rendering nested elements in a pass of its own. */
    // The bar's own height, full width. The glass pane needed its rims pushed
    // off three sides (`rimSlack`, gone); a blur has none.
    private func materialFrame() -> CGRect {
        CGRect(x: 0, y: 0, width: bounds.width, height: max(barHeight, safeAreaInsets.top))
    }

    private func syncMaterial(animated: Bool) {
        material.frame = materialFrame()
        let wanted: CGFloat = (live && headerUp) ? 1 : 0
        guard material.alpha != wanted else { return }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.24, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState,
                                     .curveEaseOut]) { self.material.alpha = wanted }
        } else {
            material.alpha = wanted
        }
    }

    /// The title's arrival: the page's big serif name has scrolled out from
    /// under the bar, the small one takes over, and the header it rides on is
    /// up. `--dur-quick`, the same the CSS rule used.
    ///
    /// TWO FACTS, and only the first is a webview measurement. `wantsTitle` is
    /// the web's answer to "has the big title gone", which native cannot see
    /// (see `titleSpec` in app.js). `headerUp` is native's own, read off the
    /// scroll view, and it is the same one the material wears.
    ///
    /// The web crossfades it on opacity AND a 6px blur. Only the opacity comes
    /// over: a blur on a UILabel means rasterising it into a layer every frame
    /// of the ramp, which is the cost this whole pass exists to stop paying,
    /// and at 16.8pt over a quarter of a second nobody has ever seen it.
    /* JUST ICONS AT THE TOP OF A PAGE (1.8). Zoe: no glass buttons up here,
       only at the top though. With nothing under the bar yet, a disc of glass
       is a shape around a glyph for no reason, so a plain glyph control goes
       bare; the moment content slides under it, the glass comes back to
       separate the mark from what is passing behind. Tinted controls (Save,
       Add yours) keep their fill, because the fill is what says they commit. */
    private func syncBare(animated: Bool) {
        for control in controls.values { control.setBare(scroll.atTop, animated: animated) }
    }

    private func applyMark(_ spec: [String: Any]?) {
        guard let spec, let svg = spec["svg"] as? String, !svg.isEmpty else {
            markView.isHidden = true
            return
        }
        let w = TriaToolbar.number(spec["w"]), h = TriaToolbar.number(spec["h"])
        markView.frame = CGRect(x: TriaToolbar.number(spec["x"]), y: TriaToolbar.number(spec["y"]),
                                width: w, height: h)
        let key = "\(w)x\(h)"
        if key != drawnMark {
            drawnMark = key
            markView.image = TriaSVG.image(markup: svg, width: w, height: h)
        }
        markView.tintColor = TriaChromeBar.color(fromHex: spec["ink"] as? String ?? "") ?? .label
        markView.accessibilityLabel = spec["label"] as? String
        markView.isHidden = false
    }

    private func syncTitle(animated: Bool) {
        // The wordmark goes with the header while the reader goes DOWN, and is
        // there at the top of the page, where there is no header yet: the
        // Instagram home feed's logo, which leaves on the way down and is back
        // the moment you reach up.
        let markWanted: CGFloat = (scroll.atTop || headerUp) ? 1 : 0
        if markView.alpha != markWanted {
            if animated && !UIAccessibility.isReduceMotionEnabled {
                UIView.animate(withDuration: 0.24, delay: 0,
                               options: [.allowUserInteraction, .beginFromCurrentState,
                                         .curveEaseOut]) { self.markView.alpha = markWanted }
            } else {
                markView.alpha = markWanted
            }
        }
        // The title is the page's name from the first frame now (1.8, one
        // header on every page), so it keeps the wordmark's rule: up at the top
        // of the page and whenever the header is.
        let wanted: CGFloat = (wantsTitle && (scroll.atTop || headerUp)) ? 1 : 0
        guard titleLabel.alpha != wanted else { return }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.24, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState,
                                     .curveEaseOut]) { self.titleLabel.alpha = wanted }
        } else {
            titleLabel.alpha = wanted
        }
    }

    // MARK: Menus

    /* THE ROWS ARRIVE AFTER THE MENU DOES, and that is the whole reason this is
       a `UIDeferredMenuElement`.

       A menu in Tria is built at the moment its button is tapped — the profile's
       ••• fans out a different list for your own page than for a visitor's,
       Discover's dial drops its gallery/list row while you are looking at
       People, and the filter dial marks whichever row is live right now. None of
       that is known when the bar is mounted, and pushing a snapshot at mount
       would be a second copy of a decision the web layer is already making
       correctly.

       `uncached` asks for the rows every time the menu opens. So the tap goes to
       app.js, app.js runs THE SAME click handler the CSS button has always run,
       and the bar menu that handler opens describes itself instead of drawing a
       card (see openBarMenu). The rows come back through `menuReady` and the
       system fills the menu it has already put on screen. One list, built once,
       in the place that knows what a filter means.

       The timeout is not a nicety: a completion that is never called leaves the
       system holding an open menu with a spinner in it forever. */
    private func attachMenu(to control: TriaToolbarButton) {
        control.button.showsMenuAsPrimaryAction = true
        control.button.menu = UIMenu(children: [
            UIDeferredMenuElement.uncached { [weak self, weak control] completion in
                guard let self, let control else { completion([]); return }
                let token = self.nextToken
                self.nextToken += 1
                self.pendingMenus[token] = completion
                self.menuOwners[token] = control.id
                self.onMenu?(control.id, token)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                    guard let self, let late = self.pendingMenus.removeValue(forKey: token)
                    else { return }
                    self.menuOwners.removeValue(forKey: token)
                    late([])
                }
            }
        ])
    }

    func fulfil(token: Int, items: [[String: Any]]) {
        guard let completion = pendingMenus.removeValue(forKey: token) else { return }
        let owner = menuOwners.removeValue(forKey: token) ?? ""
        completion(TriaMenu.elements(from: items) { [weak self] index in
            self?.onPick?(owner, index)
        })
    }

    // MARK: Taps and hit testing

    @objc private func tapped(_ sender: UIButton) {
        guard let control = sender.superview?.superview as? TriaToolbarButton else { return }
        // A menu button never gets here — `showsMenuAsPrimaryAction` swallows the
        // touch — so this is only ever a plain control, and it goes back to
        // app.js, which clicks the web element it stands for. That keeps every
        // existing handler (a back chevron's href, the editor's form submit,
        // the daily's composer route) as the one implementation.
        control.onTap?(control.id)
        onTap?(control.id)
    }

    /// Same contract as the bottom bar's: the container spans the host so its
    /// glass shares one environment, and it must not eat the taps and scrolls
    /// that belong to the page underneath.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard !isHidden, isUserInteractionEnabled else { return false }
        for child in contentView.subviews where !child.isHidden && child.alpha > 0.01
            && child.isUserInteractionEnabled {
            if child.point(inside: child.convert(point, from: self), with: event) { return true }
        }
        return false
    }

    static func number(_ value: Any?) -> CGFloat {
        if let d = value as? Double { return CGFloat(d) }
        if let i = value as? Int { return CGFloat(i) }
        if let n = value as? NSNumber { return CGFloat(truncating: n) }
        return 0
    }

    /// The same read for a spec whose keys are all real lengths, where a missing
    /// one has to keep whatever the view already had rather than collapse to
    /// zero. Zero is a legitimate answer here (--postbar-face-y could be), so it
    /// is the absence of the key that falls back, not the value.
    static func number(_ value: Any?, fallback: CGFloat) -> CGFloat {
        if let d = value as? Double { return CGFloat(d) }
        if let i = value as? Int { return CGFloat(i) }
        if let n = value as? NSNumber { return CGFloat(truncating: n) }
        return fallback
    }
}

/// One control in the top bar: a glass capsule at the rect app.js measured, with
/// a glyph or a word in it.
@available(iOS 26.0, *)
final class TriaToolbarButton: UIVisualEffectView {

    let id: String
    let button = UIButton(type: .custom)
    var wantsMenu = false
    var onTap: ((String) -> Void)?

    /// THE BAND, THE WAY THE + WEARS IT — which is one of three ways, sorted
    /// out in app.js and drawn by `TriaBand`. An accent tints the glass itself,
    /// Tria's four-hue ramp goes under it as a backdrop, and "no colour" draws
    /// neither. Only the middle case uses the view below.
    ///
    /// The ramp is a SIBLING, because a `UIVisualEffectView` has no way to put
    /// anything behind its own material — `contentView` is above it. So the
    /// toolbar inserts this below the button (see `apply`), and everything that
    /// moves the button has to move it: `update` sets the frame, the idle
    /// animation sets the alpha and the transform, and `removeFromSuperview`
    /// takes it away. A frame out of step is a coloured ghost sitting where the
    /// control used to be.
    let ramp = TriaBandRamp()

    /// The face the daily's pill is set in: Oxygen Bold at the same 14.4pt the
    /// web sets it at. The app's whole UI is Oxygen, so a native control wearing
    /// San Francisco beside a web title wearing Oxygen was the one place the two
    /// halves of the chrome were visibly different objects.
    ///
    /// It is a REAL COPY OF THE FACE, in the App target's bundle (Oxygen-Bold.ttf,
    /// declared in UIAppFonts). CoreText cannot register a woff2, which is the
    /// form every face in css/fonts ships as for the web, so the alternative was
    /// a system font tuned to look near it — and "near" is what a reader sees as
    /// a mistake. The file is the same latin subset the stylesheet loads, its
    /// flavour changed and nothing else: same outlines, same metrics, same 217
    /// glyphs, 18KB, and no second place the drawing of the letters lives.
    ///
    /// The fallback is not decoration. A font that failed to copy in returns nil
    /// here and the pill still draws, in the system face at the same size and
    /// weight, which is exactly what it did before this line existed.
    static let pill: UIFont = UIFont(name: "Oxygen-Bold", size: 14.4)
        ?? .systemFont(ofSize: 14.4, weight: .bold)

    /// What was last drawn, so a push that changes one control's dot does not
    /// re-render four glyphs and re-assign three glass effects.
    private var drawn = ""

    init(id: String) {
        self.id = id
        super.init(effect: UIGlassEffect(style: .regular))
        (effect as? UIGlassEffect)?.isInteractive = true
        cornerConfiguration = .capsule()
        button.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            button.topAnchor.constraint(equalTo: contentView.topAnchor),
            button.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The sibling goes with it. Not a tidiness: `apply` drops a control the
    /// page no longer mounts, and a ramp left behind is a coloured capsule on
    /// the bar with no button on it.
    override func removeFromSuperview() {
        ramp.removeFromSuperview()
        super.removeFromSuperview()
    }

    /// THE BELL'S DOT (1.8), which moved here off the Chats tab when Updates
    /// moved to My Circle's bar. Same mark as the tab bar's: one colour, no
    /// number, 6.5pt, on the disc's top-trailing shoulder where the 24pt glyph
    /// inside a 44pt disc leaves it clear. Nil takes it away.
    private var dot: UIView?
    private func paintDot(_ colour: UIColor?) {
        button.accessibilityValue = colour == nil ? nil : "New"
        guard let colour else { dot?.removeFromSuperview(); dot = nil; return }
        let mark = dot ?? UIView()
        if dot == nil {
            mark.translatesAutoresizingMaskIntoConstraints = false
            mark.layer.cornerRadius = 3.25
            mark.isUserInteractionEnabled = false
            contentView.addSubview(mark)
            NSLayoutConstraint.activate([
                mark.widthAnchor.constraint(equalToConstant: 6.5),
                mark.heightAnchor.constraint(equalToConstant: 6.5),
                mark.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
                mark.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8)
            ])
            dot = mark
        }
        mark.backgroundColor = colour
    }

    /// A control with nothing but a glyph on it: no band, no tint, no words.
    /// Only these go bare at the top of a page (see `TriaToolbar.syncBare`).
    private var plain = false
    private var lastSpec: [String: Any] = [:]
    private var bare = false

    func setBare(_ wanted: Bool, animated: Bool) {
        let target = wanted && plain
        guard target != bare else { return }
        bare = target
        let swap = {
            if target {
                self.effect = nil
            } else {
                TriaBand.apply(self.lastSpec, glass: self, ramp: self.ramp)
            }
        }
        // Setting the effect inside an animation block is how a glass element
        // materialises and dissolves rather than popping.
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.24, animations: swap)
        } else {
            swap()
        }
    }

    func update(spec: [String: Any]) {
        frame = CGRect(x: TriaToolbar.number(spec["x"]), y: TriaToolbar.number(spec["y"]),
                       width: TriaToolbar.number(spec["w"]), height: TriaToolbar.number(spec["h"]))
        ramp.frame = frame
        wantsMenu = spec["menu"] as? Bool ?? false
        button.accessibilityLabel = spec["label"] as? String
        button.accessibilityTraits = .button

        let glyph = spec["glyph"] as? String ?? ""
        let ink = spec["ink"] as? String ?? ""
        let band = (spec["colors"] as? [String] ?? []).joined(separator: ",")
        let tint = spec["tint"] as? String ?? ""
        let text = spec["text"] as? String ?? ""
        let after = spec["after"] as? String ?? ""
        // Everything the drawing depends on, in one string. Cheaper than four
        // comparisons and it cannot forget a field.
        /* THE SCHEME IS PART OF THE KEY, because `.label` is what an empty ink
           means and `.label` is not a value — it is two, and this cache would
           otherwise hold the one that was live when the face was last drawn.
           The ramp family gets away with it by accident (its stops are
           different hexes on ink paper, so the band alone changes the key);
           "no colour" sends no stops and no ink at all, so without this a bare
           control keeps a black label after sunset. */
        let scheme = traitCollection.userInterfaceStyle.rawValue
        let key = ["\(scheme)", glyph, ink, band, tint, text, after,
                   "\(frame.width)"].joined(separator: "|")
        if key != drawn {
            drawn = key
            let inkColour = TriaChromeBar.color(fromHex: ink) ?? .label
            if text.isEmpty {
                button.setAttributedTitle(nil, for: .normal)
                button.setImage(glyph.isEmpty ? nil
                    : TriaSVG.image(markup: glyph, size: 24, ink: inkColour, template: false),
                                for: .normal)
            } else {
                // The daily's "Add yours" pill, in the app's own type. The web
                // sets it in Oxygen 700 at 0.9rem, and 0.9rem is 14.4px is 14.4
                // points, so this is the same words at the same size in the same
                // face — not an approximation of it. See TriaToolbarButton.pill
                // for how the face gets here and what happens if it doesn't.
                button.setImage(nil, for: .normal)
                let label = after.isEmpty ? text : "\(text)  \(after)"
                button.setAttributedTitle(NSAttributedString(string: label, attributes: [
                    .font: TriaToolbarButton.pill,
                    .foregroundColor: inkColour
                ]), for: .normal)
            }
            // The banded kinds — the editor's Save and the daily's pill — wear
            // the band the compose + wears, for the same reason: on the web they
            // are `.publish-fill.is-solid`, one family of primary acts. A bare
            // control sends neither colours nor a tint and gets plain glass.
            TriaBand.apply(spec, glass: self, ramp: ramp)
            // A redraw just put the glass back; a bare control stays bare.
            if bare { effect = nil }
        }
        lastSpec = spec
        plain = text.isEmpty && tint.isEmpty && band.isEmpty

        // A LIT FILTER IS THE GLYPH'S OWN COLOUR, and there is nothing extra to
        // draw for it. There was a dot here — 8px of the active type's pastel
        // pinned at the disc's top-right inside a 2px ring of paper, mirroring
        // `.masthead-filter-dot`. Opaque paper is a fine way to punch a bead
        // clear of the strokes behind it on a PAGE; on Liquid Glass it is a flat
        // disc of solid colour sitting on a refracting surface, and it read as a
        // rendering fault rather than as a state. The stylesheet tints the mark
        // instead, `ink` above already carries whatever the cascade landed on,
        // and this renderer needs no idea that a filter is a thing.

        // The editor's Save is mounted before it is earned and fades in on the
        // keystroke that earns it (`.toolbar-commit--idle`): hidden, but still a
        // transition target, and still holding its slot so the bar's title
        // reserve is settled once at mount. Same here.
        paintDot(TriaChromeBar.color(fromHex: spec["dot"] as? String ?? ""))

        idle = spec["hidden"] as? Bool ?? false
        settle(animated: true)
    }

    /// Two reasons a disc is not showing, kept apart so neither undoes the
    /// other: `idle` is the page's (the editor's unearned Save, which also
    /// shrinks), `away` is the scroll's (the header has left on a read down,
    /// see `TriaToolbar.syncAway`), which only fades.
    private var idle = false
    private var away = false

    func setAway(_ wanted: Bool, animated: Bool) {
        guard wanted != away else { return }
        away = wanted
        settle(animated: animated)
    }

    private func settle(animated: Bool) {
        let gone = idle || away
        isUserInteractionEnabled = !gone
        let apply = {
            self.alpha = gone ? 0 : 1
            self.transform = self.idle ? CGAffineTransform(scaleX: 0.82, y: 0.82) : .identity
            // The ramp is a sibling and none of the above reaches it. Inside the
            // same block, or the colour hangs in the air behind a Save that has
            // already faded out.
            self.ramp.alpha = self.alpha
            self.ramp.transform = self.transform
        }
        if UIAccessibility.isReduceMotionEnabled {
            alpha = gone ? 0 : 1
            transform = .identity
            ramp.alpha = alpha
            ramp.transform = .identity
        } else if animated && alpha != (gone ? 0 : 1) {
            UIView.animate(withDuration: 0.24, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState],
                           animations: apply)
        } else {
            apply()
        }
    }
}


/// DISCOVER'S SEARCH, WHICH IS A DISC UNTIL IT IS A BAR.
///
/// The web control is three nodes that behave as one (see `.toolbar-search-shell`
/// in app.css): a glass shell pinned by its RIGHT edge — exactly where the disc
/// already was — that animates its WIDTH, so the field grows leftward out of the
/// button the finger is still resting on, with the input and the glyph riding
/// inside it.
///
/// Under native chrome that shell used to hand its dress back to the web the
/// moment it opened, which is the one seam this class exists to close. The
/// reason was honest — the X rides ON the shell, and a glass disc of ours over a
/// glass shell of theirs is the stack "never glass on glass" has never allowed —
/// but the answer was the wrong half: it left a reader watching real Liquid
/// Glass turn into a CSS impression of it, on the one control in the app whose
/// whole gesture is the material stretching. Drawing BOTH here fixes the stack
/// instead of dodging it: one glass capsule, and the X inside it is a bare mark
/// on the surface, the way the web's own clear is on the find bar.
///
/// AND THE FIELD IS REAL, for the comment bar's reason exactly: it holds a
/// caret, so it cannot be a face over a hidden web input. Every keystroke is
/// written straight back into `#discover-search`, which fires its own `input`,
/// so the debounce, the tile scoring, the tag rail and the whole rebuild are the
/// code that already shipped, running unchanged. This file has never heard of a
/// tag.
///
/// It lives in `TriaToolbar`'s glass container beside the buttons, which is what
/// makes the open and the close a MORPH rather than a swap: the disc's own
/// control stops being sent on the frame this appears, the two overlap, and the
/// container merges them the way the system merges any two pieces of glass that
/// meet.
@available(iOS 26.0, *)
final class TriaSearchField: UIVisualEffectView, UITextFieldDelegate {

    /// A keystroke. The web input is still the model.
    var onText: ((String) -> Void)?
    /// The X, tapped. Closing is the web's — it clears the query, folds the bar
    /// and repaints — so this only says that it happened.
    var onClose: (() -> Void)?
    /// The field gave up the caret without the X being tapped: the page was
    /// tapped, or dragged, or Return was pressed. The web folds an EMPTY search
    /// on a blur and keeps a full one open, and that rule stays over there.
    var onBlur: (() -> Void)?

    private let field = UITextField()
    private let close = UIButton(type: .custom)
    private var dismisser: TriaKeyboardDismisser?

    /// Where the disc sits when the bar is shut, so the capsule can grow out of
    /// it and shrink back into it rather than appearing whole.
    private var closedFrame = CGRect.zero
    private var openFrame = CGRect.zero
    private var live = false
    private var drawn = ""

    init() {
        super.init(effect: UIGlassEffect(style: .regular))
        (effect as? UIGlassEffect)?.isInteractive = true
        cornerConfiguration = .capsule()
        isHidden = true
        alpha = 0

        field.borderStyle = .none
        field.backgroundColor = .clear
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.spellCheckingType = .no
        field.clearButtonMode = .never          // the X at the end of the bar is the clear
        field.returnKeyType = .search
        field.delegate = self
        field.addTarget(self, action: #selector(edited), for: .editingChanged)
        contentView.addSubview(field)

        // A BARE MARK, NOT A DISC. The web's own rule for the pair of clears it
        // already draws (.postbar-clear, .toolbar-search-btn): the surface under
        // it is already glass, so a second sample here is the stack this whole
        // release refuses.
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        contentView.addSubview(close)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: State

    /// `spec` is the toolbar payload's `search` object. Every length in it was
    /// measured off the laid-out shell on the web side — the gate switches that
    /// shell's width transition OFF under native chrome precisely so the box read
    /// on the frame the class flips is the FINAL one, and the growth below is
    /// this view's own rather than a per-frame chase of the stylesheet's.
    func apply(spec: [String: Any], scroller: UIScrollView?) {
        if dismisser == nil {
            dismisser = TriaKeyboardDismisser(scroller: scroller) { [weak self] in
                self?.field.resignFirstResponder()
            }
        }
        let wanted = spec["live"] as? Bool ?? false
        closedFrame = CGRect(x: TriaToolbar.number(spec["closedX"]),
                             y: TriaToolbar.number(spec["closedY"]),
                             width: TriaToolbar.number(spec["closedW"]),
                             height: TriaToolbar.number(spec["closedH"]))
        openFrame = CGRect(x: TriaToolbar.number(spec["x"]), y: TriaToolbar.number(spec["y"]),
                           width: TriaToolbar.number(spec["w"]),
                           height: TriaToolbar.number(spec["h"]))

        guard wanted else {
            guard live else { return }
            live = false
            drawn = ""
            field.resignFirstResponder()
            shrink()
            return
        }

        // Everything but the text, for the comment bar's reason: what the reader
        // has typed belongs to this side while it has the caret, and echoing it
        // back would fight the cursor.
        let signature = spec.filter { $0.key != "text" && $0.key != "live" }
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=" + String(describing: $0.value) }
            .joined(separator: "|")
        if signature != drawn {
            drawn = signature
            let ink = (spec["ink"] as? String).flatMap(TriaChromeBar.color(fromHex:)) ?? .label
            let muted = (spec["muted"] as? String)
                .flatMap(TriaChromeBar.color(fromHex:)) ?? .secondaryLabel
            field.font = TriaPostBarPill.face
            field.textColor = ink
            field.tintColor = (spec["caret"] as? String)
                .flatMap(TriaChromeBar.color(fromHex:)) ?? ink
            field.accessibilityLabel = spec["label"] as? String
            // The web's placeholder is --muted at 0.6, baked into the colour so
            // the string composites once.
            field.attributedPlaceholder = NSAttributedString(
                string: spec["placeholder"] as? String ?? "",
                attributes: [.font: TriaPostBarPill.face,
                             .foregroundColor: muted.withAlphaComponent(0.6)])
            close.accessibilityLabel = spec["closeLabel"] as? String
            if let mark = spec["closeGlyph"] as? String, !mark.isEmpty {
                close.setImage(TriaSVG.image(markup: mark, size: 24, ink: ink, template: false),
                               for: .normal)
            }
            fieldInset = CGRect(x: TriaToolbar.number(spec["fieldLeft"]), y: 0,
                                width: TriaToolbar.number(spec["fieldRight"]), height: 0)
            closeSide = TriaToolbar.number(spec["closeSize"], fallback: 44)
            closeRight = TriaToolbar.number(spec["closeRight"])
        }
        if let text = spec["text"] as? String, text != field.text, !field.isFirstResponder {
            field.text = text
        }

        if !live {
            live = true
            // Focus is opt-OUT, and the caller is the tag rail: tapping a tag
            // runs its query and should show you the results, not raise a
            // keyboard over them. Read only on the frame the bar opens, so a
            // later push cannot re-take a caret the reader put down.
            grow(focus: spec["focus"] as? Bool ?? true)
        } else {
            frame = openFrame
            setNeedsLayout()
        }
    }

    /// Text the web wrote while this field is up — a tag tapped on the rail,
    /// which is a shortcut into search and puts its own words in the box.
    func setText(_ text: String) {
        guard field.text != text else { return }
        field.text = text
    }

    // MARK: The growth

    private func grow(focus: Bool) {
        isHidden = false
        frame = closedFrame
        alpha = 1
        setNeedsLayout()
        layoutIfNeeded()
        let settle = { self.frame = self.openFrame; self.layoutIfNeeded() }
        if UIAccessibility.isReduceMotionEnabled {
            settle()
        } else {
            // The stylesheet's own ramp for this control (--dur-move, --ease),
            // which is what the CSS shell travelled on before native drew it.
            UIView.animate(withDuration: 0.36, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState,
                                     .curveEaseOut], animations: settle)
        }
        if focus { field.becomeFirstResponder() }
    }

    private func shrink() {
        let settle = {
            self.frame = self.closedFrame
            self.alpha = 0
            self.layoutIfNeeded()
        }
        guard !UIAccessibility.isReduceMotionEnabled else {
            settle(); isHidden = true; return
        }
        UIView.animate(withDuration: 0.36, delay: 0,
                       options: [.allowUserInteraction, .beginFromCurrentState,
                                 .curveEaseOut], animations: settle) { _ in
            // Only if nothing re-opened it in the meantime.
            if !self.live { self.isHidden = true }
        }
    }

    // MARK: Geometry

    /// Where the text starts and how much room the mark leaves it, both measured
    /// off `.toolbar-search-field`'s own padding on the web side. `x` is the left
    /// inset and `width` the right one — a rect used as a pair of numbers, so the
    /// two travel together.
    private var fieldInset = CGRect(x: 16, y: 0, width: 48, height: 0)
    private var closeSide: CGFloat = 44
    private var closeRight: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        let box = contentView.bounds
        close.bounds = CGRect(x: 0, y: 0, width: closeSide, height: closeSide)
        close.center = CGPoint(x: box.width - closeRight - closeSide / 2, y: box.midY)
        let left = fieldInset.minX
        field.frame = CGRect(x: left, y: 0,
                             width: max(0, box.width - left - fieldInset.width),
                             height: box.height)
    }

    // MARK: Typing

    @objc private func edited() { onText?(field.text ?? "") }

    @objc private func closeTapped() {
        field.resignFirstResponder()
        onClose?()
    }

    func textFieldDidBeginEditing(_ textField: UITextField) { dismisser?.arm(true) }

    func textFieldDidEndEditing(_ textField: UITextField) {
        dismisser?.arm(false)
        // Only while the bar is still open. A close tears the field down and
        // resigns on the way, and that blur is the shutting rather than a
        // reader stepping off a field they left words in.
        if live { onBlur?() }
    }

    /// Return puts the keyboard away and leaves the query standing. There is
    /// nothing to submit — the grid has been rebuilding on every letter.
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return false
    }
}

// MARK: - Menus

/// One drawing of a Tria menu, used by both things that can drop one: a toolbar
/// glyph (`TriaToolbar`) and a control on the page itself (`TriaAnchoredMenu`).
///
/// It was a private method on the toolbar until the post card's ••• and the
/// profile's colour picker went native too. Nothing about a row is about the
/// top bar — the rows arrive fully described, in the vocabulary of whoever built
/// them — so leaving the builder in one of its two callers would have meant the
/// other one copying it, which is the one thing this whole file is arranged to
/// avoid.
@available(iOS 26.0, *)
enum TriaMenu {

    /// What an un-picked member of a radio set fades its mark to. It matches
    /// the 0.48 the web card pulls a whole un-picked row back to; the row here
    /// is only the mark, and a mark alone has to sit a touch stronger than a
    /// mark with a dimmed label beside it or the column reads as disabled.
    static let fade: CGFloat = 0.55

    /// One row per item, gathered into inline sections by `group` so a switch
    /// and a radio set can share a menu without reading as one list — which is
    /// the same split the web card draws with `role="menuitem"` beside
    /// `role="menuitemradio"`.
    ///
    /// A RADIO SET IS DRAWN BY WHAT FADED, not by a checkmark, which is the
    /// call the web card makes too (see .bar-menu-item[role="menuitemradio"] in
    /// app.css). Here it reaches only as far as the MARK: a menu row's title
    /// has no alpha, and `.disabled` — the one attribute that would dim it —
    /// also stops the row being tappable, which is the opposite of what an
    /// un-picked filter is. So the un-picked rows' glyphs come through at
    /// `fade` and their labels stand at full strength. In this menu the mark is
    /// the hue and the hue is the subject, so the column of them carries it;
    /// where a set's rows have no marks it would carry nothing, and the honest
    /// fix then is a set that isn't drawn as a menu.
    ///
    /// `.singleSelection` goes with the tick. It is the option that DRAWS one,
    /// and asking for the semantics without the drawing isn't something the API
    /// offers — so the set is stated by `radio` on this side and spent on the
    /// fade instead.
    ///
    /// `pick` is handed the row's INDEX in the array that came in, and nothing
    /// else. Which menu that index belongs to is the caller's business, and the
    /// callers disagree about it: the toolbar answers with the control's id, the
    /// anchored host with the token it was presented under.
    static func elements(from items: [[String: Any]],
                         pick: @escaping (Int) -> Void) -> [UIMenuElement] {
        var order: [Int] = []
        var buckets: [Int: [UIMenuElement]] = [:]
        for (index, item) in items.enumerated() {
            let group = Int(TriaToolbar.number(item["group"]))
            if buckets[group] == nil {
                buckets[group] = []
                order.append(group)
            }
            var attributes: UIAction.Attributes = []
            // `danger` is the web's coral row, and the system's destructive red
            // is the same statement in the system's own voice. It also takes the
            // row's image with it, which is why no ink is sent for one.
            if item["danger"] as? Bool == true { attributes.insert(.destructive) }
            let ink = (item["ink"] as? String).flatMap(TriaChromeBar.color(fromHex:))
            let markup = item["icon"] as? String ?? ""
            // Template where the row's mark has one colour and something else
            // is choosing it — a type row takes its hue's ink, a destructive
            // row takes the system's red, and a row with neither takes the
            // menu's own. NOT where the drawing names its own colours: the All
            // row is the quintet, five hues in one mark, and a template would
            // flatten it to one. A colour swatch is the same case as All: the
            // whole point of the row is the colour it is painted in.
            var image = markup.isEmpty ? nil : TriaSVG.image(
                markup: markup, size: 22, ink: ink ?? .label,
                template: attributes.contains(.destructive)
                    || (ink == nil && !TriaSVG.carriesColour(markup)))
            // A member of a set that isn't the live one. Nothing outside a set
            // ever fades: an action row is not a candidate and has no vote to
            // have lost.
            if item["radio"] as? Bool == true, item["checked"] as? Bool != true {
                image = image?.faded(fade)
            }
            let action = UIAction(title: item["label"] as? String ?? "",
                                  image: image,
                                  attributes: attributes
            ) { _ in pick(index) }
            buckets[group]?.append(action)
        }

        return order.map { group in
            UIMenu(title: "", options: [.displayInline], children: buckets[group] ?? [])
        }
    }
}

/// What the plugin is allowed to say to the anchored menus. Availability-free
/// for the same reason the other two protocols in here are.
protocol TriaAnchoredControl: AnyObject {
    func present(token: Int, rect: CGRect, label: String, items: [[String: Any]])
    /// Take the menu down without a pick. See `TriaAnchoredMenu.dismiss`.
    func dismiss()
}

/// A MENU DROPPED BY A CONTROL ON THE PAGE, rather than by one in the top bar.
///
/// As of 2026-08-30 the post card's ••• and the repost circle beside it went
/// back to raising a sheet from the web side (see docs/native-chrome.md); the
/// profile's colour picker is the only caller left that reaches this class.
///
/// The post card's •••, the repost circle beside it and the profile's colour
/// picker all used to throw an action sheet up from the bottom of the screen,
/// which was the right answer while every one of them was a web drawing: a card
/// hung off a button at an arbitrary scroll position lands anywhere between
/// mid-screen and the gutter, so the same tap produced a different-shaped thing
/// each time. A real `UIMenu` doesn't have that problem — the system flips it,
/// scrolls it and clips it to the safe area itself — so with the material going
/// native the argument for the sheet went with it.
///
/// THE DIRECTION OF THE CALL IS THE OPPOSITE OF THE TOOLBAR'S, and that is the
/// only structural difference. A toolbar menu is opened by the system and then
/// asks the web what is in it (`UIDeferredMenuElement`; see `attachMenu`).
/// Here the WEB starts it — the finger landed on a web button, the page ran its
/// own handler and built the list — so the rows arrive with the request and
/// there is nothing to defer.
///
/// It hosts ONE invisible button, moved to whichever rect app.js measured, and
/// asks it to perform its primary action. The button is never touched: the host
/// answers `false` to every hit test, so the page underneath keeps every tap
/// and scroll it had. Presentation doesn't need a hit — the menu is put up by
/// UIKit in its own window, which is also why the native chrome cannot draw
/// over it the way it drew over the web's sheets.
///
/// WHERE THE MENU LANDS IS UIKIT'S, AND THE RECT IS THE ONLY THING IT LISTENS
/// TO. There is no placement API on a `UIButton`'s menu and no public way to
/// present a menu at a point (`UIContextMenuInteraction` has `dismissMenu` and
/// nothing to open one with), so the button's frame is the whole vocabulary.
/// Measured on the simulator, iOS 26, with the frame logged beside the result:
///
/// - A control in the UPPER part of the screen drops its menu DOWNWARD, and the
///   menu's top leading corner lands on the control's: anchor at x 19.6, menu at
///   x 20.7. That corner is the one the reader tapped, so the menu covers it.
/// - A control LOW on the screen opens UPWARD instead, and the menu's bottom
///   edge comes to rest on the control's bottom — but the horizontal alignment
///   is gone. Two anchors 280pt apart put their menus 4pt apart, in the same
///   fixed box near the middle of the screen. The repost circle rides the right
///   end of the action row and happens to sit under that box's trailing edge;
///   the ••• at the card's left inset does not, and cannot be brought there.
/// - A TALL anchor (the trick of running the rect to the bottom of the screen to
///   leave no room below and force the flip) is worse than the thing it was
///   trying to fix: UIKit does not flip, it clamps, and the menu ends up pinned
///   to the safe area with nothing beside it. The rect stays the control's.
@available(iOS 26.0, *)
final class TriaAnchoredMenu: UIView, TriaAnchoredControl {

    var onPick: ((Int, Int) -> Void)?

    private let anchor = UIButton(type: .custom)
    private var token = 0

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        isUserInteractionEnabled = true
        anchor.showsMenuAsPrimaryAction = true
        // THE FIRST ROW IS THE NEAREST ROW. `.priority` reads the list as "most
        // likely first" and lets the system decide which end of the menu that is:
        // a menu that opens downward puts row one at the top, one that opens
        // upward puts it at the bottom, and either way it is the row beside the
        // glyph that was tapped. That is what makes tapping the repost circle
        // twice a repost, and the ••• twice a copied link. Named rather than left
        // `.automatic`, because these menus depend on it and a default that
        // happens to agree is not a contract.
        anchor.preferredMenuElementOrder = .priority
        // Nothing to see: the glass the reader tapped is the web's or the
        // toolbar's, and this is only the point the menu hangs from.
        anchor.backgroundColor = .clear
        addSubview(anchor)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func install(in host: UIView) {
        frame = host.bounds
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(self)
    }

    func present(token: Int, rect: CGRect, label: String, items: [[String: Any]]) {
        self.token = token
        // A zero rect would hang the menu off the top-left corner. The caller
        // measured a real control, so this only fires when a spec arrives
        // malformed, and doing nothing beats dropping a menu in the corner.
        guard rect.width > 0, rect.height > 0, !items.isEmpty else { return }
        anchor.frame = rect
        anchor.menu = UIMenu(title: label, children: TriaMenu.elements(from: items) {
            [weak self] index in
            guard let self else { return }
            self.onPick?(self.token, index)
        })
        anchor.performPrimaryAction()
    }

    /// TAKE THE MENU DOWN, because the thing it is pointing at has moved.
    ///
    /// A `UIMenu` is placed ONCE, against the rect it was handed, in a window of
    /// UIKit's own above the web view — and it does not follow anything after
    /// that. For a menu hung off a native control that is the end of the story,
    /// because the control cannot move while the menu is up. For one hung off a
    /// CARD it is not: the feed is live HTML, and a photo above the fold
    /// resolving its height, or a refresh repainting a row, moves every card
    /// below it while the menu stays exactly where it was put. What the reader
    /// sees is a menu floating over an unrelated post with nothing pointing at
    /// it, which is what this used to do and the whole reason this method
    /// exists.
    ///
    /// `UIContextMenuInteraction.dismissMenu()` is the public way to do it, and
    /// it is reached through the button's OWN interaction rather than one of
    /// ours — becoming the delegate would mean taking over the presentation the
    /// button is already doing correctly. If the button has not got one (no menu
    /// is up), the chain is nil and this is a no-op, which is the right answer.
    func dismiss() {
        anchor.interactions
            .compactMap { $0 as? UIContextMenuInteraction }
            .first?
            .dismissMenu()
    }

    /// Transparent to touch, always. See the class note: this view exists to be
    /// a coordinate, not a control.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }
}

// MARK: - Getting off a keyboard

/// THE TWO WAYS DOWN OFF A KEYBOARD NATIVE CHROME RAISED.
///
/// Both of Tria's native fields — the comment bar's `UITextView` and the search
/// capsule's `UITextField` — float OVER the web view. That is what makes them
/// work (a hidden web field cannot hold a caret, and a keyboard raised for one
/// is positioned against the web view rather than against the bar sitting on
/// it), and it is also what takes away the exit every web field gets for free:
/// on the web a tap on the page blurs the field and the keyboard goes, but here
/// a tap outside the control is handed straight to a page that has no focus to
/// lose, so nothing happens at all.
///
/// So both are borrowed from THE WEB VIEW'S OWN SCROLLER rather than built over
/// the top of it, which is what keeps a drag a drag and leaves every tap the
/// page cares about deliverable:
///
/// - `.interactive` is the Messages gesture. Pull the page down and the keyboard
///   follows the finger, with the bar riding it (see `keyboardLayoutGuide`).
/// - The tap recognizer sits on the scroller, so it never sees a touch that
///   hit-tested to one of our own views — those are siblings over the web view,
///   not subviews of it. It DOES swallow the touch it does see, deliberately: a
///   tap meant to put a keyboard away should not also open what it landed on.
///
/// Armed only while a field actually holds the caret, so the page keeps all of
/// its own taps the rest of the time.
final class TriaKeyboardDismisser: NSObject {

    private weak var scroller: UIScrollView?
    private var tap: UITapGestureRecognizer?
    private let dismiss: () -> Void

    init(scroller: UIScrollView?, dismiss: @escaping () -> Void) {
        self.scroller = scroller
        self.dismiss = dismiss
        super.init()
        guard let scroller else { return }
        let recognizer = UITapGestureRecognizer(target: self, action: #selector(tapped))
        recognizer.cancelsTouchesInView = true
        recognizer.isEnabled = false
        scroller.addGestureRecognizer(recognizer)
        tap = recognizer
    }

    func arm(_ editing: Bool) {
        tap?.isEnabled = editing
        scroller?.keyboardDismissMode = editing ? .interactive : .none
    }

    @objc private func tapped() { dismiss() }
}

// MARK: - The comment bar

/// What the plugin is allowed to say to the comment bar. Availability-free for
/// the reason the other three protocols in here are.
protocol TriaPostBarControl: AnyObject {
    func apply(spec: [String: Any])
    func setText(_ text: String, selection: Int, focus: Bool)
}

/// A POST'S COMMENT BAR AND A CIRCLE'S FIND BAR — THE PIECE OF CHROME THAT HOLDS
/// A CARET.
///
/// The tab bar and the toolbar are buttons: native wears their face, a tap
/// crosses back, and the web element that was always the implementation runs.
/// This one cannot work that way, because the thing it renders is a *keyboard*.
/// A hidden web textarea can't be focused, an iOS software keyboard raised for a
/// web field is positioned against the web view rather than against us, and the
/// bar's whole job is to sit on top of the keys. So the FIELD is real UIKit: a
/// `UITextView` the reader actually types into, and the keyboard is the system's
/// own, tracked by `keyboardLayoutGuide` rather than by the `visualViewport`
/// arithmetic app.js has to do for the other two shells.
///
/// AND THE MODEL IS STILL THE WEB'S. Every keystroke goes straight back over the
/// bridge and is written into the textarea that is still sitting in the DOM,
/// which then dispatches its own `input` — so the mention picker, the send
/// disc's idle state, the 300 cap, `Store.addComment`, the confetti and every
/// error path are the code that already shipped, running unchanged. Nothing in
/// this file knows what a mention is, what a comment costs, or that the thing
/// being typed is going anywhere. It knows a string and a caret.
///
/// THE MENTION PICKER STAYS WEB, and that is the line rather than an omission.
/// It is a filtered list of the reader's FRIENDS: to draw it here, this file
/// would have to be told who those are, which is precisely the app vocabulary
/// the 1.4 contract keeps off this bridge. It opens upward out of the bar as it
/// always did, positioned against a lift this class measures and reports (see
/// `onLift` and `--native-postbar-lift`).
///
/// AND IT IS A CIRCLE'S FIND BAR TOO. The same host, the same keyboard guide,
/// the same ways down; the pill inside it swaps its two ends and its field (see
/// `TriaPostBarPill`). It was left web at first on the argument that it had
/// nothing to gain — no mention picker, no growth, no send — and that looked at
/// the wrong half of the bar. What makes this class necessary is not what the
/// bar grows into, it is that the bar sits ON the keys, and a keyboard raised
/// for a web field is positioned against the web view. So the find bar was
/// chasing its keyboard a `visualViewport` resize at a time while the bar one
/// page away rode it, and the same pill visibly stopped being glass when a
/// reader walked from a thread to a circle.
@available(iOS 26.0, *)
final class TriaPostBar: UIView, TriaPostBarControl {

    /// The caret moved or the text changed. `(text, caret)`.
    var onText: ((String, Int) -> Void)?
    /// The send disc was tapped. The web form is what actually posts.
    var onSend: (() -> Void)?
    /// The field took or gave up first responder. Focus is what walks a post's
    /// page back to its thread, and that walk is the web's.
    var onFocus: ((Bool) -> Void)?
    /// Window bottom to the top of the pill, so the web can hang the mention
    /// list off a bar it no longer draws.
    var onLift: ((CGFloat) -> Void)?
    /// The face was tapped while typing: the words are gone and the keyboard is
    /// down, and the web's copy has to catch up.
    var onDiscard: (() -> Void)?
    /// The photo button was tapped. The web's file input is what opens the
    /// picker, and the web's tray is what holds the picture.
    var onPick: (() -> Void)?

    private let pill = TriaPostBarPill()
    private weak var host: UIView?
    /// The two ways down off the keyboard this bar raises. See
    /// `TriaKeyboardDismisser`.
    private var dismisser: TriaKeyboardDismisser?

    private var widthConstraint: NSLayoutConstraint?
    private var heightConstraint: NSLayoutConstraint?
    private var bottomConstraint: NSLayoutConstraint?

    /// `.postbar`'s own padding above the safe area, and the smaller one it drops
    /// to while a keyboard is up (`body.postbar-kb`). Both measured on the web
    /// side; both meaningless until the first `apply`.
    private var float: CGFloat = 9.6
    private var floatKeyboard: CGFloat = 8

    /// WHERE THE TAB BAR SITS, from the foot of the screen to the foot of its
    /// capsule: measured off iOS 26's own bar on a 17 Pro. A post page has no
    /// tab bar, and the pill floating `float` above the home indicator's strip
    /// read as hovering ~20pt higher than the capsule it takes the place of. On
    /// a screen with no home indicator there is no strip to sink into, and the
    /// web's float stands.
    private static let dock: CGFloat = 22

    private var keyboardUp = false
    private var lastLift: CGFloat = -1
    private var live = false
    /// The last spec, so a push that changes nothing costs no relayout. The text
    /// is deliberately NOT in it: what the reader has typed is this view's, and a
    /// push that echoed it back would fight the caret.
    private var drawn = ""

    init() {
        // A PLAIN HOST, not a glass container. The two bars above are containers
        // because they hold several glass elements that have to render as one
        // system; this holds exactly one (the send disc is a thinned fill, not a
        // sample), so a container would buy nothing — and it would cost the one
        // thing this view has to have. A UIVisualEffectView puts its children in
        // `contentView`, so when the keyboard moves the pill it is contentView
        // that lays out, not this view, and `layoutSubviews` here — where the
        // lift the web hangs its mention list off is measured — never ran. The
        // list opened at a figure from before the keyboard.
        super.init(frame: .zero)
        backgroundColor = .clear
        isUserInteractionEnabled = true
        pill.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pill)
        pill.onChange = { [weak self] in self?.resize() }
        pill.onSend = { [weak self] in self?.onSend?() }
        pill.onText = { [weak self] text, caret in self?.onText?(text, caret) }
        pill.onDiscard = { [weak self] in self?.onDiscard?() }
        pill.onPick = { [weak self] in self?.onPick?() }
        pill.onFocus = { [weak self] focused in
            self?.armDismissal(focused)
            self?.onFocus?(focused)
        }
        let centre = NotificationCenter.default
        centre.addObserver(self, selector: #selector(keyboardShown),
                           name: UIResponder.keyboardWillShowNotification, object: nil)
        centre.addObserver(self, selector: #selector(keyboardHidden),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func install(in host: UIView, scroller: UIScrollView?) {
        frame = host.bounds
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(self)
        self.host = host
        // Tap the page or drag it and the keyboard goes, leaving the words. It
        // is the third way out of this bar and the mildest — the face discards,
        // the disc posts, and this one just puts the keys away. See
        // TriaKeyboardDismisser for why it had to be built at all.
        dismisser = TriaKeyboardDismisser(scroller: scroller) { [weak self] in
            self?.pill.stopEditing()
        }
        let width = pill.widthAnchor.constraint(equalToConstant: 0)
        let height = pill.heightAnchor.constraint(equalToConstant: 0)
        // THE KEYBOARD, WITHOUT ARITHMETIC. `keyboardLayoutGuide` is the top of
        // the keyboard while one is up and the bottom of the safe area while one
        // isn't, which is exactly the two states `--postbar-lift` and
        // `body.postbar-kb` between them describe on the web — except that here
        // it is the same value the system is animating, so the bar rides the
        // keyboard rather than chasing it a resize step at a time.
        let bottom = pill.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor,
                                                  constant: restConstant())
        NSLayoutConstraint.activate([
            pill.centerXAnchor.constraint(equalTo: centerXAnchor),
            width, height, bottom
        ])
        widthConstraint = width
        heightConstraint = height
        bottomConstraint = bottom
    }

    // MARK: State

    func apply(spec: [String: Any]) {
        let wanted = spec["live"] as? Bool ?? false
        float = TriaToolbar.number(spec["float"], fallback: 9.6)
        floatKeyboard = TriaToolbar.number(spec["floatKeyboard"], fallback: 8)
        bottomConstraint?.constant = keyboardUp ? -floatKeyboard : restConstant()

        if !wanted {
            // Leaving the page. Give the keyboard back before going, or it stays
            // up over whatever the router lands on next.
            live = false
            drawn = ""
            pill.stopEditing()
            isHidden = true
            lastLift = -1
            return
        }

        let signature = spec.filter { $0.key != "text" }
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=" + String(describing: $0.value) }
            .joined(separator: "|")
        if signature != drawn {
            drawn = signature
            pill.apply(spec: spec)
            widthConstraint?.constant = TriaToolbar.number(spec["width"], fallback: 0)
        }
        if let text = spec["text"] as? String, !live { pill.setText(text, selection: text.count) }
        live = true
        isHidden = false
        resize()
    }

    /// The web writing back into the field — a mention picked out of the web's
    /// own popover, or the form clearing itself once a comment has posted.
    /// `focus` is not "leave it alone" when false — it is the other direction:
    /// a posted comment asks for the keyboard back the same way the discard
    /// mark does.
    func setText(_ text: String, selection: Int, focus: Bool) {
        pill.setText(text, selection: selection)
        if focus { pill.startEditing() } else { pill.stopEditing() }
        resize()
    }

    // MARK: Geometry

    /// The bar is as tall as its text, up to the cap, and the number is the
    /// stylesheet's own arithmetic run against a real line count.
    ///
    /// No layout pass first: the width the measurement needs is the one app.js
    /// measured off the field itself, so this is true on the frame the spec
    /// lands rather than a frame after it.
    private func resize() {
        guard live else { return }
        let height = pill.desiredHeight()
        guard let constraint = heightConstraint, abs(constraint.constant - height) > 0.5 else { return }
        constraint.constant = height
        setNeedsLayout()
    }

    /// The lift is reported from HERE rather than from `resize`, because the
    /// number is only true once the constraints have actually resolved — and
    /// because the keyboard moves the pill without anything in this file being
    /// asked to. Guarded on a real change, so riding a keyboard animation costs
    /// a compare per frame.
    override func layoutSubviews() {
        super.layoutSubviews()
        guard live else { return }
        let lift = max(0, bounds.height - pill.frame.minY)
        guard abs(lift - lastLift) > 0.5 else { return }
        lastLift = lift
        onLift?(lift)
    }

    /// Only the pill is a control. Everything around it is the page, which still
    /// scrolls under a bar that is floating over it.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        !isHidden && pill.frame.contains(point)
    }

    // MARK: The keyboard

    private func armDismissal(_ editing: Bool) { dismisser?.arm(editing) }

    @objc private func keyboardShown() {
        keyboardUp = true
        bottomConstraint?.constant = -floatKeyboard
    }

    @objc private func keyboardHidden() {
        keyboardUp = false
        bottomConstraint?.constant = restConstant()
    }

    /// At rest the keyboard guide's top is the safe area's foot, so sinking the
    /// pill to the tab bar's line is a constant BELOW that guide.
    private func restConstant() -> CGFloat {
        let safe = host?.safeAreaInsets.bottom ?? 0
        return safe > Self.dock ? safe - Self.dock : -float
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        if !keyboardUp { bottomConstraint?.constant = restConstant() }
    }
}

/// The pill itself: the avatar, the field and the send disc, laid out from the
/// numbers app.js measured off the stylesheet.
///
/// AND IT IS TWO BARS, because the stylesheet says they are one. A post page's
/// COMMENT BAR and a circle's FIND BAR are the same pill with their two ends
/// swapped — the leading avatar becomes a magnifier on the avatar's own box and
/// datum, and the send disc becomes a bare clear at the send's own 44 — so the
/// glass, the corner, the keyboard tracking, the idle fade and every box in the
/// spec are shared, and `find` switches the two ends and nothing else.
///
/// The one part that is not a swap is the FIELD. A comment grows to four lines
/// and a search does not grow at all: on the web that is a `<textarea>` and an
/// `<input>`, and here it is a `UITextView` and a `UITextField`. Holding both
/// and showing one is smaller than it looks and much smaller than the
/// alternative — a `UITextView` pinned to a single line either wraps a long
/// query out of sight or has to be taught to scroll sideways, which is the one
/// thing a text field already is.
///
/// EVERY NUMBER IN HERE ARRIVES FROM THE WEB, and it arrives as a BOX rather
/// than as a rule. `.postbar-form` derives its shape from itself — the field is
/// as tall as the send disc at one line, the corner is that disc's radius plus
/// the padding around it, the avatar's datum is the field's own padding plus
/// half a line plus an optical constant nobody can re-derive — and a Swift copy
/// of that arithmetic would be a second place for it to drift. Reading the
/// custom properties back wouldn't help: an unregistered one computes to its own
/// token stream, so `--postbar-field-pad` comes back as the literal `calc(…)`.
/// So app.js measures the laid-out elements and sends where each one landed, and
/// the only sum left here is the growth — whose every term was measured over
/// there too.
@available(iOS 26.0, *)
final class TriaPostBarPill: UIVisualEffectView, UITextViewDelegate, UITextFieldDelegate {

    var onChange: (() -> Void)?
    var onSend: (() -> Void)?
    var onText: ((String, Int) -> Void)?
    var onFocus: ((Bool) -> Void)?
    /// The face tapped while typing. The field is emptied and the keyboard given
    /// back here; this is only the web being told to empty its copy.
    var onDiscard: (() -> Void)?
    /// The photo button. A tap and nothing else: the picker, the checks and the
    /// thumbnail are all the web's (see `postBarHooks.pick` in app.js).
    var onPick: (() -> Void)?

    /// Oxygen 400 at the 16pt the field pins itself to — the iOS auto-zoom floor
    /// on the web, and here simply the size the reader is used to. Same story as
    /// `TriaToolbarButton.pill`: a real copy of the face in the App target
    /// (Oxygen-Regular.ttf, declared in UIAppFonts), because CoreText cannot
    /// register the woff2 the stylesheet loads, and a system fallback that still
    /// draws a usable field if the file didn't make it in.
    static let face: UIFont = UIFont(name: "Oxygen-Regular", size: 16)
        ?? .systemFont(ofSize: 16)

    private let photo = UIImageView()
    private let monogram = UILabel()
    /// The close mark the face turns into once the caret is in the field, and
    /// the (invisible, 44pt) target over the whole group. `.postbar-face` on the
    /// web: at rest a portrait that takes no taps, typing a way out that empties
    /// the bar and gives the keyboard back.
    private let faceMark = UIImageView()
    private let faceButton = UIButton(type: .custom)
    private let field = UITextView()
    /// The find bar's field. See the note on the class: a search does not grow,
    /// and a one-line box that scrolls sideways under the caret is what a text
    /// field already is. Only one of the two is ever on screen (`find`).
    private let oneLine = UITextField()
    private let hint = UILabel()
    /// NOT GLASS, and that is the stylesheet's rule rather than a saving. The
    /// disc sits on a surface that already blurs, and a sample of its own would
    /// be the one stack "never glass on glass" has never allowed — which is
    /// exactly what it looked like when it was one: a soft blue halo instead of
    /// a disc. On the web it is `.publish-fill.is-solid` thinned to --pill-alpha
    /// over the page, so here it is the band at that same alpha.
    private let disc = UIView()
    /// The band, painted rather than tinted, and the one place `TriaBandRamp`
    /// still draws an accent. The disc is not glass, so it takes no argument
    /// from the material and none of `TriaBand`'s three answers: this is
    /// `.publish-fill.is-solid` at --pill-alpha, every stop of it, over the
    /// pill's own blur, which is what the web draws.
    private let discRamp = TriaBandRamp()
    private let send = UIButton(type: .custom)
    /// A PHOTO OR A GIF. A bare mark on the pill's glass, `.postbar-pick` on the
    /// web: it stands in the disc's slot while the disc is idle and steps aside
    /// by `pickShift` once there is something to send, the same move the web
    /// plays with a transform. The comment bar's alone; a find bar sends a size
    /// of 0 and it stays hidden.
    private let pick = UIButton(type: .custom)
    private var pickLeft: CGFloat = 0
    private var pickSide: CGFloat = 0
    private var pickShift: CGFloat = 0
    /// A picture is waiting in the web's tray. It lights the disc on its own,
    /// because a photo with no words is still a comment.
    private var attached = false

    /// Every one of these is a MEASUREMENT that arrived from app.js, not a
    /// number decided here. The defaults are only what the view draws in the
    /// frame before the first spec lands. See the note on `TriaPostBar`.
    private var pad: CGFloat = 6.4
    private var fieldPad: CGFloat = 10.8
    private var line: CGFloat = 22.4
    private var maxLines: CGFloat = 4
    private var faceBox = CGRect(x: 11.2, y: 17.2, width: 26, height: 26)
    private var textLeft: CGFloat = 50
    private var textWidth: CGFloat = 200
    private var discSide: CGFloat = 44
    private var discRight: CGFloat = 8
    private var discBottom: CGFloat = 6.4
    private var limit = 300
    private var idle = true
    private var typing = false
    /// Which of the two jobs this pill is doing. `kind` in the spec, and the one
    /// thing on this bridge that is a branch rather than a measurement.
    private var find = false
    /// The face, the colour and the pinned line box, held rather than read back
    /// off the field: assigning `attributedText` resets `typingAttributes` to
    /// whatever sits at the end of the new string, which for an empty field is
    /// the system defaults. So this is the one copy, and every write restates it.
    private var attrs: [NSAttributedString.Key: Any] = [:]

    init() {
        super.init(effect: UIGlassEffect(style: .regular))
        (effect as? UIGlassEffect)?.isInteractive = true

        photo.contentMode = .scaleAspectFill
        photo.clipsToBounds = true
        photo.isHidden = true
        monogram.textAlignment = .center
        monogram.clipsToBounds = true
        contentView.addSubview(monogram)
        contentView.addSubview(photo)
        faceMark.contentMode = .center
        faceMark.alpha = 0
        contentView.addSubview(faceMark)
        faceButton.addTarget(self, action: #selector(faceTapped), for: .touchUpInside)
        faceButton.isUserInteractionEnabled = false
        faceButton.accessibilityElementsHidden = true
        contentView.addSubview(faceButton)

        field.backgroundColor = .clear
        field.textContainerInset = .zero
        field.textContainer.lineFragmentPadding = 0
        field.showsVerticalScrollIndicator = false
        field.showsHorizontalScrollIndicator = false
        field.delegate = self
        // NEVER GLASS ON GLASS: the field sits on a surface that already blurs,
        // so it takes no material of its own. The web rule, restated.
        contentView.addSubview(field)

        // The find bar's field, built to the same rule and hidden until a bar
        // asks for it. `borderStyle = .none` is the UITextField half of the
        // stylesheet's `-webkit-appearance: none`: a text field arrives with a
        // border and a rounded corner of its own, on a surface that already has
        // both.
        oneLine.borderStyle = .none
        oneLine.backgroundColor = .clear
        oneLine.delegate = self
        oneLine.isHidden = true
        oneLine.addTarget(self, action: #selector(lineEdited), for: .editingChanged)
        contentView.addSubview(oneLine)

        hint.isUserInteractionEnabled = false
        contentView.addSubview(hint)

        disc.layer.cornerCurve = .continuous
        send.translatesAutoresizingMaskIntoConstraints = false
        disc.addSubview(send)
        // Under the arrow, not over it.
        disc.insertSubview(discRamp, at: 0)
        NSLayoutConstraint.activate([
            discRamp.leadingAnchor.constraint(equalTo: disc.leadingAnchor),
            discRamp.trailingAnchor.constraint(equalTo: disc.trailingAnchor),
            discRamp.topAnchor.constraint(equalTo: disc.topAnchor),
            discRamp.bottomAnchor.constraint(equalTo: disc.bottomAnchor),
            send.leadingAnchor.constraint(equalTo: disc.leadingAnchor),
            send.trailingAnchor.constraint(equalTo: disc.trailingAnchor),
            send.topAnchor.constraint(equalTo: disc.topAnchor),
            send.bottomAnchor.constraint(equalTo: disc.bottomAnchor)
        ])
        send.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        pick.addTarget(self, action: #selector(pickTapped), for: .touchUpInside)
        pick.isHidden = true
        // Under the disc: while idle the two share a slot, and the disc is the
        // one that has to win once it is there.
        contentView.addSubview(pick)
        contentView.addSubview(disc)
        setIdle(true, animated: false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: State

    func apply(spec: [String: Any]) {
        // WHICH BAR, FIRST, because everything below reads it. A page can only
        // ever mount one of the two, and `TriaPostBar` tears the pill's state
        // down between routes, so this flips at most once per navigation.
        let wantsFind = (spec["kind"] as? String) == "find"
        if wantsFind != find {
            find = wantsFind
            field.isHidden = find
            oneLine.isHidden = !find
            // The leading end goes back to rest whichever way the swap runs. The
            // mark is about to become a different mark, and a bar the reader
            // left with a keyboard up is mid-morph: without this, a find bar
            // inherits a magnifier lying on its side at zero alpha, and a
            // comment bar inherits a discard X standing over a resting thread.
            resetFace()
        }
        pad = TriaToolbar.number(spec["pad"], fallback: pad)
        fieldPad = TriaToolbar.number(spec["fieldPad"], fallback: fieldPad)
        line = TriaToolbar.number(spec["line"], fallback: line)
        maxLines = TriaToolbar.number(spec["maxLines"], fallback: maxLines)
        faceBox = CGRect(x: TriaToolbar.number(spec["faceLeft"], fallback: faceBox.minX),
                         y: TriaToolbar.number(spec["faceTop"], fallback: faceBox.minY),
                         width: TriaToolbar.number(spec["faceSize"], fallback: faceBox.width),
                         height: TriaToolbar.number(spec["faceSize"], fallback: faceBox.height))
        textLeft = TriaToolbar.number(spec["textLeft"], fallback: textLeft)
        textWidth = TriaToolbar.number(spec["textWidth"], fallback: textWidth)
        discSide = TriaToolbar.number(spec["discSize"], fallback: discSide)
        discRight = TriaToolbar.number(spec["discRight"], fallback: discRight)
        discBottom = TriaToolbar.number(spec["discBottom"], fallback: discBottom)
        limit = spec["maxLength"] as? Int ?? limit
        pickLeft = TriaToolbar.number(spec["pickLeft"], fallback: 0)
        pickSide = TriaToolbar.number(spec["pickSize"], fallback: 0)
        pickShift = TriaToolbar.number(spec["pickShift"], fallback: 0)
        attached = spec["attached"] as? Bool ?? false
        // A PILL AT REST AND THE SAME CORNER AT EVERY HEIGHT. 999 on a growing
        // box is a stadium, and the object would change character as you type;
        // the web fixes the radius at the disc's own plus the padding around it,
        // and this is that number rather than a second derivation of it.
        cornerConfiguration = .uniformCorners(
            radius: .fixed(TriaToolbar.number(spec["radius"], fallback: 29.4)))

        // The line box is the STYLESHEET'S, not the face's: the web sets
        // line-height 1.4 on a 16px field, and 22.4 is what the four-line cap and
        // the avatar's datum are both measured against. Pinning it here is what
        // makes those two sums mean the same thing on both sides of the bridge.
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = line
        paragraph.maximumLineHeight = line
        let ink = (spec["ink"] as? String).flatMap(TriaChromeBar.color(fromHex:)) ?? .label
        let muted = (spec["muted"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:)) ?? .secondaryLabel
        field.font = TriaPostBarPill.face
        field.textColor = ink
        oneLine.font = TriaPostBarPill.face
        oneLine.textColor = ink
        attrs = [.font: TriaPostBarPill.face,
                 .paragraphStyle: paragraph,
                 .foregroundColor: ink]
        setBody(body)
        let caret = (spec["caret"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:)) ?? ink
        field.tintColor = caret
        oneLine.tintColor = caret
        field.accessibilityLabel = spec["label"] as? String
        oneLine.accessibilityLabel = spec["label"] as? String
        hint.text = spec["placeholder"] as? String
        hint.font = TriaPostBarPill.face
        // The web's placeholder is --muted at 0.75. Baked into the colour rather
        // than set as a view alpha, so the label composites once.
        hint.textColor = muted.withAlphaComponent(0.75)

        /* THE KEYBOARD'S MANNERS, READ OFF THE MARKUP. `autocapitalize`,
           `autocorrect`, `spellcheck` and `enterkeyhint` are attributes the web
           field already carries for the web's own sake, so they cross as
           themselves rather than as a `find` branch — which also means a field
           that changes its mind in the markup changes it here for free.

           The Return key is the load-bearing one. A comment wants a real
           newline (see the Return note in wirePostBar: on a touch shell Return
           is a Return and the disc is the send), and a search has nothing to
           submit — the list has been filtering the whole way — so the key means
           "put the keyboard away", which is exactly what the web form's submit
           handler does. */
        applyTraits(spec)

        /* THE LEADING END, WHICH IS THE HALF THAT IS NOT A SWAP.

           A LIST asks what you are after and never asks anything else: the mark
           is a magnifier, it is drawn in the same 19pt in the same --muted as
           the discard mark it stands in for, and it takes no taps — the web's
           `.postbar-glyph` is a <span>, not a button, and this is that fact
           restated. So it borrows the face's IMAGE VIEW rather than adding a
           second one: the stylesheet already hands the magnifier the avatar's
           own box and datum, which is the whole reason the two bars sit on one
           axis, and a view of its own would be a second place to keep that in
           step. What it does not borrow is the morph — `setTyping` is fenced off
           below, so the mark holds still while the caret is in the field. */
        if find {
            faceButton.isUserInteractionEnabled = false
            faceButton.accessibilityElementsHidden = true
            faceMark.alpha = 1
            faceMark.transform = .identity
            if let mark = spec["leadGlyph"] as? String, !mark.isEmpty {
                faceMark.image = TriaSVG.image(markup: mark, size: 19, ink: muted,
                                               template: false)
            }
            faceMark.isHidden = false
            monogram.isHidden = true
            photo.isHidden = true
            pick.isHidden = true
            applyDisc(spec, muted: muted)
            syncIdle()
            setNeedsLayout()
            return
        }

        // THE AVATAR IS THE MONOGRAM WITH THE PHOTOGRAPH OVER IT, in that order
        // and for the reason avatarEl gives: a face that pops in a frame late
        // reads as a reload, so the letter is there from the first paint and the
        // picture lands on top of it when it arrives.
        monogram.isHidden = false
        monogram.text = spec["initials"] as? String
        monogram.font = UIFont(name: "Oxygen-Regular", size: faceBox.width * 0.53)
            ?? .systemFont(ofSize: faceBox.width * 0.53)
        monogram.textColor = (spec["avatarInk"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:)) ?? .label
        monogram.backgroundColor = (spec["avatarBg"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:)) ?? .quaternarySystemFill
        if let picture = TriaPostBarPill.decode(spec["photo"] as? String) {
            photo.image = picture
            photo.isHidden = false
        } else {
            photo.isHidden = true
        }

        // The close mark, at the magnifier's 19 rather than the send arrow's 22
        // — the web sizes both of the bar's bare marks together and only the
        // arrow bigger, because the arrow rides a filled disc that carries it.
        faceButton.accessibilityLabel = spec["faceLabel"] as? String
        if let mark = spec["faceGlyph"] as? String, !mark.isEmpty {
            faceMark.image = TriaSVG.image(markup: mark, size: 19, ink: muted, template: false)
        }

        applyPick(spec, muted: muted)
        applyDisc(spec, muted: muted)
        syncIdle()
        setNeedsLayout()
    }

    /// The photo button's mark, measured off `.postbar-pick` like every other
    /// mark on this bar: its glyph, its size and the colour the cascade gave it.
    private func applyPick(_ spec: [String: Any], muted: UIColor) {
        pick.isHidden = pickSide <= 0
        pick.accessibilityLabel = spec["pickLabel"] as? String
        if let glyph = spec["pickGlyph"] as? String, !glyph.isEmpty {
            let ink = (spec["pickInk"] as? String)
                .flatMap(TriaChromeBar.color(fromHex:)) ?? muted
            let size = TriaToolbar.number(spec["pickGlyphSize"], fallback: 21)
            pick.setImage(TriaSVG.image(markup: glyph, size: size, ink: ink, template: false),
                          for: .normal)
        }
    }

    /// Where the photo button sits: its own box while the disc is live, one
    /// `pickShift` further along, in the disc's slot, while it isn't. Hugs the
    /// last line with the disc, because the web row is flex-end for both.
    private func layoutPick() {
        guard pickSide > 0 else { return }
        let box = contentView.bounds
        pick.bounds = CGRect(x: 0, y: 0, width: pickSide, height: pickSide)
        pick.center = CGPoint(x: pickLeft + pickSide / 2 + (idle ? pickShift : 0),
                              y: box.height - discBottom - pickSide / 2)
    }

    /* THE TRAILING END, AND IT IS ONE BLOCK FOR BOTH BARS BECAUSE IT MEASURES
       RATHER THAN BRANCHES. A comment bar's send is the band, thinned, with a
       22pt arrow on it; a find bar's clear is a bare 19pt X in --muted on the
       pill's own glass and nothing else. Neither of those is written here: the
       clear carries no `.publish-fill`, so `bandOf` finds no gradient and the
       fill comes back empty; it carries `border: none`, so the hairline's width
       comes back 0. The mark's size and its colour are measured off the web
       element the same way, which is what stops a `size: 22` constant drawing a
       clear a fifth too big.

       Alpha and edge are still read off the web disc rather than quoted:
       --pill-alpha is a CONTRAST FLOOR with measured figures behind it in
       tokens.css, and --glass-edge is a translucent hairline. */
    private func applyDisc(_ spec: [String: Any], muted: UIColor) {
        send.accessibilityLabel = spec["sendLabel"] as? String
        if let glyph = spec["glyph"] as? String, !glyph.isEmpty {
            let markInk = (spec["discInk"] as? String)
                .flatMap(TriaChromeBar.color(fromHex:)) ?? muted
            let size = TriaToolbar.number(spec["glyphSize"], fallback: 22)
            send.setImage(TriaSVG.image(markup: glyph, size: size, ink: markInk, template: false),
                          for: .normal)
        }
        let alpha = TriaToolbar.number(spec["tintAlpha"], fallback: 1)
        // A find bar's clear carries no `.publish-fill`, so no colours arrive
        // and the ramp hides itself — which is the measurement doing the
        // branching, exactly as the note above says.
        let stops = (spec["colors"] as? [String] ?? [])
            .compactMap(TriaChromeBar.color(fromHex:))
        discRamp.isHidden = stops.isEmpty
        if !stops.isEmpty { discRamp.paint(stops, alpha: alpha) }
        // No colour, no border: a nil borderColor with a width set draws the
        // layer's own opaque black, which is a hard ring where a 10% hairline
        // was asked for.
        if let edge = (spec["edge"] as? String).flatMap(TriaChromeBar.color(fromHex:)) {
            disc.layer.borderColor = edge.cgColor
            disc.layer.borderWidth = TriaToolbar.number(spec["edgeWidth"], fallback: 0)
        } else {
            disc.layer.borderWidth = 0
        }
    }

    /// The four things the web field says about the keyboard it wants, carried
    /// as themselves. See the note at the call site for why Return is the one
    /// that matters.
    private func applyTraits(_ spec: [String: Any]) {
        let caps = (spec["caps"] as? String) == "none"
            ? UITextAutocapitalizationType.none : .sentences
        let correct = (spec["correct"] as? String) == "off"
            ? UITextAutocorrectionType.no : .default
        let spell = (spec["spell"] as? String) == "false"
            ? UITextSpellCheckingType.no : .default
        let key: UIReturnKeyType = (spec["returnKey"] as? String) == "search"
            ? .search : .default
        field.autocapitalizationType = caps
        field.autocorrectionType = correct
        field.spellCheckingType = spell
        oneLine.autocapitalizationType = caps
        oneLine.autocorrectionType = correct
        oneLine.spellCheckingType = spell
        oneLine.returnKeyType = key
    }

    /// WHAT THE READER HAS TYPED, from whichever of the two fields is on screen.
    /// Every read below goes through this rather than reaching for `field`, so
    /// adding the find bar's one-line box could not leave a stale read behind in
    /// the idle sync or the growth sum.
    private var body: String { find ? (oneLine.text ?? "") : (field.text ?? "") }

    /// Every write restates the attributes, because assigning `attributedText`
    /// throws away the typing ones. See `attrs`. The text FIELD needs none of
    /// that — it has one line, so there is no line box to pin and no typing
    /// attributes to lose.
    private func setBody(_ text: String) {
        if find { oneLine.text = text; return }
        field.attributedText = NSAttributedString(string: text, attributes: attrs)
        field.typingAttributes = attrs
    }

    func setText(_ text: String, selection: Int) {
        guard body != text else { return }
        setBody(text)
        if !find {
            let caret = max(0, min(selection, (text as NSString).length))
            field.selectedRange = NSRange(location: caret, length: 0)
        }
        syncIdle()
        onChange?()
    }

    private var caretHolder: UIView { find ? oneLine : field }
    func startEditing() {
        if !caretHolder.isFirstResponder { caretHolder.becomeFirstResponder() }
    }
    func stopEditing() { caretHolder.resignFirstResponder() }

    /// `.is-idle`: an empty bar has nothing to send, and a lit gradient disc with
    /// no act behind it is the brand band spent on nothing. Out of the
    /// accessibility tree with the same flip, so a visible send is always a live
    /// one — the web's contract, restated.
    private func syncIdle() {
        let text = body
        hint.isHidden = !text.isEmpty
        setIdle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !attached,
                animated: true)
    }

    private func setIdle(_ wanted: Bool, animated: Bool) {
        guard wanted != idle || !animated else { return }
        idle = wanted
        disc.isUserInteractionEnabled = !wanted
        disc.accessibilityElementsHidden = wanted
        if !animated || UIAccessibility.isReduceMotionEnabled {
            disc.alpha = wanted ? 0 : 1
            disc.transform = .identity
            layoutPick()
            return
        }
        // The scale is the only part that is motion; the fade stays, because
        // appearing instantly is the pop this exists to avoid. Same waiver the
        // web takes for .toolbar-commit.
        UIView.animate(withDuration: 0.18, delay: 0,
                       options: [.allowUserInteraction, .beginFromCurrentState]) {
            self.disc.alpha = wanted ? 0 : 1
            self.disc.transform = wanted ? CGAffineTransform(scaleX: 0.7, y: 0.7) : .identity
            self.layoutPick()
        }
    }

    // MARK: Geometry

    /// The stylesheet's own sum, with every term measured on the other side: two
    /// paddings and however many lines there are, capped at four. Past the cap
    /// the field scrolls, because a composer taller than the conversation it is
    /// joining has stopped being chrome.
    func desiredHeight() -> CGFloat {
        // MEASURED OFF THE STRING, not off the view. `sizeThatFits` lays an empty
        // text view out in the FACE's natural line height, which for Oxygen at
        // 16 is a hair over the 22.4 the stylesheet pins — so a resting bar came
        // back as two lines and stood 20pt too tall. `boundingRect` on an
        // attributed string honours the pinned line box, which is the number
        // both sides of this bridge are counting in.
        // A find bar is one line by construction (maxLines arrives as 1 from a
        // field that reports `max-height: none`), so the sum below is already
        // the resting height and there is nothing to measure a string for.
        if find { return 2 * pad + 2 * fieldPad + line }
        let text = body
        let sample = NSAttributedString(string: text.isEmpty ? " " : text, attributes: attrs)
        let box = sample.boundingRect(
            with: CGSize(width: textWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin], context: nil)
        // A trailing newline lays out as nothing, and a reader who just pressed
        // Return is looking at the line they are about to type on. A textarea's
        // scrollHeight counts it; so does this.
        let trailing: CGFloat = text.hasSuffix("\n") ? 1 : 0
        let lines = max(1, min(maxLines, (box.height / line - 0.01).rounded(.up) + trailing))
        return 2 * pad + 2 * fieldPad + lines * line
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let box = contentView.bounds

        // BOUNDS AND CENTRE, not frame, for the disc's reason: all three of these
        // carry a transform while the face morphs, and setting `frame` on a view
        // with a non-identity transform is undefined.
        for mark in [monogram, photo, faceMark] as [UIView] {
            mark.bounds = CGRect(origin: .zero, size: faceBox.size)
            mark.center = CGPoint(x: faceBox.midX, y: faceBox.midY)
        }
        monogram.layer.cornerRadius = faceBox.width / 2
        photo.layer.cornerRadius = faceBox.width / 2
        // 44 of target under 26 of mark, the web's own trick (.postbar-face::after).
        faceButton.frame = faceBox.insetBy(dx: -9, dy: -9)

        // The disc sits into its own end of the bar and hugs the LAST line: the
        // web row is flex-end, so as the field grows the disc travels with the
        // bottom of it rather than staying beside the first line.
        disc.bounds = CGRect(x: 0, y: 0, width: discSide, height: discSide)
        disc.center = CGPoint(x: box.width - discRight - discSide / 2,
                              y: box.height - discBottom - discSide / 2)
        disc.layer.cornerRadius = discSide / 2
        layoutPick()

        // BOTH FIELDS TAKE THE SAME BOX, and only one of them is on screen. The
        // text field is pinned to a single line rather than to the pill's
        // remaining height, which for a find bar are the same number anyway —
        // stating it as `line` is what says the box cannot grow.
        let textBox = CGRect(x: textLeft, y: pad + fieldPad, width: textWidth,
                             height: max(line, box.height - 2 * pad - 2 * fieldPad))
        field.frame = textBox
        oneLine.frame = CGRect(x: textLeft, y: pad + fieldPad, width: textWidth, height: line)
        hint.frame = CGRect(x: textLeft, y: pad + fieldPad, width: textWidth, height: line)
    }

    // MARK: Typing

    func textViewDidChange(_ textView: UITextView) {
        syncIdle()
        onChange?()
        onText?(textView.text ?? "", textView.selectedRange.location)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        // The caret is half of what the mention picker reads — it matches an
        // "@word" ending AT the caret — so a bare arrow-key or tap move has to
        // cross too, not only a keystroke.
        onText?(textView.text ?? "", textView.selectedRange.location)
    }

    func textView(_ textView: UITextView,
                  shouldChangeTextIn range: NSRange,
                  replacementText text: String) -> Bool {
        // maxlength=300, enforced where the typing is. The web textarea still
        // carries the same attribute, which is what makes this a mirror of the
        // rule rather than the only copy of it.
        let current = (textView.text ?? "") as NSString
        return current.length - range.length + (text as NSString).length <= limit
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
        setTyping(true)
        onFocus?(true)
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        setTyping(false)
        onFocus?(false)
    }

    /* ── The find bar's field ────────────────────────────────────────────────
       The same four answers as the textarea above, minus the caret. The mention
       picker is what reads a caret, and a search has no mentions in it — so what
       crosses is a string and the position is simply the end of it. */

    @objc private func lineEdited() {
        syncIdle()
        onChange?()
        onText?(oneLine.text ?? "", (oneLine.text as NSString?)?.length ?? 0)
    }

    func textField(_ textField: UITextField,
                   shouldChangeCharactersIn range: NSRange,
                   replacementString string: String) -> Bool {
        // maxlength=60, enforced where the typing is. The web input still
        // carries the attribute, so this is a mirror of the rule rather than the
        // only copy of it — the textarea's 300 arrives through the same key.
        let current = (textField.text ?? "") as NSString
        return current.length - range.length + (string as NSString).length <= limit
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        // NOTHING TO SUBMIT. The list has been filtering on every keystroke, so
        // the key can only usefully mean "I'm done looking at the keyboard" —
        // which is exactly what the web form's own submit handler does with it.
        stopEditing()
        return false
    }

    func textFieldDidBeginEditing(_ textField: UITextField) { onFocus?(true) }
    func textFieldDidEndEditing(_ textField: UITextField) { onFocus?(false) }

    /// The face's two states. Native flips this itself rather than being told,
    /// because it owns the caret and therefore already knows — the web's
    /// `.is-typing` and this are one rule written once on each side.
    ///
    /// The mark is only reachable while it is showing, the same three flags in
    /// step the send disc keeps (see `setIdle`), so a face that can throw a
    /// comment away is always a face you can see it on.
    /// The leading end, put back at rest with no animation. `setTyping` guards on
    /// a CHANGE, which is right while a caret moves in and out of one bar and
    /// wrong at the moment the pill changes which bar it IS — the mark is being
    /// swapped for a different one, and whatever alpha and quarter turn the last
    /// was wearing would be inherited by it.
    private func resetFace() {
        typing = false
        faceButton.isUserInteractionEnabled = false
        faceButton.accessibilityElementsHidden = true
        faceMark.alpha = 0
        faceMark.transform = CGAffineTransform(rotationAngle: .pi / 2).inverted()
        for mark in [monogram, photo] as [UIView] {
            mark.alpha = 1
            mark.transform = .identity
        }
    }

    private func setTyping(_ wanted: Bool) {
        // A MAGNIFIER IS NEVER A DISCARD MARK. On a find bar the leading mark is
        // the whole of what the leading end is, so there is no second state for
        // the caret to move it into — and the web agrees: `.postbar-glyph` has no
        // `.is-typing` rule and is not a button.
        guard !find else { return }
        guard wanted != typing else { return }
        typing = wanted
        faceButton.isUserInteractionEnabled = wanted
        faceButton.accessibilityElementsHidden = !wanted
        let turn = CGAffineTransform(rotationAngle: .pi / 2)
        let apply = {
            self.faceMark.alpha = wanted ? 1 : 0
            self.faceMark.transform = wanted ? .identity : turn.inverted()
            self.monogram.alpha = wanted ? 0 : 1
            self.photo.alpha = wanted ? 0 : 1
            self.monogram.transform = wanted ? turn : .identity
            self.photo.transform = wanted ? turn : .identity
        }
        guard !UIAccessibility.isReduceMotionEnabled else {
            faceMark.transform = .identity
            monogram.transform = .identity
            photo.transform = .identity
            self.faceMark.alpha = wanted ? 1 : 0
            self.monogram.alpha = wanted ? 0 : 1
            self.photo.alpha = wanted ? 0 : 1
            return
        }
        UIView.animate(withDuration: 0.24, delay: 0,
                       options: [.allowUserInteraction, .beginFromCurrentState],
                       animations: apply)
    }

    @objc private func sendTapped() { onSend?() }
    @objc private func pickTapped() { onPick?() }

    /// I have changed my mind. Empty the field, give the keyboard back, and tell
    /// the web to drop its copy of the words — in that order, so the popover the
    /// mention picker may have open closes against an empty field rather than
    /// against the one it was built from.
    @objc private func faceTapped() {
        setBody("")
        syncIdle()
        onChange?()
        onText?("", 0)
        stopEditing()
        onDiscard?()
    }

    /// A `data:image/png;base64,…` from the web side. The avatar is already in
    /// the page, already fetched with CORS (see avatarEl) and already read
    /// through a canvas by the ambient wash — so it crosses as pixels rather
    /// than as a URL this file would have to go and fetch a second time.
    private static func decode(_ uri: String?) -> UIImage? {
        guard let uri, let comma = uri.firstIndex(of: ","),
              let data = Data(base64Encoded: String(uri[uri.index(after: comma)...])) else {
            return nil
        }
        return UIImage(data: data)
    }
}

// MARK: - The glyphs

/// Tria's own icons, rendered from the SAME markup the web draws.
///
/// This replaced a hand-translated set of `UIBezierPath` calls, and the reason
/// is the reason app.js resolves the brand band to numbers rather than letting
/// Swift re-derive it: a second copy of a drawing is a place for it to drift.
/// The first version of this file carried five glyphs translated segment by
/// segment, which was already a copy of `ICONS` in js/app.js; the toolbar and
/// its menus need about twenty more, and twenty more copies is not a thing to
/// own. So app.js sends the icon's markup — read straight off the element it is
/// standing in for, or straight out of `ICONS` for a menu row — and this parses
/// it.
///
/// The subset is what Tria's icons actually use and no more: `<svg>` for the
/// viewBox and the inherited paint, `<circle>`, `<rect>`, and `<path>` with
/// M/L/H/V/C/S/Q/T/A/Z in both cases. No exponents in numbers (nothing draws
/// one, and `1e3` is ambiguous against a command letter without more care than
/// it would buy), no transforms, no gradients, no text.
///
/// SF Symbols were the cheaper option and the wrong one, for the reason the tab
/// bar records: the material is what 1.4 hands to the system, not the identity,
/// and Tria's Discover mark is a triad of circles no symbol in the library says.
@available(iOS 26.0, *)
enum TriaSVG {

    /// `template` renders every paint in black and returns a template image, so
    /// `tintColor` still does the whole colour story where a caller wants that
    /// (the tab bar's live/idle ink, a destructive menu row's red). Otherwise
    /// the ink is BAKED, which is what lets a glyph carry more than one colour —
    /// the filter dial's All row is the quintet, five hues in one mark.
    static func image(markup: String, size: CGFloat, ink: UIColor, template: Bool) -> UIImage? {
        let doc = parse(markup)
        guard !doc.shapes.isEmpty, doc.box.width > 0, doc.box.height > 0 else { return nil }
        let scale = size / max(doc.box.width, doc.box.height)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let image = renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            context.cgContext.translateBy(x: -doc.box.minX, y: -doc.box.minY)
            for shape in doc.shapes {
                shape.path.lineWidth = shape.strokeWidth
                shape.path.lineCapStyle = .round
                shape.path.lineJoinStyle = .round
                if let fill = shape.fill {
                    (template ? UIColor.black : resolve(fill, ink)).setFill()
                    shape.path.fill()
                }
                if let stroke = shape.stroke {
                    (template ? UIColor.black : resolve(stroke, ink)).setStroke()
                    shape.path.stroke()
                }
            }
        }
        return image.withRenderingMode(template ? .alwaysTemplate : .alwaysOriginal)
    }

    /// Whether the drawing names any colour of its own. See the note at the one
    /// caller: it is what decides between baking an ink in and handing the image
    /// over as a template for somebody else to colour.
    /// The same drawing into a `width` × `height` canvas, scaled to fit and
    /// centred, as a template for `tintColor`. For a mark that isn't square,
    /// the wordmark first: `image(markup:size:)` would draw it into the top of
    /// a square and leave the rest of the box empty.
    static func image(markup: String, width: CGFloat, height: CGFloat) -> UIImage? {
        let doc = parse(markup)
        guard !doc.shapes.isEmpty, doc.box.width > 0, doc.box.height > 0,
              width > 0, height > 0 else { return nil }
        let scale = min(width / doc.box.width, height / doc.box.height)
        let dx = (width - doc.box.width * scale) / 2
        let dy = (height - doc.box.height * scale) / 2
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
        let image = renderer.image { context in
            context.cgContext.translateBy(x: dx, y: dy)
            context.cgContext.scaleBy(x: scale, y: scale)
            context.cgContext.translateBy(x: -doc.box.minX, y: -doc.box.minY)
            UIColor.black.setFill()
            for shape in doc.shapes where shape.fill != nil { shape.path.fill() }
        }
        return image.withRenderingMode(.alwaysTemplate)
    }

    static func carriesColour(_ markup: String) -> Bool {
        for tag in scan(markup) {
            for key in ["fill", "stroke"] where tag.attrs[key] != nil {
                let value = tag.attrs[key] ?? ""
                if value != "none" && value != "currentColor" { return true }
            }
        }
        return false
    }

    private static func resolve(_ paint: String, _ ink: UIColor) -> UIColor {
        if paint == "currentColor" { return ink }
        return TriaChromeBar.color(fromHex: paint) ?? ink
    }

    private struct Shape {
        let path: UIBezierPath
        let fill: String?          // nil is `none`
        let stroke: String?
        let strokeWidth: CGFloat
    }
    private struct Document {
        let box: CGRect
        let shapes: [Shape]
    }

    private static func parse(_ markup: String) -> Document {
        let tags = scan(markup)
        var box = CGRect(x: 0, y: 0, width: 24, height: 24)
        // The wrapper's paint is what every child inherits. SVG's own defaults
        // apply where it states none: fill black, stroke none. Both matter here
        // — Tria's ICON_ATTRS wrapper says `fill="none" stroke="currentColor"`,
        // and the ICON_ALL pentad's wrapper says neither, which is exactly how
        // its five discs come out as flat fills rather than rings.
        var rootFill: String? = "black"
        var rootStroke: String? = nil
        var rootWidth: CGFloat = 1.8
        var shapes: [Shape] = []

        for tag in tags {
            if tag.name == "svg" {
                if let raw = tag.attrs["viewBox"] {
                    let n = raw.split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { Double($0) }
                    if n.count == 4 { box = CGRect(x: n[0], y: n[1], width: n[2], height: n[3]) }
                }
                if let fill = tag.attrs["fill"] { rootFill = fill == "none" ? nil : fill }
                if let stroke = tag.attrs["stroke"] { rootStroke = stroke == "none" ? nil : stroke }
                if let width = tag.attrs["stroke-width"], let value = Double(width) {
                    rootWidth = CGFloat(value)
                }
                continue
            }
            guard let path = geometry(tag) else { continue }
            var fill = rootFill
            var stroke = rootStroke
            if let raw = tag.attrs["fill"] { fill = raw == "none" ? nil : raw }
            if let raw = tag.attrs["stroke"] { stroke = raw == "none" ? nil : raw }
            var width = rootWidth
            if let raw = tag.attrs["stroke-width"], let value = Double(raw) { width = CGFloat(value) }
            shapes.append(Shape(path: path, fill: fill, stroke: stroke, strokeWidth: width))
        }
        return Document(box: box, shapes: shapes)
    }

    private static func geometry(_ tag: (name: String, attrs: [String: String])) -> UIBezierPath? {
        func value(_ key: String, _ fallback: CGFloat = 0) -> CGFloat {
            tag.attrs[key].flatMap { Double($0) }.map { CGFloat($0) } ?? fallback
        }
        switch tag.name {
        case "circle":
            let r = value("r")
            guard r > 0 else { return nil }
            return UIBezierPath(ovalIn: CGRect(x: value("cx") - r, y: value("cy") - r,
                                               width: 2 * r, height: 2 * r))
        case "ellipse":
            let rx = value("rx"), ry = value("ry")
            guard rx > 0, ry > 0 else { return nil }
            return UIBezierPath(ovalIn: CGRect(x: value("cx") - rx, y: value("cy") - ry,
                                               width: 2 * rx, height: 2 * ry))
        case "rect":
            let rect = CGRect(x: value("x"), y: value("y"),
                              width: value("width"), height: value("height"))
            guard rect.width > 0, rect.height > 0 else { return nil }
            let radius = value("rx", value("ry"))
            return radius > 0 ? UIBezierPath(roundedRect: rect, cornerRadius: radius)
                              : UIBezierPath(rect: rect)
        case "line":
            let path = UIBezierPath()
            path.move(to: CGPoint(x: value("x1"), y: value("y1")))
            path.addLine(to: CGPoint(x: value("x2"), y: value("y2")))
            return path
        case "path":
            guard let d = tag.attrs["d"], !d.isEmpty else { return nil }
            return pathData(d)
        default:
            return nil
        }
    }

    // MARK: The tag scanner

    private static func scan(_ markup: String) -> [(name: String, attrs: [String: String])] {
        var out: [(name: String, attrs: [String: String])] = []
        let chars = Array(markup)
        var i = 0
        while i < chars.count {
            guard chars[i] == "<" else { i += 1; continue }
            i += 1
            // Closing tags, comments and declarations carry nothing we want.
            if i < chars.count, chars[i] == "/" || chars[i] == "!" || chars[i] == "?" {
                while i < chars.count, chars[i] != ">" { i += 1 }
                continue
            }
            var name = ""
            while i < chars.count, chars[i].isLetter || chars[i].isNumber {
                name.append(chars[i]); i += 1
            }
            var attrs: [String: String] = [:]
            while i < chars.count, chars[i] != ">" {
                if chars[i].isWhitespace || chars[i] == "/" { i += 1; continue }
                var key = ""
                while i < chars.count, chars[i] != "=", chars[i] != ">", !chars[i].isWhitespace {
                    key.append(chars[i]); i += 1
                }
                // Nothing was consumed and nothing above will consume it either:
                // step past it or this loop never ends.
                if key.isEmpty { i += 1; continue }
                guard i < chars.count, chars[i] == "=" else { continue }
                i += 1
                guard i < chars.count, chars[i] == "\"" || chars[i] == "'" else { continue }
                let quote = chars[i]
                i += 1
                var value = ""
                while i < chars.count, chars[i] != quote { value.append(chars[i]); i += 1 }
                if i < chars.count { i += 1 }
                attrs[key] = value
            }
            if i < chars.count { i += 1 }
            if !name.isEmpty { out.append((name, attrs)) }
        }
        return out
    }

    // MARK: The path-data scanner

    private struct Cursor {
        let chars: [Character]
        var i = 0
        init(_ text: String) { chars = Array(text) }
        var done: Bool { i >= chars.count }
        mutating func skip() {
            while i < chars.count, chars[i] == "," || chars[i].isWhitespace { i += 1 }
        }
        mutating func number() -> CGFloat? {
            skip()
            var text = ""
            if i < chars.count, chars[i] == "+" || chars[i] == "-" { text.append(chars[i]); i += 1 }
            while i < chars.count, chars[i].isNumber { text.append(chars[i]); i += 1 }
            if i < chars.count, chars[i] == "." {
                text.append(chars[i]); i += 1
                while i < chars.count, chars[i].isNumber { text.append(chars[i]); i += 1 }
            }
            return Double(text).map { CGFloat($0) }
        }
        /// An arc's two flags are single digits and may be written with no
        /// separator at all ("0 0 1" and "001" are the same three flags), so
        /// they cannot go through `number()`.
        mutating func flag() -> CGFloat? {
            skip()
            guard i < chars.count, chars[i] == "0" || chars[i] == "1" else { return nil }
            let value: CGFloat = chars[i] == "1" ? 1 : 0
            i += 1
            return value
        }
    }

    private static func pathData(_ d: String) -> UIBezierPath {
        let path = UIBezierPath()
        var cursor = Cursor(d)
        var command: Character?
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastCubic: CGPoint?
        var lastQuad: CGPoint?
        var open = false

        func relative(_ c: Character) -> Bool { c.isLowercase }
        func point(_ x: CGFloat, _ y: CGFloat, _ c: Character) -> CGPoint {
            relative(c) ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
        }

        while true {
            cursor.skip()
            if cursor.done { break }
            if cursor.chars[cursor.i].isLetter {
                command = cursor.chars[cursor.i]
                cursor.i += 1
            }
            guard let c = command else { break }
            let upper = Character(String(c).uppercased())

            if upper == "Z" {
                if open { path.close() }
                current = start
                lastCubic = nil; lastQuad = nil
                // Nothing follows a close, so drop the command or an implicit
                // repeat would spin here forever.
                command = nil
                continue
            }
            guard open || upper == "M" else { break }

            // S and T mirror the PREVIOUS curve's control point, and only when
            // the previous command actually was one. Every other command clears
            // the reflection here, at the one place that sees all of them, so a
            // straight run in the middle of an outline can't leave a stale
            // control point behind for the next smooth curve to mirror. That is
            // what bent the bell: `…H4.3 S6 13.8 6 9.2z` mirrored the control
            // point of the flare on the RIGHT, and the left flare came out as a
            // ramp reaching past the rim it starts on.
            if !"CSQT".contains(upper) { lastCubic = nil; lastQuad = nil }

            switch upper {
            case "M":
                guard let x = cursor.number(), let y = cursor.number() else { return path }
                current = point(x, y, c)
                path.move(to: current)
                start = current
                open = true
                // "A moveto followed by multiple pairs is treated as a lineto",
                // in the same case as the move.
                command = relative(c) ? "l" : "L"
            case "L":
                guard let x = cursor.number(), let y = cursor.number() else { return path }
                current = point(x, y, c)
                path.addLine(to: current)
            case "H":
                guard let x = cursor.number() else { return path }
                current = CGPoint(x: relative(c) ? current.x + x : x, y: current.y)
                path.addLine(to: current)
            case "V":
                guard let y = cursor.number() else { return path }
                current = CGPoint(x: current.x, y: relative(c) ? current.y + y : y)
                path.addLine(to: current)
            case "C":
                guard let x1 = cursor.number(), let y1 = cursor.number(),
                      let x2 = cursor.number(), let y2 = cursor.number(),
                      let x = cursor.number(), let y = cursor.number() else { return path }
                let c1 = point(x1, y1, c), c2 = point(x2, y2, c)
                current = point(x, y, c)
                path.addCurve(to: current, controlPoint1: c1, controlPoint2: c2)
                lastCubic = c2; lastQuad = nil
            case "S":
                guard let x2 = cursor.number(), let y2 = cursor.number(),
                      let x = cursor.number(), let y = cursor.number() else { return path }
                // S reflects the previous curve's second control point through
                // the current point; after anything else the reflection IS the
                // current point.
                let c1 = lastCubic.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) }
                    ?? current
                let c2 = point(x2, y2, c)
                current = point(x, y, c)
                path.addCurve(to: current, controlPoint1: c1, controlPoint2: c2)
                lastCubic = c2; lastQuad = nil
            case "Q":
                guard let x1 = cursor.number(), let y1 = cursor.number(),
                      let x = cursor.number(), let y = cursor.number() else { return path }
                let ctrl = point(x1, y1, c)
                current = point(x, y, c)
                path.addQuadCurve(to: current, controlPoint: ctrl)
                lastQuad = ctrl; lastCubic = nil
            case "T":
                guard let x = cursor.number(), let y = cursor.number() else { return path }
                let ctrl = lastQuad.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) }
                    ?? current
                current = point(x, y, c)
                path.addQuadCurve(to: current, controlPoint: ctrl)
                lastQuad = ctrl; lastCubic = nil
            case "A":
                guard let rx = cursor.number(), let ry = cursor.number(),
                      let rotation = cursor.number(), let large = cursor.flag(),
                      let sweep = cursor.flag(),
                      let x = cursor.number(), let y = cursor.number() else { return path }
                let to = point(x, y, c)
                arc(path, from: current, to: to, rx: rx, ry: ry,
                    rotation: rotation * .pi / 180, large: large == 1, sweep: sweep == 1)
                current = to
            default:
                return path
            }
        }
        return path
    }

    /// SVG's endpoint arc, as cubics.
    ///
    /// The endpoint-to-centre conversion is F.6.5 of the SVG spec, verbatim, and
    /// it needs no adjustment for UIKit: the spec's coordinate system already
    /// runs y DOWN, which is also the image context's, so `sweep` means the same
    /// direction on both sides. Each quarter turn or less becomes one cubic
    /// through the standard 4/3·tan(θ/4) control-point length, rather than a
    /// `UIBezierPath` arc — an arc would have to be built as its own subpath and
    /// appended, which breaks the current point and with it every closed outline
    /// that has an arc in the middle of it (the heart, the bell, the map pin).
    private static func arc(_ path: UIBezierPath, from p0: CGPoint, to p1: CGPoint,
                            rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat,
                            large: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 { path.addLine(to: p1); return }

        let cosR = cos(rotation), sinR = sin(rotation)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosR * dx + sinR * dy
        let y1 = -sinR * dx + cosR * dy

        // Radii too small to reach: scale them up until they just do (F.6.6).
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 {
            let s = sqrt(lambda)
            rx *= s; ry *= s
        }

        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        guard denominator > 0 else { path.addLine(to: p1); return }
        let numerator = max(rx * rx * ry * ry - denominator, 0)
        var coefficient = sqrt(numerator / denominator)
        if large == sweep { coefficient = -coefficient }
        let cx1 = coefficient * rx * y1 / ry
        let cy1 = -coefficient * ry * x1 / rx
        let cx = cosR * cx1 - sinR * cy1 + (p0.x + p1.x) / 2
        let cy = sinR * cx1 + cosR * cy1 + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let length = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
            guard length > 0 else { return 0 }
            var value = acos(min(1, max(-1, (ux * vx + uy * vy) / length)))
            if ux * vy - uy * vx < 0 { value = -value }
            return value
        }
        let ux = (x1 - cx1) / rx, uy = (y1 - cy1) / ry
        let vx = (-x1 - cx1) / rx, vy = (-y1 - cy1) / ry
        let theta = angle(1, 0, ux, uy)
        var delta = angle(ux, uy, vx, vy).truncatingRemainder(dividingBy: 2 * .pi)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        func at(_ t: CGFloat) -> CGPoint {
            CGPoint(x: cx + rx * cos(t) * cosR - ry * sin(t) * sinR,
                    y: cy + rx * cos(t) * sinR + ry * sin(t) * cosR)
        }
        func slope(_ t: CGFloat) -> CGPoint {
            CGPoint(x: -rx * sin(t) * cosR - ry * cos(t) * sinR,
                    y: -rx * sin(t) * sinR + ry * cos(t) * cosR)
        }

        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let alpha = 4.0 / 3.0 * tan(step / 4)
        var t1 = theta
        for _ in 0..<segments {
            let t2 = t1 + step
            let a = at(t1), b = at(t2)
            let da = slope(t1), db = slope(t2)
            path.addCurve(to: b,
                          controlPoint1: CGPoint(x: a.x + alpha * da.x, y: a.y + alpha * da.y),
                          controlPoint2: CGPoint(x: b.x - alpha * db.x, y: b.y - alpha * db.y))
            t1 = t2
        }
    }
}

/// The same drawing, weaker. A `UIMenu` row takes an image and offers no way to
/// dim one — and `.disabled`, the one attribute that dims a whole row, also
/// stops it being tappable — so an un-picked filter's mark is faded here, by
/// compositing the picture onto nothing at `alpha`. A template comes back a
/// template: the alpha lands in the mask, which is where a tint colour reads it.
extension UIImage {
    func faded(_ alpha: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = scale
        let out = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(at: .zero, blendMode: .normal, alpha: alpha)
        }
        return out.withRenderingMode(renderingMode)
    }
}


/// One photo or GIF off the camera roll, for the comment bar. A GIF crosses as
/// its own bytes so it still moves (the web keeps them, see `readCommentPhoto`);
/// anything else is drawn upright and capped at 1600pt on its long edge before
/// it crosses, which is what the web would have re-encoded it to anyway, and
/// keeps a 48MP photo from travelling the bridge as base64.
final class TriaPhotoPicker: NSObject, PHPickerViewControllerDelegate {
    private let done: ([String: Any]) -> Void
    private var finished = false

    init(done: @escaping ([String: Any]) -> Void) {
        self.done = done
    }

    func present(from host: UIViewController) {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        host.present(picker, animated: true)
    }

    private func finish(_ result: [String: Any]) {
        guard !finished else { return }
        finished = true
        done(result)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider else {
            finish([:])
            return
        }
        let unreadable: [String: Any] = ["error": "Couldn’t read that photo. Try another."]
        if provider.hasItemConformingToTypeIdentifier(UTType.gif.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.gif.identifier) { [weak self] data, _ in
                guard let data else { self?.finish(unreadable); return }
                self?.finish(["data": data.base64EncodedString(), "type": "image/gif"])
            }
            return
        }
        guard provider.canLoadObject(ofClass: UIImage.self) else {
            finish(unreadable)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let image = object as? UIImage, image.size.width > 0, image.size.height > 0 else {
                self?.finish(unreadable)
                return
            }
            let cap: CGFloat = 1600
            let scale = min(1, cap / max(image.size.width, image.size.height))
            let size = CGSize(width: (image.size.width * scale).rounded(),
                              height: (image.size.height * scale).rounded())
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            format.opaque = true
            let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            guard let jpeg = drawn.jpegData(compressionQuality: 0.9) else {
                self?.finish(unreadable)
                return
            }
            self?.finish(["data": jpeg.base64EncodedString(), "type": "image/jpeg"])
        }
    }
}

// MARK: - The refresh glow

/* 2.0: A REFRESH IS THE SCREEN'S EDGE LIGHTING UP, and this replaced the five
   dot ring in the app. The web keeps the ring (a browser window has no rounded
   glass to trace). A soft bloom at the top only, built like the profile wash,
   was tried the same day and Zoe went back to this, thinner, then asked for
   the glow and not the line: the stroke now sits off the glass (see `line`).

   IT WEARS THE READER'S COLOUR, the same band every commit wears
   (`--pill-band`, resolved by `NativeChrome.glowColors` and sent with each
   pull): an accent is its three near stops, Tria's own ramp is cyan to green,
   and None is the neutral, ink-side on paper and paper-side on ink.

   THE PULL DRAWS IT. Two strokes leave the top centre together and run round
   the corners and down either side, each as far as the pull has got, and they
   reach THE FOOT OF THE STATUS BAR exactly at the threshold (Zoe: halfway
   first, then where the content starts, then the status bar's end rather than
   the header's). It is the window's top safe inset; halfway is the fallback. Let go and the colours turn slowly along the lit edge
   while the world re-pulls, then it fades.

   THE TIPS ARE FEATHERED, not capped (Zoe: "fade them out instead of sharp
   edges"). A stroke can't carry a gradient along its own length, but every
   point of these two strokes sits at a steadily growing ANGLE from the
   screen's centre (top centre is 0, halfway down a side a quarter turn), so a
   CONIC alpha mask centred there is a gradient along the stroke: solid up to
   the last `fade` of it, then a smoothstep down to nothing at the tip, mirrored
   for the left. While the stroke is shorter than the fade, all of it is fade,
   so the light arrives out of nothing rather than as a dot. The halo is inside
   the mask too, so it feathers with the line. A run of fainter and fainter
   segments was the first way and showed its steps as bands down the side.

   NATIVE READS THE PULL ITSELF, off the web view's own scroll view, the same
   way `TriaScrollWatch` reads the header's state. The stroke has to move with
   the finger at the display's rate and the haptics have to land on the frame
   the stroke reaches a mark; sixty bridge messages a second would cost both
   (every one is a main thread round trip, see the haptics note in
   ios-shell.md). app.js says three things per pull: pull, spin, idle.

   THE HAPTICS ARE A RATCHET. Six soft detents as the strokes travel, each a
   touch firmer than the last, then one rigid click at the threshold, then a
   soft landing as the glow leaves (only after a pull: a resume nobody asked
   for stays silent). UIImpactFeedbackGenerator rather than Core Haptics on
   purpose: it obeys Settings, Sounds & Haptics, System Haptics before we ever
   hear about it, which is the app's standing rule, and `prepare()` on the first
   frame of the pull wakes the Taptic Engine so the first detent isn't late.
   Detents and not a continuous hum: a hum under the thumb reads as the phone
   buzzing, a ratchet reads as the pull having resistance.

   THE TWO HEXES ARE HELD BY HAND here, like the logo SVGs and storycard.js,
   but only as the fallback for a pull that arrives without colours. */
final class TriaEdgeGlow: UIView {

    /// Points of pull that arm a refresh. MUST match THRESHOLD in app.js's pull
    /// module: that side decides whether letting go refreshes, this side draws
    /// and clicks at the moment it will.
    private static let threshold: CGFloat = 72
    private static let detents = 6
    /// The stroke lies JUST PAST the display's edge, so it is never seen: only
    /// its halo spills in off the glass (Zoe: "I want to see the glow, not the
    /// line"). A 1.5pt hairline on the edge with a 4pt halo came first and read
    /// as a line. The stroke is wide so the halo is bright where it enters (a
    /// wide band's shadow is half strength at its edge; a hairline's, blurred
    /// this far, would be a few percent), and the halo is the glow's depth.
    private static let line: CGFloat = 24
    private static let halo: CGFloat = 16
    /// How much of each stroke's length, at full reach, is the feathered tip,
    /// and how many stops the mask spends on it.
    private static let fade: CGFloat = 0.38
    private static let feather = 10
    private static let start = UIColor(red: 0, green: 0xc9 / 255.0, blue: 0xce / 255.0, alpha: 1)
    private static let end = UIColor(red: 0, green: 0xcc / 255.0, blue: 0x9e / 255.0, alpha: 1)

    private weak var scroll: UIScrollView?
    private var watch: NSKeyValueObservation?
    private let ramp = CAGradientLayer()
    /// Holds the ramp still while it turns inside, and carries the feather.
    private let lit = CALayer()
    private let feather = CAGradientLayer()
    private let strokes = CALayer()
    private let right = CAShapeLayer()
    private let left = CAShapeLayer()
    /// The right stroke's geometry, for turning a distance along it into an
    /// angle round the centre: the top run, the corner, the side run.
    private var shape = (rect: CGRect.zero, r: CGFloat(0), foot: CGFloat(0))
    /// Where the strokes end, in this view's points (the status bar's foot).
    private var depth: CGFloat?
    private let detent = UIImpactFeedbackGenerator(style: .soft)
    private let click = UIImpactFeedbackGenerator(style: .rigid)
    private var state = "idle"
    private var reached = 0
    private var armed = false
    /// Where the tips are, 0 to 1 along each stroke.
    private var reach: CGFloat = 0
    /// Bumped by every state change, so a fade's completion that lands after a
    /// new pull has started doesn't blank it.
    private var generation = 0
    /// Drives `reach` when no finger is (closing on release, retracting).
    private var tween: CADisplayLink?
    private var tweenFrom: CGFloat = 0
    private var tweenTo: CGFloat = 0
    private var tweenStart: CFTimeInterval = 0
    private var tweenLength: CFTimeInterval = 0

    init(scroll: UIScrollView) {
        self.scroll = scroll
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isHidden = true
        alpha = 0
        backgroundColor = .clear

        // Conic, so turning it is the spin. See `wear` for the stops.
        ramp.type = .conic
        ramp.startPoint = CGPoint(x: 0.5, y: 0.5)
        ramp.endPoint = CGPoint(x: 0.5, y: 0)
        wear([Self.start, Self.end])
        lit.addSublayer(ramp)
        feather.type = .conic
        feather.startPoint = CGPoint(x: 0.5, y: 0.5)
        feather.endPoint = CGPoint(x: 0.5, y: 0)
        lit.mask = feather
        layer.addSublayer(lit)

        for s in [right, left] {
            s.fillColor = nil
            s.strokeColor = UIColor.black.cgColor
            s.lineWidth = Self.line
            s.lineCap = .butt   // the tip is at nothing anyway
            s.strokeEnd = 0
            strokes.addSublayer(s)
        }
        // The bloom is the MASK's shadow: a mask's shadow counts as coverage, so
        // the ramp shows through a soft halo round the line with no blur pass.
        // It follows each segment's opacity, so the halo feathers with the line.
        strokes.shadowColor = UIColor.black.cgColor
        strokes.shadowOpacity = 1
        strokes.shadowOffset = .zero
        strokes.shadowRadius = Self.halo
        layer.mask = strokes
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The band round the circle, there and back, again and again: each run
    /// of it spans the turn from the top centre to the strokes' foot, so the
    /// whole band shows along the lit edge, first stop at the top and last at
    /// the tips. An even count of runs keeps the turn seamless, whichever run
    /// is passing under the light. Four when the foot was halfway down.
    private var band: [CGColor] = []
    private var bands = 4

    private func wear(_ stops: [UIColor]) {
        var b = stops.isEmpty ? [Self.start, Self.end] : stops
        if b.count == 1 { b += b }
        band = b.map { $0.cgColor }
        paint()
    }

    private func paint() {
        let back = Array(band.reversed().dropFirst())
        var loop = band
        for k in 1..<bands { loop += k % 2 == 1 ? back : Array(band.dropFirst()) }
        ramp.colors = loop
        ramp.locations = loop.indices.map { NSNumber(value: Double($0) / Double(loop.count - 1)) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // Squares on the diagonal, centred on the screen: turning the ramp never
        // shows a corner, and the feather's angles are true angles.
        let side = hypot(bounds.width, bounds.height)
        let square = CGRect(x: bounds.midX - side / 2, y: bounds.midY - side / 2, width: side, height: side)
        lit.frame = square
        ramp.frame = lit.bounds
        feather.frame = lit.bounds
        strokes.frame = bounds
        let radius = Self.cornerRadius(for: window)
        // Never above the corner's end or below halfway.
        let foot = min(bounds.midY, max(radius, depth ?? bounds.midY))
        shape = (bounds.insetBy(dx: -Self.line / 2, dy: -Self.line / 2), radius + Self.line / 2, foot)
        let half = Self.halfPath(in: bounds, radius: radius, foot: foot)
        let mirrored = half.copy() as! UIBezierPath
        mirrored.apply(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: bounds.width, ty: 0))
        right.path = half.cgPath
        left.path = mirrored.cgPath
        let span = turn(at: 1)
        let fit = span > 0 ? max(4, 2 * Int((0.5 / span).rounded())) : 4
        if fit != bands { bands = fit; paint() }
        CATransaction.commit()
    }

    /// The right half of the screen's outline, top centre round the corner and
    /// down to `foot`, OUTSET by half the line so the stroke's inner edge sits
    /// on the glass's edge (all of it off screen) and stays concentric with its
    /// corner.
    private static func halfPath(in b: CGRect, radius: CGFloat, foot: CGFloat) -> UIBezierPath {
        let i = -line / 2
        let r = max(0, radius - i)
        let rect = b.insetBy(dx: i, dy: i)
        let p = UIBezierPath()
        p.move(to: CGPoint(x: rect.midX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(withCenter: CGPoint(x: rect.maxX - r, y: rect.minY + r), radius: r,
                 startAngle: -.pi / 2, endAngle: 0, clockwise: true)
        p.addLine(to: CGPoint(x: rect.maxX, y: max(rect.minY + r, foot)))
        return p
    }

    /// The display's corner, by panel. The exact number is only on a private
    /// API (`_displayCornerRadius`), which is an App Store risk, so this is the
    /// published table keyed on `nativeBounds` height (which tells the X from
    /// the mini and the XR from the XS Max where the point size can't). A panel
    /// this doesn't know guesses from the home indicator: square corners
    /// without one, the commonest modern radius with one.
    private static func cornerRadius(for window: UIWindow?) -> CGFloat {
        let h = max(UIScreen.main.nativeBounds.width, UIScreen.main.nativeBounds.height)
        switch h {
        case 2436, 2688: return 39       // X, XS, 11 Pro; XS Max, 11 Pro Max
        case 1792: return 41.5           // XR, 11
        case 2340: return 44             // 12 mini, 13 mini
        case 2532: return 47.33          // 12, 13, 14, 16e
        case 2778: return 53.33          // 12/13 Pro Max, 14 Plus
        case 2556, 2796: return 55       // 14 Pro to 16, and their Max/Plus
        case 2622, 2868, 2736: return 62 // 16 Pro onward, Air (unverified)
        default:
            return (window?.safeAreaInsets.bottom ?? 0) > 0 ? 55 : 0
        }
    }

    /// The point `u` (0 to 1) of the way along the right stroke, as a turn
    /// round the screen's centre clockwise from the top: 0 to 0.25.
    private func turn(at u: CGFloat) -> CGFloat {
        let (rect, r, foot) = shape
        let top = max(0, rect.width / 2 - r)
        let corner = .pi * r / 2
        let down = max(0, foot - rect.minY - r)
        var d = u * (top + corner + down)
        let point: CGPoint
        if d <= top {
            point = CGPoint(x: rect.midX + d, y: rect.minY)
        } else if d - top <= corner {
            d -= top
            let a = -CGFloat.pi / 2 + (r > 0 ? d / r : 0)
            point = CGPoint(x: rect.maxX - r + r * cos(a), y: rect.minY + r + r * sin(a))
        } else {
            d -= top + corner
            point = CGPoint(x: rect.maxX, y: rect.minY + r + d)
        }
        let a = atan2(point.x - bounds.midX, bounds.midY - point.y)
        return min(0.25, max(0, a / (2 * .pi)))
    }

    /// Puts the tips at `t` along each stroke: whole up to `t - fade`, then a
    /// smoothstep down to nothing at `t` itself, written into the feather as
    /// angles, the right side and its mirror.
    private func draw(_ t: CGFloat) {
        reach = t
        let from = max(0, t - Self.fade)
        func alpha(_ u: CGFloat) -> CGFloat {
            let x = min(1, max(0, (t - u) / Self.fade))
            return x * x * (3 - 2 * x)
        }
        var stops: [(CGFloat, CGFloat)] = [(0, alpha(0))]
        for j in 0...Self.feather {
            let u = from + (t - from) * CGFloat(j) / CGFloat(Self.feather)
            stops.append((turn(at: u), alpha(u)))
        }
        let mirror = stops.reversed().map { (1 - $0.0, $0.1) }
        let all = stops + mirror
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        right.strokeEnd = t
        left.strokeEnd = t
        feather.locations = all.map { NSNumber(value: Double($0.0)) }
        feather.colors = all.map { UIColor(white: 0, alpha: $0.1).cgColor }
        CATransaction.commit()
    }

    /// Moves the tips without a finger, on the display's clock.
    private func animate(to t: CGFloat, over seconds: CFTimeInterval) {
        tween?.invalidate()
        tweenFrom = reach
        tweenTo = t
        tweenStart = CACurrentMediaTime()
        tweenLength = seconds
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        tween = link
    }

    @objc private func tick(_ link: CADisplayLink) {
        let u = min(1, (CACurrentMediaTime() - tweenStart) / tweenLength)
        let eased = 1 - pow(1 - u, 3)   // ease out
        draw(tweenFrom + (tweenTo - tweenFrom) * CGFloat(eased))
        if u >= 1 { link.invalidate(); tween = nil }
    }

    func set(state next: String, colors: [UIColor], depth: CGFloat?, quiet: Bool, land: Bool, in window: UIWindow) {
        if !colors.isEmpty { wear(colors) }
        if next != "idle" { self.depth = depth }
        if superview !== window {
            removeFromSuperview()
            window.addSubview(self)
        }
        frame = window.bounds
        // Above the native bars, and above anything presented since last time.
        window.bringSubviewToFront(self)
        generation += 1
        let was = state
        state = next
        switch next {
        case "pull": beginPull()
        case "spin": spin(quiet: quiet)
        default: finish(from: was, land: land)
        }
    }

    // MARK: pull

    private func beginPull() {
        tween?.invalidate()
        tween = nil
        layer.removeAllAnimations()
        ramp.removeAllAnimations()
        strokes.removeAllAnimations()
        setNeedsLayout()
        layoutIfNeeded()
        isHidden = false
        reached = 0
        armed = false
        detent.prepare()
        click.prepare()
        watch = scroll?.observe(\.contentOffset, options: [.initial, .new]) { [weak self] view, _ in
            let d = -(view.contentOffset.y + view.adjustedContentInset.top)
            self?.track(pull: max(0, d))
        }
    }

    private func track(pull d: CGFloat) {
        guard state == "pull" else { return }
        let p = min(d / Self.threshold, 1)
        draw(p)
        alpha = p > 0 ? 0.45 + 0.55 * p : 0

        // Detents on the way out only, firmer as the pull tightens. Backing off
        // re-arms the ones you backed off, so pulling again ticks again.
        let step = Int(floor(p * CGFloat(Self.detents)))
        if step > reached, step < Self.detents {
            reached = step
            detent.impactOccurred(intensity: 0.25 + 0.45 * p)
            detent.prepare()
        } else if step < reached {
            reached = step
        }

        // The threshold. A little give before it un-arms, so a thumb resting
        // on the line doesn't click twice.
        if p >= 1, !armed {
            armed = true
            click.impactOccurred(intensity: 0.9)
            click.prepare()
            bloom()
        } else if p < 0.9, armed {
            armed = false
        }
    }

    /// The halo swells once at the threshold.
    private func bloom() {
        let a = CAKeyframeAnimation(keyPath: "shadowRadius")
        a.values = [Self.halo, Self.halo * 1.7, Self.halo]
        a.keyTimes = [0, 0.35, 1]
        a.duration = 0.45
        a.timingFunction = CAMediaTimingFunction(name: .easeOut)
        strokes.add(a, forKey: "bloom")
    }

    // MARK: spin

    private func spin(quiet: Bool) {
        watch = nil
        setNeedsLayout()
        layoutIfNeeded()
        isHidden = false
        // Reach halfway from wherever the pull left it (a resume starts from
        // nothing and draws in from the top).
        animate(to: 1, over: 0.35)
        UIView.animate(withDuration: 0.25) { self.alpha = quiet ? 0.55 : 1 }
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        // Linear, never eased: an eased spinner lurches once a turn (views.md).
        let turn = CABasicAnimation(keyPath: "transform.rotation.z")
        turn.fromValue = 0
        turn.toValue = 2 * Double.pi
        turn.duration = 1.2 * Double(bands)   // 1.2s a run of the band, whatever the reach
        turn.repeatCount = .infinity
        ramp.add(turn, forKey: "turn")
        let breathe = CABasicAnimation(keyPath: "shadowRadius")
        breathe.fromValue = Self.halo
        breathe.toValue = Self.halo * 1.5
        breathe.duration = 1.2
        breathe.autoreverses = true
        breathe.repeatCount = .infinity
        breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        strokes.add(breathe, forKey: "breathe")
    }

    // MARK: idle

    private func finish(from was: String, land: Bool) {
        watch = nil
        guard !isHidden else { return }
        if was == "spin", land {
            detent.impactOccurred(intensity: 0.5)
        }
        let mine = generation
        // A pull let go short retracts the way it came; a refresh fades whole.
        if was == "pull" { animate(to: 0, over: 0.25) }
        UIView.animate(withDuration: was == "pull" ? 0.25 : 0.5, delay: 0,
                       options: [.beginFromCurrentState, .curveEaseOut]) {
            self.alpha = 0
        } completion: { _ in
            guard mine == self.generation else { return }
            self.tween?.invalidate()
            self.tween = nil
            self.isHidden = true
            self.ramp.removeAllAnimations()
            self.strokes.removeAllAnimations()
            self.draw(0)
        }
    }
}
