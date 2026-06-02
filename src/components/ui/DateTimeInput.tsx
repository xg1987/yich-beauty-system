import { CalendarDays } from "lucide-react";
import { useRef } from "react";

type DateTimeInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export function DateTimeInput({ label, value, onChange }: DateTimeInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    try {
      pickerInput.showPicker?.();
    } catch {
      input.focus();
    }
  };

  return (
    <label className="datetime-field">
      <span>{label}</span>
      <div className="datetime-field-control" onClick={openPicker}>
        <input
          ref={inputRef}
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
        />
        <CalendarDays size={17} />
      </div>
    </label>
  );
}
