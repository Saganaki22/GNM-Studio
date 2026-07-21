import type { KeyboardEvent, PointerEvent } from "react";
import type { SidebarSide } from "./useSidebarResize";

interface SidebarResizeHandleProps {
  side: SidebarSide;
  width: number;
  active: boolean;
  begin(side: SidebarSide, event: PointerEvent<HTMLElement>): void;
  move(event: PointerEvent<HTMLElement>): void;
  end(event: PointerEvent<HTMLElement>): void;
  keyDown(side: SidebarSide, event: KeyboardEvent<HTMLElement>): void;
  reset(side: SidebarSide): void;
}

export function SidebarResizeHandle(props: SidebarResizeHandleProps) {
  const label = `Resize ${props.side} sidebar`;
  return <div
    className={`sidebar-resize-handle ${props.active ? "active" : ""}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={220}
    aria-valuemax={460}
    aria-valuenow={props.width}
    tabIndex={0}
    title={`${label} · double-click to reset`}
    onPointerDown={(event) => props.begin(props.side, event)}
    onPointerMove={props.move}
    onPointerUp={props.end}
    onPointerCancel={props.end}
    onDoubleClick={() => props.reset(props.side)}
    onKeyDown={(event) => props.keyDown(props.side, event)}
  />;
}
