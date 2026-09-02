// High-contrast black and white with a heavy vignette. The contrast curve is
// an S rather than a straight gain: a gain steep enough to be dramatic also
// clips every face to a white blank, where the S keeps the highlights
// separated all the way up.
void main() {
    float l = luma(camera(uv));
    float k = mix(1.0, 3.4, u_amount);
    l = clamp((l - 0.5) * k + 0.5, 0.0, 1.0);
    l = mix(l, smoothstep(0.0, 1.0, l), u_amount * 0.7);

    vec2 d = uv - 0.5;
    d.x *= u_res.x / u_res.y;
    float vig = smoothstep(0.78, 0.18, length(d));

    fragColor = vec4(vec3(l * mix(1.0, vig, u_amount * 0.85)), 1.0);
}
