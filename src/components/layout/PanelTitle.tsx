import type { ReactNode } from "react";

type PanelTitleProps = {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
};

export function PanelTitle({ icon, title, action }: PanelTitleProps) {
  return (
    <div className="panel-title">
      <div>{icon}<h2>{title}</h2></div>
      {action && <span>{action}</span>}
    </div>
  );
}

export default PanelTitle;
