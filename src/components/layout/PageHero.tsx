import type { ReactNode } from "react";

type PageHeroStat = {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
};

type PageHeroProps = {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  desc?: string;
  stats?: PageHeroStat[];
};

export function PageHero({ icon, eyebrow, title, stats = [] }: PageHeroProps) {
  return (
    <>
      <section className="page-hero">
        <div className="page-hero-copy">
          <span className="eyebrow">{icon} {eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </section>
      {stats.length > 0 && (
        <section className="module-metric-strip" aria-label={`${title}关键数据`}>
          {stats.map((item) => (
            <div className="module-metric-card" key={item.label}>
              <span className="metric-icon">{item.icon}</span>
              <div>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export default PageHero;
