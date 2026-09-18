const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  apiKey: "",
  threshold: 0.8,
  model: "jev-latest",
  enabled: true,
  skipReplies: true,
  showAll: false,
  showHud: true,
};

const CHECKBOXES = ["enabled", "skipReplies", "showAll", "showHud"];

/** 每个开关的默认值不同（showAll 默认关，其余默认开），所以逐个写清楚。 */
function readCheckbox(id) {
  return $(id).checked;
}

async function load() {
  const c = await chrome.storage.local.get(DEFAULTS);

  $("apiKey").value = c.apiKey || "";
  $("threshold").value = c.threshold ?? 0.8;

  $("enabled").checked = c.enabled !== false;
  $("skipReplies").checked = c.skipReplies !== false;
  $("showAll").checked = !!c.showAll;
  $("showHud").checked = c.showHud !== false;
}

// ── 保存 ────────────────────────────────────────────────────────────────────
$("apiKey").addEventListener("change", () => {
  chrome.storage.local.set({ apiKey: $("apiKey").value.trim() });
});

$("threshold").addEventListener("change", () => {
  const v = Number($("threshold").value);
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    $("threshold").value = 0.8;
    chrome.storage.local.set({ threshold: 0.8 });
    return;
  }
  chrome.storage.local.set({ threshold: v });
});

for (const id of CHECKBOXES) {
  $(id).addEventListener("change", () => {
    chrome.storage.local.set({ [id]: readCheckbox(id) });
  });
}

/**
 * 清空缓存。用 bump 一个 token 而不是直接删 cache 字段——内容脚本的内存里也有
 * 一份缓存，只删存储那份的话它不知道，界面上的标签还在。
 */
$("reset").addEventListener("click", () => {
  chrome.storage.local.set({ cache: {}, resetToken: Date.now() });
  $("reset").textContent = "已清空";
  setTimeout(() => ($("reset").textContent = "清空缓存"), 1200);
});

// ── 关于面板（默认收起）───────────────────────────────────────────────────
// 状态只存在内存里，不开存储——popup 一关就重置，"默认不显示"是默认行为而不是配置。
$("aboutToggle").addEventListener("click", () => {
  const body = $("aboutBody");
  const willOpen = body.hidden;
  body.hidden = !willOpen;
  $("aboutToggle").setAttribute("aria-expanded", String(willOpen));
});

// ── 作者信息 ────────────────────────────────────────────────────────────────
// 从 manifest 读，保持单一来源——改署名只改 manifest.json 一处。
(function renderByline() {
  const m = chrome.runtime.getManifest();

  $("appname").textContent = m.name;
  $("author").textContent = m.author || "未署名";
  $("ver").textContent = "v" + m.version;

  const url = m.homepage_url || "";
  // 还是占位符就不显示链接——免得挂一个指向 example.com 的假链接出去。
  if (url && !/example\.com/.test(url)) {
    const a = $("homepage");
    a.href = url;
    a.textContent = url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    a.hidden = false;
  }
})();

// ── 启动 ────────────────────────────────────────────────────────────────────
load();
