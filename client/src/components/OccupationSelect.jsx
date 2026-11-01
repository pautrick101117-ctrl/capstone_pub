import { SelectInput, TextInput } from "./ui";

// Keep the submitted value as plain occupation text for existing API/database compatibility.
export const OCCUPATION_OPTIONS = [
  "Student",
  "Employed - Private Sector",
  "Employed - Government",
  "Self-employed",
  "Business Owner",
  "Farmer",
  "Fisherfolk",
  "Overseas Filipino Worker (OFW)",
  "Homemaker",
  "Unemployed",
  "Retired",
];

export default function OccupationSelect({ value = "", onChange, required = false, disabled = false, className = "", label = "Occupation" }) {
  const normalized = String(value || "");
  const known = OCCUPATION_OPTIONS.includes(normalized);
  const other = normalized === "Other" || (normalized && !known);
  const choice = known ? normalized : other ? "Other" : "";

  return (
    <div className={`space-y-3 ${className}`}>
      <SelectInput
        label={label}
        value={choice}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select occupation</option>
        {OCCUPATION_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value="Other">Other (specify)</option>
      </SelectInput>
      {other ? (
        <TextInput
          label="Specify occupation"
          placeholder="Enter occupation"
          maxLength={160}
          value={normalized === "Other" ? "" : normalized}
          required
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || "Other")}
          hint="This will be saved as the resident's occupation."
        />
      ) : null}
    </div>
  );
}
