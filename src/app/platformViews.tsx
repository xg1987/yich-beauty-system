import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCent,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  CreditCard,
  Database,
  HeartHandshake,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { ModuleOverview, type FeatureModule } from "../components/layout/ModuleOverview";
import { PanelTitle } from "../components/layout/PanelTitle";
import { StatCard } from "../components/layout/StatCard";
import { Badge } from "../components/ui/Badge";
import { CheckboxGroup } from "../components/ui/CheckboxGroup";
import { DataTable } from "../components/ui/DataTable";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { platformInviteCodeForPlatformAdmin, reportSummary } from "../domain/business";
import { appointmentRangeMap, calculateAppointmentRoomUsage, filterAppointmentsByRange, type AppointmentRange } from "../domain/appointments";
import { accountAiCredits, aiFreeQuotaState } from "../domain/aiBilling";
import { buildCashierFlowRecords } from "../domain/cashierFlow";
import { canAccessView, parseRolePermissionTemplates, serializeRolePermissionTemplates, type Permission, type UserSession } from "../domain/auth";
import { formatStockQuantity } from "../domain/products";
import type { AiUsageCapability, AppData, AuthUser, Order, R2UsageSnapshot, StoreAiUsagePermissions, SystemConfigKey, UserRole, ViewKey, WorkerUsageSnapshot } from "../domain/types";
import { money, shortDate } from "../domain/utils";
import type { ApiActions } from "../hooks/useApiData";
import { PageHero } from "../components/layout/PageHero";
import { SubmitStatusButton, useMutationPending } from "./mutationPending";
import {
  aiGenerationConfigFromSystemConfigs,
  appointmentServiceNames,
  appointmentTimeRange,
  authUserStatusTone,
  boundedPrice,
  businessStaffOf,
  displayAuthUserStatus,
  displayRoleName,
  displayStaffRole,
  displayUserRole,
  downloadCsvFile,
  isVisibleAccount,
  isVisiblePlatformAdmin,
  maintenanceRoomNamesOf,
  memberCardProjectScopeText,
  memberCardTimesText,
  nameOf,
  roomNamesOf,
  searchInputSync,
  serializeAiGenerationConfig,
  serviceConsumablesOf,
  serviceFormulaSummary,
  signatureRecordContext,
  SignatureRecordDetail,
  videoSpecKey,
} from "./AuthenticatedApp";
import { permissionLabels, permissionOptions, roleScopeLabels } from "./permissionDisplay";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;
type AiProviderKey = "openai" | "deepseek" | "seedance" | "kling" | "hailuo" | "grok";
type AiVideoResolution = "480p" | "720p" | "1080p";
type AiVideoAspectRatio = "9:16" | "1:1" | "16:9";
type AiTextModelConfig = { enabled: boolean; provider: Extract<AiProviderKey, "openai" | "deepseek">; model: string; apiKey: string; inputTokenUsdPerMillion: number; outputTokenUsdPerMillion: number };
const OPENAI_IMAGE_MODEL_OPTIONS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] as const;
type OpenAiImageModel = typeof OPENAI_IMAGE_MODEL_OPTIONS[number];
type AiImageModelConfig = { enabled: boolean; provider: "openai"; model: OpenAiImageModel; apiKey: string; defaultSize: "1024x1024" | "1024x1536" | "1536x1024"; defaultQuality: "standard" | "high"; maxImagesPerRequest: number; textInputUsdPerMillion: number; imageInputUsdPerMillion: number; imageOutputUsdPerMillion: number };
type AiVideoProviderConfig = { provider: Extract<AiProviderKey, "seedance" | "kling" | "hailuo" | "grok">; enabled: boolean; model: string; apiKey: string; defaultDurationSeconds: number; defaultResolution: AiVideoResolution; defaultAspectRatio: AiVideoAspectRatio; priceUsdBySpec: Record<string, number> };
type AiGenerationConfig = { copy: AiTextModelConfig; image: AiImageModelConfig; video: { defaultProvider: AiVideoProviderConfig["provider"]; providers: AiVideoProviderConfig[] } };

const AI_VIDEO_DURATIONS = [5, 10, 15];
const AI_VIDEO_RESOLUTIONS: AiVideoResolution[] = ["480p", "720p", "1080p"];
const AI_VIDEO_ASPECT_RATIOS: AiVideoAspectRatio[] = ["9:16", "1:1", "16:9"];
const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-0-fast-260128";
const AI_PROVIDER_LABELS: Record<AiProviderKey, string> = { openai: "OpenAI", deepseek: "DeepSeek", seedance: "Seedance", kling: "Kling", hailuo: "海螺", grok: "Grok Imagine" };
const AI_USAGE_CAPABILITY_LABELS: Record<AiUsageCapability, string> = { copy: "AI 写文案", image: "AI 做产品设计图", video: "AI 做产品视频" };
const DEFAULT_STORE_AI_USAGE_PERMISSIONS: StoreAiUsagePermissions = { owner: { copy: true, image: true, video: true }, staff: { copy: true, image: true, video: false } };
const DEFAULT_AI_GENERATION_CONFIG: AiGenerationConfig = {
  copy: { enabled: true, provider: "deepseek", model: "deepseek-v4-pro", apiKey: "", inputTokenUsdPerMillion: 0.435, outputTokenUsdPerMillion: 0.87 },
  image: { enabled: true, provider: "openai", model: "gpt-image-2", apiKey: "", defaultSize: "1024x1024", defaultQuality: "high", maxImagesPerRequest: 4, textInputUsdPerMillion: 5, imageInputUsdPerMillion: 8, imageOutputUsdPerMillion: 30 },
  video: { defaultProvider: "seedance", providers: [
    { provider: "seedance", enabled: true, model: DEFAULT_SEEDANCE_MODEL, apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.3408, "5s:720p": 0.7332, "5s:1080p": 1.8279, "10s:480p": 0.6816, "10s:720p": 1.4665, "10s:1080p": 3.6558, "15s:480p": 1.0224, "15s:720p": 2.1997, "15s:1080p": 5.4837 } },
    { provider: "kling", enabled: false, model: "kling-v3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0, "5s:720p": 0.42, "5s:1080p": 0.56, "10s:480p": 0, "10s:720p": 0.84, "10s:1080p": 1.12, "15s:480p": 0, "15s:720p": 1.26, "15s:1080p": 1.68 } },
    { provider: "hailuo", enabled: false, model: "MiniMax-Hailuo-2.3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.1, "5s:720p": 0.28, "5s:1080p": 0.49, "10s:480p": 0.15, "10s:720p": 0.56, "10s:1080p": 0, "15s:480p": 0, "15s:720p": 0, "15s:1080p": 0 } },
    { provider: "grok", enabled: false, model: "grok-imagine-video-1.5", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.4, "5s:720p": 0.4, "5s:1080p": 0, "10s:480p": 0.8, "10s:720p": 0.8, "10s:1080p": 0, "15s:480p": 1.2, "15s:720p": 1.2, "15s:1080p": 0 } },
  ] },
};

function DashboardMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return <article className="metric-card">{icon}<span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

export function PlatformSystemConfigPanel({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  const mutationPending = useMutationPending();
  const configValue = (key: SystemConfigKey, fallback: string) =>
    (data.systemConfigs ?? []).find((item) => item.key === key)?.value ?? fallback;
  const [inviteDays, setInviteDays] = useState(configValue("invite_default_days", "7"));
  const [allowRegistration, setAllowRegistration] = useState(configValue("allow_registration", "true"));
  const [maintenanceMode, setMaintenanceMode] = useState(configValue("maintenance_mode", "false"));
  const [announcement, setAnnouncement] = useState(configValue("system_announcement", ""));
  const [savedKey, setSavedKey] = useState<SystemConfigKey | undefined>();

  useEffect(() => {
    setInviteDays(configValue("invite_default_days", "7"));
    setAllowRegistration(configValue("allow_registration", "true"));
    setMaintenanceMode(configValue("maintenance_mode", "false"));
    setAnnouncement(configValue("system_announcement", ""));
  }, [data.systemConfigs]);

  const saveConfig = (key: SystemConfigKey, value: string) => {
    void runMutation(() => actions.updateSystemConfig(key, value)).then(() => {
      setSavedKey(key);
      window.setTimeout(() => setSavedKey(undefined), 1400);
    });
  };

  return (
    <section className="panel dashboard-panel" aria-label="平台配置">
      <PanelTitle icon={<Settings size={18} />} title="平台配置" action={`${(data.systemConfigs ?? []).length || 4} 项`} />
      <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label>
          <span className="field-label">邀请码有效期</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <input type="number" min={1} max={90} value={inviteDays} onChange={(event) => setInviteDays(event.target.value)} />
            <button type="button" disabled={mutationPending} onClick={() => saveConfig("invite_default_days", inviteDays)}>
              {mutationPending ? "保存中..." : savedKey === "invite_default_days" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
        <label>
          <span className="field-label">门店注册</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <select value={allowRegistration} onChange={(event) => setAllowRegistration(event.target.value)}>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
            <button type="button" disabled={mutationPending} onClick={() => saveConfig("allow_registration", allowRegistration)}>
              {mutationPending ? "保存中..." : savedKey === "allow_registration" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
        <label>
          <span className="field-label">维护模式</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <select value={maintenanceMode} onChange={(event) => setMaintenanceMode(event.target.value)}>
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
            <button type="button" disabled={mutationPending} onClick={() => saveConfig("maintenance_mode", maintenanceMode)}>
              {mutationPending ? "保存中..." : savedKey === "maintenance_mode" ? "已保存" : "保存"}
            </button>
          </div>
        </label>
      </div>
      <label style={{ display: "block", marginTop: "14px" }}>
        <span className="field-label">系统公告</span>
        <textarea value={announcement} maxLength={200} rows={3} onChange={(event) => setAnnouncement(event.target.value)} />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
        <button type="button" disabled={mutationPending} onClick={() => saveConfig("system_announcement", announcement)}>
          {mutationPending ? "保存中..." : savedKey === "system_announcement" ? "已保存" : "保存公告"}
        </button>
      </div>
    </section>
  );
}

export function PlatformSystemConfigView({ data, actions, runMutation }: { data: AppData; actions: ApiActions; runMutation: RunMutation }) {
  return (
    <div className="admin-center-page platform-admin-page">
      <PlatformSystemConfigPanel data={data} actions={actions} runMutation={runMutation} />
    </div>
  );
}

export function PlatformAiConfigView({
  data,
  setView,
  actions,
  runMutation,
}: {
  data: AppData;
  setView: (view: ViewKey) => void;
  actions: ApiActions;
  runMutation: RunMutation;
}) {
  const mutationPending = useMutationPending();
  const [draft, setDraft] = useState(() => aiGenerationConfigFromSystemConfigs(data.systemConfigs));
  const [activeAiPanel, setActiveAiPanel] = useState<"copy" | "image" | "video" | null>(null);
  const [activeVideoProvider, setActiveVideoProvider] = useState<AiVideoProviderConfig["provider"]>("seedance");
  const [saved, setSaved] = useState(false);
  const enabledVideoProviders = draft.video.providers.filter((provider) => provider.enabled);
  const activeVideoConfig = draft.video.providers.find((provider) => provider.provider === activeVideoProvider) ?? draft.video.providers[0] ?? DEFAULT_AI_GENERATION_CONFIG.video.providers[0];
  const configuredPriceRules = draft.video.providers.reduce(
    (sum, provider) => sum + Object.values(provider.priceUsdBySpec).filter((value) => value > 0).length,
    0,
  );
  const capabilityCards = [
    {
      key: "copy" as const,
      title: "文案",
      provider: AI_PROVIDER_LABELS[draft.copy.provider],
      model: draft.copy.model || "未配置模型",
      status: draft.copy.enabled ? "已启用" : "停用",
      meta: draft.copy.apiKey ? "Key 已配置" : "等待 API Key",
      icon: <MessageCircle size={18} />,
    },
    {
      key: "image" as const,
      title: "图片",
      provider: AI_PROVIDER_LABELS[draft.image.provider],
      model: draft.image.model || "未配置模型",
      status: draft.image.enabled ? "已启用" : "停用",
      meta: `${draft.image.defaultSize} · ${draft.image.defaultQuality}`,
      icon: <Sparkles size={18} />,
    },
    {
      key: "video" as const,
      title: "视频",
      provider: `${enabledVideoProviders.length} 个供应商`,
      model: AI_PROVIDER_LABELS[draft.video.defaultProvider],
      status: configuredPriceRules > 0 ? `${configuredPriceRules} 条价格` : "待填价格",
      meta: "Seedance / Kling / 海螺",
      icon: <Megaphone size={18} />,
    },
  ];

  useEffect(() => {
    setDraft(aiGenerationConfigFromSystemConfigs(data.systemConfigs));
  }, [data.systemConfigs]);

  const setCopyConfig = (patch: Partial<AiTextModelConfig>) => {
    setDraft((current) => ({ ...current, copy: { ...current.copy, ...patch } }));
  };
  const setImageConfig = (patch: Partial<AiImageModelConfig>) => {
    setDraft((current) => ({ ...current, image: { ...current.image, ...patch } }));
  };
  const setVideoConfig = (providerKey: AiVideoProviderConfig["provider"], patch: Partial<AiVideoProviderConfig>) => {
    setDraft((current) => ({
      ...current,
      video: {
        ...current.video,
        providers: current.video.providers.map((provider) => provider.provider === providerKey ? { ...provider, ...patch } : provider),
      },
    }));
  };
  const setVideoPrice = (providerKey: AiVideoProviderConfig["provider"], durationSeconds: number, resolution: AiVideoResolution, value: number) => {
    setDraft((current) => ({
      ...current,
      video: {
        ...current.video,
        providers: current.video.providers.map((provider) => {
          if (provider.provider !== providerKey) return provider;
          return {
            ...provider,
            priceUsdBySpec: {
              ...provider.priceUsdBySpec,
              [videoSpecKey(durationSeconds, resolution)]: boundedPrice(value),
            },
          };
        }),
      },
    }));
  };
  const saveAiConfig = () => {
    void runMutation(() => actions.updateSystemConfig("ai_generation_config", serializeAiGenerationConfig(draft))).then(() => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    });
  };

  return (
    <div className="admin-center-page platform-admin-page ai-config-page">
      <PlatformPageTitle title="AI 能力配置" onBack={() => setView("settings")} />
      <section className="page-hero platform-admin-readonly-hero ai-config-hero">
        <div>
          <span className="eyebrow"><Sparkles size={15} /> 平台 AI 能力</span>
          <h1>文案、图片、视频统一配置</h1>
          <p>Admin 配置模型、API Key、默认参数和成本规则。门店营销页只使用能力，不展示密钥。</p>
        </div>
      </section>

      <section className="ai-capability-strip" aria-label="AI 能力状态">
        {capabilityCards.map((card) => (
          <button type="button" className="ai-capability-card" key={card.title} onClick={() => setActiveAiPanel(card.key)}>
            <span className="ai-capability-icon">{card.icon}</span>
            <div>
              <small>{card.title}</small>
              <strong>{card.provider}</strong>
              <em>{card.model}</em>
            </div>
            <b>{card.status}</b>
            <span>{card.meta}</span>
          </button>
        ))}
      </section>

      <Modal
        open={activeAiPanel === "copy"}
        title="文案模型配置"
        subtitle="用于美业营销文案、活动话术和产品说明生成。"
        size="large"
        className="ai-config-modal"
        onClose={() => setActiveAiPanel(null)}
        footer={(
          <>
            <button type="button" onClick={() => setActiveAiPanel(null)}>取消</button>
            <button type="button" className="primary-button" disabled={mutationPending} onClick={saveAiConfig}>
              {mutationPending ? "保存中..." : saved ? "已保存" : "保存文案配置"}
            </button>
          </>
        )}
      >
        <div className="ai-modal-summary">
          <span className="ai-capability-icon"><MessageCircle size={18} /></span>
          <div>
            <strong>{AI_PROVIDER_LABELS[draft.copy.provider]}</strong>
            <span>{draft.copy.model || "未配置模型"} · {draft.copy.enabled ? "已启用" : "停用"}</span>
          </div>
        </div>
        <div className="ai-config-form-grid">
          <label>
            <span className="field-label">启用文案</span>
            <select value={draft.copy.enabled ? "true" : "false"} onChange={(event) => setCopyConfig({ enabled: event.target.value === "true" })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label>
            <span className="field-label">供应商</span>
            <select value={draft.copy.provider} onChange={(event) => setCopyConfig({ provider: event.target.value as AiTextModelConfig["provider"] })}>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            <span className="field-label">模型名称</span>
            <input value={draft.copy.model} onChange={(event) => setCopyConfig({ model: event.target.value })} placeholder="deepseek-v4-pro" />
          </label>
          <label>
            <span className="field-label">API Key</span>
            <input type="password" value={draft.copy.apiKey} onChange={(event) => setCopyConfig({ apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
          </label>
          <label>
            <span className="field-label">输入单价 / 1M tokens</span>
            <input type="number" min={0} step="0.0001" value={draft.copy.inputTokenUsdPerMillion} onChange={(event) => setCopyConfig({ inputTokenUsdPerMillion: boundedPrice(event.target.value) })} />
          </label>
          <label>
            <span className="field-label">输出单价 / 1M tokens</span>
            <input type="number" min={0} step="0.0001" value={draft.copy.outputTokenUsdPerMillion} onChange={(event) => setCopyConfig({ outputTokenUsdPerMillion: boundedPrice(event.target.value) })} />
          </label>
        </div>
      </Modal>

      <Modal
        open={activeAiPanel === "image"}
        title="图片模型配置"
        subtitle="用于产品图解析、产品设计图生成和门店营销素材。"
        size="large"
        className="ai-config-modal"
        onClose={() => setActiveAiPanel(null)}
        footer={(
          <>
            <button type="button" onClick={() => setActiveAiPanel(null)}>取消</button>
            <button type="button" className="primary-button" disabled={mutationPending} onClick={saveAiConfig}>
              {mutationPending ? "保存中..." : saved ? "已保存" : "保存图片配置"}
            </button>
          </>
        )}
      >
        <div className="ai-modal-summary">
          <span className="ai-capability-icon"><Sparkles size={18} /></span>
          <div>
            <strong>OpenAI</strong>
            <span>{draft.image.model || "未配置模型"} · {draft.image.defaultSize} · {draft.image.defaultQuality}</span>
          </div>
        </div>
        <div className="ai-config-form-grid">
          <label>
            <span className="field-label">启用图片</span>
            <select value={draft.image.enabled ? "true" : "false"} onChange={(event) => setImageConfig({ enabled: event.target.value === "true" })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label>
            <span className="field-label">模型名称</span>
            <select value={draft.image.model} onChange={(event) => setImageConfig({ model: event.target.value as OpenAiImageModel })}>
              {OPENAI_IMAGE_MODEL_OPTIONS.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">API Key</span>
            <input type="password" value={draft.image.apiKey} onChange={(event) => setImageConfig({ apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
          </label>
          <label>
            <span className="field-label">默认尺寸</span>
            <select value={draft.image.defaultSize} onChange={(event) => setImageConfig({ defaultSize: event.target.value as AiImageModelConfig["defaultSize"] })}>
              <option value="1024x1024">1024 x 1024</option>
              <option value="1024x1536">1024 x 1536</option>
              <option value="1536x1024">1536 x 1024</option>
            </select>
          </label>
          <label>
            <span className="field-label">默认质量</span>
            <select value={draft.image.defaultQuality} onChange={(event) => setImageConfig({ defaultQuality: event.target.value as AiImageModelConfig["defaultQuality"] })}>
              <option value="standard">standard</option>
              <option value="high">high</option>
            </select>
          </label>
          <label>
            <span className="field-label">单次最多张数</span>
            <input type="number" min={1} max={8} value={draft.image.maxImagesPerRequest} onChange={(event) => setImageConfig({ maxImagesPerRequest: Math.max(1, Math.min(8, Math.trunc(Number(event.target.value) || 1))) })} />
          </label>
          <label>
            <span className="field-label">文本输入 / 1M tokens</span>
            <input type="number" min={0} step="0.0001" value={draft.image.textInputUsdPerMillion} onChange={(event) => setImageConfig({ textInputUsdPerMillion: boundedPrice(event.target.value) })} />
          </label>
          <label>
            <span className="field-label">图片输入 / 1M tokens</span>
            <input type="number" min={0} step="0.0001" value={draft.image.imageInputUsdPerMillion} onChange={(event) => setImageConfig({ imageInputUsdPerMillion: boundedPrice(event.target.value) })} />
          </label>
          <label>
            <span className="field-label">图片输出 / 1M tokens</span>
            <input type="number" min={0} step="0.0001" value={draft.image.imageOutputUsdPerMillion} onChange={(event) => setImageConfig({ imageOutputUsdPerMillion: boundedPrice(event.target.value) })} />
          </label>
        </div>
      </Modal>

      <Modal
        open={activeAiPanel === "video"}
        title="视频模型配置"
        subtitle="按供应商、时长和分辨率维护成本，员工营销页展示可用能力。"
        size="large"
        className="ai-config-modal ai-video-config-modal"
        onClose={() => setActiveAiPanel(null)}
        footer={(
          <>
            <button type="button" onClick={() => setActiveAiPanel(null)}>取消</button>
            <button type="button" className="primary-button" disabled={mutationPending} onClick={saveAiConfig}>
              {mutationPending ? "保存中..." : saved ? "已保存" : "保存视频配置"}
            </button>
          </>
        )}
      >
        <div className="ai-modal-summary">
          <span className="ai-capability-icon"><Megaphone size={18} /></span>
          <div>
            <strong>{AI_PROVIDER_LABELS[activeVideoConfig.provider]}</strong>
            <span>{activeVideoConfig.model || "未配置模型"} · {activeVideoConfig.enabled ? "已启用" : "停用"}</span>
          </div>
        </div>
        <div className="ai-video-default-row">
          <label>
            <span className="field-label">默认视频供应商</span>
            <select value={draft.video.defaultProvider} onChange={(event) => setDraft((current) => ({ ...current, video: { ...current.video, defaultProvider: event.target.value as AiVideoProviderConfig["provider"] } }))}>
              {draft.video.providers.map((provider) => (
                <option key={provider.provider} value={provider.provider}>{AI_PROVIDER_LABELS[provider.provider]}</option>
              ))}
            </select>
          </label>
          <p>切换下方供应商，只编辑当前选中的一套参数和价格矩阵。</p>
        </div>
        <div className="ai-provider-tabs" aria-label="视频供应商">
          {draft.video.providers.map((provider) => (
            <button
              type="button"
              className={provider.provider === activeVideoProvider ? "active" : ""}
              key={provider.provider}
              onClick={() => setActiveVideoProvider(provider.provider)}
            >
              {AI_PROVIDER_LABELS[provider.provider]}
              <span>{provider.enabled ? "启用" : "停用"}</span>
            </button>
          ))}
        </div>
        <article className="ai-video-provider-card single">
          <div className="ai-video-provider-title">
            <strong>{AI_PROVIDER_LABELS[activeVideoConfig.provider]}</strong>
            <select value={activeVideoConfig.enabled ? "true" : "false"} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { enabled: event.target.value === "true" })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </div>
          <div className="ai-config-form-grid compact">
            <label>
              <span className="field-label">模型名称</span>
              <input value={activeVideoConfig.model} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { model: event.target.value })} />
            </label>
            <label>
              <span className="field-label">API Key</span>
              <input type="password" value={activeVideoConfig.apiKey} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { apiKey: event.target.value })} placeholder="api key" autoComplete="off" />
            </label>
            <label>
              <span className="field-label">默认时长</span>
              <select value={activeVideoConfig.defaultDurationSeconds} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { defaultDurationSeconds: Number(event.target.value) })}>
                {AI_VIDEO_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">默认分辨率</span>
              <select value={activeVideoConfig.defaultResolution} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { defaultResolution: event.target.value as AiVideoResolution })}>
                {AI_VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">默认比例</span>
              <select value={activeVideoConfig.defaultAspectRatio} onChange={(event) => setVideoConfig(activeVideoConfig.provider, { defaultAspectRatio: event.target.value as AiVideoAspectRatio })}>
                {AI_VIDEO_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </label>
          </div>
          <div className="ai-price-matrix" aria-label={`${AI_PROVIDER_LABELS[activeVideoConfig.provider]}价格矩阵`}>
            <div className="ai-price-matrix-head">
              <span>时长</span>
              {AI_VIDEO_RESOLUTIONS.map((resolution) => <span key={resolution}>{resolution}</span>)}
            </div>
            {AI_VIDEO_DURATIONS.map((duration) => (
              <div className="ai-price-matrix-row" key={`${activeVideoConfig.provider}-${duration}`}>
                <span>{duration} 秒</span>
                {AI_VIDEO_RESOLUTIONS.map((resolution) => (
                  <input
                    key={`${activeVideoConfig.provider}-${duration}-${resolution}`}
                    aria-label={`${AI_PROVIDER_LABELS[activeVideoConfig.provider]} ${duration}秒 ${resolution} 单价`}
                    type="number"
                    min={0}
                    step="0.0001"
                    value={activeVideoConfig.priceUsdBySpec[videoSpecKey(duration, resolution)] ?? 0}
                    onChange={(event) => setVideoPrice(activeVideoConfig.provider, duration, resolution, Number(event.target.value))}
                  />
                ))}
              </div>
            ))}
          </div>
        </article>
      </Modal>

      <section className="ai-config-grid" aria-label="AI 模型配置">
        <div className="panel dashboard-panel ai-config-card">
          <PanelTitle icon={<MessageCircle size={18} />} title="文案模型" action={draft.copy.enabled ? "已启用" : "未启用"} />
          <div className="ai-config-form-grid">
            <label>
              <span className="field-label">启用文案</span>
              <select value={draft.copy.enabled ? "true" : "false"} onChange={(event) => setCopyConfig({ enabled: event.target.value === "true" })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </label>
            <label>
              <span className="field-label">供应商</span>
              <select value={draft.copy.provider} onChange={(event) => setCopyConfig({ provider: event.target.value as AiTextModelConfig["provider"] })}>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            <label>
              <span className="field-label">模型名称</span>
              <input value={draft.copy.model} onChange={(event) => setCopyConfig({ model: event.target.value })} placeholder="deepseek-v4-pro" />
            </label>
            <label>
              <span className="field-label">API Key</span>
              <input type="password" value={draft.copy.apiKey} onChange={(event) => setCopyConfig({ apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
            </label>
            <label>
              <span className="field-label">输入单价 / 1M tokens</span>
              <input type="number" min={0} step="0.0001" value={draft.copy.inputTokenUsdPerMillion} onChange={(event) => setCopyConfig({ inputTokenUsdPerMillion: boundedPrice(event.target.value) })} />
            </label>
            <label>
              <span className="field-label">输出单价 / 1M tokens</span>
              <input type="number" min={0} step="0.0001" value={draft.copy.outputTokenUsdPerMillion} onChange={(event) => setCopyConfig({ outputTokenUsdPerMillion: boundedPrice(event.target.value) })} />
            </label>
          </div>
        </div>

        <div className="panel dashboard-panel ai-config-card">
          <PanelTitle icon={<Sparkles size={18} />} title="图片模型" action={draft.image.enabled ? "OpenAI" : "未启用"} />
          <div className="ai-config-form-grid">
            <label>
              <span className="field-label">启用图片</span>
              <select value={draft.image.enabled ? "true" : "false"} onChange={(event) => setImageConfig({ enabled: event.target.value === "true" })}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </label>
            <label>
              <span className="field-label">模型名称</span>
              <select value={draft.image.model} onChange={(event) => setImageConfig({ model: event.target.value as OpenAiImageModel })}>
                {OPENAI_IMAGE_MODEL_OPTIONS.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">API Key</span>
              <input type="password" value={draft.image.apiKey} onChange={(event) => setImageConfig({ apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
            </label>
            <label>
              <span className="field-label">默认尺寸</span>
              <select value={draft.image.defaultSize} onChange={(event) => setImageConfig({ defaultSize: event.target.value as AiImageModelConfig["defaultSize"] })}>
                <option value="1024x1024">1024 x 1024</option>
                <option value="1024x1536">1024 x 1536</option>
                <option value="1536x1024">1536 x 1024</option>
              </select>
            </label>
            <label>
              <span className="field-label">默认质量</span>
              <select value={draft.image.defaultQuality} onChange={(event) => setImageConfig({ defaultQuality: event.target.value as AiImageModelConfig["defaultQuality"] })}>
                <option value="standard">standard</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span className="field-label">单次最多张数</span>
              <input type="number" min={1} max={8} value={draft.image.maxImagesPerRequest} onChange={(event) => setImageConfig({ maxImagesPerRequest: Math.max(1, Math.min(8, Math.trunc(Number(event.target.value) || 1))) })} />
            </label>
            <label>
              <span className="field-label">文本输入 / 1M tokens</span>
              <input type="number" min={0} step="0.0001" value={draft.image.textInputUsdPerMillion} onChange={(event) => setImageConfig({ textInputUsdPerMillion: boundedPrice(event.target.value) })} />
            </label>
            <label>
              <span className="field-label">图片输入 / 1M tokens</span>
              <input type="number" min={0} step="0.0001" value={draft.image.imageInputUsdPerMillion} onChange={(event) => setImageConfig({ imageInputUsdPerMillion: boundedPrice(event.target.value) })} />
            </label>
            <label>
              <span className="field-label">图片输出 / 1M tokens</span>
              <input type="number" min={0} step="0.0001" value={draft.image.imageOutputUsdPerMillion} onChange={(event) => setImageConfig({ imageOutputUsdPerMillion: boundedPrice(event.target.value) })} />
            </label>
          </div>
        </div>
      </section>

      <section className="panel dashboard-panel ai-video-panel">
        <PanelTitle icon={<Megaphone size={18} />} title="视频模型" action="Seedance / Kling / 海螺" />
        <div className="ai-video-default-row">
          <label>
            <span className="field-label">默认视频供应商</span>
            <select value={draft.video.defaultProvider} onChange={(event) => setDraft((current) => ({ ...current, video: { ...current.video, defaultProvider: event.target.value as AiVideoProviderConfig["provider"] } }))}>
              {draft.video.providers.map((provider) => (
                <option key={provider.provider} value={provider.provider}>{AI_PROVIDER_LABELS[provider.provider]}</option>
              ))}
            </select>
          </label>
          <p>视频成本按供应商、模型、时长、分辨率计算。这里保存的是当次计费规则，后续生成记录会写入价格快照。</p>
        </div>
        <div className="ai-video-provider-grid">
          {draft.video.providers.map((provider) => (
            <article className="ai-video-provider-card" key={provider.provider}>
              <div className="ai-video-provider-title">
                <strong>{AI_PROVIDER_LABELS[provider.provider]}</strong>
                <select value={provider.enabled ? "true" : "false"} onChange={(event) => setVideoConfig(provider.provider, { enabled: event.target.value === "true" })}>
                  <option value="true">启用</option>
                  <option value="false">停用</option>
                </select>
              </div>
              <div className="ai-config-form-grid compact">
                <label>
                  <span className="field-label">模型名称</span>
                  <input value={provider.model} onChange={(event) => setVideoConfig(provider.provider, { model: event.target.value })} />
                </label>
                <label>
                  <span className="field-label">API Key</span>
                  <input type="password" value={provider.apiKey} onChange={(event) => setVideoConfig(provider.provider, { apiKey: event.target.value })} placeholder="api key" autoComplete="off" />
                </label>
                <label>
                  <span className="field-label">默认时长</span>
                  <select value={provider.defaultDurationSeconds} onChange={(event) => setVideoConfig(provider.provider, { defaultDurationSeconds: Number(event.target.value) })}>
                    {AI_VIDEO_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
                  </select>
                </label>
                <label>
                  <span className="field-label">默认分辨率</span>
                  <select value={provider.defaultResolution} onChange={(event) => setVideoConfig(provider.provider, { defaultResolution: event.target.value as AiVideoResolution })}>
                    {AI_VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                  </select>
                </label>
                <label>
                  <span className="field-label">默认比例</span>
                  <select value={provider.defaultAspectRatio} onChange={(event) => setVideoConfig(provider.provider, { defaultAspectRatio: event.target.value as AiVideoAspectRatio })}>
                    {AI_VIDEO_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                  </select>
                </label>
              </div>
              <div className="ai-price-matrix" aria-label={`${AI_PROVIDER_LABELS[provider.provider]}价格矩阵`}>
                <div className="ai-price-matrix-head">
                  <span>时长</span>
                  {AI_VIDEO_RESOLUTIONS.map((resolution) => <span key={resolution}>{resolution}</span>)}
                </div>
                {AI_VIDEO_DURATIONS.map((duration) => (
                  <div className="ai-price-matrix-row" key={`${provider.provider}-${duration}`}>
                    <span>{duration} 秒</span>
                    {AI_VIDEO_RESOLUTIONS.map((resolution) => (
                      <input
                        key={`${provider.provider}-${duration}-${resolution}`}
                        aria-label={`${AI_PROVIDER_LABELS[provider.provider]} ${duration}秒 ${resolution} 单价`}
                        type="number"
                        min={0}
                        step="0.0001"
                        value={provider.priceUsdBySpec[videoSpecKey(duration, resolution)] ?? 0}
                        onChange={(event) => setVideoPrice(provider.provider, duration, resolution, Number(event.target.value))}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-config-footer panel dashboard-panel">
        <div>
          <strong>成本记录口径</strong>
          <span>文案按输入/输出 tokens，图片按文本输入/图片输入/图片输出 tokens，视频按供应商 + 时长 + 分辨率的单价规则。</span>
        </div>
        <button type="button" disabled={mutationPending} onClick={saveAiConfig}>
          <Save size={17} />
          {mutationPending ? "保存中..." : saved ? "已保存" : "保存 AI 配置"}
        </button>
      </section>
    </div>
  );
}

export function PlatformAdminView({
  data,
}: {
  data: AppData;
}) {
  const visibleAuthUsers = data.authUsers.filter(isVisibleAccount);
  const ownerAccounts = visibleAuthUsers.filter((user) => user.role === "owner" && !isVisiblePlatformAdmin(user));
  const staffAccounts = visibleAuthUsers.filter((user) => ["manager", "frontdesk", "therapist", "finance"].includes(user.role));
  const activeAccounts = visibleAuthUsers.filter((user) => user.status === "active").length;
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const today = new Date();
  const isToday = (value: string) => new Date(value).toDateString() === today.toDateString();
  const belongsToStore = (storeId: string, itemStoreId?: string) => itemStoreId === storeId || (!itemStoreId && data.storeProfiles.length === 1);
  const todayAppointments = data.appointments.filter((item) => isToday(item.startAt)).length;
  const storeRows = data.storeProfiles.map((store) => {
    const storeOrders = data.orders.filter((order) => belongsToStore(store.id, order.storeId));
    const todayOrders = storeOrders.filter((order) => isToday(order.createdAt));
    const storeCustomers = data.customers.filter((customer) => belongsToStore(store.id, customer.storeId));
    const storeStaff = data.staff.filter((staff) => belongsToStore(store.id, staff.storeId) && staff.role !== "老板");
    const storeProducts = data.products.filter((product) => belongsToStore(store.id, product.storeId));
    const storeAppointments = data.appointments.filter((appointment) => belongsToStore(store.id, appointment.storeId));
    const ownerUser = ownerAccounts.find((user) => user.storeId === store.id)
      ?? data.authUsers.find((user) => {
        const staff = user.staffId ? data.staff.find((item) => item.id === user.staffId) : undefined;
        return staff?.storeId === store.id && staff.role === "老板";
      });
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.paidAmount, 0);
    const lowStockCount = storeProducts.filter((product) => product.stock <= product.warningStock).length;
    return [
      store.name,
      ownerUser?.name ?? "未绑定",
      money(todayRevenue),
      `${todayOrders.length} 单`,
      `${storeAppointments.filter((appointment) => isToday(appointment.startAt)).length} 条`,
      `${storeCustomers.length} 人`,
      `${storeStaff.length} 人`,
      `${lowStockCount} 项`,
      <Badge key={`${store.id}-status`} text={(store.status ?? "active") === "active" ? "启用" : "停用"} tone={(store.status ?? "active") === "active" ? "ok" : "warn"} />,
    ];
  });
  const platformMetrics = [
    { icon: <ShieldCheck size={18} />, label: "启用账号", value: `${activeAccounts} 个`, hint: "平台账号" },
    { icon: <Building2 size={18} />, label: "门店账号", value: `${ownerAccounts.length} 个`, hint: "负责人账号" },
    { icon: <UsersRound size={18} />, label: "员工账号", value: `${staffAccounts.length} 个`, hint: "门店成员" },
    { icon: <CalendarDays size={18} />, label: "今日预约", value: `${todayAppointments} 条`, hint: "门店预约" },
  ];

  return (
    <div className="dashboard-page platform-admin-workbench">
      <section className="workbench-hero role-hero-superadmin">
        <span className="workbench-hero-kicker"><Building2 size={15} /> 平台总览</span>
        <h2>平台总览</h2>
        <p>门店 {data.storeProfiles.length} 家 · 账号 {activeAccounts} 个 · 今日预约 {todayAppointments} 条</p>
      </section>

      <section className="workbench-metric-row" aria-label="平台关键数据">
        {platformMetrics.map((item) => (
          <DashboardMetric key={item.label} icon={item.icon} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="workbench-panel">
        <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="平台数据概览" action="数据总览" />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["客户总数", `${data.customers.length} 人`, "客户档案汇总"],
            ["订单总数", `${data.orders.length} 单`, "收银订单汇总"],
            ["实收汇总", money(totalRevenue), "已记录收款金额"],
            ["门店数量", `${data.storeProfiles.length} 家`, "已开通门店"],
          ]}
        />
      </section>

      <section className="workbench-panel">
        <PanelTitle icon={<Building2 size={18} />} title="门店运营概览" action={`${data.storeProfiles.length} 家门店`} />
        <DataTable
          columns={["门店", "店长", "今日收款", "今日订单", "今日预约", "客户", "员工", "库存预警", "状态"]}
          rows={storeRows}
        />
      </section>
    </div>
  );
}

type AiTestTab = "chat" | "image" | "video";

function formatAiTestJson(value: unknown) {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatAiTestCost(cost?: { amountUsd: number; currency: "USD"; estimated: boolean }) {
  if (!cost) return "暂无费用记录";
  const amount = cost.amountUsd;
  return `${cost.estimated ? "预估" : "实际"} $${amount.toFixed(amount > 0 && amount < 0.01 ? 6 : 4)} ${cost.currency}`;
}

function formatAiCostUsd(amount: number) {
  return `$${amount.toFixed(amount > 0 && amount < 0.01 ? 6 : 4)}`;
}

function formatAiCreditAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(amount < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

function marketingAiKindLabel(kind: AppData["marketingAiRecords"][number]["kind"]) {
  return kind === "image" ? "产品设计图" : kind === "video" ? "产品视频" : kind === "talk" ? "口播" : "获客图文案";
}

function aiRecordCostUsd(record: AppData["marketingAiRecords"][number]) {
  const amount = record.cost?.amountUsd;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
}

type AiCostCategory = "text" | "image" | "video";

function aiRecordCategoryCostUsd(record: AppData["marketingAiRecords"][number], category: AiCostCategory) {
  const breakdownAmount = record.costBreakdown?.[category]?.amountUsd;
  if (typeof breakdownAmount === "number" && Number.isFinite(breakdownAmount)) return breakdownAmount;
  const total = aiRecordCostUsd(record);
  if (record.costBreakdown && Object.keys(record.costBreakdown).length > 0) return 0;
  if (category === "text" && record.kind === "talk") return total;
  if (category === "image" && record.kind === "image") return total;
  if (category === "video" && record.kind === "video") return total;
  return 0;
}

function aiRecordUnsplitCostUsd(record: AppData["marketingAiRecords"][number]) {
  if (record.costBreakdown && Object.keys(record.costBreakdown).length > 0) return 0;
  if (record.kind === "copy") return aiRecordCostUsd(record);
  return 0;
}

function aiRecordChinaDateKey(record: AppData["marketingAiRecords"][number]) {
  const date = new Date(record.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function PlatformAiTestCenterView({ data, setView, actions }: { data: AppData; setView: (view: ViewKey) => void; actions: ApiActions }) {
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const [activeTab, setActiveTab] = useState<AiTestTab>("chat");
  const [chatPrompt, setChatPrompt] = useState("帮我写一条美容院老客回访微信话术，语气自然，不要太营销。");
  const [imagePrompt, setImagePrompt] = useState("生成一张高端美容院开业活动产品设计图，紫色主色，包含中文标题：开业礼遇。");
  const [videoPrompt, setVideoPrompt] = useState("高端美容院护理房，柔和灯光，产品陈列干净，镜头缓慢推进，适合门店宣传短视频。");
  const [videoProvider, setVideoProvider] = useState<AiVideoProviderConfig["provider"]>(aiConfig.video.defaultProvider);
  const activeVideoConfig = aiConfig.video.providers.find((provider) => provider.provider === videoProvider) ?? aiConfig.video.providers[0];
  const [videoDuration, setVideoDuration] = useState(activeVideoConfig?.defaultDurationSeconds ?? 5);
  const [videoResolution, setVideoResolution] = useState<AiVideoResolution>(activeVideoConfig?.defaultResolution ?? "480p");
  const [videoAspectRatio, setVideoAspectRatio] = useState<AiVideoAspectRatio>(activeVideoConfig?.defaultAspectRatio ?? "9:16");
  const [videoTaskId, setVideoTaskId] = useState("");
  const [chatResult, setChatResult] = useState<Awaited<ReturnType<ApiActions["testAiChat"]>> | null>(null);
  const [imageResult, setImageResult] = useState<Awaited<ReturnType<ApiActions["testAiImage"]>> | null>(null);
  const [videoResult, setVideoResult] = useState<Awaited<ReturnType<ApiActions["testAiVideo"]>> | null>(null);
  const [busy, setBusy] = useState<AiTestTab | "video-status" | null>(null);
  const [error, setError] = useState("");
  const chatMessages = chatResult
    ? [
      { role: "user" as const, content: chatPrompt },
      { role: "assistant" as const, content: chatResult.text },
    ]
    : [];

  const selectVideoProvider = (provider: AiVideoProviderConfig["provider"]) => {
    const providerConfig = aiConfig.video.providers.find((item) => item.provider === provider);
    setVideoProvider(provider);
    if (providerConfig) {
      setVideoDuration(providerConfig.defaultDurationSeconds);
      setVideoResolution(providerConfig.defaultResolution);
      setVideoAspectRatio(providerConfig.defaultAspectRatio);
    }
  };

  const submitChatTest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("chat");
    setError("");
    actions.testAiChat({ prompt: chatPrompt, history: chatMessages }).then(setChatResult).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "文案对话测试失败");
    }).finally(() => setBusy(null));
  };
  const submitImageTest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("image");
    setError("");
    actions.testAiImage({ prompt: imagePrompt, size: aiConfig.image.defaultSize, quality: aiConfig.image.defaultQuality }).then(setImageResult).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "图片生成测试失败");
    }).finally(() => setBusy(null));
  };
  const submitVideoTest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("video");
    setError("");
    actions.testAiVideo({
      prompt: videoPrompt,
      provider: videoProvider,
      durationSeconds: videoDuration,
      resolution: videoResolution,
      aspectRatio: videoAspectRatio,
    }).then((result) => {
      setVideoResult(result);
      if (result.taskId) setVideoTaskId(result.taskId);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "视频任务测试失败");
    }).finally(() => setBusy(null));
  };
  const queryVideoStatus = () => {
    if (!videoTaskId.trim()) {
      setError("请输入视频任务 ID");
      return;
    }
    setBusy("video-status");
    setError("");
    actions.queryAiVideo({ provider: videoProvider, taskId: videoTaskId.trim() }).then(setVideoResult).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "查询视频任务失败");
    }).finally(() => setBusy(null));
  };

  const capabilityCards = [
    { key: "chat" as const, title: "文案对话", icon: <MessageCircle size={18} />, provider: AI_PROVIDER_LABELS[aiConfig.copy.provider], model: aiConfig.copy.model, status: aiConfig.copy.enabled ? "已启用" : "停用" },
    { key: "image" as const, title: "图片生成", icon: <Sparkles size={18} />, provider: "OpenAI", model: aiConfig.image.model, status: aiConfig.image.enabled ? "已启用" : "停用" },
    { key: "video" as const, title: "视频生成", icon: <Megaphone size={18} />, provider: AI_PROVIDER_LABELS[videoProvider], model: activeVideoConfig?.model ?? "未配置模型", status: activeVideoConfig?.enabled ? "已启用" : "停用" },
  ];

  return (
    <div className="admin-center-page platform-admin-page ai-test-page">
      <PlatformPageTitle title="AI 智能测试中心" onBack={() => setView("settings")} />
      <section className="page-hero platform-admin-readonly-hero ai-config-hero">
        <div>
          <span className="eyebrow"><Sparkles size={15} /> Admin AI 测试</span>
          <h1>聊天、图片、视频接口试跑</h1>
          <p>读取当前 AI 能力配置，直接验证模型、Key、返回结果和任务状态。</p>
        </div>
      </section>

      <section className="ai-capability-strip ai-test-tabs" aria-label="AI 测试类型">
        {capabilityCards.map((card) => (
          <button type="button" className={`ai-capability-card ${activeTab === card.key ? "active" : ""}`} key={card.key} onClick={() => setActiveTab(card.key)}>
            <span className="ai-capability-icon">{card.icon}</span>
            <div>
              <small>{card.title}</small>
              <strong>{card.provider}</strong>
              <em>{card.model || "未配置模型"}</em>
            </div>
            <b>{card.status}</b>
            <span>{card.key === "video" ? "创建任务 / 查询任务" : "实时请求供应商接口"}</span>
          </button>
        ))}
      </section>

      {error && <div className="ai-test-error" role="alert">{error}</div>}

      {activeTab === "chat" && (
        <section className="panel dashboard-panel ai-test-panel">
          <PanelTitle icon={<MessageCircle size={18} />} title="文案对话测试" action={`${AI_PROVIDER_LABELS[aiConfig.copy.provider]} · ${aiConfig.copy.model}`} />
          <form className="ai-test-form" onSubmit={submitChatTest}>
            <label>
              <span className="field-label">测试内容</span>
              <textarea value={chatPrompt} onChange={(event) => setChatPrompt(event.target.value)} rows={5} />
            </label>
            <button type="submit" className="primary-button" disabled={busy !== null}>{busy === "chat" ? "测试中..." : "发送测试"}</button>
          </form>
          {chatResult && (
            <div className="ai-test-result-grid">
              <article className="ai-test-output">
                <small>{chatResult.provider} · {chatResult.model} · {chatResult.elapsedMs}ms</small>
                <p>{chatResult.text}</p>
              </article>
              <pre>{formatAiTestJson({ usage: chatResult.usage, raw: chatResult.raw })}</pre>
            </div>
          )}
        </section>
      )}

      {activeTab === "image" && (
        <section className="panel dashboard-panel ai-test-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="图片生成测试" action={`${aiConfig.image.model} · ${aiConfig.image.defaultSize} · ${aiConfig.image.defaultQuality}`} />
          <form className="ai-test-form" onSubmit={submitImageTest}>
            <label>
              <span className="field-label">图片提示词</span>
              <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} rows={5} />
            </label>
            <button type="submit" className="primary-button" disabled={busy !== null}>{busy === "image" ? "生成中..." : "生成测试图片"}</button>
          </form>
          {imageResult && (
            <div className="ai-test-result-grid">
              <article className="ai-test-image-output">
                {imageResult.imageDataUrl && <img src={imageResult.imageDataUrl} alt="AI 生成测试结果" />}
                <small>{imageResult.provider} · {imageResult.model} · {imageResult.elapsedMs}ms</small>
                {imageResult.status === "生成失败" && <p className="form-error">{imageResult.errorMessage || "图片生成失败"}</p>}
                <p>{formatAiTestCost(imageResult.cost)}</p>
                {imageResult.revisedPrompt && <p>{imageResult.revisedPrompt}</p>}
              </article>
              <pre>{formatAiTestJson({ usage: imageResult.usage, cost: imageResult.cost, raw: imageResult.raw })}</pre>
            </div>
          )}
        </section>
      )}

      {activeTab === "video" && (
        <section className="panel dashboard-panel ai-test-panel">
          <PanelTitle icon={<Megaphone size={18} />} title="视频生成测试" action={`${AI_PROVIDER_LABELS[videoProvider]} · ${activeVideoConfig?.model ?? "未配置模型"}`} />
          <form className="ai-test-form" onSubmit={submitVideoTest}>
            <div className="ai-test-settings">
              <label>
                <span className="field-label">供应商</span>
                <select value={videoProvider} onChange={(event) => selectVideoProvider(event.target.value as AiVideoProviderConfig["provider"])}>
                  {aiConfig.video.providers.map((provider) => <option key={provider.provider} value={provider.provider}>{AI_PROVIDER_LABELS[provider.provider]}</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">时长</span>
                <select value={videoDuration} onChange={(event) => setVideoDuration(Number(event.target.value))}>
                  {AI_VIDEO_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">分辨率</span>
                <select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value as AiVideoResolution)}>
                  {AI_VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">比例</span>
                <select value={videoAspectRatio} onChange={(event) => setVideoAspectRatio(event.target.value as AiVideoAspectRatio)}>
                  {AI_VIDEO_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span className="field-label">视频提示词</span>
              <textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} rows={5} />
            </label>
            <div className="ai-test-actions">
              <button type="submit" className="primary-button" disabled={busy !== null}>{busy === "video" ? "创建中..." : "创建视频任务"}</button>
              <label>
                <span className="field-label">任务 ID</span>
                <input value={videoTaskId} onChange={(event) => setVideoTaskId(event.target.value)} placeholder="生成后自动填入，也可以手动粘贴" />
              </label>
              <button type="button" disabled={busy !== null} onClick={queryVideoStatus}>
                <RefreshCw size={16} />
                {busy === "video-status" ? "查询中..." : "查询状态"}
              </button>
            </div>
          </form>
          {videoResult && (
            <div className="ai-test-result-grid">
              <article className="ai-test-output">
                <small>{videoResult.provider} · {videoResult.model} · {videoResult.elapsedMs}ms</small>
                <p>状态：{videoResult.status ?? "已返回"}</p>
                {videoResult.taskId && <p>任务 ID：{videoResult.taskId}</p>}
                {videoResult.fileId && <p>文件 ID：{videoResult.fileId}</p>}
                {videoResult.videoUrl && <a href={videoResult.videoUrl} target="_blank" rel="noreferrer">打开视频结果</a>}
              </article>
              <pre>{formatAiTestJson({ normalizedRequest: videoResult.normalizedRequest, raw: videoResult.raw })}</pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function PlatformPageTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="platform-page-title">
      <button type="button" aria-label="返回" title="返回" onClick={onBack}>
        <ArrowLeft size={22} />
      </button>
      <h1>{title}</h1>
    </div>
  );
}

export function PlatformAppointmentsReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [appointmentRange, setAppointmentRange] = useState<AppointmentRange>("today");
  const appointmentRanges = appointmentRangeMap();
  const selectedAppointmentRange = appointmentRanges[appointmentRange];
  const pending = data.appointments.filter((item) => item.status === "待确认" || item.status === "已确认").length;
  const completed = data.appointments.filter((item) => item.status === "已完成").length;
  const onlinePendingRequests = data.onlineBookingRequests.filter((item) => item.status === "待处理");
  const onlinePending = onlinePendingRequests.length;
  const rangeAppointments = filterAppointmentsByRange(data.appointments, appointmentRange);
  const rangePending = rangeAppointments.filter((item) => item.status === "待确认" || item.status === "已确认").length;
  const rangeCompleted = rangeAppointments.filter((item) => item.status === "已完成").length;
  const roomNames = roomNamesOf(data);
  const roomUsage = calculateAppointmentRoomUsage(
    rangeAppointments,
    selectedAppointmentRange,
    roomNames,
    maintenanceRoomNamesOf(data, roomNames),
  );
  const rows = rangeAppointments
    .slice(0, 120)
    .map((item) => [
      shortDate(item.startAt),
      nameOf(data.customers, item.customerId),
      nameOf(data.services, item.serviceId),
      nameOf(data.staff, item.staffId),
      <Badge key={`${item.id}-status`} text={item.status} tone={item.status === "已完成" ? "ok" : item.status === "已取消" || item.status === "爽约" ? "warn" : undefined} />,
      item.note || "-",
    ]);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="预约管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><CalendarDays size={15} /> 预约管理</span>
          <h1>预约记录</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="预约总数" value={`${data.appointments.length} 条`} hint="预约记录" />
          <StatCard title="待到店" value={`${pending} 条`} hint="到店安排" />
          <StatCard title="已完成" value={`${completed} 条`} hint="服务完成" />
          <StatCard title="线上待处理" value={`${onlinePending} 条`} hint="线上预约" />
        </div>
      </section>

      <section className="appointment-page-grid">
        <div className="appointment-panel appointment-board-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title={`${selectedAppointmentRange.label}预约看板`} action={`${rangeAppointments.length} 条`} />
          <div className="appointment-date-strip" aria-label="预约日期筛选">
            {(["today", "tomorrow", "week"] as AppointmentRange[]).map((range) => (
              <button
                aria-pressed={appointmentRange === range}
                className={appointmentRange === range ? "active" : undefined}
                key={range}
                onClick={() => setAppointmentRange(range)}
                type="button"
              >
                {appointmentRanges[range].label}
              </button>
            ))}
          </div>
          <div className="appointment-timeline-board">
            {rangeAppointments.slice(0, 6).map((item) => (
              <article className="appointment-schedule-card" key={item.id}>
                <time>{shortDate(item.startAt)}</time>
                <div>
                  <strong>{nameOf(data.customers, item.customerId)}</strong>
                  <span>{nameOf(data.services, item.serviceId)} · {nameOf(data.staff, item.staffId)}</span>
                  {item.note && <small>{item.note}</small>}
                </div>
                <Badge text={item.status} tone={item.status === "已完成" ? "ok" : item.status === "已取消" || item.status === "爽约" ? "warn" : undefined} />
              </article>
            ))}
            {rangeAppointments.length === 0 && (
              <div className="appointment-empty-state">
                <CalendarDays size={28} />
                <strong>{selectedAppointmentRange.label}暂无预约安排</strong>
              </div>
            )}
          </div>
        </div>

        <div className="appointment-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="预约状态" action="实时汇总" />
          <div className="appointment-status-grid">
            <div>
              <span>{selectedAppointmentRange.label}预约</span>
              <strong>{rangeAppointments.length}</strong>
              <small>当前筛选范围</small>
            </div>
            <div>
              <span>待到店</span>
              <strong>{rangePending}</strong>
              <small>待确认 / 已确认预约</small>
            </div>
            <div>
              <span>已完成</span>
              <strong>{rangeCompleted}</strong>
              <small>服务已结束</small>
            </div>
            <div>
              <span>线上申请</span>
              <strong>{onlinePending}</strong>
              <small>待前台处理</small>
            </div>
          </div>
          <div className="appointment-panel-divider" />
          <PanelTitle icon={<Building2 size={18} />} title="房间使用情况" action={selectedAppointmentRange.label} />
          <div className="appointment-room-summary">
            <div>
              <span>房间总数</span>
              <strong>{roomUsage.availableRoomCount}</strong>
              <small>可预约房间</small>
            </div>
            <div>
              <span>已预约</span>
              <strong>{roomUsage.bookedRoomSlots}</strong>
              <small>房间占用</small>
            </div>
            <div>
              <span>剩余可约</span>
              <strong>{roomUsage.remainingRoomSlots}</strong>
              <small>{roomUsage.dayCount > 1 ? `${roomUsage.dayCount} 天容量` : "今日容量"}</small>
            </div>
            <div>
              <span>维护中</span>
              <strong>{roomUsage.maintenanceRoomCount}</strong>
              <small>暂不可约</small>
            </div>
          </div>
          <div className="appointment-room-list">
            {roomUsage.roomAssignments.map(({ appointment, roomName }) => (
              <article className="appointment-room-card" key={`${appointment.id}-room`}>
                <div>
                  <strong>{roomName}</strong>
                  <span>{nameOf(data.customers, appointment.customerId)}</span>
                </div>
                <time>{shortDate(appointment.startAt)}</time>
              </article>
            ))}
            {roomUsage.roomAssignments.length === 0 && <p className="appointment-soft-empty">暂无房间占用</p>}
          </div>
          <div className="appointment-panel-divider" />
          <PanelTitle icon={<Share2 size={18} />} title="线上预约申请" action={`${onlinePending} 条待处理`} />
          <div className="appointment-request-list">
            {onlinePendingRequests.slice(0, 3).map((request) => (
              <article className="appointment-request-card" key={request.id}>
                <div>
                  <strong>{request.customerName}</strong>
                  <span>{request.phone} · {shortDate(request.preferredAt)}</span>
                </div>
                <Badge text={request.status} />
              </article>
            ))}
            {onlinePendingRequests.length === 0 && <p className="appointment-soft-empty">暂无线上预约申请</p>}
          </div>
        </div>
      </section>

      <section className="appointment-panel">
        <PanelTitle icon={<ClipboardList size={18} />} title={`${selectedAppointmentRange.label}预约列表`} action={`${rangeAppointments.length} 条`} />
        {rows.length > 0 ? (
          <DataTable columns={["预约时间", "客户", "项目", "员工", "状态", "备注"]} rows={rows} />
        ) : (
          <p className="appointment-soft-empty">{selectedAppointmentRange.label}暂无预约记录</p>
        )}
      </section>
    </div>
  );
}

export function PlatformOrdersReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const cashierFlowRecords = buildCashierFlowRecords(data);
  const totalRevenue = cashierFlowRecords.reduce((sum, record) => sum + record.paidAmount, 0);
  const refundAmount = data.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const today = new Date();
  const todayCashierRecords = cashierFlowRecords.filter((record) => new Date(record.createdAt).toDateString() === today.toDateString());
  const todayRevenue = todayCashierRecords.reduce((sum, record) => sum + record.paidAmount, 0);
  const paidOrders = data.orders.filter((order) => order.status === "已支付").length;
  const refundedOrders = data.orders.filter((order) => order.status !== "已支付").length;
  const averageOrderValue = cashierFlowRecords.length ? Math.round(totalRevenue / cashierFlowRecords.length) : 0;
  const recentCashierRecords = cashierFlowRecords.slice(0, 5);
  const payMethodSummary = (["微信", "支付宝", "现金", "银行卡", "会员卡"] as Order["payMethod"][]).map((method) => {
    const methodRecords = cashierFlowRecords.filter((record) => record.payMethod === method);
    return {
      amount: methodRecords.reduce((sum, record) => sum + record.paidAmount, 0),
      count: methodRecords.length,
      method,
    };
  });
  const rows = cashierFlowRecords
    .slice(0, 120)
    .map((record) => [
      record.orderNo,
      record.customerName,
      record.itemName,
      record.staffName,
      record.payMethod,
      money(record.paidAmount),
      <Badge key={`${record.id}-status`} text={record.status} tone={record.status === "已退款" ? "warn" : "ok"} />,
      shortDate(record.createdAt),
    ]);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="开单收银" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><CreditCard size={15} /> 开单收银</span>
          <h1>订单与收款记录</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="实收金额" value={money(totalRevenue)} hint="收款汇总" />
          <StatCard title="流水数" value={`${cashierFlowRecords.length} 笔`} hint="收银记录" />
          <StatCard title="退款金额" value={money(refundAmount)} hint={`${data.refunds.length} 条退款`} />
        </div>
      </section>

      <section className="cashier-page-grid">
        <div className="cashier-panel cashier-board-panel">
          <PanelTitle icon={<CreditCard size={18} />} title="今日收银看板" action={`${todayCashierRecords.length} 笔`} />
          <div className="cashier-revenue-card">
            <span>今日实收</span>
            <strong>{money(todayRevenue)}</strong>
            <small>今日流水 {todayCashierRecords.length} 笔 · 均单 {money(averageOrderValue)}</small>
          </div>
          <div className="cashier-status-grid">
            <div>
              <span>已支付</span>
              <strong>{paidOrders}</strong>
              <small>正常收银订单</small>
            </div>
            <div>
              <span>退款/部分退款</span>
              <strong>{refundedOrders}</strong>
              <small>需关注售后</small>
            </div>
            <div>
              <span>退款金额</span>
              <strong>{money(refundAmount)}</strong>
              <small>{data.refunds.length} 条退款记录</small>
            </div>
          </div>
        </div>

        <div className="cashier-panel">
          <PanelTitle icon={<ChartNoAxesColumnIncreasing size={18} />} title="支付方式汇总" action="收款结构" />
          <div className="cashier-method-list">
            {payMethodSummary.map((item) => (
              <article key={item.method}>
                <div>
                  <strong>{item.method}</strong>
                  <span>{item.count} 笔</span>
                </div>
                <em>{money(item.amount)}</em>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cashier-page-grid lower">
        <div className="cashier-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="最近流水" action="最新 5 笔" />
          <div className="cashier-order-list">
            {recentCashierRecords.map((record) => (
              <article className="cashier-order-card" key={record.id}>
                <div>
                  <strong>{record.orderNo}</strong>
                  <span>{record.customerName} · {record.itemName}</span>
                  <small>{record.payMethod} · {shortDate(record.createdAt)}</small>
                </div>
                <div>
                  <em>{money(record.paidAmount)}</em>
                  <Badge text={record.status} tone={record.status === "已退款" ? "warn" : "ok"} />
                </div>
              </article>
            ))}
            {recentCashierRecords.length === 0 && <p className="cashier-soft-empty">暂无收银流水</p>}
          </div>
        </div>

        <div className="cashier-panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="收款概览" action="经营指标" />
          <div className="cashier-tip-list">
            <div>
              <span>到店未收银</span>
              <strong>{data.appointments.filter((appointment) => appointment.status === "已到店").length} 条</strong>
              <small>到店服务与收款衔接</small>
            </div>
            <div>
              <span>有效会员卡</span>
              <strong>{data.memberCards.filter((card) => card.status === "正常").length} 张</strong>
              <small>项目卡规模</small>
            </div>
          </div>
        </div>
      </section>

      <section className="cashier-panel">
        <PanelTitle icon={<CreditCard size={18} />} title="收银流水" action={`${cashierFlowRecords.length} 笔`} />
        {rows.length > 0 ? (
          <DataTable columns={["流水", "客户", "内容", "员工", "支付方式", "实收", "状态", "时间"]} rows={rows} />
        ) : (
          <p className="cashier-soft-empty">暂无收银流水</p>
        )}
      </section>
    </div>
  );
}

export function PlatformCustomersReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [activeModule, setActiveModule] = useState<"profile" | "cards" | "records" | "signature" | undefined>();
  const [selectedSignatureId, setSelectedSignatureId] = useState("");
  const activeCards = data.memberCards.filter((card) => card.status === "正常").length;
  const totalRemainingTimes = data.memberCards.reduce((sum, card) => sum + card.remainingTimes, 0);
  const pendingFollowUps = data.customerFollowUps.filter((item) => item.status === "待跟进").length;
  const pendingSignatures = data.customerSignatures.filter((item) => item.status === "待签名").length;
  const rows = data.customers.slice(0, 120).map((customer) => [
    customer.name,
    customer.phone,
    shortDate(customer.lastVisit),
    `${data.memberCards.filter((card) => card.customerId === customer.id).length} 张`,
    `${data.customerServiceRecords.filter((record) => record.customerId === customer.id).length} 条`,
    `${data.customerSignatures.filter((signature) => signature.customerId === customer.id).length} 份`,
  ]);
  const cardRows = data.memberCards.slice(0, 120).map((card) => [
    nameOf(data.customers, card.customerId),
    card.name,
    card.type,
    money(card.balance),
    memberCardTimesText(card, data.services),
    <Badge key={`${card.id}-status`} text={card.status} tone={card.status === "正常" ? "ok" : "warn"} />,
    shortDate(card.expiresAt),
  ]);
  type PlatformCustomerModuleKey = NonNullable<typeof activeModule>;
  const customerModules: Array<FeatureModule<PlatformCustomerModuleKey>> = [
    { key: "profile", title: "客户档案", desc: "客户资料和客户列表", icon: UsersRound, tone: "violet", meta: `${data.customers.length} 位` },
    { key: "cards", title: "项目次数卡", desc: "储值卡、次数卡和套餐卡", icon: CreditCard, tone: "rose", meta: `${activeCards} 张` },
    { key: "records", title: "服务记录", desc: "护理过程和回访计划", icon: ClipboardList, tone: "jade", meta: `${data.customerServiceRecords.length} 条` },
    { key: "signature", title: "服务确认签名", desc: "", icon: LockKeyhole, tone: "plum", meta: `${data.customerSignatures.length} 份` },
  ];
  const activeModuleTitle = activeModule ? customerModules.find((item) => item.key === activeModule)?.title ?? "功能模块" : "";
  const selectedSignature = data.customerSignatures.find((signature) => signature.id === selectedSignatureId);

  return (
    <div className="page-stack customer-module-page module-hub">
      {showBack && <PlatformPageTitle title="客户档案" onBack={() => setView("settings")} />}
      <PageHero
        icon={<HeartHandshake size={15} />}
        eyebrow="客户档案"
        title="客户服务档案"
        stats={[
          { label: "客户总数", value: `${data.customers.length} 人`, hint: "客户档案", icon: <UsersRound size={18} /> },
          { label: "项目卡", value: `${data.memberCards.length} 张`, hint: `${totalRemainingTimes} 次可核销`, icon: <CreditCard size={18} /> },
          { label: "待签名", value: `${pendingSignatures} 份`, hint: "服务确认", icon: <LockKeyhole size={18} /> },
        ]}
      />
      <ModuleOverview modules={customerModules} activeKey={activeModule} onSelect={setActiveModule} />
      <Modal
        open={Boolean(activeModule)}
        title={activeModuleTitle || "客户档案"}
        subtitle="客户资料、项目卡和服务确认记录"
        size="large"
        onClose={() => setActiveModule(undefined)}
      >
      <div className="module-detail-stack customer-modal-detail">
        {activeModule === "profile" && (
          <section className="panel">
            <PanelTitle icon={<UsersRound size={18} />} title="客户列表" action={`${data.customers.length} 位客户`} />
            {rows.length > 0 ? (
              <DataTable columns={["客户", "手机", "最近到店", "项目卡", "服务记录", "签名"]} rows={rows} />
            ) : (
              <p className="customer-soft-empty">暂无客户列表</p>
            )}
          </section>
        )}
        {activeModule === "cards" && (
          <section className="panel">
            <PanelTitle icon={<CreditCard size={18} />} title="项目卡列表" action="余额/次数/状态" />
            {cardRows.length > 0 ? (
              <DataTable columns={["客户", "卡名", "类型", "余额", "次数", "状态", "有效期"]} rows={cardRows} />
            ) : (
              <p className="customer-soft-empty">暂无项目卡列表</p>
            )}
          </section>
        )}
        {activeModule === "records" && (
          <>
            <section className="panel">
              <PanelTitle icon={<ClipboardList size={18} />} title="服务记录" action={`${data.customerServiceRecords.length} 条`} />
              <DataTable
                columns={["客户", "员工", "项目", "订单", "卡项消耗", "护理步骤", "客户反馈", "下次建议", "时间"]}
                rows={data.customerServiceRecords.map((record) => [
                  nameOf(data.customers, record.customerId),
                  nameOf(data.staff, record.staffId),
                  nameOf(data.services, record.serviceId),
                  record.orderId ? data.orders.find((order) => order.id === record.orderId)?.orderNo ?? record.orderId : "未关联",
                  record.memberCardTransactionId ? "已关联项目卡核销" : "未扣卡",
                  record.careSteps || "未记录",
                  record.customerFeedback || "未记录",
                  record.nextCareAdvice || "未记录",
                  shortDate(record.createdAt),
                ])}
              />
            </section>
            <section className="panel">
              <PanelTitle icon={<MessageCircle size={18} />} title="客户跟进" action={`${pendingFollowUps} 位待跟进`} />
              <DataTable
                columns={["客户", "员工", "方式", "计划时间", "状态", "备注"]}
                rows={data.customerFollowUps.map((followUp) => [
                  nameOf(data.customers, followUp.customerId),
                  nameOf(data.staff, followUp.staffId),
                  followUp.method,
                  shortDate(followUp.dueAt),
                  <Badge key={`${followUp.id}-status`} text={followUp.status} />,
                  followUp.note,
                ])}
              />
            </section>
          </>
        )}
        {activeModule === "signature" && (
          <section className="panel">
            <PanelTitle icon={<LockKeyhole size={18} />} title="服务签名记录" action={`${data.customerSignatures.length} 份`} />
            <DataTable
              columns={["客户", "服务项目", "状态", "签名人", "签名时间", "关联记录", "操作"]}
              rows={data.customerSignatures.map((signature) => {
                const context = signatureRecordContext(data, signature);
                return [
                  context.customerName,
                  context.serviceName,
                  <Badge key={`${signature.id}-status`} text={signature.status} tone={signature.status === "已签名" ? "ok" : "warn"} />,
                  signature.signerName ?? "-",
                  signature.signedAt ? shortDate(signature.signedAt) : "-",
                  context.orderNo !== "-" ? context.orderNo : signature.serviceRecordId ? "服务档案" : "未关联",
                  <button key={`${signature.id}-detail`} type="button" onClick={() => setSelectedSignatureId(signature.id)}>
                    查看详情
                  </button>,
                ];
              })}
            />
            {selectedSignature && <SignatureRecordDetail data={data} signature={selectedSignature} />}
          </section>
        )}
      </div>
      </Modal>
    </div>
  );
}

export function PlatformCatalogReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="项目商品" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><PackagePlus size={15} /> 项目商品</span>
          <h1>项目商品资料</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="服务项目" value={`${data.services.length} 项`} hint="门店服务" />
          <StatCard title="商品资料" value={`${data.products.length} 项`} hint="库存商品" />
          <StatCard title="使用商品" value={`${data.services.filter((item) => serviceConsumablesOf(item).length > 0).length} 项`} hint="商品耗材" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="服务项目" action={`${data.services.length} 项`} />
          <DataTable
            columns={["项目", "分类", "价格", "时长", "可用次数", "使用商品"]}
            rows={data.services.map((service) => [
              service.name,
              service.category,
              money(service.price),
              `${service.duration} 分钟`,
              `${service.defaultTimes ?? 1} 次`,
              serviceFormulaSummary(service, data.products),
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Boxes size={18} />} title="商品资料" action={`${data.products.length} 项`} />
          <DataTable
            columns={["商品", "大类", "小类", "单位", "售价", "成本", "库存"]}
            rows={data.products.map((product) => [
              product.name,
              product.category ?? "面护类",
              product.subcategory ?? "-",
              product.unit,
              money(product.price),
              money(product.cost),
              `${product.stock} ${product.unit}`,
            ])}
          />
        </div>
      </section>
    </div>
  );
}

export function PlatformStaffReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const staffRows = businessStaffOf(data);
  const staffIds = new Set(staffRows.map((staff) => staff.id));
  const activeStaff = staffRows.filter((item) => item.status === "active").length;
  const pendingCommission = data.commissions.filter((item) => staffIds.has(item.staffId) && item.status === "待结算").reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="员工提成" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><BadgeCent size={15} /> 员工提成</span>
          <h1>员工、邀请码与提成</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="员工数" value={`${staffRows.length} 人`} hint={`${activeStaff} 人启用`} />
          <StatCard title="待结算提成" value={money(pendingCommission)} hint="员工提成合计" />
          <StatCard title="员工邀请码" value={`${data.staffInvites.length} 个`} hint="邀请码状态" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<UsersRound size={18} />} title="员工列表" action={`${staffRows.length} 人`} />
          <DataTable
            columns={["姓名", "手机", "岗位", "状态", "底薪", "提成比例"]}
            rows={staffRows.map((staff) => [
              staff.name,
              staff.phone,
              displayStaffRole(staff.role),
              <Badge key={`${staff.id}-status`} text={staff.status === "active" ? "启用" : "停用"} tone={staff.status === "active" ? "ok" : "warn"} />,
              money(staff.baseSalary ?? 0),
              `${staff.commissionRate ?? 0}%`,
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="提成流水" action={`${data.commissions.length} 条`} />
          <DataTable
            columns={["员工", "类型", "基数", "比例", "金额", "状态", "时间"]}
            rows={data.commissions.filter((commission) => staffIds.has(commission.staffId)).map((commission) => [
              nameOf(data.staff, commission.staffId),
              commission.type,
              money(commission.baseAmount),
              `${commission.rate}%`,
              money(commission.amount),
              <Badge key={`${commission.id}-status`} text={commission.status} tone={commission.status === "已结算" ? "ok" : undefined} />,
              shortDate(commission.createdAt),
            ])}
          />
        </div>
      </section>
    </div>
  );
}

export function PlatformInventoryReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const lowStock = data.products.filter((item) => item.stock <= item.warningStock);
  const stockTotal = data.products.reduce((sum, item) => sum + item.stock, 0);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="库存管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><Boxes size={15} /> 库存管理</span>
          <h1>库存预警与流水</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="商品数" value={`${data.products.length} 项`} hint="库存商品" />
          <StatCard title="低库存" value={`${lowStock.length} 项`} hint="低于预警线" />
          <StatCard title="库存合计" value={`${stockTotal}`} hint="所有库存数量" />
        </div>
      </section>
      <section className="dashboard-columns">
        <div className="panel dashboard-panel">
          <PanelTitle icon={<Boxes size={18} />} title="库存状态" action={`${data.products.length} 项`} />
          <DataTable
            columns={["商品", "大类", "小类", "库存", "预警线", "单位", "状态"]}
            rows={data.products.map((product) => [
              product.name,
              product.category ?? "面护类",
              product.subcategory ?? "-",
              product.stock,
              product.warningStock,
              product.unit,
              <Badge key={`${product.id}-stock`} text={product.stock <= product.warningStock ? "低库存" : "正常"} tone={product.stock <= product.warningStock ? "warn" : "ok"} />,
            ])}
          />
        </div>
        <div className="panel dashboard-panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="库存流水" action={`${data.inventoryLogs.length} 条`} />
          <DataTable
            columns={["时间", "商品", "类型", "变动", "库存后", "备注"]}
            rows={data.inventoryLogs.slice(0, 120).map((log) => [
              shortDate(log.createdAt),
              nameOf(data.products, log.productId),
              log.type,
              log.delta,
              log.stockAfter,
              log.note || "-",
            ])}
          />
        </div>
      </section>
    </div>
  );
}

export function PlatformApprovalsReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const pending = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const passed = data.approvalRequests.filter((item) => item.status === "已通过").length;
  const rejected = data.approvalRequests.filter((item) => item.status === "已拒绝").length;

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="审批中心" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={15} /> 审批中心</span>
          <h1>关键审批记录</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="待审批" value={`${pending} 单`} hint="待处理" />
          <StatCard title="已通过" value={`${passed} 单`} hint="历史通过" />
          <StatCard title="已拒绝" value={`${rejected} 单`} hint="历史拒绝" />
        </div>
      </section>
      <section className="panel dashboard-panel">
        <PanelTitle icon={<ShieldCheck size={18} />} title="审批记录" action={`${data.approvalRequests.length} 条`} />
        <DataTable
          columns={["类型", "目标", "金额", "原因", "申请人", "状态", "申请时间", "处理时间"]}
          rows={data.approvalRequests.map((request) => [
            request.type,
            request.targetId,
            money(request.amount),
            request.reason,
            data.authUsers.find((user) => user.id === request.requestedBy)?.name ?? "系统",
            <Badge key={`${request.id}-status`} text={request.status} tone={request.status === "已通过" ? "ok" : request.status === "已拒绝" ? "warn" : undefined} />,
            shortDate(request.createdAt),
            request.approvedAt ? shortDate(request.approvedAt) : "-",
          ])}
        />
      </section>
    </div>
  );
}

export function PlatformAccountAdminView({
  data,
  session,
  setView,
  showBack,
  actions,
  runMutation,
}: {
  data: AppData;
  session: UserSession;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  actions: ApiActions;
  runMutation: RunMutation;
}) {
  const mutationPending = useMutationPending();
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("123456");
  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState(30);
  const [accountSearch, setAccountSearch] = useState("");
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(() => new Set());
  const visibleAuthUsers = data.authUsers.filter(isVisibleAccount);
  const isPlatformAdmin = session.user.role === "superadmin";
  const adminAccounts = visibleAuthUsers.filter(isVisiblePlatformAdmin);
  const ownerAccounts = visibleAuthUsers.filter((user) => user.role === "owner" && !isVisiblePlatformAdmin(user));
  const staffAccounts = visibleAuthUsers.filter((user) => ["manager", "frontdesk", "therapist", "finance"].includes(user.role));
  const accountRows = isPlatformAdmin ? visibleAuthUsers : staffAccounts;
  const resetUser = accountRows.find((user) => user.id === resetUserId);
  const creditUser = visibleAuthUsers.find((user) => user.id === creditUserId);
  const normalizedAccountSearch = accountSearch.trim().toLowerCase();
  const staffById = new Map(data.staff.map((staff) => [staff.id, staff]));
  const storeIdForAccount = (user: AuthUser) => user.storeId ?? (user.staffId ? staffById.get(user.staffId)?.storeId : undefined);
  const accountPhone = (user: AuthUser) => (user.staffId ? staffById.get(user.staffId)?.phone : undefined) || user.account;
  const accountSearchTarget = (user: AuthUser) => {
    const linkedStaff = user.staffId ? staffById.get(user.staffId) : undefined;
    return `${user.name} ${user.account} ${displayRoleName(user)} ${linkedStaff?.phone ?? ""}`.toLowerCase();
  };
  const storeSearchTarget = (store: AppData["storeProfiles"][number]) => `${store.name} ${store.phone}`.toLowerCase();
  const visibleAdminAccounts = normalizedAccountSearch
    ? adminAccounts.filter((user) => accountSearchTarget(user).includes(normalizedAccountSearch))
    : adminAccounts;
  const toggleStoreAccounts = (storeId: string) => {
    setExpandedStoreIds((current) => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };
  const submitPasswordReset = (event: FormEvent) => {
    event.preventDefault();
    if (!resetUserId || !resetPassword.trim()) return;
    void runMutation(() => actions.resetAuthUserPassword(resetUserId, resetPassword.trim())).then(() => {
      setResetUserId("");
      setResetPassword("123456");
    });
  };
  const submitAiCredits = (event: FormEvent) => {
    event.preventDefault();
    if (!creditUserId) return;
    void runMutation(() => actions.updateAuthUserAiCredits(creditUserId, creditAmount)).then(() => {
      setCreditUserId("");
      setCreditAmount(30);
    });
  };
  const deleteLinkedStaff = (user: AuthUser) => {
    const staffId = user.staffId;
    if (!staffId) return;
    if (!window.confirm(`确定删除员工 ${user.name}？已有订单/预约记录的员工不能删除，只能停用。`)) return;
    void runMutation(() => actions.deleteStaff(staffId));
  };
  const renderAccountActions = (user: AuthUser) => (
    user.id === session.user.id ? (
      <span key={`${user.id}-self`}>当前账号</span>
    ) : (
      <div className="row-actions" key={`${user.id}-actions`}>
        {user.status === "pending" && (
          <button type="button" disabled={mutationPending} onClick={() => void runMutation(() => actions.updateAuthUserStatus(user.id, "active"))}>
            {mutationPending ? "处理中..." : "通过"}
          </button>
        )}
        {user.status !== "pending" && (
          <button type="button" disabled={mutationPending} onClick={() => void runMutation(() => actions.updateAuthUserStatus(user.id, user.status === "active" ? "disabled" : "active"))}>
            {mutationPending ? "处理中..." : user.status === "active" ? "停用" : "启用"}
          </button>
        )}
        <button type="button" disabled={mutationPending} onClick={() => setResetUserId(user.id)}>重置密码</button>
        {isPlatformAdmin && <button type="button" disabled={mutationPending} onClick={() => { setCreditUserId(user.id); setCreditAmount(accountAiCredits(user.aiCredits)); }}>AI充值</button>}
        {user.staffId && user.role !== "owner" && <button type="button" disabled={mutationPending} onClick={() => deleteLinkedStaff(user)}>删除员工</button>}
      </div>
    )
  );
  const groupedStoreAccounts = data.storeProfiles
    .map((store) => {
      const storeAccounts = visibleAuthUsers.filter((user) => !isVisiblePlatformAdmin(user) && storeIdForAccount(user) === store.id);
      const ownerStaff = data.staff.find((staff) => staff.role === "老板" && staff.storeId === store.id);
      const ownerUser = ownerAccounts.find((user) => storeIdForAccount(user) === store.id)
        ?? (ownerStaff ? visibleAuthUsers.find((user) => user.staffId === ownerStaff.id) : undefined);
      const visibleAccounts = normalizedAccountSearch
        ? storeAccounts.filter((user) => accountSearchTarget(user).includes(normalizedAccountSearch))
        : storeAccounts;
      const matchesStore = normalizedAccountSearch ? storeSearchTarget(store).includes(normalizedAccountSearch) : true;
      return { store, ownerUser, accounts: storeAccounts, visibleAccounts, isSearchMatch: matchesStore || visibleAccounts.length > 0 };
    })
    .filter((group) => !normalizedAccountSearch || group.isSearchMatch);
  const totalVisibleStoreAccounts = groupedStoreAccounts.reduce((sum, group) => sum + group.visibleAccounts.length, 0);

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="账号管理" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><UsersRound size={15} /> {isPlatformAdmin ? "平台账号" : "门店账号"}</span>
          <h1>账号管理</h1>
        </div>
        <div className="page-hero-stats">
          {isPlatformAdmin && <StatCard title="系统管理员" value={`${adminAccounts.length} 个`} hint="平台管理员" />}
          {isPlatformAdmin && <StatCard title="门店账号" value={`${ownerAccounts.length} 个`} hint="负责人账号" />}
          <StatCard title="员工账号" value={`${staffAccounts.length} 个`} hint="门店成员账号" />
          <StatCard title="待审核" value={`${staffAccounts.filter((user) => user.status === "pending").length} 个`} hint="需店长通过" />
        </div>
      </section>

      <section className="account-admin-stack">
        <div className="panel dashboard-panel">
          <PanelTitle
            icon={<UsersRound size={18} />}
            title={isPlatformAdmin ? "账号列表" : "员工账号"}
            action={isPlatformAdmin ? `${data.storeProfiles.length} 家门店 · ${ownerAccounts.length + staffAccounts.length} 个门店账号` : `${staffAccounts.length} 个账号`}
          />
          <label className="account-admin-search">
            <Search size={17} />
            <input value={accountSearch} {...searchInputSync(setAccountSearch)} placeholder="搜索姓名 / 手机号 / 登录账号 / 门店名" />
          </label>
          {resetUser && (
            <form className="staff-edit-form" onSubmit={submitPasswordReset}>
              <div className="staff-edit-head">
                <strong>重置密码</strong>
                <span>{resetUser.name} · {resetUser.account}</span>
              </div>
              <label>新密码<input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required /></label>
              <div className="staff-edit-actions">
                <SubmitStatusButton idleText="确认重置" busyText="重置中..." />
                <button type="button" onClick={() => setResetUserId("")}>取消</button>
              </div>
            </form>
          )}
          {isPlatformAdmin && creditUser && (
            <form className="staff-edit-form" onSubmit={submitAiCredits}>
              <div className="staff-edit-head">
                <strong>AI积分充值</strong>
                <span>{creditUser.name} · {creditUser.account}</span>
              </div>
              <label>账号积分<input type="number" min={0} max={99999} step={0.01} value={creditAmount} onChange={(event) => setCreditAmount(Number(event.target.value))} required /></label>
              <div className="staff-edit-actions">
                <SubmitStatusButton idleText="保存积分" busyText="保存中..." />
                <button type="button" onClick={() => setCreditUserId("")}>取消</button>
              </div>
            </form>
          )}
          {isPlatformAdmin ? (
            <div className="store-account-admin">
              {visibleAdminAccounts.length > 0 && (
                <div className="platform-account-block">
                  <div className="store-account-block-title"><strong>平台账号</strong><span>{visibleAdminAccounts.length} 个</span></div>
                  <DataTable
                    columns={["姓名", "账号", "角色", "AI积分", "状态", "创建时间", "操作"]}
                    rows={visibleAdminAccounts.map((user) => [
                      user.name,
                      user.account,
                      displayRoleName(user),
                      formatAiCreditAmount(accountAiCredits(user.aiCredits)),
                      <Badge key={`${user.id}-status`} text={displayAuthUserStatus(user.status)} tone={authUserStatusTone(user.status)} />,
                      shortDate(user.createdAt),
                      renderAccountActions(user),
                    ])}
                  />
                </div>
              )}
              <div className="store-account-list">
                {groupedStoreAccounts.length ? groupedStoreAccounts.map(({ store, ownerUser, accounts, visibleAccounts }) => {
                  const ownerPhone = ownerUser ? accountPhone(ownerUser) : store.phone;
                  const searchExpanded = Boolean(normalizedAccountSearch && visibleAccounts.length > 0);
                  const isExpanded = expandedStoreIds.has(store.id) || searchExpanded;
                  const rows = normalizedAccountSearch ? visibleAccounts : accounts;
                  return (
                    <article className="store-account-card" key={store.id}>
                      <button type="button" className="store-account-summary" onClick={() => toggleStoreAccounts(store.id)}>
                        <div>
                          <strong>{store.name}</strong>
                          <span>负责人：{ownerUser?.name ?? "未绑定"} · {ownerPhone || "未绑定"}</span>
                        </div>
                        <div className="store-account-meta">
                          <span>{accounts.length} 个账号</span>
                          <Badge text={(store.status ?? "active") === "active" ? "启用" : "停用"} tone={(store.status ?? "active") === "active" ? "ok" : "warn"} />
                          <small>{shortDate(store.createdAt)}</small>
                          <em>{isExpanded ? "收起" : "展开"}{isExpanded ? <Minus size={15} /> : <Plus size={15} />}</em>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="store-account-detail">
                          <DataTable
                            columns={["姓名", "手机号 / 账号", "角色", "AI积分", "状态", "创建时间", "操作"]}
                            rows={rows.map((user) => [
                              user.name,
                              accountPhone(user),
                              displayRoleName(user),
                              formatAiCreditAmount(accountAiCredits(user.aiCredits)),
                              <Badge key={`${user.id}-status`} text={displayAuthUserStatus(user.status)} tone={authUserStatusTone(user.status)} />,
                              shortDate(user.createdAt),
                              renderAccountActions(user),
                            ])}
                          />
                        </div>
                      )}
                    </article>
                  );
                }) : <p className="empty">没有找到匹配的门店或账号</p>}
              </div>
              {normalizedAccountSearch && groupedStoreAccounts.length > 0 && (
                <p className="account-search-result">已匹配 {groupedStoreAccounts.length} 家门店 · {totalVisibleStoreAccounts} 个账号</p>
              )}
            </div>
          ) : (
            <DataTable
              columns={["姓名", "账号", "角色", "AI积分", "状态", "创建时间", "操作"]}
              rows={staffAccounts
                .filter((user) => !normalizedAccountSearch || accountSearchTarget(user).includes(normalizedAccountSearch))
                .map((user) => [
                  user.name,
                  user.account,
                  displayRoleName(user),
                  formatAiCreditAmount(accountAiCredits(user.aiCredits)),
                  <Badge key={`${user.id}-status`} text={displayAuthUserStatus(user.status)} tone={authUserStatusTone(user.status)} />,
                  shortDate(user.createdAt),
                  renderAccountActions(user),
                ])}
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function PlatformAiCreditsView({
  data,
  session,
  setView,
  actions,
  runMutation,
}: {
  data: AppData;
  session: UserSession;
  setView: (view: ViewKey) => void;
  actions: ApiActions;
  runMutation: RunMutation;
}) {
  const mutationPending = useMutationPending();
  const [accountSearch, setAccountSearch] = useState("");
  const [creditFilter, setCreditFilter] = useState<"all" | "credited" | "empty" | "low">("all");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [topUpAmount, setTopUpAmount] = useState(10);
  const isPlatformAdmin = session.user.role === "superadmin";
  const visibleAuthUsers = data.authUsers.filter(isVisibleAccount);
  const staffById = new Map(data.staff.map((staff) => [staff.id, staff]));
  const storeById = new Map(data.storeProfiles.map((store) => [store.id, store]));
  const normalizedSearch = accountSearch.trim().toLowerCase();
  const storeIdForAccount = (user: AuthUser) => user.storeId ?? (user.staffId ? staffById.get(user.staffId)?.storeId : undefined);
  const accountPhone = (user: AuthUser) => (user.staffId ? staffById.get(user.staffId)?.phone : undefined) || user.account;
  const latestRecordAt = (userId: string) => {
    const timestamp = (data.marketingAiRecords ?? [])
      .filter((record) => record.createdBy === userId)
      .map((record) => new Date(record.createdAt).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    return timestamp ? shortDate(new Date(timestamp).toISOString()) : "-";
  };
  const accountRows = visibleAuthUsers
    .map((user) => {
      const storeId = storeIdForAccount(user);
      const storeName = storeId ? storeById.get(storeId)?.name ?? "未绑定门店" : isVisiblePlatformAdmin(user) ? "平台账号" : "未绑定门店";
      const credits = accountAiCredits(user.aiCredits);
      const quota = aiFreeQuotaState(data, user.id);
      const searchText = `${user.name} ${user.account} ${accountPhone(user)} ${displayRoleName(user)} ${storeName}`.toLowerCase();
      return { user, storeName, credits, quota, searchText, lastRecordAt: latestRecordAt(user.id) };
    })
    .filter((row) => !normalizedSearch || row.searchText.includes(normalizedSearch))
    .filter((row) => {
      if (creditFilter === "credited") return row.credits > 0;
      if (creditFilter === "empty") return row.credits <= 0;
      if (creditFilter === "low") return row.credits > 0 && row.credits <= 3;
      return true;
    });
  const selectedRow = accountRows.find((row) => row.user.id === selectedUserId)
    ?? visibleAuthUsers
      .map((user) => {
        const storeId = storeIdForAccount(user);
        const storeName = storeId ? storeById.get(storeId)?.name ?? "未绑定门店" : isVisiblePlatformAdmin(user) ? "平台账号" : "未绑定门店";
        return { user, storeName, credits: accountAiCredits(user.aiCredits), quota: aiFreeQuotaState(data, user.id), searchText: "", lastRecordAt: latestRecordAt(user.id) };
      })
      .find((row) => row.user.id === selectedUserId);
  const creditedAccounts = visibleAuthUsers.filter((user) => accountAiCredits(user.aiCredits) > 0).length;
  const emptyAccounts = visibleAuthUsers.length - creditedAccounts;
  const lowCreditAccounts = visibleAuthUsers.filter((user) => {
    const credits = accountAiCredits(user.aiCredits);
    return credits > 0 && credits <= 3;
  }).length;
  const totalCredits = visibleAuthUsers.reduce((sum, user) => sum + accountAiCredits(user.aiCredits), 0);
  const submitTopUp = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRow) return;
    const amount = Math.max(0, Number(topUpAmount) || 0);
    if (amount <= 0) return;
    const nextCredits = selectedRow.credits + amount;
    void runMutation(() => actions.updateAuthUserAiCredits(selectedRow.user.id, nextCredits)).then(() => {
      setTopUpAmount(10);
    });
  };
  const selectForTopUp = (userId: string) => {
    setSelectedUserId(userId);
    setTopUpAmount(10);
  };

  if (!isPlatformAdmin) {
    return (
      <div className="admin-center-page platform-admin-page">
        <PlatformPageTitle title="AI积分充值" onBack={() => setView("settings")} />
        <section className="panel dashboard-panel">
          <p className="empty">当前账号没有 AI 积分充值权限。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-center-page platform-admin-page">
      <PlatformPageTitle title="AI积分充值" onBack={() => setView("settings")} />
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><BadgeCent size={15} /> 平台充值</span>
          <h1>AI积分充值</h1>
          <p>给门店老板、店长、员工账号充值 AI 积分，生成成功后按实际费用扣积分。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="账号总数" value={`${visibleAuthUsers.length} 个`} hint="可充值账号" />
          <StatCard title="已充值账号" value={`${creditedAccounts} 个`} hint="积分大于 0" />
          <StatCard title="低积分账号" value={`${lowCreditAccounts} 个`} hint="剩余 1-3 积分" />
          <StatCard title="当前总积分" value={formatAiCreditAmount(totalCredits)} hint="全系统余额" />
        </div>
      </section>

      <section className="ai-credit-layout">
        <div className="panel dashboard-panel ai-credit-recharge-panel">
          <PanelTitle icon={<BadgeCent size={18} />} title="充值操作" action={selectedRow ? "已选择账号" : "先选择账号"} />
          {selectedRow ? (
            <form className="ai-credit-form" onSubmit={submitTopUp}>
              <div className="ai-credit-selected-card">
                <div>
                  <strong>{selectedRow.user.name}</strong>
                  <span>{selectedRow.storeName} · {displayRoleName(selectedRow.user)} · {accountPhone(selectedRow.user)}</span>
                </div>
                <b>{formatAiCreditAmount(selectedRow.credits)}</b>
              </div>
              <label>
                充值积分
                <input type="number" min={0.01} max={99999} step={0.01} value={topUpAmount} onChange={(event) => setTopUpAmount(Number(event.target.value))} required />
              </label>
              <div className="ai-credit-quick-row" aria-label="快捷充值">
                {[10, 30, 100, 300].map((amount) => (
                  <button type="button" key={amount} onClick={() => setTopUpAmount(amount)}>
                    +{amount}
                  </button>
                ))}
              </div>
              <div className="ai-credit-after">
                充值后：<strong>{formatAiCreditAmount(selectedRow.credits + Math.max(0, Number(topUpAmount) || 0))}</strong>
              </div>
              <div className="staff-edit-actions">
                <SubmitStatusButton idleText="确认充值" busyText="充值中..." disabled={mutationPending || !selectedRow || topUpAmount <= 0} />
                <button type="button" onClick={() => setSelectedUserId("")}>取消</button>
              </div>
            </form>
          ) : (
            <div className="ai-credit-empty-state">
              <BadgeCent size={28} />
              <strong>选择一个账号开始充值</strong>
              <span>右侧账号列表里点“充值”，这里会显示当前积分和充值后积分。</span>
            </div>
          )}
        </div>

        <div className="panel dashboard-panel ai-credit-accounts-panel">
          <PanelTitle icon={<UsersRound size={18} />} title="账号积分" action={`${accountRows.length} 个账号`} />
          <div className="ai-credit-toolbar">
            <label className="account-admin-search">
              <Search size={17} />
              <input value={accountSearch} {...searchInputSync(setAccountSearch)} placeholder="搜索姓名 / 手机号 / 登录账号 / 门店名" />
            </label>
            <div className="ai-credit-filter-row" aria-label="积分筛选">
              {[
                { key: "all" as const, label: "全部" },
                { key: "credited" as const, label: "有积分" },
                { key: "empty" as const, label: `未充值 ${emptyAccounts}` },
                { key: "low" as const, label: `低积分 ${lowCreditAccounts}` },
              ].map((item) => (
                <button type="button" key={item.key} className={creditFilter === item.key ? "active" : ""} onClick={() => setCreditFilter(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={["账号", "门店", "角色", "AI积分", "今日免费", "最近生成", "操作"]}
            rows={accountRows.map((row) => [
              <div className="ai-credit-account-cell" key={`${row.user.id}-account`}>
                <strong>{row.user.name}</strong>
                <span>{accountPhone(row.user)}</span>
              </div>,
              row.storeName,
              displayRoleName(row.user),
              <Badge key={`${row.user.id}-credits`} text={formatAiCreditAmount(row.credits)} tone={row.credits > 3 ? "ok" : row.credits > 0 ? "warn" : undefined} />,
              row.credits > 0 ? "积分账号" : `${row.quota.used}/${row.quota.limit}`,
              row.lastRecordAt,
              <div className="row-actions" key={`${row.user.id}-actions`}>
                <button type="button" disabled={mutationPending} onClick={() => selectForTopUp(row.user.id)}>
                  充值
                </button>
              </div>,
            ])}
          />
          {accountRows.length === 0 && <p className="empty">没有找到匹配账号</p>}
        </div>
      </section>
    </div>
  );
}

export function PlatformPermissionReadOnlyView({
  data,
  setView,
  showBack,
  actions,
  runMutation,
}: {
  data: AppData;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  actions: ApiActions;
  runMutation: (mutation: () => Promise<AppData>) => Promise<AppData>;
}) {
  const mutationPending = useMutationPending();
  const pendingApprovals = data.approvalRequests.filter((item) => item.status === "待审批").length;
  const pendingStaffInvites = data.staffInvites.filter((item) => item.status === "待加入").length;
  const storeOwnerApplications = data.storeOwnerApplications ?? [];
  const pendingOwnerApplications = storeOwnerApplications.filter((item) => item.status === "待审批").length;
  const currentTemplates = parseRolePermissionTemplates(data.systemConfigs);
  const [draftTemplates, setDraftTemplates] = useState(currentTemplates);
  const [savedPermissions, setSavedPermissions] = useState(false);

  useEffect(() => {
    setDraftTemplates(parseRolePermissionTemplates(data.systemConfigs));
  }, [data.systemConfigs]);

  const setRoleTemplate = (role: UserRole, permissions: string[]) => {
    setDraftTemplates((current) => ({
      ...current,
      [role]: permissions as Permission[],
    }));
  };
  const saveRoleTemplates = () => {
    void runMutation(() => actions.updateSystemConfig("role_permissions", serializeRolePermissionTemplates(draftTemplates))).then(() => {
      setSavedPermissions(true);
      window.setTimeout(() => setSavedPermissions(false), 1400);
    });
  };
  const roleRows = (Object.entries(draftTemplates) as Array<[UserRole, Permission[]]>).map(([role, permissions]) => [
    displayUserRole(role),
    permissions.map((permission) => permissionLabels[permission]).join("、"),
    roleScopeLabels[role],
  ]);

  return (
    <div className="admin-center-page platform-admin-page permission-admin-page">
      {showBack && <PlatformPageTitle title="权限审批" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ShieldCheck size={15} /> 权限审批</span>
          <h1>权限与授权记录</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="待审批" value={`${pendingApprovals} 单`} hint="关键审批" />
          <StatCard title="员工邀请码" value={`${pendingStaffInvites} 个`} hint="待加入" />
          <StatCard title="门店申请" value={`${pendingOwnerApplications} 个`} hint="待审批" />
        </div>
      </section>

      <section className="permission-dashboard-grid">
        <div className="panel dashboard-panel permission-store-card">
          <PanelTitle icon={<Building2 size={18} />} title="门店申请" action={`${storeOwnerApplications.length} 条`} />
          <DataTable
            columns={["门店", "申请人", "账号", "电话", "状态", "申请时间", "操作"]}
            rows={storeOwnerApplications.map((application) => [
              application.storeName,
              application.ownerName,
              application.account,
              application.phone,
              <Badge
                key={`${application.id}-store-application-status`}
                text={application.status}
                tone={application.status === "已通过" ? "ok" : application.status === "已拒绝" ? "warn" : undefined}
              />,
              shortDate(application.createdAt),
              application.status === "待审批" ? (
                <div className="admin-approval-actions" key={`${application.id}-store-application-actions`}>
                  <button type="button" disabled={mutationPending} onClick={() => void runMutation(() => actions.decideStoreOwnerApplication(application.id, true))}>
                    {mutationPending ? "处理中..." : "通过"}
                  </button>
                  <button type="button" disabled={mutationPending} onClick={() => void runMutation(() => actions.decideStoreOwnerApplication(application.id, false))}>
                    {mutationPending ? "处理中..." : "拒绝"}
                  </button>
                </div>
              ) : application.decidedAt ? shortDate(application.decidedAt) : "-",
            ])}
          />
        </div>
        <div className="permission-support-grid">
          <div className="panel dashboard-panel permission-role-card">
            <PanelTitle icon={<ShieldCheck size={18} />} title="角色权限" action="可配置模板" />
            <DataTable columns={["角色", "可见模块", "范围"]} rows={roleRows} />
            <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
              {(Object.keys(draftTemplates) as UserRole[]).map((role) => (
                <CheckboxGroup
                  key={role}
                  label={displayUserRole(role)}
                  values={draftTemplates[role]}
                  onChange={(values) => setRoleTemplate(role, values)}
                  options={permissionOptions}
                />
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" disabled={mutationPending} onClick={saveRoleTemplates}>
                  {mutationPending ? "保存中..." : savedPermissions ? "已保存" : "保存权限模板"}
                </button>
              </div>
            </div>
          </div>
          <div className="panel dashboard-panel permission-approval-card">
            <PanelTitle icon={<ClipboardList size={18} />} title="关键审批" action={`${data.approvalRequests.length} 条`} />
            <DataTable
              columns={["类型", "目标", "金额", "申请人", "状态", "申请时间"]}
              rows={data.approvalRequests.map((request) => [
                request.type,
                request.targetId,
                money(request.amount),
                data.authUsers.find((user) => user.id === request.requestedBy)?.name ?? "系统",
                <Badge key={`${request.id}-permission-status`} text={request.status} tone={request.status === "已通过" ? "ok" : request.status === "已拒绝" ? "warn" : undefined} />,
                shortDate(request.createdAt),
              ])}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export function PlatformAuditReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const allLogs = [...(data.operationLogs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const logs = allLogs.filter((log) => {
    const userName = data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统";
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    const matchesSearch = !normalizedSearchTerm
      || log.summary.toLowerCase().includes(normalizedSearchTerm)
      || log.action.toLowerCase().includes(normalizedSearchTerm)
      || log.targetType.toLowerCase().includes(normalizedSearchTerm)
      || userName.toLowerCase().includes(normalizedSearchTerm);
    const matchesAction = !actionFilter || log.action === actionFilter;
    const matchesUser = !userFilter || log.userId === userFilter;
    return matchesSearch && matchesAction && matchesUser;
  });
  const actionCount = new Set(logs.map((item) => item.action)).size;
  const userCount = new Set(logs.map((item) => item.userId)).size;
  const uniqueActions = Array.from(new Set(allLogs.map((item) => item.action))).sort((a, b) => a.localeCompare(b));
  const uniqueUserIds = Array.from(new Set(allLogs.map((item) => item.userId))).sort((a, b) => {
    const leftName = data.authUsers.find((user) => user.id === a)?.name ?? a;
    const rightName = data.authUsers.find((user) => user.id === b)?.name ?? b;
    return leftName.localeCompare(rightName);
  });

  const exportLogs = () => {
    downloadCsvFile(
      `平台操作日志_${new Date().toISOString().slice(0, 10)}.csv`,
      ["时间", "操作人", "动作", "对象类型", "摘要"],
      logs.map((log) => [
        log.createdAt,
        data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统",
        log.action,
        log.targetType,
        log.summary,
      ]),
    );
  };

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="操作日志" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ClipboardList size={15} /> 操作日志</span>
          <h1>操作日志</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="日志数" value={`${logs.length} 条`} hint="操作记录" />
          <StatCard title="动作类型" value={`${actionCount} 类`} hint="操作分类" />
          <StatCard title="操作账号" value={`${userCount} 个`} hint="涉及账号" />
        </div>
      </section>

      <section className="panel dashboard-panel">
        <PanelTitle icon={<ClipboardList size={18} />} title="最近操作" action={`${logs.length} 条`} />
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="搜索操作、对象、摘要或账号"
            value={searchTerm}
            {...searchInputSync(setSearchTerm)}
            style={{ flex: 1, minWidth: "220px" }}
          />
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="">所有动作</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
            <option value="">所有账号</option>
            {uniqueUserIds.map((userId) => (
              <option key={userId} value={userId}>{data.authUsers.find((user) => user.id === userId)?.name ?? userId}</option>
            ))}
          </select>
          <button type="button" onClick={exportLogs}>导出 CSV</button>
        </div>
        <DataTable
          columns={["时间", "操作人", "动作", "对象类型", "摘要"]}
          rows={logs.slice(0, 120).map((log) => [
            shortDate(log.createdAt),
            data.authUsers.find((user) => user.id === log.userId)?.name ?? "系统",
            log.action,
            log.targetType,
            log.summary,
          ])}
        />
      </section>
    </div>
  );
}

function AiCostStatisticsSection({ data }: { data: AppData }) {
  const aiRecords = [...(data.marketingAiRecords ?? [])].sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const currentMonthKey = todayKey.slice(0, 7);
  const completedAiRecords = aiRecords.filter((record) => record.status !== "生成中" && record.status !== "生成失败");
  const pendingAiRecords = aiRecords.filter((record) => record.status === "生成中");
  const failedAiRecords = aiRecords.filter((record) => record.status === "生成失败");
  const estimatedAiRecords = aiRecords.filter((record) => record.cost?.estimated);
  const aiTotalCost = aiRecords.reduce((sum, record) => sum + aiRecordCostUsd(record), 0);
  const aiTextCost = aiRecords.reduce((sum, record) => sum + aiRecordCategoryCostUsd(record, "text"), 0);
  const aiImageCost = aiRecords.reduce((sum, record) => sum + aiRecordCategoryCostUsd(record, "image"), 0);
  const aiVideoCost = aiRecords.reduce((sum, record) => sum + aiRecordCategoryCostUsd(record, "video"), 0);
  const aiUnsplitCost = aiRecords.reduce((sum, record) => sum + aiRecordUnsplitCostUsd(record), 0);
  const aiTodayCost = aiRecords
    .filter((record) => aiRecordChinaDateKey(record) === todayKey)
    .reduce((sum, record) => sum + aiRecordCostUsd(record), 0);
  const aiMonthCost = aiRecords
    .filter((record) => aiRecordChinaDateKey(record).startsWith(currentMonthKey))
    .reduce((sum, record) => sum + aiRecordCostUsd(record), 0);
  const aiImageRelatedRecords = aiRecords.filter((record) => record.kind === "image" || (record.model ?? "").includes("gpt-image"));
  const storeNameById = new Map(data.storeProfiles.map((store) => [store.id, store.name]));
  const aiModelRows = Array.from(aiRecords.reduce((map, record) => {
    const key = record.model ?? "未记录模型";
    const current = map.get(key) ?? { count: 0, textCost: 0, imageCost: 0, videoCost: 0, unsplitCost: 0, failed: 0, estimated: 0 };
    current.count += 1;
    current.textCost += aiRecordCategoryCostUsd(record, "text");
    current.imageCost += aiRecordCategoryCostUsd(record, "image");
    current.videoCost += aiRecordCategoryCostUsd(record, "video");
    current.unsplitCost += aiRecordUnsplitCostUsd(record);
    if (record.status === "生成失败") current.failed += 1;
    if (record.cost?.estimated) current.estimated += 1;
    map.set(key, current);
    return map;
  }, new Map<string, { count: number; textCost: number; imageCost: number; videoCost: number; unsplitCost: number; failed: number; estimated: number }>()).entries())
    .sort(([, left], [, right]) => (right.textCost + right.imageCost + right.videoCost + right.unsplitCost) - (left.textCost + left.imageCost + left.videoCost + left.unsplitCost))
    .slice(0, 8)
    .map(([model, summary]) => [
      model,
      `${summary.count} 次`,
      formatAiCostUsd(summary.textCost),
      formatAiCostUsd(summary.imageCost),
      formatAiCostUsd(summary.videoCost),
      formatAiCostUsd(summary.unsplitCost),
      summary.estimated ? `${summary.estimated} 次预估` : "实际用量",
      summary.failed ? `${summary.failed} 次失败` : "无失败",
    ]);
  const aiStoreRows = Array.from(aiRecords.reduce((map, record) => {
    const key = record.storeId ? storeNameById.get(record.storeId) ?? record.storeId : "平台/未绑定门店";
    const current = map.get(key) ?? { count: 0, textCost: 0, imageCost: 0, videoCost: 0, unsplitCost: 0, users: new Set<string>() };
    current.count += 1;
    current.textCost += aiRecordCategoryCostUsd(record, "text");
    current.imageCost += aiRecordCategoryCostUsd(record, "image");
    current.videoCost += aiRecordCategoryCostUsd(record, "video");
    current.unsplitCost += aiRecordUnsplitCostUsd(record);
    if (record.createdByName) current.users.add(record.createdByName);
    map.set(key, current);
    return map;
  }, new Map<string, { count: number; textCost: number; imageCost: number; videoCost: number; unsplitCost: number; users: Set<string> }>()).entries())
    .sort(([, left], [, right]) => (right.textCost + right.imageCost + right.videoCost + right.unsplitCost) - (left.textCost + left.imageCost + left.videoCost + left.unsplitCost))
    .slice(0, 8)
    .map(([storeName, summary]) => [
      storeName,
      `${summary.count} 次`,
      formatAiCostUsd(summary.textCost),
      formatAiCostUsd(summary.imageCost),
      formatAiCostUsd(summary.videoCost),
      formatAiCostUsd(summary.unsplitCost),
      Array.from(summary.users).slice(0, 3).join("、") || "-",
    ]);
  const aiRecentRows = aiRecords.slice(0, 10).map((record) => [
    shortDate(record.createdAt),
    record.createdByName,
    marketingAiKindLabel(record.kind),
    record.model ?? "-",
    formatAiCostUsd(aiRecordCategoryCostUsd(record, "text")),
    formatAiCostUsd(aiRecordCategoryCostUsd(record, "image")),
    formatAiCostUsd(aiRecordCategoryCostUsd(record, "video")),
    formatAiCostUsd(aiRecordUnsplitCostUsd(record)),
    record.status ?? "已完成",
    record.cost?.estimated ? "预估" : "实际/未记录",
  ]);

  return (
    <section className="usage-card">
      <PanelTitle icon={<BadgeCent size={18} />} title="AI 生成费用统计" action={`${aiRecords.length} 次记录`} />
      <div className="usage-metrics">
        <div>
          <strong>{formatAiCostUsd(aiTotalCost)}</strong>
          <span>系统内累计成本</span>
        </div>
        <div>
          <strong>{formatAiCostUsd(aiTextCost)}</strong>
          <span>文案/文字费用</span>
        </div>
        <div>
          <strong>{formatAiCostUsd(aiImageCost)}</strong>
          <span>图片/产品设计图费用</span>
        </div>
        <div>
          <strong>{formatAiCostUsd(aiVideoCost)}</strong>
          <span>产品视频费用</span>
        </div>
        <div>
          <strong>{formatAiCostUsd(aiUnsplitCost)}</strong>
          <span>历史未拆分</span>
        </div>
        <div>
          <strong>{completedAiRecords.length} / {failedAiRecords.length} / {pendingAiRecords.length}</strong>
          <span>完成 / 失败 / 生成中</span>
        </div>
      </div>

      <div className="usage-inline-note">
        <span>本月 / 今日</span>
        <strong>{formatAiCostUsd(aiMonthCost)} / {formatAiCostUsd(aiTodayCost)} · 图片相关 {aiImageRelatedRecords.length} 次 · 预估 {estimatedAiRecords.length} 次</strong>
      </div>

      <DataTable
        columns={["模型", "次数", "文案费用", "图片费用", "产品视频费用", "未拆分历史", "费用口径", "失败"]}
        rows={aiModelRows.length > 0 ? aiModelRows : [["暂无 AI 费用记录", "-", "-", "-", "-", "-", "-", "-"]]}
      />
      <DataTable
        columns={["门店", "次数", "文案费用", "图片费用", "产品视频费用", "未拆分历史", "使用人"]}
        rows={aiStoreRows.length > 0 ? aiStoreRows : [["暂无门店记录", "-", "-", "-", "-", "-", "-"]]}
      />
      <DataTable
        columns={["时间", "使用人", "类型", "模型", "文案费用", "图片费用", "产品视频费用", "未拆分历史", "状态", "费用口径"]}
        rows={aiRecentRows.length > 0 ? aiRecentRows : [["暂无记录", "-", "-", "-", "-", "-", "-", "-", "-", "-"]]}
      />
    </section>
  );
}

export function PlatformAiUsageReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  return (
    <div className="admin-center-page platform-admin-page usage-monitor-page">
      {showBack && <PlatformPageTitle title="AI费用统计" onBack={() => setView("settings")} />}
      <header className="usage-monitor-header">
        <div className="usage-monitor-title">
          <div>
            {!showBack && <h1>AI费用统计</h1>}
            <p>文案、图片、视频费用独立统计 · {updatedAt}</p>
          </div>
        </div>
      </header>
      <AiCostStatisticsSection data={data} />
    </div>
  );
}

export function PlatformUsageReadOnlyView({
  data,
  setView,
  showBack,
  fetchR2Usage,
  fetchWorkerUsage,
}: {
  data: AppData;
  setView: (view: ViewKey) => void;
  showBack?: boolean;
  fetchR2Usage: () => Promise<R2UsageSnapshot>;
  fetchWorkerUsage: () => Promise<WorkerUsageSnapshot>;
}) {
  const [r2Usage, setR2Usage] = useState<R2UsageSnapshot | undefined>();
  const [r2Loading, setR2Loading] = useState(true);
  const [r2Error, setR2Error] = useState("");
  const [workerUsage, setWorkerUsage] = useState<WorkerUsageSnapshot | undefined>();
  const [workerLoading, setWorkerLoading] = useState(true);
  const [workerError, setWorkerError] = useState("");
  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"] as const;
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  };
  const loadR2Usage = async () => {
    setR2Loading(true);
    setR2Error("");
    try {
      setR2Usage(await fetchR2Usage());
    } catch (caught) {
      setR2Usage(undefined);
      setR2Error(caught instanceof Error ? caught.message : "R2 真实容量读取失败");
    } finally {
      setR2Loading(false);
    }
  };
  const loadWorkerUsage = async () => {
    setWorkerLoading(true);
    setWorkerError("");
    try {
      setWorkerUsage(await fetchWorkerUsage());
    } catch (caught) {
      setWorkerUsage(undefined);
      setWorkerError(caught instanceof Error ? caught.message : "Worker 请求量读取失败");
    } finally {
      setWorkerLoading(false);
    }
  };
  const loadUsage = async () => {
    await Promise.all([loadR2Usage(), loadWorkerUsage()]);
  };

  useEffect(() => {
    void loadUsage();
  }, []);

  const d1Tables = [
    ["storeProfiles", data.storeProfiles.length],
    ["authUsers", data.authUsers.length],
    ["staff", data.staff.length],
    ["customers", data.customers.length],
    ["services", data.services.length],
    ["products", data.products.length],
    ["appointments", data.appointments.length],
    ["orders", data.orders.length],
    ["memberCards", data.memberCards.length],
    ["inventoryBatches", data.inventoryBatches.length],
    ["inventoryLogs", data.inventoryLogs.length],
    ["operationLogs", data.operationLogs.length],
    ["approvalRequests", data.approvalRequests.length],
    ["marketingAiRecords", data.marketingAiRecords.length],
  ] as const;
  const d1Records = d1Tables.reduce((sum, [, count]) => sum + count, 0);
  const r2LimitBytes = r2Usage?.limitBytes ?? 10 * 1024 * 1024 * 1024;
  const r2UsedBytes = r2Usage?.totalBytes ?? 0;
  const r2ObjectCount = r2Usage?.objectCount ?? 0;
  const r2UsagePercent = r2LimitBytes > 0 ? Math.min(100, (r2UsedBytes / r2LimitBytes) * 100) : 0;
  const r2UsageLabel = r2Usage?.available ? (r2UsagePercent > 0 && r2UsagePercent < 0.1 ? "<0.1%" : `${r2UsagePercent.toFixed(1)}%`) : "未绑定";
  const r2Rows = r2Usage?.available
    ? r2Usage.prefixes.map((item) => [item.prefix, `${item.objectCount} 个`, formatBytes(item.bytes)])
    : [[r2Usage?.message ?? r2Error ?? "R2 Bucket 未绑定，无法读取真实容量", "-", "-"]];
  const workerRequests = workerUsage?.requests ?? 0;
  const workerErrors = workerUsage?.errors ?? 0;
  const workerSubrequests = workerUsage?.subrequests ?? 0;
  const workerErrorRate = workerRequests > 0 ? (workerErrors / workerRequests) * 100 : 0;
  const workerRows = workerUsage?.available
    ? workerUsage.rows.map((row) => [
        row.scriptName,
        row.requests.toLocaleString("zh-CN"),
        row.errors.toLocaleString("zh-CN"),
        row.subrequests.toLocaleString("zh-CN"),
      ])
    : [[workerUsage?.message ?? workerError ?? "Cloudflare Metrics 配置未完成，无法读取真实请求量", "-", "-", "-"]];
  const d1TableLabels: Record<string, string> = {
    storeProfiles: "门店资料",
    authUsers: "登录账号",
    staff: "员工档案",
    customers: "客户档案",
    services: "服务项目",
    products: "商品资料",
    appointments: "预约记录",
    orders: "收银订单",
    memberCards: "项目卡",
    inventoryBatches: "库存批次",
    inventoryLogs: "库存流水",
    operationLogs: "操作日志",
    approvalRequests: "审批记录",
    marketingAiRecords: "AI生成记录",
  };
  const updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const r2Status = r2Loading ? "检查中" : r2Usage?.available ? "正常" : "需配置";
  const workerStatus = workerLoading ? "检查中" : workerUsage?.available ? (workerErrorRate >= 5 ? "需关注" : "正常") : "需配置";
  const storeScopedRecords = [
    ...data.staff,
    ...data.customers,
    ...data.services,
    ...data.products,
    ...data.appointments,
    ...data.orders,
    ...data.memberCards,
  ];
  const missingStoreIdCount = storeScopedRecords.filter((item) => !item.storeId).length;
  const recentWarningLogs = data.operationLogs.filter((log) => /失败|异常|错误|拒绝/.test(log.summary)).slice(0, 5);
  const systemHealthRows = [
    [
      "API 服务",
      <Badge key="api-status" text="正常" tone="ok" />,
      "当前账号已通过 API 拉取到业务数据",
    ],
    [
      "D1 数据库",
      <Badge key="d1-status" text={d1Records >= 0 ? "正常" : "异常"} tone={d1Records >= 0 ? "ok" : "warn"} />,
      `已纳入 ${d1Tables.length} 张业务表，当前 ${d1Records} 条记录`,
    ],
    [
      "门店数据隔离",
      <Badge key="store-scope-status" text={missingStoreIdCount === 0 ? "正常" : "需补齐"} tone={missingStoreIdCount === 0 ? "ok" : "warn"} />,
      missingStoreIdCount === 0 ? `当前 ${data.storeProfiles.length} 家门店数据已带门店归属` : `${missingStoreIdCount} 条历史数据缺少门店归属，接口会按默认门店兼容`,
    ],
    [
      "最近异常",
      <Badge key="recent-warning-status" text={recentWarningLogs.length ? "需关注" : "正常"} tone={recentWarningLogs.length ? "warn" : "ok"} />,
      recentWarningLogs.length ? recentWarningLogs.map((log) => log.summary).join("；") : "未发现最近异常操作日志",
    ],
    [
      "R2 图片存储",
      <Badge key="r2-status" text={r2Status} tone={r2Usage?.available ? "ok" : r2Loading ? undefined : "warn"} />,
      r2Loading ? "正在读取真实容量" : r2Usage?.available ? `已用 ${formatBytes(r2UsedBytes)}，对象 ${r2ObjectCount} 个` : r2Usage?.message ?? r2Error ?? "R2 Bucket 未绑定",
    ],
    [
      "Worker 请求监控",
      <Badge key="worker-status" text={workerStatus} tone={workerUsage?.available && workerErrorRate < 5 ? "ok" : workerLoading ? undefined : "warn"} />,
      workerLoading ? "正在读取请求统计" : workerUsage?.available ? `最近 ${workerUsage.windowHours} 小时错误率 ${workerErrorRate.toFixed(2)}%` : workerUsage?.message ?? workerError ?? "Cloudflare Metrics 未配置",
    ],
  ];

  return (
    <div className="admin-center-page platform-admin-page usage-monitor-page">
      {showBack && <PlatformPageTitle title="服务器用量监控" onBack={() => setView("settings")} />}
      <header className="usage-monitor-header">
        <div className="usage-monitor-title">
          <div>
            {!showBack && <h1>服务器用量监控</h1>}
            <p>Cloudflare 资源统计 · {updatedAt}</p>
          </div>
        </div>
        <button className="usage-refresh-button" type="button" onClick={() => void loadUsage()}>
          <RefreshCw size={16} />
        </button>
      </header>

      <section className="usage-card">
        <PanelTitle icon={<ShieldCheck size={18} />} title="系统健康状态" action="实时检查" />
        <DataTable columns={["项目", "状态", "说明"]} rows={systemHealthRows} />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="R2 图片存储" action="对象存储" />
        <div className="usage-metrics">
          <div>
            <strong>{r2Loading ? "读取中" : r2ObjectCount}</strong>
            <span>对象总数</span>
          </div>
          <div>
            <strong>{r2Loading ? "读取中" : formatBytes(r2UsedBytes)}</strong>
            <span>真实已用容量</span>
          </div>
          <div>
            <strong>{formatBytes(r2LimitBytes)}</strong>
            <span>免费额度</span>
          </div>
        </div>

        <div className="usage-soft-meter" aria-label="R2 存储状态">
          <div>
            <span>R2 存储状态</span>
            <strong>{r2Loading ? "读取真实数据中" : r2Usage?.available ? `${r2UsageLabel} · 剩余 ${formatBytes(Math.max(0, r2LimitBytes - r2UsedBytes))}` : r2Usage?.message ?? r2Error}</strong>
          </div>
        </div>

        <DataTable
          columns={["目录", "对象数", "真实容量"]}
          rows={r2Loading ? [["读取中", "-", "-"]] : r2Rows.length > 0 ? r2Rows : [["暂无对象", "0 个", "0 B"]]}
        />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="D1 数据库" action="数据表" />
        <div className="usage-metrics">
          <div>
            <strong>{d1Records}</strong>
            <span>总记录数</span>
          </div>
          <div>
            <strong>{d1Tables.length}</strong>
            <span>监控表数</span>
          </div>
          <div>
            <strong>5 GB</strong>
            <span>免费额度</span>
          </div>
        </div>

        <DataTable
          columns={["数据表", "记录数", "说明"]}
          rows={d1Tables.map(([table, count]) => [table, `${count} 行`, d1TableLabels[table]])}
        />
      </section>

      <section className="usage-card">
        <PanelTitle icon={<Database size={18} />} title="Worker 请求统计" action={`最近 ${workerUsage?.windowHours ?? 24} 小时`} />
        <div className="usage-metrics">
          <div>
            <strong>{workerLoading ? "读取中" : workerRequests.toLocaleString("zh-CN")}</strong>
            <span>请求数</span>
          </div>
          <div>
            <strong>{workerLoading ? "读取中" : workerErrors.toLocaleString("zh-CN")}</strong>
            <span>错误数</span>
          </div>
          <div>
            <strong>{workerLoading ? "读取中" : `${workerErrorRate.toFixed(2)}%`}</strong>
            <span>错误率</span>
          </div>
        </div>
        <DataTable
          columns={["Worker", "请求数", "错误数", "子请求"]}
          rows={workerLoading ? [["读取中", "-", "-", "-"]] : workerRows.length > 0 ? workerRows : [["暂无请求记录", "0", "0", "0"]]}
        />
        <div className="usage-inline-note">
          <span>子请求合计</span>
          <strong>{workerLoading ? "读取中" : workerSubrequests.toLocaleString("zh-CN")}</strong>
        </div>
      </section>
    </div>
  );
}

export function PlatformDataReadOnlyView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const summary = reportSummary(data);
  const totalRevenue = data.orders.reduce((sum, order) => sum + order.paidAmount, 0);
  const paidOrders = data.orders.filter((order) => order.status !== "已退款").length;
  const activeMemberCards = data.memberCards.filter((card) => card.status === "正常").length;

  return (
    <div className="admin-center-page platform-admin-page">
      {showBack && <PlatformPageTitle title="报表分析" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><ChartNoAxesColumnIncreasing size={15} /> 报表分析</span>
          <h1>数据总览</h1>
        </div>
        <div className="page-hero-stats">
          <StatCard title="门店数" value={`${data.storeProfiles.length} 家`} hint="已开通门店" />
          <StatCard title="客户数" value={`${data.customers.length} 人`} hint="客户档案" />
          <StatCard title="实收金额" value={money(totalRevenue)} hint={`${paidOrders} 个收银订单`} />
        </div>
      </section>

      <section className="action-strip" aria-label="平台数据指标">
        <button type="button">
          <UsersRound size={18} />
          <strong>{data.authUsers.length}</strong>
          <span>账号总数</span>
        </button>
        <button type="button">
          <CalendarDays size={18} />
          <strong>{data.appointments.length}</strong>
          <span>预约记录</span>
        </button>
        <button type="button">
          <CreditCard size={18} />
          <strong>{data.orders.length}</strong>
          <span>订单记录</span>
        </button>
        <button type="button">
          <BadgeCent size={18} />
          <strong>{activeMemberCards}</strong>
          <span>有效会员卡</span>
        </button>
      </section>

      <section className="panel dashboard-panel">
        <PanelTitle icon={<Database size={18} />} title="核心指标" action="数据汇总" />
        <DataTable
          columns={["指标", "结果", "说明"]}
          rows={[
            ["实收金额", money(summary.revenue), "收银记录汇总"],
            ["退款金额", money(summary.refundAmount), "退款记录汇总"],
            ["会员储值余额", money(summary.cardBalance), "客户资产余额"],
            ["员工提成", money(summary.commission), "员工提成汇总"],
            ["低库存项", `${summary.lowStockCount} 项`, "库存模块预警数量"],
          ]}
        />
      </section>
    </div>
  );
}

export function PlatformStoreCustomerDetailsView({ data, setView, showBack }: { data: AppData; setView: (view: ViewKey) => void; showBack?: boolean }) {
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(new Set());
  const today = new Date();
  const isToday = (value: string) => new Date(value).toDateString() === today.toDateString();
  const belongsToStore = (storeId: string, itemStoreId?: string) => itemStoreId === storeId || (!itemStoreId && data.storeProfiles.length === 1);
  const toggleStore = (storeId: string) => {
    setExpandedStoreIds((current) => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };
  const orderProductText = (order: Order) => {
    const productItems = order.productItems?.map((item) => `${nameOf(data.products, item.productId)} x ${formatStockQuantity(item.quantity)}`) ?? [];
    const giftItems = order.giftProductItems?.map((item) => `赠 ${nameOf(data.products, item.productId)} x ${formatStockQuantity(item.quantity)}`) ?? [];
    const legacyProduct = order.productId ? [nameOf(data.products, order.productId)] : [];
    const legacyGift = order.giftProductId ? [`赠 ${nameOf(data.products, order.giftProductId)}`] : [];
    return [...productItems, ...giftItems, ...legacyProduct, ...legacyGift].join("、") || "-";
  };
  const storeSummaries = data.storeProfiles.map((store) => {
    const customers = data.customers.filter((customer) => belongsToStore(store.id, customer.storeId));
    const orders = data.orders.filter((order) => belongsToStore(store.id, order.storeId));
    const appointments = data.appointments.filter((appointment) => belongsToStore(store.id, appointment.storeId));
    const memberCards = data.memberCards.filter((card) => belongsToStore(store.id, card.storeId));
    const serviceRecords = data.customerServiceRecords.filter((record) => belongsToStore(store.id, record.storeId));
    const refunds = data.refunds.filter((refund) => belongsToStore(store.id, refund.storeId));
    const revenue = orders.filter((order) => order.status !== "已退款").reduce((sum, order) => sum + order.paidAmount, 0);
    return { store, customers, orders, appointments, memberCards, serviceRecords, refunds, revenue };
  });
  const totalRevenue = storeSummaries.reduce((sum, item) => sum + item.revenue, 0);

  return (
    <div className="admin-center-page platform-admin-page store-customer-detail-page">
      {showBack && <PlatformPageTitle title="分店客户明细" onBack={() => setView("settings")} />}
      <section className="page-hero platform-admin-readonly-hero">
        <div>
          <span className="eyebrow"><UsersRound size={15} /> 分店客户明细</span>
          <h1>客户业务记录</h1>
          <p>按门店折叠查看客户做过的业务、消费、预约、会员卡和服务档案。</p>
        </div>
        <div className="page-hero-stats">
          <StatCard title="门店数" value={`${data.storeProfiles.length} 家`} hint="默认折叠" />
          <StatCard title="客户数" value={`${data.customers.length} 人`} hint="客户档案" />
          <StatCard title="实收汇总" value={money(totalRevenue)} hint={`${data.orders.length} 个订单`} />
        </div>
      </section>

      <section className="store-customer-list" aria-label="分店客户业务明细">
        {storeSummaries.map(({ store, customers, orders, appointments, memberCards, serviceRecords, refunds, revenue }) => {
          const expanded = expandedStoreIds.has(store.id);
          const todayOrders = orders.filter((order) => isToday(order.createdAt));
          const todayAppointments = appointments.filter((appointment) => isToday(appointment.startAt));
          const activeCards = memberCards.filter((card) => card.status === "正常");
          const customerRows = customers
            .slice()
            .sort((a, b) => +new Date(b.lastVisit) - +new Date(a.lastVisit))
            .map((customer) => {
              const customerOrders = orders.filter((order) => order.customerId === customer.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              const customerAppointments = appointments.filter((appointment) => appointment.customerId === customer.id).sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt));
              const customerCards = memberCards.filter((card) => card.customerId === customer.id);
              const customerCardTransactions = data.memberCardTransactions
                .filter((transaction) => customerCards.some((card) => card.id === transaction.memberCardId) || customerOrders.some((order) => order.id === transaction.orderId))
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              const customerServiceRecords = serviceRecords.filter((record) => record.customerId === customer.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              const customerSignatures = data.customerSignatures
                .filter((signature) => signature.customerId === customer.id)
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              const customerFollowUps = data.customerFollowUps
                .filter((followUp) => followUp.customerId === customer.id)
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
              const customerRefunds = refunds.filter((refund) => customerOrders.some((order) => order.id === refund.orderId));
              const paidAmount = customerOrders.filter((order) => order.status !== "已退款").reduce((sum, order) => sum + order.paidAmount, 0);
              const latestBusiness = [
                ...customerOrders.map((order) => ({ at: order.createdAt, text: `订单 ${order.orderNo} · ${nameOf(data.services, order.serviceId)} · ${money(order.paidAmount)}` })),
                ...customerAppointments.map((appointment) => ({ at: appointment.startAt, text: `预约 ${appointment.status} · ${appointmentServiceNames(data, appointment)} · ${appointment.roomName || "未分配房间"}` })),
                ...customerServiceRecords.map((record) => ({ at: record.createdAt, text: `服务档案 · ${nameOf(data.services, record.serviceId)} · ${nameOf(data.staff, record.staffId)}` })),
                ...customerCardTransactions.map((transaction) => ({ at: transaction.createdAt, text: `会员卡${transaction.type} · ${money(transaction.paidAmount ?? 0)} · ${transaction.note || "-"}` })),
                ...customerFollowUps.map((followUp) => ({ at: followUp.createdAt, text: `跟进${followUp.status} · ${followUp.method} · ${followUp.note}` })),
              ].sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]?.text ?? "暂无业务记录";
              return {
                customer,
                customerOrders,
                customerAppointments,
                customerCards,
                customerCardTransactions,
                customerServiceRecords,
                customerSignatures,
                customerFollowUps,
                customerRefunds,
                paidAmount,
                latestBusiness,
              };
            });

          return (
            <section key={store.id} className="store-customer-accordion">
              <button type="button" className="store-customer-toggle" onClick={() => toggleStore(store.id)} aria-expanded={expanded}>
                <span className="store-customer-toggle-icon">{expanded ? <Minus size={17} /> : <Plus size={17} />}</span>
                <span className="store-customer-title">
                  <strong>{store.name}</strong>
                  <small>{store.address || "未填写地址"} · {store.phone || "未填写电话"}</small>
                </span>
                <span className="store-customer-metrics">
                  <span>{customers.length} 客户</span>
                  <span>{orders.length} 订单</span>
                  <span>{todayOrders.length} 今日单</span>
                  <span>{todayAppointments.length} 今日约</span>
                  <span>{activeCards.length} 有效卡</span>
                  <strong>{money(revenue)}</strong>
                </span>
              </button>

              {expanded && (
                <div className="store-customer-panel">
                  <div className="store-customer-summary-grid">
                    <StatCard title="客户档案" value={`${customers.length} 人`} hint="当前门店" />
                    <StatCard title="预约记录" value={`${appointments.length} 条`} hint={`${todayAppointments.length} 条今日预约`} />
                    <StatCard title="会员卡" value={`${memberCards.length} 张`} hint={`${activeCards.length} 张正常`} />
                    <StatCard title="服务档案" value={`${serviceRecords.length} 条`} hint={`${refunds.length} 条退款`} />
                  </div>

                  {customerRows.length === 0 ? (
                    <div className="empty-state-inline">这家门店暂无客户和业务记录。</div>
                  ) : (
                    <div className="store-customer-cards">
                      {customerRows.map((row) => (
                        <article key={row.customer.id} className="store-customer-card">
                          <div className="store-customer-card-head">
                            <div>
                              <strong>{row.customer.name}</strong>
                              <span>{row.customer.phone || "未留电话"} · {row.customer.level || "普通客户"} · 来源 {row.customer.source || "-"}</span>
                            </div>
                            <Badge text={row.customerCards.some((card) => card.status === "正常") ? "有会员卡" : "普通客户"} tone={row.customerCards.some((card) => card.status === "正常") ? "ok" : undefined} />
                          </div>
                          <div className="store-customer-kpis">
                            <span>实收 {money(row.paidAmount)}</span>
                            <span>订单 {row.customerOrders.length}</span>
                            <span>预约 {row.customerAppointments.length}</span>
                            <span>服务 {row.customerServiceRecords.length}</span>
                            <span>签名 {row.customerSignatures.length}</span>
                            <span>跟进 {row.customerFollowUps.length}</span>
                          </div>
                          <div className="store-customer-latest">
                            <strong>最近业务</strong>
                            <span>{row.latestBusiness}</span>
                          </div>
                          <DataTable
                            columns={["业务类型", "时间", "详细内容", "金额/状态", "经手人"]}
                            rows={[
                              ...row.customerOrders.slice(0, 8).map((order) => [
                                "订单",
                                shortDate(order.createdAt),
                                `${order.orderNo} · ${nameOf(data.services, order.serviceId)} · 商品 ${orderProductText(order)}`,
                                `${money(order.paidAmount)} · ${order.payMethod} · ${order.status}`,
                                nameOf(data.staff, order.staffId),
                              ]),
                              ...row.customerAppointments.slice(0, 8).map((appointment) => [
                                "预约",
                                appointmentTimeRange(data, appointment),
                                `${appointmentServiceNames(data, appointment)} · ${appointment.roomName || "未分配房间"} · ${appointment.note || "无备注"}`,
                                appointment.status,
                                nameOf(data.staff, appointment.staffId),
                              ]),
                              ...row.customerCards.map((card) => [
                                "会员卡",
                                card.expiresAt ? `到期 ${shortDate(card.expiresAt)}` : "-",
                                `${card.name} · ${card.type} · ${memberCardProjectScopeText(card, data.services)}`,
                                `余额 ${money(card.balance)} · ${memberCardTimesText(card, data.services)} · ${card.status}`,
                                "-",
                              ]),
                              ...row.customerCardTransactions.slice(0, 8).map((transaction) => [
                                "卡流水",
                                shortDate(transaction.createdAt),
                                `${transaction.type} · ${transaction.note || "-"} · 卡 ${nameOf(row.customerCards, transaction.memberCardId)}`,
                                `${money(transaction.paidAmount ?? 0)} · 余额 ${money(transaction.balanceAfter)} · 剩 ${transaction.remainingTimesAfter} 次`,
                                transaction.staffId ? nameOf(data.staff, transaction.staffId) : "-",
                              ]),
                              ...row.customerServiceRecords.slice(0, 6).map((record) => [
                                "服务档案",
                                shortDate(record.createdAt),
                                `${nameOf(data.services, record.serviceId)} · 皮肤 ${record.skinCondition || "-"} · 步骤 ${record.careSteps || "-"} · 产品 ${record.productsUsed || "-"}`,
                                `反馈 ${record.customerFeedback || "-"} · 建议 ${record.nextCareAdvice || "-"}`,
                                nameOf(data.staff, record.staffId),
                              ]),
                              ...row.customerSignatures.slice(0, 6).map((signature) => [
                                "签名",
                                shortDate(signature.createdAt),
                                `${signature.title} · ${signature.content}`,
                                signature.signedAt ? `已签 ${shortDate(signature.signedAt)}` : signature.status,
                                signature.signerName || "-",
                              ]),
                              ...row.customerFollowUps.slice(0, 6).map((followUp) => [
                                "跟进",
                                shortDate(followUp.createdAt),
                                `${followUp.method} · ${followUp.note}`,
                                `${followUp.status} · 应跟进 ${shortDate(followUp.dueAt)}`,
                                nameOf(data.staff, followUp.staffId),
                              ]),
                              ...row.customerRefunds.slice(0, 6).map((refund) => [
                                "退款",
                                shortDate(refund.createdAt),
                                `${refund.reason} · 订单 ${row.customerOrders.find((order) => order.id === refund.orderId)?.orderNo ?? refund.orderId}`,
                                money(refund.amount),
                                nameOf(data.authUsers, refund.createdBy),
                              ]),
                            ].slice(0, 48)}
                          />
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </section>
    </div>
  );
}
