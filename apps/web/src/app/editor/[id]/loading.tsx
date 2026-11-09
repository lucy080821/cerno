import { FullPageSpinner } from "@/components/Spinner";

/** Hiện ngay khi bấm mở dashboard, trong lúc server đọc dữ liệu. */
export default function Loading() {
  return <FullPageSpinner label="Đang mở dashboard…" />;
}
