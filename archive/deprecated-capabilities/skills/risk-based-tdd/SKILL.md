---
name: risk-based-tdd
description: Use when implementing high-risk behavior changes, regressions, auth, billing, DB migrations, public APIs, data transforms, concurrency, or quality gates where a failing test can protect the work.
---

# Risk-Based TDD

Require tests for risk, not for ceremony.

## Use A Failing Test First For

- Regressions and bug fixes with a known failure.
- Data model, auth, permissions, billing, migrations, or public API changes.
- Parser, generation, normalization, validation, and quality gate logic.
- Shared utilities used by multiple features.

## Skip Strict TDD For

- Docs, comments, renames, formatting, mechanical config, dependency metadata, and isolated styling.
- Exploratory spikes where the expected behavior is not yet known.

## Minimum Loop

1. Capture the risky behavior in the narrowest test or fixture.
2. Confirm the test fails for the intended reason.
3. Implement the smallest fix.
4. Run the targeted test and the relevant quality check.
