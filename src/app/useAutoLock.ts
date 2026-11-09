import { useEffect } from "react";
import type { AuthenticatorVault } from "../platform/controller";
export function useAutoLock(vault: AuthenticatorVault) {
  useEffect(() => {
    if (!vault.passwordProtected || vault.locked) return;
    const check = () => {
      void vault.checkAutoLock().catch(() => void vault.lock());
    };
    const close = () => {
      if (vault.settings.autoLockMinutes === 0) void vault.lock();
    };
    const timer = window.setInterval(check, 1000);
    window.addEventListener("pagehide", close);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", close);
    };
  }, [
    vault,
    vault.passwordProtected,
    vault.locked,
    vault.settings.autoLockMinutes,
  ]);
}
