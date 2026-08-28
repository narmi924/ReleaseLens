import Link from "next/link";

export default function NotFound(): React.ReactElement {
  return (
    <section className="shell page-intro">
      <p className="eyebrow">Not found</p>
      <h1>This observation is not published.</h1>
      <p>
        <Link className="inline-link" href="/">
          Return to current release state.
        </Link>
      </p>
    </section>
  );
}
