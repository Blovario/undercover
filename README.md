# Undercover mobile

Jeu multijoueur responsive, 3-20 joueurs, 100 paires en français, rôle Undercover configurable, Mr White optionnel, salons privés à code, vote simultané, départages sans élimination, devinette finale Mr White, revanche et reconnexion.

## Démarrage

Node.js 20+ : `npm install && npm start` puis visiter `http://localhost:3000`.

## Mettre en ligne

Il faut un hébergement Node.js avec WebSocket (par exemple Render ou Railway). Déployez le dépôt, commande de build : `npm install`, commande de démarrage : `npm start`. Aucun compte de base de données ni variable d'environnement obligatoires.

Le serveur conserve les salons **en mémoire** : ils disparaissent au redémarrage et un seul processus doit recevoir les connexions d'un salon. Éviter l'hébergement purement statique (GitHub Pages, Netlify statique ou Vercel statique) : il ne peut pas exécuter ce serveur.

## Règles

Les civils reçoivent un même mot ; les Undercover un mot proche ; Mr White ne reçoit rien. Chacun donne un indice, puis chacun vote. Le plus de voix est éliminé, une égalité ne tue personne. Si Mr White est éliminé, il peut deviner le mot des civils pour gagner. Les civils gagnent après l'élimination de tous les rôles spéciaux, les Undercover gagnent lorsqu'il n'y a plus de civils ou que leur nombre atteint celui des civils en l'absence de Mr White.

## Notes

Jeu convivial sans comptes ni anti-triche renforcée. Le code secret sert d'invitation, pas d'authentification cryptographique. Les joueurs déconnectés restent dans les parties en cours pour permettre la reconnexion ; leur vote est alors attendu. La persistance en base, le transfert de rôle d'hôte et la gestion des absences peuvent être ajoutés dans une V2.
