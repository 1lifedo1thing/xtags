/* 后台统一管理请求、跨标签页去重和持久化缓存。 */

importScripts("service.js");
const ENDPOINT = XtagsService.OFFICIAL_URL;

/**
 * 四个判断。全部是"知识渊博的人一秒能答"的问题，没有一条需要慢推理。
 *
 * 注意这里没有"这条帖子好不好"这类问题——那种问题没有一致答案，问它只会得到
 * 一个自信的噪声。问题本身必须是能被判定的。
 */
const QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "What is `post.text` mainly doing to the reader? Judge its dominant function from the text, not the author's private motive.",
    criteria: {
      inform: "主要传达消息、信息、观察或经历；可以带态度，但不以改变立场或激起对立为主。",
      persuade: "表达立场、理由或主张，主要想改变读者看法；措辞强烈本身不等于挑拨。",
      provoke: "主要把读者推向对某人或群体的愤怒、敌视或站队；单纯表达愤怒或批评不算。",
      sell: "推广商品、服务或作者自己的东西。",
      entertain: "逗乐、分享日常、社交性质。",
      other: "以上都不比一般情况更贴切。",
    },
  },

  rage_bait: {
    type: "noul",
    instructions:
      "Does `post.text` use anger or hostility to push readers toward taking sides, attacking someone, or amplifying the post, rather than merely reporting, arguing, or expressing anger?",
    criteria: {
      true: "通过群体归罪、贬损、煽动围攻，或以愤怒催促转发和互动，把读者推向敌视或对立；不要求出现命令句。",
      false: "报告坏消息、提出立场、激烈批评或表达个人愤怒，但没有用措辞推动读者围攻、站队或扩散。未附证据本身不足以判真。",
    },
  },

  synthetic: {
    type: "noul",
    instructions:
      "Does `post.text` read like formulaic, mass-produced copy? Judge textual patterns, not whether AI actually wrote it.",
    criteria: {
      true: "明显堆叠模板化结构、空泛套话、重复排比或通用互动钩子，且缺少与主题相关的具体内容；一处常见短语不足以判真。",
      false: "有具体信息或自然个人语气；文本太短、特征不足时，不因流畅、工整或没有错别字而判为机器生成。",
    },
  },

  undisclosed_ad: {
    type: "noul",
    instructions:
      "Does `post.text` present a commercial recommendation as an independent opinion without visible disclosure? Judge the wording, not whether a payment or partnership actually exists.",
    criteria: {
      true: "对产品、服务、链接或账号作明显推荐并导向购买、关注或点击，同时包装成独立体验或中立评价，帖中看不到广告、合作或利益关系说明。",
      false: "不是商业推荐；明确写明广告或合作；或者明显在推广自己的项目、作品或服务。仅出现品牌或链接不足以判真。",
    },
  },
};

// Increment in background, content and popup when data practices require renewed consent.
const CONSENT_VERSION = 2;
const DEFAULTS = { apiKey: "", keyRevision: "", model: "jev-latest", enabled: false, consentVersion: 0, apiEndpoint: ENDPOINT, consentEndpoint: ENDPOINT, resetToken: 0 };
const PUBLIC_DEFAULTS = { threshold: 0.8, showAll: false, skipReplies: true, showHud: true, language: "auto" };
const PUBLIC_KEYS = ["keyRevision", "model", "enabled", "consentVersion", "apiEndpoint", "consentEndpoint", "resetToken",
  ...Object.keys(PUBLIC_DEFAULTS)];
// Cached probabilities are tied to the exact classification questions.
const CACHE_VERSION = 6;
const CACHE_LIMIT = 3000;
const MAX_INFLIGHT = 3;
const REQUEST_TIMEOUT = 20000;
const MAX_ATTEMPTS = 3;
const cache = new Map();
const jobs = new Map();
const running = new Set();
let queue = [];
let generation = 0;
let writes = Promise.resolve();
let configReads = Promise.resolve();
let settings = null;
let publicSnapshot = "";

// Restrict the persistent area before reading the key. Only a sanitized,
// in-memory settings snapshot is exposed to content scripts.
const storageAccessReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .then(() => chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }));

function publicConfig(cfg) {
  const visible = Object.fromEntries(PUBLIC_KEYS.map((key) => [key, cfg[key]]));
  visible.hasKey = !!cfg.apiKey;
  return visible;
}

async function publishPublicConfig(cfg) {
  const visible = publicConfig(cfg);
  const serialized = JSON.stringify(visible);
  if (serialized !== publicSnapshot) {
    await chrome.storage.session.set({ publicConfig: visible });
    publicSnapshot = serialized;
  }
  return visible;
}

function cancelled() {
  return Object.assign(new Error("设置已变化，请求已取消"), { cancelled: true, code: "errorCancelled" });
}

function validAnswers(a) {
  const probability = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  return !!a && Object.hasOwn(QUESTIONS.intent.criteria, a.intent?.choice) &&
    probability(a.intent.confidence) && probability(a.intent.probabilities?.[a.intent.choice]) &&
    ["rage_bait", "synthetic", "undisclosed_ad"].every((k) => probability(a[k]?.noul));
}

function current(job) {
  if (job.generation !== generation || job.controller.signal.aborted) throw cancelled();
}

function invalidate() {
  generation++;
  for (const job of jobs.values()) {
    job.controller.abort();
    job.reject(cancelled());
  }
  jobs.clear();
  queue = [];
}

// 单一写入者，串行落盘；重置后的空缓存总是在旧写入之后提交。
function persistCache(cfg, epoch) {
  const write = writes.then(async () => {
    if (epoch !== generation) return;
    await chrome.storage.local.set({
      cacheVersion: CACHE_VERSION,
      cacheModel: cfg.model,
      cacheEndpoint: cfg.apiEndpoint,
      cacheResetToken: cfg.resetToken,
      cache: Object.fromEntries(cache),
    });
  });
  writes = write.catch((e) => console.warn("[xtags] 缓存保存失败:", e.message));
  return write;
}

// 配置通知和 runtime 消息跨进程到达顺序不确定。每次读取都对齐状态，
// 而不是假定 storage.onChanged 一定先于新请求执行。
function config() {
  const read = configReads.then(async () => {
    await storageAccessReady;
    const cfg = await chrome.storage.local.get({ ...DEFAULTS, ...PUBLIC_DEFAULTS });
    cfg.model = cfg.model || "jev-latest";
    cfg.resetToken = cfg.resetToken ?? 0;
    if (settings && Object.keys(DEFAULTS).some((k) => settings[k] !== cfg[k])) {
      invalidate();
      if (settings.model !== cfg.model || settings.resetToken !== cfg.resetToken || settings.apiEndpoint !== cfg.apiEndpoint) cache.clear();
    }
    settings = cfg;
    await publishPublicConfig(cfg);
    return cfg;
  });
  configReads = read.catch(() => {});
  return read;
}

const ready = (async () => {
  const epoch = generation;
  const cfg = await config();
  const stored = await chrome.storage.local.get(["cacheVersion", "cacheModel", "cacheEndpoint", "cacheResetToken", "cache"]);
  if (epoch !== generation) return;
  if ((stored.cacheEndpoint ?? ENDPOINT) === cfg.apiEndpoint && stored.cacheVersion === CACHE_VERSION && stored.cacheModel === cfg.model &&
      stored.cacheResetToken === cfg.resetToken) {
    for (const [id, entry] of Object.entries(stored.cache ?? {}).slice(-CACHE_LIMIT)) {
      if (/^\d+$/.test(id) && /^[a-f0-9]{64}$/.test(entry?.fingerprint) &&
          validAnswers(entry?.answers) && Number.isFinite(entry.at)) cache.set(id, entry);
    }
  }
})();

const ICONS = Object.fromEntries(["on", "off"].map((state) => [state,
  Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${state}/icon${size}.png`])),
]));
async function syncIcon() {
  try {
    const cfg = await config();
    await chrome.action.setIcon({ path: cfg.enabled === true && XtagsService.hasConsent(cfg, CONSENT_VERSION) ? ICONS.on : ICONS.off });
  } catch (e) { console.warn("[xtags] 图标切换失败:", e.message); }
}
chrome.runtime.onInstalled.addListener(syncIcon);
chrome.runtime.onStartup.addListener(syncIcon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.consentVersion || changes.apiEndpoint || changes.consentEndpoint) syncIcon();
  const cacheInputsChanged = ["enabled", "consentVersion", "apiEndpoint", "consentEndpoint", "apiKey", "keyRevision", "model", "resetToken"].some((k) => changes[k]);
  if (!cacheInputsChanged && !PUBLIC_KEYS.some((k) => changes[k])) return;
  // 即使没有后续请求，也要保存重置和缓存的配置标记。
  ready.then(config).then((cfg) => cacheInputsChanged ? persistCache(cfg, generation) : undefined).catch((e) => {
    console.warn("[xtags] 缓存更新失败:", e.message);
  });
});
syncIcon();
chrome.permissions.onRemoved.addListener(() => invalidate());

async function ensureAccess(cfg) {
  const endpoint = XtagsService.endpoint(cfg);
  if (!await chrome.permissions.contains({ origins: [XtagsService.originPattern(endpoint)] })) {
    throw Object.assign(new Error("请在设置页授权当前 API 服务域名"), { code: "errorEndpointPermission", retryable: false });
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function fingerprint(post) {
  const bytes = new TextEncoder().encode(JSON.stringify(post));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function request(job) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    current(job);
    // 每次实际发送前再检查配置，包括重试；不只依赖内容脚本的开关。
    let cfg = await config();
    await ensureAccess(cfg);
    cfg = await config();
    current(job);
    if (cfg.enabled !== true || !XtagsService.hasConsent(cfg, CONSENT_VERSION) || !cfg.apiKey || cfg.resetToken !== job.cfg.resetToken || cfg.model !== job.cfg.model) {
      throw cancelled();
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    job.controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, REQUEST_TIMEOUT);
    let retryAfter = 1000 * 2 ** attempt;
    try {
      const res = await fetch(XtagsService.endpoint(cfg), {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ state: job.state, questions: QUESTIONS, model: cfg.model }),
      });
      current(job);
      if (!res.ok) {
        const body = await res.text();
        const seconds = Number(res.headers.get("Retry-After"));
        if (Number.isFinite(seconds) && seconds > 0) retryAfter = Math.min(seconds * 1000, 20000);
        throw Object.assign(new Error(`${res.status} ${body.slice(0, 200)}`), {
          retryable: res.status === 429 || res.status >= 500,
          code: "errorHttp",
        });
      }
      const data = await res.json();
      current(job);
      if (!validAnswers(data.answers)) {
        throw Object.assign(new Error("API 返回的判断格式无效"), { retryable: false, code: "errorInvalidResponse" });
      }
      const tokens = data.usage?.input_tokens;
      return { answers: data.answers, usage: { input_tokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : 0 } };
    } catch (e) {
      current(job);
      if (e.retryable === false || attempt === MAX_ATTEMPTS - 1) {
        if (typeof e.code === "string") throw e;
        throw Object.assign(new Error(e.message), {
          code: controller.signal.aborted ? "errorTimeout" : e instanceof SyntaxError ? "errorInvalidResponse" : "errorNetwork",
        });
      }
    } finally {
      clearTimeout(timer);
      job.controller.signal.removeEventListener("abort", abort);
    }
    await delay(retryAfter, job.controller.signal);
  }
}

function pump() {
  while (running.size < MAX_INFLIGHT && queue.length) {
    const job = queue.shift();
    if (job.generation !== generation) continue;
    running.add(job);
    (async () => {
      try {
        const data = await request(job);
        await ensureAccess(await config());
        await config();
        current(job);
        cache.delete(job.id);
        cache.set(job.id, { answers: data.answers, fingerprint: job.fingerprint, at: Date.now() });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        let warning = "";
        try { await persistCache(job.cfg, job.generation); }
        catch { warning = "缓存保存失败；刷新后可能重新请求"; }
        current(job);
        job.resolve({ ...data, warning, warningCode: warning ? "errorCacheWrite" : "" });
      } catch (e) { job.reject(e); }
      finally {
        running.delete(job);
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        pump();
      }
    })();
  }
}

async function ask(msg) {
  await ready;
  const cfg = await config();
  const epoch = generation;
  const endpoint = XtagsService.endpoint(cfg);
  if (!XtagsService.hasConsent(cfg, CONSENT_VERSION)) throw Object.assign(new Error("请先在设置页中同意数据传输"), { code: "errorConsentRequired" });
  if (XtagsService.endpoint(msg) !== endpoint || cfg.enabled !== true || msg.resetToken !== cfg.resetToken || msg.model !== cfg.model) throw cancelled();
  if (!cfg.apiKey) throw Object.assign(new Error("还没有配置 API key"), { code: "errorNoKey" });
  const post = msg.state?.post;
  if (typeof msg.id !== "string" || !/^\d{1,30}$/.test(msg.id) ||
      typeof post?.text !== "string" || !post.text.trim() || post.text.length > 100000 ||
      !(post.author === null || (typeof post.author === "string" && /^@[A-Za-z0-9_]{1,15}$/.test(post.author)))) {
    throw Object.assign(new Error("帖子请求格式无效"), { code: "errorInvalidRequest" });
  }
  const inputFingerprint = await fingerprint(post);
  if (epoch !== generation) throw cancelled();
  const key = `${msg.id}:${inputFingerprint}`;
  if (cache.get(msg.id)?.fingerprint === inputFingerprint) return { answers: cache.get(msg.id).answers, cached: true, usage: { input_tokens: 0 } };
  if (jobs.has(key)) {
    const data = await jobs.get(key).promise;
    return { ...data, shared: true, usage: { input_tokens: 0 } };
  }
  if (jobs.size >= 300) throw Object.assign(new Error("请求队列已满，请稍后刷新页面"), { code: "errorQueueFull" });
  const job = { id: msg.id, key, fingerprint: inputFingerprint,
    state: { post: { text: post.text, author: post.author } }, cfg, generation: epoch, controller: new AbortController() };
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  jobs.set(key, job);
  queue.push(job);
  pump();
  return job.promise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "jev-ask" && msg?.type !== "xtags-config") return;
  if (sender.id !== chrome.runtime.id || !/^https:\/\/(x|twitter)\.com\//.test(sender.url ?? "")) {
    sendResponse({ ok: false, error: "不支持的消息来源", code: "errorSource" });
    return;
  }
  if (msg.type === "xtags-config") {
    ready.then(config).then(
      (cfg) => sendResponse({ ok: true, data: publicConfig(cfg) }),
      () => sendResponse({ ok: false, error: "设置读取失败", code: "errorConfig" }),
    );
    return true;
  }
  ask(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: e.message, code: e.code || "errorRequest", cancelled: !!e.cancelled }),
  );
  return true;
});
