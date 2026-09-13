export function renderLiffPage(liffId: string, mapsBrowserKey: string | undefined): string {
  const config = JSON.stringify({ liffId, mapsBrowserKey: mapsBrowserKey ?? "" });
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>เมื่อไรจะไปกิน</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f7f7f5; color: #1a1a1a; }
    body { max-width: 520px; margin: 0 auto; padding: 24px 16px 40px; }
    h1 { font-size: 22px; margin: 0 0 8px; } p { line-height: 1.5; }
    input, button { box-sizing: border-box; width: 100%; min-height: 46px; font: inherit; border-radius: 6px; }
    input { border: 1px solid #b8b8b8; padding: 10px 12px; margin: 12px 0; }
    button { border: 0; background: #06c755; color: #fff; font-weight: 700; margin: 6px 0; padding: 10px 12px; }
    button.secondary { background: #fff; border: 1px solid #06c755; color: #087d3b; }
    button:disabled { opacity: .55; } .hidden { display: none; }
    #status { white-space: pre-wrap; color: #555; min-height: 24px; } .candidate { text-align: left; background: #fff; color: #1a1a1a; border: 1px solid #dedede; }
  </style>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
</head>
<body>
  <h1>เมื่อไรจะไปกิน</h1>
  <p id="summary">กำลังเปิดเมนู...</p>
  <main id="app" class="hidden">
    <input id="name" autocomplete="off" placeholder="ชื่อร้านหรืออาหาร">
    <button id="submit">บันทึก</button>
    <button id="location" class="secondary hidden">ใช้ตำแหน่งปัจจุบัน</button>
    <button id="map" class="secondary hidden">เลือกตำแหน่งบนแผนที่</button>
    <div id="mapCanvas" class="hidden" style="height: 320px; margin: 12px 0; border-radius: 6px; overflow: hidden;"></div>
    <section id="candidates"></section>
  </main>
  <p id="status"></p>
  <script>
    const config = ${config};
    const sessionId = new URLSearchParams(location.search).get("session");
    const app = document.querySelector("#app");
    const summary = document.querySelector("#summary");
    const status = document.querySelector("#status");
    const nameInput = document.querySelector("#name");
    const submit = document.querySelector("#submit");
    const locationButton = document.querySelector("#location");
    const mapButton = document.querySelector("#map");
    const mapCanvas = document.querySelector("#mapCanvas");
    const candidates = document.querySelector("#candidates");
    let session;
    let map;
    let marker;

    function setStatus(value) { status.textContent = value; }
    async function api(path, options = {}) {
      const token = liff.getAccessToken();
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(options.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(userFacingError(body.error));
      return body;
    }
    function userFacingError(code) {
      if (code === "google_quota_reached") return "โควต้าค้นหาสถานที่วันนี้เต็มแล้ว ลองใหม่พรุ่งนี้";
      if (code === "restaurant_not_found") return "ไม่เจอร้านนี้ในรายการของแชตนี้";
      if (code === "invalid_or_expired_session") return "ขั้นตอนนี้หมดอายุแล้ว กรุณาเริ่มใหม่";
      if (code === "invalid_or_expired_candidate") return "ตัวเลือกสาขาหมดอายุแล้ว กรุณาเริ่มใหม่";
      return "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
    }
    async function complete(payload) {
      submit.disabled = true;
      try {
        await api("/api/liff/complete", { method: "POST", body: JSON.stringify({ sessionId, ...payload }) });
        setStatus("บันทึกแล้ว และประกาศผลในกลุ่มเรียบร้อย");
        setTimeout(() => liff.closeWindow(), 900);
      } catch (error) { setStatus(error.message); submit.disabled = false; }
    }
    async function searchAtCurrentLocation() {
      if (!navigator.geolocation) { setStatus("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง"); return; }
      locationButton.disabled = true; setStatus("กำลังค้นหาสาขา...");
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const result = await api("/api/liff/map-search", { method: "POST", body: JSON.stringify({ sessionId, latitude: position.coords.latitude, longitude: position.coords.longitude }) });
          candidates.replaceChildren(...result.candidates.map((candidate) => {
            const button = document.createElement("button"); button.className = "candidate";
            button.textContent = [candidate.name, candidate.address].filter(Boolean).join("\\n");
            button.onclick = () => complete({ candidateId: candidate.id }); return button;
          }));
          setStatus(result.candidates.length ? "เลือกสถานที่ที่ต้องการ" : "ไม่พบสถานที่ใกล้ตำแหน่งนี้");
        } catch (error) { setStatus(error.message); }
        locationButton.disabled = false;
      }, () => { setStatus("ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง"); locationButton.disabled = false; }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    }
    async function searchAt(latitude, longitude) {
      try {
        const result = await api("/api/liff/map-search", { method: "POST", body: JSON.stringify({ sessionId, latitude, longitude }) });
        candidates.replaceChildren(...result.candidates.map((candidate) => {
          const button = document.createElement("button"); button.className = "candidate";
          button.textContent = [candidate.name, candidate.address].filter(Boolean).join("\\n");
          button.onclick = () => complete({ candidateId: candidate.id }); return button;
        }));
        setStatus(result.candidates.length ? "เลือกสถานที่ที่ต้องการ" : "ไม่พบสถานที่ใกล้ตำแหน่งนี้");
      } catch (error) { setStatus(error.message); }
    }
    function openMapPicker() {
      if (!config.mapsBrowserKey) { setStatus("ยังไม่ได้ตั้งค่า Maps browser key"); return; }
      if (map) { mapCanvas.classList.remove("hidden"); return; }
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(config.mapsBrowserKey) + "&callback=eataraiMapReady";
      script.async = true; script.defer = true; document.head.appendChild(script);
      window.eataraiMapReady = () => {
        mapCanvas.classList.remove("hidden");
        const center = { lat: 13.7563, lng: 100.5018 };
        map = new google.maps.Map(mapCanvas, { center, zoom: 12, disableDefaultUI: true, clickableIcons: false });
        map.addListener("click", (event) => {
          const position = event.latLng.toJSON();
          if (!marker) marker = new google.maps.Marker({ position, map }); else marker.setPosition(position);
          setStatus("เลือกตำแหน่งแล้ว กำลังค้นหาสาขา..."); searchAt(position.lat, position.lng);
        });
      };
    }
    async function setMapItem() {
      submit.disabled = true;
      try {
        const result = await api("/api/liff/map-item", { method: "POST", body: JSON.stringify({ sessionId, name: nameInput.value }) });
        session.itemName = result.itemName; nameInput.classList.add("hidden"); submit.classList.add("hidden");
        summary.textContent = "เพิ่มแผนที่สำหรับ " + result.itemName;
        locationButton.classList.remove("hidden"); mapButton.classList.remove("hidden");
      } catch (error) { setStatus(error.message); submit.disabled = false; }
    }
    async function boot() {
      try {
        if (!sessionId) throw new Error("ไม่พบ session");
        await liff.init({ liffId: config.liffId });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        session = await api("/api/liff/session?session=" + encodeURIComponent(sessionId));
        app.classList.remove("hidden");
        if (session.action === "map_link" && session.itemName) {
          summary.textContent = "เพิ่มแผนที่สำหรับ " + session.itemName;
          nameInput.classList.add("hidden"); submit.classList.add("hidden"); locationButton.classList.remove("hidden"); mapButton.classList.remove("hidden");
          locationButton.onclick = searchAtCurrentLocation;
          mapButton.onclick = openMapPicker;
        } else if (session.action === "map_link") {
          summary.textContent = "เลือกชื่อร้านในรายการเพื่อเพิ่มแผนที่";
          submit.textContent = "เลือกร้าน"; submit.onclick = setMapItem; nameInput.focus();
        } else if (session.action === "show") {
          summary.textContent = "กดบันทึกเพื่อแสดงรายการในกลุ่ม";
          nameInput.classList.add("hidden"); submit.textContent = "แสดงรายการ"; submit.onclick = () => complete({});
        } else {
          const action = session.action === "add" ? "เพิ่มรายการ" : "ลดรายการ";
          summary.textContent = action + " แล้วบอทจะประกาศผลในกลุ่ม";
          submit.textContent = action; submit.onclick = () => complete({ name: nameInput.value }); nameInput.focus();
        }
      } catch (error) { summary.textContent = "เปิดเมนูไม่ได้"; setStatus(error.message); }
    }
    boot();
  </script>
</body>
</html>`;
}
