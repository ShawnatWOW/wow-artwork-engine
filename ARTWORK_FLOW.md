# Artwork Automation — Exact Criteria & Flow

**As deployed 2026-08-14** (10-second iteration mode). This is the complete, honest map of
what happens between "New batch" and a file landing in Jeff's Drive folder — every step,
every rule, and the exact text sent to the AI models.

---

## The flow, end to end

### Phase 1 — Designs (stills) · ~$0.03 each, ~20–40s each

1. **Plan.** A batch = 3 signs (spectacular, EON 3-pillar, EON single) × 3 options = 9 designs.
2. **Build prompts.** Deterministic templates (seeded by week + option, so runs are
   reproducible) produce TWO prompts per design: the still prompt (what the picture is)
   and the motion prompt (stored now, used later in Phase 2).
3. **Guardrail.** The still prompt is checked (no nudity + configured deny-terms) BEFORE spend.
4. **Generate.** Seedream v4 renders the still (spectacular: 4096×1132).
5. **Frame plate (stills only).** For the spectacular, ffmpeg composites the exact-perimeter
   black band + a stepped black depth onto the still. **This is the only place the frame is
   ever stamped.** This plated still is what Scott reviews AND the first frame Seedance
   animates from — so the frame enters the video as real pixels the model owns.
6. **QA.** A luma check catches black/blank renders.
7. The design lands on the dashboard for review (approve / pass / keep & explore / tweak).

### Phase 2 — Videos · one Seedance call per design, only on APPROVED designs

8. **Guardrail again** on the stored motion prompt, before the expensive spend.
9. **One Seedance 2.5 call.** Inputs, exactly:
   - `image_url` — the approved (plated) still
   - `prompt` — the stored motion prompt (full text below)
   - `duration` — **10s right now** (iteration mode; env `GEN_SPECTACULAR_DURATION_S=30`
     restores the full piece). EON pieces: 15s.
   - `resolution: 720p` · `aspect_ratio: auto` · `generate_audio: false`
   - **No end frame.** Nothing else. No stitching exists anywhere.
10. **Topaz upscale.** The fal-hosted result is upscaled 4× (~1824×504 → ~7296×2016).
    Best-effort: if it fails, the un-upscaled clip is delivered rather than losing the render.
11. **Content recovery.** If the model returned a different canvas shape, center-crop back
    to the still's true aspect.
12. **QA.** Saturation-drift measurement (warning only — Seedance colors can drain).
13. **Conform.** Exact-fit scale to delivery spec (spectacular 3840×1062). **Nothing is
    composited onto the video** — the file ships exactly as the model made it.
    (EON masters are instead sliced into each pillar's spine + face panels.)
14. **Ledger.** Exact cost recorded per row from fal's token formula + the real model string.

### Phase 3 — Ship

15. Scott approves videos → **Send to Jeff** → Google Drive upload (per-panel filenames) +
    Gmail notification + Sent-history log.

---

## The exact prompts (live now)

### Still prompt — spectacular (example: option 1, week of 2026-08-17)

> An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, symmetrical one-point perspective. Style: ultraviolet blacklight neon — trippy UV glow, vivid and electric. Composition: the picture's border IS a thick matte-black frame — flat matte-black strips run along the top edge, bottom edge, left edge and right edge of the picture, meeting at the four corners, flush with the picture's edges on all sides. Just inside those black strips the image darkens into pure matte-black depth on all four sides — a soft black inner shadow, as if the scene sits deep behind the black border — and through the opening the scene recedes into deep vivid distance. The frame is never shown as an object: no outside of it, no top or sides of any box, no ground it sits on, no room around it, no tilt or angle — the viewpoint is exactly perpendicular, centered, and cropped precisely at the frame's outer edge. The black frame is perfectly plain and flat: uniform width on all four sides, sharp square corners, a smooth matte surface — no molding, no ornament. The scene is home to an ensemble of characters: a dancing cluster of glowing neon mushrooms, an ultraviolet chameleon and a neon-striped gecko. These are the ONLY living things anywhere in the scene […] This is how the story opens: an ultraviolet chameleon and a neon-striped gecko face each other from the far left and far right edges at mid-depth, bright energy gathering around each of them, while a dancing cluster of glowing neon mushrooms watches calm and glowing from the deep middle distance; one streamer of gathered light already spills through the opening over the black frame. Whatever crosses the frame's inner edge is rendered IN FRONT of the black strips, partially covering them and casting soft shadows onto them […] High-contrast lighting […] No people, no faces, no human figures […] no text, no logos, no watermarks.

*(Style family + cast + opening tableau rotate deterministically per week/option; the frame
and containment language is identical every time.)*

### Motion prompt — spectacular (identical for every option, by design)

> Fixed camera, locked-off shot: the camera holds fixed framing for the entire clip — no dolly, no push-in, no pull-back, no zoom, no pan, no reframing. The framing of the first frame is exactly the framing of the last frame. **One single continuous take for the entire clip — no cuts, no shot changes, no new angles, no transitions of any kind, ever.** The scene comes alive in constant motion, moving freely inside the painted black frame. The characters interact with the frame — bursting out through the opening, over and past the black border toward the viewer, casting light and moving shadows onto it — and diving back into the scene. The matte-black frame running along all four outer edges of the image stays perfectly fixed for the whole clip — it never moves, bends, shrinks, detaches from the edges or fades, and nothing ever appears outside it […] The viewpoint stays outside the frame, in front of the black border, for the entire clip — it never travels through the opening into the scene. […] Smooth, premium movement — never static, never jittery. Saturation stays rich and maxed for the entire duration — colors may transform as the scene changes, but they never fade, wash out, or drift toward grey.

This is the **minimal contract** (your 2026-08-14 direction): framing locked, one take,
frame kept and interacted with, colors held — everything else is the model's choice.

---

## The criteria (what "correct" means)

| # | Criterion | Enforced by |
|---|---|---|
| 1 | Black frame flush at the perimeter, all 4 sides, the whole clip | Still prompt + plated still (frame enters as pixels) + motion prompt frame rule |
| 2 | One continuous take — zero cuts | Motion prompt (no timestamps/beats anywhere — they read as a shot list) |
| 3 | Camera never moves, never enters the scene | CAMERA_LOCK + viewpoint rule in motion prompt |
| 4 | Characters burst OVER the frame toward the viewer (the pop-out) | Still paints a crosser in front of the strips; motion prompt demands interaction |
| 5 | Nothing composited over the video | Pipeline: video plate removed (env `FRAME_PLATE_ON_VIDEO=1` = emergency revert) |
| 6 | Colors never wash out / drift grey | Constancy clause + post-hoc saturation QA warning |
| 7 | Only named non-human creatures; no people/text/logos | Still prompt + guardrail before every spend |
| 8 | Delivery: exact pixels (3840×1062; EON panels 320/1280×1920), 4K-class sharpness | Conform exact-fit + Topaz 4× |

## Current knobs & numbers

| Setting | Value now | Change via |
|---|---|---|
| Spectacular length | **10s** (iteration mode) | `GEN_SPECTACULAR_DURATION_S` (30 = full piece) |
| EON length | 15s | `GEN_EON_DURATION_S` |
| Motion model | Seedance 2.5 @720p | `FAL_SEEDANCE_MODEL` / `FAL_RESOLUTION` |
| Upscale | Topaz 4× | `FAL_UPSCALE`, `FAL_UPSCALE_FACTOR` |
| Cost per spectacular render | **~$5.40** at 10s (~$16.20 at 30s) | — |
| Time per video | ~4–8 min at 10s (~8–15 at 30s) | — |
| Still / design | $0.03, ~20–40s | — |

## Iteration log (why things are the way they are)

- **08-10:** Seedance 2.5 adopted (native long take). Stitching deleted. End-frame anchor
  removed (motion felt obligated). Story arcs attempted.
- **08-11:** Geography/role-based arcs attempted; video frame plate turned off (it stamped
  a band + gradient OVER characters).
- **08-14 (Test Art review):** hard cut found at t=9.67s — exactly a prompt "movement"
  boundary → **all beat/timestamp structure removed; prompt reduced to the minimal
  contract**. Remaining plate gradient killed for good.
- **08-14 (now):** movement still minimal, cuts still appearing → **10s iteration mode**
  for ~$5.40/round. Next levers if cuts persist at 10s: reference-to-video endpoint,
  first-frame-weight parameters, or an automated cut-detector QA gate that auto-rejects
  and re-rolls a clip containing a scene change (scdet — the same detector used to find
  the 9.67s cut — costs nothing and could save a bad $5 render from reaching review).
