#!/usr/bin/env python3
"""Slack bot that answers questions using Claude Code as subprocess."""

import json
import logging
import os
import subprocess
import threading
import time

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = App(token=os.environ["SLACK_BOT_TOKEN"])

BOT_USER_ID = None

JSON_SCHEMA = json.dumps({
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
})

TOOL_LABELS = {
    "Bash": ":computer: Exécution d'une commande...",
    "Read": ":mag: Lecture d'un fichier...",
    "Grep": ":mag: Recherche dans le code...",
    "Glob": ":file_folder: Recherche de fichiers...",
    "WebSearch": ":globe_with_meridians: Recherche web...",
    "WebFetch": ":globe_with_meridians: Récupération d'une page...",
    "Agent": ":robot_face: Délégation à un sous-agent...",
}


def get_tool_label(tool_name: str, tool_input: dict | None = None) -> str | None:
    """Get a human-readable label for a tool call with context details."""
    if not tool_name:
        return None
    inp = tool_input or {}

    # MCP tools
    if "slack" in tool_name.lower():
        query = inp.get("query", "")
        channel = inp.get("channel_name", "")
        if query:
            return f":speech_balloon: Recherche dans Slack... `{query}`"
        if channel:
            return f":speech_balloon: Lecture du channel `#{channel}`..."
        return ":speech_balloon: Recherche dans Slack..."

    if "linear" in tool_name.lower():
        query = inp.get("query", inp.get("title", ""))
        if query:
            return f":chart_with_upwards_trend: Recherche dans Linear... `{query}`"
        return ":chart_with_upwards_trend: Recherche dans Linear..."

    if "notion" in tool_name.lower():
        query = inp.get("query", inp.get("title", ""))
        if query:
            return f":notebook: Recherche dans Notion... `{query}`"
        return ":notebook: Recherche dans Notion..."

    # Built-in tools
    if tool_name == "Bash":
        cmd = inp.get("command", "")
        if "archivist.py" in cmd:
            if "search" in cmd:
                return ":brain: Recherche dans la base de connaissances..."
            if "index" in cmd:
                return ":brain: Mémorisation dans la base de connaissances..."
            if "maintain" in cmd:
                return ":brain: Maintenance de la base de connaissances..."
        display = cmd[:80] + "..." if len(cmd) > 80 else cmd
        return f":computer: `{display}`"

    if tool_name == "Read":
        path = inp.get("file_path", "")
        filename = path.split("/")[-1] if path else ""
        if filename:
            return f":mag: Lecture de `{filename}`"
        return ":mag: Lecture d'un fichier..."

    if tool_name == "Grep":
        pattern = inp.get("pattern", "")
        if pattern:
            return f":mag: Recherche de `{pattern}`"
        return ":mag: Recherche dans le code..."

    if tool_name == "Glob":
        pattern = inp.get("pattern", "")
        filename = pattern.split("/")[-1] if pattern else pattern
        if filename:
            return f":file_folder: Recherche de `{filename}`"
        return ":file_folder: Recherche de fichiers..."

    if tool_name == "WebSearch":
        query = inp.get("query", "")
        if query:
            return f":globe_with_meridians: Recherche web... `{query}`"
        return ":globe_with_meridians: Recherche web..."

    if tool_name == "WebFetch":
        url = inp.get("url", "")
        if url:
            short_url = url[:60] + "..." if len(url) > 60 else url
            return f":globe_with_meridians: Récupération de `{short_url}`..."
        return ":globe_with_meridians: Récupération d'une page..."

    if tool_name == "Agent":
        return None  # Handled separately in the caller

    return TOOL_LABELS.get(tool_name)


def update_status(channel: str, ts: str, text: str):
    """Update the status message with current step."""
    try:
        app.client.chat_update(channel=channel, ts=ts, text=text)
    except Exception as e:
        logger.warning(f"Failed to update status: {e}")


def get_bot_user_id():
    global BOT_USER_ID
    if BOT_USER_ID is None:
        resp = app.client.auth_test()
        BOT_USER_ID = resp["user_id"]
    return BOT_USER_ID


def get_thread_context(channel: str, thread_ts: str) -> list[dict]:
    """Fetch previous messages in a thread for conversation context."""
    try:
        result = app.client.conversations_replies(channel=channel, ts=thread_ts, limit=20)
        messages = []
        bot_id = get_bot_user_id()
        for msg in result.get("messages", []):
            role = "assistant" if msg.get("user") == bot_id else "user"
            messages.append({"role": role, "text": msg.get("text", "")})
        return messages
    except Exception as e:
        logger.warning(f"Failed to fetch thread context: {e}")
        return []


def build_prompt(question: str, thread_context: list[dict] | None = None) -> str:
    """Build the prompt sent to Claude Code."""
    parts = []

    parts.append(
        "You are a Slack bot answering questions. "
        "Search for relevant information using available tools in this priority order: "
        "1) Archivist RAG (local knowledge base), "
        "2) Slack (message history), "
        "3) Linear (issues, projects), "
        "4) Notion (docs, specs), "
        "5) Git (code, PRs). "
        "Always cite your sources. "
        "Respond in the same language as the question. "
        "Format your answer for Slack mrkdwn syntax ONLY. Rules: "
        "- Use *bold* not **bold**. "
        "- Use _italic_ not *italic*. "
        "- Use `code` for inline code. "
        "- Use ```code blocks``` for multi-line code. "
        "- Use bullet lists with • or -. "
        "- NO markdown tables (| --- |), use bullet lists instead. "
        "- NO ## headers, use *Bold Title* on its own line instead. "
        "- NO images or links with ![](). "
        "- Use > for blockquotes. "
        "- Use ~strikethrough~ for strikethrough."
    )

    if thread_context and len(thread_context) > 1:
        parts.append("\n--- Thread context ---")
        for msg in thread_context[:-1]:  # exclude last (current question)
            prefix = "Bot" if msg["role"] == "assistant" else "User"
            parts.append(f"{prefix}: {msg['text']}")
        parts.append("--- End thread context ---\n")

    parts.append(f"Question: {question}")

    parts.append(
        "\nDo NOT index anything in the Archivist. Just answer the question."
    )

    return "\n".join(parts)


def call_claude_streaming(prompt: str, channel: str, status_ts: str) -> str:
    """Call Claude Code CLI as subprocess with streaming progress updates."""
    current_step = ":hourglass_flowing_sand: Réflexion en cours..."
    update_status(channel, status_ts, current_step)

    try:
        proc = subprocess.Popen(
            [
                "claude",
                "--print",
                "--dangerously-skip-permissions",
                "--output-format", "stream-json",
                "--verbose",
                "--json-schema", JSON_SCHEMA,
                prompt,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        final_result = ""
        timeout_sec = 300

        last_activity = time.monotonic()

        for line in proc.stdout:
            last_activity = time.monotonic()
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            event_type = event.get("type")

            # Detect tool use and text in assistant messages
            if event_type == "assistant":
                message = event.get("message", {})
                for block in message.get("content", []):
                    if block.get("type") == "tool_use":
                        tool_name = block.get("name", "")
                        tool_input = block.get("input", {})
                        label = get_tool_label(tool_name, tool_input)

                        # Special case: Agent sub-agent delegation
                        if tool_name == "Agent":
                            agent_type = tool_input.get("subagent_type", "")
                            agent_desc = tool_input.get("description", "")
                            if "archivist" in agent_type.lower():
                                label = ":brain: Mémorisation dans la base de connaissances..."
                            elif "slack" in agent_type.lower():
                                label = f":speech_balloon: Sous-agent Slack... `{agent_desc}`" if agent_desc else ":speech_balloon: Recherche dans Slack..."
                            elif "linear" in agent_type.lower():
                                label = f":chart_with_upwards_trend: Sous-agent Linear... `{agent_desc}`" if agent_desc else ":chart_with_upwards_trend: Recherche dans Linear..."
                            elif "notion" in agent_type.lower():
                                label = f":notebook: Sous-agent Notion... `{agent_desc}`" if agent_desc else ":notebook: Recherche dans Notion..."
                            elif "git" in agent_type.lower():
                                label = f":file_folder: Sous-agent Git... `{agent_desc}`" if agent_desc else ":file_folder: Recherche dans Git..."
                            else:
                                label = f":robot_face: `{agent_desc}`" if agent_desc else ":robot_face: Délégation à un sous-agent..."

                        if label:
                            update_status(channel, status_ts, label)

            # Capture final result from structured_output
            if event_type == "result":
                structured = event.get("structured_output")
                if structured and isinstance(structured, dict):
                    final_result = structured.get("answer", "")
                if not final_result:
                    final_result = event.get("result", "")

            # Check timeout since last activity
            if time.monotonic() - last_activity > timeout_sec:
                proc.kill()
                return "Désolé, la recherche a pris trop de temps. Réessaie avec une question plus précise."

        proc.wait(timeout=30)

        if final_result:
            return final_result

        if proc.returncode != 0:
            stderr = proc.stderr.read()
            logger.error(f"Claude CLI error: {stderr}")
            return f"Désolé, une erreur est survenue: {stderr[:200]}"

        return final_result

    except subprocess.TimeoutExpired:
        proc.kill()
        return "Désolé, la recherche a pris trop de temps. Réessaie avec une question plus précise."
    except FileNotFoundError:
        return "Erreur: la commande `claude` n'est pas disponible."


def index_in_archivist(question: str, answer: str):
    """Index a Q&A interaction by delegating to the Archivist agent via Claude."""
    try:
        prompt = (
            f"Index this interaction in the Archivist knowledge base.\n\n"
            f"Question: {question}\n\n"
            f"Answer: {answer[:2000]}\n\n"
            f"Summarize and index with source 'slack-bot'."
        )
        subprocess.run(
            [
                "claude", "--print", "--dangerously-skip-permissions",
                prompt,
            ],
            capture_output=True, text=True, timeout=120,
        )
        logger.info(f"Indexed interaction: {question[:50]}...")
    except Exception as e:
        logger.warning(f"Failed to index in archivist: {e}")



def handle_question(question: str, channel: str, thread_ts: str, event_ts: str):
    """Process a question in a background thread."""
    # Send status message
    status_ts = None
    try:
        ack = app.client.chat_postMessage(
            channel=channel,
            thread_ts=thread_ts,
            text=":hourglass_flowing_sand: Bien reçu, un instant...",
        )
        status_ts = ack["ts"]
    except Exception:
        pass

    # Get thread context if in a thread
    thread_context = None
    if thread_ts != event_ts:
        thread_context = get_thread_context(channel, thread_ts)

    prompt = build_prompt(question, thread_context)

    if status_ts:
        response = call_claude_streaming(prompt, channel, status_ts)
    else:
        # Fallback if we couldn't post status message
        try:
            result = subprocess.run(
                ["claude", "--print", "--dangerously-skip-permissions",
                 "--output-format", "json", "--json-schema", JSON_SCHEMA, prompt],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                try:
                    data = json.loads(result.stdout)
                    response = data.get("structured_output", {}).get("answer", data.get("result", result.stdout.strip()))
                except json.JSONDecodeError:
                    response = result.stdout.strip()
            else:
                response = f"Erreur: {result.stderr[:200]}"
        except Exception as e:
            response = f"Erreur: {e}"

    # Delete status message
    if status_ts:
        try:
            app.client.chat_delete(channel=channel, ts=status_ts)
        except Exception:
            pass

    # Post response in thread
    try:
        app.client.chat_postMessage(
            channel=channel,
            thread_ts=thread_ts,
            text=response,
        )
    except Exception as e:
        logger.error(f"Failed to post response: {e}")

    # Index in Archivist asynchronously (fire and forget)
    if response and not response.startswith("Désolé") and not response.startswith("Erreur"):
        threading.Thread(
            target=index_in_archivist,
            args=(question, response),
            daemon=True,
        ).start()


@app.event("app_mention")
def handle_mention(event, say):
    """Handle @bot mentions in channels."""
    text = event.get("text", "")
    bot_id = get_bot_user_id()
    question = text.replace(f"<@{bot_id}>", "").strip()

    if not question:
        say(text="Pose-moi une question !", thread_ts=event.get("ts"))
        return

    channel = event["channel"]
    event_ts = event["ts"]
    thread_ts = event.get("thread_ts", event_ts)

    thread = threading.Thread(
        target=handle_question,
        args=(question, channel, thread_ts, event_ts),
        daemon=True,
    )
    thread.start()


@app.event("message")
def handle_dm(event, say):
    """Handle direct messages."""
    if event.get("bot_id") or event.get("subtype"):
        return

    channel_type = event.get("channel_type", "")
    if channel_type != "im":
        return

    question = event.get("text", "").strip()
    if not question:
        return

    channel = event["channel"]
    event_ts = event["ts"]
    thread_ts = event.get("thread_ts", event_ts)

    thread = threading.Thread(
        target=handle_question,
        args=(question, channel, thread_ts, event_ts),
        daemon=True,
    )
    thread.start()


def cleanup_archivist():
    """Run archivist maintenance on startup by delegating to Claude."""
    try:
        result = subprocess.run(
            [
                "claude", "--print", "--dangerously-skip-permissions",
                "Run maintenance on the Archivist knowledge base. Clean expired and duplicate entries.",
            ],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            logger.info(f"Archivist cleanup: done")
        else:
            logger.warning(f"Archivist cleanup failed: {result.stderr[:200]}")
    except Exception as e:
        logger.warning(f"Archivist cleanup error: {e}")


def main():
    logger.info("Starting Slack bot...")
    cleanup_archivist()
    handler = SocketModeHandler(app, os.environ["SLACK_BOT_SOCKET_MODE_TOKEN"])
    handler.start()


if __name__ == "__main__":
    main()
