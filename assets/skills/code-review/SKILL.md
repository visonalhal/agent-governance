---
name: code-review
description: Conduct thorough, constructive code reviews for quality and security. Use when reviewing pull requests, checking code quality, identifying bugs, or auditing security. Handles best practices, SOLID principles, security vulnerabilities, performance analysis, and testing coverage.
---

# Code Review

Review code with a findings-first mindset. Prioritize correctness, regressions, security, and missing tests over style-only feedback.

## Review Goals

- Catch bugs, behavioral regressions, and unsafe edge cases
- Check security, data handling, and authorization assumptions
- Flag performance issues that matter for the changed path
- Verify tests cover the intended behavior and likely failure modes
- Keep feedback constructive and actionable

## Output Format

Start with findings ordered by severity.

- `Critical`: broken behavior, data loss, security issues, or release blockers
- `Important`: likely bugs, regressions, missing validation, or missing coverage
- `Minor`: maintainability or clarity issues that are worth fixing but are not blocking

For each finding:

1. Say what is wrong
2. Point to the file and relevant line or function
3. Explain the impact
4. Suggest the smallest reasonable fix

If there are no findings, say that explicitly and call out any residual risk or test gaps.

## Review Flow

1. Understand the change intent before judging the code
2. Check the main execution path first
3. Look for edge cases, fallback paths, and state transitions
4. Review security, permissions, and trust boundaries
5. Review performance only where the change can plausibly matter
6. Check whether tests prove the intended behavior

## What To Look For

### Correctness

- Wrong branching, precedence, or default behavior
- Missing null, empty, or error handling
- Inconsistent state updates
- Accidental API or contract changes

### Security

- Missing auth or authorization checks
- Unsafe input handling
- Secret leakage, over-logging, or insecure defaults
- Injection risks or unsafe shell/database usage

### Performance

- N+1 queries or repeated expensive work in hot paths
- Wasteful rerenders or large synchronous work on the main path
- Unbounded loops, scans, or payload growth

### Tests

- Happy path only, no edge cases
- Missing regression coverage for changed behavior
- Assertions too weak to catch the actual bug

## Tone

Be direct, specific, and kind. Prefer "this will break when..." over vague statements. Avoid nitpicks unless they create real cost or confusion.

## Legacy Metadata

The original local install metadata for this skill is preserved in `SKILL.toon`.
