/**
 * The eighteen named looks that ship with the app.
 *
 * Already sorted: every one arrives with all seven fields filled, so the style
 * library is useful the first time it is opened rather than being an empty box
 * with a "New style" button. The description each carries is the full
 * model-readable prompt the look came from — the words survive even if someone
 * later rewrites a field, and the sorter can always be pointed back at them.
 *
 * Seeded by name, never by id: a library that already contains MIDNIGHT
 * LEXINGTON has one because the user typed it, and their version of it — their
 * wording, their colour, their edits — is the one that should stay. The pack
 * fills the gaps around it and touches nothing that is already there.
 */

export interface StyleSeed {
  name: string
  videoStyle: string
  camera: string
  lens: string
  grade: string
  lighting: string
  filmStock: string
  aspect: string
  /** The full prompt the look came from, plus its style-specific negative. */
  sourceText: string
  /**
   * Which family it belongs to. Read by `styleCategoryMigration` only.
   *
   * Safe to add to this shape *because* v14's generated SQL does not reference
   * it — `stylePackMigration()` is shipped and is never edited, and the only
   * thing keeping that true is that the field it does not know about stays
   * unused by it. Keep it that way.
   */
  category: StyleCategory
}

/** The ids in `STYLE_CATEGORIES`. Duplicated as a type only, so a typo fails to compile. */
type StyleCategory =
  | 'cinema'
  | 'documentary'
  | 'analog'
  | 'night'
  | 'editorial'
  | 'macro'
  | 'stylised'
  | 'landscape'

export const STYLE_PACK: readonly StyleSeed[] = [
  {
    name: 'MIDNIGHT LEXINGTON',
    category: 'documentary',
    videoStyle: 'gritty urban indie, documentary realism',
    camera: 'handheld tracking, natural micro-shake',
    lens: '24mm wide, slight barrel distortion, close-focus',
    grade: 'teal shadows, orange sodium highlights, desaturated midtones',
    lighting: 'overcast daylight + sodium streetlight spill',
    filmStock: 'Kodak Vision3 500T',
    aspect: '9:16',
    sourceText: `Gritty urban indie documentary realism. Handheld tracking shot on a 24mm wide lens with slight barrel distortion, following a young woman in an oversized black puffer from behind through a wet city street, natural micro-shake and walking bounce throughout, unstabilised. Flat overcast daylight mixed with warm sodium streetlight spill, neon storefront reflections on wet asphalt. Shot on Kodak Vision3 500T, teal-and-orange grade, desaturated midtones, deep crushed shadows with a teal lean, warm sodium highlights, soft halation blooming around every light source, fine 35mm film grain, slight gate weave, 9:16 vertical, photoreal.

Avoid: gimbal-smooth motion, drone shot, slow motion, HDR glow, over-saturated colours.`
  },
  {
    name: 'FRONT CAMERA',
    category: 'documentary',
    videoStyle: 'lo-fi realism, unretouched phone capture',
    camera: 'handheld phone, visible shake, off-centre framing',
    lens: 'phone wide 26mm equivalent, digital',
    grade: 'flat, ungraded, mild green cast',
    lighting: 'available light only, auto-exposure hunting',
    filmStock: 'none — digital phone sensor',
    aspect: '9:16',
    sourceText: `Lo-fi realism, unretouched phone capture. Close handheld shot on a phone wide 26mm equivalent lens, a student sitting on an unmade bed talking directly to camera mid-sentence, messy room visible behind, frame slightly off-centre and reframing once. Available light only from an overcast window, auto-exposure visibly hunting and correcting. No colour grade, flat with a mild green cast, mild digital sensor noise in the shadows, slightly soft focus, one small refocus hunt, natural handheld shake, 9:16 vertical, candid and completely unretouched.

Avoid: cinematic, colour graded, film grain, shallow depth of field, professional lighting, gimbal, bokeh.`
  },
  {
    name: 'PORTRA SUNDAY',
    category: 'analog',
    videoStyle: 'analog nostalgia, soft editorial',
    camera: 'static shot, gentle drift',
    lens: 'medium 50mm, gentle vignette',
    grade: 'soft pastel palette',
    lighting: 'sunlit balcony, late afternoon',
    filmStock: 'Kodak Portra 400',
    aspect: '2.39:1',
    sourceText: `Analog nostalgia, soft editorial stillness. Static medium shot on a 50mm lens with gentle corner vignette, two friends sitting talking on a sunlit balcony, almost no camera movement beyond a slow breathing drift, curtains and hair moving in the breeze. Late afternoon sun raking low across the frame, soft directional warmth. Shot on Kodak Portra 400, soft pastel palette, creamy protected skin tones, gentle contrast roll-off, lifted milky blacks, visible halation on highlights, organic fine film grain, 2.39:1 widescreen, photoreal analog warmth.

Stock swaps: Kodachrome 64 · Fujifilm Superia · Cinestill 800T · Fuji Pro 160.`
  },
  {
    name: 'SILVER RETENTION',
    category: 'analog',
    videoStyle: 'gritty crime drama, raw and bleak',
    camera: 'tight handheld, aggressive snap zoom',
    lens: '35mm, hard punch-in',
    grade: 'bleach bypass, severe contrast, near-monochrome',
    lighting: 'single overhead practical, hard top light',
    filmStock: 'Kodak Double-X 5222',
    aspect: '2.39:1',
    sourceText: `Gritty crime drama, raw and bleak. Tight handheld 35mm shot with a hard punch-in on a boxer wrapping his hands in a bare concrete gym, aggressive snap zoom, unstabilised. Single overhead practical bulb creating hard top light and long vertical shadows, dust visible drifting through the beam. Shot on Kodak Double-X 5222 with bleach bypass silver retention, severe contrast, heavily desaturated to near-monochrome with faint skin tone bleeding through, crushed blacks, blown specular highlights, cool steel undertone, heavy coarse film grain, 2.39:1, photoreal.

Avoid: warm tones, saturated colours, soft lighting, pastel, lifted blacks.`
  },
  {
    name: 'SILK HOUR',
    category: 'editorial',
    videoStyle: 'Vogue-style editorial fashion film',
    camera: 'slow push-in dolly, subject stationary',
    lens: '85mm portrait, shallow depth of field',
    grade: 'clean warm, protected skin, luxury finish',
    lighting: 'golden hour backlight, soft bounce fill',
    filmStock: 'Kodak Vision3 250D',
    aspect: '2.39:1',
    sourceText: `Vogue-style editorial fashion film, luxury aesthetic. Slow push-in dolly on an 85mm portrait lens with very shallow depth of field, a model in a silk slip dress standing motionless on a rooftop, only the fabric moving in the wind, city skyline dissolving to soft bokeh behind. Golden hour backlight rimming her shoulders with soft bounce fill from camera left. Shot on Kodak Vision3 250D, clean warm grade, protected skin tones, gentle highlight roll-off, subtle fine grain, creamy circular bokeh, 2.39:1, high-end commercial finish, photoreal.

Avoid: handheld shake, harsh shadows, cluttered background, amateur, flat lighting.`
  },
  {
    name: 'WET NEON',
    category: 'night',
    videoStyle: 'cyberpunk neon, rain-soaked night city',
    camera: 'low ground-level tracking',
    lens: '24mm anamorphic, horizontal blue flare',
    grade: 'blue and magenta, saturation in neon only',
    lighting: 'neon practicals, backlit steam, no key light',
    filmStock: 'Cinestill 800T',
    aspect: '2.39:1',
    sourceText: `Cyberpunk neon, rain-soaked night city. Low ground-level tracking shot on a 24mm anamorphic lens with horizontal blue lens flares, moving through a dense night market, figures crossing frame in silhouette. Neon signage as the only light source, backlit steam rising from street vents, no key light, everything backlit and rim-lit. Shot on Cinestill 800T with characteristic red halation blooming around light sources, blue and magenta palette, saturation held only in the neon, deep black shadows, oval bokeh, dense atmospheric fog, 2.39:1, photoreal.`
  },
  {
    name: 'AUBERGINE HOURS',
    category: 'editorial',
    videoStyle: 'dark academia, contemplative interior',
    camera: 'slow lateral drift',
    lens: '50mm, slow rack focus',
    grade: 'moody aubergine and oxblood, gold highlights',
    lighting: 'single brass lamp practical, rain-diffused window',
    filmStock: 'Fujifilm Eterna 500T',
    aspect: '4:5',
    sourceText: `Dark academia, contemplative interior stillness. Slow lateral drift on a 50mm lens with a gentle rack focus, moving across a book-lined study, a figure reading in a low armchair, dust visible in the light. Single brass lamp practical as the key, cold rain-diffused window light as the only fill, everything else falling to deep shadow. Shot on Fujifilm Eterna 500T, moody aubergine and oxblood palette, warm low-key gold highlights, deep rich plum shadows, filmic contrast curve, fine grain, 4:5, photoreal, quiet and unhurried.`
  },
  {
    name: 'COLD MONOLITH',
    category: 'cinema',
    videoStyle: 'Christopher Nolan cinematography, IMAX scale',
    camera: 'slow deliberate glide, restrained',
    lens: 'Zeiss Supreme Prime 35mm on ARRI Alexa 65',
    grade: 'cold steel, deep shadow zones, minimal saturation',
    lighting: 'practical and ambient only, light from below',
    filmStock: 'Kodak Vision3 5219',
    aspect: '1.90:1',
    sourceText: `Christopher Nolan cinematography, IMAX-scale framing. Slow deliberate glide on a Zeiss Supreme Prime 35mm mounted on ARRI Alexa 65, moving across a lone figure standing on an empty rooftop at dawn, the city grid a thousand feet below, restrained and unhurried motion. Practical and ambient light only, illumination rising from beneath the subject, cloud layer moving overhead. Shot on Kodak Vision3 5219, cold steel palette, deep shadow zones, minimal saturation, immense depth of field, monolithic negative space, 1.90:1, photoreal.

Director swaps: Wes Anderson · Denis Villeneuve · Wong Kar-wai · Emmanuel Lubezki.`
  },
  {
    name: 'LIGHT TRAILS',
    category: 'night',
    videoStyle: 'long-exposure night kinetics',
    camera: 'locked static, world moving through frame',
    lens: '24mm, deep focus',
    grade: 'saturated light against deep night blacks',
    lighting: 'street practicals and headlights only',
    filmStock: 'Cinestill 800T',
    aspect: '9:16',
    sourceText: `Long-exposure night kinetics. Locked static wide shot on a 24mm deep-focus lens at a busy night crossing, camera completely still while crowds streak through frame as motion blur, one figure standing sharp and motionless at centre. Street practicals and passing headlights as the only illumination, traffic drawing continuous light trails across the frame. Shot on Cinestill 800T, slow shutter aesthetic, sharp static elements against heavily blurred movement, saturated light sources, deep night blacks, red halation bloom, fine grain, 9:16, photoreal.

Avoid: everything sharp, frozen motion, flash photography, camera movement.`
  },
  {
    name: 'SILVER VALLEY',
    category: 'landscape',
    videoStyle: 'ethereal atmospheric landscape',
    camera: 'very slow reveal pan',
    lens: '24mm wide, deep focus',
    grade: 'cool desaturated greens and greys',
    lighting: 'overcast silver diffusion, no direct sun',
    filmStock: 'Fuji Eterna 250D',
    aspect: '2.39:1',
    sourceText: `Ethereal atmospheric landscape, otherworldly and quiet. Very slow reveal pan on a 24mm deep-focus wide lens across highland valleys, mist rolling between distant ridgelines, one small lone figure at the frame edge for scale, wind moving through the grass. Overcast silver diffusion with no direct sun, completely soft omnidirectional light. Shot on Fuji Eterna 250D, cool desaturated greens and greys, low contrast, silver highlights, painterly atmospheric depth, layered aerial perspective, fine grain, 2.39:1, photoreal.`
  },
  {
    name: 'BODY LOCK',
    category: 'documentary',
    videoStyle: 'psychological intensity, disorienting POV',
    camera: 'snorricam body-mounted, subject locked centre',
    lens: '18mm ultra-wide, heavy edge distortion',
    grade: 'teal-orange, high contrast',
    lighting: 'mixed street neon, no controlled key',
    filmStock: 'Kodak Vision3 500T',
    aspect: '9:16',
    sourceText: `Psychological intensity, disorienting POV. Snorricam body-mounted rig on an 18mm ultra-wide lens with heavy edge distortion, a young man walking fast through a crowded street, his face fixed dead centre frame and perfectly stable while the entire city swings and rotates violently behind him, extreme parallax. Mixed street neon and shopfront light with no controlled key, sources smearing past. Shot on Kodak Vision3 500T, teal-and-orange grade, high contrast, crushed shadows, film grain, 9:16, photoreal.`
  },
  {
    name: 'THUMBPRINT',
    category: 'stylised',
    videoStyle: 'stop-motion clay animation',
    camera: 'locked-off, tiny incremental moves',
    lens: '50mm macro, shallow tabletop depth',
    grade: 'warm toy-like, gentle saturation',
    lighting: 'soft diffused studio key, warm',
    filmStock: 'Kodak Ektachrome 100D',
    aspect: '4:5',
    sourceText: `Stop-motion clay animation, handmade and tactile. Locked-off medium shot on a 50mm macro lens with shallow tabletop depth of field, a clay student character dragging a small suitcase into a tiny clay bedroom, tiny incremental camera moves between frames. Soft diffused warm studio key from above with gentle fill, small practical lamp glowing in the set. Shot on Kodak Ektachrome 100D, warm toy-like grade, gentle saturation, visible thumbprints and tool marks in the clay surface, deliberate imperfections, 24fps frame stutter, 4:5.

Avoid: smooth motion, photorealistic, 3D render, CGI, motion blur.`
  },
  {
    name: 'SUBSURFACE',
    category: 'macro',
    videoStyle: 'gummy jelly ASMR tactility',
    camera: 'very slow macro push',
    lens: '100mm macro, extreme close focus',
    grade: 'high-key saturated candy palette',
    lighting: 'hard backlight through the subject',
    filmStock: 'none — clean digital',
    aspect: '9:16',
    sourceText: `Gummy jelly ASMR tactility, sensory close-up. Very slow macro push on a 100mm lens at extreme close focus, a translucent jelly object compressing under pressure and bouncing slowly back into shape, surface deforming and rippling. Hard backlight passing directly through the subject producing intense subsurface scattering, glossy specular highlights sliding across the wet surface. Clean digital capture with no grain, high-key saturated candy palette, translucent rubbery material, razor-thin depth of field, 9:16, photoreal and hyperdetailed.`
  },
  {
    name: 'GOOD SLOP',
    category: 'stylised',
    videoStyle: 'deliberate early-AI artifacting',
    camera: 'drifting, unmotivated',
    lens: 'undefined, inconsistent',
    grade: 'oversaturated, wrong',
    lighting: 'blown out, incoherent',
    filmStock: 'none',
    aspect: '1:1',
    sourceText: `Deliberate early-AI artifacting, intentionally low-fidelity. Drifting unmotivated camera on an undefined inconsistent lens, a man eating spaghetti at a dinner table, everything subtly wrong, background melting and reforming between frames, hands unstable and reshaping, features drifting across the face. Blown-out incoherent lighting with no consistent source. Oversaturated wrong colour, temporal instability, morphing geometry, low-fidelity generative look, 1:1.

No negative prompt — drop it entirely and use an older or smaller model. Fighting for quality defeats the style.`
  },
  {
    name: 'FISHEYE VHS',
    category: 'analog',
    videoStyle: '90s skate video, VHS analog',
    camera: 'low crouched follow, inches off the ground',
    lens: '8mm circular fisheye, extreme barrel distortion',
    grade: 'washed VHS, bleeding chroma, scan lines',
    lighting: 'harsh midday sun, blown highlights',
    filmStock: 'Super 8 Kodak Tri-X 200 transferred to VHS',
    aspect: '4:3',
    sourceText: `90s skate video, VHS analog capture. Low crouched follow shot inches off the ground on an 8mm circular fisheye with extreme barrel distortion, buildings bending dramatically at the frame edges, camera operator running alongside a skater through a concrete plaza, wild handheld motion. Harsh unfiltered midday sun with blown highlights and hard black shadows. Super 8 Kodak Tri-X 200 transferred to VHS, washed-out grade, bleeding chroma, visible scan lines, tape tracking noise, heavy grain, 4:3, authentically degraded.

Avoid: sharp, clean, stabilised, modern, high definition, colour graded.`
  },
  {
    name: 'PROBE',
    category: 'macro',
    videoStyle: 'hyperreal macro, commercial food/product',
    camera: 'continuous probe travel through the scene',
    lens: '24mm probe lens, deep focus macro',
    grade: 'rich saturated, deep contrast',
    lighting: 'hard directional key with rim, dark surround',
    filmStock: 'none — clean digital',
    aspect: '16:9',
    sourceText: `Hyperreal macro, commercial food cinematography. Continuous probe travel on a 24mm probe lens with deep macro focus, camera moving impossibly low and through a plated dish, passing between garnish and steam, ending inches from the surface, one unbroken move. Hard directional key from behind with strong rim light, surrounding set falling to near-black. Clean digital capture, rich saturated grade, deep contrast, wet specular highlights, visible steam and micro-texture, 16:9, hyperdetailed and photoreal.

Avoid: flat lighting, handheld shake, grain, soft focus.`
  },
  {
    name: 'MINIATURE CITY',
    category: 'stylised',
    videoStyle: 'tilt-shift miniature illusion',
    camera: 'locked high angle, slight time-lapse speed-up',
    lens: '45mm tilt-shift, extreme selective focus plane',
    grade: 'high saturation, boosted contrast, toy-like',
    lighting: 'bright high sun, high contrast',
    filmStock: 'Fujichrome Velvia 50',
    aspect: '16:9',
    sourceText: `Tilt-shift miniature illusion, real city rendered toy-sized. Locked high-angle shot on a 45mm tilt-shift lens with an extreme selective focus plane, only a narrow horizontal band sharp while everything above and below falls to heavy blur, traffic and pedestrians moving below at slightly accelerated speed. Bright high midday sun with high contrast and short hard shadows. Shot on Fujichrome Velvia 50, high saturation, boosted contrast, punchy primary colours, toy-like clarity in the focus band, 16:9, photoreal.`
  },
  {
    name: 'SCOPE',
    category: 'cinema',
    videoStyle: 'anamorphic cinema, classic scope',
    camera: 'slow lateral dolly, deliberate',
    lens: '40mm anamorphic, oval bokeh, horizontal flare',
    grade: 'rich filmic contrast, warm highlights, cool shadows',
    lighting: 'strong single source, deep falloff',
    filmStock: 'Kodak Vision3 200T',
    aspect: '2.39:1',
    sourceText: `Anamorphic cinema, classic scope framing. Slow lateral dolly on a 40mm anamorphic lens with pronounced oval bokeh and horizontal blue streak flares, tracking past a figure standing in a doorway, deliberate and unhurried. Strong single light source from frame left with deep falloff into darkness on the opposite side. Shot on Kodak Vision3 200T, rich filmic contrast, warm highlights, cool shadow separation, anamorphic edge stretching, subtle barrel distortion, fine grain, 2.39:1, photoreal.`
  }
]

/** Colours cycle so a freshly seeded library is not eighteen amber chips. */
const SEED_COLORS = ['amber', 'violet', 'sky', 'mint', 'rose'] as const

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

/**
 * The pack as one migration's worth of SQL.
 *
 * Generated rather than hand-written so the seed data stays readable as data.
 * Each insert is a SELECT guarded by NOT EXISTS on the name, so a library that
 * already holds a look keeps its own — and because a skipped row consumes no
 * sort index, the ones that do land stay contiguous at the end of the list.
 */
export function stylePackMigration(): string {
  return STYLE_PACK.map((style, i) => {
    const values = [
      quote(`style-pack-${String(i + 1).padStart(2, '0')}`),
      quote(style.name),
      quote(style.videoStyle),
      quote(style.camera),
      quote(style.lens),
      quote(style.grade),
      quote(style.lighting),
      quote(style.filmStock),
      quote(style.aspect),
      `'[]'`,
      quote(style.sourceText),
      quote(SEED_COLORS[i % SEED_COLORS.length]),
      `(SELECT COALESCE(MAX(sort_index), -1) + 1 FROM video_styles)`,
      `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ]

    return `INSERT INTO video_styles
    (id, name, video_style, camera, lens, grade, lighting, film_stock,
     aspect, extras, source_text, color, sort_index, created_at)
  SELECT ${values.join(',\n         ')}
  WHERE NOT EXISTS (
    SELECT 1 FROM video_styles WHERE lower(trim(name)) = lower(trim(${quote(style.name)}))
  );`
  }).join('\n\n')
}

/**
 * The pack, filed into families.
 *
 * A second migration rather than an edit to the first, because the first is
 * shipped and forward-only migrations are never edited. Each UPDATE is guarded
 * on `category = ''` and matched on `lower(trim(name))`, for exactly the reason
 * the pack seeds by name: a library that already holds MIDNIGHT LEXINGTON holds
 * *the user's* version of it, and if they have already filed it their filing
 * wins. A style they wrote themselves is never touched at all — it is not in
 * this list, so it stays uncategorised until they say otherwise.
 */
export function styleCategoryMigration(): string {
  return STYLE_PACK.map(
    (style) =>
      `UPDATE video_styles SET category = ${quote(style.category)}
     WHERE category = '' AND lower(trim(name)) = lower(trim(${quote(style.name)}));`
  ).join('\n')
}
