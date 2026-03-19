---
description: Run maintenance on the RAG knowledge base (cleanup, dedup, expiration)
---

1. Check venv exists: `test -d "${CLAUDE_PLUGIN_DATA}/venv"`. If not, tell the user to run `/archivist:install` first and exit.
2. Run maintenance:
   ```
   "${CLAUDE_PLUGIN_DATA}/venv/bin/python" "${CLAUDE_PLUGIN_ROOT}/src/archivist.py" maintain
   ```
3. Report results.
