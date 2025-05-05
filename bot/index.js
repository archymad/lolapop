/**
 * Point d'entrée principal du bot WhatsApp
 * Ce script initialise le client WhatsApp et gère les interactions
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const configurator = require('../configurator');
const { loadStepProcessor } = require('./stepProcessor');
const { getLogger } = require('../utils/logger');
const MediaManager = require('./MediaManager');

// Variable globale pour stocker l'instance du client
let client = null;
let sessions = new Map();
let isRunning = false;
let logger = null;

// Fonction pour définir le logger
function setLogger(customLogger) {
  logger = customLogger;
}

// Fonction pour obtenir le logger
function getLoggerInstance() {
  if (!logger) {
    logger = getLogger({
      logToFile: true,
      logDir: './logs'
    });
  }
  return logger;
}

// Fonction d'initialisation asynchrone
async function initializeBot() {
  const log = getLoggerInstance();
  
  if (isRunning) {
    log.warn('Le bot est déjà en cours d\'exécution');
    return { client, sessions };
  }

  log.info('Initialisation du bot conversationnel...');
  
  try {
    // Initialiser le configurateur
    await configurator.initialize();
    log.info('Configurateur initialisé');
    
    // Récupérer les configurations
    const botConfig = configurator.getConfig('bot');
    log.info('Configuration du bot chargée', {
      profile: botConfig.behavior?.activeProfile,
      scenario: botConfig.scenario?.active
    });
    
    // Initialiser le processeur d'étapes avec le configurateur
    const stepProcessor = loadStepProcessor(configurator);
    log.info('Processeur d\'étapes initialisé');
    
    // Initialiser le gestionnaire de médias
    const mediaConfig = configurator.getConfig('media');
    const mediaManager = new MediaManager(mediaConfig);
    log.info('Gestionnaire de médias initialisé');
    
    // Configuration du client WhatsApp
    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: botConfig.messaging?.platforms?.whatsapp?.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });
    
    // Créer une classe Session pour gérer les conversations
    class Session {
      constructor(chatId) {
        this.chatId = chatId;
        // Utiliser l'étape initiale du scénario actif
        this.currentStep = botConfig.scenario?.startStep || 'step_1_source';
        this.previousStep = null;
        this.userData = {};
        this.lastActivity = Date.now();
      }
    }
    
    // Événements WhatsApp
    client.on('qr', (qr) => {
      log.info('QR Code généré - En attente de scan');
      qrcode.generate(qr, { small: true });
      console.log('Scannez ce QR Code avec WhatsApp pour vous connecter');
    });
    
    client.on('ready', () => {
      log.info('Client WhatsApp prêt et connecté', {
        profile: botConfig.behavior?.activeProfile || 'default',
        scenario: botConfig.scenario?.active || 'lola_scenario'
      });
      isRunning = true;
    });
    
    client.on('authenticated', () => {
      log.info('Authentification WhatsApp réussie');
    });
    
    client.on('auth_failure', (message) => {
      log.error('Échec de l\'authentification WhatsApp', { message });
    });
    
    client.on('disconnected', (reason) => {
      log.warn('Déconnexion de WhatsApp', { reason });
      isRunning = false;
    });
    
    client.on('message', async (message) => {
      try {
        // Ignorer les messages de statut et les broadcasts
        if (message.isStatus || message.from === 'status@broadcast') return;
        
        const chatId = message.from;
        const messageContent = message.body.trim();
        
        log.info('Message reçu', {
          chatId: chatId.split('@')[0], // Masquer le domaine pour la confidentialité
          messageLength: messageContent.length,
          hasMedia: message.hasMedia
        });
        
        // Obtenir ou créer une session pour ce chat
        if (!sessions.has(chatId)) {
          sessions.set(chatId, new Session(chatId));
          log.info('Nouvelle session créée', { chatId: chatId.split('@')[0] });
        }
        const session = sessions.get(chatId);
        session.lastActivity = Date.now();
        
        // Initialiser le compteur de photos si nécessaire
        if (!session.photoRequestCount) {
          session.photoRequestCount = 0;
        }
        
        // Vérifier si l'utilisateur demande une photo
        const askingForPhoto = messageContent.toLowerCase().includes('photo') || 
                              messageContent.toLowerCase().includes('pic') || 
                              messageContent.toLowerCase().includes('image') || 
                              messageContent.toLowerCase().includes('selfie') ||
                              messageContent.toLowerCase().includes('montre toi');
        
        // Traiter la demande de photo si détectée
        if (askingForPhoto) {
          // Vérifier si c'est la première demande
          if (session.photoRequestCount === 0) {
            session.photoRequestCount++;
            log.info('Première demande de photo détectée', { chatId: chatId.split('@')[0] });
            
            try {
              // Chemin vers l'image
              const photoPath = path.join(__dirname, '..', 'assets', 'photo_ask.jpg');
              
              // Vérifier si le fichier existe
              if (fs.existsSync(photoPath)) {
                // Charger l'image
                const media = MessageMedia.fromFilePath(photoPath);
                
              // Forcer l'envoi en mode vue unique en utilisant une méthode interne de la bibliothèque
              try {
                // On doit envoyer le message à WhatsApp d'une manière spécifique pour forcer le mode vue unique
                const chat = await client.getChatById(chatId);
                
                // Cette méthode est un peu plus complexe mais garantit le mode vue unique
                await chat.sendMessage(media, {
                  caption: "Rien que pour toi... 💋",
                  isViewOnce: true, // Assurons-nous d'activer cette option également
                  sendMediaAsViewOnce: true, // Option alternative qui peut être nécessaire
                  viewOnce: true // Conserver l'option originale aussi
                });
                
                log.info('Photo envoyée en mode vue unique forcé');
              } catch (sendError) {
                log.error('Erreur avec la méthode forcée, tentative alternative', { error: sendError.message });
                
                // Méthode alternative - dernier recours
                const viewOnceOptions = {
                  caption: "Rien que pour toi... 💋", 
                  sendMediaAsSticker: false,
                  viewOnce: true,
                  isViewOnce: true
                };
                
                await client.sendMessage(chatId, media, viewOnceOptions);
              }
                
                log.info('Photo sur demande envoyée', { chatId: chatId.split('@')[0] });
                return; // Ne pas traiter davantage ce message
              } else {
                log.error('Photo sur demande non trouvée', { path: photoPath });
              }
            } catch (photoError) {
              log.error('Erreur lors de l\'envoi de la photo sur demande', { 
                error: photoError.message,
                chatId: chatId.split('@')[0]
              });
            }
          } else {
            // C'est au moins la deuxième demande, envoyer un message de refus
            setTimeout(() => {
              client.sendMessage(chatId, "C'est pas gratuit haha 😏").then(() => {
                log.info('Message de refus pour photo supplémentaire envoyé', {
                  chatId: chatId.split('@')[0]
                });
              });
            }, 1000);
            return; // Ne pas traiter davantage ce message
          }
        }
        
        // Analyser le message avec NLP
        try {
          log.debug('Envoi du message au serveur NLP pour analyse');
          
          const response = await fetch(`${process.env.NLP_SERVER_URL || 'http://localhost:5000'}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageContent })
          });
          
          if (!response.ok) {
            throw new Error(`Request failed with status code ${response.status}`);
          }
          
          const analysisResult = await response.json();
          log.debug('Résultat de l\'analyse NLP', { analysisResult });
          
          // Mettre à jour les données utilisateur
          if (analysisResult.contains_location && analysisResult.location_name) {
            session.userData.location = analysisResult.location_name;
            log.info('Localisation détectée', { location: analysisResult.location_name });
          }
          if (analysisResult.contains_age && analysisResult.age_value) {
            session.userData.age = analysisResult.age_value;
            log.info('Âge détecté', { age: analysisResult.age_value });
          }
          
          // Obtenir l'étape actuelle
          const currentStep = stepProcessor.getStepById(session.currentStep);
          
          // Définir le scénario actif une fois pour toutes
          const activeScenario = botConfig.scenario.active;
          log.info('Scénario actif:', { activeScenario });
          
          // Vérifier si c'est le premier message de l'utilisateur (début de conversation)
          const isNewConversation = session.currentStep === botConfig.scenario.startStep;
          
          // Détecter une large gamme de salutations possibles
          const salutationPatterns = [
            /^hey$/i, /^yo$/i, /^salut$/i, /^bonjour$/i, /^hello$/i, /^hi$/i, /^coucou$/i,
            /^hola$/i, /^holla$/i, /^holla holla$/i, /^bonsoir$/i, /^slt$/i, /^bjr$/i,
            /^bonjour mademoiselle$/i, /^bonjour madame$/i, /^salut belle$/i,
            /^cc$/i, /^coucou toi$/i, /^comment va$/i, /^ça va$/i
          ];
          
          // Vérifier si le message est une salutation
          const isSalutation = salutationPatterns.some(pattern => pattern.test(messageContent));
          
          // Si c'est une salutation ou le premier message, envoyer le message de bienvenue
          if (isSalutation || (!analysisResult.intent && isNewConversation)) {
            // Pour les messages de type salutation, on réinitialise la session et on envoie le premier message
            session.currentStep = botConfig.scenario.startStep || 'step_1_source';
            
            // Envoyer directement le premier message du scénario
            const welcomeStep = stepProcessor.getStepById(session.currentStep);
            if (welcomeStep && welcomeStep.messages && welcomeStep.messages.length > 0) {
              setTimeout(async () => {
                const content = welcomeStep.messages[0].content;
                await simulateTypingAndSend(chatId, content, {
                  typingSpeed: 50, // Légèrement plus rapide pour le premier message
                  minTypingTime: 1500
                }).then(() => {
                  log.info('Message de bienvenue envoyé avec simulation de frappe', {
                    chatId: chatId.split('@')[0]
                  });
                });
              }, 1000);
              return; // Ne pas traiter davantage ce message
            }
          }
          
          // Passer à l'étape suivante (avec gestion des transitions complexes)
          let nextStep;
          let directResponse = null;
          
          // Détection de l'étape actuelle
          log.info('Session actuelle:', { 
            currentStep: session.currentStep,
            scénario: activeScenario,
            userData: JSON.stringify(session.userData)
          });
          
          // Vérifier si c'est l'étape de demande de plateforme
          if (session.currentStep === 'step_1_source') {
            if (messageContent.toLowerCase().includes('nous') && 
                messageContent.toLowerCase().includes('libertins')) {
              // Si l'utilisateur mentionne la plateforme attendue, passer à l'étape de localisation
              nextStep = 'step_2_location';
            } else {
              // Sinon, envoyer le message de fallback et rester à cette étape
              directResponse = "Alors... quelle plateforme exactement ? 😘";
              nextStep = session.currentStep;
            }
          }
          // Vérifier si c'est l'étape de localisation
          else if (session.currentStep === 'step_2_location') {
            // Liste des régions de France
            const regions = [
              'alsace', 'aquitaine', 'auvergne', 'bourgogne', 'bretagne', 'centre', 
              'champagne', 'corse', 'franche-comté', 'île-de-france', 'ile-de-france', 
              'languedoc', 'limousin', 'lorraine', 'midi-pyrénées', 'nord-pas-de-calais', 
              'normandie', 'pays de la loire', 'picardie', 'poitou-charentes', 
              'provence', 'rhône-alpes', 'rhone-alpes', 'grand est', 'hauts-de-france',
              'nouvelle-aquitaine', 'occitanie', 'auvergne-rhône-alpes', 'paca'
            ];
            
            const normalizedLocation = messageContent.toLowerCase().trim();
            
            // Vérifier si l'utilisateur a entré une région
            const isRegion = regions.some(region => 
              normalizedLocation === region || 
              normalizedLocation.includes(region)
            );
            
            if (isRegion) {
              // Si c'est une région, demander une ville précise
              directResponse = "Non je te demande ta ville mdrrr 😅 pas ta région";
              nextStep = session.currentStep; // Rester sur cette étape
            } else {
              // Vérifier si la ville est connue ou non
              const geoConfig = configurator.getConfig('geo');
              const locations = geoConfig.locations || {};
              
              // Vérifier si la ville est connue
              let cityIsKnown = false;
              for (const city in locations) {
                if (city.toLowerCase() === normalizedLocation) {
                  cityIsKnown = true;
                  break;
                }
                
                // Vérifier aussi parmi les villages
                for (const village of (locations[city].villages || [])) {
                  if (village.toLowerCase() === normalizedLocation) {
                    cityIsKnown = true;
                    break;
                  }
                }
                
                if (cityIsKnown) break;
              }
              
              if (cityIsKnown) {
                // Si l'utilisateur a donné une ville connue, passer à l'étape suivante
                nextStep = 'step_2_response';
                
                // Sauvegarder la localisation
                session.userData.location = messageContent;
                
                // Si c'est une ville connue (pas un village), l'enregistrer comme dernière ville connue dans stepProcessor
                for (const city in locations) {
                  if (city.toLowerCase() === normalizedLocation) {
                    stepProcessor.lastKnownCity = city;
                    break;
                  }
                }
              } else {
                // Si la ville n'est pas connue, demander une grande ville proche
                directResponse = "Je connais pas... c'est proche de quelle grande ville ? 😘";
                nextStep = session.currentStep; // Rester sur cette étape
              }
            }
          }
          // Vérifier si c'est l'étape après avoir donné la localisation
          else if (session.currentStep === 'step_2_response') {
            // Passer à l'étape de l'âge
            nextStep = 'step_3_age';
            
            // Si la localisation n'a pas été enregistrée, utiliser une valeur par défaut
            if (!session.userData.location) {
              session.userData.location = "dans le coin";
            }
          }
          // Vérifier si c'est l'étape de demande d'âge
          else if (session.currentStep === 'step_3_age') {
            // Vérifier si l'âge est un nombre
            const ageMatch = messageContent.match(/\d+/);
            if (ageMatch) {
              const age = parseInt(ageMatch[0]);
              session.userData.age = age;
              
              // Choisir l'étape suivante selon l'âge
              if (age < 19) {
                nextStep = 'step_3_young';
              } else if (age <= 30) {
                nextStep = 'step_3_normal';
              } else {
                nextStep = 'step_3_older';
              }
            } else {
              // Si pas d'âge détecté, rester à cette étape et demander à nouveau
              directResponse = "Quel âge as-tu ? J'ai besoin de savoir 😉";
              nextStep = session.currentStep;
            }
          }
          // Étape de transition vers l'offre
          else if (session.currentStep === 'step_3_young' || 
                  session.currentStep === 'step_3_normal' || 
                  session.currentStep === 'step_3_older') {
            
            // Vérifier si le message est la deuxième réponse après l'étape 3 (c'est-à-dire après "Tu as envie de quoi?")
            if (session.waitingForOfferResponse) {
              // L'utilisateur a répondu à la question, donc on peut passer à l'étape 4
              session.waitingForOfferResponse = false;
              nextStep = 'step_4_offer';
            } else {
              // C'est la première réponse, donc on reste à cette étape mais on marque qu'on attend la réponse
              session.waitingForOfferResponse = true;
              nextStep = session.currentStep;
              // On a déjà envoyé le message principal de cette étape, donc on envoie juste le message "Tu as envie de quoi?"
              directResponse = "Tu as envie de quoi ? 😈";
            }
          }
          // Vérifier si c'est l'étape de choix du service
          else if (session.currentStep === 'step_4_offer') {
            // Vérifier si l'utilisateur a mentionné un prix ou un service
            const priceKeywords = ['30', '40', '50', '70', '150', '300', 'euros', '€'];
            const serviceKeywords = ['pipe', 'sucer', 'suce', 'baise', 'baiser', 'gicler', 'min', 'heure', 'caisse', 'voiture'];
            
            const hasPriceKeyword = priceKeywords.some(keyword => 
              messageContent.toLowerCase().includes(keyword)
            );
            
            const hasServiceKeyword = serviceKeywords.some(keyword => 
              messageContent.toLowerCase().includes(keyword)
            );
            
            if (hasPriceKeyword || hasServiceKeyword) {
              // L'utilisateur a fait un choix, passer à l'étape suivante
              nextStep = 'step_5_rdv';
            } else {
              // L'utilisateur n'a pas indiqué clairement son choix, demander une clarification
              directResponse = "Ouais mais t'veux quoi bb ? 30min ? 1h ? Ou juste une pipe dans ta caisse ? 😏";
              nextStep = session.currentStep; // Rester à cette étape
            }
          }
          // Pour toutes les autres étapes, utiliser la logique standard
          else if (currentStep?.transitions?.onSuccess) {
            if (typeof currentStep.transitions.onSuccess === 'object') {
              if (currentStep.transitions.onSuccess.type === 'intent_platform') {
                // Vérifier si le message contient une plateforme attendue
                const expectedPlatforms = currentStep.transitions.onSuccess.expectedPlatforms || [];
                const messageMatches = expectedPlatforms.some(platform => 
                  messageContent.toLowerCase().includes(platform.toLowerCase())
                );
                
                if (messageMatches) {
                  nextStep = currentStep.transitions.onSuccess.nextStep;
                } else {
                  directResponse = currentStep.transitions.onSuccess.fallback;
                  nextStep = session.currentStep;
                }
              } else if (currentStep.transitions.onSuccess.type === 'intent_detection') {
                // Vérifier si le message contient des mots-clés
                const keywords = currentStep.transitions.onSuccess.keywords || [];
                const messageMatches = keywords.some(keyword => 
                  messageContent.toLowerCase().includes(keyword.toLowerCase())
                );
                
                if (messageMatches) {
                  nextStep = currentStep.transitions.onSuccess.nextStep;
                } else {
                  // Utiliser l'étape de clarification si disponible
                  nextStep = currentStep.transitions.onSuccess.fallback || session.currentStep;
                }
              } else if (currentStep.transitions.onSuccess.type === 'conditional') {
                // Pour les transitions conditionnelles
                nextStep = currentStep.transitions.onSuccess.default || 'step_2_location';
              } else {
                // Pour les autres types
                nextStep = currentStep.transitions.onSuccess.nextStep || 'step_2_location';
              }
            } else {
              // Transitions simples (chaîne de caractères)
              nextStep = currentStep.transitions.onSuccess;
            }
          } else {
            // Fallback si pas de transition définie
            nextStep = 'step_3_normal';
          }
          log.info('Transition d\'étape', {
            from: session.currentStep,
            to: nextStep
          });
          
          session.previousStep = session.currentStep;
          session.currentStep = nextStep;
          
          // Si nous avons une réponse directe, l'envoyer immédiatement
          if (directResponse) {
            log.info('Envoi de réponse directe', { response: directResponse });
            
            // Ajouter des typos pour un effet naturel
            const content = addRandomTypos(directResponse);
            
            // Envoyer avec un léger délai
            setTimeout(async () => {
              try {
                await simulateTypingAndSend(chatId, content, {
                  typingSpeed: 70, // Légèrement plus rapide pour les réponses directes
                  minTypingTime: 1800
                });
                log.info('Message direct envoyé avec simulation de frappe', {
                  chatId: chatId.split('@')[0],
                  messageLength: content.length
                });
              } catch (error) {
                log.error('Erreur lors de l\'envoi du message direct', {
                  error: error.message,
                  chatId: chatId.split('@')[0]
                });
              }
            }, 1000);
          } 
          // Sinon, envoyer le message correspondant à la nouvelle étape
          else {
            const newStep = stepProcessor.getStepById(session.currentStep);
            if (newStep && newStep.messages && newStep.messages.length > 0) {
              // Cas spécial pour step_4_offer et step_6_acompte : envoyer chaque message séquentiellement
              if (session.currentStep === 'step_4_offer' || session.currentStep === 'step_6_acompte') {
                // Envoyer chaque message séparément avec un délai entre eux
                for (let i = 0; i < newStep.messages.length; i++) {
                  const messageObj = newStep.messages[i];
                  
                  // Personnaliser et formater le message
                  let content = messageObj.content;
                  content = stepProcessor.personalizeMessage(content, session.userData);
                  content = addRandomTypos(content);
                  
                  // Calculer un délai progressif
                  const baseDelay = messageObj.delayMs || 3000;
                  const delay = baseDelay + (i * 2000); // Ajouter 2 secondes par message supplémentaire
                  
                  // Créer une fermeture (closure) pour capturer i
                  ((index, messageContent, messageDelay) => {
                    setTimeout(async () => {
                      // Vérifier s'il s'agit du message indiquant l'envoi d'une photo
                      if (messageContent.includes("photo vue unique envoyée")) {
                        // Envoyer la photo du profil en mode "vue unique"
                        try {
                          // Charger l'image du profil
                          const media = MessageMedia.fromFilePath(mediaConfig.images.categories.profile.path);
                          
                          // On tente d'utiliser l'approche du chat pour forcer le mode vue unique
                          try {
                            const chat = await client.getChatById(chatId);
                            
                            // Cette méthode est plus fiable pour le mode vue unique
                            await chat.sendMessage(media, {
                              caption: "💋", // Émoticône comme légende
                              isViewOnce: true,
                              sendMediaAsViewOnce: true,
                              viewOnce: true
                            });
                            
                            log.info(`Photo vue unique envoyée avec succès via chat à ${chatId.split('@')[0]}`);
                          } catch (chatError) {
                            log.error('Erreur avec la méthode chat, tentative alternative', { error: chatError.message });
                            
                            // Méthode alternative si la première échoue
                            const viewOnceOptions = {
                              caption: "💋", // Émoticône comme légende
                              sendMediaAsSticker: false,
                              viewOnce: true,
                              isViewOnce: true
                            };
                            
                            await client.sendMessage(chatId, media, viewOnceOptions);
                            log.info('Envoi de photo via méthode alternative');
                          }
                          
                          log.info(`Photo vue unique envoyée avec succès à ${chatId.split('@')[0]}`);
                        } catch (mediaError) {
                          log.error(`Erreur lors de l'envoi de la photo en mode vue unique`, {
                            error: mediaError.message,
                            chatId: chatId.split('@')[0]
                          });
                          // En cas d'erreur, envoyer quand même le message texte original
                          client.sendMessage(chatId, messageContent);
                        }
                      } else {
                        // Envoyer un message texte normal
                        client.sendMessage(chatId, messageContent).then(() => {
                          log.info(`Message d'offre ${index+1}/${newStep.messages.length} envoyé`, {
                            chatId: chatId.split('@')[0],
                            messageLength: messageContent.length
                          });
                        }).catch(error => {
                          log.error(`Erreur lors de l'envoi du message d'offre ${index+1}`, {
                            error: error.message,
                            chatId: chatId.split('@')[0]
                          });
                        });
                      }
                    }, messageDelay);
                  })(i, content, delay);
                }
              } 
              // Pour toutes les autres étapes, comportement normal
              else {
                // Sélectionner un message (ou une variation)
                const messageObj = newStep.messages[0];
                let content = messageObj.content;
                
                // Utiliser une variation si disponible
                if (messageObj.variations && messageObj.variations.length > 0 && Math.random() > 0.5) {
                  const randomIndex = Math.floor(Math.random() * messageObj.variations.length);
                  content = messageObj.variations[randomIndex];
                  log.debug('Variation de message sélectionnée', { index: randomIndex });
                }
                
                // Personnaliser le message avec les données utilisateur
                content = stepProcessor.personalizeMessage(content, session.userData);
                
                // Ajouter des typos aléatoires pour un effet plus naturel
                content = addRandomTypos(content);
                
                // Délai avant d'envoyer
                const delay = messageObj.delayMs || 3000;
                log.debug('Envoi de réponse programmé', { delay });
                
                setTimeout(async () => {
                  try {
                    // Utiliser la simulation de frappe pour les messages standards
                    await simulateTypingAndSend(chatId, content, {
                      typingSpeed: 90, // Vitesse normale pour les messages longs
                      minTypingTime: 2500, // Un peu plus long pour montrer qu'elle réfléchit
                      maxTypingTime: 9000 // Maximum 9 secondes pour les longs messages
                    });
                    
                    log.info('Message envoyé avec simulation de frappe', {
                      chatId: chatId.split('@')[0],
                      messageLength: content.length,
                      step: session.currentStep
                    });
                  } catch (error) {
                    log.error('Erreur lors de l\'envoi du message', {
                      error: error.message,
                      chatId: chatId.split('@')[0]
                    });
                  }
                }, delay);
              }
            }
          }
          
        } catch (nlpError) {
          log.error('Erreur lors de l\'analyse NLP', { error: nlpError.message });
          
          // Même en cas d'erreur NLP, continuer la conversation
          const currentStep = stepProcessor.getStepById(session.currentStep);
          
          // Utiliser la même logique que dans le cas normal
          let nextStep;
          let directResponse = null;
          
          // Gestion des transitions de type objet
          if (currentStep?.transitions?.onSuccess && typeof currentStep.transitions.onSuccess === 'object') {
            if (currentStep.transitions.onSuccess.type === 'intent_platform') {
              // En cas d'erreur NLP, on utilise directement le fallback comme réponse directe
              directResponse = currentStep.transitions.onSuccess.fallback;
              // Rester à l'étape actuelle
              nextStep = session.currentStep;
            } else if (currentStep.transitions.onSuccess.type === 'conditional') {
              // Pour les transitions conditionnelles, passer à l'étape par défaut
              nextStep = currentStep.transitions.onSuccess.default || 'step_2_location';
            } else {
              // Pour les autres types, utiliser la valeur par défaut
              nextStep = currentStep.transitions.onSuccess.nextStep || 'step_2_location';
            }
          } else {
            // Transitions simples (chaîne de caractères)
            nextStep = currentStep?.transitions?.onSuccess || 
                      botConfig.scenario?.startStep || 
                      'step_2_location';
          }
          log.info('Fallback - Passage à l\'étape suivante sans analyse NLP', {
            from: session.currentStep,
            to: nextStep
          });
          
          session.previousStep = session.currentStep;
          session.currentStep = nextStep;
          
          // Si nous avons une réponse directe, l'envoyer immédiatement
          if (directResponse) {
            log.info('Envoi de réponse directe (fallback)', { response: directResponse });
            
            // Ajouter des typos pour un effet naturel
            const content = addRandomTypos(directResponse);
            
            // Envoyer avec un léger délai
            setTimeout(() => {
              client.sendMessage(chatId, content).then(() => {
                log.info('Message direct de fallback envoyé', {
                  chatId: chatId.split('@')[0],
                  messageLength: content.length
                });
              }).catch(error => {
                log.error('Erreur lors de l\'envoi du message direct', {
                  error: error.message,
                  chatId: chatId.split('@')[0]
                });
              });
            }, 2000);
          }
          // Sinon, envoyer le message correspondant à la nouvelle étape
          else {
            const newStep = stepProcessor.getStepById(session.currentStep);
            if (newStep && newStep.messages && newStep.messages.length > 0) {
              setTimeout(() => {
                const content = newStep.messages[0].content;
                client.sendMessage(chatId, content).then(() => {
                  log.info('Message de fallback envoyé', {
                    chatId: chatId.split('@')[0],
                    messageLength: content.length
                  });
                }).catch(error => {
                  log.error('Erreur lors de l\'envoi du message de fallback', {
                    error: error.message
                  });
                });
              }, 3000);
            }
          }
        }
        
      } catch (error) {
        log.error('Erreur lors du traitement du message', {
          error: error.message,
          stack: error.stack
        });
      }
    });
    
    /**
     * Simuler la frappe au clavier avant d'envoyer un message
     * @param {string} chatId - ID du chat
     * @param {string} message - Message à envoyer
     * @param {number} typingDelay - Temps de frappe simulé (proportionnel à la longueur du message)
     * @returns {Promise<void>}
     */
    async function simulateTypingAndSend(chatId, message, options = {}) {
      try {
        // Récupérer le chat
        const chat = await client.getChatById(chatId);
        
        // Calculer un délai proportionnel à la longueur du message (plus réaliste)
        // Entre 1 et 5 secondes, selon la longueur (entre 100 et 500ms par caractère, ajusté au besoin)
        const typingSpeed = options.typingSpeed || 80; // ms par caractère
        const minTypingTime = options.minTypingTime || 2000; // minimum 2 secondes
        const maxTypingTime = options.maxTypingTime || 8000; // maximum 8 secondes
        
        // Calculer le délai en fonction de la longueur du message
        let typingTime = Math.min(Math.max(message.length * typingSpeed, minTypingTime), maxTypingTime);
        
        // Ajouter un peu d'aléatoire (±15%)
        const randomFactor = 0.85 + (Math.random() * 0.3); // entre 0.85 et 1.15
        typingTime = Math.round(typingTime * randomFactor);
        
        log.debug('Simulation de frappe', { 
          chatId: chatId.split('@')[0], 
          messageLength: message.length, 
          typingTime 
        });
        
        // Indiquer que le bot est en train d'écrire
        await chat.sendStateTyping();
        
        // Attendre le délai calculé pour simuler la frappe
        await new Promise(resolve => setTimeout(resolve, typingTime));
        
        // Envoyer le message
        const sentMessage = await client.sendMessage(chatId, message, options.messageOptions || {});
        
        // Arrêter l'état de frappe (pas toujours nécessaire car l'envoi du message le fait automatiquement)
        // await chat.clearState();
        
        log.info('Message envoyé après simulation de frappe', {
          chatId: chatId.split('@')[0], 
          messageLength: message.length,
          typingTime
        });
        
        return sentMessage;
      } catch (error) {
        log.error('Erreur lors de la simulation de frappe', { 
          error: error.message,
          chatId: chatId.split('@')[0] 
        });
        
        // En cas d'erreur, envoyer le message directement sans simulation
        return await client.sendMessage(chatId, message, options.messageOptions || {});
      }
    }
    
    // Ajouter des typos aléatoires pour un effet plus naturel
    function addRandomTypos(text) {
      if (!botConfig.behavior?.randomization?.typosEnabled) {
        return text;
      }
      
      const typoFrequency = botConfig.behavior?.randomization?.typosFrequency || 0.05;
      
      // Types de typos
      const typoTypes = [
        // Doublement de lettres
        (char) => char + char,
        // Inversion avec lettre suivante
        (char, i, text) => i < text.length - 1 ? text[i+1] + char : char,
        // Omission de lettre
        () => '',
        // Remplacement par une lettre proche sur clavier
        (char) => {
          const keyboardNeighbors = {
            'a': 'qzs', 'e': 'rzd', 'i': 'uo', 'o': 'iplk',
            't': 'ry', 's': 'dzaq', 'n': 'bhj'
          };
          const neighbors = keyboardNeighbors[char.toLowerCase()];
          if (!neighbors) return char;
          return neighbors.charAt(Math.floor(Math.random() * neighbors.length));
        }
      ];
      
      let result = '';
      let typoCount = 0;
      
      for (let i = 0; i < text.length; i++) {
        // Appliquer une typo avec la probabilité définie
        if (Math.random() < typoFrequency) {
          const typoType = typoTypes[Math.floor(Math.random() * typoTypes.length)];
          result += typoType(text[i], i, text);
          typoCount++;
        } else {
          result += text[i];
        }
      }
      
      if (typoCount > 0) {
        log.debug('Typos ajoutés au message', { count: typoCount });
      }
      
      return result;
    }
    
    // Nettoyage des sessions inactives
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const inactiveTimeout = 30 * 60 * 1000; // 30 minutes
      let cleanedCount = 0;
      
      sessions.forEach((session, chatId) => {
        if (now - session.lastActivity > inactiveTimeout) {
          sessions.delete(chatId);
          cleanedCount++;
        }
      });
      
      if (cleanedCount > 0) {
        log.info('Sessions inactives nettoyées', { count: cleanedCount });
      }
    }, 15 * 60 * 1000); // Vérifier toutes les 15 minutes
    
    // Initialiser WhatsApp
    log.info('Initialisation du client WhatsApp...');
    await client.initialize();
    
    return {
      client,
      sessions,
      cleanupInterval
    };
    
  } catch (error) {
    log.error('Erreur fatale lors de l\'initialisation du bot', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Fonction pour arrêter le bot proprement
async function stopBot() {
  const log = getLoggerInstance();
  
  if (!isRunning) {
    log.warn('Tentative d\'arrêt du bot alors qu\'il n\'est pas en cours d\'exécution');
    return;
  }

  log.info('Début de la procédure d\'arrêt du bot...');
  
  try {
    if (client) {
      await client.destroy();
      client = null;
      log.info('Client WhatsApp détruit avec succès');
    }
    
    // Nettoyer les sessions
    const sessionCount = sessions.size;
    sessions.clear();
    log.info('Sessions nettoyées', { count: sessionCount });
    
    isRunning = false;
    log.info('Bot arrêté avec succès');
  } catch (error) {
    log.error('Erreur lors de l\'arrêt du bot', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Fonction pour obtenir le statut du bot
function getBotStatus() {
  const status = {
    isRunning,
    sessionsCount: sessions.size,
    clientState: client ? client.info : null
  };
  
  getLoggerInstance().debug('Statut du bot demandé', status);
  
  return status;
}

// Si le script est exécuté directement (pas importé comme module)
if (require.main === module) {
  const log = getLoggerInstance();
  
  // Démarrer le bot
  initializeBot().catch(err => {
    log.error('Erreur lors de l\'initialisation du bot (main)', {
      error: err.message,
      stack: err.stack
    });
    process.exit(1);
  });

  // Gestion propre de l'arrêt
  process.on('SIGINT', async () => {
    log.info('Signal SIGINT reçu');
    await stopBot();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Signal SIGTERM reçu');
    await stopBot();
    process.exit(0);
  });
}

// Exporter les fonctions pour un usage externe
module.exports = {
  initializeBot,
  stopBot,
  getBotStatus,
  setLogger,
  client,
  sessions
};
