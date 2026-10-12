import AVFoundation
import SwiftUI

struct CutsView: View {
    @Environment(ProjectStore.self) private var store

    var body: some View {
        NavigationStack {
            Group {
                if store.projects.isEmpty {
                    ContentUnavailableView("No cuts yet", systemImage: "film.stack", description: Text("Your finished cuts will show up here."))
                } else {
                    List {
                        ForEach(store.projects) { project in
                            NavigationLink(value: project) { CutRow(project: project) }
                        }
                        .onDelete { offsets in offsets.map { store.projects[$0] }.forEach(store.delete) }
                    }
                }
            }
            .navigationTitle("Cuts")
            .navigationDestination(for: CutProject.self) { ResultView(project: $0).navigationBarBackButtonHidden(false) }
        }
    }
}

private struct CutRow: View {
    @Environment(ProjectStore.self) private var store
    let project: CutProject
    @State private var thumbnail: CGImage?

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.15))
                if let thumbnail { Image(decorative: thumbnail, scale: 1).resizable().scaledToFill() }
            }
            .frame(width: 54, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 4) {
                Text(project.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text("\(formatTime(project.plan.duration)) → \(formatTime(project.plan.keptDuration)) · \(project.plan.cuts.count) cuts")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Text(project.createdAt, style: .relative).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .task {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: store.sourceURL(for: project.id)))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 200, height: 200)
            let start = project.plan.segments.first?.start ?? 0
            thumbnail = try? await generator.image(at: CMTime(seconds: start + 0.3, preferredTimescale: 600)).image
        }
    }
}

struct SettingsView: View {
    @Environment(ProjectStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading) {
                        HStack {
                            Text("Longest pause to keep")
                            Spacer()
                            Text(String(format: "%.2fs", store.settings.maxGap)).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Slider(value: $store.settings.maxGap, in: 0.15...0.8, step: 0.05)
                    }
                    Toggle("Remove ums and uhs", isOn: $store.settings.removeFillers)
                    Toggle("Remove retakes", isOn: $store.settings.removeRetakes)
                } header: {
                    Text("Cutting")
                } footer: {
                    Text("Lower pause = snappier edit. With retakes on, when you say a line again Autocut keeps your last take. Applies to new cuts.")
                }

                Section("Captions") {
                    Toggle("Burn captions into exports", isOn: $store.burnCaptions)
                }

                Section {
                    LabeledContent("Cuts made", value: "\(store.projects.count)")
                    LabeledContent("Time saved", value: formatTime(store.projects.reduce(0) { $0 + $1.plan.duration - $1.plan.keptDuration }))
                } footer: {
                    Text("Everything is processed on this iPhone. Nothing is uploaded.")
                }
            }
            .navigationTitle("You")
        }
    }
}
