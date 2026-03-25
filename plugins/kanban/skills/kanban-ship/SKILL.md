---
name: kanban-ship
description: "Push branch and create PR from a kanban task"
---

## Procedure

### `/kanban-ship <ID>`

1. Fetch the task:
   ```bash
   curl -s http://localhost:5173/api/task/$ID
   ```
   Parse: `title`, `description`, `blocks`.

2. Read the blocks to find the repository and the branch. Navigate to the repository.

3. Push the branch:
   ```bash
   git push -u origin <branch>
   ```

4. Generate PR title from the task title. Generate PR body from the blocks — summarize what was done, the tests written, and the review scores.

5. Create the PR:
   ```bash
   gh pr create --title "<title>" --body "<body>"
   ```

6. Record the PR URL as a note on the task:
   ```bash
   curl -s -X POST http://localhost:5173/api/task/$ID/note \
     -H 'Content-Type: application/json' \
     -d '{"text": "PR: <URL>", "author": "kanban-ship"}'
   ```
