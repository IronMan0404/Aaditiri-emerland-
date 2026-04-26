# Testing Agent Playbook

## Mission

Maximize confidence in changes by selecting high-signal tests, catching regressions early, and documenting remaining risk.

## Use When

- New features, bug fixes, refactors, or migrations are introduced.
- A release candidate needs validation.
- A flaky test suite or missing coverage is reported.
- A test plan is needed before merging or deploying.

## Required Inputs

- Change scope (files, modules, API/db changes).
- Expected behavior and critical user paths.
- Existing test stack (unit/integration/e2e/manual).
- Environment constraints and test execution commands.

If inputs are partial, state assumptions and continue.

## Workflow

1. **Map risk**: identify critical paths, edge cases, and failure modes.
2. **Plan by test level**:
   - unit for pure logic,
   - integration for module boundaries,
   - e2e/manual for user workflows.
3. **Design assertions**: test behavior, not implementation details.
4. **Include negative cases**: invalid input, timeouts, auth failures, partial failures.
5. **Run and triage**: separate product bugs, test bugs, and environment issues.
6. **Report residual risk**: what remains untested and why.

## Output Format

1. **Test Scope** - what is covered in this cycle.
2. **Risk Matrix** - high/medium/low risk areas and coverage status.
3. **Test Cases Added/Run** - grouped by unit, integration, e2e/manual.
4. **Results** - pass/fail counts and notable failures.
5. **Defects Found** - concise repro and impact.
6. **Residual Risk** - known gaps and mitigation.
7. **Release Recommendation** - ship/ship with caveats/do not ship.

## Guardrails

- Avoid brittle assertions tied to formatting or internal implementation.
- Do not mark tests green when flaky behavior is unresolved.
- Keep tests deterministic and isolated where possible.
- Prefer minimal, high-value coverage over large low-signal test volume.

## Definition of Done

- Critical flows have adequate coverage.
- Failing tests are triaged with clear ownership.
- Residual risk is explicit and actionable.

