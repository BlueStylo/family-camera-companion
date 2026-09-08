let viewer = null;
let pendingTimer;
let panelTimer;
const $ = (selector) => document.querySelector(selector);
const dateLabel = (value) => new Date(value).toLocaleString("ko-KR");

async function api(url, body) {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && viewer) location.reload();
    throw new Error(data.message || "요청을 완료하지 못했습니다.");
  }
  return data;
}
window.villaApi = api;

function showPending(pending) {
  $("#loginForm").hidden = true;
  $("#pendingPanel").hidden = false;
  $("#approvalCode").textContent = pending.code ? `${pending.code.slice(0, 4)}-${pending.code.slice(4)}` : "";
  $("#pendingMessage").textContent = "관리자의 승인을 기다리고 있습니다.";
  clearInterval(pendingTimer);
  pendingTimer = setInterval(checkPending, 3000);
}

async function checkPending() {
  try {
    const pending = await api("/api/auth/pending");
    if (pending.status === "approved") {
      clearInterval(pendingTimer);
      await api("/api/auth/claim", {});
      location.reload();
    } else if (["expired", "denied"].includes(pending.status)) {
      clearInterval(pendingTimer);
      $("#pendingMessage").textContent = pending.status === "denied" ? "승인 요청이 거절되었습니다." : "승인 요청 시간이 만료되었습니다.";
    }
  } catch (error) { $("#loginError").textContent = error.message; }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#loginError").textContent = "";
  try {
    showPending(await api("/api/auth/request", {
      phone: $("#phone").value, label: $("#deviceLabel").value, remember: $("#rememberDevice").checked,
    }));
    $("#phone").value = "";
  } catch (error) { $("#loginError").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#newRequest").addEventListener("click", () => {
  clearInterval(pendingTimer);
  $("#pendingPanel").hidden = true;
  $("#loginForm").hidden = false;
  $("#loginError").textContent = "";
});
$("#logout").addEventListener("click", async () => {
  try { await api("/api/logout", {}); location.reload(); }
  catch (error) { $("#captureStatus").textContent = error.message; }
});

function listRow(title, subtitle) {
  const row = document.createElement("div"); row.className = "saved-row";
  const label = document.createElement("div"); label.className = "saved-label";
  const strong = document.createElement("strong"); strong.textContent = title;
  const small = document.createElement("span"); small.textContent = subtitle;
  label.append(strong, small); row.append(label);
  return row;
}

function actionButton(label, action, statusElement) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action(); }
    catch (error) { statusElement.textContent = error.message; }
    finally { button.disabled = false; }
  });
  return button;
}

async function renderDevices() {
  const data = await api("/api/devices");
  $("#pendingCount").textContent = data.requests.length || "";
  if (!$("#devicesDialog").open) return;
  $("#requestsSection").hidden = viewer.role !== "admin";
  $("#requestList").replaceChildren();
  $("#deviceList").replaceChildren();
  for (const request of data.requests) {
    const row = listRow(`${request.name} · ${request.label}`, `${request.phone} · ${request.code.slice(0, 4)}-${request.code.slice(4)}`);
    for (const allow of [true, false]) row.append(actionButton(allow ? "승인" : "거절", async () => {
      if (allow && !confirm(`${request.name} 님의 기기인가요?\n기기에 표시된 코드 ${request.code.slice(0, 4)}-${request.code.slice(4)}를 확인해 주세요.`)) return;
      await api("/api/devices/decision", { code: request.code, allow });
      await renderDevices();
    }, $("#devicesStatus")));
    $("#requestList").append(row);
  }
  if (!data.requests.length) $("#requestList").textContent = "새 승인 요청이 없습니다.";
  for (const device of data.devices) {
    const row = listRow(`${device.name} · ${device.label}${device.id === viewer.id ? " · 현재 기기" : ""}`, `최근 접속 ${dateLabel(device.last_seen)}`);
    row.append(actionButton("로그인 해제", async () => {
      if (!confirm(`${device.label} 기기의 로그인을 해제할까요?`)) return;
      await api("/api/devices/revoke", { id: device.id });
      if (device.id === viewer.id) location.reload();
      else await renderDevices();
    }, $("#devicesStatus")));
    $("#deviceList").append(row);
  }
}

const mediaStateNames = { starting: "연결 중", recording: "녹화 중", stopping: "저장 중", ready: "저장됨", interrupted: "중단된 녹화", failed: "저장 실패" };
async function refreshMedia() {
  const data = await api("/api/media");
  window.villaMedia = data.files;
  window.dispatchEvent(new Event("villa-media"));
  if (!$("#libraryDialog").open) return;
  $("#mediaList").replaceChildren();
  if (!data.files.length) $("#mediaList").textContent = "저장된 사진과 영상이 없습니다.";
  for (const file of data.files) {
    const row = listRow(`${file.name} · ${file.kind === "snapshot" ? "사진" : "영상"}`, `${dateLabel(file.created)} · ${mediaStateNames[file.status]}`);
    if (file.available) {
      for (const download of [false, true]) {
        const link = document.createElement("a");
        link.href = `/api/media/${file.id}/file${download ? "?download=1" : ""}`;
        link.textContent = download ? "다운로드" : "보기";
        link.className = "action-link";
        if (download) link.download = "";
        else { link.target = "_blank"; link.rel = "noopener noreferrer"; }
        row.append(link);
      }
    }
    $("#mediaList").append(row);
  }
}
window.refreshVillaMedia = refreshMedia;

$("#openLibrary").addEventListener("click", () => {
  $("#libraryDialog").showModal();
  refreshMedia().catch((error) => { $("#libraryStatus").textContent = error.message; });
});
$("#openDevices").addEventListener("click", () => {
  $("#devicesDialog").showModal();
  renderDevices().catch((error) => { $("#devicesStatus").textContent = error.message; });
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));

window.villaReady = (async () => {
  try {
    const session = await api("/api/session");
    if (!session.authenticated) {
      $("#loginPanel").hidden = false;
      const pending = await api("/api/auth/pending");
      if (["pending", "approved"].includes(pending.status)) { showPending(pending); await checkPending(); }
      return null;
    }
    viewer = session.user;
    $("#currentUser").textContent = `${viewer.name} 님`;
    $("#viewerPanel").hidden = false;
    await refreshMedia();
    await renderDevices();
    panelTimer = setInterval(() => {
      refreshMedia().catch((error) => { $("#captureStatus").textContent = error.message; });
      renderDevices().catch((error) => { $("#devicesStatus").textContent = error.message; });
    }, 5000);
    return viewer;
  } catch (error) { $("#loginPanel").hidden = false; $("#loginError").textContent = error.message; return null; }
})();
