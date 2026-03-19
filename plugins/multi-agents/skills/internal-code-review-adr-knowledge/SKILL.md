---
name: internal-code-review-adr-knowledge
description: ADR knowledge base for code review — architecture decisions, conventions, and review rules
disable-model-invocation: true
---

# ADR Knowledge Base

How to load and use ADRs (Architecture Decision Records) for code review. ADRs are stored in a centralized GitHub registry and fetched at review time.

## ADR Registry

ADRs are hosted in a GitHub repository (configured via `.reviewer.json` or defaults). The registry contains:

- `index.json` — lightweight index of all ADRs (id, title, scope, categories, file path)
- `adrs/*.md` — individual ADR files with full review rules

## Default Configuration

If no `.reviewer.json` exists at the repo root, use these defaults:

```json
{
  "registry": {
    "repo": "Evaneos/engineering-standards",
    "ref": "main"
  },
  "adrs": {
    "include": [],
    "exclude": []
  },
  "docsPaths": []
}
```

If `adrs.include` is empty, no registry ADRs are loaded — only `docsPaths` will be used.

## Loading Procedure

### 1. Read configuration

Read `.reviewer.json` at the project root. If absent, use defaults above.

### 2. Fetch the index

```bash
gh api repos/{registry.repo}/contents/index.json --jq '.content' | base64 -d
```

### 3. Filter ADRs

Apply `adrs.include` and `adrs.exclude` against the index:

- `category:xxx` — matches entries where `categories` contains `xxx`
- `PREFIX-slug` — matches entries where `id` equals the value (e.g., `DB-database-metadata-requirements`)
- `exclude` removes matching entries even if included by a category

If matched ADRs exceed 20, ask the user to narrow the scope.

### 4. Fetch matched ADRs

```bash
gh api repos/{registry.repo}/contents/{adr.file}?ref={registry.ref} --jq '.content' | base64 -d
```

### 5. Load project-level docs

If `docsPaths` is configured, scan those directories with Glob and Read each file. These local docs have equal weight as registry ADRs.

## ADR Format

Each ADR file follows this structure:

- **Status**: Accepted, Deprecated, Superseded
- **Scope**: Which file types/languages it applies to
- **Context**: Why this decision was made
- **Decision**: What was decided
- **Review Rules**: Conformant (OK), Violation (Flag), Suggestions
- **Examples**: Conformant and non-conformant code

## Building Links

- **Registry ADRs**: `https://github.com/<registry.repo>/blob/<registry.ref>/<adr.file>#<section-anchor>`
- **Local docs**: relative file path with anchor (e.g., `docs/adr/error-handling.md#section`)
