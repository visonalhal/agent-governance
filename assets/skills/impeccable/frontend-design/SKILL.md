---
name: frontend-design
description: Use when creating or materially redesigning a frontend interface and visual design judgment is central. For maintenance work, preserve the existing design system and avoid unrequested restyling.
license: Apache 2.0. Based on Anthropic's frontend-design skill. See NOTICE.md for attribution.
---

# Frontend Design

Build a coherent interface that fits the product. Distinctiveness may help greenfield work; consistency governs maintenance.

## Context first

Read repository rules, nearby screens, primitives, and tokens. Identify the user job, constraints, and whether the task is greenfield or maintenance.

Do not invent a new brand, type system, palette, component family, or interaction model during routine maintenance.

## Implement

- Preserve semantics, accessibility, responsiveness, states, and real behavior.
- Use existing tokens and components before adding new ones.
- Make hierarchy, spacing, type, color, and motion intentional. Match complexity to the product.
- Avoid repeated generic cards, decorative glow/glass, excessive centering, and motion without state meaning.

Read only the relevant reference group:

- Visual system: [typography](reference/typography.md), [color](reference/color-and-contrast.md), [layout](reference/spatial-design.md)
- Behavior: [interaction](reference/interaction-design.md), [motion](reference/motion-design.md), [responsive](reference/responsive-design.md)
- [UX writing](reference/ux-writing.md) or [production QA](reference/production-qa.md) when relevant

## Verify

Inspect representative sizes and states. Report actual checks; a narrow visual pass is not production readiness.
