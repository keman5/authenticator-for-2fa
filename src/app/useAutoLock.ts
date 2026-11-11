import { useEffect } from "react";
import type { AuthenticatorVault } from "../platform/controller";
export function useAutoLock(vault: AuthenticatorVault) {
  useEffect(() => {
    if (!vault.passwordProtected || vault.locked) return;
    const timed = (vault.settings.autoLockMinutes ?? 0) > 0;
    const held = new Set<number>();
    let activityAt = 0;
    let recordedAt = 0;
    const flush = () => {
      if (activityAt <= recordedAt) return;
      recordedAt = activityAt;
      return vault.recordActivity(activityAt).catch(() => {});
    };
    const note = () => {
      activityAt = Date.now();
      if (activityAt - recordedAt >= 1000) void flush();
    };
    const press = (event: PointerEvent) => {
      held.add(event.pointerId);
      activityAt = Date.now();
      void flush();
    };
    const release = (event: PointerEvent) => {
      held.delete(event.pointerId);
      activityAt = Date.now();
      void flush();
    };
    const reset = () => held.clear();
    const visibility = () => {
      if (document.hidden) reset();
    };
    const check = async () => {
      if (held.size) activityAt = Date.now();
      await flush();
      await vault.checkAutoLock().catch(() => void vault.lock());
    };
    const close = () => {
      if (vault.settings.autoLockMinutes === 0) void vault.lock();
      else void flush();
    };
    const timer = window.setInterval(check, 1000);
    const events = ["click", "keydown", "input", "pointermove", "wheel"];
    if (timed) {
      for (const event of events) window.addEventListener(event, note, true);
      window.addEventListener("pointerdown", press, true);
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
      window.addEventListener("blur", reset);
      document.addEventListener("visibilitychange", visibility);
    }
    window.addEventListener("pagehide", close);
    return () => {
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, note, true);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", close);
    };
  }, [
    vault,
    vault.passwordProtected,
    vault.locked,
    vault.settings.autoLockMinutes,
  ]);
}
