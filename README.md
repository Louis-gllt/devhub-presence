# devhub-presence

Petit service qui garde le bot Discord DevHub connecté en permanence (point vert) et affiche dans son statut l'état de santé du hub :

- 🟢 en ligne : toutes les sources répondent ;
- 🟡 absent : vérifications en retard ;
- 🔴 ne pas déranger : au moins une source est en erreur.

Tout le reste (commandes, alertes, métriques) tourne en serverless sur Vercel. Ce service n'a besoin que de `DISCORD_TOKEN` et `DEVHUB_HEALTH_URL`.
