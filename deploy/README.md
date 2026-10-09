# Pubblicazione della regia online

Carica sul tuo hosting **il contenuto** della cartella `fantapol`, per esempio in `https://example.com/fantapol/`.

Requisiti:

- PHP 8.1 o successivo;
- HTTPS;
- permesso di scrittura PHP nella cartella `sync-data`.

Apri una volta `https://example.com/fantapol/test.php`. Se mostra `OK`, elimina immediatamente `test.php`.

Apri quindi `https://example.com/fantapol/`. Da questa pagina si può creare una nuova asta oppure avviare una riparazione caricando CSV/JSON e listone Excel. Dopo l’avvio, l’indirizzo diventa automaticamente il **link segreto della regia**: salvalo e invialo soltanto al banditore.

In **Impostazioni → Live telefoni** sono disponibili:

- il link pubblico `viewer.html`, in sola lettura;
- il link segreto `index.html`, che permette di controllare e riprendere l’asta da qualsiasi dispositivo.

Lo stato completo è salvato in `sync-data`, protetta dal file `.htaccess`. Non rimuovere quella protezione e usa sempre HTTPS.

Se vuoi continuare a usare la regia locale e pubblicare soltanto gli aggiornamenti, modifica il `config.js` locale:

```js
window.FANTAPOL_CONFIG = Object.freeze({
  syncEndpoint: "https://example.com/fantapol/sync.php",
  viewerBaseUrl: "https://example.com/fantapol/viewer.html",
  syncIntervalMs: 500,
});
```

Se la regia non gira in locale ma su un altro sito, aggiungi quell’origine a `$extraAllowedOrigins` in `sync.php`.
