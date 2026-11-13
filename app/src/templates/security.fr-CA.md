Kaigi est le système de vidéoconférence autohébergé de [FreeGateway](https://www.freegateway.org). Comme pour tous les projets de FreeGateway, la sécurité est primordiale. La vidéoconférence présente toutefois des risques accrus pour la sécurité et la vie privée qui exigent une protection renforcée. Lorsque vous entrez dans une réunion et activez votre microphone et votre caméra, vous devez avoir l’assurance que seules les personnes expressément autorisées peuvent vous entendre, vous voir et lire vos messages.

Un autohébergement bien réalisé constitue la base d’une politique de sécurité solide et de la souveraineté numérique d’un organisme. Il donne à votre organisme le contrôle direct du service de vidéoconférence, de ses comptes et de ses données. Votre organisme exploite Kaigi sur du matériel qu’il contrôle. Il décide qui peut se connecter à Kaigi et à quelles réunions chaque personne peut participer. Ces trois protections constituent le cœur de la sécurité de Kaigi :

- **Seules les personnes autorisées peuvent participer.** Kaigi ne permet pas aux utilisateurs de créer un compte à la volée. Votre organisme doit créer les comptes autorisés à l’avance.
- **Vous contrôlez votre propre participation.** Les autres participants ne peuvent pas activer votre caméra ou votre microphone, vous exclure ni mettre fin à la réunion pour tout le monde. Lorsque vous quittez une réunion, Kaigi cesse immédiatement de capter votre vidéo et votre audio pour cette réunion.
- **Aucun suivi par des tiers.** Kaigi ne demande pas automatiquement de scripts, de polices ou de traductions à des services tiers. Kaigi fournit ces ressources à partir de ce site : les fournisseurs externes ne découvrent donc pas votre activité simplement parce que vous ouvrez une page ou participez à une réunion.

## Seules les personnes autorisées peuvent participer

Chaque personne doit se connecter avec le nom d’utilisateur et le mot de passe de son compte préautorisé. Recevoir une invitation ou connaître le nom d’une réunion ne donne pas accès à cette réunion.

Kaigi vérifie vos autorisations sur le serveur lorsque vous sélectionnez une réunion, ouvrez la page de préparation et entrez dans la réunion.

Kaigi exclut les noms de réunion et les jetons de connexion des liens qu’il génère. Copier l’adresse d’une page ou la conserver dans l’historique de votre navigateur ne les expose donc pas.

## Vous contrôlez votre propre participation

Les réunions n’ont ni modérateur ni hôte. Un autre participant ne peut pas activer votre caméra ou votre microphone, autoriser votre entrée ou vous exclure, ni mettre fin à la réunion pour tout le monde.

Kaigi vérifie aussi l’identité de l’expéditeur des messages de clavardage et des transferts de fichiers au lieu de faire confiance au nom joint à ces éléments. Les tableaux blancs partagés ne sont disponibles que pendant une réunion en cours. Les brouillons d’annotations textuelles restent dans votre navigateur jusqu’à leur sauvegarde. Les indicateurs de saisie du clavardage restent désactivés à moins que l’administrateur du site les active.

L’administrateur peut désactiver la fonction d’enregistrement intégrée de Kaigi pour certaines réunions. Cela n’empêche toutefois personne de faire une capture d’écran, d’enregistrer avec une autre application ou de conserver ce que vous partagez.

## Aucun suivi par des tiers

Kaigi fournit les ressources nécessaires — scripts, polices, traductions et effets d’arrière-plan — à partir de ce site. Il ne les récupère pas sur des serveurs tiers. Kaigi supprime également les fonctions de suivi intégrées et les services d’avatars distants, n’envoie pas le contenu des réunions à des services externes d’IA ou de transcription et bloque les fonctions qui chargeraient discrètement une image externe.

**Pourquoi est-ce important?** Même une demande aussi ordinaire que celle d’une police peut révéler à un service externe votre adresse IP et l’heure de la demande. Selon la demande, elle peut aussi révéler le site que vous visitiez. Fournir les ressources à partir de ce serveur évite ces divulgations courantes. Cela empêche aussi un fournisseur externe de modifier un script que Kaigi charge pendant votre réunion ou de rendre une partie de l’interface inutilisable en retirant une ressource.

Cela ne signifie pas que votre navigateur ne peut jamais contacter un autre site. Si vous ouvrez un lien externe, votre navigateur contacte sa destination. De même, votre administrateur peut configurer explicitement Kaigi pour qu’il contacte d’autres services, internes à votre organisme ou fournis par des tiers. Votre organisme peut, par exemple, configurer son propre annuaire OpenLDAP pour la connexion ou un serveur relais multimédia [TURN](https://en.wikipedia.org/wiki/Traversal_Using_Relays_around_NAT) qui aide les participants à se connecter depuis des réseaux restrictifs.

## Les sessions expirent et Kaigi limite les demandes suspectes

La déconnexion met fin à votre session sur le serveur Kaigi. Une session expirée ou révoquée ne permet pas de revenir dans une réunion. La reconnexion après une interruption du réseau ne contourne pas les vérifications d’accès. L’administrateur peut configurer deux limites facultatives qui exigent une nouvelle connexion une fois le délai atteint. La première est une limite d’inactivité : Kaigi la déclenche lorsqu’il ne détecte aucune activité de votre navigateur pendant la durée prévue. Votre participation silencieuse à une réunion ne compte pas comme de l’inactivité. La seconde est une durée maximale de session, absolue, que l’activité ne prolonge jamais.

Kaigi limite les tentatives répétées de connexion et ferme les connexions qui n’achèvent pas leur établissement ou leur authentification. Ces mesures aident à garder le service disponible pour les utilisateurs légitimes. Les journaux de sécurité peuvent inclure l’heure, le type d’événement et l’adresse IP de connexion, mais ne contiennent ni mot de passe ni jeton de connexion. L’organisme qui exploite ce site établit sa propre politique de conservation des journaux.

## Ce que ces protections ne couvrent pas

Kaigi chiffre les connexions entre votre navigateur et le serveur de conférence. HTTPS protège les pages Web et les renseignements de connexion, tandis que le chiffrement WebRTC protège l’audio, la vidéo et le partage d’écran. Cela protège les renseignements en transit, mais ne cache pas le contenu de la réunion au serveur de conférence lui-même. Kaigi ne fournit pas de chiffrement de bout en bout. L’organisme qui exploite le site doit sécuriser le serveur, le tenir à jour et expliquer comment il traite les données. Les autres participants autorisés peuvent toujours voir, entendre ou copier ce que vous choisissez de partager avec eux.

Pour toute question sur les pratiques de confidentialité de cette installation, contactez l’administrateur du site. Si vous croyez avoir découvert une faille de sécurité, signalez-la en privé plutôt que d’en publier les détails dans un ticket public.

## Kaigi s’intègre au système de courriel Kojo de FreeGateway

Kaigi peut se connecter à l’annuaire OpenLDAP du système de courriel [Kojo](https://www.freegateway.org/projects/kojo) de FreeGateway. Lorsque votre organisme active cette intégration, vous pouvez utiliser les mêmes identifiants pour le courriel et Kaigi, sans mot de passe distinct pour la vidéoconférence. Vous devez tout de même vous connecter à Kaigi : partager un annuaire ne signifie pas que la connexion au courriel vous connecte automatiquement aux réunions.

Votre organisme gère les comptes et les autorisations de réunion de façon centralisée. Il peut utiliser les groupes de l’annuaire pour donner accès à différentes réunions à différentes équipes. Un compte de courriel ne donne pas automatiquement accès à toutes les réunions : Kaigi continue de vérifier les autorisations de chaque personne sur le serveur.

Kaigi vérifie votre mot de passe auprès de l’annuaire de votre organisme et ne le conserve pas pour les accès ultérieurs aux réunions. Cela évite de maintenir un second ensemble de mots de passe ou de les envoyer à un fournisseur d’identité externe. Les connexions à un annuaire sur un autre système utilisent TLS avec chiffrement et vérification du certificat. Kaigi limite les connexions non chiffrées à un annuaire au réseau de bouclage du même hôte.

L’intégration à Kojo est facultative. Kaigi peut aussi utiliser des comptes gérés localement ou un autre annuaire OpenLDAP compatible, tout en conservant ses vérifications d’accès aux réunions.
