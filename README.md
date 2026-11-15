# GLOBAL MENTORAT

Application React, TypeScript, Vite et Supabase. Aucun serveur Node.js n'est nécessaire pour héberger le build statique sur LWS. Le logo fourni est conservé dans `src/assets/logo-original.jpeg` ; sa version recadrée conserve les proportions. L'image de couverture est générée.

## État réel de cette première phase

Fonctionnel sous réserve de configuration Supabase : site public responsive, pages d'information, catalogue et détail des bourses, recherche, partage, inscription/connexion/réinitialisation via Supabase Auth, profil, favoris, demande d’orientation, dossiers de candidature internes et suivi par les conseillers attribués, documents personnels privés, messagerie par dossier, notifications sur le site, contact et gestion des bourses pour les rôles habilités ; un super administrateur peut consulter les comptes et attribuer ou retirer des rôles applicatifs à partir de l’interface. Les autres catalogues affichent les contenus publiés lorsqu'ils existent ; aucune bourse ou donnée fictive n'est injectée. La publication d’une bourse nécessite une date de vérification, un lien officiel et une source.

**Ce n'est pas encore la plateforme complète ni une version prête pour la production.** Restent notamment : gestion complète des pays/universités/programmes/articles/témoignages, création/suppression/suspension de comptes et gestion des super administrateurs dans l’interface, formations, visas, partage des documents avec un conseiller, journalisation complète, paramètres administrables, protection anti-spam, SEO avancé, pagination et tests de bout en bout RLS multi-utilisateurs. La politique de confidentialité doit être rédigée. Les formulaires publics ne possèdent pas encore de protection anti-abus robuste ; ne pas ouvrir au public avant mise en place. L'interface ne prétend pas proposer ces fonctionnalités absentes.

## Développement

Prérequis : Node.js 20 ou plus récent pour le développement uniquement.

```sh
npm ci
cp .env.example .env.local
# Remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY avec l'URL et la clé publishable/anon du projet
npm run dev
npm run test
npm run build
```

Ne jamais mettre de clé `service_role`, de clé `secret` ou de mot de passe dans les variables Vite : elles sont publiées dans le navigateur. Le projet Supabase choisi dans cette session est `global-mentorat` (`yhsppzxwmltbjntdqciy`). Les six migrations dans `supabase/migrations/` ont déjà été appliquées à ce projet ; ne pas les réexécuter dessus. L'ancien schéma privé `gm_app` n'a pas été modifié ni supprimé. Les anciennes données ne sont pas automatiquement migrées. Pour un autre projet vide, appliquer les migrations dans l’ordre, une seule fois après vérification.

Les tables du socle et des dossiers ont RLS activé ; les rôles sont vérifiés côté PostgreSQL. La gestion des rôles de l'application n'est pas modifiable par un utilisateur ordinaire. Les politiques doivent être vérifiées avec plusieurs comptes et rôles avant utilisation réelle ; les tests actuels ne constituent pas un audit de sécurité. Il n'y a pas de données de démonstration. Les clés privilégiées précédemment manipulées doivent être renouvelées avant tout usage.

## Initialiser le premier administrateur

Créer un compte via l'interface, confirmer son e-mail, puis attribuer le rôle via un administrateur de confiance dans l'éditeur SQL Supabase en ciblant l'UUID réel affiché dans Auth, sans utiliser la clé service dans le navigateur :

```sql
-- Remplacer la valeur par l'UUID réel du compte vérifié.
insert into public.user_roles (user_id, role) values ('UUID_DU_COMPTE_VERIFIE', 'super_admin');
```

Ne jamais accorder ce rôle à un compte non vérifié. L’interface d’administration gère les bourses et l’attribution des dossiers. Les statuts et notes internes sont accessibles aux conseillers attribués et aux administrateurs. L’initialisation du premier super administrateur et la gestion du rôle super administrateur restent des opérations SQL manuelles de confiance. Sur le projet connecté, aucun super administrateur n’est encore enregistré : il faut d’abord initialiser un compte vérifié.

Voir `docs/LWS.md` pour le déploiement et les réglages Auth. Le domaine `globalmentorat.com` est envisagé, pas présumé actif.

## Documents et candidatures

La création d’un dossier est un suivi interne et ne transmet aucune candidature à une université ou à un organisme. Les notes de conseil sont internes, distinctes des données visibles par l’étudiant. Le bucket `student-documents` est privé ; les documents ne sont actuellement accessibles qu’à leur propriétaire, pas aux conseillers. Les liens signés expirent après 60 secondes. Limite : 5 Mo, PDF/JPEG/PNG. Le contrôle de signature dans le navigateur et la vérification du MIME par Storage ne constituent pas une analyse antivirus ; les types MIME peuvent être usurpés. Ne pas utiliser pour des documents sensibles en production avant revue et mise en place de protections serveur supplémentaires.

Les changements de statut et d’attribution sont journalisés ; ce journal ne couvre pas toutes les actions de la plateforme. Les migrations ont été appliquées. Des tests RLS multi-rôles passent sur une base PostgreSQL locale simulée ; ils ne remplacent pas des tests de bout en bout sur Supabase Auth et Storage. Après l’échec du test transactionnel distant, une vérification a confirmé qu’aucun compte ou dossier de test nommé par ce test ne subsistait. Voir `docs/SECURITE.md`.

## Messagerie et notifications

L’étudiant et le conseiller actuellement attribué peuvent échanger dans chaque dossier ; sans attribution, aucun envoi n’est possible. Les administrateurs peuvent consulter les échanges. L’étudiant conserve l’historique ; après réattribution, l’ancien conseiller perd l’accès et le nouveau ne voit que ses propres échanges avec l’étudiant. Les messages ne prennent pas en charge les pièces jointes. Les notifications sur le site sont créées par la base lors d’un message, d’un changement de statut ou d’attribution ; elles ne sont pas envoyées par e-mail. Leur lecture est manuelle et distincte de celle des messages. L’actualisation utilise Supabase Realtime lorsque l’écran est ouvert. La protection anti-abus et les quotas de messages restent à mettre en place.

## Utilisateurs et rôles

Le super administrateur accède à **Mon espace → Utilisateurs et rôles** ou `/admin/utilisateurs` : recherche par nom ou e-mail Auth, liste paginée et attribution/retrait des rôles autorisés. Les utilisateurs s’inscrivent eux-mêmes ; l’interface ne crée, ne suspend ni ne supprime de compte. Seuls les comptes dont l’e-mail Auth est confirmé peuvent recevoir un rôle ; cette confirmation ne remplace pas une vérification humaine de l’identité. Le super administrateur ne peut modifier ses propres rôles ni attribuer ou retirer les rôles `student` et `super_admin` via cette interface. Les changements sont inscrits dans `activity_logs`. Un conseiller ayant des dossiers ou des demandes d’orientation attribués doit d’abord être désaffecté ou remplacé ; pour les demandes d’orientation, cette opération reste actuellement manuelle par un opérateur de confiance. La révocation d’un rôle bloque les autorisations côté base, mais une session déjà ouverte peut afficher une interface périmée jusqu’au rechargement ou à la reconnexion. Les rôles des modules non encore développés ne rendent pas ces modules disponibles.

Un accès super administrateur compromis peut accorder de nombreux privilèges. Prévoir MFA, politique de session et procédures de contrôle avant production ; ils ne sont pas encore mis en place ici.
