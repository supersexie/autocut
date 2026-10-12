import Foundation

// Runs on a Mac without Xcode: ios/scripts/check-planner.sh
// Mirrors tests/plan.test.js so the Swift port stays in step with the Node engine.

var failures = 0
func check(_ cond: Bool, _ name: String) {
    print(cond ? "✔ \(name)" : "✖ \(name)")
    if !cond { failures += 1 }
}

func W(_ items: String...) -> [Word] {
    items.map {
        let p = $0.split(separator: "@")
        let t = Double(p[1])!
        return Word(text: String(p[0]), start: t, end: t + 0.3)
    }
}
func kept(_ plan: CutPlan) -> String { plan.segments.flatMap(\.words).map(\.text).joined(separator: " ") }

do {
    let plan = CutPlanner.plan(words: W("These@0", "are@0.3", "so.@0.6", "These@2", "are@2.3", "so@2.6", "comfy.@2.9", "Buy@3.3", "them.@3.6"), duration: 4)
    check(kept(plan) == "These are so comfy. Buy them.", "keeps the last delivery of a retaken line")
    check(plan.cuts.first?.reason == .retake, "labels the retake cut")
}
do {
    let plan = CutPlanner.plan(words: W("Hello.@0", "Bye.@3"), duration: 3.3)
    check(plan.segments.count == 2, "cuts dead air between sentences")
    check(plan.cuts.contains { $0.reason == .deadAir && $0.start > 0.3 && $0.end < 3 }, "dead air cut sits in the gap")
}
do {
    let words = W("I@0", "I@0.3", "love@0.6", "um@0.9", "this@1.2", "shirt.@1.5")
    check(kept(CutPlanner.plan(words: words, duration: 1.8)) == "I love this shirt.", "removes fillers and stutters")
    var s = CutSettings(); s.removeFillers = false
    check(kept(CutPlanner.plan(words: words, duration: 1.8, settings: s)) == "I love um this shirt.", "keeps fillers when asked")
}
do {
    check(CutPlanner.retakeScore(earlier: ["it", "fits", "great"], later: ["the", "color", "is", "nice"]) < 0.6, "different lines are not retakes")
    check(CutPlanner.retakeScore(earlier: ["they", "dry"], later: ["they", "dry", "super", "quick"]) == 1, "partial line restarted is a retake")
    check(CutPlanner.retakeScore(earlier: ["so"], later: ["so", "anyway"]) == 0, "one repeated word is not a retake")
}
do {
    let plan = CutPlanner.plan(words: W("Hello.@0", "Bye.@3"), duration: 3.3)
    let lines = Captions.lines(for: plan)
    check(lines.count == 2 && lines[1].start < 1.5, "captions are remapped onto the edited timeline")
    check(abs(plan.sourceTime(forOutput: plan.segments[0].duration + 0.1) - (plan.segments[1].start + 0.1)) < 1e-9, "output time maps back to source")
}

print(failures == 0 ? "\nall passed" : "\n\(failures) failed")
exit(failures == 0 ? 0 : 1)
