const YEARS = [115, 114, 113, 112, 111, 110];
const SUBJECTS = ["國文", "公民與英文", "稅務法規大意", "財政學大意"];

const app = document.querySelector("#app");
const state = {
  subject: null,
  exam: null,
  index: 0,
  picks: {},
  submitted: false,
  confirmSubmit: false,
  revealed: {},
};

function isMultiple(question) {
  return question.type === "multiple";
}

function correctIds(question) {
  if (isMultiple(question)) return question.answer.split("");
  return question.acceptedAnswers || [question.answer];
}

function selectedIds(question) {
  const raw = state.picks[question.no] || "";
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
  const pick = state.picks[question.no];
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
  return state.submitted || Boolean(state.revealed[question.no]);
}

function groupFor(question) {
  return (state.exam.groups || []).find((group) => group.id === question.groupId);
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
  state.revealed = {};
  renderQuiz();
}

function goHome() {
  state.subject = null;
  state.exam = null;
  renderHome();
}

function renderHome() {
  state.exam = null;
  if (!state.subject) {
    app.innerHTML = `
      <section class="panel">
        <p class="lead">選擇科目。國文含複選題，公民與英文含填空和題組。</p>
        <div class="year-grid">
          ${SUBJECTS.map((subject) => `
            <button class="year-card" type="button" data-subject="${subject}">
              <strong>${subject}</strong>
              <span>110–115 年</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
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
        ${YEARS.map((year) => `
          <button class="year-card" type="button" data-year="${year}">
            <strong>${year} 年</strong>
            <span>${state.subject}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
  document.querySelector("#change-subject").addEventListener("click", () => {
    state.subject = null;
    renderHome();
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

  app.innerHTML = `
    ${result ? renderResult(result) : ""}
    <div class="toolbar">
      <p class="meta">${exam.exam}・${exam.subject}・第 ${state.index + 1} / ${exam.questionCount} 題</p>
      <button class="ghost" type="button" id="back-home">回年度選擇</button>
    </div>
    <div class="layout">
      <aside class="grid-card">
        <p>題號${state.submitted ? "（綠為全對，黃為部分給分）" : ""}</p>
        <div class="q-grid">
          ${exam.questions.map((item, index) => {
            const classes = ["q-dot"];
            if (index === state.index) classes.push("current");
            if (state.submitted) classes.push(dotClass(item));
            else if (state.picks[item.no]) classes.push("answered");
            return `<button class="${classes.join(" ")}" type="button" data-jump="${index}">${item.no}</button>`;
          }).join("")}
        </div>
      </aside>
      <section class="question-card">
        ${group ? renderPassage(group, question) : ""}
        <p class="q-kicker">第 ${question.no} 題${formatLabel(question)}</p>
        ${isMultiple(question) ? `<p class="hint">複選題，可複選。全對 3 分，錯 1 個選項 1.8 分，錯 2 個 0.6 分。</p>` : ""}
        ${isBlankOnly(question.stem) ? "" : `<h2 class="stem">${renderRich(question.stem)}</h2>`}
        <div class="choices">
          ${question.choices.map((choice) => renderChoice(question, choice)).join("")}
        </div>
        ${answerVisible(question) ? renderReview(question) : ""}
        ${state.confirmSubmit ? renderConfirm() : ""}
        <div class="nav-row">
          <button class="nav-btn" type="button" id="prev" ${state.index === 0 ? "disabled" : ""}>上一題</button>
          ${state.submitted ? "" : `<button class="ghost" type="button" id="reveal">${state.revealed[question.no] ? "隱藏答案" : "顯示答案"}</button>`}
          <a class="ghost" id="ask-ai" href="${escapeHtml(askAiUrl(question, group))}" target="_blank" rel="noopener noreferrer">問AI</a>
          ${state.submitted
            ? `<button class="nav-btn" type="button" id="next" ${state.index === exam.questions.length - 1 ? "disabled" : ""}>下一題</button>`
            : `<button class="primary" type="button" id="submit">交卷</button>
               <button class="nav-btn" type="button" id="next" ${state.index === exam.questions.length - 1 ? "disabled" : ""}>下一題</button>`}
        </div>
      </section>
    </div>
  `;
  bindQuiz();
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
  const unanswered = state.exam.questions.filter((question) => !state.picks[question.no]).length;
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
  if (!state.picks[question.no]) status = "未作答";
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
  return `
    <section class="result-card">
      <h2>成績</h2>
      <p class="score">${formatScore(result.tenths)} 分</p>
      <p class="meta">滿分 ${formatScore(result.maxTenths)}。完全答對 ${result.full} / ${result.total} 題${partial}。</p>
      ${note}
    </section>
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
  document.querySelector("#back-home").addEventListener("click", renderHome);
  document.querySelector("#prev").addEventListener("click", () => move(-1));
  const next = document.querySelector("#next");
  if (next) next.addEventListener("click", () => move(1));
  const reveal = document.querySelector("#reveal");
  if (reveal) {
    reveal.addEventListener("click", () => {
      const question = state.exam.questions[state.index];
      state.revealed[question.no] = !state.revealed[question.no];
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
    if (next) state.picks[question.no] = next;
    else delete state.picks[question.no];
  } else {
    state.picks[question.no] = id;
  }
  renderQuiz();
}

function move(step) {
  const next = state.index + step;
  if (next < 0 || next >= state.exam.questions.length) return;
  state.index = next;
  renderQuiz();
}

function submitExam() {
  state.confirmSubmit = false;
  state.submitted = true;
  const firstWrong = state.exam.questions.findIndex((question) => pointsEarnedTenths(question) < questionPoints(question) * 10);
  state.index = firstWrong === -1 ? 0 : firstWrong;
  renderQuiz();
}

function askAiUrl(question, group) {
  const lines = [];
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
