import type { ReactNode } from "react";

type PageHeroStat = {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
};

type PageHeroProps = {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  stats: PageHeroStat[];
};

export function PageHero({ icon, eyebrow, title, desc, stats }: PageHeroProps) {
  return (
    <section className="page-hero">
      <div className="page-hero-copy">
        <span className="eyebrow">{icon} {eyebrow}</span>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <div className="page-hero-stats">
        {stats.map((item) => (
          <div className="page-hero-stat" key={item.label}>
            <span className="metric-icon">{item.icon}</span>
            <div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <em>{item.hint}</em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default PageHero;
