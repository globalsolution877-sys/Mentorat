# Vérifications de sécurité avant utilisation

Le projet n'est pas prêt à accueillir des données sensibles ni à être ouvert en production. Tester sur un projet Supabase de préproduction isolé, jamais avec de vrais dossiers. Ne pas stocker de clés secrètes ou de mots de passe de comptes de test dans le dépôt.

## État des tests

- Les fonctions de validation de fichiers et les utilitaires ont des tests unitaires ; le build TypeScript/Vite est vérifié. `npm test` inclut aussi des tests multi-rôles RLS sur PostgreSQL local éphémère (PGlite) : isolation des étudiants et conseillers, statuts, attributions, notes internes, messagerie, notifications, gestion des rôles et politiques Storage simulées. Les utilisateurs de ces tests existent uniquement en mémoire.
- La migration `202611150003_applications_documents.sql` a été appliquée au projet connecté. Elle ajoute notamment les dossiers, les notes internes et le bucket privé `student-documents`.
- Une tentative de test RLS transactionnel distant a été interrompue par une erreur du fournisseur. Après reconnexion, une lecture a confirmé zéro compte `@example.invalid` et zéro dossier portant les deux noms de test utilisés. Les services Auth, DB, REST et Storage sont signalés sains. Les tables et politiques RLS, le caractère privé du bucket et ses limites ont été vérifiés par leurs métadonnées. Les fonctions de gestion ne sont plus exécutables par `anon` après la migration `202611150004_restrict_rpc.sql`.
- La migration `202611150005_messages_notifications.sql` a été appliquée au projet connecté ; les métadonnées confirment RLS, publication Realtime et absence de lecture anonyme. Les permissions des fonctions ont également été vérifiées.
- La migration `202611150006_user_role_management.sql` a été appliquée au projet connecté. Les privilèges SQL vérifiés interdisent les écritures directes sur les rôles aux clients et l’exécution anonyme des deux nouvelles fonctions ; l’autorisation super administrateur est vérifiée à l’intérieur de ces fonctions.
- La simulation locale ne teste ni les JWT réels, ni l'API Supabase Auth/Storage, ni les liens signés ou l'interface. Des tests de bout en bout sur un environnement isolé avec des sessions réelles restent nécessaires avant production.

## Scénarios à valider sur un environnement isolé

Créer deux étudiants, deux conseillers et un administrateur de test, à l'aide de Supabase Auth ; attribuer les rôles par un opérateur autorisé. Créer des dossiers pour les deux étudiants et les attribuer à deux conseillers distincts. Avec leurs vraies sessions, vérifier via l'API Supabase et l'interface :

1. Chaque étudiant voit seulement ses dossiers, ne peut lire les notes internes, changer un statut, s'attribuer un conseiller, créer des rôles, ni modifier les dossiers d'un autre étudiant.
2. Un conseiller voit seulement les dossiers qui lui sont attribués et leurs profils, ne peut modifier le statut ou lire/ajouter une note sur les autres dossiers. Un changement de statut autorisé passe par la fonction dédiée.
3. Un administrateur peut attribuer et retirer un conseiller possédant le bon rôle, consulter et modifier les statuts ; une attribution invalide et une auto-élévation de privilège sont refusées. Vérifier le journal pour les attributions et les statuts.
4. Chaque étudiant voit, téléverse, télécharge et supprime uniquement ses propres documents ; une tentative directe d'accès à un autre préfixe, y compris en manipulant l'API, échoue. Un conseiller n'a pas accès aux documents personnels. Vérifier l'expiration des liens signés de 60 secondes et le refus des tailles et MIME non autorisés.
5. Vérifier les messages et notifications avec deux étudiants, deux conseillers et un administrateur : refus des usurpations et destinataires étrangers, lecture privée, accès administrateur, révocation après réattribution, notifications de statut et attribution, lecture et actualisation Realtime avec plusieurs navigateurs. Vérifier notamment les JWT et autorisations Realtime réels.
6. Avec de vraies sessions, vérifier que seul le super administrateur accède à la liste et modifie les rôles d’autrui, qu’un compte non confirmé ne peut être promu, que les écritures directes et l’auto-modification échouent, et que les événements sont journalisés. Vérifier les révocations et l’effet sur les sessions ouvertes, ainsi que le refus de retirer le rôle d’un conseiller encore attribué.
7. Vérifier en plus les permissions des autres rôles, les requêtes directes qui contournent les routes React, la création de comptes, les redirections de confirmation, la réinitialisation du mot de passe et la révocation des sessions.

Supabase Storage contrôle le MIME déclaré et la taille ; la validation du navigateur contrôle seulement une signature rudimentaire. Ces contrôles ne prouvent pas qu'un fichier est inoffensif. Prévoir analyse antivirus côté serveur, protection anti-abus et quotas, vérification du contenu, journalisation complète, sauvegardes/restauration, politique de conservation et suppression, revue juridique et tests d'intrusion avant ouverture. Ne jamais exposer la clé service dans le navigateur.

Les fonctions administratives ne nécessitent pas encore de réauthentification forte ou MFA : mettre en place des protections de compte et procédures de contrôle avant production. Le journal des rôles ne couvre pas les modifications effectuées manuellement par un opérateur SQL privilégié.
