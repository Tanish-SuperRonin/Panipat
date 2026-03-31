import express from "express";
import cors from "cors";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

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

function createEmptyStandingRow(teamId) {
  return { teamId, played: 0, won: 0, draw: 0, lost: 0, points: 0 };
}

function sortStandingsTable(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if ((b.firstPlaces || 0) !== (a.firstPlaces || 0)) {
      return (b.firstPlaces || 0) - (a.firstPlaces || 0);
    }
    if ((b.secondPlaces || 0) !== (a.secondPlaces || 0)) {
      return (b.secondPlaces || 0) - (a.secondPlaces || 0);
    }
    if ((b.won || 0) !== (a.won || 0)) return (b.won || 0) - (a.won || 0);
    if ((b.draw || 0) !== (a.draw || 0)) return (b.draw || 0) - (a.draw || 0);
    if ((a.lost || 0) !== (b.lost || 0)) return (a.lost || 0) - (b.lost || 0);
    return a.teamId.localeCompare(b.teamId);
  });
}

let fixtures = [
  {
    id: 1,
    category: DEFAULT_SPORT_CATEGORY,
    subcategory: "",
    teamAId: "thunder_titans",
    teamBId: "shadow_havoc",
    game: "Cricket",
    time: "10:00 AM",
    venue: "Ground A",
    teamA: "Thunder Titans (1st Year)",
    teamB: "Shadow Havoc (2nd Year)"
  },
  {
    id: 2,
    category: DEFAULT_SPORT_CATEGORY,
    subcategory: "",
    teamAId: "shadow_havoc",
    teamBId: "synergy_spark",
    game: "Volleyball",
    time: "02:00 PM",
    venue: "Ground B",
    teamA: "Shadow Havoc (2nd Year)",
    teamB: "Synergy Spark (3rd Year)"
  }
];

let sportMeta = SPORT_DEFINITIONS.reduce((accumulator, entry) => {
  accumulator[entry.game] = {
    category: entry.category,
    subcategory: entry.subcategory
  };
  return accumulator;
}, {});

function getSportNames() {
  return SPORT_DEFINITIONS.map((entry) => entry.game);
}

function createSportStandings(games = getSportNames()) {
  return games.reduce((accumulator, game) => {
    accumulator[game] = TEAMS.map((team) => createEmptyStandingRow(team.id));
    return accumulator;
  }, {});
}

let sportStandings = createSportStandings();

let finalizedSports = {};

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
      { teamId: entry.thirdTeamId, field: "thirdPlaces", points: 0 }
    ];

    placements.forEach((placement) => {
      const overallRow = totals.find((candidate) => candidate.teamId === placement.teamId);
      if (!overallRow) return;

      overallRow.sportsCount += 1;
      overallRow[placement.field] += 1;
      overallRow.points += placement.points;
    });
  });

  return sortStandingsTable(totals);
}

let overallStandings = recomputeOverallStandings(finalizedSports);

let messages = [];
let scoreUpdates = [];
const defaultUsers = [
  {
    id: 1,
    name: "Event Admin",
    email: "admin@panipat.local",
    password: "admin123",
    role: ROLES.ADMIN,
    teamId: null
  },
  {
    id: 2,
    name: "Pratham",
    email: "pratham@ss.smjv",
    password: "pratham123",
    role: ROLES.ADMIN,
    teamId: null
  },
  {
    id: 3,
    name: "Samyak",
    email: "samyak@ss.smjv",
    password: "samyak123",
    role: ROLES.ADMIN,
    teamId: null
  },
  {
    id: 4,
    name: "Megh",
    email: "megh@ss.smjv",
    password: "megh123",
    role: ROLES.ADMIN,
    teamId: null
  }
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "users.json");
let users = loadUsers();
const sessions = new Map();

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
      return [...defaultUsers];
    }

    const fileContents = fs.readFileSync(USERS_FILE, "utf8");
    const parsedUsers = JSON.parse(fileContents);
    if (!Array.isArray(parsedUsers)) {
      throw new Error("Users file is malformed");
    }

    const hasAdmin = parsedUsers.some((user) => user.email === "admin@panipat.local");
    if (!hasAdmin) {
      const mergedUsers = [...defaultUsers, ...parsedUsers];
      fs.writeFileSync(USERS_FILE, JSON.stringify(mergedUsers, null, 2));
      return mergedUsers;
    }

    return parsedUsers;
  } catch {
    return [...defaultUsers];
  }
}

function persistUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function normalizeStandingRow(row) {
  return {
    ...row,
    draw: row.draw || 0
  };
}

function serializeSportStandings(currentSportStandings) {
  return Object.fromEntries(
    Object.entries(currentSportStandings).map(([game, rows]) => [
      game,
      sortStandingsTable(rows).map(normalizeStandingRow)
    ])
  );
}

function serializeFinalizedSports() {
  return Object.entries(finalizedSports)
    .map(([game, entry]) => ({ game, ...entry }))
    .sort((a, b) => a.game.localeCompare(b.game));
}

function serializeSportMeta() {
  return Object.fromEntries(
    Object.entries(sportMeta).map(([game, entry]) => [
      game,
      {
        category: entry?.category || DEFAULT_SPORT_CATEGORY,
        subcategory: entry?.subcategory || ""
      }
    ])
  );
}

function serializeStandingsPayload() {
  return {
    overall: overallStandings.map(normalizeStandingRow),
    bySport: serializeSportStandings(sportStandings),
    sportMeta: serializeSportMeta(),
    finalizedSports: serializeFinalizedSports()
  };
}

function hasPendingFixturesForGame(game) {
  return fixtures.some((fixture) => fixture.game === game);
}

function applyFixtureResult(fixture, result) {
  const rulesByPerspective = {
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

  return rulesByPerspective[result] || null;
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

function createSession(user) {
  const token = crypto.randomUUID();
  sessions.set(token, user.id);
  return token;
}

function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (!token) return null;

  const userId = sessions.get(token);
  if (!userId) return null;

  return users.find((entry) => entry.id === userId) || null;
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Admin access required" });
  }
  req.user = user;
  next();
}

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: false
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/signup", (req, res) => {
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

  if (!teamId || !TEAMS.some((team) => team.id === teamId)) {
    return res.status(400).json({ error: "A valid team is required" });
  }

  if (users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ error: "User already exists with this email" });
  }

  const user = {
    id: users.length ? users[users.length - 1].id + 1 : 1,
    name: trimmedName,
    email: normalizedEmail,
    password: trimmedPassword,
    role: safeRole,
    teamId
  };

  users = [...users, user];
  persistUsers();
  const token = createSession(user);

  res.status(201).json({
    token,
    user: sanitizeUser(user)
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const trimmedPassword = String(password || "").trim();

  const user = users.find(
    (entry) => entry.email === normalizedEmail && entry.password === trimmedPassword
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = createSession(user);

  res.json({
    token,
    user: sanitizeUser(user)
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  if (token) {
    sessions.delete(token);
  }

  res.status(204).end();
});

app.get("/api/teams", (req, res) => res.json(TEAMS));
app.get("/api/standings", (req, res) => res.json(serializeStandingsPayload()));
app.get("/api/fixtures", (req, res) => res.json(fixtures));
app.get("/api/messages", (req, res) => res.json(messages.slice(-200)));
app.get("/api/score-updates", (req, res) => res.json(scoreUpdates.slice(-200)));

app.post("/api/fixtures", requireAdmin, (req, res) => {
  const { category, subcategory, game, time, venue, teamAId, teamBId } = req.body || {};
  const teamA = TEAMS.find((team) => team.id === teamAId);
  const teamB = TEAMS.find((team) => team.id === teamBId);
  const sportDefinition = SPORT_DEFINITION_MAP[String(game || "").trim()] || null;
  const safeCategory =
    sportDefinition && SPORT_CATEGORIES.includes(category) && sportDefinition.category === category
      ? category
      : null;
  const safeSubcategory =
    sportDefinition && (sportDefinition.subcategory || "") === String(subcategory || "")
      ? sportDefinition.subcategory
      : null;

  if (!safeCategory || safeSubcategory === null || !game || !time || !venue || !teamA || !teamB) {
    return res.status(400).json({ error: "category, subcategory, game, time, venue, teamAId, and teamBId are required" });
  }

  if (teamA.id === teamB.id) {
    return res.status(400).json({ error: "A fixture must have two different teams" });
  }

  const id = fixtures.length ? fixtures[fixtures.length - 1].id + 1 : 1;
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
  fixtures = [...fixtures, fixture];
  sportMeta = {
    ...sportMeta,
    [fixture.game]: { category: fixture.category, subcategory: fixture.subcategory }
  };
  if (!sportStandings[fixture.game]) {
    sportStandings = {
      ...sportStandings,
      [fixture.game]: TEAMS.map((team) => createEmptyStandingRow(team.id))
    };
    io.emit("standings:updated", serializeStandingsPayload());
  }
  io.emit("fixture:created", fixture);
  res.status(201).json(fixture);
});

app.post("/api/fixtures/:fixtureId/result", requireAdmin, (req, res) => {
  const fixtureId = Number(req.params.fixtureId);
  const { result } = req.body || {};
  const fixture = fixtures.find((entry) => entry.id === fixtureId);
  const fixtureResult = fixture ? applyFixtureResult(fixture, result) : null;

  if (!fixture || !fixtureResult) {
    return res.status(400).json({ error: "Invalid fixture or result" });
  }

  const currentGameStandings =
    sportStandings[fixture.game] || TEAMS.map((team) => createEmptyStandingRow(team.id));

  const nextGameStandings = currentGameStandings.map((row) => {
    if (row.teamId === fixture.teamAId) {
      return {
        ...normalizeStandingRow(row),
        played: row.played + 1,
        won: row.won + fixtureResult.teamA.won,
        draw: (row.draw || 0) + fixtureResult.teamA.draw,
        lost: row.lost + fixtureResult.teamA.lost,
        points: row.points + fixtureResult.teamA.points
      };
    }

    if (row.teamId === fixture.teamBId) {
      return {
        ...normalizeStandingRow(row),
        played: row.played + 1,
        won: row.won + fixtureResult.teamB.won,
        draw: (row.draw || 0) + fixtureResult.teamB.draw,
        lost: row.lost + fixtureResult.teamB.lost,
        points: row.points + fixtureResult.teamB.points
      };
    }

    return normalizeStandingRow(row);
  });

  sportStandings = {
    ...sportStandings,
    [fixture.game]: nextGameStandings
  };
  fixtures = fixtures.filter((entry) => entry.id !== fixtureId);

  const update = {
    id: Date.now(),
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
  scoreUpdates = [update, ...scoreUpdates].slice(0, 200);

  io.emit("standings:updated", serializeStandingsPayload());
  io.emit("fixtures:updated", fixtures);
  io.emit("score:update", update);

  res.json({
    standings: serializeStandingsPayload(),
    fixtures,
    update
  });
});

app.post("/api/sports/finalize", requireAdmin, (req, res) => {
  const { game, firstTeamId, secondTeamId, thirdTeamId } = req.body || {};
  const safeGame = String(game || "").trim();
  const teamIds = [firstTeamId, secondTeamId, thirdTeamId];
  const uniqueIds = new Set(teamIds);

  if (!safeGame || !sportStandings[safeGame]) {
    return res.status(400).json({ error: "Choose a valid sport to finalize" });
  }

  if (hasPendingFixturesForGame(safeGame)) {
    return res.status(400).json({ error: "Resolve all fixtures for this sport before finalizing it" });
  }

  if (
    teamIds.some((teamId) => !TEAMS.some((team) => team.id === teamId)) ||
    uniqueIds.size !== 3
  ) {
    return res.status(400).json({ error: "Choose three different valid teams for 1st, 2nd, and 3rd" });
  }

  finalizedSports = {
    ...finalizedSports,
    [safeGame]: {
      firstTeamId,
      secondTeamId,
      thirdTeamId,
      finalizedAt: new Date().toISOString()
    }
  };
  overallStandings = recomputeOverallStandings(finalizedSports);

  const firstTeam = TEAMS.find((team) => team.id === firstTeamId);
  const secondTeam = TEAMS.find((team) => team.id === secondTeamId);
  const thirdTeam = TEAMS.find((team) => team.id === thirdTeamId);

  const update = {
    id: Date.now(),
    game: safeGame,
    teamName: `${firstTeam?.name || "Unknown"} / ${secondTeam?.name || "Unknown"} / ${thirdTeam?.name || "Unknown"}`,
    change: 5,
    result: `${safeGame} finalized: 1st ${firstTeam?.name}, 2nd ${secondTeam?.name}, 3rd ${thirdTeam?.name}`,
    time: new Date().toLocaleTimeString()
  };
  scoreUpdates = [update, ...scoreUpdates].slice(0, 200);

  io.emit("standings:updated", serializeStandingsPayload());
  io.emit("score:update", update);

  res.json({
    standings: serializeStandingsPayload(),
    update
  });
});

app.post("/api/messages", requireAuth, (req, res) => {
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
    id: Date.now(),
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

  messages = [...messages, msg].slice(-200);
  io.emit("chat:message", msg);
  res.status(201).json(msg);
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.emit("bootstrap", {
    teams: TEAMS,
    standings: serializeStandingsPayload(),
    fixtures,
    messages: messages.slice(-200),
    scoreUpdates: scoreUpdates.slice(-200)
  });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

