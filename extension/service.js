/* Shared endpoint validation and consent binding across extension contexts. */
(() => {
  const OFFICIAL_URL = "https://api.typesafe.ai/v1/systemone";
  function normalize(value) {
    try {
      if (typeof value !== "string" || !value.trim() || /[\s\\]/.test(value.trim())) throw new Error();
      const url = new URL(value.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
          /[?#*]/.test(value) || !url.hostname) throw new Error();
      return url.href;
    } catch {
      throw Object.assign(new Error("请输入不含账号、查询参数或片段的完整 HTTPS API URL"), { code: "errorInvalidEndpoint" });
    }
  }
  const endpoint = cfg => normalize(cfg.apiEndpoint === undefined ? OFFICIAL_URL : cfg.apiEndpoint);
  // Chrome host permissions apply to a host, not an individual path or port.
  const originPattern = value => `https://${new URL(normalize(value)).hostname}/*`;
  function hasConsent(cfg, version = 1) {
    try {
      return cfg.consentVersion === version && endpoint(cfg) === normalize(
        cfg.consentEndpoint === undefined ? OFFICIAL_URL : cfg.consentEndpoint);
    } catch { return false; }
  }
  globalThis.XtagsService = Object.freeze({ OFFICIAL_URL, normalize, endpoint, originPattern, hasConsent });
})();
