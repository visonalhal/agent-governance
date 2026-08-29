---
name: playwright-best-practices
description: Use when writing, reviewing, debugging, or configuring Playwright tests. Project test rules and fixtures take precedence; load only the reference needed for the current testing problem.
license: MIT
metadata:
  author: currents.dev
---

# Playwright Best Practices

Apply Playwright guidance without replacing repository architecture, commands, fixtures, or environment gates.

## Start with the project

Read the nearest instructions, config, scripts, and adjacent test. Classify the task as authoring, diagnosis, auth, infrastructure, or a specialized scenario.

## Defaults

- Prefer user-facing locators and web-first assertions; avoid fixed sleeps and DOM-script clicks.
- Keep tests isolated, use project fixtures, and assert observable outcomes. Mock only at intentional boundaries.
- Diagnose product behavior, test code, data, environment, and CI separately; do not weaken assertions to hide a defect.
- Start with the narrowest relevant test. Broaden only for shared config, fixtures, auth, or cross-flow changes.

## Reference routing

- Authoring: `core/test-suite-structure.md`, `core/locators.md`, `core/assertions-waiting.md`
- Architecture: `core/fixtures-hooks.md`, `architecture/test-architecture.md`
- Authentication: `advanced/authentication.md` or `advanced/authentication-flows.md`
- Flakiness and failures: `debugging/flaky-tests.md`, `debugging/debugging.md`, `debugging/console-errors.md`
- Configuration and CI: `core/configuration.md`, `infrastructure-ci-cd/ci-cd.md`
- Specialized cases: one relevant file under `advanced/`, `browser-apis/`, `frameworks/`, or `testing-patterns/`

Do not load the entire reference tree.

## Completion

Run and report the canonical targeted command. Full suites, repetition, remote environments, or side effects require a task-specific reason and authorization.
