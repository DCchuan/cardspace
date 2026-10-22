import { useRef, type RefObject } from "react";
import { Search, Plus } from "lucide-react";
export function WorkspaceSearch({
  value,
  onChange,
  onSearch,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const composing = useRef(false);
  return (
    <form
      className="workspace-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) onSearch();
      }}
    >
      <label className="search-input">
        <Search size={16} />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing || composing.current)
            )
              event.preventDefault();
          }}
          placeholder="搜索记忆、问题、关键词…"
          aria-label="搜索记忆"
        />
        <kbd>⌘ K</kbd>
      </label>
      <button className="btn search-submit" type="submit">
        搜索
      </button>
    </form>
  );
}
export function NewMemoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="btn primary new-memory-button"
      type="button"
      onClick={onClick}
    >
      <Plus size={18} />
      <span>新建记忆</span>
    </button>
  );
}
