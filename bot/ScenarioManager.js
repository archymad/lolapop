/**
 * Gestionnaire de scénarios pour le bot
 */

class ScenarioManager {
  constructor(scenarioConfig, activeScenario) {
      this.config = scenarioConfig;
      this.activeScenario = activeScenario || this.getDefaultScenario();
      
      // Charger le scénario actif
      this.scenario = this.config.scenarios[this.activeScenario];
      if (!this.scenario) {
        console.warn(`Scénario "${this.activeScenario}" non trouvé, utilisation du premier scénario disponible`);
        const scenarios = Object.keys(this.config.scenarios);
        if (scenarios.length > 0) {
          this.activeScenario = scenarios[0];
          this.scenario = this.config.scenarios[this.activeScenario];
        } else {
          throw new Error('Aucun scénario disponible');
        }
      }
    }
    
    /**
     * Obtient le scénario par défaut à partir de la configuration
     */
    getDefaultScenario() {
      // Chercher le premier scénario disponible
      const scenarios = Object.keys(this.config.scenarios);
      // Si acompte_conversion_lola existe, on le priorise
      if (scenarios.includes('acompte_conversion_lola')) {
        return 'acompte_conversion_lola';
      }
      // Sinon on prend le premier
      return scenarios.length > 0 ? scenarios[0] : null;
    }
    
    /**
     * Changer le scénario actif
     */
    setActiveScenario(scenarioName) {
      if (!this.config.scenarios[scenarioName]) {
        console.warn(`Scénario "${scenarioName}" non trouvé`);
        return false;
      }
      
      this.activeScenario = scenarioName;
      this.scenario = this.config.scenarios[scenarioName];
      return true;
    }
    
    /**
     * Obtenir une étape par son ID
     */
    getStepById(stepId) {
      if (!this.scenario || !this.scenario.steps) {
        return null;
      }
      
      return this.scenario.steps[stepId] || null;
    }
    
    /**
     * Obtenir l'étape initiale
     */
    getInitialStep() {
      return this.scenario.startStep || Object.keys(this.scenario.steps)[0] || null;
    }
    
    /**
     * Valider une réponse utilisateur
     */
    async validateResponse(message, analysisResult, session, currentStep) {
      // Si l'étape n'a pas de validation, considérer comme valide
      if (!currentStep.validation || currentStep.validation.type === 'none') {
        return {
          isValid: true,
          nextStep: null,
          needsRetry: false,
          forceProgress: true
        };
      }
      
      let isValid = false;
      let nextStep = null;
      let needsRetry = false;
      let forceProgress = false;
      
      // Validation selon le type
      switch (currentStep.validation.type) {
        case 'nlp':
          // Validation basée sur l'analyse NLP
          isValid = this.validateWithNLP(message, analysisResult, currentStep.validation);
          break;
          
        case 'pattern':
          // Validation par expression régulière
          isValid = this.validateWithPattern(message, currentStep.validation);
          break;
          
        case 'keyword':
          // Validation par mots-clés
          isValid = this.validateWithKeywords(message, currentStep.validation);
          break;
          
        case 'function':
          // Validation par fonction personnalisée
          isValid = this.validateWithFunction(message, session, currentStep.validation);
          break;
          
        default:
          // Si type inconnu, considérer comme valide
          isValid = true;
      }
      
      // Déterminer la prochaine étape
      if (isValid) {
        // Si la transition est conditionnelle
        if (currentStep.transitions.onSuccess && 
            typeof currentStep.transitions.onSuccess === 'object' &&
            currentStep.transitions.onSuccess.type === 'conditional') {
          
          // Évaluer les conditions
          nextStep = this.evaluateConditionalTransition(currentStep.transitions.onSuccess, session);
        } else {
          // Transition simple
          nextStep = currentStep.transitions.onSuccess;
        }
      } else {
        // Vérifier si on doit forcer la progression
        if (currentStep.validation.forceProgress && 
            currentStep.validation.forceProgress.enabled) {
          
          // Si on a atteint le nombre de tentatives maximum pour forcer
          if (session.retryCount >= currentStep.validation.forceProgress.onRetryCount) {
            forceProgress = true;
            nextStep = currentStep.transitions.onSuccess;
          } else {
            needsRetry = true;
          }
        } else {
          needsRetry = true;
        }
      }
      
      return {
        isValid,
        nextStep,
        needsRetry,
        forceProgress
      };
    }
    
    /**
     * Validation avec NLP
     */
    validateWithNLP(message, analysisResult, validation) {
      // Vérifier la condition de validation
      switch (validation.successCondition) {
        case 'entityDetected':
          // Vérifier si l'entité a été détectée
          if (validation.criteria.entityType === 'location') {
            return analysisResult.contains_location === true;
          } else if (validation.criteria.entityType === 'age') {
            return analysisResult.contains_age === true;
          }
          return false;
          
        case 'any':
          // Vérifier si l'un des critères est validé
          if (validation.criteria.keywords) {
            // Vérifier si le message contient un des mots-clés
            return validation.criteria.keywords.some(keyword => 
              message.toLowerCase().includes(keyword.toLowerCase())
            );
          } else if (validation.criteria.intent) {
            // Vérifier si l'intention correspond
            return validation.criteria.intent.includes(analysisResult.intent);
          }
          return message.length > (validation.criteria.minLength || 0);
          
        default:
          return message.length > 0;
      }
    }
    
    /**
     * Validation avec expression régulière
     */
    validateWithPattern(message, validation) {
      if (!validation.criteria.pattern) {
        return true;
      }
      
      const regex = new RegExp(validation.criteria.pattern, 'i');
      return regex.test(message);
    }
    
    /**
     * Validation avec mots-clés
     */
    validateWithKeywords(message, validation) {
      if (!validation.criteria.keywords || validation.criteria.keywords.length === 0) {
        return true;
      }
      
      const lowerMessage = message.toLowerCase();
      
      // Vérifier si le message contient au moins un des mots-clés
      return validation.criteria.keywords.some(keyword => 
        lowerMessage.includes(keyword.toLowerCase())
      );
    }
    
    /**
     * Validation avec fonction personnalisée
     */
    validateWithFunction(message, session, validation) {
      if (!validation.criteria.function) {
        return true;
      }
      
      // On ne peut pas exécuter des fonctions dynamiquement de façon sécurisée
      // Cette implémentation est simplifiée
      
      // Quelques fonctions prédéfinies
      const functions = {
        isOlderThan: (age) => {
          return session.userData.age && session.userData.age >= age;
        },
        hasLocation: () => {
          return !!session.userData.location;
        },
        hasSelectedService: () => {
          return !!session.userData.serviceChoice;
        }
      };
      
      try {
        const func = functions[validation.criteria.function.name];
        if (func) {
          return func(...(validation.criteria.function.args || []));
        }
      } catch (error) {
        console.error('Erreur lors de la validation par fonction:', error);
      }
      
      return true;
    }
    
    /**
     * Évaluer une transition conditionnelle
     */
    evaluateConditionalTransition(transition, session) {
      if (!transition.conditions || transition.conditions.length === 0) {
        return transition.default;
      }
      
      // Évaluer chaque condition
      for (const cond of transition.conditions) {
        if (!cond.condition) continue;
        
        // Evaluer la condition de façon sécurisée (simplifié)
        try {
          const userData = session.userData;
          
          // Conditions simples avec l'âge
          if (cond.condition.includes('age')) {
            const age = userData.age || 0;
            
            if (cond.condition === 'age < 19' && age < 19) {
              return cond.nextStep;
            } else if (cond.condition === 'age >= 19 && age <= 30' && age >= 19 && age <= 30) {
              return cond.nextStep;
            } else if (cond.condition === 'age > 30' && age > 30) {
              return cond.nextStep;
            }
          }
        } catch (error) {
          console.error('Erreur lors de l\'évaluation de la condition:', error);
        }
      }
      
      // Si aucune condition ne correspond, utiliser la valeur par défaut
      return transition.default;
    }
    
    /**
     * Obtenir le scénario actif
     */
    getActiveScenario() {
      return {
        name: this.activeScenario,
        scenario: this.scenario
      };
    }
  }
  
  module.exports = ScenarioManager;
