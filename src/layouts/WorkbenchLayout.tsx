import type { ReactNode } from "react";

type WorkbenchLayoutProps = {
  children?: ReactNode;
};

export default function WorkbenchLayout({ children }: WorkbenchLayoutProps) {
  return <>{children}</>;
}

