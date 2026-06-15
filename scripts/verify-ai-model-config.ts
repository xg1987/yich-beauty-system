import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = [
  "functions/api/[[path]].ts",
  "src/app/AuthenticatedApp.tsx",
  "src/app/platformViews.tsx",
];

const violations: string[] = [];

for (const file of files) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  if (source.includes('model: "gpt-image-1.5"')) {
    violations.push(`${file} still uses gpt-image-1.5 as a default image model`);
  }
  if (source.includes('"gpt-image-2": "gpt-image-1.5"')) {
    violations.push(`${file} still remaps gpt-image-2 to gpt-image-1.5`);
  }
}

const backendSource = readFileSync(join(process.cwd(), "functions/api/[[path]].ts"), "utf8");
const appSource = readFileSync(join(process.cwd(), "src/app/AuthenticatedApp.tsx"), "utf8");
const platformSource = readFileSync(join(process.cwd(), "src/app/platformViews.tsx"), "utf8");

if (!backendSource.includes('"gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"')) {
  violations.push("Backend must allow gpt-image-2 as the first supported OpenAI image model.");
}

if (!backendSource.includes('model: "gpt-image-2"')) {
  violations.push("Backend default image model must be gpt-image-2.");
}

if (!appSource.includes('model: "gpt-image-2"')) {
  violations.push("Frontend default image model must be gpt-image-2.");
}

if (!platformSource.includes("OPENAI_IMAGE_MODEL_OPTIONS.map")) {
  violations.push("AI image model settings must use controlled model options.");
}

if (violations.length > 0) {
  console.error("AI 模型配置检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("AI 模型配置检查通过。");
