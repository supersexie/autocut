import Speech

enum Transcriber {
    static func requestAuthorization() async -> Bool {
        if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
        return await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
    }

    /// Word-level timestamps for an audio file, recognized on-device when the language supports it.
    static func transcribe(audioURL: URL, locale: Locale = .current) async throws -> [Word] {
        guard await requestAuthorization() else { throw AutocutError.speechNotAuthorized }
        guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else { throw AutocutError.speechUnavailable }

        let request = SFSpeechURLRecognitionRequest(url: audioURL)
        request.shouldReportPartialResults = false
        request.addsPunctuation = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

        return try await withCheckedThrowingContinuation { continuation in
            var finished = false
            recognizer.recognitionTask(with: request) { result, error in
                _ = recognizer // keep the recognizer alive until the task reports back
                guard !finished else { return }
                if let error {
                    finished = true
                    // 1110 = "No speech detected": an empty take, not a failure.
                    if (error as NSError).code == 1110 { continuation.resume(returning: []) }
                    else { continuation.resume(throwing: error) }
                    return
                }
                guard let result, result.isFinal else { return }
                finished = true
                continuation.resume(returning: result.bestTranscription.segments.map {
                    Word(text: $0.substring, start: $0.timestamp, end: $0.timestamp + $0.duration)
                })
            }
        }
    }
}
