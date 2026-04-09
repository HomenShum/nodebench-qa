# What to steal from Claude Code + Codex open source

## Claude Code hooks we're NOT using yet

Our install script only uses 2 hooks: PostToolUse + Stop. Claude Code exposes **20+ hook events** we should leverage:

### High-value hooks to add immediately

| Hook | What it does | Attrition use |
|------|-------------|---------------|
| **PreToolUse** | Fires BEFORE a tool runs. Can BLOCK the call. | **Prevent redundant searches** — if agent already searched the same query, block and say "you already searched this." Saves tokens. |
| **UserPromptSubmit** | Fires when user types prompt. Can inject context. | **Workflow detection** — detect recurring workflow patterns, inject required steps BEFORE agent starts. We claim this but only do it via on-prompt HTTP endpoint. |
| **SubagentStop** | Fires when a subagent tries to stop. | **Judge subagent work too** — not just the main agent. Subagents cut corners more than main agents. |
| **InstructionsLoaded** | Fires after CLAUDE.md/rules load. Can modify instructions. | **Dynamic workflow injection** — append the user's captured workflow steps to the instruction set at runtime. Replaces static rules files. |
| **PreCompact / PostCompact** | Fires when context is compacted. | **Save workflow state before compaction** — capture the current workflow progress so it survives context pruning. This solves the memory-loss pain. |
| **FileChanged** | Fires when files change on disk. | **Track file-level evidence** — know exactly which files were touched without parsing tool calls. More reliable step evidence. |
| **PermissionRequest** | Fires on permission prompts. | **Auto-approve known-safe patterns** — if the workflow specifies "run tests," auto-approve the test command instead of asking. |
| **SessionEnd** | Fires when session ends. | **Auto-capture workflow** — don't require `bp capture`. Just save the session automatically on end. |

### Hook features we should use

| Feature | What it does | Attrition use |
|---------|-------------|---------------|
| **Exit code 2 = BLOCK** | Hook can block the action by returning exit code 2 | **Hard-block incomplete stop** — our Stop hook should exit 2 when steps are missing. Currently we just log. |
| **JSON decision output** | Hook can return `{"decision": "block", "reason": "..."}` | **Structured verdicts** — return verdict JSON that Claude sees as context for its next action. |
| **Matcher patterns** | `"matcher": "Bash\|Edit\|Write"` — only fire on specific tools | **Targeted tracking** — don't fire on every tool. Only track evidence-relevant tools. Reduces overhead. |
| **`if` field** | `"if": "Bash(git *)"` — regex on tool args | **Granular step evidence** — `"Bash(npm test\|vitest\|pytest)"` = test evidence. Much more precise than parsing all Bash calls. |
| **HTTP hooks** | Hook can call an HTTP endpoint instead of running a command | **Remote judge** — let the Rust server handle the judgment, not a Python script. Faster, more reliable. |
| **Prompt/agent hooks** | Hook handler can be `"type": "prompt"` — Claude processes it | **LLM-powered judgment** — for complex workflow detection, let Claude itself decide if the workflow matches. |
| **Environment variables from SessionStart** | SessionStart can persist env vars | **Pass workflow ID to all hooks** — detect workflow once at start, set `ATTRITION_WORKFLOW_ID`, all subsequent hooks use it. |

## Claude Code plugin system

Claude Code now has a full plugin system (`.claude-plugin/` directory). Attrition should ship as a **Claude Code plugin** instead of just hook scripts.

### What a plugin gives us
- **`hooks/hooks.json`** — hooks merge with user hooks when plugin is enabled
- **`hooks/install.sh`** — runs on plugin install (setup the db, etc.)
- **Persistent data directory** — `$CLAUDE_PLUGIN_DATA` survives plugin updates
- **Skills bundled with plugin** — our SKILL.md ships automatically
- **One-command install** — `npx skills add attrition` or similar

### What to build
```
.claude-plugin/
  plugin.json          # metadata, version, description
  hooks/
    hooks.json         # all our hooks (PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, etc.)
    judge-stop.sh      # Stop hook → calls bp judge --on-stop
    track-tool.sh      # PostToolUse hook → appends to activity.jsonl
    detect-workflow.sh  # UserPromptSubmit → workflow detection
    block-redundant.sh  # PreToolUse → block duplicate searches
    auto-capture.sh    # SessionEnd → auto-capture workflow
  skills/
    attrition/SKILL.md # bundled skill
```

## Codex features to steal

OpenAI Codex (94.9% Rust, 74.2K stars, 690 releases) has:

| Feature | Codex has it | Attrition equivalent |
|---------|-------------|---------------------|
| **AGENTS.md** | Config file telling agent how team builds/tests/ships | We have CLAUDE.md rules but should also support AGENTS.md format |
| **Skills** | Reusable instruction bundles (`$skill-name`) | We have skills but should match the Codex skill format for portability |
| **Rust CLI** | Full Rust implementation with sandboxed execution | We already have this ✓ |
| **codex-rs** | Rust rewrite of the CLI with sandbox | Our architecture is similar |
| **SDK** | `sdk/` directory with typed client | We have this ✓ |
| **Sandbox execution** | Isolated environment for agent actions | We don't have this — could add for replay verification |
| **Progressive disclosure** | Load only needed skills, not everything | Matches NodeBench's progressive discovery pattern |

## What this means for attrition.sh

### Immediate (this week)
1. **Ship as a Claude Code plugin** — not just hook scripts. One install, everything bundled.
2. **Use exit code 2 for hard-blocking** — Stop hook should actually BLOCK, not just log.
3. **Add PreToolUse hook** — block redundant searches (direct token savings, visible to user).
4. **Add SessionEnd auto-capture** — no manual `bp capture` needed.
5. **Use HTTP hooks** — point hooks at `bp serve` instead of inline Python. Faster, more reliable.

### Next 2 weeks
6. **Add InstructionsLoaded hook** — dynamically inject workflow steps into CLAUDE.md at runtime.
7. **Add PreCompact hook** — save workflow state before context pruning.
8. **Use matcher + if patterns** — targeted tracking instead of firing on every tool.
9. **Support AGENTS.md format** — work with Codex users too.

### Next month
10. **Full plugin with persistent data** — SQLite in `$CLAUDE_PLUGIN_DATA`.
11. **Portable skill format** — work with both Claude Code and Codex.
12. **Sandbox replay** — verify distilled replays in isolated environment.
