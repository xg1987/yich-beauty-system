import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Eye, Image as ImageIcon, Megaphone, Plus, Search, Sparkles, X } from "lucide-react";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import type { UserSession } from "../domain/auth";
import { aiFreeQuotaState } from "../domain/aiBilling";
import { isMarketingAiRecordPending, isStaleMarketingAiRecord } from "../domain/business";
import type { AppData, MarketingAiRecord } from "../domain/types";
import type { ApiActions } from "../hooks/useApiData";
import {
  AI_PROVIDER_LABELS,
  aiCapabilityUsageState,
  aiGenerationConfigFromSystemConfigs,
  copyTextToClipboard,
  primaryStoreName,
  storeAiUsagePermissions,
} from "./AuthenticatedApp";

type MarketingViewKey = "content" | "records";
type MarketingGenerationKind = "copy" | "image" | "video" | "talk";
type MarketingNode = { title: string; badge: string; description: string; hint?: string; dateLabel?: string };
type MarketingCalendarNode = {
  title: string;
  date: string;
  category: "传统节日" | "节气内容" | "养生节点" | "项目周期";
  description: string;
  leadDays: number;
  priority: number;
  serviceHint: string;
};

const marketingCalendarNodes: MarketingCalendarNode[] = [
  { title: "小寒暖护", date: "2026-01-05", category: "节气内容", description: "小寒寒湿重，适合手脚凉、肩颈紧和睡眠关怀。", leadDays: 8, priority: 50, serviceHint: "艾灸、足浴、肩颈" },
  { title: "大寒温养", date: "2026-01-20", category: "节气内容", description: "大寒适合做全年温补收尾和年前身体养护提醒。", leadDays: 10, priority: 54, serviceHint: "药浴、艾灸、暖宫" },
  { title: "腊八温养", date: "2026-01-26", category: "传统节日", description: "用腊八温补、驱寒、睡眠调理做年前护理铺垫。", leadDays: 10, priority: 62, serviceHint: "艾灸、药浴、足浴、肩颈" },
  { title: "立春焕新", date: "2026-02-04", category: "节气内容", description: "春季开始，适合焕肤、疏肝和轻养护预热。", leadDays: 8, priority: 52, serviceHint: "面部清洁、肩颈、头疗" },
  { title: "小年焕新", date: "2026-02-10", category: "传统节日", description: "年前清洁、焕肤、身体放松，适合做预约提醒。", leadDays: 14, priority: 70, serviceHint: "面部清洁、补水、肩颈" },
  { title: "除夕焕颜", date: "2026-02-16", category: "传统节日", description: "除夕前适合做最后一轮美肤、身体放松和祝福内容。", leadDays: 10, priority: 80, serviceHint: "补水、清洁、肩颈" },
  { title: "春节焕颜", date: "2026-02-17", category: "传统节日", description: "过年前后形象管理，适合老客复购和礼卡转化。", leadDays: 18, priority: 92, serviceHint: "皮肤管理、礼卡、身体护理" },
  { title: "雨水润养", date: "2026-02-18", category: "节气内容", description: "雨水后湿气渐起，适合补水、祛湿和肩颈舒缓。", leadDays: 7, priority: 48, serviceHint: "补水、药浴、肩颈" },
  { title: "元宵团圆护理", date: "2026-03-03", category: "传统节日", description: "春节收尾，用团圆祝福带出轻护理和复工状态恢复。", leadDays: 10, priority: 66, serviceHint: "补水、肩颈、睡眠" },
  { title: "惊蛰唤醒", date: "2026-03-05", category: "节气内容", description: "惊蛰适合唤醒代谢、改善春困和身体沉重感。", leadDays: 8, priority: 50, serviceHint: "药浴、肩颈、头疗" },
  { title: "龙抬头焕新", date: "2026-03-20", category: "传统节日", description: "春季焕新、头肩颈放松，适合发轻种草内容。", leadDays: 10, priority: 60, serviceHint: "头疗、肩颈、面部清洁" },
  { title: "春分平衡", date: "2026-03-20", category: "节气内容", description: "春分昼夜平衡，适合舒肝、睡眠和皮肤稳定护理。", leadDays: 8, priority: 52, serviceHint: "睡眠、肩颈、补水" },
  { title: "清明节气", date: "2026-04-05", category: "节气内容", description: "清明既是节气也是节日，适合春湿、舒肝和轻养护提醒。", leadDays: 8, priority: 50, serviceHint: "药浴、肩颈、头疗" },
  { title: "清明舒养", date: "2026-04-05", category: "传统节日", description: "清明前后春湿明显，适合舒肝、祛湿、轻养护提醒。", leadDays: 12, priority: 72, serviceHint: "药浴、艾灸、肩颈" },
  { title: "谷雨润肤", date: "2026-04-20", category: "节气内容", description: "谷雨湿度上升，适合补水、屏障修护和祛湿内容。", leadDays: 8, priority: 54, serviceHint: "补水、修护、药浴" },
  { title: "上巳春养", date: "2026-04-19", category: "传统节日", description: "上巳适合踏青、春日焕新和轻护理内容。", leadDays: 8, priority: 46, serviceHint: "补水、清洁、香氛护理" },
  { title: "端午祛湿", date: "2026-06-19", category: "传统节日", description: "端午艾草、药浴、祛湿心智强，适合提前做预约提醒。", leadDays: 18, priority: 95, serviceHint: "药浴、艾灸、祛湿、肩颈" },
  { title: "七夕美肤", date: "2026-08-19", category: "传统节日", description: "七夕适合美肤、香氛身体护理和礼赠内容。", leadDays: 18, priority: 82, serviceHint: "补水、美白、香氛护理" },
  { title: "中元安养", date: "2026-08-27", category: "传统节日", description: "不做强促销，用安神、睡眠、肩颈舒缓表达关怀。", leadDays: 8, priority: 46, serviceHint: "睡眠、头疗、肩颈" },
  { title: "中秋团圆护理", date: "2026-09-25", category: "传统节日", description: "团圆送礼、妈妈护理和家庭关怀，适合礼卡和套盒。", leadDays: 18, priority: 88, serviceHint: "礼卡、面护、肩颈" },
  { title: "重阳长辈养护", date: "2026-10-26", category: "传统节日", description: "敬老关怀，适合长辈肩颈、睡眠和温养项目。", leadDays: 16, priority: 78, serviceHint: "艾灸、肩颈、睡眠" },
  { title: "下元温护", date: "2026-11-23", category: "传统节日", description: "下元适合温和关怀，不强促销，带出冬季调理。", leadDays: 8, priority: 44, serviceHint: "艾灸、足浴、睡眠" },
  { title: "冬至温补", date: "2026-12-22", category: "传统节日", description: "冬至温补心智明确，适合暖宫、艾灸、足浴提醒。", leadDays: 18, priority: 90, serviceHint: "艾灸、暖宫、足浴" },
  { title: "立夏养护", date: "2026-05-05", category: "节气内容", description: "夏季开始，提醒防晒、补水和身体代谢管理。", leadDays: 7, priority: 50, serviceHint: "补水、防晒、身体护理" },
  { title: "小满清湿", date: "2026-05-21", category: "节气内容", description: "小满湿热渐起，适合祛湿、代谢和皮肤清爽护理。", leadDays: 8, priority: 52, serviceHint: "药浴、清洁、肩颈" },
  { title: "芒种排湿", date: "2026-06-05", category: "节气内容", description: "湿热上来，适合用护理需求带出祛湿必要性。", leadDays: 7, priority: 60, serviceHint: "药浴、艾灸、祛湿" },
  { title: "夏至养阳", date: "2026-06-21", category: "节气内容", description: "夏至前后适合养阳、祛湿、防空调寒。", leadDays: 10, priority: 74, serviceHint: "艾灸、药浴、肩颈" },
  { title: "小暑清养", date: "2026-07-07", category: "节气内容", description: "小暑热湿明显，适合清爽补水和身体轻养。", leadDays: 8, priority: 58, serviceHint: "补水、药浴、肩颈" },
  { title: "大暑排湿", date: "2026-07-23", category: "节气内容", description: "大暑适合排湿、代谢、睡眠调理类内容。", leadDays: 8, priority: 64, serviceHint: "药浴、艾灸、睡眠" },
  { title: "立秋修护", date: "2026-08-07", category: "节气内容", description: "换季提醒皮肤屏障、干燥和身体疲乏。", leadDays: 9, priority: 58, serviceHint: "补水、修护、肩颈" },
  { title: "处暑舒缓", date: "2026-08-23", category: "节气内容", description: "处暑适合从暑湿转向修护，提醒睡眠和皮肤稳定。", leadDays: 8, priority: 54, serviceHint: "补水、睡眠、肩颈" },
  { title: "白露润养", date: "2026-09-07", category: "节气内容", description: "秋燥明显，适合补水、润养和睡眠关怀。", leadDays: 8, priority: 56, serviceHint: "补水、修护、睡眠" },
  { title: "秋分修护", date: "2026-09-23", category: "节气内容", description: "秋分适合平衡修护，提醒干燥、暗沉和肩颈疲劳。", leadDays: 8, priority: 55, serviceHint: "补水、修护、肩颈" },
  { title: "寒露暖护", date: "2026-10-08", category: "节气内容", description: "降温前后提醒肩颈、手脚凉和暖养。", leadDays: 8, priority: 55, serviceHint: "艾灸、肩颈、足浴" },
  { title: "霜降暖养", date: "2026-10-23", category: "节气内容", description: "霜降适合提醒降温、寒湿和冬季项目预热。", leadDays: 8, priority: 58, serviceHint: "艾灸、足浴、肩颈" },
  { title: "立冬温养", date: "2026-11-07", category: "节气内容", description: "入冬适合温补、艾灸、暖宫和足浴项目。", leadDays: 10, priority: 68, serviceHint: "艾灸、暖宫、足浴" },
  { title: "小雪暖护", date: "2026-11-22", category: "节气内容", description: "小雪后寒意明显，适合手脚凉、肩颈和睡眠提醒。", leadDays: 8, priority: 56, serviceHint: "足浴、艾灸、睡眠" },
  { title: "大雪温补", date: "2026-12-07", category: "节气内容", description: "大雪适合冬季温补、暖宫和年末疲劳修复。", leadDays: 10, priority: 62, serviceHint: "艾灸、暖宫、肩颈" },
  { title: "冬至节气", date: "2026-12-22", category: "节气内容", description: "冬至是一阳来复的节点，适合温补和暖护类内容。", leadDays: 10, priority: 64, serviceHint: "艾灸、足浴、暖宫" },
  { title: "三伏预热", date: "2026-07-20", category: "养生节点", description: "三伏前先做铺垫，适合会员复购和老客预约。", leadDays: 45, priority: 86, serviceHint: "三伏灸、药浴、艾灸" },
  { title: "三九温补", date: "2026-12-22", category: "养生节点", description: "三九前后温补需求强，适合寒湿、肩颈和睡眠客群。", leadDays: 18, priority: 80, serviceHint: "三九灸、药浴、足浴" },
  { title: "项目复购提醒", date: "2026-06-14", category: "项目周期", description: "没有更近节日时，优先结合项目周期提醒老客复购。", leadDays: 365, priority: 12, serviceHint: "按客户最近消费项目推荐" },
];
const marketingGoals = ["复购提醒", "项目转化", "沉睡唤醒", "护理建议"];
const generationModes: Array<{ kind: MarketingGenerationKind; title: string; description: string; locked?: boolean }> = [
  { kind: "copy", title: "文案", description: "输出配套话术，适合直接发布" },
  { kind: "image", title: "海报", description: "调用图片模型生成正式海报" },
  { kind: "video", title: "视频", description: "调试中，暂不开放", locked: true },
  { kind: "talk", title: "口播", description: "调试中，暂不开放", locked: true },
];
const posterStyles = [
  { title: "中医养生风", description: "宣纸、草药、药灸、温和调理" },
  { title: "节气海报", description: "三伏、三九、换季、时令提醒" },
  { title: "轻奢护理风", description: "适合皮肤管理和高客单护理" },
  { title: "小红书种草", description: "痛点标题、体验感、收藏转化" },
];
const channels = ["朋友圈", "小红书", "私聊", "社群"];
const posterSizes = ["朋友圈 1:1", "小红书 3:4", "竖版 9:16", "横版 16:9"];
const videoRatios = ["9:16", "1:1", "16:9"];
const videoDurations = [5, 10, 15];
const MAX_MARKETING_ASSET_BYTES = 8 * 1024 * 1024;
const USD_TO_CNY_DISPLAY_RATE = 6.77;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MARKETING_PENDING_LOST_MESSAGE = "后台生成任务超过10分钟仍未返回结果，可能已被服务重启、供应商超时或网络中断终止。请重新生成。";

function localDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatMarketingDate(value: Date) {
  return value.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function readMarketingImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("请上传图片文件"));
  if (file.size > MAX_MARKETING_ASSET_BYTES) return Promise.reject(new Error("单张图片不能超过 8MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function marketingNodeTimingLabel(daysUntil: number) {
  if (daysUntil === 0) return "今天";
  if (daysUntil > 0) return `还有 ${daysUntil} 天`;
  return `已过 ${Math.abs(daysUntil)} 天`;
}

function getMarketingNodes(today = new Date()): MarketingNode[] {
  const todayDate = localDateOnly(today);
  const projectNodes = marketingCalendarNodes.filter((node) => node.category === "项目周期");
  const timedNodes = marketingCalendarNodes
    .filter((node) => node.category !== "项目周期")
    .map((node) => {
      const targetDate = parseCalendarDate(node.date);
      const daysUntil = Math.round((localDateOnly(targetDate).getTime() - todayDate.getTime()) / MS_PER_DAY);
      const inWindow = daysUntil >= -2 && daysUntil <= node.leadDays;
      const nearScore = Math.max(0, node.leadDays - Math.max(daysUntil, 0));
      return { node, targetDate, daysUntil, inWindow, score: (inWindow ? 1000 : 0) + node.priority + nearScore };
    })
    .filter((item) => item.inWindow)
    .sort((left, right) => right.score - left.score || Math.abs(left.daysUntil) - Math.abs(right.daysUntil));

  const fallbackNodes: MarketingNode[] = [
    { title: "夏季祛湿", badge: "当前推荐", description: "适合湿重、虚胖、身体沉、出汗少客户。", hint: "药浴、艾灸、祛湿", dateLabel: "季节推荐" },
    { title: "三伏预热", badge: "养生节点", description: "提前做三伏养阳铺垫，适合会员复购。", hint: "三伏灸、药浴、艾灸", dateLabel: "7月20日" },
    { title: "阳气养护", badge: "节气内容", description: "不硬促销，用护理需求带出护理必要性。", hint: "艾灸、肩颈、睡眠", dateLabel: "节气推荐" },
  ];

  const result = timedNodes.slice(0, 3).map(({ node, targetDate, daysUntil }) => ({
    title: node.title,
    badge: node.category,
    description: node.description,
    hint: node.serviceHint,
    dateLabel: `${formatMarketingDate(targetDate)} · ${marketingNodeTimingLabel(daysUntil)}`,
  }));
  const projectFallback = projectNodes.map((node) => ({
    title: node.title,
    badge: node.category,
    description: node.description,
    hint: node.serviceHint,
    dateLabel: "自动兜底",
  }));

  return result.length >= 3 ? result : [...result, ...fallbackNodes, ...projectFallback].slice(0, 3);
}

function aiCostAmountUsd(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return undefined;
  if (typeof cost === "number") return Number.isFinite(cost) ? cost : undefined;
  return Number.isFinite(cost.amountUsd) ? cost.amountUsd : undefined;
}

function formatAiCostRmb(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return "生成完成后显示";
  const amountUsd = aiCostAmountUsd(cost);
  if (amountUsd === undefined) return "暂无费用记录";
  if (typeof cost !== "number" && cost.priceConfigured === false) return "费用未配置";
  const amount = amountUsd * USD_TO_CNY_DISPLAY_RATE;
  if (amount > 0 && amount < 0.01) return `人民币 ${amount.toFixed(6)} 元`;
  if (amount > 0 && amount < 1) return `人民币 ${amount.toFixed(4)} 元`;
  return `人民币 ${amount.toFixed(2)} 元`;
}

function formatAiCostUsd(cost?: { amountUsd: number; currency: "USD"; basis: string; priceConfigured: boolean; estimated: boolean }) {
  if (!cost) return "暂无费用记录";
  if (!cost.priceConfigured) return "未配置单价";
  const amount = cost.amountUsd;
  return `$${amount.toFixed(amount > 0 && amount < 0.01 ? 6 : 4)} ${cost.currency}`;
}

function formatAiUsageCostDetail(cost?: { basis: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; estimated: boolean }) {
  if (!cost) return "请检查后台模型价格配置";
  return [
    cost.basis,
    cost.inputTokens ? `输入 ${cost.inputTokens}` : "",
    cost.outputTokens ? `输出 ${cost.outputTokens}` : "",
    cost.totalTokens ? `合计 ${cost.totalTokens}` : "",
    cost.estimated ? "预估" : "",
  ].filter(Boolean).join(" · ");
}

function marketingCopySections(text: string) {
  const trimmed = text.trim();
  const matches = [...trimmed.matchAll(/【([^】]{1,16})】/g)];
  if (matches.length > 0) {
    return matches.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? trimmed.length;
      return {
        title: match[1].trim(),
        body: trimmed.slice(start, end).trim(),
      };
    }).filter((section) => section.body);
  }

  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.map((line, index) => ({ title: index === 0 ? "标题" : `内容 ${index}`, body: line }));
  }
  return [{ title: "生成内容", body: trimmed }];
}

function marketingRecordContent(record: MarketingAiRecord) {
  if (record.text) return record.text;
  if (record.videoUrl) return record.videoUrl;
  return [
    marketingRecordTitle(record),
    marketingRecordSummary(record),
    marketingRecordMeta(record),
    `费用：${formatAiCostRmb(record.cost)}`,
  ].map(compactRecordText).filter(Boolean).join("\n");
}

function marketingRecordKindLabel(kind: MarketingAiRecord["kind"]) {
  return kind === "image" ? "海报" : kind === "video" ? "视频" : kind === "talk" ? "口播" : "文案";
}

function compactRecordText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function marketingRecordPreviewText(record: MarketingAiRecord) {
  return compactRecordText(record.text || record.videoUrl);
}

function marketingRecordTitle(record: MarketingAiRecord) {
  const title = compactRecordText(record.title);
  if (title) return title;
  const contentTitle = marketingRecordPreviewText(record).slice(0, 22);
  if (contentTitle) return contentTitle;
  return `AI${marketingRecordKindLabel(record.kind)}记录`;
}

function marketingRecordSummary(record: MarketingAiRecord) {
  if (record.status === "生成失败") return compactRecordText(record.errorMessage || record.text || "生成失败").slice(0, 48);
  if (isMarketingAiRecordPending(record)) return "正在生成，请稍后查看结果";
  const content = marketingRecordPreviewText(record);
  if (content) return content.slice(0, 48);
  return [
    record.marketingNode,
    record.customerType,
    record.marketingGoal,
    record.channel,
    record.serviceName,
    record.productName,
  ].map(compactRecordText).filter(Boolean).join(" · ") || "已生成，可点击查看详情";
}

function marketingRecordMeta(record: MarketingAiRecord) {
  return [
    compactRecordText(record.status),
    marketingRecordKindLabel(record.kind),
    compactRecordText(record.channel) || "未标记渠道",
    shortRecordTime(record.createdAt),
  ].filter(Boolean).join(" · ");
}

function staleMarketingAiRecord(record: MarketingAiRecord): MarketingAiRecord {
  if (!isStaleMarketingAiRecord(record)) return record;
  return {
    ...record,
    status: "生成失败",
    text: MARKETING_PENDING_LOST_MESSAGE,
    errorMessage: MARKETING_PENDING_LOST_MESSAGE,
    elapsedMs: Math.max(0, Date.now() - new Date(record.createdAt).getTime()),
  };
}

function shortRecordTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "时间未记录";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadMarketingRecord(record: MarketingAiRecord) {
  const filename = `${marketingRecordTitle(record)}-${(record.createdAt || new Date().toISOString()).slice(0, 10)}`;
  if (record.kind !== "copy" && record.imageDataUrl) {
    downloadDataUrl(record.imageDataUrl, `${filename}${record.imageDataUrl.startsWith("data:image/svg+xml") ? ".svg" : ".png"}`);
    return;
  }
  const link = document.createElement("a");
  if (record.videoUrl) {
    link.href = record.videoUrl;
    link.download = `${filename}.mp4`;
    link.target = "_blank";
  } else {
    const blob = new Blob([record.text ?? ""], { type: "text/plain;charset=utf-8" });
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.txt`;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (link.href.startsWith("blob:")) URL.revokeObjectURL(link.href);
}

export function MarketingCenter({
  data,
  session,
  actions,
  refreshMarketingData,
}: {
  data: AppData;
  session: UserSession;
  actions: ApiActions;
  refreshMarketingData?: () => Promise<void>;
}) {
  const todayMarketingNodes = useMemo(() => getMarketingNodes(), []);
  const [activeView, setActiveView] = useState<MarketingViewKey>("content");
  const [marketingNode, setMarketingNode] = useState(todayMarketingNodes[0].title);
  const customerType = "老客户";
  const bodyState = "常规护理需求";
  const [channel, setChannel] = useState("朋友圈");
  const [marketingGoal, setMarketingGoal] = useState("复购提醒");
  const [generationKind, setGenerationKind] = useState<MarketingGenerationKind>("copy");
  const [posterStyle, setPosterStyle] = useState("中医养生风");
  const [posterSize, setPosterSize] = useState("朋友圈 1:1");
  const [videoRatio, setVideoRatio] = useState("9:16");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoScript, setVideoScript] = useState("门店护理环境、产品陈列、护理手法和预约引导。");
  const [customRequirement, setCustomRequirement] = useState("");
  const [productImageName, setProductImageName] = useState("");
  const [productImageDataUrl, setProductImageDataUrl] = useState("");
  const [modelImageName, setModelImageName] = useState("");
  const [modelImageDataUrl, setModelImageDataUrl] = useState("");
  const [sceneImageName, setSceneImageName] = useState("");
  const [sceneImageDataUrl, setSceneImageDataUrl] = useState("");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationResult, setGenerationResult] = useState<Awaited<ReturnType<ApiActions["generateMarketingAi"]>> | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [copyResultStatus, setCopyResultStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [downloadResultStatus, setDownloadResultStatus] = useState<"idle" | "downloaded" | "failed">("idle");
  const [manualCopyText, setManualCopyText] = useState("");
  const product = data.products[0];
  const service = data.services[0];
  const storeName = primaryStoreName(data) || "门店";
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const aiPermissions = storeAiUsagePermissions(data);
  const selectedCapability = generationKind === "image" ? "image" : generationKind === "video" ? "video" : "copy";
  const contentState = aiCapabilityUsageState(aiConfig, aiPermissions, session.user.role, selectedCapability);
  const selectedGenerationMode = generationModes.find((item) => item.kind === generationKind) ?? generationModes[0];
  const selectedModeLocked = Boolean(selectedGenerationMode.locked);
  const isPosterMode = generationKind === "image";
  const quotaState = aiFreeQuotaState(data, session.user.id);
  const selectedNode = todayMarketingNodes.find((item) => item.title === marketingNode) ?? todayMarketingNodes[0];
  const audienceSummary = `${customerType}，${bodyState}`;
  const nodeBrief = [selectedNode.title, selectedNode.dateLabel, selectedNode.hint].filter(Boolean).join(" · ");
  const generationRequirement = [
    nodeBrief ? `当前营销时间节点：${nodeBrief}` : "",
    selectedNode.description ? `节点策略：${selectedNode.description}` : "",
    customRequirement.trim(),
  ].filter(Boolean).join("\n");
  const previewSummaryItems = [marketingNode, channel, marketingGoal];
  const marketingAiRecords = [...(data.marketingAiRecords ?? [])].map(staleMarketingAiRecord).sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
  const typedMarketingAiRecords = marketingAiRecords.filter((record) => record.kind === generationKind);
  const latestGenerationResultRecord = generationResult?.record?.id ? marketingAiRecords.find((record) => record.id === generationResult.record?.id) : undefined;
  const generationResultRecord = generationResult?.record ? staleMarketingAiRecord(latestGenerationResultRecord ?? generationResult.record) : undefined;
  const hasPendingMarketingAiRecords = marketingAiRecords.some((record) => isMarketingAiRecordPending(record) && !isStaleMarketingAiRecord(record));
  const hasPendingGenerationResult = Boolean(generationResultRecord && isMarketingAiRecordPending(generationResultRecord) && !isStaleMarketingAiRecord(generationResultRecord));
  const selectedMarketingRecord = marketingAiRecords.find((record) => record.id === selectedRecordId);
  const dialogRecord = selectedMarketingRecord ?? generationResultRecord;
  const dialogText = dialogRecord?.text ?? generationResult?.text;
  const dialogImageDataUrl = dialogRecord?.imageDataUrl ?? generationResult?.imageDataUrl;
  const dialogVideoUrl = dialogRecord?.videoUrl ?? generationResult?.videoUrl;
  const dialogVideoTaskId = dialogRecord?.taskId ?? generationResult?.taskId;
  const dialogVideoStatus = dialogRecord?.status ?? generationResult?.status;
  const dialogErrorMessage = dialogRecord?.errorMessage ?? generationResult?.errorMessage;
  const dialogPending = dialogVideoStatus === "生成中";
  const dialogKind = dialogRecord?.kind ?? generationResult?.kind ?? generationKind;
  const dialogKindTitle = dialogKind === "image" ? "AI海报" : dialogKind === "video" ? "AI短视频" : dialogKind === "talk" ? "AI口播" : "AI营销文案";
  const dialogCost = dialogRecord?.cost ?? generationResult?.cost;
  const dialogProvider = dialogRecord?.provider ?? generationResult?.provider;
  const dialogModel = dialogRecord?.model ?? generationResult?.model;
  const dialogSummaryItems = dialogRecord
    ? [dialogRecord.marketingNode, dialogRecord.channel, dialogRecord.marketingGoal].filter(Boolean)
    : previewSummaryItems;
  const showGenerationDialog = Boolean(generationBusy || generationError || generationResult || selectedMarketingRecord);
  const showAiTechnicalDetails = session.user.role === "superadmin";
  const permissionStateKey = JSON.stringify({ role: session.user.role, permissions: aiPermissions, config: aiConfig });
  const unavailableMessage = () => {
    const label = selectedGenerationMode.title;
    if (contentState.label === "未开通") return `当前门店未开放 ${label} 权限`;
    if (contentState.label === "平台未启用") return `${label} 平台未启用`;
    return `${label} 暂不可用`;
  };

  const handleMarketingImageChange = async (
    file: File | undefined,
    setName: (value: string) => void,
    setDataUrl: (value: string) => void,
  ) => {
    if (!file) {
      setName("");
      setDataUrl("");
      return;
    }
    try {
      setGenerationError("");
      setName(file.name);
      setDataUrl(await readMarketingImageFile(file));
    } catch (caught) {
      setName("");
      setDataUrl("");
      setGenerationError(caught instanceof Error ? caught.message : "图片读取失败");
    }
  };

  useEffect(() => {
    if (selectedModeLocked) setGenerationKind("copy");
  }, [selectedModeLocked]);

  useEffect(() => {
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
  }, [activeView, generationKind]);

  useEffect(() => {
    if (contentState.enabled) return;
    setGenerationResult(null);
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
    setGenerationError(unavailableMessage());
  }, [contentState.enabled, contentState.label, permissionStateKey]);

  useEffect(() => {
    if ((!hasPendingMarketingAiRecords && !hasPendingGenerationResult) || !refreshMarketingData) return undefined;
    const intervalId = window.setInterval(() => {
      void refreshMarketingData();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [hasPendingGenerationResult, hasPendingMarketingAiRecords, refreshMarketingData]);

  const generate = async () => {
    if (!contentState.enabled) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError(unavailableMessage());
      return;
    }
    if (selectedModeLocked) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setGenerationError("视频和口播正在调试中，请先使用文案或海报");
      return;
    }
    if (generationKind === "image" && !productImageDataUrl && !modelImageDataUrl) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError("请先上传产品图或模特图，再生成海报");
      return;
    }
    setGenerationBusy(true);
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setDownloadResultStatus("idle");
    setManualCopyText("");
    try {
      const result = await actions.generateMarketingAi({
        kind: generationKind,
        storeName,
        productName: product?.name,
        serviceName: service?.name,
        audience: audienceSummary,
        channel,
        marketingNode,
        customerType,
        lifecycleNode: marketingNode,
        bodyState,
        marketingGoal,
        posterStyle,
        posterSize,
        posterTitle: marketingNode,
        posterOffer: marketingGoal,
        productImageName,
        productImageDataUrl,
        modelImageName,
        modelImageDataUrl,
        sceneImageName,
        sceneImageDataUrl,
        customRequirement: generationRequirement,
        videoRatio,
        videoDuration,
        videoScript,
        talkScene: `${marketingNode} · ${marketingGoal} · ${channel}`,
      });
      setGenerationResult(result);
      if (result.record?.id) setSelectedRecordId(result.record.id);
      if (result.status === "生成失败" || result.record?.status === "生成失败") {
        setGenerationError(result.errorMessage || result.record?.errorMessage || result.text || "AI 生成失败");
      }
      setCopyResultStatus("idle");
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "AI 生成失败");
    } finally {
      setGenerationBusy(false);
    }
  };

  const dialogCopyText = () => {
    if (dialogText) return dialogText;
    if (dialogVideoUrl) return dialogVideoUrl;
    if (dialogVideoTaskId) return `视频任务：${dialogVideoTaskId}${dialogVideoStatus ? `\n状态：${dialogVideoStatus}` : ""}`;
    if (dialogRecord) return marketingRecordContent(dialogRecord);
    return [
      "AI营销内容",
      dialogSummaryItems.join(" · "),
      `费用：${formatAiCostRmb(dialogCost)}`,
    ].map(compactRecordText).filter(Boolean).join("\n");
  };

  const copyGenerationText = async () => {
    const text = dialogCopyText();
    const copied = await copyTextToClipboard(text);
    setManualCopyText(copied ? "" : text);
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const copyRecord = async (record: MarketingAiRecord) => {
    const copied = await copyTextToClipboard(marketingRecordContent(record));
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const downloadPoster = () => {
    const title = dialogRecord ? marketingRecordTitle(dialogRecord) : `AI营销内容-${new Date().toISOString().slice(0, 10)}`;
    if (dialogKind !== "copy" && dialogImageDataUrl) {
      downloadDataUrl(dialogImageDataUrl, `${title}${dialogImageDataUrl.startsWith("data:image/svg+xml") ? ".svg" : ".png"}`);
      setDownloadResultStatus("downloaded");
      window.setTimeout(() => setDownloadResultStatus("idle"), 1800);
      return;
    }
    if (dialogText) {
      const blob = new Blob([dialogText], { type: "text/plain;charset=utf-8" });
      downloadDataUrl(URL.createObjectURL(blob), `${title}.txt`);
      setDownloadResultStatus("downloaded");
      window.setTimeout(() => setDownloadResultStatus("idle"), 1800);
      return;
    }
    if (dialogVideoUrl) {
      const link = document.createElement("a");
      link.href = dialogVideoUrl;
      link.download = `${title}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadResultStatus("downloaded");
      window.setTimeout(() => setDownloadResultStatus("idle"), 1800);
      return;
    }
    setDownloadResultStatus("failed");
    window.setTimeout(() => setDownloadResultStatus("idle"), 1800);
  };

  const returnToRecords = () => {
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
    setActiveView("records");
  };

  return (
    <div className="page-stack marketing-center-page">
      <PageHero
        icon={<Megaphone size={18} />}
        eyebrow="AI智能营销"
        title="营销中心"
      />

      <section className="workbench-panel marketing-type-panel" aria-label="生成类型">
        <div className="marketing-section-head">
          <div>
            <strong>生成类型</strong>
          </div>
          <small>{selectedGenerationMode.title}</small>
        </div>
        <div className="marketing-output-mode-grid" aria-label="生成内容类型">
          {generationModes.map((item) => (
            <button
              type="button"
              key={item.kind}
              className={generationKind === item.kind ? "active" : ""}
              disabled={item.locked}
              onClick={() => {
                if (!item.locked) setGenerationKind(item.kind);
              }}
            >
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="marketing-mode-tabs" aria-label="营销中心视图">
        <button type="button" className={activeView === "content" ? "active" : ""} onClick={() => setActiveView("content")}>
          <Sparkles size={16} /> 营销内容
        </button>
        <button type="button" className={activeView === "records" ? "active" : ""} onClick={() => setActiveView("records")}>
          <Eye size={16} /> 生成记录 <span>{typedMarketingAiRecords.length}</span>
        </button>
      </section>

      {activeView === "content" ? (
        <section className="marketing-workspace">
          <div className="workbench-panel marketing-form-panel">
            <PanelTitle icon={<Search size={18} />} title={isPosterMode ? "AI海报" : "AI营销内容"} action={contentState.label} />
            <div className={`marketing-quota-note ${quotaState.credits > 0 ? "paid" : ""} ${quotaState.enforced && quotaState.remaining === 0 ? "empty" : ""}`}>
              {quotaState.credits > 0
                ? `当前账号 AI 积分 ${quotaState.credits} 次，生成成功后扣 1 次。`
                : quotaState.enforced
                  ? `当前账号未充值，今日免费剩余 ${quotaState.remaining}/${quotaState.limit} 次。`
                  : `${quotaState.startsAt} 起，未充值账号每天可免费生成 ${quotaState.limit} 次。`}
            </div>
            {!isPosterMode && (
              <>
                <div className="marketing-context-block marketing-primary-block">
                  <div className="marketing-section-head">
                    <div>
                      <strong>今天推荐</strong>
                    </div>
                  </div>
                  <div className="marketing-node-grid" aria-label="推荐营销节点">
                    {todayMarketingNodes.map((item) => (
                      <button type="button" key={item.title} className={marketingNode === item.title ? "active" : ""} onClick={() => setMarketingNode(item.title)}>
                        <span>{item.badge}</span>
                        <strong>{item.title}</strong>
                        {item.dateLabel && <em>{item.dateLabel}</em>}
                        <small>{item.description}</small>
                        {item.hint && <small className="marketing-node-service">适合：{item.hint}</small>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="marketing-context-block marketing-primary-block">
                  <div className="marketing-section-head">
                    <div>
                      <strong>基础条件</strong>
                    </div>
                  </div>
                  <div className="marketing-config-stack">
                    <div className="marketing-config-row">
                      <div className="marketing-config-label">
                        <strong>发到哪里</strong>
                        <small>格式语气</small>
                      </div>
                      <div className="marketing-chip-row" aria-label="渠道">
                        {channels.map((item) => (
                          <button type="button" key={item} className={channel === item ? "active" : ""} onClick={() => setChannel(item)}>{item}</button>
                        ))}
                      </div>
                    </div>
                    <div className="marketing-config-row">
                      <div className="marketing-config-label">
                        <strong>想达到什么目的</strong>
                        <small>行动引导</small>
                      </div>
                      <div className="marketing-chip-row" aria-label="营销目的">
                        {marketingGoals.map((item) => (
                          <button type="button" key={item} className={marketingGoal === item ? "active" : ""} onClick={() => setMarketingGoal(item)}>{item}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {isPosterMode ? (
              <div className="marketing-context-block marketing-primary-block">
                <div className="marketing-section-head">
                  <div>
                    <strong>上传图片</strong>
                    <span>产品图或模特图，至少上传 1 张</span>
                  </div>
                  <small>至少 1 张</small>
                </div>
                <div className="marketing-upload-grid marketing-material-grid compact">
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>产品图</strong>
                    <span>{productImageName || "上传产品图片"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void handleMarketingImageChange(event.target.files?.[0], setProductImageName, setProductImageDataUrl)}
                    />
                  </label>
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>模特图</strong>
                    <span>{modelImageName || "上传模特图片"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void handleMarketingImageChange(event.target.files?.[0], setModelImageName, setModelImageDataUrl)}
                    />
                  </label>
                </div>

                <div className="marketing-poster-options">
                  <div className="marketing-section-head compact">
                    <div>
                      <strong>图片风格</strong>
                    </div>
                  </div>
                  <div className="marketing-style-grid" aria-label="图片风格">
                    {posterStyles.map((item) => (
                      <button type="button" key={item.title} className={posterStyle === item.title ? "active" : ""} onClick={() => setPosterStyle(item.title)}>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                      </button>
                    ))}
                  </div>
                  <label className="marketing-size-select">
                    <span>尺寸大小</span>
                    <select value={posterSize} onChange={(event) => setPosterSize(event.target.value)}>
                      {posterSizes.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="marketing-custom-field">
                    <span>我想自己写要求</span>
                    <textarea
                      value={customRequirement}
                      onChange={(event) => setCustomRequirement(event.target.value)}
                      rows={3}
                      placeholder="例如：背景干净、高级，突出产品或模特，不要太多文字。"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <>
                <label className="marketing-custom-field">
                  <span>我想自己写要求</span>
                  <textarea
                    value={customRequirement}
                    onChange={(event) => setCustomRequirement(event.target.value)}
                    rows={3}
                    placeholder="例如：重点推三伏药浴，语气温和，不要太像广告。"
                  />
                </label>

              </>
            )}
            <div className="marketing-form-actions single">
              <button type="button" className="primary-button" disabled={!contentState.enabled || generationBusy} onClick={generate}>
                <Sparkles size={16} /> {generationBusy ? "生成中..." : `生成${selectedGenerationMode.title}`}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="workbench-panel marketing-record-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="生成记录" action={`${selectedGenerationMode.title} · ${typedMarketingAiRecords.length} 条`} />
          <div className="marketing-record-list">
            {typedMarketingAiRecords.slice(0, 12).map((record) => {
              const recordPending = isMarketingAiRecordPending(record);
              return (
                <article
                  key={record.id}
                  className="marketing-record-item"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    setSelectedRecordId(record.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    if ((event.target as HTMLElement).closest("button")) return;
                    event.preventDefault();
                    setSelectedRecordId(record.id);
                  }}
                >
                  <div className="marketing-record-main">
                    <span className="marketing-record-type">{marketingRecordKindLabel(record.kind)}</span>
                    <strong>{marketingRecordTitle(record)}</strong>
                    <span className="marketing-record-summary">{recordPending ? "后台生成中，完成后自动更新" : record.marketingNode || marketingRecordSummary(record)}</span>
                    <small>{marketingRecordMeta(record)}</small>
                  </div>
                  <div className="marketing-record-cost">
                    <span>{recordPending ? "费用状态" : "本次费用"}</span>
                    <b>{recordPending ? "完成后显示" : formatAiCostRmb(record.cost)}</b>
                  </div>
                  <div className="marketing-record-actions">
                    <button type="button" aria-label="查看记录" onClick={() => setSelectedRecordId(record.id)}><Eye size={15} /></button>
                    <button type="button" aria-label="复制文案" disabled={recordPending} onClick={() => void copyRecord(record)}><Copy size={15} /></button>
                    <button type="button" aria-label={record.kind === "copy" ? "下载文案" : "下载图片"} disabled={recordPending} onClick={() => downloadMarketingRecord(record)}><Download size={15} /></button>
                  </div>
                </article>
              );
            })}
            {typedMarketingAiRecords.length === 0 && <p className="empty">暂无{selectedGenerationMode.title}生成记录</p>}
          </div>
        </section>
      )}

      {showGenerationDialog && (
        <div className="marketing-result-overlay" role="presentation">
          <section className="marketing-result-dialog marketing-content-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-result-title">
            <div className="marketing-result-dialog-head">
              <div>
                <span>{dialogPending ? "已提交后台任务" : "生成结果"}</span>
                <h2 id="marketing-result-title">{dialogKindTitle}</h2>
              </div>
              <button
                type="button"
                aria-label="关闭生成结果"
                disabled={generationBusy}
                onClick={() => {
                  setGenerationError("");
                  setGenerationResult(null);
                  setSelectedRecordId("");
                  setCopyResultStatus("idle");
                  setDownloadResultStatus("idle");
                  setManualCopyText("");
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="marketing-preview-summary" aria-label="当前生成条件">
              {dialogSummaryItems.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className="marketing-result-body">
              <div className="marketing-result-panel">
                {generationBusy && <p className="marketing-result-status">AI 正在生成{selectedGenerationMode.title}，请稍候。</p>}
                {generationError && <p className="marketing-result-error">{generationError}</p>}
                {dialogPending && (
                  <div className="marketing-background-status">
                    <Sparkles size={30} />
                    <strong>后台正在生成，完成后会自动更新</strong>
                    <p>你可以关闭这个窗口、切换页面或继续操作系统。生成完成后，请到“生成记录”查看海报和文案。</p>
                    <div className="marketing-result-actions">
                      <button type="button" className="secondary-button" onClick={returnToRecords}>
                        <Eye size={16} /> 查看生成记录
                      </button>
                    </div>
                  </div>
                )}
                {!dialogPending && (dialogText || dialogImageDataUrl || dialogVideoUrl || dialogVideoTaskId) && (
                  <div className={`marketing-content-result-grid ${dialogKind === "copy" ? "copy-only" : ""}`}>
                    {dialogKind !== "copy" && <article className="marketing-poster-card">
                      <div className="marketing-result-head">
                        <div>
                          <strong>{dialogKind === "video" ? "视频结果" : dialogKind === "talk" ? "口播内容" : "海报预览"}</strong>
                          <span>{dialogKind === "image" ? "由图片模型生成" : dialogKind === "video" ? "视频任务状态" : "适合视频号/直播口播"}</span>
                        </div>
                      </div>
                      {dialogVideoUrl ? (
                        <video className="marketing-result-video" src={dialogVideoUrl} controls playsInline />
                      ) : dialogKind === "video" ? (
                        <div className="marketing-video-result-card">
                          <Megaphone size={28} />
                          <strong>{dialogVideoStatus || "视频任务已创建"}</strong>
                          {dialogVideoTaskId && <span>任务 ID：{dialogVideoTaskId}</span>}
                        </div>
                      ) : dialogKind === "talk" ? (
                        <div className="marketing-video-result-card">
                          <Megaphone size={28} />
                          <strong>口播脚本已生成</strong>
                          <span>右侧可复制内容</span>
                        </div>
                      ) : dialogImageDataUrl ? (
                        <img className="marketing-result-image" src={dialogImageDataUrl} alt="AI 营销海报" />
                      ) : (
                        <div className="marketing-poster-placeholder">
                          <ImageIcon size={26} />
                          <span>{dialogErrorMessage ? "海报未生成" : "暂无海报"}</span>
                        </div>
                      )}
                    </article>}
                    <article className="marketing-result-copy">
                      <div className="marketing-result-head">
                        <div>
                          <strong>{dialogText ? "配套文案" : "生成信息"}</strong>
                          <span>{showAiTechnicalDetails && dialogProvider && dialogModel ? `${AI_PROVIDER_LABELS[dialogProvider as keyof typeof AI_PROVIDER_LABELS] ?? dialogProvider} · ${dialogModel}` : "本次生成"}</span>
                        </div>
                        <div className="marketing-cost-pill">
                          <b>{formatAiCostRmb(dialogCost)}</b>
                          {showAiTechnicalDetails && <small>{formatAiCostUsd(dialogCost)} · {formatAiUsageCostDetail(dialogCost)}</small>}
                        </div>
                      </div>
                      {dialogText && (
                        <div className="marketing-copy-sections">
                          {marketingCopySections(dialogText).map((section) => (
                            <article key={section.title}>
                              <span>{section.title}</span>
                              <p>{section.body}</p>
                            </article>
                          ))}
                        </div>
                      )}
                      {!dialogText && dialogKind === "image" && (
                        <p className="marketing-result-note">这张海报由图片模型生成，可直接下载用于发布。</p>
                      )}
                      {dialogKind !== "copy" && dialogText && dialogErrorMessage && (
                        <p className="marketing-result-note">{dialogErrorMessage}</p>
                      )}
                      {!dialogText && dialogKind === "video" && (
                        <p className="marketing-result-note">{dialogVideoUrl ? "视频已返回，可在线播放或下载。" : "视频任务已提交，稍后可在生成记录里查看状态。"}</p>
                      )}
                      <div className="marketing-result-actions">
                        <button type="button" className="secondary-button" onClick={() => void copyGenerationText()}>
                          <Copy size={16} /> {copyResultStatus === "copied" ? "已复制" : copyResultStatus === "failed" ? "已显示内容" : "复制内容"}
                        </button>
                        <button type="button" className="secondary-button" onClick={downloadPoster}>
                          <Download size={16} /> {downloadResultStatus === "downloaded" ? "已下载" : downloadResultStatus === "failed" ? "下载失败" : dialogKind !== "copy" && dialogImageDataUrl ? "下载图片" : "下载文案"}
                        </button>
                        <button type="button" className="secondary-button" onClick={returnToRecords}>
                          <Eye size={16} /> 返回记录
                        </button>
                      </div>
                      {manualCopyText && (
                        <label className="marketing-manual-copy">
                          <span>复制未被浏览器允许，请在这里手动复制</span>
                          <textarea readOnly value={manualCopyText} onFocus={(event) => event.currentTarget.select()} />
                        </label>
                      )}
                    </article>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
