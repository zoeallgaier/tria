import Foundation
import UIKit
import AuthenticationServices
import CryptoKit
import Capacitor

/// The two ways into Tria that aren't a password.
///
/// `appleSignIn` raises the system's own Sign in with Apple sheet and hands the
/// webview an identity token, which js/store.js trades for a Supabase session
/// (`signInWithIdToken`). `webAuth` runs any other provider's page in
/// ASWebAuthenticationSession and hands back the callback URL; Google is the
/// only caller today.
///
/// ── Why Apple is native and Google is not ───────────────────────────────────
/// Apple is a provider like any other to Supabase, so the browser flow below
/// would carry it too, and it was written that way first. It is wrong on a
/// phone. That flow is a web sheet asking for an Apple ID password on a device
/// already signed in to one, which is the exact friction Sign in with Apple
/// exists to remove, and review has refused apps for shipping it. The native
/// sheet is Face ID and nothing else.
///
/// It is also the ONLY place Apple ever says the person's name. Not in the
/// identity token, not on the second authorisation, not ever again: once, to
/// this credential, at the first consent. That name is the display name the
/// handle screen offers, so if it is not read here it is gone. `email` is the
/// same one-shot, and with Hide My Email it is a relay address Apple owns — it
/// is a fine thing to greet somebody with and it is not an identifier to key
/// anything on.
///
/// Google gets no native path because it would cost a whole SDK to gain
/// nothing. Supabase is the OAuth client, not this app, so Google never sees
/// `tria://` and never needs to know this app exists: the session comes back
/// through Supabase's own callback. ASWebAuthenticationSession is the system
/// browser with a shared cookie jar, which is both what Google's policy asks
/// for and the reason somebody already signed in to Google gets one tap.
///
/// ── The nonce, which is the one subtle part ─────────────────────────────────
/// Apple signs the SHA-256 of a nonce into the token; Supabase re-hashes what we
/// give it and compares. So Apple gets the HASH and JavaScript gets the RAW
/// string, and sending the same one to both fails verification with a message
/// about the nonce that reads like the nonce is missing.
@objc(TriaAuthPlugin)
public class TriaAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaAuthPlugin"
    public let jsName = "TriaAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "appleSignIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "webAuth", returnType: CAPPluginReturnPromise)
    ]

    /// Every one of these is a strong reference the system does NOT keep for us.
    /// An ASAuthorizationController or an ASWebAuthenticationSession that is only
    /// a local is deallocated the moment its method returns, and the failure is
    /// silent in the worst way: the sheet either never appears or appears and
    /// then dismisses itself, with no delegate callback and therefore a promise
    /// that never settles. The pending call is held for the same reason.
    private var appleCall: CAPPluginCall?
    private var appleController: ASAuthorizationController?
    private var webSession: ASWebAuthenticationSession?
    /// The raw nonce for the flight in progress; the hash of it went to Apple.
    private var pendingNonce: String?

    /// The marker js/store.js matches to tell a decision from a failure. Backing
    /// out of either sheet must not paint anything red, so the word has to
    /// survive the trip through Capacitor's error channel unchanged.
    private static let cancelled = "cancelled"

    // MARK: - Sign in with Apple

    @objc func appleSignIn(_ call: CAPPluginCall) {
        // A second tap while the first sheet is up: settle the old promise rather
        // than leaving it hanging for the life of the app.
        finishApple(reject: "Replaced by a newer sign-in.")

        let raw = Self.makeNonce()
        pendingNonce = raw
        // No `keepAlive`: this call resolves exactly once. keepAlive is for a
        // call that answers repeatedly (a listener), and it costs a saved call
        // in the bridge and a JS callback that is never freed. Holding the
        // reference above is all a deferred single answer needs.
        appleCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = Self.sha256(raw)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.appleController = controller
            controller.performRequests()
        }
    }

    /// Settle and release whatever the Apple flight was holding. Called on every
    /// path — success, failure, cancel, and a replacement tap — because the one
    /// thing worse than an error here is a promise that never answers.
    private func finishApple(resolve: [String: Any]? = nil, reject: String? = nil) {
        let call = appleCall
        appleCall = nil
        appleController = nil
        pendingNonce = nil
        guard let call else { return }
        if let resolve { call.resolve(resolve) } else { call.reject(reject ?? "Sign in with Apple didn’t finish.") }
    }

    // MARK: - Any other provider, in the system browser

    @objc func webAuth(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("No sign-in address to open.")
            return
        }
        // The scheme the callback comes back on. It has to match a
        // CFBundleURLSchemes entry in Info.plist or iOS hands the redirect to
        // nobody and the sheet simply sits there.
        let scheme = call.getString("scheme") ?? "tria"

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.webSession?.cancel()

            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] back, error in
                self?.webSession = nil
                if let error {
                    let code = (error as? ASWebAuthenticationSessionError)?.code
                    call.reject(code == .canceledLogin ? Self.cancelled : error.localizedDescription)
                    return
                }
                guard let back else {
                    call.reject("That sign-in came back empty.")
                    return
                }
                call.resolve(["url": back.absoluteString])
            }
            session.presentationContextProvider = self
            // Deliberately NOT ephemeral. An ephemeral session shows no "Tria
            // wants to use supabase.co to sign in" prompt, which looks like a
            // win, and costs the whole point: it carries no cookies, so somebody
            // already signed in to Google is asked for their Google password
            // inside our app. The prompt is the price of the one-tap.
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            session.start()
        }
    }

    // MARK: - The nonce

    /// 32 characters out of `SecRandomCopyBytes`, mapped into an alphabet Apple
    /// and every JSON hop between here and Supabase treat as plain text. Falls
    /// back to arc4random only if the secure generator refuses, which it does
    /// not do in practice and which must not be a dead end if it ever does.
    private static func makeNonce(length: Int = 32) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        var bytes = [UInt8](repeating: 0, count: length)
        if SecRandomCopyBytes(kSecRandomDefault, length, &bytes) != errSecSuccess {
            bytes = (0..<length).map { _ in UInt8.random(in: 0...255) }
        }
        return String(bytes.map { alphabet[Int($0) % alphabet.count] })
    }

    /// Lowercase hex, which is the shape Apple's own sample code produces and
    /// the shape Supabase hashes to when it re-derives this from the raw nonce.
    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - The Apple sheet's answers

extension TriaAuthPlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            finishApple(reject: "Apple didn’t hand back a sign-in.")
            return
        }
        guard let nonce = pendingNonce else {
            finishApple(reject: "That sign-in arrived out of order, try again.")
            return
        }

        // Present only at the first authorisation, and absent on every one
        // after, so an empty string here is normal rather than a failure. The
        // handle screen falls back to the email's local part.
        let name = [credential.fullName?.givenName, credential.fullName?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)

        finishApple(resolve: [
            "idToken": token,
            "nonce": nonce,
            "name": name,
            "email": credential.email ?? ""
        ])
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        let code = (error as? ASAuthorizationError)?.code
        // `.unknown` is what iOS reports when the sheet is dismissed by swiping
        // it down rather than by tapping Cancel, so it belongs with the
        // cancellations and not with the errors: a red line for a swipe would be
        // the app telling somebody off for changing their mind.
        if code == .canceled || code == .unknown {
            finishApple(reject: Self.cancelled)
            return
        }
        finishApple(reject: error.localizedDescription)
    }
}

// MARK: - Where the sheets hang from

extension TriaAuthPlugin: ASAuthorizationControllerPresentationContextProviding,
                          ASWebAuthenticationPresentationContextProviding {
    /// Both protocols ask the same question with different argument types, so one
    /// answer serves both. The bridge's own view controller is the one holding
    /// the webview, which is the window the sheet has to come out of; the
    /// key-window scan is the fallback for the frames around a scene handover,
    /// where `bridge` can briefly be nil.
    private var anchorWindow: ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window { return window }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) { return window }
        return scenes.first?.windows.first ?? UIWindow()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchorWindow
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchorWindow
    }
}
