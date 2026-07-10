import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SymbolColor {
  symbol: string;
  color: string;
}

export const symbolToHtmlTagMap: Record<string, string[]> = {
  "\"...\"": ["talk"],
  "*...*": ["em"],
  "**...**": ["strong"],
  "[...]": ["bracket-content"],
  "```...```": ["pre", "code"],
  ">...": ["blockquote"],
  "[...](...)": ["a"],
};

export const PREDEFINED_COLORS: Record<string, string[]> = {
  "\"...\"": ["#fda4af", "#fb7185", "#f43f5e", "#e11d48"],
  "*...*": ["#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed"],
  "**...**": ["#fb7185", "#f43f5e", "#e11d48", "#be123c"],
  "[...]": ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb"],
  "```...```": ["#86efac", "#4ade80", "#22c55e", "#16a34a"],
  ">...": ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb"],
  "[...](...)": ["#67e8f9", "#22d3ee", "#06b6d4", "#0891b2"],
};

interface SymbolColorStore {
  symbolColors: SymbolColor[];
  updateSymbolColors: (colors: SymbolColor[]) => void;
  getColorForSymbol: (symbol: string) => string | undefined;
  getColorForHtmlTag: (tagName: string, className?: string) => string | undefined;
  getPredefinedColors: (symbol: string) => string[];
  addCustomTag: (tagName: string, color?: string) => void;
}

const DEFAULT_SYMBOL_COLORS: SymbolColor[] = [
  { symbol: "\"...\"", color: "#fda4af" },
  { symbol: "*...*", color: "#c4b5fd" },
  { symbol: "**...**", color: "#fb7185" },
  { symbol: "[...]", color: "#93c5fd" },
  { symbol: "```...```", color: "#86efac" },
  { symbol: ">...", color: "#93c5fd" },
  { symbol: "[...](...)", color: "#67e8f9" },
];

export const useSymbolColorStore = create<SymbolColorStore>()(
  persist(
    (set, get) => ({
      symbolColors: DEFAULT_SYMBOL_COLORS,
      updateSymbolColors: (colors) => set({ symbolColors: colors }),
      getColorForSymbol: (symbol) => {
        const { symbolColors } = get();
        return symbolColors.find(sc => sc.symbol === symbol)?.color;
      },
      getColorForHtmlTag: (tagName, className) => {
        const { symbolColors } = get();
        const lowerTagName = tagName.toLowerCase();

        for (const sc of symbolColors) {
          const tagMappings = symbolToHtmlTagMap[sc.symbol];
          if (tagMappings) {
            for (const mapping of tagMappings) {
              if (mapping.includes(".")) {
                const [mappedTag, mappedClass] = mapping.split(".");
                if (lowerTagName === mappedTag.toLowerCase() &&
                    className?.includes(mappedClass)) {
                  return sc.color;
                }
              } else if (lowerTagName === mapping.toLowerCase()) {
                return sc.color;
              }
            }
          } else {
            if (sc.symbol.toLowerCase() === lowerTagName) {
              return sc.color;
            }
          }
        }
        return undefined;
      },
      getPredefinedColors: (symbol) => {
        return PREDEFINED_COLORS[symbol] || [];
      },
      addCustomTag: (tagName: string, color?: string) => {
        const { symbolColors } = get();
        const trimmedTagName = tagName.trim();
        if (trimmedTagName && !symbolColors.some(sc => sc.symbol.toLowerCase() === trimmedTagName.toLowerCase())) {
          const newSymbolColor: SymbolColor = {
            symbol: trimmedTagName,
            color: color || "#CCCCCC",
          };
          set({ symbolColors: [...symbolColors, newSymbolColor] });
        }
      },
    }),
    {
      name: "symbol-colors",
    },
  ),
);
