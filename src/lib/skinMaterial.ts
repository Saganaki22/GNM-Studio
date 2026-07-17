import * as THREE from "three";
import type { SkinTone } from "../types";
import { assetUrl } from "./assets";

export const skinToneOptions: ReadonlyArray<{
  id: SkinTone;
  label: string;
  swatch: string;
  baseColor: number;
  map: string;
}> = [
  { id: "neutral", label: "Neutral", swatch: "#ffffff", baseColor: 0xffffff, map: "textures/skin/skin-tone-light.jpg" },
  { id: "light", label: "Light", swatch: "#e7b997", baseColor: 0xe7b997, map: "textures/skin/skin-tone-light.jpg" },
  { id: "warm", label: "Warm", swatch: "#c9825f", baseColor: 0xc9825f, map: "textures/skin/skin-tone-warm.jpg" },
  { id: "medium", label: "Medium", swatch: "#9d6045", baseColor: 0x9d6045, map: "textures/skin/skin-tone-medium.jpg" },
  { id: "deep", label: "Deep", swatch: "#6f4233", baseColor: 0x6f4233, map: "textures/skin/skin-tone-deep.jpg" },
  { id: "rich", label: "Rich", swatch: "#442a25", baseColor: 0x442a25, map: "textures/skin/skin-tone-rich.jpg" },
];

export type SkinTextureSet = {
  color: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  displacement: THREE.CanvasTexture;
  occlusion: THREE.CanvasTexture;
  specular: THREE.CanvasTexture;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(path: string) {
  const existing = imageCache.get(path);
  if (existing) return existing;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load skin texture: ${path}`));
    image.src = path;
  });
  imageCache.set(path, pending);
  return pending;
}

function featheredCanvas(image: HTMLImageElement, feather: number) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not create the skin texture canvas.");
  context.drawImage(image, 0, 0);
  const featherPixels = Math.min(
    Math.floor(Math.min(canvas.width, canvas.height) * Math.min(0.3, Math.max(0, feather))),
    Math.floor(Math.min(canvas.width, canvas.height) / 2) - 1,
  );
  if (featherPixels <= 0) return canvas;

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const channels = 4;
  const blendPair = (first: number, second: number, retain: number, source: Uint8ClampedArray) => {
    const blend = 1 - retain;
    for (let channel = 0; channel < channels; channel += 1) {
      const average = (source[first + channel] + source[second + channel]) * 0.5;
      data[first + channel] = Math.round(average * blend + source[first + channel] * retain);
      data[second + channel] = Math.round(average * blend + source[second + channel] * retain);
    }
  };

  let source = new Uint8ClampedArray(data);
  for (let distance = 0; distance < featherPixels; distance += 1) {
    const amount = featherPixels <= 1 ? 0 : distance / (featherPixels - 1);
    const retain = amount * amount * (3 - 2 * amount);
    const left = distance;
    const right = canvas.width - 1 - distance;
    for (let y = 0; y < canvas.height; y += 1) {
      blendPair((y * canvas.width + left) * channels, (y * canvas.width + right) * channels, retain, source);
    }
  }

  source = new Uint8ClampedArray(data);
  for (let distance = 0; distance < featherPixels; distance += 1) {
    const amount = featherPixels <= 1 ? 0 : distance / (featherPixels - 1);
    const retain = amount * amount * (3 - 2 * amount);
    const top = distance;
    const bottom = canvas.height - 1 - distance;
    for (let x = 0; x < canvas.width; x += 1) {
      blendPair((top * canvas.width + x) * channels, (bottom * canvas.width + x) * channels, retain, source);
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function canvasTexture(image: HTMLImageElement, feather: number, color = false) {
  const texture = new THREE.CanvasTexture(featheredCanvas(image, feather));
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.center.set(0.5, 0.5);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function neutralColorTexture(image: HTMLImageElement, feather: number) {
  const canvas = featheredCanvas(image, feather);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not neutralize the skin colour texture.");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminanceTotal = 0;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    luminanceTotal += pixels.data[offset] * 0.2126 + pixels.data[offset + 1] * 0.7152 + pixels.data[offset + 2] * 0.0722;
  }
  const average = luminanceTotal / Math.max(1, pixels.data.length / 4);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const luminance = pixels.data[offset] * 0.2126 + pixels.data[offset + 1] * 0.7152 + pixels.data[offset + 2] * 0.0722;
    const neutral = Math.min(255, Math.max(0, Math.round(238 + (luminance - average) * 0.42)));
    pixels.data[offset] = neutral;
    pixels.data[offset + 1] = neutral;
    pixels.data[offset + 2] = neutral;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.center.set(0.5, 0.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export async function loadSkinTextureSet(tone: SkinTone, feather: number) {
  const toneOption = skinToneOptions.find((option) => option.id === tone) ?? skinToneOptions[0];
  const [color, normal, displacement, occlusion, specular] = await Promise.all([
    loadImage(assetUrl(toneOption.map)),
    loadImage(assetUrl("textures/skin/skin-normal.jpg")),
    loadImage(assetUrl("textures/skin/skin-displacement.jpg")),
    loadImage(assetUrl("textures/skin/skin-occlusion.jpg")),
    loadImage(assetUrl("textures/skin/skin-specular.jpg")),
  ]);
  return {
    color: tone === "neutral" ? neutralColorTexture(color, feather) : canvasTexture(color, feather, true),
    normal: canvasTexture(normal, feather),
    displacement: canvasTexture(displacement, feather),
    occlusion: canvasTexture(occlusion, feather),
    specular: canvasTexture(specular, feather),
  } satisfies SkinTextureSet;
}

export function configureSkinTextureSet(
  textures: SkinTextureSet,
  scale: number,
  rotationDegrees: number,
  anisotropy = 8,
) {
  const rotation = THREE.MathUtils.degToRad(rotationDegrees);
  for (const texture of Object.values(textures)) {
    texture.repeat.set(scale, scale);
    texture.rotation = rotation;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
  }
}

export function disposeSkinTextureSet(textures: SkinTextureSet | null) {
  if (!textures) return;
  for (const texture of Object.values(textures)) texture.dispose();
}

export function skinToneColor(tone: SkinTone) {
  return (skinToneOptions.find((option) => option.id === tone) ?? skinToneOptions[0]).baseColor;
}

/** Keep visible displacement proportional across float and quantized meshes. */
export function skinDisplacementScale(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  geometry.computeBoundingBox();
  const height = geometry.boundingBox?.getSize(new THREE.Vector3()).y ?? 0.34;
  return Math.max(1e-6, height * 0.00161);
}
