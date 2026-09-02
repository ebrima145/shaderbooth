// Video feedback. The previous output is read back slightly rotated and
// zoomed before being mixed with the live frame, so trails spiral outward
// instead of stacking in place. max() rather than mix() keeps the trail
// bright until it decays, which is what makes it read as a light trail
// rather than a smear.
void main() {
    vec3 c = camera(uv);

    vec2 p = uv - 0.5;
    p = rot(0.012 * u_amount) * p * (1.0 - 0.014 * u_amount);
    vec3 f = feedback(p + 0.5);

    float decay = mix(0.55, 0.968, u_amount);
    vec3 outc = max(c, f * decay);

    // Ageing trails drift in hue, so you can read how old a streak is.
    vec3 h = rgb2hsv(outc);
    h.x = fract(h.x + 0.0025 * u_amount);
    h.y = min(1.0, h.y * (1.0 + 0.05 * u_amount));

    fragColor = vec4(hsv2rgb(h), 1.0);
}
