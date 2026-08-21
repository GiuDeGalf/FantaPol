# Pubblicazione della vista telefoni

Carica sul tuo hosting **il contenuto** della cartella `fantapol`, per esempio in `https://example.com/fantapol/`.

Requisiti:

- PHP 8.1 o successivo;
- HTTPS;
- permesso di scrittura PHP nella cartella `sync-data`.

Apri una volta `https://example.com/fantapol/test.php`. Se mostra `OK`, elimina immediatamente `test.php`.

Poi modifica il `config.js` della regia:

```js
window.FANTAPOL_CONFIG = Object.freeze({
  syncEndpoint: "https://example.com/fantapol/sync.php",
  viewerBaseUrl: "https://example.com/fantapol/viewer.html",
  syncIntervalMs: 500,
});
```

Se la regia non gira in locale ma su un altro sito, aggiungi quell’origine a `$extraAllowedOrigins` in `sync.php`.
