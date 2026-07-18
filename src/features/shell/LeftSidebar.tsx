import type { ReactNode } from "react";
import { Camera, ChevronDown, WandSparkles } from "lucide-react";

export interface LeftSidebarProps {
  collapsed: boolean;
  activePanel: "avatar" | "capture";
  toggleCollapsed: () => void;
  showAvatar: () => void;
  showCapture: () => void;
  avatarContent: ReactNode;
  captureContent: ReactNode;
}

export function LeftSidebar({ collapsed, activePanel, toggleCollapsed, showAvatar, showCapture, avatarContent, captureContent }: LeftSidebarProps) {
  return <aside className={`sidebar left-sidebar ${collapsed ? "collapsed" : ""}`}>
    <button type="button" className="sidebar-collapse-toggle" aria-label={collapsed ? "Expand left sidebar" : "Collapse left sidebar"} title={collapsed ? "Expand left sidebar" : "Collapse left sidebar"} onClick={toggleCollapsed}><ChevronDown size={15} /></button>
    <div className="sidebar-tabs"><button className={activePanel === "avatar" ? "active" : ""} onClick={showAvatar}><WandSparkles size={16} />Avatar</button><button className={activePanel === "capture" ? "active" : ""} onClick={showCapture}><Camera size={16} />Capture</button></div>
    {activePanel === "avatar" ? avatarContent : captureContent}
  </aside>;
}
