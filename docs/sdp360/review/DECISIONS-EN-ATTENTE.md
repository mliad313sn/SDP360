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
