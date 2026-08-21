# FantaPol

FantaPol è una regia web locale per aste di fantacalcio. Il banditore controlla tutto dal computer; una vista pubblica opzionale permette ai partecipanti di seguire l’asta da telefono o tablet.

Il progetto non richiede database, account o servizi esterni. I dati dell’asta restano nel browser del banditore e possono essere esportati in JSON, Excel e CSV.

## Funzioni principali

- modalità Classic e Mantra;
- chiamate per ruolo casuali, casuali totali o alfabetiche;
- portieri ordinati per quotazione;
- gestione crediti, offerta massima e limiti della rosa;
- undo, pausa, ricerca manuale e registro completo;
- modifica successiva di squadra e prezzo;
- asta di riparazione da CSV o backup JSON;
- salvataggio automatico e ripristino;
- vista live in sola lettura per telefoni;
- esportazione CSV nel formato `squadra,id,costo`.

In Mantra, il gruppo d’asta viene ricavato dal ruolo preciso. In particolare `E;C` e `W;A` sono centrocampisti, mentre `E` senza `C` è difensore.

## Requisiti

- un browser moderno;
- Python 3.9 o successivo per l’avvio locale;
- un listone Excel compatibile, selezionato dall’utente.

Node.js è facoltativo e serve soltanto per eseguire i test. PHP 8.1+ è necessario soltanto se si pubblica la vista telefoni sul proprio dominio.

## Avvio

### Windows

Fai doppio clic su `start.bat`. Se Python non è presente, installalo da [python.org](https://www.python.org/downloads/) selezionando **Add Python to PATH**.

### macOS

Fai doppio clic su `start.command`. Al primo avvio macOS potrebbe richiedere **tasto destro → Apri**. In alternativa:

```bash
./start.sh
```

### Linux

```bash
chmod +x start.sh
./start.sh
```

Il programma apre `http://127.0.0.1:8766`. Il server si arresta automaticamente dopo la chiusura della scheda; può essere fermato anche con `Ctrl+C`.

Avvio manuale:

```bash
python3 tools/server.py
```

## Nuova asta

1. Apri **Nuova asta**.
2. Imposta tipo, chiamate, crediti, limiti e squadre.
3. Seleziona il listone `.xlsx`.
4. Avvia l’asta.

Il parser cerca il foglio `Tutti`. Il listone e le rose non vengono caricati su alcun server, salvo l’attivazione volontaria della vista live.

## Asta di riparazione

Carica:

- il CSV dell’asta precedente nel formato `squadra,id,costo`, il CSV completo di FantaPol oppure un backup JSON;
- il nuovo listone Excel.

Con un CSV vanno specificati modalità, crediti iniziali e limiti perché non sono contenuti nel file. Se il listone aggiornato non offre abbastanza calciatori per coprire tutti gli slot teorici, FantaPol mostra un avviso ma consente comunque di proseguire e terminare manualmente la riparazione.

## Salvataggi

Lo stato viene salvato automaticamente nel `localStorage` del browser. Questo non sostituisce un backup: durante l’asta scarica periodicamente il file JSON da **Impostazioni → Scarica backup**.

Non usare la navigazione privata e non cancellare i dati del browser durante un’asta.

## Vista live sui telefoni

La vista live è facoltativa. Il banditore continua a lavorare su `127.0.0.1`; il dominio riceve soltanto lo stato pubblico necessario ai partecipanti.

1. Carica sul tuo hosting il contenuto di [`deploy/fantapol`](deploy/fantapol).
2. Segui [le istruzioni di pubblicazione](deploy/README.md).
3. Inserisci gli URL del tuo dominio in `config.js`.
4. Riavvia FantaPol e usa **Impostazioni → Live telefoni**.

Esempio:

```js
window.FANTAPOL_CONFIG = Object.freeze({
  syncEndpoint: "https://example.com/fantapol/sync.php",
  viewerBaseUrl: "https://example.com/fantapol/viewer.html",
  syncIntervalMs: 500,
});
```

Senza configurazione FantaPol funziona normalmente in locale e la sincronizzazione resta disattivata.

## Test

```bash
npm test
```

oppure:

```bash
node tests/engine.test.js
```

Per verificare anche la sintassi:

```bash
npm run check
```

## Privacy e sicurezza

- Non committare listoni, CSV, backup JSON o contenuti di `sync-data`.
- Elimina `test.php` dal dominio dopo la verifica iniziale.
- Usa HTTPS per la vista live.
- Il link dei partecipanti è in sola lettura; il token di scrittura resta nel browser del banditore.

Consulta [SECURITY.md](SECURITY.md) per le segnalazioni.

## Licenza

FantaPol è distribuito con licenza [Apache 2.0](LICENSE). Le licenze dei componenti inclusi sono indicate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

FantaPol è un progetto indipendente e non è affiliato, sponsorizzato o approvato da piattaforme o marchi di fantacalcio.
