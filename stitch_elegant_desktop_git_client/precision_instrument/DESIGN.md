---
name: Precision Instrument
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3f4850'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#712ae2'
  on-secondary: '#ffffff'
  secondary-container: '#8a4cfc'
  on-secondary-container: '#fffbff'
  tertiary: '#006b2c'
  on-tertiary: '#ffffff'
  tertiary-container: '#00873a'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#eaddff'
  secondary-fixed-dim: '#d2bbff'
  on-secondary-fixed: '#25005a'
  on-secondary-fixed-variant: '#5a00c6'
  tertiary-fixed: '#7ffc97'
  tertiary-fixed-dim: '#62df7d'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005320'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.005em
  title-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  label-md:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Geist
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  code-sha:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system defines an ultra-refined, professional, and razor-sharp desktop development interface. Created for developers, engineering leads, and technical contributors who spend hours managing complex source control workflows, the interface balances technical density with exceptional visual clarity.

The visual direction marries high-end desktop application engineering with modern minimalist Scandinavian software design:
- **Tone:** Methodical, surgical, silent, and effortlessly fast.
- **Aesthetic Movement:** Modern Desktop Utility with subtle glass/vibrancy hints, hairline delineation, and disciplined optical weight.
- **Atmosphere:** A tranquil, distraction-free environment where Git operations (merges, rebase graphs, diffs, conflicts) feel tangible, safe, and precise. Visual noise is aggressively eliminated; color is reserved strictly for semantic state, code status, and branch topology.

## Colors

The color palette relies on high-luminance canvas neutrals structured to prevent eye fatigue while offering unmistakable contrast across branch topologies, diff views, and operational tooling.

### Color Architecture
- **Surface Hierarchy:**
  - `background`: `#ffffff` (Primary panels, active commit view, focused diff pane)
  - `surface-canvas`: `#f8fafc` (Application frame, sidebars, activity bars, inactive panels)
  - `surface-container`: `#f1f5f9` (Subtle toolbars, table headers, inspect panels)
  - `surface-elevated`: `#ffffff` (Context menus, dropdown popovers, modal sheets)
- **Borders & Delineation:**
  - `border-subtle`: `#f1f5f9` (Internal module subdivisions)
  - `border-default`: `#e2e8f0` (Standard panel dividers, input borders, column separators)
  - `border-strong`: `#cbd5e1` (Interactive borders, active splitters, focused boundaries)
- **Primary & Interactive:**
  - `primary`: `#0284c7` (Electric cyan-blue for primary CTAs, active branch badge, focus rings)
  - `primary-hover`: `#0369a1`
  - `primary-tint`: `#f0f9ff` (Active selection fills, selected commit item)
- **Git Semantics & Topology:**
  - `git-addition`: `#16a34a` (Diff additions, staged status, clean working tree)
  - `git-addition-bg`: `#f0fdf4` (Diff line insertion background)
  - `git-deletion`: `#dc2626` (Diff deletions, merge conflicts, detached HEAD)
  - `git-deletion-bg`: `#fef2f2` (Diff line deletion background)
  - `git-warning`: `#d97706` (Uncommitted changes, dirty working directory, stash highlights)
  - `git-branch-merge`: `#7c3aed` (Merge commits, feature branch traces, pull request integration)
  - `git-branch-remote`: `#ea580c` (Remote tracking branches, upstream pointers)

## Typography

Typography prioritizes information density, scanning rhythm, and legibility at compact desktop scales. 

- **Geist** serves as the primary system UI font. Its mechanical precision, low stroke contrast, and neutral apertures anchor high-density UI trees, toolbars, sidebar navigations, and commit meta.
- **JetBrains Mono** powers all source code elements: diff comparison views, commit hashes (SHAs), branch reference tags, and terminal outputs. It features tabular figures by default to align character coordinates horizontally across dual-pane diffs.
- **Line Heights:** Compact ratios (1.25 to 1.5) maintain high vertical screen efficiency without sacrificing individual line scanning.

## Layout & Spacing

The layout is built upon an adjustable multi-pane workbench layout typical of desktop professional tools, grounded on an 8px base module with a sub-unit 4px step.

### Desktop Split-Pane Architecture
- **Window Frame:** Native title bar integration with custom window controls or integrated compact toolbar (height: 38px–42px).
- **Navigation Sidebar (Left):** 220px default width (collapsible to 48px icon rail; min 180px, max 360px). Holds repositories, branches, stashes, tags, and worktrees.
- **Commit History & Graph (Center):** Fluid width, minimum 320px. Displays graph nodes, commit summaries, authors, and dates.
- **Inspector / Diff View (Right):** Fluid or side-by-side split. Minimum 400px. Unified or split diff inspector with syntax-highlighted staging controls.

### Density & Compactness
- In desktop density mode, compact vertical padding (`space-xs` to `space-sm`) is enforced across tree items and commit rows to maximize visible history lines per viewport.
- Section gutters and outer margins avoid excessive decorative white space, maintaining an authentic workstation layout.

## Elevation & Depth

This system intentionally departs from heavy, muddy shadows in favor of hair-thin boundary definition, low-opacity ambient occlusion, and subtle surface luminescence.

### Elevation Levels
- **Level 0 (Canvas Base):** Flat `#f8fafc` application shell without drop shadow.
- **Level 1 (Docked Panes & Cards):** Flat `#ffffff` backed by a 1px crisp border `rgba(226, 232, 240, 1.0)`. No shadow. Structural depth is communicated exclusively through tonal boundary shifts.
- **Level 2 (Dropdowns, Branch Selectors, Autocomplete):**
  - Border: 1px solid `rgba(203, 213, 225, 0.8)`
  - Shadow: `0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -1px rgba(15, 23, 42, 0.04)`
- **Level 3 (Modal Sheets, Conflict Resolution Dialogs):**
  - Border: 1px solid `rgba(203, 213, 225, 1.0)`
  - Shadow: `0 16px 32px -6px rgba(15, 23, 42, 0.1), 0 4px 12px -2px rgba(15, 23, 42, 0.05)`
  - Backdrop: `rgba(15, 23, 42, 0.25)` blur (4px).

### Optical Borders
All floating panels use a dual-layer inner border technique: an exterior 1px structural stroke paired with a subtle `inset 0 1px 0 rgba(255, 255, 255, 0.8)` top highlight to replicate an authentic tactile desktop edge.

## Shapes

The design system adopts a disciplined, compact shape language (`roundedness: 1`, soft geometry) that respects the structural nature of developer tooling.

- **Standard Buttons, Form Inputs, & Tree Rows:** 4px (`0.25rem`) border radius. This keeps elements dense, stackable, and visually clean.
- **Cards, Popovers, & Panes:** 8px (`0.5rem`, `rounded-lg`) border radius for modular floating surfaces.
- **Branch Badges & Commit SHAs:** 4px (`0.25rem`) for compact tags, maintaining architectural alignment with monospace code blocks.
- **Circular Indicators:** Reserved exclusively for status pips (staged/unstaged markers, author avatars, and git branch graph nodes).

## Components

### Buttons
- **Primary:** Background `#0284c7`, text `#ffffff`, border 1px solid `#0369a1`. Hover: `#0369a1`. Active: `#075985`. Height: 28px (compact) or 32px (standard). Padding: 0 10px.
- **Secondary / Ghost:** Background `#ffffff`, text `#334155`, border 1px solid `#e2e8f0`. Hover: `#f8fafc` with border `#cbd5e1`.
- **Destructive (Discard / Force Push):** Background `#fef2f2`, text `#dc2626`, border 1px solid `#fecaca`. Hover: `#fee2e2`.
- **Icon Action Buttons (Toolbar):** 28x28px, background transparent, border none. Hover: `#f1f5f9`.

### Badges & Branch Chips
- **Branch Reference (Local):** Background `#f1f5f9`, border 1px solid `#e2e8f0`, text `#1e293b`. Font: `code-sm`. Left accessory: Branch icon in `#64748b`.
- **Branch Reference (Remote):** Background `#fff7ed`, border 1px solid `#ffedd5`, text `#c2410c`.
- **Commit SHA Chip:** Monospace, background `#f8fafc`, border 1px solid `#e2e8f0`, text `#475569`, padding `1px 4px`, rounded 3px.

### Diff Viewer & Line States
- **Added Line:** Background `#f0fdf4`, gutter background `#dcfce7`, text `#14532d`. Gutter symbol `+` in `#16a34a`.
- **Deleted Line:** Background `#fef2f2`, gutter background `#fee2e2`, text `#7f1d1d`. Gutter symbol `-` in `#dc2626`.
- **Hunk Header:** Background `#f8fafc`, text `#64748b`, border-y 1px solid `#e2e8f0`. Font: `code-sm`.

### Commit Graph & History Tree
- **Row Anatomy:** Height 28px. Alternating zebra striping is omitted; hover creates a `#f8fafc` row highlight. Selected row uses `#f0f9ff` with an active 2px left border accent in `#0284c7`.
- **Graph Nodes:** 6px filled circles connected by 1.5px continuous Bézier curves. Color assignments cycle dynamically through semantic branch hues (`#0284c7`, `#7c3aed`, `#16a34a`, `#ea580c`).

### Form Controls & Inputs
- **Text & Commit Message Input:** Background `#ffffff`, border 1px solid `#cbd5e1`, font `body-md` (commit summary) and `code-sm` (extended description). Focus: border `#0284c7`, box-shadow `0 0 0 2px rgba(2, 132, 199, 0.15)`.
- **Checkboxes (Staging list):** 14x14px, rounded 3px. Unchecked: border 1.5px solid `#94a3b8`, background `#ffffff`. Checked: background `#0284c7`, border `#0284c7`, white checkmark glyph.