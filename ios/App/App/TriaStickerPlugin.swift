import UIKit
import Capacitor
import PhotosUI
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

/// A new charm (Zoe, 2026-10-25): one of your own iOS stickers, any emoji, or
/// a photo cut out the way iOS makes them, handed to the web as a transparent
/// PNG. The sheet says "New charm" and "Add an emoji or sticker."
///
/// ── Why it is native ────────────────────────────────────────────────────────
///
/// No app can read the sticker library; there is no API onto it at all. The
/// one door is the keyboard: stickers live at the start of the EMOJI keyboard,
/// and a native text view takes one as an inline picture (iOS 18 hands it over
/// as an `NSAdaptiveImageGlyph`, 17 as an image attachment). The web's version
/// of this was a hidden rich field, and it raised the LETTER keyboard over the
/// picker with nothing to say what to do next, because a page can neither ask
/// for the emoji keys nor lay itself out around them. Here the sheet asks for
/// the emoji keys itself (`StickerField.textInputMode`, the one widely used
/// way, keyed off the mode's "emoji" language; if it ever stops matching, the
/// person gets their normal keyboard and the globe key, nothing worse), sits
/// above them, and takes the first sticker tapped (or emoji, drawn big in
/// Apple's colour emoji and trimmed to its ink): it pops into the well, the
/// keys go down, and the sheet closes on its own. Choosing IS committing.
///
/// "From a photo" is the same cut-out without the keyboard, for anyone with no
/// stickers yet: Vision's foreground mask (iOS 17, the request behind Photos'
/// own lift-subject) and a white edge drawn round it, like a sticker's.
@objc(TriaStickerPlugin)
public class TriaStickerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaStickerPlugin"
    public let jsName = "TriaSticker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    /// Resolves `{ image: <base64 PNG> }` or `{ cancelled: true }`, never rejects
    /// on a dismissal: backing out is an answer, not an error.
    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let root = self.bridge?.viewController else {
                call.reject("No view to present from.")
                return
            }
            var top: UIViewController = root
            while let shown = top.presentedViewController { top = shown }
            let sheet = TriaStickerSheet { png in
                if let png = png { call.resolve(["image": png.base64EncodedString()]) }
                else { call.resolve(["cancelled": true]) }
            }
            top.present(sheet, animated: true)
        }
    }
}

/// The text view the keyboard drops a sticker into. Invisible, and laid over
/// the well so a tap there raises the keys again.
final class StickerField: UITextView {
    override var textInputMode: UITextInputMode? {
        UITextInputMode.activeInputModes.first { $0.primaryLanguage == "emoji" } ?? super.textInputMode
    }
    // No caret, no selection handles, no edit menu: it is a slot, not a field.
    override func caretRect(for position: UITextPosition) -> CGRect { .zero }
    override func selectionRects(for range: UITextRange) -> [UITextSelectionRect] { [] }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        action == #selector(paste(_:))
    }
}

final class TriaStickerSheet: UIViewController, UITextViewDelegate,
                              UIAdaptivePresentationControllerDelegate, PHPickerViewControllerDelegate {
    private let done: (Data?) -> Void
    private var finished = false
    private var taking = false

    private let field = StickerField()
    private let well = UIView()
    private let dash = CAShapeLayer()
    private let picture = UIImageView()
    private let hint = UILabel()
    private let sub = UILabel()
    private let photoButton = UIButton(type: .system)

    init(done: @escaping (Data?) -> Void) {
        self.done = done
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        if let s = sheetPresentationController {
            s.detents = [.large()]
            s.prefersGrabberVisible = true
            s.preferredCornerRadius = 32
        }
        presentationController?.delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // `--surface`, `--text`, `--muted`, `--rule` from css/tokens.css; the web's
    // sheets are solid --surface with one hairline, and so is this.
    private static func tone(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? hex(dark) : hex(light) }
    }
    private static func hex(_ v: UInt32) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
    private static let surface = tone(0xf6f7f8, 0x171a1d)
    private static let ink = tone(0x14171a, 0xe9ebed)
    private static let muted = tone(0x5c636b, 0x969ca3)
    private static let rule = tone(0xdadde1, 0x272c30)

    /// The sheet titles' italic Instrument Serif, registered once from the
    /// bundled web fonts (the TTF beside the woff2, as Oxygen's is).
    private static var serifRegistered = false
    private static func serif(_ size: CGFloat) -> UIFont {
        if !serifRegistered {
            serifRegistered = true
            if let url = Bundle.main.url(forResource: "instrument-serif-400i-latin", withExtension: "ttf",
                                         subdirectory: "public/css/fonts") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
        if let f = UIFont(name: "InstrumentSerif-Italic", size: size) { return f }
        let base = UIFont.systemFont(ofSize: size)
        let d = base.fontDescriptor.withDesign(.serif)?.withSymbolicTraits(.traitItalic) ?? base.fontDescriptor
        return UIFont(descriptor: d, size: size)
    }
    private static func body(_ size: CGFloat) -> UIFont {
        UIFont(name: "Oxygen-Regular", size: size) ?? .systemFont(ofSize: size)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.surface

        let title = UILabel()
        title.text = "New charm"
        title.font = Self.serif(28)
        title.textColor = Self.ink
        title.textAlignment = .center

        well.layer.cornerRadius = 24
        well.layer.cornerCurve = .continuous
        dash.fillColor = nil
        dash.lineWidth = 1.5
        dash.lineDashPattern = [6, 6]
        well.layer.addSublayer(dash)

        let glyph = UIImageView(image: UIImage(systemName: "face.smiling",
                                               withConfiguration: UIImage.SymbolConfiguration(pointSize: 34, weight: .light)))
        glyph.tintColor = Self.muted
        glyph.tag = 7
        glyph.translatesAutoresizingMaskIntoConstraints = false
        well.addSubview(glyph)

        picture.contentMode = .scaleAspectFit
        picture.alpha = 0
        picture.translatesAutoresizingMaskIntoConstraints = false
        well.addSubview(picture)

        field.delegate = self
        field.backgroundColor = .clear
        field.textColor = .clear
        field.tintColor = .clear
        field.font = .systemFont(ofSize: 17)
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.allowsEditingTextAttributes = true
        field.pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [UTType.image.identifier])
        if #available(iOS 18.0, *) { field.supportsAdaptiveImageGlyph = true }
        field.translatesAutoresizingMaskIntoConstraints = false
        well.addSubview(field)

        hint.text = "Add an emoji or sticker."
        hint.font = Self.body(17)
        hint.textColor = Self.ink
        hint.textAlignment = .center
        hint.numberOfLines = 0
        sub.text = "Your stickers are at the start of the emoji keys."
        sub.font = Self.body(14)
        sub.textColor = Self.muted
        sub.textAlignment = .center
        sub.numberOfLines = 0

        var cfg = UIButton.Configuration.plain()
        cfg.title = "From a photo"
        cfg.image = UIImage(systemName: "photo", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15))
        cfg.imagePadding = 8
        cfg.baseForegroundColor = Self.ink
        cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a; a.font = Self.body(16); return a
        }
        photoButton.configuration = cfg
        photoButton.layer.cornerRadius = 26
        photoButton.layer.cornerCurve = .continuous
        photoButton.layer.borderWidth = 1
        photoButton.addTarget(self, action: #selector(fromPhoto), for: .touchUpInside)
        if #unavailable(iOS 17.0) { photoButton.isHidden = true }

        let stack = UIStackView(arrangedSubviews: [title, well, hint, sub, photoButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 6
        stack.setCustomSpacing(18, after: title)
        stack.setCustomSpacing(16, after: well)
        stack.setCustomSpacing(20, after: sub)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        // The well gives way first on a short phone, so the button always
        // clears the keys.
        let tall = well.heightAnchor.constraint(equalToConstant: 168)
        tall.priority = .defaultHigh
        let clear = stack.bottomAnchor.constraint(lessThanOrEqualTo: view.keyboardLayoutGuide.topAnchor, constant: -16)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            clear,
            tall,
            well.heightAnchor.constraint(greaterThanOrEqualToConstant: 96),
            well.widthAnchor.constraint(equalTo: well.heightAnchor),
            photoButton.heightAnchor.constraint(equalToConstant: 52),
            photoButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            glyph.centerXAnchor.constraint(equalTo: well.centerXAnchor),
            glyph.centerYAnchor.constraint(equalTo: well.centerYAnchor),
            picture.topAnchor.constraint(equalTo: well.topAnchor, constant: 10),
            picture.bottomAnchor.constraint(equalTo: well.bottomAnchor, constant: -10),
            picture.leadingAnchor.constraint(equalTo: well.leadingAnchor, constant: 10),
            picture.trailingAnchor.constraint(equalTo: well.trailingAnchor, constant: -10),
            field.topAnchor.constraint(equalTo: well.topAnchor),
            field.bottomAnchor.constraint(equalTo: well.bottomAnchor),
            field.leadingAnchor.constraint(equalTo: well.leadingAnchor),
            field.trailingAnchor.constraint(equalTo: well.trailingAnchor),
        ])
        paintTones()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Now, not in viewDidAppear, so the keys rise WITH the sheet.
        field.becomeFirstResponder()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // In case the view wasn't in a window yet when it asked above.
        if !field.isFirstResponder && !taking && !finished { field.becomeFirstResponder() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        dash.frame = well.bounds
        dash.path = UIBezierPath(roundedRect: well.bounds.insetBy(dx: 0.75, dy: 0.75), cornerRadius: 24).cgPath
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        paintTones()
    }
    private func paintTones() {
        dash.strokeColor = Self.rule.resolvedColor(with: traitCollection).cgColor
        photoButton.layer.borderColor = Self.ink.resolvedColor(with: traitCollection).withAlphaComponent(0.26).cgColor  // --pill-edge
    }

    // MARK: The keyboard's sticker

    func textViewDidChange(_ textView: UITextView) {
        guard !taking else { return }
        let text = textView.attributedText ?? NSAttributedString()
        textView.attributedText = NSAttributedString()
        // A sticker, else the last emoji typed, drawn as a picture; a letter
        // gets the hint's shake.
        if let image = Self.sticker(in: text) ?? Self.emoji(in: text.string).flatMap(Self.emojiImage) {
            land(image)
        } else if text.length > 0 {
            nudge()
        }
    }

    /// The last emoji in what was typed, as one whole character (a flag, a
    /// skin tone, a family), or nil for letters and digits.
    static func emoji(in text: String) -> String? {
        text.last { ch in
            guard let first = ch.unicodeScalars.first else { return false }
            return first.properties.isEmojiPresentation ||
                (first.properties.isEmoji && ch.unicodeScalars.count > 1)
        }.map(String.init)
    }

    /// An emoji drawn big in Apple's colour emoji and trimmed to its own ink,
    /// so it fills a charm the way a sticker does.
    static func emojiImage(_ e: String) -> UIImage? {
        let text = NSAttributedString(string: e, attributes: [.font: UIFont.systemFont(ofSize: 320)])
        let box = text.size()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let drawn = UIGraphicsImageRenderer(size: CGSize(width: ceil(box.width), height: ceil(box.height)), format: format)
            .image { _ in text.draw(at: .zero) }
        guard let cg = drawn.cgImage, let ink = inkBounds(cg), let cut = cg.cropping(to: ink) else { return nil }
        return UIImage(cgImage: cut)
    }

    /// The smallest rect holding every pixel that isn't clear.
    static func inkBounds(_ cg: CGImage) -> CGRect? {
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in 0..<h {
            for x in 0..<w where px[(y * w + x) * 4 + 3] > 8 {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }
        // The bitmap's rows run top down here, the same as cropping(to:)'s.
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    /// The first picture in what the keyboard inserted: an adaptive image glyph
    /// (iOS 18, its largest size) or an image attachment (17, or a paste).
    static func sticker(in text: NSAttributedString) -> UIImage? {
        let all = NSRange(location: 0, length: text.length)
        var found: UIImage?
        if #available(iOS 18.0, *) {
            text.enumerateAttribute(.adaptiveImageGlyph, in: all) { value, _, stop in
                if let glyph = value as? NSAdaptiveImageGlyph, let img = largest(glyph.imageContent) {
                    found = img; stop.pointee = true
                }
            }
        }
        if found == nil {
            text.enumerateAttribute(.attachment, in: all) { value, _, stop in
                guard let a = value as? NSTextAttachment else { return }
                let data = a.contents ?? a.fileWrapper?.regularFileContents
                if let img = a.image ?? data.flatMap(largest) {
                    found = img; stop.pointee = true
                }
            }
        }
        return found
    }

    /// An adaptive glyph's HEIC carries several sizes; take the biggest.
    static func largest(_ data: Data) -> UIImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return UIImage(data: data) }
        var best: CGImage?
        for i in 0..<CGImageSourceGetCount(src) {
            if let img = CGImageSourceCreateImageAtIndex(src, i, nil), img.width > (best?.width ?? 0) { best = img }
        }
        return best.map { UIImage(cgImage: $0) } ?? UIImage(data: data)
    }

    private func nudge() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        UIView.animate(withDuration: 0.08, animations: { self.sub.transform = CGAffineTransform(translationX: 6, y: 0) }) { _ in
            UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.3, initialSpringVelocity: 8) {
                self.sub.transform = .identity
            }
        }
    }

    // MARK: From a photo

    @objc private func fromPhoto() {
        guard !taking else { return }
        field.resignFirstResponder()
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            field.becomeFirstResponder()
            return
        }
        taking = true
        hint.text = "Cutting it out\u{2026}"
        sub.text = " "
        UIView.animate(withDuration: 0.6, delay: 0, options: [.autoreverse, .repeat, .allowUserInteraction]) {
            self.well.alpha = 0.55
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] obj, _ in
            let lifted: UIImage? = {
                guard let img = obj as? UIImage else { return nil }
                if #available(iOS 17.0, *) { return TriaStickerSheet.lift(img) }
                return nil
            }()
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.well.layer.removeAllAnimations()
                self.well.alpha = 1
                self.taking = false
                if let lifted = lifted { self.land(lifted) }
                else {
                    self.hint.text = "Couldn\u{2019}t find a subject in that one."
                    self.sub.text = "Try a photo with someone or something up front."
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                    self.field.becomeFirstResponder()
                }
            }
        }
    }

    /// Vision's foreground mask, every subject it finds, cropped to them, with
    /// a white edge. Off the main thread (the caller's queue is the loader's).
    @available(iOS 17.0, *)
    static func lift(_ image: UIImage) -> UIImage? {
        let upright = capped(image, to: 1600)
        guard let cg = upright.cgImage else { return nil }
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        let request = VNGenerateForegroundInstanceMaskRequest()
        do { try handler.perform([request]) } catch { return nil }
        guard let result = request.results?.first, !result.allInstances.isEmpty,
              let buffer = try? result.generateMaskedImage(ofInstances: result.allInstances, from: handler,
                                                            croppedToInstancesExtent: true)
        else { return nil }
        return outlined(CIImage(cvPixelBuffer: buffer))
    }

    /// A sticker's white edge: the cut-out's own alpha grown by a few percent
    /// of its size, softened a hair, filled white, and the cut-out laid on top.
    static func outlined(_ cut: CIImage) -> UIImage? {
        let r = max(4, (max(cut.extent.width, cut.extent.height) * 0.03).rounded())
        let pad = r * 2
        let moved = cut.transformed(by: CGAffineTransform(translationX: pad - cut.extent.minX, y: pad - cut.extent.minY))
        let canvas = CGRect(x: 0, y: 0, width: cut.extent.width + pad * 2, height: cut.extent.height + pad * 2)
        let grown = moved
            .applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: r])
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 1.2])
            .cropped(to: canvas)
        let edge = CIImage(color: .white).cropped(to: canvas)
            .applyingFilter("CIBlendWithAlphaMask", parameters: [
                kCIInputMaskImageKey: grown,
                kCIInputBackgroundImageKey: CIImage(color: .clear).cropped(to: canvas),
            ])
        let out = moved.composited(over: edge).cropped(to: canvas)
        guard let cg = CIContext().createCGImage(out, from: canvas) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// Drawn upright, no bigger than `side` on its long edge, alpha kept.
    static func capped(_ image: UIImage, to side: CGFloat) -> UIImage {
        let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let k = min(1, side / max(px.width, px.height, 1))
        let size = CGSize(width: max(1, (px.width * k).rounded()), height: max(1, (px.height * k).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: Landing it

    /// The sticker pops into the well, the keys go down, and a beat later the
    /// sheet closes with it.
    private func land(_ image: UIImage) {
        guard !finished, !taking else { return }
        taking = true
        field.resignFirstResponder()
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        picture.image = image
        picture.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)
        hint.text = "Added!"
        sub.text = " "
        photoButton.isEnabled = false
        UIView.animate(withDuration: 0.5, delay: 0, usingSpringWithDamping: 0.55, initialSpringVelocity: 0.8) {
            self.picture.alpha = 1
            self.picture.transform = .identity
            self.well.viewWithTag(7)?.alpha = 0
        }
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.3)
        dash.opacity = 0
        CATransaction.commit()
        let png = Self.capped(image, to: 512).pngData()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            guard let self = self else { return }
            self.finish(png)
            self.dismiss(animated: true)
        }
    }

    private func finish(_ png: Data?) {
        guard !finished else { return }
        finished = true
        done(png)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish(nil)
    }
}
