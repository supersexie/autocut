import Foundation

struct CaptionLine: Hashable {
    var text: String
    var start: Double
    var end: Double
}

// Short, punchy caption lines (UGC style) on the *edited* timeline.
enum Captions {
    static func lines(for plan: CutPlan, maxWords: Int = 4, maxChars: Int = 22) -> [CaptionLine] {
        var words: [Word] = []
        var offset = 0.0
        for s in plan.segments {
            for w in s.words {
                words.append(Word(text: w.text, start: offset + max(0, w.start - s.start), end: offset + min(s.end, w.end) - s.start))
            }
            offset += s.duration
        }

        var groups: [[Word]] = []
        var cur: [Word] = []
        for w in words {
            let text = (cur + [w]).map(\.text).joined(separator: " ")
            if !cur.isEmpty, cur.count >= maxWords || text.count > maxChars {
                groups.append(cur)
                cur = []
            }
            cur.append(w)
            if let last = w.text.last, ".?!,".contains(last) {
                groups.append(cur)
                cur = []
            }
        }
        if !cur.isEmpty { groups.append(cur) }

        return groups.enumerated().map { i, g in
            let natural = g.last!.end + 0.3
            let end = i + 1 < groups.count ? min(natural, groups[i + 1].first!.start) : natural
            return CaptionLine(text: g.map(\.text).joined(separator: " "), start: g.first!.start, end: end)
        }
    }

    static func line(at t: Double, in lines: [CaptionLine]) -> CaptionLine? {
        lines.first { t >= $0.start && t < $0.end }
    }
}
