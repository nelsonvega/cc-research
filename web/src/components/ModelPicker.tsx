import { useSettings } from "../state/settings";
import { useModels } from "../state/models";

export function ModelPicker() {
  const { data } = useModels();
  const mode = useSettings((s) => s.mode);
  const modelOverride = useSettings((s) => s.modelOverride);
  const setModelOverride = useSettings((s) => s.setModelOverride);

  if (!data) return null;
  const defaultId = data.mode_defaults[mode];
  const defaultLabel = data.models.find((m) => m.id === defaultId)?.label ?? defaultId;

  return (
    <label className="col" style={{ gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Model</span>
      <select
        value={modelOverride ?? ""}
        onChange={(e) =>
          setModelOverride(e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">Default for {mode} mode · {defaultLabel}</option>
        {data.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
