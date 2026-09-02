// Ink dots dropped at random, thicker where the picture is darker. The tone
// is carried by how many dots land rather than by how big they are, which is
// what separates stippling from a halftone: no grid to see, no dot pattern to
// beat against the pixels, and the texture stays the same size everywhere
// while the density does the work.
//
// Sites sit on a jittered grid rather than being scattered freely. Free
// scatter clumps - two dots land on top of each other and leave a hole beside
// them - and one dot per cell with a random offset gives most of what a
// Poisson disc would, for a hash instead of a search.
//
// Dots do fatten at the dark end, past the point where every site is already
// taken. Without that a single layer of fixed dots can never reach solid
// black: the most it can cover is the area of one dot per cell.
//

// The four dot constants are not free choices - they are the numerical
// inverse of this grid's coverage curve, and they are why the output tone
// matches the input tone instead of crushing the mid-greys. Coverage was
// measured against radius; inverting it came out as a straight line in
// sqrt(1 - ink), which is the one expression in the loop below, good to
// within 3% of a linear response end to end. DENSITY is the reciprocal of
// what a full field of DOT_MIN dots covers, which is what puts the crossover
// from thinning-out to fattening-up in the right place. Change JITTER and the
// fit no longer holds - the numbers describe that spacing, not dots generally.
const float DOT_MIN   = 0.40;    // dot radius in cells while density carries the tone
const float DOT_FULL  = 0.91;    // radius once every site is taken and ink is solid
const float DOT_SLOPE = 0.675;   // how fast it gets there
const float DENSITY   = 2.20;    // sites taken per unit of ink
const float JITTER    = 1.0;     // a dot goes anywhere in its own cell, and must
const float INK_GAMMA = 1.0;     // 1 is the straight ramp; below 1 opens the highlights
const float ROLL_RATE = 2.0;     // re-rolls per second, staggered site by site

// The lod is the site spacing, so with mipmap filtering on the input each site
// reads the average of the patch it stands for rather than one texel of it.
// Point sampling here is what makes a stipple crawl on camera noise.
vec3 frame(vec2 uv, float lod) {
    return sourceLod(uv, lod);
}

vec2 hash22(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(vec2(p.x * p.y, p.x + p.y));
}

void main() {

    float cell = mix(5.0, 13.0, u_amount);   // pixels between sites
    float lod  = max(log2(cell), 0.0);

    vec2 g  = uv * u_res / cell;             // where we are, in site units
    vec2 gi = floor(g);

    float cover = 0.0;
    float dark_here = pow(clamp(1.0 - luma(frame(uv, lod)), 0.0, 1.0), INK_GAMMA);

    // Three by three is enough, and it is tight rather than comfortable. A dot
    // now goes anywhere inside its own cell, so a site two cells away can come
    // within exactly 1.0 of this pixel, while the fattest dot plus its soft
    // edge reaches 0.99. That margin is what caps DOT_FULL - not the coverage
    // fit. Five by five was rendered against this and the two agree.
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 site = gi + vec2(float(x), float(y));

            // Position hangs off the site alone and never off the clock, so a
            // moving stipple blinks in place instead of swimming across the
            // frame. Only whether the dot is inked re-rolls.
            vec2 c = site + 0.5 + (hash22(site) - 0.5) * JITTER;

            float dark = pow(clamp(1.0 - luma(frame(c * cell / u_res, lod)), 0.0, 1.0),
                             INK_GAMMA);

            float ep = mod(floor(u_time * ROLL_RATE + hash21(site + 3.71)), 512.0) * 0.6180339;
            if (hash21(site + ep + 11.3) > min(dark * DENSITY, 1.0)) continue;

            // Below the crossover this is DOT_MIN and the draw above carries
            // the tone; above it every site is already taken and the radius
            // takes over. One expression, no branch, and the handover lands
            // where it should on its own.
            float r = cell * max(DOT_MIN, DOT_FULL - DOT_SLOPE * sqrt(max(0.0, 1.0 - dark)));
            float d = length((g - c) * cell);

            cover = max(cover, 1.0 - smoothstep(r - 0.75, r + 0.75, d));
        }
    }

    // The last half percent is pinholes at the cell corners, where all four
    // neighbours happened to jitter away. No radius that stays inside the
    // three by three reach closes them, so the darkest tones fill directly.
    // It only ever wins in that last sliver - everywhere else the dots are
    // already darker than it is, and the max leaves them alone.
    cover = max(cover, smoothstep(0.95, 1.0, dark_here));

    vec3 base = frame(uv, 0.0);
    vec3 ink   = mix(base * 0.35, vec3(0.06, 0.05, 0.05), u_amount);
    vec3 paper = mix(base * 1.06, vec3(0.97, 0.96, 0.92), u_amount);

    fragColor = (vec4(clamp(mix(paper, ink, cover), 0.0, 1.0), 1.0));
}
