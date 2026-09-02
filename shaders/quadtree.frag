// A quadtree that decides where to subdivide by rolling dice. Each cell looks
// at how much its four quadrants disagree, turns that disagreement into a
// probability, and draws against it: busy cells usually split, flat ones
// usually do not, and either can go the other way. The image keeps its shape
// while the block layout stays unsettled - the same frame never resolves into
// quite the same mosaic twice.
//
// No tree is built or stored. Every fragment walks its own path from the root
// down, and the trick that makes those independent walks agree is that a
// cell's decision depends only on its index and its level - never on the pixel
// asking. Two pixels in the same cell therefore draw the same number, take the
// same branch, and land in the same leaf.
//

#define MAX_SPLITS 8             // finest leaf: 256 cells across the root square
#define MIN_SPLITS 3             // coarsest leaf: 8x8 - one huge block is not a look

const float DETAIL_REF = 0.28;   // quadrant spread at which a split is near certain
const float SPLIT_MAX  = 0.94;   // ceiling, so even the busiest cell sometimes stops
const float ROLL_RATE  = 2.5;    // re-rolls per second, staggered cell by cell
const float EDGE_DARK  = 0.35;   // how far the cell borders darken

// The tree lives in a space where x is stretched by the aspect, so that cells
// come out square on screen; this puts a point in it back into UV to sample.
// The lod is the cell's own size, so with mipmap filtering on the input each
// tap is that quadrant's average rather than one pixel out of thousands -
// which is what the detail measure below actually wants to compare. Without
// mipmaps it quietly falls back to point sampling and still works.
vec3 quadSample(vec2 p, float aspect, float lod) {
    return sourceLod(vec2(p.x / aspect, p.y), lod);
}

float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

// This cell's draw. The stagger is a fixed per-cell phase on the re-roll
// clock, so the tree does not snap over all at once every 1/ROLL_RATE second -
// cells come and go independently. The epoch wraps rather than growing with
// u_time: a hash fed numbers in the tens of thousands runs out of mantissa and
// starts repeating itself visibly.
float roll(ivec2 idx, int level, float time) {
    vec2  fi = vec2(idx);
    float lv = float(level);
    float stagger = hash31(vec3(fi, lv));
    float epoch = mod(floor(time * ROLL_RATE + stagger), 512.0) * 0.6180339;
    return hash31(vec3(fi + epoch, lv + 0.5));
}

void main() {
    float aspect = u_res.x / u_res.y;

    // Root cell: the smallest square that covers the frame. On a wide frame it
    // overhangs top and bottom, which costs nothing - the frame is a window
    // onto the tree, not the whole of it.
    float root = max(aspect, 1.0);
    vec2 pt  = vec2(uv.x * aspect, uv.y);
    vec2 org = 0.5 * vec2(aspect, 1.0) - 0.5 * root;
    float size = root;
    ivec2 idx = ivec2(0);

    vec3 fill = vec3(0.0);

    for (int level = 0; level <= MAX_SPLITS; level++) {
        float h = size * 0.5;
        float q = size * 0.25;
        float lod = max(log2(h * u_res.y), 0.0);

        vec3 c00 = quadSample(org + vec2(q,     q    ), aspect, lod);
        vec3 c10 = quadSample(org + vec2(q + h, q    ), aspect, lod);
        vec3 c01 = quadSample(org + vec2(q,     q + h), aspect, lod);
        vec3 c11 = quadSample(org + vec2(q + h, q + h), aspect, lod);

        fill = 0.25 * (c00 + c10 + c01 + c11);

        if (level == MAX_SPLITS) break;

        float l0 = luma(c00), l1 = luma(c10), l2 = luma(c01), l3 = luma(c11);
        float detail = max(max(l0, l1), max(l2, l3)) - min(min(l0, l1), min(l2, l3));

        // u_amount pulls the whole curve down: at 0 every cell splits and the
        // output is a fine uniform grid, at 1 only real contrast buys depth.
        float pSplit = mix(1.0, smoothstep(0.0, DETAIL_REF, detail) * SPLIT_MAX, u_amount);

        if (level >= MIN_SPLITS && roll(idx, level, u_time) > pSplit) break;

        vec2 child = step(org + vec2(h), pt);
        org  += child * h;
        size  = h;
        idx   = idx * 2 + ivec2(child);
    }

    // Borders, measured in pixels rather than in cell units, so the line stays
    // one pixel wide whether the leaf is four pixels across or four hundred.
    vec2 f = (pt - org) / size;
    float edge = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)) * size * u_res.y;
    float line = 1.0 - smoothstep(0.5, 1.5, edge);

    fill *= 1.0 - EDGE_DARK * u_amount * line;

    fragColor = (vec4(clamp(fill, 0.0, 1.0), 1.0));
}
