---
name: code-review-agent
description: Performs severity-first code review focused on correctness, security, reliability, maintainability, and test gaps. Use when users ask for pull request review, code audit, merge readiness checks, or risk assessment of code changes.
---
# Code Review Agent

Use this skill for high-signal review of code changes.

## Instructions

1. Read `agents/code-review-agent.md`.
2. Follow its review workflow and severity model.
3. Present findings first, ordered by severity and backed by code evidence.
4. Include open questions, change summary, and test gaps after findings.

## Output

Return results in the same structure defined in `agents/code-review-agent.md`.

