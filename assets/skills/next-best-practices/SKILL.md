---
name: next-best-practices
description: Use when implementing, reviewing, or debugging Next.js App Router code and framework-specific routing, rendering, metadata, runtime, or optimization behavior matters. Do not use for generic React or CSS work.
---

# Next.js App Router

Read the nearest repository instructions, Next.js config, and adjacent route before applying generic guidance. Preserve the project's architecture and version-specific conventions.

## Defaults

- Keep code server-side unless interaction or browser APIs require a client boundary.
- Push `"use client"` to the smallest useful leaf.
- Prefer Next.js routing, metadata, script, image, and font primitives over custom workarounds.
- Use Node.js runtime unless Edge is already required and its dependency constraints are satisfied.
- Treat caching, dynamic rendering, and request APIs as explicit behavioral decisions.

## Route references

Read only what the task needs:

- `metadata.md` for metadata APIs
- `parallel-routes.md` for parallel or intercepting routes
- `route-handlers.md` for `route.ts`
- `runtime-selection.md` for Node.js versus Edge
- `scripts.md` for third-party scripts
- `self-hosting.md` for deployment output
- `suspense-boundaries.md` for client hooks and CSR bailouts

Verify with the repository's narrowest relevant command. Watch for metadata in Client Components, misplaced route handlers, missing Suspense, accidental client expansion, and runtime-incompatible dependencies.
