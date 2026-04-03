import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import tournamentLogo from "../logo.png";

const ROLES = {
  ADMIN: "admin",
  CAPTAIN: "captain",
  PLAYER: "player"
};

const defaultTeams = [
  { id: "thunder_titans", name: "Thunder Titans (1st Year)" },
  { id: "shadow_havoc", name: "Shadow Havoc (2nd Year)" },
  { id: "synergy_spark", name: "Synergy Spark (3rd Year)" }
];

const SESSION_STORAGE_KEY = "panipat-auth-token";

const defaultSignupForm = {
  name: "",
  email: "",
  password: "",
  role: ROLES.PLAYER,
  teamId: defaultTeams[0].id
};

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
    games: ["GC"]
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

function getSubcategoryOptions(category) {
  return SPORT_CATALOG.filter((entry) => entry.category === category).map(
    (entry) => entry.subcategory
  );
}

function getGameOptions(category, subcategory) {
  const selectedEntry = SPORT_CATALOG.find(
    (entry) => entry.category === category && entry.subcategory === (subcategory || "")
  );

  return selectedEntry?.games || [];
}

function createFixtureForm(category = "Outdoor Games") {
  const subcategory = getSubcategoryOptions(category)[0] || "";
  const game = getGameOptions(category, subcategory)[0] || "";

  return {
    category,
    subcategory,
    game,
    time: "",
    venue: "",
    teamAId: defaultTeams[0].id,
    teamBId: defaultTeams[1].id
  };
}

const defaultFixtureForm = createFixtureForm();

const CATEGORY_PAGES = [
  { id: "home", label: "Home" },
  { id: "fixtures", label: "Fixtures" },
  { id: "LAN Games", label: "LAN Games" },
  { id: "Indoor Games", label: "Indoor Games" },
  { id: "Outdoor Games", label: "Outdoor Games" }
];

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
    if ((b.firstPlaces || 0) !== (a.firstPlaces || 0)) {
      return (b.firstPlaces || 0) - (a.firstPlaces || 0);
    }
    if ((b.secondPlaces || 0) !== (a.secondPlaces || 0)) {
      return (b.secondPlaces || 0) - (a.secondPlaces || 0);
    }
    if ((b.won || 0) !== (a.won || 0)) return (b.won || 0) - (a.won || 0);
    if ((b.draw || 0) !== (a.draw || 0)) return (b.draw || 0) - (a.draw || 0);
    if ((a.lost || 0) !== (b.lost || 0)) return (a.lost || 0) - (b.lost || 0);
    return String(a.teamId || "").localeCompare(String(b.teamId || ""));
  });
}

function normalizeStandingsPayload(payload) {
  if (Array.isArray(payload)) {
    return { overall: sortRows(payload), bySport: {}, sportMeta: {}, finalizedSports: [] };
  }

  return {
    overall: sortRows(Array.isArray(payload?.overall) ? payload.overall : []),
    bySport: Object.fromEntries(
      Object.entries(payload?.bySport || {}).map(([game, rows]) => [game, sortRows(rows || [])])
    ),
    sportMeta: payload?.sportMeta && typeof payload.sportMeta === "object" ? payload.sportMeta : {},
    finalizedSports: Array.isArray(payload?.finalizedSports) ? payload.finalizedSports : []
  };
}

function App() {
  const [authToken, setAuthToken] = useState(
    () => window.localStorage.getItem(SESSION_STORAGE_KEY) || ""
  );
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState(defaultSignupForm);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(Boolean(authToken));
  const [teams, setTeams] = useState(defaultTeams);
  const [overallStandings, setOverallStandings] = useState([]);
  const [sportStandings, setSportStandings] = useState({});
  const [sportMeta, setSportMeta] = useState({});
  const [finalizedSports, setFinalizedSports] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [activePage, setActivePage] = useState("home");
  const [newFixture, setNewFixture] = useState(defaultFixtureForm);
  const [scoreUpdates, setScoreUpdates] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [showLoginPage, setShowLoginPage] = useState(false);
  const socketRef = useRef(null);

  const role = user?.role || null;
  const myTeam = useMemo(
    () => teams.find((team) => team.id === user?.teamId) || null,
    [teams, user]
  );

  const sportStandingsEntries = useMemo(
    () =>
      Object.entries(sportStandings).sort(([gameA], [gameB]) => gameA.localeCompare(gameB)),
    [sportStandings]
  );

  const sportsByCategory = useMemo(() => {
    const finalizedByGame = Object.fromEntries(
      finalizedSports.map((entry) => [entry.game, entry])
    );

    return CATEGORY_PAGES.filter((page) => page.id !== "home").reduce((accumulator, page) => {
      const sports = sportStandingsEntries
        .map(([game, rows]) => ({
          game,
          rows,
          category: sportMeta[game]?.category || "Outdoor Games",
          subcategory: sportMeta[game]?.subcategory || "",
          finalized: finalizedByGame[game] || null,
          fixtures: fixtures.filter((fixture) => fixture.game === game)
        }))
        .filter((sport) => sport.category === page.id);

      accumulator[page.id] = sports.reduce((groups, sport) => {
        const key = sport.subcategory || "All Games";
        if (!groups[key]) groups[key] = [];
        groups[key].push(sport);
        return groups;
      }, {});
      return accumulator;
    }, {});
  }, [finalizedSports, fixtures, sportMeta, sportStandingsEntries]);

  const myFixtures = useMemo(() => {
    if (!myTeam) return fixtures;
    return fixtures.filter(
      (fixture) => fixture.teamAId === myTeam.id || fixture.teamBId === myTeam.id
    );
  }, [fixtures, myTeam]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitial() {
      try {
        const [teamsRes, standingsRes, fixturesRes, messagesRes, updatesRes] =
          await Promise.all([
            fetch("/api/teams"),
            fetch("/api/standings"),
            fetch("/api/fixtures"),
            fetch("/api/messages"),
            fetch("/api/score-updates")
          ]);

        if (!isMounted) return;

        const [teamsJson, standingsJson, fixturesJson, messagesJson, updatesJson] =
          await Promise.all([
            teamsRes.json(),
            standingsRes.json(),
            fixturesRes.json(),
            messagesRes.json(),
            updatesRes.json()
          ]);

        setTeams(Array.isArray(teamsJson) && teamsJson.length ? teamsJson : defaultTeams);
        const normalizedStandings = normalizeStandingsPayload(standingsJson);
        setOverallStandings(normalizedStandings.overall);
        setSportStandings(normalizedStandings.bySport);
        setSportMeta(normalizedStandings.sportMeta);
        setFinalizedSports(normalizedStandings.finalizedSports);
        setFixtures(Array.isArray(fixturesJson) ? fixturesJson : []);
        setChatMessages(Array.isArray(messagesJson) ? messagesJson : []);
        setScoreUpdates(Array.isArray(updatesJson) ? updatesJson : []);
      } catch {
        setGlobalError("Backend is not reachable right now. The UI is running with local placeholders.");
      }
    }

    loadInitial();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const socket = io("/", { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("bootstrap", (data) => {
      if (!data) return;
      setGlobalError("");
      if (Array.isArray(data.teams) && data.teams.length) setTeams(data.teams);
      const normalizedStandings = normalizeStandingsPayload(data.standings);
      setOverallStandings(normalizedStandings.overall);
      setSportStandings(normalizedStandings.bySport);
      setSportMeta(normalizedStandings.sportMeta);
      setFinalizedSports(normalizedStandings.finalizedSports);
      if (Array.isArray(data.fixtures)) setFixtures(data.fixtures);
      if (Array.isArray(data.messages)) setChatMessages(data.messages);
      if (Array.isArray(data.scoreUpdates)) setScoreUpdates(data.scoreUpdates);
      if (data.streamActive) setIsStreamActive(true);
    });
    socket.on("chat:message", (message) => {
      setChatMessages((prev) => [...prev, message].slice(-200));
    });
    socket.on("fixture:created", (fixture) => {
      setFixtures((prev) => [...prev, fixture]);
    });
    socket.on("fixtures:updated", (nextFixtures) => {
      if (Array.isArray(nextFixtures)) setFixtures(nextFixtures);
    });
    socket.on("standings:updated", (payload) => {
      const normalizedStandings = normalizeStandingsPayload(payload);
      setOverallStandings(normalizedStandings.overall);
      setSportStandings(normalizedStandings.bySport);
      setSportMeta(normalizedStandings.sportMeta);
      setFinalizedSports(normalizedStandings.finalizedSports);
    });
    socket.on("score:update", (update) => {
      setScoreUpdates((prev) => [update, ...prev].slice(0, 200));
    });

    socket.on("stream:started", () => setIsStreamActive(true));
    socket.on("stream:stopped", () => setIsStreamActive(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function restoreSession() {
      if (!authToken) {
        setAuthLoading(false);
        setUser(null);
        return;
      }

      setAuthLoading(true);
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${authToken}` }
        });

        if (!res.ok) throw new Error("Session expired");

        const data = await res.json();
        if (!ignore) {
          setUser(data.user || null);
          setAuthError("");
        }
      } catch {
        if (!ignore) {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
          setAuthToken("");
          setUser(null);
        }
      } finally {
        if (!ignore) setAuthLoading(false);
      }
    }

    restoreSession();

    return () => {
      ignore = true;
    };
  }, [authToken]);

  async function postWithAuth(path, body) {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let message = "Request failed";
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  function persistSession(token, nextUser) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, token);
    setAuthToken(token);
    setUser(nextUser);
    setAuthError("");
    setGlobalError("");
    setShowLoginPage(false);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError("");

    try {
      const data = await postWithAuth("/api/auth/login", loginForm);
      persistSession(data.token, data.user);
      setLoginForm({ email: "", password: "" });
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setAuthError("");

    try {
      const data = await postWithAuth("/api/auth/signup", signupForm);
      persistSession(data.token, data.user);
      setSignupForm(defaultSignupForm);
    } catch (error) {
      setAuthError(error.message);
    }
  }

  async function handleLogout() {
    try {
      await postWithAuth("/api/auth/logout", {});
    } catch {
      // ignore
    } finally {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setAuthToken("");
      setUser(null);
      setChatText("");
      setChatTarget("all");
    }
  }

  async function handleAddFixture(e) {
    e.preventDefault();
    if (
      !newFixture.game ||
      !newFixture.time ||
      !newFixture.venue ||
      !newFixture.teamAId ||
      !newFixture.teamBId
    ) {
      return;
    }

    if (newFixture.teamAId === newFixture.teamBId) {
      setGlobalError("Choose two different teams for a fixture.");
      return;
    }

    try {
      await postWithAuth("/api/fixtures", newFixture);
      setNewFixture(createFixtureForm(newFixture.category));
      setGlobalError("");
    } catch (error) {
      setGlobalError(error.message);
    }
  }

  async function handleResolveFixture(fixtureId, result) {
    try {
      await postWithAuth(`/api/fixtures/${fixtureId}/result`, { result });
      setGlobalError("");
    } catch (error) {
      setGlobalError(error.message);
    }
  }

  async function handleDeleteFixture(fixtureId) {
    try {
      const res = await fetch(`/api/fixtures/${fixtureId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setGlobalError("");
    } catch (error) {
      setGlobalError(error.message);
    }
  }

  async function handleFinalizeSport(payload) {
    try {
      await postWithAuth("/api/sports/finalize", payload);
      setGlobalError("");
    } catch (error) {
      setGlobalError(error.message);
    }
  }

  if (authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Panipat Championship</p>
          <h1>Loading event data...</h1>
          <p className="muted">Connecting to the live tournament.</p>
        </div>
      </div>
    );
  }

  if (showLoginPage) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        signupForm={signupForm}
        setSignupForm={setSignupForm}
        teams={teams}
        onLogin={handleLogin}
        onSignup={handleSignup}
        authError={authError}
        onBack={() => setShowLoginPage(false)}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="top-bar">
        <div className="brand">
          <img src={tournamentLogo} alt="Panipat tournament logo" className="brand-logo" />
          <div className="brand-copy">
            <span className="brand-mark">Panipat</span>
            <span className="brand-subtitle">Inter-Sports Championship</span>
          </div>
        </div>

        <div className="top-bar-actions">
          <span className={`pill ${isConnected ? "ok" : "warn"}`}>
            {isConnected ? "Online" : "Offline"}
          </span>
          {user ? (
            <>
              <span className="pill">{user.role?.toUpperCase()}: {user.name}</span>
              <button type="button" className="btn btn-ghost small" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost small" onClick={() => setShowLoginPage(true)}>
              Admin / Captain Login
            </button>
          )}
        </div>
      </header>

      {globalError && <div className="notice error">{globalError}</div>}

      <nav className="page-tabs">
        {CATEGORY_PAGES.map((page) => (
          <button
            key={page.id}
            type="button"
            className={`btn ${activePage === page.id ? "primary" : "btn-ghost"} small`}
            onClick={() => setActivePage(page.id)}
          >
            {page.label}
          </button>
        ))}
      </nav>

      <main className="layout">
        <section className="primary-panel">
          {isStreamActive && !isStreaming && (
            <LiveStreamViewer socketRef={socketRef} />
          )}

          <Dashboard
            activePage={activePage}
            overallStandings={overallStandings}
            sportsByCategory={sportsByCategory}
            finalizedSports={finalizedSports}
            fixtures={fixtures}
            myFixtures={myFixtures}
            teams={teams}
            role={role}
            myTeam={myTeam}
            authToken={authToken}
            onResolveFixture={handleResolveFixture}
            onFinalizeSport={handleFinalizeSport}
            onDeleteFixture={handleDeleteFixture}
          />

          {role === ROLES.ADMIN && (
            <LiveStreamAdmin
              socketRef={socketRef}
              authToken={authToken}
              isStreaming={isStreaming}
              setIsStreaming={setIsStreaming}
              setIsStreamActive={setIsStreamActive}
            />
          )}

          {role === ROLES.ADMIN && (
            <AdminFixtureForm
              teams={teams}
              newFixture={newFixture}
              setNewFixture={setNewFixture}
              onAddFixture={handleAddFixture}
            />
          )}
        </section>

        <aside className="side-panel">
          <ScoreActivityFeed updates={scoreUpdates} />
        </aside>
      </main>
    </div>
  );
}

function AuthScreen({
  authMode,
  setAuthMode,
  loginForm,
  setLoginForm,
  signupForm,
  setSignupForm,
  teams,
  onLogin,
  onSignup,
  authError,
  onBack
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card auth-copy">
        {onBack && (
          <button type="button" className="btn btn-ghost small" style={{ marginBottom: 14 }} onClick={onBack}>
            &larr; Back to Scoreboard
          </button>
        )}
        <div className="auth-brand">
          <img src={tournamentLogo} alt="Panipat tournament logo" className="auth-logo" />
        </div>

        <div className="auth-toggle">
          <button
            type="button"
            className={`btn ${authMode === "login" ? "primary" : "btn-ghost"}`}
            onClick={() => setAuthMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={`btn ${authMode === "signup" ? "primary" : "btn-ghost"}`}
            onClick={() => setAuthMode("signup")}
          >
            Sign Up
          </button>
        </div>

        {authError && <div className="notice error">{authError}</div>}

        {authMode === "login" ? (
          <form className="auth-form" onSubmit={onLogin}>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="input"
                type="email"
                value={loginForm.email}
                onChange={(e) =>
                  setLoginForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="you@example.com"
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Enter password"
              />
            </label>
            <button type="submit" className="btn primary">
              Login to Dashboard
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={onSignup}>
            <label className="field">
              <span className="field-label">Full Name</span>
              <input
                className="input"
                value={signupForm.name}
                onChange={(e) =>
                  setSignupForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Aman Kumar"
              />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="input"
                type="email"
                value={signupForm.email}
                onChange={(e) =>
                  setSignupForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="player@team.com"
              />
            </label>
            <div className="auth-grid">
              <label className="field">
                <span className="field-label">Role</span>
                <select
                  className="select"
                  value={signupForm.role}
                  onChange={(e) =>
                    setSignupForm((prev) => ({ ...prev, role: e.target.value }))
                  }
                >
                  <option value={ROLES.PLAYER}>Player</option>
                  <option value={ROLES.CAPTAIN}>Captain</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Team</span>
                <select
                  className="select"
                  value={signupForm.teamId}
                  onChange={(e) =>
                    setSignupForm((prev) => ({ ...prev, teamId: e.target.value }))
                  }
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                value={signupForm.password}
                onChange={(e) =>
                  setSignupForm((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Create password"
              />
            </label>
            <button type="submit" className="btn primary">
              Create Account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ── Admin: Team Assignments View ─────────────────────────── */

function AdminAssignmentsView({ teams, authToken }) {
  const [data, setData] = useState(null);
  const [viewMode, setViewMode] = useState("by-game");
  const headers = { Authorization: `Bearer ${authToken}` };

  useEffect(() => {
    async function load() {
      const results = {};
      for (const team of teams) {
        try {
          const [rosterRes, assignRes] = await Promise.all([
            fetch(`/api/teams/${team.id}/roster`, { headers }),
            fetch(`/api/teams/${team.id}/assignments`, { headers })
          ]);
          const roster = rosterRes.ok ? await rosterRes.json() : [];
          const assignments = assignRes.ok ? await assignRes.json() : {};
          results[team.id] = {
            team,
            players: roster.filter((u) => u.role === "player"),
            assignments
          };
        } catch {}
      }
      setData(results);
    }
    load();
  }, [teams, authToken]);

  if (!data) return <div className="card" style={{ marginTop: 16 }}><p className="muted">Loading team assignments...</p></div>;

  const allGames = SPORT_CATALOG.flatMap((e) => e.games);

  // Build game → [{team, player}] map
  const gameMap = {};
  allGames.forEach((game) => { gameMap[game] = []; });
  Object.values(data).forEach(({ team, players, assignments }) => {
    players.forEach((player) => {
      const playerGames = assignments[player.id] || [];
      playerGames.forEach((game) => {
        if (gameMap[game]) gameMap[game].push({ team: team.name, player: player.name });
      });
    });
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <h3>Team Assignments Overview</h3>
        <p className="muted">Which players from each team are assigned to each game.</p>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button type="button" className={`btn ${viewMode === "by-game" ? "primary" : "btn-ghost"} small`}
          onClick={() => setViewMode("by-game")}>By Game</button>
        <button type="button" className={`btn ${viewMode === "by-team" ? "primary" : "btn-ghost"} small`}
          onClick={() => setViewMode("by-team")}>By Team</button>
      </div>

      {viewMode === "by-game" ? (
        <div className="admin-assign-grid">
          {SPORT_CATALOG.map((entry) => (
            <div key={entry.category + entry.subcategory} className="admin-assign-category">
              <h4 className="section-title">
                {entry.category}{entry.subcategory ? ` — ${entry.subcategory}` : ""}
              </h4>
              {entry.games.map((game) => (
                <div key={game} className="admin-assign-game">
                  <div className="admin-assign-game-name">{game}</div>
                  <div className="admin-assign-players">
                    {gameMap[game].length === 0 ? (
                      <span className="muted small">No players assigned</span>
                    ) : (
                      gameMap[game].map((entry, i) => (
                        <span key={i} className="admin-assign-tag">
                          <span className="admin-assign-player-name">{entry.player}</span>
                          <span className="admin-assign-team-name">{entry.team}</span>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-assign-grid">
          {teams.map((team) => {
            const teamData = data[team.id];
            if (!teamData || teamData.players.length === 0) return (
              <div key={team.id} className="admin-assign-category">
                <h4 className="section-title">{team.name}</h4>
                <p className="muted small">No players registered</p>
              </div>
            );
            return (
              <div key={team.id} className="admin-assign-category">
                <h4 className="section-title">{team.name}</h4>
                {teamData.players.map((player) => {
                  const games = teamData.assignments[player.id] || [];
                  return (
                    <div key={player.id} className="admin-assign-game">
                      <div className="admin-assign-game-name">{player.name}</div>
                      <div className="admin-assign-players">
                        {games.length === 0 ? (
                          <span className="muted small">No games assigned</span>
                        ) : (
                          games.map((g) => (
                            <span key={g} className="admin-assign-tag compact">{g}</span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Captain Roster Panel ────────────────────────────────── */

const CATEGORIES = ["LAN Games", "Indoor Games", "Outdoor Games"];
const GAMES_BY_CATEGORY = Object.fromEntries(
  CATEGORIES.map((cat) => [
    cat,
    SPORT_CATALOG.filter((e) => e.category === cat).flatMap((e) => e.games)
  ])
);

function CaptainRosterPanel({ teamId, teamName, authToken }) {
  const [roster, setRoster] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [newPlayer, setNewPlayer] = useState({ name: "" });
  const [rosterError, setRosterError] = useState("");
  const [rosterLoading, setRosterLoading] = useState(true);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };

  const loadData = useCallback(async () => {
    try {
      const [rosterRes, assignRes] = await Promise.all([
        fetch(`/api/teams/${teamId}/roster`, { headers }),
        fetch(`/api/teams/${teamId}/assignments`, { headers })
      ]);
      if (rosterRes.ok) setRoster(await rosterRes.json());
      if (assignRes.ok) setAssignments(await assignRes.json());
    } catch {} finally {
      setRosterLoading(false);
    }
  }, [teamId, authToken]);

  useEffect(() => { loadData(); }, [loadData]);

  const addPlayer = async (e) => {
    e.preventDefault();
    setRosterError("");
    try {
      const res = await fetch(`/api/teams/${teamId}/players`, {
        method: "POST", headers, body: JSON.stringify(newPlayer)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add player");
      setRoster((prev) => [...prev, data]);
      setNewPlayer({ name: "" });
    } catch (err) { setRosterError(err.message); }
  };

  const removePlayer = async (playerId) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/players/${playerId}`, {
        method: "DELETE", headers
      });
      if (res.ok) {
        setRoster((prev) => prev.filter((p) => p.id !== playerId));
        const next = { ...assignments };
        delete next[playerId];
        setAssignments(next);
        saveAssignments(next);
      }
    } catch {}
  };

  const saveAssignments = async (data) => {
    try {
      await fetch(`/api/teams/${teamId}/assignments`, {
        method: "PUT", headers, body: JSON.stringify({ assignments: data })
      });
    } catch {}
  };

  const toggleGame = (playerId, game) => {
    const playerGames = assignments[playerId] || [];
    const next = playerGames.includes(game)
      ? playerGames.filter((g) => g !== game)
      : [...playerGames, game];
    const updated = { ...assignments, [playerId]: next };
    setAssignments(updated);
    saveAssignments(updated);
  };

  const getPlayerCategoryCount = (playerId, category) => {
    const playerGames = assignments[playerId] || [];
    const catGames = GAMES_BY_CATEGORY[category] || [];
    return playerGames.filter((g) => catGames.includes(g)).length;
  };

  const players = roster.filter((u) => u.role === "player");
  const captain = roster.find((u) => u.role === "captain");

  if (rosterLoading) return <div className="card"><p className="muted">Loading roster...</p></div>;

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h3>Team Roster — {teamName}</h3>
          <p className="muted">
            {captain ? `Captain: ${captain.name}` : ""} · {players.length} player{players.length !== 1 ? "s" : ""} registered
          </p>
        </div>

        {rosterError && <div className="notice error">{rosterError}</div>}

        <form className="roster-add-form" onSubmit={addPlayer} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Player Name</span>
            <input className="input" value={newPlayer.name}
              onChange={(e) => setNewPlayer({ name: e.target.value })}
              placeholder="Enter player name" />
          </label>
          <button type="submit" className="btn primary">Add</button>
        </form>
      </div>

      {players.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Game Assignments</h3>
            <p className="muted">Assign players to games. Min 2 games per category per player.</p>
          </div>

          <div className="assign-players-list">
            {players.map((player) => {
              const playerGames = assignments[player.id] || [];
              return (
                <div key={player.id} className="assign-player-card">
                  <div className="assign-player-header">
                    <strong>{player.name}</strong>
                    <button type="button" className="btn-icon-delete" title="Remove player"
                      onClick={() => removePlayer(player.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>

                  <div className="assign-categories">
                    {CATEGORIES.map((cat) => {
                      const count = getPlayerCategoryCount(player.id, cat);
                      const isLow = count < 2;
                      return (
                        <div key={cat} className="assign-category-block">
                          <div className="assign-category-header">
                            <span className="assign-category-name">{cat}</span>
                            <span className={`assign-count ${isLow ? "warn" : "ok"}`}>
                              {count} selected {isLow ? "(min 2)" : ""}
                            </span>
                          </div>
                          <div className="assign-game-chips">
                            {GAMES_BY_CATEGORY[cat].map((game) => {
                              const selected = playerGames.includes(game);
                              return (
                                <button
                                  key={game}
                                  type="button"
                                  className={`assign-chip ${selected ? "active" : ""}`}
                                  onClick={() => toggleGame(player.id, game)}
                                >
                                  {game}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Dashboard({
  activePage,
  overallStandings,
  sportsByCategory,
  finalizedSports,
  fixtures,
  myFixtures,
  teams,
  role,
  myTeam,
  authToken,
  onResolveFixture,
  onFinalizeSport,
  onDeleteFixture
}) {
  const showPersonalizedFixtures = role === ROLES.CAPTAIN || role === ROLES.PLAYER;
  const teamStanding = overallStandings.find((row) => row.teamId === myTeam?.id) || null;
  const nextFixture = myFixtures[0] || null;
  const finalizedSportCount = finalizedSports.length;
  const categorySportGroups = activePage === "home" ? {} : sportsByCategory[activePage] || {};

  if (activePage === "home") {
    const fixturePreview = showPersonalizedFixtures ? myFixtures.slice(0, 3) : fixtures.slice(0, 3);

    return (
      <div className="card">
        <div className="card-header">
          <h2>{showPersonalizedFixtures ? "Home Dashboard" : "Tournament Home"}</h2>
          <p className="muted">
            {showPersonalizedFixtures
              ? `Welcome to ${myTeam?.name}. Home shows the main standings while category pages show sport-wise tables.`
              : "Home shows the main overall standings. Open a category page to manage or view each sport."}
          </p>
        </div>

        {showPersonalizedFixtures && (
          <>
            <div className="premium-hero">
              <div className="premium-hero-main">
                <span className="hero-badge">Team Home</span>
                <h3>{myTeam?.name}</h3>
                <p>
                  Follow the overall leaderboard here, then open LAN, Indoor, or Outdoor pages to
                  check each sport in detail.
                </p>

                {nextFixture ? (
                  <div className="next-match-card">
                    <div className="next-match-header">
                      <span className="hero-label">Next Match</span>
                      <span className="next-match-category">{nextFixture.category}</span>
                    </div>
                    <strong>{nextFixture.game}</strong>
                    <div className="next-match-teams">
                      <span>{nextFixture.teamA}</span>
                      <span className="next-match-divider">vs</span>
                      <span>{nextFixture.teamB}</span>
                    </div>
                    <div className="next-match-meta">
                      <span className="next-meta-pill">{nextFixture.time}</span>
                      <span className="next-meta-pill">{nextFixture.venue}</span>
                    </div>
                  </div>
                ) : (
                  <div className="next-match-card empty">
                    <span className="hero-label">Next Match</span>
                    <strong>No fixture assigned yet</strong>
                    <div className="next-match-teams">
                      Your schedule will appear here when the admin publishes fixtures.
                    </div>
                  </div>
                )}
              </div>

              <div className="premium-hero-side">
                <div className="hero-strip compact">
                  <div>
                    <span className="hero-label">Overall Rank</span>
                    <strong>
                      {Math.max(overallStandings.findIndex((row) => row.teamId === myTeam?.id) + 1, 1)}
                    </strong>
                  </div>
                  <div>
                    <span className="hero-label">Upcoming Fixtures</span>
                    <strong>{myFixtures.length}</strong>
                  </div>
                  <div>
                    <span className="hero-label">Points</span>
                    <strong>{teamStanding?.points ?? 0}</strong>
                  </div>
                  <div>
                    <span className="hero-label">Podiums</span>
                    <strong>
                      {teamStanding
                        ? `${teamStanding.firstPlaces || 0}-${teamStanding.secondPlaces || 0}-${teamStanding.thirdPlaces || 0}`
                        : "0-0-0"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <section className="player-overview">
              <div className="section-heading tight">
                <div>
                  <h3 className="section-title">Quick Team Snapshot</h3>
                  <p className="muted">The nearest fixtures your team should be preparing for.</p>
                </div>
              </div>
              <div className="fixture-preview-grid">
                {fixturePreview.length === 0 ? (
                  <div className="preview-card empty">
                    <span className="hero-label">Schedule Pending</span>
                    <strong>No fixtures yet</strong>
                    <p>Once admin publishes your schedule, it will show up here.</p>
                  </div>
                ) : (
                  fixturePreview.map((fixture) => (
                    <div key={fixture.id} className="preview-card">
                      <span className="hero-label">{fixture.category}</span>
                      <strong>{fixture.game}</strong>
                      <p>{fixture.teamA} vs {fixture.teamB}</p>
                      <div className="preview-meta">
                        <span className="preview-time">{fixture.time}</span>
                        <span className="preview-venue">{fixture.venue}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {role === ROLES.CAPTAIN && myTeam && (
              <CaptainRosterPanel teamId={myTeam.id} teamName={myTeam.name} authToken={authToken} />
            )}
          </>
        )}

        <div className="section-heading tight">
          <div>
            <h3 className="section-title">Main Standings</h3>
            <p className="muted">
              Only finalized sports affect this table. 1st place = 5 pts, 2nd = 3 pts, 3rd = 1 pt.
            </p>
          </div>
          <span className="score-rank">{finalizedSportCount} Sports Finalized</span>
        </div>
        <StandingsTable
          rows={overallStandings}
          teams={teams}
          myTeam={myTeam}
          columns={[
            { key: "sportsCount", label: "Sports" },
            { key: "firstPlaces", label: "1st" },
            { key: "secondPlaces", label: "2nd" },
            { key: "thirdPlaces", label: "3rd" },
            { key: "points", label: "Pts" }
          ]}
        />

        {role === ROLES.ADMIN && (
          <AdminAssignmentsView teams={teams} authToken={authToken} />
        )}
      </div>
    );
  }

  if (activePage === "fixtures") {
    return (
      <FixturesPanel
        fixtures={fixtures}
        myFixtures={myFixtures}
        teams={teams}
        role={role}
        myTeam={myTeam}
        onDeleteFixture={onDeleteFixture}
      />
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>{activePage}</h2>
        <p className="muted">
          {role === ROLES.ADMIN
            ? "Manage sport-wise tables, resolve fixtures, and finalize winners from this category page."
            : "Check every sport table in this category and follow fixtures for your team."}
        </p>
      </div>

      {Object.keys(categorySportGroups).length === 0 ? (
        <p className="muted">No sports have been added under this category yet.</p>
      ) : (
        <div className="category-groups">
          {Object.entries(categorySportGroups).map(([groupName, sports]) => (
            <section key={groupName} className="category-group">
              <div className="section-heading tight">
                <div>
                  <h3 className="section-title">{groupName}</h3>
                  <p className="muted">
                    {activePage === "LAN Games"
                      ? `Games available under ${groupName.toLowerCase()}.`
                      : `Sport tables under ${activePage.toLowerCase()}.`}
                  </p>
                </div>
              </div>

              <div className="sport-standings-grid">
                {sports.map((sport) => (
                  <SportCategoryCard
                    key={sport.game}
                    sport={sport}
                    teams={teams}
                    myTeam={myTeam}
                    role={role}
                    onResolveFixture={onResolveFixture}
                    onFinalizeSport={onFinalizeSport}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StandingsTable({ rows, teams, myTeam, columns, compact = false }) {
  return (
    <div className={`table-shell ${compact ? "table-shell-compact" : ""}`}>
      <table className={`table ${compact ? "table-compact" : ""}`}>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const team = teams.find((entry) => entry.id === row.teamId);
            const isMyTeam = myTeam?.id === row.teamId;

            return (
              <tr key={row.teamId} className={isMyTeam ? "table-row-active" : ""}>
                <td>{index + 1}</td>
                <td>{team?.name}</td>
                {columns.map((column) => (
                  <td key={column.key}>{row[column.key] ?? 0}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SportCategoryCard({ sport, teams, myTeam, role, onResolveFixture, onFinalizeSport }) {
  const [placements, setPlacements] = useState(() => ({
    firstTeamId: sport.finalized?.firstTeamId || teams[0]?.id || "",
    secondTeamId: sport.finalized?.secondTeamId || teams[1]?.id || teams[0]?.id || "",
    thirdTeamId: sport.finalized?.thirdTeamId || teams[2]?.id || teams[0]?.id || ""
  }));
  const isAdmin = role === ROLES.ADMIN;
  const pendingFixtures = sport.fixtures || [];

  useEffect(() => {
    setPlacements({
      firstTeamId: sport.finalized?.firstTeamId || teams[0]?.id || "",
      secondTeamId: sport.finalized?.secondTeamId || teams[1]?.id || teams[0]?.id || "",
      thirdTeamId: sport.finalized?.thirdTeamId || teams[2]?.id || teams[0]?.id || ""
    });
  }, [sport.finalized, teams]);

  function handlePlacementChange(field, value) {
    setPlacements((prev) => ({ ...prev, [field]: value }));
  }

  function handleFinalizeSubmit(e) {
    e.preventDefault();
    onFinalizeSport({
      game: sport.game,
      ...placements
    });
  }

  return (
    <section className="sport-standing-card sport-page-card">
      <div className="sport-standing-header">
        <div>
          <strong>{sport.game}</strong>
          <p className="muted">{sport.category}</p>
        </div>
        <span className="score-rank">
          {sport.finalized ? "Finalized" : `${pendingFixtures.length} Pending`}
        </span>
      </div>

      <StandingsTable
        rows={sport.rows}
        teams={teams}
        myTeam={myTeam}
        columns={[
          { key: "played", label: "P" },
          { key: "won", label: "W" },
          { key: "draw", label: "D" },
          { key: "lost", label: "L" },
          { key: "points", label: "Pts" }
        ]}
      />

      <div className="sport-card-columns">
        <div className="sport-card-block">
          <div className="section-heading tight">
            <div>
              <h3 className="section-title">Fixtures</h3>
              <p className="muted">
                {pendingFixtures.length > 0
                  ? "Pending fixtures for this sport."
                  : "No pending fixtures remain for this sport."}
              </p>
            </div>
          </div>
          {pendingFixtures.length > 0 ? (
            <FixtureList fixtures={pendingFixtures} highlightTeam={myTeam?.name} />
          ) : (
            <p className="muted">All fixtures for this sport are already resolved.</p>
          )}
        </div>

        {isAdmin && (
          <div className="sport-card-block">
            <div className="section-heading tight">
              <div>
                <h3 className="section-title">Admin Controls</h3>
                <p className="muted">Resolve fixtures here and finalize the podium for this sport.</p>
              </div>
            </div>

            {pendingFixtures.length > 0 ? (
              <div className="score-cards single-column">
                {pendingFixtures.map((fixture) => (
                  <div key={fixture.id} className="score-card admin-match-card">
                    <div className="score-card-top">
                      <div>
                        <strong>{fixture.teamA} vs {fixture.teamB}</strong>
                        <p className="muted small">{fixture.time}</p>
                      </div>
                      <span className="score-rank">{fixture.venue}</span>
                    </div>
                    <div className="score-actions">
                      <button
                        type="button"
                        className="btn score-btn win"
                        onClick={() => onResolveFixture(fixture.id, "win")}
                      >
                        {fixture.teamA} Win
                      </button>
                      <button
                        type="button"
                        className="btn score-btn draw"
                        onClick={() => onResolveFixture(fixture.id, "draw")}
                      >
                        Draw
                      </button>
                      <button
                        type="button"
                        className="btn score-btn loss"
                        onClick={() => onResolveFixture(fixture.id, "loss")}
                      >
                        {fixture.teamB} Win
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <form className="sport-finalizer-grid" onSubmit={handleFinalizeSubmit}>
                <label className="field">
                  <span className="field-label">1st Place</span>
                  <select
                    className="select"
                    value={placements.firstTeamId}
                    onChange={(e) => handlePlacementChange("firstTeamId", e.target.value)}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">2nd Place</span>
                  <select
                    className="select"
                    value={placements.secondTeamId}
                    onChange={(e) => handlePlacementChange("secondTeamId", e.target.value)}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">3rd Place</span>
                  <select
                    className="select"
                    value={placements.thirdTeamId}
                    onChange={(e) => handlePlacementChange("thirdTeamId", e.target.value)}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn primary sport-finalizer-button">
                  {sport.finalized ? "Update Final Ranking" : "Finalize Winners"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Fixtures Panel (dedicated tab) ──────────────────────── */

function FixturesPanel({ fixtures, myFixtures, teams, role, myTeam, onDeleteFixture }) {
  const isAdmin = role === ROLES.ADMIN;
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");

  const isPublic = !role;
  const displayFixtures = isAdmin || isPublic ? fixtures : myFixtures;

  const filtered = useMemo(() => {
    let result = displayFixtures;
    if (categoryFilter !== "all") {
      result = result.filter((f) => f.category === categoryFilter);
    }
    if (teamFilter !== "all") {
      result = result.filter(
        (f) => f.teamAId === teamFilter || f.teamBId === teamFilter
      );
    }
    return result;
  }, [displayFixtures, categoryFilter, teamFilter]);

  const categories = [...new Set(fixtures.map((f) => f.category))].sort();

  return (
    <div className="card">
      <div className="card-header">
        <h2>{isAdmin ? "All Fixtures" : isPublic ? "Upcoming Fixtures" : "My Upcoming Fixtures"}</h2>
        <p className="muted">
          {isAdmin || isPublic
            ? `${displayFixtures.length} fixture${displayFixtures.length !== 1 ? "s" : ""} scheduled.`
            : `Showing upcoming matches for ${myTeam?.name || "your team"}.`}
        </p>
      </div>

      {(isAdmin || isPublic) && (
        <div className="filter-bar">
          <div className="filter-group">
            <label className="filter-label">Category</label>
            <select
              className="select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Team</label>
            <select
              className="select"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="all">All Teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-count">{filtered.length} match{filtered.length !== 1 ? "es" : ""}</span>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="muted" style={{ padding: "20px 0", textAlign: "center" }}>
          {isAdmin ? "No fixtures match the selected filters." : "No upcoming fixtures for your team."}
        </p>
      ) : (
        <div className="fixtures-table-wrap">
          <table className="table fixtures-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Category</th>
                <th>Team A</th>
                <th>vs</th>
                <th>Team B</th>
                <th>Time</th>
                <th>Venue</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((fixture) => {
                const isMine =
                  myTeam &&
                  (fixture.teamAId === myTeam.id || fixture.teamBId === myTeam.id);
                return (
                  <tr key={fixture.id} className={isMine ? "table-row-active" : ""}>
                    <td style={{ fontWeight: 600 }}>{fixture.game}</td>
                    <td>
                      <span className="fixture-category-tag">{fixture.category}</span>
                    </td>
                    <td>{fixture.teamA}</td>
                    <td style={{ color: "var(--accent)", textAlign: "center", fontFamily: "var(--font-mono)" }}>VS</td>
                    <td>{fixture.teamB}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{fixture.time}</td>
                    <td>{fixture.venue}</td>
                    {isAdmin && (
                      <td>
                        <button
                          type="button"
                          className="btn-icon-delete"
                          title="Delete fixture"
                          onClick={() => onDeleteFixture(fixture.id)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FixtureList({ fixtures, highlightTeam }) {
  const teamLabel = String(highlightTeam || "").toLowerCase();

  return (
    <ul className="fixture-list">
      {fixtures.map((fixture) => {
        const isMine =
          teamLabel &&
          [fixture.teamA, fixture.teamB].some(
            (teamName) => String(teamName || "").toLowerCase() === teamLabel
          );

        return (
          <li key={fixture.id} className={`fixture-item ${isMine ? "fixture-item-active" : ""}`}>
            <div className="fixture-main">
              <div className="fixture-game">{fixture.game}</div>
            </div>
            <div className="fixture-teams">{fixture.teamA} vs {fixture.teamB}</div>
            <div className="fixture-meta">
              <span className="fixture-meta-pill">{fixture.time}</span>
              <span className="fixture-meta-pill">{fixture.venue}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AdminFixtureForm({ teams, newFixture, setNewFixture, onAddFixture }) {
  const subcategoryOptions = useMemo(
    () => getSubcategoryOptions(newFixture.category),
    [newFixture.category]
  );

  const gameOptions = useMemo(
    () => getGameOptions(newFixture.category, newFixture.subcategory),
    [newFixture.category, newFixture.subcategory]
  );

  function handleChange(e) {
    const { name, value } = e.target;

    if (name === "category") {
      setNewFixture((prev) => ({
        ...prev,
        ...createFixtureForm(value),
        time: prev.time,
        venue: prev.venue,
        teamAId: prev.teamAId,
        teamBId: prev.teamBId
      }));
      return;
    }

    if (name === "subcategory") {
      const nextGames = getGameOptions(newFixture.category, value);
      setNewFixture((prev) => ({
        ...prev,
        subcategory: value,
        game: nextGames.includes(prev.game) ? prev.game : nextGames[0] || ""
      }));
      return;
    }

    if (name === "game") {
      setNewFixture((prev) => ({ ...prev, game: value }));
      return;
    }

    setNewFixture((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Create Fixture</h2>
        <p className="muted">Add a new match with fixed teams so admin can resolve it once later.</p>
      </div>

      <form className="form-grid" onSubmit={onAddFixture}>
        <div className="field">
          <label className="field-label">Category</label>
          <select
            className="select"
            name="category"
            value={newFixture.category}
            onChange={handleChange}
          >
            {CATEGORY_PAGES.filter((page) => page.id !== "home").map((page) => (
              <option key={page.id} value={page.id}>
                {page.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Type</label>
          <select
            className="select"
            name="subcategory"
            value={newFixture.subcategory}
            onChange={handleChange}
            disabled={subcategoryOptions.length <= 1 && !subcategoryOptions[0]}
          >
            {subcategoryOptions.map((option) => (
              <option key={option || "all-games"} value={option}>
                {option || "All Games"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Game</label>
          <select
            className="select"
            name="game"
            value={newFixture.game}
            onChange={handleChange}
          >
            {gameOptions.map((game) => (
              <option key={game} value={game}>
                {game}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Time</label>
          <input
            className="input"
            name="time"
            value={newFixture.time}
            onChange={handleChange}
            placeholder="10:00 AM"
          />
        </div>
        <div className="field">
          <label className="field-label">Venue</label>
          <input
            className="input"
            name="venue"
            value={newFixture.venue}
            onChange={handleChange}
            placeholder="Ground A"
          />
        </div>
        <div className="field">
          <label className="field-label">Team A</label>
          <select
            className="select"
            name="teamAId"
            value={newFixture.teamAId}
            onChange={handleChange}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Team B</label>
          <select
            className="select"
            name="teamBId"
            value={newFixture.teamBId}
            onChange={handleChange}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <button type="submit" className="btn primary">
            Add Fixture
          </button>
        </div>
      </form>
    </div>
  );
}

// Day boundaries (midnight IST)
const DAY_BOUNDARIES = [
  { label: "Day 1", cutoff: 0, image: "/Day-1-standings.png" },
  { label: "Day 2", cutoff: new Date("2026-04-03T00:00:00+05:30").getTime(), image: null },
  { label: "Day 3", cutoff: new Date("2026-04-04T00:00:00+05:30").getTime(), image: null },
];

function getUpdateTimestamp(update) {
  return parseInt(String(update.id).split("-")[0], 10) || 0;
}

function ScoreActivityFeed({ updates }) {
  const [activeDay, setActiveDay] = useState(null);

  const formatResult = (update) => {
    const result = update.result || "";
    const isFinalized = result.includes("finalized:");

    if (isFinalized) {
      const parts = result.split("finalized:")[1]?.trim() || "";
      return { type: "finalized", summary: parts };
    }

    if (result.includes(" beat ")) {
      const [winner] = result.split(" beat ");
      const shortWinner = winner.replace(/\s*\(.*?\)/g, "");
      return { type: "win", summary: `${shortWinner} wins` };
    }
    if (result.includes(" drew with ")) {
      return { type: "draw", summary: "Draw" };
    }
    return { type: "other", summary: result };
  };

  const shortTeams = (teamName) =>
    (teamName || "").replace(/\s*\(.*?\)/g, "").replace(" vs ", " vs ");

  // Group updates by day
  const dayGroups = useMemo(() => {
    const groups = [];
    for (let i = DAY_BOUNDARIES.length - 1; i >= 0; i--) {
      const day = DAY_BOUNDARIES[i];
      const nextCutoff = i < DAY_BOUNDARIES.length - 1 ? DAY_BOUNDARIES[i + 1].cutoff : Infinity;
      const dayUpdates = updates.filter((u) => {
        const ts = getUpdateTimestamp(u);
        return ts >= day.cutoff && ts < nextCutoff;
      });
      if (dayUpdates.length > 0) {
        groups.push({ ...day, updates: dayUpdates });
      }
    }
    return groups;
  }, [updates]);

  // Auto-select latest day with updates
  const selectedDay = activeDay ?? (dayGroups.length > 0 ? dayGroups[0].label : null);
  const currentGroup = dayGroups.find((g) => g.label === selectedDay);

  return (
    <div className="card">
      <div className="card-header">
        <h3>Results Feed</h3>
        <p className="muted">Match outcomes by day.</p>
      </div>

      {dayGroups.length === 0 && (
        <p className="muted small">No match results recorded yet.</p>
      )}

      {dayGroups.length > 0 && (
        <>
          <div className="day-tabs">
            {dayGroups.map((group) => (
              <button
                key={group.label}
                type="button"
                className={`btn ${selectedDay === group.label ? "primary" : "btn-ghost"} small`}
                onClick={() => setActiveDay(group.label)}
              >
                {group.label}
                <span className="day-tab-count">{group.updates.length}</span>
              </button>
            ))}
          </div>

          {currentGroup && currentGroup.image ? (
            <div className="day1-summary">
              <img src={currentGroup.image} alt={`${currentGroup.label} Standings`} className="day1-image" />
            </div>
          ) : currentGroup ? (
            <ul className="activity-list">
              {currentGroup.updates.map((update) => {
                const { type, summary } = formatResult(update);
                const isFinalized = type === "finalized";
                return (
                  <li key={update.id} className={`activity-card ${isFinalized ? "finalized" : ""}`}>
                    <div className="activity-card-top">
                      <span className="activity-game">{update.game || "Match"}</span>
                    </div>
                    <div className="activity-matchup">{shortTeams(update.teamName)}</div>
                    <div className={`activity-result ${type}`}>{summary}</div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ── Live Stream: Admin broadcaster ──────────────────────── */

function LiveStreamAdmin({ socketRef, authToken, isStreaming, setIsStreaming, setIsStreamActive }) {
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [streamError, setStreamError] = useState("");

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((allDevices) => {
      const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);
      if (videoDevices.length && !selectedDevice) {
        setSelectedDevice(videoDevices[0].deviceId);
      }
    }).catch(() => {});
  }, []);

  const startStreaming = useCallback(async () => {
    setStreamError("");
    try {
      const constraints = {
        video: selectedDevice ? { deviceId: { exact: selectedDevice } } : true,
        audio: true
      };
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp8,opus")
        ? "video/webm; codecs=vp8,opus"
        : "video/webm";

      const recorder = new MediaRecorder(mediaStream, {
        mimeType,
        videoBitsPerSecond: 800000
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && socketRef.current) {
          e.data.arrayBuffer().then((buf) => {
            socketRef.current.emit("stream:chunk", buf);
          });
        }
      };

      recorder.start(1000);
      socketRef.current?.emit("stream:start", { token: authToken });
      setIsStreaming(true);
      setIsStreamActive(true);
    } catch (err) {
      setStreamError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access."
          : err.name === "NotFoundError"
            ? "No camera found. Is DroidCam connected?"
            : `Failed to start stream: ${err.message}`
      );
    }
  }, [selectedDevice, authToken, socketRef, setIsStreaming, setIsStreamActive]);

  const stopStreaming = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    socketRef.current?.emit("stream:stop");
    setIsStreaming(false);
    setIsStreamActive(false);
    recorderRef.current = null;
  }, [socketRef, setIsStreaming, setIsStreamActive]);

  // Attach stream to video element whenever isStreaming becomes true
  useEffect(() => {
    if (isStreaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isStreaming]);

  useEffect(() => {
    return () => {
      // Only cleanup if still streaming (streamRef is nulled in stopStreaming)
      if (!streamRef.current) return;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current.getTracks().forEach((track) => track.stop());
      socketRef.current?.emit("stream:stop");
    };
  }, [socketRef]);

  return (
    <div className="card live-stream-card">
      <div className="card-header">
        <h3>
          Live Stream Control
          {isStreaming && <span className="live-badge">LIVE</span>}
        </h3>
        <p className="muted">Broadcast your camera feed to all viewers.</p>
      </div>

      {streamError && <p className="notice error">{streamError}</p>}

      {isStreaming && (
        <video
          ref={videoRef}
          className="live-stream-video"
          autoPlay
          playsInline
          muted
        />
      )}

      <div className="stream-controls">
        {!isStreaming && devices.length > 1 && (
          <select
            className="field-input"
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${devices.indexOf(d) + 1}`}
              </option>
            ))}
          </select>
        )}

        {!isStreaming ? (
          <button type="button" className="btn primary" onClick={startStreaming}>
            Start Streaming
          </button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={stopStreaming}>
            Stop Streaming
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Live Stream: Viewer ─────────────────────────────────── */

function LiveStreamViewer({ socketRef }) {
  const videoRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const chunkQueueRef = useRef([]);
  const blobUrlRef = useRef(null);
  const [ended, setEnded] = useState(false);
  const [viewError, setViewError] = useState("");

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    setEnded(false);
    setViewError("");

    const supportsMediaSource = typeof MediaSource !== "undefined";

    if (supportsMediaSource) {
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      const url = URL.createObjectURL(mediaSource);
      blobUrlRef.current = url;
      if (videoRef.current) {
        videoRef.current.src = url;
      }

      mediaSource.addEventListener("sourceopen", () => {
        try {
          const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp8,opus")
            ? "video/webm; codecs=vp8,opus"
            : "video/webm";
          const sb = mediaSource.addSourceBuffer(mimeType);
          sourceBufferRef.current = sb;

          sb.addEventListener("updateend", () => {
            // Drain queued chunks
            if (chunkQueueRef.current.length > 0 && !sb.updating) {
              const next = chunkQueueRef.current.shift();
              try { sb.appendBuffer(next); } catch {}
            }
            // Cleanup old buffer to prevent memory growth
            try {
              const video = videoRef.current;
              if (video && sb.buffered.length > 0 && video.currentTime > 30) {
                sb.remove(0, video.currentTime - 30);
              }
            } catch {}
          });
        } catch {
          setViewError("Failed to initialize stream playback.");
        }
      });

      mediaSource.addEventListener("error", () => {
        setViewError("Stream playback error occurred.");
      });
    } else {
      setViewError("Your browser does not support live stream playback.");
    }

    const handleChunk = (data) => {
      if (!supportsMediaSource) return;
      const uint8 = new Uint8Array(data);
      const sb = sourceBufferRef.current;
      if (sb && !sb.updating) {
        try { sb.appendBuffer(uint8); } catch {}
      } else {
        chunkQueueRef.current.push(uint8);
        // Cap queue to prevent unbounded growth
        if (chunkQueueRef.current.length > 60) {
          chunkQueueRef.current = chunkQueueRef.current.slice(-30);
        }
      }
    };

    const handleStopped = () => {
      setEnded(true);
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
        try { mediaSourceRef.current.endOfStream(); } catch {}
      }
    };

    socket.on("stream:chunk", handleChunk);
    socket.on("stream:stopped", handleStopped);

    return () => {
      socket.off("stream:chunk", handleChunk);
      socket.off("stream:stopped", handleStopped);
      chunkQueueRef.current = [];
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.src = "";
      }
      mediaSourceRef.current = null;
      sourceBufferRef.current = null;
    };
  }, [socketRef]);

  return (
    <div className="card live-stream-card">
      <div className="card-header">
        <h3>
          Live Stream
          {!ended && <span className="live-badge">LIVE</span>}
        </h3>
      </div>
      {viewError && <p className="notice error">{viewError}</p>}
      {ended ? (
        <p className="muted" style={{ textAlign: "center", padding: "2rem 0" }}>
          Stream has ended.
        </p>
      ) : (
        <video
          ref={videoRef}
          className="live-stream-video"
          autoPlay
          playsInline
          muted
          controls
        />
      )}
    </div>
  );
}

export default App;
