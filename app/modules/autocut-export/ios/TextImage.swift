import CoreGraphics
import CoreText
import Foundation

/// Draws a caption or text the way the editor shows it (StyledText.tsx): font size 8.5% of the
/// frame's width for size 1, outline, background box, glow, drop shadow, tilt, and the spoken
/// word picked out. Widths (outline, shadow, glow) are in a 1080-wide frame's pixels, like the
/// presets.
enum TextImage {
  struct Rendered {
    let image: CGImage
    /// The text block's size before any tilt (the box, or the text with its padding). The block's
    /// centre is the image's centre.
    let block: CGSize
  }

  private static let fontScale = 0.085
  private static var fontCache: [String: CGFont] = [:]
  private static let cacheLock = NSLock()
  private static let activeKey = NSAttributedString.Key("autocut.active")

  /// The font for a family: from its file when the app passed one, else by name.
  static func font(_ family: String, size: CGFloat, files: [String: String]) -> CTFont {
    cacheLock.lock()
    defer { cacheLock.unlock() }
    if let cg = fontCache[family] { return CTFontCreateWithGraphicsFont(cg, size, nil, nil) }
    if let path = files[family], let provider = CGDataProvider(url: fileURL(path) as CFURL), let cg = CGFont(provider) {
      fontCache[family] = cg
      return CTFontCreateWithGraphicsFont(cg, size, nil, nil)
    }
    return CTFontCreateWithName(family as CFString, size, nil)
  }

  static func color(_ hex: String?, alpha: CGFloat = 1) -> CGColor {
    var h = (hex ?? "#000000").trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    let v = UInt32(h.prefix(6), radix: 16) ?? 0
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: alpha)
  }

  private struct Line {
    let line: CTLine
    let range: CFRange
    let width: CGFloat
    var origin = CGPoint.zero // top-down: x of the line's start, y of its baseline
  }

  /// `words` joined by spaces; `active` is the index of the word being spoken (-1: none).
  /// `align`: "left", "right" or "center".
  static func render(style s: ExportSpec.Style, words: [String], active: Int, align: String, frameWidth: CGFloat, fonts: [String: String]) -> Rendered? {
    let fontSize = frameWidth * fontScale * s.size
    let unit = frameWidth / 1080
    let outline = (s.outlineWidth ?? 0) * unit
    let boxed = s.box != nil
    let stroke = !boxed && outline > 0
    let glow = (s.glow ?? 0) * unit * 3
    let shadow = glow > 0 ? 0 : (s.shadow ?? 0) * unit
    let padH = fontSize * 0.14
    let padTop = fontSize * 0.04
    let lineHeight = fontSize * 1.32
    let mode = s.highlightMode
    let font = font(s.font, size: fontSize, files: fonts)

    // The text, with the spoken word marked so glyph runs break around it.
    let attributed = NSMutableAttributedString()
    var activeRange: NSRange?
    for (i, w) in words.enumerated() {
      if i > 0 { attributed.append(NSAttributedString(string: " ")) }
      if i == active { activeRange = NSRange(location: attributed.length, length: (w as NSString).length) }
      attributed.append(NSAttributedString(string: w))
    }
    guard attributed.length > 0 else { return nil }
    let all = NSRange(location: 0, length: attributed.length)
    attributed.addAttribute(kCTFontAttributeName as NSAttributedString.Key, value: font, range: all)
    attributed.addAttribute(kCTForegroundColorFromContextAttributeName as NSAttributedString.Key, value: true, range: all)
    if let r = activeRange { attributed.addAttribute(activeKey, value: true, range: r) }

    // Lines broken to fit 88% of the frame's width, like the preview.
    let maxText = max(fontSize, frameWidth * 0.93 - 2 * padH - (boxed ? 2 * outline : 0))
    let typesetter = CTTypesetterCreateWithAttributedString(attributed)
    var lines: [Line] = []
    var at = 0
    while at < attributed.length {
      let count = CTTypesetterSuggestLineBreak(typesetter, at, Double(maxText))
      guard count > 0 else { break }
      let range = CFRange(location: at, length: count)
      let line = CTTypesetterCreateLine(typesetter, range)
      let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil) - CTLineGetTrailingWhitespaceWidth(line))
      lines.append(Line(line: line, range: range, width: width))
      at += count
    }
    guard !lines.isEmpty else { return nil }

    let textWidth = (lines.map(\.width).max() ?? 0) + 2 * padH
    let textHeight = CGFloat(lines.count) * lineHeight + padTop
    let block = CGSize(width: ceil(textWidth + (boxed ? 2 * outline : 0)), height: ceil(textHeight + (boxed ? 2 * outline * 0.35 : 0)))

    let ascent = CTFontGetAscent(font)
    let descent = CTFontGetDescent(font)
    let leading = (lineHeight - (ascent + descent)) / 2
    let inset = CGPoint(x: (boxed ? outline : 0) + padH, y: (boxed ? outline * 0.35 : 0) + padTop)
    for i in lines.indices {
      let free = textWidth - 2 * padH - lines[i].width
      let x = inset.x + (align == "left" ? 0 : align == "right" ? free : free / 2)
      lines[i].origin = CGPoint(x: x, y: inset.y + CGFloat(i) * lineHeight + leading + ascent)
    }

    // Room around the block for the outline, glow, shadow and the tilt.
    let margin = ceil(outline * 1.5 + glow * 2 + shadow + fontSize * 0.35)
    let degrees = -(s.rotate ?? 0) // the preview turns by -rotate degrees: clockwise for positive
    let angle = CGFloat(degrees * .pi / 180)
    let inner = CGRect(x: 0, y: 0, width: block.width + 2 * margin, height: block.height + 2 * margin)
    let turned = inner.applying(CGAffineTransform(rotationAngle: angle))
    let width = Int(ceil(turned.width)), height = Int(ceil(turned.height))
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }

    // From here on, coordinates are top-down from the block's top-left (Core Graphics is
    // bottom-up: flipped once here, and flipped back for each piece of text), tilted about the
    // image's centre.
    ctx.translateBy(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
    ctx.scaleBy(x: 1, y: -1)
    ctx.rotate(by: angle) // flipped, so a positive angle turns clockwise on screen
    ctx.translateBy(x: -block.width / 2, y: -block.height / 2)
    ctx.setShouldAntialias(true)

    if let box = s.box {
      let radius = outline * 0.6
      ctx.addPath(CGPath(roundedRect: CGRect(origin: .zero, size: block), cornerWidth: radius, cornerHeight: radius, transform: nil))
      ctx.setFillColor(color(box))
      ctx.fillPath()
    }

    // The spoken word's background (Word Box), reaching as far as the outline does.
    if mode == "box", let r = activeRange, let hl = s.highlightColor {
      let grow = stroke ? outline * 0.75 : 0
      ctx.setFillColor(color(hl))
      for l in lines {
        let lo = max(r.location, l.range.location), hi = min(r.location + r.length, l.range.location + l.range.length)
        guard hi > lo else { continue }
        let x0 = CTLineGetOffsetForStringIndex(l.line, lo, nil), x1 = CTLineGetOffsetForStringIndex(l.line, hi, nil)
        let top = l.origin.y - ascent - leading
        ctx.fill(CGRect(x: l.origin.x + x0 - grow, y: top - grow, width: x1 - x0 + 2 * grow, height: lineHeight + 2 * grow))
      }
    }

    /// Draws every glyph run, each in the colour `paint` gives it (true = the spoken word).
    func draw(_ drawing: CGTextDrawingMode, offset: CGPoint = .zero, paint: (Bool) -> CGColor) {
      ctx.setTextDrawingMode(drawing)
      for l in lines {
        for run in CTLineGetGlyphRuns(l.line) as! [CTRun] {
          let attrs = CTRunGetAttributes(run) as NSDictionary
          let c = paint(attrs[activeKey] != nil)
          ctx.setFillColor(c)
          ctx.setStrokeColor(c)
          ctx.saveGState()
          ctx.translateBy(x: l.origin.x + offset.x, y: l.origin.y + offset.y)
          ctx.scaleBy(x: 1, y: -1) // upright text
          ctx.textPosition = .zero
          CTRunDraw(run, ctx, CFRange(location: 0, length: 0))
          ctx.restoreGState()
        }
      }
    }
    let fill = color(s.color)
    let wordColor: (Bool) -> CGColor = { on in on && mode == "color" ? color(s.highlightColor) : fill }

    // 1. Outline: a round-joined stroke under the fill (the preview's eight shifted copies, 0.75× out).
    if stroke {
      ctx.setLineWidth(outline * 1.5)
      ctx.setLineJoin(.round)
      draw(.stroke) { _ in color(s.outline) }
    }
    // 2. Drop shadow (down and right, 55% black), or a glow in the outline's colour.
    if shadow > 0 { draw(.fill, offset: CGPoint(x: shadow, y: shadow)) { _ in color("#000000", alpha: 0.55) } }
    if glow > 0 {
      ctx.saveGState()
      ctx.setShadow(offset: .zero, blur: glow, color: color(s.outline))
      draw(.fill, paint: wordColor)
      ctx.restoreGState()
    }
    // 3. The words.
    draw(.fill, paint: wordColor)

    guard let image = ctx.makeImage() else { return nil }
    return Rendered(image: image, block: block)
  }
}
