import { DoorOpen, Download, Monitor, Share2 } from "lucide-react";
import { useState } from "react";
import { BrandIcon } from "../../components/business/BrandIcon";
import packageJson from "../../../package.json";

const APP_VERSION = packageJson.version;
const APP_BUILD_DATE = "2026-06-12";

export default function DownloadGuidePage() {
  const appUrl = "https://zhurongkftech.com/";
  const androidApkUrl = "/zhurongkftech-app.apk";
  const [copiedKey, setCopiedKey] = useState("");
  const saveQrCode = () => {
    const link = document.createElement("a");
    link.href = "/download-qr.svg";
    link.download = "祝融坤锋美业系统二维码.svg";
    link.click();
  };
  const copyText = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1600);
  };

  return (
    <main className="download-guide-page">
      <section className="download-guide-shell">
        <section className="download-guide-brand">
          <BrandIcon className="download-guide-mark brand-icon-mark" />
          <h1>祝融坤锋美业</h1>
          <p>门店管理系统 · 内部使用</p>
        </section>

        <section className="download-guide-card download-qr-card">
          <p className="download-card-kicker">扫码访问 · 任意手机</p>
          <div className="download-qr-frame">
            <img src="/download-qr.svg" alt="祝融坤锋美业门店系统下载二维码" />
          </div>
          <div className="download-action-row">
            <button type="button" onClick={saveQrCode}>
              <Download size={16} />
              下载二维码图片
            </button>
          </div>
          <p className="download-card-tip">保存到相册 · 转发到群里 · 放大更好扫</p>
        </section>

        <section className="download-guide-card download-device-card">
          <div className="download-device-head">
            <div className="download-device-icon"><Monitor size={20} /></div>
            <div>
              <strong>电脑端</strong>
              <span>浏览器输入网址</span>
            </div>
          </div>
          <div className="download-device-body">
            <p>打开 Chrome、Edge 或 Safari，在地址栏输入：</p>
            <div className="download-url-row">
              <strong>{appUrl}</strong>
              <button type="button" onClick={() => copyText(appUrl, "app")}>
                {copiedKey === "app" ? "已复制" : "复制"}
              </button>
            </div>
          </div>
        </section>

        <section className="download-guide-card download-device-card android">
          <div className="download-device-head">
            <div className="download-device-icon"><DoorOpen size={20} /></div>
            <div>
              <strong>安卓手机</strong>
              <span>推荐添加到桌面</span>
            </div>
          </div>
          <div className="download-device-body">
            <div className="download-sub-card recommended">
              <strong>推荐 · 加到桌面</strong>
              <ol>
                <li>用手机浏览器打开 {appUrl}</li>
                <li>右上角菜单选择“添加到主屏幕”</li>
                <li>桌面出现系统图标，像 App 一样打开</li>
              </ol>
            </div>
            <details className="download-sub-card apk" open>
              <summary>备选 · 下载 .apk 安装</summary>
              <div>
                <p>如果浏览器提示「危险网站」，可以下载 .apk 直接安装绕开浏览器：</p>
                <div className="download-apk-version" aria-label={`安卓安装包版本 v${APP_VERSION}`}>
                  <span>当前安装包</span>
                  <strong>v{APP_VERSION}</strong>
                </div>
                <a className="download-apk-button" href={androidApkUrl} download>
                  <Download size={18} />
                  下载安卓安装包
                </a>
                <small>⚠ 安装提示「未知来源」时：设置 → 安全 → 允许安装未知应用 → 选浏览器 → 安装</small>
              </div>
            </details>
          </div>
        </section>

        <section className="download-guide-card download-device-card ios">
          <div className="download-device-head">
            <div className="download-device-icon"><Share2 size={20} /></div>
            <div>
              <strong>苹果手机</strong>
              <span>Safari 添加到主屏幕</span>
            </div>
          </div>
          <div className="download-device-body">
            <div className="download-sub-card ios-guide">
              <strong>用 Safari 加到桌面</strong>
              <ol>
                <li>用 Safari 打开 {appUrl}</li>
                <li>点击底部分享按钮</li>
                <li>选择“添加到主屏幕”并完成</li>
              </ol>
              <small>⚠ 必须用 Safari，微信内置浏览器不支持加桌面。</small>
            </div>
          </div>
        </section>

        <section className="download-guide-note">
          <p>遇到问题请联系管理员</p>
          <span>当前版本 v{APP_VERSION} · 门店内部使用 · 请勿外传</span>
        </section>
      </section>
    </main>
  );
}
