const YEARS = [115, 114, 113, 112, 111, 110];
const CATEGORIES = [
  { name: "一般行政", subjects: ["國文", "公民與英文", "法學大意", "行政學大意"] },
  { name: "財稅行政", subjects: ["國文", "公民與英文", "稅務法規大意", "財政學大意"] },
];
const CATEGORY_KEY = "public-exam:v1:category";
const DEFAULT_CATEGORY = "一般行政";

const app = document.querySelector("#app");
const eyebrow = document.querySelector("#eyebrow");
const state = {
  category: readCategory(),
  subject: null,
  exam: null,
  index: 0,
  picks: {},
  submitted: false,
  confirmSubmit: false,
  confirmReset: false,
  confirmRedraw: false,
  revealed: {},
  marked: {},
  wrongOnly: false,
  openExplanation: null,
};

const explanations = new Map();

function readCategory() {
  try {
    const name = localStorage.getItem(CATEGORY_KEY);
    return CATEGORIES.some((category) => category.name === name) ? name : DEFAULT_CATEGORY;
  } catch {
    return DEFAULT_CATEGORY;
  }
}

function setCategory(name) {
  state.category = name;
  try {
    if (name) localStorage.setItem(CATEGORY_KEY, name);
    else localStorage.removeItem(CATEGORY_KEY);
  } catch {
    // Storage can be blocked; the choice still holds for this visit.
  }
}

function categorySubjects() {
  return CATEGORIES.find((category) => category.name === state.category)?.subjects || [];
}

function qid(question) {
  return question.uid || question.no;
}

function isMultiple(question) {
  return question.type === "multiple";
}

function correctIds(question) {
  if (isMultiple(question)) return question.answer.split("");
  return question.acceptedAnswers || [question.answer];
}

function selectedIds(question) {
  const raw = state.picks[qid(question)] || "";
  return isMultiple(question) ? raw.split("").filter(Boolean) : (raw ? [raw] : []);
}

function questionPoints(question) {
  return question.points ?? state.exam.pointsEach ?? 2;
}

function mistakes(question, pick) {
  const correct = new Set(correctIds(question));
  const chosen = new Set((pick || "").split(""));
  return question.choices.filter((choice) => correct.has(choice.id) !== chosen.has(choice.id)).length;
}

function pointsEarnedTenths(question) {
  const pick = state.picks[qid(question)];
  if (isMultiple(question)) {
    if (!pick) return 0;
    const wrong = mistakes(question, pick);
    if (wrong === 0) return 30;
    if (wrong === 1) return 18;
    if (wrong === 2) return 6;
    return 0;
  }
  return correctIds(question).includes(pick) ? questionPoints(question) * 10 : 0;
}

function pointsEarned(question) {
  return pointsEarnedTenths(question) / 10;
}

function answerVisible(question) {
  return state.submitted || Boolean(state.revealed[qid(question)]);
}

function groupFor(question) {
  return (state.exam.groups || []).find((group) => group.id === question.groupId);
}

function progressKey(subject, year) {
  return `public-exam:v1:${subject}:${year}`;
}

function readProgress(subject, year) {
  try {
    const raw = localStorage.getItem(progressKey(subject, year));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveProgress() {
  if (!state.exam || !state.subject) return;
  const payload = {
    picks: state.picks,
    revealed: state.revealed,
    marked: state.marked,
    index: state.index,
    submitted: state.submitted,
    wrongOnly: state.wrongOnly,
    uids: state.exam.random ? state.exam.questions.map((question) => question.uid) : undefined,
    choiceOrders: state.exam.random ? state.exam.choiceOrders : undefined,
  };
  const hasWork = Boolean(state.exam.random) || state.submitted || state.index > 0
    || Object.keys(state.picks).length
    || Object.keys(state.revealed).length
    || Object.keys(state.marked).length;
  try {
    if (!hasWork) localStorage.removeItem(progressKey(state.subject, state.exam.year));
    else localStorage.setItem(progressKey(state.subject, state.exam.year), JSON.stringify(payload));
  } catch {
    // Private browsing can block storage; the quiz still works for this visit.
  }
}

function restoreProgress() {
  const saved = readProgress(state.subject, state.exam.year);
  if (!saved) return;
  state.picks = saved.picks || {};
  state.revealed = saved.revealed || {};
  state.marked = saved.marked || {};
  state.submitted = Boolean(saved.submitted);
  state.wrongOnly = Boolean(saved.wrongOnly) && state.submitted;
  const index = Number(saved.index) || 0;
  state.index = index >= 0 && index < state.exam.questions.length ? index : 0;
}

function needsReview(question) {
  return pointsEarnedTenths(question) < questionPoints(question) * 10;
}

function visibleIndexes() {
  const questions = state.exam.questions;
  if (!(state.submitted && state.wrongOnly)) return questions.map((_, index) => index);
  return questions.map((question, index) => (needsReview(question) ? index : -1)).filter((index) => index >= 0);
}

function formatScore(tenths) {
  return Number.isInteger(tenths / 10) ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

function scoreExam() {
  const questions = state.exam.questions;
  const tenths = questions.reduce((sum, question) => sum + pointsEarnedTenths(question), 0);
  const maxTenths = questions.reduce((sum, question) => sum + questionPoints(question) * 10, 0);
  const full = questions.filter((question) => pointsEarnedTenths(question) === questionPoints(question) * 10).length;
  const partial = questions.filter((question) => {
    const earned = pointsEarnedTenths(question);
    return earned > 0 && earned < questionPoints(question) * 10;
  }).length;
  return { tenths, maxTenths, full, partial, total: questions.length };
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function preparePool(exams) {
  const byUid = new Map();
  const units = [];
  for (const exam of exams) {
    const buckets = new Map();
    for (const question of exam.questions) {
      const copy = {
        ...question,
        sourceYear: exam.year,
        sourceNo: question.no,
        uid: `${exam.year}-${question.no}`,
      };
      byUid.set(copy.uid, copy);
      if (copy.groupId) {
        const key = `${exam.year}:${copy.groupId}`;
        if (!buckets.has(key)) buckets.set(key, { questions: [], group: null, key });
        buckets.get(key).questions.push(copy);
      } else {
        units.push({ questions: [copy], groups: [] });
      }
    }
    for (const group of exam.groups || []) {
      const key = `${exam.year}:${group.id}`;
      if (buckets.has(key)) buckets.get(key).group = { ...group, id: key };
    }
    for (const bucket of buckets.values()) {
      bucket.questions.sort((a, b) => a.sourceNo - b.sourceNo);
      bucket.questions.forEach((question) => {
        question.groupId = bucket.key;
      });
      units.push({
        questions: bucket.questions,
        groups: bucket.group ? [bucket.group] : [],
      });
    }
  }
  return { byUid, units };
}

function drawSet(pool, target) {
  const questions = [];
  const groups = [];
  let count = 0;
  for (const unit of shuffle(pool.units)) {
    if (count >= target) break;
    questions.push(...unit.questions);
    groups.push(...unit.groups);
    count += unit.questions.length;
  }
  return { questions, groups };
}

function applyChoiceOrder(question, originalIds) {
  const byId = new Map(question.choices.map((choice) => [choice.id, choice]));
  if (originalIds.length !== question.choices.length || originalIds.some((id) => !byId.has(id))) return false;
  const labels = question.choices.map((choice) => choice.id);
  const remap = {};
  originalIds.forEach((oldId, index) => {
    remap[oldId] = labels[index];
  });
  question.choices = originalIds.map((oldId, index) => ({
    ...byId.get(oldId),
    id: labels[index],
  }));
  const mapId = (id) => remap[id] || id;
  if (isMultiple(question)) {
    question.answer = question.answer.split("").map(mapId).sort().join("");
  } else {
    question.answer = mapId(question.answer);
    if (question.acceptedAnswers) {
      question.acceptedAnswers = [...new Set(question.acceptedAnswers.map(mapId))];
    }
  }
  return true;
}

function shuffleChoiceOrder(question) {
  const order = shuffle(question.choices.map((choice) => choice.id));
  applyChoiceOrder(question, order);
  return order;
}

function assignChoiceOrders(questions, saved) {
  const choiceOrders = {};
  const savedOrders = saved?.choiceOrders;
  const hasAnswers = Boolean(saved && (saved.submitted || Object.keys(saved.picks || {}).length));
  const keepOriginal = Boolean(saved?.uids?.length) && !savedOrders && hasAnswers;
  for (const question of questions) {
    const savedOrder = savedOrders?.[question.uid];
    if (savedOrder && applyChoiceOrder(question, savedOrder)) {
      choiceOrders[question.uid] = savedOrder;
    } else if (keepOriginal) {
      choiceOrders[question.uid] = question.choices.map((choice) => choice.id);
    } else {
      choiceOrders[question.uid] = shuffleChoiceOrder(question);
    }
  }
  return choiceOrders;
}

function materialize(pool, uids) {
  const questions = [];
  const groups = [];
  const seen = new Set();
  for (const uid of uids) {
    const question = pool.byUid.get(uid);
    if (!question) continue;
    questions.push(question);
    if (question.groupId && !seen.has(question.groupId)) {
      seen.add(question.groupId);
      const unit = pool.units.find((item) => item.groups[0]?.id === question.groupId);
      if (unit?.groups[0]) groups.push(unit.groups[0]);
    }
  }
  return { questions, groups };
}

async function fetchSubjectExams() {
  const exams = [];
  for (const year of YEARS) {
    const url = `data/${year}/${encodeURIComponent(state.subject)}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`無法讀取 ${year} 年${state.subject}`);
    exams.push(await response.json());
  }
  return exams;
}

async function loadRandom() {
  app.innerHTML = `<p class="status">正在從各年度抽取${state.subject}…</p>`;
  const exams = await fetchSubjectExams();
  const pool = preparePool(exams);
  const saved = readProgress(state.subject, "random");
  const selected = saved?.uids?.length
    ? materialize(pool, saved.uids)
    : drawSet(pool, exams[0].questionCount);
  const choiceOrders = assignChoiceOrders(selected.questions, saved?.uids?.length ? saved : null);
  state.exam = {
    random: true,
    year: "random",
    exam: "隨機抽題",
    subject: state.subject,
    questionCount: selected.questions.length,
    pointsEach: exams[0].pointsEach,
    questions: selected.questions,
    groups: selected.groups,
    choiceOrders,
  };
  state.index = 0;
  state.picks = {};
  state.submitted = false;
  state.confirmSubmit = false;
  state.confirmReset = false;
  state.confirmRedraw = false;
  state.revealed = {};
  state.marked = {};
  state.wrongOnly = false;
  if (saved?.uids?.length) restoreProgress();
  saveProgress();
  renderQuiz();
}

async function loadExam(year) {
  app.innerHTML = `<p class="status">正在讀取 ${year} 年${state.subject}…</p>`;
  const url = `data/${year}/${encodeURIComponent(state.subject)}.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`無法讀取 ${year} 年${state.subject}`);
  state.exam = await response.json();
  state.index = 0;
  state.picks = {};
  state.submitted = false;
  state.confirmSubmit = false;
  state.confirmReset = false;
  state.confirmRedraw = false;
  state.revealed = {};
  state.marked = {};
  state.wrongOnly = false;
  restoreProgress();
  renderQuiz();
}

function goHome() {
  saveProgress();
  state.subject = null;
  state.exam = null;
  state.confirmRedraw = false;
  renderHome();
}

function renderHome() {
  state.exam = null;
  eyebrow.textContent = state.category ? `公務人員初等考試・${state.category}` : "公務人員初等考試";
  if (!state.category) {
    app.innerHTML = `
      <section class="panel">
        <p class="lead">選擇類科。國文與公民與英文為各類科共同科目。</p>
        <div class="year-grid">
          ${CATEGORIES.map((category) => `
            <button class="year-card" type="button" data-category="${category.name}">
              <strong>${category.name}</strong>
              <span>${category.subjects.slice(2).join("、")}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
    app.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        setCategory(button.dataset.category);
        renderHome();
      });
    });
    return;
  }

  if (!state.subject) {
    app.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          <p class="lead">${state.category}。選擇科目。國文含複選題，公民與英文含填空和題組。</p>
          <button class="ghost" type="button" id="change-category">換類科</button>
        </div>
        <div class="year-grid">
          ${categorySubjects().map((subject) => `
            <button class="year-card" type="button" data-subject="${subject}">
              <strong>${subject}</strong>
              <span>110–115 年</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
    document.querySelector("#change-category").addEventListener("click", () => {
      setCategory(null);
      renderHome();
    });
    app.querySelectorAll("[data-subject]").forEach((button) => {
      button.addEventListener("click", () => {
        state.subject = button.dataset.subject;
        renderHome();
      });
    });
    return;
  }

  app.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <p class="lead">${state.subject}。選擇年度後開始作答。</p>
        <button class="ghost" type="button" id="change-subject">換科目</button>
      </div>
      <div class="year-grid">
          <button class="year-card" type="button" id="random-exam">
            <strong>隨機抽題</strong>
            <span>${readProgress(state.subject, "random") ? "繼續未完成的抽題" : "從 110–115 年抽出一份"}</span>
          </button>
          ${YEARS.map((year) => `
          <button class="year-card" type="button" data-year="${year}">
            <strong>${year} 年</strong>
            <span>${readProgress(state.subject, year) ? "繼續未完成的作答" : state.subject}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
  document.querySelector("#change-subject").addEventListener("click", () => {
    state.subject = null;
    renderHome();
  });
  document.querySelector("#random-exam").addEventListener("click", () => {
    loadRandom().catch((error) => {
      app.innerHTML = `<p class="status">${error.message}</p>`;
    });
  });
  app.querySelectorAll("[data-year]").forEach((button) => {
    button.addEventListener("click", () => {
      loadExam(Number(button.dataset.year)).catch((error) => {
        app.innerHTML = `<p class="status">${error.message}</p>`;
      });
    });
  });
}

function renderQuiz() {
  const exam = state.exam;
  const question = exam.questions[state.index];
  const result = state.submitted ? scoreExam() : null;
  const group = groupFor(question);
  const indexes = visibleIndexes();
  const pos = indexes.indexOf(state.index);
  const atStart = pos <= 0;
  const atEnd = pos === -1 || pos >= indexes.length - 1;

  app.innerHTML = `
    ${result ? renderResult(result) : ""}
    <div class="toolbar">
      <p class="meta">${exam.random ? "隨機抽題" : exam.exam}・${exam.subject}・第 ${state.index + 1} / ${exam.questionCount} 題</p>
      ${exam.random ? `<button class="ghost" type="button" id="redraw">重新抽題</button>` : ""}
      <button class="ghost" type="button" id="reset-attempt">重新作答</button>
      <button class="ghost" type="button" id="back-home">回年度選擇</button>
    </div>
    <div class="layout">
      <aside class="grid-card">
        <p>題號${state.submitted ? "（綠為全對，黃為部分給分）" : "（底線為待回顧）"}</p>
        <div class="q-grid">
          ${exam.questions.map((item, index) => {
            if (state.submitted && state.wrongOnly && !needsReview(item)) return "";
            const classes = ["q-dot"];
            if (index === state.index) classes.push("current");
            if (state.marked[qid(item)]) classes.push("flagged");
            if (state.submitted) classes.push(dotClass(item));
            else if (state.picks[qid(item)]) classes.push("answered");
            return `<button class="${classes.join(" ")}" type="button" data-jump="${index}">${index + 1}</button>`;
          }).join("")}
        </div>
      </aside>
      <section class="question-card">
        ${group ? renderPassage(group, question) : ""}
        <p class="q-kicker">${question.sourceYear ? `${question.sourceYear}年・` : ""}第 ${question.sourceNo || question.no} 題${formatLabel(question)}${state.marked[qid(question)] ? "・待回顧" : ""}</p>
        ${isMultiple(question) ? `<p class="hint">複選題，可複選。全對 3 分，錯 1 個選項 1.8 分，錯 2 個 0.6 分。</p>` : ""}
        ${isBlankOnly(question.stem) ? "" : `<h2 class="stem">${renderRich(question.stem)}</h2>`}
        <div class="choices">
          ${question.choices.map((choice) => renderChoice(question, choice)).join("")}
        </div>
        ${answerVisible(question) ? renderReview(question) : ""}
        ${renderExplanation(question)}
        ${state.confirmSubmit ? renderConfirm() : ""}
        ${state.confirmRedraw ? renderRedrawConfirm() : ""}
        <div class="nav-row">
          <button class="nav-btn" type="button" id="prev" ${atStart ? "disabled" : ""}>上一題</button>
          <button class="ghost" type="button" id="mark">${state.marked[qid(question)] ? "取消標記" : "標記待回顧"}</button>
          ${state.submitted ? "" : `<button class="ghost" type="button" id="reveal">${state.revealed[qid(question)] ? "隱藏答案" : "顯示答案"}</button>`}
          ${renderExplanationButton(question)}
          <a class="ghost" id="ask-ai" href="${escapeHtml(askAiUrl(question, group))}" target="_blank" rel="noopener noreferrer">問AI</a>
          ${state.submitted
            ? `<button class="nav-btn" type="button" id="next" ${atEnd ? "disabled" : ""}>下一題</button>`
            : `<button class="primary" type="button" id="submit">交卷</button>
               <button class="nav-btn" type="button" id="next" ${atEnd ? "disabled" : ""}>下一題</button>`}
        </div>
        ${state.confirmReset ? renderResetConfirm() : ""}
      </section>
    </div>
  `;
  ensureExplanation(question);
  bindQuiz();
}

function explanationKey(question) {
  const year = question.sourceYear || state.exam.year;
  const no = question.sourceNo || question.no;
  return `${year}/${state.exam.subject}/${no}`;
}

function explanationPath(question) {
  const [year, subject, no] = explanationKey(question).split("/");
  return `answers/${year}/${encodeURIComponent(subject)}/${no}.md`;
}

function ensureExplanation(question) {
  const key = explanationKey(question);
  if (explanations.has(key)) return;
  explanations.set(key, { status: "loading" });
  fetch(explanationPath(question))
    .then(async (response) => {
      if (!response.ok) {
        explanations.set(key, { status: "no" });
        return;
      }
      explanations.set(key, { status: "yes", text: await response.text() });
      if (state.exam && explanationKey(state.exam.questions[state.index]) === key) renderQuiz();
    })
    .catch(() => {
      explanations.set(key, { status: "no" });
    });
}

function renderExplanationButton(question) {
  const record = explanations.get(explanationKey(question));
  if (!record || record.status !== "yes") return "";
  const open = state.openExplanation === explanationKey(question);
  return `<button class="ghost" type="button" id="explanation">${open ? "隱藏解答" : "解答"}</button>`;
}

function renderExplanation(question) {
  const key = explanationKey(question);
  const record = explanations.get(key);
  if (!record || record.status !== "yes" || state.openExplanation !== key) return "";
  return `<div class="explanation">${escapeHtml(record.text)}</div>`;
}

function formatLabel(question) {
  if (isMultiple(question)) return "・複選";
  if (question.format === "fill-in") return "・填空";
  if (question.format === "cloze") return "・克漏字";
  if (question.format === "reading") return "・題組";
  return "";
}

function isBlankOnly(stem) {
  return /^（\d+）$/.test(stem);
}

function renderPassage(group, question) {
  return `
    <div class="passage">
      <p class="passage-label">${escapeHtml(group.instruction)}</p>
      <p>${renderRich(group.passage, question)}</p>
    </div>
  `;
}

function renderRich(text, question) {
  let html = escapeHtml(text).replaceAll("____", '<span class="blank">____</span>');
  if (question && question.format === "cloze") {
    const marker = escapeHtml(`（${question.no}）`);
    html = html.replaceAll(marker, `<mark>${marker}</mark>`);
  }
  return html;
}

function renderChoice(question, choice) {
  const selected = selectedIds(question).includes(choice.id);
  const classes = ["choice"];
  if (selected) classes.push("selected");
  if (answerVisible(question)) {
    if (correctIds(question).includes(choice.id)) classes.push("mark-right");
    else if (selected) classes.push("mark-wrong");
  }
  return `
    <button class="${classes.join(" ")}" type="button" data-choice="${choice.id}" aria-pressed="${selected}" ${state.submitted ? "disabled" : ""}>
      <span class="choice-id">${choice.id}</span>
      <span>${escapeHtml(choice.text)}</span>
    </button>
  `;
}

function renderConfirm() {
  const unanswered = state.exam.questions.filter((question) => !state.picks[qid(question)]).length;
  const message = unanswered
    ? `還有 ${unanswered} 題未作答。交卷後不能再改答案。`
    : "交卷後不能再改答案。";
  return `
    <div class="review" id="confirm-submit">
      <p>${message}</p>
      <button class="primary" type="button" id="confirm-yes">確定交卷</button>
      <button class="ghost" type="button" id="confirm-no">繼續作答</button>
    </div>
  `;
}

function renderReview(question) {
  const earned = pointsEarnedTenths(question);
  const full = questionPoints(question) * 10;
  const yours = selectedIds(question).join("、") || "未作答";
  const answerText = isMultiple(question)
    ? correctIds(question).join("、")
    : correctIds(question).join(" 或 ");
  let status = "答錯";
  if (!state.picks[qid(question)]) status = "未作答";
  else if (earned === full) status = "答對";
  else if (earned > 0) status = `部分給分 ${formatScore(earned)} 分`;
  return `
    <div class="review">
      <strong>${status}</strong>
      ・你的答案：${yours}
      ・正確答案：${answerText}
      ${question.answerRevised ? "・此題採更正答案" : ""}
    </div>
  `;
}

function renderResult(result) {
  const partial = result.partial ? `，部分給分 ${result.partial} 題` : "";
  const note = state.exam.answerNote ? `<p class="note">答案說明：${escapeHtml(state.exam.answerNote)}</p>` : "";
  const wrongCount = result.total - result.full;
  return `
    <section class="result-card">
      <h2>成績</h2>
      <p class="score">${formatScore(result.tenths)} 分</p>
      <p class="meta">滿分 ${formatScore(result.maxTenths)}。完全答對 ${result.full} / ${result.total} 題${partial}。</p>
      ${note}
      ${wrongCount ? `<button class="ghost" type="button" id="wrong-only">${state.wrongOnly ? "看全部題目" : "只看錯題"}</button>` : ""}
    </section>
  `;
}

function renderRedrawConfirm() {
  return `
    <div class="review" id="confirm-redraw">
      <p>重新從 110–115 年抽一份新題目？目前這份抽題的作答會清除。</p>
      <button class="primary" type="button" id="redraw-yes">確定重抽</button>
      <button class="ghost" type="button" id="redraw-no">取消</button>
    </div>
  `;
}

function renderResetConfirm() {
  return `
    <div class="review" id="confirm-reset">
      <p>清除這份作答與標記？此動作只影響這台電腦上的紀錄。</p>
      <button class="primary" type="button" id="reset-yes">確定清除</button>
      <button class="ghost" type="button" id="reset-no">取消</button>
    </div>
  `;
}

function dotClass(question) {
  const earned = pointsEarnedTenths(question);
  const full = questionPoints(question) * 10;
  if (earned === full) return "right";
  if (earned > 0) return "partial";
  return "wrong";
}

function bindQuiz() {
  document.querySelector("#back-home").addEventListener("click", () => {
    saveProgress();
    renderHome();
  });
  document.querySelector("#prev").addEventListener("click", () => move(-1));
  const next = document.querySelector("#next");
  if (next) next.addEventListener("click", () => move(1));
  const explanation = document.querySelector("#explanation");
  if (explanation) {
    explanation.addEventListener("click", () => {
      const key = explanationKey(state.exam.questions[state.index]);
      state.openExplanation = state.openExplanation === key ? null : key;
      renderQuiz();
    });
  }
  const reveal = document.querySelector("#reveal");
  if (reveal) {
    reveal.addEventListener("click", () => {
      const question = state.exam.questions[state.index];
      state.revealed[qid(question)] = !state.revealed[qid(question)];
      saveProgress();
      renderQuiz();
    });
  }
  document.querySelector("#mark").addEventListener("click", () => {
    const question = state.exam.questions[state.index];
    state.marked[qid(question)] = !state.marked[qid(question)];
    if (!state.marked[qid(question)]) delete state.marked[qid(question)];
    saveProgress();
    renderQuiz();
  });
  const reset = document.querySelector("#reset-attempt");
  if (reset) {
    reset.addEventListener("click", () => {
      state.confirmReset = true;
      renderQuiz();
    });
  }
  const resetYes = document.querySelector("#reset-yes");
  if (resetYes) resetYes.addEventListener("click", resetAttempt);
  const resetNo = document.querySelector("#reset-no");
  if (resetNo) {
    resetNo.addEventListener("click", () => {
      state.confirmReset = false;
      renderQuiz();
    });
  }
  const redraw = document.querySelector("#redraw");
  if (redraw) {
    redraw.addEventListener("click", () => {
      state.confirmRedraw = true;
      renderQuiz();
    });
  }
  const redrawYes = document.querySelector("#redraw-yes");
  if (redrawYes) {
    redrawYes.addEventListener("click", () => {
      try {
        localStorage.removeItem(progressKey(state.subject, "random"));
      } catch {
        // Ignore storage failures.
      }
      loadRandom().catch((error) => {
        app.innerHTML = `<p class="status">${error.message}</p>`;
      });
    });
  }
  const redrawNo = document.querySelector("#redraw-no");
  if (redrawNo) {
    redrawNo.addEventListener("click", () => {
      state.confirmRedraw = false;
      renderQuiz();
    });
  }
  const wrongOnly = document.querySelector("#wrong-only");
  if (wrongOnly) {
    wrongOnly.addEventListener("click", () => {
      state.wrongOnly = !state.wrongOnly;
      const indexes = visibleIndexes();
      if (state.wrongOnly && indexes.length && !indexes.includes(state.index)) state.index = indexes[0];
      saveProgress();
      renderQuiz();
    });
  }
  const submit = document.querySelector("#submit");
  if (submit) {
    submit.addEventListener("click", () => {
      state.confirmSubmit = true;
      renderQuiz();
    });
  }
  const confirmYes = document.querySelector("#confirm-yes");
  if (confirmYes) confirmYes.addEventListener("click", submitExam);
  const confirmNo = document.querySelector("#confirm-no");
  if (confirmNo) {
    confirmNo.addEventListener("click", () => {
      state.confirmSubmit = false;
      renderQuiz();
    });
  }
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      state.index = Number(button.dataset.jump);
      saveProgress();
      renderQuiz();
    });
  });
  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => choose(button.dataset.choice));
  });
}

function choose(id) {
  if (state.submitted) return;
  const question = state.exam.questions[state.index];
  if (isMultiple(question)) {
    const set = new Set(selectedIds(question));
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set].sort().join("");
    if (next) state.picks[qid(question)] = next;
    else delete state.picks[qid(question)];
  } else {
    state.picks[qid(question)] = id;
  }
  saveProgress();
  renderQuiz();
}

function move(step) {
  const indexes = visibleIndexes();
  const pos = indexes.indexOf(state.index);
  const nextPos = (pos === -1 ? (step > 0 ? -1 : indexes.length) : pos) + step;
  if (nextPos < 0 || nextPos >= indexes.length) return;
  state.index = indexes[nextPos];
  saveProgress();
  renderQuiz();
}

function resetAttempt() {
  state.picks = {};
  state.revealed = {};
  state.marked = {};
  state.index = 0;
  state.submitted = false;
  state.confirmSubmit = false;
  state.confirmReset = false;
  state.confirmRedraw = false;
  state.wrongOnly = false;
  if (state.exam.random) {
    saveProgress();
  } else {
    try {
      localStorage.removeItem(progressKey(state.subject, state.exam.year));
    } catch {
      // Ignore storage failures.
    }
  }
  renderQuiz();
}

function submitExam() {
  state.confirmSubmit = false;
  state.submitted = true;
  const firstWrong = state.exam.questions.findIndex((question) => needsReview(question));
  state.index = firstWrong === -1 ? 0 : firstWrong;
  state.wrongOnly = false;
  saveProgress();
  renderQuiz();
}

function askAiUrl(question, group) {
  const lines = [];
  if (question.sourceYear) lines.push(`${question.sourceYear}年${state.exam.subject} 第${question.sourceNo}題`);
  if (group) lines.push(group.instruction, group.passage, "");
  if (question.stem && !isBlankOnly(question.stem)) lines.push(question.stem);
  lines.push(...question.choices.map((choice) => `${choice.id} ${choice.text}`));
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("udm", "50");
  url.searchParams.set("arv", "1");
  url.searchParams.set("q", lines.join("\n"));
  return url.toString();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

renderHome();
document.querySelector("#home-title").addEventListener("click", goHome);
