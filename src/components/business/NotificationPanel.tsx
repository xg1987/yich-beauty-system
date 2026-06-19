import {
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CreditCard,
  HeartHandshake,
  PackagePlus,
  ShieldCheck,
  X,
} from "lucide-react";
import type { UserSession } from "../../domain/auth";
import { canAccessView } from "../../domain/auth";
import type { AppData, SystemNotification, ViewKey } from "../../domain/types";
import { shortDate } from "../../domain/utils";
import type { ApiActions } from "../../hooks/useApiData";
import { useState } from "react";

type RunMutation = (mutation: () => Promise<AppData>) => Promise<AppData>;

type NotificationPanelProps = {
  data: AppData;
  session: UserSession;
  actions: ApiActions;
  runMutation: RunMutation;
  mutationPending: boolean;
  setView: (view: ViewKey, options?: { appointmentId?: string }) => void;
  onClose: () => void;
};

export function visibleNotifications(data: AppData, session: UserSession) {
  return (data.notifications ?? [])
    .filter((item) => item.audienceRoles.includes(session.user.role))
    .filter((item) => session.user.role !== "therapist" || !item.staffId || item.staffId === session.user.staffId)
    .filter((item) => canAccessView(session, item.view))
    .slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

function notificationIcon(view: ViewKey) {
  if (view === "appointments") return CalendarDays;
  if (view === "customers") return HeartHandshake;
  if (view === "inventory") return PackagePlus;
  if (view === "approvals") return ShieldCheck;
  if (view === "pos") return CreditCard;
  if (view === "reports") return ChartNoAxesColumnIncreasing;
  return Bell;
}

function notificationAppointmentId(data: AppData, item: SystemNotification) {
  if (item.view !== "appointments") return undefined;
  if (item.targetType === "appointment") return item.targetId;
  const timeText = item.desc.match(/\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}/)?.[0];
  const customerName = item.desc.split("·")[0]?.trim();
  if (!timeText) return undefined;
  return data.appointments.find((appointment) => {
    const customer = data.customers.find((candidate) => candidate.id === appointment.customerId);
    if (customerName && customer?.name !== customerName) return false;
    return shortDate(appointment.startAt).startsWith(timeText);
  })?.id;
}

export function NotificationPanel({ data, session, actions, runMutation, mutationPending, setView, onClose }: NotificationPanelProps) {
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const items = visibleNotifications(data, session);
  const filteredItems = items.filter((item) => {
    const unread = !item.readByUserIds.includes(session.user.id);
    if (filter === "unread") return unread;
    if (filter === "read") return !unread;
    return true;
  });
  const unreadCount = items.filter((item) => !item.readByUserIds.includes(session.user.id)).length;
  const openNotification = (item: SystemNotification) => {
    const alreadyRead = item.readByUserIds.includes(session.user.id);
    if (!alreadyRead) {
      void runMutation(() => actions.markNotificationRead(item.id));
    }
    const appointmentId = notificationAppointmentId(data, item);
    onClose();
    window.setTimeout(() => {
      setView(item.view, appointmentId ? { appointmentId } : undefined);
    }, 0);
  };
  const markAllRead = () => {
    if (unreadCount === 0 || mutationPending) return;
    void runMutation(() => actions.markAllNotificationsRead());
  };

  return (
    <aside className="notification-panel">
      <div className="notification-head">
        <strong>通知</strong>
        <button type="button" disabled={mutationPending || unreadCount === 0} aria-busy={mutationPending} onClick={markAllRead}>{mutationPending ? "处理中..." : "✓ 全部已读"}</button>
        <button className="icon-button" aria-label="关闭通知" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="notification-filters" aria-label="通知筛选">
        {[
          { key: "all", label: "全部" },
          { key: "unread", label: `未读 ${unreadCount}` },
          { key: "read", label: "已读" },
        ].map((item) => (
          <button key={item.key} type="button" className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key as typeof filter)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="notification-list">
        {filteredItems.map((item) => {
          const Icon = notificationIcon(item.view);
          const unread = !item.readByUserIds.includes(session.user.id);
          return (
            <div key={item.id} className="notification-item">
              <button type="button" className={`notification-open ${unread ? "has-count" : "is-read"}`} onClick={() => openNotification(item)}>
                <Icon size={18} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.desc}</small>
                  <small>{shortDate(item.createdAt)}</small>
                </span>
                <em>{unread ? "新" : "已读"}</em>
              </button>
            </div>
          );
        })}
        {filteredItems.length === 0 && <p className="empty">暂无通知</p>}
      </div>
    </aside>
  );
}

export default NotificationPanel;
