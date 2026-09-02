// Worn tape. Three separate failures stacked, because any one of them alone
// just looks like noise: per-line head jitter, a tracking band that crawls up
// the frame and tears harder inside it, and chroma that smears sideways
// because the colour signal had a fraction of the luma signal's bandwidth.
void main() {
    float a = u_amount;
    vec2 p = uv;

    float line = floor(p.y * u_res.y);
    float jitter = (hash21(vec2(line, floor(u_time * 24.0))) - 0.5) * 0.006 * a;
    float wobble = sin(p.y * 90.0 + u_time * 3.0) * 0.0015 * a;

    float band = smoothstep(0.055, 0.0, abs(fract(p.y + u_time * 0.11) - 0.5));
    jitter += band * (hash21(vec2(line, floor(u_time * 40.0))) - 0.5) * 0.045 * a;

    p.x += jitter + wobble;

    // Luma stays where it is; colour is dragged to the right and blurred.
    vec3 sharp = camera(p);
    vec3 smear = vec3(0.0);
    for (int i = 0; i < 6; i++) {
        smear += camera(p - vec2(float(i) * 0.005 * a, 0.0));
    }
    smear /= 6.0;

    vec3 hs = rgb2hsv(smear);
    vec3 hc = rgb2hsv(sharp);
    vec3 c = hsv2rgb(vec3(hs.x, hs.y * (1.0 + 0.4 * a), hc.z));

    // Tape grain, head-switching noise at the very bottom, and the darkening
    // that comes with the band passing through.
    c += (hash21(p * u_res + u_time * 60.0) - 0.5) * 0.16 * a;
    c *= 1.0 - 0.10 * a * step(0.5, fract(p.y * u_res.y * 0.5));
    c *= 1.0 - band * 0.22 * a;
    c = mix(c, vec3(hash21(p * u_res * 0.7 + u_time * 90.0)),
            a * smoothstep(0.035, 0.0, p.y) * 0.7);

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
