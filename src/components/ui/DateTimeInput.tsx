import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

type DateTimeInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function DateTimeInput({ label, value, onChange, disabled = false }: DateTimeInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = useMemo(() => parseLocalDateTime(value), [value]);
  const [viewDate, setViewDate] = useState(() => selectedDate);
  const monthDays = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  const openPicker = () => {
    if (disabled) return;
    setViewDate(selectedDate);
    setIsOpen(true);
  };

  const updateDateTime = (nextDate: Date) => {
    if (disabled) return;
    onChange(toLocalDateTimeValue(nextDate));
  };

  const selectDay = (day: Date) => {
    const nextDate = new Date(selectedDate);
    nextDate.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    setViewDate(nextDate);
    updateDateTime(nextDate);
  };

  const selectHour = (hour: number) => {
    const nextDate = new Date(selectedDate);
    nextDate.setHours(hour);
    updateDateTime(nextDate);
  };

  const selectMinute = (minute: number) => {
    const nextDate = new Date(selectedDate);
    nextDate.setMinutes(minute);
    updateDateTime(nextDate);
  };

  const jumpMonth = (step: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + step, 1, current.getHours(), current.getMinutes()));
  };

  return (
    <div className="datetime-field">
      <span>{label}</span>
      <div className="datetime-field-control" onClick={openPicker} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}>
        <input type="text" value={formatDisplayValue(value)} readOnly disabled={disabled} />
        <CalendarDays size={17} />
      </div>
      {isOpen && (
        <div className="datetime-picker-backdrop" onClick={() => setIsOpen(false)}>
          <div className="datetime-picker-dialog" role="dialog" aria-modal="true" aria-label={`${label}选择`} onClick={(event) => event.stopPropagation()}>
            <div className="datetime-picker-head">
              <button type="button" onClick={() => jumpMonth(-1)} aria-label="上个月"><ChevronLeft size={18} /></button>
              <strong>{viewDate.getFullYear()}年{pad(viewDate.getMonth() + 1)}月</strong>
              <button type="button" onClick={() => jumpMonth(1)} aria-label="下个月"><ChevronRight size={18} /></button>
            </div>
            <div className="datetime-picker-body">
              <div className="datetime-picker-calendar">
                {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}
                {monthDays.map((day) => (
                  <button
                    type="button"
                    className={[
                      day.getMonth() === viewDate.getMonth() ? "" : "muted",
                      isSameDay(day, selectedDate) ? "selected" : "",
                    ].filter(Boolean).join(" ")}
                    key={day.toISOString()}
                    onClick={() => selectDay(day)}
                  >
                    {day.getDate()}
                  </button>
                ))}
              </div>
              <div className="datetime-picker-time">
                <div>
                  <span>时</span>
                  <div>
                    {hours.map((hour) => (
                      <button type="button" className={selectedDate.getHours() === hour ? "selected" : ""} key={hour} onClick={() => selectHour(hour)}>
                        {pad(hour)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span>分</span>
                  <div>
                    {minutes.map((minute) => (
                      <button type="button" className={selectedDate.getMinutes() === minute ? "selected" : ""} key={minute} onClick={() => selectMinute(minute)}>
                        {pad(minute)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="datetime-picker-actions">
              <button type="button" onClick={() => updateDateTime(new Date())}>今天</button>
              <button type="button" className="primary" onClick={() => setIsOpen(false)}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseLocalDateTime(value: string) {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplayValue(value: string) {
  const date = parseLocalDateTime(value);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildMonthGrid(viewDate: Date) {
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index));
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
