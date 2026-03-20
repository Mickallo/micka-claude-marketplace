#!/usr/bin/env python3
"""Slack bot that answers questions using Anthropic API + Archivist RAG."""

import json
import logging
import os
import subprocess
import threading
from pathlib import Path

import anthropic
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = App(token=os.environ["SLACK_BOT_TOKEN"])
client = anthropic.Anthropic()

BOT_USER_ID = None
MODEL = "claude-haiku-4-5-20251001"

# Archivist paths — resolve at import time
ARCHIVIST_PYTHON = None
ARCHIVIST_SCRIPT = None

for p in [
    Path.home() / ".claude/plugins/data/archivist-micka-claude-marketplace/venv/bin/python",
    Path(os.environ.get("CLAUDE_PLUGIN_DATA", "/nonexistent")).parent
    / ("archivist-" + os.environ.get("CLAUDE_MARKETPLACE_ID", "micka-claude-marketplace"))
    / "venv/bin/python",
]:
    if p.exists():
        ARCHIVIST_PYTHON = str(p)
        break

for p in [
    Path.home() / ".claude/plugins/cache/micka-claude-marketplace/archivist/1.0.0/src/archivist.py",
    Path(__file__).parent.parent.parent / "archivist/src/archivist.py",
]:
    if p.exists():
        ARCHIVIST_SCRIPT = str(p)
        break

SYSTEM_PROMPT = (
    "You are a Slack bot answering questions. "
    "Use the archivist_search tool to search the knowledge base for relevant information. "
    "If the answer is not in the knowledge base, say so honestly. "
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

TOOLS = [
    {
        "name": "archivist_search",
        "description": "Search the Archivist RAG knowledge base for relevant information. Returns matching documents with metadata (source, topic, date).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant knowledge base entries",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5)",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    }
]


def archivist_search(query: str, top_k: int = 5) -> str:
    """Execute archivist search via CLI."""
    if not ARCHIVIST_PYTHON or not ARCHIVIST_SCRIPT:
        return "Archivist not configured. Paths not found."
    try:
        result = subprocess.run(
            [ARCHIVIST_PYTHON, ARCHIVIST_SCRIPT, "search", query, "--top-k", str(top_k)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return result.stdout.strip() or "No results found."
        return f"Search error: {result.stderr[:200]}"
    except Exception as e:
        return f"Search error: {e}"


def update_status(channel: str, ts: str, text: str):
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
    try:
        result = app.client.conversations_replies(channel=channel, ts=thread_ts, limit=20)
        messages = []
        bot_id = get_bot_user_id()
        for msg in result.get("messages", []):
            role = "assistant" if msg.get("user") == bot_id else "user"
            messages.append({"role": role, "content": msg.get("text", "")})
        return messages
    except Exception as e:
        logger.warning(f"Failed to fetch thread context: {e}")
        return []


def call_claude(question: str, thread_context: list[dict] | None = None,
                channel: str = None, status_ts: str = None) -> str:
    messages = []
    if thread_context and len(thread_context) > 1:
        for msg in thread_context[:-1]:
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": question})

    try:
        if status_ts:
            update_status(channel, status_ts, ":hourglass_flowing_sand: Réflexion en cours...")

        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        while response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    if status_ts:
                        query = block.input.get("query", "")
                        update_status(channel, status_ts,
                                      f":brain: Recherche... `{query}`")

                    result = archivist_search(
                        query=block.input["query"],
                        top_k=block.input.get("top_k", 5),
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

            if status_ts:
                update_status(channel, status_ts, ":hourglass_flowing_sand: Rédaction...")

            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
            )

        text_parts = [block.text for block in response.content if block.type == "text"]
        return "\n".join(text_parts) if text_parts else "Pas de réponse."

    except Exception as e:
        logger.error(f"Claude API error: {e}")
        return f"Erreur: {e}"


def handle_question(question: str, channel: str, thread_ts: str, event_ts: str):
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

    thread_context = None
    if thread_ts != event_ts:
        thread_context = get_thread_context(channel, thread_ts)

    response = call_claude(question, thread_context, channel, status_ts)

    if status_ts:
        try:
            app.client.chat_delete(channel=channel, ts=status_ts)
        except Exception:
            pass

    try:
        app.client.chat_postMessage(
            channel=channel,
            thread_ts=thread_ts,
            text=response,
        )
    except Exception as e:
        logger.error(f"Failed to post response: {e}")


@app.event("app_mention")
def handle_mention(event, say):
    text = event.get("text", "")
    bot_id = get_bot_user_id()
    question = text.replace(f"<@{bot_id}>", "").strip()

    if not question:
        say(text="Pose-moi une question !", thread_ts=event.get("ts"))
        return

    channel = event["channel"]
    event_ts = event["ts"]
    thread_ts = event.get("thread_ts", event_ts)

    threading.Thread(
        target=handle_question,
        args=(question, channel, thread_ts, event_ts),
        daemon=True,
    ).start()


@app.event("message")
def handle_dm(event, say):
    if event.get("bot_id") or event.get("subtype"):
        return
    if event.get("channel_type", "") != "im":
        return

    question = event.get("text", "").strip()
    if not question:
        return

    channel = event["channel"]
    event_ts = event["ts"]
    thread_ts = event.get("thread_ts", event_ts)

    threading.Thread(
        target=handle_question,
        args=(question, channel, thread_ts, event_ts),
        daemon=True,
    ).start()


def main():
    logger.info("Starting Slack bot (API mode, model: %s)...", MODEL)
    logger.info("Archivist python: %s", ARCHIVIST_PYTHON)
    logger.info("Archivist script: %s", ARCHIVIST_SCRIPT)
    handler = SocketModeHandler(app, os.environ["SLACK_BOT_SOCKET_MODE_TOKEN"])
    handler.start()


if __name__ == "__main__":
    main()
