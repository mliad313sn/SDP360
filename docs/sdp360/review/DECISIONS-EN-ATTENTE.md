# Décisions en attente — programme de remédiation

Registre des hypothèses prises par les agents d'exécution (plan §8.2 : « jamais de question bloquante ;
on avance sous l'hypothèse recommandée, derrière un drapeau réversible, et on la consigne ici »).
Chaque ligne nomme la fiche, l'hypothèse retenue, le drapeau qui permet de revenir en arrière et le
décideur attendu. Une ligne se ferme quand le décideur confirme ou choisit autrement.

| Date | Fiche | Hypothèse retenue par défaut | Drapeau / point de retour | Décideur | Statut |
|---|---|---|---|---|---|
| 2026-10-20 | IA-1 | Les commentaires IA sont en anglais ou français simple, registre exécutif pour toute audience ; la langue se choisit par rapport (défaut = modèle) | `exec_view_lang` (Exec View) ; sélecteur de langue du Report Studio | Sponsor | Confirmé (demande du 2026-10-20) |
| 2026-10-21 | E2 | Un compte Entra non provisionné est refusé ; appariement uniquement par `entra_oid` puis e-mail exact | `sso_mode` | Responsable identité | Ouvert |
| 2026-10-21 | E4 | La vérification TLS vers OpManager est active par défaut ; un certificat interne se dépose dans `opmanager_ca_bundle` | `opmanager_tls_insecure='0'` | Admin infrastructure | Ouvert |
| 2026-10-21 | E11 | Sans `SDP_BACKUP_KEY` (ou < 16 car.) le dump nocturne reste en gzip **clair** avec une ligne d'avertissement à chaque passage — jamais un refus (une prod sans clé garde ses sauvegardes) | `SDP_BACKUP_KEY` dans `.env` (chiffrement dès qu'elle existe) | Admin infrastructure | Ouvert |
| 2026-10-21 | E11 | La copie hors site est un chemin UNC / disque (`backup_offsite_path`) ; un stockage objet S3 / Azure Blob n'est pas pris en charge | `backup_offsite_path` (vide = local seulement) | Admin infrastructure | Ouvert |
| 2026-10-21 | E11 | L'exercice mensuel prend un dump **frais** puis le restaure (toute la chaîne est exercée) ; un écart d'**une seule ligne** sur l'une des 10 tables = échec. Cible = base jetable via `PG_ADMIN_URL`, sinon schéma jetable avec réécriture `public.` → schéma (limite documentée) | `--dump <fichier>` pour rejouer un dump existant ; `PG_ADMIN_URL` | Admin infrastructure | Ouvert |
| 2026-10-21 | E11 | La planification Windows « Daily DB backup » (Task Scheduler, carte Backups, 02:00) est un second canal indépendant du job `db.backup` (03:00) ; les deux coexistent | Carte Admin ▸ Backups | Admin infrastructure | Ouvert |
