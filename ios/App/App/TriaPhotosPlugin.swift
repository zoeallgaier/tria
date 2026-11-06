import UIKit
import Capacitor
import PhotosUI
import UniformTypeIdentifiers

/// THE CAMERA ROLL IN THE COMPOSER (Zoe, 2026-11-06: "make it easier and
/// seamless to post images"). A row of the reader's recent photos under the
/// note, in Apple's own picker set into the page; a tap puts one in the post,
/// a second tap takes it out.
///
/// ── Why the system picker, and not our own strip ────────────────────────────
///
/// iOS 17 lets `PHPickerViewController` be EMBEDDED (`mode = .compact`, one
/// row) and report picks as they happen (`.continuous`). It runs out of
/// process, so Tria never sees the library: no "Tria would like to access your
/// photos", no limited-access half state, only the photos somebody taps. A
/// strip of our own (PhotoKit thumbnails, our corners and our check) would need
/// the whole library, and asking a new friend for every photo they own is not
/// the trade this app makes. What we give up is the thumbnails' look, which is
/// Apple's. iOS 15 and 16 have no embedded picker; the row simply isn't there
/// and the attach bar's photo button is the way in, as before.
///
/// ── Where it sits ───────────────────────────────────────────────────────────
///
/// INSIDE the web view's scroll view, at the document rect app.js measures off
/// `#c-roll` (a placeholder of the same size in the form). A subview of the
/// scroll view moves with the page for free, so nothing chases the scroll
/// frame by frame; app.js re-sends the rect whenever the form's layout moves.
/// It is drawn OVER every web pixel, so app.js hides it while a sheet is up.
///
/// ── What crosses the bridge ─────────────────────────────────────────────────
///
/// `rollPick { id, data, type }` per new pick (a GIF as its own bytes, anything
/// else upright and capped at 1600px as a JPEG, like the comment bar's picker),
/// `rollUnpick { id }` when one is unticked in the row. A still taken out on
/// the web side comes back as `rollDeselect`, which unticks it here without
/// echoing an unpick.
@objc(TriaPhotosPlugin)
public class TriaPhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaPhotosPlugin"
    public let jsName = "TriaPhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "rollReady", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "roll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rollDeselect", returnType: CAPPluginReturnPromise),
    ]

    /// A `TriaRoll` while the composer is up. `AnyObject` so the property can
    /// live on a class that also runs on iOS 15.
    private var strip: AnyObject?

    @objc func rollReady(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) { call.resolve(["ok": true]) } else { call.resolve(["ok": false]) }
    }

    /// `{ show, rect: {x, y, w, h}, radius, limit }` places and shows or hides
    /// the row; `{ drop: true }` takes it down for good (the composer went).
    @objc func roll(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard #available(iOS 17.0, *) else { call.resolve(["ok": false]); return }
            if call.getBool("drop") ?? false {
                (self.strip as? TriaRoll)?.remove()
                self.strip = nil
                call.resolve(["ok": true])
                return
            }
            let show = call.getBool("show") ?? false
            var roll = self.strip as? TriaRoll
            if roll == nil {
                guard show,
                      let host = self.bridge?.viewController,
                      let scroller = self.bridge?.webView?.scrollView else {
                    call.resolve(["ok": show ? false : true])
                    return
                }
                let made = TriaRoll(limit: call.getInt("limit") ?? 6) { [weak self] name, data in
                    self?.notifyListeners(name, data: data)
                }
                made.attach(host: host, scroller: scroller)
                self.strip = made
                roll = made
            }
            if let r = call.getObject("rect") {
                roll?.place(CGRect(x: Self.num(r["x"]), y: Self.num(r["y"]),
                                   width: Self.num(r["w"]), height: Self.num(r["h"])),
                            radius: CGFloat(call.getDouble("radius") ?? 24))
            }
            roll?.setShown(show)
            call.resolve(["ok": true])
        }
    }

    @objc func rollDeselect(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        DispatchQueue.main.async { [weak self] in
            if #available(iOS 17.0, *) { (self?.strip as? TriaRoll)?.deselect(ids) }
            call.resolve()
        }
    }

    private static func num(_ v: JSValue?) -> CGFloat {
        if let n = v as? NSNumber { return CGFloat(truncating: n) }
        if let d = v as? Double { return CGFloat(d) }
        if let i = v as? Int { return CGFloat(i) }
        return 0
    }
}

@available(iOS 17.0, *)
final class TriaRoll: NSObject, PHPickerViewControllerDelegate {
    private let picker: PHPickerViewController
    /// The soft corner the web gives `#c-roll`, so the row reads as one of the
    /// page's flat cards; the thumbnails run edge to edge inside it.
    private let clip = UIView()
    private let emit: (String, [String: Any]) -> Void
    /// The asset ids ticked in the row, as last reported or deselected.
    private var picked: [String] = []

    init(limit: Int, emit: @escaping (String, [String: Any]) -> Void) {
        self.emit = emit
        var config = PHPickerConfiguration(photoLibrary: .shared())   // asset ids, no permission
        config.filter = .images
        config.selectionLimit = max(1, limit)
        config.selection = .continuous
        config.mode = .compact
        config.edgesWithoutContentMargins = .all
        config.disabledCapabilities = [.search, .collectionNavigation, .stagingArea, .selectionActions]
        picker = PHPickerViewController(configuration: config)
        super.init()
        picker.delegate = self
        clip.clipsToBounds = true
        clip.layer.cornerCurve = .continuous
        clip.backgroundColor = .clear
        clip.alpha = 0
        clip.isHidden = true
    }

    func attach(host: UIViewController, scroller: UIScrollView) {
        host.addChild(picker)
        picker.view.frame = clip.bounds
        picker.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        clip.addSubview(picker.view)
        scroller.addSubview(clip)
        picker.didMove(toParent: host)
    }

    func place(_ rect: CGRect, radius: CGFloat) {
        guard rect.width > 0, rect.height > 0 else { return }
        if clip.frame != rect { clip.frame = rect }
        clip.layer.cornerRadius = radius
    }

    func setShown(_ shown: Bool) {
        let target: CGFloat = shown ? 1 : 0
        if shown { clip.isHidden = false }
        if clip.alpha == target { if !shown { clip.isHidden = true }; return }
        // Away at once (a sheet must never open under it), back with a fade.
        if !shown { clip.alpha = 0; clip.isHidden = true; return }
        UIView.animate(withDuration: 0.22, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.clip.alpha = target
        }
    }

    func deselect(_ ids: [String]) {
        let mine = ids.filter { picked.contains($0) }
        guard !mine.isEmpty else { return }
        picked.removeAll { mine.contains($0) }
        picker.deselectAssets(withIdentifiers: mine)
    }

    func remove() {
        picker.willMove(toParent: nil)
        clip.removeFromSuperview()
        picker.view.removeFromSuperview()
        picker.removeFromParent()
    }

    // Continuous mode calls this with the WHOLE current selection on every
    // change, so it is a diff against what was ticked before.
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let now = results.compactMap { r in r.assetIdentifier.map { ($0, r.itemProvider) } }
        let ids = now.map { $0.0 }
        let gone = picked.filter { !ids.contains($0) }
        let fresh = now.filter { !picked.contains($0.0) }
        picked = ids
        gone.forEach { emit("rollUnpick", ["id": $0]) }
        for (id, provider) in fresh {
            Self.load(provider) { [weak self] result in
                DispatchQueue.main.async {
                    // Unticked (or taken out on the web) while it loaded.
                    guard let self, self.picked.contains(id) else { return }
                    var data = result
                    data["id"] = id
                    self.emit("rollPick", data)
                }
            }
        }
    }

    private static func load(_ provider: NSItemProvider, done: @escaping ([String: Any]) -> Void) {
        let unreadable: [String: Any] = ["error": "Couldn’t read that photo. Try another."]
        if provider.hasItemConformingToTypeIdentifier(UTType.gif.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.gif.identifier) { data, _ in
                guard let data else { done(unreadable); return }
                done(["data": data.base64EncodedString(), "type": "image/gif"])
            }
            return
        }
        guard provider.canLoadObject(ofClass: UIImage.self) else { done(unreadable); return }
        provider.loadObject(ofClass: UIImage.self) { object, _ in
            guard let image = object as? UIImage, image.size.width > 0, image.size.height > 0 else {
                done(unreadable)
                return
            }
            // What the composer exports at is 1400 on the long edge, so 1600
            // loses nothing and keeps a 48MP photo off the bridge.
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
            guard let jpeg = drawn.jpegData(compressionQuality: 0.9) else { done(unreadable); return }
            done(["data": jpeg.base64EncodedString(), "type": "image/jpeg"])
        }
    }
}
