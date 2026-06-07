import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyRestriction } from "@/lib/admin.functions";
import { useAuth } from "@/lib/auth";
import type { EnterpriseValue } from "@/lib/enterprises";

export function useMyRestriction() {
  const { user, loading } = useAuth();
  const fn = useServerFn(getMyRestriction);
  const q = useQuery({
    queryKey: ["my-restriction", user?.id ?? "anon"],
    queryFn: () => fn(),
    enabled: !!user && !loading,
    staleTime: 60_000,
  });
  return {
    loading: loading || q.isLoading,
    restriction: (q.data?.enterprise_restriction ?? null) as EnterpriseValue | null,
    role: q.data?.role ?? "user",
  };
}
