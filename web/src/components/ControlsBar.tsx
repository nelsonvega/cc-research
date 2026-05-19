import { ModePicker } from "./ModePicker";
import { ModelPicker } from "./ModelPicker";
import { TopicEditor } from "./TopicEditor";
import { RunButton } from "./RunButton";
import { ResultFilter } from "./ResultFilter";

export function ControlsBar() {
  return (
    <div className="controls-bar">
      <div className="controls-row controls-row--meta">
        <div className="controls-cell">
          <span className="label">▸ Filter results</span>
          <ResultFilter />
        </div>
        <div className="controls-cell">
          <span className="label">▸ Mode</span>
          <ModePicker />
        </div>
        <div className="controls-cell">
          <ModelPicker />
        </div>
      </div>
      <div className="controls-row controls-row--topics">
        <TopicEditor />
      </div>
      <div className="controls-row controls-row--run">
        <RunButton />
      </div>
    </div>
  );
}
