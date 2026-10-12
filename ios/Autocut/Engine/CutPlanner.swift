import Foundation

// Swift port of src/plan.js. Pure Foundation so it can be checked on a Mac with swiftc.

struct Word: Codable, Hashable {
    var text: String
    var start: Double
    var end: Double
}

struct KeptSegment: Codable, Hashable {
    var start: Double
    var end: Double
    var words: [Word]
    var duration: Double { end - start }
}

enum CutReason: String, Codable, Hashable {
    case deadAir = "Dead air"
    case filler = "Filler"
    case stutter = "Stutter"
    case retake = "Retake"
}

struct Cut: Codable, Hashable {
    var start: Double
    var end: Double
    var reason: CutReason
    var text: String
}

struct CutPlan: Codable, Hashable {
    var segments: [KeptSegment]
    var cuts: [Cut]
    var duration: Double
    var keptDuration: Double { segments.reduce(0) { $0 + $1.duration } }

    /// Maps a time on the edited timeline back to the source video.
    func sourceTime(forOutput t: Double) -> Double {
        var offset = 0.0
        for s in segments {
            if t < offset + s.duration { return s.start + (t - offset) }
            offset += s.duration
        }
        return segments.last?.end ?? 0
    }
}

struct CutSettings: Codable, Equatable {
    var maxGap = 0.3            // pauses longer than this between kept words become cuts
    var phraseGap = 0.45        // a pause this long also ends a phrase for retake detection
    var padIn = 0.06            // breathing room kept before a word
    var padOut = 0.12           // and after it
    var retakeLookahead = 3     // how many phrases ahead to look for a re-delivery
    var retakeSimilarity = 0.6
    var minSegment = 0.25
    var removeFillers = true
    var removeRetakes = true
}

struct AudioLevels {
    var db: [Float]
    var frameSec: Double
    var floor: Float

    static func noiseFloor(_ db: [Float]) -> Float {
        guard !db.isEmpty else { return -48 }
        let sorted = db.sorted()
        return max(sorted[Int(Double(sorted.count) * 0.1)] + 12, -48)
    }

    func isLoud(at t: Double) -> Bool {
        guard !db.isEmpty else { return false }
        let i = min(db.count - 1, max(0, Int(t / frameSec)))
        return db[i] > floor
    }
}

enum CutPlanner {
    static let fillers: Set<String> = ["um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mm", "ah", "ahh"]

    static func norm(_ t: String) -> String {
        String(t.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "'" })
    }

    static func endsSentence(_ t: String) -> Bool {
        let trimmed = t.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"')]”’"))
        guard let last = trimmed.last else { return false }
        return ".?!".contains(last)
    }

    static func splitPhrases(_ words: [Word], phraseGap: Double) -> [[Int]] {
        var phrases: [[Int]] = []
        var cur: [Int] = []
        for (i, w) in words.enumerated() {
            if !cur.isEmpty, w.start - words[i - 1].end > phraseGap {
                phrases.append(cur)
                cur = []
            }
            cur.append(i)
            if endsSentence(w.text) {
                phrases.append(cur)
                cur = []
            }
        }
        if !cur.isEmpty { phrases.append(cur) }
        return phrases
    }

    static func lcs(_ a: [String], _ b: [String]) -> Int {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        var dp = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in 1...a.count {
            for j in 1...b.count {
                dp[i][j] = a[i - 1] == b[j - 1] ? dp[i - 1][j - 1] + 1 : max(dp[i - 1][j], dp[i][j - 1])
            }
        }
        return dp[a.count][b.count]
    }

    /// How strongly does `later` look like a re-delivery of `earlier`? Compares earlier
    /// against the opening of later, so "They dry" -> "They dry super quick." scores 1.
    static func retakeScore(earlier: [String], later: [String]) -> Double {
        let a = earlier.filter { !$0.isEmpty }
        let b = later.filter { !$0.isEmpty }
        // A single word ("So.", "And") repeating is normal speech, not a retake.
        guard a.count >= 2, !b.isEmpty else { return 0 }
        let head = Array(b.prefix(a.count + 1))
        return Double(lcs(a, head)) / Double(a.count)
    }

    static func plan(words: [Word], duration: Double, settings o: CutSettings = CutSettings(), levels: AudioLevels? = nil) -> CutPlan {
        var drop: [Int: CutReason] = [:]

        if o.removeFillers {
            for (i, w) in words.enumerated() where fillers.contains(norm(w.text)) { drop[i] = .filler }
        }

        // Stutters: "the the", "I- I".
        if words.count > 1 {
            for i in 0..<(words.count - 1) {
                let a = norm(words[i].text)
                if !a.isEmpty, a == norm(words[i + 1].text), words[i + 1].start - words[i].end < 0.6 { drop[i] = .stutter }
            }
        }

        // Retakes: when a phrase is said again shortly after, keep the last delivery.
        if o.removeRetakes {
            let phrases = splitPhrases(words, phraseGap: o.phraseGap)
            let tokens = phrases.map { $0.filter { drop[$0] == nil }.map { norm(words[$0].text) } }
            for p in phrases.indices {
                let lastQ = min(phrases.count - 1, p + o.retakeLookahead)
                guard p + 1 <= lastQ else { continue }
                for q in (p + 1)...lastQ where retakeScore(earlier: tokens[p], later: tokens[q]) >= o.retakeSimilarity {
                    for i in phrases[p] where drop[i] == nil { drop[i] = .retake }
                    break
                }
            }
        }

        // Group kept words into continuous segments, splitting on long pauses or dropped words.
        struct Raw { var start: Double; var end: Double; var first: Int; var last: Int }
        var raw: [Raw] = []
        for (i, w) in words.enumerated() where drop[i] == nil {
            if var last = raw.last, w.start - last.end <= o.maxGap, i == last.last + 1 {
                last.end = w.end
                last.last = i
                raw[raw.count - 1] = last
            } else {
                raw.append(Raw(start: w.start, end: w.end, first: i, last: i))
            }
        }

        var segments: [KeptSegment] = []
        for (k, s) in raw.enumerated() {
            let prevEnd = k > 0 ? raw[k - 1].end : 0
            let nextStart = k + 1 < raw.count ? raw[k + 1].start : .infinity
            var start = max(0, s.start - o.padIn, (prevEnd + s.start) / 2)
            var end = min(s.end + o.padOut, (s.end + nextStart) / 2, duration)
            if let levels {
                // Whisper/Speech word ends are often a little early; extend while the audio is still loud.
                let maxEnd = min(s.end + o.padOut + 0.25, duration)
                while end < maxEnd, levels.isLoud(at: end) { end += levels.frameSec }
                let minStart = max(0, s.start - o.padIn - 0.15)
                while start > minStart, levels.isLoud(at: start - levels.frameSec) { start -= levels.frameSec }
            }
            guard end - start >= o.minSegment else { continue }
            let kept = (s.first...s.last).filter { drop[$0] == nil }.map { words[$0] }
            if var last = segments.last, start - last.end < 0.02 {
                last.end = max(last.end, end)
                last.words += kept
                segments[segments.count - 1] = last
            } else {
                segments.append(KeptSegment(start: start, end: end, words: kept))
            }
        }

        return CutPlan(segments: segments, cuts: describeCuts(words, drop, segments, duration), duration: duration)
    }

    private static func describeCuts(_ words: [Word], _ drop: [Int: CutReason], _ segments: [KeptSegment], _ duration: Double) -> [Cut] {
        var cuts: [Cut] = []
        var t = 0.0
        for s in segments {
            if s.start - t > 0.01 { cuts.append(cutBetween(words, drop, t, s.start)) }
            t = s.end
        }
        if duration - t > 0.01 { cuts.append(cutBetween(words, drop, t, duration)) }
        return cuts
    }

    private static func cutBetween(_ words: [Word], _ drop: [Int: CutReason], _ start: Double, _ end: Double) -> Cut {
        let inside = words.indices.filter { words[$0].start >= start - 0.05 && words[$0].end <= end + 0.05 }
        let reasons = Set(inside.compactMap { drop[$0] })
        let reason: CutReason = [.retake, .stutter, .filler].first(where: reasons.contains) ?? .deadAir
        return Cut(start: start, end: end, reason: reason, text: inside.map { words[$0].text }.joined(separator: " "))
    }
}
