import AVFoundation
import CoreImage
import Foundation

/// Everything the compositor needs to draw one frame of the edit.
final class RenderPlan {
  struct Layer {
    let spec: ExportSpec.Overlay
    /// Photo overlays: the picture (upright). Video overlays: their track in the composition.
    let image: CIImage?
    let trackID: CMPersistentTrackID
    let orientation: CGImagePropertyOrientation
  }
  /// A caption or text on screen for a stretch, drawn when first needed.
  struct Writing {
    let start: Double
    let end: Double
    let draw: () -> TextImage.Rendered?
    /// Where the block goes, given its size: the block's centre, top-down in pixels.
    let place: (CGSize) -> CGPoint
  }
  /// A clip's colour grade, for its stretch of the output.
  struct Graded {
    let start: Double
    let end: Double
    let grading: Grading
  }

  let size: CGSize
  let mainTrackID: CMPersistentTrackID
  let mainOrientation: CGImagePropertyOrientation
  let keyframes: [ExportSpec.Keyframe]
  let layers: [Layer]
  let writings: [Writing]
  let grades: [Graded]
  private var drawn: [Int: TextImage.Rendered?] = [:]
  private var drawnOrder: [Int] = []
  private let lock = NSLock()

  init(size: CGSize, mainTrackID: CMPersistentTrackID, mainOrientation: CGImagePropertyOrientation, keyframes: [ExportSpec.Keyframe], layers: [Layer], writings: [Writing], grades: [Graded] = []) {
    self.size = size
    self.mainTrackID = mainTrackID
    self.mainOrientation = mainOrientation
    self.keyframes = keyframes
    self.layers = layers
    self.writings = writings
    self.grades = grades
  }

  /// The grade of the clip on screen at output time `t`.
  func grading(at t: Double) -> Grading? {
    grades.first { t >= $0.start && t < $0.end }?.grading
  }

  /// A caption's picture, drawn once and kept while it's likely to be needed again (a few at a time).
  func rendered(_ i: Int) -> TextImage.Rendered? {
    lock.lock()
    defer { lock.unlock() }
    if let r = drawn[i] { return r }
    let r = writings[i].draw()
    drawn[i] = r
    drawnOrder.append(i)
    if drawnOrder.count > 12 { drawn[drawnOrder.removeFirst()] = nil }
    return r
  }

  /// The framing (zoom and move) at output time `t`: eased between keyframes, held at either end,
  /// and never moved far enough to show an edge (framingAt and clampFraming in the app).
  func framing(at t: Double) -> (scale: Double, x: Double, y: Double) {
    guard let first = keyframes.first, let last = keyframes.last else { return (1, 0, 0) }
    var f: (Double, Double, Double)
    if t <= first.t { f = (first.scale, first.x, first.y) }
    else if t >= last.t { f = (last.scale, last.x, last.y) }
    else {
      let i = keyframes.indices.first { t >= keyframes[$0].t && t < keyframes[$0 + 1].t } ?? 0
      let a = keyframes[i], b = keyframes[i + 1]
      let u0 = (t - a.t) / max(0.001, b.t - a.t)
      let u = u0 < 0.5 ? 4 * u0 * u0 * u0 : 1 - pow(-2 * u0 + 2, 3) / 2
      f = (a.scale + (b.scale - a.scale) * u, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)
    }
    let s = max(1, min(4, f.0))
    let room = (s - 1) / 2
    return (s, max(-room, min(room, f.1)), max(-room, min(room, f.2)))
  }
}

/// The video composition's one instruction: the whole edit, drawn by EditCompositor.
final class EditInstruction: NSObject, AVVideoCompositionInstructionProtocol {
  let timeRange: CMTimeRange
  let enablePostProcessing = false
  let containsTweening = true
  let requiredSourceTrackIDs: [NSValue]?
  let passthroughTrackID = kCMPersistentTrackID_Invalid
  let plan: RenderPlan

  init(timeRange: CMTimeRange, plan: RenderPlan) {
    self.timeRange = timeRange
    self.plan = plan
    var ids = [plan.mainTrackID]
    ids += plan.layers.compactMap { $0.trackID == kCMPersistentTrackID_Invalid ? nil : $0.trackID }
    requiredSourceTrackIDs = ids.map { NSNumber(value: $0) }
  }
}

/// The orientation that turns a track's stored frames upright, from its preferred transform.
func orientation(of t: CGAffineTransform) -> CGImagePropertyOrientation {
  switch (t.a, t.b, t.c, t.d) {
  case (0, 1, -1, 0): return .right
  case (0, -1, 1, 0): return .left
  case (-1, 0, 0, -1): return .down
  default: return .up
  }
}

/// Draws each frame: the picture (graded, then zoomed and moved by the keyframes), the overlays, then the
/// captions and text: the same order as the server's render.
final class EditCompositor: NSObject, AVVideoCompositing {
  private static let pixelFormat: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
    kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
  ]
  var sourcePixelBufferAttributes: [String: Any]? { Self.pixelFormat }
  var requiredPixelBufferAttributesForRenderContext: [String: Any] { Self.pixelFormat }
  // No colour management: the frames' values go through as they are (the composition already
  // converts the source to standard-range BT.709).
  private let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
  private let queue = DispatchQueue(label: "autocut.export.compose")

  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    queue.async {
      autoreleasepool {
        guard let instruction = request.videoCompositionInstruction as? EditInstruction,
              let out = request.renderContext.newPixelBuffer()
        else {
          request.finish(with: NSError(domain: "AutocutExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't draw a frame."]))
          return
        }
        let plan = instruction.plan
        let frame = self.compose(plan, request)
        self.context.render(frame, to: out, bounds: CGRect(origin: .zero, size: plan.size), colorSpace: nil)
        request.finish(withComposedVideoFrame: out)
      }
    }
  }

  /// A track's frame upright, with its bottom-left corner at the origin.
  private func upright(_ buffer: CVPixelBuffer, _ o: CGImagePropertyOrientation) -> CIImage {
    let img = CIImage(cvPixelBuffer: buffer).oriented(o)
    return img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
  }

  private func compose(_ plan: RenderPlan, _ request: AVAsynchronousVideoCompositionRequest) -> CIImage {
    let W = plan.size.width, H = plan.size.height
    let bounds = CGRect(x: 0, y: 0, width: W, height: H)
    let t = request.compositionTime.seconds
    var frame = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: bounds)

    // The picture, filling the frame, then zoomed about the centre and moved.
    if let buffer = request.sourceFrame(byTrackID: plan.mainTrackID) {
      var img = upright(buffer, plan.mainOrientation)
      let fit = CGAffineTransform(scaleX: W / img.extent.width, y: H / img.extent.height)
      img = img.transformed(by: fit)
      if let grading = plan.grading(at: t) { img = grading.apply(img, t: t, managed: false) }
      let f = plan.framing(at: t)
      if f.scale != 1 || f.x != 0 || f.y != 0 {
        // Top-down, the picture moves right by x·W and down by y·H; Core Image is bottom-up.
        let z = CGAffineTransform(translationX: -W / 2, y: -H / 2)
          .concatenating(CGAffineTransform(scaleX: f.scale, y: f.scale))
          .concatenating(CGAffineTransform(translationX: W / 2 + f.x * W, y: H / 2 - f.y * H))
        img = img.transformed(by: z)
      }
      frame = img.cropped(to: bounds).composited(over: frame)
    }

    // Overlays, bottom to top: sized to their width, turned, centred where they were put.
    for layer in plan.layers where t >= layer.spec.start && t <= layer.spec.end {
      var img: CIImage?
      if let still = layer.image { img = still }
      else if let buffer = request.sourceFrame(byTrackID: layer.trackID) { img = upright(buffer, layer.orientation) }
      guard var pic = img, pic.extent.width > 0 else { continue }
      let px = max(2, (layer.spec.width * W / 2).rounded() * 2)
      let k = px / pic.extent.width
      pic = pic.transformed(by: CGAffineTransform(scaleX: k, y: k))
      let rad = (layer.spec.rotation ?? 0) * .pi / 180
      let centre = CGPoint(x: layer.spec.x * W, y: H - layer.spec.y * H)
      pic = pic.transformed(by: CGAffineTransform(translationX: -pic.extent.width / 2, y: -pic.extent.height / 2)
        .concatenating(CGAffineTransform(rotationAngle: -rad)) // clockwise on screen
        .concatenating(CGAffineTransform(translationX: centre.x, y: centre.y)))
      frame = pic.composited(over: frame)
    }

    // Captions and text on top.
    for (i, w) in plan.writings.enumerated() where t >= w.start && t < w.end {
      guard let r = plan.rendered(i) else { continue }
      let img = CIImage(cgImage: r.image)
      let c = w.place(r.block)
      let origin = CGPoint(x: c.x - img.extent.width / 2, y: (H - c.y) - img.extent.height / 2)
      frame = img.transformed(by: CGAffineTransform(translationX: origin.x.rounded(), y: origin.y.rounded())).composited(over: frame)
    }
    return frame.cropped(to: bounds)
  }

  func cancelAllPendingVideoCompositionRequests() {}
}
