# garmin-mcp

Persönlicher Remote-MCP-Server für die **Garmin Connect Personal API**. Er stellt deine eigenen Garmin-Daten (Aktivitäten, Schlaf, HRV, Herzfrequenz, Body Battery, Stress, Tageswerte) als reine Lese-Tools für Claude bereit, z. B. als eigener Connector in claude.ai.

## Wie es funktioniert

1. Du erzeugst in Garmin Connect einen persönlichen API Key: <https://connect.garmin.com/app/settings/personalApiToken>.
2. Der Server tauscht den Key bei `https://personal.connectapi.garmin.com` gegen ein Zugriffstoken (JWT, gilt bis 24 h, kein Refresh) und holt sich bei Ablauf automatisch ein neues.
3. Claude ruft die Tools über `https://<dein-host>/mcp/<MCP_SECRET>` auf. Der Server fragt die Daten live bei Garmin ab. Es gibt keine Webhooks und keine Datenbank.

Quellen: [Garmin Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/), [offizieller Python-Client von Garmin](https://github.com/garmin/connect-personal-api-python) (die Endpunkte hier folgen diesem Client).

## Tools

| Tool | Inhalt |
|---|---|
| `garmin_daily_summaries` | Tageswerte (Schritte, Ruhepuls, Kalorien, Intensitätsminuten …), Zeitraum |
| `garmin_sleep` | Detaillierter Schlaf einer Nacht |
| `garmin_sleep_summaries` | Schlaf pro Nacht, Zeitraum |
| `garmin_hrv` / `garmin_hrv_summaries` | HRV einer Nacht / pro Tag im Zeitraum |
| `garmin_heart_rate` | Herzfrequenz eines Tages |
| `garmin_body_battery` | Body Battery, Zeitraum |
| `garmin_stress` | Stress pro Tag, Zeitraum |
| `garmin_spo2` | Pulsoximetrie eines Tages |
| `garmin_activities` | Aktivitäten suchen (Typ, Zeitraum, Paging) |
| `garmin_activity` / `garmin_activity_workouts` | Details einer Aktivität / zugehöriges Workout |
| `garmin_heart_rate_zones` | Hinterlegte HF-Zonen |
| `garmin_weight` | Gewicht und Körperzusammensetzung, Zeitraum |

Zeiträume sind auf 31 Tage pro Abruf begrenzt, damit die Antworten in Claudes Kontext passen. Alle Tools sind als `readOnly` markiert. Schreibzugriffe auf Garmin gibt es nicht.

## Fortschritts-App (Handy)

Unter `https://<dein-host>/app/` läuft eine kleine Web-App für den Trainingsfortschritt Richtung IRONMAN 70.3 Maastricht (5.9.2027):

- Countdown, aktuelle Planwoche und Phase
- Soll/Ist der Woche für Schwimmen, Rad und Laufen gegen den 41-Wochen-Plan (`src/plan.ts`)
- Stunden pro Woche (Ist gegen Plan), Trends für Lauf-km, Rad-Stunden, Schwimm-Meter, HRV und Ruhepuls
- die letzten Einheiten und ein Button **Aktualisieren**, der sofort frisch bei Garmin abruft

Die Daten werden live von Garmin geholt und 30 Minuten im Speicher gehalten. Es gibt keine Datenbank. Der Garmin-Key bleibt auf dem Server.
Die App ist mit `APP_PASSWORD` geschützt. Nach dem ersten Login bleibt das Gerät 180 Tage angemeldet (signiertes, HttpOnly-Cookie). Wer `APP_PASSWORD` ändert, meldet alle Geräte ab.

**Auf den Homescreen:** iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Android: in Chrome Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.

Die Stunden je Sportart im Plan sind Richtwerte: Schwimmen, langes Rad und langer Lauf stehen im Plan, die restlichen Wochenstunden sind auf die Kickr-Einheit (Mi) und den Lauf (Do) verteilt. Kraft zählt zur Gesamtzeit, nicht zu Rad oder Lauf. Gehen und Wandern zählen nicht mit.

## Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `GARMIN_PERSONAL_API_KEY` | ja | Dein persönlicher Garmin API Key. **Nur beim Hosting eintragen, nie committen oder in einen Chat kopieren.** |
| `MCP_SECRET` | ja | Mindestens 24 Zeichen Zufall (z. B. `openssl rand -hex 32`). Wird Teil der Connector-URL und schützt den Server. |
| `APP_PASSWORD` | für `/app` | Passwort der Fortschritts-App, mindestens 8 Zeichen. Ohne diese Variable ist `/app` abgeschaltet, der MCP-Server läuft trotzdem. |
| `PORT` | nein | Standard 3000 (Render setzt ihn selbst). |

## Hosting auf Render (empfohlen, kostenlos)

1. Auf <https://render.com> mit GitHub anmelden.
2. **New → Blueprint**, dieses Repo wählen. Render liest `render.yaml`, erzeugt `MCP_SECRET` automatisch und fragt nach `GARMIN_PERSONAL_API_KEY`. Dort den Key einfügen.
3. Nach dem Deploy: im Service unter **Environment** den Wert von `MCP_SECRET` ansehen und die URL notieren:
   `https://<service-name>.onrender.com/mcp/<MCP_SECRET>`
4. Test: `https://<service-name>.onrender.com/healthz` liefert `{"ok":true}`.

Hinweis: Der kostenlose Render-Plan legt den Dienst nach 15 Minuten ohne Anfrage schlafen. Der erste Aufruf danach dauert bis zu einer Minute. Wenn das stört, reicht der kleinste bezahlte Plan, oder du nutzt einen anderen Host. Dank `Dockerfile` läuft der Server auch auf Fly.io, Railway, Google Cloud Run oder einem eigenen Server.

## In claude.ai als Connector hinzufügen

1. claude.ai → **Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen** (Add custom connector).
2. Name: `Garmin`, URL: `https://<service-name>.onrender.com/mcp/<MCP_SECRET>`. OAuth-Felder leer lassen.
3. Hinzufügen. Danach ist der Connector in jedem Chat über das Tools-Menü aktivierbar.

Die URL enthält das Geheimnis: behandle sie wie ein Passwort. Falls sie bekannt wird, in Render `MCP_SECRET` neu generieren und den Connector mit der neuen URL neu anlegen.

## Key erneuern

Garmin-Keys laufen je nach Wahl nach 30, 90, 180 oder 365 Tagen ab (Garmin schickt etwa eine Woche vorher eine Mail). Neuen Key erzeugen, in Render `GARMIN_PERSONAL_API_KEY` ersetzen, fertig. Die Connector-URL bleibt gleich.

## Lokal entwickeln

```bash
npm install
npm test           # Unit- und End-to-End-Tests gegen einen simulierten Garmin-Server
GARMIN_PERSONAL_API_KEY=... MCP_SECRET=$(openssl rand -hex 32) npm run dev
```
