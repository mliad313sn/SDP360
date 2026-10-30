# SDP360 — dossier de décision GO / NO-GO (G24)

Date : 29 octobre 2026 · Branche : `claude/sdp360-consolidation` · Rédigé par l'agent de développement (IA). Ce
dossier **recommande** ; il ne décide pas et ne porte aucune signature. Chaque chiffre renvoie à une preuve du
dépôt ; ce qui n'a pas été mesuré est écrit « non mesuré ».

## 1. Recommandation

| Décision | Recommandation | Pourquoi |
|---|---|---|
| Mise en production | **NO-GO** | Huit portes humaines non franchies (section 4), dont la rotation d'un mot de passe ancien visible dans l'historique git, l'absence de clé de signature et l'absence de tout test sur un vrai site |
| Pilote sur l'instance de TEST d'Endeavour (1 à 2 sites, données réelles, utilisateurs nommés) | **GO sous conditions** | Le code est complet pour un pilote et sa suite de tests est verte ; conditions : rotation EX-01 faite, sauvegarde/restauration rejouées sur le serveur TEST, utilisateurs pilotes désignés |
| Diffusion hors d'Endeavour / offre commerciale | **NO-GO** | Licence « usage interne », droits des contributeurs non documentés, redistribution des installeurs EDB et Microsoft non revue (`RIGHTS-REGISTER.md`) |

## 2. Ce qui est prouvé (code et tests, pas le terrain)

- **Suite complète sur PostgreSQL** : 3 079 tests, 0 échec, 11 tests sautés avec justification et propriétaire
  (exécution du 29/10 après la seconde revue sécurité) ; lint de sécurité propre ; aucun secret dans les fichiers suivis.
- **Intégration continue** sur le commit 8d8a789 : CI, CodeQL et l'installeur Windows (installation à blanc, mise
  à jour avec sauvegarde préalable, retour arrière forcé, restauration, désinstallation) — tous verts.
- **Traçabilité** : 25 objectifs, chaque fichier de preuve cité existe (`TRACEABILITY.md`, vérifié en CI).
- Statut par objectif : 9 « implémentés », 15 « partiels », 1 en cours (celui-ci). Aucun n'est « validé terrain »,
  « déployé » ou « accepté » : ces colonnes restent INCONNUES tant qu'une personne habilitée ne l'a pas constaté.

## 3. Défauts trouvés et corrigés aujourd'hui (extraits)

| Domaine | Défaut | État |
|---|---|---|
| Application terrain | une saisie du technicien était **supprimée du téléphone** après une session expirée, un refus ou un conflit ; une erreur serveur passagère rendait l'envoi définitivement « doublon » | corrigé, testé navigateur + base |
| IA | le proxy du générateur de présentations envoyait au modèle les e-mails, téléphones et noms présents dans les tickets | corrigé, test de bout en bout |
| Journaux | `api_token=…` et `sessiontoken=…` n'étaient pas masqués ; `Authorization: Bearer X` gardait X | corrigé (trouvé par les tests de fuzz) |
| Alertes | aucune gravité, aucun essai à blanc ; une règle WAN se disait « contractuelle » sans mesurer le contrat | gravité + essai à blanc ; la règle WAN est « opérationnelle », pas contractuelle |
| Photos d'inspection | une référence de photo envoyée par le téléphone pouvait désigner, lire ou écraser la photo d'une autre inspection ; les fichiers étaient écrits avant le contrôle de site | corrigé, testé (seconde revue sécurité IA) |
| Navigation | menu de 16 entrées à plat, raccourci clavier non conforme WCAG 2.1.4, 10 pages débordant sur téléphone | menus groupés, recherche Ctrl+K, 0 débordement à 390 px |

## 4. Portes humaines ouvertes (aucune ne peut être franchie par l'IA)

| # | Porte | Propriétaire | Preuve attendue |
|---|---|---|---|
| 1 | Rotation du mot de passe superutilisateur PostgreSQL ancien + décision sur l'historique git (EX-01) | Responsable sécurité + DBA | rotation faite sur chaque cluster |
| 2 | Clé de signature de production (D-11/D-12) | Responsable de version | cérémonie de clé |
| 3 | Exécution sur l'instance TEST puis CAB | Opérateur | journal d'exécution, PV de CAB |
| 4 | Définitions KPI et pondérations (D-01/02/03) | Comité KPI | décision écrite |
| 5 | Rôles, canaux et destinataires des rapports et alertes (D-13), séparation par département (D-14), appelants des routes à clé (D-15) | PO + responsables métier | décisions écrites |
| 6 | Revue juridique : droits, licence, redistribution | Juridique | avis écrit |
| 7 | Validation terrain sur appareil réel et tests d'utilisabilité avec de vrais utilisateurs (`docs/ops/USABILITY-TEST-PROTOCOL.md`) | Responsable IT site + PO | fiches de session |
| 8 | Signature sécurité humaine (CISO) sur le modèle de menaces et la version candidate | Responsable sécurité | avis signé |

## 5. Bénéfices métier

**Non mesurés.** Aucun gain de temps, aucune réduction d'incident n'est revendiqué. Le gabarit
`TCO-TEMPLATE.csv` liste ce qu'il faut mesurer pendant le pilote (heures par rapport hebdomadaire, rapports
produits à la main), avec une source et un responsable par ligne.

## 6. Prochaines étapes proposées

1. Porte 1 (rotation) — préalable à tout pilote.
2. Pilote TEST sur 1 à 2 sites pendant 4 semaines : mesurer les lignes du gabarit TCO, dérouler le protocole
   d'utilisabilité, noter chaque anomalie.
3. Décisions D-01, D-13, D-14 pendant le pilote, pour que les rapports et les alertes puissent être armés.
4. Revue juridique et signature de production en parallèle ; nouveau dossier GO/NO-GO à la fin du pilote.
