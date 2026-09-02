// Frosted glass. Not a blur with a noise texture over it - the two things
// that actually make frosted glass read as glass are both here.
//
// The first is that the surface is a height field. Etched glass is a sheet of
// tiny facets, and each facet bends what is behind it by an amount set by its
// own slope, so the image arrives displaced by the local gradient rather than
// smeared symmetrically. That is why you can still see shapes through frosted
// glass while every edge in them wanders.
//
// The second is that the scattering is thickness-dependent. Light that gets
// through a rough facet leaves at a spread of angles, so a point behind the
// pane lands as a disc - and the disc grows with how far behind the pane the
// point is. There is no depth here, so roughness stands in for it: the blur
// radius is driven by a second, finer noise, which gives the uneven patchy
// diffusion of real etched glass instead of a uniform gaussian.
//
// On top of those: a little dispersion (glass bends blue harder than red), a
// milky lift because a diffuser scatters some room light straight back at you,
// and a specular sheen off the facet normals so the pane catches a light.
//

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm_local(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
}

const float FACET   = 34.0;   // size of the etched facets - higher is finer glass
const float REFRACT = 0.030;  // how hard a facet bends the image, in UV
const float SCATTER = 0.024;  // widest scattering disc, in UV
const float SHEEN   = 0.30;   // strength of the specular off the facets
const float BUMP    = 1.6;    // how far the facet normals tilt off the pane
const int   TAPS    = 20;

void main() {
    float aspect = u_res.x / u_res.y;

    // Sample the height field in a square space so the facets are round on a
    // non-square frame, and undo that when the gradient is used as an offset.
    vec2 sp = vec2(uv.x * aspect, uv.y);

    float e = 1.5 / u_res.y;
    float h  = fbm_local(sp * FACET);
    float hx = fbm_local((sp + vec2(e, 0.0)) * FACET);
    float hy = fbm_local((sp + vec2(0.0, e)) * FACET);
    // Divided by FACET as well as by the step, so the gradient stays O(1) and
    // REFRACT means the same thing in UV whatever the facet size is set to.
    vec2 grad = vec2(hx - h, hy - h) / (e * FACET);

    // Refraction: the facet slope steers the ray. Amount squared, because the
    // first half of the slider should still be readable glass.
    vec2 bend = grad * REFRACT * u_amount * u_amount;
    bend.x /= aspect;

    // Roughness varies across the pane - a coarser noise decides where the
    // etch bites deep and scatters wide.
    float rough = fbm_local(sp * (FACET * 0.18));
    float blur  = SCATTER * u_amount * (0.35 + 1.3 * rough);

    // Per-pixel rotation of the tap spiral, so 20 taps do not leave a fixed
    // rosette pattern in flat areas.
    float jitter = hash(gl_FragCoord.xy) * 6.2831853;

    vec3 c = vec3(0.0);
    for (int i = 0; i < TAPS; i++) {
        float fi = float(i);
        float a = fi * 2.39996323 + jitter;             // golden angle
        float r = sqrt((fi + 0.5) / float(TAPS)) * blur;
        vec2 o = vec2(cos(a) / aspect, sin(a)) * r;

        // Dispersion: blue is bent about 6% harder than red through the same
        // facet, which puts a cold fringe on every displaced edge.
        vec2 p = uv + bend + o;
        c.r += camera(p - bend * 0.06).r;
        c.g += camera(p).g;
        c.b += camera(p + bend * 0.06).b;
    }
    c /= float(TAPS);

    // A diffuser throws some of the room straight back, so the pane never
    // reaches true black and cools slightly.
    vec3 milk = vec3(0.86, 0.91, 1.0);
    float haze = 0.16 * u_amount * (0.5 + rough);
    c = mix(c, milk, haze);

    // Specular. The facet normals are steep enough to catch a light, and the
    // sheen is what stops the result reading as fog rather than as a surface.
    vec3 n = normalize(vec3(-grad * BUMP, 1.0));
    vec3 l = normalize(vec3(-0.35, 0.45, 1.0));
    float spec = pow(max(dot(n, l), 0.0), 26.0);
    c += spec * SHEEN * u_amount * vec3(0.95, 0.97, 1.0);

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
