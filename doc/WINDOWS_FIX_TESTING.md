# Windows-Fixer lokal testen

Mit `tools\test-windows-fix.bat` kann der Windows-Fixer aus diesem Repository gegen eine vorhandene
ioBroker-Testinstallation ausgeführt werden, ohne `@iobroker/fix` zu veröffentlichen oder die
`package.json` des Repositorys umzubenennen.

> Der vollständige Test stoppt ioBroker, wartet die JSONL-Datenbanken, verändert npm-Dateien und
> erstellt den Windows-Dienst neu. Er sollte zunächst nur mit einer entbehrlichen Testinstallation
> oder in einer VM ausgeführt werden.

## Voraussetzungen

- Windows mit Git, Node.js und npm
- eine vorhandene ioBroker-Testinstallation
- Internetzugriff für npm, `jsonltool` und gegebenenfalls `winget`
- eine als Administrator gestartete Eingabeaufforderung

## Repository vorbereiten

Das Repository einmalig lokal klonen und dabei direkt den Fixer-Branch auswählen:

```bat
git clone --branch feat/windows-fixer https://github.com/Gaspode69/ioBroker.git
cd ioBroker
```

Ist das Repository bereits lokal vorhanden, stattdessen den Branch aktualisieren:

```bat
git fetch origin
git switch feat/windows-fixer
git pull --ff-only
```

## Test starten

Anschließend im Verzeichnis des lokal geklonten Repositorys ausführen:

```bat
tools\test-windows-fix.bat "C:\Pfad\zur\ioBroker-Testinstallation"
```

Die Sicherheitsabfrage mit `Y` bestätigen. Das Skript führt anschließend automatisch aus:

1. Unit-Tests des Repositorys
2. Erzeugung eines isolierten lokalen npm-Pakets mit dem Namen `@iobroker/fix`
3. Aufzeichnung von npm-Paketen, ioBroker-Status, Instanzen und Windows-Dienst vor dem Fix
4. vollständigen lokalen Windows-Fix
5. erneute Aufzeichnung und Vergleich des Zustands nach dem Fix

Das Repository selbst wird dabei nicht verändert. Insbesondere wird `npm run make-fix` nicht im
Arbeitsverzeichnis ausgeführt.

## Ergebnisse kontrollieren

Das Skript zeigt am Anfang sein Ergebnisverzeichnis an. Es liegt unter:

```text
%TEMP%\iobroker-windows-fix-<Zeitstempel>
```

Wichtige Dateien:

- `windows-fix.log`: vollständige Ausgabe des Fixers
- `npm-difference.txt`: Unterschiede der direkt installierten npm-Pakete
- `before\` und `after\`: `package.json`, Lockfile, `.npmrc`, `.env`, Dienst-, Instanz- und Statusausgaben

Nach einem erfolgreichen Lauf zusätzlich prüfen:

```bat
cd /d C:\Pfad\zur\ioBroker-Testinstallation
iob status
iob list instances
iob restart
```

Danach die Admin-Oberfläche und einige Adapter testen. Abschließend Windows neu starten und prüfen,
ob der ioBroker-Dienst automatisch startet.

## Abbruch und Fehler

Das Skript beendet sich vor Änderungen, wenn es nicht als Administrator läuft oder das Ziel nicht wie
eine ioBroker-Installation aussieht. Scheitert der Fix nach dem Stoppen des Dienstes, kann der Dienst
gestoppt bleiben. Für die Analyse werden dann insbesondere `windows-fix.log` sowie die Verzeichnisse
`before\` und `after\` benötigt.
