// Rolling shutter. A CMOS sensor reads out one row at a time, so every row
// of a frame is a slightly different moment - move the camera and the image
// shears. Approximated by shearing rows along a travelling wave, with a
// second faster wave on top so the wobble doesn't read as one clean sine.
void main() {
    float shear = sin(uv.y * 8.0 - u_time * 2.2) * 0.022 * u_amount;
    shear += sin(uv.y * 31.0 - u_time * 5.3) * 0.006 * u_amount;

    vec2 p = uv + vec2(shear, 0.0);
    p.y += sin(u_time * 1.7) * 0.004 * u_amount;

    fragColor = vec4(camera(p), 1.0);
}
