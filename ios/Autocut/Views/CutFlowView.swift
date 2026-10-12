import AVFoundation
import SwiftUI

/// Full-screen flow for one take: the raw video plays while cuts appear on the timeline,
/// then it swaps to the finished edit.
struct CutFlowView: View {
    @Environment(ProjectStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let job: CutJob

    var body: some View {
        Group {
            if job.stage == .ready, let project = job.project {
                ResultView(project: project, onDone: { dismiss() })
                    .transition(.opacity)
            } else {
                ProcessingView(job: job, onClose: { dismiss() })
            }
        }
        .animation(.easeInOut(duration: 0.3), value: job.stage)
        .task { await job.run(store: store) }
    }
}

struct ProcessingView: View {
    let job: CutJob
    let onClose: () -> Void
    @State private var playback = PlaybackModel(muted: true)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerView(player: playback.player).ignoresSafeArea().opacity(0.85)

            VStack {
                HStack {
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.headline).padding(12).background(.ultraThinMaterial, in: Circle())
                    }
                    .tint(.white)
                }
                Spacer()
                panel
            }
            .padding()
        }
        .onChange(of: job.sourceURL, initial: true) { _, url in
            guard let url else { return }
            playback.load(AVPlayerItem(url: url))
            playback.play()
        }
        .onDisappear { playback.pause() }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 14) {
            if case .failed(let message) = job.stage {
                Label(job.stage.label, systemImage: "exclamationmark.triangle.fill").font(.headline)
                Text(message).font(.subheadline).foregroundStyle(.white.opacity(0.8))
                Button("Try another video", action: onClose).buttonStyle(.borderedProminent)
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(.white)
                    Text(job.stage.label).font(.headline).contentTransition(.opacity)
                    Spacer()
                    if !job.revealedCuts.isEmpty {
                        Text("\(job.revealedCuts.count) cuts").font(.subheadline.monospacedDigit()).foregroundStyle(.white.opacity(0.8))
                    }
                }
                TimelineBar(duration: max(job.duration, 0.1), cuts: job.revealedCuts, playhead: playback.time)
                HStack {
                    Text(job.revealedCuts.last?.reason.rawValue ?? " ")
                    Spacer()
                    Text(formatTime(job.duration))
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.75))
            }
        }
        .foregroundStyle(.white)
        .padding(18)
        .background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}
