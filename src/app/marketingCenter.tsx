import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AudioLines, BookOpen, CakeSlice, CalendarCheck, Camera, Captions, CheckCircle2, Copy, Download, Eye, Flame, Gem, Gift, Hand, Image as ImageIcon, ImagePlus, ListFilter, Megaphone, MessageCircle, MessageSquarePlus, MicVocal, Package, PartyPopper, PenLine, Play, Plus, RotateCcw, Save, Scissors, ShieldCheck, Sparkles, Square, Store, UserRound, Video, X } from "lucide-react";
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
type MarketingCopyOutputMode = "text" | "image" | "poster";
type TalkFlowStep = "entry" | "script" | "shoot" | "result";
type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type TalkSilenceReport = {
  status: string;
  method: string;
  detectedSegments?: number;
  silentSeconds?: number;
  sampleWindowMs?: number;
  note?: string;
};
type TalkRecordedMetrics = {
  startedAt: number;
  lastVoiceAt: number;
  pauseStartedAt: number;
  pausedMs: number;
  trimSegments: number;
  trimMs: number;
  isTrimming: boolean;
};
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
type MarketingTaskCategory = "birthday" | "festival" | "wellness" | "repurchase";
type MarketingStyleTone = "oriental" | "season" | "luxury" | "social" | "medical" | "herbal" | "aroma" | "salon";
type VideoTemplateExample = {
  title: string;
  summary: string;
  description: string;
  cues: string[];
  previewSrc: string;
  previewVideoSrc?: string;
  previewAlt: string;
  icon: typeof Video;
};
type MarketingTaskItem =
  | { kind: "node"; category: Exclude<MarketingTaskCategory, "birthday">; id: string; title: string; subtitle: string; badge: string; tagTone: string; tone: string; node: MarketingNode }
  | { kind: "birthday"; category: "birthday"; id: string; title: string; subtitle: string; badge: string; tagTone: string; tone: string; birthdayTask: BirthdayMarketingTask };

const marketingTaskCategoryIcons: Record<MarketingTaskCategory, typeof CakeSlice> = {
  birthday: PartyPopper,
  festival: CalendarCheck,
  wellness: Sparkles,
  repurchase: Gift,
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
  { kind: "copy", title: "获客图文案", icon: MessageSquarePlus },
  { kind: "image", title: "产品海报", icon: ImagePlus },
  { kind: "video", title: "产品视频", icon: Video },
  { kind: "talk", title: "真人口播", icon: MicVocal },
];
const posterStyles = ["东方美学风", "节气设计图", "轻奢护理风", "小红书种草", "医美极简风", "国潮草本风", "香氛生活风", "高端沙龙风"];
const posterStyleTones: Record<string, MarketingStyleTone> = {
  东方美学风: "oriental",
  节气设计图: "season",
  轻奢护理风: "luxury",
  小红书种草: "social",
  医美极简风: "medical",
  国潮草本风: "herbal",
  香氛生活风: "aroma",
  高端沙龙风: "salon",
};
const posterStyleExamples: Record<string, { title: string; previewSrc: string; summary: string; description: string; cues: string[] }> = {
  东方美学风: {
    title: "东方美学风",
    previewSrc: "/marketing-style-previews/oriental.jpg",
    summary: "国风留白",
    description: "适合突出东方器物、雅致护理和高端门店气质。",
    cues: ["国风", "留白", "雅致"],
  },
  节气设计图: {
    title: "节气设计图",
    previewSrc: "/marketing-style-previews/season.jpg",
    summary: "节令海报",
    description: "适合节气、节日、养生节点活动，画面更有季节氛围。",
    cues: ["节令", "植物", "活动感"],
  },
  轻奢护理风: {
    title: "轻奢护理风",
    previewSrc: "/marketing-style-previews/luxury.jpg",
    summary: "高级护理",
    description: "适合呈现护理空间、服务手法和专业高客单项目。",
    cues: ["高级", "专业", "贵气"],
  },
  小红书种草: {
    title: "小红书种草",
    previewSrc: "/marketing-style-previews/social.jpg",
    summary: "真实分享",
    description: "适合做种草笔记、体验分享和社媒传播内容。",
    cues: ["清新", "拼贴", "种草"],
  },
  医美极简风: {
    title: "医美极简风",
    previewSrc: "/marketing-style-previews/medical-minimal.jpg",
    summary: "干净专业",
    description: "适合强调专业感、洁净空间和高信任度护理项目。",
    cues: ["极简", "洁净", "专业"],
  },
  国潮草本风: {
    title: "国潮草本风",
    previewSrc: "/marketing-style-previews/guochao-herbal.jpg",
    summary: "草本国潮",
    description: "适合中式植物、产品包装、东方器物和国潮质感海报。",
    cues: ["草本", "国潮", "东方"],
  },
  香氛生活风: {
    title: "香氛生活风",
    previewSrc: "/marketing-style-previews/aroma-lifestyle.jpg",
    summary: "生活场景",
    description: "适合香氛、舒缓护理、家居感和轻松种草内容。",
    cues: ["香氛", "生活", "松弛"],
  },
  高端沙龙风: {
    title: "高端沙龙风",
    previewSrc: "/marketing-style-previews/salon-premium.jpg",
    summary: "门店质感",
    description: "适合展示高客单项目、门店环境和精致服务体验。",
    cues: ["沙龙", "质感", "高级"],
  },
};
const birthdayChannels = [
  { name: "微信私聊", sourceChannel: "私聊", icon: MessageCircle, tone: "green" },
  { name: "朋友圈", sourceChannel: "朋友圈", icon: ImageIcon, tone: "blue" },
  { name: "小红书", sourceChannel: "小红书", icon: BookOpen, tone: "rose" },
] as const;
const posterSizes = ["朋友圈 1:1", "小红书 3:4", "竖版 9:16", "横版 16:9"];
const videoRatios = ["9:16", "1:1", "16:9"];
const videoDurations = [5, 10, 15];
const videoResolutions = ["480p", "720p", "1080p"];
const videoResolutionLabels: Record<string, string> = {
  "480p": "480p 默认省钱",
  "720p": "720p 更清晰",
  "1080p": "1080p 最高成本",
};
const videoPaces = ["慢推", "平移", "微距", "快切"];
const videoTemplates = ["产品质感展示", "手持试用展示", "人物场景种草", "门店护理场景", "高端品牌广告", "社媒快节奏切片"];
const videoTemplateTones: Record<string, MarketingStyleTone> = {
  产品质感展示: "luxury",
  手持试用展示: "aroma",
  人物场景种草: "social",
  门店护理场景: "medical",
  高端品牌广告: "salon",
  社媒快节奏切片: "season",
};
const videoTemplateExamples: Record<string, VideoTemplateExample> = {
  产品质感展示: {
    title: "产品质感展示",
    summary: "静物光影",
    description: "展示包装、材质、光影和陈列质感的镜头感觉。",
    cues: ["静物光影", "材质特写", "产品清晰"],
    previewSrc: "/marketing-video-template-previews/product-texture.jpg",
    previewVideoSrc: "/marketing-video-template-previews/product-texture-generated-20260621.mp4",
    previewAlt: "产品质感展示视频模板示例",
    icon: Package,
  },
  手持试用展示: {
    title: "手持试用展示",
    summary: "手部动作",
    description: "展示拿起、打开、涂抹或展示质地的镜头感觉。",
    cues: ["手部动作", "真实试用", "产品清晰"],
    previewSrc: "/marketing-video-template-previews/hand-demo.jpg",
    previewVideoSrc: "/marketing-video-template-previews/hand-demo-generated-20260621.mp4",
    previewAlt: "手持试用展示视频模板示例",
    icon: Hand,
  },
  人物场景种草: {
    title: "人物场景种草",
    summary: "真人分享",
    description: "展示人物手持产品、自拍感和生活化分享的镜头感觉。",
    cues: ["真人分享", "生活场景", "社媒种草"],
    previewSrc: "/marketing-video-template-previews/social-person.jpg",
    previewVideoSrc: "/marketing-video-template-previews/social-person-real-20260621.mp4",
    previewAlt: "人物场景种草视频模板示例",
    icon: UserRound,
  },
  门店护理场景: {
    title: "门店护理场景",
    summary: "空间服务",
    description: "展示产品出现在护理床、护理师动作或门店空间里的镜头感觉。",
    cues: ["门店空间", "护理动作", "产品入镜"],
    previewSrc: "/marketing-video-template-previews/salon-care.jpg",
    previewVideoSrc: "/marketing-video-template-previews/salon-care-generated-20260621.mp4",
    previewAlt: "门店护理场景视频模板示例",
    icon: Store,
  },
  高端品牌广告: {
    title: "高端品牌广告",
    summary: "品牌大片",
    description: "展示微距、柔光、包装特写和高级品牌感的镜头感觉。",
    cues: ["品牌大片", "柔光微距", "高级质感"],
    previewSrc: "/marketing-video-template-previews/brand-ad.jpg",
    previewVideoSrc: "/marketing-video-template-previews/brand-ad-generated-20260621.mp4",
    previewAlt: "高端品牌广告视频模板示例",
    icon: Gem,
  },
  社媒快节奏切片: {
    title: "社媒快节奏切片",
    summary: "多镜头快切",
    description: "展示包装、质地、使用和氛围快速切换的镜头感觉。",
    cues: ["多镜头快切", "发布感", "节奏更快"],
    previewSrc: "/marketing-video-template-previews/social-cut.jpg",
    previewVideoSrc: "/marketing-video-template-previews/social-cut-generated-20260621-v2.mp4",
    previewAlt: "社媒快节奏切片视频模板示例",
    icon: Scissors,
  },
};
const talkTopicTabs = ["热门选题", "产品介绍", "项目科普", "客户关怀", "活动说明"];
const talkTopics: Array<{ id: string; title: string; description: string; tags: string[]; icon: typeof Sparkles; tone: "teal" | "amber" | "blue" }> = [
  {
    id: "season-dry",
    title: "为什么换季脸干、泛红？",
    description: "从原因、表现到护理建议，顾客更容易理解。",
    tags: ["适合真人讲解", "皮肤管理"],
    icon: MessageCircle,
    tone: "teal",
  },
  {
    id: "first-repair",
    title: "第一次做补水修护要注意什么？",
    description: "流程、感受、频次建议，帮新客建立信任。",
    tags: ["适合新客", "项目科普"],
    icon: Sparkles,
    tone: "amber",
  },
  {
    id: "home-care",
    title: "在家护肤最容易踩的3个坑",
    description: "常见误区加正确做法，实用干货更易传播。",
    tags: ["适合客户关怀", "口播干货"],
    icon: ShieldCheck,
    tone: "blue",
  },
];
const talkResultItems: Array<{ title: string; subtitle: string; status: string; icon: typeof Sparkles; tone: "blue" | "teal" | "green" | "purple" | "rose" }> = [
  { title: "自动字幕", subtitle: "识别语音，生成同步字幕", status: "已生成", icon: Captions, tone: "blue" },
  { title: "口播降噪", subtitle: "去除背景杂音，提升音质", status: "已优化", icon: AudioLines, tone: "teal" },
  { title: "剪掉停顿", subtitle: "智能剪辑停顿和冗余片段", status: "已处理", icon: Scissors, tone: "green" },
  { title: "封面标题", subtitle: "生成吸引封面标题", status: "3个", icon: ImageIcon, tone: "purple" },
  { title: "发布文案", subtitle: "适配朋友圈/小红书文案", status: "朋友圈/小红书", icon: MessageSquarePlus, tone: "rose" },
];
const MAX_MARKETING_ASSET_BYTES = 8 * 1024 * 1024;
const USD_TO_CNY_DISPLAY_RATE = AI_CREDIT_CNY_PER_USD;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MARKETING_PENDING_LOST_MESSAGE = "后台生成任务超过10分钟仍未拿到视频任务编号，可能提交阶段被服务重启、供应商超时或网络中断终止，无法继续刷新。请重新生成。";

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

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("视频读取失败"));
    };
    reader.onerror = () => reject(new Error("视频读取失败"));
    reader.readAsDataURL(blob);
  });
}

function talkVideoMimeType(blob: Blob) {
  return (blob.type || "video/mp4").split(";")[0].trim().toLowerCase() || "video/mp4";
}

function talkVideoExtension(blob: Blob) {
  const mimeType = talkVideoMimeType(blob);
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("quicktime")) return "mov";
  if (mimeType.includes("ogg")) return "ogv";
  return "webm";
}

function talkVideoFileName(blob: Blob) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `真人口播-${timestamp}.${talkVideoExtension(blob)}`;
}

function preferredTalkVideoMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.64003E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((item) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(item)) || "";
}

function talkCanvasSize(ratio: "9:16" | "16:9") {
  return ratio === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const output: string[] = [];
  let line = "";
  Array.from(text).forEach((char) => {
    const nextLine = `${line}${char}`;
    if (context.measureText(nextLine).width > maxWidth && line) {
      output.push(line);
      line = char;
      return;
    }
    line = nextLine;
  });
  if (line) output.push(line);
  return output;
}

function drawMirroredTalkVideo(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  drawX: number,
  drawY: number,
  drawWidth: number,
  drawHeight: number,
  canvasWidth: number,
) {
  context.save();
  context.translate(canvasWidth, 0);
  context.scale(-1, 1);
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function drawTalkVideoSafeFit(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const coverScale = Math.max(width / sourceWidth, height / sourceHeight);
  const coverWidth = sourceWidth * coverScale;
  const coverHeight = sourceHeight * coverScale;
  context.save();
  context.globalAlpha = 0.42;
  context.filter = "blur(18px)";
  drawMirroredTalkVideo(context, video, (width - coverWidth) / 2, (height - coverHeight) / 2, coverWidth, coverHeight, width);
  context.restore();

  const fitScale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * fitScale;
  const drawHeight = sourceHeight * fitScale;
  drawMirroredTalkVideo(context, video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight, width);
}

function drawTalkCaptionLine(context: CanvasRenderingContext2D, text: string, centerX: number, baselineY: number, maxWidth: number) {
  const segments = Array.from(text).map((char) => ({
    char,
    color: /[脸干泛红卡粉]/.test(char) ? "#f59e0b" : /[补水修护稳]/.test(char) ? "#22c3ad" : "#ffffff",
  }));
  const totalWidth = Math.min(maxWidth, segments.reduce((sum, item) => sum + context.measureText(item.char).width, 0));
  let x = centerX - totalWidth / 2;
  segments.forEach((item) => {
    context.fillStyle = item.color;
    context.fillText(item.char, x, baselineY);
    x += context.measureText(item.char).width;
  });
}

function drawTalkVideoOverlay(
  context: CanvasRenderingContext2D,
  options: { width: number; height: number; ratio: "9:16" | "16:9"; scriptLines: string[]; recordedSeconds: number; serviceName: string },
) {
  const { width, height, ratio, scriptLines, recordedSeconds, serviceName } = options;
  const safeLines = scriptLines.length ? scriptLines : [`先做一次${serviceName}，把皮肤状态稳下来`];
  const lineIndex = Math.min(safeLines.length - 1, Math.max(0, Math.floor(recordedSeconds / 4)));
  const captionText = safeLines[lineIndex] ?? safeLines[0];
  const nextText = safeLines[lineIndex + 1] ?? "";
  context.save();
  const pad = Math.round(width * 0.045);
  const badgeHeight = Math.round(height * 0.034);
  context.fillStyle = "rgba(0, 0, 0, 0.5)";
  context.fillRect(pad, pad, Math.round(width * 0.23), badgeHeight);
  context.fillStyle = "#ffffff";
  context.font = `800 ${Math.round(height * 0.016)}px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  context.textBaseline = "middle";
  context.fillText(`${ratio} 真人口播`, pad + 12, pad + badgeHeight / 2);

  const captionFont = Math.round(height * (ratio === "16:9" ? 0.043 : 0.031));
  context.font = `900 ${captionFont}px system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  context.textBaseline = "alphabetic";
  const maxTextWidth = width - pad * 2;
  const captionLines = wrapCanvasText(context, captionText, maxTextWidth);
  if (nextText && captionLines.length < 2) captionLines.push(...wrapCanvasText(context, nextText, maxTextWidth).slice(0, 1));
  const visibleLines = captionLines.slice(0, 2);
  const lineHeight = Math.round(captionFont * 1.35);
  const boxHeight = visibleLines.length * lineHeight + Math.round(height * 0.025);
  const boxY = Math.round(height * 0.72);
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(pad, boxY, width - pad * 2, boxHeight);
  visibleLines.forEach((line, index) => {
    drawTalkCaptionLine(context, line, width / 2, boxY + Math.round(height * 0.024) + lineHeight * index, maxTextWidth);
  });
  context.restore();
}

function talkTranscriptSourceLabel(source?: "browser-speech" | "openai-transcription" | "script-fallback") {
  if (source === "browser-speech") return "语音识别";
  if (source === "openai-transcription") return "后端转写";
  return "提词脚本";
}

async function analyzeTalkAudioSilence(blob: Blob): Promise<TalkSilenceReport> {
  const AudioContextCtor = (window as typeof window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }).AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return { status: "未检测", method: "browser-audio-rms", note: "当前浏览器不支持音频分析" };
  }
  const context = new AudioContextCtor();
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = audioBuffer.sampleRate;
    const windowSamples = Math.max(1, Math.round(sampleRate * 0.1));
    const minSilentWindows = 5;
    const threshold = 0.018;
    const channelData = audioBuffer.getChannelData(0);
    let silentWindows = 0;
    let currentSilentWindows = 0;
    let detectedSegments = 0;
    for (let start = 0; start < channelData.length; start += windowSamples) {
      let sum = 0;
      const end = Math.min(channelData.length, start + windowSamples);
      for (let index = start; index < end; index += 1) sum += channelData[index] * channelData[index];
      const rms = Math.sqrt(sum / Math.max(1, end - start));
      if (rms < threshold) {
        silentWindows += 1;
        currentSilentWindows += 1;
      } else {
        if (currentSilentWindows >= minSilentWindows) detectedSegments += 1;
        currentSilentWindows = 0;
      }
    }
    if (currentSilentWindows >= minSilentWindows) detectedSegments += 1;
    const silentSeconds = Math.round(silentWindows * 0.1 * 10) / 10;
    return {
      status: detectedSegments > 0 ? "已生成剪辑点" : "未发现明显停顿",
      method: "browser-audio-rms",
      detectedSegments,
      silentSeconds,
      sampleWindowMs: 100,
      note: detectedSegments > 0 ? "已记录停顿位置，保存后可用于后续剪辑复核" : "录制节奏较连续",
    };
  } catch {
    return { status: "未检测", method: "browser-audio-rms", note: "当前视频格式暂不能在浏览器内解码音轨" };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function readMarketingImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}

function marketingMaterialKeyFromDataUrl(dataUrl: string) {
  if (!dataUrl) return "";
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `image:${(hash >>> 0).toString(16)}:${dataUrl.length}`;
}

function marketingVideoMaterialKey(dataUrl: string, template: string, ratio = "9:16", duration = 5, resolution = "480p", pace = "慢推") {
  const imageKey = marketingMaterialKeyFromDataUrl(dataUrl);
  const safeTemplate = marketingCompliantText(template || "产品质感展示").slice(0, 80);
  const safeRatio = marketingCompliantText(ratio || "9:16").slice(0, 12);
  const safeDuration = Number.isFinite(Number(duration)) ? Number(duration) : 5;
  const safeResolution = marketingCompliantText(resolution || "480p").slice(0, 20);
  const safePace = marketingCompliantText(pace || "慢推").slice(0, 40);
  return imageKey ? `${imageKey}:template:${safeTemplate}:ratio:${safeRatio}:duration:${safeDuration}:resolution:${safeResolution}:pace:${safePace}` : "";
}

function productVideoDraftFromImage(input: {
  fileName: string;
  dimensions?: { width: number; height: number };
  template: string;
  pace: string;
}) {
  const fileLabel = input.fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  const ratioHint = input.dimensions
    ? input.dimensions.height > input.dimensions.width * 1.15
      ? "竖图构图"
      : input.dimensions.width > input.dimensions.height * 1.15
        ? "横图构图"
        : "方图构图"
    : "上传产品图";
  const templateHint = input.template.includes("人物")
    ? "人物自然出镜，手持或使用上传产品，产品和人物动作融合且清晰可辨"
    : input.template.includes("手持")
      ? "手部拿起、展示和轻微转动"
      : input.template.includes("门店")
        ? "门店空间中产品清晰入镜"
        : input.template.includes("快节奏")
          ? "包装、细节和使用氛围快切"
          : "产品静物特写和柔光质感";
  return [
    fileLabel && !/^产品\d*$/i.test(fileLabel) ? `产品：${fileLabel}` : "以上传产品图为准",
    ratioHint,
    templateHint,
    `${input.pace}镜头，保留产品外观、颜色、材质和包装识别点`,
  ].join("；").slice(0, 200);
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

function marketingTaskTone(category: Exclude<MarketingTaskCategory, "birthday">, badge: string, title: string) {
  if (category === "repurchase" || badge === "项目周期") return "blue";
  if (badge === "传统节日") return "rose";
  if (badge === "节气内容") return "amber";
  if (badge === "养生节点") return "teal";
  return marketingNodeTone(title);
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

function getProjectCycleMarketingNode(): MarketingNode {
  const projectNode = marketingCalendarNodes.find((node) => node.category === "项目周期");
  if (!projectNode) {
    return {
      title: "项目复购提醒",
      badge: "项目周期",
      description: "按客户最近消费项目提醒老客复购。",
      hint: "会员卡、次数卡、最近消费项目",
      dateLabel: "项目周期",
    };
  }
  return {
    title: marketingCompliantText(projectNode.title),
    badge: marketingCompliantText(projectNode.category),
    description: marketingCompliantText(projectNode.description),
    hint: marketingCompliantText(projectNode.serviceHint),
    dateLabel: "项目周期",
  };
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

function posterSizeForMarketingChannel(value: string) {
  if (value === "小红书") return "小红书 3:4";
  return "朋友圈 1:1";
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
  return kind === "image" ? "产品设计图" : kind === "video" ? "产品视频" : kind === "talk" ? "口播" : "图文案";
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
  if (record.kind === "image") return "上传产品图";
  if (record.kind === "video") return record.videoUrl ? "产品视频已生成" : record.taskId ? "视频任务已提交，可刷新状态" : "上传产品图转视频";
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
  const items = [
    compactRecordText(record.status),
    marketingRecordKindLabel(record.kind),
    shortRecordTime(record.createdAt),
  ];
  if (record.kind !== "image" && record.kind !== "video") {
    items.splice(2, 0, compactRecordText(record.channel) || "未标记渠道");
  }
  return items.filter(Boolean).join(" · ");
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
  const [copyOutputMode, setCopyOutputMode] = useState<MarketingCopyOutputMode>("poster");
  const [activeMarketingTaskCategory, setActiveMarketingTaskCategory] = useState<MarketingTaskCategory>("festival");
  const [selectedBirthdayTaskId, setSelectedBirthdayTaskId] = useState("");
  const [showAllMarketingTasks, setShowAllMarketingTasks] = useState(false);
  const [customRequirementOpen, setCustomRequirementOpen] = useState(false);
  const [posterStyle, setPosterStyle] = useState("东方美学风");
  const [showPosterStyleExamples, setShowPosterStyleExamples] = useState(false);
  const [posterSize, setPosterSize] = useState("朋友圈 1:1");
  const [videoTemplate, setVideoTemplate] = useState("产品质感展示");
  const [videoRatio, setVideoRatio] = useState("9:16");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoResolution, setVideoResolution] = useState("480p");
  const [videoPace, setVideoPace] = useState("慢推");
  const [videoScript, setVideoScript] = useState("");
  const [videoScriptAutoFilled, setVideoScriptAutoFilled] = useState(false);
  const [productImageAnalysisStatus, setProductImageAnalysisStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [talkStep, setTalkStep] = useState<TalkFlowStep>("entry");
  const [activeTalkTab, setActiveTalkTab] = useState(talkTopicTabs[0]);
  const [selectedTalkTopicId, setSelectedTalkTopicId] = useState(talkTopics[0].id);
  const [talkRatio, setTalkRatio] = useState<"9:16" | "16:9">("9:16");
  const [talkRecording, setTalkRecording] = useState(false);
  const [talkElapsed, setTalkElapsed] = useState(0);
  const [talkCameraReady, setTalkCameraReady] = useState(false);
  const [talkCameraError, setTalkCameraError] = useState("");
  const [talkFinalizing, setTalkFinalizing] = useState(false);
  const [talkRecordedBlob, setTalkRecordedBlob] = useState<Blob | null>(null);
  const [talkRecordedVideoUrl, setTalkRecordedVideoUrl] = useState("");
  const [talkTranscriptText, setTalkTranscriptText] = useState("");
  const [talkSilenceReport, setTalkSilenceReport] = useState<TalkSilenceReport | null>(null);
  const [talkSaveBusy, setTalkSaveBusy] = useState(false);
  const [talkSaveError, setTalkSaveError] = useState("");
  const [talkSavedRecordId, setTalkSavedRecordId] = useState("");
  const [talkPhoneSaveBusy, setTalkPhoneSaveBusy] = useState(false);
  const [talkPhoneSaveMessage, setTalkPhoneSaveMessage] = useState("");
  const [talkOptimizationOpen, setTalkOptimizationOpen] = useState(false);
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
  const [videoStatusRefreshing, setVideoStatusRefreshing] = useState(false);
  const [manualCopyText, setManualCopyText] = useState("");
  const generationInFlightRef = useRef(false);
  const generationDialogDismissedRef = useRef(false);
  const videoScriptAutoFilledRef = useRef(false);
  const productImageAnalysisCacheRef = useRef(new Map<string, string>());
  const productImageAnalysisRequestRef = useRef("");
  const talkVideoRef = useRef<HTMLVideoElement | null>(null);
  const talkStreamRef = useRef<MediaStream | null>(null);
  const talkMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const talkRecordedChunksRef = useRef<BlobPart[]>([]);
  const talkRecorderCleanupRef = useRef<() => void>(() => undefined);
  const talkRecordedMetricsRef = useRef<TalkRecordedMetrics | null>(null);
  const talkRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const product = data.products[0];
  const service = data.services[0];
  const storeName = primaryStoreName(data) || "门店";
  const birthdayTasks = useMemo(() => getBirthdayMarketingTasks(data), [data]);
  const selectedBirthdayTask = selectedBirthdayTaskId ? birthdayTasks.find((item) => item.id === selectedBirthdayTaskId) : undefined;
  const projectCycleNode = useMemo(() => getProjectCycleMarketingNode(), []);
  const nodeTaskItem = (category: Exclude<MarketingTaskCategory, "birthday">, node: MarketingNode): MarketingTaskItem => {
    const tone = marketingTaskTone(category, node.badge, node.title);
    return {
      kind: "node",
      category,
      id: `${category}-${node.title}`,
      title: node.title,
      subtitle: node.dateLabel ?? "近期推荐",
      badge: node.badge,
      tagTone: tone,
      tone,
      node,
    };
  };
  const birthdayTaskItems: MarketingTaskItem[] = birthdayTasks.map((task) => ({
    kind: "birthday" as const,
    category: "birthday" as const,
    id: `birthday-${task.id}`,
    title: task.name,
    subtitle: task.timingLabel,
    badge: task.tag,
    tagTone: task.tagTone,
    tone: task.tagTone,
    birthdayTask: task,
  }));
  const festivalTaskItems = todayMarketingNodes
    .filter((node) => node.badge === "传统节日" || node.badge === "节气内容")
    .map((node) => nodeTaskItem("festival", node));
  const wellnessTaskItems = todayMarketingNodes
    .filter((node) => node.badge === "养生节点")
    .map((node) => nodeTaskItem("wellness", node));
  const repurchaseTaskItems = [nodeTaskItem("repurchase", projectCycleNode)];
  const marketingTasksByCategory: Record<MarketingTaskCategory, MarketingTaskItem[]> = {
    birthday: birthdayTaskItems,
    festival: festivalTaskItems,
    wellness: wellnessTaskItems,
    repurchase: repurchaseTaskItems,
  };
  const activeMarketingTasks = marketingTasksByCategory[activeMarketingTaskCategory];
  const canExpandMarketingTasks = activeMarketingTasks.length > 3;
  const visibleMarketingTasks = showAllMarketingTasks ? activeMarketingTasks : activeMarketingTasks.slice(0, 3);
  const todayBirthdayCount = birthdayTasks.filter((item) => item.daysUntil === 0).length;
  const marketingTaskCategories: Array<{
    key: MarketingTaskCategory;
    title: string;
    summary: string;
    meta: string;
    icon: typeof CakeSlice;
    tone: string;
  }> = [
    {
      key: "birthday",
      title: "生日提醒",
      summary: birthdayTasks.length > 0 ? `7天内 ${birthdayTasks.length} 位` : "7天内 0 位",
      meta: todayBirthdayCount > 0 ? `今日 ${todayBirthdayCount} 位` : "客户关怀",
      icon: marketingTaskCategoryIcons.birthday,
      tone: "purple",
    },
    {
      key: "festival",
      title: "节日节气",
      summary: festivalTaskItems[0]?.title ?? "暂无节点",
      meta: `${festivalTaskItems.length} 个任务`,
      icon: marketingTaskCategoryIcons.festival,
      tone: "amber",
    },
    {
      key: "wellness",
      title: "养生节点",
      summary: wellnessTaskItems[0]?.title ?? "暂无节点",
      meta: `${wellnessTaskItems.length} 个任务`,
      icon: marketingTaskCategoryIcons.wellness,
      tone: "teal",
    },
    {
      key: "repurchase",
      title: "复购提醒",
      summary: projectCycleNode.title,
      meta: "老客周期",
      icon: marketingTaskCategoryIcons.repurchase,
      tone: "blue",
    },
  ];
  const activeMarketingTaskCategoryInfo = marketingTaskCategories.find((item) => item.key === activeMarketingTaskCategory) ?? marketingTaskCategories[0];
  const ActiveMarketingTaskIcon = activeMarketingTaskCategoryInfo.icon;
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const aiPermissions = storeAiUsagePermissions(data);
  const selectedCapability = generationKind === "image" ? "image" : generationKind === "video" ? "video" : "copy";
  const contentState = aiCapabilityUsageState(aiConfig, aiPermissions, session.user.role, selectedCapability);
  const selectedGenerationMode = generationModes.find((item) => item.kind === generationKind) ?? generationModes[0];
  const selectedModeLocked = Boolean(selectedGenerationMode.locked);
  const isPosterMode = generationKind === "image";
  const isVideoMode = generationKind === "video";
  const isTalkMode = generationKind === "talk";
  const isProductMediaMode = isPosterMode || isVideoMode;
  const isCopyMode = generationKind === "copy";
  const copyGenerateTitle = copyOutputMode === "text" ? "生成文案" : copyOutputMode === "image" ? "生成图片" : "生成图文";
  const effectivePosterSize = isPosterMode ? posterSize : posterSizeForMarketingChannel(channel);
  const quotaState = aiFreeQuotaState(data, session.user.id);
  const marketingCreditStatus = quotaState.credits > 0
    ? `积分 ${formatAiCreditAmount(quotaState.credits)}`
    : quotaState.remaining > 0
      ? `今日免费 ${quotaState.remaining}次`
      : "免费已用完";
  const marketingQuotaDetail = quotaState.credits > 0
    ? "生成后按实际模型费用扣除积分"
    : quotaState.enforced
      ? "无积分账号会优先使用今日免费次数"
      : `${quotaState.startsAt} 起启用每日免费额度`;
  const selectableMarketingNodes = [...todayMarketingNodes, projectCycleNode];
  const selectedNode = selectableMarketingNodes.find((item) => item.title === marketingNode) ?? todayMarketingNodes[0] ?? projectCycleNode;
  const birthdayMarketingNode = selectedBirthdayTask ? "生日提醒" : marketingNode;
  const birthdayMarketingGoal = selectedBirthdayTask ? "生日祝福" : marketingGoal;
  const emptyBirthdayCategory = activeMarketingTaskCategory === "birthday" && !selectedBirthdayTask;
  const effectiveCustomerType = selectedBirthdayTask?.tag ?? customerType;
  const safeMarketingNode = marketingCompliantText(birthdayMarketingNode);
  const safeBodyState = marketingCompliantText(bodyState);
  const safeMarketingGoal = marketingCompliantText(birthdayMarketingGoal);
  const safePosterStyle = marketingCompliantText(posterStyle);
  const safeVideoTemplate = marketingCompliantText(videoTemplate);
  const activePosterStyleExample = posterStyleExamples[posterStyle] ?? posterStyleExamples["东方美学风"];
  const activeVideoTemplateExample = videoTemplateExamples[videoTemplate] ?? videoTemplateExamples["产品质感展示"];
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
  const productPosterRequirement = safeCustomRequirement || undefined;
  const previewSummaryItems = [safeMarketingNode, channel, safeMarketingGoal];
  const copyPreviewText = emptyBirthdayCategory
    ? "暂无生日客户。生日提醒会在客户生日进入未来 7 天时自动出现，可以切换到节日节气、养生节点或复购提醒继续生成内容。"
    : selectedBirthdayTask
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
  const productImageBaseMaterialKey = marketingMaterialKeyFromDataUrl(productImageDataUrl);
  const productImageMaterialKey = marketingVideoMaterialKey(productImageDataUrl, safeVideoTemplate, videoRatio, videoDuration, videoResolution, videoPace);
  const legacyProductImageTemplateKey = productImageDataUrl ? `${productImageBaseMaterialKey}:template:${safeVideoTemplate}` : "";
  const duplicateVideoRecord = productImageMaterialKey
    ? marketingAiRecords.find((record) =>
      record.kind === "video"
      && record.createdBy === session.user.id
      && (
        record.materialKey === productImageMaterialKey
        || (!record.videoResolution && record.materialKey === legacyProductImageTemplateKey && videoRatio === "9:16" && videoDuration === 5 && videoResolution === "480p" && videoPace === "慢推")
        || (safeVideoTemplate === "产品质感展示" && !record.videoTemplate && record.materialKey === productImageBaseMaterialKey && videoRatio === "9:16" && videoDuration === 5 && videoResolution === "480p" && videoPace === "慢推")
      )
      && record.status !== "生成失败",
    )
    : undefined;
  const latestGenerationResultRecord = generationResult?.record?.id ? marketingAiRecords.find((record) => record.id === generationResult.record?.id) : undefined;
  const generationResultRecord = generationResult?.record ? staleMarketingAiRecord(latestGenerationResultRecord ?? generationResult.record) : undefined;
  const hasPendingMarketingAiRecords = marketingAiRecords.some((record) => isMarketingAiRecordPending(record) && !isStaleMarketingAiRecord(record));
  const hasPendingGenerationResult = Boolean(generationResultRecord && isMarketingAiRecordPending(generationResultRecord) && !isStaleMarketingAiRecord(generationResultRecord));
  const selectedMarketingRecord = marketingAiRecords.find((record) => record.id === selectedRecordId);
  const dialogRecord = selectedMarketingRecord ?? generationResultRecord;
  const dialogKind = dialogRecord?.kind ?? generationResult?.kind ?? generationKind;
  const dialogImageDataUrl = dialogRecord?.imageDataUrl ?? generationResult?.imageDataUrl;
  const dialogPngSource = isPreviewablePngSource(dialogImageDataUrl) ? dialogImageDataUrl : "";
  const dialogHasInvalidImageSource = Boolean(dialogImageDataUrl && !dialogPngSource);
  const dialogVideoUrl = dialogRecord?.videoUrl ?? generationResult?.videoUrl;
  const dialogVideoTaskId = dialogRecord?.taskId ?? generationResult?.taskId;
  const dialogVideoStatus = dialogRecord?.status ?? generationResult?.status;
  const dialogErrorMessage = dialogRecord?.errorMessage ?? generationResult?.errorMessage;
  const dialogVideoFailed = dialogKind === "video" && dialogVideoStatus === "生成失败";
  const rawDialogText = dialogRecord?.text ?? generationResult?.text;
  const dialogText = rawDialogText && !dialogVideoFailed ? marketingCompliantText(rawDialogText) : rawDialogText && dialogKind !== "video" ? marketingCompliantText(rawDialogText) : undefined;
  const dialogPending = dialogVideoStatus === "生成中";
  const dialogKindTitle = dialogKind === "image" ? "AI产品设计图" : dialogKind === "video" ? "AI产品视频" : dialogKind === "talk" ? "AI口播" : "AI获客图文案";
  const dialogCost = dialogRecord?.cost ?? generationResult?.cost;
  const dialogProvider = dialogRecord?.provider ?? generationResult?.provider;
  const dialogModel = dialogRecord?.model ?? generationResult?.model;
  const dialogTalkOptimization = dialogRecord?.talkOptimization ?? generationResultRecord?.talkOptimization ?? generationResult?.record?.talkOptimization;
  const dialogSummaryItems = dialogRecord
    ? [dialogRecord.marketingNode, dialogRecord.channel, dialogRecord.marketingGoal].map((item) => item ? marketingCompliantText(item) : item).filter(Boolean)
    : previewSummaryItems;
  const showDialogSummary = dialogKind !== "image" && dialogKind !== "video" && dialogSummaryItems.length > 0;
  const showGenerationDialog = Boolean(selectedMarketingRecord || (!generationDialogDismissed && (generationBusy || generationError || generationResult)));
  const showAiTechnicalDetails = session.user.role === "superadmin";
  const selectedTalkTopic = talkTopics.find((topic) => topic.id === selectedTalkTopicId) ?? talkTopics[0];
  const talkServiceName = "补水修护";
  const talkScriptLines = (() => {
    if (selectedTalkTopic.id === "first-repair") {
      return [
        "大家好，我是店里的护理师",
        `第一次做${talkServiceName}，先看皮肤状态，不急着叠加项目`,
        "操作过程中会以补水舒缓为主，感受通常比较温和",
        "做完以后当天注意防晒，清洁和护肤都尽量简单",
        "后续根据皮肤反应，再安排下一次护理会更稳",
      ];
    }
    if (selectedTalkTopic.id === "home-care") {
      return [
        "大家好，我是店里的护理师",
        "在家护肤最容易踩的坑，通常有三个",
        "第一是清洁太猛，第二是精华叠太多，第三是忽略防晒",
        "如果已经脸干、泛红，先把护肤步骤减下来",
        `再配合一次${talkServiceName}，让状态慢慢稳住`,
      ];
    }
    return [
      "大家好，我是店里的护理师",
      "最近换季，很多顾客反馈脸干、泛红、上妆卡粉",
      "这类情况先别急着叠加太多产品",
      `先做一次${talkServiceName}，把皮肤状态稳下来`,
      "再配合日常保湿和防晒，效果会更稳定",
    ];
  })();
  const formattedTalkElapsed = `${String(Math.floor(talkElapsed / 60)).padStart(2, "0")}:${String(talkElapsed % 60).padStart(2, "0")}`;
  const talkResultDisplayItems = talkResultItems.map((item) => {
    if (item.title === "自动字幕") {
      return {
        ...item,
        status: talkTranscriptText ? "已识别" : "脚本字幕",
        subtitle: talkTranscriptText ? "识别语音，生成同步字幕" : "未识别到语音时使用提词脚本",
      };
    }
    if (item.title === "口播降噪") {
      return {
        ...item,
        status: "已写入成片",
        subtitle: "录制时启用降噪、高通滤波和动态压缩",
      };
    }
    if (item.title === "剪掉停顿") {
      const detectedSegments = talkSilenceReport?.detectedSegments;
      return {
        ...item,
        status: typeof detectedSegments === "number" ? `${detectedSegments}段` : talkSilenceReport?.status ?? "检测中",
        subtitle: talkSilenceReport?.note ?? "录制时自动跳过明显无声停顿",
      };
    }
    return item;
  });
  const permissionStateKey = JSON.stringify({ role: session.user.role, permissions: aiPermissions, config: aiConfig });
  const unavailableMessage = () => {
    const label = selectedGenerationMode.title;
    if (contentState.label === "未开通") return `当前门店未开放 ${label} 权限`;
    if (contentState.label === "平台未启用") return `${label} 平台未启用`;
    return `${label} 暂不可用`;
  };

  const stopTalkSpeechRecognition = () => {
    try {
      talkRecognitionRef.current?.stop();
    } catch {
      // Ignore browser speech-recognition shutdown races.
    }
    talkRecognitionRef.current = null;
  };

  const startTalkSpeechRecognition = () => {
    const SpeechRecognitionCtor = (window as typeof window & {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }).SpeechRecognition ?? (window as typeof window & {
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "zh-CN";
      recognition.onresult = (event) => {
        const text = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join("")
          .trim();
        if (text) setTalkTranscriptText(marketingCompliantText(text).slice(0, 3000));
      };
      recognition.onerror = () => undefined;
      recognition.start();
      talkRecognitionRef.current = recognition;
    } catch {
      talkRecognitionRef.current = null;
    }
  };

  const stopTalkRecorder = () => {
    const recorder = talkMediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      talkRecorderCleanupRef.current();
      talkRecorderCleanupRef.current = () => undefined;
    }
    stopTalkSpeechRecognition();
  };

  const startTalkRecorder = (stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") {
      setTalkCameraError("当前浏览器暂不支持视频录制，已显示拍摄示意");
      setTalkFinalizing(false);
      return;
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      setTalkCameraError("当前浏览器暂不支持合成视频录制，请换新版浏览器后再拍");
      setTalkFinalizing(false);
      return;
    }
    const current = talkMediaRecorderRef.current;
    if (current && current.state !== "inactive") return;
    talkRecordedChunksRef.current = [];
    talkRecorderCleanupRef.current();
    talkRecorderCleanupRef.current = () => undefined;
    setTalkFinalizing(false);
    setTalkPhoneSaveBusy(false);
    setTalkPhoneSaveMessage("");
    setTalkRecordedBlob(null);
    setTalkSilenceReport(null);
    setTalkRecordedVideoUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return "";
    });
    setTalkSavedRecordId("");
    setTalkSaveError("");
    setTalkPhoneSaveBusy(false);
    setTalkPhoneSaveMessage("");

    const { width, height } = talkCanvasSize(talkRatio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      setTalkCameraError("当前浏览器暂不支持视频画布合成");
      setTalkFinalizing(false);
      return;
    }

    const canvasStream = canvas.captureStream(30);
    const AudioContextCtor = (window as typeof window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    }).AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let audioContext: AudioContext | undefined;
    let analyser: AnalyserNode | undefined;
    try {
      if (AudioContextCtor && stream.getAudioTracks().length > 0) {
        audioContext = new AudioContextCtor();
        void audioContext.resume().catch(() => undefined);
        const source = audioContext.createMediaStreamSource(stream);
        const highpass = audioContext.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 90;
        const compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -32;
        compressor.knee.value = 22;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.24;
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(highpass);
        highpass.connect(compressor);
        compressor.connect(analyser);
        compressor.connect(destination);
        destination.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      } else {
        stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      }
    } catch {
      stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    }

    const metrics: TalkRecordedMetrics = {
      startedAt: performance.now(),
      lastVoiceAt: performance.now(),
      pauseStartedAt: 0,
      pausedMs: 0,
      trimSegments: 0,
      trimMs: 0,
      isTrimming: false,
    };
    talkRecordedMetricsRef.current = metrics;

    let animationFrameId = 0;
    const drawFrame = () => {
      const now = performance.now();
      const currentPauseMs = metrics.isTrimming && metrics.pauseStartedAt ? now - metrics.pauseStartedAt : 0;
      const recordedSeconds = Math.max(0, (now - metrics.startedAt - metrics.pausedMs - currentPauseMs) / 1000);
      context.fillStyle = "#111111";
      context.fillRect(0, 0, width, height);
      const videoElement = talkVideoRef.current;
      if (videoElement && videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        drawTalkVideoSafeFit(context, videoElement, width, height);
      } else {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#8b755c");
        gradient.addColorStop(0.65, "#3f342c");
        gradient.addColorStop(1, "#201b18");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }
      drawTalkVideoOverlay(context, { width, height, ratio: talkRatio, scriptLines: talkScriptLines, recordedSeconds, serviceName: talkServiceName });
      animationFrameId = window.requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const mimeType = preferredTalkVideoMimeType();
    const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
    let silenceIntervalId = 0;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) talkRecordedChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (metrics.isTrimming && metrics.pauseStartedAt) {
        const trimmedMs = performance.now() - metrics.pauseStartedAt;
        metrics.trimMs += trimmedMs;
        metrics.pausedMs += trimmedMs;
        metrics.isTrimming = false;
      }
      window.cancelAnimationFrame(animationFrameId);
      if (silenceIntervalId) window.clearInterval(silenceIntervalId);
      canvasStream.getTracks().forEach((track) => track.stop());
      void audioContext?.close().catch(() => undefined);
      talkRecorderCleanupRef.current = () => undefined;
      const recordedMimeType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(talkRecordedChunksRef.current, { type: recordedMimeType });
      talkMediaRecorderRef.current = null;
      if (blob.size > 0) {
        setTalkRecordedBlob(blob);
        setTalkRecordedVideoUrl((currentUrl) => {
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          return URL.createObjectURL(blob);
        });
        const trimmedSeconds = Math.round((metrics.trimMs / 1000) * 10) / 10;
        setTalkSilenceReport({
          status: metrics.trimSegments > 0 ? "已实剪" : "未发现明显停顿",
          method: "live-audio-rms-trim",
          detectedSegments: metrics.trimSegments,
          silentSeconds: trimmedSeconds,
          sampleWindowMs: 120,
          note: metrics.trimSegments > 0 ? `录制时已跳过 ${metrics.trimSegments} 段无声停顿，约 ${trimmedSeconds} 秒` : "录制节奏较连续，未触发停顿裁剪",
        });
      }
      setTalkFinalizing(false);
    };
    talkMediaRecorderRef.current = recorder;
    recorder.start(1000);
    if (analyser) {
      const buffer = new Uint8Array(analyser.fftSize);
      const silenceThreshold = 0.026;
      silenceIntervalId = window.setInterval(() => {
        if (recorder.state === "inactive" || !analyser) return;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          const normalized = (buffer[index] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();
        if (rms > silenceThreshold) {
          metrics.lastVoiceAt = now;
          if (metrics.isTrimming && metrics.pauseStartedAt) {
            const trimmedMs = now - metrics.pauseStartedAt;
            metrics.trimMs += trimmedMs;
            metrics.pausedMs += trimmedMs;
            metrics.isTrimming = false;
            metrics.pauseStartedAt = 0;
          }
          if (recorder.state === "paused") recorder.resume();
          return;
        }
        const canTrim = now - metrics.startedAt > 1800 && now - metrics.lastVoiceAt > 900;
        if (canTrim && recorder.state === "recording") {
          recorder.pause();
          metrics.isTrimming = true;
          metrics.pauseStartedAt = now;
          metrics.trimSegments += 1;
        }
      }, 120);
    }
    talkRecorderCleanupRef.current = () => {
      window.cancelAnimationFrame(animationFrameId);
      if (silenceIntervalId) window.clearInterval(silenceIntervalId);
      canvasStream.getTracks().forEach((track) => track.stop());
      void audioContext?.close().catch(() => undefined);
    };
    startTalkSpeechRecognition();
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

  const handleProductImageChange = async (file: File | undefined) => {
    if (!file) {
      setProductImageName("");
      setProductImageDataUrl("");
      setVideoScriptAutoFilled(false);
      videoScriptAutoFilledRef.current = false;
      setProductImageAnalysisStatus("idle");
      productImageAnalysisRequestRef.current = "";
      return;
    }
    try {
      setGenerationError("");
      setProductImageName(file.name);
      const dataUrl = await readMarketingImageFile(file);
      setProductImageDataUrl(dataUrl);
      const materialKey = marketingMaterialKeyFromDataUrl(dataUrl);
      const canAutoFillVideoScript = isVideoMode && (!videoScript.trim() || videoScriptAutoFilledRef.current);
      if (canAutoFillVideoScript) {
        const dimensions = await readMarketingImageDimensions(dataUrl);
        const draft = productVideoDraftFromImage({
          fileName: file.name,
          dimensions,
          template: videoTemplate,
          pace: videoPace,
        });
        setVideoScript(draft);
        setVideoScriptAutoFilled(true);
        videoScriptAutoFilledRef.current = true;
        const cachedAnalysis = productImageAnalysisCacheRef.current.get(materialKey);
        if (cachedAnalysis) {
          setVideoScript(cachedAnalysis);
          setProductImageAnalysisStatus("ready");
          return;
        }
        setProductImageAnalysisStatus("loading");
        productImageAnalysisRequestRef.current = materialKey;
        try {
          const analysis = await actions.analyzeMarketingProductImage({
            productImageName: file.name,
            productImageDataUrl: dataUrl,
            videoTemplate,
            videoPace,
          });
          const analysisText = marketingCompliantText(analysis.text).slice(0, 200);
          if (analysisText) productImageAnalysisCacheRef.current.set(materialKey, analysisText);
          if (productImageAnalysisRequestRef.current === materialKey && videoScriptAutoFilledRef.current) {
            if (analysisText) setVideoScript(analysisText);
            setProductImageAnalysisStatus(analysisText ? "ready" : "failed");
          }
        } catch (analysisError) {
          if (productImageAnalysisRequestRef.current === materialKey && videoScriptAutoFilledRef.current) {
            setProductImageAnalysisStatus("failed");
          }
        }
      } else {
        setProductImageAnalysisStatus("idle");
      }
    } catch (caught) {
      setProductImageName("");
      setProductImageDataUrl("");
      setVideoScriptAutoFilled(false);
      videoScriptAutoFilledRef.current = false;
      setProductImageAnalysisStatus("idle");
      productImageAnalysisRequestRef.current = "";
      setGenerationError(caught instanceof Error ? caught.message : "图片读取失败");
    }
  };

  const selectMarketingTaskCategory = (category: MarketingTaskCategory) => {
    setActiveMarketingTaskCategory(category);
    setShowAllMarketingTasks(false);
    if (category === "birthday") {
      const firstBirthdayTask = birthdayTasks[0];
      setSelectedBirthdayTaskId(firstBirthdayTask?.id ?? "");
      if (firstBirthdayTask) {
        setChannel("私聊");
        setMarketingGoal("生日祝福");
      }
      return;
    }

    setSelectedBirthdayTaskId("");
    const firstNodeTask = marketingTasksByCategory[category].find((task): task is Extract<MarketingTaskItem, { kind: "node" }> => task.kind === "node");
    if (firstNodeTask) {
      setMarketingNode(firstNodeTask.node.title);
    }
    setMarketingGoal("复购提醒");
  };

  useEffect(() => {
    if (selectedModeLocked) setGenerationKind("copy");
  }, [selectedModeLocked]);

  useEffect(() => {
    if (activeView === "content" && generationKind === "copy") {
      setCopyOutputMode("poster");
    }
  }, [activeView, generationKind]);

  useEffect(() => {
    if (!isTalkMode) {
      setTalkStep("entry");
      setTalkRecording(false);
      setTalkElapsed(0);
      setTalkFinalizing(false);
      setTalkPhoneSaveBusy(false);
      setTalkPhoneSaveMessage("");
      stopTalkRecorder();
      talkStreamRef.current?.getTracks().forEach((track) => track.stop());
      talkStreamRef.current = null;
    }
  }, [isTalkMode]);

  useEffect(() => {
    const overlayActive = isTalkMode && talkStep !== "entry";
    const previousOverflow = document.body.style.overflow;
    document.body.classList.toggle("yich-talk-overlay-active", overlayActive);
    if (overlayActive) document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("yich-talk-overlay-active");
      document.body.style.overflow = previousOverflow;
    };
  }, [isTalkMode, talkStep]);

  useEffect(() => () => {
    stopTalkRecorder();
    talkStreamRef.current?.getTracks().forEach((track) => track.stop());
    talkStreamRef.current = null;
    if (talkVideoRef.current) talkVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    if (talkRecordedVideoUrl) URL.revokeObjectURL(talkRecordedVideoUrl);
  }, [talkRecordedVideoUrl]);

  useEffect(() => {
    if (selectedBirthdayTaskId && !birthdayTasks.some((item) => item.id === selectedBirthdayTaskId)) {
      setSelectedBirthdayTaskId("");
    }
    if (activeMarketingTasks.length <= 3 && showAllMarketingTasks) {
      setShowAllMarketingTasks(false);
    }
  }, [activeMarketingTasks.length, birthdayTasks, selectedBirthdayTaskId, showAllMarketingTasks]);

  useEffect(() => {
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setImagePreviewFailed(false);
    setManualCopyText("");
    setGenerationDialogDismissed(false);
    generationDialogDismissedRef.current = false;
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

  useEffect(() => {
    if (talkStep !== "shoot" || !talkRecording) return undefined;
    const intervalId = window.setInterval(() => {
      setTalkElapsed((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [talkRecording, talkStep]);

  useEffect(() => {
    if (talkStep !== "shoot") return undefined;
    let stream: MediaStream | undefined;
    let cancelled = false;
    setTalkCameraReady(false);
    setTalkCameraError("");
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setTalkCameraError("当前浏览器暂不支持相机预览");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: talkRatio === "16:9" ? 1280 : 720 },
            height: { ideal: talkRatio === "16:9" ? 720 : 1280 },
            aspectRatio: talkRatio === "16:9" ? 16 / 9 : 9 / 16,
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        talkStreamRef.current = stream;
        if (talkVideoRef.current) {
          talkVideoRef.current.srcObject = stream;
          await talkVideoRef.current.play().catch(() => undefined);
        }
        setTalkCameraReady(true);
        if (talkRecording) startTalkRecorder(stream);
      } catch {
        setTalkCameraError("未开启相机权限，已显示拍摄示意");
      }
    };
    void startCamera();
    return () => {
      cancelled = true;
      stopTalkRecorder();
      stream?.getTracks().forEach((track) => track.stop());
      if (talkStreamRef.current === stream) talkStreamRef.current = null;
      if (talkVideoRef.current) talkVideoRef.current.srcObject = null;
    };
  }, [talkRatio, talkStep]);

  useEffect(() => {
    if (talkStep !== "shoot") return;
    if (talkRecording) {
      if (talkStreamRef.current) startTalkRecorder(talkStreamRef.current);
      return;
    }
    stopTalkRecorder();
  }, [talkRecording, talkStep]);

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
      setGenerationError("口播脚本正在调试中，请先使用获客图文案、产品海报或产品视频");
      generationInFlightRef.current = false;
      return;
    }
    if (generationKind === "video" && !productImageDataUrl) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError("请先上传产品图，再生成产品视频");
      generationInFlightRef.current = false;
      return;
    }
    if (generationKind === "video" && !videoScript.trim()) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError("请填写产品详情或镜头要求，避免模型乱生成并浪费积分");
      generationInFlightRef.current = false;
      return;
    }
    if (generationKind === "video" && duplicateVideoRecord) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError(`同一账号已经用这张产品图提交过相同参数：${safeVideoTemplate} · ${videoRatio} · ${videoDuration}秒 · ${videoResolution} · ${videoPace}。换尺寸、时长、清晰度或镜头节奏后可以重新生成。`);
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
    generationDialogDismissedRef.current = false;
    setDownloadResultStatus("idle");
    setManualCopyText("");
    try {
      const usesProductPosterContext = generationKind === "image" || generationKind === "video";
      const productMediaRequirement = isVideoMode ? marketingCompliantText(videoScript) : productPosterRequirement;
      const result = await actions.generateMarketingAi({
        kind: generationKind,
        storeName: marketingCompliantText(storeName),
        productName: usesProductPosterContext ? undefined : product?.name ? marketingCompliantText(product.name) : undefined,
        serviceName: usesProductPosterContext ? undefined : service?.name ? marketingCompliantText(service.name) : undefined,
        audience: audienceSummary,
        channel: usesProductPosterContext ? undefined : channel,
        marketingNode: usesProductPosterContext ? undefined : safeMarketingNode,
        customerType: usesProductPosterContext ? undefined : customerType,
        lifecycleNode: usesProductPosterContext ? undefined : safeMarketingNode,
        bodyState: usesProductPosterContext ? undefined : safeBodyState,
        marketingGoal: usesProductPosterContext ? undefined : safeMarketingGoal,
        posterStyle: isVideoMode ? safeVideoTemplate : safePosterStyle,
        posterSize: effectivePosterSize,
        posterTitle: usesProductPosterContext ? undefined : safeMarketingNode,
        posterOffer: usesProductPosterContext ? undefined : safeMarketingGoal,
        productImageName,
        productImageDataUrl,
        modelImageName,
        modelImageDataUrl,
        sceneImageName,
        sceneImageDataUrl,
        customRequirement: usesProductPosterContext ? productMediaRequirement : generationRequirement || undefined,
        copyOutputMode,
        videoRatio,
        videoDuration,
        videoResolution,
        videoPace,
        videoScript: isVideoMode ? [`镜头节奏：${videoPace}`, marketingCompliantText(videoScript)].filter(Boolean).join("\n") : marketingCompliantText(videoScript),
        talkScene: `${safeMarketingNode} · ${safeMarketingGoal} · ${channel}`,
      });
      setGenerationResult(result);
      if (result.record?.id && !generationDialogDismissedRef.current) setSelectedRecordId(result.record.id);
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
    if (dialogVideoFailed && dialogErrorMessage) return dialogErrorMessage;
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

  const copyRecord = async (record: MarketingAiRecord) => {
    const copied = await copyTextToClipboard(marketingRecordContent(record));
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const refreshVideoStatus = async () => {
    if (!dialogRecord?.id || dialogKind !== "video" || videoStatusRefreshing) return;
    setVideoStatusRefreshing(true);
    setGenerationError("");
    try {
      const result = await actions.refreshMarketingVideoStatus(dialogRecord.id);
      setGenerationResult((current) => current?.record?.id === result.record?.id ? result : current);
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "视频状态刷新失败");
    } finally {
      setVideoStatusRefreshing(false);
    }
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
    generationDialogDismissedRef.current = false;
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
    setActiveView("records");
  };

  const closeGenerationDialog = () => {
    setGenerationError("");
    setSelectedRecordId("");
    setGenerationDialogDismissed(true);
    generationDialogDismissedRef.current = true;
    setCopyResultStatus("idle");
    setDownloadResultStatus("idle");
    setManualCopyText("");
  };

  const openMarketingRecord = (recordId: string) => {
    generationDialogDismissedRef.current = false;
    setGenerationDialogDismissed(false);
    setSelectedRecordId(recordId);
  };

  const openTalkScript = () => {
    setGenerationKind("talk");
    setTalkStep("script");
    setTalkRecording(false);
    setTalkElapsed(0);
    setTalkOptimizationOpen(false);
  };

  const startTalkShoot = (topicId = selectedTalkTopicId) => {
    setGenerationKind("talk");
    setSelectedTalkTopicId(topicId);
    setTalkStep("shoot");
    setTalkSaveError("");
    setTalkSavedRecordId("");
    setTalkTranscriptText("");
    setTalkSilenceReport(null);
    talkRecordedMetricsRef.current = null;
    setTalkFinalizing(false);
    setTalkOptimizationOpen(false);
    setTalkPhoneSaveBusy(false);
    setTalkPhoneSaveMessage("");
    setTalkRecording(true);
    setTalkElapsed(0);
  };

  const finishTalkShoot = () => {
    setTalkRecording(false);
    if (talkMediaRecorderRef.current && talkMediaRecorderRef.current.state !== "inactive") {
      setTalkFinalizing(true);
    }
    stopTalkRecorder();
    setTalkStep("result");
    setTalkOptimizationOpen(false);
  };

  const resetTalkRecording = () => {
    stopTalkRecorder();
    setTalkElapsed(0);
    setTalkTranscriptText("");
    setTalkSilenceReport(null);
    talkRecordedMetricsRef.current = null;
    setTalkFinalizing(false);
    setTalkSavedRecordId("");
    setTalkSaveError("");
    setTalkPhoneSaveBusy(false);
    setTalkPhoneSaveMessage("");
    setTalkRecordedBlob(null);
    setTalkRecordedVideoUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return "";
    });
    if (talkStreamRef.current) {
      setTalkRecording(true);
      startTalkRecorder(talkStreamRef.current);
    }
  };

  const saveTalkToPhone = async () => {
    if (!talkRecordedBlob) {
      setTalkSaveError("请先完成录制，视频生成后再保存到手机");
      return;
    }
    setTalkPhoneSaveBusy(true);
    setTalkSaveError("");
    setTalkPhoneSaveMessage("");
    const mimeType = talkVideoMimeType(talkRecordedBlob);
    const fileName = talkVideoFileName(talkRecordedBlob);
    const file = new File([talkRecordedBlob], fileName, { type: mimeType });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          files: [file],
          title: "真人口播视频",
          text: "保存真人口播视频",
        });
        setTalkPhoneSaveMessage("已打开系统保存面板，请选择存储视频或保存到相册");
        return;
      }
      const url = URL.createObjectURL(talkRecordedBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      setTalkPhoneSaveMessage("已开始下载视频，请在下载内容中保存到相册");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setTalkPhoneSaveMessage("已取消保存");
        return;
      }
      setTalkSaveError(caught instanceof Error ? caught.message : "保存到手机失败，请重试");
    } finally {
      setTalkPhoneSaveBusy(false);
    }
  };

  const saveTalkMaterial = async () => {
    if (!talkRecordedBlob) {
      setTalkSaveError("请先完成录制，视频生成后再保存素材");
      return;
    }
    setTalkSaveBusy(true);
    setTalkSaveError("");
    try {
      const videoDataUrl = await readBlobAsDataUrl(talkRecordedBlob);
      const silenceReport = talkSilenceReport ?? await analyzeTalkAudioSilence(talkRecordedBlob);
      setTalkSilenceReport(silenceReport);
      const scriptText = talkScriptLines.join("\n");
      const result = await actions.saveMarketingTalkVideo({
        videoDataUrl,
        mimeType: talkVideoMimeType(talkRecordedBlob),
        ratio: talkRatio,
        durationSeconds: talkElapsed,
        topicTitle: selectedTalkTopic.title,
        scriptText,
        transcriptText: talkTranscriptText || scriptText,
        transcriptSource: talkTranscriptText ? "browser-speech" : "script-fallback",
        audioEnhancements: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        silenceReport,
      });
      setTalkSavedRecordId(result.record?.id ?? "");
      if (result.record?.id) setSelectedRecordId(result.record.id);
    } catch (caught) {
      setTalkSaveError(caught instanceof Error ? caught.message : "口播素材保存失败");
    } finally {
      setTalkSaveBusy(false);
    }
  };

  if (isTalkMode && talkStep !== "entry") {
    if (talkStep === "script") {
      return (
        <section className="marketing-talk-flow marketing-talk-script-screen" aria-label="真人口播脚本">
          <header className="marketing-talk-flow-head">
            <button type="button" aria-label="返回口播入口" onClick={() => setTalkStep("entry")}>
              <ArrowLeft size={20} />
            </button>
            <strong>真人口播脚本</strong>
            <span className="marketing-task-credit-pill marketing-talk-credit-pill">
              <Sparkles size={13} aria-hidden="true" />
              {marketingCreditStatus}
            </span>
          </header>

          <div className="marketing-talk-tabs" aria-label="口播选题分类">
            {talkTopicTabs.map((tab) => (
              <button
                type="button"
                key={tab}
                className={activeTalkTab === tab ? "active" : ""}
                aria-pressed={activeTalkTab === tab}
                onClick={() => setActiveTalkTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="marketing-talk-topic-list">
            {talkTopics.map((topic) => {
              const TopicIcon = topic.icon;
              return (
                <article key={topic.id} className="marketing-talk-topic-card" data-tone={topic.tone}>
                  <div className="marketing-talk-topic-title">
                    <span aria-hidden="true"><TopicIcon size={18} strokeWidth={2.45} /></span>
                    <strong>{topic.title}</strong>
                  </div>
                  <div className="marketing-talk-topic-tags">
                    {topic.tags.map((tag) => <em key={tag}>{tag}</em>)}
                  </div>
                  <p>{topic.description}</p>
                  <button type="button" onClick={() => startTalkShoot(topic.id)}>
                    生成我的口播稿
                  </button>
                </article>
              );
            })}
          </div>

          <button type="button" className="marketing-talk-outline-action" onClick={() => startTalkShoot("home-care")}>
            <PenLine size={17} />
            自己输入主题
          </button>
        </section>
      );
    }

    if (talkStep === "shoot") {
      return (
        <section className="marketing-talk-shoot-screen" aria-label="真人口播拍摄">
          <video ref={talkVideoRef} className="marketing-talk-camera-video" muted playsInline autoPlay aria-hidden={!talkCameraReady} />
          <div className={`marketing-talk-camera-fallback ${talkCameraReady ? "hidden" : ""}`} aria-hidden="true">
            <div className="marketing-talk-salon-bg" />
            <div className="marketing-talk-person">
              <span className="marketing-talk-face" />
              <span className="marketing-talk-body" />
            </div>
          </div>
          <div className="marketing-talk-shoot-shade" aria-hidden="true" />

          <header className="marketing-talk-shoot-head">
            <button type="button" aria-label="返回选题脚本" onClick={() => setTalkStep("script")}>
              <ArrowLeft size={20} />
            </button>
            <strong>真人口播 · {talkRatio}</strong>
            <div>
              <span>语速 正常</span>
              <button type="button" className="active">镜像</button>
            </div>
          </header>

          <article className="marketing-talk-prompter" aria-label="提词器">
            <span>提词文案</span>
            {talkScriptLines.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </article>

          <div className="marketing-talk-frame-guide" aria-hidden="true">
            <span>脸部放在虚线内</span>
          </div>
          <button
            type="button"
            className="marketing-talk-ratio-chip"
            onClick={() => setTalkRatio((value) => value === "9:16" ? "16:9" : "9:16")}
          >
            切换 {talkRatio === "9:16" ? "16:9" : "9:16"}
          </button>

          <div className="marketing-talk-recording-status">
            <span />
            <strong>{formattedTalkElapsed}</strong>
            <em>{talkRecording ? "提词中" : "已暂停"}</em>
          </div>
          {talkCameraError && <p className="marketing-talk-camera-note">{talkCameraError}</p>}

          <footer className="marketing-talk-shoot-controls">
            <button type="button" onClick={resetTalkRecording}>
              <RotateCcw size={19} />
              重拍
            </button>
            <button
              type="button"
              className="marketing-talk-record-button"
              aria-label={talkRecording ? "暂停录制" : "开始录制"}
              onClick={() => setTalkRecording((value) => !value)}
            >
              {talkRecording ? <Square size={26} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
            </button>
            <button type="button" onClick={finishTalkShoot}>
              <CheckCircle2 size={20} />
              完成
            </button>
          </footer>
        </section>
      );
    }

    return (
      <section className={`marketing-talk-flow marketing-talk-result-screen ${talkOptimizationOpen ? "optimization-open" : ""}`} aria-label="口播优化结果">
        <header className="marketing-talk-flow-head">
          <button type="button" aria-label="返回真人拍摄" onClick={() => setTalkStep("shoot")}>
            <ArrowLeft size={20} />
          </button>
          <strong>口播成片预览</strong>
          <span className="marketing-talk-head-spacer" />
        </header>

        <article className="marketing-talk-result-preview">
          <div className="marketing-talk-result-video" data-ratio={talkRatio}>
            {talkRecordedVideoUrl ? (
              <video src={talkRecordedVideoUrl} controls playsInline />
            ) : (
              <div className="marketing-talk-result-person" aria-hidden="true" />
            )}
            {!talkRecordedVideoUrl && (
              <button type="button" aria-label="预览口播视频">
                <Play size={26} fill="currentColor" />
              </button>
            )}
            <span className="marketing-talk-video-badge">{talkRatio} 原片</span>
            <button
              type="button"
              className="marketing-talk-optimization-toggle"
              aria-label={talkOptimizationOpen ? "收起优化信息" : "查看优化信息"}
              aria-expanded={talkOptimizationOpen}
              onClick={() => setTalkOptimizationOpen((value) => !value)}
            >
              <ListFilter size={18} />
            </button>
          </div>
        </article>

        <div className="marketing-talk-result-hint">
          <strong>视频内容优先</strong>
          <span>右上角查看字幕、降噪、剪停顿和发布文案</span>
        </div>

        {talkOptimizationOpen && (
          <>
            <button
              type="button"
              className="marketing-talk-sheet-backdrop"
              aria-label="收起优化信息"
              onClick={() => setTalkOptimizationOpen(false)}
            />
            <section className="marketing-talk-optimization-sheet" aria-label="优化信息">
              <span className="marketing-talk-sheet-grabber" aria-hidden="true" />
              <header>
                <div>
                  <strong>优化信息</strong>
                  <small>这些文字默认隐藏，不遮挡视频</small>
                </div>
                <button type="button" onClick={() => setTalkOptimizationOpen(false)}>收起</button>
              </header>
              <div className="marketing-talk-optimization-chips">
                {talkResultDisplayItems.slice(0, 4).map((item) => (
                  <article key={item.title} data-tone={item.tone}>
                    <span>{item.title.replace("自动", "").replace("口播", "").replace("剪掉", "")}</span>
                    <strong>{item.status}</strong>
                  </article>
                ))}
              </div>
              <div className="marketing-talk-optimization-rows">
                <article>
                  <div>
                    <strong>发布文案</strong>
                    <small>适配朋友圈 / 小红书，可复制再编辑</small>
                  </div>
                  <em>已收纳</em>
                </article>
                <article>
                  <div>
                    <strong>16:9 横屏版</strong>
                    <small>适合门店大屏和横版宣传</small>
                  </div>
                  <button type="button" onClick={() => setTalkRatio("16:9")}>生成</button>
                </article>
              </div>
            </section>
          </>
        )}
        {talkSaveError && <p className="marketing-talk-save-error">{talkSaveError}</p>}
        {talkPhoneSaveMessage && <p className="marketing-talk-save-success">{talkPhoneSaveMessage}</p>}
        {talkSavedRecordId && <p className="marketing-talk-save-success">口播素材已保存到生成记录</p>}
        {talkFinalizing && <p className="marketing-talk-save-success">视频正在生成预览，请稍等几秒后保存</p>}

        <footer className="marketing-talk-result-actions">
          <button type="button" className="secondary-button" onClick={() => setTalkStep("shoot")}>
            <RotateCcw size={16} /> 重新拍摄
          </button>
          <button type="button" className="primary-button" disabled={!talkRecordedBlob || talkFinalizing || talkPhoneSaveBusy} onClick={() => void saveTalkToPhone()}>
            <Download size={16} /> {talkPhoneSaveBusy ? "打开中..." : talkFinalizing ? "生成中..." : "保存到手机相册"}
          </button>
          <button type="button" className="marketing-talk-system-save" disabled={!talkRecordedBlob || talkFinalizing || talkSaveBusy} onClick={() => void saveTalkMaterial()}>
            <Save size={15} /> {talkSavedRecordId ? "已保存到系统素材" : talkSaveBusy ? "系统保存中..." : "另存到系统素材"}
          </button>
        </footer>
      </section>
    );
  }

  return (
    <div className={`page-stack marketing-center-page ${isCopyMode ? "marketing-copy-layout" : ""} ${isTalkMode ? "marketing-talk-entry-layout" : ""}`}>
      <PageHero
        icon={<Megaphone size={18} />}
        eyebrow="AI智能营销"
        title="营销中心"
      />

      <section className="workbench-panel marketing-type-panel" aria-label="生成类型">
        <div className="marketing-section-head marketing-type-heading">
          <span
            className={`marketing-task-credit-pill marketing-type-credit-pill ${quotaState.credits > 0 ? "paid" : quotaState.enforced && quotaState.remaining === 0 ? "empty" : ""}`}
            title={marketingQuotaDetail}
          >
            <Sparkles size={13} aria-hidden="true" />
            {marketingCreditStatus}
          </span>
        </div>
        {activeView === "content" && (
          <div className="marketing-output-mode-grid" aria-label="生成内容类型">
            {generationModes.map((item) => {
              const ModeIcon = item.icon;
              const isActive = generationKind === item.kind;
              return (
                <button
                  type="button"
                  key={item.kind}
                  className={`${isActive ? "active" : ""} ${item.locked ? "locked" : ""}`.trim()}
                  data-mode={item.kind}
                  aria-pressed={isActive}
                  disabled={item.locked}
                  onClick={() => {
                    setGenerationKind(item.kind);
                    if (item.kind === "talk") setTalkStep("entry");
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
        )}
      </section>

      {activeView === "content" ? (
        <section className="marketing-workspace">
          <div className={`workbench-panel marketing-form-panel ${!isProductMediaMode ? "marketing-copy-workbench" : ""}`}>
            {isProductMediaMode && (
              <header className="marketing-task-head marketing-poster-head">
                <div>
                  {isVideoMode ? <Video size={19} strokeWidth={2.35} aria-hidden="true" /> : <ImageIcon size={19} strokeWidth={2.35} aria-hidden="true" />}
                  <strong>{isVideoMode ? "AI产品视频" : "AI产品海报"}</strong>
                </div>
              </header>
            )}
            {isCopyMode && (
              <div className="marketing-copy-stage marketing-birthday-workflow">
                <section className="marketing-birthday-panel" aria-label="今日营销任务">
                  <header className="marketing-task-head">
                    <div>
                      <CalendarCheck size={19} strokeWidth={2.35} aria-hidden="true" />
                      <strong>今日营销任务</strong>
                    </div>
                    {canExpandMarketingTasks && (
                      <div className="marketing-task-head-actions">
                        <button type="button" onClick={() => setShowAllMarketingTasks((value) => !value)}>
                          {showAllMarketingTasks ? "收起" : "查看全部"}
                        </button>
                      </div>
                    )}
                  </header>
                  <div className="marketing-task-category-grid" aria-label="营销任务分类">
                    {marketingTaskCategories.map((category) => {
                      const CategoryIcon = category.icon;
                      const isActive = activeMarketingTaskCategory === category.key;
                      return (
                        <button
                          type="button"
                          key={category.key}
                          className={isActive ? "active" : ""}
                          data-category={category.key}
                          data-tone={category.tone}
                          aria-pressed={isActive}
                          onClick={() => selectMarketingTaskCategory(category.key)}
                        >
                          <span aria-hidden="true"><CategoryIcon size={17} strokeWidth={2.35} /></span>
                          <strong>{category.title}</strong>
                          <small>{category.summary}</small>
                          <em>{category.meta}</em>
                        </button>
                      );
                    })}
                  </div>
                  <div className="marketing-birthday-card">
                    <div className="marketing-birthday-title">
                      <span><ActiveMarketingTaskIcon size={17} strokeWidth={2.45} /> {activeMarketingTaskCategoryInfo.title} · {activeMarketingTaskCategoryInfo.summary}</span>
                    </div>
                    <div className="marketing-birthday-list">
                      {visibleMarketingTasks.length > 0 ? visibleMarketingTasks.map((task) => {
                        const isBirthday = task.kind === "birthday";
                        const TaskIcon = marketingTaskCategoryIcons[task.category];
                        const isActive = isBirthday
                          ? selectedBirthdayTask?.id === task.birthdayTask.id
                          : !selectedBirthdayTask && marketingNode === task.node.title;
                        return (
                          <button
                            type="button"
                            key={task.id}
                            className={`marketing-birthday-row ${isActive ? "active" : ""}`}
                            data-tone={task.tone}
                            onClick={() => {
                              if (isBirthday) {
                                setSelectedBirthdayTaskId(task.birthdayTask.id);
                                setChannel("私聊");
                                setMarketingGoal("生日祝福");
                                return;
                              }
                              setSelectedBirthdayTaskId("");
                              setMarketingNode(task.node.title);
                              setMarketingGoal("复购提醒");
                            }}
                          >
                            <span className="marketing-birthday-avatar" data-category={task.category} data-tone={task.tone} aria-hidden="true">
                              <TaskIcon size={19} strokeWidth={2.45} />
                            </span>
                            <span className="marketing-birthday-main">
                              <strong>{task.title}</strong>
                              <small>{task.subtitle}</small>
                            </span>
                            <em data-tone={task.tagTone}>{task.badge}</em>
                          </button>
                        );
                      }) : (
                        <div className="marketing-birthday-empty">
                          <span className="marketing-birthday-avatar" data-category={activeMarketingTaskCategory} aria-hidden="true">
                            <ActiveMarketingTaskIcon size={19} strokeWidth={2.45} />
                          </span>
                          <p>{activeMarketingTaskCategory === "birthday" ? "暂无生日客户" : "暂无可用营销任务"}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <article className="marketing-copy-preview-card marketing-birthday-preview-card">
                  <header>
                    <span><MessageCircle size={17} /> 推荐文案预览 · {selectedBirthdayTask || emptyBirthdayCategory ? "生日提醒" : selectedNode.title}</span>
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
                            data-tone={item.tone}
                            data-channel={item.sourceChannel}
                            onClick={() => setChannel(item.sourceChannel)}
                          >
                            <ChannelIcon size={16} strokeWidth={2.35} />
                            <strong>{item.name}</strong>
                          </button>
                        );
                      })}
                    </div>
                    <footer>
                      <span className="marketing-compliance-note"><ShieldCheck size={15} /> 已规避敏感词</span>
                      <button type="button" onClick={() => void copyCurrentPreview()}>换一条</button>
                    </footer>
                  </div>
                </article>

                <section className="marketing-copy-output-panel" aria-label="生成内容选择">
                  <button
                    type="button"
                    className={copyOutputMode === "poster" ? "active" : ""}
                    aria-pressed={copyOutputMode === "poster"}
                    onClick={() => setCopyOutputMode("poster")}
                  >
                    <Sparkles size={16} strokeWidth={2.35} />
                    <span>
                      <strong>图文</strong>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={copyOutputMode === "text" ? "active" : ""}
                    aria-pressed={copyOutputMode === "text"}
                    onClick={() => setCopyOutputMode("text")}
                  >
                    <MessageSquarePlus size={16} strokeWidth={2.35} />
                    <span>
                      <strong>文案</strong>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={copyOutputMode === "image" ? "active" : ""}
                    aria-pressed={copyOutputMode === "image"}
                    onClick={() => setCopyOutputMode("image")}
                  >
                    <ImagePlus size={16} strokeWidth={2.35} />
                    <span>
                      <strong>图片</strong>
                    </span>
                  </button>
                </section>

                <section className={`marketing-custom-disclosure ${customRequirementOpen ? "expanded" : "collapsed"}`} aria-label="补充条件">
                  <button
                    type="button"
                    className="marketing-custom-card-head"
                    aria-expanded={customRequirementOpen}
                    onClick={() => setCustomRequirementOpen((value) => !value)}
                  >
                    <span><Plus size={16} /> 补充条件</span>
                    <em>优惠 · 护理项目</em>
                  </button>
                  {customRequirementOpen && (
                    <label className="marketing-custom-field">
                      <span>补充要求</span>
                      <textarea
                        value={customRequirement}
                        onChange={(event) => setCustomRequirement(event.target.value)}
                        placeholder="优惠、护理项目、活动话术等"
                        rows={3}
                      />
                    </label>
                  )}
                </section>
              </div>
            )}

            {isTalkMode && (
              <section className="marketing-talk-entry-panel" aria-label="真人口播入口">
                <article className="marketing-talk-entry-hero">
                  <span aria-hidden="true"><MicVocal size={34} strokeWidth={2.4} /></span>
                  <div>
                    <strong>今天拍一条真人口播</strong>
                    <p>选题脚本 · 看词自拍 · 自动字幕</p>
                  </div>
                </article>
                <div className="marketing-talk-entry-actions">
                  <button type="button" className="marketing-talk-entry-action hot" onClick={openTalkScript}>
                    <span aria-hidden="true"><Flame size={24} strokeWidth={2.4} /></span>
                    <strong>从热点选题开始</strong>
                    <small>智能推荐热门话题</small>
                  </button>
                  <button type="button" className="marketing-talk-entry-action draft" onClick={() => startTalkShoot("home-care")}>
                    <span aria-hidden="true"><PenLine size={24} strokeWidth={2.4} /></span>
                    <strong>直接写口播稿</strong>
                    <small>自己输入内容</small>
                  </button>
                </div>
              </section>
            )}

            {isProductMediaMode ? (
              <div className="marketing-context-block marketing-primary-block">
                <div className="marketing-section-head">
                  <div>
                    <strong>上传图片</strong>
                  </div>
                </div>
                <div className="marketing-upload-grid marketing-material-grid compact">
                  <label className={`marketing-upload-box ${productImageDataUrl ? "has-preview" : ""}`}>
                    {productImageDataUrl ? (
                      <span className="marketing-upload-preview" aria-hidden="true">
                        <img src={productImageDataUrl} alt="" />
                      </span>
                    ) : (
                      <Plus size={18} />
                    )}
                    <strong>产品图</strong>
                    {productImageName && <span className="marketing-upload-file">{productImageName}</span>}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void handleProductImageChange(event.target.files?.[0])}
                    />
                  </label>
                  <label className={`marketing-upload-box ${modelImageDataUrl ? "has-preview" : ""}`}>
                    {modelImageDataUrl ? (
                      <span className="marketing-upload-preview" aria-hidden="true">
                        <img src={modelImageDataUrl} alt="" />
                      </span>
                    ) : (
                      <Plus size={18} />
                    )}
                    <strong>模特图</strong>
                    {modelImageName && <span className="marketing-upload-file">{modelImageName}</span>}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void handleMarketingImageChange(event.target.files?.[0], setModelImageName, setModelImageDataUrl)}
                    />
                  </label>
                </div>

                <div className="marketing-poster-options">
                  <div className="marketing-section-head compact marketing-style-head">
                    <div>
                      <strong>{isVideoMode ? "视频模板" : "图片风格"}</strong>
                      <span>{isVideoMode ? "镜头模板 · 不消耗积分" : "固定示例 · 不消耗积分"}</span>
                    </div>
                    {!isVideoMode && (
                      <button
                        type="button"
                        className="marketing-style-gallery-trigger"
                        onClick={() => setShowPosterStyleExamples(true)}
                      >
                        <Eye size={14} />
                        <span>看全部</span>
                      </button>
                    )}
                  </div>
                  <div className="marketing-style-grid" aria-label={isVideoMode ? "视频模板" : "图片风格"}>
                    {(isVideoMode ? videoTemplates : posterStyles).map((item) => {
                      const example = isVideoMode ? videoTemplateExamples[item] : posterStyleExamples[item];
                      const active = isVideoMode ? videoTemplate === item : posterStyle === item;
                      const tone = isVideoMode ? videoTemplateTones[item] : posterStyleTones[item];
                      const TemplateIcon = isVideoMode ? videoTemplateExamples[item].icon : null;
                      return (
                        <button
                          type="button"
                          key={item}
                          className={[active ? "active" : "", isVideoMode ? "marketing-video-template-button" : ""].filter(Boolean).join(" ")}
                          data-style-tone={tone}
                          onClick={() => {
                            if (isVideoMode) {
                              setVideoTemplate(item);
                              return;
                            }
                            setPosterStyle(item);
                          }}
                        >
                          {isVideoMode && TemplateIcon ? (
                            <>
                              <span className="marketing-video-template-icon"><TemplateIcon size={22} /></span>
                              <span className="marketing-video-template-copy">
                                <strong>{item}</strong>
                                <em>{example.summary}</em>
                              </span>
                            </>
                          ) : (
                            <>
                              <strong>{item}</strong>
                              <span>{example.summary}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {!isVideoMode && (
                    <article className="marketing-style-preview-card" data-style-tone={posterStyleTones[activePosterStyleExample.title]}>
                      <div className="marketing-style-preview-media">
                        <img src={activePosterStyleExample.previewSrc} alt={`${activePosterStyleExample.title}示例效果`} />
                        <span>当前示例</span>
                      </div>
                      <div className="marketing-style-preview-copy">
                        <strong>{activePosterStyleExample.title}</strong>
                        <p>{activePosterStyleExample.description}</p>
                        <div>
                          {activePosterStyleExample.cues.map((cue) => <span key={cue}>{cue}</span>)}
                        </div>
                      </div>
                    </article>
                  )}
                  {!isVideoMode && (
                    <label className="marketing-size-select">
                      <span>尺寸大小</span>
                      <select value={posterSize} onChange={(event) => setPosterSize(event.target.value)}>
                        {posterSizes.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                  )}
                  {isVideoMode && (
                    <article className="marketing-video-template-preview" data-style-tone={videoTemplateTones[activeVideoTemplateExample.title]}>
                      <div className="marketing-video-template-media">
                        {activeVideoTemplateExample.previewVideoSrc ? (
                          <video
                            key={activeVideoTemplateExample.previewVideoSrc}
                            src={activeVideoTemplateExample.previewVideoSrc}
                            poster={activeVideoTemplateExample.previewSrc}
                            aria-label={activeVideoTemplateExample.previewAlt}
                            muted
                            loop
                            autoPlay
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img src={activeVideoTemplateExample.previewSrc} alt={activeVideoTemplateExample.previewAlt} />
                        )}
                        <span>当前示例</span>
                      </div>
                      <div className="marketing-video-template-detail">
                        <div className="marketing-video-template-summary">
                          <strong>{activeVideoTemplateExample.title}</strong>
                          <p>{activeVideoTemplateExample.description}</p>
                          <div>
                            {activeVideoTemplateExample.cues.map((cue) => <span key={cue}>{cue}</span>)}
                          </div>
                        </div>
                        <div className="marketing-video-template-controls">
                          <label className="marketing-video-control-select">
                            <span>视频比例</span>
                            <select value={videoRatio} onChange={(event) => setVideoRatio(event.target.value)}>
                              {videoRatios.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                          </label>
                          <label className="marketing-video-control-select">
                            <span>视频时长</span>
                            <select value={videoDuration} onChange={(event) => setVideoDuration(Number(event.target.value))}>
                              {videoDurations.map((item) => <option key={item} value={item}>{item} 秒</option>)}
                            </select>
                          </label>
                          <label className="marketing-video-control-select">
                            <span>清晰度</span>
                            <select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)}>
                              {videoResolutions.map((item) => <option key={item} value={item}>{videoResolutionLabels[item]}</option>)}
                            </select>
                          </label>
                          <label className="marketing-video-control-select">
                            <span>镜头节奏</span>
                            <select value={videoPace} onChange={(event) => setVideoPace(event.target.value)}>
                              {videoPaces.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="marketing-video-detail-field">
                          <span>镜头要求 / 产品详情（必填）</span>
                          <div className="marketing-video-detail-editor">
                            <textarea
                              value={videoScript}
                              onChange={(event) => {
                                setVideoScript(event.target.value);
                                setVideoScriptAutoFilled(false);
                                videoScriptAutoFilledRef.current = false;
                                setProductImageAnalysisStatus("idle");
                              }}
                              maxLength={200}
                              placeholder="必填：请输入产品成分、质地、香味、适合场景、卖点或镜头要求，未填写不会提交生成..."
                              rows={5}
                            />
                            <em>{videoScript.length} / 200</em>
                          </div>
                          {videoScriptAutoFilled && productImageAnalysisStatus !== "idle" && (
                            <p className="marketing-video-auto-note" data-status={productImageAnalysisStatus}>
                              {productImageAnalysisStatus === "loading"
                                ? "正在识别上传产品图，识别完成后会自动填入这里。"
                                : productImageAnalysisStatus === "failed"
                                  ? "图片识别失败，已先填入基础草稿；请手动补充产品名称、材质和卖点。"
                                  : "已根据上传产品图识别并生成草稿，可直接修改后再生成。"}
                            </p>
                          )}
                        </label>
                        {videoScriptAutoFilled && productImageAnalysisStatus === "idle" && (
                          <p className="marketing-video-auto-note">已根据上传产品图生成草稿，可直接修改后再生成。</p>
                        )}
                        {duplicateVideoRecord && (
                          <p className="marketing-video-duplicate-note">{`这张产品图已提交过相同参数：${safeVideoTemplate} · ${videoRatio} · ${videoDuration}秒 · ${videoResolution} · ${videoPace}。换尺寸、时长、清晰度或镜头节奏后可以重新生成。`}</p>
                        )}
                      </div>
                    </article>
                  )}
                  {!isVideoMode && (
                    <label className="marketing-custom-field">
                      <span>产品详情 / 我想自己写要求</span>
                      <textarea
                        value={customRequirement}
                        onChange={(event) => setCustomRequirement(event.target.value)}
                        placeholder="例如：产品成分、质地、香味、适合场景、希望突出的卖点或画面要求"
                        rows={3}
                      />
                    </label>
                  )}
                </div>
              </div>
            ) : null}
            {!isTalkMode && (
            <div className={`marketing-form-actions ${isCopyMode ? "marketing-copy-actions" : "single"}`}>
              <button type="button" className="primary-button marketing-copy-action" disabled={!contentState.enabled || generationBusy} onClick={generate}>
                <Sparkles size={16} /> {generationBusy ? "生成中..." : selectedBirthdayTask && !isProductMediaMode ? (copyOutputMode === "text" ? "生成生日文案" : copyOutputMode === "image" ? "生成生日图片" : "生成生日图文") : isCopyMode ? copyGenerateTitle : `生成${selectedGenerationMode.title}`}
              </button>
              <button
                type="button"
                className="marketing-record-shortcut"
                onClick={() => setActiveView("records")}
              >
                <Sparkles size={15} aria-hidden="true" />
                <span>生成记录</span>
                <em>{typedMarketingAiRecords.length}</em>
              </button>
            </div>
            )}
          </div>
        </section>
      ) : (
        <section className="workbench-panel marketing-record-panel">
          <PanelTitle
            icon={<Sparkles size={18} />}
            title="生成记录"
            action={(
              <button type="button" className="marketing-record-back" onClick={() => setActiveView("content")}>
                返回生成
              </button>
            )}
          />
          <div className="marketing-record-list">
            {typedMarketingAiRecords.slice(0, 12).map((record) => {
              const recordPending = isMarketingAiRecordPending(record);
              const recordDownloadLabel = isPreviewablePngSource(record.imageDataUrl) ? "下载PNG" : record.videoUrl ? "下载视频" : "下载文案";
              const recordDownloadDisabled = recordPending || ((record.kind === "video" || record.kind === "talk") && !record.videoUrl && !record.text);
              return (
                <article
                  key={record.id}
                  className="marketing-record-item"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    openMarketingRecord(record.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    if ((event.target as HTMLElement).closest("button")) return;
                    event.preventDefault();
                    openMarketingRecord(record.id);
                  }}
                >
                  <div className="marketing-record-main">
                    <span className="marketing-record-type">{marketingRecordKindLabel(record.kind)}</span>
                    <strong>{marketingRecordTitle(record)}</strong>
                    <span className="marketing-record-summary">{recordPending ? "后台生成中，完成后自动更新" : record.kind === "image" ? marketingRecordSummary(record) : record.marketingNode || marketingRecordSummary(record)}</span>
                    <small>{marketingRecordMeta(record)}</small>
                  </div>
                  <div className="marketing-record-cost">
                    <b>{recordPending ? "完成后显示" : formatAiCostCredits(record.cost)}</b>
                    {!recordPending && formatAiCreditCharge(record) && <small>{formatAiCreditCharge(record)}</small>}
                  </div>
                  <div className="marketing-record-actions">
                    <button type="button" aria-label="查看记录" onClick={() => openMarketingRecord(record.id)}><Eye size={15} /></button>
                    <button type="button" aria-label="复制文案" disabled={recordPending} onClick={() => void copyRecord(record)}><Copy size={15} /></button>
                    <button type="button" aria-label={recordDownloadLabel} disabled={recordDownloadDisabled} onClick={() => downloadMarketingRecord(record)}><Download size={15} /></button>
                  </div>
                </article>
              );
            })}
            {typedMarketingAiRecords.length === 0 && <p className="empty">暂无{selectedGenerationMode.title}生成记录</p>}
          </div>
        </section>
      )}

      {showPosterStyleExamples && (
        <div className="marketing-style-gallery-overlay" role="presentation">
          <section className="marketing-style-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-style-gallery-title">
            <div className="marketing-result-dialog-head">
              <div>
                <span>图片风格示例</span>
                <h2 id="marketing-style-gallery-title">八种效果对比</h2>
              </div>
              <button
                type="button"
                aria-label="关闭图片风格示例"
                onClick={() => setShowPosterStyleExamples(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="marketing-style-gallery-grid">
              {posterStyles.map((item) => {
                const example = posterStyleExamples[item];
                return (
                  <button
                    type="button"
                    key={item}
                    className={posterStyle === item ? "active" : ""}
                    data-style-tone={posterStyleTones[item]}
                    onClick={() => {
                      setPosterStyle(item);
                      setShowPosterStyleExamples(false);
                    }}
                  >
                    <span className="marketing-style-gallery-image">
                      <img src={example.previewSrc} alt={`${example.title}示例效果`} />
                    </span>
                    <span className="marketing-style-gallery-copy">
                      <strong>{example.title}</strong>
                      <em>{example.description}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
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
                onClick={closeGenerationDialog}
              >
                <X size={18} />
              </button>
            </div>
            {showDialogSummary && (
              <div className="marketing-preview-summary" aria-label="当前生成条件">
                {dialogSummaryItems.map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
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
                {!dialogPending && (dialogText || dialogImageDataUrl || dialogVideoUrl || dialogVideoTaskId || dialogErrorMessage) && (
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
                          <strong>{dialogVideoFailed ? "失败原因" : dialogText ? "配套文案" : "生成信息"}</strong>
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
                      {dialogVideoFailed && dialogErrorMessage && (
                        <div className="marketing-copy-sections">
                          <article>
                            <span>失败原因</span>
                            <p>{dialogErrorMessage}</p>
                          </article>
                          <article>
                            <span>处理建议</span>
                            <p>请换成只包含产品、包装、护理场景的图片；如果图片里有真人或脸部，先裁掉人物后重新生成。</p>
                          </article>
                        </div>
                      )}
                      {dialogKind === "talk" && dialogTalkOptimization && (
                        <div className="marketing-talk-optimization-details" aria-label="口播优化详情">
                          <article>
                            <span>字幕</span>
                            <strong>{talkTranscriptSourceLabel(dialogTalkOptimization.transcriptSource)}</strong>
                          </article>
                          <article>
                            <span>降噪</span>
                            <strong>{dialogTalkOptimization.noiseReduction?.status ?? "已处理"}</strong>
                          </article>
                          <article>
                            <span>停顿</span>
                            <strong>{dialogTalkOptimization.silenceTrim?.status ?? "已检测"}</strong>
                          </article>
                          <article>
                            <span>尺寸</span>
                            <strong>{dialogTalkOptimization.ratio ?? dialogRecord?.videoResolution ?? "9:16"}</strong>
                          </article>
                        </div>
                      )}
                      {!dialogText && dialogKind === "image" && (
                        <p className="marketing-result-note">这张产品设计图由图片模型生成，可直接下载用于发布。</p>
                      )}
                      {dialogText && dialogErrorMessage && (
                        <p className="marketing-result-note">{dialogErrorMessage}</p>
                      )}
                      {!dialogText && dialogKind === "video" && !dialogVideoFailed && (
                        <p className="marketing-result-note">{dialogVideoUrl ? "产品视频已返回，可在线播放或下载。" : "产品视频任务已提交，稍后可在生成记录里查看状态。"}</p>
                      )}
                      <div className="marketing-result-actions">
                        {dialogKind === "video" && dialogVideoTaskId && !dialogVideoUrl && (
                          <button type="button" className="secondary-button" onClick={() => void refreshVideoStatus()} disabled={videoStatusRefreshing}>
                            <Video size={16} /> {videoStatusRefreshing ? "刷新中..." : "刷新视频状态"}
                          </button>
                        )}
                        <button type="button" className="secondary-button" onClick={() => void copyGenerationText()}>
                          <Copy size={16} /> {copyResultStatus === "copied" ? "已复制" : copyResultStatus === "failed" ? "已显示内容" : "复制内容"}
                        </button>
                        <button type="button" className="secondary-button" onClick={downloadPoster} disabled={(dialogKind === "image" && !dialogPngSource && !dialogText && !dialogVideoUrl) || (dialogKind === "video" && !dialogVideoUrl)}>
                          <Download size={16} /> {downloadResultStatus === "downloaded" ? "已下载" : downloadResultStatus === "failed" ? "下载失败" : dialogVideoUrl ? "下载视频" : dialogPngSource ? "下载PNG" : dialogVideoFailed ? "暂无可下载" : "下载文案"}
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
