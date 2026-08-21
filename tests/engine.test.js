const assert = require("node:assert/strict");
const { AuctionEngine } = require("../auction-engine.js");

function settings(overrides = {}) {
  return {
    mode: "classic",
    callMode: "role-random",
    alphabetStarts: { D: "A", C: "A", A: "A" },
    initialCredits: 100,
    limits: { P: 1, D: 1, C: 1, A: 1 },
    teams: [{ id: "t1", name: "Team 1" }],
    ...overrides,
  };
}

function players(names = {}) {
  return [
    { id: "p1", role: "P", name: "Portiere Uno", quotation: 20 },
    { id: "p2", role: "P", name: "Portiere Due", quotation: 10 },
    { id: "d1", role: "D", name: names.d1 || "Alfa" },
    { id: "d2", role: "D", name: names.d2 || "Zeta" },
    { id: "c1", role: "C", name: names.c1 || "Beta" },
    { id: "c2", role: "C", name: names.c2 || "Omega" },
    { id: "a1", role: "A", name: names.a1 || "Gamma" },
    { id: "a2", role: "A", name: names.a2 || "Sigma" },
  ];
}

// Il giocatore mostrato dopo un'azione non conta come chiamato; undo ripristina tutto.
{
  const engine = AuctionEngine.create(settings(), players(), () => 0);
  const first = engine.currentPlayer;
  engine.skip();
  const displayedAfter = engine.currentPlayer;
  assert.equal(first.calls, 1);
  assert.equal(displayedAfter.calls, 0);
  assert.equal(engine.state.players.filter((player) => player.calls > 0).length, 1);
  engine.undo();
  assert.equal(engine.currentPlayer.id, first.id);
  assert.equal(first.calls, 0);
  assert.equal(displayedAfter.calls, 0);
  assert.equal(engine.state.players.filter((player) => player.calls > 0).length, 0);
}

// I portieri sono sempre ordinati per quotazione, anche in random totale.
{
  const engine = AuctionEngine.create(settings({ callMode: "total-random" }), players(), () => 0.99);
  assert.equal(engine.currentPlayer.id, "p1");
  engine.buy("t1", 1);
  assert.equal(engine.state.currentRole, "MIX");
  assert.ok(["D", "C", "A"].includes(engine.currentPlayer.role));
  assert.ok(engine.manualCallCandidates().some((player) => player.role !== engine.currentPlayer.role));
  while (!engine.state.finished) engine.buy("t1", 1);
  assert.equal(engine.teamStats("t1").total, 4);
  assert.deepEqual(engine.teamStats("t1").counts, { P: 1, D: 1, C: 1, A: 1 });
}

// L'ordine alfabetico riparte dalla lettera indicata e ricomincia circolarmente.
{
  const custom = settings({ callMode: "alphabetical", alphabetStarts: { D: "M", C: "A", A: "A" } });
  const engine = AuctionEngine.create(custom, players({ d1: "Bianchi", d2: "Neri" }), () => 0.5);
  engine.buy("t1", 1);
  assert.equal(engine.currentPlayer.name, "Neri");
  engine.skip();
  assert.equal(engine.currentPlayer.name, "Bianchi");
}

// I backup precedenti ricevono automaticamente le nuove impostazioni predefinite.
{
  const engine = AuctionEngine.create(settings(), players(), () => 0);
  delete engine.state.settings.callMode;
  delete engine.state.settings.alphabetStarts;
  const restored = AuctionEngine.restore(engine.state, () => 0);
  assert.equal(restored.state.settings.callMode, "role-random");
  assert.deepEqual(restored.state.settings.alphabetStarts, { D: "A", C: "A", A: "A" });
}

// L'export di integrazione usa squadra, ID originale del listone e costo, senza altri campi.
{
  const custom = settings({ teams: [{ id: "t1", name: "Team 1" }, { id: "t2", name: "Team 2" }] });
  custom.limits = { P: 1, D: 0, C: 0, A: 0 };
  const engine = AuctionEngine.create(custom, players(), () => 0);
  engine.buy("t2", 7);
  engine.buy("t1", 11);
  assert.deepEqual(engine.integrationRows(), [
    { team: "Team 1", id: "p2", cost: 11 },
    { team: "Team 2", id: "p1", cost: 7 },
  ]);
}

// In Mantra E;C e W;A vanno a centrocampo, mentre E puro resta in difesa.
{
  const custom = settings({ mode: "mantra", limits: { P: 1, D: 1, C: 1, A: 1 } });
  const mantraPlayers = [
    { id: "p", role: "P", mantraRole: "Por", name: "Portiere" },
    { id: "d", role: "C", mantraRole: "E", name: "Esterno" },
    { id: "c", role: "D", mantraRole: "E;C", name: "Esterno centrale" },
    { id: "w", role: "A", mantraRole: "W;A", name: "Ala" },
    { id: "a", role: "A", mantraRole: "A;Pc", name: "Punta" },
  ];
  const engine = AuctionEngine.create(custom, mantraPlayers, () => 0);
  assert.deepEqual(Object.fromEntries(engine.state.players.map((player) => [player.id, player.role])), { p: "P", d: "D", c: "C", w: "C", a: "A" });
}

// Pausa, ripresa e correzione di una rosa conservano uno stato coerente.
{
  const custom = settings({ limits: { P: 1, D: 0, C: 0, A: 0 } });
  const engine = AuctionEngine.create(custom, players(), () => 0);
  engine.pause();
  assert.throws(() => engine.buy("t1", 1), /pausa/);
  engine.resume();
  const player = engine.currentPlayer;
  engine.buy("t1", 4);
  engine.updatePurchase(player.id, "t1", 7);
  assert.equal(engine.getPlayer(player.id).price, 7);
  engine.updatePurchase(player.id, null);
  assert.equal(engine.getPlayer(player.id).boughtBy, null);
}

// Quando la squadra selezionata completa un ruolo, viene scelta la successiva disponibile.
{
  const custom = settings({
    teams: [{ id: "t1", name: "Team 1" }, { id: "t2", name: "Team 2" }, { id: "t3", name: "Team 3" }],
    limits: { P: 1, D: 0, C: 0, A: 0 },
  });
  const goalkeeperPool = players().concat({ id: "p3", role: "P", name: "Portiere Tre", quotation: 5 });
  const engine = AuctionEngine.create(custom, goalkeeperPool, () => 0);
  engine.buy("t1", 1);
  assert.equal(engine.selectNearestAvailableTeam("P", "t1").id, "t2");
  engine.buy("t2", 1);
  assert.equal(engine.selectNearestAvailableTeam("P", "t2").id, "t3");
}

// In riparazione un reparto corto non blocca l'asta: viene segnato come esaurito e si prosegue.
{
  const custom = settings({
    auctionType: "repair",
    limits: { P: 1, D: 1, C: 1, A: 3 },
  });
  const engine = AuctionEngine.create(custom, players(), () => 0);
  while (!engine.state.finished) engine.buy("t1", 1);
  assert.equal(engine.teamStats("t1").counts.A, 2);
  assert.ok(engine.state.exhaustedRoles.includes("A"));
  assert.equal(engine.state.auctionStatus, "finished");
}

console.log("engine.test.js: tutti i test superati");
