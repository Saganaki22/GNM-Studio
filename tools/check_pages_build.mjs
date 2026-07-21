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
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "og-image.png",
  "robots.txt",
  "sitemap.xml",
  "models/gnm_head_runtime.glb",
  "models/gnm_identity_basis.gni.gz",
  "models/gnm_expression_basis.gne.gz",
  "models/facecap.glb",
  "models/face_landmarker.task",
  "wasm/vision_wasm_internal.wasm",
];

for (const path of required) {
  if (!existsSync(join(rootPath, path))) throw new Error(`GitHub Pages build is missing ${path}`);
}

const assetNames = readdirSync(join(rootPath, "assets"));
for (const extension of [".js", ".wasm"]) {
  if (!assetNames.some((name) => name.startsWith("basis_transcoder-") && name.endsWith(extension))) {
    throw new Error(`GitHub Pages build is missing its bundled Basis/KTX2 transcoder ${extension} asset`);
  }
}

const index = readFileSync(join(rootPath, "index.html"), "utf8");
if (!index.includes("/GNM-Studio/")) throw new Error("index.html is not using the /GNM-Studio/ project base path");
for (const metadata of [
  "rel=\"icon\" type=\"image/svg+xml\" href=\"/GNM-Studio/favicon.svg\"",
  "rel=\"canonical\" href=\"https://drbaph.is-a.dev/GNM-Studio/\"",
  "property=\"og:url\" content=\"https://drbaph.is-a.dev/GNM-Studio/\"",
  "property=\"og:image\" content=\"https://drbaph.is-a.dev/GNM-Studio/og-image.png\"",
  "property=\"og:image:width\" content=\"1200\"",
  "property=\"og:image:height\" content=\"630\"",
  "name=\"twitter:card\" content=\"summary_large_image\"",
  "application/ld+json",
]) {
  if (!index.includes(metadata)) throw new Error(`index.html is missing SEO metadata: ${metadata}`);
}
if (/\b(?:src|href)=["']\/(?!GNM-Studio\/)/.test(index)) {
  throw new Error("index.html contains a root-relative URL outside /GNM-Studio/");
}

const manifest = JSON.parse(readFileSync(join(rootPath, "site.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  throw new Error("Web manifest must stay relative to the project Pages path");
}

const ogImage = readFileSync(join(rootPath, "og-image.png"));
if (ogImage.toString("hex", 1, 4) !== "504e47" || ogImage.readUInt32BE(16) !== 1200 || ogImage.readUInt32BE(20) !== 630) {
  throw new Error("Open Graph image must be a 1200x630 PNG");
}
const sitemap = readFileSync(join(rootPath, "sitemap.xml"), "utf8");
if (!sitemap.includes("<loc>https://drbaph.is-a.dev/GNM-Studio/</loc>")) {
  throw new Error("Sitemap is missing the canonical GNM Studio URL");
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
  const rootAssetPattern = /(["'`])\/(?:models|wasm|textures|head-svgrepo|favicon)(?:\/|\.)/g;
  const unsafeMatches = [...source.matchAll(rootAssetPattern)].filter((match) => {
    // Transformers.js contains its own `/models/` default even when local
    // loading is explicitly disabled by our worker. It is not a requested URL.
    const inertTransformersDefault = match[0].slice(1) === "/models/"
      && source.includes("allowLocalModels=!1");
    return !inertTransformersDefault;
  });
  if (unsafeMatches.length) {
    throw new Error(`${relative(rootPath, path)} contains a desktop-root asset URL`);
  }
}

console.log(`GitHub Pages build verified: ${textFiles.length} text bundles, ${required.length} required assets, and offline Basis/KTX2 transcoder.`);
