import { SEP } from "@/lib/fees/table-core";
import type { FeePlatform, SellerType } from "@/lib/fees/constants";
import { categoryList, categoryRate } from "@/lib/fees/tables";

/**
 * Phân ngành hàng loạt bằng AI theo CÂY ngành của biểu phí (hàm thuần, nhận hàm hỏi AI từ ngoài nên kiểm thử được).
 * Thay vì đưa cả ~1.400–2.000 ngành cho AI, đi từng cấp: cấp 1 (chừng 30 nhóm) → cấp 2 → cấp 3, mỗi lần AI chỉ chọn một số thứ tự trong
 * danh sách ngắn, nên rẻ, nhanh và AI không thể bịa ngành ngoài biểu. Sản phẩm AI không chắc (trả 0) được dừng ở nhóm đã chọn nếu nhóm đó
 * tự là một ngành có mức phí, còn không thì để trống (người gọi dùng mức phí mặc định).
 */

export interface TreeNode {
  name: string;
  /** Đường dẫn đầy đủ "Cấp 1 › Cấp 2 › ...". */
  path: string;
  children: TreeNode[];
  /** Đường dẫn này tự là một ngành có mức phí trong biểu. */
  isCategory: boolean;
}

/** Dựng cây ngành từ danh sách đường dẫn của biểu phí. */
export function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [], isCategory: false };
  const byPath = new Map<string, TreeNode>([["", root]]);
  for (const full of paths) {
    const parts = full.split(SEP);
    let parent = root;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}${SEP}${part}` : part;
      let node = byPath.get(acc);
      if (!node) {
        node = { name: part, path: acc, children: [], isCategory: false };
        byPath.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.isCategory = true;
  }
  return root;
}

export interface Item {
  key: string;
  name: string;
}

/** Một lần hỏi AI: chọn nhóm cho các sản phẩm trong danh sách. Trả `n` (số thứ tự sản phẩm, từ 1) → `c` (số thứ tự nhóm từ 1; 0 = không chắc). */
export type AskFn = (q: { parent: string; options: string[]; items: { n: number; name: string }[] }) => Promise<Map<number, number>>;

export interface CategorizeResult {
  assigned: Map<string, { path: string; ratePct: number }>;
  /** Sản phẩm đã hỏi nhưng AI không chắc hoặc lượt hỏi lỗi: người gọi dùng mức mặc định. */
  unassigned: string[];
  /** Số lượt hỏi AI thất bại (đã tính vào `unassigned`). */
  failedCalls: number;
}

export interface CategorizeOpts {
  platform: FeePlatform;
  type: SellerType;
  items: Item[];
  ask: AskFn;
  onProgress?: (done: number, total: number) => void;
  /** Số sản phẩm mỗi lượt hỏi (mặc định 40). */
  batch?: number;
  /** Số lượt hỏi chạy song song (mặc định 5). */
  concurrency?: number;
  signal?: AbortSignal;
  /** Cây ngành và hàm tra mức phí; mặc định theo biểu phí của sàn (chỉ truyền khi kiểm thử). */
  tree?: TreeNode;
  rateOf?: (path: string) => number | null;
}

const MAX_DEPTH = 6;

/** Chạy các tác vụ với tối đa `n` tác vụ cùng lúc. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= tasks.length) return;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

/**
 * Phân ngành cho `items`. Ném lỗi khi `ask` ném lỗi KHÔNG phục hồi được (ví dụ hết hạn mức AI): `ask` ném `FatalAskError` để dừng cả lượt.
 * Lỗi thường của một lượt hỏi chỉ làm các sản phẩm của lượt đó chưa có ngành (đếm ở `failedCalls`).
 */
export async function categorizeProducts(o: CategorizeOpts): Promise<CategorizeResult> {
  const tree = o.tree ?? buildTree(categoryList(o.platform, o.type).map((c) => c.path));
  const rateOf = o.rateOf ?? ((path: string) => categoryRate(o.platform, o.type, path));
  const batch = Math.max(1, o.batch ?? 40);
  const result: CategorizeResult = { assigned: new Map(), unassigned: [], failedCalls: 0 };
  const total = o.items.length;
  let done = 0;
  const finish = (n: number) => {
    done += n;
    o.onProgress?.(done, total);
  };
  const assign = (item: Item, node: TreeNode) => {
    const ratePct = rateOf(node.path);
    if (ratePct === null) result.unassigned.push(item.key);
    else result.assigned.set(item.key, { path: node.path, ratePct });
    finish(1);
  };
  const drop = (item: Item) => {
    result.unassigned.push(item.key);
    finish(1);
  };

  let groups: { node: TreeNode; items: Item[] }[] = [{ node: tree, items: o.items }];
  for (let depth = 0; depth < MAX_DEPTH && groups.length > 0; depth++) {
    const next = new Map<TreeNode, Item[]>();
    const tasks: (() => Promise<void>)[] = [];
    for (const g of groups) {
      if (g.node.children.length === 0) {
        for (const it of g.items) (g.node.isCategory ? assign(it, g.node) : drop(it));
        continue;
      }
      const options = g.node.children.map((c) => c.name);
      for (let i = 0; i < g.items.length; i += batch) {
        const chunk = g.items.slice(i, i + batch);
        tasks.push(async () => {
          if (o.signal?.aborted) throw new Error("aborted");
          let picks: Map<number, number>;
          try {
            picks = await o.ask({ parent: g.node.path, options, items: chunk.map((it, k) => ({ n: k + 1, name: it.name })) });
          } catch (e) {
            if ((e as { fatal?: boolean }).fatal) throw e;
            result.failedCalls++;
            for (const it of chunk) drop(it);
            return;
          }
          chunk.forEach((it, k) => {
            const c = picks.get(k + 1) ?? 0;
            const child = c >= 1 && c <= g.node.children.length ? g.node.children[c - 1] : null;
            if (!child) {
              // AI không chắc: dừng ở nhóm hiện tại nếu nó tự là một ngành, còn không thì để trống.
              if (g.node.isCategory && g.node.path) assign(it, g.node);
              else drop(it);
            } else if (child.children.length === 0) assign(it, child);
            else {
              const list = next.get(child) ?? [];
              list.push(it);
              next.set(child, list);
            }
          });
        });
      }
    }
    await pool(tasks, o.concurrency ?? 5);
    groups = [...next.entries()].map(([node, items]) => ({ node, items }));
  }
  // Còn sản phẩm chưa xong sau độ sâu tối đa (cây quá sâu bất thường): bỏ.
  for (const g of groups) for (const it of g.items) drop(it);
  return result;
}

/** Lỗi không nên thử tiếp (hết hạn mức AI, chưa cấu hình...): dừng cả lượt phân ngành. */
export class FatalAskError extends Error {
  readonly fatal = true;
  /** Do hết lượt/ngân sách AI: giao diện hiện nút liên hệ nâng cấp. */
  constructor(message: string, readonly quota = false) {
    super(message);
  }
}
