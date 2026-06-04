import { CalendarDays, LockKeyhole, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { PanelTitle } from "../../components/layout/PanelTitle";
import { DateTimeInput } from "../../components/ui/DateTimeInput";
import { Select } from "../../components/ui/Select";
import type { OnlineStorefront, Service, StoreProfile } from "../../domain/types";
import { money, toLocalInputValue, tomorrowAt } from "../../domain/utils";

type StorefrontPagePayload = {
  store?: StoreProfile;
  storefront: OnlineStorefront;
  services: Service[];
};

type StorefrontPageProps = {
  shareCode: string;
  fetchPublicStore: (shareCode: string) => Promise<StorefrontPagePayload>;
  createPublicBookingRequest: (body: { shareCode: string; customerName: string; phone: string; serviceId: string; preferredAt: string; note?: string }) => Promise<{ ok: boolean }>;
};

function optionOf(item: { id: string; name: string }) {
  return { value: item.id, label: item.name };
}

export default function StorefrontPage({ shareCode, fetchPublicStore, createPublicBookingRequest }: StorefrontPageProps) {
  const [payload, setPayload] = useState<StorefrontPagePayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [preferredAt, setPreferredAt] = useState(toLocalInputValue(tomorrowAt(14)));
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    void fetchPublicStore(shareCode)
      .then((nextPayload) => {
        if (!alive) return;
        setPayload(nextPayload);
        setServiceId(nextPayload.services[0]?.id ?? "");
      })
      .catch((caught) => {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "线上店铺加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchPublicStore, shareCode]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitted(false);
    void createPublicBookingRequest({
      shareCode,
      customerName,
      phone,
      serviceId,
      preferredAt: new Date(preferredAt).toISOString(),
      note,
    })
      .then(() => {
        setSubmitted(true);
        setCustomerName("");
        setPhone("");
        setNote("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "提交预约意向失败"));
  };

  const services = payload?.services ?? [];
  const selectedService = services.find((item) => item.id === serviceId);

  return (
    <div className="public-store-page">
      <main className="public-store-shell">
        <section className="public-store-hero">
          <div className="public-store-mark">祝</div>
          <span>{payload?.store?.name ?? "祝融｜坤锋"}</span>
          <h1>{payload?.storefront.headline ?? "祝融｜坤锋 美业门店系统"}</h1>
          <p>{payload?.storefront.description ?? "门店经营管理平台"}</p>
        </section>
        <section className="public-store-panel">
          {loading && <p className="empty">正在加载线上店铺</p>}
          {error && <p className="public-status error">{error}</p>}
          {!loading && !error && payload && (
            <div className="public-store-grid">
              <div>
                <PanelTitle icon={<Sparkles size={18} />} title="线上项目" action={`${services.length} 项开放预约`} />
                <div className="public-service-grid">
                  {services.map((service) => (
                    <button
                      type="button"
                      key={service.id}
                      className={`public-service-card ${service.id === serviceId ? "active" : ""}`}
                      onClick={() => setServiceId(service.id)}
                    >
                      <strong>{service.name}</strong>
                      <span>{service.category} · {service.duration} 分钟</span>
                      <em>{money(service.price)}</em>
                    </button>
                  ))}
                </div>
              </div>
              <form className="public-booking-form" onSubmit={submit}>
                <PanelTitle icon={<CalendarDays size={18} />} title="到店预约意向" action={selectedService ? money(selectedService.price) : undefined} />
                {submitted && <p className="public-status ok">预约意向已提交，门店会尽快联系确认到店时间。</p>}
                <label>姓名<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="请输入到店人姓名" /></label>
                <label>手机号<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="用于门店联系确认" /></label>
                <Select label="预约项目" value={serviceId} onChange={setServiceId} options={services.map(optionOf)} />
                <DateTimeInput label="期望到店时间" value={preferredAt} onChange={setPreferredAt} />
                <label>备注<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如皮肤状态、想咨询的问题" /></label>
                <button className="primary-button" disabled={!serviceId}>
                  <LockKeyhole size={17} />
                  提交预约意向
                </button>
              </form>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
