/* ============================================================
 * 胶片分镜条核对台
 *
 * 三块数据分开维护，互不干扰：
 *   1. 清单保存  STORAGE_KEY_LIST       胶片卷与片段
 *   2. 清洁记录  STORAGE_KEY_CLEANING   片门清洁登记
 *   3. 页面操作  STORAGE_KEY_UI         筛选、搜索、默认机位
 * ========================================================== */

const STORAGE_KEY_LIST = "zfl17-film-strip-desk";
const STORAGE_KEY_CLEANING = "zfl17-film-strip-desk-cleanings";
const STORAGE_KEY_UI = "zfl17-film-strip-desk-ui";

const MACHINES = [
  { id: "A", name: "甲机" },
  { id: "B", name: "乙机" }
];
const MACHINE_NAMES = { A: "甲机", B: "乙机" };

// 片门累计放映达到 90 分钟后，下一段开始前必须登记清洁人和清洁时间
const CLEAN_THRESHOLD_SECONDS = 90 * 60;

const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

const defaultState = {
  reelTitle: "春日试映A卷",
  segments: [
    {
      id: crypto.randomUUID(),
      code: "A-001",
      duration: 18,
      machine: "A",
      shift: "正常",
      damage: "完好",
      note: "开场街景，节奏平稳，适合保留原顺序。",
      thumb: ""
    },
    {
      id: crypto.randomUUID(),
      code: "A-006",
      duration: 9,
      machine: "B",
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: ""
    },
    {
      id: crypto.randomUUID(),
      code: "A-012",
      duration: 14,
      machine: "A",
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，放映前建议重新压平。",
      thumb: ""
    }
  ]
};

let state = loadListState();
let cleanings = loadCleanings();
let uiState = loadUiState();
let draggedId = null;
let editingId = null;

// 每台机器各自缓存计算结果；签名不变的机器不重算，继续按原状态放映
const machineCache = {};

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  machineInput: document.querySelector("#machineInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  submitBtn: document.querySelector("#submitBtn"),
  cancelEditBtn: document.querySelector("#cancelEditBtn"),
  segmentList: document.querySelector("#segmentList"),
  machineStrip: document.querySelector("#machineStrip"),
  warningList: document.querySelector("#warningList"),
  cleaningForm: document.querySelector("#cleaningForm"),
  cleanMachineInput: document.querySelector("#cleanMachineInput"),
  cleanPersonInput: document.querySelector("#cleanPersonInput"),
  cleanTimeInput: document.querySelector("#cleanTimeInput"),
  cleaningAlerts: document.querySelector("#cleaningAlerts"),
  cleaningList: document.querySelector("#cleaningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  exportBtn: document.querySelector("#exportBtn")
};

/* ---------------- 清单保存 ---------------- */

function loadListState() {
  const saved = localStorage.getItem(STORAGE_KEY_LIST);
  if (!saved) return structuredClone(defaultState);
  try {
    const merged = { ...structuredClone(defaultState), ...JSON.parse(saved) };
    // 旧清单没有机位字段，统一补成甲机
    merged.segments = merged.segments.map((item) => ({ machine: "A", ...item }));
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveListState() {
  localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(state));
}

/* ---------------- 清洁记录 ---------------- */

function loadCleanings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_CLEANING) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveCleanings() {
  localStorage.setItem(STORAGE_KEY_CLEANING, JSON.stringify(cleanings));
}

function addCleaning(record) {
  cleanings.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...record });
  saveCleanings();
}

function removeCleaning(id) {
  cleanings = cleanings.filter((item) => item.id !== id);
  saveCleanings();
  renderAll();
}

/* ---------------- 页面操作状态 ---------------- */

function loadUiState() {
  const fallback = { colorFilter: "all", search: "", machine: "A" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY_UI) || "{}") };
  } catch {
    return fallback;
  }
}

function saveUiState() {
  localStorage.setItem(STORAGE_KEY_UI, JSON.stringify(uiState));
}

function applyUiState() {
  els.colorFilter.value = uiState.colorFilter;
  els.searchInput.value = uiState.search;
  els.machineInput.value = uiState.machine;
}

/* ---------------- 机位累计与清洁计算 ----------------
 * 只重算受影响的机器：签名（该机片段顺序与时长 + 清洁记录）不变的
 * 机器直接沿用缓存结果；替换片段、改时长或拖动顺序只影响本机，
 * 另一台继续放映，不重算。
 * ------------------------------------------------ */

function machineSignature(machineId) {
  const segmentPart = state.segments
    .filter((item) => item.machine === machineId)
    .map((item) => `${item.id}:${item.duration}`)
    .join("|");
  const cleaningPart = cleanings
    .filter((item) => item.machine === machineId)
    .map((item) => item.id)
    .sort()
    .join("|");
  return `${segmentPart}#${cleaningPart}`;
}

function computeMachine(machineId) {
  const segments = state.segments.filter((item) => item.machine === machineId);
  const queue = cleanings
    .filter((item) => item.machine === machineId)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);
  const statuses = {};
  const usedCleaningIds = [];
  let acc = 0;
  let blocked = false;
  let blockedSeq = null;

  segments.forEach((segment, index) => {
    const seq = index + 1;
    let cleaningBefore = null;
    if (!blocked && acc >= CLEAN_THRESHOLD_SECONDS) {
      // 片门累计已到 90 分钟：有登记清洁才允许开始下一段，否则卡住
      const cleaning = queue.shift();
      if (cleaning) {
        cleaningBefore = cleaning;
        usedCleaningIds.push(cleaning.id);
        acc = 0;
      } else {
        blocked = true;
        blockedSeq = seq;
      }
    }
    if (blocked) {
      statuses[segment.id] = { seq, accBefore: null, cleaningBefore: null, blocked: seq === blockedSeq, waiting: seq !== blockedSeq };
      return;
    }
    const accBefore = acc;
    acc += Number(segment.duration) || 0;
    statuses[segment.id] = { seq, accBefore, cleaningBefore, blocked: false, waiting: false };
  });

  return {
    total: segments.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
    runSinceClean: acc,
    blocked,
    blockedSeq,
    usedCleaningIds,
    statuses,
    computedAt: Date.now()
  };
}

function getMachineResult(machineId) {
  const signature = machineSignature(machineId);
  const cached = machineCache[machineId];
  if (cached && cached.signature === signature) return cached.result;
  const result = computeMachine(machineId);
  machineCache[machineId] = { signature, result };
  return result;
}

/* ---------------- 渲染 ---------------- */

function renderStats() {
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const damaged = state.segments.filter((item) => item.damage !== "完好").length;
  els.totalDuration.textContent = formatDuration(total);
  els.damageCount.textContent = damaged;
  els.segmentCount.textContent = state.segments.length;
}

function renderMachines() {
  els.machineStrip.innerHTML = MACHINES.map((machine) => {
    const result = getMachineResult(machine.id);
    const percent = Math.min(100, Math.round((result.runSinceClean / CLEAN_THRESHOLD_SECONDS) * 100));
    return `
      <article class="machine-card ${result.blocked ? "blocked" : ""}">
        <div class="machine-head">
          <strong>${machine.name}</strong>
          <span class="machine-status">${result.blocked ? `第${result.blockedSeq}段前需登记清洁` : "正常放映"}</span>
        </div>
        <div class="machine-bar"><span style="width:${percent}%"></span></div>
        <div class="machine-meta">
          <span>本轮累计 ${formatDuration(result.runSinceClean)} / ${formatDuration(CLEAN_THRESHOLD_SECONDS)}</span>
          <span>排片总时长 ${formatDuration(result.total)}</span>
        </div>
        <div class="machine-foot">
          <span>状态更新于 ${formatClock(result.computedAt)}</span>
          <button type="button" data-register-cleaning="${machine.id}">登记清洁</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderStatusTag(status) {
  if (!status) return "";
  if (status.blocked) return `<span class="tag blocked">待清洁·不能开始</span>`;
  if (status.waiting) return `<span class="tag waiting">顺延等待</span>`;
  if (status.cleaningBefore) return `<span class="tag cleaned">清洁后放映</span>`;
  return "";
}

function renderSegmentMeta(item, status) {
  if (!status) return MACHINE_NAMES[item.machine];
  const parts = [`${MACHINE_NAMES[item.machine]}第${status.seq}段`];
  if (status.cleaningBefore) {
    parts.push(`本段前已清洁：${escapeHtml(status.cleaningBefore.person)} ${formatCleaningTime(status.cleaningBefore.time)}`);
  }
  if (status.blocked) {
    parts.push("片门累计已满90分钟，未登记清洁不能开始");
  } else if (status.waiting) {
    parts.push("排在前段之后，等待清洁登记");
  } else {
    parts.push(`开映时本轮累计 ${formatDuration(status.accBefore)}`);
  }
  return parts.join(" · ");
}

function renderList() {
  const segments = getFilteredSegments();
  els.segmentList.innerHTML =
    segments
      .map((item) => {
        const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
        const hasDamage = item.damage !== "完好";
        const status = getMachineResult(item.machine).statuses[item.id];
        const otherMachine = item.machine === "A" ? "B" : "A";
        return `
          <article class="segment-card" draggable="true" data-id="${item.id}">
            <div class="thumb">
              ${
                item.thumb
                  ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
                  : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
              }
            </div>
            <div class="segment-main">
              <div class="segment-title">
                <strong>${realIndex + 1}. ${escapeHtml(item.code)}</strong>
                <span>${formatDuration(item.duration)}</span>
              </div>
              <div class="tag-row">
                <span class="tag machine-${item.machine.toLowerCase()}">${MACHINE_NAMES[item.machine]}</span>
                ${renderStatusTag(status)}
                <span class="tag">${escapeHtml(item.shift)}</span>
                <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
              </div>
              <p class="segment-meta">${renderSegmentMeta(item, status)}</p>
              <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
            </div>
            <div class="segment-actions">
              <button type="button" title="上移" data-move-up="${item.id}">↑</button>
              <button type="button" title="下移" data-move-down="${item.id}">↓</button>
              <button type="button" class="text-btn" title="修改（替换片段、改时长）" data-edit="${item.id}">改</button>
              <button type="button" class="text-btn" title="换到${MACHINE_NAMES[otherMachine]}" data-switch-machine="${item.id}">转${MACHINE_NAMES[otherMachine].slice(0, 1)}</button>
              <button type="button" title="删除" data-delete="${item.id}">×</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

function renderWarnings() {
  const cleaningWarnings = MACHINES.flatMap((machine) => {
    const result = getMachineResult(machine.id);
    if (!result.blocked) return [];
    const segment = state.segments.filter((item) => item.machine === machine.id)[result.blockedSeq - 1];
    return [
      `<div class="warning-item cleaning">
        <strong>${machine.name}片门待清洁</strong>
        <span>第${result.blockedSeq}段${segment ? ` ${escapeHtml(segment.code)}` : ""}开始前要登记清洁人和清洁时间，没登记就不能开始。</span>
      </div>`
    ];
  });
  const damageWarnings = state.segments
    .filter((item) => item.damage !== "完好" || item.shift !== "正常")
    .map((item) => {
      const index = state.segments.findIndex((segment) => segment.id === item.id) + 1;
      const reasons = [item.shift !== "正常" ? item.shift : "", item.damage !== "完好" ? item.damage : ""].filter(Boolean).join(" · ");
      return `
        <div class="warning-item">
          <strong>${index}. ${escapeHtml(item.code)}</strong>
          <span>${escapeHtml(reasons)}${item.note ? `：${escapeHtml(item.note)}` : ""}</span>
        </div>
      `;
    });
  els.warningList.innerHTML =
    [...cleaningWarnings, ...damageWarnings].join("") ||
    `<p class="empty">当前清单没有片门清洁、颜色偏移或破损提醒。</p>`;
}

function renderCleaningPanel() {
  const pending = MACHINES.map((machine) => ({ machine, result: getMachineResult(machine.id) })).filter(
    ({ result }) => result.blocked
  );
  els.cleaningAlerts.innerHTML = pending.length
    ? pending
        .map(
          ({ machine, result }) =>
            `<div class="cleaning-alert">${machine.name}第${result.blockedSeq}段开始前必须登记清洁，登记后该段及后续片段才能开始。</div>`
        )
        .join("")
    : `<p class="empty">当前没有待登记的片门清洁。</p>`;

  const sorted = cleanings.slice().sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);
  els.cleaningList.innerHTML =
    sorted
      .map((item) => {
        const used = getMachineResult(item.machine).usedCleaningIds.includes(item.id);
        return `
          <div class="cleaning-item">
            <div class="who">
              <strong>${MACHINE_NAMES[item.machine]} · ${escapeHtml(item.person)}</strong>
              <small>${formatCleaningTime(item.time)} · ${used ? "已生效" : "待使用"}</small>
            </div>
            <button type="button" title="删除记录" data-delete-cleaning="${item.id}">×</button>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有清洁记录。</p>`;
}

function renderAll() {
  saveListState();
  els.reelTitle.value = state.reelTitle;
  renderStats();
  renderMachines();
  renderList();
  renderWarnings();
  renderCleaningPanel();
}

function getFilteredSegments() {
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  return state.segments.filter((item) => {
    const matchesColor = color === "all" || item.shift === color;
    const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
    return matchesColor && matchesKeyword;
  });
}

/* ---------------- 工具 ---------------- */

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatClock(timestamp) {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatCleaningTime(value) {
  return String(value || "").replace("T", " ");
}

function setDefaultCleaningTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  els.cleanTimeInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------- 片段操作 ---------------- */

async function submitSegment(event) {
  event.preventDefault();
  const file = els.thumbInput.files[0];
  if (editingId) {
    // 替换片段 / 改时长：原位更新，保持顺序与 id 不变
    const segment = state.segments.find((item) => item.id === editingId);
    if (segment) {
      const thumb = file ? await readFileAsDataUrl(file) : segment.thumb;
      Object.assign(segment, {
        code: els.codeInput.value.trim(),
        duration: Number(els.durationInput.value),
        machine: els.machineInput.value,
        shift: els.shiftInput.value,
        damage: els.damageInput.value,
        note: els.noteInput.value.trim(),
        thumb
      });
    }
    cancelEdit();
  } else {
    const thumb = await readFileAsDataUrl(file);
    state.segments.push({
      id: crypto.randomUUID(),
      code: els.codeInput.value.trim(),
      duration: Number(els.durationInput.value),
      machine: els.machineInput.value,
      shift: els.shiftInput.value,
      damage: els.damageInput.value,
      note: els.noteInput.value.trim(),
      thumb
    });
    els.segmentForm.reset();
    els.durationInput.value = 12;
    els.machineInput.value = uiState.machine;
  }
  renderAll();
}

function startEdit(id) {
  const segment = state.segments.find((item) => item.id === id);
  if (!segment) return;
  editingId = id;
  els.codeInput.value = segment.code;
  els.durationInput.value = segment.duration;
  els.machineInput.value = segment.machine;
  els.shiftInput.value = segment.shift;
  els.damageInput.value = segment.damage;
  els.noteInput.value = segment.note;
  els.thumbInput.value = "";
  els.submitBtn.textContent = "保存修改";
  els.cancelEditBtn.hidden = false;
  els.codeInput.focus();
}

function cancelEdit() {
  editingId = null;
  els.segmentForm.reset();
  els.durationInput.value = 12;
  els.machineInput.value = uiState.machine;
  els.submitBtn.textContent = "加入放映清单";
  els.cancelEditBtn.hidden = true;
}

function moveSegment(id, direction) {
  const index = state.segments.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.segments.length) return;
  const [item] = state.segments.splice(index, 1);
  state.segments.splice(target, 0, item);
  renderAll();
}

function switchMachine(id) {
  const segment = state.segments.find((item) => item.id === id);
  if (!segment) return;
  segment.machine = segment.machine === "A" ? "B" : "A";
  renderAll();
}

function deleteSegment(id) {
  state.segments = state.segments.filter((item) => item.id !== id);
  if (editingId === id) cancelEdit();
  renderAll();
}

/* ---------------- 清洁登记 ---------------- */

function submitCleaning(event) {
  event.preventDefault();
  addCleaning({
    machine: els.cleanMachineInput.value,
    person: els.cleanPersonInput.value.trim(),
    time: els.cleanTimeInput.value
  });
  els.cleaningForm.reset();
  setDefaultCleaningTime();
  renderAll();
}

/* ---------------- 导出 ---------------- */

function exportList() {
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const machineLines = MACHINES.map((machine) => {
    const result = getMachineResult(machine.id);
    const status = result.blocked ? `第${result.blockedSeq}段前需登记清洁` : "正常放映";
    return `${machine.name}：排片 ${formatDuration(result.total)}｜本轮累计 ${formatDuration(result.runSinceClean)}｜${status}`;
  });
  const cleaningLines = cleanings.length
    ? cleanings
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt)
        .map((item) => `- ${MACHINE_NAMES[item.machine]}｜${item.person}｜${formatCleaningTime(item.time)}`)
    : ["暂无清洁记录"];
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `总时长：${formatDuration(total)}`,
    ...machineLines,
    "",
    ...state.segments.map(
      (item, index) =>
        `${index + 1}. ${item.code}｜${MACHINE_NAMES[item.machine]}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}｜${item.note || "无备注"}`
    ),
    "",
    "片门清洁记录：",
    ...cleaningLines
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------------- 页面操作（事件绑定） ---------------- */

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  saveListState();
});
els.colorFilter.addEventListener("change", () => {
  uiState.colorFilter = els.colorFilter.value;
  saveUiState();
  renderList();
});
els.searchInput.addEventListener("input", () => {
  uiState.search = els.searchInput.value;
  saveUiState();
  renderList();
});
els.machineInput.addEventListener("change", () => {
  uiState.machine = els.machineInput.value;
  saveUiState();
});
els.segmentForm.addEventListener("submit", submitSegment);
els.cancelEditBtn.addEventListener("click", cancelEdit);
els.exportBtn.addEventListener("click", exportList);
els.cleaningForm.addEventListener("submit", submitCleaning);

els.machineStrip.addEventListener("click", (event) => {
  const button = event.target.closest("[data-register-cleaning]");
  if (!button) return;
  els.cleanMachineInput.value = button.dataset.registerCleaning;
  els.cleaningForm.scrollIntoView({ behavior: "smooth", block: "center" });
  els.cleanPersonInput.focus();
});

els.segmentList.addEventListener("click", (event) => {
  const up = event.target.closest("[data-move-up]");
  const down = event.target.closest("[data-move-down]");
  const edit = event.target.closest("[data-edit]");
  const switchBtn = event.target.closest("[data-switch-machine]");
  const remove = event.target.closest("[data-delete]");
  if (up) moveSegment(up.dataset.moveUp, -1);
  if (down) moveSegment(down.dataset.moveDown, 1);
  if (edit) startEdit(edit.dataset.edit);
  if (switchBtn) switchMachine(switchBtn.dataset.switchMachine);
  if (remove) deleteSegment(remove.dataset.delete);
});

els.cleaningList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-cleaning]");
  if (button) removeCleaning(button.dataset.deleteCleaning);
});

els.segmentList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  draggedId = card.dataset.id;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

els.segmentList.addEventListener("dragend", (event) => {
  event.target.closest("[data-id]")?.classList.remove("dragging");
  draggedId = null;
});

els.segmentList.addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card || !draggedId || card.dataset.id === draggedId) return;
  event.preventDefault();
  const fromIndex = state.segments.findIndex((item) => item.id === draggedId);
  const toIndex = state.segments.findIndex((item) => item.id === card.dataset.id);
  if (fromIndex < 0 || toIndex < 0) return;
  const [item] = state.segments.splice(fromIndex, 1);
  state.segments.splice(toIndex, 0, item);
  renderAll();
});

/* ---------------- 初始化 ---------------- */

applyUiState();
setDefaultCleaningTime();
renderAll();
