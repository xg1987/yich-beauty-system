import { ClipboardList, LockKeyhole } from "lucide-react";
import { type FormEvent, type PointerEvent, type TouchEvent, useEffect, useRef, useState } from "react";
import type { PublicCustomerSignaturePayload } from "../../api/client";
import { BrandIcon } from "../../components/business/BrandIcon";
import { PanelTitle } from "../../components/layout/PanelTitle";
import { money, shortDate } from "../../domain/utils";
import { canvasToSignatureDataUrl } from "../../lib/signatureImage";

type CustomerSignaturePageProps = {
  token: string;
  fetchSignature: (token: string) => Promise<PublicCustomerSignaturePayload>;
  signSignature: (token: string, body: { signerName: string; signatureText: string }) => Promise<PublicCustomerSignaturePayload>;
};

type SignaturePoint = {
  x: number;
  y: number;
};

export default function CustomerSignaturePage({ token, fetchSignature, signSignature }: CustomerSignaturePageProps) {
  const [payload, setPayload] = useState<PublicCustomerSignaturePayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [signerName, setSignerName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    void fetchSignature(token)
      .then((nextPayload) => {
        if (!alive) return;
        setPayload(nextPayload);
        setSignerName(nextPayload.customer?.name ?? "");
      })
      .catch((caught) => {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "签名链接加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchSignature, token]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError(undefined);
    if (!signerName.trim()) {
      setError("请填写签名人姓名");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) {
      setError("请完成手写签名");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    void signSignature(token, { signerName, signatureText: canvasToSignatureDataUrl(canvas) })
      .then(setPayload)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "签名提交失败"))
      .finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
  };

  const signaturePoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number): SignaturePoint => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const drawSignaturePoint = (canvas: HTMLCanvasElement, point: SignaturePoint) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#15141a";
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  };

  const startSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    if (submitting) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    drawingRef.current = true;
    const point = signaturePoint(canvas, event.clientX, event.clientY);
    context.beginPath();
    context.moveTo(point.x, point.y);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile WebViews do not allow pointer capture on canvas.
    }
  };

  const drawSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    if (submitting || !drawingRef.current) return;
    event.preventDefault();
    const point = signaturePoint(event.currentTarget, event.clientX, event.clientY);
    drawSignaturePoint(event.currentTarget, point);
  };

  const startTouchSignature = (event: TouchEvent<HTMLCanvasElement>) => {
    if (submitting) return;
    const touch = event.touches[0];
    const context = event.currentTarget.getContext("2d");
    if (!touch || !context) return;
    event.preventDefault();
    drawingRef.current = true;
    const point = signaturePoint(event.currentTarget, touch.clientX, touch.clientY);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const drawTouchSignature = (event: TouchEvent<HTMLCanvasElement>) => {
    if (submitting || !drawingRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    const point = signaturePoint(event.currentTarget, touch.clientX, touch.clientY);
    drawSignaturePoint(event.currentTarget, point);
  };

  const stopTouchSignature = (event: TouchEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    stopSignature();
  };

  const stopSignature = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    if (submitting) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const signature = payload?.signature;
  const isSigned = signature?.status === "已签名";
  const returnToSystem = () => {
    window.location.assign("/?view=pos");
  };

  return (
    <div className="public-store-page signature-page">
      <main className="public-store-shell">
        <section className="public-store-hero signature-hero">
          <BrandIcon className="public-store-mark brand-icon-mark" />
          <span>客户确认签名</span>
          <h1>{signature?.title ?? "客户服务确认"}</h1>
          <p>{payload?.customer ? `${payload.customer.name} · ${payload.customer.phone}` : "请核对服务内容后签名确认"}</p>
          {signature && (
            <div className="signature-hero-meta" aria-label="签名状态">
              <span>{signature.status}</span>
              {payload?.order && <span>{payload.order.orderNo}</span>}
              {signature.expiresAt && <span>有效期至 {shortDate(signature.expiresAt)}</span>}
            </div>
          )}
        </section>
        <section className="public-store-panel">
          {loading && (
            <div className="signature-state-card">
              <strong>正在加载签名内容</strong>
              <span>请稍候，系统正在读取本次服务确认信息。</span>
            </div>
          )}
          {error && <p className="public-status error">{error}</p>}
          {!loading && error && !payload && (
            <div className="signature-state-card error">
              <strong>签名链接暂时无法打开</strong>
              <span>请联系门店重新发送签名链接，或回到门店现场确认。</span>
            </div>
          )}
          {!loading && payload && signature && (
            <div className={isSigned ? "signature-grid signature-grid-complete" : "signature-grid"}>
              <section className="signature-detail">
                <PanelTitle icon={<ClipboardList size={18} />} title="确认内容" action={signature.status} />
                <div className="signature-content-card">
                  <p>{signature.content}</p>
                </div>
                {payload.order && (
                  <div className="signature-info-list">
                    <span><small>订单</small>{payload.order.orderNo}</span>
                    <span><small>项目</small>{payload.order.serviceName}</span>
                    <span><small>实收</small>{money(payload.order.paidAmount)} · {payload.order.payMethod}</span>
                  </div>
                )}
                {payload.serviceRecord && (
                  <div className="signature-info-list">
                    <span><small>服务</small>{payload.serviceRecord.serviceName}</span>
                    <span><small>员工</small>{payload.serviceRecord.staffName}</span>
                    <span><small>护理步骤</small>{payload.serviceRecord.careSteps || "已完成服务流程"}</span>
                    <span><small>服务后</small>{payload.serviceRecord.afterNote || "无补充"}</span>
                    <span><small>下次建议</small>{payload.serviceRecord.nextCareAdvice || "无补充"}</span>
                  </div>
                )}
                {signature.expiresAt && <small className="signature-expiry">有效期至：{shortDate(signature.expiresAt)}</small>}
              </section>
              <form className="public-booking-form signature-form" onSubmit={submit} aria-busy={submitting}>
                <PanelTitle icon={<LockKeyhole size={18} />} title={isSigned ? "已完成签名" : "签名确认"} action={signature.signedAt ? shortDate(signature.signedAt) : undefined} />
                {isSigned ? (
                  <>
                    <div className="signed-box">
                      {signature.signatureText?.startsWith("data:image/") ? (
                        <img className="signature-image-large" src={signature.signatureText} alt="客户签名" />
                      ) : (
                        <strong>{signature.signatureText}</strong>
                      )}
                      <span>{signature.signerName} · {signature.signedAt ? shortDate(signature.signedAt) : ""}</span>
                    </div>
                    <div className="signature-complete-actions">
                      <button type="button" className="primary-button" onClick={returnToSystem}>
                        返回系统
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label>签名人姓名<input value={signerName} disabled={submitting} onChange={(event) => setSignerName(event.target.value)} /></label>
                    <label>
                      手写签名
                      <div className="signature-canvas-wrap">
                        <canvas
                          ref={canvasRef}
                          width={960}
                          height={420}
                          className="signature-canvas"
                          onPointerDown={startSignature}
                          onPointerMove={drawSignature}
                          onPointerUp={stopSignature}
                          onPointerCancel={stopSignature}
                          onTouchStart={startTouchSignature}
                          onTouchMove={drawTouchSignature}
                          onTouchEnd={stopTouchSignature}
                          onTouchCancel={stopTouchSignature}
                          aria-disabled={submitting}
                        />
                        {!hasSignature && <span>请在此处手写签名</span>}
                      </div>
                    </label>
                    <div className="signature-form-actions">
                      <button type="button" className="secondary-button" disabled={submitting} onClick={clearSignature}>清除签名</button>
                      <button className="primary-button" disabled={submitting} aria-busy={submitting}>
                        <LockKeyhole size={17} />
                        {submitting ? "签名提交中..." : "确认签名"}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
