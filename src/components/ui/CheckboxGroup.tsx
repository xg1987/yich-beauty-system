type CheckboxOption = {
  value: string;
  label: string;
};

type CheckboxGroupProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: CheckboxOption[];
};

export function CheckboxGroup({ label, values, onChange, options }: CheckboxGroupProps) {
  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  return (
    <fieldset className="check-group">
      <legend>{label}</legend>
      {options.length === 0 ? (
        <span>暂无可选项</span>
      ) : (
        options.map((option) => (
          <label key={option.value}>
            <input type="checkbox" checked={values.includes(option.value)} onChange={() => toggle(option.value)} />
            {option.label}
          </label>
        ))
      )}
    </fieldset>
  );
}

export default CheckboxGroup;
