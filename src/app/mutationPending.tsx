import { createContext, type ReactNode, useContext } from "react";

export const MutationPendingContext = createContext(false);

export function useMutationPending() {
  return useContext(MutationPendingContext);
}

export type SubmitStatusButtonProps = {
  idleText: string;
  busyText?: string;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
};

export function SubmitStatusButton({ idleText, busyText = "处理中...", disabled = false, icon, className = "primary-button" }: SubmitStatusButtonProps) {
  const pending = useMutationPending();
  return (
    <button className={className} type="submit" disabled={disabled || pending}>
      {icon}
      {pending ? busyText : idleText}
    </button>
  );
}
