import Foundation
import Observation

struct CutProject: Codable, Identifiable, Hashable {
    var id: UUID
    var createdAt: Date
    var title: String
    var words: [Word]
    var plan: CutPlan
}

/// Keeps each cut in Documents/Cuts/<id>/ (source.mov + project.json). Nothing leaves the phone.
@Observable @MainActor
final class ProjectStore {
    private(set) var projects: [CutProject] = []
    var settings: CutSettings { didSet { persistSettings() } }
    var burnCaptions: Bool { didSet { UserDefaults.standard.set(burnCaptions, forKey: "burnCaptions") } }

    private let root: URL
    private let fm = FileManager.default

    init() {
        root = URL.documentsDirectory.appendingPathComponent("Cuts", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        settings = UserDefaults.standard.data(forKey: "cutSettings").flatMap { try? JSONDecoder().decode(CutSettings.self, from: $0) } ?? CutSettings()
        burnCaptions = UserDefaults.standard.object(forKey: "burnCaptions") as? Bool ?? true
        load()
    }

    func folder(for id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }
    func sourceURL(for id: UUID) -> URL { folder(for: id).appendingPathComponent("source.mov") }
    func exportURL(for project: CutProject) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("Autocut-\(project.id.uuidString.prefix(8)).mp4")
    }

    /// Moves the raw take into the project folder so the edit can be re-rendered later.
    func importSource(_ raw: URL, id: UUID) throws -> URL {
        let dest = sourceURL(for: id)
        try fm.createDirectory(at: folder(for: id), withIntermediateDirectories: true)
        try? fm.removeItem(at: dest)
        do { try fm.moveItem(at: raw, to: dest) } catch { try fm.copyItem(at: raw, to: dest) }
        return dest
    }

    func save(_ project: CutProject) throws {
        let data = try JSONEncoder().encode(project)
        try data.write(to: folder(for: project.id).appendingPathComponent("project.json"), options: .atomic)
        projects.removeAll { $0.id == project.id }
        projects.insert(project, at: 0)
    }

    func delete(_ project: CutProject) {
        try? fm.removeItem(at: folder(for: project.id))
        projects.removeAll { $0.id == project.id }
    }

    private func load() {
        let dirs = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        projects = dirs
            .compactMap { try? Data(contentsOf: $0.appendingPathComponent("project.json")) }
            .compactMap { try? JSONDecoder().decode(CutProject.self, from: $0) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private func persistSettings() {
        if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data, forKey: "cutSettings") }
    }
}

func formatTime(_ t: Double) -> String {
    let s = Int(t.rounded())
    return "\(s / 60):\(String(format: "%02d", s % 60))"
}
