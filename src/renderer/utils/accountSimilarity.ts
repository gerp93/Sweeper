import { Account } from '../../shared/types/account';

export interface SimilarityGroup {
  accounts: Account[];
  maxScore: number;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function tokenJaccard(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const jaccard = tokenJaccard(na, nb);
  const lev = levenshteinRatio(na, nb);

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Guard against short/generic words (e.g. "Check", "Chase") spuriously matching
  // every longer name that happens to contain them.
  const contains = longer.includes(shorter) && shorter.length >= 6 && shorter.length / longer.length >= 0.4;

  let score = Math.max(jaccard, lev * 0.95);
  if (contains) score = Math.max(score, 0.85);
  return score;
}

/**
 * Complete-linkage clustering: an account only joins a group if it's similar
 * (>= threshold) to every existing member, not just one. Plain transitive
 * (union-find) grouping lets a single bridge account (e.g. two names that both
 * merely contain "Check") chain otherwise-unrelated accounts into one giant
 * false-positive cluster; complete-linkage avoids that.
 */
export function findSimilarGroups(accounts: Account[], threshold = 0.6): SimilarityGroup[] {
  const n = accounts.length;
  const scores: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs: Array<{ i: number; j: number; score: number }> = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = nameSimilarity(accounts[i].friendlyName, accounts[j].friendlyName);
      scores[i][j] = score;
      scores[j][i] = score;
      if (score >= threshold) pairs.push({ i, j, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const clusterOf = new Map<number, number>(); // account index -> cluster id
  const clusters = new Map<number, { members: Set<number>; maxScore: number }>();
  let nextClusterId = 0;

  function fitsCluster(idx: number, clusterId: number): boolean {
    const cluster = clusters.get(clusterId)!;
    for (const m of cluster.members) {
      if (scores[idx][m] < threshold) return false;
    }
    return true;
  }

  for (const { i, j, score } of pairs) {
    const ci = clusterOf.get(i);
    const cj = clusterOf.get(j);

    if (ci === undefined && cj === undefined) {
      const id = nextClusterId++;
      clusters.set(id, { members: new Set([i, j]), maxScore: score });
      clusterOf.set(i, id);
      clusterOf.set(j, id);
    } else if (ci !== undefined && cj === undefined) {
      if (fitsCluster(j, ci)) {
        clusters.get(ci)!.members.add(j);
        clusters.get(ci)!.maxScore = Math.max(clusters.get(ci)!.maxScore, score);
        clusterOf.set(j, ci);
      }
    } else if (cj !== undefined && ci === undefined) {
      if (fitsCluster(i, cj)) {
        clusters.get(cj)!.members.add(i);
        clusters.get(cj)!.maxScore = Math.max(clusters.get(cj)!.maxScore, score);
        clusterOf.set(i, cj);
      }
    }
    // if both already in (possibly different) clusters, leave as-is —
    // merging two established clusters risks the same chaining problem.
  }

  const groups: SimilarityGroup[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.members.size > 1) {
      groups.push({
        accounts: Array.from(cluster.members).map((idx) => accounts[idx]),
        maxScore: cluster.maxScore,
      });
    }
  }

  groups.sort((a, b) => b.maxScore - a.maxScore);
  return groups;
}
