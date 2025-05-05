/**
 * Moteur principal du bot avec gestion avancée des configurations
 */

const path = require('path');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');
const PersonalityManager = require('./PersonalityManager');
const ScenarioManager = require('./ScenarioManager');
const NLPProcessor = require('./NLPProcessor');
const SessionManager = require('./SessionManager');
const MediaManager = require('./MediaManager');
const { getLogger } = require('../utils/logger');

class BotEngine {
  constructor(options) {
    this.client = options.client;
    this.configurator = options.configurator;
    
    // Initialiser le logger
    this.logger = options.logger || getLogger({
      logToFile: true,
      logDir: './logs'
    });
    
    // Charger les configurations
    try {
      this.loadConfigurations();
      this.initializeComponents(options);
      this.setupErrorHandlers();
      
      // Statistiques internes
      this.stats = {
        messagesReceived: 0,
        messagesSent: 0,
        activeUsers: 0,
        startTime: Date.now(),
        errors: 0,
        nlpErrors: 0,
        mediaErrors: 0
      };
      
      this.logger.info('BotEngine initialisé avec succès', {
        profile: this.activeProfile,
        scenario: this.activeScenario
      });
    } catch (error) {
      this.logger.error('Erreur lors de l\'initialisation du BotEngine', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Charger les configurations
   */
  loadConfigurations() {
    try {
      this.botConfig = this.configurator.getConfig('bot');
      this.personalityConfig = this.configurator.getConfig('personality');
      this.scenarioConfig = this.configurator.getConfig('scenario');
      this.aiConfig = this.configurator.getConfig('ai');
      this.mediaConfig = this.configurator.getConfig('media');
      
      this.logger.debug('Configurations chargées', {
        bot: !!this.botConfig,
        personality: !!this.personalityConfig,
        scenario: !!this.scenarioConfig,
        ai: !!this.aiConfig,
        media: !!this.mediaConfig
      });
    } catch (error) {
      this.logger.error('Erreur lors du chargement des configurations', {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Initialiser les composants
   */
  initializeComponents(options) {
    try {
      // Initialiser les scénarios et profils
      this.activeScenario = options.activeScenario || this.botConfig.scenario.active;
      this.activeProfile = options.activeProfile || this.botConfig.behavior.activeProfile;
      
      // Créer les gestionnaires
      this.sessionManager = new SessionManager(this.botConfig.session);
      this.personalityManager = new PersonalityManager(this.personalityConfig, this.activeProfile);
      this.scenarioManager = new ScenarioManager(this.scenarioConfig, this.activeScenario);
      this.nlpProcessor = new NLPProcessor(this.aiConfig, options.aiServerUrl);
      this.mediaManager = new MediaManager(this.mediaConfig);
      
      this.logger.info('Composants initialisés', {
        activeProfile: this.activeProfile,
        activeScenario: this.activeScenario
      });
    } catch (error) {
      this.logger.error('Erreur lors de l\'initialisation des composants', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Configurer les gestionnaires d'erreurs
   */
  setupErrorHandlers() {
    // Gestionnaire d'erreur global pour le client WhatsApp
    if (this.client) {
      this.client.on('error', (error) => {
        this.stats.errors++;
        this.logger.error('Erreur du client WhatsApp', {
          error: error.message,
          stack: error.stack
        });
      });
      
      this.client.on('disconnected', (reason) => {
        this.logger.warn('Client WhatsApp déconnecté', { reason });
      });
    }
    
    // Gestionnaire d'erreur global pour les promesses non gérées
    process.on('unhandledRejection', (reason, promise) => {
      this.stats.errors++;
      this.logger.error('Promesse rejetée non gérée dans BotEngine', {
        reason: reason,
        promise: promise
      });
    });
  }
  
  /**
   * Appelé quand le client WhatsApp est prêt
   */
  onReady() {
    this.logger.info('BotEngine prêt', {
      profile: this.activeProfile,
      scenario: this.activeScenario,
      sessions: this.sessionManager.getActiveSessions().size
    });
    this.startSessionCleanupTimer();
  }
  
  /**
   * Démarrer le timer de nettoyage des sessions inactives
   */
  startSessionCleanupTimer() {
    const cleanupInterval = this.botConfig.session.timeout.checkInterval || 3600000; // 1h par défaut
    
    this.cleanupIntervalId = setInterval(() => {
      try {
        const inactiveTimeout = this.botConfig.session.timeout.inactive;
        const now = Date.now();
        let cleanedCount = 0;
        
        this.sessionManager.getAllSessions().forEach((session, chatId) => {
          if (now - session.lastInteractionTime > inactiveTimeout) {
            this.sessionManager.removeSession(chatId);
            cleanedCount++;
          }
        });
        
        if (cleanedCount > 0) {
          this.logger.info('Sessions inactives nettoyées', { count: cleanedCount });
        }
        
        this.stats.activeUsers = this.sessionManager.getActiveSessions().size;
        
        // Log les statistiques périodiques
        this.logStats();
      } catch (error) {
        this.logger.error('Erreur lors du nettoyage des sessions', {
          error: error.message
        });
      }
    }, cleanupInterval);
  }
  
  /**
   * Traiter un message entrant
   */
  async processIncomingMessage(message) {
    const chatId = message.from;
    const messageContent = message.body.trim();
    
    try {
      // Mettre à jour les statistiques
      this.stats.messagesReceived++;
      
      // Obtenir ou créer une session
      let session = this.sessionManager.getSession(chatId);
      if (!session) {
        // Obtenir l'étape initiale du scénario actif
        const initialStep = this.scenarioManager.getInitialStep();
        session = this.sessionManager.createSession(chatId, initialStep);
        this.logger.info('Nouvelle session créée', {
          chatId: chatId.split('@')[0],
          initialStep: initialStep,
          totalSessions: this.sessionManager.getActiveSessions().size
        });
      }
      
      // Mettre à jour l'heure de dernière interaction
      session.lastInteractionTime = Date.now();
      
      this.logger.debug('Message entrant', {
        chatId: chatId.split('@')[0],
        messageLength: messageContent.length,
        hasMedia: message.hasMedia,
        currentStep: session.currentStep
      });
      
      // Analyser le message avec l'IA/NLP
      let analysisResult = null;
      try {
        analysisResult = await this.nlpProcessor.analyzeMessage(messageContent, {
          currentStep: session.currentStep,
          previousStep: session.previousStep,
          userData: session.userData
        });
        
        this.logger.debug('Analyse NLP complétée', {
          intent: analysisResult.intent,
          hasLocation: analysisResult.contains_location,
          hasAge: analysisResult.contains_age
        });
      } catch (nlpError) {
        this.stats.nlpErrors++;
        this.logger.error('Erreur NLP', {
          error: nlpError.message,
          messageContent: messageContent.substring(0, 50) + '...'
        });
        
        // Utiliser une réponse par défaut en cas d'erreur NLP
        analysisResult = {
          intent: "unclear",
          contains_location: false,
          contains_age: false,
          service_type: "none"
        };
      }
      
      // Mettre à jour les données utilisateur
      this.updateUserData(session, analysisResult);
      
      // Obtenir l'étape actuelle
      const currentStep = this.scenarioManager.getStepById(session.currentStep);
      if (!currentStep) {
        throw new Error(`Étape non trouvée: ${session.currentStep}`);
      }
      
      // Valider la réponse et déterminer la prochaine étape
      const validationResult = await this.scenarioManager.validateResponse(
        messageContent,
        analysisResult,
        session,
        currentStep
      );
      
      // Gérer la transition d'étape
      await this.handleStepTransition(session, validationResult, currentStep);
      
    } catch (error) {
      this.stats.errors++;
      this.logger.error('Erreur lors du traitement du message', {
        error: error.message,
        stack: error.stack,
        chatId: chatId.split('@')[0],
        currentStep: session?.currentStep
      });
      
      // Envoyer un message d'erreur générique à l'utilisateur
      try {
        await this.client.sendMessage(chatId, 
          "Désolée, j'ai rencontré un petit problème... 😅 On peut réessayer ?"
        );
      } catch (sendError) {
        this.logger.error('Impossible d\'envoyer le message d\'erreur', {
          error: sendError.message
        });
      }
    }
  }
  
  /**
   * Gérer la transition d'étape
   */
  async handleStepTransition(session, validationResult, currentStep) {
    try {
      if (validationResult.isValid) {
        const nextStep = validationResult.nextStep || currentStep.transitions.onSuccess;
        this.logger.info('Transition d\'étape', {
          from: session.currentStep,
          to: nextStep,
          retryCount: session.retryCount
        });
        
        session.previousStep = session.currentStep;
        session.currentStep = nextStep;
        session.retryCount = 0;
        
        await this.executeStep(session);
      } else if (validationResult.needsRetry) {
        session.retryCount++;
        
        const maxRetries = currentStep.validation?.maxRetries || 
                           this.scenarioConfig.scenarios[this.activeScenario].globalRules.maxRetries || 
                           2;
        
        if (session.retryCount <= maxRetries) {
          this.logger.info('Nouvelle tentative nécessaire', {
            currentStep: session.currentStep,
            retryCount: session.retryCount,
            maxRetries
          });
          await this.sendRetryMessage(session);
        } else {
          this.logger.warn('Nombre maximum de tentatives atteint', {
            currentStep: session.currentStep,
            maxRetries
          });
          
          const timeoutStep = currentStep.transitions.onTimeout;
          if (timeoutStep) {
            session.previousStep = session.currentStep;
            session.currentStep = timeoutStep;
            session.retryCount = 0;
            await this.executeStep(session);
          }
        }
      } else if (validationResult.forceProgress) {
        const nextStep = currentStep.transitions.onSuccess;
        this.logger.info('Forçage de la progression', {
          from: session.currentStep,
          to: nextStep
        });
        
        session.previousStep = session.currentStep;
        session.currentStep = nextStep;
        session.retryCount = 0;
        
        await this.executeStep(session);
      }
      
      // Sauvegarder la session mise à jour
      this.sessionManager.updateSession(session.chatId, session);
      
    } catch (error) {
      this.logger.error('Erreur lors de la transition d\'étape', {
        error: error.message,
        currentStep: session.currentStep,
        validationResult
      });
      throw error;
    }
  }
  
  /**
   * Mettre à jour les données utilisateur
   */
  updateUserData(session, analysisResult) {
    try {
      // Mettre à jour la localisation si détectée
      if (analysisResult.contains_location && analysisResult.location_name) {
        session.userData.location = analysisResult.location_name;
        this.logger.info('Localisation détectée', {
          location: analysisResult.location_name,
          chatId: session.chatId.split('@')[0]
        });
      }
      
      // Mettre à jour l'âge si détecté
      if (analysisResult.contains_age && analysisResult.age_value) {
        session.userData.age = analysisResult.age_value;
        this.logger.info('Âge détecté', {
          age: analysisResult.age_value,
          chatId: session.chatId.split('@')[0]
        });
      }
      
      // Mettre à jour le choix de service
      if (analysisResult.service_type !== "none") {
        session.userData.serviceChoice = analysisResult.service_type;
        this.logger.info('Service choisi', {
          service: analysisResult.service_type,
          chatId: session.chatId.split('@')[0]
        });
      }
      
      // Mettre à jour les informations de planification
      if (analysisResult.scheduling_info) {
        session.userData.schedulingInfo = analysisResult.scheduling_info;
        this.logger.debug('Informations de planification mises à jour', {
          schedulingInfo: analysisResult.scheduling_info
        });
      }
    } catch (error) {
      this.logger.error('Erreur lors de la mise à jour des données utilisateur', {
        error: error.message,
        analysisResult
      });
    }
  }
  
  /**
   * Exécuter une étape du scénario
   */
  async executeStep(session) {
    try {
      // Obtenir les détails de l'étape
      const step = this.scenarioManager.getStepById(session.currentStep);
      
      if (!step) {
        throw new Error(`Étape non trouvée: ${session.currentStep}`);
      }
      
      this.logger.debug('Exécution de l\'étape', {
        stepId: session.currentStep,
        hasMessages: !!step.messages,
        messageCount: step.messages?.length
      });
      
      // Ajouter les messages à la file d'attente
      for (let i = 0; i < step.messages.length; i++) {
        const message = step.messages[i];
        
        // Sélectionner une variation basée sur la personnalité
        const messageContent = this.personalityManager.selectMessageVariation(
          message.content,
          message.variations
        );
        
        // Personnaliser le message
        const personalizedMessage = this.personalizeMessage(messageContent, session);
        
        // Calculer le délai
        let delay = 3000; // Délai par défaut
        
        if (message.delayMs) {
          if (typeof message.delayMs === 'object') {
            // Délai aléatoire entre min et max
            delay = message.delayMs.min + Math.floor(Math.random() * (message.delayMs.max - message.delayMs.min));
          } else {
            delay = message.delayMs;
          }
        }
        
        // Délai cumulatif pour les messages suivants
        const cumulativeDelay = i > 0 ? delay : 0;
        
        // Ajouter à la file d'attente de la session
        session.addToQueue({
          type: 'text',
          content: personalizedMessage,
          delay: delay,
          cumulativeDelay: cumulativeDelay
        });
      }
      
      // Ajouter les médias à la file d'attente si nécessaire
      if (step.mediaMessages && step.mediaMessages.length > 0) {
        for (const mediaMessage of step.mediaMessages) {
          const delay = mediaMessage.delayMs?.min || mediaMessage.delayMs || 5000;
          
          session.addToQueue({
            type: 'media',
            mediaType: mediaMessage.type,
            source: mediaMessage.source,
            caption: this.personalityManager.selectMessageVariation(
              mediaMessage.caption?.text,
              mediaMessage.caption?.variations
            ),
            delay: delay
          });
        }
      }
      
      // Démarrer le traitement de la file d'attente
      if (!session.processingQueue) {
        this.processMessageQueue(session);
      }
      
    } catch (error) {
      this.logger.error('Erreur lors de l\'exécution de l\'étape', {
        error: error.message,
        step: session.currentStep
      });
      throw error;
    }
  }
  
  /**
   * Envoyer un message de relance
   */
  async sendRetryMessage(session) {
    try {
      const step = this.scenarioManager.getStepById(session.currentStep);
      
      if (!step || !step.retryMessages || step.retryMessages.length === 0) {
        this.logger.warn('Aucun message de relance disponible', {
          step: session.currentStep
        });
        return;
      }
      
      // Sélectionner le message de relance approprié
      const retryIndex = Math.min(session.retryCount - 1, step.retryMessages.length - 1);
      const retryMessage = step.retryMessages[retryIndex];
      
      // Sélectionner une variation et personnaliser
      const messageContent = this.personalityManager.selectMessageVariation(
        retryMessage.content,
        retryMessage.variations
      );
      const personalizedMessage = this.personalizeMessage(messageContent, session);
      
      // Calculer le délai
      let delay = 5000; // Délai par défaut
      
      if (retryMessage.delayMs) {
        if (typeof retryMessage.delayMs === 'object') {
          delay = retryMessage.delayMs.min + 
                  Math.floor(Math.random() * (retryMessage.delayMs.max - retryMessage.delayMs.min));
        } else {
          delay = retryMessage.delayMs;
        }
      }
      
      // Ajouter à la file d'attente
      session.addToQueue({
        type: 'text',
        content: personalizedMessage,
        delay: delay
      });
      
      // Démarrer le traitement de la file si nécessaire
      if (!session.processingQueue) {
        this.processMessageQueue(session);
      }
      
      this.logger.debug('Message de relance programmé', {
        retryCount: session.retryCount,
        delay: delay
      });
      
    } catch (error) {
      this.logger.error('Erreur lors de l\'envoi du message de relance', {
        error: error.message,
        step: session.currentStep
      });
    }
  }
  
  /**
   * Personnaliser un message avec les données utilisateur
   */
  personalizeMessage(message, session) {
    if (!message) return "";
    
    try {
      let personalizedMessage = message;
      
      // Remplacer les marqueurs par les données utilisateur
      if (personalizedMessage.includes('{{location}}') && session.userData.location) {
        personalizedMessage = personalizedMessage.replace('{{location}}', session.userData.location);
      }
      
      if (personalizedMessage.includes('{{nearby_village}}') && session.userData.location) {
        const nearbyVillage = this.findNearbyVillage(session.userData.location);
        personalizedMessage = personalizedMessage.replace('{{nearby_village}}', nearbyVillage || "près d'ici");
      }
      
      if (personalizedMessage.includes('{{age}}') && session.userData.age) {
        personalizedMessage = personalizedMessage.replace('{{age}}', session.userData.age);
      }
      
      // Appliquer la personnalité (typos, emoji, etc.)
      return this.personalityManager.applyPersonalityToMessage(personalizedMessage);
      
    } catch (error) {
      this.logger.error('Erreur lors de la personnalisation du message', {
        error: error.message,
        message: message.substring(0, 50) + '...'
      });
      return message; // Retourner le message original en cas d'erreur
    }
  }
  
  /**
   * Trouver un village proche d'une ville
   */
  findNearbyVillage(location) {
    try {
      // Charger les données géographiques
      const geoConfig = this.configurator.getConfig('geo');
      
      // Vérifier si la localisation est directement une clé
      if (geoConfig[location] && geoConfig[location].length > 0) {
        const villages = geoConfig[location];
        return villages[Math.floor(Math.random() * villages.length)];
      }
      
      // Chercher si la localisation est un village référencé
      for (const city in geoConfig) {
        if (geoConfig[city].includes(location)) {
          // Si c'est le cas, retourner un autre village de la même ville
          const otherVillages = geoConfig[city].filter(v => v !== location);
          if (otherVillages.length > 0) {
            return otherVillages[Math.floor(Math.random() * otherVillages.length)];
          }
        }
      }
      
      // Fallback: retourner un village aléatoire
      const allCities = Object.keys(geoConfig);
      if (allCities.length > 0) {
        const randomCity = allCities[Math.floor(Math.random() * allCities.length)];
        const villages = geoConfig[randomCity];
        return villages[Math.floor(Math.random() * villages.length)];
      }
    } catch (error) {
      this.logger.error('Erreur lors de la recherche du village', {
        error: error.message,
        location
      });
    }
    
    return "un village pas loin";
  }
  
  /**
   * Traiter la file d'attente de messages
   */
  async processMessageQueue(session) {
    if (session.messageQueue.length === 0 || session.processingQueue) {
      return;
    }
    
    session.processingQueue = true;
    
    const nextMessage = session.messageQueue.shift();
    
    try {
      // Attendre le délai spécifié
      await new Promise(resolve => setTimeout(resolve, nextMessage.delay));
      
      // Simuler la frappe si activée
      if (this.botConfig.typing && this.botConfig.typing.enabled) {
        const typingDelay = this.calculateTypingDelay(nextMessage.content);
        await this.client.sendPresenceAvailable(session.chatId);
        await this.client.sendMessage(session.chatId, nextMessage.content, {sendSeen: true});
        await new Promise(resolve => setTimeout(resolve, typingDelay));
      }
      
      // Envoyer le message selon son type
      if (nextMessage.type === 'text') {
        await this.client.sendMessage(session.chatId, nextMessage.content);
        this.stats.messagesSent++;
        this.logger.debug('Message texte envoyé', {
          chatId: session.chatId.split('@')[0],
          messageLength: nextMessage.content.length
        });
      } else if (nextMessage.type === 'media') {
        await this.sendMedia(session.chatId, nextMessage);
        this.stats.messagesSent++;
        this.logger.debug('Média envoyé', {
          chatId: session.chatId.split('@')[0],
          mediaType: nextMessage.mediaType
        });
      }
      
      // Continuer à traiter la file d'attente
      session.processingQueue = false;
      
      if (session.messageQueue.length > 0) {
        this.processMessageQueue(session);
      }
    } catch (error) {
      this.stats.errors++;
      this.logger.error('Erreur lors du traitement de la file d\'attente', {
        error: error.message,
        messageType: nextMessage.type,
        chatId: session.chatId.split('@')[0]
      });
      session.processingQueue = false;
      
      // En cas d'erreur, essayer de continuer avec le message suivant
      if (session.messageQueue.length > 0) {
        setTimeout(() => this.processMessageQueue(session), 3000);
      }
    }
  }
  
  /**
   * Calculer le délai de frappe basé sur le contenu
   */
  calculateTypingDelay(content) {
    if (!content) return 0;
    
    const length = content.length;
    const charsPerMinute = this.botConfig.typing.speedCharsPerMinute || 400;
    const baseDelay = (length / charsPerMinute) * 60 * 1000;
    
    // Ajouter une variation aléatoire
    const variationFactor = 0.2; // 20% de variation
    const variation = baseDelay * variationFactor * (Math.random() * 2 - 1);
    
    return Math.max(1000, baseDelay + variation);
  }
  
  /**
   * Envoyer un média à un utilisateur
   */
  async sendMedia(chatId, mediaMessage) {
    try {
      const mediaPath = mediaMessage.source;
      
      if (!fs.existsSync(mediaPath)) {
        this.stats.mediaErrors++;
        this.logger.error('Média non trouvé', {
          path: mediaPath,
          mediaType: mediaMessage.mediaType
        });
        return false;
      }
      
      // Créer un objet MessageMedia
      const media = MessageMedia.fromFilePath(mediaPath);
      
      // Envoyer le média
      await this.client.sendMessage(chatId, media, {
        caption: mediaMessage.caption
      });
      
      this.logger.debug('Média envoyé avec succès', {
        mediaType: mediaMessage.mediaType,
        hasCaption: !!mediaMessage.caption
      });
      
      return true;
    } catch (error) {
      this.stats.mediaErrors++;
      this.logger.error('Erreur lors de l\'envoi du média', {
        error: error.message,
        mediaType: mediaMessage.mediaType,
        chatId: chatId.split('@')[0]
      });
      return false;
    }
  }
  
  /**
   * Logger les statistiques
   */
  logStats() {
    const uptime = Date.now() - this.stats.startTime;
    
    this.logger.info('Statistiques du bot', {
      uptime: Math.floor(uptime / 1000) + 's',
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      activeUsers: this.stats.activeUsers,
      errors: this.stats.errors,
      nlpErrors: this.stats.nlpErrors,
      mediaErrors: this.stats.mediaErrors
    });
  }
  
  /**
   * Obtenir les statistiques du bot
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    return {
      ...this.stats,
      uptime,
      activeUsers: this.sessionManager.getActiveSessions().size
    };
  }
  
  /**
   * Arrêter proprement le BotEngine
   */
  async shutdown() {
    try {
      this.logger.info('Arrêt du BotEngine...');
      
      // Arrêter le timer de nettoyage
      if (this.cleanupIntervalId) {
        clearInterval(this.cleanupIntervalId);
      }
      
      // Sauvegarder les sessions si nécessaire
      if (this.sessionManager && this.sessionManager.saveSessions) {
        this.sessionManager.saveSessions();
      }
      
      // Logger les statistiques finales
      this.logStats();
      
      this.logger.info('BotEngine arrêté avec succès');
    } catch (error) {
      this.logger.error('Erreur lors de l\'arrêt du BotEngine', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = BotEngine;
