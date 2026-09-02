// The original DMG: chunky pixels and four shades of that green-grey LCD.
// A 2x2 ordered dither goes in before the quantise, or four tones across a
// whole face produces bands you could measure with a ruler.
const vec3 PAL[4] = vec3[4](
    vec3(0.059, 0.220, 0.059),
    vec3(0.188, 0.384, 0.188),
    vec3(0.545, 0.675, 0.059),
    vec3(0.608, 0.737, 0.059)
);

void main() {
    float cells = mix(320.0, 100.0, u_amount);
    vec2 grid = vec2(cells, cells * u_res.y / u_res.x);
    vec2 cell = floor(uv * grid);

    float l = luma(camera((cell + 0.5) / grid));

    float bayer[4] = float[4](0.0, 0.5, 0.75, 0.25);
    ivec2 b = ivec2(mod(cell, 2.0));
    l += (bayer[b.x + b.y * 2] - 0.375) * 0.20;

    int idx = int(clamp(floor(l * 4.0), 0.0, 3.0));
    fragColor = vec4(PAL[idx], 1.0);
}
