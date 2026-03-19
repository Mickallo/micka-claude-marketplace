---
description: Search the RAG knowledge base
---

1. Check venv exists: `test -d "${CLAUDE_PLUGIN_DATA}/venv"`. If not, tell the user to run `/archivist:install` first and exit.
2. Run search with user's query from `$ARGUMENTS`:
   ```
   "${CLAUDE_PLUGIN_DATA}/venv/bin/python" "${CLAUDE_PLUGIN_ROOT}/src/archivist.py" search "$ARGUMENTS"
   ```
3. Display results.
