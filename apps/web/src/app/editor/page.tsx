import { redirect } from "next/navigation";

/** Editor luôn mở theo một dashboard cụ thể (/editor/<id>). Vào /editor trần thì về danh sách để chọn. */
export default function EditorIndex() {
  redirect("/dashboards");
}
