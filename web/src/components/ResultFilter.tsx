import { useUi } from "../state/ui";

export function ResultFilter() {
  const value = useUi((s) => s.resultFilter);
  const set = useUi((s) => s.setResultFilter);
  return (
    <div className="result-filter">
      <input
        placeholder="Filter visible cards (headline · body · source)"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      {value && (
        <button
          className="result-filter-clear"
          title="Clear filter"
          onClick={() => set("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
