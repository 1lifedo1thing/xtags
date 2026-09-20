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
    instructions: "What is `post.text` mainly trying to do?",
    criteria: {
      inform: "传达信息或消息，读者能从中得到点什么。",
      persuade: "论证一个立场，试图改变读者的看法。",
      provoke: "目的是激起愤怒或对立反应。",
      sell: "推广商品、服务或作者自己的东西。",
      entertain: "逗乐、分享日常、社交性质。",
      other: "以上都不比一般情况更贴切。",
    },
  },

  rage_bait: {
    type: "noul",
    instructions:
      "Is `post.text` engineered to provoke an angry reaction rather than to inform?",
    criteria: {
      true: "把某个人或群体描绘成可鄙的；把一件令人愤怒的事当既成事实陈述而不给证据；或者公然邀请围攻。目的读起来是靠愤怒换互动。",
      false: "陈述作者看起来确实相信的观点，或者报告一件事——哪怕直白、带党派色彩、或者不客气。",
    },
  },

  synthetic: {
    type: "noul",
    instructions:
      "Does `post.text` read as machine-generated at volume rather than written by a person?",
    criteria: {
      true: "结构套路化、填充词空泛、挂着一个互动钩子但内容很少，或者带有批量生成帖子的典型措辞。",
      false: "有个人语气、有具体细节、有错别字，或者有真人打字的那种立场。",
    },
  },

  undisclosed_ad: {
    type: "noul",
    instructions:
      "Does `post.text` promote something commercially without disclosing that it is an ad?",
    criteria: {
      true: "推荐某个产品、链接或账号，读起来是收了钱或有利益关系的，但没有任何广告披露标记。",
      false: "不是商业推广；或者虽然推广但明显是作者自己的东西（自己的项目、自己的文章）。",
    },
  },
};

// Increment in background, content and popup when data practices require renewed consent.
const CONSENT_VERSION = 1;
const DEFAULTS = { apiKey: "", model: "jev-latest", enabled: false, consentVersion: 0, apiEndpoint: ENDPOINT, consentEndpoint: ENDPOINT, resetToken: 0 };
const CACHE_VERSION = 4;
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
    const cfg = await chrome.storage.local.get(DEFAULTS);
    cfg.model = cfg.model || "jev-latest";
    cfg.resetToken = cfg.resetToken ?? 0;
    if (settings && Object.keys(DEFAULTS).some((k) => settings[k] !== cfg[k])) {
      invalidate();
      if (settings.model !== cfg.model || settings.resetToken !== cfg.resetToken || settings.apiEndpoint !== cfg.apiEndpoint) cache.clear();
    }
    settings = cfg;
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
      if (/^\d+$/.test(id) && validAnswers(entry?.answers) && Number.isFinite(entry.at)) cache.set(id, entry);
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
  if (!["enabled", "consentVersion", "apiEndpoint", "consentEndpoint", "apiKey", "model", "resetToken"].some((k) => changes[k])) return;
  // 即使没有后续请求，也要保存重置和缓存的配置标记。
  ready.then(config).then((cfg) => persistCache(cfg, generation)).catch((e) => {
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
        cache.set(job.id, { answers: data.answers, at: Date.now() });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        let warning = "";
        try { await persistCache(job.cfg, job.generation); }
        catch { warning = "缓存保存失败；刷新后可能重新请求"; }
        current(job);
        job.resolve({ ...data, warning, warningCode: warning ? "errorCacheWrite" : "" });
      } catch (e) { job.reject(e); }
      finally {
        running.delete(job);
        if (jobs.get(job.id) === job) jobs.delete(job.id);
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
  if (cache.has(msg.id)) return { answers: cache.get(msg.id).answers, cached: true, usage: { input_tokens: 0 } };
  if (jobs.has(msg.id)) {
    const data = await jobs.get(msg.id).promise;
    return { ...data, shared: true, usage: { input_tokens: 0 } };
  }
  if (jobs.size >= 300) throw Object.assign(new Error("请求队列已满，请稍后刷新页面"), { code: "errorQueueFull" });
  const job = { id: msg.id, state: { post: { text: post.text, author: post.author } }, cfg, generation: epoch, controller: new AbortController() };
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job.promise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "jev-ask") return;
  if (sender.id !== chrome.runtime.id || !/^https:\/\/(x|twitter)\.com\//.test(sender.url ?? "")) {
    sendResponse({ ok: false, error: "不支持的消息来源", code: "errorSource" });
    return;
  }
  ask(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: e.message, code: e.code || "errorRequest", cancelled: !!e.cancelled }),
  );
  return true;
});
