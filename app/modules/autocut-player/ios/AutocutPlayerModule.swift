import ExpoModulesCore

/// A clip's colour grade: its LUT file (Float32 RGBA, size³, red fastest) and effects, 0...1.
struct GradeRecord: Record, Equatable {
  @Field var lut: String = ""
  @Field var size: Int = 0
  @Field var sharpen: Double = 0
  @Field var clarity: Double = 0
  @Field var vignette: Double = 0
  @Field var grain: Double = 0

  static func == (a: GradeRecord, b: GradeRecord) -> Bool {
    a.lut == b.lut && a.size == b.size && a.sharpen == b.sharpen && a.clarity == b.clarity && a.vignette == b.vignette && a.grain == b.grain
  }
}

/// One clip of the edit: a range of the source video, its speed, volume and colour grade.
struct ClipRecord: Record, Equatable {
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var speed: Double = 1
  @Field var volume: Double = 1
  @Field var grade: GradeRecord?

  static func == (a: ClipRecord, b: ClipRecord) -> Bool {
    a.start == b.start && a.end == b.end && a.speed == b.speed && a.volume == b.volume && a.grade == b.grade
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
