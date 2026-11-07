import UIKit
import Capacitor
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// THE CLIP EDITOR'S NATIVE HALF (2026-11-06, Zoe: "capable of stitching
/// videos together ... vine style editing meets modern reels edits").
///
/// The editor is the web's (`clipEditor` in app.js): the preview, the post's
/// bar of clips and the trimmer are all drawn in the page. What a web view
/// cannot do is the cut itself, so that is here, and only that:
///
/// - `inspect { path, frames, height }` reads a clip's length, its shape as
///   SHOWN (through its rotation) and a filmstrip of `frames` stills, so the
///   trimmer has its pictures at once instead of seeking a <video> around.
/// - `compose { clips: [{ path, start, end }], width, height }` cuts every
///   window and lays them end to end in ONE file: H.264 at 1080p, the sound
///   kept, SDR (an HDR clip is tone mapped, so it reads the same on every
///   screen), and ready to stream (`shouldOptimizeForNetworkUse` puts the
///   index at the front). Each clip COVERS the post's shape, which is the
///   first clip's, exactly as the editor's preview shows it. Progress is
///   `clipProgress { p }`. It resolves `{ path, type, w, h, duration, poster }`,
///   the poster the first frame as a JPEG.
/// - `record { max }` is the system camera in video mode, held to the room
///   the post has left, and resolves `{ path, type }` or `{ cancelled }`.
/// - `clear { paths }` deletes those clips' files, or with no paths empties
///   the folder every clip and every cut lives in.
///
/// ── Why a real cut, and not the play window ─────────────────────────────────
///
/// A trimmed clip used to upload its ORIGINAL with the window stamped in the
/// file name (`-t<start>-<end>`), because the browser's re-encode lost the
/// sound on iOS. Two clips cannot be one window, and the window was costing
/// everyone: a three minute 4K original went up to show ten seconds of it,
/// and every reader fetched it. AVFoundation's export keeps the sound and is
/// the hardware's own encoder, so in the app every clip post is now its cut.
/// The web, and a clip that came in as a file the phone can't reach (iOS 15
/// and 16's file input), still post the original and its window.
///
/// Every file is in `tmp/tria-clips` (`TriaClipCore.dir`), shared with the
/// library sheet's copies (TriaPhotosPlugin.swift), and only `clear` empties
/// it: a second pick must never delete the first clip of a post.
@objc(TriaClipPlugin)
public class TriaClipPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TriaClipPlugin"
    public let jsName = "TriaClip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "inspect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "record", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    /// The camera while it is up (UIImagePickerController holds its delegate weakly).
    private var recorder: TriaClipRecorder?

    @objc func inspect(_ call: CAPPluginCall) {
        guard let url = TriaClipCore.fileURL(call.getString("path")) else {
            call.reject("No clip.")
            return
        }
        let frames = max(1, min(call.getInt("frames") ?? 12, 40))
        let height = CGFloat(call.getDouble("height") ?? 112)
        Task {
            do {
                call.resolve(try await TriaClipCore.inspect(url, frames: frames, height: height))
            } catch {
                call.reject("Couldn’t read that clip.")
            }
        }
    }

    @objc func compose(_ call: CAPPluginCall) {
        let raw = (call.getArray("clips") ?? []).compactMap { $0 as? JSObject }
        let parts: [TriaClipCore.Part] = raw.compactMap { o in
            guard let url = TriaClipCore.fileURL(o["path"] as? String) else { return nil }
            return TriaClipCore.Part(url: url, start: Self.num(o["start"]), end: Self.num(o["end"]))
        }
        guard !parts.isEmpty, parts.count == raw.count else {
            call.reject("No clips.")
            return
        }
        let shape = CGSize(width: call.getDouble("width") ?? 1080, height: call.getDouble("height") ?? 1920)
        Task { [weak self] in
            do {
                let out = try await TriaClipCore.compose(parts, shape: shape) { p in
                    self?.notifyListeners("clipProgress", data: ["p": p])
                }
                call.resolve(out)
            } catch {
                call.reject("Couldn’t put your clips together.")
            }
        }
    }

    @objc func record(_ call: CAPPluginCall) {
        let maxSec = call.getDouble("max") ?? 30
        DispatchQueue.main.async { [weak self] in
            guard let self, let root = self.bridge?.viewController else {
                call.resolve(["cancelled": true])
                return
            }
            guard UIImagePickerController.isSourceTypeAvailable(.camera),
                  (UIImagePickerController.availableMediaTypes(for: .camera) ?? []).contains(UTType.movie.identifier) else {
                call.resolve(["error": "There’s no camera to record with here."])
                return
            }
            var top: UIViewController = root
            while let shown = top.presentedViewController { top = shown }
            let rec = TriaClipRecorder { [weak self] result in
                call.resolve(result)
                DispatchQueue.main.async { self?.recorder = nil }
            }
            self.recorder = rec
            rec.present(from: top, maxSec: maxSec)
        }
    }

    /// `{ paths }` deletes those files (the clips a post let go of, while the
    /// next pick's may already be landing beside them); no paths, everything.
    @objc func clear(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths") ?? []).compactMap { $0 as? String }
        if paths.isEmpty {
            TriaPhotoLoad.clearClips()
        } else {
            let home = TriaClipCore.dir.resolvingSymlinksInPath().path
            for p in paths {
                guard let url = TriaClipCore.fileURL(p)?.resolvingSymlinksInPath(), url.path.hasPrefix(home) else { continue }
                try? FileManager.default.removeItem(at: url)
            }
        }
        call.resolve()
    }

    private static func num(_ v: JSValue?) -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        return 0
    }
}

/// The work itself, kept off UIKit and Capacitor so it can be run and measured
/// on a Mac with nothing but AVFoundation (the way it was checked, 2026-11-06).
enum TriaClipCore {
    struct Part {
        let url: URL
        let start: Double
        let end: Double
    }

    enum Failure: Error { case unreadable, empty, export }

    static var dir: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("tria-clips", isDirectory: true)
    }

    /// The web hands back what native gave it, a `file://` URL string; a bare
    /// path is taken too.
    static func fileURL(_ s: String?) -> URL? {
        guard let s, !s.isEmpty else { return nil }
        if s.hasPrefix("file:") { return URL(string: s) }
        return URL(fileURLWithPath: s)
    }

    /// The shape a track is SHOWN at: a phone's portrait clip is stored on its
    /// side with a quarter turn in its transform.
    static func shown(_ track: AVAssetTrack) async throws -> CGSize {
        let (size, t) = try await track.load(.naturalSize, .preferredTransform)
        let r = CGRect(origin: .zero, size: size).applying(t)
        return CGSize(width: abs(r.width), height: abs(r.height))
    }

    static func inspect(_ url: URL, frames count: Int, height: CGFloat) async throws -> [String: Any] {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard duration.isFinite, duration > 0,
              let video = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.unreadable }
        let shape = try await shown(video)
        let audio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: height * 3, height: height)   // the aspect is kept inside the box
        // A filmstrip needs a frame NEAR each mark, not on it: the nearest
        // keyframe is many times faster to hand back.
        let tol = CMTime(seconds: duration / Double(count) / 2, preferredTimescale: 600)
        gen.requestedTimeToleranceBefore = tol
        gen.requestedTimeToleranceAfter = tol
        var pics: [String] = []
        for i in 0..<count {
            let at = CMTime(seconds: min(max(0, duration - 0.05), (Double(i) + 0.5) * duration / Double(count)),
                            preferredTimescale: 600)
            if let image = try? await frame(gen, at: at), let jpeg = jpeg(image, quality: 0.62) {
                pics.append(jpeg)
            } else {
                pics.append("")
            }
        }
        return ["duration": duration, "w": shape.width, "h": shape.height, "audio": audio, "frames": pics]
    }

    private static func frame(_ gen: AVAssetImageGenerator, at time: CMTime) async throws -> CGImage {
        if #available(iOS 16.0, macOS 13.0, *) {
            return try await gen.image(at: time).image
        }
        return try gen.copyCGImage(at: time, actualTime: nil)
    }

    /// Base64 JPEG through ImageIO, so this file needs no UIKit to run.
    static func jpeg(_ image: CGImage, quality: Double) -> String? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (data as Data).base64EncodedString()
    }

    /// The post's pixel size: the first clip's shape, its long edge at most
    /// 1920 and its short edge at most 1080, whole even pixels (H.264 wants them).
    static func renderSize(_ shape: CGSize) -> CGSize {
        var w = shape.width, h = shape.height
        if !(w > 1 && h > 1) { w = 1080; h = 1920 }
        let k = min(1, 1920 / max(w, h), 1080 / min(w, h))
        w = max(2, (w * k / 2).rounded() * 2)
        h = max(2, (h * k / 2).rounded() * 2)
        return CGSize(width: w, height: h)
    }

    /// A clip laid on the post so it COVERS it, centred: upright first (its own
    /// transform, its corner moved back to the origin), then scaled to the
    /// larger of the two fits, then the overhang split evenly. The editor's
    /// preview is `object-fit: cover` in the same box, so it is this.
    static func cover(_ natural: CGSize, _ pref: CGAffineTransform, _ render: CGSize) -> CGAffineTransform {
        let r = CGRect(origin: .zero, size: natural).applying(pref)
        let w = abs(r.width), h = abs(r.height)
        guard w > 0, h > 0 else { return pref }
        let s = max(render.width / w, render.height / h)
        return pref
            .concatenating(CGAffineTransform(translationX: -r.minX, y: -r.minY))
            .concatenating(CGAffineTransform(scaleX: s, y: s))
            .concatenating(CGAffineTransform(translationX: (render.width - w * s) / 2, y: (render.height - h * s) / 2))
    }

    static func compose(_ parts: [Part], shape: CGSize,
                        progress: @escaping (Double) -> Void) async throws -> [String: Any] {
        let comp = AVMutableComposition()
        guard let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw Failure.unreadable
        }
        let aTrack = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        let render = renderSize(shape)
        let scale: CMTimeScale = 600
        var cursor = CMTime.zero
        var hadAudio = false
        var steps: [AVMutableVideoCompositionInstruction] = []

        for part in parts {
            let asset = AVURLAsset(url: part.url)
            let length = try await asset.load(.duration)
            guard let src = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.unreadable }
            let start = CMTime(seconds: max(0, part.start), preferredTimescale: scale)
            var end = CMTime(seconds: part.end, preferredTimescale: scale)
            if CMTimeCompare(end, length) > 0 { end = length }
            guard CMTimeCompare(end, start) > 0 else { continue }
            let range = CMTimeRange(start: start, end: end)
            try vTrack.insertTimeRange(range, of: src, at: cursor)
            // The sound, where the clip has any. An audio track a hair shorter
            // than its picture would fail a whole-range insert, so only the
            // part they share goes in; a silent clip simply leaves a gap.
            if let aTrack, let a = try await asset.loadTracks(withMediaType: .audio).first {
                let shared = range.intersection(try await a.load(.timeRange))
                if CMTimeCompare(shared.duration, .zero) > 0 {
                    try aTrack.insertTimeRange(shared, of: a, at: cursor + (shared.start - range.start))
                    hadAudio = true
                }
            }
            let (natural, pref) = try await src.load(.naturalSize, .preferredTransform)
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: vTrack)
            layer.setTransform(cover(natural, pref, render), at: cursor)
            let step = AVMutableVideoCompositionInstruction()
            step.timeRange = CMTimeRange(start: cursor, duration: range.duration)
            step.layerInstructions = [layer]
            steps.append(step)
            cursor = cursor + range.duration
        }
        guard CMTimeCompare(cursor, .zero) > 0 else { throw Failure.empty }
        if !hadAudio, let aTrack { comp.removeTrack(aTrack) }

        let look = AVMutableVideoComposition()
        look.renderSize = render
        look.frameDuration = CMTime(value: 1, timescale: 30)
        look.instructions = steps
        // SDR out, whatever came in: an iPhone films HDR by default, and an
        // HDR file on a screen or browser that can't show it reads washed out.
        look.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        look.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        look.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

        guard let session = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else {
            throw Failure.export
        }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("post-\(UUID().uuidString)").appendingPathExtension("mp4")
        session.outputURL = out
        session.outputFileType = .mp4
        session.videoComposition = look
        session.shouldOptimizeForNetworkUse = true

        let ticker = DispatchSource.makeTimerSource(queue: .main)
        ticker.schedule(deadline: .now() + 0.1, repeating: 0.1)
        ticker.setEventHandler { progress(Double(session.progress)) }
        ticker.resume()
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { done.resume() }
        }
        ticker.cancel()
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: out)
            throw Failure.export
        }
        progress(1)

        var poster = ""
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: out))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 1280, height: 1280)
        if let still = try? await frame(gen, at: CMTime(seconds: 0.05, preferredTimescale: 600)) {
            poster = jpeg(still, quality: 0.82) ?? ""
        }
        return ["path": out.absoluteString, "type": "video/mp4",
                "w": render.width, "h": render.height, "duration": cursor.seconds, "poster": poster]
    }
}

/// The system camera, in video mode, for one clip. Held to the post's room
/// (`videoMaximumDuration`), at the camera's highest quality (the default is
/// medium, 480p), and copied out of the picker's own tmp before it's gone.
final class TriaClipRecorder: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private let done: ([String: Any]) -> Void
    private var finished = false

    init(done: @escaping ([String: Any]) -> Void) {
        self.done = done
    }

    func present(from host: UIViewController, maxSec: Double) {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoQuality = .typeHigh
        picker.videoMaximumDuration = max(1, maxSec)
        picker.delegate = self
        host.present(picker, animated: true)
    }

    private func finish(_ result: [String: Any]) {
        guard !finished else { return }
        finished = true
        done(result)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finish(["cancelled": true])
    }

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let url = info[.mediaURL] as? URL else {
            finish(["error": "Couldn’t keep that clip. Try again."])
            return
        }
        let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
        let copy = TriaClipCore.dir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        do {
            try FileManager.default.createDirectory(at: TriaClipCore.dir, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: url, to: copy)
        } catch {
            finish(["error": "Couldn’t keep that clip. Try again."])
            return
        }
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
        finish(["path": copy.absoluteString, "type": mime])
    }
}
