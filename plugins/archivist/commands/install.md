---
description: Install Python dependencies for the Archivist
---

1. Check Python 3 is available: `python3 --version`
2. Create a virtualenv if it doesn't exist:
   ```
   python3 -m venv "${CLAUDE_PLUGIN_DATA}/venv"
   ```
3. Install dependencies:
   ```
   "${CLAUDE_PLUGIN_DATA}/venv/bin/pip" install -r "${CLAUDE_PLUGIN_ROOT}/src/requirements.txt"
   ```
4. Report installed packages: `"${CLAUDE_PLUGIN_DATA}/venv/bin/pip" list`
