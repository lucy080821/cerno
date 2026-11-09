"use client";

import { useEditor } from "@/lib/editor/store";
import { FilterControl } from "./FiltersPanel";
import { Icon } from "./fields";
import s from "./editor.module.css";

/** Thanh lọc nổi ở góc trên khi xem: bộ lọc dashboard + các lọc chéo đang bật (bấm vào chart/bảng). */
export function ViewFilters() {
  const filters = useEditor((st) => st.doc.filters);
  const filterValues = useEditor((st) => st.filterValues);
  const crossFilters = useEditor((st) => st.crossFilters);
  const clearCross = useEditor((st) => st.clearCrossFilters);
  const setValue = useEditor((st) => st.setFilterValue);

  const anyDash = Object.keys(filterValues).length > 0;
  if (filters.length === 0 && crossFilters.length === 0) return null;

  return (
    <div className={s.filterBar} role="group" aria-label="Bộ lọc">
      {filters.map((f) => <FilterControl key={f.id} filter={f} compact />)}

      {crossFilters.length > 0 && <span className={s.filterLabel}>Đang lọc</span>}
      {crossFilters.map((f) => (
        <button
          key={f.column}
          className={s.filterChip}
          title="Bỏ bộ lọc này"
          onClick={() => {
            const st = useEditor.getState();
            f.values.forEach((v) => st.toggleCrossFilter(f.column, v, f.originId, true));
          }}
        >
          {f.column}: {f.values.join(", ")} <Icon name="close" size={12} />
        </button>
      ))}

      {(crossFilters.length > 0 || anyDash) && (
        <button
          className={s.filterClear}
          onClick={() => {
            clearCross();
            Object.keys(filterValues).forEach((id) => setValue(id, null));
          }}
        >
          Xoá tất cả
        </button>
      )}
    </div>
  );
}
