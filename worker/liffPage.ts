export function renderLiffPage(liffId: string): string {
  const config = JSON.stringify({ liffId });
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>เมื่อไรจะไปกิน</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f7f7f5; color: #1a1a1a; }
    body { max-width: 560px; margin: 0 auto; padding: 24px 16px 40px; }
    h1 { font-size: 23px; margin: 0 0 8px; } h2 { font-size: 16px; margin: 22px 0 8px; }
    p { line-height: 1.5; } label { display: block; font-weight: 650; }
    input, button { box-sizing: border-box; width: 100%; min-height: 46px; font: inherit; border-radius: 6px; }
    input { border: 1px solid #b8b8b8; padding: 10px 12px; margin: 8px 0; }
    button { border: 0; background: #06c755; color: #fff; font-weight: 700; margin: 6px 0; padding: 10px 12px; }
    button.secondary, button.option { background: #fff; border: 1px solid #b8b8b8; color: #1a1a1a; }
    button.option { min-height: 58px; text-align: left; font-weight: 500; }
    button.option.selected { border-color: #06c755; box-shadow: inset 0 0 0 1px #06c755; }
    button:disabled { opacity: .55; } .hidden { display: none; }
    .muted, #status { color: #595959; } #status { min-height: 24px; white-space: pre-wrap; }
    .option-name { display: block; font-weight: 700; } .option-address { display: block; font-size: 13px; margin-top: 3px; color: #5d5d5d; }
    .selected-list, .remove-list { display: grid; gap: 8px; }
    .selected-row, .remove-row { display: flex; align-items: center; gap: 10px; border: 1px solid #dedede; background: #fff; border-radius: 6px; padding: 10px; }
    .selected-row button { width: 34px; min-height: 34px; margin: 0 0 0 auto; background: #fff; border: 1px solid #b8b8b8; color: #444; padding: 0; }
    .remove-row input { width: 20px; min-height: 20px; margin: 0; accent-color: #06c755; }
    .remove-row label { flex: 1; font-weight: 500; }
  </style>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
</head>
<body>
  <h1>เมื่อไรจะไปกิน</h1>
  <p id="summary">กำลังเปิดเมนู...</p>
  <main id="app" class="hidden">
    <section id="addPanel" class="hidden">
      <label for="name">ชื่อร้านหรืออาหาร</label>
      <input id="name" autocomplete="off" placeholder="เช่น Sushiro">
      <button id="search" type="button">ค้นหาร้านใกล้ฉัน</button>
      <p class="muted">ระบบจะขอใช้ตำแหน่งเพื่อแนะนำร้านและสาขาใกล้คุณ</p>
      <section id="candidates"></section>
      <section id="selectedPanel" class="hidden">
        <h2>รายการที่เลือก</h2>
        <div id="selected" class="selected-list"></div>
        <button id="saveAdd" type="button">เพิ่มรายการที่เลือก</button>
      </section>
    </section>
    <section id="removePanel" class="hidden">
      <div id="removeList" class="remove-list"></div>
      <button id="saveRemove" type="button">ลดรายการที่เลือก</button>
    </section>
    <section id="legacyMapPanel" class="hidden">
      <button id="searchLegacyMap" type="button">ค้นหาสาขาใกล้ฉัน</button>
      <section id="legacyCandidates"></section>
    </section>
    <button id="showList" type="button" class="hidden">แสดงรายการ</button>
  </main>
  <p id="status"></p>
  <script>
    const config = ${config};
    let sessionId;
    let session;
    let currentPosition;
    let searchInFlight = false;
    const selectedCandidates = new Map();
    const selectedItemIds = new Set();
    const recentSearches = new Map();
    const duplicateSearchWindowMs = 15000;
    const app = document.querySelector("#app");
    const summary = document.querySelector("#summary");
    const status = document.querySelector("#status");
    const addPanel = document.querySelector("#addPanel");
    const removePanel = document.querySelector("#removePanel");
    const legacyMapPanel = document.querySelector("#legacyMapPanel");
    const nameInput = document.querySelector("#name");
    const searchButton = document.querySelector("#search");
    const candidates = document.querySelector("#candidates");
    const selectedPanel = document.querySelector("#selectedPanel");
    const selected = document.querySelector("#selected");
    const saveAdd = document.querySelector("#saveAdd");
    const removeList = document.querySelector("#removeList");
    const saveRemove = document.querySelector("#saveRemove");
    const legacyCandidates = document.querySelector("#legacyCandidates");
    const legacySearchButton = document.querySelector("#searchLegacyMap");
    const showList = document.querySelector("#showList");

    function setStatus(value) { status.textContent = value; }
    function userFacingError(code) {
      if (code === "google_quota_reached") return "โควต้าค้นหาสถานที่วันนี้เต็มแล้ว ลองใหม่พรุ่งนี้";
      if (code === "map_search_rate_limited") return "กรุณารอ 15 วินาทีก่อนค้นหาอีกครั้ง";
      if (code === "query_too_long") return "ชื่อร้านหรืออาหารยาวเกินไป";
      if (code === "maintenance_mode") return "ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง";
      if (code === "restaurant_not_found") return "ไม่เจอร้านนี้ในรายการของแชตนี้";
      if (code === "session_owned_by_another_user") return "เมนชัน @เมื่อไรจะไปกิน เพื่อเปิดเมนูของคุณเอง";
      if (code === "invalid_or_expired_session") return "ขั้นตอนนี้หมดอายุแล้ว กรุณาเริ่มใหม่";
      if (code === "invalid_or_expired_candidate") return "ตัวเลือกสาขาหมดอายุแล้ว กรุณาเริ่มใหม่";
      if (code === "candidate_required") return "เลือกร้านอย่างน้อยหนึ่งรายการ";
      if (code === "item_required") return "เลือกรายการที่ต้องการลด";
      return "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
    }
    async function api(path, options = {}) {
      const token = liff.getAccessToken();
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(options.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(userFacingError(body.error));
      return body;
    }
    function requestLocation() {
      if (currentPosition) return Promise.resolve(currentPosition);
      if (!navigator.geolocation) return Promise.reject(new Error("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง"));
      return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        (position) => { currentPosition = { latitude: position.coords.latitude, longitude: position.coords.longitude }; resolve(currentPosition); },
        () => reject(new Error("ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง")),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      ));
    }
    function requestLocationEarly() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (position) => { currentPosition = { latitude: position.coords.latitude, longitude: position.coords.longitude }; },
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    }
    function candidateButton(candidate, selectedState, onClick) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "option" + (selectedState ? " selected" : "");
      const name = document.createElement("span"); name.className = "option-name"; name.textContent = (selectedState ? "✓ " : "") + candidate.name;
      const address = document.createElement("span"); address.className = "option-address"; address.textContent = candidate.address || "";
      button.append(name, address); button.onclick = onClick;
      return button;
    }
    function renderCandidates(results) {
      candidates.replaceChildren(...results.map((candidate) => candidateButton(candidate, selectedCandidates.has(candidate.id), () => {
        if (selectedCandidates.has(candidate.id)) selectedCandidates.delete(candidate.id); else selectedCandidates.set(candidate.id, candidate);
        renderCandidates(results); renderSelected();
      })));
    }
    function renderSelected() {
      const entries = [...selectedCandidates.values()];
      selectedPanel.classList.toggle("hidden", entries.length === 0);
      saveAdd.textContent = "เพิ่ม " + entries.length + " รายการ";
      selected.replaceChildren(...entries.map((candidate) => {
        const row = document.createElement("div"); row.className = "selected-row";
        const text = document.createElement("div"); text.textContent = candidate.name + (candidate.address ? "\\n" + candidate.address : "");
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "เอาออก");
        remove.onclick = () => { selectedCandidates.delete(candidate.id); renderSelected(); };
        row.append(text, remove); return row;
      }));
    }
    function renderRemoveList(items) {
      removeList.replaceChildren(...items.map((item) => {
        const row = document.createElement("div"); row.className = "remove-row";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.id = "item-" + item.id;
        const label = document.createElement("label"); label.htmlFor = checkbox.id; label.textContent = item.name;
        checkbox.onchange = () => { if (checkbox.checked) selectedItemIds.add(item.id); else selectedItemIds.delete(item.id); saveRemove.textContent = "ลด " + selectedItemIds.size + " รายการ"; };
        row.append(checkbox, label); return row;
      }));
      saveRemove.textContent = "ลด 0 รายการ";
    }
    function searchKey(query, position) {
      return [query || session.itemName || "", position.latitude.toFixed(3), position.longitude.toFixed(3)].join("|").toLocaleLowerCase();
    }
    async function searchNearby(query, destination, selectResults, button) {
      if (searchInFlight) { setStatus("กำลังค้นหาร้านอยู่"); return; }
      searchInFlight = true;
      button.disabled = true;
      try {
        const position = await requestLocation();
        const key = searchKey(query, position);
        const previousSearch = recentSearches.get(key);
        if (previousSearch && Date.now() - previousSearch < duplicateSearchWindowMs) {
          setStatus("เพิ่งค้นหาคำนี้ในบริเวณนี้ ลองใหม่ได้ในอีกสักครู่");
          return;
        }
        recentSearches.set(key, Date.now());
        setStatus("กำลังค้นหาร้านใกล้คุณ...");
        const result = await api("/api/liff/map-search", { method: "POST", body: JSON.stringify({ sessionId, query, latitude: position.latitude, longitude: position.longitude }) });
        if (result.candidates.length === 0) { destination.replaceChildren(); setStatus("ไม่พบร้านใกล้ตำแหน่งนี้"); return; }
        selectResults(result.candidates); setStatus("แตะเพื่อเลือกร้านที่ต้องการ");
      } catch (error) { setStatus(error.message); }
      finally { searchInFlight = false; button.disabled = false; }
    }
    async function complete(payload, button) {
      button.disabled = true;
      try {
        const result = await api("/api/liff/complete", { method: "POST", body: JSON.stringify({ sessionId, ...payload }) });
        if (typeof result.removedCount === "number") {
          if (result.removedCount === 0) {
            setStatus("รายการที่เลือกถูกลดโดยคนอื่นไปแล้ว รายการล่าสุดจะประกาศในกลุ่ม");
          } else if (result.alreadyRemovedCount > 0) {
            setStatus("ลด " + result.removedCount + " รายการแล้ว อีก " + result.alreadyRemovedCount + " รายการถูกลดไปก่อนหน้า รายการล่าสุดจะประกาศในกลุ่ม");
          } else {
            setStatus("ลด " + result.removedCount + " รายการแล้ว และประกาศผลในกลุ่มเรียบร้อย");
          }
        } else {
          setStatus("บันทึกแล้ว และประกาศผลในกลุ่มเรียบร้อย");
        }
        setTimeout(() => liff.closeWindow(), 1500);
      } catch (error) { setStatus(error.message); button.disabled = false; }
    }
    function setupAdd() {
      addPanel.classList.remove("hidden");
      summary.textContent = "ค้นหาร้านใกล้คุณ แล้วเลือกสะสมหลายรายการก่อนบันทึก";
      searchButton.onclick = () => {
        const query = nameInput.value.trim();
        if (!query) { setStatus("ระบุชื่อร้านหรืออาหารก่อนค้นหา"); nameInput.focus(); return; }
        searchNearby(query, candidates, renderCandidates, searchButton);
      };
      saveAdd.onclick = () => complete({ candidateIds: [...selectedCandidates.keys()] }, saveAdd);
      nameInput.focus(); requestLocationEarly();
    }
    function setupRemove() {
      removePanel.classList.remove("hidden");
      summary.textContent = "เลือกรายการที่ต้องการลด แล้วบอทจะประกาศรายการล่าสุดในกลุ่ม";
      renderRemoveList(session.items || []);
      saveRemove.onclick = () => complete({ itemIds: [...selectedItemIds] }, saveRemove);
    }
    function setupLegacyMap() {
      legacyMapPanel.classList.remove("hidden");
      summary.textContent = "เลือกสาขาใกล้คุณสำหรับ " + session.itemName;
      legacySearchButton.onclick = () => searchNearby(undefined, legacyCandidates, (results) => {
        legacyCandidates.replaceChildren(...results.map((candidate) => candidateButton(candidate, false, () => complete({ candidateId: candidate.id }, legacySearchButton))));
      }, legacySearchButton);
      requestLocationEarly();
    }
    async function boot() {
      try {
        await liff.init({ liffId: config.liffId });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        sessionId = new URLSearchParams(location.search).get("session");
        if (!sessionId) throw new Error("ไม่พบ session");
        session = await api("/api/liff/session?session=" + encodeURIComponent(sessionId));
        app.classList.remove("hidden");
        if (session.action === "add") setupAdd();
        else if (session.action === "remove") setupRemove();
        else if (session.action === "map_link") setupLegacyMap();
        else if (session.action === "show") { summary.textContent = "แสดงรายการล่าสุดในกลุ่ม"; showList.classList.remove("hidden"); showList.onclick = () => complete({}, showList); }
      } catch (error) { summary.textContent = "เปิดเมนูไม่ได้"; setStatus(error.message); }
    }
    boot();
  </script>
</body>
</html>`;
}
