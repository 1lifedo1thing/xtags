/*
 * Service worker：唯一负责发请求的地方。
 *
 * 为什么请求必须在这里发，而不是在 content script 里——
 *
 * MV3 的内容脚本虽然跑在隔离世界，但网络请求仍然用**页面的源**，因此受 CORS 约束。
 * TypeSafe 的 API 不会给 x.com 发 Access-Control-Allow-Origin，所以内容脚本里直接
 * fetch 必然被拦，而且报错被抹成一句没用的 "Failed to fetch"。
 *
 * service worker 不同：扩展有 host_permissions，它的请求不受 CORS 限制。
 * 这是 MV3 里唯一正确的跨域做法。
 *
 * 油猴版本的 GM_xmlhttpRequest 解决的正是同一个问题——只是那边由油猴代劳了。
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

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

// ── 图标状态灯 ──────────────────────────────────────────────────────────────
/**
 * 工具栏图标上的小点：启用时红，暂停时黄。
 *
 * MV3 的 service worker 会随时休眠，所以三处都要挂：开机、安装、以及存储变化
 * （storage.onChanged 会把休眠的 worker 唤醒）。只挂一处的话，暂停之后图标不会变。
 */
const ICONS = {
  on: { 16: "icons/on/icon16.png", 32: "icons/on/icon32.png", 48: "icons/on/icon48.png", 128: "icons/on/icon128.png" },
  off: { 16: "icons/off/icon16.png", 32: "icons/off/icon32.png", 48: "icons/off/icon48.png", 128: "icons/off/icon128.png" },
};

async function syncIcon() {
  try {
    const { enabled = true } = await chrome.storage.local.get({ enabled: true });
    await chrome.action.setIcon({ path: enabled ? ICONS.on : ICONS.off });
  } catch (e) {
    console.warn("[xtags] 图标切换失败:", e && e.message);
  }
}

chrome.runtime.onInstalled.addListener(syncIcon);
chrome.runtime.onStartup.addListener(syncIcon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) syncIcon();
});
syncIcon();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "jev-ask") return;

  (async () => {
    try {
      const { apiKey = "", model = "jev-latest" } = await chrome.storage.local.get([
        "apiKey",
        "model",
      ]);

      if (!apiKey) throw new Error("还没有配置 API key");

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          state: msg.state,
          questions: QUESTIONS,
          model: model || "jev-latest",
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${body.slice(0, 200)}`);
      }

      sendResponse({ ok: true, data: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();

  // 必须返回 true，否则消息通道会在异步完成前关掉，sendResponse 变成空操作。
  return true;
});
