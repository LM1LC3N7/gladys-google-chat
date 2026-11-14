# Google Chat pour Gladys Assistant

Intégration non officielle, sans lien avec Google. **Envoi seul** : Gladys
publie ses messages et alertes dans un espace Google Chat par un **webhook
entrant**. Rien n'est relu depuis Google Chat : on ne peut pas parler à Gladys
depuis là.

Cette intégration n'a jamais été testée avec un vrai espace Google Chat : elle
est écrite d'après la documentation publique de Google, et testée sur des
réponses simulées.

## Ce qu'il faut

- Un compte **Google Workspace Business ou Enterprise** avec accès à Google
  Chat. Un compte Google personnel gratuit (gmail.com) ne peut pas créer de
  webhook.
- L'administrateur Workspace doit autoriser les utilisateurs à ajouter des
  webhooks entrants (console d'administration → Applications → Google
  Workspace → Google Chat → Applications Chat).
- Un espace où ajouter le webhook (un webhook ne publie que dans son espace).

## Créer le webhook

1. Dans Google Chat, ouvrez l'espace, cliquez sur son nom → **Applications et
   intégrations** → **Webhooks** → **Ajouter un webhook**.
2. Donnez-lui un nom (par exemple « Gladys ») et un avatar si vous voulez,
   enregistrez.
3. Copiez l'URL. Elle ressemble à
   `https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…`.

**L'URL est un secret** : quiconque la détient peut publier dans l'espace.
Gladys la garde dans sa base, ne la réaffiche jamais et ne l'envoie qu'à Google
Chat ; l'intégration ne l'écrit jamais dans ses journaux, son statut ni son
dossier `/data` (les journaux nomment un espace par une courte empreinte, comme
`space #3fa91c`). Si elle fuit, supprimez le webhook dans l'espace et créez-en
un autre.

## Configuration

Écran **Configuration** (administrateur) :

- **Espace par défaut : URL du webhook** (facultatif) : l'espace de l'action de
  scène « Publier dans Google Chat » et du bouton **Tester**.
- **Messages par heure, au plus** (60 par défaut, de 1 à 600) : tous les
  espaces ensemble, bouton Tester compris. Au-delà, un message **n'est pas
  envoyé** (le refus est écrit dans les journaux), il n'est jamais gardé pour
  plus tard.

Bloc **Mon compte** (chaque utilisateur, administrateur ou non) : collez l'URL
du webhook de l'espace où vous voulez recevoir les messages que Gladys **vous**
envoie (action de scène « Envoyer un message », messages système comme une
sauvegarde ratée ou une pile faible, réponses de l'assistant à un message tapé
dans Gladys). Videz-la pour arrêter.

## L'action de scène « Publier dans Google Chat »

Publie un texte dans l'espace par défaut. **Clé de fil** facultative : les
messages de même clé sont regroupés dans un fil (lettres, chiffres et
`. _ : -`, 64 au plus). Sorties pour les actions suivantes : `posted` (publié),
`deduplicated` (dédoublonné) et `message_name` (le nom que Google donne au
message). Quand le même texte (et la même clé de fil) a été envoyé à cet espace
moins de 15 s avant et publié, rien n'est republié : `posted` est faux et
`deduplicated` vrai.

L'action de scène attend la réponse de Google : si le message est refusé, ou si
Google ne répond pas, l'action échoue et la scène continue.

## Ce qui est envoyé, et quand

- Rien n'est envoyé sans un message de Gladys, une scène ou un clic sur
  **Tester**. Aucune interrogation, aucun trafic en arrière-plan.
- Gladys écrit en Markdown ; il est converti en syntaxe Google Chat : gras,
  italique, barré, code, liens `[texte](https://…)`, les titres deviennent une
  ligne en gras. Les textes de plus de 4 096 caractères sont coupés (finis par
  « … »), jamais au milieu d'un lien ou d'un bloc de code. Une mention tapée
  dans un texte (`<users/all>`) devient un simple `@all` : elle ne notifie
  jamais tout l'espace.
- **Les images ne sont pas envoyées** (une photo de caméra jointe à un
  message) : un webhook entrant ne publie que du texte. Le texte du message
  est bien publié.
- Un « espace » est ici l'**espace Google** (la partie `spaces/…` de l'URL),
  commun à tous ses webhooks : deux utilisateurs avec deux webhooks d'un même
  espace en partagent les limites.
- **Un message toutes les 1,1 s par espace** (Google en prend un par seconde) :
  un message attend son tour jusqu'à 2 s environ ; une rafale au-delà n'est pas
  envoyée (« trop de messages à la fois »).
- **Le même texte vers le même espace en moins de 15 s n'est publié qu'une
  fois** : quand plusieurs utilisateurs reçoivent le même espace, un message que
  Gladys leur envoie à tous apparaît une fois. Un doublon reprend l'issue du
  premier message : si le premier a échoué, le doublon échoue aussi ; il n'est
  jamais dit « publié » avant que le premier le soit.

## Jamais envoyé deux fois

Un message qui a pu atteindre Google **n'est jamais renvoyé** : l'intégration
ne le publie jamais deux fois. Ce que donne chaque réponse :

| Réponse de Google Chat                       | Ce qui se passe                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publié (200)                                 | Fini.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 429 (trop de requêtes)                       | Rien n'est publié. L'espace Google (tous ses webhooks) est mis en pause (le délai donné par Google, sinon 1 min, puis 2, 4… jusqu'à 6 h). Pendant la pause, les messages vers cet espace ne sont pas envoyés. La pause survit à un redémarrage.                                                                                                                                                                                                   |
| 401, 403, 404                                | L'URL est **refusée** : webhook supprimé, jeton révoqué, ou webhooks désactivés par l'administrateur. Plus rien n'est envoyé à cette URL avant qu'une nouvelle URL soit enregistrée, que le bouton **Tester** réussisse (espace par défaut) ou qu'on clique sur **Oublier les URL de webhook refusées**. Gardé après un redémarrage sous forme d'empreinte salée de 8 bits, jamais l'URL. Les autres webhooks du même espace ne sont pas refusés. |
| Autre 4xx                                    | Rien n'est publié (message rejeté) ; le message suivant est essayé.                                                                                                                                                                                                                                                                                                                                                                               |
| 5xx                                          | Peut-être publié, peut-être pas : **pas renvoyé**, l'espace mis en pause comme pour un 429.                                                                                                                                                                                                                                                                                                                                                       |
| Pas de réponse en 10 s                       | Peut-être publié : pas renvoyé.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Erreur réseau, DNS, certificat avant l'envoi | Rien n'est envoyé ; le message suivant est essayé.                                                                                                                                                                                                                                                                                                                                                                                                |

Gladys accorde 5 secondes à un message : l'intégration lui répond en 3,5 s au
plus ; un message qui attend encore Google continue alors, et son issue est
écrite dans les journaux.

## Bouton Tester

**Tester l'espace par défaut** publie un message de test dans l'espace par
défaut et dit ce que Google a répondu. Il compte dans le plafond horaire et
n'est pas envoyé pendant une pause, comme tout message ; un clic réessaie l'URL
par défaut même refusée. Deux clics en moins de 15 s : le second répond « Déjà
publié ».

**Oublier les URL de webhook refusées** (administrateur) efface tous les
refus : le prochain message vers chaque URL refusée, de l'espace par défaut ou
d'un utilisateur, est essayé une fois. Le clic n'envoie rien. Un utilisateur
peut aussi enregistrer une nouvelle URL dans « Mon compte ».

## Statut

L'écran Configuration affiche : prêt (avec ou sans espace par défaut), une URL
par défaut qui n'est pas une URL de webhook Google Chat, une URL par défaut
refusée par Google, une pause en cours, ou une configuration illisible (relue
toutes les 5 s, puis de moins en moins souvent, jusqu'à toutes les 5 min).

## Vie privée

Ce qui sort de Gladys : le texte des messages, vers Google Chat
(`chat.googleapis.com`) seulement, en HTTPS. Une redirection n'est jamais
suivie. Ce que garde `/data/state.json` : un sel aléatoire, des empreintes
salées de 8 bits des URL refusées et des espaces en pause (une URL sur 256
partage une empreinte, le fichier ne confirme donc jamais une URL ; après un
redémarrage, une nouvelle URL qui partage l'empreinte d'une URL refusée est
retenue jusqu'au clic sur Oublier), les dates de fin des pauses et les heures
des messages de la dernière heure (pour le plafond horaire). Jamais une URL,
une clé, un jeton ni le texte d'un message.

Si `/data` est illisible au démarrage, les messages partent quand même ; les
refus, pauses et messages appris depuis le démarrage sont gardés en mémoire,
mais ceux d'avant le redémarrage restent inconnus jusqu'à la relecture de
`/data` (toutes les 10 s).
