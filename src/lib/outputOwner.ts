import type { OutputOwnerPhase } from "./outputChannel";

export function popoutOwnsRenderer(phase: OutputOwnerPhase) {
  return phase !== "studio" && phase !== "failed";
}

export function outputOwnerBusy(phase: OutputOwnerPhase) {
  return phase === "popout-recording" || phase === "popout-encoding" || phase === "closing" || phase === "restoring";
}

export function phaseFromHeartbeat(
  current: OutputOwnerPhase,
  heartbeat: "ready" | "recording" | "encoding" | "closing",
): OutputOwnerPhase {
  if (current === "closing" || current === "restoring") return current;
  if (heartbeat === "recording") return "popout-recording";
  if (heartbeat === "encoding") return "popout-encoding";
  if (heartbeat === "closing") return "closing";
  return "popout-ready";
}

export function canMountStudioRenderer(phase: OutputOwnerPhase) {
  return phase === "studio" || phase === "failed";
}
