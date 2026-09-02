// Slit-scan. Only the row through the middle of the frame is live; every
// other row is the previous output shifted one step further from that slit.
// The picture is therefore a record of time rather than of space - the
// further from the centre a row is, the older the moment it holds.
void main() {
    float rowH = 1.0 / u_res.y;
    float speed = mix(1.0, 3.0, u_amount);
    float slit = 0.5;

    if (abs(uv.y - slit) <= rowH * speed * 1.5) {
        fragColor = vec4(camera(uv), 1.0);
        return;
    }

    // Pull from the side nearer the slit, so content marches outward.
    float dir = uv.y > slit ? -1.0 : 1.0;
    fragColor = vec4(feedback(uv + vec2(0.0, dir * rowH * speed)), 1.0);
}
