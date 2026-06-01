import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type ForbiddenCopy = {
  phrase: string;
  reason: string;
};

const scanRoots = ["src", "server", "functions"].map((name) => join(process.cwd(), name));

const ignoredFiles = new Set([
  "src/domain/testFixture.ts",
  "src/cloudflare/auth.ts",
  "src/domain/business.ts",
]);

const forbiddenCopies: ForbiddenCopy[] = [
  { phrase: "超级 admin", reason: "正式产品中不展示内部角色解释" },
  { phrase: "超级 Admin", reason: "正式产品中不展示内部角色解释" },
  { phrase: "超级admin", reason: "正式产品中不展示内部角色解释" },
  { phrase: "超级管理员", reason: "界面统一使用系统管理员" },
  { phrase: "只读", reason: "正式产品中不展示实现口径" },
  { phrase: "不新增", reason: "正式产品中不展示限制说明" },
  { phrase: "不改约", reason: "正式产品中不展示限制说明" },
  { phrase: "不取消", reason: "正式产品中不展示限制说明" },
  { phrase: "不录入", reason: "正式产品中不展示内部边界说明" },
  { phrase: "不处理", reason: "正式产品中不展示内部边界说明" },
  { phrase: "只看", reason: "正式产品中不展示实现口径" },
  { phrase: "只查看", reason: "正式产品中不展示实现口径" },
  { phrase: "待接入", reason: "正式产品中不展示未完成状态" },
  { phrase: "估算", reason: "数据页必须展示真实数据或明确为空" },
  { phrase: "演示", reason: "正式产品中不展示演示标记" },
  { phrase: "DEMO", reason: "正式产品中不展示演示标记" },
  { phrase: "demo", reason: "正式产品中不展示演示标记" },
  { phrase: "这里只做", reason: "正式产品中不展示内部设计解释" },
  { phrase: "管理员只", reason: "正式产品中不展示内部设计解释" },
  { phrase: "返回管理中心", reason: "返回标题统一使用返回图标和页面标题" },
  { phrase: "老板账号", reason: "Admin 端统一使用门店账号/负责人账号" },
  { phrase: "门店负责人", reason: "Admin 端统一使用负责人账号" },
  { phrase: "平台数据查看", reason: "页面标题统一使用数据总览" },
];

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const filePath = join(dir, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return collectFiles(filePath);
    if (!/\.(ts|tsx|css)$/.test(name)) return [];
    return [filePath];
  });
}

const violations: string[] = [];

for (const root of scanRoots) {
  for (const filePath of collectFiles(root)) {
    const rel = relative(process.cwd(), filePath);
    if (ignoredFiles.has(rel)) continue;

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const item of forbiddenCopies) {
        if (line.includes(item.phrase)) {
          violations.push(`${rel}:${index + 1} contains "${item.phrase}" - ${item.reason}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("正式产品文案检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("正式产品文案检查通过。");
