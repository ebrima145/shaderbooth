// Ordered dithering against an 8x8 Bayer matrix, built by the bit-reversed
// interleave rather than stored as a table. Intensity drives the palette
// down towards one bit per channel and the pixels up in size, so at full
// strength you get eight colours of chunky crosshatch.
float bayer8(uvec2 p) {
    p &= uvec2(7u);
    uint v = 0u;
    for (uint i = 0u; i < 3u; i++) {
        v = (v << 2u)
          | (((p.y >> (2u - i)) & 1u) << 1u)
          | (((p.x ^ p.y) >> (2u - i)) & 1u);
    }
    return float(v) / 64.0;
}

void main() {
    float cell = mix(1.0, 4.0, u_amount);
    vec2 px = floor(uv * u_res / cell);

    vec3 c = camera((px + 0.5) * cell / u_res);

    float levels = mix(6.0, 2.0, u_amount);
    float threshold = bayer8(uvec2(px)) - 0.5;

    vec3 q = floor(c * (levels - 1.0) + threshold + 0.5) / (levels - 1.0);
    fragColor = vec4(clamp(q, 0.0, 1.0), 1.0);
}
