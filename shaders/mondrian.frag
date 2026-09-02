// Recursive binary splits instead of a fixed grid. A rectangle looks at where
// its strongest edge lies, cuts across it, and hands the two halves down. The
// cut is read off the picture but whether to cut at all is a coin toss, so the
// layout tracks real structure without ever settling into the one obvious
// decomposition of it.
//
// Same trick as `quadtree`: a cell's decisions depend only on its path down
// from the root, never on the pixel asking, so a million independent walks
// agree on one set of lines and no tree is ever built or stored.
//
// What differs is that the axis and the cut position hang off the path alone
// and never off the clock. The line grid then holds still while cells merge
// and divide inside it - the difference between a painting rearranging itself
// and one flickering.
//

#define MAX_SPLITS 13            // finest leaf: about 16 px at 1080p
#define MIN_SPLITS 4             // coarsest: 16 cells - a bare canvas is not a look

const float DETAIL_REF = 0.30;   // tap spread at which a cut is near certain
const float SPLIT_MAX  = 0.93;   // ceiling, so even a busy cell sometimes stops
const float SHAPE_BIAS = 0.45;   // how hard a cell's shape argues for its long axis
const float CUT_JITTER = 0.16;   // wander either side of the thirds
const float ROLL_RATE  = 2.0;    // re-rolls per second, staggered cell by cell
const float BORDER_PX  = 2.5;    // black rules between cells
const float PALETTE    = 0.30;   // pull towards the five colours; 0 is a straight photo
const float SAT_PUSH   = 2.6;    // saturation used only for matching, never for output

const vec3 INK = vec3(0.05, 0.05, 0.06);

// Cells live in a space where x is stretched by the aspect, so that a cell's
// proportions mean the same thing on both axes and the shape vote below is
// fair; this puts a point in it back into UV to sample. The lod is the cell's
// own size, so with mipmap filtering on the input each tap is a genuine local
// average instead of one texel standing in for half the frame.
vec3 frame(vec2 p, float aspect, float lod) {
    return sourceLod(vec2(p.x / aspect, p.y), lod);
}

// lowbias32. The tree indexes by path rather than by grid position, and a path
// is an integer, so the draws come off an integer hash rather than the usual
// fract-of-a-big-sine kind.
uint hashU(uint x) {
    x ^= x >> 16; x *= 0x7feb352du;
    x ^= x >> 15; x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

float rnd(uint a, uint salt) {
    return float(hashU(a * 0x9e3779b9u + salt * 0x85ebca6bu)) * (1.0 / 4294967296.0);
}

// The re-roll clock, offset per cell so the whole canvas does not snap over at
// once ROLL_RATE times a second - staggered, cells come and go on their own.
// The count wraps rather than growing with u_time: a hash fed numbers in the
// tens of thousands runs out of mantissa and starts repeating itself.
uint epoch(uint path, float time) {
    return uint(mod(floor(time * ROLL_RATE + rnd(path, 9u)), 4096.0));
}

// Mondrian's palette is five colours and mostly white. Matching against a
// saturation-boosted copy is what stops a washed-out frame collapsing into
// nothing but white and black cells - the boost decides, the original is what
// gets mixed.
vec3 primary(vec3 c) {
    float g = luma(c);
    vec3 s = clamp(g + (c - g) * SAT_PUSH, 0.0, 1.0);

    vec3 pal[5] = vec3[5](vec3(0.94, 0.93, 0.89), vec3(0.09, 0.09, 0.10),
                          vec3(0.78, 0.10, 0.09), vec3(0.10, 0.22, 0.60),
                          vec3(0.95, 0.80, 0.10));

    vec3 best = pal[0];
    float bd = 1e9;
    for (int i = 0; i < 5; i++) {
        float d = distance(s, pal[i]);
        if (d < bd) { bd = d; best = pal[i]; }
    }
    return best;
}

void main() {
    float aspect = u_res.x / u_res.y;

    // Unlike a quadtree the root need not be square - binary splits handle any
    // rectangle - so it is the frame exactly, with no overhang.
    vec2 pt  = vec2(uv.x * aspect, uv.y);
    vec2 org = vec2(0.0);
    vec2 dim = vec2(aspect, 1.0);
    uint path = 1u;

    vec3 fill = vec3(0.0);

    for (int level = 0; level <= MAX_SPLITS; level++) {
        // A five tap cross: the centre plus one either side on each axis. Three
        // taps along an axis is the fewest that can place a cut *inside* the
        // cell rather than always down its middle, which is the whole point.
        float lod = max(log2(min(dim.x, dim.y) * u_res.y / 3.0), 0.0);

        vec3 tC = frame(org + dim * vec2(0.5,     0.5    ), aspect, lod);
        vec3 tL = frame(org + dim * vec2(1.0/6.0, 0.5    ), aspect, lod);
        vec3 tR = frame(org + dim * vec2(5.0/6.0, 0.5    ), aspect, lod);
        vec3 tD = frame(org + dim * vec2(0.5,     1.0/6.0), aspect, lod);
        vec3 tU = frame(org + dim * vec2(0.5,     5.0/6.0), aspect, lod);

        fill = 0.2 * (tC + tL + tR + tD + tU);

        if (level == MAX_SPLITS) break;

        float lC = luma(tC), lL = luma(tL), lR = luma(tR);
        float lD = luma(tD), lU = luma(tU);

        float hi = max(lC, max(max(lL, lR), max(lD, lU)));
        float lo = min(lC, min(min(lL, lR), min(lD, lU)));

        // u_amount pulls the curve down bodily: at 0 everything cuts to the
        // bottom, at 1 only real contrast buys another line.
        float pSplit = mix(1.0, smoothstep(0.0, DETAIL_REF, hi - lo) * SPLIT_MAX, u_amount);

        if (level >= MIN_SPLITS && rnd(path ^ hashU(epoch(path, u_time)), 1u) > pSplit) break;

        // Cut across the stronger edge, but let the cell's own shape vote, and
        // weight that vote heavily: shape is geometry and holds still, whereas
        // an edge measured off a live camera wobbles, and a cell that keeps
        // changing its mind about the axis takes its whole subtree with it.
        float gxA = abs(lL - lC), gxB = abs(lC - lR);
        float gyA = abs(lD - lC), gyB = abs(lC - lU);
        float shape = (dim.x - dim.y) / (dim.x + dim.y);
        bool cutX = max(gxA, gxB) - max(gyA, gyB) + shape * SHAPE_BIAS > 0.0;

        // Which side of the centre the edge sits on puts the cut on a third.
        float t = cutX ? (gxA > gxB ? 1.0 / 3.0 : 2.0 / 3.0)
                       : (gyA > gyB ? 1.0 / 3.0 : 2.0 / 3.0);
        t = clamp(t + (rnd(path, 2u) - 0.5) * CUT_JITTER, 0.22, 0.78);

        float span = cutX ? dim.x : dim.y;
        float base = cutX ? org.x : org.y;
        float cut  = base + span * t;
        bool  far  = (cutX ? pt.x : pt.y) >= cut;

        float nOrg = far ? cut : base;
        float nDim = far ? base + span - cut : cut - base;

        if (cutX) { org.x = nOrg; dim.x = nDim; }
        else      { org.y = nOrg; dim.y = nDim; }

        path = path * 2u + (far ? 1u : 0u);
    }

    fill = mix(fill, primary(fill), PALETTE * u_amount);

    // Rules, measured in pixels so they stay the same weight whether the cell
    // is sixteen pixels across or six hundred.
    vec2 f = (pt - org) / dim;
    vec2 dpx = dim * u_res.y;
    float e = min(min(f.x, 1.0 - f.x) * dpx.x, min(f.y, 1.0 - f.y) * dpx.y);
    float grid = 1.0 - smoothstep(BORDER_PX - 1.0, BORDER_PX, e);

    fill = mix(fill, INK, grid * u_amount);

    fragColor = (vec4(clamp(fill, 0.0, 1.0), 1.0));
}
