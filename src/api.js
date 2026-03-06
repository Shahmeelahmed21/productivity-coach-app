// src/api.js
import axios from "axios";
import Constants from "expo-constants";
import { getToken } from "./authStorage";

export const API_BASE = (() => {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env;

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    Constants.manifest?.hostUri;

  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:3000`;
  }

  return "http://localhost:3000";
})();

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// ✅ attach JWT automatically
api.interceptors.request.use(async (config) => {
  let token = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ✅ Gamification helper
export async function getProgressSafe() {
  try {
    const res = await api.get("/progress/me");
    return res?.data?.progress || null;
  } catch {
    return null;
  }
}

