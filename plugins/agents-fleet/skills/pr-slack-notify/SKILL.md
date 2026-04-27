---
name: pr-slack-notify
description: >
  Send a Slack PR notification using the standard Block Kit template
  (rocket header + Repo/Branche fields + summary). Preloaded in Subagent-Slack.
user-invocable: false
---

# PR Slack notification

## Inputs

| Key | Required | Default |
|-----|----------|---------|
| `pr_url` | yes | — |
| `channel_id` | no | `C0AH3SW92TD` |
| `summary` | no | derived from PR description |

## Fetch PR data

```bash
gh pr view <pr_url> --json title,number,url,headRefName,headRepository,headRepositoryOwner,body
```

Extract:
- `pr_title` ← `.title`
- `pr_url` ← `.url`
- `branch` ← `.headRefName`
- `repo` ← `.headRepositoryOwner.login + "/" + .headRepository.name`
- `pr_body` ← `.body`

## Template (Slack Block Kit)

```json
{
  "channel": "<channel_id>",
  "text": ":rocket: <pr_title>",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":rocket: *<<pr_url>|<pr_title>>*"
      }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Repo :*\n<repo>" },
        { "type": "mrkdwn", "text": "*Branche :*\n`<branch>`" }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "<summary>"
      }
    }
  ]
}
```

## Summary rules

- If caller passes `summary`, use it as-is.
- Otherwise summarize `pr_body` in 1–2 sentences in the user's language.
- Wrap technical identifiers (paths, classes, env vars, branch names) in Slack code: `` `…` ``.
- Whole message body ≤ 3 lines.

## Preconditions

- Bash is mandatory (curl + jq). If Bash is denied or `jq` is missing, ABORT immediately — do not attempt to send through any fallback. Tell the user the skill needs Bash.
- `$SLACK_BOT_TOKEN` must be set.

## Workflow

1. Fetch PR data with `gh`.
2. Build the Block Kit JSON with all fields filled.
3. Show the user the rendered preview (the JSON payload exactly as it will be POSTed).
4. Wait for explicit user confirmation. Do not send before.
5. Write the payload to `/tmp/pr-slack-notify.json` and POST in a single shell sequence that captures HTTP status, body, and parsed `ok`/`ts`/`channel`/`error` atomically:
   ```bash
   HTTP=$(curl -sS -o /tmp/slack-resp.json -w "%{http_code}" \
     -X POST https://slack.com/api/chat.postMessage \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     -H "Content-Type: application/json; charset=utf-8" \
     --data @/tmp/pr-slack-notify.json)
   OK=$(jq -r '.ok'      /tmp/slack-resp.json)
   ERR=$(jq -r '.error // ""' /tmp/slack-resp.json)
   TS=$(jq -r '.ts // ""'      /tmp/slack-resp.json)
   CH=$(jq -r '.channel // ""' /tmp/slack-resp.json)
   echo "HTTP=$HTTP OK=$OK ERR=$ERR TS=$TS CH=$CH"
   ```
6. Decide based on the captured values:
   - `HTTP=200` and `OK=true` → success, go to step 7.
   - `HTTP=200` and `OK=false` → report `ERR` and STOP. Do not retry.
   - `HTTP≠200` or `jq` failed to parse → ambiguous. The message MAY have been delivered. STOP, show the raw `/tmp/slack-resp.json` to the user, and ask them whether to retry. Never auto-retry on ambiguous outcomes.
7. Fetch the permalink (same atomic pattern):
   ```bash
   curl -sS -G https://slack.com/api/chat.getPermalink \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     --data-urlencode "channel=$CH" \
     --data-urlencode "message_ts=$TS" \
     | jq -r '.permalink // .'
   ```
8. Return the permalink.

## Why these constraints

- Slack responses can contain raw control characters in `text`/`blocks`. Strict JSON parsers crash; `jq` tolerates them. A parser crash on the response DOES NOT mean the post failed — the message is often already delivered. Auto-retrying on parse failure causes duplicates.
- HTTP code + `ok` field together are the only reliable signal. If you can't read both, treat it as ambiguous and ask.
