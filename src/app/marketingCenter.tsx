import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CakeSlice, CalendarCheck, Copy, Download, Eye, Gift, Globe2, Image as ImageIcon, LayoutGrid, Megaphone, MessageCircle, Mic2, PencilLine, PlaySquare, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import type { UserSession } from "../domain/auth";
import { AI_CREDIT_CNY_PER_USD, aiFreeQuotaState } from "../domain/aiBilling";
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
type BirthdayMarketingTask = {
  id: string;
  name: string;
  timingLabel: string;
  daysUntil: number;
  tag: string;
  tagTone: "purple" | "blue" | "gray";
  birthdayLabel: string;
};
type MarketingCalendarNode = {
  title: string;
  date: string;
  category: "传统节日" | "节气内容" | "养生节点" | "项目周期";
  description: string;
  leadDays: number;
  priority: number;
  serviceHint: string;
};

const marketingComplianceReplacements: Array<[RegExp, string]> = [
  [/比医院还有效|替代药物/g, "作为日常护理参考"],
  [/绝对有效/g, "很多客户反馈有感"],
  [/100%见效|百分百见效/g, "做完后更容易感受到"],
  [/100%|百分百/g, "更安心"],
  [/一次见效|立刻见效|马上见效/g, "体验后更有感"],
  [/见效/g, "有感"],
  [/调理疾病|改善疾病/g, "调整状态"],
  [/根治|治愈/g, "改善"],
  [/治疗/g, "调理"],
  [/彻底|永久/g, "持续"],
  [/包治|包好/g, "多数客户反馈不错"],
  [/保证|必定/g, "建议体验"],
  [/无效退款/g, "体验前可先了解"],
  [/中医/g, "东方美学"],
  [/消炎|杀菌/g, "舒缓清洁"],
  [/诊断|处方/g, "评估建议"],
  [/药物|医疗|疾病/g, "日常护理"],
  [/疗效|效果/g, "感受"],
  [/绝对/g, "更"],
  [/三伏灸|三九灸|药灸|泥灸|艾灸|灸/g, "艾草温护"],
  [/药浴/g, "草本浴"],
  [/祛湿|排湿|湿气|湿重|寒湿/g, "清爽轻养"],
  [/舒肝/g, "放松舒缓"],
  [/温补|养阳/g, "温暖护理"],
  [/虚胖/g, "轻盈管理"],
  [/失眠/g, "睡眠状态"],
  [/疼痛/g, "不适"],
  [/炎症/g, "肌肤不适"],
  [/身体状态|痛点/g, "护理需求"],
  [/治/g, "调"],
];

function marketingCompliantText(value: string) {
  return marketingComplianceReplacements
    .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
    .replace(/[ \t]+/g, " ")
    .trim();
}

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
const generationModes: Array<{ kind: MarketingGenerationKind; title: string; icon: typeof Sparkles; locked?: boolean; status?: string }> = [
  { kind: "copy", title: "获客文案", icon: PencilLine },
  { kind: "image", title: "产品海报", icon: ImageIcon },
  { kind: "video", title: "产品视频", icon: PlaySquare, locked: true, status: "调试中" },
  { kind: "talk", title: "口播脚本", icon: Mic2, locked: true, status: "调试中" },
];
const posterStyles = ["东方美学风", "节气设计图", "轻奢护理风", "小红书种草"];
const birthdayChannels = [
  { name: "微信私聊", sourceChannel: "私聊", icon: MessageCircle },
  { name: "朋友圈", sourceChannel: "朋友圈", icon: Globe2 },
  { name: "小红书", sourceChannel: "小红书", icon: BookOpen },
] as const;
const posterSizes = ["朋友圈 1:1", "小红书 3:4", "竖版 9:16", "横版 16:9"];
const videoRatios = ["9:16", "1:1", "16:9"];
const videoDurations = [5, 10, 15];
const MAX_MARKETING_ASSET_BYTES = 8 * 1024 * 1024;
const USD_TO_CNY_DISPLAY_RATE = AI_CREDIT_CNY_PER_USD;
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

function parseBirthdayParts(value?: string) {
  if (!value) return undefined;
  const match = value.trim().match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { month, day };
}

function birthdayDaysUntil(value: string | undefined, today = new Date()) {
  const parts = parseBirthdayParts(value);
  if (!parts) return undefined;
  const todayDate = localDateOnly(today);
  let target = new Date(todayDate.getFullYear(), parts.month - 1, parts.day);
  if (target.getTime() < todayDate.getTime()) target = new Date(todayDate.getFullYear() + 1, parts.month - 1, parts.day);
  const daysUntil = Math.round((target.getTime() - todayDate.getTime()) / MS_PER_DAY);
  if (!Number.isFinite(daysUntil)) return undefined;
  return {
    daysUntil,
    birthdayLabel: `${parts.month}月${parts.day}日`,
  };
}

function birthdayTimingText(daysUntil: number) {
  if (daysUntil === 0) return "今天生日";
  if (daysUntil === 1) return "明天生日";
  return `还有 ${daysUntil} 天`;
}

function customerBirthdayTag(data: AppData, customerId: string): Pick<BirthdayMarketingTask, "tag" | "tagTone"> {
  const cards = data.memberCards.filter((card) => card.customerId === customerId);
  if (cards.some((card) => card.type === "储值卡" && card.balance > 0)) return { tag: "储值客户", tagTone: "purple" };
  if (cards.some((card) => (card.type === "次数卡" || card.type === "套餐卡") && (card.remainingTimes > 0 || card.serviceEntitlements?.some((item) => item.remainingTimes > 0)))) {
    return { tag: "有次卡", tagTone: "blue" };
  }
  return { tag: "会员", tagTone: "gray" };
}

function getBirthdayMarketingTasks(data: AppData, today = new Date()): BirthdayMarketingTask[] {
  return data.customers
    .map((customer) => {
      const birthday = birthdayDaysUntil(customer.birthday, today);
      if (!birthday || birthday.daysUntil > 7) return undefined;
      return {
        id: customer.id,
        name: marketingCompliantText(customer.name),
        timingLabel: birthdayTimingText(birthday.daysUntil),
        daysUntil: birthday.daysUntil,
        birthdayLabel: birthday.birthdayLabel,
        ...customerBirthdayTag(data, customer.id),
      };
    })
    .filter((item): item is BirthdayMarketingTask => Boolean(item))
    .sort((left, right) => left.daysUntil - right.daysUntil || left.name.localeCompare(right.name, "zh-Hans-CN"))
    .slice(0, 6);
}

function birthdayBlessingPreview(task?: BirthdayMarketingTask) {
  if (!task) return "暂无生日客户。";
  return marketingCompliantText(`${task.name}，生日快乐，今天为你准备了一份专属护理礼遇，愿你每天都美丽加倍，幸福加倍～`);
}

function marketingNodeTone(title: string) {
  if (title.includes("夏至") || title.includes("大暑") || title.includes("小暑")) return "amber";
  if (title.includes("三伏") || title.includes("端午") || title.includes("重阳")) return "rose";
  if (title.includes("冬") || title.includes("寒") || title.includes("雪")) return "violet";
  return "teal";
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

  return (result.length >= 3 ? result : [...result, ...fallbackNodes, ...projectFallback].slice(0, 3)).map((node) => ({
    ...node,
    title: marketingCompliantText(node.title),
    badge: marketingCompliantText(node.badge),
    description: marketingCompliantText(node.description),
    hint: node.hint ? marketingCompliantText(node.hint) : node.hint,
  }));
}

function aiCostAmountUsd(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return undefined;
  if (typeof cost === "number") return Number.isFinite(cost) ? cost : undefined;
  return Number.isFinite(cost.amountUsd) ? cost.amountUsd : undefined;
}

function formatAiCreditAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(value > 0 && value < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

function formatAiCreditCharge(record?: Pick<MarketingAiRecord, "billing">) {
  const amount = record?.billing?.source === "credit" ? record.billing.creditsCharged ?? 0 : 0;
  return amount > 0 ? `扣积分 ${formatAiCreditAmount(amount)}` : "";
}

function formatAiCostCredits(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return "生成完成后显示";
  const amountUsd = aiCostAmountUsd(cost);
  if (amountUsd === undefined) return "暂无费用记录";
  if (typeof cost !== "number" && cost.priceConfigured === false) return "费用未配置";
  const amount = amountUsd * USD_TO_CNY_DISPLAY_RATE;
  return `本次积分 ${formatAiCreditAmount(amount)}`;
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
  if (record.text) return marketingCompliantText(record.text);
  if (record.videoUrl) return record.videoUrl;
  return [
    marketingRecordTitle(record),
    marketingRecordSummary(record),
    marketingRecordMeta(record),
    `积分：${formatAiCostCredits(record.cost)}`,
  ].map(compactRecordText).filter(Boolean).join("\n");
}

function marketingRecordKindLabel(kind: MarketingAiRecord["kind"]) {
  return kind === "image" ? "产品设计图" : kind === "video" ? "产品视频" : kind === "talk" ? "口播" : "文案";
}

function compactRecordText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function marketingRecordPreviewText(record: MarketingAiRecord) {
  return marketingCompliantText(compactRecordText(record.text || record.videoUrl));
}

function marketingRecordTitle(record: MarketingAiRecord) {
  const title = compactRecordText(record.title);
  if (title) return title;
  const contentTitle = marketingRecordPreviewText(record).slice(0, 22);
  if (contentTitle) return contentTitle;
  return `AI${marketingRecordKindLabel(record.kind)}记录`;
}

function marketingRecordSummary(record: MarketingAiRecord) {
  if (record.status === "生成失败") return marketingCompliantText(compactRecordText(record.errorMessage || record.text || "生成失败")).slice(0, 48);
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
  ].map((item) => marketingCompliantText(compactRecordText(item))).filter(Boolean).join(" · ") || "已生成，可点击查看详情";
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

function isInlinePngDataUrl(value?: string) {
  return Boolean(value?.startsWith("data:image/png;base64,"));
}

function isStoredPngAssetUrl(value?: string) {
  return Boolean(value?.startsWith("/api/assets/") && value.toLowerCase().includes(".png"));
}

function isPreviewablePngSource(value?: string) {
  return isInlinePngDataUrl(value) || isStoredPngAssetUrl(value);
}

function downloadMarketingRecord(record: MarketingAiRecord) {
  const filename = `${marketingRecordTitle(record)}-${(record.createdAt || new Date().toISOString()).slice(0, 10)}`;
  const pngSource = isPreviewablePngSource(record.imageDataUrl) ? record.imageDataUrl : "";
  if (pngSource) {
    downloadDataUrl(pngSource, `${filename}.png`);
    return;
  }
  const link = document.createElement("a");
  if (record.videoUrl) {
    link.href = record.videoUrl;
    link.download = `${filename}.mp4`;
    link.target = "_blank";
  } else {
    const blob = new Blob([record.text ? marketingCompliantText(record.text) : ""], { type: "text/plain;charset=utf-8" });
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
  const [selectedBirthdayTaskId, setSelectedBirthdayTaskId] = useState("");
  const [posterStyle, setPosterStyle] = useState("东方美学风");
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
  const [generationDialogDismissed, setGenerationDialogDismissed] = useState(false);
  const [copyResultStatus, setCopyResultStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [downloadResultStatus, setDownloadResultStatus] = useState<"idle" | "downloaded" | "failed">("idle");
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [manualCopyText, setManualCopyText] = useState("");
  const generationInFlightRef = useRef(false);
  const product = data.products[0];
  const service = data.services[0];
  const storeName = primaryStoreName(data) || "门店";
  const birthdayTasks = useMemo(() => getBirthdayMarketingTasks(data), [data]);
  const selectedBirthdayTask = birthdayTasks.find((item) => item.id === selectedBirthdayTaskId) ?? birthdayTasks[0];
  const todayBirthdayCount = birthdayTasks.filter((item) => item.daysUntil === 0).length;
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const aiPermissions = storeAiUsagePermissions(data);
  const selectedCapability = generationKind === "image" ? "image" : generationKind === "video" ? "video" : "copy";
  const contentState = aiCapabilityUsageState(aiConfig, aiPermissions, session.user.role, selectedCapability);
  const selectedGenerationMode = generationModes.find((item) => item.kind === generationKind) ?? generationModes[0];
  const selectedModeLocked = Boolean(selectedGenerationMode.locked);
  const isPosterMode = generationKind === "image";
  const quotaState = aiFreeQuotaState(data, session.user.id);
  const selectedNode = todayMarketingNodes.find((item) => item.title === marketingNode) ?? todayMarketingNodes[0];
  const selectedNodeTone = marketingNodeTone(selectedNode.title);
  const selectedNodeDateParts = (selectedNode.dateLabel ?? "").split(" · ");
  const selectedNodeDate = selectedNodeDateParts[0] ?? "";
  const selectedNodeTime = selectedNodeDateParts[selectedNodeDateParts.length - 1] ?? "";
  const birthdayMarketingNode = selectedBirthdayTask ? "生日提醒" : marketingNode;
  const birthdayMarketingGoal = selectedBirthdayTask ? "生日祝福" : marketingGoal;
  const effectiveCustomerType = selectedBirthdayTask?.tag ?? customerType;
  const safeMarketingNode = marketingCompliantText(birthdayMarketingNode);
  const safeBodyState = marketingCompliantText(bodyState);
  const safeMarketingGoal = marketingCompliantText(birthdayMarketingGoal);
  const safePosterStyle = marketingCompliantText(posterStyle);
  const safeCustomRequirement = marketingCompliantText(customRequirement.trim());
  const audienceSummary = `${effectiveCustomerType}，${safeBodyState}`;
  const nodeBrief = [selectedNode.title, selectedNode.dateLabel, selectedNode.hint].filter(Boolean).join(" · ");
  const birthdayBrief = selectedBirthdayTask
    ? `生日客户：${selectedBirthdayTask.name}，${selectedBirthdayTask.timingLabel}，客户标签：${selectedBirthdayTask.tag}，生日：${selectedBirthdayTask.birthdayLabel}`
    : "";
  const generationRequirement = [
    birthdayBrief,
    nodeBrief ? `当前营销时间节点：${nodeBrief}` : "",
    selectedNode.description ? `节点策略：${selectedNode.description}` : "",
    safeCustomRequirement,
  ].filter(Boolean).map(marketingCompliantText).join("\n");
  const previewSummaryItems = [safeMarketingNode, channel, safeMarketingGoal];
  const copyPreviewText = selectedBirthdayTask
    ? [
      `${channel} · ${selectedBirthdayTask.name} · ${safeMarketingGoal}`,
      birthdayBlessingPreview(selectedBirthdayTask),
      safeCustomRequirement ? `补充要求：${safeCustomRequirement}` : "",
    ].filter(Boolean).map(marketingCompliantText).join("\n")
    : [
      `${channel} · ${safeMarketingNode}`,
      selectedNode.description,
      selectedNode.hint ? `适合项目：${selectedNode.hint}` : "",
      `目标：${safeMarketingGoal}`,
      safeCustomRequirement ? `补充要求：${safeCustomRequirement}` : "",
    ].filter(Boolean).map(marketingCompliantText).join("\n");
  const marketingAiRecords = [...(data.marketingAiRecords ?? [])].map(staleMarketingAiRecord).sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
  const typedMarketingAiRecords = marketingAiRecords.filter((record) => record.kind === generationKind);
  const latestGenerationResultRecord = generationResult?.record?.id ? marketingAiRecords.find((record) => record.id === generationResult.record?.id) : undefined;
  const generationResultRecord = generationResult?.record ? staleMarketingAiRecord(latestGenerationResultRecord ?? generationResult.record) : undefined;
  const hasPendingMarketingAiRecords = marketingAiRecords.some((record) => isMarketingAiRecordPending(record) && !isStaleMarketingAiRecord(record));
  const hasPendingGenerationResult = Boolean(generationResultRecord && isMarketingAiRecordPending(generationResultRecord) && !isStaleMarketingAiRecord(generationResultRecord));
  const selectedMarketingRecord = marketingAiRecords.find((record) => record.id === selectedRecordId);
  const dialogRecord = selectedMarketingRecord ?? generationResultRecord;
  const rawDialogText = dialogRecord?.text ?? generationResult?.text;
  const dialogText = rawDialogText ? marketingCompliantText(rawDialogText) : rawDialogText;
  const dialogImageDataUrl = dialogRecord?.imageDataUrl ?? generationResult?.imageDataUrl;
  const dialogPngSource = isPreviewablePngSource(dialogImageDataUrl) ? dialogImageDataUrl : "";
  const dialogHasInvalidImageSource = Boolean(dialogImageDataUrl && !dialogPngSource);
  const dialogVideoUrl = dialogRecord?.videoUrl ?? generationResult?.videoUrl;
  const dialogVideoTaskId = dialogRecord?.taskId ?? generationResult?.taskId;
  const dialogVideoStatus = dialogRecord?.status ?? generationResult?.status;
  const dialogErrorMessage = dialogRecord?.errorMessage ?? generationResult?.errorMessage;
  const dialogPending = dialogVideoStatus === "生成中";
  const dialogKind = dialogRecord?.kind ?? generationResult?.kind ?? generationKind;
  const dialogKindTitle = dialogKind === "image" ? "AI产品设计图" : dialogKind === "video" ? "AI产品视频" : dialogKind === "talk" ? "AI口播" : "AI获客图文案";
  const dialogCost = dialogRecord?.cost ?? generationResult?.cost;
  const dialogProvider = dialogRecord?.provider ?? generationResult?.provider;
  const dialogModel = dialogRecord?.model ?? generationResult?.model;
  const dialogSummaryItems = dialogRecord
    ? [dialogRecord.marketingNode, dialogRecord.channel, dialogRecord.marketingGoal].map((item) => item ? marketingCompliantText(item) : item).filter(Boolean)
    : previewSummaryItems;
  const showGenerationDialog = Boolean(generationBusy || generationError || selectedMarketingRecord || (!generationDialogDismissed && generationResult));
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
    if (birthdayTasks.length === 0) {
      if (selectedBirthdayTaskId) setSelectedBirthdayTaskId("");
      return;
    }
    if (!birthdayTasks.some((item) => item.id === selectedBirthdayTaskId)) {
      setSelectedBirthdayTaskId(birthdayTasks[0].id);
    }
  }, [birthdayTasks, selectedBirthdayTaskId]);

  useEffect(() => {
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setImagePreviewFailed(false);
    setManualCopyText("");
    setGenerationDialogDismissed(false);
  }, [activeView, generationKind]);

  useEffect(() => {
    setImagePreviewFailed(false);
  }, [dialogImageDataUrl]);

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
    if (generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    if (!contentState.enabled) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError(unavailableMessage());
      generationInFlightRef.current = false;
      return;
    }
    if (selectedModeLocked) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setGenerationError("产品视频和口播正在调试中，请先使用获客图文案或产品设计图");
      generationInFlightRef.current = false;
      return;
    }
    if (generationKind === "image" && !productImageDataUrl && !modelImageDataUrl) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError("请先上传产品图或模特图，再生成产品设计图");
      generationInFlightRef.current = false;
      return;
    }
    setGenerationBusy(true);
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setGenerationDialogDismissed(false);
    setDownloadResultStatus("idle");
    setManualCopyText("");
    try {
      const result = await actions.generateMarketingAi({
        kind: generationKind,
        storeName: marketingCompliantText(storeName),
        productName: product?.name ? marketingCompliantText(product.name) : undefined,
        serviceName: service?.name ? marketingCompliantText(service.name) : undefined,
        audience: audienceSummary,
        channel,
        marketingNode: safeMarketingNode,
        customerType,
        lifecycleNode: safeMarketingNode,
        bodyState: safeBodyState,
        marketingGoal: safeMarketingGoal,
        posterStyle: safePosterStyle,
        posterSize,
        posterTitle: safeMarketingNode,
        posterOffer: safeMarketingGoal,
        productImageName,
        productImageDataUrl,
        modelImageName,
        modelImageDataUrl,
        sceneImageName,
        sceneImageDataUrl,
        customRequirement: generationRequirement,
        videoRatio,
        videoDuration,
        videoScript: marketingCompliantText(videoScript),
        talkScene: `${safeMarketingNode} · ${safeMarketingGoal} · ${channel}`,
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
      generationInFlightRef.current = false;
      setGenerationBusy(false);
    }
  };

  const dialogCopyText = () => {
    if (dialogText) return dialogText;
    if (dialogVideoUrl) return dialogVideoUrl;
    if (dialogVideoTaskId) return `视频任务：${dialogVideoTaskId}${dialogVideoStatus ? `\n状态：${dialogVideoStatus}` : ""}`;
    if (dialogRecord) return marketingRecordContent(dialogRecord);
    return [
      "AI获客图文案",
      dialogSummaryItems.join(" · "),
      `积分：${formatAiCostCredits(dialogCost)}`,
    ].map(compactRecordText).filter(Boolean).join("\n");
  };

  const copyGenerationText = async () => {
    const text = dialogCopyText();
    const copied = await copyTextToClipboard(text);
    setManualCopyText(copied ? "" : text);
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const copyCurrentPreview = async () => {
    const copied = await copyTextToClipboard(copyPreviewText);
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const copyBirthdayBatchPreview = async () => {
    const text = birthdayTasks.length > 0
      ? birthdayTasks.slice(0, 6).map((task) => `${task.name}｜${task.timingLabel}\n${birthdayBlessingPreview(task)}`).join("\n\n")
      : birthdayBlessingPreview();
    const copied = await copyTextToClipboard(text);
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const copyRecord = async (record: MarketingAiRecord) => {
    const copied = await copyTextToClipboard(marketingRecordContent(record));
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const downloadPoster = () => {
    const title = dialogRecord ? marketingRecordTitle(dialogRecord) : `AI获客图文案-${new Date().toISOString().slice(0, 10)}`;
    if (dialogPngSource) {
      downloadDataUrl(dialogPngSource, `${title}.png`);
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
    setGenerationDialogDismissed(false);
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
    setActiveView("records");
  };

  const closeGenerationDialog = () => {
    if (generationBusy) return;
    setGenerationError("");
    setSelectedRecordId("");
    setGenerationDialogDismissed(Boolean(generationResult));
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
  };

  return (
    <div className={`page-stack marketing-center-page ${!isPosterMode ? "marketing-copy-layout" : ""}`}>
      <PageHero
        icon={<Megaphone size={18} />}
        eyebrow="AI智能营销"
        title="营销中心"
      />

      <section className="workbench-panel marketing-type-panel" aria-label="生成类型">
        <div className="marketing-section-head marketing-type-heading">
          <div>
            <span className="marketing-heading-icon" aria-hidden="true"><LayoutGrid size={18} strokeWidth={2.6} /></span>
            <strong>生成类型</strong>
          </div>
        </div>
        <div className="marketing-output-mode-grid" aria-label="生成内容类型">
          {generationModes.map((item) => {
            const ModeIcon = item.icon;
            const isActive = generationKind === item.kind;
            return (
              <button
                type="button"
                key={item.kind}
                className={`${isActive ? "active" : ""} ${item.locked ? "locked" : ""}`.trim()}
                aria-pressed={isActive}
                disabled={item.locked}
                onClick={() => {
                  setGenerationKind(item.kind);
                }}
              >
                <span className="marketing-mode-icon" aria-hidden="true">
                  <ModeIcon size={19} strokeWidth={2.35} />
                </span>
                <strong>{item.title}</strong>
                {isActive && <span className="marketing-mode-check" aria-hidden="true">✓</span>}
                {item.status && <em className="marketing-mode-status">{item.status}</em>}
              </button>
            );
          })}
        </div>
      </section>

      {activeView === "content" ? (
        <section className="marketing-workspace">
          <div className={`workbench-panel marketing-form-panel ${!isPosterMode ? "marketing-copy-workbench" : ""}`}>
            {isPosterMode && (
              <PanelTitle
                icon={<ImageIcon size={18} />}
                title="AI产品海报"
                action={quotaState.credits > 0 ? `账号积分 ${formatAiCreditAmount(quotaState.credits)}` : contentState.label}
              />
            )}
            {isPosterMode && quotaState.credits <= 0 && (
              <div className={`marketing-quota-note ${quotaState.enforced && quotaState.remaining === 0 ? "empty" : ""}`}>
                {quotaState.enforced
                  ? `当前账号未充值，今日免费剩余 ${quotaState.remaining}/${quotaState.limit} 次。`
                  : `${quotaState.startsAt} 起，未充值账号每天可免费生成 ${quotaState.limit} 次。`}
              </div>
            )}
            {!isPosterMode && (
              <div className="marketing-copy-stage marketing-birthday-workflow">
                <section className="marketing-birthday-panel" aria-label="今日营销任务">
                  <header className="marketing-task-head">
                    <div>
                      <CalendarCheck size={19} strokeWidth={2.35} aria-hidden="true" />
                      <strong>今日营销任务</strong>
                    </div>
                    <button type="button" onClick={() => setActiveView("records")}>查看全部</button>
                  </header>
                  <div className="marketing-birthday-card">
                    <div className="marketing-birthday-title">
                      <span><CakeSlice size={17} strokeWidth={2.45} /> 生日提醒 · {todayBirthdayCount > 0 ? `今日 ${todayBirthdayCount} 位` : "未来 7 天"}</span>
                    </div>
                    <div className="marketing-birthday-list">
                      {birthdayTasks.length > 0 ? birthdayTasks.slice(0, 3).map((task) => (
                        <button
                          type="button"
                          key={task.id}
                          className={`marketing-birthday-row ${selectedBirthdayTask?.id === task.id ? "active" : ""}`}
                          onClick={() => {
                            setSelectedBirthdayTaskId(task.id);
                            setChannel("私聊");
                            setMarketingGoal("生日祝福");
                          }}
                        >
                          <span className="marketing-birthday-avatar" aria-hidden="true">{task.name.slice(0, 1) || "客"}</span>
                          <span className="marketing-birthday-main">
                            <strong>{task.name}</strong>
                            <small>{task.timingLabel}</small>
                          </span>
                          <em data-tone={task.tagTone}>{task.tag}</em>
                          <span className="marketing-birthday-action"><Sparkles size={15} /> 生成祝福</span>
                        </button>
                      )) : (
                        <div className="marketing-birthday-empty">
                          <span className="marketing-birthday-avatar" aria-hidden="true">客</span>
                          <p>暂无生日客户</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <article className="marketing-copy-preview-card marketing-birthday-preview-card">
                  <header>
                    <span><MessageCircle size={17} /> 推荐文案预览 · {selectedGenerationMode.title}</span>
                  </header>
                  <div className="marketing-birthday-preview-body">
                    <div className="marketing-channel-pill-row" aria-label="渠道">
                      {birthdayChannels.map((item) => {
                        const ChannelIcon = item.icon;
                        const isActive = channel === item.sourceChannel;
                        return (
                          <button
                            type="button"
                            key={item.name}
                            className={isActive ? "active" : ""}
                            onClick={() => setChannel(item.sourceChannel)}
                          >
                            <ChannelIcon size={16} strokeWidth={2.35} />
                            <strong>{item.name}</strong>
                            {isActive && <span aria-hidden="true">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    <p>{birthdayBlessingPreview(selectedBirthdayTask)}</p>
                    <footer>
                      <span className="marketing-compliance-note"><ShieldCheck size={15} /> 已规避敏感词</span>
                      <button type="button" onClick={() => void copyCurrentPreview()}>换一条</button>
                    </footer>
                  </div>
                </article>

                <details className="marketing-custom-disclosure">
                  <summary><Plus size={16} /> 补充优惠/护理项目</summary>
                  <label className="marketing-custom-field">
                    <span>我想自己写要求</span>
                    <textarea
                      value={customRequirement}
                      onChange={(event) => setCustomRequirement(event.target.value)}
                      rows={3}
                    />
                  </label>
                </details>
              </div>
            )}

            {isPosterMode ? (
              <div className="marketing-context-block marketing-primary-block">
                <div className="marketing-section-head">
                  <div>
                    <strong>上传图片</strong>
                  </div>
                </div>
                <div className="marketing-upload-grid marketing-material-grid compact">
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>产品图</strong>
                    {productImageName && <span>{productImageName}</span>}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void handleMarketingImageChange(event.target.files?.[0], setProductImageName, setProductImageDataUrl)}
                    />
                  </label>
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>模特图</strong>
                    {modelImageName && <span>{modelImageName}</span>}
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
                      <button type="button" key={item} className={posterStyle === item ? "active" : ""} onClick={() => setPosterStyle(item)}>
                        <strong>{item}</strong>
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
                    />
                  </label>
                </div>
              </div>
            ) : null}
            <div className={`marketing-form-actions ${!isPosterMode ? "marketing-copy-actions" : "single"}`}>
              {!isPosterMode && (
                <button type="button" className="secondary-button marketing-copy-action" onClick={() => void copyBirthdayBatchPreview()}>
                  <Gift size={16} /> {copyResultStatus === "copied" ? "已批量生成" : "批量生成"}
                </button>
              )}
              <button type="button" className="primary-button marketing-copy-action" disabled={!contentState.enabled || generationBusy} onClick={generate}>
                <Sparkles size={16} /> {generationBusy ? "生成中..." : selectedBirthdayTask && !isPosterMode ? "生成生日祝福" : `生成${selectedGenerationMode.title}`}
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
              const recordDownloadLabel = isPreviewablePngSource(record.imageDataUrl) ? "下载PNG" : record.kind === "video" ? "下载视频" : "下载文案";
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
                    <b>{recordPending ? "完成后显示" : formatAiCostCredits(record.cost)}</b>
                    {!recordPending && formatAiCreditCharge(record) && <small>{formatAiCreditCharge(record)}</small>}
                  </div>
                  <div className="marketing-record-actions">
                    <button type="button" aria-label="查看记录" onClick={() => setSelectedRecordId(record.id)}><Eye size={15} /></button>
                    <button type="button" aria-label="复制文案" disabled={recordPending} onClick={() => void copyRecord(record)}><Copy size={15} /></button>
                    <button type="button" aria-label={recordDownloadLabel} disabled={recordPending} onClick={() => downloadMarketingRecord(record)}><Download size={15} /></button>
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
                onClick={closeGenerationDialog}
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
                    <p>你可以关闭这个窗口、切换页面或继续操作系统。生成完成后，请到“生成记录”查看获客图文案和产品设计图。</p>
                    <div className="marketing-result-actions">
                      <button type="button" className="secondary-button" onClick={returnToRecords}>
                        <Eye size={16} /> 查看生成记录
                      </button>
                    </div>
                  </div>
                )}
                {!dialogPending && (dialogText || dialogImageDataUrl || dialogVideoUrl || dialogVideoTaskId) && (
                  <div className="marketing-content-result-grid">
                    <article className="marketing-poster-card">
                      <div className="marketing-result-head">
                        <div>
                          <strong>{dialogKind === "video" ? "产品视频结果" : dialogKind === "talk" ? "口播内容" : "产品设计图预览"}</strong>
                          <span>{dialogKind === "image" ? "由图片模型生成" : dialogKind === "video" ? "视频任务状态" : dialogKind === "talk" ? "适合视频号/直播口播" : "和文案同一条记录"}</span>
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
                      ) : dialogPngSource && !imagePreviewFailed ? (
                        <img className="marketing-result-image" src={dialogPngSource} alt="AI 产品设计图 PNG" onError={() => setImagePreviewFailed(true)} />
                      ) : dialogPngSource ? (
                        <div className="marketing-poster-placeholder">
                          <ImageIcon size={26} />
                          <span>PNG 已生成，预览暂时加载失败，可下载PNG保存</span>
                        </div>
                      ) : dialogHasInvalidImageSource ? (
                        <div className="marketing-poster-placeholder error">
                          <ImageIcon size={26} />
                          <span>图片接口未返回可保存的 PNG，请重新生成</span>
                        </div>
                      ) : (
                        <div className="marketing-poster-placeholder">
                          <ImageIcon size={26} />
                          <span>{dialogErrorMessage ? "产品设计图未生成" : "暂无产品设计图"}</span>
                        </div>
                      )}
                    </article>
                    <article className="marketing-result-copy">
                      <div className="marketing-result-head">
                        <div>
                          <strong>{dialogText ? "配套文案" : "生成信息"}</strong>
                          <span>{showAiTechnicalDetails && dialogProvider && dialogModel ? `${AI_PROVIDER_LABELS[dialogProvider as keyof typeof AI_PROVIDER_LABELS] ?? dialogProvider} · ${dialogModel}` : "本次生成"}</span>
                        </div>
                        <div className="marketing-cost-pill">
                          <b>{formatAiCostCredits(dialogCost)}</b>
                          {formatAiCreditCharge(dialogRecord) && <small>{formatAiCreditCharge(dialogRecord)}</small>}
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
                        <p className="marketing-result-note">这张产品设计图由图片模型生成，可直接下载用于发布。</p>
                      )}
                      {dialogText && dialogErrorMessage && (
                        <p className="marketing-result-note">{dialogErrorMessage}</p>
                      )}
                      {!dialogText && dialogKind === "video" && (
                        <p className="marketing-result-note">{dialogVideoUrl ? "产品视频已返回，可在线播放或下载。" : "产品视频任务已提交，稍后可在生成记录里查看状态。"}</p>
                      )}
                      <div className="marketing-result-actions">
                        <button type="button" className="secondary-button" onClick={() => void copyGenerationText()}>
                          <Copy size={16} /> {copyResultStatus === "copied" ? "已复制" : copyResultStatus === "failed" ? "已显示内容" : "复制内容"}
                        </button>
                        <button type="button" className="secondary-button" onClick={downloadPoster} disabled={dialogKind === "image" && !dialogPngSource && !dialogText && !dialogVideoUrl}>
                          <Download size={16} /> {downloadResultStatus === "downloaded" ? "已下载" : downloadResultStatus === "failed" ? "下载失败" : dialogPngSource ? "下载PNG" : "下载文案"}
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
