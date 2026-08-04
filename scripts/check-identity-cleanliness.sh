#!/usr/bin/env bash
# Fail when the former product name appears anywhere in tracked source.
#
# The product is NubArca. There is exactly ONE permitted textual exception:
#
#     /opt/nanocloud
#
# the production deployment checkout path, which is a live filesystem location on
# the running host and not a product identifier. It is permitted only as that
# EXACT path: a nested path below it, a suffixed variant of it, or any longer word
# built on it is rejected, because a path inside the checkout or inside an image
# is ours to name and has no reason to carry the former identity.
#
# This file never spells the former brand literally — the self-test assembles it
# from fragments — so the checker can never accidentally exempt itself.
#
# There is deliberately no allowlist file. An allowlist is how a rename stalls:
# each entry looks locally reasonable and the set never shrinks. If something
# genuinely cannot be renamed, it belongs in operator configuration outside Git,
# not in a permanent exception list.
#
#   scripts/check-identity-cleanliness.sh             # check
#   scripts/check-identity-cleanliness.sh --verbose   # also report the exception's uses
#   scripts/check-identity-cleanliness.sh --self-test # prove the checker itself works
#
# Only files tracked by git are scanned, so .git, node_modules, build output
# (bin/, obj/, dist/) and vendored dependencies are excluded by construction.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec python3 - "$@" <<'PYTHON'
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
VERBOSE = "--verbose" in sys.argv[1:]

# The former product name, in every spelling that must not come back.
OLD_BRAND = re.compile(r"nano[_-]?cloud", re.IGNORECASE)

# The single permitted exception: the production checkout path, and ONLY as that
# exact path. The lookahead rejects any continuation that would make it a
# different identifier — a nested path, a suffixed name, a longer word.
CHECKOUT_PATH = re.compile(r"/opt/nanocloud(?![A-Za-z0-9_/-])")

# Tracked paths that are generated, vendored, binary or transient. Tracked build
# output should not exist; excluding it keeps the check honest if it appears.
SKIP_DIRS = (
    "node_modules/", "/bin/", "/obj/", "/dist/", "/build/",
    "TestResults/", "graphify-out/", "/.venv/", "__pycache__/",
    "playwright-report/", "test-results/",
)
SKIP_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".pdf", ".zip", ".gz", ".tar", ".apk", ".aab", ".keystore", ".jks",
    ".onnx", ".bin", ".trx", ".so", ".dll", ".dylib", ".exe",
)


def residual(line: str) -> bool:
    """True when the line names the former brand outside the one exception."""
    return OLD_BRAND.search(CHECKOUT_PATH.sub("", line)) is not None


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


def self_test() -> int:
    """Prove the checker rejects what it must and allows only the exception.

    Runs against synthetic (path, line) pairs in memory — it never writes to the
    repository, so it is safe to run anywhere, including from a test suite.

    Every fixture ASSEMBLES the former brand from fragments instead of spelling
    it. That is not cosmetic: it is why this file needs no exemption from its own
    scan, and therefore why the exception list can stay at exactly one entry.
    """
    # The six spellings OLD_BRAND matches: lower, Pascal, upper, upper-snake,
    # lower-snake, Pascal-dash. Assembled, never written whole.
    lo = "nano" + "cloud"
    pa = "Nano" + "Cloud"
    up = "NANO" + "CLOUD"
    us = "NANO" + "_CLOUD"
    sn = "nano" + "_cloud"
    da = "Nano" + "-Cloud"
    checkout = "/opt/" + lo  # the one permitted exception

    must_reject = [
        # Source, in every casing the rename covered.
        ("src/NubArca.Api/Files/Foo.cs", f"public sealed class {pa}Thing {{ }}"),
        ("src/NubArca.Api/Files/Foo.cs", f"namespace {pa}.Api.Files;"),
        ("src/NubArca.Api/Program.cs", f'options.Cookie.Name = "{pa}.Auth";'),
        ("src/NubArca.Api/Plates/PlateContainerKey.cs",
         f'public const string Prefix = "__{lo}_plates_";'),
        ("frontend/src/brand/x.ts", f"export const NAME = '{lo}';"),
        ("frontend/src/i18n/en.ts", f"'app.name': '{pa}',"),
        ("frontend/src/settings/prefs.ts", f"const KEY = '{lo}.sidebar';"),
        ("tv/src/i18n/en.ts", f"'title': '{up} TV',"),
        ("mobile/src/App.tsx", f"const n = '{da}';"),
        ("scripts/x.py", f"root = '{sn}'"),
        # Tests.
        ("tests/NubArca.Api.Tests/Foo.cs", f'var dir = "{lo}-test-" + Guid.NewGuid();'),
        ("tests/NubArca.Api.Tests/Foo.cs", f'"at {pa}.Api.Files"'),
        # Documentation.
        ("README.md", f"{pa} is a private cloud."),
        ("ARCHITECTURE.md", f"{pa} stores blobs by SHA-256."),
        ("CHANGELOG.md", f"{pa} `0.2.0` is the consolidated public baseline."),
        ("docs/OPERATIONS.md", f"dotnet {pa}.Api.dll storage blobs audit-references"),
        ("docs/brand.md", f"The product was renamed from {pa} to NubArca."),
        # Deploy scripts and runbooks.
        ("deploy/FIRST_DEPLOY.md", f"Deploying {pa} takes about an hour."),
        ("deploy/backup.sh", f'archive="{lo}-$(date -u +%Y%m%dT%H%M%SZ)"'),
        ("deploy/publish-tv-apk.sh", f'remote_name="{lo}-tv.apk"'),
        # Configuration and environment.
        (".env.example", f"{up}_TV_OTA_CHANNEL=production"),
        (".env.example", f"{us}_ADMIN_EMAIL=admin@example.com"),
        (".env.example", f"POSTGRES_DB={lo}"),
        # Docker files and Compose.
        ("docker-compose.prod.yml", f"container_name: {lo}-postgres"),
        ("docker-compose.prod.yml", f"    name: {lo}-storage-data"),
        ("docker-compose.prod.yml", f"      - /var/lib/{lo}/storage"),
        ("docker-compose.prod.yml", f"    {lo}-internal:"),
        ("src/NubArca.Api/Dockerfile", f'ENTRYPOINT ["dotnet", "{pa}.Api.dll"]'),
        ("frontend/Dockerfile", f"COPY --from=build /app/dist /usr/share/{lo}"),
        # Package metadata.
        ("frontend/package.json", f'"name": "{lo}-frontend",'),
        ("tv/app.config.js", f"slug: '{lo}-tv',"),
        ("tv/app.config.js", f"package: 'it.littlefly.{lo}tv',"),
        ("mobile/app.json", f'"slug": "{lo}-mobile"'),
        # Hostnames and repository references.
        ("deploy/FAST_DEPLOY.md", f"public URL: https://{lo}.littlefly.it"),
        ("README.md", f"git clone https://github.com/littlefly1969/{lo}.git"),
        # The exception is EXACT. Anything built on top of it is not covered.
        ("deploy/FAST_DEPLOY.md", f"ENV LD_LIBRARY_PATH={checkout}/ort-openvino"),
        ("deploy/FAST_DEPLOY.md", f"ls {checkout}-backup"),
        ("deploy/FAST_DEPLOY.md", f"cd {checkout}x"),
        ("deploy/FAST_DEPLOY.md", f"BACKUP=/srv/{lo}/postgres"),
        # A second occurrence on an otherwise-allowed line is still a violation.
        ("deploy/FAST_DEPLOY.md", f"cd {checkout} && dotnet {pa}.Api.dll"),
    ]
    must_allow = [
        # The one exception, in the forms a runbook actually uses.
        ("deploy/FAST_DEPLOY.md", f"cd {checkout}"),
        ("deploy/FAST_DEPLOY.md", f"- checkout: `{checkout}`"),
        ("CLAUDE.md", f"Repo path: {checkout}"),
        ("docs/OPERATIONS.md", f"The deployment checkout is {checkout}."),
        ("deploy/FIRST_DEPLOY.md", f"sudo mkdir -p {checkout} && cd {checkout}"),
        # Lines that merely resemble the brand must not be flagged.
        ("README.md", "NubArca is a private cloud."),
        ("docs/OPERATIONS.md", "The nano editor is not required."),
        ("src/NubArca.Api/Program.cs", 'options.Cookie.Name = "NubArca.Auth";'),
        ("src/NubArca.Api/Plates/PlateContainerKey.cs",
         'public const string Prefix = "__nubarca_plates_";'),
    ]

    failures: list[str] = []
    for path, line in must_reject:
        if not OLD_BRAND.search(line):
            failures.append(f"fixture does not even contain the old brand: {path}: {line}")
        elif not residual(line):
            failures.append(f"should be REJECTED but the checker allows it:\n      {path}: {line}")
    for path, line in must_allow:
        if residual(line):
            failures.append(f"should be ALLOWED but the checker rejects it:\n      {path}: {line}")

    total = len(must_reject) + len(must_allow)
    if failures:
        print(f"self-test: {len(failures)} of {total} cases failed\n", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(
        f"self-test: {total}/{total} cases correct "
        f"({len(must_reject)} correctly rejected, {len(must_allow)} correctly allowed)"
    )
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    violations: list[tuple[str, int, str]] = []
    exceptions: list[tuple[str, int]] = []
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
            if residual(line):
                violations.append((path, lineno, line.strip()))
            else:
                exceptions.append((path, lineno))

    if VERBOSE:
        print(f"scanned {scanned} tracked text files")
        print(f"  {len(exceptions):>5}  /opt/nanocloud (the one permitted exception)")
        for path, lineno in exceptions:
            print(f"           {path}:{lineno}")
        print()

    if violations:
        print(
            f"{len(violations)} occurrence(s) of the former product name in tracked source:\n",
            file=sys.stderr,
        )
        for path, lineno, line in violations[:80]:
            snippet = line if len(line) <= 140 else line[:137] + "..."
            print(f"  {path}:{lineno}: {snippet}", file=sys.stderr)
        if len(violations) > 80:
            print(f"  ... and {len(violations) - 80} more", file=sys.stderr)
        print(
            "\nThe product is NubArca. Use it. The only permitted exception is the\n"
            "exact production checkout path /opt/nanocloud; an identifier that truly\n"
            "cannot be renamed belongs in operator configuration outside Git, not in\n"
            "a compatibility allowlist.",
            file=sys.stderr,
        )
        return 1

    print(
        f"identity clean: {scanned} tracked text files carry no former-brand "
        f"occurrence outside /opt/nanocloud ({len(exceptions)} permitted use(s))"
    )
    return 0


sys.exit(main())
PYTHON
