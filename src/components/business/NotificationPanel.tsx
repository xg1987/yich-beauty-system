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
  setView: (view: ViewKey) => void;
  onClose: () => void;
};

export function visibleNotifications(data: AppData, session: UserSession) {
  return (data.notifications ?? [])
    .filter((item) => item.audienceRoles.includes(session.user.role))
    .filter((item) => session.user.role !== "therapist" || !item.staffId || item.staffId === session.user.staffId)
    .filter((item) => canAccessView(session, item.view))
    .filter((item) => !(item.archivedByUserIds ?? []).includes(session.user.id))
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

export function NotificationPanel({ data, session, actions, runMutation, setView, onClose }: NotificationPanelProps) {
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
    setView(item.view);
    onClose();
  };
  const markAllRead = () => {
    if (unreadCount === 0) return;
    void runMutation(() => actions.markAllNotificationsRead());
  };
  const archiveItem = (item: SystemNotification) => {
    void runMutation(() => actions.archiveNotification(item.id));
  };

  return (
    <aside className="notification-panel">
      <div className="notification-head">
        <strong>通知中心</strong>
        {unreadCount > 0 && <button type="button" onClick={markAllRead}>全部已读</button>}
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
              <button type="button" className="notification-archive" onClick={() => archiveItem(item)}>归档</button>
            </div>
          );
        })}
        {filteredItems.length === 0 && <p className="empty">暂无通知</p>}
      </div>
    </aside>
  );
}

export default NotificationPanel;
