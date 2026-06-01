import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const userAvatarSource = readFileSync(join(process.cwd(), "src/components/business/UserAvatar.tsx"), "utf8");
const accountMenuSource = readFileSync(join(process.cwd(), "src/components/business/AccountMenu.tsx"), "utf8");

const violations: string[] = [];

if (!appSource.includes('type ThemeMode = "auto" | "day" | "night";')) {
  violations.push("ThemeMode must include auto/day/night.");
}

if (!appSource.includes("const effectiveThemeMode: EffectiveThemeMode = themeMode === \"auto\" ? systemThemeMode : themeMode;")) {
  violations.push("Root theme class must use the effective day/night mode, not the raw preference.");
}

if (!appSource.includes("setThemeMode(\"auto\")}>自动</button>")) {
  violations.push("Appearance settings must include an 自动 option.");
}

if (!appSource.includes("window.matchMedia(\"(prefers-color-scheme: dark)\")")) {
  violations.push("Auto theme must follow prefers-color-scheme.");
}

if (!userAvatarSource.includes("showImage = false")) {
  violations.push("UserAvatar must default to generic icon mode.");
}

if (!userAvatarSource.includes("if (showImage && avatarUrl)")) {
  violations.push("UserAvatar must render uploaded images only when showImage is explicitly enabled.");
}

if (!appSource.includes("<UserAvatar size={22} />")) {
  violations.push("Topbar account button must use the generic avatar icon.");
}

if (!appSource.includes("<UserAvatar size={78} />")) {
  violations.push("Admin hero avatar must use the generic avatar icon.");
}

if (!appSource.includes("<UserAvatar avatarUrl={avatarUrl} size={52} showImage />")) {
  violations.push("Settings avatar editor must keep uploaded-image preview enabled.");
}

if (accountMenuSource.includes("avatarUrl={session.user.avatarUrl}")) {
  violations.push("Account menu must not render the uploaded real avatar image.");
}

if (violations.length > 0) {
  console.error("主题与头像规则检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("主题与头像规则检查通过。");
