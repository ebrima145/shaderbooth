// Anamorphic bloom. The streak runs horizontally and only horizontally
// because the cylindrical element in an anamorphic lens squeezes one axis
// and flares along it; the blue comes from the coatings on those lenses,
// which is why the look reads as "cinema" rather than "overexposed".
//
// Only the highlights bloom. The threshold drops as u_amount rises, so the
// effect widens by catching more of the image, not just by getting brighter.
//

// Whatever is above the threshold, renormalised so the knee is not a cliff.
vec3 highlights(vec3 c, float thr) {
    return max(c - thr, 0.0) / max(1.0 - thr, 1e-4);
}

void main() {
    float aspect = u_res.x / u_res.y;

    vec3 c = camera(uv);

    float thr   = mix(0.82, 0.45, u_amount);
    float width = mix(0.03, 0.15, u_amount);

    // The streak: a wide gaussian along x only.
    const int N = 20;
    vec3 streak = vec3(0.0);
    float wsum = 0.0;
    for (int i = -N; i <= N; i++) {
        float t = float(i) / float(N);
        float w = exp(-t * t * 3.0);
        streak += highlights(camera(uv + vec2(t * width, 0.0)), thr) * w;
        wsum += w;
    }
    streak /= wsum;

    // A small round halo underneath it, so bright points are not pure line.
    vec3 halo = vec3(0.0);
    for (int i = 0; i < 12; i++) {
        float a = 6.2831853 * float(i) / 12.0;
        float r = (i < 6 ? 0.006 : 0.014) * (1.0 + 2.0 * u_amount);
        vec2 o = vec2(cos(a) / aspect, sin(a)) * r;
        halo += highlights(camera(uv + o), thr);
    }
    halo /= 12.0;

    c += streak * vec3(0.45, 0.72, 1.0) * 1.6 * u_amount;
    c += halo   * vec3(1.0, 0.95, 0.9)  * 0.7 * u_amount;

    // A lens that flares also loses contrast in the blacks.
    c += vec3(0.012, 0.016, 0.024) * u_amount * smoothstep(0.35, 0.0, luma(c));

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
