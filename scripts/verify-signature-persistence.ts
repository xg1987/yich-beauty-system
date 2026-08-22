import { readFileSync } from "node:fs";

const functionsSource = readFileSync(new URL("../functions/api/[[path]].ts", import.meta.url), "utf8");
const d1Source = readFileSync(new URL("../src/cloudflare/d1Database.ts", import.meta.url), "utf8");
const authenticatedAppSource = readFileSync(new URL("../src/app/AuthenticatedApp.tsx", import.meta.url), "utf8");
const signaturePageSource = readFileSync(new URL("../src/pages/public/CustomerSignaturePage.tsx", import.meta.url), "utf8");

assertArrayIncludes("customerSignatureWriteKeys", "appointments");
assertArrayIncludes("customerSignatureWriteKeys", "orders");
assertArrayIncludes("customerSignatureWriteKeys", "memberCards");
assertArrayIncludes("customerSignatureWriteKeys", "memberCardTransactions");
assertArrayIncludes("customerSignatureWriteKeys", "customerSignatures");
assertArrayOmits("memberCardWriteKeys", "customerSignatures");
assertContains("await database.completeMemberCardOpenMutation({", "开卡及新签名应在同一个专用原子操作中保存");
assertContains("await database.upsertCustomerSignatures([createdSignature]);", "独立创建签名应只写当前新增签名");
assertContains(
  "await database.applyStoreTableChanges(storeId, currentData, nextData, customerSignatureWriteKeys);",
  "公开签名确认应在单个增量批次中原子保存签名及关联业务数据",
);
assertContains(
  "await persistDataTableChanges(database, session, previousData, nextData, customerSignatureWriteKeys);",
  "内部签名确认应在单个增量批次中原子保存签名及关联业务数据",
);
assertContains("readCustomerSignatureByIdForStore(signatureId, storeId)", "内部签名确认应按 id 和当前门店读取单条签名");
assertContains("database.readMemberCardMutationData(storeId", "会员卡操作应使用精准读取方法");
assertContains("return { ...data, customerSignatures: [signature] };", "公开签名链接应只加载当前签名");
assertD1Contains("async readCustomerSignatureContext(", "签名流程应使用精准上下文读取");
assertD1Contains("async completeMemberCardOpenMutation(", "开卡流程应提供包含签名的专用原子写入");
assertD1Contains("async applyStoreTableChanges(", "门店保存应使用增量差异写入");
assertD1Contains("const changedRows = nextRows.filter", "增量保存应只写发生变化的记录");
assertD1Contains("if (statements.length) await this.db.batch(statements);", "签名及关联业务数据应使用单个 D1 batch 原子提交");
assertSourceContains(authenticatedAppSource, "setView(\"pos\", { posModule: \"orders\", posOrderId: order.id });", "待签名预约应能直达对应订单改错");
assertSourceContains(authenticatedAppSource, "posRemote.selectRecord(\"order\", initialOrderId);", "收银流水应自动打开指定订单详情");
assertSourceContains(authenticatedAppSource, "if (status === \"已到店\") return \"已到店待服务\";", "已到店预约在明细表中不得继续显示为待确认到店");
assertSourceContains(authenticatedAppSource, "if (refundedAppointmentId && onReturnAppointments)", "关联预约退款后应自动返回预约页继续改正开单");
assertSourceContains(signaturePageSource, "内容有误，放弃签名并改正", "签名页应提供明确的改错入口");
assertSourceContains(signaturePageSource, "/?view=pos&module=orders&orderId=", "签名页改错入口应直达对应收银订单");

console.log("Signature persistence paths use scoped atomic incremental writes.");

function assertArrayIncludes(name: string, required: string) {
  const match = functionsSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) throw new Error(`未找到 ${name}`);
  if (!match[1].includes(`"${required}"`)) {
    throw new Error(`${name} 必须包含 ${required}，否则签名与关联业务状态无法原子保存`);
  }
}

function assertArrayOmits(name: string, forbidden: string) {
  const match = functionsSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) throw new Error(`未找到 ${name}`);
  if (match[1].includes(`"${forbidden}"`)) {
    throw new Error(`${name} 不能包含 ${forbidden}，否则会触发签名表全表重写`);
  }
}

function assertContains(snippet: string, message: string) {
  if (!functionsSource.includes(snippet)) throw new Error(message);
}

function assertD1Contains(snippet: string, message: string) {
  if (!d1Source.includes(snippet)) throw new Error(message);
}

function assertSourceContains(source: string, snippet: string, message: string) {
  if (!source.includes(snippet)) throw new Error(message);
}
