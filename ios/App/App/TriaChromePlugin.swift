import Foundation
import UIKit
import WebKit
import Capacitor
import CoreText

/// 1.4: Tria's bottom navigation, drawn by UIKit in the system's Liquid Glass.
///
/// The plan, the contract and the traps are in `docs/native-chrome.md`. The
/// short version, because it governs every line below:
///
/// **NATIVE IS A RENDERER, NOT A SECOND MODEL.** `js/app.js` remains the single
/// source of truth for what page you are on. This file is told; it never
/// decides. It knows four routes as opaque strings and hands one back when a
/// finger lands on it — it does not know what a Circle is, what Discover
/// filters, or that Updates could ever carry a count. Two things disagreeing
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
        CAPPluginMethod(name: "setChrome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToolbar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "menuReady", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissMenu", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPostBar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPostBarText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPageControls", returnType: CAPPluginReturnPromise)
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

    /// The top bar's controls, built on the first `setToolbar`. Held as its own
    /// availability-free protocol for the same reason `bar` is.
    private var toolbar: TriaToolbarControl?

    /// A post page's comment bar, built the first time one is mounted. Same
    /// availability dance again.
    private var postBar: TriaPostBarControl?

    /// The page's own primary acts — the composer's Share pill, the gate's
    /// submit, Share Tria, the daily's Add yours — built the first time a route
    /// carries one. Same availability dance again.
    private var pageControls: TriaPageControlsControl?

    /// Mounts the bars (first call) or restates them (later ones — the FAB's
    /// band changes when the reader picks a colour). Resolves with the geometry
    /// the web has to reserve; rejects, loudly and harmlessly, on anything that
    /// means "keep the CSS chrome".
    ///
    /// `tabs` is `[{route, label, icon}]` and `fab` is `{route, label, glyph,
    /// colors, ink}`. `icon` and `glyph` are SVG MARKUP — the same drawing the
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
            guard let host = self.bridge?.viewController?.view else {
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
                bar.install(in: host)
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
    /// rebuild the tab row to repaint one disc.
    @objc func setFab(_ call: CAPPluginCall) {
        let fab = call.getObject("fab")
        DispatchQueue.main.async { [weak self] in
            self?.bar?.apply(tabs: nil, fab: fab)
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

    /// The page's own primary acts, stated whole on every change: the composer's
    /// **Share** pill, the auth gate's submit, **Share Tria** and the daily
    /// card's **Add yours**.
    ///
    /// These are the one set of native controls that do NOT live on a bar, and
    /// what that costs is written on `TriaPageButton`. The short version: they
    /// sit in content that scrolls, so each one crosses with a `docY` — its
    /// position in the DOCUMENT rather than on the screen — and the container
    /// tracks the web view's own `contentOffset` to keep it there. `band` is the
    /// strip between the two bars that app.js already measures for the anchored
    /// menus; the container is clipped to it, which is the whole answer to a
    /// native button scrolling under native chrome.
    ///
    /// An empty `controls` is a route with no primary act on it, which is most
    /// of them — the set empties rather than the view going away, so the
    /// container is built once and the scroll observation is never restarted.
    @objc func setPageControls(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Liquid Glass needs iOS 26; the painted CTAs stay.")
            return
        }
        let controls = (call.getArray("controls") as? [[String: Any]]) ?? []
        let bandSpec = call.getObject("band") ?? [:]
        let band = CGRect(x: 0,
                          y: TriaToolbar.number(bandSpec["top"]),
                          width: TriaToolbar.number(bandSpec["width"]),
                          height: max(0, TriaToolbar.number(bandSpec["bottom"])
                                        - TriaToolbar.number(bandSpec["top"])))
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view controller to hang the page controls on.")
                return
            }
            let controlsView: TriaPageControls
            if let existing = self.pageControls as? TriaPageControls {
                controlsView = existing
            } else {
                controlsView = TriaPageControls()
                // A tap is handed straight back. app.js finds the web element by
                // the id it minted and clicks it, so the page's own handler is
                // still the only implementation of what the button does — the
                // same contract `toolbarTap` crosses on.
                controlsView.onTap = { [weak self] id in
                    self?.notifyListeners("pageTap", data: ["id": id])
                }
                controlsView.install(in: host, scroller: self.bridge?.webView?.scrollView)
                self.pageControls = controlsView
            }
            controlsView.apply(controls: controls, band: band)
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
}

/// What the plugin is allowed to say to the bar.
///
/// It exists for one reason: it carries no availability annotation, so the
/// plugin can hold a reference to a control it can only *build* on iOS 26. See
/// the note on `bar` above.
protocol TriaChromeControl: AnyObject {
    func apply(tabs: [[String: Any]]?, fab: [String: Any]?)
    func select(route: String)
    func setVisibility(chrome: Bool, fab: Bool)
    func reservedBottom() -> CGFloat
}

// MARK: - The bar

/// The floating pill and the + beside it, in real glass.
///
/// This is a `UIGlassContainerEffect` view spanning the bottom of the screen,
/// with the two glass elements nested in its `contentView` — the configuration
/// the header calls for, and what makes the pair render as one glass system
/// (shared environment sampling, one set of highlights) rather than two
/// unrelated blurs that happen to be adjacent.
///
/// It is NOT a `UITabBar`, and the reason is that Tria's bar is not one: it is a
/// detached capsule of four icons with a round Post button breaking out beside
/// it, and it has been that since the July 2026 nav overhaul (see the mobile
/// block of `css/app.css`). A `UITabBar` would draw a full-width bar with a
/// different selection idiom, so "go native" would have meant "adopt a different
/// design", which is not what 1.4 is. What that costs is spelled out in
/// `docs/native-chrome.md`: the accessibility tree is built by hand below, and
/// the icons don't scale with Dynamic Type — which is parity with the web bar,
/// whose `.nav-ico` is a fixed 28px, not a regression.

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
            ramp?.paint(stops, alpha: rampAlpha(glass.traitCollection.userInterfaceStyle))
        }
        return wantsRamp
    }
}

@available(iOS 26.0, *)
final class TriaChromeBar: UIVisualEffectView, TriaChromeControl {

    // Every one of these is a figure from the mobile block of css/app.css, and
    // they are the copy — change one there, change it here. CSS rem is 16px and
    // a CSS px is a point, so the conversions are exact rather than eyeballed.
    private enum Metric {
        static let tabSide: CGFloat = 50        // .nav-link
        static let tabIcon: CGFloat = 28        // .nav-link .nav-ico
        static let tabGap: CGFloat = 4.8        // .nav-pill gap: 0.3rem
        static let pillPadX: CGFloat = 8.8      // .nav-pill padding-inline: 0.55rem
        static let pillPadY: CGFloat = 6.4      // .nav-pill padding-block: 0.4rem
        static let fabSize: CGFloat = 56        // --fab-size
        static let fabIcon: CGFloat = 30        // .nav-publish .nav-ico
        static let navGap: CGFloat = 11.2       // --nav-gap: 0.7rem
        static let float: CGFloat = 8           // .nav bottom: 0.5rem above the safe area
        /// Slack around the glass inside the container, so `--glass-lift` — the
        /// soft drop that makes the pill visibly float off the page — isn't
        /// clipped by the container's own bounds. It is padding, not chrome:
        /// `reservedBottom()` measures past it, and `point(inside:)` never
        /// answers for it.
        static let shadowPad: CGFloat = 24
        /// The web reserves a little more than the bar's own height so a feed's
        /// last card clears the glass rather than tucking under its edge.
        static let clearance: CGFloat = 16
    }

    /// `--muted` / `--text` from css/tokens.css, in the one form CSS can't
    /// reach. A trait-closure UIColor re-resolves itself when the system scheme
    /// flips, so this needs no `traitCollectionDidChange` — the same trick, and
    /// the same standing obligation, as `TriaViewController.paper`.
    private static let idleInk = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.588, green: 0.612, blue: 0.639, alpha: 1)   // #969ca3
        : UIColor(red: 0.361, green: 0.388, blue: 0.420, alpha: 1)   // #5c636b
    }
    private static let liveInk = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.914, green: 0.922, blue: 0.929, alpha: 1)   // #e9ebed
        : UIColor(red: 0.078, green: 0.090, blue: 0.102, alpha: 1)   // #14171a
    }
    /// `.nav-pill .nav-link { opacity: 0.4 }` — where you are is told by ink AND
    /// opacity, and dimming the three you are not on is the whole control.
    private static let idleAlpha: CGFloat = 0.4

    var onTap: ((String) -> Void)?
    var onMetrics: ((CGFloat) -> Void)?

    private let pill = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
    /// REGULAR glass, and the effect on it is replaced rather than tuned:
    /// `TriaBand.apply` hands it a fresh one whenever the band changes, because
    /// that is the only way a tint reaches the material. Clear glass was tried
    /// and is wrong for this control — it is transparent enough that the disc
    /// takes its value from whatever photograph is behind it, and the + is up
    /// on every route over a scrolling feed.
    private let fab = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
    /// There is no ramp under the + . It wore one for as long as it wore Tria's
    /// band, and that band was the only thing a ramp was ever for; the + takes
    /// an accent as a tint on the glass and everything else as plain glass. See
    /// `fabSpec` in app.js. What went with the ramp is a sibling view that the
    /// fade and the sink below had to move, hide and show by hand.
    private let row = UIStackView()
    private let fabGlyph = UIImageView()
    private let fabButton = UIButton(type: .custom)

    private var routes: [String] = []
    private var fabRoute = ""
    private var pillCenterX: NSLayoutConstraint?
    private var fabCenterX: NSLayoutConstraint?

    /// What JS asked for, kept apart from what is on screen: the keyboard also
    /// gets a vote (see `keyboardChanged`), and when it goes down the bar has to
    /// return to the state the router last named rather than to "visible".
    private var wantsChrome = true
    private var wantsFab = true
    private var keyboardUp = false
    private var lastReportedBottom: CGFloat = -1

    init() {
        // spacing 0, deliberately. The container's job here is combined
        // rendering; the merge is a separate behaviour and Tria's design keeps
        // the pill and the + as two distinct objects with air between them.
        // A spacing at or above --nav-gap would fuse them into one blob.
        let container = UIGlassContainerEffect()
        container.spacing = 0
        super.init(effect: container)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: Building

    private func build() {
        translatesAutoresizingMaskIntoConstraints = false

        // Interactive glass: the system's own press response, which is why
        // there are no touch-down handlers below adding a scale of our own. It
        // is also why there is no haptic here — system controls buzz
        // themselves, and Tria's own rule reserves a buzz for an act that
        // changed the shared world, which a navigation never is.
        // The pill's own press response. The +'s is set by `TriaBand.apply`,
        // which hands it a whole new effect every time its band changes — see
        // the note there about mutating a cached one.
        (pill.effect as? UIGlassEffect)?.isInteractive = true
        pill.cornerConfiguration = .capsule()
        fab.cornerConfiguration = .capsule()
        pill.translatesAutoresizingMaskIntoConstraints = false
        fab.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(pill)
        contentView.addSubview(fab)

        // VoiceOver reads the capsule as a tab bar and each disc as a button
        // that is or isn't selected — built by hand, because a custom control
        // gets none of that free. Icon-only tabs have no visible label, so
        // `accessibilityLabel` off the route's own name is the only name there
        // is, and it is not optional.
        pill.contentView.accessibilityTraits = .tabBar
        row.axis = .horizontal
        row.spacing = Metric.tabGap
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        pill.contentView.addSubview(row)

        fabGlyph.translatesAutoresizingMaskIntoConstraints = false
        fabGlyph.contentMode = .center
        fabButton.translatesAutoresizingMaskIntoConstraints = false
        fabButton.addTarget(self, action: #selector(fabTapped), for: .touchUpInside)
        fab.contentView.addSubview(fabGlyph)
        fab.contentView.addSubview(fabButton)
        let pillX = pill.centerXAnchor.constraint(equalTo: contentView.centerXAnchor)
        let fabX = fab.centerXAnchor.constraint(equalTo: contentView.centerXAnchor)
        pillCenterX = pillX
        fabCenterX = fabX

        let pillHeight = Metric.tabSide + 2 * Metric.pillPadY

        NSLayoutConstraint.activate([
            pill.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            pill.heightAnchor.constraint(equalToConstant: pillHeight),
            pillX,
            row.leadingAnchor.constraint(equalTo: pill.contentView.leadingAnchor, constant: Metric.pillPadX),
            row.trailingAnchor.constraint(equalTo: pill.contentView.trailingAnchor, constant: -Metric.pillPadX),
            row.topAnchor.constraint(equalTo: pill.contentView.topAnchor, constant: Metric.pillPadY),
            row.bottomAnchor.constraint(equalTo: pill.contentView.bottomAnchor, constant: -Metric.pillPadY),

            fab.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            fab.widthAnchor.constraint(equalToConstant: Metric.fabSize),
            fab.heightAnchor.constraint(equalToConstant: Metric.fabSize),
            fabX,
            fabGlyph.centerXAnchor.constraint(equalTo: fab.contentView.centerXAnchor),
            fabGlyph.centerYAnchor.constraint(equalTo: fab.contentView.centerYAnchor),
            fabButton.leadingAnchor.constraint(equalTo: fab.contentView.leadingAnchor),
            fabButton.trailingAnchor.constraint(equalTo: fab.contentView.trailingAnchor),
            fabButton.topAnchor.constraint(equalTo: fab.contentView.topAnchor),
            fabButton.bottomAnchor.constraint(equalTo: fab.contentView.bottomAnchor)
        ])

        // The keyboard is the one piece of geometry the web layer genuinely
        // cannot see from in here. Capacitor's webview does not resize when the
        // keyboard comes up, so a CSS `position: fixed` bar simply ends up
        // BEHIND the keyboard and out of sight — which is what 1.3 does, and it
        // is right. A native bar has no such luck: it would float ON TOP of the
        // keyboard, over the compose form's own controls. So the bar answers
        // the keyboard itself. That is geometry, not navigation — it never
        // changes which tab is lit, and the state the router named is restored
        // the moment the keyboard goes down.
        let centre = NotificationCenter.default
        centre.addObserver(self, selector: #selector(keyboardShown),
                           name: UIResponder.keyboardWillShowNotification, object: nil)
        centre.addObserver(self, selector: #selector(keyboardHidden),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    func install(in host: UIView) {
        host.addSubview(self)
        NSLayoutConstraint.activate([
            leadingAnchor.constraint(equalTo: host.leadingAnchor),
            trailingAnchor.constraint(equalTo: host.trailingAnchor),
            // `.nav { bottom: calc(0.5rem + env(safe-area-inset-bottom)) }` —
            // iOS floating tab bars hug the home indicator rather than being
            // lifted well into the screen, and the safe-area inset has already
            // reserved the indicator itself.
            bottomAnchor.constraint(equalTo: host.safeAreaLayoutGuide.bottomAnchor,
                                    constant: -Metric.float + Metric.shadowPad),
            heightAnchor.constraint(equalToConstant: Metric.tabSide + 2 * Metric.pillPadY
                                    + 2 * Metric.shadowPad)
        ])
    }

    // MARK: State

    func apply(tabs: [[String: Any]]?, fab fabSpec: [String: Any]?) {
        if let tabs {
            routes = tabs.compactMap { $0["route"] as? String }
            row.arrangedSubviews.forEach { $0.removeFromSuperview() }
            for (index, tab) in tabs.enumerated() {
                let button = UIButton(type: .custom)
                button.translatesAutoresizingMaskIntoConstraints = false
                button.setImage(TriaSVG.image(markup: tab["icon"] as? String ?? "",
                                              size: Metric.tabIcon, ink: .black,
                                              template: true), for: .normal)
                button.tag = index
                // INKED HERE, not left to `selectTab`. A template image with no
                // tintColor of its own inherits the window's, which is
                // systemBlue — and `setTabs` and `selectTab` are two bridge
                // calls a frame or more apart, so the bar's first paint was four
                // blue glyphs. Idle is the right guess for three of the four,
                // and `select` corrects the fourth on the same run loop.
                button.tintColor = Self.idleInk
                button.alpha = Self.idleAlpha
                button.accessibilityLabel = tab["label"] as? String
                button.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
                NSLayoutConstraint.activate([
                    button.widthAnchor.constraint(equalToConstant: Metric.tabSide),
                    button.heightAnchor.constraint(equalToConstant: Metric.tabSide)
                ])
                row.addArrangedSubview(button)
            }
            // Both offsets are the group centred as a whole, the way
            // `.nav { justify-content: center }` centres [pill, +] together —
            // so the pill sits left of centre by half the +'s footprint and the
            // + sits right of centre by half the pill's.
            let pillWidth = CGFloat(tabs.count) * Metric.tabSide
                + CGFloat(max(tabs.count - 1, 0)) * Metric.tabGap
                + 2 * Metric.pillPadX
            pillCenterX?.constant = -(Metric.fabSize + Metric.navGap) / 2
            fabCenterX?.constant = (pillWidth + Metric.navGap) / 2
        }
        if let fabSpec {
            fabRoute = fabSpec["route"] as? String ?? fabRoute
            // Drawn from the same markup the web +'s own <svg> carries; see
            // TriaSVG for why there is no second copy of it in Swift any more.
            if let glyph = fabSpec["glyph"] as? String, !glyph.isEmpty {
                fabGlyph.image = TriaSVG.image(markup: glyph, size: Metric.fabIcon,
                                               ink: .black, template: true)
            }
            fabButton.accessibilityLabel = fabSpec["label"] as? String ?? fabButton.accessibilityLabel
            TriaBand.apply(fabSpec, glass: fab)
            // `.label` when the spec names no ink, which is what "no colour"
            // sends: a bare + wears the system's own, right in both schemes.
            fabGlyph.tintColor = TriaChromeBar.color(fromHex: fabSpec["ink"] as? String ?? "")
                ?? .label
        }
    }

    func select(route: String) {
        for (index, button) in row.arrangedSubviews.enumerated() {
            guard let button = button as? UIButton, index < routes.count else { continue }
            let live = routes[index] == route
            button.tintColor = live ? Self.liveInk : Self.idleInk
            button.alpha = live ? 1 : Self.idleAlpha
            if live { button.accessibilityTraits.insert(.selected) }
            else { button.accessibilityTraits.remove(.selected) }
        }
    }

    func setVisibility(chrome: Bool, fab fabVisible: Bool) {
        wantsChrome = chrome
        wantsFab = fabVisible
        syncVisibility(animated: true)
    }

    private func syncVisibility(animated: Bool) {
        let chromeUp = wantsChrome && !keyboardUp
        let fabUp = chromeUp && wantsFab

        /* THE WHOLE CHROME GOES BY `isHidden`, NEVER BY `alpha`.
           `alpha` on a visual effect view is unsupported, and on a glass
           CONTAINER it silently does nothing useful: the container renders its
           nested glass elements in a pass of its own, so alpha 0 left the pill
           and the + drawn at partial strength on top of the post page's comment
           bar — measured, on the simulator, and it is why this is not a fade.
           Which is also the right answer: on the web these go with `display:
           none` and no transition at all (see body.postbar-live .nav), for the
           reason navigation.md gives about page changes. */
        isHidden = !chromeUp
        isUserInteractionEnabled = chromeUp
        fab.isUserInteractionEnabled = fabUp
        if fabUp { fab.isHidden = false }

        // The + itself is a nested glass ELEMENT rather than the container, and
        // it does honour alpha — so the composer's tuck keeps the fade and the
        // sink it has on the web: fades fast while it sinks slower, so it reads
        // as dropping behind the nav rather than blinking out.
        let apply = {
            self.fab.alpha = fabUp ? 1 : 0
            self.fab.transform = fabUp ? .identity
                : CGAffineTransform(translationX: 0, y: 14).scaledBy(x: 0.6, y: 0.6)
            // The + stays in flow at opacity 0 and the pill glides right by half
            // its footprint, which lands the pill's centre on the screen's —
            // the same recentring `.nav--compose` does in CSS, by the same
            // arithmetic.
            self.pill.transform = fabUp ? .identity
                : CGAffineTransform(translationX: (Metric.fabSize + Metric.navGap) / 2, y: 0)
        }
        // Hidden for real once it has finished sinking, so a + at alpha 0 can't
        // take a tap meant for the pill. Re-read rather than captured: a newer
        // state may have landed while this animation was running.
        let settle: (Bool) -> Void = { [weak self] _ in
            guard let self else { return }
            self.fab.isHidden = !(self.wantsChrome && !self.keyboardUp && self.wantsFab)
        }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.28, delay: 0,
                           usingSpringWithDamping: 0.9, initialSpringVelocity: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState],
                           animations: apply, completion: settle)
        } else {
            apply()
            settle(true)
        }
    }

    // MARK: Geometry

    /// What the web must stop drawing under, in CSS pixels — which are points,
    /// so this number needs no conversion. Measured from the bottom of the
    /// window to the top of the glass, plus the clearance a feed's last card
    /// wants. `main`'s padding reads it and never a hardcoded height, so the
    /// bar's size can move here without a stylesheet edit chasing it.
    func reservedBottom() -> CGFloat {
        guard let host = superview else { return 0 }
        return host.bounds.maxY - (frame.minY + Metric.shadowPad) + Metric.clearance
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // A rotation or a safe-area change moves the bar; the web has to be
        // told, and told only when the number actually changed, since this runs
        // on every layout pass.
        let bottom = reservedBottom()
        if abs(bottom - lastReportedBottom) > 0.5 {
            lastReportedBottom = bottom
            onMetrics?(bottom)
        }
    }

    /// The container spans the width of the screen so the two glass elements can
    /// share one environment, but it must not eat the taps and scrolls that
    /// belong to the page underneath. Returning false everywhere except over the
    /// pill and the + makes `hitTest` walk straight past it, which is the same
    /// contract `.nav { pointer-events: none }` gives the web row.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard isUserInteractionEnabled, alpha > 0.01 else { return false }
        for child in contentView.subviews where !child.isHidden && child.alpha > 0.01 {
            if child.point(inside: child.convert(point, from: self), with: event) { return true }
        }
        return false
    }

    // MARK: Taps and the keyboard

    @objc private func tabTapped(_ sender: UIButton) {
        guard sender.tag < routes.count else { return }
        // The route goes back to app.js, which calls the same `go('#/…')` the
        // CSS nav calls. Nothing is selected here — the highlight moves when
        // the router comes back with `selectTab`, so there is exactly one
        // navigation path and native never gets ahead of the history.
        onTap?(routes[sender.tag])
    }

    @objc private func fabTapped() {
        guard !fabRoute.isEmpty else { return }
        onTap?(fabRoute)
    }

    @objc private func keyboardShown() {
        keyboardUp = true
        syncVisibility(animated: true)
    }

    @objc private func keyboardHidden() {
        keyboardUp = false
        syncVisibility(animated: true)
    }

    // MARK: Colour

    /// `#rgb` / `#rrggbb` / `rgb(r, g, b)` — whatever app.js resolved the band
    /// to. It sends real numbers, never a token name: the band is the reader's
    /// own accent as often as it is Tria's ramp (see paintBrandBand), and a
    /// native copy of that derivation would be a second place for it to drift.
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

    init() {
        super.init(effect: UIGlassEffect(style: .regular))
        // A backdrop. Every tap in this rect belongs to a disc on top of it or
        // to the page underneath.
        isUserInteractionEnabled = false
        // Square, deliberately, where every other piece of glass in Tria is a
        // capsule: this one is not an object, it is the top edge of the screen.
        cornerConfiguration = .uniformCorners(radius: .fixed(0))
        alpha = 0
        // Glass draws a specular rim on every edge it has, which is exactly
        // right for a disc you can pick out with a finger and exactly wrong
        // here: a lit rectangle over a photograph reads as a panel dropped on
        // the page rather than as the top of the screen. First build of this had
        // all four, bevelled corners included. So three of the four edges are
        // pushed off-screen (see `frame(for:)`) and the only rim left is the
        // bottom one, which is the edge a bar is supposed to have.
        clipsToBounds = false
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
    private static let rimSlack: CGFloat = 60
    private var barHeight: CGFloat = 0
    private var watch: TriaScrollWatch?
    /// Whether this route draws a bar at all. Signed out there is none.
    private var live = false
    /// The collapsing small title. See `titleSpec` in app.js for why it is here
    /// rather than in the web bar it is still measured against.
    private let titleLabel = UILabel()
    private var wantsTitle = false
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
        host.addSubview(material)
        host.addSubview(self)
        self.scroller = scroller
        if let scroller {
            watch = TriaScrollWatch(of: scroller) { [weak self] state in
                guard let self, state != self.scroll else { return }
                self.scroll = state
                self.syncMaterial(animated: true)
                self.syncTitle(animated: true)
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
            control.update(spec: item)
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

    /* THE BAR NO LONGER HIDES ON A SCROLL DOWN, and this is where that used to
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
    private func materialFrame() -> CGRect {
        let slack = TriaToolbar.rimSlack
        let strip = max(barHeight, safeAreaInsets.top)
        return CGRect(x: -slack, y: -slack,
                      width: bounds.width + 2 * slack, height: strip + slack)
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
    private func syncTitle(animated: Bool) {
        let wanted: CGFloat = (wantsTitle && headerUp) ? 1 : 0
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
        }

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
        let hidden = spec["hidden"] as? Bool ?? false
        isUserInteractionEnabled = !hidden
        let settle = {
            self.alpha = hidden ? 0 : 1
            self.transform = hidden ? CGAffineTransform(scaleX: 0.82, y: 0.82) : .identity
            // The ramp is a sibling and none of the above reaches it. Inside the
            // same block, or the colour hangs in the air behind a Save that has
            // already faded out.
            self.ramp.alpha = self.alpha
            self.ramp.transform = self.transform
        }
        if UIAccessibility.isReduceMotionEnabled {
            alpha = hidden ? 0 : 1
            transform = .identity
            ramp.alpha = alpha
            ramp.transform = .identity
        } else if alpha != (hidden ? 0 : 1) {
            UIView.animate(withDuration: 0.24, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState],
                           animations: settle)
        } else {
            settle()
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
                                                  constant: -float)
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
        bottomConstraint?.constant = -(keyboardUp ? floatKeyboard : float)

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
    func setText(_ text: String, selection: Int, focus: Bool) {
        pill.setText(text, selection: selection)
        if focus { pill.startEditing() }
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
        bottomConstraint?.constant = -float
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

        applyDisc(spec, muted: muted)
        syncIdle()
        setNeedsLayout()
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
        setIdle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, animated: true)
    }

    private func setIdle(_ wanted: Bool, animated: Bool) {
        guard wanted != idle || !animated else { return }
        idle = wanted
        disc.isUserInteractionEnabled = !wanted
        disc.accessibilityElementsHidden = wanted
        if !animated || UIAccessibility.isReduceMotionEnabled {
            disc.alpha = wanted ? 0 : 1
            disc.transform = .identity
            return
        }
        // The scale is the only part that is motion; the fade stays, because
        // appearing instantly is the pop this exists to avoid. Same waiver the
        // web takes for .toolbar-commit.
        UIView.animate(withDuration: 0.18, delay: 0,
                       options: [.allowUserInteraction, .beginFromCurrentState]) {
            self.disc.alpha = wanted ? 0 : 1
            self.disc.transform = wanted ? CGAffineTransform(scaleX: 0.7, y: 0.7) : .identity
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


/// The availability-free face of `TriaPageControls`, so the plugin can hold one
/// without becoming iOS 26-only itself. Same dance as `TriaAnchoredControl`.
protocol TriaPageControlsControl: AnyObject {
    func apply(controls: [[String: Any]], band: CGRect)
}


/// THE PAGE'S OWN PRIMARY ACTS, IN REAL GLASS.
///
/// The composer's **Share** pill, the auth gate's submit, **Share Tria** at the
/// foot of Discover and the daily card's **Add yours**. On the web these are
/// `.publish-fill.is-solid` — a painted gradient with a hairline and a rim,
/// which is a very good impression of the material and is not the material.
///
/// THIS IS A DELIBERATE MOVE OF THE LINE `docs/native-chrome.md` DREW, and the
/// line is worth restating before the exception is read as the rule. "Not
/// native, ever: content" was about CARDS, the feed, the composer FORM — the
/// things a reader reads. It was never about the one button on a page that
/// COMMITS. The post card's ••• already crossed this line for the menus, on the
/// argument that a control is a control wherever it happens to sit; this is the
/// same argument applied to the same kind of object, and the set is closed:
/// four primary acts, named one by one in app.js, not a rule about buttons.
///
/// WHAT MADE IT POSSIBLE, because it was not possible before. A native view at
/// a web rect does not move when the page under it does — measured, in this
/// repo, at "the anchor scrolled 400pt out from under a menu that never moved"
/// (see `watchAnchor` in app.js). A MENU can answer that by dismissing itself; a
/// BUTTON cannot, so the choice was to track or to stay painted. Tracking works
/// here for one reason: the offset is read by KVO on the web view's own
/// `scrollView.contentOffset` — the same signal `TriaScrollWatch` already reads
/// for the toolbar's material — which fires on the main thread in step with the
/// scroll, momentum included. The button is moved by the same runloop turn that
/// moved the content, so it is locked to the page rather than chasing it. A
/// `scroll` event bounced through the web view would not have been.
///
/// THE BAND IS THE CLIP, AND IT IS THE WHOLE ANSWER TO Z-ORDER. Every native
/// pixel is above every web pixel, and these sit in content that scrolls under
/// two bars. So the container is clipped to the band app.js measures between
/// them (`visibleBand`, already built for the anchored menus), and a button
/// leaving that band is cut off by the same edge the reader sees the web
/// content cut off by. Nothing is faded, nothing is special-cased, and a button
/// scrolled fully out draws nothing.
///
/// The web element stays the model, on exactly the terms every toolbar control
/// crosses on: it is still in the DOM, still hidden by the `data-chrome` gate,
/// and a tap here is handed back so app.js can click it. `.composer-post`'s
/// disabled state, the label Share Tria swaps to for 1.6s after a share, the
/// gate's own submit path — all of it is the code that already shipped.
@available(iOS 26.0, *)
final class TriaPageButton: UIVisualEffectView {

    let id: String
    let button = UIButton(type: .custom)
    var onTap: ((String) -> Void)?

    /// The band's backdrop, for the one of its three forms that needs one —
    /// Tria's four-hue ramp. See `TriaBand`, which decides. An accent tints the
    /// glass itself and "no colour" draws nothing, and in both of those this
    /// view stays hidden.
    ///
    /// It is a SIBLING (a `UIVisualEffectView` has nowhere to put anything
    /// behind its own material), which costs one extra line in
    /// `layout(scroll:in:)` — on the scroll path: the frame and the hidden flag
    /// are set for both on every offset change, or the colour scrolls out of
    /// step with the button sitting on it.
    let ramp = TriaBandRamp()

    /// Where the control sits in the DOCUMENT, not on the screen. The screen
    /// position is this minus wherever the scroller happens to be, recomputed on
    /// every offset change — which is what `layout(scroll:)` below is.
    var docY: CGFloat = 0
    var docX: CGFloat = 0
    var size: CGSize = .zero

    /// Whether the ramp is the form this control's band took, kept because the
    /// scroll path decides the ramp's visibility and must not un-hide the
    /// sibling of a button whose colour is on the glass or absent entirely.
    private var hasRamp = false

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
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// A navigation replaces the whole set, so this runs on every page change.
    override func removeFromSuperview() {
        ramp.removeFromSuperview()
        super.removeFromSuperview()
    }

    @objc private func tapped() { onTap?(id) }

    func update(spec: [String: Any]) {
        docX = TriaToolbar.number(spec["x"])
        docY = TriaToolbar.number(spec["docY"])
        size = CGSize(width: TriaToolbar.number(spec["w"]),
                      height: TriaToolbar.number(spec["h"]))
        button.accessibilityLabel = spec["label"] as? String
        button.accessibilityTraits = .button

        let glyph = spec["glyph"] as? String ?? ""
        let ink = spec["ink"] as? String ?? ""
        let band = (spec["colors"] as? [String] ?? []).joined(separator: ",")
        let tint = spec["tint"] as? String ?? ""
        let text = spec["text"] as? String ?? ""
        let after = spec["after"] as? String ?? ""
        let font = TriaToolbar.number(spec["font"], fallback: 14.4)
        let disabled = spec["disabled"] as? Bool ?? false
        /* THE SCHEME IS PART OF THE KEY, because `.label` is what an empty ink
           means and `.label` is not a value — it is two, and this cache would
           otherwise hold the one that was live when the face was last drawn.
           The ramp family gets away with it by accident (its stops are
           different hexes on ink paper, so the band alone changes the key);
           "no colour" sends no stops and no ink at all, so without this a bare
           control keeps a black label after sunset. */
        let scheme = traitCollection.userInterfaceStyle.rawValue
        let key = ["\(scheme)", glyph, ink, band, tint, text, after, "\(font)",
                   "\(disabled)", "\(size.width)"].joined(separator: "|")
        guard key != drawn else { return }
        drawn = key

        let inkColour = TriaChromeBar.color(fromHex: ink) ?? .label
        /* A CONFIGURATION, NOT `setTitle` + `setImage`, and that is the one way
           this differs from `TriaToolbarButton`. A toolbar control carries
           EITHER a glyph or words; Share Tria carries a mark LEADING its words,
           and the old pair of setters can only place an image beside a title
           through `imageEdgeInsets`, which iOS 15 deprecated and which a
           configuration ignores outright. `UIButton.Configuration` is the only
           API that still lays the two out together.

           The words are in the app's own face at the size the stylesheet set —
           the same contract `TriaToolbarButton.pill` records, except that these
           four are set at four DIFFERENT sizes (the gate's submit at 1.02rem,
           the composer's pill 0.95, Add yours 0.9, Share Tria 0.85), so the size
           is measured over there and sent rather than being one constant here.

           `.plain()` is transparent, which is what a face on glass has to be:
           the material is the view behind this button, and a configuration with
           a background of its own would sit on top of it — "never glass on
           glass", from the other direction. */
        var conf = UIButton.Configuration.plain()
        conf.contentInsets = .zero
        conf.attributedTitle = AttributedString(
            NSAttributedString(string: after.isEmpty ? text : "\(text)  \(after)",
                               attributes: [
                                   .font: TriaPageButton.face(font),
                                   .foregroundColor: inkColour
                               ]))
        if !glyph.isEmpty {
            conf.image = TriaSVG.image(markup: glyph, size: 15, ink: inkColour, template: false)
            conf.imagePlacement = .leading
            // 0.45rem, which is the `gap` .friends-share-copy sets between its
            // mark and its words. Measured there, not chosen here.
            conf.imagePadding = 7.2
        }
        button.configuration = conf

        hasRamp = TriaBand.apply(spec, glass: self, ramp: ramp)

        /* `.composer-post:disabled { opacity: 0.55 }` — the composer's pill is
           mounted before the form has anything to publish. Dimmed and inert,
           not removed: it is the page's anchor, and a commit that vanishes until
           you have earned it is a page that keeps changing shape while you fill
           it.

           THE DIM IS THE VIEW'S ALPHA AND THE INERTNESS IS THE VIEW'S, not
           `button.isEnabled`. A UIButton driven by a configuration dims its own
           title when disabled, on top of the 0.55 asked for here — 0.55 twice is
           0.30, which is a different button. Taking interaction off the effect
           view leaves the title's explicit colour alone and dims the glass with
           the words, which is what one translucent element becoming fainter
           looks like. */
        isUserInteractionEnabled = !disabled
        alpha = disabled ? 0.55 : 1
        // The sibling dims with it, or a disabled Share pill is a faint button
        // sitting on a full-strength band.
        ramp.alpha = alpha
    }

    /// Oxygen Bold at whatever size the stylesheet set, with the system face at
    /// the same size and weight as the fallback — see `TriaToolbarButton.pill`
    /// for why a real copy of the face is in the bundle at all.
    static func face(_ size: CGFloat) -> UIFont {
        UIFont(name: "Oxygen-Bold", size: size) ?? .systemFont(ofSize: size, weight: .bold)
    }

    /// Put the button where the page currently is. `scroll` is the scroller's
    /// own offset, so this is document space minus scroll space, which is screen
    /// space — and it is recomputed rather than animated, because the thing it
    /// is following is already being animated by UIKit.
    func layout(scroll: CGFloat, in band: CGRect) {
        frame = CGRect(x: docX, y: docY - scroll, width: size.width, height: size.height)
        // Fully outside the band is not "clipped to nothing", it is OFF — a
        // hidden view is not hit-tested, so a button scrolled under the tab bar
        // cannot take a tap meant for the bar.
        let onScreen = frame.maxY > band.minY && frame.minY < band.maxY
        isHidden = !onScreen
        ramp.frame = frame
        // Two reasons to be hidden and they are both live: scrolled out of the
        // band, or a control whose band is not a ramp.
        ramp.isHidden = isHidden || !hasRamp
    }
}


/// The container the four page controls live in, and the thing that keeps them
/// on the page while it scrolls. See `TriaPageButton` for why this exists at all.
@available(iOS 26.0, *)
final class TriaPageControls: UIView, TriaPageControlsControl {

    var onTap: ((String) -> Void)?

    private var buttons: [String: TriaPageButton] = [:]
    private weak var scroller: UIScrollView?
    private var token: NSKeyValueObservation?
    /// The band between the two bars, in the host's coordinates. The container's
    /// own frame IS the band, so `clipsToBounds` does the cutting.
    private var band = CGRect.zero

    init() {
        super.init(frame: .zero)
        clipsToBounds = true
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// A container that takes no taps of its own. Without this the clipped band
    /// is a full-width invisible sheet over the page, and every tap on a card
    /// inside it would land here instead of in the web view.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }

    func install(in host: UIView, scroller: UIScrollView?) {
        // UNDER the bars where they already exist, so the band's clip is a
        // second line of defence rather than the only one. At boot the bars are
        // installed first (setTabs, then setToolbar, then a page's controls), so
        // this normally finds one.
        if let chrome = host.subviews.first(where: { $0 is TriaChromeBar || $0 is TriaToolbar }) {
            host.insertSubview(self, belowSubview: chrome)
        } else {
            host.addSubview(self)
        }
        self.scroller = scroller
        guard let scroller else { return }
        // THE WHOLE REASON THIS IS POSSIBLE. Not a `scroll` event bounced out of
        // the web view — that arrives late and coalesced, and a button a frame
        // behind the words it belongs to reads as broken. `contentOffset` under
        // KVO fires on the main thread on the same turn UIKit moved the content.
        token = scroller.observe(\.contentOffset, options: [.initial, .new]) { [weak self] _, _ in
            self?.place()
        }
    }

    deinit { token?.invalidate() }

    /// The offset app.js's own `window.scrollY` agrees with. Capacitor pins the
    /// web view's content inset to zero (the same fact that puts the system's
    /// scroll edge effect out of reach — see `TriaToolbarMaterial`), so the
    /// adjusted inset is 0 and these two are the same number. Added anyway,
    /// because a build that stops pinning it should move the buttons, not slide
    /// them by the inset.
    private var offset: CGFloat {
        guard let scroller else { return 0 }
        return scroller.contentOffset.y + scroller.adjustedContentInset.top
    }

    func apply(controls: [[String: Any]], band: CGRect) {
        self.band = band
        frame = band
        var live = Set<String>()
        for spec in controls {
            guard let id = spec["id"] as? String, !id.isEmpty else { continue }
            live.insert(id)
            let button: TriaPageButton
            if let existing = buttons[id] {
                button = existing
            } else {
                button = TriaPageButton(id: id)
                button.onTap = { [weak self] tapped in self?.onTap?(tapped) }
                addSubview(button)
                insertSubview(button.ramp, belowSubview: button)
                buttons[id] = button
            }
            button.update(spec: spec)
        }
        // A control the page no longer draws. Navigations are the common case
        // and they replace the whole set at once.
        for (id, button) in buttons where !live.contains(id) {
            button.removeFromSuperview()
            buttons.removeValue(forKey: id)
        }
        place()
    }

    /// Every button, at the current scroll. Called on every offset change, so it
    /// does no work beyond the arithmetic.
    private func place() {
        let scroll = offset
        // The band is the container's frame, so a button's own coordinates are
        // relative to the band's top — which is why the band is passed through
        // in the container's own space rather than the host's.
        let local = CGRect(origin: .zero, size: band.size)
        for button in buttons.values {
            button.layout(scroll: scroll + band.minY, in: local)
        }
    }
}
