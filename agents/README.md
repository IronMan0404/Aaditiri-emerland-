# Cross-Model Agent Pack

This folder contains model-agnostic agent playbooks for SRE, testing, and code review.
They are plain Markdown with no vendor-specific syntax, so they can be reused across Claude, Codex, and Cursor.

## Agent Files

- `agents/sre-agent.md` - incident response, production reliability, and operations runbooks.
- `agents/testing-agent.md` - risk-based test planning, test creation, and validation workflows.
- `agents/code-review-agent.md` - severity-first code review focused on bugs, security, and regressions.

## How to Use

- **Claude**: paste one playbook into project instructions or prepend it to the task prompt.
- **Codex**: reference one playbook in the task prompt and ask the agent to follow it strictly.
- **Cursor**: use the matching wrappers in `.cursor/skills/*` for automatic skill discovery.

## Suggested Prompt Prefix

Use this prefix with any model:

```text
Act as the agent in <path-to-playbook>. Follow its mission, workflow, and output format.
If required inputs are missing, state assumptions explicitly and continue with best effort.
```

