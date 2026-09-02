// Luminance-weighted desaturation, not a flat channel average - a straight
// average makes reds read far too bright and greens too dark.
void main() {
    vec3 c = camera(uv);
    fragColor = vec4(mix(c, vec3(luma(c)), u_amount), 1.0);
}
