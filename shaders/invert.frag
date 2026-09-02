// Photographic negative.
void main() {
    vec3 c = camera(uv);
    fragColor = vec4(mix(c, 1.0 - c, u_amount), 1.0);
}
