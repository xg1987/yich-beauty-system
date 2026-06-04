import { ClipboardList, LockKeyhole } from "lucide-react";
import { type FormEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { PublicCustomerSignaturePayload } from "../../api/client";
import { PanelTitle } from "../../components/layout/PanelTitle";
import { money, shortDate } from "../../domain/utils";

type CustomerSignaturePageProps = {
  token: string;
  fetchSignature: (token: string) => Promise<PublicCustomerSignaturePayload>;
  signSignature: (token: string, body: { signerName: string; signatureText: string }) => Promise<PublicCustomerSignaturePayload>;
};

export default function CustomerSignaturePage({ token, fetchSignature, signSignature }: CustomerSignaturePageProps) {
  const [payload, setPayload] = useState<PublicCustomerSignaturePayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [signerName, setSignerName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

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
    setError(undefined);
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) {
      setError("请完成手写签名");
      return;
    }
    void signSignature(token, { signerName, signatureText: canvas.toDataURL("image/png") })
      .then(setPayload)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "签名提交失败"));
  };

  const signaturePoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    drawingRef.current = true;
    const point = signaturePoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drawSignature = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = signaturePoint(event);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#15141a";
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  };

  const stopSignature = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const signature = payload?.signature;
  const isSigned = signature?.status === "已签名";

  return (
    <div className="public-store-page signature-page">
      <main className="public-store-shell">
        <section className="public-store-hero signature-hero">
          <div className="public-store-mark">祝</div>
          <span>客户确认签名</span>
          <h1>{signature?.title ?? "客户服务确认"}</h1>
          <p>{payload?.customer ? `${payload.customer.name} · ${payload.customer.phone}` : "请核对服务内容后签名确认"}</p>
        </section>
        <section className="public-store-panel">
          {loading && <p className="empty">正在加载签名内容</p>}
          {error && <p className="public-status error">{error}</p>}
          {!loading && payload && signature && (
            <div className="signature-grid">
              <section className="signature-detail">
                <PanelTitle icon={<ClipboardList size={18} />} title="确认内容" action={signature.status} />
                <p>{signature.content}</p>
                {payload.order && (
                  <div className="signature-info-list">
                    <span>订单：{payload.order.orderNo}</span>
                    <span>项目：{payload.order.serviceName}</span>
                    <span>实收：{money(payload.order.paidAmount)} · {payload.order.payMethod}</span>
                  </div>
                )}
                {payload.serviceRecord && (
                  <div className="signature-info-list">
                    <span>服务：{payload.serviceRecord.serviceName}</span>
                    <span>员工：{payload.serviceRecord.staffName}</span>
                    <span>护理步骤：{payload.serviceRecord.careSteps || "已完成服务流程"}</span>
                    <span>服务后：{payload.serviceRecord.afterNote || "无补充"}</span>
                    <span>下次建议：{payload.serviceRecord.nextCareAdvice || "无补充"}</span>
                  </div>
                )}
                {signature.expiresAt && <small>有效期至：{shortDate(signature.expiresAt)}</small>}
              </section>
              <form className="public-booking-form signature-form" onSubmit={submit}>
                <PanelTitle icon={<LockKeyhole size={18} />} title={isSigned ? "已完成签名" : "签名确认"} action={signature.signedAt ? shortDate(signature.signedAt) : undefined} />
                {isSigned ? (
                  <div className="signed-box">
                    {signature.signatureText?.startsWith("data:image/") ? (
                      <img src={signature.signatureText} alt="客户签名" style={{ width: "100%", maxWidth: 360, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, background: "#fff" }} />
                    ) : (
                      <strong>{signature.signatureText}</strong>
                    )}
                    <span>{signature.signerName} · {signature.signedAt ? shortDate(signature.signedAt) : ""}</span>
                  </div>
                ) : (
                  <>
                    <label>签名人姓名<input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label>
                    <label>
                      手写签名
                      <canvas
                        ref={canvasRef}
                        width={640}
                        height={220}
                        onPointerDown={startSignature}
                        onPointerMove={drawSignature}
                        onPointerUp={stopSignature}
                        onPointerCancel={stopSignature}
                        style={{ display: "block", width: "100%", height: 180, marginTop: 8, border: "1px solid rgba(0,0,0,0.14)", borderRadius: 8, background: "#fff", touchAction: "none" }}
                      />
                    </label>
                    <button type="button" className="secondary-button" onClick={clearSignature}>清除签名</button>
                    <button className="primary-button">
                      <LockKeyhole size={17} />
                      确认签名
                    </button>
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
