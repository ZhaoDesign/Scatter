import type { MouseEvent, PointerEvent, ReactElement } from "react";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}

export function Switch({ checked, onCheckedChange, label }: SwitchProps): ReactElement {
  function stopCanvasEvent(event: MouseEvent | PointerEvent): void {
    event.stopPropagation();
  }

  function toggleFromLabel(event: MouseEvent<HTMLSpanElement>): void {
    event.stopPropagation();
    if (event.target instanceof HTMLElement && event.target.closest(".switch-root")) return;
    onCheckedChange(!checked);
  }

  return (
    <span className="switch-row nodrag nopan" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={toggleFromLabel}>
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        role="switch"
        className="switch-root nodrag nopan"
        data-state={checked ? "checked" : "unchecked"}
        aria-checked={checked}
        aria-label={label}
        onPointerDown={stopCanvasEvent}
        onMouseDown={stopCanvasEvent}
        onClick={(event) => {
          event.stopPropagation();
          onCheckedChange(!checked);
        }}
      >
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </span>
  );
}
