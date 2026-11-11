import { useRef, useState } from "react";
import { useCopy, useVault } from "../../app/vault";
import { ErrorMessage } from "../../shared/ui/controls";
import {
  calibrateGoogleTime,
  type TimeCalibration as Calibration,
} from "../../platform/time";

export function TimeCalibration() {
  const vault = useVault(),
    { tr } = useCopy();
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<"permission" | "failed" | null>(null);
  const running = useRef(false);
  async function calibrate() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await calibrateGoogleTime();
      setCalibration(value);
      await vault.refreshCodes();
    } catch (failure) {
      setError(
        failure &&
          typeof failure === "object" &&
          "code" in failure &&
          failure.code === "permission"
          ? "permission"
          : "failed",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="list-row flex-wrap">
      <span className="tx" style={{ overflowWrap: "anywhere" }}>
        <b>{tr("timeCalibration")}</b>
        <small>{tr("timeCalibrationHint")}</small>
      </span>
      <button
        type="button"
        className="btn btn-soft max-w-1/2 shrink-0 wrap-anywhere"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void calibrate()}
      >
        {tr(busy ? "timeCalibrating" : "timeCalibrateGoogle")}
      </button>
      {(calibration || error) && (
        <div className="w-full">
          {calibration && (
            <p className="desc" role="status" style={{ marginTop: 8 }}>
              {tr("timeCalibrated", {
                seconds: new Intl.NumberFormat(vault.settings.language, {
                  maximumFractionDigits: 1,
                  signDisplay: "exceptZero",
                }).format(calibration.offsetMs / 1000),
              })}
            </p>
          )}
          <ErrorMessage>
            {error
              ? tr(
                  error === "permission"
                    ? "timeCalibrationPermission"
                    : "timeCalibrationFailed",
                )
              : ""}
          </ErrorMessage>
        </div>
      )}
    </div>
  );
}
