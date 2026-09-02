// Bokeh. Every point of light in the frame becomes a hard-edged disc with a
// bright rim, a coloured fringe and the same dust specks inside it.
//
// The thing that separates this from a blur is what happens to a bright point.
// A blur is a weighted average under a peaked kernel, so a highlight comes out
// as a soft blob that fades from the middle - the shape of the kernel is
// visible in every highlight, and a gaussian has no edge. A defocused lens
// does not average with a peak: every point in the scene lands on the sensor
// as an image of the *aperture*, at a size set by how far out of focus it is.
// The aperture has a rim, so the disc has a rim.
//
// That is the whole design. The kernel here is not a falloff curve, it is a
// picture of a piece of glass, and everything the discs do comes out of the
// aperture function rather than out of extra passes:
//
//   - a hard edge, because an iris has one;
//   - a rim brighter than the middle, because a fast lens focuses its outer
//     annulus shorter than its centre (spherical aberration) - this is the
//     single constant that most decides whether a circle reads as a circle;
//   - faint concentric rings, from the tooling marks left on a moulded
//     aspheric element;
//   - dust, in the same place inside every disc in the frame - which is the
//     tell that it is on the lens and not in the scene;
//   - lemon-shaped clipping towards the edges of the frame, because off-axis
//     the lens barrel cuts into the iris (mechanical vignetting), and the disc
//     you see is the intersection of two circles rather than one.
//
// The colour fringe is free. Because this *gathers* - it walks the aperture
// once per output pixel and pulls the frame in - the aperture is allowed to be
// a different size per channel, and a red disc slightly larger than the blue
// one leaves exactly the fringe that lateral chromatic aberration puts on real
// bokeh. Scattering it, as a lens actually does, would need a separate texture
// fetch per channel per tap for the same picture. Gathering it costs three
// weights.
//
// The hard part is not the shape, it is the brightness, and it is worth being
// clear about why before touching WHITE. Defocus conserves energy: a light
// three pixels across spread over a disc sixty across is diluted about a
// thousand times. Real bokeh survives that because the light is genuinely a
// thousand times brighter than the fog around it - which the camera cannot
// tell you, because it clipped that light to 1.0 like everything else bright.
// Averaged as it arrives, the disc comes back as a grey smudge, and that is
// exactly what naive defocus looks like. So the highlights have to be put back
// before the taps are averaged, and taken out again afterwards. See WHITE.
//
// The one thing a gather cannot do honestly is depth: a real lens sizes each
// disc by how far its point is from the focal plane, and there is no depth
// here, so every disc is the same size and nothing is ever sharp. In practice
// that reads fine, because the shots this is for are point lights at one
// distance over a dark foreground.
//

// Explicitly level 0, not plain texture(). The taps jump around the aperture,
// so neighbouring pixels have wildly different texture coordinates and the
// implicit derivative GL would use to pick a mip level is meaningless here. On
// an input TOP with mipmap filtering on, that picks a coarse level, averages
// the highlight away before this shader ever sees it, and the discs come out
// as hollow ghosts. Pinning the level makes the effect independent of how the
// input TOP happens to be filtered.

// Widest disc radius, in UV, at u_amount 1. Discs are this fraction of the
// frame *height*; the horizontal offsets are divided by the aspect ratio so
// they stay round on a wide frame.
const float RADIUS = 0.085;

// Taps on the aperture. One fetch each, so this is the whole cost: 128 fetches
// per pixel, below `kuwahara`'s ~196. It is also the grain control, and the
// reason it has to be this high is WHITE below - the taps are estimating an
// average over a very peaked quantity, and how far a single tap can move the
// answer is what shows up as speckle. 96 is noticeably grainier and 64 starts
// to break an isolated highlight into a ring of dots. If you need it cheaper,
// lower RADIUS first: a smaller disc is a smaller area to cover and the same
// taps go further.
const int TAPS = 128;

// What the input's 1.0 is assumed to have really been. This is the constant
// that makes discs instead of smudges, and it works by being exactly
// invertible: the frame is expanded by c/(1 - k*c) before the taps are
// averaged and folded back by e/(1 + k*e) afterwards, with k set so that 1.0
// maps to WHITE and back. The round trip is exact, so a flat patch of image
// comes out untouched and nothing anywhere else in the frame is darkened or
// lifted - the expansion only does work where there is something near clipping
// to expand.
//
// 400 is about right for a night exterior. Lower it and the discs fade towards
// grey smudges; raise it and they blow out, which costs you the rim and the
// dust because a saturated disc has no interior detail left to show.
const float WHITE = 400.0;

// Ceiling on what one tap may contribute, in expanded units. Without it a
// single clipped pixel caught by one tap out of 128 is a visible speck, and a
// frame full of small specular hits turns into static. It is a bias - it does
// dim the very brightest discs slightly - but a firefly you can see is worse
// than a disc that is a few percent dark.
const float FIREFLY = 40.0;

// Spherical aberration - how much brighter the rim of a disc is than its
// middle. 0 gives flat discs, which read as paper cutouts.
const float RIM = 1.9;

// Softening on the aperture's edges, in aperture radii. Just enough to stop
// the rim aliasing; any more and the hard edge goes with it.
const float SOFT = 0.09;

// Difference in aperture radius between the red and blue channels. The fringe
// this leaves is on the rim only, which is where a real one is.
const float CHROMA = 0.045;

// Moulding rings on an aspheric element, and how many of them.
const float ONION = 0.10;
const float ONION_N = 7.0;

// How far the barrel's circle is displaced at the corner of the frame, in
// aperture radii. At 0 every disc stays round to the edge of frame, which is
// what a lens stopped well down does; at 0.6 the corners are clear cat's eyes.
const float CAT = 0.55;

// Dust on the front element: centre x, centre y, radius, in aperture
// coordinates. DUST_DEPTH is how much light a speck lets past.
const vec3 DUST[4] = vec3[4](
    vec3(-0.24,  0.16, 0.052),
    vec3( 0.30, -0.06, 0.038),
    vec3( 0.06, -0.36, 0.065),
    vec3( 0.44,  0.35, 0.030));
const float DUST_DEPTH = 0.45;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Light let through the aperture at point `a`, per channel. `a` is in aperture
// coordinates, where the iris is the unit circle. `cat` is where the barrel's
// own circle sits for this pixel - zero at the centre of frame, sliding
// outwards from there.
vec3 aperture(vec2 a, vec2 cat) {
    float r = length(a);

    // The iris, one radius per channel. Sizing the *aperture* per channel is
    // what puts the colour on the rim: the three discs are concentric and
    // differ only in where they stop, so they agree everywhere except in the
    // two thin annuli at the edge.
    vec3 edge = vec3(1.0 + CHROMA, 1.0, 1.0 - CHROMA);
    vec3 t = 1.0 - smoothstep(edge - SOFT, edge, vec3(r));

    // The barrel, cutting in from one side. Off-axis this is what turns the
    // circle into a lemon, and it does it by intersection, so it clips the
    // bright rim off one side of the disc as well as narrowing it - which is
    // the part that makes a cat's eye look like an optical fact rather than
    // like a squashed circle.
    t *= 1.0 - smoothstep(1.0 - SOFT, 1.0, length(a - cat));

    // Brighter towards the rim, then the moulding rings on top.
    t *= 1.0 + RIM * r * r;
    t *= 1.0 - ONION * cos(r * ONION_N * TAU);

    for (int i = 0; i < 4; i++) {
        float d = length(a - DUST[i].xy);
        t *= mix(DUST_DEPTH, 1.0, smoothstep(0.0, DUST[i].z, d));
    }

    return max(t, 0.0);
}

void main() {
    float aspect = u_res.x / u_res.y;

    float radius = RADIUS * u_amount;

    // Expansion and its exact inverse. k is fixed by wanting 1.0 to expand to
    // WHITE; c is held just under 1 so the division cannot blow up.
    float k = 1.0 - 1.0 / WHITE;

    // How far off-axis this pixel is, as a fraction of the way to the corner.
    // The barrel slides across the iris in proportion to that, along the line
    // from the centre of frame outwards.
    vec2 field = (uv - 0.5) * 2.0;
    field.x *= aspect;
    vec2 cat = CAT * field / max(length(vec2(aspect, 1.0)), 1e-5);

    // The spiral is rotated by a hash of the pixel so its arms do not line up
    // across the frame. Rotating it does not move the dust: the aperture is a
    // continuous function of position, and the spiral only decides which
    // points of it get asked. Do not jitter the radius as well - the two hashes
    // correlate, and a radius that leans with the angle hollows every disc out
    // into a crescent.
    float spin = hash(gl_FragCoord.xy) * TAU;

    vec3 sum = vec3(0.0);
    vec3 wsum = vec3(0.0);

    for (int i = 0; i < TAPS; i++) {
        // Golden-angle spiral: even coverage of a disc with no ring structure
        // left in it. sqrt puts equal numbers of taps in equal areas, which
        // rings do not - see tiltshift.frag.
        float t = (float(i) + 0.5) / float(TAPS);
        float r = sqrt(t);
        float th = float(i) * 2.39996323 + spin;
        vec2 a = r * vec2(cos(th), sin(th));

        vec3 w = aperture(a, cat);
        if (w == vec3(0.0)) continue;       // clipped by the barrel

        vec2 off = a * radius;
        off.x /= aspect;

        vec3 c = min(camera(uv + off), 0.999);
        sum += w * min(c / (1.0 - k * c), vec3(FIREFLY));
        wsum += w;
    }

    vec3 e = sum / max(wsum, 1e-5);
    vec3 c = e / (1.0 + k * e);

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
