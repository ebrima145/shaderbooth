// Mirror the frame into N wedges around the centre.
//
// Two things here are easy to get subtly wrong and both look like "the
// effect is boring" rather than like a bug:
//
// The fold (the abs() below) is what makes neighbouring wedges meet as
// mirror images instead of as visible seams.
//
// The rotation has to be applied *after* that fold. Before it, the folded
// angle always lands in the same narrow slice of the source, so the picture
// spins while being built from one fixed strip of camera - the pattern
// turns but never changes. After the fold, the slice itself sweeps around
// the frame, so the wedges keep picking up new content.
//
// The radius is scaled past 1.0 deliberately: at less than that the middle
// of the output is built from the middle of the frame, which on a webcam is
// somebody's face - a large flat region that magnifies into a featureless
// blob. Reaching further out trades that for the detail nearer the edges.
void main() {
    vec2 p = uv - 0.5;
    float aspect = u_res.x / u_res.y;
    p.x *= aspect;

    float segs = floor(mix(3.0, 14.0, u_amount));
    float seg = TAU / segs;

    float r = length(p);
    float a = atan(p.y, p.x);

    a = abs(mod(a, seg) - seg * 0.5);
    a += u_time * 0.22;

    vec2 q = vec2(cos(a), sin(a)) * r * 1.35;
    q.x /= aspect;
    q += 0.5;

    // Reflect at the edges instead of clamping - clamping smears the border
    // pixel into a long streak wherever a wedge reaches past the frame.
    q = abs(mod(q, 2.0));
    q = mix(q, 2.0 - q, step(1.0, q));

    fragColor = vec4(camera(q), 1.0);
}
