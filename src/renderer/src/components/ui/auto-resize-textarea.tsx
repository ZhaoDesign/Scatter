import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";

type AutoResizeTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  nodeId: string;
};

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(function AutoResizeTextarea(
  { nodeId, value, ...props },
  forwardedRef
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const previousHeight = textarea.offsetHeight;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    if (previousHeight === textarea.offsetHeight) return;

    window.requestAnimationFrame(() => updateNodeInternals(nodeId));
  }, [nodeId, updateNodeInternals, value]);

  return <textarea {...props} ref={textareaRef} value={value} />;
});
