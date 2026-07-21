import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type SidebarSide = "left" | "right";

type Widths = Record<SidebarSide, number>;
type DragState = { side: SidebarSide; pointerId: number; startX: number; startWidth: number };

const MIN_WIDTH = 220;
const MAX_WIDTH = 460;
const MIN_CANVAS_WIDTH = 480;
const LEFT_DEFAULT = 286;
const RIGHT_DEFAULT = 276;
const STORAGE_KEY = "gnm-studio-sidebar-widths";

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));

function loadWidths(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Widths> | null;
    return {
      left: clamp(Number(saved?.left) || LEFT_DEFAULT),
      right: clamp(Number(saved?.right) || RIGHT_DEFAULT),
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return { left: LEFT_DEFAULT, right: RIGHT_DEFAULT };
  }
}

function fitWithinCanvas(widths: Widths, available: number): Widths {
  let left = clamp(widths.left);
  let right = clamp(widths.right);
  const combinedLimit = Math.max(MIN_WIDTH * 2, available - MIN_CANVAS_WIDTH);
  const excess = left + right - combinedLimit;
  if (excess > 0) {
    const leftRoom = left - MIN_WIDTH;
    const rightRoom = right - MIN_WIDTH;
    const room = leftRoom + rightRoom;
    if (room > 0) {
      left -= excess * (leftRoom / room);
      right -= excess * (rightRoom / room);
    }
  }
  return { left: Math.round(clamp(left)), right: Math.round(clamp(right)) };
}

export function useSidebarResize() {
  const shellRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [widths, setWidths] = useState<Widths>(loadWidths);
  const [dragging, setDragging] = useState<SidebarSide | null>(null);
  const [desktopLayout, setDesktopLayout] = useState(() => window.matchMedia("(min-width: 1101px)").matches);

  const constrain = useCallback(() => {
    const available = shellRef.current?.clientWidth;
    if (available) setWidths((current) => fitWithinCanvas(current, available));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1101px)");
    const update = () => {
      setDesktopLayout(media.matches);
      if (media.matches) window.requestAnimationFrame(constrain);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [constrain]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => constrain());
    observer.observe(shell);
    return () => observer.disconnect();
  }, [constrain]);

  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const previousCursor = root.style.cursor;
    const previousSelection = root.style.userSelect;
    root.style.cursor = "col-resize";
    root.style.userSelect = "none";
    return () => {
      root.style.cursor = previousCursor;
      root.style.userSelect = previousSelection;
    };
  }, [dragging]);

  const begin = useCallback((side: SidebarSide, event: ReactPointerEvent<HTMLElement>) => {
    if (!desktopLayout || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: widths[side] };
    setDragging(side);
  }, [desktopLayout, widths]);

  const move = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const shell = shellRef.current;
    if (!drag || !shell || drag.pointerId !== event.pointerId) return;
    const visualScale = shell.getBoundingClientRect().width / Math.max(shell.clientWidth, 1);
    const rawDelta = (event.clientX - drag.startX) / Math.max(visualScale, 0.01);
    const nextWidth = drag.startWidth + rawDelta * (drag.side === "left" ? 1 : -1);
    setWidths((current) => {
      const other = current[drag.side === "left" ? "right" : "left"];
      const dynamicMaximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, shell.clientWidth - other - MIN_CANVAS_WIDTH));
      return { ...current, [drag.side]: Math.round(Math.min(dynamicMaximum, Math.max(MIN_WIDTH, nextWidth))) };
    });
  }, []);

  const end = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(null);
  }, []);

  const adjust = useCallback((side: SidebarSide, delta: number) => {
    const shell = shellRef.current;
    if (!shell) return;
    setWidths((current) => {
      const other = current[side === "left" ? "right" : "left"];
      const dynamicMaximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, shell.clientWidth - other - MIN_CANVAS_WIDTH));
      return { ...current, [side]: Math.round(Math.min(dynamicMaximum, Math.max(MIN_WIDTH, current[side] + delta))) };
    });
  }, []);

  const keyDown = useCallback((side: SidebarSide, event: ReactKeyboardEvent<HTMLElement>) => {
    const direction = side === "left" ? 1 : -1;
    if (event.key === "ArrowLeft") adjust(side, -16 * direction);
    else if (event.key === "ArrowRight") adjust(side, 16 * direction);
    else if (event.key === "Home") {
      setWidths((current) => ({ ...current, [side]: side === "left" ? LEFT_DEFAULT : RIGHT_DEFAULT }));
    } else return;
    event.preventDefault();
  }, [adjust]);

  const reset = useCallback((side: SidebarSide) => {
    setWidths((current) => fitWithinCanvas({
      ...current,
      [side]: side === "left" ? LEFT_DEFAULT : RIGHT_DEFAULT,
    }, shellRef.current?.clientWidth ?? window.innerWidth));
  }, []);

  return {
    shellRef,
    widths,
    dragging,
    desktopLayout,
    handle: { begin, move, end, keyDown, reset },
  };
}
