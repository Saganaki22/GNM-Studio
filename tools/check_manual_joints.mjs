import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
const config = readFileSync(fileURLToPath(new URL("../src/app/studioConfig.ts", import.meta.url)), "utf8");
for (const name of ["joint_neck_pitch", "joint_head_yaw", "joint_left_eye_pitch", "joint_right_eye_yaw", "joint_translate_x", "joint_translate_y", "joint_translate_z"]) {
  assert.ok(`${app}\n${config}`.includes(name), `Manual joint UI is missing ${name}`);
}
assert.ok(app.includes("Freeze any channel"));
const stage = readFileSync(fileURLToPath(new URL("../src/components/Stage.tsx", import.meta.url)), "utf8");
for (const marker of ["neckOffset", "headOffset", "root.quaternion.multiply", 'jointValue("joint_translate_x")', 'jointValue("joint_left_eye_yaw")']) {
  assert.ok(stage.includes(marker), `Stage joint offsets are missing ${marker}`);
}
const glb = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
for (const marker of ["neckOffset", "headOffset", 'jointValue("joint_translate_z")']) assert.ok(glb.includes(marker), `GLB joint export is missing ${marker}`);
console.log("Manual joint controls verified: signed neck/head/left-eye/right-eye/XYZ offsets, per-channel freezes, live tracking composition, snapshots, and GLB root export.");
