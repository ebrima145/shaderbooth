// Kuwahara filter - the painterly one. For each pixel, look at the four
// square quadrants that overlap it, and take the mean colour of whichever one
// has the lowest variance. A quadrant that straddles an edge always has high
// variance and so is never the one chosen, which is why edges come out sharp
// while everything inside them flattens into brush strokes. It is an edge
// preserving blur that happens to look like oil paint.
//
// Cost: four quadrants of up to 7x7 taps, so ~196 samples per pixel at
// u_amount 1. Drop the R below if that is too much at your resolution.
//

const int R = 6;   // largest quadrant edge, in pixels

void main() {
    vec2 texel = 1.0 / u_res;

    vec3 c0 = camera(uv);

    int ir = int(ceil(mix(1.0, float(R), u_amount)));

    vec3  best    = c0;
    float bestVar = 1e9;

    for (int q = 0; q < 4; q++) {
        // (+,+), (-,+), (-,-), (+,-)
        vec2 dir = vec2((q == 0 || q == 3) ? 1.0 : -1.0,
                        (q < 2)            ? 1.0 : -1.0);

        vec3 sum = vec3(0.0), sum2 = vec3(0.0);
        float n = 0.0;

        for (int y = 0; y <= R; y++) {
            if (y > ir) break;
            for (int x = 0; x <= R; x++) {
                if (x > ir) break;
                vec3 s = camera(uv + vec2(float(x), float(y)) * dir * texel);
                sum  += s;
                sum2 += s * s;
                n    += 1.0;
            }
        }

        vec3 mean = sum / n;
        vec3 var  = abs(sum2 / n - mean * mean);
        float v   = var.r + var.g + var.b;

        if (v < bestVar) {
            bestVar = v;
            best    = mean;
        }
    }

    // Flattening the colour also flattens the saturation, so put some back -
    // paint is more saturated than the scene it was mixed from.
    float g = dot(best, vec3(0.299, 0.587, 0.114));
    best = mix(vec3(g), best, 1.0 + 0.35 * u_amount);

    vec3 c = mix(c0, best, u_amount);

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
