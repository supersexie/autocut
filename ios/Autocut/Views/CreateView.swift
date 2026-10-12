import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct CreateView: View {
    @Environment(ProjectStore.self) private var store
    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var recordedURL: URL?
    @State private var job: CutJob?
    @State private var importing = false
    @State private var error: String?

    private let cameraAvailable = UIImagePickerController.isSourceTypeAvailable(.camera)

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 28) {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "scissors")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 64, height: 64)
                        .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: Theme.accent.opacity(0.15), radius: 12, y: 6)
                    Text("Autocut").font(.title2.bold())
                }

                card

                if let latest = store.projects.first {
                    Text("Last cut: \(formatTime(latest.plan.duration)) → \(formatTime(latest.plan.keptDuration))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 24)

            if importing {
                ProgressView("Opening video…")
                    .padding(24)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .sheet(isPresented: $showCamera, onDismiss: {
            if let url = recordedURL { recordedURL = nil; job = CutJob(rawURL: url) }
        }) {
            CameraPicker { recordedURL = $0 }.ignoresSafeArea()
        }
        .fullScreenCover(item: $job) { CutFlowView(job: $0).environment(store) }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task { await importPicked(item) }
        }
        .alert("Couldn't open that video", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    private var card: some View {
        VStack(spacing: 14) {
            Text("Make your first cut").font(.headline)
            Text("Film a take or pick one from your camera roll. Autocut trims the dead air, ums and retakes for you.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                showCamera = true
            } label: {
                Label("Record now", systemImage: "record.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!cameraAvailable)

            PhotosPicker(selection: $pickerItem, matching: .videos, preferredItemEncoding: .current) {
                Label("Import a video", systemImage: "photo.on.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)

            Text(cameraAvailable ? "Everything runs on your iPhone. Nothing is uploaded." : "No camera here. Import a video instead.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .background(.white, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 20, y: 8)
    }

    private func importPicked(_ item: PhotosPickerItem) async {
        importing = true
        defer { importing = false; pickerItem = nil }
        do {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { throw AutocutError.noVideo }
            job = CutJob(rawURL: movie.url)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A picked video copied out of the Photos sandbox into our temp folder.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")
            try FileManager.default.copyItem(at: received.file, to: dest)
            return PickedMovie(url: dest)
        }
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    var onRecord: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoQuality = .typeHigh
        picker.videoMaximumDuration = 600
        if UIImagePickerController.isCameraDeviceAvailable(.front) { picker.cameraDevice = .front }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let url = info[.mediaURL] as? URL {
                // The picker deletes its file once dismissed, so keep our own copy.
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mov")
                if (try? FileManager.default.copyItem(at: url, to: dest)) != nil { parent.onRecord(dest) }
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
