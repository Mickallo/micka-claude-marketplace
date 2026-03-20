#!/usr/bin/env bash
export LANG=en_US.UTF-8

input=$(cat)

# Parse JSON fields
model=$(echo "$input" | jq -r '.model.display_name // "unknown"' 2>/dev/null)
tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0' 2>/dev/null)
capacity=$(echo "$input" | jq -r '.context_window.context_window_size // 1000000' 2>/dev/null)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // empty' 2>/dev/null)

# Git branch
branch=$(git -C "$(echo "$input" | jq -r '.cwd // "."')" branch --show-current 2>/dev/null)

# Context progress bar
bar_width=10
filled=$(( tokens * bar_width / capacity ))
[ "$filled" -gt "$bar_width" ] && filled=$bar_width
empty=$(( bar_width - filled ))
bar=""
for i in $(seq 1 $filled); do bar="${bar}█"; done
for i in $(seq 1 $empty); do bar="${bar}░"; done

# Cost formatted
cost_str=""
if [ -n "$cost" ]; then
  cost_str=" | \$$(printf '%.2f' "$cost")"
fi

# Git branch
git_str=""
if [ -n "$branch" ]; then
  git_str=" | ⎇ $branch"
fi

# Service indicators — each plugin can register services in ~/.claude/statusline-services.json
# Format: [{"name": "Kanban", "check": "port:5173"}, {"name": "SlackBot", "check": "pgrep:slack_bot.py"}]
services=""
if [ -f ~/.claude/statusline-services.json ]; then
  count=$(jq -r 'length' ~/.claude/statusline-services.json 2>/dev/null)
  for i in $(seq 0 $(( count - 1 ))); do
    name=$(jq -r ".[$i].name" ~/.claude/statusline-services.json 2>/dev/null)
    check=$(jq -r ".[$i].check" ~/.claude/statusline-services.json 2>/dev/null)
    type="${check%%:*}"
    value="${check#*:}"

    running=false
    case "$type" in
      port) lsof -iTCP:"$value" -sTCP:LISTEN -t >/dev/null 2>&1 && running=true ;;
      pgrep) pgrep -f "$value" >/dev/null 2>&1 && running=true ;;
    esac

    if $running; then
      services="$services  🟢 $name"
    else
      services="$services  🔴 $name"
    fi
  done
fi

printf "%s | %s%s%s%s" "$model" "$bar" "$cost_str" "$git_str" "$services"
