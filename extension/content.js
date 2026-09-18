/*
 * 内容脚本：提取帖子、贴标签、维护缓存和统计。
 *
 * 它**不发请求**——那件事在 background.js 里做，因为内容脚本的 fetch 受 CORS 约束。
 * 这里只负责 DOM 那一半：读状态、渲染标签、决定什么时候该问。
 *
 * 判断和展示是分开的：background 拿回来的四个判断是"是什么"，怎么组合成标签、
 * 什么时候显示由下面的 compose() 决定。跟 src/triage.ts 里 routeTicket 的分层同理。
 */

(function () {
  "use strict";

  // ── 配置（从 chrome.storage 异步加载）─────────────────────────────────────
  const DEFAULTS = {
    apiKey: "",
    model: "jev-latest",
    threshold: 0.8,
    showAll: false,
    enabled: true,
    skipReplies: true,
    showHud: true,
  };

  /** 内容脚本只需要知道"配没配"，不持有 key——请求由 background 发。 */
  let HAS_KEY = false;
  let MODEL = "jev-latest";
  let THRESHOLD = 0.8;
  let SHOW_ALL = false;
  let ENABLED = true;
  let SKIP_REPLIES = true;
  let SHOW_HUD = true;

  const MAX_INFLIGHT = 3;
  const CACHE_LIMIT = 3000;

  /**
   * 帖子容器。用 article[data-testid="tweet"] 而不是时间线的 cellInnerDiv——
   * 后者只是"时间线单元格"的包装，推荐页/关注页/用户页碰巧都在时间线里所以能用，
   * 但帖子详情页的主帖未必走同一套结构。article 是每一篇帖子的规范容器。
   */
  const POST_SELECTOR = 'article[data-testid="tweet"]';

  // ── 标签外观 ──────────────────────────────────────────────────────────────
  /**
   * 严重度阶梯，越往下越醒目。
   *
   * 低段三种（灰/绿/青绿）是平级的，颜色只为区分种类，不表示谁更严重；
   * 从"说服"往上，颜色才开始同时承担严重度的含义。
   *
   * 把八种颜色排成一条人眼能读出的严格序列是不现实的，超过四五级就分不出高低。
   * **真正承载含义的是文字，颜色是辅助**——色觉不同或截图转灰度时，读到的信息
   * 不该变。这也是为什么橙和红那两档还额外加了字重。
   */
  const LEVELS = {
    calm: { fg: "#555555", bg: "rgba(85,85,85,.09)", weight: 500 },
    playful: { fg: "#15803d", bg: "rgba(21,128,61,.10)", weight: 500 },
    misc: { fg: "#0f766e", bg: "rgba(15,118,110,.10)", weight: 500 },
    notice: { fg: "#1d4ed8", bg: "rgba(29,78,216,.10)", weight: 500 },
    amber: { fg: "#a16207", bg: "rgba(161,98,7,.12)", weight: 500 },
    violet: { fg: "#6d28d9", bg: "rgba(109,40,217,.11)", weight: 500 },
    caution: { fg: "#c2410c", bg: "rgba(194,65,12,.13)", weight: 600 },
    alarm: { fg: "#b91c1c", bg: "rgba(185,28,28,.14)", weight: 600 },
  };

  const INTENT_ZH = {
    inform: "告知",
    persuade: "说服",
    provoke: "挑拨",
    sell: "推销",
    entertain: "娱乐",
    other: "其他",
  };

  const INTENT_LEVEL = {
    inform: "calm",
    entertain: "playful",
    other: "misc",
    persuade: "notice",
    sell: "amber",
    provoke: "alarm",
  };

  // ── 状态 ──────────────────────────────────────────────────────────────────
  /**
   * 缓存结构的版本号。改渲染字段就要 +1。
   *
   * 不加这个的话，改动字段名之后旧缓存会被读出来、渲染成一堆 undefined——而且
   * 因为请求不会被重发，你只会看到空白标签，看不出是缓存的问题。
   */
  const CACHE_VERSION = 3;

  let cache = new Map();
  const inflight = new Set();
  /** 失败过的 id。不重试，否则一条一直失败的帖子会变成死循环。 */
  const failed = new Set();
  let queue = [];
  let active = 0;
  let lastContainerCount = 0;

  const stats = {
    seen: 0,
    asked: 0,
    labeled: 0,
    skipped: 0,
    failed: 0,
    tokens: 0,
    lastError: "",
  };

  // ── 判断 → 标签 ───────────────────────────────────────────────────────────
  /**
   * 意图（每条都有）+ 触发信号（过了阈值的）。
   *
   * 意图本身不设阈值——它总有一个答案，只是需要读一眼。被阈值把关的是三个信号：
   * 它们决定这条帖子是否被标记为"有问题"。这样调阈值时意图标签稳定不动，只有
   * 警示部分在变，前后对比才看得清。
   */
  function compose(a) {
    const t = THRESHOLD;
    const signals = [];

    if (a.rage_bait.noul >= t) {
      signals.push({ zh: "诱导愤怒", p: a.rage_bait.noul, level: "alarm" });
    }
    if (a.undisclosed_ad.noul >= t) {
      signals.push({ zh: "未披露推广", p: a.undisclosed_ad.noul, level: "caution" });
    }
    if (a.synthetic.noul >= t) {
      signals.push({ zh: "机器生成", p: a.synthetic.noul, level: "violet" });
    }

    const key = a.intent.choice;
    // 意图后面跟的"值"是**这个选项自己的概率**，不是 confidence。
    // confidence 度量的是整个分布有多集中——摆在"告知"后面会被读成"它是告知的
    // 概率"，那是误导。
    const intentP =
      typeof a.intent.probabilities?.[key] === "number"
        ? a.intent.probabilities[key]
        : a.intent.confidence;

    return {
      intentZh: INTENT_ZH[key] ?? key,
      intentLevel: INTENT_LEVEL[key] ?? "calm",
      intentP,
      signals,
      probs: {
        诱导愤怒: a.rage_bait.noul,
        未披露推广: a.undisclosed_ad.noul,
        机器生成: a.synthetic.noul,
      },
      tip: tooltip(a),
      at: Date.now(),
    };
  }

  function tooltip(a) {
    const p = (x) => x.toFixed(3);
    const key = a.intent.choice;
    return [
      `意图        ${INTENT_ZH[key] ?? key}  (${key})   置信 ${p(a.intent.confidence)}`,
      `诱导愤怒    ${p(a.rage_bait.noul)}`,
      `未披露推广  ${p(a.undisclosed_ad.noul)}`,
      `机器生成    ${p(a.synthetic.noul)}`,
    ].join("\n");
  }

  // ── 请求（走 background，内容脚本自己 fetch 会被 CORS 挡）──────────────────
  function ask(state) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "jev-ask", state }, (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!res) return reject(new Error("background 没有响应"));
        if (!res.ok) return reject(new Error(res.error));
        resolve(res.data);
      });
    });
  }

  function pump() {
    while (active < MAX_INFLIGHT && queue.length > 0) {
      const job = queue.shift();
      active++;
      ask(job.state)
        .then((r) => {
          stats.asked++;
          stats.tokens += r.usage?.input_tokens ?? 0;
          const verdict = compose(r.answers);
          if (verdict.signals.length > 0) stats.labeled++;
          cache.set(job.id, verdict);
          persistCache();
          paint(job.id);
        })
        .catch((e) => {
          stats.failed++;
          stats.lastError = e.message;
          failed.add(job.id);
          console.warn("[xtags] 请求失败:", e.message);
        })
        .finally(() => {
          active--;
          refreshUi();
          pump();
        });
    }
  }

  let persistTimer = null;
  function persistCache() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (cache.size > CACHE_LIMIT) {
        const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
        for (const [k] of sorted.slice(0, Math.floor(cache.size / 2))) cache.delete(k);
      }
      chrome.storage.local.set({ cache: Object.fromEntries(cache) });
    }, 1500);
  }

  // ── 提取 ──────────────────────────────────────────────────────────────────
  /**
   * 这条是不是回复。
   *
   * 用**文本前缀**匹配"回复 @xxx"那一行，而不是某个 data-testid——因为 action bar
   * 里那个"回复"按钮的 testid 恰好也叫 reply，按 testid 匹配会把每一条帖子都当成
   * 回复，于是所有标签消失且看不出原因。
   *
   * 代价是依赖界面语言，现在覆盖中英两种。
   */
  const REPLY_PREFIX = /^(Replying to|回复|正在回复)/;

  function isReply(el) {
    // 只扫前若干个 div：回复提示在顶部，全量扫描在大时间线上很贵。
    const divs = el.querySelectorAll("div");
    const limit = Math.min(divs.length, 12);
    for (let i = 0; i < limit; i++) {
      const t = (divs[i].textContent || "").trim();
      if (t.length > 0 && t.length < 30 && REPLY_PREFIX.test(t)) return true;
    }
    return false;
  }

  function extract(el) {
    const textEl = el.querySelector('[data-testid="tweetText"]');
    if (!textEl) return null;

    const text = textEl.innerText.trim();
    if (!text) return null;

    const statusLink = el.querySelector('a[href*="/status/"]');
    const id = statusLink?.getAttribute("href")?.match(/status\/(\d+)/)?.[1];
    if (!id) return null;

    let author = null;
    for (const link of el.querySelectorAll('a[href^="/"]')) {
      const href = link.getAttribute("href");
      if (href && /^\/[A-Za-z0-9_]{1,15}$/.test(href)) {
        author = href.slice(1);
        break;
      }
    }

    return { id, text, author };
  }

  // ── 贴标签 ────────────────────────────────────────────────────────────────
  const BADGE_ATTR = "data-xtags-badge";

  function chip(text, level) {
    const s = LEVELS[level] ?? LEVELS.calm;
    const pill = document.createElement("span");
    pill.textContent = text;
    // 没有竖线、没有边框——只有底色和字色，靠色相和字重区分。
    pill.style.cssText =
      `display:inline-flex;align-items:center;padding:1px 7px;border-radius:3px;` +
      `white-space:nowrap;background:${s.bg};color:${s.fg};` +
      `font-weight:${s.weight};letter-spacing:.01em;`;
    return pill;
  }

  /**
   * 主帖的时间戳链接：header 行里第一个指向 /status/ 且内含 <time> 的 <a>。
   * 取"第一个"是有意的——引用转推里也会有 <time>，但它排在主帖之后。
   */
  function findTimeAnchor(el) {
    for (const a of el.querySelectorAll('a[href*="/status/"]')) {
      if (a.querySelector("time")) return a;
    }
    return null;
  }

  function makeBadge(entry) {
    // 放在 header 行里，必须是 inline 的——用 div 会另起一行。
    const wrap = document.createElement("span");
    wrap.setAttribute(BADGE_ATTR, "1");
    wrap.title = entry.tip;
    wrap.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;margin-left:8px;" +
      "vertical-align:baseline;font:500 11px/1.3 " +
      "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    wrap.appendChild(chip(`${entry.intentZh} ${entry.intentP.toFixed(2)}`, entry.intentLevel));
    for (const s of entry.signals) {
      wrap.appendChild(chip(`${s.zh} ${s.p.toFixed(2)}`, s.level));
    }
    if (SHOW_ALL) {
      for (const [name, p] of Object.entries(entry.probs)) {
        wrap.appendChild(chip(`${name} ${p.toFixed(2)}`, "calm"));
      }
    }
    return wrap;
  }

  function paint(id) {
    const entry = cache.get(id);
    if (!entry) return;
    for (const el of document.querySelectorAll(POST_SELECTOR)) {
      const post = extract(el);
      if (!post || post.id !== id) continue;

      const existing = el.querySelector(`[${BADGE_ATTR}]`);
      if (existing) existing.remove();

      const anchor = findTimeAnchor(el);
      if (!anchor || !anchor.parentElement) continue;
      anchor.parentElement.insertBefore(makeBadge(entry), anchor.nextSibling);
    }
  }

  function clearBadges() {
    for (const el of document.querySelectorAll(`[${BADGE_ATTR}]`)) el.remove();
  }

  // ── 主循环 ────────────────────────────────────────────────────────────────
  function scan() {
    if (!ENABLED || !HAS_KEY) return;

    const containers = document.querySelectorAll(POST_SELECTOR);
    lastContainerCount = containers.length;

    for (const el of containers) {
      if (SKIP_REPLIES && isReply(el)) {
        stats.skipped++;
        continue;
      }
      const post = extract(el);
      if (!post) continue;

      if (cache.has(post.id)) {
        // 节点可能被虚拟列表回收后重用，确认标签还在
        if (!el.querySelector(`[${BADGE_ATTR}]`)) paint(post.id);
        continue;
      }
      if (inflight.has(post.id) || failed.has(post.id)) continue;

      inflight.add(post.id);
      stats.seen++;
      queue.push({
        id: post.id,
        state: {
          post: {
            author: post.author ? `@${post.author}` : null,
            text: post.text,
          },
        },
      });
    }

    refreshUi();
    pump();
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  // ── 面板 + 统计上报 ───────────────────────────────────────────────────────
  let hud = null;

  /**
   * 跟随浏览器的明亮 / 黑暗模式。
   *
   * 为什么用 matchMedia 而不是 @media 媒体查询——HUD 的样式是内联设的
   * （style.cssText），而**内联样式的优先级高于任何选择器**，媒体查询里的规则
   * 根本覆盖不到它。只能在 JS 里改。
   *
   * 顺带白拿一个好处：change 事件会实时跟着系统主题切换，不用刷新页面。
   */
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function applyHudTheme() {
    if (!hud) return;
    const dark = darkQuery.matches;
    hud.style.background = dark ? "rgba(17,24,28,.92)" : "rgba(232,237,239,.96)";
    hud.style.color = dark ? "#e6eff0" : "#2b3438";
    // 浅底面板压在白色页面上需要一点边界感；深底不需要。
    hud.style.boxShadow = dark ? "none" : "0 1px 3px rgba(0,0,0,.10)";
  }

  darkQuery.addEventListener("change", applyHudTheme);

  function ensureHud() {
    if (hud && hud.isConnected) return hud;
    hud = document.createElement("div");
    hud.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483000;padding:8px 12px;" +
      "border-radius:6px;" +
      "font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;" +
      "pointer-events:none;letter-spacing:.02em;" +
      // pre-wrap 而不是 pre：保留换行的同时允许折行。用 pre 的话，一条 160 字符的
      // 报错会撑出一个上千像素宽的盒子，把面板挤出视口外。
      "white-space:pre-wrap;overflow-wrap:anywhere;max-width:300px;";
    applyHudTheme(); // 颜色不写在上面的 cssText 里，交给这里——避免两处定义打架
    document.body.appendChild(hud);
    return hud;
  }

  function hudText() {
    if (!ENABLED) return "Xtags  已暂停";
    const cost = (stats.tokens / 1e6) * 0.042;
    let text =
      `Xtags\n` +
      `容器   ${lastContainerCount}\n` +
      `跳过   ${stats.skipped}  ← 回复\n` +
      `看过   ${stats.seen}\n` +
      `判定   ${stats.asked}\n` +
      `标了   ${stats.labeled}  (${stats.asked ? ((stats.labeled / stats.asked) * 100).toFixed(0) : 0}%)\n` +
      `失败   ${stats.failed}\n` +
      `token  ${stats.tokens.toLocaleString("en-US")}  ≈$${cost.toFixed(5)}`;
    if (stats.failed > 0 && stats.lastError) {
      text += `\n\n最后错误：\n${stats.lastError.slice(0, 160)}`;
    }
    return text;
  }

  function refreshUi() {
    if (!SHOW_HUD || !document.body) {
      if (hud) {
        hud.remove();
        hud = null;
      }
    } else {
      if (!hud || !hud.isConnected) ensureHud();
      hud.textContent = hudText();
    }
  }

  // ── 配置变化（popup 里改的）───────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    let needRescan = false;

    if (changes.apiKey) {
      HAS_KEY = !!changes.apiKey.newValue;
      needRescan = true;
    }
    if (changes.showAll) {
      SHOW_ALL = !!changes.showAll.newValue;
      clearBadges();
      needRescan = true;
    }
    if (changes.skipReplies) {
      SKIP_REPLIES = changes.skipReplies.newValue !== false;
      stats.skipped = 0;
      needRescan = true;
    }
    if (changes.enabled) {
      ENABLED = changes.enabled.newValue !== false;
      if (!ENABLED) clearBadges();
      needRescan = true;
    }
    if (changes.showHud) {
      SHOW_HUD = changes.showHud.newValue !== false;
      if (!SHOW_HUD && hud) {
        hud.remove();
        hud = null;
      }
      needRescan = true;
    }
    if (changes.threshold) {
      THRESHOLD = Number(changes.threshold.newValue) || 0.8;
      // 阈值变了，已有判断的标签要重算——但判断本身没变，不用重新请求。
      for (const [id, entry] of cache) cache.set(id, rederive(entry));
      clearBadges();
      needRescan = true;
    }

    // popup 里点了"清空缓存"。内存里那份也要清，否则界面上标签还在。
    if (changes.resetToken) {
      cache.clear();
      inflight.clear();
      failed.clear();
      queue = [];
      stats.seen = stats.asked = stats.labeled = stats.skipped = 0;
      stats.failed = stats.tokens = 0;
      stats.lastError = "";
      clearBadges();
      needRescan = true;
    }

    if (needRescan) {
      refreshUi();
      scan();
    }
  });

  /**
   * 阈值变化时重算标签——判断结果没变，只是"过没过线"变了。
   * 所以这里不重新请求，只重新组合。原始概率都存着，够用。
   */
  function rederive(entry) {
    const signals = [];
    if (entry.probs.诱导愤怒 >= THRESHOLD) {
      signals.push({ zh: "诱导愤怒", p: entry.probs.诱导愤怒, level: "alarm" });
    }
    if (entry.probs.未披露推广 >= THRESHOLD) {
      signals.push({ zh: "未披露推广", p: entry.probs.未披露推广, level: "caution" });
    }
    if (entry.probs.机器生成 >= THRESHOLD) {
      signals.push({ zh: "机器生成", p: entry.probs.机器生成, level: "violet" });
    }
    return { ...entry, signals };
  }

  // ── 启动 ──────────────────────────────────────────────────────────────────
  async function boot() {
    const cfg = await chrome.storage.local.get(DEFAULTS);
    HAS_KEY = !!cfg.apiKey;
    MODEL = cfg.model || "jev-latest";
    THRESHOLD = Number(cfg.threshold) || 0.8;
    SHOW_ALL = !!cfg.showAll;
    ENABLED = cfg.enabled !== false;
    SKIP_REPLIES = cfg.skipReplies !== false;
    SHOW_HUD = cfg.showHud !== false;

    // 缓存版本对不上就整体丢弃——旧结构渲染出来会是一堆 undefined，
    // 而且因为不重发请求，你只会看到空白标签，看不出原因。
    const v = await chrome.storage.local.get(["cacheVersion", "cache"]);
    if (v.cacheVersion !== CACHE_VERSION) {
      await chrome.storage.local.set({ cache: {}, cacheVersion: CACHE_VERSION });
      cache = new Map();
    } else {
      cache = new Map(Object.entries(v.cache ?? {}));
    }

    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
    });

    refreshUi();
    scan();
  }

  boot();
})();
