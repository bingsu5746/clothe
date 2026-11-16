import { useState } from "react";
import { HangerIcon } from "../components/icons";
import { Button, Notice, inputCls } from "../components/ui";
import { api } from "../lib/api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-safe pb-safe">
      <form
        className="w-full max-w-[320px] animate-rise-in"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/auth/login", { method: "POST", json: { pin } });
            onLogin();
          } catch (e) {
            setErr((e as Error).message);
            setPin("");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="grid size-14 place-items-center rounded-[18px] bg-accent text-accent-ink">
          <HangerIcon size={30} strokeWidth={1.7} />
        </span>
        <h1 className="mt-6 text-large-title">내 옷장</h1>
        <p className="mt-1.5 text-callout text-muted">PIN을 입력해 주세요.</p>
        <input
          className={`${inputCls} mt-8 h-14 text-center text-[24px] tracking-[0.5em] placeholder:tracking-normal`}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-label="PIN"
          aria-invalid={!!err}
        />
        <Notice className="mt-3">{err}</Notice>
        <Button type="submit" variant="primary" size="lg" block className="mt-4" loading={busy} disabled={!pin}>
          들어가기
        </Button>
      </form>
    </main>
  );
}
