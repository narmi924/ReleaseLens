import {
  CompareExplorer,
  type ComparisonProduct,
} from "../../components/compare-explorer";
import { PageIntro } from "../../components/page-intro";
import { getAllProducts, getDiff, getObservation } from "../../lib/data";

export default function ComparePage(): React.ReactElement {
  const products: ComparisonProduct[] = getAllProducts().map((product) => ({
    id: product.product.id,
    name: product.product.name,
    entries: product.releases.flatMap((release) => {
      const observation = getObservation(
        product.product.id,
        release.observationId,
      );
      if (!observation) return [];
      const diff = getDiff(product.product.id, release.diffId);
      return diff ? [{ observation, diff }] : [{ observation }];
    }),
  }));
  return (
    <>
      <PageIntro
        eyebrow="Compare observations"
        title="Choose evidence, not a score."
      >
        <p>
          Compare two real observations within the same tool. ReleaseLens shows
          the recorded facts side by side and only calls a delta direct when it
          was persistently calculated.
        </p>
      </PageIntro>
      <section className="shell content-section">
        <CompareExplorer products={products} />
      </section>
    </>
  );
}
