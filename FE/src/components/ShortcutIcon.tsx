import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { ShortcutLink } from "@/types/domain";

const retryDelays = [5_000, 10_000, 20_000, 40_000, 60_000];

export function ShortcutIcon({ link }: { link: ShortcutLink }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = api.shortcuts.iconUrl(link);
  useEffect(() => {
    if (!failed || attempt >= retryDelays.length) return;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setFailed(false);
    }, retryDelays[attempt]);
    return () => window.clearTimeout(timer);
  }, [failed, attempt]);
  const imageSource =
    source && attempt > 0
      ? `${source}${source.includes("?") ? "&" : "?"}attempt=${attempt}`
      : source;
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary text-primary">
      {!loaded && <Link2 aria-hidden className="size-5" />}
      {source && !failed && (
        <img
          src={imageSource ?? undefined}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          className={cn("absolute size-7 object-contain", !loaded && "opacity-0")}
        />
      )}
    </span>
  );
}
