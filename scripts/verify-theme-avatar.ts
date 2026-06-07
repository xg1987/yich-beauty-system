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

if (!appSource.includes('const AUTO_THEME_TIME_ZONE = "Asia/Shanghai";')) {
  violations.push("Auto theme must use Asia/Shanghai time.");
}

if (!appSource.includes("AUTO_THEME_DAY_START_HOUR") || !appSource.includes("AUTO_THEME_NIGHT_START_HOUR")) {
  violations.push("Auto theme must have explicit day/night hour boundaries.");
}

if (!appSource.includes("window.setInterval(syncSystemTheme, 60_000)")) {
  violations.push("Auto theme must refresh while the app is open.");
}

if (!userAvatarSource.includes("showImage = false")) {
  violations.push("UserAvatar must default to generic icon mode.");
}

if (!userAvatarSource.includes("const canShowImage = showImage && avatarUrl && failedAvatarUrl !== avatarUrl;")) {
  violations.push("UserAvatar must render uploaded images only when showImage is explicitly enabled.");
}

if (!appSource.includes("const currentAvatarUrl = currentAuthUser?.avatarUrl ?? session.user.avatarUrl;")) {
  violations.push("Shell must resolve the current account avatar from fresh auth user data.");
}

if (!appSource.includes("<UserAvatar size={22} />")) {
  violations.push("Topbar account button must stay in generic icon mode.");
}

if (appSource.includes("<UserAvatar avatarUrl={currentAvatarUrl} size={22} showImage />")) {
  violations.push("Topbar account button must not render uploaded account images.");
}

if (!appSource.includes("<UserAvatar avatarUrl={currentAvatarUrl} size={78} showImage />")) {
  violations.push("Admin hero avatar must render uploaded account avatars when available.");
}

if (!appSource.includes("<UserAvatar avatarUrl={avatarUrl} size={52} showImage />")) {
  violations.push("Settings avatar editor must keep uploaded-image preview enabled.");
}

if (!accountMenuSource.includes("<UserAvatar avatarUrl={avatarUrl} size={34} showImage />")) {
  violations.push("Account menu must render the uploaded account avatar when available.");
}

if (violations.length > 0) {
  console.error("主题与头像规则检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("主题与头像规则检查通过。");
