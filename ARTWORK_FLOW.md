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
5. **No frame plate — anywhere** *(2026-08-14)*. Nothing is ever composited. The frame
   exists only because Seedream paints it (the still prompt demands it) and Seedance
   maintains it. What Scott reviews and what Seedance animates from is the raw model still.
6. **Story director** *(2026-08-14, round 3 — "the movement keeps most of the creatures
   still… need story")*. A vision LLM is shown the ACTUAL generated still and scripts one
   story paragraph from what is really in it — the real characters, the real painted
   scenery used as cover and props (the shark hunts the fish through the seaweed *it
   generated*), constant travel between the deep distance and the frame plane, and a
   decisive payoff (the catch, the escape, the transformation). The engine wraps that
   paragraph in the fixed motion contract; the LLM writes story, never rules. Any
   shot-list vocabulary in its output is rejected. Fallback (no key / failure): a
   template chase story with the design's cast. ~$0.01/design (`ARTWORK_DIRECTOR_MODEL`,
   default gpt-4o-mini).
7. **QA.** A luma check catches black/blank renders.
8. The design lands on the dashboard for review (approve / pass / keep & explore / tweak).

### Phase 2 — Videos · one Seedance call per design, only on APPROVED designs

8. **Guardrail again** on the stored motion prompt, before the expensive spend.
9. **One Seedance 2.5 call.** Inputs, exactly:
   - `image_url` — the approved still (raw model output)
   - `prompt` — the stored motion prompt (full text below)
   - `duration` — **10s right now** (iteration mode; env `GEN_SPECTACULAR_DURATION_S=30`
     restores the full piece). EON pieces: 15s.
   - `resolution: 720p` · `aspect_ratio: auto` · `generate_audio: false`
   - **No end frame.** Nothing else. No stitching exists anywhere.
10. **No upscale for now** *(2026-08-14)*. Topaz is OFF during visual iteration — renders
    come back faster and cheaper at 720p. `FAL_UPSCALE=1` re-enables the 4K pass for real
    deliveries once the visuals are down.
11. **Letterbox extraction + never-stretch** *(2026-08-14, round 2 — the "squished"
    render)*. Seedance can't output the extreme 3.6:1, so it letterboxes the art inside a
    taller canvas. cropdetect finds the actual black bars and removes ONLY them (padding,
    not picture). If the extracted content still doesn't match the design's aspect, that's
    a real failure: it is **never stretched** — delivered undistorted (padded to spec) with
    a loud flag on the card. The squish came from the old exact-fit stretch; stretching is
    gone.
12. **QA.** Saturation-drift measurement (warning only — Seedance colors can drain).
13. **Conform.** Exact-fit scale to delivery spec (spectacular 3840×1062). **Nothing is
    composited onto the video** — the file ships exactly as the model made it.
    (EON masters are instead sliced into each pillar's spine + face panels.)
    During iteration (no Topaz) the 720p render is plain-scaled up — expect softness;
    that's the accepted trade until the visuals are locked.
14. **Ledger.** Exact cost recorded per row from fal's token formula + the real model string.

### Phase 3 — Ship

15. Scott approves videos → **Send to Jeff** → Google Drive upload (per-panel filenames) +
    Gmail notification + Sent-history log.

---

## The exact prompts (live now)

### Still prompt — spectacular (example: option 1, week of 2026-08-17)

> An ultra-wide trompe-l'oeil deep-relief composition in perfectly frontal, dead-centered, symmetrical one-point perspective. Style: *[family style — rotates per batch]*. Composition: the picture's border IS a thick matte-black frame — flat matte-black strips run along the top edge, bottom edge, left edge and right edge of the picture, meeting at the four corners, flush with the picture's edges on all sides. Just inside those black strips the image darkens into pure matte-black depth on all four sides — a soft black inner shadow, as if the scene sits deep behind the black border — and through the opening the scene recedes into deep vivid distance. The frame is never shown as an object […] The black frame is perfectly plain and flat: uniform width on all four sides, sharp square corners, a smooth matte surface — no molding, no ornament. The scene is home to an ensemble of characters: *[cast — rotates per batch]*. **Beyond that cast there is full creative freedom — any characters and scenery that serve the scene are welcome: creatures, people, living objects, anything with personality.** This is how the story opens: *[opening tableau]*. **Whatever moves onto the frame's inner edge is rendered IN FRONT of the black strips**, partially covering them and casting soft shadows onto them — unmistakably closer to the viewer than the frame plane. Every element stays well inside the picture's borders: nothing but the black frame itself ever touches the picture's edge, and nothing is cropped by the picture's boundary […] High-contrast lighting: a bright, saturated hero subject against a deep, dark background […] Ultra high detail. **No text, no logos, no watermarks.**

*(Style family + cast + opening tableau now rotate per BATCH — every "New batch" gets fresh
subjects and environments; the frame and containment language is identical every time.)*

### Motion prompt — spectacular (per-design: the story is written FROM the design's still)

> Fixed camera, locked-off shot […] **One single continuous take — no cuts, no shot changes, no new angles, no transitions, ever.** ***[STORY — written by the vision director from the actual still: a hunt/chase/journey using the real characters and real painted scenery as cover, traveling between the deep distance and the frame plane, ending in a decisive payoff. Template fallback: "A chase with real stakes plays out across this one take: [hero] flees across the full width of the scene with [companion] in relentless pursuit — weaving through the painted scenery, ducking behind it, breaking cover, diving from the deep distance up to the frame itself and back — until the chase peaks at [keeper], where the pursuit ends in one decisive dramatic payoff and the whole world erupts with light."]*** **Every character is in motion at every single moment of the clip — none of them ever stands still, poses, hovers or waits.** **The action travels in depth the whole time — from the deep distance up to the frame plane at the very front and back again.** The characters interact with the frame — climbing onto the black border, sliding along its strips, leaning over its inner edge, casting light and moving shadows onto it — with their entire form inside the picture at all times. The matte-black frame stays perfectly fixed […] The viewpoint never travels into the scene. **Rapid, exciting, high-energy movement — never static, never jittery.** Saturation stays rich and maxed for the entire duration.

The **minimal contract**, tuned per your 2026-08-14 notes: framing locked (the
first-frame=last-frame line is gone), one take, characters work ONTO the frame with their
whole form always inside the picture, rapid + exciting motion welcomed, colors held —
everything else is the model's choice.

---

## The criteria (what "correct" means)

| # | Criterion | Enforced by |
|---|---|---|
| 1 | Black frame flush at the perimeter, all 4 sides, the whole clip | Still prompt paints it; motion prompt maintains it — no compositing anywhere |
| 2 | One continuous take — zero cuts | Motion prompt (no timestamps/beats anywhere — they read as a shot list) |
| 3 | Camera never moves, never enters the scene | CAMERA_LOCK + viewpoint rule in motion prompt |
| 4 | Characters go ONTO the frame — never out of the picture (whole form always inside; the 3D read comes from working the edges) | Motion prompt interaction + containment rules |
| 5 | Nothing composited over the still OR the video, ever | Pipeline: frame plate fully removed 2026-08-14 |
| 6 | Colors never wash out / drift grey | Constancy clause + post-hoc saturation QA warning |
| 7 | Any characters welcome — creatures, people, living objects; no text/logos/watermarks | Still prompt creative-freedom clause; nudity guardrail before every spend |
| 8 | Fresh subjects + environments every batch | Prompt seed now salts with the batch id — no weekly repetition |
| 9 | Failures are visible, never masked, never stretched | Black padding extracted (cropdetect); true aspect mismatch → padded + flagged, no distortion |
| 11 | The motion has a story — beginning, journey, payoff — with zero timestamps | One untimed story sentence naming the design's own cast |
| 10 | Delivery: exact pixels (3840×1062; EON panels 320/1280×1920) | Conform exact-fit (Topaz 4× returns via `FAL_UPSCALE=1` for real deliveries) |

## Current knobs & numbers

| Setting | Value now | Change via |
|---|---|---|
| Spectacular length | **10s** (iteration mode) | `GEN_SPECTACULAR_DURATION_S` (30 = full piece) |
| EON length | 15s | `GEN_EON_DURATION_S` |
| Motion model | Seedance 2.5 @720p | `FAL_SEEDANCE_MODEL` / `FAL_RESOLUTION` |
| Upscale | **OFF** (iteration) | `FAL_UPSCALE=1` re-enables Topaz 4× |
| Cost per spectacular render | **~$4.60** at 10s, no upscale (~$16.20 at 30s + Topaz) | — |
| Time per video | ~3–6 min at 10s, no upscale | — |
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
