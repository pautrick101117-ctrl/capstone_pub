import { useMasterData } from "../hooks/useMasterData";
import { Button, SelectInput } from "./ui";

export const MasterDataSelect = ({ category, placeholder = "Select an option", className = "", disabled, hint, error, ...props }) => {
  const { options, loading, error: loadError, reload } = useMasterData(category);
  const empty = !loading && !loadError && options.length === 0;

  return (
    <div className={`space-y-2 ${className}`}>
      <SelectInput
        {...props}
        disabled={disabled}
        aria-busy={loading}
        error={error || (loadError ? "Unable to load options. Try again." : "")}
        hint={empty ? "No active options are configured. Add or activate them in Admin Settings, then reload options." : hint}
      >
        <option value="">{loading ? "Loading options..." : loadError ? "Options unavailable" : empty ? "No active options" : placeholder}</option>
        {options.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}
      </SelectInput>
      {loadError || empty ? <Button type="button" variant="secondary" onClick={reload}>Reload options</Button> : null}
    </div>
  );
};
