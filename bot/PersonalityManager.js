/**
 * Gestionnaire de personnalité du bot
 * Gère la personnalisation des messages selon le profil actif
 */

class PersonalityManager {
    constructor(personalityConfig, activeProfile) {
      this.config = personalityConfig;
      this.activeProfile = activeProfile || 'default';
      
      // Charger le profil actif
      this.profile = this.config.profiles[this.activeProfile];
      if (!this.profile) {
        console.warn(`Profil "${this.activeProfile}" non trouvé, utilisation de "default"`);
        this.profile = this.config.profiles.default;
      }
    }
    
    /**
     * Changer le profil actif
     */
    setActiveProfile(profileName) {
      if (!this.config.profiles[profileName]) {
        console.warn(`Profil "${profileName}" non trouvé, utilisation de "${this.activeProfile}"`);
        return false;
      }
      
      this.activeProfile = profileName;
      this.profile = this.config.profiles[profileName];
      return true;
    }
    
    /**
     * Sélectionner une variation de message basée sur la personnalité
     */
    selectMessageVariation(baseMessage, variations = []) {
      if (!variations || variations.length === 0) {
        return baseMessage;
      }
      
      // Probabilité d'utiliser une variation au lieu du message de base
      const variationProbability = 0.8;
      
      // Si pas de variations ou choix aléatoire de garder le message original
      if (Math.random() > variationProbability) {
        return baseMessage;
      }
      
      // Sélectionner une variation aléatoire
      return variations[Math.floor(Math.random() * variations.length)];
    }
    
    /**
     * Appliquer les caractéristiques de personnalité à un message
     */
    applyPersonalityToMessage(message) {
      if (!message) return "";
      
      let processedMessage = message;
      
      // Appliquer les règles de génération de texte si activées
      if (this.config.textGenerationRules) {
        // 1. Appliquer les fautes de frappe (typos)
        if (this.config.textGenerationRules.typos && 
            this.config.textGenerationRules.typos.enabled) {
          processedMessage = this.applyTypos(processedMessage);
        }
        
        // 2. Ajuster la ponctuation
        if (this.config.textGenerationRules.punctuation) {
          processedMessage = this.adjustPunctuation(processedMessage);
        }
        
        // 3. Ajuster la capitalisation
        if (this.config.textGenerationRules.capitalization) {
          processedMessage = this.adjustCapitalization(processedMessage);
        }
      }
      
      // Ajouter des émojis selon la fréquence configurée
      processedMessage = this.addEmojis(processedMessage);
      
      // Fragmenter le message si configuré
      if (this.config.textGenerationRules?.messageBreaking?.enabled &&
          processedMessage.length > 40 &&
          Math.random() < this.config.textGenerationRules.messageBreaking.frequency) {
        return this.breakMessage(processedMessage);
      }
      
      return processedMessage;
    }
    
    /**
     * Appliquer des fautes de frappe aléatoires
     */
    applyTypos(message) {
      if (!this.config.textGenerationRules?.typos?.enabled) return message;
      
      const typoFrequency = this.config.textGenerationRules.typos.frequency || 0.08;
      let result = "";
      
      // Pour chaque caractère du message
      for (let i = 0; i < message.length; i++) {
        // Appliquer une faute de frappe avec la probabilité définie
        if (Math.random() < typoFrequency) {
          const char = message[i];
          
          // Différents types de fautes possibles
          const typoType = Math.floor(Math.random() * 4);
          
          switch (typoType) {
            case 0: // Omettre le caractère
              // Ne rien ajouter
              break;
              
            case 1: // Doubler le caractère
              result += char + char;
              break;
              
            case 2: // Remplacer par un caractère proche sur le clavier
              const keyboardNeighbors = {
                'a': 'qzs', 'b': 'vghn', 'c': 'xdfv', 'd': 'serfcx',
                'e': 'zdr', 'f': 'drtgvc', 'g': 'ftyhbv', 'h': 'gyujnb',
                'i': 'ujko', 'j': 'huikm', 'k': 'jilo', 'l': 'kopm',
                'm': 'njk', 'n': 'bhjm', 'o': 'iklp', 'p': 'olm',
                'q': 'asw', 'r': 'edfgt', 's': 'qazxcdew', 't': 'rfghy',
                'u': 'yhji', 'v': 'cfgb', 'w': 'qase', 'x': 'zsdc',
                'y': 'tghu', 'z': 'asx'
              };
              
              const lowerChar = char.toLowerCase();
              if (keyboardNeighbors[lowerChar]) {
                const neighbors = keyboardNeighbors[lowerChar];
                const neighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
                result += char === lowerChar ? neighbor : neighbor.toUpperCase();
              } else {
                result += char;
              }
              break;
              
            case 3: // Ajouter un caractère proche
              result += char;
              const extraChars = 'abcdefghijklmnopqrstuvwxyz';
              result += extraChars[Math.floor(Math.random() * extraChars.length)];
              break;
          }
        } else {
          // Pas de faute, ajouter le caractère normal
          result += message[i];
        }
      }
      
      return result;
    }
    
    /**
     * Ajuster la ponctuation selon le style
     */
    adjustPunctuation(message) {
      if (!this.config.textGenerationRules?.punctuation) return message;
      
      let result = message;
      
      // Omission des points finaux
      if (this.config.textGenerationRules.punctuation.omitPeriods) {
        if (result.endsWith('.')) {
          result = result.slice(0, -1);
        }
      }
      
      // Points d'interrogation multiples
      if (this.config.textGenerationRules.punctuation.multipleQuestionMarks) {
        result = result.replace(/\?(?!\?)/g, (match) => {
          const count = 1 + Math.floor(Math.random() * 2);
          return '?'.repeat(count);
        });
      }
      
      // Points d'exclamation multiples
      if (this.config.textGenerationRules.punctuation.multipleExclamationPoints) {
        result = result.replace(/\!(?!\!)/g, (match) => {
          const count = 1 + Math.floor(Math.random() * 2);
          return '!'.repeat(count);
        });
      }
      
      // Utilisation d'ellipses
      if (this.config.textGenerationRules.punctuation.useEllipsis) {
        // Remplacer certaines virgules par des ellipses
        if (Math.random() < 0.3) {
          result = result.replace(/,(?=\s)/g, (match) => {
            return Math.random() < 0.4 ? '...' : match;
          });
        }
      }
      
      return result;
    }
    
    /**
     * Ajuster la capitalisation selon le style
     */
    adjustCapitalization(message) {
      if (!this.config.textGenerationRules?.capitalization) return message;
      
      let result = message;
      
      // Ne pas capitaliser au début des phrases
      if (this.config.textGenerationRules.capitalization.beginSentence === false) {
        result = result.replace(/^[A-Z]/, (match) => match.toLowerCase());
        result = result.replace(/\.\s+[A-Z]/g, (match) => {
          return match.slice(0, -1) + match.slice(-1).toLowerCase();
        });
      }
      
      // Majuscules pour l'emphase
      if (this.config.textGenerationRules.capitalization.allCaps && 
          this.config.textGenerationRules.capitalization.allCaps.enabled) {
        
        // Sélectionner aléatoirement un mot pour le mettre en majuscules
        const words = result.split(' ');
        if (words.length > 3 && 
            Math.random() < this.config.textGenerationRules.capitalization.allCaps.frequency) {
          
          const randomIndex = Math.floor(Math.random() * words.length);
          const word = words[randomIndex];
          
          // Éviter de mettre en majuscules des mots courts ou la ponctuation
          if (word.length > 3 && !word.match(/[,.!?;:]/)) {
            words[randomIndex] = word.toUpperCase();
            result = words.join(' ');
          }
        }
      }
      
      return result;
    }
    
    /**
     * Ajouter des émojis selon la fréquence configurée
     */
    addEmojis(message) {
      // Vérifier si les émojis sont configurés pour le profil actif
      if (!this.profile.messaging?.emoji) return message;
      
      const emojiFrequency = this.profile.messaging.emoji.frequency;
      
      // Convertir la fréquence textuelle en valeur numérique
      let frequency = 0;
      switch (emojiFrequency) {
        case 'none': frequency = 0; break;
        case 'rare': frequency = 0.1; break;
        case 'low': frequency = 0.2; break;
        case 'moderate': frequency = 0.3; break;
        case 'high': frequency = 0.5; break;
        default: frequency = 0.3;
      }
      
      // Si fréquence nulle, retourner le message tel quel
      if (frequency === 0) return message;
      
      // Obtenir les émojis favoris du profil
      const favoriteEmojis = this.profile.messaging.emoji.favorite || 
                            ["😉", "💋", "👍", "👌"];
      
      // Déterminer si on ajoute un emoji en fin de message
      if (Math.random() < frequency) {
        // Sélectionner un emoji aléatoire
        const emoji = favoriteEmojis[Math.floor(Math.random() * favoriteEmojis.length)];
        
        // Ajouter l'emoji à la fin
        return message + ' ' + emoji;
      }
      
      return message;
    }
    
    /**
     * Fragmenter un message en plusieurs parties
     */
    breakMessage(message) {
      if (!this.config.textGenerationRules?.messageBreaking?.enabled) {
        return message;
      }
      
      const maxFragments = this.config.textGenerationRules.messageBreaking.maxFragments || 3;
      const minCharsPerFragment = this.config.textGenerationRules.messageBreaking.minCharsPerFragment || 5;
      
      // Si le message est trop court pour être fragmenté
      if (message.length < minCharsPerFragment * 2) {
        return message;
      }
      
      // Déterminer le nombre de fragments
      const fragmentCount = 1 + Math.floor(Math.random() * Math.min(maxFragments - 1, Math.floor(message.length / minCharsPerFragment) - 1));
      
      // Points de rupture potentiels (espaces, virgules, points)
      const breakPoints = [];
      for (let i = minCharsPerFragment; i < message.length - minCharsPerFragment; i++) {
        if (message[i] === ' ' || message[i] === ',' || message[i] === '.') {
          breakPoints.push(i);
        }
      }
      
      // Si pas assez de points de rupture
      if (breakPoints.length < fragmentCount - 1) {
        return message;
      }
      
      // Sélectionner aléatoirement les points de rupture
      const selectedBreakPoints = [];
      for (let i = 0; i < fragmentCount - 1; i++) {
        const availablePoints = breakPoints.filter(point => 
          !selectedBreakPoints.includes(point) &&
          selectedBreakPoints.every(selected => Math.abs(selected - point) > minCharsPerFragment)
        );
        
        if (availablePoints.length === 0) break;
        
        const randomIndex = Math.floor(Math.random() * availablePoints.length);
        selectedBreakPoints.push(availablePoints[randomIndex]);
      }
      
      // Trier les points de rupture
      selectedBreakPoints.sort((a, b) => a - b);
      
      // Créer les fragments
      const fragments = [];
      let startIndex = 0;
      
      for (const breakPoint of selectedBreakPoints) {
        fragments.push(message.substring(startIndex, breakPoint + 1).trim());
        startIndex = breakPoint + 1;
      }
      
      // Ajouter le dernier fragment
      fragments.push(message.substring(startIndex).trim());
      
      return fragments.join('\n');
    }
    
    /**
     * Obtenir le profil de personnalité actif
     */
    getActiveProfile() {
      return {
        name: this.activeProfile,
        profile: this.profile
      };
    }
  }
  
  module.exports = PersonalityManager;