// Composition theory — rule of thirds, golden ratio, visual weight,
// negative space, symmetry. The generation prompt includes these
// so Gemini creates compositions that feel intentional, not random.

export const COMPOSITION_THEORY = `
Composition theory — where you place things matters as much as what you draw:

RULE OF THIRDS — divide the frame into a 3×3 grid:
  - Place focal points at the intersections: (1/3, 1/3), (2/3, 1/3),
    (1/3, 2/3), (2/3, 2/3). These are the "power points".
  - Place horizons along the 1/3 or 2/3 lines, not the center.
  - Center placement is acceptable only for symmetric/mandala patterns.

GOLDEN RATIO (φ = 1.618):
  - Focal point at (1/φ, 1/φ) ≈ (0.618, 0.618) from the corner.
  - Spiral focal point for organic compositions.
  - Rectangle aspect ratio φ:1 is naturally pleasing.
  - When dividing space, use 0.382/0.618 (1/φ and 1-1/φ) as the split.

VISUAL WEIGHT — not all pixels have equal weight:
  - Dark areas have more weight than light areas.
  - Saturated colors have more weight than desaturated.
  - High-contrast areas have more weight than low-contrast.
  - Detail/density has more weight than empty space.
  - A balanced composition has visual weight distributed so the eye
    doesn't get stuck in one corner.

NEGATIVE SPACE — the empty area is as important as the filled area:
  - 30-50% of the frame should be "quiet" (low detail, low contrast).
  - Pure black or pure white negative space is fine — don't fill it.
  - Don't tile the frame with uniform detail — it looks like wallpaper.
  - Leave room for the eye to rest.

SYMMETRY CHOICES:
  - Bilateral (left-right mirror): formal, mandala, architectural.
  - Radial (around a center): mandala, kaleidoscope, flower.
  - n-fold rotational: 3-fold, 4-fold, 6-fold — use for geometric patterns.
  - Asymmetric: more natural, more dynamic, more interesting for organic.
  - Near-symmetry with one break: draws the eye to the break point.
  - Perfect symmetry: use only for explicitly geometric/kaleidoscopic
    patterns. Organic subjects look dead when perfectly symmetric.

DEPTH AND LAYERS:
  - Foreground (sharp, high contrast, saturated): the subject.
  - Midground (medium detail, medium contrast): context.
  - Background (soft, low contrast, desaturated): atmosphere.
  - Use depth of field via blur or contrast to separate layers.
  - Atmospheric perspective: distant objects are lighter and less saturated.

FRAMING:
  - Don't put the subject in the exact center (unless symmetric).
  - Leave more space in the direction the subject is "moving" or "looking".
  - Crop at natural points — don't cut a pattern at an awkward spot.
`;
