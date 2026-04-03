import express from "express";
import cors from "cors";
import http from "http";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  increment,
  runTransaction
} from "firebase/firestore";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const ROLES = {
  ADMIN: "admin",
  CAPTAIN: "captain",
  PLAYER: "player"
};

const SPORT_CATEGORIES = ["LAN Games", "Indoor Games", "Outdoor Games"];
const DEFAULT_SPORT_CATEGORY = "Outdoor Games";
const SPORT_CATALOG = [
  {
    category: "LAN Games",
    subcategory: "Laptop",
    games: ["Counter Strike", "Need for Speed", "Smash Karts"]
  },
  {
    category: "LAN Games",
    subcategory: "Mobile",
    games: ["BGMI", "Free Fire", "Mini Militia"]
  },
  {
    category: "LAN Games",
    subcategory: "GC",
    games: ["Subway Surfers", "Temple Run", "Fruit Ninja", "Dino Game"]
  },
  {
    category: "Indoor Games",
    subcategory: "",
    games: ["Table Tennis", "Carrom", "Chess"]
  },
  {
    category: "Outdoor Games",
    subcategory: "",
    games: ["Cricket", "Volleyball", "Hand Tennis", "Badminton"]
  }
];
const SPORT_DEFINITIONS = SPORT_CATALOG.flatMap((entry) =>
  entry.games.map((game) => ({
    game,
    category: entry.category,
    subcategory: entry.subcategory
  }))
);
const SPORT_DEFINITION_MAP = Object.fromEntries(
  SPORT_DEFINITIONS.map((entry) => [entry.game, entry])
);

const TEAMS = [
  { id: "thunder_titans", name: "Thunder Titans (1st Year)" },
  { id: "shadow_havoc", name: "Shadow Havoc (2nd Year)" },
  { id: "synergy_spark", name: "Synergy Spark (3rd Year)" }
];

/* ── Firestore helpers ───────────────────────────────────── */

async function getNextId(field) {
  const ref = doc(db, "meta", "counters");
  return await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const nextId = (data[field] || 0) + 1;
    transaction.update(ref, { [field]: nextId });
    return nextId;
  });
}

async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => d.data());
}

async function getUserByEmail(email) {
  const snap = await getDocs(
    query(collection(db, "users"), where("email", "==", email))
  );
  return snap.empty ? null : snap.docs[0].data();
}

async function getUserById(id) {
  const snap = await getDoc(doc(db, "users", String(id)));
  return snap.exists() ? snap.data() : null;
}

async function getTeamCaptain(teamId) {
  const snap = await getDocs(
    query(collection(db, "users"), where("role", "==", ROLES.CAPTAIN), where("teamId", "==", teamId))
  );
  return snap.empty ? null : snap.docs[0].data();
}

async function getTeamPlayers(teamId) {
  const snap = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );
  return snap.docs.map((d) => d.data()).filter((u) => u.role !== ROLES.ADMIN);
}

async function createUser(user) {
  await setDoc(doc(db, "users", String(user.id)), user);
}

async function createSession(user) {
  const token = crypto.randomUUID();
  await setDoc(doc(db, "sessions", token), { userId: user.id });
  return token;
}

async function getUserIdFromToken(token) {
  if (!token) return null;
  const snap = await getDoc(doc(db, "sessions", token));
  return snap.exists() ? snap.data().userId : null;
}

async function deleteSession(token) {
  await deleteDoc(doc(db, "sessions", token));
}

async function getAllFixtures() {
  const snap = await getDocs(collection(db, "fixtures"));
  return snap.docs.map((d) => d.data());
}

async function getFixtureById(id) {
  const snap = await getDoc(doc(db, "fixtures", String(id)));
  return snap.exists() ? snap.data() : null;
}

async function createFixture(fixture) {
  await setDoc(doc(db, "fixtures", String(fixture.id)), fixture);
}

async function deleteFixture(id) {
  await deleteDoc(doc(db, "fixtures", String(id)));
}

async function getSportStandings(game) {
  const snap = await getDoc(doc(db, "sportStandings", game));
  return snap.exists() ? snap.data() : null;
}

async function getAllSportStandings() {
  const snap = await getDocs(collection(db, "sportStandings"));
  const result = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    result[d.id] = data;
  });
  return result;
}

async function setSportStandings(game, data) {
  await setDoc(doc(db, "sportStandings", game), data);
}

async function getFinalizedSports() {
  const snap = await getDocs(collection(db, "finalizedSports"));
  const result = {};
  snap.docs.forEach((d) => {
    result[d.id] = d.data();
  });
  return result;
}

async function setFinalizedSport(game, data) {
  await setDoc(doc(db, "finalizedSports", game), data);
}

async function getOverallStandings() {
  const snap = await getDoc(doc(db, "meta", "overallStandings"));
  return snap.exists() ? snap.data().rows : [];
}

async function setOverallStandings(rows) {
  await setDoc(doc(db, "meta", "overallStandings"), { rows });
}

async function addMessage(msg) {
  await setDoc(doc(db, "messages", String(msg.id)), msg);
}

async function getMessages() {
  const snap = await getDocs(collection(db, "messages"));
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(-200);
}

async function addScoreUpdate(update) {
  await setDoc(doc(db, "scoreUpdates", String(update.id)), update);
}

async function getScoreUpdates() {
  const snap = await getDocs(collection(db, "scoreUpdates"));
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => String(b.id).localeCompare(String(a.id)))
    .slice(0, 200);
}

/* ── Standings logic ─────────────────────────────────────── */

function createEmptyStandingRow(teamId) {
  return { teamId, played: 0, won: 0, draw: 0, lost: 0, points: 0 };
}

function sortStandingsTable(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if ((b.firstPlaces || 0) !== (a.firstPlaces || 0))
      return (b.firstPlaces || 0) - (a.firstPlaces || 0);
    if ((b.secondPlaces || 0) !== (a.secondPlaces || 0))
      return (b.secondPlaces || 0) - (a.secondPlaces || 0);
    if ((b.won || 0) !== (a.won || 0)) return (b.won || 0) - (a.won || 0);
    if ((b.draw || 0) !== (a.draw || 0)) return (b.draw || 0) - (a.draw || 0);
    if ((a.lost || 0) !== (b.lost || 0)) return (a.lost || 0) - (b.lost || 0);
    return a.teamId.localeCompare(b.teamId);
  });
}

function normalizeStandingRow(row) {
  return { ...row, draw: row.draw || 0 };
}

function recomputeOverallStandings(currentFinalizedSports) {
  const totals = TEAMS.map((team) => ({
    teamId: team.id,
    points: 0,
    firstPlaces: 0,
    secondPlaces: 0,
    thirdPlaces: 0,
    sportsCount: 0
  }));

  Object.values(currentFinalizedSports).forEach((entry) => {
    if (!entry) return;
    const placements = [
      { teamId: entry.firstTeamId, field: "firstPlaces", points: 5 },
      { teamId: entry.secondTeamId, field: "secondPlaces", points: 3 },
      { teamId: entry.thirdTeamId, field: "thirdPlaces", points: 1 }
    ];
    placements.forEach((placement) => {
      const row = totals.find((c) => c.teamId === placement.teamId);
      if (!row) return;
      row.sportsCount += 1;
      row[placement.field] += 1;
      row.points += placement.points;
    });
  });

  return sortStandingsTable(totals);
}

async function buildStandingsPayload() {
  const allSportStandings = await getAllSportStandings();
  const finalizedSports = await getFinalizedSports();
  const overallStandings = await getOverallStandings();

  const bySport = {};
  const sportMeta = {};
  for (const [game, data] of Object.entries(allSportStandings)) {
    bySport[game] = sortStandingsTable(data.rows).map(normalizeStandingRow);
    sportMeta[game] = {
      category: data.category || DEFAULT_SPORT_CATEGORY,
      subcategory: data.subcategory || ""
    };
  }

  const serializedFinalized = Object.entries(finalizedSports)
    .map(([game, entry]) => ({ game, ...entry }))
    .sort((a, b) => a.game.localeCompare(b.game));

  return {
    overall: overallStandings.map(normalizeStandingRow),
    bySport,
    sportMeta,
    finalizedSports: serializedFinalized
  };
}

function applyFixtureResult(fixture, result) {
  const rules = {
    win: {
      teamA: { won: 1, draw: 0, lost: 0, points: 3 },
      teamB: { won: 0, draw: 0, lost: 1, points: 0 },
      label: `${fixture.teamA} beat ${fixture.teamB}`
    },
    loss: {
      teamA: { won: 0, draw: 0, lost: 1, points: 0 },
      teamB: { won: 1, draw: 0, lost: 0, points: 3 },
      label: `${fixture.teamB} beat ${fixture.teamA}`
    },
    draw: {
      teamA: { won: 0, draw: 1, lost: 0, points: 1 },
      teamB: { won: 0, draw: 1, lost: 0, points: 1 },
      label: `${fixture.teamA} drew with ${fixture.teamB}`
    }
  };
  return rules[result] || null;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    teamId: user.teamId
  };
}

/* ── Auth middleware ──────────────────────────────────────── */

function extractToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function getUserFromRequest(req) {
  const token = extractToken(req);
  if (!token) return null;
  const userId = await getUserIdFromToken(token);
  if (!userId) return null;
  return await getUserById(userId);
}

function requireAuth(req, res, next) {
  getUserFromRequest(req).then((user) => {
    if (!user) return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: "Auth check failed" }));
}

function requireAdmin(req, res, next) {
  getUserFromRequest(req).then((user) => {
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.role !== ROLES.ADMIN)
      return res.status(403).json({ error: "Admin access required" });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: "Auth check failed" }));
}

/* ── Express app ─────────────────────────────────────────── */

const app = express();
app.use(express.json());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: false }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ── Auth routes ─────────────────────────────────────────── */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, role, teamId } = req.body || {};
    const trimmedName = String(name || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const trimmedPassword = String(password || "").trim();
    const safeRole =
      role === ROLES.CAPTAIN || role === ROLES.PLAYER ? role : null;

    if (!trimmedName || !normalizedEmail || !trimmedPassword || !safeRole) {
      return res.status(400).json({ error: "name, email, password, and valid role are required" });
    }
    if (trimmedPassword.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }
    if (!teamId || !TEAMS.some((t) => t.id === teamId)) {
      return res.status(400).json({ error: "A valid team is required" });
    }

    const existing = await getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "User already exists with this email" });
    }

    if (safeRole === ROLES.CAPTAIN) {
      const existingCaptain = await getTeamCaptain(teamId);
      if (existingCaptain) {
        const teamName = TEAMS.find((t) => t.id === teamId)?.name || teamId;
        return res.status(409).json({ error: `${teamName} already has a captain: ${existingCaptain.name}` });
      }
    }

    const id = await getNextId("userId");
    const user = {
      id,
      name: trimmedName,
      email: normalizedEmail,
      password: trimmedPassword,
      role: safeRole,
      teamId
    };

    await createUser(user);
    const token = await createSession(user);

    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const trimmedPassword = String(password || "").trim();

    const user = await getUserByEmail(normalizedEmail);
    if (!user || user.password !== trimmedPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = await createSession(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    const token = extractToken(req);
    if (token) await deleteSession(token);
    res.status(204).end();
  } catch {
    res.status(204).end();
  }
});

/* ── Data routes ─────────────────────────────────────────── */

app.get("/api/teams", (req, res) => res.json(TEAMS));

app.get("/api/standings", async (req, res) => {
  try {
    res.json(await buildStandingsPayload());
  } catch (err) {
    console.error("Standings error:", err);
    res.status(500).json({ error: "Failed to load standings" });
  }
});

app.get("/api/fixtures", async (req, res) => {
  try {
    res.json(await getAllFixtures());
  } catch (err) {
    console.error("Fixtures error:", err);
    res.status(500).json({ error: "Failed to load fixtures" });
  }
});

app.get("/api/messages", async (req, res) => {
  try {
    res.json(await getMessages());
  } catch (err) {
    console.error("Messages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

app.get("/api/score-updates", async (req, res) => {
  try {
    res.json(await getScoreUpdates());
  } catch (err) {
    console.error("Score updates error:", err);
    res.status(500).json({ error: "Failed to load score updates" });
  }
});

/* ── Fixture creation ────────────────────────────────────── */

app.post("/api/fixtures", requireAdmin, async (req, res) => {
  try {
    const { category, subcategory, game, time, venue, teamAId, teamBId } = req.body || {};
    const teamA = TEAMS.find((t) => t.id === teamAId);
    const teamB = TEAMS.find((t) => t.id === teamBId);
    const sportDef = SPORT_DEFINITION_MAP[String(game || "").trim()] || null;
    const safeCategory =
      sportDef && SPORT_CATEGORIES.includes(category) && sportDef.category === category
        ? category
        : null;
    const safeSubcategory =
      sportDef && (sportDef.subcategory || "") === String(subcategory || "")
        ? sportDef.subcategory
        : null;

    if (!safeCategory || safeSubcategory === null || !game || !time || !venue || !teamA || !teamB) {
      return res.status(400).json({ error: "category, subcategory, game, time, venue, teamAId, and teamBId are required" });
    }
    if (teamA.id === teamB.id) {
      return res.status(400).json({ error: "A fixture must have two different teams" });
    }

    const id = await getNextId("fixtureId");
    const fixture = {
      id,
      category: safeCategory,
      subcategory: safeSubcategory,
      teamAId: teamA.id,
      teamBId: teamB.id,
      game: String(game),
      time: String(time),
      venue: String(venue),
      teamA: teamA.name,
      teamB: teamB.name
    };

    await createFixture(fixture);

    // Ensure sport standings exist for this game
    const existing = await getSportStandings(fixture.game);
    if (!existing) {
      await setSportStandings(fixture.game, {
        game: fixture.game,
        category: fixture.category,
        subcategory: fixture.subcategory,
        rows: TEAMS.map((t) => createEmptyStandingRow(t.id))
      });
      io.emit("standings:updated", await buildStandingsPayload());
    }

    io.emit("fixture:created", fixture);
    res.status(201).json(fixture);
  } catch (err) {
    console.error("Create fixture error:", err);
    res.status(500).json({ error: "Failed to create fixture" });
  }
});

/* ── Delete fixture ─────────────────────────────────────── */

app.delete("/api/fixtures/:fixtureId", requireAdmin, async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);
    const fixture = await getFixtureById(fixtureId);
    if (!fixture) {
      return res.status(404).json({ error: "Fixture not found" });
    }
    await deleteFixture(fixtureId);
    const remaining = await getAllFixtures();
    io.emit("fixtures:updated", remaining);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete fixture error:", err);
    res.status(500).json({ error: "Failed to delete fixture" });
  }
});

/* ── Fixture result ──────────────────────────────────────── */

app.post("/api/fixtures/:fixtureId/result", requireAdmin, async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);
    const { result } = req.body || {};
    const fixture = await getFixtureById(fixtureId);
    const fixtureResult = fixture ? applyFixtureResult(fixture, result) : null;

    if (!fixture || !fixtureResult) {
      return res.status(400).json({ error: "Invalid fixture or result" });
    }

    // Update sport standings
    const sportData = await getSportStandings(fixture.game);
    const currentRows = sportData
      ? sportData.rows
      : TEAMS.map((t) => createEmptyStandingRow(t.id));

    const nextRows = currentRows.map((row) => {
      const delta =
        row.teamId === fixture.teamAId
          ? fixtureResult.teamA
          : row.teamId === fixture.teamBId
            ? fixtureResult.teamB
            : null;

      if (!delta) return normalizeStandingRow(row);

      return {
        ...normalizeStandingRow(row),
        played: row.played + 1,
        won: row.won + delta.won,
        draw: (row.draw || 0) + delta.draw,
        lost: row.lost + delta.lost,
        points: row.points + delta.points
      };
    });

    await setSportStandings(fixture.game, {
      game: fixture.game,
      category: sportData?.category || DEFAULT_SPORT_CATEGORY,
      subcategory: sportData?.subcategory || "",
      rows: nextRows
    });

    // Remove fixture
    await deleteFixture(fixtureId);

    // Add score update
    const update = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      fixtureId,
      game: fixture.game,
      teamName: `${fixture.teamA} vs ${fixture.teamB}`,
      change:
        fixtureResult.teamA.points > fixtureResult.teamB.points
          ? fixtureResult.teamA.points
          : fixtureResult.teamB.points,
      result: fixtureResult.label,
      time: new Date().toLocaleTimeString()
    };
    await addScoreUpdate(update);

    const standings = await buildStandingsPayload();
    const fixtures = await getAllFixtures();

    io.emit("standings:updated", standings);
    io.emit("fixtures:updated", fixtures);
    io.emit("score:update", update);

    res.json({ standings, fixtures, update });
  } catch (err) {
    console.error("Fixture result error:", err);
    res.status(500).json({ error: "Failed to record result" });
  }
});

/* ── Sport finalization ──────────────────────────────────── */

app.post("/api/sports/finalize", requireAdmin, async (req, res) => {
  try {
    const { game, firstTeamId, secondTeamId, thirdTeamId } = req.body || {};
    const safeGame = String(game || "").trim();
    const teamIds = [firstTeamId, secondTeamId, thirdTeamId];
    const uniqueIds = new Set(teamIds);

    const sportData = await getSportStandings(safeGame);
    if (!safeGame || !sportData) {
      return res.status(400).json({ error: "Choose a valid sport to finalize" });
    }

    // Check pending fixtures
    const allFixtures = await getAllFixtures();
    if (allFixtures.some((f) => f.game === safeGame)) {
      return res.status(400).json({ error: "Resolve all fixtures for this sport before finalizing it" });
    }

    if (
      teamIds.some((tid) => !TEAMS.some((t) => t.id === tid)) ||
      uniqueIds.size !== 3
    ) {
      return res.status(400).json({ error: "Choose three different valid teams for 1st, 2nd, and 3rd" });
    }

    await setFinalizedSport(safeGame, {
      firstTeamId,
      secondTeamId,
      thirdTeamId,
      finalizedAt: new Date().toISOString()
    });

    // Recompute overall
    const finalizedSports = await getFinalizedSports();
    const overall = recomputeOverallStandings(finalizedSports);
    await setOverallStandings(overall);

    const firstTeam = TEAMS.find((t) => t.id === firstTeamId);
    const secondTeam = TEAMS.find((t) => t.id === secondTeamId);
    const thirdTeam = TEAMS.find((t) => t.id === thirdTeamId);

    const update = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      game: safeGame,
      teamName: `${firstTeam?.name || "Unknown"} / ${secondTeam?.name || "Unknown"} / ${thirdTeam?.name || "Unknown"}`,
      change: 5,
      result: `${safeGame} finalized: 1st ${firstTeam?.name}, 2nd ${secondTeam?.name}, 3rd ${thirdTeam?.name}`,
      time: new Date().toLocaleTimeString()
    };
    await addScoreUpdate(update);

    const standings = await buildStandingsPayload();
    io.emit("standings:updated", standings);
    io.emit("score:update", update);

    res.json({ standings, update });
  } catch (err) {
    console.error("Finalize error:", err);
    res.status(500).json({ error: "Failed to finalize sport" });
  }
});

/* ── Chat messages ───────────────────────────────────────── */

app.post("/api/messages", requireAuth, async (req, res) => {
  try {
    const { target, text } = req.body || {};
    const safeRole = req.user.role;
    const safeTarget =
      safeRole === ROLES.ADMIN &&
      (target === "all" || TEAMS.some((t) => t.id === target))
        ? target
        : "all";
    const trimmedText = String(text || "").trim();

    if (!trimmedText) return res.status(400).json({ error: "text is required" });

    const msg = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      from: req.user.name || (safeRole === ROLES.ADMIN ? "Admin" : "Team"),
      role: safeRole,
      target: safeTarget,
      targetLabel:
        safeTarget === "all"
          ? "All Teams"
          : TEAMS.find((t) => t.id === safeTarget)?.name || "Unknown",
      text: trimmedText,
      time: new Date().toLocaleTimeString()
    };

    await addMessage(msg);
    io.emit("chat:message", msg);
    res.status(201).json(msg);
  } catch (err) {
    console.error("Message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* ── Team roster (captain) ───────────────────────────────── */

function requireCaptain(req, res, next) {
  getUserFromRequest(req).then((user) => {
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.role !== ROLES.CAPTAIN)
      return res.status(403).json({ error: "Captain access required" });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: "Auth check failed" }));
}

app.get("/api/teams/:teamId/roster", requireAuth, async (req, res) => {
  try {
    const players = await getTeamPlayers(req.params.teamId);
    res.json(players.map(sanitizeUser));
  } catch (err) {
    console.error("Roster error:", err);
    res.status(500).json({ error: "Failed to load roster" });
  }
});

app.post("/api/teams/:teamId/players", requireCaptain, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (req.user.teamId !== teamId) {
      return res.status(403).json({ error: "You can only add players to your own team" });
    }
    const { name } = req.body || {};
    const trimmedName = String(name || "").trim();

    if (!trimmedName) {
      return res.status(400).json({ error: "Player name is required" });
    }

    const id = await getNextId("userId");
    const player = {
      id,
      name: trimmedName,
      email: `player-${id}@${teamId}.local`,
      password: "player",
      role: ROLES.PLAYER,
      teamId
    };
    await createUser(player);
    res.status(201).json(sanitizeUser(player));
  } catch (err) {
    console.error("Add player error:", err);
    res.status(500).json({ error: "Failed to add player" });
  }
});

app.delete("/api/teams/:teamId/players/:playerId", requireCaptain, async (req, res) => {
  try {
    const { teamId, playerId } = req.params;
    if (req.user.teamId !== teamId) {
      return res.status(403).json({ error: "You can only manage your own team" });
    }
    const player = await getUserById(Number(playerId));
    if (!player || player.teamId !== teamId || player.role !== ROLES.PLAYER) {
      return res.status(404).json({ error: "Player not found in your team" });
    }
    await deleteDoc(doc(db, "users", String(playerId)));
    res.json({ ok: true });
  } catch (err) {
    console.error("Remove player error:", err);
    res.status(500).json({ error: "Failed to remove player" });
  }
});

/* ── Player-game assignments (captain) ────────────────────── */

app.get("/api/teams/:teamId/assignments", requireAuth, async (req, res) => {
  try {
    const snap = await getDoc(doc(db, "teamAssignments", req.params.teamId));
    res.json(snap.exists() ? snap.data().assignments || {} : {});
  } catch (err) {
    console.error("Assignments error:", err);
    res.status(500).json({ error: "Failed to load assignments" });
  }
});

app.put("/api/teams/:teamId/assignments", requireCaptain, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (req.user.teamId !== teamId) {
      return res.status(403).json({ error: "You can only manage your own team" });
    }
    const { assignments } = req.body || {};
    if (!assignments || typeof assignments !== "object") {
      return res.status(400).json({ error: "assignments object is required" });
    }
    await setDoc(doc(db, "teamAssignments", teamId), { assignments });
    res.json({ ok: true, assignments });
  } catch (err) {
    console.error("Set assignments error:", err);
    res.status(500).json({ error: "Failed to save assignments" });
  }
});

/* ── Serve frontend build ────────────────────────────────── */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "../dist");

app.use(express.static(distPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(distPath, "index.html"));
});

/* ── Socket.IO ───────────────────────────────────────────── */

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
  maxHttpBufferSize: 5e6
});

const streamState = { active: false, adminSocketId: null, initChunk: null };

io.on("connection", async (socket) => {
  try {
    const [standings, fixtures, messages, scoreUpdates] = await Promise.all([
      buildStandingsPayload(),
      getAllFixtures(),
      getMessages(),
      getScoreUpdates()
    ]);

    socket.emit("bootstrap", {
      teams: TEAMS,
      standings,
      fixtures,
      messages,
      scoreUpdates,
      streamActive: streamState.active
    });

    // Send init chunk to late joiners so their MediaSource can initialize
    if (streamState.active && streamState.initChunk) {
      socket.emit("stream:chunk", streamState.initChunk);
    }
  } catch (err) {
    console.error("Bootstrap error:", err);
  }

  /* ── Live streaming events ───────────────────────────── */

  socket.on("stream:start", async ({ token }) => {
    try {
      if (streamState.active) return; // Only one stream at a time
      const userId = await getUserIdFromToken(token);
      if (!userId) return;
      const user = await getUserById(userId);
      if (!user || user.role !== ROLES.ADMIN) return;

      streamState.active = true;
      streamState.adminSocketId = socket.id;
      streamState.initChunk = null;
      socket.broadcast.emit("stream:started");
    } catch (err) {
      console.error("stream:start error:", err);
    }
  });

  socket.on("stream:chunk", (data) => {
    try {
      if (socket.id !== streamState.adminSocketId) return;
      // Store first chunk (WebM init segment) for late joiners
      if (!streamState.initChunk) {
        streamState.initChunk = data;
      }
      socket.broadcast.emit("stream:chunk", data);
    } catch (err) {
      console.error("stream:chunk error:", err);
    }
  });

  socket.on("stream:stop", () => {
    if (socket.id !== streamState.adminSocketId || !streamState.active) return;
    streamState.active = false;
    streamState.adminSocketId = null;
    streamState.initChunk = null;
    socket.broadcast.emit("stream:stopped");
  });

  socket.on("disconnect", () => {
    if (socket.id === streamState.adminSocketId) {
      streamState.active = false;
      streamState.adminSocketId = null;
      streamState.initChunk = null;
      io.emit("stream:stopped");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
