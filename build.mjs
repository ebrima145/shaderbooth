/*
 * build.mjs
 *
 * Folds the whole app into one self-contained HTML file in dist/.
 *
 * The app is a folder of static files and is perfectly happy served as one -
 * see the README. This exists for the other way of sharing it: a single file
 * you can put anywhere, attach to a message, or drop into an object store,
 * with no build tooling, no dependency install and no directory layout to get
 * wrong at the far end. Open the folder or open the file; the app is identical
 * either way.
 *
 * Two things are inlined that would otherwise be fetched:
 *
 * - **The shaders**, as a SHADER_SOURCES object on window. effects.js checks
 *   for it before reaching for fetch(), so the same code path serves both
 *   builds.
 *
 * - **The JavaScript**, by concatenating the ES modules in dependency order
 *   and stripping the import/export keywords. That is a real cheat rather than
 *   a bundler, and it only works because these modules share no top-level
 *   names - so the concatenation is checked for collisions and refuses to
 *   write a file it cannot vouch for, rather than emitting one that fails at
 *   runtime in a way nobody would connect back to here.
 *
 * Node stdlib only, and no package.json, on purpose. A real bundler would do
 * the module handling properly instead of by regex, and would cost this
 * project the one property it is best at: there is nothing to install. The
 * cheat is guarded; an npm tree is not, and it would have to be kept alive for
 * as long as the app is.
 *
 * .mjs rather than .js so Node reads it as a module without a package.json
 * existing only to say "type": "module".
 *
 * A single file still cannot be opened from a file:// path and reach the
 * camera: getUserMedia needs a secure context, and file:// is not one. It has
 * to be served, even locally. Nothing about bundling changes that - see the
 * README.
 *
 * Usage:  node build.mjs  [-o dist/shaderbooth.html]
 */

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Dependency order: a module may only use names defined above it.
const MODULES = ["effects.js", "chain.js", "renderer.js", "camera.js",
                 "recorder.js", "main.js"];

// Takes the line's own newline with it, so five stripped imports leave no gap
// rather than five blank lines at the top of every module in the output.
const IMPORT = /^[ \t]*import\s+[^;]*?from\s+["'][^"']+["'];?[ \t]*\n?/gm;
const EXPORT = /^([ \t]*)export\s+(?=(?:const|let|var|function|class|async)\b)/gm;

// Top-level declarations, for the collision check. Anchored at column zero, so
// anything indented - and therefore inside a function or a class - is not a
// top-level name and cannot collide with one.
const DECLARED = /^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * Read a text file with its line endings normalised to LF.
 *
 * Everything here is embedded in a JavaScript string literal, where a CRLF
 * costs a wasted \r in the output for every line of every shader - about 3 KB
 * across the set - and makes the build non-deterministic between a checkout
 * with git's autocrlf on and one without. Python's text mode did this
 * silently; Node hands back exactly what is on disk, so it has to be asked
 * for. GLSL itself accepts either.
 */
async function readText(...parts) {
  return (await readFile(join(...parts), "utf8")).replaceAll("\r\n", "\n");
}

/** One ES module as a plain script body. */
function stripModule(text) {
  return text.replace(IMPORT, "").replace(EXPORT, "$1");
}

/**
 * Refuse to build if two modules declare the same top-level name.
 *
 * Concatenation puts every module in one scope, where `const` declared twice
 * is a SyntaxError that takes the whole page down and points at a generated
 * file. Catching it here names the two modules instead.
 */
function checkCollisions(bodies) {
  const seen = new Map();
  const clashes = [];
  for (const [name, body] of bodies) {
    for (const match of body.matchAll(DECLARED)) {
      const declared = match[1];
      if (seen.has(declared)) clashes.push(`  '${declared}': ${seen.get(declared)} and ${name}`);
      else seen.set(declared, name);
    }
  }
  return clashes;
}

/** A JSON string safe to sit inside a <script> element. */
function jsString(text) {
  return JSON.stringify(text).replaceAll("</", "<\\/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.findIndex((a) => a === "-o" || a === "--output");
  const target = at >= 0 ? argv[at + 1] : "dist/shaderbooth.html";
  if (at >= 0 && !target) fail("-o needs a path");

  let html = await readText(ROOT, "index.html");
  const css = await readText(ROOT, "css", "style.css");

  const shaderDir = join(ROOT, "shaders");
  const shaders = {};
  for (const name of (await readdir(shaderDir)).sort()) {
    if ([".frag", ".vert", ".glsl"].includes(extname(name))) {
      shaders[name] = await readText(shaderDir, name);
    }
  }
  if (Object.keys(shaders).length < 3) {
    fail(`only ${Object.keys(shaders).length} shaders found in ${shaderDir} - `
       + `is this being run from the project folder?`);
  }

  const bodies = [];
  for (const name of MODULES) {
    bodies.push([name, stripModule(await readText(ROOT, "js", name))]);
  }

  const clashes = checkCollisions(bodies);
  if (clashes.length) {
    fail("cannot bundle: modules declare the same top-level names.\n"
      + clashes.join("\n")
      + "\nRename one of each pair, or teach build.mjs to wrap modules in an IIFE.");
  }

  const script =
    // Parsed from a string literal rather than written as an object literal:
    // it is measurably faster to parse, and it makes it impossible for shader
    // text to end the <script> element early.
    "window.SHADER_SOURCES = JSON.parse(" + jsString(JSON.stringify(shaders)) + ");\n\n"
    + bodies.map(([name, body]) => `/* ==== ${name} ==== */\n${body}`).join("\n");

  html = html.replace('<link rel="stylesheet" href="css/style.css">',
                      "<style>\n" + css + "\n</style>");
  html = html.replace('<script type="module" src="js/main.js"></script>',
                      "<script>\n" + script + "\n</script>");

  if (html.includes("css/style.css") || html.includes('src="js/main.js"')) {
    fail("index.html no longer contains the tags build.mjs replaces - "
       + "update the two replace() calls above.");
  }

  const output = resolve(ROOT, target);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");

  const { size } = await stat(output);
  console.log(`wrote ${relative(ROOT, output)}  `
    + `(${Math.round(size / 1024)} KB, ${Object.keys(shaders).length} shaders inlined)`);
}

main();
