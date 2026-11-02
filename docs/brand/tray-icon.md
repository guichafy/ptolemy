# Menu bar icon

Asset: `src/bun/tray-icon.png`.

Generated with GPT Images using the built-in image generation tool, with transparent background enabled. The PNG's alpha is preserved and macOS tints it as a template image. The 22-point square canvas renders an approximately 18-point circular glyph; the status-item slot stays 28 points wide.

The mark deliberately omits the original hanging loop and dense mechanical rings to keep the astrolabe legible beside native menu bar symbols.

## Generation prompt

```text
Create one production-ready macOS menu bar template icon for Ptolemy, inspired by an astrolabe. This is a tiny 18-point monochrome status-bar glyph, NOT an app icon tile or an illustration. Design a very simplified, distinctive astrolabe silhouette: one bold circular outer rim, a single diagonal alidade/pointing bar with rounded ends, a small central pivot, and at most one short inner arc. Omit the hanging loop, crosshair grid, extra concentric rings, and fine mechanical details. Favor strong geometric construction, generous clear gaps and a consistent medium-bold stroke that stays crisp and recognizable when scaled to 18 pixels, harmonizing with native macOS menu bar symbols. Square composition, optically centered, occupying about 84 percent of the canvas with even transparent margins. Pure solid BLACK opaque glyph on a genuinely TRANSPARENT background. Empty interiors between strokes must also be transparent. Perfectly clean flat edges; no gray fills, shadows, gradients, texture, glow, distress, lettering, numerals, watermark, background rectangle, mockup, border tile, or multiple options. Output only the single isolated icon.
```

## Native previews

AppKit template rendering at 2×, with the production 22-point canvas and a 28-point menu slot:

![Light menu bar](tray-preview-light.png)

![Dark menu bar](tray-preview-dark.png)
