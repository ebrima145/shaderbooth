/*
 * serve.mjs
 *
 * A static file server for developing against, because the app cannot be
 * opened from a file:// path.
 *
 * Not for hosting anything - it has no compression, no ranges, no logging
 * worth the name and it caches nothing on purpose. It exists so that
 * `node serve.mjs` puts the app on http://localhost, which is one of the two
 * origins a browser will hand a camera to. Any static host will do for the
 * real thing; see the README.
 *
 * Node stdlib only, and about sixty lines, rather than `npx serve`: this way
 * it works on a machine that has never seen this project, offline, with
 * nothing downloaded and nothing left behind.
 *
 * Usage:  node serve.mjs [port]
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 8712;

// text/javascript on .js is the one that actually matters: a browser refuses
// to run an ES module served as anything else, and the failure is a bare
// "disallowed MIME type" in the console with nothing pointing here.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".frag": "text/plain; charset=utf-8",
  ".vert": "text/plain; charset=utf-8",
  ".glsl": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // normalize() collapses the ".." before it is joined, so a request for
  // /../../.ssh/id_rsa resolves inside ROOT or not at all. The second check is
  // belt and braces against symlinks and case-folding on Windows.
  const file = join(ROOT, normalize(pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error("directory");
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Content-Length": info.size,
      // Edit a shader, reload, see the shader. A dev server that caches is a
      // dev server that lies to you for the rest of the afternoon.
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Shaderbooth  ->  http://localhost:${PORT}`);

  const lan = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  if (lan.length) {
    console.log(`\nOn this network: ${lan.map((a) => `http://${a}:${PORT}`).join("  ")}`);
    console.log("...which will load, but will NOT get a camera: browsers give");
    console.log("getUserMedia only to https:// and localhost. To try it on a");
    console.log("phone, put it behind a tunnel (cloudflared, ngrok) or a real host.");
  }
});
