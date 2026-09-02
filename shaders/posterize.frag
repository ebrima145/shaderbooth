// Quantise each channel to a small number of levels. Intensity drives the
// level count down rather than blending towards the original, so turning it
// up makes the bands coarser instead of merely more visible.
void main() {
    vec3 c = camera(uv);
    float levels = mix(16.0, 3.0, u_amount);
    fragColor = vec4(floor(c * levels + 0.5) / levels, 1.0);
}
