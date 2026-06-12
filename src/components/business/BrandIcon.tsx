import packageJson from "../../../package.json";

const BRAND_ICON_SRC = `/app-icon-192.png?v=${packageJson.version}`;

type BrandIconProps = {
  className?: string;
  alt?: string;
};

export function BrandIcon({ className = "brand-mark", alt = "祝融坤锋美业" }: BrandIconProps) {
  return <img className={className} src={BRAND_ICON_SRC} alt={alt} draggable={false} />;
}
