import {
  IncidentSchema,
  type Incident,
  type RegressionSignature,
  type ReleaseObservation,
} from "@releaselens/core";

type ActiveIncident = Incident & { status: "open" | "monitoring" };

const regressionVerdicts = new Set([
  "SUSPECTED_REGRESSION",
  "CONFIRMED_REGRESSION",
]);
const resolutionVerdicts = new Set([
  "NO_REGRESSION_DETECTED",
  "CHANGED",
  "DISTRIBUTION_DRIFT",
]);

function isRegression(observation: ReleaseObservation): boolean {
  return regressionVerdicts.has(observation.verdict.status);
}

function distinct<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function signaturesFor(observation: ReleaseObservation): RegressionSignature[] {
  const signatures: RegressionSignature[] = [];
  for (const evidence of observation.behavior) {
    for (const result of evidence.results.filter(
      (candidate) => candidate.status === "fail",
    )) {
      signatures.push({
        id: `behavior:${result.testId}`,
        kind: "behavior",
        summary: `Behavior check ${result.testId} failed: ${result.summary}`,
        evidenceRefs: [evidence.id],
      });
    }
  }
  for (const cluster of observation.community?.clusters.filter(
    (candidate) => candidate.strength === "strong",
  ) ?? []) {
    signatures.push({
      id: `community:${cluster.signature}`,
      kind: "community",
      summary: `Official GitHub issue cluster: ${cluster.signature}`,
      evidenceRefs: [observation.community!.id, ...cluster.issueIds],
    });
  }
  for (const issue of observation.community?.issues.filter(
    (candidate) => candidate.maintainerAcknowledged,
  ) ?? []) {
    signatures.push({
      id: `maintainer:${issue.signature ?? issue.id}`,
      kind: "maintainer",
      summary: `Maintainer acknowledgement for ${issue.title}`,
      evidenceRefs: [observation.community!.id, issue.id],
    });
  }
  if (signatures.length === 0) {
    const reason = observation.verdict.reasons[0]!;
    signatures.push({
      id: `interface:${reason.code}`,
      kind: "interface",
      summary: reason.message,
      evidenceRefs:
        reason.evidenceRefs.length > 0
          ? reason.evidenceRefs
          : [observation.observationId],
    });
  }
  const byId = new Map<string, RegressionSignature>();
  for (const signature of signatures) {
    const prior = byId.get(signature.id);
    byId.set(
      signature.id,
      prior
        ? {
            ...prior,
            evidenceRefs: distinct([
              ...prior.evidenceRefs,
              ...signature.evidenceRefs,
            ]).sort((left, right) => left.localeCompare(right)),
          }
        : signature,
    );
  }
  return Array.from(byId.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function evidenceRefsFor(signatures: RegressionSignature[]): string[] {
  return distinct(
    signatures.flatMap((signature) => signature.evidenceRefs),
  ).sort((left, right) => left.localeCompare(right));
}

function incidentPrefix(productId: string, openedAt: string): string {
  const date = openedAt.slice(0, 10);
  return `RL-${productId.replace(/[^A-Za-z0-9]/g, "-").toUpperCase()}-${date}`;
}

function newIncidentId(
  productId: string,
  openedAt: string,
  incidents: Incident[],
): string {
  const prefix = incidentPrefix(productId, openedAt);
  const existing = incidents.filter((incident) =>
    incident.id.startsWith(`${prefix}-`),
  ).length;
  return `${prefix}-${String(existing + 1).padStart(2, "0")}`;
}

function sharesSignature(
  incident: Incident,
  signatures: RegressionSignature[],
): boolean {
  const ids = new Set(
    incident.regressionSignatures.map((signature) => signature.id),
  );
  return signatures.some((signature) => ids.has(signature.id));
}

function hasObservation(incident: Incident, observationId: string): boolean {
  return incident.affectedObservations.includes(observationId);
}

function mergeRegression(
  incident: ActiveIncident,
  observation: ReleaseObservation,
  signatures: RegressionSignature[],
): ActiveIncident {
  const merged = new Map(
    incident.regressionSignatures.map((signature) => [signature.id, signature]),
  );
  for (const signature of signatures) {
    const prior = merged.get(signature.id);
    merged.set(
      signature.id,
      prior
        ? { ...prior, evidenceRefs: evidenceRefsFor([prior, signature]) }
        : signature,
    );
  }
  const affectedObservations = hasObservation(
    incident,
    observation.observationId,
  )
    ? incident.affectedObservations
    : [...incident.affectedObservations, observation.observationId];
  const events = hasObservation(incident, observation.observationId)
    ? incident.events
    : [
        ...incident.events,
        {
          at: observation.release.discoveredAt,
          type: "affected" as const,
          observationId: observation.observationId,
          summary: `Regression evidence remained present in ${observation.release.canonicalVersion}.`,
        },
      ];
  return IncidentSchema.parse({
    ...incident,
    status: "open",
    affectedObservations,
    regressionSignatures: Array.from(merged.values()).sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    evidenceRefs: evidenceRefsFor(Array.from(merged.values())),
    events,
  }) as ActiveIncident;
}

function behaviorClears(
  incident: Incident,
  observation: ReleaseObservation,
): boolean {
  const behaviorSignatures = incident.regressionSignatures.filter(
    (signature) => signature.kind === "behavior",
  );
  if (behaviorSignatures.length === 0) return true;
  const current = new Map(
    observation.behavior
      .flatMap((evidence) => evidence.results)
      .map((result) => [result.testId, result.status]),
  );
  return behaviorSignatures.every(
    (signature) =>
      current.get(signature.id.slice("behavior:".length)) === "pass",
  );
}

function communityClears(
  incident: Incident,
  observation: ReleaseObservation,
): boolean {
  const current = new Set(
    (observation.community?.clusters ?? []).map(
      (cluster) => `community:${cluster.signature}`,
    ),
  );
  return incident.regressionSignatures
    .filter((signature) => signature.kind === "community")
    .every((signature) => !current.has(signature.id));
}

function canResolve(
  incident: Incident,
  observation: ReleaseObservation,
): boolean {
  return (
    resolutionVerdicts.has(observation.verdict.status) &&
    observation.release.discoveredAt > incident.openedAt &&
    behaviorClears(incident, observation) &&
    communityClears(incident, observation)
  );
}

function resolveIncident(
  incident: ActiveIncident,
  observation: ReleaseObservation,
): Incident {
  return IncidentSchema.parse({
    ...incident,
    status: "resolved",
    resolvedAt: observation.release.discoveredAt,
    resolvedByVersion: observation.release.canonicalVersion,
    events: [
      ...incident.events,
      {
        at: observation.release.discoveredAt,
        type: "resolved",
        observationId: observation.observationId,
        summary: `Resolved by verified ${observation.release.canonicalVersion}.`,
      },
    ],
  });
}

function monitorIncident(
  incident: ActiveIncident,
  observation: ReleaseObservation,
): ActiveIncident {
  if (incident.status === "monitoring") return incident;
  return IncidentSchema.parse({
    ...incident,
    status: "monitoring",
    events: [
      ...incident.events,
      {
        at: observation.release.discoveredAt,
        type: "monitoring",
        observationId: observation.observationId,
        summary: `A later observation did not yet provide sufficient clearing evidence.`,
      },
    ],
  }) as ActiveIncident;
}

/** Reconciles append-only observations into durable incident records. */
export function reconcileIncidents(
  existing: Incident[],
  observations: ReleaseObservation[],
): Incident[] {
  let incidents = [...existing].map((incident) =>
    IncidentSchema.parse(incident),
  );
  const ordered = [...observations].sort((left, right) =>
    left.release.discoveredAt.localeCompare(right.release.discoveredAt),
  );
  for (const observation of ordered) {
    if (isRegression(observation)) {
      const signatures = signaturesFor(observation);
      const activeIndex = incidents.findIndex(
        (incident) =>
          incident.productId === observation.product.id &&
          incident.status !== "resolved" &&
          sharesSignature(incident, signatures),
      );
      if (activeIndex >= 0) {
        incidents[activeIndex] = mergeRegression(
          incidents[activeIndex] as ActiveIncident,
          observation,
          signatures,
        );
      } else {
        const openedAt = observation.release.discoveredAt;
        const incident: Incident = IncidentSchema.parse({
          schemaVersion: 1,
          id: newIncidentId(observation.product.id, openedAt, incidents),
          productId: observation.product.id,
          status: "open",
          openedAt,
          affectedObservations: [observation.observationId],
          firstAffectedVersion: observation.release.canonicalVersion,
          regressionSignatures: signatures,
          evidenceRefs: evidenceRefsFor(signatures),
          events: [
            {
              at: openedAt,
              type: "opened",
              observationId: observation.observationId,
              summary: `Opened from ${observation.verdict.status} evidence for ${observation.release.canonicalVersion}.`,
            },
          ],
        });
        incidents.push(incident);
      }
      continue;
    }

    incidents = incidents.map((incident) => {
      if (
        incident.productId !== observation.product.id ||
        incident.status === "resolved" ||
        observation.release.discoveredAt <= incident.openedAt
      ) {
        return incident;
      }
      const active = incident as ActiveIncident;
      return canResolve(active, observation)
        ? resolveIncident(active, observation)
        : monitorIncident(active, observation);
    });
  }
  return incidents.sort((left, right) => left.id.localeCompare(right.id));
}
