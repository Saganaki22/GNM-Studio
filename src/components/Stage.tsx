import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetUrl } from "../lib/assets";
import { mouthOpenInfluence, semanticInfluences } from "../lib/retarget";
import { avatarProfiles, facecapInfluences } from "../lib/avatarProfiles";
import { resolveHeadPose } from "../lib/headPose";
import { splitFacecapTongueMaterial } from "../lib/facecapModel";
import {
  configureSkinTextureSet, disposeSkinTextureSet, loadSkinTextureSet, skinToneColor,
  type SkinTextureSet,
} from "../lib/skinMaterial";
import type { AvatarKind, BackgroundMode, FaceAlignment, HeadPoseSettings, RecordingMode, SkinTone, TrackingFrame } from "../types";

function projectCoverPoint(
  video: HTMLVideoElement | null,
  targetWidth: number,
  targetHeight: number,
  x: number,
  y: number,
  mirror: boolean,
) {
  if (!video?.videoWidth || !video.videoHeight) {
    return { x: (mirror ? 1 - x : x) * targetWidth, y: y * targetHeight };
  }
  const scale = Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = (targetWidth - renderedWidth) / 2;
  const offsetY = (targetHeight - renderedHeight) / 2;
  const projectedX = offsetX + x * renderedWidth;
  return {
    x: mirror ? targetWidth - projectedX : projectedX,
    y: offsetY + y * renderedHeight,
  };
}

type Props = {
  avatarKind: AvatarKind;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frame: TrackingFrame | null;
  neutralFrame: TrackingFrame | null;
  showWebcam: boolean;
  showAvatar: boolean;
  showLandmarks: boolean;
  mirror: boolean;
  opacity: number;
  wireframe: boolean;
  skinTextureEnabled: boolean;
  skinTone: SkinTone;
  skinTextureScale: number;
  skinTextureRotation: number;
  skinTextureFeather: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImageUrl: string | null;
  backgroundImageZoom: number;
  mouseLightEnabled: boolean;
  mouseLightIntensity: number;
  headPoseSettings: HeadPoseSettings;
  calibrating: boolean;
  calibrationComplete: boolean;
  faceAlignment: FaceAlignment;
  countdown: number | null;
  trackingReady: boolean;
  identityVertices: number[][] | null;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  recordingMode: RecordingMode;
  recordingActive: boolean;
  resetViewSignal: number;
  onCancelCalibration: () => void;
  onCompositeCanvas: (canvas: HTMLCanvasElement | null) => void;
  onSkinMaterialError: (message: string) => void;
};

export function Stage({
  avatarKind,
  videoRef,
  frame,
  neutralFrame,
  showWebcam,
  showAvatar,
  showLandmarks,
  mirror,
  opacity,
  wireframe,
  skinTextureEnabled,
  skinTone,
  skinTextureScale,
  skinTextureRotation,
  skinTextureFeather,
  backgroundMode,
  backgroundColor,
  backgroundImageUrl,
  backgroundImageZoom,
  mouseLightEnabled,
  mouseLightIntensity,
  headPoseSettings,
  calibrating,
  calibrationComplete,
  faceAlignment,
  countdown,
  trackingReady,
  identityVertices,
  manualExpressions,
  frozenExpressions,
  recordingMode,
  recordingActive,
  resetViewSignal,
  onCancelCalibration,
  onCompositeCanvas,
  onSkinMaterialError,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const landmarkRef = useRef<HTMLCanvasElement>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayOptionsRef = useRef({ showWebcam, showAvatar, showLandmarks, mirror, recordingMode, recordingActive, backgroundMode, backgroundColor, backgroundImageZoom });
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const headPoseRef = useRef(new THREE.Quaternion());
  const controlsRef = useRef<OrbitControls | null>(null);
  const mouseLightRef = useRef<THREE.PointLight | null>(null);
  const opacityRef = useRef(opacity);
  const [mouseLightBound, setMouseLightBound] = useState(true);
  const mouseLightBoundRef = useRef(true);
  const faceRef = useRef<THREE.Mesh | null>(null);
  const skinMaterialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const skinTexturesRef = useRef<SkinTextureSet | null>(null);
  const skinTransformRef = useRef({ scale: skinTextureScale, rotation: skinTextureRotation });
  const maxAnisotropyRef = useRef(8);
  const eyeLRef = useRef<THREE.Object3D | null>(null);
  const eyeRRef = useRef<THREE.Object3D | null>(null);
  const [modelReady, setModelReady] = useState(false);

  displayOptionsRef.current = { showWebcam, showAvatar, showLandmarks, mirror, recordingMode, recordingActive, backgroundMode, backgroundColor, backgroundImageZoom };
  mouseLightBoundRef.current = mouseLightBound;
  opacityRef.current = opacity;
  skinTransformRef.current = { scale: skinTextureScale, rotation: skinTextureRotation };

  useEffect(() => {
    backgroundImageRef.current = null;
    if (!backgroundImageUrl) return;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { backgroundImageRef.current = image; };
    image.src = backgroundImageUrl;
    return () => {
      if (backgroundImageRef.current === image) backgroundImageRef.current = null;
    };
  }, [backgroundImageUrl]);

  useEffect(() => {
    const toggleLight = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        setMouseLightBound((value) => !value);
      }
    };
    window.addEventListener("keydown", toggleLight);
    return () => window.removeEventListener("keydown", toggleLight);
  }, []);

  const setCameraView = (view: "front" | "back" | "left" | "right" | "top" | "bottom", resetFraming = false) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const directions = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
    } as const;
    const target = resetFraming ? new THREE.Vector3() : controls.target.clone();
    const distance = resetFraming ? 5 : Math.max(0.001, camera.position.distanceTo(controls.target));
    camera.position.copy(target).addScaledVector(directions[view], distance);
    if (view === "top") camera.up.set(0, 0, -1);
    else if (view === "bottom") camera.up.set(0, 0, 1);
    else camera.up.set(0, 1, 0);
    if (resetFraming) camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
  };

  useEffect(() => {
    if (resetViewSignal > 0) setCameraView("front", true);
  }, [resetViewSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setModelReady(false);
    faceRef.current = null;
    skinMaterialRef.current = null;
    eyeLRef.current = null;
    eyeRRef.current = null;
    rootRef.current = null;
    headPoseRef.current.identity();

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    camera.position.set(0, 0, 5);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x263041, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x55bbff, 1.8);
    rim.position.set(3, 1, -2);
    scene.add(rim);
    const mouseLight = new THREE.PointLight(0xffffff, 7.5, 8, 1.7);
    mouseLight.position.set(-0.7, 0.8, 3);
    mouseLightRef.current = mouseLight;
    scene.add(mouseLight);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    maxAnisotropyRef.current = renderer.capabilities.getMaxAnisotropy();
    renderer.domElement.className = "avatar-canvas";
    host.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;
    const compositeCanvas = document.createElement("canvas");
    compositeCanvasRef.current = compositeCanvas;
    onCompositeCanvas(compositeCanvas);

    sceneRef.current = scene;
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    controls.minZoom = 0.45;
    controls.maxZoom = 5;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    const chooseLeftGesture = (event: PointerEvent) => {
      controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    const restoreLeftGesture = () => { controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; };
    renderer.domElement.addEventListener("pointerdown", chooseLeftGesture, true);
    window.addEventListener("pointerup", restoreLeftGesture);
    const moveMouseLight = (event: PointerEvent) => {
      if (!mouseLightBoundRef.current) return;
      const bounds = host.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      const y = 1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2;
      const aspect = bounds.width / Math.max(1, bounds.height);
      mouseLight.position.set(x * aspect * 1.9, y * 1.9, 3);
    };
    renderer.domElement.addEventListener("pointermove", moveMouseLight);

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = host;
      renderer.setSize(width, height, false);
      compositeCanvas.width = Math.max(2, Math.round(width * devicePixelRatio));
      compositeCanvas.height = Math.max(2, Math.round(height * devicePixelRatio));
      const aspect = width / Math.max(1, height);
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
      const canvas = landmarkRef.current;
      if (canvas) {
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    const installModel = (gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>) => {
      // FaceCap's head, teeth and eyes are sibling scene nodes. GNM ships
      // beneath one root node, so preserve its existing hierarchy there.
      const model = avatarKind === "facecap" ? gltf.scene : gltf.scene.children[0] ?? gltf.scene;
      let face = model.getObjectByName("mesh_2") as THREE.Mesh | undefined;
      model.traverse((object) => {
        if (!face && object instanceof THREE.Mesh && object.morphTargetDictionary) face = object;
      });
      if (face) {
        const uv = face.geometry.getAttribute("uv");
        if (uv && !face.geometry.getAttribute("uv1")) face.geometry.setAttribute("uv1", uv.clone());
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xd8dde5,
          roughness: 0.48,
          metalness: 0.02,
          transparent: true,
          opacity: opacityRef.current,
          side: THREE.DoubleSide,
        });
        skinMaterialRef.current = material;
        if (avatarKind === "facecap") {
          const tongueMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xb45f68,
            roughness: 0.58,
            metalness: 0,
            transparent: true,
            opacity: opacityRef.current,
            side: THREE.DoubleSide,
          });
          splitFacecapTongueMaterial(face, material, tongueMaterial);
        } else {
          face.material = material;
        }
        faceRef.current = face;
      }
      const teeth = model.getObjectByName("mesh_3") ?? model.getObjectByName("teeth");
      if (teeth instanceof THREE.Mesh) {
        teeth.material = new THREE.MeshPhysicalMaterial({
          color: 0xf4eee5,
          roughness: 0.34,
          metalness: 0,
          side: THREE.DoubleSide,
        });
      }
      eyeLRef.current = model.getObjectByName("eyeLeft") ?? null;
      eyeRRef.current = model.getObjectByName("eyeRight") ?? null;

      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const normalizedScale = 1 / Math.max(size.y, 0.001);
      model.scale.setScalar(normalizedScale);
      model.position.copy(center).multiplyScalar(-normalizedScale);
      const trackingRoot = new THREE.Group();
      trackingRoot.add(model);
      rootRef.current = trackingRoot;
      scene.add(trackingRoot);
      setModelReady(true);
    };
    loader.load(
      assetUrl(avatarProfiles[avatarKind].asset),
      installModel,
      undefined,
      (error) => onSkinMaterialError(`Could not load ${avatarProfiles[avatarKind].label}: ${String(error)}`),
    );

    let animationId = 0;
    const render = () => {
      renderer.render(scene, camera);
      controls.update();
      const context = compositeCanvas.getContext("2d", { alpha: true });
      if (context) {
        const width = compositeCanvas.width;
        const height = compositeCanvas.height;
        const options = displayOptionsRef.current;
        context.clearRect(0, 0, width, height);
        if (options.backgroundMode === "studio") {
          const gradient = context.createRadialGradient(width * 0.5, height * 0.42, 0, width * 0.5, height * 0.42, Math.max(width, height) * 0.72);
          gradient.addColorStop(0, "#19212b");
          gradient.addColorStop(0.58, "#090d12");
          gradient.addColorStop(1, "#040608");
          context.fillStyle = gradient;
          context.fillRect(0, 0, width, height);
        } else if (options.backgroundMode === "solid") {
          context.fillStyle = options.backgroundColor;
          context.fillRect(0, 0, width, height);
        } else if (options.backgroundMode === "image" && backgroundImageRef.current?.naturalWidth) {
          const image = backgroundImageRef.current;
          const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
          const scale = coverScale * options.backgroundImageZoom;
          const imageWidth = image.naturalWidth * scale;
          const imageHeight = image.naturalHeight * scale;
          context.fillStyle = "#040608";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
        }
        const video = videoRef.current;
        const captureWebcam = options.showWebcam
          && (!options.recordingActive || options.recordingMode === "composite");
        const captureAvatar = options.showAvatar
          && (!options.recordingActive || options.recordingMode !== "motion");
        if (captureWebcam && video && video.readyState >= 2 && video.videoWidth) {
          const videoAspect = video.videoWidth / video.videoHeight;
          const outputAspect = width / height;
          let sourceWidth = video.videoWidth;
          let sourceHeight = video.videoHeight;
          let sourceX = 0;
          let sourceY = 0;
          if (videoAspect > outputAspect) {
            sourceWidth = video.videoHeight * outputAspect;
            sourceX = (video.videoWidth - sourceWidth) / 2;
          } else {
            sourceHeight = video.videoWidth / outputAspect;
            sourceY = (video.videoHeight - sourceHeight) / 2;
          }
          context.save();
          if (options.mirror) {
            context.translate(width, 0);
            context.scale(-1, 1);
          }
          context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
          context.restore();
        }
        if (captureAvatar) context.drawImage(renderer.domElement, 0, 0, width, height);
        if (options.showLandmarks && landmarkRef.current) {
          context.drawImage(landmarkRef.current, 0, 0, width, height);
        }
      }
      animationId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationId);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", chooseLeftGesture, true);
      renderer.domElement.removeEventListener("pointermove", moveMouseLight);
      window.removeEventListener("pointerup", restoreLeftGesture);
      controls.dispose();
      controlsRef.current = null;
      mouseLightRef.current = null;
      renderer.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      faceRef.current = null;
      skinMaterialRef.current = null;
      eyeLRef.current = null;
      eyeRRef.current = null;
      rootRef.current = null;
      renderer.domElement.remove();
      compositeCanvasRef.current = null;
      onCompositeCanvas(null);
    };
  }, [avatarKind, onCompositeCanvas, onSkinMaterialError, videoRef]);

  useEffect(() => {
    const face = faceRef.current;
    const material = skinMaterialRef.current;
    if (material) {
      material.opacity = opacity;
      material.wireframe = wireframe;
    }
    const tongue = Array.isArray(face?.material) ? face.material[1] : null;
    if (tongue instanceof THREE.MeshPhysicalMaterial) {
      tongue.opacity = opacity;
      tongue.wireframe = wireframe;
    }
  }, [opacity, wireframe]);

  useEffect(() => {
    const material = skinMaterialRef.current;
    if (!material) return;
    if (!skinTextureEnabled) {
      const tone = skinToneColor(skinTone);
      material.color.setHex(tone);
      // A small matching emissive contribution keeps the selected base pigment
      // recognisable under the viewport's strong studio lights and ACES curve.
      material.emissive.setHex(tone);
      material.emissiveIntensity = 0.12;
      disposeSkinTextureSet(skinTexturesRef.current);
      skinTexturesRef.current = null;
      material.map = null;
      material.normalMap = null;
      material.displacementMap = null;
      material.aoMap = null;
      material.specularIntensityMap = null;
      material.displacementScale = 0;
      material.displacementBias = 0;
      material.normalScale.set(1, 1);
      material.roughness = 0.48;
      material.specularIntensity = 0.5;
      material.needsUpdate = true;
      return;
    }

    // Keep the previous complete texture set visible while a new tone/feather
    // set is prepared. Multiplying the old colour map by the selected solid
    // tone caused the head to darken continuously while dragging a control.
    material.color.setHex(0xffffff);
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSkinTextureSet(skinTone, skinTextureFeather).then((textures) => {
        if (cancelled) {
          disposeSkinTextureSet(textures);
          return;
        }
        configureSkinTextureSet(
          textures,
          skinTransformRef.current.scale,
          skinTransformRef.current.rotation,
          maxAnisotropyRef.current,
        );
        const previous = skinTexturesRef.current;
        skinTexturesRef.current = textures;
        material.color.setHex(0xffffff);
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
        material.map = textures.color;
        material.normalMap = textures.normal;
        material.normalScale.set(0.42, 0.42);
        material.displacementMap = textures.displacement;
        material.displacementScale = 0.00055;
        material.displacementBias = -0.000275;
        material.aoMap = textures.occlusion;
        material.aoMapIntensity = 0.38;
        material.specularIntensityMap = textures.specular;
        material.specularIntensity = 0.55;
        material.roughness = 0.54;
        material.needsUpdate = true;
        disposeSkinTextureSet(previous);
      }).catch((error) => {
        if (!cancelled) onSkinMaterialError(error instanceof Error ? error.message : String(error));
      });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [modelReady, onSkinMaterialError, skinTextureEnabled, skinTextureFeather, skinTone]);

  useEffect(() => {
    if (!skinTexturesRef.current) return;
    configureSkinTextureSet(
      skinTexturesRef.current,
      skinTextureScale,
      skinTextureRotation,
      maxAnisotropyRef.current,
    );
  }, [skinTextureRotation, skinTextureScale]);

  useEffect(() => () => {
    disposeSkinTextureSet(skinTexturesRef.current);
    skinTexturesRef.current = null;
  }, []);

  useEffect(() => {
    if (!mouseLightRef.current) return;
    mouseLightRef.current.visible = mouseLightEnabled;
    mouseLightRef.current.intensity = 7.5 * mouseLightIntensity;
  }, [mouseLightEnabled, mouseLightIntensity]);

  useEffect(() => {
    const face = faceRef.current;
    if (avatarKind !== "gnm" || !face || !identityVertices?.length) return;
    const geometry = face.geometry as THREE.BufferGeometry;
    const flattened = new Float32Array(identityVertices.length * 3);
    identityVertices.forEach((vertex, index) => {
      flattened[index * 3] = vertex[0];
      flattened[index * 3 + 1] = vertex[1];
      flattened[index * 3 + 2] = vertex[2];
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(flattened, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }, [avatarKind, identityVertices, modelReady]);

  useEffect(() => {
    if (rendererCanvasRef.current) {
      rendererCanvasRef.current.style.opacity = showAvatar ? "1" : "0";
    }
  }, [showAvatar]);

  useEffect(() => {
    const canvas = landmarkRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!showLandmarks || !frame) return;
    const scale = devicePixelRatio;
    context.fillStyle = "rgba(80, 221, 178, .78)";
    for (const point of frame.landmarks) {
      const projected = projectCoverPoint(videoRef.current, canvas.width, canvas.height, point.x, point.y, mirror);
      context.beginPath();
      context.arc(projected.x, projected.y, 1.05 * scale, 0, Math.PI * 2);
      context.fill();
    }
  }, [frame, mirror, showLandmarks, videoRef]);

  useEffect(() => {
    const root = rootRef.current;
    const face = faceRef.current;
    if (!root || !face) return;

    if (frame) {
      const host = hostRef.current;
      const width = host?.clientWidth ?? 1;
      const height = host?.clientHeight ?? 1;
      const projected = (frame.poseLandmarks ?? frame.landmarks).map((point) => projectCoverPoint(
        videoRef.current,
        width,
        height,
        point.x,
        point.y,
        mirror,
      ));
      const xs = projected.map((point) => point.x);
      const ys = projected.map((point) => point.y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs);
      const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const aspect = width / height;
      root.position.x = (centerX / width * 2 - 1) * aspect;
      root.position.y = 1 - centerY / height * 2;
      root.position.z = 0;
      const faceHeight = Math.max(0.1, (maxY - minY) / height);
      root.scale.setScalar(faceHeight * 2.55);

      const pose = resolveHeadPose(frame, neutralFrame, mirror, headPoseSettings, headPoseRef.current);
      headPoseRef.current.copy(pose);
      root.quaternion.copy(pose);
    }

    const eye = { lH: 0, rH: 0, lV: 0, rV: 0 };
    const blendshapes = frame?.blendshapes ?? [];
    const scoreLookup = Object.fromEntries(blendshapes.map(({ name, score }) => [name, score]));
    for (const { name, score } of blendshapes) {
      if (name === "eyeLookInLeft") eye.lH += score;
      if (name === "eyeLookOutLeft") eye.lH -= score;
      if (name === "eyeLookInRight") eye.rH -= score;
      if (name === "eyeLookOutRight") eye.rH += score;
      if (name === "eyeLookUpLeft") eye.lV -= score;
      if (name === "eyeLookDownLeft") eye.lV += score;
      if (name === "eyeLookUpRight") eye.rV -= score;
      if (name === "eyeLookDownRight") eye.rV += score;
    }
    const modelInfluences = avatarKind === "facecap"
      ? facecapInfluences(scoreLookup)
      : semanticInfluences(scoreLookup);
    for (const [name, score] of Object.entries(modelInfluences)) {
      const index = face.morphTargetDictionary?.[name];
      if (index !== undefined && face.morphTargetInfluences) {
        face.morphTargetInfluences[index] = frozenExpressions[name] ?? Math.min(
          1,
          score + (manualExpressions[name] ?? 0),
        );
      }
    }
    const jawOpenIndex = avatarKind === "gnm" ? face.morphTargetDictionary?.jaw_open : undefined;
    if (jawOpenIndex !== undefined && face.morphTargetInfluences) {
      face.morphTargetInfluences[jawOpenIndex] = frozenExpressions.surprise ?? Math.min(
        1,
        mouthOpenInfluence(scoreLookup) + (manualExpressions.surprise ?? 0),
      );
    }
    const limit = THREE.MathUtils.degToRad(28);
    if (eyeLRef.current) eyeLRef.current.rotation.set(eye.lV * limit, 0, eye.lH * limit);
    if (eyeRRef.current) eyeRRef.current.rotation.set(eye.rV * limit, 0, eye.rH * limit);
  }, [avatarKind, frame, frozenExpressions, headPoseSettings, manualExpressions, mirror, modelReady, neutralFrame, videoRef]);

  return (
    <div
      className={`stage background-${backgroundMode}`}
      ref={hostRef}
      style={{ "--stage-background": backgroundColor } as React.CSSProperties}
    >
      {backgroundMode === "image" && backgroundImageUrl && (
        <div className="stage-background-image" aria-hidden="true">
          <img src={backgroundImageUrl} alt="" style={{ transform: `scale(${backgroundImageZoom})` }} draggable={false} />
        </div>
      )}
      <video
        ref={videoRef}
        className={`webcam-layer ${mirror ? "mirrored" : ""}`}
        autoPlay
        muted
        playsInline
        style={{ opacity: showWebcam ? 1 : 0 }}
      />
      <canvas
        className="landmark-layer"
        ref={landmarkRef}
        style={{ opacity: showLandmarks ? 1 : 0 }}
      />
      <div className="avatar-visibility" style={{ opacity: showAvatar ? 1 : 0 }} />

      <div className="stage-topline">
        <span className="stage-chip"><i className={trackingReady ? "ok" : ""} />{trackingReady ? "Face linked" : "Tracker idle"}</span>
        <span className="stage-chip subtle">{modelReady ? "Avatar ready" : "Loading avatar"}</span>
      </div>

      {!showWebcam && !showAvatar && (
        <div className="empty-stage">Enable the webcam or avatar layer</div>
      )}

      {calibrating && (
        <div className={`calibration-overlay alignment-${calibrationComplete ? "complete" : faceAlignment.status}`}>
          <div className="face-guide" />
          <div className="calibration-copy">
            <strong className={calibrationComplete || countdown !== null ? "countdown" : "instruction"}>{calibrationComplete ? "✓" : countdown ?? (faceAlignment.status === "ready" ? "Hold still" : "Align face")}</strong>
            <span>{calibrationComplete ? "Neutral pose captured" : countdown ? `Stay still · ${countdown}` : faceAlignment.message}</span>
            <small><i />{calibrationComplete || faceAlignment.status === "ready" ? "Position verified" : "Waiting for valid position"}</small>
            {!calibrationComplete && <button type="button" onClick={onCancelCalibration}>Cancel</button>}
          </div>
        </div>
      )}
      <div className="view-help">Drag orbit · Shift-drag pan · Wheel zoom</div>
      <button
        className={`mouse-light-toggle ${!mouseLightEnabled ? "disabled" : mouseLightBound ? "bound" : "frozen"}`}
        onClick={() => setMouseLightBound((value) => !value)}
        title="Press L to bind or freeze the pointer light"
      >
        <span />L · Mouse light {!mouseLightEnabled ? "off" : mouseLightBound ? "bound" : "frozen"}
      </button>
      <div className="view-gizmo" aria-label="3D view orientation">
        <button className="axis y" onClick={() => setCameraView("top")} title="Top view">Y</button>
        <button className="axis x-negative" onClick={() => setCameraView("left")} title="Left view">−X</button>
        <button className="view-cube" onClick={() => setCameraView("front")} title="Front view">FRONT</button>
        <button className="axis x" onClick={() => setCameraView("right")} title="Right view">X</button>
        <button className="axis z" onClick={() => setCameraView("back")} title="Back view">Z</button>
        <button className="axis y-negative" onClick={() => setCameraView("bottom")} title="Bottom view">−Y</button>
      </div>
    </div>
  );
}
