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
        CAPPluginMethod(name: "setPostBarText", returnType: CAPPluginReturnPromise)
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
    /// `bar` is `{live, visible, height, paper, controls: [...]}`; each control
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
    private let fab = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
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
        (pill.effect as? UIGlassEffect)?.isInteractive = true
        (fab.effect as? UIGlassEffect)?.isInteractive = true
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
            if let colors = fabSpec["colors"] as? [String], !colors.isEmpty {
                let stops = colors.compactMap(TriaChromeBar.color(fromHex:))
                if !stops.isEmpty { tintFab(stops[stops.count / 2]) }
            }
            if let ink = fabSpec["ink"] as? String, let inkColor = TriaChromeBar.color(fromHex: ink) {
                fabGlyph.tintColor = inkColor
            }
        }
    }

    /* TINTED GLASS, which is a different object from the web's + and worth
       saying why.

       On the web this disc is the one OPAQUE member of the primary-act set (see
       the long note beside `.nav-publish::before`), and both of the reasons are
       CSS reasons that dissolve here rather than being overruled. Thinning it in
       CSS would show live content sliding through the app's most permanent
       object, because a translucent fill composites against a SHARP backdrop;
       and the `backdrop-filter` that would soften it is a per-frame bill on a
       control that is up on every route over a scrolling feed, which is the cost
       floor CLAUDE.md refuses everywhere. Liquid Glass answers both — the
       material refracts and diffuses what is behind it, and the system draws it
       rather than us.

       So the colour goes INTO the material rather than on top of it. A thinned
       band laid over the glass was tried first and is not the same thing: an
       opaque-ish layer in the `contentView` hides the material entirely, so what
       you get is a slightly see-through disc with page text ghosting through it,
       which is the CSS failure mode wearing the native button's clothes.

       WHAT THIS COSTS: `tintColor` is one colour and `--pill-band` is a ramp, so
       the disc no longer shows the four brand stops travelling across it. The
       MIDDLE stop is the tint, which is exact for a reader's accent — those
       bands are three stops of a single hue (see `bandFrom` in app.js) — and a
       real reduction only for Tria's own default ramp, where four hues become
       the one at its centre. The ramp itself is not lost; it still paints the
       composer's Share button, the splash and every other `.publish-fill`. */
    private func tintFab(_ colour: UIColor) {
        guard let glass = fab.effect as? UIGlassEffect else { return }
        glass.tintColor = colour
        // Reassigned, not just mutated: a UIVisualEffectView caches the effect it
        // was handed, so a tint changed in place after the reader picks a colour
        // does not reach the material until the effect is set again.
        fab.effect = glass
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

/// Watches the web view's scroll offset so the material can appear when there
/// is finally something under it to separate the bar from.
///
/// This used to cross the bridge as a `bare` flag on every toolbar push, read
/// off the `.topbar--bare` class app.js maintains. It does not need to: the
/// question is "has the page scrolled", the answer is on a scroll view sitting
/// right here, and a fact native can read itself is one fewer thing that can
/// arrive a frame late.
///
/// KVO rather than the scroll delegate, because the web view's delegate is
/// WebKit's and taking it is a way to break scrolling itself.
@available(iOS 26.0, *)
final class TriaScrollWatch: NSObject {

    /// Far enough down that the rubber band's own fractional offsets on the way
    /// home don't flicker it. The same reasoning as `ANCHOR_SLACK` in app.js:
    /// iOS hands back sub-point offsets, so a threshold of zero is no threshold.
    private static let slack: CGFloat = 4

    private var token: NSKeyValueObservation?
    private var last: Bool?

    init(of source: UIScrollView, onScrolled: @escaping (Bool) -> Void) {
        super.init()
        token = source.observe(\.contentOffset, options: [.initial, .new]) { [weak self] view, _ in
            guard let self else { return }
            let under = view.contentOffset.y + view.adjustedContentInset.top > Self.slack
            guard under != self.last else { return }
            self.last = under
            onScrolled(under)
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
    private var shown = true
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
    /// from. Native's own reading of the scroll, not a flag from the web.
    private var atTop = true

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
            watch = TriaScrollWatch(of: scroller) { [weak self] under in
                guard let self, self.atTop == under else { return }
                self.atTop = !under
                self.syncMaterial(animated: true)
            }
        }
    }

    // MARK: State

    func apply(spec: [String: Any]) {
        live = spec["live"] as? Bool ?? false
        let visible = spec["visible"] as? Bool ?? true
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
        setShown(visible, animated: !isHidden)
        syncMaterial(animated: !isHidden)
        syncTitle(animated: !isHidden)
        material.frame = materialFrame()
    }

    /// The bar goes away on a scroll down (`.topbar--hidden`), and everything
    /// drawn on it has to go with it.
    ///
    /// A FADE, NOT A SLIDE, matching the web. It used to mirror the CSS
    /// `translateY(-100%)`, and a bar sliding up out of frame while the glass
    /// riding it materialised in place read as two animations stapled together
    /// — nothing else in 1.4 enters or leaves by travelling in from an edge.
    ///
    /// BUT NOT BY FADING THE CONTAINER, which is the trap this file already
    /// documents on `syncVisibility` and which the first attempt at this walked
    /// straight into. `alpha` on a UIVisualEffectView is unsupported, and on a
    /// GLASS CONTAINER it is worse than unsupported: the container renders its
    /// nested glass in a pass of its own, so `contentView.alpha` left the discs
    /// drawn at partial strength and re-rendering every frame. That, plus the
    /// CSS material fading IN over the top of it, is what "the opacity and the
    /// blur are competing" was.
    ///
    /// What DOES honour alpha is a nested glass ELEMENT — the same fact the
    /// composer's + is already animated on. So the discs are faded one by one
    /// and the search capsule with them. Two alphas that work beats one the
    /// system quietly refuses.
    private func setShown(_ visible: Bool, animated: Bool) {
        guard visible != shown else { return }
        shown = visible
        let move = {
            for control in self.controls.values { control.alpha = visible ? 1 : 0 }
            self.search?.alpha = visible ? 1 : 0
            self.titleLabel.alpha = (visible && self.wantsTitle) ? 1 : 0
            self.material.alpha = (visible && self.live && !self.atTop) ? 1 : 0
        }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.36, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState,
                                     .curveEaseOut], animations: move)
        } else {
            move()
        }
        isUserInteractionEnabled = visible
    }

    /* THE MATERIAL LEAVES WITH THE BUTTONS. It briefly did not.

       There was a version that kept the safe-area strip behind when the bar
       tucked away, on the reasoning that the clock still needs something under
       it — the job `.statusbar-scrim` was added to do. It is the wrong trade.
       A reader scrolling down asked for the chrome to go, and a glass tab
       hanging in the notch after the bar it belonged to has gone is a leftover,
       not a courtesy. iOS resolves the status bar against what is behind it and
       is allowed to do that over the page, the way it does in every app that
       scrolls content under the clock.

       So the material is a plain function of two booleans: on a page that has
       scrolled (there is something beneath the bar to separate it from — the
       same reading `.topbar--bare` is, taken natively) and with the bar shown.
       Neither one alone.

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
        let wanted: CGFloat = (live && !atTop && shown) ? 1 : 0
        guard material.alpha != wanted else { return }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.24, delay: 0,
                           options: [.allowUserInteraction, .beginFromCurrentState,
                                     .curveEaseOut]) { self.material.alpha = wanted }
        } else {
            material.alpha = wanted
        }
    }

    /// The title's own arrival, which is a different event from the bar's: the
    /// page's big serif name has scrolled out from under the bar and the small
    /// one takes over. `--dur-quick`, the same the CSS rule used.
    ///
    /// The web crossfades it on opacity AND a 6px blur. Only the opacity comes
    /// over: a blur on a UILabel means rasterising it into a layer every frame
    /// of the ramp, which is the cost this whole pass exists to stop paying,
    /// and at 16.8pt over a quarter of a second nobody has ever seen it.
    private func syncTitle(animated: Bool) {
        let wanted: CGFloat = (shown && wantsTitle) ? 1 : 0
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

    func update(spec: [String: Any]) {
        frame = CGRect(x: TriaToolbar.number(spec["x"]), y: TriaToolbar.number(spec["y"]),
                       width: TriaToolbar.number(spec["w"]), height: TriaToolbar.number(spec["h"]))
        wantsMenu = spec["menu"] as? Bool ?? false
        button.accessibilityLabel = spec["label"] as? String
        button.accessibilityTraits = .button

        let glyph = spec["glyph"] as? String ?? ""
        let ink = spec["ink"] as? String ?? ""
        let tint = spec["tint"] as? String ?? ""
        let text = spec["text"] as? String ?? ""
        let after = spec["after"] as? String ?? ""
        // Everything the drawing depends on, in one string. Cheaper than four
        // comparisons and it cannot forget a field.
        let key = [glyph, ink, tint, text, after, "\(frame.width)"].joined(separator: "|")
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
            // The tinted kinds — the editor's Save and the daily's pill — wear
            // the same tinted glass the compose + does, for the same reason: on
            // the web they are `.publish-fill.is-solid`, one family of primary
            // acts. Reassigned rather than mutated (see tintFab).
            if let glass = effect as? UIGlassEffect {
                glass.tintColor = TriaChromeBar.color(fromHex: tint)
                effect = glass
            }
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
        }
        if UIAccessibility.isReduceMotionEnabled {
            alpha = hidden ? 0 : 1
            transform = .identity
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

/// A POST'S COMMENT BAR, WHICH IS THE ONE PIECE OF CHROME THAT HOLDS A CARET.
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
final class TriaPostBarPill: UIVisualEffectView, UITextViewDelegate {

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
    private let hint = UILabel()
    /// NOT GLASS, and that is the stylesheet's rule rather than a saving. The
    /// disc sits on a surface that already blurs, and a sample of its own would
    /// be the one stack "never glass on glass" has never allowed — which is
    /// exactly what it looked like when it was one: a soft blue halo instead of
    /// a disc. On the web it is `.publish-fill.is-solid` thinned to --pill-alpha
    /// over the page, so here it is the band at that same alpha.
    private let disc = UIView()
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

        hint.isUserInteractionEnabled = false
        contentView.addSubview(hint)

        disc.layer.cornerCurve = .continuous
        send.translatesAutoresizingMaskIntoConstraints = false
        disc.addSubview(send)
        NSLayoutConstraint.activate([
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
        attrs = [.font: TriaPostBarPill.face,
                 .paragraphStyle: paragraph,
                 .foregroundColor: ink]
        setBody(field.text ?? "")
        field.tintColor = (spec["caret"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:)) ?? ink
        field.accessibilityLabel = spec["label"] as? String
        hint.text = spec["placeholder"] as? String
        hint.font = TriaPostBarPill.face
        // The web's placeholder is --muted at 0.75. Baked into the colour rather
        // than set as a view alpha, so the label composites once.
        hint.textColor = muted.withAlphaComponent(0.75)

        // THE AVATAR IS THE MONOGRAM WITH THE PHOTOGRAPH OVER IT, in that order
        // and for the reason avatarEl gives: a face that pops in a frame late
        // reads as a reload, so the letter is there from the first paint and the
        // picture lands on top of it when it arrives.
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

        send.accessibilityLabel = spec["sendLabel"] as? String
        if let glyph = spec["glyph"] as? String, !glyph.isEmpty {
            let pillInk = (spec["pillInk"] as? String)
                .flatMap(TriaChromeBar.color(fromHex:)) ?? .white
            send.setImage(TriaSVG.image(markup: glyph, size: 22, ink: pillInk, template: false),
                          for: .normal)
        }
        // The band, thinned. --pill-alpha is a CONTRAST FLOOR rather than a
        // taste setting (the measured figures live beside the token in
        // tokens.css), so it is read off the web disc's own ::before rather than
        // quoted here. The hairline is --glass-edge, resolved the same way.
        let alpha = TriaToolbar.number(spec["tintAlpha"], fallback: 1)
        disc.backgroundColor = (spec["tint"] as? String)
            .flatMap(TriaChromeBar.color(fromHex:))?.withAlphaComponent(alpha)
        // No colour, no border: a nil borderColor with a width set draws the
        // layer's own opaque black, which is a hard ring where a 10% hairline
        // was asked for.
        if let edge = (spec["edge"] as? String).flatMap(TriaChromeBar.color(fromHex:)) {
            disc.layer.borderColor = edge.cgColor
            disc.layer.borderWidth = TriaToolbar.number(spec["edgeWidth"], fallback: 0)
        } else {
            disc.layer.borderWidth = 0
        }
        syncIdle()
        setNeedsLayout()
    }

    /// Every write restates the attributes, because assigning `attributedText`
    /// throws away the typing ones. See `attrs`.
    private func setBody(_ text: String) {
        field.attributedText = NSAttributedString(string: text, attributes: attrs)
        field.typingAttributes = attrs
    }

    func setText(_ text: String, selection: Int) {
        guard field.text != text else { return }
        setBody(text)
        let caret = max(0, min(selection, (text as NSString).length))
        field.selectedRange = NSRange(location: caret, length: 0)
        syncIdle()
        onChange?()
    }

    func startEditing() { if !field.isFirstResponder { field.becomeFirstResponder() } }
    func stopEditing() { field.resignFirstResponder() }

    /// `.is-idle`: an empty bar has nothing to send, and a lit gradient disc with
    /// no act behind it is the brand band spent on nothing. Out of the
    /// accessibility tree with the same flip, so a visible send is always a live
    /// one — the web's contract, restated.
    private func syncIdle() {
        let text = field.text ?? ""
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
        let text = field.text ?? ""
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

        field.frame = CGRect(x: textLeft, y: pad + fieldPad, width: textWidth,
                             height: max(line, box.height - 2 * pad - 2 * fieldPad))
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

    /// The face's two states. Native flips this itself rather than being told,
    /// because it owns the caret and therefore already knows — the web's
    /// `.is-typing` and this are one rule written once on each side.
    ///
    /// The mark is only reachable while it is showing, the same three flags in
    /// step the send disc keeps (see `setIdle`), so a face that can throw a
    /// comment away is always a face you can see it on.
    private func setTyping(_ wanted: Bool) {
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
