export function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const [hour = "00", minute = "00"] = value.split(":");
  return (
    <fieldset className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
      <legend className="sr-only">{label} 시간</legend>
      <span aria-hidden className="text-sm">
        {label}
      </span>
      <select
        aria-label={`${label} 시`}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        value={hour}
        onChange={(e) => onChange(`${e.target.value}:${minute}`)}
      >
        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
          <option key={h} value={h}>
            {h}시
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} 분`}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        value={minute}
        onChange={(e) => onChange(`${hour}:${e.target.value}`)}
      >
        {/* Preserve previously saved times without silently rounding them. */}
        {Number(minute) % 5 !== 0 && (
          <option value={minute} disabled>
            {minute}분 (기존)
          </option>
        )}
        {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")).map((m) => (
          <option key={m} value={m}>
            {m}분
          </option>
        ))}
      </select>
    </fieldset>
  );
}
