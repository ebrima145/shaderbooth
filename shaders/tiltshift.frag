// Tilt-shift miniature. A horizontal band stays sharp and everything above
// and below it defocuses, which is what a swung lens plane does - and because
// a depth of field that shallow only ever happens on tiny subjects, the brain
// reads the whole frame as a model. The saturation and contrast lift sells
// it: model paint is brighter than the world.
//
// The band sits across the middle of the frame. Move BAND_Y if your horizon
// is somewhere else; that is the one constant worth editing per shot.
//

const float BAND_Y = 0.5;    // centre of the sharp strip, in UV
const float BAND_H = 0.14;   // half-height of it
const float FALLOFF = 0.20;  // how far past the band the blur takes to arrive

void main() {
    float aspect = u_res.x / u_res.y;

    float d = abs(uv.y - BAND_Y);
    float blur = smoothstep(BAND_H, BAND_H + FALLOFF, d) * u_amount * 0.022;

    // Golden-angle spiral: 24 taps that land evenly on the disc without the
    // ring structure a naive polar loop leaves behind in the bokeh.
    vec3 c = vec3(0.0);
    for (int i = 0; i < 24; i++) {
        float fi = float(i);
        float a = fi * 2.39996323;
        float r = sqrt((fi + 0.5) / 24.0) * blur;
        c += camera(uv + vec2(cos(a) / aspect, sin(a)) * r);
    }
    c /= 24.0;

    float g = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(g), c, 1.0 + 0.45 * u_amount);        // saturation
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.5 * u_amount); // contrast, smoothstep-shaped

    fragColor = (vec4(clamp(c, 0.0, 1.0), 1.0));
}
