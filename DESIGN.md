# DESIGN.md — vise-workflow-engine editor

## Direction: quiet console

The editor sits inside other companies' admin apps and is used in long sessions by operators, so it follows the Enginy / Edicola console look but stays brand-neutral: zinc neutrals, a black primary button, hairline borders, dense 13px text. The host's brand comes in through CSS variables, never through the component.

## Tokens (`src/react/style.css`, on `.vwe-root`)

| Role | Light | Dark |
|---|---|---|
| Surface (cards, panels, inputs) `--vwe-surface` | `#ffffff` | `#0f0f11` |
| Canvas and sidebar `--vwe-canvas` | `#fafafa` | `#141416` |
| Subtle (hover, segmented track) `--vwe-subtle` | `#f4f4f5` | `#1c1c1f` |
| Border / strong `--vwe-border(-strong)` | `#e4e4e7` / `#d4d4d8` | `#27272a` / `#3f3f46` |
| Text / body / muted | `#18181b` / `#3f3f46` / `#71717a` | `#fafafa` / `#d4d4d8` / `#a1a1aa` |
| Primary button `--vwe-primary` | `#18181b` on white | `#fafafa` on black |
| Status | `-50` surface, `-200` border, `-700` text (red error, amber warning) | veils of the tint |

- Font: `--vwe-font` (Inter if the host loads it, else system). One family; tabular figures for counts and numbers.
- Sizes: 13px body, 12px secondary, 11px labels; inputs 16px on phones.
- Radius 6px controls, 8px cards and nodes. Shadow: `shadow-xs` only; popovers get one soft drop.
- Controls 32px on desktop, 40px on phones, 44px on touch pointers.
- Motion: colour transitions only (120ms); off with `prefers-reduced-motion`.
- Themes: `theme="light" | "dark" | "system"` sets `data-theme`; components never branch on theme.

## Signature moves

1. **White node cards with an icon chip.** The block's colour lives only in the 28px chip; cards stay white with a hairline border, selected = 1px black ring.
2. **Ports as a footer row.** Decision branches are labelled cells along the bottom edge with the handle under each label; edges stay neutral grey.
3. **Toolbar pill** for problems: `Problems  2 errors ▾`, tinted by severity.

## Rules

- Colours only from the variables; block colours only inside chips.
- Status always text + colour (issue tags say "Error" / "Warning").
- Hooks are workflow settings, not steps: they live in the sidebar's Hooks tab, never on the canvas.
- No native `alert` / `confirm` / `prompt`; confirmations are inline.
- Phones: sidebar and inspector are bottom sheets; the canvas keeps the full width.
- Emoji are allowed as `icon` but the recommended path is SVG through the `icons` prop.
