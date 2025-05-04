/**
 * Gestionnaire de médias pour le bot
 */

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

class MediaManager {
  constructor(mediaConfig) {
    this.config = mediaConfig;
    this.mediaHistory = new Map(); // Historique des médias envoyés par utilisateur
  }
  
  /**
   * Envoyer un média à un utilisateur
   * @param {Object} client - Client WhatsApp
   * @param {string} chatId - ID du chat destinataire
   * @param {string} mediaType - Type de média (image, sticker, voice, etc.)
   * @param {string} category - Catégorie du média (profile, verification, etc.)
   * @param {Object} options - Options supplémentaires
   * @returns {Promise<boolean>} Succès de l'envoi
   */
  async sendMedia(client, chatId, mediaType, category, options = {}) {
    try {
      // Vérifier si le type de média est activé
      if (!this.isMediaTypeEnabled(mediaType)) {
        console.warn(`Type de média désactivé: ${mediaType}`);
        return false;
      }
      
      // Obtenir les configurations du média
      const mediaSettings = this.getMediaSettings(mediaType, category);
      
      if (!mediaSettings || !mediaSettings.path) {
        console.error(`Configuration de média non trouvée: ${mediaType}/${category}`);
        return false;
      }
      
      // Vérifier si le fichier existe
      const mediaPath = mediaSettings.path;
      if (!fs.existsSync(mediaPath)) {
        console.error(`Média non trouvé: ${mediaPath}`);
        
        // Gestion d'erreur selon la configuration
        const errorAction = this.config.globalSettings?.errorHandling?.missingMedia?.action || 'skip';
        
        if (errorAction === 'fallback' && options.fallbackCallback) {
          return await options.fallbackCallback();
        } else if (errorAction === 'message' && client) {
          const fallbackMessage = this.config.globalSettings?.errorHandling?.missingMedia?.fallbackMessage || 
                                "Impossible d'envoyer le média demandé";
          await client.sendMessage(chatId, fallbackMessage);
          return true;
        }
        
        return false;
      }
      
      // Créer un objet MessageMedia
      const media = MessageMedia.fromFilePath(mediaPath);
      
      // Sélectionner une légende
      let caption = '';
      if (mediaSettings.captions && mediaSettings.captions.length > 0) {
        if (this.config.globalSettings?.randomizeSelection) {
          // Sélection aléatoire
          caption = mediaSettings.captions[Math.floor(Math.random() * mediaSettings.captions.length)];
        } else {
          // Première légende
          caption = mediaSettings.captions[0];
        }
      }
      
      // Si une légende est spécifiée dans les options, l'utiliser
      if (options.caption) {
        caption = options.caption;
      }
      
      // Envoyer le média
      if (client) {
        await client.sendMessage(chatId, media, {
          caption: caption
        });
        
        // Mettre à jour l'historique
        this.updateMediaHistory(chatId, mediaType, category);
        
        return true;
      } else {
        return media; // Retourner le média si aucun client n'est fourni
      }
    } catch (error) {
      console.error(`Erreur lors de l'envoi du média ${mediaType}/${category}:`, error);
      
      // Gestion des erreurs d'envoi
      const errorHandling = this.config.globalSettings?.errorHandling?.failedSend;
      
      if (errorHandling && errorHandling.retryCount > 0) {
        for (let i = 0; i < errorHandling.retryCount; i++) {
          try {
            console.log(`Tentative de réenvoi ${i+1}/${errorHandling.retryCount}...`);
            
            // Attendre avant de réessayer
            await new Promise(resolve => setTimeout(resolve, errorHandling.retryDelayMs || 5000));
            
            // Réessayer
            const media = MessageMedia.fromFilePath(mediaSettings.path);
            await client.sendMessage(chatId, media, {
              caption: options.caption || ''
            });
            
            // Succès
            this.updateMediaHistory(chatId, mediaType, category);
            return true;
          } catch (retryError) {
            console.error(`Échec de la tentative ${i+1}:`, retryError);
          }
        }
      }
      
      // Si toutes les tentatives échouent
      if (errorHandling && errorHandling.failureMessage && client) {
        await client.sendMessage(chatId, errorHandling.failureMessage);
      }
      
      return false;
    }
  }
  
  /**
   * Vérifier si un type de média est activé
   */
  isMediaTypeEnabled(mediaType) {
    switch (mediaType) {
      case 'image':
        return this.config.images?.enabled !== false;
      case 'sticker':
        return this.config.stickers?.enabled !== false;
      case 'voice':
        return this.config.voiceMessages?.enabled !== false;
      case 'location':
        return this.config.locationSharing?.enabled !== false;
      case 'contact':
        return this.config.contacts?.enabled !== false;
      case 'document':
        return this.config.documents?.enabled !== false;
      default:
        return false;
    }
  }
  
  /**
   * Obtenir les paramètres d'un média
   */
  getMediaSettings(mediaType, category) {
    switch (mediaType) {
      case 'image':
        return this.config.images?.categories?.[category];
      case 'sticker':
        // Pour les stickers, category est le nom du set
        if (this.config.stickers?.sets?.[category]) {
          // Sélectionner un sticker aléatoire du set
          const stickers = this.config.stickers.sets[category];
          const randomIndex = Math.floor(Math.random() * stickers.length);
          return { path: stickers[randomIndex] };
        }
        return null;
      case 'voice':
        if (this.config.voiceMessages?.categories?.[category]) {
          // Sélectionner un message vocal aléatoire
          const voices = this.config.voiceMessages.categories[category];
          const randomIndex = Math.floor(Math.random() * voices.length);
          return { 
            path: path.join(this.config.voiceMessages.path, voices[randomIndex]) 
          };
        }
        return null;
      case 'location':
        return this.config.locationSharing?.locations?.[category];
      case 'contact':
        return this.config.contacts?.items?.[category];
      case 'document':
        return this.config.documents?.items?.[category];
      default:
        return null;
    }
  }
  
  /**
   * Mettre à jour l'historique des médias
   */
  updateMediaHistory(chatId, mediaType, category) {
    // Initialiser l'historique pour ce chat s'il n'existe pas
    if (!this.mediaHistory.has(chatId)) {
      this.mediaHistory.set(chatId, []);
    }
    
    const history = this.mediaHistory.get(chatId);
    
    // Ajouter le média à l'historique
    history.push({
      type: mediaType,
      category: category,
      timestamp: Date.now()
    });
    
    // Limiter la taille de l'historique
    const maxLength = this.config.globalSettings?.mediaHistoryLength || 10;
    if (history.length > maxLength) {
      history.splice(0, history.length - maxLength);
    }
    
    this.mediaHistory.set(chatId, history);
  }
  
  /**
   * Vérifier si un média a déjà été envoyé
   */
  hasMediaBeenSent(chatId, mediaType, category, timeframeMs = null) {
    if (!this.mediaHistory.has(chatId)) {
      return false;
    }
    
    const history = this.mediaHistory.get(chatId);
    const now = Date.now();
    
    // Filtrer selon le timeframe si spécifié
    const relevantHistory = timeframeMs 
      ? history.filter(item => now - item.timestamp <= timeframeMs)
      : history;
      
    // Vérifier si le média existe dans l'historique
    return relevantHistory.some(item => 
      item.type === mediaType && item.category === category
    );
  }
  
  /**
   * Traiter une séquence de médias
   */
  async processMediaSequence(client, chatId, sequenceName, context = {}) {
    const sequence = this.config.mediaSequences?.[sequenceName];
    
    if (!sequence) {
      console.error(`Séquence de médias non trouvée: ${sequenceName}`);
      return false;
    }
    
    let success = true;
    
    for (const item of sequence.sequence) {
      // Vérifier les conditions si elles existent
      if (item.conditions) {
        const conditionsMet = this.evaluateSequenceConditions(item.conditions, context);
        if (!conditionsMet) continue;
      }
      
      // Attendre le délai spécifié
      if (item.delayMs) {
        await new Promise(resolve => setTimeout(resolve, item.delayMs));
      }
      
      // Traiter selon le type
      try {
        switch (item.type) {
          case 'message':
            await client.sendMessage(chatId, item.content);
            break;
            
          case 'image':
          case 'sticker':
          case 'voice':
          case 'location':
          case 'contact':
          case 'document':
            await this.sendMedia(client, chatId, item.type, item.category, {
              caption: item.caption
            });
            break;
            
          default:
            console.warn(`Type d'élément de séquence inconnu: ${item.type}`);
        }
      } catch (error) {
        console.error(`Erreur lors du traitement de la séquence ${sequenceName}:`, error);
        success = false;
      }
    }
    
    return success;
  }
  
  /**
   * Évaluer les conditions d'une séquence
   */
  evaluateSequenceConditions(conditions, context) {
    // Simple évaluation des conditions
    for (const [key, value] of Object.entries(conditions)) {
      switch (key) {
        case 'userEngagement':
          if (value === 'high' && !context.highEngagement) {
            return false;
          }
          break;
          
        case 'serviceSelected':
          if (value === true && !context.userData?.serviceChoice) {
            return false;
          }
          break;
          
        case 'noPayment':
          if (value === true && context.userData?.paymentConfirmed) {
            return false;
          }
          break;
      }
    }
    
    return true;
  }
}

module.exports = MediaManager;