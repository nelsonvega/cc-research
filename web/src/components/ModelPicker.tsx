import { useSettings } from "../state/settings";
import { useModels } from "../state/models";
import { ModelCombobox } from "./ModelCombobox";

export function ModelPicker() {
  const { data } = useModels();
  const mode = useSettings((s) => s.mode);
  const modelOverride = useSettings((s) => s.modelOverride);
  const setModelOverride = useSettings((s) => s.setModelOverride);

  if (!data) return null;
  const defaultId = data.mode_defaults[mode];
  const defaultLabel =
    data.models.find((m) => m.id === defaultId)?.label ?? defaultId;
  const orError = data.openrouter_catalog_error;

  return (
    <div>
      <div className="label-row">
        <span className="label">▸ Model</span>
        <span className="label-hint">
          {data.models.length} available · {mode} default
        </span>
      </div>
      <ModelCombobox
        models={data.models}
        value={modelOverride}
        defaultLabel={defaultLabel}
        onChange={setModelOverride}
      />
      {orError && (
        <p
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--red)",
            margin: "6px 0 0",
            fontFamily: "var(--mono)",
          }}
          title={orError}
        >
          OpenRouter catalog offline — using cached or none
        </p>
      )}
    </div>
  );
}
