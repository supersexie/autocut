import SwiftUI

@main
struct AutocutApp: App {
    @State private var store = ProjectStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.accent)
        }
    }
}

enum Theme {
    static let accent = Color(red: 0.24, green: 0.52, blue: 0.96)
    static let cut = Color(red: 0.98, green: 0.36, blue: 0.36)
    static let background = LinearGradient(
        colors: [Color(red: 0.93, green: 0.96, blue: 1.0), Color(red: 0.97, green: 0.98, blue: 1.0)],
        startPoint: .top, endPoint: .bottom
    )
}

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Create", systemImage: "camera.fill") { CreateView() }
            Tab("Cuts", systemImage: "film.stack") { CutsView() }
            Tab("You", systemImage: "person.fill") { SettingsView() }
        }
    }
}
