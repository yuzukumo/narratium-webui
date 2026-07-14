"use client";

import { useState, useRef } from "react";
import { useLanguage } from "@/app/i18n";
import { trackButtonClick } from "@/utils/google-analytics";
import { handleCharacterUpload } from "@/function/character/import";
import { parseCharacterBundle } from "@/utils/character-parser";
import { embeddedRegexScripts, normalizeCharacterCard } from "@/lib/character-card/normalize";
import {
  MAX_PROTAGONIST_NAME_LENGTH,
  normalizeProtagonistName,
} from "@/lib/data/character-record-operation";

interface ImportCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: () => void;
}

export default function ImportCharacterModal({ isOpen, onClose, onImport }: ImportCharacterModalProps) {
  const { t, fontClass, serifFontClass } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [embeddedScriptCount, setEmbeddedScriptCount] = useState(0);
  const [trustEmbeddedRegex, setTrustEmbeddedRegex] = useState(false);
  const [protagonistName, setProtagonistName] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCharacterCardFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return name.endsWith(".png") || name.endsWith(".json") || name.endsWith(".charx");
  };

  const selectFile = async (file: File) => {
    setSelectedFile(file);
    setError("");
    setEmbeddedScriptCount(0);
    setTrustEmbeddedRegex(false);
    setProtagonistName("");
    try {
      const bundle = await parseCharacterBundle(file);
      const card = normalizeCharacterCard(JSON.parse(bundle.data));
      setEmbeddedScriptCount(embeddedRegexScripts(card).length);
    } catch {
      // The import action reports malformed card metadata consistently.
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (isCharacterCardFile(file)) {
        void selectFile(file);
      } else {
        setError(t("importCharacterModal.pngOnly"));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (isCharacterCardFile(file)) {
        void selectFile(file);
      } else {
        setError(t("importCharacterModal.pngOnly"));
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError(t("importCharacterModal.noFileSelected"));
      return;
    }

    try {
      normalizeProtagonistName(protagonistName);
    } catch {
      setError(t("importCharacterModal.protagonistNameRequired"));
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const response = await handleCharacterUpload(selectedFile, {
        protagonistName,
        trustEmbeddedRegex,
      });

      if (!response.success) {
        throw new Error(t("importCharacterModal.uploadFailed"));
      }

      onImport();
      onClose();
    } catch (err) {
      console.error("Error uploading character:", err);
      setError(typeof err === "string" ? err : t("importCharacterModal.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setEmbeddedScriptCount(0);
    setTrustEmbeddedRegex(false);
    setProtagonistName("");
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="ui-fade-in absolute inset-0 backdrop-blur-sm bg-opacity-50"
        onClick={handleClose}
      />
          
      <div
        className="ui-dialog-enter fantasy-bg fantasy-scrollbar relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-[#534741] bg-[#1e1c1b] bg-opacity-75 shadow-xl backdrop-filter backdrop-blur-sm"
      >
        <div className="p-6">
          <h2 className={`text-xl text-[#eae6db] mb-4 ${serifFontClass}`}>{t("importCharacterModal.title")}</h2>

          <p className={`text-[#c0a480] mb-6 text-sm ${fontClass}`}>
            {t("importCharacterModal.description")}
          </p>
              
          <div
            className={`border-2 border-dashed rounded-lg p-8 mb-4 text-center transition-colors duration-300 ${isDragging ? "border-[#f9c86d] bg-[#252220]" : "border-[#534741] hover:border-[#a18d6f]"}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png,.json,.charx,application/json,application/zip"
              onChange={handleFileSelect}
            />
                
            <div className="flex flex-col items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-12 h-12 mb-3 ${selectedFile ? "text-[#f9c86d]" : "text-[#a18d6f]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
                  
              {selectedFile ? (
                <div className={`text-[#eae6db] ${fontClass}`}>
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-[#a18d6f] mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className={`text-[#a18d6f] ${fontClass}`}>
                  <p>{t("importCharacterModal.dragOrClick")}</p>
                  <p className="text-xs mt-1">{t("importCharacterModal.pngFormat")}</p>
                </div>
              )}
            </div>
          </div>

          {selectedFile && (
            <label className={`mb-4 block text-sm text-[#c0a480] ${fontClass}`}>
              <span className="block text-xs font-medium text-[#d8c9b3]">
                {t("importCharacterModal.protagonistName")}
              </span>
              <input
                autoComplete="off"
                autoFocus
                maxLength={MAX_PROTAGONIST_NAME_LENGTH}
                value={protagonistName}
                onChange={(event) => {
                  setProtagonistName(event.target.value);
                  setError("");
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-[#534741] bg-[#171513] px-3 text-sm text-[#eae6db] outline-none transition-colors placeholder:text-[#706455] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                placeholder={t("importCharacterModal.protagonistNamePlaceholder")}
              />
              <span className="mt-1.5 block text-[11px] text-[#817361]">
                {t("importCharacterModal.protagonistNameImmutable")}
              </span>
            </label>
          )}

          {error && (
            <div className="text-[#e57373] text-sm mb-4 text-center">
              {error}
            </div>
          )}

          {embeddedScriptCount > 0 && (
            <label className={`mb-4 flex cursor-pointer items-center gap-3 rounded-md border border-[#534741] bg-[#252220]/70 px-3 py-2.5 text-sm text-[#c0a480] ${fontClass}`}>
              <input
                type="checkbox"
                checked={trustEmbeddedRegex}
                onChange={(event) => setTrustEmbeddedRegex(event.target.checked)}
                className="h-4 w-4 rounded border-[#534741] bg-[#1a1816] text-amber-500 focus:ring-amber-500/40"
              />
              <span>{t("importCharacterModal.enableEmbeddedRegex")}</span>
            </label>
          )}

          <div className="flex justify-end space-x-3">
            <button
              onClick={handleClose}
              className={`px-4 py-2 text-[#c0a480] hover:text-[#ffd475] transition-colors ${fontClass}`}
            >
              {t("common.cancel")}
            </button>

            <button
              onClick={(e) => {trackButtonClick("ImportCharacterModal", "导入角色");handleUpload();}}
              disabled={!selectedFile || !protagonistName.trim() || isUploading}
              className={`px-4 py-2 bg-[#252220] hover:bg-[#3a2a2a] border border-[#534741] rounded-md text-[#f9c86d] transition-colors ${fontClass} ${(!selectedFile || !protagonistName.trim() || isUploading) ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isUploading ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 mr-2 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
                  {t("importCharacterModal.uploading")}
                </div>
              ) : t("importCharacterModal.import")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
