# Production QA

Use this checklist after the main interface works. It consolidates the useful parts of the retired harden, normalize, polish, and typeset workflows without turning routine implementation into a separate process chain.

## Design-system alignment

- Reuse existing components, tokens, spacing scales, radii, shadows, and interaction patterns before adding one-off values.
- Remove accidental visual variants. A difference should communicate hierarchy, state, or brand intent.
- Check default, hover, focus, active, disabled, selected, loading, empty, and error states where they apply.

## Resilience and accessibility

- Test long labels, long unbroken content, missing optional data, zero results, slow loading, and failed requests.
- Prevent flex and grid overflow with deliberate shrinking, wrapping, truncation, and scroll behavior.
- Preserve labels, instructions, focus visibility, keyboard order, semantic controls, and useful error messages.
- Respect reduced-motion preferences and avoid animation that blocks input or obscures state changes.

## Typography and responsive behavior

- Use the established type scale and consult `typography.md` when hierarchy, pairing, measure, or loading needs deeper work.
- Check line length, line height, weight contrast, numeric alignment, and wrapping at representative viewport widths.
- Adapt layout and interaction on small screens; do not merely shrink the desktop composition or hide essential actions.

## Final polish

- Check alignment, spacing rhythm, optical balance, icon sizing, borders, dividers, and control heights as a system.
- Remove redundant containers, repeated copy, decorative effects without purpose, and inconsistent emphasis.
- Verify the interface at small, medium, and large viewports. Use keyboard navigation, inspect the console, and compare against the design reference when one exists.
