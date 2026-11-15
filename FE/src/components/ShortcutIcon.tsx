import { Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import type { ShortcutLink } from "@/types/domain";

const retryDelays = [5_000, 10_000, 20_000, 40_000, 60_000];

export function ShortcutIcon({ link }: { link: ShortcutLink }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = api.shortcuts.iconUrl(link);
  const failures = useRef(0);
  useEffect(() => {
    if (!failed || !source) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const retry = (pending: boolean) => {
      if (controller.signal.aborted) return;
      if (pending) failures.current = 0;
      else {
        if (failures.current >= retryDelays.length) return;
        failures.current += 1;
      }
      timer = window.setTimeout(
        () => {
          setAttempt((value) => value + 1);
          setFailed(false);
        },
        retryDelays[Math.min(attempt, retryDelays.length - 1)],
      );
    };
    // Native image errors omit the response status. HEAD distinguishes queued work from a miss.
    void fetch(source, { method: "HEAD", cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.status === 204 || (response.status >= 400 && response.status < 500)) return;
        retry(response.status === 202);
      })
      .catch(() => retry(false));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [failed, attempt, source]);
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
