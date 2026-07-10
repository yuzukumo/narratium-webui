import React, { useState } from "react";
import { useLanguage } from "@/app/i18n";
import { SketchPicker } from "react-color";
import { useSymbolColorStore } from "@/contexts/SymbolColorStore";
import { toast } from "react-hot-toast";

interface SymbolColor {
  symbol: string;
  color: string;
}

interface TagColorEditorProps {
  onSave: (colors: SymbolColor[]) => void;
  onViewSwitch?: () => void;
}

const DEFAULT_SYMBOLS_PREDEFINED = [
  "\"...\"",
  "*...*",
  "**...**",
  "[...]",
  "```...```",
  ">...",
  "[...](...)",
];

export const TagColorEditor: React.FC<TagColorEditorProps> = ({ onSave, onViewSwitch }) => {
  const { t, fontClass, serifFontClass } = useLanguage();
  const { symbolColors, updateSymbolColors, getPredefinedColors, addCustomTag } = useSymbolColorStore();
  const [newSymbol, setNewSymbol] = useState("");
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddSymbol = () => {
    const trimmedSymbol = newSymbol.trim();
    if (trimmedSymbol) {
      addCustomTag(trimmedSymbol);
      setNewSymbol("");
    }
  };

  const handleColorChange = (symbol: string, color: string) => {
    const newSymbolColors = symbolColors.map(sc => 
      sc.symbol === symbol ? { ...sc, color } : sc,
    );
    updateSymbolColors(newSymbolColors);
    if (onViewSwitch) {
      onViewSwitch();
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      await onSave(symbolColors);
      toast.success(t("characterChat.saveSuccess") || "Settings saved successfully");
      if (onViewSwitch) {
        onViewSwitch();
      }
    } catch (error) {
      console.error("Failed to save color settings:", error);
      toast.error(t("characterChat.saveFailed") || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSymbol = (symbolToDelete: string) => {
    if (DEFAULT_SYMBOLS_PREDEFINED.includes(symbolToDelete)) return;
    updateSymbolColors(symbolColors.filter(sc => sc.symbol !== symbolToDelete));
  };

  const handlePredefinedColorSelect = (symbol: string, color: string) => {
    handleColorChange(symbol, color);
    setActiveColorPicker(null);
  };

  return (
    <div className={`p-4 ${fontClass} relative`}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-gradient-to-br from-amber-500/10 to-transparent rounded-full blur-3xl"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-gradient-to-tr from-amber-500/10 to-transparent rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/30 flex items-center justify-center border border-amber-500/30 shadow-lg shadow-amber-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <circle cx="13.5" cy="6.5" r=".5"></circle>
              <circle cx="17.5" cy="10.5" r=".5"></circle>
              <circle cx="8.5" cy="7.5" r=".5"></circle>
              <circle cx="6.5" cy="12.5" r=".5"></circle>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
            </svg>
          </div>
          <h3 className={`text-lg font-semibold ${serifFontClass} bg-clip-text text-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300`}>
            {t("characterChat.tagColorEditor")}
          </h3>
        </div>

        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder={t("characterChat.enterSymbol")}
              className="relative z-10 w-full px-3 py-2 bg-gradient-to-br from-[#1a1816] via-[#252220] to-[#1a1816] text-[#eae6db] rounded-lg border border-[#534741]/60 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all duration-300 hover:border-[#534741] backdrop-blur-sm shadow-inner"
            />
          </div>
          <button
            onClick={handleAddSymbol}
            className="relative group px-4 py-2 bg-gradient-to-r from-[#1f1c1a] to-[#13100e] hover:from-[#282521] hover:to-[#1a1613] text-[#e9c08d] hover:text-[#f6daae] rounded-md transition-all duration-300 text-sm font-medium shadow-lg hover:shadow-[#f8b758]/20 border border-[#403a33]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <span className="relative z-10 flex items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:scale-110">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>{t("characterChat.add")}</span>
            </span>
          </button>
        </div>

        <div className="space-y-4">
          {symbolColors.map(({ symbol, color }) => (
            <div 
              key={symbol} 
              className={`group relative flex items-center justify-between p-3 ${
                activeColorPicker === symbol ? "z-[999]" : "z-0"
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="relative z-10 flex flex-col">
                <span className={`${serifFontClass} text-lg text-[#eae6db]`}>{symbol}</span>
              </div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="flex gap-2">
                  {getPredefinedColors(symbol).map((predefinedColor: string) => (
                    <button
                      key={predefinedColor}
                      className="relative group/color w-6 h-6 rounded-full border border-white/20 hover:scale-110 transition-transform shadow-lg hover:shadow-amber-500/20"
                      style={{ backgroundColor: predefinedColor }}
                      onClick={() => handlePredefinedColorSelect(symbol, predefinedColor)}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-full opacity-0 group-hover/color:opacity-100 transition-opacity duration-300"></div>
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <div
                    className="relative group/color w-8 h-8 rounded cursor-pointer border border-white/20 hover:scale-110 transition-transform shadow-lg hover:shadow-amber-500/20"
                    style={{ backgroundColor: color }}
                    onClick={() => setActiveColorPicker(activeColorPicker === symbol ? null : symbol)}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded opacity-0 group-hover/color:opacity-100 transition-opacity duration-300"></div>
                  </div>
                  {activeColorPicker === symbol && (
                    <div className="absolute right-0 top-full mt-2 z-50">
                      <div className="fixed inset-0" onClick={() => setActiveColorPicker(null)} />
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent rounded-lg blur-xl"></div>
                        <SketchPicker
                          color={color}
                          onChange={(colorResult) => handleColorChange(symbol, colorResult.hex)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {!DEFAULT_SYMBOLS_PREDEFINED.includes(symbol) && (
                  <button
                    onClick={() => handleDeleteSymbol(symbol)}
                    className="relative group/delete p-1 text-red-400 hover:text-red-300 transition-colors duration-300"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent rounded opacity-0 group-hover/delete:opacity-100 transition-opacity duration-300"></div>
                    <span className="relative z-10">×</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`relative group mt-6 w-full px-4 py-2 bg-gradient-to-r from-[#1f1c1a] to-[#13100e] hover:from-[#282521] hover:to-[#1a1613] text-[#e9c08d] hover:text-[#f6daae] rounded-md transition-all duration-300 text-sm font-medium shadow-lg hover:shadow-[#f8b758]/20 border border-[#403a33] ${isSaving ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          <span className="relative z-10 flex items-center justify-center space-x-2">
            {isSaving ? (
              <svg className="animate-spin h-4 w-4 text-[#e9c08d]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:scale-110">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
            )}
            <span>{isSaving ? t("characterChat.saving") : t("characterChat.saveChanges")}</span>
          </span>
        </button>
      </div>
    </div>
  );
};
