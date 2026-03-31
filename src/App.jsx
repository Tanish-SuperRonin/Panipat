import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [chatTarget, setChatTarget] = useState("all");
  const [chatText, setChatText] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [globalError, setGlobalError] = useState("");
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

  const visibleMessages = useMemo(() => {
    if (!user) return [];
    if (role === ROLES.ADMIN) return chatMessages;
    return chatMessages.filter(
      (message) => message.target === "all" || message.target === user.teamId
    );
  }, [chatMessages, role, user]);

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
      if (Array.isArray(data.teams) && data.teams.length) setTeams(data.teams);
      const normalizedStandings = normalizeStandingsPayload(data.standings);
      setOverallStandings(normalizedStandings.overall);
      setSportStandings(normalizedStandings.bySport);
      setSportMeta(normalizedStandings.sportMeta);
      setFinalizedSports(normalizedStandings.finalizedSports);
      if (Array.isArray(data.fixtures)) setFixtures(data.fixtures);
      if (Array.isArray(data.messages)) setChatMessages(data.messages);
      if (Array.isArray(data.scoreUpdates)) setScoreUpdates(data.scoreUpdates);
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

  async function handleFinalizeSport(payload) {
    try {
      await postWithAuth("/api/sports/finalize", payload);
      setGlobalError("");
    } catch (error) {
      setGlobalError(error.message);
    }
  }

  async function handleSendChat(e) {
    e.preventDefault();
    if (!chatText.trim()) return;

    try {
      await postWithAuth("/api/messages", {
        target: role === ROLES.ADMIN ? chatTarget : "all",
        text: chatText.trim()
      });
      setChatText("");
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
          <h1>Restoring your dashboard</h1>
          <p className="muted">Checking your session and loading the live event data.</p>
        </div>
      </div>
    );
  }

  if (!user) {
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
            {isConnected ? "Live" : "Offline"}
          </span>
          <button type="button" className="btn btn-ghost small" onClick={handleLogout}>
            Logout
          </button>
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
            onResolveFixture={handleResolveFixture}
            onFinalizeSport={handleFinalizeSport}
          />

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
          <ChatPanel
            role={role}
            teams={teams}
            chatTarget={chatTarget}
            setChatTarget={setChatTarget}
            chatText={chatText}
            setChatText={setChatText}
            messages={visibleMessages}
            onSend={handleSendChat}
          />
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
  authError
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card auth-copy">
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
  onResolveFixture,
  onFinalizeSport
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
          </>
        )}

        <div className="section-heading tight">
          <div>
            <h3 className="section-title">Main Standings</h3>
            <p className="muted">
              Only finalized sports affect this table. First place earns 5 points and second place earns 3 points.
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
      </div>
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

function ChatPanel({
  role,
  teams,
  chatTarget,
  setChatTarget,
  chatText,
  setChatText,
  messages,
  onSend
}) {
  const isAdmin = role === ROLES.ADMIN;

  return (
    <div className="card chat-card">
      <div className="card-header">
        <h3>Event Chat</h3>
        <p className="muted">
          {isAdmin
            ? "Broadcast to all teams or message a single team."
            : "Official event updates shared with your team."}
        </p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && <p className="muted small">No messages yet.</p>}
        {messages.map((message) => (
          <div key={message.id} className="chat-message">
            <div className="chat-meta">
              <span className="chat-from">{message.from}</span>
              <span className="chat-role">{message.role}</span>
              <span className="chat-time">{message.time}</span>
            </div>
            {message.target !== "all" && (
              <div className="chat-target">
                To: <strong>{message.targetLabel}</strong>
              </div>
            )}
            <div className="chat-text">{message.text}</div>
          </div>
        ))}
      </div>

      <form className="chat-input-row" onSubmit={onSend}>
        {isAdmin && (
          <select
            className="select chat-target-select"
            value={chatTarget}
            onChange={(e) => setChatTarget(e.target.value)}
          >
            <option value="all">All Teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="input chat-input"
          placeholder={isAdmin ? "Type announcement or team message..." : "Send a reply..."}
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
        />
        <button type="submit" className="btn primary small">
          Send
        </button>
      </form>
    </div>
  );
}

function ScoreActivityFeed({ updates }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>Results Feed</h3>
        <p className="muted">Recent match outcomes resolved from the admin panel.</p>
      </div>
      {updates.length === 0 && <p className="muted small">No match results recorded yet.</p>}
      <ul className="activity-list">
        {updates.map((update) => (
          <li key={update.id} className="activity-item">
            <span className="activity-team">
              {update.game ? `${update.game}: ` : ""}
              {update.teamName}
            </span>
            <span className="activity-change">{update.result || "Result updated"}</span>
            <span className="activity-time">{update.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
