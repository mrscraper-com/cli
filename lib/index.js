export { VERSION } from "./version.js";
export {
  configDir,
  authPath,
  credentialsPath,
  legacyCredentialsPath,
  loadAuth,
  saveAuth,
  clearAuth,
  loadSavedApiKey,
  saveApiKey,
  clearSavedApiKey,
} from "./config-store.js";
export {
  exchangeBrowserLoginCode,
  loginWithBrowser,
  buildAuthHeaders,
  runWithAuth,
  authStatus,
  logout,
  DEFAULT_BROWSER_LOGIN_API_BASE_URL,
} from "./auth.js";
export {
  BrowserLoginError,
  buildLoginUrl,
  createPkcePair,
  loginViaBrowser,
  openBrowser,
  DEFAULT_APP_BASE_URL,
  DEFAULT_BROWSER_LOGIN_TIMEOUT_MS,
} from "./browser-login.js";
export {
  scraperAPI,
  webSearch,
  account,
  request,
  sanitizeResponseData,
  normalizeSerpInput,
  API_BASE_URL,
  SCRAPER_API_BASE_URL,
  SYNC_SCRAPER_BASE_URL,
} from "./api.js";
export { renderStatusDashboard, summarizeSubscriptionAccount } from "./status.js";
