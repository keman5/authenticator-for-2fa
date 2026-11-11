import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  Eye,
  EyeOff,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCopy, useVault } from "../../app/vault";
import {
  needsFilePickerWindow,
  openAppWindow,
  type AppRoute,
} from "../../platform/windows";
import { getErrorMessage } from "../../domain/feedback";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <div aria-labelledby={id}>{children}</div>
    </div>
  );
}
export function Password({
  label,
  value,
  onChange,
  autoComplete = "off",
  autoFocus = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);
  const [shown, setShown] = useState(false);
  const { tr } = useCopy();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="recovery-wrap">
        <input
          ref={input}
          className="input"
          id={id}
          type={shown ? "text" : "password"}
          minLength={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          spellCheck={false}
        />
        <button
          className="eye-btn"
          type="button"
          aria-label={tr("showPassword")}
          aria-pressed={shown}
          disabled={disabled}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
export function Header({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { tr } = useCopy();
  return (
    <div className="detail-head">
      <button
        className="back-btn"
        type="button"
        onClick={onBack}
        aria-label={tr("back")}
      >
        <ChevronLeft size={21} />
      </button>
      <h2 className="sr-only">{title}</h2>
    </div>
  );
}
export function ErrorMessage({ children }: { children?: ReactNode }) {
  const { feedback } = useCopy();
  return children ? (
    <div className="err-text show" role="alert">
      {typeof children === "string" ? feedback(children) : children}
    </div>
  ) : null;
}
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="list-row switch-row">
      <span className="tx">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        className="toggle toggle-primary"
        checked={checked}
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
export function Segmented({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg join" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          className={`btn join-item ${option.value === value ? "active" : ""}`}
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; group?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string>();
  const groups = [
    ...new Set(
      options.flatMap((option) => (option.group ? [option.group] : [])),
    ),
  ];
  const visibleOptions = options.filter(
    (option) => !option.group || option.group === group,
  );
  const minimumWidth = groups.length ? 250 : 170;
  const menuHeight = Math.min(
    280,
    (groups.length ? 36 : 0) + visibleOptions.length * 34 + 10,
  );
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 170 });
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    const scroll = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(
        window.innerWidth - 12,
        Math.max(minimumWidth, box.width),
      );
      setPosition({
        top: Math.max(
          6,
          Math.min(box.bottom + 5, window.innerHeight - menuHeight),
        ),
        left: Math.max(6, Math.min(box.left, window.innerWidth - width - 6)),
        width,
      });
    };
    scroll();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", scroll);
    document.querySelector(".p-body")?.addEventListener("scroll", scroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", scroll);
      document.querySelector(".p-body")?.removeEventListener("scroll", scroll);
    };
  }, [open, menuHeight, minimumWidth]);
  return (
    <div className="dd" ref={ref}>
      <button
        className="dd-btn"
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          const box = buttonRef.current!.getBoundingClientRect();
          const width = Math.min(
            window.innerWidth - 12,
            Math.max(minimumWidth, box.width),
          );
          setPosition({
            top: Math.min(box.bottom + 5, window.innerHeight - menuHeight),
            left: Math.max(
              6,
              Math.min(box.left, window.innerWidth - width - 6),
            ),
            width,
          });
          if (!open)
            setGroup(
              options.find((option) => option.value === value)?.group ??
                groups[0],
            );
          setOpen(!open);
        }}
      >
        <span>
          {options.find((option) => option.value === value)?.label ?? value}
        </span>
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="dd-menu"
            role="group"
            aria-label={label}
            style={position}
          >
            {groups.length > 0 && (
              <Segmented
                label={label}
                value={group ?? ""}
                options={groups.map((value) => ({ value, label: value }))}
                onChange={setGroup}
              />
            )}
            {visibleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === value ? "sel" : ""}
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.querySelector(".pui") ?? document.body,
        )}
    </div>
  );
}
export function Confirm({
  title,
  children,
  onCancel,
  onConfirm,
  danger = true,
  busy = false,
}: {
  title: string;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  const { tr } = useCopy();
  const vault = useVault();
  useEffect(() => {
    vault.error = "";
    return () => {
      vault.error = "";
    };
  }, [vault]);
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".pui > header, .pui > main, .pui > nav",
      ),
    );
    const previous = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (!dialog.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      background.forEach((element, index) => {
        element.inert =
          Boolean(document.querySelector(".lock-screen")) || previous[index];
      });
    };
  }, [onCancel]);
  const content = (
    <div
      className="modal modal-open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-box"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={`${id}-detail`}
      >
        <h2 id={id} className="confirm-heading">
          <TriangleAlert size={18} aria-hidden="true" />
          {tr("warning")}
        </h2>
        <p id={`${id}-detail`} className="confirm-title">
          {title}
        </p>
        {children}
        <ErrorMessage>{vault.error}</ErrorMessage>
        <div className="modal-action">
          <button
            className="btn btn-sm btn-soft"
            type="button"
            onClick={onCancel}
          >
            {tr("cancel")}
          </button>
          <button
            className={`btn btn-sm ${danger ? "btn-danger-soft" : "btn-primary"}`}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {tr(danger ? "delete" : "save")}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.querySelector(".pui") ?? document.body);
}
export function FilePicker({
  route,
  accept,
  children,
  onFiles,
  onError,
  disabled,
}: {
  route: AppRoute;
  accept: string;
  children: ReactNode;
  onFiles: (files: File[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { tr } = useCopy();
  const opensWindow = needsFilePickerWindow();
  return (
    <>
      <button
        className="btn btn-soft"
        type="button"
        disabled={disabled}
        title={[
          tr("importDropTitle"),
          opensWindow ? tr("opensInNewWindow") : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const files = Array.from(event.dataTransfer.files);
          if (!disabled && files.length) onFiles(files);
        }}
        onClick={() => {
          if (opensWindow)
            void openAppWindow(route).catch((error) =>
              onError(getErrorMessage(error, "Unable to complete the action.")),
            );
          else input.current?.click();
        }}
      >
        {children}
        {opensWindow && <span aria-hidden="true"> ↗</span>}
      </button>
      {!opensWindow && (
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
      )}
    </>
  );
}
export function Logo({
  size = 34,
  remaining,
  period = 30,
}: {
  size?: number;
  remaining?: number;
  period?: number;
}) {
  const id = useId();
  const seconds = remaining ?? period;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1D2F52" />
          <stop offset="1" stopColor="#0B1526" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="19.6" fill={`url(#${id})`} />
      <g transform="translate(24 24) scale(1.06) translate(-24 -24)">
        <circle
          cx="24"
          cy="24"
          r="21.5"
          fill="none"
          stroke="#DADCE0"
          vectorEffect="non-scaling-stroke"
          strokeWidth={(3.8 * size * 1.06) / 48 + 2}
        />
        {["#EA4335", "#FBBC05", "#4285F4", "#34A853"].map((color, index) => (
          <circle
            key={color}
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke={seconds <= 5 ? "#EA4335" : color}
            vectorEffect="non-scaling-stroke"
            strokeWidth={(3.8 * size * 1.06) / 48 + 2}
            strokeDasharray={`${(31.17 * Math.max(0, Math.min(1, (seconds / period) * 4 - index))).toFixed(2)} 135.09`}
            strokeDashoffset={-1.3 - 33.77 * index}
            transform="rotate(-90 24 24)"
          />
        ))}
      </g>
      <path
        d="M24 14.8 31.8 17.4 V23.1 C31.8 28.3 28.8 31.6 24 33.6 C19.2 31.6 16.2 28.3 16.2 23.1 V17.4 Z"
        fill="#FFF"
      />
      <circle cx="24" cy="22.4" r="2.8" fill="#0E1B30" />
      <path d="M23 24.2h2l.7 4.8h-3.4Z" fill="#0E1B30" />
    </svg>
  );
}
export { X };
