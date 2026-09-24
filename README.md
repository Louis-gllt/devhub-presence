# devhub-presence

Petit service qui garde le bot Discord DevHub connecté en permanence (point vert) et affiche dans son statut l'état de santé du hub :

- 🟢 en ligne : toutes les sources répondent ;
- 🟡 absent : vérifications en retard ;
- 🔴 ne pas déranger : au moins une source est en erreur.

Il relaie aussi en temps réel vers `/api/events` du hub : arrivées et départs de membres (le hub applique aussitôt les accès prévus par l'invitation utilisée), nouvelles entrées du journal d'audit Discord, messages envoyés ou modifiés et réactions des membres (sans leur contenu), pour que tout apparaisse dans le salon journal.

Tout le reste (commandes, alertes, métriques) tourne en serverless sur Vercel. Variables : `DISCORD_TOKEN`, `DEVHUB_HEALTH_URL`, `DEVHUB_EVENTS_URL`, `CRON_SECRET`.
