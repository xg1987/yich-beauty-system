import { useEffect, useState, type ReactNode } from "react";
import { Copy, Gift, HeartHandshake, Megaphone, MessageCircle, Plus, Search, Sparkles } from "lucide-react";
import { PageHero } from "../components/layout/PageHero";
import { PanelTitle } from "../components/layout/PanelTitle";
import type { UserSession } from "../domain/auth";
import type { AiUsageCapability, AppData } from "../domain/types";
import type { ApiActions } from "../hooks/useApiData";
import {
  AI_PROVIDER_LABELS,
  AI_VIDEO_ASPECT_RATIOS,
  aiCapabilityUsageState,
  aiGenerationConfigFromSystemConfigs,
  copyTextToClipboard,
  customerOptionOf,
  primaryStoreName,
  storeAiUsagePermissions,
} from "./AuthenticatedApp";

type AiVideoAspectRatio = "9:16" | "1:1" | "16:9";

type MarketingToolKey = "copy" | "image" | "video" | "talk";
type MarketingNode = { title: string; badge: string; description: string };

const marketingNodeTabs = ["智能推荐", "今日节气", "未来7天", "项目周期", "客户生日", "沉睡唤醒"];
const marketingNodes: MarketingNode[] = [
  { title: "夏季祛湿", badge: "当前推荐", description: "适合湿重、虚胖、身体沉、出汗少客户。" },
  { title: "三伏预热", badge: "适合药浴/艾灸", description: "提前做三伏养阳铺垫，适合会员复购。" },
  { title: "阳气养护", badge: "节气内容", description: "不硬促销，用身体状态带出护理必要性。" },
];
const customerTypes = ["新客", "非会员老客", "会员客户", "沉睡客户", "高意向客户"];
const lifecycleNodes = ["项目周期到了", "卡项快用完", "余额不足", "生日关怀", "久未到店"];
const bodyStates = ["怕冷湿重", "久坐肩颈", "熬夜暗沉", "皮肤干燥", "睡眠不好"];
const marketingGoals = ["复购提醒", "项目转化", "沉睡唤醒", "护理建议"];
const posterStyles = [
  { title: "中医养生风", description: "宣纸、草药、药灸、温和调理" },
  { title: "节气海报", description: "三伏、三九、换季、时令提醒" },
  { title: "轻奢护理风", description: "适合皮肤管理和高客单护理" },
  { title: "小红书种草", description: "痛点标题、体验感、收藏转化" },
];

function formatAiCost(cost?: { amountUsd: number; currency: "USD"; basis: string; priceConfigured: boolean; estimated: boolean }) {
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

export function MarketingCenter({ data, session, actions }: { data: AppData; session: UserSession; actions: ApiActions }) {
  const [tool, setTool] = useState<MarketingToolKey>("copy");
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [marketingNodeTab, setMarketingNodeTab] = useState(marketingNodeTabs[0]);
  const [marketingNode, setMarketingNode] = useState(marketingNodes[0].title);
  const [customerType, setCustomerType] = useState("会员客户");
  const [lifecycleNode, setLifecycleNode] = useState("项目周期到了");
  const [bodyState, setBodyState] = useState("怕冷湿重");
  const [channel, setChannel] = useState("朋友圈");
  const [marketingGoal, setMarketingGoal] = useState("复购提醒");
  const [posterStyle, setPosterStyle] = useState("中医养生风");
  const [posterSize, setPosterSize] = useState("朋友圈 1:1");
  const [posterTitle, setPosterTitle] = useState("到店护理礼遇");
  const [posterOffer, setPosterOffer] = useState("限时体验价");
  const [productImageName, setProductImageName] = useState("");
  const [sceneImageName, setSceneImageName] = useState("");
  const [videoRatio, setVideoRatio] = useState<AiVideoAspectRatio>("9:16");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoScript, setVideoScript] = useState("门店护理环境、产品陈列、护理手法和预约引导。");
  const [talkScene, setTalkScene] = useState("复购邀约");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationResult, setGenerationResult] = useState<Awaited<ReturnType<ApiActions["generateMarketingAi"]>> | null>(null);
  const [copyResultStatus, setCopyResultStatus] = useState<"idle" | "copied" | "failed">("idle");
  const product = data.products.find((item) => item.id === productId) ?? data.products[0];
  const service = data.services.find((item) => item.id === serviceId) ?? data.services[0];
  const selectedCustomer = data.customers[0];
  const storeName = primaryStoreName(data) || "门店";
  const repeatCustomers = data.customers.filter((customer) => data.orders.some((order) => order.customerId === customer.id)).length;
  const aiConfig = aiGenerationConfigFromSystemConfigs(data.systemConfigs);
  const aiPermissions = storeAiUsagePermissions(data);
  const toolCards: Array<{ key: MarketingToolKey; capability: AiUsageCapability; label: string; icon: ReactNode; metric: string }> = [
    { key: "copy", capability: "copy", label: "AI写文案", icon: <MessageCircle size={20} />, metric: `${data.services.length} 个项目` },
    { key: "image", capability: "image", label: "AI做海报", icon: <Gift size={20} />, metric: `${data.products.length} 件商品` },
    { key: "video", capability: "video", label: "AI做视频", icon: <Megaphone size={20} />, metric: "短视频素材" },
    { key: "talk", capability: "copy", label: "私聊话术", icon: <HeartHandshake size={20} />, metric: `${repeatCustomers} 位客户` },
  ];
  const toolStateByKey = Object.fromEntries(toolCards.map((item) => [item.key, aiCapabilityUsageState(aiConfig, aiPermissions, session.user.role, item.capability)])) as Record<MarketingToolKey, { enabled: boolean; label: string }>;
  const channels = ["朋友圈", "小红书", "私聊", "社群"];
  const posterSizes = ["朋友圈 1:1", "小红书 3:4", "竖版 9:16", "横版 16:9"];
  const talkScenes = ["复购邀约", "沉睡唤醒", "护理回访", "到店提醒"];
  const activeToolState = toolStateByKey[tool];
  const selectedMarketingNode = marketingNodes.find((item) => item.title === marketingNode) ?? marketingNodes[0];
  const audienceSummary = `${customerType}，${lifecycleNode}，${bodyState}`;
  const previewTitle = marketingNode === "三伏预热"
    ? "夏天不是单纯出汗，是把寒湿往外赶的好时机"
    : marketingNode === "阳气养护"
      ? "趁身体阳气往外走，把调理做在合适的时候"
      : "这个夏天，把寒湿慢慢排出去";
  const previewChannelTitle = `${storeName}${marketingNode === "三伏预热" ? "三伏" : marketingNode}护理提醒`;
  const previewSummaryItems = [marketingNode, customerType, lifecycleNode, bodyState, channel];
  const permissionStateKey = JSON.stringify({ role: session.user.role, permissions: aiPermissions, config: aiConfig });
  const unavailableMessage = (toolKey: MarketingToolKey) => {
    const card = toolCards.find((item) => item.key === toolKey);
    const state = toolStateByKey[toolKey];
    if (state.label === "未开通") return `当前门店未开放${card?.label ?? "该功能"}权限`;
    if (state.label === "平台未启用") return `${card?.label ?? "该功能"}平台未启用`;
    return `${card?.label ?? "该功能"}暂不可用`;
  };

  useEffect(() => {
    if (toolStateByKey[tool]?.enabled) return;
    const firstEnabledTool = toolCards.find((item) => toolStateByKey[item.key].enabled);
    if (firstEnabledTool) setTool(firstEnabledTool.key);
  }, [permissionStateKey, tool]);

  useEffect(() => {
    setGenerationError("");
    setGenerationResult(null);
    setCopyResultStatus("idle");
  }, [tool]);

  useEffect(() => {
    if (activeToolState.enabled) return;
    setGenerationResult(null);
    setCopyResultStatus("idle");
    setGenerationError(unavailableMessage(tool));
  }, [activeToolState.enabled, activeToolState.label, permissionStateKey, tool]);

  const generate = async () => {
    if (!activeToolState.enabled) {
      setGenerationBusy(false);
      setGenerationResult(null);
      setCopyResultStatus("idle");
      setGenerationError(unavailableMessage(tool));
      return;
    }
    setGenerationBusy(true);
    setGenerationError("");
    setGenerationResult(null);
    try {
      setGenerationResult(await actions.generateMarketingAi({
        kind: tool,
        storeName,
        productName: product?.name,
        serviceName: service?.name,
        audience: audienceSummary,
        channel,
        marketingNode,
        customerType,
        lifecycleNode,
        bodyState,
        marketingGoal,
        posterStyle,
        posterSize,
        posterTitle,
        posterOffer,
        productImageName,
        sceneImageName,
        videoRatio,
        videoDuration,
        videoScript,
        talkScene,
        customerName: selectedCustomer?.name,
      }));
      setCopyResultStatus("idle");
    } catch (caught) {
      setGenerationError(caught instanceof Error ? caught.message : "AI 生成失败");
    } finally {
      setGenerationBusy(false);
    }
  };

  const copyGenerationText = async () => {
    const text = generationResult?.text ?? "";
    const copied = await copyTextToClipboard(text);
    setCopyResultStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyResultStatus("idle"), 1800);
  };

  return (
    <div className="page-stack marketing-center-page">
      <PageHero
        icon={<Megaphone size={18} />}
        eyebrow="AI智能营销"
        title="营销中心"
      />

      <section className="marketing-tool-grid" aria-label="营销工具">
        {toolCards.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`${tool === item.key ? "active" : ""} ${toolStateByKey[item.key].enabled ? "" : "disabled"}`}
            disabled={!toolStateByKey[item.key].enabled}
            onClick={() => setTool(item.key)}
          >
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <small>{toolStateByKey[item.key].label} · {item.metric}</small>
          </button>
        ))}
      </section>

      <section className="marketing-workspace">
        <div className="workbench-panel marketing-form-panel">
          <PanelTitle icon={<Search size={18} />} title={toolCards.find((item) => item.key === tool)?.label ?? "AI营销"} action={toolStateByKey[tool].label} />
          {(tool === "copy" || tool === "image" || tool === "video") && (
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
          )}
          <div className="marketing-context-block">
            <div className="marketing-section-head">
              <div>
                <strong>营销节点</strong>
                <span>系统按今天、节气、项目周期主动推荐</span>
              </div>
              <small>智能推荐</small>
            </div>
            <div className="marketing-node-tabs" aria-label="营销节点类型">
              {marketingNodeTabs.map((item) => (
                <button type="button" key={item} className={marketingNodeTab === item ? "active" : ""} onClick={() => setMarketingNodeTab(item)}>{item}</button>
              ))}
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
          <div className="marketing-context-block">
            <div className="marketing-section-head">
              <div>
                <strong>生成条件</strong>
                <span>分组设置，避免客户身份、身体状态、营销目的混在一起</span>
              </div>
            </div>
            <div className="marketing-config-stack">
              <div className="marketing-config-row">
                <div className="marketing-config-label">
                  <strong>客户类型</strong>
                  <small>身份单选</small>
                </div>
                <div className="marketing-chip-row" aria-label="客户类型">
                  {customerTypes.map((item) => (
                    <button type="button" key={item} className={customerType === item ? "active" : ""} onClick={() => setCustomerType(item)}>{item}</button>
                  ))}
                </div>
              </div>
              <div className="marketing-config-row">
                <div className="marketing-config-label">
                  <strong>消费节点</strong>
                  <small>来自客户记录</small>
                </div>
                <div className="marketing-chip-row" aria-label="消费节点">
                  {lifecycleNodes.map((item) => (
                    <button type="button" key={item} className={lifecycleNode === item ? "active" : ""} onClick={() => setLifecycleNode(item)}>{item}</button>
                  ))}
                </div>
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
              <div className="marketing-config-row">
                <div className="marketing-config-label">
                  <strong>发送渠道</strong>
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
                  <strong>营销目的</strong>
                  <small>行动引导</small>
                </div>
                <div className="marketing-chip-row" aria-label="营销目的">
                  {marketingGoals.map((item) => (
                    <button type="button" key={item} className={marketingGoal === item ? "active" : ""} onClick={() => setMarketingGoal(item)}>{item}</button>
                  ))}
                </div>
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
          </div>
          {tool === "copy" && (
            <p className="marketing-context-note">当前将生成适合{channel}发布的{marketingGoal}文案。</p>
          )}
          {tool === "image" && (
            <>
              <div className="marketing-upload-grid">
                <label className="marketing-upload-box">
                  <Plus size={18} />
                  <strong>产品图</strong>
                  <span>{productImageName || "上传图片"}</span>
                  <input type="file" accept="image/*" onChange={(event) => setProductImageName(event.target.files?.[0]?.name ?? "")} />
                </label>
                <label className="marketing-upload-box">
                  <Plus size={18} />
                  <strong>场景图</strong>
                  <span>{sceneImageName || "上传图片"}</span>
                  <input type="file" accept="image/*" onChange={(event) => setSceneImageName(event.target.files?.[0]?.name ?? "")} />
                </label>
              </div>
              <div className="marketing-form-grid">
                <label>
                  <span>海报尺寸</span>
                  <select value={posterSize} onChange={(event) => setPosterSize(event.target.value)}>
                    {posterSizes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  <span>活动信息</span>
                  <input value={posterOffer} onChange={(event) => setPosterOffer(event.target.value)} />
                </label>
              </div>
              <label className="marketing-text-field">
                <span>海报标题</span>
                <input value={posterTitle} onChange={(event) => setPosterTitle(event.target.value)} />
              </label>
            </>
          )}
          {tool === "video" && (
            <>
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
              <div className="marketing-form-grid">
                <label>
                  <span>视频比例</span>
                  <select value={videoRatio} onChange={(event) => setVideoRatio(event.target.value as AiVideoAspectRatio)}>
                    {AI_VIDEO_ASPECT_RATIOS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  <span>视频时长</span>
                  <select value={videoDuration} onChange={(event) => setVideoDuration(Number(event.target.value))}>
                    {[5, 10, 15].map((item) => <option key={item} value={item}>{item} 秒</option>)}
                  </select>
                </label>
              </div>
              <label className="marketing-text-field">
                <span>视频脚本</span>
                <textarea value={videoScript} onChange={(event) => setVideoScript(event.target.value)} rows={4} />
              </label>
            </>
          )}
          {tool === "talk" && (
            <>
              <div className="marketing-form-grid">
                <label>
                  <span>客户</span>
                  <select value={selectedCustomer?.id ?? ""} disabled>
                    {selectedCustomer ? <option value={selectedCustomer.id}>{customerOptionOf(selectedCustomer).label}</option> : <option value="">暂无客户</option>}
                  </select>
                </label>
                <label>
                  <span>场景</span>
                  <select value={talkScene} onChange={(event) => setTalkScene(event.target.value)}>
                    {talkScenes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
              <p className="marketing-context-note">当前将生成面向{customerType}的{talkScene}私聊话术。</p>
            </>
          )}
          <div className="marketing-form-actions single">
            <button type="button" className="primary-button" disabled={!activeToolState.enabled || generationBusy} onClick={generate}>
              <Sparkles size={16} /> {generationBusy ? "生成中..." : tool === "image" ? "AI生成海报" : tool === "video" ? "创建视频任务" : tool === "talk" ? "AI生成话术" : "AI生成文案"}
            </button>
          </div>
          {(generationBusy || generationError || generationResult) && (
            <div className="marketing-result-panel">
              {generationBusy && <p className="marketing-result-status">AI 正在生成，请稍候。</p>}
              {generationError && <p className="marketing-result-error">{generationError}</p>}
              {generationResult?.text && (
                <div className="marketing-result-copy">
                  <div className="marketing-result-head">
                    <div>
                      <strong>{tool === "talk" ? "话术结果" : "文案结果"}</strong>
                      <span>{AI_PROVIDER_LABELS[generationResult.provider]} · {generationResult.model}</span>
                    </div>
                    <div className="marketing-cost-pill">
                      <b>{formatAiCost(generationResult.cost)}</b>
                      <small>{formatAiUsageCostDetail(generationResult.cost)}</small>
                    </div>
                  </div>
                  <div className="marketing-copy-sections">
                    {marketingCopySections(generationResult.text).map((section) => (
                      <article key={section.title}>
                        <span>{section.title}</span>
                        <p>{section.body}</p>
                      </article>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" onClick={() => void copyGenerationText()}>
                    <Copy size={16} /> {copyResultStatus === "copied" ? "已复制" : copyResultStatus === "failed" ? "复制失败" : "复制结果"}
                  </button>
                </div>
              )}
              {generationResult?.imageDataUrl && (
                <div className="marketing-result-copy">
                  <div className="marketing-result-head">
                    <div>
                      <strong>海报结果</strong>
                      <span>{AI_PROVIDER_LABELS[generationResult.provider]} · {generationResult.model}</span>
                    </div>
                    <div className="marketing-cost-pill">
                      <b>{formatAiCost(generationResult.cost)}</b>
                      <small>{formatAiUsageCostDetail(generationResult.cost)}</small>
                    </div>
                  </div>
                  <img className="marketing-result-image" src={generationResult.imageDataUrl} alt="AI 生成海报" />
                  {generationResult.revisedPrompt && <p>{generationResult.revisedPrompt}</p>}
                </div>
              )}
              {generationResult && tool === "video" && (
                <div className="marketing-result-copy">
                  <div className="marketing-result-head">
                    <div>
                      <strong>视频任务</strong>
                      <span>{AI_PROVIDER_LABELS[generationResult.provider]} · {generationResult.model}</span>
                    </div>
                    <div className="marketing-cost-pill">
                      <b>{formatAiCost(generationResult.cost)}</b>
                      <small>{formatAiUsageCostDetail(generationResult.cost)}</small>
                    </div>
                  </div>
                  <p>状态：{generationResult.status ?? "已提交"}</p>
                  {generationResult.taskId && <p>任务 ID：{generationResult.taskId}</p>}
                  {generationResult.videoUrl && <a href={generationResult.videoUrl} target="_blank" rel="noreferrer">打开视频结果</a>}
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="workbench-panel marketing-preview-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="生成预览" action={posterStyle} />
          <div className="marketing-preview-summary" aria-label="当前生成条件">
            {previewSummaryItems.map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="marketing-preview-card">
            <div className={`marketing-preview-visual seasonal ${posterStyle === "中医养生风" || posterStyle === "节气海报" ? "wellness" : ""}`}>
              <span>{selectedMarketingNode.title} · {marketingGoal}</span>
              <strong>{previewTitle}</strong>
              <small>{service?.name ?? "护理项目"} · 适合{bodyState}、{customerType}</small>
            </div>
            <div className="marketing-preview-copy">
              <article>
                <span>{channel}标题</span>
                <p>{previewChannelTitle}：这个时间点，把护理安排在合适的时候。</p>
              </article>
              <article>
                <span>正文方向</span>
                <p>围绕{selectedMarketingNode.description.replace("。", "")}，结合{lifecycleNode}做{marketingGoal}，避免夸大医疗效果。</p>
              </article>
              <article>
                <span>私聊提醒</span>
                <p>你上次护理反馈不错，这几天适合安排一次{service?.name ?? "护理"}，把{marketingNode}做起来。</p>
              </article>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
