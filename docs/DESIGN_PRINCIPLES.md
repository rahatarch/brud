# Brud Code Design Principles

These rules apply to ALL UI surfaces: landing pages, webviews, documentation sites, and marketing pages.
The target aesthetic is professional, world-class design — think Stripe, Linear, Mintlify.
The goal is to look intentional, restrained, and premium — never generic, never AI-generated.

## Color Rules

### Rule 1: Never use "lighter background + deeper shade as border"

Do NOT use this pattern:
- Light gray background (#F5F5F5) with darker gray border (#CCCCCC)
- Light blue background with darker blue border
- Any solid fill with a darker shade of the same color as its border

This pattern is the hallmark of generic, dated UI. Avoid it entirely.

### Rule 2: Borders should be near-invisible

- Borders should be subtle, not structural
- Use very low contrast borders (`#E7E5E4` on white, `#241E21` on dark)
- If the border is doing more work than the content, it's wrong

### Rule 3: Contrast through background, not borders

- If you need to differentiate surfaces, use a subtle background shift
- Not a border
- Not a shadow
- Just a slight lift in the surface color

## Shadow Rules

### Rule 4: Shadows should be felt, not seen

- Shadows should implement impact without being visibly noticeable
- They should create depth, not decoration
- If you can "see" the shadow, it's too strong
- Use multiple layered shadows with low opacity for realism

## Spacing Rules

### Rule 5: Generous whitespace everywhere

- Section padding: minimum 80px vertical (desktop)
- Card padding: minimum 24px
- Component spacing: minimum 16px between distinct elements
- If it feels tight, it IS tight — add more space

### Rule 6: Padding matters more than you think

- Err on the side of too much padding
- Text should never feel cramped
- Containers should breathe
- Density is not a virtue in marketing UI

## Content Rules

### Rule 7: No unnecessary decorative elements

- A card contains: Icon, Title, Description
- That's it
- Do NOT add: section labels, code-like identifiers, decorative numbering, badge text, mock version strings, file paths, or any similar filler
- Do NOT add things like "akkhar-architecture-1" or "v2.3.1" in corners
- If it doesn't serve a purpose, remove it

### Rule 8: No filler text

- If a section doesn't have meaningful content, delete the section
- No "Lorem ipsum"
- No placeholder copy
- No meta-labels ("Features", "Benefits", "Why Us") unless they add real value

## Table & List Rules

### Rule 9: No hard divider lines

- Tables should NOT have hard visible row separators
- Lists should NOT have bordered items
- Use whitespace to separate
- Use a VERY light background color change on hover for interactive rows
- This is more modern and less dated

### Rule 10: Hover states should be subtle

- Hover backgrounds should be almost imperceptible (2-4% opacity shift)
- Never a hard color change
- Never a visible border addition
- Never a shadow expansion

## Typography Rules

### Rule 11: Type hierarchy must be clear

- Headline sizes should have clear jump ratios
- Body text must be readable (min 16px)
- Line height for body: 1.6 to 1.75
- Line height for headlines: 1.1 to 1.3

### Rule 12: No excessive font weights

- Use 2-3 weights max per page
- Common hierarchy:
  - Hero headline: 800 (extrabold)
  - Section headlines: 700 (bold)
  - Body: 400 (regular)
  - Buttons/emphasis: 600 (semibold)

## Layout Rules

### Rule 13: Maximum content width

- Content should have a max-width (typically 1120px to 1280px)
- Never full-bleed text on wide screens
- Center the content container

### Rule 14: Align to a grid

- Use a consistent spacing scale (4px, 8px, 16px, 24px, 32px, 48px, 64px, 80px, 120px)
- Never arbitrary values
- Consistency creates the feeling of intent

## Anti-Patterns (Never Do These)

- ❌ Light gray backgrounds with darker gray borders on cards
- ❌ Visible box shadows
- ❌ Hard table row dividers
- ❌ Decorative code-like text in corners
- ❌ Meta-labels that add no value
- ❌ Tight spacing
- ❌ Multiple font weights beyond 3
- ❌ Placeholder content
- ❌ Section labels like "FEATURES" or "BENEFITS" unless truly needed
- ❌ Emoji as UI icons (unless intentional brand choice)
- ❌ Gradient overlays on every section
- ❌ Animated elements that distract from reading

## Reference Aesthetic

Study these products' design systems:
- **Stripe** — precision, whitespace, restrained color
- **Linear** — dark mode mastery, subtle depth, motion restraint
- **Mintlify** — typography hierarchy, doc-first clarity
- **Vercel** — monochrome confidence, hover states
- **Framer** — depth through layered surfaces, not shadows

When in doubt: **remove something**. Less is more. Restraint is premium.