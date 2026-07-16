import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../gh-pages/", import.meta.url);
const rootPath = fileURLToPath(root);
const required = [
  "index.html",
  ".nojekyll",
  "site.webmanifest",
  "favicon.svg",
  "models/gnm_head_runtime.glb",
  "models/face_landmarker.task",
  "wasm/vision_wasm_internal.wasm",
];

for (const path of required) {
  if (!existsSync(join(rootPath, path))) throw new Error(`GitHub Pages build is missing ${path}`);
}

const index = readFileSync(join(rootPath, "index.html"), "utf8");
if (!index.includes("/GNM-Studio/")) throw new Error("index.html is not using the /GNM-Studio/ project base path");
if (/\b(?:src|href)=["']\/(?!GNM-Studio\/)/.test(index)) {
  throw new Error("index.html contains a root-relative URL outside /GNM-Studio/");
}

const manifest = JSON.parse(readFileSync(join(rootPath, "site.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  throw new Error("Web manifest must stay relative to the project Pages path");
}

const textFiles = [];
const visit = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) visit(path);
    else if (/\.(?:js|css|html)$/.test(name)) textFiles.push(path);
  }
};
visit(rootPath);
for (const path of textFiles) {
  const source = readFileSync(path, "utf8");
  if (/(["'`])\/(?:models|wasm|textures|head-svgrepo|favicon)(?:\/|\.)/.test(source)) {
    throw new Error(`${relative(rootPath, path)} contains a desktop-root asset URL`);
  }
}

console.log(`GitHub Pages build verified: ${textFiles.length} text bundles and ${required.length} required assets.`);
