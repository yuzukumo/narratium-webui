"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Plus,
  RefreshCw,
  Save,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/app/i18n";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";
import { APIError, apiJSON, type AuthUser } from "@/utils/api-client";
import { formatMicrousd, parseUSDToMicrousd } from "@/utils/money";

interface Props {
  target: AuthUser;
  currentUserID: string;
  activeAdminCount: number;
  onClose: () => void;
  onUserUpdated: (user: AuthUser) => void;
  refreshAuth: () => Promise<void>;
}

type BalanceAction = "add" | "subtract" | "override";

export default function UserEditorDrawer({
  target,
  currentUserID,
  activeAdminCount,
  onClose,
  onUserUpdated,
  refreshAuth,
}: Props) {
  const { t, fontClass, titleFontClass } = useLanguage();
  const [draft, setDraft] = useState(target);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [balanceAction, setBalanceAction] = useState<BalanceAction>("add");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [adjustingBalance, setAdjustingBalance] = useState(false);

  useEffect(() => {
    setDraft(target);
  }, [target]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-select-menu-open=true]")) {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const roleOptions: readonly SelectMenuOption<AuthUser["role"]>[] = [
    { value: "user", label: t("admin.users.roles.user") },
    { value: "admin", label: t("admin.users.roles.admin") },
  ];
  const statusOptions: readonly SelectMenuOption<AuthUser["status"]>[] = [
    { value: "active", label: t("admin.users.statuses.active") },
    { value: "disabled", label: t("admin.users.statuses.disabled") },
  ];
  const protectsLastAdmin = target.role === "admin"
    && target.status === "active"
    && activeAdminCount === 1;

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const result = await apiJSON<{ user: AuthUser }>(`/api/v1/admin/users/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          role: draft.role,
          status: draft.status,
        }),
      });
      setDraft(result.user);
      onUserUpdated(result.user);
      toast.success(t("admin.toasts.userUpdateSuccess"));
      if (target.id === currentUserID) {
        await refreshAuth();
      }
    } catch (reason) {
      if (reason instanceof APIError && reason.code === "last_admin") {
        toast.error(t("admin.toasts.lastAdminError"));
      } else {
        toast.error(reason instanceof Error ? reason.message : t("admin.toasts.userUpdateError"));
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (new TextEncoder().encode(password).length > 72) {
      toast.error(t("admin.users.form.passwordTooLong"));
      return;
    }
    setResettingPassword(true);
    try {
      const result = await apiJSON<{ user: AuthUser }>(
        `/api/v1/admin/users/${target.id}/password`,
        { method: "PUT", body: JSON.stringify({ password }) },
      );
      onUserUpdated(result.user);
      setPassword("");
      toast.success(t("admin.toasts.passwordResetSuccess"));
      if (target.id === currentUserID) {
        onClose();
        await refreshAuth();
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t("admin.toasts.passwordResetError"));
    } finally {
      setResettingPassword(false);
    }
  };

  const adjustBalance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseUSDToMicrousd(balanceAmount);
    if (parsed === null || (balanceAction !== "override" && BigInt(parsed) <= 0n)) {
      toast.error(t("admin.users.form.invalidAmount"));
      return;
    }
    setAdjustingBalance(true);
    try {
      const result = await apiJSON<{ user: AuthUser }>(
        `/api/v1/admin/users/${target.id}/balance-adjustments`,
        {
          method: "POST",
          body: JSON.stringify({ mode: balanceAction, amount_microusd: parsed, note: balanceNote }),
        },
      );
      setDraft(result.user);
      onUserUpdated(result.user);
      setBalanceAmount("");
      setBalanceNote("");
      toast.success(t("admin.toasts.balanceAdjustedSuccess"));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t("admin.toasts.balanceAdjustmentError"));
    } finally {
      setAdjustingBalance(false);
    }
  };

  const inputClass = "mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10";
  const parsedPreviewAmount = parseUSDToMicrousd(balanceAmount);
  const currentQuota = BigInt(draft.balance_microusd || "0");
  const previewQuota = parsedPreviewAmount === null
    ? null
    : balanceAction === "add"
      ? currentQuota + BigInt(parsedPreviewAmount)
      : balanceAction === "subtract"
        ? currentQuota - BigInt(parsedPreviewAmount)
        : BigInt(parsedPreviewAmount);

  return (
    <div className={`fixed inset-0 z-[85] ${fontClass}`}>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("admin.users.drawer.close")}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full min-h-0 flex-col border-l border-[#66564b] bg-[#1d1a18] shadow-[-18px_0_50px_rgba(0,0,0,0.45)] sm:w-[34rem] sm:max-w-[calc(100vw-2rem)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#534741]/70 bg-[#252220] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="user-drawer-title" className={`${titleFontClass} truncate text-base font-semibold text-[#f4e8c1]`}>
              {t("admin.users.drawer.title")}
            </h2>
            <p className="mt-1 truncate text-xs text-[#817361]">{target.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t("admin.users.drawer.close")}
            aria-label={t("admin.users.drawer.close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] bg-[#1a1816] text-[#a18d6f] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
          >
            <X size={17} />
          </button>
        </header>

        <div className="fantasy-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-4 py-5 sm:px-5">
          <form onSubmit={saveProfile} className="space-y-4">
            <h3 className={`${titleFontClass} text-sm font-semibold text-[#e9d8b7]`}>
              {t("admin.users.sections.profile")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs text-[#a18d6f]">
                {t("admin.users.form.name")}
                <input
                  required
                  autoFocus
                  minLength={1}
                  maxLength={64}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-[#a18d6f]">
                {t("admin.users.form.email")}
                <input
                  type="email"
                  maxLength={254}
                  required
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  className={inputClass}
                />
              </label>
              <div className="block text-xs text-[#a18d6f]">
                <span>{t("admin.users.roleLabel")}</span>
                <SelectMenu
                  value={draft.role}
                  options={roleOptions.map((option) => ({
                    ...option,
                    disabled: protectsLastAdmin && option.value === "user",
                  }))}
                  onChange={(role) => setDraft({ ...draft, role })}
                  ariaLabel={t("admin.users.roleLabel")}
                  className="mt-1.5 w-full"
                />
              </div>
              <div className="block text-xs text-[#a18d6f]">
                <span>{t("admin.users.statusLabel")}</span>
                <SelectMenu
                  value={draft.status}
                  options={statusOptions.map((option) => ({
                    ...option,
                    disabled: protectsLastAdmin && option.value === "disabled",
                  }))}
                  onChange={(status) => setDraft({ ...draft, status })}
                  ariaLabel={t("admin.users.statusLabel")}
                  className="mt-1.5 w-full"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-[#5a4228] px-3 text-sm font-medium text-[#f9c86d] transition-colors hover:bg-[#674b2c] disabled:cursor-wait disabled:opacity-50"
            >
              {savingProfile ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
              {savingProfile ? t("admin.actions.saving") : t("admin.actions.save")}
            </button>
          </form>

          <section className="space-y-4 border-t border-[#534741]/60 pt-6">
            <div className="flex items-center gap-2">
              <WalletCards size={17} className="text-[#d9b16b]" />
              <h3 className={`${titleFontClass} text-sm font-semibold text-[#e9d8b7]`}>
                {t("admin.users.sections.balance")}
              </h3>
            </div>
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[#534741]/60 bg-[#534741]/60">
              {[
                ["total", draft.balance_microusd],
                ["reserved", draft.reserved_microusd],
                ["available", draft.available_balance_microusd],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-[#211e1c] px-2 py-3 text-center">
                  <dt className="truncate text-[11px] text-[#817361]">{t(`admin.users.balance.${label}`)}</dt>
                  <dd className="mt-1 truncate font-mono text-xs text-[#e6d3ae]" title={formatMicrousd(value, 6)}>
                    {formatMicrousd(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <form onSubmit={adjustBalance} className="space-y-3">
			  {previewQuota !== null && (
                <p className="text-xs tabular-nums text-[#8f806d]">
                  {t("admin.users.balance.current")}: {formatMicrousd(draft.balance_microusd)}
                  {balanceAction === "override" ? (
                    <> -&gt; {formatMicrousd(previewQuota.toString())}</>
                  ) : (
                    <>{balanceAction === "add" ? " + " : " - "}{formatMicrousd(parsedPreviewAmount || "0")} = {formatMicrousd(previewQuota.toString())}</>
                  )}
                </p>
			  )}
			  <div className="grid grid-cols-3 gap-1 rounded-md border border-[#534741]/70 bg-[#181614] p-1">
                {(["add", "subtract", "override"] as const).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setBalanceAction(action)}
                    className={`flex h-9 items-center justify-center gap-2 rounded text-sm transition-colors ${balanceAction === action
                      ? "bg-[#423321] text-[#f2cf8f]"
                      : "text-[#8f806d] hover:bg-[#28231f] hover:text-[#d8c9b3]"}`}
                  >
                    {action === "add" ? <Plus size={15} /> : action === "subtract" ? <Minus size={15} /> : <RefreshCw size={14} />}
                    {t(`admin.users.balance.${action}`)}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-[#a18d6f]">
                {t("admin.users.form.amountUSD")}
                <div className="mt-1.5 flex h-10 w-full overflow-hidden rounded-md border border-[#534741]/70 bg-[#1a1816] transition-colors focus-within:border-amber-500/60 focus-within:ring-2 focus-within:ring-amber-500/10">
                  <span aria-hidden="true" className="flex h-full shrink-0 items-center pl-3 pr-2 text-sm text-[#817361]">$</span>
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    value={balanceAmount}
                    onChange={(event) => {
                      if (/^\d*(?:\.\d{0,6})?$/.test(event.target.value)) setBalanceAmount(event.target.value);
                    }}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 pr-3 text-sm tabular-nums text-[#eae6db] outline-none"
                  />
                </div>
              </label>
              <label className="block text-xs text-[#a18d6f]">
                {t("admin.users.form.note")}
                <input
                  maxLength={500}
                  value={balanceNote}
                  onChange={(event) => setBalanceNote(event.target.value)}
                  className={inputClass}
                />
              </label>
              <button
                type="submit"
                disabled={adjustingBalance}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[#665442] bg-[#24201c] px-3 text-sm text-[#ddc69f] transition-colors hover:border-[#8b704f] hover:bg-[#2d2823] disabled:cursor-wait disabled:opacity-50"
              >
                {adjustingBalance ? <LoaderCircle size={15} className="animate-spin" /> : <WalletCards size={15} />}
                {t("admin.users.balance.apply")}
              </button>
            </form>
          </section>

          <form onSubmit={resetPassword} className="space-y-3 border-t border-[#534741]/60 pt-6">
            <div className="flex items-center gap-2">
              <LockKeyhole size={17} className="text-[#d9b16b]" />
              <h3 className={`${titleFontClass} text-sm font-semibold text-[#e9d8b7]`}>
                {t("admin.users.sections.password")}
              </h3>
            </div>
            <label className="block text-xs text-[#a18d6f]">
              {t("admin.users.form.newPassword")}
              <div className="relative">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputClass} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  title={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                  aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                  className="absolute right-1 top-[calc(50%+3px)] flex h-8 w-8 -translate-y-1/2 items-center justify-center text-[#817361] hover:text-[#d9b16b]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <button
              type="submit"
              disabled={resettingPassword}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[#665442] bg-[#24201c] px-3 text-sm text-[#ddc69f] transition-colors hover:border-[#8b704f] hover:bg-[#2d2823] disabled:cursor-wait disabled:opacity-50"
            >
              {resettingPassword ? <LoaderCircle size={15} className="animate-spin" /> : <LockKeyhole size={15} />}
              {t("admin.users.form.resetPassword")}
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
