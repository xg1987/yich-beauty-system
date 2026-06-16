import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

type DateTimeInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  minDateTime?: string;
};

export function DateTimeInput({ label, value, onChange, disabled = false, minDateTime }: DateTimeInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = useMemo(() => parseLocalDateTime(value), [value]);
  const minDate = useMemo(() => minDateTime ? parseLocalDateTime(minDateTime) : undefined, [minDateTime]);
  const [viewDate, setViewDate] = useState(() => selectedDate);
  const [draftDate, setDraftDate] = useState(() => selectedDate);
  const monthDays = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  const openPicker = () => {
    if (disabled) return;
    const nextDate = clampToMinDate(selectedDate, minDate);
    setDraftDate(nextDate);
    setViewDate(nextDate);
    setIsOpen(true);
  };

  const updateDateTime = (nextDate: Date) => {
    if (disabled) return;
    const clampedDate = clampToMinDate(nextDate, minDate);
    onChange(toLocalDateTimeValue(clampedDate));
  };

  const updateDraftDate = (nextDate: Date) => {
    if (disabled) return;
    const clampedDate = clampToMinDate(nextDate, minDate);
    setDraftDate(clampedDate);
    setViewDate(clampedDate);
  };

  const selectDay = (day: Date) => {
    if (isBeforeMinDay(day, minDate)) return;
    const nextDate = new Date(draftDate);
    nextDate.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    updateDraftDate(nextDate);
  };

  const selectHour = (hour: number) => {
    const nextDate = new Date(draftDate);
    nextDate.setHours(hour);
    updateDraftDate(nextDate);
  };

  const selectMinute = (minute: number) => {
    const nextDate = new Date(draftDate);
    nextDate.setMinutes(minute);
    if (isBeforeMinDateTime(nextDate, minDate)) return;
    updateDraftDate(nextDate);
  };

  const jumpMonth = (step: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + step, 1, current.getHours(), current.getMinutes()));
  };

  const chooseNow = () => {
    updateDraftDate(new Date());
  };

  const confirmSelection = () => {
    updateDateTime(draftDate);
    setIsOpen(false);
  };

  const picker = (
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
                disabled={isBeforeMinDay(day, minDate)}
                className={[
                  day.getMonth() === viewDate.getMonth() ? "" : "muted",
                  isSameDay(day, draftDate) ? "selected" : "",
                  isBeforeMinDay(day, minDate) ? "disabled" : "",
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
                  <button
                    type="button"
                    disabled={isBeforeMinHour(draftDate, hour, minDate)}
                    className={[
                      draftDate.getHours() === hour ? "selected" : "",
                      isBeforeMinHour(draftDate, hour, minDate) ? "disabled" : "",
                    ].filter(Boolean).join(" ")}
                    key={hour}
                    onClick={() => selectHour(hour)}
                  >
                    {pad(hour)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>分</span>
              <div>
                {minutes.map((minute) => (
                  <button
                    type="button"
                    disabled={isBeforeMinMinute(draftDate, minute, minDate)}
                    className={[
                      draftDate.getMinutes() === minute ? "selected" : "",
                      isBeforeMinMinute(draftDate, minute, minDate) ? "disabled" : "",
                    ].filter(Boolean).join(" ")}
                    key={minute}
                    onClick={() => selectMinute(minute)}
                  >
                    {pad(minute)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="datetime-picker-actions">
          <button type="button" onClick={() => setIsOpen(false)}>取消</button>
          <button type="button" onClick={chooseNow}>现在</button>
          <button type="button" className="primary" onClick={confirmSelection}>确定</button>
        </div>
      </div>
    </div>
  );

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
      {isOpen && createPortal(picker, document.body)}
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

function clampToMinDate(date: Date, minDate?: Date) {
  return minDate && date < minDate ? new Date(minDate) : new Date(date);
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

function isBeforeMinDay(day: Date, minDate?: Date) {
  if (!minDate) return false;
  const dayStart = new Date(day);
  dayStart.setHours(23, 59, 59, 999);
  return dayStart < minDate;
}

function isBeforeMinHour(date: Date, hour: number, minDate?: Date) {
  if (!minDate) return false;
  const endOfHour = new Date(date);
  endOfHour.setHours(hour, 59, 59, 999);
  return endOfHour < minDate;
}

function isBeforeMinMinute(date: Date, minute: number, minDate?: Date) {
  if (!minDate) return false;
  const nextDate = new Date(date);
  nextDate.setMinutes(minute, 59, 999);
  return nextDate < minDate;
}

function isBeforeMinDateTime(date: Date, minDate?: Date) {
  return Boolean(minDate && date < minDate);
}
