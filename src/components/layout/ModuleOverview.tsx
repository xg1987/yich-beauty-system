import type { LucideIcon } from "lucide-react";

export type ModuleTone = "rose" | "violet" | "teal" | "amber" | "jade" | "plum";

export type FeatureModule<Key extends string> = {
  key: Key;
  title: string;
  icon: LucideIcon;
  tone: ModuleTone;
  meta?: string;
  points?: string[];
};

type ModuleOverviewProps<Key extends string> = {
  modules: Array<FeatureModule<Key>>;
  activeKey?: Key;
  onSelect: (key: Key) => void;
};

export function ModuleOverview<Key extends string>({ modules, activeKey, onSelect }: ModuleOverviewProps<Key>) {
  return (
    <section className="module-overview" aria-label="功能模块">
      {modules.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            aria-pressed={activeKey === item.key}
            className={`module-entry-card ${item.tone}${activeKey === item.key ? " active" : ""}`}
            key={item.key}
            onClick={() => onSelect(item.key)}
          >
            <span className={`admin-module-icon ${item.tone}`}><Icon size={20} /></span>
            <strong>{item.title}</strong>
            {item.points && (
              <span className="module-entry-points">
                {item.points.map((point) => <i key={point}>{point}</i>)}
              </span>
            )}
            {item.meta && <em>{item.meta}</em>}
          </button>
        );
      })}
    </section>
  );
}

export default ModuleOverview;
