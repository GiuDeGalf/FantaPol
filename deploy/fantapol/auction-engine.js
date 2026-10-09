(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FantaAuctionEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const ROLE_ORDER = ["P", "D", "C", "A"];
  const MOVEMENT_ROLES = ["D", "C", "A"];

  function mantraGroup(value, fallback = "") {
    const tokens = String(value || "").toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    if (tokens.some((role) => ["POR", "P"].includes(role))) return "P";
    if (tokens.includes("E") && tokens.includes("C")) return "C";
    if (tokens.some((role) => ["DD", "DS", "DC", "E", "B"].includes(role))) return "D";
    if (tokens.some((role) => ["M", "C", "T", "W"].includes(role))) return "C";
    if (tokens.some((role) => ["A", "PC"].includes(role))) return "A";
    return String(fallback || "").toUpperCase();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `asta-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function makeShareCredentials() {
    const room = makeId().replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase();
    const token = `${makeId()}-${makeId()}`;
    return { room, token };
  }

  class AuctionEngine {
    constructor(state, randomFn = Math.random) {
      this.state = state;
      this.random = randomFn;
      if (!this.state.settings.callMode) this.state.settings.callMode = "role-random";
      this.state.settings.alphabetStarts = {
        D: "A", C: "A", A: "A",
        ...(this.state.settings.alphabetStarts || {}),
      };
      if (!Array.isArray(this.state.upcomingPlayerIds)) this.state.upcomingPlayerIds = [];
      if (!Array.isArray(this.state.exhaustedRoles)) this.state.exhaustedRoles = [];
      let regroupedPlayers = false;
      if (this.state.settings.mode === "mantra") {
        this.state.players.forEach((player) => {
          const correctedRole = mantraGroup(player.mantraRole, player.role);
          if (ROLE_ORDER.includes(correctedRole) && correctedRole !== player.role) {
            player.role = correctedRole;
            regroupedPlayers = true;
          }
        });
      }
      if (!this.state.auctionStatus) this.state.auctionStatus = this.state.finished ? "finished" : "running";
      if (!Number.isFinite(this.state.totalPausedMs)) this.state.totalPausedMs = 0;
      if (!this.state.sharing?.room || !this.state.sharing?.token) this.state.sharing = makeShareCredentials();
      if (!Array.isArray(this.state.auditLog)) {
        this.state.auditLog = (this.state.history || []).map((action, index) => {
          const player = this.state.players.find((item) => item.id === String(action.playerId));
          return {
            id: `migrated-${index + 1}`,
            type: action.type,
            timestamp: action.occurredAt || this.state.updatedAt,
            playerId: action.playerId,
            role: player?.role || action.roleBefore,
            teamId: action.type === "buy" ? player?.boughtBy || null : null,
            price: action.type === "buy" ? player?.price ?? null : null,
          };
        });
      }
      if (regroupedPlayers && !this.state.finished) {
        const current = this.state.players.find((player) => player.id === String(this.state.currentPlayerId));
        const wrongPhase = current && this.state.currentRole !== "MIX" && current.role !== this.state.currentRole;
        if (wrongPhase || this.roleComplete(this.state.currentRole)) {
          this.state.currentPlayerId = null;
          this.state.upcomingPlayerIds = [];
          this.chooseNext();
        }
      }
      if (this.state.currentPlayerId && !this.state.finished && this.state.upcomingPlayerIds.length === 0) {
        this.planUpcoming(3);
      }
    }

    static create(settings, players, randomFn = Math.random) {
      const cleanPlayers = players.map((player, index) => ({
        id: String(player.id ?? index + 1),
        role: settings.mode === "mantra"
          ? mantraGroup(player.mantraRole, player.role)
          : String(player.role || "").toUpperCase(),
        classicRole: String(player.classicRole || player.role || "").toUpperCase(),
        mantraRole: String(player.mantraRole || player.role || ""),
        name: String(player.name || "Senza nome"),
        club: String(player.club || "—"),
        quotation: Number(player.quotation || 0),
        mantraQuotation: Number(player.mantraQuotation ?? player.quotation ?? 0),
        fvm: Number(player.fvm || 0),
        mantraFvm: Number(player.mantraFvm ?? player.fvm ?? 0),
        calls: 0,
        boughtBy: null,
        price: null,
      })).filter((player) => ROLE_ORDER.includes(player.role));

      const now = new Date().toISOString();
      const state = {
        version: 2,
        auctionId: makeId(),
        createdAt: now,
        updatedAt: now,
        settings: clone(settings),
        players: cleanPlayers,
        currentRole: "P",
        currentPlayerId: null,
        selectedTeamId: settings.teams[0]?.id || null,
        history: [],
        auditLog: [],
        upcomingPlayerIds: [],
        exhaustedRoles: [],
        sharing: makeShareCredentials(),
        auctionType: settings.auctionType || "standard",
        auctionStatus: "running",
        pausedAt: null,
        totalPausedMs: 0,
        finishedAt: null,
        finished: false,
      };
      const engine = new AuctionEngine(state, randomFn);
      engine.chooseNext();
      return engine;
    }

    static restore(state, randomFn = Math.random) {
      if (!state || state.version !== 2 || !Array.isArray(state.players)) {
        throw new Error("Il file di backup non è compatibile con questa versione.");
      }
      return new AuctionEngine(clone(state), randomFn);
    }

    touch() {
      this.state.updatedAt = new Date().toISOString();
    }

    getPlayer(id) {
      return this.state.players.find((player) => player.id === String(id));
    }

    get currentPlayer() {
      return this.getPlayer(this.state.currentPlayerId);
    }

    elapsedMs(now = Date.now()) {
      const end = this.state.auctionStatus === "finished"
        ? new Date(this.state.finishedAt || this.state.updatedAt).getTime()
        : this.state.auctionStatus === "paused"
          ? new Date(this.state.pausedAt || this.state.updatedAt).getTime()
          : now;
      return Math.max(0, end - new Date(this.state.createdAt).getTime() - Number(this.state.totalPausedMs || 0));
    }

    assertRunning() {
      if (this.state.auctionStatus === "paused") throw new Error("L’asta è in pausa.");
      if (this.state.auctionStatus === "finished") throw new Error("L’asta è terminata.");
    }

    quoteFor(player) {
      return this.state.settings.mode === "mantra" ? player.mantraQuotation : player.quotation;
    }

    fvmFor(player) {
      return this.state.settings.mode === "mantra" ? player.mantraFvm : player.fvm;
    }

    teamPlayers(teamId) {
      return this.state.players.filter((player) => player.boughtBy === teamId);
    }

    teamStats(teamId) {
      const roster = this.teamPlayers(teamId);
      const spent = roster.reduce((sum, player) => sum + Number(player.price || 0), 0);
      const counts = Object.fromEntries(ROLE_ORDER.map((role) => [
        role,
        roster.filter((player) => player.role === role).length,
      ]));
      const totalSlots = ROLE_ORDER.reduce((sum, role) => sum + Number(this.state.settings.limits[role] || 0), 0);
      return {
        roster,
        spent,
        credits: Number(this.state.settings.initialCredits) - spent,
        counts,
        total: roster.length,
        totalSlots,
      };
    }

    roleComplete(role) {
      if (role === "MIX") return MOVEMENT_ROLES.every((item) => this.roleComplete(item));
      if (this.state.auctionType === "repair" && this.state.exhaustedRoles.includes(role)) return true;
      const limit = Number(this.state.settings.limits[role] || 0);
      return this.state.settings.teams.every((team) => this.teamStats(team.id).counts[role] >= limit);
    }

    phasePool(players = this.state.players) {
      if (this.state.currentRole === "MIX") {
        return players.filter((player) => (
          MOVEMENT_ROLES.includes(player.role) && !this.roleComplete(player.role) && !player.boughtBy
        ));
      }
      return players.filter((player) => player.role === this.state.currentRole && !player.boughtBy);
    }

    chooseNext() {
      while (this.roleComplete(this.state.currentRole)) {
        this.state.upcomingPlayerIds = [];
        if (this.state.currentRole === "P" && this.state.settings.callMode === "total-random") {
          this.state.currentRole = "MIX";
          continue;
        }
        if (this.state.currentRole === "MIX") {
          this.state.currentPlayerId = null;
          this.state.finished = true;
          this.state.auctionStatus = "finished";
          this.state.finishedAt = new Date().toISOString();
          this.touch();
          return null;
        }
        const nextIndex = ROLE_ORDER.indexOf(this.state.currentRole) + 1;
        if (nextIndex >= ROLE_ORDER.length) {
          this.state.currentPlayerId = null;
          this.state.finished = true;
          this.state.auctionStatus = "finished";
          this.state.finishedAt = new Date().toISOString();
          this.touch();
          return null;
        }
        this.state.currentRole = ROLE_ORDER[nextIndex];
      }

      const pool = this.phasePool();
      if (!pool.length) {
        if (this.state.auctionType === "repair") {
          const exhausted = this.state.currentRole === "MIX"
            ? MOVEMENT_ROLES.filter((role) => !this.roleComplete(role))
            : [this.state.currentRole];
          this.state.exhaustedRoles = [...new Set([...this.state.exhaustedRoles, ...exhausted])];
          this.state.currentPlayerId = null;
          this.state.upcomingPlayerIds = [];
          this.touch();
          return this.chooseNext();
        }
        throw new Error(`Non ci sono abbastanza giocatori di ruolo ${this.state.currentRole} per completare tutte le rose.`);
      }

      const minimumCalls = Math.min(...pool.map((player) => player.calls));
      const eligible = pool.filter((player) => player.calls === minimumCalls);
      const queuedId = this.state.upcomingPlayerIds.shift();
      let next = eligible.find((player) => player.id === queuedId);
      if (!next) next = this.pickPlayer(eligible, this.state.currentRole);
      this.state.currentPlayerId = next.id;
      this.planUpcoming(3);
      this.touch();
      return next;
    }

    pickPlayer(eligible, role) {
      if (role === "P") {
        return eligible.slice().sort((a, b) => (
          this.quoteFor(b) - this.quoteFor(a) || a.name.localeCompare(b.name, "it")
        ))[0];
      }
      if (this.state.settings.callMode === "alphabetical" && role !== "MIX") {
        const start = String(this.state.settings.alphabetStarts?.[role] || "A").toUpperCase();
        const normalize = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        const circularName = (player) => {
          const name = normalize(player.name);
          return `${name >= start ? "0" : "1"}:${name}`;
        };
        return eligible.slice().sort((a, b) => circularName(a).localeCompare(circularName(b), "it"))[0];
      }
      return eligible[Math.floor(this.random() * eligible.length)];
    }

    planUpcoming(count = 3) {
      if (!this.currentPlayer || this.state.finished) {
        this.state.upcomingPlayerIds = [];
        return [];
      }
      const simulated = this.phasePool()
        .map((player) => ({ ...player }));
      const current = simulated.find((player) => player.id === this.state.currentPlayerId);
      if (current) current.calls += 1;
      const planned = [];
      for (let index = 0; index < count && simulated.length; index += 1) {
        const minimumCalls = Math.min(...simulated.map((player) => player.calls));
        const eligible = simulated.filter((player) => player.calls === minimumCalls);
        const next = this.pickPlayer(eligible, this.state.currentRole);
        if (!next) break;
        planned.push(next.id);
        next.calls += 1;
      }
      this.state.upcomingPlayerIds = planned;
      return planned;
    }

    upcomingPlayers() {
      return this.state.upcomingPlayerIds.map((id) => this.getPlayer(id)).filter(Boolean);
    }

    manualCallCandidates() {
      const pool = this.phasePool();
      if (!pool.length) return [];
      const minimumCalls = Math.min(...pool.map((player) => player.calls));
      return pool.filter((player) => player.calls === minimumCalls);
    }

    callManually(playerId) {
      const player = this.getPlayer(playerId);
      if (!player || player.boughtBy) throw new Error("Il giocatore selezionato non è disponibile.");
      if (this.state.currentRole !== "MIX" && player.role !== this.state.currentRole) throw new Error(`In questa fase si possono chiamare solo giocatori di ruolo ${this.state.currentRole}.`);
      if (this.state.currentRole === "MIX" && (!MOVEMENT_ROLES.includes(player.role) || this.roleComplete(player.role))) throw new Error("Questo ruolo è già completo.");
      if (!this.manualCallCandidates().some((candidate) => candidate.id === player.id)) {
        throw new Error("Questo giocatore deve attendere il prossimo giro di chiamate.");
      }
      this.state.currentPlayerId = player.id;
      this.state.upcomingPlayerIds = [];
      this.planUpcoming(3);
      this.touch();
      return player;
    }

    snapshotAction(type, player) {
      this.state.history.push({
        type,
        occurredAt: new Date().toISOString(),
        playerId: player.id,
        playerBefore: {
          calls: player.calls,
          boughtBy: player.boughtBy,
          price: player.price,
        },
        roleBefore: this.state.currentRole,
        selectedTeamBefore: this.state.selectedTeamId,
      });
      if (this.state.history.length > 100) this.state.history.shift();
    }

    skip() {
      this.assertRunning();
      const player = this.currentPlayer;
      if (!player) throw new Error("Nessun giocatore da passare.");
      this.snapshotAction("skip", player);
      player.calls += 1;
      this.recordAudit("skip", player);
      this.chooseNext();
      return player;
    }

    maxBid(teamId) {
      const stats = this.teamStats(teamId);
      if (stats.total >= stats.totalSlots) return 0;
      const slotsAfterThisPurchase = Math.max(0, stats.totalSlots - stats.total - 1);
      return Math.max(0, stats.credits - slotsAfterThisPurchase);
    }

    buy(teamId, price) {
      this.assertRunning();
      const player = this.currentPlayer;
      const team = this.state.settings.teams.find((item) => item.id === teamId);
      const cleanPrice = Number(price);
      if (!player) throw new Error("Nessun giocatore da aggiudicare.");
      if (!team) throw new Error("Seleziona una squadra valida.");
      if (!Number.isInteger(cleanPrice) || cleanPrice < 1) throw new Error("Inserisci un costo intero di almeno 1 credito.");
      const stats = this.teamStats(teamId);
      const limit = Number(this.state.settings.limits[player.role] || 0);
      if (stats.counts[player.role] >= limit) throw new Error(`${team.name} ha già completato il ruolo ${player.role}.`);
      const max = this.maxBid(teamId);
      if (cleanPrice > max) {
        throw new Error(`Offerta massima: ${max} crediti, lasciando 1 credito per ogni slot ancora vuoto.`);
      }

      this.snapshotAction("buy", player);
      player.calls += 1;
      player.boughtBy = teamId;
      player.price = cleanPrice;
      this.recordAudit("buy", player, { teamId, price: cleanPrice });
      this.chooseNext();
      return player;
    }

    undo() {
      this.assertRunning();
      const action = this.state.history.pop();
      if (!action) return false;
      const player = this.getPlayer(action.playerId);
      Object.assign(player, action.playerBefore);
      this.state.currentRole = action.roleBefore;
      this.state.currentPlayerId = action.playerId;
      this.state.selectedTeamId = action.selectedTeamBefore;
      this.state.finished = false;
      this.state.upcomingPlayerIds = [];
      this.planUpcoming(3);
      this.recordAudit("undo", player, { revertedType: action.type });
      this.touch();
      return true;
    }

    pause() {
      if (this.state.auctionStatus !== "running") return false;
      this.state.auctionStatus = "paused";
      this.state.pausedAt = new Date().toISOString();
      this.touch();
      return true;
    }

    resume() {
      if (this.state.auctionStatus !== "paused") return false;
      this.state.totalPausedMs += Math.max(0, Date.now() - new Date(this.state.pausedAt).getTime());
      this.state.pausedAt = null;
      this.state.auctionStatus = "running";
      this.touch();
      return true;
    }

    finishAuction() {
      if (this.state.auctionStatus === "finished") return false;
      if (this.state.auctionStatus === "paused") this.resume();
      this.state.auctionStatus = "finished";
      this.state.finishedAt = new Date().toISOString();
      this.state.finished = true;
      this.recordAudit("finish", this.currentPlayer || { id: "", role: this.state.currentRole });
      this.touch();
      return true;
    }

    updatePurchase(playerId, teamId, price = null) {
      const player = this.getPlayer(playerId);
      if (!player) throw new Error("Giocatore non trovato.");
      const oldTeamId = player.boughtBy;
      const oldPrice = player.price;
      if (teamId === null || teamId === "") {
        player.boughtBy = null;
        player.price = null;
        this.recordAudit("release", player, { previousTeamId: oldTeamId, previousPrice: oldPrice });
      } else {
        const team = this.state.settings.teams.find((item) => item.id === teamId);
        const cleanPrice = Number(price);
        if (!team) throw new Error("Squadra non valida.");
        if (!Number.isInteger(cleanPrice) || cleanPrice < 1) throw new Error("Il prezzo deve essere un intero di almeno 1 credito.");
        const rosterWithoutPlayer = this.teamPlayers(teamId).filter((item) => item.id !== player.id);
        const roleCount = rosterWithoutPlayer.filter((item) => item.role === player.role).length;
        if (roleCount >= Number(this.state.settings.limits[player.role] || 0)) throw new Error(`${team.name} ha già completato il ruolo ${player.role}.`);
        const spentWithoutPlayer = rosterWithoutPlayer.reduce((sum, item) => sum + Number(item.price || 0), 0);
        if (spentWithoutPlayer + cleanPrice > Number(this.state.settings.initialCredits)) throw new Error(`${team.name} non ha crediti sufficienti.`);
        player.boughtBy = teamId;
        player.price = cleanPrice;
        this.recordAudit("edit", player, { teamId, price: cleanPrice, previousTeamId: oldTeamId, previousPrice: oldPrice });
      }
      this.state.finished = false;
      if (this.state.auctionStatus === "finished") {
        this.state.auctionStatus = "paused";
        this.state.pausedAt = new Date().toISOString();
        this.state.finishedAt = null;
      }
      this.state.upcomingPlayerIds = [];
      this.touch();
      return player;
    }

    recordAudit(type, player, details = {}) {
      this.state.auditLog.push({
        id: makeId(),
        type,
        timestamp: new Date().toISOString(),
        playerId: player.id,
        role: player.role,
        ...details,
      });
    }

    selectTeam(teamId) {
      if (this.state.settings.teams.some((team) => team.id === teamId)) {
        this.state.selectedTeamId = teamId;
        this.touch();
      }
    }

    selectNearestAvailableTeam(role, fromTeamId = this.state.selectedTeamId) {
      if (!ROLE_ORDER.includes(role) || !this.state.settings.teams.length) return null;
      const teams = this.state.settings.teams;
      const startIndex = Math.max(0, teams.findIndex((team) => team.id === fromTeamId));
      for (let offset = 0; offset < teams.length; offset += 1) {
        const team = teams[(startIndex + offset) % teams.length];
        if (this.teamStats(team.id).counts[role] < Number(this.state.settings.limits[role] || 0)) {
          if (this.state.selectedTeamId !== team.id) {
            this.state.selectedTeamId = team.id;
            this.touch();
          }
          return team;
        }
      }
      return null;
    }

    progress() {
      const required = this.state.settings.teams.length * ROLE_ORDER.reduce(
        (sum, role) => sum + Number(this.state.settings.limits[role] || 0), 0,
      );
      const bought = this.state.players.filter((player) => player.boughtBy).length;
      return { bought, required, percentage: required ? Math.round((bought / required) * 100) : 0 };
    }

    integrationRows() {
      const teamOrder = new Map(this.state.settings.teams.map((team, index) => [team.id, index]));
      return this.state.players
        .filter((player) => player.boughtBy)
        .slice()
        .sort((a, b) => (
          (teamOrder.get(a.boughtBy) ?? 999) - (teamOrder.get(b.boughtBy) ?? 999)
          || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
          || a.name.localeCompare(b.name, "it")
        ))
        .map((player) => ({
          team: this.state.settings.teams.find((item) => item.id === player.boughtBy)?.name || "",
          id: player.id,
          cost: Number(player.price),
        }));
    }
  }

  return { AuctionEngine, ROLE_ORDER, mantraGroup };
});
