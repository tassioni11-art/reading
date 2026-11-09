// book-class 애플리케이션 v3
// 1단계 떠오른 낱말로 채우기, 2단계 RAFT 글쓰기, 3단계 친구 글 읽기(소감) + 교사 대시보드
(function () {
  "use strict";

  /* =========================================================
     1. 설정
     ========================================================= */
  // 시트 주소는 config.js에 적습니다. (예전처럼 아래에 직접 적어도 됩니다)
  const SHEET_API_URL = String((window.BOOK_CLASS_CONFIG && window.BOOK_CLASS_CONFIG.sheetUrl) || "").trim();
  const POLL_INTERVAL = 15000; // 교사 15초, 학생 30초마다 시트 확인

  const WORDS_TITLE = "떠오른 낱말로 채우기";
  const RAFT_TITLE = "RAFT 글쓰기";
  const FRIENDS_TITLE = "친구 글 읽기";
  const INPUT_GUIDE = "한 단어씩 입력하고 엔터를 치세요.";
  const MAX_WORD_LENGTH = 20;
  const MAX_RAFT_FIELD = 30;
  const MAX_TEXT = 2000;
  const MIN_TEXT = 30;
  const MAX_COMMENT = 200;

  const RAFT_FIELDS = [
    { key: "role", letter: "R", ko: "역할", en: "Role", q: "누구의 목소리로 쓸까요?", ph: "예: 주인공 로봇, 10년 뒤의 나" },
    { key: "audience", letter: "A", ko: "청중", en: "Audience", q: "누구에게 쓸까요?", ph: "예: 로봇을 만든 과학자" },
    { key: "format", letter: "F", ko: "형식", en: "Format", q: "어떤 형식의 글인가요?", ph: "예: 편지", picks: ["편지", "일기", "인터뷰", "연설문", "광고", "시", "기사"] },
    { key: "topic", letter: "T", ko: "주제", en: "Topic", q: "무엇에 대해 쓸까요?", ph: "예: 감정을 갖고 싶은 이유" }
  ];

  // 시트를 쓰지 않을 때(연습 모드) 쓰는 기본 책
  const DEFAULT_CLASSES = [{ cls: "전체", title: "내일의 로봇 친구", topic: "인공지능과 함께 살아갈 우리의 미래" }];

  const STORAGE_KEY = "book-class:v3";
  const ME_KEY = "book-class:me:v2";
  const TAB_KEY = "book-class:tab";
  const DRAFT_PREFIX = "book-class:draft:";
  const FONT_STACK = '"Pretendard", "Noto Sans KR", sans-serif';

  const useSheet = SHEET_API_URL !== "";
  const badSheetUrl = useSheet && !/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec\/?$/.test(SHEET_API_URL);

  /* =========================================================
     2. 한글, 학번 도우미
     ========================================================= */
  const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const DOUBLE_TO_BASE = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };
  const CONSONANTS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

  // 보라 톤에 어울리는 자음별 파스텔 [배경, 글자]
  const CONSONANT_COLORS = {
    "ㄱ": ["#FBE1EA", "#A23B63"], "ㄴ": ["#FCE6DC", "#A2502E"], "ㄷ": ["#FBF0C9", "#7F6406"],
    "ㄹ": ["#E6F2D9", "#4C7420"], "ㅁ": ["#D9F0E6", "#2D7354"], "ㅂ": ["#D7EFF1", "#216B70"],
    "ㅅ": ["#DDE8FA", "#2F5C93"], "ㅇ": ["#E4E3FB", "#4747A3"], "ㅈ": ["#ECE0FA", "#6A3BA6"],
    "ㅊ": ["#F6DEF3", "#943787"], "ㅋ": ["#FADFE6", "#A03D5B"], "ㅌ": ["#EFE6DA", "#755633"],
    "ㅍ": ["#E2EFE7", "#3B684D"], "ㅎ": ["#ECE8F0", "#574E66"]
  };
  const TOP_COLORS = ["#6D4AA8", "#C2457A", "#2F7A8A", "#B06A1F", "#4A5DB0"];

  function getInitialConsonant(word) {
    const text = String(word || "").trim();
    if (!text) return null;
    const code = text.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return null;
    const cho = CHOSUNG[Math.floor((code - 0xac00) / 588)];
    return DOUBLE_TO_BASE[cho] || cho;
  }

  // 받침 유무로 '이/가' 고르기 (로봇이, 과학자가)
  function josaIGa(word) {
    const w = String(word || "").trim();
    if (!w) return "이(가)";
    const code = w.charCodeAt(w.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return "이(가)";
    return (code - 0xac00) % 28 ? "이" : "가";
  }

  // 학번 5자리(20301 = 2학년 3반 1번) 또는 4자리(2301) → { sid, cls: "2-3" }
  function parseSid(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    let grade, room, no;
    if (d.length === 5) { grade = +d[0]; room = +d.slice(1, 3); no = +d.slice(3); }
    else if (d.length === 4) { grade = +d[0]; room = +d[1]; no = +d.slice(2); }
    else return null;
    if (grade < 1 || room < 1 || no < 1) return null;
    return { sid: d, cls: grade + "-" + room };
  }

  function clsLabel(cls) {
    if (cls === "*" || cls === "전체") return "모든 반";
    const p = String(cls).split("-");
    return p.length === 2 ? p[0] + "학년 " + p[1] + "반" : cls;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* =========================================================
     3. 데이터
     ========================================================= */
  function normalize(data) {
    const d = data || {};
    return {
      classes: (d.classes && d.classes.length) ? d.classes : DEFAULT_CLASSES.slice(),
      words: (d.words || [])
        .map(function (w) { return Object.assign({}, w, { consonant: getInitialConsonant(w.text) }); })
        .filter(function (w) { return w.consonant; }),
      writings: d.writings || [],
      comments: d.comments || []
    };
  }

  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 저장소를 못 쓰면 넘어갑니다 */ }
  }

  function saveState() {
    if (!useSheet) writeLocal(STORAGE_KEY, state);
  }

  let state = normalize(useSheet ? null : readLocal(STORAGE_KEY));
  let me = readLocal(ME_KEY);
  if (me && !parseSid(me.sid)) me = null;

  const ui = {
    studentTab: readLocal(TAB_KEY) || "words",   // words | raft | friends
    teacherActivity: "words",                     // words | raft
    teacherTab: "cloud",
    filter: null,
    selectedSid: null,
    cloudSeed: 0,
    lastAddedId: null,
    lastSyncAt: null,
    syncError: false,
    lockApplied: null,
    wlockApplied: null,
    presenting: false,
    lastCloud: null,
    openText: {}                                  // 친구 글 '더 보기' 펼침 상태
  };
  if (["words", "raft", "friends"].indexOf(ui.studentTab) === -1) ui.studentTab = "words";

  function bookFor(cls) {
    return state.classes.find(function (c) { return c.cls === cls; }) ||
      state.classes.find(function (c) { return c.cls === "전체"; }) ||
      { cls: "전체", title: "", topic: "" };
  }

  function myCls() { return parseSid(me.sid).cls; }
  function myBook() { return bookFor(myCls()); }

  function isClosed(c) { return !!(c && (c.closed || (c.closesAt && Date.now() >= c.closesAt))); }
  function isWClosed(c) { return !!(c && (c.wclosed || (c.wclosesAt && Date.now() >= c.wclosesAt))); }
  function myClosed() { return isClosed(myBook()); }
  function myWClosed() { return isWClosed(myBook()); }

  function timeLabel(ms) {
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    return (sameDay ? "오늘 " : (d.getMonth() + 1) + "월 " + d.getDate() + "일 ") +
      d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  }

  function myWords() {
    const title = myBook().title;
    return state.words.filter(function (w) { return w.sid === me.sid && w.book === title; });
  }

  function myWriting() {
    const title = myBook().title;
    return state.writings.find(function (w) { return w.sid === me.sid && w.book === title; }) || null;
  }

  function commentsFor(writingId) {
    return state.comments
      .filter(function (c) { return c.writingId === writingId; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
  }

  function groupByConsonant(words) {
    const groups = {};
    CONSONANTS.forEach(function (c) { groups[c] = []; });
    words.forEach(function (w) { groups[w.consonant].push(w); });
    return groups;
  }

  function aggregate(words) {
    const map = new Map();
    words.forEach(function (w) {
      let e = map.get(w.text);
      if (!e) { e = { text: w.text, consonant: w.consonant, sids: [], names: [] }; map.set(w.text, e); }
      if (e.sids.indexOf(w.sid) === -1) { e.sids.push(w.sid); e.names.push(w.name); }
    });
    return Array.from(map.values())
      .map(function (e) { e.count = e.sids.length; return e; })
      .sort(function (a, b) { return b.count - a.count || a.text.localeCompare(b.text, "ko"); });
  }

  function raftFilled(w) {
    return RAFT_FIELDS.filter(function (f) { return String((w && w[f.key]) || "").trim(); }).length;
  }

  /* =========================================================
     4. 구글 시트 통신
     ========================================================= */
  let ready = !useSheet;
  let lastSig = "";
  let syncTimer = null;
  let tick = 0;

  function sheetGet() {
    if (badSheetUrl) return Promise.reject(new Error("주소가 .../exec 형식이 아니에요"));
    return fetch(SHEET_API_URL + "?action=list&t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "불러오기 실패");
        return res.data;
      });
  }

  // text/plain으로 보내야 브라우저 사전 요청(CORS preflight) 없이 Apps Script에 바로 전달됩니다
  function sheetPost(payload) {
    return fetch(SHEET_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "저장 실패");
        return res;
      });
  }

  // 연습 모드에서는 바로 성공으로 처리
  function send(payload) {
    return useSheet ? sheetPost(payload) : Promise.resolve({ ok: true });
  }

  function refresh() {
    if (!useSheet) return Promise.resolve(false);
    return sheetGet().then(function (data) {
      ui.lastSyncAt = new Date();
      ui.syncError = false;
      const sig = JSON.stringify(data);
      const changed = sig !== lastSig;
      lastSig = sig;
      if (changed) state = normalize(data);
      return changed;
    });
  }

  function startPolling() {
    clearInterval(syncTimer);
    syncTimer = setInterval(function () {
      tick++;
      if (document.hidden || modalRoot.firstChild) return;

      if (currentRoute() === "teacher") {
        refresh()
          .then(function (changed) { if (changed) renderTeacher(); else updateSyncLabel(); })
          .catch(function () { ui.syncError = true; updateSyncLabel(); });
        return;
      }
      if (!me || !document.getElementById("student-panel")) return;

      // 정해진 마감 시각이 지났는지 먼저 확인
      if (ui.studentTab === "words" && myClosed() !== ui.lockApplied) renderBoard();
      if (ui.studentTab !== "words" && myWClosed() !== ui.wlockApplied) refreshStudentPanel();

      if (tick % 2 === 0) {
        refresh().then(function (changed) { if (changed) refreshStudentPanel(); }).catch(function () {});
      }
    }, POLL_INTERVAL);
  }

  /* =========================================================
     5. 학생 동작: 낱말
     ========================================================= */
  function addWord(raw) {
    const text = String(raw || "").trim();
    if (myClosed()) return { ok: false, message: "낱말 입력이 마감되었어요." };
    if (!text) return { ok: false, message: INPUT_GUIDE };
    if (/\s|,/.test(text)) return { ok: false, message: "띄어쓰기 없이 한 단어씩 입력해 주세요." };
    if (text.length > MAX_WORD_LENGTH) return { ok: false, message: "낱말은 " + MAX_WORD_LENGTH + "자 이내로 적어 주세요." };
    const consonant = getInitialConsonant(text);
    if (!consonant) return { ok: false, message: "한글로 시작하는 낱말만 채울 수 있어요." };
    if (myWords().some(function (w) { return w.text === text; })) return { ok: false, message: "‘" + text + "’ 낱말은 이미 채웠어요." };
    const book = myBook();
    if (!book.title) return { ok: false, message: "아직 책이 정해지지 않았어요. 선생님께 알려 주세요." };

    const word = { id: uid(), cls: myCls(), sid: me.sid, name: me.name, book: book.title, text: text, consonant: consonant, createdAt: Date.now() };
    state.words.push(word);
    ui.lastAddedId = word.id;
    saveState();

    send({ action: "add", word: { id: word.id, sid: word.sid, name: word.name, text: text } })
      .then(function (res) {
        if (res.word && res.word.book !== word.book) { word.book = res.word.book; renderBoard(); }
      })
      .catch(function (err) {
        state.words = state.words.filter(function (w) { return w.id !== word.id; });
        renderBoard();
        showToast("‘" + text + "’ 저장하지 못했어요. " + err.message, "error");
      });
    return { ok: true, word: word };
  }

  function removeWord(id) {
    const target = state.words.find(function (w) { return w.id === id && w.sid === me.sid; });
    if (!target) return;
    if (myClosed()) { showToast("낱말 입력이 마감되어 지울 수 없어요.", "error"); renderBoard(); return; }
    state.words = state.words.filter(function (w) { return w !== target; });
    saveState();
    renderBoard();
    send({ action: "delete", id: id, sid: me.sid }).catch(function (err) {
      state.words.push(target);
      renderBoard();
      showToast("‘" + target.text + "’ 지우지 못했어요. " + err.message, "error");
    });
  }

  /* =========================================================
     6. 학생 동작: RAFT 글, 소감
     ========================================================= */
  function draftKey() { return DRAFT_PREFIX + me.sid + "|" + myBook().title; }

  function readRaftForm() {
    const v = {};
    RAFT_FIELDS.forEach(function (f) {
      const el = document.getElementById("raft-" + f.key);
      v[f.key] = el ? el.value : "";
    });
    const t = document.getElementById("raft-text");
    v.text = t ? t.value : "";
    return v;
  }

  function submitWriting() {
    if (myWClosed()) { showToast("글쓰기가 마감되었어요.", "error"); return; }
    const v = readRaftForm();
    const missing = RAFT_FIELDS.find(function (f) { return !v[f.key].trim(); });
    if (missing) {
      showToast(missing.ko + "(" + missing.letter + ") 칸을 먼저 채워 주세요.", "error");
      document.getElementById("raft-" + missing.key).focus();
      return;
    }
    if (v.text.trim().length < MIN_TEXT) {
      showToast("글을 " + MIN_TEXT + "자 이상 써 주세요. (지금 " + v.text.trim().length + "자)", "error");
      document.getElementById("raft-text").focus();
      return;
    }

    const prev = myWriting();
    const writing = {
      id: prev ? prev.id : uid(), cls: myCls(), sid: me.sid, name: me.name, book: myBook().title,
      role: v.role.trim(), audience: v.audience.trim(), format: v.format.trim(), topic: v.topic.trim(),
      text: v.text.trim(), updatedAt: Date.now()
    };
    const btn = document.getElementById("raft-submit");
    btn.disabled = true;
    btn.innerHTML = icon("fa-spinner fa-spin") + " 제출하는 중";

    send({ action: "saveWriting", writing: writing })
      .then(function (res) {
        const saved = res.writing || writing;
        state.writings = state.writings.filter(function (w) { return !(w.sid === me.sid && w.book === saved.book); });
        state.writings.push(saved);
        saveState();
        writeLocal(draftKey(), null);
        showToast(prev ? "고친 글을 다시 제출했어요." : "제출했어요. 이제 친구들도 읽을 수 있어요.", "success");
        renderStudentPanel();
      })
      .catch(function (err) {
        showToast("제출하지 못했어요. " + err.message, "error");
        updateRaftStatus();
      });
  }

  function addComment(writingId, input) {
    const text = input.value.trim();
    if (myWClosed()) { showToast("글쓰기가 마감되어 소감을 남길 수 없어요.", "error"); return; }
    if (text.length < 2) { showToast("소감을 조금 더 적어 주세요.", "error"); input.focus(); return; }
    const target = state.writings.find(function (w) { return w.id === writingId; });
    if (!target || target.sid === me.sid) return;

    const comment = { id: uid(), cls: myCls(), sid: me.sid, name: me.name, book: target.book, writingId: writingId, text: text, createdAt: Date.now() };
    state.comments.push(comment);
    saveState();
    input.value = "";
    renderFriends();

    send({ action: "addComment", comment: comment }).catch(function (err) {
      state.comments = state.comments.filter(function (c) { return c.id !== comment.id; });
      renderFriends();
      showToast("소감을 남기지 못했어요. " + err.message, "error");
    });
  }

  function removeComment(id) {
    const target = state.comments.find(function (c) { return c.id === id && c.sid === me.sid; });
    if (!target) return;
    state.comments = state.comments.filter(function (c) { return c !== target; });
    saveState();
    renderFriends();
    send({ action: "deleteComment", id: id, sid: me.sid }).catch(function (err) {
      state.comments.push(target);
      renderFriends();
      showToast("소감을 지우지 못했어요. " + err.message, "error");
    });
  }

  /* =========================================================
     7. 공통 UI
     ========================================================= */
  const root = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  function esc(v) {
    return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function colorVars(c) {
    return "--chip-bg:" + CONSONANT_COLORS[c][0] + ";--chip-fg:" + CONSONANT_COLORS[c][1];
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function icon(name) { return '<i class="fa-solid ' + name + '" aria-hidden="true"></i>'; }

  function showToast(message, type) {
    const el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.setAttribute("role", "status");
    el.innerHTML = icon(type === "error" ? "fa-circle-exclamation" : "fa-circle-check") + "<span>" + esc(message) + "</span>";
    toastRoot.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-leaving");
      setTimeout(function () { el.remove(); }, 300);
    }, 2800);
  }

  function noticeHtml(iconName, title, desc, retry) {
    return (
      '<div class="notice-card">' + icon(iconName) +
        "<h2>" + esc(title) + "</h2><p>" + esc(desc) + "</p>" +
        (retry ? '<button type="button" class="btn btn-primary" data-action="retry-load">' + icon("fa-arrows-rotate") + " 다시 불러오기</button>" : "") +
      "</div>"
    );
  }

  // "나는 ___이(가) 되어, ___에게, ___ 형식으로, ___에 대해 씁니다."
  function frameHtml(w) {
    function blank(v) {
      const s = String(v || "").trim();
      return s ? '<b class="fill">' + esc(s) + "</b>" : '<span class="blank"></span>';
    }
    return "나는 " + blank(w.role) + josaIGa(w.role) + " 되어, " + blank(w.audience) + "에게, " +
      blank(w.format) + " 형식으로, " + blank(w.topic) + "에 대해 씁니다.";
  }

  function textHtml(text) {
    return esc(text).replace(/\n/g, "<br>");
  }

  /* =========================================================
     8. 학생: 입장
     ========================================================= */
  function renderStudent() {
    if (me) renderStudentShell();
    else renderLogin();
  }

  function renderLogin() {
    root.innerHTML =
      '<section class="login-wrap">' +
        '<form id="login-form" class="login-card" autocomplete="off" novalidate>' +
          '<span class="login-icon">' + icon("fa-book-open-reader") + "</span>" +
          '<h1 class="login-title">독서 활동 입장</h1>' +
          '<p class="login-desc">학번과 이름을 적고 입장하세요.</p>' +
          '<label class="field"><span>학번</span><input id="login-sid" inputmode="numeric" maxlength="5" placeholder="예: 20301" /></label>' +
          '<label class="field"><span>이름</span><input id="login-name" maxlength="10" placeholder="예: 강현수" /></label>' +
          '<p id="login-error" class="form-hint is-error" aria-live="polite"></p>' +
          '<button type="submit" class="btn btn-primary btn-block">입장하기</button>' +
          '<p class="login-foot">학번은 학년, 반, 번호를 붙여 적어요. 2학년 3반 1번이면 20301</p>' +
        "</form>" +
      "</section>";
    document.getElementById("login-sid").focus();
  }

  function handleLogin(form) {
    const p = parseSid(form.querySelector("#login-sid").value);
    const name = form.querySelector("#login-name").value.trim().replace(/\s+/g, "");
    const errorEl = form.querySelector("#login-error");
    const btn = form.querySelector("button[type=submit]");
    if (!p) { errorEl.textContent = "학번 5자리를 숫자로 적어 주세요. (예: 20301)"; return; }
    if (!/^[가-힣A-Za-z]{2,10}$/.test(name)) { errorEl.textContent = "이름을 2글자 이상 적어 주세요."; return; }

    btn.disabled = true;
    btn.textContent = "확인하는 중...";
    refresh().catch(function () {}).then(function () {
      const all = state.words.concat(state.writings, state.comments);
      if (all.some(function (x) { return x.sid === p.sid && x.name !== name; })) {
        btn.disabled = false;
        btn.textContent = "입장하기";
        errorEl.textContent = "이 학번은 다른 이름으로 이미 쓰이고 있어요. 선생님께 확인해 주세요.";
        return;
      }
      me = { sid: p.sid, name: name };
      writeLocal(ME_KEY, me);
      renderStudentShell();
    });
  }

  /* =========================================================
     9. 학생: 공통 틀 (책 띠 + 단계 탭)
     ========================================================= */
  function renderStudentShell() {
    const book = myBook();
    const steps = [["words", "1", WORDS_TITLE], ["raft", "2", RAFT_TITLE], ["friends", "3", FRIENDS_TITLE]];
    root.innerHTML =
      '<section class="student-view">' +
        '<div class="book-banner">' +
          '<div class="book-info">' +
            '<span class="book-label">' + icon("fa-bookmark") + " " + esc(clsLabel(myCls())) + " 독서 활동</span>" +
            '<strong class="book-title">' + (book.title ? "『" + esc(book.title) + "』" : "책이 아직 정해지지 않았어요") + "</strong>" +
            (book.topic ? '<span class="book-topic">' + esc(book.topic) + "</span>" : "") +
          "</div>" +
          '<div class="me-box">' +
            '<span class="me-name">' + icon("fa-user") + " " + esc(me.sid) + " " + esc(me.name) + "</span>" +
            '<button type="button" class="btn btn-light btn-small" data-action="logout">나가기</button>' +
          "</div>" +
        "</div>" +
        '<nav class="step-tabs" role="tablist">' +
          steps.map(function (s) {
            const on = ui.studentTab === s[0];
            return '<button type="button" role="tab" class="step-tab' + (on ? " is-active" : "") + '" aria-selected="' + on + '" data-action="student-tab" data-tab="' + s[0] + '">' +
              '<span class="step-no">' + s[1] + "</span>" + s[2] + "</button>";
          }).join("") +
        "</nav>" +
        '<div id="student-panel" class="student-panel"></div>' +
      "</section>";
    renderStudentPanel();
  }

  function renderStudentPanel() {
    if (ui.studentTab === "raft") renderRaft();
    else if (ui.studentTab === "friends") renderFriends();
    else renderWordsPanel();
  }

  // 시트가 바뀌었을 때: 입력 중인 내용은 지우지 않도록 조심해서 다시 그림
  function refreshStudentPanel() {
    if (ui.studentTab === "words") renderBoard();
    else if (ui.studentTab === "raft") { applyRaftLock(); updateRaftStatus(); }
    else {
      const typing = Array.prototype.some.call(root.querySelectorAll(".comment-form input"), function (i) {
        return i.value.trim() || i === document.activeElement;
      });
      if (!typing) renderFriends();
      else ui.wlockApplied = myWClosed();
    }
  }

  /* =========================================================
     10. 학생: 1단계 낱말
     ========================================================= */
  function renderWordsPanel() {
    document.getElementById("student-panel").innerHTML =
      '<div id="lock-note" class="lock-note" hidden></div>' +
      '<form id="word-form" class="word-form" autocomplete="off">' +
        '<label for="word-input" class="sr-only">낱말 입력</label>' +
        '<input id="word-input" type="text" maxlength="' + MAX_WORD_LENGTH + '" placeholder="떠오른 낱말 하나" enterkeyhint="done" />' +
        '<button type="submit" class="btn btn-primary">' + icon("fa-plus") + " 채우기</button>" +
      "</form>" +
      '<p id="form-hint" class="form-hint guide" aria-live="polite">' + icon("fa-keyboard") + " " + INPUT_GUIDE + "</p>" +
      '<div id="progress" class="progress-line"></div>' +
      '<div id="board" class="board"></div>';
    renderBoard();
    if (!myClosed()) document.getElementById("word-input").focus();
  }

  function applyLock(closed) {
    const input = document.getElementById("word-input");
    const note = document.getElementById("lock-note");
    if (!input || !note) return;
    input.disabled = closed;
    document.querySelector("#word-form button").disabled = closed;
    input.placeholder = closed ? "낱말 입력이 마감되었어요" : "떠오른 낱말 하나";
    document.getElementById("form-hint").hidden = closed;

    const book = myBook();
    if (closed) {
      note.className = "lock-note is-closed";
      note.innerHTML = "<span>" + icon("fa-lock") + " 낱말 입력이 마감되었어요. 이제 RAFT 글쓰기로 넘어가 볼까요?</span>" +
        '<button type="button" class="btn btn-primary btn-small" data-action="student-tab" data-tab="raft">' + RAFT_TITLE + " " + icon("fa-arrow-right") + "</button>";
      note.hidden = false;
    } else if (book.closesAt) {
      note.className = "lock-note";
      note.innerHTML = "<span>" + icon("fa-clock") + " " + esc(timeLabel(book.closesAt)) + "에 낱말 입력이 마감돼요.</span>";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function renderBoard() {
    const board = document.getElementById("board");
    if (!board || !me) return;
    const words = myWords();
    const groups = groupByConsonant(words);
    const filled = CONSONANTS.filter(function (c) { return groups[c].length; }).length;
    const closed = myClosed();
    ui.lockApplied = closed;
    applyLock(closed);

    document.getElementById("progress").innerHTML =
      '<span>채운 칸 <strong>' + filled + " / 14</strong></span>" +
      '<div class="progress-bar"><span style="width:' + Math.round((filled / 14) * 100) + '%"></span></div>' +
      "<span>낱말 <strong>" + words.length + "개</strong></span>";

    board.innerHTML = CONSONANTS.map(function (c) {
      const list = groups[c];
      return (
        '<article class="cell' + (list.length ? " is-filled" : "") + '" data-consonant="' + c + '" style="' + colorVars(c) + '">' +
          '<header class="cell-head"><span class="cell-letter">' + c + "</span>" +
            (list.length ? '<span class="cell-count">' + list.length + "</span>" : "") + "</header>" +
          '<ul class="chip-list">' +
            list.map(function (w) {
              return '<li class="chip' + (w.id === ui.lastAddedId ? " chip-new" : "") + '"><span class="chip-text">' + esc(w.text) + "</span>" +
                (closed ? "" : '<button type="button" class="chip-remove" data-action="remove-word" data-id="' + esc(w.id) + '" aria-label="' + esc(w.text) + ' 지우기">' + icon("fa-xmark") + "</button>") +
                "</li>";
            }).join("") +
          "</ul>" +
        "</article>"
      );
    }).join("");
    ui.lastAddedId = null;
  }

  function setHint(message, kind) {
    const hint = document.getElementById("form-hint");
    if (!hint) return;
    hint.className = "form-hint" + (kind ? " is-" + kind : " guide");
    hint.innerHTML = (kind ? "" : icon("fa-keyboard") + " ") + esc(message);
  }

  function flashCell(c) {
    const cell = root.querySelector('.cell[data-consonant="' + c + '"]');
    if (!cell) return;
    cell.classList.remove("is-flash");
    void cell.offsetWidth;
    cell.classList.add("is-flash");
  }

  /* =========================================================
     11. 학생: 2단계 RAFT 글쓰기
     ========================================================= */
  function renderRaft() {
    const saved = myWriting();
    const draft = readLocal(draftKey());
    // 이 기기에 저장 중인 글이 제출본보다 새것이면 그것부터
    const v = (draft && (!saved || draft.savedAt > saved.updatedAt)) ? draft : (saved || {});
    const myWordChips = myWords().map(function (w) {
      return '<button type="button" class="chip chip-btn" style="' + colorVars(w.consonant) + '" data-action="insert-word" data-word="' + esc(w.text) + '">' + esc(w.text) + "</button>";
    }).join("");

    document.getElementById("student-panel").innerHTML =
      '<div class="raft-top">' +
        '<span id="raft-pill" class="pill"></span>' +
        '<span id="raft-state" class="raft-state"></span>' +
      "</div>" +
      '<div id="wlock-note" class="lock-note" hidden></div>' +
      '<p id="raft-frame" class="frame">' + frameHtml(v) + "</p>" +

      '<div class="raft-grid">' +
        RAFT_FIELDS.map(function (f) {
          return (
            '<label class="raft-card">' +
              '<span class="raft-head"><span class="raft-letter">' + f.letter + "</span>" +
                '<span class="raft-name"><strong>' + f.ko + "</strong><small>" + f.en + "</small></span></span>" +
              '<span class="raft-q">' + f.q + "</span>" +
              '<input id="raft-' + f.key + '" class="raft-input" data-raft maxlength="' + MAX_RAFT_FIELD + '" placeholder="' + esc(f.ph) + '" value="' + esc(v[f.key] || "") + '" />' +
              (f.picks ? '<span class="picks">' + f.picks.map(function (p) {
                return '<button type="button" class="pick" data-action="pick-format" data-value="' + p + '">' + p + "</button>";
              }).join("") + "</span>" : "") +
            "</label>"
          );
        }).join("") +
      "</div>" +

      '<div class="write-card">' +
        '<div class="write-head"><strong>' + icon("fa-pen-nib") + " 글쓰기</strong><span id=\"raft-count\" class=\"write-count\"></span></div>" +
        '<p class="write-guide">위에서 정한 역할이 되어, 청중에게 말하듯 써 보세요. ' + MIN_TEXT + "자 이상 쓰면 제출할 수 있어요.</p>" +
        (myWordChips ? '<div class="word-picks"><span>' + icon("fa-feather") + " 내가 모은 낱말 넣기</span>" + myWordChips + "</div>" : "") +
        '<textarea id="raft-text" data-raft maxlength="' + MAX_TEXT + '" rows="11" placeholder="여기에 글을 써 보세요.">' + esc(v.text || "") + "</textarea>" +
      "</div>" +

      '<div class="raft-actions">' +
        '<span id="draft-state" class="draft-state"></span>' +
        '<button type="button" id="raft-submit" class="btn btn-primary" data-action="submit-writing"></button>' +
      "</div>";

    applyRaftLock();
    updateRaftStatus();
  }

  function updateRaftStatus() {
    const pill = document.getElementById("raft-pill");
    if (!pill) return;
    const v = readRaftForm();
    const saved = myWriting();
    const len = v.text.trim().length;
    pill.textContent = raftFilled(v) + " / 4칸, 글 " + len + "자";
    document.getElementById("raft-count").textContent = len + " / " + MAX_TEXT + "자";
    document.getElementById("raft-count").classList.toggle("is-ok", len >= MIN_TEXT);
    document.getElementById("raft-frame").innerHTML = frameHtml(v);

    const changed = !saved || RAFT_FIELDS.some(function (f) { return v[f.key].trim() !== saved[f.key]; }) || v.text.trim() !== saved.text;
    document.getElementById("raft-state").innerHTML = saved
      ? '<span class="tag tag-done">' + icon("fa-circle-check") + " 제출함, " + esc(timeLabel(saved.updatedAt)) + "</span>" +
        (changed ? ' <span class="tag tag-warn">고친 내용은 아직 제출 전</span>' : "")
      : '<span class="tag">아직 제출하지 않았어요</span>';

    const btn = document.getElementById("raft-submit");
    if (!myWClosed()) {
      btn.disabled = saved ? !changed : false;
      btn.innerHTML = icon("fa-paper-plane") + (saved ? " 고쳐서 다시 제출" : " 제출하기");
    }
  }

  function applyRaftLock() {
    const note = document.getElementById("wlock-note");
    if (!note) return;
    const closed = myWClosed();
    ui.wlockApplied = closed;
    root.querySelectorAll("[data-raft], .pick, .word-picks .chip-btn").forEach(function (el) { el.disabled = closed; });
    const btn = document.getElementById("raft-submit");
    const book = myBook();
    if (closed) {
      btn.disabled = true;
      btn.innerHTML = icon("fa-lock") + " 마감됨";
      note.className = "lock-note is-closed";
      note.innerHTML = "<span>" + icon("fa-lock") + " 글쓰기가 마감되었어요. 쓴 글은 그대로 볼 수 있어요.</span>";
      note.hidden = false;
    } else if (book.wclosesAt) {
      note.className = "lock-note";
      note.innerHTML = "<span>" + icon("fa-clock") + " " + esc(timeLabel(book.wclosesAt)) + "에 글쓰기가 마감돼요.</span>";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  let draftTimer = null;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    const state_ = document.getElementById("draft-state");
    if (state_) state_.textContent = "";
    draftTimer = setTimeout(function () {
      const v = readRaftForm();
      v.savedAt = Date.now();
      writeLocal(draftKey(), v);
      const el = document.getElementById("draft-state");
      if (el) el.innerHTML = icon("fa-floppy-disk") + " 이 기기에 임시 저장됨";
    }, 600);
  }

  function insertAtCursor(textarea, word) {
    const start = textarea.selectionStart, end = textarea.selectionEnd, val = textarea.value;
    const before = val.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    textarea.value = before + pad + word + val.slice(end);
    const pos = start + pad.length + word.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
  }

  /* =========================================================
     12. 학생: 3단계 친구 글 읽기
     ========================================================= */
  function renderFriends() {
    const panel = document.getElementById("student-panel");
    if (!panel || ui.studentTab !== "friends") return;
    const title = myBook().title;
    const cls = myCls();
    const closed = myWClosed();
    ui.wlockApplied = closed;
    const list = state.writings
      .filter(function (w) { return w.book === title && w.cls === cls; })
      .sort(function (a, b) { return (a.sid === me.sid ? -1 : b.sid === me.sid ? 1 : 0) || b.updatedAt - a.updatedAt; });
    const mine = list.find(function (w) { return w.sid === me.sid; });

    panel.innerHTML =
      (closed ? '<div class="lock-note is-closed"><span>' + icon("fa-lock") + " 글쓰기가 마감되어 소감은 읽기만 할 수 있어요.</span></div>" : "") +
      (!mine ? '<div class="lock-note"><span>' + icon("fa-circle-info") + " 내 글을 제출하면 친구들도 내 글을 읽고 소감을 남길 수 있어요.</span>" +
        '<button type="button" class="btn btn-primary btn-small" data-action="student-tab" data-tab="raft">' + RAFT_TITLE + "</button></div>" : "") +
      '<p class="friends-guide">' + icon("fa-heart") + " 친구 글에서 좋았던 점이나 궁금한 점을 한 문장 이상 남겨 주세요. 따뜻한 말이 좋은 글을 키워요.</p>" +
      (list.length
        ? '<div class="post-list">' + list.map(function (w) { return postHtml(w, closed); }).join("") + "</div>"
        : noticeHtml("fa-feather-pointed", "아직 제출된 글이 없어요", "친구들이 RAFT 글을 제출하면 여기에 모여요.", false));
  }

  function postHtml(w, closed) {
    const isMine = w.sid === me.sid;
    const comments = commentsFor(w.id);
    const long = w.text.length > 280;
    const open = ui.openText[w.id];
    return (
      '<article class="post' + (isMine ? " is-mine" : "") + '">' +
        '<header class="post-head">' +
          '<span class="avatar">' + esc(w.name.charAt(0)) + "</span>" +
          '<span class="post-who"><strong>' + esc(w.name) + "</strong>" + (isMine ? '<span class="tag tag-mine">내 글</span>' : "") +
            '<small>' + esc(timeLabel(w.updatedAt)) + "</small></span>" +
          '<span class="post-ccount">' + icon("fa-comment") + " " + comments.length + "</span>" +
        "</header>" +
        '<p class="frame frame-small">' + frameHtml(w) + "</p>" +
        '<div class="post-text' + (long && !open ? " is-clamped" : "") + '">' + textHtml(w.text) + "</div>" +
        (long ? '<button type="button" class="link-btn" data-action="toggle-text" data-id="' + esc(w.id) + '">' + (open ? "접기" : "더 보기") + "</button>" : "") +
        '<div class="comments">' +
          comments.map(function (c) {
            return '<div class="comment"><strong>' + esc(c.name) + "</strong><span>" + esc(c.text) + "</span>" +
              (c.sid === me.sid && !closed ? '<button type="button" class="comment-del" data-action="delete-comment" data-id="' + esc(c.id) + '" aria-label="소감 지우기">' + icon("fa-xmark") + "</button>" : "") +
              "</div>";
          }).join("") +
          (!isMine && !closed
            ? '<form class="comment-form" data-writing="' + esc(w.id) + '" autocomplete="off">' +
                '<input maxlength="' + MAX_COMMENT + '" placeholder="' + esc(w.name) + '에게 소감 남기기" aria-label="소감" />' +
                '<button type="submit" class="btn btn-primary btn-small">남기기</button></form>'
            : "") +
        "</div>" +
      "</article>"
    );
  }

  /* =========================================================
     13. 교사 대시보드
     ========================================================= */
  function filterOptions() {
    const map = new Map();
    function add(book, cls, n, at) {
      if (!book) return;
      const key = book + "|" + cls;
      const e = map.get(key) || { key: key, book: book, cls: cls, n: 0, last: 0 };
      e.n += n || 0;
      e.last = Math.max(e.last, at || 0);
      map.set(key, e);
    }
    state.classes.forEach(function (c) { add(c.title, "*"); if (c.cls !== "전체") add(c.title, c.cls); });
    state.words.forEach(function (w) { add(w.book, "*", 1, w.createdAt); add(w.book, w.cls, 1, w.createdAt); });
    state.writings.forEach(function (w) { add(w.book, "*", 0, w.updatedAt); add(w.book, w.cls, 0, w.updatedAt); });
    return Array.from(map.values()).sort(function (a, b) {
      return a.book.localeCompare(b.book, "ko") || (a.cls === "*" ? -1 : b.cls === "*" ? 1 : a.cls.localeCompare(b.cls, "ko", { numeric: true }));
    });
  }

  function currentFilter(options) {
    let f = options.find(function (o) { return o.key === ui.filter; });
    if (!f) {
      f = options.filter(function (o) { return o.cls === "*"; }).sort(function (a, b) { return b.last - a.last; })[0] || options[0] || null;
      ui.filter = f ? f.key : null;
    }
    return f;
  }

  function inFilter(f) {
    return function (x) { return f && x.book === f.book && (f.cls === "*" || x.cls === f.cls); };
  }

  function filterStatus(f, kind) {
    if (!f || !useSheet) return null;
    const check = kind === "raft" ? isWClosed : isClosed;
    const atKey = kind === "raft" ? "wclosesAt" : "closesAt";
    const rows = f.cls === "*"
      ? state.classes.filter(function (c) { return c.title === f.book; })
      : [bookFor(f.cls)].filter(function (c) { return c.title === f.book; });
    if (!rows.length) return { kind: "past", text: "지난 책" };
    const closedN = rows.filter(check).length;
    if (closedN === rows.length) return { kind: "closed", text: "마감" };
    if (closedN > 0) return { kind: "partial", text: "일부 반 마감" };
    const next = rows.map(function (c) { return c[atKey]; }).filter(Boolean).sort()[0];
    return { kind: "open", text: next ? "받는 중, " + timeLabel(next) + " 마감" : "받는 중" };
  }

  function renderTeacher() {
    const options = filterOptions();
    const f = currentFilter(options);
    const isRaft = ui.teacherActivity === "raft";
    const status = filterStatus(f, ui.teacherActivity);

    const books = [];
    options.forEach(function (o) { if (books.indexOf(o.book) === -1) books.push(o.book); });
    const select = books.map(function (b) {
      return '<optgroup label="『' + esc(b) + '』">' +
        options.filter(function (o) { return o.book === b; }).map(function (o) {
          return '<option value="' + esc(o.key) + '"' + (f && o.key === f.key ? " selected" : "") + ">" + esc(clsLabel(o.cls)) + " 『" + esc(b) + "』</option>";
        }).join("") + "</optgroup>";
    }).join("");

    root.innerHTML =
      '<section class="teacher-view">' +
        '<div class="teacher-top">' +
          "<div>" +
            '<p class="eyebrow">교사 대시보드</p>' +
            '<div class="activity-switch" role="tablist">' +
              [["words", "1. " + WORDS_TITLE], ["raft", "2. " + RAFT_TITLE]].map(function (a) {
                const on = ui.teacherActivity === a[0];
                return '<button type="button" role="tab" class="act' + (on ? " is-active" : "") + '" aria-selected="' + on + '" data-action="teacher-activity" data-activity="' + a[0] + '">' + a[1] + "</button>";
              }).join("") +
            "</div>" +
          "</div>" +
          (useSheet
            ? '<div class="sync-box"><span id="sync-label" class="sync-label">' + syncText() + "</span>" +
                '<button type="button" class="btn btn-ghost btn-small" data-action="refresh-sheet">' + icon("fa-arrows-rotate") + " 새로고침</button></div>"
            : '<button type="button" class="btn btn-ghost btn-small" data-action="clear-local">' + icon("fa-trash-can") + " 이 브라우저 기록 지우기</button>") +
        "</div>" +

        '<label class="filter-box">' +
          "<span>" + icon("fa-filter") + " 반과 책</span>" +
          (options.length ? '<select id="filter-select">' + select + "</select>" : "<select disabled><option>아직 수업이 없어요</option></select>") +
          (status ? '<span class="status-badge is-' + status.kind + '" title="스프레드시트 수업 탭의 \'' + (isRaft ? "글쓰기 입력" : "낱말 입력") + '\' 칸에서 바꿀 수 있어요">' +
            icon(status.kind === "open" ? "fa-pen" : status.kind === "past" ? "fa-box-archive" : "fa-lock") + " " + (isRaft ? "글쓰기 " : "낱말 ") + esc(status.text) + "</span>" : "") +
        "</label>" +
        '<div id="teacher-body"></div>' +
      "</section>";

    if (isRaft) renderTeacherRaft(f);
    else renderTeacherWords(f);
  }

  function stat(label, value, sub) {
    return '<div class="stat"><span class="stat-label">' + label + '</span><strong class="stat-value">' + value + "</strong>" +
      (sub ? '<span class="stat-sub">' + sub + "</span>" : "") + "</div>";
  }

  function syncText() {
    if (ui.syncError) return icon("fa-triangle-exclamation") + " 연결이 잠시 끊겼어요";
    const t = ui.lastSyncAt ? ui.lastSyncAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-";
    return '<span class="sync-dot" aria-hidden="true"></span> 구글 시트 연결됨, ' + t + " 갱신";
  }

  function updateSyncLabel() {
    const el = document.getElementById("sync-label");
    if (!el) return;
    el.innerHTML = syncText();
    el.classList.toggle("is-error", ui.syncError);
  }

  /* ---------- 교사: 낱말 ---------- */
  function renderTeacherWords(f) {
    const body = document.getElementById("teacher-body");
    const words = state.words.filter(inFilter(f));
    const agg = aggregate(words);
    if (!words.length) {
      if (ui.presenting) setPresenting(false, true);
      body.innerHTML = noticeHtml("fa-seedling", "아직 들어온 낱말이 없어요", "학생들이 학번과 이름으로 입장해 낱말을 채우면 여기에 바로 모여요.", false);
      return;
    }
    const students = new Set(words.map(function (w) { return w.sid; })).size;
    const perC = CONSONANTS.map(function (c) { return { c: c, n: words.filter(function (w) { return w.consonant === c; }).length }; });
    const busiest = perC.reduce(function (a, b) { return b.n > a.n ? b : a; });

    body.innerHTML =
      '<div class="stats">' +
        stat("참여 학생", students + "명") +
        stat("모인 낱말", words.length + "개", "서로 다른 낱말 " + agg.length + "개") +
        stat("가장 많이 채운 칸", busiest.c, busiest.n + "개") +
      "</div>" +
      '<div class="tabs" role="tablist">' +
        [["cloud", "낱말 구름", "fa-cloud"], ["overview", "자음별 모아보기", "fa-table-cells-large"], ["individual", "학생별 보기", "fa-user"]]
          .map(function (t) {
            const on = ui.teacherTab === t[0];
            return '<button type="button" role="tab" class="tab' + (on ? " is-active" : "") + '" aria-selected="' + on + '" data-action="tab" data-tab="' + t[0] + '">' + icon(t[2]) + " " + t[1] + "</button>";
          }).join("") +
      "</div>" +
      '<div id="tab-panel" class="tab-panel"></div>';

    const panel = document.getElementById("tab-panel");
    if (ui.teacherTab === "overview") panel.innerHTML = renderOverview(agg);
    else if (ui.teacherTab === "individual") panel.innerHTML = renderIndividual(words);
    else {
      panel.innerHTML = renderCloudPanel(f, agg, students);
      fontsReady.then(function () { requestAnimationFrame(function () { drawCloud(agg); }); });
    }
  }

  function wordButton(e) {
    return '<button type="button" class="chip chip-btn" style="' + colorVars(e.consonant) + '" data-action="show-word" data-word="' + esc(e.text) + '">' +
      esc(e.text) + (e.count > 1 ? '<span class="chip-count">' + e.count + "</span>" : "") + "</button>";
  }

  function renderOverview(agg) {
    return '<div class="board">' + CONSONANTS.map(function (c) {
      const items = agg.filter(function (a) { return a.consonant === c; });
      return '<article class="cell' + (items.length ? " is-filled" : "") + '" style="' + colorVars(c) + '">' +
        '<header class="cell-head"><span class="cell-letter">' + c + "</span>" + (items.length ? '<span class="cell-count">' + items.length + "</span>" : "") + "</header>" +
        '<div class="chip-list">' + items.map(wordButton).join("") + "</div></article>";
    }).join("") + "</div>";
  }

  function renderIndividual(words) {
    const map = new Map();
    words.forEach(function (w) {
      const s = map.get(w.sid) || { sid: w.sid, name: w.name, words: [] };
      s.words.push(w);
      map.set(w.sid, s);
    });
    const students = Array.from(map.values()).sort(function (a, b) { return a.sid.localeCompare(b.sid, "ko", { numeric: true }); });
    if (!map.has(ui.selectedSid)) ui.selectedSid = students[0].sid;
    const sel = map.get(ui.selectedSid);
    const groups = groupByConsonant(sel.words);

    return (
      '<div class="individual">' +
        '<div class="student-list">' +
          students.map(function (s) {
            const filled = new Set(s.words.map(function (w) { return w.consonant; })).size;
            return '<button type="button" class="student-item' + (s.sid === sel.sid ? " is-active" : "") + '" data-action="select-student" data-sid="' + esc(s.sid) + '">' +
              "<strong>" + esc(s.sid) + " " + esc(s.name) + "</strong><span>낱말 " + s.words.length + "개, " + filled + "/14칸</span></button>";
          }).join("") +
        "</div>" +
        '<div class="student-detail">' +
          "<h2>" + esc(sel.sid) + " " + esc(sel.name) + "</h2>" +
          '<div class="mini-board">' +
            CONSONANTS.filter(function (c) { return groups[c].length; }).map(function (c) {
              return '<div class="mini-row" style="' + colorVars(c) + '"><span class="cell-letter">' + c + '</span><div class="chip-list">' +
                groups[c].map(function (w) { return '<span class="chip">' + esc(w.text) + "</span>"; }).join("") + "</div></div>";
            }).join("") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderCloudPanel(f, agg, studentsN) {
    return (
      '<div class="cloud-wrap' + (ui.presenting ? " is-presenting" : "") + '">' +
        '<div class="present-head">' +
          '<div><p class="present-sub">' + esc(clsLabel(f.cls)) + " " + WORDS_TITLE + '</p><h2 class="present-title">『' + esc(f.book) + "』</h2></div>" +
          '<div class="present-side">' +
            '<span class="present-count">' + icon("fa-user-group") + " " + studentsN + "명, 낱말 " + agg.length + "개</span>" +
            '<button type="button" class="btn btn-ghost btn-small" data-action="save-image">' + icon("fa-download") + " 이미지 저장</button>" +
            '<button type="button" class="btn btn-primary btn-small" data-action="exit-present">' + icon("fa-compress") + " 나가기</button>" +
          "</div>" +
        "</div>" +
        '<div class="cloud-head"><p>여러 학생이 함께 떠올린 낱말일수록 크게 보여요. 낱말을 누르면 누가 적었는지 볼 수 있어요.</p>' +
          '<div class="cloud-tools">' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="redraw-cloud">' + icon("fa-wand-magic-sparkles") + " 다시 그리기</button>" +
            '<button type="button" class="btn btn-ghost btn-small" data-action="save-image">' + icon("fa-download") + " 이미지 저장</button>" +
            '<button type="button" class="btn btn-primary btn-small" data-action="present">' + icon("fa-expand") + " 전체 화면</button>" +
          "</div></div>" +
        '<div id="cloud-stage" class="cloud-stage" aria-label="낱말 구름"></div>' +
        '<ol class="top-list">' +
          agg.slice(0, 5).map(function (t, i) {
            return '<li><button type="button" data-action="show-word" data-word="' + esc(t.text) + '" style="--rank-color:' + TOP_COLORS[i] + '">' +
              '<span class="rank">' + (i + 1) + "</span>" + esc(t.text) + ' <span class="top-count">' + t.count + "명</span></button></li>";
          }).join("") +
        "</ol>" +
      "</div>"
    );
  }

  /* ---------- 교사: RAFT 글쓰기 ---------- */
  function renderTeacherRaft(f) {
    const body = document.getElementById("teacher-body");
    const writings = state.writings.filter(inFilter(f));
    const comments = state.comments.filter(inFilter(f));

    // 낱말이나 글을 한 번이라도 남긴 학생 = 참여 학생
    const people = new Map();
    state.words.filter(inFilter(f)).concat(writings).forEach(function (x) {
      if (!people.has(x.sid)) people.set(x.sid, { sid: x.sid, name: x.name });
    });
    if (!people.size) {
      body.innerHTML = noticeHtml("fa-pen-nib", "아직 참여한 학생이 없어요", "학생들이 입장해 활동을 시작하면 여기에 모여요.", false);
      return;
    }
    const students = Array.from(people.values()).sort(function (a, b) { return a.sid.localeCompare(b.sid, "ko", { numeric: true }); });
    const avg = writings.length ? Math.round(writings.reduce(function (n, w) { return n + w.text.length; }, 0) / writings.length) : 0;
    if (!people.has(ui.selectedSid)) {
      const first = writings.slice().sort(function (a, b) { return a.sid.localeCompare(b.sid, "ko", { numeric: true }); })[0];
      ui.selectedSid = first ? first.sid : students[0].sid;
    }
    const sel = people.get(ui.selectedSid);
    const w = writings.find(function (x) { return x.sid === sel.sid; });

    body.innerHTML =
      '<div class="stats">' +
        stat("제출한 학생", writings.length + "명", "참여 학생 " + students.length + "명 중") +
        stat("평균 글 길이", avg + "자") +
        stat("남긴 소감", comments.length + "개") +
      "</div>" +
      '<div class="individual">' +
        '<div class="student-list">' +
          students.map(function (s) {
            const sw = writings.find(function (x) { return x.sid === s.sid; });
            const cc = sw ? commentsFor(sw.id).length : 0;
            return '<button type="button" class="student-item' + (s.sid === sel.sid ? " is-active" : "") + '" data-action="select-student" data-sid="' + esc(s.sid) + '">' +
              "<strong>" + esc(s.sid) + " " + esc(s.name) + "</strong>" +
              (sw ? '<span class="ok">' + icon("fa-circle-check") + " 제출, " + sw.text.length + "자, 소감 " + cc + "</span>" : '<span class="no">아직 제출 전</span>') +
              "</button>";
          }).join("") +
        "</div>" +
        '<div class="student-detail raft-detail">' + teacherRaftDetail(sel, w) + "</div>" +
      "</div>";
  }

  function teacherRaftDetail(s, w) {
    const v = w || {};
    const cards = RAFT_FIELDS.map(function (fd) {
      return '<div class="raft-card is-read"><span class="raft-head"><span class="raft-letter">' + fd.letter + "</span>" +
        '<span class="raft-name"><strong>' + fd.ko + "</strong><small>" + fd.en + "</small></span></span>" +
        '<span class="raft-value' + (v[fd.key] ? "" : " is-empty") + '">' + esc(v[fd.key] || "아직 쓰지 않았어요") + "</span></div>";
    }).join("");
    const comments = w ? commentsFor(w.id) : [];
    return (
      '<div class="detail-head"><h2>' + esc(s.name) + '</h2><span class="pill">' + esc(s.sid) + "</span>" +
        '<span class="pill pill-accent">' + raftFilled(v) + " / 4칸, 글 " + (v.text ? v.text.length : 0) + "자</span>" +
        (w ? '<span class="detail-time">' + esc(timeLabel(w.updatedAt)) + " 제출</span>" : "") + "</div>" +
      '<p class="frame">' + frameHtml(v) + "</p>" +
      '<div class="raft-grid">' + cards + "</div>" +
      '<div class="write-card is-read"><div class="write-head"><strong>' + icon("fa-pen-nib") + " 글쓰기</strong></div>" +
        (v.text ? '<div class="post-text">' + textHtml(v.text) + "</div>" : '<p class="raft-value is-empty">아직 쓰지 않았어요</p>') +
      "</div>" +
      (w ? '<div class="comments teacher-comments"><p class="comments-title">' + icon("fa-comment") + " 친구들의 소감 " + comments.length + "개</p>" +
        (comments.length ? comments.map(function (c) {
          return '<div class="comment"><strong>' + esc(c.name) + "</strong><span>" + esc(c.text) + "</span><small>" + esc(timeLabel(c.createdAt)) + "</small></div>";
        }).join("") : '<p class="raft-value is-empty">아직 소감이 없어요</p>') + "</div>" : "")
    );
  }

  /* =========================================================
     14. 낱말 구름 엔진 (아르키메데스 나선 + 겹침 검사)
     ========================================================= */
  const measureCtx = document.createElement("canvas").getContext("2d");
  const fontsReady = (function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(["500", "700", "800"].map(function (w) { return document.fonts.load(w + ' 24px "Pretendard"'); }))
      .catch(function () {}).then(function () { return document.fonts.ready; });
  })();

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function computeCloudLayout(words, W, H, seed) {
    const maxCount = words[0].count;
    const minCount = words[words.length - 1].count;
    const base = Math.min(W, H * 1.6);
    const maxFont = clamp(base / 8, 26, ui.presenting ? 170 : 70);
    const minFont = clamp(base / 42, 12, ui.presenting ? 32 : 18);
    const PAD = 3;
    const cx = W / 2, cy = H / 2;
    const stretchX = clamp(W / H, 1, 2.2);
    const placed = [];
    const result = [];

    // r = b × θ 나선을 따라 중심부터 돌며 겹치지 않는 첫 자리를 찾습니다
    function findSpot(bw, bh, index) {
      const phase = index * 2.399963 + seed;
      const limit = Math.max(W, H);
      let theta = 0;
      while (true) {
        const r = 1.8 * theta;
        if (r > limit) return null;
        const x = cx + r * stretchX * Math.cos(theta + phase) - bw / 2;
        const y = cy + r * Math.sin(theta + phase) - bh / 2;
        if (x >= 0 && y >= 0 && x + bw <= W && y + bh <= H) {
          const box = { x: x, y: y, w: bw, h: bh };
          if (!placed.some(function (p) { return intersects(p, box); })) return box;
        }
        theta += Math.min(0.35, 3.5 / (r + 1));
      }
    }

    words.forEach(function (w, i) {
      const isTop = i < 5;
      const ratio = maxCount === minCount ? 0.4 : (w.count - minCount) / (maxCount - minCount);
      let size = minFont + Math.pow(ratio, 0.8) * (maxFont - minFont);
      if (isTop) size = Math.max(size * 1.08, minFont + (maxFont - minFont) * (0.9 - i * 0.12));
      const weight = i === 0 ? 800 : isTop ? 700 : 500;
      for (let attempt = 0; attempt < 4; attempt++) {
        measureCtx.font = weight + " " + size + "px " + FONT_STACK;
        const tw = Math.ceil(measureCtx.measureText(w.text).width);
        const th = Math.ceil(size * 1.15);
        const box = findSpot(tw + PAD * 2, th + PAD * 2, i);
        if (box) {
          placed.push(box);
          result.push({ text: w.text, count: w.count, rank: i, size: size, weight: weight, x: box.x + PAD, y: box.y + PAD, h: th,
            color: isTop ? TOP_COLORS[i] : CONSONANT_COLORS[w.consonant][1] });
          return;
        }
        size *= 0.8;
      }
    });
    return result;
  }

  function currentAgg() {
    return aggregate(state.words.filter(inFilter(currentFilter(filterOptions()))));
  }

  function drawCloud(agg) {
    const stage = document.getElementById("cloud-stage");
    if (!stage || !stage.clientWidth || !agg.length) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const layout = computeCloudLayout(agg, W, H, ui.cloudSeed);
    ui.lastCloud = { layout: layout, W: W, H: H };
    stage.innerHTML = layout.map(function (it, i) {
      return '<button type="button" class="cloud-word' + (it.rank < 5 ? " is-top" : "") + '" data-action="show-word" data-word="' + esc(it.text) + '"' +
        ' title="' + esc(it.text) + " (" + it.count + '명)" style="left:' + it.x.toFixed(1) + "px;top:" + it.y.toFixed(1) + "px;font-size:" + it.size.toFixed(1) +
        "px;line-height:" + it.h + "px;height:" + it.h + "px;font-weight:" + it.weight + ";color:" + it.color + ";animation-delay:" + i * 30 + 'ms">' +
        esc(it.text) + "</button>";
    }).join("");
  }

  // 이미지 저장: 마지막 배치를 캔버스에 다시 그려 PNG로
  function saveCloudImage() {
    const c = ui.lastCloud;
    const f = currentFilter(filterOptions());
    if (!c || !f) return;
    const scale = 2, headH = 96, W = c.W, H = c.H;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = (H + headH) * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#FAF8FD";
    ctx.fillRect(0, 0, W, H + headH);
    const g = ctx.createRadialGradient(W / 2, headH + H / 2, 0, W / 2, headH + H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "#FFFEFF");
    g.addColorStop(0.65, "#F5F0FB");
    g.addColorStop(1, "#ECE4F7");
    ctx.fillStyle = g;
    ctx.fillRect(0, headH, W, H);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#6D4AA8";
    ctx.font = "700 15px " + FONT_STACK;
    ctx.fillText(clsLabel(f.cls) + " " + WORDS_TITLE, 28, 40);
    ctx.fillStyle = "#2B2535";
    ctx.font = "800 28px " + FONT_STACK;
    ctx.fillText("『" + f.book + "』", 26, 76);
    ctx.textAlign = "right";
    ctx.fillStyle = "#776E86";
    ctx.font = "500 14px " + FONT_STACK;
    ctx.fillText(new Date().toLocaleDateString("ko-KR"), W - 28, 76);
    ctx.textAlign = "left";

    ctx.textBaseline = "middle";
    c.layout.forEach(function (it) {
      ctx.font = it.weight + " " + it.size + "px " + FONT_STACK;
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, it.x, headH + it.y + it.h / 2);
    });

    const name = ("낱말구름_" + f.book + "_" + clsLabel(f.cls)).replace(/[\\/:*?"<>|\s]+/g, "_") + ".png";
    canvas.toBlob(function (blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      showToast("낱말 구름 이미지를 저장했어요.", "success");
    }, "image/png");
  }

  // 전체 화면(전자칠판) 모드
  function setPresenting(on, silent) {
    ui.presenting = on;
    document.body.classList.toggle("presenting", on);
    const el = document.documentElement;
    if (on && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(function () {});
    else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (on) { ui.teacherActivity = "words"; ui.teacherTab = "cloud"; }
    if (!silent) renderTeacher();
  }

  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && ui.presenting) setPresenting(false);
  });

  /* =========================================================
     15. 낱말 모달
     ========================================================= */
  let lastFocus = null;

  function openWordModal(text) {
    const agg = currentAgg();
    const item = agg.find(function (a) { return a.text === text; });
    if (!item) return;
    const c = item.consonant;
    const siblings = agg.filter(function (a) { return a.consonant === c; });
    if (!modalRoot.firstChild) lastFocus = document.activeElement;

    modalRoot.innerHTML =
      '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" style="' + colorVars(c) + '">' +
        '<button type="button" class="modal-close" aria-label="닫기">' + icon("fa-xmark") + "</button>" +
        '<div class="modal-head"><span class="modal-letter">' + c + '</span><h2 id="modal-title">' + esc(item.text) + "</h2></div>" +
        '<p class="modal-meta">' + icon("fa-user-group") + " " + item.count + "명이 적었어요</p>" +
        '<p class="modal-names">' + esc(item.names.join(", ")) + "</p>" +
        '<p class="modal-sub">같은 자음(' + c + ")으로 시작하는 낱말</p>" +
        '<div class="chip-list">' +
          siblings.map(function (s) {
            return '<button type="button" class="chip chip-btn' + (s.text === item.text ? " is-active" : "") + '" data-word="' + esc(s.text) + '">' +
              esc(s.text) + (s.count > 1 ? '<span class="chip-count">' + s.count + "</span>" : "") + "</button>";
          }).join("") +
        "</div>" +
      "</div></div>";
    document.body.classList.add("modal-open");
    modalRoot.querySelector(".modal-close").focus();
  }

  function closeModal() {
    if (!modalRoot.firstChild) return;
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  modalRoot.addEventListener("click", function (e) {
    const chip = e.target.closest("[data-word]");
    if (chip) { openWordModal(chip.dataset.word); return; }
    if (e.target.classList.contains("modal-backdrop") || e.target.closest(".modal-close")) closeModal();
  });

  /* =========================================================
     16. 이벤트
     ========================================================= */
  root.addEventListener("submit", function (e) {
    e.preventDefault();
    const form = e.target;
    if (form.id === "login-form") { handleLogin(form); return; }
    if (form.classList.contains("comment-form")) { addComment(form.dataset.writing, form.querySelector("input")); return; }
    if (form.id === "word-form") {
      const input = form.querySelector("input");
      const res = addWord(input.value);
      if (res.ok) {
        input.value = "";
        renderBoard();
        flashCell(res.word.consonant);
        setHint("‘" + res.word.text + "’ 채웠어요. " + INPUT_GUIDE, "");
      } else {
        setHint(res.message, "error");
        input.select();
      }
      input.focus();
    }
  });

  root.addEventListener("input", function (e) {
    const t = e.target;
    if (t.id === "word-input") {
      const v = t.value;
      if (/\s|,/.test(v.trim())) setHint("띄어쓰기 없이 한 단어씩 입력해 주세요.", "error");
      else if (v.trim() && !getInitialConsonant(v)) setHint("한글로 시작하는 낱말을 적어 주세요.", "error");
      else setHint(INPUT_GUIDE, "");
    }
    if (t.id === "login-sid" && t.value.length === 5) document.getElementById("login-name").focus();
    if (t.hasAttribute && t.hasAttribute("data-raft")) { updateRaftStatus(); saveDraftSoon(); }
  });

  root.addEventListener("change", function (e) {
    if (e.target.id === "filter-select") {
      ui.filter = e.target.value;
      ui.selectedSid = null;
      renderTeacher();
    }
  });

  root.addEventListener("click", function (e) {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el)) return;

    switch (el.dataset.action) {
      case "student-tab":
        ui.studentTab = el.dataset.tab;
        writeLocal(TAB_KEY, ui.studentTab);
        renderStudentShell();
        window.scrollTo(0, 0);
        break;
      case "remove-word": removeWord(el.dataset.id); break;
      case "logout":
        me = null;
        writeLocal(ME_KEY, null);
        renderLogin();
        break;
      case "pick-format": {
        const input = document.getElementById("raft-format");
        input.value = el.dataset.value;
        updateRaftStatus();
        saveDraftSoon();
        break;
      }
      case "insert-word":
        insertAtCursor(document.getElementById("raft-text"), el.dataset.word);
        updateRaftStatus();
        saveDraftSoon();
        break;
      case "submit-writing": submitWriting(); break;
      case "toggle-text":
        ui.openText[el.dataset.id] = !ui.openText[el.dataset.id];
        renderFriends();
        break;
      case "delete-comment": removeComment(el.dataset.id); break;
      case "teacher-activity":
        ui.teacherActivity = el.dataset.activity;
        ui.selectedSid = null;
        renderTeacher();
        break;
      case "tab": ui.teacherTab = el.dataset.tab; renderTeacher(); break;
      case "select-student": ui.selectedSid = el.dataset.sid; renderTeacher(); break;
      case "show-word": openWordModal(el.dataset.word); break;
      case "redraw-cloud":
        ui.cloudSeed = Math.random() * Math.PI * 2;
        drawCloud(currentAgg());
        break;
      case "save-image": saveCloudImage(); break;
      case "present": setPresenting(true); break;
      case "exit-present": setPresenting(false); break;
      case "refresh-sheet":
        el.disabled = true;
        refresh().then(function () { renderTeacher(); showToast("최신 내용을 불러왔어요.", "success"); })
          .catch(function (err) { el.disabled = false; showToast("불러오지 못했어요. " + err.message, "error"); });
        break;
      case "retry-load": loadFromSheet(); break;
      case "clear-local":
        if (window.confirm("이 브라우저에 저장된 낱말, 글, 소감을 모두 지울까요?")) {
          state = normalize(null);
          saveState();
          renderTeacher();
        }
        break;
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (modalRoot.firstChild) closeModal();
    else if (ui.presenting) setPresenting(false);
  });

  // 연습 모드: 같은 컴퓨터의 다른 탭에서 입력하면 바로 반영
  window.addEventListener("storage", function (e) {
    if (useSheet || e.key !== STORAGE_KEY) return;
    state = normalize(readLocal(STORAGE_KEY));
    if (currentRoute() === "teacher") renderTeacher();
    else if (me && document.getElementById("student-panel")) refreshStudentPanel();
  });

  let resizeTimer = null;
  let lastSize = window.innerWidth + "x" + window.innerHeight;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      const size = window.innerWidth + "x" + window.innerHeight;
      if (size === lastSize) return;
      lastSize = size;
      if (currentRoute() === "teacher" && ui.teacherActivity === "words" && ui.teacherTab === "cloud") drawCloud(currentAgg());
    }, 200);
  });

  /* =========================================================
     17. 화면 전환 (#student / #teacher)
     ========================================================= */
  function currentRoute() {
    return location.hash === "#teacher" ? "teacher" : "student";
  }

  function render() {
    const route = currentRoute();
    document.querySelectorAll(".role-nav a").forEach(function (a) {
      const on = a.dataset.route === route;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (!ready) return;
    if (route === "teacher") renderTeacher();
    else renderStudent();
  }

  window.addEventListener("hashchange", function () {
    closeModal();
    if (ui.presenting) setPresenting(false, true);
    render();
    window.scrollTo(0, 0);
    if (useSheet && ready) {
      refresh().then(function (changed) {
        if (!changed || modalRoot.firstChild) return;
        if (currentRoute() === "teacher") renderTeacher();
        else if (me && document.getElementById("student-panel")) refreshStudentPanel();
      }).catch(function () {});
    }
  });

  function loadFromSheet() {
    root.innerHTML = '<div class="notice-card"><span class="spinner" aria-hidden="true"></span><h2>불러오는 중이에요</h2><p>잠시만 기다려 주세요.</p></div>';
    refresh()
      .then(function () { ready = true; render(); startPolling(); })
      .catch(function (err) {
        root.innerHTML = noticeHtml("fa-plug-circle-xmark", "시트에 연결하지 못했어요",
          badSheetUrl
            ? "config.js의 sheetUrl에 https://script.google.com/macros/s/.../exec 형식의 주소를 넣어 주세요. Apps Script의 배포 > 배포 관리에서 웹 앱 URL을 복사하면 됩니다."
            : "config.js의 sheetUrl 주소와 웹 앱 액세스 권한(모든 사용자)을 확인해 주세요. (" + err.message + ")", true);
      });
  }

  function init() {
    console.log("book-class 앱이 준비되었습니다" + (useSheet ? " (구글 시트 연결 모드)" : " (연습 모드: 이 브라우저에만 저장)"));
    if (useSheet) loadFromSheet();
    else render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
