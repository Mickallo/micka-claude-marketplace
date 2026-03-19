#!/usr/bin/env python3
"""ChromaDB RAG knowledge base CLI for the Archivist sub-agent."""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import chromadb
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

DB_PATH = Path(os.environ.get("CLAUDE_PLUGIN_DATA", Path(__file__).parent.parent / "data")) / "chromadb_data"
COLLECTION_NAME = "team_knowledge"
RETENTION_DAYS = 365  # 1 an


def get_collection():
    client = chromadb.PersistentClient(path=str(DB_PATH))
    ef = DefaultEmbeddingFunction()
    return client.get_or_create_collection(name=COLLECTION_NAME, embedding_function=ef)


def cmd_search(args):
    collection = get_collection()
    results = collection.query(query_texts=[args.query], n_results=args.top_k)
    output = []
    for i, doc_id in enumerate(results["ids"][0]):
        entry = {
            "id": doc_id,
            "content": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
        }
        if results["distances"]:
            entry["distance"] = results["distances"][0][i]
        output.append(entry)
    print(json.dumps(output, ensure_ascii=False, indent=2))


def cmd_index(args):
    collection = get_collection()
    doc_id = str(uuid.uuid4())
    metadata = {
        "date": datetime.now().isoformat(),
        "source": args.source or "interaction",
        "topics": args.topic or "",
        "author": args.author or "",
        "thread_id": args.thread_id or "",
    }
    collection.add(ids=[doc_id], documents=[args.content], metadatas=[metadata])
    print(json.dumps({"status": "indexed", "id": doc_id}, indent=2))


def cmd_maintain(args):
    collection = get_collection()
    all_data = collection.get(include=["documents", "metadatas", "embeddings"])
    total = len(all_data["ids"])

    sources = {}
    topics = {}
    cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS)).isoformat()
    expired_ids = []

    for i, meta in enumerate(all_data["metadatas"]):
        src = meta.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1
        for t in meta.get("topics", "").split(","):
            t = t.strip()
            if t:
                topics[t] = topics.get(t, 0) + 1
        # Check expiration
        date = meta.get("date", "")
        if date and date < cutoff:
            expired_ids.append(all_data["ids"][i])

    duplicates = []
    if all_data["embeddings"] is not None and total > 1:
        import numpy as np

        embeddings = np.array(all_data["embeddings"])
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        normalized = embeddings / norms
        sim_matrix = normalized @ normalized.T

        for i in range(total):
            for j in range(i + 1, total):
                if sim_matrix[i][j] > 0.95:
                    duplicates.append({
                        "doc_a": all_data["ids"][i],
                        "doc_b": all_data["ids"][j],
                        "similarity": float(sim_matrix[i][j]),
                    })

    report = {
        "total_documents": total,
        "by_source": sources,
        "by_topic": topics,
        "expired": len(expired_ids),
        "near_duplicates": duplicates,
    }

    if not args.dry_run:
        removed = []
        if expired_ids:
            collection.delete(ids=expired_ids)
            removed.extend(expired_ids)
        if duplicates:
            dup_ids = [d["doc_b"] for d in duplicates]
            collection.delete(ids=dup_ids)
            removed.extend(dup_ids)
        if removed:
            report["removed"] = len(removed)
            report["total_after_cleanup"] = total - len(removed)

    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Archivist RAG CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search")
    p_search.add_argument("query")
    p_search.add_argument("--top-k", type=int, default=10)

    p_index = sub.add_parser("index")
    p_index.add_argument("--content", required=True)
    p_index.add_argument("--topic", default="")
    p_index.add_argument("--source", default="interaction")
    p_index.add_argument("--author", default="")
    p_index.add_argument("--thread-id", default="")

    p_maintain = sub.add_parser("maintain")
    p_maintain.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()
    if args.command == "search":
        cmd_search(args)
    elif args.command == "index":
        cmd_index(args)
    elif args.command == "maintain":
        cmd_maintain(args)


if __name__ == "__main__":
    main()
