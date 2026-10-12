import AVFoundation

enum AutocutError: LocalizedError {
    case noAudio
    case noVideo
    case speechNotAuthorized
    case speechUnavailable
    case exportFailed(String)

    var errorDescription: String? {
        switch self {
        case .noAudio: "This video has no sound, so there's nothing to cut on."
        case .noVideo: "Couldn't read the video."
        case .speechNotAuthorized: "Autocut needs Speech Recognition to find the cuts. Turn it on in Settings › Autocut."
        case .speechUnavailable: "Speech recognition isn't available for this language right now."
        case .exportFailed(let why): "Couldn't export the video. \(why)"
        }
    }
}

enum AudioExtractor {
    static let sampleRate = 16_000.0

    /// Decodes the take's audio to 16 kHz mono floats, writes it to `wavURL` for the speech
    /// recognizer, and returns per-10 ms loudness for snapping cut points onto real silence.
    static func extract(from videoURL: URL, to wavURL: URL) async throws -> AudioLevels {
        let asset = AVURLAsset(url: videoURL)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw AutocutError.noAudio }

        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        reader.add(output)
        reader.startReading()

        var samples: [Float] = []
        while let buffer = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var chunk = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
            chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
            samples += chunk
        }
        if reader.status == .failed { throw reader.error ?? AutocutError.noAudio }
        guard !samples.isEmpty else { throw AutocutError.noAudio }

        try write(samples, to: wavURL)
        return levels(samples)
    }

    private static func write(_ samples: [Float], to url: URL) throws {
        try? FileManager.default.removeItem(at: url)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        // The file is flushed and closed when it goes out of scope, before the recognizer reads it.
        let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        try file.write(from: buffer)
    }

    private static func levels(_ samples: [Float], frameMs: Double = 10) -> AudioLevels {
        let size = Int(sampleRate * frameMs / 1000)
        var db: [Float] = []
        db.reserveCapacity(samples.count / size + 1)
        var i = 0
        while i < samples.count {
            let end = min(samples.count, i + size)
            var sum: Float = 0
            for j in i..<end { sum += samples[j] * samples[j] }
            db.append(20 * log10((sum / Float(end - i)).squareRoot() + 1e-9))
            i = end
        }
        return AudioLevels(db: db, frameSec: frameMs / 1000, floor: AudioLevels.noiseFloor(db))
    }
}
