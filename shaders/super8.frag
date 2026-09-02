// Super 8: the whole reversal-stock package, not just the noise. Grain on
// small-gauge film is coarse and *clumped* - the silver crystals sit in
// clusters, so two octaves of noise at different scales read as film where
// one octave reads as video hiss. The clumps also have to re-roll on the
// film's own 18 fps rather than on the render's frame rate, or the grain
// crawls smoothly instead of chattering. On top of that: gate weave, dust in
// the gate, a printer scratch, halation around the highlights, exposure
// flicker and a warm faded print.
//
// This is the heavy one. `grain` is the subtle, mid-tone-weighted version;
// stack neither on top of the other.
//

float hash11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
}

// Value noise, not white noise: neighbouring samples correlate, which is what
// makes the grain clump instead of speckle.
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {

    // Everything that must hold still for the duration of a film frame keys
    // off this, so the projector runs at 18 fps no matter what TD renders at.
    float frame = floor(u_time * 18.0);
    float fseed = hash11(frame);

    // Gate weave: sprocket slop, two or three pixels, mostly vertical.
    vec2 weave = (vec2(hash11(frame * 1.7), hash11(frame * 3.1)) - 0.5)
               * vec2(2.5, 3.5) / u_res * u_amount;
    vec2 suv = uv + weave;

    vec3 c = camera(suv);

    // Halation: the highlights scatter back through the emulsion and come out
    // orange, because they have bounced off the anti-halation backing.
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = 6.2831853 * float(i) / 8.0;
        vec3 s = camera(suv + vec2(cos(a), sin(a)) * 3.5 / u_res);
        glow += s * smoothstep(0.62, 1.0, luma(s));
    }
    c += (glow / 8.0) * vec3(1.0, 0.55, 0.32) * 0.9 * u_amount;

    // Clumped grain. The fine octave carries the texture, the coarse one the
    // clumping; the mid-tone weight never drops to zero, unlike `grain`, so
    // even the blacks stay alive the way pushed reversal stock does.
    vec2 gp = suv * u_res;
    float g = (vnoise(gp / 1.6 + fseed * 512.0) * 0.65
             + vnoise(gp / 4.5 + fseed * 231.0) * 0.35) - 0.5;
    float l = luma(c);
    c += g * 1.15 * u_amount * mix(0.5, 1.0, 4.0 * l * (1.0 - l));

    // Dust and hairs in the gate: sparse, and a new set every film frame.
    float dust = hash21(floor(suv * u_res / 5.0) + fseed * 137.0);
    c += smoothstep(0.9975, 0.9992, dust) * 0.8 * u_amount;
    c -= smoothstep(0.9975, 0.9992, 1.0 - dust) * 0.5 * u_amount;

    // A printer scratch: one vertical line that survives for half a second at
    // a time, which is roughly how long a real one stays in frame.
    float sBlock = floor(u_time * 2.0);
    float sx = hash11(sBlock * 5.7);
    float scratch = smoothstep(2.4 / u_res.x, 0.0, abs(uv.x - sx))
                  * step(0.55, hash11(sBlock * 11.3));
    c += scratch * 0.35 * u_amount;

    // Exposure flicker from a shutter that is not quite consistent.
    c *= 1.0 + (hash11(frame * 7.7) - 0.5) * 0.10 * u_amount;

    // Faded print: warm, and with lifted blacks, because dye-transfer prints
    // lose their density from the shadows up.
    c = mix(c, c * vec3(1.06, 0.98, 0.88) + vec3(0.06, 0.045, 0.03), u_amount);

    vec2 d = uv - 0.5;
    d.x *= u_res.x / u_res.y;
    c *= 1.0 - 0.85 * u_amount * dot(d, d);

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
