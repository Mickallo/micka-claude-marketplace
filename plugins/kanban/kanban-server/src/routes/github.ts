import { Hono } from "hono";
import { execSync } from "child_process";

const app = new Hono();

// --- Types ---

interface GhLabel {
  name: string;
  color: string;
}

interface GhCheck {
  name: string;
  status: string;
}

interface GhReview {
  author: { login: string };
  state: string;
}

interface GhReviewRequest {
  requestedReviewer: { login?: string; name?: string } | null;
}

interface GhPRNode {
  title: string;
  number: number;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
  repository: { nameWithOwner: string };
  labels: { nodes: GhLabel[] };
  comments: { totalCount: number };
  statusCheckRollup: {
    contexts: {
      nodes: Array<
        | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null }
        | { __typename: "StatusContext"; context: string; state: string }
      >;
    };
  } | null;
  latestReviews: { nodes: GhReview[] };
  reviewRequests: { nodes: GhReviewRequest[] };
}

interface GhSearchResult {
  data: {
    search: {
      nodes: GhPRNode[];
    };
  };
}

interface PR {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  labels: GhLabel[];
  additions: number;
  deletions: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  checks: GhCheck[];
  reviews: { author: string; state: string }[];
}

// --- Cache ---

interface CacheEntry {
  data: ReturnType<typeof buildResponse>;
  timestamp: number;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let cache: CacheEntry | null = null;

// --- GraphQL query ---

const PR_FIELDS = `
  title
  number
  url
  isDraft
  additions
  deletions
  createdAt
  updatedAt
  author { login }
  repository { nameWithOwner }
  labels(first: 20) { nodes { name color } }
  comments { totalCount }
  statusCheckRollup {
    contexts(first: 50) {
      nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      }
    }
  }
  latestReviews(first: 20) { nodes { author { login } state } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
`;

function buildQuery(qualifier: string): string {
  return `
    query {
      search(query: "is:pr is:open ${qualifier}", type: ISSUE, first: 50) {
        nodes {
          ... on PullRequest {
            ${PR_FIELDS}
          }
        }
      }
    }
  `;
}

// --- gh helper ---

function gh(query: string): GhSearchResult | null {
  try {
    const raw = execSync("gh api graphql --input -", {
      encoding: "utf-8",
      timeout: 30000,
      input: JSON.stringify({ query }),
    }).trim();
    return JSON.parse(raw) as GhSearchResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not logged") || msg.includes("401") || msg.includes("authentication")) {
      throw new Error("gh_not_authenticated");
    }
    return null;
  }
}

function getGhUser(): string {
  try {
    const out = execSync("gh api user --jq .login", {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

// --- Transform ---

function transformPR(node: GhPRNode): PR {
  const checks: GhCheck[] = (node.statusCheckRollup?.contexts?.nodes ?? []).map((ctx) => {
    if (ctx.__typename === "CheckRun") {
      return { name: ctx.name, status: ctx.conclusion ?? ctx.status };
    } else {
      return { name: ctx.context, status: ctx.state };
    }
  });

  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author.login,
    isDraft: node.isDraft,
    labels: node.labels.nodes,
    additions: node.additions,
    deletions: node.deletions,
    commentCount: node.comments.totalCount,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    checks,
    reviews: (() => {
      const reviewed = node.latestReviews.nodes.map((r) => ({
        author: r.author.login,
        state: r.state,
      }));
      const reviewedSet = new Set(reviewed.map((r) => r.author));
      const pending = (node.reviewRequests.nodes ?? [])
        .map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name)
        .filter((login): login is string => !!login && !reviewedSet.has(login))
        .map((login) => ({ author: login, state: "PENDING" }));
      return [...reviewed, ...pending];
    })(),
  };
}

// --- CI pass rate ---

function computeCiPassRate(prs: PR[]): number {
  const checks = prs.flatMap((pr) => pr.checks);
  if (checks.length === 0) return 1;
  const passed = checks.filter(
    (c) => c.status === "success" || c.status === "SUCCESS"
  ).length;
  return Math.round((passed / checks.length) * 100) / 100;
}

// --- Build response ---

function buildResponse(
  user: string,
  authored: PR[],
  review: PR[],
  assigned: PR[]
) {
  return {
    user,
    lastSync: new Date().toISOString(),
    review,
    assigned,
    authored,
    stats: {
      reviewCount: review.length,
      assignedCount: assigned.length,
      authoredCount: authored.length,
      ciPassRate: computeCiPassRate([...authored, ...review, ...assigned]),
    },
  };
}

// --- Route ---

app.get("/api/github", (c) => {
  const force = c.req.query("force") === "true";

  // Serve from cache if valid
  if (!force && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return c.json(cache.data);
  }

  // Fetch user
  let user: string;
  try {
    user = getGhUser();
  } catch {
    return c.json({ error: "gh CLI not authenticated" }, 401);
  }

  // Run all three queries
  let authoredResult: GhSearchResult | null = null;
  let reviewResult: GhSearchResult | null = null;
  let assignedResult: GhSearchResult | null = null;

  try {
    authoredResult = gh(buildQuery("author:@me"));
    reviewResult = gh(buildQuery("review-requested:@me"));
    assignedResult = gh(buildQuery("assignee:@me"));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "gh_not_authenticated") {
      return c.json({ error: "gh CLI not authenticated" }, 401);
    }
    return c.json({ error: "Failed to fetch GitHub data" }, 500);
  }

  // Transform nodes
  const authoredNodes = authoredResult?.data?.search?.nodes ?? [];
  const reviewNodes = reviewResult?.data?.search?.nodes ?? [];
  const assignedNodes = assignedResult?.data?.search?.nodes ?? [];

  const authoredPRs = authoredNodes.map(transformPR);

  // Deduplication: authored wins, then review, then assigned
  const seen = new Set<string>(authoredPRs.map((pr) => pr.url));

  const reviewPRs = reviewNodes
    .map(transformPR)
    .filter((pr) => {
      if (seen.has(pr.url)) return false;
      seen.add(pr.url);
      return true;
    });

  const assignedPRs = assignedNodes
    .map(transformPR)
    .filter((pr) => {
      if (seen.has(pr.url)) return false;
      seen.add(pr.url);
      return true;
    });

  const response = buildResponse(user, authoredPRs, reviewPRs, assignedPRs);

  // Update cache
  cache = { data: response, timestamp: Date.now() };

  return c.json(response);
});

export default app;
