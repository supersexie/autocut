import ExpoModulesCore

/// The app's way in: exportVideo(json) renders the edit described by the JSON (ExportSpec) and
/// resolves with the output file's URI, sending onProgress { progress } as it goes.
public final class AutocutExportModule: Module {
  private var current: EditExporter?

  public func definition() -> ModuleDefinition {
    Name("AutocutExport")
    Events("onProgress")

    AsyncFunction("exportVideo") { (json: String, promise: Promise) in
      let spec: ExportSpec
      do {
        spec = try JSONDecoder().decode(ExportSpec.self, from: Data(json.utf8))
      } catch {
        promise.reject("ERR_EXPORT_SPEC", "Couldn't read the edit: \(error.localizedDescription)")
        return
      }
      let exporter = EditExporter()
      self.current = exporter
      Task {
        do {
          let url = try await exporter.run(spec) { [weak self] p in
            self?.sendEvent("onProgress", ["progress": p])
          }
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ERR_EXPORT", error.localizedDescription)
        }
        if self.current === exporter { self.current = nil }
      }
    }

    Function("cancel") {
      self.current?.cancel()
    }
  }
}
