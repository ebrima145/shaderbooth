// Sobel edge detection, with the gradient magnitude driving the brightness
// of a glow and the *source* colour driving its hue - so different regions
// outline in different colours instead of the whole frame glowing one shade.
// Turning the intensity up fades the underlying picture out, until at full
// strength the edges float alone on black.
void main() {
    vec2 t = texel();
    float kx[9] = float[9](-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0);
    float ky[9] = float[9](-1.0, -2.0, -1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.0);

    float gx = 0.0;
    float gy = 0.0;
    int i = 0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float l = luma(camera(uv + vec2(float(x), float(y)) * t));
            gx += l * kx[i];
            gy += l * ky[i];
            i++;
        }
    }

    float g = pow(clamp(length(vec2(gx, gy)) * mix(1.0, 3.2, u_amount), 0.0, 1.0), 0.75);

    vec3 src = camera(uv);
    float hue = fract(rgb2hsv(src).x * 0.5 + luma(src) * 0.45 + u_time * 0.04);
    vec3 glow = hsv2rgb(vec3(hue, 0.85, 1.0));

    fragColor = vec4(src * (1.0 - u_amount) + glow * g * 1.25, 1.0);
}
