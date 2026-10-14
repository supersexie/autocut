// Draws the Autocut logo: the sliced play button (a play symbol cut clean through).
// Usage: swift scripts/make-icon.swift <out-dir> [concepts]
// Writes 1024×1024 masters; scripts/make-icons.sh resizes them into app/assets.
import AppKit

let size: CGFloat = 1024
let ink = NSColor(srgbRed: 0x11 / 255, green: 0x11 / 255, blue: 0x14 / 255, alpha: 1)
let paper = NSColor.white
let cut = NSColor(srgbRed: 0xF2 / 255, green: 0x54 / 255, blue: 0x5B / 255, alpha: 1)

func render(_ name: String, background: NSColor?, rounded: Bool = false, scale: CGFloat = 1, draw: (CGContext) -> Void) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext
  // Flip so y grows downward, like design tools.
  ctx.translateBy(x: 0, y: size)
  ctx.scaleBy(x: 1, y: -1)
  if rounded {
    ctx.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: size, height: size), cornerWidth: 230, cornerHeight: 230, transform: nil))
    ctx.clip()
  }
  if let background {
    ctx.setFillColor(background.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
  }
  // Scale the mark about the centre (Android's adaptive icon needs it inside a safe zone).
  ctx.translateBy(x: size / 2, y: size / 2)
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -size / 2, y: -size / 2)
  draw(ctx)
  NSGraphicsContext.restoreGraphicsState()
  let out = CommandLine.arguments[1] + "/" + name + ".png"
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
}

/// A play triangle with softly rounded corners.
func triangle(_ ctx: CGContext, _ a: CGPoint, _ b: CGPoint, _ c: CGPoint, color: NSColor, round: CGFloat = 64) {
  let path = CGMutablePath()
  path.move(to: a); path.addLine(to: b); path.addLine(to: c); path.closeSubpath()
  ctx.setFillColor(color.cgColor)
  ctx.setStrokeColor(color.cgColor)
  ctx.setLineWidth(round)
  ctx.setLineJoin(.round)
  ctx.addPath(path); ctx.fillPath()
  ctx.addPath(path); ctx.strokePath()
}

/// Clip to the side of the line p→q that contains `side`.
func halfPlane(_ ctx: CGContext, _ p: CGPoint, _ q: CGPoint, keepAbove: Bool) {
  let dx = q.x - p.x, dy = q.y - p.y
  let far: CGFloat = 4000
  let n = keepAbove ? CGPoint(x: dy, y: -dx) : CGPoint(x: -dy, y: dx)
  let len = sqrt(n.x * n.x + n.y * n.y)
  let off = CGPoint(x: n.x / len * far, y: n.y / len * far)
  let a = CGPoint(x: p.x - dx * 10, y: p.y - dy * 10)
  let b = CGPoint(x: q.x + dx * 10, y: q.y + dy * 10)
  let path = CGMutablePath()
  path.move(to: a); path.addLine(to: b)
  path.addLine(to: CGPoint(x: b.x + off.x, y: b.y + off.y))
  path.addLine(to: CGPoint(x: a.x + off.x, y: a.y + off.y))
  path.closeSubpath()
  ctx.addPath(path); ctx.clip()
}

// A — the sliced play button: a play triangle cut clean through, the lower piece nudged away.
func slicedPlay(_ ctx: CGContext, color: NSColor) {
  let A = CGPoint(x: 378, y: 276), B = CGPoint(x: 378, y: 748), C = CGPoint(x: 790, y: 512)
  let p = CGPoint(x: 250, y: 640), q = CGPoint(x: 800, y: 330) // the cut
  let gap: CGFloat = 26
  ctx.saveGState()
  halfPlane(ctx, CGPoint(x: p.x, y: p.y - gap), CGPoint(x: q.x, y: q.y - gap), keepAbove: true)
  triangle(ctx, A, B, C, color: color)
  ctx.restoreGState()
  ctx.saveGState()
  ctx.translateBy(x: 18, y: 26)
  halfPlane(ctx, CGPoint(x: p.x, y: p.y + gap), CGPoint(x: q.x, y: q.y + gap), keepAbove: false)
  triangle(ctx, A, B, C, color: color)
  ctx.restoreGState()
}

// B — the cut timeline: clips with the dead air taken out between them.
func timeline(_ ctx: CGContext) {
  let y: CGFloat = 512, h: CGFloat = 150
  let clips: [(CGFloat, CGFloat)] = [(196, 410), (452, 586), (628, 828)]
  for (x0, x1) in clips {
    ctx.setFillColor(paper.cgColor)
    ctx.addPath(CGPath(roundedRect: CGRect(x: x0, y: y - h / 2, width: x1 - x0, height: h), cornerWidth: 40, cornerHeight: 40, transform: nil))
    ctx.fillPath()
  }
  // Playhead.
  ctx.setFillColor(cut.cgColor)
  ctx.addPath(CGPath(roundedRect: CGRect(x: 514, y: 300, width: 18, height: 424), cornerWidth: 9, cornerHeight: 9, transform: nil))
  ctx.fillPath()
}

// C — "A" for Autocut, its crossbar replaced by a cut.
func monogram(_ ctx: CGContext) {
  ctx.setStrokeColor(paper.cgColor)
  ctx.setLineWidth(118)
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)
  let path = CGMutablePath()
  path.move(to: CGPoint(x: 300, y: 780)); path.addLine(to: CGPoint(x: 512, y: 250)); path.addLine(to: CGPoint(x: 724, y: 780))
  ctx.addPath(path); ctx.strokePath()
  // The cut: a gap through both legs.
  ctx.setBlendMode(.copy)
  ctx.setStrokeColor(ink.cgColor)
  ctx.setLineWidth(34)
  ctx.move(to: CGPoint(x: 230, y: 640)); ctx.addLine(to: CGPoint(x: 800, y: 560)); ctx.strokePath()
}

if CommandLine.arguments.contains("concepts") {
  render("concept-a-sliced-play", background: ink, rounded: true) { slicedPlay($0, color: paper) }
  render("concept-b-timeline", background: ink, rounded: true) { timeline($0) }
  render("concept-c-monogram", background: ink, rounded: true) { monogram($0) }
} else {
  // iOS masks the corners itself, so the app icon is a full square.
  render("icon", background: ink) { slicedPlay($0, color: paper) }
  // Splash and favicon: the rounded tile on a transparent background.
  render("tile", background: ink, rounded: true) { slicedPlay($0, color: paper) }
  // In-app logo: just the white mark.
  render("mark", background: nil) { slicedPlay($0, color: paper) }
  // Android adaptive icon layers (the mark must sit inside the middle ~66%).
  render("android-foreground", background: nil, scale: 0.62) { slicedPlay($0, color: paper) }
  render("android-background", background: ink) { _ in }
  render("android-monochrome", background: nil, scale: 0.62) { slicedPlay($0, color: paper) }
}
