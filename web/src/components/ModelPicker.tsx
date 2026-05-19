import { useState } from "react";
import { useSettings } from "../state/settings";
import { useModels } from "../state/models";
import { ModelCombobox } from "./ModelCombobox";

export function ModelPicker() {
  const { data } = useModels();
  const mode = useSettings((s) => s.mode);
  const models = useSettings((s) => s.models);
  const addModel = useSettings((s) => s.addModel);
  const removeModel = useSettings((s) => s.removeModel);
  const [draft, setDraft] = useState<string | null>(null);

  if (!data) return null;
  const defaultId = data.mode_defaults[mode];
  const defaultLabel =
    data.models.find((m) => m.id === defaultId)?.label ?? defaultId;
  const orError = data.openrouter_catalog_error;

  const commitDraft = (id: string | null) => {
    if (id) {
      addModel(id);
      setDraft(null); // reset combobox so user can pick another
    } else {
      setDraft(null);
    }
  };

  const labelFor = (id: string): string =>
    data.models.find((m) => m.id === id)?.label ?? id;

  return (
    <div>
      <div className="label-row">
        <span className="label">
          ▸ Model{models.length > 1 ? "s" : ""} ({models.length || "default"})
        </span>
        <span className="label-hint">
          {models.length === 0
            ? `using ${mode} default`
            : models.length === 1
              ? "single model"
              : `${models.length}× parallel`}
        </span>
      </div>

      {models.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 6, marginTop: 2 }}>
          {models.map((id) => (
            <span key={id} className="chip chip--model">
              {labelFor(id)}
              <button aria-label={`Remove ${id}`} onClick={() => removeModel(id)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <ModelCombobox
        models={data.models}
        value={draft}
        defaultLabel={
          models.length > 0 ? "+ add another model" : `Use default · ${defaultLabel}`
        }
        onChange={commitDraft}
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
