import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase phía server, đọc phiên đăng nhập từ cookie. Dùng trong Server Component / Route Handler. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Gọi từ Server Component thì không ghi cookie được; middleware đã làm mới phiên.
        }
      },
    },
  });
}
