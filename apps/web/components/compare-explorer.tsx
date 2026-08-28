"use client";

import { useMemo, useState } from "react";
import type { ReleaseDiff, ReleaseObservation } from "@releaselens/core";
import { dateTime } from "../lib/format";
import { VerdictPill } from "./status-pill";

export type ComparisonEntry = {
  observation: ReleaseObservation;
  diff?: ReleaseDiff;
};
export type ComparisonProduct = {
  id: string;
  name: string;
  entries: ComparisonEntry[];
};

function entryById(product: ComparisonProduct, id: string): ComparisonEntry {
  return (
    product.entries.find((entry) => entry.observation.observationId === id) ??
    product.entries[0]!
  );
}

function summary(
  entry: ComparisonEntry,
  dimension: "artifact" | "interface" | "behavior" | "distribution",
): string {
  const observation = entry.observation;
  if (dimension === "artifact") {
    return observation.artifacts.length === 0
      ? "No verified artifact evidence recorded."
      : observation.artifacts
          .map(
            (artifact) =>
              `${artifact.status}: ${artifact.packageVersion ?? artifact.fileName}${artifact.architecture ? ` (${artifact.architecture})` : ""}`,
          )
          .join(" · ");
  }
  if (dimension === "interface") {
    return observation.interfaces.length === 0
      ? "No interface snapshot recorded."
      : observation.interfaces
          .map(
            (item) =>
              `${item.status}: ${item.cliName}, ${item.commands.length} commands`,
          )
          .join(" · ");
  }
  if (dimension === "behavior") {
    return observation.behavior.length === 0
      ? "No behavior checks recorded."
      : observation.behavior
          .flatMap((item) =>
            item.results.map((result) => `${result.testId}: ${result.status}`),
          )
          .join(" · ");
  }
  return observation.sources
    .map((source) => `${source.sourceId}: ${source.status}`)
    .join(" · ");
}

function directDiff(
  left: ComparisonEntry,
  right: ComparisonEntry,
): ReleaseDiff | undefined {
  if (left.diff?.comparedWith === right.observation.observationId)
    return left.diff;
  if (right.diff?.comparedWith === left.observation.observationId)
    return right.diff;
  return undefined;
}

export function CompareExplorer({
  products,
}: {
  products: ComparisonProduct[];
}): React.ReactElement {
  const initialProduct = products[0];
  const [productId, setProductId] = useState(initialProduct?.id ?? "");
  const [leftId, setLeftId] = useState(
    initialProduct?.entries[0]?.observation.observationId ?? "",
  );
  const [rightId, setRightId] = useState(
    initialProduct?.entries[1]?.observation.observationId ??
      initialProduct?.entries[0]?.observation.observationId ??
      "",
  );
  const product = useMemo(
    () =>
      products.find((candidate) => candidate.id === productId) ?? products[0],
    [productId, products],
  );
  if (!product || product.entries.length === 0)
    return (
      <p className="empty-copy">
        No comparable observations are currently published.
      </p>
    );
  const left = entryById(product, leftId);
  const right = entryById(product, rightId);
  const diff = directDiff(left, right);
  function chooseProduct(nextProductId: string): void {
    const next = products.find((candidate) => candidate.id === nextProductId);
    setProductId(nextProductId);
    setLeftId(next?.entries[0]?.observation.observationId ?? "");
    setRightId(
      next?.entries[1]?.observation.observationId ??
        next?.entries[0]?.observation.observationId ??
        "",
    );
  }
  return (
    <>
      <div className="compare-controls">
        <label>
          Product
          <select
            aria-label="Comparison product"
            value={product.id}
            onChange={(event) => chooseProduct(event.target.value)}
          >
            {products.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          First observation
          <select
            aria-label="First observation"
            value={left.observation.observationId}
            onChange={(event) => setLeftId(event.target.value)}
          >
            {product.entries.map((entry) => (
              <option
                value={entry.observation.observationId}
                key={entry.observation.observationId}
              >
                {entry.observation.release.canonicalVersion} ·{" "}
                {entry.observation.release.channel}
              </option>
            ))}
          </select>
        </label>
        <label>
          Second observation
          <select
            aria-label="Second observation"
            value={right.observation.observationId}
            onChange={(event) => setRightId(event.target.value)}
          >
            {product.entries.map((entry) => (
              <option
                value={entry.observation.observationId}
                key={entry.observation.observationId}
              >
                {entry.observation.release.canonicalVersion} ·{" "}
                {entry.observation.release.channel}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="compare-summary">
        <div className="compare-headings">
          {[left, right].map((entry) => (
            <section
              className="compare-version"
              key={entry.observation.observationId}
            >
              <p>
                {entry.observation.release.channel} ·{" "}
                {entry.observation.release.platform ?? "platform not recorded"}
              </p>
              <h2>{entry.observation.release.canonicalVersion}</h2>
              <VerdictPill verdict={entry.observation.verdict} />
              <p>
                Observed {dateTime(entry.observation.release.discoveredAt)} UTC
              </p>
            </section>
          ))}
        </div>
        {(["artifact", "interface", "behavior", "distribution"] as const).map(
          (dimension) => (
            <section className="compare-dimension" key={dimension}>
              <h3>{dimension.charAt(0).toUpperCase() + dimension.slice(1)}</h3>
              <p>{summary(left, dimension)}</p>
              <p>{summary(right, dimension)}</p>
            </section>
          ),
        )}
        <section className="compare-dimension">
          <h3>Verdict reasons</h3>
          <p>
            {left.observation.verdict.reasons
              .map((reason) => reason.message)
              .join(" ")}
          </p>
          <p>
            {right.observation.verdict.reasons
              .map((reason) => reason.message)
              .join(" ")}
          </p>
        </section>
        <section className="compare-change-list">
          <p className="eyebrow">Direct delta</p>
          <h2>
            {diff
              ? `${diff.materialChanges.length} material change${diff.materialChanges.length === 1 ? "" : "s"} persisted`
              : "No direct persisted delta"}
          </h2>
          {diff ? (
            diff.materialChanges.length > 0 ? (
              <ul>
                {diff.materialChanges.map((change) => (
                  <li key={`${change.type}:${change.summary}`}>
                    {change.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No material change was detected by the deterministic comparison.
              </p>
            )
          ) : (
            <p>
              These observations are not adjacent in a persisted comparison. The
              side-by-side evidence above remains available without inventing a
              delta.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
