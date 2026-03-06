import * as SecureStore from "expo-secure-store";

const KEY = "auth_token_v1";
let memoryToken = null;

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export async function saveToken(token) {
  try {
    await SecureStore.setItemAsync(KEY, token);
    return;
  } catch {}

  if (hasLocalStorage()) {
    localStorage.setItem(KEY, token);
    return;
  }

  memoryToken = token;
}

export async function getToken() {
  try {
    const token = await SecureStore.getItemAsync(KEY);
    if (token) return token;
  } catch {}

  if (hasLocalStorage()) {
    return localStorage.getItem(KEY);
  }

  return memoryToken;
}

export async function clearToken() {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {}

  if (hasLocalStorage()) {
    localStorage.removeItem(KEY);
  }

  memoryToken = null;
}
