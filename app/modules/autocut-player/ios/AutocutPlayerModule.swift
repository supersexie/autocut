import ExpoModulesCore

/// One clip of the edit: a range of the source video, its speed and volume.
struct ClipRecord: Record, Equatable {
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var speed: Double = 1
  @Field var volume: Double = 1

  static func == (a: ClipRecord, b: ClipRecord) -> Bool {
    a.start == b.start && a.end == b.end && a.speed == b.speed && a.volume == b.volume
  }
}

public final class AutocutPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutocutPlayer")

    View(AutocutPlayerView.self) {
      Events("onTime", "onPlayingChange", "onEnd")

      Prop("source") { (view: AutocutPlayerView, source: String?) in
        view.setSource(source)
      }

      Prop("clips") { (view: AutocutPlayerView, clips: [ClipRecord]?) in
        view.setClips(clips ?? [])
      }

      Prop("muted") { (view: AutocutPlayerView, muted: Bool?) in
        view.player.isMuted = muted ?? false
      }

      AsyncFunction("play") { (view: AutocutPlayerView) in
        view.play()
      }.runOnQueue(.main)

      AsyncFunction("pause") { (view: AutocutPlayerView) in
        view.pause()
      }.runOnQueue(.main)

      AsyncFunction("seek") { (view: AutocutPlayerView, time: Double) in
        view.seek(to: time)
      }.runOnQueue(.main)
    }
  }
}
