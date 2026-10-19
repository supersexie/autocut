import CoreImage
import Foundation

// The same file is in modules/autocut-player/ios and modules/autocut-export/ios: keep the two
// copies the same.

/// A clip's colour grade (src/lib/grade.mjs): the colour LUT from its file, then clarity, sharpen,
/// vignette and grain, matching the editor preview (GradedFrame.tsx) and the server (src/media.js).
final class Grading {
  let size: Int
  let cube: Data
  let sharpen: Double
  let clarity: Double
  let vignette: Double
  let grain: Double

  private static var loaded: [String: Data] = [:]
  private static let lock = NSLock()

  /// Nil when the file is missing or isn't size³ RGBA floats.
  init?(lut: String, size: Int, sharpen: Double, clarity: Double, vignette: Double, grain: Double) {
    let url: URL = {
      if let u = URL(string: lut), u.scheme != nil { return u }
      return URL(fileURLWithPath: lut)
    }()
    Self.lock.lock()
    var data = Self.loaded[lut]
    if data == nil, let read = try? Data(contentsOf: url) {
      if Self.loaded.count > 40 { Self.loaded.removeAll() }
      Self.loaded[lut] = read
      data = read
    }
    Self.lock.unlock()
    guard size >= 2, size <= 64, let data, data.count == size * size * size * 16 else { return nil }
    self.size = size
    self.cube = data
    self.sharpen = sharpen
    self.clarity = clarity
    self.vignette = vignette
    self.grain = grain
  }

  /// `img` graded, at output time `t` (for the grain). `managed`: the image is in Core Image's linear
  /// working space, so the LUT is applied to BT.709 values, as the video stores them.
  func apply(_ img: CIImage, t: Double, managed: Bool) -> CIImage {
    let extent = img.extent
    guard extent.width > 0, extent.height > 0, !extent.isInfinite else { return img }
    var out: CIImage
    if managed, let space = CGColorSpace(name: CGColorSpace.itur_709) {
      out = img.applyingFilter("CIColorCubeWithColorSpace", parameters: [
        "inputCubeDimension": size, "inputCubeData": cube, "inputColorSpace": space,
      ])
    } else {
      out = img.applyingFilter("CIColorCube", parameters: ["inputCubeDimension": size, "inputCubeData": cube])
    }
    // Pixel sizes are for a 1080-wide frame, like the server's.
    let k = min(extent.width, extent.height) / 1080
    if clarity > 0 {
      out = out.clampedToExtent().applyingFilter("CIUnsharpMask", parameters: [
        kCIInputRadiusKey: 6 * k, kCIInputIntensityKey: clarity * 0.9,
      ]).cropped(to: extent)
    }
    if sharpen > 0 {
      out = out.clampedToExtent().applyingFilter("CIUnsharpMask", parameters: [
        kCIInputRadiusKey: 2 * k, kCIInputIntensityKey: sharpen * 1.4,
      ]).cropped(to: extent)
    }
    if vignette > 0 {
      // Darker towards the corners: full strength from 0.78 of the width out from the centre.
      let w = extent.width
      let edge = 1 - vignette * 0.85
      let mask = CIFilter(name: "CIRadialGradient", parameters: [
        "inputCenter": CIVector(x: extent.midX, y: extent.midY),
        "inputRadius0": w * 0.25 / 1.15,
        "inputRadius1": w * 0.78 / 1.15,
        "inputColor0": CIColor(red: 1, green: 1, blue: 1),
        "inputColor1": CIColor(red: edge, green: edge, blue: edge),
      ])?.outputImage?.cropped(to: extent)
      if let mask { out = mask.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: out]) }
    }
    if grain > 0, let noise = CIFilter(name: "CIRandomGenerator")?.outputImage {
      // Grey noise around zero, a fresh pattern every frame, added on top.
      let a = grain * 0.16
      let shift = (t * 30).rounded()
      let grey = noise
        .transformed(by: CGAffineTransform(translationX: CGFloat(Int(shift * 131) % 2048), y: CGFloat(Int(shift * 71) % 2048)))
        .applyingFilter("CIColorMatrix", parameters: [
          "inputRVector": CIVector(x: a, y: 0, z: 0, w: 0),
          "inputGVector": CIVector(x: a, y: 0, z: 0, w: 0),
          "inputBVector": CIVector(x: a, y: 0, z: 0, w: 0),
          "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
          "inputBiasVector": CIVector(x: -a / 2, y: -a / 2, z: -a / 2, w: 0),
        ])
        .cropped(to: extent)
      out = grey.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: out])
    }
    return out.cropped(to: extent)
  }
}
