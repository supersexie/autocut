import AVFoundation
import CoreText
import QuartzCore

/// Builds the edited video from the kept segments. The same composition drives the instant
/// in-app preview and the exported file, so what you watch is exactly what you save.
struct EditedVideo {
    let composition: AVMutableComposition
    let audioMix: AVMutableAudioMix?

    func playerItem() -> AVPlayerItem {
        let item = AVPlayerItem(asset: composition)
        item.audioMix = audioMix
        return item
    }
}

enum CutComposer {
    static let fade = CMTime(value: 12, timescale: 1000) // short audio fades so cuts don't click

    static func compose(source: URL, plan: CutPlan) async throws -> EditedVideo {
        let asset = AVURLAsset(url: source)
        guard let srcVideo = try await asset.loadTracks(withMediaType: .video).first else { throw AutocutError.noVideo }
        let srcAudio = try await asset.loadTracks(withMediaType: .audio).first
        let assetDuration = try await asset.load(.duration)

        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw AutocutError.noVideo }
        video.preferredTransform = try await srcVideo.load(.preferredTransform)
        let audio = srcAudio.flatMap { _ in composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) }
        let mixParams = audio.map { AVMutableAudioMixInputParameters(track: $0) }

        var cursor = CMTime.zero
        for s in plan.segments {
            let start = CMTime(seconds: s.start, preferredTimescale: 600)
            let end = CMTimeMinimum(CMTime(seconds: s.end, preferredTimescale: 600), assetDuration)
            guard end > start else { continue }
            let range = CMTimeRange(start: start, end: end)
            try video.insertTimeRange(range, of: srcVideo, at: cursor)
            if let audio, let srcAudio, let mixParams {
                try audio.insertTimeRange(range, of: srcAudio, at: cursor)
                mixParams.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: CMTimeRange(start: cursor, duration: fade))
                mixParams.setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: CMTimeRange(start: cursor + range.duration - fade, duration: fade))
            }
            cursor = cursor + range.duration
        }

        var mix: AVMutableAudioMix?
        if let mixParams {
            mix = AVMutableAudioMix()
            mix?.inputParameters = [mixParams]
        }
        return EditedVideo(composition: composition, audioMix: mix)
    }

    static func export(_ edited: EditedVideo, captions: [CaptionLine]?, to url: URL) async throws {
        try? FileManager.default.removeItem(at: url)
        guard let session = AVAssetExportSession(asset: edited.composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw AutocutError.exportFailed("This device can't export this format.")
        }
        session.audioMix = edited.audioMix
        if let captions, !captions.isEmpty {
            session.videoComposition = try await captionedComposition(for: edited.composition, captions: captions)
        }
        try await session.export(to: url, as: .mp4)
    }

    // Burns the caption lines into the video with Core Animation.
    private static func captionedComposition(for composition: AVComposition, captions: [CaptionLine]) async throws -> AVMutableVideoComposition {
        let vc = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: composition)
        let size = vc.renderSize

        let parent = CALayer()
        parent.frame = CGRect(origin: .zero, size: size)
        let videoLayer = CALayer()
        videoLayer.frame = parent.frame
        parent.addSublayer(videoLayer)

        let fontSize = size.width * 0.068
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, fontSize, nil)
        let height = fontSize * 2.6
        for line in captions {
            let text = CATextLayer()
            text.string = NSAttributedString(string: line.text, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1),
                NSAttributedString.Key(kCTStrokeColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1),
                NSAttributedString.Key(kCTStrokeWidthAttributeName as String): -3.0,
            ])
            text.alignmentMode = .center
            text.isWrapped = true
            text.frame = CGRect(x: size.width * 0.08, y: size.height * 0.24, width: size.width * 0.84, height: height)
            text.opacity = 0

            let show = CABasicAnimation(keyPath: "opacity")
            show.fromValue = 1
            show.toValue = 1
            show.beginTime = AVCoreAnimationBeginTimeAtZero + line.start
            show.duration = max(0.05, line.end - line.start)
            show.isRemovedOnCompletion = true
            text.add(show, forKey: "show")
            parent.addSublayer(text)
        }

        vc.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
        return vc
    }
}
