(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const STORE = "waqti_v1";
  const CONFIG = "waqti_supabase_config";
  const defaults = { name: "ياسين", tasks: [], focusMinutes: 0, rooms: [], currentRoom: null };
  let state = loadState();
  let currentPage = "home";
  let taskFilter = "all";
  let timer = { total: 1500, left: 1500, active: false, interval: null };
  let supabase = null, userId = null, onlineRoom = null, channel = null;
  let onlineData = { room: null, members: [], tasks: [], completions: [] };

  const categories = {
    study: { label: "دراسة", color: "#8978e9" },
    work: { label: "عمل", color: "#49bda4" },
    personal: { label: "شخصي", color: "#e5ad55" },
    health: { label: "صحة", color: "#e18b9a" },
    other: { label: "أخرى", color: "#82a5cf" }
  };
  const priorities = { high: "عالية", normal: "متوسطة", low: "منخفضة" };

  function loadState() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE) || "{}")); }
    catch (_) { return Object.assign({}, defaults); }
  }
  function persist() {
    localStorage.setItem(STORE, JSON.stringify(state));
    renderAll();
  }
  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "w" + Date.now() + Math.random().toString(16).slice(2);
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function notify(message, type) {
    const node = document.createElement("div");
    node.className = "toast " + (type || "");
    node.textContent = message;
    $("#toastRegion").append(node);
    setTimeout(() => node.remove(), 3500);
  }
  function dateLabel(date) {
    return date ? new Date(date + "T12:00:00").toLocaleDateString("ar", { day: "numeric", month: "short" }) : "بدون موعد";
  }
  function page(name) {
    currentPage = name;
    $$(".page").forEach(el => el.classList.toggle("active", el.id === "page-" + name));
    $$(".nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === name));
    const names = { home: "نظرة عامة", tasks: "مهامي", focus: "وضع التركيز", rooms: "غرف التحدّي", settings: "الإعدادات والربط" };
    $("#pageLabel").textContent = names[name] || "وقتي";
    $("#sidebar").classList.remove("open");
    if (name === "settings") {
      $("#settingsName").value = state.name;
      const cfg = getConfig();
      $("#supabaseUrl").value = cfg.url || "";
      $("#supabaseKey").value = cfg.key || "";
    }
    if (name === "rooms") renderRoom();
  }
  function renderAll() {
    const total = state.tasks.length;
    const done = state.tasks.filter(t => t.done).length;
    const ratio = total ? Math.round(done * 100 / total) : 0;
    $("#profileName").textContent = state.name;
    $("#welcomeName").textContent = state.name;
    $("#topAvatar").textContent = (state.name || "و").trim().charAt(0);
    $("#todayDate").textContent = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    $("#statTotal").textContent = total;
    $("#statDone").textContent = done;
    $("#statMinutes").textContent = state.focusMinutes;
    $("#donePercent").textContent = ratio + "% من أهدافك";
    $("#totalBar").style.width = Math.min(total * 10, 100) + "%";
    $("#doneBar").style.width = ratio + "%";
    $("#focusBar").style.width = Math.min(state.focusMinutes / 60 * 100, 100) + "%";
    $("#todayTaskBadge").textContent = total;
    $("#navTaskCount").textContent = state.tasks.filter(t => !t.done).length;
    $("#filterAll").textContent = total;
    $("#focusTotal").textContent = state.focusMinutes;
    renderHomeTasks();
    renderTasks();
    connectionPill();
  }
  function taskRow(t, compact) {
    const category = categories[t.category] || categories.other;
    if (compact) {
      return '<div class="home-task-row"><button class="check-circle ' + (t.done ? "checked" : "") + '" data-task-toggle="' + esc(t.id) + '">✓</button><div class="task-text ' + (t.done ? "done" : "") + '">' + esc(t.title) + '<div class="task-sub">' + dateLabel(t.due) + '</div></div><span class="task-cat"><i class="category-dot" style="background:' + category.color + '"></i>' + category.label + '</span></div>';
    }
    return '<div class="task-table-row"><div class="task-title-cell"><button class="check-circle ' + (t.done ? "checked" : "") + '" data-task-toggle="' + esc(t.id) + '">✓</button><div><strong style="' + (t.done ? "text-decoration:line-through;color:#aeb4c2" : "") + '">' + esc(t.title) + '</strong><small>' + dateLabel(t.due) + (t.description ? " • " + esc(t.description) : "") + '</small></div></div><span class="task-category-tag">' + category.label + '</span><span class="priority-tag ' + esc(t.priority) + '">' + (priorities[t.priority] || "متوسطة") + '</span><span class="status-tag ' + (t.done ? "done" : "") + '">' + (t.done ? "مكتملة" : "قيد الإنجاز") + '</span><div class="task-action-menu"><button data-task-menu="' + esc(t.id) + '">•••</button></div></div>';
  }
  function renderHomeTasks() {
    const open = state.tasks.filter(t => !t.done).slice(0, 4);
    const items = open.concat(state.tasks.filter(t => t.done).slice(0, Math.max(0, 4 - open.length)));
    $("#homeTaskList").innerHTML = items.map(t => taskRow(t, true)).join("");
    $("#homeTaskEmpty").style.display = state.tasks.length ? "none" : "block";
    $("#homeTaskList").style.display = state.tasks.length ? "grid" : "none";
  }
  function renderTasks() {
    const query = ($("#taskSearch").value || "").trim().toLowerCase();
    let rows = state.tasks.filter(t => t.title.toLowerCase().includes(query));
    if (taskFilter === "active") rows = rows.filter(t => !t.done);
    if (taskFilter === "done") rows = rows.filter(t => t.done);
    $("#fullTaskList").innerHTML = rows.map(t => taskRow(t, false)).join("");
    $("#taskEmpty").style.display = rows.length ? "none" : "block";
    $(".task-board").classList.toggle("empty", !rows.length);
  }
  function connectionPill() {
    const isOnline = !!(supabase && userId);
    const pill = $("#connectionStatus");
    pill.className = "connection-pill " + (isOnline ? "online" : "local");
    pill.innerHTML = "<i></i><span>" + (isOnline ? "متصل أونلاين" : "وضع تجريبي محلي") + "</span>";
  }
  function showModal(title, kicker, html, submit) {
    $("#modalTitle").textContent = title;
    $("#modalKicker").textContent = kicker;
    $("#modalBody").innerHTML = html;
    $("#modalBackdrop").hidden = false;
    const form = $("#modalBody form");
    if (form) form.addEventListener("submit", event => {
      event.preventDefault();
      submit(new FormData(form));
    });
  }
  function closeModal() {
    $("#modalBackdrop").hidden = true;
    $("#modalBody").innerHTML = "";
  }
  function taskModal(existing) {
    const t = existing || {};
    const categoryOptions = Object.keys(categories).map(key =>
      '<option value="' + key + '" ' + (t.category === key ? "selected" : "") + '>' + categories[key].label + "</option>").join("");
    const priorityOptions = Object.keys(priorities).map(key =>
      '<option value="' + key + '" ' + (t.priority === key ? "selected" : "") + '>' + priorities[key] + "</option>").join("");
    showModal(existing ? "تعديل المهمة" : "مهمة جديدة", "رتّب يومك", '<form class="modal-form"><div><label>عنوان المهمة *</label><input name="title" required maxlength="90" placeholder="مثلاً: مراجعة درس العلوم" value="' + esc(t.title) + '"></div><div><label>ملاحظات (اختياري)</label><textarea name="description" maxlength="220" placeholder="تفاصيل بسيطة...">' + esc(t.description) + '</textarea></div><div class="form-row"><div><label>التصنيف</label><select name="category">' + categoryOptions + '</select></div><div><label>الأولوية</label><select name="priority">' + priorityOptions + '</select></div></div><div><label>الموعد</label><input type="date" name="due" value="' + esc(t.due) + '"></div><button class="btn btn-primary" type="submit">' + (existing ? "حفظ التعديلات" : "إضافة المهمة") + ' <span>←</span></button></form>', data => {
      const title = String(data.get("title") || "").trim();
      if (!title) return;
      const next = { id: t.id || uid(), title, description: String(data.get("description") || "").trim(), category: data.get("category"), priority: data.get("priority"), due: data.get("due"), done: !!t.done };
      if (existing) state.tasks = state.tasks.map(old => old.id === t.id ? next : old);
      else state.tasks.unshift(next);
      persist(); closeModal(); notify(existing ? "تم تحديث المهمة" : "تمت إضافة المهمة", "success");
    });
  }
  function code() { return "WAQ-" + Math.floor(100000 + Math.random() * 900000); }
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG) || "{}"); } catch (_) { return {}; }
  }

  function renderRoom() {
    const host = $("#roomCurrent");
    if (state.currentRoom && state.currentRoom.mode === "online" && supabase) { renderOnlineRoom(); return; }
    if (!state.currentRoom) {
      host.innerHTML = '<div class="room-empty"><div class="room-empty-icon">♧</div><strong>لا توجد غرفة مفتوحة الآن</strong><p>أنشئ غرفة أو انضم إلى أصدقائك لتبدأ المنافسة.</p></div>';
      return;
    }
    const room = state.rooms.find(r => r.code === state.currentRoom.code);
    if (!room) { state.currentRoom = null; persist(); return; }
    const tasks = room.tasks || [];
    const members = room.members || [];
    const taskHtml = tasks.map(t => '<div class="room-task-item"><button class="check-circle ' + (t.done ? "checked" : "") + '" data-room-toggle="' + esc(t.id) + '">✓</button><strong>' + esc(t.title) + '</strong><small>' + (t.done ? "اكتملت" : "بانتظار الإنجاز") + "</small></div>").join("");
    const memberHtml = members.map((m, i) => '<div class="member-row"><div class="member-avatar">' + esc(m.name.charAt(0)) + '</div><div class="member-info"><strong>' + esc(m.name) + '</strong><small>' + (i === 0 ? "منظّم الغرفة" : "مشارك") + '</small></div><span class="member-score">' + (m.score || 0) + "</span></div>").join("");
    host.innerHTML = '<div class="room-live-head"><div><span class="section-kicker">غرفتك الحالية • وضع محلي</span><h3>' + esc(room.name) + '</h3></div><div class="room-code"><span>' + esc(room.code) + '</span><button data-copy-code="' + esc(room.code) + '">▣</button></div></div><div class="room-live-body"><div><div class="room-tasks-head"><h4>مهام التحدّي (' + tasks.length + ')</h4></div><div class="room-task-list">' + (taskHtml || '<p class="muted">أضيفوا أول مهمة للتحدّي.</p>') + '</div><button class="room-add-task" id="addRoomTaskBtn">＋ أضف مهمة مشتركة</button></div><div class="room-members"><h4>المشاركون (' + members.length + ')</h4>' + memberHtml + '</div></div>';
  }
  function roomCreateModal() {
    showModal("إنشاء غرفة جديدة", "ابدأ تحدّي الأصدقاء", '<form class="modal-form"><div><label>اسم الغرفة</label><input name="roomName" maxlength="40" required placeholder="مثلاً: أبطال المذاكرة"></div><div><label>اسمك داخل الغرفة</label><input name="displayName" maxlength="24" required value="' + esc(state.name) + '"></div><button class="btn btn-primary" type="submit">إنشاء الغرفة <span>←</span></button></form>', async data => {
      const name = String(data.get("roomName") || "").trim();
      const displayName = String(data.get("displayName") || "").trim();
      if (supabase && userId) {
        try {
          const { data: room, error } = await supabase.rpc("create_room", { p_code: code(), p_name: name, p_display_name: displayName });
          if (error) throw error;
          state.currentRoom = { mode: "online", id: room.id, code: room.code, name: room.name };
          onlineRoom = state.currentRoom;
          persist(); closeModal(); await refreshOnlineRoom(); subscribeRoom(); page("rooms");
          notify("تم إنشاء الغرفة المتصلة!", "success"); return;
        } catch (error) { notify("تعذّر إنشاء الغرفة: " + error.message, "error"); return; }
      }
      const roomCode = code();
      state.rooms.push({ code: roomCode, name, members: [{ name: displayName, score: 0 }], tasks: [] });
      state.currentRoom = { mode: "local", code: roomCode };
      persist(); closeModal(); renderRoom();
      notify("أنشأنا غرفة تجريبية. رمزها: " + roomCode, "success");
    });
  }
  async function joinRoom(roomCode) {
    if (supabase && userId) {
      const { data: room, error } = await supabase.rpc("join_room_by_code", { p_code: roomCode, p_display_name: state.name });
      if (error) throw error;
      state.currentRoom = { mode: "online", id: room.id, code: room.code, name: room.name };
      onlineRoom = state.currentRoom;
      persist(); await refreshOnlineRoom(); subscribeRoom(); return;
    }
    const room = state.rooms.find(r => r.code.toUpperCase() === roomCode.toUpperCase());
    if (!room) throw new Error("لم نجد الغرفة في هذا المتصفح. اربط Supabase للانضمام من أجهزة أخرى.");
    if (!room.members.some(m => m.name === state.name)) room.members.push({ name: state.name, score: 0 });
    state.currentRoom = { mode: "local", code: room.code };
    persist();
  }
  async function refreshOnlineRoom() {
    if (!supabase || !onlineRoom || !onlineRoom.id) return;
    const results = await Promise.all([
      supabase.from("rooms").select("*").eq("id", onlineRoom.id).single(),
      supabase.from("room_members").select("*").eq("room_id", onlineRoom.id).order("joined_at"),
      supabase.from("room_tasks").select("*").eq("room_id", onlineRoom.id).order("created_at"),
      supabase.from("task_completions").select("*").eq("room_id", onlineRoom.id)
    ]);
    for (const result of results) if (result.error) throw result.error;
    onlineData = { room: results[0].data, members: results[1].data, tasks: results[2].data, completions: results[3].data };
    state.currentRoom.name = onlineData.room.name;
    renderOnlineRoom();
  }
  function renderOnlineRoom() {
    if (!onlineData.room) return;
    const d = onlineData;
    const taskHtml = d.tasks.map(t => {
      const mine = d.completions.some(c => c.task_id === t.id && c.user_id === userId);
      const count = d.completions.filter(c => c.task_id === t.id).length;
      return '<div class="room-task-item"><button class="check-circle ' + (mine ? "checked" : "") + '" data-online-toggle="' + esc(t.id) + '">✓</button><strong>' + esc(t.title) + '</strong><small>' + count + "/" + d.members.length + " أنجزوها</small></div>";
    }).join("");
    const members = [...d.members].map(m => Object.assign({}, m, { score: d.completions.filter(c => c.user_id === m.user_id).length }))
      .sort((a, b) => b.score - a.score)
      .map(m => '<div class="member-row"><div class="member-avatar">' + esc(m.display_name.charAt(0)) + '</div><div class="member-info"><strong>' + esc(m.display_name) + (m.user_id === userId ? " (أنت)" : "") + '</strong><small>' + (m.user_id === d.room.owner_id ? "منظّم الغرفة" : "مشارك") + '</small></div><span class="member-score">' + m.score + "</span></div>").join("");
    $("#roomCurrent").innerHTML = '<div class="room-live-head"><div><span class="section-kicker">غرفتك الحالية • متصل أونلاين</span><h3>' + esc(d.room.name) + '</h3></div><div class="room-code"><span>' + esc(d.room.code) + '</span><button data-copy-code="' + esc(d.room.code) + '">▣</button></div></div><div class="room-live-body"><div><div class="room-tasks-head"><h4>مهام التحدّي (' + d.tasks.length + ')</h4></div><div class="room-task-list">' + (taskHtml || '<p class="muted">أضيفوا أول مهمة للتحدّي.</p>') + '</div><button class="room-add-task" id="addRoomTaskBtn">＋ أضف مهمة مشتركة</button></div><div class="room-members"><h4>المشاركون (' + d.members.length + ')</h4>' + members + '</div></div>';
  }
  function subscribeRoom() {
    if (!supabase || !onlineRoom) return;
    if (channel) supabase.removeChannel(channel);
    channel = supabase.channel("waqti-room-" + onlineRoom.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: "room_id=eq." + onlineRoom.id }, refreshOnlineRoom)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_tasks", filter: "room_id=eq." + onlineRoom.id }, refreshOnlineRoom)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_completions", filter: "room_id=eq." + onlineRoom.id }, refreshOnlineRoom)
      .subscribe();
  }
  function addRoomTaskModal() {
    showModal("مهمة للتحدّي", "هدف مشترك للجميع", '<form class="modal-form"><div><label>عنوان المهمة</label><input name="title" required maxlength="90" placeholder="مثلاً: حل 10 مسائل رياضيات"></div><button class="btn btn-primary" type="submit">إضافة للغرفة <span>←</span></button></form>', async data => {
      const title = String(data.get("title") || "").trim();
      try {
        if (state.currentRoom.mode === "online" && supabase) {
          const { error } = await supabase.from("room_tasks").insert({ room_id: onlineRoom.id, title, created_by: userId });
          if (error) throw error;
          await refreshOnlineRoom();
        } else {
          const room = state.rooms.find(r => r.code === state.currentRoom.code);
          room.tasks.push({ id: uid(), title, done: false });
          persist(); renderRoom();
        }
        closeModal(); notify("تمت إضافة المهمة المشتركة", "success");
      } catch (error) { notify("تعذرت إضافة المهمة: " + error.message, "error"); }
    });
  }
  async function toggleOnlineTask(taskId) {
    const exists = onlineData.completions.some(c => c.task_id === taskId && c.user_id === userId);
    const result = exists
      ? await supabase.from("task_completions").delete().eq("task_id", taskId).eq("user_id", userId)
      : await supabase.from("task_completions").insert({ task_id: taskId, room_id: onlineRoom.id, user_id: userId });
    if (result.error) notify("تعذر تحديث الإنجاز: " + result.error.message, "error");
    else await refreshOnlineRoom();
  }
  async function connectSupabase(url, key) {
    if (!url || !key) throw new Error("أدخل رابط المشروع والمفتاح العام أولاً.");
    if (!/^https:\/\/.+\.supabase\.co$/.test(url.trim())) throw new Error("رابط المشروع غير صحيح.");
    const sdk = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = sdk.createClient(url.trim(), key.trim(), { auth: { persistSession: true, autoRefreshToken: true } });
    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data.session) {
      const authResult = await supabase.auth.signInAnonymously();
      if (authResult.error) throw authResult.error;
    }
    const current = await supabase.auth.getSession();
    userId = current.data.session.user.id;
    localStorage.setItem(CONFIG, JSON.stringify({ url: url.trim(), key: key.trim() }));
    connectionPill();
    $("#connectionHelp").textContent = "تم الاتصال. أنشئ غرفة أو انضم باستخدام رمز صديقك.";
    notify("تم الاتصال بالخدمة بنجاح", "success");
  }
  async function initializeConnection() {
    const cfg = getConfig();
    if (!cfg.url || !cfg.key) return;
    try {
      await connectSupabase(cfg.url, cfg.key);
      if (state.currentRoom && state.currentRoom.mode === "online") {
        onlineRoom = state.currentRoom;
        await refreshOnlineRoom();
        subscribeRoom();
      }
    } catch (error) {
      supabase = null; userId = null; connectionPill();
      $("#connectionHelp").textContent = "لم يكتمل الاتصال: " + error.message + " — راجع إعداد Supabase.";
    }
  }
  function updateTimer() {
    const mins = Math.floor(timer.left / 60), secs = timer.left % 60;
    $("#timerDisplay").textContent = String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    $("#timerProgress").style.strokeDashoffset = String(829.38 * (1 - timer.left / timer.total));
    $("#timerStart").innerHTML = timer.active ? 'إيقاف مؤقت <span>Ⅱ</span>' : 'ابدأ التركيز <span>▶</span>';
    $("#timerHint").textContent = timer.active ? "أنت في جلسة تركيز رائعة" : "كل تركيز يقربك من هدفك";
  }
  function toggleTimer() {
    if (timer.active) {
      clearInterval(timer.interval); timer.active = false;
      $("#timerMessage").textContent = "توقفت مؤقتاً. أكمل عندما تكون جاهزاً.";
      updateTimer(); return;
    }
    if (timer.left <= 0) timer.left = timer.total;
    timer.active = true; updateTimer();
    $("#timerMessage").textContent = "ممتاز! ركّز على مهمتك الحالية.";
    timer.interval = setInterval(() => {
      timer.left--; updateTimer();
      if (timer.left <= 0) {
        clearInterval(timer.interval); timer.active = false;
        state.focusMinutes += Math.round(timer.total / 60);
        persist(); $("#timerMessage").textContent = "أحسنت! اكتملت جلسة التركيز. خذ استراحة قصيرة.";
        notify("أحسنت! اكتملت جلسة التركيز 🎉", "success"); updateTimer();
      }
    }, 1000);
  }
  function resetTimer() {
    clearInterval(timer.interval); timer.active = false; timer.left = timer.total;
    updateTimer(); $("#timerMessage").textContent = "تمت إعادة ضبط المؤقّت. جاهز لجولة جديدة؟";
  }

  function bindEvents() {
    $$("[data-page]").forEach(btn => btn.addEventListener("click", () => page(btn.dataset.page)));
    $$("[data-goto]").forEach(btn => btn.addEventListener("click", () => page(btn.dataset.goto)));
    $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    ["quickAddBtn", "addTaskBtn", "emptyAddBtn", "taskEmptyAdd"].forEach(id => $("#" + id).addEventListener("click", () => taskModal()));
    $("#editNameBtn").addEventListener("click", () => page("settings"));
    $("#saveNameBtn").addEventListener("click", () => {
      const name = $("#settingsName").value.trim();
      if (!name) return notify("اكتب اسماً أولاً", "error");
      state.name = name; persist(); notify("تم حفظ الاسم", "success");
    });
    $("#taskFilters").addEventListener("click", event => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      taskFilter = button.dataset.filter;
      $$(".filter-tab").forEach(tab => tab.classList.toggle("active", tab === button));
      renderTasks();
    });
    $("#taskSearch").addEventListener("input", renderTasks);
    document.addEventListener("click", event => {
      const toggle = event.target.closest("[data-task-toggle]");
      if (toggle) {
        const task = state.tasks.find(t => t.id === toggle.dataset.taskToggle);
        if (task) { task.done = !task.done; persist(); }
        return;
      }
      const menu = event.target.closest("[data-task-menu]");
      if (menu) {
        const task = state.tasks.find(t => t.id === menu.dataset.taskMenu);
        showModal("خيارات المهمة", "إدارة المهمة", '<div class="modal-form"><button class="btn btn-soft" id="editCurrentTask">تعديل المهمة</button><button class="btn btn-danger-soft" id="deleteCurrentTask">حذف المهمة</button></div>', () => {});
        $("#editCurrentTask").onclick = () => { closeModal(); taskModal(task); };
        $("#deleteCurrentTask").onclick = () => {
          state.tasks = state.tasks.filter(t => t.id !== task.id);
          persist(); closeModal(); notify("تم حذف المهمة");
        };
        return;
      }
      const copy = event.target.closest("[data-copy-code]");
      if (copy) {
        const value = copy.dataset.copyCode;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(() => notify("تم نسخ رمز الغرفة", "success")).catch(() => notify("رمز الغرفة: " + value));
        else notify("رمز الغرفة: " + value);
        return;
      }
      const localToggle = event.target.closest("[data-room-toggle]");
      if (localToggle) {
        const room = state.rooms.find(r => r.code === state.currentRoom.code);
        const task = room && room.tasks.find(t => t.id === localToggle.dataset.roomToggle);
        if (task) { task.done = !task.done; room.members[0].score = room.tasks.filter(t => t.done).length; persist(); renderRoom(); }
        return;
      }
      const onlineToggle = event.target.closest("[data-online-toggle]");
      if (onlineToggle) { toggleOnlineTask(onlineToggle.dataset.onlineToggle).catch(e => notify(e.message, "error")); return; }
      if (event.target.closest("#addRoomTaskBtn")) addRoomTaskModal();
      if (event.target.id === "confirmClear") {
        localStorage.removeItem(STORE); state = Object.assign({}, defaults);
        closeModal(); persist(); notify("تم مسح بيانات هذا الجهاز");
      }
    });
    $("#modalClose").addEventListener("click", closeModal);
    $("#modalBackdrop").addEventListener("click", event => { if (event.target === $("#modalBackdrop")) closeModal(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
    $("#createRoomBtn").addEventListener("click", roomCreateModal);
    $("#joinRoomBtn").addEventListener("click", async () => {
      const roomCode = $("#joinCodeInput").value.trim().toUpperCase();
      if (!roomCode) return notify("اكتب رمز الغرفة أولاً", "error");
      try {
        await joinRoom(roomCode); $("#joinCodeInput").value = ""; renderRoom();
        notify("تم الانضمام إلى الغرفة", "success");
      } catch (error) { notify(error.message, "error"); }
    });
    $("#joinCodeInput").addEventListener("keydown", event => { if (event.key === "Enter") $("#joinRoomBtn").click(); });
    $("#timerStart").addEventListener("click", toggleTimer);
    $("#timerReset").addEventListener("click", resetTimer);
    $$(".preset").forEach(button => button.addEventListener("click", () => {
      if (timer.active) return notify("أوقف الجلسة أولاً لتغيير المدة");
      $$(".preset").forEach(el => el.classList.toggle("active", el === button));
      timer.total = Number(button.dataset.minutes) * 60;
      timer.left = timer.total; updateTimer();
    }));
    $("#connectBtn").addEventListener("click", async () => {
      const button = $("#connectBtn");
      button.disabled = true; button.textContent = "جارٍ الاتصال...";
      try { await connectSupabase($("#supabaseUrl").value, $("#supabaseKey").value); }
      catch (error) { notify(error.message, "error"); $("#connectionHelp").textContent = "تعذر الاتصال: " + error.message; }
      finally { button.disabled = false; button.textContent = "حفظ والاتصال"; }
    });
    $("#disconnectBtn").addEventListener("click", async () => {
      if (channel && supabase) await supabase.removeChannel(channel);
      supabase = null; userId = null; onlineRoom = null; channel = null;
      localStorage.removeItem(CONFIG); state.currentRoom = null; persist();
      $("#connectionHelp").textContent = "تم إلغاء الربط. التطبيق يعمل في الوضع المحلي.";
      notify("تم إلغاء الربط");
    });
    $("#clearDataBtn").addEventListener("click", () => showModal("مسح البيانات", "تأكيد العملية", '<div class="modal-form"><p class="muted">سيتم حذف المهام والإعدادات والغرف المحلية من هذا المتصفح. لا يمكن التراجع عن ذلك.</p><button class="btn btn-danger-soft" id="confirmClear">نعم، امسح بيانات هذا الجهاز</button></div>', () => {}));
  }
  async function start() {
    bindEvents(); renderAll(); updateTimer();
    await initializeConnection();
  }
  start();
})();