export type BadgeTone = "ok" | "warn";

type BadgeProps = {
  text: string;
  tone?: BadgeTone;
};

export function Badge({ text, tone }: BadgeProps) {
  return <span className={`badge ${tone ?? ""}`}>{text}</span>;
}

export default Badge;
