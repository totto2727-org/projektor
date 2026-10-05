---
title: "Design tokens"
description: "The token contract behind Projektor's theming: what's safe to override, and what must never move."
sidebar:
  order: 3
---

Projektor's product tokens live in `apps/web/src/styles/tokens.css`, with the generated component palette bridge in `apps/web/src/styles/shadcn.css`.
Light/dark and brand customization use CSS custom-property swaps; generated controls also use the configured dark variant.
The React/Effront app emits deployment/workspace brand variables during SSR.
Its shared controls are the 22 shadcn `4.21.1` `base-nova` components built on Base UI, with per-file notes recording the `cn` import alias change to `@/lib/utils`.
Product-specific adapters remain outside generated source, and the product token contract remains separate from component-library primitives.

## Two kinds of token

Every token in `tokens.css` falls into one of two categories:

**Brand-derived** — follows `--accent`. Expressed as
`color-mix(in oklab, var(--accent) N%, transparent)` (translucent tints) or
`color-mix(in oklch, white/black P%, var(--accent) Q%)` (opaque tints and the chart
lightness ramp), never as a hand-written hex or `rgba()`. Setting a different accent
should visibly rebrand every token in this category with no further edits.

Examples: `--priority-medium-*`, `--status-in-progress`, `--sprint-active-*`,
`--sprint-notice-*`, `--dropzone-bg`, `--velocity-bar-bg`, `--chart-seq-1` through
`--chart-seq-4`.

**Semantic-fixed** — never follows brand. Danger red, done green, warning amber, and
the urgent/high priority colors stay put regardless of accent — a green "urgent" badge
is a bug, not a customisation.

Examples: `--danger-*`, `--warning-*`, `--success-*`, `--status-done`,
`--status-cancelled`, `--priority-urgent-*`, `--priority-high-*`.

Safe branding inputs are `--accent` and the explicitly configured `--on-accent` value (see below). Overriding a semantic-fixed token
directly is not supported; if a workspace genuinely needs a different danger color,
that's a product decision, not a theming one.

## `--on-accent` is explicit, not automatically derived

`--light-on-accent` / `--dark-on-accent` are fixed per-theme values (`#fff`), not
derived from `--accent`. A real derivation needs to pick black or white text based on
the accent's actual lightness so a pale custom brand colour doesn't render white-on-white.

This can't be done in reliable, broadly-supported pure CSS: relative color syntax
(`oklch(from var(--accent) l c h)`) can build a *new* color out of an existing one's
channels, but it can't hand you a channel back as a free-standing number for a
`calc()`/threshold comparison. The derivation has to happen in JS, at the point a
custom accent is actually set:

1. Compute the new accent's relative luminance (WCAG formula).
2. Pick black or white — whichever gives the higher contrast ratio, or apply the
   standard ~0.5 relative-luminance threshold.
3. Set both `--accent` and the computed `--on-accent` as inline styles on `<html>`
   alongside each other.

The default themes retain their static white value, while SSR branding can explicitly set both light and dark on-accent variables from `BRAND_ON_ACCENT` or a workspace override.
That configured value is not an automatic contrast derivation: a custom pale accent must supply a suitable foreground value.
The default-theme measurements below are unchanged by the frontend migration.

## Contrast

Measured against the current default accents (light `#4f46e5`, dark `#6366f1`):

| Pair | Ratio | AA text (4.5:1) | AA UI/large text (3:1) |
|---|---|---|---|
| light `--accent` vs `--light-on-accent` (white) | 6.29:1 | pass | pass |
| dark `--accent` vs `--dark-on-accent` (white) | 4.47:1 | fail | pass |
| light `--priority-medium-text` (= accent) vs `--light-surface` | 6.01:1 | pass | pass |
| dark `--priority-medium-text` (55% white / 45% accent mix) vs `--dark-surface` | 8.92:1 | pass | pass |

The dark on-accent pairing fails the 4.5:1 body-text threshold (it clears the looser
3:1 UI-component/large-text one). It isn't something this token split changes — it's
inherent to the shipped dark accent color, and `--on-accent` is only ever used on
short UI labels (button text, badges, the sidebar brand mark), not body copy — but a
future ticket touching `--dark-accent` should either darken it slightly or shrink this
gap another way.

## Reading tokens from JS

Canvas-rendered charts (`apps/web/src/features/planning/flow-charts.tsx`,
`apps/web/src/features/planning/MetricsDashboard.tsx`) can't use `var()` — canvas APIs need a
resolved color string. These read the live custom property via a `readThemeColor()`
helper with a literal fallback for the rare case the property isn't resolvable yet.
The fallback is a safety net, not a second source of truth — the token itself is
still what actually renders.

The four `--chart-seq-*` tokens are `color-mix()` expressions, and an *unregistered*
custom property's computed value is only var()-substituted, not fully resolved — so
`getComputedStyle` would hand the canvas an unresolved `color-mix(...)` string instead
of a color. `tokens.css` registers them with `@property { syntax: "<color>"; ... }` so
the UA resolves them to a real color at computed-value time before JS ever reads them.
