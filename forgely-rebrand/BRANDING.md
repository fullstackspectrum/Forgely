# Forgely — product design specification

Version 1.0 · For engineering, design, and content

This document translates the Forgely identity into buildable rules. It is written to
be handed to a developer or an AI coding agent and acted on directly. Where a value
is stated, use that value. Where a rule is stated as **must**, treat it as a
constraint, not a preference.

Companion files:

| File | Purpose |
| --- | --- |
| `forgely-tokens.css` | The tokens below as CSS custom properties. Import once, build against the semantic layer. |
| `forgely-lockup-*.svg` | Logo lockups. |
| `forgely-icon-*.svg` | Mark alone. |
| `forgely-app-icon*.svg` | 512×512 tiles. |
| `forgely-loader*.svg` | Animated loaders. |
| `README.md` | Logo usage rules and clear-space requirements. |

---

## 1. The idea, and why it constrains the UI

The mark is a nine-cell grid disturbed by one compromised node. The centre cell is
displaced and rotated; its neighbours are pushed outward; the corners barely move.
Displacement decays with distance from the source.

That is not a decorative story. It is the product's core claim: **you found one
thing, and Forgely shows you everything it touches.** Every interface decision below
follows from it.

Three consequences that the app must honour:

**One origin per view.** The user is always investigating *something* — a package, a
CVE, an identity, a role. That thing is the ember cell. It is marked in amber, it is
tilted, and there is exactly one of it on screen. If your UI has three amber things
in it, the metaphor is dead and so is the colour's meaning.

**Distance and severity are different axes.** A package two hops away can be
critical; a directly imported package can be harmless. Encoding both with one colour
ramp destroys the product's main insight. Blue encodes *distance from the origin*.
Red-to-gold encodes *severity*. They never swap and they never blend.

**Motion propagates outward.** Anything that animates in response to a selection
moves away from the origin, never toward it, never in a circle. This applies to the
loader, to graph expansion, to list reveals, and to skeleton states.

---

## 2. Colour

### 2.1 Brand core

| Token | Hex | Role |
| --- | --- | --- |
| Ember | `#EF9F27` | The origin. The thing under investigation. Never a severity, never a button. |
| Signal blue | `#378ADD` | Brand colour. Direct edges, hop-1 nodes, chart primaries. |
| Mist | `#85B7EB` | Transitive edges, distant nodes, secondary fills. |
| Deep ink | `#0C447C` | Wordmark, headings, dark surfaces. |

### 2.2 Ramps

Full ramps are in `forgely-tokens.css`. The shape of each:

- **Blue** `--fg-blue-50` → `--fg-blue-900`. Signal blue sits at 400, Mist at 200,
  Deep ink at 700. Interactive elements use 600, not 400 — see the contrast note below.
- **Amber** `--fg-amber-100` → `--fg-amber-600`. Ember at 400. This ramp exists for
  origin states and nothing else.
- **Neutral** `--fg-n-0` → `--fg-n-950`. Blue-tinted slate. **Never use a pure grey**
  (`#808080`, Tailwind's `gray-*`) anywhere in the product — it reads as dirty next to
  the blue ramp. If you use Tailwind, map `slate` or override `gray` entirely.

### 2.3 Contrast — verified figures

These are measured, not estimated. Ratios against white unless stated.

| Colour | On white | Verdict |
| --- | --- | --- |
| Deep ink `#0C447C` | 9.84:1 | Body text, headings. Passes AAA. |
| Neutral 700 `#354B60` | 9.03:1 | Body text. Passes AAA. |
| Neutral 600 `#4E657D` | 6.03:1 | Secondary text. Passes AA. |
| Neutral 500 `#6B87A3` | 3.74:1 | **Large text only** (≥18.66px bold / ≥24px regular). Fails AA for body. |
| Signal blue `#378ADD` | 3.59:1 | **Non-text only** — borders, icons, graph fills, chart series. Fails AA for text. |
| Blue 600 `#1B5FA5` | 6.51:1 | Links, buttons, focus rings. Passes AA. White text on it passes at 6.51:1. |
| Ember `#EF9F27` | 2.17:1 | **Never set text in this colour, and never put white text on it.** Fill only. |

Two hard consequences:

**Signal blue is not a text or button colour.** White on `#378ADD` is 3.59:1, which
fails AA for anything under 18.66px bold. Primary buttons use `--c-action`
(`#1B5FA5`). Signal blue remains the brand colour and dominates the graph canvas,
where it's a fill and the rule doesn't apply.

**Ember never carries text.** For amber badges and labels, use `--c-origin-subtle`
as the background with `--c-origin-text` (`#9A5E0F`, 5.6:1) for the label.

Dark mode figures on `--fg-n-900` (`#12202E`): Mist 7.84:1, Ember 7.59:1, Blue 300
5.92:1, Neutral 300 9.30:1, Neutral 400 5.88:1. All pass AA. The dark severity
values are lightened specifically to clear 4.5:1 on both `--fg-n-900` and the raised
surface `--fg-n-800`.

### 2.4 Severity scale

Severity is a property of a finding. It uses a red-to-gold ramp that deliberately
avoids Ember's hue.

| Level | Light | Dark | On white |
| --- | --- | --- | --- |
| Critical | `#B3261E` | `#E8756B` | 6.54:1 |
| High | `#C4451F` | `#F08A5A` | 4.98:1 |
| Medium | `#8A6410` | `#D9B65C` | 5.37:1 |
| Low | `#4E657D` | `#8B9CAF` | 6.03:1 |
| None / Info | `#8B9CAF` | `#6B87A3` | 2.81:1 — background/icon only |

**Severity must never be communicated by colour alone.** High (`#C4451F`) and Ember
(`#EF9F27`) are adjacent hues, and roughly 1 in 12 men has some form of red-green
colour vision deficiency — a substantial slice of your DevOps audience. Every
severity indicator carries a text label or, where space forbids, a distinct shape:

- Critical — filled circle
- High — filled triangle
- Medium — filled square
- Low — hollow circle
- None — hollow square, or omit

Severity badges use the `-bg` background token with the severity colour as text and a
1px border at the same colour. Never a solid severity fill with white text, except
Critical, which passes at 6.54:1 and may be solid when you need one thing to shout.

### 2.5 Graph distance

Distance from the origin is the *other* axis, and it is blue.

| Hop | Token | Colour |
| --- | --- | --- |
| 0 — the origin | `--g-hop-0` | Ember `#EF9F27` |
| 1 — direct | `--g-hop-1` | Signal `#378ADD` |
| 2 | `--g-hop-2` | Blue 300 `#5C9FE4` |
| 3 | `--g-hop-3` | Mist `#85B7EB` |
| 4+ | `--g-hop-far` | Neutral 300 `#B6C4D3` |

Beyond four hops, stop encoding distance — the ramp runs out of legible steps and the
information stops being actionable. Collapse everything further into `--g-hop-far` and
let the user expand from a new origin instead.

Edges: `--g-edge-direct` (Signal, 2px) for a declared dependency or a directly
attached policy. `--g-edge-transitive` (Mist, 1.5px) for anything inherited.
`--g-edge-muted` for structural edges the user isn't currently tracing.

**The rule that matters:** never colour a node by severity and by hop distance at the
same time. Pick one for fill and give the other a ring, a badge, or a stroke. The
default should be fill = hop distance, ring = severity, since the graph's job is
showing reach.

---

## 3. Typography

| Role | Face | Weight | Use |
| --- | --- | --- | --- |
| Display | Space Grotesk | 700 | Page titles, section headers, empty-state headlines, numerals in stat blocks. |
| Body / UI | Inter | 400 / 500 / 600 | Everything else. Labels, tables, prose, buttons. |
| Mono | JetBrains Mono | 400 / 500 | Package names, versions, digests, ARNs, role names, CVE IDs, paths, any string the user might copy. |

Space Grotesk is the wordmark face; using it for headings ties the product to the
identity. It is not a UI face — its wide apertures and quirky glyphs get tiring in
dense tables. Keep it above 18px and out of body copy.

The mono rule is not cosmetic. In a supply-chain tool, users compare strings that
differ by one character (`1.2.11` vs `1.2.1`, two similar role ARNs). Proportional
type makes that comparison harder. **Any identifier renders in mono.**

Scale: 11 / 12 / 13 / 15 / 18 / 22 / 28 / 36 / 48. Body default is 15px at 1.55
line-height. Table cells 13px at 1.45. Never go below 11px, and 11px is for labels
only, never prose.

Tracking: Space Grotesk at display sizes takes `-0.01em`. The tagline and any all-caps
eyebrow label takes `+0.08em`. Inter needs no tracking adjustment.

**Sentence case everywhere** — buttons, headers, table columns, menu items, empty
states. The only Title Case or ALL CAPS in the product is the wordmark and the tagline.

---

## 4. Shape and space

The logo's grid gives the geometry: 26px cells with a 6px radius, spaced on a 4px
rhythm.

- **Base unit: 4px.** All spacing is a multiple: 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius: 6px** is the default for cards, inputs, buttons, badges, and graph nodes.
  4px for small chips, 10px for modals and panels, 14px for large surfaces. The
  proportion matters — 6 on 26 is roughly 23%, so scale radius with the element
  rather than applying 6px to everything regardless of size.
- **Borders: 1px**, `--c-border`. Two-pixel borders only for focus and selection.
- **Elevation: use borders and background steps, not shadows.** The identity is flat
  geometric shapes; drop shadows fight it. Modals and popovers may take one soft
  shadow (`0 8px 24px rgba(12,32,54,0.12)`) because they need to detach from context.
  Cards, panels, and table rows may not.

### The displacement motif

You have one signature device: a tilted, offset element among aligned ones. Spend it
carefully. Legitimate uses:

- The origin node in the graph, tilted 12°.
- The empty-state illustration — a grid with one cell knocked out of line.
- The loader.
- A 404 or error page.

Illegitimate uses: tilting cards on hover, decorative rotated shapes in the marketing
site background, animating every list item into place. The rule is that a tilt means
*this specific thing is the disturbance*. If it means nothing, remove it.

---

## 5. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--fg-dur-instant` | 90ms | Hover, active, colour changes. |
| `--fg-dur-fast` | 160ms | Tooltips, dropdowns, checkbox states. |
| `--fg-dur-base` | 240ms | Panels, drawers, tab changes, node selection. |
| `--fg-dur-slow` | 400ms | Modals, page transitions, graph re-layout. |
| `--fg-dur-ripple` | 1800ms | The loader loop. |
| `--fg-stagger` | 110ms | Delay between graph rings when a ripple propagates. |

Easing: `--fg-ease` for most things. `--fg-ease-out` for anything entering.

**Propagation is directional.** When a user selects a node, the highlight travels
outward hop by hop with `--fg-stagger` between rings. It takes about 340ms to reach
hop 3, which is fast enough not to feel slow and slow enough to be legible — the user
literally watches the blast radius spread. This is the product's signature moment and
it is worth building properly.

Do not: animate the ripple inward, animate hops simultaneously, loop the propagation,
or rotate anything continuously.

`prefers-reduced-motion: reduce` sets every duration to 1ms and the stagger to 0. The
ripple becomes an instant state change; the loader freezes into the static mark. Both
remain fully functional. This is already handled in the token file and in the loader
SVGs.

---

## 6. Graph canvas

The canvas is the product. Everything else is chrome.

**Node sizing** encodes weight — download count, number of dependents, number of
attached permissions — not severity and not distance. Three sizes: 8px, 12px, 18px
diameter. More than three sizes stops being readable at graph scale.

**Node stroke** is 1.5px in `--g-node-stroke` (the canvas background colour), which
separates overlapping nodes without adding a visual layer. Severity, when shown on a
node, is a 2px outer ring in the severity colour.

**The origin node** is 22px, ember-filled, rotated 12°, and rendered as a rounded
square rather than a circle — shape distinguishes it even in greyscale.

**Canvas background** is `--g-canvas` (`#F5F8FB` light, `#0A1622` dark), not white.
Nodes need a surface to sit on, and pure white makes Mist nodes disappear.

**Labels** appear on hover and on the origin permanently. Showing every label at every
zoom is the single most common way graph UIs become unusable. Below a threshold, show
labels for the origin and hop-1 only.

**Dimming** is how you show a traced path: non-path nodes drop to 25% opacity rather
than changing colour. Colour changes break the distance encoding; opacity doesn't.

**Empty graph** is not an error. If an artifact has no dependents and no exposure, say
so plainly and make it feel like a good result, because it is.

---

## 7. Components

**Buttons.** Primary: `--c-action` fill, white text, 6px radius, 36px height, 15px
Inter 500. Secondary: transparent, `--c-border-strong` border, `--t-primary` text.
Tertiary: text only in `--c-link`. Destructive: `--s-critical` fill, white text —
this is the only place a severity colour is used for an action, and it is justified
because the action's consequence *is* the severity.

**Focus.** 2px `--c-focus` ring at 2px offset, on every interactive element, always
visible on keyboard focus. Never remove the outline without replacing it.

**Tables** are where security teams live. 13px, 44px rows, 1px `--c-border` between
rows, no zebra striping (it fights severity backgrounds). Severity is the leftmost
column after the identifier. Identifiers in mono. Sortable columns by default —
assume the user wants to sort by severity, then by dependent count.

**Loading.** Skeleton blocks for known layouts. `forgely-loader.svg` for genuinely
graph-shaped work — resolving a tree, computing reachability, running a scan — where
the wait is over one second. For anything shorter, a plain spinner or nothing at all.
Overusing the branded loader turns a signal into wallpaper.

**Empty states** get a Space Grotesk headline, one line of body, and one action. Use
the displacement motif in the illustration. Empty is an invitation, not an apology.

**Errors** state what happened and what to do next, in the interface's voice. Never
apologise, never blame the user, never say "something went wrong". "Couldn't reach the
Cloudsmith API — check the repository token in Settings" beats any amount of sorry.

---

## 8. Voice

Forgely talks like a competent colleague who has already looked at the problem.

**Name things by what the user controls**, not how the system works. "Repositories",
not "sync targets". "Access paths", not "IAM edge traversal results".

**Lead with consequence, not classification.** "Affects 14 services" is more useful
than "CVSS 9.1". Show both — lead with the first.

**Active voice, present tense.** "Forgely found 3 paths", not "3 paths were
identified".

**Don't inflate.** Security tooling has a bad habit of shouting. If everything is
urgent, nothing is. Reserve alarming language for genuinely alarming findings, and let
the severity system carry the weight the rest of the time.

**Be specific about uncertainty.** If reachability is inferred rather than proven, say
so. Trust is the whole product; overclaiming costs more than it gains.

---

## 9. Rebrand checklist

Roughly in dependency order.

1. Drop `forgely-tokens.css` in and import it at the root. Set `data-theme` on `<html>`.
2. Replace every hardcoded colour with a semantic token. Grep for `#`, `rgb(`, and any
   Tailwind `gray-`/`blue-` class. This is the bulk of the work and everything else
   depends on it.
3. Swap logo assets: nav (horizontal lockup), favicon (`forgely-icon-small.svg`),
   app icon, loading screens, README, email templates, error pages.
4. Load the three fonts. Self-host, `font-display: swap`, subset to Latin.
5. Apply the type scale and the mono rule for identifiers. The mono pass is worth
   doing carefully — it's the highest-value readability change in the list.
6. Rework the graph canvas: hop-distance fills, severity rings, origin node treatment,
   node sizing, dimming behaviour.
7. Build the outward propagation animation on node selection.
8. Replace loading states. Branded loader only where the wait is graph-shaped and over
   a second.
9. Audit severity indicators for the shape-plus-label rule.
10. Pass over copy: sentence case, active voice, error and empty states.
11. Accessibility pass: focus rings, contrast against the verified table above, keyboard
    traversal of the graph, `prefers-reduced-motion`.

### Verify before you call it done

- No pure greys anywhere.
- No white text on Signal blue or Ember.
- Exactly one ember element per view.
- Severity never communicated by colour alone.
- Every identifier in mono.
- Focus visible on every interactive element.
- Graph readable in greyscale — take a screenshot, desaturate it, check you can still
  find the origin and read severity.

---

## 10. Open questions for the team

- **Does the graph need a colour-blind mode?** The shape-plus-label rule should make one
  unnecessary, but test with users before assuming.
- **What happens above ~500 nodes?** The hop ramp and node sizing are specified for
  legible graphs. Large-graph behaviour — clustering, aggregation, level-of-detail — is
  a product question this document doesn't answer.
- **Is Ember ever allowed a second instance?** Comparing two origins side by side is a
  plausible feature that would break the one-ember rule. If you build it, split the
  canvas rather than putting two ember nodes in one space.
- **Trademark clearance** in Nice classes 9 and 42 remains unverified beyond an image
  search. Worth closing before a public launch.
