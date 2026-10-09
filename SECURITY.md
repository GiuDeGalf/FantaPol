# Sicurezza

Non pubblicare backup JSON o file presenti in `sync-data`: possono contenere rose, prezzi e token dell’asta.

La vista partecipanti è in sola lettura. Il token di scrittura viene generato nel browser del banditore e non compare nel link pubblico. Il link segreto della regia contiene invece il token dopo `#`: trattalo come una password, invialo soltanto al banditore e non inserirlo in screenshot o messaggi pubblici.

Apri la regia con HTTPS e usala da un solo dispositivo alla volta. Se due regie restano aperte, FantaPol impedisce a quella con uno stato meno recente di sovrascrivere il salvataggio online.

Per segnalare una vulnerabilità, usa una segnalazione privata GitHub Security Advisory invece di aprire un’issue pubblica.
