import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(process.cwd(), "src/app/AuthenticatedApp.tsx"), "utf8");
const settingsSource = readFileSync(join(process.cwd(), "src/app/settingsView.tsx"), "utf8");
const userAvatarSource = readFileSync(join(process.cwd(), "src/components/business/UserAvatar.tsx"), "utf8");
const accountMenuSource = readFileSync(join(process.cwd(), "src/components/business/AccountMenu.tsx"), "utf8");

const violations: string[] = [];

if (!appSource.includes('type ThemeMode = "day" | "night";')) {
  violations.push("ThemeMode must only include day/night.");
}

if (!appSource.includes('return isThemeMode(savedThemeMode) ? savedThemeMode : "day";')) {
  violations.push("Theme must default to day mode when no valid saved preference exists.");
}

if (!appSource.includes('className={`app-shell theme-${themeMode}`}')) {
  violations.push("Root theme class must use the stored day/night preference.");
}

if (appSource.includes('"auto"') || appSource.includes("setThemeMode(\"auto\")") || appSource.includes(">自动</button>")) {
  violations.push("Appearance settings must not include auto mode.");
}

if (appSource.includes("AUTO_THEME_") || appSource.includes("getSystemThemeMode") || appSource.includes("systemThemeMode")) {
  violations.push("Auto theme timing logic must be removed.");
}

if (appSource.includes("window.setInterval(syncSystemTheme, 60_000)")) {
  violations.push("Auto theme must not refresh while the app is open.");
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

if (!appSource.includes("<UserAvatar avatarUrl={currentAvatarUrl} showImage />")) {
  violations.push("Topbar account button must render uploaded account avatars when available.");
}

if (!appSource.includes("<UserAvatar avatarUrl={currentAvatarUrl} size={78} showImage />")) {
  violations.push("Admin hero avatar must render uploaded account avatars when available.");
}

if (!settingsSource.includes("<UserAvatar avatarUrl={avatarUrl} size={52} showImage />")) {
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
