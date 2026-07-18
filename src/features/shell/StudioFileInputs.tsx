import type { RefObject } from "react";

export interface StudioFileInputsProps {
  motionRef: RefObject<HTMLInputElement | null>;
  backgroundRef: RefObject<HTMLInputElement | null>;
  presetRef: RefObject<HTMLInputElement | null>;
  importMotion: (file?: File) => void;
  chooseBackground: (file?: File) => void;
  importPresets: (file?: File) => void;
}

export function StudioFileInputs({ motionRef, backgroundRef, presetRef, importMotion, chooseBackground, importPresets }: StudioFileInputsProps) {
  return <>
    <input ref={motionRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={(event) => { importMotion(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={backgroundRef} className="visually-hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/bmp,image/gif" onChange={(event) => { chooseBackground(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={presetRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={(event) => { importPresets(event.target.files?.[0]); event.currentTarget.value = ""; }} />
  </>;
}
