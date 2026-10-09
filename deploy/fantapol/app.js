const { AuctionEngine, ROLE_ORDER, mantraGroup } = window.FantaAuctionEngine;
const LIVE_CONFIG = window.FANTAPOL_CONFIG || {};
const STORAGE_KEY = "fantapol.state.v2";
const LEGACY_STORAGE_KEY = "fantaAstaStudio.state.v2";
const IMAGE_CACHE_KEY = "fantapol.club-images.v2";
const CLUB_WIKIPEDIA_TITLES = {
  atalanta: "Atalanta Bergamasca Calcio", bologna: "Bologna Football Club 1909",
  cagliari: "Cagliari Calcio", como: "Como 1907", fiorentina: "ACF Fiorentina",
  frosinone: "Frosinone Calcio", genoa: "Genoa Cricket and Football Club",
  inter: "Football Club Internazionale Milano", juventus: "Juventus Football Club",
  lazio: "Società Sportiva Lazio", lecce: "Unione Sportiva Lecce",
  milan: "Associazione Calcio Milan", monza: "Associazione Calcio Monza",
  napoli: "Società Sportiva Calcio Napoli", parma: "Parma Calcio 1913",
  roma: "Associazione Sportiva Roma", sassuolo: "Unione Sportiva Sassuolo Calcio",
  torino: "Torino Football Club", udinese: "Udinese Calcio", venezia: "Venezia Football Club",
};
const DEFAULT_TEAMS = Array.from({ length: 16 }, (_, index) => `SQUADRA ${index + 1}`);
const ROLE_NAMES = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti", MIX: "Ruoli di movimento" };
let engine = null;
let parsedPlayers = null;
let editingExisting = false;
let toastTimer = null;
let imageRequest = 0;
let auctionTimerInterval = null;
let imageCache = {};
const pendingImageLookups = new Map();
let syncTimer = null;
let syncInFlight = false;
let syncQueued = false;
let syncBlocked = false;
let draftTeamMetadata = [];
let draftLeagueMetadata = {};
let rosterStructureDirty = false;
try { imageCache = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY)) || {}; } catch { imageCache = {}; }

const $ = (selector) => document.querySelector(selector);
const welcomeView = $("#welcomeView");
const auctionView = $("#auctionView");
const settingsDialog = $("#settingsDialog");
const rostersDialog = $("#rostersDialog");
const finishDialog = $("#finishDialog");
const auditDialog = $("#auditDialog");
const shareDialog = $("#shareDialog");
const searchDialog = $("#searchDialog");
const repairDialog = $("#repairDialog");
const rosterEditorDialog = $("#rosterEditorDialog");

function slugId(name, index) {
  return `team-${index + 1}-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function saveState() {
  if (!engine) return;
  engine.touch();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(engine.state));
  installControllerUrl();
  const time = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("#autosaveStatus").textContent = `● Salvato automaticamente alle ${time}`;
  schedulePublicSync();
}

function savedState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)); } catch { return null; }
}

function updateWelcome() {
  const saved = savedState();
  $("#resumeBtn").classList.toggle("hidden", !saved);
  if (saved) {
    const bought = saved.players?.filter((player) => player.boughtBy).length || 0;
    $("#savedAuctionInfo").textContent = `Ultimo salvataggio: ${new Date(saved.updatedAt).toLocaleString("it-IT")} · ${bought} acquisti`;
  } else {
    $("#savedAuctionInfo").textContent = "Nessuna asta salvata su questo dispositivo.";
  }
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function populateTeamInputs(count, names = []) {
  const list = $("#teamNamesList");
  const previous = [...list.querySelectorAll("input")].map((input) => input.value);
  const values = names.length ? names : previous;
  draftTeamMetadata = Array.from({ length: count }, (_, index) => draftTeamMetadata[index] || {});
  list.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const label = document.createElement("label");
    label.className = "team-name-field";
    const logo = draftTeamMetadata[i]?.logo ? `<img src="${escapeHtml(draftTeamMetadata[i].logo)}" alt="" referrerpolicy="no-referrer">` : `<span>${String(i + 1).padStart(2, "0")}</span>`;
    label.innerHTML = `${logo}<input required maxlength="40" value="${escapeHtml(values[i] || DEFAULT_TEAMS[i] || `SQUADRA ${i + 1}`)}" aria-label="Nome squadra ${i + 1}">`;
    list.append(label);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function openNewAuctionSettings() {
  editingExisting = false;
  parsedPlayers = null;
  $("#settingsTitle").textContent = "Nuova asta";
  $("#listoneField").classList.remove("hidden");
  $("#settingsForm").querySelector('button[type="submit"]').textContent = "Avvia l’asta";
  $("#teamCountInput").value = 16;
  $("#creditsInput").value = 300;
  $("#modeInput").value = "classic";
  $("#leagueNameInput").value = "";
  draftTeamMetadata = [];
  draftLeagueMetadata = {};
  $("#callModeInput").value = "role-random";
  $("#callModeInput").disabled = false;
  ["D", "C", "A"].forEach((role) => { $("#alphabet" + role).value = "A"; $("#alphabet" + role).disabled = false; });
  updateCallModeFields();
  $("#limitP").value = 3; $("#limitD").value = 8; $("#limitC").value = 8; $("#limitA").value = 5;
  $("#xlsxInput").value = "";
  $("#fileNameLabel").textContent = "Scegli il file aggiornato";
  populateTeamInputs(16, DEFAULT_TEAMS);
  $("#settingsError").textContent = "";
  $("#auctionTools").classList.add("hidden");
  settingsDialog.showModal();
}

function openExistingSettings() {
  editingExisting = true;
  const settings = engine.state.settings;
  $("#settingsTitle").textContent = "Impostazioni asta";
  $("#listoneField").classList.add("hidden");
  $("#settingsForm").querySelector('button[type="submit"]').textContent = "Salva impostazioni";
  $("#teamCountInput").value = settings.teams.length;
  $("#creditsInput").value = settings.initialCredits;
  $("#modeInput").value = settings.mode;
  $("#leagueNameInput").value = settings.leagueName || "";
  draftLeagueMetadata = { name: settings.leagueName || "", logo: settings.leagueLogo || "" };
  $("#callModeInput").value = settings.callMode || "role-random";
  const callsStarted = engine.state.history.length > 0;
  $("#callModeInput").disabled = callsStarted;
  ["D", "C", "A"].forEach((role) => {
    $("#alphabet" + role).value = settings.alphabetStarts?.[role] || "A";
    $("#alphabet" + role).disabled = callsStarted;
  });
  updateCallModeFields();
  ROLE_ORDER.forEach((role) => $("#limit" + role).value = settings.limits[role]);
  draftTeamMetadata = settings.teams.map((team) => ({ externalId: team.externalId || "", logo: team.logo || "" }));
  populateTeamInputs(settings.teams.length, settings.teams.map((team) => team.name));
  $("#settingsError").textContent = "";
  $("#auctionTools").classList.remove("hidden");
  settingsDialog.showModal();
}

function updateCallModeFields() {
  $("#alphabetStarts").classList.toggle("hidden", $("#callModeInput").value !== "alphabetical");
}

async function parseWorkbook(file) {
  if (!window.XLSX) throw new Error("La libreria per leggere Excel non è stata caricata.");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "tutti") || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const headerIndex = rows.findIndex((row) => {
    const keys = row.map((value) => String(value || "").trim().toLowerCase());
    return keys.includes("nome") && keys.includes("squadra") && keys.includes("r");
  });
  if (headerIndex < 0) throw new Error("Non trovo le colonne Nome, Squadra e R nel listone.");
  const headers = rows[headerIndex].map((header) => String(header || "").trim());
  const find = (...names) => headers.findIndex((header) => names.includes(header.toLowerCase()));
  const col = {
    id: find("id"), role: find("r"), mantraRole: find("rm"), name: find("nome"), club: find("squadra"),
    quotation: find("qt.a", "qta", "quotazione"), mantraQuotation: find("qt.a m", "qta m", "quotazione mantra"),
    fvm: find("fvm"), mantraFvm: find("fvm m"),
  };
  const players = rows.slice(headerIndex + 1).map((row, index) => ({
    id: row[col.id] ?? index + 1,
    role: String(row[col.role] || "").trim().toUpperCase(),
    classicRole: String(row[col.role] || "").trim().toUpperCase(),
    mantraRole: String(row[col.mantraRole] || row[col.role] || "").trim(),
    name: String(row[col.name] || "").trim(),
    club: String(row[col.club] || "").trim(),
    quotation: Number(row[col.quotation] || 0),
    mantraQuotation: Number(row[col.mantraQuotation] ?? row[col.quotation] ?? 0),
    fvm: Number(row[col.fvm] || 0),
    mantraFvm: Number(row[col.mantraFvm] ?? row[col.fvm] ?? 0),
  })).filter((player) => player.name && ROLE_ORDER.includes(player.role));
  if (!players.length) throw new Error("Il listone non contiene giocatori validi.");
  return players;
}

function collectSettings() {
  const names = [...$("#teamNamesList").querySelectorAll("input")].map((input) => input.value.trim().toLocaleUpperCase("it-IT"));
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error("I nomi delle squadre devono essere univoci.");
  if (names.some((name) => !name)) throw new Error("Inserisci tutti i nomi delle squadre.");
  const oldTeams = editingExisting ? engine.state.settings.teams : [];
  const teams = names.map((name, index) => {
    const metadata = draftTeamMetadata[index] || {};
    return {
      id: oldTeams[index]?.id || (metadata.externalId ? `fg-${metadata.externalId}` : slugId(name, index)),
      name,
      externalId: metadata.externalId || oldTeams[index]?.externalId || "",
      logo: metadata.logo || oldTeams[index]?.logo || "",
    };
  });
  const settings = {
    mode: $("#modeInput").value,
    callMode: $("#callModeInput").value,
    alphabetStarts: Object.fromEntries(["D", "C", "A"].map((role) => [role, ($("#alphabet" + role).value.trim().toUpperCase() || "A")])),
    leagueName: $("#leagueNameInput").value.trim().toLocaleUpperCase("it-IT"),
    leagueLogo: "",
    initialCredits: Number($("#creditsInput").value),
    limits: Object.fromEntries(ROLE_ORDER.map((role) => [role, Number($("#limit" + role).value)])),
    teams,
    listName: editingExisting ? engine.state.settings.listName : $("#xlsxInput").files[0]?.name,
  };
  if (!Number.isInteger(settings.initialCredits) || settings.initialCredits < 1) throw new Error("I crediti iniziali devono essere un numero positivo.");
  if (!Object.values(settings.alphabetStarts).every((letter) => /^[A-Z]$/.test(letter))) throw new Error("Inserisci una sola lettera da A a Z per ciascun ruolo.");
  if (Object.values(settings.limits).some((value) => !Number.isInteger(value) || value < 0)) throw new Error("I limiti di ruolo devono essere numeri interi positivi.");
  return settings;
}

function validatePlayerSupply(settings, players, { strictSupply = true } = {}) {
  const shortages = [];
  for (const role of ROLE_ORDER) {
    const available = players.filter((player) => (
      (settings.mode === "mantra" ? mantraGroup(player.mantraRole, player.role) : player.role) === role
    )).length;
    const required = settings.teams.length * settings.limits[role];
    if (available < required) shortages.push({ role, available, required });
  }
  const slots = ROLE_ORDER.reduce((sum, role) => sum + settings.limits[role], 0);
  if (settings.initialCredits < slots) throw new Error(`Servono almeno ${slots} crediti: uno per ogni slot della rosa.`);
  if (strictSupply && shortages.length) {
    const first = shortages[0];
    throw new Error(`Giocatori ${first.role} insufficienti: ${first.available} disponibili, ${first.required} necessari.`);
  }
  return shortages;
}

async function submitSettings(event) {
  event.preventDefault();
  const error = $("#settingsError");
  error.textContent = "";
  try {
    const settings = collectSettings();
    if (editingExisting) {
      if (settings.teams.length !== engine.state.settings.teams.length && engine.state.players.some((player) => player.boughtBy)) {
        throw new Error("Durante un’asta avviata puoi rinominare le squadre, ma non cambiarne il numero.");
      }
      validatePlayerSupply(settings, engine.state.players);
      for (const team of settings.teams) {
        const roster = engine.teamPlayers(team.id);
        const spent = roster.reduce((sum, player) => sum + Number(player.price || 0), 0);
        if (spent > settings.initialCredits) throw new Error(`${team.name} ha già speso ${spent} crediti.`);
        for (const role of ROLE_ORDER) {
          const count = roster.filter((player) => player.role === role).length;
          if (count > settings.limits[role]) throw new Error(`${team.name} ha già ${count} giocatori di ruolo ${role}.`);
        }
      }
      engine.state.settings = settings;
      if (!settings.teams.some((team) => team.id === engine.state.selectedTeamId)) engine.state.selectedTeamId = settings.teams[0]?.id || null;
      if (engine.roleComplete(engine.state.currentRole)) engine.chooseNext();
      saveState();
    } else {
      const file = $("#xlsxInput").files[0];
      if (!file) throw new Error("Seleziona il listone Excel prima di iniziare.");
      const players = parsedPlayers || await parseWorkbook(file);
      validatePlayerSupply(settings, players);
      engine = AuctionEngine.create(settings, players);
      saveState();
    }
    settingsDialog.close();
    showAuction();
    showToast(editingExisting ? "Impostazioni aggiornate." : `${engine.state.players.length} giocatori importati.`);
  } catch (err) {
    error.textContent = err.message;
  }
}

function showAuction() {
  welcomeView.classList.add("hidden");
  auctionView.classList.remove("hidden");
  render();
  startAuctionTimer();
}

function startAuctionTimer() {
  clearInterval(auctionTimerInterval);
  updateAuctionTimer();
  auctionTimerInterval = setInterval(updateAuctionTimer, 1000);
}

function updateAuctionTimer() {
  if (!engine) return;
  const elapsed = engine.elapsedMs();
  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formatted = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  $("#auctionTimer").textContent = formatted;
  $("#pauseTimer").textContent = formatted;
}

function render() {
  if (!engine) return;
  const state = engine.state;
  const player = engine.currentPlayer;
  if (player) engine.selectNearestAvailableTeam(player.role);
  const progress = engine.progress();
  renderLeagueBrand();
  const calledPlayers = state.players.filter((item) => item.calls > 0).length;
  $("#phaseLabel").textContent = state.finished ? "COMPLETATA" : ROLE_NAMES[state.currentRole].toUpperCase();
  $("#progressLabel").textContent = `ROSE ${progress.bought} / ${progress.required}`;
  $("#remainingLabel").textContent = Math.max(0, progress.required - progress.bought);
  $("#totalPlayersLabel").textContent = state.players.length;
  $("#calledPlayersLabel").textContent = calledPlayers;
  $("#progressBar").style.width = `${progress.percentage}%`;
  $("#rostersCount").textContent = `${progress.bought}/${progress.required}`;
  $("#auditCount").textContent = state.auditLog.length;
  $("#undoBtn").disabled = !state.history.length;
  const paused = state.auctionStatus === "paused";
  $("#pauseOverlay").classList.toggle("hidden", !paused);
  $("#pauseBtn").disabled = state.auctionStatus === "finished";
  $("#pauseBtnLabel").textContent = paused ? "Riprendi asta" : "Pausa asta";
  ["#skipBtn", "#buyBtn", "#searchBtn"].forEach((selector) => { $(selector).disabled = paused || state.auctionStatus === "finished"; });
  renderTeams();
  renderShortageBanner();

  if (state.finished || state.auctionStatus === "finished" || !player) {
    if (!finishDialog.open) finishDialog.showModal();
    return;
  }
  const card = $("#playerCard");
  card.className = `player-card role-${player.role}`;
  $("#playerRole").textContent = player.role;
  $("#callCount").textContent = `${ordinal(player.calls + 1)} CHIAMATA`;
  $("#playerClub").textContent = player.club.toUpperCase();
  const playerName = $("#playerName");
  playerName.textContent = player.name.toUpperCase();
  playerName.className = player.name.length > 22 ? "name-xlong" : player.name.length > 15 ? "name-long" : "";
  $("#playerMantraRole").textContent = player.mantraRole.toUpperCase();
  $("#playerMeta").textContent = `QUOTAZIONE ${engine.quoteFor(player)}`;
  $("#playerFvm").textContent = engine.fvmFor(player) || "—";
  const initials = player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  $("#portraitInitials").textContent = initials;
  loadPlayerPortrait(player);
  preloadUpcomingImages();
  const selected = state.settings.teams.find((team) => team.id === state.selectedTeamId) || state.settings.teams[0];
  $("#selectedTeamDisplay").textContent = selected.name;
  $("#maxBidLabel").textContent = `Massimo ${engine.maxBid(selected.id)} cr`;
  $("#buyBtn").disabled = state.auctionStatus !== "running" || engine.teamStats(selected.id).counts[player.role] >= state.settings.limits[player.role];
  renderPreviousCall();
}

function renderLeagueBrand() {
  const name = engine.state.settings.leagueName || "ASTA LIVE";
  $("#headerLeagueName").textContent = name.toLocaleUpperCase("it-IT");
  const logo = $("#headerLeagueLogo");
  logo.classList.add("hidden");
  logo.removeAttribute("src");
}

function renderPreviousCall() {
  const panel = $("#previousCall");
  const action = engine.state.history.at(-1);
  if (!action) {
    panel.classList.add("empty");
    $("#previousRole").textContent = "—";
    $("#previousClub").textContent = "IN ATTESA";
    $("#previousName").textContent = "Nessuna chiamata";
    $("#previousStatus").textContent = "L’ultima operazione apparirà qui.";
    $("#previousPrice").textContent = "";
    $("#previousTime").textContent = "";
    return;
  }
  const player = engine.getPlayer(action.playerId);
  const team = engine.state.settings.teams.find((item) => item.id === player?.boughtBy);
  panel.classList.remove("empty");
  panel.dataset.role = player?.role || "";
  $("#previousRole").textContent = player?.mantraRole?.toUpperCase() || player?.role || "—";
  $("#previousClub").textContent = player?.club?.toUpperCase() || "—";
  $("#previousName").textContent = player?.name || "—";
  if (action.type === "buy" && team) {
    $("#previousStatus").textContent = `A ${team.name}`;
    $("#previousPrice").textContent = `${player.price} CR`;
  } else {
    $("#previousStatus").textContent = "NON ASSEGNATO";
    $("#previousPrice").textContent = "PASSATO";
  }
  const occurredAt = action.occurredAt || engine.state.updatedAt;
  $("#previousTime").textContent = `Ore ${new Date(occurredAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function ordinal(number) {
  return `${number}ª`;
}

function renderTeams() {
  const grid = $("#teamsGrid");
  const currentRole = engine.currentPlayer?.role || engine.state.currentRole;
  grid.innerHTML = engine.state.settings.teams.map((team) => {
    const stats = engine.teamStats(team.id);
    const classes = ["team-card", team.id === engine.state.selectedTeamId ? "selected" : "", stats.counts[currentRole] >= engine.state.settings.limits[currentRole] ? "full-role" : ""].join(" ");
    const counts = ROLE_ORDER.map((role) => `<span>${role} <b>${stats.counts[role]}/${engine.state.settings.limits[role]}</b></span>`).join("");
    const logo = team.logo ? `<img class="team-logo" src="${escapeHtml(team.logo)}" alt="" referrerpolicy="no-referrer">` : "";
    const full = stats.counts[currentRole] >= engine.state.settings.limits[currentRole];
    return `<button class="${classes}" data-team-id="${escapeHtml(team.id)}" ${full ? "disabled" : ""}><span class="team-card-title">${logo}<span class="team-card-name">${escapeHtml(team.name)}</span></span><span class="team-card-main"><span class="team-budget"><small class="team-max-bid">MAX ${engine.maxBid(team.id)}</small><strong>${stats.credits} <small>CR</small></strong></span><span class="role-counts">${counts}</span></span></button>`;
  }).join("");
  grid.querySelectorAll(".team-card").forEach((card) => card.addEventListener("click", () => {
    engine.selectTeam(card.dataset.teamId); saveState(); render();
  }));
}

function moveTeamSelection(direction) {
  if (!engine?.currentPlayer) return;
  const teams = engine.state.settings.teams;
  const currentIndex = Math.max(0, teams.findIndex((team) => team.id === engine.state.selectedTeamId));
  const role = engine.currentPlayer.role;
  for (let offset = 1; offset <= teams.length; offset += 1) {
    const index = (currentIndex + direction * offset + teams.length) % teams.length;
    const team = teams[index];
    if (engine.teamStats(team.id).counts[role] < Number(engine.state.settings.limits[role] || 0)) {
      engine.selectTeam(team.id);
      saveState();
      render();
      return;
    }
  }
}

function moveTeamVertically(direction) {
  if (!engine?.currentPlayer) return;
  const teams = engine.state.settings.teams;
  const currentIndex = Math.max(0, teams.findIndex((team) => team.id === engine.state.selectedTeamId));
  const role = engine.currentPlayer.role;
  const rowSize = 8;
  const targetIndex = (currentIndex + direction * rowSize + teams.length) % teams.length;
  const candidates = [targetIndex];
  for (let distance = 1; distance < rowSize; distance += 1) {
    candidates.push((targetIndex + distance) % teams.length, (targetIndex - distance + teams.length) % teams.length);
  }
  const target = candidates.map((index) => teams[index]).find((team) => (
    team && engine.teamStats(team.id).counts[role] < Number(engine.state.settings.limits[role] || 0)
  ));
  if (!target) return;
  engine.selectTeam(target.id);
  saveState();
  render();
}

function returnHome() {
  saveState();
  clearInterval(auctionTimerInterval);
  auctionView.classList.add("hidden");
  welcomeView.classList.remove("hidden");
  updateWelcome();
}

function renderShortageBanner() {
  const banner = $("#shortageBanner");
  const thresholds = { P: 5, D: 10, C: 10, A: 10 };
  const alerts = ROLE_ORDER.map((role) => {
    const missing = engine.state.settings.teams.map((team) => {
      const count = engine.teamStats(team.id).counts[role];
      return { name: team.name, slots: Math.max(0, engine.state.settings.limits[role] - count) };
    }).filter((item) => item.slots > 0);
    const total = missing.reduce((sum, item) => sum + item.slots, 0);
    if (!total || total > thresholds[role]) return null;
    const teams = missing.map((item) => `${escapeHtml(item.name)}${item.slots > 1 ? ` (${item.slots})` : ""}`).join(", ");
    return `<span><b>ULTIMI ${total} ${ROLE_NAMES[role].toUpperCase()}</b> · Mancano a: ${teams}</span>`;
  }).filter(Boolean);
  banner.innerHTML = alerts.join("");
  banner.classList.toggle("hidden", alerts.length === 0);
}

async function loadPlayerPortrait(player) {
  const request = ++imageRequest;
  const image = $("#playerPortrait");
  image.removeAttribute("src");
  image.classList.remove("club-logo");
  image.style.display = "none";
  image.alt = `Ritratto di ${player.name}`;
  try {
    const result = await resolvePlayerImage(player);
    if (result?.source) setImage(result.source, request, result.kind);
  } catch { /* offline fallback remains visible */ }
}

async function resolvePlayerImage(player) {
  const normalizedClub = normalizeSearch(player.club);
  const exactTitle = CLUB_WIKIPEDIA_TITLES[normalizedClub] || player.club;
  const clubSource = await lookupImage(`club-v2:${normalizedClub}`, exactTitle, true);
  return clubSource ? { source: clubSource, kind: "club" } : null;
}

function lookupImage(cacheKey, query, exactTitle = false) {
  if (Object.prototype.hasOwnProperty.call(imageCache, cacheKey)) return Promise.resolve(imageCache[cacheKey]);
  if (pendingImageLookups.has(cacheKey)) return pendingImageLookups.get(cacheKey);
  const promise = (async () => {
    try {
      const selector = exactTitle
        ? `titles=${encodeURIComponent(query)}`
        : `generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1`;
      const url = `https://it.wikipedia.org/w/api.php?action=query&${selector}&prop=pageimages&pithumbsize=700&format=json&origin=*`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("image lookup failed");
      const json = await response.json();
      const page = Object.values(json.query?.pages || {})[0];
      imageCache[cacheKey] = page?.thumbnail?.source || null;
    } catch {
      pendingImageLookups.delete(cacheKey);
      return null;
    }
    try { localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(imageCache)); } catch { /* cache piena */ }
    schedulePublicSync();
    pendingImageLookups.delete(cacheKey);
    return imageCache[cacheKey];
  })();
  pendingImageLookups.set(cacheKey, promise);
  return promise;
}

function preloadUpcomingImages() {
  if (!engine) return;
  engine.upcomingPlayers().slice(0, 3).forEach(async (player) => {
    const result = await resolvePlayerImage(player);
    if (result?.source) {
      const preloaded = new Image();
      preloaded.src = result.source;
    }
  });
}

function setImage(source, request, kind = "player") {
  if (request !== imageRequest) return;
  const image = $("#playerPortrait");
  image.classList.toggle("club-logo", kind === "club");
  image.onload = () => { if (request === imageRequest) image.style.display = "block"; };
  image.onerror = () => { image.style.display = "none"; };
  image.src = source;
}

function performAction(action, options = {}) {
  try {
    const previousRole = engine.state.currentRole;
    action();
    if (engine.currentPlayer) engine.selectNearestAvailableTeam(engine.currentPlayer.role);
    const roleChanged = !engine.state.finished && engine.state.currentRole !== previousRole;
    saveState();
    render();
    if (roleChanged && options.showRoleTransition !== false) showRosters({ completedRole: previousRole, nextRole: engine.state.currentRole });
  } catch (err) { showToast(err.message, true); }
}

function showRosters(transition = null) {
  if (transition) {
    $("#rostersEyebrow").textContent = `${ROLE_NAMES[transition.completedRole].toUpperCase()} COMPLETATI`;
    $("#rostersTitle").textContent = "Controllo rose";
    $("#rostersSubtitle").textContent = `Alla chiusura inizieranno i ${ROLE_NAMES[transition.nextRole].toLowerCase()}.`;
  } else {
    $("#rostersEyebrow").textContent = "ROSE LIVE";
    $("#rostersTitle").textContent = "Tutte le squadre";
    $("#rostersSubtitle").textContent = "";
  }
  const grid = $("#rostersGrid");
  grid.innerHTML = engine.state.settings.teams.map((team) => {
    const stats = engine.teamStats(team.id);
    const players = stats.roster.slice().sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, "it"));
    const list = players.length ? players.map((player) => `<div class="roster-player"><span class="r ${player.role}">${player.role}</span><span>${escapeHtml(player.name)}</span><strong>${player.price}</strong></div>`).join("") : '<p class="empty-roster">Nessun acquisto</p>';
    const logo = team.logo ? `<img class="roster-team-logo" src="${escapeHtml(team.logo)}" alt="" referrerpolicy="no-referrer">` : "";
    return `<article class="roster-card"><div class="roster-card-head"><div class="roster-team-title">${logo}<h3>${escapeHtml(team.name)}</h3></div><p><strong>${stats.credits} cr</strong> · ${stats.total}/${stats.totalSlots}</p></div><div class="roster-list">${list}</div></article>`;
  }).join("");
  rostersDialog.showModal();
}

function showAuditLog() {
  const events = engine.state.auditLog.slice().reverse();
  $("#auditTotal").textContent = events.length;
  $("#auditList").innerHTML = events.length ? events.map((event) => {
    const player = engine.getPlayer(event.playerId);
    const team = engine.state.settings.teams.find((item) => item.id === event.teamId);
    const time = new Date(event.timestamp).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const labels = { buy: "AGGIUDICATO", skip: "PASSATO", undo: "ANNULLATO", edit: "CORRETTO", release: "SVINCOLATO", finish: "TERMINATA", "repair-import": "RIPARAZIONE" };
    let outcome = "Non assegnato";
    if (event.type === "buy") outcome = team?.name || "Squadra sconosciuta";
    if (event.type === "undo") outcome = `Annullato ${event.revertedType === "buy" ? "acquisto" : "passaggio"}`;
    if (event.type === "release") outcome = "Rimosso dalla rosa";
    if (event.type === "edit") outcome = team?.name || "Dati corretti";
    if (event.type === "finish") outcome = "Chiusura manuale";
    if (event.type === "repair-import") outcome = `${event.carried || 0} giocatori mantenuti`;
    return `<div class="audit-row"><time>${time}</time><span class="audit-type ${event.type}">${labels[event.type] || event.type}</span><span class="audit-player"><b>${escapeHtml(player?.name || "—")}</b><small>${escapeHtml(player?.club || "—")} · ${escapeHtml(player?.mantraRole || event.role || "—")}</small></span><span>${escapeHtml(outcome)}</span><strong>${event.type === "buy" ? `${event.price} cr` : "—"}</strong></div>`;
  }).join("") : '<p class="audit-empty">Il registro inizierà con la prima chiamata.</p>';
  auditDialog.showModal();
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function renderPlayerSearch() {
  const query = normalizeSearch($("#playerSearchInput").value);
  const roleFilter = $("#playerSearchRole").value;
  const candidates = engine.manualCallCandidates()
    .filter((player) => !roleFilter || player.role === roleFilter)
    .filter((player) => !query || normalizeSearch(`${player.name} ${player.club}`).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
  $("#searchResultCount").textContent = `${candidates.length} ${candidates.length === 1 ? "giocatore" : "giocatori"}`;
  $("#searchResults").innerHTML = candidates.length ? candidates.map((player) => `
    <button class="search-result ${player.id === engine.state.currentPlayerId ? "current" : ""}" data-player-id="${escapeHtml(player.id)}">
      <span class="search-result-role">${escapeHtml(player.mantraRole.toUpperCase())}</span>
      <span class="search-result-copy"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.club)} · ${player.calls + 1}ª chiamata</span></span>
      <span class="search-result-meta"><b>${engine.quoteFor(player)}</b>quotazione</span>
    </button>`).join("") : '<p class="search-empty">Nessun giocatore disponibile corrisponde alla ricerca.</p>';
  $("#searchResults").querySelectorAll(".search-result").forEach((button) => button.addEventListener("click", () => {
    try {
      const player = engine.callManually(button.dataset.playerId);
      saveState();
      render();
      searchDialog.close();
      showToast(`${player.name} chiamato manualmente.`);
    } catch (error) { showToast(error.message, true); }
  }));
}

function showPlayerSearch() {
  if (!engine?.currentPlayer) return;
  $("#playerSearchInput").value = "";
  $("#playerSearchRole").value = "";
  $("#searchRoleField").classList.toggle("hidden", engine.state.currentRole !== "MIX");
  $("#searchSubtitle").textContent = `${ROLE_NAMES[engine.state.currentRole]} · giro di chiamata ${engine.currentPlayer.calls + 1}`;
  renderPlayerSearch();
  searchDialog.showModal();
  requestAnimationFrame(() => $("#playerSearchInput").focus());
}

function liveSyncEndpoint() {
  if (new URLSearchParams(location.search).has("offline")) return null;
  if (LIVE_CONFIG.syncEndpoint) return LIVE_CONFIG.syncEndpoint;
  const published = ["http:", "https:"].includes(location.protocol) && !["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  return published ? new URL("sync.php", location.href).href : null;
}

function publicViewerUrl() {
  const url = new URL(LIVE_CONFIG.viewerBaseUrl || "viewer.html", location.href);
  url.searchParams.set("room", engine.state.sharing.room);
  return url.href;
}

function isPublishedController() {
  return ["http:", "https:"].includes(location.protocol) && !["localhost", "127.0.0.1", "::1"].includes(location.hostname);
}

function controllerUrl() {
  const url = new URL("index.html", location.href);
  url.search = "";
  url.searchParams.set("room", engine.state.sharing.room);
  url.hash = new URLSearchParams({ control: engine.state.sharing.token }).toString();
  return url.href;
}

function installControllerUrl() {
  if (!engine || !isPublishedController()) return;
  const target = new URL(controllerUrl());
  if (location.search !== target.search || location.hash !== target.hash) {
    history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
  }
}

function controllerAccessFromUrl() {
  const room = new URLSearchParams(location.search).get("room") || "";
  const token = new URLSearchParams(location.hash.slice(1)).get("control") || "";
  return /^[A-Z0-9]{6,24}$/i.test(room) && token.length >= 32 ? { room: room.toUpperCase(), token } : null;
}

function buildPublicSnapshot() {
  const state = engine.state;
  const current = engine.currentPlayer;
  const progress = engine.progress();
  const lastAction = state.history.at(-1);
  const previousPlayer = lastAction ? engine.getPlayer(lastAction.playerId) : null;
  const previousTeam = previousPlayer?.boughtBy ? state.settings.teams.find((team) => team.id === previousPlayer.boughtBy) : null;
  const imageFor = (player) => player ? imageCache[`player:${player.id}`] || imageCache[`club:${player.club.toLowerCase()}`] || null : null;
  return {
    version: 2,
    updatedAt: state.updatedAt,
    createdAt: state.createdAt,
    auctionStatus: state.auctionStatus || (state.finished ? "finished" : "running"),
    elapsedMs: engine.elapsedMs(),
    currentRole: state.currentRole,
    finished: state.finished,
    league: { name: state.settings.leagueName || "FANTAPOL", logo: null },
    progress: { ...progress, remaining: Math.max(0, progress.required - progress.bought) },
    list: { total: state.players.length, called: state.players.filter((player) => player.calls > 0).length },
    current: current ? {
      id: current.id, name: current.name, club: current.club, role: current.role, preciseRole: current.mantraRole,
      quotation: engine.quoteFor(current), fvm: engine.fvmFor(current), callNumber: current.calls + 1, image: imageFor(current),
    } : null,
    previous: previousPlayer ? {
      eventId: lastAction.occurredAt || state.updatedAt,
      name: previousPlayer.name, club: previousPlayer.club, preciseRole: previousPlayer.mantraRole,
      status: lastAction.type === "buy" ? "Aggiudicato" : "Passato", team: previousTeam?.name || null,
      price: lastAction.type === "buy" ? previousPlayer.price : null, timestamp: lastAction.occurredAt || state.updatedAt,
    } : null,
    teams: state.settings.teams.map((team) => {
      const stats = engine.teamStats(team.id);
      return {
        name: team.name, logo: team.logo || null, credits: stats.credits, maxBid: engine.maxBid(team.id), total: stats.total, totalSlots: stats.totalSlots, counts: stats.counts,
        roster: stats.roster.map((player) => ({
          name: player.name, role: player.role, preciseRole: player.mantraRole, club: player.club, price: player.price,
        })),
      };
    }),
    limits: state.settings.limits,
  };
}

function schedulePublicSync() {
  if (!engine || !liveSyncEndpoint()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPublicState, 180);
}

async function syncPublicState() {
  const endpoint = liveSyncEndpoint();
  if (!engine || !endpoint || syncBlocked) return;
  if (syncInFlight) { syncQueued = true; return; }
  syncInFlight = true;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        room: engine.state.sharing.room,
        token: engine.state.sharing.token,
        state: buildPublicSnapshot(),
        fullState: engine.state,
      }),
    });
    if (response.status === 409) {
      syncBlocked = true;
      showToast("L’asta è stata aggiornata da un altro dispositivo. Ricarica questa pagina prima di continuare.", true);
      throw new Error("sync conflict");
    }
    if (!response.ok) throw new Error(`sync ${response.status}`);
    updateShareStatus(true);
  } catch {
    updateShareStatus(false);
  } finally {
    syncInFlight = false;
    if (syncQueued) { syncQueued = false; schedulePublicSync(); }
  }
}

function updateShareStatus(online) {
  const dot = $("#shareStatusDot");
  if (!dot) return;
  dot.classList.toggle("online", online);
  const configured = Boolean(liveSyncEndpoint());
  let syncHost = "Il server remoto";
  try { syncHost = new URL(liveSyncEndpoint()).hostname; } catch {}
  $("#shareStatusTitle").textContent = online ? "Sincronizzazione live attiva" : configured ? "Connessione live in attesa" : "Sincronizzazione disattivata";
  $("#shareStatusText").textContent = online ? `${syncHost} riceve automaticamente gli aggiornamenti della regia locale.` : configured ? "La regia ritenta automaticamente ogni secondo: verifica connessione e file sul dominio." : "La sincronizzazione è stata disattivata per questa apertura.";
}

function showShareDialog() {
  $("#shareLinkInput").value = publicViewerUrl();
  $("#controllerLinkInput").value = controllerUrl();
  $("#shareRoomCode").textContent = engine.state.sharing.room;
  updateShareStatus(false);
  shareDialog.showModal();
  if (liveSyncEndpoint()) syncPublicState();
}

async function copyShareLink() {
  const input = $("#shareLinkInput");
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  showToast("Link per i partecipanti copiato.");
}

async function copyControllerLink() {
  const input = $("#controllerLinkInput");
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  showToast("Link segreto della regia copiato.");
}

async function loadOnlineController() {
  const access = controllerAccessFromUrl();
  if (!access || !liveSyncEndpoint()) { updateWelcome(); return; }
  $("#savedAuctionInfo").textContent = "Caricamento dell’asta online…";
  try {
    const response = await fetch(liveSyncEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", room: access.room, token: access.token }),
    });
    if (!response.ok) throw new Error(response.status === 403 ? "Link regia non valido." : "Asta online non trovata.");
    const payload = await response.json();
    engine = AuctionEngine.restore(payload.fullState);
    syncBlocked = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(engine.state));
    installControllerUrl();
    showAuction();
    showToast("Asta online caricata e sincronizzata.");
  } catch (error) {
    updateWelcome();
    showToast(error.message || "Impossibile caricare l’asta online.", true);
  }
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
}

function exportJson() {
  saveState();
  download(`fantapol-backup-${dateStamp()}.json`, JSON.stringify(engine.state, null, 2), "application/json");
  showToast("Backup JSON scaricato.");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const headers = ["ID", "R", "RM", "Nome", "Squadra", "Quotazione", "FVM", "Fantasquadra", "Costo", "Chiamate", "Stato"];
  const rows = engine.state.players.map((player) => {
    const team = engine.state.settings.teams.find((item) => item.id === player.boughtBy);
    return [player.id, player.role, player.mantraRole, player.name, player.club, engine.quoteFor(player), engine.fvmFor(player), team?.name || "", player.price ?? "", player.calls, player.boughtBy ? "Acquistato" : "Disponibile"];
  });
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  download(`fantapol-risultati-${dateStamp()}.csv`, csv, "text/csv;charset=utf-8");
  showToast("Archivio CSV scaricato.");
}

function commaCsvCell(value) {
  const text = String(value ?? "");
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportIntegrationCsv() {
  const rows = engine.integrationRows();
  if (!rows.length) { showToast("Non ci sono giocatori acquistati da esportare.", true); return; }
  const csv = rows.map((row) => [row.team, row.id, row.cost].map(commaCsvCell).join(",")).join("\r\n");
  download(`fantapol-integrazione-${dateStamp()}.csv`, csv, "text/csv;charset=utf-8");
  showToast(`${rows.length} acquisti esportati.`);
}

function exportRostersXlsx() {
  if (!window.XLSX) { showToast("La libreria Excel non è disponibile.", true); return; }
  const bought = engine.state.players.filter((player) => player.boughtBy);
  const rowFor = (player) => {
    const team = engine.state.settings.teams.find((item) => item.id === player.boughtBy);
    return {
      ID: player.id, R: player.role, RM: player.mantraRole, Nome: player.name,
      "Squadra reale": player.club, Fantasquadra: team?.name || "", Costo: player.price,
    };
  };
  const workbook = XLSX.utils.book_new();
  const summary = bought.slice().sort((a, b) => {
    const teamA = engine.state.settings.teams.find((item) => item.id === a.boughtBy)?.name || "";
    const teamB = engine.state.settings.teams.find((item) => item.id === b.boughtBy)?.name || "";
    return teamA.localeCompare(teamB, "it") || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, "it");
  }).map(rowFor);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Tutte le rose");
  const credits = engine.state.settings.teams.map((team) => {
    const stats = engine.teamStats(team.id);
    return { Fantasquadra: team.name, "Crediti iniziali": engine.state.settings.initialCredits, Spesi: stats.spent, Residui: stats.credits, Giocatori: stats.total };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(credits), "Crediti");
  const usedNames = new Set(["Tutte le rose", "Crediti"]);
  engine.state.settings.teams.forEach((team, index) => {
    const players = engine.teamPlayers(team.id).slice().sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, "it"));
    let sheetName = team.name.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || `Squadra ${index + 1}`;
    const base = sheetName;
    let suffix = 2;
    while (usedNames.has(sheetName)) sheetName = `${base.slice(0, 28)} ${suffix++}`;
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(players.map(rowFor)), sheetName);
  });
  XLSX.writeFile(workbook, `fantapol-rose-${dateStamp()}.xlsx`);
  showToast("Excel completo delle rose scaricato.");
}

function exportAuditCsv() {
  const headers = ["Data e ora", "Operazione", "Giocatore", "Ruolo", "Squadra reale", "Fantasquadra", "Prezzo", "Operazione annullata"];
  const rows = engine.state.auditLog.map((event) => {
    const player = engine.getPlayer(event.playerId);
    const team = engine.state.settings.teams.find((item) => item.id === event.teamId);
    return [event.timestamp, event.type, player?.name || "", player?.mantraRole || event.role || "", player?.club || "", team?.name || "", event.price ?? "", event.revertedType || ""];
  });
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  download(`fantapol-registro-${dateStamp()}.csv`, csv, "text/csv;charset=utf-8");
  showToast("Registro CSV scaricato.");
}

async function importBackup(file) {
  try {
    const state = JSON.parse(await file.text());
    engine = AuctionEngine.restore(state);
    saveState();
    showAuction();
    showToast("Backup ripristinato correttamente.");
  } catch (err) { showToast(err.message || "Backup non valido.", true); }
}

function resetCallingAfterRosterEdit() {
  engine.state.finished = false;
  engine.state.finishedAt = null;
  if (engine.state.auctionStatus === "finished") engine.state.auctionStatus = "running";
  engine.state.upcomingPlayerIds = [];
  engine.state.exhaustedRoles = [];
  engine.state.currentPlayerId = null;
  engine.state.currentRole = "P";
  if (engine.roleComplete("P") && engine.state.settings.callMode === "total-random") engine.state.currentRole = "MIX";
  try { engine.chooseNext(); } catch (error) { showToast(error.message, true); }
}

function renderRosterEditor() {
  const teamFilter = $("#editorTeamFilter").value;
  const query = normalizeSearch($("#editorSearch").value);
  const players = engine.state.players
    .filter((player) => player.boughtBy)
    .filter((player) => !teamFilter || player.boughtBy === teamFilter)
    .filter((player) => !query || normalizeSearch(`${player.name} ${player.club}`).includes(query))
    .sort((a, b) => {
      const teamA = engine.state.settings.teams.findIndex((team) => team.id === a.boughtBy);
      const teamB = engine.state.settings.teams.findIndex((team) => team.id === b.boughtBy);
      return teamA - teamB || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, "it");
    });
  const options = engine.state.settings.teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("");
  $("#rosterEditorList").innerHTML = players.length ? players.map((player) => {
    const owner = engine.state.settings.teams.find((team) => team.id === player.boughtBy);
    return `<article class="roster-editor-row" data-player-id="${escapeHtml(player.id)}">
      <span class="r ${player.role}">${player.role}</span>
      <span class="editor-player"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.club)} · ${escapeHtml(player.mantraRole)}</small></span>
      <select class="editor-owner" aria-label="Squadra di ${escapeHtml(player.name)}">${options}</select>
      <input class="editor-price" type="number" min="1" step="1" value="${player.price}" aria-label="Prezzo di ${escapeHtml(player.name)}">
      <button class="btn btn-secondary editor-save" type="button">Salva</button>
      <button class="btn btn-ghost editor-release" type="button">Svincola</button>
      <span class="editor-owner-name">${escapeHtml(owner?.name || "")}</span>
    </article>`;
  }).join("") : '<p class="audit-empty">Nessun giocatore acquistato corrisponde al filtro.</p>';
  $("#rosterEditorList").querySelectorAll(".roster-editor-row").forEach((row) => {
    const player = engine.getPlayer(row.dataset.playerId);
    row.querySelector(".editor-owner").value = player.boughtBy;
    row.querySelector(".editor-save").addEventListener("click", () => {
      try {
        const nextOwner = row.querySelector(".editor-owner").value;
        if (nextOwner !== player.boughtBy) rosterStructureDirty = true;
        engine.updatePurchase(player.id, nextOwner, Number(row.querySelector(".editor-price").value));
        saveState(); renderRosterEditor(); showToast(`${player.name}: modifica salvata.`);
      } catch (error) { showToast(error.message, true); }
    });
    row.querySelector(".editor-release").addEventListener("click", () => {
      const owner = engine.state.settings.teams.find((team) => team.id === player.boughtBy);
      if (!confirm(`Svincolare ${player.name} da ${owner?.name || "questa squadra"}? Saranno restituiti ${player.price} crediti.`)) return;
      rosterStructureDirty = true;
      engine.updatePurchase(player.id, null);
      saveState(); renderRosterEditor(); showToast(`${player.name} svincolato.`);
    });
  });
}

function showRosterEditor() {
  rosterStructureDirty = false;
  const options = engine.state.settings.teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("");
  $("#editorTeamFilter").innerHTML = `<option value="">Tutte le squadre</option>${options}`;
  $("#editorSearch").value = "";
  renderRosterEditor();
  rosterEditorDialog.showModal();
}

function closeRosterEditor() {
  rosterEditorDialog.close();
  if (rosterStructureDirty || !engine.currentPlayer) resetCallingAfterRosterEdit();
  saveState();
  render();
}

function parseCsvTable(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(value.trim()); value = ""; }
    else if (char === "\n") {
      row.push(value.replace(/\r$/, "").trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = []; value = "";
    } else value += char;
  }
  return rows;
}

function repairPurchasesFromCsv(text) {
  const rows = parseCsvTable(text);
  if (!rows.length) throw new Error("Il CSV è vuoto.");
  const normalizedHeader = rows[0].map((cell) => normalizeSearch(cell));
  const hasHeader = normalizedHeader.includes("id") && (normalizedHeader.includes("fantasquadra") || normalizedHeader.includes("squadra"));
  let purchases;
  if (hasHeader) {
    const column = (name) => normalizedHeader.indexOf(name);
    const teamColumn = column("fantasquadra") >= 0 ? column("fantasquadra") : column("squadra");
    const idColumn = column("id");
    const costColumn = column("costo");
    const statusColumn = column("stato");
    purchases = rows.slice(1).filter((row) => (
      row[teamColumn] && row[idColumn] && row[costColumn]
      && (statusColumn < 0 || normalizeSearch(row[statusColumn]) === "acquistato")
    )).map((row) => ({ teamName: row[teamColumn], playerId: row[idColumn], price: Number(row[costColumn]) }));
  } else {
    purchases = rows.map((row) => ({ teamName: row[0], playerId: row[1], price: Number(row[2]) }));
  }
  purchases = purchases.filter((item) => item.teamName && item.playerId && Number.isInteger(item.price) && item.price >= 1);
  if (!purchases.length) throw new Error("Non trovo righe valide nel formato squadra,id,costo.");
  return purchases;
}

async function startRepairAuction(event) {
  event.preventDefault();
  const error = $("#repairError");
  error.textContent = "";
  try {
    const backupFile = $("#repairBackupInput").files[0];
    const listFile = $("#repairListInput").files[0];
    if (!backupFile || !listFile) throw new Error("Seleziona sia il backup precedente sia il listone aggiornato.");
    const updatedPlayers = await parseWorkbook(listFile);
    const isJson = backupFile.name.toLowerCase().endsWith(".json");
    let settings;
    let purchases;
    let supplyWarnings = [];
    if (isJson) {
      const previous = AuctionEngine.restore(JSON.parse(await backupFile.text()));
      settings = { ...previous.state.settings, auctionType: "repair", listName: listFile.name };
      purchases = previous.state.players.filter((player) => player.boughtBy).map((player) => ({
        playerId: player.id, teamId: player.boughtBy, price: Number(player.price || 1), oldPlayer: player,
      }));
    } else {
      const csvPurchases = repairPurchasesFromCsv(await backupFile.text());
      const names = [...new Set(csvPurchases.map((item) => item.teamName.trim().toLocaleUpperCase("it-IT")))];
      const teams = names.map((name, index) => ({ id: slugId(name, index), name, externalId: "", logo: "" }));
      const teamIds = new Map(teams.map((team) => [team.name, team.id]));
      settings = {
        mode: $("#repairModeInput").value, callMode: "role-random",
        alphabetStarts: { D: "A", C: "A", A: "A" },
        initialCredits: Number($("#repairCreditsInput").value),
        limits: Object.fromEntries(ROLE_ORDER.map((role) => [role, Number($("#repairLimit" + role).value)])),
        teams, leagueName: "", leagueLogo: "", auctionType: "repair", listName: listFile.name,
      };
      if (teams.length < 2) throw new Error("Nel CSV devono essere presenti almeno due squadre.");
      supplyWarnings = validatePlayerSupply(settings, updatedPlayers, { strictSupply: false });
      settings.supplyWarnings = supplyWarnings;
      purchases = csvPurchases.map((item) => ({
        playerId: item.playerId,
        teamId: teamIds.get(item.teamName.trim().toLocaleUpperCase("it-IT")),
        price: item.price,
        oldPlayer: null,
      }));
    }
    const nextEngine = AuctionEngine.create(settings, updatedPlayers);
    const byId = new Map(nextEngine.state.players.map((player) => [String(player.id), player]));
    const byName = new Map(nextEngine.state.players.map((player) => [normalizeSearch(`${player.name}|${player.club}`), player]));
    let carried = 0;
    let missing = 0;
    purchases.forEach((purchase) => {
      const oldPlayer = purchase.oldPlayer;
      let target = byId.get(String(purchase.playerId));
      if (!target && oldPlayer) target = byName.get(normalizeSearch(`${oldPlayer.name}|${oldPlayer.club}`));
      if (!target && oldPlayer) {
        target = { ...oldPlayer, unlisted: true, calls: Math.max(1, Number(oldPlayer.calls || 0)) };
        nextEngine.state.players.push(target);
      }
      if (!target) { missing += 1; return; }
      target.boughtBy = purchase.teamId;
      target.price = Number(purchase.price || 1);
      target.calls = Math.max(1, Number(target.calls || 0));
      carried += 1;
    });
    nextEngine.state.history = [];
    nextEngine.state.auditLog = [{
      id: `repair-${Date.now()}`, type: "repair-import", timestamp: new Date().toISOString(),
      playerId: "", role: "", carried, missing,
    }];
    nextEngine.state.currentPlayerId = null;
    nextEngine.state.upcomingPlayerIds = [];
    nextEngine.state.currentRole = "P";
    nextEngine.state.finished = false;
    engine = nextEngine;
    saveState();
    repairDialog.close();
    welcomeView.classList.add("hidden");
    auctionView.classList.remove("hidden");
    startAuctionTimer();
    showRosterEditor();
    rosterStructureDirty = true;
    const shortageText = supplyWarnings.length
      ? ` · Listone corto: ${supplyWarnings.map(({ role, available, required }) => `${role} ${available}/${required}`).join(", ")}. L’asta non verrà bloccata.`
      : "";
    showToast(`${carried} giocatori mantenuti${missing ? ` · ${missing} non più nel listone` : ""}${shortageText} Ora scegli gli svincoli.`);
  } catch (err) { error.textContent = err.message || "Impossibile preparare l’asta di riparazione."; }
}

function togglePause() {
  if (engine.state.auctionStatus === "paused") engine.resume();
  else engine.pause();
  saveState();
  render();
}

function endAuction() {
  if (!confirm("Terminare l’asta? Verrà conservato tutto e potrai scaricare i file finali.")) return;
  engine.finishAuction();
  saveState();
  render();
}

$("#newAuctionBtn").addEventListener("click", () => {
  if (savedState() && !confirm("Creare una nuova asta? Il salvataggio corrente verrà sostituito solo quando avvii la nuova asta.")) return;
  openNewAuctionSettings();
});
$("#resumeBtn").addEventListener("click", () => {
  try { engine = AuctionEngine.restore(savedState()); showAuction(); } catch (err) { showToast(err.message, true); }
});
$("#welcomeBackupInput").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
$("#xlsxInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  parsedPlayers = null;
  if (!file) return;
  $("#fileNameLabel").textContent = "Lettura in corso…";
  try { parsedPlayers = await parseWorkbook(file); $("#fileNameLabel").textContent = `${file.name} · ${parsedPlayers.length} giocatori`; }
  catch (err) { $("#fileNameLabel").textContent = "File non valido"; $("#settingsError").textContent = err.message; }
});
$("#teamCountInput").addEventListener("input", (event) => populateTeamInputs(Math.max(2, Math.min(30, Number(event.target.value) || 2))));
$("#callModeInput").addEventListener("change", updateCallModeFields);
$("#resetNamesBtn").addEventListener("click", () => { draftTeamMetadata = []; populateTeamInputs(Number($("#teamCountInput").value), DEFAULT_TEAMS); });
$("#settingsForm").addEventListener("submit", submitSettings);
$("#closeSettingsBtn").addEventListener("click", () => settingsDialog.close());
$("#cancelSettingsBtn").addEventListener("click", () => settingsDialog.close());
$("#settingsBtn").addEventListener("click", openExistingSettings);
$("#homeBtn").addEventListener("click", returnHome);
$("#rostersBtn").addEventListener("click", () => showRosters());
$("#rostersIntegrationBtn").addEventListener("click", exportIntegrationCsv);
$("#closeRostersBtn").addEventListener("click", () => rostersDialog.close());
$("#auditBtn").addEventListener("click", () => { settingsDialog.close(); showAuditLog(); });
$("#closeAuditBtn").addEventListener("click", () => auditDialog.close());
$("#exportAuditBtn").addEventListener("click", exportAuditCsv);
$("#searchBtn").addEventListener("click", showPlayerSearch);
$("#closeSearchBtn").addEventListener("click", () => searchDialog.close());
$("#playerSearchInput").addEventListener("input", renderPlayerSearch);
$("#playerSearchRole").addEventListener("change", renderPlayerSearch);
$("#shareBtn").addEventListener("click", () => { settingsDialog.close(); showShareDialog(); });
$("#closeShareBtn").addEventListener("click", () => shareDialog.close());
$("#copyShareLinkBtn").addEventListener("click", copyShareLink);
$("#copyControllerLinkBtn").addEventListener("click", copyControllerLink);
$("#selectedTeamDisplay").addEventListener("click", () => $("#teamsGrid").scrollIntoView({ behavior: "smooth" }));
$("#backupBtn").addEventListener("click", () => { settingsDialog.close(); exportJson(); });
$("#finishJsonBtn").addEventListener("click", exportJson);
$("#finishIntegrationBtn").addEventListener("click", exportIntegrationCsv);
$("#finishXlsxBtn").addEventListener("click", exportRostersXlsx);
$("#finishCsvBtn").addEventListener("click", exportCsv);
$("#closeFinishBtn").addEventListener("click", () => finishDialog.close());
$("#skipBtn").addEventListener("click", () => performAction(() => engine.skip()));
$("#buyBtn").addEventListener("click", () => performAction(() => { engine.buy(engine.state.selectedTeamId, Number($("#priceInput").value)); $("#priceInput").value = 1; }));
$("#undoBtn").addEventListener("click", () => performAction(() => { if (!engine.undo()) throw new Error("Non ci sono azioni da annullare."); }, { showRoleTransition: false }));
$("#minusPriceBtn").addEventListener("click", () => $("#priceInput").value = Math.max(1, Number($("#priceInput").value) - 1));
$("#plusPriceBtn").addEventListener("click", () => $("#priceInput").value = Math.max(1, Number($("#priceInput").value) + 1));
$("#editRostersBtn").addEventListener("click", () => { settingsDialog.close(); showRosterEditor(); });
$("#closeRosterEditorBtn").addEventListener("click", closeRosterEditor);
$("#editorTeamFilter").addEventListener("change", renderRosterEditor);
$("#editorSearch").addEventListener("input", renderRosterEditor);
$("#pauseBtn").addEventListener("click", () => { settingsDialog.close(); togglePause(); });
$("#resumeAuctionBtn").addEventListener("click", togglePause);
$("#endAuctionBtn").addEventListener("click", endAuction);
$("#repairAuctionBtn").addEventListener("click", () => {
  $("#repairForm").reset();
  $("#repairBackupLabel").textContent = "Scegli il CSV o il backup JSON";
  $("#repairListLabel").textContent = "Scegli il nuovo listone";
  $("#repairError").textContent = "";
  repairDialog.showModal();
});
$("#repairForm").addEventListener("submit", startRepairAuction);
$("#closeRepairBtn").addEventListener("click", () => repairDialog.close());
$("#cancelRepairBtn").addEventListener("click", () => repairDialog.close());
$("#repairBackupInput").addEventListener("change", (event) => { $("#repairBackupLabel").textContent = event.target.files[0]?.name || "Scegli il CSV o il backup JSON"; });
$("#repairListInput").addEventListener("change", (event) => { $("#repairListLabel").textContent = event.target.files[0]?.name || "Scegli il nuovo listone"; });
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || auctionView.classList.contains("hidden") || ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); moveTeamSelection(-1); return; }
  if (event.key === "ArrowRight") { event.preventDefault(); moveTeamSelection(1); return; }
  if (event.key === "ArrowUp") { event.preventDefault(); moveTeamVertically(-1); return; }
  if (event.key === "ArrowDown") { event.preventDefault(); moveTeamVertically(1); return; }
  if (event.code === "Space") { event.preventDefault(); $("#skipBtn").click(); }
  if (event.key === "Enter") { event.preventDefault(); $("#buyBtn").click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); $("#undoBtn").click(); }
});
window.addEventListener("beforeunload", saveState);
setInterval(() => { if (engine) syncPublicState(); }, Math.max(750, Number(LIVE_CONFIG.syncIntervalMs) || 1000));

function sendLocalHeartbeat(closed = false) {
  if (!["127.0.0.1", "localhost"].includes(location.hostname) || location.port !== "8766") return;
  const url = `heartbeat.php${closed ? "?closed=1" : ""}`;
  if (closed && navigator.sendBeacon) navigator.sendBeacon(url, "");
  else fetch(url, { method: "POST", cache: "no-store", keepalive: true }).catch(() => {});
}

sendLocalHeartbeat();
setInterval(() => sendLocalHeartbeat(), 5000);
window.addEventListener("pagehide", () => sendLocalHeartbeat(true));
loadOnlineController();
