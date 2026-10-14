# Live-Umfrage

Kleine Web-App für Live-Publikumsumfragen bei Vorträgen.

Der Vortragende öffnet die Präsentationsansicht und zeigt einen QR-Code. Die Zuhörer scannen ihn,
bewegen auf dem Smartphone einen großen Slider zwischen zwei Polen (z.B. **Entwickeln** ←→
**Customizen**) und senden genau einen Wert ab. Auf dem Beamer entsteht in Echtzeit eine
Verteilungskurve.

- React + TypeScript (strict), Vite
- Node.js Backend ohne Framework, WebSocket via `ws`
- Keine Datenbank – der Zustand liegt im RAM
- Eine einzige Docker-Anwendung, direkt in Coolify deploybar
- Keine externen SaaS-Dienste, QR-Code wird lokal erzeugt

## 1. Lokale Installation

Voraussetzung: Node.js 20 oder neuer.

```bash
git clone <repo-url>
cd live-poll
npm install
npm run dev
```

`npm run dev` startet zwei Prozesse:

| Adresse                 | Zweck                                              |
| ----------------------- | -------------------------------------------------- |
| `http://localhost:5173` | Vite-Dev-Server mit Hot Reload – **hier öffnen**    |
| `http://localhost:3000` | Node-Backend (WebSocket + API)                      |

Der Dev-Server leitet `/ws`, `/api` und `/healthz` automatisch an das Backend weiter.

Produktionsnah lokal testen:

```bash
npm run build
npm start          # http://localhost:3000
```

Zum Testen mit dem eigenen Smartphone im gleichen WLAN:

```bash
npm run build
PUBLIC_URL=http://192.168.1.42:3000 PORT=3000 npm start
```

## 2. npm Scripts

| Script                 | Beschreibung                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run dev`          | Backend (tsx watch) und Vite-Dev-Server parallel                     |
| `npm run dev:server`   | Nur das Backend mit Auto-Reload                                      |
| `npm run dev:client`   | Nur den Vite-Dev-Server                                              |
| `npm run build`        | Client nach `dist/client`, Server nach `dist/node`                   |
| `npm run build:client` | Nur den Client bauen                                                 |
| `npm run build:server` | Nur den Server kompilieren                                           |
| `npm start`            | Gebauten Server starten (`dist/node/server/index.js`)                |
| `npm run typecheck`    | TypeScript-Prüfung für Client und Server ohne Emit                   |
| `npm test`             | Vitest einmalig ausführen                                            |
| `npm run test:watch`   | Vitest im Watch-Modus                                                |

## 3. Docker Build

```bash
docker build -t live-poll .
docker run --rm -p 3000:3000 -e PORT=3000 live-poll
```

Oder mit Compose für die lokale Entwicklung:

```bash
mkdir -p data
docker compose up --build
```

Die Feedback-Datenbank liegt per Bind-Mount in `./data/feedback.sqlite` auf dem Host und bleibt
bei Rebuilds und auch bei `docker compose down -v` erhalten. Der Container läuft mit
`UID`/`GID` des Hosts (Standard 1000), damit er in `./data` schreiben darf.

Das Image ist ein Multi-Stage-Build: Der Build-Stage kompiliert Client und Server, der Runtime-Stage
enthält nur Produktionsabhängigkeiten und läuft als unprivilegierter Benutzer `node`. Ein
Healthcheck fragt `/healthz` ab.

## 4. Deployment in Coolify

1. Repository zu GitHub/GitLab pushen.
2. In Coolify **New Resource → Application → Public/Private Repository** wählen.
3. Build Pack: **Dockerfile** (Coolify erkennt das `Dockerfile` im Repo-Root automatisch).
4. **Port** auf `3000` setzen. Coolify injiziert `PORT`; der Server liest ihn aus und lauscht immer
   auf `0.0.0.0`.
5. Domain eintragen, z.B. `https://umfrage.example.de`. Coolify beantragt automatisch ein
   Let's-Encrypt-Zertifikat.
6. Optional die Environment-Variable `PUBLIC_URL=https://umfrage.example.de` setzen (siehe unten).
7. **Deploy** klicken.

Ein Healthcheck-Endpunkt steht unter `/healthz` bereit und liefert
`{"ok":true,"sessions":n,"connections":n}`.

Wichtig: Da der Zustand im RAM liegt, beendet jedes Redeploy und jeder Neustart alle laufenden
Umfragen. Nicht während eines Vortrags deployen. Aus dem gleichen Grund darf die Anwendung **nicht**
auf mehrere Instanzen skaliert werden – eine Instanz pro Deployment.

## 5. Environment Variables

| Variable          | Default   | Beschreibung                                                                       |
| ----------------- | --------- | ---------------------------------------------------------------------------------- |
| `PORT`            | `3000`    | Port, auf dem der Server lauscht. Wird von Coolify gesetzt.                          |
| `HOST`            | `0.0.0.0` | Interface-Bindung. Im Container immer `0.0.0.0` lassen.                              |
| `PUBLIC_URL`      | –         | Öffentliche Basis-URL für QR-Code und Teilnehmerlink. Wenn leer: aktuelle Browser-URL. |
| `TRUST_PROXY`     | `true`    | `X-Forwarded-For` auswerten. Hinter Traefik/Coolify auf `true` lassen.               |
| `MAX_CONNECTIONS` | `5000`    | Obergrenze gleichzeitiger WebSocket-Verbindungen.                                    |
| `DATA_DIR`        | `./data`  | Ablage für Feedback-Bögen. Im Image `/app/data` – als Volume persistieren.          |

Vorlage: [.env.example](.env.example). Es werden keine Secrets benötigt.

## 6. Verwendung beim Vortrag

1. `https://umfrage.example.de/presenter` auf dem Präsentationsrechner öffnen.
2. Frage eintragen, z.B. *"Entwickeln oder Customizen?"*.
3. Die beiden Slider-Pole festlegen: links = Wert 0, rechts = Wert 100.
4. **Neue Umfrage starten** klicken. Es entsteht eine Session mit zufälliger ID.
5. Den Bildschirm auf den Beamer legen. Der QR-Code wird groß angezeigt, darunter die URL als Text
   und der Session-Code zum Abtippen.
6. Das Publikum scannt und stimmt ab. Antwortzahl, Kurve, Durchschnitt und Median aktualisieren sich
   ohne Reload.

Steuerung während des Vortrags:

| Button                                    | Wirkung                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| **Ergebnisse ausblenden / anzeigen**      | Blendet Kurve und Kennzahlen aus – nützlich, um vorher raten zu lassen. |
| **Antworten löschen**                     | Leert die Antworten. QR-Code, Frage und Pole bleiben gültig.            |
| **Umfrage zurücksetzen**                  | Antworten weg, Frage und Pole auf Standard. Session-ID bleibt gleich.   |
| **Neue Umfrage**                          | Zurück zur Eingabe. Erzeugt beim Start eine neue Session-ID.            |

Darstellung der Verteilung:

- **0 Antworten:** leere Darstellung mit Hinweis.
- **1–4 Antworten:** Glockenkurve mit Peak auf dem gewählten Wert plus Marker für jeden Einzelwert
  und dem Hinweis, dass die Datenbasis zu klein ist. Es wird bewusst kein Histogramm gezeigt, das
  eine Verteilung suggeriert.
- **Ab 5 Antworten:** Histogramm plus geglättete Dichtekurve (Kerndichteschätzung). Die gestrichelte
  Linie markiert den Durchschnitt.

## 6b. Asynchrones Feedback

Neben der Live-Umfrage gibt es Feedback-Bögen mit mehreren Fragen, die unabhängig von einem
geöffneten Presenter-Fenster beantwortet werden können.

1. `/feedback/new` öffnen, Titel und Fragen anlegen, Passwort vergeben, veröffentlichen.
2. Den Link `/f/<ID>` (oder QR-Code) verteilen.
3. Ergebnisse unter `/f/<ID>/results` mit dem Passwort ansehen, als CSV/JSON exportieren, den Bogen
   schließen oder löschen.

Fragetypen: `text` (Freitext), `single` (Einfachauswahl), `multi` (Mehrfachauswahl), `scale`
(ganzzahlige Skala, z.B. 1–5) und `slider` (0–100 zwischen zwei Polen).

Fragen lassen sich als JSON oder YAML im- und exportieren. Fehlende `id`s werden vergeben, alle
anderen Felder außer `type` und `title` sind optional:

```yaml
version: 1
title: Workshop-Feedback
description: Danke, dass du dir zwei Minuten nimmst.
questions:
  - type: scale
    title: Wie zufrieden warst du insgesamt?
    required: true
    min: 1
    max: 5
    minLabel: gar nicht
    maxLabel: sehr
  - type: single
    title: Wie war das Tempo?
    options: [zu langsam, passend, zu schnell]
  - type: multi
    title: Was war hilfreich?
    options: [Theorie, Übungen, Diskussion]
  - type: slider
    title: Entwickeln oder Customizen?
    leftLabel: Entwickeln
    rightLabel: Customizen
  - type: text
    title: Was sollen wir verbessern?
    multiline: true
```

**Bearbeiten:** Auf der Ergebnisseite (nach Passwort-Eingabe) lassen sich die Fragen ändern. Jede
Änderung wird als neue Version gespeichert; Antworten merken sich ihre Version. Die Auswertung zeigt
standardmäßig die aktuellen Fragen mit allen Antworten, deren Frage in Typ und Optionen gleich
geblieben ist (reine Textkorrekturen sind unkritisch). Einzelne Versionen lassen sich separat
auswerten. Gelöschte Frage-IDs werden nie wiederverwendet.

**Eine Antwort pro Gerät:** Jedes Gerät bekommt pro Bogen eine zufällige, anonyme ID im
localStorage. Darüber gibt es genau eine Antwort, die später geändert werden kann („Antwort
ändern“), solange der Bogen offen ist. Ein anderer Browser oder ein privates Fenster zählt als neues
Gerät.

**Speicherung:** Feedback-Bögen liegen im Gegensatz zu Live-Umfragen in einer SQLite-Datenbank
(`DATA_DIR/feedback.sqlite`, eingebautes `node:sqlite`, WAL-Modus). Schreibzugriffe laufen in
Transaktionen, parallele Antworten sind dadurch sicher. In Coolify unter **Storages** ein Persistent
Volume auf `/app/data` anlegen, sonst gehen die Daten beim Redeploy verloren. Backup: die Datei im
laufenden Betrieb z.B. mit `sqlite3 feedback.sqlite ".backup backup.sqlite"` sichern. Das Passwort
wird nur als scrypt-Hash gespeichert und ist nicht wiederherstellbar; Passwort-Versuche sind pro
Client und Bogen gedrosselt.

## 7. Wie der QR-Code funktioniert

Der QR-Code wird vollständig im Browser des Vortragenden erzeugt (Bibliothek `qrcode`, kein externer
Dienst, kein Netzwerkaufruf).

Er kodiert die Teilnehmer-URL:

```
https://umfrage.example.de/vote/AB72KD93XY
```

Die Basis-URL wird so bestimmt:

1. Ist `PUBLIC_URL` gesetzt, liefert der Server sie über `GET /api/config`, und diese wird verwendet.
2. Ist sie nicht gesetzt, verwendet die Presenter-Seite ihre eigene Browser-URL
   (`window.location.origin`).

`PUBLIC_URL` ist also nur nötig, wenn die Presenter-Seite über eine andere Adresse aufgerufen wird
als die Teilnehmer sie erreichen sollen – etwa beim lokalen Testen über `localhost`, während die
Smartphones die LAN-IP brauchen.

Die Session-ID besteht aus 10 kryptografisch zufälligen Zeichen aus dem Alphabet
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. `0`, `1`, `I` und `O` fehlen bewusst, damit der Code vorlesbar
und verwechslungsfrei abtippbar bleibt.

## 8. HTTPS und WebSocket in Coolify

Coolify stellt Traefik als Reverse Proxy davor und terminiert TLS. Der Ablauf:

```
Smartphone ──HTTPS/WSS──► Traefik (TLS) ──HTTP/WS──► Container :$PORT
```

- Traefik leitet HTTP-Upgrade-Anfragen standardmäßig weiter; für WebSockets ist **keine zusätzliche
  Konfiguration und kein Label nötig**.
- Der Client wählt das Protokoll automatisch: Wird die Seite über `https://` geladen, verbindet er
  sich per `wss://`, sonst per `ws://`. Es gibt keine hardcodierten Adressen – der WebSocket geht
  immer an `/ws` auf demselben Host.
- Da nur ein Port genutzt wird, gibt es keine Mixed-Content-Probleme und keine CORS-Konfiguration.

Verbindungsstabilität:

- Der Server sendet alle 30 Sekunden einen Ping und beendet tote Verbindungen. Das hält die
  Verbindung durch Proxy-Timeouts hindurch offen.
- Der Client zeigt den Verbindungsstatus an und verbindet sich nach einem Abbruch automatisch mit
  wachsendem Backoff (0,5 s bis 15 s) neu.
- Nach jedem Reconnect fordert der Client den aktuellen Serverzustand neu an. Der Presenter lädt
  seine Session erneut, das Smartphone erfährt, ob es bereits abgestimmt hat.
- Der Serverzustand bleibt bei einem Verbindungsabbruch erhalten – nur ein Neustart des Containers
  löscht ihn.

## Datenschutz

Gespeichert wird ausschließlich `sessionId`, `value` und eine anonym im Browser erzeugte
`responseId` – alles nur im RAM. Keine Namen, keine E-Mail-Adressen, keine Accounts, kein Tracking,
keine Cookies. IP-Adressen werden nicht gespeichert; für das Rate-Limiting wird nur ein flüchtiger
HMAC-Hash mit einem beim Prozessstart zufällig erzeugten Salt gehalten. Sessions ohne Aktivität
werden nach 12 Stunden verworfen.

Doppelantworten werden über die `responseId` verhindert: Sie liegt im `localStorage` des Geräts und
wird pro Session nur einmal akzeptiert. Nach einem Reload erkennt die Seite dadurch, dass bereits
abgestimmt wurde.

## Sicherheit und Robustheit

- Alle eingehenden WebSocket-Nachrichten werden serverseitig gegen ein festes Schema validiert.
- Session-IDs müssen dem erwarteten Muster entsprechen; Werte werden nur als Ganzzahl 0–100 akzeptiert.
- Steuerbefehle wirken nur auf die Session, die die jeweilige Presenter-Verbindung selbst geöffnet
  hat. Eine Session kann keine andere beeinflussen.
- Rate-Limiting per Token-Bucket, getrennt für Nachrichten pro Verbindung und Abstimmungen pro Client.
- Maximal 10.000 Antworten pro Session, Nachrichten sind auf 4 KB begrenzt.
- Der Auslieferer statischer Dateien verhindert Path Traversal.

## Tests

```bash
npm test
```

Abgedeckt sind Session-Erstellung, Antworten speichern, Ablehnung doppelter `responseId`, ungültige
Werte, Session-Reset, Durchschnitt, Median, Verteilung und Dichtekurve, WebSocket-Broadcast an
mehrere Presenter, Session-Isolation, Rate-Limiting, Nachrichtenvalidierung und Path-Traversal-Schutz.

## Projektstruktur

```
src/
  shared/     Protokoll-Typen und Statistik – von Client und Server genutzt
  server/     Session-Store, WebSocket-Hub, Validierung, Rate-Limiter, HTTP-Server
  client/     React-App: Präsentationsansicht und Teilnehmeransicht
```
