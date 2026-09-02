// ASCII art, glyphs and all. Each 5x5 character is packed into the bits of
// an int - no font texture to ship - and the cell's average brightness picks
// which of the nine, ordered light to heavy.
//
// The cell is *averaged*, not point-sampled: sampling one pixel per cell
// makes the chosen glyph flicker wildly on any noise in the image.
int glyphBits(int i) {
    if (i == 0) return 0;           // (blank)
    if (i == 1) return 4194304;     // .
    if (i == 2) return 131200;      // :
    if (i == 3) return 14336;       // -
    if (i == 4) return 459200;      // =
    if (i == 5) return 145536;      // +
    if (i == 6) return 473536;      // *
    if (i == 7) return 11512810;    // #
    return 15728622;                // @
}

void main() {
    float cell = mix(14.0, 7.0, u_amount);
    vec2 grid = u_res / cell;
    vec2 cellIdx = floor(uv * grid);
    vec2 cellUV = fract(uv * grid);

    vec3 avg = vec3(0.0);
    for (int y = 0; y < 3; y++) {
        for (int x = 0; x < 3; x++) {
            avg += camera((cellIdx + (vec2(float(x), float(y)) + 0.5) / 3.0) / grid);
        }
    }
    avg /= 9.0;

    int idx = int(clamp(floor(luma(avg) * 9.0), 0.0, 8.0));

    ivec2 b = ivec2(floor(cellUV * 5.0));
    int bit = (4 - b.y) * 5 + b.x;   // glyph rows are top-down, uv is bottom-up
    bool on = (glyphBits(idx) & (1 << bit)) != 0;

    vec3 ink = mix(avg * 1.7, vec3(0.55, 1.0, 0.60), u_amount);
    vec3 paper = mix(avg * 0.10, vec3(0.02, 0.04, 0.02), u_amount);

    fragColor = vec4(on ? ink : paper, 1.0);
}
