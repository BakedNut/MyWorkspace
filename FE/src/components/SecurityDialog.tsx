import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isPreview } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OtpSetup, SecurityProof } from "@/types/domain";

export function SecurityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const qc = useQueryClient();
  const {
    data,
    error: loadError,
    isPending,
    refetch,
  } = useQuery({ queryKey: ["security"], queryFn: () => api.security.getStatus(), enabled: open });
  const [tab, setTab] = useState<"password" | "otp">("password");
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [replacement, setReplacement] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setup, setSetup] = useState<OtpSetup | null>(null);
  const [qr, setQr] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const proof = (): SecurityProof =>
    method === "otp" ? { method, otp } : { method, currentPassword: password };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
      setPassword("");
      setOtp("");
    }
  };
  const changed = async () => {
    await qc.invalidateQueries({ queryKey: ["security"] });
  };
  const clearSetup = () => {
    setSetup(null);
    setQr("");
    setOtp("");
  };
  const proofFields = (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">본인 확인 방법</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex min-h-9 items-center gap-2">
            <input
              type="radio"
              name="security-proof"
              value="password"
              checked={method === "password"}
              disabled={busy}
              onChange={() => {
                setMethod("password");
                setOtp("");
              }}
            />
            기존 비밀번호
          </label>
          {data?.otpEnabled && (
            <label className="inline-flex min-h-9 items-center gap-2">
              <input
                type="radio"
                name="security-proof"
                value="otp"
                checked={method === "otp"}
                disabled={busy}
                onChange={() => {
                  setMethod("otp");
                  setPassword("");
                }}
              />
              Google OTP
            </label>
          )}
        </div>
      </fieldset>
      {method === "password" ? (
        <div className="space-y-1.5">
          <Label htmlFor="security-current">기존 비밀번호</Label>
          <Input
            id="security-current"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="security-code">OTP 인증번호</Label>
          <Input
            id="security-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            value={otp}
            disabled={busy}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            maxLength={6}
          />
        </div>
      )}
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>암호 설정</DialogTitle>
          <DialogDescription>
            기존 비밀번호 또는 등록한 Google OTP로 본인 확인 후 비밀번호를 변경할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        {data?.requiresHttps ? (
          <div className="space-y-3 rounded-lg bg-secondary p-4 text-sm">
            <p>비밀번호와 OTP 설정은 HTTPS 주소에서 진행하세요.</p>
            {data.secureSetupUrl && (
              <Button asChild>
                <a href={data.secureSetupUrl} target="_blank" rel="noopener noreferrer">
                  HTTPS에서 설정
                </a>
              </Button>
            )}
          </div>
        ) : isPreview ? (
          <p className="text-sm text-muted-foreground">암호 설정은 실제 서비스에서 진행하세요.</p>
        ) : loadError ? (
          <Button variant="outline" onClick={() => refetch()}>
            설정 다시 불러오기
          </Button>
        ) : isPending ? (
          <p role="status">설정을 불러오는 중…</p>
        ) : (
          <>
            <div role="group" aria-label="암호 설정 메뉴" className="flex gap-2 border-b pb-3">
              {(
                [
                  ["password", "비밀번호 변경"],
                  ["otp", "Google OTP"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={tab === value ? "default" : "outline"}
                  aria-pressed={tab === value}
                  disabled={busy}
                  onClick={() => {
                    setTab(value);
                    setPassword("");
                    setOtp("");
                    setReplacement("");
                    setConfirm("");
                    setError("");
                    setNotice("");
                    setRemoving(false);
                    clearSetup();
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-success">
                {notice}
              </p>
            )}
            {tab === "password" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (replacement !== confirm) {
                    setError("새 비밀번호 확인이 일치하지 않습니다.");
                    return;
                  }
                  action(async () => {
                    await api.security.changePassword({
                      ...proof(),
                      newPassword: replacement,
                      confirmPassword: confirm,
                    });
                    setReplacement("");
                    setConfirm("");
                    await changed();
                    setNotice("비밀번호를 변경했습니다. 다른 기기의 기존 로그인은 만료됩니다.");
                  });
                }}
              >
                {proofFields}
                <div className="space-y-1.5">
                  <Label htmlFor="security-new">새 비밀번호</Label>
                  <Input
                    id="security-new"
                    type="password"
                    autoComplete="new-password"
                    value={replacement}
                    disabled={busy}
                    onChange={(e) => setReplacement(e.target.value)}
                    required
                    minLength={12}
                    maxLength={72}
                  />
                  <p className="text-xs text-muted-foreground">12자 이상으로 입력하세요.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="security-confirm">새 비밀번호 확인</Label>
                  <Input
                    id="security-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    disabled={busy}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={12}
                    maxLength={72}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !replacement ||
                    !confirm ||
                    !(method === "otp" ? otp.length === 6 : password)
                  }
                >
                  {busy ? "변경 중…" : "비밀번호 변경 저장"}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-sm">Google OTP {data?.otpEnabled ? "등록됨" : "미등록"}</p>
                {setup ? (
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        await api.security.confirmOtp(setup.setupToken, otp);
                        clearSetup();
                        await changed();
                        setNotice(
                          "Google OTP를 등록했습니다. 비밀번호 변경에는 다음 새 인증번호를 사용하세요.",
                        );
                      });
                    }}
                  >
                    <p className="text-sm">
                      Google Authenticator에서 QR을 스캔하거나 아래 설정 키를 직접 입력하세요.
                    </p>
                    {qr && (
                      <img
                        src={qr}
                        alt="Google OTP 등록 QR"
                        width={224}
                        height={224}
                        className="mx-auto max-w-full rounded-lg bg-white p-2"
                      />
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="security-secret">직접 입력할 설정 키</Label>
                      <Input
                        id="security-secret"
                        readOnly
                        value={setup.secret}
                        autoComplete="off"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="security-setup-code">앱의 인증번호</Label>
                      <Input
                        id="security-setup-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={otp}
                        disabled={busy}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        pattern="[0-9]{6}"
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy || otp.length !== 6}>
                        OTP 등록 확인
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={clearSetup}>
                        등록 취소
                      </Button>
                    </div>
                  </form>
                ) : data?.otpEnabled && !removing ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      비밀번호 변경 화면에서 Google OTP를 선택해 본인 확인할 수 있습니다.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRemoving(true);
                        setPassword("");
                        setOtp("");
                      }}
                    >
                      OTP 해제
                    </Button>
                  </>
                ) : removing ? (
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        await api.security.disableOtp(proof());
                        setRemoving(false);
                        setMethod("password");
                        await changed();
                        setNotice("Google OTP 등록을 해제했습니다.");
                      });
                    }}
                  >
                    {proofFields}
                    <Button type="submit" variant="destructive" disabled={busy}>
                      OTP 해제 확인
                    </Button>
                  </form>
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        const result = await api.security.beginOtp(password);
                        setSetup(result);
                        try {
                          const module = await import("qrcode");
                          setQr(
                            await module.default.toDataURL(result.uri, { width: 224, margin: 2 }),
                          );
                        } catch {
                          setNotice("QR을 만들지 못했습니다. 설정 키를 직접 입력하세요.");
                        }
                      });
                    }}
                  >
                    <p className="text-sm text-muted-foreground">
                      등록 시 기존 비밀번호를 확인합니다. 앱의 인증번호까지 확인해야 등록이
                      완료됩니다.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="security-otp-password">기존 비밀번호</Label>
                      <Input
                        id="security-otp-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        disabled={busy}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        maxLength={128}
                      />
                    </div>
                    <Button type="submit" disabled={busy || !password}>
                      {busy ? "준비 중…" : "Google OTP 등록"}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
