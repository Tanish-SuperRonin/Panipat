import { db } from "./firebase.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  writeBatch
} from "firebase/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ── Static data ─────────────────────────────────────────── */

const TEAMS = [
  { id: "thunder_titans", name: "Thunder Titans (1st Year)" },
  { id: "shadow_havoc", name: "Shadow Havoc (2nd Year)" },
  { id: "synergy_spark", name: "Synergy Spark (3rd Year)" }
];

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

const DEFAULT_FIXTURES = [
  {
    id: 1,
    category: "Outdoor Games",
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
    category: "Outdoor Games",
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

/* ── Helper: clear a collection ──────────────────────────── */

async function clearCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`  Cleared "${collectionName}" (${snap.size} docs)`);
}

/* ── Seed functions ──────────────────────────────────────── */

async function seedTeams() {
  for (const team of TEAMS) {
    await setDoc(doc(db, "teams", team.id), team);
  }
  console.log(`  Seeded ${TEAMS.length} teams`);
}

async function seedUsers() {
  const usersFilePath = path.join(__dirname, "users.json");
  let usersData;

  try {
    const raw = fs.readFileSync(usersFilePath, "utf8");
    usersData = JSON.parse(raw);
  } catch {
    console.error("  Could not read users.json, using defaults");
    usersData = [
      { id: 1, name: "Event Admin", email: "admin@panipat.local", password: "admin123", role: "admin", teamId: null },
      { id: 2, name: "Pratham", email: "pratham@ss.smjv", password: "pratham123", role: "admin", teamId: null },
      { id: 3, name: "Samyak", email: "samyak@ss.smjv", password: "samyak123", role: "admin", teamId: null },
      { id: 4, name: "Megh", email: "megh@ss.smjv", password: "megh123", role: "admin", teamId: null }
    ];
  }

  for (const user of usersData) {
    await setDoc(doc(db, "users", String(user.id)), {
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      teamId: user.teamId || null
    });
  }
  console.log(`  Seeded ${usersData.length} users from users.json`);
}

async function seedSportStandings() {
  for (const sport of SPORT_DEFINITIONS) {
    const rows = TEAMS.map((team) => ({
      teamId: team.id,
      played: 0,
      won: 0,
      draw: 0,
      lost: 0,
      points: 0
    }));

    await setDoc(doc(db, "sportStandings", sport.game), {
      game: sport.game,
      category: sport.category,
      subcategory: sport.subcategory,
      rows
    });
  }
  console.log(`  Seeded ${SPORT_DEFINITIONS.length} sport standings`);
}

async function seedFixtures() {
  for (const fixture of DEFAULT_FIXTURES) {
    await setDoc(doc(db, "fixtures", String(fixture.id)), fixture);
  }
  console.log(`  Seeded ${DEFAULT_FIXTURES.length} fixtures`);
}

async function seedCounters() {
  await setDoc(doc(db, "meta", "counters"), {
    userId: 5,
    fixtureId: 2,
    messageId: 0
  });
  console.log("  Seeded counters");
}

async function seedOverallStandings() {
  const rows = TEAMS.map((team) => ({
    teamId: team.id,
    points: 0,
    firstPlaces: 0,
    secondPlaces: 0,
    thirdPlaces: 0,
    sportsCount: 0
  }));
  await setDoc(doc(db, "meta", "overallStandings"), { rows });
  console.log("  Seeded overall standings");
}

/* ── Main ────────────────────────────────────────────────── */

async function seed() {
  console.log("\nClearing existing data...");
  await clearCollection("teams");
  await clearCollection("users");
  await clearCollection("sportStandings");
  await clearCollection("fixtures");
  await clearCollection("finalizedSports");
  await clearCollection("messages");
  await clearCollection("scoreUpdates");
  await clearCollection("sessions");
  await clearCollection("meta");

  console.log("\nSeeding data...");
  await seedTeams();
  await seedUsers();
  await seedSportStandings();
  await seedFixtures();
  await seedCounters();
  await seedOverallStandings();

  console.log("\nSeed complete!\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
