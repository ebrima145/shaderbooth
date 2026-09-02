// Print halftone: dot size tracks how dark the cell is. The grid is rotated
// 15 degrees the way a real screen angle is, because an axis-aligned dot
// grid beats against the pixel grid and moires immediately.
void main() {
    float cell = mix(16.0, 6.0, u_amount);
    mat2 R = rot(0.2618);

    vec2 g = (R * (uv * u_res)) / cell;
    vec2 cellIdx = floor(g);
    vec2 f = fract(g) - 0.5;

    // Back out of the rotated grid to find where this cell samples from.
    vec2 centre = (transpose(R) * ((cellIdx + 0.5) * cell)) / u_res;
    vec3 c = camera(clamp(centre, 0.0, 1.0));

    float r = sqrt(1.0 - luma(c)) * 0.72;
    float dot_ = smoothstep(r, r - 0.09, length(f));

    vec3 ink = mix(c * 0.55, vec3(0.04), u_amount);
    vec3 paper = mix(c * 1.1, vec3(1.0), u_amount);

    fragColor = vec4(clamp(mix(paper, ink, dot_), 0.0, 1.0), 1.0);
}
