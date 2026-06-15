import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(process.cwd(), "src/app/AuthenticatedApp.tsx"), "utf8");
const settingsSource = readFileSync(join(process.cwd(), "src/app/settingsView.tsx"), "utf8");
const userAvatarSource = readFileSync(join(process.cwd(), "src/components/business/UserAvatar.tsx"), "utf8");
const accountMenuSource = readFileSync(join(process.cwd(), "src/components/business/AccountMenu.tsx"), "utf8");
const appEntrySource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const authGateSource = readFileSync(join(process.cwd(), "src/app/AuthGate.tsx"), "utf8");
const indexSource = readFileSync(join(process.cwd(), "index.html"), "utf8");
const stylesSource = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

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

const shellTopbarIndex = appSource.indexOf('<header className="topbar">');
const shellMainIndex = appSource.indexOf('<main className="main">');
if (shellTopbarIndex < 0 || shellMainIndex < 0 || shellTopbarIndex > shellMainIndex) {
  violations.push("Shell topbar must be a direct app-shell child before the scrollable main.");
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

if (userAvatarSource.includes("return <UserRound")) {
  violations.push("UserAvatar must keep a stable avatar container instead of swapping to a bare icon fallback.");
}

if (!appSource.includes("const currentAvatarUrl = currentAuthUser?.avatarUrl ?? session.user.avatarUrl;")) {
  violations.push("Shell must resolve the current account avatar from fresh auth user data.");
}

if (!appSource.includes("<UserAvatar />")) {
  violations.push("Topbar account button must stay in generic icon mode.");
}

if (appSource.includes("<UserAvatar avatarUrl={currentAvatarUrl} showImage />")) {
  violations.push("Topbar account button must not render uploaded account images.");
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

if (!indexSource.includes('class="startup-loading"')) {
  violations.push("Index HTML must render a static startup loading view before JavaScript loads.");
}

if (appEntrySource.includes('const AuthGate = lazy(() => import("./app/AuthGate"))')) {
  violations.push("AuthGate must stay in the initial entry path to avoid a blank startup gap.");
}

if (!appEntrySource.includes('import AuthGate from "./app/AuthGate";')) {
  violations.push("App entry must statically import AuthGate so mobile startup keeps the auth shell ready.");
}

if (authGateSource.includes("lazy(() => import(\"./AuthRuntime\"))")) {
  violations.push("AuthRuntime must stay in the initial auth path to avoid a blank startup gap.");
}

if (!stylesSource.includes("transform: none;")) {
  violations.push("Mobile topbar actions must not create a transformed containing block for fixed account menus.");
}

if (!stylesSource.includes("left: auto;")) {
  violations.push("Mobile account menu must clear the full-width left constraint so it stays inside the viewport.");
}

if (!stylesSource.includes("Mobile topbar visibility lock")) {
  violations.push("Mobile topbar visibility lock must keep notification and account buttons visible.");
}

if (!stylesSource.includes("Mobile shell topbar visibility lock")) {
  violations.push("Mobile shell topbar visibility lock must keep logo, store name, notification, and account buttons visible.");
}

if (!stylesSource.includes("Shell topbar structure lock")) {
  violations.push("Shell topbar must document the iOS scroll-container clipping guard.");
}

if (!stylesSource.includes(".app-shell > .topbar {\n  position: fixed;")) {
  violations.push("Shell topbar must stay fixed as a sibling of the scrollable main.");
}

if (!stylesSource.includes(".app-shell > .topbar .topbar-brand {")) {
  violations.push("Shell topbar brand must be styled on the app-shell direct child header.");
}

if (!stylesSource.includes(".app-shell > .topbar .topbar-actions {")) {
  violations.push("Shell topbar actions must be styled on the app-shell direct child header.");
}

if (!stylesSource.includes(".app-shell > .topbar .topbar-actions .account-avatar-button img {\n  display: none;")) {
  violations.push("Mobile topbar account button must hide uploaded avatar images.");
}

if (violations.length > 0) {
  console.error("主题与头像规则检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("主题与头像规则检查通过。");
