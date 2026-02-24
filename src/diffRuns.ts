import { DiffReport, RunReport } from "./types.js";

function statusRank(status: "pass" | "fail" | "error"): number {
  if (status === "pass") {
    return 2;
  }
  if (status === "fail") {
    return 1;
  }
  return 0;
}

export function diffRuns(baseline: RunReport, candidate: RunReport): DiffReport {
  const baselineMap = new Map(baseline.cases.map((item) => [item.hashedCaseId, item]));
  const candidateMap = new Map(candidate.cases.map((item) => [item.hashedCaseId, item]));
  const ids = new Set([...baselineMap.keys(), ...candidateMap.keys()]);

  const regressions: DiffReport["regressions"] = [];
  const improvements: DiffReport["improvements"] = [];
  let unchanged = 0;

  for (const id of ids) {
    const left = baselineMap.get(id);
    const right = candidateMap.get(id);
    if (!left || !right) {
      continue;
    }
    if (left.status === right.status) {
      unchanged += 1;
      continue;
    }

    if (statusRank(left.status) > statusRank(right.status)) {
      regressions.push({
        hashedCaseId: id,
        baselineStatus: left.status,
        candidateStatus: right.status,
      });
    } else {
      improvements.push({
        hashedCaseId: id,
        baselineStatus: left.status,
        candidateStatus: right.status,
      });
    }
  }

  return {
    baselineSuiteId: baseline.suiteId,
    candidateSuiteId: candidate.suiteId,
    comparedAt: new Date().toISOString(),
    totalCompared: ids.size,
    regressions,
    improvements,
    unchanged,
  };
}
