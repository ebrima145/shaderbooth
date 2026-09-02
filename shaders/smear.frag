// Pixel smear, the live cousin of a pixel sort. A real sort needs the whole
// column in memory at once, which one pass can't do - but the same look
// falls out of a rule applied every frame: if the pixel above you was
// bright, take its colour. Highlights then drag downward frame after frame
// into long runs, and a slow bleed back to the live image keeps the streaks
// from eating the picture entirely.
void main() {
    vec3 c = camera(uv);
    float threshold = mix(0.78, 0.32, u_amount);

    vec3 above = feedback(uv + vec2(0.0, 1.0 / u_res.y));

    vec3 outc = (luma(above) > threshold && luma(c) > threshold * 0.55) ? above : c;
    outc = mix(outc, c, mix(0.10, 0.03, u_amount));

    fragColor = vec4(outc, 1.0);
}
