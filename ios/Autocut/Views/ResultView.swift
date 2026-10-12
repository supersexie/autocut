import AVFoundation
import Photos
import SwiftUI

struct ResultView: View {
    @Environment(ProjectStore.self) private var store
    let project: CutProject
    var onDone: (() -> Void)?

    @State private var playback = PlaybackModel()
    @State private var edited: EditedVideo?
    @State private var exporting = false
    @State private var shareURL: URL?
    @State private var showCuts = false
    @State private var toast: String?

    private var plan: CutPlan { project.plan }
    private var captions: [CaptionLine] { Captions.lines(for: plan) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerView(player: playback.player)
                .ignoresSafeArea()
                .onTapGesture { playback.toggle() }
            if store.burnCaptions {
                CaptionOverlay(line: Captions.line(at: playback.time, in: captions)).ignoresSafeArea()
            }
            if !playback.isPlaying && edited != nil {
                Image(systemName: "play.fill").font(.system(size: 54)).foregroundStyle(.white.opacity(0.9)).allowsHitTesting(false)
            }

            VStack {
                HStack {
                    Button { playback.isMuted.toggle() } label: {
                        Image(systemName: playback.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .font(.subheadline).padding(12).background(.ultraThinMaterial, in: Circle())
                    }
                    Spacer()
                    if let toast {
                        Text(toast).font(.subheadline.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    Spacer()
                    if let onDone {
                        Button(action: onDone) {
                            Image(systemName: "xmark").font(.headline).padding(12).background(.ultraThinMaterial, in: Circle())
                        }
                    }
                }
                .tint(.white)
                Spacer()
                panel
            }
            .padding()
        }
        .environment(\.colorScheme, .dark)
        .toolbar(.hidden, for: .tabBar)
        .task {
            do {
                let video = try await CutComposer.compose(source: store.sourceURL(for: project.id), plan: plan)
                edited = video
                playback.load(video.playerItem())
                playback.play()
            } catch {
                show(error.localizedDescription)
            }
        }
        .onDisappear { playback.pause() }
        .sheet(item: $shareURL) { ShareSheet(url: $0).presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showCuts) { CutListView(plan: plan).presentationDetents([.medium, .large]) }
    }

    private var panel: some View {
        VStack(spacing: 14) {
            HStack {
                Label("Cut ready", systemImage: "checkmark.circle.fill").font(.subheadline.weight(.semibold))
                Spacer()
                Button { showCuts = true } label: {
                    HStack(spacing: 6) {
                        Text(formatTime(plan.duration)).strikethrough().foregroundStyle(.white.opacity(0.6))
                        Image(systemName: "arrow.right").font(.caption2)
                        Text(formatTime(plan.keptDuration)).foregroundStyle(Theme.accent)
                    }
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                }
            }
            TimelineBar(duration: plan.duration, segments: plan.segments, cuts: plan.cuts, playhead: plan.sourceTime(forOutput: playback.time))
            HStack(spacing: 12) {
                Button { Task { await saveToPhotos() } } label: {
                    Label("Save", systemImage: "arrow.down.to.line").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button { Task { await share() } } label: {
                    Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
            .disabled(edited == nil || exporting)
            .overlay { if exporting { ProgressView().tint(.white) } }
        }
        .foregroundStyle(.white)
        .padding(18)
        .background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func exportVideo() async throws -> URL {
        guard let edited else { throw AutocutError.noVideo }
        exporting = true
        defer { exporting = false }
        let url = store.exportURL(for: project)
        try await CutComposer.export(edited, captions: store.burnCaptions ? captions : nil, to: url)
        return url
    }

    private func saveToPhotos() async {
        do {
            guard await PHPhotoLibrary.requestAuthorization(for: .addOnly) == .authorized else {
                return show("Allow Photos access in Settings to save")
            }
            let url = try await exportVideo()
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
            }
            show("Saved to Photos")
        } catch {
            show(error.localizedDescription)
        }
    }

    private func share() async {
        do { shareURL = try await exportVideo() } catch { show(error.localizedDescription) }
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            withAnimation { if toast == message { toast = nil } }
        }
    }
}

/// Every cut Autocut made and why, so nothing feels like a black box.
struct CutListView: View {
    let plan: CutPlan

    var body: some View {
        NavigationStack {
            List(plan.cuts, id: \.self) { cut in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(cut.reason.rawValue).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.cut)
                        Spacer()
                        Text("\(String(format: "%.1f", cut.start))s · \(String(format: "%.1f", cut.end - cut.start))s")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    if !cut.text.isEmpty { Text("“\(cut.text)”").font(.subheadline).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("\(plan.cuts.count) cuts")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
