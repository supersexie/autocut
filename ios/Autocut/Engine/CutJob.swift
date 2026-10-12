import AVFoundation
import Observation

/// Runs one raw take through the pipeline: read audio → transcribe → plan cuts → save.
@Observable @MainActor
final class CutJob: Identifiable {
    enum Stage: Equatable {
        case reading, listening, cutting, ready
        case failed(String)

        var label: String {
            switch self {
            case .reading: "Reading the take"
            case .listening: "Listening for every word"
            case .cutting: "Finding dead air and retakes"
            case .ready: "Cut ready"
            case .failed: "Couldn't cut this one"
            }
        }
    }

    let id = UUID()
    let rawURL: URL
    var sourceURL: URL?
    var stage: Stage = .reading
    var duration: Double = 0
    /// Cuts revealed one by one so the timeline animates while the plan lands.
    var revealedCuts: [Cut] = []
    var project: CutProject?

    init(rawURL: URL) { self.rawURL = rawURL }

    @ObservationIgnored private var started = false

    func run(store: ProjectStore) async {
        guard !started else { return }
        started = true
        do {
            let source = try store.importSource(rawURL, id: id)
            sourceURL = source
            duration = try await AVURLAsset(url: source).load(.duration).seconds

            stage = .reading
            let wav = FileManager.default.temporaryDirectory.appendingPathComponent("\(id).caf")
            defer { try? FileManager.default.removeItem(at: wav) }
            let levels = try await Task.detached { try await AudioExtractor.extract(from: source, to: wav) }.value

            stage = .listening
            let words = try await Transcriber.transcribe(audioURL: wav)

            stage = .cutting
            let settings = store.settings
            let duration = self.duration
            let plan = await Task.detached { CutPlanner.plan(words: words, duration: duration, settings: settings, levels: levels) }.value

            let step = min(0.18, 1.6 / Double(max(1, plan.cuts.count)))
            for cut in plan.cuts {
                revealedCuts.append(cut)
                try? await Task.sleep(for: .seconds(step))
            }

            let project = CutProject(id: id, createdAt: .now, title: Self.title(from: words), words: words, plan: plan)
            try store.save(project)
            self.project = project
            stage = .ready
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    private static func title(from words: [Word]) -> String {
        let text = words.prefix(6).map(\.text).joined(separator: " ")
        return text.isEmpty ? "Untitled take" : text
    }
}
