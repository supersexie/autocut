import AVFoundation
import CoreImage
import Foundation

struct ExportFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Renders an edit to an MP4 on this device, the same way the server does (src/media.js render):
/// clips back to back with their speed and volume, tiny fades at each cut (or the sound overlapping
/// across cuts), music looped underneath and faded out, overlays, zoom keyframes, captions and text.
/// The encoding runs on the phone's video hardware.
final class EditExporter {
  private static let fade = 0.012
  private static let overlapSeconds = 0.08 // OVERLAP in src/media.js
  private var session: AVAssetExportSession?
  private var cancelled = false

  func cancel() {
    cancelled = true
    session?.cancelExport()
  }

  private func time(_ s: Double) -> CMTime { CMTime(seconds: max(0, s), preferredTimescale: 90_000) }

  func run(_ spec: ExportSpec, progress: @escaping (Double) -> Void) async throws -> URL {
    let source = AVURLAsset(url: fileURL(spec.source), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let video = try await source.loadTracks(withMediaType: .video).first else { throw ExportFailure(message: "The video is missing its picture.") }
    let sound = try await source.loadTracks(withMediaType: .audio).first
    let sourceLength = try await source.load(.duration).seconds
    let natural = try await video.load(.naturalSize)
    let transform = try await video.load(.preferredTransform)

    let comp = AVMutableComposition()
    guard let picture = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw ExportFailure(message: "Couldn't start the export.")
    }
    var mixes: [AVMutableAudioMixInputParameters] = []
    func audioTrack() -> AVMutableCompositionTrack? { comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) }
    func params(_ track: AVMutableCompositionTrack) -> AVMutableAudioMixInputParameters {
      let p = AVMutableAudioMixInputParameters(track: track)
      p.audioTimePitchAlgorithm = .spectral // sped-up speech keeps its pitch, like ffmpeg's atempo
      mixes.append(p)
      return p
    }
    /// Volume v over [a, b] with fades `fin` in and `fout` out.
    func shape(_ p: AVMutableAudioMixInputParameters, _ a: Double, _ b: Double, _ v: Double, fin: Double, fout: Double) {
      let len = b - a
      guard len > 0 else { return }
      let i = min(fin, len / 2), o = min(fout, len / 2)
      let vol = Float(max(0, min(1, v)))
      p.setVolumeRamp(fromStartVolume: 0, toEndVolume: vol, timeRange: CMTimeRange(start: time(a), duration: time(i)))
      if len - i - o > 0 { p.setVolumeRamp(fromStartVolume: vol, toEndVolume: vol, timeRange: CMTimeRange(start: time(a + i), duration: time(len - i - o))) }
      p.setVolumeRamp(fromStartVolume: vol, toEndVolume: 0, timeRange: CMTimeRange(start: time(b - o), duration: time(o)))
    }

    // The picture: each clip in turn, sped up or slowed down.
    // Each clip goes exactly where the last one ended (the same CMTime values are reused for its
    // sound), so no gaps or overlaps build up from rounding.
    struct Placed {
      let start: Double, end: Double, speed: Double, volume: Double
      let grade: ExportSpec.Grade?
      let atTime: CMTime, lengthTime: CMTime
      var at: Double { atTime.seconds }
      var length: Double { lengthTime.seconds }
    }
    var placed: [Placed] = []
    for c in spec.clips {
      let s = max(0, c.start), e = min(c.end, sourceLength)
      guard e - s > 0.01 else { continue }
      let speed = max(0.1, c.speed ?? 1)
      let at = placed.isEmpty ? CMTime.zero : picture.timeRange.end
      let range = CMTimeRange(start: time(s), end: time(e))
      try picture.insertTimeRange(range, of: video, at: at)
      let length = speed == 1 ? range.duration : time((e - s) / speed)
      if speed != 1 { picture.scaleTimeRange(CMTimeRange(start: at, duration: range.duration), toDuration: length) }
      placed.append(Placed(start: s, end: e, speed: speed, volume: c.volume ?? 1, grade: c.grade, atTime: at, lengthTime: length))
    }
    guard !placed.isEmpty else { throw ExportFailure(message: "There's nothing left in this edit to export.") }
    let total = picture.timeRange.end.seconds

    // The sound.
    if let sound {
      let soundEnd = try await sound.load(.timeRange).end.seconds
      let lap = spec.overlap == true && placed.count > 1 ? Self.overlapSeconds : 0
      if lap == 0 {
        guard let track = audioTrack() else { throw ExportFailure(message: "Couldn't start the export.") }
        let p = params(track)
        for c in placed {
          let e = min(c.end, soundEnd)
          guard e - c.start > 0.01 else { continue }
          let range = CMTimeRange(start: time(c.start), end: time(e))
          try track.insertTimeRange(range, of: sound, at: c.atTime)
          let length = c.speed == 1 ? range.duration : time((e - c.start) / c.speed)
          if c.speed != 1 { track.scaleTimeRange(CMTimeRange(start: c.atTime, duration: range.duration), toDuration: length) }
          shape(p, c.at, c.at + length.seconds, c.volume, fin: Self.fade, fout: Self.fade)
        }
      } else {
        // Overlapping: each piece's sound starts `lap` early and runs `lap` past its cut, fading
        // across its neighbours, while the picture cuts exactly. Overlapping pieces need their
        // own tracks; they add up where they meet.
        var tracks: [(track: AVMutableCompositionTrack, p: AVMutableAudioMixInputParameters, end: Double)] = []
        for (i, c) in placed.enumerated() {
          let before = i > 0 ? min(lap, c.at) : 0
          let after = i < placed.count - 1 ? lap : 0
          let from = max(0, c.start - before * c.speed)
          let to = min(soundEnd, c.end + after * c.speed)
          guard to - from > 0.01 else { continue }
          let lead = (c.start - from) / c.speed
          let length = (to - from) / c.speed
          let at = c.at - lead
          let slot = tracks.firstIndex { $0.end <= at + 0.0005 }
          let index: Int
          if let slot { index = slot } else {
            guard let t = audioTrack() else { throw ExportFailure(message: "Couldn't start the export.") }
            tracks.append((t, params(t), 0))
            index = tracks.count - 1
          }
          let range = CMTimeRange(start: time(from), end: time(to))
          try tracks[index].track.insertTimeRange(range, of: sound, at: time(at))
          if c.speed != 1 { tracks[index].track.scaleTimeRange(CMTimeRange(start: time(at), duration: range.duration), toDuration: time(length)) }
          let fin = i > 0 ? (lead * 2 > 0 ? lead * 2 : Self.fade) : Self.fade
          let fout = after > 0 ? after * 2 : Self.fade
          shape(tracks[index].p, at, at + length, c.volume, fin: fin, fout: fout)
          tracks[index].end = at + length
        }
      }
    }

    // Music under everything, looped if it's short, faded out at the end.
    if let music = spec.music {
      let asset = AVURLAsset(url: fileURL(music.file))
      if let song = try await asset.loadTracks(withMediaType: .audio).first, let track = audioTrack() {
        let songLength = try await asset.load(.duration).seconds
        var at = 0.0
        while songLength > 0.05 && at < total - 0.01 {
          let piece = min(songLength, total - at)
          try track.insertTimeRange(CMTimeRange(start: .zero, duration: time(piece)), of: song, at: time(at))
          at += piece
        }
        let p = params(track)
        let vol = Float(max(0, min(1, music.volume ?? 0.5)))
        let tail = min(1.5, total / 4)
        p.setVolume(vol, at: .zero)
        p.setVolumeRamp(fromStartVolume: vol, toEndVolume: 0, timeRange: CMTimeRange(start: time(total - tail), duration: time(tail)))
      }
    }

    // The frame's size: the resolution's short side, never larger than the source, even numbers.
    let upright = CGRect(origin: .zero, size: natural).applying(transform)
    let ow = abs(upright.width), oh = abs(upright.height)
    let short = min(ow, oh)
    let k = min(1, CGFloat(spec.height) / max(1, short))
    let size = CGSize(width: max(2, (ow * k / 2).rounded() * 2), height: max(2, (oh * k / 2).rounded() * 2))

    // Overlays: photos are loaded once; videos get their own track (and their sound mixed in).
    var layers: [RenderPlan.Layer] = []
    for o in spec.overlays ?? [] {
      let url = fileURL(o.file)
      if o.kind == "video" {
        let asset = AVURLAsset(url: url)
        guard let v = try await asset.loadTracks(withMediaType: .video).first,
              let track = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
        let length = try await asset.load(.duration).seconds
        let from = max(0, min(o.from ?? 0, length))
        let dur = min(max(0.05, o.end - o.start), length - from, total - o.start)
        guard dur > 0.02 else { continue }
        try track.insertTimeRange(CMTimeRange(start: time(from), duration: time(dur)), of: v, at: time(o.start))
        layers.append(.init(spec: o, image: nil, trackID: track.trackID, orientation: orientation(of: try await v.load(.preferredTransform))))
        if (o.volume ?? 1) > 0, let a = try await asset.loadTracks(withMediaType: .audio).first, let at = audioTrack() {
          try at.insertTimeRange(CMTimeRange(start: time(from), duration: time(dur)), of: a, at: time(o.start))
          let p = params(at)
          p.setVolume(Float(min(1, o.volume ?? 1)), at: .zero)
        }
      } else if let img = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) {
        let still = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
        layers.append(.init(spec: o, image: still, trackID: kCMPersistentTrackID_Invalid, orientation: .up))
      }
    }

    // Captions and text, drawn as they come up.
    let fonts = spec.fonts ?? [:]
    let W = size.width, H = size.height
    var writings: [RenderPlan.Writing] = []
    if let caps = spec.captions {
      for e in caps.events where e.end > e.start {
        writings.append(.init(
          start: e.start, end: e.end,
          draw: { TextImage.render(style: caps.style, words: e.words, active: e.active ?? -1, align: "center", frameWidth: W, fonts: fonts) },
          place: { block in CGPoint(x: caps.x * W, y: caps.y * H - block.height / 2) }
        ))
      }
    }
    for t in spec.texts ?? [] where t.end > t.start {
      let align = t.align ?? "center"
      writings.append(.init(
        start: t.start, end: t.end,
        draw: { TextImage.render(style: t.style, words: [t.text], active: -1, align: align, frameWidth: W, fonts: fonts) },
        place: { block in
          let x = t.x * W + (align == "left" ? block.width / 2 : align == "right" ? -block.width / 2 : 0)
          return CGPoint(x: x, y: t.y * H)
        }
      ))
    }

    // Each graded clip's colour, by where it sits in the output.
    let grades: [RenderPlan.Graded] = placed.compactMap { c in
      guard let g = c.grade, let grading = Grading(lut: g.lut, size: g.size, sharpen: g.sharpen ?? 0, clarity: g.clarity ?? 0,
                                                   vignette: g.vignette ?? 0, grain: g.grain ?? 0) else { return nil }
      return .init(start: c.at, end: c.at + c.length, grading: grading)
    }

    let plan = RenderPlan(size: size, mainTrackID: picture.trackID, mainOrientation: orientation(of: transform),
                          keyframes: spec.keyframes ?? [], layers: layers, writings: writings, grades: grades)
    let composition = AVMutableVideoComposition()
    composition.customVideoCompositorClass = EditCompositor.self
    composition.renderSize = size
    composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, spec.fps)))
    composition.instructions = [EditInstruction(timeRange: CMTimeRange(start: .zero, duration: time(total)), plan: plan)]
    // Standard-range BT.709 (the iPhone's HDR video is converted), as social apps expect.
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    let mix = AVMutableAudioMix()
    mix.inputParameters = mixes

    let output = fileURL(spec.output)
    try? FileManager.default.removeItem(at: output)
    guard let session = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else {
      throw ExportFailure(message: "This phone can't export this video.")
    }
    session.outputURL = output
    session.outputFileType = .mp4
    session.videoComposition = composition
    session.audioMix = mix
    session.shouldOptimizeForNetworkUse = true
    session.timeRange = CMTimeRange(start: .zero, duration: time(total))
    self.session = session
    if cancelled { throw ExportFailure(message: "Export stopped.") }

    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { progress(Double(session.progress)) }
    timer.resume()
    defer { timer.cancel() }
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { done.resume() }
    }
    switch session.status {
    case .completed:
      progress(1)
      return output
    case .cancelled:
      throw ExportFailure(message: "Export stopped.")
    default:
      throw ExportFailure(message: session.error?.localizedDescription ?? "The export failed.")
    }
  }
}
