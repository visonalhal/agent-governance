---
name: unit-test-design
description: Use when adding or reviewing unit tests for business logic, parsers, services, validators, reducers, generators, or shared utilities.
---

# Unit Test Design

Prefer tests that pin behavior at the smallest stable boundary.

## Pattern

- Test public behavior, not private implementation details.
- Use fixtures for meaningful domain cases.
- Cover the primary path, one important edge, and the regression if present.
- Mock only external boundaries: network, clock, filesystem, database, or model calls.
- Keep assertions precise and readable.

## Anti-Triggers

- Do not add brittle snapshots for logic-heavy behavior.
- Do not test framework wiring unless the bug is in the wiring.
- Do not create broad tests that require unrelated app bootstrap when a pure boundary exists.
