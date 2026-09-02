// Toned monochrome: strip the colour, then tint the greys warm and lift the
// shadows slightly, which is what separates sepia from "brown grayscale".
void main() {
    vec3 c = camera(uv);
    float l = luma(c);
    vec3 toned = vec3(l) * vec3(1.16, 0.96, 0.72) + vec3(0.06, 0.03, 0.0);
    fragColor = vec4(clamp(mix(c, toned, u_amount), 0.0, 1.0), 1.0);
}
