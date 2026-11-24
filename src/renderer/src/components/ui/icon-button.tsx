import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils";
import { Icon } from "./icon";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  filled?: boolean;
  icon?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export function IconButton({ className, filled = true, icon = "x", loading = false, size = "lg", type = "button", ...props }: IconButtonProps): ReactElement {
  return (
    <button className={cn("kit-icon-button", `kit-icon-button-${size}`, filled ? "is-filled" : "is-plain", className)} type={type} {...props}>
      {loading ? <span className="kit-spinner kit-spinner-sm" aria-hidden="true" /> : <Icon name={icon} size={16} />}
    </button>
  );
}
