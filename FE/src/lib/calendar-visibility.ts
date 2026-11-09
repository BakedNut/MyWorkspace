import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/api";

const queryKey = ["calendar-visibility"];

export function useCalendarVisibility() {
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => api.calendar.getVisibility() });
  const hidden = useMemo(() => new Set(query.data?.hiddenCalendarIds), [query.data]);
  const save = useMutation({
    mutationFn: (hiddenCalendarIds: string[]) => api.calendar.saveVisibility({ hiddenCalendarIds }),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });

  function toggle(id: string) {
    if (!query.isSuccess || query.isFetching || save.isPending) return;
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save.mutate([...next]);
  }

  return { query, hidden, toggle, saving: save.isPending, saveError: save.error };
}
