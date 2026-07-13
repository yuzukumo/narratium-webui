"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff, LoaderCircle, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { APIError } from "@/utils/api-client";
import { useLanguage } from "@/app/i18n";

export default function LoginModal() {
  const { bootstrap, login, register, sendVerificationCode } = useAuth();
  const { t } = useLanguage();
  const firstUser = bootstrap?.initialized === false;
  const canRegister = firstUser || bootstrap?.registration_enabled === true;
  const verificationEnabled = bootstrap?.email_verification_enabled === true;
  const [mode, setMode] = useState<"login" | "register">(firstUser ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const effectiveMode = useMemo(() => firstUser ? "register" : mode, [firstUser, mode]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  const requestVerificationCode = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError(t("auth.emailRequired"));
      return;
    }
    setSendingCode(true);
    try {
      await sendVerificationCode(email.trim());
      setCodeCooldown(60);
      setNotice(t("auth.verificationCodeSent"));
    } catch (reason) {
      setError(reason instanceof APIError ? reason.message : t("auth.unableToReachServer"));
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (effectiveMode === "register" && password !== confirmPassword) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }
    setSubmitting(true);
    try {
      if (effectiveMode === "register") {
        await register(name.trim(), email.trim(), password, verificationCode.trim());
      } else {
        await login(email.trim(), password);
      }
    } catch (reason) {
      setError(reason instanceof APIError ? reason.message : t("auth.unableToReachServer"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[#1a1816] font-sans text-[#eae6db]">
      <Image
        src="/background_yellow.png"
        alt=""
        fill
        priority
        className="pointer-events-none object-cover opacity-20"
      />
      <div className="pointer-events-none absolute inset-0 bg-[#1a1816]/75" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#252220]/30 via-[#1a1816]/80 to-[#1a1816]" />

      <div className="relative z-10 flex min-h-full flex-col p-3 sm:p-6">
        <section
          aria-labelledby="auth-title"
          className="relative mx-auto my-auto w-full min-w-0 max-w-md overflow-hidden rounded-lg border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent shadow-[0_0_12px_rgba(249,200,109,0.45)]"
          />

          <div className="border-b border-[#534741]/80 bg-gradient-to-r from-amber-500/5 via-orange-400/5 to-transparent px-5 pb-5 pt-6 text-center sm:px-7">
            <Image
              src="/logo_circle.png"
              alt="Narratium"
              width={58}
              height={58}
              className="mx-auto mb-3 rounded-full border border-[#534741] bg-[#1a1816]/90 p-1 shadow-[0_0_20px_rgba(249,200,109,0.14)]"
            />
            <h1
              id="auth-title"
              className="bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300 bg-clip-text font-cinzel text-2xl font-bold text-transparent drop-shadow-[0_0_10px_rgba(251,146,60,0.35)]"
            >
              Narratium
            </h1>
            <p className="mt-2 font-serif text-sm leading-6 text-[#c0a480]">
              {firstUser
                ? t("auth.createFirstAdministrator")
                : effectiveMode === "login"
                  ? t("auth.signInToContinue")
                  : t("auth.createAccount")}
            </p>
          </div>

          <div className="px-5 pb-6 pt-5 sm:px-7 sm:pb-7">
            {!firstUser && canRegister && (
              <div
                className="mb-5 grid grid-cols-2 rounded-md border border-[#534741] bg-[#1a1816] p-1 shadow-inner"
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveMode === "login"}
                  onClick={() => { setMode("login"); setError(""); }}
                  className={`flex h-9 min-w-0 items-center justify-center gap-2 rounded-sm border text-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${effectiveMode === "login" ? "border-[#534741] bg-gradient-to-r from-[#332b22] to-[#211c18] text-[#f9c86d] shadow-[0_0_12px_rgba(249,200,109,0.08)]" : "border-transparent text-[#a18d6f] hover:bg-[#252220] hover:text-[#eae6db]"}`}
                >
                  <LogIn size={15} aria-hidden="true" /> {t("auth.login")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveMode === "register"}
                  onClick={() => { setMode("register"); setError(""); }}
                  className={`flex h-9 min-w-0 items-center justify-center gap-2 rounded-sm border text-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${effectiveMode === "register" ? "border-[#534741] bg-gradient-to-r from-[#332b22] to-[#211c18] text-[#f9c86d] shadow-[0_0_12px_rgba(249,200,109,0.08)]" : "border-transparent text-[#a18d6f] hover:bg-[#252220] hover:text-[#eae6db]"}`}
                >
                  <UserPlus size={15} aria-hidden="true" /> {t("auth.register")}
                </button>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              {effectiveMode === "register" && (
                <label className="block font-serif text-sm text-[#c0a480]">
                  {t("auth.name")}
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    minLength={1}
                    maxLength={64}
                    autoComplete="name"
                    required
                    autoFocus
                    className="mt-1.5 h-11 w-full min-w-0 rounded-md border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] px-3 font-sans text-[#eae6db] shadow-inner outline-none transition-all duration-300 hover:border-[#6b5b52] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                  />
                </label>
              )}
              <label className="block font-serif text-sm text-[#c0a480]">
                {t("auth.email")}
                <span className="mt-1.5 block">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={254}
                    autoComplete="email"
                    required
                    autoFocus={effectiveMode === "login"}
                    className="h-11 w-full min-w-0 rounded-md border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] px-3 font-sans text-[#eae6db] shadow-inner outline-none transition-all duration-300 hover:border-[#6b5b52] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                  />
                </span>
              </label>
              {effectiveMode === "register" && verificationEnabled && (
                <label className="block font-serif text-sm text-[#c0a480]">
                  {t("auth.verificationCode")}
                  <span className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <span className="relative block">
                      <ShieldCheck size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#817361]" />
                      <input
                        value={verificationCode}
                        onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        autoComplete="one-time-code"
                        required
                        className="h-11 w-full min-w-0 rounded-md border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] pl-10 pr-3 font-mono text-[#eae6db] shadow-inner outline-none transition-all duration-300 hover:border-[#6b5b52] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                      />
                    </span>
                    <button
                      type="button"
                      disabled={sendingCode || codeCooldown > 0}
                      onClick={() => void requestVerificationCode()}
                      className="flex h-11 min-w-28 items-center justify-center gap-2 rounded-md border border-[#665442] bg-[#211e1c] px-3 text-sm text-[#e9c08d] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-wait disabled:opacity-55"
                    >
                      {sendingCode && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                      {codeCooldown > 0 ? `${codeCooldown}s` : t("auth.sendCode")}
                    </button>
                  </span>
                </label>
              )}
              <label className="block font-serif text-sm text-[#c0a480]">
                {t("auth.password")}
                <span className="relative mt-1.5 block">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={10}
                    maxLength={128}
                    autoComplete={effectiveMode === "login" ? "current-password" : "new-password"}
                    required
                    className="h-11 w-full min-w-0 rounded-md border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] px-3 pr-11 font-sans text-[#eae6db] shadow-inner outline-none transition-all duration-300 hover:border-[#6b5b52] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <button
                    type="button"
                    aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                    title={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-r-md text-[#a18d6f] transition-colors hover:bg-amber-500/5 hover:text-[#f9c86d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/30"
                  >
                    {showPassword
                      ? <EyeOff size={17} aria-hidden="true" />
                      : <Eye size={17} aria-hidden="true" />}
                  </button>
                </span>
              </label>
              {effectiveMode === "register" && (
                <label className="block font-serif text-sm text-[#c0a480]">
                  {t("auth.confirmPassword")}
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                    className="mt-1.5 h-11 w-full min-w-0 rounded-md border border-[#534741] bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] px-3 font-sans text-[#eae6db] shadow-inner outline-none transition-all duration-300 hover:border-[#6b5b52] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                  />
                </label>
              )}

              {error && (
                <p
                  role="alert"
                  className="break-words rounded-md border border-[#71483f] bg-[#2a1d1a] px-3 py-2 text-sm leading-5 text-[#e5937c] shadow-inner"
                >
                  {error}
                </p>
              )}
              {notice && !error && (
                <p role="status" className="break-words rounded-md border border-emerald-800/60 bg-emerald-950/20 px-3 py-2 text-sm leading-5 text-emerald-300">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="relative flex min-h-11 w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-md border border-[#534741] bg-gradient-to-r from-[#1f1c1a] to-[#13100e] px-3 py-2 text-sm font-semibold text-[#e9c08d] shadow-lg transition-all duration-300 hover:from-[#282521] hover:to-[#1a1613] hover:text-[#f6daae] hover:shadow-[#f8b758]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-wait disabled:opacity-60"
              >
                {submitting
                  ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                  : effectiveMode === "login"
                    ? <LogIn size={17} aria-hidden="true" />
                    : <UserPlus size={17} aria-hidden="true" />}
                {submitting
                  ? t("auth.pleaseWait")
                  : effectiveMode === "login"
                    ? t("auth.signIn")
                    : t("auth.createAccount")}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
