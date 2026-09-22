import Foundation
import UIKit
import Photos
import Capacitor

/// Handing a story card to Instagram, and nothing else.
///
/// Instagram has no SDK for this and does not want one. The whole protocol is:
/// put the picture on the system pasteboard under three agreed keys, then open
/// `instagram-stories://share`. Instagram reads the pasteboard on activation,
/// drops the image in as a draggable sticker, and paints the two colours behind
/// it. There is no callback, no result, and no way to know whether the person
/// posted or backed out — so this plugin promises only that Instagram opened.
///
/// ── The three things that make it fail silently ─────────────────────────────
///
/// ONE, the App ID. Since January 2023 the URL must carry
/// `source_application=<Facebook App ID>` or Instagram opens and ignores the
/// pasteboard entirely — no error, no sticker, just the camera. The id is
/// Zoe's, it is public, and it lives in js/config.js so the web and the app
/// cannot disagree about it. It is passed in rather than compiled here for
/// exactly that reason.
///
/// TWO, `LSApplicationQueriesSchemes`. `canOpenURL` answers false for any
/// scheme not declared in Info.plist, whether or not the app is installed. Miss
/// the declaration and Tria decides Instagram is absent on every phone on
/// earth, hides the button, and is not wrong about anything it can observe.
///
/// THREE, the pasteboard expiry. Without one the card sits on the system
/// pasteboard indefinitely, which means it is still there, readable by every
/// app, long after the share. Five minutes is Meta's own suggestion and is far
/// more than the handoff needs.
@objc(TriaSharePlugin)
public class TriaSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaSharePlugin"
    public let jsName = "TriaShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "canShareToInstagram", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareToInstagram", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise)
    ]

    private static let scheme = "instagram-stories://share"

    /// Is Instagram on this phone? The answer decides whether the button exists
    /// at all, because a row that says "Share to Instagram" and then does
    /// nothing is worse than a row that isn't there.
    @objc func canShareToInstagram(_ call: CAPPluginCall) {
        guard let url = URL(string: TriaSharePlugin.scheme) else {
            call.resolve(["available": false])
            return
        }
        // canOpenURL must be asked on the main thread.
        DispatchQueue.main.async {
            call.resolve(["available": UIApplication.shared.canOpenURL(url)])
        }
    }

    /// `image` is a base64 PNG of the card on a TRANSPARENT background — the
    /// sticker. `topColor` and `bottomColor` are the gradient Instagram paints
    /// behind it, as `#rrggbb`.
    @objc func shareToInstagram(_ call: CAPPluginCall) {
        guard let appId = call.getString("appId"), !appId.isEmpty else {
            call.reject("No Meta app id, so Instagram would ignore the card.")
            return
        }
        guard let base64 = call.getString("image"),
              let data = Data(base64Encoded: stripDataURL(base64)) else {
            call.reject("The card could not be read.")
            return
        }
        let top = call.getString("topColor") ?? "#edeef0"
        let bottom = call.getString("bottomColor") ?? top

        guard let url = URL(string: "\(TriaSharePlugin.scheme)?source_application=\(appId)") else {
            call.reject("Could not build the Instagram link.")
            return
        }

        DispatchQueue.main.async {
            guard UIApplication.shared.canOpenURL(url) else {
                call.reject("Instagram isn't installed.", "NO_INSTAGRAM")
                return
            }

            // One pasteboard ITEM carrying all three keys. Three separate items
            // is the mistake that looks identical in code and hands Instagram a
            // sticker with no background.
            let item: [String: Any] = [
                "com.instagram.sharedSticker.stickerImage": data,
                "com.instagram.sharedSticker.backgroundTopColor": top,
                "com.instagram.sharedSticker.backgroundBottomColor": bottom
            ]
            UIPasteboard.general.setItems(
                [item],
                options: [.expirationDate: Date().addingTimeInterval(60 * 5)]
            )

            UIApplication.shared.open(url, options: [:]) { opened in
                // `opened` is only "the system handed it over". Whether anything
                // was posted is between the person and Instagram, and Tria is
                // not told. The toast this resolves into says the link was
                // copied, which IS a fact we know.
                if opened {
                    call.resolve(["opened": true])
                } else {
                    call.reject("Instagram wouldn't open.", "NO_INSTAGRAM")
                }
            }
        }
    }

    /// Straight into the camera roll, which is what "save" means to everybody
    /// who is not a programmer. The share sheet already offers Save Image, so
    /// this exists because going through a share sheet to save your own picture
    /// to your own phone is three taps and a decision, and this is one tap.
    ///
    /// ── The Info.plist key is not optional and not a warning ────────────────
    /// Writing to the library needs `NSPhotoLibraryAddUsageDescription`. Without
    /// it iOS does not deny the request, it TERMINATES the app — no dialog, no
    /// log line a person would find, just a launch-looking crash the first time
    /// anybody taps Save. Tria already had `NSPhotoLibraryUsageDescription`,
    /// which is the READ key for the photo picker and does not cover this.
    ///
    /// `.addOnly` on purpose: Tria wants to put one picture in and has no
    /// business reading anything back out, and the prompt says so.
    @objc func saveToPhotos(_ call: CAPPluginCall) {
        guard let base64 = call.getString("image"),
              let data = Data(base64Encoded: stripDataURL(base64)),
              let image = UIImage(data: data) else {
            call.reject("The card could not be read.")
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                // A refusal is an answer, not a failure. The JS side turns this
                // one code into a sentence about Settings rather than a shrug.
                call.reject("Tria doesn't have permission to add to your photos.", "NO_PERMISSION")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }, completionHandler: { ok, error in
                if ok {
                    call.resolve(["saved": true])
                } else {
                    call.reject(error?.localizedDescription ?? "The card could not be saved.")
                }
            })
        }
    }

    /// Accepts a bare base64 string or a full `data:image/png;base64,...` URL,
    /// because the JS side gets the second from canvas and forgetting to trim it
    /// is a one-character bug that decodes to nil and reads as a broken card.
    private func stripDataURL(_ s: String) -> String {
        guard let comma = s.range(of: "base64,") else { return s }
        return String(s[comma.upperBound...])
    }
}
