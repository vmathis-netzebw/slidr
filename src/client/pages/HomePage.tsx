export function HomePage(): JSX.Element {
  return (
    <main className="home">
      <h1>Live-Umfrage</h1>
      <p>Starte eine Umfrage und lasse dein Publikum per QR-Code abstimmen.</p>
      <a className="button button--primary" href="/presenter">
        Zur Präsentationsansicht
      </a>
    </main>
  );
}
