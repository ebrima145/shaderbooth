// False-colour heat map. The ramp is stacked smoothsteps rather than a
// palette texture, so the transitions stay smooth at any bit depth.
vec3 ramp(float t) {
    vec3 c = vec3(0.0, 0.0, 0.12);
    c = mix(c, vec3(0.24, 0.00, 0.62), smoothstep(0.00, 0.22, t));
    c = mix(c, vec3(0.86, 0.06, 0.36), smoothstep(0.22, 0.44, t));
    c = mix(c, vec3(1.00, 0.32, 0.00), smoothstep(0.44, 0.64, t));
    c = mix(c, vec3(1.00, 0.82, 0.10), smoothstep(0.64, 0.84, t));
    c = mix(c, vec3(1.00, 1.00, 0.96), smoothstep(0.84, 1.00, t));
    return c;
}

void main() {
    vec3 src = camera(uv);
    float l = clamp((luma(src) - 0.5) * 1.7 + 0.5, 0.0, 1.0);
    fragColor = vec4(mix(src, ramp(l), u_amount), 1.0);
}
