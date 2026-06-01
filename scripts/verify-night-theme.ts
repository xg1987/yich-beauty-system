import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesSource = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

const requiredSelectors = [
  ".theme-night .panel",
  ".theme-night .table-wrap",
  ".theme-night input",
  ".theme-night .empty",
  ".theme-night .appointment-panel",
  ".theme-night .cashier-panel",
  ".theme-night .customer-panel",
  ".theme-night .usage-card",
  ".theme-night .usage-metrics > div",
  ".theme-night .usage-soft-meter",
  ".theme-night .workbar",
];

const violations = requiredSelectors.filter((selector) => !stylesSource.includes(selector));

if (!stylesSource.includes("Night theme readability pass")) {
  violations.push("Night theme readability pass marker is missing.");
}

if (violations.length > 0) {
  console.error("暗夜主题全局样式检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("暗夜主题全局样式检查通过。");
