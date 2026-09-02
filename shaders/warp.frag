// Displacement mapping: a drifting two-channel noise field decides, per
// pixel, where in the camera frame to read from. The result flows like the
// image is behind moving water. A second tighter field tints the result so
// the motion stays readable even on a flat subject.
void main() {
    float t = u_time * 0.25;

    vec2 n = vec2(fbm(uv * 4.0 + vec2(0.0, t)),
                  fbm(uv * 4.0 + vec2(t, 5.7)));
    vec2 d = (n - 0.5) * 0.26 * u_amount;

    vec3 c = camera(uv + d);

    float m = fbm(uv * 9.0 - t * 2.0);
    c = mix(c, c * vec3(1.0 + m * 0.55, 1.0, 1.45 - m * 0.55), u_amount * 0.6);

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
