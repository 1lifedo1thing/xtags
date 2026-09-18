// ==UserScript==
// @name         Xtags
// @namespace    xtags
// @version      0.1.0
// @description  在 X 时间线上给每条帖子标出它想让你干什么。判断来自 Jev，只返回概率、不生成文本。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.typesafe.ai
// @run-at       document-idle
// ==/UserScript==

/*
 * 设计要点
 *
 * 1. 沉默是特性。大部分帖子不该有标签。只有判断超过阈值时才显示——这是这个工具和
 *    "给每条都贴个标签" 的区别所在，也是它值得做的理由。
 *
 * 2. 状态按 status ID 缓存。X 的时间线是虚拟列表，DOM 节点会被回收重用，把结果绑在
 *    节点上必然错位。所有结果以 statusId 为键，节点每次重渲染时按 key 重新贴。
 *
 * 3. 判断和展示分开。这里问的四个问题只负责 "是什么"，怎么组合成标签、什么时候显示
 *    由下面的 compose() 决定——跟 src/triage.ts 里 routeTicket 的分层是同一件事。
 */

(function () {
  "use strict";

  // ── 配置 ──────────────────────────────────────────────────────────────────
  // 最省事的做法：把 key 直接填在下面这行的引号里，保存即可。
  // 留空则走 Tampermonkey 的菜单 / 首次运行弹窗。
  const HARDCODED_KEY = "";

  let API_KEY = HARDCODED_KEY.trim() || GM_getValue("apiKey", "");
  let THRESHOLD = Number(GM_getValue("threshold", 0.8));
  let SHOW_ALL = GM_getValue("showAll", false);
  let ENABLED = GM_getValue("enabled", true);
  let SKIP_REPLIES = GM_getValue("skipReplies", true);
  let MODEL = GM_getValue("model", "jev-latest");

  const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
  const MAX_INFLIGHT = 3;
  const CACHE_LIMIT = 3000;

  /**
   * 帖子容器的选择器。
   *
   * 用 article[data-testid="tweet"] 而不是时间线的 cellInnerDiv——后者只是"时间线
   * 单元格"的包装，推荐页/关注页/用户页都在时间线里所以能用，但帖子详情页的主帖
   * 和用户页的头像区未必走同一套结构。article 是每一篇帖子的规范容器，与页面无关。
   *
   * 代价：不再是"一个单元格 = 一篇帖子"。引用转推如果也渲染成 article，会被当成
   * 独立帖子单独标注。真出现再说，先按最简单的来。
   */
  const POST_SELECTOR = 'article[data-testid="tweet"]';

  // ── 问题定义 ──────────────────────────────────────────────────────────────
  // 全部是 "知识渊博的人一秒能答" 的判断，没有一条需要慢推理。
  // 值得注意：这里没有 "这条帖子好不好" 这种问题——那种问题没有一致答案，
  // 强行问只会得到一个自信的噪声。
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

  // ── 状态 ──────────────────────────────────────────────────────────────────
  /** statusId -> { verdicts, intent, at } */
  /**
   * 缓存结构的版本号。改渲染字段就要把它 +1。
   *
   * 不加这个的话，改动字段名之后旧缓存会被读出来、渲染成一堆 undefined——而且
   * 因为请求不会被重发，你只会看到空白标签，看不出是缓存的问题。（同一个坑在
   * jev 项目的评测缓存里已经踩过一次：缓存必须知道自己的结构是什么时候的。）
   */
  const CACHE_VERSION = 3;

  if (GM_getValue("cacheVersion", 0) !== CACHE_VERSION) {
    GM_setValue("cache", {});
    GM_setValue("cacheVersion", CACHE_VERSION);
  }

  const cache = new Map(Object.entries(GM_getValue("cache", {})));
  const inflight = new Set();
  /** 失败过的 id。不重试，否则一条一直失败的帖子会变成死循环。刷新页面才会清空。 */
  const failed = new Set();
  let queue = [];
  let active = 0;

  const stats = { seen: 0, asked: 0, labeled: 0, skipped: 0, failed: 0, tokens: 0, lastError: "" };

  // ── 判断 → 标签 ───────────────────────────────────────────────────────────
  // ── 标签外观 ──────────────────────────────────────────────────────────────
  /**
   * 严重度阶梯，越往下越醒目。
   *
   * 颜色不是按"类型"随手配的，是排成一条单调的线：灰 → 蓝 → 琥珀 → 紫 → 橙 → 红。
   * 你扫一眼就能按醒目程度排序，而不用先记住哪个色对应哪个词。权重也跟着加粗，
   * 这样即使色觉不同，严重度也还在。
   */
  const LEVELS = {
    // 低段三种是平级的，颜色只为区分种类，不表示谁更严重
    calm: { fg: "#555555", bg: "rgba(85,85,85,.09)", weight: 500 }, // 真中性灰：无彩度，不跟任何色相抢
    playful: { fg: "#15803d", bg: "rgba(21,128,61,.10)", weight: 500 }, // 绿：玩闹
    misc: { fg: "#0f766e", bg: "rgba(15,118,110,.10)", weight: 500 }, // 青绿：归不了类
    // 从这里往上，颜色开始表示严重度
    notice: { fg: "#1d4ed8", bg: "rgba(29,78,216,.10)", weight: 500 }, // 蓝：想改变你
    amber: { fg: "#a16207", bg: "rgba(161,98,7,.12)", weight: 500 }, // 琥珀：商业动机
    violet: { fg: "#6d28d9", bg: "rgba(109,40,217,.11)", weight: 500 }, // 紫：非常规
    caution: { fg: "#c2410c", bg: "rgba(194,65,12,.13)", weight: 600 }, // 橙：未披露
    alarm: { fg: "#b91c1c", bg: "rgba(185,28,28,.14)", weight: 600 }, // 红：操纵
  };

  const INTENT_ZH = {
    inform: "告知",
    persuade: "说服",
    provoke: "挑拨",
    sell: "推销",
    entertain: "娱乐",
    other: "其他",
  };

  /**
   * 意图落在同一条阶梯上——挑拨和告知不该是同一个分量。
   *
   * 告知 / 娱乐 / 其他 三种平级（都是低段），颜色只用来区分种类。从"说服"开始
   * 颜色才同时承担严重度的含义。这是有意的：把八种颜色排成一条人眼能读出的严格
   * 序列是不现实的，超过四五级就分不出高低了。**真正承载含义的是文字，颜色是
   * 辅助**——色觉不同或转成灰度时，读到的信息不该变。
   */
  const INTENT_LEVEL = {
    inform: "calm",
    entertain: "playful",
    other: "misc",
    persuade: "notice",
    sell: "amber",
    provoke: "alarm",
  };

  /**
   * 把四个判断拆成两部分：意图（每条都有）+ 触发信号（过了阈值的）。
   *
   * 意图本身不设阈值——它总有一个答案，只是需要读一眼。真正被阈值把关的是三个
   * 信号：它们决定这条帖子是否被标记为"有问题"。这样调阈值时意图标签稳定不动，
   * 只有警示部分在变，前后对比才看得清。
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
    // confidence 度量的是整个分布有多集中——把它摆在"告知"后面会被读成
    // "它是告知的概率"，那是误导。分布平坦时 confidence 低但选中项的概率可能
    // 仍然是最高的，两者说的不是一回事。
    const intentP =
      typeof a.intent.probabilities?.[key] === "number"
        ? a.intent.probabilities[key]
        : a.intent.confidence;

    return {
      intentZh: INTENT_ZH[key] ?? key,
      intentLevel: INTENT_LEVEL[key] ?? "calm",
      intentP,
      intentConfidence: a.intent.confidence,
      signals,
      probs: {
        诱导愤怒: a.rage_bait.noul,
        未披露推广: a.undisclosed_ad.noul,
        机器生成: a.synthetic.noul,
      },
      tip: tooltip(a),
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

  // ── API ───────────────────────────────────────────────────────────────────
  /**
   * 必须走 GM_xmlhttpRequest，不能用 fetch。
   *
   * 油猴脚本里的 fetch 运行在页面上下文（这里是 x.com 的源），因此受 CORS 约束。
   * TypeSafe 的 API 不会给 x.com 发 Access-Control-Allow-Origin，所以 fetch 必然被
   * 浏览器拦掉，而且报错信息被抹成一句无用的 "Failed to fetch"。
   * GM_xmlhttpRequest 走的是扩展的网络栈，不受 CORS 限制。
   */
  function ask(state) {
    const payload = JSON.stringify({ state, questions: QUESTIONS, model: MODEL });
    const headers = {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: ENDPOINT,
          headers,
          data: payload,
          responseType: "json",
          timeout: 20000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              if (res.response) return resolve(res.response);
              try {
                resolve(JSON.parse(res.responseText));
              } catch (e) {
                reject(new Error(`响应不是 JSON：${e.message}`));
              }
            } else {
              reject(new Error(`${res.status} ${String(res.responseText ?? "").slice(0, 200)}`));
            }
          },
          onerror: () => reject(new Error("GM_xmlhttpRequest 网络错误")),
          ontimeout: () => reject(new Error("请求超时")),
        });
      });
    }

    // 兜底：没有 GM_xmlhttpRequest 时退回 fetch（会被 CORS 挡，但至少能跑）
    return fetch(ENDPOINT, { method: "POST", headers, body: payload }).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.json();
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
          cache.set(job.id, { ...verdict, at: Date.now() });
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
          updateHud();
          pump();
        });
    }
  }

  let persistTimer = null;
  function persistCache() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      // 超上限时丢掉最旧的一半，避免无限膨胀
      if (cache.size > CACHE_LIMIT) {
        const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
        for (const [k] of sorted.slice(0, Math.floor(cache.size / 2))) cache.delete(k);
      }
      GM_setValue("cache", Object.fromEntries(cache));
    }, 1500);
  }

  // ── 提取 ──────────────────────────────────────────────────────────────────
  /**
   * 这条是不是回复。
   *
   * X 把"回复 @xxx"渲染成作者行上方的一个独立小元素。这里用**文本前缀**匹配它，
   * 而不是某个 data-testid——因为 action bar 里那个"回复"按钮的 testid 恰好也叫
   * reply，按 testid 匹配会把每一条帖子都当成回复。
   *
   * 代价是依赖界面语言：现在覆盖中英两种，换别的语言要再加一条前缀。
   * SKIP_REPLIES 是开关，真出问题可以直接关掉。
   */
  const REPLY_PREFIX = /^(Replying to|回复|正在回复)/;

  function isReply(el) {
    // 只扫前若干个 div：回复提示在顶部，全量扫描在大时间线上很贵。
    const divs = el.querySelectorAll("div");
    const limit = Math.min(divs.length, 12);
    for (let i = 0; i < limit; i++) {
      const t = (divs[i].textContent || "").trim();
      // 长度上限是为了排除正文——回复提示很短，正文不会这么短还以此开头。
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

    return { id, text, author, textEl };
  }

  // ── 贴标签 ────────────────────────────────────────────────────────────────
  const BADGE_ATTR = "data-jev-badge";

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
   *
   * 取"第一个"是有意的——引用转推里也会有 <time>，但它排在主帖之后。
   * 头像链接指向 /用户名 而不是 /status/，所以不会误命中。
   */
  function findTimeAnchor(el) {
    for (const a of el.querySelectorAll('a[href*="/status/"]')) {
      if (a.querySelector("time")) return a;
    }
    return null;
  }

  function makeBadge(entry) {
    // 放在 header 行里，必须是 inline 的——不能用 div，否则会另起一行。
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

  // ── 主循环 ────────────────────────────────────────────────────────────────
  let lastContainerCount = 0;

  function scan() {
    if (!ENABLED || !API_KEY) return;
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
        // 已判定过：节点可能是被回收后重用的，确认标签还在
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
    updateHud();
    pump();
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  let hud = null;
  function ensureHud() {
    if (hud) return hud;
    hud = document.createElement("div");
    hud.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483000;padding:8px 12px;" +
      "border-radius:6px;background:rgba(17,24,28,.92);color:#e6eff0;" +
      "font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;" +
      "pointer-events:none;white-space:pre;letter-spacing:.02em;";
    document.body.appendChild(hud);
    return hud;
  }

  function updateHud() {
    if (!ENABLED) {
      ensureHud().textContent = "jev-x  已暂停（菜单里恢复）";
      return;
    }
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
    ensureHud().textContent = text;
  }

  // ── 菜单 ──────────────────────────────────────────────────────────────────
  GM_registerMenuCommand("设置 API key", () => {
    const v = prompt("TypeSafe API key：", API_KEY);
    if (v !== null) {
      API_KEY = v.trim();
      GM_setValue("apiKey", API_KEY);
      scan();
    }
  });

  GM_registerMenuCommand("设置阈值（默认 0.8）", () => {
    const v = prompt("三个信号的触发阈值（意图标签不受影响）：", String(THRESHOLD));
    if (v !== null && !Number.isNaN(Number(v))) {
      THRESHOLD = Number(v);
      GM_setValue("threshold", THRESHOLD);
      cache.clear();
      GM_setValue("cache", {});
      for (const el of document.querySelectorAll(`[${BADGE_ATTR}]`)) el.remove();
      scan();
    }
  });

  GM_registerMenuCommand("切换：显示全部数值（三个信号的概率）", () => {
    SHOW_ALL = !SHOW_ALL;
    GM_setValue("showAll", SHOW_ALL);
    for (const el of document.querySelectorAll(`[${BADGE_ATTR}]`)) el.remove();
    scan();
  });

  GM_registerMenuCommand("切换：跳过回复（当前：" + (SKIP_REPLIES ? "跳过" : "不跳过") + "）", () => {
    SKIP_REPLIES = !SKIP_REPLIES;
    GM_setValue("skipReplies", SKIP_REPLIES);
    stats.skipped = 0;
    scan();
  });

  GM_registerMenuCommand("暂停 / 恢复", () => {
    ENABLED = !ENABLED;
    GM_setValue("enabled", ENABLED);
    updateHud();
    if (ENABLED) scan();
  });

  GM_registerMenuCommand("清空缓存", () => {
    cache.clear();
    GM_setValue("cache", {});
    stats.asked = stats.labeled = stats.failed = stats.tokens = 0;
    updateHud();
    scan();
  });

  // ── 启动 ──────────────────────────────────────────────────────────────────
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
  });

  updateHud();

  if (!API_KEY) {
    // 不依赖菜单：首次运行直接在页面上问一次。菜单在某些 Chrome 版本里行为不一致，
    // 但 prompt 在这里是在页面上下文执行的，一定出得来。
    if (!GM_getValue("keyPrompted", false)) {
      GM_setValue("keyPrompted", true);
      const v = prompt("Xtags：填 TypeSafe API key（留空则改脚本顶部的 HARDCODED_KEY）");
      if (v && v.trim()) {
        API_KEY = v.trim();
        GM_setValue("apiKey", API_KEY);
      }
    }
    if (!API_KEY) {
      ensureHud().textContent =
        "jev-x  未配置\n把 key 填进脚本顶部的\nHARDCODED_KEY，保存即可";
      console.warn(
        "[xtags] 没有 API key。两个办法：\n" +
          "  1. 改脚本顶部的 HARDCODED_KEY（推荐，改完保存立刻生效）\n" +
          "  2. 油猴菜单 → 设置 API key",
      );
      return;
    }
  }

  scan();
})();
