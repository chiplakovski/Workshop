# Varmak Workshop — Design System

Every value below is read from the built application, not designed on paper. Enough to rebuild the
look on another platform.

Three themes ship. A single attribute on the root element switches all of them —
`data-theme="carbon"`, `data-theme="iris"`, or nothing at all for Navy — and the choice is stored
under the `varmak.theme` key and applied before first paint, so there is no flash of the wrong
theme.

| Theme | Idea | Ground |
|---|---|---|
| **Navy** (default) | The workshop at night. Deep blue, blue sparks. | dark |
| **Carbon** | Near-black, dimmed, white-hot sparks. Colder and quieter than Navy. | dark |
| **Iris** | Daylight. White panels, indigo accent, dark text. | light |

---

## 1. The shape language — get this right first

**Nothing is rounded.** Across all 16 pages there are eight non-zero `border-radius` declarations
in total; everything else is square. Panels, buttons, inputs, chips, cards, dialogs, tags — all
sharp. It is the single most recognisable thing about the interface, and the fastest way to make a
rebuild look wrong is to accept a platform's default rounded corners.

**Set the global corner radius to 0** before styling anything else.

Other structural habits:
- **Borders, not shadows,** separate things. One hairline at low opacity.
- **Surfaces are raised by tint,** not by a drop shadow. Shadows appear only on things that float
  above the page — dialogs, dropdowns, tooltips.
- **Uppercase micro-labels** with wide letter-spacing mark section headings and table columns.
- **Generous line-height** in body copy (1.5–1.65), tight in headings (1.03–1.35).

## 2. Typography

Each theme has its own pair. Headings carry the character; body stays neutral.

| Theme | Heading | Body |
|---|---|---|
| Navy | **Sora** 400/500/600/700 | **Inter** 400/500/600 |
| Carbon | **Space Grotesk** 500/600/700 | **IBM Plex Sans** 400/500/600 |
| Iris | **Public Sans** 400/500/600/700 | **Public Sans** (same family both roles) |

All from Google Fonts.

**The type scale** is shared by every theme and every desktop page:

| Role | Size |
|---|---|
| Page title | 22 px |
| Line under the title | 12 px |
| Section heading (uppercase, letter-spacing .09em, accent colour, 700) | 11 px |
| Table column heading (uppercase, letter-spacing .07em) | 9.5 px |
| Table cell | 12.5 px |
| Form label | 11 px |
| Form input | 13 px |
| Button | 11.5–12.5 px |
| Body / description | 13 px |
| Fine print, disclaimers | 10.5 px |

The interface is deliberately small and dense — this is a working tool viewed at a desk, not a
marketing page.

## 3. Colour

### Read this before copying the values

The token names in the codebase are **historical, not semantic**. `--navy-950` is the app
background — and in Iris it is `#f1f3fb`, nearly white. Do not carry those names across. Rename to
roles as you go:

| Old name | Rename to |
|---|---|
| `--navy-950` | `surface-app` |
| `--navy-900` | `surface-panel` |
| `--navy-800` | `surface-raised` |
| `--ice` | `text-primary` |
| `--steel-300` | `text-secondary` |
| `--steel-400` | `text-muted` |
| `--spark` | `accent` |
| `--line` | `border-hairline` |
| `--field-line` | `border-field` |

### The palette

| Role | Navy | Carbon | Iris |
|---|---|---|---|
| **Surfaces** |
| App background | `#04101f` | `#020305` | `#f1f3fb` |
| Panel / card | `#071a33` | `#06080c` | `#ffffff` |
| Raised surface / field | `#0a2447` | `#0a0d13` | `#e9edf9` |
| Inset / sunken | `rgba(0,0,0,.14)` | `rgba(0,0,0,.14)` | `#e9edf9` |
| **Text** |
| Primary | `#e8f0fb` | `#f2f5fa` | `#191d3d` |
| Secondary | `#b9c6da` | `#c6cedb` | `#4e5573` |
| Muted | `#8ea3c0` | `#a3adbd` | `#5f6889` |
| **Accent & brand** |
| Accent | `#4a90ff` | `#4f8cff` | `#4b49ac` |
| Accent 2 (gradient top) | `#2c6bd6` | `#2f6ccc` | `#7978e9` |
| Brand / gradient bottom | `#013179` | `#16326a` | `#4b49ac` |
| Text on accent | `#ffffff` | `#ffffff` | `#2e2c86` |
| **Lines** |
| Hairline | `rgba(142,163,192,.16)` | `rgba(135,146,163,.16)` | `rgba(75,73,172,.16)` |
| Input border | `rgba(185,198,218,.24)` | `rgba(170,180,196,.24)` | `rgba(75,73,172,.24)` |
| **Status — the fill** |
| Success | `#4ad48a` | `#35c98a` | `#0f7a58` |
| Warning | `#ffb057` | `#f0a544` | `#a35f0e` |
| Danger | `#ff6b6b` | `#f4635f` | `#e0555b` |
| Idea / purple | `#c084fc` | `#b07cf5` | `#a35f0e` |
| **Status — the text** |
| On success | `#6ee38c` | `#6ee38c` | `#0b6b4d` |
| On warning | `#ffd9a6` | `#ffd9a6` | `#7a4f10` |
| On danger | `#ffb3b3` | `#ffb3b3` | `#c0343b` |
| On info | `#89baff` | `#89baff` | `#3b39a0` |
| **Navigation** |
| Active item background | accent @ 35% | accent @ 35% | `#4b49ac` |
| Active item text | `#e8f0fb` | `#f2f5fa` | `#ffffff` |
| Avatar ground | `#16385b` | `#14202e` | `#e3e6f8` |

**Why status colours come in pairs.** The fill is the saturated colour used for a dot, a bar or a
border. The *text* colour is a lighter or darker sibling used when the word sits on a tinted
background — `#ff6b6b` as text on a 12%-red panel does not read; `#ffb3b3` does. In Iris both flip:
the text sibling becomes *darker* than the fill, because the ground is white.

## 4. Elevation

Two scales, and **they invert between the dark themes and Iris**. This is the part most likely to
be got wrong.

**Lift — raising a surface off its background**

| Step | Navy / Carbon | Iris |
|---|---|---|
| `lift-03` | white @ 3% | white @ 70% |
| `lift-04` | white @ 4% | white @ 86% |
| `lift-05` | white @ 5% | `#ffffff` solid |
| `lift-06` | white @ 6% | indigo @ 5% |
| `lift-08` | white @ 8% | indigo @ 7% |
| `lift-12` | white @ 12% | indigo @ 11% |
| `lift-16` | white @ 16% | indigo @ 16% |

In the dark themes, more lift means lighter. In Iris the scale **turns over at `lift-05`**: below
it, white raises a panel off the grey page; above it, indigo tints a surface *down* to mark a
pressed, hovered or recessed state. Same token, opposite direction.

**Shade — shadows**

| Step | Navy / Carbon | Iris |
|---|---|---|
| `shade-18` | black @ 18% | indigo @ 8% |
| `shade-35` | black @ 35% | indigo @ 10% |
| `shade-45` | black @ 45% | indigo @ 13% |
| `shade-55` | black @ 55% | indigo @ 17% |

**Iris shadows are indigo, never grey or black** — and much lighter. A black shadow under a white
panel makes the interface look cheap; a 10% indigo one reads as depth.

## 5. Component recipes

Real values from the app. Every one has a 0 px corner radius.

**Panel** — the basic container
```
background: lift-035        border: 1px solid border-hairline
padding: 18px               margin-bottom: 16px
backdrop-filter: blur(10px)
```

**Panel heading**
```
Title:    11px / 700 / uppercase / letter-spacing .09em / accent colour
Subtitle: 11px / text-muted, pushed to the right of the same row
```

**Button (secondary — the default)**
```
background: transparent     border: 1px solid border-field
color: text-secondary       font: heading family / 600 / 12.5px
padding: 9px 13px
hover: border-color → accent, color → text-primary
transition: .16s
```

**Button (primary)**
```
background: linear-gradient(180deg, accent-2, brand)
border: none
color: #ffffff  ← always set this explicitly. See §6.
font-weight: 600
```

**Status chip**
```
background: <status> @ 12%   border: 1px solid <status> @ 40%
color: <status text sibling> font: 10px / 700 / uppercase / letter-spacing .08em
padding: 4px 8px
```

**Table**
```
Head: 9.5px / uppercase / letter-spacing .07em / text-muted
Cell: 12.5px / text-secondary
Row separator: 1px border-hairline. No zebra striping.
```

**Input**
```
background: field           border: 1px solid border-field
color: text-primary         font-size: 13px
padding: 9px 11px           focus: border-color → accent (no glow, no ring)
```

**Dialog**
```
Backdrop: scrim @ 62% + blur(2px)
Card: surface-raised, 1px border-field, padding 20px 22px 18px
Shadow: 0 22px 60px shade-55
Max width: 440px for a question, up to 1080px for a form
```

**Sidebar navigation, active item**
```
background: nav-active-bg   color: #ffffff
border-left: 2px solid accent
```

**Empty state**
```
centred, 12.5px, text-muted, 26px padding
```

## 6. What breaks in Iris — a checklist

Iris is the only light theme, so it is where mistakes surface. Every one of these was a real bug
found in this app:

1. **A button with no explicit `color`.** It inherits the secondary text colour and vanishes on a
   coloured gradient. The primary button must always set `color: #ffffff` itself.
2. **A colour defined only inside a dark-theme block.** It falls back to something unrelated.
3. **Status text at the fill colour.** `#0f7a58` green text on a white panel is fine; `#4ad48a` is
   not. Use the text sibling.
4. **Black shadows.** They read as dirt on a light ground. Use the indigo shade scale.
5. **An overlay tinted by opacity alone.** `rgba(255,255,255,.05)` is invisible on white. Anything
   that must be seen needs its own solid colour in Iris.
6. **Text on a coloured strip** where the strip is transparent in light and opaque in dark.

**Rule for the rebuild: check every new colour in Iris before calling it done.** If it works in
Navy and in Iris it will work in Carbon; the reverse is not true.

## 7. Atmosphere — optional, and skippable

The dark themes carry a background treatment that is decorative only:
a 64 px engineering grid at 40% opacity, radially masked so it fades at the edges; two large
radial washes in brand blue; a soft pulsing glow behind the centre; and a slow drift of small
glowing "embers" rising up the screen. In Iris all of it drops to near-invisible — grid faint,
washes at 18%, embers barely there.

None of it is functional. If a rebuild has to leave something out, leave this out; nothing depends
on it, and it costs animation frames. The flat colours above carry the identity on their own.

## 8. Setting this up on WeWeb

1. **Global corner radius to 0.** Before anything else.
2. **Load the fonts** — Sora, Inter, Space Grotesk, IBM Plex Sans, Public Sans from Google Fonts.
   If only one theme is being built, load only its pair.
3. **Create colour variables by role**, using the renamed list in §3 — not the original names.
4. **Build one theme completely before adding a second.** Navy is the default and the one users
   see first; Iris is the one that proves the token structure is right.
5. **If only two themes are affordable, build Navy and Iris**, not Navy and Carbon. Carbon is a
   variation on a dark theme; Iris is the one that catches broken tokens, and light mode is what
   an office asks for.
6. **Set the type scale as text styles**, so a size change is one edit rather than sixteen pages.
7. **Check every screen in Iris** against §6 before signing it off.
