#!/usr/bin/env python3
"""PostToolUse hook: after git push, index the commits in ChromaDB."""

import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return

    cwd = hook_input.get("cwd", os.getcwd())
    project = Path(cwd).name

    # Get recent commits that were just pushed (last 5)
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-5"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )
        if result.returncode != 0:
            return
        commits = result.stdout.strip()
    except Exception:
        return

    if not commits:
        return

    # Get branch name
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=5, cwd=cwd
        )
        branch = result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        branch = "unknown"

    # Get diff stat
    try:
        result = subprocess.run(
            ["git", "diff", "--stat", "HEAD~5..HEAD"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )
        stat = result.stdout.strip()[:500] if result.returncode == 0 else ""
    except Exception:
        stat = ""

    summary = f"Push to {branch} in {project}.\n\nCommits:\n{commits}"
    if stat:
        summary += f"\n\nChanges:\n{stat}"
    summary = summary[:2000]

    # Index via archivist.py
    archivist_path = str(Path(__file__).parent / "archivist.py")
    try:
        subprocess.run(
            [sys.executable, archivist_path, "index",
             "--content", summary,
             "--source", "git-push",
             "--topic", project],
            capture_output=True, timeout=30,
            env={**os.environ, "CLAUDE_PLUGIN_DATA": os.environ.get("CLAUDE_PLUGIN_DATA", str(Path(__file__).parent.parent / "data"))}
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
