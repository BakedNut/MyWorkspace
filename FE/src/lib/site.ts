import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { DEFAULT_SITE_NAME } from "@/types/domain";

export const siteQuery = {
  queryKey: ["site-settings"] as const,
  queryFn: () => api.site.get(),
  staleTime: 60_000,
  refetchInterval: 60_000,
  retry: false,
};

export function useSiteName() {
  return useQuery(siteQuery).data?.siteName ?? DEFAULT_SITE_NAME;
}
