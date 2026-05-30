import type { ReactNode } from "react";

type RouteGuardProps = {
  children?: ReactNode;
};

export function RouteGuard({ children }: RouteGuardProps) {
  return <>{children}</>;
}

export default RouteGuard;

