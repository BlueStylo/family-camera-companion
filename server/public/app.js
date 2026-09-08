const state = {
  cameras: [],
  quality: "auto",
  activeId: null,
  ptzBusy: false,
  captureBusy: false,
  mediaStatusKey: "",
};

const cameraList = document.querySelector("#cameraList");
const cameraGrid = document.querySelector("#cameraGrid");
const qualitySelect = document.querySelector("#qualitySelect");
const reloadAllButton = document.querySelector("#reloadAll");
const clock = document.querySelector("#clock");
const activeCameraName = document.querySelector("#activeCameraName");
const ptzStatus = document.querySelector("#ptzStatus");

function activeCamera() {
  return state.cameras.find((camera) => camera.id === state.activeId);
}

function cameraQuality(camera) {
  if (state.quality !== "auto") return state.quality;
  return camera.capabilities.preferredQuality || "main";
}

function cameraStreamLabel(camera) {
  const quality = cameraQuality(camera);
  if (quality === "main") return camera.capabilities.mainStream;
  if (quality === "sub") return camera.capabilities.subStream;
  return camera.capabilities.preferredStream || camera.capabilities.mainStream;
}

function streamUrl(camera) {
  return `/api/cameras/${camera.id}/stream?quality=${cameraQuality(camera)}&t=${Date.now()}`;
}

function snapshotUrl(camera) {
  return `/api/cameras/${camera.id}/snapshot?quality=main&t=${Date.now()}`;
}

function setActive(cameraId) {
  state.activeId = cameraId;
  document.querySelectorAll("[data-camera-id]").forEach((element) => {
    element.classList.toggle("active", element.dataset.cameraId === cameraId);
  });

  const camera = activeCamera();
  activeCameraName.textContent = camera ? camera.name : "선택 없음";
  ptzStatus.textContent = camera ? `${camera.name} 제어 대기` : "카메라를 선택하면 조작할 수 있습니다.";
  updateCapture();
}

function updateCameraRow(cameraId, status) {
  const row = document.querySelector(`.camera-row[data-camera-id="${cameraId}"]`);
  if (!row) return;
  row.classList.remove("live", "error");
  if (status === "live") row.classList.add("live");
  if (status === "error") row.classList.add("error");
}

function updatePanelStatus(cameraId, text, status) {
  const element = document.querySelector(`#status-${cameraId}`);
  if (!element) return;
  element.textContent = text;
  element.className = `status ${status || ""}`.trim();
  updateCameraRow(cameraId, status);
}

function reloadCamera(camera) {
  const image = document.querySelector(`#stream-${camera.id}`);
  if (!image) return;
  updatePanelStatus(camera.id, "연결 중", "");
  image.src = streamUrl(camera);
}

function reloadAll() {
  state.cameras.forEach(reloadCamera);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderCameraList() {
  cameraList.innerHTML = "";
  state.cameras.forEach((camera) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-row";
    button.dataset.cameraId = camera.id;
    button.innerHTML = `
      <span class="camera-dot"></span>
      <span>
        <span class="camera-name">${escapeHtml(camera.name)}</span>
        <span class="camera-meta">등록된 장치</span>
      </span>
      <span class="camera-meta">ONVIF</span>
    `;
    button.addEventListener("click", () => {
      setActive(camera.id);
      document.querySelector(`#panel-${camera.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    cameraList.appendChild(button);
  });
}

function renderGrid() {
  cameraGrid.innerHTML = "";
  state.cameras.forEach((camera, index) => {
    const panel = document.createElement("article");
    panel.className = "camera-panel";
    panel.id = `panel-${camera.id}`;
    panel.dataset.cameraId = camera.id;
    panel.innerHTML = `
      <header class="panel-head">
        <div class="panel-title">
          <strong>${escapeHtml(camera.name)}</strong>
          <span>${cameraStreamLabel(camera)}</span>
        </div>
        <div class="panel-actions">
          <button type="button" data-action="snapshot">스냅샷</button>
          <button type="button" data-action="reload">새로고침</button>
        </div>
      </header>
      <div class="video-frame">
        <img id="stream-${camera.id}" alt="${escapeHtml(camera.name)} live stream" />
      </div>
      <footer class="panel-foot">
        <span>RTSP · ${cameraQuality(camera) === "main" ? "Main" : "Sub"}</span>
        <span class="status" id="status-${camera.id}">연결 대기</span>
      </footer>
    `;

    panel.addEventListener("click", () => setActive(camera.id));
    panel.querySelector('[data-action="reload"]').addEventListener("click", (event) => {
      event.stopPropagation();
      reloadCamera(camera);
    });
    panel.querySelector('[data-action="snapshot"]').addEventListener("click", (event) => {
      event.stopPropagation();
      saveSnapshot(camera);
    });

    const image = panel.querySelector("img");
    image.addEventListener("load", () => updatePanelStatus(camera.id, "LIVE", "live"));
    image.addEventListener("error", () => updatePanelStatus(camera.id, "연결 확인", "error"));

    cameraGrid.appendChild(panel);
    if (index === 0 && !state.activeId) setActive(camera.id);
  });

  reloadAll();
}

async function loadCameras() {
  const response = await fetch("/api/cameras", { cache: "no-store" });
  if (!response.ok) throw new Error(`camera list failed: ${response.status}`);
  const data = await response.json();
  state.cameras = data.cameras;
  renderCameraList();
  renderGrid();
}

async function sendPtz(direction) {
  const camera = activeCamera();
  if (!camera || state.ptzBusy) return;

  state.ptzBusy = true;
  ptzStatus.textContent = `${camera.name} 조작 중`;

  try {
    const response = await fetch(`/api/cameras/${camera.id}/ptz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "move",
        direction,
        speed: direction.startsWith("zoom") ? 0.28 : 0.34,
        durationMs: direction.startsWith("zoom") ? 320 : 420,
      }),
    });

    if (!response.ok) {
      throw new Error(`PTZ ${response.status}`);
    }

    ptzStatus.textContent = `${camera.name} 제어 완료`;
  } catch (error) {
    ptzStatus.textContent = `PTZ 실패: ${error.message}`;
  } finally {
    state.ptzBusy = false;
  }
}

async function stopPtz() {
  const camera = activeCamera();
  if (!camera) return;

  try {
    const response = await fetch(`/api/cameras/${camera.id}/ptz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "stop" }),
    });
    if (!response.ok) throw new Error("정지 요청을 확인하지 못했습니다.");
    ptzStatus.textContent = `${camera.name} 정지 요청 완료`;
  } catch (error) {
    ptzStatus.textContent = `정지 실패: ${error.message}`;
  }
}

qualitySelect.addEventListener("change", () => {
  state.quality = qualitySelect.value;
  renderGrid();
  if (state.activeId) setActive(state.activeId);
});

reloadAllButton.addEventListener("click", reloadAll);

document.querySelectorAll("[data-ptz]").forEach((button) => {
  button.addEventListener("click", () => sendPtz(button.dataset.ptz));
});

document.querySelector("[data-ptz-stop]").addEventListener("click", stopPtz);

setInterval(() => {
  clock.textContent = new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}, 1000);

function updateCapture() {
  const camera = activeCamera();
  const job = (window.villaMedia || []).find((file) => file.camera === camera?.id && ["starting", "recording", "stopping"].includes(file.status));
  const toggle = document.querySelector("#recordToggle");
  toggle.textContent = job ? (job.status === "stopping" ? "저장 중" : "녹화 정지") : "녹화 시작";
  toggle.classList.toggle("recording", Boolean(job));
  toggle.disabled = !camera || state.captureBusy || job?.status === "stopping";
  document.querySelector("#saveSnapshot").disabled = !camera || state.captureBusy;
  const latest = (window.villaMedia || []).find((file) => file.camera === camera?.id && file.kind === "recording");
  const key = `${camera?.id}:${latest?.id}:${latest?.status}`;
  if (key !== state.mediaStatusKey && latest) {
    const labels = { starting: "녹화 연결 중", recording: "녹화 중 · 최대 60분", stopping: "녹화 저장 중", ready: "녹화 영상을 보관함에 저장했습니다.", interrupted: "녹화가 중단되었습니다. 보관함을 확인해 주세요.", failed: "녹화에 실패했습니다. 연결과 저장 공간을 확인해 주세요." };
    document.querySelector("#captureStatus").textContent = `${camera.name} · ${labels[latest.status] || ""}`;
  }
  state.mediaStatusKey = key;
}

async function saveSnapshot(camera) {
  if (!camera) return;
  const status = document.querySelector("#captureStatus");
  status.textContent = "사진 저장 중";
  try {
    await window.villaApi(`/api/cameras/${camera.id}/snapshot`, {});
    status.textContent = `${camera.name} 사진을 보관함에 저장했습니다.`;
    await window.refreshVillaMedia();
  } catch (error) { status.textContent = error.message; }
}

document.querySelector("#saveSnapshot").addEventListener("click", () => saveSnapshot(activeCamera()));
document.querySelector("#recordToggle").addEventListener("click", async (event) => {
  const camera = activeCamera();
  if (!camera || state.captureBusy) return;
  state.captureBusy = true;
  event.currentTarget.disabled = true;
  const status = document.querySelector("#captureStatus");
  const active = (window.villaMedia || []).some((file) => file.camera === camera.id && ["starting", "recording", "stopping"].includes(file.status));
  try {
    await window.villaApi(`/api/cameras/${camera.id}/recording`, { command: active ? "stop" : "start" });
    status.textContent = active ? "보관함에서 저장 결과를 확인해 주세요." : `${camera.name} 녹화를 준비합니다. 최대 60분`;
    await window.refreshVillaMedia();
  } catch (error) { status.textContent = error.message; }
  finally { state.captureBusy = false; updateCapture(); }
});
window.addEventListener("villa-media", updateCapture);

window.villaReady.then((user) => {
  if (user) return loadCameras();
}).catch((error) => { cameraGrid.textContent = error.message; });
