// The STORY DIRECTOR — writes each design's motion story FROM the actual
// generated still (Shawn, 2026-08-14: "we need a better correlation between
// the still generated and the prompt for the video… if it's ocean-themed with
// a shark and fish, the story would be the fish swimming across the screen
// while the shark chases it, hiding in the seaweed it generated, then the
// shark finally biting it").
//
// A template can never know what Seedream really painted. This module shows
// the finished still to a vision LLM and asks for ONE story paragraph that
// uses exactly what is in the picture — the real characters, the real
// scenery as props and hiding places — with real stakes and a decisive
// payoff. The engine then wraps that paragraph in the fixed motion contract
// (camera lock, one take, frame rules, constancy) so the LLM contributes
// story, never rules.
//
// Same conventions as tweak.js: raw fetch (no openai dep), config read at
// call time, and NEVER throws — any failure (no key, no image URL, network,
// bad output) returns null and the caller falls back to the template story.

import config from '../../config/index.js';
import logger from '../../config/logger.js';

// The framed variant scripts the signature pop-out over the painted black
// frame; the borderless variant (split tracks, Shawn 2026-08-18) directs a
// full-bleed cinematic shot with maximum intensity — no frame to speak of,
// edges are free entrances/exits, only whole-screen-filling stays banned.
const directorSystem = (framed = true) => `You are the motion director for a psychedelic billboard artwork. You are shown the exact still image a video model will animate into one continuous shot. Study what is ACTUALLY in the picture: every character and every piece of painted scenery (plants, coral, clouds, structures, drips, light — whatever is really there).

Write ONE story paragraph (90-140 words) scripting a dramatic journey that uses ONLY what you can see:
- a protagonist with a clear goal, and real stakes — a chase, a hunt, a rivalry, a rescue, an escape. Predator-and-prey drama is welcome, including a decisive catch.
- the painted scenery used as the stage: ducking behind it, weaving through it, hiding in it, bursting out of it.
- the ENVIRONMENT itself in constant motion: name the specific scenery you can see and script how it moves and reacts the whole time — water flowing, plants whipping, drips running, mist churning, light pulsing, debris scattering in a character's wake. The world is a character; no region of the picture ever sits still or looks like a static backdrop.
${framed
    ? `- constant travel in DEPTH: the action repeatedly moves between the deep distance and the very front, with characters sweeping right up IN FRONT of the painted black frame — over its border strips, briefly covering them — and diving back into the scene. Passing in front of the frame is the signature move and is always welcome.`
    : `- constant travel in DEPTH: the action repeatedly moves between the deep distance and the very front, close to the viewer, and back. This is a full-bleed cinematic scene with no frame or border: characters may sweep in and out across the picture's edges — entering and exiting the shot — like living things crossing a window.
- MAXIMUM INTENSITY: script the most kinetic, most spectacular version of this scene possible — relentless speed, dramatic near-misses, explosive turns, escalation from the first word to the last. This story should feel like the most exciting ten seconds of a great film.`}
- a decisive payoff in the final moments — caught, escaped, transformed, united — at full speed, never a slow settle.
- DEPARTURE, not arrival: the image IS the story's first instant — your opening words must describe exactly this frozen moment springing into motion and immediately moving AWAY from it. The ending must look clearly DIFFERENT from the image: never regroup the characters into the arrangement shown, never return home to the starting pose — end displaced, somewhere new. (Live QA 2026-08-14: arrival-shaped stories made the model animate TOWARD the input image, so the approved still became the last frame instead of the first.)

HARD RULES: name only characters visibly present in the image. EVERY character moves in EVERY moment — nothing ever stands still, poses, or watches idly. ${framed
    ? `The ONE inviolable boundary is the picture's outer edge: even at its closest and largest, every character keeps its ENTIRE silhouette inside the image — never clipped by the image's edge, never filling the whole screen (in front of the frame: yes; past the picture's edge: never).`
    : `No single character ever fills the whole screen or blots out the scene — even at its closest and largest, the world around it stays visible.`} FORBIDDEN words and devices: timestamps, second counts, numbered beats or parts, and the words "cut", "shot", "scene two", "act", "camera", "transition", "frame two".

Return STRICT JSON {"story":"<one flowing present-tense paragraph>"}.`;

// Shot-list vocabulary that must never reach Seedance (it reads them as an
// edit list — live QA 2026-08-14: timestamped beats caused a cut at t=9.67s).
const BANNED = /\b(\d+\s*(?:seconds?|s\b))|(cut(?:s|ting)? to)|\bshot\b|\bscene (?:two|2)\b|\bact \d\b|\bcamera\b|\btransition\b/i;

/**
 * Ask the vision LLM for a story paragraph grounded in the actual still.
 * @param {{ imageUrl: string|null, cast?: string, style?: string, framed?: boolean }} o
 *   framed=false directs a borderless full-bleed piece (split tracks,
 *   2026-08-18): free edge entries/exits, maximum intensity, no frame talk.
 * @returns {Promise<string|null>} the story paragraph, or null on ANY failure
 *   or rule violation (caller falls back to the template story). Never throws.
 */
export async function directStory({ imageUrl, cast, style, framed = true } = {}) {
  const { apiKey, baseUrl, directorModel } = config.openai;
  if (!apiKey || !imageUrl) return null;
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: directorModel,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: directorSystem(framed) },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `This is the still that will be animated${style ? ` (art style: ${style})` : ''}.` +
                  `${cast ? ` The intended cast was: ${cast} — but trust the IMAGE over this list.` : ''} ` +
                  'Write the story paragraph. JSON only.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openai ${resp.status}`);
    const data = await resp.json();
    const story = String(JSON.parse(data.choices?.[0]?.message?.content || '{}').story || '').trim();
    if (!story || story.length < 60) return null;
    if (BANNED.test(story)) {
      logger.warn({ sample: story.slice(0, 120) }, 'Director story contained shot-list vocabulary — falling back to template');
      return null;
    }
    return story;
  } catch (err) {
    logger.warn({ err: err.message }, 'Story director failed — falling back to the template story');
    return null;
  }
}

export default { directStory };
