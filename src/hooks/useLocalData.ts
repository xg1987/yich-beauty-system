import { useState } from "react";
import { seedData } from "../domain/seed";
import type { AppData } from "../domain/types";

const STORAGE_KEY = "yich-system-data";

export function useLocalData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const initial = saved ? (JSON.parse(saved) as AppData) : seedData;
  const [data, setDataState] = useState(initial);

  const setData = (updater: AppData | ((previous: AppData) => AppData)) => {
    setDataState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetData = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
    setDataState(seedData);
  };

  return { data, setData, resetData };
}
