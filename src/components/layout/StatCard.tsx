type StatCardProps = {
  title: string;
  value: string;
  hint: string;
  tone?: "ok" | "warn";
};

export function StatCard({ title, value, hint, tone }: StatCardProps) {
  return (
    <section className={`stat-card ${tone ?? ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </section>
  );
}

export default StatCard;
