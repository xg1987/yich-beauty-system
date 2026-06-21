import { readFileSync } from "node:fs";

type PackageJson = { version?: string };

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson;
const version = packageJson.version?.trim();
if (!version) throw new Error("package.json 缺少 version");

const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const iconVersion = sw.match(/const ICON_VERSION = "([^"]+)";/)?.[1];
if (iconVersion !== version) {
  throw new Error(`public/sw.js ICON_VERSION 应为 ${version}，当前为 ${iconVersion ?? "未找到"}`);
}

const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as { icons?: Array<{ src?: string }> };
const mismatchedIcon = manifest.icons?.find((icon) => typeof icon.src === "string" && icon.src.includes("?v=") && !icon.src.endsWith(`?v=${version}`));
if (mismatchedIcon) {
  throw new Error(`public/manifest.webmanifest 图标版本应为 ${version}，发现 ${mismatchedIcon.src}`);
}

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mismatchedIndexVersion = [...indexHtml.matchAll(/\?v=([0-9.]+)/g)].find((match) => match[1] !== version);
if (mismatchedIndexVersion) {
  throw new Error(`index.html PWA 资源版本应为 ${version}，发现 ${mismatchedIndexVersion[0]}`);
}

console.log(`PWA version files match v${version}`);
