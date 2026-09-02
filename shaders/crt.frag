// A CRT tube: barrel-curved glass, an aperture-grille phosphor mask on a
// three-pixel pitch, scanlines, and the slow bright bar of a refresh rate
// that doesn't quite match the camera's. The mask and the scanlines both
// eat light, so the whole image is gained back up afterwards.
void main() {
    vec2 p = uv * 2.0 - 1.0;
    float r2 = dot(p, p);
    p *= 1.0 + r2 * 0.11 * u_amount;
    vec2 q = p * 0.5 + 0.5;

    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec3 c = camera(q);

    float col = mod(floor(q.x * u_res.x), 3.0);
    vec3 mask = vec3(col == 0.0 ? 1.0 : 0.52,
                     col == 1.0 ? 1.0 : 0.52,
                     col == 2.0 ? 1.0 : 0.52);
    c *= mix(vec3(1.0), mask, u_amount);

    float sl = 0.5 + 0.5 * cos(q.y * u_res.y * 3.14159265);
    c *= mix(1.0, 0.62 + 0.38 * sl, u_amount);

    c *= 1.0 + 0.45 * u_amount;
    c += 0.045 * u_amount * smoothstep(0.86, 1.0, sin(q.y * 5.0 - u_time * 1.1));
    c *= smoothstep(1.9, 0.35, r2);

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
