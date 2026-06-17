import { ArrowLeft, X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";

type ModalSize = "medium" | "large";

type ModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  onClose: () => void;
};

export function Modal({ open, title, subtitle, children, footer, size = "medium", className, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;

    const updateViewportSize = () => {
      const visualViewport = window.visualViewport;
      document.documentElement.style.setProperty("--yich-visual-viewport-height", `${visualViewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty("--yich-visual-viewport-offset-top", `${visualViewport?.offsetTop ?? 0}px`);
    };
    const keepFocusedControlVisible = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!dialogRef.current?.contains(target)) return;
      if (!target.matches("input, select, textarea")) return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }, 120);
    };

    updateViewportSize();
    window.visualViewport?.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("scroll", updateViewportSize);
    window.addEventListener("resize", updateViewportSize);
    document.addEventListener("focusin", keepFocusedControlVisible);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("scroll", updateViewportSize);
      window.removeEventListener("resize", updateViewportSize);
      document.removeEventListener("focusin", keepFocusedControlVisible);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className={["system-modal", size, className].filter(Boolean).join(" ")}
        ref={dialogRef}
        role="dialog"
        aria-labelledby="system-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="system-modal-header">
          <button type="button" className="system-modal-back" aria-label="返回" onClick={onClose}>
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
          <div className="system-modal-title">
            <strong id="system-modal-title">{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button type="button" className="system-modal-close" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="system-modal-body">{children}</div>
        {footer && <footer className="system-modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export default Modal;
