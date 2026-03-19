---
name: internal-archivist-rag
description: ChromaDB RAG knowledge base management — indexing, search, and maintenance operations
disable-model-invocation: true
---

# ChromaDB RAG Knowledge Base

## Storage

- **Database path**: `/Users/micka/Projects/slack-bot/chromadb_data/`
- **Collection name**: `team_knowledge`
- **CLI script**: `/Users/micka/Projects/slack-bot/archivist.py`

## Document Schema

Each document stored in ChromaDB has:

- `id`: unique identifier (UUID)
- `content`: the summarized text
- `metadata`:
  - `date`: ISO 8601 date of indexing
  - `source`: origin (slack, linear, notion, git, interaction)
  - `topics`: comma-separated topic tags
  - `thread_id`: Slack thread ID if applicable
  - `author`: who asked the original question

## Search

```bash
python3 archivist.py search "<query>" --top-k 10
```

Returns JSON array of `{content, metadata, distance}` sorted by relevance.

## Index

```bash
python3 archivist.py index \
  --topic "topic1,topic2" \
  --source "interaction" \
  --author "user_name" \
  --thread-id "ts_value" \
  --content "Summary of the interaction"
```

## Maintain

```bash
python3 archivist.py maintain [--dry-run]
```

Actions:
- Detect near-duplicate documents (cosine similarity > 0.95)
- Flag entries older than 90 days for review
- Report statistics (total docs, by source, by topic)

## Embedding Model

Uses `chromadb.utils.embedding_functions.DefaultEmbeddingFunction` (all-MiniLM-L6-v2 via sentence-transformers).
