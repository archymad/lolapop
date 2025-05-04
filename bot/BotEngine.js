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

class BotEngine {
  constructor(options) {
    this.client = options.client;
    this.configurator = options.configurator;
    
    // Charger les configurations
    this.botConfig = this.configurator.getConfig('bot');
    this.personalityConfig = this.configurator.getConfig('personality');
    this.scenarioConfig = this.configurator.getConfig('scenario');
    this.aiConfig = this.configurator.getConfig('ai');
    this.mediaConfig = this.configurator.getConfig('media');
    
    // Initialiser les composants
    this.activeScenario = options.activeScenario || this.botConfig.scenario.active;
    this.activeProfile = options.activeProfile || this.botConfig.behavior.activeProfile;
    
    // Créer les gestionnaires
    this.sessionManager = new SessionManager(this.botConfig.session);
    this.personalityManager = new PersonalityManager(this.personalityConfig, this.activeProfile);
    this.scenarioManager = new ScenarioManager(this.scenarioConfig, this.activeScenario);
    this.nlpProcessor = new NLPProcessor(this.aiConfig, options.aiServerUrl);
    this.mediaManager = new MediaManager(this.mediaConfig);
    
    // Statistiques internes
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      activeUsers: 0,
      startTime: Date.now()
    };
  }
  
  /**
   * Appelé quand le client WhatsApp est prêt
   */
  onReady() {
    console.log(`Bot démarré avec profil: ${this.activeProfile}, scénario: ${this.activeScenario}`);
    this.startSessionCleanupTimer();
  }
  
  /**
   * Démarrer le timer de nettoyage des sessions inactives
   */
  startSessionCleanupTimer() {
    const cleanupInterval = this.botConfig.session.timeout.checkInterval || 3600000; // 1h par défaut
    
    setInterval(() => {
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
        console.log(`Sessions nettoyées: ${cleanedCount}`);
      }
      
      this.stats.activeUsers = this.sessionManager.getActiveSessions().size;
    }, cleanupInterval);
  }
  
  /**
   * Traiter un message entrant
   */
  async processIncomingMessage(message) {
    const chatId = message.from;
    const messageContent = message.body.trim();
    
    // Mettre à jour les statistiques
    this.stats.messagesReceived++;
    
    // Obtenir ou créer une session
    let session = this.sessionManager.getSession(chatId);
    if (!session) {
      session = this.sessionManager.createSession(chatId);
    }
    
    // Mettre à jour l'heure de dernière interaction
    session.lastInteractionTime = Date.now();
    
    // Analyser le message avec l'IA/NLP
    const analysisResult = await this.nlpProcessor.analyzeMessage(messageContent, {
      currentStep: session.currentStep,
      previousStep: session.previousStep,
      userData: session.userData
    });
    
    // Mettre à jour les données utilisateur
    this.updateUserData(session, analysisResult);
    
    // Obtenir l'étape actuelle
    const currentStep = this.scenarioManager.getStepById(session.currentStep);
    
    // Valider la réponse et déterminer la prochaine étape
    const validationResult = await this.scenarioManager.validateResponse(
      messageContent,
      analysisResult,
      session,
      currentStep
    );
    
    // Si la réponse est valide, passer à l'étape suivante
    if (validationResult.isValid) {
      const nextStep = validationResult.nextStep || currentStep.transitions.onSuccess;
      console.log(`Passage de l'étape ${session.currentStep} à ${nextStep}`);
      
      // Mettre à jour l'étape
      session.previousStep = session.currentStep;
      session.currentStep = nextStep;
      session.retryCount = 0;
      
      // Exécuter la nouvelle étape
      await this.executeStep(session);
    } 
    // Sinon, essayer à nouveau ou forcer la progression si configuré
    else if (validationResult.needsRetry) {
      session.retryCount++;
      
      // Vérifier si on a atteint le nombre max de tentatives
      const maxRetries = currentStep.validation?.maxRetries || 
                         this.scenarioConfig.scenarios[this.activeScenario].globalRules.maxRetries || 
                         2;
      
      if (session.retryCount <= maxRetries) {
        // Envoyer un message de relance
        await this.sendRetryMessage(session);
      } else {
        // Maximum de tentatives atteint, passer à l'étape suivante ou terminer
        const timeoutStep = currentStep.transitions.onTimeout;
        
        if (timeoutStep) {
          console.log(`Max retries reached, moving to ${timeoutStep}`);
          session.previousStep = session.currentStep;
          session.currentStep = timeoutStep;
          session.retryCount = 0;
          
          await this.executeStep(session);
        }
      }
    }
    // Forcer la progression si configuré
    else if (validationResult.forceProgress) {
      const nextStep = currentStep.transitions.onSuccess;
      console.log(`Forçage du passage à l'étape ${nextStep}`);
      
      session.previousStep = session.currentStep;
      session.currentStep = nextStep;
      session.retryCount = 0;
      
      await this.executeStep(session);
    }
    
    // Sauvegarder la session mise à jour
    this.sessionManager.updateSession(chatId, session);
  }
  
  /**
   * Mettre à jour les données utilisateur
   */
  updateUserData(session, analysisResult) {
    // Mettre à jour la localisation si détectée
    if (analysisResult.contains_location && analysisResult.location_name) {
      session.userData.location = analysisResult.location_name;
    }
    
    // Mettre à jour l'âge si détecté
    if (analysisResult.contains_age && analysisResult.age_value) {
      session.userData.age = analysisResult.age_value;
    }
    
    // Mettre à jour le choix de service
    if (analysisResult.service_type !== "none") {
      session.userData.serviceChoice = analysisResult.service_type;
    }
    
    // Mettre à jour les informations de planification
    if (analysisResult.scheduling_info) {
      session.userData.schedulingInfo = analysisResult.scheduling_info;
    }
  }
  
  /**
   * Exécuter une étape du scénario
   */
  async executeStep(session) {
    // Obtenir les détails de l'étape
    const step = this.scenarioManager.getStepById(session.currentStep);
    
    if (!step) {
      console.error(`Étape non trouvée: ${session.currentStep}`);
      return;
    }
    
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
  }
  
  /**
   * Envoyer un message de relance
   */
  async sendRetryMessage(session) {
    const step = this.scenarioManager.getStepById(session.currentStep);
    
    if (!step || !step.retryMessages || step.retryMessages.length === 0) {
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
  }
  
  /**
   * Personnaliser un message avec les données utilisateur
   */
  personalizeMessage(message, session) {
    if (!message) return "";
    
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
      console.error('Erreur lors de la recherche du village:', error);
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
      } else if (nextMessage.type === 'media') {
        await this.sendMedia(session.chatId, nextMessage);
        this.stats.messagesSent++;
      }
      
      // Continuer à traiter la file d'attente
      session.processingQueue = false;
      
      if (session.messageQueue.length > 0) {
        this.processMessageQueue(session);
      }
    } catch (error) {
      console.error('Erreur lors du traitement de la file d\'attente:', error);
      session.processingQueue = false;
      
      // En cas d'erreur, essayer de continuer avec le message suivant
      if (session.messageQueue.length > 0) {
        this.processMessageQueue(session);
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
        console.error(`Média non trouvé: ${mediaPath}`);
        return false;
      }
      
      // Créer un objet MessageMedia
      const media = MessageMedia.fromFilePath(mediaPath);
      
      // Envoyer le média
      await this.client.sendMessage(chatId, media, {
        caption: mediaMessage.caption
      });
      
      return true;
    } catch (error) {
      console.error('Erreur lors de l\'envoi du média:', error);
      return false;
    }
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
}

module.exports = BotEngine;