import { useState } from "react";
import { Button, ErrorText, inputCls } from "../components/ui";
import { api } from "../lib/api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-dvh place-items-center px-6 pt-safe pb-safe">
      <form
        className="w-full max-w-xs space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/auth/login", { method: "POST", json: { pin } });
            onLogin();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="text-center">
          <div className="text-2xl font-extrabold tracking-tight">내 옷장</div>
          <p className="mt-1 text-sm text-muted">PIN을 입력해 주세요</p>
        </div>
        <input
          className={`${inputCls} text-center text-2xl tracking-[0.4em]`}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-label="PIN"
        />
        <ErrorText>{err}</ErrorText>
        <Button variant="primary" className="w-full" loading={busy} disabled={!pin}>
          들어가기
        </Button>
      </form>
    </div>
  );
}
