// Lateral chromatic aberration: a real lens focuses the three wavelengths at
// slightly different magnifications, so the split grows with distance from
// the optical centre and is zero dead in the middle.
void main() {
    vec2 d = uv - 0.5;
    float k = 0.045 * u_amount;

    vec3 c;
    c.r = camera(uv + d * k).r;
    c.g = camera(uv).g;
    c.b = camera(uv - d * k).b;

    // Corners go slightly soft as well, which is what stops the split from
    // reading as three sharp copies pasted on top of each other.
    vec2 t = texel() * length(d) * 6.0 * u_amount;
    vec3 blur = (camera(uv + t) + camera(uv - t)) * 0.5;
    c = mix(c, mix(c, blur, 0.5), smoothstep(0.15, 0.65, length(d)));

    fragColor = vec4(c, 1.0);
}
