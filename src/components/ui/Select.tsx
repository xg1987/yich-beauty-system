import { useState } from "react";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  searchable?: boolean;
  placeholder?: string;
  emptyText?: string;
};

function normalizeOptionText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
  searchable = false,
  placeholder = "输入关键字搜索",
  emptyText = "没有匹配项",
}: SelectProps) {
  const [query, setQuery] = useState("");
  if (searchable) {
    const selected = options.find((option) => option.value === value);
    const normalizedQuery = normalizeOptionText(query);
    const results = normalizedQuery
      ? options.filter((option) => normalizeOptionText(option.label).includes(normalizedQuery)).slice(0, 8)
      : [];
    const updateQuery = (nextQuery: string) => {
      setQuery(nextQuery);
      const normalized = normalizeOptionText(nextQuery);
      if (!normalized) return;
      const exactMatches = options.filter((option) => !option.disabled && normalizeOptionText(option.label) === normalized);
      if (exactMatches.length === 1) {
        onChange(exactMatches[0].value);
      } else if (value) {
        onChange("");
      }
    };
    return (
      <div className="checkout-customer-search">
        <label>
          {label}
          <input
            value={query}
            disabled={disabled}
            onChange={(event) => updateQuery(event.currentTarget.value)}
            onCompositionEnd={(event) => updateQuery(event.currentTarget.value)}
            placeholder={selected?.label ?? placeholder}
          />
        </label>
        {selected && !query.trim() && (
          <div className="checkout-selected-customer">
            <span>已选择</span>
            <strong>{selected.label}</strong>
          </div>
        )}
        {query.trim() && (
          <div className="checkout-customer-result-list">
            {results.length ? results.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === value ? "active" : ""}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                }}
              >
                <strong>{option.label}</strong>
              </button>
            )) : <span className="checkout-customer-empty">{emptyText}</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </label>
  );
}

export default Select;
