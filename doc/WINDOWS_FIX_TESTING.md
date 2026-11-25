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
- die zur Testinstallation gehörende **ioBroker Command line** aus dem Windows-Startmenü

## Repository in einem separaten Ordner vorbereiten

Das Repository darf nicht in die ioBroker-Installation geklont werden. Dafür einen eigenen Arbeitsordner
anlegen und den Fork dort direkt mit dem Fixer-Branch klonen, zum Beispiel:

```bat
mkdir C:\ioBroker-Tests
cd /d C:\ioBroker-Tests
git clone --branch feat/windows-fixer https://github.com/Gaspode69/ioBroker.git ioBroker-windows-fixer
```

Dadurch liegen Quellcode und Testinstallation beispielsweise getrennt unter:

```text
C:\ioBroker-Tests\ioBroker-windows-fixer   Quellcode und Testskript
C:\ioBroker                                ioBroker-Testinstallation
```

Ist der separate Klon bereits vorhanden, stattdessen diesen Ordner öffnen und den Branch aktualisieren:

```bat
cd /d C:\ioBroker-Tests\ioBroker-windows-fixer
git fetch origin
git switch feat/windows-fixer
git pull --ff-only
```

## Test starten

Im Windows-Startmenü die **ioBroker Command line** der zu testenden ioBroker-Instanz öffnen. Bei mehreren
Installationen am Namen darauf achten, die richtige Verknüpfung auszuwählen. Diese Kommandozeile startet
mit Administratorrechten und befindet sich bereits im Root-Verzeichnis der zugehörigen ioBroker-Instanz.

Dort das Testskript über seinen vollständigen Pfad und ohne Parameter aufrufen:

```bat
C:\ioBroker-Tests\ioBroker-windows-fixer\tools\test-windows-fix.bat
```

Das Skript verwendet das aktuelle Verzeichnis der ioBroker Command line als Testinstallation. Es bricht
ab, wenn dort `iobroker-data` oder `node_modules\iobroker.js-controller` fehlen. Der Quellcode-Ordner darf
daher nicht das aktuelle Verzeichnis sein.

Die Sicherheitsabfrage mit `Y` bestätigen. Das Skript führt anschließend automatisch aus:

1. Unit-Tests des Repositorys
2. Erzeugung eines isolierten lokalen npm-Pakets mit dem Namen `@iobroker/fix`
3. Aufzeichnung von npm-Paketen, ioBroker-Status, Instanzen und Windows-Dienst vor dem Fix
4. vollständigen lokalen Windows-Fix
5. erneute Aufzeichnung und Vergleich des Zustands nach dem Fix

Der lokale Quellcode-Checkout bleibt dabei unverändert. Insbesondere wird `npm run make-fix` nicht in
diesem Arbeitsverzeichnis ausgeführt; das Testpaket entsteht ausschließlich unter `%TEMP%`. Die beim
Aufruf angegebene ioBroker-Testinstallation wird durch den Fixer dagegen absichtlich verändert: unter
anderem werden Dienst, Datenbanken, npm-Konfiguration, Paketdateien und `node_modules` bearbeitet.

## Ergebnisse kontrollieren

Das Skript zeigt am Anfang die verwendeten Ablageorte an. Das vollständige Fixer-Laufprotokoll liegt im
Logverzeichnis der getesteten ioBroker-Installation:

```text
C:\Pfad\zur\ioBroker-Testinstallation\log\windows-fix-test-<Zeitstempel>.log
```

Die Vorher-/Nachher-Kopien und der npm-Vergleich liegen getrennt davon unter:

```text
%TEMP%\iobroker-windows-fix-<Zeitstempel>
```

Wichtige Dateien:

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
gestoppt bleiben. Für die Analyse werden dann insbesondere das Laufprotokoll aus dem `log`-Verzeichnis
der Testinstallation sowie die Verzeichnisse `before\` und `after\` unter `%TEMP%` benötigt.
