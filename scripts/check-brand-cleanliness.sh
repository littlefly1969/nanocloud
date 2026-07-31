#!/usr/bin/env bash
# Fail when the former product name appears outside the compatibility allowlist.
#
# Effective 31 July 2026 the product is NubArca. Some identifiers legitimately
# keep the former name (persisted keys, container entrypoints, installed app ids,
# historical records); each is declared in config/legacy-brand-compatibility.txt
# with a reason. Anything else is a regression.
#
#   scripts/check-brand-cleanliness.sh            # check
#   scripts/check-brand-cleanliness.sh --verbose  # also summarise what was allowed
#
# Only files tracked by git are scanned, so .git, node_modules, build output
# (bin/, obj/, dist/) and vendored dependencies are excluded by construction.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec python3 - "$@" <<'PYTHON'
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
ALLOWLIST = ROOT / "config" / "legacy-brand-compatibility.txt"
VERBOSE = "--verbose" in sys.argv[1:]

# The former product name, in every spelling that must not come back.
OLD_BRAND = re.compile(r"nano[_-]?cloud", re.IGNORECASE)

# Tracked paths that are generated, vendored or binary. Tracked build output
# should not exist, but excluding it keeps the check honest if it appears.
SKIP_DIRS = ("node_modules/", "/bin/", "/obj/", "/dist/", "TestResults/", "graphify-out/")
SKIP_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".pdf", ".zip", ".gz", ".apk", ".onnx", ".bin", ".trx",
)


class Rule:
    __slots__ = ("identifier", "match", "paths", "why", "breaks", "remove_when", "hits")

    def __init__(self, fields: dict[str, str]) -> None:
        self.identifier = fields.get("identifier", "")
        self.match = re.compile(fields["match"])
        raw_paths = fields.get("paths", "").strip()
        self.paths = [p.strip() for p in raw_paths.split(",") if p.strip()] or None
        self.why = fields.get("why", "")
        self.breaks = fields.get("breaks", "")
        self.remove_when = fields.get("remove-when", "")
        self.hits = 0

    def covers(self, path: str, line: str) -> bool:
        if self.paths is not None and not any(_glob(path, p) for p in self.paths):
            return False
        return self.match.search(line) is not None


def _glob(path: str, pattern: str) -> bool:
    """fnmatch, but a trailing /** also matches the directory's whole subtree."""
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        return path == prefix or path.startswith(prefix + "/")
    # `deploy/**.md` style: treat ** as "any depth".
    return fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(path, pattern.replace("**", "*"))


REQUIRED = ("identifier", "match", "why", "breaks", "remove-when")


def load_rules() -> list[Rule]:
    if not ALLOWLIST.exists():
        sys.exit(f"missing allowlist: {ALLOWLIST.relative_to(ROOT)}")
    rules: list[Rule] = []
    fields: dict[str, str] = {}
    in_entry = False
    for lineno, raw in enumerate(ALLOWLIST.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip()
        if line.strip().startswith("#"):
            continue
        if line.strip() == "[entry]":
            if in_entry:
                rules.append(_finish(fields, lineno))
            fields, in_entry = {}, True
            continue
        if not line.strip():
            if in_entry:
                rules.append(_finish(fields, lineno))
                fields, in_entry = {}, False
            continue
        if in_entry and ":" in line:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    if in_entry:
        rules.append(_finish(fields, 0))
    return rules


def _finish(fields: dict[str, str], lineno: int) -> Rule:
    missing = [f for f in REQUIRED if not fields.get(f)]
    if missing:
        sys.exit(
            f"{ALLOWLIST.name}: entry ending near line {lineno} is missing "
            f"required field(s): {', '.join(missing)}"
        )
    return Rule(fields)


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], capture_output=True, text=True, check=True
    ).stdout
    files = []
    for path in out.split("\0"):
        if not path:
            continue
        if any(part in f"/{path}" for part in SKIP_DIRS):
            continue
        if path.endswith(SKIP_SUFFIXES):
            continue
        files.append(path)
    return files


def main() -> int:
    rules = load_rules()
    violations: list[tuple[str, int, str]] = []
    scanned = 0

    for path in tracked_files():
        try:
            text = (ROOT / path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        scanned += 1
        if not OLD_BRAND.search(text):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if not OLD_BRAND.search(line):
                continue
            covering = next((r for r in rules if r.covers(path, line)), None)
            if covering is None:
                violations.append((path, lineno, line.strip()))
            else:
                covering.hits += 1

    if VERBOSE:
        print(f"scanned {scanned} tracked text files against {len(rules)} allowlist entries\n")
        for rule in rules:
            print(f"  {rule.hits:>5}  {rule.identifier}")
        print()

    if violations:
        print(
            f"{len(violations)} occurrence(s) of the former product name are not "
            f"covered by config/legacy-brand-compatibility.txt:\n",
            file=sys.stderr,
        )
        for path, lineno, line in violations[:80]:
            snippet = line if len(line) <= 140 else line[:137] + "..."
            print(f"  {path}:{lineno}: {snippet}", file=sys.stderr)
        if len(violations) > 80:
            print(f"  ... and {len(violations) - 80} more", file=sys.stderr)
        print(
            "\nThe current product name is NubArca. Either use it, or add an entry to\n"
            "config/legacy-brand-compatibility.txt stating why this identifier must\n"
            "remain, what would break if it were renamed, and when it can go.",
            file=sys.stderr,
        )
        return 1

    print("brand clean: every remaining legacy-name occurrence is allowlisted")
    return 0


sys.exit(main())
PYTHON
