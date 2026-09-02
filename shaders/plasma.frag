// A demoscene plasma field, but the camera drives its brightness - so the
// field only lights up where there is something in front of the lens, and
// you paint into it by moving. Sine sums for the large structure, fbm on
// top so it doesn't tile visibly.
void main() {
    vec2 p = uv * 3.0;
    p.x *= u_res.x / u_res.y;
    float t = u_time * 0.4;

    float v = sin(p.x * 2.0 + t);
    v += sin((p.y + t) * 1.7);
    v += sin((p.x + p.y + t) * 1.3);
    v += fbm(p * 1.4 + t * 0.3) * 2.2;
    v = v * 0.25 + 0.5;

    vec3 field = hsv2rgb(vec3(fract(v + t * 0.05), 0.85, 1.0));

    vec3 c = camera(uv);
    float l = luma(c);

    fragColor = vec4(clamp(mix(c, field * (0.18 + l * 1.5), u_amount), 0.0, 1.0), 1.0);
}
