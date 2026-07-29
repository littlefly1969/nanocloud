#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$repo_dir/tests/NanoCloud.Api.Tests/NanoCloud.Api.Tests.csproj"

dotnet test "$project" --filter "Category!=External" "$@"
