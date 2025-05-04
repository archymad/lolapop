# Changelog
Tous les changements notables de ce projet seront documentés dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-XX-XX

### Ajouté
- Interface d'administration web complète
- Système de logs centralisé avec visualisation en temps réel
- Contrôle du bot via l'interface web (démarrer/arrêter/redémarrer)
- WebSocket pour les logs en temps réel
- Scripts de démarrage multi-plateformes (Windows/Linux/Mac)
- Orchestrateur pour gérer tous les services
- Gestion robuste des erreurs avec logging détaillé
- Statistiques en temps réel du bot
- Filtres de logs par niveau (info, warn, error, debug)
- Rotation automatique des fichiers de logs
- Vérification des prérequis au démarrage
- Documentation complète avec README mis à jour

### Modifié
- Le bot ne démarre plus automatiquement, contrôle via interface web
- Architecture modulaire améliorée
- Meilleure gestion des sessions utilisateur
- Configuration des typos réduite à 2% pour plus de réalisme
- Messages d'erreur plus conviviaux
- Processus d'initialisation optimisé

### Corrigé
- Gestion des erreurs NLP avec fallback
- Problèmes de déconnexion WhatsApp
- Fuites de mémoire dans les sessions
- Erreurs de timeout dans les transitions d'étapes

### Sécurité
- Masquage des IDs WhatsApp dans les logs
- Validation améliorée des entrées utilisateur
- Gestion sécurisée des données sensibles

## [0.9.0] - 2024-XX-XX

### Ajouté
- Version initiale du bot
- Support WhatsApp via whatsapp-web.js
- Intégration avec Ollama pour le NLP
- Système de personnalité configurable
- Scénarios de conversation flexibles
- Gestion basique des sessions

### Connu
- Nécessite un redémarrage manuel pour les changements de configuration
- Logs uniquement dans la console
- Pas d'interface d'administration

---

## Types de changements
- `Ajouté` pour les nouvelles fonctionnalités.
- `Modifié` pour les changements aux fonctionnalités existantes.
- `Déprécié` pour les fonctionnalités qui seront bientôt supprimées.
- `Retiré` pour les fonctionnalités supprimées.
- `Corrigé` pour les corrections de bugs.
- `Sécurité` en cas de vulnérabilités.