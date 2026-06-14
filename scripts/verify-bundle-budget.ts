import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type AssetCheck = {
  label: string;
  pattern: RegExp;
  maxBytes?: number;
  required?: boolean;
};

const root = process.cwd();
const distDir = join(root, "dist");
const assetsDir = join(distDir, "assets");

function fail(message: string): never {
  throw new Error(`[bundle-budget] ${message}`);
}

function lineCount(path: string) {
  return readFileSync(path, "utf-8").split(/\r?\n/).length;
}

function assetSize(file: string) {
  return statSync(join(assetsDir, file)).size;
}

if (!existsSync(assetsDir)) {
  fail("dist/assets 不存在，请先运行 npm run build");
}

const appLines = lineCount(join(root, "src/App.tsx"));
if (appLines > 160) {
  fail(`src/App.tsx 行数 ${appLines} 超过 160，路由入口不应重新变成巨石组件`);
}

const authenticatedLines = lineCount(join(root, "src/app/AuthenticatedApp.tsx"));
if (authenticatedLines > 8500) {
  fail(`src/app/AuthenticatedApp.tsx 行数 ${authenticatedLines} 超过 8500，请继续拆页面，不要回退第三期成果`);
}

const indexHtml = readFileSync(join(distDir, "index.html"), "utf-8");
for (const eagerChunk of ["AuthenticatedApp", "Reports", "OperationLogs"]) {
  if (indexHtml.includes(eagerChunk)) {
    fail(`index.html 不应预加载 ${eagerChunk}，后台页面必须按需加载`);
  }
}

const assets = readdirSync(assetsDir).filter((file) => file.endsWith(".js"));
const checks: AssetCheck[] = [
  { label: "入口 index chunk", pattern: /^index-.*\.js$/, maxBytes: 12_000, required: true },
  { label: "认证门控 AuthGate chunk", pattern: /^AuthGate-.*\.js$/, maxBytes: 12_000, required: true },
  { label: "登录后主应用 AuthenticatedApp chunk", pattern: /^AuthenticatedApp-.*\.js$/, maxBytes: 211_000, required: true },
  { label: "报表页 Reports chunk", pattern: /^Reports-.*\.js$/, maxBytes: 16_000, required: true },
  { label: "操作日志 OperationLogs chunk", pattern: /^OperationLogs-.*\.js$/, maxBytes: 6_000, required: true },
];

const results = checks.map((check) => {
  const matched = assets.find((file) => check.pattern.test(file));
  if (!matched) {
    if (check.required) fail(`缺少 ${check.label}`);
    return undefined;
  }
  const size = assetSize(matched);
  if (check.maxBytes && size > check.maxBytes) {
    fail(`${check.label} ${matched} 为 ${size} bytes，超过预算 ${check.maxBytes} bytes`);
  }
  return { label: check.label, file: matched, size };
}).filter(Boolean);

console.log("[bundle-budget] ok");
for (const result of results) {
  console.log(`- ${result!.label}: ${result!.file} ${result!.size} bytes`);
}
console.log(`- src/App.tsx: ${appLines} lines`);
console.log(`- src/app/AuthenticatedApp.tsx: ${authenticatedLines} lines`);
