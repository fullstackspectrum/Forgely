# Forgely — logo assets

The mark is a nine-cell grid disturbed by one compromised node. The centre cell is
displaced and rotated 12°; its orthogonal neighbours are pushed 4px outward, the
corners 2px. Displacement and colour both decay with distance from the source —
that is the blast radius, and it maps onto the severity ramp used in the product.

## Files

| File | Use |
| --- | --- |
| `forgely-lockup-stacked.svg` | Primary. Marketing site hero, docs landing, decks, print. |
| `forgely-lockup-horizontal.svg` | App headers, nav bars, README badges, anywhere vertical space is tight. |
| `forgely-lockup-horizontal-reversed.svg` | The same lockup for dark backgrounds. Background is transparent by design. |
| `forgely-lockup-horizontal-mono.svg` | Single colour, inherits `currentColor`. Engraving, stamps, one-colour print, inline SVG that should follow surrounding text colour. |
| `forgely-icon.svg` | Mark alone, full colour. Use at 32px and above. |
| `forgely-icon-small.svg` | Five-cell variant. Use below 32px — favicon, tab icon, dense table rows. |
| `forgely-icon-mono.svg` | Mark alone, `currentColor`. |
| `forgely-app-icon.svg` | 512×512 tile on signal blue. iOS/Android/PWA, GitHub org avatar. |
| `forgely-app-icon-dark.svg` | 512×512 tile on deep ink, for dark-mode icon slots. |
| `forgely-loader.svg` | Animated loader, full colour. Loading states, graph builds, scan progress. |
| `forgely-loader-reversed.svg` | Animated loader for dark backgrounds. |
| `forgely-loader-mono.svg` | Animated loader, `currentColor`. |
| `forgely-loader-small.svg` | Animated five-cell loader for use below 32px. |

All files are unitless and scale losslessly. The `width`/`height` attributes are
defaults only — override them or drop them and size with CSS.

## Palette

| Role | Hex | Meaning |
| --- | --- | --- |
| Ember | `#EF9F27` | Critical. The source node. Use sparingly — one ember per view. |
| Signal blue | `#378ADD` | Primary brand colour. Direct edges, high severity. |
| Mist | `#85B7EB` | Transitive edges, low severity, secondary surfaces. |
| Deep ink | `#0C447C` | Wordmark, dark surfaces, body text on light. |
| Tagline grey | `#6B87A3` | Tagline only. Not a brand colour. |

Signal blue on white is 3.3:1 — fine for large text and UI components, **not**
sufficient for body copy. Use deep ink for text. Ember on white is 2.0:1, so never
set text in it; it is a fill colour for shapes and indicators only.

## Rules

**Clear space.** Keep one grid cell (25% of the mark's width) free on all sides of
any lockup. Nothing else enters that band.

**Minimum sizes.** Stacked lockup: 120px wide. Horizontal lockup: 140px wide. Full
mark: 32px. Below 32px, switch to `forgely-icon-small.svg`.

**The rotation is not decoration.** It is what makes the centre cell read as
displaced rather than merely a different colour. Do not straighten it in any
cleanup, redraw, or animation resting state.

**Don't.** Recolour the ember cell. Add a stroke, shadow, gradient, or glow.
Rearrange or add cells. Set the wordmark in another face. Change the FORGE/LY
colour split. Place the full-colour lockup on a mid-tone background — use the
reversed or mono file instead.

## Typography

The wordmark is Space Grotesk Bold (700), tracked +1px at 34px; the tagline is
Space Grotesk Medium (500), tracked +1.5px at 11px. Both are converted to outlines
in these files, so nothing needs to be installed to render them.

Space Grotesk is licensed under the SIL Open Font License 1.1, which permits
embedding outlines in a logo. If you adopt it as the product's UI face too, that is
also permitted — it is on Google Fonts.

## Still open

- Reverse-image and trademark search in the DevSecOps category before you commit.
  Grid-of-squares marks are a crowded neighbourhood; the rotation and colour ramp
  differentiate this one, but verify rather than assume.
- The tagline is `FROM ARTIFACT TO BLAST RADIUS`. Alternates considered, if you want
  to revisit: `SEE WHAT ELSE IS EXPOSED`, `WHO CAN REACH WHAT`,
  `YOUR REGISTRY AS A GRAPH`.

## The loader

One 1.8s loop: the ember cell fires, the orthogonal neighbours push outward 100ms
later, the corners follow at 220ms and brighten as the ripple reaches them.

The direction is the point. Motion always propagates **outward from the centre** —
that is what blast radius means. Never animate it inward, and never animate the
cells independently or in a rotating sequence; both turn a meaningful mark into a
generic spinner.

Animation is CSS inside the file, so it plays in an `<img>` tag, as a CSS
`background-image`, or inlined. Nothing to import and no JS. `prefers-reduced-motion:
reduce` freezes the mark at rest with the corners at full opacity, so the file stays
usable as a static logo for anyone who has asked their OS for less movement.

Use it for work that is genuinely graph-shaped — resolving a dependency tree,
computing reachability, running a scan. For a trivial 200ms spinner it is too much
personality; use a plain spinner there and keep this one meaningful.
