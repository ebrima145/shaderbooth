#version 300 es

// Every effect is one fullscreen triangle strip. The quad is given in clip
// space directly, so there is no projection matrix to keep in step with the
// canvas - the effect always covers exactly the framebuffer it renders into.

in vec2 position;
out vec2 uv;

void main() {
    gl_Position = vec4(position, 0.0, 1.0);
    uv = position * 0.5 + 0.5;
}
