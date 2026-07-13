"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { LANGUAGE_LOCALES } from "@/lib/i18n/languages";
import { apiJSON } from "@/utils/api-client";
import { formatMicrousd } from "@/utils/money";

interface UsageLog {
  id: string;
  character_id?: string;
  character_name?: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  duration_ms: number;
  first_token_ms?: number;
  cost_microusd: string;
  charged_microusd: string;
  created_at: string;
}

interface UsageLogPage {
  items: UsageLog[];
  total: number;
}

export default function UsageLogPanel() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<UsageLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const limit = 50;

  const locale = LANGUAGE_LOCALES[language];
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }), [locale]);

  const load = async (nextOffset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const result = await apiJSON<UsageLogPage>(`/api/v1/usage-logs?limit=${limit}&offset=${nextOffset}`);
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setTotal(result.total);
      setOffset(nextOffset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.usage.loadError"));
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    void load(0, false);
  }, []);

  const formatTime = (milliseconds?: number) => milliseconds && milliseconds > 0
    ? `${(milliseconds / 1000).toFixed(2)}s`
    : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#f0dfbe]">{t("settings.usage.title")}</h3>
          <p className="mt-1 text-xs text-[#8f806d]">{t("settings.usage.description")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(0, false)}
          disabled={loading}
          title={t("settings.usage.refresh")}
          aria-label={t("settings.usage.refresh")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] text-[#b99a68] transition-colors hover:border-amber-500/50 hover:text-[#f1cc83] disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-[#8f806d]"><LoaderCircle size={20} className="animate-spin" /></div>
      ) : error ? (
        <p className="border border-rose-900/40 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</p>
      ) : items.length === 0 ? (
        <p className="border-y border-[#534741]/55 py-8 text-center text-sm text-[#8f806d]">{t("settings.usage.empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-[#534741]/65">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="border-b border-[#534741]/65 bg-[#25211e] text-[#a18d6f]">
                <tr>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.character")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.model")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.input")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.output")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.cacheRead")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.cacheWrite")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.latency")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.cost")}</th>
                  <th className="px-3 py-3 font-medium">{t("settings.usage.time")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#534741]/45">
                {items.map((item) => (
                  <tr key={item.id} className="bg-[#1d1a18] align-top text-[#d8c9b3]">
                    <td className="max-w-44 px-3 py-3">
                      <span className="block truncate" title={item.character_name || item.character_id || undefined}>
                        {item.character_name || t("settings.usage.unknownCharacter")}
                      </span>
                      {item.character_id && <span className="mt-1 block truncate font-mono text-[10px] text-[#71675b]">{item.character_id}</span>}
                    </td>
                    <td className="max-w-40 px-3 py-3">
                      <span className="block truncate font-mono">{item.model}</span>
                      <span className="mt-1 block text-[10px] text-[#71675b]">{item.provider}</span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{numberFormat.format(item.input_tokens)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {numberFormat.format(item.output_tokens)}
                      {item.reasoning_tokens > 0 && <span className="mt-1 block text-[10px] text-[#8f806d]">{t("settings.usage.reasoning")} {numberFormat.format(item.reasoning_tokens)}</span>}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-sky-300">{numberFormat.format(item.cache_read_input_tokens)}</td>
                    <td className="px-3 py-3 tabular-nums text-cyan-300">{numberFormat.format(item.cache_creation_input_tokens)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      <span className="block">{t("settings.usage.firstToken")} {formatTime(item.first_token_ms)}</span>
                      <span className="mt-1 block text-[#8f806d]">{t("settings.usage.totalTime")} {formatTime(item.duration_ms)}</span>
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-emerald-300">{formatMicrousd(item.charged_microusd || item.cost_microusd, 6)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-[#a99a83]">{dateFormat.format(new Date(item.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length < total && (
            <button
              type="button"
              onClick={() => void load(offset + limit, true)}
              disabled={loadingMore}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[#534741] text-sm text-[#d8c9b3] transition-colors hover:border-amber-500/50 hover:text-[#f1cc83] disabled:opacity-50"
            >
              {loadingMore && <LoaderCircle size={14} className="animate-spin" />}
              {t("settings.usage.loadMore")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
