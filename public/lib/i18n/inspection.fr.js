/* A-09a — French for public/inspection.html (IT site inspection form). Most of the form is already bilingual,
 * written "English / Français" or "English ·" + "Français": in French the pair keeps only the French half
 * (the English half or the "/ Français" suffix is emptied). Strings already in French are left as they are
 * (they are on the coverage test's allow-list). The checklist items render both languages themselves and are
 * not keys. The dictation-language button (#langToggleBtn, em_dict_lang) is NOT the UI language and is never
 * touched. Inert unless ui_i18n_pages='1'.
 */
(function (root) {
  'use strict';
  const STATIC = {
    'Search checklist items': 'Rechercher dans la liste de contrôle',   // a11y label (Adoption Lot A, item 10)
    'IT Site Inspection — Mining Operations': '', 'Inspection Site IT — Opérations Minières': 'Inspection Site IT — Opérations Minières',
    '+ New': '+ Nouvelle', '📤 Share': '📤 Partager',
    '⚠️ Fonctionnalités limitées — Ouvrez ce formulaire dans Chrome / Limited features': '⚠️ Fonctionnalités limitées — Ouvrez ce formulaire dans Chrome',
    'Camera and microphone require the file to be opened in Chrome or served via HTTPS.': '',
    'Install IT Inspect on this phone': 'Installer IT Inspect sur ce téléphone',
    "Add to home screen to use as an app · Ajouter à l'écran d'accueil": "Ajouter à l'écran d'accueil pour l'utiliser comme une application",
    'Auto-save': 'Enregistrement auto', 'Ready': 'Prêt', 'Hide OK items': 'Masquer les points OK', 'Hide N/A': 'Masquer N/A', 'Compact': 'Compact',
    'Identification & Context ·': '', 'Identification': 'Identification',
    'Inspection ID': 'Référence', '/ Référence': '', 'Time': 'Heure', '/ Heure': '',
    'Routine / Routinière': 'Routinière', 'Pre-Audit / Pré-Audit': 'Pré-audit', 'Post-Incident / Post-Incident': 'Post-incident',
    'Commissioning / Mise en service': 'Mise en service', 'Handover / Passation': 'Passation', 'Ad-hoc / Ponctuelle': 'Ponctuelle',
    '— Select / Sélectionner —': '— Sélectionner —', 'Sabodala (SGO) — Senegal': 'Sabodala (SGO) — Sénégal',
    'Dakar Office': 'Bureau de Dakar', 'Abidjan Office': "Bureau d'Abidjan", 'Ouagadougou Office': 'Bureau de Ouagadougou', 'Other / Autre': 'Autre',
    'Area / Zone': 'Zone',
    'Main Server Room / Salle Serveur Principale': 'Salle serveur principale', 'Secondary Server Room / Salle Secondaire': 'Salle secondaire',
    'Plant IDF / Local Technique Usine': 'Local technique usine', 'Workshop IT Closet / Atelier — Local IT': 'Atelier — local IT',
    'Warehouse IT Closet / Magasin — Local IT': 'Magasin — local IT', 'Office IT / Local Bureau': 'Local bureau',
    'Process Plant Control Room / Salle de contrôle usine': 'Salle de contrôle usine', 'Mine Operations Centre / Dispatch': 'Centre des opérations minières / Dispatch',
    'Radio Dispatch Room / Salle dispatch radio': 'Salle dispatch radio', 'Heavy Workshop / Atelier engins': 'Atelier engins',
    'Weighbridge / Pont-bascule': 'Pont-bascule', 'Communication Tower / Pylône de communication': 'Pylône de communication',
    'Tower Equipment Shelter / Abri équipements pylône': 'Abri équipements pylône', 'VSAT Terminal / Terminal VSAT': 'Terminal VSAT',
    'Pit Repeater Site / Site répéteur fosse': 'Site répéteur fosse', 'Camp Telecom Room / Local télécom camp': 'Local télécom camp',
    'Underground Portal / Decline / Portail / Descenderie': 'Portail / Descenderie', 'Underground IT Closet / Local IT fond': 'Local IT fond',
    'Underground Refuge Chamber / Chambre refuge': 'Chambre refuge', 'Underground Substation / Sous-station fond': 'Sous-station fond',
    'Hoist / Headframe / Treuil / Chevalement': 'Treuil / Chevalement', 'Gate / Security Post / Portail / Poste sécurité': 'Portail / Poste sécurité',
    'CCTV Control Room / Salle CCTV': 'Salle CCTV', 'Mine Rescue Station / Station mine rescue': 'Station mine rescue', 'Clinic / Infirmerie': 'Infirmerie',
    'Specific Location': 'Localisation précise', '/ Localisation précise': '', 'Lead Inspector': 'Inspecteur principal',
    'Role': 'Fonction', '/ Fonction': '', 'Accompanied by': 'Accompagné par', '/ Accompagné par': '',
    'Weather / Conditions': 'Météo / Conditions', 'Last Inspection Date': 'Dernière inspection', '/ Dernière inspection': '',
    'Scope & Objectives': 'Périmètre & objectifs', '/ Périmètre & objectifs': '',
    'Inspection Checklist ·': '', 'Liste de contrôle': 'Liste de contrôle',
    'OK': 'OK', 'Minor': 'Mineur', 'Major': 'Majeur', 'Critical': 'Critique', 'Opportunity': 'Opportunité',
    'Issues only': 'Écarts seulement', 'Unaddressed': 'Non traités', 'Opportunities': 'Opportunités',
    'Summary & Findings ·': '', 'Synthèse': 'Synthèse',
    'Overall Risk Rating': 'Niveau de risque global', '/ Niveau de risque global': '', '— Select —': '— Sélectionner —',
    '🟢 Low / Faible': '🟢 Faible', '🟡 Moderate / Modéré': '🟡 Modéré', '🟠 High / Élevé': '🟠 Élevé', '🔴 Critical / Critique': '🔴 Critique',
    'Operational Impact': 'Impact opérationnel', '/ Impact opérationnel': '', 'None / Aucun': 'Aucun', 'Limited / Limité': 'Limité',
    'Site partial outage risk / Risque interruption partielle': 'Risque d’interruption partielle', 'Site outage risk / Risque interruption site': 'Risque d’interruption du site',
    'Production-stopping risk / Risque arrêt production': 'Risque d’arrêt de production',
    'Key Observations': 'Observations clés', '/ Observations clés': '', 'Positive Findings': 'Points positifs', '/ Points positifs': '',
    'Corrective Actions & Follow-up ·': '', 'Actions correctives': 'Actions correctives', '+ Add Action': '+ Ajouter une action',
    'Action / Description': 'Action / Description', 'Linked Item': 'Point lié', 'Target Date': 'Date cible',
    'Sign-off ·': '', 'Validation': 'Validation', 'Inspector / Inspecteur': 'Inspecteur', 'Signature': 'Signature',
    'Sign with finger or mouse / Signer au doigt ou à la souris': 'Signer au doigt ou à la souris',
    'Site Acknowledgement / Validation Site': 'Validation site', 'Distribution / Diffusion': 'Diffusion',
    'Submit Inspection ·': '', 'Soumettre': 'Soumettre',
    'Your work is saved on this device as you type; it is sent to the server by': 'Votre saisie est enregistrée sur cet appareil au fil de la frappe ; elle est envoyée au serveur par', 'and by Submit. Tap': 'et par Soumettre. Touchez',
    'when this inspection is complete and ready for review — the record is then marked': 'quand l’inspection est terminée et prête à être revue — elle est alors marquée',
    'submitted': 'soumise', ', locked from further edits by editors, and visible to reviewers on the dashboard.': ', verrouillée pour les éditeurs et visible des relecteurs sur le tableau de bord.',
    '✓ Submit Inspection · Soumettre': '✓ Soumettre l’inspection', '↻ Re-open for edits': '↻ Rouvrir pour modification',
    "Validation runs on tap. You'll see what's missing before anything is sent.": 'La validation se fait au clic : vous verrez ce qui manque avant tout envoi.',
    'Ready to submit?': 'Prêt à soumettre ?', 'Cancel · Annuler': 'Annuler', 'Submit · Soumettre': 'Soumettre',
    'Delete this inspection?': 'Supprimer cette inspection ?', 'Delete · Supprimer': 'Supprimer',
    'Endeavour Mining · IT Operations · Site Inspection Form v1.0': 'Endeavour Mining · Opérations IT · Formulaire d’inspection de site v1.0',
    'Share inspection report · Partager le rapport': 'Partager le rapport d’inspection', 'WhatsApp': 'WhatsApp', 'Share': 'Partager', 'PDF': 'PDF',
    'Report': 'Rapport', 'Backup': 'Sauvegarde', '(JSON)': '(JSON)', 'Switch inspection': 'Changer d’inspection', 'New inspection': 'Nouvelle inspection',
    'Dictation language / Langue de dictée': 'Langue de dictée', 'Rename current': 'Renommer l’actuelle', 'Delete current': 'Supprimer l’actuelle', 'More actions': 'Autres actions', 'Rename': 'Renommer', 'Delete': 'Supprimer',
    'Push the latest changes to the server. Keystrokes only save to this device — click Save now (or Submit) to sync to the dashboard. Useful right before you go offline.':
      'Envoyer les dernières modifications au serveur. La saisie n’est enregistrée que sur cet appareil — cliquez sur Enregistrer maintenant (ou Soumettre) pour synchroniser. Utile juste avant de passer hors ligne.',
    'e.g. Building B-2, Rack R-04': 'ex. Bâtiment B-2, baie R-04', 'Tap to dictate / Appuyer pour dicter': 'Appuyer pour dicter',
    'Pick a technician or type a name': 'Choisir un technicien ou saisir un nom', 'Show suggestions': 'Afficher les suggestions',
    'e.g. Site IT Manager, Group IT, IT Coordinator': 'ex. Responsable IT site, IT Groupe, Coordinateur IT',
    'Pick a preset or type your own': 'Choisir une proposition ou saisir la vôtre',
    'Briefly describe what is being inspected and why / Décrire brièvement le périmètre et les motifs': 'Décrire brièvement le périmètre et les motifs',
    '🔍 Search items / Rechercher (e.g. fire, battery, leaky, VSAT...)': '🔍 Rechercher (ex. incendie, batterie, fuite, VSAT…)',
    'Top findings, themes, root causes / Constats principaux, thèmes, causes': 'Constats principaux, thèmes, causes',
    'What is working well / Ce qui fonctionne bien': 'Ce qui fonctionne bien', 'Required before submit': 'Obligatoire avant soumission',
    'Site IT Manager, Group IT, GM, HSE, ...': 'Responsable IT site, IT Groupe, DG, HSE, …',
    'Move this submitted inspection back to draft so it can be edited (admin only)': 'Remettre cette inspection soumise en brouillon pour la modifier (administrateur seulement)',
  };
  const RUNTIME_KEYS = {
    'That inspection is not on this device and the server did not return it.': 'Cette inspection n’est pas sur cet appareil et le serveur ne l’a pas renvoyée.',
    'Server unreachable — inspection removed locally only.': 'Serveur injoignable — inspection supprimée localement seulement.',
    'Inspection deleted.': 'Inspection supprimée.', 'Already submitted. Use Re-open if you need to edit it.': 'Déjà soumise. Utilisez Rouvrir pour la modifier.',
    'Re-opened — inspection is editable again.': 'Rouverte — l’inspection est de nouveau modifiable.',
    '🎤 Voice dictation re-enabled — give it another try.': '🎤 Dictée vocale réactivée — réessayez.',
    // P11 r7 F-28 — templates: the page puts the number in after the lookup ({n})
    '{n} action(s) were changed meanwhile (actions register or phone): the server kept that status / owner. The form now shows it — change it again and save if you still want your value.':
      '{n} action(s) ont été modifiée(s) entre-temps (registre des actions ou téléphone) : le serveur a gardé ce statut / responsable. Le formulaire l’affiche maintenant — modifiez-le à nouveau et enregistrez si vous voulez toujours votre valeur.',
    '{n} stored action(s) could not be matched safely (same text) and were kept. They are now listed in the form — delete the ones you do not want and save.':
      '{n} action(s) enregistrée(s) n’ont pas pu être rapprochée(s) avec certitude (même texte) et ont été conservée(s). Elles figurent maintenant dans le formulaire — supprimez celles dont vous ne voulez pas et enregistrez.',
    // P11 r8 F-29 — save based on an older version (someone else saved meanwhile)
    '{n} inspection(s) were changed by someone else since they were opened here and were not sent. Open each one and click Save now to reload the latest version and reapply your changes.':
      '{n} inspection(s) ont été modifiée(s) par quelqu’un d’autre depuis leur ouverture ici et n’ont pas été envoyée(s). Ouvrez chacune et cliquez sur Enregistrer maintenant pour recharger la dernière version et réappliquer vos modifications.',
    'Someone else saved this inspection after you opened it. Your changes were NOT sent.': 'Quelqu’un d’autre a enregistré cette inspection après son ouverture ici. Vos modifications n’ont PAS été envoyées.',
    'Load the latest version and reapply your changes (you check them, then click Save now), or cancel to keep editing your copy (use Export JSON to keep it).':
      'Charger la dernière version et réappliquer vos modifications (vous les vérifiez, puis cliquez sur Enregistrer maintenant), ou annuler pour continuer sur votre copie (utilisez Export JSON pour la garder).',
    'Load the latest version': 'Charger la dernière version',
    'The latest version could not be loaded — your copy is kept on this device. Try again.': 'La dernière version n’a pas pu être chargée — votre copie est conservée sur cet appareil. Réessayez.',
    'Latest version loaded and your changes reapplied. Check them, then click Save now.': 'Dernière version chargée et vos modifications réappliquées. Vérifiez-les, puis cliquez sur Enregistrer maintenant.',
    '⚠ Not saved: changed by someone else since you opened it — reload and reapply, then Save now': '⚠ Non enregistrée : modifiée par quelqu’un d’autre depuis son ouverture — rechargez et réappliquez, puis Enregistrer maintenant',
  };
  root.I18N_FR_INSPECTION = Object.assign({}, STATIC, RUNTIME_KEYS);
  root.I18N_FR_INSPECTION_RUNTIME = Object.keys(RUNTIME_KEYS);
})(typeof window !== 'undefined' ? window : globalThis);
