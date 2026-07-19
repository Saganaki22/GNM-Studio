import { projectCoverPoint } from "./coverProjection";
import type { TrackingFrame } from "../types";

type Point = { x: number; y: number };

function arrow(context: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(5, width * 3.5);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * head, to.y - Math.sin(angle - Math.PI / 6) * head);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * head, to.y - Math.sin(angle + Math.PI / 6) * head);
  context.closePath();
  context.fill();
}

export function drawTrackingVectors(
  context: CanvasRenderingContext2D,
  frame: TrackingFrame,
  video: HTMLVideoElement | null,
  canvasWidth: number,
  canvasHeight: number,
  mirror: boolean,
) {
  const projected = (index: number) => {
    const point = frame.landmarks[index];
    return point ? projectCoverPoint(video, canvasWidth, canvasHeight, point.x, point.y, mirror) : null;
  };
  const scale = devicePixelRatio;
  const guide = (first: number, second: number, color: string) => {
    const a = projected(first);
    const b = projected(second);
    if (!a || !b) return;
    context.strokeStyle = color;
    context.lineWidth = 1.35 * scale;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  };

  // Inner aperture and mouth width are the geometric controls used by the
  // retargeter, so the overlay shows exactly what is being measured.
  guide(13, 14, "rgba(255, 177, 66, .96)");
  guide(78, 308, "rgba(255, 214, 70, .80)");

  for (const [irisIndex, outerIndex, innerIndex] of [[473, 263, 362], [468, 33, 133]] as const) {
    const iris = projected(irisIndex);
    const outer = projected(outerIndex);
    const inner = projected(innerIndex);
    if (!iris || !outer || !inner) continue;
    const center = { x: (outer.x + inner.x) * 0.5, y: (outer.y + inner.y) * 0.5 };
    arrow(context, center, {
      x: center.x + (iris.x - center.x) * 3.4,
      y: center.y + (iris.y - center.y) * 3.4,
    }, "rgba(255, 67, 224, .96)", 1.45 * scale);
  }

  const nose = projected(1);
  const leftSide = projected(234);
  const rightSide = projected(454);
  const forehead = projected(10);
  const chin = projected(152);
  if (nose && leftSide && rightSide && forehead && chin) {
    const horizontalLength = Math.hypot(rightSide.x - leftSide.x, rightSide.y - leftSide.y);
    const verticalLength = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
    const horizontalAngle = Math.atan2(rightSide.y - leftSide.y, rightSide.x - leftSide.x);
    const verticalAngle = Math.atan2(chin.y - forehead.y, chin.x - forehead.x);
    arrow(context, nose, {
      x: nose.x + Math.cos(horizontalAngle) * horizontalLength * 0.22,
      y: nose.y + Math.sin(horizontalAngle) * horizontalLength * 0.22,
    }, "rgba(85, 221, 178, .92)", 1.3 * scale);
    arrow(context, nose, {
      x: nose.x - Math.cos(verticalAngle) * verticalLength * 0.16,
      y: nose.y - Math.sin(verticalAngle) * verticalLength * 0.16,
    }, "rgba(79, 164, 255, .92)", 1.3 * scale);
  }

  const controls = [
    1, 10, 13, 14, 33, 78, 133, 145, 152, 159, 234, 263, 308, 362, 374, 386, 454,
    468, 469, 470, 471, 472, 473, 474, 475, 476, 477,
  ];
  context.fillStyle = "rgba(255, 91, 82, .96)";
  for (const index of controls) {
    const point = projected(index);
    if (!point) continue;
    context.beginPath();
    context.arc(point.x, point.y, 1.75 * scale, 0, Math.PI * 2);
    context.fill();
  }
}
