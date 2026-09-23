# devhub-presence

Petit service qui garde le bot Discord DevHub connecté en permanence (point vert) et affiche dans son statut l'état de santé du hub :

- 🟢 en ligne : toutes les sources répondent ;
- 🟡 absent : vérifications en retard ;
- 🔴 ne pas déranger : au moins une source est en erreur.

Il relaie aussi en temps réel les arrivées et départs de membres vers `/api/events` du hub, qui applique aussitôt les accès prévus par l'invitation utilisée.

Tout le reste (commandes, alertes, métriques) tourne en serverless sur Vercel. Variables : `DISCORD_TOKEN`, `DEVHUB_HEALTH_URL`, `DEVHUB_EVENTS_URL`, `CRON_SECRET`.
