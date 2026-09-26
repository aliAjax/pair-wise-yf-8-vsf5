const storageKey = "zfl17-film-strip-desk";

const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

const PROJECTORS = ["甲机", "乙机"];
const CLEAN_THRESHOLD_SECONDS = 90 * 60;

const defaultState = {
  reelTitle: "春日试映A卷",
  cleanings: [],
  segments: [
    {
      id: crypto.randomUUID(),
      code: "A-001",
      duration: 18,
      projector: "甲机",
      shift: "正常",
      damage: "完好",
      note: "开场街景，节奏平稳，适合保留原顺序。",
      thumb: ""
    },
    {
      id: crypto.randomUUID(),
      code: "A-006",
      duration: 9,
      projector: "乙机",
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: ""
    },
    {
      id: crypto.randomUUID(),
      code: "A-012",
      duration: 14,
      projector: "甲机",
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，放映前建议重新压平。",
      thumb: ""
    }
  ]
};

let state = loadState();
let draggedId = null;

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  projectorInput: document.querySelector("#projectorInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  segmentList: document.querySelector("#segmentList"),
  warningList: document.querySelector("#warningList"),
  machineStatus: document.querySelector("#machineStatus"),
  cleaningList: document.querySelector("#cleaningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  pendingCleanCount: document.querySelector("#pendingCleanCount"),
  exportBtn: document.querySelector("#exportBtn")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  let loaded;
  if (!saved) {
    loaded = structuredClone(defaultState);
  } else {
    try {
      loaded = { ...structuredClone(defaultState), ...JSON.parse(saved) };
    } catch {
      loaded = structuredClone(defaultState);
    }
  }
  if (!Array.isArray(loaded.cleanings)) loaded.cleanings = [];
  loaded.segments.forEach((item) => {
    if (!PROJECTORS.includes(item.projector)) item.projector = PROJECTORS[0];
  });
  return loaded;
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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

// 按机器分别累计放映时长：甲机、乙机两条队列互不影响。
// 替换片段、改时长或拖动顺序只改变所属机器的队列，另一台的统计原样保留。
// 某台本轮累计达到 90 分钟后，下一段开始前必须登记清洁，否则该段标记为不可开演。
function getProjectorStats() {
  const stats = {};
  for (const name of PROJECTORS) {
    const queue = state.segments.filter((item) => item.projector === name);
    const log = state.cleanings.filter((item) => item.machine === name);
    let cleaningsUsed = 0;
    let runSeconds = 0;
    let blockedId = null;
    for (const item of queue) {
      if (runSeconds >= CLEAN_THRESHOLD_SECONDS) {
        if (cleaningsUsed < log.length) {
          cleaningsUsed += 1;
          runSeconds = 0;
        } else {
          blockedId = item.id;
          break;
        }
      }
      runSeconds += Number(item.duration) || 0;
    }
    stats[name] = {
      queue,
      totalSeconds: queue.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
      runSeconds,
      pendingClean: blockedId !== null,
      blockedId,
      cleaningsUsed
    };
  }
  return stats;
}

function renderStats() {
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const damaged = state.segments.filter((item) => item.damage !== "完好").length;
  const stats = getProjectorStats();
  const pending = PROJECTORS.filter((name) => stats[name].pendingClean).length;
  els.totalDuration.textContent = formatDuration(total);
  els.damageCount.textContent = damaged;
  els.segmentCount.textContent = state.segments.length;
  els.pendingCleanCount.textContent = pending;
}

function renderList() {
  const segments = getFilteredSegments();
  const stats = getProjectorStats();
  const blockedIds = new Set(PROJECTORS.map((name) => stats[name].blockedId).filter(Boolean));
  els.segmentList.innerHTML =
    segments
      .map((item, index) => {
        const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
        const hasDamage = item.damage !== "完好";
        const isBlocked = blockedIds.has(item.id);
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
                <span class="tag projector">${escapeHtml(item.projector)}</span>
                <span class="tag">${escapeHtml(item.shift)}</span>
                <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
                ${isBlocked ? `<span class="tag blocked">开演前需登记清洁</span>` : ""}
              </div>
              <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
            </div>
            <div class="segment-actions">
              <button type="button" title="上移" data-move-up="${item.id}">↑</button>
              <button type="button" title="下移" data-move-down="${item.id}">↓</button>
              <button type="button" title="删除" data-delete="${item.id}">×</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

function renderWarnings() {
  const warnings = state.segments.filter((item) => item.damage !== "完好" || item.shift !== "正常");
  els.warningList.innerHTML =
    warnings
      .map((item) => {
        const index = state.segments.findIndex((segment) => segment.id === item.id) + 1;
        const reasons = [item.shift !== "正常" ? item.shift : "", item.damage !== "完好" ? item.damage : ""].filter(Boolean).join(" · ");
        return `
          <div class="warning-item">
            <strong>${index}. ${escapeHtml(item.code)}</strong>
            <span>${escapeHtml(reasons)}${item.note ? `：${escapeHtml(item.note)}` : ""}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">当前清单没有颜色偏移或破损提醒。</p>`;
}

function renderMachines() {
  const stats = getProjectorStats();
  const now = toLocalInputValue(new Date());
  els.machineStatus.innerHTML = PROJECTORS
    .map((name) => {
      const info = stats[name];
      return `
        <div class="machine-card ${info.pendingClean ? "pending" : ""}">
          <div class="machine-head">
            <strong>${name}</strong>
            <span class="machine-state ${info.pendingClean ? "warn" : ""}">${info.pendingClean ? "待登记清洁" : "可继续放映"}</span>
          </div>
          <p class="machine-meta">累计放映 ${formatDuration(info.totalSeconds)} ｜ 本轮 ${formatDuration(info.runSeconds)} / ${formatDuration(CLEAN_THRESHOLD_SECONDS)} ｜ ${info.queue.length} 段</p>
          ${
            info.pendingClean
              ? `<form class="clean-form" data-clean-form="${name}">
                  <input name="operator" required placeholder="清洁人" />
                  <input name="time" required type="datetime-local" value="${now}" />
                  <button class="primary" type="submit">登记清洁</button>
                </form>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderCleanings() {
  els.cleaningList.innerHTML =
    state.cleanings
      .map(
        (item) => `
          <div class="cleaning-item">
            <strong>${escapeHtml(item.machine)} · ${escapeHtml(item.operator)}</strong>
            <span>${escapeHtml(formatCleaningTime(item.time))}</span>
            <button type="button" title="删除记录" data-delete-cleaning="${item.id}">×</button>
          </div>
        `
      )
      .reverse()
      .join("") || `<p class="empty">还没有清洁记录。</p>`;
}

function renderAll() {
  saveState();
  els.reelTitle.value = state.reelTitle;
  renderStats();
  renderList();
  renderWarnings();
  renderMachines();
  renderCleanings();
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function toLocalInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCleaningTime(value) {
  return String(value || "").replace("T", " ");
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

async function addSegment(event) {
  event.preventDefault();
  const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
  state.segments.push({
    id: crypto.randomUUID(),
    code: els.codeInput.value.trim(),
    duration: Number(els.durationInput.value),
    projector: els.projectorInput.value,
    shift: els.shiftInput.value,
    damage: els.damageInput.value,
    note: els.noteInput.value.trim(),
    thumb
  });
  els.segmentForm.reset();
  els.durationInput.value = 12;
  renderAll();
}

function moveSegment(id, direction) {
  const index = state.segments.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.segments.length) return;
  const [item] = state.segments.splice(index, 1);
  state.segments.splice(target, 0, item);
  renderAll();
}

function exportList() {
  const stats = getProjectorStats();
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `总时长：${formatDuration(state.segments.reduce((sum, item) => sum + Number(item.duration), 0))}`,
    "",
    ...state.segments.map((item, index) => `${index + 1}. ${item.code}｜${item.projector}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}｜${item.note || "无备注"}`),
    "",
    ...PROJECTORS.map((name) => `${name}累计放映：${formatDuration(stats[name].totalSeconds)}（本轮 ${formatDuration(stats[name].runSeconds)} / ${formatDuration(CLEAN_THRESHOLD_SECONDS)}）`),
    "清洁记录：",
    ...(state.cleanings.length
      ? state.cleanings.map((item) => `- ${item.machine}｜${item.operator}｜${formatCleaningTime(item.time)}`)
      : ["- 无"])
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  saveState();
});
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.machineStatus.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-clean-form]");
  if (!form) return;
  event.preventDefault();
  const operator = form.elements.operator.value.trim();
  const time = form.elements.time.value;
  if (!operator || !time) return;
  state.cleanings.push({
    id: crypto.randomUUID(),
    machine: form.dataset.cleanForm,
    operator,
    time
  });
  renderAll();
});

els.cleaningList.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-delete-cleaning]");
  if (!remove) return;
  state.cleanings = state.cleanings.filter((item) => item.id !== remove.dataset.deleteCleaning);
  renderAll();
});

els.segmentList.addEventListener("click", (event) => {
  const up = event.target.closest("[data-move-up]");
  const down = event.target.closest("[data-move-down]");
  const remove = event.target.closest("[data-delete]");
  if (up) moveSegment(up.dataset.moveUp, -1);
  if (down) moveSegment(down.dataset.moveDown, 1);
  if (remove) {
    state.segments = state.segments.filter((item) => item.id !== remove.dataset.delete);
    renderAll();
  }
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

renderAll();
