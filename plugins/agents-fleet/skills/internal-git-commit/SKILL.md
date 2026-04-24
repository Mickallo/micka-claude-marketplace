---
name: internal-git-commit
description: Karma convention for git commits - format, types, body structure, and split strategy guidelines
user-invocable: false
---

# Git Commits Guide

Complete reference for creating structured git commits following the Karma convention.

## Title Format (Karma Convention)

### Structure

`<type>(<scope>): <description>`

**Required components:**
- **type**: One of feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
- **description**: Imperative mood, lowercase, under 72 characters, no trailing period

**Optional component:**
- **scope**: Contextual information (e.g., auth, api, ui, database)

### Type Definitions

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style (formatting, spacing)
- **refactor**: Code restructuring without behavior change
- **perf**: Performance improvements
- **test**: Test additions or modifications
- **chore**: Maintenance tasks
- **ci**: CI/CD configuration
- **build**: Build system changes
- **revert**: Revert previous commit

### Title Rules

- Use imperative mood (add, not added or adds)
- Keep description concise and clear
- Description must be lowercase
- Under 72 characters
- No trailing period

### Title Validation

- `feat(auth): add OAuth2 login flow`
- `fix: resolve memory leak in cache handler`
- `docs: update API documentation`
- `Added new feature` (not imperative, no type)
- `fix(auth): Fixed the login bug.` (not lowercase, has period)
- `feat(authentication-module): adds a new authentication system` (scope too long, not imperative)

## Body Format (Adaptive)

The commit body should be adapted to the complexity of the change. Always leave a blank line between the title and the body.

**Guiding principle**: Match the body length to the change complexity.

### Simple Changes

For obvious single-file changes or trivial modifications:
- **No body** or **1-2 lines** explaining why if needed

### Medium Changes (~10 lines max)

For features or fixes across a few files:
- **Why**: 1-2 phrases explaining motivation
- **What**: Bullet list of main changes

### Complex Changes

For refactorings, breaking changes, or multi-component features:
- **Why**: Paragraph explaining context and motivation
- **What**: Detailed list of changes with explanations
- **BREAKING CHANGE**: Description of breaking changes (if applicable)
- **Refs**: Issue references (if applicable)

### Body Guidelines

- **Focus on WHY**: Explain motivation and context (most important)
- **Summarize WHAT**: List main changes (not a diff)
- **Explain HOW**: Only if the approach is not obvious
- **Breaking changes**: Always mention with `BREAKING CHANGE:` prefix
- **References**: Use `Refs: #123` to link issues
- **Adapt the format**: Use the structure that makes sense for your change

### Complete Examples

**Example 1: Simple Change (No Body)**

```
docs: fix typo in README
```

**Example 2: Medium Change (Why + What)**

```
feat(auth): add password reset flow

Why: Users needed a way to recover their accounts.

What:
- Add /reset-password endpoint
- Send email with reset token
- Create reset form UI
```

**Example 3: Complex Change (Full Structure)**

```
refactor(database): migrate from MySQL to PostgreSQL

Why: MySQL limitations were blocking horizontal scaling. PostgreSQL
provides better JSON support and replication options needed for
multi-region deployment.

What:
- Migrate schema and data to PostgreSQL
- Update ORM configuration for PostgreSQL dialect
- Refactor query syntax for PostgreSQL compatibility
- Add connection pooling for improved performance
- Update documentation and deployment scripts

BREAKING CHANGE: Database connection strings must be updated in all
environments. Run migration script: scripts/migrate-db.sh

Refs: #245
```

## Commit Strategy

### When to Create Single Commit

- Single file changed with clear purpose
- All changes serve one unified goal
- User explicitly requested single commit

### When to Split Commits

- Multiple files with clearly distinct purposes
- Distinct features or fixes in the same changeset that can be cleanly separated
- Logical separation improves clarity and each commit is self-contained

**IMPORTANT**: Split commits automatically when the separation is clear and logical. Use the **AskUserQuestion tool** only when the strategy is ambiguous or user intent is uncertain.

### Technical Limitations

- **Cannot use `git add -p`**: Interactive staging is not supported in Claude Code
- **After `git add .`**: Only ONE commit is possible (cannot add more changes afterward)
- **For splitting**: User must manually stage files outside Claude Code
