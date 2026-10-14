import AVFoundation
import ExpoModulesCore
import UIKit

/// Plays an edit as one continuous video. The clips are stitched into an AVMutableComposition
/// (with each clip's speed and volume), so playback runs straight through the cuts with no seeking.
/// All times in and out of this view are output times: seconds into the edited video.
final class AutocutPlayerView: ExpoView {
  let onTime = EventDispatcher()
  let onPlayingChange = EventDispatcher()
  let onEnd = EventDispatcher()

  let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()

  private struct Source {
    let video: AVAssetTrack
    let videoRange: CMTimeRange
    let audio: AVAssetTrack?
    let audioRange: CMTimeRange
    let transform: CGAffineTransform
  }
  private var sourceURI: String?
  private var source: Source?
  private var loadID = UUID()
  private var clips: [ClipRecord] = []
  private var duration = 0.0

  /// The output time the user asked for last; kept across rebuilds of the composition.
  private var wanted = 0.0
  private var seeking = false
  private var pendingSeek: Double?

  private var timeObserver: Any?
  private var rateObserver: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(playerLayer)
    player.actionAtItemEnd = .pause
    // Local files: start at once instead of waiting to buffer.
    player.automaticallyWaitsToMinimizeStalling = false

    timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] t in
      guard let self, self.player.rate != 0, t.isNumeric else { return }
      self.wanted = t.seconds
      self.onTime(["time": t.seconds])
    }
    rateObserver = player.observe(\.rate, options: [.new]) { [weak self] p, _ in
      let playing = p.rate != 0
      DispatchQueue.main.async { self?.onPlayingChange(["playing": playing]) }
    }
  }

  deinit {
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    rateObserver?.invalidate()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  // MARK: - Props

  func setSource(_ uri: String?) {
    guard uri != sourceURI else { return }
    sourceURI = uri
    source = nil
    guard let uri, let url = URL(string: uri) else { return }
    let asset = AVURLAsset(url: url)
    let id = UUID()
    loadID = id
    Task { @MainActor [weak self] in
      guard let video = try? await asset.loadTracks(withMediaType: .video).first,
            let videoRange = try? await video.load(.timeRange) else { return }
      let transform = (try? await video.load(.preferredTransform)) ?? .identity
      let audio = try? await asset.loadTracks(withMediaType: .audio).first
      var audioRange = CMTimeRange.zero
      if let audio, let range = try? await audio.load(.timeRange) { audioRange = range }
      guard let self, self.loadID == id else { return }
      self.source = Source(video: video, videoRange: videoRange, audio: audio, audioRange: audioRange, transform: transform)
      self.rebuild()
    }
  }

  func setClips(_ next: [ClipRecord]) {
    guard next != clips else { return }
    clips = next
    rebuild()
  }

  // MARK: - Controls

  func play() {
    if wanted >= duration - 0.05 { seek(to: 0) }
    activateAudioSession()
    player.play()
  }

  func pause() {
    player.pause()
  }

  /// Seeks exactly, dropping in-between requests while one is running so scrubbing keeps up.
  func seek(to seconds: Double) {
    wanted = max(0, seconds)
    if seeking {
      pendingSeek = wanted
      return
    }
    seeking = true
    player.seek(to: CMTime(seconds: wanted, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.seeking = false
        if let next = self.pendingSeek {
          self.pendingSeek = nil
          self.seek(to: next)
        }
      }
    }
  }

  // MARK: - Composition

  private func rebuild() {
    guard let source, !clips.isEmpty else { return }
    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { return }
    videoTrack.preferredTransform = source.transform
    let audioTrack = source.audio == nil ? nil : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    let volumes = audioTrack.map { AVMutableAudioMixInputParameters(track: $0) }

    var cursor = CMTime.zero
    for clip in clips {
      let range = CMTimeRange(
        start: CMTime(seconds: clip.start, preferredTimescale: 600),
        end: CMTime(seconds: max(clip.end, clip.start + 0.01), preferredTimescale: 600)
      ).intersection(source.videoRange)
      if range.duration <= .zero { continue }
      do {
        try videoTrack.insertTimeRange(range, of: source.video, at: cursor)
      } catch {
        continue
      }
      if let audioTrack, let audio = source.audio {
        let audioPart = range.intersection(source.audioRange)
        if audioPart.duration > .zero {
          try? audioTrack.insertTimeRange(audioPart, of: audio, at: cursor + (audioPart.start - range.start))
        }
      }
      var length = range.duration
      if clip.speed > 0 && clip.speed != 1 {
        let scaled = CMTimeMultiplyByFloat64(range.duration, multiplier: 1 / clip.speed)
        let inserted = CMTimeRange(start: cursor, duration: range.duration)
        videoTrack.scaleTimeRange(inserted, toDuration: scaled)
        audioTrack?.scaleTimeRange(inserted, toDuration: scaled)
        length = scaled
      }
      volumes?.setVolume(Float(min(1, max(0, clip.volume))), at: cursor)
      cursor = cursor + length
    }
    duration = cursor.seconds

    let item = AVPlayerItem(asset: composition)
    item.audioTimePitchAlgorithm = .spectral // speed changes keep the voice's pitch
    if let volumes {
      let mix = AVMutableAudioMix()
      mix.inputParameters = [volumes]
      item.audioMix = mix
    }

    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.player.pause()
      self.seek(to: 0)
      self.onTime(["time": 0])
      self.onEnd()
    }

    let wasPlaying = player.rate != 0
    player.replaceCurrentItem(with: item)
    seeking = false
    pendingSeek = nil
    seek(to: min(wanted, max(0, duration - 0.01)))
    if wasPlaying { player.play() }
  }

  /// Play sound even with the silent switch on, like other video apps.
  private func activateAudioSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .moviePlayback)
    try? session.setActive(true)
  }
}
