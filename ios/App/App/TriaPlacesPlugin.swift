import UIKit
import MapKit
import Capacitor

/// A TAKE ON A PLACE (2026-11-12, Zoe: "allow for takes on places and stuff,
/// built into maps"). Apple Maps is the places database, through MapKit:
///
///   - `search` is `MKLocalSearch`, points of interest and areas (a city, a
///     neighbourhood), never a bare street address. Free, keyless, and it
///     asks for NO location permission: Tria never asks, so the results lean
///     on what Apple's servers infer, and a query that names a town finds it.
///   - `snapshot` draws the place's own little map for a Take's tile, with a
///     dot in the reader's colour, cached on the device (Caches/tria-maps) so
///     a feed draws it once.
///   - `open` is Apple's own place card (`MKMapItemDetailViewController`,
///     iOS 18) over the page when the Take carries an Apple Place ID, else
///     Maps itself at the point.
///
/// What a Take stores is in supabase/place-takes.sql: the name, where, what it
/// is, the point, and the Place ID (`MKMapItem.identifier`, iOS 18, made to
/// be stored). Missing from the binary, app.js finds no places and draws
/// every place Take with a pin and a link out to maps.apple.com.
@objc(TriaPlacesPlugin)
public class TriaPlacesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaPlacesPlugin"
    public let jsName = "TriaPlaces"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "search", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private var live: MKLocalSearch?

    // MARK: search

    @objc func search(_ call: CAPPluginCall) {
        let q = (call.getString("q") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { call.resolve(["hits": []]); return }
        DispatchQueue.main.async {
            let req = MKLocalSearch.Request()
            req.naturalLanguageQuery = q
            req.resultTypes = [.pointOfInterest, .address]
            let search = MKLocalSearch(request: req)
            self.live?.cancel()
            self.live = search
            search.start { resp, _ in
                let hits = (resp?.mapItems ?? []).compactMap(Self.describe).prefix(6)
                call.resolve(["hits": Array(hits)])
            }
        }
    }

    /// One result as app.js's take wants it. An address result with a street
    /// is dropped (a take on "12 Elm St" is a note); one without is an area,
    /// and has no `cat`, which is how app.js knows to draw its map wider.
    private static func describe(_ item: MKMapItem) -> [String: Any]? {
        let pm = item.placemark
        let coord = pm.coordinate
        guard CLLocationCoordinate2DIsValid(coord), let name = item.name, !name.isEmpty else { return nil }
        let poi = item.pointOfInterestCategory
        if poi == nil && pm.thoroughfare != nil { return nil }
        var out: [String: Any] = [
            "kind": "place",
            "title": String(name.prefix(160)),
            "lat": (coord.latitude * 1e6).rounded() / 1e6,
            "lng": (coord.longitude * 1e6).rounded() / 1e6,
            "src": "apple",
        ]
        let parts: [String?] = poi == nil
            ? [pm.administrativeArea, pm.country]
            : [pm.subLocality, pm.locality ?? pm.administrativeArea]
        let by = parts.compactMap { $0 }.filter { !$0.isEmpty && $0 != name }
        if !by.isEmpty { out["by"] = String(by.joined(separator: ", ").prefix(120)) }
        if let poi { out["cat"] = word(for: poi) }
        if #available(iOS 18.0, *), let id = item.identifier?.rawValue { out["id"] = id }
        return out
    }

    /// "MKPOICategoryNationalPark" as "National park".
    private static func word(for cat: MKPointOfInterestCategory) -> String {
        let raw = cat.rawValue.replacingOccurrences(of: "MKPOICategory", with: "")
        let fixed: [String: String] = [
            "Cafe": "Café", "ATM": "ATM", "EVCharger": "EV charger", "Restaurant": "Restaurant",
            "Nightlife": "Bar", "FoodMarket": "Market", "AmusementPark": "Amusement park",
        ]
        if let w = fixed[raw] { return w }
        var words: [String] = []
        var cur = ""
        for ch in raw {
            if ch.isUppercase && !cur.isEmpty { words.append(cur); cur = "" }
            cur.append(ch)
        }
        if !cur.isEmpty { words.append(cur) }
        guard let first = words.first else { return "Place" }
        return ([first] + words.dropFirst().map { $0.lowercased() }).joined(separator: " ")
    }

    // MARK: snapshot

    @objc func snapshot(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.reject("That place has no point.")
            return
        }
        let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        guard CLLocationCoordinate2DIsValid(coord) else { call.reject("That place has no point."); return }
        let side = CGFloat(max(24, min(400, call.getDouble("size") ?? 88)))
        let dark = call.getBool("dark") ?? false
        let wide = call.getBool("wide") ?? false
        let ink = Self.color(hex: call.getString("ink") ?? "") ?? UIColor(red: 0, green: 0.788, blue: 0.808, alpha: 1)
        let inkKey = (call.getString("ink") ?? "").replacingOccurrences(of: "#", with: "")
        let key = String(format: "%.5f_%.5f_%d_%@_%@_%@", lat, lng, Int(side), dark ? "d" : "l", wide ? "w" : "n", inkKey)
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tria-maps", isDirectory: true)
        let file = dir.appendingPathComponent(key + ".png")
        if FileManager.default.fileExists(atPath: file.path) {
            call.resolve(["path": file.absoluteString])
            return
        }
        DispatchQueue.main.async {
            let opt = MKMapSnapshotter.Options()
            let meters: CLLocationDistance = wide ? 14000 : 650
            opt.region = MKCoordinateRegion(center: coord, latitudinalMeters: meters, longitudinalMeters: meters)
            opt.size = CGSize(width: side, height: side)
            opt.traitCollection = UITraitCollection(traitsFrom: [
                UITraitCollection(userInterfaceStyle: dark ? .dark : .light),
                UITraitCollection(displayScale: 3),
            ])
            // Clean: the streets and the water, no other places' pins.
            opt.pointOfInterestFilter = .excludingAll
            MKMapSnapshotter(options: opt).start(with: .global(qos: .userInitiated)) { snap, _ in
                guard let snap else { call.reject("The map didn't draw."); return }
                let fmt = UIGraphicsImageRendererFormat()
                fmt.scale = 3
                let img = UIGraphicsImageRenderer(size: opt.size, format: fmt).image { ctx in
                    snap.image.draw(at: .zero)
                    let p = snap.point(for: coord)
                    let ring = CGRect(x: p.x - 7, y: p.y - 7, width: 14, height: 14)
                    ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 3,
                                            color: UIColor.black.withAlphaComponent(0.3).cgColor)
                    UIColor.white.setFill()
                    ctx.cgContext.fillEllipse(in: ring)
                    ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
                    ink.setFill()
                    ctx.cgContext.fillEllipse(in: ring.insetBy(dx: 2.5, dy: 2.5))
                }
                do {
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    guard let png = img.pngData() else { throw CocoaError(.fileWriteUnknown) }
                    try png.write(to: file, options: .atomic)
                    call.resolve(["path": file.absoluteString])
                } catch {
                    call.reject("The map didn't keep.")
                }
            }
        }
    }

    private static func color(hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                       blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    // MARK: open

    @objc func open(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng") else {
            call.reject("That place has no point.")
            return
        }
        let name = call.getString("name") ?? ""
        let id = call.getString("id") ?? ""
        let coord = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        Task { @MainActor in
            if #available(iOS 18.0, *), !id.isEmpty, let ident = MKMapItem.Identifier(rawValue: id),
               let item = try? await MKMapItemRequest(mapItemIdentifier: ident).mapItem,
               let host = self.bridge?.viewController {
                let card = MKMapItemDetailViewController(mapItem: item)
                card.delegate = self.cardDelegate as? MKMapItemDetailViewControllerDelegate
                if let sheet = card.sheetPresentationController {
                    sheet.detents = [.medium(), .large()]
                    sheet.prefersGrabberVisible = true
                }
                (host.presentedViewController ?? host).present(card, animated: true)
                call.resolve(["shown": "card"])
                return
            }
            let item = MKMapItem(placemark: MKPlacemark(coordinate: coord))
            if !name.isEmpty { item.name = name }
            let opened = item.openInMaps(launchOptions: [
                MKLaunchOptionsMapCenterKey: NSValue(mkCoordinate: coord),
                MKLaunchOptionsMapSpanKey: NSValue(mkCoordinateSpan: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)),
            ])
            if opened { call.resolve(["shown": "maps"]) } else { call.reject("Maps didn't open.") }
        }
    }

    /// The place card's Done. Held here so the card has a delegate that
    /// outlives the call; on iOS 17 and older it is never made.
    private lazy var cardDelegate: AnyObject? = {
        if #available(iOS 18.0, *) { return TriaPlaceCardCloser() }
        return nil
    }()
}

@available(iOS 18.0, *)
final class TriaPlaceCardCloser: NSObject, MKMapItemDetailViewControllerDelegate {
    func mapItemDetailViewControllerDidFinish(_ detailViewController: MKMapItemDetailViewController) {
        detailViewController.dismiss(animated: true)
    }
}
