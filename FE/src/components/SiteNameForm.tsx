import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { siteQuery } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SiteNameForm() {
  const qc = useQueryClient();
  const { data, error: loadError, isPending, refetch } = useQuery(siteQuery);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (siteName: string) => api.site.save({ siteName }),
    onSuccess: (saved) => {
      qc.setQueryData(siteQuery.queryKey, saved);
      setDraft(null);
      setNotice("사이트 이름을 저장했습니다.");
    },
    onError: (failure) =>
      setError(failure instanceof Error ? failure.message : "저장하지 못했습니다."),
  });
  if (loadError)
    return (
      <Button variant="outline" onClick={() => refetch()}>
        사이트 이름 다시 불러오기
      </Button>
    );
  if (isPending) return <p role="status">사이트 이름을 불러오는 중…</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice("");
        setError("");
        const name = (draft ?? data.siteName).trim();
        if (!name || name.length > 40 || /\p{Cc}/u.test(name)) {
          setError("사이트 이름을 줄바꿈 없이 1~40자로 입력하세요.");
          return;
        }
        save.mutate(name);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="site-name">사이트 이름</Label>
        <Input
          id="site-name"
          value={draft ?? data.siteName}
          maxLength={40}
          required
          disabled={save.isPending}
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
            setNotice("");
          }}
        />
        <p className="text-xs text-muted-foreground">
          1~40자. 화면 상단과 브라우저 탭에 표시됩니다.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} 입력한 내용은 유지됩니다.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "저장 중…" : "사이트 이름 저장"}
      </Button>
    </form>
  );
}
