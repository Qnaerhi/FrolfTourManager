import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  type Auth,
  createUserWithEmailAndPassword,
  getIdToken,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  normalizeCompetitorName,
  type AnnouncementInput,
  type AnnouncementSummary,
  type CompetitionInput,
  type CompetitionStatus,
  type CompetitionSummary,
  type LeaderboardEntry,
  type PointsTableEntry,
  type PublicUser,
  type ScoringConfig,
  type TourInput,
} from "@frolf-tour/shared";
import { ApiError, apiRequest } from "./api";
import clusterAlumniMark from "../assets/clusteralumni.jpg";
import { getWebAuth, isFirebaseClientConfigured } from "./firebase";

type SessionState = {
  token: string | null;
  user: PublicUser | null;
};

type TourRecord = {
  id: string;
  name: string;
  seasonLabel: string;
  description: string;
  rulesText: string;
  isCurrent: boolean;
  scoring: ScoringConfig;
  createdAt: string;
  updatedAt: string;
};

type CompetitorRecord = {
  id: string;
  tourId: string;
  displayName: string;
  aliases: string[];
  linkedUserId: string | null;
};

type HomePayload = {
  announcements: AnnouncementSummary[];
  tours: TourRecord[];
  competitions: CompetitionSummary[];
};

type TourDetailPayload = {
  tour: TourRecord;
  competitorCount: number;
  competitions: CompetitionSummary[];
  announcements: AnnouncementSummary[];
  standings: LeaderboardEntry[];
};

type UsersPayload = {
  users: PublicUser[];
};

type CompetitionFormResult = {
  displayName: string;
  placement: string;
  resultValue: string;
  tieBreakRank: string;
  tieBreakNote: string;
};

type CompetitionFormState = {
  tourId: string;
  title: string;
  description: string;
  location: string;
  scheduledAt: string;
  organizerName: string;
  scoresheetUrl: string;
  status: CompetitionStatus;
  participants: string[];
  results: CompetitionFormResult[];
};

type CompetitionDraftFormState = {
  tourId: string;
  title: string;
  description: string;
  location: string;
  scheduledAt: string;
  organizerName: string;
  scoresheetUrl: string;
};

type TourFormState = {
  name: string;
  seasonLabel: string;
  description: string;
  rulesText: string;
  isCurrent: boolean;
  countedResultsLimit: string;
  pointsTableText: string;
};

type AnnouncementFormState = {
  title: string;
  body: string;
  pinned: boolean;
  tourId: string;
};

const sessionStorageKey = "frolf-tour-manager-session";
const emptySession: SessionState = {
  token: null,
  user: null,
};

function loadSession(): SessionState {
  const raw = window.localStorage.getItem(sessionStorageKey);

  if (!raw) {
    return {
      token: null,
      user: null,
    };
  }

  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return {
      token: null,
      user: null,
    };
  }
}

function persistSession(session: SessionState) {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

function emptyCompetitionDraftForm(userName = ""): CompetitionDraftFormState {
  return {
    tourId: "",
    title: "",
    description: "",
    location: "",
    scheduledAt: "",
    organizerName: userName,
    scoresheetUrl: "",
  };
}

function emptyTourForm(): TourFormState {
  return {
    name: "",
    seasonLabel: "",
    description: "",
    rulesText: "",
    isCurrent: false,
    countedResultsLimit: "",
    pointsTableText: "1: 15\n2: 12\n3: 10\n4: 8\n5: 6\n6: 4\n7: 2",
  };
}

function emptyAnnouncementForm(): AnnouncementFormState {
  return {
    title: "",
    body: "",
    pinned: false,
    tourId: "",
  };
}

function syncResults(participants: string[], previousResults: CompetitionFormResult[]): CompetitionFormResult[] {
  const existing = new Map(
    previousResults
      .filter((result) => result.displayName.trim())
      .map((result) => [normalizeCompetitorName(result.displayName), result]),
  );

  return participants
    .map((participant) => participant.trim())
    .filter(Boolean)
    .map((participant) => {
      const match = existing.get(normalizeCompetitorName(participant));

      return (
        match ?? {
          displayName: participant,
          placement: "",
          resultValue: "",
          tieBreakRank: "",
          tieBreakNote: "",
        }
      );
    })
    .map((result) => ({
      ...result,
      displayName: result.displayName.trim(),
    }));
}

function pointsTableToText(pointsTable: PointsTableEntry[]): string {
  return pointsTable.map((entry) => `${entry.place}: ${entry.points}`).join("\n");
}

function parsePointsTable(pointsTableText: string): PointsTableEntry[] {
  return pointsTableText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [placeText, pointsText] = line.split(":").map((value) => value.trim());
      return {
        place: Number(placeText),
        points: Number(pointsText),
      };
    });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function toSafeExternalHref(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDateTimeLocalValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function localDatePart(value: string): string {
  if (!value) return "";
  return value.split("T")[0] ?? "";
}

function localTimePart(value: string): string {
  if (!value) return "";
  const rawTime = value.split("T")[1] ?? "";
  return rawTime.slice(0, 5);
}

function mergeLocalDateTime(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

function toCompetitionForm(competition: CompetitionSummary): CompetitionFormState {
  return {
    tourId: competition.tourId,
    title: competition.title,
    description: competition.description,
    location: competition.location,
    scheduledAt: formatDateTimeLocalValue(competition.scheduledAt),
    organizerName: competition.organizerName,
    scoresheetUrl: competition.scoresheetUrl ?? "",
    status: competition.status,
    participants: competition.participants.map((participant) => participant.displayName),
    results: competition.results.map((result) => ({
      displayName: result.displayName,
      placement: String(result.placement),
      resultValue: String(result.resultValue),
      tieBreakRank: result.tieBreakRank ? String(result.tieBreakRank) : "",
      tieBreakNote: result.tieBreakNote ?? "",
    })),
  };
}

function toTourForm(tour: TourRecord): TourFormState {
  return {
    name: tour.name,
    seasonLabel: tour.seasonLabel,
    description: tour.description,
    rulesText: tour.rulesText ?? "",
    isCurrent: tour.isCurrent ?? false,
    countedResultsLimit: tour.scoring.countedResultsLimit ? String(tour.scoring.countedResultsLimit) : "",
    pointsTableText: pointsTableToText(tour.scoring.pointsTable),
  };
}

function toAnnouncementForm(announcement: AnnouncementSummary): AnnouncementFormState {
  return {
    title: announcement.title,
    body: announcement.body,
    pinned: announcement.pinned,
    tourId: announcement.tourId ?? "",
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

function SectionCard({
  title,
  children,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function HomePage() {
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<HomePayload>("/api/home")
      .then(setData)
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, []);

  if (error) {
    return <p className="status error">{error}</p>;
  }

  if (!data) {
    return <p className="status">Loading home page...</p>;
  }

  return (
    <div className="page-grid">
      <SectionCard title="Announcements" subtitle="Latest updates from the tour organizers.">
        <div className="stack">
          {data.announcements.length ? (
            data.announcements.map((announcement) => (
              <article key={announcement.id} className="list-item">
                <div className="list-item-heading">
                  <strong>{announcement.title}</strong>
                  {announcement.pinned ? <span className="badge">Pinned</span> : null}
                </div>
                <p>{announcement.body}</p>
                <small>{formatDateTime(announcement.publishedAt)}</small>
              </article>
            ))
          ) : (
            <p>No announcements yet.</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Tours" subtitle="Browse seasons and their current standings.">
        <div className="stack">
          {data.tours.map((tour) => (
            <article key={tour.id} className="list-item">
              <div className="list-item-heading">
                <Link to={`/tours/${tour.id}`}>{tour.name}</Link>
                <span className="badge">{tour.seasonLabel}</span>
              </div>
              <p className="multiline-text">{tour.description}</p>
              <small>
                Best {tour.scoring.countedResultsLimit ?? "all"} results count
              </small>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Recent Competitions" subtitle="Public competitions from all tours.">
        <div className="stack">
          {data.competitions.length ? (
            data.competitions.map((competition) => (
              <article key={competition.id} className="list-item">
                <div className="list-item-heading">
                  <Link to={`/competitions/${competition.id}`}>{competition.title}</Link>
                  <span className={`badge badge-${competition.status}`}>{competition.status}</span>
                </div>
                <p>
                  {competition.location} • {formatDateTime(competition.scheduledAt)}
                </p>
                <small>Organized by {competition.organizerName}</small>
              </article>
            ))
          ) : (
            <p>No public competitions yet.</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function TourPage() {
  const { tourId } = useParams();
  const [data, setData] = useState<TourDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tourId) {
      return;
    }

    apiRequest<TourDetailPayload>(`/api/tours/${tourId}`)
      .then(setData)
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [tourId]);

  if (error) {
    return <p className="status error">{error}</p>;
  }

  if (!data) {
    return <p className="status">Loading tour...</p>;
  }

  return (
    <div className="page-grid">
      <SectionCard title={`${data.tour.name} (${data.tour.seasonLabel})`} subtitle="Current standings">
        {data.standings.length ? (
          <ol className="standings-list">
            {data.standings.map((entry) => (
              <li key={entry.competitorId} className="standings-item">
                <div className="standings-rank-wrap">
                  {entry.rank <= 3 ? (
                    <span className={`medal medal-${entry.rank}`} aria-label={`Rank ${entry.rank} medal`}>
                      {entry.rank}
                    </span>
                  ) : (
                    <span className="standings-rank">{entry.rank}</span>
                  )}
                  <strong>{entry.displayName}</strong>
                </div>
                <small>
                  {entry.totalPoints} pts • {entry.aggregateResultValue} aggregate • {entry.countedResults.length} events
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>No finalized competitions yet.</p>
        )}
      </SectionCard>

      <SectionCard title="Tour Description And Rules" subtitle={`${data.competitorCount} competitor profiles`}>
        <p className="multiline-text">{data.tour.description}</p>
        <div className="stack rules-section">
          <div>
            <strong>Scoring summary</strong>
            <p>
              Best {data.tour.scoring.countedResultsLimit ?? "all"} results count
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tour.scoring.pointsTable.map((entry) => (
                    <tr key={entry.place}>
                      <td>{entry.place}</td>
                      <td>{entry.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <strong>Rules</strong>
            {data.tour.rulesText?.trim() ? <p className="multiline-text">{data.tour.rulesText}</p> : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Competitions" subtitle="Public competitions for this tour.">
        <div className="stack">
          {data.competitions.map((competition) => (
            <article key={competition.id} className="list-item">
              <div className="list-item-heading">
                <Link to={`/competitions/${competition.id}`}>{competition.title}</Link>
                <span className={`badge badge-${competition.status}`}>{competition.status}</span>
              </div>
              <p>
                {competition.location} • {formatDateTime(competition.scheduledAt)}
              </p>
              <small>{competition.participants.length} participants</small>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Announcements">
        <div className="stack">
          {data.announcements.length ? (
            data.announcements.map((announcement) => (
              <article key={announcement.id} className="list-item">
                <div className="list-item-heading">
                  <strong>{announcement.title}</strong>
                  {announcement.pinned ? <span className="badge">Pinned</span> : null}
                </div>
                <p>{announcement.body}</p>
              </article>
            ))
          ) : (
            <p>No announcements for this tour.</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function CurrentTourRedirectPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ tour: TourRecord }>("/api/tours/current")
      .then((payload) => {
        navigate(`/tours/${payload.tour.id}`, { replace: true });
      })
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [navigate]);

  if (error) {
    return <p className="status error">{error}</p>;
  }

  return <p className="status">Loading current tour...</p>;
}

function CompetitionPage() {
  const { competitionId } = useParams();
  const [session] = useState<SessionState>(() => loadSession());
  const [competition, setCompetition] = useState<CompetitionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signupBusy, setSignupBusy] = useState(false);

  useEffect(() => {
    if (!competitionId) {
      return;
    }

    apiRequest<{ competition: CompetitionSummary }>(`/api/competitions/${competitionId}`)
      .then((payload) => setCompetition(payload.competition))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [competitionId]);

  if (error) {
    return <p className="status error">{error}</p>;
  }

  if (!competition) {
    return <p className="status">Loading competition...</p>;
  }

  const hasStarted = new Date(competition.scheduledAt).getTime() <= Date.now();
  const canSelfSignup = competition.status === "published" && !hasStarted;
  const safeScoresheetUrl = toSafeExternalHref(competition.scoresheetUrl);
  const isSignedUp =
    !!session.user &&
    competition.participants.some(
      (participant) =>
        normalizeCompetitorName(participant.displayName) === normalizeCompetitorName(session.user?.name ?? ""),
    );

  async function handleSelfSignup() {
    if (!session.token || !competitionId) {
      return;
    }

    setSignupBusy(true);
    setError(null);

    try {
      const payload = await apiRequest<{ competition: CompetitionSummary }>(
        `/api/competitions/${competitionId}/signup`,
        { method: "POST" },
        session.token,
      );
      setCompetition(payload.competition);
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setSignupBusy(false);
    }
  }

  async function handleSelfUnenroll() {
    if (!session.token || !competitionId) {
      return;
    }

    setSignupBusy(true);
    setError(null);

    try {
      const payload = await apiRequest<{ competition: CompetitionSummary }>(
        `/api/competitions/${competitionId}/signup`,
        { method: "DELETE" },
        session.token,
      );
      setCompetition(payload.competition);
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setSignupBusy(false);
    }
  }

  return (
    <div className="page-grid">
      <SectionCard title={competition.title} subtitle={competition.description}>
        <p>
          {competition.location} • {formatDateTime(competition.scheduledAt)}
        </p>
        <p>Organized by {competition.organizerName}</p>
        <p>Status: {competition.status}</p>
        {competition.status === "published" ? (
          canSelfSignup ? (
            session.token ? (
              <div className="inline-actions">
                {!isSignedUp ? (
                  <button type="button" onClick={handleSelfSignup} disabled={signupBusy}>
                    {signupBusy ? "Signing up..." : "Sign up as player"}
                  </button>
                ) : (
                  <button type="button" className="secondary-button" onClick={handleSelfUnenroll} disabled={signupBusy}>
                    {signupBusy ? "Removing..." : "Remove me from competition"}
                  </button>
                )}
              </div>
            ) : (
              <p>
                <Link to="/dashboard?tab=account">Sign in</Link> to sign up for this competition.
              </p>
            )
          ) : (
            <small>Self-signup is closed because this competition has started.</small>
          )
        ) : null}
        {safeScoresheetUrl ? (
          <p>
            Scoresheet:{" "}
            <a href={safeScoresheetUrl} target="_blank" rel="noreferrer">
              Open link
            </a>
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title="Participants">
        <ul className="simple-list">
          {competition.participants.map((participant) => (
            <li key={participant.competitorId}>{participant.displayName}</li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Results">
        {competition.results.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Competitor</th>
                  <th>Result</th>
                  <th>Points</th>
                  <th>Tie-break</th>
                </tr>
              </thead>
              <tbody>
                {competition.results.map((result) => (
                  <tr key={result.competitorId}>
                    <td>{result.placement}</td>
                    <td>{result.displayName}</td>
                    <td>{result.resultValue}</td>
                    <td>{result.awardedPoints}</td>
                    <td>
                      {result.tieBreakRank ? `#${result.tieBreakRank}` : "-"}
                      {result.tieBreakNote ? ` • ${result.tieBreakNote}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Results have not been entered yet.</p>
        )}
      </SectionCard>
    </div>
  );
}

function AuthSection({
  session,
  onSessionChange,
  onNotice,
}: {
  session: SessionState;
  onSessionChange: (next: SessionState) => void;
  onNotice: (message: string) => void;
}) {
  const webAuth = getWebAuth();
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!webAuth) {
    if (session.user) {
      return (
        <SectionCard
          title="Account"
          subtitle="Firebase client is not configured in this environment."
        >
          <div className="stack">
            <p className="status error">
              Sign-in state cannot be refreshed without Firebase web config. Copy{" "}
              <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, set all <code>VITE_FIREBASE_*</code>{" "}
              variables, then restart Vite.
            </p>
            <button type="button" className="secondary-button" onClick={() => onSessionChange(emptySession)}>
              Clear saved session
            </button>
          </div>
        </SectionCard>
      );
    }

    return (
      <SectionCard
        title="Sign In Or Register"
        subtitle="Accounts use Firebase email and password. Email verification is required for organizers."
      >
        <p className="status">
          Firebase is not configured: copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, fill in
          all <code>VITE_FIREBASE_*</code> values from the Firebase console, then restart the dev server. Public pages
          (home, tours, competitions) still work without it.
        </p>
      </SectionCard>
    );
  }

  const auth: Auth = webAuth;

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const credential = await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      const trimmedName = registerName.trim();
      if (trimmedName) {
        await updateProfile(credential.user, { displayName: trimmedName });
      }
      await sendEmailVerification(credential.user);
      const token = await getIdToken(credential.user, true);
      const payload = await apiRequest<{ user: PublicUser }>("/api/auth/me", {}, token);
      onSessionChange({ token, user: payload.user });
      onNotice("Account created. Check your inbox to verify your email.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const credential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const token = await getIdToken(credential.user, true);
      const payload = await apiRequest<{ user: PublicUser }>("/api/auth/me", {}, token);
      onSessionChange({ token, user: payload.user });
      onNotice("You are now signed in.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  async function handleSendVerificationEmail() {
    if (!auth.currentUser) {
      setError("You must be signed in to send a verification email.");
      return;
    }

    setError(null);

    try {
      await sendEmailVerification(auth.currentUser);
      onNotice("Verification email sent.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  async function handleRefreshVerification() {
    if (!auth.currentUser) {
      setError("You must be signed in to refresh verification status.");
      return;
    }

    setError(null);

    try {
      await auth.currentUser.reload();
      const token = await getIdToken(auth.currentUser, true);
      const payload = await apiRequest<{ user: PublicUser }>("/api/auth/me", {}, token);
      onSessionChange({ token, user: payload.user });
      onNotice(payload.user.emailVerified ? "Email verified." : "Email is still unverified.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  async function handleSignOut() {
    setError(null);

    try {
      await signOut(auth);
      onSessionChange(emptySession);
      onNotice("You have been signed out.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  if (session.user) {
    return (
      <SectionCard
        title="Account"
        subtitle="Verified users can create competitions. Admins can manage tours, announcements, and users."
      >
        <div className="stack">
          <div className="list-item">
            <div className="list-item-heading">
              <strong>{session.user.name}</strong>
              <span className="badge">{session.user.emailVerified ? "Verified" : "Unverified"}</span>
            </div>
            <p>{session.user.email}</p>
            <small>Roles: {session.user.roles.join(", ")}</small>
          </div>

          {!session.user.emailVerified ? (
            <div className="inline-actions">
              <button type="button" onClick={handleSendVerificationEmail}>
                Send verification email
              </button>
              <button type="button" className="secondary-button" onClick={handleRefreshVerification}>
                I have verified my email
              </button>
            </div>
          ) : null}

          <button type="button" className="secondary-button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
        {error ? <p className="status error">{error}</p> : null}
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Sign In Or Register" subtitle="Accounts use Firebase email and password. Email verification is required for organizers.">
      <div className="grid-two">
        <form className="stack" onSubmit={handleRegister}>
          <h3>Create account</h3>
          <label>
            Name
            <input value={registerName} onChange={(event) => setRegisterName(event.target.value)} required />
          </label>
          <label>
            Email
            <input value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              value={registerPassword}
              onChange={(event) => setRegisterPassword(event.target.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
          <button type="submit">Create account</button>
        </form>

        <form className="stack" onSubmit={handleLogin}>
          <h3>Sign in</h3>
          <label>
            Email
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </div>
      {error ? <p className="status error">{error}</p> : null}
    </SectionCard>
  );
}

function TourAdminSection({
  token,
  isAdmin,
  tours,
  onToursChange,
  onNotice,
}: {
  token: string;
  isAdmin: boolean;
  tours: TourRecord[];
  onToursChange: (tours: TourRecord[]) => void;
  onNotice: (message: string) => void;
}) {
  const [selectedTourId, setSelectedTourId] = useState("");
  const [form, setForm] = useState<TourFormState>(emptyTourForm());
  const [error, setError] = useState<string | null>(null);
  const currentTour = useMemo(() => tours.find((tour) => tour.isCurrent) ?? null, [tours]);

  useEffect(() => {
    if (!selectedTourId && currentTour) {
      setSelectedTourId(currentTour.id);
    }
  }, [selectedTourId, currentTour]);

  useEffect(() => {
    if (!selectedTourId) {
      setForm(emptyTourForm());
      return;
    }

    const selectedTour = tours.find((tour) => tour.id === selectedTourId);
    if (selectedTour) {
      setForm(toTourForm(selectedTour));
    }
  }, [selectedTourId, tours]);

  if (!isAdmin) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: TourInput = {
      name: form.name,
      seasonLabel: form.seasonLabel,
      description: form.description,
      rulesText: form.rulesText,
      isCurrent: form.isCurrent,
      scoring: {
        resultOrder: "lower-is-better",
        countedResultsLimit: form.countedResultsLimit ? Number(form.countedResultsLimit) : null,
        pointsTable: parsePointsTable(form.pointsTableText),
      },
    };

    try {
      const response = await apiRequest<{ tour: TourRecord }>(
        selectedTourId ? `/api/tours/${selectedTourId}` : "/api/tours",
        {
          method: selectedTourId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
        token,
      );

      const nextTours = selectedTourId
        ? tours.map((tour) => (tour.id === response.tour.id ? response.tour : tour))
        : [response.tour, ...tours];
      onToursChange(nextTours);
      setSelectedTourId(response.tour.id);
      setForm(toTourForm(response.tour));
      onNotice(selectedTourId ? "Tour updated." : "Tour created.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  return (
    <SectionCard title="Tour Admin" subtitle="Edit the current tour, create tours, and adjust scoring rules.">
      <form className="stack" onSubmit={handleSubmit}>
        {currentTour ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSelectedTourId(currentTour.id);
              setForm(toTourForm(currentTour));
            }}
          >
            Edit current tour: {currentTour.name}
          </button>
        ) : (
          <p className="status">No current tour is set yet. Create one and enable "Set as current tour".</p>
        )}
        <label>
          Existing tour
          <select value={selectedTourId} onChange={(event) => setSelectedTourId(event.target.value)}>
            <option value="">Create new tour</option>
            {tours.map((tour) => (
              <option key={tour.id} value={tour.id}>
                {tour.name} ({tour.seasonLabel}){tour.isCurrent ? " • current" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tour name
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          Season label
          <input
            value={form.seasonLabel}
            onChange={(event) => setForm({ ...form, seasonLabel: event.target.value })}
            required
          />
        </label>
        <label>
          Description
          <textarea
            className="multiline-textarea"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={8}
            required
          />
        </label>
        <label>
          Rules
          <textarea
            className="multiline-textarea"
            value={form.rulesText}
            onChange={(event) => setForm({ ...form, rulesText: event.target.value })}
            rows={12}
            placeholder="Optional season-specific rules and notes"
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.isCurrent}
            onChange={(event) => setForm({ ...form, isCurrent: event.target.checked })}
          />
          Set as current tour
        </label>
        <label>
          Best N results count
          <input
            value={form.countedResultsLimit}
            onChange={(event) => setForm({ ...form, countedResultsLimit: event.target.value })}
            placeholder="Leave empty for all"
          />
        </label>
        <label>
          Points table
          <textarea
            className="multiline-textarea"
            value={form.pointsTableText}
            onChange={(event) => setForm({ ...form, pointsTableText: event.target.value })}
            rows={10}
            required
          />
        </label>
        <button type="submit">{selectedTourId ? "Update tour" : "Create tour"}</button>
      </form>
      {error ? <p className="status error">{error}</p> : null}
    </SectionCard>
  );
}

function AnnouncementAdminSection({
  token,
  isAdmin,
  tours,
  onNotice,
}: {
  token: string;
  isAdmin: boolean;
  tours: TourRecord[];
  onNotice: (message: string) => void;
}) {
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([]);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState("");
  const [form, setForm] = useState<AnnouncementFormState>(emptyAnnouncementForm());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    apiRequest<{ announcements: AnnouncementSummary[] }>("/api/announcements")
      .then((payload) => setAnnouncements(payload.announcements))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedAnnouncementId) {
      setForm(emptyAnnouncementForm());
      return;
    }

    const announcement = announcements.find((entry) => entry.id === selectedAnnouncementId);
    if (announcement) {
      setForm(toAnnouncementForm(announcement));
    }
  }, [selectedAnnouncementId, announcements]);

  if (!isAdmin) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: AnnouncementInput = {
      title: form.title,
      body: form.body,
      pinned: form.pinned,
      tourId: form.tourId || null,
    };

    try {
      const response = await apiRequest<{ announcement: AnnouncementSummary }>(
        selectedAnnouncementId ? `/api/announcements/${selectedAnnouncementId}` : "/api/announcements",
        {
          method: selectedAnnouncementId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
        token,
      );

      const nextAnnouncements = selectedAnnouncementId
        ? announcements.map((announcement) =>
            announcement.id === response.announcement.id ? response.announcement : announcement,
          )
        : [response.announcement, ...announcements];

      setAnnouncements(nextAnnouncements);
      setSelectedAnnouncementId(response.announcement.id);
      setForm(toAnnouncementForm(response.announcement));
      onNotice(selectedAnnouncementId ? "Announcement updated." : "Announcement created.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  return (
    <SectionCard title="Announcements" subtitle="Create front-page updates and optional tour-specific notices.">
      <form className="stack" onSubmit={handleSubmit}>
        <label>
          Existing announcement
          <select value={selectedAnnouncementId} onChange={(event) => setSelectedAnnouncementId(event.target.value)}>
            <option value="">Create new announcement</option>
            {announcements.map((announcement) => (
              <option key={announcement.id} value={announcement.id}>
                {announcement.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </label>
        <label>
          Body
          <textarea
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            rows={5}
            required
          />
        </label>
        <label>
          Tour scope
          <select value={form.tourId} onChange={(event) => setForm({ ...form, tourId: event.target.value })}>
            <option value="">Global announcement</option>
            {tours.map((tour) => (
              <option key={tour.id} value={tour.id}>
                {tour.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.pinned}
            onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
          />
          Pin this announcement
        </label>
        <button type="submit">{selectedAnnouncementId ? "Update announcement" : "Create announcement"}</button>
      </form>
      {error ? <p className="status error">{error}</p> : null}
    </SectionCard>
  );
}

function UserAdminSection({
  token,
  isAdmin,
  onNotice,
}: {
  token: string;
  isAdmin: boolean;
  onNotice: (message: string) => void;
}) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    apiRequest<UsersPayload>("/api/users", {}, token)
      .then((payload) => setUsers(payload.users))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [isAdmin, token]);

  if (!isAdmin) {
    return null;
  }

  async function updateUser(user: PublicUser, nextAdminValue: boolean, nextVerifiedValue: boolean) {
    setError(null);

    try {
      const response = await apiRequest<{ user: PublicUser }>(
        `/api/users/${user.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            roles: nextAdminValue ? ["user", "admin"] : ["user"],
            emailVerified: nextVerifiedValue,
          }),
        },
        token,
      );

      setUsers((current) => current.map((entry) => (entry.id === user.id ? response.user : entry)));
      onNotice("User updated.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  return (
    <SectionCard title="User Management" subtitle="Promote admins and verify accounts if needed.">
      <div className="stack">
        {users.map((user) => {
          const isUserAdmin = user.roles.includes("admin");
          return (
            <article key={user.id} className="list-item">
              <div className="list-item-heading">
                <strong>{user.name}</strong>
                <span className="badge">{user.emailVerified ? "Verified" : "Unverified"}</span>
              </div>
              <p>{user.email}</p>
              <div className="inline-actions">
                <button type="button" onClick={() => updateUser(user, !isUserAdmin, user.emailVerified)}>
                  {isUserAdmin ? "Remove admin" : "Make admin"}
                </button>
                <button type="button" onClick={() => updateUser(user, isUserAdmin, !user.emailVerified)}>
                  {user.emailVerified ? "Mark unverified" : "Verify email"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {error ? <p className="status error">{error}</p> : null}
    </SectionCard>
  );
}

function CompetitionEditorSection({
  session,
  tours,
  token,
  onNotice,
}: {
  session: SessionState;
  tours: TourRecord[];
  token: string;
  onNotice: (message: string) => void;
}) {
  const [myCompetitions, setMyCompetitions] = useState<CompetitionSummary[]>([]);
  const [allCompetitions, setAllCompetitions] = useState<CompetitionSummary[]>([]);
  const [form, setForm] = useState<CompetitionDraftFormState>(emptyCompetitionDraftForm(session.user?.name ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [competitionView, setCompetitionView] = useState<"all" | "my" | "add">("all");
  const navigate = useNavigate();
  const activeTour = tours.find((tour) => tour.isCurrent) ?? null;

  useEffect(() => {
    apiRequest<{ competitions: CompetitionSummary[] }>("/api/competitions")
      .then((payload) => setAllCompetitions(payload.competitions))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, []);

  useEffect(() => {
    apiRequest<{ competitions: CompetitionSummary[] }>("/api/my/competitions", {}, token)
      .then((payload) => setMyCompetitions(payload.competitions))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [token]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      organizerName: session.user?.name ?? "",
    }));
  }, [session.user?.name]);

  useEffect(() => {
    if (!activeTour) {
      return;
    }

    setForm((current) => ({
      ...current,
      tourId: activeTour.id,
    }));
  }, [activeTour?.id]);

  if (!session.user?.emailVerified) {
    return (
      <SectionCard title="Competition Organizer" subtitle="Verify your email before creating competitions.">
        <p>Competition tools unlock after email verification.</p>
      </SectionCard>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.tourId) {
      setError("No active tour is configured. Set a current tour before creating competitions.");
      return;
    }

    const payload: CompetitionInput = {
      tourId: form.tourId,
      title: form.title,
      description: form.description,
      location: form.location,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      organizerName: form.organizerName,
      scoresheetUrl: form.scoresheetUrl,
      status: "draft",
      participants: [],
      results: [],
    };

    try {
      const response = await apiRequest<{ competition: CompetitionSummary }>(
        "/api/competitions",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );

      setMyCompetitions((current) => [response.competition, ...current]);
      setForm(emptyCompetitionDraftForm(session.user?.name ?? ""));
      onNotice("Competition created. Continue in the manage view.");
      navigate(`/dashboard/competitions/${response.competition.id}/manage`);
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  return (
    <section className="card competitions-card">
      <div className="competition-nav-tools">
        <div className="competition-list-toggle">
          <button
            type="button"
            className={`secondary-button${competitionView === "all" ? " active-subitem" : ""}`}
            onClick={() => setCompetitionView("all")}
          >
            All competitions
          </button>
          <button
            type="button"
            className={`secondary-button${competitionView === "my" ? " active-subitem" : ""}`}
            onClick={() => setCompetitionView("my")}
          >
            My competitions
          </button>
        </div>
        <button
          type="button"
          className={competitionView === "add" ? "active-subitem" : ""}
          onClick={() => setCompetitionView("add")}
        >
          Add competition
        </button>
      </div>

      {competitionView === "add" ? (
        <form className="stack" onSubmit={handleSubmit}>
          {!activeTour ? <p className="status error">No active tour found. Ask an admin to mark one tour as current.</p> : null}
          <label>
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </label>
          <label>
            Organizer name
            <input
              value={form.organizerName}
              onChange={(event) => setForm({ ...form, organizerName: event.target.value })}
              required
            />
          </label>
          <div className="grid-two">
            <label>
              Location
              <input
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
                required
              />
            </label>
            <label>
              Competition date
              <input
                type="date"
                value={localDatePart(form.scheduledAt)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scheduledAt: mergeLocalDateTime(event.target.value, localTimePart(form.scheduledAt) || "12:00"),
                  })
                }
                required
              />
            </label>
            <label>
              Competition time
              <input
                type="time"
                value={localTimePart(form.scheduledAt)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scheduledAt: mergeLocalDateTime(localDatePart(form.scheduledAt), event.target.value),
                  })
                }
                disabled={!localDatePart(form.scheduledAt)}
                required
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={4}
              required
            />
          </label>
          <label>
            Scoresheet URL
            <input
              value={form.scoresheetUrl}
              onChange={(event) => setForm({ ...form, scoresheetUrl: event.target.value })}
              placeholder="https://..."
            />
          </label>
          <small>Participants and results are managed after creation.</small>
          <button type="submit" disabled={!activeTour}>
            Create competition
          </button>
        </form>
      ) : (
        <div className="stack competition-list-panel">
          <h3>{competitionView === "all" ? "All competitions" : "My competitions"}</h3>
          {(competitionView === "all" ? allCompetitions : myCompetitions).length ? (
            (competitionView === "all" ? allCompetitions : myCompetitions).map((competition) => (
              <article key={competition.id} className="list-item competition-list-item">
                <div className="list-item-heading">
                  <div className="inline-actions competition-item-main">
                    <strong>{competition.title}</strong>
                    <span className={`badge badge-${competition.status}`}>{competition.status}</span>
                  </div>
                  {competitionView === "my" ? (
                    <button type="button" className="secondary-button" onClick={() => navigate(`/dashboard/competitions/${competition.id}/manage`)}>
                      Manage
                    </button>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => navigate(`/competitions/${competition.id}`)}>
                      Open
                    </button>
                  )}
                </div>
                <small>
                  {competition.location} • {formatDateTime(competition.scheduledAt)}
                </small>
              </article>
            ))
          ) : (
            <p>{competitionView === "all" ? "No public competitions yet." : "No competitions created yet."}</p>
          )}
        </div>
      )}
      {error ? <p className="status error">{error}</p> : null}
    </section>
  );
}
function CompetitionManagePage({
  session,
  onNotice,
}: {
  session: SessionState;
  onNotice: (message: string) => void;
}) {
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<CompetitionFormState | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [participantInput, setParticipantInput] = useState("");
  const participantSuggestionListId = "participant-user-suggestions";

  useEffect(() => {
    if (!session.token || !competitionId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    apiRequest<{ competition: CompetitionSummary }>(`/api/competitions/${competitionId}`, {}, session.token)
      .then((payload) => {
        setForm(toCompetitionForm(payload.competition));
      })
      .catch((requestError) => setError(extractErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [competitionId, session.token]);

  useEffect(() => {
    if (!session.token) {
      setUsers([]);
      return;
    }

    apiRequest<UsersPayload>("/api/users", {}, session.token)
      .then((payload) => setUsers(payload.users))
      .catch(() => setUsers([]));
  }, [session.token]);

  if (!session.token || !session.user) {
    return (
      <SectionCard title="Manage Competition" subtitle="Sign in to manage a competition.">
        <p>You need to sign in before you can manage competitions.</p>
        <button type="button" onClick={() => navigate("/dashboard")}>
          Go to dashboard
        </button>
      </SectionCard>
    );
  }

  if (!session.user.emailVerified) {
    return (
      <SectionCard title="Manage Competition" subtitle="Verify your email to manage competition details.">
        <p>Competition tools unlock after email verification.</p>
        <button type="button" onClick={() => navigate("/dashboard")}>
          Go to dashboard
        </button>
      </SectionCard>
    );
  }

  if (loading || !form) {
    return <p className="status">Loading competition...</p>;
  }

  const participants = form.participants.map((participant) => participant.trim()).filter(Boolean);
  const normalizedResults = syncResults(participants, form.results);
  const hasCompleteResults =
    normalizedResults.length === participants.length &&
    normalizedResults.every((result) => result.placement.trim() && result.resultValue.trim());

  const allowedStatuses: CompetitionStatus[] = [
    "draft",
    ...(participants.length >= 3 ? (["published"] as CompetitionStatus[]) : []),
    ...(participants.length >= 3 && hasCompleteResults ? (["finalized"] as CompetitionStatus[]) : []),
  ];
  const effectiveStatus: CompetitionStatus =
    allowedStatuses.includes(form.status) ? form.status : (allowedStatuses[0] ?? "draft");

  function updateParticipants(nextParticipants: string[]) {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        participants: nextParticipants,
        results: syncResults(nextParticipants, current.results),
      };
    });
  }

  function addParticipant() {
    if (!form) {
      return;
    }

    const nextParticipant = participantInput.trim();
    if (!nextParticipant) {
      return;
    }

    const alreadyAdded = form.participants.some(
      (participant) => normalizeCompetitorName(participant) === normalizeCompetitorName(nextParticipant),
    );
    if (alreadyAdded) {
      setError("Participant already added.");
      return;
    }

    setError(null);
    updateParticipants([...form.participants, nextParticipant]);
    setParticipantInput("");
  }

  function updateFormResult(index: number, update: Partial<CompetitionFormResult>) {
    setForm((current) => {
      if (!current) {
        return current;
      }

      const nextResults = syncResults(current.participants, current.results);
      const currentResult = nextResults[index];
      if (!currentResult) {
        return current;
      }

      nextResults[index] = { ...currentResult, ...update };
      return { ...current, results: nextResults };
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!competitionId || !form) {
      return;
    }

    setError(null);

    if (!form.scheduledAt) {
      setError("Select competition date and time.");
      return;
    }

    if (effectiveStatus === "published" && participants.length < 3) {
      setError("A published competition must have at least three participants.");
      return;
    }

    if (effectiveStatus === "finalized" && !hasCompleteResults) {
      setError("Finalized competitions require complete results for every participant.");
      return;
    }

    const results = normalizedResults
      .filter((result) => result.placement && result.resultValue)
      .map((result) => ({
        displayName: result.displayName,
        placement: Number(result.placement),
        resultValue: Number(result.resultValue),
        tieBreakRank: result.tieBreakRank ? Number(result.tieBreakRank) : null,
        tieBreakNote: result.tieBreakNote.trim() || undefined,
      }));

    const payload: CompetitionInput = {
      tourId: form.tourId,
      title: form.title,
      description: form.description,
      location: form.location,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      organizerName: form.organizerName,
      scoresheetUrl: form.scoresheetUrl,
      status: effectiveStatus,
      participants: participants.map((participant) => ({
        displayName: participant,
      })),
      ...(results.length ? { results } : {}),
    };

    try {
      const response = await apiRequest<{ competition: CompetitionSummary }>(
        `/api/competitions/${competitionId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
        session.token,
      );
      setForm(toCompetitionForm(response.competition));
      onNotice("Competition updated.");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    }
  }

  return (
    <SectionCard
      title="Manage Competition"
      subtitle="Add participants and results, then publish or finalize when ready."
    >
      <div className="inline-actions manage-header">
        <button type="button" className="secondary-button" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </button>
      </div>

      <form className="stack manage-form" onSubmit={handleSave}>
        <div className="grid-two">
          <label>
            Competition title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </label>
          <label>
            Organizer name
            <input
              value={form.organizerName}
              onChange={(event) => setForm({ ...form, organizerName: event.target.value })}
              required
            />
          </label>
        </div>

        <div className="grid-two">
          <label>
            Location
            <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required />
          </label>
          <label>
            Competition date
            <input
              type="date"
              value={localDatePart(form.scheduledAt)}
              onChange={(event) =>
                setForm({
                  ...form,
                  scheduledAt: mergeLocalDateTime(event.target.value, localTimePart(form.scheduledAt) || "12:00"),
                })
              }
              required
            />
          </label>
          <label>
            Competition time
            <input
              type="time"
              value={localTimePart(form.scheduledAt)}
              onChange={(event) =>
                setForm({
                  ...form,
                  scheduledAt: mergeLocalDateTime(localDatePart(form.scheduledAt), event.target.value),
                })
              }
              disabled={!localDatePart(form.scheduledAt)}
              required
            />
          </label>
        </div>

        <label>
          Description
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={4}
            required
          />
        </label>

        <div className="grid-two">
          <label>
            Scoresheet URL
            <input value={form.scoresheetUrl} onChange={(event) => setForm({ ...form, scoresheetUrl: event.target.value })} />
          </label>
          <label>
            Status
            {allowedStatuses.length === 1 ? (
              <span className="status-pill">{effectiveStatus}</span>
            ) : (
              <select value={effectiveStatus} onChange={(event) => setForm({ ...form, status: event.target.value as CompetitionStatus })}>
                {allowedStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        <div className="stack manage-section">
          <div className="list-item-heading">
            <strong>Participants</strong>
          </div>
          <datalist id={participantSuggestionListId}>
            {users.map((user) => (
              <option key={user.id} value={user.name} />
            ))}
          </datalist>
          <div className="inline-form">
            <input
              list={participantSuggestionListId}
              value={participantInput}
              onChange={(event) => setParticipantInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addParticipant();
                }
              }}
            />
            <button type="button" onClick={addParticipant} disabled={!participantInput.trim()}>
              Add participant
            </button>
          </div>
          <div className="stack">
            {form.participants.length ? (
              form.participants.map((participant, index) => (
                <div key={index} className="list-item-heading list-item">
                  <strong>{participant}</strong>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => updateParticipants(form.participants.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <small>No participants added yet.</small>
            )}
          </div>
          <small>Suggestions come from registered users. You can also type custom names.</small>
        </div>

        <div className="stack manage-section">
          <div className="list-item-heading">
            <strong>Results</strong>
            <small>Required before setting status to finalized.</small>
          </div>
          {syncResults(form.participants, form.results).map((result, index) => (
            <div key={index} className="result-row">
              <strong>{result.displayName || `Participant ${index + 1}`}</strong>
              <div className="grid-four">
                <label>
                  Place
                  <input
                    value={result.placement}
                    onChange={(event) => updateFormResult(index, { placement: event.target.value })}
                  />
                </label>
                <label>
                  Result
                  <input
                    value={result.resultValue}
                    onChange={(event) => updateFormResult(index, { resultValue: event.target.value })}
                  />
                </label>
                <label>
                  Tie-break rank
                  <input
                    value={result.tieBreakRank}
                    onChange={(event) => updateFormResult(index, { tieBreakRank: event.target.value })}
                  />
                </label>
                <label>
                  Note
                  <input
                    value={result.tieBreakNote}
                    onChange={(event) => updateFormResult(index, { tieBreakNote: event.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <button type="submit">Save competition</button>
      </form>
      {error ? <p className="status error">{error}</p> : null}
    </SectionCard>
  );
}

type DashboardTab = "account" | "competitions" | "tours" | "announcements" | "users";

function DashboardPage({
  session,
  onSessionChange,
  onNotice,
}: {
  session: SessionState;
  onSessionChange: (next: SessionState) => void;
  onNotice: (message: string) => void;
}) {
  const [tours, setTours] = useState<TourRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const isAdmin = session.user?.roles.includes("admin") ?? false;
  const isLoggedIn = Boolean(session.token);

  const requestedTab = searchParams.get("tab");
  const availableTabs: DashboardTab[] = [
    "account",
    ...(isLoggedIn ? (["competitions"] as DashboardTab[]) : []),
    ...(isAdmin ? (["tours", "announcements", "users"] as DashboardTab[]) : []),
  ];
  const preferredDefault: DashboardTab = isLoggedIn ? "competitions" : "account";
  const activeTab =
    requestedTab && availableTabs.includes(requestedTab as DashboardTab)
      ? (requestedTab as DashboardTab)
      : preferredDefault;

  useEffect(() => {
    if (!isLoggedIn) return;
    apiRequest<{ tours: TourRecord[] }>("/api/tours")
      .then((payload) => setTours(payload.tours))
      .catch((requestError) => setError(extractErrorMessage(requestError)));
  }, [isLoggedIn]);

  return (
    <div className="page-grid">
      {error ? <p className="status error">{error}</p> : null}

      {activeTab === "account" && (
        <AuthSection session={session} onSessionChange={onSessionChange} onNotice={onNotice} />
      )}
      {activeTab === "competitions" && isLoggedIn && (
        <CompetitionEditorSection session={session} tours={tours} token={session.token!} onNotice={onNotice} />
      )}
      {activeTab === "tours" && isAdmin && (
        <TourAdminSection
          token={session.token!}
          isAdmin={isAdmin}
          tours={tours}
          onToursChange={setTours}
          onNotice={onNotice}
        />
      )}
      {activeTab === "announcements" && isAdmin && (
        <AnnouncementAdminSection token={session.token!} isAdmin={isAdmin} tours={tours} onNotice={onNotice} />
      )}
      {activeTab === "users" && isAdmin && (
        <UserAdminSection token={session.token!} isAdmin={isAdmin} onNotice={onNotice} />
      )}
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionState>(() => loadSession());
  const [notice, setNotice] = useState<string | null>(null);
  const [heroTitle, setHeroTitle] = useState("Frolf Tour Manager");

  useEffect(() => {
    if (!isFirebaseClientConfigured()) {
      setSession(emptySession);
    }
  }, []);

  useEffect(() => {
    const webAuth = getWebAuth();
    if (!webAuth) {
      return;
    }

    let isActive = true;

    const unsubscribe = onIdTokenChanged(webAuth, async (firebaseUser) => {
      if (!isActive) {
        return;
      }

      if (!firebaseUser) {
        setSession(emptySession);
        return;
      }

      try {
        const token = await getIdToken(firebaseUser, true);
        const payload = await apiRequest<{ user: PublicUser }>("/api/auth/me", {}, token);
        if (!isActive) {
          return;
        }
        setSession({ token, user: payload.user });
      } catch {
        if (!isActive) {
          return;
        }
        setSession(emptySession);
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  useEffect(() => {
    let isActive = true;

    apiRequest<{ tour: TourRecord }>("/api/tours/current")
      .then((payload) => {
        if (!isActive) {
          return;
        }
        setHeroTitle(payload.tour.name);
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setHeroTitle("Frolf Tour Manager");
      });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="shell">
      <header className="hero">
        <figure className="hero-figure">
          <img
            className="hero-bg"
            src={clusterAlumniMark}
            alt=""
            width={1200}
            height={400}
            decoding="async"
          />
          <figcaption className="visually-hidden">
            Logo and visual identity © Cluster Alumni Ry. All rights reserved.
          </figcaption>
        </figure>
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-text">
            <h1>{heroTitle}</h1>
            <p>Cluster alumni frolf tour since 2025</p>
          </div>
        </div>
      </header>

      <nav className="app-nav">
        <Link to="/">Home</Link>
        <Link to="/tours">Current Tour</Link>
        <Link to="/dashboard?tab=competitions">Competitions</Link>
        {session.user?.roles.includes("admin") ? <Link to="/dashboard?tab=tours">Tour Admin</Link> : null}
        <Link to="/dashboard?tab=announcements">Announcements</Link>
        {session.user?.roles.includes("admin") ? <Link to="/dashboard?tab=users">Users</Link> : null}
        <Link to="/dashboard?tab=account" className="app-nav-account">
          {session.user ? session.user.name : "Login / Sign up"}
        </Link>
      </nav>

      {notice ? (
        <div className="snackbar success" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage session={session} onSessionChange={setSession} onNotice={setNotice} />} />
          <Route path="/dashboard/competitions/:competitionId/manage" element={<CompetitionManagePage session={session} onNotice={setNotice} />} />
          <Route path="/tours" element={<CurrentTourRedirectPage />} />
          <Route path="/tours/:tourId" element={<TourPage />} />
          <Route path="/competitions/:competitionId" element={<CompetitionPage />} />
        </Routes>
      </main>
    </div>
  );
}
