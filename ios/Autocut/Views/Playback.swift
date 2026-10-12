import AVFoundation
import SwiftUI

@Observable @MainActor
final class PlaybackModel {
    @ObservationIgnored let player = AVPlayer()
    var time: Double = 0
    var isPlaying = false
    var isMuted = false { didSet { player.isMuted = isMuted } }

    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?

    init(muted: Bool = false) {
        isMuted = muted
        player.isMuted = muted
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.time = t.seconds }
        }
    }

    /// Loads an item that loops forever, like a story preview.
    func load(_ item: AVPlayerItem) {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        player.replaceCurrentItem(with: item)
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.player.seek(to: .zero)
                if self?.isPlaying == true { self?.player.play() }
            }
        }
    }

    func play() { player.play(); isPlaying = true }
    func pause() { player.pause(); isPlaying = false }
    func toggle() { isPlaying ? pause() : play() }
}

struct PlayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspectFill

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
    }
}

/// The source timeline: kept speech in blue, cuts marked in red as they're found.
struct TimelineBar: View {
    let duration: Double
    var segments: [KeptSegment]? = nil
    let cuts: [Cut]
    var playhead: Double? = nil

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x = { (t: Double) in CGFloat(t / max(duration, 0.001)) * w }
            ZStack(alignment: .leading) {
                Capsule().fill(segments == nil ? Theme.accent.opacity(0.85) : Color.white.opacity(0.25))
                if let segments {
                    ForEach(segments, id: \.self) { s in
                        Capsule().fill(Theme.accent)
                            .frame(width: max(2, x(s.end) - x(s.start)))
                            .offset(x: x(s.start))
                    }
                }
                ForEach(cuts, id: \.self) { c in
                    Rectangle().fill(Theme.cut.opacity(segments == nil ? 0.9 : 0.55))
                        .frame(width: max(2, x(c.end) - x(c.start)))
                        .offset(x: x(c.start))
                        .transition(.scale(scale: 0.2, anchor: .center).combined(with: .opacity))
                }
                if let playhead {
                    RoundedRectangle(cornerRadius: 1.5).fill(.white)
                        .frame(width: 3, height: 18)
                        .shadow(radius: 2)
                        .offset(x: x(playhead) - 1.5)
                }
            }
            .frame(height: 8)
            .frame(maxHeight: .infinity)
        }
        .frame(height: 20)
        .animation(.spring(duration: 0.35), value: cuts.count)
    }
}

struct CaptionOverlay: View {
    let line: CaptionLine?

    var body: some View {
        GeometryReader { geo in
            if let line {
                Text(line.text)
                    .font(.system(size: geo.size.width * 0.075, weight: .heavy))
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: 0, x: 1.5, y: 1.5)
                    .shadow(color: .black.opacity(0.6), radius: 6)
                    .multilineTextAlignment(.center)
                    .frame(width: geo.size.width * 0.86)
                    .position(x: geo.size.width / 2, y: geo.size.height * 0.68)
                    .id(line)
                    .transition(.scale(scale: 0.9).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.12), value: line)
        .allowsHitTesting(false)
    }
}
