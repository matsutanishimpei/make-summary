export function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mobile-shell pairing-screen">
      <section className="mobile-card pairing-card"><h1>{title}</h1><p>{body}</p></section>
    </main>
  );
}
