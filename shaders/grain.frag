// Film grain, weighted towards the mid-tones. Real emulsion grain is a
// property of the exposed silver, so it all but vanishes in clipped
// highlights and empty shadows - uniform noise over the whole frame is the
// giveaway of a fake. Comes with a warm print bias and a soft vignette.
void main() {
    vec3 c = camera(uv);
    float l = luma(c);

    float n = hash21(uv * u_res + fract(u_time) * 1013.0) - 0.5;
    float weight = 4.0 * l * (1.0 - l);
    c += n * 0.26 * u_amount * weight;

    c = mix(c, c * vec3(1.05, 1.0, 0.95), u_amount);

    vec2 d = uv - 0.5;
    d.x *= u_res.x / u_res.y;
    c *= 1.0 - 0.55 * u_amount * dot(d, d);

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
