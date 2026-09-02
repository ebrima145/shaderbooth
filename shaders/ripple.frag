// Rings spreading out from one point, like a drip landing in still water and
// the frame being read through the surface it disturbs.
//
// The displacement is taken from the *slope* of the wave, not its height. A
// water surface bends light by how steeply it is tilted where the ray goes
// through, so the offset is the derivative - cos where the height is sin,
// which puts the strongest push a quarter cycle off the crests. Offsetting by
// the height instead reads as the picture sliding back and forth in rings
// rather than as something being looked through, and it is the single change
// that decides whether this looks like water or like a wobble.
//
// The same slope lights the highlight, so the bright edge sits on the face of
// each ring that is turned towards the viewer instead of on its peak. That is
// what keeps the rings readable across a flat wall, where a pure refraction
// has nothing to bend and disappears.
//

// Wave cycles per unit of aspect-corrected distance - how tightly the rings
// are packed.
const float RINGS = 10.0;

// Cycles emitted per second. Divided by RINGS this is the speed the crests
// travel: 0.25 of the frame per second, so a ring crosses a square frame in
// about four seconds.
const float RATE = 2.5;

// How quickly the rings die out with distance from the source. Higher keeps
// the disturbance local to the spot.
const float FALLOFF = 2.6;

// Where the drip lands. This was a pointer position where the effect came
// from; here there is nothing pointing, so the rings come from the middle of
// the frame - which is also where they read as deliberate rather than as a
// blemish somewhere off to one side.
const vec2 CENTRE = vec2(0.5);

// Radius over which the wave fades in around the source. Without it the radial
// direction - undefined exactly at the centre - throws a hard speck of noise
// into the middle of every ring set.
const float CORE = 0.03;

void main() {

    // Measure distance in aspect-corrected space so the rings stay circles on
    // a wide frame, and undo it on the offset below so the displacement is
    // still expressed in UV.
    float aspect = u_res.x / u_res.y;
    vec2 d = (uv - CENTRE) * vec2(aspect, 1.0);

    float r = length(d);
    vec2 dir = d / max(r, 1e-5);

    float phase = TAU * (r * RINGS - u_time * RATE);

    // Amplitude envelope: dies with distance, and fades in over CORE so the
    // centre stays clean.
    float env = smoothstep(0.0, CORE, r) / (1.0 + FALLOFF * r);

    float slope = cos(phase) * env;

    vec2 offset = dir * slope * 0.035 * u_amount;
    offset.x /= aspect;

    vec3 c = camera(uv + offset);

    // Lit off the same slope, one-sided - a lift on the faces tilted towards
    // the viewer and nothing on the ones tilted away, which is what gives each
    // ring a leading edge instead of a symmetrical band.
    c += vec3(max(slope, 0.0)) * 0.22 * u_amount;

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
