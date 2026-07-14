"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJSON, AvailableModel } from "@/utils/api-client";
import { ApiConfig, setRuntimeApiConfig } from "@/utils/api-config";

interface ModelContextValue {
  models: AvailableModel[];
  activeModel: AvailableModel | null;
  loading: boolean;
  error: string;
  activateCharacter: (characterId: string) => void;
  selectModel: (id: string) => void;
  refresh: () => Promise<void>;
}

const ModelContext = createContext<ModelContextValue | null>(null);
const CHARACTER_MODEL_KEY_PREFIX = "characterModelId:";

export const characterModelPreferenceKey = (characterId: string): string => (
  `${CHARACTER_MODEL_KEY_PREFIX}${characterId}`
);

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [activeModelId, setActiveModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const modelsRef = useRef<AvailableModel[]>([]);
  const activeModelIdRef = useRef("");
  const activeCharacterIdRef = useRef("");
  const loadedRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const setActiveID = useCallback((id: string) => {
    activeModelIdRef.current = id;
    setActiveModelId(id);
  }, []);

  const resolveCharacterModel = useCallback((items: AvailableModel[], characterId: string) => {
    const storedID = characterId
      ? window.localStorage.getItem(characterModelPreferenceKey(characterId)) || ""
      : "";
    return items.find((model) => model.id === storedID)
      || items.find((model) => model.id === activeModelIdRef.current)
      || items[0]
      || null;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    setLoading(true);
    setError("");
    const request = (async () => {
      try {
        const payload = await apiJSON<{ items: AvailableModel[] }>("/api/v1/models");
        modelsRef.current = payload.items;
        setModels(payload.items);
        const selected = resolveCharacterModel(payload.items, activeCharacterIdRef.current);
        setActiveID(selected?.id || "");
        if (selected && activeCharacterIdRef.current) {
          window.localStorage.setItem(
            characterModelPreferenceKey(activeCharacterIdRef.current),
            selected.id,
          );
        }
        window.localStorage.removeItem("activeModelId");
        window.localStorage.removeItem("reasoningEffortEnabled");
        window.localStorage.removeItem("reasoningEffort");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load models.");
      } finally {
        loadedRef.current = true;
        setLoading(false);
      }
    })();
    refreshPromiseRef.current = request;
    void request.finally(() => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    });
    return request;
  }, [resolveCharacterModel, setActiveID]);

  const activateCharacter = useCallback((characterId: string) => {
    const normalizedID = characterId.trim();
    activeCharacterIdRef.current = normalizedID;
    if (!loadedRef.current) {
      void refresh();
      return;
    }
    const selected = resolveCharacterModel(modelsRef.current, normalizedID);
    setActiveID(selected?.id || "");
    if (selected && normalizedID) {
      window.localStorage.setItem(characterModelPreferenceKey(normalizedID), selected.id);
    }
  }, [refresh, resolveCharacterModel, setActiveID]);

  const selectModel = useCallback((id: string) => {
    if (!modelsRef.current.some((model) => model.id === id)) {
      return;
    }
    setActiveID(id);
    if (activeCharacterIdRef.current) {
      window.localStorage.setItem(
        characterModelPreferenceKey(activeCharacterIdRef.current),
        id,
      );
    }
  }, [setActiveID]);

  const activeModel = useMemo(
    () => models.find((model) => model.id === activeModelId) || null,
    [activeModelId, models],
  );

  useEffect(() => {
    const config: ApiConfig | null = activeModel ? {
      id: activeModel.id,
      name: activeModel.external_id,
      type: activeModel.provider,
      model: activeModel.id,
      externalModel: activeModel.external_id,
      contextWindow: activeModel.capabilities.context_window || 0,
      compactionThreshold: activeModel.capabilities.compaction_threshold || 0,
      maxOutputTokens: activeModel.capabilities.max_output_tokens || 0,
    } : null;
    setRuntimeApiConfig(config);
    return () => setRuntimeApiConfig(null);
  }, [activeModel]);

  const value = useMemo<ModelContextValue>(() => ({
    models,
    activeModel,
    loading,
    error,
    activateCharacter,
    selectModel,
    refresh,
  }), [activeModel, activateCharacter, error, loading, models, refresh, selectModel]);

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModels(): ModelContextValue {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error("useModels must be used inside ModelProvider");
  }
  return context;
}
