import { readFileSync } from "node:fs";

const functionsSource = readFileSync(new URL("../functions/api/[[path]].ts", import.meta.url), "utf8");

assertArrayOmits("customerSignatureWriteKeys", "customerSignatures");
assertArrayOmits("memberCardMutationKeys", "customerSignatures");
assertArrayOmits("memberCardWriteKeys", "customerSignatures");
assertContains("await database.upsertCustomerSignatures(newSignatures);", "开卡应只写新增签名");
assertContains("await database.upsertCustomerSignatures([signedSignature]);", "签名确认应只写当前签名");
assertContains("readCustomerSignatureById(signatureId)", "内部签名确认应按 id 读取单条签名");
assertContains("return { ...data, customerSignatures: [signature] };", "公开签名链接应只加载当前签名");

console.log("Signature persistence paths use single-row upserts.");

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
