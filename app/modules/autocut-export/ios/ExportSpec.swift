import Foundation

/// What to export: the same edit the server renders (src/media.js render), with every file local.
/// Built by the app (src/lib/localExport.ts) and passed as JSON. Times are output seconds unless
/// they say otherwise; positions and sizes are fractions of the frame.
struct ExportSpec: Decodable {
  struct Clip: Decodable {
    /// Source seconds.
    var start: Double
    var end: Double
    var speed: Double?
    var volume: Double?
    var grade: Grade?
  }
  /// A clip's colour grade: its LUT file (Float32 RGBA, size³, red fastest) and effects, 0...1.
  struct Grade: Decodable {
    var lut: String
    var size: Int
    var sharpen: Double?
    var clarity: Double?
    var vignette: Double?
    var grain: Double?
  }
  struct Music: Decodable {
    var file: String
    var volume: Double?
  }
  struct Keyframe: Decodable {
    var t: Double
    var scale: Double
    var x: Double
    var y: Double
  }
  struct Overlay: Decodable {
    var file: String
    var kind: String // "image" or "video"
    var start: Double
    var end: Double
    /// Video overlays: where in their own file they start playing.
    var from: Double?
    /// Centre, and width as a fraction of the frame's width (height follows the media's shape).
    var x: Double
    var y: Double
    var width: Double
    /// Degrees clockwise.
    var rotation: Double?
    var volume: Double?
  }
  /// A caption/text look with the user's changes already applied (withLook in the app).
  struct Style: Decodable {
    var font: String
    /// 1 = 8.5% of the frame's width; includes the user's scale.
    var size: Double
    var color: String
    var outline: String?
    var outlineWidth: Double?
    var box: String?
    var shadow: Double?
    /// Degrees, as in the presets (positive = counterclockwise).
    var rotate: Double?
    var glow: Double?
    var highlightMode: String?
    var highlightColor: String?
  }
  /// One caption on screen: its words (already in their final case) and the word being spoken.
  struct CaptionEvent: Decodable {
    var start: Double
    var end: Double
    var words: [String]
    var active: Int?
  }
  struct Captions: Decodable {
    var style: Style
    /// Where the middle of the captions' bottom edge sits.
    var x: Double
    var y: Double
    var events: [CaptionEvent]
  }
  struct Text: Decodable {
    var style: Style
    var text: String
    var start: Double
    var end: Double
    /// The text's centre (or the middle of its left/right edge when aligned that way).
    var x: Double
    var y: Double
    var align: String?
  }

  var source: String
  var output: String
  /// The resolution's short side (1080 = 1080×1920 for vertical video), never upscaled.
  var height: Int
  var fps: Int
  var clips: [Clip]
  var overlap: Bool?
  var music: Music?
  var keyframes: [Keyframe]?
  var overlays: [Overlay]?
  var captions: Captions?
  var texts: [Text]?
  /// Font family → font file, so the export never depends on what's registered with the system.
  var fonts: [String: String]?
}

func fileURL(_ s: String) -> URL {
  if let u = URL(string: s), u.scheme != nil { return u }
  return URL(fileURLWithPath: s)
}
