import type { AiUsageCapability, AppData, StoreAiUsagePermissions, UserRole } from "./types";

export type AiProviderKey = "openai" | "deepseek" | "seedance" | "kling" | "hailuo" | "grok";
export type AiVideoResolution = "480p" | "720p" | "1080p";
export type AiVideoAspectRatio = "9:16" | "1:1" | "16:9";
export type AiTextModelConfig = {
  enabled: boolean;
  provider: Extract<AiProviderKey, "openai" | "deepseek">;
  model: string;
  apiKey: string;
  inputTokenUsdPerMillion: number;
  outputTokenUsdPerMillion: number;
};

export const OPENAI_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] as const;
export type OpenAiImageModel = typeof OPENAI_IMAGE_MODELS[number];
export type AiImageModelConfig = {
  enabled: boolean;
  provider: "openai";
  model: OpenAiImageModel;
  apiKey: string;
  defaultSize: "1024x1024" | "1024x1536" | "1536x1024";
  defaultQuality: "standard" | "high";
  maxImagesPerRequest: number;
  textInputUsdPerMillion: number;
  imageInputUsdPerMillion: number;
  imageOutputUsdPerMillion: number;
};
export type AiVideoProviderConfig = {
  provider: Extract<AiProviderKey, "seedance" | "kling" | "hailuo" | "grok">;
  enabled: boolean;
  model: string;
  apiKey: string;
  defaultDurationSeconds: number;
  defaultResolution: AiVideoResolution;
  defaultAspectRatio: AiVideoAspectRatio;
  priceUsdBySpec: Record<string, number>;
};
export type AiGenerationConfig = {
  copy: AiTextModelConfig;
  image: AiImageModelConfig;
  video: {
    defaultProvider: AiVideoProviderConfig["provider"];
    providers: AiVideoProviderConfig[];
  };
};

export const AI_VIDEO_DURATIONS = [5, 10, 15];
export const AI_VIDEO_RESOLUTIONS: AiVideoResolution[] = ["480p", "720p", "1080p"];
export const AI_VIDEO_ASPECT_RATIOS: AiVideoAspectRatio[] = ["9:16", "1:1", "16:9"];
export const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-0-fast-260128";
export const AI_PROVIDER_LABELS: Record<AiProviderKey, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  seedance: "Seedance",
  kling: "Kling",
  hailuo: "海螺",
  grok: "Grok Imagine",
};

const DEFAULT_STORE_AI_USAGE_PERMISSIONS: StoreAiUsagePermissions = {
  owner: { copy: true, image: true, video: true },
  staff: { copy: true, image: true, video: false },
};

const DEFAULT_AI_GENERATION_CONFIG: AiGenerationConfig = {
  copy: { enabled: true, provider: "deepseek", model: "deepseek-v4-pro", apiKey: "", inputTokenUsdPerMillion: 0.435, outputTokenUsdPerMillion: 0.87 },
  image: { enabled: true, provider: "openai", model: "gpt-image-2", apiKey: "", defaultSize: "1024x1024", defaultQuality: "high", maxImagesPerRequest: 4, textInputUsdPerMillion: 5, imageInputUsdPerMillion: 8, imageOutputUsdPerMillion: 30 },
  video: {
    defaultProvider: "seedance",
    providers: [
      { provider: "seedance", enabled: true, model: DEFAULT_SEEDANCE_MODEL, apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.3408, "5s:720p": 0.7332, "5s:1080p": 1.8279, "10s:480p": 0.6816, "10s:720p": 1.4665, "10s:1080p": 3.6558, "15s:480p": 1.0224, "15s:720p": 2.1997, "15s:1080p": 5.4837 } },
      { provider: "kling", enabled: false, model: "kling-v3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0, "5s:720p": 0.42, "5s:1080p": 0.56, "10s:480p": 0, "10s:720p": 0.84, "10s:1080p": 1.12, "15s:480p": 0, "15s:720p": 1.26, "15s:1080p": 1.68 } },
      { provider: "hailuo", enabled: false, model: "MiniMax-Hailuo-2.3", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.1, "5s:720p": 0.28, "5s:1080p": 0.49, "10s:480p": 0.15, "10s:720p": 0.56, "10s:1080p": 0, "15s:480p": 0, "15s:720p": 0, "15s:1080p": 0 } },
      { provider: "grok", enabled: false, model: "grok-imagine-video-1.5", apiKey: "", defaultDurationSeconds: 5, defaultResolution: "480p", defaultAspectRatio: "9:16", priceUsdBySpec: { "5s:480p": 0.4, "5s:720p": 0.4, "5s:1080p": 0, "10s:480p": 0.8, "10s:720p": 0.8, "10s:1080p": 0, "15s:480p": 1.2, "15s:720p": 1.2, "15s:1080p": 0 } },
    ],
  },
};

function cloneAiGenerationConfig(config: AiGenerationConfig = DEFAULT_AI_GENERATION_CONFIG): AiGenerationConfig {
  return JSON.parse(JSON.stringify(config)) as AiGenerationConfig;
}

export function videoSpecKey(durationSeconds: number, resolution: AiVideoResolution) {
  return `${durationSeconds}s:${resolution}`;
}

export function boundedPrice(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function normalizeOpenAiImageModel(value: unknown, fallback: OpenAiImageModel): OpenAiImageModel {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  return OPENAI_IMAGE_MODELS.includes(model as OpenAiImageModel) ? model as OpenAiImageModel : fallback;
}

function normalizeSeedanceModel(value: unknown, fallback = DEFAULT_SEEDANCE_MODEL) {
  if (typeof value !== "string") return fallback;
  const model = value.trim();
  const normalized = model.toLowerCase();
  if (!normalized) return fallback;
  if (["seedance-2.0", "doubao-seedance-2.0", "doubao-seedance-2-0"].includes(normalized)) return "doubao-seedance-2-0-260128";
  if (["seedance-2.0-fast", "doubao-seedance-2.0-fast", "doubao-seedance-2-0-fast"].includes(normalized)) return DEFAULT_SEEDANCE_MODEL;
  if (["seedance-1.5-pro", "doubao-seedance-1.5-pro", "doubao-seedance-1-5-pro"].includes(normalized)) return "doubao-seedance-1-5-pro-250728";
  return model;
}

function normalizeAiGenerationConfig(input: unknown): AiGenerationConfig {
  const fallback = cloneAiGenerationConfig();
  if (!input || typeof input !== "object") return fallback;
  const record = input as Partial<AiGenerationConfig>;
  const copy = record.copy && typeof record.copy === "object" ? record.copy as Partial<AiTextModelConfig> : {};
  const image = record.image && typeof record.image === "object" ? record.image as Partial<AiImageModelConfig> : {};
  const video = record.video && typeof record.video === "object" ? record.video as Partial<AiGenerationConfig["video"]> : {};
  const inputProviders = Array.isArray(video.providers) ? video.providers : [];
  const providers = fallback.video.providers.map((defaultProvider) => {
    const incoming = inputProviders.find((item) => item && typeof item === "object" && (item as Partial<AiVideoProviderConfig>).provider === defaultProvider.provider) as Partial<AiVideoProviderConfig> | undefined;
    return {
      ...defaultProvider,
      ...incoming,
      enabled: typeof incoming?.enabled === "boolean" ? incoming.enabled : defaultProvider.enabled,
      apiKey: typeof incoming?.apiKey === "string" ? incoming.apiKey : defaultProvider.apiKey,
      model: defaultProvider.provider === "seedance" ? normalizeSeedanceModel(incoming?.model, defaultProvider.model) : typeof incoming?.model === "string" ? incoming.model : defaultProvider.model,
      defaultDurationSeconds: AI_VIDEO_DURATIONS.includes(Number(incoming?.defaultDurationSeconds)) ? Number(incoming?.defaultDurationSeconds) : defaultProvider.defaultDurationSeconds,
      defaultResolution: AI_VIDEO_RESOLUTIONS.includes(incoming?.defaultResolution as AiVideoResolution) ? incoming?.defaultResolution as AiVideoResolution : defaultProvider.defaultResolution,
      defaultAspectRatio: AI_VIDEO_ASPECT_RATIOS.includes(incoming?.defaultAspectRatio as AiVideoAspectRatio) ? incoming?.defaultAspectRatio as AiVideoAspectRatio : defaultProvider.defaultAspectRatio,
      priceUsdBySpec: Object.fromEntries(Object.entries(incoming?.priceUsdBySpec ?? defaultProvider.priceUsdBySpec ?? {}).map(([key, value]) => [key, boundedPrice(value)])),
    };
  });
  const defaultProvider = providers.some((provider) => provider.provider === video.defaultProvider) ? video.defaultProvider as AiVideoProviderConfig["provider"] : fallback.video.defaultProvider;
  return {
    copy: {
      ...fallback.copy,
      ...copy,
      enabled: typeof copy.enabled === "boolean" ? copy.enabled : fallback.copy.enabled,
      provider: copy.provider === "openai" || copy.provider === "deepseek" ? copy.provider : fallback.copy.provider,
      apiKey: typeof copy.apiKey === "string" ? copy.apiKey : fallback.copy.apiKey,
      model: typeof copy.model === "string" ? copy.model : fallback.copy.model,
      inputTokenUsdPerMillion: boundedPrice(copy.inputTokenUsdPerMillion),
      outputTokenUsdPerMillion: boundedPrice(copy.outputTokenUsdPerMillion),
    },
    image: {
      ...fallback.image,
      ...image,
      enabled: typeof image.enabled === "boolean" ? image.enabled : fallback.image.enabled,
      apiKey: typeof image.apiKey === "string" ? image.apiKey : fallback.image.apiKey,
      model: normalizeOpenAiImageModel(image.model, fallback.image.model),
      defaultSize: ["1024x1024", "1024x1536", "1536x1024"].includes(image.defaultSize ?? "") ? image.defaultSize as AiImageModelConfig["defaultSize"] : fallback.image.defaultSize,
      defaultQuality: image.defaultQuality === "standard" || image.defaultQuality === "high" ? image.defaultQuality : fallback.image.defaultQuality,
      maxImagesPerRequest: Math.max(1, Math.min(8, Math.trunc(Number(image.maxImagesPerRequest) || fallback.image.maxImagesPerRequest))),
      textInputUsdPerMillion: boundedPrice(image.textInputUsdPerMillion),
      imageInputUsdPerMillion: boundedPrice(image.imageInputUsdPerMillion),
      imageOutputUsdPerMillion: boundedPrice(image.imageOutputUsdPerMillion),
    },
    video: { defaultProvider, providers },
  };
}

export function aiGenerationConfigFromSystemConfigs(configs?: AppData["systemConfigs"]) {
  const rawValue = configs?.find((item) => item.key === "ai_generation_config")?.value;
  if (!rawValue) return cloneAiGenerationConfig();
  try {
    return normalizeAiGenerationConfig(JSON.parse(rawValue));
  } catch {
    return cloneAiGenerationConfig();
  }
}

export function serializeAiGenerationConfig(config: AiGenerationConfig) {
  return JSON.stringify(normalizeAiGenerationConfig(config));
}

export function normalizeStoreAiUsagePermissions(input: unknown): StoreAiUsagePermissions {
  const source = input && typeof input === "object" ? input as Partial<StoreAiUsagePermissions> : {};
  const owner = source.owner && typeof source.owner === "object" ? source.owner as Partial<StoreAiUsagePermissions["owner"]> : {};
  const staff = source.staff && typeof source.staff === "object" ? source.staff as Partial<StoreAiUsagePermissions["staff"]> : {};
  return {
    owner: {
      copy: typeof owner.copy === "boolean" ? owner.copy : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.copy,
      image: typeof owner.image === "boolean" ? owner.image : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.image,
      video: typeof owner.video === "boolean" ? owner.video : DEFAULT_STORE_AI_USAGE_PERMISSIONS.owner.video,
    },
    staff: {
      copy: typeof staff.copy === "boolean" ? staff.copy : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.copy,
      image: typeof staff.image === "boolean" ? staff.image : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.image,
      video: typeof staff.video === "boolean" ? staff.video : DEFAULT_STORE_AI_USAGE_PERMISSIONS.staff.video,
    },
  };
}

export function storeAiUsagePermissions(data: AppData) {
  return normalizeStoreAiUsagePermissions(data.storeProfiles[0]?.aiUsagePermissions);
}

export function aiCapabilityPlatformEnabled(config: AiGenerationConfig, capability: AiUsageCapability) {
  if (capability === "copy") return config.copy.enabled;
  if (capability === "image") return config.image.enabled;
  return config.video.providers.some((provider) => provider.enabled);
}

export function aiCapabilityUsageState(config: AiGenerationConfig, permissions: StoreAiUsagePermissions, role: UserRole, capability: AiUsageCapability) {
  if (!aiCapabilityPlatformEnabled(config, capability)) return { enabled: false, label: "平台未启用" };
  const group: keyof StoreAiUsagePermissions = role === "owner" || role === "manager" ? "owner" : "staff";
  if (!permissions[group][capability]) return { enabled: false, label: "未开通" };
  return { enabled: true, label: "可用" };
}
