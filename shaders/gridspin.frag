// The frame cut into an X by Y grid of blocks, each turning on its own axis.
// Wherever you point, the blocks around that spot twist - hardest under the
// pointer, dying out over a radius you set in blocks - and the twist rolls
// outwards through the grid the way ripple's rings do.
//
// Four decisions here are what make it read as blocks turning rather than as a
// warp with a grid drawn over it:
//
// The rotation happens in an aspect-corrected local space, about each block's
// own centre. Cells are almost never square - a 10x6 grid on a 16:9 frame is
// not - and rotating in raw UV inside a non-square cell shears the picture, so
// the block arrives at 90 degrees stretched instead of turned. Scaling the
// local offset by the frame aspect before the rotation and dividing it out
// after makes the turn rigid in pixels, whatever the grid.
//
// Distance is measured from the pointer's *block* to this block, in blocks, not
// from its exact position in UV. Distance from a free-floating point makes the
// falloff shift as the pointer moves inside one block, so the ring of blocks
// turning with it visibly leans towards whichever edge the pointer is nearest.
// Block to block, the neighbourhood stays symmetric around whatever block is
// being pointed at, and uRadius reads directly as "this many blocks out".
//
// The twist swings rather than winding up forever, and that is a real
// constraint rather than a taste: a pixel shader has no memory between frames,
// so a block's angle has to be a function of the clock and of how far it is
// from the pointer. Wind that up - angle = time * falloff - and the two terms
// multiply: an hour in, a pointer nudged one block sideways changes the falloff
// a little and flings every block in the region through dozens of turns. A
// travelling sine keeps the angle bounded however long the project has been
// running, so moving the pointer moves the swirl smoothly instead of
// detonating it. Rotation that accumulates - a block you spin and leave spun -
// needs something outside the shader to hold the angle; see MANUAL.md.
//
// A block near the pointer reaches the wave's peak before one further out, so
// what you see is a spiral of twist leaving the spot rather than a region
// turning in lockstep. That is ripple's trick: the phase carries the distance
// in it.
//

// The furthest a block under the pointer turns, in radians. Past a half turn,
// so the swing reads as a block spinning through rather than as a wobble.
const float MAX_TURN = TAU * 0.42;

// Twist cycles per second.
const float RATE = 0.55;

// How much of a cycle the twist lags per block of distance. Divided by RATE
// this is the speed the swirl travels: about four blocks a second.
const float SPREAD = 0.14;

const vec2  GRID = vec2(8.0);

// How far the twist reaches, in blocks.
const float RADIUS = 3.4;

// Where the twist is centred. This was a pointer position where the effect
// came from, and pinning it to the middle would leave the outer blocks still
// for ever - so instead the spot wanders, slowly and on two periods that do
// not divide into each other, and the swirl crosses the frame on its own. The
// effect was built around something moving over the picture; this is the
// nearest honest thing a player can give it.
vec2 spot() {
    return vec2(0.5) + 0.33 * vec2(cos(u_time * 0.23), sin(u_time * 0.31));
}

// Reflect at the frame edges rather than clamping - clamping smears the border
// pixel into a long streak wherever a block reaches past the picture.

float hash(vec2 c) {
    return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 turn(vec2 p, float a) {
    float s = sin(a), c = cos(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {

    vec2 grid = GRID;
    float radius = RADIUS;

    vec2 cell   = floor(uv * grid);
    vec2 centre = (cell + 0.5) / grid;

    // Distance in blocks, this block to the one being pointed at.
    float d = length(floor(spot() * grid) - cell);

    float fall = 1.0 - smoothstep(0.0, radius, d);

    // Per-block variation, so the region does not turn as one plate.
    float h = hash(cell);

    float ang = MAX_TURN * fall * mix(0.85, 1.15, h)
              * sin((u_time * RATE - d * SPREAD) * TAU);

    // The free-running spin the original offers as an option is deliberately
    // left off: it accumulates with the clock, so an hour into a session the
    // blocks are turning through dozens of revolutions between frames. The
    // travelling swing above is bounded however long the app has been open.

    ang *= u_amount;

    float aspect = u_res.x / u_res.y;
    vec2  scale  = vec2(aspect, 1.0);

    vec2 ext   = 0.5 / grid * scale;
    vec2 local = (uv - centre) * scale;

    // The sample turns the other way, so the picture inside the block turns the
    // way the twist does.
    vec2 o = turn(local, -ang);

    float mask = 1.0;
    // Mode 0 - the plain turn, letting each block show its neighbours as it
    // goes past. The folded and masked variants are the same shader with a
    // different edge treatment, and picking between them wants a control this
    // player does not have.
    int mode = 0;

    if (mode == 1) {
        // Triangle fold about the block's borders: everything that left comes
        // back mirrored, so a block never shows a pixel that is not its own.
        o = ext - abs(mod(o + ext, 4.0 * ext) - 2.0 * ext);
    } else if (mode == 2) {
        // Softened against the block edge with a fixed pixel width rather than
        // fwidth() - the local coordinate jumps at every cell border, and a
        // derivative of it lights up that whole seam.
        float aa = 1.5 / u_res.y;
        vec2  d2 = abs(o) - ext;
        mask = smoothstep(aa, -aa, max(d2.x, d2.y));
    }

    vec3 col = camera(centre + o / scale) * mask;

    fragColor = (vec4(col, 1.0));
}
