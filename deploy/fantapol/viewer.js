const params = new URLSearchParams(location.search);
const room = (params.get("room") || "").toUpperCase();
const roleNames = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti", MIX: "Ruoli di movimento" };
let liveState = null;
let lastSuccess = 0;
let openTeamIndex = null;
let lastEventId = null;
let flashTimer = null;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function setConnection(online, text) {
  $("#connectionDot").classList.toggle("online", online);
  $("#connectionText").textContent = text;
}

async function refresh() {
  if (!room) {
    $("#waitingTitle").textContent = "Link non valido";
    $("#waitingText").textContent = "Manca il codice dell’asta nel link ricevuto.";
    setConnection(false, "Codice mancante");
    return;
  }
  try {
    const response = await fetch(`sync.php?room=${encodeURIComponent(room)}&_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    liveState = payload.state;
    lastSuccess = Date.now();
    render(liveState);
    setConnection(true, "Aggiornamento automatico");
  } catch {
    if (liveState && Date.now() - lastSuccess < 12000) setConnection(false, "Riconnessione…");
    else if (!liveState) setConnection(false, "In attesa della regia");
  }
}

function render(state) {
  $("#waitingView").classList.add("hidden");
  $("#liveApp").classList.remove("hidden");
  $("#livePhase").textContent = state.finished ? "ASTA COMPLETATA" : (roleNames[state.currentRole] || state.currentRole).toUpperCase();
  $("#liveProgressTitle").textContent = `${state.progress.bought} / ${state.progress.required} giocatori acquistati`;
  $("#liveProgressBar").style.width = `${state.progress.percentage}%`;
  $("#liveRemaining").textContent = state.progress.remaining;
  $("#liveTotal").textContent = state.list.total;
  $("#liveCalled").textContent = state.list.called;
  $("#lastUpdate").textContent = `Aggiornato alle ${new Date(state.updatedAt).toLocaleTimeString("it-IT")}`;
  $("#liveLeagueName").textContent = (state.league?.name || "LIVE").toUpperCase();
  $("#livePauseOverlay").classList.toggle("hidden", state.auctionStatus !== "paused");
  const leagueLogo = $("#liveLeagueLogo");
  leagueLogo.classList.toggle("hidden", !state.league?.logo);
  if (state.league?.logo) { leagueLogo.src = state.league.logo; leagueLogo.alt = `Logo ${state.league.name}`; }

  const player = state.current;
  if (player) {
    $("#livePlayerCard").className = `live-player-card role-${player.role}`;
    $("#liveRole").textContent = player.role;
    $("#livePreciseRole").textContent = player.preciseRole;
    $("#liveCall").textContent = `${player.callNumber}ª CHIAMATA`;
    $("#liveClub").textContent = player.club.toUpperCase();
    const liveName = $("#liveName");
    liveName.textContent = player.name.toUpperCase();
    liveName.className = player.name.length > 20 ? "name-xlong" : player.name.length > 15 ? "name-long" : "";
    $("#liveValues").textContent = `QUOT. ${player.quotation} · FVM ${player.fvm || "—"}`;
    $("#liveInitials").textContent = player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const image = $("#liveImage");
    image.style.display = "none";
    if (player.image) { image.onload = () => image.style.display = "block"; image.src = player.image; image.alt = player.name; }
  }

  const previous = state.previous;
  $("#livePrevious").innerHTML = previous
    ? `<strong>${escapeHtml(previous.name)}</strong><span>${escapeHtml(previous.club)} · ${escapeHtml(previous.preciseRole)} · ${escapeHtml(previous.status)}${previous.team ? ` a <b>${escapeHtml(previous.team)}</b>` : ""}${previous.price ? ` per <b>${previous.price} cr</b>` : ""}</span>`
    : "<span>In attesa della prima operazione</span>";
  if (previous?.eventId && lastEventId && previous.eventId !== lastEventId && previous.status === "Aggiudicato") {
    $("#awardPlayer").textContent = previous.name;
    $("#awardDetails").textContent = `${previous.team || "—"} · ${previous.price || "—"} crediti`;
    $("#awardFlash").classList.remove("hidden");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => $("#awardFlash").classList.add("hidden"), 1100);
  }
  if (previous?.eventId) lastEventId = previous.eventId;

  $("#liveTeams").innerHTML = state.teams.map((team, index) => {
    const logo = team.logo ? `<img class="live-team-logo" src="${escapeHtml(team.logo)}" alt="" referrerpolicy="no-referrer">` : "";
    return `<button class="live-team" data-team-index="${index}" aria-label="Apri la rosa di ${escapeHtml(team.name)}"><div class="live-team-title">${logo}<h3>${escapeHtml(team.name)}</h3></div><div class="live-team-main"><span class="live-team-budget"><em class="live-max-bid">MAX ${team.maxBid ?? "—"}</em><strong>${team.credits} <small>CR</small></strong></span><div class="live-counts">${["P","D","C","A"].map((role) => `<span>${role} <b>${team.counts[role]}/${state.limits[role]}</b></span>`).join("")}</div></div><span class="open-roster-label">VEDI ROSA</span></button>`;
  }).join("");
  $("#liveTeams").querySelectorAll(".live-team").forEach((button) => button.addEventListener("click", () => showTeamRoster(Number(button.dataset.teamIndex))));
  if ($("#teamRosterDialog").open && openTeamIndex !== null) renderTeamRoster(openTeamIndex);
}

function renderTeamRoster(teamIndex) {
  const team = liveState?.teams?.[teamIndex];
  if (!team) return;
  openTeamIndex = teamIndex;
  $("#rosterTeamName").textContent = team.name;
  const teamLogo = $("#rosterTeamLogo");
  teamLogo.classList.toggle("hidden", !team.logo);
  if (team.logo) { teamLogo.src = team.logo; teamLogo.alt = `Stemma ${team.name}`; }
  $("#rosterTeamStats").textContent = `${team.credits} crediti · ${team.total}/${team.totalSlots} giocatori`;
  const roster = Array.isArray(team.roster) ? team.roster : [];
  const sections = ["P", "D", "C", "A"].map((role) => {
    const players = roster.filter((player) => player.role === role).sort((a, b) => a.name.localeCompare(b.name, "it"));
    if (!players.length) return "";
    return `<section class="public-roster-role role-${role}"><h3>${roleNames[role]} <span>${players.length}/${liveState.limits[role]}</span></h3><div>${players.map((player) => `<article><b>${escapeHtml(player.preciseRole || player.role)}</b><span><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.club)}</small></span><em>${player.price} cr</em></article>`).join("")}</div></section>`;
  }).join("");
  $("#publicRoster").innerHTML = sections || '<p class="empty-public-roster">Nessun giocatore acquistato.</p>';
}

function showTeamRoster(teamIndex) {
  renderTeamRoster(teamIndex);
  if (!$("#teamRosterDialog").open) $("#teamRosterDialog").showModal();
}

function closeTeamRoster() {
  $("#teamRosterDialog").close();
  openTeamIndex = null;
}

function updateTimer() {
  if (!liveState?.createdAt) return;
  const base = Number(liveState.elapsedMs || 0);
  const runningExtra = liveState.auctionStatus === "running" ? Math.max(0, Date.now() - new Date(liveState.updatedAt).getTime()) : 0;
  const seconds = Math.max(0, Math.floor((base + runningExtra) / 1000));
  const values = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  $("#liveTimer").textContent = values.map((value) => String(value).padStart(2, "0")).join(":");
  $("#livePauseTime").textContent = $("#liveTimer").textContent;
}

refresh();
setInterval(refresh, 500);
setInterval(updateTimer, 1000);
$("#closeRosterBtn").addEventListener("click", closeTeamRoster);
$("#teamRosterDialog").addEventListener("click", (event) => { if (event.target === $("#teamRosterDialog")) closeTeamRoster(); });
