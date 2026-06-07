import { ArrowLeft, X } from "lucide-react";
import { ReactNode, useEffect } from "react";

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

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className={["system-modal", size, className].filter(Boolean).join(" ")}
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
