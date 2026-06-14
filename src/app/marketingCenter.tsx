import { useEffect, useState } from "react";
import { Copy, Download, Eye, Image as ImageIcon, Megaphone, Plus, Search, Sparkles, X } from "lucide-react";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import type { UserSession } from "../domain/auth";
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
type MarketingNode = { title: string; badge: string; description: string };

const marketingNodes: MarketingNode[] = [
  { title: "夏季祛湿", badge: "当前推荐", description: "适合湿重、虚胖、身体沉、出汗少客户。" },
  { title: "三伏预热", badge: "适合药浴/艾灸", description: "提前做三伏养阳铺垫，适合会员复购。" },
  { title: "阳气养护", badge: "节气内容", description: "不硬促销，用身体状态带出护理必要性。" },
];
const customerTypes = ["新客户", "老客户", "沉睡客户"];
const bodyStates = ["怕冷湿重", "久坐肩颈", "熬夜暗沉", "皮肤干燥", "睡眠不好"];
const marketingGoals = ["复购提醒", "项目转化", "沉睡唤醒", "护理建议"];
const posterStyles = [
  { title: "中医养生风", description: "宣纸、草药、药灸、温和调理" },
  { title: "节气海报", description: "三伏、三九、换季、时令提醒" },
  { title: "轻奢护理风", description: "适合皮肤管理和高客单护理" },
  { title: "小红书种草", description: "痛点标题、体验感、收藏转化" },
];
const channels = ["朋友圈", "小红书", "私聊", "社群"];
const posterSizes = ["朋友圈 1:1", "小红书 3:4", "竖版 9:16", "横版 16:9"];
const USD_TO_CNY_DISPLAY_RATE = 6.77;

function aiCostAmountUsd(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return undefined;
  if (typeof cost === "number") return Number.isFinite(cost) ? cost : undefined;
  return Number.isFinite(cost.amountUsd) ? cost.amountUsd : undefined;
}

function formatAiCostRmb(cost?: MarketingAiRecord["cost"] | { amountUsd: number; priceConfigured?: boolean } | number) {
  if (!cost) return "费用未返回";
  const amountUsd = aiCostAmountUsd(cost);
  if (amountUsd === undefined) return "费用未返回";
  if (typeof cost !== "number" && cost.priceConfigured === false) return "费用未配置";
  const amount = amountUsd * USD_TO_CNY_DISPLAY_RATE;
  if (amount > 0 && amount < 0.01) return `¥${amount.toFixed(6)}`;
  if (amount > 0 && amount < 1) return `¥${amount.toFixed(4)}`;
  return `¥${amount.toFixed(2)}`;
}

function formatAiCostUsd(cost?: { amountUsd: number; currency: "USD"; basis: string; priceConfigured: boolean; estimated: boolean }) {
  if (!cost) return "费用未返回";
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
  return record.text || record.videoUrl || record.imageDataUrl || "";
}

function marketingRecordKindLabel(kind: MarketingAiRecord["kind"]) {
  return kind === "image" ? "海报" : kind === "video" ? "视频" : kind === "talk" ? "话术" : "营销内容";
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
    marketingRecordKindLabel(record.kind),
    compactRecordText(record.channel) || "未标记渠道",
    shortRecordTime(record.createdAt),
  ].filter(Boolean).join(" · ");
}

function shortRecordTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "时间未记录";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
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
  if (record.imageDataUrl) {
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

export function MarketingCenter({ data, session, actions }: { data: AppData; session: UserSession; actions: ApiActions }) {
  const [activeView, setActiveView] = useState<MarketingViewKey>("content");
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [marketingNode, setMarketingNode] = useState(marketingNodes[0].title);
  const [customerType, setCustomerType] = useState("老客户");
  const [bodyState, setBodyState] = useState("怕冷湿重");
  const [channel, setChannel] = useState("朋友圈");
  const [marketingGoal, setMarketingGoal] = useState("复购提醒");
  const [posterStyle, setPosterStyle] = useState("中医养生风");
  const [posterSize, setPosterSize] = useState("朋友圈 1:1");
  const [customRequirement, setCustomRequirement] = useState("");
  const [productImageName, setProductImageName] = useState("");
  const [sceneImageName, setSceneImageName] = useState("");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationResult, setGenerationResult] = useState<Awaited<ReturnType<ApiActions["generateMarketingAi"]>> | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [copyResultStatus, setCopyResultStatus] = useState<"idle" | "copied" | "failed">("idle");
  const product = data.products.find((item) => item.id === productId) ?? data.products[0];
  const service = data.services.find((item) => item.id === serviceId) ?? data.services[0];
  const storeName = primaryStoreName(data) || "门店";
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const aiPermissions = storeAiUsagePermissions(data);
  const contentState = aiCapabilityUsageState(aiConfig, aiPermissions, session.user.role, "copy");
  const audienceSummary = `${customerType}，${bodyState}`;
  const previewSummaryItems = [marketingNode, customerType, bodyState, channel, marketingGoal];
  const marketingAiRecords = [...(data.marketingAiRecords ?? [])].sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt));
  const selectedMarketingRecord = marketingAiRecords.find((record) => record.id === selectedRecordId);
  const dialogRecord = selectedMarketingRecord ?? generationResult?.record;
  const dialogText = dialogRecord?.text ?? generationResult?.text;
  const dialogImageDataUrl = dialogRecord?.imageDataUrl ?? generationResult?.imageDataUrl;
  const dialogCost = dialogRecord?.cost ?? generationResult?.cost;
  const dialogProvider = dialogRecord?.provider ?? generationResult?.provider;
  const dialogModel = dialogRecord?.model ?? generationResult?.model;
  const dialogSummaryItems = dialogRecord
    ? [dialogRecord.marketingNode, dialogRecord.customerType, dialogRecord.bodyState, dialogRecord.channel, dialogRecord.marketingGoal].filter(Boolean)
    : previewSummaryItems;
  const showGenerationDialog = Boolean(generationBusy || generationError || generationResult || selectedMarketingRecord);
  const showAiTechnicalDetails = session.user.role === "superadmin";
  const permissionStateKey = JSON.stringify({ role: session.user.role, permissions: aiPermissions, config: aiConfig });
  const unavailableMessage = () => {
    if (contentState.label === "未开通") return "当前门店未开放 AI 营销内容权限";
    if (contentState.label === "平台未启用") return "AI 营销内容平台未启用";
    return "AI 营销内容暂不可用";
  };

  useEffect(() => {
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    setCopyResultStatus("idle");
  }, [activeView]);

  useEffect(() => {
    if (contentState.enabled) return;
    setGenerationResult(null);
    setCopyResultStatus("idle");
    setGenerationError(unavailableMessage());
  }, [contentState.enabled, contentState.label, permissionStateKey]);

  const generate = async () => {
    if (!contentState.enabled) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError(unavailableMessage());
      return;
    }
    setGenerationBusy(true);
    setGenerationError("");
    setGenerationResult(null);
    setSelectedRecordId("");
    try {
      setGenerationResult(await actions.generateMarketingAi({
        kind: "copy",
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
        sceneImageName,
        customRequirement,
      }));
      setCopyResultStatus("idle");
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "AI 生成失败");
    } finally {
      setGenerationBusy(false);
    }
  };

  const copyGenerationText = async () => {
    const copied = await copyTextToClipboard(dialogText || "");
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const copyRecord = async (record: MarketingAiRecord) => {
    const copied = await copyTextToClipboard(marketingRecordContent(record));
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  const downloadPoster = () => {
    if (!dialogImageDataUrl) return;
    const title = dialogRecord ? marketingRecordTitle(dialogRecord) : `AI营销内容-${new Date().toISOString().slice(0, 10)}`;
    downloadDataUrl(dialogImageDataUrl, `${title}${dialogImageDataUrl.startsWith("data:image/svg+xml") ? ".svg" : ".png"}`);
  };

  return (
    <div className="page-stack marketing-center-page">
      <PageHero
        icon={<Megaphone size={18} />}
        eyebrow="AI智能营销"
        title="营销中心"
      />

      <section className="marketing-mode-tabs" aria-label="营销中心视图">
        <button type="button" className={activeView === "content" ? "active" : ""} onClick={() => setActiveView("content")}>
          <Sparkles size={16} /> 营销内容
        </button>
        <button type="button" className={activeView === "records" ? "active" : ""} onClick={() => setActiveView("records")}>
          <Eye size={16} /> 生成记录 <span>{marketingAiRecords.length}</span>
        </button>
      </section>

      {activeView === "content" ? (
        <section className="marketing-workspace">
          <div className="workbench-panel marketing-form-panel">
            <PanelTitle icon={<Search size={18} />} title="AI营销内容" action={contentState.label} />
            <div className="marketing-context-block marketing-primary-block">
              <div className="marketing-section-head">
                <div>
                  <strong>今天推荐</strong>
                  <span>按节气、季节和项目周期推荐</span>
                </div>
              </div>
              <div className="marketing-node-grid" aria-label="推荐营销节点">
                {marketingNodes.map((item) => (
                  <button type="button" key={item.title} className={marketingNode === item.title ? "active" : ""} onClick={() => setMarketingNode(item.title)}>
                    <span>{item.badge}</span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="marketing-context-block marketing-primary-block">
              <div className="marketing-section-head">
                <div>
                  <strong>基础条件</strong>
                  <span>先确定发给谁、发哪里、想达到什么目的</span>
                </div>
              </div>
              <div className="marketing-config-stack">
                <div className="marketing-config-row">
                  <div className="marketing-config-label">
                    <strong>发给谁</strong>
                    <small>客户状态</small>
                  </div>
                  <div className="marketing-chip-row" aria-label="客户类型">
                    {customerTypes.map((item) => (
                      <button type="button" key={item} className={customerType === item ? "active" : ""} onClick={() => setCustomerType(item)}>{item}</button>
                    ))}
                  </div>
                </div>
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

            <label className="marketing-custom-field">
              <span>我想自己写要求</span>
              <textarea
                value={customRequirement}
                onChange={(event) => setCustomRequirement(event.target.value)}
                rows={3}
                placeholder="例如：重点推三伏药浴，语气温和，不要太像广告。"
              />
            </label>

            <p className="marketing-context-note">当前将生成一套适合{channel}发布的营销内容，包含配套文案和可下载海报。</p>

            <details className="marketing-advanced-options">
              <summary>
                <span>更多条件</span>
                <small>商品、项目、身体状态、图片素材</small>
              </summary>
              <div className="marketing-advanced-body">
                <div className="marketing-form-grid">
                  <label>
                    <span>商品</span>
                    <select value={product?.id ?? ""} onChange={(event) => setProductId(event.target.value)}>
                      {data.products.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>项目</span>
                    <select value={service?.id ?? ""} onChange={(event) => setServiceId(event.target.value)}>
                      {data.services.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="marketing-config-row">
                  <div className="marketing-config-label">
                    <strong>身体状态</strong>
                    <small>文案痛点</small>
                  </div>
                  <div className="marketing-chip-row" aria-label="身体状态">
                    {bodyStates.map((item) => (
                      <button type="button" key={item} className={bodyState === item ? "active" : ""} onClick={() => setBodyState(item)}>{item}</button>
                    ))}
                  </div>
                </div>
                <div className="marketing-section-head compact">
                  <div>
                    <strong>海报风格</strong>
                    <span>文案和图片一起变</span>
                  </div>
                </div>
                <div className="marketing-style-grid" aria-label="海报风格">
                  {posterStyles.map((item) => (
                    <button type="button" key={item.title} className={posterStyle === item.title ? "active" : ""} onClick={() => setPosterStyle(item.title)}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </button>
                  ))}
                </div>
                <div className="marketing-upload-grid">
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>产品图</strong>
                    <span>{productImageName || "上传图片"}</span>
                    <input type="file" accept="image/*" onChange={(event) => setProductImageName(event.target.files?.[0]?.name ?? "")} />
                  </label>
                  <label className="marketing-upload-box">
                    <Plus size={18} />
                    <strong>门店素材</strong>
                    <span>{sceneImageName || "上传图片"}</span>
                    <input type="file" accept="image/*" onChange={(event) => setSceneImageName(event.target.files?.[0]?.name ?? "")} />
                  </label>
                </div>
                <label>
                  <span>海报尺寸</span>
                  <select value={posterSize} onChange={(event) => setPosterSize(event.target.value)}>
                    {posterSizes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
            </details>
            <div className="marketing-form-actions single">
              <button type="button" className="primary-button" disabled={!contentState.enabled || generationBusy} onClick={generate}>
                <Sparkles size={16} /> {generationBusy ? "生成中..." : "生成营销内容"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="workbench-panel marketing-record-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="生成记录" action={`${marketingAiRecords.length} 条`} />
          <div className="marketing-record-list">
            {marketingAiRecords.slice(0, 12).map((record) => (
              <article key={record.id} className="marketing-record-item">
                <div className="marketing-record-main">
                  <span className="marketing-record-type">{marketingRecordKindLabel(record.kind)}</span>
                  <strong>{marketingRecordTitle(record)}</strong>
                  <span className="marketing-record-summary">{record.marketingNode || marketingRecordSummary(record)}</span>
                  <small>{marketingRecordMeta(record)}</small>
                </div>
                <div className="marketing-record-cost">
                  <span>本次费用</span>
                  <b>{formatAiCostRmb(record.cost)}</b>
                </div>
                <div className="marketing-record-actions">
                  <button type="button" aria-label="查看记录" onClick={() => setSelectedRecordId(record.id)}><Eye size={15} /></button>
                  <button type="button" aria-label="复制文案" onClick={() => void copyRecord(record)}><Copy size={15} /></button>
                  <button type="button" aria-label="下载图片" onClick={() => downloadMarketingRecord(record)}><Download size={15} /></button>
                </div>
              </article>
            ))}
            {marketingAiRecords.length === 0 && <p className="empty">暂无生成记录</p>}
          </div>
        </section>
      )}

      {showGenerationDialog && (
        <div className="marketing-result-overlay" role="presentation">
          <section className="marketing-result-dialog marketing-content-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-result-title">
            <div className="marketing-result-dialog-head">
              <div>
                <span>生成结果</span>
                <h2 id="marketing-result-title">AI营销内容</h2>
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
                {generationBusy && <p className="marketing-result-status">AI 正在生成营销内容，请稍候。</p>}
                {generationError && <p className="marketing-result-error">{generationError}</p>}
                {(dialogText || dialogImageDataUrl) && (
                  <div className="marketing-content-result-grid">
                    <article className="marketing-poster-card">
                      <div className="marketing-result-head">
                        <div>
                          <strong>海报预览</strong>
                          <span>和文案同一条记录</span>
                        </div>
                      </div>
                      {dialogImageDataUrl ? (
                        <img className="marketing-result-image" src={dialogImageDataUrl} alt="AI 营销海报" />
                      ) : (
                        <div className="marketing-poster-placeholder">
                          <ImageIcon size={26} />
                          <span>生成后显示海报</span>
                        </div>
                      )}
                    </article>
                    <article className="marketing-result-copy">
                      <div className="marketing-result-head">
                        <div>
                          <strong>配套文案</strong>
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
                      <div className="marketing-result-actions">
                        <button type="button" className="secondary-button" onClick={() => void copyGenerationText()} disabled={!dialogText}>
                          <Copy size={16} /> {copyResultStatus === "copied" ? "已复制" : copyResultStatus === "failed" ? "复制失败" : "复制文案"}
                        </button>
                        <button type="button" className="secondary-button" onClick={downloadPoster} disabled={!dialogImageDataUrl}>
                          <Download size={16} /> 下载图片
                        </button>
                        <button type="button" className="secondary-button" disabled>
                          <Sparkles size={16} /> 已保存记录
                        </button>
                      </div>
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
