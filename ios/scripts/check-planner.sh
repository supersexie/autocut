#!/bin/sh
# Compiles the pure cutting logic with the Mac toolchain and runs the checks (no Xcode needed).
set -e
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/autocut-planner-checks"
swiftc -O Autocut/Engine/CutPlanner.swift Autocut/Engine/Captions.swift PlannerChecks/main.swift -o "$out"
"$out"
