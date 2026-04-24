---
name: internal-git-pr
description: PR formatting conventions - Karma title format, Why/What body structure, and adaptive complexity guidelines
user-invocable: false
---

# GitHub Pull Request Guide

Complete reference for creating structured GitHub pull requests following the Karma convention.

## PR Title Format (Karma Convention)

### Structure

`<type>(<scope>): <description>`

Same type/scope/description rules as git commits.

### Title Strategy

- **Single commit PR**: Use commit message as title
- **Multi-commit PR**: Summarize the **overall value**
  - Use the most significant type (feat > fix > refactor > docs > chore)
  - Scope = main area impacted
  - Description = What is the *result* for the user/developer?

Example: Commits `feat(auth): add login`, `feat(auth): add logout`, `docs(auth): update guide`
-> PR title: `feat(auth): add authentication system`

## PR Body Format

### Standard Structure

```markdown
## Why

<1 paragraph explaining the motivation and context for this change>

## What

- <Summary of change 1>
- <Summary of change 2>

## Tests (optional - include only if relevant)

<Test coverage information if applicable>
```

### Section Guidelines

#### Why Section
- **Purpose**: Provide business context and motivation
- **Length**: 1 paragraph (2-4 sentences)
- **Focus**: Problem being solved, user impact, or technical necessity

#### What Section
- **Purpose**: Summarize technical changes
- **Format**: Bullet list, using commit message style
- **Content**: High-level overview of modifications

#### Tests Section (Optional)

**Include when**: Tests were added or significantly modified
**Omit when**: Docs changes, config updates, refactoring without test modifications

### Adaptive Format

- **Simple PR** (1-2 commits): Short Why, brief What, omit Tests
- **Medium PR** (3-10 commits): Standard format, include Tests if applicable
- **Complex PR** (10+ commits): Detailed Why, comprehensive What with grouping

## PR Creation

### Required Flags
- `--assignee @me` (always)
- `--reviewer <user>` (only if user specified)

### Command Pattern
```bash
git push -u origin <branch> && gh pr create \
  --title "type(scope): description" \
  --assignee @me \
  --body "$(cat <<'EOF'
## Why
<reason>

## What
- <changes>
EOF
)"
```

### Zero Friction Principle
- Do NOT ask for reviewers unless user mentioned them
- Do NOT ask for draft status unless user mentioned it
- Do NOT ask for confirmation (unless conflicts exist)
- DEFAULT: Create a standard PR, assigned to @me, immediately

### Pre-flight Checks
- Never create PR from main/master (create feature branch first)
- Check if behind origin (warn about potential conflicts)
- Review ALL commits, not just the latest

## Complete Examples

**Simple Documentation PR**

```markdown
## Why

Fixed typo in README that was confusing new users.

## What

- Correct "installtion" to "installation"
```

**Feature PR with Tests**

```markdown
## Why

Users requested the ability to reset their passwords when locked out of
their accounts. Currently, the only recovery option is contacting support,
which creates delays and poor user experience.

## What

- Add /api/auth/reset-password endpoint
- Send password reset email with secure token
- Create password reset form UI
- Add rate limiting to prevent abuse

## Tests

Added unit tests for endpoint logic and integration tests for the full
reset flow.
```
