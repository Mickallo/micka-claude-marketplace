#!/usr/bin/env python3
"""Stop hook: read session transcript from stdin, summarize, and index in ChromaDB."""

import json
import os
import sys
from pathlib import Path

def main():
    # Read hook input from stdin
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return

    # Skip if this is a stop-hook-triggered session (avoid loops)
    if hook_input.get("stop_hook_active"):
        return

    transcript_path = hook_input.get("transcript_path")
    if not transcript_path or not Path(transcript_path).exists():
        return

    cwd = hook_input.get("cwd", "")
    project = Path(cwd).name if cwd else "unknown"

    # Parse transcript JSONL — extract user messages and assistant messages
    messages = []
    try:
        with open(transcript_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                role = entry.get("role", "")
                if role in ("user", "assistant"):
                    content = entry.get("content", "")
                    if isinstance(content, list):
                        text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
                        content = " ".join(text_parts)
                    if content:
                        messages.append(f"{role}: {content[:200]}")
    except Exception:
        return

    if not messages:
        return

    # Build a concise summary from last messages (max 10)
    recent = messages[-10:]
    summary = f"Session in {project}. " + " | ".join(recent)
    # Truncate to reasonable size
    summary = summary[:2000]

    # Index via archivist.py
    archivist_path = str(Path(__file__).parent / "archivist.py")
    import subprocess
    try:
        subprocess.run(
            [sys.executable, archivist_path, "index",
             "--content", summary,
             "--source", "session-hook",
             "--topic", project],
            capture_output=True, timeout=30,
            env={**os.environ, "CLAUDE_PLUGIN_DATA": os.environ.get("CLAUDE_PLUGIN_DATA", str(Path(__file__).parent.parent / "data"))}
        )
    except Exception:
        pass

if __name__ == "__main__":
    main()
